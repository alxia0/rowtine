// Rowtine — stockage local (IndexedDB via Dexie).
// 100 % local, hors ligne, aucun serveur. Schéma issu de PLAN-DEV-ANDROID.md §5.
import Dexie from 'dexie'
import { scheduleAutoBackup } from '@/backup/auto-backup'
// Drapeau « dossier propre depuis la restauration » (lot du 06/09/2026) : effacé à
// chaque mutation réussie, cf. le hook plus bas. Import statique sans cycle :
// restore-guard.js n'importe rien.
import { clearFolderClean } from '@/backup/restore-guard'

export const db = new Dexie('rowtine')

// ─────────────────────────────────────────────────────────────────────────
// SCHÉMA — UNE SEULE VERSION, DÉLIBÉRÉMENT (ménage pré-1.0, 13/08/2026).
// Avant 1.0, l'app n'a aucune utilisatrice hors de la maison : rien n'oblige à
// traîner l'empilement historique v1 (schéma d'origine) + v2 (achats) + v3
// (jours actifs) qui avait construit les bases des appareils de test. Tout est
// déclaré ici, d'un bloc, comme sur une installation neuve.
//
// Ce qui remplace l'ancienne procédure de migration, pour le cas d'un appareil
// dont la base est PLUS RÉCENTE que ce que ce fichier déclare (typiquement les
// deux appareils de la maison : base à 30 côté IndexedDB, ce code à 10 — Dexie
// multiplie le numéro par 10) : le garde-fou de démarrage, src/db/version-guard.js,
// appelé par src/router/index.js. Il compare la base présente à la version
// DÉRIVÉE de la déclaration ci-dessous et affiche un message au lieu de laisser
// la situation se régler en silence — mesuré en phase 1 : Dexie absorbe la
// VersionError et rouvre sans version, l'app démarre comme si de rien n'était.
//
// ⚠️ APRÈS la 1.0 (donc dès qu'une base existe ailleurs qu'ici), ce bloc redevient
// intouchable : on ne modifie JAMAIS en place une version publiée — un changement
// de schéma s'ajoute À LA SUITE, `db.version(2).stores({...})`, et s'accompagne
// d'un `.upgrade(tx => ...)` dès qu'il transforme de la donnée déjà écrite (renommer
// un champ, changer son type, éclater une table).
//
// ⚠️ Ce que devient une édition EN PLACE d'une version déjà publiée — lu dans la source
// de Dexie (dexie.js:4566-4572 puis 3768-3790) et mesuré le 13/08/2026
// (tests/unit/purchases.store.spec.js) ; ce n'est PAS « rien ne se passe » :
// - édition ADDITIVE (table ou index AJOUTÉS) : Dexie RATTRAPE tout seul en rouvrant la
//   base au numéro natif +1. Seule trace : un `console.warn`. Le schéma finit correct,
//   mais la base d'un appareil passe à un numéro que le code ne déclare pas — le
//   garde-fou de démarrage s'y déclenchera au lancement suivant ;
// - changement de TYPE D'INDEX ou de CLÉ PRIMAIRE : PAS rattrapé (dexie.js:3781). Là,
//   et là seulement, le schéma réel diverge vraiment de ce que le code décrit ;
// - un `.upgrade()` n'est JAMAIS rejoué dans ce mode : une donnée à transformer ne le
//   sera pas.
// Autrement dit, éditer en place ne « ne fait rien » jamais : ça fait autre chose que ce
// qu'on croit. La règle reste donc d'ajouter une version à la suite.
// ⚠️ Piège permanent de Dexie : il REMPLACE la liste d'index d'une table à chaque
// version, il ne la fusionne pas — toute table citée dans un nouveau `.stores({...})`
// doit reciter TOUS ses index, sous peine d'en perdre un sans erreur ni test rouge.
//
// Filets de sécurité : `tests/unit/db-schema-unique.spec.js` compare, sur base
// NEUVE, les index RÉELS produits par la déclaration ci-dessous à ceux que
// produisait la montée par paliers v1→v2→v3 (c'est lui qui verrait un `++id`
// perdu) ; `tests/unit/db-migration-guard.spec.js` ouvre avec ce fichier une base
// écrite par l'APK actuellement installé sur les appareils.
// ─────────────────────────────────────────────────────────────────────────

// On n'indexe que ce qu'on requête réellement (le 1er champ = clé primaire).
db.version(1).stores({
  projects: '++id, name, technique, status, startedAt, finishedAt',
  yarns: '++id, brand, weight, reservedFor',
  patterns: '++id, name, type, category',
  sections: '++id, projectId, patternId, state, order',
  diagrams: '++id, projectId, patternId, sectionId',
  counters: '++id, projectId, name',
  sessions: '++id, projectId, sectionId, date',
  settings: 'key',
  trash: '++id, type, deletedAt',
  // Registre d'achats (ex-v2, 31/07/2026) : table SÉPARÉE et non des
  // champs sur `yarns`, parce qu'un achat doit survivre à la suppression définitive de la
  // fiche de laine (arbitrage produit) — `yarnId` passe alors à null.
  // Index : `yarnId` (lignes d'une fiche), `date` (regroupement par année/mois).
  purchases: '++id, yarnId, date',
  // Journal des jours actifs (ex-v3, 11/08/2026) : le champ
  // `lastWorkedAt` du projet est ÉCRASÉ à chaque geste — il dit quand a eu lieu la DERNIÈRE
  // action, jamais quels jours il y en a eu. Cette table est le seul historique. La clé
  // primaire EST le jour : un `put` est idempotent, cinquante gestes dans la journée
  // n'écrivent qu'une ligne. Volume : quelques centaines de lignes sur plusieurs années.
  activeDays: 'day', // { day: 'AAAA-MM-JJ' } — jour LOCAL, jamais toISOString()
})

// Hook de mutation global : chaque store Pinia appelle
// `db.<table>.add/update/put/delete` indépendamment — il n'existe aucun
// choke-point d'écriture central. Un middleware `db.use` au niveau `dbcore`
// est le point unique qui voit TOUTES les écritures de TOUTES les tables
// (create/update/delete, bulk*), y compris les tables ajoutées plus tard —
// contrairement à des hooks posés table par table (`creating`/`updating`/
// `deleting`) qu'il faudrait enregistrer et maintenir pour chacune. On arme la
// sauvegarde débouncée après chaque `mutate` réussi ; `scheduleAutoBackup` est
// déjà un no-op pendant une suppression active (anti-boucle `runBackup` /
// anti-écrasement `syncPatronMd`, cf. src/backup/auto-backup.js), et `runBackup`
// lui-même est un no-op silencieux hors plateforme native/dossier désigné — ce
// hook ne peut donc jamais provoquer d'écriture réelle inattendue en test (web).
//
// Pas de cycle d'import : `auto-backup.js` n'importe QUE `@/utils/debounce`
// (pur) de façon statique ; il résout `backup-service` (qui, lui, importe ce
// fichier pour `setSetting`) par un `import()` dynamique, seulement au moment
// où le debounce se déclenche réellement — jamais pendant le chargement des
// modules. Le graphe d'imports statiques reste donc : db.js → auto-backup.js →
// debounce.js, sans retour vers db.js. `restore-guard.js` (pour
// `clearFolderClean`, lot du 06/09/2026) suit la même règle : module d'état pur
// sans aucune dépendance, il ne referme aucun cycle.
db.use({
  stack: 'dbcore',
  name: 'auto-backup-on-mutate',
  create(downlevelDatabase) {
    return {
      ...downlevelDatabase,
      table(tableName) {
        const downlevelTable = downlevelDatabase.table(tableName)
        return {
          ...downlevelTable,
          mutate: async (req) => {
            const res = await downlevelTable.mutate(req)
            // Toute écriture locale rend le dossier potentiellement divergent : le
            // drapeau « propre depuis restauration » ne survit pas à une mutation.
            clearFolderClean()
            scheduleAutoBackup()
            return res
          },
        }
      },
    }
  },
})

// IndexedDB ne sait pas cloner un objet réactif Vue (Proxy) → on le ramène à un objet simple.
export const plain = (o) => JSON.parse(JSON.stringify(o))

// Réglages : petit magasin clé/valeur.
export async function getSetting(key) {
  const row = await db.settings.get(key)
  return row ? row.value : undefined
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value })
}

export default db

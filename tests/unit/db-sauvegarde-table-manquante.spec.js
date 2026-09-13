// tests/unit/db-sauvegarde-table-manquante.spec.js
// GARDE PERMANENTE (ex-db-downgrade-sauvegarde-mesure.spec.js, née comme mesure le
// 12/08/2026, promue le 13/08 à la fusion des trois `db.version()` en une seule).
//
// LA QUESTION, APRÈS LA FUSION : une table qui manque à ce que le code voit de la base
// coûte-t-elle la sauvegarde AUTOMATIQUE, en silence ? Oui — et c'est pourquoi cette mesure
// devient une garde. Le chemin qui produisait cet état a changé, le danger non : ce n'est
// plus un décalage de numéro de version (src/db/db.js ne déclare plus qu'une seule
// `db.version(1)` portant les onze tables ; une base d'appareil à 30 les voit toutes,
// vérifié dans db-migration-guard.spec.js), c'est désormais une table OUBLIÉE dans cette
// unique déclaration — une faute d'édition ordinaire, que rien d'autre ne rend visible. Les
// deux `it()` ci-dessous fabriquent cet état par le moyen le plus court (un Dexie qui
// déclare moins de tables que la base n'en porte) et verrouillent ce qu'il produit.
//
// L'état de départ mesuré : une base montée v1→v2→v3, rouverte par un Dexie qui
// ne déclare que `version(1)`, s'ouvre SANS ERREUR mais rend les tables `purchases` et
// `activeDays` INVISIBLES (`db.purchases === undefined`, pas d'exception à l'accès à la
// PROPRIÉTÉ — seul `db.table('purchases')` explicite lève). Les données restent intactes sur
// le disque IndexedDB.
// Question ouverte précédemment : dans cet état, QUE PRODUIT LA COLLECTE DE SAUVEGARDE
// (`collectBackupData`, src/backup/collect.js) ? Deux hypothèses possibles avant mesure :
//   A. elle écrit un snapshot avec `purchases: []` et `activeDays: []` → la sauvegarde
//      suivante écraserait `achats.json`/`jours-actifs.json` avec des fichiers VIDES ;
//   B. elle échoue avant de produire quoi que ce soit → aucun fichier n'est réécrit ce
//      cycle-là, les précédents survivent.
//
// VERDICT (2026-08-12, complété 2026-08-13 après revue) : c'est l'hypothèse B pour LES
// DEUX tables, mesuré séparément par les deux `it()` ci-dessous — le 1er où `purchases`
// est la première table absente que `Promise.all` rencontre (avec `activeDays` absente
// aussi, comme précédemment), le 2e où `purchases` est déclarée dans le schéma rétrogradé et
// SEULE `activeDays` reste invisible. Nécessaire : `collect.js` évalue `db.purchases
// .toArray()` (collect.js:63) avant `db.activeDays.toArray()` (collect.js:64) dans le même
// littéral de tableau — sans ce 2e scénario, rien ne prouvait que l'absence d'`activeDays`
// SEULE produit le même verdict plutôt que d'être simplement masquée par celle de
// `purchases`. Les deux rejettent, avec le même mécanisme et le même message.
//
// `collectBackupData` n'appelle pas `db.tables` (pas de balayage) : elle nomme chaque
// table par sa PROPRIÉTÉ, `db.purchases.toArray()` / `db.activeDays.toArray()`, au milieu
// d'un littéral de tableau passé à `Promise.all` (collect.js:55-65).
//
// Lu, pas mesuré séparément (mécanisme JS déduit de la lecture de collect.js:55-65 — la
// sémantique d'évaluation d'un littéral de tableau JS ; ce que les deux `it()` observent
// directement, c'est le REJET final, pas cette étape intermédiaire) : puisque la table
// manquante (`db.purchases` au 1er scénario, `db.activeDays` au 2e) vaut `undefined` — pas
// une table Dexie qui lèverait proprement, cf. `.table('purchases')` explicite dans la
// mesure initiale — la ligne correspondante lève un `TypeError` JAVASCRIPT SYNCHRONE
// (« Cannot read properties of undefined (reading 'toArray') ») pendant la CONSTRUCTION du
// tableau, avant même que `Promise.all` existe. `collectBackupData` étant une fonction
// `async`, ce throw synchrone devient un REJET de la promesse qu'elle retourne : elle ne
// rend JAMAIS d'objet, ni complet ni partiel — impossible d'obtenir un `achats.json` ou un
// `jours-actifs.json` vide PAR CE CHEMIN, faute de snapshot du tout à sérialiser, quelle
// que soit la table manquante.
//
// Lu (non exécuté ici) : `runBackup` (backup-service.js:69-161)
// enveloppe tout le corps `collectBackupData()` + `backupAll()` dans un `try/catch` qui
// retombe sur `{ ok: false, error }` (ligne ~154-156). Le rejet de `collectBackupData` est
// donc absorbé LÀ, AVANT que `backupAll` ne soit appelée : aucun fichier — ni `achats.json`,
// ni `jours-actifs.json`, ni aucun autre — n'est réécrit ce cycle-là. Les fichiers de la
// sauvegarde précédente survivent intacts. Le scénario est réversible : il rend l'app
// aveugle à ces tables et bloque toute sauvegarde tant qu'il dure, SANS AUCUNE ALERTE NI
// MESSAGE utilisateur — mais pas totalement sans trace : la date « à jour au ... » des
// Réglages (`lastBackupAt`, SafFolderSection.vue:255, écrite uniquement en cas de succès,
// backup-service.js:120) cesse simplement d'avancer. Il ne détruit aucune sauvegarde déjà
// écrite.
//
// Doit être SEUL dans son fichier (aucun AUTRE fichier ne doit manipuler « rowtine » en
// parallèle) : les deux `it()` ci-dessous détruisent et recréent la base à tour de rôle ;
// Vitest exécute les tests d'un même fichier en série par défaut (pas de `concurrent`
// ici), donc pas de conflit entre eux.
import { describe, it, expect, vi, afterEach } from 'vitest'
import Dexie from 'dexie'

// Schémas HISTORIQUES v1/v2/v3, tels que src/db/db.js les déclarait avant la fusion du
// 13/08/2026 — recopiés VOLONTAIREMENT plutôt qu'importés : ils servent ici à FABRIQUER un
// état (une vue partielle de la base) et ne doivent surtout pas suivre les évolutions du
// fichier réel, sans quoi ce test cesserait d'exercer une table manquante le jour où le
// schéma bouge.
const SCHEMA_V1 = {
  projects: '++id, name, technique, status, startedAt, finishedAt',
  yarns: '++id, brand, weight, reservedFor',
  patterns: '++id, name, type, category',
  sections: '++id, projectId, patternId, state, order',
  diagrams: '++id, projectId, patternId, sectionId',
  counters: '++id, projectId, name',
  sessions: '++id, projectId, sectionId, date',
  settings: 'key',
  trash: '++id, type, deletedAt',
}
const SCHEMA_V2 = { purchases: '++id, yarnId, date' }
const SCHEMA_V3 = { activeDays: 'day' }

afterEach(() => {
  vi.doUnmock('@/db/db')
  vi.resetModules()
})

// Construit la base « actuelle » v1→v2→v3 avec une ligne d'achat et un jour actif —
// l'état des deux appareils (Huawei, Nexus 7) avant une éventuelle rétrogradation du code
// — puis la referme. Partagé par les deux scénarios ci-dessous.
async function creerBaseActuelle() {
  const actuelle = new Dexie('rowtine')
  actuelle.version(1).stores(SCHEMA_V1)
  actuelle.version(2).stores(SCHEMA_V2)
  actuelle.version(3).stores(SCHEMA_V3)
  await actuelle.open()
  const yarnId = await actuelle.yarns.add({ brand: 'Drops', weight: 'DK', quantity: 6 })
  await actuelle.purchases.add({ yarnId, quantity: 6 })
  await actuelle.activeDays.put({ day: '2026-08-11' })
  actuelle.close()
}

describe('collecte de sauvegarde contre une base v3 ouverte par un code qui n’en voit qu’une partie', () => {
  it("purchases ET activeDays invisibles (code réduit à v1) : rejette avant de produire un snapshot", async () => {
    await Dexie.delete('rowtine')
    await creerBaseActuelle()

    // Un Dexie qui ne déclare que v1 rouvre cette même base — reproduit l'état mesuré
    // précédemment : ouverture réussie, purchases/activeDays invisibles.
    const retrogradee = new Dexie('rowtine')
    retrogradee.version(1).stores(SCHEMA_V1)
    await retrogradee.open()

    // Pré-condition : le fait déjà établi précédemment, redit ici pour que ce fichier
    // reste lisible seul — `purchases`/`activeDays` n'existent pas comme PROPRIÉTÉS sur
    // l'instance rétrogradée (à distinguer de `.table('purchases')`, qui lève).
    expect(retrogradee.purchases).toBeUndefined()
    expect(retrogradee.activeDays).toBeUndefined()

    // La collecte RÉELLE de src/backup/collect.js, branchée sur cette base rétrogradée
    // via un mock de son unique dépendance ('@/db/db') — collect.js n'est pas modifiable
    // (il importe le singleton `db`, toujours ouvert plein schéma), donc c'est le point
    // d'injection qui permet de l'exercer contre l'état mesuré sans toucher à src/.
    vi.doMock('@/db/db', () => ({ db: retrogradee }))
    const { collectBackupData } = await import('@/backup/collect')

    // FAIT — observé, pas espéré : la collecte REJETTE, elle ne rend pas un objet avec
    // des tableaux vides. `db.purchases.toArray()` (collect.js) lit `.toArray` sur
    // `undefined` en pleine construction du littéral de tableau passé à `Promise.all` —
    // un TypeError JS ordinaire, synchrone, qui devient le rejet de la promesse renvoyée
    // par cette fonction `async`. Pas de snapshot partiel : rien à sérialiser du tout.
    await expect(collectBackupData()).rejects.toBeInstanceOf(TypeError)
    await expect(collectBackupData()).rejects.toThrow(/toArray/)

    retrogradee.close()
    await Dexie.delete('rowtine')
  })

  it("purchases visible, SEULE activeDays invisible (code réduit à v1+v2) : rejette aussi, même mécanisme", async () => {
    await Dexie.delete('rowtine')
    await creerBaseActuelle()

    // Un Dexie qui déclare v1 ET v2 (purchases), mais pas v3 (activeDays) rouvre cette
    // même base — scénario non isolé précédemment : purchases redevient visible,
    // seule activeDays reste invisible. Nécessaire car collect.js:63 (`db.purchases
    // .toArray()`) est évalué AVANT collect.js:64 (`db.activeDays.toArray()`) — sans ce
    // scénario, l'absence d'activeDays seule n'était jamais mise à l'épreuve pour elle-même.
    const retrogradeeV2 = new Dexie('rowtine')
    retrogradeeV2.version(1).stores(SCHEMA_V1)
    retrogradeeV2.version(2).stores(SCHEMA_V2)
    await retrogradeeV2.open()

    // Pré-condition : purchases visible cette fois, activeDays seule ne l'est pas.
    expect(retrogradeeV2.purchases).toBeDefined()
    expect(retrogradeeV2.activeDays).toBeUndefined()

    vi.doMock('@/db/db', () => ({ db: retrogradeeV2 }))
    const { collectBackupData } = await import('@/backup/collect')

    // FAIT — observé, pas espéré : même verdict que le 1er scénario, par le même
    // mécanisme (`db.activeDays.toArray()` lit `.toArray` sur `undefined`), cette fois
    // déclenché par activeDays SEULE. Le pluriel du verdict ci-dessus est donc mérité :
    // chaque table, invisible seule, suffit à faire rejeter toute la collecte.
    await expect(collectBackupData()).rejects.toBeInstanceOf(TypeError)
    await expect(collectBackupData()).rejects.toThrow(/toArray/)

    retrogradeeV2.close()
    await Dexie.delete('rowtine')
  })
})

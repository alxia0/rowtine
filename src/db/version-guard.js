// Garde-fou de démarrage : détecte une base IndexedDB PLUS RÉCENTE que ce que le code
// déclare, sans jamais l'ouvrir. Modèle repris de storage-guard.js (même filet de
// sécurité, autre défaut) : fonctions pures, dépendances injectables pour la
// testabilité, un point d'entrée unique appelé depuis router/index.js.
//
// Pourquoi ce cas existe (établi en phase 1 du chantier de ménage, 13/08/2026) :
// db.js A PERDU ses versions 2 et 3 (déjà fait) : il ne déclare
// plus qu'une db.version(1), portant les onze tables. Un appareil déjà passé par le code
// précédent porte donc une base IndexedDB à 30 là où ce code déclare 10. Mesuré en test
// et CONFIRMÉ SUR LE PIXEL 7 le 13/08 : Dexie lève VersionError, l'absorbe et rouvre SANS
// version — l'app démarre normalement.
// ⚠️ Ce que cet écart COÛTE dépend de ce que le code déclare, et cela a changé le 13/08 :
// face à un code déclarant MOINS de tables que la base, deux tables devenaient invisibles
// et la sauvegarde automatique s'arrêtait ENTIÈREMENT, sans un mot — c'est ce silence qui
// a motivé ce garde-fou. Avec la déclaration fusionnée, les onze tables sont déclarées :
// rien n'est invisible, la sauvegarde reste complète (mesuré, tests/unit/db-migration-
// guard.spec.js). Il ne reste qu'un écart de NUMÉRO — mais il ne se règle pas tout seul et
// l'app n'est pas dans l'état qu'elle prévoit.
// ⚠️ Ce garde-fou compare UN NUMÉRO, jamais la liste des tables (les comparer exigerait
// d'ouvrir la base, ce qu'il évite délibérément) : après la 1.0, une db.version(2) pourra
// ajouter une douzième table, puis un build plus ancien tournera sur cette base — src/
// backup/collect.js nomme ses tables une par une et omettrait celle-là en silence. Les
// textes affichés (clés `versionGuard.*`) ont été reformulés en conséquence lors de la
// vague de correction finale du 13/08 : ils n'affirment que ce que ce garde-fou vérifie
// réellement — la lisibilité et la sauvegarde de ce que CETTE version connaît — jamais
// « rien n'est cassé » dans l'absolu.
import db from '@/db/db'
import { reactive } from 'vue'

// Nom de la base IndexedDB de l'app — jamais « tricoche » (cf. src/db/db.js:6).
const DB_NAME = 'rowtine'

// Dexie multiplie par 10 le numéro de version déclaré côté IndexedDB (dexie.js:4512) :
// version(1) → 10, version(3) → 30. `db.verno` est mis à jour de façon SYNCHRONE à
// chaque appel `db.version(n)` (dexie.js:6004, `this.verno = Math.max(this.verno, n)`),
// donc dès l'import de src/db/db.js — AVANT toute ouverture de la base. C'est ce qui
// permet de dériver la version attendue du schéma RÉELLEMENT déclaré, jamais d'un
// nombre écrit en dur ici : quand db.js sera réduit à une seule db.version(1),
// `db.verno` vaudra 1 tout seul et ce garde-fou continuera de refléter le schéma actuel,
// sans qu'il faille toucher ce fichier.
export function expectedIndexedDbVersion(dexieDb = db) {
  return Math.round(dexieDb.verno * 10)
}

// Lit le numéro de version de la base EXISTANTE, SANS L'OUVRIR.
// `indexedDB.databases()` rend `[{name, version}]` — mesuré le 13/08 sur le Pixel 7,
// quand la base s'appelait encore `tricoche` et déclarait trois versions :
// `{name: 'tricoche', version: 30}`. Absente des navigateurs anciens (et de certains
// contextes WebView) : dans le doute, on ne SAIT pas, donc on ne dit rien — jamais
// d'alerte sur un simple manque d'API. Idem sur toute erreur inattendue de l'appel :
// repli silencieux, jamais de blocage.
// ⚠️ Le `try/catch` protège d'une EXCEPTION, pas d'une promesse qui ne se résout jamais
// (round de correction finale, 13/08) : un délai de garde court fait courir la même
// course que `checkVersionGuardOnStartup` promet plus bas (« ne bloque jamais la
// navigation ») — sans lui, un `databases()` qui pend écranterait le premier lancement.
// Au-delà du délai, repli identique aux autres cas d'incertitude : `null`, en silence.
export async function existingIndexedDbVersion({
  indexedDBRef = globalThis.indexedDB,
  dbName = DB_NAME,
  timeoutMs = 1500,
} = {}) {
  if (!indexedDBRef || typeof indexedDBRef.databases !== 'function') return null
  const TIMED_OUT = Symbol('version-guard-databases-timeout')
  // `timer` annulé dans le `finally` : la course elle-même est inchangée (elle est déjà
  // tranchée quand le `finally` s'exécute), seul le minuteur résiduel disparaît. Sans lui,
  // le cas NOMINAL — `databases()` répond en quelques millisecondes — laissait quand même
  // un `setTimeout` de 1,5 s en vol à chaque appel, qui retient la boucle d'événements
  // (visible en test : le processus ne rend la main qu'après le délai).
  let timer
  try {
    const result = await Promise.race([
      indexedDBRef.databases(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs)
      }),
    ])
    if (result === TIMED_OUT) return null
    const match = result.find((entry) => entry.name === dbName)
    return match ? match.version : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// La question posée par ce garde-fou, et rien d'autre : la base présente est-elle PLUS
// RÉCENTE que ce que ce code déclare ? Ne répond jamais « oui » quand elle n'existe pas
// encore (première installation) ou quand on ne sait pas (API absente/en erreur).
export async function isDatabaseNewerThanCode({ indexedDBRef, dbName, expectedVersion, timeoutMs } = {}) {
  const existing = await existingIndexedDbVersion({ indexedDBRef, dbName, timeoutMs })
  if (existing == null) return false
  return existing > expectedVersion
}

// État consommé par l'affichage (App.vue) : un seul ConfirmDialog centré, qui PRIME sur
// la porte du dossier et la bienvenue du premier lancement.
// La bienvenue est structurellement absente : `settings.setWelcomeDue()` n'est appelée
// que juste après une désignation de dossier réussie, dans la MÊME session que celle
// qui a écrit la base — jamais une session antérieure à un schéma tronqué.
// ⚠️ La porte du dossier, elle, N'EST PAS structurellement absente. Le cas résiduel
// n'est PAS un onboarding interrompu (OnboardingFolderPrompt.vue:77 exige
// `onboarded === true` — un appareil non onboardé atterrit sur OnboardingView, un
// écran, pas un calque par-dessus ce message, donc inoffensif). Le cas RÉEL, plausible
// sur un appareil déjà en usage (donc porteur d'une base à 30) : `onboarded === true`
// ET `hasFolder()` devenu faux (permission révoquée, dossier supprimé). `concluded`
// (OnboardingFolderPrompt.vue:63) est un drapeau de MODULE remis à zéro à chaque
// session, et `hasFolder()` est relue à chaque `evaluate()` : la porte PEUT revenir à
// toute session ultérieure, y compris une où ce garde-fou se déclenche aussi. La
// préséance visuelle dans ce cas est assurée côté App.vue (empilement CSS,
// `.app-version-guard-layer`), pas ici.
// `reactive` seul suffit : cet état ne survit pas à un rechargement et n'a besoin
// d'être partagé qu'entre router/index.js et App.vue.
export const versionGuardState = reactive({ triggered: false })

// Point d'entrée unique. Appelé depuis router/index.js, tout au début du bloc
// `if (!settings.loaded)`, AVANT `settings.load()` : c'est là que la base est ouverte
// pour la première fois (le montage de l'app ne l'ouvre pas, cf. main.js) — mais même si
// ce n'était plus vrai demain, la détection ne dépend QUE de `indexedDB.databases()`,
// qui ne dépend lui-même d'aucune ouverture Dexie (cf. commentaire sur
// `existingIndexedDbVersion` ci-dessus).
//
// Enveloppé de bout en bout : une exception ici ne doit JAMAIS empêcher la navigation
// ni le chargement des réglages. En cas de doute, silence — jamais de blocage.
export async function checkVersionGuardOnStartup({ dexieDb, indexedDBRef, dbName, timeoutMs } = {}) {
  try {
    const expectedVersion = expectedIndexedDbVersion(dexieDb)
    const newer = await isDatabaseNewerThanCode({ indexedDBRef, dbName, expectedVersion, timeoutMs })
    if (newer) versionGuardState.triggered = true
  } catch {
    // Repli prudent : jamais d'exception qui remonte au routeur.
  }
}

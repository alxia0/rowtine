// Rowtine — garde d'exclusion mutuelle restauration↔synchro MD. Jumelle exacte de
// `import-guard.js` (import↔synchro) et de `isAutoBackupRunning` (backup-service.js) :
// `runRestore` (restore-service.js) était le SEUL des quatre traitements qui touchent le
// dossier SAF à ne poser aucun drapeau — `backup-service.js` a `backupRunning`,
// `patron-md-sync.js` a `running`/`inflight`, `import-guard.js` a `importRunning`.
//
// CE QUE CETTE GARDE ÉVITE. Une restauration lit l'arborescence par tranches puis
// remplace toute la base (clear + bulkPut). Le listener `resume` d'App.vue relance une
// synchro MD à chaque retour au premier plan — geste banal pendant une restauration de
// plusieurs dizaines de Mo sur un appareil lent. Les deux se croisant, trois issues,
// toutes mauvaises :
//  - lecture en échec (un fichier réécrit pendant qu'on le lit tranche par tranche) ;
//  - réinjection d'un état PRÉ-restauration (la transaction de `patron-md-sync.js`
//    commite après le `bulkPut` de la restauration et le recouvre) ;
//  - la pire : un `readerState` minimal réécrit par la synchro rend `isDbRestorable()`
//    faux POUR TOUJOURS. La restauration devient définitivement impossible, et la seule
//    porte qui reste ouverte est le bouton destructeur « Repartir de zéro ».
//
// POURQUOI UN MODULE À PART, et pas un export de `restore-service.js`. Ce dernier
// importe statiquement i18n et sept stores Pinia ; `patron-md-sync.js`, lui, est importé
// par une vingtaine de modules et de specs. Un import statique entre les deux tirerait
// tout ce graphe dans chacun d'eux. `backup-service.js` évite déjà ce couplage par un
// `await import('./patron-md-sync')` paresseux — ici, un module de vingt lignes sans
// aucune dépendance règle la même chose sans import dynamique du tout.
let restoreRunning = false

export function isRestoreRunning() {
  return restoreRunning
}

export function beginRestore() {
  restoreRunning = true
}

export function endRestore() {
  restoreRunning = false
}

// Drapeau « décision de restauration en attente » : couvre la fenêtre où la modale
// Restaurer/Perdre est ouverte après une désignation. Le retour du sélecteur SAF est
// un cycle pause/resume, et le listener `resume` d'App.vue relance une synchro MD qui
// lit INTÉGRALEMENT patron.md et patron.json avant même de comparer les hashs —
// mesuré le 06/09 : ~88 s de requêtes SAF pendant que la modale attend le geste.
// La garde isRestoreRunning ne couvre pas cette fenêtre : la restauration n'a pas
// encore commencé. Consommée par patron-md-sync.js (skip 'decision-pending').
let restoreDecisionPending = false

export function isRestoreDecisionPending() {
  return restoreDecisionPending
}

export function beginRestoreDecision() {
  restoreDecisionPending = true
}

export function endRestoreDecision() {
  restoreDecisionPending = false
}

// Drapeau « dossier propre depuis la restauration », MÉMOIRE DE SESSION uniquement.
// Une restauration vient de lire tout le dossier et d'écrire la base à son image :
// l'auto-backup et la synchro MD qui suivent immédiatement relisent et réécrivent
// un contenu identique (mesuré 06/09 : ~255 s de requêtes SAF post-restauration).
// Tant que rien n'a muté localement, ces passages ne peuvent rien apporter.
// EFFACÉ PAR : toute mutation locale (hook dbcore de db.js — la base diverge du
// dossier) et la mise en pause de l'app (auto-trigger.js — borne la cécité aux
// éditions PC faites à l'extérieur à la session foreground ; au retour, la synchro
// du lancement reprend son comportement habituel). Un kill de l'app le perd : un
// passage complet au prochain lancement = le comportement d'avant ce lot.
// PAS dans sauvegarde.json (identité trans-périphérique ≠ état par appareil) ni en
// réglage persistant (un « propre » qui survit au redémarrage mentirait si le PC a
// édité le dossier entre-temps, et ferait sauter la synchro du lancement).
let folderCleanSinceRestore = false

export function isFolderCleanSinceRestore() {
  return folderCleanSinceRestore
}

export function markFolderClean() {
  folderCleanSinceRestore = true
}

export function clearFolderClean() {
  folderCleanSinceRestore = false
}

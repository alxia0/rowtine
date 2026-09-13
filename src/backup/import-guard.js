// Rowtine — garde d'exclusion mutuelle import↔synchro MD. Symétrique à
// `isAutoBackupRunning` (backup-service.js) : le retour au premier plan après
// le sélecteur de fichiers système (App.vue, `resume`) ne doit pas relancer un
// balayage complet de `Patrons/`/`Projets/` pile au moment où un import
// démarre — sur un appareil lent, ce balayage peut prendre plusieurs minutes
// et masque toute progression d'import à l'écran (repro nexus7_2026-08-25).
//
// Portée volontairement large : posée/levée par le cycle de vie de l'écran
// d'import (LocalPdfImportView), pas par chaque opération d'écriture — une
// synchro déjà en cours AVANT l'ouverture de cet écran n'est pas interrompue
// (cf. `isSyncRunning`/`whenSyncIdle`, pas le sujet de cette garde).
let importRunning = false

export function isImportRunning() {
  return importRunning
}

export function beginImport() {
  importRunning = true
}

export function endImport() {
  importRunning = false
}

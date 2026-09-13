// Libellé d'affichage du dossier SAF désigné — le « chemin » montré à
// l'utilisatrice. Site UNIQUE de cette composition (05/09/2026) :
// extraite de SafFolderSection.vue pour que le rapport d'échec de
// l'enregistrement automatique (auto-backup.js → publishAutoBackupFailure)
// désigne le dossier EXACTEMENT comme les Réglages le montrent — deux
// compositions parallèles divergeraient, comme toujours.
//
// Le chemin complet est posé à la désignation dans le réglage `safFolderLabel`
// (OnboardingFolderPrompt.vue) ; repli sur le nom seul (`folderName()`) pour
// toute installation antérieure à l'introduction de ce réglage — aucune
// migration, aucune re-désignation imposée aux appareils déjà configurés.
//
// ⚠️ LIBELLÉ D'AFFICHAGE, JAMAIS UNE CLÉ : l'identité d'un dossier, c'est
// `folderKey()` (l'URI de l'arbre SAF, cf. saf-folder.js). Une comparaison sur
// ce libellé laisserait une décision prise sur un dossier acquitter le suivant —
// le risque documenté dans backup-decision.js.
//
// Ce module importe `@/db/db` de façon STATIQUE : aucun cycle possible (db.js
// n'importe ni ce fichier ni saf-folder.js) — c'est la raison de son existence
// en module propre, alors qu'auto-backup.js (importé par db.js) doit LUI rester
// sans aucune dépendance statique vers la base et résoudre ce chemin par
// import dynamique au moment de la publication.
import { getSetting } from '@/db/db'
import { folderName } from './saf-folder'

// Renvoie le libellé à afficher, ou null si aucun dossier n'est désigné (ou si
// le plugin natif est absent — web/dev). `getSetting` renvoie null pour une clé
// absente, d'où le test de vérité puis le repli explicite.
export async function folderDisplayPath() {
  const label = await getSetting('safFolderLabel')
  if (label) return label
  return (await folderName()) ?? null
}

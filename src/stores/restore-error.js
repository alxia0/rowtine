// Rowtine — dernier incident de restauration à signaler (décision produit
// du 05/09/2026 : « informer l'utilisateur qu'une erreur technique a été
// rencontrée à la restauration et donner un moyen de voir le détail de l'erreur,
// et de copier l'erreur pour la faire remonter »). Alimenté par les DEUX points
// d'entrée d'une restauration — `OnboardingFolderPrompt.onChooseNow` (chemin du
// téléphone neuf, via `maybeRestoreAfterDesignation`) et
// `BackupDecisionPrompt.onRestore` (bandeau de décision) ; consommé par la modale
// singleton `RestoreErrorDialog.vue` montée dans App.vue.
//
// ⚠️ CE STORE N'EST PAS DANS LA FILE DES MESSAGES (notice-queue) : la modale doit
// se peindre PAR-DESSUS la porte du dossier (rang 2) et le bandeau de décision
// (rang 3) au moment où ils se ferment — la file la ferait ATTENDRE son tour,
// donc disparaître derrière eux ou ne jamais s'afficher avant leur retrait. Cf.
// l'en-tête de RestoreErrorDialog.vue.
//
// Forme publiée : { kind, error, path, at, details? } —
//   kind    : 'error' (échec technique) | 'unowned' (restauration réussie mais
//             appropriation du dossier non confirmée — runRestore `owned:false`) ;
//   error   : message technique intégral (peut être null en 'unowned' :
//             `writeManifest` ne dit pas pourquoi il a échoué) ;
//   path    : libellé d'affichage du dossier (peut être null → le rapport dira
//             « (inconnu) », cf. composeBackupFailureReport) ;
//   at      : horodatage ISO du constat ;
//   details : écarts OPTIONNELS consignés par `readBackup` (snapshot `errors`),
//             joints au rapport copiable sans variante visuelle supplémentaire.
//
// Store minimal à UNE seule valeur, écrasée à chaque publication — pas
// d'historique, même parti pris que `backup-failure` : l'utilisatrice copie le
// rapport au moment où elle voit la modale.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useRestoreErrorStore = defineStore('restoreError', () => {
  const report = ref(null)

  function setReport(r) {
    report.value = r
  }

  return { report, setReport }
})

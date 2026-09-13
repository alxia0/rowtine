// Rowtine — dernier échec de l'enregistrement automatique (décision produit
// du 05/09/2026). Alimenté par `publishAutoBackupFailure`
// (src/backup/auto-backup.js) quand `runBackup` rend `{ ok:false, error }` sur
// le chemin AUTOMATIQUE ; consommé par App.vue (watch, même motif que
// `syncReport`) pour annoncer l'échec et offrir « Copier l'erreur ».
//
// Store minimal à UNE seule valeur, écrasée à chaque échec — pas d'historique,
// assumé : l'utilisatrice copie le rapport au moment où elle voit le snackbar ;
// une file d'attente d'échecs n'a aucun consommateur.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useBackupFailureStore = defineStore('backupFailure', () => {
  const failure = ref(null)

  function setFailure(f) {
    failure.value = f
  }

  return { failure, setFailure }
})

// Rowtine — rapport de la dernière synchro MD. Alimenté par
// `runPatronMdSync` (src/backup/run-patron-md-sync.js) après chaque passage de
// `syncPatronMd` ; consommé par la snackbar/modale de rapport pour
// présenter à l'utilisateur ce qui a été repris et ce qui est à refaire. Store
// minimal à un seul champ, écrasé à chaque synchro — pas d'historique conservé.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSyncReportStore = defineStore('syncReport', () => {
  const report = ref(null)

  function setReport(r) {
    report.value = r
  }

  return { report, setReport }
})

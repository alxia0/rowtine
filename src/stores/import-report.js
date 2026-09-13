// Relais transitoire des avertissements d'un import PDF réussi vers la
// fiche patron. Depuis ce lot, la conversion réussie navigue DIRECTEMENT
// sur `pattern` (plus d'écran de revue post-conversion) : ce store est le seul endroit
// où les warnings survivent le temps du saut d'écran, pour être affichés en bandeau
// persistant sur PatternView (jamais en snackbar, qui disparaîtrait seule — cf. règle
// « jamais perdre d'info »).
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useImportReportStore = defineStore('import-report', () => {
  const patternId = ref(null)
  const warnings = ref([])
  // Qualité d'import faible (confidence.global < 50, cf. LocalPdfImportView)
  // transportée au même titre que les warnings, jusqu'au bandeau de PatternView.
  const lowConfidence = ref(false)

  // Appelé par LocalPdfImportView juste avant router.replace vers la fiche.
  function set(id, w, low = false) {
    patternId.value = id
    warnings.value = Array.isArray(w) ? w : []
    lowConfidence.value = !!low
  }

  // Appelé par PatternView au montage. Ne renvoie (et ne vide) le store QUE si l'id
  // correspond au patron affiché — sinon on laisse les warnings en place : ils
  // concernent un autre patron pas encore visité, les vider ici les perdrait pour de
  // bon. Comparaison en chaîne : route.params.id est une chaîne, l'id sauvegardé est
  // un nombre (IndexedDB).
  function consume(id) {
    if (patternId.value == null || String(patternId.value) !== String(id)) return { warnings: [], lowConfidence: false }
    const out = { warnings: warnings.value, lowConfidence: lowConfidence.value }
    patternId.value = null
    warnings.value = []
    lowConfidence.value = false
    return out
  }

  return { patternId, warnings, lowConfidence, set, consume }
})

// LE BLOC DE RÉUSSITE DE L'ÉCRAN D'IMPORT, le temps d'un aller-retour (revue
// du 19/08/2026, important 6, tranché).
//
// Le bouton « Comment corriger » du bloc de réussite ouvre le guide par `router.push` — donc
// l'écran d'import est DÉMONTÉ, et remonté au retour. Ses trois variables d'état (identifiant
// du patron enregistré, nom, nombre d'avertissements) vivaient dans le composant : elles
// mouraient avec lui, et l'écran repartait vierge (« Choisir un fichier »). Aucune donnée
// perdue — le patron est en base — mais l'utilisatrice qui suit le conseil qu'on vient de lui
// donner perdait le fil : plus de nom, plus de phrase d'avertissement, plus de bouton « Voir
// le patron ». Ce relais les fait survivre au détour.
//
// ⚠️ POURQUOI UN MAGASIN À PART, ET PAS `import-report`. Ce dernier survit lui aussi à
// l'aller-retour (mesuré) et porte déjà l'identifiant et les avertissements — mais il est
// DESTRUCTIF À LA LECTURE (`consume`), vidé par la fiche du patron : y adosser l'affichage de
// l'écran d'import coudrait ensemble deux durées de vie qui n'ont aucune raison de coïncider,
// et il ne porte de toute façon pas le nom du patron. Même famille que `import-handoff`, avec
// qui il ne se confond pas : celui-là relaie un FICHIER vers l'écran d'import, celui-ci relaie
// un RÉSULTAT à travers un aller-retour de cet écran.
//
// ⚠️ N'EST POSÉ QUE PAR LE BOUTON « COMMENT CORRIGER » (`howToFix`), qui n'existe qu'à
// l'intérieur du bloc de réussite : il ne peut donc pas être posé sans qu'un patron soit
// réellement en base — la voie scannée, qui n'enregistre rien, n'a jamais ce bouton. Posé là
// plutôt qu'à l'enregistrement, il ne vit que le temps de l'aller-retour qu'il sert, et pas
// toute la session. Effacé en plus dès qu'un nouvel import démarre, à l'abandon, et quand la
// fiche du patron s'ouvre — un bloc de réussite périmé serait un mensonge d'interface.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useImportSuccessStore = defineStore('import-success', () => {
  const patternId = ref(null)
  const name = ref('')
  const warnCount = ref(0)
  // Bilan (sections/étapes/tailles/diagrammes) et « prévisualisable » (cf.
  // LocalPdfImportView.vue, summarizeImportedPattern) : le bloc de réussite (lot du
  // 23/09/2026) en a besoin pour se reconstruire à l'identique au retour du guide,
  // exactement comme name/warnCount ci-dessus. `previewable` par défaut à `true` : c'est
  // le cas le plus courant (un import
  // qui a des sections), et un `set()` toujours appelé avec ce 5e argument explicite (seul
  // site d'appel, howToFix) ne laisse de toute façon jamais ce défaut jouer en pratique.
  const summary = ref(null)
  const previewable = ref(true)

  function set(id, patternName, count, patternSummary, patternPreviewable) {
    patternId.value = id
    name.value = patternName || ''
    warnCount.value = Number.isFinite(count) ? count : 0
    summary.value = patternSummary || null
    previewable.value = patternPreviewable !== false
  }

  function clear() {
    patternId.value = null
    name.value = ''
    warnCount.value = 0
    summary.value = null
    previewable.value = true
  }

  return { patternId, name, warnCount, summary, previewable, set, clear }
})

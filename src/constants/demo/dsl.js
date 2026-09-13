// Mini-DSL de construction des étapes de patron, partagé par les quatre fichiers de
// démonstration (fr/en/de/es). Code logique pur — aucune chaîne affichée, aucune clé de
// données spécifique à une langue — donc factorisable sans enfreindre la règle « un
// libellé affiché ne sert jamais de clé de données ».
export const c = (...v) => v
export const ROW = (t, ...cs) => ({ t, c: cs })
export const NOTE = (t, ...cs) => ({ t, c: cs, note: true })
export const REP = (t, total, ...cs) => ({ t, total, c: [total, ...cs], repeat: true })
export const CHART = { chart: true }

// Compteur de répétitions qui parcourt un diagramme JUSQU'AU BOUT (un tour = un rang du
// diagramme). Marqué explicitement `chartRounds: true`, plutôt que laissé comme un `REP`
// générique dont le total serait recopié à la main : `total` est DÉRIVÉ de `chart.rows`
// (jamais un doublon écrit séparément), et le marqueur permet à
// tests/unit/demo-content.spec.js de vérifier structurellement — sans dépendre du texte
// FR/EN/DE/ES de l'étape — que ce total reste calé sur le nombre de rangs du diagramme.
export const chartRounds = (t, chart, nSizes) => {
  const total = Array(nSizes).fill(chart.rows)
  return { t, total, c: [total], repeat: true, chartRounds: true }
}

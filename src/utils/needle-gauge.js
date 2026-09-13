// Recommande une taille d'aiguilles/crochet de départ pour retrouver l'échantillon
// visé par un patron avec une laine différente de celle recommandée. Règle de trois
// standard du tricot (le résultat met à l'échelle la paire aiguille/mailles de
// l'étiquette au rapport de mailles visé) : c'est un point de départ, jamais une
// garantie — l'appelant doit toujours inviter à vérifier avec un vrai échantillon.

// Tailles standards en mm, triées croissant.
// Tricot : barème courant des aiguilles circulaires/droites metric (2 → 20mm).
// Crochet : barème US lettré → mm du Craft Yarn Council (B-1=2,25 … S=19), vérifié
// le 21/07/2026 (recherche web, 2 sources indépendantes) — PAS une simple redite du
// barème tricot : contrairement à ce qu'on pourrait supposer, le crochet A BIEN des
// paliers à 3,25/3,75 (D-3/F-5) ; en revanche il n'a PAS de crochet à 2/2,5/3/7mm pile
// (le barème saute de 2,75 à 3,25, par ex.), là où le tricot les a.
export const NEEDLE_SIZES_MM = {
  knitting: [2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8, 9, 10, 12, 15, 20],
  crochet: [2.25, 2.75, 3.25, 3.5, 3.75, 4, 4.5, 5, 5.5, 6, 6.5, 8, 9, 10, 12, 15, 19],
}

// Tolérance en-deçà de laquelle l'échantillon de l'étiquette est considéré comme déjà
// conforme à celui visé (pas besoin de changer de taille).
const SAME_GAUGE_TOLERANCE = 0.02

function nearestSize(value, sizes) {
  return sizes.reduce((best, s) => (Math.abs(s - value) < Math.abs(best - value) ? s : best), sizes[0])
}

// labelNeedleMm/labelStitches/targetStitches : requis, nombres > 0.
// labelRows/targetRows : optionnels — note informative uniquement, jamais utilisés pour
// calculer la taille recommandée (le rapport aiguille/rangs varie trop selon la laine
// pour être fiable).
// Renvoie null si un champ requis est manquant/invalide.
export function recommendNeedle({ technique, labelNeedleMm, labelStitches, targetStitches, labelRows, targetRows }) {
  const sizes = NEEDLE_SIZES_MM[technique] || NEEDLE_SIZES_MM.knitting
  const needleMm = Number(labelNeedleMm)
  const lSt = Number(labelStitches)
  const tSt = Number(targetStitches)
  if (!needleMm || !lSt || !tSt || needleMm <= 0 || lSt <= 0 || tSt <= 0) return null

  const ratio = lSt / tSt
  const rawMm = needleMm * ratio
  const sameGauge = Math.abs(lSt - tSt) / tSt <= SAME_GAUGE_TOLERANCE
  const outOfRange = rawMm < sizes[0] || rawMm > sizes[sizes.length - 1]
  const recommendedMm = nearestSize(rawMm, sizes)
  const direction = recommendedMm > needleMm ? 'bigger' : recommendedMm < needleMm ? 'smaller' : 'same'

  let rowNote = null
  const lRo = Number(labelRows)
  const tRo = Number(targetRows)
  if (lRo > 0 && tRo > 0 && !sameGauge) {
    const rowRatio = lRo / tRo
    const stitchSign = Math.sign(ratio - 1)
    const rowSign = Math.sign(rowRatio - 1)
    if (stitchSign !== 0 && rowSign !== 0 && stitchSign !== rowSign) rowNote = 'diverges'
  }

  return { recommendedMm, rawMm, direction, sameGauge, outOfRange, rowNote }
}

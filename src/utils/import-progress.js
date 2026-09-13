// Progression d'import PDF — calcul PUR du pourcentage global (aucune dépendance
// Vue/DOM). Deux profils : local (boucles de pages → fraction réelle) et zip
// (dézip en mémoire, quasi instantané). La vue possède l'horloge et appelle
// ces fonctions ; ici, que des maths.

// Bandes de phase [lo, hi] en % global + clé i18n du libellé.
export const LOCAL_PHASES = [
  { key: 'extract', lo: 0, hi: 40, labelKey: 'import.phase.extract' },
  { key: 'parse', lo: 40, hi: 50, labelKey: 'import.phase.parse' },
  { key: 'images', lo: 50, hi: 92, labelKey: 'import.phase.images' },
  { key: 'assemble', lo: 92, hi: 98, labelKey: 'import.phase.assemble' },
  { key: 'done', lo: 100, hi: 100, labelKey: 'import.phase.done' },
]

// Import .zip : tout est en mémoire (dézip synchrone) donc quasi instantané. Bandes
// courtes, juste pour ne pas afficher une barre figée.
export const ZIP_PHASES = [
  { key: 'read', lo: 0, hi: 30, labelKey: 'importZip.phase.read' },
  { key: 'images', lo: 30, hi: 90, labelKey: 'importZip.phase.images' },
  { key: 'done', lo: 100, hi: 100, labelKey: 'importZip.phase.done' },
]

export function phaseByKey(phases, key) {
  return phases.find((p) => p.key === key) || null
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

// Progression asymptotique dans une bande : approche `hi` sans jamais l'atteindre
// (décélère avec le temps). Pour une phase opaque dont on ne connaît pas la fin.
export function easedPct(lo, hi, elapsedSec, tau) {
  const t = Math.max(0, elapsedSec || 0)
  const k = tau > 0 ? tau : 30
  // Facteur plafonné à 0.99 : la barre approche `hi` sans jamais l'atteindre,
  // même quand exp() sous-déborde à 0 pour un temps très long.
  const frac = Math.min(0.99, 1 - Math.exp(-t / k))
  return lo + (hi - lo) * frac
}

// Progression réelle dans une bande : fraction done/total (bornée). total<=0 → lo.
export function fracPct(lo, hi, done, total) {
  if (!total || total <= 0) return lo
  return lo + (hi - lo) * clamp(done / total, 0, 1)
}

// Durée typique estimée (s) d'un import, d'après le poids du fichier (utilisée
// en repli asymptotique pour les phases sans total connu, ex. local 'parse').
export function estimateTau(fileSize) {
  const mo = (Number(fileSize) || 0) / (1024 * 1024)
  return clamp(30 + mo * 15, 30, 120)
}

// État courant → { pct, labelKey }. Fraction réelle si total connu, sinon easing.
// La monotonie (ne jamais reculer) est gérée par l'appelant (composable).
export function computeProgress(phases, phaseKey, phaseElapsedSec, page, total, tau) {
  const ph = phaseByKey(phases, phaseKey)
  if (!ph) return { pct: 0, labelKey: '' }
  const pct = total > 0 ? fracPct(ph.lo, ph.hi, page, total) : easedPct(ph.lo, ph.hi, phaseElapsedSec, tau)
  return { pct, labelKey: ph.labelKey }
}

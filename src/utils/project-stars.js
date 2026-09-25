// Note d'un projet en étoiles : entier 0..5. La valeur peut venir d'un projet.json restauré
// et retouché ; elle pilote un `v-for` (un nombre énorme gèle l'écran, un non-entier lève).
// Imports relatifs uniquement : chargé par src/backup/deserialize.js.
export const MAX_STARS = 5

export function clampStars(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 0
  return Math.min(MAX_STARS, Math.max(0, n))
}

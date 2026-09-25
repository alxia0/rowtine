// Borne un index de couverture dans [0, length) : repli sur 0 si absent, non entier ou
// hors bornes (jamais d'exception, jamais de vignette qui disparaît pour un index invalide).
// Partagé par `patternCoverIndexOf` (pattern-cover.js) et `coverPhotoOf` (yarn-photos.js) —
// même motif « index de couverture », deux domaines différents (patron / laine).
export function boundedIndex(idx, length) {
  const n = Number(idx)
  return Number.isInteger(n) && n >= 0 && n < length ? n : 0
}

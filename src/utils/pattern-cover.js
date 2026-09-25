import { boundedIndex } from './bounded-index'

// Couverture affichée d'un patron (vignette bibliothèque, couverture de la fiche projet
// liée) : d'abord `pattern.photos[0]` (couverture PDF importée par `pdf-import/index.js`,
// jamais éditée depuis PatternForm.vue), puis repli sur `pattern.gallery[coverIndex]`
// — depuis la fusion Photos/Galerie du 22/09/2026, un patron créé manuellement ne peuple
// plus que `gallery`, jamais `photos`, et doit quand même obtenir une vignette. `coverIndex`
// absent ou hors bornes retombe sur `gallery[0]`, comme avant l'ajout du choix explicite de
// couverture. Même motif que `photosOf`/`coverPhotoOf` (src/utils/yarn-photos.js). N'affecte
// PAS le comportement « tap sur la couverture réouvre le PDF » (PatternView.vue,
// ProjectDetailView.vue), qui reste ancré spécifiquement sur `pattern.photos[0]` +
// `pattern.pdf` — une image de galerie n'a jamais ouvert de PDF.
// Index de couverture borné de `pattern.gallery` : repli sur 0 si `coverIndex` est
// absent, NaN ou hors bornes (gallery vide → 0, sans signification tant qu'elle
// reste vide). Utilisé à la fois par `patternCoverOf` (vignette) et par
// PatternView.vue (badge « Couverture » dans PatternGallery.vue) — les deux doivent
// retomber sur la MÊME image quand `coverIndex` est corrompu, sinon la vignette
// affiche gallery[0] pendant qu'aucune étoile ne porte le badge.
export function patternCoverIndexOf(pattern) {
  const gallery = pattern?.gallery || []
  if (!gallery.length) return 0
  return boundedIndex(pattern?.coverIndex, gallery.length)
}

export function patternCoverOf(pattern) {
  if (pattern?.photos?.[0]) return pattern.photos[0]
  const gallery = pattern?.gallery || []
  if (!gallery.length) return ''
  return gallery[patternCoverIndexOf(pattern)]?.src || ''
}

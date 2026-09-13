// `behavior` à passer aux défilements pilotés en JavaScript (`scrollIntoView`, `scrollTo`,
// `scrollBy`), en respectant le réglage système « réduire les animations ».
//
// LE PIÈGE, MESURÉ ET CORRIGÉ DEUX FOIS DANS CE PROJET AVANT CETTE EXTRACTION :
// `tokens.css` impose bien `scroll-behavior: auto !important` sous
// `@media (prefers-reduced-motion: reduce)`, et on croit alors la question réglée. Elle ne
// l'est pas : cette règle CSS ne gouverne QUE le défilement laissé au navigateur. Un
// `behavior: 'smooth'` passé en ARGUMENT à `scrollIntoView`/`scrollTo` l'emporte sur elle
// et anime quand même (mesuré le 30/07 : le défilement restait animé, préférence active).
// La préférence doit donc être lue nous-mêmes, ici, à chaque appel.
//
// Extrait le 21/08/2026 (revue finale du lot `correction-ux`) des TROIS endroits qui en
// avaient besoin : keyboard-avoidance.js et BackToTop.vue, qui en portaient chacun une
// copie assumée, et `toggleCharts` (CorrectionView.vue), premier site à se tromper — le
// dépli de la bande « Diagrammes de ce patron » animait son rattrapage de scroll même sous
// la préférence. Deux copies se justifiaient encore ; trois disaient qu'il fallait un
// module. Le code et sa justification sont inchangés, seul l'emplacement bouge (même
// mouvement, et pour la même raison, que sticky-top.js le 19/08).
//
// La VALEUR de ce fichier est le paragraphe ci-dessus, pas la fonction, qui tient en une
// ligne : c'est le piège qui doit voyager avec les appelants, sans quoi un quatrième site
// écrira `behavior: 'smooth'` en dur et le paiera une troisième fois.
//
// Repli sur `'smooth'` si `matchMedia` manque (environnements de test) : c'est le
// comportement historique, et l'absence de `matchMedia` ne dit rien de la préférence.
export function scrollBehavior() {
  const mm = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia : null
  if (!mm) return 'smooth'
  const mq = mm.call(window, '(prefers-reduced-motion: reduce)')
  return mq && mq.matches ? 'auto' : 'smooth'
}

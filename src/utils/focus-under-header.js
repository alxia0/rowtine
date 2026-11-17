// Un élément pris AU CLAVIER ne doit pas finir caché sous l'en-tête collant (WCAG 2.4.11,
// focus non masqué). Lot « stock d'outils, suites », 14/11/2026.
//
// LE DÉFAUT, MESURÉ (e2e « focus clavier sous l'en-tête collant », tests/e2e/tools.spec.js) :
// au focus, Chromium ne fait défiler qu'une cible ENTIÈREMENT hors de la fenêtre, et la
// recentre alors (aucun masquage possible dans ce cas). Une cible PARTIELLEMENT visible, dont
// le haut tombe dans la bande occupée par AppHeader, est jugée « visible » et laissée en
// place : elle reste dessous. Exemple sans souris : Maj+Tab depuis « Marque » sur la fiche
// d'un outil, la liste « Matière » finissait à y = 37, l'en-tête descendant jusqu'à 76.
//
// Partage du travail avec l'évitement du clavier (src/utils/keyboard-avoidance.js) : les
// champs texte (`isTextField`) restent à lui, qui les cale déjà sous les bandeaux par un
// `scroll-margin-top`. Ici, TOUT LE RESTE (case, liste, bouton…), et seulement pour un focus
// clavier (`:focus-visible`) : un toucher amène l'élément sous le doigt, donc déjà visible,
// et le faire défiler sous le doigt serait déroutant.
//
// PAS de `scroll-padding-top` global, solution CSS en apparence plus simple : il
// s'ajouterait au `scroll-margin-top` de l'évitement du clavier, et le décalage serait compté
// deux fois pour chaque champ texte.
//
// UNE frame (`requestAnimationFrame`) avant de mesurer : Blink émet `focusin` AVANT son
// propre défilement de mise au point. Mesurer tout de suite, pour une cible hors fenêtre,
// lancerait un `scrollBy` doux que le recentrage du navigateur viendrait ensuite contrarier.
// Une frame plus tard, la cible est à sa place définitive, et on ne corrige que ce qui reste
// sous l'en-tête. La hauteur des bandeaux est mesurée à chaque fois (cf. sticky-top.js, qui
// explique pourquoi une valeur figée a déjà échoué).
import { measureStickyTopHeight, RESPIRATION_SOUS_BANDEAUX } from '@/utils/sticky-top'
import { scrollBehavior } from '@/utils/scroll-behavior'
import { findScrollContainer, isDocumentContainer, isTextField } from '@/utils/keyboard-avoidance'

function isKeyboardFocus(el) {
  // `:focus-visible` inconnu d'un vieux moteur : `matches` LÈVE. Un écouteur global qui lève
  // à chaque focus serait pire que l'absence de correctif : on s'abstient.
  try {
    return el.matches(':focus-visible')
  } catch {
    return false
  }
}

// La cible est-elle ÉPINGLÉE, elle ou un de ses ancêtres en `position: sticky` ou `fixed` ?
// (Fix round 1 de la revue.) Un contrôle DANS un bandeau collant (bouton retour et menu
// d'AppHeader, `.rte__bar` de l'écran de correction) a par construction un haut inférieur à la
// hauteur des bandeaux, sans être recouvert pour autant : c'est lui, le bandeau. Sans ce garde,
// chaque Tab sur un bouton de l'en-tête remontait la page (mesuré : 600 -> 524). Même chose
// pour une surcouche fixe (ConfirmDialog, ChartFullscreen, PhotoLightbox, ReaderTour…) : elle
// passe AU-DESSUS de l'en-tête, son bouton « Fermer » en haut n'est caché par rien.
//
// Pourquoi pas `document.elementFromPoint` (« la cible est-elle réellement recouverte ? »),
// plus général : jsdom ne l'implémente pas, le garde serait alors invérifiable en unitaire ;
// et il répond mal pour une case maison, dont l'input de 1 px est clippé (le point touché
// est la case affichée, jamais l'input). Le cas qu'il couvrirait en plus, un élément ordinaire
// de la page recouvert par autre chose qu'un bandeau collant, n'a pas été rencontré.
function isPinned(el) {
  for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
    const position = getComputedStyle(node).position
    if (position === 'sticky' || position === 'fixed') return true
  }
  return false
}

// Haut de ce que l'on VOIT de la cible. Pour une case maison (AppCheckbox), l'élément qui a le
// focus est un `<input>` masqué de 1 px, centré dans son `<label>` de 44 px : son haut est à
// ~22 px sous celui de la case affichée. Mesurée seule, il laissait la pastille du kit à
// -6,5 px sous l'en-tête une fois le défilement fait (mesuré, e2e du kit). On prend donc le
// plus haut des deux quand un `<label>` ENVELOPPE la cible. Pas `el.labels[0]` : pour une
// liste, il désigne l'étiquette sœur `<label for>` posée AU-DESSUS, qu'il n'y a pas lieu de
// dégager ici (elle n'a pas le focus et n'en montre pas l'anneau).
function visibleTop(el) {
  const top = el.getBoundingClientRect().top
  const label = el.closest('label')
  return label ? Math.min(top, label.getBoundingClientRect().top) : top
}

function bringBelowHeader(el) {
  if (document.activeElement !== el) return
  if (isPinned(el)) return
  const top = visibleTop(el)
  const headerH = measureStickyTopHeight()
  if (top >= headerH) return
  const delta = top - headerH - RESPIRATION_SOUS_BANDEAUX
  const container = findScrollContainer(el)
  const target = isDocumentContainer(container) ? window : container
  target.scrollBy({ top: delta, behavior: scrollBehavior() })
}

function onFocusIn(e) {
  const el = e.target
  if (!(el instanceof HTMLElement) || isTextField(el)) return
  if (!isKeyboardFocus(el)) return
  requestAnimationFrame(() => bringBelowHeader(el))
}

export function installFocusUnderHeader() {
  document.addEventListener('focusin', onFocusIn)
  return () => document.removeEventListener('focusin', onFocusIn)
}

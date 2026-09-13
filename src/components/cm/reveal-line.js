// revealLine — pose le curseur au début d'une ligne et fait défiler jusqu'à
// elle. Extraite en module pur, comme moveLineUp/moveLineDown (move-line.js) :
// `<script setup>` n'exporte pas ses fonctions locales, or ce comportement CM6
// réel doit pouvoir être prouvé unitairement, y compris sur une ligne image
// (plage atomique posée par maskAtomicRanges, cm-editor.js — la cible est prise
// par POSITION via `doc.line(n)`, jamais par une commande de curseur soumise
// aux plages atomiques, donc rien ne la bloque).
//
// ⚠️ AUCUN `view.focus()` : l'écran de correction s'ouvre en mode enrichi,
// clavier virtuel FERMÉ (cf. `setKeyboard`, cm-editor.js). Prendre le focus ici
// ouvrirait le clavier à l'arrivée, alors que la tricoteuse veut d'abord LIRE la
// ligne qu'elle vient de désigner.
import { EditorView } from '@codemirror/view'
import { StateEffect } from '@codemirror/state'

// `true` si la ligne existe et que le curseur y a été posé ; `false` sinon —
// aucun effet, aucune exception : c'est un confort d'ouverture, jamais une
// promesse.
//
// `occlusion` — (retour terrain du 2026-08-23) : `{ top,
// bottom }`, deux fonctions SANS argument qui renvoient chacune, en pixels, la
// hauteur RÉELLEMENT occultée en haut (AppHeader + `.rte__bar` empilés — cf.
// `measureStickyTopHeight()`, `src/utils/sticky-top.js`) et en bas
// (`.correct__actions`, mesuré en continu par ReaderTextEditor.vue). Des
// FONCTIONS, jamais des nombres déjà lus par l'appelant : cf. le second ⚠️
// ci-dessous pour la raison (la mesure doit être prise au moment où CM6
// l'utilise, pas au moment de cet appel).
//
// ⚠️ Pourquoi `y: 'center'` NE CENTRE PAS dans l'écran réellement visible (bug
// d'origine de cette tâche, diagnostiqué en lisant `scrollRectIntoView`,
// `node_modules/@codemirror/view/dist/index.js`) : cette fonction remonte les
// `parentNode` de `.cm-scroller` à la recherche d'un ancêtre qui défile
// RÉELLEMENT ou qui est `position: fixed|sticky`. Or `.cm-scroller` n'a aucune
// hauteur propre (il épouse son contenu, cf. keyboard-avoidance.js:241-244) et
// les bandeaux collants de l'écran (AppHeader, `.rte__bar`, `.correct__actions`)
// sont des FRÈRES/COUSINS de `.cm-scroller` dans le DOM, jamais des ANCÊTRES —
// la remontée ne les traverse donc jamais et atteint `document.body`, où CM6
// prend `bounding = { top: 0, bottom: window.innerHeight }` — LA FENÊTRE
// ENTIÈRE, sans aucune notion des bandeaux qui en occultent visuellement le
// haut et le bas. `y: 'center'` centre donc la ligne au milieu de
// `window.innerHeight` complet, ce qui — une fois retirée la bande occultée —
// tombe hors du centre réel de la zone effectivement lisible.
//
// Correctif retenu — ni l'option (a) ni l'option (b), une troisième
// trouvée en vérifiant les deux à la main (calcul détaillé ci-dessous) :
// `EditorView.scrollMargins`, le facet PUBLIC que CM6 fournit précisément pour
// ce cas (« chrome permanent qui occulte le scroller »). Une source de ce
// facet est une FONCTION `(view) => { top, bottom, left, right }` — appelée
// par CM6 lui-même DURANT sa propre passe de mesure (`scrollRectIntoView`
// inflate le rectangle visé de `top`/`bottom` AVANT de calculer le centrage),
// jamais par nous.
// ⚠️ Relecture : « appelée par CM6 » ne veut PAS dire
// « appelée de façon synchrone ». Vérifié dans `EditorView.prototype.measure`
// (@codemirror/view/dist/index.js:~8206-8208) : `this.viewState.scrollTarget`
// (posé par NOTRE `EditorView.scrollIntoView` ci-dessous) n'est consommé —
// donc `getScrollMargins`/nos deux fonctions ne sont appelées — qu'à la
// PREMIÈRE PASSE DE MESURE qui suit ce `dispatch`, remise à `null` aussitôt
// après. Cette passe est TOUJOURS programmée en `requestAnimationFrame`
// (`requestMeasure`, jamais synchrone) — donc UNE frame après ce `dispatch`,
// jamais pendant. C'est ce décalage, pas une synchronicité qui n'existe pas,
// qui rend la valeur fiable : la mise en page a eu le temps de se stabiliser
// avant que nos fonctions soient invoquées, contrairement à un appel fait ICI
// (cf. option (a) plus bas). Mesuré (Playwright réel, la ligne visée du test
// e2e `tests/e2e/reader-fix-line.spec.js`) : écart résultant de l'ordre de
// 2px entre le centre obtenu et le centre visé — pas les ~20px qu'une lecture
// encore périmée à ce moment-là aurait produits.
//
// Deux options écartées après les avoir chiffrées :
// — (a) `y: 'start'` + `yMargin` calculé à la main avec `view.defaultLineHeight` :
//   mesuré en Playwright réel (pas jsdom) sur l'écran de correction fraîchement
//   monté — `view.defaultLineHeight` valait encore 14 (défaut CM6 NON
//   rafraîchi ; la vraie valeur, ~28px pour 16px/1.75 d'interligne, ne l'est
//   qu'après la PROPRE passe de mesure de CM6, différée comme la nôtre). Une
//   mesure prise trop tôt aurait fait dériver le calcul de plusieurs dizaines
//   de pixels — exactement le genre d'erreur que ce correctif doit éviter.
// — (b) laisser `y: 'center'` centrer sur la fenêtre entière puis appliquer un
//   `window.scrollBy` correctif : dépend de l'ORDRE entre le scroll interne de
//   CM6 (déclenché dans `view.dispatch`, mais réellement appliqué dans sa
//   passe de mesure, `requestAnimationFrame` — jamais synchrone, vérifié en
//   lisant `EditorView.prototype.measure`/`requestMeasure`) et notre propre
//   `scrollBy` — un ordre non garanti par l'API publique.
// `EditorView.scrollMargins` élimine les deux problèmes à la fois : la mesure
// est prise AU BON MOMENT (par construction, c'est CM6 qui décide quand) et le
// calcul reste un SEUL scroll (`y: 'center'` inchangé), sans course.
//
// Calcul (branche `center` de `scrollRectIntoView`, relevé dans le code
// source) : le rectangle visé est d'abord ÉLARGI par les marges — `top: rect.top
// - A, bottom: rect.bottom + B` (A/B = nos deux fonctions, h = hauteur RÉELLE
// de la ligne, rect.bottom - rect.top). CM6 centre alors ce rectangle ÉLARGI
// (hauteur h+A+B) sur la fenêtre (hauteur H) :
//   nouveauHautÉlargi = H/2 − (h+A+B)/2
// Le haut de la ligne D'ORIGINE (non élargie) est A plus bas que ce haut
// élargi (l'élargissement avait grandi vers le HAUT de A) :
//   nouveauHautLigne = nouveauHautÉlargi + A = H/2 − h/2 − A/2 − B/2 + A
// Le CENTRE de la ligne d'origine s'obtient en rajoutant sa propre moitié de
// hauteur, h/2 :
//   nouveauCentre = nouveauHautLigne + h/2 = H/2 + A/2 − B/2 = H/2 + (A−B)/2
// — les deux `h/2` (celui de l'élargissement, celui du recentrage sur la
// ligne d'origine) s'annulent EXACTEMENT, quelle que soit la valeur de h.
// Avec A = hauteur occultée du haut et B = hauteur occultée du bas, ce résultat
// est exactement le centre de la zone RÉELLEMENT visible —
// `(window.innerHeight + A − B) / 2` — sans jamais avoir eu besoin de
// connaître la hauteur de la ligne, approximée ou non.
//
// `StateEffect.appendConfig` (pas un `Compartment`, jamais préexistant dans
// `cm-editor.js`) : ajoute ce facet à la configuration de l'éditeur EN UNE
// FOIS, dans la MÊME transaction que le scroll qu'il doit corriger — la
// nouvelle configuration est déjà active dans `view.state` en sortie de
// `view.dispatch` (vérifié en lisant `Configuration.applyTransaction`,
// `@codemirror/state` : le traitement de `appendConfig` est synchrone), donc
// disponible dès la toute première passe de mesure qui suit, y compris celle
// qui applique CE scroll. Rappel ANCIEN existant à ce sujet (déjà écarté une
// fois, ne pas réintroduire) : `yMargin: 48` fixe — codé en dur, jamais
// recalculé (historique git de ce fichier, commits a1d313b4/1d5b68b5). Ici la
// fonction elle-même est fixée à la vie de l'éditeur, mais ce qu'elle RENVOIE
// ne l'est PAS figé DE CE CÔTÉ-CI : ce module se contente d'appeler
// `occlusion.top()`/`occlusion.bottom()` à CHAQUE fois que CM6 les appelle,
// jamais en cache lui-même — c'est un module pur, sans opinion sur la
// fraîcheur. L'appelant (ReaderTextEditor.vue, cf. son commentaire) est libre
// de mémoïser ce que CES fonctions renvoient, tant qu'elles restent
// APPELABLES : `.rte__bar`/`.correct__actions` varient (police
// d'accessibilité, mode compact 1/2 lignes, zone de sécurité, hauteur réduite
// par un correctif antérieur), mais le coût de LEUR mesure (`measureStickyTopHeight()`
// parcourt tout le DOM) n'a pas à être repayé à chaque frappe — cf. le
// commentaire de `revealLine()` dans ReaderTextEditor.vue pour le compromis
// retenu.
//
// ⚠️ Cas limite documenté, non couvert : si `A + B` (les deux marges) dépasse
// la hauteur de la fenêtre — police d'accessibilité poussée à son maximum EN
// PLUS d'un écran très bas (paysage court) — `scrollRectIntoView` sort de la
// branche « center » (sa condition est `rectHeight <= boundingHeight`, cf.
// calcul plus haut) et retombe sur un alignement par le haut/bas ordinaire.
// Dégradation ACCEPTABLE (la ligne reste amenée à l'écran, simplement plus
// centrée) mais jamais vérifiée sur ce viewport précis — aucun test ne le
// couvre.
export function revealLine(view, lineNumber, occlusion = {}) {
  if (!view) return false
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return false
  if (lineNumber > view.state.doc.lines) return false
  const line = view.state.doc.line(lineNumber)
  // Garde de type (pas seulement `|| (() => 0)`, qui laisserait passer un
  // NOMBRE déjà lu par un futur appelant sans jamais s'en plaindre) :
  // `getScrollMargins` (@codemirror/view) n'a pas de try/catch autour de
  // l'appel de la source, contrairement à `scrollHandler` — un appelant qui
  // passerait un nombre au lieu d'une fonction ferait lever une `TypeError`
  // à l'INTÉRIEUR de la passe de mesure de CM6, loin de son propre appel.
  const getTop = typeof occlusion.top === 'function' ? occlusion.top : () => 0
  const getBottom = typeof occlusion.bottom === 'function' ? occlusion.bottom : () => 0
  const marginSource = EditorView.scrollMargins.of(() => ({ top: getTop(), bottom: getBottom() }))
  view.dispatch({
    selection: { anchor: line.from },
    effects: [
      StateEffect.appendConfig.of(marginSource),
      EditorView.scrollIntoView(line.from, { y: 'center' }),
    ],
  })
  return true
}

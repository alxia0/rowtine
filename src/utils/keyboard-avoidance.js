// Le clavier virtuel Android ne redimensionne JAMAIS la WebView ici
// (windowSoftInputMode="adjustNothing", AndroidManifest.xml, posé le 16/07 pour un
// autre bug — WebView effondrée à 133 points sur le Huawei Mate 20 Pro). Remesuré le
// 29/07 sur la Nexus 7 (WebView pilotée en direct) : la hauteur de la fenêtre ET
// `visualViewport.height` restent TOUTES LES DEUX à 944 clavier ouvert (le clavier
// masque ≈410 points de bas SANS jamais rétrécir la fenêtre). Deux correctifs basés sur
// `visualViewport.resize` avaient déjà échoué sur device (retours d'usage, 21/07,
// cf. historique git de NeedleGaugeView.vue et ColorPickerDialog.vue) : `@capacitor/
// keyboard` tire sa hauteur des mêmes insets natifs — la partie cassée. **Ce correctif
// n'a besoin d'AUCUN signal côté clavier** : la fenêtre ne rétrécissant jamais, il
// suffit d'amener le champ actif en HAUT de la fenêtre, où il reste au-dessus du
// clavier quelle que soit sa hauteur réelle (un clavier Android ne dépasse jamais
// ~55% de la hauteur d'écran).
//
// Mécanisme UNIQUE et global (généralisé le 29/07 : remplace les copies par écran de
// NeedleGaugeView.vue::onFieldFocus et ColorPickerDialog.vue::onHexFocus, qui
// feraient désormais double emploi avec celui-ci — deux défilements concurrents
// produiraient un tremblement visible). Un seul écouteur `focusin`/`focusout` posé sur
// `document` (jamais un par écran) : il attrape aussi les champs rendus plus tard dans
// un `v-if`, qu'un gestionnaire d'écran manquerait.
//
// Au focus d'un champ de saisie :
// 1. le conteneur défilant le plus proche reçoit une marge basse généreuse (45vh — le
//    pire cas est le dernier champ d'un écran : une fois défilé au maximum, il doit
//    encore pouvoir passer au-dessus d'un clavier occupant jusqu'à 55% de la fenêtre) ;
// 2. UNE frame (`requestAnimationFrame`) avant de mesurer/défiler : la marge tout
//    juste posée doit être prise en compte par la mise en page avant qu'on ne mesure
//    la place disponible, sinon le défilement peut plafonner trop court (le symptôme
//    même que ce correctif corrige). PAS un `setTimeout(300)` comme dans les deux
//    copies retirées : ce délai-là datait de l'ère `visualViewport.resize`, où il
//    attendait une mesure de clavier qu'on n'utilise plus ici. La mise en page ne
//    bouge jamais à l'ouverture du clavier (adjustNothing) : rien ne justifie
//    d'attendre le clavier lui-même, une frame suffit.
// 3. la hauteur RÉELLE de l'empilement de bandeaux collants (AppHeader ; sur l'écran de
//    correction de patron, `.rte__bar` s'y ajoute — un seul bandeau depuis la fusion
//    des flèches/« Modifier le texte » et de la barre
//    de requalification qui étaient auparavant deux bandeaux séparés) est
//    mesurée et posée en `scroll-margin-top` (+8px) — SEULEMENT quand le conteneur
//    défilant est le document (une carte de dialogue n'a pas de bandeau collant à
//    dégager, cf. `isDocumentContainer`). Une valeur figée en dur (76, la hauteur
//    supposée d'un SEUL bandeau) avait déjà sous-estimé le bandeau réel et laissé le
//    haut des champs masqué dessous (retour d'usage du 22/07) — la relecture du 29/07 a
//    confirmé qu'une constante reste fausse dès qu'un 2e écran empile plusieurs
//    bandeaux : `measureStickyTopHeight` les DÉCOUVRE au lieu de les nommer (§ plus
//    bas), pour rester correcte sur n'importe quel écran, présent ou futur. Depuis le
//    31/08/2026, cette mesure est PLANCHÉE sur l'inset de zone sûre du haut (--sa-top,
//    cf. sticky-top.js) : un écran sans bandeau collant — l'onboarding, seule vue sans
//    en-tête — doit quand même dégager la barre d'état, sinon le champ actif passe
//    derrière l'horloge (retour du 31/08/2026, capture à l'appui).
// 4. `target.scrollIntoView({ block: 'start', behavior })` — `behavior` VAUT `'smooth'`,
//    sauf sous « réduire les animations » où il vaut `'auto'` (cf. `scrollBehavior`,
//    src/utils/scroll-behavior.js : `tokens.css` impose bien `scroll-behavior: auto
//    !important` dans ce cas, mais cette règle CSS ne gouverne PAS un `behavior` passé en
//    argument JavaScript).
//
// Au `focusout`, la marge basse et le `scroll-margin-top` posés à l'étape 1/3 sont
// retirés — sinon 45vh de vide traînerait sous chaque écran au repos, et le
// scroll-margin-top survivrait au champ. Retirés du conteneur/champ MÉMORISÉS, pas
// d'après l'identité de la cible de l'évènement — ⚠️ PAS pour la raison écrite ici
// jusqu'au 30/07 (« un champ démonté pendant qu'il a le focus ne redéclenche jamais son
// propre `focusout` ») : c'est FAUX, mesuré en Blink, `blur` ET `focusout` sont bien
// émis à la suppression du nœud focalisé. La vraie raison de mémoriser : au moment du
// retrait, le champ et son conteneur peuvent avoir été démontés ou déplacés (la cible
// de l'évènement ne mène alors plus au conteneur qui porte réellement la marge), et le
// retrait peut de toute façon être DIFFÉRÉ (cf. plus bas) jusqu'après un `focusin` sur
// un autre élément — l'identité de la cible de l'évènement n'est plus disponible à ce
// moment-là. Mémoriser reste donc correct ; seule la justification était fausse.
//
// ⚠️ RETRAIT DIFFÉRÉ pendant un geste tactile (défaut bloquant trouvé à la revue du
// 29/07, cf. amendement du plan ; AFFINÉ le 30/07 après une 2e mesure au TOUCHER RÉEL
// sur device — deux pièges successifs, tous deux invisibles à Playwright/jsdom) :
//
// PIÈGE 1 (29/07) : sur un toucher, l'ordre réel des évènements est `pointerdown` →
// `focusout` → `pointerup` → `click` — la cible du CLIC se décide dans cet intervalle.
// Retirer la marge dès le `focusout` déplace donc la mise en page SOUS le doigt entre
// l'appui et le relâchement (mesuré : le bouton Enregistrer visé à 464 se retrouvait à
// 888 en cours de geste). Un retrait ARMÉ par un `focusout` n'est donc RÉSOLU (exécuté)
// qu'à la fin du geste, jamais tout de suite.
//
// PIÈGE 2 (30/07, mesuré au VRAI toucher via `Input.dispatchTouchEvent` — invisible aux
// e2e Playwright, qui pilotent la souris pure, un autre chemin dans Blink) :
// `pointerup` est ENCORE TROP TÔT sur la voie tactile. Blink répartit les évènements
// souris de compatibilité (`mousedown`/`mouseup`/`click`) APRÈS `touchend`, avec un
// NOUVEAU test de position — retirer la marge dès `pointerup` avait déjà écrêté le
// défilement au moment de ce nouveau test (mesuré : bouton Enregistrer visé, le clic
// atterrissait sur `H2.card__title`). Le retrait armé ne se résout donc qu'au `click`
// (jamais `pointerup`), une fois la cible RÉELLEMENT décidée.
//
// PIÈGE 3 (30/07, RÉGRESSION introduite par le correctif du piège 1) : armer un retrait
// dès qu'un `pointerdown` touche AILLEURS que le champ actif — sans attendre un vrai
// `focusout` — casse un balayage de défilement fait PENDANT qu'un champ garde le focus
// (interaction très courante : on tape, on défile pour vérifier quelque chose). Mesuré :
// balayage vertical → `pointerdown` (armé à tort) → `pointercancel` (le défilement
// démarre) → marge retirée EN PLEIN GESTE, alors que le champ n'a jamais perdu le focus
// (`document.activeElement` reste le champ, aucun `focusin` ne repassera jamais —
// la marge ne revient plus). **Un geste ne fait que DIFFÉRER un retrait DÉJÀ demandé
// par un VRAI `focusout` ; il n'en déclenche jamais un lui-même.**
//
// Conséquence assumée sur le bouton retour Android (ferme le clavier natif SANS `blur`
// DOM, mesuré et documenté dans `ColorPickerDialog.vue` : `activeElement` reste le
// champ) : puisque `pointerdown` n'arme plus rien tout seul, ce cas n'est couvert QUE
// si l'interaction suivante déclenche un VRAI `focusout` (taper un AUTRE champ/contrôle
// focalisable referme normalement le précédent) — pas si elle touche un élément non
// focalisable. Compromis assumé : le piège 3 (très courant) prime sur ce cas plus rare,
// et confirmé imposé par le DOM à la relecture du 30/07 (2e passe) : ni l'écouteur
// `backButton` de Capacitor (l'IME consomme l'évènement avant lui lorsqu'un champ a le
// focus) ni le plugin clavier de Capacitor (jamais installé, cf. tête de fichier) ne
// permettent de faire mieux.
//
// PIÈGE 4 (30/07, 2e passe — RÉGRESSION introduite par le retrait de `pointerup` du
// piège 2) : plus rien ne remettait le suivi de geste à « pas de geste en cours » pour
// un geste qui ne produit NI `click` NI `pointercancel` (mesuré avec un pincement à deux
// doigts sur un diagramme — l'app a le pincement) : le suivi restait « geste en cours »
// en PERMANENCE. Conséquence mesurée : champ Notes actif, pincement, puis navigation
// vers `/stash` — le `focusout` du changement d'écran prenait alors la branche ARMER au
// lieu du retrait immédiat, et `/stash` conservait 45vh de vide défilable (`maxScroll`
// 425 au lieu de 0) jusqu'au tout premier toucher suivant.
//
// Correctif REJETÉ : réécouter `pointerup` pour remettre le suivi à zéro réintroduirait
// le PIÈGE 2 — l'ordre mesuré est `pointerdown → touchstart → pointerup → touchend →
// mousedown → focusout → focusin → mouseup → click` : le `focusout` d'un toucher normal
// arrive TOUJOURS après `pointerup`, donc `onFocusOut` reprendrait la branche « retrait
// immédiat » avant que `mouseup`/`click` n'aient eu lieu.
//
// Correctif retenu : remplacer le booléen persistant par une GARDE TEMPORELLE — mais
// mesurée depuis la RELÂCHE, jamais depuis l'appui (cf. « PIÈGE 5 » ci-dessous, qui a
// corrigé une 1re version fautive de cette garde).
//
// PIÈGE 5 (30/07, 3e passe — le bug d'ORIGINE, rouvert par le correctif du piège 4) :
// la 1re version de cette garde mesurait le délai depuis le `pointerdown`. Or la
// grandeur ainsi bornée est `pointerdown → focusout`, c'est-à-dire LA DURÉE PENDANT
// LAQUELLE LE DOIGT RESTE POSÉ — choisie par l'utilisatrice, donc non bornable. Mesuré
// au toucher réel (`Input.dispatchTouchEvent`), champ Notes actif, page en butée, bouton
// Enregistrer visé : appui de 80 ms → clic sur `save` ; appui de 300 ms → clic sur
// `MAIN` ; appui de 600 ms → clic sur `MAIN`. Un appui délibéré de 300 ms sur tablette
// est parfaitement ordinaire : c'était « Enregistrer n'enregistre pas », le bug de départ.
//
// Le bon discriminant est la RELÂCHE, pas l'appui : `pointerup` est REDEVENU un écouteur
// — mais POUR L'ÉTAT SEULEMENT, il ne RÉSOUT toujours RIEN (c'est la distinction que le
// piège 2 avait manquée : il avait rejeté à raison le fait de *résoudre* au `pointerup`,
// et en avait conclu à tort qu'il fallait cesser de l'*observer*). La garde a donc deux
// termes, chacun couvrant une voie réelle :
//   • `pointersDown` (doigts/boutons encore posés) couvre la voie SOURIS, où l'ordre est
//     `mousedown → focusout → mouseup → click` : le `focusout` y arrive alors que le
//     bouton est ENCORE enfoncé, quelle que soit la durée de l'appui ;
//   • `lastPointerUpAt` + `GESTURE_GRACE_MS` couvre la voie TACTILE, où le `focusout`
//     arrive JUSTE APRÈS `pointerup` — mesuré à 0-1 ms après la relâche, et le `click`
//     à 1-2 ms, aux trois durées d'appui ci-dessus. 150 ms est deux ordres de grandeur
//     au-dessus : le risque est asymétrique, sur-armer ne fait que différer un retrait
//     jusqu'au `click`/`pointercancel`/`pointerdown` suivant, sous-armer est le bug.
//
// `GESTURE_MAX_MS` n'est PAS une borne de durée d'appui (ce serait refaire le piège 5) :
// c'est une SOUPAPE contre un pointeur resté « collé » — un `pointerdown` dont le
// `pointerup` n'arrive jamais parce que le geste a quitté la WebView vers une liste
// native (cas déjà documenté plus haut). Réglée en SECONDES, très au-dessus de tout
// appui humain plausible : au-delà, on cesse de croire le compteur et il ne reste que
// l'horloge, qui s'expire toute seule. Le compte des pointeurs est un `Set` d'identifiants
// (`pointerId`) et non un entier : à deux doigts, un `pointercancel` par doigt ne peut
// pas faire passer un compteur sous zéro (même idiome que `pointers` dans ChartStage.vue).
//
// Mesuré au passage (Blink, pincement à deux doigts) : `pointerdown#2 pointerdown#3
// pointercancel#2 pointercancel#3` — le pincement produit BIEN des `pointercancel`, et
// `ChartStage.vue` les laisse remonter au document. La soupape reste néanmoins en place :
// elle ne couvre pas le pincement (déjà couvert par `pointercancel`) mais le geste sorti
// de la WebView, qui lui ne produit rien du tout.
//
// Limite connue, non vérifiée sur device (portrait seul disponible) : dans l'état
// « clavier ouvert » de ColorPickerDialog en paysage court
// (`orientation:landscape and max-height:500px`), une révision antérieure avait
// délibérément ramené le padding bas à 0 (plus rien à faire défiler dans cette grille
// resserrée, cf. commentaire de ColorPickerDialog.vue). Le padding inline posé ici
// (45vh) prend le pas sur cette règle CSS et réintroduit de la place de défilement
// dans cet état précis — sans casser la saisie, mais à revérifier sur device en
// paysage.
//
// Limite connue et acceptée : si le focus passe directement d'un champ à un AUTRE dans
// un conteneur DIFFÉRENT (rare — suppose un geste continu qui saute d'un champ de page
// à un champ de dialogue) pendant qu'un toucher est en cours, l'ancien conteneur est
// nettoyé immédiatement par le nouveau `focusin` plutôt que différé. Non couvert : ce
// n'est pas le scénario mesuré à la revue (toucher un CONTRÔLE, pas un AUTRE champ,
// pendant qu'un champ a le focus).
//
// ⚠️ Pour un `[contenteditable]` (CodeMirror), `scrollIntoView` sur l'ÉLÉMENT entier
// vise le haut de TOUT le texte, pas la ligne éditée — un patron entier peut mesurer
// des milliers de points de haut. Mesuré (30/07) : la ligne où l'on écrit passait de
// ~513 (visible, sans mécanisme) à ~1025 (81 points sous une fenêtre de 944) — MIEUX
// qu'avant ce correctif (1927) mais TOUJOURS pire que ne rien faire. Corrigé en visant
// le rectangle du CURSEUR (`window.getSelection()`, API standard du navigateur — cf.
// `scrollCaretIntoView`), jamais celui de l'élément entier, pour ce cas précis.

// Mesure des bandeaux collants : DÉMÉNAGÉE dans src/utils/sticky-top.js le 19/08/2026 pour
// être partagée avec GuideView (même besoin, même défilement au ras d'un bandeau opaque).
// Le § 3 de l'en-tête ci-dessus décrit toujours ce qu'elle fait ici.
import { measureStickyTopHeight, RESPIRATION_SOUS_BANDEAUX } from '@/utils/sticky-top'
import { scrollBehavior } from '@/utils/scroll-behavior'

const MARGIN_BOTTOM = '45vh'

// Sont concernés : <textarea>, [contenteditable] (y compris injecté à l'exécution —
// ex. `.cm-content` que CodeMirror monte dans ReaderTextEditor.vue, jamais écrit dans
// le template Vue), et les <input> de type texte/nombre/recherche/courriel/téléphone/
// mot de passe/URL. Sont EXCLUS : <select> (liste native, pas de clavier), case à
// cocher, bouton radio, bouton, fichier, couleur, curseur — faire défiler l'écran au
// focus d'une case à cocher (ex. via Tab) serait déroutant, et
// tests/e2e/checkbox.spec.js teste justement le focus clavier sur ces lignes-là.
// `type="date"` (session/date d'achat, ProjectDetailView.vue, ProjectEditView.vue,
// StashView.vue) est EXCLU pour la même raison que <select> : Android ouvre un
// sélecteur natif (roue/calendrier), jamais le clavier virtuel — rien à dégager.
const TEXT_INPUT_TYPES = new Set(['text', 'number', 'search', 'email', 'tel', 'password', 'url'])

export function isTextField(el) {
  if (!(el instanceof HTMLElement)) return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') return true
  if (el.tagName !== 'INPUT') return false
  const type = (el.getAttribute('type') || 'text').toLowerCase()
  return TEXT_INPUT_TYPES.has(type)
}

// Un conteneur défilant HORIZONTALEMENT (bandeau de chips, onglets…) calcule aussi un
// `overflow-y` égal à `auto` sur Chromium réel dès que `overflow-x` est posé à autre
// chose que `visible` — couplage CSS mesuré sur la Nexus 7 le 29/07 (absent de jsdom,
// qui ne l'implémente pas et renvoie les valeurs telles qu'écrites). Un simple test du
// mot-clé confondrait donc ces bandeaux avec une vraie carte de dialogue défilante
// (ColorPickerDialog, YarnConsumptionDialog), qui ne posent QUE `overflow-y`. On
// distingue par le débordement RÉEL plutôt que par le mot-clé : un bandeau horizontal
// déborde en largeur (`scrollWidth > clientWidth`), une carte de dialogue non.
// `overflow-x: clip` (ex. `.panels` de ProjectDetailView.vue) NE PROVOQUE PAS ce
// couplage (mesuré au même endroit) : il reste exclu, comme attendu — le document
// reste le conteneur défilant pour les champs qu'il contient.
//
// ⚠️ Deuxième défaut bloquant trouvé à la revue du 29/07 : ce garde-fou répondait à une
// question de HAUTEUR (le conteneur défile-t-il verticalement ?) par un test de
// LARGEUR — `.cm-scroller` (thème de BASE de la dépendance `@codemirror/view`, jamais
// écrit dans ce dépôt) pose `overflow-x: auto`, calcule donc aussi `overflow-y: auto`
// (même couplage que ci-dessus), et le retour à la ligne du texte annule tout
// débordement horizontal — il passait donc au travers du garde-fou alors qu'il ne
// défile PAS verticalement (`scrollHeight == clientHeight`, mesuré). Conséquence :
// 45vh injectés DANS l'éditeur au lieu du document, la ligne où l'on écrit se
// retrouvait à ~1927 (près de 1000 points sous l'écran) au lieu de ~726 visible.
// Corrigé en ajoutant `scrollHeight > clientHeight`… qui EXCLURAIT AUSSI une carte de
// dialogue à contenu court (YarnConsumptionDialog avec 1 seule laine, par exemple :
// rien n'y déborde encore, mais `padding-bottom` inline y créera un vrai débordement à
// la demande). Le bon discriminant n'est donc pas « déborde-t-il déjà ? » mais « le
// champ REMPLIT-IL ce conteneur ? » : dans `.cm-scroller`, le champ (`.cm-content`,
// hauteur = tout le texte) occupe la totalité de la hauteur visible du conteneur (qui
// n'a pas de hauteur propre, il s'ajuste exactement au contenu) — aucune place n'existe
// ni ne peut exister à côté de lui. Dans une carte de dialogue, le champ (un simple
// <input>) reste petit devant le reste de la carte (en-tête, liste, bouton) même
// quand elle ne déborde pas encore. `fieldHeight` est calculée UNE FOIS dans
// `findScrollContainer` (hauteur du champ qui a demandé le focus, pas du conteneur
// candidat) et transmise à chaque candidat testé en remontant les ancêtres.
function isVerticalScrollBox(el, fieldHeight) {
  const style = getComputedStyle(el)
  const scrollsY = style.overflowY === 'auto' || style.overflowY === 'scroll'
  if (!scrollsY) return false
  if (el.scrollWidth > el.clientWidth + 1) return false
  if (fieldHeight >= el.clientHeight) return false
  return true
}

// Remonte jusqu'au premier ancêtre RÉELLEMENT défilant verticalement. Repli : le
// document lui-même (cas de 15 des 17 écrans porteurs de champ relevés le 29/07 —
// `.screen` n'a pas d'`overflow` propre, seul le document défile).
export function findScrollContainer(el) {
  const fieldHeight = el.offsetHeight
  let node = el.parentElement
  while (node && node !== document.body) {
    if (isVerticalScrollBox(node, fieldHeight)) return node
    node = node.parentElement
  }
  return document.scrollingElement || document.documentElement
}

function isDocumentContainer(container) {
  return container === document.scrollingElement || container === document.documentElement || container === document.body
}

let container = null // conteneur qui porte actuellement la marge basse (ou en instance de la perdre)
let target = null // champ qui a demandé cette marge (pour nettoyer son scroll-margin-top)
let removalArmed = false // un retrait a été demandé mais différé jusqu'à la fin du geste en cours
const pointersDown = new Set() // identifiants des pointeurs ENCORE posés (cf. « PIÈGE 5 »)
let lastPointerDownAt = -Infinity // horodatage du dernier appui — sert UNIQUEMENT à la soupape
let lastPointerUpAt = -Infinity // horodatage de la dernière RELÂCHE — c'est ELLE le discriminant
const GESTURE_GRACE_MS = 150
const GESTURE_MAX_MS = 4000

// « Un geste est-il en cours (ou vient-il tout juste de finir) ? » — cf. « PIÈGE 5 » en
// tête de fichier pour le détail des deux termes et de la soupape.
function withinGesture() {
  const now = performance.now()
  if (pointersDown.size > 0 && now - lastPointerDownAt < GESTURE_MAX_MS) return true
  return now - lastPointerUpAt < GESTURE_GRACE_MS
}

function removeNow() {
  if (container) container.style.paddingBottom = ''
  if (target) target.style.scrollMarginTop = ''
  container = null
  target = null
  removalArmed = false
}

function applyMargin(newContainer, newTarget) {
  if (target && target !== newTarget) target.style.scrollMarginTop = ''
  if (container && container !== newContainer) container.style.paddingBottom = ''
  container = newContainer
  target = newTarget
  removalArmed = false
  container.style.paddingBottom = MARGIN_BOTTOM
}

function armRemoval() {
  if (container) removalArmed = true
}

function resolveArmedRemoval() {
  if (removalArmed) removeNow()
}

function isEditableRegion(el) {
  return el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false'
}

// Rectangle du CURSEUR (ou de la sélection courante) à l'intérieur d'un
// `[contenteditable]` — API standard (`Selection`/`Range`), aucune dépendance à
// CodeMirror. `null` si rien d'exploitable (pas encore de sélection posée à ce point
// précis) : l'appelant se replie alors sur `scrollIntoView` de l'élément entier, comme
// pour un champ normal.
//
// ⚠️ Défaut trouvé à la relecture du 30/07 (2e passe) : sur une ligne VIDE — le geste le
// plus courant de cet écran, ajouter du texte — `Range.getBoundingClientRect()` renvoie
// un rectangle NUL 5 fois sur 5 (mesuré), quelle que soit la position horizontale du
// toucher : sur un intervalle sans texte, l'ancre de la sélection (`anchorNode`) est un
// nœud ÉLÉMENT, pas un nœud texte, et le `Range` n'a rien à mesurer. Sans repli dédié,
// l'appelant retombait sur `scrollIntoView` de TOUT `.cm-content` — exactement le défaut
// du bloquant n°3 (30/07, 1re passe) qu'on vient de corriger, non couvert sur ce chemin.
// Repli : le rectangle de l'ÉLÉMENT qui contient le curseur (`anchorNode` lui-même s'il
// est déjà un élément, sinon son parent) — un nœud élément a toujours une vraie mise en
// page même sans texte (c'est la LIGNE elle-même, généralement). Jamais le nom
// `.cm-line` : on prend l'ancre telle quelle, par remontée générique du DOM, sans rien
// connaître de CodeMirror.
function caretRect() {
  const sel = window.getSelection ? window.getSelection() : null
  if (!sel || sel.rangeCount === 0) return null
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (rect.width > 0 || rect.height > 0) return rect
  const anchor = sel.anchorNode
  if (!anchor) return null
  const el = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement
  if (!el || typeof el.getBoundingClientRect !== 'function') return null
  const elRect = el.getBoundingClientRect()
  if (elRect.width === 0 && elRect.height === 0) return null
  return elRect
}

// Amène le CURSEUR (pas l'élément entier) juste sous `marginTop` : un simple
// `scrollIntoView` sur `[contenteditable]` viserait le haut de TOUT le texte (cf.
// en-tête de fichier). Repli sur `scrollIntoView` classique si aucun rectangle de
// curseur n'est lisible.
// `behavior` vient de `scrollBehavior()` (src/utils/scroll-behavior.js), jamais d'un
// `'smooth'` écrit en dur : la règle CSS de `tokens.css` ne gouverne PAS une valeur
// passée en argument JavaScript. Le piège, mesuré ici le 30/07, est documenté au long
// dans ce module — c'est lui qu'il faut relire avant d'y toucher.
function scrollCaretIntoView(target, container, marginTop) {
  const behavior = scrollBehavior()
  const rect = caretRect()
  if (!rect) {
    target.scrollIntoView({ block: 'start', behavior })
    return
  }
  const delta = rect.top - marginTop
  if (Math.abs(delta) < 4) return // déjà à sa place, rien à faire
  container.scrollBy({ top: delta, behavior })
}

function onFocusIn(e) {
  const t = e.target
  if (!isTextField(t)) return
  // `.cm-numprompt` (mini-dialogue numérique, cm-editor.js) : carte COURTE, centrée par
  // flex (`align-items: center`) dans une enveloppe plein écran — retour terrain (écran
  // de correction, popover Compteur) : ce mécanisme la plaquait tout en haut, avec un
  // grand vide en dessous. Cause identifiée : l'enveloppe est elle-même le conteneur
  // défilant retenu par `findScrollContainer` (seul ancêtre `overflow-y: auto`), et son
  // `padding-bottom` de 45vh (posé juste en dessous par `applyMargin`, pour les VRAIS
  // champs de formulaire) n'agrandit PAS `scrollHeight` ici — mesuré (Chromium réel) :
  // `scrollHeight === clientHeight` malgré le padding posé, un conteneur `display: flex`
  // n'inclut pas son padding de fin dans la région défilable comme le ferait un bloc
  // normal. `scrollIntoView` n'a donc RIEN à défiler ; seule la position CALCULÉE par le
  // flex (perturbée par ce padding fantôme) déplace la carte. Retirer cet écran du
  // mécanisme laisse le centrage flex natif faire son travail (cas courant, sans clavier
  // réel) ; une carte aussi courte reste, en pratique, presque toujours visible même
  // quand un clavier virtuel mange le bas de la fenêtre (elle occupe rarement plus de
  // 260 points sur des hauteurs d'écran ≥ 600, cf. tête de fichier : un clavier Android
  // ne dépasse jamais ~55% de la hauteur). Non vérifiable ICI (pas de clavier logiciel
  // réel en test) : reste un gate device comme le reste de ce mécanisme.
  if (t.closest('.cm-numprompt')) return
  const c = findScrollContainer(t)
  applyMargin(c, t)
  requestAnimationFrame(() => recheckCaretMargin(t, c))
}

// Factorisé hors d'`onFocusIn` (retour terrain, écran de correction) : replacer le
// curseur PLUS BAS dans un CHAMP DÉJÀ FOCALISÉ (clic sur une autre ligne de l'éditeur,
// flèche haut/bas qui change de ligne) ne déclenche AUCUN `focusin` — c'est le MÊME
// élément `[contenteditable]` qui garde le focus, seule sa sélection interne bouge.
// `onFocusIn` (ci-dessus) ne s'exécutant qu'UNE fois par focus, la ligne nouvellement
// visée n'était donc JAMAIS revérifiée : mesuré, le bandeau collant (flèches +
// barre de requalification, `.rte__bar` sur l'écran de correction) pouvait recouvrir
// la ligne tout juste sélectionnée, avec une marge parfois nulle — le bandeau
// grandissant ou rétrécissant selon la ligne (indicateur de type rempli ou non,
// cf. cm-editor.js) sans que rien ne le recompense. `recheckCaretMargin`, exportée,
// est appelée par cm-editor.js à chaque changement de sélection (cursor déplacé),
// PAS seulement au focus — même calcul que la frame ci-dessus (marginTop, garde
// `target !== t` / `removalArmed`), donc aucun comportement nouveau à valider,
// seulement rejoué plus souvent. Le seuil `Math.abs(delta) < 4` de
// `scrollCaretIntoView` évite tout défilement parasite pendant une frappe normale
// (le curseur bouge à peine sur la même ligne) : seul un VRAI changement de ligne
// (chevauchement réel ou naissant) déclenche un défilement.
export function recheckCaretMargin(t, c = container) {
  if (target !== t || container !== c || !c || removalArmed) return
  const headerH = isDocumentContainer(c) ? measureStickyTopHeight() : 0
  const marginTop = headerH + RESPIRATION_SOUS_BANDEAUX
  t.style.scrollMarginTop = `${marginTop}px`
  if (isEditableRegion(t)) scrollCaretIntoView(t, c, marginTop)
  else t.scrollIntoView({ block: 'start', behavior: scrollBehavior() })
}

function onFocusOut() {
  if (!container) return
  if (withinGesture()) {
    // Geste en cours ou tout juste relâché : NE PAS bouger la mise en page
    // (cf. « PIÈGE 1 »/« PIÈGE 2 » en tête de fichier) — armé, résolu par onGestureEnd.
    armRemoval()
  } else {
    // Pas de geste récent à protéger (tabulation, changement d'écran) : retrait immédiat.
    removeNow()
  }
}

function onPointerDown(e) {
  // N'ARME RIEN ici (cf. « PIÈGE 3 » en tête de fichier) : un toucher qui démarre un
  // geste ne prouve pas que le champ perd le focus (ex. balayage de défilement, champ
  // toujours actif). Seul un VRAI `focusout` (ci-dessus) demande un retrait ; ce
  // gestionnaire ne fait que noter QUAND un geste a commencé, pour le DIFFÉRER s'il y en
  // a un à faire.
  //
  // Résout un éventuel retrait resté armé d'un geste PRÉCÉDENT jamais correctement
  // terminé (mineur relevé à la revue : liste native, geste sorti de la WebView — ni
  // `click` ni `pointercancel` n'était alors arrivé) : ce nouveau geste prouve que le
  // précédent est bel et bien fini.
  resolveArmedRemoval()
  pointersDown.add(e ? e.pointerId : undefined)
  lastPointerDownAt = performance.now()
}

// ⚠️ NE RÉSOUT RIEN (cf. « PIÈGE 2 ») : la relâche ne met à jour que le SUIVI du geste.
// C'est pourtant elle, et non l'appui, qui borne l'attente (cf. « PIÈGE 5 »).
function onPointerUp(e) {
  pointersDown.delete(e ? e.pointerId : undefined)
  lastPointerUpAt = performance.now()
}

// Un geste ANNULÉ (défilement/glissé/pincement) : le pointeur n'est plus posé, et on
// résout tout de suite. ⚠️ Il ne touche PAS à `lastPointerUpAt`, contrairement à une
// vraie relâche : la fenêtre de grâce n'existe QUE pour protéger le `click` qui suit la
// relâche — or un geste annulé n'en produira jamais. Prolonger la grâce après lui ne
// protégerait rien et ne ferait que différer à tort un `focusout` immédiatement suivant.
function onPointerCancel(e) {
  pointersDown.delete(e ? e.pointerId : undefined)
  resolveArmedRemoval()
}

function onGestureEnd() {
  // `click` n'est pas un évènement de pointeur : il ne touche PAS au compte des pointeurs
  // (le `pointerup` correspondant l'a déjà décrémenté — décrémenter ici passerait le
  // compte sous zéro et un appui ultérieur ne serait plus vu comme un geste en cours).
  resolveArmedRemoval()
}

export function installKeyboardAvoidance() {
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  document.addEventListener('pointerdown', onPointerDown)
  // `pointerup` est écouté POUR L'ÉTAT SEULEMENT — il ne RÉSOUT rien (cf. « PIÈGE 2 » :
  // sur la voie tactile, Blink répartit encore les évènements souris de compatibilité
  // APRÈS, avec un nouveau test de position ; résoudre là bougerait la mise en page trop
  // tôt). Mais il doit être OBSERVÉ, car c'est la relâche qui borne l'attente et non
  // l'appui (cf. « PIÈGE 5 »). `click` arrive après le test de position final ;
  // `pointercancel` couvre le geste qui n'aboutit jamais à un clic (glissé/pincement).
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('click', onGestureEnd)
  document.addEventListener('pointercancel', onPointerCancel)
}

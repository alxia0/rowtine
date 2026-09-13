import { registerPlugin, Capacitor } from '@capacitor/core'

// Pont des insets d'écran sûrs. Mesuré sur device le 27/07 : la WebView Android
// occupe tout l'écran (barres système comprises) mais env(safe-area-inset-*) ne
// remonte QUE l'encoche — 0 pour les barres système. Le natif est donc la seule
// source possible pour la barre d'état et la barre de navigation. Les valeurs
// arrivent en dp (= px CSS) et écrasent en inline les replis env() de tokens.css.
const SafeArea = registerPlugin('SafeArea')

const SIDES = ['top', 'right', 'bottom', 'left']

// Correctif de la double réservation de la barre de navigation (mesuré sur
// Huawei LYA-L29 / Android 10, 12/09) : sur un appareil où la fenêtre n'est
// PAS edge-to-edge au niveau du conteneur WebView pour un bord donné, ce
// conteneur est déjà physiquement rétréci pour laisser la place à la barre
// système — mesuré par `window.screen.{width,height}` (l'écran physique,
// stable quel que soit le mode de navigation) moins `window.inner{Width,
// Height}` (le viewport réellement disponible). Notre propre inset (lu sur
// le decorView, en amont de cette réservation) republie alors la même
// distance en CSS par-dessus un espace déjà repris par l'OS : compté deux
// fois, d'où la bande vide. `--safe-area-inset-*` (posée par Capacitor
// depuis `webView.getParent()`, EN AVAL de cette réservation) sert de
// signal : si elle vaut 0 sur ce côté ET que l'axe a un écart mesurable,
// c'est que ce côté est déjà réservé physiquement — on retire l'écart de
// notre propre valeur. Une valeur ABSENTE (chaîne vide côté CSS → NaN une
// fois parsée, ex. avant la toute première injection Capacitor au démarrage
// à froid, ou navigateur/banc de test sans cette variable déclarée) est
// INCONNUE, jamais RÉSERVÉE : `capacitorInsets[côté] === 0` exclut NaN
// (NaN !== 0), donc une valeur inconnue ne déclenche jamais de soustraction
// — c'est ce qui protège le correctif du 27/07 (Nexus 7 : Capacitor zérote
// les quatre côtés dans sa branche de compatibilité WebView, sans aucune
// réservation physique réelle ; notre valeur, seule source fiable là-bas,
// doit passer intacte).
const AXIS_BY_SIDE = { top: 'height', bottom: 'height', left: 'width', right: 'width' }
const OPPOSITE_SIDE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

export function correctForPhysicalReservation(insets, capacitorInsets, dims) {
  if (!insets) return insets
  const corrected = { ...insets }
  SIDES.forEach((side) => {
    const axis = AXIS_BY_SIDE[side]
    const screenSize = axis === 'height' ? dims.screenHeight : dims.screenWidth
    const innerSize = axis === 'height' ? dims.innerHeight : dims.innerWidth
    const shortfall = screenSize - innerSize
    if (!(shortfall > 0)) return
    if (capacitorInsets[side] !== 0) return
    // Repli : si les deux côtés de cet axe publient 0 chez Capacitor malgré un écart,
    // ne pas soustraire (bande cosmétique plutôt que contenu sous les barres).
    if (capacitorInsets[OPPOSITE_SIDE[side]] === 0) return
    // Borne de plausibilité : une réservation de barre système ne dépasse jamais la
    // somme des deux insets du même axe (mesuré : Huawei portrait 40 ≤ 25+40=65,
    // paysage 40 ≤ 25+40=65). Un écart plus grand est un autre phénomène — clavier
    // (Capacitor rétrécit le conteneur webview quand l'IME est visible, réduisant
    // innerHeight indépendamment de toute barre système) ou écran partagé — jamais
    // une barre à corriger : ne pas soustraire plutôt que sur-corriger à tort.
    const plausibleMax = Number(insets[side]) + Number(insets[OPPOSITE_SIDE[side]])
    if (shortfall > plausibleMax) return
    corrected[side] = Math.max(0, Number(corrected[side]) - shortfall)
  })
  return corrected
}

// Exporté pour le test : un relevé partiel ou non fini ne doit RIEN écrire plutôt
// que de poser « NaNpx », qui rendrait toute la règle CSS invalide et ferait
// disparaître le padding au lieu de le corriger.
export function applyInsets(insets, el = document.documentElement) {
  if (!insets) return
  const vals = SIDES.map((s) => Number(insets[s]))
  if (vals.some((n) => !Number.isFinite(n))) return
  SIDES.forEach((side, i) => {
    el.style.setProperty(`--sa-${side}`, `${Math.max(0, Math.round(vals[i]))}px`)
  })
}

// Garde-fou du masquage de démarrage (installSafeArea ci-dessous) : si le pont natif
// ne répond jamais — get() qui ne resolve ni ne rejette — on révèle quand même
// l'application après ce délai. 4 s : largement au-delà du pire cas mesuré (~3 s
// sur Pixel 7/Android 17) tout en restant court devant la patience d'un utilisateur
// devant une app qui reste noire.
const SAFETY_REVEAL_MS = 4000

const CAPACITOR_INSET_VAR = { top: '--safe-area-inset-top', right: '--safe-area-inset-right', bottom: '--safe-area-inset-bottom', left: '--safe-area-inset-left' }

// Lit les variables que Capacitor pose lui-même (en aval de la réservation
// physique éventuelle) : voir le commentaire de correctForPhysicalReservation.
// parseFloat('') / parseFloat(undefined) valent NaN (pas 0) : une variable pas
// encore injectée (démarrage à froid, avant onDOMReady côté Capacitor) reste
// bien INCONNUE, jamais confondue avec un 0 lu validement.
function readCapacitorInsets(el = document.documentElement) {
  const style = getComputedStyle(el)
  const out = {}
  SIDES.forEach((side) => {
    out[side] = parseFloat(style.getPropertyValue(CAPACITOR_INSET_VAR[side]))
  })
  return out
}

function correctedInsets(insets) {
  return correctForPhysicalReservation(insets, readCapacitorInsets(), {
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  })
}

let lastRawInsets = null
let lastAppliedInsets = null

function insetsEqual(a, b) {
  if (!a || !b) return false
  return SIDES.every((side) => Number(a[side]) === Number(b[side]))
}

// Applique la correction si le résultat a réellement changé — le garde qui empêche
// la boucle infinie avec le MutationObserver ci-dessous (voir son commentaire).
function applyCorrectedInsets(rawInsets) {
  lastRawInsets = rawInsets
  const corrected = correctedInsets(rawInsets)
  if (insetsEqual(corrected, lastAppliedInsets)) return
  lastAppliedInsets = corrected
  applyInsets(corrected)
}

// Rattrape la course de démarrage à froid : si notre lecture de --safe-area-inset-*
// arrive avant l'injection réelle de Capacitor (les 4 côtés valent alors 0, cf.
// commentaire de correctForPhysicalReservation), le repli deux-côtés-à-zéro bloque
// la correction — et rien ne la redéclenche normalement, puisque notre propre
// plugin ne renotifie que sur un changement des insets NATIFS, jamais sur un
// changement de LECTURE Capacitor. Capacitor pose ses 4 variables en style inline
// sur ce même élément (SystemBars.java, injectSafeAreaCSS) : observer ces écritures
// et rejouer le calcul avec les derniers insets natifs connus suffit à rattraper
// l'injection tardive, sans dépendre d'un nouvel évènement natif. `applyCorrectedInsets`
// ne réécrit que si le résultat a changé — sans ce garde, notre propre écriture
// (elle aussi une mutation de style) redéclencherait cet observateur indéfiniment.
let insetsObserver = null
function watchCapacitorInsets() {
  if (insetsObserver) return
  insetsObserver = new MutationObserver(() => {
    if (lastRawInsets) applyCorrectedInsets(lastRawInsets)
  })
  insetsObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
}

// Exporté pour le banc uniquement : en production l'observateur vit aussi longtemps
// que l'app. Mais chaque test réimporte ce module (vi.resetModules) et créerait
// sinon un observateur de plus sur le VRAI document.documentElement, chacun gardant
// ses propres derniers insets — une mutation de style d'un test ultérieur les
// réveillerait tous et réécrirait --sa-* par-dessus les attentes du test en cours.
export function stopCapacitorInsetsWatch() {
  if (insetsObserver) {
    insetsObserver.disconnect()
    insetsObserver = null
  }
  lastRawInsets = null
  lastAppliedInsets = null
}

export async function installSafeArea() {
  if (!Capacitor.isNativePlatform()) return

  // INVARIANT : l'app ne doit jamais se PEINDRE sans connaissance des insets. Course
  // mesurée au démarrage à froid (Pixel 7 / Android 17, sondes CDP des 07-08/09) :
  // pendant ~1,5-3 s, env(safe-area-inset-top) vaut 0 dans la webview ET --sa-top
  // n'est pas encore posé (pont natif lent, pire cas : première ouverture après
  // installation/dexopt) → tous les en-têtes (padding max(--sp-4, --sa-top)) passent
  // sous la barre d'état, puis le layout se corrige seul quand l'inset arrive — trop
  // tard, l'écran a déjà été vu/photographié. Masquer ICI suffit : main.js appelle
  // installSafeArea() AVANT app.mount(), dans la même tâche JS, donc le premier
  // paint ne peut survenir qu'après la fin de cette tâche — après ce masquage,
  // montage compris, même tick. Hors natif : aucun masquage (web, banc, e2e web).
  document.documentElement.style.visibility = 'hidden'

  // Révélation IDEMPOTENTE : le premier appel gagne, les suivants sont sans effet
  // (ni propriété retouchée, ni timer fantôme) — le finally et le garde-fou peuvent
  // tous deux y parvenir, dans n'importe quel ordre.
  let revealed = false
  let safetyTimer = null
  const reveal = () => {
    if (revealed) return
    revealed = true
    if (safetyTimer !== null) clearTimeout(safetyTimer)
    // removeProperty (et non = '') : supprime la déclaration inline au lieu d'en
    // empiler une vide — l'état final est « aucune visibilité posée », comme hors natif.
    document.documentElement.style.removeProperty('visibility')
  }
  safetyTimer = setTimeout(reveal, SAFETY_REVEAL_MS)

  try {
    // .catch() explicite, INDÉPENDANT du try/catch englobant : addListener() n'est pas
    // awaité ici (pour ne pas retarder l'appel à get() ci-dessous, et ne pas rater un
    // événement survenant entre les deux) — or un rejet de promesse non awaitée n'est
    // JAMAIS intercepté par un try/catch synchrone qui l'entoure, même si l'appel est
    // lexicalement dedans. Sans ce .catch(), un plugin natif absent (ancienne APK
    // installée) laisse fuiter un rejet de promesse non géré au lieu d'être neutralisé
    // (vérifié empiriquement contre @capacitor/core@8.4.1).
    watchCapacitorInsets()
    SafeArea.addListener('safeAreaChanged', (insets) => applyCorrectedInsets(insets)).catch(() => {})
    applyCorrectedInsets(await SafeArea.get())
  } catch {
    // Plugin absent (ancienne version installée, plateforme sans implémentation) :
    // on garde les replis env() de tokens.css — dégradé, jamais cassé.
  } finally {
    // Révéler sur succès ET échec de get() : inset natif écrit (nominal) comme repli
    // env() dégradé (plugin absent — mieux vaut un layout rarement dégradé qu'une app
    // invisible), l'app doit TOUJOURS redevenir visible ; la garde NaN d'applyInsets
    // empêche d'écrire des valeurs pourries dans le cas dégradé. applyInsets reste
    // PUR (il ne révèle pas) : la révélation appartient au cycle de vie de
    // installSafeArea ; les safeAreaChanged ultérieurs continuent de mettre à jour
    // les variables, app déjà visible.
    reveal()
  }
}

import { onMounted, onUnmounted, watch } from 'vue'

// Piège au Tab pour surfaces role="dialog" (dette audit UX 16/07) : le voile ne bloque
// le Tab que VISUELLEMENT — sans ce garde, Tab/Maj+Tab fait sortir le focus de la carte
// vers la page derrière. Boucle entre le PREMIER et le DERNIER élément focalisable du
// conteneur (généralisation du motif ChartFullscreen / cm-editor, unifiée pour ne pas
// le recopier à chaque nouveau dialogue).
export function trapTabFocus(event, container = event.currentTarget) {
  if (event.key !== 'Tab') return
  // `.focus()` est un no-op silencieux sur un `disabled` dans un vrai navigateur :
  // la boucle échouerait sans erreur visible (cf. cfs__prev au premier rang).
  const focusables = Array.from(
    container.querySelectorAll('input, button, [href], select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => !el.disabled)
  if (!focusables.length) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

// Restitution du focus au déclencheur à la fermeture du dialogue. Sans ref d'ouverture,
// le montage/démontage du composant tient lieu d'ouverture/fermeture (cartes v-if).
// Ne restaure QUE si le focus est retombé sur <body> : s'il a déjà été placé ailleurs
// (autre dialogue ouvert en chaîne, navigation), le replacer casserait ce mouvement.
export function useDialogFocusReturn(openRef = null) {
  let restoreTo = null
  const capture = () => {
    restoreTo = document.activeElement
  }
  const restore = () => {
    if (restoreTo && document.activeElement === document.body && restoreTo.isConnected) restoreTo.focus()
    restoreTo = null
  }
  if (openRef) {
    // `flush: 'post'` OBLIGATOIRE (mesuré en test, 07/09) : au flush `pre` par défaut, la
    // restitution court AVANT que le v-if n'ait retiré la carte — `activeElement` est
    // encore DANS le dialogue, la garde `=== document.body` échoue et le déclencheur
    // n'est jamais retrouvé. En `post`, la carte est partie, le focus a retombé sur
    // <body>, la garde signifie ce qu'elle dit. `immediate` reste synchrone : la capture
    // d'ouverture part AVANT le focus initial posé par les watches des dialogues.
    watch(openRef, (open) => (open ? capture() : restore()), { immediate: true, flush: 'post' })
  } else {
    // Même raisonnement au démontage : `onBeforeUnmount` court AVANT le retrait du DOM
    // (focus encore dans la carte, garde jamais vraie) — `onUnmounted` court après.
    onMounted(capture)
    onUnmounted(restore)
  }
}

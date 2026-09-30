import { watch, onBeforeUnmount } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { setKeepScreenOn } from '@/native/keep-awake'

// Écran gardé allumé tant que le lecteur d'un projet est monté, si le réglage est actif.
// Suit le réglage de façon réactive ; retiré au démontage (ailleurs, comportement normal).
// `enabled` : booléen fixe (contexte projet). Faux, le composable est inerte (aperçu
// bibliothèque).
export function useKeepScreenOn({ enabled }) {
  if (!enabled) return

  const settings = useSettingsStore()
  watch(
    () => settings.keepScreenOn,
    (on) => setKeepScreenOn(!!on),
    { immediate: true },
  )
  onBeforeUnmount(() => setKeepScreenOn(false))
}

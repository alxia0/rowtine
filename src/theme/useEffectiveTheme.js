// Le thème RÉELLEMENT rendu ('light' | 'dark'), sous forme réactive.
//
// `resolveEffective` (./resolve.js) fait déjà le calcul, mais il est PUR : appelé une fois, sa
// valeur ne se rafraîchit jamais. `applyTheme` écoute bien l'OS, mais seulement pour la balise
// theme-color et la barre d'état native — rien n'en informe le rendu Vue.
//
// ⚠️ Ne pas remplacer ceci par une lecture de `documentElement.getAttribute('data-theme')` :
// elle n'est pas réactive, et elle vaut `null` quand le réglage est « Système » (l'attribut
// n'est alors volontairement pas posé, cf. apply.js).
import { computed, ref, onScopeDispose } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { resolveEffective, prefersDark } from './resolve'

export function useEffectiveTheme() {
  const settings = useSettingsStore()
  const systemeSombre = ref(prefersDark())

  // Garde : jsdom et les environnements sans matchMedia (mêmes précautions que resolve.js).
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const surChangement = (e) => {
      systemeSombre.value = e.matches
    }
    mq.addEventListener('change', surChangement)
    onScopeDispose(() => mq.removeEventListener('change', surChangement))
  }

  return computed(() => resolveEffective(settings.theme, systemeSombre.value))
}

// Thème EFFECTIF réactif (lot « mode sombre », 08/08).
//
// Aujourd'hui rien n'est réactif sur ce point : `resolveEffective` est une fonction pure et
// l'écouteur système d'`applyTheme` ne rafraîchit que la barre d'état. Une lecture unique de
// `data-theme` à l'initialisation échouerait en silence sur les DEUX cas testés ici.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { useSettingsStore } from '@/stores/settings'
import { useEffectiveTheme } from '@/theme/useEffectiveTheme'

let ecouteurs = []
let instancesMq = []
function stubMatchMedia(matches) {
  ecouteurs = []
  instancesMq = []
  window.matchMedia = vi.fn().mockImplementation((q) => {
    const mq = {
      matches,
      media: q,
      addEventListener: vi.fn((_e, fn) => ecouteurs.push(fn)),
      removeEventListener: vi.fn(),
    }
    instancesMq.push(mq)
    return mq
  })
}

function monter() {
  const Sonde = defineComponent({
    setup() {
      const effectif = useEffectiveTheme()
      return () => h('span', effectif.value)
    },
  })
  const wrapper = mount(Sonde, { global: { plugins: [createTestingPinia({ stubActions: false })] } })
  return { wrapper, settings: useSettingsStore() }
}

beforeEach(() => stubMatchMedia(false))

describe('useEffectiveTheme', () => {
  it('suit le RÉGLAGE quand il change', async () => {
    const { wrapper, settings } = monter()
    expect(wrapper.text()).toBe('light')
    settings.theme = 'dark'
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('dark')
  })

  it('en « Système », suit le changement de préférence de l’OS', async () => {
    const { wrapper, settings } = monter()
    settings.theme = 'system'
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('light')
    ecouteurs.forEach((fn) => fn({ matches: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('dark')
  })

  it('un choix explicite gagne contre un OS en nuit', async () => {
    stubMatchMedia(true)
    const { wrapper, settings } = monter()
    settings.theme = 'light'
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toBe('light')
  })

  it('démonte proprement : retire le MÊME écouteur que celui posé', async () => {
    const { wrapper } = monter()
    await wrapper.vm.$nextTick()

    // L'instance mq réellement utilisée par le composable est celle sur laquelle
    // addEventListener a été appelé (prefersDark() en crée une autre, jamais abonnée).
    const mqAbonnee = instancesMq.find((mq) => mq.addEventListener.mock.calls.length > 0)
    expect(mqAbonnee).toBeTruthy()
    const [evenement, fnPosee] = mqAbonnee.addEventListener.mock.calls[0]
    expect(evenement).toBe('change')

    wrapper.unmount()

    expect(mqAbonnee.removeEventListener).toHaveBeenCalledTimes(1)
    const [, fnRetiree] = mqAbonnee.removeEventListener.mock.calls[0]
    // Le cœur du test : c'est bien LA MÊME fonction qui est retirée, pas une autre —
    // un simple "a été appelé" laisserait passer un retrait qui vise la mauvaise cible,
    // c'est-à-dire une fuite d'écouteur.
    expect(fnRetiree).toBe(fnPosee)
  })
})

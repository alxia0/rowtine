// @vitest-environment jsdom
// Écran allumé côté lecteur : suit le réglage tant que le lecteur d'un projet est monté, retiré au démontage.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '@/stores/settings'

const native = vi.hoisted(() => ({ setKeepScreenOn: vi.fn(async () => {}) }))
vi.mock('@/native/keep-awake', () => native)

import { useKeepScreenOn } from '@/composables/useKeepScreenOn'

function setup({ enabled = true, keepScreenOn = false } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const settings = useSettingsStore()
  settings.keepScreenOn = keepScreenOn
  const Host = defineComponent({
    setup() {
      useKeepScreenOn({ enabled })
      return () => null
    },
  })
  const wrapper = mount(Host, { global: { plugins: [pinia] } })
  return { wrapper, settings }
}

const calls = () => native.setKeepScreenOn.mock.calls.map((c) => c[0])

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useKeepScreenOn', () => {
  it('inactif (aperçu bibliothèque) : aucun appel, même au démontage', async () => {
    const { wrapper, settings } = setup({ enabled: false, keepScreenOn: true })
    settings.keepScreenOn = false
    await nextTick()
    wrapper.unmount()
    expect(native.setKeepScreenOn).not.toHaveBeenCalled()
  })

  it('réglage actif au montage : écran gardé allumé, retiré au démontage', () => {
    const { wrapper } = setup({ keepScreenOn: true })
    expect(calls()).toEqual([true])
    wrapper.unmount()
    expect(calls()).toEqual([true, false])
  })

  it('réglage inactif au montage : rien de gardé allumé', () => {
    setup({ keepScreenOn: false })
    expect(calls()).toEqual([false])
  })

  it('suit la bascule du réglage pendant que le lecteur est monté', async () => {
    const { settings } = setup({ keepScreenOn: false })
    settings.keepScreenOn = true
    await nextTick()
    expect(calls().at(-1)).toBe(true)
    settings.keepScreenOn = false
    await nextTick()
    expect(calls().at(-1)).toBe(false)
  })
})

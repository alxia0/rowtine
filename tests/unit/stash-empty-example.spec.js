// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import StashView from '@/views/StashView.vue'
import { useYarnsStore } from '@/stores/yarns'
import { createTestI18n, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)
function mountView() {
  return mount(StashView, { global: { plugins: [createPinia(), i18n], stubs: { AppHeader: true, ThumbImage: true, YarnWeightHelp: true, ColorPickerDialog: true, YarnDetailDialog: true, AppIcon: true } } })
}

describe('StashView — carte exemple sur écran vide', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('affiche la carte exemple badgée quand vide', async () => {
    const w = mountView()
    const store = useYarnsStore(); store.yarns = []; store.loaded = true
    await flushPromises()
    expect(w.find('.ycard--example').exists()).toBe(true)
    expect(w.text()).toContain(tk('common.example'))
    expect(w.text()).toContain('DROPS')
  })
  it('disparaît dès une vraie laine', async () => {
    const w = mountView()
    const store = useYarnsStore(); store.yarns = [{ id: 1, brand: 'X', colorName: 'C', composition: [], quantity: 1 }]; store.loaded = true
    await flushPromises()
    expect(w.find('.ycard--example').exists()).toBe(false)
  })
})

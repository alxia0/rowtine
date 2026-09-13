import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import StashView from '@/views/StashView.vue'
import { useYarnsStore } from '@/stores/yarns'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
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
    expect(w.text()).toContain('Exemple')
    expect(w.text()).toContain('DROPS')
  })
  it('disparaît dès une vraie laine', async () => {
    const w = mountView()
    const store = useYarnsStore(); store.yarns = [{ id: 1, brand: 'X', colorName: 'C', composition: [], quantity: 1 }]; store.loaded = true
    await flushPromises()
    expect(w.find('.ycard--example').exists()).toBe(false)
  })
})

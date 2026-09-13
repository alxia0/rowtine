import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import StashView from '@/views/StashView.vue'
import { useYarnsStore } from '@/stores/yarns'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

describe('StashView — corps de carte ouvre le détail', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('tap sur le corps ouvre YarnDetailDialog', async () => {
    const w = mount(StashView, {
      global: { plugins: [createPinia(), i18n], stubs: { AppHeader: true, ThumbImage: true, YarnWeightHelp: true, ColorPickerDialog: true, EmptyStateArt: true, AppIcon: true } },
    })
    const store = useYarnsStore()
    store.yarns = [{ id: 7, brand: 'DROPS', colorName: 'Bleu', composition: [], quantity: 2 }]
    store.loaded = true
    await flushPromises()
    expect(w.find('.ycard__view').attributes('aria-label')).toBe(fr.yarn.viewLabel)
    await w.find('.ycard__view').trigger('click')
    await flushPromises()
    expect(w.findComponent({ name: 'YarnDetailDialog' }).exists()).toBe(true)
    expect(w.find('.ydet__card').exists()).toBe(true)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import StashView from '@/views/StashView.vue'
import { useYarnsStore } from '@/stores/yarns'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

function mountView() {
  return mount(StashView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { AppHeader: true, ThumbImage: true, YarnWeightHelp: true, ColorPickerDialog: true, EmptyStateArt: true, AppIcon: true },
    },
  })
}

describe('StashView — édition remonte en haut', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('openEdit défile en haut de page', async () => {
    const scrollTo = vi.fn()
    window.scrollTo = scrollTo
    const wrapper = mountView()
    const store = useYarnsStore()
    store.yarns = [{ id: 1, brand: 'A', colorName: 'Rouge', composition: [], quantity: 1 }]
    store.loaded = true
    await flushPromises()
    // ouvre l'édition de la 1re carte (menu kebab)
    await wrapper.find('.ycard__kebab').trigger('click')
    await wrapper.findAll('.menu__item').find((b) => b.text() === fr.common.edit).trigger('click')
    await flushPromises()
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
  })
})

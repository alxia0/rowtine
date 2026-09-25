// @vitest-environment jsdom
// Unitaire — StashView : un tap sur le corps d'une carte navigue vers la fiche laine
// (route stash-item), plus vers un tiroir. Seule preuve unitaire du câblage @view de
// StashView.vue depuis la bascule vers les écrans fiche/édition (Task 4 du plan
// « refonte stock laine, fiche/navigation ») — YarnDetailView.vue lui-même est couvert par
// tests/unit/YarnDetailView.spec.js.
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import fr from '@/i18n/fr.json'
import StashView from '@/views/StashView.vue'
import { useYarnsStore } from '@/stores/yarns'
import { createTestI18n, createTestRouter } from './helpers/i18n-router'

const i18n = createTestI18n()

function makeRouter() {
  return createTestRouter([
    { path: '/stash', name: 'stash', component: StashView },
    { path: '/stash/:id', name: 'stash-item', component: { template: '<div />' } },
    { path: '/stash/new', name: 'stash-new', component: { template: '<div />' } },
  ])
}

describe('StashView — corps de carte ouvre la fiche laine', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('tap sur le corps navigue vers stash-item avec le bon id', async () => {
    const router = makeRouter()
    router.push('/stash')
    await router.isReady()
    const w = mount(StashView, {
      global: { plugins: [createPinia(), i18n, router], stubs: { AppHeader: true, ThumbImage: true, AppIcon: true } },
    })
    const store = useYarnsStore()
    store.yarns = [{ id: 7, brand: 'DROPS', colorName: 'Bleu', composition: [], quantity: 2 }]
    store.loaded = true
    await flushPromises()

    expect(w.find('.ycard__view').attributes('aria-label')).toBe(fr.yarn.viewLabel)
    await w.find('.ycard__view').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('stash-item')
    expect(router.currentRoute.value.params.id).toBe('7')
  })
})

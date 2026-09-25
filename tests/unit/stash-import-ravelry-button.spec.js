// @vitest-environment jsdom
// Bouton secondaire « Import Ravelry » à côté de « Ajouter une laine » (StashView), Task
// 12 (RavelryImportView) fournit la route ciblée. Motif de test :
// tests/unit/stash-detail-wiring.spec.js.
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import fr from '@/i18n/fr.json'
import StashView from '@/views/StashView.vue'
import { createTestI18n, createTestRouter } from './helpers/i18n-router'

const i18n = createTestI18n()

function makeRouter() {
  return createTestRouter([
    { path: '/stash', name: 'stash', component: StashView },
    { path: '/stash/new', name: 'stash-new', component: { template: '<div />' } },
    { path: '/stash/import-ravelry', name: 'stash-import-ravelry', component: { template: '<div />' } },
  ])
}

describe('StashView, bouton Import Ravelry', () => {
  it('affiche les deux boutons, « Import Ravelry » navigue vers stash-import-ravelry', async () => {
    const router = makeRouter()
    router.push('/stash')
    await router.isReady()
    const w = mount(StashView, {
      global: { plugins: [createPinia(), i18n, router], stubs: { AppHeader: true, ThumbImage: true, AppIcon: true } },
    })
    await flushPromises()

    expect(w.text()).toContain(fr.yarn.add)
    expect(w.text()).toContain(fr.yarn.importRavelry)

    await w.find('[data-test="import-ravelry-btn"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('stash-import-ravelry')
  })
})

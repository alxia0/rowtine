// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { db } from '@/db/db'
import LibraryView from '@/views/LibraryView.vue'
import { createTestI18n, createTestRouter, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)

async function mountLib() {
  await db.patterns.clear()
  const router = createTestRouter([
    { path: '/', name: 'library', component: LibraryView },
    { path: '/pattern/new', name: 'pattern-new', component: { template: '<div/>' } },
    { path: '/pattern/:id', name: 'pattern', component: { template: '<div/>' } },
  ])
  router.push('/')
  await router.isReady()
  const w = mount(LibraryView, { global: { plugins: [router, i18n, createPinia()] } })
  await flushPromises()
  // Cf. tests/unit/LibraryView-counts.spec.js : `onMounted` attend `settings.load()`
  // (12 lectures Dexie séquentielles) avant `patternsStore.load()`.
  await new Promise((r) => setTimeout(r, 50))
  await flushPromises()
  return { w, router }
}

describe('LibraryView — « Créer manuellement » navigue vers l’écran dédié', () => {
  beforeEach(async () => {
    await db.open()
  })

  it('ouvre la feuille, tape « Créer manuellement », navigue vers pattern-new sans formulaire inline', async () => {
    const { w, router } = await mountLib()
    await w.get('.btn--primary').trigger('click') // bouton « Ajouter un patron »
    await flushPromises()

    const manualBtn = w.findAll('.pas__opt').find((b) => b.text().includes(tk('pattern.addManual')))
    await manualBtn.trigger('click')
    await flushPromises()

    expect(w.find('.addform').exists()).toBe(false)
    expect(router.currentRoute.value.name).toBe('pattern-new')
  })
})

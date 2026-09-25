// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { db } from '@/db/db'
import PatternCreateView from '@/views/PatternCreateView.vue'
import { createTestI18n, createTestRouter, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)

async function mountView() {
  const router = createTestRouter([
    { path: '/library', name: 'library', component: { template: '<div/>' } },
    { path: '/pattern/new', name: 'pattern-new', component: PatternCreateView },
    { path: '/pattern/:id', name: 'pattern', component: { template: '<div/>' } },
  ])
  await router.push('/library')
  await router.push('/pattern/new')
  await router.isReady()
  const w = mount(PatternCreateView, { global: { plugins: [router, i18n, createPinia()] } })
  await flushPromises()
  return { w, router }
}

describe('PatternCreateView', () => {
  beforeEach(async () => {
    await db.open()
    await db.patterns.clear()
  })

  it('affiche l’en-tête « Créer manuellement » et un formulaire vierge', async () => {
    const { w } = await mountView()
    expect(w.text()).toContain(tk('pattern.addManual'))
    expect(w.find('.addform').exists()).toBe(true)
    expect(w.find('#pat-name').element.value).toBe('')
  })

  it('à la sauvegarde, crée le patron en base et navigue vers sa fiche', async () => {
    const { w, router } = await mountView()
    await w.find('#pat-name').setValue('Mon patron')
    await w.find('.addform__actions .btn--primary').trigger('click')
    // `patternsStore.add()` enchaîne l'écriture Dexie PUIS `load()` (lecture +
    // migrateReadersIfNeeded) : plusieurs macrotâches fake-indexeddb, que
    // `flushPromises()` seul ne draine pas (même chaîne asynchrone qu'en Step 7 /
    // LibraryView-counts.spec.js). On attend ici la navigation elle-même plutôt
    // qu'un délai fixe.
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('pattern'))
    await flushPromises()

    const rows = await db.patterns.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Mon patron')
    expect(router.currentRoute.value.params.id).toBe(String(rows[0].id))
  })

  // Deux appuis rapprochés sur Enregistrer ne créent qu'un seul patron.
  it('double appui sur Enregistrer : un seul patron créé', async () => {
    const { w, router } = await mountView()
    await w.find('#pat-name').setValue('Mon patron')
    const btn = w.find('.addform__actions .btn--primary')
    await btn.trigger('click')
    await btn.trigger('click')
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('pattern'))
    await flushPromises()
    await new Promise((r) => setTimeout(r, 50))
    expect(await db.patterns.count()).toBe(1)
  })

  it('« Annuler » revient à l’écran précédent sans créer de patron', async () => {
    const { w, router } = await mountView()
    await w.find('.addform__actions .btn').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('library')
    expect(await db.patterns.count()).toBe(0)
  })
})

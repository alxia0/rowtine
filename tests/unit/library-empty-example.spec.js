// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import fr from '@/i18n/fr.json'
import LibraryView from '@/views/LibraryView.vue'
import { usePatternsStore } from '@/stores/patterns'
import { createTestI18n, createTestRouter, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)
const router = createTestRouter([{ path: '/', name: 'library', component: { template: '<div/>' } }, { path: '/p/:id', name: 'pattern', component: { template: '<div/>' } }, { path: '/i', name: 'import-local', component: { template: '<div/>' } }])

async function mountView() {
  const w = mount(LibraryView, { global: { plugins: [createPinia(), i18n, router], stubs: { AppHeader: true, ThumbImage: true, ConfirmDialog: true, AppIcon: true } } })
  await flushPromises(); return w
}

describe('LibraryView — carte exemple sur bibliothèque vide', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('affiche la carte exemple badgée quand aucune fiche', async () => {
    const w = await mountView()
    const store = usePatternsStore(); store.patterns = []; store.loaded = true
    await flushPromises()
    expect(w.find('.pcard--example').exists()).toBe(true)
    expect(w.text()).toContain(tk('common.example'))
  })

  // Distinction importante : un filtre de catégorie qui ne renvoie rien NE DOIT PAS
  // afficher la carte exemple — la bibliothèque n'est pas vide, seul le filtre l'est. Le
  // message existant `pattern.empty` doit rester.
  it('garde le message existant quand un filtre de catégorie ne renvoie rien (bibliothèque non vide)', async () => {
    const w = await mountView()
    const store = usePatternsStore()
    store.patterns = [{ id: 1, name: 'Écharpe', type: 'knitting', category: null, ownerProjectId: null, builtin: false, sizes: [] }]
    store.loaded = true
    await flushPromises()

    // Sélectionne une chip de catégorie via l'UI (pas l'état interne) : la catégorie de
    // l'unique patron est `null`, donc n'importe quelle chip de catégorie réelle (après
    // « Tous ») donne un filtre vide.
    const chips = w.findAll('.chip')
    expect(chips.length).toBeGreaterThan(1)
    await chips[1].trigger('click')
    await flushPromises()

    expect(w.find('.pcard--example').exists()).toBe(false)
    expect(w.text()).toContain(fr.pattern.empty)
  })
})

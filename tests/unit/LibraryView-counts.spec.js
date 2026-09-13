import { beforeEach, describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { db } from '@/db/db'
import LibraryView from '@/views/LibraryView.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

const EMPTY_READER = { sizeLabels: [], sections: [] }

async function mountLib(patterns) {
  await db.patterns.clear()
  for (const p of patterns) await db.patterns.add({ reader: EMPTY_READER, ...p })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'library', component: LibraryView },
      { path: '/pattern/:id', name: 'pattern', component: { template: '<div/>' } },
      { path: '/project/new', name: 'project-new', component: { template: '<div/>' } },
    ],
  })
  router.push('/')
  await router.isReady()
  const w = mount(LibraryView, { global: { plugins: [router, i18n, createPinia()] } })
  await flushPromises()
  // `onMounted` attend désormais `settings.load()` (12 lectures Dexie séquentielles,
  // lot du 19/08/2026 — avertissement d'import) AVANT de lancer `patternsStore.load()` :
  // deux `flushPromises()` seuls ne suffisaient plus à laisser cette chaîne aboutir sur
  // IndexedDB simulée (même besoin documenté dans tests/unit/home-view.spec.js pour
  // HomeView, qui attend `settings.load()` de la même façon).
  await new Promise((r) => setTimeout(r, 50))
  await flushPromises()
  return w
}

const chip = (w, label) => w.findAll('.chip').find((b) => b.text().startsWith(label))

describe('LibraryView — compteurs sur les pastilles', () => {
  beforeEach(async () => {
    await db.open()
  })

  it('« Tous » porte le nombre total de patrons', async () => {
    const w = await mountLib([
      { name: 'A', category: 'clothing' },
      { name: 'B', category: 'socks' },
      { name: 'C', category: '' },
    ])
    expect(chip(w, 'Tous').text()).toBe('Tous (3)')
  })

  it('chaque catégorie porte son propre nombre', async () => {
    const w = await mountLib([
      { name: 'A', category: 'clothing' },
      { name: 'B', category: 'clothing' },
      { name: 'C', category: 'socks' },
    ])
    expect(chip(w, 'Vêtements').text()).toContain('(2)')
    expect(chip(w, 'Chaussettes').text()).toContain('(1)')
  })

  it('une catégorie vide affiche « (0) » et reste présente', async () => {
    const w = await mountLib([{ name: 'A', category: 'clothing' }])
    // La bande ne doit pas se réorganiser au fil des ajouts : décision produit du 25/07.
    expect(chip(w, 'Amigurumi').text()).toContain('(0)')
  })

  it('un patron sans catégorie compte dans « Tous » mais dans aucune pastille', async () => {
    const w = await mountLib([{ name: 'A', category: 'clothing' }, { name: 'B', category: '' }])
    expect(chip(w, 'Tous').text()).toBe('Tous (2)')
    expect(chip(w, 'Vêtements').text()).toContain('(1)')
  })

  it('n’inclut pas les instances de projet dans les compteurs', async () => {
    // `libraryPatterns` exclut les patrons rattachés à un projet (ownerProjectId) :
    // le compteur doit être calculé sur CETTE liste, sinon la pastille annoncerait plus
    // de fiches que la liste n'en affiche. Cf. tests/unit/library-excludes-instances.spec.js.
    const w = await mountLib([
      { name: 'Gabarit', category: 'clothing' },
      { name: 'Instance', category: 'clothing', ownerProjectId: 3 },
    ])
    expect(chip(w, 'Tous').text()).toBe('Tous (1)')
    expect(chip(w, 'Vêtements').text()).toContain('(1)')
  })
})

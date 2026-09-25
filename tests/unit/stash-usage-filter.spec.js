// @vitest-environment jsdom
// Unitaire — StashView : câblage bout en bout du 7e critère « État » du menu Filtrer
// (Task 5 du plan « refonte stock laine, fiche/navigation »). yarn-filter-usage.spec.js
// couvre déjà le matcher pur ; ce test-ci vérifie que le menu Filtrer, une fois ouvert,
// propose bien « État » et qu'un choix dedans réduit réellement les cartes rendues dans
// `.ylist` — pas seulement l'état interne `filters`.
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import fr from '@/i18n/fr.json'
import StashView from '@/views/StashView.vue'
import { useYarnsStore } from '@/stores/yarns'
import { useProjectsStore } from '@/stores/projects'
import { createTestI18n, createTestRouter } from './helpers/i18n-router'

const i18n = createTestI18n()

function makeRouter() {
  return createTestRouter([
    { path: '/stash', name: 'stash', component: StashView },
    { path: '/stash/:id', name: 'stash-item', component: { template: '<div />' } },
    { path: '/stash/new', name: 'stash-new', component: { template: '<div />' } },
  ])
}

describe('StashView — menu Filtrer, critère État', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('choisir « Réservée » ne laisse que la carte réservée dans .ylist', async () => {
    const router = makeRouter()
    router.push('/stash')
    await router.isReady()
    const w = mount(StashView, {
      global: { plugins: [createPinia(), i18n, router], stubs: { AppHeader: true, ThumbImage: true, AppIcon: true } },
    })

    const yarnsStore = useYarnsStore()
    const projectsStore = useProjectsStore()
    // Projet en cours (statut != 'done') : la laine 2 reste donc « réservée », pas « utilisée ».
    projectsStore.projects = [{ id: 1, status: 'in_progress' }]
    projectsStore.loaded = true
    yarnsStore.yarns = [
      { id: 1, brand: 'Libre', colorName: 'Bleu', composition: [], quantity: 2 },
      { id: 2, brand: 'Reservee', colorName: 'Vert', composition: [], quantity: 2, reservations: { 1: 1 }, consumed: {} },
    ]
    yarnsStore.loaded = true
    await flushPromises()

    // Les deux cartes sont là avant filtrage.
    expect(w.findAll('.ylist .ycard').length).toBe(2)

    await w.find('[data-test="filter-menu-btn"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="filter-crit-usage"]').trigger('click')
    await flushPromises()
    const options = w.findAll('[data-test="filter-option"]')
    // R6 (même règle que poids/couleur/composition) : seuls les états RÉELLEMENT présents
    // dans le stock apparaissent, dans l'ordre fixe libre → réservée — ni « utilisée » ni
    // « partiellement utilisée » (absents du stock seedé ci-dessus).
    const labels = options.map((o) => o.text())
    expect(labels).toEqual([fr.yarn.usage.free, fr.yarn.usage.reserved])
    const reservedOption = options.find((o) => o.text() === fr.yarn.usage.reserved)
    await reservedOption.trigger('click')
    await flushPromises()

    const cards = w.findAll('.ylist .ycard')
    expect(cards.length).toBe(1)
    expect(cards[0].text()).toContain('Reservee')
  })
})

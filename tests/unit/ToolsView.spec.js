// @vitest-environment jsdom
// Protège le câblage de la liste d'outils : bascule type/taille, pastilles de taille, état vide.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import ToolsView from '@/views/ToolsView.vue'
import ToolRow from '@/components/ToolRow.vue'
import { createTestI18n, createTestRouter, makeTk } from './helpers/i18n-router'
import { emptyTool } from '@/stores/tools'

const i18n = createTestI18n()
const tk = makeTk(i18n)
const Blank = { template: '<div/>' }

const TOOLS = [
  { ...emptyTool('circular'), id: 1, sizeMm: 4, lengthCm: 80, brand: 'ChiaoGoo' },
  { ...emptyTool('interchangeable'), id: 2, kitSizes: [3.5, 4, 5], brand: 'KnitPro', line: 'Zing' },
  { ...emptyTool('standard'), id: 3, sizeMm: 5, brand: 'Clover' },
]

async function mountView(tools = TOOLS, projects = []) {
  const router = createTestRouter([
    { path: '/tools', name: 'tools', component: Blank },
    { path: '/tools/new', name: 'tool-new', component: Blank },
    { path: '/tools/:id', name: 'tool', component: Blank },
  ])
  router.push('/tools')
  await router.isReady()
  const pinia = createTestingPinia({ createSpy: vi.fn, initialState: { tools: { tools, loaded: true }, projects: { projects, loaded: true } } })
  const w = mount(ToolsView, { global: { plugins: [pinia, i18n, router], stubs: { AppHeader: true, BackToTop: true } } })
  return { w, router }
}

const modeBtn = (w, key) => w.findAll('.seg__btn').find((b) => b.text() === tk(key))
const chip = (w, label) => w.findAll('.chip').find((b) => b.attributes('aria-label') === tk('tools.sizeFilter', { size: label }))
const rowCount = (w) => w.findAllComponents(ToolRow).length

beforeEach(() => localStorage.clear())

describe('ToolsView', () => {
  it('par défaut, groupes par type sous l’intertitre de leur catégorie, dans l’ordre aiguilles, kits, crochets', async () => {
    const { w } = await mountView()
    expect(modeBtn(w, 'tools.byType').attributes('aria-pressed')).toBe('true')
    expect(w.findAll('.tcat').map((h) => h.text())).toEqual([
      tk('tools.categories.needle'), tk('tools.categories.kit'), tk('tools.categories.hook'),
    ])
    // Les kits ont deux types au catalogue (aiguilles, crochets) : le type se nomme sous « Kits ».
    expect(w.findAll('.tgroup__title').map((h) => h.text())).toEqual([
      tk('tools.types.circular'), tk('tools.types.interchangeable'), tk('tools.types.standard'),
    ])
    expect(w.findAll('.tgroup__title').every((h) => h.element.tagName === 'H3')).toBe(true)
    expect(w.get('.seg').attributes('aria-label')).toBe(tk('tools.viewMode'))
  })

  it('par type avec une pastille active, un kit montre la taille filtrée et non son intervalle', async () => {
    const { w } = await mountView()
    expect(w.text()).toContain('3,5 à 5 mm')
    await chip(w, '4 mm').trigger('click')
    const kitRow = w.findAllComponents(ToolRow).find((r) => r.props('tool').id === 2)
    expect(kitRow.find('.trow__title').text()).toBe('KnitPro Zing · 4 mm · US 6')
    expect(w.text()).not.toContain('3,5 à 5 mm')
  })

  it('« Par taille » regroupe par mm, tailles à virgule décimale', async () => {
    const { w } = await mountView()
    await modeBtn(w, 'tools.bySize').trigger('click')
    expect(modeBtn(w, 'tools.bySize').attributes('aria-pressed')).toBe('true')
    expect(w.find('.tcat').exists()).toBe(false)
    expect(w.findAll('.tgroup__title').map((h) => h.text())).toEqual(['3,5 mm', '4 mm', '5 mm'])
    // Sans intertitre de catégorie, les titres de groupe sont le niveau sous le h1.
    expect(w.findAll('.tgroup__title').every((h) => h.element.tagName === 'H2')).toBe(true)
    // Le kit apparaît sous chacune de ses trois tailles.
    expect(rowCount(w)).toBe(5)
  })

  it('le choix de présentation est retrouvé au retour sur l’écran', async () => {
    const first = await mountView()
    await modeBtn(first.w, 'tools.bySize').trigger('click')
    first.w.unmount()
    const { w } = await mountView()
    expect(modeBtn(w, 'tools.bySize').attributes('aria-pressed')).toBe('true')
  })

  it('pastilles : seulement les tailles possédées', async () => {
    const { w } = await mountView()
    expect(w.findAll('.chip').map((c) => c.text())).toEqual(['3,5 mm', '4 mm', '5 mm'])
  })

  it('toucher la pastille 4 mm ne garde que la circulaire et le kit', async () => {
    const { w } = await mountView()
    await chip(w, '4 mm').trigger('click')
    expect(chip(w, '4 mm').attributes('aria-pressed')).toBe('true')
    const rows = w.findAllComponents(ToolRow)
    expect(rows.map((r) => r.props('tool').id)).toEqual([1, 2])
  })

  it('par taille, la pastille 4 mm ne montre que le groupe 4 mm (le kit ne revient pas sous ses autres tailles)', async () => {
    const { w } = await mountView()
    await modeBtn(w, 'tools.bySize').trigger('click')
    await chip(w, '4 mm').trigger('click')
    expect(w.findAll('.tgroup__title').map((h) => h.text())).toEqual(['4 mm'])
    expect(rowCount(w)).toBe(2)
  })

  it('retoucher la pastille retire le filtre', async () => {
    const { w } = await mountView()
    await chip(w, '4 mm').trigger('click')
    await chip(w, '4 mm').trigger('click')
    expect(chip(w, '4 mm').attributes('aria-pressed')).toBe('false')
    expect(rowCount(w)).toBe(3)
  })

  it('recherche sans résultat : message dédié, et l’effacer rend la liste', async () => {
    const { w } = await mountView()
    await w.get('input[type="search"]').setValue('introuvable')
    expect(rowCount(w)).toBe(0)
    expect(w.text()).toContain(tk('tools.noMatch'))
    expect(w.text()).not.toContain(tk('tools.empty'))
    await w.get('[data-test="tools-clear"]').trigger('click')
    expect(rowCount(w)).toBe(3)
  })

  it('toucher une ligne ouvre la fiche de l’outil', async () => {
    const { w, router } = await mountView()
    await w.findAllComponents(ToolRow)[2].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('tool')
    expect(router.currentRoute.value.params.id).toBe('3')
  })

  it('stock vide : message tools.empty, exemple inerte et bouton d’ajout', async () => {
    const { w, router } = await mountView([])
    expect(w.text()).toContain(tk('tools.empty'))
    expect(w.find('.seg').exists()).toBe(false)
    expect(w.find('input[type="search"]').exists()).toBe(false)
    const example = w.get('.texample')
    expect(example.attributes('aria-hidden')).toBe('true')
    expect(example.attributes()).toHaveProperty('inert')
    expect(example.text()).toContain(tk('common.example'))
    const add = w.findAll('button').find((b) => b.text().includes(tk('tools.add')))
    await add.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('tool-new')
  })
})

// Protège la mention « en cours » : un outil lié à un projet wip porte son nom, pas celui d'un projet terminé.
describe('ToolsView : outils en cours', () => {
  it('passe le nom du premier projet en cours aux seuls outils liés à un projet wip', async () => {
    const { w } = await mountView(TOOLS, [
      { id: 12, status: 'done', toolIds: [1], name: 'Fini' },
      { id: 10, status: 'wip', toolIds: [1], name: 'Bonnet' },
      { id: 13, status: 'wip', toolIds: [1], name: 'Écharpe' },
      { id: 11, status: 'done', toolIds: [3], name: 'Gants' },
    ])
    const inUseBy = w.findAllComponents(ToolRow).filter((r) => r.props('inUseBy') != null).map((r) => [r.props('tool').id, r.props('inUseBy')])
    expect(inUseBy).toEqual([[1, 'Bonnet']])
  })
  it('passe au kit ses tailles prises par les projets en cours, sans le marquer en cours en entier', async () => {
    const { w } = await mountView(TOOLS, [
      { id: 10, status: 'wip', name: 'Bonnet', kitPicks: [{ toolId: 2, sizeMm: 4, cableCm: null }] },
      { id: 11, status: 'pause', name: 'Pause', kitPicks: [{ toolId: 2, sizeMm: 5, cableCm: null }] },
    ])
    const kitRow = w.findAllComponents(ToolRow).find((r) => r.props('tool').id === 2)
    expect(kitRow.props('kitTaken')).toEqual([{ sizeMm: 4, projectName: 'Bonnet' }])
    expect(kitRow.props('inUseBy')).toBeNull()
  })
})

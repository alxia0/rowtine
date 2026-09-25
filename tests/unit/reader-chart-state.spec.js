// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import ReaderChart from '@/components/ReaderChart.vue'
import { db } from '@/db/db'
import i18n from '@/i18n'

// Harnais de montage ReaderView (dupliqué de tests/unit/ReaderView.spec.js) : le mock
// vue-router est hoisté et propre à ce fichier, donc pas partageable entre specs — une
// copie locale, commentée, est préférable à un import croisé qui casserait l'isolation.
const nav = vi.hoisted(() => ({
  route: { name: 'project-read', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))
// vi.mock est hoisté par Vitest au-dessus des imports : l'import normal ci-dessous
// reçoit donc bien le vue-router mocké (même convention que ReaderView.spec.js).
import ReaderView from '@/views/ReaderView.vue'

describe('ReaderChart — legend visibility', () => {
  it('affiche la légende quand builtinLegend est absent (rétrocompat patrons hérités)', () => {
    const chart = {
      rows: 20,
      cols: 10,
      img: 'test.png',
      repeat: '10 m × 20 rangs',
      readDir: 'bas→haut',
      // builtinLegend absent
    }
    const w = mount(ReaderChart, {
      props: { chart },
      global: { plugins: [i18n] },
    })
    expect(w.find('.chart__legend').exists()).toBe(true)
  })

  it('affiche la légende quand builtinLegend est true (rétrocompat patrons hérités)', () => {
    const chart = {
      rows: 20,
      cols: 10,
      img: 'test.png',
      repeat: '10 m × 20 rangs',
      readDir: 'bas→haut',
      builtinLegend: true,
    }
    const w = mount(ReaderChart, {
      props: { chart },
      global: { plugins: [i18n] },
    })
    expect(w.find('.chart__legend').exists()).toBe(true)
  })

  it('masque la légende quand builtinLegend est false (grilles Phildar multi-symboles)', () => {
    const chart = {
      rows: 20,
      cols: 10,
      img: 'test.png',
      repeat: '10 m × 20 rangs',
      readDir: 'bas→haut',
      builtinLegend: false,
    }
    const w = mount(ReaderChart, {
      props: { chart },
      global: { plugins: [i18n] },
    })
    expect(w.find('.chart__legend').exists()).toBe(false)
  })
})

// ReaderView : frame de calage par grille (st.chartFrames), câblé au
// store chart-zoom via openChartZoom. Harnais copié de ReaderView.spec.js (base Dexie réelle).
describe('ReaderView — état chartFrames (calage par grille)', () => {
  const READER = {
    sizeLabels: ['S'],
    chart: { rows: 4, img: '/patterns/twist-chart.png', repeat: '2 m × 4 rangs', readDir: 'droite à gauche' },
    sections: [{ id: 'sec1', icon: '🧶', title: 'Section 1', steps: [{ chart: true }] }],
  }

  async function seedProject() {
    const patternId = await db.patterns.add({ name: 'Patron test', type: 'knitting', reader: READER })
    const projectId = await db.projects.add({ name: 'Projet test', technique: 'knitting', patternId })
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
    return { patternId, projectId }
  }
  const wrappers = []
  function mountReader() {
    const w = mount(ReaderView, { global: { plugins: [createPinia(), i18n] } })
    wrappers.push(w)
    return w
  }
  async function settle() {
    for (let i = 0; i < 4; i++) {
      await flushPromises()
      await new Promise((r) => setTimeout(r))
    }
    await flushPromises()
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    nav.router.push.mockClear()
    nav.router.replace.mockClear()
    localStorage.clear()
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
  })
  afterEach(() => {
    while (wrappers.length) wrappers.pop().unmount()
  })

  it('le frame de calage par grille persiste dans le readerState (chartFrames)', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()

    w.vm.setChartFrame('sec1', { top: 10, bottom: 90 })
    await settle()
    let p = await db.projects.get(projectId)
    expect(p.readerState.chartFrames).toEqual({ sec1: { top: 10, bottom: 90 } })
    expect(w.vm.chartFrame('sec1')).toEqual({ top: 10, bottom: 90 })

    w.vm.setChartFrame('sec1', null)
    await settle()
    p = await db.projects.get(projectId)
    expect(p.readerState.chartFrames).toEqual({})
    expect(w.vm.chartFrame('sec1')).toBeNull()
  })
})

describe('ReaderView — état chartCurtains (rideau de progression)', () => {
  const READER = {
    sizeLabels: ['S'],
    chart: { rows: 4, img: '/patterns/twist-chart.png', repeat: '2 m × 4 rangs', readDir: 'droite à gauche' },
    sections: [{ id: 'sec1', icon: '🧶', title: 'Section 1', steps: [{ chart: true }] }],
  }

  async function seedProject() {
    const patternId = await db.patterns.add({ name: 'Patron test', type: 'knitting', reader: READER })
    const projectId = await db.projects.add({ name: 'Projet test', technique: 'knitting', patternId })
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
    return { patternId, projectId }
  }
  const wrappers = []
  function mountReader() {
    const w = mount(ReaderView, { global: { plugins: [createPinia(), i18n] } })
    wrappers.push(w)
    return w
  }
  async function settle() {
    for (let i = 0; i < 4; i++) {
      await flushPromises()
      await new Promise((r) => setTimeout(r))
    }
    await flushPromises()
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    nav.router.push.mockClear()
    nav.router.replace.mockClear()
    localStorage.clear()
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
  })
  afterEach(() => {
    while (wrappers.length) wrappers.pop().unmount()
  })

  it('le rideau persiste dans le readerState (chartCurtains)', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()

    w.vm.setChartCurtain('sec1', { x: 40, side: 'right' })
    await settle()
    let p = await db.projects.get(projectId)
    expect(p.readerState.chartCurtains).toEqual({ sec1: { x: 40, side: 'right' } })
    expect(w.vm.chartCurtain('sec1')).toEqual({ x: 40, side: 'right' })

    w.vm.setChartCurtain('sec1', null)
    await settle()
    p = await db.projects.get(projectId)
    expect(p.readerState.chartCurtains).toEqual({})
    expect(w.vm.chartCurtain('sec1')).toBeNull()
  })

  it('changer de rang rétracte le rideau existant (jamais celui du rang précédent)', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()

    w.vm.setChartCurtain('sec1', { x: 40, side: 'right' })
    await settle()
    w.vm.setChartRow('sec1', 2)
    await settle()
    expect(w.vm.chartCurtain('sec1')).toEqual({ x: 100, side: 'right' })
    const p = await db.projects.get(projectId)
    expect(p.readerState.chartCurtains).toEqual({ sec1: { x: 100, side: 'right' } })
  })

  it('changer de rang sans rideau posé ne crée pas d’entrée chartCurtains', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()

    w.vm.setChartRow('sec1', 2)
    await settle()
    expect(w.vm.chartCurtain('sec1')).toBeNull()
    const p = await db.projects.get(projectId)
    expect(p.readerState.chartCurtains).toEqual({})
  })

  // Preuve directe de la persistance demandée (« survit à la fermeture de l'app ») : on
  // démonte complètement l'instance et on en remonte une NOUVELLE qui relit depuis Dexie —
  // pas juste une assertion sur le même wrapper. Couvre aussi, en creux, l'absence de
  // rétractation parasite au chargement (sinon `chartCurtain('sec1')` reviendrait rétracté).
  it('survit à un démontage/remontage complet (ferme puis rouvre l’app)', async () => {
    await seedProject()
    const w1 = mountReader()
    await settle()
    w1.vm.setChartCurtain('sec1', { x: 40, side: 'right' })
    await settle()
    w1.unmount()
    wrappers.pop()

    const w2 = mountReader()
    await settle()
    expect(w2.vm.chartCurtain('sec1')).toEqual({ x: 40, side: 'right' })
  })
})

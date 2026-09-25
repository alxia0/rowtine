// @vitest-environment jsdom
// pattern-view-cover.spec.js — Task 4 (chantier renommage Photos + couverture de patron) :
// l'étoile de la section « Photos du patron » persiste `coverIndex`.
// Elle n'apparaît que pour un patron sans couverture PDF (`pattern.photos` vide) — sinon
// `patternCoverOf` privilégierait toujours `photos[0]` et l'étoile n'aurait aucun effet
// visible (décidé avec Julien, cf. plan).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import { usePatternsStore } from '@/stores/patterns'
import { patternCoverOf } from '@/utils/pattern-cover'

const nav = vi.hoisted(() => ({
  route: { params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import PatternView from '@/views/PatternView.vue'

async function seedPattern({ photos, gallery } = {}) {
  const id = await db.patterns.add({ name: 'Test', type: 'knitting', sizes: [], photos, gallery, coverIndex: 0 })
  nav.route.params = { id: String(id) }
  nav.route.query = {}
  return id
}

const wrappers = []
function mountView() {
  const w = mount(PatternView, { global: { plugins: [createPinia(), i18n] } })
  wrappers.push(w)
  return w
}

async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r))
  await flushPromises()
}

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('PatternView — étoile de couverture de la galerie (Task 4)', () => {
  it('patron sans couverture PDF (photos vide) : cliquer l\'étoile persiste coverIndex et déplace le badge', async () => {
    const gallery = [{ src: 'data:image/png;base64,A', page: 0, w: 0, h: 0 }, { src: 'data:image/png;base64,B', page: 0, w: 0, h: 0 }]
    const id = await seedPattern({ photos: [], gallery })
    const w = mountView()
    await settle()

    const cells = w.findAll('.pgal__cell')
    expect(cells[1].find('.pthumb__cover').exists()).toBe(true)
    await cells[1].find('.pthumb__cover').trigger('click')
    // La persistance passe par patternsStore.update() → load() → migration paresseuse
    // du reader (cf. src/stores/patterns.js) : une cascade Dexie réelle sur plusieurs
    // transactions, plus longue qu'un simple flushPromises (cf. vitest.config.js) — on
    // attend directement le rendu final plutôt qu'un nombre fixe de ticks.
    await vi.waitFor(() => {
      expect(w.findAll('.pgal__cell')[1].find('.pthumb__badge').exists()).toBe(true)
    }, { timeout: 10000 })

    expect((await db.patterns.get(id)).coverIndex).toBe(1)
    const cellsAfter = w.findAll('.pgal__cell')
    expect(cellsAfter[1].find('.pthumb__badge').exists()).toBe(true)
    expect(cellsAfter[0].find('.pthumb__cover').exists()).toBe(true)

    // Vignette de bibliothèque (patternCoverOf, cf. Task 3) : bascule sur la même
    // instance de store que la vue, sans re-fetch manuel côté test — la persistance
    // seule doit suffire à faire changer la vignette.
    const patternsStore = usePatternsStore(w.vm.$pinia)
    await patternsStore.load()
    const stored = patternsStore.patterns.find((p) => p.id === id)
    expect(patternCoverOf(stored)).toBe('data:image/png;base64,B')
  })

  it('patron avec couverture PDF (photos non vide) : aucune étoile ni badge dans la galerie', async () => {
    const gallery = [{ src: 'data:image/png;base64,A', page: 0, w: 0, h: 0 }, { src: 'data:image/png;base64,B', page: 0, w: 0, h: 0 }]
    await seedPattern({ photos: ['data:image/png;base64,SOURCE'], gallery })
    const w = mountView()
    await settle()

    expect(w.find('.pgal').exists()).toBe(true)
    expect(w.find('.pthumb__cover').exists()).toBe(false)
    expect(w.find('.pthumb__badge').exists()).toBe(false)
  })
})

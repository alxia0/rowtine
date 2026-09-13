// pattern-view-preview.spec.js (#2/#3d) : la fiche patron est
// épurée (plus d'aperçu inline des sections/étapes/diagrammes) ; le bouton
// « Prévisualiser le patron » est restauré et mène au Lecteur en lecture seule
// (route pattern-read), qui porte désormais l'action « Corriger le patron »
// (cf. reader-view-correct-entry.spec.js). Remplace le contrat précédent (aperçu
// inline ReaderLine multi-taille), devenu obsolète.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'

// Mock vue-router : même approche que ProjectDetailView.spec.js / reader-view.spec.js
const nav = vi.hoisted(() => ({
  route: { params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import PatternView from '@/views/PatternView.vue'

async function seedPattern() {
  const id = await db.patterns.add({
    name: 'Test',
    type: 'knitting',
    sizes: ['S', 'M'],
    reader: {
      sizeLabels: ['S', 'M'],
      sections: [
        {
          id: 'sec-a',
          title: 'Section A',
          steps: [{ t: 'Monter {{0}} m', c: [[10, 12]] }],
        },
      ],
    },
  })
  nav.route.params = { id: String(id) }
  nav.route.query = {}
  return id
}

const wrappers = []
function mountView() {
  const w = mount(PatternView, {
    global: { plugins: [createPinia(), i18n] },
  })
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

describe('PatternView — fiche épurée + Prévisualiser', () => {
  it("n'affiche PAS l'aperçu inline des sections", async () => {
    await seedPattern()
    const w = mountView()
    await settle()
    expect(w.find('.psec').exists()).toBe(false)
  })

  it('affiche « Prévisualiser le patron » qui navigue vers pattern-read', async () => {
    const id = await seedPattern()
    const w = mountView()
    await settle()
    const btn = w.findAll('button').find((b) => b.text().includes('Prévisualiser'))
    expect(btn).toBeTruthy()
    await btn.trigger('click')
    expect(nav.router.push).toHaveBeenCalledWith({ name: 'pattern-read', params: { id } })
  })

  it("n'affiche plus « Corriger le patron » sur la fiche", async () => {
    await seedPattern()
    const w = mountView()
    await settle()
    expect(w.text()).not.toContain('Corriger le patron')
  })
})

// @vitest-environment jsdom
// tests/unit/reader-view-pdf-tile.spec.js
// Unitaire — bento « Voir le PDF original » dans l'aide-mémoire du suivi.
// Harnais calqué sur tests/unit/reader-view.spec.js (mock router + vraie db).
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'

const openPdfExternally = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/utils/open-pdf', () => ({ openPdfExternally }))

const nav = vi.hoisted(() => ({
  route: { name: 'pattern-read', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import ReaderView from '@/views/ReaderView.vue'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

// Reader AVEC aide-mémoire (reference.tiles) → la grille .amgrid est rendue.
const READER_WITH_REF = {
  sizeLabels: [],
  sections: [{ id: 'a', title: 'Section A', steps: [{ t: 'Rang un' }] }],
  reference: { tiles: [{ tab: 'abbr', title: 'Abréviations', sub: '' }] },
}
const PDF_DATA_URL = 'data:application/pdf;base64,JVBERi0xLjQK'

async function seedPattern({ pdf }) {
  const rec = { name: 'Libre', type: 'knitting', reader: READER_WITH_REF }
  if (pdf) rec.pdf = pdf
  const patternId = await db.patterns.add(rec)
  nav.route = { name: 'pattern-read', params: { id: String(patternId) }, query: {} }
  return patternId
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
function pdfTiles(w) {
  return w.findAll('.amgrid button').filter((b) => b.text().includes(tk('reader.viewPdf')))
}

beforeEach(async () => {
  setActivePinia(createPinia())
  openPdfExternally.mockClear()
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  localStorage.clear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('ReaderView — bento « Voir le PDF original »', () => {
  it('affiche la tuile dans les DEUX grilles (haut + bas) quand le patron a un PDF', async () => {
    await seedPattern({ pdf: PDF_DATA_URL })
    const w = mountReader()
    await settle()
    expect(w.find('.amblock').exists()).toBe(true) // aide-mémoire bien rendu
    // Deux .amgrid rendus (haut + bas) → une tuile PDF par grille, sinon la
    // tuile manque dans l'une des deux places (régression de placement).
    expect(pdfTiles(w).length).toBe(2)
  })

  it("n'affiche la tuile dans AUCUNE grille quand le patron n'a pas de PDF", async () => {
    await seedPattern({ pdf: null })
    const w = mountReader()
    await settle()
    expect(w.find('.amblock').exists()).toBe(true)
    expect(pdfTiles(w).length).toBe(0)
  })

  it('le clic ouvre le PDF original en externe', async () => {
    await seedPattern({ pdf: PDF_DATA_URL })
    const w = mountReader()
    await settle()
    await pdfTiles(w)[0].trigger('click')
    expect(openPdfExternally).toHaveBeenCalledTimes(1)
    expect(openPdfExternally).toHaveBeenCalledWith(PDF_DATA_URL, 'patron.pdf')
  })
})

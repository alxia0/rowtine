// @vitest-environment jsdom
// reader-view-correct-entry.spec.js — l'action
// « Corriger le patron », retirée de la fiche (cf. pattern-view-preview.spec.js),
// est déplacée vers l'écran Prévisualiser (ReaderView en contexte bibliothèque,
// route pattern-read, lecture seule). Réutilise la clé i18n existante
// correction.entry (pas de nouvelle clé).
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'

const nav = vi.hoisted(() => ({
  route: { name: 'pattern-read', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRoute: () => nav.route, useRouter: () => nav.router }))

import ReaderView from '@/views/ReaderView.vue'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

const READER = {
  sizeLabels: [],
  reference: { tiles: [{ tab: 'yarn', title: 'Fil', sub: '' }], abbr: {} },
  sections: [{ id: 'corps', title: 'Corps', steps: [{ t: 'Rang 1' }] }],
}

const wrappers = []
function mountReader() {
  const w = mount(ReaderView, { global: { plugins: [createPinia(), i18n] } })
  wrappers.push(w)
  return w
}
async function settle() {
  for (let i = 0; i < 4; i++) { await flushPromises(); await new Promise((r) => setTimeout(r)) }
  await flushPromises()
}

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
  localStorage.clear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(() => { while (wrappers.length) wrappers.pop().unmount() })

describe('ReaderView (aperçu bibliothèque) — action « Corriger le patron »', () => {
  it('affiche Corriger et navigue vers pattern-correct', async () => {
    const id = await db.patterns.add({ name: 'P', type: 'knitting', reader: READER })
    nav.route = { name: 'pattern-read', params: { id: String(id) }, query: {} }
    const w = mountReader()
    await settle()
    const btn = w.findAll('button').find((b) => b.text().includes(tk('correction.entry')))
    expect(btn).toBeTruthy()
    await btn.trigger('click')
    expect(nav.router.push).toHaveBeenCalledWith({ name: 'pattern-correct', params: { id: String(id) } })
  })

  it('patron créé manuellement (sections vides, une galerie) : affiche Corriger et navigue vers pattern-correct', async () => {
    const id = await db.patterns.add({
      name: 'P',
      type: 'knitting',
      reader: { sizeLabels: [], sections: [] },
      gallery: [{ src: 'data:image/png;base64,GAL', page: 0, w: 10, h: 10 }],
    })
    nav.route = { name: 'pattern-read', params: { id: String(id) }, query: {} }
    const w = mountReader()
    await settle()
    const btn = w.findAll('button').find((b) => b.text().includes(tk('correction.entry')))
    expect(btn).toBeTruthy()
    await btn.trigger('click')
    expect(nav.router.push).toHaveBeenCalledWith({ name: 'pattern-correct', params: { id: String(id) } })
  })

  it("n'affiche PAS Corriger en contexte suivi de projet (readOnly=false)", async () => {
    const patternId = await db.patterns.add({ name: 'P', type: 'knitting', reader: READER })
    const projectId = await db.projects.add({ name: 'Proj', technique: 'knitting', patternId })
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
    const w = mountReader()
    await settle()
    const btn = w.findAll('button').find((b) => b.text().includes(tk('correction.entry')))
    expect(btn).toBeFalsy()
  })
})

// @vitest-environment jsdom
// La fiche patron AFFICHE le prix et la date d'achat, là où ils se saisissent (lot 08/08).
// Avant ce lot, ils ne se lisaient QUE sur la fiche projet et dans l'écran Dépenses.
//
// Fixture : motif exact de pattern-view-preview.spec.js (mock de vue-router, `settle()` en
// trois temps — un seul flushPromises() ne suffit pas au chargement Dexie de la fiche).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'

const nav = vi.hoisted(() => ({
  route: { params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRoute: () => nav.route, useRouter: () => nav.router }))

import PatternView from '@/views/PatternView.vue'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

const wrappers = []
async function monter(over) {
  const id = await db.patterns.add({ name: 'Zopfmütze', type: 'knitting', ...over })
  nav.route.params = { id: String(id) }
  nav.route.query = {}
  const w = mount(PatternView, { global: { plugins: [createPinia(), i18n] } })
  wrappers.push(w)
  await flushPromises()
  await new Promise((r) => setTimeout(r))
  await flushPromises()
  return w
}
const ligne = (w) => w.find('[data-test="pattern-price-line"]')

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('fiche patron — prix et date d’achat', () => {
  it('1. prix + date ⇒ « Acheté <montant> le <date> », dans la devise DU PATRON', async () => {
    // CHF et non EUR : EUR est DEFAULT_CURRENCY, une assertion en euros passerait même si le
    // code ignorait `priceCurrency`. Montant à CENTIMES : sur un montant rond, formatMoney
    // profil « detail » n'écrit aucune décimale et le format ne serait pas exercé.
    const w = await monter({ price: '18,90', priceCurrency: 'CHF', purchasedAt: '2026-08-07' })
    const txt = ligne(w).text()
    expect(txt).toContain('18,90')
    expect(txt).toContain('CHF')
    expect(txt).toContain('07/08/2026')
  })

  it('2. prix SANS date ⇒ le montant seul, aucune date inventée', async () => {
    const w = await monter({ price: '18,90', priceCurrency: 'CHF' })
    const txt = ligne(w).text()
    expect(txt).toContain('18,90')
    expect(txt).not.toMatch(/\d{2}\/\d{2}\/\d{4}/)
    // Garde spécifique contre la clé « avec date » (`priceBoughtOn`) utilisée à tort même
    // sans date : `formatLocalDate(undefined, …)` rend '', et le texte deviendrait
    // « Acheté 18,90 CHF le » — sans chiffres de date, donc la regex ci-dessus ne mordrait
    // pas. Ancré en FIN de chaîne (`.text()` de vue-test-utils fait un `trim()`, donc
    // `not.toContain(' le ')` — espace des deux côtés — ne verrait jamais l'espace de fin
    // disparu par le trim ; mesuré, voir rapport). Le connecteur français « le » ne peut
    // terminer le texte que dans cette clé-là, avec une date vide.
    expect(txt).not.toMatch(/ le$/)
  })

  it('3. prix « 0 » + date ⇒ « Gratuit, obtenu le <date> », rien d’autre', async () => {
    const w = await monter({ price: '0', priceCurrency: 'EUR', purchasedAt: '2026-08-07' })
    const txt = ligne(w).text()
    // Égalité stricte : la branche `free` ne retourne QUE `priceFree`/`priceFreeOn`, deux
    // chaînes statiques sans `{price}` — un montant ne peut donc jamais s'y mêler, et
    // `toContain('Gratuit')` + `not.toContain('€')` ne pouvaient rougir sur aucune mutation
    // plausible (les deux textes sont mutuellement exclusifs par construction, un seul
    // `return`). `toBe` mord en revanche sur une fuite de montant, une mauvaise clé i18n, ou
    // une date absente/mal placée.
    expect(txt).toBe(tk('pattern.priceFreeOn', { date: '07/08/2026' }))
  })

  it('4. prix « 0 » sans date ⇒ « Gratuit » tout court', async () => {
    const w = await monter({ price: '0' })
    expect(ligne(w).text()).toBe(tk('pattern.priceFree'))
  })

  it('5. aucun prix noté ⇒ AUCUNE ligne (pas une ligne vide)', async () => {
    // Ancré sur le marqueur de test, pas sur un fragment de texte : une assertion d'absence
    // portant sur du texte pourrait être vraie pour une raison étrangère au comportement.
    const w = await monter({ price: '', purchasedAt: '2026-08-07' })
    expect(ligne(w).exists()).toBe(false)
  })
})

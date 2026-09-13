// Unitaire — HomeView : la tuile budget lit le registre d'achats (travaux sur le budget laine
// cumulé — remplace l'ancien calcul quantité × prix sur les fiches, cf.
// home-budget-tile.spec.js pour la preuve que ce cumul ne baisse jamais). Ce fichier
// couvre deux comportements numériques qui restent valables après la bascule : un
// prix saisi avec virgule décimale ne doit pas fausser le total (la virgule vit
// maintenant dans `unitPrice`, plus dans `yarn.price`), et le cumul reste ARRONDI
// avant affichage (décision produit, revue 26/07 — jamais de centimes sur cette tuile).
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@/i18n'
import HomeView from '@/views/HomeView.vue'
import { usePurchasesStore } from '@/stores/purchases'

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => nav.router }))

const stubs = { ProjectCard: true, StitchProgress: true }

const buy = (over = {}) => ({ kind: 'buy', currency: 'EUR', yarnId: 1, ...over })

// ⏳ `mountHome` est ASYNCHRONE depuis le 21/08 : l'accueil n'affiche plus ses chiffres tant
// qu'il n'a pas fini de lire la base (il affirmait « aucun projet » et « 0 » sur un
// appareil plein). Les tuiles montrent « — » jusque-là, donc chaque test doit attendre la fin du
// montage avant de lire une valeur. Rien d'autre ne change dans ces tests.
async function mountHome(lines) {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const store = usePurchasesStore(pinia)
  store.purchases = lines
  store.loaded = true
  const w = mount(HomeView, { global: { plugins: [pinia, i18n], stubs } })
  await flushPromises()
  return w
}

describe('HomeView — budget dépensé avec un prix saisi en virgule décimale', () => {
  it('additionne un prix « 3,50 » (virgule) et un prix « 4 » sans casser le total', async () => {
    const w = await mountHome([
      buy({ id: 1, quantity: 2, unitPrice: '3,50' }),
      buy({ id: 2, quantity: 1, unitPrice: '4' }),
    ])
    // 2 × 3,50 + 1 × 4 = 11 — profil 'detail' (formatMoney) : symbole inclus dans le texte.
    // Montant ROND : aucune décimale (décision produit, revue 26/07 — « 11 € », jamais
    // « 11,00 € »). \s plutôt qu'une espace littérale : Intl insère une espace insécable
    // (U+00A0) avant le symbole en français, invisible à l'œil mais qui casserait un `toBe`
    // sur espace normale (même piège déjà documenté dans money.spec.js).
    expect(w.find('.tile--wide .tile__v').text()).toMatch(/^11\s*€$/)
  })

  it('arrondit un total à centimes avant affichage, symbole inclus (jamais de centimes sur le cumul de l’accueil)', async () => {
    const w = await mountHome([
      buy({ id: 1, quantity: 1, unitPrice: '3,70' }),
      buy({ id: 2, quantity: 2, unitPrice: '4' }),
    ])
    // 1 × 3,70 + 2 × 4 = 11,70 -> ARRONDI à 12 avant `formatMoney` (cf. HomeView.vue) :
    // « 12 € », jamais « 11,70 € » (pas d'arrondi) ni « 12,00 € » (arrondi mais décimales
    // encore forcées par Intl) — les deux seraient l'incohérence que ce correctif supprime.
    expect(w.find('.tile--wide .tile__v').text()).toMatch(/^12\s*€$/)
  })
})

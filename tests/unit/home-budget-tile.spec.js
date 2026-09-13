// Unitaire — HomeView : tuile budget laine cumulé (les travaux sur le budget — LE test
// déterminant). Le calcul actuel (« Σ quantité × prix » sur les fiches, encore utilisé par
// StashView pour SA valeur de stock à elle) baisse quand on consomme une laine et
// efface la dépense quand on supprime une fiche — aucun libellé ne pouvait rendre ce
// calcul honnête. Cette tuile doit désormais lire le REGISTRE d'achats (usePurchasesStore),
// pas l'état courant du stock.
//
// Montage calqué sur tests/unit/home-yarn-spent-comma.spec.js : createTestingPinia
// (actions stubbées), état des stores posé directement — pas de base Dexie réelle,
// inutile pour un composant qui ne fait que LIRE des refs de store.
//
// Nombres choisis TOUS DISTINCTS (hors le couple 22/24=46, repris tel quel
// comme LE scénario canonique) — leçon du lot : trois fixtures à valeurs coïncidentes
// ont déjà piégé trois tâches précédentes.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@/i18n'
import HomeView from '@/views/HomeView.vue'
import { useYarnsStore } from '@/stores/yarns'
import { usePurchasesStore } from '@/stores/purchases'
import { usePatternsStore } from '@/stores/patterns'
import { useSettingsStore } from '@/stores/settings'

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => nav.router }))

const stubs = { ProjectCard: true, StitchProgress: true }

// `patterns` (lot « prix du patron », 07/08) : ce fichier ne monte JAMAIS de base
// Dexie réelle (contrairement à tests/unit/expenses-view.spec.js) — createTestingPinia stubbe
// les actions et l'état de chaque store se pose directement, comme purchasesStore/yarnsStore
// ci-dessous. Correction de fixture par rapport au plan initial (qui suppose `usePurchasesStore().add()`
// / `db.patterns.add()` / un helper `monter()`, aucun des trois n'existe dans ce fichier) :
// même leçon qu'ailleurs (helper renommé) — le motif RÉEL du fichier prime sur le plan initial,
// signalé dans le rapport plutôt que de mélanger deux styles de montage dans le même fichier.
// ⏳ `mountHome` est ASYNCHRONE depuis le 21/08 : l'accueil n'affiche plus ses chiffres tant
// qu'il n'a pas fini de lire la base (il affirmait « aucun projet » et « 0 » sur un
// appareil plein). Les tuiles montrent « — » jusque-là, donc chaque test doit attendre la fin du
// montage avant de lire une valeur. Rien d'autre ne change dans ces tests.
async function mountHome({ purchases = [], yarns = [], patterns = [], currency } = {}) {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const purchasesStore = usePurchasesStore(pinia)
  purchasesStore.purchases = purchases
  purchasesStore.loaded = true
  const yarnsStore = useYarnsStore(pinia)
  yarnsStore.yarns = yarns
  yarnsStore.loaded = true
  const patternsStore = usePatternsStore(pinia)
  patternsStore.patterns = patterns
  patternsStore.loaded = true
  if (currency) {
    const settings = useSettingsStore(pinia)
    settings.currency = currency
    settings.loaded = true
  }
  const w = mount(HomeView, { global: { plugins: [pinia, i18n], stubs } })
  await flushPromises()
  return w
}

function budgetTile(w) {
  return w.find('.tile--wide')
}

beforeEach(() => {
  // `nav.router.push` est un espion PARTAGÉ (vi.hoisted) entre tous les tests de ce
  // fichier : sans ce nettoyage, l'appel du test 3 resterait dans son historique et le
  // `toHaveBeenCalledWith` du test 4 passerait même si son propre clic ne faisait rien —
  // exactement le défaut d'assertion-qui-ne-peut-pas-échouer que ce lot proscrit.
  nav.router.push.mockClear()
})

describe('HomeView — tuile budget laine cumulé', () => {
  it('1. une laine tombée à 0 en stock après consommation laisse le budget à 46 € (LE cas du lot)', async () => {
    // Ancien calcul (Σ quantité × prix sur la fiche) : quantity=0 -> 0 × 46 = 0.
    // Registre (ce que cette tuile doit lire) : 2 pelotes à 23 = 46, achetées AVANT
    // consommation — l'historique ne bouge pas quand le stock change.
    const w = await mountHome({
      yarns: [{ id: 1, brand: 'Drops', quantity: 0, price: '46', composition: [] }],
      purchases: [
        { id: 1, yarnId: 1, kind: 'buy', quantity: 2, unitPrice: '23', currency: 'EUR', date: '2026-01-10' },
      ],
    })
    expect(budgetTile(w).find('.tile__v').text()).toMatch(/^46\s*€$/)
  })

  it('2. un achat orphelin (laine supprimée définitivement) compte encore dans la tuile', async () => {
    const w = await mountHome({
      yarns: [], // la fiche n'existe plus
      purchases: [
        { id: 2, yarnId: null, yarnLabel: 'Bergère de France · fil arrêté', kind: 'buy', quantity: 1, unitPrice: '38', currency: 'EUR', date: '2026-02-05' },
      ],
    })
    expect(budgetTile(w).find('.tile__v').text()).toMatch(/^38\s*€$/)
  })

  it('3. la tuile mène à /expenses au clic, sans aria-label qui écraserait le montant lu', async () => {
    const w = await mountHome({
      purchases: [{ id: 3, yarnId: 1, kind: 'buy', quantity: 1, unitPrice: '29', currency: 'EUR', date: '2026-03-01' }],
    })
    const tile = budgetTile(w)
    // Pas d'aria-label : sinon le nom accessible écraserait le montant (WCAG 2.5.3),
    // même règle que la tuile « cette semaine » — une régression ici doit rougir CE test.
    expect(tile.attributes('aria-label')).toBeUndefined()
    expect(tile.text()).toContain('29')
    await tile.trigger('click')
    expect(nav.router.push).toHaveBeenCalledWith({ name: 'expenses' })
  })

  it('4. un cadeau + un orphelin sans prix : total nul mais tuile rendue, affichant 0, menant à /expenses', async () => {
    const w = await mountHome({
      purchases: [
        { id: 4, yarnId: 1, kind: 'gift', quantity: 1, unitPrice: '', currency: 'EUR', date: '2026-04-01' },
        { id: 5, yarnId: null, kind: 'buy', quantity: 1, unitPrice: '', currency: 'EUR', date: '2026-04-02' },
      ],
    })
    const tile = budgetTile(w)
    expect(tile.exists()).toBe(true)
    expect(tile.find('.tile__v').text()).toMatch(/^0\s*€$/)
    await tile.trigger('click')
    expect(nav.router.push).toHaveBeenCalledWith({ name: 'expenses' })
  })

  it('4b. zéro ligne d’achat : la tuile est absente', async () => {
    const w = await mountHome({ purchases: [] })
    expect(budgetTile(w).exists()).toBe(false)
  })

  it('5. deux devises : la devise courante en tête, l’autre listée à part, jamais additionnées', async () => {
    const w = await mountHome({
      currency: 'EUR',
      purchases: [
        { id: 6, yarnId: 1, kind: 'buy', quantity: 3, unitPrice: '6', currency: 'EUR', date: '2026-05-01' }, // 18
        { id: 7, yarnId: 1, kind: 'buy', quantity: 5, unitPrice: '7', currency: 'USD', date: '2026-05-02' }, // 35
      ],
    })
    const tile = budgetTile(w)
    expect(tile.find('.tile__v').text()).toMatch(/^18\s*€$/) // devise courante (EUR) en tête
    // L'autre devise (USD) listée À PART, avec SON symbole — pas un nombre nu qui pourrait
    // être n'importe quoi (cf. revue : `.tile__v` seul contiendrait aussi bien un montant
    // fusionné qu'un montant isolé, un test qui ne lirait que `tile.text()` ne distinguerait
    // pas les deux).
    expect(tile.find('.tile__extra-item').text()).toMatch(/^35\s*\$$/)
    expect(tile.text()).not.toContain('53') // 18 + 35 : ne doit JAMAIS apparaître additionné
  })
})

// ─── Les patrons payants comptent aussi (lot 07/08) ─────────────────────────
// Sans ça, la tuile contredirait l'écran Dépenses à un appui de doigt — elle en est le
// raccourci le plus direct (cf. le commentaire de HomeView). Devise CHF (jamais EUR, DEFAULT_CURRENCY :
// une assertion sur EUR passerait même si le code ne lisait jamais les réglages — leçon des
// tâches 5/6 de ce lot).
//
// `data-test="home-spent"` : ABSENT du template avant cette tâche (vérifié par grep avant
// d'écrire ces tests). Ajouté sur la tuile — préférable à `.tile--wide`/`.tile__v` (sélecteur
// de classe fragile).
describe('tuile budget — laine + patrons', () => {
  it('B1. le total inclut le prix des patrons', async () => {
    const w = await mountHome({
      currency: 'CHF',
      purchases: [
        { id: 1, yarnId: null, yarnLabel: 'Drops', kind: 'buy', quantity: 3, unitPrice: '7', currency: 'CHF', date: '2026-03-04' }, // 21
      ],
      patterns: [
        { id: 1, name: 'Sabai', type: 'knitting', price: '18', priceCurrency: 'CHF', purchasedAt: '2026-03-12' },
      ],
    })
    expect(w.find('[data-test="home-spent"]').text()).toContain('39') // 21 + 18
  })

  it('B2. un patron payant SEUL (aucune ligne d’achat de laine) suffit à faire apparaître la tuile', async () => {
    // La tuile s'affiche sur l'EXISTENCE de lignes, jamais sur « total > 0 » — sinon un
    // historique tout en cadeaux rendrait l'écran Dépenses inatteignable pour toujours.
    const w = await mountHome({
      currency: 'CHF',
      patterns: [
        { id: 2, name: 'Sabai', type: 'knitting', price: '18', priceCurrency: 'CHF', purchasedAt: '2026-03-12' },
      ],
    })
    expect(w.find('[data-test="home-spent"]').exists()).toBe(true)
  })

  it('B3. un patron déclaré GRATUIT (prix "0") fait apparaître la tuile, seule preuve possible de son existence', async () => {
    // Même subtilité que le test 4 (cadeau laine) côté patron : une ligne existe (déclarée
    // explicitement gratuite), mais elle ne doit RIEN ajouter au montant affiché. AUCUNE ligne
    // de laine ici, volontairement : une ligne à 0 ne peut se prouver que par l'EXISTENCE de la
    // tuile, jamais par un montant — ajouter un achat de laine à côté rendrait le total
    // insensible à la présence du patron gratuit (0 + X = X, avec ou sans la ligne), donc
    // incapable de discriminer un vrai bug d'un faux passant. C'est `isPricedPattern` et
    // `patternExpenseLine` (voir tests/unit/pattern-price.spec.js, cas price:'0') qui
    // garantissent que cette ligne vaut bien 0 — ce test-ci ne re-prouve que la fusion et
    // l'affichage, pas ce calcul-là.
    const w = await mountHome({
      currency: 'CHF',
      patterns: [
        { id: 3, name: 'Motif offert', type: 'knitting', price: '0', priceCurrency: 'CHF', purchasedAt: '2026-04-01' },
      ],
    })
    const tile = w.find('[data-test="home-spent"]')
    expect(tile.exists()).toBe(true)
    expect(tile.find('.tile__v').text()).toMatch(/^0\s*CHF$/)
  })
})

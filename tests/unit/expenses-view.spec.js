// @vitest-environment jsdom
// tests/unit/expenses-view.spec.js
// Écran Dépenses (les travaux sur le budget laine cumulé) : couvre `groupByPeriod`
// (pur, src/utils/purchases.js) puis l'écran monté. C'est le SEUL endroit de
// l'app où une ligne d'achat orpheline (laine supprimée définitivement,
// `yarnId: null`) reste visible ET supprimable — sans
// quoi cette dépense deviendrait impossible à corriger pour toujours.
//
// Montage calqué sur tests/unit/yarn-purchases.spec.js : i18n réel (pas de mock
// de `t`), Pinia réelle, base Dexie réelle (fake-indexeddb) écrite via le VRAI
// store (usePurchasesStore().add) — ce qui rend les mutations (step « preuve par
// mutation ») observables. AppHeader est stubbé (comme
// tests/unit/StatsView.spec.js) : il exige un routeur que cet écran n'a pas
// besoin de fournir pour ces tests.
//
// Nombres et dates choisis TOUS DISTINCTS (hors le couple 22/24=46, imposé tel
// quel comme LE scénario canonique des comportements 3/4/7) —
// leçon du lot : trois fixtures à valeurs coïncidentes ont déjà piégé trois
// tâches précédentes.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import fr from '@/i18n/fr.json'
import { usePurchasesStore } from '@/stores/purchases'
import { useYarnsStore } from '@/stores/yarns'
import { usePatternsStore } from '@/stores/patterns'
import { useSnackbarStore } from '@/stores/snackbar'
import { groupByPeriod, yearsOf, filterByYear } from '@/utils/purchases'
import ExpensesView from '@/views/ExpensesView.vue'
import EmptyStateArt from '@/components/EmptyStateArt.vue'
import { createTestI18n } from './helpers/i18n-router'

const i18n = createTestI18n()

// Routeur minimal (ajouté avec le prix du patron, 07/08) : ExpensesView appelle désormais
// useRouter() pour ouvrir la fiche d'un patron depuis sa ligne de dépense. Sans ce mock,
// TOUS les tests existants de ce fichier tomberaient d'un coup (même motif que
// tests/unit/project-edit-pattern-price.spec.js).
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }
vi.mock('vue-router', () => ({
  useRouter: () => router,
}))

// ─── groupByPeriod (pur) ────────────────────────────────────────────────────
describe('groupByPeriod', () => {
  const buy = (over = {}) => ({ kind: 'buy', currency: 'EUR', ...over })

  it('1. deux lignes de 2026 et une de 2025 ⇒ deux groupes, 2026 d’abord', () => {
    const lines = [
      buy({ quantity: 4, unitPrice: '5,50', date: '2026-01-10' }), // 22
      buy({ quantity: 2, unitPrice: '12', date: '2026-05-20' }), // 24
      buy({ quantity: 3, unitPrice: '9', date: '2025-03-05' }), // 27
    ]
    const groups = groupByPeriod(lines)
    expect(groups.map((g) => g.year)).toEqual(['2026', '2025'])
  })

  it('2. les lignes sans date forment un groupe à part, PLACÉ EN DERNIER, et leur montant compte quand même', () => {
    const lines = [
      buy({ quantity: 1, unitPrice: '19', date: '2026-07-01' }), // datée
      buy({ quantity: 1, unitPrice: '13', date: '' }), // sans date
    ]
    const groups = groupByPeriod(lines)
    expect(groups.map((g) => g.year)).toEqual(['2026', '']) // groupe daté d'abord, « date inconnue » en dernier
    const unknown = groups[groups.length - 1]
    expect(unknown.total).toEqual({ EUR: 13 }) // pas 0 : le montant compte bien
    expect(unknown.months).toHaveLength(1)
    expect(unknown.months[0].lines).toHaveLength(1)
  })

  it('3. total 2026 = 22,00 + 24,00 = 46,00 (écrit à la main)', () => {
    const lines = [
      buy({ quantity: 4, unitPrice: '5,50', date: '2026-01-10' }),
      buy({ quantity: 2, unitPrice: '12', date: '2026-05-20' }),
      buy({ quantity: 3, unitPrice: '9', date: '2025-03-05' }), // année différente, ne doit pas polluer le total 2026
    ]
    const groups = groupByPeriod(lines)
    const year2026 = groups.find((g) => g.year === '2026')
    expect(year2026.total).toEqual({ EUR: 46 })
  })

  // Revue (point 3) : aucune assertion existante ne lisait jamais les MOIS d'un
  // groupe daté — trier les mois à l'envers, ou fusionner tous les mois d'une
  // année en un seul bloc, survivait tous les deux à la suite d'origine.
  it('revue-3. même année, deux mois distincts : mois séparés (pas fusionnés) et triés plus récent d’abord', () => {
    const lines = [
      buy({ quantity: 1, unitPrice: '11', date: '2026-02-05' }), // février, 11
      buy({ quantity: 1, unitPrice: '21', date: '2026-08-14' }), // août (postérieur), 21
    ]
    const groups = groupByPeriod(lines)
    const year2026 = groups.find((g) => g.year === '2026')
    expect(year2026.months).toHaveLength(2) // pas fusionnés en un seul bloc
    expect(year2026.months.map((m) => m.month)).toEqual(['2026-08', '2026-02']) // août avant février
  })

  // Revue (point 4) : « deux devises ne s'additionnent jamais » n'était prouvé
  // qu'au niveau du total GÉNÉRAL — jamais au niveau année, jamais au niveau
  // mois. Couvre les deux niveaux restants ici (le niveau écran est couvert par
  // ExpensesView ci-dessous).
  it('revue-4a. deux devises dans la MÊME année ⇒ le total du groupe année les distingue', () => {
    const lines = [
      buy({ quantity: 2, unitPrice: '13', currency: 'EUR', date: '2026-01-05' }), // 26
      buy({ quantity: 1, unitPrice: '31', currency: 'USD', date: '2026-06-10' }), // 31
    ]
    const groups = groupByPeriod(lines)
    const year2026 = groups.find((g) => g.year === '2026')
    expect(year2026.total).toEqual({ EUR: 26, USD: 31 })
  })

  it('revue-4b. deux devises dans le MÊME mois ⇒ le total du sous-groupe mois les distingue', () => {
    const lines = [
      buy({ quantity: 2, unitPrice: '9', currency: 'EUR', date: '2026-09-02' }), // 18
      buy({ quantity: 1, unitPrice: '25', currency: 'USD', date: '2026-09-20' }), // 25
    ]
    const groups = groupByPeriod(lines)
    const month = groups.find((g) => g.year === '2026').months.find((m) => m.month === '2026-09')
    expect(month.total).toEqual({ EUR: 18, USD: 25 })
  })

  // Revue (point 6) : les lignes sortaient dans l'ordre où le STORE les charge
  // (id décroissant), pas dans l'ordre chronologique — un ordre qui ne coïncide
  // AVEC la date que si les lignes ont été saisies dans l'ordre chronologique.
  // Ici, l'id et la date sont volontairement DISCORDANTS (id le plus grand =
  // date la plus ancienne) : un tri qui suivrait l'id au lieu de la date ne
  // prouverait rien s'ils allaient dans le même sens.
  it('revue-6. au sein d’un même mois, les lignes sont triées par DATE (plus récent d’abord), pas par id', () => {
    const lines = [
      buy({ id: 5, quantity: 1, unitPrice: '9', date: '2026-04-05' }), // id le + GRAND, date la + ANCIENNE
      buy({ id: 2, quantity: 1, unitPrice: '16', date: '2026-04-20' }), // id le + PETIT, date la + RÉCENTE
    ]
    const groups = groupByPeriod(lines)
    const month = groups[0].months[0]
    expect(month.lines.map((l) => l.id)).toEqual([2, 5]) // date récente (id 2) avant date ancienne (id 5)
  })
})

// ─── yearsOf / filterByYear (pures — filtre par année, retour d'usage 01/08) ──
describe('yearsOf / filterByYear', () => {
  const buy = (over = {}) => ({ kind: 'buy', currency: 'EUR', ...over })

  it('13. yearsOf : années réelles dédoublonnées, plus récente d’abord, sans date ignorée', () => {
    const lines = [
      buy({ date: '2026-01-10' }),
      buy({ date: '2025-03-05' }),
      buy({ date: '2026-08-01' }), // même année que la 1re : ne doit pas créer de doublon
      buy({ date: '' }), // sans date : ne compte pour aucune année
    ]
    expect(yearsOf(lines)).toEqual(['2026', '2025'])
  })

  it('14. filterByYear("all") : ne filtre rien (comportement historique)', () => {
    const lines = [buy({ date: '2026-01-10' }), buy({ date: '' })]
    expect(filterByYear(lines, 'all')).toEqual(lines)
  })

  it('15. filterByYear("2025") : ne garde que les lignes de cette année', () => {
    const lines = [
      buy({ quantity: 1, unitPrice: '10', date: '2026-01-10' }),
      buy({ quantity: 1, unitPrice: '20', date: '2025-03-05' }),
    ]
    const result = filterByYear(lines, '2025')
    expect(result).toHaveLength(1)
    expect(result[0].unitPrice).toBe('20')
  })

  it('16. filterByYear("unknown") : ne garde QUE les lignes sans date', () => {
    const lines = [
      buy({ quantity: 1, unitPrice: '10', date: '2026-01-10' }),
      buy({ quantity: 1, unitPrice: '30', date: '' }),
    ]
    const result = filterByYear(lines, 'unknown')
    expect(result).toHaveLength(1)
    expect(result[0].unitPrice).toBe('30')
  })

  // Revue de tâche (01/08) : `filterByYear` ne trimait pas la date avant de
  // découper l'année, contrairement à `yearsOf` — une date avec un espace
  // parasite apparaissait au menu comme "2026" (yearsOf trime) mais ne
  // correspondait à AUCUN filtre ici (slice(0, 4) sur " 2026-…" donne " 202"),
  // ni à "unknown" (la chaîne trimée n'est pas vide) : introuvable sous tout
  // filtre sauf "all". Même TRIM que `yearsOf`, pour raconter la même histoire.
  it('16b. filterByYear trime la date comme yearsOf : un espace parasite ne rend pas la ligne introuvable', () => {
    const lines = [buy({ quantity: 1, unitPrice: '40', date: ' 2026-01-10' })] // espace en tête, parasite
    expect(yearsOf(lines)).toEqual(['2026']) // yearsOf la range bien en 2026
    const result = filterByYear(lines, '2026')
    expect(result).toHaveLength(1) // filterByYear doit la retrouver sous ce même filtre
    expect(result[0].unitPrice).toBe('40')
  })
})

// ─── Écran monté ────────────────────────────────────────────────────────────
let pinia
let wrapper

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

async function addLine(overrides = {}) {
  const store = usePurchasesStore()
  return store.add({ kind: 'buy', currency: 'EUR', yarnId: 1, yarnLabel: 'Laine test', ...overrides })
}

function mountView() {
  wrapper = mount(ExpensesView, {
    global: { plugins: [i18n, pinia], stubs: { AppHeader: true, AppIcon: true } },
    attachTo: document.body,
  })
  return wrapper
}

describe('ExpensesView', () => {
  it('4. le total général affiche 46 (une seule devise), une ligne sans date comprise', async () => {
    await addLine({ quantity: 4, unitPrice: '5,50', date: '2026-01-10' }) // 22
    await addLine({ quantity: 2, unitPrice: '12', date: '2026-05-20' }) // 24
    const w = mountView()
    const nums = w.findAll('.exp__stat-num').map((n) => n.text())
    expect(nums).toEqual(['46'])
  })

  it('4b. une ligne sans date compte quand même dans le total général affiché', async () => {
    // Nombre discriminant (17) : distinct de 22/24/46 déjà utilisés — prouve que le
    // total à l'écran (46 + 17 = 63) additionne bien TOUTES les lignes, pas
    // seulement celles que `groupByPeriod` sait ranger dans une année/un mois.
    await addLine({ quantity: 4, unitPrice: '5,50', date: '2026-01-10' }) // 22
    await addLine({ quantity: 2, unitPrice: '12', date: '2026-05-20' }) // 24
    await addLine({ quantity: 1, unitPrice: '17', date: '' }) // 17, sans date
    const w = mountView()
    const nums = w.findAll('.exp__stat-num').map((n) => n.text())
    expect(nums).toEqual(['63'])
  })

  // Revue (points 1 et 2) : masquer TOUT le groupe « date inconnue » (la ligne
  // orpheline-de-date disparaît de l'écran) faisait passer la suite d'origine —
  // le test 4b ne regarde que le total général, calculé indépendamment de
  // `groupByPeriod`, donc aveugle à un groupe qui disparaîtrait à l'écran. Vider
  // le libellé « Date inconnue » (sans toucher au reste) survivait aussi. Ce
  // test assertionne SÉPARÉMENT la présence de la ligne (point 1) et celle du
  // libellé (point 2), pour que chaque mutation fasse rougir sa propre assertion.
  it('revue-1-2. écran : une ligne sans date reste affichée, sous l’en-tête « Date inconnue »', async () => {
    await addLine({ quantity: 1, unitPrice: '15', date: '2026-02-01', yarnLabel: 'Laine datée' }) // 15
    await addLine({ quantity: 1, unitPrice: '9', date: '', yarnLabel: 'Laine sans date' }) // 9, sans date
    const w = mountView()
    // Point 1 : la ligne sans date n'est pas jetée silencieusement.
    expect(w.text()).toContain('Laine sans date')
    // Point 2 : le libellé du groupe « date inconnue » est le bon, pas du vide.
    expect(w.text()).toContain(fr.expenses.unknownDate)
  })

  it('5. deux devises ⇒ deux totaux distincts, jamais additionnés', async () => {
    await addLine({ quantity: 3, unitPrice: '6', currency: 'EUR', date: '2026-03-01' }) // 18
    await addLine({ quantity: 5, unitPrice: '7', currency: 'USD', date: '2026-04-01' }) // 35
    const w = mountView()
    const nums = w.findAll('.exp__stat-num').map((n) => n.text())
    expect(nums).toHaveLength(2)
    expect(nums).toContain('18')
    expect(nums).toContain('35')
    expect(nums).not.toContain('53') // 18 + 35 : ne doit JAMAIS apparaître additionné
  })

  // Revue (point 4) : le total AFFICHÉ d'une année (ni celui d'un mois) n'était
  // lu par aucun test d'écran — seul le total général (test 5 ci-dessus) l'était.
  it('revue-4c. écran : le total d’une ANNÉE avec deux devises affiche deux montants distincts', async () => {
    await addLine({ quantity: 2, unitPrice: '13', currency: 'EUR', date: '2026-01-05' }) // 26
    await addLine({ quantity: 1, unitPrice: '31', currency: 'USD', date: '2026-06-10' }) // 31
    const w = mountView()
    const yearTotals = w.findAll('.exp__year-total').map((n) => n.text())
    expect(yearTotals).toHaveLength(2)
    expect(yearTotals.some((t) => t.includes('26'))).toBe(true)
    expect(yearTotals.some((t) => t.includes('31'))).toBe(true)
    expect(yearTotals.join(' ')).not.toContain('57') // 26 + 31 : jamais fusionné
  })

  it('revue-4d. écran : le total d’un MOIS avec deux devises affiche deux montants distincts', async () => {
    await addLine({ quantity: 2, unitPrice: '9', currency: 'EUR', date: '2026-09-02' }) // 18
    await addLine({ quantity: 1, unitPrice: '25', currency: 'USD', date: '2026-09-20' }) // 25
    const w = mountView()
    const monthTotals = w.findAll('.exp__month-total').map((n) => n.text())
    expect(monthTotals).toHaveLength(2)
    expect(monthTotals.some((t) => t.includes('18'))).toBe(true)
    expect(monthTotals.some((t) => t.includes('25'))).toBe(true)
    expect(monthTotals.join(' ')).not.toContain('43') // 18 + 25 : jamais fusionné
  })

  it('6. une ligne orpheline (yarnId null) affiche son libellé figé ET « laine supprimée », ET reste supprimable', async () => {
    // C'est tout l'enjeu de cet écran : une ligne orpheline n'a plus
    // aucune fiche où s'accrocher — si elle n'est pas ne serait-ce que
    // SUPPRIMABLE ici, cette dépense devient impossible à corriger pour toujours.
    const orphanId = await addLine({
      yarnId: null,
      yarnLabel: 'Bergère de France · fil arrêté',
      quantity: 1,
      unitPrice: '14',
      date: '2026-06-15',
    })
    const w = mountView()
    const store = usePurchasesStore()
    const snackbar = useSnackbarStore()
    expect(w.text()).toContain('Bergère de France · fil arrêté')
    expect(w.text()).toContain(fr.expenses.orphanTag)

    const deleteBtn = w.find(`[data-test="expenses-delete-${orphanId}"]`)
    expect(deleteBtn.exists()).toBe(true)
    await deleteBtn.trigger('click')
    await vi.waitFor(() => expect(store.purchases.map((l) => l.id)).not.toContain(orphanId), { timeout: 10000 })
    expect(snackbar.visible).toBe(true)
    expect(snackbar.actionLabel).toBe(fr.common.undo)
  })

  it('7. supprimer une ligne : elle disparaît, le total baisse (46 ⇒ 24), l’annulation est proposée', async () => {
    const id1 = await addLine({ quantity: 4, unitPrice: '5,50', date: '2026-01-10' }) // 22
    await addLine({ quantity: 2, unitPrice: '12', date: '2026-05-20' }) // 24
    const w = mountView()
    const store = usePurchasesStore()
    const snackbar = useSnackbarStore()

    expect(w.findAll('.exp__stat-num').map((n) => n.text())).toEqual(['46'])

    await w.find(`[data-test="expenses-delete-${id1}"]`).trigger('click')
    // Suppression = get + delete + reload (2 allers-retours Dexie réels) : un seul
    // flushPromises() ne suffit pas toujours à tout drainer (motif partagé avec
    // tests/unit/yarn-purchases.spec.js, test 7).
    await vi.waitFor(() => expect(store.purchases.map((l) => l.id)).not.toContain(id1), { timeout: 10000 })
    await flushPromises()

    expect(w.findAll('.exp__stat-num').map((n) => n.text())).toEqual(['24'])
    expect(w.find(`[data-test="expenses-line-${id1}"]`).exists()).toBe(false)
    expect(snackbar.visible).toBe(true)
    expect(snackbar.actionLabel).toBe(fr.common.undo)
  })

  // Revue (point 5) : rien dans le dépôt n'exécutait réellement l'action
  // d'annulation d'un achat — seule sa PROPOSITION (bandeau visible + libellé)
  // était vérifiée. Transformer `onAction` en no-op survivait à toute la suite.
  // Pour une ligne orpheline (laine supprimée définitivement), c'est le DERNIER
  // filet contre une suppression accidentelle : sans annulation qui marche,
  // elle serait perdue pour toujours. `runAction()` (store snackbar) est le
  // même mécanisme déjà exercé par tests/unit/useSoftDelete.spec.js.
  it('revue-5. l’annulation RESTAURE réellement la ligne en base (pas seulement le bandeau qui s’affiche)', async () => {
    const id1 = await addLine({
      quantity: 4,
      unitPrice: '5,50',
      date: '2026-01-10',
      yarnLabel: 'Laine à restaurer',
      bain: 'B-2026-01',
    }) // 22
    const w = mountView()
    const store = usePurchasesStore()
    const snackbar = useSnackbarStore()

    await w.find(`[data-test="expenses-delete-${id1}"]`).trigger('click')
    await vi.waitFor(() => expect(store.purchases.map((l) => l.id)).not.toContain(id1), { timeout: 10000 })

    snackbar.runAction() // exécute réellement l'action d'annulation, pas juste sa présence
    await vi.waitFor(() => expect(store.purchases.map((l) => l.id)).toContain(id1), { timeout: 10000 })

    const restored = store.purchases.find((l) => l.id === id1)
    expect(restored.yarnLabel).toBe('Laine à restaurer') // les données reviennent réellement, pas juste l'id
    expect(restored.bain).toBe('B-2026-01')
    expect(restored.date).toBe('2026-01-10')

    // Revue (constat 5, partiel) : `store.purchases` peut être vraie en mémoire
    // sans que la BASE ait été réécrite — une régression qui ferait de `restore()`
    // une simple réinjection en mémoire (sans écrire dans Dexie) laisserait ce
    // test vert jusqu'ici, la ligne réapparaîtrait à l'écran puis disparaîtrait
    // pour de bon au prochain lancement. On lit donc la BASE directement, pas
    // seulement le store, pour une ligne dont c'est le DERNIER filet (laine
    // supprimée définitivement, aucun autre endroit où la retrouver).
    const inDb = await db.purchases.get(id1)
    expect(inDb).toBeTruthy()
    expect(inDb.yarnLabel).toBe('Laine à restaurer')
    expect(inDb.bain).toBe('B-2026-01')
    expect(inDb.date).toBe('2026-01-10')
  })

  it('8. aucun achat : état vide (EmptyStateArt), pas un « 0 € » nu', async () => {
    const w = mountView()
    expect(w.findComponent(EmptyStateArt).exists()).toBe(true)
    expect(w.find('.exp__totals').exists()).toBe(false)
    expect(w.text()).toContain(fr.expenses.empty)
    // Non-régression (retour terrain, 01/08) : le sélecteur Année apparaît désormais dès
    // qu'il y a du contenu, mais ZÉRO achat reste l'écran vide d'avant, sans sélecteur.
    expect(w.find('[data-test="expenses-year-select"]').exists()).toBe(false)
  })

  // Correctif final (revue de branche) : App.vue posait `ensureReprise`/`purchasesStore.load()`
  // en QUEUE de sa chaîne `onMounted`, sans filet — toute exception en amont (rien à voir
  // avec la reprise elle-même) laissait ce store vide pour toute la session, et cet écran
  // ne rechargeait jamais rien lui-même. Écrit DIRECTEMENT en base (pas via `addLine`, qui
  // appelle `store.add()` et donc `load()` en interne : un test bâti dessus ne pourrait pas
  // échouer, cf. « un test dont l'assertion ne pourrait pas échouer est un défaut »).
  it('9. filet de démarrage : le store se charge encore si App.vue ne l’a pas fait (régression)', async () => {
    await db.purchases.add({
      kind: 'buy', currency: 'EUR', yarnId: 9, yarnLabel: 'Laine filet',
      quantity: 5, unitPrice: '13', date: '2026-07-11',
    }) // 65 : nombre discriminant, absent du reste du fichier
    const store = usePurchasesStore()
    expect(store.loaded).toBe(false) // reproduit le cas réel : rien n'a encore chargé ce store
    const w = mountView()
    await vi.waitFor(() => expect(w.text()).toContain('Laine filet'), { timeout: 10000 })
    expect(w.findAll('.exp__stat-num').map((n) => n.text())).toEqual(['65'])
  })

  // Correctif final (revue de branche) : `yarnLabel` n'est écrit qu'à la création de la
  // ligne et par la reprise — il ne suit jamais un renommage ultérieur de la fiche. Sans
  // le correctif, le renommage laisserait l'ancien libellé figé affiché indéfiniment.
  it('10. laine renommée après l’achat : l’écran affiche le nom ACTUEL, pas le libellé figé', async () => {
    await db.yarns.add({ id: 21, brand: 'Drops', model: 'Nepal', colorName: 'Bleu ciel' })
    await db.purchases.add({
      kind: 'buy', currency: 'EUR', yarnId: 21, yarnLabel: 'Drops · Nepal · Bleu ciel',
      quantity: 1, unitPrice: '10', date: '2026-03-11',
    })
    await db.yarns.update(21, { colorName: 'Gris perle' }) // renommage APRÈS l'achat
    const w = mountView()
    await vi.waitFor(() => expect(w.text()).toContain('Drops · Nepal · Gris perle'), { timeout: 10000 })
    expect(w.text()).not.toContain('Drops · Nepal · Bleu ciel') // l'ancien libellé figé ne doit plus apparaître
  })

  // Correctif final (revue de branche) : sans verrou, un double-appui rapide sur
  // « Supprimer » enchaîne deux suppressions Dexie concurrentes — la seconde (get + delete
  // sur une ligne déjà partie) renvoie `undefined`, qu'un « Annuler » ultérieur écrirait tel
  // quel en base. Les deux clics sont déclenchés SYNCHRONEMENT (pas de await entre les
  // deux) pour reproduire fidèlement la course, contrairement à `await ... trigger('click')`
  // deux fois de suite qui laisserait la première suppression se terminer avant la seconde.
  it('12. verrou anti double-appui : un double clic rapide ne supprime qu’une seule fois', async () => {
    const id1 = await addLine({ quantity: 1, unitPrice: '19', date: '2026-05-09' })
    const w = mountView()
    const store = usePurchasesStore()
    const removeSpy = vi.spyOn(store, 'remove')

    const btn = w.find(`[data-test="expenses-delete-${id1}"]`)
    btn.trigger('click') // 1er clic, pas de await : la promesse de remove() n'a pas encore résolu
    await flushPromises() // laisse Vue re-rendre le bouton désactivé, SANS attendre la fin de remove()
    expect(w.find(`[data-test="expenses-delete-${id1}"]`).attributes('disabled')).not.toBeUndefined()
    await w.find(`[data-test="expenses-delete-${id1}"]`).trigger('click') // 2e clic, pendant que le 1er est en vol

    await vi.waitFor(() => expect(store.purchases.map((l) => l.id)).not.toContain(id1), { timeout: 10000 })
    expect(removeSpy).toHaveBeenCalledTimes(1)
  })

  it('11. laine supprimée DÉFINITIVEMENT : l’écran affiche le libellé figé, faute de fiche vivante', async () => {
    await db.purchases.add({
      kind: 'buy', currency: 'EUR', yarnId: null, yarnLabel: 'Katia · Fil arrêté',
      quantity: 1, unitPrice: '8', date: '2026-04-22',
    })
    const w = mountView()
    await vi.waitFor(() => expect(useYarnsStore().loaded).toBe(true), { timeout: 10000 })
    await flushPromises()
    expect(w.text()).toContain('Katia · Fil arrêté')
  })
})

// ─── Filtre par année (retour terrain, 01/08) ─────────────────────────────
// Trois montants et deux dates TOUS DISTINCTS (22, 27, 13 — plus 18/35 au test
// 21) : leçon du lot, cinq jeux d'essai à valeurs coïncidentes ont déjà piégé
// cinq tâches précédentes. Fixture canonique des tests 17 à 19 : deux années
// réelles (2026 = 22, 2025 = 27) PLUS une ligne sans date (13) — le scénario
// où le sélecteur doit apparaître (2 années) ET où « Date inconnue » doit
// rester une option atteignable.
describe('ExpensesView — filtre par année', () => {
  async function addThreeGroups() {
    await addLine({ quantity: 4, unitPrice: '5,50', date: '2026-01-10', yarnLabel: 'Laine 2026' }) // 22
    await addLine({ quantity: 3, unitPrice: '9', date: '2025-03-05', yarnLabel: 'Laine 2025' }) // 27
    await addLine({ quantity: 1, unitPrice: '13', date: '', yarnLabel: 'Laine sans date' }) // 13
  }

  it('17. par défaut ("Toutes les années") : tout s’affiche (non-régression), la mention indique le début', async () => {
    await addThreeGroups()
    const w = mountView()
    expect(w.find('[data-test="expenses-year-select"]').exists()).toBe(true) // 2 années réelles ⇒ sélecteur présent
    expect(w.findAll('.exp__stat-num').map((n) => n.text())).toEqual(['62']) // 22 + 27 + 13
    const period = w.find('[data-test="expenses-period"]')
    expect(period.text()).toBe(fr.expenses.periodAll)
    expect(period.attributes('role')).toBe('status') // sinon changer d'année ne dit rien à un lecteur d'écran
    expect(w.text()).toContain('Laine 2026')
    expect(w.text()).toContain('Laine 2025')
    expect(w.text()).toContain('Laine sans date')
  })

  // Revue de tâche (01/08) : la mention `<p class="exp__period">` était imbriquée
  // DANS le bloc `v-if="totalCurrencies.length"` — or `totalsByCurrency` ignore les
  // montants nuls, et un cadeau vaut zéro. Filtrer sur une année qui ne contient
  // QUE des cadeaux faisait donc disparaître toute la carte de totaux, mention
  // comprise, alors que la liste en dessous restait filtrée : exactement l'inverse
  // de « tout ce qui est à l'écran doit parler de la même période ». La mention est
  // maintenant un FRÈRE du bloc de totaux, pas un enfant.
  it('22. une année qui ne contient qu’un cadeau : la mention de période reste affichée, la liste reste filtrée', async () => {
    await addLine({ quantity: 4, unitPrice: '5,50', date: '2026-01-10', yarnLabel: 'Laine achetée' }) // 22, autre année
    await addLine({ kind: 'gift', quantity: 1, unitPrice: '', date: '2025-06-01', yarnLabel: 'Laine offerte' }) // cadeau, montant nul
    const w = mountView()
    await w.find('[data-test="expenses-year-select"]').setValue('2025')
    await flushPromises()

    expect(w.find('.exp__totals').exists()).toBe(false) // aucun montant non nul cette année-là : pas de tuile de total
    const period = w.find('[data-test="expenses-period"]')
    expect(period.exists()).toBe(true) // mais la mention de période, elle, NE disparaît PAS
    expect(period.text()).toBe(fr.expenses.periodYear.replace('{year}', '2025'))
    expect(w.text()).toContain('Laine offerte')
    expect(w.text()).not.toContain('Laine achetée') // la liste reste bien filtrée sur 2025
  })

  it('18. choisir une année ne laisse que ses achats dans la liste ET change le grand total, période mentionnée', async () => {
    await addThreeGroups()
    const w = mountView()
    await w.find('[data-test="expenses-year-select"]').setValue('2025')
    await flushPromises()

    expect(w.findAll('.exp__stat-num').map((n) => n.text())).toEqual(['27']) // pas 62 : le total suit le filtre
    expect(w.text()).toContain('Laine 2025')
    expect(w.text()).not.toContain('Laine 2026')
    expect(w.text()).not.toContain('Laine sans date')
    expect(w.find('[data-test="expenses-period"]').text()).toBe(fr.expenses.periodYear.replace('{year}', '2025'))
  })

  it('19. les achats sans date restent atteignables : choisir « Date inconnue » ne garde qu’eux, total inclus', async () => {
    await addThreeGroups()
    const w = mountView()
    await w.find('[data-test="expenses-year-select"]').setValue('unknown')
    await flushPromises()

    expect(w.findAll('.exp__stat-num').map((n) => n.text())).toEqual(['13'])
    expect(w.text()).toContain('Laine sans date')
    expect(w.text()).not.toContain('Laine 2026')
    expect(w.text()).not.toContain('Laine 2025')
    expect(w.find('[data-test="expenses-period"]').text()).toBe(fr.expenses.unknownDate)
  })

  // Retour d'usage (01/08, après la révision ci-dessous) : « je ne vois pas le menu
  // Année sur l'écran Dépenses ». La règle « au moins deux états utiles » précédemment
  // pinnée par ce test était déroutante en pratique — sur sa base, une fiche sans date
  // rend TOUS ses achats « sans date », donc un seul état, donc jamais de sélecteur, sans
  // qu'il ne comprenne pourquoi. Ce test est désormais l'INVERSE de ce qu'il prouvait :
  // le sélecteur apparaît dès qu'il y a du contenu, même une seule année, sans ligne sans
  // date (le cas exact que ce test construit).
  it('20. une seule année réelle, aucun achat sans date : le sélecteur est affiché quand même (dès qu’il y a du contenu)', async () => {
    await addLine({ quantity: 1, unitPrice: '11', date: '2026-01-10' })
    await addLine({ quantity: 1, unitPrice: '16', date: '2026-08-20' }) // même année, mois différent : toujours 1 SEULE année
    const w = mountView()
    expect(w.find('[data-test="expenses-year-select"]').exists()).toBe(true)
  })

  // Le scénario exact du retour terrain : sur une base réelle, toutes les fiches sans
  // date d'achat propre font que TOUS ses achats reconstruits sont « sans date » — un seul
  // achat, sans date, doit malgré tout afficher le sélecteur (avec les deux seules options
  // qui existent alors : « Toutes les années » et « Date inconnue »).
  it('20c. un seul achat, sans date : le sélecteur est rendu, avec « Toutes les années » et « Date inconnue »', async () => {
    await addLine({ quantity: 1, unitPrice: '19', date: '' })
    const w = mountView()
    const select = w.find('[data-test="expenses-year-select"]')
    expect(select.exists()).toBe(true)
    const optionsText = select.findAll('option').map((o) => o.text())
    expect(optionsText).toEqual([fr.expenses.yearFilterAll, fr.expenses.unknownDate])
  })

  // Revue de tâche (01/08) : le doute initial (sélecteur absent dans ce cas) est
  // tranché dans l'AUTRE sens — masquer le sélecteur priverait l'utilisatrice de la
  // capacité d'ISOLER les achats sans date et de voir leur propre sous-total,
  // même si rien ne serait techniquement perdu (« Toutes les années » montre
  // déjà tout). Une seule année réelle PLUS des achats sans date = deux états
  // utiles (« Toutes les années » / « Date inconnue »), donc sélecteur PRÉSENT.
  it('20b. une seule année réelle + des achats sans date : le sélecteur reste présent, pour isoler les sans-date', async () => {
    await addLine({ quantity: 1, unitPrice: '11', date: '2026-01-10', yarnLabel: 'Laine datée seule' })
    await addLine({ quantity: 1, unitPrice: '9', date: '', yarnLabel: 'Laine sans date isolée' })
    const w = mountView()
    const select = w.find('[data-test="expenses-year-select"]')
    expect(select.exists()).toBe(true)

    await select.setValue('unknown')
    await flushPromises()
    expect(w.findAll('.exp__stat-num').map((n) => n.text())).toEqual(['9']) // isolé de la ligne datée
    expect(w.text()).toContain('Laine sans date isolée')
    expect(w.text()).not.toContain('Laine datée seule')
  })

  it('21. deux devises restent séparées APRÈS filtrage par année (jamais additionnées)', async () => {
    await addLine({ quantity: 3, unitPrice: '6', currency: 'EUR', date: '2026-03-01' }) // 18
    await addLine({ quantity: 5, unitPrice: '7', currency: 'USD', date: '2026-04-01' }) // 35
    await addLine({ quantity: 1, unitPrice: '50', currency: 'EUR', date: '2025-02-01' }) // 50, autre année (fait apparaître le sélecteur)
    const w = mountView()
    await w.find('[data-test="expenses-year-select"]').setValue('2026')
    await flushPromises()

    const nums = w.findAll('.exp__stat-num').map((n) => n.text())
    expect(nums).toHaveLength(2)
    expect(nums).toContain('18')
    expect(nums).toContain('35')
    expect(nums).not.toContain('53') // 18 + 35 : ne doit JAMAIS apparaître additionné
  })
})

// ─── Deux catégories de dépense (prix du patron, 07/08) ─────────────
// L'écran ne calcule rien de neuf : il concatène les lignes d'achat de laine et les lignes de
// dépense FABRIQUÉES à partir des patrons payants, puis passe le tout au calcul existant.
//
// Montants tous distincts (7×3=21 laine, 18 patron, 0 patron gratuit) : un jeu où deux
// nombres coïncident laisserait passer une assertion pour la mauvaise raison.
describe('ExpensesView — laine et patrons', () => {
  // `db.patterns.add` retourne l'id RÉEL — ne jamais supposer 1 (point de vigilance) : ce
  // fichier ouvre la même base tout au long de la suite, `.clear()` dans `beforeEach` ne
  // garantit pas la remise à zéro du compteur auto-incrément selon l'implémentation
  // d'IndexedDB. Capturé ici pour que P6/P9/P10 lisent l'id réel plutôt qu'une constante.
  let sabaiId

  async function monterAvecLesDeux() {
    await usePurchasesStore().add({
      yarnId: null, yarnLabel: 'Drops · Air', kind: 'buy', quantity: 3, unitPrice: '7',
      currency: 'EUR', date: '2026-03-04',
    })
    sabaiId = await db.patterns.add({
      name: 'Sabai', type: 'knitting', price: '18', priceCurrency: 'EUR', purchasedAt: '2026-03-12',
    })
    await db.patterns.add({
      name: 'Twist Loop', type: 'knitting', price: '0', priceCurrency: 'EUR', purchasedAt: '2026-03-20',
    })
    await usePatternsStore().load()
    return mountView() // helper de montage déjà présent dans ce fichier
  }

  it('P1. les patrons payants apparaissent dans la liste, avec leur nom', async () => {
    const w = await monterAvecLesDeux()
    expect(w.text()).toContain('Sabai')
    expect(w.text()).toContain('Twist Loop')
  })

  it('P2. le total général additionne laine ET patrons', async () => {
    const w = await monterAvecLesDeux()
    // 3 × 7 = 21 de laine, + 18 de patron = 39. Le gratuit n'ajoute rien.
    expect(w.find('[data-test="expenses-totals"]').text()).toContain('39')
  })

  it('P3. la ventilation montre les deux sous-totaux', async () => {
    const w = await monterAvecLesDeux()
    const brk = w.find('[data-test="expenses-breakdown"]')
    expect(brk.exists()).toBe(true)
    expect(brk.text()).toContain(fr.expenses.categoryYarn)
    expect(brk.text()).toContain(fr.expenses.categoryPattern)
    expect(brk.text()).toContain('21')
    expect(brk.text()).toContain('18')
  })

  // Renforcé (revue) : l'intitulé promettait un écran « STRICTEMENT » celui d'avant, mais
  // seule l'absence de la ventilation était vérifiée — l'étiquette de catégorie (§6.2 point 3)
  // suit désormais la MÊME garde `hasPatternLines` que la ventilation (décision produit,
  // tranchée sur une tension entre exigences : l'étiquette sans condition était du bruit
  // visuel sur un écran 100 % laine, aucune information). Sélecteur `.exp__line-tags .tag`
  // volontairement scopé : il exclut l'étiquette « Laine supprimée » (`.exp__orphan-tag`, dans
  // `.exp__line-main`, jamais concernée par cette garde) — un `w.text().not.toContain('Laine')`
  // aurait mordu dessus par accident (« Laine » est une SOUS-CHAÎNE de « Laine supprimée »).
  it('P4. SANS aucun patron payant, l’écran reste STRICTEMENT celui d’avant : ni ventilation ni étiquette de catégorie', async () => {
    await usePurchasesStore().add({
      yarnId: null, yarnLabel: 'Drops · Air', kind: 'buy', quantity: 3, unitPrice: '7',
      currency: 'EUR', date: '2026-03-04',
    })
    await usePatternsStore().load()
    const w = mountView()
    expect(w.find('[data-test="expenses-breakdown"]').exists()).toBe(false)
    const categoryTags = w.findAll('.exp__line-tags .tag').map((el) => el.text())
    expect(categoryTags).not.toContain(fr.expenses.tagYarn)
    expect(categoryTags).not.toContain(fr.expenses.tagPattern)
  })

  it('P5. le menu Type isole une catégorie, et le total suit', async () => {
    const w = await monterAvecLesDeux()
    await w.find('[data-test="expenses-category-select"]').setValue('pattern')
    expect(w.text()).toContain('Sabai')
    expect(w.text()).not.toContain('Drops · Air')
    expect(w.find('[data-test="expenses-totals"]').text()).toContain('18')
  })

  it('P6. une ligne de patron porte l’étiquette « Patron », jamais « Laine supprimée »', async () => {
    const w = await monterAvecLesDeux()
    const ligne = w.find(`[data-test="expenses-line-pat:${sabaiId}"]`)
    expect(ligne.exists()).toBe(true)
    expect(ligne.text()).toContain(fr.expenses.tagPattern)
    expect(ligne.text()).not.toContain(fr.expenses.orphanTag)
  })

  it('P7. une ligne de laine ORPHELINE garde bien SON étiquette « Laine supprimée »', async () => {
    const w = await monterAvecLesDeux()
    const lignes = w.findAll('.exp__line').filter((l) => l.text().includes('Drops · Air'))
    expect(lignes[0].text()).toContain(fr.expenses.orphanTag)
  })

  it('P8. un patron GRATUIT affiche « Gratuit », pas un montant', async () => {
    const w = await monterAvecLesDeux()
    const lignes = w.findAll('.exp__line').filter((l) => l.text().includes('Twist Loop'))
    expect(lignes[0].text()).toContain(fr.expenses.freeTag)
  })

  it('P9. une ligne de patron n’a PAS de croix de suppression', async () => {
    const w = await monterAvecLesDeux()
    expect(w.find(`[data-test="expenses-delete-pat:${sabaiId}"]`).exists()).toBe(false)
    // …tandis qu'une ligne de laine garde la sienne
    expect(w.findAll('.exp__line-delete').length).toBe(1)
  })

  it('P10. une ligne de patron n’affiche PAS de « ×1 » : la quantité n’a aucun sens ici', async () => {
    const w = await monterAvecLesDeux()
    const ligne = w.find(`[data-test="expenses-line-pat:${sabaiId}"]`)
    expect(ligne.find('.exp__line-qty').exists()).toBe(false)
  })

  it('P11. une année où l’on n’a acheté QU’UN patron apparaît dans le menu Année', async () => {
    await db.patterns.add({
      name: 'Ancien', type: 'knitting', price: '12', priceCurrency: 'EUR', purchasedAt: '2024-02-02',
    })
    const w = await monterAvecLesDeux()
    const options = w.find('[data-test="expenses-year-select"]').findAll('option').map((o) => o.element.value)
    expect(options).toContain('2024')
  })

  // Ajoutée : P11 seule NE MORD PAS sur M3 (la mutation « availableYears lit filteredLines »).
  // Raison : dans `monterAvecLesDeux`, la ligne de laine ET les deux patrons partagent tous
  // l'année 2026, et la seule année « pure patron » (2024, « Ancien ») reste présente que le
  // filtre soit 'all' (défaut de P11) ou 'pattern' — aucune année n'est EXCLUSIVEMENT de la
  // laine dans ce jeu, donc rien ne peut disparaître pour la distinguer. Ce test construit
  // exprès une année qui n'a QUE de la laine (2023) pour vérifier que la choisir « Patrons »
  // ne la fait PAS disparaître du menu Année — exactement le symptôme décrit précédemment
  // pour M3 : « l'utilisatrice se retrouverait coincée sur une liste vide sans explication ».
  it('P11b. choisir « Patrons » ne fait pas disparaître une année où l’on n’a acheté QUE de la laine', async () => {
    await usePurchasesStore().add({
      yarnId: null, yarnLabel: 'Katia · Concept', kind: 'buy', quantity: 1, unitPrice: '9',
      currency: 'EUR', date: '2023-05-01',
    })
    await db.patterns.add({
      name: 'Sabai', type: 'knitting', price: '18', priceCurrency: 'EUR', purchasedAt: '2026-03-12',
    })
    await usePatternsStore().load()
    const w = mountView()
    await w.find('[data-test="expenses-category-select"]').setValue('pattern')
    await flushPromises()
    const options = w.find('[data-test="expenses-year-select"]').findAll('option').map((o) => o.element.value)
    expect(options).toContain('2023') // année 100% laine : doit rester choisissable même sous le filtre Patrons
  })
})

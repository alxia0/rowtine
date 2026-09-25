// @vitest-environment jsdom
// tests/unit/yarn-purchases.spec.js
// Bloc « Achats et cadeaux » d'une fiche de laine : liste repliable, total, alerte
// d'écart. Les nombres attendus sont écrits à la main.
// Motif de montage calqué sur tests/unit/yarn-detail-dialog.spec.js : i18n réel
// (pas de mock de `t`), Pinia réelle. La base est une vraie Dexie (fake-indexeddb,
// cf. tests/unit/setup.js) : les lignes d'achat sont écrites via le VRAI store
// (usePurchasesStore().add) avant chaque montage, comme tests/unit/purchases.store.spec.js —
// c'est ce qui rend les mutations du composant (étape 5) observables : le
// composant lit forYarn()/totalsByCurrency() en vrai, rien n'est simulé.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import fr from '@/i18n/fr.json'
import { usePurchasesStore } from '@/stores/purchases'
import { useSnackbarStore } from '@/stores/snackbar'
import YarnPurchases from '@/components/YarnPurchases.vue'
import { createTestI18n } from './helpers/i18n-router'

const i18n = createTestI18n()

const YARN_ID = 1
const YARN_LABEL = 'DROPS · Bleu ciel'

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
  return store.add({ yarnId: YARN_ID, yarnLabel: YARN_LABEL, ...overrides })
}

// `yarn` par défaut : quantité restante 12, rien de consommé → acquiredFromStock = 12,
// aligné sur l'historique dans la plupart des tests (pas d'alerte parasite).
function mountComp(props = {}) {
  wrapper = mount(YarnPurchases, {
    props: {
      yarnId: YARN_ID,
      yarn: { id: YARN_ID, quantity: 12, consumed: {} },
      yarnLabel: YARN_LABEL,
      ...props,
    },
    global: { plugins: [i18n, pinia], stubs: { AppIcon: true } },
    attachTo: document.body,
  })
  return wrapper
}

function lineRows(w) {
  return w.findAll('.ypur__line')
}

describe('YarnPurchases', () => {
  it('1. trois lignes ou moins : tout est visible, pas de bouton « voir plus »', async () => {
    await addLine({ quantity: 1, date: '2026-01-01' })
    await addLine({ quantity: 1, date: '2026-02-01' })
    await addLine({ quantity: 1, date: '2026-03-01' })
    const w = mountComp()
    expect(lineRows(w)).toHaveLength(3)
    expect(w.find('[data-test="purchases-show-more"]').exists()).toBe(false)
  })

  it('2. cinq lignes : trois visibles, un bouton annonce le reste (2) et les révèle', async () => {
    await addLine({ quantity: 1, date: '2026-01-01' })
    await addLine({ quantity: 1, date: '2026-02-01' })
    await addLine({ quantity: 1, date: '2026-03-01' })
    await addLine({ quantity: 1, date: '2026-04-01' })
    await addLine({ quantity: 1, date: '2026-05-01' })
    const w = mountComp()
    expect(lineRows(w)).toHaveLength(3)
    const more = w.find('[data-test="purchases-show-more"]')
    expect(more.exists()).toBe(true)
    expect(more.text()).toContain(fr.purchases.showMore.replace('{n}', '2'))
    await more.trigger('click')
    expect(lineRows(w)).toHaveLength(5)
  })

  it('3. total : 4×5,50 (achat) + 1 cadeau de 2 pelotes ⇒ « 22 » et « 6 pelotes »', async () => {
    await addLine({ kind: 'buy', quantity: 4, unitPrice: '5,50', currency: 'EUR', date: '2026-01-01' })
    // unitPrice non vide À DESSEIN sur ce cadeau : preuve que le total ignore le prix
    // d'une ligne 'gift' plutôt que de le voir vide par coïncidence (cf. step 5, mutation 2).
    await addLine({ kind: 'gift', quantity: 2, unitPrice: '3', currency: 'EUR', date: '2026-02-01' })
    const w = mountComp()
    const nums = w.findAll('.ypur__num').map((n) => n.text())
    expect(nums).toContain('22')
    expect(nums).toContain('6')
    expect(w.text()).toContain(fr.yarn.skeins)
  })

  it('4a. écart : stock 15 (12 restantes + 3 tricotées), historique 12 ⇒ message exact, dans le bon ordre', async () => {
    await addLine({ kind: 'buy', quantity: 12, unitPrice: '4', currency: 'EUR', date: '2026-01-01' })
    const w = mountComp({ yarn: { id: YARN_ID, quantity: 12, consumed: { 1: 3 } } })
    const alert = w.find('[data-test="purchases-gap"]')
    expect(alert.exists()).toBe(true)
    // Assertion sur la PHRASE COMPLÈTE (pas deux `toContain` indépendants) : une inversion
    // des deux nombres dans les paramètres passés à `t()` resterait invisible à
    // `toContain('15')` + `toContain('12')` pris séparément (revue, constat I1).
    expect(alert.text()).toContain(fr.purchases.gapMessage.replace('{stock}', '15').replace('{history}', '12'))
    // Correctif final (revue de branche) : l'alerte apparaît APRÈS le rendu (pas dans le
    // HTML initial), un lecteur d'écran ne la verrait donc jamais sans rôle d'annonce.
    expect(alert.attributes('role')).toBe('status')
  })

  it('4b. écart : historique 15 ⇒ AUCUNE alerte rendue', async () => {
    await addLine({ kind: 'buy', quantity: 15, unitPrice: '4', currency: 'EUR', date: '2026-01-01' })
    const w = mountComp({ yarn: { id: YARN_ID, quantity: 12, consumed: { 1: 3 } } })
    expect(w.find('[data-test="purchases-gap"]').exists()).toBe(false)
  })

  it('5. « Corriger » propose les deux sens (ajouter la ligne manquante / ajuster le stock)', async () => {
    await addLine({ kind: 'buy', quantity: 12, unitPrice: '4', currency: 'EUR', date: '2026-01-01' })
    const w = mountComp({ yarn: { id: YARN_ID, quantity: 12, consumed: { 1: 3 } } })
    await w.find('[data-test="purchases-correct"]').trigger('click')
    expect(w.find('[data-test="purchases-correct-add"]').exists()).toBe(true)
    expect(w.find('[data-test="purchases-correct-adjust"]').exists()).toBe(true)
  })

  it('5b. « ajouter la ligne manquante » préremplit la quantité avec l’écart et laisse choisir achat/cadeau', async () => {
    // écart = 15 - 12 = 3 (nombre discriminant : ni 1, ni 12, ni 15) — cf. étape 3.
    await addLine({ kind: 'buy', quantity: 12, unitPrice: '4', currency: 'EUR', date: '2026-01-01' })
    const w = mountComp({ yarn: { id: YARN_ID, quantity: 12, consumed: { 1: 3 } } })
    await w.find('[data-test="purchases-correct"]').trigger('click')
    await w.find('[data-test="purchases-correct-add"]').trigger('click')
    const form = w.find('[data-test="purchases-form"]')
    expect(form.exists()).toBe(true)
    expect(w.find('#ypur-qty').element.value).toBe('3')
    expect(form.text()).toContain(fr.purchases.kindBuy)
    expect(form.text()).toContain(fr.purchases.kindGift)
  })

  it('5c. soumettre « ajouter la ligne manquante » écrit une nouvelle ligne (pas de collision d’id après une édition annulée)', async () => {
    // Régression : `openEdit` copie `line.id` dans `form` ; sans nettoyage explicite, un
    // cycle Modifier → Annuler → Corriger → Ajouter la ligne manquante enverrait cet id à
    // `purchasesStore.add()` (ConstraintError Dexie silencieuse, rien n'écrit).
    const editedId = await addLine({ kind: 'buy', quantity: 12, unitPrice: '4', currency: 'EUR', date: '2026-01-01' })
    const w = mountComp({ yarn: { id: YARN_ID, quantity: 12, consumed: { 1: 3 } } })
    const store = usePurchasesStore()

    await w.find('.ypur__line-btn').trigger('click') // « Modifier » (1er bouton de la ligne)
    await w.find('[data-test="purchases-form-cancel"]').trigger('click')

    await w.find('[data-test="purchases-correct"]').trigger('click')
    await w.find('[data-test="purchases-correct-add"]').trigger('click')
    await w.find('[data-test="purchases-form-save"]').trigger('click')

    await vi.waitFor(() => expect(store.purchases).toHaveLength(2), { timeout: 10000 })
    const added = store.purchases.find((l) => l.id !== editedId)
    expect(added.quantity).toBe(3)
    expect(store.purchases.find((l) => l.id === editedId).quantity).toBe(12) // ligne éditée intacte
  })

  it('5d. « ajouter la ligne manquante » en cadeau enregistre kind « gift » avec le prix vidé', async () => {
    // Preuve que le bouton « Cadeau » du formulaire est réellement cliqué et enregistré
    // (revue, constat I3) : un prix saisi PUIS abandonné (bascule achat → cadeau)
    // doit ressortir vide en base, pas juste absent de l'écran.
    await addLine({ kind: 'buy', quantity: 12, unitPrice: '4', currency: 'EUR', date: '2026-01-01' })
    const w = mountComp({ yarn: { id: YARN_ID, quantity: 12, consumed: { 1: 3 } } })
    const store = usePurchasesStore()
    await w.find('[data-test="purchases-correct"]').trigger('click')
    await w.find('[data-test="purchases-correct-add"]').trigger('click')
    await w.find('#ypur-price').setValue('9')
    const giftBtn = w.findAll('.seg__opt').find((b) => b.text() === fr.purchases.kindGift)
    await giftBtn.trigger('click')
    await w.find('[data-test="purchases-form-save"]').trigger('click')
    await vi.waitFor(() => expect(store.purchases).toHaveLength(2), { timeout: 10000 })
    const added = store.purchases.find((l) => l.quantity === 3)
    expect(added).toBeTruthy()
    expect(added.kind).toBe('gift')
    expect(added.unitPrice).toBe('')
  })

  // Protège : un prix réduit à un séparateur (« , ») est enregistré comme inconnu, pas comme 0.
  it('5d-bis. un prix unitaire « , » seul est enregistré vide', async () => {
    await addLine({ kind: 'buy', quantity: 12, unitPrice: '4', currency: 'EUR', date: '2026-01-01' })
    const w = mountComp({ yarn: { id: YARN_ID, quantity: 12, consumed: { 1: 3 } } })
    const store = usePurchasesStore()
    await w.find('[data-test="purchases-correct"]').trigger('click')
    await w.find('[data-test="purchases-correct-add"]').trigger('click')
    await w.find('#ypur-price').setValue(',')
    await w.find('[data-test="purchases-form-save"]').trigger('click')
    await vi.waitFor(() => expect(store.purchases).toHaveLength(2), { timeout: 10000 })
    expect(store.purchases.find((l) => l.quantity === 3).unitPrice).toBe('')
  })

  // Correctif final (revue de branche) : un écart NÉGATIF (l'historique dépasse déjà le
  // stock) ne doit plus offrir « ajouter l'achat manquant » — le clic doublerait l'écart
  // au lieu de le corriger, gonflant le budget d'un achat qui n'a jamais eu lieu. Nombres
  // distincts (10 restantes + 3 tricotées = stock acquis 13, historique 20, écart -7) —
  // aucun ne coïncide avec les autres fixtures de ce fichier.
  it('5e. écart NÉGATIF : « ajouter l’achat manquant » n’est PAS offert, « ajuster le stock » l’est toujours, l’alerte reste affichée', async () => {
    await addLine({ kind: 'buy', quantity: 20, unitPrice: '4', currency: 'EUR', date: '2026-01-01' })
    const w = mountComp({ yarn: { id: YARN_ID, quantity: 10, consumed: { 1: 3 } } }) // stock acquis 13, historique 20, écart -7
    const alert = w.find('[data-test="purchases-gap"]')
    expect(alert.exists()).toBe(true) // l'alerte reste bien affichée
    await w.find('[data-test="purchases-correct"]').trigger('click')
    expect(w.find('[data-test="purchases-correct-add"]').exists()).toBe(false) // absent : jamais offert sur écart négatif
    expect(w.find('[data-test="purchases-correct-adjust"]').exists()).toBe(true) // présent dans les deux sens
  })

  // Symétrique du test précédent : un écart POSITIF garde le bouton offert (déjà couvert
  // par le test 5 ci-dessus, mais celui-ci l'affirme sur des nombres DIFFÉRENTS pour ne
  // pas dépendre de la même fixture que la mutation ci-dessous doit faire rougir).
  it('5f. écart POSITIF : « ajouter l’achat manquant » reste offert', async () => {
    await addLine({ kind: 'buy', quantity: 5, unitPrice: '4', currency: 'EUR', date: '2026-01-01' })
    const w = mountComp({ yarn: { id: YARN_ID, quantity: 10, consumed: {} } }) // stock acquis 10, historique 5, écart +5
    await w.find('[data-test="purchases-correct"]').trigger('click')
    expect(w.find('[data-test="purchases-correct-add"]').exists()).toBe(true)
    expect(w.find('[data-test="purchases-correct-adjust"]').exists()).toBe(true)
  })

  it('6. « ajuster le stock » émet l’historique MOINS la consommation (pas le total acquis), et n’écrit rien en base', async () => {
    // Nombres discriminants (revue, constat C1) : 14 restantes + 6 déjà tricotées
    // (stock-implied = 20), historique = 11. La bonne valeur émise est 11 - 6 = 5, distincte
    // de 14 (restant), 20 (stock-implied) et 11 (historique) — un test qui accepterait
    // n'importe lequel de ces trois nombres à la place de 5 ne prouverait rien (c'est
    // exactement ce que la revue a démontré en substituant `props.yarn.quantity`,
    // qui valait 12 dans l'ancien jeu d'essai où historique valait aussi 12).
    await addLine({ kind: 'buy', quantity: 11, unitPrice: '4', currency: 'EUR', date: '2026-01-01' })
    const w = mountComp({ yarn: { id: YARN_ID, quantity: 14, consumed: { 1: 6 } } })
    const store = usePurchasesStore()
    const addSpy = vi.spyOn(store, 'add')
    const updateSpy = vi.spyOn(store, 'update')
    await w.find('[data-test="purchases-correct"]').trigger('click')
    const adjustBtn = w.find('[data-test="purchases-correct-adjust"]')
    expect(adjustBtn.text()).toContain('5')
    await adjustBtn.trigger('click')
    expect(w.emitted('update:quantity')).toEqual([[5]])
    // Vérifie l'ABSENCE d'écriture après un délai, pas seulement juste après le clic : une
    // écriture en vol (promesse non résolue synchronement) passerait une assertion prise
    // trop tôt (revue, constat I4).
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(addSpy).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('7. supprimer une ligne la retire du store et propose l’annulation (snackbar)', async () => {
    const id = await addLine({ quantity: 2, date: '2026-01-01' })
    const w = mountComp()
    const store = usePurchasesStore()
    const snackbar = useSnackbarStore()
    expect(store.purchases.map((l) => l.id)).toContain(id)
    await w.find('[data-test="purchases-delete"]').trigger('click')
    // Suppression = 2 allers-retours Dexie réels (get + delete) puis un reload : un seul
    // flushPromises() ne suffit pas toujours à tout drainer (motif tests/unit/home-view.spec.js).
    await vi.waitFor(() => expect(store.purchases.map((l) => l.id)).not.toContain(id), { timeout: 10000 })
    expect(snackbar.visible).toBe(true)
    expect(snackbar.actionLabel).toBe(fr.common.undo)
  })

  it('8a. une ligne reconstructed porte sa mention', async () => {
    await addLine({ quantity: 2, unitPrice: '4', reconstructed: true, date: '2026-01-01' })
    const w = mountComp()
    expect(w.text()).toContain(fr.purchases.reconstructedTag)
  })

  it('8b. une ligne gift porte sa mention', async () => {
    await addLine({ kind: 'gift', quantity: 2, date: '2026-01-01' })
    const w = mountComp()
    expect(w.text()).toContain(fr.purchases.kindGift)
  })

  it('8c. un achat sans prix affiche « prix inconnu » et NON la mention cadeau', async () => {
    await addLine({ kind: 'buy', quantity: 2, unitPrice: '', date: '2026-01-01' })
    const w = mountComp()
    expect(w.text()).toContain(fr.purchases.priceUnknown)
    expect(w.text()).not.toContain(fr.purchases.kindGift)
  })

  // Correctif final (revue de branche, réouverture du 01/08) : App.vue posait
  // `ensureReprise`/`purchasesStore.load()` en queue de sa chaîne `onMounted`, sans filet —
  // toute exception en amont laissait ce store vide pour toute la session, et ce composant
  // ne rechargeait jamais rien lui-même (contrairement à HomeView et ExpensesView, qui ont
  // désormais leur propre filet). Écrit DIRECTEMENT en base (pas via `addLine()`, qui
  // appelle `store.add()` et donc `load()` en interne : un test bâti dessus ne pourrait pas
  // échouer, cf. « un test dont l'assertion ne pourrait pas échouer est un défaut »).
  it('9. filet de démarrage : le store se charge encore si App.vue ne l’a pas fait (régression)', async () => {
    await db.purchases.add({
      yarnId: YARN_ID, yarnLabel: YARN_LABEL, kind: 'buy', currency: 'EUR',
      quantity: 7, unitPrice: '9', date: '2026-02-18',
    }) // 63 : nombre discriminant, absent du reste du fichier
    const store = usePurchasesStore()
    expect(store.loaded).toBe(false) // reproduit le cas réel : rien n'a encore chargé ce store
    const w = mountComp()
    await vi.waitFor(() => expect(lineRows(w)).toHaveLength(1), { timeout: 10000 })
    expect(w.findAll('.ypur__num').map((n) => n.text())).toContain('63')
  })

  // Correctif final (revue de branche) : même verrou anti double-appui que StashView.vue
  // (`saving`/`resolvingPurchase`) posé sur la suppression d'une ligne — sans lui, un
  // double appui rapide enchaîne deux suppressions Dexie concurrentes, la seconde
  // renvoyant `undefined`, qu'un « Annuler » ultérieur écrirait tel quel en base
  // (exception). Deux clics SYNCHRONES (pas d'`await` entre les deux) pour reproduire
  // fidèlement la course — un double `await ... trigger('click')` laisserait la première
  // suppression se terminer avant la seconde.
  it('10. verrou anti double-appui : un double clic rapide ne supprime qu’une seule fois', async () => {
    const id = await addLine({ quantity: 2, date: '2026-06-01' })
    const w = mountComp()
    const store = usePurchasesStore()
    const removeSpy = vi.spyOn(store, 'remove')

    const btn = w.find('[data-test="purchases-delete"]')
    btn.trigger('click') // 1er clic, pas de await : la promesse de remove() n'a pas encore résolu
    await flushPromises() // laisse Vue re-rendre le bouton désactivé, SANS attendre la fin de remove()
    expect(w.find('[data-test="purchases-delete"]').attributes('disabled')).not.toBeUndefined()
    await w.find('[data-test="purchases-delete"]').trigger('click') // 2e clic, pendant que le 1er est en vol

    await vi.waitFor(() => expect(store.purchases.map((l) => l.id)).not.toContain(id), { timeout: 10000 })
    expect(removeSpy).toHaveBeenCalledTimes(1)
  })
})

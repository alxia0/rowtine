// @vitest-environment jsdom
// Unitaire — YarnEditView : le formulaire de laine écrit et propose des lignes d'achat
// (les travaux sur le budget laine, 01/08). Base réelle (Dexie) + Pinia réel : ces comportements
// traversent DEUX stores (yarns, purchases) et le point clé — l'id de la fiche qui vient de
// naître doit atterrir sur la ligne d'achat — ne se prouve pas avec des stores mockés.
// Modèle : tests/unit/YarnEditView.spec.js (même approche base réelle).
//
// Porté depuis StashView.vue (refonte stock laine, bascule fiche/navigation, Task 4) : le
// formulaire n'est plus inline dans la liste, il vit sur l'écran dédié YarnEditView.vue
// (routes stash-new / stash-edit, cf. Task 3 de la même branche) — mêmes id/placeholder de
// champs, donc les assertions de fond ne bougent pas, seul le montage change.
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia } from 'pinia'
import { db } from '@/db/db'
import { ymdLocal } from '@/utils/time-periods'
import YarnEditView from '@/views/YarnEditView.vue'
import { useSettingsStore } from '@/stores/settings'
import { usePurchasesStore } from '@/stores/purchases'
import { createTestI18n, createTestRouter } from './helpers/i18n-router'

const i18n = createTestI18n()
const stubs = { YarnWeightHelp: true, ColorPickerDialog: true }

function todayISO() {
  // Même calcul que l'implémentation (YarnEditView.vue:todayISO), qui est passée en heure
  // LOCALE le 21/08. Écrit en UTC ici, ce helper figeait la mauvaise référence : il ne
  // l'aurait montré qu'en tournant entre minuit et 02 h, heure française.
  return ymdLocal(new Date())
}

async function seedDb({ yarns = [], purchases = [] } = {}) {
  await db.yarns.clear()
  await db.settings.clear()
  await db.purchases.clear()
  for (const y of yarns) await db.yarns.add(y)
  for (const l of purchases) await db.purchases.add(l)
}

function makeRouter() {
  return createTestRouter([
    { path: '/stash', name: 'stash', component: { template: '<div />' } },
    { path: '/stash/:id', name: 'stash-item', component: { template: '<div />' } },
    { path: '/stash/new', name: 'stash-new', component: YarnEditView },
    { path: '/stash/:id/edit', name: 'stash-edit', component: YarnEditView },
  ])
}

// Monte YarnEditView à la route voulue (création, édition d'une fiche existante, ou
// duplication via `routeQuery.duplicateFrom`) — SANS toucher à la base : l'appelant a déjà
// semé (ou pas) ce dont il a besoin via `seedDb`.
async function mountAt({ routeParams = {}, routeQuery = {}, loadPurchases = false } = {}) {
  const router = makeRouter()
  const name = routeParams.id ? 'stash-edit' : 'stash-new'
  router.push({ name, params: routeParams, query: routeQuery })
  await router.isReady()
  const pinia = createPinia()
  // En production, App.vue charge le store `purchases` au démarrage, AVANT que l'écran ne
  // monte (cf. YarnPurchases.vue). Ici, YarnEditView est monté seul : sans ce chargement
  // explicite, `<YarnPurchases>` (embarqué en édition) ne verrait JAMAIS les lignes déjà en
  // base — `forYarn()` lirait un store resté vide, et le bloc « Achats et cadeaux » (écart,
  // « Ajuster le stock »…) resterait vide même avec des lignes réelles en base.
  if (loadPurchases) await usePurchasesStore(pinia).load()
  const w = mount(YarnEditView, { global: { plugins: [router, i18n, pinia], stubs } })
  // settings.load() enchaîne des lectures Dexie séquentielles, un compte de tours fixe est
  // fragile — on attend le signal réel.
  const settings = useSettingsStore(pinia)
  let rounds = 0
  while (!settings.loaded && rounds < 20) {
    await flushPromises()
    rounds++
  }
  await flushPromises()
  return { w, pinia, router }
}

async function mountAdd(seed) {
  await seedDb(seed)
  return mountAt({})
}
async function mountEditOn(id, seed, opts = {}) {
  await seedDb(seed)
  return mountAt({ routeParams: { id }, ...opts })
}
async function mountDuplicateOn(id, seed, opts = {}) {
  await seedDb(seed)
  return mountAt({ routeQuery: { duplicateFrom: String(id) }, ...opts })
}

// save() enchaîne DEUX écritures Dexie séquentielles à la création (yarnsStore.add PUIS
// purchasesStore.add, chacune add+load) — un seul flushPromises() n'avance pas assez de
// tours de la file de tâches pour que le fake IndexedDB (fake-indexeddb) livre les DEUX
// jusqu'au bout (même piège de fond que la boucle d'attente de `settings.loaded` ci-dessus,
// mesuré empiriquement ici avant d'écrire ce commentaire).
async function clickSave(w) {
  await w.find('.addform__actions .btn--primary').trigger('click')
  for (let i = 0; i < 10; i++) await flushPromises()
}
async function clickResolve(w, testId) {
  await w.find(`[data-test="${testId}"]`).trigger('click')
  for (let i = 0; i < 10; i++) await flushPromises()
}

describe('YarnEditView — formulaire de laine et registre d’achats', () => {
  beforeEach(async () => {
    await db.open()
  })

  it('C1 : un champ quantité VIDÉ retombe à 1 à l’enregistrement (comportement historique conservé)', async () => {
    // Distingue le cas « champ vide » (Number('') === 0, mais on veut le défaut historique
    // 1) du cas « zéro explicite » couvert par le test suivant — les deux valaient 1 avec
    // l'ancienne formule `Number(form.quantity) || 1`, c'est CE test-ci qui prouve que le
    // correctif n'a pas cassé le cas vide en corrigeant le cas zéro.
    const { w } = await mountAdd()
    await w.find('#yarn-color-name').setValue('Ivoire')
    await w.find('#yarn-quantity').setValue('')
    await clickSave(w)

    const yarn = (await db.yarns.toArray())[0]
    expect(yarn.quantity).toBe(1) // vide ⇒ défaut historique, PAS 0
  })

  it('C1 : « Ajuster le stock » à 0 écrit VRAIMENT 0 en base (pas 1), et fait disparaître l’alerte', async () => {
    // Cas mesuré en revue : une laine à 1 pelote, SANS aucune
    // ligne d'historique. Stock acquis = 1, historique = 0 ⇒ écart affiché ; « Ajuster le
    // stock » propose 0. Avec l'ancienne formule `Number(form.quantity) || 1`, `0 || 1`
    // retombait sur 1 : le stock restait planché à 1, l'écart ne bougeait JAMAIS, et le
    // bouton ne faisait plus rien — l'alerte s'affichait pour toujours (même défaut que
    // celui déjà corrigé une fois, réapparu à cette couture).
    const { w } = await mountEditOn(7, {
      yarns: [{ id: 7, brand: 'Cheval Blanc', colorName: 'Écru', quantity: 1, composition: [], price: '', reservations: {}, consumed: {} }],
    })
    expect(w.find('[data-test="purchases-gap"]').exists()).toBe(true) // l'écart est affiché au départ

    await w.find('[data-test="purchases-correct"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="purchases-correct-adjust"]').trigger('click')
    await flushPromises()
    expect(w.find('#yarn-quantity').element.value).toBe('0') // le champ affiche bien 0

    await clickSave(w)

    const yarn = (await db.yarns.toArray()).find((y) => y.id === 7)
    expect(yarn.quantity).toBe(0) // VRAIMENT 0, pas 1
    expect(await db.purchases.toArray()).toHaveLength(0) // baisse : aucune proposition, rien écrit

    // L'écran s'est refermé sur la fiche après une baisse (pas de proposition) : rouvrir un
    // écran d'édition FRAIS (nouveau montage, comme un vrai retour utilisateur) pour vérifier
    // que l'alerte a bien disparu (stock 0 = historique 0, écart nul) — pas juste que la base
    // contient la bonne valeur.
    const { w: w2 } = await mountAt({ routeParams: { id: 7 } })
    expect(w2.find('[data-test="purchases-gap"]').exists()).toBe(false)
  })

  // Correctif final (revue de branche) : `normalizedQuantity()` laissait passer une valeur
  // négative sans broncher à la CRÉATION (le garde-fou de l'édition ne couvre que la
  // quantité déjà réservée). Une ligne à quantité négative ferait BAISSER le budget — la
  // seule chose que ce lot promet impossible.
  it('C1 : une quantité NÉGATIVE saisie à la création est planchée à 0, jamais écrite telle quelle', async () => {
    const { w } = await mountAdd()
    await w.find('#yarn-color-name').setValue('Grenat')
    await w.find('#yarn-quantity').setValue('-3')
    await clickSave(w)

    const yarn = (await db.yarns.toArray())[0]
    expect(yarn.quantity).toBe(0) // planchée à 0, PAS -3
    const purchases = await db.purchases.toArray()
    expect(purchases).toHaveLength(1)
    expect(purchases[0].quantity).toBe(0) // la ligne d'achat suit la même valeur plancherée
  })

  // Retour d'usage (01/08, peu après) : « il n'y a plus la date d'achat
  // ni le num de bain sur la fiche de création de laine, la remettre pour une première
  // saisie au lieu de devoir revenir dans la fiche pour la modifier ». Ce test pinnait
  // l'ABSENCE de ces deux champs — il pinne désormais l'inverse : présents en création,
  // pour alimenter la 1re ligne d'achat écrite automatiquement par save() (cf. tests
  // ci-dessous), sans aller-retour par la fiche déjà enregistrée.
  it('comportement 1 : les champs « date d’achat » et « bain » SONT dans le formulaire de création, date du jour pré-remplie', async () => {
    const { w } = await mountAdd()
    const dateField = w.find('#yarn-purchased-at')
    const bainField = w.find('#yarn-bain')
    expect(dateField.exists()).toBe(true)
    expect(bainField.exists()).toBe(true)
    expect(dateField.element.value).toBe(todayISO()) // pré-rempli à aujourd'hui
    expect(bainField.element.value).toBe('') // bain vide par défaut
  })

  // Retour d'usage : la date ET le bain saisis dans le formulaire de création doivent
  // se retrouver sur la ligne d'achat écrite automatiquement — pas la date du jour ni un
  // bain vide, qui seraient indiscernables d'un oubli. Date et bain choisis pour ne
  // JAMAIS coïncider avec aujourd'hui ni avec une valeur vide (convention : un test
  // dont l'assertion ne pourrait pas échouer est un défaut).
  it('comportement 1b : la date et le bain saisis en création alimentent la 1re ligne d’achat (pas la date du jour, pas un bain vide)', async () => {
    const { w } = await mountAdd()
    await w.find('#yarn-color-name').setValue('Corail')
    await w.find('#yarn-quantity').setValue('4')
    await w.find('#yarn-price').setValue('7,25')
    await w.find('#yarn-purchased-at').setValue('2025-03-17') // distinct d'aujourd'hui
    await w.find('#yarn-bain').setValue('B-9917') // distinct de tout autre test du fichier
    await clickSave(w)

    const yarns = await db.yarns.toArray()
    const purchases = await db.purchases.toArray()
    expect(purchases).toHaveLength(1)
    expect(purchases[0]).toMatchObject({
      yarnId: yarns[0].id, date: '2025-03-17', bain: 'B-9917', quantity: 4, unitPrice: 7.25,
    })
  })

  it('comportement 1c : en ÉDITION, les champs « date d’achat » et « bain » de la création ne sont PAS rendus', async () => {
    const { w } = await mountEditOn(42, {
      yarns: [{ id: 42, brand: 'Schachenmayr', colorName: 'Turquoise', quantity: 2, composition: [], price: '' }],
    })
    expect(w.find('#yarn-purchased-at').exists()).toBe(false)
    expect(w.find('#yarn-bain').exists()).toBe(false)
  })

  it('comportement 1d : en DUPLICATION, les champs sont présents, date du jour, bain vide (jamais celui de la fiche source)', async () => {
    const { w } = await mountDuplicateOn(43, {
      yarns: [{ id: 43, brand: 'Bergère de France', colorName: 'Anthracite', quantity: 3, composition: [], price: '', bain: 'SOURCE-BAIN' }],
    })
    const dateField = w.find('#yarn-purchased-at')
    const bainField = w.find('#yarn-bain')
    expect(dateField.exists()).toBe(true)
    expect(bainField.exists()).toBe(true)
    expect(dateField.element.value).toBe(todayISO())
    expect(bainField.element.value).toBe('') // jamais 'SOURCE-BAIN' : décision déjà prise (cf. applyDuplicate)
  })

  it('comportement 2 : création avec un prix et une quantité de 3 écrit une ligne d’achat automatique', async () => {
    const { w } = await mountAdd()
    await w.find('#yarn-color-name').setValue('Bleu glacier')
    await w.find('#yarn-quantity').setValue('3')
    await w.find('#yarn-price').setValue('12,50')
    await clickSave(w)

    const yarns = await db.yarns.toArray()
    expect(yarns).toHaveLength(1)
    const purchases = await db.purchases.toArray()
    expect(purchases).toHaveLength(1)
    expect(purchases[0]).toMatchObject({
      yarnId: yarns[0].id,
      kind: 'buy',
      quantity: 3,
      unitPrice: 12.5,
      currency: 'EUR', // devise des réglages : jamais changée dans ce test, défaut EUR
      date: todayISO(),
      reconstructed: false,
    })
  })

  it('comportement 3 : création SANS prix écrit quand même une ligne, à prix vide (pas un cadeau)', async () => {
    const { w } = await mountAdd()
    await w.find('#yarn-color-name').setValue('Vert sapin')
    await w.find('#yarn-quantity').setValue('2') // distinct du 3 du test précédent
    // Le champ prix reste vide — pas de setValue.
    await clickSave(w)

    const yarns = await db.yarns.toArray()
    const purchases = await db.purchases.toArray()
    expect(purchases).toHaveLength(1)
    expect(purchases[0].yarnId).toBe(yarns[0].id)
    expect(purchases[0].quantity).toBe(2)
    expect(purchases[0].unitPrice).toBe('')
    expect(purchases[0].kind).toBe('buy') // prix inconnu ≠ cadeau
    expect(purchases[0].date).toBe(todayISO())
  })

  it('comportement 4a : en édition, une hausse de quantité (2→5) propose un achat ; « Enregistrer » l’écrit', async () => {
    const { w } = await mountEditOn(1, {
      yarns: [{ id: 1, brand: 'Drops', colorName: 'Rouge', quantity: 2, composition: [], price: '' }],
    })
    await w.find('#yarn-quantity').setValue('5')
    await w.find('#yarn-price').setValue('8,90') // prix distinct, utilisé pour CETTE proposition
    await clickSave(w)

    // Rien n'est encore écrit : la proposition attend une réponse.
    expect(await db.purchases.toArray()).toHaveLength(0)
    expect((await db.yarns.toArray())[0].quantity).toBe(2) // la fiche n'a PAS encore bougé

    const prompt = w.find('[data-test="qty-increase-prompt"]')
    expect(prompt.exists()).toBe(true)
    expect(prompt.text()).toContain('3') // 5 - 2 = 3 pelotes proposées

    await clickResolve(w, 'qty-increase-buy')

    const yarn = (await db.yarns.toArray())[0]
    expect(yarn.quantity).toBe(5)
    const purchases = await db.purchases.toArray()
    expect(purchases).toHaveLength(1)
    expect(purchases[0]).toMatchObject({
      yarnId: 1, kind: 'buy', quantity: 3, unitPrice: 8.9, date: todayISO(), reconstructed: false,
    })
  })

  it('comportement 4b : « Offert » crée la ligne en kind: gift, sans le prix du formulaire', async () => {
    const { w } = await mountEditOn(2, {
      yarns: [{ id: 2, brand: 'Katia', colorName: 'Jaune', quantity: 4, composition: [], price: '' }],
    })
    await w.find('#yarn-quantity').setValue('9') // delta = 5, distinct des autres tests
    await w.find('#yarn-price').setValue('99,99') // prix du formulaire : ne doit PAS se retrouver sur un cadeau
    await clickSave(w)
    await clickResolve(w, 'qty-increase-gift')

    const yarn = (await db.yarns.toArray()).find((y) => y.id === 2)
    expect(yarn.quantity).toBe(9)
    const purchases = await db.purchases.toArray()
    expect(purchases).toHaveLength(1)
    expect(purchases[0]).toMatchObject({ yarnId: 2, kind: 'gift', quantity: 5, unitPrice: '' })
  })

  it('comportement 4c : « Ignorer » met à jour la fiche mais n’écrit rien dans purchases', async () => {
    const { w } = await mountEditOn(3, {
      yarns: [{ id: 3, brand: 'Phildar', colorName: 'Gris', quantity: 6, composition: [], price: '' }],
    })
    await w.find('#yarn-quantity').setValue('11') // delta = 5, distinct des lignes ci-dessus
    await clickSave(w)
    await clickResolve(w, 'qty-increase-ignore')

    const yarn = (await db.yarns.toArray()).find((y) => y.id === 3)
    expect(yarn.quantity).toBe(11) // la fiche a bien été mise à jour…
    expect(await db.purchases.toArray()).toHaveLength(0) // … mais purchases reste vide
  })

  it('comportement 5 : en édition, une baisse de quantité (5→2) n’écrit rien dans purchases, sans proposition', async () => {
    const { w } = await mountEditOn(4, {
      yarns: [{ id: 4, brand: 'Rico', colorName: 'Violet', quantity: 5, composition: [], price: '' }],
    })
    await w.find('#yarn-quantity').setValue('2')
    await clickSave(w)

    expect(w.find('[data-test="qty-increase-prompt"]').exists()).toBe(false)
    const yarn = (await db.yarns.toArray()).find((y) => y.id === 4)
    expect(yarn.quantity).toBe(2) // la baisse s'applique immédiatement…
    expect(await db.purchases.toArray()).toHaveLength(0) // … le budget ne descend jamais tout seul
  })

  it('comportement 6 : la duplication ne recopie AUCUNE ligne d’achat de la fiche source', async () => {
    const SOURCE = { id: 5, brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu', quantity: 5, composition: [], price: '20,00' }
    // Ligne d'historique existante de la fiche SOURCE, avec des nombres qui ne peuvent PAS
    // se confondre avec la ligne fraîche que la duplication va créer (quantité 1, prix vide).
    const { w } = await mountDuplicateOn(5, {
      yarns: [SOURCE],
      purchases: [{
        yarnId: 5, yarnLabel: 'Drops · Baby Merino · Bleu', kind: 'buy',
        quantity: 7, unitPrice: '20,00', currency: 'EUR', date: '2026-01-01',
        bain: 'A123', reconstructed: false,
      }],
    })

    await w.find('#yarn-color-name').setValue('Verte') // requis : applyDuplicate vide colorName
    await clickSave(w)

    const yarns = await db.yarns.toArray()
    expect(yarns).toHaveLength(2)
    const newYarn = yarns.find((y) => y.id !== 5)

    const purchases = await db.purchases.toArray()
    expect(purchases).toHaveLength(2) // la ligne source + UNE ligne fraîche pour la nouvelle fiche

    const sourceLine = purchases.find((l) => l.yarnId === 5)
    expect(sourceLine).toMatchObject({ quantity: 7, unitPrice: '20,00', date: '2026-01-01' }) // la source n'a pas bougé

    const newLine = purchases.find((l) => l.yarnId === newYarn.id)
    expect(newLine).toBeTruthy()
    // La ligne fraîche suit les valeurs REMISES À ZÉRO par applyDuplicate (quantité 1, prix
    // vide) — PAS les valeurs de la ligne source (7 pelotes à 20,00) : si un bug faisait
    // recopier l'historique, ces nombres se retrouveraient ici.
    expect(newLine.quantity).toBe(1)
    expect(newLine.unitPrice).toBe('')
  })

  it('verrou (ordre) : à la création, l’écran n’a PAS encore navigué au moment où l’écriture de l’achat démarre', async () => {
    // ⚠️ Ce test affirmait l'INVERSE jusqu'au 06/08 (« le formulaire est déjà refermé… »,
    // verrou posé par b2daace). Il protégeait un ordre qui coûtait une ligne d'achat :
    // panneau refermé = « c'est enregistré », alors que l'écriture était encore en vol —
    // changer d'écran dans cette fenêtre la coupait, et le montant disparaissait du budget
    // sans un mot (mesuré : 12,80 € au lieu de 30,50 € sur l'écran Dépenses). Ce que b2daace
    // cherchait à protéger n'était pas un défaut d'application mais un locator e2e ambigu
    // (« Drops » matchant aussi l'<option> du catalogue de marques), corrigé depuis dans
    // checkbox.spec.js. L'invariant est donc renversé : LA NAVIGATION SIGNIFIE « TOUT EST
    // ÉCRIT ».
    // Angle propre à ce test : il intercepte l'action au moment précis où elle DÉMARRE,
    // donc il ne dépend pas du nombre de tours de `flushPromises()` (contrairement à
    // `clickSave`, cf. son commentaire). Le pendant côté DOM — retenir l'écriture et vérifier
    // que l'écran tient bon pendant tout ce temps — vit dans tests/unit/YarnEditView.spec.js,
    // describe « la navigation n'a lieu qu'une fois la ligne d'achat écrite », qui couvre
    // aussi le chemin ÉDITION.
    const { w, pinia, router } = await mountAdd()
    await w.find('#yarn-color-name').setValue('Ordre protégé')
    await w.find('#yarn-quantity').setValue('1')

    const startName = router.currentRoute.value.name
    const purchasesStore = usePurchasesStore(pinia)
    const realAdd = purchasesStore.add.bind(purchasesStore)
    let routeWasUnchangedBeforeWrite = null
    let purchasesTableWasEmptyBeforeWrite = null
    vi.spyOn(purchasesStore, 'add').mockImplementation(async (data) => {
      // nextTick : laisse Vue appliquer au DOM tout changement d'état déjà survenu — sans
      // lui, on lirait un rendu en retard d'une fraction de tick.
      await nextTick()
      routeWasUnchangedBeforeWrite = router.currentRoute.value.name === startName
      purchasesTableWasEmptyBeforeWrite = (await db.purchases.toArray()).length === 0
      return realAdd(data)
    })

    await clickSave(w)

    expect(routeWasUnchangedBeforeWrite).toBe(true) // l'écran n'annonce rien avant d'avoir fini
    expect(purchasesTableWasEmptyBeforeWrite).toBe(true) // on est bien AVANT l'écriture
    expect(await db.purchases.toArray()).toHaveLength(1) // et l'achat s'écrit
    expect(router.currentRoute.value.name).toBe('stash-item') // …la navigation n'a lieu qu'après
  })

  it('« Ajuster le stock » (réconciliation avec l’historique) ne propose PAS un nouvel achat — pas de double comptage', async () => {
    // Fixture choisie pour que TOUS les nombres en jeu soient distincts (revue,
    // I4) : `consumed: { 1: 2 }` fait que la quantité ajustée émise (7) diffère de
    // l'historique brut (9) — sans consommation, les deux coïncideraient et le test ne
    // distinguerait pas une garde calée sur la valeur RÉELLEMENT émise d'une garde calée
    // (à tort) sur l'historique brut. Ici : stock restant 4, 2 déjà tricotées ⇒ stock
    // ACQUIS 6 ; historique 9 ; écart 6−9 = −3 (alerte affichée) ; ajusté = 9−2 = 7 (PAS 9) ;
    // delta de sauvegarde = 7−4 = 3. Six nombres, tous différents : 4, 2, 6, 9, 7, 3.
    const { w } = await mountEditOn(6, {
      // `reservations: {}` doit être posé À CÔTÉ de `consumed` : yarnsStore.load() migre
      // (et donc EFFACE) `consumed` vers `{}` dès que `reservations` est absent de la
      // fiche chargée (cf. normalizeYarnReservations, src/utils/yarn-usage.js) — sans lui,
      // la consommation semée ici disparaîtrait silencieusement au premier `load()`.
      yarns: [{ id: 6, brand: 'Bergère', colorName: 'Sable', quantity: 4, composition: [], price: '', reservations: {}, consumed: { 1: 2 } }],
      purchases: [{
        yarnId: 6, yarnLabel: 'Bergère · Sable', kind: 'buy',
        quantity: 9, unitPrice: '15,00', currency: 'EUR', date: '2026-02-02',
        bain: '', reconstructed: false,
      }],
    }, { loadPurchases: true }) // sans ça, <YarnPurchases> ne verrait jamais la ligne (cf. mountAt)
    await w.find('[data-test="purchases-correct"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="purchases-correct-adjust"]').trigger('click')
    await flushPromises()
    // 7, PAS 9 : la valeur émise tient compte de la consommation déjà tracée.
    expect(w.find('#yarn-quantity').element.value).toBe('7') // repris du champ, pas juste de l'état interne

    await clickSave(w)

    expect(w.find('[data-test="qty-increase-prompt"]').exists()).toBe(false) // pas de proposition
    const yarn = (await db.yarns.toArray()).find((y) => y.id === 6)
    expect(yarn.quantity).toBe(7)
    expect(await db.purchases.toArray()).toHaveLength(1) // toujours la SEULE ligne d'origine
  })
})

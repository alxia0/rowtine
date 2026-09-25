// @vitest-environment jsdom
// Écran — YarnDetailView (remplace le tiroir YarnDetailDialog.vue, cf. plan « refonte fiche
// laine »). Ce fichier consolide les assertions de tests/unit/yarn-detail-dialog.spec.js
// (contenu affiché — sauf role="dialog"/Escape/focus-trap, sans objet pour un écran routé) et
// les 3 `it()` de tests/unit/YarnCard-units.spec.js consacrées au détail (labels/valeurs
// impériales, symbole de devise, fiche ancienne à virgule décimale — les trois font partie du
// describe « YarnDetailDialog — unités et devise », toutes les trois retirées à la Step 6 avec
// l'import YarnDetailDialog devenu inutile).
//
// Base réelle (fake-indexeddb, cf. tests/unit/setup.js) plutôt qu'une affectation directe
// `store.yarns = [...]` après montage : `stubActions: false` est nécessaire pour que les
// actions du kebab (dupliquer/modifier/supprimer) et le récapitulatif d'achats
// (`purchasesStore.forYarn`, alimenté par de VRAIES lignes ajoutées via `usePurchasesStore().add`,
// même motif que yarn-detail-dialog.spec.js) fonctionnent pour de vrai — ce qui laisse
// tourner aussi `yarnsStore.load()` (appelé par `onMounted`) pour de vrai. Affecter
// `store.yarns` après `mount()` courrait alors contre ce `load()` réel et asynchrone (résolu
// pendant `flushPromises()`), qui écraserait l'affectation manuelle. On sème donc la laine en
// base AVANT de monter, et on laisse le vrai `load()` la relire.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { createI18n } from 'vue-i18n'
import { createRouter, createWebHistory } from 'vue-router'
import { db } from '@/db/db'
import fr from '@/i18n/fr.json'
import de from '@/i18n/de.json'
import en from '@/i18n/en.json'
import YarnDetailView from '@/views/YarnDetailView.vue'
import { usePurchasesStore } from '@/stores/purchases'
import { useTrashStore } from '@/stores/trash'
import { photosOf } from '@/utils/yarn-photos'
import { createTestI18n, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)
// Instance dédiée à une régression connue : locale allemande, pour prouver que la ligne
// « Composition » traduit dans la langue ACTIVE plutôt que de pousser la clé française
// stockée en base (portée depuis yarn-detail-dialog.spec.js).
const i18nDe = createI18n({ legacy: false, locale: 'de', messages: { de } })
const i18nEn = createI18n({ legacy: false, locale: 'en', messages: { en } })

function makeRouter(id) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/stash', name: 'stash', component: { template: '<div />' } },
      { path: '/stash/:id', name: 'stash-item', component: YarnDetailView },
      { path: '/stash/:id/edit', name: 'stash-edit', component: { template: '<div />' } },
      { path: '/stash/new', name: 'stash-new', component: { template: '<div />' } },
    ],
  })
  router.push({ name: 'stash-item', params: { id } })
  return router
}

// Sème la laine dans la VRAIE base (fake-indexeddb) et renvoie son id réel — jamais un id
// codé en dur, puisque `db.yarns.add` en attribue un.
async function seedYarn(yarnData = {}) {
  return db.yarns.add({ ...yarnData })
}

async function mountView(yarnData, { unitSystem, currency, i18nInstance, purchases = [] } = {}) {
  const id = await seedYarn(yarnData)
  const router = makeRouter(id)
  await router.isReady()
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    initialState: { settings: { unitSystem: unitSystem || 'metric', currency: currency || 'EUR' } },
    stubActions: false,
  })
  const purchasesStore = usePurchasesStore(pinia)
  for (const p of purchases) {
    await purchasesStore.add({ yarnId: id, yarnLabel: 'DROPS · Bleu ciel', ...p })
  }
  const w = mount(YarnDetailView, {
    global: { plugins: [pinia, i18nInstance || i18n, router], stubs: { ThumbImage: true, AppIcon: true } },
  })
  await flushPromises()
  return { w, id, pinia }
}

// Lit la VALEUR affichée pour un libellé donné, en appariant les `<dt>`/`<dd>` par position
// plutôt qu'en cherchant un fragment dans le texte entier de la fiche (portée verbatim de
// yarn-detail-dialog.spec.js — un `.toContain('3')` nu serait déjà vrai à cause du prix
// même si le récapitulatif d'achats était cassé).
function fieldValue(w, label) {
  const dts = w.findAll('.ydet__dt')
  const dds = w.findAll('.ydet__dd')
  const i = dts.findIndex((dt) => dt.text() === label)
  return i === -1 ? null : dds[i].text()
}

const BASE_YARN = {
  brand: 'DROPS', model: 'Baby Merino', colorName: 'Bleu ciel', color: 'hsl(205 60% 75%)',
  weight: '', lengthM: 175, grams: 50, quantity: 5, price: 3.2, composition: ['Laine'], photos: [],
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('YarnDetailView', () => {
  it('affiche le prix au format de la langue, centimes compris (3,20 et non 3,2)', async () => {
    const { w } = await mountView({ ...BASE_YARN })
    // Devise par défaut EUR (settings.js) : le libellé attendu porte donc « € ».
    expect(fieldValue(w, fr.yarn.priceWithSymbol.replace('{symbol}', '€'))).toBe('3,20')
  })

  it('affiche le prix au format de la langue active, pas la virgule française figée', async () => {
    const { w } = await mountView({ ...BASE_YARN }, { i18nInstance: i18nDe })
    expect(fieldValue(w, de.yarn.priceWithSymbol.replace('{symbol}', '€'))).toBe('3,20')
    const { w: wEn } = await mountView({ ...BASE_YARN }, { i18nInstance: i18nEn })
    expect(fieldValue(wEn, en.yarn.priceWithSymbol.replace('{symbol}', '€'))).toBe('3.20')
  })

  it('le kebab ouvre un menu avec Modifier / Dupliquer / Supprimer', async () => {
    const { w } = await mountView({ ...BASE_YARN })
    await w.find('.phdr__kebab').trigger('click')
    const items = w.findAll('.menu__item').map((b) => b.text())
    expect(items).toEqual([fr.common.edit, fr.common.duplicate, fr.common.delete])
  })

  it('« Modifier » navigue vers stash-edit avec l’id de la laine', async () => {
    const { w, id } = await mountView({ ...BASE_YARN })
    await w.find('.phdr__kebab').trigger('click')
    await w.findAll('.menu__item')[0].trigger('click')
    await flushPromises()
    expect(w.vm.$router.currentRoute.value.name).toBe('stash-edit')
    expect(w.vm.$router.currentRoute.value.params.id).toBe(String(id))
  })

  it('« Dupliquer » navigue vers stash-new avec duplicateFrom = id de la laine', async () => {
    const { w, id } = await mountView({ ...BASE_YARN })
    await w.find('.phdr__kebab').trigger('click')
    await w.findAll('.menu__item')[1].trigger('click')
    await flushPromises()
    expect(w.vm.$router.currentRoute.value.name).toBe('stash-new')
    // Sous forme chaîne : c'est ainsi que la Task 3 lit `route.query.duplicateFrom`.
    expect(w.vm.$router.currentRoute.value.query.duplicateFrom).toBe(String(id))
  })

  it('« Supprimer » supprime la laine, déclenche la suppression douce et revient à stash', async () => {
    const { w, id, pinia } = await mountView({ ...BASE_YARN })
    const trashStore = useTrashStore(pinia)
    await w.find('.phdr__kebab').trigger('click')
    await w.findAll('.menu__item')[2].trigger('click')
    await flushPromises()
    // `remove()` enchaîne plusieurs allers-retours Dexie réels (trash.moveToTrash →
    // yarnsStore.load → softDelete, chacun un tour d'IndexedDB) : un seul `flushPromises()` ne
    // suffit pas toujours à tout vider (même piège que la course décrite en tête de
    // fichier) — `vi.waitFor` attend l'effet final plutôt qu'un nombre de tours arbitraire,
    // même motif que tests/unit/project-detail-*.spec.js.
    await vi.waitFor(() => expect(trashStore.moveToTrash).toHaveBeenCalled())

    // Retrait et mise en corbeille d'un seul tenant (trash.js `moveToTrash`), sous le type
    // 'yarn' : la laine supprimée part bien en corbeille, jamais perdue.
    expect(trashStore.moveToTrash).toHaveBeenCalledWith('yarn', id)
    await vi.waitFor(async () =>
      expect(await db.trash.toArray()).toEqual([
        expect.objectContaining({ type: 'yarn', payload: expect.objectContaining({ id, brand: 'DROPS' }) }),
      ]),
    )
    // Retour à la liste : plus de fiche à afficher sur cette route.
    await vi.waitFor(() => expect(w.vm.$router.currentRoute.value.name).toBe('stash'))
    // Suppression réelle en base (même moteur que le reste du fichier : vraies actions,
    // vrai Dexie) — la fiche a bien disparu, pas seulement l'affichage.
    expect(await db.yarns.get(id)).toBeUndefined()
  })

  // --- Portées depuis tests/unit/yarn-detail-dialog.spec.js ---

  it('affiche tous les champs saisis, bain et date d’achat compris via le registre (jamais perdre d’info)', async () => {
    const { w } = await mountView({ ...BASE_YARN }, { purchases: [{ bain: 'LOT42', date: '2026-06-01' }] })
    const txt = w.text()
    for (const v of ['DROPS', 'Baby Merino', 'Bleu ciel', '175', '50', '5', 'LOT42', '01/06/2026', 'Laine']) {
      expect(txt).toContain(v)
    }
  })

  it('récapitule plusieurs lignes d’achat : nombre de lignes, bains dédoublonnés, dernier achat', async () => {
    const { w } = await mountView({ ...BASE_YARN }, {
      purchases: [
        { bain: 'A12', date: '2026-01-10' },
        { bain: 'B03', date: '2026-05-04' },
        { bain: 'A12', date: '2026-02-20' }, // bain déjà vu : ne doit pas se dupliquer
      ],
    })
    expect(fieldValue(w, fr.yarn.purchasesCount)).toBe('3')
    // `forYarn` renvoie les lignes plus récentes d'abord : bainsOf dédoublonne dans CET
    // ordre — B03 (04/05) et A12 (20/02) avant le doublon A12 (10/01).
    expect(fieldValue(w, fr.yarn.bain)).toBe('B03 · A12')
    // Date affichée au format de la langue, pas l'ISO stocké.
    expect(fieldValue(w, fr.yarn.lastPurchaseDate)).toBe('04/05/2026')
  })

  it('aucune ligne d’achat pour cette laine : pas de récapitulatif affiché', async () => {
    const { w } = await mountView({ ...BASE_YARN })
    expect(fieldValue(w, fr.yarn.purchasesCount)).toBeNull()
    expect(fieldValue(w, fr.yarn.bain)).toBeNull()
    expect(fieldValue(w, fr.yarn.lastPurchaseDate)).toBeNull()
  })

  it('affiche le type de coloris et les notes pour une pelote multicolore', async () => {
    const { w } = await mountView({ ...BASE_YARN, colorType: 'degrade', colorNotes: 'bleu vers blanc' })
    const txt = w.text()
    expect(txt).toContain(fr.yarn.colorTypes.degrade)
    expect(txt).toContain('bleu vers blanc')
  })

  it('une pelote Uni sans notes n\'affiche ni Type de coloris ni Description du coloris', async () => {
    const { w } = await mountView({ ...BASE_YARN }) // pas de colorType/colorNotes
    const txt = w.text()
    expect(txt).not.toContain(fr.yarn.colorType)
    expect(txt).not.toContain(fr.yarn.colorNotes)
  })

  it('affiche l’origine déduite et les caractéristiques cochées', async () => {
    const { w } = await mountView({ ...BASE_YARN, composition: ['alpaga'], labels: ['vegan', 'rws'] })
    const txt = w.text()
    expect(txt).toContain(tk('yarn.origin.animale'))
    expect(txt).toContain(tk('yarn.labels.vegan'))
    expect(txt).toContain(tk('yarn.labels.rws'))
  })

  it('n’affiche PAS de ligne d’origine quand la composition est vide', async () => {
    const { w } = await mountView({ ...BASE_YARN, composition: [], labels: [] })
    expect(w.find('.ydet__origin').exists()).toBe(false)
  })

  it('dit « Origine incomplète » dès qu’une fibre n’est pas classée', async () => {
    const { w } = await mountView({ ...BASE_YARN, composition: ['mérinos', 'zzz-fibre-inconnue'], labels: [] })
    expect(w.text()).toContain(tk('yarn.origin.incomplete'))
  })

  it('affiche les caractéristiques dans l’ordre canonique de YARN_LABELS, jamais l’ordre de cochage', async () => {
    const { w } = await mountView({ ...BASE_YARN, composition: ['alpaga'], labels: ['rws', 'vegan'] })
    const items = w.findAll('.ydet__labels li').map((li) => li.text())
    expect(items).toEqual([tk('yarn.labels.vegan'), tk('yarn.labels.rws')])
  })

  it('juxtapose les libellés d’origine pour un mélange autre qu’animal + végétal', async () => {
    const { w } = await mountView({ ...BASE_YARN, composition: ['laine', 'acrylique'], labels: [] })
    expect(w.text()).toContain(`${tk('yarn.origin.animale')} · ${tk('yarn.origin.synthetique')}`)
    expect(w.text()).not.toContain(tk('yarn.origin.melange'))
  })

  it('affiche « Mélange animal et végétal » pour une composition animale + végétale', async () => {
    const { w } = await mountView({ ...BASE_YARN, composition: ['laine', 'coton'], labels: [] })
    expect(w.text()).toContain(tk('yarn.origin.melange'))
  })

  it('traduit la composition dans la langue active au lieu d’afficher la clé française brute', async () => {
    const { w } = await mountView({ ...BASE_YARN, composition: ['coton'] }, { i18nInstance: i18nDe })
    expect(fieldValue(w, de.yarn.composition)).toBe(de.yarn.compositions.coton)
    expect(w.text()).not.toContain('coton')
  })

  // --- Portées depuis tests/unit/YarnCard-units.spec.js, describe « YarnDetailDialog —
  // unités et devise » (les 3 `it()` de ce describe, retirées avec l'import YarnDetailDialog) ---

  it('impérial : libellés de champ ET valeurs converties, profil detail (jamais de bascule)', async () => {
    const { w } = await mountView({ ...BASE_YARN, lengthM: 100, grams: 50, price: '25' }, { unitSystem: 'imperial' })
    const dts = w.findAll('.ydet__dt').map((d) => d.text())
    expect(dts).toContain(fr.yarn.lengthYd) // "Longueur (yd)"
    expect(dts).toContain(fr.yarn.ounces) // "oz / pelote"
    expect(dts).not.toContain(fr.yarn.lengthM)
    expect(dts).not.toContain(fr.yarn.grams)
    const text = w.text()
    expect(text).toContain('109,36') // 100 m → yd, profil detail
    expect(text).toContain('1,76') // 50 g → oz, profil detail (jamais de livres ici)
  })

  it('le libellé du prix porte le symbole de la devise choisie, sans condition d\'unité', async () => {
    const { w } = await mountView({ ...BASE_YARN, lengthM: 100, grams: 50, price: '25' }, { unitSystem: 'imperial', currency: 'USD' })
    const dts = w.findAll('.ydet__dt').map((d) => d.text())
    expect(dts.some((d) => d.includes('$'))).toBe(true)
    expect(dts.some((d) => d.includes('€'))).toBe(false)
  })

  it('fiche ancienne à virgule décimale : la fiche détail affiche un chiffre réel, pas 0 (revue finale 26/07)', async () => {
    const { w } = await mountView({ ...BASE_YARN, lengthM: '87,5', grams: '4,5' }, { unitSystem: 'metric' })
    const dds = w.findAll('.ydet__dd').map((d) => d.text())
    expect(dds).toContain('88') // longueur, profil detail, arrondie
    expect(dds).toContain('5') // poids métrique, arrondi (4,5 -> 5), jamais 0
  })

  // Revue finale (Finding 1b) : une fiche ANCIENNE (stock d'avant cette refonte) ne porte
  // jamais `photos` — seulement l'ex-champ unique `photo`. La galerie affichée est alors
  // dérivée du repli tolérant de `photosOf()` (src/utils/yarn-photos.js). Supprimer cette
  // unique photo doit vider la galerie POUR DE VRAI en base — pas seulement dans l'état
  // réactif courant — sinon `photosOf()` la fait réapparaître dès le rendu suivant.
  it('supprimer l’unique photo d’une fiche ANCIENNE (ex-champ `photo`, sans `photos`) la vide réellement en base', async () => {
    const { photos: _sansPhotos, ...legacyBase } = BASE_YARN
    const { w, id } = await mountView({ ...legacyBase, photo: 'x' })

    expect(w.find('.pgrid').exists()).toBe(true) // la galerie affiche bien la photo repliée
    await w.find('.pthumb__del').trigger('click')
    await flushPromises()

    const saved = await db.yarns.get(id)
    expect(saved.photos).toEqual([]) // plus aucune entrée de galerie…
    expect(saved.photo).toBeFalsy() // …ET l'ex-champ hérité est purgé, pas seulement l'état réactif
    expect(photosOf(saved)).toEqual([]) // une relecture fraîche ne ressuscite pas la photo
  })
})

// Revue finale (Finding 3) : ni état de chargement, ni état introuvable sur cet écran —
// `v-if="yarn"` nu, sans `v-else`, rendait un écran totalement vide (aucun titre, aucun
// bouton retour) tant que le store charge, OU si l'id de la route ne correspond à aucune
// laine (lien périmé, fiche supprimée, navigation directe vers un mauvais id). Motif calqué
// sur ProjectDetailView.vue (SkeletonScreen + bloc « introuvable » avec bouton de retour).
describe('YarnDetailView — état introuvable', () => {
  it('id ne correspondant à aucune laine (store chargé, vide de cet id) : message "introuvable" et un moyen de revenir en arrière', async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/stash', name: 'stash', component: { template: '<div />' } },
        { path: '/stash/:id', name: 'stash-item', component: YarnDetailView },
      ],
    })
    // Aucune laine semée : le store se charge (réel) mais reste vide — l'id de la route ne
    // matche donc, par construction, aucune fiche.
    router.push({ name: 'stash-item', params: { id: '999999' } })
    await router.isReady()
    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false })
    const w = mount(YarnDetailView, {
      global: { plugins: [pinia, i18n, router], stubs: { ThumbImage: true, AppIcon: true } },
    })
    await flushPromises()

    // Pas un écran blanc : le store a bien fini de charger (vide), donc l'état "introuvable"
    // — pas le skeleton de chargement — doit être celui rendu ici.
    expect(w.text()).toContain(fr.yarn.notFound)
    const backBtn = w.findAll('button').find((b) => b.text() === fr.common.back)
    expect(backBtn).toBeTruthy()

    // Force la branche « pas d'historique » de useSmartBack (cf. tests/unit/useSmartBack.spec.js) :
    // sans page précédente, goBack() retombe sur le fallback `{ name: 'stash' }} passé par
    // YarnDetailView — un moyen de sortir réellement fonctionnel, pas un bouton décoratif.
    window.history.replaceState(null, '')
    await backBtn.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('stash')
  })
})

// Lieu de rangement et notes libres, champs ajoutés au modèle laine (Task 1, plan import Ravelry).
describe('YarnDetailView, Notes et Lieu de rangement', () => {
  it('affiche les deux champs quand ils sont renseignés', async () => {
    const id = await db.yarns.add({
      brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu', storedIn: 'Étagère 2', notes: 'Douce, pour bébé',
      composition: [], labels: [], reservations: {}, consumed: {}, photos: [],
    })
    const router = makeRouter(id)
    await router.isReady()
    const w = mount(YarnDetailView, {
      global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false }), i18n, router], stubs: { AppIcon: true, ThumbImage: true } },
    })
    await flushPromises()
    expect(w.text()).toContain('Étagère 2')
    expect(w.text()).toContain('Douce, pour bébé')
  })

  it("n'affiche pas les lignes quand les champs sont vides", async () => {
    const id = await db.yarns.add({
      brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu',
      composition: [], labels: [], reservations: {}, consumed: {}, photos: [],
    })
    const router = makeRouter(id)
    await router.isReady()
    const w = mount(YarnDetailView, {
      global: { plugins: [createTestingPinia({ createSpy: vi.fn, stubActions: false }), i18n, router], stubs: { AppIcon: true, ThumbImage: true } },
    })
    await flushPromises()
    expect(w.text()).not.toContain(fr.yarn.storedIn)
    expect(w.text()).not.toContain(fr.yarn.notes)
  })
})

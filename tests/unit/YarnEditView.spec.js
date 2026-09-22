// Écran plein d'ajout/édition de laine (routes stash-new / stash-edit) — extrait du
// formulaire jusqu'ici inline dans StashView.vue (Task 3 de la refonte fiche/navigation).
// Ce fichier porte les assertions de 9 anciens fichiers de test de StashView (table de la
// Task 3), adaptées à un montage DIRECT de YarnEditView (routeParams/routeQuery pilotent
// création/édition/duplication) plutôt qu'à un clic sur « Ajouter une laine »/kebab
// « Modifier » dans StashView.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { createRouter, createWebHistory, createMemoryHistory } from 'vue-router'
import fr from '@/i18n/fr.json'
import YarnEditView from '@/views/YarnEditView.vue'
import { useYarnsStore, emptyYarn } from '@/stores/yarns'
import { usePurchasesStore } from '@/stores/purchases'
import { useSnackbarStore } from '@/stores/snackbar'
import { useSettingsStore } from '@/stores/settings'
import { db } from '@/db/db'
import { ymdLocal } from '@/utils/time-periods'
import { photosOf } from '@/utils/yarn-photos'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

function todayISO() {
  return ymdLocal(new Date())
}

// ── Harnais « store mocké » (createTestingPinia) — la majorité des tests portés ──────────
// AppHeader n'est PAS stubé : c'est lui qui porte le titre « Ajouter »/« Modifier »,
// vérifié par le 1er test ci-dessous — le stuber masquerait le texte du titre.
const defaultStubs = { YarnWeightHelp: true, ColorPickerDialog: true, YarnPurchases: true, AppIcon: true }

function makeRouter(routeParams = {}, routeQuery = {}) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/stash', name: 'stash', component: { template: '<div />' } },
      { path: '/stash/:id', name: 'stash-item', component: { template: '<div />' } },
      { path: '/stash/new', name: 'stash-new', component: YarnEditView },
      { path: '/stash/:id/edit', name: 'stash-edit', component: YarnEditView },
    ],
  })
  const name = routeParams.id ? 'stash-edit' : 'stash-new'
  router.push({ name, params: routeParams, query: routeQuery })
  return router
}

async function mountView({ routeParams = {}, routeQuery = {}, existingYarns = [], stubOverrides = {} } = {}) {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const router = makeRouter(routeParams, routeQuery)
  await router.isReady()
  const store = useYarnsStore(pinia)
  store.yarns = existingYarns
  store.loaded = true
  const w = mount(YarnEditView, {
    global: {
      plugins: [i18n, router, pinia],
      stubs: { ...defaultStubs, ...stubOverrides },
    },
  })
  await flushPromises()
  return { w, pinia, router }
}

describe('YarnEditView', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('création : le titre dit "Ajouter"', async () => {
    const { w } = await mountView()
    expect(w.text()).toContain(fr.yarn.add)
  })

  it('édition : le formulaire se pré-remplit avec la fiche existante', async () => {
    const source = { id: 3, brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu', composition: [], quantity: 2 }
    const { w } = await mountView({ routeParams: { id: '3' }, existingYarns: [source] })
    expect(w.find('#yarn-model').element.value).toBe('Baby Merino')
  })
})

// ── Porté de tests/unit/stash-price-comma.spec.js ────────────────────────────────────────
// Le fichier source testait la somme affichée par StashView (`.recap__stat`), un calcul qui
// reste entièrement dans StashView.vue (pas déplacé par cette tâche). Le VRAI comportement
// à couvrir ici — celui qui vit désormais dans YarnEditView — est que save() transmette un
// prix saisi à la virgule (« 3,50 ») comme un NOMBRE exploitable (3.5), au même titre qu'un
// prix entier : c'est le geste que le bug du 21/07 cassait (seul le point fonctionnait).
describe('YarnEditView — prix saisi en virgule décimale', () => {
  it('un prix « 3,50 » (virgule) est transmis comme un nombre, comme un prix entier', async () => {
    const { w, pinia } = await mountView()
    const store = useYarnsStore(pinia)
    store.add.mockResolvedValue(101)
    await w.find('#yarn-color-name').setValue('Bleu')
    await w.find('#yarn-price').setValue('3,50')
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    expect(store.add).toHaveBeenCalledTimes(1)
    const payload = store.add.mock.calls[0][0]
    expect(payload.price).toBe(3.5)
    expect(typeof payload.price).toBe('number')
  })
})

// ── Porté de tests/unit/stash-quantity-floor.spec.js ─────────────────────────────────────
describe('YarnEditView — plancher de quantité sous le total réservé', () => {
  const SOURCE = { id: 1, brand: 'Drops', colorName: 'Bleu', composition: [], quantity: 5, reservations: { 2: 3, 3: 2 } }

  it('refuse de sauvegarder une quantité sous le total déjà réservé (5 = 3+2)', async () => {
    const { w, pinia } = await mountView({ routeParams: { id: '1' }, existingYarns: [SOURCE] })
    await w.find('#yarn-quantity').setValue('2')
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    expect(useYarnsStore(pinia).update).not.toHaveBeenCalled()
    expect(useSnackbarStore(pinia).show).toHaveBeenCalledWith(fr.yarn.quantityBelowReserved.replace('{n}', '5'))
  })

  it('autorise la sauvegarde à exactement le total réservé (borne inclusive)', async () => {
    const { w, pinia } = await mountView({ routeParams: { id: '1' }, existingYarns: [SOURCE] })
    await w.find('#yarn-quantity').setValue('5')
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    expect(useYarnsStore(pinia).update).toHaveBeenCalledTimes(1)
  })

  it('n’applique aucun plancher à la création d’une nouvelle laine', async () => {
    const { w, pinia } = await mountView({ existingYarns: [SOURCE] })
    const store = useYarnsStore(pinia)
    store.add.mockResolvedValue(55)
    await w.find('#yarn-color-name').setValue('Verte')
    await w.find('#yarn-quantity').setValue('1')
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    expect(store.add).toHaveBeenCalledTimes(1)
    expect(useSnackbarStore(pinia).show).not.toHaveBeenCalled()
  })
})

// ── Porté de tests/unit/stash-custom-color.spec.js ───────────────────────────────────────
// ColorPickerDialog n'est PAS stubé : ces tests pilotent le vrai composant (champ hexa +
// bouton Valider), exactement comme le fichier source.
async function pickCustomColor(w, hex) {
  await w.find('.palette__cust').trigger('click')
  await flushPromises()
  const hexInput = w.find('.cpick__hex')
  hexInput.element.value = hex
  await hexInput.trigger('input')
  await w.find('.cpick__ok').trigger('click')
  await flushPromises()
}

describe('YarnEditView — couleur personnalisée de pelote (nom du coloris)', () => {
  it('couleur perso sans nom saisi : save() bloque (colorRequired), yarnsStore.add jamais appelé', async () => {
    const { w, pinia } = await mountView({ stubOverrides: { ColorPickerDialog: false } })
    await pickCustomColor(w, '#3355ff')
    const saveBtn = w.find('.addform__actions .btn--primary')
    await saveBtn.trigger('click')
    await flushPromises()
    expect(useYarnsStore(pinia).add).not.toHaveBeenCalled()
    expect(useSnackbarStore(pinia).show).toHaveBeenCalledWith(fr.yarn.colorRequired)
  })

  it('un champ « nom du coloris » existe et permet de sortir de l’impasse : couleur perso + nom tapé s’enregistrent', async () => {
    const { w, pinia } = await mountView({ stubOverrides: { ColorPickerDialog: false } })
    const store = useYarnsStore(pinia)
    store.add.mockResolvedValue(77)
    await pickCustomColor(w, '#3355ff')
    const nameInput = w.find('#yarn-color-name')
    expect(nameInput.exists()).toBe(true)
    await nameInput.setValue('Bleu canard')
    const saveBtn = w.find('.addform__actions .btn--primary')
    await saveBtn.trigger('click')
    await flushPromises()
    expect(store.add).toHaveBeenCalledTimes(1)
    const payload = store.add.mock.calls[0][0]
    expect(payload.color).toMatch(/^hsl\(/) // couleur perso (hors palette), pas un nom de pastille
    expect(payload.colorName).toBe('Bleu canard')
  })

  it('pastille PUIS couleur perso : le nom auto-rempli par la pastille est effacé (pas de mismatch nom/couleur)', async () => {
    const { w } = await mountView({ stubOverrides: { ColorPickerDialog: false } })
    const swatch = w.findAll('button.palette__sw')[0]
    await swatch.trigger('click')
    const nameInput = w.find('#yarn-color-name')
    expect(nameInput.exists()).toBe(true)
    expect(nameInput.element.value).not.toBe('') // nom auto-rempli par la pastille
    await pickCustomColor(w, '#112233')
    expect(w.find('#yarn-color-name').element.value).toBe('') // nom auto effacé, pas de mismatch
  })
})

// ── Porté de tests/unit/stash-color-type.spec.js ─────────────────────────────────────────
// La dernière assertion du fichier source (« la recherche texte trouve une pelote par son
// type de coloris ») teste la RECHERCHE de StashView — une fonctionnalité qui reste sur
// StashView.vue, pas déplacée ici — elle n'est donc pas portée.
describe('YarnEditView — type de coloris et couleurs en mots', () => {
  it('formulaire d’ajout : type "Uni" par défaut, champ "Couleurs" absent', async () => {
    const { w } = await mountView()
    const select = w.find('#yarn-color-type')
    expect(select.exists()).toBe(true)
    expect(select.element.value).toBe('uni')
    expect(select.findAll('option')).toHaveLength(5)
    expect(w.find('#yarn-color-notes').exists()).toBe(false)
  })

  it('choisir un type non-Uni révèle le champ "Couleurs" ; repasser à Uni le masque', async () => {
    const { w } = await mountView()
    await w.find('#yarn-color-type').setValue('mouchete')
    expect(w.find('#yarn-color-notes').exists()).toBe(true)
    await w.find('#yarn-color-type').setValue('uni')
    expect(w.find('#yarn-color-notes').exists()).toBe(false)
  })

  it('save() transmet le type de coloris et les notes saisies', async () => {
    const { w, pinia } = await mountView()
    const store = useYarnsStore(pinia)
    store.add.mockResolvedValue(88)
    await w.find('#yarn-color-name').setValue('Mix océan')
    await w.find('#yarn-color-type').setValue('degrade')
    await w.find('#yarn-color-notes').setValue('bleu vers blanc')
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({
      colorType: 'degrade', colorNotes: 'bleu vers blanc',
    }))
  })

  it('éditer une pelote existante SANS la clé colorType (stock d’avant ce lot) : le type affiché est "uni"', async () => {
    const LEGACY = { id: 5, brand: 'Katia', colorName: 'Écru', quantity: 1 } // pas de colorType du tout
    const { w } = await mountView({ routeParams: { id: '5' }, existingYarns: [LEGACY] })
    expect(w.find('#yarn-color-type').element.value).toBe('uni')
  })

  it('dupliquer une pelote moucheté/teinte remet le type à "uni" ET vide les notes (pas de fuite du coloris source)', async () => {
    const SOURCE = { id: 1, brand: 'Drops', colorName: 'Bleu', quantity: 1, colorType: 'mouchete', colorNotes: 'bleu, vert, jaune' }
    const { w } = await mountView({ routeQuery: { duplicateFrom: '1' }, existingYarns: [SOURCE] })
    expect(w.find('#yarn-color-type').element.value).toBe('uni')
    expect(w.find('#yarn-color-notes').exists()).toBe(false) // masqué : type revenu à Uni

    // Repasse en Moucheté sans toucher aux notes : si applyDuplicate n'avait pas vidé
    // colorNotes, l'ancienne valeur de la pelote source réapparaîtrait ici.
    await w.find('#yarn-color-type').setValue('mouchete')
    expect(w.find('#yarn-color-notes').element.value).toBe('')
  })

  it('éditer (pas dupliquer) une pelote moucheté/teinte et repasser à "uni" vide colorNotes à la sauvegarde (pas de fuite de texte invisible dans la recherche)', async () => {
    const SOURCE = { id: 1, brand: 'Drops', colorName: 'Bleu', quantity: 1, colorType: 'mouchete', colorNotes: 'bleu, vert' }
    const { w, pinia } = await mountView({ routeParams: { id: '1' }, existingYarns: [SOURCE] })
    await w.find('#yarn-color-type').setValue('uni') // le champ colorNotes se masque, sans être vidé par l'utilisateur
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    const store = useYarnsStore(pinia)
    expect(store.update).toHaveBeenCalledWith('1', expect.objectContaining({ colorType: 'uni', colorNotes: '' }))
  })
})

// ── Porté de tests/unit/stash-composition-persist.spec.js ────────────────────────────────
describe('YarnEditView — composition « Autre » persistante', () => {
  it('un matériau personnalisé déjà présent dans le stock apparaît en chip togglable dès l\'ouverture du formulaire', async () => {
    const { w } = await mountView({ existingYarns: [{ id: 1, brand: 'Drops', colorName: 'Bleu', quantity: 1, composition: ['coton', 'kapok'] }] })

    const chip = w.findAll('.chip').find((b) => b.text().includes('kapok'))
    expect(chip).toBeTruthy()
    expect(chip.classes()).not.toContain('chip--on') // pas encore sélectionné pour CETTE nouvelle fiche
    await chip.trigger('click')
    expect(chip.classes()).toContain('chip--on')
  })

  it('un matériau tout juste tapé via « Autre » (jamais enregistré ailleurs) reste retirable au clic', async () => {
    const { w } = await mountView({ existingYarns: [{ id: 1, brand: 'Drops', colorName: 'Bleu', quantity: 1, composition: [] }] })
    await w.findAll('.chip').find((b) => b.text().includes(fr.yarn.compositionOther)).trigger('click')
    await w.find(`input[placeholder="${fr.yarn.compositionOtherPlaceholder}"]`).setValue('kapok')
    await w.findAll('button').find((b) => b.text() === fr.common.add).trigger('click')
    await flushPromises()

    let chip = w.findAll('.chip').find((b) => b.text().includes('kapok'))
    expect(chip.classes()).toContain('chip--on')
    await chip.trigger('click') // retire le matériau
    chip = w.findAll('.chip').find((b) => b.text().includes('kapok'))
    expect(chip).toBeUndefined() // pas encore enregistré ailleurs → disparaît complètement au retrait
  })
})

// ── Porté de tests/unit/stash-model-purchased.spec.js ─────────────────────────────────────
describe('YarnEditView — modèle (binding formulaire) et ligne d’achat automatique à la création', () => {
  it('une laine saisie avec un modèle arrive en base avec cette valeur', async () => {
    const { w, pinia } = await mountView()
    const store = useYarnsStore(pinia)
    store.add.mockResolvedValue(1)
    await w.find('#yarn-color-name').setValue('Bleu glacier') // requis par save()
    await w.find('#yarn-model').setValue('Baby Merino')
    const saveBtn = w.find('.addform__actions .btn--primary')
    await saveBtn.trigger('click')
    await flushPromises()

    expect(store.add).toHaveBeenCalledTimes(1)
    const payload = store.add.mock.calls[0][0]
    expect(payload.model).toBe('Baby Merino')
  })

  it('la date d’achat (retirée du formulaire) se retrouve désormais sur la ligne créée automatiquement dans purchases', async () => {
    const { w, pinia } = await mountView()
    const yarnsStore = useYarnsStore(pinia)
    yarnsStore.add.mockResolvedValue(42) // id que la fiche neuve recevrait réellement
    await w.find('#yarn-color-name').setValue('Bleu glacier')
    await w.find('#yarn-model').setValue('Baby Merino')
    await w.find('#yarn-quantity').setValue('4')
    await w.find('#yarn-price').setValue('9,50')
    const saveBtn = w.find('.addform__actions .btn--primary')
    await saveBtn.trigger('click')
    await flushPromises()

    const purchasesStore = usePurchasesStore(pinia)
    expect(purchasesStore.add).toHaveBeenCalledTimes(1)
    const line = purchasesStore.add.mock.calls[0][0]
    expect(line.yarnId).toBe(42) // l'id retourné par yarnsStore.add, pas un id inventé
    expect(line.date).toBe(todayISO())
    expect(line.quantity).toBe(4)
    expect(line.unitPrice).toBe(9.5)
    expect(line.kind).toBe('buy')
  })
})

// ── Porté de tests/unit/stash-duplicate.spec.js ──────────────────────────────────────────
describe('YarnEditView — duplication de fiche laine', () => {
  const SOURCE = {
    id: 1, brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu', color: 'hsl(210, 60%, 55%)',
    weight: 'dk', lengthM: '100', grams: '50', quantity: 5, price: '12,50', bain: 'A123',
    purchasedAt: '2026-01-01', composition: ['laine', 'coton'],
  }

  it('reprend marque/modèle/épaisseur/mètrage/grammes/composition, remet couleur/prix/date/bain à vide et quantité à 1', async () => {
    const { w, pinia } = await mountView({ routeQuery: { duplicateFrom: '1' }, existingYarns: [{ ...SOURCE }] })
    const store = useYarnsStore(pinia)
    store.add.mockResolvedValue(9)
    await w.find('#yarn-color-name').setValue('Verte')
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    expect(store.update).not.toHaveBeenCalled()
    expect(store.add).toHaveBeenCalledTimes(1)
    expect(store.add).toHaveBeenCalledWith(expect.objectContaining({
      brand: 'Drops', model: 'Baby Merino', weight: 'dk', lengthM: '100', grams: '50',
      composition: ['laine', 'coton'], quantity: 1,
      // `bain` (source : 'A123') n'est PAS repris — un bain appartient à un lot acheté, pas
      // à la laine dupliquée.
      colorName: 'Verte', color: '', price: '', purchasedAt: '', bain: '',
    }))
  })

  it('sans changer la couleur (restée vide après duplication), l’enregistrement est bloqué', async () => {
    const { w, pinia } = await mountView({ routeQuery: { duplicateFrom: '1' }, existingYarns: [{ ...SOURCE }] })
    const store = useYarnsStore(pinia)
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    expect(store.add).not.toHaveBeenCalled()
    expect(useSnackbarStore(pinia).show).toHaveBeenCalledWith(fr.yarn.colorRequired)
  })

  it('la fiche source n’est pas altérée par une duplication non enregistrée (Annuler)', async () => {
    const { w, pinia } = await mountView({ routeQuery: { duplicateFrom: '1' }, existingYarns: [{ ...SOURCE }] })
    const store = useYarnsStore(pinia)
    await w.find('#yarn-color-name').setValue('Verte')
    await w.findAll('.addform__actions button').find((b) => b.text() === fr.common.cancel).trigger('click')
    await flushPromises()

    expect(store.yarns[0]).toEqual(SOURCE)
    expect(store.add).not.toHaveBeenCalled()
    expect(store.update).not.toHaveBeenCalled()
  })

  // Nouvelle assertion (Task 3, piège d'interface avec la Task 1) : dupliquer une fiche
  // source dont la galerie n'est pas vide ne doit JAMAIS la faire hériter par la nouvelle
  // fiche — vérifié ici de bout en bout (store réel + Dexie réel), pas seulement sur le
  // payload transmis à un store mocké.
  describe('galerie non héritée à la duplication (store + Dexie réels)', () => {
    beforeEach(async () => {
      await db.open()
      await db.yarns.clear()
      await db.purchases.clear()
    })

    it('dupliquer une fiche source qui a des photos non vides enregistre la nouvelle fiche avec photos: []', async () => {
      const sourceId = await db.yarns.add({
        ...emptyYarn(),
        brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu', color: 'hsl(210, 60%, 55%)',
        quantity: 1, composition: [],
        photos: ['data:image/png;base64,xxx', 'data:image/png;base64,yyy'],
        coverIndex: 1,
      })
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: '/stash/:id', name: 'stash-item', component: { template: '<div />' } },
          { path: '/stash/new', name: 'stash-new', component: YarnEditView },
        ],
      })
      router.push({ name: 'stash-new', query: { duplicateFrom: String(sourceId) } })
      await router.isReady()
      const pinia = createPinia()
      const w = mount(YarnEditView, { global: { plugins: [router, i18n, pinia], stubs: defaultStubs } })
      await flushPromises()

      await w.find('.palette__sw').trigger('click') // couleur obligatoire
      await w.find('.addform__actions .btn--primary').trigger('click')
      await flushPromises()

      const all = await db.yarns.toArray()
      const created = all.find((y) => y.id !== sourceId)
      expect(created).toBeTruthy()
      expect(created.photos).toEqual([])
      expect(created.coverIndex).toBe(0)
      // La fiche source, elle, n'est jamais altérée.
      const source = await db.yarns.get(sourceId)
      expect(source.photos).toHaveLength(2)
    })

    // Revue finale (Finding 1a) : une fiche ANCIENNE (stock d'avant cette refonte) ne porte
    // jamais `photos` — seulement l'ex-champ unique `photo`. `photosOf()` (repli tolérant,
    // src/utils/yarn-photos.js) le lit comme une galerie à une seule photo. Sans l'exclusion
    // de `photo` dans save() (formSansGalerie), ce champ hérité via
    // `Object.assign(form, emptyYarn(), y)` (applyDuplicate) survivait jusqu'à la fiche
    // NEUVE : la duplication faisait alors fuiter la photo de la fiche source.
    it('dupliquer une fiche source ANCIENNE (ex-champ `photo`, sans `photos`) n’en hérite d’aucune photo', async () => {
      const { photos: _noPhotos, coverIndex: _noCoverIndex, ...legacySource } = { ...emptyYarn() }
      const sourceId = await db.yarns.add({
        ...legacySource,
        brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu', color: 'hsl(210, 60%, 55%)',
        quantity: 1, composition: [],
        photo: 'data:image/png;base64,xxx', // ex-champ unique, AUCUNE clé `photos`
      })
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: '/stash/:id', name: 'stash-item', component: { template: '<div />' } },
          { path: '/stash/new', name: 'stash-new', component: YarnEditView },
        ],
      })
      router.push({ name: 'stash-new', query: { duplicateFrom: String(sourceId) } })
      await router.isReady()
      const pinia = createPinia()
      const w = mount(YarnEditView, { global: { plugins: [router, i18n, pinia], stubs: defaultStubs } })
      await flushPromises()

      await w.find('.palette__sw').trigger('click') // couleur obligatoire
      await w.find('.addform__actions .btn--primary').trigger('click')
      await flushPromises()

      const all = await db.yarns.toArray()
      const created = all.find((y) => y.id !== sourceId)
      expect(created).toBeTruthy()
      expect(photosOf(created)).toEqual([]) // aucune photo héritée, pas même via le repli
      expect(created.photo).toBeFalsy()
      expect(created.photos == null || created.photos.length === 0).toBe(true)
      // La fiche source, elle, n'est jamais altérée : elle garde sa photo héritée.
      const source = await db.yarns.get(sourceId)
      expect(source.photo).toBe('data:image/png;base64,xxx')
    })
  })
})

// ── Revue finale (Finding 2) : `duplicateFrom` périmé (id supprimé entre-temps) ─────────
// Un lien de duplication (bouton kebab « Dupliquer », ou retour arrière après suppression de
// la fiche source) peut pointer vers un id qui n'existe plus dans le store. Ce cas matchait
// la branche `else if (route.query.duplicateFrom)` sans y trouver de fiche — sautant à la
// fois `applyDuplicate` ET le formulaire vierge du `else`, laissant `pristine.lengthM`/
// `pristine.grams` à leur défaut brut `null`.
describe('YarnEditView — duplicateFrom pointant vers une fiche disparue', () => {
  beforeEach(async () => {
    await db.open()
    await db.yarns.clear()
    await db.settings.clear()
    await db.purchases.clear()
  })

  it('id de duplicateFrom introuvable en base : longueur/poids laissés vides s’enregistrent comme "" (pas null)', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/stash/:id', name: 'stash-item', component: { template: '<div />' } },
        { path: '/stash/new', name: 'stash-new', component: YarnEditView },
      ],
    })
    router.push({ name: 'stash-new', query: { duplicateFrom: '999999' } }) // id absent de la base
    await router.isReady()
    const pinia = createPinia()
    const w = mount(YarnEditView, { global: { plugins: [router, i18n, pinia], stubs: defaultStubs } })
    await flushPromises()

    await w.find('#yarn-color-name').setValue('Bleu glacier') // requis par save()
    await w.find('.palette__sw').trigger('click')
    await w.find('.addform__actions .btn--primary').trigger('click')
    await flushPromises()

    const saved = (await db.yarns.toArray())[0]
    expect(saved).toBeTruthy()
    expect(saved.lengthM).toBe('')
    expect(saved.grams).toBe('')
  })
})

// ── Porté de tests/unit/stash-fermeture-apres-ecriture.spec.js ──────────────────────────
// Invariant issu du bug du 06/08 (écran Dépenses : 12,80 € au lieu de 30,50 €) : L'ÉCRAN NE
// NAVIGUE (router.replace) QUE UNE FOIS TOUT ÉCRIT. Le formulaire enchaîne DEUX écritures —
// la fiche, puis sa ligne d'achat — et ne doit jamais quitter l'écran avant que les deux
// soient en base.
describe('YarnEditView — la navigation n’a lieu qu’une fois la ligne d’achat écrite', () => {
  beforeEach(async () => {
    await db.open()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function retenirEcritureAchat() {
    const addReel = db.purchases.add.bind(db.purchases)
    let ouvrir
    const barriere = new Promise((r) => { ouvrir = r })
    vi.spyOn(db.purchases, 'add').mockImplementation(async (data) => {
      await barriere
      return addReel(data)
    })
    return () => ouvrir()
  }
  const tours = async (n = 10) => {
    for (let i = 0; i < n; i++) await flushPromises()
  }

  async function mountReal({ routeParams = {}, yarns = [] } = {}) {
    await db.yarns.clear()
    await db.settings.clear()
    await db.purchases.clear()
    for (const y of yarns) await db.yarns.add(y)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/stash/:id', name: 'stash-item', component: { template: '<div />' } },
        { path: '/stash/new', name: 'stash-new', component: YarnEditView },
        { path: '/stash/:id/edit', name: 'stash-edit', component: YarnEditView },
      ],
    })
    const name = routeParams.id ? 'stash-edit' : 'stash-new'
    router.push({ name, params: routeParams })
    await router.isReady()
    const pinia = createPinia()
    const w = mount(YarnEditView, { global: { plugins: [router, i18n, pinia], stubs: defaultStubs } })
    await flushPromises()
    return { w, router }
  }

  it('création : pas de navigation tant que la ligne d’achat est en vol', async () => {
    const { w, router } = await mountReal()
    await w.find('#yarn-color-name').setValue('Bleu')
    await w.find('#yarn-quantity').setValue('2')
    await w.find('#yarn-price').setValue('6,40')

    const startName = router.currentRoute.value.name
    const liberer = retenirEcritureAchat()
    await w.find('.addform__actions .btn--primary').trigger('click')
    await tours()

    expect(await db.yarns.count()).toBe(1) // la fiche, elle, est déjà écrite…
    expect(await db.purchases.count()).toBe(0) // …son achat est retenu, donc pas encore en base
    // …et c'est précisément là que l'écran ne doit PAS avoir navigué : naviguer
    // annoncerait un enregistrement terminé alors qu'il reste une écriture en vol.
    expect(router.currentRoute.value.name).toBe(startName)

    liberer()
    await tours()

    expect(await db.purchases.count()).toBe(1)
    expect(router.currentRoute.value.name).toBe('stash-item') // maintenant, et seulement maintenant
  })

  it('édition : même garantie quand une hausse de quantité est enregistrée en achat', async () => {
    const { w, router } = await mountReal({
      routeParams: { id: '4' },
      yarns: [{ id: 4, brand: 'Katia', colorName: 'Rouge', quantity: 2, price: '17,70', composition: [], reservations: {}, consumed: {} }],
    })
    await w.find('#yarn-quantity').setValue('5')
    await w.find('.addform__actions .btn--primary').trigger('click')
    await tours()
    expect(w.find('[data-test="qty-increase-prompt"]').exists()).toBe(true) // hausse ⇒ proposition

    const liberer = retenirEcritureAchat()
    await w.find('[data-test="qty-increase-buy"]').trigger('click')
    await tours()

    expect(await db.purchases.count()).toBe(0) // écriture retenue
    expect(router.currentRoute.value.name).toBe('stash-edit') // l'écran tient bon

    liberer()
    await tours()

    expect(await db.purchases.count()).toBe(1)
    expect(router.currentRoute.value.name).toBe('stash-item')
    expect(router.currentRoute.value.params.id).toBe('4')
  })
})

// ── Porté de tests/unit/StashView-form-units.spec.js ─────────────────────────────────────
describe('YarnEditView — formulaire (unités, prix) avec store + Dexie réels', () => {
  async function setupDb({ imperial = false, currency = '' } = {}) {
    await db.yarns.clear()
    await db.settings.clear()
    await db.purchases.clear()
    if (imperial) await db.settings.put({ key: 'unitSystem', value: 'imperial' })
    if (currency) await db.settings.put({ key: 'currency', value: currency })
  }

  async function mountReal({ routeParams = {}, routeQuery = {} } = {}) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/stash/:id', name: 'stash-item', component: { template: '<div />' } },
        { path: '/stash/new', name: 'stash-new', component: YarnEditView },
        { path: '/stash/:id/edit', name: 'stash-edit', component: YarnEditView },
      ],
    })
    const name = routeParams.id ? 'stash-edit' : 'stash-new'
    router.push({ name, params: routeParams, query: routeQuery })
    await router.isReady()
    const pinia = createPinia()
    // YarnEditView (contrairement à StashView) ne charge plus les réglages lui-même — en
    // usage réel, le garde global du routeur (src/router/index.js) les a déjà chargés avant
    // toute navigation. Ce montage direct (test) reproduit donc ce chargement ici, comme le
    // ferait la vraie app avant d'atteindre cet écran.
    await useSettingsStore(pinia).load()
    const w = mount(YarnEditView, { global: { plugins: [router, i18n, pinia] } })
    await flushPromises()
    return w
  }

  const saveForm = async (w) => {
    await w.findAll('button').find((b) => b.text() === fr.common.save).trigger('click')
    await flushPromises()
  }

  describe('mode impérial', () => {
    beforeEach(async () => {
      await db.open()
    })

    it('libelle les champs en yards et en onces', async () => {
      await setupDb({ imperial: true })
      const w = await mountReal()
      expect(w.text()).toContain('Longueur (yd)')
      expect(w.text()).toContain('oz / pelote')
      expect(w.text()).not.toContain('Métrage (m)')
    })

    it('associe chaque libellé au bon champ, pas seulement leur présence sur la page', async () => {
      await setupDb({ imperial: true })
      const w = await mountReal()
      const cols = w.findAll('.row--fields .col')
      const lengthCol = cols.find((c) => c.find('input').attributes('placeholder') === '100')
      const weightCol = cols.find((c) => c.find('input').attributes('placeholder') === '50')
      expect(lengthCol.find('.field-label').text()).toBe('Longueur (yd)')
      expect(weightCol.find('.field-label').text()).toBe('oz / pelote')
    })

    it('le libellé du prix porte le symbole de la devise choisie, pas une devise en dur', async () => {
      await setupDb({ imperial: true, currency: 'USD' })
      const w = await mountReal()
      expect(w.text()).toContain('Prix / pelote ($)')
      expect(w.text()).not.toContain('Prix / pelote (€)')
    })

    it('pré-remplit les champs avec les valeurs converties', async () => {
      await setupDb({ imperial: true })
      const yarnId = await db.yarns.add({ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50 })
      const w = await mountReal({ routeParams: { id: String(yarnId) } })
      const inputs = w.findAll('.addform input')
      const length = inputs.find((i) => i.attributes('placeholder') === '100')
      // toInput() arrondit à 3 décimales. 100 / 0,9144 = 109,3613... → 109,361.
      expect(length.element.value).toBe('109,361')
      // 50 g / 28,349523125 = 1,7636... → 1,764.
      const weight = inputs.find((i) => i.attributes('placeholder') === '50')
      expect(weight.element.value).toBe('1,764')
    })

    it('convertit une valeur RÉELLEMENT modifiée', async () => {
      await setupDb({ imperial: true })
      const yarnId = await db.yarns.add({ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50 })
      const w = await mountReal({ routeParams: { id: String(yarnId) } })
      const length = w.findAll('.addform input').find((i) => i.attributes('placeholder') === '100')
      await length.setValue('220')
      await saveForm(w)
      const saved = await db.yarns.get(yarnId)
      expect(saved.lengthM).toBeCloseTo(220 * 0.9144, 3) // 201,168 m
    })

    it('NE TOUCHE PAS une valeur non modifiée, même après dix allers-retours', async () => {
      await setupDb({ imperial: true })
      const yarnId = await db.yarns.add({ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50 })
      for (let i = 0; i < 10; i++) {
        const w = await mountReal({ routeParams: { id: String(yarnId) } })
        await saveForm(w)
      }
      const saved = await db.yarns.get(yarnId)
      expect(saved.lengthM).toBe(100)
      expect(saved.grams).toBe(50)
    })

    it('enregistre en mètres ce qui est saisi en yards à la création', async () => {
      await setupDb({ imperial: true })
      const w = await mountReal()
      const inputs = w.findAll('.addform input')
      await inputs.find((i) => i.attributes('placeholder') === '100').setValue('220')
      await inputs.find((i) => i.attributes('placeholder') === '50').setValue('3,5')
      await w.find('.palette__sw').trigger('click') // coloris obligatoire
      await saveForm(w)
      const saved = (await db.yarns.toArray())[0]
      expect(saved.lengthM).toBeCloseTo(201.168, 2)
      expect(saved.grams).toBeCloseTo(99.22, 1)
    })

    it('duplique une fiche : la longueur/le poids non modifiés restent les valeurs canoniques d’origine', async () => {
      await setupDb({ imperial: true })
      const yarnId = await db.yarns.add({ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50 })
      const w = await mountReal({ routeQuery: { duplicateFrom: String(yarnId) } })
      await w.find('.palette__sw').trigger('click') // openDuplicate vide colorName
      await saveForm(w)
      const all = await db.yarns.toArray()
      expect(all).toHaveLength(2)
      for (const y of all) {
        expect(y.lengthM).toBe(100)
        expect(y.grams).toBe(50)
      }
    })

    it('après une édition annulée, un ajout repart de zéro — pas de référence fantôme', async () => {
      await setupDb({ imperial: true })
      const yarnId = await db.yarns.add({ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50 })
      // Édition annulée : navigation réelle (router.back()) démonte cet écran, comme le
      // ferait la vraie app (route distincte de stash-edit).
      const w1 = await mountReal({ routeParams: { id: String(yarnId) } })
      await w1.findAll('button').find((b) => b.text() === fr.common.cancel).trigger('click')
      w1.unmount()
      // Nouvel ajout : écran neuf (stash-new est une route distincte de stash-edit — la
      // vraie navigation démonte/remonte l'écran, cf. commentaire ci-dessus).
      const w2 = await mountReal()
      const inputs = w2.findAll('.addform input')
      const length = inputs.find((i) => i.attributes('placeholder') === '100')
      const weight = inputs.find((i) => i.attributes('placeholder') === '50')
      expect(length.element.value).toBe('')
      expect(weight.element.value).toBe('')
      await weight.setValue('1,764')
      await w2.find('.palette__sw').trigger('click')
      await saveForm(w2)
      const created = (await db.yarns.toArray()).find((y) => y.id !== yarnId)
      expect(created.grams).toBeCloseTo(1.764 * 28.349523125, 2)
      expect(created.grams).not.toBe(50)
    })

    it('laisse un champ vide vide, sans y écrire 0', async () => {
      await setupDb({ imperial: true })
      const yarnId = await db.yarns.add({ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: '', grams: '' })
      const w = await mountReal({ routeParams: { id: String(yarnId) } })
      await saveForm(w)
      const saved = await db.yarns.get(yarnId)
      expect(saved.lengthM === '' || saved.lengthM == null).toBe(true)
    })

    // Régression (revue) : le create branch de onMounted doit appeler loadUnitFields(null)
    // comme le faisait l'ancien openAdd() — sinon pristine.lengthM/pristine.grams restent à
    // leur défaut brut `null` au lieu de '', et canonicalUnitFields() enregistre `null`
    // plutôt que '' pour une fiche neuve dont la longueur/le poids restent vides.
    it('création : longueur/poids laissés vides s’enregistrent comme "" (pas null)', async () => {
      await setupDb({ imperial: true })
      const w = await mountReal()
      await w.find('.palette__sw').trigger('click') // coloris obligatoire
      await saveForm(w)
      const saved = (await db.yarns.toArray())[0]
      expect(saved.lengthM).toBe('')
      expect(saved.grams).toBe('')
    })
  })

  describe('mode métrique inchangé', () => {
    beforeEach(async () => {
      await db.open()
    })

    it('enregistre la valeur telle quelle, sans conversion', async () => {
      await setupDb()
      const yarnId = await db.yarns.add({ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50 })
      const w = await mountReal({ routeParams: { id: String(yarnId) } })
      await saveForm(w)
      const saved = await db.yarns.get(yarnId)
      expect(saved.lengthM).toBe(100)
    })

    it('NE TOUCHE PAS une valeur non modifiée en métrique non plus — couverture directe', async () => {
      await setupDb()
      const yarnId = await db.yarns.add({ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50 })
      for (let i = 0; i < 3; i++) {
        const w = await mountReal({ routeParams: { id: String(yarnId) } })
        await saveForm(w)
      }
      const saved = await db.yarns.get(yarnId)
      expect(saved.lengthM).toBe(100)
      expect(saved.grams).toBe(50)
    })
  })

  describe('Prix/pelote normalisé', () => {
    beforeEach(async () => {
      await db.open()
    })

    it('normalise le prix/pelote en nombre à l\'enregistrement, comme le métrage', async () => {
      await setupDb()
      const w = await mountReal()
      const inputs = w.findAll('.addform input')
      const priceInput = inputs.find((i) => i.attributes('id') === 'yarn-price')
      await priceInput.setValue(',7366')
      await priceInput.trigger('input')
      await w.find('.palette__sw').trigger('click') // coloris obligatoire
      await saveForm(w)
      const saved = await db.yarns.toCollection().last()
      expect(saved.price).toBe(0.7366)
      expect(typeof saved.price).toBe('number')
    })

    it('laisse un prix vide vide, sans y écrire 0', async () => {
      await setupDb()
      const w = await mountReal()
      await w.find('.palette__sw').trigger('click') // coloris obligatoire
      await saveForm(w)
      const saved = await db.yarns.toCollection().last()
      expect(saved.price).toBe('')
    })

    it('enregistre vide, pas NaN, un prix laissé à un séparateur seul', async () => {
      await setupDb()
      const w = await mountReal()
      const inputs = w.findAll('.addform input')
      const priceInput = inputs.find((i) => i.attributes('id') === 'yarn-price')
      await priceInput.setValue(',')
      await priceInput.trigger('input')
      await w.find('.palette__sw').trigger('click') // coloris obligatoire
      await saveForm(w)
      const saved = await db.yarns.toCollection().last()
      expect(saved.price).toBe('')
      expect(Number.isNaN(saved.price)).toBe(false)
    })

    it('un prix hérité à null reste vide après un aller-retour édition/enregistrement', async () => {
      await setupDb()
      const yarnId = await db.yarns.add({ brand: 'Maison', colorName: 'Rouge', quantity: 1, price: null })
      const w = await mountReal({ routeParams: { id: String(yarnId) } })
      await saveForm(w)
      const saved = await db.yarns.get(yarnId)
      expect(saved.price).toBe('')
      expect(Number.isNaN(saved.price)).toBe(false)
    })

    it('réaffiche un prix numérique avec la virgule française à la réouverture', async () => {
      await setupDb()
      const yarnId = await db.yarns.add({ brand: 'Maison', colorName: 'Rouge', quantity: 1, price: 9.5 })
      const w = await mountReal({ routeParams: { id: String(yarnId) } })
      const inputs = w.findAll('.addform input')
      const priceInput = inputs.find((i) => i.attributes('id') === 'yarn-price')
      expect(priceInput.element.value).toBe('9,5')
    })
  })
})

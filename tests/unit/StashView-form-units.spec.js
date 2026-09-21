import { beforeEach, describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { db } from '@/db/db'
import StashView from '@/views/StashView.vue'
import { useSettingsStore } from '@/stores/settings'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

async function mountStash({ imperial = false, yarns = [], currency = '' } = {}) {
  await db.yarns.clear()
  await db.settings.clear()
  // Depuis les travaux sur le budget laine (01/08), toute création écrit aussi une ligne dans
  // `purchases` (cf. StashView.vue:save()) — nettoyée ici pour ne pas laisser une pile de
  // lignes fantômes s'accumuler d'un test à l'autre (aucune assertion de ce fichier ne lit
  // cette table, mais une base non purgée entre les runs est un vieux piège de ce projet).
  await db.purchases.clear()
  if (imperial) await db.settings.put({ key: 'unitSystem', value: 'imperial' })
  if (currency) await db.settings.put({ key: 'currency', value: currency })
  for (const y of yarns) await db.yarns.add(y)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'stash', component: StashView }],
  })
  router.push('/')
  await router.isReady()
  const pinia = createPinia()
  const w = mount(StashView, { global: { plugins: [router, i18n, pinia] } })
  // settings.load() (onMounted) enchaîne ~10 lectures Dexie séquentielles : un nombre fixe
  // de flushPromises() est fragile (cf. tests/unit/StashView-recap.spec.js, même piège déjà
  // rencontré). On boucle jusqu'au signal réel settings.loaded plutôt que de parier sur un
  // compte de tours.
  const settings = useSettingsStore(pinia)
  let rounds = 0
  while (!settings.loaded && rounds < 20) {
    await flushPromises()
    rounds++
  }
  await flushPromises()
  return w
}

// [data-test="yarn-menu"] n'existe pas dans YarnCard.vue (hors périmètre de cette tâche :
// seuls StashView.vue et ce test sont modifiables) — le kebab d'actions y porte la classe
// .ycard__kebab. Adapté en conséquence.
const openEditOn = async (w, name) => {
  const card = w.findAll('.ycard').find((c) => c.text().includes(name))
  await card.find('.ycard__kebab').trigger('click')
  await flushPromises()
  await card.findAll('button').find((b) => b.text().includes('Modifier')).trigger('click')
  await flushPromises()
}
const saveForm = async (w) => {
  await w.findAll('button').find((b) => b.text() === 'Enregistrer').trigger('click')
  await flushPromises()
}

describe('formulaire du stock — mode impérial', () => {
  beforeEach(async () => {
    await db.open()
  })

  it('libelle les champs en yards et en onces', async () => {
    const w = await mountStash({ imperial: true })
    await w.findAll('button').find((b) => /Ajouter une laine/.test(b.text())).trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Longueur (yd)')
    expect(w.text()).toContain('oz / pelote')
    expect(w.text()).not.toContain('Métrage (m)')
  })

  it('associe chaque libellé au bon champ, pas seulement leur présence sur la page', async () => {
    // La présence des 2 textes dans la page ne prouve pas leur appariement (un libellé
    // pourrait se retrouver au-dessus du mauvais champ sans que ce test-ci le remarque).
    // Vérifié ici via la paire label/input du même bloc .col (pas de for/id disponible
    // sur ces champs dans le template).
    const w = await mountStash({ imperial: true })
    await w.findAll('button').find((b) => /Ajouter une laine/.test(b.text())).trigger('click')
    await flushPromises()
    const cols = w.findAll('.row--fields .col')
    const lengthCol = cols.find((c) => c.find('input').attributes('placeholder') === '100')
    const weightCol = cols.find((c) => c.find('input').attributes('placeholder') === '50')
    expect(lengthCol.find('.field-label').text()).toBe('Longueur (yd)')
    expect(weightCol.find('.field-label').text()).toBe('oz / pelote')
  })

  it('le libellé du prix porte le symbole de la devise choisie, pas une devise en dur', async () => {
    const w = await mountStash({ imperial: true, currency: 'USD' })
    await w.findAll('button').find((b) => /Ajouter une laine/.test(b.text())).trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Prix / pelote ($)')
    expect(w.text()).not.toContain('Prix / pelote (€)')
  })

  it('pré-remplit les champs avec les valeurs converties', async () => {
    const w = await mountStash({ imperial: true, yarns: [{ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50 }] })
    await openEditOn(w, 'Maison')
    const inputs = w.findAll('.addform input')
    const length = inputs.find((i) => i.attributes('placeholder') === '100')
    // toInput() arrondit à 3 décimales (INPUT_DECIMALS, src/utils/units.js), pas 2 : l'attendu
    // initial était « 109,36 », valeur qui ne correspond plus à l'implémentation retenue
    // depuis (3 décimales pour garder l'aller-retour fidèle sous le gramme/once).
    // 100 / 0,9144 = 109,3613... → 109,361.
    expect(length.element.value).toBe('109,361')
    // Le champ des onces n'était vérifié par AUCUN test avant ce correctif (revue) : une
    // inversion kind:'weight'/kind:'length' dans loadUnitFields() passait inaperçue.
    // 50 g / 28,349523125 = 1,7636... → 1,764.
    const weight = inputs.find((i) => i.attributes('placeholder') === '50')
    expect(weight.element.value).toBe('1,764')
  })

  it('convertit une valeur RÉELLEMENT modifiée', async () => {
    const w = await mountStash({ imperial: true, yarns: [{ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50 }] })
    await openEditOn(w, 'Maison')
    const length = w.findAll('.addform input').find((i) => i.attributes('placeholder') === '100')
    await length.setValue('220')
    await saveForm(w)
    const saved = (await db.yarns.toArray())[0]
    expect(saved.lengthM).toBeCloseTo(220 * 0.9144, 3) // 201,168 m
  })

  it('NE TOUCHE PAS une valeur non modifiée, même après dix allers-retours', async () => {
    // Le cœur du lot. La dérive n'est PAS cumulative : l'arrondi d'affichage atteint un
    // point fixe dès le premier aller-retour (100 m → 99,9996984 m, puis cette valeur se
    // reconvertit à l'identique ensuite). Dix passages ne creusent donc pas l'écart — mais
    // perdre 0,0003 m une seule fois, sans que personne n'ait touché à la fiche, est déjà
    // une perte d'information silencieuse à elle seule, ce qui suffit à justifier la garde.
    // Le nombre de tours ici vérifie surtout que la garde protège de façon stable dans la
    // durée, pas qu'elle empêche une dérive qui s'aggraverait autrement.
    const w = await mountStash({ imperial: true, yarns: [{ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50 }] })
    for (let i = 0; i < 10; i++) {
      await openEditOn(w, 'Maison')
      await saveForm(w)
    }
    const saved = (await db.yarns.toArray())[0]
    expect(saved.lengthM).toBe(100)
    expect(saved.grams).toBe(50)
  })

  it('enregistre en mètres ce qui est saisi en yards à la création', async () => {
    const w = await mountStash({ imperial: true })
    await w.findAll('button').find((b) => /Ajouter une laine/.test(b.text())).trigger('click')
    await flushPromises()
    const inputs = w.findAll('.addform input')
    await inputs.find((i) => i.attributes('placeholder') === '100').setValue('220')
    await inputs.find((i) => i.attributes('placeholder') === '50').setValue('3,5')
    // Le coloris est obligatoire : le poser via la palette comme le fait le parcours réel.
    await w.find('.palette__sw').trigger('click')
    await saveForm(w)
    const saved = (await db.yarns.toArray())[0]
    expect(saved.lengthM).toBeCloseTo(201.168, 2)
    expect(saved.grams).toBeCloseTo(99.22, 1)
  })

  it('duplique une fiche : la longueur/le poids non modifiés restent les valeurs canoniques d’origine', async () => {
    // Les 3 usages du formulaire (création, édition, duplication) doivent poser correctement
    // la valeur de référence — sinon la garde protège l'un et laisse dériver les autres
    // (point de vigilance). openDuplicate vide colorName : il faut le reposer via
    // la palette (comme le parcours réel) pour que save() ne soit pas bloqué par le contrôle
    // « coloris obligatoire ».
    const w = await mountStash({ imperial: true, yarns: [{ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50 }] })
    const card = w.findAll('.ycard').find((c) => c.text().includes('Maison'))
    await card.find('.ycard__kebab').trigger('click')
    await flushPromises()
    await card.findAll('button').find((b) => b.text().includes('Dupliquer')).trigger('click')
    await flushPromises()
    await w.find('.palette__sw').trigger('click')
    await saveForm(w)
    const all = await db.yarns.toArray()
    expect(all).toHaveLength(2)
    for (const y of all) {
      expect(y.lengthM).toBe(100)
      expect(y.grams).toBe(50)
    }
  })

  it('après une édition annulée, un ajout repart de zéro — pas de référence fantôme', async () => {
    // closeForm() ne remet JAMAIS `pristine` à zéro — seule loadUnitFields(null) dans
    // openAdd() le fait. Un champ laissé VIDE dans le nouvel ajout est de toute façon
    // protégé (fromInput('') rend '' quel que soit `pristine`) : ce cas ne suffit PAS à
    // discriminer la garde, vérifié empiriquement en appliquant la mutation avant d'écrire
    // ce test. Le vrai risque : un texte NEUF qui coïncide, par coïncidence ou habitude
    // (rachat du même skein), avec l'affichage laissé par l'édition annulée. Sans la
    // remise à zéro, ce texte serait pris pour « non modifié » et hériterait tel quel de
    // la valeur canonique de l'ANCIENNE fiche au lieu d'être converti pour ce qu'il est.
    const w = await mountStash({ imperial: true, yarns: [{ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50 }] })
    await openEditOn(w, 'Maison')
    await w.findAll('button').find((b) => b.text() === 'Annuler').trigger('click')
    await flushPromises()
    await w.findAll('button').find((b) => /Ajouter une laine/.test(b.text())).trigger('click')
    await flushPromises()
    const inputs = w.findAll('.addform input')
    const length = inputs.find((i) => i.attributes('placeholder') === '100')
    const weight = inputs.find((i) => i.attributes('placeholder') === '50')
    // Un ajout vierge doit être VRAIMENT vierge : aucun résidu visible de l'édition annulée.
    expect(length.element.value).toBe('')
    expect(weight.element.value).toBe('')
    // Coïncidence réaliste : le nouvel utilisateur retape exactement ce que l'édition
    // annulée affichait (1,764 oz = les 50 g de « Maison »), pour une pelote DIFFÉRENTE.
    await weight.setValue('1,764')
    await w.find('.palette__sw').trigger('click')
    await saveForm(w)
    const created = (await db.yarns.toArray()).find((y) => y.brand !== 'Maison')
    // 1,764 oz saisi pour CETTE fiche doit être converti pour ce qu'il est (≈50,009 g),
    // jamais hérité tel quel des 50 g canoniques de la fiche précédente.
    expect(created.grams).toBeCloseTo(1.764 * 28.349523125, 2)
    expect(created.grams).not.toBe(50)
  })

  it('laisse un champ vide vide, sans y écrire 0', async () => {
    const w = await mountStash({ imperial: true, yarns: [{ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: '', grams: '' }] })
    await openEditOn(w, 'Maison')
    await saveForm(w)
    const saved = (await db.yarns.toArray())[0]
    expect(saved.lengthM === '' || saved.lengthM == null).toBe(true)
  })
})

describe('formulaire du stock — mode métrique inchangé', () => {
  beforeEach(async () => {
    await db.open()
  })

  it('enregistre la valeur telle quelle, sans conversion', async () => {
    const w = await mountStash({ yarns: [{ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50 }] })
    await openEditOn(w, 'Maison')
    await saveForm(w)
    const saved = (await db.yarns.toArray())[0]
    expect(saved.lengthM).toBe(100)
  })

  it('NE TOUCHE PAS une valeur non modifiée en métrique non plus — couverture directe', async () => {
    // Avant ce correctif, la garde en métrique n'était couverte que par accident (un test
    // d'un autre fichier tombait pour une raison sans rapport). Le test ci-dessus ne
    // vérifie que `lengthM` : ajout d'une couverture directe des DEUX champs, dans ce
    // fichier, sur plusieurs allers-retours comme le test impérial équivalent.
    const w = await mountStash({ yarns: [{ brand: 'Maison', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50 }] })
    for (let i = 0; i < 3; i++) {
      await openEditOn(w, 'Maison')
      await saveForm(w)
    }
    const saved = (await db.yarns.toArray())[0]
    expect(saved.lengthM).toBe(100)
    expect(saved.grams).toBe(50)
  })
})

describe('formulaire du stock -- Prix/pelote normalisé', () => {
  beforeEach(async () => {
    await db.open()
  })

  it('normalise le prix/pelote en nombre à l\'enregistrement, comme le métrage', async () => {
    const w = await mountStash()
    await w.findAll('button').find((b) => /Ajouter une laine/.test(b.text())).trigger('click')
    await flushPromises()
    // Remplir les champs obligatoires
    const inputs = w.findAll('.addform input')
    const priceInput = inputs.find((i) => i.attributes('id') === 'yarn-price')
    await priceInput.setValue(',7366')
    await priceInput.trigger('input')
    // Coloris obligatoire
    await w.find('.palette__sw').trigger('click')
    await saveForm(w)
    const saved = await db.yarns.toCollection().last()
    expect(saved.price).toBe(0.7366)
    expect(typeof saved.price).toBe('number')
  })

  it('laisse un prix vide vide, sans y écrire 0', async () => {
    const w = await mountStash()
    await w.findAll('button').find((b) => /Ajouter une laine/.test(b.text())).trigger('click')
    await flushPromises()
    // Laisser le prix vide (ne pas le remplir)
    // Coloris obligatoire
    await w.find('.palette__sw').trigger('click')
    await saveForm(w)
    const saved = await db.yarns.toCollection().last()
    expect(saved.price).toBe('')
  })

  // `filtrerSaisieDecimale` (utils/decimal.js) garde volontairement un séparateur SEUL tel
  // quel (« , » reste « , », sans quoi « 0,5 » collapserait en « 05 » au moment même où la
  // virgule est tapée) — donc form.price === ',' n'entre PAS dans la branche `=== ''` et
  // partait tout droit dans parseDecimal(','), un NaN écrit en base (revue finale). Un prix
  // resté à un séparateur seul doit s'enregistrer vide, exactement comme un champ jamais
  // touché.
  it('enregistre vide, pas NaN, un prix laissé à un séparateur seul', async () => {
    const w = await mountStash()
    await w.findAll('button').find((b) => /Ajouter une laine/.test(b.text())).trigger('click')
    await flushPromises()
    const inputs = w.findAll('.addform input')
    const priceInput = inputs.find((i) => i.attributes('id') === 'yarn-price')
    await priceInput.setValue(',')
    await priceInput.trigger('input')
    // Coloris obligatoire
    await w.find('.palette__sw').trigger('click')
    await saveForm(w)
    const saved = await db.yarns.toCollection().last()
    expect(saved.price).toBe('')
    expect(Number.isNaN(saved.price)).toBe(false)
  })

  // `price: null` peut venir d'une fiche restaurée/importée : avant ce correctif, `null !==
  // ''` faisait passer la valeur dans parseDecimal(null), un NaN écrit en base au premier
  // enregistrement suivant (revue finale) — la fiche perdait silencieusement son « prix
  // inconnu » pour un prix APPAREMMENT connu (NaN ne matche plus `isPriceUnknown`).
  it('un prix hérité à null reste vide après un aller-retour édition/enregistrement', async () => {
    const w = await mountStash({ yarns: [{ brand: 'Maison', colorName: 'Rouge', quantity: 1, price: null }] })
    await openEditOn(w, 'Maison')
    await saveForm(w)
    const saved = (await db.yarns.toArray())[0]
    expect(saved.price).toBe('')
    expect(Number.isNaN(saved.price)).toBe(false)
  })

  // Depuis que `price` est un nombre JS en base (ce lot), rouvrir une fiche doit réafficher
  // « 9,5 » — pas « 9.5 » — dans le champ prix : même parité que le métrage/poids (`toInput`),
  // le but affiché de ce chantier (revue finale, finding 2).
  it('réaffiche un prix numérique avec la virgule française à la réouverture', async () => {
    const w = await mountStash({ yarns: [{ brand: 'Maison', colorName: 'Rouge', quantity: 1, price: 9.5 }] })
    await openEditOn(w, 'Maison')
    const inputs = w.findAll('.addform input')
    const priceInput = inputs.find((i) => i.attributes('id') === 'yarn-price')
    expect(priceInput.element.value).toBe('9,5')
  })
})

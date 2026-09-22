// Unitaire — les trois champs de PRIX n'acceptent que des chiffres et un séparateur décimal.
//
// Défaut connu : un prix tapé « 18,90 € » (avec le symbole) donnait NaN, puis 0, puis
// s'affichait « Gratuit » — sur la fiche patron, la fiche projet ET l'écran Dépenses, et le
// total des dépenses ne bougeait pas. Un arbitrage du 21/08 : bloquer la saisie, plutôt
// que d'inventer un quatrième état d'affichage ou de deviner ce que l'utilisatrice voulait dire.
//
// Mesuré sur la Nexus 7 le 21/08 avant de coder : 64 prix de laines et d'achats, 10 prix de
// patrons, AUCUN illisible. Le blocage suffit donc pour les données réelles — il n'y a pas de
// rattrapage à faire.
//
// Trois champs, et trois seulement : #yarn-price (fiche laine), #ypur-price (ligne d'achat),
// #pat-price (prix du patron). Les autres `inputmode="decimal"` de l'app sont des aiguilles,
// des échantillons et la jauge : ils ne sont pas concernés par ce défaut, ils ne bougent pas.
//
// `patternPriceState` n'est PAS touché : son test 5 (« environ 5 » ⇒ gratuit) décrit ce que
// l'app fait d'une donnée HÉRITÉE, pas ce qu'elle accepte à la frappe. Les deux contrats vivent
// côte à côte.
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { db } from '@/db/db'
import { filtrerSaisieDecimale } from '@/utils/decimal'
import { useSettingsStore } from '@/stores/settings'
import { usePurchasesStore } from '@/stores/purchases'
import YarnEditView from '@/views/YarnEditView.vue'
import YarnPurchases from '@/components/YarnPurchases.vue'
import PatternPriceFields from '@/components/PatternPriceFields.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

describe('filtrerSaisieDecimale — la règle, isolée', () => {
  it('laisse passer un prix déjà propre, virgule comme point', () => {
    expect(filtrerSaisieDecimale('18,90')).toBe('18,90')
    expect(filtrerSaisieDecimale('18.90')).toBe('18.90')
    expect(filtrerSaisieDecimale('12')).toBe('12')
    expect(filtrerSaisieDecimale('')).toBe('')
  })

  it('retire le symbole de devise', () => {
    expect(filtrerSaisieDecimale('18,90 €')).toBe('18,90')
    expect(filtrerSaisieDecimale('€18.90')).toBe('18.90')
    expect(filtrerSaisieDecimale('12 CHF')).toBe('12')
  })

  it('retire les lettres et les espaces', () => {
    expect(filtrerSaisieDecimale('environ 5')).toBe('5')
    expect(filtrerSaisieDecimale('1 000')).toBe('1000')
  })

  it('ne garde qu’UN séparateur, le premier — les suivants tombent', () => {
    expect(filtrerSaisieDecimale('1.2.3')).toBe('1.23')
    expect(filtrerSaisieDecimale('1,2,3')).toBe('1,23')
    expect(filtrerSaisieDecimale('1.2,3')).toBe('1.23')
  })

  it('accepte un séparateur seul, en cours de frappe', () => {
    // Sans cela, taper « 0 » puis « , » puis « 5 » serait impossible : la virgule serait
    // effacée à l'instant même où elle est tapée, et « 0,5 » deviendrait « 05 ».
    expect(filtrerSaisieDecimale(',')).toBe(',')
    expect(filtrerSaisieDecimale('0,')).toBe('0,')
  })

  it('refuse le signe moins : un prix négatif n’existe pas', () => {
    expect(filtrerSaisieDecimale('-5')).toBe('5')
  })
})

// ─── Les trois champs, au niveau du composant ───────────────────────────────
// Une fonction pure testée ne prouve pas que les champs l'appellent.

describe('le prix d’une laine (YarnEditView, #yarn-price)', () => {
  it('refuse le symbole de devise à la frappe', async () => {
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/stash', name: 'stash', component: { template: '<div />' } },
        { path: '/stash/new', name: 'stash-new', component: YarnEditView },
      ],
    })
    router.push('/stash/new')
    await router.isReady()
    const pinia = createPinia()
    const w = mount(YarnEditView, {
      global: { plugins: [router, i18n, pinia], stubs: { YarnWeightHelp: true, ColorPickerDialog: true } },
    })
    const settings = useSettingsStore(pinia)
    let tours = 0
    while (!settings.loaded && tours < 20) {
      await flushPromises()
      tours++
    }
    await flushPromises()
    const champ = w.find('#yarn-price')
    await champ.setValue('18,90 €')
    await flushPromises()
    expect(champ.element.value).toBe('18,90')
    // Le geste RÉEL : le symbole tapé APRÈS un montant déjà propre. La valeur filtrée est alors
    // identique à la précédente, Vue ne repasse pas — sans réécriture explicite du champ, le
    // symbole resterait à l'écran alors que la donnée est propre.
    champ.element.value = '18,90 €'
    await champ.trigger('input')
    await flushPromises()
    expect(champ.element.value).toBe('18,90')
    w.unmount()
  })
})

describe('le prix unitaire d’un achat (YarnPurchases, #ypur-price)', () => {
  it('refuse le symbole de devise à la frappe', async () => {
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
    const pinia = createPinia()
    setActivePinia(pinia)
    await usePurchasesStore(pinia).load()
    const w = mount(YarnPurchases, {
      props: { yarnId: 1, yarnLabel: 'DROPS · Bleu ciel', yarn: { id: 1, quantity: 12 } },
      global: { plugins: [i18n, pinia] },
    })
    await flushPromises()
    await w.find('[data-test="purchases-correct"]').trigger('click')
    await w.find('[data-test="purchases-correct-add"]').trigger('click')
    await flushPromises()
    const champ = w.find('#ypur-price')
    await champ.setValue('18,90 €')
    await flushPromises()
    expect(champ.element.value).toBe('18,90')
    // Même geste réel que sur #yarn-price ci-dessus.
    champ.element.value = '18,90 €'
    await champ.trigger('input')
    await flushPromises()
    expect(champ.element.value).toBe('18,90')
    w.unmount()
  })
})

describe('le prix d’un patron (PatternPriceFields, #pat-price)', () => {
  it('refuse le symbole de devise, et ce qui remonte au parent est déjà propre', async () => {
    const w = mount(PatternPriceFields, {
      props: { modelValue: { price: '', purchasedAt: '' }, symbol: '€' },
      global: { plugins: [i18n, createPinia()] },
    })
    await w.find('#pat-price').setValue('18,90 €')
    await flushPromises()
    const emis = w.emitted('update:modelValue')
    expect(emis).toBeTruthy()
    // Ce que le parent enregistrera : la valeur filtrée, jamais la saisie brute.
    expect(emis.at(-1)[0].price).toBe('18,90')
  })
})

// ─── Le piège du caractère refusé qui ne change pas la valeur ───────────────
// C'est le geste RÉEL du défaut : on tape le montant, PUIS le symbole. La valeur filtrée est
// alors identique à la précédente — Vue ne repasse pas, et sans réécriture explicite du champ,
// le caractère refusé reste affiché à l'écran alors que la donnée, elle, est propre. Deux
// vérités contradictoires sous les yeux de l'utilisatrice.
describe('taper un caractère refusé APRÈS un montant déjà propre', () => {
  function saisir(champ, texte) {
    champ.element.value = texte
    return champ.trigger('input')
  }

  it('#pat-price ne laisse pas le symbole à l’écran', async () => {
    const w = mount(PatternPriceFields, {
      props: { modelValue: { price: '18,90', purchasedAt: '2026-08-21' }, symbol: '€' },
      global: { plugins: [i18n, createPinia()] },
    })
    const champ = w.find('#pat-price')
    await saisir(champ, '18,90 €')
    await flushPromises()
    expect(champ.element.value).toBe('18,90')
  })
})

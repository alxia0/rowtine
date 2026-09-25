// @vitest-environment jsdom
// tests/unit/pattern-price-fields.spec.js
// Saisie du prix d'un patron (07/08), partagée par la fiche patron et le formulaire projet.
// Le composant ne connaît NI la base NI les magasins : il présente et remonte, rien d'autre.
//
// Montage calqué sur tests/unit/yarn-purchases.spec.js : i18n RÉEL (pas de mock de `t`) — un
// mock qui renvoie la clé rendrait vraie toute assertion sur un texte, y compris fausse.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import fr from '@/i18n/fr.json'
import PatternPriceFields from '@/components/PatternPriceFields.vue'
import { createTestI18n } from './helpers/i18n-router'

const i18n = createTestI18n()
const monter = (props = {}) =>
  mount(PatternPriceFields, {
    props: { modelValue: { price: '', purchasedAt: '' }, ...props },
    global: { plugins: [i18n] },
  })

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.useRealTimers())

describe('PatternPriceFields', () => {
  it('1. affiche les deux champs et le bouton Gratuit', () => {
    const w = monter()
    expect(w.find('[data-test="pattern-price"]').exists()).toBe(true)
    expect(w.find('[data-test="pattern-purchased-at"]').exists()).toBe(true)
    expect(w.find('[data-test="pattern-price-free"]').exists()).toBe(true)
  })

  it('2. saisir un prix le remonte à l’appelant', async () => {
    const w = monter()
    await w.find('[data-test="pattern-price"]').setValue('8,50')
    const emis = w.emitted('update:modelValue')
    expect(emis.at(-1)[0].price).toBe('8,50')
  })

  it('3. « Gratuit » écrit 0 dans le champ — un bouton qui REMPLIT, pas un second état à tenir', async () => {
    const w = monter()
    await w.find('[data-test="pattern-price-free"]').trigger('click')
    expect(w.emitted('update:modelValue').at(-1)[0].price).toBe('0')
  })

  it('4. saisir un prix alors que la date est VIDE la pré-remplit à aujourd’hui', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-12T10:00:00'))
    const w = monter()
    await w.find('[data-test="pattern-price"]').setValue('8,50')
    expect(w.emitted('update:modelValue').at(-1)[0].purchasedAt).toBe('2026-03-12')
  })

  it('5. une date DÉJÀ saisie n’est jamais écrasée par la suite', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-12T10:00:00'))
    const w = monter({ modelValue: { price: '', purchasedAt: '2024-11-04' } })
    await w.find('[data-test="pattern-price"]').setValue('8,50')
    expect(w.emitted('update:modelValue').at(-1)[0].purchasedAt).toBe('2024-11-04')
  })

  it('6. EFFACER le prix ne touche pas à la date (on ne pré-remplit qu’en ARRIVANT sur une valeur)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-12T10:00:00'))
    const w = monter({ modelValue: { price: '8,50', purchasedAt: '' } })
    await w.find('[data-test="pattern-price"]').setValue('')
    expect(w.emitted('update:modelValue').at(-1)[0].purchasedAt).toBe('')
  })

  // Protège : un séparateur seul (« , ») ne quitte jamais le champ comme prix (il s'afficherait « Gratuit »).
  it('6b. un séparateur décimal seul est vidé en quittant le champ', async () => {
    const w = monter()
    const champ = w.find('[data-test="pattern-price"]')
    await champ.setValue(',')
    await champ.trigger('change')
    expect(w.emitted('update:modelValue').at(-1)[0].price).toBe('')
    expect(champ.element.value).toBe('')
  })

  it('7. hiddenReason « builtin » : aucun champ, une explication à la place', () => {
    const w = monter({ hiddenReason: 'builtin' })
    expect(w.find('[data-test="pattern-price"]').exists()).toBe(false)
    expect(w.text()).toContain(fr.pattern.priceFreePatternHint)
  })

  // Retiré avant la 1.0 (reprise du 13/08) : `hiddenReason: 'fork'` n'est plus
  // jamais produit par aucun appelant réel (PatternForm.vue et ProjectEditView.vue ne posent
  // plus que 'builtin' ou null) et la clé i18n `pattern.priceForkHint` a été retirée des 4
  // langues. Le ternaire du template (l. 61) garde techniquement sa branche « sinon », par
  // décision produit de ne toucher que le commentaire de ce composant — mais elle n'est plus
  // exercée par personne : ne pas la retester avec une valeur qui ne peut plus être posée.
  it('9. la mention « ce prix appartient au patron » n’apparaît QUE si on la demande', () => {
    expect(monter().text()).not.toContain(fr.pattern.priceSharedHint)
    expect(monter({ sharedHint: true }).text()).toContain(fr.pattern.priceSharedHint)
  })
})

// ─── Intégration dans le formulaire patron ──────────────────────────────────
import PatternForm from '@/components/PatternForm.vue'
import { useSettingsStore } from '@/stores/settings'

describe('PatternForm — le prix ressort dans la charge utile', () => {
  it('10. un prix saisi est émis avec la devise des réglages', async () => {
    setActivePinia(createPinia())
    // CHF et non EUR : EUR est DEFAULT_CURRENCY (src/constants/currencies.js). Avec EUR, le
    // test passerait même si la lecture du magasin ne servait à rien — CHF force à prouver
    // que la valeur vient bien de settings.currency, pas d'un défaut qui coïncide.
    useSettingsStore().currency = 'CHF'
    const w = mount(PatternForm, { global: { plugins: [i18n] } })
    await w.find('#pat-name').setValue('Sabai')
    await w.find('[data-test="pattern-price"]').setValue('8,50')
    await w.find('.btn--primary').trigger('click')
    const payload = w.emitted('submit').at(-1)[0]
    expect(payload.price).toBe('8,50')
    expect(payload.priceCurrency).toBe('CHF')
    expect(payload.purchasedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('12. le bouton Gratuit remplit VISIBLEMENT le champ dans le formulaire patron (pas seulement la charge utile)', async () => {
    // Ajouté en revue : les tests 10-11 ne lisent que `emitted('submit')`, un binding
    // v-model cassé aurait pu laisser le CHAMP DOM figé tout en émettant la bonne charge
    // utile au clic sur Enregistrer — c'est exactement ce qui s'est produit avant correctif
    // (Object.assign remplace v-model, cf. commentaire dans PatternForm.vue).
    setActivePinia(createPinia())
    const w = mount(PatternForm, { global: { plugins: [i18n] } })
    await w.find('[data-test="pattern-price-free"]').trigger('click')
    expect(w.find('[data-test="pattern-price"]').element.value).toBe('0')
    expect(w.find('[data-test="pattern-purchased-at"]').element.value).not.toBe('')
  })

  it('11. sans prix, AUCUNE devise n’est estampillée', async () => {
    setActivePinia(createPinia())
    useSettingsStore().currency = 'EUR'
    const w = mount(PatternForm, { global: { plugins: [i18n] } })
    await w.find('#pat-name').setValue('Sabai')
    await w.find('.btn--primary').trigger('click')
    const payload = w.emitted('submit').at(-1)[0]
    expect(payload.price).toBe('')
    expect(payload.priceCurrency).toBe('')
  })

  // ── Édition d'un patron EXISTANT (revue finale, 07-08/08) : les tests 10-12 ne montent
  // jamais de patron seedé — tous partent d'un formulaire vierge (`initial` absent). Le défaut
  // trouvé en revue (`form.priceCurrency` réécrit à CHAQUE `submit()`, même sans toucher au
  // prix) ne pouvait apparaître que sur une fiche déjà achetée qu'on rouvre pour modifier
  // AUTRE CHOSE. GBP et CHF : ni l'une ni l'autre n'est `DEFAULT_CURRENCY` (EUR) — une
  // assertion sur EUR passerait même si le code ne lisait jamais les réglages.
  it('13. modifier le NOM d’un patron déjà acheté préserve sa devise d’achat', async () => {
    setActivePinia(createPinia())
    useSettingsStore().currency = 'GBP'
    const w = mount(PatternForm, {
      props: { initial: { name: 'Sabai', price: '8,50', priceCurrency: 'CHF', purchasedAt: '2024-11-04' } },
      global: { plugins: [i18n] },
    })
    await w.find('#pat-name').setValue('Sabai (relu)')
    await w.find('.btn--primary').trigger('click')
    const payload = w.emitted('submit').at(-1)[0]
    // Ni prix ni devise dans la charge utile : inchangés, la fusion de `patternsStore.update`
    // garde ceux de la base (CHF), jamais la devise des réglages.
    expect(payload.name).toBe('Sabai (relu)')
    expect('price' in payload).toBe(false)
    expect('priceCurrency' in payload).toBe(false)
  })

  it('14. effacer le prix d’un patron déjà acheté vide aussi sa devise', async () => {
    setActivePinia(createPinia())
    useSettingsStore().currency = 'GBP'
    const w = mount(PatternForm, {
      props: { initial: { name: 'Sabai', price: '8,50', priceCurrency: 'CHF', purchasedAt: '2024-11-04' } },
      global: { plugins: [i18n] },
    })
    await w.find('[data-test="pattern-price"]').setValue('')
    await w.find('.btn--primary').trigger('click')
    const payload = w.emitted('submit').at(-1)[0]
    expect(payload.price).toBe('')
    expect(payload.priceCurrency).toBe('')
  })

  it('15. changer le MONTANT d’un patron déjà acheté ré-estampille la devise courante', async () => {
    setActivePinia(createPinia())
    useSettingsStore().currency = 'GBP'
    const w = mount(PatternForm, {
      props: { initial: { name: 'Sabai', price: '8,50', priceCurrency: 'CHF', purchasedAt: '2024-11-04' } },
      global: { plugins: [i18n] },
    })
    await w.find('[data-test="pattern-price"]').setValue('12,00')
    await w.find('.btn--primary').trigger('click')
    const payload = w.emitted('submit').at(-1)[0]
    expect(payload.price).toBe('12,00')
    expect(payload.priceCurrency).toBe('GBP')
  })
})

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

// Le séparateur de milliers français d'Intl est U+202F, pas une espace tapée.
const FR_GROUP = new Intl.NumberFormat('fr').format(1000).replace(/\d/g, '')

async function mountStash(yarns) {
  await db.yarns.clear()
  for (const y of yarns) await db.yarns.add(y)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'stash', component: StashView }],
  })
  router.push('/')
  await router.isReady()
  const pinia = createPinia()
  const w = mount(StashView, { global: { plugins: [router, i18n, pinia] } })
  // `settings.load()` (onMounted) enchaîne ~10 lectures Dexie séquentielles — mesuré
  // empiriquement à 4 tours de `flushPromises` avant que `settings.loaded` passe à `true`
  // (contre 1 pour yarnsStore.load(), une seule requête). On boucle jusqu'au signal réel
  // plutôt que de figer un nombre de tours : un compte exact est le genre de chose qui
  // casse sous charge sur une machine plus lente (contention déjà vécue sur ce dépôt).
  const settings = useSettingsStore(pinia)
  let rounds = 0
  while (!settings.loaded && rounds < 20) {
    await flushPromises()
    rounds++
  }
  return w
}

// Les tuiles du récap, dans l'ordre : pelotes, longueur, poids, [€ dépensés].
const tiles = (w) =>
  w.findAll('.recap__stat').map((el) => ({
    num: el.find('.recap__num').text(),
    lbl: el.find('.recap__lbl').text(),
  }))

describe('StashView — récap', () => {
  beforeEach(async () => {
    await db.open()
    // Un réglage posé par un test (unitSystem/currency) ne doit pas fuir dans le suivant.
    // Le vidage doit précéder le `db.settings.put` propre à chaque test : le faire dans
    // mountStash (appelé APRÈS ce put par les tests ci-dessous) effacerait le réglage
    // qu'on vient de poser avant même le montage.
    await db.settings.clear()
  })

  it('affiche m et g sous le seuil', async () => {
    const w = await mountStash([{ brand: 'A', colorName: 'Rouge', quantity: 2, lengthM: 100, grams: 50 }])
    const [, longueur, poids] = tiles(w)
    expect(longueur).toEqual({ num: '200', lbl: 'm' })
    expect(poids).toEqual({ num: '100', lbl: 'g' })
  })

  it('bascule en km et kg au-delà du seuil, avec 3 décimales', async () => {
    // 25 × 497 m = 12 425 m ; 25 × 98 g = 2 450 g
    const w = await mountStash([{ brand: 'A', colorName: 'Rouge', quantity: 25, lengthM: 497, grams: 98 }])
    const [, longueur, poids] = tiles(w)
    expect(longueur).toEqual({ num: '12,425', lbl: 'km' })
    expect(poids).toEqual({ num: '2,45', lbl: 'kg' })
  })

  it('sépare les milliers du montant dépensé', async () => {
    const w = await mountStash([{ brand: 'A', colorName: 'Rouge', quantity: 100, lengthM: 1, grams: 1, price: '12,5' }])
    const money = tiles(w).at(-1)
    expect(money.num).toBe(`1${FR_GROUP}250`)
  })

  it('affiche les totaux en yards et en livres en mode impérial', async () => {
    await db.settings.put({ key: 'unitSystem', value: 'imperial' })
    // 25 × 497 m = 12 425 m = 13 588 yd ; 25 × 98 g = 2 450 g = 5,401 lb
    const w = await mountStash([{ brand: 'A', colorName: 'Rouge', quantity: 25, lengthM: 497, grams: 98 }])
    const [, longueur, poids] = tiles(w)
    expect(longueur.lbl).toBe('yards')
    expect(poids.lbl).toBe('livres')
    expect(poids.num).toBe('5,401')
  })

  it('compte une fiche ancienne à virgule décimale dans les totaux (revue finale 26/07)', async () => {
    // Fiche stockée AVANT ce lot, saisie brute (clavier Android) : lengthM/grams en chaîne
    // à virgule. Avant correctif, Number('87,5') rendait NaN -> total resté à 0 pour cette
    // fiche, un chiffre FAUX (pas seulement masqué) sur le récap du stock.
    const w = await mountStash([{ brand: 'A', colorName: 'Rouge', quantity: 1, lengthM: '87,5', grams: '4,5' }])
    const [, longueur, poids] = tiles(w)
    expect(longueur).toEqual({ num: '88', lbl: 'm' })
    expect(poids).toEqual({ num: '5', lbl: 'g' })
  })

  it('libelle le montant avec le symbole de la devise choisie', async () => {
    await db.settings.put({ key: 'currency', value: 'USD' })
    const w = await mountStash([{ brand: 'A', colorName: 'Rouge', quantity: 2, lengthM: 100, grams: 50, price: '10' }])
    const money = tiles(w).at(-1)
    expect(money.lbl).toContain('$')
    expect(money.lbl).not.toContain('€')
    expect(money.num).toBe('20') // le nombre ne change pas : aucune conversion
  })
})

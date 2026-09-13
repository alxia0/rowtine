// tests/unit/stash-fermeture-apres-ecriture.spec.js
// Invariant issu du bug du 06/08 (écran Dépenses : 12,80 € au lieu de 30,50 €) :
// LE PANNEAU REFERMÉ SIGNIFIE « TOUT EST ÉCRIT ».
//
// Le formulaire de laine enchaîne DEUX écritures — la fiche, puis sa ligne d'achat. Tant
// qu'il se refermait dès la première, l'application annonçait « c'est enregistré » alors
// que la seconde était encore en vol : changer d'écran ou quitter l'application dans cette
// fenêtre coupait l'écriture, et le montant disparaissait du budget sans un mot (la laine,
// elle, était bien créée — d'où un défaut invisible à la relecture du stock).
//
// L'écriture de la ligne d'achat est RETENUE ici, puis relâchée sur ordre : sans ce
// forçage, les deux écritures s'enchaîneraient trop vite pour qu'aucune assertion ne puisse
// jamais échouer.
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { db } from '@/db/db'
import StashView from '@/views/StashView.vue'
import { useSettingsStore } from '@/stores/settings'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

// Modèle : tests/unit/stash-purchases-form.spec.js (base Dexie réelle + Pinia réel — le
// point testé traverse deux stores, des stores mockés ne prouveraient rien).
async function mountStash({ yarns = [] } = {}) {
  await db.yarns.clear()
  await db.settings.clear()
  await db.purchases.clear()
  for (const y of yarns) await db.yarns.add(y)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'stash', component: StashView }],
  })
  router.push('/')
  await router.isReady()
  const pinia = createPinia()
  const w = mount(StashView, { global: { plugins: [router, i18n, pinia] } })
  const settings = useSettingsStore(pinia)
  let rounds = 0
  while (!settings.loaded && rounds < 20) {
    await flushPromises()
    rounds++
  }
  await flushPromises()
  return { w }
}

// Retient l'écriture d'une ligne d'achat jusqu'à l'appel de `liberer()`. L'écriture réelle
// part ensuite normalement : on décale son achèvement, on ne la remplace pas.
function retenirEcritureAchat() {
  const addReel = db.purchases.add.bind(db.purchases)
  let ouvrir
  const barriere = new Promise((r) => {
    ouvrir = r
  })
  vi.spyOn(db.purchases, 'add').mockImplementation(async (data) => {
    await barriere
    return addReel(data)
  })
  return () => ouvrir()
}

const tours = async (n = 10) => {
  for (let i = 0; i < n; i++) await flushPromises()
}

describe('StashView — le panneau ne se referme qu’une fois la ligne d’achat écrite', () => {
  beforeEach(async () => {
    await db.open()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('création : le formulaire reste affiché tant que la ligne d’achat est en vol', async () => {
    const { w } = await mountStash()
    await w.findAll('button').find((b) => /Ajouter une laine/.test(b.text())).trigger('click')
    await flushPromises()
    await w.find('#yarn-color-name').setValue('Bleu')
    await w.find('#yarn-quantity').setValue('2')
    await w.find('#yarn-price').setValue('6,40')

    const liberer = retenirEcritureAchat()
    await w.find('.addform__actions .btn--primary').trigger('click')
    await tours()

    expect(await db.yarns.count()).toBe(1) // la fiche, elle, est déjà écrite…
    expect(await db.purchases.count()).toBe(0) // …son achat est retenu, donc pas encore en base
    // …et c'est précisément là que le panneau ne doit PAS avoir disparu : refermé, il
    // annoncerait un enregistrement terminé alors qu'il reste une écriture en vol.
    expect(w.find('.addform').exists()).toBe(true)

    liberer()
    await tours()

    expect(await db.purchases.count()).toBe(1)
    expect(w.find('.addform').exists()).toBe(false) // maintenant, et seulement maintenant
  })

  it('édition : même garantie quand une hausse de quantité est enregistrée en achat', async () => {
    const { w } = await mountStash({
      yarns: [{ id: 4, brand: 'Katia', colorName: 'Rouge', quantity: 2, price: '17,70', composition: [], reservations: {}, consumed: {} }],
    })
    const card = w.findAll('.ycard').find((c) => c.text().includes('Katia'))
    await card.find('.ycard__kebab').trigger('click')
    await flushPromises()
    await card.findAll('button').find((b) => b.text().includes('Modifier')).trigger('click')
    await flushPromises()
    await w.find('#yarn-quantity').setValue('5')
    await w.find('.addform__actions .btn--primary').trigger('click')
    await tours()
    expect(w.find('[data-test="qty-increase-prompt"]').exists()).toBe(true) // hausse ⇒ proposition

    const liberer = retenirEcritureAchat()
    await w.find('[data-test="qty-increase-buy"]').trigger('click')
    await tours()

    expect(await db.purchases.count()).toBe(0) // écriture retenue
    expect(w.find('.addform').exists()).toBe(true) // le panneau tient bon

    liberer()
    await tours()

    expect(await db.purchases.count()).toBe(1)
    expect(w.find('.addform').exists()).toBe(false)
  })
})

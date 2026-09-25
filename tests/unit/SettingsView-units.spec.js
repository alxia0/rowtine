// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { db, getSetting } from '@/db/db'
import SettingsView from '@/views/SettingsView.vue'
import { useSettingsStore } from '@/stores/settings'
import { createTestI18n, createTestRouter } from './helpers/i18n-router'

const i18n = createTestI18n()

async function mountSettings(yarns = []) {
  await db.settings.clear()
  await db.yarns.clear()
  for (const y of yarns) await db.yarns.add(y)
  const router = createTestRouter([{ path: '/', name: 'settings', component: SettingsView }])
  router.push('/')
  await router.isReady()
  const pinia = createPinia()
  const w = mount(SettingsView, { global: { plugins: [router, i18n, pinia] } })
  await flushPromises()
  await flushPromises()
  // Exposé pour les tests qui doivent vérifier l'état réel du store (pas seulement le DOM) —
  // n'affecte aucun des tests ci-dessus, qui ne lisent que `w`.
  w.pinia = pinia
  return w
}

const YARN_WITH_PRICE = { brand: 'A', colorName: 'Rouge', quantity: 1, lengthM: 100, grams: 50, price: '12,50' }
const YARN_NO_PRICE = { brand: 'B', colorName: 'Bleu', quantity: 1, lengthM: 100, grams: 50, price: '' }

describe('SettingsView — unités et devise', () => {
  beforeEach(async () => {
    await db.open()
  })

  it('propose les deux systèmes d’unités, métrique actif par défaut', async () => {
    const w = await mountSettings()
    const metric = w.find('[data-test="units-metric"]')
    const imperial = w.find('[data-test="units-imperial"]')
    expect(metric.exists()).toBe(true)
    expect(imperial.exists()).toBe(true)
    expect(metric.classes()).toContain('toggle__opt--on')
    expect(imperial.classes()).not.toContain('toggle__opt--on')
  })

  it('bascule en impérial sans aucun avertissement', async () => {
    // Aucune donnée n'est modifiée : demander confirmation serait inquiéter pour rien.
    const w = await mountSettings([YARN_WITH_PRICE])
    await w.find('[data-test="units-imperial"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="units-imperial"]').classes()).toContain('toggle__opt--on')
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('affiche les 5 devises avec leur symbole', async () => {
    const w = await mountSettings()
    const options = w.find('[data-test="currency-select"]').findAll('option')
    expect(options.length).toBe(5)
    expect(options.map((o) => o.text()).join(' ')).toContain('€')
    expect(options.map((o) => o.text()).join(' ')).toContain('$')
  })

  it('change de devise sans rien demander quand aucun prix n’est saisi', async () => {
    const w = await mountSettings([YARN_NO_PRICE])
    const settings = useSettingsStore(w.pinia)
    await w.find('[data-test="currency-select"]').setValue('USD')
    // `yarnsStore.load()` n'est déclenché qu'ici (aucun préchargement au montage) et sa
    // migration pool écrit réellement en base (fake-indexeddb planifie via un vrai
    // `setTimeout(0)`, cf. tests/unit/settings-view.spec.js) : on attend le signal terminal
    // (la devise appliquée) plutôt qu'un nombre fixe de flushPromises, sinon l'absence de
    // dialogue serait vraie pour la mauvaise raison (chaîne pas encore résolue).
    await vi.waitFor(() => expect(settings.currency).toBe('USD'), { timeout: 10000 })
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('prévient avant de changer de devise quand des prix existent', async () => {
    const w = await mountSettings([YARN_WITH_PRICE])
    await w.find('[data-test="currency-select"]').setValue('USD')
    await vi.waitFor(() => expect(w.find('[role="dialog"]').exists()).toBe(true), { timeout: 10000 })
    const dialog = w.find('[role="dialog"]')
    // Le message doit dire clairement que rien n'est converti.
    expect(dialog.text()).toContain('ne seront pas convertis')
  })

  it('annuler remet le sélecteur sur l’ancienne devise', async () => {
    // Sans ça, l'écran afficherait « USD » alors que le réglage est resté « EUR ».
    const w = await mountSettings([YARN_WITH_PRICE])
    const select = w.find('[data-test="currency-select"]')
    await select.setValue('USD')
    await vi.waitFor(() => expect(w.find('[role="dialog"]').exists()).toBe(true), { timeout: 10000 })
    await w.find('[data-test="confirm-cancel"]').trigger('click')
    await flushPromises()
    expect(select.element.value).toBe('EUR')
    // Le sélecteur revient déjà à « EUR » dès l'OUVERTURE du dialogue (Vue resynchronise le
    // <select> lié par `:value` à chaque rendu — cf. rapport de tâche) : cette seule assertion
    // ne prouve donc RIEN sur ce que fait vraiment le clic « Annuler ». Ce qui distingue un
    // clic réel d'un bouton mort, c'est la fermeture du dialogue.
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('confirmer applique et persiste la nouvelle devise, et referme le dialogue', async () => {
    // Aucun des tests ci-dessus ne clique sur le bouton de confirmation : sans celui-ci,
    // le chemin « accepter l'avertissement » ne serait jamais exercé.
    const w = await mountSettings([YARN_WITH_PRICE])
    await w.find('[data-test="currency-select"]').setValue('USD')
    await vi.waitFor(() => expect(w.find('[role="dialog"]').exists()).toBe(true), { timeout: 10000 })
    await w.find('[data-test="confirm-ok"]').trigger('click')
    await flushPromises()
    const settings = useSettingsStore(w.pinia)
    expect(settings.currency).toBe('USD')
    // Persisté, pas seulement en mémoire : `saveUnits` met à jour `currency.value` avant
    // d'écrire en base, une assertion sur le seul store passerait même si l'écriture Dexie
    // était cassée.
    expect(await getSetting('currency')).toBe('USD')
    // Sans la remise à `null` de `pendingCurrency` dans `confirmCurrency`, le dialogue
    // resterait ouvert indéfiniment après un clic sur confirmer (seul Échap en sortirait,
    // et il route vers « annuler ») — même défaut que celui déjà corrigé côté « annuler ».
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })
})

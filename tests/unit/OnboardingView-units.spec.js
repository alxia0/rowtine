// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { db } from '@/db/db'
import OnboardingView from '@/views/OnboardingView.vue'
import { createTestI18n, createTestRouter } from './helpers/i18n-router'

const i18n = createTestI18n()

// `prefill` : réglages à écrire en base AVANT le montage, pour simuler un retour sur l'écran
// après un premier passage (ex. app tuée en cours d'onboarding, juste après avoir touché le
// toggle). Doit être appliqué APRÈS le `db.settings.clear()` ci-dessous, sinon il est effacé.
async function mountOnboarding(navLang = 'fr-FR', prefill = null) {
  await db.settings.clear()
  if (prefill) {
    for (const [key, value] of Object.entries(prefill)) {
      await db.settings.put({ key, value })
    }
  }
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(navLang)
  const router = createTestRouter([
    { path: '/', name: 'onboarding', component: OnboardingView },
    { path: '/home', name: 'home', component: { template: '<div/>' } },
  ])
  router.push('/')
  await router.isReady()
  const w = mount(OnboardingView, { global: { plugins: [router, i18n, createPinia()] } })
  await flushPromises()
  return w
}

describe('OnboardingView — unités et devise', () => {
  beforeEach(async () => {
    await db.open()
    vi.restoreAllMocks()
  })

  it('propose les deux choix dès l’écran de bienvenue', async () => {
    const w = await mountOnboarding()
    expect(w.find('[data-test="onb-units-metric"]').exists()).toBe(true)
    expect(w.find('[data-test="onb-units-imperial"]').exists()).toBe(true)
    expect(w.find('[data-test="onb-currency"]').exists()).toBe(true)
  })

  it('pré-sélectionne l’impérial et le dollar sur un appareil américain', async () => {
    const w = await mountOnboarding('en-US')
    expect(w.find('[data-test="onb-units-imperial"]').classes()).toContain('toggle__opt--on')
    expect(w.find('[data-test="onb-currency"]').element.value).toBe('USD')
  })

  it('pré-sélectionne le métrique et la livre sterling sur un appareil britannique', async () => {
    // fr-FR retombe sur métrique/EUR — exactement les défauts du store : un test bâti dessus
    // passerait aussi bien avec l'ancien code bugué (`settings.X || guessed.X`) qu'avec des
    // valeurs codées en dur. en-GB fait diverger la devise (GBP ≠ EUR, le défaut du store) tout
    // en couvrant la règle « anglophone ne veut pas dire impérial » (metric malgré l'anglais).
    const w = await mountOnboarding('en-GB')
    expect(w.find('[data-test="onb-units-metric"]').classes()).toContain('toggle__opt--on')
    expect(w.find('[data-test="onb-currency"]').element.value).toBe('GBP')
  })

  it('la pré-sélection reste modifiable, et le choix est persisté', async () => {
    const w = await mountOnboarding('en-US')
    await w.find('[data-test="onb-units-metric"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="onb-units-metric"]').classes()).toContain('toggle__opt--on')
    expect(await db.settings.get('unitSystem')).toMatchObject({ value: 'metric' })
  })

  it('un réglage déjà persisté l’emporte sur la déduction (retour sur l’écran)', async () => {
    // Appareil américain (guess = impérial/USD), mais un choix métrique/EUR a déjà été
    // persisté lors d'un passage précédent (ex. app tuée juste après avoir touché le toggle) :
    // au remontage, le réglage persisté doit l'emporter sur la déduction, pas l'inverse.
    const w = await mountOnboarding('en-US', { unitSystem: 'metric', currency: 'EUR' })
    expect(w.find('[data-test="onb-units-metric"]').classes()).toContain('toggle__opt--on')
    expect(w.find('[data-test="onb-currency"]').element.value).toBe('EUR')
  })

  it('persiste la pré-sélection même sans y toucher', async () => {
    // Une Américaine qui valide sans rien changer doit se retrouver en impérial.
    const w = await mountOnboarding('en-US')
    await w.findAll('button').find((b) => /Commence à/.test(b.text())).trigger('click')
    await flushPromises()
    expect(await db.settings.get('unitSystem')).toMatchObject({ value: 'imperial' })
    expect(await db.settings.get('currency')).toMatchObject({ value: 'USD' })
  })
})

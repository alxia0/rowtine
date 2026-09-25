// @vitest-environment jsdom
// Revue finale (31/07) — régression BLOQUANTE introduite par mon propre correctif du point 2
// de cette même revue (commit 343be28) : settings.js supposait qu'une utilisatrice onboardée
// avait TOUJOURS une `locale` persistée en base, ce qui n'était vrai que si elle avait TOUCHÉ
// le sélecteur de langue (`setLang()` persiste en direct sur `@change`) — la pré-sélection
// acceptée SANS y toucher (le cas normal, puisque c'est tout l'objet de la pré-sélection,
// tâche A2) ne produisait aucune clé `locale`. Résultat : toute NOUVELLE installation non
// francophone qui validait directement l'accueil repassait en français au 2e démarrage.
//
// Corrigé dans OnboardingView.vue::start(), à l'identique de ce que fait déjà
// `settings.saveUnits({ unitSystem, currency })` juste au-dessus (même commentaire, même
// raison : « la pré-sélection doit être enregistrée même si l'utilisatrice n'a rien changé »)
// — cf. aussi tests/unit/OnboardingView-units.spec.js, « persiste la pré-sélection même sans
// y toucher », dont ce fichier reprend le motif de montage.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/db'
import { useSettingsStore } from '@/stores/settings'
import OnboardingView from '@/views/OnboardingView.vue'
import { createTestI18n, createTestRouter } from './helpers/i18n-router'

const i18n = createTestI18n()

async function mountOnboarding(navLang) {
  await db.settings.clear()
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue([navLang])
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

// `start()` enchaîne plusieurs écritures Dexie (saveUnits, saveProfile, completeOnboarding,
// seedExamples avec un `import()` dynamique) : un nombre FIXE de flushPromises() après le clic
// s'est révélé instable (mesuré : suffisant en isolation, insuffisant une fois ce fichier lancé
// avec d'autres tests — le 1er `import()` dynamique du fichier semble consommer un tick de plus
// que les suivants). On attend donc la conséquence observable elle-même (`locale` en base)
// plutôt qu'un nombre de flush arbitraire.
async function clickStart(w) {
  await w.findAll('button').find((b) => /Commence à/.test(b.text())).trigger('click')
  await vi.waitFor(async () => {
    if (!(await db.settings.get('onboarded'))) throw new Error('onboarding pas encore terminé')
  })
}

describe('OnboardingView — la langue pré-sélectionnée est persistée même sans y toucher', () => {
  beforeEach(async () => {
    await db.open()
    vi.restoreAllMocks()
  })

  it('une Allemande qui valide directement l’accueil reste en allemand au démarrage suivant (pas de bascule en français)', async () => {
    const w = await mountOnboarding('de-DE')
    expect(w.find('[data-test="onb-language"]').element.value).toBe('de') // pré-sélection, non touchée
    await clickStart(w)
    expect(await db.settings.get('locale')).toMatchObject({ value: 'de' })

    // Enchaîne explicitement sur un rechargement du store (2e démarrage simulé) : c'est ce
    // rechargement, pas seulement la ligne en base, qui prouve que l'interface resterait
    // bien allemande — exactement le scénario mesuré en revue.
    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    await reloaded.load()
    expect(reloaded.locale).toBe('de')
  })

  it('un changement explicite de langue à l’accueil reste prioritaire (persisté par setLang ET par start, sans conflit)', async () => {
    const w = await mountOnboarding('de-DE') // appareil allemand…
    await w.find('[data-test="onb-language"]').setValue('es') // … mais choix explicite espagnol
    await clickStart(w)
    expect(await db.settings.get('locale')).toMatchObject({ value: 'es' })

    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    await reloaded.load()
    expect(reloaded.locale).toBe('es')
  })
})

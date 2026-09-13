// Unitaire — correctif des bloquants avant diffusion (01/08) : sur une base
// RESTAURÉE depuis une sauvegarde, l'écran d'accueil de première ouverture peut rester monté
// (le routeur ne se ré-évalue que sur un CHANGEMENT de navigation, pas sur le passage réactif
// de `settings.onboarded` de faux à vrai pendant qu'on est déjà sur cet écran — cf. la
// restauration proposée par App.vue, `maybeOfferRestore`). Toucher « Commencer » dans ce
// contexte appelait `start()` sans aucune condition, qui écrivait six réglages ET ressemait
// trois patrons de démonstration par-dessus une bibliothèque déjà restaurée.
//
// Ce test simule directement cette situation : on monte OnboardingView avec un store dont
// `onboarded` vaut déjà `true` (comme après une restauration en cours de session), puis on
// déclenche « Commencer ». Les espions sont neutralisés (`mockResolvedValue`), pas seulement
// observés : sans ça, ce test rouge écrirait réellement dans Dexie et tirerait le contenu de
// démo via un `import()` dynamique — comportement explicitement proscrit ici.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { useSettingsStore } from '@/stores/settings'
import { usePatternsStore } from '@/stores/patterns'
import OnboardingView from '@/views/OnboardingView.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

// Un seul pinia créé ET activé ICI, puis passé tel quel au montage — sinon le composant
// résoudrait un store DIFFÉRENT de celui sur lequel on a posé `onboarded` et espionné les
// méthodes, et le test resterait vert (ou rouge) pour une mauvaise raison.
async function mountAlreadyOnboarded() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const settings = useSettingsStore()
  settings.onboarded = true
  const saveUnits = vi.spyOn(settings, 'saveUnits').mockResolvedValue()
  const saveProfile = vi.spyOn(settings, 'saveProfile').mockResolvedValue()
  const completeOnboarding = vi.spyOn(settings, 'completeOnboarding').mockResolvedValue()
  // Proxy du semis de démo (cf. commentaire de tête) : `seedExamples()` n'est pas exportée
  // par le composant, mais elle est la SEULE autorité à appeler `seedSamplesIfEmpty` sur ce
  // chemin — un espion dessus prouve donc que le semis n'a pas été déclenché.
  const patternsStore = usePatternsStore()
  const seedSamplesIfEmpty = vi.spyOn(patternsStore, 'seedSamplesIfEmpty').mockResolvedValue({})

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'onboarding', component: OnboardingView },
      { path: '/home', name: 'home', component: { template: '<div/>' } },
    ],
  })
  router.push('/')
  await router.isReady()
  const w = mount(OnboardingView, { global: { plugins: [router, i18n, pinia] } })
  await flushPromises()
  return { w, router, saveUnits, saveProfile, completeOnboarding, seedSamplesIfEmpty }
}

describe('OnboardingView — base déjà onboardée (restauration en cours de session) : « Commencer » ne doit rien écraser', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("redirige vers l'accueil SANS réécrire les réglages ni ressemer les patrons de démonstration", async () => {
    const { w, router, saveUnits, saveProfile, completeOnboarding, seedSamplesIfEmpty } = await mountAlreadyOnboarded()

    await w.findAll('button').find((b) => /Commence à/.test(b.text())).trigger('click')
    // `start()` enchaîne plusieurs `await` (dont un `import()` dynamique dans
    // `seedExamples()`, cf. onboarding-locale-persist.spec.js pour la même mesure) : un
    // nombre fixe de `flushPromises()` s'est révélé instable. On attend donc la
    // conséquence observable elle-même.
    await vi.waitFor(() => {
      if (router.currentRoute.value.name !== 'home') throw new Error('pas encore navigué')
    })

    // 1. la navigation part vers l'accueil
    expect(router.currentRoute.value.name).toBe('home')
    // 2. aucune écriture de réglage n'a eu lieu
    expect(saveUnits).not.toHaveBeenCalled()
    expect(saveProfile).not.toHaveBeenCalled()
    expect(completeOnboarding).not.toHaveBeenCalled()
    // 3. seedExamples() n'a pas été déclenchée (aucun patron de démonstration semé)
    expect(seedSamplesIfEmpty).not.toHaveBeenCalled()
  })
})

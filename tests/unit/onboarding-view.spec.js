// @vitest-environment jsdom
// Unitaire — OnboardingView : l'astuce « balaie pour revenir » a été RETIRÉE de cet écran
// (P3). Elle s'affichait ici alors que l'onboarding est un écran unique sans étape à
// laquelle « revenir » — l'astuce était donc fausse à cet endroit. Elle vit désormais en
// pop-up sur l'accueil (cf. home-view.spec.js). La clé i18n `onboarding.swipeHint` reste,
// elle, RÉUTILISÉE par cette pop-up — seul son affichage ICI doit disparaître.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import i18n from '@/i18n'

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRouter: () => nav.router }))

import OnboardingView from '@/views/OnboardingView.vue'

describe('OnboardingView — astuce retirée (P3)', () => {
  it("n'affiche plus l'astuce « balaie pour revenir »", () => {
    setActivePinia(createPinia())
    const w = mount(OnboardingView, { global: { plugins: [i18n] } })
    expect(w.find('.onb__swipe').exists()).toBe(false)
    // Insensible à la casse : le texte réécrit le 10/08/2026 commence désormais
    // la phrase (« Balaie l'écran... », B majuscule) alors que l'ancien la faisait suivre
    // « Astuce : » (b minuscule). Un ancrage sensible à la casse sur l'ancien fragment ne
    // pouvait plus jamais mordre après la réécriture — corrigé ici (revue du 10/08/2026).
    expect(w.text().toLowerCase()).not.toContain("écran vers la droite")
  })

  it("la clé i18n onboarding.swipeHint est CONSERVÉE (réutilisée par FirstDetailTip)", () => {
    // Ancré sur la CLÉ, pas sur le texte : le texte a été réécrit par le lot du 10/08/2026
    // (l'astuce quitte l'accueil pour FirstDetailTip.vue, montrée à la première fiche
    // ouverte, et gagne une seconde phrase sur les bandes d'onglets/catégories). Un ancrage
    // sur le texte littéral se romprait à chaque retouche de rédaction sans rien prouver de
    // plus que ceci : la clé existe toujours et porte une vraie phrase, pas une chaîne vide
    // ou une suppression. Le texte exact est couvert ailleurs (tests/unit/first-detail-tip.spec.js).
    const fr = JSON.parse(readFileSync(resolve(process.cwd(), 'src/i18n/fr.json'), 'utf8'))
    const en = JSON.parse(readFileSync(resolve(process.cwd(), 'src/i18n/en.json'), 'utf8'))
    expect(typeof fr.onboarding.swipeHint).toBe('string')
    expect(fr.onboarding.swipeHint.length).toBeGreaterThan(0)
    expect(typeof en.onboarding.swipeHint).toBe('string')
    expect(en.onboarding.swipeHint.length).toBeGreaterThan(0)
  })
})

// Preuve par le COMPORTEMENT de la pré-sélection de langue (tâche A2, 30/07 — revue) :
// la garde statique de tests/unit/app-locale-wiring.spec.js prouve l'ABSENCE d'un littéral
// 'fr', mais ne peut pas détecter un câblage cassé d'une autre façon (ex. un appel à
// `detectDeviceLocale` sans les parenthèses, ou un remplacement par `FALLBACK_LOCALE` en
// dur) : seul un test qui regarde la VALEUR obtenue à l'écran le peut.
describe('OnboardingView — pré-sélection de la langue (tâche A2, 30/07)', () => {
  afterEach(() => {
    i18n.global.locale.value = 'fr' // état témoin, indépendant de l'ordre des tests
    vi.restoreAllMocks()
  })

  it("sans rien de persisté, le sélecteur de langue pré-affiche la langue de l'appareil", async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE'])
    setActivePinia(createPinia())
    const w = mount(OnboardingView, { global: { plugins: [i18n] } })
    await flushPromises()
    expect(w.find('[data-test="onb-language"]').element.value).toBe('de')
  })

  // Mesure demandée en revue (point 3) : la ligne défensive de `onMounted` a-t-elle un
  // effet observable ? Réponse mesurée ici — OUI, mais seulement hors du flux normal du
  // router (cf. commentaire mis à jour dans OnboardingView.vue). Ce test le prouve en
  // reproduisant délibérément la seule situation où `locale.value` (le singleton i18n,
  // figé à l'import de ce fichier de test — 'fr') diverge de `lang.value` (calculé au
  // montage à partir de l'appareil) : un montage ISOLÉ du composant, sans passer par le
  // garde de `router/index.js` qui, dans l'app réelle, synchronise les deux AVANT le
  // montage.
  it("aligne la locale i18n sur la langue pré-sélectionnée quand elle en diverge (montage isolé, hors garde du router)", async () => {
    i18n.global.locale.value = 'fr' // divergence délibérée avec la langue « appareil » ci-dessous
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['de-DE'])
    setActivePinia(createPinia())
    const w = mount(OnboardingView, { global: { plugins: [i18n] } })
    await flushPromises()
    expect(w.find('[data-test="onb-language"]').element.value).toBe('de') // lang.value
    expect(i18n.global.locale.value).toBe('de') // locale.value alignée par la ligne défensive
  })
})

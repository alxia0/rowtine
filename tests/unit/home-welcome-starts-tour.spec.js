// @vitest-environment jsdom
// Accueil — la bienvenue lance (ou pas) la visite guidée (lot « visite guidée »,
// 23/09/2026). Complète tests/unit/home-welcome-popup.spec.js (contenu, ordre des
// pop-ups, acquittement des drapeaux — INCHANGÉ, pas repris ici) avec la nouveauté de ce
// lot : confirmer la bienvenue du SEMIS enchaîne sur la visite guidée du lecteur ;
// confirmer celle de la RESTAURATION n'en lance aucune.
//
// `ensureTourProject` (src/utils/tour-sample.js) est MOQUÉ : ce fichier vérifie le
// déclenchement (dans quel cas `startTour` part, et seulement après l'effacement des
// drapeaux), pas la logique de recherche/recréation du projet — déjà couverte par
// tests/unit/tour-sample.spec.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db, getSetting, setSetting } from '@/db/db'
import i18n from '@/i18n'
import fr from '@/i18n/fr.json'

const nav = vi.hoisted(() => ({
  route: { name: 'home', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

const tourSample = vi.hoisted(() => ({ ensureTourProject: vi.fn() }))
vi.mock('@/utils/tour-sample', () => tourSample)

import HomeView from '@/views/HomeView.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const wrappers = []
let pinia
function doMount() {
  const w = mount(HomeView, { global: { plugins: [pinia, i18n] }, attachTo: document.body })
  wrappers.push(w)
  return w
}
async function settle() {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r))
  }
  await flushPromises()
}

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  tourSample.ensureTourProject.mockReset()
  nav.router.push.mockReset()
})
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('bienvenue du semis — confirmer enchaîne sur la visite', () => {
  // CORRECTIF (revue, lot du 23/09/2026) : l'ancienne version de ce test asserait seulement
  // `welcomeDue` APRÈS la séquence complète — elle aurait donc été verte même si
  // `startTour()` était appelée AVANT `dismissWelcome()` (ordre inverse du brief), et ne
  // prouvait rien sur `restoredDue`. La preuve d'ORDRE demandée par le brief (« startTour
  // appelé après effacement des drapeaux ») exige de regarder l'état EN BASE au moment
  // même où `ensureTourProject` est invoquée — pas après coup, une fois la séquence
  // retombée : ce mock capture donc les DEUX drapeaux depuis l'intérieur de l'appel.
  it('efface les DEUX drapeaux EN BASE avant d\'appeler ensureTourProject, puis navigue', async () => {
    let flagsAuMomentDeLAppel = null
    tourSample.ensureTourProject.mockImplementation(async () => {
      flagsAuMomentDeLAppel = {
        welcomeDue: await getSetting('welcomeDue'),
        restoredDue: await getSetting('restoredDue'),
      }
      return { id: 42, created: false }
    })
    await setSetting('onboarded', true)
    await setSetting('welcomeDue', true)
    const w = doMount()
    await settle()

    await w.findComponent(ConfirmDialog).vm.$emit('confirm')
    await settle()

    expect(tourSample.ensureTourProject).toHaveBeenCalledTimes(1)
    // La preuve qui compte : au moment de l'appel, LES DEUX drapeaux étaient DÉJÀ à
    // `false` en base — pas seulement `welcomeDue` (celui qui a armé l'affichage),
    // `restoredDue` aussi (cf. `dismissWelcome()`, qui efface toujours les deux).
    expect(flagsAuMomentDeLAppel).toEqual({ welcomeDue: false, restoredDue: false })
    expect(nav.router.push).toHaveBeenCalledWith({
      name: 'project-read',
      params: { id: 42 },
      query: { tour: '1' },
    })
  })

  it('propose un bouton « Plus tard » qui ferme SANS lancer la visite', async () => {
    await setSetting('onboarded', true)
    await setSetting('welcomeDue', true)
    const w = doMount()
    await settle()
    const dlg = w.findComponent(ConfirmDialog)
    expect(dlg.props('cancelLabel')).toBe(fr.onboarding.welcomeLater)

    await dlg.vm.$emit('cancel')
    await settle()

    expect(await getSetting('welcomeDue')).toBe(false)
    expect(tourSample.ensureTourProject).not.toHaveBeenCalled()
    expect(nav.router.push).not.toHaveBeenCalled()
  })
})

describe('bienvenue de la restauration — confirmer ne lance JAMAIS de visite', () => {
  it("efface les drapeaux mais n'appelle pas ensureTourProject", async () => {
    await setSetting('onboarded', true)
    await setSetting('restoredDue', true)
    const w = doMount()
    await settle()

    await w.findComponent(ConfirmDialog).vm.$emit('confirm')
    await settle()

    expect(await getSetting('restoredDue')).toBe(false)
    expect(tourSample.ensureTourProject).not.toHaveBeenCalled()
    expect(nav.router.push).not.toHaveBeenCalled()
  })

  it("n'affiche pas de bouton « Plus tard » (comportement inchangé, un seul bouton)", async () => {
    await setSetting('onboarded', true)
    await setSetting('restoredDue', true)
    const w = doMount()
    await settle()
    expect(w.findComponent(ConfirmDialog).props('cancelLabel')).toBeFalsy()
  })
})

// @vitest-environment jsdom
// Réglages — bloc « Aide » (lot « visite guidée », 23/09/2026) : un bouton SECONDAIRE pour
// relancer à la demande la visite guidée du lecteur, quel que soit l'état de la bienvenue
// (celle-ci n'est plus à l'écran depuis longtemps pour
// quelqu'un qui va chercher ce bouton dans les Réglages).
//
// `ensureTourProject` (src/utils/tour-sample.js) est MOQUÉ ici : ce fichier vérifie le
// CÂBLAGE (le bouton appelle bien `startTour`, qui navigue avec les bons paramètres et
// prévient au bon moment), pas la logique de recherche/recréation du projet d'exemple —
// déjà couverte par tests/unit/tour-sample.spec.js.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import fr from '@/i18n/fr.json'
import { useSnackbarStore } from '@/stores/snackbar'
import { useSettingsStore } from '@/stores/settings'

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: {}, query: {} }), useRouter: () => nav.router }))

const tourSample = vi.hoisted(() => ({ ensureTourProject: vi.fn() }))
vi.mock('@/utils/tour-sample', () => tourSample)

import SettingsView from '@/views/SettingsView.vue'

function mountView() {
  return mount(SettingsView, {
    global: { plugins: [createPinia(), i18n], stubs: { SafFolderSection: true } },
  })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  tourSample.ensureTourProject.mockReset()
  nav.router.push.mockReset()
})

describe('Réglages — bloc Aide, relance de la visite guidée', () => {
  it('affiche un bouton SECONDAIRE (jamais btn--primary), avec sa ligne d\'aide', async () => {
    const w = mountView()
    await flushPromises()
    const btn = w.find('[data-test="replay-tour"]')
    expect(btn.exists()).toBe(true)
    expect(btn.classes()).toContain('btn')
    expect(btn.classes()).not.toContain('btn--primary')
    expect(w.text()).toContain(fr.settings.help.replayTourHint)
  })

  it('retrouve le projet et navigue vers le lecteur avec tour=1', async () => {
    tourSample.ensureTourProject.mockResolvedValue({ id: 7, created: false })
    const w = mountView()
    await flushPromises()
    const settings = useSettingsStore()
    await settings.load()

    await w.find('[data-test="replay-tour"]').trigger('click')
    await flushPromises()

    expect(tourSample.ensureTourProject).toHaveBeenCalledWith({
      locale: settings.locale,
      technique: settings.defaultTechnique,
    })
    expect(nav.router.push).toHaveBeenCalledWith({
      name: 'project-read',
      params: { id: 7 },
      query: { tour: '1' },
    })
  })

  it('projet recréé : prévient par un snackbar avant de naviguer', async () => {
    tourSample.ensureTourProject.mockResolvedValue({ id: 9, created: true })
    const w = mountView()
    await flushPromises()
    const snackbar = useSnackbarStore()

    await w.find('[data-test="replay-tour"]').trigger('click')
    await flushPromises()

    expect(snackbar.visible).toBe(true)
    expect(snackbar.message).toBe(fr.tour.recreated)
    expect(nav.router.push).toHaveBeenCalled()
  })

  it("projet introuvable même après recréation : snackbar d'erreur, aucune navigation", async () => {
    tourSample.ensureTourProject.mockResolvedValue(null)
    const w = mountView()
    await flushPromises()
    const snackbar = useSnackbarStore()

    await w.find('[data-test="replay-tour"]').trigger('click')
    await flushPromises()

    expect(snackbar.visible).toBe(true)
    expect(snackbar.message).toBe(fr.tour.unavailable)
    expect(nav.router.push).not.toHaveBeenCalled()
  })

  // CORRECTIF (revue, lot du 23/09/2026) : `ensureTourProject` n'a pas son propre filet
  // (src/utils/tour-sample.js n'entoure ses appels Dexie d'aucun try/catch) — un rejet
  // (quota, base fermée…) partait donc en silence avant ce correctif, sans snackbar ni
  // navigation, comme si le bouton n'avait rien fait. `useStartTour` doit le traiter
  // EXACTEMENT comme le `null` ci-dessus : même message, aucune navigation, et une trace
  // en console pour ne pas perdre l'erreur.
  it('ensureTourProject rejette : même repli que « projet introuvable » (snackbar, aucune navigation), erreur tracée', async () => {
    const erreur = new Error('Dexie: quota dépassé')
    tourSample.ensureTourProject.mockRejectedValue(erreur)
    const espionConsole = vi.spyOn(console, 'error').mockImplementation(() => {})
    const w = mountView()
    await flushPromises()
    const snackbar = useSnackbarStore()

    await w.find('[data-test="replay-tour"]').trigger('click')
    await flushPromises()

    expect(snackbar.visible).toBe(true)
    expect(snackbar.message).toBe(fr.tour.unavailable)
    expect(nav.router.push).not.toHaveBeenCalled()
    expect(espionConsole).toHaveBeenCalledWith(expect.stringContaining('ensureTourProject'), erreur)
    espionConsole.mockRestore()
  })

  it("précède le bloc Contribuer dans l'ordre du DOM", async () => {
    const w = mountView()
    await flushPromises()
    const titles = w.findAll('.block__title').map((el) => el.text())
    const iHelp = titles.indexOf(fr.settings.help.title)
    const iContribute = titles.indexOf(fr.settings.contribute)
    expect(iHelp).toBeGreaterThanOrEqual(0)
    expect(iContribute).toBeGreaterThanOrEqual(0)
    expect(iHelp).toBeLessThan(iContribute)
  })
})

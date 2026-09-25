// @vitest-environment jsdom
// Guide — bouton de relance de la visite guidée à la fin de la première section (lot
// « visite guidée », 23/09/2026). Même bouton secondaire, même clé de libellé
// (`settings.help.replayTour`) que le bloc « Aide » des Réglages (SettingsView.vue) —
// cf. tests/unit/settings-replay-tour.spec.js pour le câblage snackbar/navigation détaillé,
// couvert une fois là-bas. Ce fichier vérifie le PLACEMENT (section-0 seulement) et que le
// clic déclenche bien `startTour`.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@/i18n'
import fr from '@/i18n/fr.json'
import guideFr from '@/generated/guide-content.fr.json'

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => nav.router }))

const tourSample = vi.hoisted(() => ({ ensureTourProject: vi.fn() }))
vi.mock('@/utils/tour-sample', () => tourSample)

import GuideView from '@/views/GuideView.vue'

function mountGuide() {
  i18n.global.locale.value = 'fr'
  return mount(GuideView, {
    global: { plugins: [createTestingPinia({ stubActions: false }), i18n], stubs: { AppHeader: true } },
  })
}

beforeEach(() => {
  tourSample.ensureTourProject.mockReset()
  nav.router.push.mockReset()
})

describe('Guide — relance de la visite guidée', () => {
  it("le bouton n'apparaît qu'à la fin de la première section (section-0)", () => {
    const wrapper = mountGuide()
    const boutons = wrapper.findAll('[data-test="guide-replay-tour"]')
    expect(boutons).toHaveLength(1)
    const section = wrapper.findAll('.section')[0]
    expect(section.attributes('data-section-id')).toBe('section-0')
    expect(section.find('[data-test="guide-replay-tour"]').exists()).toBe(true)
  })

  it('porte le même libellé que le bouton des Réglages', () => {
    const wrapper = mountGuide()
    expect(wrapper.find('[data-test="guide-replay-tour"]').text()).toBe(fr.settings.help.replayTour)
  })

  it("n'est jamais le bouton principal de l'écran", () => {
    const wrapper = mountGuide()
    const btn = wrapper.find('[data-test="guide-replay-tour"]')
    expect(btn.classes()).toContain('btn')
    expect(btn.classes()).not.toContain('btn--primary')
  })

  it('un clic retrouve le projet et navigue vers le lecteur avec tour=1', async () => {
    tourSample.ensureTourProject.mockResolvedValue({ id: 3, created: false })
    const wrapper = mountGuide()

    await wrapper.find('[data-test="guide-replay-tour"]').trigger('click')
    await flushPromises()

    expect(tourSample.ensureTourProject).toHaveBeenCalledTimes(1)
    expect(nav.router.push).toHaveBeenCalledWith({
      name: 'project-read',
      params: { id: 3 },
      query: { tour: '1' },
    })
  })

  it('vaut aussi pour les autres langues : une seule instance du bouton', () => {
    i18n.global.locale.value = 'en'
    const wrapper = mount(GuideView, {
      global: { plugins: [createTestingPinia({ stubActions: false }), i18n], stubs: { AppHeader: true } },
    })
    expect(wrapper.findAll('[data-test="guide-replay-tour"]')).toHaveLength(1)
    expect(guideFr.sections[0].id).toBe('section-0') // garde-fou : l'id ciblé existe bien
  })
})

// @vitest-environment jsdom
// Unitaire — HomeView : la tuile « Aiguilles » de la rangée Outils navigue vers l'écran
// de recommandation de taille d'aiguilles (route needle-gauge).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import i18n from '@/i18n'

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => nav.router }))

import HomeView from '@/views/HomeView.vue'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

function mountHome() {
  return mount(HomeView, {
    global: { plugins: [createPinia(), i18n], stubs: { ProjectCard: true, StitchProgress: true } },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
})

describe('HomeView — tuile Outils « Aiguilles »', () => {
  it('navigue vers needle-gauge au clic', async () => {
    const w = mountHome()
    const btn = w.findAll('.tool').find((b) => b.text().includes(tk('home.toolNeedle')))
    expect(btn).toBeTruthy()
    await btn.trigger('click')
    expect(nav.router.push).toHaveBeenCalledWith({ name: 'needle-gauge' })
  })
})

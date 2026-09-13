// tests/unit/nav-progress-view.spec.js
// Unitaire — la barre est présente dans le DOM ssi navActive est vrai.
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import NavProgress from '@/components/NavProgress.vue'
import { navActive } from '@/composables/useNavProgress'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr, en } })
const mountIt = () => mount(NavProgress, { global: { plugins: [i18n] } })

afterEach(() => {
  navActive.value = false
  i18n.global.locale.value = 'fr'
})

describe('NavProgress.vue', () => {
  it('rien dans le DOM quand navActive est faux', () => {
    navActive.value = false
    const wrapper = mountIt()
    expect(wrapper.find('.navprogress').exists()).toBe(false)
  })

  it('barre visible + role progressbar quand navActive est vrai', async () => {
    const wrapper = mountIt()
    navActive.value = true
    await wrapper.vm.$nextTick()
    const bar = wrapper.find('.navprogress')
    expect(bar.exists()).toBe(true)
    expect(bar.attributes('role')).toBe('progressbar')
  })

  // Tâche « dernier reliquat 4 langues » (29/07) : l'aria-label était en dur
  // en français (:aria-label="'Chargement'"), invariant quelle que soit la
  // langue de l'app — passe maintenant par nav.loading (i18n).
  it('aria-label suit la langue (nav.loading), pas figé en français', async () => {
    const wrapper = mountIt()
    navActive.value = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.navprogress').attributes('aria-label')).toBe(fr.nav.loading)

    i18n.global.locale.value = 'en'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.navprogress').attributes('aria-label')).toBe(en.nav.loading)
    expect(en.nav.loading).not.toBe(fr.nav.loading)
  })
})

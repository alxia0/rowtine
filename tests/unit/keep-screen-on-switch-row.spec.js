// @vitest-environment jsdom
// Unitaire — rangée interrupteur « Garder l'écran allumé » partagée Réglages ↔ volet
// d'aide-mémoire du lecteur (spec 2026-10-01). Couvre : absent hors natif (le pont y est
// un no-op — rien qui ne ferait rien), présent en natif avec sa bascule qui écrit le
// réglage global, et l'id de titre fourni (un id distinct par lieu de montage, l'appui
// a11y aria-labelledby l'exige).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { useSettingsStore } from '@/stores/settings'
import KeepScreenOnSwitchRow from '@/components/KeepScreenOnSwitchRow.vue'

const keepAwake = vi.hoisted(() => ({ available: vi.fn(() => true) }))
vi.mock('@/native/keep-awake', () => ({ isKeepScreenOnAvailable: () => keepAwake.available() }))

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const mountIt = (headingId = 'keep-screen-title') =>
  mount(KeepScreenOnSwitchRow, { props: { headingId }, global: { plugins: [i18n] } })

beforeEach(() => {
  setActivePinia(createPinia())
  keepAwake.available.mockReturnValue(true)
})

describe('KeepScreenOnSwitchRow', () => {
  it('hors natif : rien de rendu', async () => {
    keepAwake.available.mockReturnValue(false)
    const w = mountIt()
    await flushPromises()
    expect(w.find('[data-test="keep-screen-switch"]').exists()).toBe(false)
  })

  it('en natif : interrupteur nommé par le titre fourni, actif par défaut, la bascule écrit le réglage', async () => {
    const w = mountIt('keep-screen-volet')
    await flushPromises()
    const sw = w.get('[data-test="keep-screen-switch"]')
    expect(sw.attributes('role')).toBe('switch')
    expect(sw.attributes('aria-checked')).toBe('true')
    expect(sw.attributes('aria-labelledby')).toBe('keep-screen-volet')
    expect(w.get('#keep-screen-volet').text()).toBe(i18n.global.t('settings.keepScreenOn'))
    await sw.trigger('click')
    await vi.waitFor(() => expect(useSettingsStore().keepScreenOn).toBe(false))
    await w.get('[data-test="keep-screen-switch"]').trigger('click')
    await vi.waitFor(() => expect(useSettingsStore().keepScreenOn).toBe(true))
  })
})

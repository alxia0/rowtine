// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { applyTheme, applyAccent, syncNativeChrome, STORAGE_KEY } from '@/theme/apply'
import { generatePalette } from '@/theme/palette'

function stubMatchMedia(matches) {
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.head.innerHTML = '<meta name="theme-color" content="#f3f6fe">' // pré-paint index.html (défaut dynamique clair 230)
  localStorage.clear()
  stubMatchMedia(false)
})

describe('applyTheme', () => {
  it('choix explicite dark -> data-theme=dark, meta sombre (fond au défaut dynamique 320), localStorage=dark', () => {
    const eff = applyTheme('dark')
    expect(eff).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    // T2 (31/08) : sans teinte fournie, le défaut est DYNAMIQUE — bgHex(320, 'dark').
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#151215')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark')
  })
  it('choix explicite light -> data-theme=light, meta clair (défaut dynamique 230)', () => {
    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#f3f6fe')
  })
  it('system -> retire data-theme, s\'abonne a matchMedia', () => {
    const mq = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    window.matchMedia = vi.fn().mockReturnValue(mq)
    const eff = applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(eff).toBe('dark') // OS en nuit
    expect(mq.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })
  it('repasser de system a explicite retire l\'ecouteur systeme', () => {
    const mq = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    window.matchMedia = vi.fn().mockReturnValue(mq)
    applyTheme('system')
    applyTheme('dark')
    expect(mq.removeEventListener).toHaveBeenCalled()
  })
})

describe('applyAccent', () => {
  it('pose les tokens generes (rgb) sur documentElement', () => {
    applyAccent(190, 'light')
    expect(document.documentElement.style.getPropertyValue('--brand')).toMatch(/^rgb\(/)
    expect(document.documentElement.style.getPropertyValue('--brand-grad')).toMatch(/^linear-gradient\(/)
  })
  it('ne touche pas data-theme', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    applyAccent(90, 'dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('applyTheme — accent', () => {
  it('applique aussi la teinte par defaut quand hue est omis (compat retro)', () => {
    applyTheme('light')
    expect(document.documentElement.style.getPropertyValue('--brand')).toMatch(/^rgb\(/)
  })
  it('applique la teinte fournie', () => {
    applyTheme('light', 230)
    const withHue230 = document.documentElement.style.getPropertyValue('--brand')
    applyTheme('light', 44)
    const withHue44 = document.documentElement.style.getPropertyValue('--brand')
    expect(withHue230).not.toBe(withHue44)
  })
})

describe('syncNativeChrome', () => {
  it('resynchronise <meta theme-color> sur --bg pour la teinte donnee, sans dependre de applyTheme', () => {
    applyTheme('light', 44) // pose la teinte par defaut, meta='#faf6ee'
    syncNativeChrome(190, 'light') // changement de teinte SEUL (pas de changement de theme)
    const expectedBg = generatePalette(190, 'light')['--bg']
    expect(expectedBg).not.toBe('rgb(250, 246, 238)') // #faf6ee — la teinte a bien change le fond
    // syncNativeChrome doit reposer <meta theme-color> sur la NOUVELLE teinte, pas rester
    // sur celle du dernier applyTheme() — c'est le defaut qu'elle corrige.
    const metaHex = document.querySelector('meta[name="theme-color"]').getAttribute('content')
    expect(metaHex).not.toBe('#faf6ee')
  })
})

describe('watchSystem — reste a jour apres un changement de teinte hors applyTheme', () => {
  it('un changement d\'OS reprend la DERNIERE teinte appliquee, pas celle du dernier applyTheme()', () => {
    const mq = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    window.matchMedia = vi.fn().mockReturnValue(mq)
    applyTheme('system', 44)
    // Simule SettingsView.vue::previewAccentHue — l'aperçu en direct du glissé appelle
    // applyAccent() seul, sans repasser par applyTheme().
    applyAccent(190, 'light')
    const changeHandler = mq.addEventListener.mock.calls.at(-1)[1]
    mq.matches = true // l'OS bascule en nuit
    changeHandler()
    const expected = generatePalette(190, 'dark')['--brand']
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe(expected)
  })

  // T2 (31/08) : sans choix explicite, le fournisseur (fonction) est RÉ-ÉVALUÉ à chaque
  // changement d'OS — la couleur suit le thème effectif.
  it('un fournisseur de teinte (défaut dynamique) est ré-évalué au changement d’OS : bleu clair -> rose sombre', () => {
    const mq = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    window.matchMedia = vi.fn().mockReturnValue(mq)
    // Même forme que router/index.js / SettingsView.vue : (effective) => hue.
    applyTheme('system', (effective) => (effective === 'dark' ? 320 : 230))
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe(generatePalette(230, 'light')['--brand'])
    const changeHandler = mq.addEventListener.mock.calls.at(-1)[1]
    mq.matches = true
    changeHandler()
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe(generatePalette(320, 'dark')['--brand'])
    // Le meta suit lui aussi le nouveau fond.
    const metaHex = document.querySelector('meta[name="theme-color"]').getAttribute('content')
    expect(metaHex).toBe('#151215')
  })

  // Non-régression : le handler ne doit PAS figer le nombre résolu à la place du fournisseur,
  // sinon seule la PREMIÈRE bascule OS suivrait le défaut dynamique.
  it('une DEUXIÈME bascule OS suit encore le fournisseur (sombre -> clair -> sombre)', () => {
    const mq = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    window.matchMedia = vi.fn().mockReturnValue(mq)
    applyTheme('system', (effective) => (effective === 'dark' ? 320 : 230))
    const changeHandler = mq.addEventListener.mock.calls.at(-1)[1]
    mq.matches = false // nuit -> jour
    changeHandler()
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe(generatePalette(230, 'light')['--brand'])
    mq.matches = true // jour -> nuit
    changeHandler()
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe(generatePalette(320, 'dark')['--brand'])
  })
})

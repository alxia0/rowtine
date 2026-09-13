// Plancher --sa-top de measureStickyTopHeight (retour terrain, 31/08/2026 : sur
// l'onboarding, le champ « Prénom » passait DERRIÈRE la barre d'état quand le clavier
// s'ouvrait — la vue n'a AUCUN bandeau collant en haut, la mesure revenait à 0 et le
// défilement du clavier (keyboard-avoidance.js) calait le champ au ras de la fenêtre,
// derrière l'horloge). Cf. src/utils/sticky-top.js.
//
// C'est la couture testable raisonnable de ce correctif : `measureSafeAreaTop` (la
// sonde) et le plancher de `measureStickyTopHeight`. Le reste du mécanisme (marge
// basse 45vh, retrait différé, contenteditable) vit dans keyboard-avoidance.spec.js,
// laissé tel quel.
//
// Limite jsdom (la même que keyboard-avoidance.spec.js) : aucune mise en page réelle —
// la sonde y mesure 0 par défaut. On stubbe getBoundingClientRect de la sonde pour
// simuler un appareil à encoche/barre d'état, et on vérifie le PLANCHER et l'absence
// de double compte avec un bandeau collant.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { installKeyboardAvoidance } from '@/utils/keyboard-avoidance'
import {
  measureStickyTopHeight,
  measureSafeAreaTop,
  RESPIRATION_SOUS_BANDEAUX,
} from '@/utils/sticky-top'

const SONDE = '[data-test="sa-top-sonde"]'

let cleanupEls = []
let probeStub = null

function stubProbeHeight(height) {
  measureSafeAreaTop() // matérialise la sonde (singleton module)
  const probe = document.querySelector(SONDE)
  probeStub = vi.spyOn(probe, 'getBoundingClientRect').mockReturnValue({
    height, top: 0, bottom: height, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {},
  })
}

function addStickyHeader(height) {
  const header = document.createElement('header')
  header.style.position = 'sticky'
  header.style.top = '0px'
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({
    height, top: 0, bottom: height, left: 0, right: 375, width: 375, x: 0, y: 0, toJSON() {},
  })
  document.body.appendChild(header)
  cleanupEls.push(header)
  return header
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

afterEach(() => {
  if (probeStub) {
    probeStub.mockRestore()
    probeStub = null
  }
  cleanupEls.forEach((el) => el.remove())
  cleanupEls = []
})

describe('measureSafeAreaTop — la sonde de la valeur UTILISÉE de --sa-top', () => {
  it('installe une sonde hors flux, invisible, portant height: var(--sa-top)', () => {
    measureSafeAreaTop()
    const probe = document.querySelector(SONDE)
    expect(probe).not.toBeNull()
    expect(probe.style.height).toBe('var(--sa-top)')
    expect(probe.style.position).toBe('fixed')
    expect(probe.style.visibility).toBe('hidden')
    expect(probe.style.width).toBe('0px')
    expect(probe.getAttribute('aria-hidden')).toBe('true')
  })

  it('ne crée la sonde QU\'UNE fois (singleton réutilisé, jamais dupliqué)', () => {
    measureSafeAreaTop()
    measureSafeAreaTop()
    expect(document.querySelectorAll(SONDE)).toHaveLength(1)
  })

  it('mesure 0 sans mise en page réelle (jsdom) — repli inchangé pour les tests existants', () => {
    expect(measureSafeAreaTop()).toBe(0)
  })
})

describe('measureStickyTopHeight — plancher sur l\'inset du haut', () => {
  it('sans bandeau collant (écran onboarding), ne descend JAMAIS sous --sa-top', () => {
    stubProbeHeight(42)
    expect(measureStickyTopHeight()).toBe(42)
  })

  it('pas de double compte : un bandeau PLUS HAUT que l\'inset impose sa hauteur (il porte déjà l\'inset dans son padding)', () => {
    addStickyHeader(101)
    stubProbeHeight(42)
    expect(measureStickyTopHeight()).toBe(101)
  })

  it('l\'inset gagne sur un bandeau plus BAS que lui', () => {
    addStickyHeader(20)
    stubProbeHeight(42)
    expect(measureStickyTopHeight()).toBe(42)
  })

  it('sans mise en page réelle (jsdom, sonde à 0), repli historique inchangé : 0', () => {
    expect(measureStickyTopHeight()).toBe(0)
  })
})

describe('coordination avec keyboard-avoidance (le retour du 31/08 lui-même)', () => {
  it('au focus du champ prénom (onboarding, sans bandeau), scroll-margin-top = plancher --sa-top + respiration', async () => {
    installKeyboardAvoidance()
    stubProbeHeight(42)
    const input = document.createElement('input')
    input.type = 'text'
    input.scrollIntoView = vi.fn()
    document.body.appendChild(input)
    cleanupEls.push(input)

    input.focus()
    await nextFrame()
    await nextFrame()
    // 42 (plancher safe-area) + 16 (respiration) : le champ reste au-dessous de la
    // barre d'état au lieu de monter au ras de la fenêtre.
    expect(input.style.scrollMarginTop).toBe(`${42 + RESPIRATION_SOUS_BANDEAUX}px`)

    input.blur()
    expect(input.style.scrollMarginTop).toBe('')
    expect(document.documentElement.style.paddingBottom).toBe('')
  })
})

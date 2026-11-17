// @vitest-environment jsdom
// Filtre de installFocusUnderHeader (WCAG 2.4.11, cf. src/utils/focus-under-header.js).
//
// jsdom n'a NI mise en page NI modalité de saisie : on simule getBoundingClientRect de la
// cible, la hauteur des bandeaux (measureStickyTopHeight) et `matches(':focus-visible')`.
// Ce que jsdom répondrait de lui-même à `:focus-visible` ne prouve rien ici. La preuve en
// vraie mise en page est l'e2e « focus clavier sous l'en-tête collant » de tests/e2e/tools.spec.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/utils/sticky-top', () => ({
  measureStickyTopHeight: vi.fn(() => 76),
  RESPIRATION_SOUS_BANDEAUX: 16,
}))
vi.mock('@/utils/scroll-behavior', () => ({
  scrollBehavior: vi.fn(() => 'auto'),
}))

import { installFocusUnderHeader } from '@/utils/focus-under-header'
import { measureStickyTopHeight } from '@/utils/sticky-top'
import { scrollBehavior } from '@/utils/scroll-behavior'

const HEADER = 76
const RESPIRATION = 16

let uninstall = null
let els = []
let scrollBy = null

function rect(top, height = 44) {
  return { top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON() {} }
}

// Une cible focalisable, à `top` dans la fenêtre, dont le focus est (ou non) un focus clavier.
function make(tag, { top, focusVisible = true, type } = {}) {
  const el = document.createElement(tag)
  if (type) el.type = type
  if (tag === 'div') el.tabIndex = 0
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(top))
  const realMatches = el.matches.bind(el)
  vi.spyOn(el, 'matches').mockImplementation((sel) => (sel === ':focus-visible' ? focusVisible : realMatches(sel)))
  document.body.appendChild(el)
  els.push(el)
  return el
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

beforeEach(() => {
  measureStickyTopHeight.mockReturnValue(HEADER)
  scrollBehavior.mockReturnValue('auto')
  scrollBy = vi.fn()
  window.scrollBy = scrollBy
  uninstall = installFocusUnderHeader()
})

afterEach(() => {
  uninstall?.()
  uninstall = null
  els.forEach((el) => el.remove())
  els = []
  vi.clearAllMocks()
})

describe('installFocusUnderHeader', () => {
  it('une case prise au clavier SOUS l’en-tête fait défiler la fenêtre de la différence plus la respiration', async () => {
    const box = make('input', { type: 'checkbox', top: 30 })
    box.focus()
    await nextFrame()
    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(scrollBy).toHaveBeenCalledWith({ top: 30 - HEADER - RESPIRATION, behavior: 'auto' })
  })

  it('le behavior vient de scrollBehavior() (réduire les animations respecté)', async () => {
    scrollBehavior.mockReturnValue('smooth')
    const select = make('select', { top: 10 })
    select.focus()
    await nextFrame()
    expect(scrollBy).toHaveBeenCalledWith({ top: 10 - HEADER - RESPIRATION, behavior: 'smooth' })
  })

  it('case maison : l’input masqué est mesuré par le haut de son label enveloppant', async () => {
    const label = document.createElement('label')
    vi.spyOn(label, 'getBoundingClientRect').mockReturnValue(rect(60))
    document.body.appendChild(label)
    els.push(label)
    // L'input de 1 px est centré dans le label de 44 px : son haut (82) est SOUS l'en-tête,
    // celui de la case affichée (60) ne l'est pas.
    const box = make('input', { type: 'checkbox', top: 82 })
    label.appendChild(box)
    box.focus()
    await nextFrame()
    expect(scrollBy).toHaveBeenCalledWith({ top: 60 - HEADER - RESPIRATION, behavior: 'auto' })
  })

  it('un champ texte est ignoré (il reste à l’évitement du clavier)', async () => {
    const input = make('input', { type: 'text', top: 30 })
    input.focus()
    const textarea = make('textarea', { top: 30 })
    textarea.focus()
    await nextFrame()
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('un focus à la souris ou au doigt (sans :focus-visible) est ignoré', async () => {
    const box = make('input', { type: 'checkbox', top: 30, focusVisible: false })
    box.focus()
    await nextFrame()
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('une cible déjà sous le bas de l’en-tête ne fait rien défiler', async () => {
    const box = make('input', { type: 'checkbox', top: HEADER })
    box.focus()
    await nextFrame()
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('dans un panneau défilant DE LA PAGE (ni collant ni fixe), c’est lui qui défile, pas la fenêtre', async () => {
    const panel = document.createElement('div')
    panel.style.overflowY = 'auto'
    Object.defineProperty(panel, 'clientHeight', { value: 400 })
    panel.scrollBy = vi.fn()
    document.body.appendChild(panel)
    els.push(panel)
    const box = make('input', { type: 'checkbox', top: 20 })
    panel.appendChild(box)
    box.focus()
    await nextFrame()
    expect(panel.scrollBy).toHaveBeenCalledWith({ top: 20 - HEADER - RESPIRATION, behavior: 'auto' })
    expect(scrollBy).not.toHaveBeenCalled()
  })

  // Fix round 1 de la revue : un contrôle DANS un bandeau collant (bouton retour, menu
  // d'AppHeader, `.rte__bar`) a par construction un haut < hauteur des bandeaux, sans être
  // recouvert. Le faire « dégager » remontait la page de 60 à 90 px à chaque Tab.
  it('un bouton DANS l’en-tête collant ne fait rien défiler', async () => {
    const header = document.createElement('header')
    header.style.position = 'sticky'
    header.style.top = '0px'
    document.body.appendChild(header)
    els.push(header)
    const back = make('button', { top: 16 })
    header.appendChild(back)
    back.focus()
    await nextFrame()
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('un élément de menu dans un descendant ABSOLU de l’en-tête collant ne fait rien défiler', async () => {
    const header = document.createElement('header')
    header.style.position = 'sticky'
    document.body.appendChild(header)
    els.push(header)
    const nav = document.createElement('nav')
    nav.style.position = 'absolute'
    header.appendChild(nav)
    const item = make('button', { top: 60 })
    nav.appendChild(item)
    item.focus()
    await nextFrame()
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('dans une surcouche FIXE (dialogue), ni la carte ni la page ne défilent', async () => {
    const overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    document.body.appendChild(overlay)
    els.push(overlay)
    const card = document.createElement('div')
    card.style.overflowY = 'auto'
    Object.defineProperty(card, 'clientHeight', { value: 400 })
    card.scrollBy = vi.fn()
    overlay.appendChild(card)
    const close = make('button', { top: 20 })
    card.appendChild(close)
    close.focus()
    await nextFrame()
    expect(card.scrollBy).not.toHaveBeenCalled()
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('la fonction rendue retire l’écouteur', async () => {
    uninstall()
    uninstall = null
    const box = make('input', { type: 'checkbox', top: 30 })
    box.focus()
    await nextFrame()
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('un :focus-visible non reconnu (vieille WebView) ne lève rien et ne défile pas', async () => {
    const box = make('input', { type: 'checkbox', top: 30 })
    box.matches.mockImplementation(() => {
      throw new SyntaxError('unknown pseudo-class')
    })
    // Une exception levée dans un écouteur n'interrompt pas `focus()` : jsdom (comme un
    // navigateur) la signale sur `window` en évènement `error`. C'est là qu'il faut regarder.
    const errors = []
    const onError = (ev) => {
      errors.push(ev.error)
      ev.preventDefault()
    }
    window.addEventListener('error', onError)
    try {
      box.focus()
      await nextFrame()
    } finally {
      window.removeEventListener('error', onError)
    }
    expect(errors).toEqual([])
    expect(scrollBy).not.toHaveBeenCalled()
  })
})

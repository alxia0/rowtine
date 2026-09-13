// Bouton « retour en haut ». Le test central est le n°3 : avec une cible fournie, le
// clic doit remonter LA CIBLE et ne pas toucher à window — le bug qu'il prévient rendrait
// le bouton inerte sur N'IMPORTE QUEL écran auquel on donnerait un jour un volet interne
// qui défile. Aujourd'hui, aucun écran de l'app n'est dans ce cas, lecteur compris (cf.
// pose sur les six écrans longs : le lecteur défile lui aussi le document) —
// mais la prop `target` reste testée ici pour que le composant reste honnête si ça change.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import BackToTop from '@/components/BackToTop.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const mountWith = (props = {}) => mount(BackToTop, { props, global: { plugins: [i18n] } })

// Faux conteneur défilant : un objet qui se comporte comme un élément pour ce dont le
// composant a besoin (scrollTop, écouteurs, scrollTo).
function fakeScroller() {
  const listeners = {}
  return {
    scrollTop: 0,
    scrollTo: vi.fn(),
    addEventListener: vi.fn((type, fn) => { (listeners[type] ||= []).push(fn) }),
    removeEventListener: vi.fn((type, fn) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn)
    }),
    fire(type) { for (const fn of listeners[type] || []) fn() },
    listeners,
  }
}

describe('BackToTop', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('1. sous le seuil : rien dans le DOM (pas seulement invisible)', async () => {
    const el = fakeScroller()
    el.scrollTop = 100
    const w = mountWith({ target: el, threshold: 500 })
    await w.vm.$nextTick()
    expect(w.find('button').exists()).toBe(false)
  })

  it('2. au-dessus du seuil : le bouton apparaît, avec son libellé traduit', async () => {
    const el = fakeScroller()
    const w = mountWith({ target: el, threshold: 500 })
    el.scrollTop = 501
    el.fire('scroll')
    await w.vm.$nextTick()
    const btn = w.find('button')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('aria-label')).toBe(fr.common.backToTop)
  })

  it('3. le clic remonte LA CIBLE et ne touche pas à window', async () => {
    const el = fakeScroller()
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const w = mountWith({ target: el, threshold: 500 })
    el.scrollTop = 900
    el.fire('scroll')
    await w.vm.$nextTick()
    await w.find('button').trigger('click')
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(windowScroll).not.toHaveBeenCalled()
  })

  it('4. sans cible : c’est la fenêtre qui remonte', async () => {
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    // jsdom n'implémente pas `document.scrollingElement` (toujours `undefined`) : le
    // composant se rabat alors sur `document.documentElement`, exactement comme
    // `findScrollContainer` (keyboard-avoidance.js:259) — c'est donc là qu'on pose le
    // scrollTop simulé, pas sur `scrollingElement` qui n'existe pas dans ce banc.
    // `defineProperty` pose une propriété PROPRE à l'instance, par-dessus l'accesseur du
    // prototype — `vi.restoreAllMocks()` (beforeEach) ne défait pas ça. Sans le `delete`
    // du `finally`, le test 5 démarrerait avec un scrollTop=900 résiduel sur
    // documentElement, donc un bouton potentiellement déjà visible avant même qu'une
    // cible soit posée : un couplage entre tests dépendant de l'ordre d'exécution.
    Object.defineProperty(document.documentElement, 'scrollTop', { value: 900, configurable: true })
    try {
      const w = mountWith({ threshold: 500 })
      window.dispatchEvent(new Event('scroll'))
      await w.vm.$nextTick()
      await w.find('button').trigger('click')
      expect(windowScroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    } finally {
      delete document.documentElement.scrollTop
    }
  })

  it('5. cible fournie APRÈS le montage : le bouton fonctionne quand même', async () => {
    const w = mountWith({ target: null, threshold: 500 })
    const el = fakeScroller()
    await w.setProps({ target: el })
    el.scrollTop = 900
    el.fire('scroll')
    await w.vm.$nextTick()
    expect(w.find('button').exists()).toBe(true)
  })

  it('6. démontage : les écouteurs sont retirés', async () => {
    const el = fakeScroller()
    const w = mountWith({ target: el, threshold: 500 })
    w.unmount()
    expect(el.removeEventListener).toHaveBeenCalled()
    expect(el.listeners.scroll || []).toHaveLength(0)
  })

  it('7. redescendre sous le seuil fait disparaître le bouton', async () => {
    const el = fakeScroller()
    const w = mountWith({ target: el, threshold: 500 })
    el.scrollTop = 900
    el.fire('scroll')
    await w.vm.$nextTick()
    expect(w.find('button').exists()).toBe(true)
    el.scrollTop = 10
    el.fire('scroll')
    await w.vm.$nextTick()
    expect(w.find('button').exists()).toBe(false)
  })

  it('8. cible A puis cible B : A est détachée, seule B pilote le bouton', async () => {
    const a = fakeScroller()
    const b = fakeScroller()
    const w = mountWith({ target: a, threshold: 500 })
    await w.setProps({ target: b })

    // A ne doit plus avoir d'écouteur du tout : le changement de cible doit l'avoir
    // détachée, pas seulement cessé de s'en servir.
    expect(a.listeners.scroll || []).toHaveLength(0)

    // Un scroll sur A (la cible abandonnée) ne doit plus rien déclencher.
    a.scrollTop = 900
    a.fire('scroll')
    await w.vm.$nextTick()
    expect(w.find('button').exists()).toBe(false)

    // B, elle, doit être pleinement fonctionnelle.
    b.scrollTop = 900
    b.fire('scroll')
    await w.vm.$nextTick()
    expect(w.find('button').exists()).toBe(true)
  })

  it('9. rotation d’écran avec une cible posée : le seuil (fonction du viewport) est ré-évalué', async () => {
    const el = fakeScroller()
    const w = mountWith({ target: el }) // threshold par défaut = 1.5 × window.innerHeight
    el.scrollTop = window.innerHeight // sous le seuil par défaut (1.5×)
    el.fire('scroll')
    await w.vm.$nextTick()
    expect(w.find('button').exists()).toBe(false)

    // Rotation : le viewport rétrécit, le seuil (1.5 × innerHeight) diminue avec lui — le
    // même scrollTop passe donc au-dessus. Sans écouteur `resize` posé même quand une
    // cible est fournie, cette bascule ne serait recalculée qu'au prochain `scroll`.
    const original = window.innerHeight
    Object.defineProperty(window, 'innerHeight', { value: Math.floor(original / 3), configurable: true })
    try {
      window.dispatchEvent(new Event('resize'))
      await w.vm.$nextTick()
      expect(w.find('button').exists()).toBe(true)
    } finally {
      Object.defineProperty(window, 'innerHeight', { value: original, configurable: true })
    }
  })

  // Revue du lot : `behavior: 'smooth'` était passé EN DUR à `scrollTo` — une
  // valeur explicite l'emporte sur la règle CSS `scroll-behavior: auto !important` de
  // tokens.css sous prefers-reduced-motion (cette règle ne gouverne que le défilement
  // laissé au navigateur), donc la remontée restait animée même préférence active.
  // Trois cas à distinguer (mêmes que keyboard-avoidance.spec.js pour le même bug) :
  // `matchMedia` absent (repli), présent mais inactif, présent et actif. Les tests 3/4
  // ci-dessus ne couvrent QUE le repli (jsdom n'a pas de `matchMedia`) — ils ne prouvent
  // pas « réglage inactif ⇒ smooth » explicitement, seulement le cas où la question n'est
  // même pas posée. `window.matchMedia` est réassigné en dur (pas `vi.spyOn`) : une simple
  // affectation n'est pas défaite par `vi.restoreAllMocks()` (beforeEach), d'où le
  // try/finally qui la restaure — même piège déjà réglé dans ce fichier pour `defineProperty`
  // (test 4) et dans keyboard-avoidance.spec.js:190-205 pour ce même mock.
  function fakeMatchMedia(matches) {
    return vi.fn((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? matches : false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }))
  }

  it('10. matchMedia absent (repli) : la remontée reste smooth (comportement historique)', async () => {
    const el = fakeScroller()
    const original = window.matchMedia
    delete window.matchMedia
    try {
      const w = mountWith({ target: el, threshold: 500 })
      el.scrollTop = 900
      el.fire('scroll')
      await w.vm.$nextTick()
      await w.find('button').trigger('click')
      expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    } finally {
      window.matchMedia = original
    }
  })

  it('11. réglage « réduire les animations » INACTIF : matchMedia interrogé, réponse smooth', async () => {
    const el = fakeScroller()
    const original = window.matchMedia
    window.matchMedia = fakeMatchMedia(false)
    try {
      const w = mountWith({ target: el, threshold: 500 })
      el.scrollTop = 900
      el.fire('scroll')
      await w.vm.$nextTick()
      await w.find('button').trigger('click')
      expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    } finally {
      window.matchMedia = original
    }
  })

  it('12. réglage « réduire les animations » ACTIF : la remontée devient auto (cible fournie)', async () => {
    const el = fakeScroller()
    const original = window.matchMedia
    window.matchMedia = fakeMatchMedia(true)
    try {
      const w = mountWith({ target: el, threshold: 500 })
      el.scrollTop = 900
      el.fire('scroll')
      await w.vm.$nextTick()
      await w.find('button').trigger('click')
      expect(el.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
    } finally {
      window.matchMedia = original
    }
  })

  it('13. réglage « réduire les animations » ACTIF : vaut aussi sans cible (repli window)', async () => {
    const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const original = window.matchMedia
    window.matchMedia = fakeMatchMedia(true)
    Object.defineProperty(document.documentElement, 'scrollTop', { value: 900, configurable: true })
    try {
      const w = mountWith({ threshold: 500 })
      window.dispatchEvent(new Event('scroll'))
      await w.vm.$nextTick()
      await w.find('button').trigger('click')
      expect(windowScroll).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
    } finally {
      window.matchMedia = original
      delete document.documentElement.scrollTop
    }
  })
})

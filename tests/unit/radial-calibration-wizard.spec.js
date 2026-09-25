// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'
import RadialCalibrationWizard from '@/components/RadialCalibrationWizard.vue'

const CHART_CIRCLE = { img: 'g.png', shape: 'radial-circle', rows: 7 }
const CHART_SQUARE = { img: 'g.png', shape: 'radial-square', rows: 7 }
const CHART_HEXAGON = { img: 'g.png', shape: 'radial-hexagon', rows: 7 }
const CHART_ONE_ROW = { img: 'g.png', shape: 'radial-circle', rows: 1 }

const wrappers = []
function mountWizard(props = {}) {
  const w = mount(RadialCalibrationWizard, {
    props: { chart: CHART_CIRCLE, frame: null, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  wrappers.push(w)
  return w
}
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

function firePointer(element, type, props) {
  const ev = new Event(type, { bubbles: true })
  Object.assign(ev, props)
  element.dispatchEvent(ev)
}
function forceViewportBox(w) {
  // Viewport + contenu (imgwrap) 200×100 — mêmes conventions que chart-stage.spec.js.
  // jsdom ne calcule jamais de vraie mise en page : scrollLeft/scrollTop/clientWidth/Height
  // restent à 0 par défaut, ce qui suffit ici puisque les tests ne vérifient que `draft`
  // (produit par le geste), jamais l'état de défilement lui-même.
  const box = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 }
  w.vm.$el.querySelector('.rcw__viewport').getBoundingClientRect = () => box
  w.vm.$el.querySelector('.rcw__imgwrap').getBoundingClientRect = () => box
}

describe('RadialCalibrationWizard — écran 1 (limite intérieure)', () => {
  it('démarre sur l\'écran intérieur, cercle par défaut pour un chart.shape radial-circle', () => {
    const w = mountWizard()
    expect(w.vm.step).toBe('inner')
    expect(w.vm.draft.r0Shape).toBe('circle')
    expect(w.find('.rcw__guide').classes()).not.toContain('rcw__guide--square')
  })

  it('chart.shape radial-square → carré par défaut pour les deux limites', () => {
    const w = mountWizard({ chart: CHART_SQUARE })
    expect(w.vm.draft.r0Shape).toBe('square')
    expect(w.vm.draft.r1Shape).toBe('square')
  })

  it('la bascule cercle/carré change draft.r0Shape et la forme de la loupe fixe', async () => {
    const w = mountWizard()
    await w.findAll('.rcw__shapebtn')[1].trigger('click') // 2e bouton = Carré
    expect(w.vm.draft.r0Shape).toBe('square')
    expect(w.find('.rcw__guide').classes()).toContain('rcw__guide--square')
  })

  it('chart.shape radial-hexagon → hexagone par défaut pour les deux limites', () => {
    const w = mountWizard({ chart: CHART_HEXAGON })
    expect(w.vm.draft.r0Shape).toBe('hexagon')
    expect(w.vm.draft.r1Shape).toBe('hexagon')
  })

  it('la bascule vers hexagone change draft.r0Shape et la forme de la loupe fixe', async () => {
    const w = mountWizard()
    await w.findAll('.rcw__shapebtn')[2].trigger('click') // 3e bouton = Hexagone
    expect(w.vm.draft.r0Shape).toBe('hexagon')
    expect(w.find('.rcw__guide').classes()).toContain('rcw__guide--hexagon')
  })

  it('mode Déplacer (par défaut) : glisser fait défiler le dessin sous la loupe fixe (delta pixel → % du contenu)', async () => {
    const w = mountWizard()
    forceViewportBox(w)
    const viewport = w.vm.$el.querySelector('.rcw__viewport')
    firePointer(viewport, 'pointerdown', { clientX: 0, clientY: 0 })
    await nextTick()
    // Contenu 200×100 : dx=40px → 20% du contenu, dy=10px → 10%. Glisser le dessin VERS LA
    // DROITE (dx>0) amène sous la loupe fixe un point plus à GAUCHE du dessin (cx diminue).
    firePointer(viewport, 'pointermove', { clientX: 40, clientY: 10 })
    await nextTick()
    expect(w.vm.draft.cx).toBeCloseTo(30) // 50 - 20
    expect(w.vm.draft.cy).toBeCloseTo(40) // 50 - 10
  })

  it('mode Agrandir·Rétrécir sur l\'écran intérieur : glisser verticalement change r0 (sensibilité 0,15/px)', async () => {
    const w = mountWizard()
    forceViewportBox(w)
    await w.findAll('.rcw__tool')[1].trigger('click') // 2e bouton = Agrandir·Rétrécir
    const viewport = w.vm.$el.querySelector('.rcw__viewport')
    firePointer(viewport, 'pointerdown', { clientX: 0, clientY: 0 })
    await nextTick()
    // dy=100px vers le bas → r0 = 15 (défaut) + 100×0,15 = 30.
    firePointer(viewport, 'pointermove', { clientX: 0, clientY: 100 })
    await nextTick()
    expect(w.vm.draft.r0).toBeCloseTo(30)
  })

  // Invariant existant [0,60] (ancienne UI de calage) : un motif dont le premier rang démarre
  // exactement au centre est un cas réel et déjà pris en charge — le plancher ne doit pas
  // empêcher r0 d'atteindre 0 (finding 4.2 : Math.max(1, ...) → Math.max(0, ...)).
  it('mode Agrandir·Rétrécir : glisser largement vers le haut peut amener r0 à 0 (pas plancher à 1)', async () => {
    const w = mountWizard()
    forceViewportBox(w)
    await w.findAll('.rcw__tool')[1].trigger('click') // 2e bouton = Agrandir·Rétrécir
    const viewport = w.vm.$el.querySelector('.rcw__viewport')
    firePointer(viewport, 'pointerdown', { clientX: 0, clientY: 0 })
    await nextTick()
    // dy=-200px (bien au-delà de ce qu'il faut) : 15 + (-200×0,15) = -15, borné à 0.
    firePointer(viewport, 'pointermove', { clientX: 0, clientY: -200 })
    await nextTick()
    expect(w.vm.draft.r0).toBe(0)
  })

  it('Réinitialiser (écran 1 seulement) restaure les valeurs par défaut sans quitter l\'assistant', async () => {
    const w = mountWizard({ frame: { cx: 10, cy: 10, r0: 5, r1: 20, r0Shape: 'square', r1Shape: 'square' } })
    await w.find('.rcw__reset').trigger('click')
    expect(w.vm.step).toBe('inner')
    expect(w.vm.draft).toEqual({ cx: 50, cy: 50, r0: 15, r1: 45, r0Shape: 'circle', r1Shape: 'circle', switchRound: null, hexOrientation: 'flat' })
    expect(w.emitted('save')).toBeUndefined()
    expect(w.emitted('cancel')).toBeUndefined()
  })
})

describe('RadialCalibrationWizard — orientation hexagonale', () => {
  it("n'apparaît pas quand la forme courante n'est pas hexagone", () => {
    const w = mountWizard()
    expect(w.find('.rcw__orient').exists()).toBe(false)
  })

  it("apparaît quand la forme courante est hexagone, orientation 'flat' par défaut", async () => {
    const w = mountWizard({ chart: CHART_HEXAGON })
    expect(w.vm.draft.hexOrientation).toBe('flat')
    const [flatBtn, pointyBtn] = w.findAll('.rcw__orientbtn')
    expect(flatBtn.attributes('aria-pressed')).toBe('true')
    expect(pointyBtn.attributes('aria-pressed')).toBe('false')
  })

  it("bascule vers 'pointy' change draft.hexOrientation", async () => {
    const w = mountWizard({ chart: CHART_HEXAGON })
    const [, pointyBtn] = w.findAll('.rcw__orientbtn')
    await pointyBtn.trigger('click')
    expect(w.vm.draft.hexOrientation).toBe('pointy')
  })

  it("Enregistrer inclut hexOrientation seulement si une limite est hexagonale", async () => {
    const w = mountWizard({ chart: CHART_HEXAGON })
    const [, pointyBtn] = w.findAll('.rcw__orientbtn')
    await pointyBtn.trigger('click')
    await w.find('.rcw__next').trigger('click')
    await w.find('.rcw__next').trigger('click') // → review (mêmes formes, pas de switch)
    await w.find('.rcw__save').trigger('click')
    const saved = w.emitted('save').at(-1)[0]
    expect(saved).toEqual({ cx: 50, cy: 50, r0: 15, r1: 45, r0Shape: 'hexagon', r1Shape: 'hexagon', hexOrientation: 'pointy' })
  })
})

describe('RadialCalibrationWizard — navigation et écran 2 (limite extérieure)', () => {
  it('Valider passe à l\'écran extérieur ; Retour revient à l\'intérieur sans rien perdre', async () => {
    const w = mountWizard()
    w.vm.draft.r0 = 22
    await w.find('.rcw__next').trigger('click')
    expect(w.vm.step).toBe('outer')
    expect(w.find('.rcw__reset').exists()).toBe(false) // Réinitialiser n'existe qu'à l'écran 1
    await w.find('.rcw__back').trigger('click')
    expect(w.vm.step).toBe('inner')
    expect(w.vm.draft.r0).toBe(22)
  })

  it('formes identiques (rond/rond) : Valider sur l\'écran extérieur saute directement au récapitulatif', async () => {
    const w = mountWizard()
    await w.find('.rcw__next').trigger('click') // → outer
    await w.find('.rcw__next').trigger('click') // → review (pas de switch, formes identiques)
    expect(w.vm.step).toBe('review')
    expect(w.vm.draft.switchRound).toBeNull()
  })

  it('mode Agrandir·Rétrécir sur l\'écran extérieur : le rayon ne peut pas descendre sous r0 + 2', async () => {
    const w = mountWizard()
    w.vm.draft.r0 = 20
    await w.find('.rcw__next').trigger('click') // → outer
    forceViewportBox(w)
    await w.findAll('.rcw__tool')[1].trigger('click') // Agrandir·Rétrécir
    const viewport = w.vm.$el.querySelector('.rcw__viewport')
    firePointer(viewport, 'pointerdown', { clientX: 0, clientY: 0 })
    await nextTick()
    // dy=-500px (bien au-delà de ce qu'il faut pour tenter de descendre sous r0+2=22).
    firePointer(viewport, 'pointermove', { clientX: 0, clientY: -500 })
    await nextTick()
    expect(w.vm.draft.r1).toBeCloseTo(22)
  })
})

describe('RadialCalibrationWizard — écran de transition (formes différentes)', () => {
  function toSwitchScreen(w) {
    return (async () => {
      await w.findAll('.rcw__shapebtn')[1].trigger('click') // écran intérieur → carré
      await w.find('.rcw__next').trigger('click') // → outer (reste rond par défaut)
      await w.find('.rcw__next').trigger('click') // → switch (formes différentes)
    })()
  }

  it('formes différentes → écran de transition avant le récapitulatif, rang de bascule par défaut = 2', async () => {
    const w = mountWizard()
    await toSwitchScreen(w)
    expect(w.vm.step).toBe('switch')
    expect(w.vm.draft.switchRound).toBe(2)
  })

  it('+/- déplace le rang de bascule, borné [2, chart.rows]', async () => {
    const w = mountWizard()
    await toSwitchScreen(w)
    await w.find('.rcw__stepdec').trigger('click') // déjà au minimum (2), ne descend pas
    expect(w.vm.draft.switchRound).toBe(2)
    for (let i = 0; i < 10; i++) await w.find('.rcw__stepinc').trigger('click')
    expect(w.vm.draft.switchRound).toBe(7) // chart.rows de CHART_CIRCLE
  })

  it('rows < 2 : aucun écran de transition, même avec des formes différentes ; le rang unique rend la forme EXTÉRIEURE (switchRound: 1, pas null)', async () => {
    const w = mountWizard({ chart: CHART_ONE_ROW })
    await w.findAll('.rcw__shapebtn')[1].trigger('click')
    await w.find('.rcw__next').trigger('click') // → outer
    await w.find('.rcw__next').trigger('click') // → review directement (rows=1)
    expect(w.vm.step).toBe('review')
    // switchRound: 1 (pas null) fait choisir r1Shape (la forme visible, extérieure) pour
    // l'unique rang — un repli silencieux sur r0Shape serait faux ici (spec, finding 4.1).
    expect(w.vm.draft.switchRound).toBe(1)
    await w.find('.rcw__save').trigger('click')
    const saved = w.emitted('save').at(-1)[0]
    expect(saved).toEqual({ cx: 50, cy: 50, r0: 15, r1: 45, r0Shape: 'square', r1Shape: 'circle', switchRound: 1 })
  })

  it('Retour depuis l\'écran de transition revient à l\'écran extérieur', async () => {
    const w = mountWizard()
    await toSwitchScreen(w)
    await w.find('.rcw__back').trigger('click')
    expect(w.vm.step).toBe('outer')
  })
})

describe('RadialCalibrationWizard — écran récapitulatif et enregistrement', () => {
  it("les 4 flèches déplacent le centre partagé de 1%, bornées [0,100]", async () => {
    const w = mountWizard()
    await w.find('.rcw__next').trigger('click')
    await w.find('.rcw__next').trigger('click') // → review
    await w.find('.rcw__dbtn--right').trigger('click')
    expect(w.vm.draft.cx).toBeCloseTo(51)
    await w.find('.rcw__dbtn--down').trigger('click')
    expect(w.vm.draft.cy).toBeCloseTo(51)
  })

  it('Enregistrer émet save avec cx/cy/r0/r1/r0Shape/r1Shape, sans switchRound quand les formes sont identiques', async () => {
    const w = mountWizard()
    await w.find('.rcw__next').trigger('click')
    await w.find('.rcw__next').trigger('click') // → review
    await w.find('.rcw__save').trigger('click')
    const saved = w.emitted('save').at(-1)[0]
    expect(saved).toEqual({ cx: 50, cy: 50, r0: 15, r1: 45, r0Shape: 'circle', r1Shape: 'circle' })
  })

  it('Enregistrer inclut switchRound quand les formes diffèrent', async () => {
    const w = mountWizard()
    await w.findAll('.rcw__shapebtn')[1].trigger('click')
    await w.find('.rcw__next').trigger('click') // → outer
    await w.find('.rcw__next').trigger('click') // → switch
    await w.find('.rcw__stepinc').trigger('click') // switchRound: 3
    await w.find('.rcw__next').trigger('click') // → review
    await w.find('.rcw__save').trigger('click')
    const saved = w.emitted('save').at(-1)[0]
    expect(saved).toEqual({ cx: 50, cy: 50, r0: 15, r1: 45, r0Shape: 'square', r1Shape: 'circle', switchRound: 3 })
  })

  it('Annuler (à n\'importe quelle étape) émet cancel sans save', async () => {
    const w = mountWizard()
    await w.find('.rcw__next').trigger('click')
    await w.find('.rcw__cancel').trigger('click')
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('save')).toBeUndefined()
  })

  it('pré-remplit depuis un frame existant (avec r0Shape/r1Shape/switchRound déjà posés)', () => {
    const frame = { cx: 30, cy: 70, r0: 8, r1: 40, r0Shape: 'circle', r1Shape: 'square', switchRound: 4 }
    const w = mountWizard({ chart: CHART_SQUARE, frame })
    expect(w.vm.draft).toEqual({ ...frame, hexOrientation: 'flat' })
  })

  it("pré-remplit depuis un frame ancien (sans r0Shape/r1Shape) : forme dérivée de chart.shape pour les deux", () => {
    const w = mountWizard({ chart: CHART_SQUARE, frame: { cx: 30, cy: 70, r0: 8, r1: 40 } })
    expect(w.vm.draft.r0Shape).toBe('square')
    expect(w.vm.draft.r1Shape).toBe('square')
    expect(w.vm.draft.switchRound).toBeNull()
  })
})

// Revue finale (26/08) : les 4 boutons de direction partageaient le même aria-label
// (« Déplacer » pour les 4), le stepper de rang de transition n'en avait aucun, et les
// boutons de forme n'exposaient pas aria-pressed contrairement aux boutons d'outil voisins.
describe('RadialCalibrationWizard — accessibilité', () => {
  it("les 4 boutons du pavé directionnel (écran récapitulatif) ont 4 aria-label distincts", async () => {
    const w = mountWizard()
    await w.find('.rcw__next').trigger('click')
    await w.find('.rcw__next').trigger('click') // → review
    const labels = ['up', 'down', 'left', 'right'].map((dir) => w.find(`.rcw__dbtn--${dir}`).attributes('aria-label'))
    expect(labels.every((l) => !!l)).toBe(true)
    expect(new Set(labels).size).toBe(4)
  })

  it('les boutons du stepper de rang de transition ont un aria-label', async () => {
    const w = mountWizard()
    await w.findAll('.rcw__shapebtn')[1].trigger('click')
    await w.find('.rcw__next').trigger('click') // → outer
    await w.find('.rcw__next').trigger('click') // → switch
    expect(w.find('.rcw__stepdec').attributes('aria-label')).toBeTruthy()
    expect(w.find('.rcw__stepinc').attributes('aria-label')).toBeTruthy()
    expect(w.find('.rcw__stepdec').attributes('aria-label')).not.toBe(w.find('.rcw__stepinc').attributes('aria-label'))
  })

  it('les boutons de forme exposent aria-pressed reflétant draft.r0Shape (écran intérieur)', async () => {
    const w = mountWizard() // r0Shape par défaut : circle
    const [circleBtn, squareBtn] = w.findAll('.rcw__shapebtn')
    expect(circleBtn.attributes('aria-pressed')).toBe('true')
    expect(squareBtn.attributes('aria-pressed')).toBe('false')
    await squareBtn.trigger('click')
    expect(circleBtn.attributes('aria-pressed')).toBe('false')
    expect(squareBtn.attributes('aria-pressed')).toBe('true')
  })

  it('les boutons de forme exposent aria-pressed reflétant draft.r1Shape (écran extérieur)', async () => {
    const w = mountWizard({ chart: CHART_SQUARE }) // r1Shape par défaut : square
    await w.find('.rcw__next').trigger('click') // → outer
    const [circleBtn, squareBtn] = w.findAll('.rcw__shapebtn')
    expect(circleBtn.attributes('aria-pressed')).toBe('false')
    expect(squareBtn.attributes('aria-pressed')).toBe('true')
  })
})

// Bug du 09/09 : syncScroll s'exécute
// au montage, quand le ResizeObserver n'a pas encore mesuré le viewport — le scroll range
// dépend du padding (viewportW/2), encore à 0, la pose retombe donc à 0 et plus aucun rejeu
// n'a lieu (le watch ne surveille que cx/cy/zoom/étape). À l'ouverture, l'utilisatrice voit
// le COIN du motif au lieu de son centre. Correctif attendu : rejouer syncScroll quand la
// taille du viewport est mesurée (callback du ResizeObserver).
describe('RadialCalibrationWizard — recentrage initial au relevé du ResizeObserver', () => {
  let originalRO
  const roInstances = []
  // Faux RO global : jsdom n'en a pas, le composant ne crée le sien que si l'observable
  // existe. On capture les instances (le composant en crée DEUX : viewport puis canvas
  // statique) pour déclencher manuellement celui du viewport.
  class FakeResizeObserver {
    constructor(cb) {
      this.cb = cb
      this.el = null
      roInstances.push(this)
    }
    observe(el) { this.el = el }
    unobserve() {}
    disconnect() {}
  }
  beforeEach(() => {
    roInstances.length = 0
    originalRO = globalThis.ResizeObserver
    globalThis.ResizeObserver = FakeResizeObserver
  })
  afterEach(() => {
    globalThis.ResizeObserver = originalRO
  })

  it('rejoue syncScroll quand le viewport est mesuré (dessin centré sous la loupe dès l\'ouverture)', async () => {
    const w = mountWizard()
    const viewport = w.vm.$el.querySelector('.rcw__viewport')
    const viewportRO = roInstances.find((ro) => ro.el === viewport)
    expect(viewportRO).toBeTruthy()
    // jsdom ne calcule aucune mise en page : on capture l'ASSIGNATION de scrollLeft/scrollTop
    // par des accesseurs espions, c'est elle qui prouve que syncScroll a reposé le défilement.
    const scrollLeftSets = []
    const scrollTopSets = []
    let scrollLeft = 0
    let scrollTop = 0
    Object.defineProperty(viewport, 'scrollLeft', { configurable: true, get: () => scrollLeft, set: (v) => { scrollLeft = v; scrollLeftSets.push(v) } })
    Object.defineProperty(viewport, 'scrollTop', { configurable: true, get: () => scrollTop, set: (v) => { scrollTop = v; scrollTopSets.push(v) } })
    // Laisser partir le nextTick(syncScroll) du montage : les rect ne sont pas encore forcés
    // (jsdom mesure 0×0), il doit rester muet — c'est exactement le bug (pose inopérante).
    await nextTick()
    await nextTick()
    expect(scrollLeftSets).toEqual([])
    expect(scrollTopSets).toEqual([])
    // Le RO mesure : le composant relit getBoundingClientRect → 200×100…
    forceViewportBox(w)
    viewportRO.cb()
    await nextTick()
    await nextTick()
    // …et rejoue syncScroll : le point (cx, cy) = (50, 50) du dessin 200×100 retombe au
    // centre de la loupe fixe — scrollLeft = 0,5 × 200 = 100, scrollTop = 0,5 × 100 = 50.
    expect(scrollLeftSets).toEqual([100])
    expect(scrollTopSets).toEqual([50])
    expect(viewport.scrollLeft).toBe(100)
    expect(viewport.scrollTop).toBe(50)
  })

  // Protège : l'aperçu des écrans transition/récapitulatif se pose sur l'IMAGE (cx/cy/r sont en % de l'image), pas sur la boîte qui la contient.
  it('canvas statique : le calque des formes épouse l’image contenue, pas la boîte (bandes vides exclues)', async () => {
    const w = mountWizard()
    const canvas = w.vm.$el.querySelector('.rcw__canvas')
    const canvasRO = roInstances.find((ro) => ro.el === canvas)
    expect(canvasRO).toBeTruthy()
    // Boîte 400×100, diagramme carré 100×100 : « contain » le pose en 100×100, centré (bandes de 150 px).
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 100, right: 400, bottom: 100 })
    const img = canvas.querySelector('img')
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 100 })
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 100 })
    img.dispatchEvent(new Event('load'))
    canvasRO.cb()
    await nextTick()
    const svg = canvas.querySelector('.rcw__overlay')
    expect(svg.style.left).toBe('150px')
    expect(svg.style.top).toBe('0px')
    expect(svg.style.width).toBe('100px')
    expect(svg.style.height).toBe('100px')
    expect(w.vm.canvasAspect).toBe(1)
  })
})

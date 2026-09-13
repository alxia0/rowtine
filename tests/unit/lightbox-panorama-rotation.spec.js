// Unitaire — la visionneuse présente un PANORAMA pivoté dans un viewport portrait (12/08/2026).
//
// Fichier séparé de photo-lightbox-zoom.spec.js (lot du 09/08) pour ne pas mêler les
// provenances : celui-là protège le geste de zoom, celui-ci la présentation pivotée. La table de
// vérité du critère lui-même vit dans tests/unit/photo-fit.spec.js (fonction pure) ; ce fichier
// prouve le CÂBLAGE : que le composant lit bien les dimensions réelles, échange les axes de la
// boîte, pose la classe CSS, et — le point délicat — ne touche PAS à la géométrie qui porte
// l'ancrage du zoom.
//
// Limite assumée, identique à celle du fichier du 09/08 : jsdom ne décode aucune image
// (naturalWidth/Height restent à 0) et ne calcule aucune mise en page réelle (clientWidth/Height
// ne reflètent rien). On force ces valeurs sur les vrais nœuds DOM. Que la WebView pivote et
// mesure vraiment comme on l'attend est prouvé par tests/e2e/guide-panorama.spec.js, sur un vrai
// moteur de rendu.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import PhotoLightbox from '@/components/PhotoLightbox.vue'
import { useLightboxStore } from '@/stores/lightbox'

// Le panorama réel du guide : src/content/guide/images/*/07c-stats-annee.webp.
const PANORAMA = { w: 1920, h: 305 }
// Viewport de référence : l'ordre de grandeur d'un téléphone tenu verticalement. Les dimensions
// EXACTES de l'appareil n'importent pas ici (c'est le rapport portrait qui est en jeu) ; le rendu
// réel est mesuré par tests/e2e/guide-panorama.spec.js, qui relit le viewport en direct.
const PORTRAIT = { w: 361, h: 819 }
const PAYSAGE = { w: 819, h: 361 }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.stubGlobal('requestAnimationFrame', (fn) => {
    fn()
    return 0
  })
})

// Monte la visionneuse, la remplit, et fait décoder une image des dimensions demandées dans un
// viewport des dimensions demandées.
async function ouvrir({ img, vp }) {
  const w = mount(PhotoLightbox, {
    global: { plugins: [createPinia(), i18n] },
    attachTo: document.body,
  })
  const lb = useLightboxStore()
  lb.show(['a.png', 'b.png'], 0)
  await w.vm.$nextTick()
  const vpEl = w.find('.lb__viewport').element
  Object.defineProperty(vpEl, 'clientWidth', { value: vp.w, configurable: true })
  Object.defineProperty(vpEl, 'clientHeight', { value: vp.h, configurable: true })
  const imgEl = w.find('[data-test="lb-img"]').element
  Object.defineProperty(imgEl, 'naturalWidth', { value: img.w, configurable: true })
  Object.defineProperty(imgEl, 'naturalHeight', { value: img.h, configurable: true })
  imgEl.dispatchEvent(new Event('load'))
  await w.vm.$nextTick()
  return { w, lb, vpEl, imgEl }
}

// Aide de lecture : `canvasStyle` renvoie des chaînes en px, on veut comparer des nombres.
const px = (s) => Number.parseFloat(s)

describe('visionneuse : un panorama s’ouvre pivoté dans un viewport portrait', () => {
  it('la taille de l’image est calculée dans une boîte aux AXES ÉCHANGÉS, et la classe est posée', async () => {
    const { w } = await ouvrir({ img: PANORAMA, vp: PORTRAIT })
    expect(w.vm.rotated).toBe(true)
    // Pivoté, le panorama dispose des 819 px de HAUTEUR du viewport pour sa largeur :
    // 1920 × (819/1920) = 819 de large, 305 × 0,4266 = 130,1 de haut.
    expect(px(w.vm.canvasStyle.width)).toBeCloseTo(819, 1)
    expect(px(w.vm.canvasStyle.height)).toBeCloseTo(130.1, 1)
    // Sans l'échange, il serait plafonné par la LARGEUR : 361 × 57,3 — la bande illisible
    // constatée sur appareil. C'est cette valeur-là que le test doit exclure.
    expect(px(w.vm.canvasStyle.height)).toBeGreaterThan(100)
    expect(w.find('.lb__canvas').classes()).toContain('lb__canvas--rot')
    expect(w.find('[data-test="lb-img"]').attributes('data-rotated')).toBe('true')
  })

  it('l’empreinte À L’ÉCRAN une fois pivotée tient dans le viewport et en occupe toute la hauteur', async () => {
    const { w } = await ouvrir({ img: PANORAMA, vp: PORTRAIT })
    // La rotation échange ce qui est vu : l'empreinte fait (hauteur × largeur) de la boîte
    // calculée. C'est cette empreinte-là, pas la boîte de mise en page, qui doit tenir à l'écran.
    const empreinteLargeur = px(w.vm.canvasStyle.height)
    const empreinteHauteur = px(w.vm.canvasStyle.width)
    expect(empreinteLargeur).toBeLessThanOrEqual(PORTRAIT.w)
    expect(empreinteHauteur).toBeLessThanOrEqual(PORTRAIT.h)
    expect(empreinteHauteur).toBeCloseTo(PORTRAIT.h, 1) // toute la hauteur : c'est le but
  })

  it('le zoom fait grandir l’image pivotée exactement comme une image droite', async () => {
    const { w } = await ouvrir({ img: PANORAMA, vp: PORTRAIT })
    w.vm.pz.setZoom(200)
    await w.vm.$nextTick()
    expect(px(w.vm.canvasStyle.width)).toBeCloseTo(1638, 1) // 819 × 2
    expect(px(w.vm.canvasStyle.height)).toBeCloseTo(260.2, 1) // 130,1 × 2
  })
})

describe('visionneuse : rien ne change pour les autres images', () => {
  it('une photo 4:3 dans le même viewport portrait : ni classe, ni axes échangés', async () => {
    const { w } = await ouvrir({ img: { w: 4032, h: 3024 }, vp: PORTRAIT })
    expect(w.vm.rotated).toBe(false)
    expect(w.find('.lb__canvas').classes()).not.toContain('lb__canvas--rot')
    expect(w.find('[data-test="lb-img"]').attributes('data-rotated')).toBe('false')
    // Plafonnée par la largeur du viewport, comme avant ce lot : 361 × 270,75.
    expect(px(w.vm.canvasStyle.width)).toBeCloseTo(361, 1)
    expect(px(w.vm.canvasStyle.height)).toBeCloseTo(270.75, 1)
  })

  it('une photo en hauteur : ni classe, ni axes échangés', async () => {
    const { w } = await ouvrir({ img: { w: 480, h: 888 }, vp: PORTRAIT })
    expect(w.vm.rotated).toBe(false)
    expect(px(w.vm.canvasStyle.width)).toBeCloseTo(361, 1)
    expect(px(w.vm.canvasStyle.height)).toBeCloseTo(667.85, 1) // 888 × (361/480)
  })

  it('image pas encore décodée : jamais de rotation, et le repli habituel', async () => {
    const w = mount(PhotoLightbox, {
      global: { plugins: [createPinia(), i18n] },
      attachTo: document.body,
    })
    const lb = useLightboxStore()
    lb.show(['a.png'], 0)
    await w.vm.$nextTick()
    expect(w.vm.rotated).toBe(false)
    expect(w.vm.canvasStyle).toEqual({ width: '100%', height: '100%' })
  })
})

describe('visionneuse : la rotation suit l’orientation de l’écran, dans les deux sens', () => {
  it('LE MÊME panorama ouvert dans un viewport PAYSAGE n’est pas pivoté', async () => {
    const { w } = await ouvrir({ img: PANORAMA, vp: PAYSAGE })
    expect(w.vm.rotated).toBe(false)
    expect(w.find('.lb__canvas').classes()).not.toContain('lb__canvas--rot')
    expect(px(w.vm.canvasStyle.width)).toBeCloseTo(819, 1) // droit, plafonné par la largeur
    expect(px(w.vm.canvasStyle.height)).toBeCloseTo(130.1, 1)
  })

  it('tourner l’appareil PENDANT que le panorama est ouvert le redresse (portrait → paysage)', async () => {
    // `configChanges` inclut `orientation` dans le manifeste Android : l'app ne se recharge pas,
    // elle se ré-agence. Un critère lu une seule fois à l'ouverture laisserait l'image pivotée
    // dans un viewport devenu paysage — un quart de tour parasite, exactement le défaut à éviter.
    const { w, vpEl } = await ouvrir({ img: PANORAMA, vp: PORTRAIT })
    expect(w.vm.rotated).toBe(true)
    Object.defineProperty(vpEl, 'clientWidth', { value: PAYSAGE.w, configurable: true })
    Object.defineProperty(vpEl, 'clientHeight', { value: PAYSAGE.h, configurable: true })
    window.dispatchEvent(new Event('resize'))
    await w.vm.$nextTick()
    expect(w.vm.rotated).toBe(false)
    expect(w.find('.lb__canvas').classes()).not.toContain('lb__canvas--rot')
  })

  it('et l’inverse : tourner de paysage vers portrait le fait pivoter', async () => {
    const { w, vpEl } = await ouvrir({ img: PANORAMA, vp: PAYSAGE })
    expect(w.vm.rotated).toBe(false)
    Object.defineProperty(vpEl, 'clientWidth', { value: PORTRAIT.w, configurable: true })
    Object.defineProperty(vpEl, 'clientHeight', { value: PORTRAIT.h, configurable: true })
    window.dispatchEvent(new Event('resize'))
    await w.vm.$nextTick()
    expect(w.vm.rotated).toBe(true)
    expect(w.find('.lb__canvas').classes()).toContain('lb__canvas--rot')
  })
})

// ⚠️ LE TEST CENTRAL DU RISQUE. Le lot du 09/08 a payé cher l'exactitude de l'ancrage du zoom :
// la formule `(scrollLeft + ax) * ratio - ax` d'usePinchZoom n'est exacte QUE SI le décalage
// entre l'origine du canvas défilant et l'origine visuelle de l'image reste PROPORTIONNEL au
// zoom. `canvasBoxStyle` (le canvas = le VIEWPORT × zoom) est ce qui garantit cette
// proportionnalité. Si un futur remaniement faisait dépendre le canvas de la rotation — par
// exemple en y échangeant aussi les axes « pour rester cohérent » — la dérive reviendrait sans
// qu'aucun autre test ne la signale.
describe('visionneuse : la rotation ne touche PAS la géométrie qui ancre le zoom', () => {
  it('canvasBoxStyle reste le viewport × zoom, pivoté comme droit', async () => {
    const pivote = await ouvrir({ img: PANORAMA, vp: PORTRAIT })
    const droit = await ouvrir({ img: { w: 4032, h: 3024 }, vp: PORTRAIT })
    expect(pivote.w.vm.rotated).toBe(true)
    expect(droit.w.vm.rotated).toBe(false)
    // Même viewport, deux images très différentes : le canvas est le MÊME. Il suit le viewport,
    // jamais l'image ni son orientation.
    expect(pivote.w.vm.canvasBoxStyle).toEqual({ width: '361px', height: '819px' })
    expect(pivote.w.vm.canvasBoxStyle).toEqual(droit.w.vm.canvasBoxStyle)

    pivote.w.vm.pz.setZoom(250)
    await pivote.w.vm.$nextTick()
    expect(pivote.w.vm.canvasBoxStyle).toEqual({ width: '902.5px', height: '2047.5px' })
  })

  it('l’empreinte pivotée reste centrée dans le canvas, PROPORTIONNELLEMENT au zoom', async () => {
    // La propriété exacte dont dépend l'ancrage : le décalage entre l'origine du canvas et
    // l'empreinte de l'image vaut k × zoom, avec k constant. On le mesure à deux zooms.
    const { w } = await ouvrir({ img: PANORAMA, vp: PORTRAIT })
    const decalage = () => {
      const canvasW = px(w.vm.canvasBoxStyle.width)
      const canvasH = px(w.vm.canvasBoxStyle.height)
      // Empreinte = (hauteur × largeur) de la boîte calculée : la rotation échange ce qui est vu.
      const empW = px(w.vm.canvasStyle.height)
      const empH = px(w.vm.canvasStyle.width)
      return { x: (canvasW - empW) / 2, y: (canvasH - empH) / 2 }
    }
    const d100 = decalage()
    w.vm.pz.setZoom(300)
    await w.vm.$nextTick()
    const d300 = decalage()
    expect(d300.x).toBeCloseTo(d100.x * 3, 6)
    expect(d300.y).toBeCloseTo(d100.y * 3, 6)
  })

  it('l’empreinte pivotée ne déborde JAMAIS du canvas, à aucun zoom', async () => {
    // Le canvas est le contenu défilant : ce qui en dépasse est inatteignable au déplacement.
    // Si un remaniement faisait grandir l'empreinte plus vite que le canvas, une part de la
    // capture deviendrait invisible en silence, à fort zoom seulement.
    const { w } = await ouvrir({ img: PANORAMA, vp: PORTRAIT })
    for (const z of [100, 137, 250, 500]) {
      w.vm.pz.setZoom(z)
      await w.vm.$nextTick()
      expect(px(w.vm.canvasStyle.height), `empreinte trop large à ${z} %`).toBeLessThanOrEqual(
        px(w.vm.canvasBoxStyle.width) + 0.001,
      )
      expect(px(w.vm.canvasStyle.width), `empreinte trop haute à ${z} %`).toBeLessThanOrEqual(
        px(w.vm.canvasBoxStyle.height) + 0.001,
      )
    }
  })
})

// Le geste et la fermeture doivent survivre à la rotation : la visionneuse est partagée par
// quatre écrans appelants et le guide ouvre trois figures d'affilée.
describe('visionneuse pivotée : le geste et la fermeture marchent toujours', () => {
  it('le pincement passe par les événements du DOM et fait monter le zoom', async () => {
    const { w } = await ouvrir({ img: PANORAMA, vp: PORTRAIT })
    const vp = w.find('.lb__viewport')
    const firePointer = (type, props) => {
      const ev = new Event(type, { bubbles: true })
      Object.assign(ev, props)
      vp.element.dispatchEvent(ev)
    }
    firePointer('pointerdown', { pointerId: 1, clientX: 150, clientY: 300 })
    firePointer('pointerdown', { pointerId: 2, clientX: 250, clientY: 300 })
    await w.vm.$nextTick()
    firePointer('pointermove', { pointerId: 1, clientX: 100, clientY: 300 })
    firePointer('pointermove', { pointerId: 2, clientX: 300, clientY: 300 })
    await w.vm.$nextTick()
    expect(w.vm.pz.zoom.value).toBeGreaterThan(100)
    expect(w.vm.rotated).toBe(true) // toujours pivotée pendant le zoom
  })

  it('le tap sur le fond ferme, et le bouton × aussi', async () => {
    const { w, lb } = await ouvrir({ img: PANORAMA, vp: PORTRAIT })
    await w.find('.lb').trigger('click')
    expect(lb.open).toBe(false)

    lb.show(['a.png', 'b.png'], 0)
    await w.vm.$nextTick()
    await w.find('.lb__close').trigger('click')
    expect(lb.open).toBe(false)
  })

  it('la touche Échap ferme', async () => {
    const { w, lb } = await ouvrir({ img: PANORAMA, vp: PORTRAIT })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(lb.open).toBe(false)
  })

  it('le balayage change encore de figure (le guide en ouvre trois d’affilée)', async () => {
    const { w, lb } = await ouvrir({ img: PANORAMA, vp: PORTRAIT })
    const img = w.find('[data-test="lb-img"]')
    await img.trigger('touchstart', { touches: [{ clientX: 200, clientY: 300 }] })
    await img.trigger('touchend', { changedTouches: [{ clientX: 80, clientY: 300 }] })
    expect(lb.index).toBe(1)
  })

  it('le chevron suivant change encore de figure', async () => {
    const { w, lb } = await ouvrir({ img: PANORAMA, vp: PORTRAIT })
    await w.find('.lb__nav--next').trigger('click')
    expect(lb.index).toBe(1)
  })
})

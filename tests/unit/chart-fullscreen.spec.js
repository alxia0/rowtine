import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import i18n from '@/i18n'
import ChartFullscreen from '@/components/ChartFullscreen.vue'
import { useChartZoomStore } from '@/stores/chart-zoom'

let pinia
const wrappers = []
// `attachTo: document.body` : indispensable pour les tests de focus ci-dessous — en jsdom,
// .focus()/document.activeElement sont des no-op sur un arbre non attaché au vrai document
// (cf. ReaderView.spec.js / confirm-dialog.spec.js, même motif). `wrappers` + afterEach :
// démonte chaque instance pour ne pas laisser d'anciens dialogues attachés au body réel.
function mountFs() {
  const w = mount(ChartFullscreen, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
  wrappers.push(w)
  return w
}
function openWith(extra = {}) {
  const s = useChartZoomStore()
  s.show({ chart: { rows: 50, cols: 132, img: 'g.png', repeat: '132 m × 50 rangs', reps: 3 }, row: 3, rep: 1, frame: null, readOnly: false, ...extra })
  return s
}
// Reflet exact de la valeur `left` inline de `.cfs__curtain-line` (résidu marge
// d'encoche) : le pourcentage brut est borné par un clamp() en pixels (demi-largeur de
// `.cfs__curtain-grip`, --cfs-grip-w) pour que la poignée ne déborde plus aux positions
// extrêmes 0 %/100 % — seul le rendu est borné, `curtain.x` en donnée reste 0..100.
const curtainLineLeft = (pct) => `left: clamp(calc(var(--cfs-grip-w) / 2), ${pct}%, calc(100% - var(--cfs-grip-w) / 2))`

describe('ChartFullscreen', () => {
  beforeEach(() => { pinia = createPinia(); setActivePinia(pinia) })
  afterEach(() => { while (wrappers.length) wrappers.pop().unmount() })

  it('fermé par défaut ; show → dialog visible avec l’image', async () => {
    const w = mountFs()
    expect(w.find('.cfs').exists()).toBe(false)
    openWith()
    await w.vm.$nextTick()
    expect(w.find('.cfs').exists()).toBe(true)
    expect(w.find('.cfs__canvas img').attributes('src')).toBe('g.png')
  })

  it('bouton × ferme via le store', async () => {
    const w = mountFs()
    const s = openWith()
    await w.vm.$nextTick()
    await w.find('.cfs__close').trigger('click')
    expect(s.open).toBe(false)
  })

  it('grille importée sans rangs (rows:0) : pas de compteur « 1/0 » ni de bandes ; invite affichée ; image visible', async () => {
    const w = mountFs()
    const s = useChartZoomStore()
    s.show({ chart: { rows: 0, cols: 0, img: 'g.png', repeat: '', reps: 0 }, row: 1, rep: 1, frame: null, readOnly: false })
    await w.vm.$nextTick()
    expect(w.find('.cfs__rowbar').exists()).toBe(false) // pas de « 1 / 0 »
    expect(w.find('.cfs__hl').exists()).toBe(false) // pas de bande de surlignage
    expect(w.find('.cfs__norows').exists()).toBe(true) // invite « rangs non renseignés »
    expect(w.find('.cfs__canvas img').attributes('src')).toBe('g.png') // image toujours là
  })

  it('zoom + : la largeur du canvas passe de 100% à 150% (bornée à 500)', async () => {
    const w = mountFs()
    openWith()
    await w.vm.$nextTick()
    expect(w.find('.cfs__canvas').attributes('style')).toContain('width: 100%')
    await w.find('.cfs__zoomin').trigger('click')
    expect(w.find('.cfs__canvas').attributes('style')).toContain('width: 150%')
    for (let i = 0; i < 10; i++) await w.find('.cfs__zoomin').trigger('click')
    expect(w.find('.cfs__canvas').attributes('style')).toContain('width: 500%')
  })

  it('double-tap bascule 100% ↔ 250%', async () => {
    const w = mountFs()
    openWith()
    await w.vm.$nextTick()
    const vp = w.find('.cfs__viewport')
    await vp.trigger('pointerup', { pointerId: 1 })
    await vp.trigger('pointerup', { pointerId: 1 }) // 2e tap < 300 ms simulé (le composant compare des timestamps injectables via now())
    expect(w.find('.cfs__canvas').attributes('style')).toContain('width: 250%')
  })

  it('relâcher un pinch (2 pointerup rapprochés) ne déclenche PAS le double-tap', async () => {
    const w = mountFs()
    openWith()
    await w.vm.$nextTick()
    const vp = w.find('.cfs__viewport')
    const el = vp.element
    // pinch : 2 doigts posés puis relevés coup sur coup
    const evt1Down = new PointerEvent('pointerdown', { pointerId: 1, bubbles: true })
    const evt2Down = new PointerEvent('pointerdown', { pointerId: 2, bubbles: true })
    const evt1Up = new PointerEvent('pointerup', { pointerId: 1, bubbles: true })
    const evt2Up = new PointerEvent('pointerup', { pointerId: 2, bubbles: true })
    el.dispatchEvent(evt1Down)
    el.dispatchEvent(evt2Down)
    el.dispatchEvent(evt1Up)
    el.dispatchEvent(evt2Up)
    await w.vm.$nextTick()
    // la largeur ne doit PAS avoir basculé en 250 % (double-tap fantôme)
    expect(w.find('.cfs__canvas').attributes('style')).toContain('width: 100%')
    // un tap simple juste après le pinch ne doit PAS compléter un double-tap fantôme
    await vp.trigger('pointerup', { pointerId: 3 })
    expect(w.find('.cfs__canvas').attributes('style')).toContain('width: 100%')
    // puis un vrai double-tap (2 taps rapprochés) fonctionne toujours
    await vp.trigger('pointerup', { pointerId: 4 })
    await vp.trigger('pointerup', { pointerId: 4 })
    await w.vm.$nextTick()
    expect(w.find('.cfs__canvas').attributes('style')).toContain('width: 250%')
  })

  it('rang + : avance, notifie onRow, et roll-over répétition au dernier rang', async () => {
    const onRow = vi.fn()
    const onRep = vi.fn()
    const w = mountFs()
    openWith({ row: 50, rep: 1, onRow, onRep })
    await w.vm.$nextTick()
    await w.find('.cfs__next').trigger('click')
    expect(onRow).toHaveBeenCalledWith(1)
    expect(onRep).toHaveBeenCalledWith(2)
    expect(w.find('.cfs__rowval').text()).toBe('1 / 50')
    expect(w.find('.cfs__repval').text()).toBe('2 / 3')
  })

  it('read-only : ni barre de suivi ni surlignage', async () => {
    const w = mountFs()
    openWith({ readOnly: true })
    await w.vm.$nextTick()
    expect(w.find('.cfs__rowbar').exists()).toBe(false)
    expect(w.find('.cfs__hl').exists()).toBe(false)
  })

  it('mode caler : drag de la poignée haute → onFrame au save (bornes et top<bottom-5 respectés)', async () => {
    const onFrame = vi.fn()
    const w = mountFs()
    openWith({ onFrame })
    await w.vm.$nextTick()
    await w.find('.cfs__cal').trigger('click')
    const top = w.find('.cfs__handle--top')
    expect(top.exists()).toBe(true)
    // geometry jsdom : mock du rect du canvas (600 px de haut)
    w.find('.cfs__canvas').element.getBoundingClientRect = () => ({ top: 0, height: 600, left: 0, width: 400 })
    // dispatchEvent direct (pas trigger()) : bug connu vue-test-utils 2.4.11/jsdom où
    // clientY (défini sur MouseEvent.prototype, hérité par PointerEvent) est vu comme
    // assignable par erreur puis lève « has only a getter » — même contournement que
    // le test « relâcher un pinch » plus haut dans ce fichier.
    top.element.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, clientY: 0, bubbles: true }))
    top.element.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientY: 60, bubbles: true })) // 60/600 = 10 %
    top.element.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, bubbles: true }))
    await w.vm.$nextTick()
    await w.find('.cfs__calsave').trigger('click')
    expect(onFrame).toHaveBeenCalledWith({ top: 10, bottom: 100 })
  })

  it('mode caler : annuler ne notifie pas, réinitialiser envoie null', async () => {
    const onFrame = vi.fn()
    const w = mountFs()
    openWith({ frame: { top: 5, bottom: 95 }, onFrame })
    await w.vm.$nextTick()
    await w.find('.cfs__cal').trigger('click')
    await w.find('.cfs__calcancel').trigger('click')
    expect(onFrame).not.toHaveBeenCalled()
    await w.find('.cfs__cal').trigger('click')
    await w.find('.cfs__calreset').trigger('click')
    expect(onFrame).toHaveBeenCalledWith(null)
  })

  it('read-only : pas de bouton caler', async () => {
    const w = mountFs()
    openWith({ readOnly: true })
    await w.vm.$nextTick()
    expect(w.find('.cfs__cal').exists()).toBe(false)
  })

  it('mode caler : bande « done » masquée et bande « hl » en mode discret (pas de bordures concurrentes)', async () => {
    const w = mountFs()
    openWith()
    await w.vm.$nextTick()
    await w.find('.cfs__cal').trigger('click')
    expect(w.find('.cfs__done').exists()).toBe(false)
    expect(w.find('.cfs__hl').classes()).toContain('cfs__hl--calibrating')
  })

  it('mode caler : les poignées portent une pilule de préhension avec étiquette', async () => {
    const w = mountFs()
    openWith()
    await w.vm.$nextTick()
    await w.find('.cfs__cal').trigger('click')
    const grip = w.find('.cfs__handle--top .cfs__grip')
    expect(grip.exists()).toBe(true)
    expect(grip.text()).toContain('Haut du quadrillage')
  })

  it('relâcher deux poignées de calage coup sur coup ne déclenche PAS le double-tap du viewport', async () => {
    const w = mountFs()
    openWith()
    await w.vm.$nextTick()
    await w.find('.cfs__cal').trigger('click')
    w.find('.cfs__canvas').element.getBoundingClientRect = () => ({ top: 0, height: 600, left: 0, width: 400 })
    const top = w.find('.cfs__handle--top').element
    const bottom = w.find('.cfs__handle--bottom').element
    top.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 11, clientY: 0, bubbles: true }))
    top.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11, clientY: 0, bubbles: true }))
    bottom.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 12, clientY: 600, bubbles: true }))
    bottom.dispatchEvent(new PointerEvent('pointerup', { pointerId: 12, clientY: 600, bubbles: true }))
    await w.vm.$nextTick()
    expect(w.find('.cfs__canvas').attributes('style')).toContain('width: 100%')
  })

  // ─── A11y clavier des poignées + garde anti-zoom + focus ────────────

  it('poignée clavier : tabindex=0, ArrowDown/ArrowUp modifient draft.top d’un pas (borné à bottom-5)', async () => {
    const w = mountFs()
    openWith()
    await w.vm.$nextTick()
    await w.find('.cfs__cal').trigger('click')
    const top = w.find('.cfs__handle--top')
    expect(top.attributes('tabindex')).toBe('0')
    expect(top.attributes('aria-valuenow')).toBe('0') // frame null → draft initial {top:0, bottom:100}
    await top.trigger('keydown', { key: 'ArrowDown' })
    expect(top.attributes('aria-valuenow')).toBe('1')
    await top.trigger('keydown', { key: 'ArrowUp' })
    expect(top.attributes('aria-valuenow')).toBe('0')
    // borne : ne dépasse jamais bottom - 5 (bottom = 100 ici → plafond 95)
    for (let i = 0; i < 200; i++) await top.trigger('keydown', { key: 'ArrowDown' })
    expect(Number(top.attributes('aria-valuenow'))).toBeLessThanOrEqual(95)
    // borne basse : ArrowUp répété ne descend jamais sous 0
    for (let i = 0; i < 200; i++) await top.trigger('keydown', { key: 'ArrowUp' })
    expect(Number(top.attributes('aria-valuenow'))).toBe(0)
  })

  it('poignée clavier : tabindex=0 sur la poignée basse, ArrowUp la fait monter (borné à top+5)', async () => {
    const w = mountFs()
    openWith()
    await w.vm.$nextTick()
    await w.find('.cfs__cal').trigger('click')
    const bottom = w.find('.cfs__handle--bottom')
    expect(bottom.attributes('tabindex')).toBe('0')
    expect(bottom.attributes('aria-valuenow')).toBe('100')
    await bottom.trigger('keydown', { key: 'ArrowUp' })
    expect(bottom.attributes('aria-valuenow')).toBe('99')
    await bottom.trigger('keydown', { key: 'ArrowDown' })
    expect(bottom.attributes('aria-valuenow')).toBe('100')
    for (let i = 0; i < 200; i++) await bottom.trigger('keydown', { key: 'ArrowUp' })
    expect(Number(bottom.attributes('aria-valuenow'))).toBeGreaterThanOrEqual(5) // top(0) + 5
  })

  it('poignées de calage : role=slider vertical (aria-orientation) pour un lecteur d’écran', async () => {
    const w = mountFs()
    openWith()
    await w.vm.$nextTick()
    await w.find('.cfs__cal').trigger('click')
    const top = w.find('.cfs__handle--top')
    const bottom = w.find('.cfs__handle--bottom')
    expect(top.attributes('role')).toBe('slider')
    expect(top.attributes('aria-orientation')).toBe('vertical')
    expect(bottom.attributes('role')).toBe('slider')
    expect(bottom.attributes('aria-orientation')).toBe('vertical')
  })

  it('pan rapide (mouvement > seuil) puis tap proche ne bascule PAS le double-tap', async () => {
    const w = mountFs()
    openWith()
    await w.vm.$nextTick()
    const el = w.find('.cfs__viewport').element
    const fire = (type, opts) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, ...opts }))
    // geste 1 : down à (0,0) puis up loin à (60,0) en < 300 ms → un PAN, pas un tap
    fire('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 })
    fire('pointerup', { pointerId: 1, clientX: 60, clientY: 0 })
    // geste 2 : tap seul, proche du point d'arrivée du pan, juste après → ne doit rien basculer
    fire('pointerdown', { pointerId: 2, clientX: 62, clientY: 0 })
    fire('pointerup', { pointerId: 2, clientX: 62, clientY: 0 })
    await w.vm.$nextTick()
    expect(w.find('.cfs__canvas').attributes('style')).toContain('width: 100%')
  })

  it('vrai double-tap (deux taps proches, mouvement minime) zoome toujours malgré la garde', async () => {
    const w = mountFs()
    openWith()
    await w.vm.$nextTick()
    const el = w.find('.cfs__viewport').element
    const fire = (type, opts) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, ...opts }))
    fire('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 })
    fire('pointerup', { pointerId: 1, clientX: 11, clientY: 10 }) // 1 px de tremblement, sous le seuil
    fire('pointerdown', { pointerId: 2, clientX: 13, clientY: 11 })
    fire('pointerup', { pointerId: 2, clientX: 13, clientY: 11 })
    await w.vm.$nextTick()
    expect(w.find('.cfs__canvas').attributes('style')).toContain('width: 250%')
  })

  it('focus initial : à l’ouverture, le focus est dans le dialog (pas resté à l’extérieur)', async () => {
    const outside = document.createElement('button')
    outside.textContent = 'dehors'
    document.body.appendChild(outside)
    outside.focus()
    expect(document.activeElement).toBe(outside)
    const w = mountFs()
    openWith()
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0)) // laisse l'await nextTick() interne du watch se résoudre
    expect(w.element.contains(document.activeElement)).toBe(true)
    outside.remove()
  })

  it('piège de focus : Tab depuis le dernier focusable boucle au premier, Shift+Tab l’inverse', async () => {
    const w = mountFs()
    openWith() // row:3, rep:1 → .cfs__prev n'est PAS désactivé (row>1)
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))
    const dialog = w.find('.cfs')
    const first = w.find('.cfs__cal').element // 1er bouton de la barre
    const last = w.find('.cfs__flip').element // dernier focusable de la barre de suivi (bouton bascule rideau)
    last.focus()
    expect(document.activeElement).toBe(last)
    await dialog.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    first.focus()
    await dialog.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('fermeture : le focus revient à l’élément précédemment focalisé', async () => {
    const outside = document.createElement('button')
    outside.textContent = 'dehors'
    document.body.appendChild(outside)
    outside.focus()
    const w = mountFs()
    const s = openWith()
    await w.vm.$nextTick()
    await new Promise((r) => setTimeout(r, 0))
    expect(w.element.contains(document.activeElement)).toBe(true) // focus bien entré dans le dialog
    s.close()
    await w.vm.$nextTick()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  describe('ChartFullscreen — rideau de progression', () => {
    it('positionné d’après le curtain fourni (teinte + ligne alignées sur x)', async () => {
      const w = mountFs()
      openWith({ curtain: { x: 25, side: 'right' } })
      await w.vm.$nextTick()
      expect(w.find('.cfs__curtain').attributes('style')).toContain('left: 25%')
      expect(w.find('.cfs__curtain').attributes('style')).toContain('width: 75%')
      expect(w.find('.cfs__curtain-line').attributes('style')).toContain(curtainLineLeft(25))
    })

    it('curtain non fourni : rétracté par défaut (rien de teinté, ligne à 100%)', async () => {
      const w = mountFs()
      openWith()
      await w.vm.$nextTick()
      expect(w.find('.cfs__curtain').attributes('style')).toContain('width: 0%')
      expect(w.find('.cfs__curtain-line').attributes('style')).toContain(curtainLineLeft(100))
    })

    it('absent en mode calage (pas de concurrence avec les poignées)', async () => {
      const w = mountFs()
      openWith()
      await w.vm.$nextTick()
      await w.find('.cfs__cal').trigger('click')
      expect(w.find('.cfs__curtain-line').exists()).toBe(false)
    })

    it('absent si la grille n’a pas de rangs connus (rows:0)', async () => {
      const w = mountFs()
      const s = useChartZoomStore()
      s.show({ chart: { rows: 0, cols: 0, img: 'g.png', repeat: '', reps: 0 }, row: 1, rep: 1, frame: null, curtain: null, readOnly: false })
      await w.vm.$nextTick()
      expect(w.find('.cfs__curtain-line').exists()).toBe(false)
    })

    it('absent en lecture seule', async () => {
      const w = mountFs()
      openWith({ readOnly: true })
      await w.vm.$nextTick()
      expect(w.find('.cfs__curtain-line').exists()).toBe(false)
    })

    // Non-régression (piège trouvé en revue) : ouvrir sur un rang déjà avancé avec
    // un rideau non rétracté ne doit PAS le rétracter au montage — la rétractation vient
    // uniquement de l'action de changement de rang (`setChartRow`), jamais d'un watch
    // réactif sur le rang initialisé à l'ouverture. Un mutant qui ajouterait
    // `watch(row, () => curtain.value = retractCurtain(...))` doit faire échouer ce test.
    it('ouverture sur un rang avancé avec rideau non rétracté : position conservée telle quelle', async () => {
      const w = mountFs()
      openWith({ row: 5, curtain: { x: 40, side: 'right' } })
      await w.vm.$nextTick()
      expect(w.find('.cfs__curtain-line').attributes('style')).toContain(curtainLineLeft(40))
    })

    // Non-régression (bug trouvé en revue finale du lot) : `step()` (bouton +/− de rang)
    // met à jour le rang PARTOUT (local + store via onRow → setChartRow, qui rétracte déjà
    // sa propre copie), mais oubliait de rétracter la ref locale `curtain` qui pilote
    // l'affichage — le rideau restait visuellement figé sur l'ancien rang tant que la vue
    // plein écran n'était pas refermée/rouverte. Pas d'`onRow` fourni ici : isole le
    // comportement local, seule la correction dans `step()` peut faire passer ce test.
    it('avancer d’un rang (bouton +) rétracte visuellement le rideau resté non rétracté', async () => {
      const w = mountFs()
      openWith({ curtain: { x: 40, side: 'right' } })
      await w.vm.$nextTick()
      expect(w.find('.cfs__curtain-line').attributes('style')).toContain(curtainLineLeft(40))
      await w.find('.cfs__next').trigger('click')
      expect(w.find('.cfs__curtain-line').attributes('style')).toContain(curtainLineLeft(100))
    })

    it('glisser la ligne déplace x et notifie onCurtain au relâché (pas avant)', async () => {
      const onCurtain = vi.fn()
      const w = mountFs()
      openWith({ onCurtain, curtain: { x: 10, side: 'right' } })
      await w.vm.$nextTick()
      w.find('.cfs__canvas').element.getBoundingClientRect = () => ({ top: 0, height: 600, left: 0, width: 400 })
      const line = w.find('.cfs__curtain-line').element
      line.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 5, clientX: 40, bubbles: true }))
      line.dispatchEvent(new PointerEvent('pointermove', { pointerId: 5, clientX: 200, bubbles: true })) // 200/400 = 50 %
      expect(onCurtain).not.toHaveBeenCalled() // pas de notification pendant le drag
      line.dispatchEvent(new PointerEvent('pointerup', { pointerId: 5, bubbles: true }))
      expect(onCurtain).toHaveBeenCalledWith({ x: 50, side: 'right' })
    })

    // Le pincement à deux doigts doit continuer à fonctionner même quand l'un des deux doigts
    // touche la ligne du rideau — pas de `.stop` ici (contrairement au calage), donc ce
    // pointerdown/move doit aussi atteindre le viewport (bubbling naturel). Preuve : après
    // l'arrivée du 2e doigt, la largeur du canvas change bien (le pincement du viewport a pris
    // la main), et le rideau n'a PAS notifié — il a cédé plutôt que d'interférer.
    it('un 2e doigt qui se pose pendant le drag cède au pincement du viewport (pas de notification)', async () => {
      const onCurtain = vi.fn()
      const w = mountFs()
      openWith({ onCurtain, curtain: { x: 10, side: 'right' } })
      await w.vm.$nextTick()
      w.find('.cfs__canvas').element.getBoundingClientRect = () => ({ top: 0, height: 600, left: 0, width: 400 })
      const line = w.find('.cfs__curtain-line').element
      const viewport = w.find('.cfs__viewport').element
      line.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 40, bubbles: true }))
      line.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 100, bubbles: true }))
      // 2e doigt posé ailleurs sur le viewport → le pincement démarre côté viewport
      viewport.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientX: 300, clientY: 50, bubbles: true }))
      // le doigt 1 continue de bouger : doit maintenant nourrir le pincement, pas le rideau
      line.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 150, bubbles: true }))
      line.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))
      viewport.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, bubbles: true }))
      expect(onCurtain).not.toHaveBeenCalled()
    })

    it('doigt déjà posé ailleurs : un pointerdown sur la ligne ne démarre pas de drag (2e doigt d’un pincement)', async () => {
      const onCurtain = vi.fn()
      const w = mountFs()
      openWith({ onCurtain, curtain: { x: 10, side: 'right' } })
      await w.vm.$nextTick()
      w.find('.cfs__canvas').element.getBoundingClientRect = () => ({ top: 0, height: 600, left: 0, width: 400 })
      const viewport = w.find('.cfs__viewport').element
      const line = w.find('.cfs__curtain-line').element
      viewport.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 300, clientY: 50, bubbles: true }))
      line.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientX: 40, bubbles: true }))
      line.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 200, bubbles: true }))
      line.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, bubbles: true }))
      expect(onCurtain).not.toHaveBeenCalled()
    })

    it('flèche droite au clavier avance x de 1 point et notifie immédiatement', async () => {
      const onCurtain = vi.fn()
      const w = mountFs()
      openWith({ onCurtain, curtain: { x: 50, side: 'right' } })
      await w.vm.$nextTick()
      await w.find('.cfs__curtain-line').trigger('keydown', { key: 'ArrowRight' })
      expect(onCurtain).toHaveBeenCalledWith({ x: 51, side: 'right' })
    })

    it('flèche gauche + shift recule x de 5 points', async () => {
      const onCurtain = vi.fn()
      const w = mountFs()
      openWith({ onCurtain, curtain: { x: 50, side: 'right' } })
      await w.vm.$nextTick()
      await w.find('.cfs__curtain-line').trigger('keydown', { key: 'ArrowLeft', shiftKey: true })
      expect(onCurtain).toHaveBeenCalledWith({ x: 45, side: 'right' })
    })

    // Résidu (marge d'encoche) : le `left` rendu est borné en pixels (clamp calé sur
    // la demi-largeur de la poignée) pour que celle-ci ne déborde plus en butée, mais la
    // valeur STOCKÉE (`curtain.x`, notifiée à `onCurtain`) doit toujours pouvoir atteindre les
    // bornes réelles 0 et 100 — seul le rendu est borné, pas la donnée. `aria-valuenow` reflète
    // aussi la donnée non bornée.
    it('poussé à fond dans chaque sens, le rideau notifie x:0 et x:100 en donnée (seul le rendu est borné)', async () => {
      const onCurtain = vi.fn()
      const w = mountFs()
      openWith({ onCurtain, curtain: { x: 50, side: 'right' } })
      await w.vm.$nextTick()
      const line = w.find('.cfs__curtain-line')
      for (let i = 0; i < 10; i++) await line.trigger('keydown', { key: 'ArrowLeft', shiftKey: true })
      expect(onCurtain).toHaveBeenCalledWith({ x: 0, side: 'right' })
      expect(w.find('.cfs__curtain-line').attributes('aria-valuenow')).toBe('0')
      expect(w.find('.cfs__curtain-line').attributes('style')).toContain(curtainLineLeft(0))
      for (let i = 0; i < 20; i++) await line.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
      expect(onCurtain).toHaveBeenCalledWith({ x: 100, side: 'right' })
      expect(w.find('.cfs__curtain-line').attributes('aria-valuenow')).toBe('100')
      expect(w.find('.cfs__curtain-line').attributes('style')).toContain(curtainLineLeft(100))
    })

    it('bouton bascule inverse le côté ET rétracte, notifie onCurtain', async () => {
      const onCurtain = vi.fn()
      const w = mountFs()
      openWith({ onCurtain, curtain: { x: 40, side: 'right' } })
      await w.vm.$nextTick()
      await w.find('.cfs__flip').trigger('click')
      expect(onCurtain).toHaveBeenCalledWith({ x: 0, side: 'left' })
    })

    it('bouton bascule absent en mode calage (dans la barre de rang, masquée pendant le calage)', async () => {
      const w = mountFs()
      openWith()
      await w.vm.$nextTick()
      await w.find('.cfs__cal').trigger('click')
      expect(w.find('.cfs__flip').exists()).toBe(false)
    })
  })
})

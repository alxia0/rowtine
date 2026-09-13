// Unitaire — le geste de zoom partagé (lot du 09/08/2026).
//
// Cette mécanique vivait dans ChartStage.vue et n'avait AUCUN test unitaire : le pincement,
// le double-tap et leurs deux gardes de terrain n'étaient prouvés que par l'usage sur
// appareil. L'extraire pour la partager avec la visionneuse photo est l'occasion de les
// épingler — et la condition pour que la tâche suivante puisse distinguer un défaut
// d'extraction d'un défaut de branchement.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePinchZoom } from '@/composables/usePinchZoom'

// Faux viewport : le composable ne lit que ces quatre propriétés et
// `getBoundingClientRect`. jsdom ne calcule aucune mise en page, on les pose donc à la main.
function fakeViewport() {
  return {
    clientWidth: 400,
    clientHeight: 600,
    scrollLeft: 0,
    scrollTop: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }),
  }
}

// `setZoom` règle le défilement dans un requestAnimationFrame (pour laisser le rendu
// s'appliquer d'abord) : en test, on le rend synchrone.
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 0 })
})

const ptr = (id, x, y) => ({ pointerId: id, clientX: x, clientY: y, preventDefault: () => {} })

describe('usePinchZoom — le pincement', () => {
  it('deux doigts qui s\'écartent du double doublent le zoom', () => {
    const vp = fakeViewport()
    const z = usePinchZoom({ getViewport: () => vp })
    z.onPointerDown(ptr(1, 100, 300))
    z.onPointerDown(ptr(2, 200, 300)) // distance 100
    z.onPointerMove(ptr(2, 300, 300)) // distance 200 → ×2
    expect(z.zoom.value).toBe(200)
  })

  it('ne descend jamais sous 100 ni au-dessus de 500', () => {
    const vp = fakeViewport()
    const z = usePinchZoom({ getViewport: () => vp })
    z.setZoom(10)
    expect(z.zoom.value).toBe(100)
    z.setZoom(9999)
    expect(z.zoom.value).toBe(500)
  })

  it('isZoomed suit le zoom', () => {
    const z = usePinchZoom({ getViewport: () => fakeViewport() })
    expect(z.isZoomed.value).toBe(false)
    z.setZoom(250)
    expect(z.isZoomed.value).toBe(true)
    z.reset()
    expect(z.isZoomed.value).toBe(false)
  })

  // Le point pincé doit rester sous les doigts : sans cela, zoomer fait « fuir » le détail
  // qu'on regarde. La formule d'ancrage vient de ChartStage, elle est reprise telle quelle.
  it('garde le point d\'ancrage stable (le défilement suit le facteur)', () => {
    const vp = fakeViewport()
    vp.scrollLeft = 0
    vp.scrollTop = 0
    const z = usePinchZoom({ getViewport: () => vp })
    z.setZoom(200, 100, 200) // ratio 2 depuis 100
    // cx = (0 + 100) * 2 - 100 = 100 ; cy = (0 + 200) * 2 - 200 = 200
    expect(vp.scrollLeft).toBe(100)
    expect(vp.scrollTop).toBe(200)
  })

  it('reset ramène à 100 et remet le défilement en haut à gauche', () => {
    const vp = fakeViewport()
    const z = usePinchZoom({ getViewport: () => vp })
    z.setZoom(300)
    vp.scrollLeft = 120
    vp.scrollTop = 80
    z.reset()
    expect(z.zoom.value).toBe(100)
    expect(vp.scrollLeft).toBe(0)
    expect(vp.scrollTop).toBe(0)
  })
})

describe('usePinchZoom — le double-tap et ses gardes', () => {
  it('deux taps rapides au même endroit basculent 100 ↔ 250', () => {
    const vp = fakeViewport()
    const z = usePinchZoom({ getViewport: () => vp })
    z.onPointerDown(ptr(1, 200, 300))
    z.onPointerUp(ptr(1, 200, 300))
    z.onPointerDown(ptr(1, 200, 300))
    z.onPointerUp(ptr(1, 200, 300))
    expect(z.zoom.value).toBe(250)
    // et retour
    z.onPointerDown(ptr(1, 200, 300))
    z.onPointerUp(ptr(1, 200, 300))
    z.onPointerDown(ptr(1, 200, 300))
    z.onPointerUp(ptr(1, 200, 300))
    expect(z.zoom.value).toBe(100)
  })

  it('deux taps trop espacés dans le TEMPS ne basculent pas', () => {
    vi.useFakeTimers()
    const z = usePinchZoom({ getViewport: () => fakeViewport() })
    z.onPointerDown(ptr(1, 200, 300))
    z.onPointerUp(ptr(1, 200, 300))
    vi.advanceTimersByTime(400) // > 300 ms
    z.onPointerDown(ptr(1, 200, 300))
    z.onPointerUp(ptr(1, 200, 300))
    expect(z.zoom.value).toBe(100)
    vi.useRealTimers()
  })

  it('deux taps éloignés dans l\'ESPACE ne basculent pas', () => {
    const z = usePinchZoom({ getViewport: () => fakeViewport() })
    z.onPointerDown(ptr(1, 50, 50))
    z.onPointerUp(ptr(1, 50, 50))
    z.onPointerDown(ptr(1, 300, 400)) // > 44 px du précédent
    z.onPointerUp(ptr(1, 300, 400))
    expect(z.zoom.value).toBe(100)
  })

  // GARDE DE TERRAIN n°1 (dans ChartStage) : un déplacement rapide suivi d'un tap
  // ne doit pas être lu comme un double-tap. Sans elle, se déplacer dans l'image déclenchait
  // des zooms fantômes.
  it('un DÉPLACEMENT suivi d\'un tap ne fait pas de double-tap', () => {
    const z = usePinchZoom({ getViewport: () => fakeViewport() })
    z.onPointerDown(ptr(1, 100, 300))
    z.onPointerUp(ptr(1, 180, 300)) // 80 px > TAP_MOVE_MAX → c'est un déplacement
    z.onPointerDown(ptr(1, 180, 300))
    z.onPointerUp(ptr(1, 180, 300))
    expect(z.zoom.value).toBe(100)
  })

  // GARDE DE TERRAIN n°2 : les relâchements d'une séquence à deux doigts sont TOUS ignorés,
  // y compris le dernier. Sans elle, la fin d'un pincement amorçait une séquence de tap.
  //
  // Le doigt 2 relâche EN PREMIER (pas le doigt 1) : `downX/downY` ne sont posés que pour le
  // premier doigt de la séquence (celui qui fait passer `pointers.size` à 1), donc le
  // relâchement du doigt 2 est loin de son point de départ partagé (`moved` grand) et sa
  // propre garde de déplacement suffirait à le neutraliser — il ne teste rien sur
  // `wasMultiTouch`. C'est le DERNIER relâchement (celui du doigt 1) qui doit revenir
  // EXACTEMENT sur le point de départ du premier doigt (100, 300) pour que `moved` soit nul et
  // que seule la garde multi-touch empêche l'armement d'un tap à cet endroit. Le tap final,
  // posé sur ce même point, referme le piège : sans la garde, il serait lu comme le second tap
  // d'une paire et basculerait le zoom à 250.
  it('les relâchements d\'un pincement n\'amorcent pas de séquence de tap', () => {
    const vp = fakeViewport()
    const z = usePinchZoom({ getViewport: () => vp })
    z.onPointerDown(ptr(1, 100, 300))
    z.onPointerDown(ptr(2, 200, 300))
    z.onPointerUp(ptr(2, 200, 300)) // le 2e doigt part EN PREMIER
    z.onPointerUp(ptr(1, 100, 300)) // le DERNIER relâchement retombe sur le point d'appui du 1er doigt
    const apresPincement = z.zoom.value
    // un tap unique au même endroit, juste après, ne doit pas être lu comme le SECOND d'une paire
    z.onPointerDown(ptr(1, 100, 300))
    z.onPointerUp(ptr(1, 100, 300))
    expect(z.zoom.value).toBe(apresPincement)
  })

  // Couverture de la garde `moved < TAP_MOVE_MAX` dans le test PRINCIPAL du double-tap (celle
  // qui déclenche la bascule), distincte de celle de la branche d'armement testée ci-dessus.
  // Scénario : le premier tap arme lastTap à (100, 300). Le second doigt se POSE loin
  // (300, 300) mais se RELÂCHE tout près du premier tap (105, 300) — `nearPrev` est petit et
  // la fenêtre de temps est respectée, mais le déplacement PROPRE de ce doigt (300 → 105) est
  // grand. Sans cette garde, un relâchement qui atterrit près d'un tap précédent basculerait le
  // zoom même après un déplacement franc.
  it('un relachement pres du premier tap mais parti de loin ne bascule pas', () => {
    const z = usePinchZoom({ getViewport: () => fakeViewport() })
    z.onPointerDown(ptr(1, 100, 300))
    z.onPointerUp(ptr(1, 100, 300)) // arme lastTap à (100, 300)
    z.onPointerDown(ptr(1, 300, 300)) // se pose loin
    z.onPointerUp(ptr(1, 105, 300)) // se relâche à 5 px du tap précédent, mais 195 px de son propre point de départ
    expect(z.zoom.value).toBe(100)
  })
})

describe('usePinchZoom — activePointers (coordination avec un geste tiers)', () => {
  // `activePointers()` n'existe pas pour un besoin interne au pincement : le composable se
  // suffit de sa Map privée. Elle est publique parce qu'un AUTRE geste, posé sur le même
  // viewport mais vivant ailleurs (le rideau de progression du lecteur de patron, dans
  // ChartStage.vue), a besoin de savoir si un pincement est déjà engagé avant de démarrer son
  // propre drag — et de céder la main si un second doigt arrive après coup. Sans ce compte
  // partagé, les deux gestes se disputeraient les mêmes pointeurs.
  it('vaut zero au repos, monte a mesure que les doigts se posent, redescend quand ils se relâchent', () => {
    const z = usePinchZoom({ getViewport: () => fakeViewport() })
    expect(z.activePointers()).toBe(0)
    z.onPointerDown(ptr(1, 100, 300))
    expect(z.activePointers()).toBe(1)
    z.onPointerDown(ptr(2, 200, 300))
    expect(z.activePointers()).toBe(2)
    z.onPointerUp(ptr(2, 200, 300))
    expect(z.activePointers()).toBe(1)
    z.onPointerUp(ptr(1, 100, 300))
    expect(z.activePointers()).toBe(0)
  })
})

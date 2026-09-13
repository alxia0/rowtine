import { ref, computed } from 'vue'

// Pincer-pour-zoomer + double-tap, avec pan par défilement natif.
//
// Extrait de ChartStage.vue (le plein écran des diagrammes de tricot), lignes 85-166, où ce
// geste vivait SANS AUCUN TEST UNITAIRE — seulement prouvé par l'usage sur appareil. Deux de
// ses gardes sont des correctifs de terrain (voir commentaires ci-dessous) : les perdre
// referait réapparaître les défauts qu'elles corrigent. Extrait tel quel (seuils, ordre des
// tests, formule d'ancrage) pour être partagé avec la visionneuse photo, sans rien changer à
// son comportement.
//
// `getViewport` est une fonction (pas l'élément lui-même) : au moment de l'appel du
// composable, la `ref` de gabarit du consommateur n'est pas encore résolue.
export function usePinchZoom({ getViewport, min = 100, max = 500, tapZoom = 250 }) {
  const zoom = ref(min) // pourcentage courant — le pan est le scroll natif du viewport
  const isZoomed = computed(() => zoom.value > min)

  function setZoom(next, anchorX, anchorY) {
    const vp = getViewport()
    const clamped = Math.max(min, Math.min(max, Math.round(next)))
    if (!vp || clamped === zoom.value) {
      zoom.value = clamped
      return
    }
    // garder le point (anchorX/Y, coords viewport) stable pendant le changement
    const ax = anchorX ?? vp.clientWidth / 2
    const ay = anchorY ?? vp.clientHeight / 2
    const ratio = clamped / zoom.value
    const cx = (vp.scrollLeft + ax) * ratio - ax
    const cy = (vp.scrollTop + ay) * ratio - ay
    zoom.value = clamped
    requestAnimationFrame(() => {
      vp.scrollLeft = cx
      vp.scrollTop = cy
    })
  }

  function reset() {
    zoom.value = min
    const vp = getViewport()
    if (vp) { vp.scrollLeft = 0; vp.scrollTop = 0 }
  }

  // pinch 2 doigts + double-tap (Pointer Events)
  const pointers = new Map()
  let pinch = null // { dist, width, midX, midY }
  let lastTap = 0
  let wasMultiTouch = false
  // garde anti-zoom (correctif de terrain) : un pan rapide puis un tap ne doit pas être lu
  // comme un double-tap. downX/Y = position de départ du pointeur en cours ; lastTapX/Y =
  // position du tap précédent (pour vérifier que les deux taps sont bien au même endroit,
  // pas juste rapprochés dans le temps).
  let downX = 0, downY = 0, lastTapX = 0, lastTapY = 0
  const TAP_MOVE_MAX = 12 // px : au-delà, c'est un pan, pas un tap
  const now = () => Date.now()

  function dist2(a, b) {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  }
  function onPointerDown(e) {
    pointers.set(e.pointerId, e)
    if (pointers.size === 1) { downX = e.clientX; downY = e.clientY }
    if (pointers.size === 2) {
      wasMultiTouch = true
      const [a, b] = [...pointers.values()]
      const r = getViewport().getBoundingClientRect()
      pinch = { dist: dist2(a, b), width: zoom.value, midX: (a.clientX + b.clientX) / 2 - r.left, midY: (a.clientY + b.clientY) / 2 - r.top }
    }
  }
  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, e)
    if (pinch && pointers.size === 2) {
      e.preventDefault()
      const [a, b] = [...pointers.values()]
      setZoom((pinch.width * dist2(a, b)) / pinch.dist, pinch.midX, pinch.midY)
    }
  }
  function onPointerUp(e) {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinch = null
    // double-tap : deux pointerup à moins de 300 ms → bascule min ↔ tapZoom
    // Ignorer TOUS les pointerup d'une séquence multi-touch (pinch), y compris
    // le dernier : lire le drapeau AVANT de le remettre à zéro.
    const skip = wasMultiTouch
    if (pointers.size === 0) wasMultiTouch = false
    if (skip) {
      lastTap = 0
      return
    }
    const tNow = now()
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY)
    const nearPrev = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY)
    if (tNow - lastTap < 300 && moved < TAP_MOVE_MAX && nearPrev < 44) {
      const r = getViewport().getBoundingClientRect()
      setZoom(zoom.value === min ? tapZoom : min, e.clientX - r.left, e.clientY - r.top)
      lastTap = 0
    } else if (moved < TAP_MOVE_MAX) {
      lastTap = tNow
      lastTapX = e.clientX
      lastTapY = e.clientY
    } else {
      lastTap = 0 // un pan ne démarre pas de séquence de tap
    }
  }

  // Lecture du nombre de doigts actuellement posés (Map interne du geste). Fonction, pas
  // `computed` : `pointers` n'est pas réactif, un `computed` figerait la valeur au premier
  // lu et ne se réévaluerait plus jamais. Un consommateur qui superpose un autre geste sur
  // le même viewport doit pouvoir savoir si un pincement est déjà en cours avant de démarrer
  // le sien (coordination avec un geste tiers qui vit hors de ce composable).
  function activePointers() {
    return pointers.size
  }

  return { zoom, isZoomed, setZoom, onPointerDown, onPointerMove, onPointerUp, reset, activePointers }
}

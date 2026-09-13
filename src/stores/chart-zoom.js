// Plein écran « diagramme » — état global (pattern lightbox). Une seule instance de
// <ChartFullscreen> est montée dans App.vue ; ReaderChart l'ouvre via show(payload).
// payload : { chart, row, rep, frame, readOnly, onRow, onRep, onFrame } — les
// callbacks remontent l'état au propriétaire (ReaderView) sans couplage d'import.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useChartZoomStore = defineStore('chartZoom', () => {
  const open = ref(false)
  const payload = ref(null)

  function show(p) {
    if (!p?.chart?.img) return
    payload.value = p
    open.value = true
  }
  function close() {
    open.value = false
    payload.value = null
  }
  return { open, payload, show, close }
})

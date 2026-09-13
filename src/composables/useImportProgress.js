// Pilote la barre de progression d'un import PDF (local ou zip). Tient l'horloge
// (certaines phases sont opaques : c'est la vue qui mesure le temps), reçoit les
// événements de phase via `report`, et expose un % global monotone + le libellé.
// La logique de calcul est pure (utils/import-progress) ; ici, juste l'état + le timer.
import { ref, computed, onUnmounted, getCurrentInstance } from 'vue'
import { LOCAL_PHASES, ZIP_PHASES, computeProgress, estimateTau } from '@/utils/import-progress'

export function useImportProgress() {
  const active = ref(false)
  const phase = ref('')
  const page = ref(0)
  const total = ref(0)
  const pct = ref(0)
  const labelKey = ref('')
  const elapsedSec = ref(0)

  let phases = LOCAL_PHASES
  let tau = 60
  let startedAt = 0
  let phaseStartedAt = 0
  let timer = null

  function now() {
    return Date.now()
  }

  function tick() {
    const phaseElapsed = (now() - phaseStartedAt) / 1000
    elapsedSec.value = Math.round((now() - startedAt) / 1000)
    const { pct: p, labelKey: lk } = computeProgress(phases, phase.value, phaseElapsed, page.value, total.value, tau)
    if (lk) labelKey.value = lk
    // Monotone : on ne recule jamais.
    if (p > pct.value) pct.value = p
  }

  function stopTimer() {
    if (timer) clearInterval(timer)
    timer = null
  }

  // profile : 'local' | 'zip' ; fileSize sert à estimer la durée typique (repli easing).
  function begin(profile, fileSize = 0) {
    stopTimer() // ne jamais laisser un timer précédent orphelin (2e import, etc.)
    phases = profile === 'zip' ? ZIP_PHASES : LOCAL_PHASES
    tau = estimateTau(fileSize)
    startedAt = now()
    phaseStartedAt = startedAt
    phase.value = ''
    page.value = 0
    total.value = 0
    pct.value = 0
    labelKey.value = ''
    elapsedSec.value = 0
    active.value = true
    timer = setInterval(tick, 250)
  }

  // Événement { phase, page?, total? } émis par le moteur d'import.
  function report(evt) {
    if (!evt) return
    if (evt.phase && evt.phase !== phase.value) {
      phase.value = evt.phase
      phaseStartedAt = now()
    }
    page.value = evt.page || 0
    total.value = evt.total || 0
    tick()
  }

  function end() {
    stopTimer()
    pct.value = 100
    active.value = false
  }

  function reset() {
    stopTimer()
    active.value = false
    pct.value = 0
    phase.value = ''
    labelKey.value = ''
    elapsedSec.value = 0
  }

  // Nettoyage si le composant est détruit pendant un import (ex. retour Android).
  if (getCurrentInstance()) onUnmounted(stopTimer)

  return {
    active,
    pct: computed(() => Math.round(pct.value)),
    labelKey,
    elapsedSec,
    page,
    total,
    phase,
    begin,
    report,
    end,
    reset,
  }
}

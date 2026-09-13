// src/composables/useNavProgress.js
// Cue de navigation global (état singleton module — le routeur le pilote hors contexte
// de composant, NavProgress.vue le lit). Anti-flash : la barre n'apparaît qu'au-delà de
// NAV_PROGRESS_DELAY_MS, pour ne jamais clignoter sur une navigation déjà chaude (chunk
// préchauffé). `navDone()` réinitialise TOUT (pas un compteur) : robuste aux redirections
// de garde (la navigation redirigée n'émet pas d'afterEach ; le afterEach de la navigation
// finale remet à zéro le timer resté armé).
import { ref } from 'vue'

export const NAV_PROGRESS_DELAY_MS = 120

export const navActive = ref(false)
let timer = null

export function navStart() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    navActive.value = true
    timer = null
  }, NAV_PROGRESS_DELAY_MS)
}

export function navDone() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  navActive.value = false
}

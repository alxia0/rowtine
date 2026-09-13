// Snackbar « Annuler » — pierre angulaire du droit à l'erreur (PRD §7.14).
// show(message, { actionLabel, onAction, duration }) affiche une barre avec action annulable.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSnackbarStore = defineStore('snackbar', () => {
  const visible = ref(false)
  const message = ref('')
  const actionLabel = ref('')
  let action = null
  let timer = null

  function show(msg, { actionLabel: label = '', onAction = null, duration = 5000 } = {}) {
    message.value = msg
    actionLabel.value = label
    action = onAction
    visible.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(hide, duration)
  }

  function runAction() {
    if (action) action()
    hide()
  }

  function hide() {
    visible.value = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return { visible, message, actionLabel, show, runAction, hide }
})

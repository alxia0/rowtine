// Snackbar « Annuler » — pierre angulaire du droit à l'erreur (PRD §7.14).
// show(message, { actionLabel, onAction, duration }) affiche une barre avec action annulable.
// Hôte : une surface plein écran opaque qui recouvre la barre globale (App.vue, z-index 100),
// comme le composeur de badge (1050), monte sa propre <SnackBar embedded />, qui réclame
// l'affichage par claimHost() ; la barre globale se tait tant qu'un hôte est là. Un seul état, deux
// rendus exclusifs : le message n'est ni perdu sous l'hôte ni affiché deux fois, et la barre
// globale reprend le temps restant si l'hôte se ferme.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSnackbarStore = defineStore('snackbar', () => {
  const visible = ref(false)
  const message = ref('')
  const actionLabel = ref('')
  const hosts = ref(0)
  let action = null
  let timer = null

  // Renvoie la fonction de libération (compteur, pas booléen : deux hôtes empilés restent sûrs).
  function claimHost() {
    hosts.value++
    let released = false
    return () => {
      if (released) return
      released = true
      hosts.value--
    }
  }

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

  return { visible, message, actionLabel, hosts, show, runAction, hide, claimHost }
})

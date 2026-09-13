// Rowtine — pont Réglages ↔ porte du dossier (décision produit du
// 05/09/2026 : « AJOUTER un bouton qui permet de modifier »). La porte
// (OnboardingFolderPrompt.vue) est montée UNE FOIS dans App.vue, en frère du
// RouterView ; SafFolderSection vit PROFOND dans ce RouterView (écran Réglages).
// Aucun des deux ne peut joindre l'autre directement : ce mini-store à deux champs
// est le fil qui les relie, sur le motif de `stores/sync-report.js` (store minimal,
// pas d'historique).
//
//   `requested`  — l'IMPULSION de demande, portée Réglages → App.vue.
//     SafFolderSection lève (`requestChange()`), App.vue la CONSOMME (remise à
//     faux par le consommateur, pas par l'émetteur) et ouvre la porte en mode
//     change (`openForChange`). Consommée immédiatement côté App.vue pour qu'une
//     demande ultérieure, même identique, re-déclenche son `watch` — et pour
//     qu'une porte momentanément injoignable ne laisse pas un `true` résiduel
//     avaler en silence la demande suivante.
//
//   `closeCount` — le signal de fermeture, porté porte → Réglages. Incrémenté à
//     CHAQUE fermeture de la porte (conclue ou annulée), observé par
//     SafFolderSection qui y recharge son état (`loadState`). Un COMPTEUR plutôt
//     qu'un booléen « porte refermée » : deux fermetures rapprochées laissent le
//     booléen à la même valeur et le `watch` muet, alors que l'état du dossier a
//     pu changer entre les deux — le compteur, lui, bouge toujours.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useFolderChangeStore = defineStore('folderChange', () => {
  const requested = ref(false)
  const closeCount = ref(0)

  function requestChange() {
    requested.value = true
  }

  // Appelé par la PORTE elle-même (pas par App.vue) : la porte connaît le moment
  // exact de chacune de ses fermetures — y compris la refermeture sans conclusion
  // d'une annulation, qui n'émet PAS l'événement `closed` (rien n'a changé, la
  // ré-évaluation de l'offre de restauration côté App.vue n'a rien à re-lire) mais
  // doit rafraîchir les Réglages tout autant. Remet AUSSI la demande à faux : une
  // porte qui vient de se fermer rend toute demande résiduelle périmée (défense —
  // dans le flux nominal, App.vue l'a déjà consommée en ouvrant la porte).
  function notifyGateClosed() {
    requested.value = false
    closeCount.value += 1
  }

  return { requested, closeCount, requestChange, notifyGateClosed }
})

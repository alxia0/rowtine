// LE BRANCHEMENT D'UN COMPOSANT SUR LA FILE DES MESSAGES.
//
// Huit RANGS, portés par SEPT composants — `App.vue` en tient deux (le garde-fou de version
// et la décision de sauvegarde). Tous doivent faire la même chose : dire qu'ils veulent
// l'écran quand leur propre condition est remplie, se retirer quand elle ne l'est plus, et
// ne s'afficher que si la file les nomme. Écrit huit fois à la main, ce motif se serait
// désaccordé au premier lot suivant. Écrit ici une fois, il se teste une fois.
//
// `wants` est la condition PROPRE du composant, inchangée par ce lot : le composant garde
// son drapeau, son magasin et sa logique. Il ne délègue que la décision « ai-je le droit de
// m'afficher maintenant ».
import { computed, watch, onBeforeUnmount, toValue } from 'vue'
import { useNoticeQueueStore } from '@/stores/notice-queue'

export function useNoticeSlot(id, wants) {
  const queue = useNoticeQueueStore()

  // `immediate: true` est NÉCESSAIRE, pas cosmétique : un composant monté alors que sa
  // condition est DÉJÀ vraie (rechargement complet, navigation vers un écran dont le
  // drapeau est posé) ne verrait aucun changement, donc ne demanderait jamais l'écran.
  // C'est exactement le piège déjà payé par la bienvenue le 10/08, où un `onMounted` seul
  // ne voyait jamais le drapeau posé après lui.
  watch(
    () => !!toValue(wants),
    (veut) => (veut ? queue.request(id) : queue.withdraw(id)),
    { immediate: true },
  )

  // Un composant démonté ne peut plus rien afficher : il doit libérer la file, sinon il
  // bloquerait tous les rangs plus faibles pour le reste de la session.
  onBeforeUnmount(() => queue.withdraw(id))

  return computed(() => queue.active === id)
}

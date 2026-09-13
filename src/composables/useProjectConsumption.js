// Logique partagée par les TROIS points d'entrée qui peuvent clore/abandonner un projet
// (ProjectDetailView.changeStatus, ProjectCard.onStatus, ProjectEditView.save) : passer
// un projet à 'done' OU 'abandoned' doit d'abord demander combien
// de pelotes ont RÉELLEMENT été utilisées/perdues, SI ce projet réserve des pelotes —
// sinon le statut change tout de suite, comme avant. Factorisé ici pour ne jamais
// dupliquer cette décision dans les trois appelants.
//
// PIÈGE UX (décision produit) : fermer la question applique TOUJOURS le défaut du mode
// (pas de bouton Annuler qui mentirait — cf. YarnConsumptionDialog.vue, qui applique ce
// défaut lui-même pour la croix/le scrim/Échap). Ce composable applique le MÊME défaut
// quand la fermeture vient d'ailleurs : le Retour Android (App.vue), via le store
// project-consumption (même mécanisme que color-picker.js).
import { ref, computed, watch, reactive } from 'vue'
import { useYarnsStore } from '@/stores/yarns'
import { useProjectConsumptionStore } from '@/stores/project-consumption'
import { reservationsOf, consumeProjectReservation } from '@/utils/yarn-usage'

export function useProjectConsumption() {
  const yarnsStore = useYarnsStore()
  const store = useProjectConsumptionStore()
  // { projectId, applyStatus, mode } tant qu'une question est en attente, sinon null.
  // Local à CETTE instance du composable (une par composant appelant) : ProjectCard en
  // crée une par carte, seule celle dont le statut vient de changer a un `req` non nul.
  const req = ref(null)

  const open = computed(() => req.value != null)
  // Mode transmis au dialogue : 'done' (défaut = tout tricoté) ou 'abandoned' (défaut =
  // rien de perdu, tout revient). Cf. YarnConsumptionDialog.vue.
  const mode = computed(() => req.value?.mode ?? 'done')
  // Laines réservées par CE projet, mises en forme pour le dialogue — recalculé en
  // direct depuis le stock (jamais figé au moment de la demande).
  const yarns = computed(() => {
    if (!req.value) return []
    const pid = req.value.projectId
    return yarnsStore.yarns
      .filter((y) => reservationsOf(y)[pid] != null)
      .map((y) => ({
        id: y.id,
        name: [y.brand || '—', y.colorName].filter(Boolean).join(' · '),
        reserved: reservationsOf(y)[pid],
      }))
  })

  // Propage l'ouverture locale vers le store partagé, pour que le Retour Android
  // (App.vue) puisse la détecter en priorité (même chaîne que colorPicker/yarnConsumed).
  watch(open, (v) => {
    store.open = v
  })
  // Fermeture externe (Retour Android) : équivaut à toute autre fermeture du dialogue →
  // applique le défaut DU MODE (tout réservé si 'done', 0 si 'abandoned'), jamais un
  // cancel silencieux qui mentirait sur ce qui a été tricoté/perdu.
  watch(
    () => store.open,
    (v) => {
      if (v || !req.value) return
      const m = req.value.mode
      confirm(yarns.value.map((y) => ({ id: y.id, used: m === 'abandoned' ? 0 : y.reserved })))
    },
  )

  // `entries`: [{ id: yarnId, used }], émis par YarnConsumptionDialog (Valider, ou l'un
  // de ses défauts croix/scrim/Échap).
  async function confirm(entries) {
    const current = req.value
    if (!current) return
    // Effacé AVANT tout await : le garde-fou anti-double-traitement (watcher store.open
    // ci-dessus) repose sur ce `req.value` déjà vidé pendant que ce `confirm` s'exécute.
    req.value = null
    for (const { id, used } of entries) {
      // Relit CHAQUE laine dans le store fraîchement rechargé (yarnsStore.update() fait
      // un await load() interne) plutôt qu'un instantané figé — respecte la mise en garde
      // K1 : consumeProjectReservation clampe sur l'état AU MOMENT DE L'APPEL.
      const yarn = yarnsStore.yarns.find((y) => y.id === id)
      if (!yarn) continue
      await yarnsStore.update(id, consumeProjectReservation(yarn, current.projectId, used))
    }
    await current.applyStatus()
  }

  // Point d'entrée partagé : `applyStatus` est le changement à appliquer directement si
  // aucune question n'est nécessaire (statut ni 'done' ni 'abandoned', ou aucune laine
  // réservée), ou une fois la question validée. Ne bloque JAMAIS en attendant la réponse
  // de l'utilisateur : sur le chemin « question posée », `req.value` est armé et la
  // fonction retourne aussitôt — c'est `confirm()` (déclenché plus tard par le dialogue ou
  // le Retour Android) qui appelle `applyStatus` en différé. Les appelants qui doivent
  // agir APRÈS la réponse (ex. ProjectEditView.save, qui navigue seulement une fois la
  // consommation appliquée) mettent cette suite dans `applyStatus` lui-même plutôt que
  // d'attendre la résolution de cet appel.
  async function requestStatusChange(project, status, applyStatus) {
    if (status !== 'done' && status !== 'abandoned') return applyStatus()
    if (!yarnsStore.loaded) await yarnsStore.load()
    const pid = project?.id
    const hasReserved = yarnsStore.yarns.some((y) => reservationsOf(y)[pid] != null)
    if (!hasReserved) return applyStatus()
    req.value = { projectId: pid, applyStatus, mode: status }
  }

  // `reactive()` (pas un objet nu) : les appelants font `projectConsumption.open` /
  // `.yarns` / `.mode` directement dans leur template (`:open="projectConsumption.open"`),
  // ce qui n'auto-déballe PAS un ref/computed niché dans une propriété d'un objet
  // ordinaire — seul un objet réactif (comme les stores Pinia, réactifs en interne) le fait.
  return reactive({ open, yarns, mode, confirm, requestStatusChange })
}

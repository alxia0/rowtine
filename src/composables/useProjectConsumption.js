// Logique partagée par les TROIS points d'entrée qui peuvent clore/abandonner un projet
// (ProjectDetailView.changeStatus, ProjectCard.onStatus, ProjectEditView.save) : passer
// un projet à 'done' OU 'abandoned' doit d'abord demander combien
// de pelotes ont RÉELLEMENT été utilisées/perdues, SI ce projet réserve des pelotes —
// sinon le statut change tout de suite, comme avant. Factorisé ici pour ne jamais
// dupliquer cette décision dans les trois appelants.
//
// Règle (décision produit) : toute fermeture SANS « Valider » est une annulation (bouton
// Annuler, croix, voile et Échap du dialogue, Retour Android via le store
// project-consumption, même mécanisme que color-picker.js) : aucune laine n'est touchée et
// `applyStatus` n'est pas appelé, donc le statut ne change pas. Seul `confirm` consomme.
import { ref, computed, watch, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useYarnsStore } from '@/stores/yarns'
import { useProjectConsumptionStore } from '@/stores/project-consumption'
import { reservationsOf, availableForProject, reservedByOthers, consumeProjectReservation } from '@/utils/yarn-usage'

export function useProjectConsumption() {
  const yarnsStore = useYarnsStore()
  const store = useProjectConsumptionStore()
  const router = useRouter()
  // { projectId, applyStatus, mode, onCancel } tant qu'une question est en attente, sinon null.
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
        // Plafond de la saisie dans le dialogue : ce qui est DISPONIBLE pour ce projet (sa
        // réservation plus le stock libre), pas le stock total. Les pelotes réservées par
        // d'autres projets ne sont pas à lui ; c'est aussi le plafond de
        // consumeProjectReservation, donc le dialogue n'affiche jamais une valeur que
        // l'écriture tronquerait ensuite en silence.
        available: availableForProject(y, pid),
        // Un autre projet garde-t-il des pelotes de cette laine ? Sert à n'expliquer le plafond
        // par « les réservations des autres projets » que si c'est vrai.
        othersReserved: reservedByOthers(y, pid) > 0,
      }))
  })

  // Propage l'ouverture locale vers le store partagé, pour que le Retour Android
  // (App.vue) puisse la détecter en priorité (même chaîne que colorPicker/yarnConsumed).
  watch(open, (v) => {
    store.open = v
  })
  // Fermeture externe (Retour Android) : équivaut à toute autre fermeture sans validation,
  // donc une ANNULATION. Si `cancel()` a déjà vidé `req` (clic sur Annuler, puis `store.open`
  // qui repasse à false), le garde ci-dessous évite un second `onCancel`.
  watch(
    () => store.open,
    (v) => {
      if (v || !req.value) return
      cancel()
    },
  )

  // `entries`: [{ id: yarnId, used }], émis par YarnConsumptionDialog (Valider seul).
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

  // Annulation : ferme sans rien consommer ni appliquer le statut. `req` est vidé AVANT tout
  // await (même garde anti-double-traitement que `confirm`) : le watcher sur `store.open`
  // et un clic sur Annuler ne peuvent ainsi déclencher `onCancel` qu'une seule fois.
  // `opts.fixingStock` : l'annulation vient de « Corriger le stock » d'une laine, qui ouvre
  // elle-même la fiche de cette laine ; l'appelant ne doit alors pas ouvrir une autre fiche.
  async function cancel(opts) {
    const current = req.value
    if (!current) return
    req.value = null
    await current.onCancel?.(opts)
  }

  // Corriger le stock d'une laine : annule la question (aucune consommation) puis ouvre la
  // fiche de la laine.
  async function fixStock(yarnId) {
    await cancel({ fixingStock: true })
    await router.push({ name: 'stash-edit', params: { id: yarnId } })
  }

  // Point d'entrée partagé : `applyStatus` est le changement à appliquer directement si
  // aucune question n'est nécessaire (statut ni 'done' ni 'abandoned', ou aucune laine
  // réservée), ou une fois la question validée. Ne bloque JAMAIS en attendant la réponse
  // de l'utilisateur : sur le chemin « question posée », `req.value` est armé et la
  // fonction retourne aussitôt. C'est `confirm()` (déclenché plus tard par « Valider »
  // seulement) qui appelle `applyStatus` en différé ; toute autre fermeture (Annuler, croix,
  // voile, Échap, Retour Android, « Corriger le stock ») passe par `cancel()`, qui appelle
  // `onCancel` s'il est fourni. Les appelants qui doivent agir APRÈS la réponse (ex.
  // ProjectEditView.save, qui écrit le statut puis navigue seulement une fois la
  // consommation appliquée, et navigue aussi sur Annuler) mettent cette suite dans
  // `applyStatus` / `onCancel` plutôt que d'attendre la résolution de cet appel.
  async function requestStatusChange(project, status, applyStatus, onCancel) {
    if (status !== 'done' && status !== 'abandoned') return applyStatus()
    if (!yarnsStore.loaded) await yarnsStore.load()
    const pid = project?.id
    const hasReserved = yarnsStore.yarns.some((y) => reservationsOf(y)[pid] != null)
    if (!hasReserved) return applyStatus()
    req.value = { projectId: pid, applyStatus, mode: status, onCancel }
  }

  // `reactive()` (pas un objet nu) : les appelants font `projectConsumption.open` /
  // `.yarns` / `.mode` directement dans leur template (`:open="projectConsumption.open"`),
  // ce qui n'auto-déballe PAS un ref/computed niché dans une propriété d'un objet
  // ordinaire — seul un objet réactif (comme les stores Pinia, réactifs en interne) le fait.
  return reactive({ open, yarns, mode, confirm, cancel, fixStock, requestStatusChange })
}

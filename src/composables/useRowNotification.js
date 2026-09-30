import { ref, computed, watch, unref, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { buildRowNotification } from '@/utils/row-notification'
import { withStepIds } from '@/utils/reader'
import {
  showRowNotification,
  cancelRowNotification,
  checkRowNotificationPermission,
  requestRowNotificationPermission,
  onRowAction,
  isRowNotificationAvailable,
} from '@/native/row-notification'

// Notification Android du rang en cours, tenue par le lecteur d'un projet tant qu'il est
// monté (spec 2026-09-29, compteurs et diagrammes : spec 2026-09-30). Elle n'écrit rien : son
// bouton repasse par le lecteur, seul écrivain de la progression (« Cocher le rang » :
// `toggleDone` ; moins et plus d'un compteur : `bumpCounter(step, delta)`, borné par le lecteur). « Diagramme traité » n'écrit
// rien du tout : il acquitte le rappel dans `chartAcks`, tenu ici et oublié au démontage.
// Aucun accès DOM ici : l'action peut arriver app en arrière-plan.
//
// `enabled` : booléen fixe (contexte projet). Faux, le composable est inerte : ni
// notification, ni écouteur, ni demande de permission (aperçu bibliothèque).
// `canAskPermission` : ref/computed, faux tant que le lecteur n'est pas prêt ou pendant la
// visite guidée.
// `suspended` : ref/computed, vrai pendant la visite guidée, qui n'écrit rien : charge nulle
// (notification retirée) et bouton ignoré tant qu'elle dure.
// `isChartVisible(section)` : règle de visibilité par taille des diagrammes du lecteur
// (aucun rappel d'un diagramme masqué) ; appelée dans le computed, ses dépendances le suivent.
export function useRowNotification({
  enabled,
  project,
  reader,
  state,
  toggleDone,
  bumpCounter,
  isChartVisible,
  canAskPermission,
  suspended,
}) {
  if (!enabled) return

  const { t } = useI18n()
  const settings = useSettingsStore()
  let disposed = false
  let removeListener = null
  let removeResume = null
  // Dernière charge envoyée au natif (JSON) ; `undefined` : rien d'envoyé encore.
  let lastKey
  // Ids des diagrammes acquittés (« Diagramme traité ») : remplacé à chaque ajout pour que le
  // computed suive, vidé au démontage (rien de sauvegardé).
  const chartAcks = ref(new Set())

  const payload = computed(() => {
    if (unref(suspended)) return null
    if (!project.value || !reader.value || !settings.rowNotification) return null
    // `st.done` est muté en place (clés ajoutées ET supprimées par toggleDone) : lire ses
    // clés abonne le computed à ces deux changements.
    Object.keys(state.done)
    // Idem pour les compteurs et les positions de grille (mutés en place par le lecteur).
    Object.values(state.counters || {})
    Object.values(state.chartRows || {})
    return buildRowNotification({
      project: project.value,
      reader: reader.value,
      state: {
        size: state.size,
        done: state.done,
        counters: state.counters,
        chartRows: state.chartRows,
        chartAcks: chartAcks.value,
        isChartVisible,
      },
      t,
    })
  })

  function send(p) {
    if (disposed) return
    const key = JSON.stringify(p)
    if (key === lastKey) return
    lastKey = key
    if (p) showRowNotification(p)
    else cancelRowNotification()
  }

  watch(payload, send, { immediate: true })

  // Renvoi forcé de la charge courante (même identique à la dernière envoyée).
  function resend() {
    const p = payload.value
    if (disposed || !p) return
    lastKey = undefined
    send(p)
  }

  // Permission demandée une seule fois, à la première ouverture du lecteur d'un projet, et
  // seulement en natif (hors natif, rien n'est retenu). `asking` retient la demande dès son
  // départ : deux bascules rapprochées de `canAskPermission` ne la doublent pas.
  let asking = false
  async function askPermissionOnce() {
    if (!isRowNotificationAvailable()) return
    if (asking || disposed || settings.rowNotificationAsked || !settings.rowNotification) return
    asking = true
    let result = await checkRowNotificationPermission()
    if (disposed) return
    if (result === 'prompt') result = await requestRowNotificationPermission()
    // Retenue en mémoire tout de suite ; l'écriture en base n'est pas attendue (un échec
    // d'écriture ne fait que la reposer au prochain lancement).
    settings.markRowNotificationAsked().catch(() => {})
    // La charge a pu partir avant l'accord (sans effet sur Android 13+) : renvoi forcé.
    if (result === 'granted') resend()
  }
  watch(
    () => unref(canAskPermission),
    (ok) => {
      if (ok) askPermissionOnce()
    },
    { immediate: true },
  )

  // N'agit que sur l'étape de la charge affichée, du projet affiché : un second appui (ancien
  // stepId) ou une notification d'un autre projet sont ignorés, quel que soit le kind. La
  // charge est relue à l'appui (computed recalculé après un premier appui synchrone), donc un
  // bouton ne décoche jamais et ne touche jamais un autre compteur. `delta` : -1 (moins) ou
  // +1 (plus, et défaut).
  onRowAction(({ projectId, stepId, delta }) => {
    if (disposed || unref(suspended) || !project.value) return
    if (Number(projectId) !== Number(project.value.id)) return
    const p = payload.value
    if (!p || stepId !== p.stepId) return
    if (p.kind === 'chart') {
      chartAcks.value = new Set([...chartAcks.value, stepId])
    } else if (p.kind === 'counter') {
      const step = withStepIds(reader.value?.sections || [])
        .flatMap((sec) => sec.steps)
        .find((s) => s.id === stepId)
      if (step) bumpCounter(step, delta === -1 ? -1 : 1)
    } else if (!state.done[stepId]) {
      // Filet, inatteignable en pratique : la charge d'un rang coché désigne déjà l'étape
      // suivante, la garde ci-dessus a donc rejeté l'appui.
      toggleDone(stepId)
    }
  }).then((remove) => {
    if (disposed) remove()
    else removeListener = remove
  })

  // Retour au premier plan : renvoi forcé, qui rétablit une notification balayée ou
  // affiche celle dont la permission vient d'être accordée dans les paramètres système.
  if (isRowNotificationAvailable()) {
    import('@capacitor/app')
      .then(({ App }) => App.addListener('resume', resend))
      .then((handle) => {
        if (disposed) Promise.resolve(handle?.remove?.()).catch(() => {})
        else removeResume = handle
      })
      .catch(() => {})
  }

  onBeforeUnmount(() => {
    disposed = true
    chartAcks.value = new Set()
    cancelRowNotification()
    if (removeListener) removeListener()
    removeListener = null
    Promise.resolve(removeResume?.remove?.()).catch(() => {})
    removeResume = null
  })
}

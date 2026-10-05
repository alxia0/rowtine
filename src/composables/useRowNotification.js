import { ref, computed, watch, unref, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { buildRowNotification } from '@/utils/row-notification'
import { withStepIds } from '@/utils/reader'
import { parseCopyStepId, copiesOf, copyView } from '@/utils/section-copies'
import {
  showRowNotification,
  cancelRowNotification,
  onRowAction,
  isRowNotificationAvailable,
  readPendingRowAction,
  clearPendingRowAction,
  ackRowAction,
} from '@/native/row-notification'

// Appuis déjà traités (spec 2026-10-01 appui-webview-gele) : l'événement `rowAction` mis en
// file pendant le gel du WebView ET l'entrée retenue du natif portent le MÊME tapId ; le
// premier des deux chemins qui l'applique le note ici, l'autre l'ignore. Au niveau du
// module : il survit au démontage du lecteur (une réouverture rejoue l'entrée). Borné.
const handledTapIds = new Set()
// Ancien format sans tapId : rien à acquitter (le pont l'ignorerait aussi).
function ack(tapId, ...opts) {
  if (tapId) ackRowAction(tapId, ...opts)
}
function noteTapHandled(tapId) {
  if (!tapId) return
  handledTapIds.add(tapId)
  if (handledTapIds.size > 20) handledTapIds.delete(handledTapIds.values().next().value)
}

// Notification Android du rang en cours, tenue par le lecteur d'un projet tant qu'il est
// monté (spec 2026-09-29, compteurs et diagrammes : spec 2026-09-30 ; porte d'autorisation :
// spec 2026-10-01). Elle n'écrit rien : son bouton repasse par le lecteur, seul écrivain de
// la progression (« Cocher le rang » : `toggleDone` ; moins et plus d'un compteur :
// `bumpCounter(step, delta)`, borné par le lecteur). « Diagramme traité » n'écrit rien du
// tout : il acquitte le rappel dans `chartAcks`, tenu ici et oublié au démontage. Un appui
// retenu par le natif quand Android avait fermé l'app (spec 2026-09-30-notification-appui-attente)
// est rejoué ici à l'ouverture du projet, par le même code que le bouton. Chaque appui reçu
// est acquitté auprès du natif (spec 2026-10-01 appui-webview-gele).
// Aucun accès DOM ici : l'action peut arriver app en arrière-plan.
//
// `enabled` : booléen fixe (contexte projet). Faux, le composable est inerte : ni
// notification, ni écouteur, ni demande de permission (aperçu bibliothèque).
// `ready` : ref/computed, vrai quand le lecteur est prêt hors visite guidée — le signal du
// rejeu d'un appui retenu. L'ACTIVATION de la notification ne vit plus ici : la pop-up
// d'onboarding (spec 2026-10-01) est le seul chemin qui écrit le réglage true, après les
// deux autorisations.
// `batteryIgnoring` : ref/computed, l'exclusion des optimisations de batterie relue par la
// vue — porte d'AFFICHAGE seulement : hors état autorisé, rien ne s'affiche (symétrique du
// `canPost` natif). Le rejeu et l'appui reçu en événement restent HORS de cette porte : un
// appui déjà émis s'applique.
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
  ready,
  suspended,
  batteryIgnoring = true,
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

  // Entrées de buildRowNotification, communes au computed d'affichage et au rejeu d'un
  // appui retenu (mêmes sources, mêmes dépendances réactives — divergence interdite).
  function chargeInputs() {
    return {
      project: project.value,
      reader: reader.value,
      state: {
        size: state.size,
        done: state.done,
        counters: state.counters,
        // Exemplaires 2+ et exemplaire actif : buildRowNotification choisit, par section,
        // l'exemplaire de travail (actif en séquentiel, en retard en simultané).
        copyState: state.copyState,
        activeCopy: state.activeCopy,
        // Technique du projet, remplacée (jamais mutée) : lue ici, le computed y est abonné.
        copyMode: state.copyMode,
        // Trace du dernier geste (intent 2026-09-30) : l'étape en cours — donc la
        // notification — suit le dernier rang travaillé, pas le premier non fait du patron.
        // Toujours REMPLACÉ (st.last = {…}), jamais muté : la lecture ci-dessous suffit à
        // abonner le computed (contrairement à done/counters, mutés en place).
        last: state.last,
        chartRows: state.chartRows,
        chartAcks: chartAcks.value,
        isChartVisible,
      },
      t,
    }
  }

  const payload = computed(() => {
    if (unref(suspended)) return null
    // Porte d'AFFICHAGE seulement (spec 2026-10-01) : hors état autorisé (exemption
    // d'optimisations de batterie relue par la vue), rien ne s'affiche — le rejeu d'un
    // appui retenu reste HORS de cette porte : un appui déjà émis s'applique, pop-up
    // ouverte ou pas.
    if (!unref(batteryIgnoring)) return null
    if (!project.value || !reader.value || !settings.rowNotification) return null
    // `st.done` est muté en place (clés ajoutées ET supprimées par toggleDone) : lire ses
    // clés abonne le computed à ces deux changements.
    Object.keys(state.done)
    // Idem pour les compteurs et les positions de grille (mutés en place par le lecteur).
    Object.values(state.counters || {})
    Object.values(state.chartRows || {})
    // Exemplaires : copyState / activeCopy sont REMPLACÉS par le lecteur, mais les lire en
    // profondeur couvre aussi une mutation en place.
    Object.values(state.copyState || {}).forEach((v) => {
      Object.keys(v?.done || {})
      Object.values(v?.counters || {})
    })
    Object.values(state.activeCopy || {})
    return buildRowNotification(chargeInputs())
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

  // Même étape, quel que soit l'exemplaire visé : l'exemplaire en retard a pu changer entre
  // l'émission de l'appui et son application (rejeu), l'appui reste adressé à son exemplaire.
  const sameStep = (a, b) => parseCopyStepId(a).stepId === parseCopyStepId(b).stepId

  // Application d'un appui visant l'étape de la charge `p`, quel que soit le kind ; le
  // lecteur reste le seul écrivain. `delta` : -1 (moins) ou +1 (plus, et défaut).
  // `copy` : exemplaire visé par l'id d'appui (`sec#3@2`) ; ignoré sans erreur si la section
  // n'a plus autant d'exemplaires. Sans exemplaires (projet ou section), le lecteur est appelé
  // comme avant, sans cible.
  function applyRowTap(p, rawId, delta) {
    const { stepId, copy } = parseCopyStepId(rawId)
    if (p.kind === 'chart') {
      chartAcks.value = new Set([...chartAcks.value, stepId])
      return
    }
    const sec = withStepIds(reader.value?.sections || []).find((s) => stepId.startsWith(s.id + '#'))
    const multi = !!sec && copiesOf(sec) > 1
    if (copy > 1 && (!multi || copy > copiesOf(sec))) return
    if (p.kind === 'counter') {
      const step = sec?.steps.find((s) => s.id === stepId)
      if (!step) return
      if (multi) bumpCounter(step, delta === -1 ? -1 : 1, copy)
      else bumpCounter(step, delta === -1 ? -1 : 1)
    } else if (!copyView(state, copy).done[stepId]) {
      // Filet, inatteignable en pratique : la charge d'un rang coché désigne déjà l'étape
      // suivante, la garde du stepId a donc rejeté l'appui. Par exemplaire : un appui rejoué
      // sur une coche déjà posée ne la décoche jamais.
      if (multi) toggleDone(stepId, copy)
      else toggleDone(stepId)
    }
  }

  // N'agit que sur l'étape en cours du projet affiché : un second appui (ancien stepId) ou une
  // notification d'un autre projet sont ignorés, quel que soit le kind. L'étape est jugée sur
  // la charge recalculée à l'appui HORS des portes d'affichage (exemption batterie, réglage),
  // comme au rejeu : un appui déjà émis s'applique même si la notification n'est plus
  // affichable. Recalculée à chaque appui, elle a déjà avancé après un premier appui
  // synchrone : un bouton ne décoche jamais et ne touche jamais un autre compteur. Chaque
  // issue acquitte l'appui auprès du natif (sinon il annoncerait « Appui retenu » au bout de
  // 1,5 s) ; seule l'issue « non traité » (lecteur démonté ou pas prêt, visite guidée) garde
  // l'entrée retenue, pour le rejeu.
  onRowAction(({ projectId, stepId, delta, tapId }) => {
    if (tapId && handledTapIds.has(tapId)) {
      ack(tapId)
      return
    }
    if (disposed || unref(suspended) || !project.value || !reader.value) {
      ack(tapId, { keep: true })
      return
    }
    const p = buildRowNotification(chargeInputs())
    if (Number(projectId) !== Number(project.value.id) || !p || !sameStep(stepId, p.stepId)) {
      // Rejeté : le repli natif a pu remplacer la notification par « Appui retenu », le
      // lecteur repose sa charge courante pour lui rendre ses boutons.
      ack(tapId)
      resend()
      return
    }
    applyRowTap(p, stepId, delta)
    noteTapHandled(tapId)
    ack(tapId)
  }).then((remove) => {
    if (disposed) remove()
    else removeListener = remove
  })

  // Rejeu d'un appui retenu par le natif quand Android avait fermé l'app (spec
  // 2026-09-30-notification-appui-attente) : appliqué à l'ouverture du projet visé,
  // seulement si l'étape visée est toujours l'étape en cours. Même signal que la demande
  // de permission (lecteur prêt, hors visite guidée) : JAMAIS au montage sec, où
  // project/reader sont encore nuls — la charge calculée là désignerait la première
  // étape du patron et l'appui serait détruit.
  let replaying = false
  async function replayPendingRowAction() {
    if (replaying) return
    replaying = true
    try {
      const tap = await readPendingRowAction()
      if (disposed || !tap) return
      // Visite guidée lancée pendant la lecture : ne rien faire, l'entrée reste en place.
      if (unref(suspended)) return
      if (!project.value || !reader.value) return
      // Appui d'un autre projet : l'entrée lui reste réservée, même pour une session
      // ultérieure ; NE PAS effacer.
      if (Number(tap.projectId) !== Number(project.value.id)) return
      // Déjà appliqué par l'événement en file (même tapId) : ne pas compter deux fois,
      // l'entrée est effacée.
      if (tap.tapId && handledTapIds.has(tap.tapId)) {
        clearPendingRowAction()
        return
      }
      // Charge recalculée en appel direct, HORS la porte du réglage de notification : le
      // rejeu concerne la progression, pas l'affichage. Mêmes entrées que le computed
      // payload (fabrique partagée ci-dessus, y compris chartAcks courant et la règle de
      // taille des diagrammes).
      const p = buildRowNotification(chargeInputs())
      if (!p || !sameStep(tap.stepId, p.stepId)) {
        // Appui caduc (tout est coché, étape dépassée, patron refondu ailleurs) :
        // effacé, ignoré en silence — l'objectif de l'appui est déjà atteint ou dépassé.
        clearPendingRowAction()
        return
      }
      applyRowTap(p, tap.stepId, tap.delta)
      noteTapHandled(tap.tapId)
      clearPendingRowAction()
    } catch {
      // Rejet du pont : entrée conservée (pas de perte, pas de plantage), réessayé au
      // prochain déclenchement du signal.
    } finally {
      replaying = false
    }
  }
  watch(
    () => unref(ready),
    (ok) => {
      if (ok) replayPendingRowAction()
    },
    { immediate: true },
  )

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

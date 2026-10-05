<script>
// Garde de session (spec 2026-10-01) : le rattrapage de l'autorisation de notification n'est
// proposé qu'une fois par lancement de l'app, pas par montage de lecteur.
let notifOnboardingCheckedThisSession = false
</script>

<script setup>
// Lecteur de patron. Deux contextes :
//  - biblio  (/pattern/:id/read)  : APERÇU EN LECTURE SEULE (pas de coches, progression, taille ni chrono)
//  - projet  (/project/:id/read)  : SUIVI INTERACTIF — choix de taille, progression (project.readerState),
//    compteurs, diagramme, et un chrono discret qui alimente les sessions.
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { usePatternsStore } from '@/stores/patterns'
import { useProjectsStore, workedNow } from '@/stores/projects'
import { useSnackbarStore } from '@/stores/snackbar'
import { useChartZoomStore } from '@/stores/chart-zoom'
import { useActiveSessionStore } from '@/stores/activeSession'
import { useCorrectionHandoff } from '@/stores/correction-handoff'
import { useLightboxStore } from '@/stores/lightbox'
import { closeChronoSession } from '@/utils/close-chrono-session'
import { scrollBehavior } from '@/utils/scroll-behavior'
import { patternCoverOf } from '@/utils/pattern-cover'
import { useSmartBack } from '@/composables/useSmartBack'
import { useSplitReader } from '@/composables/useSplitReader'
import { useRowNotification } from '@/composables/useRowNotification'
import { useKeepScreenOn } from '@/composables/useKeepScreenOn'
import { useSettingsStore } from '@/stores/settings'
import {
  checkRowNotificationPermission,
  isBatteryOptimizationIgnored,
  isRowNotificationAvailable,
} from '@/native/row-notification'
import { verifyRowNotificationAuthorization } from '@/utils/row-notification-activation'
import { withStepIds, isRowStep, checkableStepsOf, currentStep, lastPlace, copyAfterFinish, alignSockActiveCopy, nextStepAfter, repeatTotal, scrollTargetId, retractCurtain, sizeLabelText, sectionTitleLabel, stepIsDone, workCopies, hasSockProgress, resetSockProgress, isTrackedStep } from '@/utils/reader'
import { copiesOf, copyModeOf, copyView, activeCopyOf, laggingCopy, counterCopy, copiesSummary, sockPairSections } from '@/utils/section-copies'
import { sectionKind, isSockKind, canWorkSimultaneously } from '@/utils/section-kinds'
import { withStitchMemo, PICK_STITCHES_EVENT, STITCH_MEMO_TAB } from '@/utils/stitch-memo'
import { resolveStitches } from '@/content/stitch-memo'
import { resolveOpenSyncTarget } from '@/utils/resolve-open-sync-target'
import { syncPatronMdOnOpen } from '@/backup/sync-on-open'
import { openPdfExternally } from '@/utils/open-pdf'
import { inCheckZone } from '@/utils/card-check-zone'
import { SESSION_NO_SECTION } from '@/constants/session'
import { NOTICE } from '@/constants/notice-queue'
import { useNoticeSlot } from '@/composables/useNoticeSlot'
import ReaderLine from '@/components/ReaderLine.vue'
import StepImages from '@/components/StepImages.vue'
import ReaderChart from '@/components/ReaderChart.vue'
import ReaderSheet from '@/components/ReaderSheet.vue'
import StitchPicker from '@/components/StitchPicker.vue'
import ChartStage from '@/components/ChartStage.vue'
import AppIcon from '@/components/AppIcon.vue'
import SkeletonScreen from '@/components/SkeletonScreen.vue'
import BackToTop from '@/components/BackToTop.vue'
import ReaderFixOverlay from '@/components/ReaderFixOverlay.vue'
import ReaderToc from '@/components/ReaderToc.vue'
import ChronoPill from '@/components/ChronoPill.vue'
import ReaderTour from '@/components/ReaderTour.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import RowNotifOnboardingDialog from '@/components/RowNotifOnboardingDialog.vue'
import KeepScreenOnSwitchRow from '@/components/KeepScreenOnSwitchRow.vue'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
// Libellé réservé de tuile d'aide-mémoire (titre/sous-titre) localisé si buildReference a
// émis une clé i18n stable (titleKey/subKey), repli sur le libellé FR figé sinon — cf.
// src/utils/reader-reference.js (zéro-dépendance, ne PAS y importer i18n).
const lbl = (o, keyField, fallbackField) => (o && o[keyField] ? t(o[keyField]) : o?.[fallbackField])
const patternsStore = usePatternsStore()
const projectsStore = useProjectsStore()
const snackbar = useSnackbarStore()
const active = useActiveSessionStore()
const correctionHandoff = useCorrectionHandoff()
const chartZoom = useChartZoomStore()
const { wide: splitWide } = useSplitReader()
// Décrochage du volet (retour device 28/07) : le geste inverse de « Afficher à droite ».
// Volontairement NON persisté — il ne vaut que le temps de la consultation, quitter le
// patron et y revenir ramène le volet (décision produit).
const detached = ref(false)
// `canPin` et `splitMode` doivent rester DEUX conditions distinctes : `canPin` commande le
// bouton, `splitMode` commande le volet. Les confondre ferait disparaître le bouton en même
// temps que le volet — décrocher deviendrait un aller sans retour.
const canPin = computed(() => splitWide.value && hasChart.value)
// Deux volets seulement s'il y a un diagramme à épingler (sans diagramme, le volet
// n'existe pas et le lecteur reste en une colonne) ET si l'utilisatrice ne l'a pas décroché.
const splitMode = computed(() => canPin.value && !detached.value)

// Diagramme épinglé à droite. Il ne se vide jamais et ne suit PAS l'étape courante : une
// étape sans diagramme laisse le volet tel quel (règle explicite du produit). Non persisté :
// à la réouverture du patron, c'est de nouveau le premier diagramme.
const pinnedChartSecId = ref(null)
const activeChartSection = computed(() => {
  const list = visibleChartSections.value
  if (!list.length) return null
  // Repli si la section épinglée n'est plus visible — cas réel : changer de taille masque
  // les grilles qui ne concernent pas cette taille.
  return list.find((s) => s.id === pinnedChartSecId.value) || list[0]
})
// Appelée depuis le fil (bouton « Afficher à droite » sur une grille non épinglée).
function pinChart(sec) {
  pinnedChartSecId.value = sec.id
  detached.value = false
}
// Appelée depuis le renvoi du volet (bouton « Ramener dans le texte ») : geste retour du
// décrochage. `canPin` reste vrai, donc le bouton « Afficher à droite » réapparaît aussitôt
// sur toutes les cartes — sinon le geste serait un aller sans retour.
function unpinChart() {
  detached.value = true
}

const ctx = route.name === 'project-read' ? 'project' : 'library'
const readOnly = ctx === 'library' // aperçu bibliothèque : lecture seule
const pattern = ref(null)
const project = ref(null)
const reader = ref(null)
const ready = ref(false)

// Identité de l'entité ouverte, capturée UNE fois au montage — sert de garde à
// refreshAfterSync() (revue de code du 23/08) : si l'écran est démonté avant la
// résolution de la synchro de fond, ou si l'instance du composant est réutilisée
// pour un AUTRE id (RouterView sans :key sur une navigation qui ne change que le
// paramètre de route), `route.params.id` a déjà changé sous nos pieds — sans ce
// témoin, un résultat de synchro périmé pourrait s'appliquer au patron/projet
// affiché ENTRE-TEMPS, pas à celui qui l'a déclenché.
const openedId = route.params.id
let isMounted = true

// Visite guidée (lot du 23/09/2026) : `?tour=1` sur le lecteur d'un PROJET. Lu UNE fois,
// au montage, dans un ref local : la fin de visite le repasse à faux elle-même, sans
// attendre que le `router.replace` qui retire `tour` de l'URL ait abouti (et un routeur
// qui ne rafraîchirait pas la route ne relancerait pas la visite pour autant).
const tourRequested = ref(ctx === 'project' && route.query.tour === '1')
// La visite passe par la file des messages : un message plus urgent (rapport de synchro,
// porte du dossier) la fait attendre. Perdre la file en cours de route démonte la
// visite SANS la terminer : elle reprendra depuis le début quand la file la rappellera.
const tourHasSlot = useNoticeSlot(
  NOTICE.READER_TOUR,
  computed(() => ready.value && tourRequested.value),
)

const st = reactive({ size: null, done: {}, counters: {}, copyState: {}, activeCopy: {}, copyMode: null, last: null, chartRows: {}, chartReps: {}, chartFrames: {}, chartCurtains: {} })

// Bandeau compact au défilement (P2/T2) : le gros titre + le surtitre (nom du projet,
// ou « Aperçu du patron ») rétrécissent une fois qu'on a commencé à défiler — sur l'écran
// où on tricote, la hauteur d'écran est la ressource la plus précieuse. Le surtitre porte
// une vraie info (le nom du PROJET peut différer du nom du PATRON) : en mode compact il est
// totalement MASQUÉ, pas réduit (max-height: 0 ; opacity: 0 — cf. .rhdr--compact .rhdr__eyebrow
// ci-dessous) — mais c'est réversible et découvrable (masquer ≠ perdre) : il redevient plein
// format dès qu'on remonte en haut de l'écran.
const HEADER_SCROLL_THRESHOLD = 4
const scrolled = ref(false)
function updateScrolled() {
  scrolled.value = window.scrollY > HEADER_SCROLL_THRESHOLD
}
const goBack = useSmartBack(ctx === 'project' ? { name: 'project', params: { id: route.params.id } } : { name: 'pattern', params: { id: route.params.id } })

const lsKey = computed(() => `rowtine.reader.pat.${pattern.value?.id}`)
// Chrono masquable par projet (project.showTimer ; défaut affiché pour les projets existants).
const showTimer = computed(() => project.value?.showTimer ?? true)
// Même garde que ProjectDetailView.vue : un projet Terminé ou Abandonné n'a plus de raison
// d'avoir un chrono actif. `project.value` est absent en contexte patron libre (ctx==='pattern',
// sans projet) : `?.status` y vaut alors undefined, jamais dans la liste -> non masqué, correct.
const chronoVisible = computed(
  () => showTimer.value && !['done', 'abandoned'].includes(project.value?.status),
)

// Synchro MD ciblée à l'ouverture : si le `patron.md` de ce patron/projet a
// été édité côté PC, on veut que le Lecteur affiche IMMÉDIATEMENT le contenu à jour —
// pas la version potentiellement dépassée déjà en base. `syncPatronMdOnOpen` NE LÈVE
// JAMAIS ; le `try/catch` ici est une ceinture-bretelles : quoi qu'il arrive, l'ouverture
// du patron ne doit jamais rester bloquée par un souci de synchro.
async function syncOnOpen() {
  try {
    let target
    if (ctx === 'project') {
      // Pré-lecture légère (champs structurels seulement) pour résoudre le dossier
      // concerné — le lien projet→patron (forké ou partagé) ne change pas avec une
      // édition de patron.md, donc ce pré-chargement reste valable même si le
      // contenu qu'il porte, lui, est sur le point d'être resynchronisé.
      const preProject = await projectsStore.get(route.params.id)
      const prePattern = preProject?.patternId != null ? await patternsStore.get(preProject.patternId) : null
      target = resolveOpenSyncTarget({ ctx, project: preProject, pattern: prePattern })
    } else {
      target = resolveOpenSyncTarget({ ctx, pattern: { id: Number(route.params.id) } })
    }
    if (target) await syncPatronMdOnOpen(target)
  } catch (err) {
    console.error('[reader] synchro à l’ouverture : échec inattendu (ignoré)', err)
  }
}

// Résout { project, pattern } depuis la DB locale pour l'entité ouverte (ctx +
// route.params.id) — factorisé (revue de code du 23/08, cleanup) : la même paire
// de lectures servait autrement au chargement initial ET à refreshAfterSync().
async function loadProjectAndPattern() {
  if (ctx !== 'project') return { project: null, pattern: await patternsStore.get(route.params.id) }
  const proj = await projectsStore.get(route.params.id)
  const pat = proj?.patternId != null ? await patternsStore.get(proj.patternId) : null
  return { project: proj, pattern: pat }
}

// Ouvre/poursuit le chrono du suivi de patron (contexte projet, chrono affiché). Partagée
// entre l'ouverture du lecteur et la fin de la visite guidée (lot du 23/09/2026), qui la
// diffère : même politique aux deux endroits.
async function openReaderChrono(resumeRunning = false) {
  if (ctx !== 'project' || !showTimer.value) return
  // Ouvre/poursuit le chrono du suivi de patron (ne démarre PAS tout seul, comme la session).
  // `openFor()` est idempotent sur le même couple (projet, sentinelle) : une session déjà
  // ouverte — depuis la fiche projet, ou par un passage précédent ici — est poursuivie
  // telle quelle. Sur un AUTRE couple, le store ferme SILENCIEUSEMENT l'ancien chrono en
  // commettant son temps non écrit au journal de SON projet (chantier « séances live », 30/08) :
  // rien à journaliser ici — l'écriture appartient au store. Cet écran ne FERME rien de
  // visible non plus en sortie (chantier « chrono unifié ») : la fermeture avec snackbar
  // appartient au garde « sortie de bulle » du routeur, qui décide sur la destination ; le
  // concept de session « adoptée » (qu'on n'avait pas ouverte soi-même et qu'il fallait
  // épargner en sortie) n'a donc plus d'objet ici.
  await active.openFor(project.value.id, SESSION_NO_SECTION, 0)
  // `openFor()` est idempotent sur le même couple : le temps accumulé avant le
  // départ est intact. Il ne reste qu'à relancer si le chrono tournait.
  if (resumeRunning) await active.play()
}

onMounted(async () => {
  // Lecture LOCALE d'abord (Dexie, toujours instantanée), SANS attendre syncOnOpen() :
  // celle-ci peut elle-même attendre plusieurs minutes une synchro complète en cours
  // (mesuré sur Pixel 7 ET tablette le 23/08/2026, cf. mémoire
  // synchro-ouverture-patron-bloque-nexus7) — le suivi ne doit plus rester figé
  // pendant tout ce temps. La synchro est lancée en tâche de fond plus bas
  // (syncOnOpen().then(refreshAfterSync)) et rafraîchit l'écran si elle change
  // quelque chose, sans rejouer ce qui suit (scroll, chrono, relais de correction).
  const initial = await loadProjectAndPattern()
  // Écran déjà quitté pendant la lecture Dexie (retour matériel rapide) : ne rien poursuivre.
  // Même garde que refreshAfterSync, appliquée ici au montage lui-même — sans elle, le
  // router.replace de la branche « patron introuvable » éjecterait l'utilisatrice de l'écran
  // vers lequel elle vient de naviguer.
  if (!isMounted) return
  project.value = initial.project
  pattern.value = initial.pattern
  if (!pattern.value?.reader) {
    // Patron supprimé/introuvable : on redirige, mais JAMAIS en silence — sinon le bouton
    // « Suivre le patron » a l'air cassé (cf. audit UX 16/07).
    if (ctx === 'project' && project.value?.patternId != null) {
      snackbar.show(t('project.patternMissingShort'))
    }
    router.replace(ctx === 'project' ? { name: 'project', params: { id: route.params.id } } : { name: 'library' })
    return
  }
  reader.value = pattern.value.reader
  loadState()
  ready.value = true
  // Cible d'ouverture (#9 + intent 2026-09-30) : une section explicite dans l'URL (clic depuis
  // l'onglet Sections de la fiche projet) PRIME sur toute reprise. Reprise (pas de ?section=,
  // ou cible de section disparue — correction qui a renommé le titre) : la dernière place
  // travaillée (`st.last` résolvable par lastPlace) avec badge explicatif ; les progressions
  // sans trace du dernier geste (héritage) replient sur le comportement historique — centrage
  // sur l'étape en cours, uniquement si le suivi est entamé (doneCount>0 ; patron vierge : on
  // reste en haut pour lire la présentation, cf. #6). Pendant la visite guidée : chemin
  // historique, jamais de badge (la visite n'affiche rien d'autre que ses bulles).
  const landResume = () => {
    const landed = tourRequested.value ? null : goToLastWorked('auto')
    if (landed) flashResumeBadge(landed)
    else if (doneCount.value > 0) resume('auto')
  }
  if (route.query.section) {
    nextTick(() => {
      // La cible de section peut ne plus exister : une correction (retour de l'écran
      // de correction) a pu renommer le titre visé par `?section=`, l'id DOM change
      // avec lui. Repli sur la reprise du dernier geste plutôt que de rester en haut
      // du patron — sans risque pour le chemin existant depuis l'onglet Sections, où
      // l'élément est toujours là.
      const el = document.getElementById(scrollTargetId(route.query, currentStepId.value))
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' })
      else landResume()
    })
  } else {
    nextTick(landResume)
  }
  // Le saut ci-dessus (reprise sur un projet en cours, ou cible de section) peut déjà avoir
  // défilé la page avant que l'écouteur de scroll ne soit posé (juste en dessous) : on
  // constate l'état réel après le saut plutôt que de supposer qu'on part toujours du haut
  // (piège déjà rencontré sur ce chantier). `nextTick` est mis en file APRÈS ceux ci-dessus :
  // il s'exécute donc après, une fois le scroll (synchrone en mode 'auto') effectué.
  nextTick(() => updateScrolled())
  // Relais de retour de l'écran de correction. Consommé DÈS le contexte projet
  // (pas seulement quand le chrono est affiché) : `take()` efface, et un relais
  // qui survivrait à un écran serait consommé par le suivant.
  const relay = ctx === 'project' ? correctionHandoff.take() : null
  // ⚠️ GARDE : un relais qui ne porte pas sur CE projet est JETÉ, jamais
  // consommé — même raison que dans import-handoff (« jamais de fichier périmé
  // réutilisé au montage »). Le pire cas résiduel est bénin : une session restée
  // en pause, ce que fait déjà le bouton pause.
  const fromCorrection = !!relay && relay.projectId === Number(project.value.id)
  // Visite guidée demandée : le chrono n'est PAS ouvert tant qu'elle dure. `openFor()`
  // écrit (réglage `activeSession`, et une ligne au journal s'il ferme le chrono d'un
  // autre projet) ; la visite ne doit rien écrire. Il est ouvert à sa fin (finishTour).
  if (!tourRequested.value) await openReaderChrono(fromCorrection && relay.chronoWasRunning)
  // Seconde garde : le bloc chrono ci-dessus attend openFor (une à deux écritures Dexie :
  // le commit de l'éventuel ancien slot, puis le persist). Un démontage pendant celles-ci
  // a DÉJÀ fait tourner onBeforeUnmount, donc ses removeEventListener sont passés AVANT
  // ces addEventListener — les trois écouteurs resteraient posés sur window pour toujours,
  // à s'accumuler à chaque ouverture du lecteur, en pilotant un composant mort.
  if (!isMounted) return
  window.addEventListener('click', onDocClick)
  window.addEventListener('keydown', onKey)
  window.addEventListener('scroll', updateScrolled, { passive: true })
  // Synchro en tâche de fond, lancée APRÈS l'affichage (cf. commentaire en tête de
  // ce onMounted) : ne bloque jamais l'ouverture. `refreshAfterSync` relit ensuite
  // project/pattern/reader si la synchro a fusionné quelque chose — le report
  // d'avertissement éventuel (progression perdue, etc.) reste géré par
  // syncPatronMdOnOpen elle-même (useSyncReportStore), donc affiché après coup.
  syncOnOpen().then(refreshAfterSync)
})
onBeforeUnmount(() => {
  isMounted = false
  clearResumeBadge()
  window.removeEventListener('click', onDocClick)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('scroll', updateScrolled)
  // Plus AUCUNE fermeture de session ici (chantier « chrono unifié », 2026-08-30) : l'ordre
  // montage/démontage ne décide plus de rien — c'est le garde « sortie de bulle » du
  // routeur qui ferme, sur la destination, AVANT ce démontage. L'ancienne sortie vers
  // l'écran de correction (session en pause, reprise au retour via le relais
  // `chronoWasRunning`) est couverte par le garde : `pattern-correct` est dans la bulle.
})

/* ── chrono (contexte projet) ── */
async function toggleChrono() {
  // Pause : `await` obligatoire — elle est COMMITTANTE depuis « séances live » : son temps
  // doit être au journal (file du store vidée) avant le geste qui s'enchaine (reprise,
  // masquage, sortie de bulle). Play reste lancé sans attendre : son effet d'écran
  // (runningSince) est posé de façon synchrone dans le store, avant tout await.
  if (active.running) {
    await active.pause()
  } else {
    active.play()
    // Premier lancement d'une session : pose `startedAt` si le projet n'en a pas — décision
    // produit du 12/09, cf. `projectsStore.ensureStarted`. Non attendu, même raison que
    // `play()` ci-dessus : rien ici ne conditionne un rendu synchrone de l'écran.
    projectsStore.ensureStarted(project.value.id)
  }
}
// Quitte le suivi : simple retour à la fiche projet — la session chrono POURSUIT (elle est
// dans la bulle du projet), c'est le garde du routeur qui la fermera en sortant du projet.
function leave() {
  goBack()
}
// Masquer/afficher le chrono (08/09/2026 : le chevron de la pastille remplace l'œil) :
// bascule project.showTimer. MÊME code que du temps de l'œil — le mini-menu de ChronoPill
// émet `hide`, qu'on branche ici. Renommage évité : la fonction reste une bascule (le
// Réafficher du snackbar la rappelle telle quelle, next recalculé = true).
async function toggleTimerFromReader() {
  const p = project.value
  if (!p) return
  const next = !(p.showTimer ?? true)
  // Masquer = clore la session active (temps enregistré ; pas de comptage invisible), MÊME
  // une session ouverte ailleurs : c'est un geste EXPLICITE de l'utilisatrice, pas une
  // navigation — le garde du routeur ne le couvrira jamais. closeChronoSession (partagée
  // avec le garde) fait pause commitante + clôture + snackbar — la journalisation vit
  // dans le store (pause), pas dans le helper.
  // `isActive` (chrono EN MARCHE **ou EN PAUSE**), pas `running` : une session mise en pause
  // reste ouverte (projectId défini) ; sans la clôturer ici, elle traînerait dans Dexie et
  // serait ré-attribuée à un autre projet. `active.pause()` est un no-op si déjà en pause.
  // `await` : la session doit être enregistrée AVANT de persister showTimer:false (sinon, ordre
  // non garanti + un échec deviendrait un rejet non géré).
  if (!next && active.isActive) await closeChronoSession()
  await projectsStore.update(p.id, { showTimer: next })
  p.showTimer = next
  // RÉAFFICHER rouvre une session sur CE projet — symétrique de la fermeture ci-dessus, et du
  // bloc d'ouverture de onMounted, qui lui ne s'exécute QUE si showTimer était déjà vrai à
  // l'arrivée. Sans cela, le bouton play réapparu (v-if="showTimer") appelle active.play()
  // alors qu'aucune session n'est ouverte : le chrono tourne à l'écran avec `projectId: null`
  // (activeSession.js) et l'enregistrement produit une session ORPHELINE, non rattachée au
  // projet.
  // Garde `!active.isActive` : si une session tourne déjà (ouverte ailleurs), on ne la
  // détourne pas — openFor() la fermerait en commettant son temps au journal de l'AUTRE
  // projet (fermeture silencieuse du store), un geste qui n'appartient pas à « réafficher
  // le chrono ».
  if (next && ctx === 'project' && !active.isActive) {
    await active.openFor(p.id, SESSION_NO_SECTION, 0)
  }
  // Retour en un geste, jamais d'aller sans retour (08/09) : après un MASQUAGE réussi,
  // le snackbar maison porte « Réafficher » — qui rappelle CETTE fonction (next recalculé à
  // true : persistance + réouverture de session ci-dessus, mêmes garanties d'ordre). Pas de
  // snackbar au réaffichage : la pastille est déjà le retour visuel.
  if (!next) {
    snackbar.show(t('reader.timerHidden'), {
      actionLabel: t('reader.showTimer'),
      onAction: () => toggleTimerFromReader(),
    })
  }
}

// Instantané « décochage sans perte » écrit par la bascule « section faite » de la fiche
// projet (section-mark.js via ProjectDetailView.onToggleSection) : le lecteur ne le lit pas,
// mais persist() reconstruit un snapshot en whitelist — sans ce report, la première coche
// détruirait sectionSnap en silence (défaut découvert au passage, intent 2026-09-30-reprise).
// Réinitialisé à chaque loadState (lecture de la vérité Dexie/localStorage), jamais réactif :
// il ne peut pas changer PENDANT une session lecteur (la bascule vit sur un autre écran).
let savedSectionSnap = null

function loadState() {
  let saved
  // Taille bornée aux tailles du patron : un index hérité d'un AUTRE patron (patron lié changé
  // dans l'édition du projet, qui garde `readerState`) ferait compter toutes les répétitions
  // comme faites (total[i] absent = 0). Hors bornes, il vaut « aucune » et le libellé
  // `activeSize` reprend la main ci-dessous.
  const nSizes = reader.value?.sizeLabels?.length ?? 0
  const validSize = (i) => (Number.isInteger(i) && i >= 0 && i < nSizes ? i : null)
  if (ctx === 'project') {
    saved = project.value?.readerState || {}
    if (validSize(saved.size) == null && project.value?.activeSize) {
      const i = reader.value.sizeLabels.indexOf(project.value.activeSize)
      if (i >= 0) saved = { ...saved, size: i }
    }
  } else {
    try {
      saved = JSON.parse(localStorage.getItem(lsKey.value)) || {}
    } catch {
      saved = {}
    }
  }
  st.size = validSize(saved.size)
  st.done = saved.done || {}
  st.counters = saved.counters || {}
  // Exemplaires 2+ des sections répétables et exemplaire actif : absents des anciens projets.
  st.copyState = saved.copyState || {}
  // Une partie de chaussette x2 sans exemplaire actif (ajoutée au patron pendant la chaussette 2)
  // suit les autres parties (alignSockActiveCopy).
  st.activeCopy = alignSockActiveCopy(sections.value, saved)
  // Technique des chaussettes du projet (spec 2026-10-05) ; absente = l'une après l'autre.
  st.copyMode = saved.copyMode === 'simultaneous' ? 'simultaneous' : null
  savedSectionSnap = saved.sectionSnap || null
  // Trace du dernier geste de progression (intent 2026-09-30). Copie neuve, jamais un alias
  // du `readerState` vivant (même règle que les maps ci-dessus) ; les progressions d'avant
  // le chantier n'en portent pas : st.last = null → repli sur le comportement historique.
  st.last = saved.last ? { ...saved.last } : null
  // Copie neuve (jamais un alias du `readerState` vivant de Dexie/localStorage) : la
  // migration `chartRow` nu → `chartRows` a été retirée le 13/08/2026 (ménage pré-1.0,
  // réserve produit acceptée) — plus aucun producteur de ce format hérité.
  st.chartRows = { ...saved.chartRows }
  st.chartReps = { ...saved.chartReps }
  // Pas de migration nécessaire (champ neuf, aucun équivalent hérité) : lu tel quel.
  st.chartFrames = saved.chartFrames || {}
  st.chartCurtains = saved.chartCurtains || {}
}
// Appelée quand la synchro de fond (syncOnOpen(), lancée sans attendre en fin de
// onMounted) se résout : relit project/pattern/reader pour refléter une éventuelle
// fusion (édition patron.md côté PC, réconciliation fan-out du readerState) —
// c'est le pendant de l'ancienne « relecture après » qui bloquait le premier
// rendu. Ne rejoue PAS scroll/chrono/relais de correction : ceux-ci n'ont lieu
// qu'une fois, au montage, sur le contenu local initial.
async function refreshAfterSync() {
  // Écran démonté (navigation pendant la synchro), ou instance réutilisée pour un
  // AUTRE id (revue de code du 23/08) : la lecture ci-dessous porterait sur le
  // MAUVAIS patron/projet, et écrire dans project/pattern/reader.value écraserait
  // sous ses pieds l'état de l'écran actuellement affiché.
  if (!isMounted || route.params.id !== openedId) return
  const next = await loadProjectAndPattern()
  if (!isMounted || route.params.id !== openedId) return
  // Patron supprimé pendant la synchro (rare) : on laisse l'écran (et ses refs)
  // TEL QUEL plutôt que de les faire pointer sur du vide — un patron/projet
  // introuvable ici n'est pas rejoué par la garde de montage du haut de
  // onMounted, qui redirige déjà proprement au premier chargement.
  if (!next.pattern?.reader) return
  project.value = next.project
  pattern.value = next.pattern
  reader.value = next.pattern.reader
  // Ne PAS écraser `st` (la progression affichée) si l'utilisatrice a déjà coché/
  // compté quoi que ce soit depuis l'ouverture : une réconciliation fan-out basée
  // sur un `readerState` capturé AVANT son geste (patron-md-sync.js, reconcileProgress)
  // pourrait sinon faire disparaître une coche toute fraîche sous ses yeux. Le
  // contenu du patron (reader.value, juste au-dessus) reste rafraîchi dans tous les
  // cas : lui seul reflète une édition PC, sans risque d'écraser un geste de suivi.
  if (!interactedSinceMount) loadState()
  // Sans relecture de `st` : une partie de chaussette arrivée par la synchro suit quand même la
  // chaussette en cours (alignSockActiveCopy ne touche à aucune progression).
  else st.activeCopy = alignSockActiveCopy(sections.value, st)
}
// Sérialise les écritures : deux actions rapprochées (choisir taille + cocher) déclenchent
// deux persist() concurrents ; sans file, l'écriture la plus ancienne peut atterrir en dernier
// et écraser la plus récente. On applique les snapshots dans l'ordre d'appel.
let persistChain = Promise.resolve()
// Posé par persist() (seul point de passage de toute écriture locale de `st`) : sert de
// garde à refreshAfterSync() ci-dessus, pour ne jamais écraser une progression en cours
// de saisie par un résultat de synchro qui l'ignore.
let interactedSinceMount = false
// `worked` : ce snapshot vient-il d'un geste de PROGRESSION (rang coché/décoché, grille avancée,
// rideau, compteur) plutôt que d'un réglage (choix de taille, cadrage de grille) ? Si oui, on
// horodate la session de tricot DANS LE MÊME patch — une seule écriture, un seul rechargement du
// store. C'est ce témoin qui classe la tuile « Reprendre » de l'accueil (décision produit, 25/07).
async function writeSnap(snap, worked) {
  if (ctx === 'project') {
    const patch = { readerState: snap, activeSize: st.size == null ? '' : reader.value.sizeLabels[st.size] }
    if (worked) patch.lastWorkedAt = workedNow()
    await projectsStore.update(project.value.id, patch)
  } else {
    try {
      localStorage.setItem(lsKey.value, JSON.stringify(snap))
    } catch {
      /* quota / mode privé : on ignore */
    }
  }
}
// `persist({ worked: true })` = l'appelant vient de faire AVANCER le tricot (cf. writeSnap).
// Par défaut (aucun argument), le snapshot est un simple réglage et n'horodate rien.
function persist({ worked = false } = {}) {
  interactedSinceMount = true
  const snap = {
    size: st.size,
    done: { ...st.done },
    counters: { ...st.counters },
    // Absents tant qu'aucune section répétable n'a servi : un projet sans exemplaires
    // se sérialise comme avant.
    ...(Object.keys(st.copyState).length ? { copyState: { ...st.copyState } } : {}),
    ...(Object.keys(st.activeCopy).length ? { activeCopy: { ...st.activeCopy } } : {}),
    ...(st.copyMode ? { copyMode: st.copyMode } : {}),
    last: st.last ? { ...st.last } : null,
    chartRows: { ...st.chartRows },
    chartReps: { ...st.chartReps },
    chartFrames: { ...st.chartFrames },
    chartCurtains: { ...st.chartCurtains },
    // Report tel quel (jamais lu par le lecteur) : voir savedSectionSnap ci-dessus.
    ...(savedSectionSnap ? { sectionSnap: savedSectionSnap } : {}),
  }
  // `.catch` : une écriture qui échoue ne doit jamais empoisonner la file (sinon les persist
  // suivants seraient ignorés + rejet non géré).
  persistChain = persistChain.then(() => writeSnap(snap, worked)).catch(() => {})
  return persistChain
}

/* ── dérivés ── */
// Sections avec ids d'items générés (stables par version des données) : `${sec.id}#${i}`.
const sections = computed(() => withStepIds(reader.value?.sections || []))
const allSteps = computed(() => sections.value.flatMap((s) => s.steps))
const abbrKeys = computed(() => Object.keys(reader.value?.reference?.abbr || {}))
const sizeLabel = computed(() => (st.size != null ? reader.value?.sizeLabels?.[st.size] : null))
// Grille effective d'une section : sa grille propre, ou (patrons hérités seedés/persistés
// avant le multi-grilles : SABAI, Twist Loop) le chart global reader.chart. Sans ce repli,
// un patron hérité (reader.chart sans section.chart) perdrait son diagramme au rendu.
function effectiveChart(sec) {
  return sec.chart || reader.value?.chart || null
}
// Grille visible : lecture seule ou pas de taille → toutes ; sinon seulement celles de la taille.
function chartVisible(sec) {
  const ch = effectiveChart(sec)
  if (!ch) return false
  const sizes = ch.sizes
  if (!Array.isArray(sizes) || !sizes.length) return true
  if (readOnly || sizeLabel.value == null) return true
  return sizes.includes(sizeLabel.value)
}
// Une section ne compte comme « grille » que si elle porte une étape diagramme (le repli
// reader.chart ne doit pas rendre visible une section ordinaire).
const visibleChartSections = computed(() =>
  sections.value.filter((s) => s.steps.some((st) => st.chart) && chartVisible(s)),
)
const hasChart = computed(() => visibleChartSections.value.length > 0)
function goToChart() {
  const sec = visibleChartSections.value[0]
  if (!sec) return
  // Deux volets, cible déjà épinglée : elle est déjà visible en grand à droite, un défilement
  // du fil vers sa carte (image masquée, cf. .rstep__chart--pinned) n'aurait aucun effet utile
  // — on donne le focus au volet à la place (même geste que le renvoi .rchart-ref).
  if (splitMode.value && activeChartSection.value?.id === sec.id) {
    focusPane()
    return
  }
  document.getElementById('rchart-' + sec.id)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
}
// Renvoi du fil vers le volet : on donne le focus au diagramme épinglé plutôt que de
// faire défiler (le volet est fixe, il est déjà entièrement visible).
const paneStage = ref(null)
function focusPane() {
  paneStage.value?.focusViewport()
}

// Un rang « fait » (coché) ; un compteur de répétitions « fait » quand il atteint le total
// (0 répétition pour la taille = déjà fait) ; notes/diagramme n'entrent pas dans la progression.
function stepTotal(step) {
  return repeatTotal(step, st.size)
}
// Section d'une étape (ids `<section>#<index>`). Les ids d'étape sont communs à tous les
// exemplaires : seul le conteneur de progression change (copyView).
const sectionById = computed(() => new Map(sections.value.map((s) => [s.id, s])))
function sectionOfStep(id) {
  return sectionById.value.get(String(id).slice(0, String(id).lastIndexOf('#')))
}
// Simultané : les deux exemplaires sont visibles à la fois (pas d'exemplaire actif).
const isSimul = (sec) => copiesOf(sec) > 1 && copyModeOf(sec, st.copyMode) === 'simultaneous'
function isDoneIn(step, view) {
  if (step.note || step.chart) return true
  return stepIsDone(step, view.done, view.counters, st.size)
}
// Rangs faits d'un exemplaire dans la section, et exemplaire en retard (1 à égalité).
const rowsDoneIn = (sec, c) => checkableStepsOf(sec).filter((x) => isDoneIn(x, copyView(st, c))).length
const laggingOf = (sec) => laggingCopy(Array.from({ length: copiesOf(sec) }, (_, i) => rowsDoneIn(sec, i + 1)))
// Exemplaire qui reçoit les gestes sans cible précise (compteurs, notification) : l'actif en
// séquentiel, celui en retard en simultané.
const workCopyOf = (sec) => (isSimul(sec) ? laggingOf(sec) : activeCopyOf(st, sec))
// Exemplaire de travail d'une section (1 sans copies) et sa vue { done, counters }.
const activeViewOf = (sec) => copyView(st, workCopyOf(sec))
// Coche affichée : celle de l'exemplaire actif ; en simultané, faite quand les DEUX le sont.
function isDoneFor(sec, step) {
  if (isSimul(sec)) return [1, 2].every((c) => isDoneIn(step, copyView(st, c)))
  return isDoneIn(step, activeViewOf(sec))
}
// Écart entre les deux exemplaires : { n: exemplaire en retard, rows } ou null à égalité.
// (Le pluriel se règle par `count` : `n` est le numéro de chaussette, vue-i18n le lirait sinon.)
function copyGap(sec) {
  if (!isSimul(sec)) return null
  const a = rowsDoneIn(sec, 1)
  const b = rowsDoneIn(sec, 2)
  return a === b ? null : { n: laggingCopy([a, b]), rows: Math.abs(a - b) }
}
const isCountable = (step) => !step.note && !step.chart // rangs + compteurs
const isRow = isRowStep // rangs cochables (nav préc/suiv)

// Progression TOUS exemplaires confondus (même règle que readerProgress, sinon l'en-tête et
// l'onglet Sections de la fiche projet divergent).
function sectionCountable(sec) {
  return sec.steps.filter(isCountable)
}
function sectionDoneCount(sec) {
  const cs = sectionCountable(sec)
  let n = 0
  for (let c = 1; c <= copiesOf(sec); c++) {
    const v = copyView(st, c)
    n += cs.filter((x) => isDoneIn(x, v)).length
  }
  return n
}
function sectionTotalCount(sec) {
  return sectionCountable(sec).length * copiesOf(sec)
}
const doneCount = computed(() => sections.value.reduce((a, sec) => a + sectionDoneCount(sec), 0))
const totalCount = computed(() => sections.value.reduce((a, sec) => a + sectionTotalCount(sec), 0))
const progressPct = computed(() => (totalCount.value ? Math.round((doneCount.value / totalCount.value) * 100) : 0))
// État vu par la navigation (étape en cours, reprise) : pour chaque section séquentielle, la
// progression de son exemplaire de travail (workCopies, même règle que la notification : l'actif,
// ou l'exemplaire non complet quand tout l'actif est fait). Sans exemplaires, c'est `st` lui-même.
const trackState = computed(() => {
  if (!sections.value.some((sec) => copiesOf(sec) > 1)) return st
  const works = workCopies(sections.value, st, st.size)
  const done = {}
  const counters = {}
  // Comme la notification : un `last` posé sur un autre exemplaire que celui de travail d'une
  // section séquentielle n'oriente pas l'étape en cours (sans `copy` : l'exemplaire 1).
  let last = st.last
  if (last?.kind === 'step') {
    const lastSec = sectionOfStep(last.id)
    if (lastSec && copiesOf(lastSec) > 1 && !isSimul(lastSec) && (last.copy || 1) !== works[lastSec.id]) last = null
  }
  for (const sec of sections.value) {
    if (isSimul(sec)) {
      // Simultané : une étape n'est « faite » que si elle l'est dans les deux exemplaires
      // (le rang en cours est le premier où une chaussette reste à faire).
      const v1 = copyView(st, 1)
      const v2 = copyView(st, 2)
      for (const step of sec.steps) {
        if (v1.done[step.id] && v2.done[step.id]) done[step.id] = true
        if (v1.counters[step.id] != null || v2.counters[step.id] != null) {
          counters[step.id] = Math.min(v1.counters[step.id] || 0, v2.counters[step.id] || 0)
        }
      }
      continue
    }
    const v = copyView(st, works[sec.id] || 1)
    for (const step of sec.steps) {
      if (v.done[step.id]) done[step.id] = v.done[step.id]
      if (v.counters[step.id] != null) counters[step.id] = v.counters[step.id]
    }
  }
  return { ...st, done, counters, last }
})
// Étape en cours : premier rang non coché OU compteur non atteint (spec 30/09). La navigation
// préc/suiv (`isRow`) reste sur les seuls rangs.
const currentStepId = computed(() => currentStep(sections.value, trackState.value)?.step.id || null)

function sectionProgress(sec) {
  return `${sectionDoneCount(sec)}/${sectionTotalCount(sec)}`
}
// Auto-complétion : une section est « faite » quand tous ses rangs sont cochés ET tous ses
// compteurs de répétition atteints, dans tous ses exemplaires.
function sectionDone(sec) {
  const total = sectionTotalCount(sec)
  return total > 0 && sectionDoneCount(sec) === total
}

// Aperçu lecture seule : la répétition demandée (« 2 exemplaires »).
const copiesText = (c) => t(c.together ? 'reader.copies.nTogether' : 'reader.copies.n', { n: c.n })
// En-tête d'exemplaires : séquentiel seulement (en simultané, les deux coches et l'écart).
const showCopies = (sec) => copiesOf(sec) > 1 && copyModeOf(sec, st.copyMode) === 'sequential'
// Technique des chaussettes du projet (spec 2026-10-05) : un choix pour tout le projet, en haut
// du lecteur. Changer avec des rangs de chaussette faits remet ces parties à zéro, après
// confirmation ; sans progression, la bascule est immédiate.
const sockPairs = computed(() => sockPairSections(sections.value))
const techMode = computed(() => (st.copyMode === 'simultaneous' ? 'simultaneous' : 'sequential'))
const TECH_MODES = ['sequential', 'simultaneous']
const techLabel = (m) => t(m === 'simultaneous' ? 'reader.copies.together' : 'reader.copies.sequential')
const pendingTechnique = ref(null)
const isSockPair = (sec) => canWorkSimultaneously(sectionKind(sec), copiesOf(sec))
function requestTechnique(m) {
  if (m === techMode.value) return
  if (hasSockProgress(sockPairs.value, st)) pendingTechnique.value = m
  else applyTechnique(m)
}
function applyTechnique(m) {
  const next = resetSockProgress(sections.value, st)
  st.done = next.done
  st.counters = next.counters
  st.copyState = next.copyState || {}
  st.activeCopy = next.activeCopy || {}
  st.chartRows = next.chartRows || {}
  st.chartReps = next.chartReps || {}
  st.chartCurtains = next.chartCurtains || {}
  st.last = next.last ?? null
  st.copyMode = m === 'simultaneous' ? 'simultaneous' : null
  persist()
}
// Après remise à zéro : retour au premier rang de la première partie de chaussette.
function confirmTechnique() {
  const m = pendingTechnique.value
  pendingTechnique.value = null
  applyTechnique(m)
  const first = sockPairs.value[0]?.steps.find(isTrackedStep)
  if (first) nextTick(() => document.getElementById('rstep-' + first.id)?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' }))
}
const copyKey = (sec) => (isSockKind(sectionKind(sec)) ? 'chaussette' : 'generic')
function copyTitle(sec) {
  return t('reader.copies.title.' + copyKey(sec), { n: activeCopyOf(st, sec), total: copiesOf(sec) })
}
function switchCopy(sec, c) {
  st.activeCopy = { ...st.activeCopy, [sec.id]: c }
  persist({ worked: true })
}
// Exemplaire suivant (boucle sur le 1 après le dernier). Effectif tout de suite ; si l'exemplaire
// quitté n'est pas fini, confirmation légère annulable (snackbar « Annuler »).
function nextCopy(sec) {
  const from = activeCopyOf(st, sec)
  const to = from >= copiesOf(sec) ? 1 : from + 1
  const unfinished = sectionCountable(sec).some((x) => !isDoneIn(x, copyView(st, from)))
  switchCopy(sec, to)
  if (unfinished) {
    snackbar.show(copyTitle(sec), { actionLabel: t('common.undo'), onAction: () => switchCopy(sec, from) })
  }
}

/* ── actions ── */
function selectSize(i) {
  st.size = st.size === i ? null : i
  persist()
}
// Écrit dans la progression de l'exemplaire actif de la section de l'étape (exemplaire 1 =
// `st.done` / `st.counters`, les autres = `st.copyState[c]`) ; `fn(done, counters)` les mute.
function writeActiveView(id, fn, copy) {
  const sec = sectionOfStep(id)
  const c = copy ?? (sec ? workCopyOf(sec) : 1)
  if (c <= 1) return fn(st.done, st.counters)
  const v = copyView(st, c)
  const done = { ...v.done }
  const counters = { ...v.counters }
  const r = fn(done, counters)
  st.copyState = { ...st.copyState, [c]: { done, counters } }
  return r
}
// `c` : exemplaire visé (coche directe en simultané) ; sinon l'exemplaire de travail, résolu
// AVANT l'écriture (le dernier geste garde l'exemplaire touché).
function toggleDone(id, c) {
  const sec = sectionOfStep(id)
  const copy = c ?? (sec ? workCopyOf(sec) : 1)
  const checked = writeActiveView(
    id,
    (done) => {
      done[id] = !done[id]
      if (!done[id]) delete done[id]
      return !!done[id]
    },
    copy,
  )
  // Cocher ET décocher posent la trace du dernier geste (intent 2026-09-30) : la reprise
  // atterrit sur ce rang et l'étape en cours le suit.
  markStepGesture(id, copy)
  // Décocher compte AUSSI comme du tricot : c'est une correction en cours de session, donc bien
  // la preuve qu'on travaille CE projet en ce moment.
  persist({ worked: true })
  // Après avoir coché, recentrer l'écran sur le prochain rang à travailler (#6) — via
  // resumeAfterGesture : plus rien après le dernier geste = pas de défilement.
  // En simultané, le rang reste « en cours » tant que l'autre chaussette n'est pas cochée : pas de défilement.
  const step = sec?.steps.find((x) => x.id === id)
  const rowComplete = !isSimul(sec) || !step || isDoneFor(sec, step)
  if (checked && rowComplete) afterStepDone(sec, copy)
}
// Étape tout juste faite (rang coché, compteur au total). Séquentiel : si elle finit l'exemplaire
// (sur toute la chaussette pour une chaussette en plusieurs sections, copyAfterFinish), on bascule
// sa suite de sections sur l'exemplaire suivant non complet et on recentre sur son premier rang à
// faire, au lieu d'enchaîner sur la section suivante. Sinon, recentrage après le geste.
// `last` passe sur le rang visé de l'exemplaire suivant : celui du geste, posé sur l'exemplaire
// quitté, serait écarté par trackState et l'étape en cours retomberait au premier non fait du
// patron. « Annuler » rend les exemplaires et le `last` d'avant (coche du dernier rang par erreur).
function afterStepDone(sec, copy) {
  const next = sec ? copyAfterFinish(sections.value, sec, st, copy, st.size) : null
  if (!next) return nextTick(() => resumeAfterGesture())
  const prev = { last: st.last, activeCopy: st.activeCopy }
  st.last = next.copy > 1 ? { kind: 'step', id: next.step.id, copy: next.copy } : { kind: 'step', id: next.step.id }
  st.activeCopy = { ...st.activeCopy, ...Object.fromEntries(next.run.map((id) => [id, next.copy])) }
  persist({ worked: true })
  snackbar.show(copyTitle(sec), {
    actionLabel: t('common.undo'),
    onAction: () => {
      st.last = prev.last
      st.activeCopy = prev.activeCopy
      persist({ worked: true })
    },
  })
  nextTick(() => document.getElementById('rstep-' + next.step.id)?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' }))
}
const toggleCopyDone = (stepId, c) => toggleDone(stepId, c)
// Tap sur la zone d'un rang : coche l'exemplaire en retard en simultané, l'actif sinon.
function tapRow(sec, step) {
  toggleDone(step.id, sec ? workCopyOf(sec) : undefined)
}
// Notification Android du rang en cours (projet seulement) : son bouton repasse par
// toggleDone ci-dessus (rang) ou bumpCounter ci-dessous (« +1 » d'un compteur) ; le rappel
// de diagramme suit la même règle de taille que l'affichage (chartVisible). L'ACTIVATION
// ne vit plus ici (pop-up d'onboarding, spec 2026-10-01) ; la porte d'affichage
// (batteryIgnoring) suit l'état d'autorisation relu ci-dessous.
const settings = useSettingsStore()
const batteryIgnoring = ref(true)
const onboardingOpen = ref(false)
const lecteurPret = computed(() => ready.value && !tourRequested.value)
useRowNotification({
  enabled: ctx === 'project',
  project,
  reader,
  state: st,
  toggleDone,
  bumpCounter,
  isChartVisible: chartVisible,
  ready: lecteurPret,
  suspended: tourRequested,
  batteryIgnoring,
})
// Écran gardé allumé pendant le suivi d'un projet, si le réglage est actif (retiré au démontage).
useKeepScreenOn({ enabled: ctx === 'project' })

/* ── rattrapage de l'autorisation de notification (spec 2026-10-01) ── */
// Réglage true mais état effectif incomplet (restauration sur appareil neuf, autorisation
// retirée dans le système) : pop-up d'onboarding une fois PAR LANCEMENT de l'app (garde
// module-scope — « Désactiver » persiste false, donc elle ne revient pas tant que rien
// n'est réactivé). La relecture au retour au premier plan tient la porte d'affichage à
// jour sans rouvrir la pop-up.
async function verifierAutorisationNotif() {
  if (ctx !== 'project') return null
  const state = await verifyRowNotificationAuthorization({
    checkPermission: checkRowNotificationPermission,
    checkBattery: isBatteryOptimizationIgnored,
  })
  batteryIgnoring.value = state.battery.ignoring
  return state
}
watch(
  lecteurPret,
  (ok) => {
    // Ni l'aperçu bibliothèque ni un réglage faux ne consomment la garde de session :
    // elle ne tombe qu'au premier lecteur de projet où la vérification a lieu.
    if (!ok || ctx !== 'project' || notifOnboardingCheckedThisSession) return
    if (!settings.rowNotification) return
    notifOnboardingCheckedThisSession = true
    verifierAutorisationNotif().then((state) => {
      if (state && !state.ok) onboardingOpen.value = true
    })
  },
  { immediate: true },
)
let removeResumeNotif = null
// Démontage passé pendant le chargement du pont : l'écouteur reçu trop tard est retiré
// aussitôt, sinon il survivrait au lecteur (un orphelin par ouverture).
let resumeNotifDisposed = false
if (ctx === 'project' && isRowNotificationAvailable()) {
  import('@capacitor/app')
    .then(({ App }) =>
      App.addListener('resume', () => {
        if (settings.rowNotification) verifierAutorisationNotif().catch(() => {})
      }),
    )
    .then((handle) => {
      if (resumeNotifDisposed) Promise.resolve(handle?.remove?.()).catch(() => {})
      else removeResumeNotif = handle
    })
    .catch(() => {})
}
onBeforeUnmount(() => {
  resumeNotifDisposed = true
  Promise.resolve(removeResumeNotif?.remove?.()).catch(() => {})
  removeResumeNotif = null
})
// Exemplaire visé par un geste de compteur sans cible (`delta` : +1 plus, -1 moins). Simultané :
// selon le compteur de CETTE étape (counterCopy : « + » le plus bas, « − » le plus haut) ;
// sinon l'exemplaire de travail.
function counterCopyOf(step, delta) {
  const sec = sectionOfStep(step.id)
  if (!sec) return 1
  if (!isSimul(sec)) return workCopyOf(sec)
  return counterCopy([counterVal(step, 1), counterVal(step, 2)], delta)
}
// Valeur affichée : celle de l'exemplaire `c`, sinon celle de l'exemplaire que vise « + ».
function counterVal(step, c) {
  const v = copyView(st, c ?? counterCopyOf(step, 1))
  return Math.min(v.counters[step.id] || 0, stepTotal(step))
}
// Simultané : chaussette que vise « + », nommée dans le libellé du compteur.
function counterCopyLabel(sec, step) {
  return t('reader.copies.title.' + copyKey(sec), { n: counterCopyOf(step, 1), total: copiesOf(sec) })
}
// `c` : exemplaire visé (appui de la notification) ; sinon résolu AVANT l'écriture (le geste
// peut faire changer l'exemplaire en retard, le dernier geste doit garder celui touché).
function bumpCounter(step, delta, c) {
  const copy = c ?? counterCopyOf(step, delta)
  const total = stepTotal(step)
  const before = counterVal(step, copy)
  const after = Math.max(0, Math.min(total, before + delta))
  writeActiveView(
    step.id,
    (_done, counters) => {
      counters[step.id] = after
    },
    copy,
  )
  // Plus ET moins posent la trace du dernier geste (intent 2026-09-30), comme un cochage.
  markStepGesture(step.id, copy)
  persist({ worked: true })
  // Total atteint : même suite qu'un cochage (afterStepDone).
  if (total > 0 && before < total && after >= total) afterStepDone(sectionOfStep(step.id), copy)
}
function chartRow(secId) {
  const row = st.chartRows[secId] || 1
  if (!tourRequested.value) return row
  // Visite guidée (retour device du 23/09/2026) : au rang 1 d'un projet neuf, la bulle du
  // diagramme annonce des rangs grisés qui n'existent pas encore. Tant que la visite dure,
  // la grille AFFICHE donc un rang d'exemple, un quart de la hauteur (6 sur 24 pour le
  // bonnet), jamais en deçà du vrai rang. Affichage seul : st.chartRows, donc la
  // progression enregistrée, n'est pas touché.
  const sec = sections.value.find((s) => s.id === secId)
  const rows = Number(sec && effectiveChart(sec)?.rows) || 0
  return Math.max(row, Math.min(rows, Math.max(2, Math.round(rows / 4))))
}
function setChartRow(secId, r) {
  st.chartRows[secId] = r
  const cur = st.chartCurtains[secId]
  if (cur) st.chartCurtains[secId] = retractCurtain(cur)
  // Avancer dans une grille est la façon de tricoter un patron suivi au diagramme : c'est
  // exactement l'équivalent d'un rang coché côté texte.
  markChartGesture(secId)
  persist({ worked: true })
}
function chartRep(secId) {
  return st.chartReps[secId] || 1
}
// Geste de progression SUR UNE ÉTAPE (coche, décoche, compteur plus/moins) : trace du dernier
// geste (intent 2026-09-30) + effacement du badge. `st.last` est toujours REMPLACÉ, jamais
// muté en place — le computed de la notification s'abonne au remplacement de la propriété.
function markStepGesture(id, c) {
  const sec = sectionOfStep(id)
  const copy = c ?? (sec ? workCopyOf(sec) : 1)
  // `copy` seulement au-delà de l'exemplaire 1 : un projet sans exemplaires garde son `last` d'avant.
  st.last = copy > 1 ? { kind: 'step', id, copy } : { kind: 'step', id }
  clearResumeBadge()
}
// Geste de progression DANS une grille (rang, rideau, répétition) : trace du dernier geste
// (intent 2026-09-30, kind 'chart' — la reprise atterrira sur la carte de CE diagramme) +
// effacement du badge. Regroupé : les trois setters partagent la même règle, `persist` reste
// chez chacun (worked diffère d'un appel à l'autre).
function markChartGesture(secId) {
  st.last = { kind: 'chart', id: secId }
  clearResumeBadge()
}
function setChartRep(secId, r) {
  st.chartReps[secId] = r
  markChartGesture(secId)
  persist({ worked: true })
}
function chartFrame(secId) {
  return st.chartFrames?.[secId] || null
}
function setChartFrame(secId, frame) {
  if (frame) st.chartFrames[secId] = frame
  else delete st.chartFrames[secId]
  persist()
}
function chartCurtain(secId) {
  return st.chartCurtains?.[secId] || null
}
function setChartCurtain(secId, curtain) {
  if (curtain) st.chartCurtains[secId] = curtain
  else delete st.chartCurtains[secId]
  // Le rideau matérialise le rang où l'on en est dans la grille : le bouger, c'est avancer.
  markChartGesture(secId)
  persist({ worked: true })
}
// readOnly est une const booléenne (calculée une fois depuis route.name), pas une ref :
// on la passe telle quelle au payload du store (pas de .value à déréférencer).
function openChartZoom(sec) {
  chartZoom.show({
    chart: effectiveChart(sec),
    row: chartRow(sec.id),
    rep: chartRep(sec.id),
    frame: chartFrame(sec.id),
    curtain: chartCurtain(sec.id),
    readOnly,
    onRow: (r) => setChartRow(sec.id, r),
    onRep: (k) => setChartRep(sec.id, k),
    onFrame: (f) => setChartFrame(sec.id, f),
    onCurtain: (c) => setChartCurtain(sec.id, c),
  })
}
// Grille sans compteur de répétition (pas de « · répéter N fois » dans le MD) : la tricoteuse
// déclare combien de fois répéter la grille. Saisie simple (app perso) ; réglable ensuite.
function requestReps(sec) {
  const ch = effectiveChart(sec)
  if (!ch) return
  const n = Number(window.prompt(t('reader.chart.addRep'), '2'))
  if (Number.isFinite(n) && n >= 1) {
    ch.reps = Math.round(n)
    st.chartReps[sec.id] = 1
    persist()
  }
}
// Grille importée sans nombre de rangs connu (rows:0) : la tricoteuse l'indique pour activer le
// suivi rang-par-rang. Contrairement à requestReps, on l'écrit dans le READER DU PATRON (durable,
// survit au rechargement) — c'est une propriété intrinsèque du diagramme, pas de la progression.
async function requestRows(sec) {
  const ch = effectiveChart(sec)
  if (!ch || readOnly) return
  // Corriger un nombre de rangs déjà saisi (retour terrain 26/08 : une fois indiqué, il n'y
  // avait plus moyen de rectifier une erreur de frappe) réutilise ce même prompt — sa valeur
  // par défaut reflète alors ce qui est déjà enregistré, pas toujours 20.
  const n = Number(window.prompt(t('reader.chart.setRowsPrompt'), String(Number(ch.rows) > 0 ? ch.rows : 20)))
  if (!Number.isFinite(n) || n < 1) return
  ch.rows = Math.round(n)
  // Position CONSERVÉE, simplement bornée au nouveau total. Une remise à 1 était juste tant que
  // ce prompt ne servait qu'aux grilles importées sans rangs connus (rows:0, aucune position à
  // préserver) ; depuis qu'il sert aussi à RECTIFIER un nombre déjà saisi (bouton « modifier »
  // de ReaderChart, d'où la valeur par défaut ci-dessus tirée de ch.rows), elle renvoyait la
  // tricoteuse au rang 1 — une perte de progression. Sur le chemin d'origine, chartRow() vaut
  // déjà 1 : comportement inchangé.
  st.chartRows[sec.id] = Math.min(chartRow(sec.id), ch.rows)
  // Persistance durable du reader (IndexedDB) : le nombre de rangs saisi ne doit pas être perdu
  // au rechargement (« jamais perdre d'info »). Le round-trip MD/SAF complet est un suivi séparé.
  if (pattern.value?.id != null) await patternsStore.update(pattern.value.id, { reader: reader.value })
  persist()
}
function resume(behavior = 'smooth') {
  const id = currentStepId.value
  if (id) document.getElementById('rstep-' + id)?.scrollIntoView({ behavior, block: 'center' })
}

/* ── reprise sur le dernier geste (intent 2026-09-30) ── */

// Recentrage APRÈS un geste de progression (cochage, compteur atteint) : la première étape
// non faite APRÈS le dernier geste, SANS repli — plus rien après = pas de défilement (finir la
// tête ne doit pas ramener brutalement au corps). Le recentrage historique visait l'étape en
// cours, qui depuis le chantier « reprise » replie vers le premier non fait du patron : un
// yank indésirable ici. Pour qui suit l'ordre : identique à l'ancien comportement.
function resumeAfterGesture(behavior = 'smooth') {
  const lp = st.last?.kind === 'step' ? nextStepAfter(sections.value, trackState.value, st.last.id) : null
  if (lp) document.getElementById('rstep-' + lp.step.id)?.scrollIntoView({ behavior, block: 'center' })
}

// Atterrissage de la reprise (montage, repli de `?section=`) : la dernière place travaillée
// résolue par lastPlace — étape → carte du rang ; grille → volet focus s'il est épinglé
// (même geste que goToChart), sinon carte du diagramme, repli ancre de section. Renvoie la
// sorte de cible atteinte ('step'|'chart') ou null (rien de résolvable : l'appelant retombe
// sur le chemin historique, sans badge).
function goToLastWorked(behavior = 'smooth') {
  const lp = lastPlace(sections.value, trackState.value, reader.value)
  if (!lp) return null
  if (lp.kind === 'step') {
    document.getElementById('rstep-' + lp.step.id)?.scrollIntoView({ behavior, block: 'center' })
    return 'step'
  }
  if (splitMode.value && activeChartSection.value?.id === lp.section.id) {
    focusPane()
    return 'chart'
  }
  const card = document.getElementById('rchart-' + lp.section.id)
  if (card) {
    card.scrollIntoView({ behavior, block: 'center' })
    return 'chart'
  }
  const secEl = document.getElementById('rsec-' + lp.section.id)
  if (secEl) {
    secEl.scrollIntoView({ behavior, block: 'start' })
    return 'chart'
  }
  return null
}

// Badge de reprise : pill flottante sous l'en-tête qui explique POURQUOI le lecteur est placé
// là, puis s'efface. Un timer seul la lève (5 s) ; tout geste de progression la lève aussi
// (elle n'a plus de sens une fois qu'on retricote). Jamais pendant la visite guidée, qui
// n'affiche rien d'autre que ses bulles. Aucun glyphe : le texte porte tout le sens.
const RESUME_BADGE_MS = 5000
const resumeBadge = ref(null)
let resumeBadgeTimer = null
function flashResumeBadge(kind) {
  if (tourRequested.value) return
  resumeBadge.value = kind
  clearTimeout(resumeBadgeTimer)
  resumeBadgeTimer = setTimeout(() => {
    resumeBadge.value = null
  }, RESUME_BADGE_MS)
}
function clearResumeBadge() {
  clearTimeout(resumeBadgeTimer)
  resumeBadge.value = null
}

// Puce « Revenir à mon étape » : centrage sur l'étape en cours (qui suit le dernier geste
// depuis le chantier « reprise ») + badge — il explique la place visée, d'un geste comme de
// l'autre.
function resumeToCurrent() {
  if (!currentStepId.value) return
  resume()
  flashResumeBadge('step')
}

// Sommaire : clic sur une entrée → réutilisation de l'ancre existante (`?section=<id>`,
// même cible que l'onglet Sections de la fiche projet) puis scroll vers `#rsec-<id>`.
// Le `await` garde le même ordre garantie-que-navigations que `startFix` : l'URL est
// inscrite AVANT tout autre mouvement. Une section encore introuvable dans le DOM
// (correction qui vient de renommer le titre) est ignorée sans erreur.
// 31/08 : le routeur rend maintenant la main sur le lecteur portant `?section=` (`return
// false`, cf. src/router/index.js) — plus rien n'écrase ce scroll. Et le `behavior` passe
// par scrollBehavior() au lieu d'un 'smooth' en dur : la règle CSS prefers-reduced-motion
// ne gouverne pas un behavior passé en ARGUMENT à scrollIntoView (piège mesuré deux fois
// dans ce projet, documenté en tête du module).
async function goToSection(id) {
  await router.push({ query: { ...route.query, section: id } })
  document.getElementById('rsec-' + id)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
}

/* ── visite guidée (lot du 23/09/2026) ── */
// Cibles des trois bulles, résolues au moment où la visite s'ouvre (le DOM du lecteur est
// alors rendu). Une cible absente (patron sans tailles, sans diagramme) fait sauter la
// bulle. Les ids d'étape portent un `#` (`bordure#0`) : getElementById, jamais un
// querySelector nu.
// Diagramme : la cible est la FENÊTRE de la grille (`.chart__viewport`), pas la carte
// entière, trop haute pour partager l'écran avec la bulle ; elle y est recentrée sur la
// bande du rang en cours (même calcul que ReaderChart au changement de rang, qui ne le
// fait pas au montage), et cette bande est le `focus` à garder visible.
function chartCard() {
  const sec = visibleChartSections.value[0]
  return sec ? document.getElementById('rchart-' + sec.id) : null
}
function centerChartBand(vp) {
  const band = vp.querySelector('.chart__hl')
  if (band) vp.scrollTop = band.offsetTop - vp.clientHeight / 2 + band.offsetHeight / 2
}
const tourSteps = [
  { key: 'size', target: () => document.querySelector('.reader .szcard') },
  {
    key: 'steps',
    target: () => {
      const sec = sections.value.find((s) => s.steps.some(isRow))
      return sec ? document.getElementById('rsec-' + sec.id) : null
    },
    // Section longue : c'est l'étape en cours qui doit rester visible à côté de la bulle.
    focus: () => (currentStepId.value ? document.getElementById('rstep-' + currentStepId.value) : null),
  },
  {
    key: 'chart',
    target: () => {
      // Deux volets : le diagramme est épinglé à droite, c'est lui qu'on montre.
      if (splitMode.value) return document.querySelector('.reader .rpane')
      const card = chartCard()
      return card?.querySelector('.chart__viewport') || card
    },
    focus: () => (splitMode.value ? null : chartCard()?.querySelector('.chart__hl')),
    prepare: (el) => {
      if (el.classList.contains('chart__viewport')) centerChartBand(el)
    },
  },
]
// Retour du focus au bouton retour de l'en-tête (revue finale, lot du 23/09/2026, constat
// mineur n°5) : `ReaderTour` (useDialogFocusReturn) ne sait restaurer le focus QU'AU
// déclencheur d'OUVERTURE — introuvable quand la visite a été lancée depuis les Réglages ou
// le Guide, puisque leur bouton a été démonté par la navigation qui a mené ici. Le focus
// retombe alors sur <body>, sans repère clavier pour la suite. Cf. `finishTour` ci-dessous.
const backBtn = ref(null)

// Fin de visite (Passer, Échap ou Commencer) : la visite se ferme, l'URL perd `tour`
// (un retour arrière ou un rechargement ne la relance pas) et le chrono, différé tant
// qu'elle durait, est ouvert comme à une ouverture ordinaire du lecteur.
async function finishTour() {
  tourRequested.value = false
  const { tour: _tour, ...query } = route.query
  await router.replace({ query })
  if (!isMounted) return
  await openReaderChrono()
  // Filet de focus (cf. le commentaire de `backBtn` ci-dessus) : `useDialogFocusReturn` a
  // déjà eu sa chance à l'unmount de ReaderTour (flush 'post', avant cet `await`) — s'il
  // n'a rien pu restaurer (déclencheur d'une autre page, démonté), le focus est encore sur
  // <body> ici. On le pose alors explicitement sur le bouton retour de l'en-tête, plutôt
  // que de laisser la visite se terminer sans aucun repère clavier.
  await nextTick()
  if (isMounted && document.activeElement === document.body) backBtn.value?.focus()
}

/* ── panneaux ── */
const sheetOpen = ref(false)
const sheetTab = ref('')
// Aide-mémoire AFFICHÉ : la référence du patron (absente sur un patron manuel) + le mémo des
// points épinglés. Les infobulles d'abréviation restent sur `reader.reference`, jamais sur ceci.
const helpReference = computed(() =>
  reader.value ? withStitchMemo(reader.value.reference || null, resolveStitches(pattern.value?.stitchPins, locale.value)) : null,
)
const pickerOpen = ref(false)
function openStitchPicker() {
  sheetOpen.value = false
  pickerOpen.value = true
}
// Sélection du mémo des points : propre au PATRON (champ de premier niveau, hors `reader`,
// qui est remplacé en bloc par la synchro MD et la correction). Écrite à chaque bascule,
// y compris en aperçu bibliothèque : ce n'est pas de la progression.
async function saveStitchPins(next) {
  if (pattern.value?.id == null) return
  pattern.value = { ...pattern.value, stitchPins: next }
  await patternsStore.setStitchPins(pattern.value.id, next)
}
function openHelp(tab) {
  if (!helpReference.value) return
  sheetTab.value = tab || helpReference.value.tabs[0].id
  sheetOpen.value = true
}

// Aide-mémoire : accès au PDF original du patron (même donnée que la fiche projet).
// Absent si le patron n'a pas de PDF (import IA sans PDF, patron manuel) → pas de tuile morte.
const originalPdf = computed(() => pattern.value?.pdf || '')

// Couverture du patron en tête de la visu (spec 2026-09-26) : pour un PDF importé, la page 1
// telle que la créatrice l'a composée ; pour un patron manuel, l'image choisie en galerie.
const lightbox = useLightboxStore()
const coverSrc = computed(() => patternCoverOf(pattern.value))
function openCover() {
  lightbox.show([coverSrc.value], 0)
}

async function openOriginalPdf() {
  try {
    await openPdfExternally(originalPdf.value, 'patron.pdf')
  } catch {
    snackbar.show(t('patternExtras.openError'))
  }
}

/* ── tooltip abréviation ── */
const pop = reactive({ open: false, text: '', link: null, x: 0, y: 0 })
function onAbbr({ key, rect }) {
  if (!reader.value.reference) return
  const def = reader.value.reference.abbr[key]
  if (!def) return
  pop.text = `${key} — ${def}`
  pop.link = reader.value.reference.abbrLink?.[key] || null
  pop.open = true
  // positionne au-dessus du mot (repli en dessous si trop haut), après le rendu
  requestAnimationFrame(() => {
    const el = document.getElementById('reader-pop')
    const w = el ? el.offsetWidth : 240
    const h = el ? el.offsetHeight : 60
    pop.x = Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, window.innerWidth - w - 8))
    pop.y = rect.top - h - 8 < 8 ? rect.bottom + 8 : rect.top - h - 8
  })
}
function popTechnique() {
  pop.open = false
  openHelp(pop.link)
}
/* ── correction depuis le suivi ── */
// Identifiant (`sec.id#i` pour une carte, `sec.id` brut pour
// un titre de section) de la cible qui porte le voile, ou `null`. UN SEUL
// voile à la fois — c'est un `ref` scalaire, pas un ensemble, exprès.
// ⚠️ Pas de préfixe distinct entre les deux formes : une collision voudrait
// qu'un `sec.id` brut contienne lui-même un `#`, ce qu'aucun producteur ne
// fait (slug() de normalizeReaderForSave ne produit que `[a-z0-9-]`, et les
// ids codés à la main des patrons de démo — `'bordure'`, `'corps'`… — n'en
// portent pas non plus, vérifié sur src/constants/demo/fr.js). Le séparateur
// `#` de `step.id` suffit donc à les distinguer par construction.
const fixTarget = ref(null)
// Un appui sur une carte pose le voile ; sur une autre carte, il s'y déplace.
// Deux règles passent avant, dans cet ordre :
// 1. ⚠️ Un appui sur un CONTRÔLE de la carte garde son effet et ne pose jamais
//    le voile : la case à cocher (.rcheck), les abréviations (.rl-abbr, ce sont
//    des <button>), les boutons du compteur de répétition et toute la barre du
//    diagramme. Un seul prédicat plutôt qu'une liste de classes : une classe
//    oubliée deviendrait un geste volé, alors qu'un contrôle non prévu se
//    comporte ici correctement par défaut. Cette règle vaut aussi dans le tiers
//    gauche ci-dessous.
// 2. Sur une carte cochable (rang/action, `checkable`) SEULEMENT, un appui dans
//    le premier tiers gauche de la carte, sur toute sa hauteur, coche ou décoche
//    la case comme `.rcheck` lui-même (inCheckZone, card-check-zone.js) : en
//    tricotant, on vise la case sans précision. Ce geste ne pose ni ne retire
//    aucun voile, comme un appui sur la case. Mesuré sur `currentTarget` (la
//    carte), jamais sur `target` (un fragment du texte).
// `target` : un `step` (id `sec.id#i`) pour les 4 types de carte, un `sec`
// (id brut) pour un titre de section — les deux exposent un
// `.id`, `onCardTap` n'a besoin de rien d'autre.
function onCardTap(e, target, checkable = false) {
  if (readOnly) return
  if (e.target.closest('button, a, input, select, textarea')) return
  if (checkable) {
    const box = e.currentTarget.getBoundingClientRect()
    if (inCheckZone(e.clientX, box.left, box.width)) {
      tapRow(sectionOfStep(target.id), target)
      return
    }
  }
  fixTarget.value = target.id
}
// Partir corriger : la session est mise en PAUSE à l'instant du départ (le temps passé dans
// l'éditeur n'est pas du tricot — une seule entrée au journal pour toute la session). Elle
// n'est plus close pour autant : l'écran de correction est DANS la bulle du projet (le garde
// du routeur ne tire pas vers `pattern-correct`), et le relais `chronoWasRunning` la relance
// au retour. L'ancien drapeau `chronoHeld` — qui disait à onBeforeUnmount de NE PAS clore —
// a disparu avec la fermeture au démontage elle-même (chantier « chrono unifié », 2026-08-30).
async function startFix(sec, step) {
  fixTarget.value = null
  if (ctx !== 'project' || !pattern.value) return
  // `step.id` vaut `sec.id#i` (cf. le computed `sections`) : la position est ce
  // qui suit le `#`. Aucun identifiant propre à la ligne n'existe dans le
  // modèle — cet identifiant est POSITIONNEL, il n'a de valeur qu'à l'aller.
  const stepIndex = Number(String(step.id).split('#')[1])
  const wasRunning = active.running
  if (showTimer.value) {
    await active.pause()
  }
  correctionHandoff.set({
    projectId: Number(project.value.id),
    sectionId: sec.id,
    stepIndex,
    chronoWasRunning: wasRunning,
  })
  // L'écran de correction revient par `router.back()`, qui restaure l'URL
  // EXACTE du lecteur : on y inscrit la section AVANT de partir, pour revenir
  // sur le bloc corrigé et non sur l'étape courante.
  // ⚠️ `await` OBLIGATOIRE. Sans lui, vue-router peut abandonner cette
  // navigation quand le `push` ci-dessous arrive dans le même tick : le
  // `router.back()` de l'écran de correction ramènerait alors sur l'URL SANS
  // `?section=`, donc sur l'étape courante et non sur le bloc corrigé. Le test
  // unitaire ne peut pas voir ce défaut (le routeur y est mocké, les deux appels
  // réussissent toujours) — seul l'e2e « le retour ramène sur la section
  // corrigée » le couvre.
  await router.replace({ query: { ...route.query, section: sec.id } })
  // Deux paramètres SÉPARÉS, jamais `?step=corps#3` : le `#` ouvre un fragment
  // d'URL et la requête s'arrêterait à `corps`.
  router.push({
    name: 'pattern-correct',
    params: { id: pattern.value.id },
    query: { section: sec.id, line: stepIndex },
  })
}
// Version de `startFix` pour l'en-tête de section : aucun `step` disponible,
// donc aucun `stepIndex` à transporter. `CorrectionView.vue` retombe déjà
// nativement sur `sectionLine` (le numéro de ligne du `## Titre`) quand
// `line` est absent — inutile de le calculer ici.
async function startFixSection(sec) {
  fixTarget.value = null
  if (ctx !== 'project' || !pattern.value) return
  const wasRunning = active.running
  if (showTimer.value) {
    await active.pause()
  }
  correctionHandoff.set({
    projectId: Number(project.value.id),
    sectionId: sec.id,
    chronoWasRunning: wasRunning,
  })
  // Même garde d'ordre que `startFix` : `await` avant le `push`, cf. son
  // commentaire ci-dessus.
  await router.replace({ query: { ...route.query, section: sec.id } })
  router.push({
    name: 'pattern-correct',
    params: { id: pattern.value.id },
    query: { section: sec.id },
  })
}
function onDocClick(e) {
  if (pop.open && !e.target.closest('#reader-pop') && !e.target.closest('.rl-abbr')) pop.open = false
  // Un appui hors de toute carte retire le voile : sans cette règle, un voile
  // posé traînerait pendant qu'on défile.
  if (fixTarget.value && !e.target.closest('.rstep, .rnote, .rstep__chart, .rsec__head')) fixTarget.value = null
}
function onKey(e) {
  if (e.key === 'Escape') {
    // Focus sur le corps de page : le keydown du sélecteur ne reçoit rien, on ferme ici et
    // on rend la main à l'aide-mémoire comme le fait sa propre touche Échap.
    if (pickerOpen.value) {
      pickerOpen.value = false
      openHelp(STITCH_MEMO_TAB)
      return
    }
    pop.open = false
    sheetOpen.value = false
  }
}
</script>

<template>
  <div v-if="ready" class="reader" :class="{ 'reader--split': splitMode }">
    <header class="rhdr" :class="{ 'rhdr--compact': scrolled }">
      <button ref="backBtn" class="rhdr__back" :aria-label="t('common.back')" @click="leave()"><AppIcon name="chevronLeft" :size="22" /></button>
      <div class="rhdr__titles">
        <span class="rhdr__eyebrow">{{ ctx === 'project' ? project.name : t('reader.preview') }}</span>
        <h1 class="rhdr__title">{{ pattern.name }}</h1>
      </div>
    </header>

    <div v-if="!readOnly" class="rhdr__prog">
      <div class="rhdr__track"><div class="rhdr__fill" :style="{ width: progressPct + '%' }"></div></div>
      <span class="rhdr__pct">{{ progressPct }} %</span>
    </div>

    <!-- Badge de reprise (intent 2026-09-30) : explique pourquoi le lecteur est placé sur le
         dernier rang travaillé / la dernière grille, puis s'efface. role=status + aria-live :
         annoncé par les lecteurs d'écran sans voler le focus. Aucun glyphe ni icône. -->
    <Transition name="rbadge">
      <div v-if="resumeBadge" class="rbadge" role="status" aria-live="polite">
        {{ resumeBadge === 'chart' ? t('reader.resumeBadgeChart') : t('reader.resumeBadgeStep') }}
      </div>
    </Transition>

    <main class="screen">
      <!-- Placée en TÊTE du contenu, avant la carte de taille : plus bas dans le flux, elle
           atterrissait vers y≈300 et la barre d'action fixe (84px, z-index 40) la recouvrait
           en paysage tant qu'on n'avait pas fait défiler. C'est aussi l'ordre logique — à la
           réouverture d'un patron commencé, « revenir à mon étape » est la 1re chose voulue. -->
      <div v-if="!readOnly && currentStepId" class="chips">
        <button class="chip chip--resume" @click="resumeToCurrent()"><AppIcon name="resume" :size="16" /> {{ t('reader.resume') }}</button>
      </div>

      <!-- Couverture du PDF : ouvre la visu comme elle ouvre le PDF. Après la puce
           « Reprendre », qui doit rester hors de portée de la barre d'action fixe. -->
      <button v-if="coverSrc" type="button" class="rcover" :aria-label="t('reader.coverOpen')" @click="openCover">
        <img :src="coverSrc" alt="" decoding="async" />
      </button>

      <!-- Sélecteur de taille (uniquement en suivi de projet) -->
      <section v-if="!readOnly && reader.sizeLabels?.length" class="szcard">
        <h2>{{ t('reader.chooseSize') }}</h2>
        <p class="szcard__hint">{{ reader.easeHint }}</p>
        <div class="szpills">
          <button
            v-for="(lab, i) in reader.sizeLabels"
            :key="i"
            class="szpill"
            :class="{ 'szpill--on': st.size === i }"
            @click="selectSize(i)"
          >
            {{ sizeLabelText(lab, t) }}<small v-if="reader.sizeSub">{{ reader.sizeSub[i] }}</small>
          </button>
        </div>
        <p class="szcard__chosen">
          <template v-if="st.size == null">{{ t('reader.noSize') }}</template>
          <template v-else
            >{{ t('reader.sizeChosen', { size: sizeLabelText(reader.sizeLabels[st.size], t) }) }}
            <template v-if="reader.sizeSub"> · {{ reader.sizeSubLabel }} {{ reader.sizeSub[st.size] }}</template></template
          >
        </p>
      </section>

      <!-- Technique des chaussettes (projet seulement, spec 2026-10-05) : même pastilles que la taille. -->
      <section v-if="!readOnly && sockPairs.length" class="szcard techcard">
        <h2 id="techcard-title">{{ t('reader.copies.technique') }}</h2>
        <div class="szpills" role="radiogroup" aria-labelledby="techcard-title">
          <button
            v-for="m in TECH_MODES"
            :key="m"
            type="button"
            role="radio"
            class="szpill"
            :class="{ 'szpill--on': techMode === m }"
            :aria-checked="String(techMode === m)"
            @click="requestTechnique(m)"
          >
            {{ techLabel(m) }}
          </button>
        </div>
      </section>

      <p v-if="readOnly" class="ro-note">{{ t('reader.readOnlyNote') }}</p>
      <!-- Aperçu lecture seule : légende des marqueurs de suivi. Les marqueurs eux-mêmes
           sont décoratifs (aria-hidden), c'est ELLE qui porte le sens — texte réel, lisible
           par TalkBack, pas un aria-label. -->
      <div v-if="readOnly" class="rlegend">
        <span class="rlegend__title">{{ t('reader.legend.title') }}</span>
        <span class="rlegend__item">
          <span class="rmark rmark--row rlegend__ic" aria-hidden="true"><AppIcon name="check" :size="14" /></span>
          <span class="rlegend__lab">{{ t('reader.legend.check') }}</span>
        </span>
        <span class="rlegend__item">
          <span class="rmark rmark--rep rlegend__ic" aria-hidden="true"><AppIcon name="counter" :size="14" /></span>
          <span class="rlegend__lab">{{ t('reader.legend.count') }}</span>
        </span>
        <span class="rlegend__item">
          <span class="rmark rmark--note rlegend__ic" aria-hidden="true"><AppIcon name="note" :size="14" /></span>
          <span class="rlegend__lab">{{ t('reader.legend.read') }}</span>
        </span>
      </div>
      <!-- Corriger le patron : déplacé depuis la fiche patron
           vers l'aperçu Prévisualiser — uniquement en contexte bibliothèque
           (readOnly) et si le patron a des sections à corriger. Réutilise la clé
           i18n correction.entry (même libellé que l'ancien bouton fiche). -->
      <button
        v-if="readOnly && (reader.sections?.length || pattern?.gallery?.length)"
        class="btn btn--block ro-correct"
        @click="router.push({ name: 'pattern-correct', params: { id: route.params.id } })"
      >
        <AppIcon name="grid" :size="18" /> {{ t('correction.entry') }}
      </button>

      <!-- Aide-mémoire (tuiles) -->
      <section v-if="helpReference" class="amblock">
        <div class="amblock__head">
          <h2>{{ t('reader.help') }}</h2>
          <span class="amblock__sub">{{ t('reader.helpSub') }}</span>
        </div>
        <div class="amgrid">
          <button
            v-for="tile in helpReference.tiles"
            :key="tile.tab"
            class="amtile"
            :class="{ 'amtile--feature': tile.feature }"
            @click="openHelp(tile.tab)"
          >
            <span class="amtile__ic"><AppIcon :name="`tab-${tile.tab}`" :size="22" /></span>
            <span class="amtile__txt">
              <span class="amtile__t">{{ lbl(tile, 'titleKey', 'title') }}</span>
              <span class="amtile__s">{{ lbl(tile, 'subKey', 'sub') }}</span>
            </span>
            <span v-if="tile.feature" class="amtile__go"><AppIcon name="chevronRight" :size="18" /></span>
          </button>
          <button
            v-if="originalPdf"
            key="pdf-original"
            type="button"
            class="amtile amtile--feature"
            @click="openOriginalPdf"
          >
            <span class="amtile__ic"><AppIcon name="eye" :size="22" /></span>
            <span class="amtile__txt">
              <span class="amtile__t">{{ t('reader.viewPdf') }}</span>
              <span class="amtile__s">{{ t('reader.viewPdfSub') }}</span>
            </span>
            <span class="amtile__go"><AppIcon name="chevronRight" :size="18" /></span>
          </button>
        </div>
      </section>

      <!-- Sommaire : rangée de puces toujours visible (une par section), masquée si le
           patron n'a qu'une seule section — le clic émet navigate et la vue défile vers
           la section. -->
      <ReaderToc :sections="sections" :active-id="String(route.query.section || '')" @navigate="goToSection" />

      <!-- Sections & étapes (instructions reprises telles quelles) -->
      <section v-for="sec in sections" :key="sec.id" :id="'rsec-' + sec.id" class="rsec">
        <div class="rsec__head" @click="onCardTap($event, sec)">
          <div class="rsec__ic"><AppIcon :name="sectionKind(sec)" :size="24" /></div>
          <h2 class="rsec__title">{{ sectionTitleLabel(sec, t) }}</h2>
          <span v-if="!readOnly" class="rsec__prog" :class="{ 'rsec__prog--done': sectionDone(sec) }">
            <template v-if="sectionDone(sec)"><AppIcon name="check" :size="14" /> {{ t('reader.sectionDone') }}</template>
            <template v-else>{{ sectionProgress(sec) }}</template>
          </span>
          <ReaderFixOverlay v-if="fixTarget === sec.id" @fix="startFixSection(sec)" @close="fixTarget = null" />
        </div>
        <div v-if="readOnly && copiesSummary(sec)" class="rsec__copies">
          <span class="rsec__copy rsec__copy--ro"><AppIcon name="repeat" :size="14" /> {{ copiesText(copiesSummary(sec)) }}</span>
        </div>
        <div v-else-if="!readOnly && showCopies(sec)" class="rsec__copies">
          <span class="rsec__copy">{{ copyTitle(sec) }}</span>
          <button v-if="!isSockPair(sec)" type="button" class="rsec__copies-next" @click="nextCopy(sec)">{{ t('reader.copies.next.' + copyKey(sec)) }}</button>
        </div>
        <div v-else-if="!readOnly && copyGap(sec)" class="rsec__copies">
          <span class="rsec__gap">{{ t('reader.copies.gap', { ...copyGap(sec), count: copyGap(sec).rows }) }}</span>
        </div>

        <template v-for="step in sec.steps" :key="step.id">
          <!-- NOTE : information, non cochable. Aperçu lecture seule : marqueur .rmark--note
               à gauche, la note passe en flex UNIQUEMENT dans ce cas (classe rnote--ro) — en
               suivi, la note garde sa mise en page d'origine. -->
          <div v-if="step.note" class="rnote" :class="{ 'rnote--ro': readOnly }" @click="onCardTap($event, step)">
            <span v-if="readOnly" class="rmark rmark--note" aria-hidden="true"><AppIcon name="note" :size="16" /></span>
            <div class="rnote__body">
              <ReaderLine :line="step" :size-index="st.size" :abbr-keys="abbrKeys" @abbr="onAbbr" />
              <StepImages v-if="step.imgs && step.imgs.length" :imgs="step.imgs" />
            </div>
            <ReaderFixOverlay v-if="fixTarget === step.id" @fix="startFix(sec, step)" @close="fixTarget = null" />
          </div>

          <!-- DIAGRAMME (grille de la section, filtrée par taille) -->
          <div
            v-else-if="step.chart && chartVisible(sec)"
            :id="'rchart-' + sec.id"
            class="rstep__chart"
            :class="{ 'rstep__chart--pinned': splitMode && activeChartSection?.id === sec.id }"
            @click="onCardTap($event, step)"
          >
            <!-- Retour device 28/07 : les commandes de volet vivaient AU-DESSUS de la carte,
                 rien ne disait qu'elles s'y rapportaient. Elles sont désormais posées DANS la
                 barre de titre du diagramme, via les deux slots optionnels de ReaderChart (qui
                 reste agnostique du mode deux volets, cf. commentaires dans ReaderChart.vue —
                 le banc tools/mdedit le monte sans jamais fournir ces slots). -->
            <ReaderChart
              :chart="effectiveChart(sec)"
              :read-only="readOnly"
              :model-value="chartRow(sec.id)"
              :current-rep="chartRep(sec.id)"
              :frame="chartFrame(sec.id)"
              @update:model-value="(r) => setChartRow(sec.id, r)"
              @update:current-rep="(r) => setChartRep(sec.id, r)"
              @request-reps="requestReps(sec)"
              @request-rows="requestRows(sec)"
              @zoom="openChartZoom(sec)"
            >
              <!-- `canPin` et non `splitMode` : décroché, le bouton d'épinglage est le SEUL
                   moyen de revenir — s'il dépendait de `splitMode`, il disparaîtrait avec le
                   volet lui-même. Retour device 28/07 : deux chevrons nus n'expliquaient rien
                   → libellé visible à côté de l'icône, mesuré aux deux largeurs qui
                   comptent (518px/1024px) avant de choisir la longueur du texte. -->
              <template v-if="canPin" #title-actions>
                <!-- Section épinglée : le geste retour (décrocher) — « Afficher à droite »
                     n'a pas de sens ici, c'est son inverse qui est proposé. Nom accessible =
                     libellé visible tel quel (un seul bouton unpin visible à la fois, pas
                     besoin de le distinguer par section). -->
                <button
                  v-if="splitMode && activeChartSection?.id === sec.id"
                  type="button"
                  class="rchart-unpin"
                  :aria-label="t('reader.chart.unpin')"
                  @click="unpinChart"
                >
                  <AppIcon name="chevronLeft" :size="18" />
                  <span class="rchart-label">{{ t('reader.chart.unpin') }}</span>
                </button>
                <!-- Épingler à droite n'a de sens QUE pour une grille qui n'est pas déjà celle
                     affichée (branche ci-dessus) : bouton réservé aux AUTRES grilles, comme
                     aujourd'hui. Nom accessible distinct par section (au-delà de 2 grilles non
                     épinglées, « Afficher à droite » seul ne les distinguait pas) — WCAG 2.5.3
                     (Label in Name) : le libellé visible (`pinHere`) est le préfixe exact de
                     l'aria-label (`pinHereFor`), pas noyé au milieu. -->
                <button
                  v-else
                  type="button"
                  class="rchart-pin"
                  :aria-label="t('reader.chart.pinHereFor', { title: sectionTitleLabel(sec, t) })"
                  @click="pinChart(sec)"
                >
                  <AppIcon name="chevronRight" :size="18" />
                  <span class="rchart-label">{{ t('reader.chart.pinHere') }}</span>
                </button>
              </template>
              <!-- Deux volets, section épinglée : le diagramme est déjà visible en grand à
                   droite. Un arbitrage (revue finale, 28/07) : on garde la carte COMPLÈTE
                   dans le fil — légende, nombre de mailles, sens de lecture, repères de
                   premier/dernier rang, boutons « Indiquer le nombre de rangs »/« Ajouter un
                   compteur de répétition » — rien de tout cela n'est visible ailleurs pendant
                   que la grille est épinglée. Seule l'IMAGE est remplacée par cette mention :
                   c'est le seul élément réellement affiché au même instant dans le volet de
                   droite, et c'est là qu'on la cherche quand elle manque. Le renvoi cliquable
                   ramène le focus dessus. -->
              <template v-if="splitMode && activeChartSection?.id === sec.id" #viewport-replacement>
                <button type="button" class="rchart-ref" @click="focusPane">
                  <AppIcon name="chart" :size="18" />
                  <span class="rchart-ref__t">{{ sectionTitleLabel(sec, t) }}</span>
                  <span class="rchart-ref__s">{{ t('reader.chart.pinned') }}</span>
                  <AppIcon name="chevronRight" :size="16" />
                </button>
              </template>
            </ReaderChart>
            <ReaderFixOverlay v-if="fixTarget === step.id" @fix="startFix(sec, step)" @close="fixTarget = null" />
          </div>

          <!-- RÉPÉTITION : texte verbatim + compteur (interactif en projet). Aperçu lecture
               seule : marqueur .rmark--rep en premier enfant — .rstep est déjà flex, il se
               place donc à gauche du corps sans CSS supplémentaire. -->
          <article v-else-if="step.repeat" :id="'rstep-' + step.id" class="rstep rstep--rep" :class="{ 'rstep--done': !readOnly && isDoneFor(sec, step), 'rstep--cur': !readOnly && currentStepId === step.id }" @click="onCardTap($event, step)">
            <span v-if="readOnly" class="rmark rmark--rep" aria-hidden="true"><AppIcon name="counter" :size="16" /></span>
            <div class="rstep__body">
              <p class="rstep__p"><ReaderLine :line="step" :size-index="st.size" :abbr-keys="abbrKeys" @abbr="onAbbr" /></p>
              <!-- Cadence : rappel de période « tous les X rangs » (step.every). Placé HORS de .rcount,
                   gardé seulement par step.every, pour rester visible en aperçu lecture seule (où .rcount
                   est masqué) — cette info fait partie du patron, on ne la perd jamais. -->
              <p v-if="step.every" class="rstep__cadence">{{ t('reader.cadenceEvery', { every: step.every }) }}</p>
              <StepImages v-if="step.imgs && step.imgs.length" :imgs="step.imgs" />
              <div v-if="!readOnly && !(st.size != null && stepTotal(step) === 0)" class="rcount">
                <span class="rcount__lab">{{ t('reader.repeatCounter') }}<template v-if="isSimul(sec)"> · {{ counterCopyLabel(sec, step) }}</template><template v-if="st.size == null"> · {{ t('reader.pickSizeShort') }}</template></span>
                <!-- Libellés d'accessibilité : une ACTION, jamais le glyphe affiché (revue finale
                     du passage multilingue, 29/07). « moins » / « plus » annoncés tels quels par
                     TalkBack ne disent pas ce que fait le bouton, et n'étaient de surcroît pas
                     traduits — la règle « jamais de glyphe dans l'UI » vaut aussi pour un
                     aria-label (leçon déjà tirée sur la case « section faite », 18/07). -->
                <button class="rcount__btn" :disabled="counterVal(step, counterCopyOf(step, -1)) <= 0" :aria-label="t('reader.repeatMinus')" @click="bumpCounter(step, -1)"><AppIcon name="minus" :size="16" /></button>
                <span class="rcount__val" :class="{ 'rcount__val--full': counterVal(step) >= stepTotal(step) }">{{ counterVal(step) }} / {{ stepTotal(step) }}</span>
                <button class="rcount__btn" :disabled="counterVal(step) >= stepTotal(step)" :aria-label="t('reader.repeatPlus')" @click="bumpCounter(step, 1)"><AppIcon name="plus" :size="16" /></button>
              </div>
              <p v-else-if="!readOnly" class="rcount rcount--none"><span class="rcount__lab">{{ t('reader.noRepeat', { size: sizeLabelText(reader.sizeLabels[st.size], t) }) }}</span></p>
            </div>
            <ReaderFixOverlay v-if="fixTarget === step.id" @fix="startFix(sec, step)" @close="fixTarget = null" />
          </article>

          <!-- RANG / ACTION : cochable. `v-else-if="!step.chart"` et non `v-else` : une étape
               diagramme vaut littéralement `{ chart: true }` (aucun texte), donc une grille
               MASQUÉE par le filtre de taille (chartVisible faux) tombait ici et rendait une
               carte VIDE munie d'une case à cocher — case qui écrivait en plus son id dans le
               readerState persisté. Sans branche qui la retienne, la grille masquée ne rend
               plus rien, ce qui est bien le but du filtre. -->
          <article
            v-else-if="!step.chart"
            :id="'rstep-' + step.id"
            class="rstep"
            :class="{ 'rstep--done': !readOnly && isDoneFor(sec, step), 'rstep--cur': !readOnly && currentStepId === step.id }"
            @click="onCardTap($event, step, true)"
          >
            <div v-if="!readOnly && isSimul(sec)" class="rchecks">
              <button
                v-for="c in 2"
                :key="c"
                class="rcheck"
                :class="{ 'rcheck--on': isDoneIn(step, copyView(st, c)) }"
                role="checkbox"
                :aria-checked="isDoneIn(step, copyView(st, c))"
                :aria-label="t('reader.copies.checkCopy', { n: c })"
                @click="toggleCopyDone(step.id, c)"
              >
                <span class="rcheck__n" aria-hidden="true">{{ c }}</span>
                <AppIcon name="check" :size="18" />
              </button>
            </div>
            <button
              v-else-if="!readOnly"
              class="rcheck"
              role="checkbox"
              :aria-checked="isDoneFor(sec, step)"
              :aria-label="t('reader.markDone')"
              @click="toggleDone(step.id)"
            >
              <AppIcon name="check" :size="18" />
            </button>
            <!-- Aperçu lecture seule : à la place exacte de .rcheck, un marqueur de suivi
                 décoratif — la légende (.rlegend) porte le sens, pas ce marqueur. -->
            <span v-else class="rmark rmark--row" aria-hidden="true"><AppIcon name="check" :size="16" /></span>
            <div class="rstep__body">
              <p class="rstep__p"><ReaderLine :line="step" :size-index="st.size" :abbr-keys="abbrKeys" @abbr="onAbbr" /></p>
              <StepImages v-if="step.imgs && step.imgs.length" :imgs="step.imgs" />
            </div>
            <ReaderFixOverlay v-if="fixTarget === step.id" @fix="startFix(sec, step)" @close="fixTarget = null" />
          </article>
        </template>

      </section>

      <!-- Aide-mémoire rappelé en bas -->
      <section v-if="helpReference" class="amblock">
        <div class="amblock__head"><h2>{{ t('reader.help') }}</h2><span class="amblock__sub">{{ t('reader.helpAlways') }}</span></div>
        <div class="amgrid">
          <button v-for="tile in helpReference.tiles" :key="'b' + tile.tab" class="amtile" :class="{ 'amtile--feature': tile.feature }" @click="openHelp(tile.tab)">
            <span class="amtile__ic"><AppIcon :name="`tab-${tile.tab}`" :size="22" /></span>
            <span class="amtile__txt"><span class="amtile__t">{{ lbl(tile, 'titleKey', 'title') }}</span><span class="amtile__s">{{ lbl(tile, 'subKey', 'sub') }}</span></span>
            <span v-if="tile.feature" class="amtile__go"><AppIcon name="chevronRight" :size="18" /></span>
          </button>
          <button
            v-if="originalPdf"
            key="pdf-original"
            type="button"
            class="amtile amtile--feature"
            @click="openOriginalPdf"
          >
            <span class="amtile__ic"><AppIcon name="eye" :size="22" /></span>
            <span class="amtile__txt">
              <span class="amtile__t">{{ t('reader.viewPdf') }}</span>
              <span class="amtile__s">{{ t('reader.viewPdfSub') }}</span>
            </span>
            <span class="amtile__go"><AppIcon name="chevronRight" :size="18" /></span>
          </button>
        </div>
      </section>
    </main>

    <!-- Barre d'action du suivi : une seule rangée en bas (chrono | diagramme | aide-mémoire),
         disposée en flex → les boutons ne peuvent jamais se chevaucher, même à 360 px.
         Absente de l'aperçu patron (lecture seule). -->
    <div v-if="!readOnly" class="actionbar" :class="{ 'actionbar--hidden': sheetOpen }">
      <!-- chrono du suivi (démarrage manuel) : à l'arrêt, il invite clairement à le lancer.
           Composant partagé (extrait d'ici, chantier « chrono unifié », 2026-08-30) : la pastille
           lit elle-même le store activeSession pour ses états ; cette vue ne garde que la
           POLITIQUE — play/pause via toggleChrono, masquage via toggleTimerFromReader
           (branché sur le chevron de la pastille, 08/09 : l'œil a disparu), et la
           décision de l'afficher (showTimer). `can-hide` false en ctx pattern (patron
           libre, sans projet : rien à persister → pas de chevron). Ses styles propres
           vivent dans le composant ; seules les règles de disposition DANS cette barre
           restent ci-dessous (.actionbar :deep(.chrono-fab) / :deep(.chrono-fab__body)). -->
      <ChronoPill
        v-if="chronoVisible"
        :can-hide="ctx === 'project'"
        @toggle="toggleChrono"
        @hide="toggleTimerFromReader"
      />

      <!-- accès rapides compacts (icône seule + aria-label) pour tenir sur une rangée -->
      <button v-if="hasChart" class="fab fab--chart" :aria-label="t('reader.chart.short')" @click="goToChart"><AppIcon name="chart" :size="20" /></button>
      <button v-if="helpReference" class="fab fab--ref" :aria-label="t('reader.help')" @click="openHelp()"><AppIcon name="book" :size="20" /></button>

      <!-- Retour en haut : DANS `.actionbar`, mais retiré du flux de la rangée — il se pose
           AU-DESSUS du bouton aide-mémoire (retour d'usage, 01/08). Motif : sur téléphone,
           le chrono en pause affiche son état le plus large (« Reprendre » + le temps) et un
           quatrième bouton dans la rangée lui volait la place, jusqu'à tronquer « Reprendre ».
           En `position: absolute` (cf. `.actionbar :deep(.btt)` dans le bloc <style>), il ne
           consomme plus AUCUNE largeur : le chrono récupère tout l'espace, et le
           diagramme et l'aide-mémoire gardent leur position exacte, avant comme après
           son apparition.
           Il reste enfant de `.actionbar` À DESSEIN, plutôt que flottant indépendant : il
           hérite ainsi de son ancrage (donc du décalage `.reader--split .actionbar` en
           disposition deux volets), de `pointer-events: auto` (`.actionbar > *`) et de son
           effacement quand l'aide-mémoire s'ouvre (`.actionbar--hidden`). Posé en dehors, il
           faudrait redire ces trois choses, et la collision d'appui d'origine (même coin,
           même z-index que la barre) reviendrait. -->
      <BackToTop />
    </div>
    <!-- Aperçu bibliothèque (readOnly) : `.actionbar` n'existe pas (v-if ci-dessus),
         donc aucune collision de COIN possible — le bouton garde son comportement
         flottant par défaut. Sans lui ici, l'écran le plus long en lecture seule
         (patron sans suivi actif) n'aurait aucun retour en haut.
         ⚠️ Reste flottant = reste `position: fixed`, donc PAS concerné par le
         `padding-right` que `.reader--split` pose sur le fil pour le volet diagramme
         (ci-dessous). En disposition deux volets, il resterait collé au bord droit de
         l'ÉCRAN, donc sous `.rpane` (bord droit également, z-index 35 < 40 : il flotterait
         PAR-DESSUS le diagramme). Décalé par la règle `.reader--split :deep(.btt)`,
         au même endroit que `.reader--split .actionbar` un peu plus bas. -->
    <BackToTop v-else />

    <!-- Volet droit (tablette en paysage) : le diagramme épinglé, toujours visible pendant
         qu'on lit le texte. Même afficheur que le plein écran (ChartStage), donc mêmes
         pincement, rideau et compteurs. Les écritures partent dans le MÊME état que le fil
         (st.chartRows/…), il ne peut pas y avoir deux vérités sur la progression. -->
    <aside v-if="splitMode && activeChartSection" class="rpane" :aria-label="t('reader.chart.pane')">
      <ChartStage
        ref="paneStage"
        variant="panel"
        :chart="effectiveChart(activeChartSection)"
        :row="chartRow(activeChartSection.id)"
        :rep="chartRep(activeChartSection.id)"
        :frame="chartFrame(activeChartSection.id)"
        :curtain="chartCurtain(activeChartSection.id)"
        :read-only="readOnly"
        @update:row="(r) => setChartRow(activeChartSection.id, r)"
        @update:rep="(k) => setChartRep(activeChartSection.id, k)"
        @update:frame="(f) => setChartFrame(activeChartSection.id, f)"
        @update:curtain="(c) => setChartCurtain(activeChartSection.id, c)"
      >
        <template #tools>
          <button class="cfs__tool" :aria-label="t('reader.chart.zoomOpen')" @click="openChartZoom(activeChartSection)"><AppIcon name="expand" :size="20" /></button>
        </template>
      </ChartStage>
    </aside>

    <!-- panneau aide-mémoire (uniquement si le reader a un aide-mémoire) -->
    <ReaderSheet
      v-if="helpReference"
      :reference="helpReference"
      :size-labels="reader.sizeLabels"
      :size-index="st.size"
      v-model:open="sheetOpen"
      v-model:active-tab="sheetTab"
      @action="(e) => e === PICK_STITCHES_EVENT && openStitchPicker()"
      @open-chart="
        () => {
          sheetOpen = false
          goToChart()
        }
      "
    >
      <template v-if="ctx === 'project'" #footer>
        <KeepScreenOnSwitchRow heading-id="am-keep-screen-title" />
      </template>
    </ReaderSheet>

    <ConfirmDialog
      :open="pendingTechnique != null"
      :title="t('reader.copies.resetTitle')"
      :message="t('reader.copies.resetMsg')"
      :confirm-label="t('reader.copies.resetConfirm')"
      :cancel-label="t('common.cancel')"
      danger
      @confirm="confirmTechnique"
      @cancel="pendingTechnique = null"
    />

    <RowNotifOnboardingDialog
      v-if="ctx === 'project'"
      :open="onboardingOpen"
      @authorized="onboardingOpen = false; verifierAutorisationNotif()"
      @disabled="onboardingOpen = false; verifierAutorisationNotif()"
    />

    <StitchPicker
      v-if="reader"
      v-model:open="pickerOpen"
      :pins="pattern?.stitchPins || []"
      :craft="pattern?.type === 'crochet' ? 'crochet' : 'knitting'"
      :abbr-keys="Object.keys(reader.reference?.abbr || {})"
      @update:pins="saveStitchPins"
      @update:open="(o) => { if (!o) openHelp(STITCH_MEMO_TAB) }"
    />

    <!-- tooltip abréviation -->
    <div v-show="pop.open" id="reader-pop" class="rpop" :style="{ left: pop.x + 'px', top: pop.y + 'px' }" role="tooltip">
      {{ pop.text }}
      <a v-if="pop.link" class="rpop__link" href="#" @click.prevent="popTechnique">{{ t('reader.seeTechnique') }} <AppIcon name="chevronRight" :size="14" /></a>
    </div>

    <!-- Visite guidée (?tour=1) : en DERNIER, pour que toutes ses cibles soient déjà dans
         le DOM quand elle se monte et les cherche. -->
    <ReaderTour v-if="tourRequested && tourHasSlot" :steps="tourSteps" @done="finishTour" />
  </div>
  <!-- En attente (synchro MD ciblée à l'ouverture puis chargement) : évite un écran
       blanc pendant l'attente, forcément brève, de la synchro. -->
  <SkeletonScreen v-else variant="reader" />
</template>

<style scoped>
/* En-tête épinglé : le bouton Retour reste visible en permanence (patron long). */
.rhdr {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: max(var(--sp-4), var(--sa-top)) max(var(--sp-4), var(--sa-right)) var(--sp-2) max(var(--sp-4), var(--sa-left));
  max-width: var(--w-content);
  margin: 0 auto;
  background: linear-gradient(180deg, var(--bg) 82%, rgba(250, 246, 238, 0));
  transition: padding var(--motion-base);
}
/* Le point de fondu transparent doit interpoler depuis la même teinte que --bg,
   sinon un léger liseré clair (crème) apparaît pendant le fondu sur fond sombre. */
:root[data-theme='dark'] .rhdr,
html[data-theme='dark'] .rhdr {
  background: linear-gradient(180deg, var(--bg) 82%, rgba(22, 18, 16, 0));
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .rhdr {
    background: linear-gradient(180deg, var(--bg) 82%, rgba(22, 18, 16, 0));
  }
}
/* Bandeau compact au défilement (P2/T2) : moins de hauteur mangée pendant le tricot.
   Le bouton Retour garde 44×44 (cible tactile) ; seuls le rembourrage et les textes
   rétrécissent. Le surtitre n'est PAS supprimé : masquer ≠ perdre (cf. .rhdr__eyebrow). */
.rhdr--compact {
  padding-top: max(var(--sp-2), var(--sa-top));
  padding-bottom: var(--sp-1);
}
.rhdr__back {
  flex-shrink: 0;
  border: 1px solid var(--line);
  background: var(--tile);
  color: var(--ink);
  width: 44px;
  height: 44px;
  border-radius: var(--r-md);
  font-size: 22px;
  box-shadow: var(--clay-sm);
}
/* Badge de reprise : pill flottante SOUS l'en-tête (en-tête plein ~70 px de haut, compact ~60 :
   72 px sous la safe-area passe dans les deux états), centrée, NON interactive — elle explique
   un placement, elle ne doit ni voler un tap ni retenir le focus. Au-dessus de l'en-tête
   collant (z 30) pour ne pas passer dessous au défilement, sous le volet de diagramme (35),
   la barre d'action (40) et les dialogues (60). */
.rbadge {
  position: fixed;
  top: calc(var(--sa-top) + 72px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 32;
  pointer-events: none;
  max-width: min(88vw, 420px);
  padding: 6px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--tile);
  color: var(--ink);
  font-size: 13px;
  font-weight: 700;
  text-align: center;
  box-shadow: var(--clay-sm);
}
.rbadge-enter-active,
.rbadge-leave-active {
  transition: opacity var(--motion-base), transform var(--motion-base);
}
.rbadge-enter-from,
.rbadge-leave-to {
  opacity: 0;
  transform: translate(-50%, -6px);
}
.rbadge-enter-to,
.rbadge-leave-from {
  transform: translate(-50%, 0);
}
.rhdr__eyebrow {
  display: block;
  max-height: 16px;
  overflow: hidden;
  font-size: 12px;
  /* Sans ceci, hérite du line-height 1.5 du body → 12 × 1,5 = 18px, 2px de plus que le
     max-height ci-dessus : les descendantes (g, p, q, y, j) étaient rognées même à l'état
     plein. 12 × 1,3 = 15,6px tient dans les 16px, qui restent la cote utilisée par
     l'escamotage en mode compact (cf. .rhdr--compact .rhdr__eyebrow ci-dessous). */
  line-height: 1.3;
  color: var(--ink-55);
  font-weight: 700;
  transition: max-height var(--motion-base), opacity var(--motion-fast), margin-bottom var(--motion-base);
}
.rhdr--compact .rhdr__eyebrow {
  max-height: 0;
  margin-bottom: 0;
  opacity: 0;
}
.rhdr__title {
  font-size: 21px;
  transition: font-size var(--motion-base);
}
.rhdr--compact .rhdr__title {
  font-size: 16px;
}
.rhdr__prog {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  max-width: var(--w-content);
  margin: 0 auto;
  padding: 0 var(--sp-4) var(--sp-2);
}
.rhdr__track {
  flex: 1;
  height: 10px;
  border-radius: var(--r-pill);
  background: var(--surface);
  box-shadow: var(--clay-press);
  overflow: hidden;
}
.rhdr__fill {
  height: 100%;
  border-radius: var(--r-pill);
  background: linear-gradient(90deg, var(--sage-deep), var(--sage));
  transition: width var(--motion-base);
}
.rhdr__pct {
  font-size: 13px;
  font-weight: 700;
  color: var(--sage-deep);
  min-width: 42px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.screen {
  max-width: var(--w-content);
  margin: 0 auto;
  padding: 0 max(var(--sp-4), var(--sa-right)) calc(104px + var(--sa-bottom)) max(var(--sp-4), var(--sa-left));
}
.szcard {
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--clay-sm);
  padding: var(--sp-4);
  margin: var(--sp-3) 0;
}
.szcard h2 {
  font-size: 16px;
}
.szcard__hint {
  font-size: 12.5px;
  color: var(--ink-70);
  margin: 2px 0 var(--sp-3);
}
.szpills {
  display: flex;
  gap: 6px;
}
.szpill {
  flex: 1 1 0;
  min-width: 0;
  padding: 10px 2px;
  border-radius: var(--r-md);
  background: var(--surface);
  box-shadow: var(--clay-sm);
  border: 1px solid var(--line);
  font-weight: 700;
  font-size: 15px;
  color: var(--ink-70);
}
.szpill small {
  display: block;
  font-size: 10px;
  font-weight: 600;
  /* --ink-40 échoue le contraste AA (audit axe-core) ; --ink-55 passe. */
  color: var(--ink-55);
  margin-top: 2px;
}
.szpill--on {
  background: var(--sage-tile-bg);
  border-color: var(--sage-tile-line);
  color: var(--sage-deep);
}
.szpill--on small {
  color: var(--sage-deep);
}
.szcard__chosen {
  font-size: 12.5px;
  color: var(--ink-70);
  margin: var(--sp-3) 0 0;
}
.chips {
  display: flex;
  gap: var(--sp-2);
  margin: var(--sp-3) 0 0;
}
.chip--resume {
  border: none;
  background: var(--brand-grad);
  color: var(--on-accent);
  font-weight: 700;
  font-size: 12.5px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  padding: 0 13px;
  border-radius: var(--r-pill);
  box-shadow: 0 8px 16px -8px rgba(var(--brand-rgb), 0.6);
}
.rcover {
  display: flex;
  justify-content: center;
  width: 100%;
  padding: 0;
  margin: var(--sp-4) 0 16px;
  border: none;
  background: none;
  cursor: pointer;
}
.rcover img {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 70vh;
  border-radius: var(--r-lg);
}
.amblock {
  margin: var(--sp-5) 0;
}
.amblock__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 2px var(--sp-3);
}
.amblock__head h2 {
  font-size: 19px;
}
.amblock__sub {
  font-size: 12.5px;
  color: var(--ink-70);
}
.amgrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}
.amtile {
  text-align: left;
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--clay-sm);
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 108px;
}
.amtile__ic {
  width: 40px;
  height: 40px;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  background: var(--surface-lin);
  box-shadow: var(--clay-sm);
  font-size: 21px;
}
.amtile__t {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 15.5px;
  line-height: 1.15;
}
.amtile__s {
  font-size: 12px;
  color: var(--ink-70);
  line-height: 1.35;
}
.amtile--feature {
  grid-column: 1 / -1;
  flex-direction: row;
  align-items: center;
  min-height: 0;
  gap: var(--sp-3);
}
.amtile--feature .amtile__ic {
  background: var(--sage-tile-bg);
}
.amtile__txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.amtile--feature .amtile__go {
  margin-left: auto;
  color: var(--brand-deep);
  font-size: 20px;
  font-weight: 700;
}
.rsec {
  margin-bottom: var(--sp-5);
}
.rsec__head {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) 2px var(--sp-3);
}
.rsec__ic {
  width: 38px;
  height: 38px;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  background: var(--surface-lin);
  box-shadow: var(--clay-sm);
  font-size: 20px;
  flex: none;
}
.rsec__title {
  font-size: 19px;
  flex: 1;
}
.rsec__prog {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-55);
  font-variant-numeric: tabular-nums;
}
.rsec__prog--done {
  color: var(--sage-deep);
}
.rsec__copies {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  margin: 0 0 var(--sp-3);
}
.rsec__copy {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-70);
  font-variant-numeric: tabular-nums;
}
.rsec__copy--ro {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
}
.rsec__copies-next {
  min-height: 44px;
  padding: 0 var(--sp-4);
  border: 1px solid var(--ink-20, currentColor);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
}
/* note d'information (non cochable) */
.rnote {
  position: relative;
  margin: 0 0 var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  background: var(--surface-lin);
  border-radius: var(--r-md);
  color: var(--ink-70);
  font-size: 13.5px;
}
/* Aperçu lecture seule SEULEMENT : le marqueur .rmark--note se pose à gauche du texte —
   en suivi, .rnote garde sa mise en page d'origine (pas de marqueur à aligner). */
.rnote--ro {
  display: flex;
  gap: var(--sp-2);
}
.rnote__body {
  flex: 1;
  min-width: 0;
}
/* navigation Rang précédent / suivant */
.rownav {
  display: flex;
  gap: var(--sp-3);
  margin: 0 0 var(--sp-3);
}
.rownav__btn {
  flex: 1;
}
.rcount--none {
  border: none;
  background: transparent;
  box-shadow: none;
  padding: var(--sp-1) 0 0;
}
.rstep {
  position: relative;
  background: var(--tile);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--clay-sm);
  padding: var(--sp-4);
  margin-bottom: var(--sp-3);
  display: flex;
  gap: var(--sp-3);
  transition: box-shadow var(--motion-base), border-color var(--motion-base), opacity var(--motion-base);
}
.rstep--done {
  opacity: 0.58;
}
/* En sombre, `opacity: 0.58` échoue : le fond de tuile (#2a211a) descend vers le fond
   de page quasi-noir (#161210) → la carte se DISSOUT (bord perdu) et le texte crème
   devient un gris boueux illisible. On remplace donc, en sombre uniquement, l'atténuation
   par opacité (qui touche fond + bord + texte + coche) par : carte aplatie (« posée »,
   sans relief clay, bord adouci) + texte atténué mais lisible (--ink-55). La coche verte
   reste le marqueur « fait » à pleine force. Le clair garde son opacité d'origine. */
:root[data-theme='dark'] .rstep--done,
html[data-theme='dark'] .rstep--done {
  opacity: 1;
  color: var(--ink-55);
  background: var(--tile);
  border-color: var(--line-soft);
  box-shadow: none;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .rstep--done {
    opacity: 1;
    color: var(--ink-55);
    background: var(--tile);
    border-color: var(--line-soft);
    box-shadow: none;
  }
}
.rstep--cur {
  /* Fond lin EN PLUS du contour (pas à la place) : en relevant la tête, l'étape en
     cours se retrouve d'un coup d'œil sans avoir à lire.
     --surface-lin sert aussi de fond aux notes (.rnote), mais sans ambiguïté : une note
     n'a jamais le contour terracotta ni l'anneau, et son texte est italique/--ink-70.
     Écarté --surface : au banc, le gris ternit l'étape (elle paraît désactivée) et jure
     avec le contour chaud. Contraste mesuré sur lin : --ink 9,6:1, --ink-55 4,6:1 (AA). */
  background: var(--surface-lin);
  border-color: var(--brand);
  box-shadow: 0 0 0 2px rgba(var(--brand-rgb), 0.18), var(--clay);
}
.ro-note {
  font-size: 12.5px;
  color: var(--ink-70);
  font-style: italic;
  margin: 0 2px var(--sp-2);
}
.ro-correct {
  margin-bottom: var(--sp-3);
}
/* Légende des marqueurs de suivi : une ligne de titre, puis les trois marqueurs +
   libellé côte à côte — chaque item ne casse pas en deux lignes (passe à la ligne
   proprement dès 320 px de large grâce à flex-wrap sur des items entiers). */
.rlegend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2) var(--sp-3);
  margin: 0 2px var(--sp-3);
}
.rlegend__title {
  flex: 1 0 100%;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-70);
}
.rlegend__item {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-70);
  white-space: nowrap;
}
/* Marqueur décoratif : indique en aperçu lecture seule ce que l'élément deviendra en
   suivi (coche / compteur / rien) — jamais de fond ni de texte porteurs de sens, la
   légende (.rlegend) fait ce travail. Rond 26 px par défaut ; la légende réduit à 22 px
   via --rmark-size (sélecteur plus spécifique, cf. .rlegend__ic ci-dessous). */
.rmark {
  --rmark-size: 26px;
  flex: none;
  width: var(--rmark-size);
  height: var(--rmark-size);
  border-radius: var(--r-pill);
  display: grid;
  place-items: center;
  margin-top: 1px;
}
/* Rang/action : même famille que le fond « terminé » (--sage-tile-bg/--sage-deep-strong,
   cf. .corr-chip--on) — pire arrêt du dégradé mesuré aux DEUX : 5,29:1 en clair (#dde6d2),
   5,98:1 en sombre (#26302a, cf. commentaire déjà posé sur --sage-deep-strong dans
   tokens.css) — largement au-dessus des 3:1 requis (WCAG 1.4.11). */
.rmark--row {
  background: var(--sage-tile-bg);
  color: var(--sage-deep-strong);
}
/* Répétition : neutre (pas encore « fait », juste « à compter ») — --ink-55 sur --surface
   mesure 5,00:1 en clair, 6,19:1 en sombre (rgba composé sur --surface) : au-dessus du
   seuil, --ink-70 n'est pas nécessaire. */
.rmark--rep {
  background: var(--surface);
  color: var(--ink-55);
}
/* Note : sans fond (posée sur --surface-lin, le fond de .rnote) — --ink-55 y mesure
   4,67:1 en clair, 5,84:1 en sombre (rgba composé sur --surface-lin) : au-dessus du seuil. */
.rmark--note {
  background: none;
  color: var(--ink-55);
  margin-top: 0;
}
.rlegend__ic.rmark {
  --rmark-size: 22px;
}
.rcheck {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 10px;
  margin-top: 1px;
  background: var(--surface);
  box-shadow: var(--clay-press);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
}
/* :deep() : AppIcon rend son SVG via v-html, donc sans l'ID de portée scoped — un
   sélecteur `.rcheck svg` nu ne matcherait plus rien (même piège documenté par
   AppIcon.vue lui-même sur `.app-icon :deep(svg)`). */
.rcheck :deep(svg) {
  width: 18px;
  height: 18px;
  /* stroke visible UNIQUEMENT quand .rstep--done peint .rcheck en --sage (fond solide
     hors accent) : texte trait via --on-solid, statique — pas le --on-accent flippant
     de la bande chaude claire. */
  stroke: var(--on-solid);
  stroke-width: 3;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0;
}
.rchecks {
  flex: none;
  display: flex;
  gap: var(--sp-1, 4px);
}
/* Repère texte 1 / 2 : visible tant que la coche n'est pas posée, remplacé par le trait. */
.rcheck__n {
  grid-area: 1 / 1;
  font-size: 13px;
  font-weight: 800;
  color: var(--ink-55);
  line-height: 1;
}
/* Le chiffre et la coche se superposent dans la même cellule. La coche est rendue par AppIcon,
   dont l'élément de grille est l'enveloppe `.app-icon`, pas le <svg> : c'est elle qu'on place,
   sinon elle part sur une 2e ligne et le chiffre remonte dans la moitié haute de la case. */
.rchecks .rcheck :deep(.app-icon) {
  grid-area: 1 / 1;
}
.rcheck--on .rcheck__n {
  display: none;
}
.rsec__gap {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-70);
  font-variant-numeric: tabular-nums;
}
.rstep--done .rcheck,
.rcheck--on {
  background: var(--sage);
  border-color: var(--sage);
  box-shadow: var(--clay-sm);
}
.rstep--done .rcheck :deep(svg),
.rcheck--on :deep(svg) {
  opacity: 1;
}
.rstep__body {
  flex: 1;
  min-width: 0;
}
.rstep__label {
  display: inline-block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--brand-deep);
  background: rgba(var(--brand-rgb), 0.09);
  padding: 3px 9px;
  border-radius: var(--r-pill);
  margin-bottom: var(--sp-2);
}
.rstep__p {
  margin: 0 0 var(--sp-2);
}
.rstep__p:last-child {
  margin-bottom: 0;
}
/* Cadence : rappel discret « tous les X rangs », plus léger que le texte du rang. */
.rstep__cadence {
  margin: 0 0 var(--sp-2);
  font-size: 12.5px;
  color: var(--ink-70);
}
.rstep__rows {
  margin: 0 0 var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  background: var(--surface);
  border-radius: var(--r-md);
  box-shadow: var(--clay-press);
  font-size: 13.5px;
}
.rcount {
  margin-top: var(--sp-3);
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-3);
  box-shadow: var(--clay-press);
}
.rcount__lab {
  flex: 1;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink-55);
}
.rcount__btn {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--tile);
  box-shadow: var(--clay-sm);
  font-size: 20px;
  font-weight: 700;
  color: var(--brand-deep);
  display: grid;
  place-items: center;
}
.rcount__btn:disabled {
  opacity: 0.35;
  box-shadow: none;
}
.rcount__val {
  font-weight: 800;
  font-size: 16px;
  min-width: 52px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.rcount__val--full {
  color: var(--sage-deep);
}
.rstep__chart {
  position: relative;
  margin-top: var(--sp-3);
}
/* Cette classe ne porte plus aucune règle CSS (jusqu'au 28/07 elle masquait l'image via
   `:deep(.chart__viewport) { display: none }` ; devenue morte dès que <ReaderChart> ne rend
   plus DU TOUT le viewport quand ReaderView lui fournit le slot `viewport-replacement`, cf.
   ReaderChart.vue). Elle reste posée sur `.rstep__chart` comme simple marqueur d'état — lu
   par les tests (unit + e2e) et par le commentaire de `goToChart()` ci-dessus — pour repérer
   la carte de la grille actuellement épinglée. */
/* Renvoi cliquable qui prend la place de l'image dans la carte du diagramme épinglé (cf.
   #viewport-replacement dans le template) : hauteur confortable et fond discret, pensés pour
   un bloc qui remplace une image plutôt que pour une bande au-dessus d'une carte. */
.rchart-ref {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  min-height: 120px;
  padding: var(--sp-4);
  border: 1px dashed var(--line);
  border-radius: var(--r-md);
  background: var(--surface);
  color: var(--ink);
  text-align: left;
}
.rchart-ref__t { flex: 1; font-weight: 700; min-width: 0; }
.rchart-ref__s { color: var(--ink-55); font-size: 12.5px; }
/* Boutons de la barre de titre du diagramme (slot title-actions de ReaderChart.vue) :
   même hauteur que le bouton plein écran voisin (.chart__zoom), mais largeur auto pour
   porter un libellé visible à côté de l'icône (retour device 28/07 : icône seule
   n'expliquait rien). Recopié ici plutôt que partagé par sélecteur : `.chart__zoom` est
   défini dans le <style scoped> de ReaderChart.vue, qui ne s'applique pas au contenu passé
   par slot depuis ce composant-ci (mesuré — même piège que .cfs__tool dans
   ChartFullscreen.vue, cf. son commentaire). */
.rchart-pin,
.rchart-unpin {
  height: 36px;
  min-width: 36px;
  padding: 0 10px 0 8px;
  border-radius: 10px;
  background: var(--tile);
  box-shadow: var(--clay-sm);
  color: var(--brand-deep);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.rchart-label {
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
}
/* Barre d'action épinglée en bas : une seule rangée flex → jamais de chevauchement.
   Le conteneur laisse passer les taps dans sa zone dégradée transparente (pointer-events),
   seuls les boutons captent. */
.actionbar {
  position: fixed;
  z-index: 40;
  left: 0;
  right: 0;
  bottom: 0;
  margin: 0 auto;
  max-width: var(--w-content);
  display: flex;
  align-items: center;
  /* Chrono masqué (project.showTimer=false) : le bouton (flex:0 1 auto + margin-right:auto)
     disparaît → sans ceci les boutons diagramme/aide-mémoire se recaleraient à gauche.
     flex-end les garde à droite, à leur place habituelle (portée du pouce inchangée). */
  justify-content: flex-end;
  gap: var(--sp-2);
  /* Marges latérales NOMMÉES. Le bouton retour-en-haut, positionné en absolu dans cette
     barre, doit s'aligner AU PIXEL sur le bord droit du dernier bouton de la rangée. Le
     containing block d'un élément absolu étant la *padding box* du parent, `right: 0` le
     collerait au bord de la barre et non à celui du contenu : il lui faut exactement
     cette valeur. Écrite deux fois, elle diverge (constaté : 4 px de décalage) — d'où
     la variable, et d'où le fait que le resserrage ci-dessous la redéfinisse ELLE, et
     jamais le `padding` directement. */
  --bar-pad-x-right: max(var(--sp-4), var(--sa-right));
  --bar-pad-x-left: max(var(--sp-4), var(--sa-left));
  padding: var(--sp-4) var(--bar-pad-x-right) calc(var(--sp-4) + var(--sa-bottom)) var(--bar-pad-x-left);
  background: linear-gradient(0deg, var(--bg) 60%, rgba(250, 246, 238, 0));
  pointer-events: none;
  transition: opacity var(--motion-base), transform var(--motion-base);
}
/* Même correctif que .rhdr : le point transparent doit interpoler depuis --bg sombre. */
:root[data-theme='dark'] .actionbar,
html[data-theme='dark'] .actionbar {
  background: linear-gradient(0deg, var(--bg) 60%, rgba(22, 18, 16, 0));
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .actionbar {
    background: linear-gradient(0deg, var(--bg) 60%, rgba(22, 18, 16, 0));
  }
}
.actionbar > * {
  pointer-events: auto;
}
/* Retour en haut, empilé AU-DESSUS de l'aide-mémoire (cf. le commentaire du <BackToTop>
   dans le template). Son style par défaut (`.btt`, scoped à BackToTop.vue) est
   `position: fixed` au même coin et au même z-index que CETTE barre — à z-index égal,
   l'ordre du DOM déciderait arbitrairement qui reçoit l'appui. `:deep()` atteint sa
   racine (composant enfant) pour le rendre `absolute` par rapport à la barre, qui est
   elle-même positionnée (`fixed`) : il n'y a donc plus qu'UNE ancre pour les cinq
   boutons, et le décalage `.reader--split .actionbar` (disposition deux volets) le
   suit sans règle supplémentaire.
   `bottom: 100%` = juste au-dessus du bord haut de la barre, c'est-à-dire à la hauteur
   de son padding (--sp-4) au-dessus des boutons — sans jamais dépendre d'une hauteur de
   rangée écrite en dur (le chrono, masquable, en change).
   `right` : la variable `--bar-pad-x-right` de la barre elle-même (cf. sa définition),
   donc bord droit aligné au pixel sur celui de l'aide-mémoire, le dernier bouton de la
   rangée. Le bouton est plus étroit que les fab (44 vs 52) : c'est le bord droit qui
   fait la colonne visuelle, pas le centre.
   `absolute` le retire du flux de la rangée : contrairement à la version précédente (où
   il était un item flex), il ne prend plus aucune largeur au chrono — c'est tout l'objet
   du déplacement. Plus besoin de `flex: none` pour l'empêcher de rétrécir. */
.actionbar :deep(.btt) {
  position: absolute;
  right: var(--bar-pad-x-right);
  bottom: 100%;
  z-index: auto;
}
.actionbar--hidden {
  opacity: 0;
  pointer-events: none;
  transform: translateY(12px);
}
/* chrono — DISPOSITION de la pastille dans CETTE barre : son rendu propre (couleurs,
   typo, états sombres, pulsation) vit dans ChronoPill.vue depuis le chantier « chrono
   unifié », mais OÙ elle se pose dépend du parent — d'où le :deep(), seul moyen
   d'atteindre depuis cette feuille scopée un bouton porteur du data-v du composant.
   Largeur ajustée à son contenu, jamais toute la barre (retour device 27/07).
   `0 1 auto` et non `0 0 auto` : le bouton a trois états de contenu de largeurs très
   différentes (en marche = icône + temps ; en pause = icône + « Reprendre » + temps ;
   à l'arrêt = icône + « Chrono »), et à 360 px l'état en pause avec les trois boutons
   voisins est réellement serré — autoriser le rétrécissement garde l'ellipse comme
   vrai filet de sécurité. Le min-width évite que le bouton saute de largeur quand le
   chrono démarre, sous le pouce de l'utilisatrice. Pas de largeur en dur : les libellés
   traduits (« Timer », « Cronómetro ») n'ont pas la même longueur.
   `margin-right: auto` : disposition voulue — le chrono seul à gauche, les
   trois autres boutons groupés à droite. C'est cette marge qui absorbe l'espace libre ;
   le `justify-content: flex-end` de la barre reste utile quand le chrono est masqué. */
.actionbar :deep(.chrono-fab) {
  flex: 0 1 auto;
  min-width: min(11ch, 100%);
  margin-right: auto;
}
/* TÉLÉPHONE UNIQUEMENT — gap et marges latérales resserrés d'un cran (--sp-1 / --sp-3) :
   c'est ce qui rend au chrono les ~27 px qui lui manquaient pour afficher « Reprendre »
   en entier à 360 px. Mesuré dans les QUATRE langues, libellé le plus long compris
   (« Fortsetzen », 79 px) — cf. le test « le libellé de reprise n'est pas tronqué » de
   tests/e2e/reader-actionbar.spec.js, qui les vérifie une par une.
   Le seuil : avec les marges pleines, le chrono dispose de (largeur − 206) px et il lui
   en faut 181 au pire, soit une largeur d'au moins ~387 px. 430 px couvre les téléphones
   courants en portrait (360 à 428) avec de la marge, et laisse les tablettes tranquilles —
   là-bas la place n'a jamais manqué, et un gap de 4 px y collait les trois boutons icône
   les uns aux autres (vérifié sur capture à 900 px).
   Le padding VERTICAL reste à --sp-4 partout : la hauteur n'a jamais été le problème, et
   le bouton retour-en-haut se pose juste au-dessus de ce padding (bottom: 100%). */
@media (max-width: 430px) {
  .actionbar {
    gap: var(--sp-1);
    --bar-pad-x-right: max(var(--sp-3), var(--sa-right));
    --bar-pad-x-left: max(var(--sp-3), var(--sa-left));
  }
  /* :deep() obligatoire (le bouton porte le data-v de ChronoPill, pas celui de cette
     vue) ; le préfixe `.actionbar` rend l'ensemble PLUS SPÉCIFIQUE que la base scopée
     du composant (gap 9px / padding 16px) : le resserrage gagne sans dépendre de
     l'ordre d'émission des deux feuilles. Depuis la fusion chevron (08/09), le
     padding du geste vit sur le CORPS de la pastille (.chrono-fab__body), pas sur la
     capsule — viser la capsule ne resserrait plus rien. La zone chevron complète la
     pilule à droite (~40 px) : la marge de 27 px gagnée ici couvre son ajout. */
  .actionbar :deep(.chrono-fab__body) {
    gap: 6px;
    padding: 0 var(--sp-3);
  }
}
/* accès rapides : boutons compacts icône seule (52×52) — tiennent à côté du chrono à 360 px */
.fab {
  flex: none;
  width: 52px;
  height: 52px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-md);
}
.fab--ref {
  background: var(--tile);
  color: var(--brand-deep);
  border: 1px solid var(--line);
  box-shadow: 0 12px 24px -12px rgba(58, 46, 40, 0.34), 0 1px 1px rgba(255, 255, 255, 0.7) inset;
}
.fab--chart {
  background: var(--brand-grad);
  color: var(--on-accent);
  box-shadow: 0 12px 24px -12px rgba(var(--brand-rgb), 0.6), 0 1px 1px rgba(255, 255, 255, 0.3) inset;
}
.rpop {
  position: fixed;
  z-index: 60;
  max-width: 250px;
  background: var(--ink);
  color: #fbf2e6;
  font-size: 13px;
  line-height: 1.4;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  box-shadow: var(--e-3);
}
/* --ink s'INVERSE en sombre (devient crème) : le texte littéral #fbf2e6 (crème)
   deviendrait alors quasi invisible sur son propre fond. On bascule le texte sur
   --bg, qui suit la même inversion en sens opposé (clair : cf. #fbf2e6 ≈ --bg
   clair #faf6ee, donc rendu inchangé ; sombre : --bg sombre = presque noir, lisible
   sur le fond --ink devenu crème). */
:root[data-theme='dark'] .rpop,
html[data-theme='dark'] .rpop {
  color: var(--bg);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .rpop {
    color: var(--bg);
  }
}
.rpop__link {
  display: inline-flex;
  margin-top: 8px;
  padding: 5px 10px;
  border-radius: var(--r-pill);
  background: rgba(255, 255, 255, 0.12);
  color: #ffe7c4;
  font-weight: 700;
  font-size: 12px;
  text-decoration: none;
}
/* Même bascule que .rpop (texte + le halo blanc devient un tamisage noir, puisque
   le fond .rpop est maintenant clair en sombre). */
:root[data-theme='dark'] .rpop__link,
html[data-theme='dark'] .rpop__link {
  background: rgba(0, 0, 0, 0.12);
  color: var(--bg);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .rpop__link {
    background: rgba(0, 0, 0, 0.12);
    color: var(--bg);
  }
}

/* ── Lecteur à deux volets (tablette en paysage) ───────────────────────────────
   Le volet est en position fixe : le fil garde le défilement du document (en-tête
   sticky et barre d'action fixe existants inchangés), et le volet défile de son
   côté — sinon un diagramme haut deviendrait inatteignable.
   Le décalage du fil se fait par un padding sur la racine : l'en-tête, la barre de
   progression et le contenu sont dans le flux et se recentrent tout seuls dans la
   largeur restante, en gardant leur max-width commune (alignement des 4 éléments).
   La barre d'action, elle, est `position: fixed` et échappe au padding : son `right`
   est repris explicitement pour qu'elle ne passe jamais sous le diagramme.
   Même remarque pour `.btt` (BackToTop) : en lecture seule (aperçu bibliothèque),
   `.actionbar` n'existe pas et le bouton garde son `position: fixed` par défaut — sans
   la règle `:deep()` ci-dessous il resterait collé au bord droit de l'ÉCRAN, donc sous
   `.rpane` (bord droit lui aussi, z-index 35 < 40 du bouton) : il flotterait au-dessus
   du diagramme épinglé plutôt que d'être décalé comme le reste du fil.
   ⚠️ SÉLECTEUR ENFANT DIRECT (`>`), et non descendant : depuis que le bouton du suivi est
   `position: absolute` DANS `.actionbar` (règle plus haut), il hérite déjà du décalage de
   celle-ci (`.reader--split .actionbar { right: var(--pane-w) }`). L'atteindre ici lui
   appliquerait le décalage une SECONDE fois — il sortirait de l'écran par la gauche. Seul
   l'exemplaire de la lecture seule, enfant direct de `.reader`, doit être visé. */
.reader--split {
  --pane-w: clamp(360px, 46vw, 720px);
  padding-right: var(--pane-w);
}
.reader--split .actionbar {
  right: var(--pane-w);
}
.reader--split > :deep(.btt) {
  right: calc(var(--pane-w) + max(var(--sp-4), var(--sa-right)));
}
.rpane {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: var(--pane-w);
  z-index: 35; /* au-dessus du fil, sous le plein écran (1100) */
  display: flex;
  flex-direction: column;
  background: rgba(20, 18, 16, 0.96);
  border-left: 1px solid rgba(255, 255, 255, 0.12);
}
.rpane > .cstage {
  flex: 1;
  min-height: 0;
}
/* Copie de la règle homonyme de ChartStage.vue (et de ChartFullscreen.vue:99) : le bouton
   Agrandir est rendu ICI, dans le slot `tools` de ChartStage, donc il porte le scope CSS de
   ReaderView, pas celui de ChartStage — le style `scoped` de ChartStage ne l'atteint pas
   (même piège déjà documenté dans ChartFullscreen.vue). Sans cette copie, le bouton retombe
   sur le style de bouton par défaut du navigateur au lieu du rond 44px assorti aux 3 autres
   outils. Toute retouche ici doit être reportée à l'identique dans les deux autres fichiers. */
.cfs__tool { width: 44px; height: 44px; border: none; border-radius: var(--r-pill); background: rgba(255, 255, 255, 0.14); color: #fff; display: grid; place-items: center; }
</style>

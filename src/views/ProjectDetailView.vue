<script setup>
import { ref, computed, reactive, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import StatusBadge from '@/components/StatusBadge.vue'
import CounterCard from '@/components/CounterCard.vue'
import CounterForm from '@/components/CounterForm.vue'
import ThumbImage from '@/components/ThumbImage.vue'
import BackToTop from '@/components/BackToTop.vue'
import FirstDetailTip from '@/components/FirstDetailTip.vue'
import { useProjectsStore, workedNow } from '@/stores/projects'
import { useYarnsStore } from '@/stores/yarns'
import { usePatternsStore } from '@/stores/patterns'
import { useSectionsStore } from '@/stores/sections'
import { useCountersStore } from '@/stores/counters'
import { useSessionsStore } from '@/stores/sessions'
import { useActiveSessionStore, fmtDuration } from '@/stores/activeSession'
import { useSnackbarStore } from '@/stores/snackbar'
import { useLightboxStore } from '@/stores/lightbox'
import { useSoftDelete } from '@/composables/useSoftDelete'
import { useSmartBack } from '@/composables/useSmartBack'
import { trapTabFocus, useDialogFocusReturn } from '@/composables/useFocusTrap'
import { useDismissMenu } from '@/composables/useDismissMenu'
import { useScrollFade } from '@/composables/useScrollFade'
import { pickAndCropImage } from '@/utils/photo'
import { formatLocalDate, localDayToDate } from '@/utils/date-format'
import { ymdLocal } from '@/utils/time-periods'
import { startedAtPatch } from '@/utils/project-started-at'
import { readerProgress, patternToReader, slug, sectionTitleLabel, sizeLabelText } from '@/utils/reader'
import { toggleSectionDone } from '@/utils/section-mark'
import { openPdfExternally } from '@/utils/open-pdf'
import { closeChronoSession } from '@/utils/close-chrono-session'
import { SESSION_NO_SECTION } from '@/constants/session'
import { useCropperStore } from '@/stores/cropper'
import { useProjectConsumption } from '@/composables/useProjectConsumption'
import { resolveCover } from '@/utils/project-cover'
import { reservationsOf, consumedOf } from '@/utils/yarn-usage'
import { formatMoney } from '@/utils/units'
import { patternPriceState } from '@/utils/pattern-price'
import { projectYarnCost } from '@/utils/purchases'
import { useSettingsStore } from '@/stores/settings'
import AppIcon from '@/components/AppIcon.vue'
import AppCheckbox from '@/components/AppCheckbox.vue'
import ProjectPdfGallery from '@/components/ProjectPdfGallery.vue'
import StitchProgress from '@/components/StitchProgress.vue'
import SkeletonScreen from '@/components/SkeletonScreen.vue'
import YarnConsumptionDialog from '@/components/YarnConsumptionDialog.vue'
import ChronoPill from '@/components/ChronoPill.vue'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const goBack = useSmartBack()
const projectsStore = useProjectsStore()
const yarnsStore = useYarnsStore()
const patternsStore = usePatternsStore()
const sectionsStore = useSectionsStore()
const countersStore = useCountersStore()
const sessionsStore = useSessionsStore()
const lightbox = useLightboxStore()
const cropper = useCropperStore()
const active = useActiveSessionStore()
const snackbar = useSnackbarStore()
const settings = useSettingsStore()
const softDelete = useSoftDelete()
const projectConsumption = useProjectConsumption()

const project = ref(null)
const loading = ref(true) // pour afficher un skeleton tant que les données chargent
const linkedPattern = ref(null) // patron lié (lien dans Détails, photos dans Galerie)
const { open: menuOpen, triggerRef, menuRef } = useDismissMenu()
const tab = ref(route.query.tab || 'sections')
const TABS = ['sections', 'infos', 'photos', 'sessions']
// Indice de défilement (T8, audit UX 17/07) : la bande d'onglets défile déjà
// (`overflow-x: auto`) mais sa barre de scroll est masquée volontairement — rien ne dit
// donc qu'« Sessions », coupé à droite sur un petit écran, est atteignable. `tabsFade.active`
// n'est vrai que si ça déborde RÉELLEMENT (voir useScrollFade) : pas de dégradé permanent qui
// mentirait sur un écran qui tient tout.
const tabsEl = ref(null)
// Destructuré (pas `const tabsFade = useScrollFade(...)`) : `tabsFade.active` dans le
// template n'aurait PAS été déballé (le ref imbriqué dans un objet simple non réactif
// reste un objet Ref — toujours truthy dans un `:class`), et la classe ne serait jamais
// retombée. Piège classique de la Composition API — cf. `useDismissMenu` plus haut, même
// motif de déstructuration.
const { active: tabsFadeActive } = useScrollFade(tabsEl)

async function loadAll() {
  loading.value = true
  const id = route.params.id
  project.value = await projectsStore.get(id)
  linkedPattern.value = project.value?.patternId != null ? await patternsStore.get(project.value.patternId) : null
  await Promise.all([
    sectionsStore.loadForProject(id),
    countersStore.loadForProject(id),
    sessionsStore.loadForProject(id),
    yarnsStore.loaded ? Promise.resolve() : yarnsStore.load(),
  ])
  // Le réglage de devise pilote l'affichage du coût des laines. Filet identique à
  // StashView/ExpensesView : App.vue le charge déjà au démarrage, mais toute exception
  // avant cet appel laisserait sinon la devise sur son défaut pour toute la session.
  if (!settings.loaded) settings.load()
  loading.value = false
}
function openReader() {
  router.push({ name: 'project-read', params: { id: project.value.id } })
}
// Clic sur une section de l'aperçu (#9) : ouvre le lecteur mais atterrit directement au
// DÉBUT de cette section (via `?section=<id>` — cf. ReaderView.onMounted/scrollTargetId),
// plutôt qu'au rang courant du suivi (comportement de openReader(), laissé intact pour le
// bouton « Suivre le patron » et les autres usages globaux).
function openSection(s) {
  router.push({ name: 'project-read', params: { id: project.value.id }, query: { section: s.id } })
}
// Reflet local immédiat de `startedAtPatch` (posé côté store par `update()`/`ensureStarted()`
// dès qu'un geste de progression ou un lancement de chrono trouve le projet sans date de
// début) : les trois gestes de CET écran (section, compteur, chrono) peuvent désormais écrire
// `startedAt` en base sans que `project.value` le sache — même piège que `finishedAt`/RÈGLE 1
// (cf. `changeStatus` ci-dessus), mais un `get()` complet serait excessif pour un seul champ.
function reflectStartedAt() {
  Object.assign(project.value, startedAtPatch(project.value, ymdLocal(new Date())) || {})
}

// Case « section faite » de l'aperçu : bascule toute la section dans readerState
// (marque tous les rangs faits, ou restaure l'état d'avant au décochage — sans perte).
async function onToggleSection(s) {
  const cur = project.value?.readerState || {}
  const next = toggleSectionDone(projectReader.value, cur, s.id, cur.size)
  // Geste de PROGRESSION (au même titre qu'un rang coché dans le suivi) → il horodate la session
  // de tricot, qui classe la tuile « Reprendre » de l'accueil. Dans le même patch : une écriture.
  await projectsStore.update(project.value.id, { readerState: next, lastWorkedAt: workedNow() })
  project.value.readerState = next   // readerOverview + % global recomputent
  reflectStartedAt()
}
// Le projet pointe vers un patron QUI N'EXISTE PLUS (supprimé de la bibliothèque).
// À distinguer d'un projet libre, qui n'a simplement jamais eu de patron.
const patternMissing = computed(() => project.value?.patternId != null && linkedPattern.value == null)
// Vignette de couverture de l'en-tête : photo du projet, à défaut 1re photo du patron lié.
const cover = computed(() => resolveCover(project.value, linkedPattern.value))
// Prix du patron (depuis le 07/08), en LECTURE SEULE : la saisie est dans le formulaire du projet
// et sur la fiche du patron. Trois états — un montant, « Gratuit », ou rien du tout. Une
// étiquette sans valeur serait du bruit, on n'affiche donc pas de ligne vide.
const patternPriceText = computed(() => {
  const st = patternPriceState(linkedPattern.value)
  if (st.kind === 'none') return ''
  if (st.kind === 'free') return t('pattern.priceFree')
  return formatMoney(st.amount, { locale: locale.value, currency: st.currency, profile: 'detail' }).text
})
// Coût du projet (depuis le 08/08). Le calcul vit dans utils/purchases.js — ici, uniquement de
// la mise en forme. `pricedCount === 0` avec des pelotes imputées : on écrit « — » et non
// « 0 € », qui ferait passer une ignorance pour une gratuité.
const cost = computed(() => projectYarnCost(yarnsStore.yarns, project.value?.id))
const yarnCostText = computed(() =>
  cost.value.pricedCount > 0
    ? formatMoney(cost.value.amount, { locale: locale.value, currency: settings.currency, profile: 'detail' }).text
    : '—',
)
// La tuile n'apparaît que s'il y a quelque chose à dire : des pelotes imputées (même sans
// prix — c'est déjà une information) ou un prix de patron. Jamais d'étiquette vide.
const showCost = computed(() => cost.value.skeins > 0 || !!patternPriceText.value)
// Tout patron a (ou dérive) un reader → aperçu reader pour TOUS les projets liés.
const projectReader = computed(() => (linkedPattern.value ? patternToReader(linkedPattern.value) : null))
// Aperçu des sections du lecteur + leur avancement, sans entrer dans le suivi.
const readerOverview = computed(() =>
  projectReader.value ? readerProgress(projectReader.value, project.value?.readerState) : null,
)
// Sélecteur de taille tricotée (pilote les instructions affichées selon la taille — PRD §7.4).
// La taille qui pilote RÉELLEMENT les instructions est l'INDEX `readerState.size`
// (readerProgress / repeatTotal), pas le libellé `activeSize` : ReaderView.loadState() ne
// dérive l'index depuis `activeSize` que tant que `readerState.size` est nul. Dès que le suivi
// a enregistré une taille, ne réécrire que le libellé rendait cette pastille MENTEUSE — elle
// s'allumait sur « L » pendant que le lecteur, l'aperçu des sections et le cochage de section
// continuaient de compter en « S ». L'index n'est écrit que si le libellé existe dans le
// lecteur : un indexOf à -1 effacerait une taille que le lecteur, lui, a correctement retenue.
async function setActiveSize(sz) {
  const next = project.value.activeSize === sz ? '' : sz
  const i = next ? (projectReader.value?.sizeLabels || []).indexOf(next) : -1
  const patch = { activeSize: next }
  if (i >= 0) patch.readerState = { ...project.value.readerState, size: i }
  await projectsStore.update(project.value.id, patch)
  project.value.activeSize = next
  if (patch.readerState) project.value.readerState = patch.readerState
}
// Changement de statut rapide (popover du badge d'en-tête), sans passer par l'édition.
// Passer à 'done' OU 'abandoned' pose d'abord « combien de pelotes as-tu utilisées/
// perdues ? » SI ce projet réserve des pelotes (sinon comportement inchangé) — logique
// partagée avec ProjectCard et ProjectEditView via le composable useProjectConsumption
// (K2 + R2 + R3) : le composable décide seul quels statuts déclenchent la
// question, rien à faire ici pour couvrir 'abandoned'.
async function changeStatus(status) {
  await projectConsumption.requestStatusChange(project.value, status, async () => {
    await projectsStore.update(project.value.id, { status })
    // Relit le projet ÉCRIT plutôt que de recopier `status` seul (correction ultérieure) :
    // passer à 'done' fait écrire `finishedAt` en base comme effet de la
    // RÈGLE 1, dans `projectsStore.update()` — un objet local qui ne recopierait que
    // `status` resterait sans cette date jusqu'au prochain chargement de l'écran, et la
    // tuile « Fin » de l'onglet Infos resterait vide. Relire (même idiome que
    // addPhoto/removePhoto/setCover ci-dessous) évite aussi de recalculer le jour une
    // seconde fois ici : le store est la seule source de vérité de ce que l'écriture a
    // réellement produit.
    project.value = await projectsStore.get(project.value.id)
  })
}

// Swipe horizontal pour changer d'onglet (Infos ⇄ Sections ⇄ Photos ⇄ Sessions).
let tabTX = 0
let tabTY = 0
function onTabTouchStart(e) {
  const tt = e.touches[0]
  tabTX = tt.clientX
  tabTY = tt.clientY
}
function onTabTouchEnd(e) {
  // Neutralisé si une saisie est en cours (ne pas perdre un formulaire ouvert),
  // ou si le geste part du bord gauche (réservé au « retour » système).
  if (addingSection.value || addingCounter.value || addingSession.value) return
  if (tabTX < 24) return
  const tt = e.changedTouches[0]
  const dx = tt.clientX - tabTX
  const dy = Math.abs(tt.clientY - tabTY)
  // ignore les gestes trop courts, trop verticaux, ou sur une zone défilable horizontalement (photos)
  if (Math.abs(dx) < 60 || dy > Math.abs(dx) * 0.6) return
  if (e.target?.closest?.('.patron-photos')) return
  const i = TABS.indexOf(tab.value)
  if (dx < 0 && i < TABS.length - 1) changeTab(TABS[i + 1])
  else if (dx > 0 && i > 0) changeTab(TABS[i - 1])
}
// Change d'onglet en mémorisant le sens, pour l'animation de continuité (slide).
const slideDir = ref('next')
function changeTab(next) {
  const cur = TABS.indexOf(tab.value)
  slideDir.value = TABS.indexOf(next) >= cur ? 'next' : 'prev'
  tab.value = next
}
onMounted(loadAll)
// Navigation sortante (la suppression ci-dessous fait router.replace vers l'accueil) :
// params.id disparaît AVANT le démontage, et le watcher tirait un loadAll(undefined)
// -> projectsStore.get(NaN) -> rejet Dexie non géré (DataError). On ne recharge que pour
// un id PRÉSENT : changer de projet recharge, quitter la fiche ne charge rien.
watch(() => route.params.id, (id) => { if (id != null) loadAll() })

const hasGauge = computed(() => project.value?.gaugeStitches || project.value?.gaugeRows)
// Liste d'aiguilles : nouveau format needles[] ; repli sur les scalaires hérités si le
// projet n'a pas encore été migré. On ne garde que les entrées renseignées, formatées.
const needleList = computed(() => {
  const p = project.value
  if (!p) return []
  const raw = Array.isArray(p.needles) ? p.needles : [{ mm: p.needleMm || '', us: p.needleUs || '' }]
  return raw
    .map((n) => [n.mm && `${n.mm} mm`, n.us].filter(Boolean).join(' · '))
    .filter(Boolean)
})
const hasNeedle = computed(() => needleList.value.length > 0)
const isCrochet = computed(() => project.value?.technique === 'crochet')
const projectYarns = computed(() => yarnsStore.yarns.filter((y) => reservationsOf(y)[project.value?.id] != null))
// Laines dont CE projet a réellement tricoté des pelotes (trace de consommation,
// décision produit) — distinct des réservations ci-dessus : une fois consommée,
// l'allocation est retirée (`consumeProjectReservation`), donc sans cette liste un
// projet terminé n'afficherait plus AUCUNE laine (jamais perdre l'info).
const consumedYarns = computed(() => yarnsStore.yarns.filter((y) => consumedOf(y)[project.value?.id] != null))
const sessionsTotal = computed(() => sessionsStore.sessions.reduce((a, s) => a + (s.durationSec || 0), 0))

// --- Chrono flottant (chantier « chrono unifié », 2026-08-30) ---
// MÊME chrono que l'écran de suivi, par construction : les deux appellent `openFor` avec la
// même sentinelle de section. `openFor` ne rouvre rien quand le couple (projet, section) ne
// change pas — il poursuit. Impossible d'en avoir deux qui tournent sur un même projet.
// La pastille (composant partagé ChronoPill) lit le store GLOBAL et rend ses états
// elle-même ; en pratique la session visible ici est toujours celle de CE projet, le garde
// « sortie de bulle » du routeur ayant fermé celle d'un autre avant l'arrivée sur la fiche.
const chronoMine = computed(() => active.isActive && active.projectId === project.value?.id)

// Réglage par projet ; défaut « affiché » pour tous les projets déjà en base.
const showTimer = computed(() => project.value?.showTimer ?? true)

// Geste de la pastille : pause si CE chrono tourne, sinon démarrage — le comportement de
// l'ancien bouton du bloc « Temps de travail », repris tel quel. Sur un chrono d'un autre
// projet (état que le garde du routeur rend quasi inatteignable), l'appui le REPREND pour
// CE projet : openFor ferme SILENCIEUSEMENT l'ancien en commettant son temps au journal
// de SON projet (store journalisant, chantier « séances live ») — un seul chrono dans l'app,
// et le temps de l'autre n'est pas perdu. Les deux appels sont attendus : la fermeture
// commettante de l'ancien slot doit être EN BASE avant que play() ne pose le nouveau.
async function toggleChrono() {
  if (chronoMine.value && active.running) {
    await active.pause()
    return
  }
  await active.openFor(project.value.id, SESSION_NO_SECTION, 0)
  await active.play()
  // Premier lancement d'une session : pose `startedAt` si le projet n'en a pas — décision
  // produit du 12/09, cf. `ensureStarted`.
  await projectsStore.ensureStarted(project.value.id)
  reflectStartedAt()
}

// Masquer/afficher le chrono (08/09/2026 : le chevron de la pastille et l'entrée du
// kebab remplacent l'œil) : parité avec toggleTimerFromReader (lecteur). Masquer CLOÎT la
// session active — temps enregistré + snackbar via closeChronoSession, partagée avec le
// garde « sortie de bulle » — puis persiste showTimer:false. `isActive` (en marche
// OU en pause), pas `running` : une session en pause reste ouverte ; sans la clôturer, elle
// traînerait dans Dexie et serait ré-attribuée à un autre projet. `await` : la session doit
// être enregistrée AVANT de persister le réglage.
// Différence assumée avec le lecteur : AFFICHER ne rouvre RIEN. La pastille revient à
// l'arrêt et c'est son propre geste play qui ouvrira — le lecteur, lui, rouvre à
// l'affichage une session qu'il avait prise en charge dès l'arrivée ; la fiche n'a jamais
// rien pris en charge. Rouvrir ici ferait démarrer un comptage par un simple affichage.
// Pas de catch sur le helper : si la clôture échoue, le rejet interrompt le geste AVANT
// l'écriture showTimer:false — la pastille reste affichée, la session reste visible
// (masquer n'est jamais perdre, y compris en échec).
// Le snackbar « Chrono masqué » (même facture que le lecteur) porte
// « Réafficher » : il rappelle CETTE fonction, next recalculé à true. Aucune rouverture
// implicite derrière : c'est la différence assumée ci-dessus, le snackbar n'y déroge pas.
async function toggleTimerFromDetail() {
  const p = project.value
  if (!p) return
  const next = !(p.showTimer ?? true)
  if (!next && active.isActive) await closeChronoSession()
  await projectsStore.update(p.id, { showTimer: next })
  p.showTimer = next
  if (!next) {
    snackbar.show(t('reader.timerHidden'), {
      actionLabel: t('reader.showTimer'),
      onAction: () => toggleTimerFromDetail(),
    })
  }
}
// Entrée du kebab (« Masquer / Afficher le chrono » selon l'état) : même fonction que le
// chevron de la pastille — un second chemin, accessible clavier/lecteur d'écran, vers le
// MÊME geste. Referme d'abord le menu, comme les autres entrées.
function toggleTimerFromMenu() {
  menuOpen.value = false
  toggleTimerFromDetail()
}

function edit() {
  menuOpen.value = false
  router.push({ name: 'project-edit', params: { id: route.params.id } })
}
// Menu ⋮ (#7) : ouvre le PDF d'origine du patron rattaché, dans une appli externe. Best-effort
// (cf. openPdfExternally) : un échec (natif ou web) ne doit pas faire planter la fiche, juste
// avertir — même garde que PatternView.openExternal (clé i18n partagée).
async function viewPatternPdf() {
  menuOpen.value = false
  try {
    await openPdfExternally(linkedPattern.value.pdf, `${slug(linkedPattern.value.name) || 'patron'}.pdf`)
  } catch {
    snackbar.show(t('patternExtras.openError'))
  }
}
// Menu ⋮ : ouvre l'éditeur MD (« Corriger le patron ») sur le patron rattaché — même
// route que le bouton équivalent de l'aperçu Prévisualiser du patron (cf. ReaderView.vue :
// l'action a migré depuis la fiche).
function correctPattern() {
  menuOpen.value = false
  router.push({ name: 'pattern-correct', params: { id: linkedPattern.value.id } })
}
// R1 : la suppression ne pose plus de question sur les pelotes réservées — soit le
// projet était Terminé et la consommation réelle a déjà été traitée à la clôture
// (`useProjectConsumption`), soit il ne l'était pas et les pelotes réservées reviennent
// simplement au stock (`projectsStore.remove` ne touche plus jamais `quantity`).
async function remove() {
  menuOpen.value = false
  // Chrono du projet supprimé : vidé SANS journaliser AVANT la cascade. Sinon la cascade
  // ci-dessous purge les sessions du projet, puis le router.replace déclenche le garde
  // « sortie de bulle », dont la pause commitante réécrirait une ligne pour un projet
  // disparu — une session orpheline (constaté en revue, 31/08) : le temps non commis part avec le
  // projet, sa session n'a pas de fiche où vivre. Garde sur l'IDENTITÉ : un chrono d'un
  // AUTRE projet n'est pas touché, le garde du routeur s'en occupe comme toujours.
  // Bord assumé : si la cascade rejette
  // APRÈS ce discard réussi, le projet SURVIT sans son temps non commis — fenêtre à deux
  // échecs consécutifs (suppression engagée, puis cascade en échec), direction tranchée :
  // jamais de séance orpheline. Perdre le temps d'un projet qui survit est la perte
  // moindre ; recréer une séance ici réouvrirait la fenêtre à orpheline ci-dessus.
  if (active.isActive && active.projectId === Number(route.params.id)) await active.discard()
  // Suppression en cascade (projet + sections/compteurs/sessions + libération des laines).
  // Le bundle renvoyé permet une annulation fidèle (tout est restauré ensemble).
  const bundle = await projectsStore.remove(route.params.id)
  router.replace({ name: 'home' })
  await softDelete('project', bundle, {
    message: t('project.deleted', { name: bundle?.project?.name || '' }),
    reload: projectsStore.load,
  })
}

// --- Ajout de section (addingSection conservé pour le garde de la navigation swipe) ---
const addingSection = ref(false)

// --- Compteurs (rangs, + augm/dim et répétitions en option) ---
const addingCounter = ref(false)
async function addCounter({ name, extra }) {
  await countersStore.add(project.value.id, name || t('counter.default'), extra)
  addingCounter.value = false
}
async function setCounter(id, value) {
  await countersStore.setValue(id, value)
  // Bouger un compteur, c'est tricoter — le compteur vit dans sa propre table, d'où l'écriture
  // séparée sur le projet (contrairement à la case « section faite », qui écrit déjà dessus).
  await projectsStore.markWorked(project.value.id)
  reflectStartedAt()
}
async function updateCounter(id, patch) {
  await countersStore.update(id, patch)
}
async function removeCounter(id) {
  const c = await countersStore.remove(id)
  snackbar.show(t('counter.deleted'), { actionLabel: t('common.undo'), onAction: () => countersStore.restore(c) })
}

// --- Sessions ---
// Session VIVANTE (chantier « séances live », 30/08) : l'onglet Sessions montre le temps qui
// court AVANT qu'il soit écrit — la pause devient visible dès qu'elle arrive, pas au
// prochain démarrage. Tout est DÉRIVÉ du store journalisant (chronoMine + champs exposés
// par le store), zéro horloge locale : le défilement vit du tick (1/s) du store, via le
// computed elapsedSec — inventer un setInterval ici donnerait DEUX horloges qui divergent.
// Temps non écrit au journal, en secondes entières : le solde que la prochaine pause
// commettra. max(0, …) : le filigrane committedSec ne doit jamais RETIRER de temps à
// l'affichage (horloge en arrière, état recollé) — chunkToCommit côté store rejette les
// négatifs de la même façon.
const liveChunk = computed(() =>
  chronoMine.value ? Math.max(0, Math.floor(active.elapsedSec - active.committedSec)) : 0,
)
// Ligne du journal où l'épisode courant fusionne — mais seulement si elle est dans la
// liste CHARGÉE : une cible supprimée à la main pendant l'épisode n'y figure plus
// (mergeIntoId pointe encore dessus, la base vivra avec), l'écran n'a alors RIEN à
// étendre. Le find (et pas un accès direct) est ce garde : pas de cible → ligne virtuelle.
const liveTarget = computed(() =>
  chronoMine.value && active.mergeIntoId != null
    ? sessionsStore.sessions.find((s) => s.id === active.mergeIntoId) || null
    : null,
)
// Ligne virtuelle : le chrono est à CE projet mais n'écrit nulle part pour l'instant
// (rien commis — épisode neuf — ou cible disparue). Visible dès 0:00 : la session existe
// dès le démarrage, pas dès la première seconde commise.
const virtualLive = computed(() => chronoMine.value && liveTarget.value == null)
// Durée affichée d'une ligne : étendue du chunk en cours quand elle est la cible — la
// ligne montre ce qu'elle PORTERA dès la prochaine pause. Les autres lignes, et tout
// affichage quand le chrono est ailleurs, restent au solde écrit (durationSec seul).
function rowDuration(s) {
  return liveTarget.value?.id === s.id ? (s.durationSec || 0) + liveChunk.value : s.durationSec || 0
}

const addingSession = ref(false)
const newSess = reactive({ date: '', durationMin: '', rows: '' })
async function saveManualSession() {
  const min = Number(newSess.durationMin) || 0
  if (!min && !newSess.rows) return
  await sessionsStore.add({
    projectId: project.value.id,
    sectionId: null,
    date: (newSess.date ? localDayToDate(newSess.date) : new Date()).toISOString(),
    durationSec: min * 60,
    rowsDone: Number(newSess.rows) || 0,
    manual: true,
  })
  Object.assign(newSess, { date: '', durationMin: '', rows: '' })
  addingSession.value = false
}
async function removeSession(id) {
  const s = await sessionsStore.remove(id)
  snackbar.show(t('session.deleted'), { actionLabel: t('common.undo'), onAction: () => sessionsStore.restore(s) })
}

// Rectifier le temps / les rangs / la date d'une session existante — utile si on a oublié
// de démarrer ou d'arrêter le chrono (PRD §7.6).
const editingSessionId = ref(null)
const editSess = reactive({ date: '', durationMin: '', rows: '' })
function startEditSession(s) {
  editingSessionId.value = s.id
  // Le jour LOCAL, pas les 10 premiers caractères de la chaîne ISO (qui sont en UTC) : sinon
  // rectifier seulement la durée d'une session ancienne pourrait, à l'enregistrement, la faire
  // atterrir sur un autre jour dans la grille (§9, même défaut que côté écriture,
  // côté lecture cette fois).
  editSess.date = s.date ? ymdLocal(new Date(s.date)) : ''
  editSess.durationMin = String(Math.round((s.durationSec || 0) / 60))
  editSess.rows = String(s.rowsDone || 0)
  addingSession.value = false
}
async function saveEditSession() {
  await sessionsStore.update(editingSessionId.value, {
    date: (editSess.date ? localDayToDate(editSess.date) : new Date()).toISOString(),
    durationSec: (Number(editSess.durationMin) || 0) * 60,
    rowsDone: Number(editSess.rows) || 0,
  })
  editingSessionId.value = null
  snackbar.show(t('session.updated'))
}
// --- Photos (onglet Photos) ---
async function addPhoto() {
  const dataUrl = await pickAndCropImage(cropper.crop)
  if (!dataUrl) return
  const photos = [...(project.value.photos || []), dataUrl]
  await projectsStore.update(project.value.id, { photos })
  project.value = await projectsStore.get(project.value.id)
}
// Garde suppression : si on retire la photo de couverture (ou une photo avant elle dans le
// tableau), l'index de couverture doit être recalculé pour rester cohérent.
function coverIndexAfterRemoval(idx, coverIndex) {
  const ci = coverIndex ?? 0
  if (idx === ci) return 0
  if (idx < ci) return ci - 1
  return ci
}
async function removePhoto(idx) {
  const photos = [...(project.value.photos || [])]
  const [removed] = photos.splice(idx, 1)
  const prevCoverIndex = project.value.coverIndex ?? 0
  const nextCoverIndex = coverIndexAfterRemoval(idx, prevCoverIndex)
  await projectsStore.update(project.value.id, { photos, coverIndex: nextCoverIndex })
  project.value = await projectsStore.get(project.value.id)
  snackbar.show(t('photo.deleted'), {
    actionLabel: t('common.undo'),
    onAction: async () => {
      const ph = [...(project.value.photos || [])]
      ph.splice(idx, 0, removed)
      await projectsStore.update(project.value.id, { photos: ph, coverIndex: prevCoverIndex })
      project.value = await projectsStore.get(project.value.id)
    },
  })
}
async function setCover(idx) {
  await projectsStore.update(project.value.id, { coverIndex: idx })
  project.value = await projectsStore.get(project.value.id)
}

// --- Visionneuse plein écran (tap sur une photo) ---
const photos = computed(() => project.value?.photos || [])
const coverIndex = computed(() => project.value?.coverIndex ?? 0)
const viewerIdx = ref(null)
function openViewer(i) {
  viewerIdx.value = i
}
function closeViewer() {
  viewerIdx.value = null
}
function viewerPrev() {
  if (viewerIdx.value > 0) viewerIdx.value -= 1
}
function viewerNext() {
  if (viewerIdx.value < photos.value.length - 1) viewerIdx.value += 1
}
function onViewerKey(e) {
  if (e.key === 'Escape') closeViewer()
  else if (e.key === 'ArrowLeft') viewerPrev()
  else if (e.key === 'ArrowRight') viewerNext()
}
// Piège au Tab + restitution au déclencheur à la fermeture (dette audit UX 16/07,
// composable partagé). ATTENTION : passer `viewerIdx` directement serait FAUX — 0 (première
// photo) est falsy alors que la visionneuse est ouverte ; on passe l'état booléen réel.
useDialogFocusReturn(() => viewerIdx.value != null)
watch(viewerIdx, (v) => {
  if (v != null) window.addEventListener('keydown', onViewerKey)
  else window.removeEventListener('keydown', onViewerKey)
})
onUnmounted(() => window.removeEventListener('keydown', onViewerKey))
</script>

<template>
  <div v-if="project">
    <header class="phdr">
      <button class="phdr__back" :aria-label="t('common.back')" @click="goBack"><AppIcon name="chevronLeft" :size="22" /></button>
      <ThumbImage :src="cover" kind="project" :seed="project.name" :alt="project.name" class="pdetail__cover" />
      <h1 class="phdr__title">{{ project.name }}</h1>
      <button ref="triggerRef" class="phdr__kebab" :aria-label="t('common.actions')" aria-haspopup="true" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen"><AppIcon name="kebab" :size="20" /></button>
      <Transition name="menu">
        <nav v-if="menuOpen" ref="menuRef" class="menu">
          <button class="menu__item" @click="edit">{{ t('project.edit') }}</button>
          <button v-if="linkedPattern?.pdf" class="menu__item" @click="viewPatternPdf">{{ t('project.viewPdf') }}</button>
          <button v-if="linkedPattern?.reader?.sections?.length" class="menu__item" @click="correctPattern">{{ t('project.correctPattern') }}</button>
          <!-- Porte de retour du chrono masqué (08/09) : dynamique selon l'état —
               « Masquer le chrono » (redondant avec le chevron de la pastille : même geste,
               autre chemin, accessible clavier/lecteur d'écran) / « Afficher le chrono »
               quand masqué. La pastille absente du dock n'est plus un cul-de-sac. -->
          <button class="menu__item" @click="toggleTimerFromMenu">{{ showTimer ? t('reader.hideTimer') : t('reader.showTimer') }}</button>
          <div class="menu__sep" role="separator"></div>
          <button class="menu__item menu__item--danger" @click="remove">{{ t('project.delete') }}</button>
        </nav>
      </Transition>
      <div v-if="menuOpen" class="menu__scrim" @click="menuOpen = false"></div>
    </header>

    <div class="screen" @touchstart.passive="onTabTouchStart" @touchend.passive="onTabTouchEnd">
      <StatusBadge :status="project.status" editable menu-align="left" @change="changeStatus" />

      <div class="tabs" ref="tabsEl" :class="{ 'tabs--fade': tabsFadeActive }" role="tablist" :aria-label="t('project.tabsLabel')">
        <button
          v-for="tb in TABS"
          :id="`tab-${tb}`"
          :key="tb"
          class="tab"
          :class="{ 'tab--on': tab === tb }"
          role="tab"
          :aria-selected="tab === tb"
          :aria-controls="`panel-${tb}`"
          @click="changeTab(tb)"
        >
          {{ t(`project.tab.${tb}`) }}
        </button>
      </div>

      <div class="panels">
      <Transition :name="`tab-${slideDir}`" mode="out-in">

      <!-- INFOS (libellé « Détails ») -->
      <div v-if="tab === 'infos'" id="panel-infos" class="infos" role="tabpanel" aria-labelledby="tab-infos">
        <!-- Patron source : le projet repose dessus. On le mentionne sobrement (le lien
             « Voir le PDF original » est discret pour ne pas inciter à quitter le projet),
             avec la vignette couverture (photo du patron) juste au-dessus, tap → PDF externe.
             Boutons Aperçu/Ouvrir (ProjectPdfGallery variant="pdf") retirés ici —
             les photos restent dans l'onglet Galerie. Vignette gardée aussi sur `pdf` (pas
             seulement `photos`) : son SEUL rôle ici est le raccourci vers le PDF (viewPatternPdf) ;
             sans PDF retenu (best-effort import, cf. pdf-import/index.js — photo et pdf sont deux
             réussites indépendantes), l'afficher quand même mènerait à un tap mort (snackbar
             d'erreur) plutôt qu'à l'ouverture attendue. -->
        <section v-if="linkedPattern" class="patron-source">
          <span class="patron-source__k">{{ t('project.patternSource') }}</span>
          <span class="patron-source__name">{{ linkedPattern.name }}</span>
          <span v-if="patternPriceText" class="patron-source__price" data-test="project-pattern-price">
            {{ t('project.patternPriceLabel') }} · {{ patternPriceText }}
          </span>
          <button v-if="linkedPattern.photos?.length && linkedPattern.pdf" class="patron-source__cover" :aria-label="t('project.viewPdf')" @click="viewPatternPdf">
            <img :src="linkedPattern.photos[0]" class="patron-source__img" :alt="linkedPattern.name" />
          </button>
          <button v-if="linkedPattern.pdf" class="patron-source__open" @click="viewPatternPdf">{{ t('project.viewPdf') }} <AppIcon name="chevronRight" :size="14" /></button>
        </section>

        <!-- Taille tricotée : sélecteur qui pilote les instructions affichées (PRD §7.4) -->
        <template v-if="project.sizes && project.sizes.length">
          <p class="subhead">{{ isCrochet ? t('project.activeSizeCrochet') : t('project.activeSize') }}</p>
          <p class="block-hint">{{ t('project.activeSizeHint') }}</p>
          <div class="chips chips--sizes">
            <button v-for="sz in project.sizes" :key="sz" class="chip" :class="{ 'chip--on': project.activeSize === sz }" @click="setActiveSize(sz)">{{ sizeLabelText(sz, t) }}</button>
          </div>
        </template>

        <!-- Données du projet en tuiles (bento) -->
        <div class="info-bento">
          <div class="itile"><span class="itile__k">{{ t('project.technique') }}</span><span class="itile__v">{{ t(`technique.${project.technique}`) }}</span></div>
          <div v-if="hasNeedle" class="itile"><span class="itile__k">{{ isCrochet ? t('project.hooks') : t('project.needles') }}</span><span class="itile__v">{{ needleList.join(', ') }}</span></div>
          <div v-if="hasGauge" class="itile"><span class="itile__k">{{ t('project.gauge') }}</span><span class="itile__v">{{ [project.gaugeStitches && project.gaugeStitches + ' m', project.gaugeRows && project.gaugeRows + ' rg'].filter(Boolean).join(' × ') }}</span></div>
          <div v-if="project.startedAt" class="itile"><span class="itile__k">{{ t('project.startedAt') }}</span><span class="itile__v">{{ formatLocalDate(project.startedAt, locale) }}</span></div>
          <div v-if="project.finishedAt" class="itile"><span class="itile__k">{{ t('project.finishedAt') }}</span><span class="itile__v">{{ formatLocalDate(project.finishedAt, locale) }}</span></div>
          <div v-if="project.stars" class="itile itile--wide"><span class="itile__k">{{ t('project.stars') }}</span><span class="itile__v stars" role="img" :aria-label="t('project.starsValue', { n: project.stars })"><AppIcon v-for="n in project.stars" :key="n" name="starFilled" :size="16" /></span></div>
          <div v-if="project.notes" class="itile itile--wide"><span class="itile__k">{{ t('project.notes') }}</span><p class="itile__notes">{{ project.notes }}</p></div>
          <div class="itile itile--wide">
            <span class="itile__k">{{ t('project.yarns') }}</span>
            <ul v-if="projectYarns.length || consumedYarns.length" class="yarnlist">
              <li v-for="y in projectYarns" :key="'r' + y.id">
                {{ y.brand || '—' }}<template v-if="y.colorName"> · {{ y.colorName }}</template>
                <!-- Réservé / stock (constat revue, 08/08) : `y.quantity` seul n'affichait que
                     le stock, jamais ce que la tuile « Coût du projet » facture (1 pelote par
                     défaut, ProjectEditView.vue:101) — « ×10 » à côté d'un coût pour 1 pelote se
                     lisait comme un total cassé. Les deux nombres restent : rien ne disparaît. -->
                <span class="yarnlist__meta">×{{ reservationsOf(y)[project.id] }} / {{ y.quantity }}<template v-if="y.weight"> · {{ t(`yarn.weights.${y.weight}`) }}</template></span>
              </li>
              <li v-for="y in consumedYarns" :key="'c' + y.id">
                {{ y.brand || '—' }}<template v-if="y.colorName"> · {{ y.colorName }}</template>
                <span class="yarnlist__meta">{{ t('project.yarnKnitted', { n: consumedOf(y)[project.id] }) }}</span>
              </li>
            </ul>
            <p v-else class="yarnlist__empty">{{ t('project.yarnsNone') }}</p>
          </div>
          <!-- Coût du projet (depuis le 08/08) : le prix des laines imputées à ce projet, puis
               celui du patron ENTRE PARENTHÈSES. Les deux ne sont JAMAIS additionnés : le
               prix d'une pelote suit la devise du réglage, celui du patron porte la sienne
               (un patron acheté en francs suisses dans une app réglée en euros est un cas
               normal). Une somme unique afficherait un montant faux — la juxtaposition
               n'est pas une préférence de mise en forme, elle est ce qui rend la ligne
               correcte. Le patron n'est jamais multiplié non plus : payé une fois, tricoté
               autant de fois qu'on veut (cf. utils/pattern-price.js). -->
          <div v-if="showCost" class="itile itile--wide" data-test="project-total-cost">
            <span class="itile__k">{{ t('project.totalCost') }}</span>
            <span class="itile__v">
              {{ yarnCostText }}
              <span v-if="patternPriceText" class="cost__pattern">({{ t('project.costPatternInline', { price: patternPriceText }) }})</span>
            </span>
            <p v-if="cost.unknownCount" class="cost__hint">{{ t('project.costUnknownPrices', { n: cost.unknownCount }) }}</p>
          </div>
        </div>
        <button class="btn btn--block edit-btn" @click="edit">{{ t('project.edit') }}</button>
      </div>

      <!-- SECTIONS -->
      <div v-else-if="tab === 'sections'" id="panel-sections" class="sections" role="tabpanel" aria-labelledby="tab-sections">
        <!-- Patron supprimé de la bibliothèque : rien n'est perdu (progression conservée),
             mais il faut le dire — sinon la fiche se vide sans un mot (audit UX 16/07). -->
        <p v-if="patternMissing" class="orphan">
          {{ t('project.patternMissing') }}
        </p>

        <!-- Patron structuré : aperçu des sections du lecteur + suivi interactif -->
        <template v-if="readerOverview">
          <!-- Avancement global du projet, en tête de l'onglet (#8) -->
          <div v-if="readerOverview.total" class="rprog">
            <div class="rprog__top">
              <span class="rprog__pct">{{ readerOverview.pct }} %</span>
              <span class="rprog__frac">{{ readerOverview.done }} / {{ readerOverview.total }}</span>
            </div>
            <StitchProgress :technique="isCrochet ? 'crochet' : 'knitting'" :done="readerOverview.done" :total="readerOverview.total" />
          </div>
          <button class="btn btn--primary btn--block reader-btn" @click="openReader"><AppIcon name="book" :size="18" /> {{ t('reader.followPattern') }}</button>
          <div v-for="s in readerOverview.sections" :key="s.id" class="rovw">
            <button class="rovw__main" @click="openSection(s)">
              <span class="rovw__ic"><AppIcon :name="s.kind" :size="20" /></span>
              <span class="rovw__body">
                <span class="rovw__top">
                  <span class="rovw__title">{{ sectionTitleLabel(s, t) }}</span>
                  <span class="rovw__pct" :class="{ 'rovw__pct--done': s.complete }"><template v-if="s.complete"><AppIcon name="check" :size="13" /> {{ t('reader.sectionDone') }}</template><template v-else>{{ s.pct }} %</template></span>
                </span>
                <span class="rovw__track"><span class="rovw__fill" :class="{ 'rovw__fill--done': s.complete }" :style="{ width: s.pct + '%' }"></span></span>
              </span>
            </button>
            <AppCheckbox v-if="s.total" class="rovw__done" :modelValue="s.complete" :aria-label="t('section.markDoneA11y')" @update:modelValue="() => onToggleSection(s)" />
          </div>
        </template>

        <!-- Compteurs : bloc distinct des sections (objets « outil » autonomes) -->
        <section class="counters-block">
          <h2 class="subhead subhead--block">
            {{ t('counter.title') }}
            <span v-if="countersStore.counters.length" class="subhead__count">{{ countersStore.counters.length }}</span>
          </h2>
          <p class="block-hint">{{ t('counter.projectHint') }}</p>
          <div v-if="countersStore.counters.length" class="clist">
            <CounterCard v-for="c in countersStore.counters" :key="c.id" :counter="c" @set="setCounter" @update="updateCounter" @remove="removeCounter" />
          </div>
          <div v-if="addingCounter" class="mt2">
            <CounterForm @submit="addCounter" />
            <button class="btn btn--block mt2" @click="addingCounter = false">{{ t('common.cancel') }}</button>
          </div>
          <button v-else class="btn btn--block mt2" @click="addingCounter = true"><AppIcon name="plus" :size="17" /> {{ t('counter.add') }}</button>
        </section>
      </div>

      <!-- PHOTOS (libellé « Galerie ») : 2 sections — photos du projet, puis photos du patron -->
      <div v-else-if="tab === 'photos'" id="panel-photos" class="photos" role="tabpanel" aria-labelledby="tab-photos">
        <!-- Section 1 : photos du projet (ajout/suppression/visionneuse) -->
        <button class="btn btn--primary btn--block" @click="addPhoto"><AppIcon name="plus" :size="17" /> {{ t('photo.add') }}</button>
        <div v-if="(project.photos || []).length" class="pgrid">
          <div v-for="(ph, idx) in project.photos" :key="idx" class="pthumb">
            <button class="pthumb__open" :aria-label="t('photo.view', { n: idx + 1 })" @click="openViewer(idx)">
              <img :src="ph" :alt="`${project.name} — ${idx + 1}`" />
            </button>
            <span v-if="idx === coverIndex" class="pthumb__badge">{{ t('project.coverBadge') }}</span>
            <button v-else class="pthumb__cover" :aria-label="t('project.setCover')" @click="setCover(idx)"><AppIcon name="star" :size="16" /></button>
            <button class="pthumb__del" :aria-label="t('common.delete')" @click="removePhoto(idx)"><AppIcon name="close" :size="15" /></button>
          </div>
        </div>
        <p v-else class="muted photos__empty">{{ t('photo.empty') }}</p>

        <!-- Section 2 : photos du patron lié (lecture seule) -->
        <template v-if="linkedPattern?.photos?.length">
          <h2 class="subhead">{{ t('project.galleryPattern') }}</h2>
          <div class="patron-photos">
            <img
              v-for="(ph, i) in linkedPattern.photos"
              :key="i"
              :src="ph"
              class="patron-photos__img"
              :alt="linkedPattern.name"
              @click="lightbox.show(linkedPattern.photos, i)"
            />
          </div>
        </template>

        <!-- Section 3 : galerie extraite de l'instance du patron (le PDF d'origine est
             désormais sous « Patron source » dans l'onglet Détails, pas dupliqué ici). -->
        <ProjectPdfGallery v-if="linkedPattern" :gallery="linkedPattern.gallery || []" variant="gallery" />
      </div>

      <!-- SESSIONS -->
      <div v-else id="panel-sessions" class="sessions-tab" role="tabpanel" aria-labelledby="tab-sessions">
        <!-- Le bandeau « Session en cours » a disparu (chantier « chrono unifié », 2026-08-30) :
             c'est la pastille chrono flottante, visible sur tous les onglets, qui rappelle
             désormais la session qui tourne — cf. .chrono-dock en fin de template. -->
        <!-- Session vivante : les tuiles racontent la journée EN COURS, ligne virtuelle et
             temps non écrit compris — un compteur à 0 ou un total figé au dernier commit
             mentiraient pendant que le temps court. Le couple (ligne cible étendue, total
             + liveChunk) ne compte JAMAIS deux fois la même seconde : durationSec des
             lignes chargées d'un côté, solde non commis de l'autre, les deux s'excluent
             par construction (commitChunk avance le filigrane en même temps que la ligne). -->
        <div class="ses-recap">
          <div class="rtile"><span class="rtile__k">{{ t('session.recapCount') }}</span><span class="rtile__v">{{ sessionsStore.sessions.length + (virtualLive ? 1 : 0) }}</span></div>
          <div class="rtile rtile--sage"><span class="rtile__k">{{ t('session.recapTotal') }}</span><span class="rtile__v">{{ fmtDuration(sessionsTotal + liveChunk) }}</span></div>
        </div>

        <div v-if="addingSession" class="card addform">
          <label class="field-label" for="sd">{{ t('session.date') }}</label>
          <input id="sd" v-model="newSess.date" class="input" type="date" />
          <div class="row mt2">
            <div class="col"><label class="field-label" for="sm">{{ t('session.durationMin') }}</label><input id="sm" v-model="newSess.durationMin" class="input" inputmode="numeric" placeholder="30" /></div>
            <div class="col"><label class="field-label" for="sr">{{ t('session.rows') }}</label><input id="sr" v-model="newSess.rows" class="input" inputmode="numeric" placeholder="12" /></div>
          </div>
          <div class="addform__actions">
            <button class="btn" @click="addingSession = false">{{ t('common.cancel') }}</button>
            <button class="btn btn--primary" @click="saveManualSession">{{ t('common.save') }}</button>
          </div>
        </div>
        <button v-else class="btn btn--block" @click="addingSession = true"><AppIcon name="plus" :size="17" /> {{ t('session.addManual') }}</button>

        <div class="list mt">
          <!-- Ligne virtuelle : la session qui vit sans exister encore au journal (chrono de
               CE projet, rien à fusionner). EN TÊTE, avant toute ligne chargée — y compris
               une date postérieure, la liste triée ne sait pas la deviner. Date du jour :
               une date-INSTANT passée à formatLocalDate (jamais une troncature UTC, qui
               décalerait d'un jour à l'ouest de Greenwich près de minuit). PAS de boutons
               édition/suppression : elle n'a pas d'id, rien dans la base ne la porte — la
               première pause la transformera en ligne vraie. -->
          <div v-if="virtualLive" class="ses-row ses-row--virtual">
            <div>
              <span class="ses-row__date">{{ formatLocalDate(new Date().toISOString(), locale) }}</span>
              <span class="ses-row__meta">{{ fmtDuration(liveChunk) }}</span>
            </div>
            <span
              class="ses-live"
              :class="{ 'ses-live--paused': !active.running }"
              role="img"
              :aria-label="active.running ? t('session.liveRunning') : t('session.livePaused')"
            ><template v-if="!active.running">{{ t('session.livePaused') }}</template></span>
          </div>
          <template v-for="s in sessionsStore.sessions" :key="s.id">
            <!-- Édition inline : rectifier temps / rangs / date -->
            <div v-if="editingSessionId === s.id" class="card addform">
              <label class="field-label" :for="`esd-${s.id}`">{{ t('session.date') }}</label>
              <input :id="`esd-${s.id}`" v-model="editSess.date" class="input" type="date" />
              <div class="row mt2">
                <div class="col"><label class="field-label" :for="`esm-${s.id}`">{{ t('session.durationMin') }}</label><input :id="`esm-${s.id}`" v-model="editSess.durationMin" class="input" inputmode="numeric" /></div>
                <div class="col"><label class="field-label" :for="`esr-${s.id}`">{{ t('session.rows') }}</label><input :id="`esr-${s.id}`" v-model="editSess.rows" class="input" inputmode="numeric" /></div>
              </div>
              <div class="addform__actions">
                <button class="btn" @click="editingSessionId = null">{{ t('common.cancel') }}</button>
                <button class="btn btn--primary" @click="saveEditSession">{{ t('common.save') }}</button>
              </div>
            </div>
            <!-- Ligne cible de fusion : durée ÉTENDUE du chunk en cours (rowDuration) —
                 l'édition inline, elle, reste au temps ÉCRIT (elle corrige la base, pas
                 la session qui court). -->
            <div v-else class="ses-row" :class="{ 'ses-row--live': s.id === liveTarget?.id }">
              <div>
                <span class="ses-row__date">{{ formatLocalDate(s.date, locale) }}</span>
                <span class="ses-row__meta">{{ fmtDuration(rowDuration(s)) }}<template v-if="s.rowsDone"> · {{ s.rowsDone }} {{ t('session.rowsShort') }}</template></span>
              </div>
              <span
                v-if="s.id === liveTarget?.id"
                class="ses-live"
                :class="{ 'ses-live--paused': !active.running }"
                role="img"
                :aria-label="active.running ? t('session.liveRunning') : t('session.livePaused')"
              ><template v-if="!active.running">{{ t('session.livePaused') }}</template></span>
              <div class="ses-row__acts">
                <button class="ses-row__edit" :aria-label="t('session.editTime')" @click="startEditSession(s)"><AppIcon name="edit" :size="16" /></button>
                <button class="ses-row__del" :aria-label="t('common.delete')" @click="removeSession(s.id)"><AppIcon name="close" :size="16" /></button>
              </div>
            </div>
          </template>
        </div>
        <!-- « Vide » seulement vide À L'ŒIL : la ligne virtuelle occupe déjà la liste,
             l'utilisateur qui vient de démarrer ne doit pas lire « aucune session ». -->
        <p v-if="!sessionsStore.sessions.length && !virtualLive" class="muted">{{ t('session.empty') }}</p>
      </div>
      </Transition>
      </div>
    </div>

    <!-- Visionneuse photo plein écran -->
    <Teleport to="body">
      <Transition name="viewer">
        <div
          v-if="viewerIdx != null"
          class="viewer"
          role="dialog"
          aria-modal="true"
          :aria-label="t('photo.viewerLabel')"
          @click.self="closeViewer"
          @keydown="trapTabFocus"
        >
          <img class="viewer__img" :src="photos[viewerIdx]" :alt="`${project.name} — ${viewerIdx + 1}`" />
          <button class="viewer__close" :aria-label="t('common.close')" @click="closeViewer"><AppIcon name="close" :size="22" /></button>
          <button v-if="viewerIdx > 0" class="viewer__nav viewer__nav--prev" :aria-label="t('common.previous')" @click="viewerPrev"><AppIcon name="chevronLeft" :size="26" /></button>
          <button v-if="viewerIdx < photos.length - 1" class="viewer__nav viewer__nav--next" :aria-label="t('common.next')" @click="viewerNext"><AppIcon name="chevronRight" :size="26" /></button>
          <div class="viewer__count">{{ viewerIdx + 1 }} / {{ photos.length }}</div>
        </div>
      </Transition>
    </Teleport>

    <!-- « Combien de pelotes as-tu réellement utilisées/perdues ? » (Terminé ou Abandonné,
    si des laines sont réservées — R3 : le mode pilote le défaut du dialogue). -->
    <YarnConsumptionDialog
      :open="projectConsumption.open"
      :yarns="projectConsumption.yarns"
      :mode="projectConsumption.mode"
      @confirm="projectConsumption.confirm"
    />

    <!-- Chrono flottant (chantier « chrono unifié », 2026-08-30) : la MÊME pastille que la barre
         du lecteur (ChronoPill — elle lit le store activeSession et rend ses états
         elle-même), ancrée en bas d'écran et visible sur TOUS les onglets : le temps de
         travail n'est pas une propriété de l'onglet Sections, on tricote aussi depuis les
         compteurs, la galerie ou la relecture des sessions. Cette vue ne garde que la
         politique : toggleChrono (démarrage/pause) et le masquage (toggleTimerFromDetail,
         branché sur le chevron de la pastille — 08/09 : l'œil a disparu d'ici comme
         du lecteur). Aucune porte de retour dans ce dock : masquée, la pastille disparaît
         ENTIÈREMENT (chevron compris), et les portes durables sont ailleurs — l'entrée
         « Afficher le chrono » du kebab ci-dessus (toujours là) et l'interrupteur du
         formulaire d'édition (ProjectEditView). -->
    <div class="chrono-dock">
      <ChronoPill v-if="showTimer" can-hide @toggle="toggleChrono" @hide="toggleTimerFromDetail" />

      <!-- Retour en haut : DANS le dock, retiré du flux de la rangée — même motif que la
           barre du lecteur (cf. ReaderView.vue, même commentaire) : son `position: fixed`
           par défaut le collerait au même coin que ce dock (z-index 40 des deux côtés), et
           l'ordre du DOM déciderait arbitrairement qui reçoit l'appui. `.chrono-dock
           :deep(.btt)` dans le bloc <style> le rend absolu et le pose AU-DESSUS du dock,
           aligné sur son padding droit — la fiche défile le document, pas de cible (même
           câblage que les autres écrans longs). -->
      <BackToTop />
    </div>

    <!-- Astuce de navigation, au premier passage dans une fiche (projet, patron ou laine) :
         c'est ici que « revenir en arrière » et « faire défiler la bande d'onglets »
         deviennent des gestes utiles. Le composant décide seul s'il s'affiche. -->
    <FirstDetailTip />
  </div>

  <!-- Chargement -->
  <SkeletonScreen v-else-if="loading" variant="detail" />

  <!-- Projet introuvable -->
  <div v-else class="screen notfound">
    <p class="muted">{{ t('project.notFound') }}</p>
    <button class="btn btn--block mt" @click="goBack">{{ t('common.back') }}</button>
  </div>
</template>

<style scoped>
/* Collant + fond opaque, comme .hdr (AppHeader) et .rhdr (ReaderView) : au défilement le
   retour, le titre et le kebab restent atteignables, et le contenu passe DESSOUS sans
   jamais toucher la barre de statut.
   `sticky` établit aussi le bloc conteneur du `.menu` en position: absolute — l'ancrage
   `top: calc(56px + var(--sa-top))` est préservé. z-index 40 = même rang que .hdr ; le
   `.menu` (60) et son voile fixe (50) peignent au-dessus, motif éprouvé d'AppHeader. */
.phdr { position: sticky; top: 0; z-index: 40; background: var(--bg); display: flex; align-items: center; gap: var(--sp-2); padding: max(var(--sp-4), var(--sa-top)) max(var(--sp-4), var(--sa-right)) var(--sp-4) max(var(--sp-4), var(--sa-left)); max-width: var(--w-content); margin: 0 auto; }
.pdetail__cover { width: 44px; height: 44px; border-radius: var(--r-md); flex-shrink: 0; }
.phdr__title { flex: 1; min-width: 0; font-size: 21px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.phdr__back, .phdr__kebab { border: 1px solid var(--line); background: var(--tile); color: var(--ink); width: 44px; height: 44px; border-radius: var(--r-md); font-size: 22px; box-shadow: var(--clay-sm); flex-shrink: 0; }
.phdr__back:active, .phdr__kebab:active { box-shadow: var(--clay-press); transform: scale(0.97); }
.menu { position: absolute; top: calc(56px + var(--sa-top)); right: max(var(--sp-4), var(--sa-right)); z-index: 60; background: var(--bg); border: 1px solid var(--line); border-radius: var(--r-md); box-shadow: var(--e-3); padding: var(--sp-2); min-width: 180px; display: flex; flex-direction: column; }
.menu__item { text-align: left; border: none; background: transparent; color: var(--ink); font-size: 15px; font-weight: 600; padding: 12px 14px; border-radius: var(--r-sm); }
/* Sépare l'action destructive des actions ordinaires : à l'échelle réelle d'un téléphone, le
   fin liseré à 12 % d'opacité passait inaperçu et on pouvait taper « Supprimer » en visant
   « Modifier ». Cf. audit UX 16/07, item P1 n°3 (volet « espace »), rouvert le 17/07. */
.menu__sep { height: 1px; background: var(--line); margin: var(--sp-2); }
.menu__item--danger { color: var(--danger); }
.menu__scrim { position: fixed; inset: 0; z-index: 50; }
.menu-enter-active, .menu-leave-active { transition: all var(--motion-fast); }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(-6px); }
.tabs { display: flex; gap: 7px; margin: var(--sp-4) 0; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; padding-bottom: 2px; }
.tabs::-webkit-scrollbar { display: none; }
/* Indice de défilement (T8) : posé UNIQUEMENT quand ça déborde réellement (useScrollFade),
   jamais en CSS pur inconditionnel — un dégradé permanent sur une barre qui tient à l'écran
   mentirait. `mask-image` fait varier l'alpha réel des pastilles près du bord droit : ça
   laisse transparaître le fond quel qu'il soit, donc ZÉRO couleur/token de fond à coder en
   dur (contrairement à un overlay `background: linear-gradient(transparent, <couleur>)`). */
.tabs--fade {
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent 100%);
  mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent 100%);
}
.tab { flex-shrink: 0; white-space: nowrap; }
/* conteneur des panneaux : clippe le léger glissement pour éviter tout scroll horizontal */
.panels { overflow-x: clip; }
.tab-next-enter-active, .tab-next-leave-active,
.tab-prev-enter-active, .tab-prev-leave-active { transition: opacity var(--motion-fast), transform var(--motion-fast); }
.tab-next-enter-from { opacity: 0; transform: translateX(14px); }
.tab-next-leave-to { opacity: 0; transform: translateX(-14px); }
.tab-prev-enter-from { opacity: 0; transform: translateX(-14px); }
.tab-prev-leave-to { opacity: 0; transform: translateX(14px); }
.tab { border: 1px solid var(--line); background: var(--tile); color: var(--ink-55); font-weight: 600; font-size: 13.5px; padding: 10px 16px; border-radius: var(--r-pill); box-shadow: var(--clay-sm); }
.tab--on { background: var(--brand-grad); color: var(--on-accent); border-color: transparent; box-shadow: 0 8px 15px -7px rgba(var(--brand-rgb), 0.6), 0 1px 1px rgba(255, 255, 255, 0.3) inset; }

/* bento des infos : chaque donnée = une tuile */
.info-bento { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr)); gap: 11px; margin-top: var(--sp-2); }
.itile { background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: 13px 14px; box-shadow: var(--clay-sm); }
.itile--wide { grid-column: 1 / -1; }
.itile__k { display: block; font-size: 11px; font-weight: 600; color: var(--ink-55); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 5px; }
.itile__v { display: block; font-family: var(--font-display); font-size: 17px; font-weight: 600; color: var(--ink); }
.itile__notes { margin: 0; white-space: pre-wrap; color: var(--ink-70); font-size: 14px; font-style: italic; }
.stars { color: var(--mustard); letter-spacing: 2px; }
.yarnlist { margin: var(--sp-2) 0 0; padding-left: var(--sp-5); color: var(--ink); }
.yarnlist li { padding: 3px 0; }
.yarnlist__meta { color: var(--ink-55); font-size: 13px; margin-left: var(--sp-2); }
.yarnlist__empty { margin: var(--sp-2) 0 0; color: var(--ink-55); font-size: 14px; }
.edit-btn { margin-top: var(--sp-5); }
.list { display: flex; flex-direction: column; gap: var(--sp-2); }
.subhead { font-family: var(--font-display); font-weight: 600; font-size: 16px; margin: var(--sp-5) 0 var(--sp-2); }
.counters-block { margin-top: var(--sp-6); padding: var(--sp-4) var(--sp-4) var(--sp-3); background: rgba(58, 46, 40, 0.035); border: 1px solid var(--line-soft); border-radius: var(--r-lg); }
/* En sombre, la teinte encre à 3,5 % (pensée pour un fond crème) devient quasi
   invisible sur --bg déjà très sombre : on bascule sur une touche claire, même
   esprit que le rehaut --clay sombre (rgba(255, 244, 230, …)). */
:root[data-theme='dark'] .counters-block,
html[data-theme='dark'] .counters-block {
  background: rgba(255, 244, 230, 0.05);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .counters-block {
    background: rgba(255, 244, 230, 0.05);
  }
}
.subhead--block { display: flex; align-items: center; gap: var(--sp-2); margin-top: 0; }
.subhead__count { font-family: var(--font-ui); font-size: 12px; font-weight: 700; color: var(--ink-55); background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-pill); padding: 1px 9px; box-shadow: var(--clay-sm); }
.block-hint { margin: 0 0 var(--sp-3); font-size: 12.5px; color: var(--ink-55); }
.chips { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.chips--sizes { margin-bottom: var(--sp-3); }
.chip { border: 1px solid var(--line); background: var(--tile); color: var(--ink-55); font-weight: 600; font-size: 13px; padding: 0 16px; border-radius: var(--r-pill); box-shadow: var(--clay-sm); min-height: 44px; display: inline-flex; align-items: center; }
.chip--on { background: var(--brand-grad); border-color: transparent; color: var(--on-accent); box-shadow: var(--clay-press); }
.muted { color: var(--ink-55); font-size: 14px; }
.mt { margin-top: var(--sp-3); }
.mt2 { margin-top: var(--sp-2); }
.notes { resize: vertical; font-family: var(--font-ui); }
.addform { margin-top: var(--sp-3); }
.addform__actions { display: flex; gap: var(--sp-3); margin-top: var(--sp-3); }
.addform__actions .btn { flex: 1; }
.check { display: flex; align-items: center; gap: var(--sp-2); margin-top: var(--sp-2); color: var(--ink-55); font-size: 14px; }
.clist { display: flex; flex-direction: column; gap: var(--sp-3); }
.patron-source { display: flex; flex-direction: column; gap: 2px; background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-3); box-shadow: var(--clay-sm); }
.patron-source__k { font-size: 12px; color: var(--ink-55); text-transform: uppercase; letter-spacing: 0.04em; }
.patron-source__name { font-family: var(--font-display); font-weight: 600; color: var(--ink); }
.patron-source__price {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink-55);
}
/* Le prix du patron dans la tuile de coût : présent mais en retrait — c'est un rappel,
   la valeur principale reste le coût des laines. Aucune couleur en dur (jeton du thème),
   sinon la ligne devient illisible en thème sombre. */
.cost__pattern {
  color: var(--ink-55);
  font-size: 13px;
  font-weight: 400;
}
.cost__hint {
  margin-top: var(--sp-2);
  color: var(--ink-55);
  font-size: 12px;
}
/* lien discret : pas un bouton proéminent, pour ne pas inciter à quitter le projet */
.patron-source__open { align-self: flex-start; display: inline-flex; align-items: center; gap: 2px; margin-top: 2px; padding: 0; background: none; border: none; font-size: 13px; color: var(--brand-deep); }
.patron-source__open:active { opacity: 0.6; }
/* vignette couverture : tap → PDF (retrait des boutons Aperçu/Ouvrir de ProjectPdfGallery ici) */
.patron-source__cover { align-self: flex-start; margin: 4px 0 2px; padding: 0; background: none; border: none; }
.patron-source__cover:active { opacity: 0.7; }
.patron-source__img { width: 96px; height: 76px; object-fit: cover; border-radius: var(--r-sm); border: 1px solid var(--line); display: block; }
.patron-photos { display: flex; gap: var(--sp-2); overflow-x: auto; margin-bottom: var(--sp-4); }
.reader-btn { margin: 0 0 var(--sp-3); }
.rprog { background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3); margin-bottom: var(--sp-3); box-shadow: var(--clay-sm); }
.rprog__top { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
.rprog__pct { font-family: var(--font-display); font-size: 17px; color: var(--brand-deep); }
.rprog__frac { font-size: 12.5px; color: var(--ink-55); font-variant-numeric: tabular-nums; }
.rovw { width: 100%; display: flex; align-items: center; gap: var(--sp-2); background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3); margin-bottom: var(--sp-2); box-shadow: var(--clay-sm); }
.rovw__main { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--sp-3); text-align: left; background: transparent; border: none; padding: 0; }
.rovw__main:active { transform: scale(0.99); }
.rovw__done { flex: none; }
.rovw__ic { width: 34px; height: 34px; border-radius: var(--r-sm); display: grid; place-items: center; background: var(--surface-lin); font-size: 17px; flex: none; }
.rovw__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.rovw__top { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-2); }
.rovw__title { font-weight: 600; color: var(--ink); }
.rovw__pct { font-size: 12px; font-weight: 700; color: var(--ink-55); font-variant-numeric: tabular-nums; flex: none; }
.rovw__pct--done { color: var(--sage-deep); }
.rovw__track { height: 7px; border-radius: var(--r-pill); background: var(--surface); box-shadow: var(--clay-press); overflow: hidden; }
.rovw__fill { display: block; height: 100%; border-radius: var(--r-pill); background: linear-gradient(90deg, var(--brand-deep), var(--brand)); transition: width var(--motion-base); }
.rovw__fill--done { background: linear-gradient(90deg, var(--sage-deep), var(--sage)); }
.patron-photos__img { width: 96px; height: 76px; object-fit: cover; border-radius: var(--r-sm); border: 1px solid var(--line); flex: none; cursor: pointer; }
.row { display: flex; gap: var(--sp-3); }
.col { flex: 1; }
/* Chrono flottant : ancre fixe en bas d'écran, même motif que la barre du lecteur
   (ReaderView.vue). HORS du panneau transitionné des onglets, donc visible sur tous.
   Conteneur pleine largeur borné au contenu ; il laisse passer les taps dans sa zone
   dégradée (pointer-events), seuls les boutons captent. Pastille et œil groupés À
   GAUCHE : c'est le chrono qui mène (décision de disposition reprise du lecteur), et
   la portée du pouce y est naturelle. */
.chrono-dock {
  position: fixed;
  z-index: 40;
  left: 0;
  right: 0;
  bottom: 0;
  margin: 0 auto;
  max-width: var(--w-content);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  /* Marges latérales NOMMÉES : le retour-en-haut, positionné en absolu dans ce dock,
     doit s'aligner sur le bord droit du contenu (le containing block d'un absolu est
     la padding box — `right: 0` le collerait au bord du dock). Une valeur-copie
     divergerait ; la variable, non. */
  --dock-pad-x-right: max(var(--sp-4), var(--sa-right));
  --dock-pad-x-left: max(var(--sp-4), var(--sa-left));
  padding: var(--sp-4) var(--dock-pad-x-right) calc(var(--sp-4) + var(--sa-bottom)) var(--dock-pad-x-left);
  background: linear-gradient(0deg, var(--bg) 60%, rgba(250, 246, 238, 0));
  pointer-events: none;
}
/* Même correctif que la barre du lecteur : le point transparent du dégradé doit
   interpoler depuis --bg sombre. */
:root[data-theme='dark'] .chrono-dock,
html[data-theme='dark'] .chrono-dock {
  background: linear-gradient(0deg, var(--bg) 60%, rgba(22, 18, 16, 0));
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .chrono-dock {
    background: linear-gradient(0deg, var(--bg) 60%, rgba(22, 18, 16, 0));
  }
}
.chrono-dock > * {
  pointer-events: auto;
}
/* Retour en haut, empilé AU-DESSUS du dock (cf. le commentaire du <BackToTop /> dans le
   template) : son style par défaut (`.btt`, scopé à BackToTop.vue) est `position: fixed`
   au même coin et au même z-index que CE dock — à z-index égal, l'ordre du DOM
   déciderait arbitrairement qui reçoit l'appui. `:deep()` atteint sa racine pour le
   rendre `absolute` par rapport au dock (lui-même fixed) : une seule ancre pour les
   trois contrôles. `bottom: 100%` = juste au-dessus du bord haut du dock, sans jamais
   dépendre d'une hauteur de rangée écrite en dur (la pastille, masquable, en change).
   `absolute` le retire du flux de la rangée : il ne prend aucune largeur à la pastille. */
.chrono-dock :deep(.btt) {
  position: absolute;
  right: var(--dock-pad-x-right);
  bottom: 100%;
  z-index: auto;
}
/* Pastille : son rendu propre (couleurs, typo, états sombres, pulsation) vit dans
   ChronoPill.vue ; seule la DISPOSITION reste ici, d'où le :deep() — seul moyen
   d'atteindre depuis cette feuille scopée un bouton porteur du data-v du composant.
   Largeur ajustée à son contenu, jamais toute la rangée (retour device 27/07, repris
   du lecteur). Pas de resserrage téléphone : ici la pastille n'a pas trois boutons
   voisins à partager la rangée, la place n'a jamais manqué. */
.chrono-dock :deep(.chrono-fab) {
  flex: 0 1 auto;
  min-width: min(11ch, 100%);
}
/* Le contenu défile SOUS le chrono flottant : sans ce dégagement, la fin de chaque
   onglet passerait sous la pastille. Même correctif que le lecteur (104 px = padding
   du dock + pastille de 52 px + marge). Scopé hors « notfound », qui n'a pas de
   chrono flottant et n'a donc pas à gagner ce dégagement. */
.screen:not(.notfound) {
  padding-bottom: calc(104px + var(--sa-bottom));
}
.ses-recap { display: flex; gap: 11px; margin-bottom: var(--sp-4); }
.rtile { flex: 1; background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: 12px 14px; box-shadow: var(--clay-sm); }
.rtile__k { display: block; font-size: 11px; font-weight: 600; color: var(--ink-55); text-transform: uppercase; letter-spacing: 0.4px; }
.rtile__v { display: block; font-family: var(--font-display); font-size: 22px; font-weight: 600; line-height: 1; margin-top: 5px; color: var(--ink); }
.rtile--sage { background: var(--sage-tile-bg); border-color: var(--sage-tile-line); }
.rtile--sage .rtile__k { color: var(--sage-deep); }
.rtile--sage .rtile__v { color: var(--sage); }
.ses-row { display: flex; align-items: center; justify-content: space-between; background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: var(--sp-3) var(--sp-4); box-shadow: var(--clay-sm); }
.ses-row__date { font-weight: 600; margin-right: var(--sp-3); }
.ses-row__meta { color: var(--ink-55); font-size: 13px; }
.ses-row__acts { display: flex; align-items: center; margin: calc(-1 * var(--sp-3)) calc(-1 * var(--sp-3)) calc(-1 * var(--sp-3)) 0; }
.ses-row__edit { display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; flex-shrink: 0; border: none; background: transparent; color: var(--ink-55); font-size: 14px; }
.ses-row__del { display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; flex-shrink: 0; border: none; background: transparent; color: var(--ink-55); font-size: 15px; }
/* Ligne cible de fusion : liseré sauge — discret, le badge dit le reste ; le vert-sauge
   est l'accent du TEMPS dans cet onglet (tuile « Temps total »), pas une couleur de plus. */
.ses-row--live { border-color: var(--sage-tile-line); }
/* Ligne virtuelle : pointillés — elle n'existe pas encore au journal, le trait l'avoue ;
   la première pause la change en ligne vraie (pleine). */
.ses-row--virtual { border-style: dashed; border-color: var(--sage-tile-line); }
/* Badge « session vivante » des lignes (cible comme virtuelle). EN MARCHE : AUCUN texte —
   le temps qui défile à côté EST le signal, un libellé n'ajouterait que du bruit ; reste
   un point pulsé (le mouvement continue de dire « ça vit » pendant que le chiffre avance).
   En PAUSE : le point se fige et porte « en pause » — la ligne ne bouge plus, il faut le
   dire. aria-label dans les deux cas (même motif que la tuile étoiles : role="img" + nom
   accessible, car un point seul ne dit rien au lecteur d'écran). margin-left:auto : le
   pousse à droite, contre les boutons de la ligne cible, seul occupant sur la virtuelle. */
.ses-live {
  margin-left: auto;
  margin-right: var(--sp-2);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 3px 10px;
  border-radius: var(--r-pill);
  background: var(--sage-tile-bg);
  border: 1px solid var(--sage-tile-line);
  color: var(--sage-deep);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2px;
}
.ses-live::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--sage);
  animation: ses-live-pulse 1.6s ease-in-out infinite;
}
.ses-live--paused::before { animation: none; }
@keyframes ses-live-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.pgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100px, 100%), 1fr)); gap: var(--sp-2); margin-top: var(--sp-3); }
.pthumb { position: relative; aspect-ratio: 1; border-radius: var(--r-md); overflow: hidden; border: 1px solid var(--line); box-shadow: var(--clay-sm); }
.pthumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pthumb__del { position: absolute; top: 4px; right: 4px; width: 28px; height: 28px; border: none; border-radius: 50%; background: rgba(58, 46, 40, 0.6); color: #fff; font-size: 12px; }
/* zone tactile élargie (hitSlop) sans agrandir le visuel */
.pthumb__del::after { content: ''; position: absolute; inset: -10px; }
.pthumb__cover { position: absolute; top: 4px; left: 4px; width: 28px; height: 28px; border: none; border-radius: 50%; background: rgba(58, 46, 40, 0.6); color: #fff; font-size: 14px; }
.pthumb__cover::after { content: ''; position: absolute; inset: -10px; }
.pthumb__badge { position: absolute; top: 4px; left: 4px; padding: 3px 8px; border-radius: var(--r-pill); background: var(--brand-grad); color: var(--on-accent); font-size: 10.5px; font-weight: 700; letter-spacing: 0.2px; }
.photos__empty { margin-top: var(--sp-4); }
.pthumb__open { display: block; width: 100%; height: 100%; padding: 0; border: none; background: none; }
.viewer { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.9); padding: max(var(--sp-4), var(--sa-top)) var(--sa-right) var(--sa-bottom) var(--sa-left); }
.viewer__img { max-width: 100%; max-height: 100%; object-fit: contain; }
.viewer__close { position: absolute; top: calc(var(--sp-3) + var(--sa-top)); right: calc(var(--sp-3) + var(--sa-right)); width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 50%; background: rgba(255, 255, 255, 0.16); color: #fff; font-size: 18px; }
.viewer__nav { position: absolute; top: 50%; transform: translateY(-50%); width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; border: none; border-radius: 50%; background: rgba(255, 255, 255, 0.16); color: #fff; font-size: 28px; line-height: 1; }
.viewer__nav--prev { left: calc(var(--sp-2) + var(--sa-left)); }
.viewer__nav--next { right: calc(var(--sp-2) + var(--sa-right)); }
.viewer__count { position: absolute; bottom: calc(var(--sp-4) + var(--sa-bottom)); left: 50%; transform: translateX(-50%); color: rgba(255, 255, 255, 0.85); font-size: 13px; font-variant-numeric: tabular-nums; }
.viewer-enter-active, .viewer-leave-active { transition: opacity var(--motion-base); }
.viewer-enter-from, .viewer-leave-to { opacity: 0; }
.notfound { text-align: center; }
/* Bandeau « le patron a disparu » : chaleureux, pas alarmiste — rien n'est perdu,
   il suffit de restaurer depuis la corbeille (cf. audit UX 16/07).
   --warm-bg/--warm-line n'existent pas dans tokens.css : repli sur --surface-lin + --line. */
.orphan { margin: 0 0 var(--sp-3); padding: var(--sp-3); border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-lin); color: var(--ink-70); font-size: 13.5px; line-height: 1.5; }
</style>

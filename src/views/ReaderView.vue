<script setup>
// Lecteur de patron. Deux contextes :
//  - biblio  (/pattern/:id/read)  : APERÇU EN LECTURE SEULE (pas de coches, progression, taille ni chrono)
//  - projet  (/project/:id/read)  : SUIVI INTERACTIF — choix de taille, progression (project.readerState),
//    compteurs, diagramme, et un chrono discret qui alimente les sessions.
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { usePatternsStore } from '@/stores/patterns'
import { useProjectsStore, workedNow } from '@/stores/projects'
import { useSnackbarStore } from '@/stores/snackbar'
import { useChartZoomStore } from '@/stores/chart-zoom'
import { useActiveSessionStore } from '@/stores/activeSession'
import { useCorrectionHandoff } from '@/stores/correction-handoff'
import { closeChronoSession } from '@/utils/close-chrono-session'
import { scrollBehavior } from '@/utils/scroll-behavior'
import { useSmartBack } from '@/composables/useSmartBack'
import { useSplitReader } from '@/composables/useSplitReader'
import { repeatTotal, scrollTargetId, retractCurtain, sizeLabelText, sectionTitleLabel } from '@/utils/reader'
import { sectionKind } from '@/utils/section-kinds'
import { resolveOpenSyncTarget } from '@/utils/resolve-open-sync-target'
import { syncPatronMdOnOpen } from '@/backup/sync-on-open'
import { openPdfExternally } from '@/utils/open-pdf'
import { SESSION_NO_SECTION } from '@/constants/session'
import ReaderLine from '@/components/ReaderLine.vue'
import StepImages from '@/components/StepImages.vue'
import ReaderChart from '@/components/ReaderChart.vue'
import ReaderSheet from '@/components/ReaderSheet.vue'
import ChartStage from '@/components/ChartStage.vue'
import AppIcon from '@/components/AppIcon.vue'
import SkeletonScreen from '@/components/SkeletonScreen.vue'
import BackToTop from '@/components/BackToTop.vue'
import ReaderFixOverlay from '@/components/ReaderFixOverlay.vue'
import ReaderToc from '@/components/ReaderToc.vue'
import ChronoPill from '@/components/ChronoPill.vue'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
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

const st = reactive({ size: null, done: {}, counters: {}, chartRows: {}, chartReps: {}, chartFrames: {}, chartCurtains: {} })

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
  // Cible d'ouverture (#9) : une section explicite dans l'URL (clic depuis l'onglet Sections
  // de la fiche projet, `?section=<id>`) PRIME sur la reprise auto au rang en cours — cette
  // dernière reste inchangée : elle ne s'active que si le suivi est déjà entamé (doneCount>0 ;
  // patron vierge : on reste en haut pour lire la présentation, cf. #6 ci-dessous).
  if (route.query.section) {
    nextTick(() => {
      // La cible de section peut ne plus exister : une correction (retour de l'écran
      // de correction) a pu renommer le titre visé par `?section=`, l'id DOM change
      // avec lui. Repli sur le rang en cours plutôt que de rester en haut du patron —
      // sans risque pour le chemin existant depuis l'onglet Sections, où l'élément est
      // toujours là.
      const el = document.getElementById(scrollTargetId(route.query, currentStepId.value))
      if (el) el.scrollIntoView({ behavior: 'auto', block: 'start' })
      else if (doneCount.value > 0) resume('auto')
    })
  } else if (doneCount.value > 0) {
    // Reprise : si le suivi est déjà entamé, centrer l'écran sur le rang en cours (#6).
    // (Ouverture d'un patron vierge : on reste en haut pour lire la présentation.)
    nextTick(() => resume('auto'))
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
  if (ctx === 'project' && showTimer.value) {
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
    if (fromCorrection && relay.chronoWasRunning) await active.play()
  }
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

function loadState() {
  let saved
  if (ctx === 'project') {
    saved = project.value?.readerState || {}
    if (saved.size == null && project.value?.activeSize) {
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
  st.size = typeof saved.size === 'number' ? saved.size : null
  st.done = saved.done || {}
  st.counters = saved.counters || {}
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
    chartRows: { ...st.chartRows },
    chartReps: { ...st.chartReps },
    chartFrames: { ...st.chartFrames },
    chartCurtains: { ...st.chartCurtains },
  }
  // `.catch` : une écriture qui échoue ne doit jamais empoisonner la file (sinon les persist
  // suivants seraient ignorés + rejet non géré).
  persistChain = persistChain.then(() => writeSnap(snap, worked)).catch(() => {})
  return persistChain
}

/* ── dérivés ── */
// Sections avec ids d'items générés (stables par version des données) : `${sec.id}#${i}`.
const sections = computed(() =>
  (reader.value?.sections || []).map((sec) => ({
    ...sec,
    steps: sec.steps.map((s, i) => ({ ...s, id: `${sec.id}#${i}` })),
  })),
)
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
  document.getElementById('rchart-' + sec.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
function isDone(step) {
  if (step.note || step.chart) return true
  if (step.repeat) {
    const tot = stepTotal(step)
    return tot === 0 ? true : (st.counters[step.id] || 0) >= tot
  }
  return !!st.done[step.id]
}
const isCountable = (step) => !step.note && !step.chart // rangs + compteurs
const isRow = (step) => !step.note && !step.chart && !step.repeat // rangs cochables (nav préc/suiv)

const countableSteps = computed(() => allSteps.value.filter(isCountable))
const doneCount = computed(() => countableSteps.value.filter(isDone).length)
const progressPct = computed(() => (countableSteps.value.length ? Math.round((doneCount.value / countableSteps.value.length) * 100) : 0))
const currentStepId = computed(() => allSteps.value.find((s) => isRow(s) && !st.done[s.id])?.id || null)

function sectionCountable(sec) {
  return sec.steps.filter(isCountable)
}
function sectionDoneCount(sec) {
  return sectionCountable(sec).filter(isDone).length
}
function sectionProgress(sec) {
  return `${sectionDoneCount(sec)}/${sectionCountable(sec).length}`
}
// Auto-complétion : une section est « faite » quand tous ses rangs sont cochés ET tous ses
// compteurs de répétition atteints.
function sectionDone(sec) {
  const cs = sectionCountable(sec)
  return cs.length > 0 && cs.every(isDone)
}

/* ── actions ── */
function selectSize(i) {
  st.size = st.size === i ? null : i
  persist()
}
function toggleDone(id) {
  st.done[id] = !st.done[id]
  if (!st.done[id]) delete st.done[id]
  // Décocher compte AUSSI comme du tricot : c'est une correction en cours de session, donc bien
  // la preuve qu'on travaille CE projet en ce moment.
  persist({ worked: true })
  // Après avoir coché, recentrer l'écran sur le prochain rang à travailler (#6).
  if (st.done[id]) nextTick(() => resume())
}
function counterVal(step) {
  return Math.min(st.counters[step.id] || 0, stepTotal(step))
}
function bumpCounter(step, delta) {
  const total = stepTotal(step)
  st.counters[step.id] = Math.max(0, Math.min(total, counterVal(step) + delta))
  persist({ worked: true })
}
function chartRow(secId) {
  return st.chartRows[secId] || 1
}
function setChartRow(secId, r) {
  st.chartRows[secId] = r
  const cur = st.chartCurtains[secId]
  if (cur) st.chartCurtains[secId] = retractCurtain(cur)
  // Avancer dans une grille est la façon de tricoter un patron suivi au diagramme : c'est
  // exactement l'équivalent d'un rang coché côté texte.
  persist({ worked: true })
}
function chartRep(secId) {
  return st.chartReps[secId] || 1
}
function setChartRep(secId, r) {
  st.chartReps[secId] = r
  persist({ worked: true })
}
function chartFrame(secId) {
  return st.chartFrames?.[secId] || null
}
function setChartFrame(secId, frame) {
  if (!st.chartFrames) st.chartFrames = {}
  if (frame) st.chartFrames[secId] = frame
  else delete st.chartFrames[secId]
  persist()
}
function chartCurtain(secId) {
  return st.chartCurtains?.[secId] || null
}
function setChartCurtain(secId, curtain) {
  if (!st.chartCurtains) st.chartCurtains = {}
  if (curtain) st.chartCurtains[secId] = curtain
  else delete st.chartCurtains[secId]
  // Le rideau matérialise le rang où l'on en est dans la grille : le bouger, c'est avancer.
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

/* ── panneaux ── */
const sheetOpen = ref(false)
const sheetTab = ref('')
function openHelp(tab) {
  if (!reader.value.reference) return
  sheetTab.value = tab || reader.value.reference.tabs[0].id
  sheetOpen.value = true
}

// Aide-mémoire : accès au PDF original du patron (même donnée que la fiche projet).
// Absent si le patron n'a pas de PDF (import IA sans PDF, patron manuel) → pas de tuile morte.
const originalPdf = computed(() => pattern.value?.pdf || '')

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
// ⚠️ Aucun appui sur un CONTRÔLE de la carte ne pose le voile : la case à
// cocher (.rcheck), les abréviations (.rl-abbr, ce sont des <button>), les
// boutons du compteur de répétition et toute la barre du diagramme continuent
// de faire ce qu'ils faisaient. Un seul prédicat plutôt qu'une liste de classes :
// une classe oubliée deviendrait un geste volé, alors qu'un contrôle non prévu
// se comporte ici correctement par défaut.
// `target` : un `step` (id `sec.id#i`) pour les 4 types de carte, un `sec`
// (id brut) pour un titre de section — les deux exposent un
// `.id`, `onCardTap` n'a besoin de rien d'autre.
function onCardTap(e, target) {
  if (readOnly) return
  if (e.target.closest('button, a, input, select, textarea')) return
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
    pop.open = false
    sheetOpen.value = false
  }
}
</script>

<template>
  <div v-if="ready" class="reader" :class="{ 'reader--split': splitMode }">
    <header class="rhdr" :class="{ 'rhdr--compact': scrolled }">
      <button class="rhdr__back" :aria-label="t('common.back')" @click="leave()"><AppIcon name="chevronLeft" :size="22" /></button>
      <div class="rhdr__titles">
        <span class="rhdr__eyebrow">{{ ctx === 'project' ? project.name : t('reader.preview') }}</span>
        <h1 class="rhdr__title">{{ pattern.name }}</h1>
      </div>
    </header>

    <div v-if="!readOnly" class="rhdr__prog">
      <div class="rhdr__track"><div class="rhdr__fill" :style="{ width: progressPct + '%' }"></div></div>
      <span class="rhdr__pct">{{ progressPct }} %</span>
    </div>

    <main class="screen">
      <!-- Placée en TÊTE du contenu, avant la carte de taille : plus bas dans le flux, elle
           atterrissait vers y≈300 et la barre d'action fixe (84px, z-index 40) la recouvrait
           en paysage tant qu'on n'avait pas fait défiler. C'est aussi l'ordre logique — à la
           réouverture d'un patron commencé, « revenir à mon étape » est la 1re chose voulue. -->
      <div v-if="!readOnly && currentStepId" class="chips">
        <button class="chip chip--resume" @click="resume"><AppIcon name="resume" :size="16" /> {{ t('reader.resume') }}</button>
      </div>

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

      <p v-if="readOnly" class="ro-note">{{ t('reader.readOnlyNote') }}</p>
      <!-- Corriger le patron : déplacé depuis la fiche patron
           vers l'aperçu Prévisualiser — uniquement en contexte bibliothèque
           (readOnly) et si le patron a des sections à corriger. Réutilise la clé
           i18n correction.entry (même libellé que l'ancien bouton fiche). -->
      <button
        v-if="readOnly && reader.sections?.length"
        class="btn btn--block ro-correct"
        @click="router.push({ name: 'pattern-correct', params: { id: route.params.id } })"
      >
        <AppIcon name="grid" :size="18" /> {{ t('correction.entry') }}
      </button>

      <!-- Aide-mémoire (tuiles) -->
      <section v-if="reader.reference" class="amblock">
        <div class="amblock__head">
          <h2>{{ t('reader.help') }}</h2>
          <span class="amblock__sub">{{ t('reader.helpSub') }}</span>
        </div>
        <div class="amgrid">
          <button
            v-for="tile in reader.reference.tiles"
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

        <template v-for="step in sec.steps" :key="step.id">
          <!-- NOTE : information, non cochable -->
          <div v-if="step.note" class="rnote" @click="onCardTap($event, step)">
            <ReaderLine :line="step" :size-index="st.size" :abbr-keys="abbrKeys" @abbr="onAbbr" />
            <StepImages v-if="step.imgs && step.imgs.length" :imgs="step.imgs" />
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

          <!-- RÉPÉTITION : texte verbatim + compteur (interactif en projet) -->
          <article v-else-if="step.repeat" :id="'rstep-' + step.id" class="rstep rstep--rep" :class="{ 'rstep--done': !readOnly && isDone(step), 'rstep--ro': readOnly }" @click="onCardTap($event, step)">
            <div class="rstep__body">
              <p class="rstep__p"><ReaderLine :line="step" :size-index="st.size" :abbr-keys="abbrKeys" @abbr="onAbbr" /></p>
              <!-- Cadence : rappel de période « tous les X rangs » (step.every). Placé HORS de .rcount,
                   gardé seulement par step.every, pour rester visible en aperçu lecture seule (où .rcount
                   est masqué) — cette info fait partie du patron, on ne la perd jamais. -->
              <p v-if="step.every" class="rstep__cadence">{{ t('reader.cadenceEvery', { every: step.every }) }}</p>
              <StepImages v-if="step.imgs && step.imgs.length" :imgs="step.imgs" />
              <div v-if="!readOnly && !(st.size != null && stepTotal(step) === 0)" class="rcount">
                <span class="rcount__lab">{{ t('reader.repeatCounter') }}<template v-if="st.size == null"> · {{ t('reader.pickSizeShort') }}</template></span>
                <!-- Libellés d'accessibilité : une ACTION, jamais le glyphe affiché (revue finale
                     du passage multilingue, 29/07). « moins » / « plus » annoncés tels quels par
                     TalkBack ne disent pas ce que fait le bouton, et n'étaient de surcroît pas
                     traduits — la règle « jamais de glyphe dans l'UI » vaut aussi pour un
                     aria-label (leçon déjà tirée sur la case « section faite », 18/07). -->
                <button class="rcount__btn" :disabled="counterVal(step) <= 0" :aria-label="t('reader.repeatMinus')" @click="bumpCounter(step, -1)"><AppIcon name="minus" :size="16" /></button>
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
            :class="{ 'rstep--done': !readOnly && st.done[step.id], 'rstep--cur': !readOnly && currentStepId === step.id, 'rstep--ro': readOnly }"
            @click="onCardTap($event, step)"
          >
            <button
              v-if="!readOnly"
              class="rcheck"
              role="checkbox"
              :aria-checked="!!st.done[step.id]"
              :aria-label="t('reader.markDone')"
              @click="toggleDone(step.id)"
            >
              <AppIcon name="check" :size="18" />
            </button>
            <div class="rstep__body">
              <p class="rstep__p"><ReaderLine :line="step" :size-index="st.size" :abbr-keys="abbrKeys" @abbr="onAbbr" /></p>
              <StepImages v-if="step.imgs && step.imgs.length" :imgs="step.imgs" />
            </div>
            <ReaderFixOverlay v-if="fixTarget === step.id" @fix="startFix(sec, step)" @close="fixTarget = null" />
          </article>
        </template>

      </section>

      <!-- Aide-mémoire rappelé en bas -->
      <section v-if="reader.reference" class="amblock">
        <div class="amblock__head"><h2>{{ t('reader.help') }}</h2><span class="amblock__sub">{{ t('reader.helpAlways') }}</span></div>
        <div class="amgrid">
          <button v-for="tile in reader.reference.tiles" :key="'b' + tile.tab" class="amtile" :class="{ 'amtile--feature': tile.feature }" @click="openHelp(tile.tab)">
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
      <button v-if="reader.reference" class="fab fab--ref" :aria-label="t('reader.help')" @click="openHelp()"><AppIcon name="book" :size="20" /></button>

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
      v-if="reader.reference"
      :reference="reader.reference"
      :size-labels="reader.sizeLabels"
      :size-index="st.size"
      v-model:open="sheetOpen"
      v-model:active-tab="sheetTab"
      @open-chart="
        () => {
          sheetOpen = false
          goToChart()
        }
      "
    />

    <!-- tooltip abréviation -->
    <div v-show="pop.open" id="reader-pop" class="rpop" :style="{ left: pop.x + 'px', top: pop.y + 'px' }" role="tooltip">
      {{ pop.text }}
      <a v-if="pop.link" class="rpop__link" href="#" @click.prevent="popTechnique">{{ t('reader.seeTechnique') }} <AppIcon name="chevronRight" :size="14" /></a>
    </div>
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
/* lecture seule (aperçu biblio) : pas de coche, texte pleine largeur */
.rstep--ro {
  padding-left: var(--sp-4);
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
.rstep--done .rcheck {
  background: var(--sage);
  border-color: var(--sage);
  box-shadow: var(--clay-sm);
}
.rstep--done .rcheck :deep(svg) {
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

<script setup>
import { ref, computed, reactive, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import AppHeader from '@/components/AppHeader.vue'
import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ProjectCard from '@/components/ProjectCard.vue'
import StitchProgress from '@/components/StitchProgress.vue'
import { useSettingsStore } from '@/stores/settings'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { fmtDuration } from '@/stores/activeSession'
import { useSectionsStore } from '@/stores/sections'
import { useYarnsStore } from '@/stores/yarns'
import { usePatternsStore } from '@/stores/patterns'
import { usePurchasesStore } from '@/stores/purchases'
import { readerProgress, patternToReader } from '@/utils/reader'
import { STATUS_ORDER } from '@/constants/status'
import { startOfWeek } from '@/utils/time-periods'
import { relativeDayLabel } from '@/utils/date-format'
import { formatMoney } from '@/utils/units'
import { totalsByCurrency } from '@/utils/purchases'
import { patternExpenseLines } from '@/utils/pattern-price'
import { NOTICE } from '@/constants/notice-queue'
import { useNoticeSlot } from '@/composables/useNoticeSlot'

const router = useRouter()
const { t, locale } = useI18n()
const settings = useSettingsStore()
const projectsStore = useProjectsStore()
const sessionsStore = useSessionsStore()
const sectionsStore = useSectionsStore()
const yarnsStore = useYarnsStore()
const patternsStore = usePatternsStore()
const purchasesStore = usePurchasesStore()

// L'accueil a-t-il FINI de lire la base ? (photographié les 16 et 17/08 sur la
// Nexus 7 : pendant 8 secondes, l'écran affirmait « Aucun projet pour l'instant » sur un
// appareil qui en contenait 8, et invitait à repartir de zéro.) `groups.length === 0` ne
// distingue PAS « la base n'a pas encore répondu » de « la base a répondu, et elle est vide » :
// il faut ce drapeau, pas un délai. Posé une seule fois, à la toute fin de `onMounted`, pour
// que les chiffres et la liste apparaissent ENSEMBLE plutôt qu'à la file.
const homeReady = ref(false)
const weekSec = ref(0)
const monthSec = ref(0)
// Tuile « Dernières sessions » (T5, 31/08) : jusqu'à 2 sessions, nom du projet en ligne
// principale, « {jour} · {durée} » en ligne secondaire. Vide = tuile masquée —
// la liste n'existe qu'une fois la base répondue, donc la
// tuile ne peut JAMAIS mentir avec un contenu provisoire : elle apparaît d'un bloc.
const recentRows = ref([])
const progressMap = ref({}) // projectId -> { done, total }
const heroSection = ref(null) // section active du projet « à reprendre »

// Pop-up de bienvenue (10/08/2026). Elle a pris la place de l'astuce « Le sais-tu ? »,
// partie dans FirstDetailTip.vue : expliquer comment REVENIR à quelqu'un qui vient d'arriver
// et n'a encore rien ouvert n'aidait personne.
//
// ⚠️ `clearWelcomeDue()` est ATTENDUE avant de considérer l'affaire close — le piège payé
// une fois sur `swipeHintSeen` : l'écriture Dexie partait en tâche de fond pendant que la
// pop-up se fermait, et si l'app repartait de zéro juste après (rechargement complet de
// page, fermeture) avant que l'écriture ne soit committée, la pop-up réapparaissait au
// démarrage suivant — reproduit deux fois sur trois par le générateur de captures, qui
// enchaîne des `page.goto()`. L'`await` ne retarde rien pour l'utilisatrice : la fermeture
// (`showWelcome.value = false`) reste synchrone, juste au-dessus.
const showWelcome = ref(false)
// Contenu de la pop-up (06/09/2026) : la même fenêtre sert les DEUX issues de
// la porte du dossier — la bienvenue du semis (`onboarding.*`) quand la base ne
// contient que les exemples, « tes données sont de retour » (`restore.*`) quand une
// restauration vient de les écraser. `restoredDue` l'emporte : il ne passe à vrai que
// par `runRestore`, qui vient précisément d'effacer `welcomeDue` en base (cf.
// restore-service.js) — le message du semis décrirait alors des exemples qui
// n'existent plus, c'est donc lui qui ne doit JAMAIS fuiter sur l'autre.
const welcomeTexts = computed(() =>
  settings.restoredDue
    ? { title: t('restore.welcomeTitle'), message: t('restore.welcomeBody'), confirm: t('restore.welcomeStart') }
    : { title: t('onboarding.welcomeTitle'), message: t('onboarding.welcomeBody'), confirm: t('onboarding.welcomeStart') },
)
// File des messages (19/08/2026). `showWelcome` reste la condition PROPRE de la bienvenue :
// les DEUX points d'entrée depuis le 10/08 (le `onMounted` et le `watch` sur `welcomeDue`)
// restent nécessaires et inchangés — cf. leur commentaire ci-dessous, qui explique pourquoi
// aucun des deux ne suffit seul. La file ne remplace pas cette logique, elle décide
// seulement du moment de l'affichage face à la porte du dossier.
const welcomeHasSlot = useNoticeSlot(NOTICE.WELCOME, showWelcome)
async function dismissWelcome() {
  showWelcome.value = false
  // Les DEUX drapeaux, pas seulement celui qui a armé l'affichage : la fenêtre est
  // commune aux deux issues de la porte (cf. `welcomeTexts` au-dessus) et rien
  // n'interdit les deux clés en base — un drapeau orphelin laissé à `true`
  // réafficherait la pop-up au démarrage suivant. Écritures ATTENDUES avant de
  // considérer l'affaire close (le piège `swipeHintSeen` commenté au-dessus) ; la
  // fermeture, elle, reste synchrone, juste au-dessus.
  //
  // ⚠️ Les DEUX écritures sont LANCÉES avant d'en attendre une seule : chaque action
  // du store écrit son ref DE FAÇON SYNCHRONE avant son `await` Dexie — attendre la
  // première avant de lancer la seconde laisserait le `watch` (au-dessus) voir l'état
  // intermédiaire [welcomeDue:false, restoredDue:true] et RÉARMER `showWelcome` :
  // la pop-up resterait ouverte après son propre acquittement. Enchaînées sans
  // attendre, les deux bascules tombent dans le même cycle de réactivité et le
  // `watch` ne voit que [false, false].
  await Promise.all([settings.clearWelcomeDue(), settings.clearRestoredDue()])
}

// CORRECTIF (ordre des pop-ups, 10/08/2026) : `HomeView` est monté DERRIÈRE la
// porte du dossier (OnboardingFolderPrompt.vue, frère de `<RouterView/>` dans App.vue) —
// même piège que celui déjà corrigé là-bas (cf. son commentaire, 09/08). Au tout premier
// lancement, `HomeView` est déjà monté quand la porte est encore à l'écran : son
// `onMounted` lit `welcomeDue` à `false` (la porte n'a pas encore posé le drapeau), et
// aucune navigation n'a lieu quand la porte se referme — `HomeView` n'est donc JAMAIS
// remonté. Un `onMounted` seul ne verrait donc JAMAIS la bienvenue au premier lancement.
// Les deux points d'entrée sont nécessaires, jamais l'un à la place de l'autre :
// `onMounted` (ci-dessous) pour les cas où le drapeau est déjà posé à l'arrivée (rechargement
// complet, navigation SPA vers l'accueil) ; ce `watch` pour le cas où il passe à vrai EN
// COURS DE SESSION, pendant que `HomeView` est déjà monté derrière la porte.
// Depuis le 06/09/2026, le `watch` couvre AUSSI `restoredDue` — c'est même SON cas
// réel du premier lancement : `runRestore` (déclenchée par la porte pendant que ce
// composant est monté) écrit la clé en base, puis `reloadStores()` →
// `settingsStore.load()` fait basculer le store, sans aucune navigation.
watch(
  () => [settings.welcomeDue, settings.restoredDue],
  ([welcome, restored]) => {
    if (welcome || restored) showWelcome.value = true
  },
)

// Budget laine CUMULÉ (les travaux sur le budget) : lu depuis le registre d'achats, pas depuis
// l'état courant du stock. `Σ quantité × prix` sur les fiches (l'ancien calcul, encore
// utilisé par StashView pour SA valeur de stock à elle) BAISSE quand une laine est
// consommée et EFFACE la dépense quand une fiche est supprimée — aucun libellé ne pouvait
// rendre ce calcul honnête. Ici, une laine tombée à 0 en stock, ou supprimée définitivement
// (ligne orpheline, `yarnId: null`), compte toujours dans ce total : c'est tout l'enjeu de
// ce chantier.
// Depuis le 07/08, les patrons payants sont une dépense au même titre que la laine.
// Cette tuile n'est plus le seul chemin vers l'écran Dépenses (le menu ☰ y mène aussi,
// depuis le 12/08), mais elle en reste le raccourci le plus direct : elle doit
// donc compter exactement ce que compte l'écran, sous peine de le contredire à un appui
// de doigt.
const purchaseLines = computed(() => [
  ...(purchasesStore.purchases || []),
  ...patternExpenseLines(patternsStore.patterns || []),
])
// Condition d'affichage : l'EXISTENCE d'au moins une ligne, jamais « total > 0 ».
// Cette tuile est un RACCOURCI vers l'écran Dépenses, plus son seul chemin : depuis le
// 12/08, le menu ☰ y mène en permanence (AppHeader.vue). C'est ce qui permet de
// garder ici la condition `hasPurchases` — une tuile « budget dépensé : 0 € » n'apprend
// rien, alors que l'écran, lui, doit rester joignable même sur une app neuve. Un
// historique de cadeaux, de lignes reconstruites sans prix, ou d'achats chiffrés
// supprimés ne laissant que des cadeaux, rend un total à 0 alors que des lignes
// existent bel et bien. Un patron déclaré GRATUIT (prix `'0'`, depuis le 07/08) relève
// exactement du même cas : `isPricedPattern` le compte comme une ligne (cf. pattern-price.js),
// qui ne pèse rien dans le total. La refermer sur `total > 0` rendrait ces lignes-là
// inatteignables pour toujours (cas 4). `Object.keys(totals).length` serait le
// même défaut sous un autre nom : `totalsByCurrency` omet toute devise dont le montant vaut
// 0 (cf. son commentaire), donc un historique tout en cadeaux y rendrait `{}` lui aussi.
const hasPurchases = computed(() => purchaseLines.value.length > 0)
// { devise: montant } — jamais un nombre unique (cf. utils/purchases.js) : l'app ne connaît
// aucun taux de change et n'additionne donc jamais deux devises entre elles.
const budgetTotals = computed(() => totalsByCurrency(purchaseLines.value))
// La devise des réglages est TOUJOURS en tête (0 affiché si aucune ligne n'y est libellée) ;
// les autres devises rencontrées dans l'historique suivent, à part, jamais fondues dans le
// même chiffre (cas 5).
const otherCurrencies = computed(() => Object.keys(budgetTotals.value).filter((c) => c !== settings.currency))
// Profil 'detail' (jamais de bascule d'unité) : le montant complet, symbole de devise inclus
// dans `text`, tient sur cette tuile large. Le cumul est ARRONDI
// avant d'être passé à `formatMoney` (décision produit, revue du 26/07) : `formatMoney` elle-même
// n'arrondit jamais en profil 'detail' (règle générale, cf. son commentaire) — c'est à
// l'appelant de décider si SON cumul doit être rond. Ce chiffre n'a plus rien à voir avec
// celui de StashView (valeur du stock AU JOUR DIT, jamais rétroactive) : les deux cohabitent
// sciemment, chacun sur son écran — ce n'est plus la même donnée à arrondir
// pareil « pour rester cohérent », c'est deux questions différentes qui se répondent chacune
// avec sa propre règle d'arrondi.
function moneyFor(currency) {
  return formatMoney(Math.round(budgetTotals.value[currency] || 0), { locale: locale.value, currency, profile: 'detail' })
}
const spentStat = computed(() => moneyFor(settings.currency))

function goToExpenses() {
  router.push({ name: 'expenses' })
}

onMounted(async () => {
  try {
    // Le garde de route (router/index.js) charge déjà settings AVANT d'entrer sur l'accueil en
    // usage réel ; ce filet couvre le montage direct du composant (tests, ou tout futur point
    // d'entrée qui court-circuiterait le garde).
    if (!settings.loaded) await settings.load()
    // Les DEUX drapeaux armant la même pop-up (semis ou restauration, cf.
    // `welcomeTexts`), la condition propre du 10/08 s'élargit d'autant.
    showWelcome.value = settings.welcomeDue || settings.restoredDue
    if (!projectsStore.loaded) await projectsStore.load()
    if (!yarnsStore.loaded) yarnsStore.load()
    // Déjà chargé au démarrage de l'app en usage réel (App.vue, comme ExpensesView.vue) ;
    // ce filet couvre le montage direct du composant, même motif que `yarnsStore` ci-dessus.
    if (!purchasesStore.loaded) purchasesStore.load()
    // Même filet, pour la même raison : la tuile budget (ci-dessous) lit désormais aussi
    // patternsStore.patterns (depuis le 07/08).
    if (!patternsStore.loaded) patternsStore.load()
    progressMap.value = await sectionsStore.progressByProject()
    // Repli « reader » (#7) : les patrons structurés suivent la progression via
    // project.readerState, pas via la table sections (rowsTotal) — sinon l'accueil
    // n'affiche aucun avancement pour eux. On complète la carte quand elle est vide.
    const map = { ...progressMap.value }
    for (const p of projectsStore.projects) {
      if (map[p.id] && map[p.id].total > 0) continue
      if (p.patternId == null) continue
      const pat = patternFor(p)
      const reader = pat ? patternToReader(pat) : null
      if (!reader) continue
      const prog = readerProgress(reader, p.readerState)
      if (prog.total > 0) map[p.id] = { done: prog.done, total: prog.total }
    }
    progressMap.value = map
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    // Évolution du 11/08 : le premier jour de la semaine (Réglages) gouverne aussi la remise à zéro du
    // total « cette semaine » — `settings` est déjà chargé au-dessus, `weekStart` (1 = lundi par
    // défaut) suit la même convention `Date.getDay()` que `startOfWeek`.
    weekSec.value = await sessionsStore.secondsSince(startOfWeek(now, settings.weekStart))
    monthSec.value = await sessionsStore.secondsSince(monthStart)
    // `|| []` : en montage direct sous Pinia de test (actions stubbées → undefined), la
    // déstructuration ne doit pas lever — même filet d'esprit que les autres lectures.
    recentRows.value = (await sessionsStore.recentSessions(2)) || []
  } finally {
    // Dans un `finally` VOLONTAIREMENT : si une lecture ci-dessus lève (base illisible, patron
    // corrompu), le drapeau doit passer quand même. Un squelette qui tourne sans fin serait un
    // second mensonge, pire que le premier — mieux vaut un écran honnêtement vide.
    homeReady.value = true
  }
})

function hoursLabel(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return m ? `${h} h ${m}` : `${h} h`
}

// Tuile « Dernières sessions » (T4, 31/08 soir) : ligne secondaire « {jour} · {durée} »
// (ex. « Hier · 1:30:00 »). Le jour vient de `relativeDayLabel` (temps local, locale de
// l'app via useI18n) ; la durée garde le format EXISTANT `fmtDuration` — le même que
// l'écran Sessions, pour que les deux écrans ne se contredisent jamais. Nom du projet
// (ligne principale) ET durée restent affichés : rien n'est perdu, le jour s'ajoute.
function sessionSubLabel(row) {
  const jour = relativeDayLabel(row.date, new Date(), locale.value)
  const duree = fmtDuration(row.durationSec || 0)
  return [jour, duree].filter(Boolean).join(' · ')
}

const hello = computed(() =>
  settings.firstName ? t('home.hello', { name: settings.firstName }) : t('home.helloNeutral'),
)

const wipCount = computed(() => projectsStore.projects.filter((p) => p.status === 'wip').length)

// Classement de la tuile « Reprendre », en DEUX étages (décision produit, 25/07) :
//   1. `lastWorkedAt` — la dernière session de TRICOT, armée par les seuls gestes de progression
//      (rang ou section coché, grille avancée, compteur bougé). C'est le critère qui décide.
//   2. à défaut — projets jamais tricotés depuis cette version, ou sessions simultanées — l'ancien
//      critère : dernière écriture (`updatedAt`), puis création (`createdAt`).
// Un projet simplement renommé aujourd'hui ne peut donc PAS voler la tuile à celui qu'on tricote
// depuis hier. Format ISO 8601 : la comparaison lexicographique vaut comparaison chronologique.
function activityRank(p) {
  return [p?.lastWorkedAt || '', p?.updatedAt || p?.createdAt || '']
}
function worksMoreRecently(a, b) {
  const [ra, rb] = [activityRank(a), activityRank(b)]
  return ra[0] !== rb[0] ? ra[0] > rb[0] : ra[1] > rb[1]
}

// Le projet en cours le plus RÉCEMMENT TRICOTÉ. Avant, un simple `find()` sur une liste triée par
// id décroissant renvoyait structurellement le dernier projet CRÉÉ. Comparaison STRICTE : à
// égalité parfaite (aucun horodatage nulle part), on garde le premier de la liste, c'est-à-dire
// l'id le plus grand — exactement l'ancien comportement.
const lastProject = computed(() => {
  const wip = projectsStore.projects.filter((p) => p.status === 'wip')
  if (!wip.length) return null
  return wip.reduce((best, p) => (worksMoreRecently(p, best) ? p : best))
})

// La section « en cours » affichée dans la tuile suit le projet retenu — y compris quand celui-ci
// change APRÈS le montage (toute écriture projet recharge le store et peut faire basculer
// `lastProject`) : sans ce watch, on afficherait le titre d'un projet avec la section d'un autre.
watch(
  () => lastProject.value?.activeSectionId ?? null,
  async (id) => {
    heroSection.value = id == null ? null : await sectionsStore.get(id)
  },
  { immediate: true },
)

// Héros « Reprendre » : progression de la section active (ou du projet à défaut).
const heroProgress = computed(() => {
  if (heroSection.value && heroSection.value.rowsTotal > 0) {
    return { done: heroSection.value.rowsDone || 0, total: heroSection.value.rowsTotal }
  }
  return (lastProject.value && progressMap.value[lastProject.value.id]) || { done: 0, total: 0 }
})
const heroPct = computed(() =>
  heroProgress.value.total > 0 ? Math.round((100 * heroProgress.value.done) / heroProgress.value.total) : 0,
)
// MÊME prédicat que les cartes (ProjectCard.vue : `known && pct > 0`, règle du 31/08/2026,
// retour utilisateur sur le héros : « 0 % » + une rangée de mailles vides sur un projet
// pas encore commencé) : la progression ne se rend que si elle DIT quelque chose — connue
// (total > 0) ET avancée (pct > 0 APRÈS arrondi, pas `done > 0` : 1/1000 arrondit à 0 %
// et le visuel ne rendrait aucune maille pleine). À 0 % : rien à la place — ni mailles
// vides, ni « 0 % », ni mention inventée ; la tuile garde nom, ligne « où » (le
// « rang 0 / 40 » est une localisation, pas un avancement) et CTA. `heroPct` vaut déjà 0
// quand total vaut 0, le prédicat est écrit en entier pour refléter la règle des cartes.
const heroShowProgress = computed(() => heroProgress.value.total > 0 && heroPct.value > 0)
const heroWhere = computed(() => {
  const lp = lastProject.value
  if (!lp) return ''
  const parts = []
  if (heroSection.value) {
    parts.push(heroSection.value.name)
    if (heroSection.value.rowsTotal > 0) {
      parts.push(t('home.resumeRow', { done: heroSection.value.rowsDone || 0, total: heroSection.value.rowsTotal }))
    }
  }
  if (lp.activeSize) parts.push(t('project.activeSize').toLowerCase() + ' ' + lp.activeSize)
  return parts.join(' · ')
})

function resume() {
  const lp = lastProject.value
  if (!lp) return
  router.push({ name: 'project', params: { id: lp.id } })
}

const groups = computed(() =>
  STATUS_ORDER.map((status) => ({
    status,
    items: projectsStore.projects.filter((p) => p.status === status),
  })).filter((g) => g.items.length > 0),
)

const expanded = reactive({})
function visibleItems(group) {
  return expanded[group.status] ? group.items : group.items.slice(0, 3)
}

// Patron lié à un projet (repli de couverture pour ProjectCard) : store déjà chargé au
// démarrage de l'app (cf. App.vue), lookup en mémoire donc peu coûteux par carte.
function patternFor(project) {
  return patternsStore.patterns.find((x) => x.id === project.patternId) || null
}

function open(id) {
  router.push({ name: 'project', params: { id } })
}
function createProject() {
  router.push({ name: 'project-new' })
}
</script>

<template>
<div>
  <AppHeader :title="t('nav.home')" />
  <main class="screen">
    <h2 class="greet">{{ hello }}</h2>
    <p v-if="wipCount" class="subtle">{{ t('home.wipSummary', { n: wipCount }, wipCount) }}</p>

    <!-- HÉROS « Reprendre » : le projet en cours, le geste de reprendre -->
    <section v-if="lastProject" class="resume" @click="resume">
      <span class="resume__tag">{{ t('home.resume') }}</span>
      <h3 class="resume__title">{{ lastProject.name }}</h3>
      <p v-if="heroWhere" class="resume__where">{{ heroWhere }}</p>
      <StitchProgress
        v-if="heroShowProgress"
        class="resume__stitch"
        :technique="lastProject.technique"
        :done="heroProgress.done"
        :total="heroProgress.total"
      />
      <div class="resume__row">
        <span v-if="heroShowProgress" class="resume__pct">{{ heroPct }} %</span>
        <button class="cta" @click.stop="resume">
          {{ t('home.resume') }}
          <AppIcon name="chevronRight" :size="16" />
        </button>
      </div>
    </section>

    <!-- Stats en tuiles (bento) -->
    <div class="bento">
      <div class="tile tile--accent">
        <span class="tile__k">{{ t('home.inProgress') }}</span>
        <!-- « — » tant que la base n'a pas répondu : un « 0 » affiché avant toute mesure est un
             chiffre faux, pas une valeur par défaut. Le tiret cadratin est dessiné
             par les polices embarquées — vérifié, il n'est pas des six caractères retirés le 21/08. -->
        <span class="tile__v">{{ homeReady ? wipCount : '—' }}</span>
      </div>
      <button type="button" class="tile tile--sage tile--link" @click="router.push({ name: 'stats' })">
        <span class="tile__k">{{ t('home.thisWeek') }}</span>
        <span class="tile__v">{{ homeReady ? hoursLabel(weekSec) : '—' }}</span>
        <AppIcon class="tile__chevron" name="chevronRight" :size="16" aria-hidden="true" />
        <!-- Nom accessible = contenu visible (« cette semaine » + durée) + l'action ; PAS d'aria-label,
             qui écraserait la valeur lue par les lecteurs d'écran (perte de la durée, cf. WCAG 2.5.3). -->
        <span class="sr-only">{{ t('home.statsLink') }}</span>
      </button>
      <!-- Dernières sessions (T5) : tuile large entre « cette semaine » et « budget ».
           Chaque session tient sur DEUX lignes (T4, 31/08) : le nom du projet en ligne
           principale, « {jour} · {durée} » en ligne secondaire (relativeDayLabel, temps
           local + locale de l'app). Masquée s'il n'y a aucune session (v-if ci-dessous) —
           pas de « — » possible ici, la liste est vide ou pleine, jamais en cours de
           mesure. Même règle d'accessibilité que les deux tuiles-liens voisines : pas
           d'aria-label, le contenu visible porte le nom. -->
      <button
        v-if="recentRows.length"
        type="button"
        class="tile tile--wide tile--link"
        data-test="home-sessions"
        @click="router.push({ name: 'sessions' })"
      >
        <span class="tile__k">{{ t('home.recentSessions') }}</span>
        <span v-for="row in recentRows" :key="row.id" class="tile__row">
          <span class="tile__row-name">{{ row.projectName || t('sessions.unknownProject') }}</span>
          <span class="tile__row-sub">{{ sessionSubLabel(row) }}</span>
        </span>
        <AppIcon class="tile__chevron" name="chevronRight" :size="16" aria-hidden="true" />
        <span class="sr-only">{{ t('home.sessionsLink') }}</span>
      </button>
      <button v-if="hasPurchases" type="button" class="tile tile--wide tile--link" data-test="home-spent" @click="goToExpenses">
        <span class="tile__k">{{ t('home.budgetSpent') }}</span>
        <span class="tile__v">{{ homeReady ? spentStat.text : '—' }}</span>
        <span v-if="otherCurrencies.length" class="tile__extra">
          <span v-for="cur in otherCurrencies" :key="cur" class="tile__extra-item">{{ moneyFor(cur).text }}</span>
        </span>
        <AppIcon class="tile__chevron" name="chevronRight" :size="16" aria-hidden="true" />
        <!-- Nom accessible = contenu visible (libellé + montant(s)) + l'action ; PAS d'aria-label,
             qui écraserait le(s) montant(s) lu(s) par les lecteurs d'écran (même règle que la
             tuile « cette semaine » ci-dessus, cf. WCAG 2.5.3). -->
        <span class="sr-only">{{ t('home.expensesLink') }}</span>
      </button>
    </div>

    <!-- Outils -->
    <h3 class="tools-label">{{ t('home.toolsLabel') }}</h3>
    <div class="tools">
      <button class="tool" @click="router.push({ name: 'counters' })">
        <span class="tool__icon"><AppIcon name="counter2" :size="18" /></span>
        {{ t('home.toolCounter') }}
      </button>
      <button class="tool" @click="router.push({ name: 'calculator' })">
        <span class="tool__icon"><AppIcon name="calculator" :size="18" /></span>
        {{ t('home.toolCalc') }}
      </button>
      <button class="tool" @click="router.push({ name: 'needle-gauge' })">
        <span class="tool__icon"><AppIcon name="needleGauge" :size="18" /></span>
        {{ t('home.toolNeedle') }}
      </button>
    </div>
    <button class="btn btn--primary btn--block create" @click="createProject"><AppIcon name="plus" :size="17" /> {{ t('home.createProject') }}</button>

    <!-- La base répond encore : on annonce le chargement, on n'affirme RIEN sur son contenu.
         Même convention que SkeletonScreen.vue (aria-busy + une annonce role="status" qui porte
         le libellé réel) ; le bloc est écrit ici plutôt qu'importé parce que SkeletonScreen
         porte la classe `screen`, déjà posée par le <main> de cet écran. -->
    <div v-if="!homeReady" class="card empty skelcard" aria-busy="true" data-test="home-loading">
      <span role="status">{{ t('reader.loading') }}</span>
    </div>

    <!-- Aucun projet — l'invitation à repartir de zéro n'est LÉGITIME qu'une fois la base lue -->
    <div v-else-if="!groups.length" class="card empty">
      <p>{{ t('home.noProjects') }}</p>
    </div>

    <!-- Groupes par statut -->
    <section v-for="g in groups" :key="g.status" class="group">
      <header class="group__head">
        <h3 class="group__title">{{ t(`status.${g.status}`) }} ({{ g.items.length }})</h3>
        <button v-if="g.items.length > 3" class="link" @click="expanded[g.status] = !expanded[g.status]">
          {{ expanded[g.status] ? t('home.collapse') : t('home.seeAll') }}
        </button>
      </header>
      <div class="group__list">
        <ProjectCard v-for="p in visibleItems(g)" :key="p.id" :project="p" :progress="progressMap[p.id]" :pattern="patternFor(p)" @open="open" />
      </div>
    </section>

    <!-- Bienvenue / « tes données sont de retour » : au premier passage sur l'accueil,
         une seule fois, avec un contenu qui dépend de l'issue de la porte du dossier
         (`welcomeTexts` dans le script). L'astuce de navigation, elle, vit maintenant
         dans FirstDetailTip.vue — elle se montre à la première visite d'un projet, de la
         Bibliothèque ou du Stock (décision produit du 19/08/2026), jamais de
         l'accueil. -->
    <ConfirmDialog
      :open="welcomeHasSlot"
      centered
      :title="welcomeTexts.title"
      :message="welcomeTexts.message"
      :confirm-label="welcomeTexts.confirm"
      @confirm="dismissWelcome"
    />
  </main>
</div>
</template>

<style scoped>
.greet { font-family: var(--font-display); font-size: 25px; line-height: 1.15; margin: 0 0 2px; }
.subtle { color: var(--ink-55); font-size: 13.5px; margin: 0 0 var(--sp-4); }

.resume {
  position: relative;
  overflow: hidden;
  background: linear-gradient(165deg, #f4ddc6, #efd2b8);
  border: 1px solid #ecc9ab;
  border-radius: var(--r-lg);
  padding: var(--sp-4);
  box-shadow: var(--clay);
  cursor: pointer;
}
/* Crème claire illisible en sombre : bascule vers le duo lin/surface (même esprit
   que .srow--wip), sans toucher au clair (littéraux d'origine conservés). */
:root[data-theme='dark'] .resume,
html[data-theme='dark'] .resume {
  background: linear-gradient(165deg, var(--surface-lin), var(--surface));
  border-color: var(--brand-deep);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .resume {
    background: linear-gradient(165deg, var(--surface-lin), var(--surface));
    border-color: var(--brand-deep);
  }
}
/* halo chaud discret en haut-droite */
.resume::after {
  content: '';
  position: absolute;
  right: -30px;
  top: -30px;
  width: 150px;
  height: 150px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(var(--brand-rgb), 0.2), transparent 70%);
  pointer-events: none;
}
.resume > * { position: relative; }
.resume__tag { font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: var(--brand-deep); }
.resume__title { font-family: var(--font-display); font-weight: 600; font-size: 22px; line-height: 1.15; margin: 4px 0 2px; }
.resume__where { color: var(--ink-70); font-size: 13.5px; margin: 0 0 var(--sp-3); }
.resume__stitch { margin: var(--sp-2) 0; }
.resume__row { display: flex; align-items: center; gap: var(--sp-3); margin-top: var(--sp-2); }
.resume__pct { font-family: var(--font-display); font-weight: 600; font-size: 15px; color: var(--brand-deep); }
.cta {
  margin-left: auto; display: inline-flex; align-items: center; gap: 7px;
  background: var(--brand-grad); color: var(--on-accent); border: none;
  font-weight: 700; font-size: 14.5px; padding: 12px 18px; border-radius: var(--r-pill);
  box-shadow: 0 8px 16px -6px rgba(var(--brand-rgb), 0.6), 0 1px 1px rgba(255, 255, 255, 0.3) inset;
}
.cta:active { transform: scale(0.98); box-shadow: var(--clay-press); }

/* grille bento des stats */
/* auto-fit + min(…, 100%) : le nombre de colonnes se règle seul selon la largeur, sans
   règle @media — donc correct aussi sur les tailles de tablette qu'on n'a pas testées.
   Le min() est obligatoire : sans lui, une piste de 150px déborderait sur un écran plus
   étroit que 150px de contenu disponible. */
.bento { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr)); gap: 11px; margin: var(--sp-4) 0; }
/* width/text-align : neutres pour les tuiles <div>, mais nécessaires pour que la tuile
   « cette semaine » (<button>, cf. plus bas) garde le même rendu que ses voisines. */
.tile { background: var(--tile); border: 1px solid var(--line); border-radius: var(--r-md); padding: 14px; box-shadow: var(--clay-sm); width: 100%; text-align: left; }
.tile__k { display: block; font-size: 11.5px; font-weight: 600; color: var(--ink-55); text-transform: uppercase; letter-spacing: 0.4px; }
.tile__v { display: block; font-family: var(--font-display); font-size: 26px; font-weight: 600; line-height: 1; margin-top: 6px; color: var(--ink); }
.tile--accent { background: linear-gradient(165deg, #f2ead9, #ece2cf); }
:root[data-theme='dark'] .tile--accent,
html[data-theme='dark'] .tile--accent {
  background: linear-gradient(165deg, var(--surface-lin), var(--surface));
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) .tile--accent {
    background: linear-gradient(165deg, var(--surface-lin), var(--surface));
  }
}
.tile--accent .tile__v { color: var(--brand-deep); }
/* touche de vert : métrique positive (temps tricoté) */
.tile--sage { background: var(--sage-tile-bg); border-color: var(--sage-tile-line); }
.tile--sage .tile__k { color: var(--sage-deep); }
.tile--sage .tile__v { color: var(--sage); }
.tile--sage:active { transform: scale(0.97); box-shadow: var(--clay-press); }
/* tuile-lien (cliquable) : relative pour ancrer le chevron d'affordance en haut-droite */
.tile--link { position: relative; }
.tile__chevron { position: absolute; top: 12px; right: 10px; color: var(--sage-deep); opacity: 0.55; }
.tile--wide { grid-column: 1 / -1; }
.tile--wide.tile--link:active { transform: scale(0.98); box-shadow: var(--clay-press); }
/* .tile__chevron est vert par défaut (couleur pensée pour la tuile sage) : neutre ici,
   cette tuile n'a pas de teinte propre. */
.tile--wide .tile__chevron { color: var(--ink-55); }
/* lignes « dernières sessions » (T4, 31/08) : le nom du projet en ligne principale
   (tronqué s'il est long), « jour · durée » en ligne secondaire — discrète, chiffres
   tabulaires pour que deux durées empilées s'alignent. */
.tile__row { display: block; margin-top: 6px; }
.tile__row-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 14.5px; color: var(--ink); }
.tile__row-sub { display: block; margin-top: 1px; font-size: 13px; color: var(--ink-55); font-variant-numeric: tabular-nums; }
/* devise(s) autre(s) que celle des réglages (cas 5) : jamais fondues dans
   .tile__v, toujours listées à part, jamais additionnées entre elles ni à la devise en tête. */
.tile__extra { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: 4px; }
.tile__extra-item { font-size: 12.5px; font-weight: 600; color: var(--ink-55); }
/* Visuellement masqué mais lu par les lecteurs d'écran (motif standard, cf. .file-pick__input). */
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }

/* Le bloc de chargement reprend l'allure de `.empty` ; la pulsation est celle de
   SkeletonScreen.vue, et `tokens.css` la neutralise déjà sous prefers-reduced-motion. */
.skelcard { animation: skel-pulse 1.2s ease-in-out infinite; }
@keyframes skel-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
.tools-label { display: block; font-size: 11.5px; font-weight: 600; color: var(--ink-55); text-transform: uppercase; letter-spacing: 0.4px; margin: var(--sp-4) 0 var(--sp-2); }
.tools { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
.tool { flex: 1 1 45%; display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-2); background: var(--tile); border: 1px solid var(--line); color: var(--ink); font-weight: 600; font-size: 14px; padding: 13px; border-radius: var(--r-md); box-shadow: var(--clay-sm); }
.tool__icon { flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: var(--brand-grad); }
/* :deep() : AppIcon rend son SVG via v-html (hors portée scoped), même piège que
   ReaderView.vue::.rcheck — un sélecteur `svg` nu ne matcherait plus rien. */
.tool__icon :deep(svg) { width: 16px; height: 16px; color: var(--on-accent); }
.tool:active { transform: scale(0.97); box-shadow: var(--clay-press); }
.create { margin-top: var(--sp-3); margin-bottom: var(--sp-5); }

.empty { text-align: center; color: var(--ink-55); }
.group { margin-bottom: var(--sp-5); }
.group__head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: var(--sp-2); }
.group__title { font-family: var(--font-display); font-size: 17px; }
.link { border: none; background: transparent; color: var(--brand-deep); font-weight: 600; font-size: 13px; }
/* Grille plutôt que pile : sur tablette, deux projets tiennent côte à côte. Le seuil de
   320px garde une carte lisible et empêche une 3e colonne trop étroite à 840px. */
.group__list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr)); gap: var(--sp-3); }
</style>

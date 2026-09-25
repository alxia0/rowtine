import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import i18n from '@/i18n'
import { navStart, navDone } from '@/composables/useNavProgress'
import { useSettingsStore } from '@/stores/settings'
import { useActiveSessionStore } from '@/stores/activeSession'
import { closeChronoSession } from '@/utils/close-chrono-session'
import { useSnackbarStore } from '@/stores/snackbar'
import { handleStorageError } from '@/db/storage-guard'
import { applyTheme } from '@/theme/apply'
import { detectDeviceLocale } from '@/utils/app-locale'
import { checkVersionGuardOnStartup } from '@/db/version-guard'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  // Sans ceci, un écran quitté « scrollé » transmet son scrollY au suivant (vue-router ne
  // remet PAS en haut par défaut) : AppHeader étant sticky sans respiration au-dessus du
  // 1er contenu sur certains écrans (ex. NeedleGaugeView), ce scrollY hérité collait
  // aussitôt le bandeau par-dessus le contenu dès l'arrivée.
  // savedPosition (retour arrière navigateur) reste prioritaire : comportement natif attendu.
  //
  // EXCEPTION, 19/08/2026 : le guide ouvert sur une section (`/guide?section=<id>`) défile
  // LUI-MÊME jusqu'à elle (GuideView.onMounted → openSection → scrollIntoView). Le
  // `{ top: 0 }` ci-dessous ANNULAIT ce défilement, et le défaut était invisible en revue :
  // vue-router n'appelle `scrollBehavior` qu'APRÈS le montage du composant
  // (`nextTick().then(() => scrollBehavior(...)).then(scrollToPosition)` — node_modules/
  // vue-router/dist/vue-router.js), et `scrollToPosition` fait un `window.scrollTo` sec qui
  // écrase la position déjà demandée. Vu sur Nexus 7 (écran figé tout en haut, deux captures
  // identiques à 3 s d'intervalle), puis reproduit sous Playwright, journal des appels à
  // l'appui : `scrollIntoView(DETAILS[section-4])` PUIS `scrollTo({ top: 0 })`.
  // `return false` = « ne touche pas au défilement » ; c'est alors GuideView qui pose la
  // position d'arrivée, y compris quand l'identifiant ne désigne aucune section (il remet
  // alors lui-même en haut — sans quoi le scrollY hérité reviendrait par cette porte).
  // EXTENSION, 31/08/2026 : même mécanisme pour le lecteur de patron (`project-read` et
  // `pattern-read` portant `?section=<id>` non vide). Les liens du sommaire ne défilaient
  // pas : ReaderView.goToSection pousse
  // l'URL puis défile vers `#rsec-<id>`, et le montage défile lui aussi (nextTick, ~:190) —
  // mais le `{ top: 0 }` du routeur, exécuté après coup, écrasait ces défilements. Le
  // lecteur pose donc LUI-MÊME sa position : au montage via le nextTick existant (avec son
  // repli sur le rang en cours si la cible a disparu), au sommaire via le scroll effectué
  // après `router.push`. Même garde que pour le guide : une section devenue introuvable est
  // gérée PAR ReaderView, jamais par ici.
  // ⚠️ ORDRE DES CONDITIONS, PAS ANODIN : une position sauvegardée (retour arrière) passe
  // AVANT ces exceptions, `?section=` ou pas — revenir sur le guide ou le lecteur doit
  // rendre la page là où la lectrice l'avait laissée, pas la repositionner sur la section de
  // l'URL. Les intervertir ne changeait RIEN à aucun test jusqu'au 19/08 : un cas croisé les
  // pince désormais (tests/unit/router-scroll-behavior.spec.js).
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    if (
      (to.name === 'guide' || to.name === 'project-read' || to.name === 'pattern-read') &&
      typeof to.query.section === 'string' &&
      to.query.section
    )
      return false
    return { top: 0 }
  },
  routes: [
    { path: '/onboarding', name: 'onboarding', component: () => import('../views/OnboardingView.vue') },
    { path: '/', name: 'home', component: HomeView },
    { path: '/project/new', name: 'project-new', component: () => import('../views/ProjectEditView.vue') },
    { path: '/project/:id', name: 'project', component: () => import('../views/ProjectDetailView.vue') },
    { path: '/project/:id/edit', name: 'project-edit', component: () => import('../views/ProjectEditView.vue') },
    { path: '/project/:id/read', name: 'project-read', component: () => import('../views/ReaderView.vue') },
    { path: '/stash', name: 'stash', component: () => import('../views/StashView.vue') },
    { path: '/stash/:id', name: 'stash-item', component: () => import('../views/YarnDetailView.vue') },
    { path: '/stash/new', name: 'stash-new', component: () => import('../views/YarnEditView.vue') },
    { path: '/stash/:id/edit', name: 'stash-edit', component: () => import('../views/YarnEditView.vue') },
    { path: '/stash/import-ravelry', name: 'stash-import-ravelry', component: () => import('../views/RavelryImportView.vue') },
    { path: '/library', name: 'library', component: () => import('../views/LibraryView.vue') },
    // `?format=rowtine` : porte « Importer au format Rowtine » (23/09), passée en prop.
    { path: '/import-local', name: 'import-local', component: () => import('../views/LocalPdfImportView.vue'), props: (route) => ({ format: route.query.format === 'rowtine' ? 'rowtine' : 'pdf' }) },
    { path: '/pattern/new', name: 'pattern-new', component: () => import('../views/PatternCreateView.vue') },
    { path: '/pattern/:id', name: 'pattern', component: () => import('../views/PatternView.vue') },
    { path: '/pattern/:id/read', name: 'pattern-read', component: () => import('../views/ReaderView.vue') },
    { path: '/pattern/:id/correct', name: 'pattern-correct', component: () => import('../views/CorrectionView.vue') },
    { path: '/settings', name: 'settings', component: () => import('../views/SettingsView.vue') },
    { path: '/about', name: 'about', component: () => import('../views/AboutView.vue') },
    { path: '/about/privacy', name: 'about-privacy', component: () => import('../views/PrivacyPolicyView.vue') },
    { path: '/about/licenses', name: 'about-licenses', component: () => import('../views/ThirdPartyLicensesView.vue') },
    { path: '/guide', name: 'guide', component: () => import('../views/GuideView.vue') },
    { path: '/calculator', name: 'calculator', component: () => import('../views/CalculatorView.vue') },
    { path: '/needle-gauge', name: 'needle-gauge', component: () => import('../views/NeedleGaugeView.vue') },
    { path: '/counters', name: 'counters', component: () => import('../views/IndependentCounterView.vue') },
    { path: '/stats', name: 'stats', component: () => import('../views/StatsView.vue') },
    { path: '/expenses', name: 'expenses', component: () => import('../views/ExpensesView.vue') },
    { path: '/sessions', name: 'sessions', component: () => import('../views/SessionsView.vue') },
  ],
})

// ── Garde « sortie de bulle » du chrono (lot « chrono unifié », 2026-08-30) ──
// La session chrono ne se ferme plus à la sortie d'un ÉCRAN (le lecteur fermait : « aller
// voir le patron ferme la séance ») mais en SORTANT du projet. La décision se prend
// sur la ROUTE DE DESTINATION, ici dans le beforeEach — jamais sur l'ordre montage/démontage :
// la fermeture enchaîne deux écritures Dexie asynchrones (pause, stopAndClear), et lâchées
// pendant un démontage elles se coursent (défaut connu). Ici,
// vue-router ATTEND le garde : la session est close et journalisée AVANT que l'écran quitté
// ne se démonte, quoi qu'il arrive ensuite.
//
// La bulle du projet : `project`, `project-read`, `project-edit` portant le MÊME id que la
// session, plus `pattern-correct` — TOUJOURS, car cette route porte l'id du PATRON, pas du
// projet : on ne peut pas la rapprocher du chrono par comparaison d'id, et elle n'est
// atteignable que depuis la bulle d'un projet (lecteur, aperçu). Tout le reste sort.
function inChronoBubble(to, projectId) {
  if (to.name === 'pattern-correct') return true
  if (to.name === 'project' || to.name === 'project-read' || to.name === 'project-edit') {
    return Number(to.params.id) === projectId
  }
  return false
}

// Au 1er accès, on charge les réglages locaux (Dexie) puis on applique la langue.
// Tant que l'onboarding n'est pas fait, on y renvoie ; une fois fait, on n'y retourne pas.
router.beforeEach(async (to) => {
  navStart()
  const settings = useSettingsStore()
  // Témoin capturé AVANT le chargement : « navigation initiale de démarrage » = le passage
  // où les stores ne sont pas encore chargés (ce bloc ne court qu'une fois par session de
  // page). Le garde chrono ne doit PAS tirer sur ce passage-là — un chrono qui a survécu à
  // un arrêt forcé reprend (c'est tout l'objet de sa persistance) : atterrir sur home au
  // démarrage n'est pas « quitter le projet ». Seul résidu théorique : une REDIRECTION de
  // démarrage (deep-link /onboarding sur une app déjà onboardée) rejoue ce beforeEach une
  // seconde fois, settings alors chargés — le garde y tirerait s'il restait une session en
  // base ; elle serait ENREGISTRÉE, jamais perdue, et ce cas exige un URL direct impossible
  // à produire depuis l'app elle-même.
  const startup = !settings.loaded
  if (!settings.loaded) {
    // Garde-fou de démarrage (13/08/2026) : détecte
    // une base IndexedDB plus RÉCENTE que ce que le code déclare, AVANT que
    // settings.load() n'ouvre la base pour de bon — c'est ici, au tout premier passage
    // (ce bloc ne s'exécute qu'une fois par session), que la sonde doit s'installer.
    // N'ouvre rien, ne lève jamais, ne bloque jamais la navigation : cf. src/db/version-guard.js.
    await checkVersionGuardOnStartup()
    await settings.load()
    i18n.global.locale.value = settings.locale || detectDeviceLocale()
    // Fournisseur (et pas valeur) : tant qu'aucune teinte n'a été CHOISIE, le défaut est
    // dynamique selon le thème effectif (T2, 31/08) — le provider sera ré-évalué par
    // applyTheme à chaque changement de thème, y compris le basculement de l'OS en mode
    // Système.
    applyTheme(settings.theme, (effective) => settings.effectiveAccentHue(effective)) // réconcilie le pré-paint avec la source de vérité Dexie
    await useActiveSessionStore().load() // restaure le chrono persistant
  }
  if (!settings.onboarded && to.name !== 'onboarding') return { name: 'onboarding' }
  if (settings.onboarded && to.name === 'onboarding') return { name: 'home' }
  // Après les détours d'onboarding : le garde ne retourne JAMAIS de redirection, il ne peut
  // donc pas se re-déclencher en boucle sur un renvoi interne ; et closeChronoSession est
  // idempotente (chrono inactif → no-op).
  if (!startup) {
    const active = useActiveSessionStore()
    // Un échec d'écriture (stockage plein) ne doit pas bloquer la sortie : vue-router avale
    // l'erreur en silence (RouterLink, retour), chaque geste restait sans effet. Le chrono
    // reste actif et la prochaine sortie retente la fermeture ; l'échec est signalé.
    if (active.isActive && !inChronoBubble(to, active.projectId)) {
      try {
        await closeChronoSession()
      } catch (e) {
        if (!handleStorageError(e, useSnackbarStore())) console.error(e)
      }
    }
  }
  return true
})

router.afterEach(() => navDone())
router.onError(() => navDone())

export default router

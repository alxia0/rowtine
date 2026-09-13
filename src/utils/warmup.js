// Préchauffe au repos : après peinture de l'accueil, on pré-charge le CODE des écrans
// réellement lourds/fréquents (compilation du chunk paresseux hors du chemin du tap) ET on
// pré-hydrate les stores partagés (laines). Cure du « lent la première fois » là où le poids
// existe : LocalPdfImportView tire pdfjs (~1,6 Mo) — cf. mesure `du` dans le plan. Ne touche
// PAS la partition SAF. Tout échec est avalé : optimisation, jamais un chemin critique.
// GARDE ANTI-TAP : avant chaque tâche, si une navigation est active, on cède la main et on
// réessaie — sinon compiler un gros chunk en pleine navigation ralentirait le tap.
import { navActive } from '@/composables/useNavProgress'

const IDLE_RETRY_MS = 200
let started = false

export async function runWarmup(tasks, isBusy = () => false) {
  if (started) return
  started = true
  for (const task of tasks) {
    while (isBusy()) {
      await new Promise((r) => setTimeout(r, IDLE_RETRY_MS))
    }
    try {
      await task()
    } catch {
      // préchauffe best-effort : on ignore et on continue
    }
  }
}

// Réinitialise le drapeau « déjà lancée » — RÉSERVÉ AUX TESTS.
export function __resetWarmupForTest() {
  started = false
}

// Chunks vraiment coûteux/fréquents (mêmes spécificateurs que le routeur → même chunk Vite).
// Volontairement PAS Stats/ProjectEdit/Library : chunks minuscules (2-11 K), gain nul.
const chunkTasks = [
  () => import('@/views/LocalPdfImportView.vue'), // lourd : embarque pdfjs-dist (~1,6 Mo)
  () => import('@/views/ReaderView.vue'),
  () => import('@/views/ProjectDetailView.vue'),
]

// Store partagé consulté à l'ouverture d'un projet (hydratation une fois par session).
const storeTasks = [
  async () => {
    const { useYarnsStore } = await import('@/stores/yarns')
    await useYarnsStore().load()
  },
]

export function scheduleWarmup() {
  if (typeof window === 'undefined') return
  const run = () => runWarmup([...chunkTasks, ...storeTasks], () => navActive.value)
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 3000 })
  } else {
    setTimeout(run, 1200)
  }
}

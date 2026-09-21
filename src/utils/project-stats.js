// Agrégation des statistiques d'UN projet — module PUR, zéro accès store/DB. Réutilise
// stats-grid.js (fenêtre/grille/séries) au lieu de dupliquer sa logique ; buildWindow() de ce
// module impose des paliers de semaines fixes (mois/trimestre/…) ancrés sur « aujourd'hui »,
// inadaptés à la durée réelle d'un projet — buildProjectWindow() construit donc son propre
// objet `win` (mêmes champs : startDay/endDay/mondayDays), borné à la vie du projet.
import { dayKeyOf, sessionsByDay, buildGrid, totalSeconds, activeDays, longestStreakInWindow } from '@/utils/stats-grid'
import { startOfWeek, ymdLocal, addDays } from '@/utils/time-periods'
import { localDayToDate } from '@/utils/date-format'
import { reservationsOf, consumedOf } from '@/utils/yarn-usage'
import { parseDecimal } from '@/utils/decimal'
import { readerProgress, patternToReader } from '@/utils/reader'

export function buildProjectWindow(project, sessions, refDate, firstDay = 1) {
  const sessionDays = (sessions || []).map(dayKeyOf).filter(Boolean).sort()
  const startDay = project?.startedAt || sessionDays[0] || ymdLocal(refDate)
  const endDay = project?.finishedAt || ymdLocal(refDate)
  const firstMonday = ymdLocal(startOfWeek(localDayToDate(startDay), firstDay))
  const lastMonday = ymdLocal(startOfWeek(localDayToDate(endDay), firstDay))
  const mondayDays = []
  let cursor = localDayToDate(firstMonday)
  while (ymdLocal(cursor) <= lastMonday) {
    mondayDays.push(ymdLocal(cursor))
    cursor = addDays(cursor, 7)
  }
  return { startDay, endDay, mondayDays }
}

// Détail PAR LAINE (jamais un total agrégé) — même règle d'appartenance que le total
// ci-dessous (réservé + consommé pour CE projet, mutuellement exclusifs). Réutilisée par
// `aggregateProjectStats` pour ne calculer ce lien qu'à un seul endroit, et par le badge
// (`BadgeComposer.vue` → `ProjectDetailView.vue`) pour afficher une ligne par laine.
export function projectYarnUsage(project, yarns) {
  const pid = project?.id
  const out = []
  for (const y of yarns || []) {
    const balls = (reservationsOf(y)[pid] || 0) + (consumedOf(y)[pid] || 0)
    if (balls > 0) out.push({ yarn: y, balls })
  }
  return out
}

// Même champ `rowsProgress` qu'avant (Task 7, lot 20/09), mais recalculé depuis le LECTEUR de
// patron (readerProgress/patternToReader, src/utils/reader.js) — pas depuis les sections
// déclarées à la main (table `sections`, `sectionsStore`). C'est la MÊME source que la fiche
// projet affiche déjà en tête de son onglet Sections (`readerOverview`,
// ProjectDetailView.vue) : un projet SANS section déclarée mais AVEC un patron structuré (cas
// réel, repéré par Julien le 20/09 : « For You Sweater », « Roni Sweater ») a quand même une
// progression calculable, ce que l'ancienne source (sections) ratait entièrement. `null` (jamais
// `{ done: 0, total: 0 }`) quand aucun patron n'est lié OU que son lecteur n'a aucune étape
// comptable — même distinction « non calculable » que l'ancienne source, lue par
// `BadgeComposer.vue` pour masquer complètement la ligne dans ce cas.
function computeReaderRowsProgress(pattern, readerState) {
  if (!pattern) return null
  const rp = readerProgress(patternToReader(pattern), readerState)
  return rp.total > 0 ? { done: rp.done, total: rp.total } : null
}

// Clés STABLES, jamais un libellé traduit — la traduction/formatage se fait chez l'appelant
// (onglet Stats, badge-render.js), jamais ici (règle du projet).
// `yarns` : laines du store (yarnsStore.yarns), PAS déjà filtrées par projet — reservationsOf/
// consumedOf filtrent elles-mêmes par project.id. Pelotes réservées + consommées : les deux
// maps sont mutuellement exclusives pour un couple (laine, projet), leur somme reste donc
// correcte que le projet soit en cours (tout dans reservations) ou terminé (tout dans consumed).
export function aggregateProjectStats(project, sessions, yarns, pattern = null, refDate = new Date()) {
  const list = sessions || []
  const win = buildProjectWindow(project, list, refDate)
  const byDay = sessionsByDay(list)
  const daySet = new Set(byDay.keys())
  const yarnUsage = projectYarnUsage(project, yarns)
  let ballsUsed = 0
  let metersUsed = 0
  for (const { yarn: y, balls } of yarnUsage) {
    ballsUsed += balls
    metersUsed += balls * (parseDecimal(y.lengthM) || 0)
  }
  return {
    totalSeconds: totalSeconds(win, byDay),
    sessionsCount: list.length,
    ballsUsed,
    metersUsed,
    // Détail par laine (cf. `projectYarnUsage`) porté par l'agrégat lui-même : le badge
    // (BadgeComposer.vue, via ProjectDetailView.vue) le relit ici plutôt que de rappeler
    // `projectYarnUsage` séparément sur les mêmes `project`/`yarns` (calcul dupliqué).
    yarnUsage,
    startDay: win.startDay,
    endDay: win.endDay,
    ongoing: !project?.finishedAt,
    bestStreak: longestStreakInWindow(daySet, win),
    activeDaysCount: activeDays(win, daySet).active,
    grid: buildGrid(win, byDay),
    rowsProgress: computeReaderRowsProgress(pattern, project?.readerState),
  }
}

export function formatDuration(totalSecondsValue) {
  const s = Math.max(0, Number(totalSecondsValue) || 0)
  const totalMin = Math.round(s / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${String(m).padStart(2, '0')} min`
}

// Grille calendaire du temps tricoté — module PUR.
// Zéro accès base, zéro date implicite : la date de référence entre TOUJOURS par paramètre,
// ce qui rend chaque fonction testable sans faux timer.
// Les jours sont des chaînes 'AAAA-MM-JJ' en heure LOCALE (ymdLocal, jamais toISOString) et se
// comparent de CHAÎNE À CHAÎNE : exact par construction, insensible au fuseau.
import { startOfWeek, ymdLocal, addDays } from '@/utils/time-periods'
import { localDayToDate } from '@/utils/date-format'

export const WINDOW_WEEKS = { month: 5, quarter: 13, semester: 26, year: 53 }

// Garde-fous contre une date aberrante (sauvegarde retouchée : séance datée 9999, `finishedAt`
// en l'an 1000). Chaque fonction ci-dessous parcourt la fenêtre jour par jour ou semaine par
// semaine : sans borne, l'onglet Stats et le composeur de badge gèlent.
// - Une année hors 1900..(année en cours + 1) n'est pas un jour : elle est ignorée. Seule
//   exception à la règle « aucune date implicite » du module, faute de date de référence
//   dans `dayKeyOf` (appelée en `.map`).
// - Une fenêtre ne dépasse jamais MAX_WINDOW_WEEKS semaines : au-delà, seules les plus
//   récentes sont parcourues.
export const MIN_YEAR = 1900
export const MAX_WINDOW_WEEKS = 520

export function isPlausibleDay(day) {
  const y = Number(String(day || '').slice(0, 4))
  return Number.isInteger(y) && y >= MIN_YEAR && y <= new Date().getFullYear() + 1
}

// Premier jour effectivement parcouru d'une fenêtre : `startDay`, ou le jour situé
// MAX_WINDOW_WEEKS semaines avant `endDay` s'il est plus récent.
function boundedStart(win) {
  const floor = ymdLocal(addDays(localDayToDate(win.endDay), -MAX_WINDOW_WEEKS * 7 + 1))
  return floor.startsWith('NaN') || win.startDay > floor ? win.startDay : floor
}
export const DEFAULT_WINDOW = 'quarter'

// Les huit couleurs de l'échelle. Ce sont des CONSTANTES DE LA GRILLE, pas des jetons de thème :
// elles ont passé le validateur ordinal (teinte unique, luminosité strictement monotone, écart
// ≥ 0,06 entre paliers, palier 1 détaché du fond). Tout ajustement doit repasser par lui.
// Le niveau 0 vaut `null` : il n'est pas peint, il porte le fond de page et un liseré.
export const HEAT_COLORS = {
  light: [null, '#d8a179', '#c07a52', '#ac5e38', '#963f1e'],
  dark: [null, '#624b26', '#8e6d30', '#bb8f3d', '#e8ad4c'],
}

// Seuils FIXES (pas relatifs au record personnel) : une case foncée veut toujours dire la même
// chose, donc deux trimestres se comparent. Bornes inclusives à gauche, exclusives à droite.
const LEVEL_THRESHOLDS = [1800, 3600, 7200] // 30 min, 1 h, 2 h

export function levelOf(seconds) {
  const s = Number(seconds) || 0
  if (s <= 0) return 0
  if (s < LEVEL_THRESHOLDS[0]) return 1
  if (s < LEVEL_THRESHOLDS[1]) return 2
  if (s < LEVEL_THRESHOLDS[2]) return 3
  return 4
}

// Fenêtre d'observation : N semaines ENTIÈRES commençant au premier jour choisi (`firstDay`,
// lundi par défaut), la dernière étant la semaine en cours (partielle). Les 7 lignes de
// la grille sont les jours de la semaine — sans alignement sur ce premier jour, les lignes ne
// voudraient plus rien dire. `firstDay` a un défaut (1 = lundi) : un appel existant sans 3e
// argument garde EXACTEMENT son comportement. Le champ `mondayDays` garde son nom historique
// (30 tests + plusieurs call sites y font référence) même s'il porte désormais le premier jour
// CHOISI, pas forcément un lundi — cf. le commentaire de `startOfWeekMonday` (time-periods.js).
export function buildWindow(refDate, period, firstDay = 1) {
  const weeks = WINDOW_WEEKS[period] ?? WINDOW_WEEKS[DEFAULT_WINDOW]
  const lastWeekStart = startOfWeek(refDate, firstDay)
  const mondayDays = []
  for (let i = weeks - 1; i >= 0; i--) mondayDays.push(ymdLocal(addDays(lastWeekStart, -7 * i)))
  return {
    period: WINDOW_WEEKS[period] ? period : DEFAULT_WINDOW,
    weeks,
    startDay: mondayDays[0],
    endDay: ymdLocal(refDate), // aujourd'hui INCLUS
    mondayDays,
  }
}

// Jour LOCAL d'une session. `s.date` est une chaîne ISO (UTC) : on la relit en Date puis on prend
// ses composantes locales — ymdLocal, jamais un slice(0,10) de l'ISO, qui rendrait le jour UTC.
export function dayKeyOf(session) {
  if (!session?.date) return null
  const d = new Date(session.date)
  if (Number.isNaN(d.getTime())) return null
  const day = ymdLocal(d)
  return isPlausibleDay(day) ? day : null
}

// Map jour -> { seconds, count, lastDate }. `lastDate` (instant de la session la plus récente du
// jour) sert les départages d'égalité (§7 « Égalités »).
export function sessionsByDay(sessions) {
  const byDay = new Map()
  for (const s of sessions || []) {
    const day = dayKeyOf(s)
    if (!day) continue
    const entry = byDay.get(day) || { seconds: 0, count: 0, lastDate: '' }
    entry.seconds += Number(s.durationSec) || 0
    entry.count += 1
    if (String(s.date) > entry.lastDate) entry.lastDate = String(s.date)
    byDay.set(day, entry)
  }
  return byDay
}

function isMonthStart(mondayDay, previousMondayDay) {
  if (!previousMondayDay) return true
  return mondayDay.slice(0, 7) !== previousMondayDay.slice(0, 7)
}

// Grille : une colonne par semaine (la plus ancienne à gauche), 7 cases par colonne
// (lundi en haut). Les jours POSTÉRIEURS à la date de référence sont marqués `future` : ils
// seront rendus ABSENTS, jamais comme un jour sans tricot.
export function buildGrid(win, byDay) {
  const mondayDays = win.mondayDays.slice(-MAX_WINDOW_WEEKS)
  const columns = mondayDays.map((monday, i) => {
    const mondayDate = localDayToDate(monday)
    const cells = []
    for (let k = 0; k < 7; k++) {
      const day = ymdLocal(addDays(mondayDate, k))
      const entry = byDay.get(day)
      const future = day > win.endDay
      cells.push({
        day,
        seconds: future ? 0 : entry?.seconds || 0,
        count: future ? 0 : entry?.count || 0,
        level: future ? 0 : levelOf(entry?.seconds || 0),
        future,
      })
    }
    return { monday, monthStart: isMonthStart(monday, mondayDays[i - 1]), cells }
  })
  return { columns }
}

// Regroupe les colonnes CONSÉCUTIVES d'un même mois (11/08 : encadrer les colonnes
// d'un mois par un rectangle). Même critère que les étiquettes de mois déjà posées au-dessus
// de la grille : une semaine appartient au mois de son LUNDI (`col.monthStart`, dérivé de
// `isMonthStart` sur les 7 premiers caractères du lundi) — jamais un critère à cheval sur les
// 7 jours de la colonne, qui donnerait un contour en escalier au lieu d'un rectangle par
// colonne entière. Le premier et le dernier groupe peuvent être PARTIELS (moins de colonnes
// que les mois du milieu) : c'est le nombre RÉEL de colonnes touchées par la fenêtre, jamais
// un compte de calendrier — un mois complet aurait 4 ou 5 colonnes, un mois partiel en a moins.
export function monthGroups(grid) {
  const groups = []
  // `col.monthStart` vaut déjà TOUJOURS `true` à i === 0 (isMonthStart le garantit : aucun
  // lundi précédent ⇒ c'est un début de mois par définition) — pas de cas particulier à coder.
  grid.columns.forEach((col, i) => {
    if (col.monthStart) groups.push({ key: col.monday.slice(0, 7), startIndex: i, count: 0 })
    groups[groups.length - 1].count += 1
  })
  return groups
}

// Décale un jour 'AAAA-MM-JJ' de `delta` jours (±1 typiquement) — une seule fonction pour les
// deux sens plutôt que deux miroirs quasi identiques.
function shiftDay(day, delta) {
  return ymdLocal(addDays(localDayToDate(day), delta))
}

// Jours consécutifs jusqu'à aujourd'hui. BORD D'AUJOURD'HUI : si rien n'est encore enregistré
// aujourd'hui, la série court jusqu'à HIER au lieu de retomber à zéro — sinon elle afficherait
// « 0 » tous les matins. Si hier est vide aussi, elle vaut 0.
// N'est PAS bornée par la fenêtre : une série est un fait continu, la tronquer la rendrait
// fausse (§7, exception assumée).
export function currentStreak(daySet, refDate) {
  if (!daySet?.size) return 0
  let cursor = ymdLocal(refDate)
  if (!daySet.has(cursor)) cursor = shiftDay(cursor, -1)
  let n = 0
  while (daySet.has(cursor)) {
    n += 1
    cursor = shiftDay(cursor, -1)
  }
  return n
}

// Plus longue série DANS la fenêtre — tronquée au bord, et c'est voulu : la tuile 4 affiche
// cette valeur à côté du record, ce qui rend la différence de portée visible.
// Ne lit que `startDay` et `endDay` de `win` : le record d'historique (StatsView.vue,
// tuile 4) lui passe donc un objet réduit `{ startDay, endDay }` plutôt qu'une vraie fenêtre —
// légitime puisque cette fonction ne touche à aucun autre champ.
export function longestStreakInWindow(daySet, win) {
  let best = 0
  let run = 0
  let day = boundedStart(win)
  while (day <= win.endDay) {
    run = daySet?.has(day) ? run + 1 : 0
    if (run > best) best = run
    day = shiftDay(day, 1)
  }
  return best
}

// Index de jour de semaine PREMIER-JOUR-CHOISI : Date.getDay() met toujours dimanche à
// 0, quel que soit le réglage — sans cette conversion, les lignes de la grille et les barres
// par jour de semaine décaleraient d'un cran dès que le premier jour n'est plus lundi. Défaut
// `firstDay = 1` (lundi) : identique à l'ancien calcul figé quand l'appelant ne passe rien.
function weekdayIndex(day, firstDay = 1) {
  const js = localDayToDate(day).getDay()
  return (js - firstDay + 7) % 7
}

function inWindow(day, win) {
  return day >= win.startDay && day <= win.endDay
}

function* daysOf(win) {
  let day = boundedStart(win)
  while (day <= win.endDay) {
    yield day
    day = shiftDay(day, 1)
  }
}

// `firstDay` détermine l'ORDRE des 7 cases (index 0 = le premier jour choisi), pas
// seulement leur libellé — sans lui, la case 0 resterait « lundi » même si la fenêtre (et donc
// la grille juste au-dessus) commence un dimanche : les deux se contrediraient à l'écran.
export function weekdayTotals(win, byDay, firstDay = 1) {
  const totals = [0, 0, 0, 0, 0, 0, 0]
  for (const day of daysOf(win)) totals[weekdayIndex(day, firstDay)] += byDay.get(day)?.seconds || 0
  return totals
}

// Fait d'HISTORIQUE, hors fenêtre : sur 5 semaines, chaque jour de la semaine n'est observé que
// 5 fois, ce qui est trop mince pour affirmer « je tricote surtout le dimanche ». Cette phrase
// est le seul chiffre hors période de la section des barres (§6). `firstDay` ne
// change pas QUEL jour gagne (la somme par jour calendaire est la même quel que soit l'ordre des
// cases), seulement l'INDEX rendu — qu'il faut faire correspondre au même `firstDay` que celui
// utilisé pour traduire cet index en nom de jour (StatsView.vue).
export function bestWeekdayAllTime(byDay, firstDay = 1) {
  const totals = [0, 0, 0, 0, 0, 0, 0]
  for (const [day, entry] of byDay) totals[weekdayIndex(day, firstDay)] += entry.seconds || 0
  const max = Math.max(...totals)
  return max > 0 ? totals.indexOf(max) : null
}

export function totalSeconds(win, byDay) {
  let total = 0
  for (const day of daysOf(win)) total += byDay.get(day)?.seconds || 0
  return total
}

// `elapsed` ne compte QUE les jours écoulés : les jours à venir de la semaine en cours
// gonfleraient le dénominateur et feraient baisser le taux sans raison.
//
// ⚠️ Un jour « actif » est un jour portant AU MOINS UNE ACTION ENREGISTRÉE : une session (même à
// rangs seuls, durée 0 — `saveManualSession` l'accepte), OU un geste de progression inscrit au
// journal des jours actifs (§7ter). D'où `days.has(day)` plutôt qu'un test sur
// `.seconds` : `sessionsByDay` ne crée une entrée QUE s'il existe au moins une session ce
// jour-là, jamais une entrée `{ seconds: 0 }` fantôme.
// `days` porte simplement `.has(day)` — une `Map` (`byDay`) comme un `Set` (l'union
// journal + sessions que StatsView lui passe) : aucune règle de calcul ne change entre les deux,
// c'est tout l'intérêt de la frontière posée d'emblée.
export function activeDays(win, days) {
  let active = 0
  let elapsed = 0
  for (const day of daysOf(win)) {
    elapsed += 1
    if (days.has(day)) active += 1
  }
  return { active, elapsed }
}

// Égalité : le jour le PLUS RÉCENT gagne — on balaie du plus ancien au plus récent avec `>=`.
// ⚠️ Portée volontairement DIFFÉRENTE d'`activeDays` : « meilleur jour » exige `seconds > 0`,
// à la différence de la tuile « jours actifs ». Un jour à rangs seuls (durée 0) est un jour
// actif, mais ce n'est pas un « meilleur jour » — il n'y a rien à y comparer, et l'afficher
// laisserait croire qu'une durée de zéro a été mesurée comme la meilleure.
export function bestDay(win, byDay) {
  let best = null
  for (const day of daysOf(win)) {
    const seconds = byDay.get(day)?.seconds || 0
    if (seconds > 0 && (!best || seconds >= best.seconds)) best = { day, seconds }
  }
  return best
}

// Moyenne par jour actif (tuile 7). `days` est le DÉNOMINATEUR — l'union journal +
// sessions — tandis que le total vient toujours de `byDay` : le journal ne connaît aucune durée.
// ⚖️ Décision produit du 11/08 : la moyenne BAISSE quand des jours sans durée entrent au
// dénominateur, et c'est voulu — c'est le prix pour que les trois tuiles affichées restent
// exactes les unes par rapport aux autres (`moyenne = total ÷ jours actifs`), vérifiable à la
// main par l'utilisatrice. Défaut `byDay` : comportement d'origine inchangé sans le 3e argument.
//
// Rend `null` — pas un nombre — quand la moyenne n'aurait aucun sens à afficher :
//   - aucun jour actif (division par zéro) ;
//   - des jours actifs mais un total NUL (fenêtre remplie uniquement de sessions à rangs seuls,
//     durée 0, ou de jours connus du seul journal). Sans cette garde, `fmtDuration(0)`
//     rendrait « 0:00 », un temps qui SEMBLE mesuré alors qu'il ne l'est pas — exactement
//     l'erreur que le tiret (§7) existe pour éviter.
export function averageSecondsPerActiveDay(win, byDay, days = byDay) {
  const { active } = activeDays(win, days)
  if (!active) return null
  const total = totalSeconds(win, byDay)
  if (!total) return null
  return Math.round(total / active)
}

// Égalité : le projet dont la session est la PLUS RÉCENTE gagne.
export function topProject(sessions, win) {
  const byProject = new Map() // projectId -> { seconds, lastDate }
  for (const s of sessions || []) {
    const day = dayKeyOf(s)
    if (!day || !inWindow(day, win)) continue
    const pid = s.projectId
    const entry = byProject.get(pid) || { seconds: 0, lastDate: '' }
    entry.seconds += Number(s.durationSec) || 0
    if (String(s.date) > entry.lastDate) entry.lastDate = String(s.date)
    byProject.set(pid, entry)
  }
  let best = null
  for (const [projectId, { seconds, lastDate }] of byProject) {
    if (!best || seconds > best.seconds || (seconds === best.seconds && lastDate > best.lastDate)) {
      best = { projectId, seconds, lastDate }
    }
  }
  return best ? { projectId: best.projectId, seconds: best.seconds } : null
}

// `finishedAt` est un JOUR ('AAAA-MM-JJ') et la fenêtre est bornée par deux jours : la
// comparaison se fait de chaîne à chaîne, sans jamais construire de Date. Exacte par
// construction, et le piège de fuseau ne se pose pas.
// `withoutDate` = le RELIQUAT : des projets marqués Terminé sans date saisie. On le déclare
// plutôt que de laisser croire à un compte complet.
export function finishedInWindow(projects, win) {
  let count = 0
  let withoutDate = 0
  for (const p of projects || []) {
    if (p?.status !== 'done') continue
    const day = String(p.finishedAt || '').slice(0, 10)
    if (!day) withoutDate += 1
    else if (inWindow(day, win)) count += 1
  }
  return { count, withoutDate }
}

// Compte au PRÉSENT : un projet est en cours maintenant, pas « pendant une fenêtre ».
export function wipCount(projects) {
  return (projects || []).filter((p) => p?.status === 'wip').length
}

// Règle de rattachement UNIQUE (§8) : un projet sans `technique` (fiche ancienne) compte
// comme TRICOT, la valeur par défaut. Centralisée ici et appelée par `filterByTechnique`,
// `filterProjectsByTechnique` ET `showTechniqueFilter` — l'écrire trois fois créerait
// trois occasions de la faire diverger.
function techniqueOf(project) {
  return project?.technique || 'knitting'
}

// Filtre tricot/crochet, appliqué EN AMONT : les sessions sont filtrées puis passées telles
// quelles aux fonctions ci-dessus, dont aucune n'est modifiée.
// - Un projet sans `technique` (fiche ancienne) compte comme TRICOT, la valeur par défaut.
// - Une session dont le projet n'existe plus n'apparaît que dans « Tout » : on ne lui invente
//   pas une technique.
export function filterByTechnique(sessions, projects, technique) {
  if (technique === 'all' || !technique) return sessions || []
  const byId = new Map((projects || []).map((p) => [p.id, p]))
  return (sessions || []).filter((s) => {
    const p = byId.get(s?.projectId)
    return p ? techniqueOf(p) === technique : false
  })
}

// Évolution du 11/08 — le sélecteur tricot/crochet ne s'affiche que si la BIBLIOTHÈQUE ENTIÈRE
// contient au moins un projet de chaque technique. Décision produit : le comptage
// porte sur TOUTE la bibliothèque, jamais sur la fenêtre ni sur une liste déjà filtrée — sinon
// le sélecteur apparaîtrait/disparaîtrait au fil d'un changement de période ou d'onglet, et les
// tuiles sauteraient sous le doigt. C'est pourquoi cette fonction ne prend QUE la liste de
// projets, ni fenêtre ni sessions : rien ne peut la faire varier avec la période ou l'onglet
// actifs, par construction — pas seulement par convention.
// ⛔ NE JAMAIS lui passer une liste déjà filtrée (le même piège que `hasAnyActivity`) : sous
// « Crochet » sur une base sans crochet, la liste filtrée serait vide et ferait
// disparaître le sélecteur qui vient pourtant de servir à la filtrer).
export function showTechniqueFilter(projects) {
  let hasKnitting = false
  let hasCrochet = false
  for (const p of projects || []) {
    if (techniqueOf(p) === 'crochet') hasCrochet = true
    else hasKnitting = true
    if (hasKnitting && hasCrochet) return true
  }
  return false
}

// Détail PAR PROJET des sessions d'un jour (11/08 : la liste des projets sous la case
// sélectionnée). `sessionsByDay` ci-dessus perd l'identité du projet en agrégeant tout un jour
// ensemble — c'est exactement ce qui manque pour afficher « quels projets, avec quel temps
// chacun ». Jumelle ADDITIVE : même forme d'entrée `{ seconds, count }` que `sessionsByDay`,
// un niveau plus bas (jour + projet plutôt que jour seul). Reçoit des sessions déjà FILTRÉES
// par technique (comme `sessionsByDay`) : rien à filtrer ici, la fonction ne fait qu'agréger.
// Le NOM du projet n'est pas résolu ici — cette fonction ne connaît que des `projectId`,
// exactement comme `topProject` plus haut ; la résolution en texte affichable vit dans la vue
// (StatsView.vue), qui a accès au store des projets.
export function sessionsByDayAndProject(sessions) {
  const byDay = new Map() // day -> Map<projectId, { seconds, count }>
  for (const s of sessions || []) {
    const day = dayKeyOf(s)
    if (!day) continue
    let byProject = byDay.get(day)
    if (!byProject) {
      byProject = new Map()
      byDay.set(day, byProject)
    }
    const pid = s.projectId
    const entry = byProject.get(pid) || { seconds: 0, count: 0 }
    entry.seconds += Number(s.durationSec) || 0
    entry.count += 1
    byProject.set(pid, entry)
  }
  return byDay
}

// Jumelle de `filterByTechnique`, pour les tuiles qui lisent directement des PROJETS
// (« terminés », « en cours ») plutôt que des sessions (§8 : les neuf tuiles suivent le
// filtre, pas sept). Même règle de rattachement : un projet sans `technique` (fiche ancienne)
// compte comme TRICOT.
// ⚠️ PAS de branche « orpheline » ici, à la différence de `filterByTechnique` : un projet de
// cette liste EXISTE par définition (c'est la liste elle-même) — il n'y a pas d'équivalent au
// « projet disparu » d'une session qui pointerait vers un id absent.
export function filterProjectsByTechnique(projects, technique) {
  if (technique === 'all' || !technique) return projects || []
  return (projects || []).filter((p) => techniqueOf(p) === technique)
}

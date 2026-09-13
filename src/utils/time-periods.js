// Périodes de temps (semaine calendaire lundi / mois / année) — fonctions pures, heure locale.
// Aucune dépendance : les fonctions reçoivent la date de référence en paramètre (jamais de
// Date.now() interne), ce qui les rend testables avec des dates injectées.
// Fuseau : tout est calculé en heure locale de l'appareil (Date natif) — un changement de fuseau
// déplace la frontière de semaine/mois/année, acceptable pour un usage perso (cf. spec Epic G, G1).

// Début de semaine 00:00:00.000 local de la semaine de `date` (ÉVO E, 11/08 : premier jour de
// semaine choisi dans les Réglages). `firstDay` suit la convention `Date.getDay()` (0 =
// dimanche … 6 = samedi) et entre TOUJOURS par PARAMÈTRE — ce module reste pur, zéro date/
// réglage implicite. Défaut = 1 (lundi) : tout appel existant garde EXACTEMENT son comportement.
export function startOfWeek(date, firstDay = 1) {
  const d = new Date(date)
  const day = d.getDay() // 0 = dimanche … 6 = samedi
  const diff = (day - firstDay + 7) % 7
  d.setDate(d.getDate() - diff)
  d.setHours(0, 0, 0, 0)
  return d
}

// Alias historique. Ce nom devient TROMPEUR depuis ÉVO E (la semaine peut désormais commencer
// un dimanche) — mais ~30 tests existants et 3 sites d'appel (`stats-grid.js`, `HomeView.vue`,
// `periodKey` ci-dessous) l'utilisent encore, et la règle du projet est de ne jamais renommer
// sans raison suffisante. Ici la raison (un nom honnête) existe mais ne suffit PAS à justifier
// de toucher ~30 tests qui n'ont besoin d'aucun changement de comportement : cet alias est un
// simple délégué vers `startOfWeek(date, 1)`, jamais dupliqué, pour qu'il ne puisse pas diverger
// du vrai calcul. Nouveau code : préférer `startOfWeek(date, firstDay)`, qui dit la vérité.
export function startOfWeekMonday(date) {
  return startOfWeek(date, 1)
}

// Sept noms de jour localisés, PREMIER JOUR CHOISI en tête (jamais Date.getDay() brut, qui met
// toujours dimanche à 0 quel que soit le réglage). 2026-06-03 est un mercredi (vérifié), point
// de départ NEUTRE dont `startOfWeek` dérive l'ancre réelle. `style` suit
// `Intl.DateTimeFormat` ('narrow'/'short'/'long'…) — factorisée ici : StatsHeatmap.vue
// (initiales de la gouttière) et StatsView.vue (barres + phrase d'historique) doivent tourner
// avec EXACTEMENT le même calcul d'ancre, sinon la gouttière et les lignes de la grille juste à
// côté (dérivées du MÊME `firstDay` côté StatsView) se contrediraient. Rester sur `Intl`
// (jamais une liste traduite à la main) : c'est ce qui fait que les langues suivent sans code
// supplémentaire.
export function weekdayNames(locale, firstDay, style) {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: style })
  const a = startOfWeek(new Date(2026, 5, 3), firstDay)
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(a.getFullYear(), a.getMonth(), a.getDate() + i)))
}

// 1er du mois à 00:00 local.
export function startOfMonth(date) {
  const d = new Date(date)
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0)
}

// 1er janvier à 00:00 local.
export function startOfYear(date) {
  const d = new Date(date)
  return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0)
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

// YYYY-MM-DD à partir des composantes LOCALES (pas toISOString(), qui est en UTC et décale la
// date près de minuit). Exportée (10/08) : `stats-grid.js` en a besoin, et la dupliquer serait
// la façon la plus sûre de la faire diverger dans le seul module où un décalage de fuseau ne
// se verrait pas.
export function ymdLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// Clé de période triable lexicographiquement = triable chronologiquement.
// week : date du DÉBUT DE SEMAINE (YYYY-MM-DD, lundi par défaut — `firstDay`, ÉVO E) — PAS un
// numéro de semaine ISO, pour éviter les bugs de semaine 52/53 aux frontières d'année.
// month : YYYY-MM. year : YYYY. `firstDay` en 3e paramètre, avec défaut : aucun appel existant
// ne change de comportement.
export function periodKey(date, granularity, firstDay = 1) {
  const d = new Date(date)
  if (granularity === 'week') return ymdLocal(startOfWeek(d, firstDay))
  if (granularity === 'year') return `${d.getFullYear()}`
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}` // 'month' (et repli)
}

// Regroupe les sessions par période (granularity: 'week' | 'month' | 'year'), somme durationSec,
// trie décroissant par clé (le plus récent d'abord). Ignore les sessions sans date valide.
// `firstDay` (ÉVO E) ne joue un rôle QUE pour granularity === 'week' — 'month'/'year' l'ignorent
// silencieusement, ce qui est correct : un mois ou une année ne dépendent pas du premier jour
// de semaine choisi.
export function aggregateByPeriod(sessions, granularity, firstDay = 1) {
  const startOfFn = granularity === 'week' ? (d) => startOfWeek(d, firstDay) : granularity === 'year' ? startOfYear : startOfMonth
  const byKey = new Map() // key -> { key, startDate, seconds }

  for (const s of sessions || []) {
    if (!s?.date) continue
    const d = new Date(s.date)
    if (Number.isNaN(d.getTime())) continue

    const key = periodKey(d, granularity, firstDay)
    let entry = byKey.get(key)
    if (!entry) {
      entry = { key, startDate: startOfFn(d), seconds: 0 }
      byKey.set(key, entry)
    }
    entry.seconds += s.durationSec || 0
  }

  return [...byKey.values()].sort((a, b) => b.key.localeCompare(a.key))
}

// Somme des durationSec des sessions depuis le début de la semaine courante (00:00 local de
// `now`, au premier jour choisi — `firstDay`, ÉVO E). Sert le reset hebdomadaire de l'Accueil
// (dérivation, pas de tâche planifiée). Défaut = lundi : un appel existant sans 3e argument
// garde exactement son comportement.
export function currentWeekSeconds(sessions, now, firstDay = 1) {
  const start = startOfWeek(now, firstDay)
  return (sessions || [])
    .filter((s) => s?.date && new Date(s.date) >= start)
    .reduce((acc, s) => acc + (s.durationSec || 0), 0)
}

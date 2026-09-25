// Formatage de date pour l'affichage. PUR : aucune dépendance Vue/Pinia/i18n — la locale
// est passée en argument par la vue. Dépend de `time-periods.js` (pur lui aussi) pour
// `ymdLocal`, jamais l'inverse : pas de cycle.
import { ymdLocal } from './time-periods'

// Ce helper reçoit DEUX formes distinctes, à ne JAMAIS traiter de la même façon — la
// distinction se fait sur la FORME DE LA VALEUR, jamais sur qui appelle (revue du 10/08,
// après le défaut trouvé dans « grille calendaire du temps ») :
//
// - une date-JOUR ('AAAA-MM-JJ', 10 caractères, sans 'T') : ce que portent `startedAt`,
//   `finishedAt` (stores/projects.js) et `purchasedAt` (stores/patterns.js), toutes saisies
//   par un `<input type="date">`. Elle désigne un JOUR SANS HEURE NI FUSEAU — « le 10 août »
//   et rien d'autre. La DÉCOUPER (`slice(0, 10)` puis `new Date(y, m-1, d)`, en LOCAL) est
//   donc EXACTE. La relire via `new Date(value)` serait FAUX : cette construction est
//   interprétée en UTC, donc minuit UTC recule d'un jour à l'ouest de Greenwich — exactement
//   le défaut que `localDayToDate` corrige à l'écriture ailleurs dans ce lot.
//
// - une date-INSTANT (ISO complète avec heure, ex. '2026-08-10T23:00:00.000Z') : ce que
//   porte `date` d'une session (`sessionsStore`, écrit en `.toISOString()`). Elle désigne un
//   MOMENT précis dans le temps, dont le JOUR dépend d'OÙ la personne se trouvait à cet
//   instant — un instant proche de minuit UTC peut être « la veille » ou « le lendemain »
//   selon le fuseau. Le bon jour se lit avec `ymdLocal(new Date(value))`, JAMAIS en
//   tronquant la chaîne UTC (qui donnerait le jour à GREENWICH, pas le jour local).
//
// Distinguées par la LONGUEUR de la chaîne (une date-jour fait exactement 10 caractères)
// ou la présence d'un 'T' (un séparateur heure que seul un ISO complet porte).
export function formatLocalDate(value, locale) {
  if (!value) return ''
  const raw = String(value)
  const isInstant = raw.length > 10 || raw.includes('T')

  if (isInstant) {
    const instant = new Date(raw)
    if (Number.isNaN(instant.getTime())) return raw // repli : montrer ce qui est écrit
    const [y, m, d] = ymdLocal(instant).split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(locale)
  }

  const iso = raw.slice(0, 10)
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso // repli : montrer la valeur tronquée, jamais « Invalid Date »
  return new Date(y, m - 1, d).toLocaleDateString(locale)
}

// Jour et mois seuls (libellé « semaine du … » des barres de rythme), dans l'ordre et avec
// la ponctuation de la langue : 07/09 en français, 09/07 en anglais, 07.09. en allemand.
export function formatDayMonth(date, locale) {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(date)
}

// Une date saisie AU JOUR (input type="date") désigne un JOUR LOCAL, pas un instant.
// `new Date('2026-08-10')` vaut minuit UTC : à l'ouest de Greenwich la session se rangerait la
// VEILLE, et une grille où chaque jour a sa case l'exposerait à l'écran.
// Midi local est le seul point du jour qu'aucune bascule d'heure d'été ne fait changer de date.
export function localDayToDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  if (!y || !m || !d) return new Date(NaN)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

// Libellé relatif de JOUR pour la tuile « Dernières sessions » (T4, 31/08 soir). `dateIso` est
// l'INSTANT ISO complet de la session (ce que porte `date`, écrit en `.toISOString()`) ; par
// tolérance, une date-jour 'AAAA-MM-JJ' est acceptée et lue en LOCAL — même discipline des
// deux formes que `formatLocalDate` ci-dessus. `now` est injecté (testabilité, règle du
// projet : jamais de `Date.now()` interne, cf. time-periods.js). Jour de la session et jour
// courant lus via `ymdLocal` (temps local, JAMAIS UTC — pièges de l'en-tête), puis ancrés à
// midi local par `localDayToDate` : l'écart en jours calendaires est alors un multiple de
// 24 h à une heure de bascule d'été près, que le `Math.round` absorbe — une session de 23 h 50
// un dimanche, vue le lundi 00 h 10, est bien « Hier », pas « Dimanche ». Un écart négatif
// (horloge modifiée, session future) est ramené à 0 : jamais de libellé négatif.
//
// Choix Intl (documenté, spec T4) : `Intl.RelativeTimeFormat` en `numeric: 'always'` rend
// « il y a 1 jour » pour d = 1 (et « il y a 0 jour » pour d = 0) — PAS « Hier »/« Aujourd'hui ».
// Ces deux cas sortent donc en `numeric: 'auto'` (défaut), qui rend les mots dédiés de la
// langue (« Aujourd'hui »/« Hier », « Today »/« Yesterday », « Heute »/« Gestern »,
// « Hoy »/« Ayer ») : la fonction suit la locale, sans texte français figé. d = 2…6 : nom du
// jour via `Intl.DateTimeFormat` weekday:'long'. Au-delà : `numeric: 'always'` comme voulu par
// la spec (« Il y a 7 jours », « vor 7 Tagen », « 7 days ago »…) ; d ≥ 360 passe par
// `format(-floor(d/360), 'year')` — l'équivalent Intl du « Il y a plus d'un an » de la spec
// (« Il y a 1 an », « 1 year ago »), qui suit la locale comme le reste. Initiale en capitale
// sur le résultat FINAL : le libellé ouvre une ligne d'affichage.
export function relativeDayLabel(dateIso, now, locale) {
  const raw = String(dateIso ?? '')
  const isDayOnly = raw.length === 10 && !raw.includes('T')
  const instant = isDayOnly ? localDayToDate(raw) : new Date(raw)
  const ref = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(instant.getTime()) || Number.isNaN(ref.getTime())) return ''

  const sessionDay = localDayToDate(ymdLocal(instant))
  const today = localDayToDate(ymdLocal(ref))
  const d = Math.max(0, Math.round((today.getTime() - sessionDay.getTime()) / 86400000))

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
  if (d <= 1) return cap(new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-d, 'day'))
  if (d <= 6) return cap(new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(sessionDay))
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
  if (d < 30) return cap(rtf.format(-d, 'day'))
  if (d < 360) return cap(rtf.format(-Math.floor(d / 30), 'month'))
  return cap(rtf.format(-Math.floor(d / 360), 'year'))
}

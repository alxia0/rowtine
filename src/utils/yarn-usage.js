// Usage d'une laine : répartition de ses pelotes entre plusieurs projets (pool), état
// dérivé pour le badge du stock, et migration depuis l'ancien modèle « 1 laine = 1 projet »
// (scalaires reservedFor/reservedQty). Tout est PUR : testable hors composant, et la
// dérivation ne vit pas dans les vues.
import { normalizeLabels } from '@/constants/yarn-labels'

// Map { [projectId]: qté } propre : clés numériques, quantités entières > 0.
function cleanReservations(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw)) {
    const pid = Number(k)
    const qty = Math.floor(Number(v))
    if (!Number.isFinite(pid) || !Number.isFinite(qty) || qty <= 0) continue
    out[pid] = qty
  }
  return out
}

// Migration pure & idempotente (même motif que needlesPatch dans stores/projects.js) :
// renvoie null si la laine est DÉJÀ au nouveau format (rien à écrire), sinon le patch.
//
// Le nouveau format complet = `reservations` ET `consumed` tous les deux présents.
// PIÈGE : une laine migrée par la version PRÉCÉDENTE (celle d'avant `consumed`) a
// `reservations` mais pas `consumed` — elle doit être re-migrée UNE fois pour gagner
// `consumed: {}` (patch minimal, `reservations` n'est pas touché), puis plus jamais
// (la 2e fois, les deux sont présents → null). Sans ce cas intermédiaire, `consumed`
// n'apparaîtrait jamais sur les laines déjà migrées auparavant.
export function normalizeYarnReservations(yarn) {
  const hasReservations = yarn?.reservations && typeof yarn.reservations === 'object'
  const hasConsumed = yarn?.consumed && typeof yarn.consumed === 'object'
  if (hasReservations && hasConsumed) return null
  if (hasReservations) return { consumed: {} }
  const pid = Number(yarn?.reservedFor)
  if (yarn?.reservedFor == null || !Number.isFinite(pid)) return { reservations: {}, consumed: {} }
  // Un reservedFor valide = intention de lien : on ne la perd JAMAIS. Seule la QUANTITÉ
  // retombe (absente / nulle / négative / illisible → nb total de pelotes, puis 1).
  const raw = Math.floor(Number(yarn.reservedQty))
  const fromQuantity = Math.floor(Number(yarn.quantity))
  const qty = Number.isFinite(raw) && raw > 0 ? raw : Number.isFinite(fromQuantity) && fromQuantity > 0 ? fromQuantity : 1
  return { reservations: { [pid]: qty }, consumed: {} }
}

// Lecture tolérante : nouveau format si présent, sinon dérivé de l'ancien.
export function reservationsOf(yarn) {
  if (yarn?.reservations && typeof yarn.reservations === 'object') return cleanReservations(yarn.reservations)
  return cleanReservations(normalizeYarnReservations(yarn)?.reservations)
}

export function reservedTotal(yarn) {
  return Object.values(reservationsOf(yarn)).reduce((a, n) => a + n, 0)
}

// Pelotes libres de toute réservation.
export function yarnAvailable(yarn) {
  return Math.max(0, (Number(yarn?.quantity) || 0) - reservedTotal(yarn))
}

// Ce que CE projet peut prendre au maximum : sa propre allocation est en cours d'édition,
// donc on ne la décompte pas (seules celles des AUTRES projets bloquent).
export function availableForProject(yarn, pid) {
  const res = reservationsOf(yarn)
  const others = Object.entries(res).reduce((a, [k, n]) => (Number(k) === Number(pid) ? a : a + n), 0)
  return Math.max(0, (Number(yarn?.quantity) || 0) - others)
}

// Écrit/retire l'allocation d'UN projet dans le pool d'une laine, sans jamais toucher
// celles des autres projets. qty null/0/négatif => l'allocation de ce projet est retirée.
// La quantité est bornée au disponible pour ce projet ; si rien n'est disponible (les
// autres projets prennent déjà tout), AUCUNE allocation n'est écrite — on n'invente
// jamais des pelotes qui n'existent pas. Renvoie la nouvelle map (ne mute pas la laine).
export function setProjectReservation(yarn, pid, qty) {
  const next = { ...reservationsOf(yarn) }
  const key = Number(pid)
  // Number(null) === Number('') === 0 est « finite » : sans le key <= 0, un pid absent
  // écrirait une allocation au projet fantôme n° 0 (les ids Dexie démarrent à 1).
  if (!Number.isFinite(key) || key <= 0) return next
  const n = Math.floor(Number(qty))
  if (!Number.isFinite(n) || n <= 0) {
    delete next[key]
    return next
  }
  const max = availableForProject(yarn, key)
  if (max <= 0) {
    delete next[key]
    return next
  }
  next[key] = Math.min(n, max)
  return next
}

// Lecture tolérante de la trace de consommation : map { [projectId]: qté déjà
// tricotée, retirée de `quantity` } propre, tolère l'absence du champ (laine pas
// encore migrée). Réutilise le même nettoyage que `reservationsOf` — jamais dupliqué.
export function consumedOf(yarn) {
  return cleanReservations(yarn?.consumed)
}

// Termine l'allocation d'UN projet : borne `used` à [0, réservé pour ce projet],
// retire sa réservation (le reliquat retourne donc au stock automatiquement — cf.
// `setProjectReservation(yarn, pid, null)`), cumule `used` dans la trace de
// consommation de ce projet, et déduit `quantity` (plancher 0). PUR : ne mute jamais
// la laine, ne touche jamais les allocations/traces des autres projets. Composé à
// partir des primitives existantes (pas de fusion/repli re-tapée à la main).
export function consumeProjectReservation(yarn, pid, used) {
  const key = Number(pid)
  const reserved = reservationsOf(yarn)[key] || 0
  const n = Math.floor(Number(used))
  const clamped = Number.isFinite(n) ? Math.max(0, Math.min(n, reserved)) : 0
  const reservations = setProjectReservation(yarn, key, null)
  const before = consumedOf(yarn)
  const consumed = cleanReservations({ ...before, [key]: (before[key] || 0) + clamped })
  const quantity = Math.max(0, (Number(yarn?.quantity) || 0) - clamped)
  return { reservations, consumed, quantity }
}

// État du badge stock. `projectsById` : { [id]: { status } }.
// Un projet lié introuvable (supprimé) n'est JAMAIS considéré terminé → repli 'reserved'.
export function yarnUsageState(yarn, projectsById = {}) {
  const total = Number(yarn?.quantity) || 0
  // Laine épuisée par le tricot : plus une seule pelote (quantity 0) mais une trace de
  // consommation existe → reste visible au stock en « Utilisée » (décision produit),
  // plutôt que de disparaître silencieusement dans 'free' faute de réservation active.
  // Sans trace (jamais consommée), quantity 0 reste 'free' : pas de fausse trace inventée.
  if (total === 0 && Object.keys(consumedOf(yarn)).length > 0) return { state: 'used', used: 0, total: 0 }
  const res = reservationsOf(yarn)
  const pids = Object.keys(res)
  const used = Math.min(
    pids.reduce((a, k) => a + res[k], 0),
    total,
  )
  if (used <= 0) return { state: 'free', used: 0, total }
  const allDone = pids.every((k) => projectsById?.[k]?.status === 'done')
  if (!allDone) return { state: 'reserved', used, total }
  return { state: used >= total ? 'used' : 'usedPartial', used, total }
}

// Un projet est vegan quand TOUTES ses laines rattachées portent le label 'vegan' — un
// projet qui mélange une laine vegan et une laine mérinos n'est PAS vegan, seule règle
// honnête (décision produit). Rattachée = réservée (reservationsOf, laine encore en cours
// sur ce projet) OU consommée (consumedOf, laine déjà tricotée sur ce projet). Le volet
// consommation est nécessaire : `consumeProjectReservation` RETIRE la réservation au moment
// où le projet passe à Terminé/Abandonné (elle migre dans `consumed`) — sans lui, un pull
// fini en laine vegan perdrait son icône pile en rejoignant la vitrine des ouvrages
// terminés, l'inverse de ce qui est demandé (décision produit, 06/08). Un seul passage sur
// `yarns` (pas une concaténation réservées+consommées) : chaque laine n'est examinée qu'UNE
// fois, donc jamais comptée deux fois même si elle est à la fois réservée (pour un AUTRE
// projet, cf. reservationsOf) et consommée (pour CELUI-ci). Aucune laine rattachée : on ne
// sait pas → faux (l'icône n'affiche alors rien plutôt que d'inventer un verdict, même
// discipline que la déduction d'origine des fibres). `normalizeLabels` tolère l'absence du
// champ `labels` (fiche enregistrée avant l'ajout des caractéristiques).
export function isProjectVegan(projectId, yarns) {
  const linked = (yarns || []).filter(
    (y) => reservationsOf(y)[projectId] != null || consumedOf(y)[projectId] != null,
  )
  if (linked.length === 0) return false
  return linked.every((y) => normalizeLabels(y?.labels).includes('vegan'))
}

// Une URL qui vient d'un patron n'est jamais de confiance : elle traverse le front-matter
// d'un `.md` (`lien:`), une sauvegarde restaurée, un kit `.zip` — trois chemins qu'un
// fichier reçu de l'extérieur emprunte tel quel. Elle finit dans un `href`
// (`PatternView.vue`, lien vers le site de l'auteur), et un `href` en `javascript:` exécute
// du code au premier clic. Ce module dit ce qu'on accepte d'y mettre.
//
// Zéro dépendance et imports relatifs uniquement : il est chargé par `pattern-md/parse.js`,
// donc par tout ce qui parse un patron — l'application comme le banc de mesure.

// Les SEULS schémas absolus admis. Tout le reste est refusé — `javascript:` et `vbscript:`
// (exécution), `data:` (une page HTML complète tient dans une URL), `file:`, `blob:`,
// `filesystem:`, `intent:` (Android), et tout schéma que personne n'a encore inventé. Liste
// blanche, jamais liste noire : c'est la seule forme qui reste juste demain.
const SAFE_SCHEMES = new Set(['http:', 'https:'])

// Ce que le navigateur RETIRE avant de lire le schéma d'une URL : blancs de tête, caractères
// de contrôle et blancs de largeur nulle, où qu'ils soient. `java\tscript:alert(1)` est donc
// un lien `javascript:` pour lui, et une chaîne inoffensive pour un test naïf — d'où le
// nettoyage AVANT l'examen. Seul l'examen porte sur la chaîne nettoyée : ce qui est rendu,
// lui, reste la valeur d'origine (on ne réécrit jamais l'URL de la travailleuse).
// Les caractères de contrôle sont ICI le sujet, pas un accident : les écarter de la classe
// rouvrirait exactement la faille (`java\tscript:`). D'où la dérogation, ciblée sur la ligne.
// oxlint-disable-next-line no-control-regex
const IGNORED_IN_SCHEME_RE = /[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\ufeff]/g

// Préfixe de schéma, au sens de la RFC 3986 : une lettre, puis lettres/chiffres/`+`/`-`/`.`,
// puis « : ». Son absence signe une URL RELATIVE.
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i

/**
 * Une valeur peut-elle aller dans un `href` sans risque ?
 * Vrai pour une chaîne vide, pour une URL relative (aucun schéma : elle ne peut pas
 * exécuter de code), et pour une URL absolue en `http:`/`https:` réellement analysable.
 * Faux pour tout autre schéma.
 */
export function isSafeUrl(url) {
  if (url == null) return false
  const probe = String(url).replace(IGNORED_IN_SCHEME_RE, '')
  if (probe === '') return true
  const m = SCHEME_RE.exec(probe)
  // Pas de schéma : URL relative. Elle ne désigne aucun interpréteur, donc rien à exécuter.
  if (!m) return true
  if (!SAFE_SCHEMES.has(`${m[1].toLowerCase()}:`)) return false
  // Le schéma est bon, mais `http://` tout seul n'est pas une URL. `new URL` tranche —
  // c'est l'analyseur du navigateur lui-même, pas une seconde grammaire écrite à la main
  // qui divergerait de la sienne.
  try {
    return SAFE_SCHEMES.has(new URL(probe).protocol)
  } catch {
    return false
  }
}

/**
 * L'URL si elle est sûre, la chaîne vide sinon.
 *
 * Une URL refusée DISPARAÎT — elle n'est ni réparée, ni préfixée, ni remplacée. Le dépôt
 * n'invente rien : fabriquer `https://` devant `javascript:alert(1)` produirait un lien que
 * personne n'a jamais écrit, et le faire pointer ailleurs serait pire encore. Rien vaut
 * mieux que faux.
 */
export function sanitizeUrl(url) {
  if (url == null) return ''
  const raw = String(url).trim()
  return isSafeUrl(raw) ? raw : ''
}

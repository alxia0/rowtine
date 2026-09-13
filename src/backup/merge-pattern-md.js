// Rowtine — fusion MD→entité + garde de dégénérescence.
//
// Quand un `patron.md` édité en externe est reparsé (`mdToPattern`) et jugé sûr,
// on fusionne le résultat dans l'entité live (patron DB) : **le MD gagne** sur ce
// qu'il sait décrire de bout en bout (reader, nom, auteur, tailles — portées par
// `reader.sizeLabels` — galerie, lien) ; **le live garde** tout ce qui est
// interne/technique et que le format MD ne représente pas (id, rattachements
// projet/patron, photos, type, catégorie, notes, PDF d'origine, témoin
// `patronMd`) — et plus généralement tout champ que le MD ne porte pas.
//
// `mdToPattern` NE LÈVE JAMAIS (`{ pattern, warnings }`) : un parse « réussi »
// d'un MD tronqué ou mal compris ne s'annonce pas de lui-même. `isMdSafeToMerge`
// est donc la garde explicite qui décide de fusionner ou de garder l'interne —
// principe cardinal : jamais de perte silencieuse.

import { W, WARNING_CODES } from '../utils/pattern-md/warning-codes'
import { sanitizeUrl } from '../utils/safe-url'

// Une chaîne « fournie » par le MD = non vide après trim. Le MD peut renvoyer
// `''` pour un champ absent (front-matter facultatif) : ce n'est pas une valeur
// à imposer, l'ancienne valeur live doit survivre.
function isProvided(value) {
  return typeof value === 'string' && value.trim() !== ''
}

// mergePatternFromMd(liveEntity, mdPattern) → entité fusionnée (copie).
// Pure, ne lève jamais : entrées absentes/malformées tolérées.
export function mergePatternFromMd(liveEntity, mdPattern) {
  const live = liveEntity && typeof liveEntity === 'object' ? liveEntity : {}
  const md = mdPattern && typeof mdPattern === 'object' ? mdPattern : {}
  const merged = { ...live }

  // reader et gallery sont TOUJOURS MD-owned dès que la fusion a lieu (même une
  // galerie vide est l'état correct côté MD, pas une absence d'information) —
  // les tailles voyagent avec le reader via reader.sizeLabels. `sizes` (champ
  // top-level dupliquant les mêmes tailles, lu directement par PatternView,
  // LibraryView, l'export CSV de SettingsView et le préremplissage de projet)
  // suit la même règle : sinon il resterait figé sur l'ancienne liste pendant
  // que reader.sizeLabels change, et les deux divergeraient silencieusement.
  if (md.reader && typeof md.reader === 'object') merged.reader = md.reader
  if (Array.isArray(md.gallery)) merged.gallery = md.gallery
  if (Array.isArray(md.sizes)) merged.sizes = md.sizes

  // name/author/lien : le MD gagne seulement s'il fournit effectivement une
  // valeur — un champ vide côté MD (front-matter incomplet) ne doit pas
  // effacer une valeur live existante.
  if (isProvided(md.name)) merged.name = md.name
  if (isProvided(md.author)) merged.author = md.author
  // `authorUrl` finit dans un `href` (PatternView.vue) et vient ici d'un `patron.md`
  // éditable à la main dans le dossier de sauvegarde : liste blanche http/https, une
  // URL refusée devient `''` — jamais réparée, jamais préfixée (cf. utils/safe-url.js).
  // On n'écrase la valeur live que si le MD en fournit une ET qu'elle survit au filtre :
  // sinon un `javascript:` collé dans le MD effacerait le lien légitime du patron.
  if (isProvided(md.authorUrl)) {
    const safe = sanitizeUrl(md.authorUrl)
    if (safe) merged.authorUrl = safe
  }

  return merged
}

// Seuils de garde-fou — heuristiques volontairement simples, arbitraires mais
// DOCUMENTÉES et réglables si l'expérience montre des faux positifs/négatifs :
//  - SHRINK_SAFE_RATIO (0.5) : si le MD reparsé décrit moins de la moitié des
//    sections OU moins de la moitié du total de steps que l'interne, on
//    considère la perte trop importante pour être un edit volontaire (plus
//    probablement un fichier tronqué/mal collé) → refusé.
//  - MAX_WARNINGS (10) : au-delà, le MD est jugé largement incompris par le
//    parseur tolérant → refusé même si le volume de contenu semble correct.
const SHRINK_SAFE_RATIO = 0.5
const MAX_WARNINGS = 10

function sectionsOf(entity) {
  return Array.isArray(entity?.reader?.sections) ? entity.reader.sections : []
}

function totalSteps(sections) {
  return sections.reduce((n, s) => n + (Array.isArray(s?.steps) ? s.steps.length : 0), 0)
}

// isMdSafeToMerge(mdPattern, liveEntity, warnings) → { safe, reason? }
// Pure, ne lève jamais. `reason` est un avertissement STRUCTURÉ (`W(code, params)`, cf.
// pattern-md/warning-codes.js), destiné au rapport de synchro : la traduction se
// fait à l'AFFICHAGE (warningText), jamais ici.
export function isMdSafeToMerge(mdPattern, liveEntity, warnings) {
  const mdSections = sectionsOf(mdPattern)
  const liveSections = sectionsOf(liveEntity)

  // MD vide alors que le live a du contenu réel : parse manifestement dégradé.
  if (mdSections.length === 0 && liveSections.length > 0) {
    return { safe: false, reason: W(WARNING_CODES.MERGE_NO_SECTIONS) }
  }

  // Rien à protéger côté live (patron neuf/vide) → pas de comparaison de ratio
  // possible (division par zéro) et rien à perdre : toujours sûr.
  if (liveSections.length > 0) {
    const sectionRatio = mdSections.length / liveSections.length
    if (sectionRatio < SHRINK_SAFE_RATIO) {
      return {
        safe: false,
        reason: W(WARNING_CODES.MERGE_FEWER_SECTIONS),
      }
    }
  }

  const mdSteps = totalSteps(mdSections)
  const liveSteps = totalSteps(liveSections)
  if (liveSteps > 0) {
    const stepRatio = mdSteps / liveSteps
    if (stepRatio < SHRINK_SAFE_RATIO) {
      return {
        safe: false,
        reason: W(WARNING_CODES.MERGE_FEWER_STEPS),
      }
    }
  }

  const warnCount = Array.isArray(warnings) ? warnings.length : 0
  if (warnCount > MAX_WARNINGS) {
    return {
      safe: false,
      reason: W(WARNING_CODES.MERGE_TOO_MANY_WARNINGS, { count: warnCount }),
    }
  }

  return { safe: true }
}

// chartRepeatLabelsLost(entity) → nombre de libellés `chart.repeat` non vides portés par
// l'interne (grille globale reader.chart + grilles de section). Décision du 01/09 : ce
// libellé (phrase « dimensions du motif » des démos, phrase libre des patrons importés
// d'avant le 31/07) n'a AUCUNE place dans le format Rowtine-MD — serialize.js ne peut pas
// l'émettre, parse.js le laisse vide (cf. commentaires là-bas) — donc mergePatternFromMd,
// qui remplace le reader ENTIER, le perd à chaque fusion. La synchro (patron-md-sync.js)
// appelle ce compteur APRÈS la garde de dégénérescence et push un avertissement
// CHART_REPEAT_LABEL_LOST quand le compte est > 0 : la perte cesse d'être silencieuse.
// Pas de préservation possible : écrire le libellé dans le MD changerait le format sur
// disque (migration exclue par cette décision) ; et repliquer un libellé figé sur des dimensions
// potentiellement ré-éditées exposerait un libellé MENTEUR — le repli d'affichage
// chartMotifLabel (src/utils/reader.js) reconstruit déjà un libellé équivalent dans la
// langue de l'écran quand `repeat` est vide. Pur : ne lit QUE l'entité, ne touche rien.
export function chartRepeatLabelsLost(entity) {
  const reader = entity?.reader || {}
  let n = 0
  if (typeof reader.chart?.repeat === 'string' && reader.chart.repeat) n += 1
  for (const sec of reader.sections || []) {
    if (typeof sec?.chart?.repeat === 'string' && sec.chart.repeat) n += 1
  }
  return n
}

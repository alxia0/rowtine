// Détecte si un patron est probablement en allemand : isSpacedTitle (segment.js) et
// shouldJoin (reflow.js) utilisent normalement « la ligne suivante commence en
// minuscule » comme signal de continuation de phrase — fiable en FR/EN/ES, mais quasi
// inopérant en allemand (les noms communs y prennent toujours une majuscule, y compris
// en milieu de phrase). Détection interne au pipeline d'import (assemble.js), jamais
// persistée sur le patron.

// Mots-outils allemands à haute fréquence, sans équivalent proche en français/anglais/
// espagnol : suffisent à distinguer un texte allemand sans dépendance externe, dans
// l'esprit des vocabulaires multilingues déjà utilisés ailleurs dans ce module (cf.
// KIND_KEYWORDS, segment.js) — mais dédiés à la détection de LANGUE, pas au classement
// par thème. « des » exclu volontairement : article pluriel français très fréquent
// (« la couleur des fils »), collision connue avec le génitif allemand « des ».
//
// Frontières Unicode-aware : \b JS se définit sur \w ASCII (pas Unicode-aware même avec
// /u), donc une lettre accentuée (ä, ü, ö, é…) est vue comme un caractère non-mot et crée
// une fausse frontière AU MILIEU d'un mot. Exemple réel : « Fäden » (fils, mot allemand
// courant en tricot) contient la sous-chaîne « den » ; avec \b, \bden\b matchait à tort à
// l'intérieur de « Fäden » comme si « den » était l'article isolé. Remplacé par des
// lookaround sur \p{L}/\p{N} (lettre/chiffre Unicode), vraiment Unicode-aware.
const GERMAN_MARKER_RE =
  /(?<![\p{L}\p{N}])(?:und|nicht|für|mit|ist|sind|wird|werden|wurde|nach|der|die|das|den|dem|eine|einen|einem|einer|auf|sich|im|zu)(?![\p{L}\p{N}])/giu

// Sous ce nombre de mots, le score est trop instable pour être fiable (un fragment très
// court peut faire basculer le ratio) — repli sûr : traité comme non-allemand, comme le
// comportement actuel.
const MIN_WORDS = 20

// Calé sur les fixtures ci-dessus (cf. tests/unit/pdf-import-lang-detect.spec.js) : un
// texte allemand réel dépasse largement ce seuil (marqueurs très fréquents : articles,
// conjonctions), un texte FR/EN/ES n'en approche aucun. À réévaluer si la mesure de
// jauge révèle un faux positif/négatif sur le corpus réel.
const GERMAN_SCORE_THRESHOLD = 1 / 30

export function detectGerman(pages) {
  const text = (pages || []).flat().map((l) => l.text || '').join(' ')
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length < MIN_WORDS) return false
  const matches = text.match(GERMAN_MARKER_RE) || []
  return matches.length / words.length >= GERMAN_SCORE_THRESHOLD
}

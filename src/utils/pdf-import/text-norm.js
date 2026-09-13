// Normalisation de CLASSIFICATION (jamais de stockage) pour les regex allemandes
// marquées /i.
//
// Piège vérifié (campagne de test, hazy-whisper-sweater-de-3f672f59) : le flag /i des
// regex JavaScript NE case-fold PAS le ẞ CAPITAL moderne (U+1E9E — « LATIN CAPITAL
// LETTER SHARP S », rendu Google Docs de l'eszett en majuscules, orthographe allemande
// correcte depuis la réforme 2017 : GRÖẞE/MAẞE) vers ß (U+00DF), contrairement à
// `String.prototype.toLowerCase()` :
//   /ß/i.test('ẞ')     → false
//   'ẞ'.toLowerCase()  → 'ß'
// Raison : l'algorithme Canonicalize des regex JS (mode non-Unicode) compare les
// MAJUSCULES des deux caractères ; or `'ß'.toUpperCase()` vaut `'SS'` (2 caractères),
// donc la spec ECMA-262 laisse 'ß' INCHANGÉ (elle n'accepte qu'un résultat à 1 caractère)
// — 'ß' canonicalisé reste 'ß', tandis que 'ẞ' canonicalisé reste 'ẞ' (déjà majuscule,
// 1 caractère) : les deux ne s'égalent jamais sous /i.
// Chaque motif contenant `(?:ß|ss)` sous /i échoue donc silencieusement dès que le texte
// source porte ce glyphe capital — cassant à la fois `kindForTitle` (segment.js),
// la détection de tailles (sizes.js) et les libellés de mesure (reference.js LABELS).
//
// Correctif ÉTROIT : on ne fold QUE ce caractère, et UNIQUEMENT dans la copie passée à
// .test()/.exec() d'un matcher de CLASSIFICATION (décider un `kind`/`field`/booléen) —
// JAMAIS dans le texte stocké/émis (titre de section affiché, libellé de tableau,
// contenu verbatim). Muter le texte stocké réécrirait un contenu légitime (une
// orthographe allemande moderne correcte), en violation de la règle absolue du projet
// « jamais perdre d'info ». Modèle à suivre pour un futur piège similaire (accents/
// ligatures d'une autre langue) : normaliser AU POINT D'APPEL de CHAQUE test de
// classification, jamais une seule fois globalement sur tout le pipeline (ce qui
// muterait le texte stocké en amont de toute décision).
export function foldEszett(t) {
  return String(t ?? '').replace(/ẞ/g, 'ß')
}

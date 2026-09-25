// Du couple (titre de section, position de l'étape) au numéro de ligne du
// Rowtine-MD — cible d'ouverture de l'éditeur de correction depuis le lecteur.
// Pur : aucun DOM, aucun import Vue, testable seul.
//
// ⚠️ Appariement par TITRE, jamais par identifiant de section (premier
// correctif, 2026-08-21) : le Markdown ne porte que le titre (`## <titre>`),
// jamais l'id — un `sectionId` ne peut donc se comparer qu'à
// `slug(titre)`, ce qui suppose `sec.id === slug(titre)`. C'est vrai pour un
// id généré par `normalizeReaderForSave` (patron importé/édité), FAUX pour
// les patrons de démonstration (`src/constants/demo/*.js`) : leurs ids sont
// codés à la main (`'bordure'`, `'corps'`, `'sommet'`…) et ne passent jamais
// par `normalizeReaderForSave` — 8 sections sur 10 dans ces patrons ont un
// id qui ne dérive pas de leur titre (seuls `finitions` du Bonnet Torsade et
// `assemblage` du Sac coïncident avec le slug de leur titre — recompté et
// vérifié directement sur `src/constants/demo/fr.js`). Comparer sur le
// TITRE (donc son slug) fonctionne quelle que soit l'origine de l'id :
// c'est l'appelant (`CorrectionView.vue`) qui retrouve le titre depuis l'id
// reçu dans l'URL.
//
// La règle de comptage est dérivée de la sérialisation réelle
// (src/utils/pattern-md/serialize.js:100-126) : une étape ouvre une ligne de
// type 'rang', 'compteur' ou 'note', OU une ligne 'image' NON INDENTÉE (un
// diagramme, une image de galerie). Les images ancrées sous une étape sont
// émises `  ![](…)` — ce sont des continuations, pas des étapes. `IMG_RE`
// (md-line-type.js) accepte l'indentation, donc `lineType` seul ne les
// distingue pas : c'est l'indentation de la ligne brute qui tranche.
//
// ⚠️ Deux écarts CONNUS entre l'index d'étape du lecteur (`sec.id#i`, position
// dans `sec.steps`) et ce comptage. Ils NE se comportent PAS pareil :
//  - la section d'intro (concept `isIntro`, id `'presentation'` — pas un titre
//    littéral) est DÉPLIÉE hors des `##` par serialize.js : aucun titre à
//    trouver, ce cas-là tombe bien sur le repli silencieux de l'appelant ;
//  - une étape diagramme sans image exploitable n'émet RIEN (serialize.js:90,
//    garde `!(ch && ch.img)`) : les étapes SUIVANTES de cette section sont
//    décalées d'un cran. Un décalage ne produit PAS `null` : il renvoie un
//    numéro de ligne VALIDE mais qui désigne la mauvaise étape (celle d'après
//    dans `sec.steps`). Seule la DERNIÈRE étape de la section retombe alors
//    réellement sur le repli silencieux (plus aucune ligne à trouver après
//    le décalage). Vérifié par déroulé pour `[A(rang), B(diagramme sans
//    image), C(rang)]` : serialize.js émet `## Corps` / `''` / `- A` / `- C`
//    — `stepLine(md, 'Corps', 1)` renvoie la ligne de C, alors que l'index 1
//    désignait B.
//
// ⚠️ Ce module, pris isolément, NE désambiguïse PAS deux sections de MÊME
// titre : `findSectionIndex` s'arrête au premier match, donc viser la
// seconde occurrence par son titre retourne quand même la première (contrat
// figé par `tests/unit/step-line.spec.js` — cas « deux sections de même
// titre »). Ce n'est PAS une amélioration par rapport à l'appariement par id
// : deux sections homonymes sont indiscernables dans le Markdown, un
// résultat plausible mais faux serait pire qu'un repli visible (l'échec se
// verrait, l'erreur de section non). La garde vit donc chez l'APPELANT
// (`CorrectionView.vue`, deuxième passe, 2026-08-21) : avant d'appeler ce
// module, il compte les sections de `baseReader` qui partagent le même
// titre (slug) et, s'il y en a plus d'une, ne passe aucune cible du tout —
// repli en tête de document plutôt qu'un curseur posé dans la mauvaise
// section.
import { slug } from '../reader.js'
import { lineType, h2Title, H2_PREFIXE_RE } from './md-line-type.js'

// Cette ligne brute ouvre-t-elle une étape ?
function opensStep(raw) {
  const type = lineType(raw)
  if (type === 'rang' || type === 'compteur' || type === 'note') return true
  return type === 'image' && !/^\s/.test(String(raw ?? ''))
}

// Index (0-based, dans le tableau de lignes) du titre de la section, ou -1.
// `sectionTitle` arrive déjà slugifié par les fonctions publiques ci-dessous.
function findSectionIndex(lines, sectionTitle) {
  for (let i = 0; i < lines.length; i += 1) {
    // `lineType === 'section'` et non un simple `##` : un bloc d'aide-mémoire
    // (`## Fil {yarn}`) est un titre de niveau 2 mais n'est PAS une section de
    // travail, et son slug pourrait entrer en collision avec celui d'une vraie
    // section.
    if (lineType(lines[i]) !== 'section') continue
    if (slug(h2Title(lines[i])) === sectionTitle) return i
  }
  return -1
}

// Numéro de ligne (1-based) du titre de la section, ou `null`.
export function sectionLine(md, sectionTitle) {
  const target = slug(sectionTitle)
  if (!target) return null
  const i = findSectionIndex(String(md ?? '').split('\n'), target)
  return i < 0 ? null : i + 1
}

// Numéro de ligne (1-based) de la n-ième étape de la section, ou `null`.
export function stepLine(md, sectionTitle, index) {
  const target = slug(sectionTitle)
  if (!target || !Number.isInteger(index) || index < 0) return null
  const lines = String(md ?? '').split('\n')
  const start = findSectionIndex(lines, target)
  if (start < 0) return null
  let n = 0
  for (let i = start + 1; i < lines.length; i += 1) {
    // `H2_PREFIXE_RE` (md-line-type.js), pas un second littéral `/^##\s/` local : en
    // test booléen les deux sont équivalents (`\s+` exige déjà au moins un blanc),
    // réutilisée plutôt que recopiée pour la même raison que le reste du fichier.
    if (H2_PREFIXE_RE.test(lines[i])) return null // section suivante atteinte
    if (!opensStep(lines[i])) continue
    if (n === index) return i + 1
    n += 1
  }
  return null
}

// Lignes du fragment + index 0-based de départ (clampé) pour une remontée depuis
// `lineNumber` (1-based) — préambule COMMUN à sectionTitleAtLine et imageAnchorLine
// (toutes deux remontent ligne par ligne depuis le curseur) : un futur ajustement de ce
// clamp (ex. un cas limite hors-bornes) ne doit se corriger qu'à UN seul endroit.
function linesAndStart(md, lineNumber) {
  const lines = String(md ?? '').split('\n')
  const start = lines.length ? Math.max(0, Math.min(lines.length - 1, (Number(lineNumber) || 1) - 1)) : -1
  return { lines, start }
}

// Inverse de sectionLine : titre (NON slugifié) de la section qui contient la
// ligne 1-based donnée, ou `null` si la ligne précède tout titre de section.
// Remonte ligne par ligne depuis `lineNumber` — même distinction lineType ===
// 'section' que findSectionIndex (un bloc aide-mémoire `## Fil {yarn}` n'est
// PAS une section de travail).
export function sectionTitleAtLine(md, lineNumber) {
  const { lines, start } = linesAndStart(md, lineNumber)
  for (let i = start; i >= 0; i -= 1) {
    if (lineType(lines[i]) === 'section') return h2Title(lines[i])
  }
  return null
}

// Ligne (1-based) après laquelle une image de galerie insérée depuis le curseur doit
// s'écrire pour s'accrocher à une VRAIE étape (rang/compteur/note) — jamais poser une
// image non indentée (deviendrait un diagramme, cf. serialize.js/promoteImageToChart)
// ni une image orpheline (perdue en silence, warning `section.orphanImage`). Remonte
// depuis `cursorLine` (1-based, incluse) jusqu'à la première étape rencontrée, sans
// jamais dépasser le titre de la section englobante : `null` si le curseur précède
// toute étape (section vide, ou avant tout titre de section) — choix de repli acté
// le 27/08/2026 (accrocher au rang le plus proche AU-DESSUS, jamais
// promouvoir silencieusement en diagramme). Une fois l'étape trouvée, avance jusqu'à la
// fin de ses images DÉJÀ ancrées (images sœurs) : la nouvelle s'ajoute à la suite,
// jamais entre deux images existantes.
export function imageAnchorLine(md, cursorLine) {
  const { lines, start } = linesAndStart(md, cursorLine)
  for (let i = start; i >= 0; i -= 1) {
    const type = lineType(lines[i])
    if (type === 'section') return null
    if (type === 'rang' || type === 'compteur' || type === 'note') {
      let last = i
      while (last + 1 < lines.length && lineType(lines[last + 1]) === 'image' && /^\s/.test(lines[last + 1])) {
        last += 1
      }
      return last + 1
    }
  }
  return null
}

export { h2Title }

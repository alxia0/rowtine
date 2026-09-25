// Traduit une SÉLECTION de lignes (déjà démarquées par stripMarkup) en forme PLATE de
// référence, celle que `referenceBlocksToMd` sait émettre et que `parseReservedBlock` sait
// relire. C'est le cœur du correctif du menu « Aide mémoire » : avant, chaque ligne
// devenait le TITRE d'un bloc à corps vide (md-retag.js), que le parseur rejetait —
// à raison — vers les notes.
//
// Module PUR, sans DOM ni CM6 : chargeable tel quel par Vitest et par le banc corpus.
import { REF_TAG_TO_KEY, isTableSep, isPipeLine, splitCells } from './refblocks'
import { SCALAR_TEXT_KEYS } from './scalar-keys'
import { applySizeVectors } from '../pdf-import/sizes'
import { fitSizeRowValues } from '../reader'

// Rubriques dont le corps est un PARAGRAPHE ici : une seule valeur de texte, pas une liste.
// `SCALAR_TEXT_KEYS` importée du module feuille scalar-keys.js (même ensemble que
// reference-merge.js, qui l'importe aussi depuis là plutôt que de refblocks.js — cf. son
// commentaire). ⚠️ NE PAS la confondre avec `FREE_TEXT_KEYS` : refblocks.js possède déjà une
// constante de ce nom, avec un contenu DIFFÉRENT (6 clés, dont materials/techniques/tips —
// celles qui sont sujettes au sauvetage de titre réécrit dans parseReservedBlock).

// Rubriques dont le corps est une liste à puces, une entrée par ligne.
const BULLET_KEYS = new Set(['materials', 'tips'])

// --- Tables Markdown déjà présentes dans la sélection -------------------------------
// La fusion (mergeIntoReference) ré-émet le corps EXISTANT d'un bloc en même temps que les
// nouvelles lignes : quand ce bloc est une table, la sélection contient donc son en-tête et
// sa ligne séparatrice. Sans traitement, « | mesure | S | M | L | » repartirait en RANGÉE de
// mesures — une ligne parasite à chaque fusion. Même règle structurelle que `parseTableBlock`
// (refblocks.js) : l'en-tête est la ligne qui précède IMMÉDIATEMENT la séparatrice, et les
// deux sont de la mise en forme, jamais du contenu.
// `isTableSep`/`isPipeLine`/`splitCells` réutilisées depuis refblocks.js (même
// import que REF_TAG_TO_KEY ci-dessus) plutôt que recopiées ici : c'était une
// seconde version, divergente au détail près (pas de coercition/trim), du type de
// duplication que ce fichier de dialecte met justement en garde ailleurs — les
// lignes reçues ici sont déjà trimées (cf. `trimmed` dans `selectionToFlat`), donc
// aucun changement de comportement.

function stripTableChrome(lines) {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    if (isTableSep(lines[i])) continue
    if (isPipeLine(lines[i]) && isTableSep(lines[i + 1] || '')) continue
    out.push(lines[i])
  }
  return out
}

// Séparateur d'une entrée de glossaire. L'ordre des alternatives ne compte pas : on prend
// la PREMIÈRE occurrence dans la ligne, quelle que soit sa nature (`ms = maille serrée :
// 1 jeté` se coupe sur le `=`, pas sur le `:`). Le tiret simple exige des espaces autour,
// sinon « demi-bride » se couperait en deux.
const ABBR_SEP_RE = /\s*[=:—–\t]\s*|\s+-\s+/

function splitAbbr(line) {
  // Rangée de table déjà formée (fusion dans un glossaire existant) : les cellules SONT le
  // découpage, ne pas les repasser par le séparateur textuel.
  if (isPipeLine(line)) {
    const cells = splitCells(line)
    if (cells.length >= 2) return { key: cells[0], def: cells.slice(1).join(' ') }
  }
  const m = ABBR_SEP_RE.exec(line)
  // Pas de séparateur, ou ligne qui COMMENCE par lui (`= maille`) : rien à découper —
  // toute la ligne devient la clé, l'utilisatrice complète la définition à la main.
  if (!m || m.index === 0) return { key: line, def: '' }
  return {
    key: line.slice(0, m.index).trim(),
    def: line.slice(m.index + m[0].length).trim(),
  }
}

// Une ligne de mesure -> une rangée du tableau des tailles. Réutilise `applySizeVectors`,
// la grammaire de non-invention de l'import : elle ne retient QUE les vecteurs de longueur
// exactement n, donc elle n'invente jamais une valeur manquante. Quand elle ne trouve rien
// d'exploitable, la ligne part en GABARIT (label = la ligne entière, colonnes vides) plutôt
// que d'être rejetée : rien ne se perd, et l'utilisatrice n'a qu'à remplir les cases.
function lineToSizeRow(line, n) {
  // Rangée de table déjà formée (fusion dans une table existante) : les cellules SONT le
  // découpage, et AUCUNE ne doit disparaître (correctif revue — avant, un compte
  // de valeurs qui ne collait pas au nombre de tailles renvoyait un gabarit `Array(n).fill('')`
  // qui EFFAÇAIT les valeurs réelles de la rangée : « | Tour de poitrine | 90 | 100 | 110 | »
  // ressortait vide dès qu'on corrigeait le champ Tailles, c'est-à-dire au geste même pour
  // lequel ce champ existe). `fitSizeRowValues` (reader.js) complète par des cases vides quand
  // il en manque et REPLIE le surplus dans la dernière colonne quand il y en a trop — dans les
  // deux sens, rien ne se perd et rien ne s'invente. `cell()` (refblocks.js) neutralise les
  // `|` du label comme des valeurs : la table ne peut pas se casser.
  if (isPipeLine(line)) {
    const [label, ...values] = splitCells(line)
    return { label, values: fitSizeRowValues(values, n) }
  }
  const { t, c } = applySizeVectors(line, n)
  if (c.length === 1) {
    const label = t.replace('{{0}}', '').replace(/\s{2,}/g, ' ').trim()
    if (label) return { label, values: c[0] }
  }
  return { label: line, values: Array(n).fill('') }
}

// Correctif revue (fusion) : ce module réalimente la fusion avec le corps
// EXISTANT d'un bloc Techniques (retagSelection -> selectionToFlat), qui peut déjà
// contenir un ou plusieurs titres `### Titre`. `stripMarkup` (md-retag.js) ne reconnaît
// que les `##` (H2_RE exige un espace juste après, jamais un 3e `#`) : un `### Jeté` déjà
// présent traverse donc INCHANGÉ jusqu'ici. Avant ce correctif, `const [title, ...rest] =
// lines` prenait ce titre existant pour le PREMIER MOT de la nouvelle technique, doublant
// le balisage (`### ### Jeté`) et versant tout le reste (y compris les autres techniques
// déjà présentes) dans un unique corps.
//
// Même règle de découpage que le moteur — `parseReservedBlock`, branche `key ===
// 'techniques'` (refblocks.js) — réutilisée ici plutôt que d'en écrire une seconde qui
// finirait par diverger : chaque `### Titre` ouvre une nouvelle technique, les lignes
// suivantes alimentent son corps. Le texte avant le premier `###` (s'il y en a un) N'EST
// PAS ignoré (arbitrage retenu, 20/08 : une première version alignait ce cas sur
// `parseReservedBlock`, qui l'ignore à l'import — repéré comme une perte silencieuse,
// contraire à la règle cardinale du projet ; « aligné sur le moteur » n'excusait pas la
// perte). Ce segment de tête devient sa PROPRE technique, sur la même règle que le cas
// « aucun `###` du tout » juste en dessous — voir le commentaire de `linesToTechniques`
// pour le détail.
//
// Sans AUCUN `###` dans la sélection (cas nominal, hors fusion : une ligne de patron
// tout juste sélectionnée et taguée « Techniques ») : comportement INCHANGÉ, la 1re ligne
// devient le titre, le reste le corps, UNE technique.
function linesToTechniques(lines) {
  const firstMarked = lines.findIndex((l) => /^###\s+/.test(l))
  if (firstMarked === -1) {
    const [title, ...rest] = lines
    return [{ title, body: rest.join('\n') }]
  }

  const techniques = []
  // Correctif revue (arbitrage retenu, 20/08) : le segment de tête AVANT
  // le premier `###` n'est PAS jeté -- règle cardinale du projet, rien de ce que
  // l'utilisatrice a saisi ne doit disparaître. Il devient sa PROPRE technique, sur la
  // MÊME règle que le cas « aucun ### du tout » juste au-dessus : 1re ligne = titre, le
  // reste = corps. `referenceBlocksToMd` la réémettra en `### Titre` + corps comme les
  // autres techniques : le parseur la relira sans avertissement au prochain passage,
  // rien ne se perd au geste ni au reparse suivant (boucle fermée).
  if (firstMarked > 0) {
    const [title, ...rest] = lines.slice(0, firstMarked)
    techniques.push({ title, body: rest.join('\n') })
  }

  for (const l of lines.slice(firstMarked)) {
    const h = /^###\s+(.+)$/.exec(l)
    if (h) techniques.push({ title: h[1], body: '' })
    else if (l && techniques.length) {
      const t = techniques[techniques.length - 1]
      t.body = t.body ? `${t.body}\n${l}` : l
    }
  }
  return techniques
}

/**
 * @param {string[]} lines Lignes sélectionnées, déjà démarquées (stripMarkup).
 * @param {string} tag Balise EN de référence (yarn, needles, gauge, materials, tips,
 *   techniques, abbreviations, measurements).
 * @param {{ sizeLabels?: string[] }} [opts]
 * @returns {object|null} Forme plate, ou `null` si le tag n'est pas une balise de
 *   référence, si la sélection ne contient aucune ligne non blanche, ou si la balise
 *   n'a pas de forme plate émise (cas : galerie/gallery).
 */
export function selectionToFlat(lines, tag, { sizeLabels = [] } = {}) {
  const key = REF_TAG_TO_KEY[tag]
  if (!key) return null

  const trimmed = (lines || []).map((l) => String(l ?? '').trim()).filter(Boolean)
  // L'habillage de table n'est retiré que pour les deux rubriques à table : ailleurs, une
  // ligne commençant par `|` est du contenu ordinaire et doit survivre telle quelle.
  const kept = key === 'sizeTable' || key === 'abbr' ? stripTableChrome(trimmed) : trimmed
  if (!kept.length) return null

  if (SCALAR_TEXT_KEYS.has(key)) return { [key]: kept.join('\n') }
  if (BULLET_KEYS.has(key)) return { [key]: kept }
  if (key === 'techniques') return { techniques: linesToTechniques(kept) }
  if (key === 'abbr') return { abbr: kept.map(splitAbbr) }
  if (key === 'sizeTable') {
    const n = (sizeLabels || []).length
    return { sizeTable: kept.map((l) => lineToSizeRow(l, n)) }
  }
  // `galerie` est la seule clé restante de REF_TAG_TO_KEY : elle n'est pas au menu
  // « Aide mémoire » et n'a pas de forme plate émise par referenceBlocksToMd.
  return null
}

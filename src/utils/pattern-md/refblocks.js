// Blocs référence à titres réservés : émission depuis la forme plate,
// parsing tolérant vers la forme plate. Titres normalisés via slug (casse/accents)
// pour la compat FR héritée (titres non balisés) ; balise EN {tag} pour le
// dialecte courant.
import { slug, isSingleSize } from '../reader'
import { REF_TO_EN } from './dialect'
import { W, WARNING_CODES } from './warning-codes'

// PROTOTYPE NUL (`Object.create(null)`) — pas une coquetterie : un titre de patron est une
// chaîne LIBRE, et `RESERVED['constructor']` sur un objet littéral remonte la chaîne de
// prototype et renvoie la fonction `Object` (truthy). Un patron portant `## Constructor`
// (ou tout titre qui se slug-ifie ainsi : `__proto__`, `toString`, `valueOf`…) était donc
// routé par `parse.js` vers `parseReservedBlock('constructor'|Object, …)`, qui ne connaît
// aucune de ces clés et retombe sur son `return {}` final : la section ENTIÈRE disparaissait
// SANS avertissement (`sections` amputée, `warnings: []`) — la perte silencieuse que tout ce
// fichier existe pour empêcher. Le prototype nul supprime la classe entière du défaut pour
// TOUS les lecteurs de la table, pas seulement `reservedKey` (même principe que la garde de
// clé vide de `buildAbbrRegex`, src/utils/reader.js : corriger à la source, pas au chemin).
const RESERVED = Object.assign(Object.create(null), {
  echantillon: 'gauge',
  fil: 'yarn',
  aiguilles: 'needles',
  'aiguilles-materiel': 'needles',
  materiel: 'materials',
  conseils: 'tips',
  techniques: 'techniques',
  abreviations: 'abbr',
  tailles: 'sizeTable',
  'tableau-des-tailles': 'sizeTable',
  galerie: 'galerie',
})

export function reservedKey(title) {
  // `Object.hasOwn` EN PLUS du prototype nul (ceinture et bretelles) : la table ne peut plus
  // jamais répondre pour une clé qu'elle ne porte pas, quelle que soit la façon dont elle
  // sera construite plus tard.
  const key = slug(title)
  return Object.hasOwn(RESERVED, key) ? RESERVED[key] : null
}

// Inverse de REF_TO_EN (dialect.js) : balise EN {tag} -> clé interne de parsing.
// Les tags de RÉFÉRENCE sont exactement l'ensemble des valeurs de REF_TO_EN
// (gauge/yarn/needles/materials/techniques/abbreviations/measurements/gallery/
// intro) — aucun autre vocabulaire n'est introduit ici. Seuls quelques noms de
// clé interne historiques (antérieurs aux balises) diffèrent de l'orthographe
// du tag ; le reste est identité. Collision `measurements` : les deux clés
// internes historiques `mesures`/`tailles` convergent vers `sizeTable` (jamais
// `mesures`).
const REF_TAG_KEY_OVERRIDES = { abbreviations: 'abbr', measurements: 'sizeTable', gallery: 'galerie' }
// `intro` (REF_TO_EN.info) est exclu du routage référence (correctif M1) :
// ce n'est pas un bloc table-isable, `referenceBlocksToMd` n'a d'ailleurs aucune
// branche `flat.info` qui l'émette. Si `parseReservedBlock` le recevait quand
// même (MD externe portant `{intro}`), il tombait sur le `return {}` final,
// silencieusement — perte de contenu. En l'excluant ici, `{intro}` n'est plus
// reconnu comme référence et retombe en section de travail ordinaire (comme
// tout tag inconnu), qui préserve son contenu.
const EXCLUDED_REF_TAGS = new Set(['intro'])
// Prototype nul, pour la MÊME raison que `RESERVED` ci-dessus, et avec la même portée :
// le tag d'un titre `## Titre {tag}` vient du document (TITLE_KIND_RE accepte `[a-z0-9-]+`,
// donc `{constructor}` et `{valueof}`… — `{__proto__}` non, l'underscore n'y est pas), et
// SIX sites le lisent en test de présence (`parse.js`, `md-line-type.js`,
// `find-reference-block.js`, `md-retag-selection.js`, `selection-to-reference.js`,
// `cm-editor.js`). Corriger chacun d'eux, c'est six occasions d'en oublier un ; corriger la
// TABLE les protège tous d'un coup, aujourd'hui et à chaque futur lecteur.
export const REF_TAG_TO_KEY = Object.assign(
  Object.create(null),
  Object.fromEntries(
    [...new Set(Object.values(REF_TO_EN))]
      .filter((tag) => !EXCLUDED_REF_TAGS.has(tag))
      .map((tag) => [tag, REF_TAG_KEY_OVERRIDES[tag] ?? tag])
  )
)

const cell = (s) => String(s ?? '').trim().replace(/\|/g, '/')

export function referenceBlocksToMd(flat, sizeLabels = []) {
  const out = []
  if (flat.gauge) out.push(`## Échantillon {${REF_TO_EN.echantillon}}`, '', flat.gauge, '')
  if (flat.yarn) out.push(`## Fil {${REF_TO_EN.fil}}`, '', flat.yarn, '')
  if (flat.needles) out.push(`## Aiguilles {${REF_TO_EN.aiguilles}}`, '', flat.needles, '')
  if (flat.materials?.length) out.push(`## Matériel {${REF_TO_EN.materiel}}`, '', ...flat.materials.map((x) => `- ${x}`), '')
  // Bloc Conseils, sur le modèle EXACT du bloc Matériel juste au-dessus
  // (même forme puces, même émission), juste après lui.
  if (flat.tips?.length) out.push(`## Conseils {${REF_TO_EN.conseils}}`, '', ...flat.tips.map((x) => `- ${x}`), '')
  if (flat.techniques?.length) {
    out.push(`## Techniques {${REF_TO_EN.techniques}}`, '')
    for (const t of flat.techniques) out.push(`### ${t.title}`, '', t.body, '')
  }
  if (flat.abbr?.length) {
    out.push(`## Abréviations {${REF_TO_EN.abbr}}`, '', '| abr. | définition |', '|------|------------|')
    for (const a of flat.abbr) out.push(`| ${cell(a.key)} | ${cell(a.def)} |`)
    out.push('')
  }
  if (flat.sizeTable?.length) {
    // Taille unique : le prompt prescrit l'en-tête « | mesure | valeur | » (et non le
    // libellé interne « Taille unique »). L'en-tête est ignoré au parsing (n=1 inchangé).
    //
    // `sizeLabels` peut aussi être VIDE (aucune ligne `tailles:`/`sizes:` en front-matter :
    // cas des patrons mono-taille, qui perdent volontairement cette clé à la sérialisation,
    // cf. commentaire dans src/utils/pdf-import/node.mjs) sans que ce soit la sentinelle
    // « Taille unique » détectée par `isSingleSize`. Un en-tête doit pourtant toujours porter
    // autant de libellés que les lignes de données ont de colonnes de valeurs — sinon la
    // table resérialisée est malformée (bug picture-ornament-fr-047559ed, canon 0,979 : en-tête
    // à 0 libellé pour des lignes à 1 valeur). On traite donc « aucune taille déclarée » comme
    // le cas mono-taille (même repli générique « valeur »), et on dimensionne ce repli sur le
    // nombre RÉEL de colonnes de la ligne émise (au moins 1 : la ligne a toujours au moins la
    // colonne `label`, cf. gabarit de ligne juste en dessous, même quand `values` est vide).
    // Volontairement restreint à `sizeLabels.length === 0` (jamais à un désaccord de compte
    // dans le cas multi-tailles) : `sizeLabels` porte les VRAIS libellés (S/M/L…) saisis par la
    // travailleuse, qui ne doivent jamais être remplacés par un placeholder — cf. le commentaire
    // plus bas, RIEN DE CE QUE LA TRAVAILLEUSE A SAISI NE DOIT DISPARAÎTRE.
    const dataCols = Math.max(1, ...flat.sizeTable.map((r) => (r.values || []).length))
    const labels = isSingleSize(sizeLabels) || sizeLabels.length === 0
      ? Array.from({ length: dataCols }, () => 'valeur')
      : sizeLabels
    const header = ['mesure', ...labels]
    out.push(`## Tailles {${REF_TO_EN.tailles}}`, '', `| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`)
    for (const r of flat.sizeTable) out.push(`| ${cell(r.label)} | ${(r.values || []).map(cell).join(' | ')} |`)
    out.push('')
  }
  return out.length ? out.join('\n') + '\n' : ''
}

// Exportés pour le rendu des tableaux en vue enrichie : `md-line-type.js`
// et `cm-editor.js` doivent avoir EXACTEMENT la même notion de « rangée de tableau »
// que le parseur ci-dessous. Deux jeux de regex pour la même syntaxe divergeraient au
// premier ajustement, et la divergence se paierait cher ici : l'éditeur masquerait
// derrière un widget des lignes que `parseReservedBlock` ne reconnaît pas comme une
// table — donc du contenu invisible à l'écran ET perdu au parsing.
export const isTableSep = (l) => /^\|[\s:|-]+\|$/.test(String(l ?? '').trim())
export const isPipeLine = (l) => /^\|.*\|$/.test(String(l ?? '').trim())
export const splitCells = (l) => String(l ?? '').trim().slice(1, -1).split('|').map((x) => x.trim())

// Libellés français des blocs réservés qui peuvent produire du `leftover` :
// les 2 blocs à table (Abréviations/Tailles, corps non tabulaire rétrogradé) ET
// les 5 rubriques hors-table (Fil/Aiguilles/Échantillon/Matériel/Techniques, titre
// réécrit rétrogradé, cf. sauvetage plus bas). Servent aux avertissements de contenu
// non exploitable et au titre de la section de repli qui le recueille (parse.js).
// Prototype nul comme `RESERVED`/`REF_TAG_TO_KEY` ci-dessus : `key` ne peut plus valoir
// `'constructor'` depuis qu'elles sont corrigées, mais une table lue par clé garde ici la
// même défense que ses voisines — la règle du fichier vaut mieux que l'exception.
const KEY_LABELS = Object.assign(Object.create(null), {
  abbr: 'Abréviations',
  sizeTable: 'Tailles',
  yarn: 'Fil',
  needles: 'Aiguilles',
  gauge: 'Échantillon',
  materials: 'Matériel',
  techniques: 'Techniques',
  tips: 'Conseils',
})

export const reservedLabel = (key) => KEY_LABELS[key] || ''

// Rubriques dont le corps est du TEXTE LIBRE (pas une table) : elles alimentent
// directement une clé plate. Ce sont les 6 du menu « Aide mémoire » hors Abréviations
// et Tailles — sujettes au sauvetage de titre réécrit (parseReservedBlock). `tips`
// rejoint `materials`, dont il partage exactement la forme (puces).
const FREE_TEXT_KEYS = new Set(['gauge', 'yarn', 'needles', 'materials', 'techniques', 'tips'])

// SCALAR_TEXT_KEYS (sous-ensemble de FREE_TEXT_KEYS pour gauge/yarn/needles) vit
// désormais dans son propre module feuille scalar-keys.js, partagé par
// reference-merge.js et selection-to-reference.js sans introduire de dépendance
// transitive vers '../reader' (cf. scalar-keys.js).

// RIEN DE CE QUE LA TRAVAILLEUSE A SAISI NE DOIT DISPARAÎTRE (retour d'usage,
// 16/07/2026). Un bloc réservé à table (Tailles/Abréviations) signalait puis
// JETAIT tout ce qui n'était pas une table — « avertir » ne suffit pas, le
// rapport constatait la perte sans l'empêcher. Désormais tout ce qu'un bloc ne
// sait pas exploiter ressort dans `leftover`, que parse.js rétrograde en notes à
// la place du bloc. L'avertissement reste (il est utile), reformulé : il dit ce
// qui se passe réellement (« conservé en notes »), plus « ignorées ».

// Découpe un bloc réservé à table en (1) valeurs exploitables, (2) `leftover` =
// tout le reste, dans l'ordre du document. `accept(cells)` renvoie la valeur à
// retenir, ou `null` si la ligne n'est pas exploitable pour ce bloc (à charge
// pour lui d'avertir : la ligne partira en note).
//
// Détection structurelle de l'en-tête (sémantique Markdown standard) : dans une
// table MD, l'en-tête est la ligne qui précède immédiatement la ligne séparatrice
// `|---|---|`. Aucun filtre lexical sur le libellé de l'en-tête. En-tête et
// séparatrice sont de la mise en forme, jamais du contenu : consommées, donc
// jamais rétrogradées en notes.
function parseTableBlock(lines, accept) {
  const pipeIdx = []
  lines.forEach((l, i) => { if (isPipeLine(l)) pipeIdx.push(i) })
  const consumed = new Set()
  let dataIdx = pipeIdx
  if (pipeIdx.length >= 2 && isTableSep(lines[pipeIdx[1]])) {
    consumed.add(pipeIdx[0])
    consumed.add(pipeIdx[1])
    dataIdx = pipeIdx.slice(2)
  }
  const values = []
  for (const i of dataIdx) {
    if (isTableSep(lines[i])) { consumed.add(i); continue }
    const v = accept(splitCells(lines[i]))
    if (v == null) continue
    values.push(v)
    consumed.add(i)
  }
  const leftover = lines.filter((l, i) => !consumed.has(i) && l.trim() !== '').map((l) => l.trim())
  return { values, leftover }
}

// Avertissement de bloc, pour les lignes qui ne ressemblent même pas à une table.
// Les lignes de table rejetées, elles, ont déjà leur avertissement précis (émis
// par `accept`) : pas de doublon.
function warnLeftoverLines(key, leftover, warnings) {
  if (leftover.some((l) => !isPipeLine(l))) {
    warnings.push(W(WARNING_CODES.BLOCK_NOT_A_TABLE, { blockKey: key }))
  }
}

// Le titre d'un bloc de référence est normalement un simple intitulé de rubrique
// (« Tailles », « Abréviations ») : on ne le conserve pas, il est porté par la
// rubrique. MAIS quand la travailleuse étiquette une LIGNE de son patron avec une
// catégorie de l'aide-mémoire, l'éditeur la réécrit en `## <sa ligne> {measurements}`
// (md-retag.js) : le titre EST son texte. Si le bloc n'a rien produit
// d'exploitable, ce titre est donc du contenu, et il doit survivre — on le
// rétrograde en note (en tête du leftover, sa place dans le document) au lieu de
// le jeter en silence.
//
// Réservé aux blocs à table (Tailles/Abréviations). Les 6 rubriques hors-table
// (Fil, Aiguilles, Échantillon, Matériel, Conseils, Techniques) ne passent PAS par ici :
// leur corps est du texte libre (`produced` y serait vrai dès la moindre ligne, le
// titre s'y perdrait quand même). Elles ont leur PROPRE sauvetage, en amont dans
// parseReservedBlock (garde FREE_TEXT_KEYS) : titre non réservé ⇒ bloc entier
// (titre + corps happé) rétrogradé en notes, sans rien verser à la rubrique.
//
// Limite assumée : un titre personnalisé sur un bloc qui produit BIEN une table
// (`## Mes mesures {measurements}` + table valide) reste écarté, comme avant —
// c'est alors un intitulé, pas une ligne de patron.
function rescueTitle(ref, key, title, leftover, warnings) {
  const produced = Object.values(ref).some((v) => (Array.isArray(v) ? v.length : Boolean(v)))
  const bare = String(title ?? '').trim()
  if (produced || !bare || reservedKey(bare) === key) return leftover
  warnings.push(W(WARNING_CODES.BLOCK_UNRECOGNIZED_LINE, { blockKey: key, line: bare }))
  return [bare, ...leftover]
}

export function parseReservedBlock(key, lines, { n = 0, warnings = [], title = '' } = {}) {
  // `leftover` n'est présent que s'il y a réellement du contenu à sauver : la
  // forme plate d'un bloc bien formé reste inchangée (aucune clé parasite dans
  // `flat`, cf. parse.js).
  const done = (ref, leftover = []) => {
    const kept = rescueTitle(ref, key, title, leftover, warnings)
    return kept.length ? { ...ref, leftover: kept } : ref
  }

  // RUBRIQUES HORS-TABLE (gauge/yarn/needles/materials/tips/techniques) : leur corps est
  // du texte libre qui alimente la rubrique — il n'était donc PAS détruit. Le bug
  // (retour d'usage 16/07/2026) est le TITRE réécrit : « Aide mémoire > Fil » réécrit
  // chaque ligne sélectionnée en `## <la ligne> {yarn}` — la ligne DEVIENT le titre
  // (corps vide), et ce titre était jeté EN SILENCE ; pire, une ligne de travail
  // voisine happée par le corps finissait aspirée dans la rubrique. Quand le titre
  // n'est pas le libellé réservé attendu (« Fil », « Aiguilles »…), ce bloc n'est
  // PAS une vraie rubrique mais une ligne d'instruction requalifiée : on rétrograde
  // le bloc ENTIER (titre + tout corps happé) en `leftover` (que parse.js met en
  // notes), sans rien verser à la rubrique. Le cas nominal (titre réservé) tombe à
  // travers ce garde et alimente sa rubrique sans note ni avertissement.
  const bare = String(title ?? '').trim()
  if (FREE_TEXT_KEYS.has(key) && bare && reservedKey(bare) !== key) {
    warnings.push(W(WARNING_CODES.BLOCK_UNRECOGNIZED_LINE, { blockKey: key, line: bare }))
    return { leftover: [bare, ...lines.map((l) => l.trim()).filter(Boolean)] }
  }

  const text = lines.filter((l) => l.trim() !== '').join('\n')
  if (key === 'gauge') return { gauge: text }
  if (key === 'yarn') return { yarn: text }
  if (key === 'needles') return { needles: text }
  if (key === 'materials') return { materials: lines.map((l) => l.replace(/^\s*-\s+/, '').trim()).filter(Boolean) }
  // Bloc Conseils : même forme (puces) que matériel juste au-dessus.
  if (key === 'tips') return { tips: lines.map((l) => l.replace(/^\s*-\s+/, '').trim()).filter(Boolean) }
  if (key === 'techniques') {
    const techniques = []
    for (const l of lines) {
      const h = /^###\s+(.+)$/.exec(l.trim())
      if (h) techniques.push({ title: h[1], body: '' })
      else if (l.trim() && techniques.length) {
        const t = techniques[techniques.length - 1]
        t.body = t.body ? `${t.body}\n${l.trim()}` : l.trim()
      }
    }
    return { techniques }
  }
  if (key === 'abbr') {
    const { values, leftover } = parseTableBlock(lines, (cells) => {
      if (cells.length >= 2) return { key: cells[0], def: cells[1] }
      warnings.push(W(WARNING_CODES.ABBR_NO_DEFINITION, { line: cells.join(' ') }))
      return null
    })
    warnLeftoverLines('abbr', leftover, warnings)
    return done({ abbr: values }, leftover)
  }
  if (key === 'sizeTable') {
    const { values, leftover } = parseTableBlock(lines, (cells) => {
      const [label, ...vals] = cells
      if (n && vals.length !== n) {
        warnings.push(W(WARNING_CODES.SIZES_COUNT_MISMATCH, { label, got: vals.length, expected: n }))
        return null
      }
      return { label, values: vals }
    })
    warnLeftoverLines('sizeTable', leftover, warnings)
    return done({ sizeTable: values }, leftover)
  }
  return {}
}

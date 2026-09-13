// Lecture d'un glossaire mis en page en deux colonnes SANS séparateur — sur
// deux patrons Hobbii / Go handmade, le glossaire est un vrai tableau à deux
// colonnes (« m » à x=48, « Maille(s) » à x=102 ; 12 entrées alignées au point
// près sur crossbody, 8 sur star-stitch) mais aucun caractère (`=`, `:`, tiret)
// ne sépare la clé de sa définition. Tous les détecteurs existants exigent un
// tel séparateur, donc aucun ne le lit — et l'étape de reflow, qui tourne
// AVANT extractReference, agglutine les entrées en un seul pavé de prose,
// détruisant toute chance de les retrouver après coup. D'où une lecture
// géométrique, faite avant le reflow, à partir de l'abscisse (`parts[].x`)
// posée par itemsToLines. Volontairement stricte : sans alignement
// de colonne franc (≥3 lignes, même abscisse à 1pt près), on ne tente rien et
// on rend null — décision produit : un faux
// glossaire est pire qu'un glossaire manquant.
//
// Module pur : ne mute aucune ligne reçue. L'appelant est
// responsable de marquer `consumed` sur les lignes retournées.

const SAME_X = 1 // tolérance d'alignement (pt)
const MAX_KEY_LEN = 40 // au-delà, ce n'est plus une clé de glossaire mais de la prose
const MIN_COLUMN_VOTES = 3 // point 3 : sous ce compte, la colonne candidate est jugée fortuite
// Correctif B (mesure de la campagne finale, brain-waves-beanie-no + 5-Cozy-Crochet-…-eBook) :
// un compte ABSOLU de votes ne suffit pas — sur une liste à une seule colonne dont les clés
// ont des longueurs variables (« R1: », « SAME: », « JOIN: »…), 3-4 lignes peuvent voter PAR
// HASARD pour la même abscisse (l'espace ou le début de texte qui suit une clé de longueur
// voisine tombe au même endroit à 1pt près), sans qu'il y ait de vraie table à 2 colonnes.
// Sur les 2 vrais glossaires en colonnes mesurés (crossbody 12/16 lignes ancrées à gauche,
// star-stitch 8/8), la bonne colonne explique TOUJOURS une large majorité des lignes ancrées ;
// sur le faux positif (brain-waves), la meilleure colonne fortuite n'en explique qu'un quart.
// Conjonction AND supplémentaire (comme le correctif A) : ne peut que RETIRER des colonnes
// acceptées à tort, jamais en accepter de nouvelles — la pire régression possible est un
// retour à `null` (glossaire non lu), jamais un pire découpage.
// V2a : ce seuil se juge PAR ANCRE, sur les lignes ancrées à CETTE ancre —
// cf. le commentaire de computeColumnX (le piège du dénominateur global).
const MIN_COLUMN_COVERAGE = 0.5 // la colonne gagnante doit expliquer ≥ la moitié des lignes ancrées à SON ancre
// V2a : deux ancres de clés (grilles 2×2 appariées de readPairedGrid)
// ne sont retenues que si elles sont franchement séparées — sous ce seuil, un seul et
// même alignement de marge (loupy réel : ancres 36 et 298, soit 262 pt ; mini-kawaii :
// 20 et 280, soit 260 pt ; les vraies grilles sont toujours larges, la gouttière entre
// les deux paires clé|def dépasse la largeur d'une définition entière).
const MIN_ANCHOR_GAP = 40
const MIN_ENTRIES = 3 // point 5 : sous ce compte, le « glossaire » détecté est jugé fortuit
const SENTENCE_END = /[.!?…)]$/

// Glyphe de liste PDF (puce) — même jeu que lines.js/segment.js, pas de regex maison —
// OU codepoint de zone d'usage privé (U+E000–U+F8FF, jamais du texte réel : Unicode réserve
// cette plage aux polices/usages privés ; un extracteur PDF y tombe quand une police-symbole
// n'a pas de mapping Unicode correct pour son glyphe de puce) OU blanc pur. Correctif B :
// sur brain-waves-beanie-no, la puce de liste est extraite comme un caractère U+F0B7 SEUL —
// non blanc, donc non retiré par `.trim()`, et absent du jeu de puces visibles de lines.js
// (qui exige en plus un `\s+` immédiatement après pour la retirer, cf. lines.js l.274) — un
// morceau `parts[]` à part entière avec une abscisse réelle. Sur 5-Cozy-Crochet-…-eBook, c'est
// la puce visible « • » elle-même, dans son propre morceau, suivie d'un morceau vide à la
// MÊME abscisse que le début de la vraie clé. Dans les deux cas, ce morceau n'est PAS un
// séparateur (x !== null) mais n'est pas non plus du contenu : sans ce filtre, il devient
// tour à tour l'ancre de marge gauche (fausse leftX) et la « clé » de l'entrée émise
// (`|  | R1: Row/Round 1 - … |`, `| • | ch: chain |`).
const DECORATIVE_RE = /^[\s●•◦▪‣⁃∙\u{E000}-\u{F8FF}]*$/u

function normalize(text) {
  return text.replace(/\s{2,}/g, ' ').trim()
}

function startsLower(text) {
  return /^[a-zà-öø-ÿ\-–]/.test(text)
}

// Un morceau porte du contenu réel : abscisse posée (x !== null, donc pas un séparateur de
// recollage) ET texte non entièrement décoratif (pas une puce seule, pas un blanc pur).
function isRealPart(part) {
  return part.x !== null && !DECORATIVE_RE.test(part.text)
}

// Index du premier morceau à contenu réel d'une ligne, ou -1.
function firstRealIndex(parts) {
  for (let i = 0; i < parts.length; i++) {
    if (isRealPart(parts[i])) return i
  }
  return -1
}

// Premier morceau à contenu réel d'une ligne, ou null.
function firstRealPart(parts) {
  const i = firstRealIndex(parts)
  return i === -1 ? null : parts[i]
}

// Ancres de clés : le — ou les DEUX — x les plus fréquents parmi les premiers morceaux
// réels des lignes à `parts`. V2a : les grilles 2×2 appariées de
// readPairedGrid produisent UN flux unique où chaque rangée Y donne « clé1 def1 »
// PUIS « clé2 def2 » — deux colonnes de CLÉS à lire, chacune avec sa propre colonne de
// définitions (loupy p4 : ancres 36/298 ; mini-kawaii p1 : 20/280). On renvoie donc les
// DEUX x les plus fréquents quand ils sont séparés d'au moins MIN_ANCHOR_GAP, sinon un
// seul (comportement d'avant — un glossaire classique n'a qu'une marge de clés).
// L'ORDRE compte et est conservé TEL QUEL (PAS de tri gauche→droite) : anchors[0] est
// le x le plus fréquent, et readColumnGlossary exige de LUI une colonne valide (null
// sinon, comme avant). Sur meris p16 (contrôle non-régression mesuré), le bucket le
// plus fréquent est la COLONNE DE DÉFINITIONS elle-même (x=132 : les 7 wraps de defs
// y démarrant) et la vraie marge de clés (x=64, 6 clés « m5oo1-B2-S2… » alignées à
// gauche) n'est que 2ᵉ — trier aurait inversé les deux, lu un demi-glossaire là où le
// top-1 d'avant rendait null, et fait diverger le contre-échantillon. Départage à
// égalité par l'ordre d'insertion (déterministe, comme le top-1 d'avant).
function computeLeftX(lines) {
  const counts = new Map()
  for (const line of lines) {
    if (!line.parts || line.parts.length === 0) continue
    const first = firstRealPart(line.parts)
    if (!first) continue
    let bucket = null
    for (const x of counts.keys()) {
      if (Math.abs(x - first.x) <= SAME_X) { bucket = x; break }
    }
    const key = bucket !== null ? bucket : first.x
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  let best = null
  let bestCount = -1
  for (const [x, count] of counts) {
    if (count > bestCount) { best = x; bestCount = count }
  }
  if (best === null) return null
  // 2ᵉ ancre : le bucket le plus fréquent APRÈS le premier, à ≥ MIN_ANCHOR_GAP de lui.
  let second = null
  let secondCount = -1
  for (const [x, count] of counts) {
    if (Math.abs(x - best) < MIN_ANCHOR_GAP) continue
    if (count > secondCount) { second = x; secondCount = count }
  }
  if (second === null) return [best]
  return [best, second]
}

// Colonne candidate X : abscisse (hors premier morceau de la ligne) qui revient
// le plus souvent sur les lignes démarrant à leftX, en ne comptant que les cas
// où le texte avant ce morceau est non vide et fait ≤ MAX_KEY_LEN caractères.
// Chaque morceau (hors le premier) de chaque ligne est un candidat distinct :
// une ligne peut ainsi voter pour plusieurs colonnes (ex. un caractère d'espace
// à x réel intercalé avant la vraie colonne des définitions), mais au plus une
// fois par colonne.
function computeColumnX(lines, leftX) {
  const counts = new Map()
  // Dénominateur de la garde de couverture : les lignes ancrées à leftX, CETTE ancre —
  // PAS le total des lignes. V2a (LE piège de la vague) : dans le flux
  // alterné 50/50 d'une grille 2×2 (une ligne « clé1 def1 », une ligne « clé2 def2 »),
  // chaque ancre ne voit que la MOITIÉ des lignes du glossaire — un dénominateur global
  // tuerait systématiquement la 2ᵉ colonne (6 votes / 13 lignes < 0,5 alors que la
  // colonne explique 100 % de SES lignes ancrées). Test dédié : grille alternée 50/50,
  // les DEUX ancres doivent produire leurs entrées.
  let candidateLines = 0
  function bucket(x) {
    for (const k of counts.keys()) {
      if (Math.abs(k - x) <= SAME_X) return k
    }
    return x
  }
  for (const line of lines) {
    if (!line.parts || line.parts.length === 0) continue
    const firstIdx = firstRealIndex(line.parts)
    if (firstIdx === -1) continue
    const first = line.parts[firstIdx]
    if (Math.abs(first.x - leftX) > SAME_X) continue
    candidateLines++
    let beforeText = ''
    for (let i = 0; i <= firstIdx; i++) beforeText += line.parts[i].text
    const votedThisLine = new Set()
    for (let i = firstIdx + 1; i < line.parts.length; i++) {
      const p = line.parts[i]
      if (isRealPart(p)) {
        const before = normalize(beforeText)
        if (before.length > 0 && before.length <= MAX_KEY_LEN) {
          const key = bucket(p.x)
          if (!votedThisLine.has(key)) {
            counts.set(key, (counts.get(key) || 0) + 1)
            votedThisLine.add(key)
          }
        }
      }
      beforeText += p.text
    }
  }
  let best = null
  let bestCount = -1
  for (const [x, count] of counts) {
    if (count > bestCount) { best = x; bestCount = count }
  }
  if (best === null) return null
  if (!(best > leftX + 2)) return null
  if (bestCount < MIN_COLUMN_VOTES) return null
  if (bestCount < candidateLines * MIN_COLUMN_COVERAGE) return null
  return best
}

export function readColumnGlossary(lines) {
  const withParts = lines.filter((l) => l.parts && l.parts.length > 0)
  if (withParts.length === 0) return null

  // Ancres de clés : une (glossaire classique) ou deux (grille 2×2 appariée).
  // anchors[0] = la plus FRÉQUENTE (ordre conservé par computeLeftX) : sans colonne
  // valide pour elle → null, exactement comme avant (non-régression : un glossaire
  // monocolonne ne doit pas se mettre à réussir par la seule 2ᵉ ancre — cf. meris p16,
  // contre-échantillon mesuré) ; la 2ᵉ n'est admise que si ELLE aussi porte une colonne
  // — sinon elle est laissée tombée et ses lignes partent en notes, comme avant (chaque
  // garde de computeColumnX — votes ≥ 3, couverture PAR ANCRE ≥ 0,5 — se juge
  // indépendamment sur SES lignes).
  const anchors = computeLeftX(lines)
  if (anchors === null) return null

  const firstColumnX = computeColumnX(lines, anchors[0])
  if (firstColumnX === null) return null
  const anchorColumns = [{ leftX: anchors[0], columnX: firstColumnX }]
  if (anchors.length > 1) {
    const secondColumnX = computeColumnX(lines, anchors[1])
    if (secondColumnX !== null) anchorColumns.push({ leftX: anchors[1], columnX: secondColumnX })
  }

  const entries = []
  const notes = []
  // Suit la DERNIÈRE CHOSE ÉMISE, tous types confondus (entrée ou note) — cette
  // règle se distingue volontairement de celle
  // d'`appendNote`, qui ne regarde que la dernière NOTE. Une note intercalée
  // entre une entrée inachevée et sa continuation doit empêcher le recollage
  // à cette entrée : sans ce suivi, `entries[entries.length - 1]` regarderait
  // à tort « la dernière entrée jamais créée » et ignorerait la note.
  let lastEmission = null

  const emitEntry = (entry) => {
    entries.push(entry)
    lastEmission = { type: 'entry', entry }
  }
  const emitNote = (text) => {
    appendNote(notes, text)
    lastEmission = { type: 'note' }
  }

  for (const line of lines) {
    const parts = line.parts
    if (!parts || parts.length === 0) {
      emitNote(line.text)
      continue
    }
    const firstIdx = firstRealIndex(parts)
    if (firstIdx === -1) {
      emitNote(line.text)
      continue
    }
    const first = parts[firstIdx]

    // Entrée : ligne ancrée à UNE des ancres (au plus une peut matcher — elles sont à
    // ≥ MIN_ANCHOR_GAP l'une de l'autre), coupée à LA colonne de définitions de cette
    // ancre. Découpe à partir de `firstIdx`, jamais de 0 : un morceau décoratif avant
    // (puce, blanc) ne doit jamais fuiter dans la clé émise.
    const anchor = anchorColumns.find((p) => Math.abs(first.x - p.leftX) <= SAME_X)
    if (anchor) {
      let splitIdx = -1
      for (let i = firstIdx + 1; i < parts.length; i++) {
        const p = parts[i]
        if (!isRealPart(p)) continue
        if (Math.abs(p.x - anchor.columnX) <= SAME_X) { splitIdx = i; break }
      }
      if (splitIdx >= 0) {
        const keyText = normalize(parts.slice(firstIdx, splitIdx).map((p) => p.text).join(''))
        const defText = normalize(parts.slice(splitIdx).map((p) => p.text).join(''))
        if (keyText.length > 0) {
          emitEntry({ key: keyText, def: defText })
          continue
        }
      }
      // premier morceau à une ancre mais pas de colonne trouvée → note.
      emitNote(line.text)
      continue
    }

    // Continuation de définition : ligne démarrant dans l'une des colonnes de
    // définitions — règle inchangée sur la DERNIÈRE chose émise (cf. lastEmission).
    if (anchorColumns.some((p) => Math.abs(first.x - p.columnX) <= SAME_X)) {
      if (lastEmission && lastEmission.type === 'entry' && !SENTENCE_END.test(lastEmission.entry.def)) {
        lastEmission.entry.def = normalize(`${lastEmission.entry.def} ${line.text}`)
      } else {
        emitNote(line.text)
      }
      continue
    }

    emitNote(line.text)
  }

  if (entries.length < MIN_ENTRIES) return null

  return { entries, notes, consumed: lines }
}

function appendNote(notes, text) {
  const norm = normalize(text)
  const last = notes.length > 0 ? notes[notes.length - 1] : null
  if (last !== null && !SENTENCE_END.test(last) && startsLower(norm)) {
    notes[notes.length - 1] = normalize(`${last} ${norm}`)
  } else {
    notes.push(norm)
  }
}

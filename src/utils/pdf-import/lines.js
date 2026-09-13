// Fragments pdfjs → lignes typées { text, size, bold, y }. Fork v2 : conscient de
// l'axe X — les cellules d'une même ligne visuelle sont séparées aux grands sauts
// horizontaux, et les pages à DEUX COLONNES (pages de garde Hobbii) sont remises
// en ordre de lecture (colonne gauche entière, puis colonne droite) au lieu de
// mélanger les deux colonnes dans les mêmes lignes.

const Y_TOL = 2.5 // tolérance verticale de regroupement (héritée de l'app)
const X_GAP = 18 // saut horizontal (pt) qui sépare deux cellules d'une même ligne
const COL_X = 0.42 // frontière relative gauche/droite candidate
const GUTTER_MIN = 6 // largeur minimale (pt) d'un couloir vide pour être une gouttière
// Nombre max. de rangées Y distinctes, DANS UNE SEULE bande extrême (haut OU bas), à
// considérer comme du chrome isolé (pied/en-tête de page) plutôt qu'un vrai paragraphe qui
// y tomberait par coïncidence. Un pied de page tient sur 1 rangée (cf. spanningCandidates
// ci-dessous) ; un vrai paragraphe de plusieurs lignes consécutives ne doit jamais être
// confondu avec ça, quelle que soit sa position sur la page.
const MAX_CHROME_ROWS_PER_BAND = 1

// Suffixe ordinal en exposant (« 3ème », « 1er »…) : Hobbii FR compose le chiffre en
// corps normal puis la lettre finale en EXPOSANT — glyphe distinct, rehaussé au-dessus
// de la ligne de base ET dessiné dans un corps plus petit. Cas réel mesuré (compass-
// rose-north-granny-square-fr) : « …dans 3 » (y=689.12, h=10) / « ème » (y=693.61,
// h=6) / « ml de chd. » (y=689.12, h=10) — ratio de corps 6/10 = 0.6, décalage vertical
// 4.49 pt (soit 0.45× le corps de la rangée), contre un interligne réel de 13.618 pt sur
// ce même PDF (1.36× le corps). Le décalage dépasse Y_TOL (2.5) et casse le regroupement
// en 3 rangées au lieu d'une seule. Résultat observé avant correctif : « ème » devient une
// rangée à part, promue en puce autonome au milieu des rangs (ou happée au milieu d'une
// phrase par reflow.js), et le chiffre perd son suffixe (« 3 » au lieu de « 3ème »).
// Bornes choisies pour rester DISTINCTES d'un vrai saut de ligne, avec une marge
// confortable au-dessus du cas mesuré SANS s'approcher du régime « vraie ligne suivante » :
// corps nettement plus petit (ratio ≤ 0.7, mesuré 0.6) et décalage vertical ≤ 0.6× le corps
// de la rangée (mesuré 0.45, contre 1.36 pour un vrai interligne) — aucune des deux bornes
// ne risque donc d'avaler une ligne suivante légitime, même petite.
const SUPERSCRIPT_SIZE_RATIO = 0.7
const SUPERSCRIPT_Y_OFFSET_RATIO = 0.6

// Exclut les bandes Y extrêmes (en-tête/pied de page) d'un ensemble de cellules — même
// bande 6%-94% que detectColumnGutter ci-dessous, extraite en fonction partagée. Sans
// cela, une ligne de pied de page pleine largeur (« Hobbii.de - Copyright © … » recollée
// avec « seite 1 » via X_GAP, cf. crochet-cotton-makeup-pads-de-921e621a) ponte le seuil
// x < bound / endX > 60%×pageWidth de la voie bimodale (twoCols ci-dessous) exactement
// comme un vrai paragraphe qui enjambe les 2 colonnes — alors que ce n'est qu'un artefact
// de bas de page, présent sur QUASIMENT CHAQUE page Hobbii, qui n'a rien à voir avec la
// mise en page à colonnes du CORPS de la page. Sur ce PDF réel (page 1, 18 cellules après
// dédup), ce seul pied de page suffisait à faire passer `spanning` de 1 (le titre centré,
// bandeau légitime) à 2 — au-dessus du seuil `spanning.length <= 0.1 * filled.length`
// (1.8) — et donc à garder toute la page en lecture mono-flux : la rangée « − Häkelnadel
// Nr. 4 » (bloc Matériel, colonne gauche) et « Lftm: Luftmasche(n) » (glossaire
// Abkürzungen, colonne droite) tombaient à 2.28pt d'écart en Y (sous Y_TOL=2.5, par pur
// hasard de mise en page) et se recollaient en une seule ligne dans `toLines` — perdant
// la taille d'aiguille ET fusionnant deux entrées de glossaire en une puce illisible.
function excludeExtremeBands(cells) {
  if (!cells || cells.length < 2) return cells || []
  const ys = cells.map((c) => c.y)
  const ymin = Math.min(...ys)
  const range = (Math.max(...ys) - ymin) || 1
  return cells.filter((c) => c.y > ymin + 0.06 * range && c.y < ymin + 0.94 * range)
}

// Cellules candidates au veto anti-2-colonnes (twoCols ci-dessous, voie bimodale) : celles
// qui « enjambent » les 2 colonnes (x < bound ET endX > 60%×pageWidth). Un pied/en-tête de
// page pleine largeur ne doit pas compter dans ce veto (cf. excludeExtremeBands) — mais
// PAS en excluant toute cellule de la bande Y extrême sans distinction : angle mort trouvé
// en revue (correctif crochet-cotton-makeup-pads-de-921e621a) — un vrai paragraphe
// légitime de plusieurs rangées peut tomber, par pure coïncidence de mise en page, dans
// cette même bande (proche du haut/bas du RANGE Y observé sur la page, pas nécessairement
// du bord physique de la feuille). Sur une page où detectColumnGutter échoue par ailleurs
// (couloir bloqué en milieu de page — le mécanisme même du bug corrigé ici), perdre la
// preuve `spanning` de ce paragraphe fait basculer à tort une page mono-colonne en
// 2-colonnes, détachant des étiquettes de leurs valeurs. Discriminant : un pied/en-tête
// réel tient sur UNE SEULE rangée Y (cf. le pied Hobbii mesuré, une cellule unique après
// fusion X_GAP) ; un vrai paragraphe en occupe PLUSIEURS, consécutives. On n'exclut donc
// une bande (haut ou bas, indépendamment) que si elle ne contient qu'AU PLUS
// MAX_CHROME_ROWS_PER_BAND rangée parmi les candidats « spanning » eux-mêmes — dès qu'une
// bande en contient davantage, on la garde TOUTE (repli sur le comportement d'avant ce
// correctif : jamais pire que l'existant, seulement moins d'occasions d'améliorer).
function spanningCandidates(filled, bound, pageWidth) {
  const all = filled.filter((c) => c.x < bound && c.endX > pageWidth * 0.6)
  // Garde-fou trouvé en revue (round 2) : `< 2` court-circuitait la discrimination
  // bande/rangée dès qu'il n'y avait qu'UN SEUL candidat — exactement la signature d'un
  // pied de page isolé que cette fonction doit exclure (cf. commentaire ci-dessus). Avec
  // `all.length === 1`, l'ancien code renvoyait ce candidat SANS jamais vérifier s'il
  // tombait en bande extrême, le gardant à tort dans `spanning` et empêchant twoCols de
  // basculer à raison en 2-colonnes. Mesuré sur 6/200 patrons Hobbii réels
  // (miramare-socks-fr, ladies-pullover-s9404-fr, estense-hat-and-scarf-fr,
  // ducale-socks-fr, venetien-shawl-fr, kemijoki-ornaments-silk-fr) : sur
  // ladies-pullover-s9404-fr, deux blocs indépendants de page de garde fusionnaient à
  // tort. Seul `all.length === 0` (aucun candidat du tout) doit court-circuiter : rien à
  // discriminer, et `Math.min/max` sur un tableau vide renverrait Infinity/-Infinity.
  if (all.length === 0) return all
  const ys = filled.map((c) => c.y)
  const ymin = Math.min(...ys)
  const range = (Math.max(...ys) - ymin) || 1
  const loBound = ymin + 0.06 * range
  const hiBound = ymin + 0.94 * range
  const inTop = (c) => c.y >= hiBound
  const inBottom = (c) => c.y <= loBound
  const topRows = new Set(all.filter(inTop).map((c) => c.y))
  const bottomRows = new Set(all.filter(inBottom).map((c) => c.y))
  return all.filter((c) => {
    if (inTop(c) && topRows.size <= MAX_CHROME_ROWS_PER_BAND) return false
    if (inBottom(c) && bottomRows.size <= MAX_CHROME_ROWS_PER_BAND) return false
    return true
  })
}

// Cherche une gouttière verticale — couloir d'abscisses vide séparant deux flux de
// texte présents SUR LES MÊMES rangées (entrelacés par Y). Renvoie l'abscisse de
// coupe (pt) ou null. Robuste aux colonnes de largeurs inégales et aux légendes
// courtes intercalées (là où la bimodalité globale échoue). Les en-têtes/pieds de
// page (bandes Y extrêmes) et les cellules pleine largeur (paragraphes, pieds
// traversant la gouttière) sont exclus du calcul d'occupation.
function detectColumnGutter(filled, pageWidth) {
  if (!filled || filled.length < 6) return null
  const body = excludeExtremeBands(filled)
  const narrow = body.filter((c) => c.endX - c.x < 0.55 * pageWidth)
  if (narrow.length < 6) return null
  const lo = Math.floor(0.28 * pageWidth)
  const hi = Math.ceil(0.72 * pageWidth)
  const cov = new Uint8Array(Math.ceil(pageWidth) + 2)
  for (const c of narrow) {
    const a = Math.max(0, Math.floor(c.x))
    const b = Math.min(cov.length - 1, Math.ceil(c.endX))
    for (let x = a; x <= b; x++) cov[x] = 1
  }
  const runs = []
  let start = null
  for (let x = lo; x <= hi + 1; x++) {
    if (x <= hi && !cov[x]) { if (start == null) start = x } else {
      if (start != null) { if (x - start >= GUTTER_MIN) runs.push([start, x - 1]); start = null }
    }
  }
  let best = null
  for (const [a, b] of runs) {
    const mid = (a + b) / 2
    const left = narrow.filter((c) => c.endX <= mid)
    const right = narrow.filter((c) => c.x >= mid)
    if (left.length < 3 || right.length < 2) continue
    // Entrelacement : au moins 2 rangées Y portant À LA FOIS une cellule gauche et
    // droite (deux vraies colonnes lues en parallèle, pas un simple retrait ponctuel).
    let inter = 0
    for (const lc of left) if (right.some((rc) => Math.abs(rc.y - lc.y) <= Y_TOL)) inter++
    if (inter < 2) continue
    const cand = { mid, len: b - a + 1, inter }
    if (!best || cand.inter > best.inter || (cand.inter === best.inter && cand.len > best.len)) best = cand
  }
  return best ? best.mid : null
}

const MIN_COL_CELLS = 3    // cellules mini pour qu'un mode de x soit une colonne
const CLUSTER_GAP = 40     // écart mini (pt) entre x-début de 2 colonnes distinctes
const MIN_COL_WIDTH = 60   // largeur mini d'une colonne (garde anti sur-découpage)
const MIN_SHARED_ROWS = 2  // rangées mini qu'une colonne candidate doit partager avec une
                            // AUTRE colonne pour être retenue (élague les étiquettes isolées)

// Cellule = étiquette de diagramme probable (axe de rangs d'un schéma tricot, cote isolée :
// « 50 », « 27-28 ») : uniquement chiffres/tirets/espaces/virgules, jamais une lettre — une
// consigne réelle n'est jamais RÉDUITE à ça. Exclue du calcul des modes de colonnes (mais
// pas des cellules finales : colOf() la rattache quand même à une colonne, rien n'est perdu),
// sinon ces étiquettes forment des clusters parasites entre les vraies colonnes de texte.
const isChartLabel = (text) => /^(?:[0-9][0-9.,\-–\s]*|\([0-9.,\-–\s]+\))$/.test(text.trim())
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

// Cellule = résidu de glyphe corrompu (police de symboles sans table ToUnicode, ex. grilles
// crochet Schachenmayr/MEZ) : après retrait des caractères de contrôle Unicode (catégorie
// \p{Cc}), il ne reste RIEN. Vérifié sur le PDF réel ranveig-fr-53fafc7c (glossaire
// Abréviations perdu à 9/9 entrées) : ces glyphes décodent en caractères de contrôle purs
// (ex. code 31, code 30), JAMAIS mélangés à du texte réel dans la même cellule — une
// cellule est soit 100 % contrôle, soit du texte normal. Exclue du calcul des modes de
// colonnes de detectColumns, même principe qu'isChartLabel ci-dessus (exclue du calcul,
// jamais du résultat final : colOf() la rattache quand même à sa colonne, rien n'est
// perdu). Fonction séparée d'isChartLabel (pas fusionnée) : problème conceptuellement
// différent (corruption de police, pas une étiquette numérique de diagramme).
const isGlyphOnly = (text) => text.replace(/\p{Cc}/gu, '').trim().length === 0

// Cellule = jeton court de grille numérique (mesure/comptage de tableau : "56/14",
// "9/10/9", "0x"), alphabet restreint chiffres/x/slash/tiret/virgule/point. Distingue un
// vrai tableau de chiffres d'une vraie prose N-colonnes (cas A, PDF réel
// socks-with-diamond-pattern-r0398-fr) : contrairement à isChartLabel/isGlyphOnly, ne
// filtre pas une cellule individuelle du calcul — sert à classer une COLONNE entière une
// fois les clusters stabilisés (cf. fin de detectColumns ci-dessous).
// Exporté (V2b1) : les gardes de filtres de boilerplate.js (captions) doivent tester le
// MÊME prédicat — jamais une copie locale (piège ROW_START_RE documenté au dépôt).
export const isGridToken = (text) => {
  const t = text.trim()
  return t.length > 0 && t.length <= 12 && /^[0-9][0-9.,/x×\-–\s]*$/i.test(t)
}

// Détecte ≥3 colonnes par les MODES de x-début (là où detectColumnGutter — occupation —
// échoue). Tolérante aux cellules qui PONTENT une gouttière (qui finissent au-delà du
// début d'une colonne suivante sans y écrire dessus) et aux débordements PONCTUELS de
// fin de ligne ; mais un couloir PIÉTINÉ par la gauche sur davantage de rangées que sa
// colonne n'en occupe prouve que cette « colonne » est un sous-bloc indenté dans le flux
// de la première → colonne écartée par la garde « chevauchement » (ratio d'occupation,
// boucle d'élagage ci-dessous). Cas réels mesurés au sweep 3122 PDF (04/09) : Cortina
// sweater p.2 — 26 rangées piétinées vs 4 occupées → « colonne » 377 écartée (liste de
// fils indentée DANS la colonne 305, la cellule « PUS 70 % baby alpaca… » x=305
// endX≈540 traverse 377+18) ; stanley-the-knitting-bear p.6 — 3 traversantes vs ~10
// rangées occupées → vraie 3-colonnes conservée. Renvoie les x représentatifs (triés)
// ou null si <3 colonnes fiables + entrelacées par Y. Utilisée uniquement en complément
// de detectColumnGutter/bimodalité (2 colonnes), qui restent inchangés : cette fonction
// ne s'emprunte que si elle trouve STRICTEMENT ≥3 modes.
function detectColumns(filled, pageWidth) {
  if (!filled || filled.length < 8) return null
  const ys = filled.map((c) => c.y)
  const ymin = Math.min(...ys)
  const range = (Math.max(...ys) - ymin) || 1
  // La bande 6%-94% exclut la rangée strictement extrême (en-tête/pied de page) — sur une
  // vraie page (dizaines de rangées) elle n'ampute qu'une poignée de cellules ; sur un
  // échantillon à très peu de rangées (tests), elle exclurait le corps entier : dans ce
  // cas on retombe sur toutes les cellules (pas de bande à retirer).
  const trimmed = filled.filter((c) => c.y > ymin + 0.06 * range && c.y < ymin + 0.94 * range)
  const body = trimmed.length >= 8 ? trimmed : filled
  const narrow = body.filter((c) => c.endX - c.x < 0.55 * pageWidth)
  if (narrow.length < 8) return null
  const textNarrow = narrow.filter((c) => !isChartLabel(c.text) && !isGlyphOnly(c.text))
  if (textNarrow.length < 8) return null
  const xs = textNarrow.map((c) => c.x).sort((a, b) => a - b)
  const clusters = []
  for (const x of xs) {
    const last = clusters[clusters.length - 1]
    if (last && x - last.max <= CLUSTER_GAP) { last.max = x; last.list.push(x) }
    else clusters.push({ max: x, list: [x] })
  }
  // Fusionne les clusters adjacents trop proches (médiane à médiane < MIN_COL_WIDTH) au lieu
  // de faire échouer toute la détection : une légende courte collée à une vraie colonne (ex.
  // motif du point employé) est absorbée dedans — elle finira en fin de flux Y de cette
  // colonne, jamais perdue, jamais cousue avec une AUTRE colonne.
  let merged = true
  while (merged) {
    merged = false
    for (let i = 1; i < clusters.length; i++) {
      if (median(clusters[i].list) - median(clusters[i - 1].list) < MIN_COL_WIDTH) {
        clusters[i - 1].list = clusters[i - 1].list.concat(clusters[i].list)
        clusters.splice(i, 1)
        merged = true
        break
      }
    }
  }
  let cols = clusters.filter((c) => c.list.length >= MIN_COL_CELLS).map((c) => median(c.list))
  if (cols.length < 3) return null

  const colOf = (x, list) => { let k = 0; for (let i = 0; i < list.length; i++) if (x >= list[i] - CLUSTER_GAP) k = i; return k }
  // Élague les colonnes candidates par deux gardes qui itèrent ensemble jusqu'à stabilité
  // (retirer une colonne reclasse toutes les votantes via colOf : chaque retrait doit être
  // ré-examiné par l'autre garde — retirer une colonne peut faire retomber une autre sous
  // le seuil de partage, ou défausser/révéler un chevauchement).
  let changed = true
  while (changed && cols.length >= 3) {
    changed = false
    // Garde « chevauchement » (première testée ; v2 ratio d'occupation, durcie le 04/09
    // au sweep corpus 3122 PDF) : une vraie colonne POSSÈDE son couloir — une vraie mise
    // en page n'écrit jamais sur la colonne suivante ; les débordements n'y sont que
    // PONCTUELS, fins de lignes irrégulières (mesuré stanley-the-knitting-bear p.6 : 3
    // traversantes de col0 vers col1 pour ~10 rangées occupées par la cible ; idem
    // dottie-beanie p.6, 3 traversantes vers la colonne 294). Un sous-bloc indenté, lui,
    // PARTAGE le couloir de sa colonne parente : mesuré Cortina sweater p.2, 26 rangées
    // de la colonne 305 traversent la « colonne » 377, qui n'occupe que 4 rangées à
    // elle — la « colonne » 377 n'est que la liste de fils indentée DANS le flux de 305
    // (4 cellules « 8 (9) 10 (11) balls », « 2 (2) 3 (3) balls », « Mottled Anthracite
    // 4010 », « Off-White 4001 » ; la preuve du partage : la cellule « PUS 70 % baby
    // alpaca, 17 % acrylic, 13 % polyamide, » x=305 endX≈540 traverse 377+18). Le
    // discriminant n'est donc PAS « une cellule déborde » (v1 quorum-1 : sweep = 108
    // fichiers changés, dont les régressions stanley/dottie — colonnes fusionnées rangée
    // par rangée, texte mélangé) mais le RATIO D'OCCUPATION DU COULOIR, raisonné en
    // ENSEMBLES de rangées dédupliquées (clés Math.round(y/Y_TOL), jamais en comptes de
    // cellules) : pour chaque colonne candidate B (j≥1), rows(B) = rangées des votantes
    // classées dans B, trav(B) = rangées des votantes classées PLUS À GAUCHE (k<j)
    // dont endX dépasse cols[j]+X_GAP ; B est écrasée si |trav(B)| > |rows(B)| — le
    // couloir est piétiné par la gauche sur davantage de rangées que B n'en occupe :
    // B n'est pas un flux qui possède sa bande, c'est un sous-bloc dans le flux de
    // gauche (Cortina : 26 > 4 → écrasée ; stanley : 3 ≤ 10 → conservée). À ÉGALITÉ on
    // conserve (prudence : l'égalité n'a jamais été mesurée sur un sous-bloc — un
    // sous-bloc vit DANS le flux de sa parente, la parente y déborde sur la plupart de
    // SES rangées, l'écart est franc). On invalide la colonne ÉCRASÉE (la plus à gauche
    // des écrasées, une par tour puis on relaisse la boucle itérer — un retrait
    // reclasse les votantes, cette garde et la garde solitaire convergent ensemble),
    // JAMAIS la colonne qui déborde. Votantes = textNarrow uniquement, PAS body/filled
    // : un titre pleine largeur partant de la colonne A piétinerait toutes les colonnes
    // suivantes d'une vraie page 3-colonnes (une telle cellule est en pratique WIDE,
    // hors narrow, donc non votante — mais la garde ratio absorbe de toute façon les
    // débordements ponctuels restants). Trade-off assumé (testé) : une vraie 3-colonnes
    // dont la gauche piétine le couloir de la cible sur STRICTEMENT plus de rangées que
    // la cible n'en occupe perd sa détection — dégradation de l'ORDRE de lecture (retour
    // 2-colonnes/mono), jamais de perte de contenu : après retrait, les cellules de la
    // colonne écartée sont reclassées dans la colonne parente par colOf (no-loss, même
    // mécanisme documenté pour isChartLabel).
    const occupied = cols.map(() => new Set()) // rangées où chaque colonne a des votantes
    const trampled = cols.map(() => new Set()) // rangées où chaque colonne est piétinée depuis la gauche
    for (const c of textNarrow) {
      const k = colOf(c.x, cols)
      const rowKey = Math.round(c.y / Y_TOL)
      occupied[k].add(rowKey)
      for (let j = k + 1; j < cols.length; j++) if (c.endX > cols[j] + X_GAP) trampled[j].add(rowKey)
    }
    const crushed = []
    for (let j = 1; j < cols.length; j++) if (trampled[j].size > occupied[j].size) crushed.push(j)
    if (crushed.length) { cols.splice(Math.min(...crushed), 1); changed = true; continue }
    // Garde « solitaire » : des cotes de schéma isolées (ex. deux légendes de jauge
    // « 51 m. = 23 cm de large ») peuvent former un cluster de taille suffisante sans
    // jamais partager une rangée Y avec une autre colonne — ce n'est pas un flux de
    // lecture, juste des étiquettes flottantes.
    const byRow = new Map()
    for (const c of textNarrow) {
      const k = colOf(c.x, cols)
      const key = Math.round(c.y / Y_TOL)
      if (!byRow.has(key)) byRow.set(key, new Set())
      byRow.get(key).add(k)
    }
    const shared = Array.from({ length: cols.length }).fill(0)
    for (const set of byRow.values()) if (set.size >= 2) for (const k of set) shared[k]++
    const bad = shared.findIndex((n) => n < MIN_SHARED_ROWS)
    if (bad !== -1) { cols.splice(bad, 1); changed = true }
  }
  if (cols.length < 3) return null
  for (let i = 1; i < cols.length; i++) if (cols[i] - cols[i - 1] < MIN_COL_WIDTH) return null

  // Entrelacement Y global : ≥2 rangées portant des cellules d'au moins 2 colonnes.
  const byRow = new Map()
  for (const c of textNarrow) {
    const key = Math.round(c.y / Y_TOL)
    if (!byRow.has(key)) byRow.set(key, new Set())
    byRow.get(key).add(colOf(c.x, cols))
  }
  let interRows = 0
  for (const set of byRow.values()) if (set.size >= 2) interRows++
  if (interRows < 2) return null
  // Distingue un vrai tableau de chiffres d'une vraie prose N-colonnes (cas A) : si toutes
  // les colonnes SAUF AU PLUS UNE (l'étiquette) sont majoritairement des jetons de grille
  // numérique, ce n'est pas de la prose à lire colonne par colonne — un tableau de
  // données, à laisser au chemin 2-colonnes/mono-colonne existant (inchangé). Formulé en
  // « toutes sauf au plus une » plutôt que « la 1re colonne est l'étiquette » : ne présume
  // pas que l'étiquette est toujours la colonne la plus à gauche.
  const cellsByCol = Array.from({ length: cols.length }, () => [])
  for (const c of textNarrow) cellsByCol[colOf(c.x, cols)].push(c)
  const gridCols = cellsByCol.filter((cells) => {
    if (!cells.length) return false
    return cells.filter((c) => isGridToken(c.text)).length / cells.length >= 0.5
  }).length
  return cols.length - gridCols <= 1 ? null : cols
}

// Lecture 2-colonnes (voie twoCols de itemsToLines) : colonne gauche entière puis
// colonne droite, zigzag cas D quand une numérotation continue traverse la gouttière.
// Extraite verbatim de itemsToLines (refactor pur, zéro changement sémantique) pour
// être réutilisable sur une bande de page (colonnage par région). `toLines` (fermeture
// de itemsToLines : recollage Y intra-colonne + retrait des puces) est passée en
// argument ; `pageWidth` aussi — inutilisé ici, servi au gauntlet régional (regionTwoColumns).
function readTwoColumns(filled, bound, pageWidth, toLines) {
  // Les lignes de la colonne droite sont marquées : sur une page de corps, ce sont
  // typiquement des légendes photo (« Comme ceci »). boilerplate.js s'en sert pour
  // écarter les légendes courtes RÉCURRENTES sans toucher aux instructions gauches.
  const left = toLines(filled.filter((c) => c.x < bound))
  const right = toLines(filled.filter((c) => c.x >= bound)).map((l) => ({ ...l, rightCol: true }))
  // Cas D : une séquence numérotée coupée par la gouttière (item 1 gauche / item 2 droite /
  // item 3 gauche…) doit être lue en zigzag, pas colonne gauche entière puis colonne droite
  // entière — sauf quand gauche/droite sont deux blocs réellement indépendants (légendes,
  // tours côte à côte). Seul le CONTENU (continuité de la numérotation) distingue les deux
  // Forme reconnue à ce jour : nombre + suffixe ordinal FR (« 7ème », « 1er », « 1re »)
  // suivi du mot-clé. Ne couvre PAS les formes nombre-dernier d'autres langues (« Round 7 »,
  // « Vuelta 7 ») malgré l'alternance de mots-clés multilingue ci-dessous — dégrade sans
  // casse vers la lecture bloc existante sur ces pages (non testé sur un cas réel EN/ES à ce
  // jour). À étendre si et quand un nouveau cas réel l'exige (cf. spec, Hors scope).
  const TOUR_RE = /^\d+(?:er|re|ère|ème|e)\s+(?:tour|rang|round|omgang|vuelta|giro)s?\b/i
  const ITEM_RE = /^\d+[.)]\s/
  const typeOf = (l) => (TOUR_RE.test(l.text) ? 'anchor' : ITEM_RE.test(l.text) ? 'item' : 'plain')
  // Regroupe une colonne en blocs : chaque ancre ou item numéroté ouvre un nouveau bloc,
  // une ligne « plain » (suite de phrase) rejoint le bloc en cours.
  const blocksOf = (lines) => {
    const blocks = []
    for (const l of lines) {
      const t = typeOf(l)
      if (t !== 'plain' || !blocks.length) blocks.push({ type: t, num: t === 'item' ? parseInt(l.text, 10) : null, y: l.y, lines: [l] })
      else blocks[blocks.length - 1].lines.push(l)
    }
    return blocks
  }
  const lBlocks = blocksOf(left)
  const rBlocks = blocksOf(right)
  const anchorYs = [...lBlocks, ...rBlocks].filter((b) => b.type === 'anchor').map((b) => b.y)
  // Amorce +Infinity : garantit au moins une région même SANS AUCUNE ancre sur la page —
  // sinon la boucle de fusion ci-dessous ne s'exécute jamais et tout retombe
  // silencieusement en bloc gauche-puis-droite (bug trouvé en prototypant, cf. note du
  // 2026-07-24 — cas D).
  const boundaries = [Infinity, ...[...new Set(anchorYs)].sort((a, b) => b - a), -Infinity]
  const mergedBlocks = []
  let li = 0
  let ri = 0
  for (let bi = 0; bi < boundaries.length - 1; bi++) {
    const hi = boundaries[bi]
    const lo = boundaries[bi + 1]
    const inScope = (b) => b.y <= hi && b.y > lo
    const lScope = []
    while (li < lBlocks.length && inScope(lBlocks[li])) lScope.push(lBlocks[li++])
    const rScope = []
    while (ri < rBlocks.length && inScope(rBlocks[ri])) rScope.push(rBlocks[ri++])
    const lAnchors = lScope.filter((b) => b.type === 'anchor').length
    const rAnchors = rScope.filter((b) => b.type === 'anchor').length
    // Une ancre de CHAQUE côté dans la même région = 2 tours/rangs côte à côte, blocs
    // indépendants par construction (jamais entrelacés, quels que soient leurs numéros).
    if (lAnchors && rAnchors) {
      mergedBlocks.push(...lScope, ...rScope)
      continue
    }
    const combined = [...lScope.map((b) => ({ ...b, side: 0 })), ...rScope.map((b) => ({ ...b, side: 1 }))]
      .sort((a, c) => c.y - a.y || a.side - c.side)
    const seq = combined.filter((b) => b.type === 'item').map((b) => b.num)
    const continuing = seq.length >= 2 && seq.every((n, idx) => idx === 0 || n === seq[idx - 1] + 1)
    mergedBlocks.push(...(continuing ? combined : [...lScope, ...rScope]))
  }
  // Pas de reliquat à gérer après la boucle : la dernière frontière vaut toujours
  // -Infinity, donc la dernière région absorbe systématiquement tout bloc restant
  // (b.y > -Infinity est vrai pour tout Y réel) — li/ri ont toujours atteint la fin
  // des 2 tableaux ici, par construction.
  return mergedBlocks.flatMap((b) => b.lines)
}

// ── Colonnage par région (V1, repli strict) ─────────────────────────────────────────
// Une rangée Y (regroupement Y_TOL existant) est SÉPARATRICE quand elle barre la zone
// médiane [⅓W, ⅔W] — là où une gouttière de 2 colonnes peut vivre — sans le moindre
// couloir. Deux conditions, chacune calibrée sur un cas mesuré réel :
// (a) la couverture [min x, max endX] ENTRE dans la zone depuis la GAUCHE
//     (min x < ⅓W < max endX). Toute la prose/bandeau/titre large part de la marge
//     gauche : intro (0.10–0.72W) et conclusion (0.10–0.90W) de meris-tee p7, bandeau
//     « C R O C H E T P A T T E R N » de mini-kawaii p1 (0.15–0.63W, cellule unique —
//     RATÉ par le seuil endX > 0.6·W du veto spanning, qui sert un autre but : d'où un
//     test de couverture dédié plutôt que la réutilisation du seuil). À l'inverse les
//     rangées « wrap » de la colonne DROITE de la table meris p7 (0.53–0.86W, cellule
//     unique, par paires consécutives y=695/679, 569/553, 443/427, 317/301) pénètrent
//     la zone par la droite jusqu'à 0.67W : les compter séparatrices pulvériserait la
//     table en 5 bandes et re-fusionnerait titre et flux Step/MEANING — le test
//     d'entrée par la gauche les laisse dans leur bande, où elles appartiennent.
// (b) AUCUN gap inter-cellules ≥ GUTTER_MIN (6 pt — même constante que
//     detectColumnGutter : un couloir de gouttière, c'est un couloir, à l'échelle page
//     ou rangée) dont l'intervalle intersecte la zone médiane : les rangées de table
//     (meris p7 : gap 299→317.8 = 19pt), de grille glossaire (mini-kawaii p1 : gap
//     250→280 = 30pt) et de vraie 2-col gardent leur couloir au milieu et ne sont
//     jamais séparatrices. Les rangées courtes qui n'atteignent pas ⅓W (« page. » de
//     meris p7 y=184 : 0.10–0.15W) non plus — elles restent dans leur bande.
function isSeparatorRow(cells, pageWidth) {
  const lo = pageWidth / 3
  const hi = (pageWidth * 2) / 3
  const sorted = [...cells].sort((a, b) => a.x - b.x)
  const minX = sorted[0].x
  const maxEndX = Math.max(...sorted.map((c) => c.endX))
  if (!(minX < lo && maxEndX > lo)) return false
  for (let i = 1; i < sorted.length; i++) {
    const gapLo = sorted[i - 1].endX
    const gapHi = sorted[i].x
    if (gapHi - gapLo >= GUTTER_MIN && gapLo < hi && gapHi > lo) return false
  }
  return true
}

// Runs de rangées séparatrices : seuls des runs maximaux d'au moins REGION_MIN_RUN
// rangées CONSÉCUTIVES découpent la page. K=2, mesuré sur le corpus : les vraies
// frontières de meris p7 tiennent en runs francs (intro 2, conclusion 4, pied 3) ;
// une traversante ISOLÉE (titre centré au milieu d'une vraie 2-col qui échouerait au
// gauntlet page par ailleurs) ne doit JAMAIS découper seule — elle reste dans sa bande
// et est lue par son x de départ, comportement calibré d'avant ce chantier.
const REGION_MIN_RUN = 2

// ── V2b2 : garde de refus « liste à étiquettes clairsemées » (spec §4.1) ────────────
// Une bande peut passer le gauntlet régional (gouttière franche + entrelacement ≥ 2)
// sans être une vraie table 2-col : la LISTE À ÉTIQUETTES — little-love-on-a-string-de
// p2 (mesuré, sonde probe-v2a-bands 04/09) : étiquettes « 1. Reihe (Hin-R): » x=72
// [72..182] sur 4 rangées sur 13, corps wrappé x=213 [213..525] sur toutes les
// autres. La gouttière y est RÉELLE (chaque étiquette s'aligne face au corps, inter=4)
// mais la lecture en blocs DÉSYNCHRONISE : readTwoColumns met TOUT le corps wrappé
// dans le bloc droit (blocksOf fusionne les lignes « plain » consécutives en UN bloc)
// et les étiquettes 2-4 finissent orphelines en queue de flux gauche. La bonne lecture
// est le repli mono : toLines recolle étiquette+corps par Y (l'ancienne lecture,
// celle d'avant V1). Trois conditions cumulatives, chacune calibrée sur mesures :
const SPARSE_LEFT_MAX = 0.35 // (1) colonne gauche CLAIRSEMÉE : fraction des rangées de
                             // la bande portant une cellule gauche au bound régional.
                             // Étalonnage : liste étiquetée little-love réel 4/13 ≈
                             // 0.31, fixture V2b2 4/37 ≈ 0.11 ; vraie table meris p7
                             // 7/12 ≈ 0.58 (chaque rangée « Step N: ‖ def » ou wrap
                             // droit porte sa cellule gauche). Seuil 0.35 (spec §4.1) :
                             // marge 0.04 sous little-love réel, 0.23 au-dessus de meris.
const SPARSE_LABEL_MAX_CHARS = 30 // (2) cellules gauches façon ÉTIQUETTES : courtes
                             // (≤ 30 chars — mesuré little-love 17-18 « 1. Reihe
                             // (Hin-R): » ; meris a bien UNE cellule courte « Step 2:
                             // work INC, » 17 chars mais SANS « : » final, et ses
                             // têtes de phrase font 33-43 chars) et de forme étiquette :
                             // fin « : » OU préfixe numéroté ^\d+[.)]\s (même grammaire
                             // que ITEM_RE / PAIRED_NUMBERED_PREFIX).
const SPARSE_LABEL_LIKE_MIN = 0.8 // part minimale de cellules gauches étiquettes
                             // (little-love 4/4 ; meris 0/7 — double protection en
                             // profondeur sous la garde de densité).
const SPARSE_WRAP_MIN_ROWS = 2 // (3) colonne droite = FLUX CONTINU WRAPPÉ : au moins
                             // 2 rangées sans AUCUNE cellule gauche (le corps déborde
                             // de sa rangée étiquetée — little-love 9 rangées, fixture
                             // 33). Sans wraps, une bande clairsemée serait un
                             // empilement de paires alignées, pas une liste à recoller.
function isSparseLabelList(cells, bound) {
  const byRow = new Map()
  for (const c of cells) {
    if (!byRow.has(c.y)) byRow.set(c.y, [])
    byRow.get(c.y).push(c)
  }
  const rows = [...byRow.values()]
  const leftRows = rows.filter((cs) => cs.some((c) => c.x < bound)).length
  if (leftRows / rows.length >= SPARSE_LEFT_MAX) return false
  const leftCells = cells.filter((c) => c.x < bound)
  if (!leftCells.length) return false
  const labelLike = leftCells.filter((c) => {
    const t = c.text.trim()
    return t.length <= SPARSE_LABEL_MAX_CHARS && (t.endsWith(':') || /^\d+[.)]\s/.test(t))
  }).length
  if (labelLike / leftCells.length < SPARSE_LABEL_LIKE_MIN) return false
  const wrapRows = rows.filter((cs) => cs.every((c) => c.x >= bound)).length
  return wrapRows >= SPARSE_WRAP_MIN_ROWS
}

// Gauntlet régional : une bande ne prouve ses 2 colonnes que par la PREUVE
// GÉOMÉTRIQUE (detectColumnGutter — couloir vide + entrelacement Y inter ≥ 2,
// bandes extrêmes recalculées sur le range DE LA RÉGION : les bords d'une région
// sont ses bords). La garde < 8 cellules est le miroir du garde bimodal page
// (`filled.length >= 8`). La voie BIMODALE du gauntlet page (rightCells/spanning à
// COL_X, « filet de sécurité pour les pages de garde ») est VOLONTAIREMENT ÉCARTÉE
// au niveau région — écart assumé vs la spec §3.3 étape 3, mesuré sur fir-bloomers
// (p1 : collage logos, bande 8 cellules dont 3 droites à droite du bound, inter=0 ;
// p5 : tableau de mesures multilingue, 7/16 ; p14 : encart jauge, 5/10) : ces
// bandes basculaient à tort en 2-col régionale sur une preuve de comptage faible,
// SANS AUCUNE rangée portant gauche et droite à la fois (c'est précisément
// inter < 2 qui faisait échouer leur gouttière), et re-brassaient des pages de
// garde multi-langues. À l'inverse, le cas cible de ce repli passe par la
// gouttière : meris-tee p7, table Step‖MEANING — couloir [300,317.8], inter=5,
// bound 308. Fidèle au principe du repli strict : ne réparer QUE ce qui est prouvé
// géométriquement, ne jamais toucher au reste. Renvoie les lignes 2-col de la
// bande (helper de lecture partagé, cas D inclus) ou null → mono.
// Exportée (V2b2) pour le test unitaire du miroir régional apparié (ci-dessous) —
// via itemsToLines, detectPairedGrid page signe toute bande qui signe ici (même
// partition splitBySeparators, mêmes gardes) et court-circuite AVANT la cascade :
// la voie régionale appariée y est structurellement inatteignable, on la teste donc
// en direct.
export function regionTwoColumns(cells, pageWidth, toLines) {
  if (cells.length < 8) return null
  // (V2b2, spec §4.2) Grille appariée EMBARQUÉE : si la bande signe la grille
  // (analyzePairedBand V2a — les CINQ preuves : parité, clés étroites, appariement
  // par rangée, contenu lettré, dominance), elle se lit par paires AVANT toute
  // décision 2-col — miroir exact de la priorité page (itemsToLines 2 bis) : une
  // grille 2×2 EST gouttière-compatible, readTwoColumns la lirait en blocs +
  // rightCol (les defs courtes répétées se feraient apprendre comme légendes par
  // boilerplate.js). pairedRow, jamais rightCol.
  const grid = analyzePairedBand(cells, pageWidth)
  if (grid) return readPairedBand({ cells, grid }, toLines)
  const gutter = detectColumnGutter(cells, pageWidth)
  if (gutter == null) return null
  // (V2b2, spec §4.1) Refus « liste à étiquettes clairsemées » : la bande a prouvé
  // sa gouttière mais pas sa densité de table → repli mono (recollement Y), la
  // bande retombe dans toLines de readByRegions.
  if (isSparseLabelList(cells, gutter)) return null
  return readTwoColumns(cells, gutter, pageWidth, toLines)
}

// Partitionne `filled` en régions verticales (bandes Y contiguës, ordre de lecture
// Y décroissant) : les runs séparateurs forment chacun une région MONO (jamais jetées :
// l'intro/conclusion de meris p7 doit survivre verbatim — invariant « aucune
// information perdue »), les bandes entre les runs sont candidates au gauntlet régional
// (readByRegions) ou à la signature « grille appariée » (detectPairedGrid, V2a).
// Les régions partitionnent `filled` : chaque cellule sort exactement une fois (no-loss
// par construction). Extraite verbatim de readByRegions (refactor pur) pour être
// réutilisée par detectPairedGrid — même découpage, mêmes isSeparatorRow/REGION_MIN_RUN.
function splitBySeparators(filled, pageWidth) {
  const byRow = new Map()
  for (const c of filled) {
    if (!byRow.has(c.y)) byRow.set(c.y, [])
    byRow.get(c.y).push(c)
  }
  // Rangées par Y décroissant (ordre de lecture) ; les cellules d'une rangée partagent
  // row.y exactement (affecté par itemsToLines), le regroupement par égalité stricte
  // reflète les rangées Y_TOL déjà calculées.
  const rows = [...byRow.entries()].sort((a, b) => b[0] - a[0])
  const regions = [] // { separator: bool, cells: [] } en ordre Y décroissant
  let i = 0
  while (i < rows.length) {
    if (isSeparatorRow(rows[i][1], pageWidth)) {
      let j = i
      while (j < rows.length && isSeparatorRow(rows[j][1], pageWidth)) j++
      if (j - i >= REGION_MIN_RUN) {
        regions.push({ separator: true, cells: rows.slice(i, j).flatMap((r) => r[1]) })
        i = j
        continue
      }
    }
    // Rangée non-séparatrice, ou séparatrice ISOLÉE (run < 2) : elle reste dans la
    // bande en cours — jamais un découpage à elle seule (cf. REGION_MIN_RUN).
    if (!regions.length || regions[regions.length - 1].separator) regions.push({ separator: false, cells: [] })
    regions[regions.length - 1].cells.push(...rows[i][1])
    i++
  }
  return regions
}

// Gauntlet régional par région (readByRegions) : si AUCUNE bande ne passe le gauntlet
// 2-col, on court-circuite vers toLines, page inchangée (la concaténation des
// mono régionaux serait QUASI identique au mono page — bandes Y disjointes triées par
// Y — mais pas garantie au Y_TOL près entre rangées d'extrémités de régions adjacentes :
// le court-circuit exact est plus sûr). De même ≤ 1 région au total (cas mono-vrai
// gratuit : une page qui traverse partout = un run géant = une région).
function readByRegions(filled, pageWidth, toLines) {
  const regions = splitBySeparators(filled, pageWidth)
  if (regions.length < 2) return toLines(filled)
  let anyTwoCol = false
  const out = []
  for (const region of regions) {
    if (region.separator) {
      out.push(...toLines(region.cells))
      continue
    }
    const twoColLines = regionTwoColumns(region.cells, pageWidth, toLines)
    if (twoColLines) {
      anyTwoCol = true
      out.push(...twoColLines)
    } else {
      out.push(...toLines(region.cells))
    }
  }
  return anyTwoCol ? out : toLines(filled)
}

// ── Grilles appariées clé|valeur (V2a) ──────────────────────────────────────────────
// Une grille de glossaire 2×2 (« BLCO | backwards loop cast on ‖ REP | repeat ») est à la
// fois multi-colonnes (4 clusters de x-début) ET gouttière-compatible — la cascade V1 ne
// peut pas ne pas se tromper dessus : loupy p4 part en twoCols par une gouttière à 351pt
// (ENTRE la clé droite et SA définition), mini-kawaii p1 part en N-col (paires
// pulvérisées, « Front Loops Only » promu titre fantôme). La preuve « grille appariée »
// surclasse donc les preuves N-modes et gouttière (spec V2 §2.1) ; elle travaille par
// BANDE Y (runs séparateurs V1) car page entière la prose pollue le clustering
// (mini-kawaii p1 : col0 page = 135pt de médiane ; bande grille seule : clés 14-23pt).
const PAIRED_KEY_MAX_W = 0.10 // largeur médiane max d'une colonne clés (fraction de page) :
                              // loupy p4 27/26pt et mini-kawaii p1 17/23pt sur W≈595 ;
                              // une prose 4-col a 4 colonnes larges → rejet. Contre-
                              // échantillon meris p7 : 232pt ≫ 59.6pt.
const MIN_PAIRED_ROWS = 3     // rangées mini portant clé+def : loupy 10 rangées réelles,
                              // mini-kawaii 4 — sous 3, pas de signature (hasard).
const KEY_MAX_CHARS = 15      // clé lettrée courte : mesuré ≤ 5 chars sur loupy/mini-kawaii
                              // (BLCO, K2tog, St st, Hdc…) ; un préfixe de phrase ne colle
                              // pas à cette borne.
const KEY_LIKE_MIN = 0.5      // majorité de tokens lettrés : loupy 10/10 + 10/10,
                              // mini-kawaii 4/4 + 4/4 ; table numérique 0/3 → rejet.
const KEY_NUMBERED_MAX = 0.5  // part MAX de clés ouvrant par un préfixe de NUMÉROTATION
                              // ^\d+[.)]\s (la forme cas D) : sweet-mess es p4 « 5. Así. »/
                              // « 7. Así. »/« 9. Salta… » x=42 vs defs « 6. »/« 8. »/« 10. Así. »
                              // x=304 → 3/3 préfixées (p5 : 3/3 aussi) ; vraies grilles 0
                              // préfixée (lettre d'abord) : loupy 0/6+0/6 (BLCO, CO, K… ‖ REP,
                              // Sl, SM…), mini-kawaii 0/4+0/4 (MR, Sc, Inc, Dec ‖ FLO, BLO,
                              // Hdc, FO), little-love 0/6 (Zun, re, li, MM, M…), rainbow-
                              // turtles 0/5 (R1, Tête Bébé, R3, R5, Patte avant). Seuil
                              // majoritaire ≥ 0.5, même convention que KEY_LIKE_MIN : au-
                              // dessus, ce sont des items de tutoriel numérotés, pas des clés.
const KEY_X_SPREAD = 6        // étalement max des x-début des clés APPARIÉES : une colonne
                              // clés est UNE population alignée (loupy 6×36pt, mini-kawaii
                              // 4×20pt : étalement 0 — cf. SAME_X=1pt dans glossary-columns).
                              // Contre-échantillon meris p7 : « Step N: » à 67pt + têtes de
                              // phrase à 120pt fusionnent (53 < MIN_COL_WIDTH=60) en une
                              // fausse colonne de médiane 46pt — seules les gardes largeur
                              // et contenu ne suffisent pas, l'ALIGNEMENT rejette (53pt).
const GRID_DOMINANCE_MIN = 0.75 // part des narrow expliquée par les rangées appariées +
                              // leurs wraps : loupy 40/40, mini-kawaii 16/20 = 0.8 (la
                              // prose du patron vit en queue contiguë de la bande).
// Grammaire de continuation des wraps de def — la MÊME que readColumnGlossary
// (glossary-columns.js, SENTENCE_END) : une définition qui ne finit pas par un signe de
// fin de phrase continue sur la rangée suivante. Regex locale (non importée) : le commit
// V2a-T1 ne touche que lines.js.
const PAIRED_SENTENCE_END = /[.!?…)]$/
// Préfixe de numérotation d'item (forme cas D) : la MÊME forme que ITEM_RE de
// readTwoColumns ci-dessous — « 5. », « 10) ». Une vraie clé de glossaire ne commence
// JAMAIS par ça (elle ouvre par une lettre : « BLCO », « MR », « Zun », « R1 »).
const PAIRED_NUMBERED_PREFIX = /^\d+[.)]\s/

// Signe « grille appariée » sur UNE bande : clustering des x-début IDENTIQUE à
// detectColumns (chaîne CLUSTER_GAP=40, fusion médiane-médiane < MIN_COL_WIDTH=60,
// exclusions isChartLabel/isGlyphOnly, garde MIN_COL_CELLS, élagage des colonnes
// solitaires, espacement ≥ MIN_COL_WIDTH), puis les cinq preuves spécifiques (spec §2.2) :
// parité PAIRE, colonnes clés étroites, appariement par rangée, contenu lettré,
// dominance. Renvoie { cols } (les x représentatifs, triés) ou null.
// NB : largeurs et contenu se mesurent SUR LES RANGÉES APPARIÉES uniquement — la prose de
// queue pollue sinon la médiane de la colonne clés (mini-kawaii p1 col0 : 92pt bande
// entière vs 17pt sur les rangées appariées, mesuré).
function analyzePairedBand(cells, pageWidth) {
  const narrow = cells.filter((c) => c.endX - c.x < 0.55 * pageWidth)
  if (narrow.length < 8) return null
  const textNarrow = narrow.filter((c) => !isChartLabel(c.text) && !isGlyphOnly(c.text))
  if (textNarrow.length < 8) return null
  const xs = textNarrow.map((c) => c.x).sort((a, b) => a - b)
  const clusters = []
  for (const x of xs) {
    const last = clusters[clusters.length - 1]
    if (last && x - last.max <= CLUSTER_GAP) { last.max = x; last.list.push(x) }
    else clusters.push({ max: x, list: [x] })
  }
  let merged = true
  while (merged) {
    merged = false
    for (let i = 1; i < clusters.length; i++) {
      if (median(clusters[i].list) - median(clusters[i - 1].list) < MIN_COL_WIDTH) {
        clusters[i - 1].list = clusters[i - 1].list.concat(clusters[i].list)
        clusters.splice(i, 1)
        merged = true
        break
      }
    }
  }
  let cols = clusters.filter((c) => c.list.length >= MIN_COL_CELLS).map((c) => median(c.list))
  // Parité PAIRE : les colonnes vont par paires clé|def (2 = grille simple, 4 = grille
  // 2×2 — loupy/mini-kawaii mesurés ; toute prose N-col impaire est rejetée ici).
  if (cols.length < 2 || cols.length % 2 !== 0) return null
  const colOf = (x) => { let k = 0; for (let i = 0; i < cols.length; i++) if (x >= cols[i] - CLUSTER_GAP) k = i; return k }
  // Élagage des colonnes solitaires (discipline detectColumns, même code) : une étiquette
  // flottante ne doit pas fabriquer une fausse parité.
  let changed = true
  while (changed && cols.length >= 3) {
    changed = false
    const byRow = new Map()
    for (const c of textNarrow) {
      const key = Math.round(c.y / Y_TOL)
      if (!byRow.has(key)) byRow.set(key, new Set())
      byRow.get(key).add(colOf(c.x))
    }
    const shared = Array.from({ length: cols.length }).fill(0)
    for (const set of byRow.values()) if (set.size >= 2) for (const k of set) shared[k]++
    const bad = shared.findIndex((n) => n < MIN_SHARED_ROWS)
    if (bad !== -1) { cols.splice(bad, 1); changed = true }
  }
  if (cols.length < 2 || cols.length % 2 !== 0) return null
  for (let i = 1; i < cols.length; i++) if (cols[i] - cols[i - 1] < MIN_COL_WIDTH) return null

  // Rangées de la bande (groupement Y exact, cf. splitBySeparators) et appariement :
  // rangée « appariée » = porte clé ET def d'au moins une paire. Grille ≥ 4 colonnes :
  // des rangées portant les DEUX paires (0 et 2) simultanément — l'alignement Y à
  // travers les paires EST la signature « grille » (loupy : 10 rangées sur 10).
  const byRow = new Map()
  for (const c of narrow) {
    if (!byRow.has(c.y)) byRow.set(c.y, [])
    byRow.get(c.y).push(c)
  }
  const rows = [...byRow.values()]
  const hasPair = (cs, p) => {
    const ks = new Set(cs.map((c) => colOf(c.x)))
    return ks.has(p) && ks.has(p + 1)
  }
  const pairedRows = rows.filter((cs) => {
    for (let p = 0; p + 1 < cols.length; p += 2) if (hasPair(cs, p)) return true
    return false
  })
  for (let p = 0; p + 1 < cols.length; p += 2) {
    if (pairedRows.filter((cs) => hasPair(cs, p)).length < MIN_PAIRED_ROWS) return null
  }
  if (cols.length >= 4 && pairedRows.filter((cs) => hasPair(cs, 0) && hasPair(cs, 2)).length < MIN_PAIRED_ROWS) return null

  // Colonnes clés (positions impaires en comptant à 1 : indices 0, 2… — la clé est la
  // colonne GAUCHE de chaque paire, mesuré sur loupy/mini-kawaii) étroites : largeur
  // médiane ≤ 10%W ET < moitié de la médiane de leur colonne def. Contre-échantillon
  // meris p7 : « colonne » Step fusionnée médiane 232pt ≫ 59.6pt — les « Step 1: » sont
  // des préfixes de phrases longues, pas des colonnes clés. Contenu : clés majoritairement
  // des tokens LETTRÉS courts (≤ 15 chars, au moins une lettre) — rejet si numériques
  // (isGridToken : table de mesures, hors périmètre, flower-child reste en V1).
  // ALIGNEMENT : les x-début des clés appariées forment UNE population (écart ≤ KEY_X_SPREAD)
  // — une « colonne » née de la FUSION de deux populations (meris : « Step N: » à 67pt +
  // têtes de phrase à 120pt, écart 53pt) n'est pas une colonne clés, quelle que soit la
  // médiane que le mélange produise.
  const cellsOfCol = (k) => pairedRows.flatMap((cs) => cs.filter((c) => colOf(c.x) === k))
  for (let p = 0; p + 1 < cols.length; p += 2) {
    const keyCells = cellsOfCol(p)
    const defCells = cellsOfCol(p + 1)
    if (!keyCells.length || !defCells.length) return null
    if (Math.max(...keyCells.map((c) => c.x)) - Math.min(...keyCells.map((c) => c.x)) > KEY_X_SPREAD) return null
    const keyW = median(keyCells.map((c) => c.endX - c.x))
    const defW = median(defCells.map((c) => c.endX - c.x))
    if (keyW > PAIRED_KEY_MAX_W * pageWidth) return null
    if (keyW >= defW / 2) return null
    const keyLike = keyCells.filter((c) => {
      const t = c.text.trim()
      return t.length > 0 && t.length <= KEY_MAX_CHARS && /[a-zà-öø-ÿ]/i.test(t) && !isGridToken(t)
    }).length
    if (keyLike / keyCells.length < KEY_LIKE_MIN) return null
    // Préfixe de numérotation MAJORITAIRE (forme cas D, spec §2.2 NON-déclenchante) : la
    // garde keyLike ne voit pas « 5. Así. » — des LETTRES après le numéro, étroit, court.
    // Ces rangées sont des étapes de tutoriel photo numérotées intercalées par la
    // gouttière, à lire en zigzag cas D par readTwoColumns, JAMAIS appariées en
    // « clé def » : le numéro de la colonne droite se coud au milieu de la phrase de
    // l'étape gauche (« 9. Salta 2 cadenetas y teje 1 punto bajo en el 10. Así. »,
    // régression sweet-mess es p4-5 mesurée au sweep V2a-T3). Mesures au commentaire de
    // KEY_NUMBERED_MAX.
    const numbered = keyCells.filter((c) => PAIRED_NUMBERED_PREFIX.test(c.text.trim())).length
    if (numbered / keyCells.length >= KEY_NUMBERED_MAX) return null
  }

  // Dominance : les rangées appariées + leurs wraps (rangées SANS cellule clé, def seule
  // → continuation, cf. readPairedBand) expliquent la grande majorité des narrow. Le
  // résiduel (titres de bande, clés seules, prose) doit vivre en tête/queue SANS
  // entrelacement Y avec la grille — mini-kawaii : prose du patron en queue y≤407 sous
  // la dernière rangée appariée y=456 ; un résiduel au milieu de la grille = page mixte
  // → null, repli intégral (protège meris p7 et les 67 PDF V1-changés).
  const isWrapRow = (cs) => {
    let hasDef = false
    for (const c of cs) {
      if (colOf(c.x) % 2 === 0) return false
      hasDef = true
    }
    return hasDef
  }
  const explainedRows = new Set([
    ...pairedRows,
    ...rows.filter((cs) => !pairedRows.includes(cs) && isWrapRow(cs)),
  ].map((cs) => cs[0].y))
  const explainedCells = narrow.filter((c) => explainedRows.has(c.y)).length
  if (explainedCells / narrow.length < GRID_DOMINANCE_MIN) return null
  const pairedYs = pairedRows.map((cs) => cs[0].y)
  const topPaired = Math.max(...pairedYs)
  const botPaired = Math.min(...pairedYs)
  for (const cs of rows) {
    if (explainedRows.has(cs[0].y)) continue
    const y = cs[0].y
    if (y < topPaired && y > botPaired) return null
  }
  return { cols }
}

// Découpe la page en bandes (runs séparateurs V1 verbatim — même partition que
// readByRegions) et signe les bandes grilles. Renvoie la partition complète (chaque
// région porte `grid` si elle signe) quand AU MOINS une bande signe, sinon null → repli
// intégral sur la cascade inchangée (byte-identique là où aucune grille ne signe).
function detectPairedGrid(filled, pageWidth) {
  if (!filled || filled.length < 8) return null
  const regions = splitBySeparators(filled, pageWidth)
  let anyGrid = false
  for (const region of regions) {
    if (region.separator || region.cells.length < 8) continue
    region.grid = analyzePairedBand(region.cells, pageWidth)
    if (region.grid) anyGrid = true
  }
  return anyGrid ? { regions } : null
}

// Lecture d'une bande signée : par rangée Y décroissante, émettre « clé def » (et « clé2
// def2 » en seconde ligne de la même rangée) — parts.x PRÉSERVÉS jamais synthétisés (pas
// de « = » fabriqué : parts portent la structure, readColumnGlossary fait le découpage),
// UN SEUL flux en ordre Y, AUCUN rightCol (des defs courtes répétées se feraient apprendre
// comme légendes par boilerplate.js), flag pairedRow: true (consommé par les gardes
// V2b1). Wrap de def (groupe sans clé) → rattacher à l'entrée au-dessus, grammaire de
// continuation readColumnGlossary (pas de fin de phrase → continue). Rangée clé seule
// (titre « Abbreviations - US Terms ») → ligne normale SANS flag. Discipline de clonage
// de parts : toLines clone les tableaux, les fusions ci-dessous ne touchent que des
// tableaux fraîchement créés (leçon V1, bug 8b8ebfca).
function readPairedBand(region, toLines) {
  const cols = region.grid.cols
  const colOf = (x) => { let k = 0; for (let i = 0; i < cols.length; i++) if (x >= cols[i] - CLUSTER_GAP) k = i; return k }
  const byRow = new Map()
  for (const c of region.cells) {
    if (!byRow.has(c.y)) byRow.set(c.y, [])
    byRow.get(c.y).push(c)
  }
  const rows = [...byRow.entries()].sort((a, b) => b[0] - a[0]).map(([, cs]) => cs.sort((a, b) => a.x - b.x))
  const out = []
  const lastOfPair = new Map() // paire → dernière ligne « clé def » émise (cible des wraps)
  for (const cells of rows) {
    // groupes de la rangée par paire (2 colonnes consécutives = clé|def), ordre X
    const groups = []
    for (const c of cells) {
      const p = Math.floor(colOf(c.x) / 2)
      if (!groups[p]) groups[p] = []
      groups[p].push(c)
    }
    for (let p = 0; p < groups.length; p++) {
      const g = groups[p]
      if (!g || !g.length) continue
      const hasKey = g.some((c) => colOf(c.x) % 2 === 0)
      const hasDef = g.some((c) => colOf(c.x) % 2 === 1)
      if (hasKey && hasDef) {
        for (const l of toLines(g)) out.push({ ...l, pairedRow: true })
        lastOfPair.set(p, out[out.length - 1])
      } else if (hasDef) {
        // wrap : def seule sur la rangée — rattache à l'entrée au-dessus si elle n'a pas
        // fini sa phrase, sinon ligne propre (miroir du emitNote de readColumnGlossary)
        const target = lastOfPair.get(p)
        if (target && !PAIRED_SENTENCE_END.test(target.text)) {
          for (const l of toLines(g)) {
            target.text = `${target.text} ${l.text}`.replace(/\s{2,}/g, ' ')
            target.parts.push({ x: null, text: ' ' }, ...l.parts)
            target.size = Math.max(target.size, l.size)
            target.bold = target.bold || l.bold
          }
        } else {
          for (const l of toLines(g)) out.push({ ...l, pairedRow: true })
        }
      } else {
        out.push(...toLines(g))
      }
    }
  }
  return out
}

// Consomme la partition de detectPairedGrid : bandes signées lues par paires, tout le
// reste (runs séparateurs, bandes non signées) en toLines normal — ordre Y strict autour
// des grilles, la partition de filled ⇒ no-loss par construction. Jamais de zigzag cas D
// ici (pas des séquences numérotées coupées par une gouttière), jamais de morceau central
// inventé : chaque ligne provient des cellules d'UNE rangée d'UNE bande.
function readPairedGrid(filled, paired, toLines) {
  const out = []
  for (const region of paired.regions) {
    if (region.grid) out.push(...readPairedBand(region, toLines))
    else out.push(...toLines(region.cells))
  }
  return out
}

export function itemsToLines(items, styles = {}, { pageWidth = 595 } = {}) {
  // 1. items → rangées par Y, puis cellules par sauts X.
  const rows = []
  let cur = null
  for (const it of items || []) {
    const y = it.transform?.[5] ?? 0
    const x = it.transform?.[4] ?? 0
    const size = it.height || Math.abs(it.transform?.[3] ?? 0) || 0
    const bold = /bold|black|heavy/i.test(styles[it.fontName]?.fontFamily || '')
    // Exposant (cf. SUPERSCRIPT_SIZE_RATIO ci-dessus) : rattaché à la rangée EN COURS
    // sans jamais toucher cur.y — ainsi le fragment suivant, revenu à la ligne de base,
    // continue de se comparer à cur.y (inchangé) et rejoint la même rangée normalement.
    // NOTE (revue, non corrigée) : plus bas, TOUTE cellule d'une rangée hérite de `row.y`
    // (ligne ~246, `y: row.y`), donc un exposant absorbé qui finirait dans sa PROPRE cellule
    // (s'il était assez loin en X d'un voisin pour franchir X_GAP — pas le cas mesuré ici, où
    // il reste collé sans espace au chiffre/à la suite) perdrait sa vraie ordonnée rehaussée
    // au profit de la ligne de base — écart possible jusqu'à SUPERSCRIPT_Y_OFFSET_RATIO×corps
    // (0.6×corps ici). Sans effet mesuré à ce jour (reflowLines mode `para` compare des écarts
    // de l'ordre de l'interligne, largement au-dessus de cette marge), mais à garder en tête
    // si un futur cas réel positionne l'exposant dans sa propre cellule.
    const rowSize = cur && cur.items.length ? Math.max(...cur.items.map((ci) => ci.size)) : 0
    const isSuperscript =
      cur && cur.items.length && size > 0 && rowSize > 0 &&
      size <= rowSize * SUPERSCRIPT_SIZE_RATIO &&
      y > cur.y && y - cur.y <= rowSize * SUPERSCRIPT_Y_OFFSET_RATIO
    if (!cur || (!isSuperscript && Math.abs(y - cur.y) > Y_TOL)) {
      cur = { y, items: [] }
      rows.push(cur)
    }
    cur.items.push({ x, w: it.width || 0, str: it.str, size, bold })
  }
  const cells = []
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x)
    let cell = null
    let endX = null
    let prev = null // dernier item retenu de la rangée : écarte les doublons superposés
    for (const it of row.items) {
      // Double frappe : les titres à contour des pages de garde (Go handmade « Patron »,
      // « Baby », « Bon à savoir ») sont dessinés deux fois exactement au même endroit ;
      // pdfjs émet alors deux items identiques quasi superposés. Sans dédup, itemsToLines
      // les concatène (« PatronPatron », « BabyBaby »). On écarte la seconde frappe :
      // MÊME chaîne ET écart horizontal négligeable (< 0.6 pt). Deux occurrences légitimes
      // du même texte (colonnes de tailles) sont éloignées en X et donc préservées.
      if (prev && it.str === prev.str && Math.abs(it.x - prev.x) < 0.6) continue
      if (!cell || (endX != null && it.x - endX > X_GAP && it.str.trim())) {
        cell = { text: '', size: 0, bold: false, y: row.y, x: it.x, endX: it.x, parts: [] }
        cells.push(cell)
      }
      cell.parts.push({ x: it.x, text: it.str })
      cell.text += it.str
      cell.size = Math.max(cell.size, it.size)
      cell.bold = cell.bold || it.bold
      endX = Math.max(endX ?? it.x, it.x + it.w)
      cell.endX = endX
      prev = it
    }
  }
  const filled = cells.filter((c) => c.text.trim())

  // 2. Détection deux-colonnes. Deux mécanismes complémentaires :
  //  (a) gouttière géométrique par page (detectColumnGutter) : trouve un couloir
  //      vertical vide qui sépare deux flux ENTRELACÉS par Y — attrape les pages de
  //      CORPS où la colonne droite est éparse (légendes photo « Comme ceci » : trop
  //      peu de cellules pour la bimodalité globale, mais nettement séparées) ;
  //  (b) bimodalité globale (héritée) : frontière fixe COL_X, filet de sécurité pour
  //      les pages de garde où la gouttière peut ne pas être franche.
  const gutter = detectColumnGutter(filled, pageWidth)
  let bound = gutter != null ? gutter : COL_X * pageWidth
  const rightCells = filled.filter((c) => c.x >= bound)
  const spanning = spanningCandidates(filled, bound, pageWidth)
  const twoCols =
    gutter != null ||
    (filled.length >= 8 &&
      rightCells.length >= Math.max(3, 0.2 * filled.length) &&
      spanning.length <= 0.1 * filled.length)

  const toLines = (list) => {
    // Regroupe à nouveau par Y à l'intérieur d'une colonne (cellules sœurs recollées).
    const out = []
    let prev = null
    for (const c of [...list].sort((a, b) => b.y - a.y || a.x - b.x)) {
      if (prev && Math.abs(c.y - prev.y) <= Y_TOL) {
        prev.text += ` ${c.text}`
        prev.size = Math.max(prev.size, c.size)
        prev.bold = prev.bold || c.bold
        // Séparateur x=null : l'espace de recollage n'existe dans AUCUN item du PDF
        // (deux cellules sœurs, pas un fragment) — le marquer null l'empêche d'être
        // confondu avec une vraie abscisse par un futur consommateur de parts.
        prev.parts.push({ x: null, text: ' ' }, ...c.parts)
        continue
      }
      // CLONE du tableau de parts : sans lui, prev.parts ALIASE cell.parts et le push
      // ci-dessus mute la cellule EN PLACE. Sur une page régionalisée non-admise,
      // readByRegions appelle toLines par région PUIS toLines(filled) → les cellules
      // sœurs recollées passent DEUX fois dans la fusion et leurs parts sont dupliquées
      // (text, recalculé depuis c.text, reste correct — mais glossary-columns.js recompose
      // ses clés depuis parts et duplique les définitions). Les OBJETS internes restent
      // partagés : ils sont traités comme immuables partout ailleurs (aucun site ne les
      // mute), seul le tableau est cloné.
      prev = { text: c.text, size: c.size, bold: c.bold, y: c.y, parts: [...c.parts] }
      out.push(prev)
    }
    // Puce typographique en tête de ligne (glyphe de liste PDF « ● • ◦ ▪ ‣ ⁃ ∙ »
    // suivi d'une espace) : artefact de mise en page, pas du contenu — les
    // références de l'oracle ne les gardent pas. Retiré ici pour toutes les langues.
    return out
      .map((l) => {
        const text = l.text.replace(/\s{2,}/g, ' ').trim().replace(/^[●•◦▪‣⁃∙]\s+/, '')
        // La puce partage très souvent son morceau avec les premiers mots (« • Crocheter
        // une chaînette ») : écarter parts[0] entier supprimerait du contenu et casserait
        // l'invariant parts↔text. On applique donc la MÊME regex au premier morceau seul —
        // après avoir retiré un éventuel espacement de tête (comme le .trim() côté text),
        // sinon un espace initial dans le PDF (rare mais réel) masque la puce à la regex
        // et laisse fuiter le glyphe dans parts alors que text l'a déjà retiré.
        let parts = l.parts
        if (parts && parts.length) {
          // `\s+` APRÈS le glyphe rendu optionnel (`\s*`) : quand le PDF émet la puce
          // comme son PROPRE morceau (« • ») et laisse l'espace au morceau suivant,
          // parts[0].text vaut exactement « • » — sans espace derrière, l'ancienne regex
          // ne matchait pas et le glyphe SURVIVAIT dans `parts` alors que `text` l'avait
          // déjà retiré, cassant l'invariant parts↔text que ce bloc existe pour tenir.
          // glossary-columns.js recompose une clé de glossaire depuis `parts` : la puce
          // s'y retrouvait collée en tête de clé.
          const head = parts[0].text.replace(/^\s+/, '').replace(/^[●•◦▪‣⁃∙]\s*/, '')
          parts = head ? [{ ...parts[0], text: head }, ...parts.slice(1)] : parts.slice(1)
        }
        return { ...l, text, parts }
      })
      .filter((l) => l.text)
  }

  // 2 bis (V2a). Grilles appariées clé|valeur : la preuve « grille » (clés étroites +
  // appariement par rangée, bandes séparateurs V1) surclasse la cascade — testée AVANT
  // detectColumns ≥3 et AVANT les voies twoCols/régions : une grille 2×2 EST
  // multi-colonnes ET gouttière-compatible, les détecteurs actifs se trompent forcément
  // dessus (loupy p4, mini-kawaii p1). paired=null → cascade V1 strictement inchangée
  // (byte-identique, garanti par les contre-échantillons : cas D, 3-col, table numérique,
  // mono pur, meris p7).
  const paired = detectPairedGrid(filled, pageWidth)
  if (paired) return readPairedGrid(filled, paired, toLines)

  // 2 ter. Détection N colonnes (≥3, pages torsades/tuto 3 colonnes) : indépendante de
  // detectColumnGutter/bimodalité ci-dessus (qui restent la voie mono/2-col inchangée).
  // Ne s'emprunte QUE si detectColumns trouve ≥3 modes de x fiables et entrelacés par Y ;
  // sinon on retombe exactement sur le chemin existant (byte-identique).
  const cols = detectColumns(filled, pageWidth)
  if (cols && cols.length >= 3) {
    const colOf = (x) => { let k = 0; for (let i = 0; i < cols.length; i++) if (x >= cols[i] - CLUSTER_GAP) k = i; return k }
    const out = []
    for (let ci = 0; ci < cols.length; ci++) {
      const colCells = filled.filter((c) => colOf(c.x) === ci)
      // Pas de marquage rightCol ici : sur une page N-col (torsades/tuto ≥3 colonnes),
      // les colonnes 2..N sont du TEXTE PRIMAIRE (suite de la même consigne), jamais des
      // légendes photo — contrairement à la voie 2-colonnes ci-dessous. Les marquer
      // rightCol les exposerait au filtrage anti-légende de boilerplate.js et ferait
      // perdre du contenu réel (ex. « à répéter » présent ×2 sur une page 3-col).
      const lines = toLines(colCells)
      out.push(...lines)
    }
    return out.map((l) => ({ ...l, multiCol: true }))
  }

  // 2 quater. Repli régional (colonnage par région, V1) : UNIQUEMENT dans la branche où
  // la page serait lue mono aujourd'hui — deuxCols=true (gouttière ou bimodal) et
  // detectColumns ≥ 3 ci-dessus restent strictement inchangés, le code régional y est
  // inatteignable. readByRegions rend toLines(filled) tel quel (byte-identique) quand la
  // partition n'est pas admissible : ≤ 1 région, ou aucune bande ne passe le gauntlet.
  if (!twoCols) return readByRegions(filled, pageWidth, toLines)
  return readTwoColumns(filled, bound, pageWidth, toLines)
}

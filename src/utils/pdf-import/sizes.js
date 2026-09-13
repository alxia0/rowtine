// Grammaire des vecteurs multi-tailles « 104 (108) 112 (116) » / « 102 (112, 122) (142) ».
// Non-invention : seuls les vecteurs de longueur EXACTE n deviennent des {{i}}.
import { foldEszett } from './text-norm'

const NUM = String.raw`\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?`
// Nombre À L'INTÉRIEUR d'un groupe VEC_RE (VEC_NUM) : décimale à POINT SEUL. Là, la virgule
// est un SÉPARATEUR de haut niveau (« (112, 122) ») ; l'autoriser AUSSI comme décimale
// (`[.,]`) rend chaque virgule ambiguë (décimale d'un NUM vs séparateur), d'où un
// backtracking catastrophique (ReDoS, 2^k) sur un groupe non fermé « (1,1,1,… ». Point-seul
// → parcours linéaire. (Même parade que BR_NUM plus bas ; hors groupe, cf. VEC_NUM_DEC.)
// L'EXTRACTION reste faite par NUM_RE (inchangé).
const VEC_NUM = String.raw`\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?`
// Nombre en position LIBRE (avant/après un groupe) : la décimale à VIRGULE y est admise.
// Motivation : demi-millimètres d'aiguilles « 4,5 (5) 5,5 mm » = ubiquitaires en FR, cœur
// de cible de l'app. La virgule reste point-seul À L'INTÉRIEUR des groupes (VEC_NUM), là
// où `[,;]` sépare — ambiguïté virgule décimale↔séparateur = source du backtracking 2^k.
const VEC_NUM_DEC = String.raw`\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?`
// Un vecteur = nombres et groupes (…) adjacents, contenant AU MOINS un groupe. Le run de nombres
// LIBRES combine DEUX parades anti-ReDoS, chacune nécessaire contre un cas pathologique distinct
// (fusion moteur unique — l'app et le banc n'en avaient chacun qu'une) :
//  1. Séparateur `\s+` OBLIGATOIRE entre nombres (app, commit 833018e) : une longue suite de
//     chiffres SANS séparateur = UN seul nombre, jamais une partition → pas d'explosion C(n,k)
//     quand le match global échoue (cf. pdf-import-sizes « longue suite sans séparateur »).
//  2. Nombre de nombres BORNÉ (≤24) (banc) : une longue liste ESPACÉE sans groupe reste linéaire
//     (cf. mdlab-engine « longue liste d'entiers/décimales espacés sans groupe »). Aucun vecteur
//     de tailles réel n'a >24 valeurs libres.
// Le `\s+` est STRICTEMENT entre nombres (suivi obligatoire d'un nombre) ; le `\s*` de fin ne
// s'applique qu'après le dernier → aucun chevauchement d'espace (source du backtracking). Décimale
// à virgule admise en position libre (VEC_NUM_DEC, jauge FR demi-mm) ; point-seul dans les groupes.
const FREE_RUN = String.raw`(?:${VEC_NUM_DEC}(?:\s+${VEC_NUM_DEC}){0,23}\s*)?`
// Run de QUEUE : le run de nombres libres qui SUIT une parenthèse fermante. La queue d'une
// notation groupée est une LISTE, symétrique des groupes qui la précèdent (« 99 (99, 101,
// 101, 101) (103, 111, 113, 115) 123, 125 » = 11 tailles) : sans la virgule comme séparateur
// on n'y lisait que « 123 » et le « 125 » était perdu — donc 10 valeurs sur 11, aucun vecteur
// pour 11 tailles, et la tricoteuse voyait la notation brute au lieu de SA valeur.
// Non-invention : la virgule n'est admise QU'APRÈS un groupe (queue qui prolonge une notation
// déjà ouverte, `TAIL_RUN` n'est pas utilisé en tête de vecteur) ; une prose chiffrée sans
// parenthèses (« Monter 90, 100, 110 mailles ») reste hors grammaire, VEC_RE exigeant un groupe.
// Anti-ReDoS : le séparateur exige un ESPACE APRÈS la virgule (`,\s+`), ce qui le rend DISJOINT
// de la décimale à virgule de VEC_NUM_DEC (« 4,5 », chiffre collé). Aucune virgule n'est donc
// ambiguë (décimale vs séparateur) → pas de partition à explorer, parcours linéaire — même
// exigence que le point-seul de VEC_NUM à l'intérieur des groupes.
const TAIL_SEP = String.raw`(?:\s*,\s+|\s+)`
const TAIL_RUN = String.raw`(?:${VEC_NUM_DEC}(?:${TAIL_SEP}${VEC_NUM_DEC}){0,23}\s*)?`
// Groupe parenthésé « (108) » / « (112, 122, 132) » — grammaire d'origine, inchangée.
const VEC_GROUP = String.raw`\(\s*${VEC_NUM}(?:\s*[,;]\s*${VEC_NUM})*\s*\)`
// Groupe à CROCHETS séparés par DEUX-POINTS « [107:117:129:139] » (ES/DE, notation Hobbii —
// serenity-sweater-es-f1e18764, campagne de test palier 6/8, 51 occurrences vérifiées dans
// le PDF réel, JAMAIS de faux positif trouvé dans les 25 réf. gate + PDF déjà traités des
// paliers précédents, cf. RAPPORT du palier). Scope VOLONTAIREMENT ÉTROIT :
//  - séparateur : UNIQUEMENT « : » (pas de « , »/« ; » ici — ceux-ci restent le domaine de
//    BRACKET_VEC_RE plus bas, grammaire DIFFÉRENTE — liste aplatie à virgule EXIGEANT une
//    virgule AVANT le groupe, ex. « a, [f,g,h] » — qui elle n'accepte jamais « : »). Les deux
//    grammaires sont DISJOINTES par construction (aucun chevauchement de séparateur), donc
//    jamais en concurrence sur la même sous-chaîne.
//  - VEC_NUM (point-seul, même parade anti-ReDoS que le groupe parenthésé) : « : » n'est de
//    toute façon jamais un caractère de décimale → aucune ambiguïté nombre/séparateur créée.
//  - FREE_RUN et TAIL_RUN (nombres NUS hors groupe) restent 100% INCHANGÉS : cette grammaire
//    n'ajoute qu'une DEUXIÈME forme de groupe, en alternative de VEC_GROUP — rien d'autre.
//  - `+` (PAS `*`) sur la répétition : AU MOINS un « : » exigé. Un groupe à UNE seule valeur
//    « [139] » (zéro deux-points) n'est PAS couvert par la recherche de faux positifs faite
//    (corpus scanné pour « [\d…:\d…] », jamais pour « [\d…] » seul) — cette forme existe en
//    anglais (« cast on 90 [100] sts », notation 2-tailles déjà NON gérée par aucun chemin
//    avant ce correctif) et n'a JAMAIS été vérifiée : la laisser hors scope, non-invention.
const BRACKET_GROUP = String.raw`\[\s*${VEC_NUM}(?:\s*:\s*${VEC_NUM})+\s*\]`
const VEC_RE = new RegExp(
  String.raw`${FREE_RUN}(?:(?:${VEC_GROUP}|${BRACKET_GROUP})\s*${TAIL_RUN})+`,
  'g',
)
const NUM_RE = new RegExp(NUM, 'g')

// Légende de diagramme « Corazón color 1 (019) » (points/couleurs d'un jacquard, répétée
// 1×/couleur) : un run libre à UNE valeur (l'index N de la légende) suivi d'un groupe à UNE
// valeur en notation « code produit » (3 chiffres) ne doit PAS être lu comme un vrai vecteur
// de tailles composé — même forme syntaxique que « 36 (38) 40 » (nombre + groupe), mais 4
// occurrences de cette légende suffisaient à fabriquer n=2 tailles fictives (T1/T2) au repli
// modal (≥3 occurrences cohérentes), perdant la vraie section Tailles mono-taille du patron
// (bug vérifié sur heart-full-of-joy-pillow-es-ba96e958, campagne de test 22/07).
// Garde ÉTROITE au motif lexical : shape = EXACTEMENT « nombre (3 chiffres) », rien avant ni
// après dans le vecteur — un vrai « 36 (38) 40 » ou « 36 (38, 40, 42) » ne matche jamais cette
// forme (nombre de tête sur 3 chiffres possible, mais un TROISIÈME token ou une virgule dans
// le groupe fait toujours échouer COLOR_LEGEND_SHAPE_RE) — ET mot-clé couleur immédiatement
// avant (aucun vrai vecteur de tailles du gate n'a « color »/« farve »/etc. collé au nombre :
// vérifié sur les 25 réf., cf. dorn-children-s-sweater-da où « farver » précède le vecteur de
// loin dans la phrase, jamais adjacent).
const COLOR_LEGEND_SHAPE_RE = /^\d+\s*\(\s*\d{3}\s*\)$/
const COLOR_KEYWORD_PREFIX_RE = /\b(?:colou?rs?|couleurs?|farben?|farve[nr]?|farger?|kleur(?:en)?|colori?|kolor(?:y)?)\s*$/i

// Notation européenne à barres « 6/6/7/7/7/8/8 » : un vecteur par taille aussi.
// ≥ 3 valeurs exigées (une simple fraction « 3/4 » ne doit pas devenir un vecteur).
const SLASH_VEC_RE = new RegExp(String.raw`(?<![\d/])${NUM}(?:\s*/\s*${NUM}){2,}(?![\d/])`, 'g')

// Notation à tirets « 80-88-96-100-110-122-134 » (DROPS et beaucoup d'éditeurs EN/nordiques).
// ≥ 3 valeurs exigées (une simple plage « 80-88 » ne doit pas devenir un vecteur).
const SIMPLE_NUM = String.raw`\d+(?:[.,]\d+)?`
// Segment de run à tirets (≥ 2 valeurs) : brique de la forme imbriquée DROPS ci-dessous.
const DASH_SEG = String.raw`${SIMPLE_NUM}(?:\s*-\s*${SIMPLE_NUM})+`
// Vecteurs DROPS imbriqués (témoin pennine-es-3cb3c709, vague 3 → corrigé 04/09) : la
// convention DROPS des patrons à nombreuses tailles écrit les vecteurs par groupes de 4
// séparés par des parenthèses — « 6-7-8-9 (10-11-12-13) 14-15-16-17 » = 12 valeurs, PAS
// trois vecteurs de 4 ; sur un patron à 12 tailles, aucun vecteur ne s'alignait (rejeu
// 04/09 : vectorsSeen 18, vectorsOk 0). La tête garde son plancher de 3 valeurs (forme
// simple EXACTEMENT inchangée), puis chaque groupe « ( segment ) segment » prolonge le
// run. Non-invention : le groupe parenthésé doit être PUREMENT un run à tirets suivi
// d'un autre run à tirets — la moindre prose « (ou 20-25) » casse la fusion et retombe
// sur le comportement antérieur (vecteurs séparés, jamais fusionnés).
const DASH_VEC_RE = new RegExp(
  String.raw`(?<![\d.,-])${SIMPLE_NUM}(?:\s*-\s*${SIMPLE_NUM}){2,}(?:\s*\(\s*${DASH_SEG}\s*\)\s*${DASH_SEG})*(?![\d.,-])`,
  'g',
)

// Notation à crochets « a, (b,c,d), e, [f,g,h] » (Bobine & Pelote et éditeurs FR) : un run
// « virgules + groupes (…) ET […] alternés » qui doit être APLATI en UNE liste ordonnée.
// Grammaire : NUM (, (GROUP | NUM))+, GROUP ∈ {(NUM,…), [NUM,…]}. On exige au moins un
// groupe crocheté dans le run (garde en aval) pour ne pas capter une liste de nombres en prose.
// La virgule est ICI un SÉPARATEUR : le nombre n'admet que le point décimal (`BR_NUM`), sinon
// « 1,1 » serait à la fois un décimal ET deux valeurs séparées → backtracking catastrophique
// (ReDoS) sur un groupe non fermé. Point-seul lève l'ambiguïté → parcours linéaire.
const BR_NUM = String.raw`\d+(?:\.\d+)?`
const BR_GROUP = String.raw`[([]\s*${BR_NUM}(?:\s*,\s*${BR_NUM})*\s*[)\]]`
const BR_ITEM = String.raw`(?:${BR_GROUP}|${BR_NUM})`
const BRACKET_VEC_RE = new RegExp(
  String.raw`(?<![\d.,([])${BR_NUM}(?:\s*,\s*${BR_ITEM})+`,
  'g',
)
const BR_NUM_RE = new RegExp(BR_NUM, 'g')

export function findSizeVectors(line) {
  const out = []
  let m
  const src = String(line ?? '')
  // Crochets d'abord : le run entier (aplati) prime sur le groupe (…) interne que VEC_RE
  // verrait sinon ; VEC_RE saute ensuite tout chevauchement avec ce run.
  BRACKET_VEC_RE.lastIndex = 0
  while ((m = BRACKET_VEC_RE.exec(src))) {
    if (!/[([]/.test(m[0])) continue // exiger un vrai groupe crocheté dans le run
    const values = (m[0].match(BR_NUM_RE) || []).map((v) => v.replace(/\s+/g, ''))
    if (values.length >= 2) out.push({ start: m.index, end: m.index + m[0].length, values })
  }
  VEC_RE.lastIndex = 0
  while ((m = VEC_RE.exec(src))) {
    // Garde multiplicateur crochet : « [1 aug] x6 (12) » → « 6 (12) » n'est pas un vecteur
    // de TAILLES mais un compte de répétition (×6) suivi du total de mailles (amigurumi taille
    // unique). Rejeter si le nombre de tête est précédé d'un opérateur de répétition (x/×/*),
    // lui-même précédé d'un non-lettre (pour ne pas confondre avec la fin d'un mot en « x »).
    if (/(?:^|[^\p{L}])[x×*]\s*$/u.test(src.slice(0, m.index))) continue
    const span = m[0]
    const trimmed = span.replace(/\s+$/, '')
    const values = (trimmed.match(NUM_RE) || []).map((v) => v.replace(/\s+/g, ''))
    // Garde légende couleur (cf. commentaire COLOR_LEGEND_SHAPE_RE plus haut) : rejette
    // UNIQUEMENT « <n> (<code 3 chiffres>) » précédé au ras du texte par un mot-clé couleur.
    if (
      COLOR_LEGEND_SHAPE_RE.test(trimmed) &&
      COLOR_KEYWORD_PREFIX_RE.test(src.slice(0, m.index))
    ) continue
    if (
      values.length >= 2 &&
      !out.some((v) => m.index < v.end && m.index + trimmed.length > v.start)
    ) {
      out.push({ start: m.index, end: m.index + trimmed.length, values })
    }
  }
  SLASH_VEC_RE.lastIndex = 0
  while ((m = SLASH_VEC_RE.exec(src))) {
    const values = (m[0].match(NUM_RE) || []).map((v) => v.replace(/\s+/g, ''))
    if (values.length >= 3 && !out.some((v) => m.index < v.end && m.index + m[0].length > v.start)) {
      out.push({ start: m.index, end: m.index + m[0].length, values })
    }
  }
  DASH_VEC_RE.lastIndex = 0
  while ((m = DASH_VEC_RE.exec(src))) {
    // Découpe sur tirets ET espaces, parenthèses préalablement retirées : NUM_RE ne
    // convient pas ici (son groupe optionnel « -NUM » fusionnerait deux valeurs
    // adjacentes en une seule), et la forme imbriquée DROPS mélange les deux séparateurs
    // une fois les parenthèses retirées (« 6-7-8-9 (10-11-12-13) 14 » → « - » entre les
    // valeurs d'un segment, «  » entre segments). La forme simple redonne exactement les
    // mêmes valeurs qu'avant (le séparateur consomme les espaces autour des tirets).
    const values = m[0].replace(/[()]/g, ' ').split(/\s*(?:-|\s)\s*/).map((v) => v.replace(/\s+/g, ''))
    if (values.length >= 3 && !out.some((v) => m.index < v.end && m.index + m[0].length > v.start)) {
      out.push({ start: m.index, end: m.index + m[0].length, values })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

export function applySizeVectors(line, n) {
  const src = String(line ?? '')
  if (!n || n < 2) return { t: src, c: [] }
  const vecs = findSizeVectors(src).filter((v) => v.values.length === n)
  if (!vecs.length) return { t: src, c: [] }
  let t = ''
  let last = 0
  const c = []
  vecs.forEach((v, i) => {
    t += src.slice(last, v.start) + `{{${i}}}`
    c.push(v.values)
    last = v.end
  })
  t += src.slice(last)
  return { t, c }
}

// Notation PAPIER alternée du dialecte : « a (b) c (d) e » — la 1re valeur hors
// parenthèses, puis alternance. Le moteur la produit déjà pour les RANGS (via
// applySizeVectors → repères {{i}} → sérialiseur), mais PAS pour le texte des blocs
// référence, qui reste une chaîne simple. PDF réel Mia Cardigan : les quantités de fil
// gardaient le groupement du PDF (« 300 (300, 350, 350, 350) (400, …) 500, 500 g »),
// illisible par taille dans l'app.
// Ne réécrit QUE les vecteurs COMPLETS (exactement n valeurs) : un vecteur incomplet est
// laissé verbatim — le réécrire inventerait ou décalerait des valeurs.
// Réécrit UNE ligne (jamais de \n dedans) : findSizeVectors traite \n comme un simple \s,
// donc un nombre en fin d'une ligne pourrait se lier au groupe en tête de la SUIVANTE
// (« Cast on 10\n(15, 20) mm » lit un faux vecteur à 3 valeurs [10, 15, 20] qui n'existe
// dans AUCUNE des deux lignes prise seule — vérifié par test). toPaperNotation reçoit des
// textes multi-lignes (`needles.join('\n')`, `yarns.join('\n')`, `gaugeLines.join('\n')`) :
// on découpe donc AVANT de chercher un vecteur, jamais après, pour qu'un \n soit toujours
// une frontière infranchissable — même non-invention que le reste de la fonction, portée
// à la ligne plutôt qu'au texte entier.
function toPaperNotationLine(src, n) {
  const vecs = findSizeVectors(src).filter((v) => v.values.length === n)
  if (!vecs.length) return src
  let out = ''
  let cursor = 0
  for (const v of vecs) {
    out += src.slice(cursor, v.start)
    out += v.values.map((val, i) => (i === 0 ? val : i % 2 === 1 ? `(${val})` : val)).join(' ')
    cursor = v.end
  }
  return out + src.slice(cursor)
}

export function toPaperNotation(text, n) {
  const src = String(text ?? '')
  if (!n || n < 2) return src
  return src.split('\n').map((line) => toPaperNotationLine(line, n)).join('\n')
}

// Libellés de tailles : 1) ligne « Tailles : … » (multilingue) ; 2) ligne d'en-tête
// composée uniquement de tokens de taille « S/M (M/L) » ; 3) repli longueur modale
// (T1..Tn) ; 4) aucun.
const SIZE_LINE_RE = /^(?:tailles?|sizes?|gr[öo](?:ß|ss)en?|st[øo]rrelser?|storlek(?:ar)?|koot|koko|tallas?|taglie|taglia|maten|maat|rozmiar(?:y)?)\s*[:-]?\s*(.+)$/i
const LABEL_TOKEN_RE = /[A-Za-z0-9]{1,6}(?:[/-][A-Za-z0-9]{1,4})?/g
// Token de taille « lettré » : XS…6XL, S/M, 2XL, ou âge (2-4 år / years / Jahre).
// Préfixe numérique plafonné à 6 : « 6XL » est le maximum OBSERVÉ du corpus mesuré
// (flutterby-top-en-e2b5644a, vague 7 — 11 tailles XXS…6XL ; refs banc et vague 7
// gréppées : rien au-delà). 7XL+ resterait hors grammaire (non-invention).
const SIZE_TOKEN = String.raw`(?:[2-6]?X{0,3}[SML](?:\/[2-6]?X{0,3}[SML])?|one\s?size|unique)`
const SIZE_HEADER_RE = new RegExp(String.raw`^${SIZE_TOKEN}(?:\s*[(（]\s*${SIZE_TOKEN}\s*[)）]|\s+${SIZE_TOKEN}){1,11}$`, 'i')

const SIZE_KEYWORD_ONLY_RE = /^(?:tailles?|sizes?|gr[öo](?:ß|ss)en?|st[øo]rrelser?|storlek(?:ar)?|koot|koko|tallas?|taglie|taglia|maten|maat|rozmiar(?:y)?|tama[ñn]os?)\s*:?\s*$/i

// Étiquette de taille DIMENSIONNELLE : une tête lettrée courte (1 à 3 mots, PAS de « : » ni
// de chiffre) puis 2 à 4 mesures séparées par « x »/« × » (espaces tolérés), UNE des mesures
// pouvant porter un préfixe hauteur/diamètre « H »/« ⌀ »/« Ø » (« H 9 »), l'unité cm/mm en
// FIN de ligne (borne la regex : rien ne peut suivre).
// Cas réel mesuré moss-stitch-basket-square-fr-d86efcef (vague 6, Retours-banc, Go Handmade,
// paniers crochet) : « Panier 15 x 15 x H 9 cm » / « Panier 18 x 18 x H 10 cm » / « Panier
// 22 x 22 x H 11 cm » — titres forts par la taille de police seule, dont les sous-étiquettes
// faibles (« Le fond: », « Les parois: ») vidaient la section avant ce correctif (cf.
// subLabelUnderDimensionalTitle, segment.js).
// Contre-exemples qui bornent le scope (vérifiés par test) :
//  - « Dimensions: D 15 cm x H 9 cm/Cosy fil 150 g. » : tête interrompue par « : », et
//    l'unité n'est PAS en fin de ligne (du texte suit la 1re mesure) → rejeté ;
//  - « 4,0 - 4,5 mm » : aucune tête lettrée → rejeté ;
//  - « Sunflower (#36) - 1 Knäuel » (flamingo-love-blanket-de) : parenthèse/chiffres en
//    queue, aucune mesure dimensionnelle → rejeté ;
//  - « Panier avec fond rigide et trous » : aucune mesure → rejeté ;
//  - « Cosy 108 x 108 cm 600 g » (granny-shawl-jacket, étiquette de pelote) : un grammage
//    suit l'unité → l'unité n'est pas en fin de ligne → rejeté.
// VOCATION PARTAGÉE : exportée pour segment.js (garde subLabelUnderDimensionalTitle) ET
// pour detectSizeLabels (ce fichier, branche dimensionnelle : y reconnaître des libellés
// de tailles dimensionnels réels au lieu du repli modal T1..Tn). Une seule grammaire pour
// les deux consommateurs — pas de copie divergente.
const DIM_HEAD = String.raw`\p{L}[\p{L}\-']*(?:\s+\p{L}[\p{L}\-']*){0,2}`
const DIM_NUM = String.raw`\d+(?:[.,]\d+)?`
const DIM_PREFIX = String.raw`(?:[H⌀Ø]\s*)?`
// Groupe 1 = queue « mesures+unité » : le LIBELLÉ retenu par la branche dimensionnelle de
// detectSizeLabels (ci-dessous) est cette sous-chaîne SANS la tête lettrée (« 15 x 15 x
// H 9 cm », pas « Panier 15 x 15 x H 9 cm ») — la tête est identique d'une taille à
// l'autre, donc redondante dans un sélecteur de tailles. Extraite par capture DANS la
// regex complète (ancre ^ : la coupe tête/queue est déterministe, jamais un suffixe
// leftmost ambigu), pas par une regex sœur qui pourrait dériver.
export const DIMENSIONAL_SIZE_TITLE_RE = new RegExp(
  String.raw`^${DIM_HEAD}\s+(${DIM_PREFIX}${DIM_NUM}(?:\s*[x×]\s*(?:${DIM_PREFIX}${DIM_NUM})){1,3}\s*(?:cm|mm))\s*$`,
  'iu',
)

// Garde anti-invention (bug réel, penny-socks-es-3b0f0a03) : SIZE_LINE_RE est ANCRÉE en
// tête de LIGNE, pas de PHRASE — un mot-clé de taille peut atterrir en tête de ligne par
// pur hasard de retour à la ligne du PDF, au milieu d'une phrase de prose marketing qui
// n'annonce aucune liste de tailles (« …ancho. Se ajusta aproximadamente a las » /
// « tallas 36/37 - 38/39 - 40/41. » : deux lignes PDF distinctes, la seconde commençant
// par « tallas » sans jamais être un en-tête). Sans garde, cette phrase produisait 3
// FAUSSES tailles (36/37, 38/39, 40/41) alors que le patron n'en déclare qu'une seule
// (TALLA: 36-41, une plage de pointure pour une taille élastique unique — cf. TALLA
// plus haut, correctement rejetée car un vecteur à 1 seule valeur).
// Signal retenu : la queue (après le mot-clé) finit par une ponctuation de FIN DE PHRASE
// (« . »/« ! »/« ? ») — aucun vrai libellé de tailles ne finit jamais ainsi (« XS (S) M
// (L) XL », « 104 110 116 122 », « 6 (12, 18, 24) Monate », « Größen 92 (98) 104 » —
// jamais de point final), alors qu'une phrase de prose qui se termine là, elle, oui.
// Signal ÉCARTÉ (revue) : « la ligne PRÉCÉDENTE finit par une minuscule » avait été
// envisagé comme second signal indépendant, mais produit de VRAIS faux négatifs — un nom
// allemand porte sa majuscule sur sa PREMIÈRE lettre, pas la dernière : un TITRE Title-Case
// parfaitement légitime (« Größentabelle », une légende « Für Babys im Alter von 0 bis 3
// Monaten », une phrase-légende « Empfohlen für folgende Körpergröße ») finit presque
// toujours par une minuscule sans être une phrase inachevée. Ce signal aurait rejeté à
// tort l'en-tête RÉEL qui les suit (« Größe: 92 (98) 104 », « Größen 92 (98) 104 » — sans
// point final, donc non rattrapé par le signal retenu) — la classe de régression inverse
// (perte de vraies tailles) que ce correctif visait justement à éviter. Retiré : le seul
// signal fiable mesuré est la ponctuation de fin de phrase de la queue elle-même.
// Risque résiduel assumé (non-invention) : un en-tête réel à une seule ligne qui finirait,
// par un choix de style inhabituel, par un point (jamais observé dans le corpus mesuré)
// serait manqué et retomberait sur le repli modal ou `from:'none'` — direction de panne
// SÛRE (on perd un libellé plutôt que d'en fabriquer un), cohérente avec le reste de ce
// fichier (cf. commentaires findSizeVectors plus haut).
const SIZE_LINE_SENTENCE_END_RE = /[.!?]\s*$/
const looksLikeWrappedProseLine = (tail) => SIZE_LINE_SENTENCE_END_RE.test(tail)

// Allemand « Monate »/« Monat » (monate?), espagnol « años »/« año » (a[ñn]os?, ñ tolérée en
// n comme ailleurs dans ce fichier pour öo/ß·ss — OCR sans diacritique) : manquaient à côté
// de « mois »/« months »/« meses » déjà couverts, malgré une couverture par ailleurs large.
// Bug vérifié sur 2 patrons réels (campagne de test) : `sizes:` retombait sur le placeholder
// générique T1..Tn faute de reconnaître l'unité d'âge, PERDANT les vraies tranches d'âge.
const AGE_UNIT = String.raw`(?:ans|år|jahre?|monate?|years?|yrs|mdr|m[åa]neder|months?|mois|meses|mesi|a[ñn]os?|maanden|kk|v(?:uotta)?|lat)`
// Libellé de taille « âge » : nombre/tranche + unité conservée (« 9-12 mois », « 1-2 ans »).
const AGE_LABEL_RE = new RegExp(String.raw`\d{1,3}(?:\s*[-–]\s*\d{1,3})?\s+${AGE_UNIT}\b`, 'gi')
// Résidu autorisé une fois les libellés d'âge retirés : parenthèses, séparateurs, espaces.
const AGE_RESIDUE_RE = /[()（）,;:.\-\s–]/g
// Simple présence d'un MOT d'unité d'âge, sans exiger qu'il soit collé à un chiffre (contrairement
// à AGE_LABEL_RE) — sert à reference.js pour détecter les cas où sizeLineTokens est retombé sur le
// repli générique tokensOf (tokens numériques nus) alors que la ligne mentionnait bel et bien une
// unité d'âge : l'unité a alors été perdue du front-matter, et la ligne doit rester dans le corps.
const AGE_WORD_RE = new RegExp(String.raw`\b${AGE_UNIT}\b`, 'i')
export function hasAgeUnitWord(text) {
  return AGE_WORD_RE.test(String(text ?? ''))
}
// Séparateur de GROUPE lettré « [/-] » : « XS-S » (tiret) au même titre que « S/M » (barre),
// en miroir de LABEL_TOKEN_RE qui admet déjà les deux. Avant, seul « / » était accepté ici :
// « XS-S » collé était rejeté par SIZE_TOKEN_RE (tokens ≠ raw → tokensOf null), et « XS - S »
// ESPACÉ éclatait en deux tokens individuels « XS »/« S » (LABEL_TOKEN_RE ne joint que collé)
// → la ligne de groupes « (XS - S) (M - XL) (2XL - 4XL) (5XL) » produisait 7 tailles
// individuelles pour des vecteurs à 4 valeurs (very-granny-cardigan-fr-cb10fc64) : mapping
// tailles↔valeurs faux sur tout le patron, invariant 7=7 passant sans rien détecter.
// Préfixe numérique [2-6] : même plafond que SIZE_TOKEN ci-dessus (6XL observé sur
// flutterby-top-en-e2b5644a, jamais au-delà dans le corpus mesuré).
const SIZE_TOKEN_RE = /^(?:[2-6]?X{0,3}[SML](?:[/-][2-6]?X{0,3}[SML])?|\d{1,3}(?:[-/–]\d{1,3})?|one\s?size|unique)$/i
// Unité d'âge SEULE (token isolé) : DÉRIVÉE de AGE_UNIT (source unique) — un ancien doublon
// divergent de cette liste (recopiée à la main) laissait « Monate »/« años » reconnus par
// AGE_LABEL_RE mais pas ici, ce qui polluait tokensOf (le mot restait dans les tokens bruts
// sans jamais matcher un token de taille valide → rejet silencieux de toute la ligne).
const AGE_RE = new RegExp(String.raw`^${AGE_UNIT}$`, 'i')
// Ligne « tailles par âge » ENTIÈREMENT composée de libellés d'âge (unité comprise) :
// renvoie ces libellés en conservant l'unité (« 9-12 mois »), sinon null.
const ageTokensOf = (text) => {
  const s = String(text)
  const toks = s.match(AGE_LABEL_RE)
  if (!toks || toks.length < 1) return null
  if (s.replace(AGE_LABEL_RE, '').replace(AGE_RESIDUE_RE, '')) return null
  return toks.map((t) => t.replace(/\s+/g, ' ').trim())
}
// Libellé de taille « âge » en notation papier, UNITÉ UNIQUE en fin de ligne pour tout
// le groupe (« Prématuré-0 (0-3, 3-6, 6-9, 9-12) mois », « 1-2 (2-3) 3-4 (4-5) 5-6 (6-7)
// ans ») : ageTokensOf échoue ici car l'unité n'est adjacente à AUCUNE valeur individuelle.
// On retire l'unité finale, on fait porter le vecteur numérique restant par
// findSizeVectors (même grammaire papier que le reste du moteur) et on ré-attache : le
// préfixe textuel éventuel (« Prématuré- ») à la 1re valeur, l'unité à la DERNIÈRE — pas
// par valeur, pour rester fidèle à la lecture verbatim de la ligne d'origine.
// Variante « barre de pluriel » ES (candy-cane-stripes-children-s-sweater-es, campagne de
// test vague 6) : « (1-2, 3-4, 5-6) (7-8, 9-10) año/s » — Hobbii ES écrit couramment le
// pluriel optionnel d'un mot par un « /s » final plutôt qu'un « s » agglutiné (même
// convention que « p/pts = punto/s » dans la légende ABREVIATURAS de ce même document).
// AGE_UNIT (a[ñn]os?) ne matche pas le « / » : sans variante, TRAILING_AGE_UNIT_RE
// échouait, vectorAgeLabelsOf retombait sur null, et faute d'aucun autre analyseur reconnaissant
// la ligne, detectSizeLabels retombait sur le repli modal générique T1..T5, FABRIQUANT une
// fausse structure de tailles (aucune des 5 vraies tranches d'âge « 1-2, 3-4, 5-6, 7-8, 9-10
// año/s » n'était retenue). Portée volontairement ÉTROITE, à DEUX niveaux :
//  1. AGE_UNIT_TRAILING_RE est une variante DÉRIVÉE utilisée UNIQUEMENT ici (AGE_UNIT
//     lui-même, AGE_LABEL_RE, AGE_RE, AGE_WORD_RE, MIXED_ITEM_RE restent inchangés — seule
//     la forme ANCRÉE en fin de ligne a besoin du « /s », les autres usages de AGE_UNIT ne
//     l'exigent pas ou le matchent déjà via \b, cf. AGE_WORD_RE).
//  2. Le suffixe « /s » n'est ajouté qu'à l'alternative ESPAGNOLE (a[ñn]os?), en AJOUTANT une
//     alternative « a[ñn]os?/s » à côté d'AGE_UNIT inchangé — PAS en plaçant `(?:/s)?` après
//     tout AGE_UNIT (ce qui l'aurait attaché à TOUTE la disjonction, acceptant à tort
//     « ans/s », « months/s », « Jahre/s »… jamais vérifiés sur corpus pour cette convention
//     — revue de code du commit c1968436). Suffixe exact « /s » (pas « /e?s » ni un
//     « /[a-zñ]+ » générique) : aucune autre forme (« mes/es », p. ex., nécessiterait un
//     « mes » singulier absent d'AGE_UNIT) n'a été observée dans le corpus — l'étendre
//     au-delà serait de l'invention.
const AGE_UNIT_TRAILING_RE = String.raw`(?:${AGE_UNIT}|a[ñn]os?/s)`
const TRAILING_AGE_UNIT_RE = new RegExp(String.raw`^(.*\S)\s+(${AGE_UNIT_TRAILING_RE})\s*$`, 'i')
const vectorAgeLabelsOf = (text) => {
  const m = TRAILING_AGE_UNIT_RE.exec(String(text).trim())
  if (!m) return null
  const rest = m[1]
  const unit = m[2]
  const vecs = findSizeVectors(rest)
  if (vecs.length !== 1) return null
  const v = vecs[0]
  // Le vecteur doit couvrir toute la fin de la ligne (hors unité) ; le préfixe résiduel
  // avant lui doit rester COURT (garde anti faux positif sur une phrase quelconque).
  if (v.end !== rest.length || v.start > 20 || /[:;]/.test(rest.slice(0, v.start))) return null
  const prefix = rest.slice(0, v.start)
  // Garde anti-fusion : un VRAI préfixe textuel (« Prématuré- », « Str ») ne contient jamais
  // de chiffre ni de virgule. Un préfixe qui en contient (« 18 Monate, ») signale en réalité
  // une AUTRE taille/unité en tête de ligne (deux unités d'âge sur la même ligne, « Größe: 18
  // Monate, (2, 4, 6, 8) Jahre ») que ce mécanisme ne sait pas décomposer : mieux vaut échouer
  // proprement (repli sur tokensOf, décompte correct mais sans unité récupérée) que FUSIONNER
  // à tort deux tailles distinctes dans un même libellé (« 18 Monate, 2 ») — ce qui, pire
  // encore, faussait le NOMBRE de tailles détectées (n) pour tout le reste du document (n =
  // labels.length dans le pipeline, cf. assemble.js), gelant le gabarit multi-tailles du corps.
  if (/[,\d]/.test(prefix)) return null
  const labels = v.values.map((val, idx) => (idx === 0 ? prefix + val : val))
  labels[labels.length - 1] = `${labels[labels.length - 1]} ${unit}`
  return labels
}
// Libellé de taille « texte+âge » à PARENTHÈSE PARTIELLE : un SEUL item (le 2e, ici) est
// entre parenthèses, les autres restent nus — contrairement à la notation vectorielle où
// c'est le NOMBRE qui serait parenthésé (« 36 (38) 40 »), ici chaque item est un LIBELLÉ
// TEXTE COMPLET (« Bebé/0-1 año (Niño/2-15 años) Adulto »). ageTokensOf échoue (préfixe
// textuel « Bebé/ »/« Niño/ » n'est pas un résidu de ponctuation) ; vectorAgeLabelsOf échoue
// (la ligne ne se termine pas par une unité d'âge nue : dernier item « Adulto », un mot sans
// chiffre). Bug vérifié sur knitted-crown-headband-es-a5a5513c (campagne palier 8/8) :
// `sizes:` retombait sur T1/T2/T3 générique (repli modal), perdant les 3 vrais libellés.
// Scope ÉTROIT (non-invention) : exactement 3 items (avant/dans/après UNE seule parenthèse),
// chacun DÉMARRANT par une lettre (un item démarrant par un chiffre nu relève déjà de
// vectorAgeLabelsOf/findSizeVectors, hors périmètre ici) ; au moins un des 3 doit porter un
// chiffre ou une unité d'âge (garde anti faux positif — une parenthèse de prose quelconque,
// « Rojo (Azul) Verde », ne doit jamais devenir une ligne de tailles).
const MIXED_ITEM_RE = String.raw`\p{L}[\p{L}0-9/\-]*(?:\s+${AGE_UNIT})?`
const MIXED_LABEL_LINE_RE = new RegExp(
  String.raw`^(${MIXED_ITEM_RE})\s*\(\s*(${MIXED_ITEM_RE})\s*\)\s*(${MIXED_ITEM_RE})$`,
  'iu',
)
const mixedAgeLabelsOf = (text) => {
  const s = String(text).trim()
  const m = MIXED_LABEL_LINE_RE.exec(s)
  if (!m) return null
  const labels = [m[1], m[2], m[3]].map((t) => t.trim())
  if (!labels.some((l) => AGE_WORD_RE.test(l) || /\d/.test(l))) return null
  return labels
}
const tokensOf = (text) => {
  // Garde PT2b : une VRAIE ligne de tailles (« S M L XL XXL », « 104 110 116 122 ») ne
  // contient jamais « = » ni une unité de mailles écrite « m. ». « taille M = 122 m. » est
  // une légende de grille (nb de mailles pour une taille), pas la liste des tailles.
  // IMPORTANT : exiger « m. » AVEC point (ou mots pleins) — surtout PAS « \bm\b », qui
  // matcherait le token de taille « M » nu et rejetterait « S M L XL XXL ».
  if (/=/.test(text) || /\bm\.|\bmailles\b|\bsts\b|\bsc\b/i.test(text)) return null
  // Groupes de tailles ESPACÉS « (XS - S) (M - XL) » (very-granny-cardigan-fr-cb10fc64) :
  // LABEL_TOKEN_RE ne joint un séparateur de groupe « - »/« / » que COLLÉ aux tailles — sans
  // normalisation préalable, « XS - S » éclatait en deux tokens individuels et une ligne de
  // 4 groupes devenait 7 tailles XS·S·M·XL·2XL·4XL·5XL pour des vecteurs à 4 valeurs
  // (mapping tailles↔valeurs faux partout, l'invariant 7=7 passant sans rien détecter).
  // On resserre donc les espaces autour des séparateurs AVANT le scan, UNIQUEMENT pour
  // cette décision de tokenisation : ni le texte des lignes du corps ni les libellés
  // restitués ailleurs ne passent par ici (reference.js lit ses lignes verbatim ; seuls
  // les tokens retenus — « XS-S » collé, notation papier déjà produite par ailleurs —
  // sont sérialisés, dans `sizes:` et reader.sizeLabels par assemble.js).
  // MAIS conditionné à la présence de groupes PARENTHÉSÉS avec séparateur dedans : la
  // normalisation inconditionnelle (commit 3abc667f) transformait aussi TOUTE liste NUE
  // à tirets espacés en groupes faux — régression sunny-song-en-7331474f : « SIZE: /
  // S - M - L - XL - XXL – XXXL » (séparateur ENTRE tailles individuelles, aucun
  // groupement) rendait 4 faux groupes S-M·L-XL·XXL·XXXL au lieu de 6 tailles, et les
  // vecteurs DROPS à 6 valeurs ne matchaient plus n=4 (plus aucun {{i}}, subsizes
  // perdue). Corpus vérifié (vague7 + échantillon 231 PDF corpus-web) : les groupes à
  // séparateur espacé n'existent QUE parenthésés (very-granny, seul cas) ; les listes
  // NUES à tirets espacés (sunny-song ×9 lang. à tirets ASCII, sunflower-slip-top ×4
  // lang. au cadratin « – », jamais touché car hors [/-]) sont TOUJOURS des tailles
  // individuelles. Une liste nue garde donc le comportement d'origine : scan verbatim,
  // LABEL_TOKEN_RE saute naturellement le cadratin comme tout caractère hors token.
  // Les invariants existants (bornes 2-12, tokens.length === raw.length) restent le
  // garde anti-prose : « haut en bas - en une pièce » → « bas-en » n'est pas un token de
  // taille valide → rejet, comme avant.
  const raw0 = String(text)
  const norm = /\([^()]*[/-][^()]*\)/.test(raw0) ? raw0.replace(/\s*([/-])\s*/g, '$1') : raw0
  // Chaîne pure à barres « S/M/L/XL/XXL » : chaque segment est une taille.
  const chain = /^\s*([A-Za-z0-9-]{1,6}(?:\s*\/\s*[A-Za-z0-9-]{1,6}){2,})\s*$/.exec(norm)
  if (chain) {
    const parts = chain[1].split(/\s*\/\s*/)
    if (parts.length >= 3 && parts.length <= 12) return parts
  }
  const raw = (norm.match(LABEL_TOKEN_RE) || []).filter((t) => !AGE_RE.test(t) && !/^(cm|mm|in)$/i.test(t))
  // Ne garder que de VRAIS tokens de taille (XS…5XL, 1-2, 92/98…) : une phrase
  // commençant par « Taille » ne doit pas devenir une liste de tailles.
  const tokens = raw.filter((t) => SIZE_TOKEN_RE.test(t))
  return tokens.length >= 2 && tokens.length <= 12 && tokens.length === raw.length ? tokens : null
}
// Tentative combinée pour une ligne « mot-clé + valeurs » (le texte APRÈS le « : ») : essaie
// d'abord les libellés d'âge (unité par valeur, puis groupe+unité finale) avant le repli
// générique par tokens nus. Réutilisée par detectSizeLabels (branche SIZE_LINE_RE, ligne où
// mot-clé ET valeurs cohabitent — « Größe: 18 Monate, … », « Talla: 2 (4, 6) años ») ET par
// reference.js (extractReference) pour savoir si CETTE MÊME ligne du corps du patron, une
// fois ses valeurs captées dans le front-matter `sizes:`, peut être retirée du corps sans
// perte de contenu (sinon elle doit y rester verbatim).
export function sizeLineTokens(text) {
  return ageTokensOf(text) || vectorAgeLabelsOf(text) || mixedAgeLabelsOf(text) || tokensOf(text)
}

// Recoll BORNÉ d'un en-tête de tailles wrappé par la mise en page (bug réel vague 7 :
// stripe-raglan-sweater-little-one-s-tweens-girls-fr et flutterby-top-en). La liste
// « Tailles: 1-2 ans (3-4 ans) 5-6 ans » coupée avant « (7-8 ans) 9-10 ans (11-12 ans) »
// ne rendait que 3 tailles sur 6 déclarées ; « SIZE » suivi de « XXS (XS, S, M) [L, XL,
// 2XL] (3XL, 4XL, 5XL, » + « 6XL) » que 10 sur 11 — or n = labels.length pilote le
// gabarit multi-tailles de TOUT le document (assemble.js) : vecteurs du corps à n valeurs
// décalés, plus aucun {{i}}. Miroir du recoll des lignes d'âge de la branche « TAILLES »
// seul sur sa ligne ci-dessous : on parse la ligne seule, puis ses recolls avec 1 à 2
// lignes suivantes (borné), et l'on ne retient qu'un recoll qui parse ENTIÈREMENT —
// l'invariant `tokens.length === raw.length` de tokensOf (et le résidu de ponctuation
// pure d'ageTokensOf) restent LE garde anti-fabrication : une prose « Tailles: … »
// partielle suivie de sa suite ne fabrique jamais de tailles (contre-test en spec).
// On garde le résultat au PLUS GRAND nombre de libellés : un recoll qui échoue ne
// détruit jamais la lecture mono-ligne déjà acquise (non-régression).
// (revue) Ce « plus grand nombre » était la faille : SIZE_TOKEN_RE
// admet les nombres nus, donc une continuation PUREMENT NUMÉRIQUE — mesures wrappées
// « 76 82 88 cm » (l'unité est filtrée par tokensOf), vecteur DROPS « 84-92-100-… »,
// numéro orphelin « 16 » — parse ENTIÈREMENT en tokens de tailles et écrase la lecture
// mono-ligne correcte de l'en-tête (S M L + 6 fausses tailles au lieu de 3). Durcissement :
// une continuation n'est recollée QUE si elle apporte au moins un token NON purement
// numérique — une lettre (XS/S/M/L, âge, préfixe lettré) ; les mots d'unité d'âge
// (« ans », « Monate »…) comptent (ils portent les libellés d'âge réels), seule
// l'unité de MESURE cm/mm/in est ignorée, comme dans le filtre de tokensOf. Rejet
// = rupture du recoll (`break`) : les continuations sont ADJACENTES par construction,
// rien au-delà d'une continuation rompue ne peut prolonger l'en-tête.
const contHasLetteredToken = (cont) => {
  // cm/mm/in = seules unités de MESURE filtrées par tokensOf ; tout autre caractère LETTRÉ
  // (Unicode : le « å » de « år » danois compris — LABEL_TOKEN_RE est ASCII et ne le voit
  // pas) signale un apport non purement numérique, mot d'unité d'âge compris (« ans »,
  // « Monate »… portent les vrais libellés d'âge). Garde SOUPLE voulue : accepter une
  // continuation trop large est inoffensant, l'invariant tokens/raw de tokensOf rejette
  // de toute façon le recoll s'il ne parse pas comme un en-tête complet.
  return /\p{L}/u.test(String(cont ?? '').replace(/\b(?:cm|mm|in)\b/gi, ''))
}
function sizeLineTokensReglued(base, conts) {
  const single = sizeLineTokens(base)
  let best = single && single.length >= 2 && single.length <= 12 ? single : null
  let text = String(base ?? '').trim()
  for (const cont of conts) {
    if (cont == null) break
    if (!contHasLetteredToken(cont)) break
    text += ' ' + String(cont).trim()
    const toks = sizeLineTokens(text)
    if (toks && toks.length >= 2 && toks.length <= 12 && (!best || toks.length > best.length)) best = toks
  }
  return best
}

export function detectSizeLabels(pages) {
  const all = (pages || []).flat()
  for (let i = 0; i < all.length; i++) {
    const l = all[i]
    // « TAILLES » seul sur sa ligne : les valeurs sont sur la ligne suivante. Test contre
    // une copie foldée (ẞ→ß, cf. text-norm.js — /i seul ne le fait pas) : la ligne suivante
    // (all[i + 1]) reste lue verbatim, seule cette décision de classification est foldée.
    if (SIZE_KEYWORD_ONLY_RE.test(foldEszett(l.text.trim()))) {
      // (a) libellés « par âge » possiblement wrappés sur plusieurs lignes : recoller les
      // continuations tant qu'elles restent des lignes de tailles-âge pures, unités comprises.
      const first = all[i + 1] && ageTokensOf(all[i + 1].text)
      if (first) {
        let labels = first
        for (let j = i + 2; all[j]; j++) {
          const cont = ageTokensOf(all[j].text)
          if (!cont) break
          labels = labels.concat(cont)
        }
        if (labels.length >= 2 && labels.length <= 12) return { labels, from: 'line' }
      }
      const grouped = all[i + 1] && vectorAgeLabelsOf(all[i + 1].text)
      if (grouped && grouped.length >= 2 && grouped.length <= 12) return { labels: grouped, from: 'line' }
      const mixed = all[i + 1] && mixedAgeLabelsOf(all[i + 1].text)
      if (mixed && mixed.length >= 2 && mixed.length <= 12) return { labels: mixed, from: 'line' }
      // Recoll borné (1-2 lignes suivantes) : « SIZE » puis « XXS (XS, S, M) [L, XL,
      // 2XL] (3XL, 4XL, 5XL, » / « 6XL) » (flutterby-top-en, vague 7) — la lecture
      // mono-ligne rendait 10 tailles sur 11. sizeLineTokens (et non tokensOf seul)
      // pour que le recoll bénéficie aussi des helpers d'âge/groupes sur la texte joint.
      const tokens = all[i + 1] && sizeLineTokensReglued(all[i + 1].text, [all[i + 2]?.text, all[i + 3]?.text])
      if (tokens) return { labels: tokens, from: 'line' }
      continue
    }
    // Fold ẞ→ß (cf. text-norm.js) pour la décision de match uniquement ; m[1] (la queue
    // après le mot-clé, jamais le mot-clé lui-même) reste ce qui alimente sizeLineTokens,
    // sans effet pratique puisque les valeurs de taille ne portent jamais de ẞ.
    const m = SIZE_LINE_RE.exec(foldEszett(l.text))
    if (m && !looksLikeWrappedProseLine(m[1])) {
      // Bug de routage corrigé : cette branche (mot-clé ET valeurs sur la MÊME ligne,
      // « Größe: 18 Monate, (2, 4, 6, 8) Jahre ») n'appelait QUE tokensOf, jamais les
      // helpers d'âge — même avec AGE_UNIT étendu, tokensOf seul rejette la ligne dès
      // qu'un mot d'unité d'âge non filtré s'y glisse, ou pire, la fait réussir SANS
      // l'unité (tokens nus ambigus, mois vs années perdus). sizeLineTokens tente
      // d'abord les libellés d'âge (avec unité conservée), sinon le repli générique.
      // Recoll borné (1-2 lignes suivantes) : la mise en page coupe la liste après
      // 2-3 libellés (« Tailles: 1-2 ans (3-4 ans) 5-6 ans » puis « (7-8 ans) 9-10 ans
      // (11-12 ans) », stripe-raglan vague 7) — la ligne seule rendait 3 tailles sur 6.
      const tokens = sizeLineTokensReglued(m[1], [all[i + 1]?.text, all[i + 2]?.text])
      if (tokens) return { labels: tokens, from: 'line' }
    }
    // PT2a : mot-clé « tailles » NON ancré (préfixe parasite d'une cellule de bandeau
    // recollée par Y, « Qualité sibéRie » devant « tailles S M L XL XXL »). On prend la
    // QUEUE après le mot-clé et on ne l'accepte que si c'est un en-tête de tailles PUR.
    // Fold ẞ→ß (cf. text-norm.js) pour la décision de match uniquement, même raison que
    // ci-dessus (« gr[öo](?:ß|ss)en? » sous /i).
    const um = /\b(?:tailles?|sizes?|gr[öo](?:ß|ss)en?|st[øo]rrelser?)\s*[:-]?\s+(.+)$/i.exec(foldEszett(l.text))
    if (um && um.index <= 20 && SIZE_HEADER_RE.test(um[1].trim())) {
      const tokens = tokensOf(um[1])
      if (tokens) return { labels: tokens, from: 'line' }
    }
  }
  for (const l of all) {
    const t = l.text.trim()
    if (!SIZE_HEADER_RE.test(t)) continue
    const labels = t.replace(/[()（）]/g, ' ').split(/\s+/).filter(Boolean)
    if (labels.length >= 2 && labels.length <= 12) return { labels, from: 'header' }
  }
  // Tailles en préfixe de ligne répété : « S/M: env. 250g », « L/XL: Longueur… ». Motif
  // conservateur — préfixe optionnel « Taille/Size/Str. » + token de taille lettré STRICT
  // (forme de SIZE_TOKEN, sans « one size »/« unique » qui ne sont pas des préfixes valides)
  // immédiatement suivi de « : ». Retenu seulement si ≥2 tokens DISTINCTS apparaissent chacun
  // ≥2 fois, dans l'ordre de première apparition, pour ne jamais confondre avec une simple
  // abréviation isolée (« M: maille »).
  const PREFIX_TOKEN = String.raw`[2-6]?X{0,3}[SML](?:\/[2-6]?X{0,3}[SML])?`
  const PREFIX_LINE_RE = new RegExp(String.raw`^(?:(?:taille|size|str\.?)\s+)?(${PREFIX_TOKEN})\s*:`, 'i')
  {
    const order = []
    const counts = new Map()
    for (const l of all) {
      const m = PREFIX_LINE_RE.exec(l.text.trim())
      if (!m) continue
      const token = m[1].toUpperCase()
      if (!counts.has(token)) order.push(token)
      counts.set(token, (counts.get(token) || 0) + 1)
    }
    const distinct = order.filter((t) => counts.get(t) >= 2)
    if (distinct.length >= 2) return { labels: distinct, from: 'prefix' }
  }
  const counts = new Map()
  for (const l of all) {
    for (const v of findSizeVectors(l.text)) counts.set(v.values.length, (counts.get(v.values.length) || 0) + 1)
  }
  let modal = 0
  let best = 0
  for (const [len, nb] of counts) {
    if (nb > best || (nb === best && len > modal)) {
      modal = len
      best = nb
    }
  }
  // Étiquettes DIMENSIONNELLES, dernier recours avant le repli modal : cas réel mesuré
  // moss-stitch-basket-square-fr-d86efcef (vague 6, Retours-banc, Go Handmade) — le PDF ne
  // déclare ses tailles nulle part ailleurs qu'en TITRES DE SECTION typographiés (« Panier
  // 15 x 15 x H 9 cm », « Panier 18 x 18 x H 10 cm », « Panier 22 x 22 x H 11 cm », taille
  // de police 14 vs corps 8), reconnus par DIMENSIONAL_SIZE_TITLE_RE (source unique de
  // vérité partagée avec subLabelUnderDimensionalTitle dans segment.js). Aucune
  // source ci-dessus ne les voit (ni mot-clé « Tailles », ni en-tête S/M/L, ni préfixe
  // répété) : sans cette branche, le repli modal fabriquait T1·T2·T3 (le corps porte 3
  // vecteurs à 3 valeurs, « 73 (97) 105 » ×3) et le front-matter affichait des tailles
  // fantômes à la place des vraies dimensions.
  // DISTINCT d'un arbitrage différé (prose « <taille> passt für <cm> » — y reconnaître
  // des tailles depuis de la PROSE non typographiée) : ici les étiquettes sont des TITRES
  // reconnus par DIMENSIONAL_SIZE_TITLE_RE, la même grammaire qui les a promus sections —
  // pas un nouveau lexique dimensionnel en texte libre.
  // PORTE ÉTROITE, à deux verrous :
  //  - position : APRÈS toutes les sources ci-dessus (un vrai libellé d'une autre source
  //    gagne toujours) et AVANT le repli modal uniquement — la branche ne s'exprime que là
  //    où ce repli allait FABRIQUER des T1..Tn (donc seulement si modal ≥ 2 && best ≥ 3,
  //    les conditions exactes du repli qu'elle remplace) ;
  //  - cohérence : le compte de libellés dédupliqués doit ÉGALER la longueur vectorielle
  //    dominante du corps (modal, calculée juste au-dessus pour le repli) — une divergence
  //    (2 titres pour des vecteurs à 3 valeurs) signale qu'on a capté autre chose que des
  //    tailles → pas de capture, comportement antérieur. Bornes 2..8 libellés DISTINCTS.
  {
    const dimLabels = []
    for (const l of all) {
      const t = l.text.trim()
      const m = DIMENSIONAL_SIZE_TITLE_RE.exec(t)
      if (!m) continue
      const label = m[1].replace(/\s+/g, ' ')
      if (!dimLabels.includes(label)) dimLabels.push(label)
    }
    if (
      dimLabels.length >= 2 &&
      dimLabels.length <= 8 &&
      modal >= 2 &&
      best >= 3 &&
      dimLabels.length === modal
    ) {
      return { labels: dimLabels, from: 'dimensional' }
    }
  }
  // ≥3 occurrences cohérentes exigées : évite de « voir » des tailles dans un patron mono-taille.
  if (modal >= 2 && best >= 3) return { labels: Array.from({ length: modal }, (_, i) => `T${i + 1}`), from: 'modal' }
  return { labels: [], from: 'none' }
}

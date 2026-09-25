// Cœur PUR de l'import local : pages de lignes typées → { pattern, reader, warnings,
// confidence, stats }. Aucune dépendance pdfjs/DOM → testable et exécutable sous Node.
import { validateReader, isSingleSize } from '../reader'
import { normalizeReaderForSave } from '../reader-edit'
import { segmentSections, detectTitle, kindForTitle } from './segment'
import { isLetterSpaced, despace, restoreWords } from './spaced-title'
import { detectSizeLabels, findSizeVectors, applySizeVectors } from './sizes'
import { linesToSteps } from './steps'
import { extractReference, execAbbrLine } from './reference'
import { computeConfidence } from './confidence'
import { computeBlocking, countMultiColPages } from './blocking'
import { stripBoilerplate } from './boilerplate'
import { reflowLines } from './reflow'
import { detectGerman } from './lang-detect'
import { consumeEaseHintLine } from './ease'
import { readColumnGlossary } from './glossary-columns'

const ROW_OR_REP = (st) => !st.note && !st.chart

// Extrait l'auteur d'une ligne (« X | Hobbii Design » ou « Design : X ») et NETTOIE
// le préfixe éditorial « Design: » quand la ligne « | Hobbii Design » le porte en tête
// (« Design: Libère tes mailles | Hobbii Design » → « Libère tes mailles | Hobbii Design »),
// pour coller au format des références (« Miss Beetle | Hobbii Design »). Renvoie null sinon.
// Préfixes éditoriaux de conception, forme « <préfixe> : X » (multilingue) : anglais
// « Design(er): », fr « Conception : », es « Diseño: », it « Progetto: », nl « Ontwerp: ».
const DESIGN_PREFIX_COLON = 'design(?:er)?|conception|dise[ñn]o|progetto|ontwerp'
// Forme « <verbe> <connecteur> X » (multilingue) : fr « Conçu par », es « Diseñado por »,
// it « Progettato da », nl « Ontworpen door », de « Entworfen von », da/no « Designet af/av ».
const DESIGN_PREFIX_BY = 'con[çc]u par|dise[ñn]ado por|progettato da|ontworpen door|entworfen von|designet a[fv]'
const DESIGN_STRIP_RE = new RegExp('^(?:' + DESIGN_PREFIX_COLON + ')\\s*:\\s*', 'i')
const DESIGN_CAPTURE_RE = new RegExp(
  '^(?:(?:' + DESIGN_PREFIX_COLON + ')\\s*:\\s*|(?:' + DESIGN_PREFIX_BY + ')\\s+)(.{2,70})$',
  'i',
)
// Pied de page « … Hobbii Design, <Nom> » : la designer nommée APRÈS « Hobbii Design, »
// (ex. « Tajo - Hobbii Design, Stina Frigaard »). Non ancré (peut être en pied). « Hobbii
// Design » gardé en casse exacte (marque) ; le nom commence par une majuscule. Capturé en
// NON-greedy jusqu'à la fin de ligne OU jusqu'à une suite « - Copyright … » : PDF réel
// « Metorit » (es), pied de page complet « Metorit - Hobbii Design, Sys Fredens -
// Copyright © 2020   Página 1 » — le nom n'est PAS en fin de ligne (mention copyright +
// numéro de page après), un ancrage `$` seul ne matchait jamais cette forme réelle.
const HOBBII_COMMA_RE = /Hobbii Design,\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'’.\- ]{1,38}?)(?:\s*-\s*[Cc]opyright\b|\s*$)/
// 3e VARIANTE du même bug (paliers 4/6 déjà patchés PONCTUELLEMENT sur ce symptôme, sans
// jamais toucher à l'exigence littérale « Hobbii Design, » ci-dessus) : PDF réel « Knitted
// Crown Headband » (es) — pied de page « Hobbii Friends - My Favourite Stitches, Katharina
// Müller - Copyright © 2021   Página 1 ». Le nom de collection avant la virgule N'EST PAS
// « Hobbii Design » (c'est un sous-label arbitraire, « Hobbii Friends - My Favourite
// Stitches » ici) → HOBBII_COMMA_RE ne matche jamais, quel que soit son plafond/ancrage.
// GÉNÉRALISATION RÉELLE (pas un 4e nom en dur) : on accepte n'importe quel texte de
// collection avant la virgule — seul le motif fixe « - Copyright » sert d'ancrage anti-faux-
// positif (vérifié sur 87 pieds de page « Copyright » réels échantillonnés dans le corpus :
// zéro faux positif, la quasi-totalité des lignes sans virgule+nom+Copyright n'ont soit pas
// de virgule du tout, soit pas de nom propre après). Contrairement à HOBBII_COMMA_RE, la fin
// de ligne seule (sans « - Copyright ») N'EST PAS acceptée ici : sans le nom de marque connu
// « Hobbii Design » comme garde-fou, une simple fin de ligne serait un ancrage bien trop
// faible (n'importe quelle ligne « texte, Mot Capitalisé » y matcherait). Le nom de
// collection écarté est du bruit d'édition (comme pour HOBBII_COMMA_RE) ; PAS de suffixe
// « | Hobbii Design » fabriqué ici (la marque réelle n'est pas forcément Hobbii Design) —
// cf. réf. oracle de référence `-ideal.md` du corpus : `author: Katharina Müller`, sans suffixe.
const GENERIC_COMMA_COPYRIGHT_RE = /,\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'’.\- ]{1,38}?)\s*-\s*[Cc]opyright\b/
// 5e forme, PDF réel Mia Cardigan (English) v1.1 : « © Coco Amour Knitwear 2025 – all
// rights reserved. » — la marque n'apparaît NULLE PART ailleurs en texte normal (le
// bandeau de couverture est interlettré, cf. detectTitle), donc sans cette variante
// l'auteur est perdu pour de bon (perte de contenu, pas cosmétique).
// Trois ancrages contre les faux positifs, mesurés sur le corpus :
// le symbole ©, un nom propre commençant par une MAJUSCULE, et une ANNÉE à 4 chiffres
// juste après. Une fin de ligne nue n'est PAS acceptée : sans l'année, « © tous droits
// réservés » capterait « tous droits réservés ».
const COPYRIGHT_BRAND_RE = /©\s*([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'’.&\- ]{1,38}?)\s+(?:19|20)\d{2}\b/
// Garde anti-faux-positif trouvee en balayant le corpus REEL (3234 PDF, pas seulement
// l'echantillon de 120) : PDF « Ivy Sweater Schematics », ligne « Mette Wendelboe Okkels
// ©COPYRIGHT 2025 » — le vrai nom est AVANT le ©, et sans garde COPYRIGHT_BRAND_RE captait
// le mot « COPYRIGHT » lui-meme comme s'il etait la marque (mefiant : le mot suit tous les
// ancrages du commentaire ci-dessus — majuscule, immediatement apres ©, annee derriere).
// ELARGIE en revue (meme mecanisme, mots voisins « All Rights Reserved », « No Commercial
// Use » : chacun suit exactement les memes trois ancrages sans etre un nom). Liste FERMEE
// de mots legaux generiques, 4 langues du projet (fr/en/es/de) — une source reelle par mot :
// - copyright : le bug initial mesure sur ce PDF (ci-dessus).
// - all, rights, reserved : boilerplate.js:9 (`all rights reserved`), deja verifiee sur le
//   corpus par le filtre de bruit d'edition de ce meme module.
// - no, commercial, use : formule « No Commercial Use » citee en revue de code, meme
//   mecanisme que COPYRIGHT (les 3 mots suivent les ancrages sans etre un nom).
// - tous, droits, réservé(e)(s) : ligne REELLE du corpus « Hobbii.fr - Copyright © 2019 -
//   Tous droits réservés » (anti-faux-positif deja couvert par GENERIC_COMMA_COPYRIGHT_RE,
//   cf. mdlab-engine.spec.js).
// - todos, los, derechos, reservado(s) : boilerplate.js:9 (`todos los derechos`), deja
//   verifiee sur le corpus.
// - alle, rechte, vorbehalten : boilerplate.js:9 (`alle rechte vorbehalten`), deja verifiee
//   sur le corpus.
// Critere : la capture est ecartee SEULEMENT si TOUS ses mots sont dans cette liste (la
// ponctuation type « & » est ignoree, pas comptee comme mot). Un seul mot generique ne
// suffit PAS a ecarter une marque reelle qui le contient (« Rights & Stitches » garde son
// mot « Stitches » hors liste ; « Design Studio » n'a aucun mot dans la liste).
const GENERIC_LEGAL_WORDS = new Set([
  'copyright',
  'all', 'rights', 'reserved',
  'no', 'commercial', 'use',
  'tous', 'droits', 'réservé', 'réservée', 'réservés', 'réservées',
  'todos', 'los', 'derechos', 'reservado', 'reservados',
  'alle', 'rechte', 'vorbehalten',
])
function isGenericLegalPhrase(s) {
  const words = (s.match(/\p{L}+/gu) || []).map((w) => w.toLowerCase())
  return words.length > 0 && words.every((w) => GENERIC_LEGAL_WORDS.has(w))
}

export function parseAuthorLine(text) {
  const t = String(text ?? '')
  const pipe = /^(.{2,70}?)\s*\|\s*Hobbii Design\s*$/i.exec(t)
  if (pipe) return t.trim().replace(DESIGN_STRIP_RE, '')
  const colon = DESIGN_CAPTURE_RE.exec(t)
  if (colon) {
    let x = colon[1].trim()
    // Fo2 : « Design: X | Garland, Autumn 2024 » → « | … » est une COLLECTION/saison,
    // pas un co-auteur. Signal SÛR = année 4 chiffres (les saisons Sommer/Winter/Summer
    // sont des patronymes → risque d'amputer un vrai auteur, écartées). On ne retire la
    // partie droite que si elle porte une année ET n'est pas un éditeur « … Design ».
    const pipeIdx = x.indexOf('|')
    if (pipeIdx > -1) {
      const left = x.slice(0, pipeIdx).trim()
      const right = x.slice(pipeIdx + 1).trim()
      if (left.length >= 2 && !/design\s*$/i.test(right) && /\b(?:19|20)\d{2}\b/.test(right)) x = left
    }
    return x
  }
  // #7 : marque en tête « <Marque> Design [: Modell …] » (DROPS/Garnstudio/Hobbii Design…).
  // Ancré début de ligne, marque courte SANS ponctuation, « Design » avec D majuscule
  // (n'attrape pas une phrase « … design … »), suivi de fin de ligne ou d'un « : n° modèle »
  // (jeté). Renvoie « <Marque> Design » pour coller aux références (« auteur: DROPS Design »).
  const brand = /^([A-ZÀ-Ÿ][A-Za-zÀ-ÿ0-9&'’ -]{1,28}?)\s+Design\b(?:\s*:.*)?$/.exec(t)
  if (brand) return brand[1].trim() + ' Design'
  // Pied de page « … Hobbii Design, <Nom> » → « <Nom> | Hobbii Design » (fallback, non ancré).
  const hobbiiComma = HOBBII_COMMA_RE.exec(t)
  if (hobbiiComma) return hobbiiComma[1].trim() + ' | Hobbii Design'
  // Pied de page « … <collection arbitraire>, <Nom> - Copyright … » (3e variante, cf.
  // commentaire de GENERIC_COMMA_COPYRIGHT_RE) : nom seul, sans suffixe de marque fabriqué.
  const genericComma = GENERIC_COMMA_COPYRIGHT_RE.exec(t)
  if (genericComma) return genericComma[1].trim()
  const copyrightBrand = COPYRIGHT_BRAND_RE.exec(t)
  if (copyrightBrand && !isGenericLegalPhrase(copyrightBrand[1].trim())) return copyrightBrand[1].trim()
  return null
}

// Fusionne les sections d'introduction de tête (« info », préambule) en UNE section
// « Présentation » faite de notes : c'est la forme que patternToMd resérialise en
// texte libre d'intro. Une section intro = une note (texte recollé).
const NUM_ROW_LINE_RE = /^\s*\d+\s*(?:[.):]|\s*[-–]\s*\d+)/

// Une note du préambule (ligne d'intro ou extraNotes) → step { t, note }, avec la MÊME
// grammaire de vecteurs multi-tailles que linesToSteps (steps.js) applique à toutes les
// autres sections — modèle direct : parseIntro (pattern-md/parse.js) applique déjà
// applySizeVectors aux lignes du préambule au RE-parse du MD, donc l'omettre ici rend le
// document non stable au premier aller-retour (resérialisé en notation alternée par
// serialize.js dès que le nombre de valeurs colle à `n`, cf. campagne 2026-08-27,
// tidepool-tee-es-25fecf39 et 3 autres témoins). `applySizeVectors` porte déjà la règle de
// non-invention (§4.2) : un vecteur dont le nombre de valeurs ne correspond pas à `n` reste
// verbatim, `c` reste vide — on ne la contourne pas ici.
function noteFromText(text, { bold = false, n = 1 } = {}) {
  const src = String(text ?? '').replace(/\s{2,}/g, ' ').trim()
  if (!src) return null
  const { t, c } = applySizeVectors(src, n)
  const et = bold ? `**${t}**` : t
  return c.length ? { t: et, c, note: true } : { t: et, note: true }
}

function consolidateIntro(work, extraNotes = [], n = 1) {
  // Une section « info » qui contient des rangs numérotés n'est pas une intro :
  // c'est du travail mal titré (cas « PATTERN – … » avalé par l'info).
  for (const s of work) {
    if (s.intro && s.lines.filter((l) => NUM_ROW_LINE_RE.test(l.text)).length >= 2) s.intro = false
  }
  // Les blocs info sont éparpillés sur la page de garde : on les prend PARTOUT,
  // pas seulement en tête (l'ordre Hobbii met matériel/abréviations avant l'info).
  const intro = work.filter((s) => s.intro)
  work = work.filter((s) => !s.intro)
  // Une note par ligne logique (les lignes ont déjà été recollées par reflowLines) :
  // colle au découpage en paragraphes des références.
  const steps = intro
    .flatMap((sec) => sec.lines.map((l) => noteFromText(l.text, { bold: l.bold, n })))
    .filter(Boolean)
  // Retour Alexia (poncho) — lignes non-glossaire rejetées d'une section abbr sur-étendue
  // (extractReference, cf. formRejectedAbbrLine) : la section abbr elle-même est écartée
  // du travail juste au-dessus (filter (s) => !s.ref), donc ces lignes disparaîtraient
  // avec elle sans ce raccord. Elles rejoignent la Présentation (visible AVANT le rang 1,
  // la section est toujours en tête de `work` via l'unshift ci-dessous).
  for (const text of extraNotes) {
    const step = noteFromText(text, { n })
    if (step) steps.push(step)
  }
  if (steps.length) work.unshift({ title: 'Présentation', kind: 'autre', ref: null, presteps: steps, lines: [] })
  return work
}

// Une section vide (0 ligne, 0 prestep) est LE PLUS SOUVENT un artefact de mise en page
// bénin : un titre détecté à tort capture 0 ligne parce que la ligne suivante est ELLE
// AUSSI un titre, et l'immense majorité du temps ce titre-fantôme est du bruit de page
// (bandeau hashtags réseaux sociaux, code de taille « S (M) L », libellé générique
// « CORPS »/« Modèle »/« Opskrift », métadonnées « R0416 »/« Intermédiaire 3 »…) que
// l'oracle de référence écarte lui aussi — le jeter en silence (comportement d'origine) est
// CORRECT dans ce cas, mesuré sur les 25 réfs du gate (aucun de ces titres n'apparaît
// dans une référence). Un seul motif fait exception, prouvé sur un vrai PDF (patron
// espagnol Cotton Candy Dot) : un titre qui porte une VRAIE instruction entre
// parenthèses sur un mot-clé de section de travail reconnu (« MANGA (HAZ DOS) » =
// « MANCHE (FAIRE 2) », il faut faire 2 manches). isRescuableTitle capture CE motif
// précis (parenthèse + kindForTitle connu) — délibérément étroit : élargi à toute
// section vide titrée (sans ce garde), le gate régresse (mesuré : moyenne 0,6052 →
// 0,5988, tous les titres fusionnés en trop étant du bruit de page, cf. ci-dessus).
function isRescuableTitle(title) {
  return /\(.*\)/.test(title) && !!kindForTitle(title)
}

// Un arbitrage (vague 7, tranché le 03/09, option 1 « élargir le sauvetage ») : la
// garde ci-dessus (parenthèse + kind reconnu) laisse perdre du contenu réel sur 3
// patrons mesurés de la campagne — bird-nest-es (la page GUÍA quasi entière : « GUÍA »,
// « Foto 1 Foto 2 », « Foto 5 Foto 6 », « Foto 7 Foto 8 » jetés alors que le corps
// renvoie aux « mira la foto N »), frostwork-shawl-fr (items « 7. T10AV » / « 8. T10AR »
// de la légende du diagramme, tricotés dans le corps), hooked-on-you-scarf-es (« Lado
// anverso », légende jumelle de « Lado reverso » gardée). Ces titres sont des LÉGENDES :
// la section est vide parce que son contenu est fait d'IMAGES ou que l'item suivant est
// lui-même un titre — PAS parce que le titre est du bruit de page. Le sauvetage élargi
// reste CONDITIONNÉ aux formes de légende suivantes, vérifiées contre l'inventaire
// complet des sections vides des 26 témoins du banc (bandeaux hashtags ×12, codes de
// taille « S (M) L », libellés génériques « Pattern »/« Modèle »/« Opskrift »,
// métadonnées de couverture « R0416 »/« Intermédiaire 3 », noms d'auteurs et
// politesses de fin de document : tous re-vérifiés JETÉS) :
//  a) item de légende numéroté : chiffre + séparateur en tête (« 7. T10AV ») ;
//  b) légende de photo numérotée (« Foto 1 Foto 2 ») À CONDITION qu'une section VOISINE
//     porte aussi un titre de légende photo : les légendes de photos viennent par
//     pages/runs entiers (la page GUÍA de bird-nest), jamais seules — la condition
//     écarte le « Photo 1 Photo 2 Photo 3 » isolé de soft-twist, que la référence du
//     banc ne contient pas ;
//  c) en-tête nu de page photo-tuto (« GUÍA » es, « Guide » fr/en, « Guida » it) —
//     liste fermée ; l'équivalent danois « Billedvejledning » reste du bruit traité en
//     amont (PICTURE_GUIDE_RE, segment.js), jamais concerné ici ;
//  d) jumeau d'une section GARDÉE : même premier mot (≥ 3 lettres, comparaison
//     STRICTEMENT égale, même discipline que la numérotation A1 — « Pattern » vide
//     n'est PAS le jumeau de « PATTERN » gardé, mia-cardigan) ; « Lado anverso » a pour
//     jumeau gardé « Lado reverso ».
const LEGEND_ITEM_TITLE_RE = /^\d+\s*[.)-]/
const PHOTO_CAPTION_TITLE_RE =
  /(?:^|\s)(?:fotos?|photos?|bild(?:er)?|billede(?:r)?|afbeelding(?:en)?|figuur|fig(?:uras?|ures?|\.)|im[aá]genes?|images?|immagini?)\s*[.:]?\s*\d/i
const GUIDE_HEADING_TITLE_RE = /^(?:gu[ií]a|guide|guida)$/i
function isLegendTitleRescuable(sec, i, work) {
  const title = String(sec.title || '').trim()
  if (LEGEND_ITEM_TITLE_RE.test(title)) return true
  const prev = work[i - 1]
  const next = work[i + 1]
  const isCaption = (s) => !!s && PHOTO_CAPTION_TITLE_RE.test(String(s.title || '').trim())
  if (PHOTO_CAPTION_TITLE_RE.test(title) && (isCaption(prev) || isCaption(next))) return true
  if (GUIDE_HEADING_TITLE_RE.test(title)) return true
  const firstWord = (t) => (String(t || '').match(/\p{L}{3,}/u) || [''])[0]
  const fw = firstWord(title)
  const kept = (s) => !!s && !!(s.presteps?.length || s.lines.length)
  return !!fw && [prev, next].some((s) => kept(s) && firstWord(s.title) === fw)
}

// Filet de récupération : une section vide au titre rescapable (isRescuableTitle, ou
// isLegendTitleRescuable pour les légendes — un arbitrage) ne doit pas disparaître en
// silence — le filtre final de buildReaderFromPages jetterait la section ENTIÈRE, titre
// compris, vraie perte d'info. On fusionne son titre comme remarque
// `{ t: '**<titre>**', note: true }` (même format que les notes de consolidateIntro
// ci-dessus) en TÊTE des steps de la section SUIVANTE ; à défaut de suivante (dernière
// section), en FIN des steps de la PRÉCÉDENTE. Une section vide non rescapable (titre
// vide, ou titre de bruit de page) garde le sort d'origine : jamais gardée, jamais
// fusionnée — seule change la trajectoire des titres rescapables.
function mergeEmptyTitledSections(work, { n }) {
  const isEmpty = (s) => !(s.presteps?.length || s.lines.length)
  const stepsOf = (s) => s.presteps || linesToSteps(s.lines, { kind: s.kind, n })
  const out = []
  let pendingNotes = []
  for (let i = 0; i < work.length; i++) {
    const sec = work[i]
    const title = (sec.title || '').trim()
    if (isEmpty(sec)) {
      if (title && (isRescuableTitle(title) || isLegendTitleRescuable(sec, i, work))) {
        pendingNotes.push({ t: `**${title}**`, note: true })
      }
      continue // vide non rescapable : ni gardée ni fusionnée, comme avant ce correctif
    }
    if (pendingNotes.length) {
      sec.presteps = [...pendingNotes, ...stepsOf(sec)]
      pendingNotes = []
    }
    out.push(sec)
  }
  if (pendingNotes.length) {
    if (!out.length) return work // cas limite : aucun voisin (résultat à 1 section vide) → inchangé
    const prev = out[out.length - 1]
    prev.presteps = [...stepsOf(prev), ...pendingNotes]
  }
  return out
}

// Numérotation d'occurrence des titres homonymes (un arbitrage tranché le
// 03/09, vague 7) : un PDF peut porter deux sections ou plus avec le MÊME titre
// (« Halsausschnitt » ×2, « Bordure » ×3, « BODY » ×2…) — indiscernables dans le lecteur
// et le sommaire. Si un titre apparaît N ≥ 2 fois, TOUTES ses occurrences reçoivent
// « (1) » … « (N) », dans l'ordre d'apparition du document. Comparaison STRICTEMENT
// égale après trim (ni case-fold ni normalisation unicode : « Corps » vs « CORPS »
// restent distincts). Pas d'heuristique contextuelle (côté gauche/droite) : trop fragile.
//
// LIBELLÉ ≠ CLÉ : le suffixe ne touche QUE le titre affiché — jamais `kind`, ni une clé
// de données. Appelée en FIN de buildReaderFromPages, APRÈS normalizeReaderForSave : les
// ids (slug du titre) et kinds sont déjà posés sur les titres BRUTS et restent intacts ;
// seuls `title` (affiché par le lecteur/le sommaire et émis tel quel par patternToMd)
// change. La section « Présentation » (intro) est exclue : le sérialiseur la reconnaît au
// titre EXACT (« isIntro », serialize.js) pour l'émettre en texte libre d'intro — la
// numéroter casserait cette reconnaissance (et sa traduction, sectionTitleLabel).
export function numberDuplicateSectionTitles(sections) {
  const list = Array.isArray(sections) ? sections : []
  const isIntro = (s) =>
    s.title === 'Présentation' && (s.steps || []).length > 0 && (s.steps || []).every((st) => st.note)
  const work = list.length && isIntro(list[0]) ? list.slice(1) : list
  // Comptage sur les titres trimés (défensif : normalizeReaderForSave trim déjà), ordre
  // d'apparition ; ne compte pas les titres vides (un suffixe sur un titre vide ne
  // distinguerait rien : « (1) » n'est pas un titre).
  const counts = new Map()
  for (const s of work) {
    const t = String(s.title ?? '').trim()
    if (t) counts.set(t, (counts.get(t) || 0) + 1)
  }
  const seen = new Map()
  for (const s of work) {
    const t = String(s.title ?? '').trim()
    if (!t || counts.get(t) < 2) continue
    const k = (seen.get(t) || 0) + 1
    seen.set(t, k)
    s.title = `${t} (${k})`
  }
  return list
}

export function buildReaderFromPages(pages, { fileName = '', onMerge = null, docMetaTitle = '' } = {}) {
  // Auteur (avant nettoyage) : certains pieds de page portent le nom de la designer
  // sur une ligne qui est ELLE-MÊME du bruit d'édition légitime (mention copyright,
  // répétée sur toutes les pages) — bug PDF réel « Metorit - Asymmetrical Shawl »
  // (es) : « Metorit - Hobbii Design, Sys Fredens - Copyright © 2020   Página 1 »
  // est retirée ENTIÈREMENT par stripBoilerplate() (règle copyright générique +
  // ligne structurelle répétée) avant que la détection ci-dessous (sur cleanPages)
  // ne puisse jamais la voir. On cherche donc l'auteur AUSSI sur les pages BRUTES,
  // en lecture seule (on ne retire rien ici, on ne fait que renseigner `author` par
  // avance) : si la ligne est du vrai bruit, stripBoilerplate() la retire de toute
  // façon plus bas (elle ne doit PAS survivre dans le corps, ce n'est pas du contenu
  // de patron) ; si elle survit au nettoyage — cas déjà géré — la boucle existante
  // sur cleanPages ci-dessous la consomme explicitement comme avant ce correctif.
  let author = ''
  for (const l of (pages || []).slice(0, 2).flat()) {
    const a = parseAuthorLine(l.text)
    if (a) { author = a; break }
  }

  const cleanPages = stripBoilerplate(pages)
  const isGerman = detectGerman(cleanPages)
  const sections = segmentSections(cleanPages, { isGerman, onMerge })

  // Auteur : ligne « X | Hobbii Design » ou « Design : X » sur les 2 premières pages.
  // Détecté et retiré ICI, AVANT reflowLines juste en dessous : reflowLines COPIE
  // chaque objet ligne non fusionné (`{ ...l }`, cf. reflow.js) — passé ce point,
  // `sec.lines` ne pointe plus vers les mêmes objets que `cleanPages`, et un flag
  // `consumed` posé sur l'original (comme ci-dessous) deviendrait invisible à un
  // filtre appliqué après coup (bug section fantôme : la ligne auteur, déjà captée
  // dans pattern.author, survivait dupliquée dans le corps — vérifié sur deux PDF
  // réels, Martha - Blouse with lace pattern (de) et Spring Flora - Neck Warmer
  // (en)). Cette détection lit déjà les lignes BRUTES de cleanPages (jamais
  // reflowées, cleanPages n'est lui-même jamais réaffecté) : la faire ici, avant
  // reflow, ne change rien à ce qu'elle reconnaît (aucun risque pour un auteur
  // scindé sur 2 lignes physiques que seul le reflow aurait recollé — ce cas n'a
  // jamais été géré, ni avant ni après ce correctif), seulement à la fiabilité du
  // retrait de la ligne consommée. Filet de sécurité : ne fait que RE-confirmer
  // (ou consommer explicitement la ligne du corps) — `author` peut déjà être
  // renseigné par la détection sur pages brutes ci-dessus.
  for (const l of (cleanPages || []).slice(0, 2).flat()) {
    if (l.consumed) continue
    const a = parseAuthorLine(l.text)
    // Auteur déjà trouvé sur les pages brutes (ligne retirée depuis par stripBoilerplate) :
    // une AUTRE ligne « Conception : … » plus loin n'est pas l'auteur (souvent une consigne),
    // elle ne l'écrase pas et reste dans le corps.
    if (a && (!author || a === author)) { author = a; l.consumed = true; break }
  }
  // Glossaire mis en page en deux colonnes SANS séparateur (Hobbii/Go handmade) : lu ICI,
  // avant le reflow de la l.226 — celui-ci agglutine les entrées courtes en un seul
  // paragraphe et détruit la structure clé/définition. Portée stricte :
  // les seules sections déjà reconnues comme rubrique d'abréviations.
  const preAbbr = []
  const preNotes = []
  for (const sec of sections) {
    if (sec.ref !== 'abbr') continue
    const g = readColumnGlossary(sec.lines)
    if (!g) continue
    // Garde anti-faux-positif (régression réelle détectée sur Mia_Cardigan, patron de
    // référence pour ce cas) : readColumnGlossary vise EXPLICITEMENT les glossaires
    // SANS séparateur (cf. son en-tête), mais ne vérifie pas cette prémisse — sur un
    // vrai glossaire « clé = déf » (Mia : 15 lignes « BOR = beginning of round », etc.),
    // les abscisses du signe « = » s'alignent PAR HASARD sur ≥3 lignes de longueur de
    // clé voisine (st(s)/wyif/M1L) et font voter une fausse colonne : le module renvoie
    // alors un « glossaire » tronqué à 4 entrées, les 11 autres fuyant en notes
    // agglutinées (vérifié bout en bout : 15 entrées propres → 4 + prose parasite en
    // intro). Le mécanisme séparateur existant — `execAbbrLine`, reference.js, DÉJÀ
    // exporté et réutilisé ici tel quel (pas de regex locale réinventée : une première
    // version utilisait une regex maison `[=:]` qui ratait le dialecte tiret « - »/« – »
    // documenté ailleurs dans reference.js — revue de code) — gère déjà ce cas
    // correctement AVANT ce lot ; on ne le supplante que si la lecture en colonnes a
    // strictement PLUS à offrir que ce que ce mécanisme voit déjà tout seul — jamais si
    // elle en voit AUTANT ou MOINS (cas Mia : 15 ≥ 4 → on s'efface). Bonus d'`execAbbrLine`
    // (vs une regex maison) : il applique déjà `rejectAsAbbr`/`isNonGlossaryDef`, donc il
    // ne compte pas la prose à deux-points (« NOTE : … ») comme une fausse ligne séparateur.
    // Défaut restant, hors périmètre ici (limité à assemble.js/reference.js) :
    // readColumnGlossary lui-même n'a pas cette garde et la referait pour
    // tout futur appelant — à durcir dans glossary-columns.js plus tard.
    const sepLines = sec.lines.filter((l) => execAbbrLine(l.text)).length
    if (sepLines >= g.entries.length) continue
    preAbbr.push(...g.entries)
    preNotes.push(...g.notes)
    for (const l of g.consumed) l.consumed = true
  }
  for (const sec of sections) sec.lines = sec.lines.filter((l) => !l.consumed)

  for (const sec of sections) sec.lines = reflowLines(sec.lines, { para: sec.intro, isGerman })
  // Consommée ICI, APRÈS reflow et AVANT extractReference() (cf. ease.js pour le détail) :
  // reflowLines vient de tourner (l.311), donc `sections` porte déjà les objets ligne
  // COPIÉS (`{ ...l }`, cf. reflow.js) — ce sont ces MÊMES objets qu'extractReference()
  // recevra juste en dessous. Marquer `consumed` ici, plutôt qu'après coup, évite
  // exactement le piège de copie documenté plus haut (bug « section fantôme » de la
  // ligne auteur, l.253) : marquer un objet PRÉ-reflow serait invisible après le reflow
  // suivant. Nécessaire depuis que detectEaseHint balaie aussi les blocs référence hors
  // 'mesures' (ex. 'echantillon') : ceux-ci NE sont PAS retirés du corps comme 'mesures'
  // l'est — extractReference() (reference.js:1261) déverse verbatim toute ligne non
  // consommée d'une section ref==='echantillon' dans reference.gauge, rendu ensuite en
  // bloc « ## Échantillon {gauge} » (refblocks.js) — sans ce consumed, la phrase promue
  // en ease: y ressurgirait dupliquée. consumeEaseHintLine() ne marque QUE la ligne
  // effectivement promue (même objet que detectEaseHint aurait trouvé) et ne touche
  // rien si aucune phrase n'est trouvée.
  const easeHint = consumeEaseHintLine(sections)
  const sizeInfo = detectSizeLabels(cleanPages)
  const sizeLabels = sizeInfo.labels.length ? sizeInfo.labels : ['Taille unique']
  const n = sizeLabels.length

  const { reference, sizeSub, notes } = extractReference(sections, { n, sizeLabels, preAbbr, preNotes })

  // Filtre séparé (nécessaire même après celui du bloc auteur ci-dessus) : extractReference
  // consomme ses propres lignes (abréviations, étiquettes, glanage aiguilles/fil/échantillon,
  // cf. reference.js) en posant `consumed` sur les copies reflowées qu'il reçoit — un filtre
  // AVANT reflow ne les verrait pas.
  for (const sec of sections) sec.lines = sec.lines.filter((l) => !l.consumed)

  // Titre de couverture = titre du document (bug Jumper49) : le titre est détecté
  // comme un titre de SECTION (page de garde) et l'intro/description atterrit dans
  // cette section au lieu d'être reconnue comme « info » → elle serait sérialisée
  // en section de travail au lieu de rejoindre la Présentation. On marque en intro
  // toute section de la page 0 dont le titre redouble le titre du document : le
  // garde-fou de consolidateIntro (≥2 rangs numérotés) évite d'avaler une vraie
  // section de travail qui porterait, par coïncidence, le même titre.
  //
  // Titre interlettré (cf. spaced-title.js) : segmentSections() détecte les titres de
  // section par taille/police (isTitleLine), INDÉPENDAMMENT de detectTitle() — la section
  // fantôme garde donc son titre RAW « M I A C A R D I G A N », jamais recollé, alors que
  // detectTitle() rend désormais « Mia Cardigan » (restauré via la fiche d'identité). Une
  // comparaison littérale ne matche plus jamais (bug réel, mesuré sur Mia Cardigan : la
  // section fantôme et sa ligne de copyright survivaient malgré le titre déjà corrigé).
  // On normalise donc les deux côtés par le même recollage avant de comparer.
  const normalizeTitleForDedup = (t) => {
    const raw = String(t || '').trim()
    if (!raw) return ''
    if (!isLetterSpaced(raw)) return raw.toLowerCase()
    return (restoreWords(despace(raw), docMetaTitle) || raw).toLowerCase()
  }
  // Calculé une seule fois : detectTitle() est pure sur `pages` (jamais muté depuis),
  // réutilisé plus bas pour pattern.name (évite de rebalayer les 2 premières pages deux fois).
  const docTitle = detectTitle(pages, { metaTitle: docMetaTitle })
  const docTitleNorm = normalizeTitleForDedup(docTitle)
  if (docTitleNorm) {
    for (const sec of sections) {
      if (!sec.ref && !sec.noise && sec.page === 0 && !sec.intro &&
          normalizeTitleForDedup(sec.title) === docTitleNorm) {
        sec.intro = true
      }
    }
  }

  const workAll = consolidateIntro(sections.filter((s) => !s.ref && !s.noise), notes, n)
  const work = mergeEmptyTitledSections(workAll, { n }).filter(
    (s) => s.presteps?.length || s.lines.length,
  )

  const stats = { sectionsTotal: 0, sectionsKnown: 0, totalLines: 0, structuredLines: 0, vectorsSeen: 0, vectorsOk: 0, bySection: {} }
  const readerSections = work.map((sec) => {
    const steps = sec.presteps || linesToSteps(sec.lines, { kind: sec.kind, n })
    const structured = steps.filter(ROW_OR_REP).length
    stats.sectionsTotal += 1
    if (kindForTitle(sec.title)) stats.sectionsKnown += 1
    stats.totalLines += steps.length
    stats.structuredLines += structured
    for (const line of sec.lines) {
      for (const v of findSizeVectors(line.text)) {
        stats.vectorsSeen += 1
        if (v.values.length === n) stats.vectorsOk += 1
      }
    }
    return { id: '', kind: sec.kind, title: sec.title, steps }
  })

  // Normalisation identique à la sauvegarde de l'éditeur : ids, compaction {{i}}, longueurs n.
  const reader = normalizeReaderForSave(
    {
      sizeLabels,
      sizeSub: sizeSub && sizeSub.values.length === n ? sizeSub.values : [],
      sizeSubLabel: sizeSub && sizeSub.values.length === n ? sizeSub.label : '',
      easeHint,
      sections: readerSections,
      reference,
    },
    sizeLabels,
  )
  const warnings = validateReader(reader)
  readerSections.forEach((s, i) => {
    const steps = reader.sections[i]?.steps || []
    const structured = steps.filter(ROW_OR_REP).length
    stats.bySection[reader.sections[i]?.id || `sec${i}`] = steps.length ? Math.round((structured / steps.length) * 100) : 0
  })
  const confidence = computeConfidence({ stats, warnings })
  stats.multiColPages = countMultiColPages(pages)
  const blocking = computeBlocking(pages)

  const base = (fileName || 'Patron').replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
  const pattern = {
    name: docTitle || base,
    type: 'knitting',
    category: '',
    categoryCustom: '',
    author,
    sizes: isSingleSize(sizeLabels) ? [] : sizeLabels,
    source: `PDF (local) : ${fileName}`,
    photos: [],
    sections: [],
    reader,
  }
  // DERNIER geste : numéroter les titres homonymes sur l'ÉTAT FINAL —
  // après toutes fusions/déduplications ET la normalisation (ids/kinds déjà posés sur
  // les titres bruts, stats/confidence déjà calculées sur les titres reconnus). Le
  // reader et pattern.reader partagent le même objet : lecteur, sommaire et MD voient
  // le même titre numéroté.
  numberDuplicateSectionTitles(reader.sections)
  return { pattern, reader, warnings, confidence, stats, blocking }
}

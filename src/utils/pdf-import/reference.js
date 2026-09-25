// Construit la référence (aide-mémoire) VERBATIM : lignes recopiées, jamais recomposées.
// v2 : trois mécanismes, du plus sûr au plus prudent —
//   1. sections dédiées (titre réservé détecté par segment.js) routées telles quelles ;
//   2. étiquettes en ligne multilingues (« Fil: … », « Échantillon: … », « Longueur: … »)
//      dans les autres sections, avec mode bloc (étiquette nue → lignes suivantes) ;
//   3. filets regex globaux (héritage v1).
// Chaque ligne routée est CONSOMMÉE (l.consumed) pour ne pas réapparaître dans le travail.
import { buildReference } from '../reader-reference'
import { findSizeVectors, sizeLineTokens, hasAgeUnitWord, toPaperNotation } from './sizes'
import { looksLikeTableRow, ROW_START_RE } from './segment'
import { foldEszett } from './text-norm'
import { hasActionableVerb } from './actionable-prose'
// Retour d'usage — `slug` (accents + casse repliés, déjà utilisé pour la même
// comparaison dans refblocks.js `reservedKey`) : réutilisé tel quel plutôt que d'écrire un
// second normalisateur. Import déjà pratiqué depuis ce même dossier (`promote-grids.js`
// importe aussi `slug` de `../reader`) : aucune dépendance Vue/DOM dans sa chaîne
// (reader.js → section-kinds.js, tous deux purs), donc sans risque pour le banc Node.
import { slug } from '../reader'

const ABBR_LINE_RE = /^([^=:]{1,40}?)\s*[=:]\s+(\S.*)$/
const ABBR_KV_RE = /^(\S{1,10})\s*[=:]\s+(\S.*)$/

// SM2 — abréviations à séparateur tiret demi-cadratin « – » (U+2013) / cadratin « — » (U+2014).
// Des dialectes EN indie (Ravelry) écrivent « ch – chain stitch », « dc – double crochet ».
// PRUDENCE anti-faux-positif : ne PAS confondre avec une plage numérique (« 80–88 ») ni une
// phrase à tiret. On exige que la CLÉ soit une abréviation plausible (courte, non purement
// numérique) et que la DÉFINITION commence par une lettre ; le tiret doit être entouré
// d'espaces (une plage « 80–88 » n'a pas d'espaces autour du tiret).
const ABBR_DASH_LINE_RE = /^([^\s=:\u2013\u2014][^=:\u2013\u2014]{0,11}?)\s+[\u2013\u2014]\s+(\p{L}.*)$/u
const isNumericKey = (k) => /^\d+(?:[.,]\d+)?$/.test(String(k).trim())

// SM1b \u2014 une CL\u00c9 qui est un marqueur de rang COMPACT (\u00ab T1 \u00bb, \u00ab R14 \u00bb, \u00ab V1 \u00bb, \u00ab Rnd 3 \u00bb,
// \u00ab T7-12 \u00bb) n'est PAS une abr\u00e9viation : c'est un corps de patron (\u00ab T1: 6 ms dans le cercle \u00bb).
// Compl\u00e8te la garde SM1 de segment.js (ROW_START_RE, mot de rang PLEIN + chiffre) qui ne couvre
// pas ce format compact. Sans elle, le SCAN GLOBAL de bloc happe les tours d'un amigurumi
// (\u00ab T1: \u2026 \u00bb, \u00ab T2: \u2026 \u00bb) comme des abr\u00e9viations \u2192 les tours disparaissent du corps.
const ROW_MARKER_KEY_RE = /^(?:t|r|v|rnd|rad|omg|varv|krs|vlt|rang|row|tour|round|runde|vuelta|giro|rig(?:a|he)|g|toer|rz[\u0119e]d)\s?\d+(?:\s?[-\u2013\u2014]\s?\d+)?$/i
const isRowMarkerKey = (k) => ROW_MARKER_KEY_RE.test(String(k).trim())
// Cycle 15 (the-sisters) — une clé NUE purement numérique (« 1 », « 13-16 », « 8-10 ») est,
// comme un marqueur à mot-outil, un rang du CORPS du patron, jamais une clé de glossaire (un
// glossaire ne définit pas un symbole par un nombre nu). Convention amigurumi FR/EN très
// répandue (« 1: 6 ms dans un CM (6) » au lieu de « Rang 1 : … »). Sans ce garde, le scan de
// bloc « ≥3 lignes consécutives clé:déf » avale des dizaines de rangs, et addAbbr dédoublonne
// par clé sur tout le document → les rangs de même numéro des pièces suivantes disparaissent.
const BARE_ROW_KEY_RE = /^\d{1,3}(?:[-–—]\d{1,3})?$/
const isBareRowKey = (k) => BARE_ROW_KEY_RE.test(String(k).trim())

// Fix 3 \u2014 une \u00ab d\u00e9finition \u00bb qui est une liste de nombres/tirets multi-tailles (+ \u00e9ventuel
// mot-unit\u00e9 \u00ab m \u00bb, \u00ab sts \u00bb, \u00ab au total \u00bb\u2026) n'est PAS une abr\u00e9viation, mais un total par taille
// (Thekla : \u00ab dos = - (-) - (477) 513 (545) 589 m au total. \u00bb). On EXIGE un vrai vecteur
// multi-valeurs (groupes parenth\u00e9s\u00e9s) pour ne pas rejeter une abr\u00e9viation \u00e0 simple chiffre en
// prose (\u00ab inc \u2013 increase 2 sts \u00bb), et on v\u00e9rifie que le reste hors nombres n'est que de courts
// mots-unit\u00e9s.
const isSizeTotalDef = (def) => {
  const d = String(def)
  if (!/\d/.test(d)) return false
  if (!findSizeVectors(d).some((v) => v.values.length >= 2)) return false
  const words = d.replace(/[\d().,;:\u2013\u2014/*\sxX\u00d7[\]-]+/g, ' ').trim().match(/\S+/g) || []
  return words.every((w) => /^[a-z\u00e0-\u00ff]{1,6}$/i.test(w))
}

// Un point suivi d'une MAJUSCULE signe une NOUVELLE phrase (même mesure que G4c
// plus bas, « prose par taille » — définie ici pour être réutilisable par
// isNonGlossaryDef, appelée bien plus tôt dans le pipeline).
const SENTENCE_SPLIT_RE = /(?<=\.)\s+(?=[A-ZÀ-ÖØ-Þ])/

// Retour Alexia (poncho Timeless Twister) — une zone de page 0 sur-étendue en section
// ref='abbr' (plafond #5, non retouché ici) contenait, en plus des vraies abréviations,
// une phrase d'aide (« Tutoriel – Le pas à pas en photo se trouve à la fin du tutoriel
// écrit: ») et une consigne de taille (« Taille S/M: Répéter … 5 fois. Crocheter les … »)
// que SM2/ABBR_LINE_RE happaient comme abréviations (clé courte + séparateur). Un
// glossaire n'a JAMAIS de définition MULTI-PHRASES (≥2 phrases séparées par un point +
// majuscule — de la prose, pas une entrée) ni finissant par « : » (annonce une suite,
// pas une définition). PRUDENCE : pas de seuil de MOTS — le corpus contient de vraies
// abréviations à définition longue mais À UNE SEULE PHRASE/clause (torsades tricot FR :
// « Ggt = glisser les 2 m suivantes, une par une, à l'endroit; insérer la pointe de
// Aig.G, … » — 30+ mots, légitime) qu'un seuil de mots rejetterait à tort (retour scan-
// batch, winter-split-cowl/hearth-sweater). Le multi-phrases cible précisément la prose
// narrative (consignes, renvois) sans toucher ces définitions techniques verbeuses.
const isNonGlossaryDef = (def) => {
  const d = String(def).trim()
  if (/:\s*$/.test(d)) return true
  return SENTENCE_SPLIT_RE.test(d)
}

// PT4 (Pull torsades ajourées, Phildar 3 colonnes) — une CLÉ qui est un LABEL DE TAILLE
// du patron courant (« s », « M », « L », « XL », « XXL »…) n'est PAS une abréviation :
// c'est du façonnage par taille (« s : 4 x 7 m. », « M : 1 x 7 m., 3 x 8 m. »…). Une fois
// les colonnes démêlées (PT1, lines.js), ces lignes deviennent consécutives et ressemblent
// structurellement à un glossaire (≥3 lignes « clé : déf » courtes) : sans ce garde, le
// scan de bloc les happe en fausse table d'abréviations, et le dédoublonnage par clé
// (addAbbr) fait ensuite disparaître le bloc suivant utilisant les mêmes clés de taille
// (planning des manches). Comparaison normalisée (casse ignorée) : les tailles du patron
// sont connues via sizeLabels (détectées par sizes.js), transmis jusqu'ici.
// PRUDENCE anti-régression : sizeLabels n'est propagé QU'AU SCAN DE BLOC (ci-dessous,
// ligne ~360), jamais à execAbbrLine. Une taille « M » (Medium) est très fréquente ; en
// casse ignorée elle collisionnerait avec la VRAIE abréviation « m = maille(s) » d'une
// section dédiée ref==='abbr' (couverte par execAbbrLine, jamais par le scan de bloc,
// qui ne tourne que sur `!sec.ref`) — testé, cf. « non-régression PT4 » dans le spec.
const normalizeSizeKey = (k) => String(k).trim().toLowerCase()
const isSizeLabelKey = (key, sizeLabels) =>
  Array.isArray(sizeLabels) && sizeLabels.some((lbl) => normalizeSizeKey(lbl) === normalizeSizeKey(key))

// Bug 1 (retour banc, laura-sweater-en, vague 2) — une CLÉ qui est un marqueur de CÔTÉ
// D'OUVRAGE (« RS: », « WS: », annonçant l'endroit/l'envers du rang qui suit) n'est pas
// non plus une abréviation dans le SCAN DE BLOC ci-dessous (seule zone touchée par ce
// garde) : « RS: work 27 (30, 33) stitches knitwise, turn. » / « WS: slip 1 stitch, work
// until 7 stitches remain at shoulder, turn. » sont des rangs de façonnage d'épaule, pas
// un glossaire — sans ce garde, ≥3 lignes consécutives de ce type sont happées comme une
// fausse table d'abréviations (13 lignes de façonnage perdues, section « Abréviations »
// fabriquée de toutes pièces). Contrairement à ROW_MARKER_KEY_RE plus haut, ces marqueurs
// alternent SANS numéro (jamais « RS1 »/« WS1 ») : nouvelle regex dédiée plutôt qu'un
// élargissement de ROW_MARKER_KEY_RE (qui exige un chiffre).
// Équivalents CONSTATÉS sur le corpus web (pdftotext -layout sur les 3123 PDF de
// corpus-web, grep `^\s*(CLÉ)\s*:`, jamais supposés) : anglais RS/WS (right/wrong side,
// hiedra-shawl* n'en a pas mais laura-sweater-en/hobbii en/fr en ont plusieurs) ; français
// END/ENV (endroit/envers — renee-slipover-fr, hiedra-shawl-*-fr, sofia-plus-sweater-fr…) ;
// espagnol/italien LD/LR (lado derecho/revés, lato diritto/rovescio — MÊME paire de
// lettres dans les deux langues, saroyan-it, antanilla-lace-cardigan-es/it) ; néerlandais
// GK/VK (goede/verkeerde kant — ottolie-chevron-cardigan-nl, benedikte-top-nl). Aucune
// forme allemande courte trouvée (l'allemand écrit le mot complet « Hinreihe »/
// « Rückreihe », jamais abrégé en 2 lettres dans le corpus mesuré) : non ajoutée, pour ne
// pas deviner un motif non constaté.
// PRUDENCE (même risque déjà documenté pour RS/WS, confirmé sur le corpus) : CES
// MÊMES LETTRES sont aussi de VRAIES entrées de glossaire dans un Abkürzungen/
// Abréviations authentique — « RS: Rechte Seite der Arbeit » (foretoken-textured-
// kerchief-de), « END: endroit du travail » / « ENV: envers du travail » (hiedra-shawl-
// wrap-fr) sont constatés dans une vraie section dédiée. Ce garde ne s'applique donc QUE
// dans `!sec.ref` (le scan de bloc, ci-dessous) — jamais dans rejectAsAbbr/execAbbrLine
// (chemin partagé avec les sections `ref==='abbr'` authentiques, non touché) : une vraie
// section Abréviations garde ces entrées intactes.
const ROW_SIDE_MARKER_KEY_RE = /^(?:rs|ws|end|env|ld|lr|gk|vk)$/i
const isRowSideMarkerKey = (k) => ROW_SIDE_MARKER_KEY_RE.test(String(k).trim())

// Défaut 3 (banc vague 3, summer-squares-wrap-cardigan-de-69dc5aed, corpus réel Hobbii) —
// ROW_MARKER_KEY_RE/ROW_SIDE_MARKER_KEY_RE ci-dessus ne connaissent que des mots-outils
// GÉNÉRIQUES (row/rang/tour/rnd/runde…, RS/WS/END/ENV…) : une clé PROPRE AU PATRON
// (« MQ3 », « KQ1 », « GQ8 », initiales du carré/motif que LE PATRON se donne) n'y
// correspondra jamais — on ne peut pas énumérer ces clés à l'avance. Le seul critère
// disponible porte donc sur la NATURE de la DÉFINITION, pas sur la clé : un glossaire
// définit un symbole par une description COURTE et NOMINALE — même verbeuse pour un point
// technique élaboré (cf. « Ggt = glisser les 2 m suivantes… », commentaire d'isNonGlossaryDef
// plus haut : 30+ mots mais UN SEUL décompte de mailles fixe, répété) — alors qu'un rang de
// patron enchaîne PLUSIEURS instructions à la suite, chacune avec son propre décompte de
// mailles chiffré. Un seul signe retenu, MESURÉ (pas supposé) sur MQ3-MQ7 (10 à 25
// décomptes chiffrés chacun, LES CINQ porteurs d'un astérisque de répétition) : un
// astérisque de répétition (« *…, répéter/wiederholen depuis * ») — notation de RANG
// universelle tricot/crochet (FR/EN/DE/ES/IT), jamais rencontrée dans une définition
// d'abréviation du corpus mesuré — combiné à ≥2 décomptes chiffrés dans la définition (une
// astuce isolée sans aucun chiffre, du genre « * = voir le diagramme », ne doit pas suffire
// à elle seule).
// PISTE ÉCARTÉE (mesurée, pas juste envisagée) : un second signe « verbe d'action
// (hasActionableVerb) ET ≥3 décomptes chiffrés, à défaut d'astérisque » avait été envisagé
// pour couvrir un futur rang sans répétition — retiré après vérification : `yarn vitest run`
// sur ce fichier et `tools/mdlab/bench.mjs` (26 patrons) donnent un résultat RIGOUREUSEMENT
// IDENTIQUE avec ou sans cette clause (aucun cas mesuré ne la déclenche), alors qu'elle
// aurait pu rejeter à tort une VRAIE abréviation verbeuse à plusieurs décomptes (ex. un point
// bobble « (yo, k1, yo, k1) 4 times in same st, turn, k3 » : 5 décomptes + « turn » ∈
// vocabulaire EN_VERB_RE — jamais mesuré dans le corpus, donc jamais confirmé, mais un risque
// gratuit pour un gain nul). Un seul signe mesuré vaut mieux que deux dont un est une
// supposition (cf. PRUDENCE d'isNonGlossaryDef plus haut, même principe).
// PRUDENCE (même risque déjà documenté pour isNonGlossaryDef, cf. plus haut) : AUCUN seuil
// de MOTS ni de longueur brute — seulement des signes structurels de RÉPÉTITION/DENSITÉ de
// décomptes, qui ne pénalisent jamais une définition longue mais à un seul décompte fixe
// (vérifié sur Ggt, non-régression dédiée). Portée : SEUL le scan de bloc (`!sec.ref`,
// point d'appel ci-dessous) applique ce garde — jamais rejectAsAbbr/execAbbrLine, chemin
// partagé avec les sections `ref==='abbr'` authentiques : un vrai Abkürzungen qui écrirait,
// par extraordinaire, une définition de cette forme la garde intacte (même principe que
// ROW_SIDE_MARKER_KEY_RE ci-dessus, cf. commit 15ecb678).
const ROW_REPEAT_MARK_RE = /\*/
const isRowInstructionDef = (def) => {
  const d = String(def)
  const numCount = (d.match(/\d+/g) || []).length
  return ROW_REPEAT_MARK_RE.test(d) && numCount >= 2
}

// Palier 7 (hazy-whisper-sweater-de, corpus mesuré) — plafond ABBR_LINE_RE élargi 24→40
// (cf. ligne 13, ups-and-downs-blanket-en) : une CLÉ de 25-40 caractères peut désormais être
// un FRAGMENT DE REFLOW (queue de la définition PRÉCÉDENTE recollée à la clé SUIVANTE par le
// bug shouldJoin allemand déjà documenté ailleurs, non corrigé ici), pas une vraie clé de
// glossaire — « Stricke ihn rechts ab. M1RP = rechts geneigte » (def « rechts geneigte »,
// courte, single-clause, passe TOUS les autres gardes). Signe distinctif vérifié sur
// l'ENSEMBLE du corpus mesuré (57 PDF, avant ET après élargissement) : une vraie clé de
// glossaire, même longue et phrase-like (« Spike double crochet stitches », 29 car.), ne
// contient JAMAIS de point de fin de phrase suivi d'une majuscule — seul ce fragment de
// reflow en contient un (« ab. M »). Réutilise SENTENCE_SPLIT_RE (même détecteur que
// isNonGlossaryDef, appliqué ici à la CLÉ plutôt qu'à la définition).
const keyHasEmbeddedSentence = (key) => SENTENCE_SPLIT_RE.test(String(key))

// Une ligne « clé = déf » à REJETER du balayage d'abréviations (rang compact, total de
// tailles, définition trop longue/prose pour un glossaire, clé = label de taille du
// patron — cf. isSizeLabelKey ci-dessus —, ou clé qui contient elle-même une phrase entière).
const rejectAsAbbr = (key, def, sizeLabels) =>
  isRowMarkerKey(key) || isBareRowKey(key) || isSizeTotalDef(def) || isNonGlossaryDef(def) ||
  isSizeLabelKey(key, sizeLabels) || keyHasEmbeddedSentence(key)
// Renvoie un match façon `.exec` ([full, key, def]) en essayant d'abord le séparateur
// historique `=`/`:` puis, à défaut, le tiret cadratin/demi-cadratin sous gardes.
// PRUDENCE : le tiret n'a d'effet que dans la section dédiée `ref==='abbr'` (le sous-branchement
// global de ce chemin exige déjà un `=`). Le scan de BLOC global garde `ABBR_KV_RE` strict :
// il CONSOMME les lignes, donc un faux positif « Mot — phrase » (prose « Note — … ») y volerait
// le contenu d'une vraie section de travail. Le gain SM2 vit de toute façon en section abbr.
// PRUDENCE (revue) — execAbbrLine ne reçoit PAS sizeLabels : elle ne sert QUE
// pour les sections dédiées « ref==='abbr' » et le balayage global per-ligne (qui exige
// un « = » en plus, cf. plus bas), jamais pour le scan de bloc où vit le bug PT4. Une
// vraie abréviation « m = maille(s) » (taille du fil) ne doit pas être rejetée sous
// prétexte qu'un label de taille « M » (Medium) existe dans le patron — le rapprochement
// clé/taille n'a de sens QUE pour les blocs de façonnage happés par le scan ci-dessous
// (bug avéré : Pull torsades ajourées, Phildar), pas pour un vrai glossaire d'abréviations.
// Exportée (aide-mémoire) : segment.js la réutilise pour écarter un TITRE qui a
// la forme « clé = définition » (glossaire) avant d'accepter une clé de rubrique référence
// — sinon une entrée de glossaire fortuite (« DPN = double pointed needle », mot « needle »)
// ouvre à tort ## Aiguilles. Aucune logique modifiée ici, seul le mot-clé `export` change.
export function execAbbrLine(t) {
  const m = ABBR_LINE_RE.exec(t)
  if (m) return rejectAsAbbr(m[1], m[2]) ? null : m
  const d = ABBR_DASH_LINE_RE.exec(t)
  if (d && !isNumericKey(d[1]) && !rejectAsAbbr(d[1], d[2])) return d
  // Tiret ASCII espacé (« m - maille », « Sl st - slip stitch ») : angle mort comblé
  // (cycle 10, unicorn-pillow / dino-pram-chain / decorative-pumpkins). Mêmes gardes que
  // le tiret cadratin — clé non numérique, rejectAsAbbr écarte rangs / totaux-tailles /
  // prose multi-phrases. Le balayage GLOBAL (hors section abbr) exige de toute façon un
  // « = » (cf. plus bas), donc ceci n'agit que dans une vraie section d'abréviations.
  const a = ABBR_DASH_ASCII_RE.exec(t)
  if (a && !isNumericKey(a[1]) && !rejectAsAbbr(a[1], a[2])) return a
  return null
}

// Correctif A (garde-titre GLOSSARY_ENTRY_RE de segment.js, chantier glossaires récupérés) —
// un glossaire définit un symbole par un MOT (« knit », « purl »), jamais par un NOMBRE NU
// (compte de mailles/rangs). Même discriminant que le balayage global ci-dessous
// (`!/^\d/.test(m[2].trim())`, l.~1230) — extrait ici en fonction nommée et exportée pour
// que segment.js le réutilise TEL QUEL au lieu d'une copie qui pourrait diverger : une ligne
// « clé = compte » (« Corner = 3trc, ch2, 3trc », « S = 29 ml ») est un vrai TITRE ou une
// vraie donnée de taille par taille, jamais une entrée de glossaire.
export const looksLikeBareCountDef = (def) => /^\d/.test(String(def).trim())

// Ligne structurellement candidate à une abréviation (« clé = déf »/« clé – déf ») mais
// rejetée par le SEUL garde de forme (déf trop longue / finissant par « : »), à distinguer
// des rejets rang-compact/total-tailles (déjà silencieusement absents, hors périmètre ici,
// cf. plafond #5). Cette ligne n'est pas une abréviation mais reste du texte utile
// (retour Alexia poncho) : elle doit survivre en note plutôt que disparaître avec la
// section abbr sur-étendue (cf. extractReference, routage sec.ref === 'abbr').
function formRejectedAbbrLine(t) {
  const m = ABBR_LINE_RE.exec(t)
  if (m) return !isRowMarkerKey(m[1]) && !isSizeTotalDef(m[2]) && isNonGlossaryDef(m[2]) ? m : null
  const d = ABBR_DASH_LINE_RE.exec(t)
  if (d && !isNumericKey(d[1])) {
    return !isRowMarkerKey(d[1]) && !isSizeTotalDef(d[2]) && isNonGlossaryDef(d[2]) ? d : null
  }
  return null
}

// Retour banc (picture-ornament-fr-047559ed, Hobbii crochet) — la légende des symboles de
// répétition (« [ ] indique que les mailles sont travaillées dans la même maille », « { }
// indique que les mailles sont répétées plus tard sur le tour ») disparaissait entièrement :
// ni « = »/« : » ni tiret entre la clé et la définition (execAbbrLine/formRejectedAbbrLine
// exigent l'un des deux), et sur CE PDF précis, la définition ne finit par AUCUNE ponctuation
// (vérifié sur le texte extrait : la phrase, coupée en deux lignes par le PDF, est recollée
// par le reflow sans qu'aucun point final n'apparaisse nulle part dans la source — pas une
// garantie générale sur le reflow, seulement ce qui a été constaté sur ce cas) —
// looksLikeSetupProseLine, qui exige SENTENCE_END_RE, la rejette donc aussi. Résultat mesuré
// (dump-sec) : la ligne franchit les trois filets de la section abbr sans être capturée nulle
// part, puis le filet de secours final (isNonWorkSection, gauge/aiguilles/fil/phrase
// multi-clauses) ne la reconnaît pas non plus — elle s'évanouit.
// PRUDENCE (principe du projet, cf. glossary-columns.js : « un faux glossaire est pire qu'un
// glossaire manquant ») : on ne relâche PAS SENTENCE_END_RE (régresserait penny-the-panda,
// cf. commentaire de looksLikeSetupProseLine) et on ne force AUCUNE clé/déf générique dans la
// table — seule une clé qui EST littéralement une paire de crochets/accolades VIDE (« [ ] »,
// « { } », la notation de répétition du patron, jamais une vraie abréviation lexicale) suivie
// d'un verbe de légende fermé compte : ceci ne peut pas fabriquer une fausse entrée sur un mot
// réel, contrairement à un simple assouplissement de ponctuation.
// Portée mesurée sur le corpus (grep pdftotext sur 3123 PDF avec la liste de verbes « indique
// que|indiquent|signifie|indica que|significa|indicates that|means that|bedeutet|
// représente/repräsentiert », cf. tâche) : EXACTEMENT le même motif « [ ]/{ } + verbe » revient
// en FR (« indique que », « signifie que »), DE (« bedeutet, dass »), ES (« indica que ») —
// toujours pour annoncer la même paire de symboles Hobbii. AUCUNE occurrence anglaise trouvée
// PAR CETTE LISTE DE VERBES : ce n'est pas une preuve d'absence côté anglais (un « [ ]
// indicates the stitches… », sans « that », ou un autre verbe, ne serait pas ressorti du même
// grep) — seulement que le vocabulaire ci-dessous couvre ce qui a été constaté, pas un
// « indicates »/« means » anglais supposé par extrapolation.
const NOTATION_LEGEND_KEY_RE = /^([[{]\s*[\]}])\s+(\S.*)$/
const NOTATION_LEGEND_VERB_RE = /^(?:indique(?:nt)?\s+que|signifie(?:nt)?\s+que|indica(?:n)?\s+que|bedeutet,?\s*dass)\b/i
function execNotationLegendLine(t) {
  const m = NOTATION_LEGEND_KEY_RE.exec(String(t).trim())
  return m && NOTATION_LEGEND_VERB_RE.test(m[2]) ? m : null
}

// Une ligne « clé = déf »/« clé – déf » dont la clé est un marqueur de rang (« Rang 1 »,
// « T1 »…) ressemble à une phrase de prose (≥4 mots) mais est en réalité un rang du CORPS
// du patron, pas une consigne de mise en route. execAbbrLine/formRejectedAbbrLine
// l'excluent déjà toutes deux (rejectAsAbbr/isRowMarkerKey) — ce garde évite qu'elle
// retombe malgré tout dans le chemin « prose nue » ci-dessous.
const isRowMarkerLine = (t) => {
  const m = ABBR_LINE_RE.exec(t) || ABBR_DASH_LINE_RE.exec(t)
  return !!m && isRowMarkerKey(m[1])
}

// Gate corpus (dino-pram-chain, decorative-pumpkins) — une VRAIE abréviation « clé - déf »
// à tiret ASCII simple (pas le tiret cadratin/demi-cadratin U+2013/U+2014 qu'exige
// ABBR_DASH_LINE_RE) est structurellement une entrée de glossaire, pas une phrase de
// prose, même si elle compte ≥4 mots (« Sl st - slip stitch », « Hdc - Half double
// crochet »). C'est un angle mort PRÉEXISTANT (tiret ASCII non supporté par le glossaire,
// hors périmètre ici) : il ne faut pas le transformer en régression en la faisant router
// comme note. Espaces obligatoires autour du tiret (mêmes raisons que SM2 : ne pas
// confondre avec une plage numérique).
const ABBR_DASH_ASCII_RE = /^([^\s].{0,23}?)\s-\s(\S.*)$/
// Revue #5 (poncho) — l'exclusion ASCII-dash était AVEUGLE : toute ligne « mot-court -
// suite » était traitée comme une entrée de glossaire, même quand la « définition » est en
// réalité une phrase de prose (« Astuce - Bien serrer le premier rang. Cela donne un joli
// bord fini. »). Son cousin ABBR_DASH_LINE_RE (tiret cadratin/demi-cadratin) ne fait pas
// cette erreur : execAbbrLine/formRejectedAbbrLine y appliquent déjà isNonGlossaryDef pour
// distinguer glossaire (déf courte à une seule clause) de prose (déf multi-phrases ou finissant
// par « : »). On calque exactement la même logique ici : ne considérer la ligne comme une
// entrée de glossaire (donc à exclure de la prose) QUE si isNonGlossaryDef(def) est faux.
// LIMITE ASSUMÉE (non corrigée ici, cf. revue) : isNonGlossaryDef discrimine par STRUCTURE
// (multi-phrases/« : » final), pas par longueur — une prose à tiret ASCII tenant en UNE
// seule phrase (« Astuce - bien serrer le premier rang pour un joli bord fini. ») reste donc
// glossaire-like et n'est pas récupérée, comme une vraie abréviation à déf courte (« Sl st -
// slip stitch », angle mort déjà documenté plus haut).
const looksLikeKeyDefLine = (t) => {
  if (ABBR_LINE_RE.test(t) || ABBR_DASH_LINE_RE.test(t)) return true
  const a = ABBR_DASH_ASCII_RE.exec(t)
  return !!a && !isNonGlossaryDef(a[2])
}

// Bare item numéroté (« 1. Monter 126 ml … ») : cf. BARE_ITEM_RE dans segment.js (qui
// referme déjà la section abbr AVANT extractReference dans le pipeline réel). Ici,
// prudence supplémentaire pour les sections construites directement (tests, ou tout
// futur appelant qui outrepasserait segment.js) : une telle ligne est un rang du corps,
// pas une phrase de mise en route.
const BARE_ITEM_LINE_RE = /^\s*\d{1,3}[.)]\s+\S/

// Gate corpus (penny-the-panda) — une définition de glossaire repliée sur 2 lignes par
// reflow (« (xx) = Klammern nach der Runde = Anzahl » PUIS « Maschen am Ende der Runde »)
// laisse une queue de continuation SANS ponctuation finale : ce n'est pas une phrase
// autonome, juste un fragment orphelin de la ligne précédente. Une vraie consigne de mise
// en route (retour Alexia) est toujours une phrase complète, ponctuée. On l'exige pour ne
// pas avaler ces queues de définition repliées.
// ANGLE MORT ASSUMÉ (revue, non relâché) : cette exigence de ponctuation finale fait
// perdre une VRAIE phrase de mise en route quand le PDF ne la termine pas par un point
// (reflow qui coupe avant la ponctuation, tiret de fin de page, etc.) — elle disparaît
// silencieusement au lieu de survivre en note, exactement comme les cas qu'on protège ici.
// C'est un compromis DÉLIBÉRÉ : SENTENCE_END_RE est le seul garde-fou qui empêche d'avaler
// les queues de définition repliées (régression penny-the-panda) ; on ne le relâche pas tant
// que le dé-colonnage ne permet pas de recoller la ligne à sa continuation en amont
// pour distinguer les deux cas autrement que par la ponctuation.
const SENTENCE_END_RE = /[.!?]['"’”)]*$/

// Retour Alexia (poncho Timeless Twister) — une section abbr sur-étendue contient aussi
// de la PROSE DE MISE EN ROUTE sans structure « clé: déf »/« clé – déf » du tout
// (« Commencer en prenant le fil au centre de la pelote, pour aller de l'intérieur vers
// l'extérieur. »). Ni execAbbrLine (pas de clé/déf) ni formRejectedAbbrLine (idem) ne la
// routent : elle disparaissait silencieusement. PRUDENCE : on exige une vraie phrase
// complète (≥4 mots alphabétiques, ponctuation finale) et on exclut explicitement tout ce
// qui ressemble au CORPS du patron (item numéroté nu, rangée de mesures/tableau, marqueur
// de rang) ou à une entrée de glossaire mal formée (tiret ASCII, queue de définition
// repliée) pour ne jamais avaler un rang, un fragment de mesure ou une abréviation sous
// couvert de « prose ».
function looksLikeSetupProseLine(t) {
  const s = String(t).trim()
  if (!s) return false
  if (BARE_ITEM_LINE_RE.test(s)) return false
  if (looksLikeTableRow(s)) return false
  if (isRowMarkerLine(s)) return false
  if (looksLikeKeyDefLine(s)) return false
  if (!SENTENCE_END_RE.test(s)) return false
  const words = s.match(/\p{L}+/gu) || []
  return words.length >= 4
}

// Au2 — signature d'une ligne-COLORIS/quantité (« 1 (2) 3 pelote(s) de coul. 01 ») : un compte
// de pelotes/écheveaux précédé de nombres. À NE PAS confondre avec une ligne-fil de QUALITÉ
// (fibre, métrage, marque : « 100% coton », « 50 g = 160 m », « Laine X »). Les lignes-coloris
// ne comptent PAS dans le plafond des « vrais » fils, sinon 7 coloris saturent la section.
const COLORWAY_RE = /\d[\d\s()]*\b(?:pelotes?|skeins?|balls?|kn[äa]uel|n[øo]gler?|nystan|ker[äa][äa]?|ovillos?|gomitoli|bollen|motk[iów]+)\b/i
const GAUGE_RE = /(?=.*\b(?:m(?:ailles)?|sts?|stitches|masker|maschen|silmuk\w*|maglie|puntos?|steken|oczka)\b)(?=.*(?:10\s*cm|4\s*(?:in|["”])))/i
// « nadel(?:n)?\b » (pas juste « nadel\b ») : pluriel allemand « Stricknadeln » — le « n »
// colle au mot et casse la frontière \b sans le groupe optionnel. Même motif que
// segment.js:19 (KIND_KEYWORDS 'aiguilles'), copié ici pour éviter la même divergence
// (hazy-whisper-sweater-de, corpus réel palier 6 : « Strumpfstricknadeln 4 mm » perdu).
const NEEDLE_RE = /(?:aiguilles?|needles?|crochet|nadel(?:n)?|pinde|n[åa]l|stickor|puikot|agujas?|ganchillo|ferri|uncinetto|naalden|druty|szyde[łl]ko|hook)\b.*(?:\d+(?:[.,]\d+)?\s*mm|US\s*\d|nr\.?\s*\d)/i
// M3 — 90-s-memories-sweater-fr-9da4d67c (corpus réel, tricot) : dans une section
// ref='materiel' (« FOURNITURES »), une ligne peut annoncer la TAILLE avant le mot-outil
// (« 4 mm et 4,5mm aiguilles circulaires ») au lieu d'après. NEEDLE_RE (mot-outil PUIS
// taille) et NEEDLE_BARE_RE (mot-outil PUIS chiffre nu) ne captent pas cet ordre inverse ;
// la ligne finissait en Matériel.
// Premier correctif (revue, mesure sur 3187 PDF) : une première version avait ajouté
// cette voie DIRECTEMENT dans NEEDLE_RE via `.{0,24}?` non borné en contenu — violation de
// la règle centrale (NEEDLE_RE doit rester bit-identique) ET trop permissive : elle captait
// aussi des FAUX POSITIFS mesurés (4 cas réels) :
// - amelia-colourwork-vest-fr-78e16688 : « …5 boutons (15 mm de diamètre), aiguille à
//   laine » — mesure d'un ACCESSOIRE (bouton), pas une aiguille.
// - diaphane-top-buttoned-shirt-fr-09bb8728 : « …4 boutons 18 mm, aiguille à laine » — idem.
// - poppy-children-s-cardigan-nl-65db6087 / rosmarino-eyelet-ankle-socks-nl-2a1f72df :
//   lignes d'ÉCHANTILLON (« … op 3,5 mm naalden = 10 x 10 cm », « … met 2,5 mm naalden na
//   opspannen ») — assimilent deux grandeurs (= 10 cm/10 x 10 cm), signature GAUGE_RE.
// - little-elves-nl-0ff8a6cd : « Zet 8 s op met de 3,25 mm naalden. » — phrase
//   D'INSTRUCTION (« montez 8 mailles avec les aiguilles 3,25 mm »), le vol de contenu que
//   G3c/INSTRUCTION_LEAD_RE veut empêcher ailleurs — mais celle-ci ne COMMENCE pas par
//   « avec/met/with », donc INSTRUCTION_LEAD_RE (qui ne teste que le DÉBUT de ligne) ne la
//   voit pas.
// Discriminant mesuré : tous les vrais cas portent la taille EN TÊTE DE LIGNE (mod
// puce/numérotation, et un éventuel préfixe de taille d'une liste fermée — « Size », « US »,
// « U.S. », « nr », « no », « n° », « taille(s) »… — avec sa lettre/chiffre de calibre :
// « Size U.S. N/15 (10 mm) crochet hook », « L/8mm crochet hook ») ; tous les faux positifs
// ci-dessus ont la taille au MILIEU d'une phrase. D'où NEEDLE_SIZE_FIRST_RE, une constante
// SÉPARÉE (NEEDLE_RE ci-dessus redevient bit-identique à son état d'origine, notamment pour
// la branche sec.ref==='aiguilles' qui la teste en direct, cf. ligne ~624) :
// (1) ancrée ^ en tête de ligne — un rapprochement au milieu d'une phrase est refusé ;
// (2) combinée dans isNeedleLine avec une garde GAUGE_RE dédiée à cette seule voie (les deux
//     autres voies, NEEDLE_RE et NEEDLE_BARE_RE, restent bit-identiques, garde comprise).
// Deuxième passe (revue, rescan 71 patrons réels) : le premier correctif avait ajouté ici
// une whitelist FERMÉE de connecteurs pour la zone médiane (taille → mot-outil), sur l'idée
// qu'un mot porteur de sens entre les deux (« de diamètre ») devait casser le rapprochement.
// Cette règle était LINGUISTIQUEMENT FAUSSE : en français l'adjectif suit le nom
// (« aiguilles circulaires »), mais en anglais il le PRÉCÈDE (« circular needles ») — le mot
// « circular » tombe alors entre la taille et le mot-outil et cassait le rapprochement sur
// TOUS les cas anglais, y compris les 3 gains réels du corpus. Le rescan est retombé
// exactement à la baseline (18/71 patrons réels sans bloc Aiguilles). Erreur de conception
// en revue, pas un bug d'implémentation — corrigée en annulant la règle : la zone
// médiane redevient une plage de caractères bornée (empêche le rapprochement à distance),
// avec la SEULE exclusion des signes `;!?` (empêche de franchir une frontière de phrase,
// cf. « 20 m x 26 rangs = 10 x 10 cm avec les aiguilles 4 mm » où le point d'interrogation
// n'intervient pas mais où ce garde-fou reste la protection structurelle de principe).
// L'ANCRAGE (1) et la garde GAUGE_RE (2) ci-dessus restent les deux SEULES défenses actives
// contre les faux positifs mesurés — vérifié par preuve par mutation (cf. rapport de tâche) :
// les deux tiennent toujours après ce relâchement.
// Limites connues et ACCEPTÉES (non corrigées, décision en revue) :
// - « 6mm safety eyes 3.5mm crochet hook » (mini-kawaii-coffee-cup-en) est capté : ligne de
//   matériel amigurumi qui porte quand même une vraie spec de crochet (3.5mm) — pas de perte
//   d'information, juste un rattachement imprécis du premier chiffre (6mm, yeux de sécurité).
// - « 4 x 3,25 mm sukkapuikkoa tai lyhyet 3,25 mm pyöröpuikot » (moss-rose-socks-fi) reste
//   rejeté : le « 4 x » en tête n'est pas une taille reconnue par NEEDLE_SF_SIZE, et le
//   finnois est hors du périmètre linguistique de la phase 1 (cf. tricoche-offline-
//   multilingue : FR/EN/ES/DE seulement).
const NEEDLE_SF_TOOL = '(?:aiguilles?|needles?|crochet|nadel(?:n)?|pinde|n[åa]l|stickor|puikot|agujas?|ganchillo|ferri|uncinetto|naalden|druty|szyde[łl]ko|hook)'
const NEEDLE_SF_PREFIX = '(?:size|sizes|tailles?|talla|gr[öo][ßs]e|koko|storlek|u\\.?s\\.?|nr\\.?|no|n°)'
const NEEDLE_SF_CALIBRE = '(?:[A-Za-z](?:/\\d*)?)'
const NEEDLE_SF_SIZE = '(?:\\d+(?:[.,]\\d+)?\\s*mm|US\\s*\\d|n[°o]\\s*\\d)'
const NEEDLE_SIZE_FIRST_RE = new RegExp(
  `^(?:[-*•]\\s*|\\d+[.)]\\s*)?(?:${NEEDLE_SF_PREFIX}\\s*)*(?:${NEEDLE_SF_CALIBRE}\\s*)?[\\s(]*${NEEDLE_SF_SIZE}[^;!?]{0,24}?\\b${NEEDLE_SF_TOOL}\\b`,
  'i',
)
// Premier correctif (revue, mesure sur 3187 PDF) : présence NUE d'une vraie
// taille d'outil (mm/US n/n° n) n'importe où dans la ligne — réutilisée telle quelle
// (NEEDLE_SF_SIZE ci-dessus) pour garder les mots-outils AJOUTÉS dans la branche
// sec.ref==='aiguilles' (cf. plus bas) sous condition de taille, cf. commentaire sur place.
const NEEDLE_SF_SIZE_RE = new RegExp(NEEDLE_SF_SIZE, 'i')
// Deuxième passe (revue, mesure sur 3187 PDF) : NEEDLE_SF_SIZE_RE ci-dessus
// cherche une taille N'IMPORTE OÙ dans la ligne, sans lien avec le mot-outil — DÉLIBÉRÉMENT
// (demandé explicitement en revue de ne PAS ajouter de contrainte de proximité entre
// taille et mot-outil : un vrai cas mesuré porte la taille à plus de 100 caractères du mot,
// « 2.5 mm or anything that will get you the desired gauge…, but the circulars should be
// sufficient… »). Mais ça laissait passer le cas babyfryd : un ACCESSOIRE mesuré en mm sur
// la MÊME ligne qu'une aiguille QUALIFIÉE (« tapestry needle », jamais une aiguille de
// travail) contournait la garde (« 6 mm safety eyes, tapestry needle » — corpus web réel).
// Qualificatifs FERMÉS mesurés sur le corpus (Tapestry needle ×11, Darning needle ×6, Yarn
// needle ×4, Yarn sewing needle, Embroidery needle, wool needle/embroidery needle for
// sewing, Large darning needle with blunt tip, Cable needle) : même famille que « aiguille à
// laine »/« Garnnadel »/« Stoppenål »/« Garnnål » déjà écartés côté FR/DE/scandinave
// ci-dessus, comblée ici côté anglais.
// Troisième passe (revue, mesure sur 3187 PDF, effet de la deuxième passe strictement nul avant
// cette passe — la garde était purement préventive) : la fenêtre de 24 caractères en arrière
// (deuxième passe, ci-dessous dans l'historique) SUR-neutralisait — « yarn »/« cable » (et par
// extension « wool »/« sewing ») sont des noms COMMUNS du domaine tricot/crochet, pas des
// qualificatifs EXCLUSIFS d'accessoire. Le phrasé « fil tenu double », très courant et
// souvent accolé à la taille d'aiguille dans une liste de fournitures compacte, plaçait
// « yarn » dans la fenêtre de 24 caractères précédant « needles » sans le qualifier : « Yarn
// held double, 4mm needles », « Yarn doubled, 4.5mm needles », « Worked with yarn doubled on
// 4mm needles », « using yarn double and 4mm needles », « 24 sts cable panel, 4mm needles »
// (corpus web réel) perdaient à tort leur bloc Aiguilles. Le vrai motif de la famille visée
// (« aiguille à laine ») est une ADJACENCE IMMÉDIATE : « <qualificatif> needle », jamais
// « <qualificatif> … quelques mots … needle ». Fenêtre remplacée par une ancre de fin de
// chaîne — NEEDLE_ACCESSORY_QUALIFIER_ADJACENT_RE.test(s.slice(0, m.index)) : vrai
// seulement si le texte PRÉCÉDANT l'occurrence se termine PAR le qualificatif, séparé au
// plus par un espace ou un trait d'union (« tapestry needle », « darning-needle »).
const NEEDLE_ACCESSORY_QUALIFIER_ADJACENT_RE = /\b(?:tapestry|darning|yarn|wool|embroidery|sewing|cable|blunt)[\s-]$/i
// SANS ancrage \b final — même vocabulaire, mêmes ancrages que le filet mots-outils ad hoc
// du premier correctif juste en dessous (« ganchillo » doit matcher en PRÉFIXE de « Ganchillos », pluriel
// espagnol, comme « aiguille » matche en préfixe d'« aiguilles » ailleurs dans ce fichier ;
// un \b final casserait ce cas réel mesuré, « Ganchillos de 3 y 4 mm »).
const GATED_NEEDLE_WORDS_RE = /needles?|stickor|pinde|ganchillo|uncinetto|szyde[łl]ko/gi
// hasUnqualifiedGatedNeedleWord(t) : vrai si la ligne porte au moins UNE occurrence d'un mot
// de la liste ajoutée (premier correctif) qui n'est PAS immédiatement précédée (adjacence stricte,
// troisième passe) d'un qualificatif d'accessoire. Cas MIXTE (demandé en revue) :
// « 4 mm circular needle and a tapestry needle » a deux occurrences, « circular needle »
// n'est PAS qualifiée → true → la ligne reste éligible. Seule une ligne où TOUTES les
// occurrences sont qualifiées (aucune aiguille de travail nulle part sur la ligne) doit
// être écartée de cette voie.
const hasUnqualifiedGatedNeedleWord = (t) => {
  const s = String(t)
  const matches = [...s.matchAll(GATED_NEEDLE_WORDS_RE)]
  if (matches.length === 0) return false
  return matches.some((m) => !NEEDLE_ACCESSORY_QUALIFIER_ADJACENT_RE.test(s.slice(0, m.index)))
}
// Palier 8/8 (Rigmor - Jumper, rigmor-jumper-en-c890d246, corpus réel) : le mot-fibre
// n'admettait QUE le vocabulaire naturel/classique — une composition SYNTHÉTIQUE
// (« 98% Acrylic, 2% Polyester/ 100 g = 462 meters ») ne matchait aucune alternative,
// la ligne (pourtant complète : fibre + grammage/métrage) restait perdue en puce
// Matériel au lieu de rejoindre Fil. Vocabulaire ajouté mesuré sur le corpus réel (pas
// inventé) : EN acrylic/polyester, FR acrylique/polyester (hygge-blanket-fr, aurora-
// headband-fr), ES acrílico/poliéster (serenity-sweater-es, knitted-crown-headband-es),
// DE Acryl (martha-blouse-with-lace-pattern-de, ydun-hat-de — le allemand n'a pas de
// forme distincte pour « polyester »). `acryl` reste \b-délimité des deux côtés comme le
// reste de l'alternation : un composé comme « Acrylfarbe » (peinture acrylique) ne
// matche pas, la frontière de mot casse juste après le « l ».
const YARN_RE = /(?=.*\b(?:fil|laine|yarn|coton|cotton|mohair|alpaga|alpaca|wool|m[ée]rinos|garn|merino|acrylic|acrylique|acr[ií]lico|acryl|polyester|poli[ée]ster)\b)(?=.*(?:\d+\s*g\b|grammes|\d{2,}\s*m\b|yardage|pelotes?|skeins?|balls?|écheveaux?|kn[äa]uel|n[øo]gle|ovillos?|gomitoli|bollen|mot(?:ki|ek)|ker[äa][äa]?))/i

// Une puce rangée sous « Materials: » alors qu'elle porte un MÉTRAGE
// (« 100g = 366m », « 50 g = 420 m », « 100g/366m ») est un fil, quel que soit l'en-tête
// sous lequel le PDF l'a mise (PDF réel Mia Cardigan : les 2 fils vivaient dans Matériel,
// le bloc Fil restait vide). Critère volontairement étroit : un vrai couple grammage/
// métrage, jamais un mot-clé de marque — les boutons et les marqueurs n'ont pas de
// métrage et restent dans Matériel. `[^.]{0,20}?` borne les deux lookaheads courts entre
// le poids et la longueur (mêmes types de bornes que NEEDLE_SF_MAX_LEN ailleurs dans ce
// fichier, sans risque de retour arrière catastrophique : aucun `.*` non ancré ici).
const YARN_YARDAGE_RE = /\b\d+\s*(?:g|gr|gramm?e?s?)\b[^.]{0,20}?[=/][^.]{0,20}?\b\d+\s*(?:m|meters?|metres?|mètres?|yds?|yards?)\b/i

// G3a — filet aiguilles élargi (Jumper49-C). NEEDLE_RE exige une unité (mm/US/nr) ;
// « Aiguilles 2,5 et 3 » (mm implicite) est ainsi perdue. NEEDLE_BARE_RE reconnaît un
// mot-outil DIRECTEMENT suivi d'un nombre nu à courte distance, unité optionnelle.
// Garde anti-URL : une ligne contenant un lien (« … à trois aiguilles : https://… » tuto)
// ne doit JAMAIS devenir la ligne aiguilles.
const NEEDLE_BARE_RE = /(?:aiguilles?|needles?|crochet|nadel(?:n)?|pinde|n[åa]l|stickor|puikot|agujas?|ganchillo|ferri|uncinetto|naalden|druty|szyde[łl]ko|hook)\b\s*(?:n[°o]\s*)?\d/i
// Garde échantillon SUR LA SEULE voie NEEDLE_SIZE_FIRST_RE (poppy-children-s-cardigan-nl,
// rosmarino-eyelet-ankle-socks-nl, cf. commentaire NEEDLE_SIZE_FIRST_RE ci-dessus) : une
// ligne d'échantillon assimile deux grandeurs (= 10 cm, 10 x 10 cm, m x rangs) — GAUGE_RE
// (ligne ~248) est déjà le détecteur du fichier pour cette signature. NEEDLE_RE et
// NEEDLE_BARE_RE restent inchangés (même s'ils captent déjà une ligne d'échantillon
// ailleurs, leur trajet reste bit-identique).
// Troisième passe (revue) : la garde GAUGE_RE ci-dessus ouvrait un chemin d'appel
// NEUF vers une regex à complexité quadratique — GAUGE_RE (ligne ~248) est deux lookaheads
// non ancrés `(?=.*A)(?=.*B)` ; sur une chaîne longue SANS le motif B (« 10 cm »/« 4 in »),
// le moteur backtracke `.*` en O(n²). Mesuré : 4747 ms (en revue) / ~6,9 s (ici) sur une
// ligne adversariale de 32-80k caractères. Chemin atteignable en production via
// isNeedleSpecForScavenge, appelé sur le filet global qui balaie les intros REFLOWÉES EN UN
// SEUL PARAGRAPHE (plusieurs lignes du PDF fusionnées en une chaîne très longue) — même
// classe de défaut que le vrai bug ReDoS déjà rencontré sur VEC_RE. NEEDLE_SIZE_FIRST_RE
// elle-même n'est pas quadratique, mais autant lui épargner aussi le travail : une vraie
// ligne de fourniture est COURTE — la plus longue mesurée sur tout le corpus (Juice_Sweater,
// « 4.5 mm / US7: circular needles … Magic Loop technique. ») fait 172 caractères — tandis
// qu'un paragraphe d'intro reflowé dépasse largement ce seuil. `NEEDLE_SF_MAX_LEN` (300,
// marge ~1,7× le cas réel le plus long) écarte la ligne de la nouvelle voie AVANT d'engager
// NEEDLE_SIZE_FIRST_RE ou GAUGE_RE — ni l'une ni l'autre n'est plus jamais évaluée sur une
// chaîne longue. NEEDLE_RE et NEEDLE_BARE_RE ne sont pas concernés (aucun des deux n'a de
// lookahead non ancré, pas de risque quadratique équivalent) et restent inchangés.
const NEEDLE_SF_MAX_LEN = 300
// Le commentaire ci-dessus affirmait que NEEDLE_RE n'était « pas concernée » : c'est
// FAUX, mesuré. Son `.*` entre le mot-outil et la taille, sur un motif NON ANCRÉ, relance
// le balayage depuis chacune des occurrences du mot-outil : « crochet » répété jusqu'à
// 256 000 caractères coûte 5 319 ms (1 415 ms à 128 000, 88 ms à 32 000) — et c'est
// exactement la longueur d'intro reflowée que ce même commentaire décrit comme atteignable.
// Le coût reste quadratique, pas exponentiel : une borne suffit.
//
// Borne SÉPARÉE de NEEDLE_SF_MAX_LEN, et volontairement 13× plus haute. Les 300 de
// NEEDLE_SF_MAX_LEN sont un seuil SÉMANTIQUE (« au-delà, ce n'est plus une ligne de
// fourniture ») choisi sur la plus longue ligne réelle du corpus, 172 caractères ; les
// réutiliser ici RECLASSERAIT toutes les lignes de 300 à 4 000 caractères que NEEDLE_RE
// capte aujourd'hui — un changement de fidélité déguisé en correctif de sécurité. 4 000
// plafonne le pire cas à ~2 ms sans toucher au classement d'aucune ligne plausible.
const NEEDLE_REDOS_MAX_LEN = 4000
const isNeedleLine = (t) => String(t).length <= NEEDLE_REDOS_MAX_LEN && !/https?:/i.test(t) && (NEEDLE_RE.test(t) || NEEDLE_BARE_RE.test(t) || (String(t).length <= NEEDLE_SF_MAX_LEN && NEEDLE_SIZE_FIRST_RE.test(t) && !GAUGE_RE.test(t)))

// G3c — le filet global aiguilles (secours, sans section dédiée) ne doit PAS voler
// une PHRASE D'INSTRUCTION menant par une amorce « avec/en utilisant/with/using… »
// (« Avec le crochet 3mm, monter… ») : ce serait consommer le contenu utile — parfois
// la SEULE ligne — d'une section de travail, qui disparaîtrait alors (cf. zoe : SALOPETTE).
// Un vrai renvoi matériel mène par l'outil (« Crochet 3 mm »), pas par une préposition
// d'emploi. Restreint AU SEUL filet de secours ; les sections dédiées restent verbatim.
const INSTRUCTION_LEAD_RE = /^(?:avec|en utilisant|with|using|w\/|mit|con|med|met|anv[äa]nd|przy)\b/i
const isNeedleSpecForScavenge = (t) => isNeedleLine(t) && !INSTRUCTION_LEAD_RE.test(String(t).trim())

// G3b — filet fil élargi (Jumper49-D). YARN_RE exige un mot-fibre + quantité ; un fil nommé
// par marque (« Belle by ArtFil … (100g/354m) ») est raté. YARN_HINT_RE signe un fil SANS
// mot-fibre par un grammage+métrage parenthésé « (100g/354m) » (discriminant : un accessoire
// n'a pas de métrage) ou par le mot « coloris »/« colorway ».
const YARN_HINT_RE = /\(\s*\d+\s*g\s*\/\s*\d+\s*m\s*\)|colou?ris|colou?rway|coloway/i
const isYarnLine = (t) => YARN_RE.test(t) || YARN_HINT_RE.test(t)

// M4 (chantier « récupération blocs Fil/Aiguilles ») — Gilet manches 3-4
// Madelaine.pdf (corpus réel, patron trilingue) : le patron ouvre TROIS sections
// ref='aiguilles' d'une seule ligne chacune, verbatim « n° 3,5 et 4 » / « 3.5 mm & 4 mm »
// / « nr. 3,5 en 4 » — le TITRE de la section porte déjà AIGUILLES/NEEDLES/NADELS, la
// ligne ne répète donc pas le mot-outil (implicite). La branche sec.ref==='aiguilles'
// (cf. plus bas) exige un mot-outil (NEEDLE_RE ou son filet de secours) et envoie tout le
// reste au Matériel — garde babyfryd voulue pour un accessoire mesuré en mm SANS mot-outil
// (« Anneau en bois 45 mm », « Yeux de sécurité 6 mm »). Ces valeurs nues de taille
// finissaient donc, elles aussi, au Matériel : le bloc Aiguilles restait vide malgré une
// VRAIE section dédiée détectée.
// isBareSizeLine(t) : la ligne, une fois retirés les nombres, les unités (mm/cm/US), les
// préfixes de numéro (n°/no/nr.) et la ponctuation courante, ne contient plus QUE des
// connecteurs d'une liste FERMÉE — donc aucun nom d'objet. « Anneau en bois 45 mm » garde
// « Anneau »/« bois » (hors liste) → FAUX, la garde babyfryd n'est pas affaiblie. Un
// chiffre est exigé (une ligne sans aucune taille n'a rien à faire ici).
// Premier correctif (revue, mesure sur 3187 PDF) : un chiffre nu suffisait à passer le
// garde — un NUMÉRO D'ARTICLE isolé (« 15012 », 2 patrons du corpus web) n'a ni unité ni
// préfixe de taille et n'est composé QUE de chiffres, donc traversait tel quel. Garde
// supplémentaire : au moins UN token doit être une unité mm/US ou un préfixe de numéro
// (n°/no/nr) — un compte de chiffres nus seul (même mêlé à des connecteurs) ne suffit plus.
// Vérifié sur les cas déjà couverts : « n° 3,5 et 4 », « 3.5 mm & 4 mm », « nr. 3,5 en 4 »,
// « 2,5 et 3,0 mm », « 9 mm », « n° 5,5 et 6,5 », « 5.0 mm and 5.5 mm » portent tous au moins
// un « mm »/« n° »/« nr » — aucun gain mesuré n'est perdu.
const BARE_SIZE_CONNECTOR_RE = /^(?:et|and|&|en|y|und|e|og|och|ja|i|of)$/i
const isBareSizeLine = (t) => {
  const s = String(t)
  if (!/\d/.test(s)) return false
  const tokens = s.split(/[\s,;:()]+/).map((tok) => tok.trim()).filter(Boolean)
  if (tokens.length === 0) return false
  let hasUnitOrPrefix = false
  const allValid = tokens.every((tok) => {
    // Nombre nu — une décimale à la française (« 3,5 ») peut être scindée par le
    // séparateur virgule ci-dessus en deux tokens (« 3 », « 5 ») : les deux passent ici.
    if (/^\d+(?:[.,]\d+)?$/.test(tok)) return true
    if (/^mm$/i.test(tok) || /^US$/i.test(tok)) { hasUnitOrPrefix = true; return true } // unité qui signe une taille
    if (/^cm$/i.test(tok)) return true // unité tolérée mais ne signe pas À ELLE SEULE une taille d'outil
    if (/^n[°o]\.?$/i.test(tok) || /^nr\.?$/i.test(tok)) { hasUnitOrPrefix = true; return true } // préfixe de numéro
    return BARE_SIZE_CONNECTOR_RE.test(tok)
  })
  return allValid && hasUnitOrPrefix
}

// Étiquettes en ligne (clé → champ). Testées sur la partie AVANT le « : ».
const LABELS = [
  ['gauge', /^(?:[ée]chantillon|gauge|tension|masch(?:en|w)probe|musterprobe|masket[æe]thed|strikkefasthed|h[æe]klefasthed|maskfasthet|stickfasthet|neuletiheys|muestra|tensi[óo]n|campione|stekenproef|pr[óo]bka)$/i],
  // « laine »/« wool » — chantier « récupération blocs Fil/Aiguilles »,
  // Harlow_Sweater_FR, corpus réel) : divergence avec KIND_KEYWORDS de segment.js (kind
  // 'fil', \blaine\b|\bwool\b déjà présents ligne ~23) comblée ici, jamais couverte côté
  // étiquettes en ligne jusqu'ici.
  ['yarn', /^(?:fils?|yarn|garn(?:et)?|lanka|hilo|lana|laine|wool|filato|garen|w[łl][óo]czka|qualit[ée]s?|fibras?)$/i],
  ['needles', /^(?:aiguilles?|needles?|hook|crochets?|nadel(?:n)?|stricknadeln?|h[äa]kelnadel|(?:strikke)?pinde|h[æe]klen[åa]l|n[åa]l(?:er)?|stickor|virkn[åa]l|puikot|virkkuukoukku|koukku|agujas?|ganchillo|ferri|uncinetto|(?:brei|haak)?naald(?:en)?|druty|szyde[łl]ko)$/i],
  // « Notions » (EN) — aide-mémoire, Juice_Sweater_by_Kutovakika (corpus réel) :
  // « Notions: 16 stitch markers » est une étiquette en ligne, jamais reconnue jusqu'ici.
  // Même famille lexicale que segment.js (KIND_KEYWORDS 'materiel', cf. comment là-bas) pour
  // le périmètre FR/EN/ES/DE du projet : mercerie (FR), haberdashery (EN), mercería(s) (ES),
  // Kurzwaren (DE).
  ['materials', /^(?:fournitures?|mat[ée]riel|materials?|materiales|supplies|material(?:ien|er|en)?|materia[łl]y|zubeh[öo]r|tilbeh[øo]r|tillbeh[öo]r|accesorios|accessori|accessoires|akcesoria|tarvikkeet|notions?|mercerie|haberdashery|mercer[ií]as?|kurzwaren)$/i],
  ['sizes', /^(?:tailles?|sizes?|gr[öo](?:ß|ss)en?|st[øo]rrelser?|storlek(?:ar)?|koko|koot|tallas?|taglia|taglie|maat|maten|rozmiar(?:y)?)$/i],
  ['measures', /^(?:mesures?|measurements?|ma(?:ß|ss)e|m[åa]l|m[åa]tt|mitat|medidas|misure|afmetingen|wymiar(?:y)?)$/i],
  ['measure-row', /^(?:longueur(?:\sdes?\s.+)?|largeur|hauteur|circonf[ée]rence|tour de .+|length|width|height|circumference|l[äa]nge|breite|h[öo]he|umfang|l[æe]ngde|bredde|h[øo]jde|omkreds|largo|ancho|alto|contorno|lunghezza|larghezza|altezza|circonferenza|lengte|breedte|hoogte|omtrek|d[łl]ugo[śs][ćc]|szeroko[śs][ćc]|wysoko[śs][ćc]|obw[óo]d|pituus|leveys|korkeus|ymp[äa]rys|l[äa]ngd|bredd|h[öo]jd|omkrets|durchmesser|diam[èe]tre|diameter|di[áa]metro|diametro)$/i],
]

function labelFor(text) {
  const m = /^(.{1,40}?)\s*:\s*(.*)$/.exec(text.trim())
  if (!m) return null
  const key = m[1].trim()
  // Fold ẞ→ß (cf. text-norm.js, /i seul ne le fait pas) UNIQUEMENT pour décider le champ ;
  // `label: key` reste le texte ORIGINAL, jamais folder ce qui est émis (« MAẞE » doit
  // survivre tel quel dans le tableau de tailles, pas devenir « MAßE »).
  const folded = foldEszett(key)
  for (const [field, re] of LABELS) if (re.test(folded)) return { field, label: key, value: m[2].trim() }
  return null
}

// M2 (chantier « récupération blocs Fil/Aiguilles ») — Harlow_Sweater_FR (corpus
// réel) : un sous-titre NU comme « Aiguilles suggérées » n'est ni un titre de section
// (bold=false) ni une étiquette labelFor (pas de « : ») ; le mot-clé seul (« Aiguilles »)
// matcherait LABELS mais pas « Aiguilles suggérées ». Qualificatif court FERMÉ, toléré
// UNIQUEMENT en fin de ligne, mesuré sur le cas réel : suggéré(e)s, recommandé
// (e)s, nécessaire(s), utilisé(e)s, suggested, recommended, needed, required (EN),
// empfohlen, benötigt (DE — vocabulaire mesuré, pas inventé).
const LABEL_QUALIFIER_RE = /\s+(?:suggér[ée]es?|recommand[ée]es?|n[ée]cessaires?|utilis[ée]es?|suggested|recommended|needed|required|empfohlen|ben[öo]tigt)\s*$/i

// Chantier « récupération blocs Fil/Aiguilles » — Harlow_Sweater_FR (corpus
// réel) : un sous-titre NU « Abréviations » ouvre le glossaire au même titre que
// « Laine »/« Aiguilles suggérées » ouvrent Fil/Aiguilles. La table LABELS n'a AUCUNE
// entrée `abbr` (elle est partagée avec labelFor/referenceFieldForHeading, hors
// périmètre de cette tâche — lui en ajouter une les exposerait aussi) : vocabulaire
// LOCAL à bareLabelFor, repris — pas réinventé — du sous-ensemble FR/EN/ES/DE de
// KIND_KEYWORDS.abbr (segment.js, périmètre linguistique phase 1 du projet) :
// abréviations/abreviations (FR, cas réel Harlow), abbreviations (EN), abreviaturas
// (ES), abkürzungen/abkurzungen (DE).
const BARE_ABBR_LABEL_RE = /^(?:abr[ée]viations?|abbreviations?|abreviaturas|abk[üu]rzungen)$/i

// Chantier « aide-mémoire sous-titres et faux titres » — Harlow_Sweater_FR
// (corpus réel, retour d'usage direct) : un sous-titre nu « Conseils » (renvois vers
// des vidéos de technique) ouvre le bloc `tips`, même mécanisme que `abbr`/`materials`
// ci-dessus. Vocabulaire mesuré/plausible (pas de section dédiée `ref` existante pour
// ce champ, donc pas de LABELS partagé) : conseils/astuces (FR, cas réel Harlow), tips
// (EN), consejos (ES), tipps (DE) — périmètre linguistique phase 1 du projet.
const BARE_TIPS_LABEL_RE = /^(?:conseils?|astuces?|tips?|consejos?|tipps?)$/i

// Plafond de sécurité du bloc `materials` ouvert par un sous-titre nu (cf.
// bareBlock === 'materials' plus bas) : aucun prédicat de contenu ne caractérise « du
// matériel » (contrairement à yarn/needles/abbr), donc rien n'empêcherait un « Mercerie »
// mal détecté d'avaler indéfiniment tout le reste de la section si ni un sous-titre nu
// suivant ni la fin de section n'arrivent avant. Sur le cas réel (Harlow), le bloc
// Mercerie ne fait qu'UNE ligne : ce plafond est un pur garde-fou de sécurité, jamais
// atteint par un cas mesuré du corpus — valeur arbitraire mais raisonnable (assez large
// pour ne jamais gêner une vraie petite liste de mercerie, assez petite pour ne jamais
// avaler une section entière par erreur).
const MATERIALS_BAREBLOCK_CAP = 6

// Même plafond de sécurité que `materials` (cf. commentaire ci-dessus),
// pour la même raison : `tips` n'a lui non plus aucun prédicat de contenu (une ligne
// de conseil peut être n'importe quelle phrase). Constante séparée (même valeur) pour
// garder chaque champ indépendant si l'un des deux plafonds devait un jour bouger seul.
const TIPS_BAREBLOCK_CAP = 6

// Retour d'usage, après revue — un libellé de sous-titre nu
// IDENTIQUE au titre RÉSERVÉ du bloc qu'il ouvre (« Conseils » sous ## Conseils, « Tips »
// sous ## Conseils en anglais) n'apporte aucune nuance, contrairement à « Mercerie » sous
// Matériel ou « Aiguilles suggérées » sous Aiguilles : la recopie en tête de bloc devient
// un pur doublon avec le h3. Règle GÉNÉRALE (les 4 destinations de sous-titre nu : yarn/
// needles/materials/tips), comparée dans LES DEUX langues de l'interface (fr/en) — un
// patron anglais titrant « Tips » sous un bloc « Tips » (app en anglais) produirait le
// même doublon que « Conseils »/« Conseils » en français.
// Table LOCALE (pas d'import i18n : ce module, comme reader-reference.js, est lu par le
// banc corpus Node — zéro dépendance sur les fichiers de langue). Recopiée depuis les
// libellés réservés de reader-reference.js/src/i18n/{fr,en}.json (h3.yarn/needles/
// materials/tips) — à tenir synchronisée si l'un de ces libellés change un jour. `gauge`
// est absent : l'Échantillon n'est jamais une destination de sous-titre nu (garde du lot
// précédent) ; `abbr` est absent : son libellé n'est jamais recopié nulle part (le
// glossaire n'a pas de « tête de bloc » de prose, cf. commentaire de la branche abbr plus
// bas) — la question du doublon ne se pose donc pas pour ces deux champs.
const RESERVED_FIELD_TITLES = {
  yarn: ['Fil', 'Yarn'],
  needles: ['Aiguilles', 'Needles'],
  materials: ['Matériel', 'Materials'],
  tips: ['Conseils', 'Tips'],
}
// Comparaison accents + casse ignorés via `slug` (déjà réutilisé tel quel, cf. import) —
// même normalisation que `reservedKey` (refblocks.js) pour la compatibilité FR non balisée.
const isReservedTitleDuplicate = (field, text) => {
  const titles = RESERVED_FIELD_TITLES[field]
  if (!titles) return false
  const s = slug(text)
  return titles.some((title) => slug(title) === s)
}

// bareLabelFor(text) : la ligne, SANS « : » (ou avec un « : » terminal NU, sans valeur
// après), ≤ 40 caractères (même plafond que labelFor), SANS AUCUN CHIFFRE (une ligne qui
// porte déjà une valeur/taille n'est pas un TITRE nu), dont le texte — mot-clé
// PLUS qualificatif optionnel (LABEL_QUALIFIER_RE ci-dessus) retiré — matche EXACTEMENT
// une entrée LABELS. Restreint aux champs yarn/needles/materials (jamais gauge/sizes/
// measures : gauge doit rester STRICTEMENT bit-identique, cf. « le bloc Échantillon
// n'est jamais une destination de sous-titre nu » — garde de non-régression du lot
// précédent, volontairement non touchée) — PLUS `abbr`, testé séparément via
// BARE_ABBR_LABEL_RE ci-dessus puisqu'il n'a pas d'entrée LABELS.
// PORTÉE du « : » terminal NU (premier correctif, revue) : cette clause n'est
// atteinte QUE pour un libellé QUALIFIÉ (« Aiguilles suggérées: ») — un mot-clé NU seul
// suivi de « : » (« Laine: », « Aiguilles: ») est intercepté PLUS TÔT par labelFor(t) dans
// la boucle appelante (labelFor matche déjà « Laine » avant que bareLabelFor ne soit même
// appelée) ; ce cas-là est traité séparément, dans la boucle, au point d'appel de
// bareLabelFor (cf. « premier correctif, point c » ci-dessous — chemin mort débusqué en
// revue, rendu atteignable là où il compte plutôt que retiré ici).
// PRUDENCE : le garde anti-chiffre est structurellement subsumé par le match ANCRÉ
// (^…$) contre une alternation purement alphabétique dans LABELS — aucune chaîne portant
// un chiffre ne peut de toute façon matcher exactement ce motif. Conservé quand même en
// défense de profondeur (documenté, pas retiré) : si LABELS s'élargit un jour d'un motif
// contenant un joker (cf. 'measure-row' plus bas, qui a un `.+`), ce garde redevient actif
// sans qu'il faille y repenser ici.
function bareLabelFor(text) {
  const s = String(text).trim()
  if (s.length > 40) return null
  if (/\d/.test(s)) return null
  const stripped = s.replace(/:\s*$/, '') // « : » terminal NU toléré (spec), retiré avant test
  if (stripped.includes(':')) return null // un « : » non terminal = une vraie étiquette labelFor
  const withoutQualifier = stripped.replace(LABEL_QUALIFIER_RE, '')
  const folded = foldEszett(withoutQualifier.trim())
  if (BARE_ABBR_LABEL_RE.test(folded)) return 'abbr'
  if (BARE_TIPS_LABEL_RE.test(folded)) return 'tips'
  for (const [field, re] of LABELS) {
    if (field !== 'yarn' && field !== 'needles' && field !== 'materials') continue
    if (re.test(folded)) return field
  }
  return null
}

// Défauts 1+2 (banc vague 3, baby-unicorn-fr-a5fc31d5, corpus réel Hobbii) — une section
// Abréviations AUTHENTIQUE (sec.ref==='abbr') enchaîne parfois, sans transition, un
// rappel de fil (« Fil: Rainbow 8/4 Glitter Silver ») puis ses coloris/quantités
// (« Optic White Silver (#001) - 1 pelote », « Rose (#44) - 1 pelote ») : une ligne de
// laine n'est JAMAIS une abréviation, qu'elle soit courte ou longue. Deux symptômes
// mesurés, MÊME CAUSE :
//   - une couleur COURTE (« Rose (#44) », clé ≤ 24 car.) passe ABBR_DASH_ASCII_RE et
//     devient une FAUSSE entrée de glossaire (défaut 2) ;
//   - une couleur LONGUE (« Optic White Silver (#001) », 26 car.) dépasse son plafond
//     de clé et DISPARAÎT purement et simplement, aucun filet de secours ne la
//     récupère (défaut 1) — la laine principale du patron devient introuvable.
// isYarnLabelLine réutilise labelFor/LABELS (déjà la même normalisation que « Laine: »/
// « Fil: » ailleurs dans ce fichier) plutôt qu'un nouveau motif. isColorwayLine réutilise
// COLORWAY_RE (Au2, déjà le détecteur du fichier pour « N pelote(s)/skein(s)/… ») : aucune
// des VRAIES abréviations du corpus (« ml », « 1 dim »…) ne porte ce vocabulaire de
// quantité, donc pas de risque de rejeter une abréviation légitime. Testées AVANT tout
// essai d'execAbbrLine (cf. point d'appel plus bas) — la longueur de la clé apparente ne
// rentre plus du tout en ligne de compte pour ces lignes.
const isYarnLabelLine = (t) => labelFor(String(t))?.field === 'yarn'
const isColorwayLine = (t) => COLORWAY_RE.test(String(t))

// Champ de référence porté par une ligne TITRE ou ÉTIQUETTE (« Échantillon »,
// « Gauge », « Materials: … ») : teste la partie avant un éventuel « : » contre
// les LABELS ANCRÉS (^…$) → un simple mot « gauge » au fil d'une phrase ne matche
// PAS. Pur, exporté pour la détection multi-patrons (pipeline-core.js éditeur).
export function referenceFieldForHeading(text) {
  const t = String(text ?? '').trim()
  const head = /^(.{1,40}?)\s*:/.exec(t)?.[1]?.trim() ?? t
  // Fold ẞ→ß (cf. text-norm.js) pour la décision de champ uniquement ; cette fonction ne
  // renvoie qu'une clé de champ (jamais de texte stocké), donc rien à préserver ici.
  const folded = foldEszett(head)
  for (const [field, re] of LABELS) if (re.test(folded)) return field
  return null
}

// G4c — mesures « prose par taille » transposées (une ligne PAR taille, préfixée du
// token détecté par detectSizeLabels — « S/M: … », « L/XL: … » — chaque ligne portant
// ≥1 sous-mesure en PROSE : « <Label> … <valeur> [unité]. <Label2> … <valeur2>[unité]. »
// — au lieu d'un vecteur multi-valeurs sur une seule ligne). Fallback de DERNIER
// RECOURS : ne se déclenche QUE si les 3 branches précédentes (vecteur multi-valeurs,
// kv n===1, G4b « n nombres en fin de ligne ») ont déjà échoué. Découpage :
//   1. retirer le préfixe de taille reconnu (« S/M: ») — donne l'INDEX de la taille ;
//   2. scinder le reste en PHRASES sur un point suivi d'une MAJUSCULE (pas sur le point
//      de « env. », qui est suivi d'un chiffre) ;
//   3. dans chaque phrase, la VALEUR = un nombre (+ unité cm/mm/m optionnelle), précédé
//      d'un « env. » optionnel gardé DANS la valeur ; tout ce qui précède est le LIBELLÉ.
// Fusion : les sous-mesures de MÊME libellé (normalisé) vues sur des lignes de tailles
// successives se fondent en UNE rangée transposée { label, values: [v_taille1, …] }.
// (SENTENCE_SPLIT_RE est déclarée plus haut, réutilisée par isNonGlossaryDef.)
//
// Mesure CARRÉE/RECTANGLE (« 110 x 110 cm », « env. 45 x 30 cm ») : le groupe valeur
// tolère un SECOND nombre séparé par « x »/« × » avant l'unité — sans lui, le groupe
// libellé (paresseux) s'étend jusqu'au DERNIER nombre+unité de la ligne et avale le
// premier nombre du couple (bug réel peacock-shawl-in-kid-silk-en, campagne 27/08 :
// « Ca. 110 x 110 cm » scindait en libellé « Ca. 110 x » / valeur « 110 cm », le
// carré 110×110 cm perdant sa moitié gauche). Étendre CE groupe (jamais le libellé)
// garde le comportement existant intact pour toute mesure à un seul nombre : le
// groupe est optionnel, il ne matche que si un second nombre suit réellement un
// séparateur « x »/« × ».
const SUBMEASURE_VALUE_RE =
  /^(.*?)\s+((?:env\.?\s*)?\d+(?:[.,]\d+)?\s*(?:[x×]\s*\d+(?:[.,]\d+)?\s*)?(?:cm|mm|m)?)\.?\s*$/i
const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// G4e — taille unique déclarée SANS AUCUN chiffre (« Onesize », « One size », « Taille
// unique », « Einheitsgröße »…) : RÉCIDIVE 3x (Confetti Glass palier 6 « Size: One size »,
// Ydun « GRÖSSE » → « Onesize », Scallops Rectangular Placemat « GRÖSSE » → « One size »).
// G4d (ci-dessous) exige `/\d/.test(t)` — une garde nécessaire pour ne pas capter n'importe
// quelle prose courte comme mesure — donc une déclaration de taille unique SANS chiffre ne
// la satisfait jamais et disparaît en silence. Vocabulaire FERMÉ multilingue (pas un filet
// générique sans chiffre, qui capterait n'importe quelle prose courte à tort) : bornes de
// ligne ENTIÈRE, tiret bas optionnel/espace pour « one size »/« onesize », ẞ capital géré au
// point de test via foldEszett (jamais sur le texte stocké, cf. text-norm.js).
const ONE_SIZE_RE = /^(?:one[\s-]?size|taille\s+unique|einheitsgr[öo](?:ß|ss)e|talla\s+[uú]nica|taglia\s+unica)\s*$/i

// Qualificatif de groupe « avant/après lavage-blocage » (cf. commentaire d'usage,
// extractReference, pass 1) : sous-titre SANS chiffre qui distingue deux jeux de mesures
// du MÊME tableau (« Antes de lavar y bloquear: » / « Después de lavar y bloquear: »,
// mammatus-bandana-es-41564957). Vocabulaire FERMÉ, une seule langue vérifiée au corpus.
const BEFORE_AFTER_BLOCKING_RE = /^(?:antes|despu[ée]s)\s+de\s+(?:lavar(?:\s+y\s+bloquear)?|bloquear)$/i

// Sous-label d'une entrée technique (`## Techniques {techniques}` → `### <nom>`) :
// une clé courte suivie de « : texte » SUR LA MÊME LIGNE (même forme qu'ABBR_LINE_RE,
// « M1R : Piquer l'aiguille gauche… », Barley Field). Un « : » nu SANS texte à sa suite
// (« Alles is gemaakt in dezelfde steek: ») n'ouvre PAS d'entrée : c'est une amorce de
// phrase, pas un nom de technique — sans ce garde, un bloc SANS sous-structure interne
// (« Hoe haak je 4-stokjes-samen », gate ainsa-bandana-nl) se scinderait à tort en 2.
const TECH_LABEL_RE = /^([^:]{1,24}?)\s*:\s+(\S.*)$/

// G4b : fallback « label + exactement n nombres séparés par des ESPACES » (cf. commentaire
// au point d'appel, dans extractReference). Sortie du balayage par ligne — ce motif ne
// dépend ni de `t` ni de `n`, seulement recompilé à chaque ligne avant ce correctif.
const G4B_NUM = String.raw`\d+(?:[.,]\d+)?(?:-\d+(?:[.,]\d+)?)?`
const G4B_LABEL_NUMS_RE = new RegExp(String.raw`^(.*?\S)\s+(${G4B_NUM}(?:\s+${G4B_NUM})*)$`)

export function extractReference(sections, { n = 1, sizeLabels = [], preAbbr = [], preNotes = [] } = {}) {
  const abbr = []
  // Lignes non-glossaire routées en note visible (cf. formRejectedAbbrLine ci-dessus).
  // Préfixées par les remarques du glossaire en colonnes (lu avant le reflow
  // dans assemble.js) : ces phrases (NOTE, légende…) n'ont pas de section à rejoindre,
  // elles sont donc déjà routées ici par l'appelant.
  const notes = [...preNotes]
  const seen = new Map()
  const normDef = (d) => d.replace(/\s+/g, ' ').trim().toLowerCase()
  // `raw` : ligne verbatim d'origine. Une clé déjà prise avec une AUTRE définition ne peut
  // pas rejoindre le glossaire (la première occurrence gagne) : la ligne part alors en note
  // au lieu de disparaître (l'appelant la consomme, ou sa section est écartée du travail).
  const addAbbr = (key, def, raw) => {
    const k = key.trim()
    if (!k) return
    if (!seen.has(k)) { seen.set(k, normDef(def)); abbr.push({ key: k, def: def.trim() }); return }
    if (raw && seen.get(k) !== normDef(def)) notes.push(raw)
  }
  // Entrées pré-extraites par readColumnGlossary : injectées AVANT tout
  // balayage de section, même dédoublonnage par clé que ci-dessus (la première
  // occurrence gagne) — cohérent avec le fait qu'elles ont été lues, dans le document,
  // avant tout le reste.
  for (const e of preAbbr) addAbbr(e.key, e.def)
  let gauge = ''
  const gaugeLines = []
  const needles = []
  const yarns = []
  // M1 (chantier « récupération blocs Fil/Aiguilles ») — réserve du filet
  // FRAGMENT (cf. isIsolatedScavengeLine/garde C plus bas) : des PHRASES (pas des lignes
  // entières) glanées dans une intro multi-phrases, recopiées SANS consommer leur ligne
  // d'origine. Fusionnées dans needles/yarns en tout dernier (fin d'extractReference)
  // SEULEMENT si le champ correspondant est resté vide — priorité absolue à toute vraie
  // ligne entière rencontrée n'importe où dans le document, avant ou après. Jamais de
  // réserve gauge : la branche gauge du filet reste seule responsable de ce champ.
  const needleFragments = []
  const yarnFragments = []
  const sizeTable = []
  // Préfixes de taille reconnus (G4c) : un pattern ancré par libellé, seulement si le
  // compte de libellés colle à n (sinon aucun index fiable où ranger la valeur).
  const sizePrefixRe = sizeLabels.length === n
    ? sizeLabels.map((lbl) => new RegExp(`^${escapeRegExp(lbl)}\\s*:\\s*`, 'i'))
    : []
  const materials = []
  // Bloc `tips` (« Conseils »), même forme que `materials` : un tableau de
  // lignes verbatim, ouvert par bareLabelFor/BARE_TIPS_LABEL_RE, jamais par une
  // section dédiée (aucun `sec.ref==='conseils'` détecté par segment.js, hors périmètre).
  const tips = []
  // Entrées `{title, body}` du bloc Techniques (accumulées sur TOUTES les sections
  // ref==='techniques', même « éclatées » en plusieurs sections distinctes — soft-twist-
  // mittens-and-headband, gate : « Comment faire le croisement » et « Comment crocheter
  // un point étoile » sont 2 sections séparées qui doivent pourtant rejoindre le MÊME
  // onglet Techniques ; buildReference les réunit en un seul bloc, dans l'ordre du document).
  const techniques = []
  // Au2 — plafond des fils : on borne le total à 16 (garde-fou) mais on ne compte que les
  // lignes-fil de QUALITÉ (≤ 8) dans le sous-plafond ; une ligne-coloris (« N pelote(s) de
  // coul. X ») passe sans consommer le sous-plafond, pour ne pas écraser « 100% coton »,
  // le métrage ou un 2e fil quand un patron liste beaucoup de coloris.
  let yarnQualityCount = 0
  const pushYarn = (text) => {
    if (!text || yarns.length >= 16) return
    if (COLORWAY_RE.test(text)) { yarns.push(text); return }
    if (yarnQualityCount >= 8) return
    yarns.push(text)
    yarnQualityCount++
  }
  const push = (field, text) => {
    if (!text) return
    if (field === 'gauge') gaugeLines.push(text)
    else if (field === 'yarn') pushYarn(text)
    else if (field === 'needles') { if (needles.length < 6) needles.push(text) }
    else if (field === 'materials') materials.push(text)
  }
  // Renvoie true SEULEMENT si une vraie valeur de mesure a été captée (sert au
  // point d'appel « measure-row » à ne consommer la ligne que si elle est bien une
  // mesure — sinon « Tour de diminution: … » (un rang de tricot) matcherait le label
  // et disparaîtrait sans jamais alimenter le tableau des tailles).
  const pushMeasure = (label, rest) => {
    const vecs = findSizeVectors(rest)
    const v = vecs.find((x) => x.values.length === n)
    if (v && n > 1) { sizeTable.push({ label, values: v.values }); return true }
    if (n > 1) {
      // Valeurs séparées par des virgules « 52, 53, 54, 55, 56, 57 » (sans parenthèses).
      const parts = rest.split(/\s*[,;]\s*/).map((x) => x.trim()).filter(Boolean)
      if (parts.length === n && parts.every((p) => /^\d+(?:[.,]\d+)?(?:\s*cm)?$/.test(p))) {
        sizeTable.push({ label, values: parts.map((p) => p.replace(/\s*cm$/, '')) })
        return true
      }
      // Valeur UNIQUE, identique pour toutes les tailles (floral-breeze-dress-es-4340dc10,
      // campagne vague 6 : « Largo: 66 cm o longitud preferida », « Longitud de la manga: 22
      // cm o longitud preferida » — aucun vecteur, une seule mesure valable pour les 8
      // tailles). Même garde que le mécanisme jumeau de la branche sec.ref==='mesures'
      // (ci-dessous dans ce fichier) : une VRAIE unité de longueur (cm/mm/in/po)
      // immédiatement après le nombre, et AUCUN second chiffre ensuite dans `rest` — un
      // taux (« 28 mailles pour 10 cm ») ou un décompte (« 132 br ») ne matche donc jamais.
      const single = /^(\d+(?:[.,]\d+)?)\s*(?:cm|mm|in\b|inch(?:es)?\b|po\b)/i.exec(rest)
      if (single && !/\d/.test(rest.slice(single[0].length))) {
        sizeTable.push({ label, values: Array(n).fill(single[1]) })
        return true
      }
    }
    if (n === 1 && rest) { sizeTable.push({ label, values: [rest] }); return true }
    return false
  }

  // Filets globaux (héritage v1) : ne doivent jouer le rôle de
  // filet de secours QUE si aucune section dédiée correspondante n'existe, et
  // jamais en volant le contenu d'une vraie section de travail titrée (garde B).
  const hasNeedleSec = (sections || []).some((s) => s.ref === 'aiguilles')
  const hasYarnSec = (sections || []).some((s) => s.ref === 'fil')
  const hasGaugeSec = (sections || []).some((s) => s.ref === 'echantillon')
  const isNonWorkSection = (s) => s.intro === true || s.kind === 'pelote'
  // Garde C ÉTROITE (Ellie - Summer Top, de, campagne palier 4/8) — une section INTRO est
  // reflowée EN AMONT (assemble.js, reflowLines para:true) en UN SEUL paragraphe : si ce
  // paragraphe de plusieurs phrases MENTIONNE en passant un fragment qui ressemble à une
  // spec technique (« … Nadel 4 mm … Nadel 5 mm … »), le filet de secours (censé ne jouer
  // que pour un patron SANS AUCUNE section dédiée nulle part, sur une ligne COURTE et
  // ISOLÉE) le confondait avec LA ligne aiguilles/fil/échantillon et avalait tout le
  // paragraphe — donc toute l'intro. Signal : ≥ 2 phrases (point suivi d'une majuscule,
  // SENTENCE_SPLIT_RE — déjà utilisé plus haut pour distinguer glossaire de prose) ⇒ ce
  // n'est PAS une ligne de secours isolée, le filet ne doit jamais s'y déclencher.
  // Restreint à sec.intro===true (la section « Présentation » reflowée en paragraphe) :
  // une section générique non titrée (kind='pelote' sans intro) garde son comportement
  // multi-lignes existant — c'est d'ailleurs ce qui permet à une ligne courte voisine
  // (hors intro) de rester éligible au filet quand le paragraphe d'intro, lui, ne l'est
  // plus. PRUDENCE anti-régression : une intro à UNE SEULE phrase (patron sans aucune
  // section dédiée nulle part) n'est pas bloquée.
  const isIsolatedScavengeLine = (s, t) => s.intro !== true || !SENTENCE_SPLIT_RE.test(String(t))

  for (const sec of sections || []) {
    // Libellé de mesure PORTÉ PAR LA LIGNE PRÉCÉDENTE, en attente de son vecteur
    // (ou de sa valeur unique) sur la ligne suivante (« Bust circumference of finished
    // garment: » puis, ligne suivante, les 11 valeurs SEULES — PDF réel Mia Cardigan).
    // Déclaré ICI, en tête de boucle SECTION (pas boucle ligne) : un libellé ne doit
    // JAMAIS fuir d'une section à l'autre — remis à '' à chaque nouvelle section, qu'il
    // ait été consommé ou non par la section précédente.
    let pendingMeasureLabel = ''
    // Ligne verbatim du libellé en attente : s'il n'est jamais apparié (écrasé par un autre
    // libellé, supplanté par une ligne qui ne le reprend pas, ou fin de section), il part en
    // note plutôt que de disparaître (la section « mesures » est écartée du travail en aval).
    let pendingMeasureRaw = ''
    const dropPendingMeasure = () => {
      if (pendingMeasureLabel) notes.push(pendingMeasureRaw)
      pendingMeasureLabel = ''
      pendingMeasureRaw = ''
    }
    // Index label(normalisé) → position dans sizeTable, pour fusionner les sous-mesures
    // d'une même rangée transposée vues sur des lignes de tailles successives (G4c).
    // Déclaré ICI, en tête de boucle SECTION (et non une seule fois pour tout le
    // document), pour la MÊME raison que pendingMeasureLabel juste au-dessus : il
    // mémorise des positions ABSOLUES dans `sizeTable`, qui, lui, continue de croître
    // d'une section à l'autre. Partagé entre sections, un libellé banal réapparaissant
    // dans une section ultérieure (« Largeur », « Longueur ») retrouvait l'index de la
    // rangée d'une AUTRE section et écrasait ses valeurs au lieu d'ouvrir une rangée —
    // mesures de la première section perdues en silence.
    const proseSizeIndex = new Map()
    // Repère pour G4e (cf. plus bas, filet sibling de G4d) : longueur de sizeTable AVANT
    // cette section — permet de savoir si une AUTRE branche a déjà poussé une mesure pour
    // CETTE section précise avant d'y appliquer le filet « taille unique sans chiffre ».
    // PRUDENCE : capturé ICI, en tête de boucle section, AVANT la passe « Étiquettes en
    // ligne » ci-dessous (qui peut déjà pousser via pushMeasure, ex. label measure-row
    // « Länge: 45 cm ») — capturé plus bas (après cette passe) il aurait inclus à tort ses
    // propres pushs, désactivant la garde (bug détecté par le test de non-régression dédié).
    const sizeTableStartLen = sizeTable.length
    // 2. Blocs d'abréviations (sections non dédiées) : ≥3 lignes consécutives « clé = déf ».
    if (!sec.ref) {
      const kv = sec.lines.map((l) => {
        const m = ABBR_KV_RE.exec(l.text.trim())
        return m &&
          !labelFor(l.text) &&
          !rejectAsAbbr(m[1], m[2], sizeLabels) &&
          !isRowSideMarkerKey(m[1]) &&
          !isRowInstructionDef(m[2])
          ? m
          : null
      })
      for (let i = 0; i < kv.length; i++) {
        if (!kv[i]) continue
        let j = i
        while (j < kv.length && kv[j]) j++
        // Un vrai glossaire ne répète pas une clé : un bloc « Envers: … / Endroit: … /
        // Envers: … » est une suite de rangs (rangs raccourcis), il reste dans le travail.
        const runKeys = kv.slice(i, j).map((m) => m[1].trim())
        if (j - i >= 3 && new Set(runKeys).size === runKeys.length) {
          for (let k = i; k < j; k++) { addAbbr(kv[k][1], kv[k][2], sec.lines[k].text); sec.lines[k].consumed = true }
        }
        i = j
      }
    }
    // Étiquettes en ligne, dans TOUTES les sections (y compris dédiées : une ligne
    // « Échantillon: … » dans un bloc Fournitures va à l'échantillon, pas au matériel).
    if (sec.ref !== 'abbr') {
      let block = null // champ ouvert par une étiquette nue (« Fil: » sans valeur)
      // M2 — champ ouvert par bareLabelFor (« Laine » nu, sans « : »). Mécanisme
      // ADDITIF distinct de `block` ci-dessus : jamais mélangé à ses branches (cf. plus
      // bas), pour garder le chemin existant bit-identique (règle centrale du plan).
      let bareBlock = null
      // Premier correctif (revue, mesure 71 patrons + corpus web, point b) — la ligne
      // d'ouverture d'un bloc nu (kodachi-ja-5afa3a73 : « Needle », JAMAIS suivie d'une
      // valeur) ne doit être marquée `consumed` QUE si une valeur a effectivement été
      // routée derrière elle (jamais perdre d'info : masquer n'est pas perdre, mais
      // supprimer sans rien mettre à la place EST perdre). On garde donc une référence à
      // la ligne d'ouverture EN ATTENTE, consommée seulement au premier push réussi.
      let bareBlockLabel = null
      // Compteur de PLAFOND DE SÉCURITÉ du bloc `materials` (aucun prédicat ne
      // caractérise « du matériel », contrairement à yarn/needles ci-dessus) : remis à
      // zéro à CHAQUE ouverture d'un bloc `materials` (cf. point d'ouverture plus bas),
      // jamais cumulatif sur toute la section.
      let materialsBareCount = 0
      // Compteur jumeau pour `tips` (cf. TIPS_BAREBLOCK_CAP), même remise à
      // zéro à CHAQUE ouverture d'un bloc `tips`.
      let tipsBareCount = 0
      // Qualificatif de groupe « avant/après lavage-blocage » (mammatus-bandana-es-
      // 41564957, campagne vague 6) : le PDF distingue deux jeux de mesures sous un
      // sous-titre SANS chiffre (« Antes de lavar y bloquear: » / « Después de lavar y
      // bloquear: »), chacun suivi de plusieurs lignes measure-row (« Ancho: … »,
      // « Largo: … ») qui portent CHACUNE déjà leur propre libellé. Cette passe-ci (pass 1,
      // « Étiquettes en ligne ») est celle qui consomme réellement ces lignes measure-row
      // (via labelFor → pushMeasure, ci-dessous) — le mécanisme pendingMeasureLabel de
      // le mécanisme de pass 2 (branche sec.ref==='mesures' plus bas) arrive TROP TARD : par
      // construction pass 1 s'exécute EN ENTIER avant pass 2, donc quand pass 2 capte le
      // sous-titre, les lignes measure-row qu'il devait qualifier sont déjà `consumed`
      // (pass 1 les a déjà poussées, SANS lui). Repère local À CETTE passe, jamais lu ni
      // écrit par pass 2 (pendingMeasureLabel, distinct, inchangé).
      // Vocabulaire FERMÉ, volontairement ÉTROIT (une seule occurrence vérifiée au
      // corpus, en espagnol) : n'étend PAS « toute ligne sans chiffre » en qualificatif
      // persistant (qui contaminerait n'importe quel sous-titre non lié précédant une
      // ligne measure-row) — seul ce vocabulaire lexical précis (lavage/blocage)
      // déclenche l'attache, et seule une ligne NON reconnue par labelFor (donc jamais
      // consommée par ailleurs) peut la déclencher.
      let pendingBlockingQualifier = ''
      for (const line of sec.lines) {
        if (line.consumed) continue
        const t = line.text.trim()
        const lab = labelFor(t)
        if (!lab) {
          const strippedForQualifier = t.replace(/[\s:]+$/, '').trim()
          if (BEFORE_AFTER_BLOCKING_RE.test(strippedForQualifier)) pendingBlockingQualifier = strippedForQualifier
        }
        if (lab) {
          // Une étiquette RÉELLE (« : ») referme toujours un bloc nu en cours : priorité
          // au mécanisme existant. Le bloc nu en attente n'a rien routé → NON consommé
          // (point b), cohérent avec la fermeture par contenu ci-dessous.
          bareBlock = null
          bareBlockLabel = null
          // Premier correctif (revue, point c) — une étiquette RÉELLE yarn/needles à
          // valeur VIDE (« Laine: », « Aiguilles: ») dans une section où le mécanisme
          // `block` classique NE PEUT PAS jouer pour la continuation (`block && !sec.ref`
          // exige `!sec.ref` ; ici `sec.ref` est vrai — 'echantillon' ou toute autre
          // section dédiée) : router par `bareBlock` à la place, sous les MÊMES gardes que
          // M2 (éligibilité de section, garde B) — sinon la ligne est consommée (juste en
          // dessous, `line.consumed = true` inconditionnel) et son contenu, potentiel ou
          // réel, n'atteint jamais aucun bloc : chemin mort débusqué en revue
          // (`stripped = s.replace(/:\s*$/, '')` dans bareLabelFor ne le couvrait QUE pour
          // un libellé QUALIFIÉ + « : » — cf. commentaire de bareLabelFor — jamais pour un
          // mot-clé NU comme « Laine: », toujours intercepté ICI par labelFor en premier).
          if (
            !lab.value &&
            (lab.field === 'yarn' || lab.field === 'needles') &&
            sec.ref &&
            (sec.ref === 'echantillon' || isNonWorkSection(sec)) &&
            (lab.field === 'yarn' ? !hasYarnSec : !hasNeedleSec)
          ) {
            bareBlock = lab.field
            bareBlockLabel = line
            continue
          }
          // Même chemin mort que ci-dessus, pour `materials`/`tips` : « Materials: » (valeur vide) est
          // intercepté par labelFor AVANT bareLabelFor, puis perdu — le mécanisme `block` classique
          // exige `!sec.ref` (l.1160) alors qu'ici sec.ref vaut 'echantillon', donc les lignes
          // suivantes retombent dans le puits `gauge` (l.1223). Mesuré sur Mia_Cardigan : le bloc
          // Échantillon contenait la jauge + les boutons + les marqueurs + la quantité de laine.
          // Éligibilité VOLONTAIREMENT plus étroite que yarn/needles (jamais isNonWorkSection) :
          // `materials`/`tips` n'ont AUCUN prédicat de contenu, cf. l.1128-1139.
          if (!lab.value && (lab.field === 'materials' || lab.field === 'tips') && sec.ref === 'echantillon') {
            bareBlock = lab.field
            if (lab.field === 'materials') materialsBareCount = 0
            if (lab.field === 'tips') tipsBareCount = 0
            bareBlockLabel = line
            continue
          }
          // measure-row : le label « Tour de … »/« Longueur … » est très permissif et
          // peut matcher un RANG (« Tour de diminution: … ») — on ne consomme la ligne
          // que si pushMeasure capte une vraie valeur ; sinon on la laisse à la section
          // de travail (steps.js). Les autres champs consomment toujours.
          if (lab.field === 'measure-row') {
            // Qualificatif « avant/après blocage » en attente (cf. pendingBlockingQualifier
            // ci-dessus) : rattaché au libellé propre de la ligne — jamais consommé lui-même,
            // il continue d'annoncer les lignes measure-row suivantes jusqu'au prochain
            // sous-titre de groupe (remplacement par simple réaffectation, plus haut).
            const label = pendingBlockingQualifier ? `${lab.label} (${pendingBlockingQualifier})` : lab.label
            if (pushMeasure(label, lab.value)) { line.consumed = true; block = null }
            continue
          }
          // Les tailles vont au front-matter (sizes.js) — SAUF pour un patron mono-taille
          // (n=1) où « Taille: … » porte la seule mesure finale du patron (kawaii-ghost :
          // « Taille: environ 11 x 7 cm »), sinon perdue. Garde « chiffre » : « Taille: Unique »
          // (sans mesure) ne crée pas de rangée fantôme (régressait un ref du gate).
          // Pour n > 1, ne CONSOMMER (retirer du corps) que si cette ligne porte bien les n
          // tailles attendues (sizeLineTokens — même extraction que sizes.js) : sinon rien ne
          // garantit que son contenu a été récupéré dans `sizes:` (ex. deux unités d'âge sur
          // la même ligne, « Größe: 18 Monate, (2, 4, 6, 8) Jahre », que sizes.js ne résout pas
          // toujours en n libellés exacts) — la ligne disparaissait alors silencieusement,
          // perdue nulle part. Mieux vaut la laisser, redondante avec le front-matter.
          // Cas plus subtil (jamais perdre d'info) : la ligne MENTIONNE une unité d'âge mais
          // sizeLineTokens est retombé sur le repli générique tokensOf (tokens tous
          // numériques nus, sans lettre) — le compte n colle, mais le MOT d'unité (« Monate »,
          // « Jahre »…) lui-même a été perdu du front-matter. Ne pas consommer non plus dans
          // ce cas : le corps reste alors le SEUL endroit où l'unité d'origine est lisible.
          if (lab.field === 'sizes') {
            if (n === 1) {
              line.consumed = true
              if (lab.value && /\d/.test(lab.value)) pushMeasure(lab.label, lab.value)
            } else if (lab.value) {
              const tokens = sizeLineTokens(lab.value)
              const countMatches = !!tokens && tokens.length === n
              const unitWordLost = countMatches && hasAgeUnitWord(lab.value) && tokens.every((tok) => !/\p{L}/u.test(tok))
              line.consumed = countMatches && !unitWordLost
            } else {
              line.consumed = true // étiquette nue « Tailles: » sans valeur inline : rien à perdre
            }
            block = null
            continue
          }
          line.consumed = true
          // « Wymiar: Ok. 22 cm » — une étiquette de mesure PORTANT sa valeur en ligne
          // devient une rangée du tableau des tailles (sinon la valeur inline était jetée
          // et seul un bloc s'ouvrait pour les lignes suivantes). Sans valeur → bloc.
          // `consumed` REPRIS si pushMeasure refuse la valeur (même garde que la branche
          // jumelle 'measure-row' plus haut, et que le repli Matériel de yarn/needles
          // juste en dessous) : une ligne « Mesures : environ 20 x 20 cm » à n>1 ne
          // produit aucune rangée (ni vecteur de longueur n, ni liste de n valeurs, ni
          // mesure unique à unité en TÊTE) — consommée quand même, elle disparaissait du
          // tableau ET du corps. Elle reste désormais dans le corps, verbatim.
          if (lab.field === 'measures') {
            if (lab.value) { if (!pushMeasure(lab.label, lab.value)) line.consumed = false }
            else block = 'measures'
            continue
          }
          // Revue (chantier « récupération blocs Fil/Aiguilles ») —
          // jamais perdre d'info : yarn/needles sont les DEUX SEULS champs de cette passe
          // plafonnés (cf. pushYarn/push) ; gauge/materials/sizes ne le sont pas et gardent
          // leur routage inchangé ci-dessous. Une étiquette RÉELLE (« Laine : … »,
          // « Aiguilles : … ») portant sa valeur en ligne ne doit pas disparaître
          // silencieusement une fois le plafond atteint — même mécanisme que bareBlock
          // (~ligne 847, before/after) : la valeur retombe au Matériel si le push a échoué.
          if (lab.value && (lab.field === 'yarn' || lab.field === 'needles')) {
            const arr = lab.field === 'yarn' ? yarns : needles
            const before = arr.length
            push(lab.field, lab.value)
            if (arr.length === before) materials.push(lab.value)
            block = null
            continue
          }
          if (lab.value) { push(lab.field, lab.value); block = null }
          else block = lab.field
          continue
        }
        // M2 (chantier « récupération blocs Fil/Aiguilles ») — sous-titre NU sans
        // « : » (Harlow_Sweater_FR : « Laine », « Aiguilles suggérées », bold=false, jamais
        // un titre de section détecté par segment.js ni une étiquette labelFor) : ouvre un
        // bloc de champ sur les lignes SUIVANTES, au même titre que `block` mais par un
        // chemin entièrement séparé.
        // `abbr` : fermeture PAR LE CONTENU, comme yarn/needles, mais en
        // réutilisant TEL QUEL le détecteur du glossaire déjà présent dans ce fichier
        // (execAbbrLine, forme « clé = déf »/« clé – déf ») plutôt qu'en écrivant un
        // second parseur — et en routant via `addAbbr` (dédoublonnage global par clé),
        // jamais dans un tableau de lignes comme yarn/needles/materials. Branche à PART,
        // le chemin `yarn`/`needles` ci-dessous (renommé `bareBlock === 'yarn' ||
        // bareBlock === 'needles'`, sinon inchangé) reste bit-identique.
        if (bareBlock === 'abbr') {
          const m = execAbbrLine(t)
          if (m) {
            addAbbr(m[1], m[2], t)
            // Le libellé d'ouverture (« Abréviations ») n'a pas de « tête de bloc » où se
            // recopier : contrairement à Fil/Aiguilles/Matériel (des blocs de PROSE, une
            // liste de lignes), le glossaire est une table clé→définition — il n'existe
            // aucune place structurelle pour y insérer un texte libre. Son information
            // (« ce qui suit est un glossaire ») est déjà portée par l'onglet
            // « Abréviations » lui-même : masquer n'est pas perdre (règle du projet).
            // Le libellé est donc consommé (jamais réaffiché ni ailleurs, ni ici) dès
            // que le tout premier vrai couple clé/définition a été capté derrière lui —
            // mais seulement alors (même invariant point b que yarn/needles : un
            // libellé qui n'introduit rien reste NON consommé).
            if (bareBlockLabel) { bareBlockLabel.consumed = true; bareBlockLabel = null }
            line.consumed = true
            continue
          }
          // Fermeture par contenu : cette ligne ne ressemble plus à une entrée de
          // glossaire → referme SANS consommer, repart dans le flux normal (peut
          // elle-même rouvrir un bloc nu juste en dessous, même mécanisme que Harlow
          // « Laine » ⏎ « Aiguilles suggérées »).
          bareBlock = null
          bareBlockLabel = null
        // `materials` : AUCUN prédicat ne caractérise « du matériel » (à la
        // différence de yarn/needles/abbr, qui ont chacun un détecteur de contenu) : la
        // fermeture se fait donc (1) au sous-titre nu SUIVANT — testé EN PREMIER, pour
        // que « Mercerie » se referme directement sur « Abréviations » sans ligne de
        // séparation, exactement comme Harlow — ou (2), à défaut,
        // à un PLAFOND DE SÉCURITÉ explicite (MATERIALS_BAREBLOCK_CAP, déclaré plus
        // haut avec le compteur `materialsBareCount`) : sans lui, un « Mercerie » mal
        // détecté avalerait indéfiniment tout le reste de la section.
        } else if (bareBlock === 'materials') {
          if (bareLabelFor(t)) {
            // La ligne COURANTE est elle-même un nouveau sous-titre nu (yarn/needles/
            // materials/abbr/tips) : referme SANS consommer — elle repart dans le flux
            // normal et rouvrira son propre bloc juste en dessous, même itération
            // (cf. `if (!bareBlock && !block)` plus bas).
            bareBlock = null
            bareBlockLabel = null
          } else if (materialsBareCount >= MATERIALS_BAREBLOCK_CAP) {
            // Plafond atteint : referme SANS consommer — jamais perdre d'info, la
            // ligne repart dans le flux normal (fallback échantillon/matériel déjà
            // en place, inchangé).
            bareBlock = null
            bareBlockLabel = null
          } else {
            if (bareBlockLabel) {
              // Même invariant « tout ou rien » que yarn/needles, adapté : ici aucun
              // push ne peut jamais échouer (materials.push n'a pas de plafond), donc
              // le libellé et la première valeur sont TOUJOURS poussés ensemble dès
              // que le bloc a un premier contenu. SAUF si le libellé est un
              // pur doublon du titre réservé « Matériel »/« Materials » (accents/casse
              // ignorés) — alors la recopie est omise, mais le libellé reste CONSOMMÉ
              // (il ne réapparaît nulle part ailleurs : masquer n'est pas perdre, le
              // mot survit via le h3 du bloc).
              if (!isReservedTitleDuplicate('materials', bareBlockLabel.text)) materials.push(bareBlockLabel.text)
              bareBlockLabel.consumed = true
              bareBlockLabel = null
            }
            // Le PDF range parfois le fil sous le sous-titre nu
            // « Materials »/« Matériel » (jamais de bloc `Fil` propre dans le document,
            // PDF réel Mia Cardigan) : une ligne qui porte un métrage (YARN_YARDAGE_RE)
            // est un fil quel que soit l'en-tête qui la précède, elle rejoint `yarns`
            // (même collecteur que toute autre ligne fil du document, ordre du PDF
            // conservé par la boucle) au lieu de `materials`. Garde « jamais perdre
            // d'info » (même invariant que needles ~l.1364/1381 plus bas, mesuré sur le
            // corpus : 28 lignes perdues sur 12 patrons par le même motif avant leur
            // correctif) : `pushYarn` est PLAFONNÉ (16 fils, 8 de qualité) et peut refuser
            // silencieusement — si la ligne n'a pas rejoint `yarns`, elle repart au
            // Matériel plutôt que de disparaître.
            const yarnsBefore = yarns.length
            if (YARN_YARDAGE_RE.test(t)) pushYarn(t)
            if (yarns.length === yarnsBefore) materials.push(t)
            materialsBareCount++
            line.consumed = true
            continue
          }
        // `tips` : calqué EXACTEMENT sur `materials` juste au-dessus (même
        // absence de prédicat de contenu, même fermeture sous-titre-suivant/plafond),
        // seule la destination (tableau `tips`) et le compteur changent.
        } else if (bareBlock === 'tips') {
          if (bareLabelFor(t)) {
            bareBlock = null
            bareBlockLabel = null
          } else if (tipsBareCount >= TIPS_BAREBLOCK_CAP) {
            bareBlock = null
            bareBlockLabel = null
          } else {
            if (bareBlockLabel) {
              // Même garde que materials : un libellé identique au titre
              // réservé « Conseils »/« Tips » (accents/casse ignorés) est un pur
              // doublon avec le h3 du bloc, sa recopie est omise (le libellé reste
              // consommé, cf. commentaire de la branche materials ci-dessus).
              if (!isReservedTitleDuplicate('tips', bareBlockLabel.text)) tips.push(bareBlockLabel.text)
              bareBlockLabel.consumed = true
              bareBlockLabel = null
            }
            tips.push(t)
            tipsBareCount++
            line.consumed = true
            continue
          }
        } else if (bareBlock) {
          // Prédicat du champ D'ABORD (baseValid), l'exclusion échantillon GAUGE_RE ENSUITE
          // — premier correctif (revue) : évite d'invoquer GAUGE_RE (deux lookaheads
          // non ancrés, coût QUADRATIQUE — cf. isNeedleLine, 314 ms mesurés à 20 000
          // caractères, 5 053 ms à 80 000) sur les lignes qui ne satisfont de toute façon
          // pas le prédicat, et jamais sur une ligne trop longue (borne NEEDLE_SF_MAX_LEN,
          // même garde que TOUS les autres points d'appel de GAUGE_RE/NEEDLE_SIZE_FIRST_RE
          // dans ce fichier — celui-ci ne l'avait pas : chemin d'appel neuf, atteignable en
          // production sur une intro reflowée en un seul (très long) paragraphe tant qu'un
          // bloc `needles` nu est ouvert).
          // Revue (constat critique) : la branche SŒUR `bareBlock === 'yarn'`
          // appelait isYarnLine (YARN_RE, même forme `(?=.*A)(?=.*B)`) SANS cette borne —
          // chemin d'appel neuf symétrique, atteignable tant qu'un bloc `yarn` nu est
          // ouvert (label « Laine »/« Fil » sans deux-points). Gel ~10,4 s reproduit
          // en revue. Même garde, même constante.
          const baseValid = bareBlock === 'yarn'
            ? (String(t).length <= NEEDLE_SF_MAX_LEN && isYarnLine(t))
            // isBareSizeLine (M4, déjà en place pour sec.ref==='aiguilles' ci-dessous) :
            // une valeur nue SANS mot-outil (« n° 3,5 et 4 », Gilet manches 3-4 Madelaine)
            // — le titre du bloc porte déjà AIGUILLES/NEEDLES, la valeur ne le répète pas.
            : (isNeedleSpecForScavenge(t) || isBareSizeLine(t))
          // Exclusion échantillon : un fragment reconnu GAUGE_RE (assimilation de
          // deux grandeurs, « = 10 cm »/« 10 x 10 cm ») n'est jamais avalé comme
          // continuation AIGUILLES, même s'il satisfait par ailleurs isNeedleSpecForScavenge
          // (NEEDLE_RE, sa voie principale, n'a pas cette garde en interne — seule la voie
          // NEEDLE_SIZE_FIRST_RE l'a, cf. isNeedleLine plus haut). Restreint au SEUL champ
          // needles : une vraie ligne d'échantillon mentionne quasi toujours la taille
          // d'aiguille utilisée, jamais un grammage/métrage de fil — appliquer la même
          // exclusion à `yarn` est un faux risque et un vrai piège mesuré sur ce fixture
          // même (Harlow, ligne « …coloris "06_064". » : le code coloris « 064 » collé au
          // guillemet fermant courbe matche par accident la signature GAUGE_RE « 4 pouces »
          // — /4\s*["”]/ — sans rapport aucun avec un échantillon).
          const isGaugeLine = baseValid && bareBlock === 'needles' &&
            String(t).length <= NEEDLE_SF_MAX_LEN && GAUGE_RE.test(t)
          const validCont = baseValid && !isGaugeLine
          if (validCont) {
            // Plafonds de champ (6 aiguilles / 8-16 fils, cf. push/pushYarn) : ne consommer
            // que si la ligne a VRAIMENT été poussée, sinon elle disparaîtrait sans laisser
            // de trace (jamais perdre d'info) — elle repart alors dans le flux normal.
            const arr = bareBlock === 'yarn' ? yarns : needles
            const before = arr.length
            if (bareBlockLabel) {
              // Décision produit (25/07, suite du chantier) : conserver le libellé
              // d'origine EN TÊTE du bloc, verbatim — le titre réservé du bloc (Fil/
              // Aiguilles) ne porte pas toujours la même nuance (Harlow : « Aiguilles
              // suggérées » dit qu'on peut substituer, « Aiguilles » seul ne le dit
              // pas). Poussé au tout premier push réussi derrière le libellé — jamais
              // avant (même moment qu'avant ce correctif, cf. point b) — et TOUJOURS avec
              // la valeur qui le justifie : les deux forment un tout, poussés ENSEMBLE ou
              // pas du tout (un libellé qui n'introduit rien ne doit
              // jamais apparaître).
              // Retour d'usage — EXCEPTION : un libellé identique au titre
              // réservé « Fil »/« Yarn »/« Aiguilles »/« Needles » (accents/casse
              // ignorés) est un pur doublon avec le h3 du bloc — sa recopie est omise.
              // `beforeLabel` isole le succès de la valeur de celui du libellé : sans
              // cette distinction, sauter le push du libellé ferait paraître la valeur
              // « en échec » (arr.length ne grandirait que de 1 au lieu de 2) alors
              // qu'elle a bien été poussée.
              const beforeQuality = yarnQualityCount
              const skipLabel = isReservedTitleDuplicate(bareBlock, bareBlockLabel.text)
              if (!skipLabel) push(bareBlock, bareBlockLabel.text)
              const beforeLabel = arr.length
              push(bareBlock, t)
              if (arr.length > beforeLabel) {
                bareBlockLabel.consumed = true
                bareBlockLabel = null
                line.consumed = true
                continue
              }
              // La valeur n'a pas pu être poussée juste après le libellé (plafond
              // atteint) : retirer le libellé qu'on vient d'ajouter (s'il l'a été) —
              // sinon il resterait affiché sans rien introduire — et refermer le bloc
              // sans rien consommer.
              if (arr.length > before) {
                arr.pop()
                if (bareBlock === 'yarn') yarnQualityCount = beforeQuality
              }
              bareBlock = null
              bareBlockLabel = null
            } else {
              push(bareBlock, t)
              if (arr.length > before) {
                line.consumed = true
                continue
              }
              bareBlock = null
              bareBlockLabel = null
            }
          } else {
            // Fermeture PAR CONTENU (cœur du mécanisme) : la ligne ne satisfait plus le
            // prédicat du champ ouvert → referme le bloc SANS la consommer ; elle repart
            // dans le flux normal de la section, et peut par ex. ouvrir elle-même un
            // NOUVEAU bloc nu ci-dessous (Harlow : « Aiguilles suggérées » suit directement
            // les 3 lignes de laine, sans ligne de séparation). Le libellé d'ouverture,
            // s'il n'a jamais rien routé, reste lui aussi NON consommé (point b).
            bareBlock = null
            bareBlockLabel = null
          }
        }
        // Un bloc `block` (étiquette RÉELLE, « : ») déjà ouvert a toujours priorité : ne
        // jamais ouvrir un bloc nu par-dessus (évite de voler une continuation qui
        // appartient au mécanisme existant, cf. « Fil: » ⏎ « Laine » sans section dédiée).
        if (!bareBlock && !block) {
          const bl = bareLabelFor(t)
          // `materials`/`abbr` n'ont pas d'équivalent hasYarnSec/hasNeedleSec :
          // pas de plafond de collision possible pour `materials` (bucket global non
          // plafonné, cf. push('materials', …) plus haut) ; pas de risque de doublon
          // gênant pour `abbr` non plus (addAbbr dédoublonne déjà PAR CLÉ sur tout le
          // document). Les deux branches yarn/needles restent bit-identiques.
          // PRUDENCE (revue) — `materials` N'A AUCUN prédicat de contenu (contrairement à
          // yarn/needles/abbr, qui referment sur une ligne qui ne satisfait plus leur
          // détecteur) : sous la garde `isNonWorkSection` (intro===true OU kind==='pelote'),
          // rien ne le distingue d'une VRAIE section de travail non titrée — `kind='pelote'`
          // est le repli générique de segment.js pour tout titre non reconnu, y compris un
          // chapitre du corps (« Dos », « Devant »…, vérifié empiriquement : une section
          // kind='pelote'/ref=null contenant une ligne « Matériel » avalait 2 rangs réels du
          // corps avant ce garde). `materials` est donc restreint au SEUL `sec.ref ===
          // 'echantillon'` (le cas réel Harlow), plus étroit que yarn/needles — jamais
          // `isNonWorkSection` pour ce champ précis. `tips` n'a lui non plus
          // AUCUN prédicat de contenu (une ligne de conseil peut être n'importe quelle
          // phrase) : même risque, même restriction que `materials`, même raison.
          const sectionEligible = (bl === 'materials' || bl === 'tips') ? sec.ref === 'echantillon' : (sec.ref === 'echantillon' || isNonWorkSection(sec))
          if (
            bl &&
            sectionEligible &&
            (bl === 'yarn' ? !hasYarnSec : bl === 'needles' ? !hasNeedleSec : true)
          ) {
            bareBlock = bl
            if (bl === 'materials') materialsBareCount = 0
            if (bl === 'tips') tipsBareCount = 0
            // Point b : PAS de `line.consumed = true` ici — seulement si une valeur est
            // effectivement routée derrière (cf. bareBlockLabel ci-dessus). Un libellé nu
            // jamais suivi de valeur (kodachi-ja : « Needle » seul) reste donc visible.
            bareBlockLabel = line
            continue
          }
        }
        if (block === 'measures') {
          const kv2 = /^(.{1,40}?)\s*:\s*(\S.*)$/.exec(t)
          // `consumed` SEULEMENT si pushMeasure a réellement capté une valeur — même garde
          // que la branche jumelle 'measure-row' plus haut. Sans elle, une ligne « clé : valeur »
          // que pushMeasure REFUSE (aucun vecteur de longueur n, aucune liste de n valeurs,
          // aucune mesure unique à unité) était retirée du corps sans jamais entrer dans
          // sizeTable : contenu perdu des deux côtés, en silence.
          if (kv2) { if (pushMeasure(kv2[1].trim(), kv2[2].trim())) line.consumed = true; continue }
          block = null
        } else if (block && !sec.ref) {
          // Repli Matériel quand le plafond a fait échouer le push — MÊME idiome
          // avant/après que la branche « étiquette réelle » plus haut (~l.1160). yarn et
          // needles sont les deux seuls champs plafonnés (pushYarn : 8 qualités / 16 au
          // total ; needles : 6) : au-delà, `push` retourne sans rien ajouter alors que
          // cette branche consommait la ligne inconditionnellement — un 9e fil de qualité
          // ou une 7e aiguille s'évaporait du bloc ET du corps. Les autres champs ne sont
          // pas plafonnés (arr === null) et gardent leur routage inchangé.
          const capped = block === 'yarn' ? yarns : block === 'needles' ? needles : null
          const before = capped ? capped.length : 0
          push(block, t)
          if (capped && capped.length === before) materials.push(t)
          line.consumed = true
          continue
        // Continuation de bloc gauge (« Échantillon: » nu) même sous une section
        // ref='mesures' : ce bloc n'a pas son propre routage per-ligne dédié plus bas
        // (contrairement à 'echantillon'/'fil'/'aiguilles'), donc la garde générale
        // « !sec.ref » le perdait (retour Alexia, poncho — « 10 x 10 cm = … » après
        // « Echantillon: » disparaissait). Élargissement ÉTROIT : seul block==='gauge'
        // sous ref==='mesures' — mais gardé au CONTENU (GAUGE_RE : ressemble à une
        // valeur d'échantillon), pas à la POSITION : si « Echantillon: » précède les
        // lignes de taille transposées (G4c), une ligne « S/M: … » ne doit JAMAIS être
        // avalée comme continuation gauge, quel que soit block (retour de revue — sans
        // ce garde-fou, l'ordre inverse au corpus actuel ferait disparaître sizeTable).
        } else if (
          block === 'gauge' && (sec.ref === 'mesures' || sec.ref === 'materiel') &&
          // Optimisation perf — borne AVANT GAUGE_RE (lookahead non ancré, coûteux) : réutilise
          // NEEDLE_SF_MAX_LEN, déjà la borne des chemins voisins (cf. commentaire l.420+).
          String(t).length <= NEEDLE_SF_MAX_LEN && GAUGE_RE.test(t) && !sizePrefixRe.some((re) => re.test(t))
        ) {
          push(block, t)
          line.consumed = true
          continue
        } else {
          block = null
        }
      }
    }
    // Rejoint un libellé de mesure scindé sur deux lignes PDF quand la valeur (vecteur
    // multi-tailles) est coupée en plein milieu par un retour à la ligne : ni la ligne, ni
    // la suivante, prises seules, n'ont de vecteur de longueur n, mais leur fusion (un
    // simple espace entre les deux) en a un. Gate sur le RÉSULTAT, jamais sur la forme du
    // texte : une fusion hasardeuse ne produit donc rien de plus qu'avant (pas de vecteur
    // de longueur n), jamais une valeur fabriquée — une mauvaise tentative est inerte.
    // Restreint aux sections ref==='mesures' (seul terrain vérifié) et à un lookahead
    // d'UNE ligne seulement (la suivante, non consommée) : la ligne absorbée est marquée
    // `consumed`, jamais dupliquée. Bug réel (campagne vague 6) : serenity-sweater-es-
    // f1e18764 (« Circunferencia de pecho de la prenda: 86 » + « [97:106:117:126] cm », le
    // premier chiffre de taille scindé de son groupe crocheté) et floral-breeze-dress-es-
    // 4340dc10 (les 5 lignes de MEDIDAS coupées en fin de liste virgule, ex. « …: (38), 44,
    // 50, 55, » + « 61, 66, 71, 77 cm »).
    // Garde anti-régression (mesurée sur le corpus 2026-08-27-vague{1,3,4,5,6}, cf. campagne) :
    // la ligne SUIVANTE ne doit PAS déjà porter, À ELLE SEULE, un vecteur de longueur n —
    // sinon elle est déjà complète (ex. « Bust: 58 (64) 66 … 127 cm », sweet-as-pie-dress-en)
    // et la ligne i n'est pas un fragment à réparer mais une phrase SANS RAPPORT qui la
    // précède (« El top tiene un talle ajustado y se da de sí. », elin-top-es — une PHRASE
    // D'INTRO, pas un libellé coupé) : sans cette garde, elle se retrouvait fusionnée en
    // tête du libellé de la ligne suivante, déjà correcte avant la fusion — régression
    // mesurée sur 4 patrons du corpus large (elin-top-es, selina-kimono-cardigan-es,
    // sweet-as-pie-dress-en, pink-heart-sweater…) avant l'ajout de cette garde.
    if (sec.ref === 'mesures' && n > 1) {
      for (let i = 0; i < sec.lines.length - 1; i++) {
        const line = sec.lines[i]
        if (line.consumed) continue
        const t = line.text.trim()
        if (findSizeVectors(t).some((v) => v.values.length === n)) continue
        const next = sec.lines[i + 1]
        if (!next || next.consumed) continue
        const nextText = next.text.trim()
        if (findSizeVectors(nextText).some((v) => v.values.length === n)) continue
        const merged = `${t} ${nextText}`
        if (!findSizeVectors(merged).some((v) => v.values.length === n)) continue
        line.text = merged
        next.consumed = true
      }
    }
    // Entrée technique actuellement ouverte (sous-labels) — RE-scopée à chaque
    // section : une section ref==='techniques' démarre toujours sa propre 1ʳᵉ entrée
    // (titrée par défaut avec le titre de la section, cf. branche ci-dessous), jamais
    // une continuation de la section précédente.
    let curTech = null
    for (const line of sec.lines) {
      if (line.consumed) continue
      const t = line.text
      // Défauts 1+2 — dans une section Abréviations dédiée, une ligne de laine (rappel
      // « Fil: … » ou coloris/quantité « … - 1 pelote ») n'est jamais une abréviation :
      // testée AVANT execAbbrLine (ci-dessous), qui l'aurait sinon captée à tort (clé
      // courte) ou perdue (clé trop longue pour son plafond, cf. commentaire d'
      // isYarnLabelLine/isColorwayLine). Routée verbatim vers `yarns`, comme le filet
      // `sec.ref==='fil'` (même repli « jamais perdre d'info » : si pushYarn refuse
      // (plafond atteint), la ligne repart au Matériel plutôt que de disparaître).
      if (sec.ref === 'abbr' && (isYarnLabelLine(t) || isColorwayLine(t))) {
        const before = yarns.length
        pushYarn(t)
        if (yarns.length === before) materials.push(t)
        line.consumed = true
        continue
      }
      const m = execAbbrLine(t)
      if (m) {
        // Section dédiée : tout « X = déf » / « X : déf » / « X – déf » est une abréviation.
        if (sec.ref === 'abbr') { addAbbr(m[1], m[2], t); continue }
        // Balayage global (hors section dédiée) : seule une clé courte sans espace compte.
        // Gardes anti-fragment-de-rang (venetien-shawl) : la clé doit commencer par une
        // LETTRE (« (= env… » a la clé « ( ») et la définition ne doit pas commencer par un
        // CHIFFRE (« mousse = 15 m. » = un compte de mailles, pas une abréviation) — un
        // glossaire définit un symbole par un mot, jamais par un nombre nu.
        // Defect agnes-sweater-en-4f1102bf : le « = » doit se situer en ZONE DE CLÉ
        // (adjacent à la clé capturée, marge +2 : zéro à deux espaces, formes « k1 = déf »
        // et « k1= déf »), pas N'IMPORTE OÙ dans la ligne — l'ancien test d'existence
        // /=/.test(t) laissait le « = » du TOTAL DE MAILLES d'une instruction (« Armscye:
        // Knit until … = 54 (54) 54 (54) sts. », séparateur « : ») cocher la garde à
        // distance : l'instruction quittait sa section de travail pour le glossaire
        // (« Neck: … = 13 (14) » idem, ligne coupée en deux). eqAt === -1 (aucun « = »,
        // ex. tiret seul « k1 – knit one ») reste hors balayage global, comme avant.
        const eqAt = t.trim().indexOf('=')
        if (
          !sec.ref && m[1].trim().length <= 8 && !/\s/.test(m[1].trim()) &&
          eqAt !== -1 && eqAt <= m[1].trim().length + 2 &&
          /^\p{L}/u.test(m[1].trim()) && !looksLikeBareCountDef(m[2])
        ) { addAbbr(m[1], m[2], t); line.consumed = true; continue }
      } else if (sec.ref === 'abbr' && execNotationLegendLine(t)) {
        // Légende de notation (« [ ] indique que… », cf. commentaire d'execNotationLegendLine
        // ci-dessus) : une vraie entrée de glossaire, juste sans séparateur ni ponctuation
        // finale — reste DANS la table, à côté des vraies abréviations (jamais en note isolée
        // en tête de document : la légende n'a de sens que lue à côté des symboles qu'elle
        // explique).
        const lg = execNotationLegendLine(t)
        addAbbr(lg[1], lg[2], t)
        line.consumed = true
        continue
      } else if (sec.ref === 'abbr' && formRejectedAbbrLine(t)) {
        // Rejetée du glossaire par le garde de forme (déf trop longue/« : ») : la section
        // abbr entière est écartée du travail en aval (assemble.js), donc cette ligne
        // disparaîtrait silencieusement si on ne la routait pas explicitement en note.
        notes.push(t)
        line.consumed = true
        continue
      } else if (sec.ref === 'abbr' && looksLikeSetupProseLine(t)) {
        // Phrase de prose de mise en route SANS clé/déf ni tiret (retour Alexia, poncho) :
        // ni execAbbrLine ni formRejectedAbbrLine ne la routent (aucune des deux n'exige
        // une structure clé/déf), donc elle disparaissait silencieusement.
        notes.push(t)
        line.consumed = true
        continue
      } else if (sec.ref === 'abbr' && NOTATION_LEGEND_KEY_RE.test(String(t).trim())) {
        // Bug 2 (trou structurel), RESSERRÉ (revue : le filet d'origine attrapait TOUTE
        // ligne de la section abbr qu'aucun des trois filets ci-dessus n'avait reconnue —
        // notamment un fragment court nu (« env. 33 cm »), un rang numéroté nu (« 12.
        // Tricoter 6 mailles endroit », déjà exclu de looksLikeSetupProseLine via
        // BARE_ITEM_LINE_RE) ou la queue orpheline d'une définition repliée par reflow SANS
        // ponctuation finale (« Maschen am Ende der Runde », penny-the-panda) — trois cas
        // qui ont chacun une AUTRE destination légitime (un rang doit rester cochable, pas
        // devenir une note ; un fragment/orphelin doit rester silencieusement absent, comme
        // avant ce correctif, cf. SENTENCE_END_RE en commentaire plus haut).
        // Le SEUL trou réel documenté est structurellement plus étroit : une clé
        // de notation VIDE (« [ ] »/« { } », NOTATION_LEGEND_KEY_RE déjà utilisée par
        // execNotationLegendLine ci-dessus) suivie de TEXTE, mais dont le verbe n'est pas
        // dans NOTATION_LEGEND_VERB_RE (« voir le diagramme page 3 » plutôt que « indique
        // que… »). Une clé qui EST littéralement une paire de crochets/accolades vide ne
        // peut jamais être une vraie abréviation lexicale ni un rang/fragment de corps — la
        // capturer verbatim en note ne risque donc pas de faire disparaître un rang cochable
        // ni de fabriquer une fausse note à partir d'un fragment nu. Élargit
        // execNotationLegendLine (même clé) au lieu de dupliquer une liste de verbes.
        notes.push(t)
        line.consumed = true
        continue
      }
      // 1. Routage verbatim des sections dédiées.
      if (sec.ref === 'echantillon') { gaugeLines.push(t); continue }
      // Deuxième passe (revue) — jamais perdre d'info : `pushYarn` est
      // plafonné (16 au total, 8 lignes de qualité, cf. yarnQualityCount) et retourne SANS
      // rien pousser une fois le plafond atteint. Contrairement à `aiguilles`/`materiel`
      // ci-dessous (repli déjà en place, commit 2b7d086), cette branche `fil` dédiée n'avait
      // aucun repli : l'excédent disparaissait purement et simplement, ni dans Fil ni dans
      // Matériel ni nulle part. Même mécanisme que les branches sœurs : si `pushYarn` n'a
      // rien ajouté (la longueur n'a pas bougé), la ligne retombe au Matériel.
      if (sec.ref === 'fil') {
        const before = yarns.length
        pushYarn(t)
        if (yarns.length === before) materials.push(t)
        continue
      }
      if (sec.ref === 'aiguilles') {
        // Dans un bloc FERRI/AIGUILLES, les accessoires (aiguille à laine, arrête-
        // mailles…) listés à la suite vont au matériel, pas aux aiguilles.
        // Filet mots-outils UNIQUEMENT — pas de « mm » nu : une mesure en mm ne signe pas
        // une aiguille (babyfryd : anneau bois 45 mm, hochet 63 mm, yeux 6 mm sont du
        // MATÉRIEL). Les vrais outils portent leur nom (crochet/aiguille/naald…) déjà couvert.
        // Gate corpus (scallops-rectangular-placemat-de) — « n[åa]l » (scandinave « nål »)
        // n'était PAS ancré : collision de sous-chaîne avec l'anglais « optio-nal » dans
        // « Maschenmarkierer (optional) » (marqueur de mailles, un accessoire) → classé à
        // tort Aiguilles au lieu de Matériel. Ancré `\bn[åa]l\b` des deux côtés (seul geste
        // possible : « optio-nal » et « Stopp-e-nål »/« Virk-nål » ont la même absence de
        // frontière AVANT le « n », donc un ancrage asymétrique laisserait passer l'un ou
        // l'autre). Un vrai spec d'outil (« Virknål 4 mm », « Hæklenål 2,5 mm ») garde
        // toujours sa mesure mm accolée → reste capté par NEEDLE_RE (alternative n[åa]l NON
        // touchée ici, cf. ligne ~239), vérifié sur les 338 PDF da/no/sv du corpus : AUCUN
        // spec d'outil réel n'a changé de classement. EFFET DE BORD ATTENDU ET VOULU, mesuré
        // sur 65/338 PDF : les aiguilles à laine/accessoires composés SANS mesure
        // (« Stoppenål », « Garnnål », « Ullnål », « Stramajnål », « Synål »…) basculent
        // Aiguilles→Matériel — même famille que « aiguille à laine »/« Garnnadel » déjà
        // documentée ci-dessus (lignes 560-561), aucune perte de texte, juste une
        // reclassification conforme à la règle déjà en place pour les autres langues.
        // AJOUT EN REVUE (découvert et mesuré) : ce filet de secours
        // ad hoc n'avait pas le mot ANGLAIS « needle(s) », ni stickor/pinde/ganchillo/
        // uncinetto/szydełko — tous déjà présents dans NEEDLE_RE (ligne ~253), simplement
        // pas repris ici. NEEDLE_RE seul ne suffit pas : il exige une taille APRÈS le
        // mot-outil, or Juice_Sweater_by_Kutovakika/Stay_Toasty_Scarf_By_Kutovakika (corpus
        // réel, sections titrées NEEDLES) portent la taille AVANT (« 4.5 mm / US7: circular
        // needles… »), donc NEEDLE_RE ne matche pas et ce filet ad hoc, incomplet pour
        // l'anglais, était le seul recours.
        // Premier correctif (revue, mesure sur 3187 PDF) : une première version
        // avait ajouté ces 6 mots SANS condition, comme les mots historiques de cette même
        // liste — la mesure a montré que l'effet de bord pressenti (non mesuré à l'époque)
        // DOMINAIT le gain : 73 blocs Aiguilles du corpus web ont changé de CONTENU, et la
        // quasi-totalité sont des accessoires (« Tapestry needle » ×11, « Darning needle »
        // ×6, « Yarn needle » ×4, « Cable needle »…) ou de la PROSE entière happée par la
        // seule présence du mot (« The needle size is only a guide… », « TIP PARA TRABAJAR A
        // GANCHILLO… », explication de 450 caractères sur la maille double dans
        // Juice_Sweater/Stay_Toasty). Les vrais gains, eux, portent TOUS une taille
        // (« Size 4 mm / US 6 circular needle… », « Uncinetto DROPS n° 3,5 », « Ganchillos de
        // 3 y 4 mm »). Correctif : ces 6 mots ne comptent plus que si la ligne porte aussi
        // une vraie taille d'outil, testée n'importe où dans la ligne (pas de contrainte de
        // position/distance, contrairement à NEEDLE_RE) via NEEDLE_SF_SIZE_RE (réutilisation
        // de NEEDLE_SF_SIZE, ligne ~311 — pas de nouveau motif écrit). Les mots HISTORIQUES
        // de la liste (crochet/hook/nadel/n[åa]l/aiguille/aguja/ferri/puikot/naald/druty)
        // gardent leur comportement actuel SANS condition de taille — chemin existant
        // bit-identique, règle centrale du plan. `n[åa]l` reste \b des deux côtés (ancrage
        // NON défait).
        // M4 — isBareSizeLine(t) (définie plus haut) : une valeur nue de taille
        // (« n° 3,5 et 4 », « 3.5 mm & 4 mm », « nr. 3,5 en 4 » — Gilet manches 3-4
        // Madelaine, corpus réel trilingue) n'a pas de mot-outil du tout (le TITRE de la
        // section en tient déjà lieu) ; voie ADDITIVE, testée seulement si les autres
        // échouent.
        // Deuxième passe — hasUnqualifiedGatedNeedleWord(t) (définie ligne ~318) remplace le
        // test de présence brut : une occurrence des mots ajoutés (needle(s)/stickor/pinde/
        // ganchillo/uncinetto/szydełko) ne compte que si elle N'EST PAS une aiguille
        // qualifiée d'accessoire (tapestry/darning/yarn/wool/embroidery/sewing/cable/blunt).
        // `NEEDLE_REDOS_MAX_LEN` ici AUSSI : c'est le second (et dernier) site qui lance
        // NEEDLE_RE, et une garde posée sur un seul des deux ne protège rien. Les trois
        // autres alternatives sont linéaires (alternance simple, sans `.*`) et restent nues.
        if (
          (String(t).length <= NEEDLE_REDOS_MAX_LEN && NEEDLE_RE.test(t)) ||
          /crochet|hook|nadel|\bn[åa]l\b|aiguille|aguja|ferri|puikot|naald|druty/i.test(t) ||
          (hasUnqualifiedGatedNeedleWord(t) && NEEDLE_SF_SIZE_RE.test(t)) ||
          isBareSizeLine(t)
        ) {
          // Revue (chantier « récupération blocs Fil/Aiguilles ») —
          // jamais perdre d'info : une ligne classée aiguille qui arrive une fois le
          // plafond de 6 atteint ne doit pas disparaître sans laisser de trace ; elle
          // retombe au Matériel (mesuré sur le corpus : 28 lignes perdues sur 12
          // patrons par ce même motif, avant ce correctif).
          if (needles.length < 6) needles.push(t)
          else materials.push(t)
        } else materials.push(t)
        continue
      }
      if (sec.ref === 'materiel') {
        // Le fil et les aiguilles listés dans un bloc matériel vont à leur champ.
        // Une quantité de pelotes suffit à signer du fil, même sans nom de fibre.
        // Optimisation perf — borne AVANT isYarnLine (YARN_RE, lookahead non ancré, coûteux) :
        // réutilise NEEDLE_SF_MAX_LEN. Le second filet (quantité de pelotes) reste sans
        // borne : alternation simple, sans lookahead, coût linéaire.
        // Même repli que la branche `fil` : au plafond de `pushYarn`, la ligne retombe au Matériel.
        if ((String(t).length <= NEEDLE_SF_MAX_LEN && isYarnLine(t)) || /\d\s*(?:pelotes?|skeins?|balls?|kn[äa]uel|n[øo]gler?|nystan|ker[äa][äa]?|ovillos?|gomitoli|bollen|motk[iów]+)\b/i.test(t)) {
          const before = yarns.length
          pushYarn(t)
          if (yarns.length === before) materials.push(t)
          continue
        }
        // Même garde « jamais perdre d'info » qu'au bloc ci-dessus : le plafond
        // d'aiguilles ne doit jamais faire disparaître une ligne, seulement la
        // reclasser au Matériel.
        if (isNeedleLine(t)) { if (needles.length < 6) needles.push(t); else materials.push(t); continue }
        materials.push(t)
        continue
      }
      if (sec.ref === 'techniques') {
        // Découpe en entrées {title, body} : un sous-label (clé courte suivie de
        // « : texte » sur la même ligne, TECH_LABEL_RE — « M1R : Piquer… », Barley
        // Field) OUVRE une nouvelle entrée ; une ligne ENTIÈRE en gras, courte, sans
        // ponctuation de fin de phrase (façon isTitleLine) en ouvre une aussi. Le
        // texte qui suit s'accumule dans le body de l'entrée ouverte, jusqu'au
        // sous-label suivant ou la fin de la section.
        const lab = TECH_LABEL_RE.exec(t)
        // Garde anti-rang (melting-pot-shawl-en) : un libellé qui DÉMARRE par un marqueur
        // de rang (« Row 1 (RS) », « Rows 6 to 8 » — suffixe « (RS) » etc., c'est pourquoi
        // ROW_MARKER_KEY_RE, qui exige la clé ENTIÈRE égale, ne suffit pas) n'est pas un
        // nom de technique : c'est un rang du corps du patron passé par là. Réutilise
        // ROW_START_RE (segment.js, ancré en TÊTE sans ancre de fin = test préfixe) au
        // lieu d'écrire un nouveau motif. La ligne ENTIÈRE rejoint alors le body de
        // l'entrée courante — jamais perdue, jamais promue en faux « ### Row N ».
        const rowLab = lab && ROW_START_RE.test(lab[1])
        const boldLabel = !lab && line.bold && t.length <= 40 && !SENTENCE_END_RE.test(t)
        if (lab && !rowLab) {
          curTech = { title: lab[1].trim(), body: lab[2].trim() }
          techniques.push(curTech)
        } else if (boldLabel) {
          curTech = { title: t.trim(), body: '' }
          techniques.push(curTech)
        } else if (curTech) {
          curTech.body = curTech.body ? `${curTech.body}\n${t}` : t
        } else {
          // Aucun sous-label encore vu : soit la section n'en a AUCUN (elle devient
          // alors cette unique entrée, titrée par la section — règle « pas de
          // sous-structure interne »), soit c'est de la prose de tête AVANT le 1er
          // sous-label (elle reste ainsi visible, jamais perdue, cf. Barley Field).
          curTech = { title: sec.title, body: t }
          techniques.push(curTech)
        }
        continue
      }
      if (sec.ref === 'mesures') {
        // Une ligne « mesures » peut porter PLUSIEURS vecteurs de longueur n,
        // pas un seul : « Sizes 1 (2, 3, 4, 5) (6, 7, 8, 9) 10, 11 are intended to fit an
        // approximate actual bust circumference of 75 (80, 85, 90, 95) (100, 110, 120, 130)
        // 140, 150 cm. » (Mia Cardigan, une fois recollée par reflow.js) porte le vecteur des
        // NUMÉROS de taille (1..11) PUIS le vecteur de mesure (75..150 cm) qui alimente
        // sizeSub plus bas. L'ancien code ne gardait que `vecs.find(...)`, le PREMIER vecteur
        // trouvé, et faisait `continue` : le second (la vraie mesure) était perdu en silence,
        // avec lui la seule phrase de sous-tailles du patron. `applySizeVectors` (sizes.js,
        // utilisé par steps.js) traite déjà plusieurs vecteurs par ligne comme un cas normal —
        // même lecture ici, un par un, dans l'ordre, chacun étiqueté par le texte qui le
        // précède depuis la fin du vecteur précédent.
        const rawVecs = findSizeVectors(t)
        const vecs = rawVecs.filter((x) => x.values.length === n)
        if (vecs.length) {
          let last = 0
          let pushed = false
          let usedPending = false
          for (const v of vecs) {
            let label = t.slice(last, v.start).replace(/[\s:]+$/, '').trim()
            // Libellé porté par la ligne PRÉCÉDENTE (PDF réel Mia Cardigan :
            // « Bust circumference of finished garment: » puis, ligne suivante, les 11
            // valeurs SEULES, sans aucun libellé sur cette même ligne). Ne s'applique
            // qu'au PREMIER vecteur de la ligne (last === 0) : un second vecteur sur la
            // même ligne (ci-dessus) porte toujours son propre libellé intercalé,
            // jamais celui de la ligne d'avant.
            if (!label && last === 0 && pendingMeasureLabel) { label = pendingMeasureLabel; usedPending = true }
            if (label) { sizeTable.push({ label, values: v.values }); pushed = true }
            last = v.end
          }
          if (usedPending) { pendingMeasureLabel = ''; pendingMeasureRaw = '' } else dropPendingMeasure()
          if (pushed) continue
        }
        // Ligne à VALEUR UNIQUE, identique pour toutes les tailles
        // (« Recommended length of finished sleeve: » -> « 47 cm (measured from underarm
        // cast-on edge) », PDF réel Mia Cardigan : la longueur de manche recommandée ne
        // varie pas selon la taille, une seule valeur suffit, jamais de vecteur groupé).
        // N'entre ici que si un libellé EST en attente (ligne précédente sans chiffre ni
        // vecteur, cf. plus bas) ET qu'aucun vecteur groupé n'existe DU TOUT sur cette
        // ligne (`rawVecs`, non filtré par n — un vecteur de MAUVAISE longueur reste géré
        // par la suite inchangée, jamais réinterprété ici). La valeur est répétée sur les
        // n colonnes : jamais fabriquée, le chiffre vient bien du PDF, seule sa
        // répétition (le patron le dit implicitement identique pour toutes les tailles)
        // est ajoutée.
        // Resserré (régression mesurée sur le corpus, ash-knit-wrist-warmers-de) : une
        // ligne d'ÉCHANTILLON (« Musterprobe » puis « 28 masker på 10 cm », 2 chiffres —
        // un TAUX points/cm, pas une mesure) matchait ce filet à tort, une fausse ligne
        // « Musterprobe | 28 | 28 » apparaissait dans le tableau des tailles. Une vraie
        // mesure unique du PDF réel (« 47 cm (measured from underarm cast-on edge) ») ne
        // porte JAMAIS de second chiffre après le premier — un taux/ratio, si. On exige
        // donc l'ABSENCE de tout second chiffre dans le reste de la ligne.
        // Resserré une seconde fois (régression mesurée sur le corpus,
        // lavender-field-skirt-fr-54807b3d) : un décompte de brides (« 132 br »,
        // « 126 br »…) n'a lui aussi qu'un seul chiffre — mais « br » n'est pas une unité
        // de longueur. On exige en plus une VRAIE unité (cm/mm/in/po) immédiatement après
        // le nombre, même liste que le garde jumeau segment.js (BARE_SINGLE_MEASURE_RE) —
        // ni « m » ni « g », trop ambigus (« m » = mètre OU maille en français).
        if (!rawVecs.length && pendingMeasureLabel && n > 1) {
          const single = /^(\d+(?:[.,]\d+)?)\s*(?:cm|mm|in\b|inch(?:es)?\b|po\b)/i.exec(t)
          if (single && !/\d/.test(t.slice(single[0].length))) {
            sizeTable.push({ label: pendingMeasureLabel, values: Array(n).fill(single[1]) })
            pendingMeasureLabel = ''
            pendingMeasureRaw = ''
            continue
          }
        }
        // Ligne SANS chiffre et sans vecteur : c'est un libellé qui annonce la
        // ligne suivante (même PDF, mêmes 5 libellés). Mémorisé, jamais émis tel quel.
        // Restreint à n > 1 : à n === 1, une ligne sans chiffre ni vecteur est déjà prise
        // en charge par G4e ci-dessous (« Onesize », « Taille unique »…, vocabulaire
        // multilingue dédié) — sans cette borne, ce filet l'interceptait AVANT G4e et la
        // mesure taille unique disparaissait (régression mesurée : 3 témoins G4e existants
        // viraient au rouge).
        if (!rawVecs.length && !/\d/.test(t) && n > 1) {
          dropPendingMeasure()
          pendingMeasureLabel = t.replace(/[\s:]+$/, '').trim()
          pendingMeasureRaw = t
          continue
        }
        dropPendingMeasure()
        const kv3 = /^(.{2,40}?)\s*:\s*(\S.*)$/.exec(t)
        if (kv3 && n === 1) { sizeTable.push({ label: kv3[1].trim(), values: [kv3[2].trim()] }); continue }
        // G4b : fallback « label + exactement n nombres séparés par des ESPACES »
        // (jumeau du fallback virgules, cf. lignes 60-64). Les nombres nus à espaces
        // (« Tour de poitrine 80 84 88 … ») n'ouvrent aucun vecteur → sinon ligne jetée.
        // Conditions STRICTES : n > 1, trailing = exactement n nombres, pour ne pas
        // aspirer une instruction chiffrée (« Monter 90 100 110 mailles »).
        if (n > 1) {
          const mSp = G4B_LABEL_NUMS_RE.exec(t.replace(/\s*cm\s*$/i, ''))
          if (mSp) {
            const values = mSp[2].split(/\s+/)
            if (values.length === n) { sizeTable.push({ label: mSp[1].trim(), values }); continue }
          }
        }
        // G4b2 — variante virgule de G4b : « label: (v1), v2, v3, …, vN [cm] »
        // (floral-breeze-dress-es-4340dc10, campagne vague 6 : « Ancho, a través de los
        // cuadrados: (38), 44, 50, 55, 61, 66, 71, 77 cm »). Notation Hobbii ES : la 1re
        // valeur entre parenthèses (même convention que VEC_GROUP de sizes.js — la plus
        // petite taille), suivie d'une LISTE à virgules SANS second groupe — forme que
        // findSizeVectors (VEC_RE) ne couvre PAS (VEC_RE exige un groupe APRÈS la 1re
        // valeur libre, jamais une simple liste à virgules en tête). Fallback local à CE
        // fichier, jamais dans sizes.js/findSizeVectors (grammaire partagée avec le texte
        // des rangs, hors scope de cette campagne — cf. consigne de prudence) : n'agit que
        // sur une ligne « label: … » à EXACTEMENT n valeurs, chacune un nombre nu
        // optionnellement parenthésé — gate sur le RÉSULTAT (n exact), jamais de vecteur
        // fabriqué en cas de désaccord.
        if (n > 1) {
          const kvComma = /^(.{2,60}?)\s*:\s*(\S.*)$/.exec(t)
          if (kvComma) {
            const rest = kvComma[2].replace(/\s*cm\s*$/i, '')
            const parts = rest.split(/\s*,\s*/).map((p) => p.trim()).filter(Boolean)
            if (parts.length === n && parts.every((p) => /^\(?\d+(?:[.,]\d+)?\)?$/.test(p))) {
              sizeTable.push({ label: kvComma[1].trim(), values: parts.map((p) => p.replace(/[()]/g, '')) })
              continue
            }
            // G4b3 — variante « valeur UNIQUE » de G4b2 : « label: NUM unit … » quand n>1
            // mais une seule mesure vaut pour toutes les tailles (« Longitud de la manga:
            // 22 cm o longitud preferida », même patron/campagne que G4b2 ci-dessus — le
            // libellé composé « Longitud de la manga » n'est reconnu par AUCUNE des
            // étiquettes measure-row de labelFor, donc jamais poussé par pushMeasure en
            // amont). Même garde stricte que le mécanisme jumeau de pushMeasure (plus haut
            // dans ce fichier) et du mécanisme plus bas : une vraie unité de longueur
            // immédiatement après le nombre, aucun second chiffre ensuite dans le reste.
            const single = /^(\d+(?:[.,]\d+)?)\s*(?:cm|mm|in\b|inch(?:es)?\b|po\b)/i.exec(kvComma[2])
            if (single && !/\d/.test(kvComma[2].slice(single[0].length))) {
              sizeTable.push({ label: kvComma[1].trim(), values: Array(n).fill(single[1]) })
              continue
            }
          }
        }
        // G4c : prose par taille transposée (cf. commentaire au-dessus d'extractReference).
        if (n > 1 && sizePrefixRe.length) {
          const idx = sizePrefixRe.findIndex((re) => re.test(t))
          if (idx !== -1) {
            const rest = t.replace(sizePrefixRe[idx], '').trim()
            const sentences = rest.split(SENTENCE_SPLIT_RE).map((s) => s.trim()).filter(Boolean)
            let matchedAny = false
            for (const sentence of sentences) {
              const sm = SUBMEASURE_VALUE_RE.exec(sentence)
              if (!sm) continue
              matchedAny = true
              const label = sm[1].trim()
              const value = sm[2].trim()
              const key = label.toLowerCase()
              if (proseSizeIndex.has(key)) {
                sizeTable[proseSizeIndex.get(key)].values[idx] = value
              } else {
                const values = Array.from({ length: n }).fill('')
                values[idx] = value
                proseSizeIndex.set(key, sizeTable.length)
                sizeTable.push({ label, values })
              }
            }
            if (matchedAny) continue
          }
        }
        // G4d — mesure UNIQUE en PROSE, sans « : » ni vecteur multi-tailles (« 25 cm de
        // large x 8 cm de profondeur » sous le TITRE « TAILLE », patron mono-taille) :
        // aucune branche ci-dessus ne la capte (findSizeVectors n'y voit aucun vecteur
        // MULTI-tailles ; kv3 exige un « : » absent) → la seule mesure du patron
        // disparaissait sans trace (Phoebe - Sac + 3 langues du gate). Filet de dernier
        // recours, n===1 UNIQUEMENT, la ligne doit porter un CHIFFRE (garde anti faux
        // positif). Repère de diagramme isolé en tête (« A Breedte* 100 cm ») retiré ;
        // libellé pris via SUBMEASURE_VALUE_RE (« env. » rattaché à la valeur) ou, à
        // défaut de libellé dans la ligne, le TITRE de la section.
        if (n === 1 && /\d/.test(t)) {
          const s = t.replace(/^\s*[A-Z]\s+(?=\S)/, '')
          if (/^\d/.test(s)) {
            sizeTable.push({ label: sec.title, values: [s] })
          } else {
            const sm = SUBMEASURE_VALUE_RE.exec(s)
            if (sm) sizeTable.push({ label: sm[1].trim(), values: [sm[2].trim()] })
            else sizeTable.push({ label: sec.title, values: [s] })
          }
          continue
        }
        // G4e — filet SIBLING de G4d (cf. commentaire au-dessus), ne relâche PAS sa garde
        // `/\d/` : ne se déclenche QUE si G4d (et toute autre branche de cette section) n'a
        // RIEN poussé pour CETTE section précise (sizeTableStartLen, déclaré en tête de
        // boucle sec) — une section mesures avec de vraies valeurs numériques garde son
        // comportement existant intact.
        if (n === 1 && sizeTable.length === sizeTableStartLen && ONE_SIZE_RE.test(foldEszett(t.trim()))) {
          sizeTable.push({ label: sec.title, values: [t.trim()] })
          continue
        }
        // Bug 2 (retour banc, mountaintop-pullover-es, vague 2) — filet de sécurité : aucune
        // branche ci-dessus n'a reconnu cette ligne comme une mesure. Sur ce PDF, un sous-
        // titre de taille (« Talla infantil »/« Tallas adultas ») route à tort toute la
        // construction du canesú raglan vers une section ref==='mesures' (bug de
        // classification hors périmètre ici, cf. segment.js) : sans ce filet, chaque rang de
        // façonnage — pas une mesure — disparaissait en silence (1018 mots perdus, aucune
        // trace nulle part). Même raisonnement que formRejectedAbbrLine/
        // looksLikeSetupProseLine (section abbr, plus bas) : la section ref==='mesures'
        // entière est écartée du travail en aval (assemble.js), donc toute ligne non poussée
        // dans sizeTable ici disparaîtrait sans laisser de trace si on ne la routait pas
        // explicitement en note (verbatim, jamais recomposée — cf. l'en-tête de ce fichier).
        // LIMITE ASSUMÉE (hors périmètre de ce fichier) : `notes` est une liste PLATE
        // (consolidateIntro, assemble.js) qui atterrit dans la Présentation en tête de
        // document, pas juste à côté de la section mesures d'où la ligne vient — la
        // rattacher structurellement à sa section demanderait de faire porter cette
        // information par `notes` jusqu'à assemble.js, hors des deux fichiers autorisés ici.
        notes.push(t)
        line.consumed = true
        continue
      }
      // 3. Filet global (aucune section dédiée trouvée) : seulement si la section
      // dédiée correspondante est absente (garde A), que la section courante n'est pas
      // une vraie section de travail titrée (garde B), et — sur une intro reflowée en
      // paragraphe — que la ligne est une spec isolée, pas un fragment noyé dans la
      // prose (garde C, cf. isIsolatedScavengeLine ci-dessus).
      if (isNonWorkSection(sec)) {
        // Optimisation perf — borne AVANT GAUGE_RE et isYarnLine (lookaheads non ancrés,
        // coûteux), aux deux filets ci-dessous : réutilise NEEDLE_SF_MAX_LEN. C'est ici,
        // sur ce filet de secours SANS section dédiée, qu'une intro reflowée en un seul
        // paragraphe (des dizaines de milliers de caractères) atteignait ces deux
        // expressions sans aucune borne — mesuré ~18,5 s sur un cas réel du corpus.
        if (!hasGaugeSec && !gaugeLines.length && !gauge && String(t).length <= NEEDLE_SF_MAX_LEN && GAUGE_RE.test(t) && isIsolatedScavengeLine(sec, t)) { gauge = t; line.consumed = true; continue }
        if (!hasNeedleSec && needles.length < 3 && isNeedleSpecForScavenge(t) && isIsolatedScavengeLine(sec, t)) { needles.push(t); line.consumed = true; continue }
        if (!hasYarnSec && yarns.length < 4 && String(t).length <= NEEDLE_SF_MAX_LEN && isYarnLine(t) && isIsolatedScavengeLine(sec, t)) { yarns.push(t); line.consumed = true; continue }
        // M1 — branche FRAGMENT, ADDITIVE, APRÈS les trois branches ci-dessus
        // (inchangées). Ne joue QUE sur les lignes multi-phrases (SENTENCE_SPLIT_RE), dans
        // TOUTE section non-travail (isNonWorkSection : intro===true OU kind==='pelote') —
        // PAS seulement les sections où la garde C (isIsolatedScavengeLine) bloque
        // effectivement les trois branches précédentes (elle ne bloque QUE si
        // sec.intro===true, cf. sa définition). Une ligne multi-phrases d'une section
        // kind='pelote' non-intro qui n'a satisfait aucune des trois branches ci-dessus
        // (prédicat non rempli, PAS bloquée par la garde C) retombe elle aussi ici,
        // légitimement : le filet fragment est un filet de secours généraliste sur les
        // lignes multi-phrases, la garde C n'étant qu'UN des cas qui l'amènent à s'y
        // déclencher (correction de formulation en revue — le comportement lui-
        // même est inchangé et voulu). Découpe en PHRASES (courtes) et applique les MÊMES
        // prédicats que le filet existant, jamais au paragraphe entier (coût quadratique de
        // GAUGE_RE ET de YARN_RE — même forme `(?=.*A)(?=.*B)`, cf. borne ci-dessous). Ne
        // consomme JAMAIS la ligne (le paragraphe reste intact à sa place ; le fragment est
        // RECOPIÉ, pas déplacé) — condition de sûreté du mécanisme.
        if (SENTENCE_SPLIT_RE.test(t)) {
          const sentences = t.split(SENTENCE_SPLIT_RE).map((s) => s.trim()).filter(Boolean)
          for (const sentence of sentences) {
            // Premier correctif (revue, mesure sur 3187 PDF) : la borne
            // NEEDLE_SF_MAX_LEN doit s'appliquer à TOUTE phrase candidate, AVANT TOUT
            // prédicat — pas seulement avant GAUGE_RE (version précédente). isYarnLine
            // (YARN_RE) a EXACTEMENT la même forme `(?=.*A)(?=.*B)` que GAUGE_RE (deux
            // lookaheads non ancrés, coût quadratique) : sans cette borne ICI, une intro
            // mal reflowée SANS AUCUN « point + majuscule » (donc SENTENCE_SPLIT_RE ne
            // coupe rien nulle part → la « phrase » unique = le paragraphe entier) ouvrait
            // un chemin d'appel NEUF vers YARN_RE sur une chaîne non bornée — mesuré
            // 29 934 ms à 96 000 caractères (112 ms à 6 000, 1 786 ms à 24 000). Une vraie
            // phrase candidate est courte (172 car. mesurés au maximum sur tout le corpus,
            // cf. commentaire NEEDLE_SF_MAX_LEN plus haut) ; au-delà, ce n'est
            // structurellement plus une spec exploitable — on ne prend aucun risque.
            if (sentence.length > NEEDLE_SF_MAX_LEN) continue
            // Exclusion échantillon OBLIGATOIRE : une phrase reconnue GAUGE_RE
            // (assimilation de deux grandeurs, « 20 Maschen auf 10 cm ») n'alimente JAMAIS
            // needles/yarns, même si elle satisfait par ailleurs isNeedleSpecForScavenge
            // (qui mentionne aussi une taille d'aiguille).
            if (GAUGE_RE.test(sentence)) continue
            // Premier correctif, point b (revue, vol d'instruction mesuré) : la garde
            // A (INSTRUCTION_LEAD_RE, incluse dans isNeedleSpecForScavenge) ne protège QUE
            // les phrases qui COMMENCENT par « avec/with/mit… » — une vraie consigne à
            // structure verbe-en-tête (« Montez 40 mailles avec les aiguilles 4 mm… »)
            // passait entière, exactement ce que la garde C empêchait avant ce mécanisme.
            // hasActionableVerb (actionable-prose.js) réutilise le vocabulaire FERMÉ déjà
            // mesuré sur 160 PDF réels FR/EN/ES/DE pour le même risque (repli pelote verbes
            // d'action) : rejette toute phrase contenant un verbe de construction, où qu'il
            // soit dans la phrase, pas seulement en tête.
            if (hasActionableVerb(sentence)) continue
            if (!hasNeedleSec && needleFragments.length < 3 && isNeedleSpecForScavenge(sentence)) {
              needleFragments.push(sentence)
            }
            // Premier correctif, point c (revue, bruit mesuré cool-90-s-s-overlay-
            // mosaic-crochet-panel-en) : pour un FRAGMENT SEUL (jamais pour une ligne
            // entière — chemin existant bit-identique, cf. isYarnLine plus haut, inchangée),
            // exiger un CHIFFRE dans la phrase. YARN_RE peut être satisfaite par un simple
            // couple mot-fibre/mot-métrage SANS AUCUNE quantité chiffrée (« This does take
            // extra yarn, so the yardage estimates listed in this pattern would not be
            // enough. ») — jamais une vraie spec de fil utile en aide-mémoire.
            if (!hasYarnSec && yarnFragments.length < 4 && /\d/.test(sentence) && isYarnLine(sentence)) {
              yarnFragments.push(sentence)
            }
          }
        }
      }
    }
    dropPendingMeasure()
  }

  // M1 — fusion de la réserve fragment, en tout dernier, SEULEMENT si le champ
  // est resté vide (priorité absolue à toute ligne entière rencontrée n'importe où dans
  // le document — avant ou après l'intro, cf. les branches ci-dessus ET les sections
  // dédiées ailleurs dans la boucle, toutes déjà closes à ce stade). Plafonds déjà
  // appliqués à la collecte (needleFragments < 3, yarnFragments < 4, mêmes bornes que
  // leurs branches sœurs du filet ci-dessus) ; `push`/`pushYarn` réappliquent en plus les
  // plafonds normaux du champ (6 aiguilles / 8-16 fils) par cohérence avec tous les
  // autres points d'entrée de ces champs.
  if (!needles.length) for (const f of needleFragments) push('needles', f)
  if (!yarns.length) for (const f of yarnFragments) pushYarn(f)

  // Notation papier des tailles : les blocs Échantillon/Aiguilles/Fil/Matériel
  // restent des chaînes verbatim, jamais passées par applySizeVectors (steps.js) — sans
  // ceci, un vecteur groupé par le PDF (« 300 (300, 350, 350, 350) … ») restait illisible
  // par taille dans l'app. sizeTable et abbr n'y passent jamais : sizeTable est déjà par
  // colonne, les abréviations ne sont pas des tailles.
  const reference = buildReference({
    abbr,
    gauge: toPaperNotation(gaugeLines.length ? gaugeLines.join('\n') : gauge, n),
    needles: toPaperNotation(needles.join('\n'), n),
    yarn: toPaperNotation(yarns.join('\n'), n),
    materials: materials.map((m) => toPaperNotation(m, n)),
    tips,
    techniques,
    sizeTable,
  })
  // Sous-tailles (front-matter) : la première mesure « circonférence/tour de … »
  // du tableau des tailles sert de mesure de référence par taille.
  const SUB_RE = /circonf[ée]rence|tour de\b|circumference|umfang|omkreds|omkrets|omtrek|contorno|circonferenza|obw[óo]d|ymp[äa]rys|bust|chest|poitrine|brust/i
  const sub = sizeTable.find((r) => SUB_RE.test(r.label) && r.values.length > 1)
  const sizeSub = sub
    ? { values: sub.values, label: sub.label.charAt(0).toLowerCase() + sub.label.slice(1) }
    : null
  return { reference, sizeSub, stats: { abbrCount: abbr.length }, notes }
}

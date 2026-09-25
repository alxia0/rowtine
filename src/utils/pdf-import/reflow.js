// Recolle les lignes visuelles du PDF en lignes logiques : une instruction coupée
// par la largeur de colonne redevient une seule ligne. Règles typographiques
// prudentes (jamais de fusion après ponctuation terminale ni avant une majuscule
// de début de phrase), multilingues.

const TERMINAL_RE = /[.!?:…]\s*$/
// « ein »/« eine » (nominatif) couvraient déjà l'article indéfini allemand, mais pas ses
// formes déclinées au datif/accusatif/génitif (« einer », « einem », « einen », « eines »).
// Cas réel martha-blouse-with-lace-pattern-de : « … cm misst. Schließe mit einer » /
// « Rückreihe. » — « Rückreihe » (nom allemand) est TOUJOURS en majuscule, donc la règle de
// continuation par minuscule ne peut jamais prendre le relais ici comme elle le fait pour
// d'autres mots-outils de cette liste. Même défaut sur « Km in einen » / « 2-Lm-Eckbogen … »
// (summer-squares-wrap-cardigan-de, plusieurs occurrences).
// « or » anglais couvert depuis vague 7 sur sunshine-children-s-sweater-en : « …is
// (25/27/31/35/37/39/43cm or » / « 10/11/12/14/15/16/17' » — conjonction de coordination
// exactement comme « and »/« und »/« og » déjà dans la liste ; les 9 occurrences de fin de
// ligne du corpus Retours-banc (vagues 4-7) sont toutes des conjonctions pendantes réelles.
// Frontière de tête `(?<![\wÀ-ž])` et non `\b` : sans drapeau u, `\b` voit une lettre
// accentuée comme un séparateur (« modèle » finissait sur « le », « Größe » sur « e »).
// Le tiret garde `\b-` (mot coupé « Mo- » en fin de ligne).
const DANGLING_RE = /(?:[,;]|(?<![\wÀ-ž])(?:de|du|des|d'|la|le|les|un|une|et|au|aux|of|the|and|or|to|in|on|for|with|og|i|med|på|til|af|und|zu|die|der|das|den|dem|ein|eine|einer|einem|einen|eines|mit|für|von|im|el|los|las|con|para|di|da|il|lo|per|van|het|een|op|voor|met|na|do|ja|att|för|som|eller)\s*|\b-\s*)$/i
// « Change to Color »/« Change to Colour » (convention Hobbii anglaise) : cette phrase EXACTE
// annonce TOUJOURS un nom de couleur propre qui suit, capitalisé — la règle de continuation par
// minuscule (plus bas) ne peut donc jamais prendre le relais. Restreint à la PHRASE COMPLÈTE
// (pas au seul mot « color »/« colour », qui a été essayé puis retiré : « Laine Hobbii Dream
// colour » / « Acheter la laine et les accessoires ici: », dream-colour-shawl-fr, se serait
// fusionné à tort — « colour » y termine un nom de laine, pas une phrase d'annonce de couleur ;
// même risque relevé sur « … de color » (ES), « … contrasting color »/« main color » en toute
// fin de glossaire ES/EN, et le titre « Châle Dream Colour »). Cas réel rainbow-applique-en-
// 79d9ccb4 (banc vague 6, Rows 4 et 5) : « … inc in the last st. Change to Color » / « Orange.
// (20 sts) » et « … inc in the last st. Change to Color » / « Tomato. (25 m) » — sans ce
// signal, le nom de couleur qui complète la phrase devenait une puce à cocher orpheline,
// désynchronisant la numérotation des rangs suivants.
const CHANGE_TO_COLOR_RE = /\bchange to colou?r\s*$/i
// Articles anglais courts « a »/« an » : sortis du bloc /i ci-dessus et testés à part, en
// MINUSCULE STRICT (pas de /i). Une lettre isolée « A » en fin de ligne est presque toujours
// un CODE COULEUR (convention Hobbii « fil A/B/C/D/E ») quand elle est en MAJUSCULE, jamais
// l'article anglais — qui n'apparaît jamais en majuscule isolée dans le corpus. Sans cette
// séparation, DANGLING_RE (testé avant NEW_ITEM_RE dans shouldJoin) matchait à tort « fil A »
// et avalait le Tour 1 qui suit (bug sara-doll-fr).
const DANGLING_EN_ARTICLE_RE = /(?<![\wÀ-ž])(?:a|an)\s*$/
// Conjonctions d'une lettre (es « y », it « e/o », pl « i/w/z ») : même garde en minuscule
// stricte que « a » — une majuscule isolée en fin de ligne est un code couleur (« fil E »).
const DANGLING_SINGLE_LETTER_RE = /(?<![\wÀ-ž])[yeoiwz]\s*$/
// Préposition française « à » : sortie du bloc DANGLING_RE ci-dessus et testée à part, car
// \b en JavaScript SANS le drapeau /u se calcule sur [A-Za-z0-9_] — « à » n'en fait jamais
// partie, donc \bà ne matche JAMAIS (à gauche COMME à droite, « à » est toujours classé
// « non-mot » par le moteur, donc aucune transition mot/non-mot ne peut se produire à son
// contact). L'entrée était donc du code mort depuis toujours : toute phrase française coupée
// juste après « à »/« jusqu'à » restait scindée en deux lignes (cas réel diaphane-top-
// buttoned-shirt-fr : « … ou jusqu'à » / « 2 cm de moins que … »). Corrigée avec une
// frontière Unicode explicite (lookbehind négatif sur lettre/chiffre/underscore) plutôt
// qu'un \b : couvre aussi bien « Ceci va à » (espace avant) que « jusqu'à » (apostrophe
// collée, sans espace), tout en rejetant un « à » qui termine un autre mot (« voilà »,
// « delà »). /i comme le reste de DANGLING_RE : pas de collision connue dans le corpus
// analogue au cas couleur A/B/C/D/E de DANGLING_EN_ARTICLE_RE (une « À » majuscule ouvre une
// phrase, elle n'en termine jamais une) — cf. tests de non-régression associés.
const DANGLING_FR_A_RE = /(?<![\p{L}\p{N}_])à\s*$/iu
// Tiret cadratin/en dash ESPACÉ en fin de ligne (« Farbe 18121 – » / « Garn B ») : signale
// une valeur pendante après un tiret typographique séparateur (allemand courant : « mot –
// mot »), jamais une puce de liste (qui OUVRE la ligne, ne la termine pas). Hors de portée
// de DANGLING_RE : son alternative « - » est testée via `\b`, qui ne matche JAMAIS un tiret
// précédé d'un espace (position espace→tiret : les deux côtés sont non-mot, aucune
// frontière) — même angle mort que DANGLING_FR_A_RE avec « à ». Cas réel
// jingle-bells-ornament-de (banc vague 4) : « 1 Knäuel Glitter Deluxe 30g, Farbe 18121 – »
// / « Garn B » ne fusionnaient jamais, orphelinant le nom de coloris B. Restreint à un
// tiret précédé d'EXACTEMENT un espace après un caractère non-blanc : ne matche jamais une
// puce de liste en tête de ligne (qui n'est jamais en fin de ligne précédente), ni deux
// tirets consécutifs. Ne teste PAS l'ASCII « - » : ce cas reste couvert par DANGLING_RE
// quand un mot précède immédiatement (sans espace), volontairement inchangé par ce
// correctif — élargir à l'ASCII espacé n'a aucun témoin corpus à ce jour.
const DANGLING_DASH_RE = /(?<=\S)\s[–—]\s*$/
// Un chiffre n'ouvre un item QUE suivi d'un marqueur de liste (« 1. », « 2) ») —
// jamais un chiffre nu (« 4 mm » n'est pas un item). Le lookahead (?=\s|$) évite
// qu'un décimal (« 2.5 mm ») soit pris pour « 2. ».
// « r » nu (sans point ni « ow »/« ound ») : abréviation anglaise Hobbii pour Row/Round
// (« R 1: … », « R 9-13: … »). Cas réel kawaii-watermelon-rattle-en : chaque rang de ce PDF
// se termine par une VIRGULE au lieu d'un point (« … inc 1 st (28), ») — DANGLING_RE (la
// virgule finale) fusionnait donc systématiquement avec le rang suivant, faute d'un signal
// « nouveau rang » qui bloque la fusion en premier (NEW_ITEM_RE est testé AVANT DANGLING_RE
// dans shouldJoin). Le suffixe obligatoire \s*[:.-]?\s*\d (repris du reste du groupe) exige
// un chiffre juste après le « r » — avec ou sans espace ni ponctuation intercalaire, donc
// « r 2 » comme « r2 »/« R4 » — jamais un mot ordinaire commençant par « r » (« reading… »,
// « ripe… ») dont le caractère suivant ne serait ni espace/ponctuation ni chiffre. Effet
// BORNÉ : ce motif ne fait que BLOQUER une fusion, il n'avale jamais rien — voir « r2 »
// retenue comme amorce d'item est toujours préférable à un rang avalé par la ligne
// précédente. Testé UNIQUEMENT sur ce PDF-ci : les versions FR/ES du même éditeur terminent
// leurs rangs par une parenthèse seule (pas de virgule) et n'étaient pas touchées par ce bug —
// ne pas généraliser au-delà du « r » anglais.
// Ordinal allemand COLLÉ (knit-domino-shawl-de-61747066, corpus réel, Hobbii DE) :
// « 2.Reihe (rechte Seite): … » — ARBITRAGE : OUI. L'alt `\d+[.)](?=\s|$)` exige un espace
// (ou une fin de ligne) après le point, la forme collée ne la porte pas : sans cette
// branche, une continuation pendante (article décliné « mit einer », virgule DANGLING_RE)
// avalait un « 2.Reihe » en tête de ligne suivante. Même garde que partout : le mot de
// rang (reihe/runde/rd) est exigé après le point, « 1.Masche » reste fusionnable.
// Ordinal anglais ANTÉPOSÉ (revue, famille Yarnspirations/Bernat —
// reçue par ROW_START_RE/segment.js le 27/08, commit 8a3420dc, mais jamais ici) : « 1st
// row: (RS). 1 dc in… ». Deux chemins fusionnaient le rang : un mot-outil pendant en fin
// de ligne précédente (DANGLING_RE, shouldJoin), et le recoll paragraphe (mode para), qui
// court-circuite shouldJoin et son bloc dur TERMINAL_RE et ne consulte QUE NEW_ITEM_RE/
// KV_RE — d'où « …as follows: » + « 1st row: … » fusionnés. Branche miroir compacte de
// celle de ROW_START_RE : `\d+` + suffixe ordinal (st/nd/rd/th) + mot de rang anglais,
// `\b` final exigé. Ordinaux SEULEMENT anglais, comme le reste du vocabulaire ci-dessus ;
// sans suffixe collé au chiffre, un compte (« 2 rows below », définition d'abréviation de
// lush-life-crochet-blanket-en) ne matche pas — contre-test en spec.
const NEW_ITEM_RE = /^(?:[-•*›>«"(]|\d+[.)](?=\s|$)|(?:rangs?|rows?|rounds?|tours?|rnds?|r|rd|runde?n?|reihen?|omg(?:ang)?e?|vueltas?|giro|giri|toeren?|rz[ąę]d|krs|varv|kierros)\s*[:.-]?\s*\d|\d{1,3}\.\s*(?:reihen?|runde?n?|rd\.?)|\d+(?:st|nd|rd|th)\s*(?:rows?|rounds?)\b)/i
// Ligne « clé = définition » (abréviation, légende) : jamais fusionnée avec la précédente.
// Alt 1 : clé mono-token (comportement d'origine \S{1,12}, préservé tel quel).
// Alt 2 : clé courte multi-tokens (« m env », « m end », « ch sp ») — chaque token
// commence par un non-chiffre pour ne PAS avaler une phrase (« Rang 1 : », « Étape 2 : »).
const KV_RE = /^(?:\S{1,12}|[^\s=:\d][^\s=:]{0,5}(?: [^\s=:\d][^\s=:]{0,5}){1,2})\s*[=:]\s+\S/
// Correctif glossaire (banc vague 6, scallops-rectangular-placemat-es + open-back-sweater-fr) —
// une clé de glossaire dont un des 1 à 3 tokens est un COMPTE NU (« s 1 p » = « salta 1 punto »,
// « 2 ms ens. » = « 2 mailles serrées ensemble ») échappe à KV_RE ci-dessus : son unique but
// (cf. commentaire juste au-dessus) est justement d'exclure tout token commençant par un
// chiffre, pour ne jamais avaler un marqueur de rang (« Rang 1 : », « Étape 2 : ») comme
// continuation. Sans discriminant séparé, deux VRAIES entrées de glossaire disparaissaient,
// fusionnées dans la définition de l'entrée précédente :
//   - ES : « pb = punto bajo » avalait « s 1 p = salta un punto » — KV_RE ne matchant pas nt
//     (le token « 1 » est un chiffre), la règle de repli « une suite en minuscule continue
//     toujours » (plus bas, `/^\p{Ll}/u.test(nt)`) prenait le relais faute d'autre signal ;
//   - FR : « ms = maille serrée » avalait « 2 ms ens. = 2 mailles serrées ensemble » — même
//     échec de KV_RE (chiffre en tête cette fois), puis DANGLING_RE (plus bas) matchait à tort
//     le « e » final de « serrée » comme mot-outil isolé (\b, non conscient d'Unicode par
//     défaut en JS, traite un accent comme un caractère non-mot et pose donc une frontière
//     juste avant le dernier « e », un angle mort déjà connu — cf. DANGLING_FR_A_RE ci-dessus
//     pour le même mécanisme sur « à »).
// Discriminant : n'active RIEN de plus que le blocage de fusion que KV_RE produirait déjà pour
// une clé SANS chiffre — un marqueur de rang réel (« Rang 1 », « Tour 3 ») a de toute façon déjà
// NEW_ITEM_RE pour bloquer sa fusion (même résultat, testé plus bas) ; ce filet place seulement
// CE MÊME résultat plus tôt, avant que DANGLING_RE/la règle minuscule n'aient la chance de
// fusionner à tort. Exige la présence d'un séparateur « = »/« : » (jamais un chiffre nu en tête
// de phrase, qui n'a rien d'un glossaire) et qu'AU MOINS un des 1 à 3 tokens SOIT un nombre nu
// (1-2 chiffres) — les autres tokens restant courts (≤ 6 car., point final toléré pour une
// abréviation comme « ens. »).
const NUMERIC_ABBR_KEY_RE = /^([^\s=:]{1,6}(?:\s+[^\s=:]{1,6}){0,2})\s*[=:]\s+\S/
function isNumericAbbrKeyLine(t) {
  const m = NUMERIC_ABBR_KEY_RE.exec(String(t).trim())
  if (!m) return false
  const tokens = m[1].split(/\s+/)
  return tokens.length >= 2 && tokens.length <= 3 && tokens.some((tok) => /^\d{1,2}$/.test(tok))
}
// Revue (bloquant) : isNumericAbbrKeyLine ci-dessus ne regarde jamais `p` — sans garde
// symétrique, elle préempte TOUT signal de continuation positif situé plus bas dans
// shouldJoin (DANGLING_RE, OPEN_REP_RE, les règles allemandes…), pas seulement le faux
// positif DANGLING_RE visé par ce correctif. Cas réels reproduits en revue (aucun des deux
// n'a de compte nu ≤2 chiffres/≤3 tokens en tête de la ligne SUIVANTE par hasard — c'est
// justement le point commun avec les deux vrais bugs ES/FR) :
//   « … une longueur totale de » / « 45 cm : rabattre toutes les mailles. » — DANGLING_RE
//   fusionnait déjà correctement sur le « de » final (mot-outil RÉEL, pas un artefact
//   d'accent) ; « Répéter depuis * » / « 10 fois : au total 30 rangs. » — OPEN_REP_RE
//   fusionnait déjà correctement sur le span de répétition ouvert.
// Garde symétrique à kvShortCircuitsMinuscule (même principe : un signal fort sur `p` doit
// pouvoir continuer à l'emporter sur ce garde). PRUDENCE : DANGLING_RE elle-même ne peut PAS
// être réutilisée telle quelle pour ce garde — c'est le détecteur qui PRODUIT le bug FR
// d'origine (angle mort \b/accent : « … maille serrée » matche à tort son mot-outil « e »
// isolé). La réutiliser ici réintroduirait ce même bug par la porte à côté : « ms = maille
// serrée » redeviendrait « signal positif détecté » → guard déjà commodément débloqué →
// refusionnerait avec « 2 ms ens. = … ». endsOnDanglingWord ci-dessous réimplémente donc
// SEULEMENT la partie « mot-outil » de DANGLING_RE/GERMAN_DANGLING_RE contre le DERNIER TOKEN
// DE p PRIS TEL QUEL (`split` sur l'espace, jamais \b) : une égalité de CHAÎNE ENTIÈRE n'est
// jamais trompée par un accent interne, contrairement à \b — « serrée » ≠ « e », donc ne
// débloque jamais à tort, alors que « de »/« for »/« with », mots-outils RÉELS isolés en fin
// de ligne, restent détectés. Les autres signaux (virgule/point-virgule/tiret nu, « à »/
// « über » — déjà Unicode-safe —, span de répétition ouvert, annonce de couleur, règles
// allemandes) n'ont pas ce défaut et sont réutilisés tels quels : vérifié qu'aucun des deux
// ne matche sur les deux vraies clés ES/FR (aucune virgule/tiret/astérisque/à/über en fin de
// p, GERMAN_ADJ_RE/GERMAN_MORE_OR_LESS_RE hors sujet en français/espagnol).
const DANGLING_WORD_EXACT_RE =
  /^(?:de|du|des|d['’]|la|le|les|un|une|et|au|aux|of|the|and|or|to|in|on|for|with|og|i|med|på|til|af|und|zu|die|der|das|den|dem|ein|eine|einer|einem|einen|eines|mit|für|von|im|y|e|o|el|los|las|con|para|di|da|il|lo|per|van|het|een|op|voor|met|w|z|na|do|ja|att|för|som|eller|a|an)$/i
const GERMAN_DANGLING_WORD_EXACT_RE =
  /^(?:dass|weil|wenn|als|ob|während|bevor|nachdem|auf|an|bei|vor|unter|durch|ohne|um|gegen|zwischen|nach|aus|bis|seit|beide|beiden)$/i
function endsOnDanglingWord(p, isGerman) {
  const m = /(\S+)\s*$/.exec(p)
  if (!m) return false
  return DANGLING_WORD_EXACT_RE.test(m[1]) || (isGerman && GERMAN_DANGLING_WORD_EXACT_RE.test(m[1]))
}
function hasStrongContinuationSignal(p, isGerman) {
  const trimmed = String(p).trim()
  if (/[,;-]\s*$/.test(trimmed)) return true
  if (endsOnDanglingWord(trimmed, isGerman)) return true
  if (DANGLING_FR_A_RE.test(trimmed) || CHANGE_TO_COLOR_RE.test(trimmed) || OPEN_REP_RE.test(trimmed)) return true
  if (isGerman && (
    GERMAN_DANGLING_UBER_RE.test(trimmed) || GERMAN_ADJ_RE.test(trimmed) || GERMAN_MORE_OR_LESS_RE.test(trimmed)
  )) return true
  return false
}
// Span de répétition OUVERT : un rang crochet/tricot dont la directive « Répéter de
// * à * » (multilingue) est coupée par la colonne AVANT son compte (« … 10 fois au
// total »). La ligne se termine par un verbe de répétition puis un span `*` non
// ponctué → la continuation (souvent un chiffre nu) doit être recollée. Sans ça, le
// compte devient une ligne à part que steps.js prend pour un faux compteur « × ».
// `\w*` RETIRÉ (il suivait la liste de verbes, avant `[^.]*`) : les deux quantifieurs se
// chevauchaient — tout ce que `\w*` peut manger, `[^.]*` le peut aussi — si bien que le
// moteur explorait chaque partage possible entre eux. `\w*[^.]*` et `[^.]*` reconnaissent
// exactement le même langage (un caractère de mot n'est jamais un point), donc le retrait
// est SANS effet sémantique : vérifié par 300 000 tirages aléatoires sur l'alphabet du
// motif, zéro divergence. Mesuré sur « repeat » × 8 000 (48 001 caractères, cas atteignable
// par un paragraphe reflowé) : 1 909 ms AVANT, 0,12 ms APRÈS.
const OPEN_REP_RE = /\b(?:r[ée]p|repeat|gentag|gjenta|upprepa|toista|wiederhol|herhaal|ripet|repet|powt|repit)[^.]*[*⋆]\s*$/i
// Verbe de répétition (même racine que OPEN_REP_RE) présent QUELQUE PART sur p, devant une
// suite qui s'ouvre sur « * »/« ⋆ » : la coupure de colonne est tombée entre le verbe et le
// MARQUEUR FERMANT du span, pas juste avant son compte (cas déjà couvert par OPEN_REP_RE
// ci-dessus, qui exige l'astérisque en toute fin de p). Sans ce signal, NEW_ITEM_RE (testé
// juste après dans shouldJoin) prend à tort ce marqueur fermant pour une NOUVELLE puce
// astérisque et scinde le rang en deux, désynchronisant la numérotation des rangs suivants.
// Testé AVANT NEW_ITEM_RE, même position que hasOpenParen(p) plus bas pour les vecteurs de
// tailles entre parenthèses — même logique : un signal structurel d'inachèvement prime sur
// l'apparence de puce. Volontairement SANS condition sur la parité du nombre de « * »/« ⋆ »
// déjà présents sur p (span « ouvert » à 1 astérisque comme span déjà refermé puis RECITÉ par
// « rép de X à Y et de * à » se comportent identiquement ici) : vérifié un par un sur les 43
// occurrences d'une suite commençant par « * »/« ⋆ » dans les PDF des vagues 1 à 6, aucun faux
// positif — les entrées de glossaire/légende (« *…* = repeat instructions… », « ens =
// ensemble… ») n'ont jamais ce verbe en fin de ligne précédente, seulement une autre clé de
// glossaire. Cas réels :
// - playset-doll-clothes-fr (Rang 2 du T-shirt) : « …rép depuis » / « *trois fois, aug barr… » ;
// - frosty-flower-t-shirt-fr : « …(coin du carré) **, répétez de » / « * à ** jusqu’à… » ;
// - compass-rose-north-granny-square-fr : « …rép de * à * 2x et de * à » / « ** 1x, ms… » ;
// - granny-smith-skirt-en : « …ch 1 **, rep from * to » / « ** twice, join with sl st… » ;
// - floral-breeze-dress-es : « …3 cad **, rep de » / « * a ** hasta el final de la ronda… » ;
// - maddy-top-es (×3) : « …tejidos*; rep » / « *_* hasta el final de la vuelta. ».
// GARDE AJOUTÉE EN REVUE : REPEAT_VERB_RE seule n'est pas ancrée en fin de ligne (contrairement
// à sa jumelle OPEN_REP_RE ci-dessus, qui exige le verbe proche de la fin ET un astérisque
// littéral juste avant `$`) — elle matche le verbe n'importe où sur p. Un ancrage strict en fin
// de ligne façon OPEN_REP_RE casserait pourtant le cas réel compass-rose-north-granny-square-fr
// ci-dessus, où le verbe est suivi d'un bon tiers de ligne (« rép de * à * 2x et de * à ») avant
// la coupure. Le VRAI signal distinctif n'est pas la proximité de fin de ligne mais la présence
// d'un astérisque QUELQUE PART sur p LUI-MÊME (span déjà amorcé sur cette ligne) : un verbe de
// répétition en tête d'une longue phrase SANS AUCUN astérisque (« Repeat rows 1-4 as many times
// as needed for your size, then move to the collar » / « * See chart on page 12 for stitch
// counts ») ne parle que d'un ENSEMBLE DE RANGS ordinaire (« repeat rows 1-4 »), pas d'un span
// « *…* » en cours — la suite qui s'ouvre sur « * » y est une note indépendante sans rapport,
// jamais un marqueur fermant. D'où la condition JUMELLE `/[*⋆]/.test(p)` exigée en plus de
// REPEAT_VERB_RE à l'appel (shouldJoin ci-dessous), plutôt qu'une contrainte de distance qui
// aurait dû choisir entre casser compass-rose-north ou laisser passer ce faux positif.
const REPEAT_VERB_RE = /\b(?:r[ée]p|repeat|gentag|gjenta|upprepa|toista|wiederhol|herhaal|ripet|repet|powt|repit)/i
// Entrée de glossaire à tiret ASCII espacé (« m - maille », « ml - maille en l'air ») :
// une clé courte mono-token suivie de «  -  » et d'une définition. Ces lignes ne doivent
// PAS être fusionnées à la précédente (sinon les 7 abréviations d'un bloc deviennent une
// seule bouillie — unicorn-pillow). Sans cette garde, celles commençant par une minuscule
// (« ml », « ms »…) étaient recollées par la règle « suite en minuscule ».
const ASCII_DASH_KV_RE = /^\S{1,12}\s-\s\S/
// Même forme que ASCII_DASH_KV_RE, mais pour un tiret cadratin/en dash (« CO – cast on »,
// convention Hobbii EN — U+2013/U+2014) au lieu du tiret ASCII. Volontairement restreint à
// [–—] (PAS de variantes spéculatives comme U+2010/U+2212, sans preuve de corpus) et testé en
// CONJONCTION sur p ET nt (cf. DASH_KV_RE_BOTH_SIDES plus bas) : contrairement à
// ASCII_DASH_KV_RE, cette forme ne peut PAS bloquer sur nt seul — « Contorno de cadera: 69
// (76) … 116 » / « cm – ten en cuenta que la falda es de tiro bajo » (a-shaped-maxi-skirt-es,
// banc vague 4) a un nt qui matche cette même forme (« cm » clé courte, tiret, définition)
// alors que la fusion y est OBLIGATOIRE (l'unité « cm » clôt le vecteur de tailles qui
// précède) — seul le fait que p, LUI, ne matche pas la forme (« Contorno de cadera: » n'a pas
// de tiret juste après son premier mot) distingue ce cas réel du bug ci-dessous.
const EN_DASH_KV_RE = /^\S{1,12}\s[–—]\s\S/
// Exception NARROW à TERMINAL_RE : un « : » (spécifiquement, pas « . »/« ! »/« ? »/« … »)
// suivi d'une suite qui s'ouvre sur une parenthèse annonce presque toujours une valeur/liste
// qui continue la même mesure ou instruction — pas une vraie fin de phrase. Cas réel
// (mountaintop-pullover-de) : un label de mesure lettré « F. Gesamte Länge (…):" coupé par
// la colonne de sa valeur « (47, 54,5, …) cm » ; TERMINAL_RE bloquait la fusion AVANT que la
// règle « suite ouverte sur parenthèse » (plus bas) ait sa chance → reference.js reçoit un
// label sans valeur et JETTE la ligne en silence (perte de contenu, pas cosmétique). Un « : »
// SANS parenthèse qui suit reste un vrai terminateur (« Abréviations: » → nouvelle section).
const COLON_THEN_PAREN_RE = /:\s*$/
// Exception NARROW jumelle de COLON_THEN_PAREN_RE, mais pour un « . » (vraie fin de phrase) :
// un rang qui se termine par une VRAIE fin de phrase peut être immédiatement suivi de son
// propre TOTAL DE MAILLES, replié par la colonne — jamais une remarque ordinaire entre
// parenthèses (« (voir photo 1) », qui reste un vrai commentaire séparé, cf. test associé).
// Cas réel easter-chick-pip-de : « … auf der Runde. » / « (24) » — sans cette exception,
// TERMINAL_RE bloquait la fusion avant même que la règle « suite ouverte sur parenthèse »
// (plus bas) ait sa chance, et le total devenait une puce fantôme à cocher (9 occurrences).
// Restreint à un total NU : chiffres seuls entre parenthèses, RIEN d'autre (pas de point
// final dans la parenthèse ni après) — picture-ornament-fr a un cas voisin déjà correctement
// isolé aujourd'hui (« (12). », point final APRÈS la parenthèse) que ce correctif ne doit pas
// rouvrir : non couvert par cette regex car le point final change la forme entière de nt.
const BARE_COUNT_PAREN_RE = /^\(\s*\d+\s*\)$/
// Même signal, avec l'abréviation anglaise « st(s) » (stitch/stitches) DANS la parenthèse
// cette fois, au lieu de chiffres seuls : un total de mailles replié par la colonne peut
// porter son unité explicite plutôt qu'être nu. Cas réel rainbow-applique-en-79d9ccb4 (crochet
// anglais, banc vague 6) : « Row 3: … Change to Color Sunflower. » / « (15 sts) » — ni
// BARE_COUNT_PAREN_RE (exige des chiffres SEULS) ni BARE_COUNT_UNIT_RE/BARE_COUNT_PAREN_UNIT_
// JOIN_RE (unité « m »/« M » sans lettres « st ») ne couvrent cette forme, donc le total
// restait une puce à cocher orpheline, désynchronisant la numérotation des rangs suivants (3
// rangs cassés dans ce seul PDF : 3, 4 et 5). Restreint au SEUL littéral « st »/« sts »
// (insensible à la casse), seule forme observée sous cette forme dans le corpus des 6 vagues —
// même prudence que ses jumelles ci-dessus.
const BARE_COUNT_PAREN_STS_RE = /^\(\s*\d+\s*sts?\s*\)$/i
// Même signal, sans parenthèses : un total nu suivi directement de l'unité « m » (mailles),
// collée sans espace. Cas réel hiedra-shawl-wrap-with-leaf-motif-fr : « Rang 9: … 3 m end. » /
// « 21m » — le total du rang se détache en aparté flottant au lieu de rester dans la même
// puce à cocher, dans un motif ajouré où vérifier son compte est précisément ce qui évite
// l'erreur en cascade. Un seul cas de cette forme dans tout le corpus des trois vagues de
// campagne — regex volontairement stricte (chiffres + « m » seuls, rien d'autre).
const BARE_COUNT_UNIT_RE = /^\d+m$/
// Même signal, AVEC parenthèses ET unité cette fois (les deux traits de
// BARE_COUNT_PAREN_RE et BARE_COUNT_UNIT_RE réunis) : un total nu suivi de l'unité de
// maille allemande « M » (Masche), l'ensemble replié par la colonne DANS une parenthèse
// fermée sur sa propre ligne. Cas réel snowman-coaster-de-623a0c1d : « Runde 1: … 3 Lm
// schließen. » / « (12 M) », puis « Runde 2: … schließen. » / « (24 M) » — ni
// BARE_COUNT_PAREN_RE (exige des chiffres SEULS entre parenthèses, pas de lettre) ni
// BARE_COUNT_UNIT_RE (exige l'unité collée SANS parenthèses) ne couvrent cette forme
// mixte, donc la fusion échouait et le total nu restait une puce à cocher orpheline,
// détachée du rang qu'il totalise — en amont, segmentSections() (segment.js,
// BARE_COUNT_PAREN_UNIT_TITLE_RE — nom DÉLIBÉRÉMENT DIFFÉRENT de la regex ci-dessous) empêche
// déjà que cette même ligne soit prise pour un faux titre `##`, mais ne la recolle pas : c'est
// le rôle de reflowLines ici. Restreint au SEUL littéral « M » (majuscule allemande), seule
// forme observée sous cette forme dans le corpus, même prudence que BARE_COUNT_UNIT_RE
// ci-dessus.
// ⚠️ PORTÉE DÉLIBÉRÉMENT PLUS ÉTROITE que sa jumelle de segment.js
// (BARE_COUNT_PAREN_UNIT_TITLE_RE, qui accepte 1 à 4 lettres quelconques) : ici, une unité mal
// devinée fusionnerait à tort du texte non lié au rang qui précède (risque non borné), alors
// que côté titre le risque est SUPPRESS-ONLY. Les deux regex ne sont PAS synchronisées à
// dessein — ne pas les fusionner, ni élargir celle-ci en pensant suivre l'élargissement de
// l'autre (ou inversement).
const BARE_COUNT_PAREN_UNIT_JOIN_RE = /^\(\s*\d+\s*M\s*\)$/
// Exception NARROW au bloc dur TERMINAL_RE : l'ORDINAL allemand PUNCTUÉ (« die 1. », « der
// 1. ») en toute fin de ligne y est lu comme une fin de phrase et bloque la fusion avant
// tout autre signal. Signal grammatical fort pour le contourner : une phrase allemande ne
// se termine JAMAIS sur une préposition ou un article suivi d'un ordinal pointé — le nom
// attendu (« M », « Bahn », « Reihe »…) arrive sur la ligne suivante, et comme tout
// substantif allemand il est capitalisé, donc la règle de continuation par minuscule ne
// peut pas prendre le relais. Cas réels (uniquement forme préposition/article + ordinal
// 1-2 chiffres, pas de /i — « In » en tête de phrase reste hors liste) :
// - sunburst-adult-s-top-de l.98-99 : « …bis du insgesamt 16 hast, mit 1 Km oben in die 1. » /
//   « M schließen. Die Arbeit noch nicht schließen. » ;
// - knit-domino-shawl-de l.70-71 : « …an der rechten Seite der 1. Patchecke in der 1. » /
//   « Bahn aufstricken = 47 m. ».
// Corpus contrôlé (tous les .pdf.txt DE des vagues 3-7) : la forme n'apparaît que 5 fois,
// les 3 autres occurrences sont aussi des recollages légitimes — summer-squares-wrap-
// cardigan-de l.382 (« Km in die 3. » / « M, die Arbeit abschließen. »), bernadette-tote-
// bag-de l.110 (« DStb in das 1. » / « übersprungene Stb… », article « das ») et l.176
// (« …das 7. » / « mit dem 4. und 5.; … », énumération) — zéro faux positif. GARDE
// ÉTENDUE à l'appel (note de méthode de la campagne : ne jamais préempter un signal
// négatif existant) : l'exception ne s'arme que si la suite n'ouvre NI un nouvel item
// (NEW_ITEM_RE) NI une clé de glossaire, sous QUELQUE forme qu'elle écrive la séparation
// clé/définition — « = »/« : » (KV_RE), tiret cadratin/en dash (EN_DASH_KV_RE), ou clé
// comptée à token numérique (isNumericAbbrKeyLine, celle-là même qui complète KV_RE
// plus bas dans shouldJoin).
const GERMAN_PREP_ORDINAL_RE = /\b(?:in|an|auf|bei|der|die|das|den|dem|mit|bis)\s+\d{1,2}\.\s*$/
// Exception NARROW à KV_RE : quand la ligne suivante (nt) commence en minuscule, on donne la
// priorité à la règle de continuation minuscule (l.68) plutôt qu'à KV_RE — mais SEULEMENT si
// la ligne précédente (p) ressemble à une phrase de prose coupée en cours de route (au moins
// deux mots), pas à une étiquette/titre isolé. Motivation : KV_RE ne teste QUE nt, donc une
// phrase de prose coupée par la colonne qui matche KV_RE par accident (mot-outil suivi d'un
// « : », ex. « piece: approx. », « follows : », « que llevas: ») était bloquée AVANT que la
// règle minuscule n'ait sa chance (paliers 5-7).
// Trois gardes pour préserver les cas glossaire réels :
// - p est lui-même une entrée clé/valeur (KV_RE ou ASCII_DASH_KV_RE) → deux entrées de
//   glossaire consécutives à clé minuscule (« ch = chain » / « sc = single crochet ») ne
//   fusionnent jamais entre elles, comme avant ;
// - p est un mot/étiquette isolé SANS espace (ex. un en-tête de section nu « Abréviations »)
//   → sa première entrée de glossaire minuscule qui suit ne fusionne pas non plus, même sans
//   séparateur « = »/« : » sur p (un en-tête n'est pas une phrase en cours) ;
// - le plus long TOKEN (séparé par espace) de la « clé » matchée par KV_RE sur nt fait moins
//   de 4 caractères → mesuré sur le corpus (25 réfs), les VRAIES clés d'abréviation, y compris
//   les clés Alt 2 à plusieurs tokens du commentaire d'origine (« m env », « m end », « ch
//   sp »), n'ont JAMAIS de token ≥ 4 caractères (« m »=1, « ch »=2, « env »=3, « sp »=2…),
//   tandis que les mots-outils qui déclenchent KV_RE par accident (piece, follows, mousse,
//   l'aig., que llevas) ont TOUJOURS au moins un token ≥ 4 (« piece »=5, « llevas »=6…). La
//   longueur TOTALE de la clé ne suffit pas : « ch sp »/« m env » totalisent 5 caractères,
//   la même longueur que « piece » — seul le token le plus long sépare fiablement les deux
//   familles sur tous les cas réels rassemblés (paliers 5-8 + gate). Cas réel trouvé au gate :
//   « tricoter … à l'endroit » + « m = maille(s) » (lacey-bandana-fr, clé « m », 1 caractère)
//   ne doit PAS fusionner ; « travail en cours » + « ch sp = chain space » (mdlab-engine.spec,
//   clé « ch sp », tokens 2/2) non plus.
// `(|[^\n]*?[^\s\n])` et non `([^\n]*?)` : `[^\n]*?` et le `\s*` qui suit se chevauchaient
// sur les blancs, donc le moteur reparcourait toute la suite de blancs depuis chaque
// position d'arrêt possible de la clé — quadratique. Exiger que la clé finisse sur un
// caractère non blanc rend la frontière unique ; l'alternative vide en tête reproduit le
// « plus court d'abord » du quantifieur paresseux. Sémantique identique (une clé qui finit
// par un blanc n'a jamais été le plus court partage possible) : 300 000 tirages aléatoires,
// zéro divergence. 64 000 blancs suivis d'un caractère : 1 801 ms AVANT, 0,10 ms APRÈS.
const KV_KEY_RE = /^(|[^\n]*?[^\s\n])\s*[=:]\s+\S/
function kvShortCircuitsMinuscule(p, nt) {
  if (!/^\p{Ll}/u.test(nt) || !/\s/.test(p) || KV_RE.test(p) || ASCII_DASH_KV_RE.test(p)) return false
  const key = KV_KEY_RE.exec(nt)
  if (!key) return false
  const longestToken = Math.max(...key[1].split(/\s+/).map((t) => t.length))
  return longestToken >= 4
}

// Allemand — Piste 2 (remplace le bypass en bloc Piste 1, jugé trop agressif : régression
// mesurée -0,39 sur le gate DE au câblage bout en bout). Signal POSITIF, testé à la MÊME position que
// l'ancien bypass — après NEW_ITEM_RE/OPEN_REP_RE/ASCII_DASH_KV_RE, donc un nouveau rang/
// item n'est JAMAIS avalé même avec un signal allemand positif : la ligne précédente se
// termine-t-elle sur un mot-outil allemand (conjonction/préposition) ou un adjectif
// décliné en attente d'un nom (« die gesamte ») ? Isolé à isGerman : FR/EN/ES gardent le
// test minuscule inchangé.
// « beide » (quantificateur « les deux ») : quatrième occurrence d'une même famille de bugs
// (nom substantif allemand capitalisé en fin de coupure non recollé par les heuristiques
// existantes). Cas réel ydun-hat-de (banc vague 5, 7 puces cochables cassées — rounds
// 1/3/7/11/15/19, PLUS une deuxième occurrence de « 1. Runde » : ce rang est réutilisé tel
// quel en phase de diminution, après « Ab hier beginnen die Abnahmen », donc le motif « 1. »
// apparaît deux fois dans le patron et les DEUX occurrences sont cassées par ce bug) :
// « … stricke die 1. Masche rechts von vorne und lasse beide » / « Maschen auf die rechte
// Nadel gleiten*, … » — « Maschen » est TOUJOURS en majuscule (substantif), donc le test
// minuscule ne peut pas prendre le relais, exactement comme pour les entrées précédentes de
// ce groupe. Ajouté au SEUL token (« beide », pas « beiden »/« beides ») observé dans ce cas
// réel — cf. commentaire de GERMAN_UNIT_RE plus bas : ne pas étendre sans nouveau cas réel.
//
// LEDGER (revue, vague 5) : « beide » est la quatrième occurrence de la
// même famille — un mot-outil allemand en fin de ligne devant un substantif capitalisé. Une
// généralisation a été envisagée (règle : ligne p sans ponctuation terminale + mot-outil
// allemand connu en fin de ligne + ligne nt ouverte sur une majuscule ⇒ fusion) plutôt qu'un
// quatrième correctif ad hoc. Décision : correctif ciblé, PAS de généralisation, pour deux
// raisons vérifiables dans ce fichier même :
// 1. Les conditions (a) « pas de ponctuation terminale sur p » et (c) « nt peut commencer par
//    une majuscule » sont DÉJÀ implémentées et déjà génériques — (a) est TERMINAL_RE (testée
//    dans shouldJoin, cf. « if (TERMINAL_RE.test(p) && ... » plus bas), (c) est un no-op : le
//    test DANGLING_RE et la branche allemande finale de shouldJoin (celle qui teste
//    GERMAN_DANGLING_RE/GERMAN_ADJ_RE/GERMAN_MORE_OR_LESS_RE) fusionnent TOUTES DEUX déjà sans
//    regarder la casse de nt. Il ne reste donc RIEN à généraliser sur (a)/(c) : la seule
//    variable ouverte est (b), la LISTE des mots-outils. (Numéros de ligne volontairement omis
//    ici : un ajout dans ce fichier les décale à chaque commit — se référer aux noms de
//    fonctions/constantes ci-dessus, pas à une position figée.)
// 2. « Généraliser (b) » revient à remplacer une liste choisie par une devinette de nature
//    grammaticale (article/préposition/quantificateur/comparatif détecté par motif plutôt que
//    par mot précis) — c'est EXACTEMENT ce que faisait le bypass Piste 1 ci-dessus, retiré
//    après une régression mesurée de -0,39 sur le gate DE bout en bout. Élargir la liste au
//    coup par coup (comme ici) est la seule voie déjà validée par la mesure ; deviner la classe
//    grammaticale ne l'est pas et ne peut pas l'être sans un nouveau passage de gate complet
//    (hors du périmètre d'un correctif d'un seul défaut signalé).
// Reste non couvert par CE correctif (identifié en vague 4, non corrigé, à traiter à part
// — chacun est un ajout d'UN token à une liste existante, pas une nouvelle mécanique) :
// « … ab » / « Nadel » → ajouter « ab » à GERMAN_DANGLING_RE ; « einen größeren » / « Schal »
// → étendre le groupe de suffixes de GERMAN_ADJ_RE.
// [Un arbitrage, 03/09/2026 — reporté à post-1.0, chantier dédié « BARE_COUNT »] : la
// famille des continuations à TÊTE CHIFFRÉE ou mot-unité complet reste scindée — vagues 4-7 :
// pascal-unisex-slipover-de (« …hast du jetzt 184 (204) 224 (240) / 260 M. », « …insgesamt
// 3 (3) 3 (4) / 5-mal wiederholen. »), moss-rose-socks-es (« …pd de la Aguja / 3. »),
// helly-lamb-es (« …pb en los sig. 11 pts / [27] »), back-to-the-beach-de (« …und 1 /
// Markierungsfaden… »), sunshine-children-s-sweater-en résiduels. Ces suites ne matchent ni
// NEW_ITEM_RE (pas de ponctuation après le chiffre) ni les signaux positifs d'unité
// (GERMAN_UNIT_RE teste la TÊTE de nt, pas les nombres nus). Miroir du même réglage : les
// sur-fusions de rangs (nadia-sweater-fr, « Nème rang, » non reconnu par ROW_RE/NUM_ROW_RE
// → blockquotes) — les deux faces doivent être traitées ENSEMBLE pour ne pas régler
// shouldJoin deux fois dans des sens opposés. Point d'entrée du chantier : ce fichier +
// steps.js (vocabulaire de rang ordinal FR).
// « beiden » (génitif/datif pluriel de « beide ») couvert depuis vague 7 sur sunburst-adult-
// s-top-de (« …und arbeite aus der Mitte der beiden » / « Bobbel gleichzeitig. », l.133-134),
// sofie-vest-de (« …Für den Armausschnitt auf beiden » / « Seiten abnehmen: ») et
// knit-dishcloth-basket-stitch-de (vague 4, « …Kettenrand, der auf beiden » / « Seiten
// gleich ist. ») — même famille : mot-outil en fin de ligne devant un substantif capitalisé.
const GERMAN_DANGLING_RE = /\b(?:dass|weil|wenn|als|ob|während|bevor|nachdem|auf|an|bei|vor|unter|durch|ohne|um|gegen|zwischen|nach|aus|bis|seit|beide|beiden)\s*$/i
// « über » souffre du même défaut que « à » ci-dessus (même raisonnement : premier
// caractère « ü » hors [A-Za-z0-9_], donc \b ne matche jamais à son contact — code mort
// dans GERMAN_DANGLING_RE depuis toujours). Sortie et testée à part avec la même frontière
// Unicode explicite. GERMAN_ADJ_RE plus bas n'est PAS concernée par ce défaut : son groupe
// de suffixes (dont « übrig ») est précédé de \s+ et non de \b.
const GERMAN_DANGLING_UBER_RE = /(?<![\p{L}\p{N}_])über\s*$/iu
// Adjectif décliné en attente d'un nom (« für die gesamte » → « gesamte » annonce un nom
// qui vient sur la ligne suivante). Liste CHOISIE, pas un suffixe brut : un nom féminin
// allemand complet finit AUSSI en « -e » (« die Länge », « die Masche ») — un suffixe seul
// confondrait un adjectif en attente d'un nom avec un nom déjà complet. Liste non
// exhaustive, à étendre si la jauge révèle un trou (même logique incrémentale que
// DANGLING_RE existant).
// Radicaux « erst » et « link » couverts depuis vague 7 sur sunburst-adult-s-top-de :
// « …vernähen, wenn du am ersten » / « Maschenmarkierer bist. » (l.183-184) et « …dass dein
// Top mit der linken » / « Seite nach außen liegt. » (l.208-209). « am ersten » exige en
// OUTRE l'article CONTRACTÉ « am » (an+dem) dans le groupe d'articles : seul token ajouté,
// même discipline — il ne déclenche rien sans un radical de la liste derrière lui (contre-
// test « Wir treffen uns am » / « Nachmittag. » dans la spec). Corpus contrôlé : les seules
// autres fins de ligne matchées sont « die erste » (stanley-the-knitting-bear-de, l.281) et
// « von der ersten » (knit-domino-shawl-de, l.80), toutes deux de vraies continuations.
const GERMAN_ADJ_RE = /\b(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|am)\s+(?:gesamt|restlich|übrig|folgend|nächst|letzt|ganz|ander|gleich|erst|link)(?:e|en|em|er|es)?\s*$/i
// « mehr oder weniger » (comparatif adverbial allemand, « plus ou moins ») laissé en fin de
// ligne devant le NOM qu'il quantifie sur la ligne suivante — ce nom, comme tout substantif
// allemand, commence par une majuscule, donc le test minuscule (l.294 plus bas) ne peut pas
// prendre le relais. GERMAN_ADJ_RE ne couvre pas ce cas : la locution n'est précédée d'AUCUN
// article (« mehr oder weniger Runden », pas « die/eine mehr oder weniger »). Cas réel
// hurricane-granny-shawl-de (banc vague 4) : « Die Größe kann leicht verändert werden, indem
// mehr oder weniger » / « Runden gehäkelt werden. » — sans ce recollage, la valeur de « Maße: »
// dans le tableau de tailles restait tronquée et sa fin de phrase devenait un rang orphelin
// dans ## Matériel (la ligne de mesure fait encore partie de la section « Material: » au
// moment où reflowLines s'exécute, avant l'extraction des champs par reference.js).
const GERMAN_MORE_OR_LESS_RE = /\bmehr\s+oder\s+weniger\s*$/i

// Chiffre nu OU vecteur de tailles fermé en fin de ligne, devant une abréviation/nom allemand
// de maille en MAJUSCULE (« Lm », « Maschen ») : signal d'attente isolé au crochet carré-par-
// carré allemand. Cas réel summer-squares-wrap-cardigan-de (au moins 5 rangs, Q1/Q2/Q5/Q6/
// MQ1) : « … indem du die Km der vorherigen Runde beendest, 4 » / « Lm (zählen als Stb, 1
// Lm) … » — la coupure de colonne tombe PILE entre le chiffre et l'unité qui le suit. Aucune
// règle existante ne traitait un chiffre nu comme un signal d'inachèvement (DANGLING_RE ne
// couvre que la ponctuation/les mots-outils, jamais un chiffre), et la règle de continuation
// par minuscule ne peut pas s'appliquer : « Lm »/« Maschen » sont conventionnellement en
// MAJUSCULE (noms allemands). Même signal sous forme vecteur (martha-blouse-with-lace-
// pattern-de) : « … bis auf 6 (9, 13, 17, 20, 23) » / « Maschen vor dem Markierer stricken,
// … » — le vecteur fermé annonce lui aussi l'unité qui le suit, exactement comme le chiffre
// nu. Liste d'unités VOLONTAIREMENT restreinte à ce qui est observé dans le corpus — Km, M,
// Stb, Schlaufen et Seite couverts depuis vague 7 sur cas réels : « …Schließe die Runde
// mit 1 » / « Km oben in die erste M… » (sunburst l.105-106), « …die letzten 3 » / « M
// zus. (23) » (easter-chick-pip-de, vague 3, l.117-118 — NB la citation « die 1. / M
// schließen » de sunburst Reihe 2 est recollée depuis l'exception ordinale
// GERMAN_PREP_ORDINAL_RE plus haut : p finit sur le point ORDINAL « 1. », lu par
// TERMINAL_RE comme une fin de phrase, bloc dur contourné par cette seule exception), « …(Insgesamt:
// 12 » / « Stb, 12 RStb-v). » (bernadette-tote-bag-de l.81-82), « …umschlagen, durch 2 » /
// « Schlaufen ziehen » (sunburst l.101-102), « …du solltest nur an 1 » / « Seite des
// Quadrats… » (sunburst l.156-157). Runden/Reihen restent EXCLUS : têtes de rang déjà
// captées par NEW_ITEM_RE (testé avant), les y ajouter n'apporterait rien et élargirait le
// risque de faux positif sans preuve.
const GERMAN_UNIT_RE = /^(?:Lm|Maschen|Km|M|Stb|Schlaufen|Seite)\b/
function trailingNumberOrVector(s) {
  return /\d\s*$/.test(s) || (/\)\s*$/.test(s) && !trailingClosedParenHasNoDigit(s))
}

// Parenthèse laissée OUVERTE en fin de ligne : la coupure de colonne est tombée à
// l'intérieur d'un vecteur de tailles. PDF réel Mia Cardigan (English) v1.1 :
//   « … held together with 150 (150, 150, 150, »  puis  « 150) (150, 200, … »
//   « … bust circumference of 75 (80, 85, 90, 95) (100, 110, 120, »  puis  « 130) 140, 150 cm. »
// NEW_ITEM_RE prend le « 150) » / « 130) » de tête pour une PUCE NUMÉROTÉE et bloque le
// recollage. Conséquences mesurées : quantités de laine illisibles, et la phrase des
// sous-tailles JETÉE (findSizeVectors rend 11 valeurs sur la ligne entière, 6 sur la
// seconde moitié seule — subsizes exige exactement n valeurs, donc rien n'est émis).
// Compte les parenthèses au lieu de chercher un motif : une ligne qui ouvre plus de
// parenthèses qu'elle n'en ferme est nécessairement inachevée.
function hasOpenParen(s) {
  let depth = 0
  for (const ch of s) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth = Math.max(0, depth - 1)
  }
  return depth > 0
}

// Parenthèse OUVRANTE en tête de suite qui annonce un vecteur numérique de tailles ou
// de quantités (« (3, 3, 4) », « (47, 54,5, 59,5) ») : un chiffre suit immédiatement
// l'ouverture (espace optionnel). Un tel vecteur est une valeur autonome, pas la suite
// d'une phrase ou d'un libellé encore ouvert — CONTRAIREMENT à une parenthèse de
// continuation ordinaire (remarque, précision) que la règle générale plus bas continue
// de recoller sans condition. Cas réel (candy-cane-stripes-sweater-en, pull bicolore) :
//   « (4, 4, 4) … skeins of Kind » / « Feather col. 07 (A) » / « (3, 3, 4) … skeins of
//   Kind » / « Feather col. 02 (B) »
// Avant ce garde, la règle générale « suite ouverte sur parenthèse » fusionnait
// aveuglément « Feather col. 07 (A) » avec la ligne suivante dès qu'elle commençait par
// « ( » — ici le vecteur de quantité du fil B, qui n'a AUCUN rapport avec le libellé du
// fil A qui précède. Résultat : la quantité de B se retrouvait collée au nom de A, et B
// se retrouvait sans quantité — association couleur/quantité fausse, erreur d'achat de
// fil pour l'utilisatrice.
const OPEN_NUMERIC_VECTOR_RE = /^\(\s*\d/
// La ligne PRÉCÉDENTE se termine par une parenthèse FERMÉE dont le contenu ne contient
// AUCUN CHIFFRE (code couleur « (A) », remarque « (voir photo) »…) : un tel contenu n'a
// structurellement rien à voir avec un vecteur de tailles/quantités qui suivrait. C'est la
// SEULE forme retenue pour bloquer la fusion avec un vecteur numérique (voir plus bas) —
// tout le reste (la ligne précédente se termine par un chiffre nu, par « : », ou par un
// vecteur déjà fermé qui contient lui-même un chiffre) reste une continuation légitime de
// la même liste de tailles, mesurée sur plusieurs cas réels du corpus :
// - chiffre nu juste avant un vecteur (« … = 132 » / « (144, 156) stitches. »,
//   laura-sweater-en — même schéma que le commentaire hasOpenParen plus haut : « Sizes 1
//   (2, 3, 4, 5) … ») ;
// - vecteur déjà fermé suivi d'un autre vecteur (« … turn. (7, 8, 9) » / « (10, 11, 13)
//   (14, 15, 17) … », candy-cane-stripes-sweater-en, Neckline One) ;
// - libellé terminé par « : » (COLON_THEN_PAREN_RE, mountaintop-pullover-de plus haut).
// Une première version de ce garde exigeait une virgule dans le contenu fermé (pour ne
// couvrir que les vecteurs), ce qui bloquait À TORT le cas « chiffre nu » ci-dessus
// (régression mesurée à la vérification bout en bout) — la condition retenue ici teste
// l'ABSENCE de chiffre plutôt que la présence d'une virgule, ce qui couvre tous les cas
// positifs sans réintroduire le bug (le seul cas à bloquer, « (A) »/« (B) », n'a jamais de
// chiffre à l'intérieur de sa parenthèse).
function trailingClosedParenHasNoDigit(s) {
  const m = /\(([^()]*)\)\s*$/.exec(s)
  return !!m && !/\d/.test(m[1])
}

// Vecteur de tailles ALTERNÉ en tête de continuation (« 15 (16) sts. … » : chiffre, espace,
// parenthèse ouvrante) : la coupure de colonne est tombée ENTRE deux tailles d'un même
// vecteur compact façon Hobbii (« … = 13 (14) 15 (16) sts. »). Cas réel
// agnes-sweater-en-4f1102bf (vague 7, suite du correctif 162b2dec) : la queue physique du
// rang « Neck: … » restait une puce orpheline, car cette forme n'est reconnue par AUCUN
// signal existant — NEW_ITEM_RE exige un marqueur de liste APRÈS le chiffre (« 15. »,
// « 15) »), OPEN_NUMERIC_VECTOR_RE exige la parenthèse en TÊTE de nt, et le test
// minuscule ne s'applique pas (nt commence par un chiffre). Même famille observée côté
// allemand (viking) : totaux « = 24 (27) 29 (31) Maschen » scindés entre deux tailles.
// Utilisée en CONJONCTION avec trailingNumberOrVector(p) à l'appel (shouldJoin) : la
// continuation d'un vecteur ne suit que la FIN d'un total/vecteur, jamais un libellé
// encore ouvert — cf. le contre-test « …aiguilles : » + « 3 (4) skeins » de la spec,
// garanti bloqué plus tôt par TERMINAL_RE.
const ALTERNATING_VECTOR_HEAD_RE = /^\d+\s*\(/

// TÊTE de bandeau copyright (« © House of Yarn AS », « (c) … », « Copyright … ») : une telle
// ligne n'est JAMAIS la continuation d'une phrase du patron, ni ne la précédente n'a à s'y
// souder. Cas réel (111-14-chunky-cortina-sweater-en, p.2, colonne gauche) : la colonne
// finit par « …work diagram A. Count outwards from the middle of », puis le bandeau en bas
// de page — la fusion produisait « middle of © House of Yarn AS » dans le MD final. La garde
// doit vivre comme condition NÉGATIVE du `if` de fusion de reflowLines (pas comme un simple
// refus dans shouldJoin) : la fusion a DEUX chemins en OU, et sameParagraph (mode para,
// interligne court) court-circuite tous les gardes de shouldJoin. Portée délibérée sur la
// ligne COURANTE TÊTE de bandeau uniquement : une CONTINUATION de bandeau (« The copying… »
// après « © House of Yarn AS ») ne commence pas par le motif et reste fusionnable (bandeau
// compact) ; de même une instruction qui CITE un © en milieu de ligne n'est pas touchée
// (ancrage ^). Faux négatif jugé inexistant en corpus tricot : une vraie continuation de
// phrase ne commence jamais par ©/(c)/Copyright. « (c) » exige un espace derrière : le
// fragment d'une expression coupée comme « knitted in (c) » — inventé, aucun cas réel — ne
// doit pas pouvoir matcher par accident ; seules les formes de bandeau observées sont visées.
const COPYRIGHT_HEAD_RE = /^(?:©|\(c\)\s|Copyright\b)/i

function shouldJoin(prevText, nextText, isGerman = false) {
  const p = prevText.trim()
  const nt = nextText.trim()
  if (!p || !nt) return false
  // Une vraie fin de phrase suivie immédiatement de son propre total de mailles replié par
  // la colonne (BARE_COUNT_PAREN_RE/BARE_COUNT_UNIT_RE) fusionne toujours — testé AVANT le
  // blocage général de TERMINAL_RE, avec un « return true » explicite plutôt qu'un simple
  // bypass : contrairement au « : »+parenthèse (COLON_THEN_PAREN_RE), la forme sans
  // parenthèse (« 21m ») ne serait jamais rattrapée par la règle « suite ouverte sur
  // parenthèse » plus bas, qui ne s'applique qu'à une suite commençant par « ( ».
  // ORDRE IMPORTANT : ce test doit rester AVANT NEW_ITEM_RE (plus bas) — sa toute première
  // alternative est [-•*›>«"(], qui matche un « ( » de tête comme puce/marqueur. Si ce test
  // passait après NEW_ITEM_RE, « (24) » y serait pris pour un nouvel item et la fusion serait
  // bloquée : c'est cet ordre-ci, pas seulement la regex, qui fait marcher ce correctif.
  if (TERMINAL_RE.test(p) && (BARE_COUNT_PAREN_RE.test(nt) || BARE_COUNT_PAREN_STS_RE.test(nt) || BARE_COUNT_UNIT_RE.test(nt) || BARE_COUNT_PAREN_UNIT_JOIN_RE.test(nt))) return true
  // Ordinal allemand pointé en fin de ligne (« in die 1. ») : exception AVANT le bloc dur
  // TERMINAL_RE — cf. GERMAN_PREP_ORDINAL_RE ci-dessus (cas sunburst/domino). Placée ici,
  // APRÈS l'exception BARE_COUNT : elle ne peut transformer qu'un « return false » (la ligne
  // suivante était de toute façon scindée), jamais court-circuiter un signal positif antérieur.
  // (revue) Les gardes de nt couvrent TOUTES les formes d'entrée de
  // glossaire, pas seulement « = »/« : » : sans EN_DASH_KV_RE, « …in der 1. » + « M – Masche »
  // fusionnait et la clé « M » disparaissait dans la fin de phrase ; isNumericAbbrKeyLine
  // couvre les clés comptées à token numérique qui échappent à KV_RE — mêmes détecteurs,
  // mêmes ports, que les gardes « glossaire » du corps de shouldJoin plus bas.
  if (isGerman && GERMAN_PREP_ORDINAL_RE.test(p) && !NEW_ITEM_RE.test(nt) && !KV_RE.test(nt) && !EN_DASH_KV_RE.test(nt) && !isNumericAbbrKeyLine(nt)) return true
  if (TERMINAL_RE.test(p) && !(COLON_THEN_PAREN_RE.test(p) && nt.startsWith('('))) return false
  if (KV_RE.test(nt) && !kvShortCircuitsMinuscule(p, nt)) return false
  // Clé de glossaire à compte nu (« s 1 p », « 2 ms ens. ») — cf. commentaire d'
  // isNumericAbbrKeyLine ci-dessus. Testée ICI, au même point que KV_RE : avant tout signal
  // (guillemet, parenthèse, DANGLING_RE, minuscule…) qui pourrait fusionner nt à tort.
  // Garde symétrique hasStrongContinuationSignal(p, …) — cf. son commentaire ci-dessus : un
  // signal de continuation déjà FORT sur `p` (mot-outil réel, span de répétition ouvert…)
  // continue de l'emporter, exactement comme kvShortCircuitsMinuscule le fait pour KV_RE.
  if (isNumericAbbrKeyLine(nt) && !hasStrongContinuationSignal(p, isGerman)) return false
  // Une suite qui s'ouvre sur un guillemet continue toujours la phrase.
  if (/^[“"«]/.test(nt)) return true
  // Une suite qui s'ouvre sur une parenthèse continue la phrase EXCEPTÉ quand cette
  // parenthèse ouvre un vecteur numérique de tailles/quantités (OPEN_NUMERIC_VECTOR_RE
  // ci-dessus) ET que la ligne précédente se termine par une parenthèse fermée SANS
  // chiffre (trailingClosedParenHasNoDigit, cf. commentaire détaillé ci-dessus) : ce
  // vecteur est alors une valeur autonome, sans rapport avec le code couleur/la remarque
  // qui précède — c'est exactement le bug candy-cane-stripes-sweater-en documenté plus
  // haut. Dans tous les autres cas, le vecteur qui suit EST la continuation attendue et
  // doit fusionner comme avant.
  if (nt.startsWith('(') && (!OPEN_NUMERIC_VECTOR_RE.test(nt) || !trailingClosedParenHasNoDigit(p))) return true
  // Un item numéroté (« 3. … », « Tour 4 : ») n'est jamais avalé par un mot pendant qui le
  // précède (virgule, préposition en fin de ligne précédente) — sinon un rang entier
  // disparaît fusionné dans la ligne d'avant (cas D, PDF réel
  // the-sheep-lambert-and-lana-es). Testé AVANT DANGLING_RE : ce dernier ne matche jamais
  // un début d'item (format « \d+[.)] » ou mot-clé rang/tour), donc ce réordonnancement ne
  // change aucun autre cas — seul un mot pendant suivi d'un CHIFFRE NU sans marqueur de
  // liste (« 63 prochaines m ») continue de fusionner via la règle suivante.
  // Une parenthèse ouverte sur p rend la suite non-autonome : ce qui ressemble à une puce
  // « 150) » est en réalité la fermeture du vecteur commencé sur la ligne précédente.
  // Testé AVANT NEW_ITEM_RE, et RESTREINT à une suite qui commence par un NOMBRE suivi
  // d'une parenthèse fermante — une vraie puce « 1) Cast on » après une ligne à
  // parenthèse ouverte reste possible, mais elle refermerait la parenthèse, ce qui est
  // exactement le cas capté ici et souhaité.
  if (hasOpenParen(p) && /^\d+(?:[.,]\d+)?\)/.test(nt)) return true
  // Cf. commentaire de REPEAT_VERB_RE plus haut : un span de répétition dont le marqueur
  // fermant (« * »/« ** ») ouvre la ligne suivante n'est pas une nouvelle puce. La condition
  // `/[*⋆]/.test(p)` est OBLIGATOIRE en plus du verbe : sans elle, un verbe de répétition en
  // tête d'une longue phrase sans aucun astérisque (« Repeat rows 1-4 … ») fusionnerait à tort
  // une note indépendante qui commence par « * » sur la ligne suivante (faux positif trouvé en
  // revue, cf. commentaire détaillé sur REPEAT_VERB_RE).
  if (/^[*⋆]/.test(nt) && REPEAT_VERB_RE.test(p) && /[*⋆]/.test(p)) return true
  if (NEW_ITEM_RE.test(nt)) return false
  // Chiffre nu ou vecteur fermé devant une unité de maille allemande (cf. GERMAN_UNIT_RE) :
  // testé APRÈS NEW_ITEM_RE, comme le reste des signaux positifs allemands, pour qu'un
  // nouveau rang (« Rd 6: … ») ne soit jamais avalé même quand la ligne précédente se termine
  // par un chiffre nu.
  if (isGerman && trailingNumberOrVector(p) && GERMAN_UNIT_RE.test(nt)) return true
  // Deux entrées de glossaire à tiret cadratin/en dash CONSÉCUTIVES (p ET nt matchent toutes
  // les deux EN_DASH_KV_RE) ne fusionnent jamais entre elles — testé ICI, AVANT DANGLING_RE,
  // contrairement à ASCII_DASH_KV_RE plus bas (qui ne teste que nt) : une définition courte
  // d'abréviation se termine souvent par un mot qui EST AUSSI un mot-outil de DANGLING_RE
  // (« cast on » se termine par « on », homographe de la préposition anglaise), donc
  // DANGLING_RE fusionnait à tort l'entrée suivante dans la même cellule de glossaire avant
  // que la garde symétrique à ASCII_DASH_KV_RE (l.324) n'ait sa chance. Cas réel
  // lucent-sweater-en (banc vague 4) : « CO – cast on » / « C4B – cable 4 back » fusionnaient
  // en une seule ligne « CO – cast on C4B – cable 4 back », et la clé « C4B » — utilisée plus
  // loin dans le corps du patron pour un point torsadé — disparaissait entièrement du
  // glossaire. Restreint à la CONJONCTION (p ET nt) plutôt qu'à nt seul : voir le commentaire
  // de EN_DASH_KV_RE ci-dessus pour le cas réel (a-shaped-maxi-skirt-es) où nt seul matche
  // cette forme sans être une nouvelle entrée de glossaire, et où la fusion reste obligatoire.
  if (EN_DASH_KV_RE.test(p) && EN_DASH_KV_RE.test(nt)) return false
  // Un mot pendant (« … dans les ») raccorde même une suite commençant par un chiffre nu
  // (« 63 prochaines m ») : la coupure de colonne tombe où elle veut.
  if (DANGLING_RE.test(p) || DANGLING_EN_ARTICLE_RE.test(p) || DANGLING_SINGLE_LETTER_RE.test(p) || DANGLING_FR_A_RE.test(p) || DANGLING_DASH_RE.test(p) || CHANGE_TO_COLOR_RE.test(p)) return true
  // Après NEW_ITEM_RE : un « 7. … » (nouveau rang) n'est jamais avalé, même si la
  // ligne précédente ouvre un span de répétition. Ne recolle que la continuation d'un
  // compte pendant (« 10 fois au total »).
  if (OPEN_REP_RE.test(p)) return true
  // Une entrée de glossaire ASCII (« ml - maille ») ne continue jamais la ligne précédente.
  if (ASCII_DASH_KV_RE.test(nt)) return false
  // Le test minuscule reste valide EN PLUS du signal allemand, pas remplacé par lui : un
  // mot en minuscule qui n'est PAS un nom commun allemand (emprunt, terme technique
  // international comme « Magic Loop ») doit continuer à fusionner même en allemand —
  // seuls les noms communs allemands capitalisés rendaient ce test peu fiable, pas TOUS
  // les mots en minuscule (bug trouvé à la jauge finale).
  if (/^\p{Ll}/u.test(nt) || (isGerman && (GERMAN_DANGLING_RE.test(p) || GERMAN_DANGLING_UBER_RE.test(p) || GERMAN_ADJ_RE.test(p) || GERMAN_MORE_OR_LESS_RE.test(p)))) return true
  // Suite d'un vecteur de tailles compact (agnes-sweater-en-4f1102bf, cf.
  // ALTERNATING_VECTOR_HEAD_RE ci-dessus) : la ligne précédente se termine sur un TOTAL
  // (trailingNumberOrVector — chiffre nu, ou parenthèse fermée contenant un chiffre) et la
  // continuation s'ouvre sur un vecteur alterné « 15 (16) … ». Règle ADDITIVE : testée en
  // DERNIER RECOURS, après tous les refus (TERMINAL_RE, NEW_ITEM_RE, KV_RE…) et tous les
  // signaux positifs existants — elle ne peut préempter aucun garde en place, seulement
  // transformer le « return false » final en fusion pour cette seule forme. Une ligne
  // finissant sur « : » (liste de matériaux) reste bloquée bien plus haut par le bloc
  // TERMINAL_RE : ce signal n'est jamais atteint pour elle.
  if (trailingNumberOrVector(p) && ALTERNATING_VECTOR_HEAD_RE.test(nt)) return true
  return false
}

// Fragment d'URL enroulée sur DEUX coupures de colonne consécutives (donc deux fusions
// successives) : la première moitié ouvre déjà la parenthèse et amorce « http(s):// »
// (rejointe normalement, AVEC espace, par la règle « suite ouverte sur parenthèse » de
// shouldJoin ci-dessus), mais la SECONDE moitié — un fragment d'URL sans aucun espace
// interne — ne doit PAS hériter d'un espace : « …si=IpOYTGz » + « OwmQky7iv) » doit
// redevenir « …si=IpOYTGzOwmQky7iv) », pas « …si=IpOYTGz OwmQky7iv) » (URL cassée par
// l'espace injecté par la fusion générique). Cas réel (compass-rose-north-granny-square-
// fr) : lien YouTube de l'abréviation « demi-dbr », enroulé sur trois lignes PDF, dont la
// queue « OwmQky7iv) » commence en MAJUSCULE — aucune règle de shouldJoin (guillemet,
// parenthèse ouvrante, minuscule…) ne la reconnaît comme continuation (une majuscule en
// tête bloque tout), elle disparaissait donc silencieusement : parenthèse jamais
// refermée, lien tronqué dans le tableau d'abréviations.
// PRUDENCE (revue) : ce chemin tourne AVANT shouldJoin, donc il court-circuite TOUS ses
// garde-fous (NEW_ITEM_RE, KV_RE, TERMINAL_RE…) — un simple « hasOpenParen(p) &&
// /https?:\/\// .test(p) » (le http(s):// n'importe où dans p, pas forcément dans la
// parenthèse encore ouverte) collerait sans espace n'importe quelle suite sans espace qui
// suit une URL citée plus haut ET une parenthèse ouverte sans rapport — y compris un
// vrai rang (« R1: »), un total nu (« (24) », « 21m ») ou une puce, exactement ce que
// NEW_ITEM_RE existe pour bloquer. La regex ci-dessous ancre le « http(s):// » DANS la
// parenthèse encore ouverte : elle doit démarrer au DERNIER « ( » de p et courir sans
// « ( »/« ) »/espace jusqu'à la fin de la ligne — seule une URL amorcée à l'intérieur de
// cette parenthèse, jamais refermée, satisfait ça.
// RE-REVUE (bloquant) : la classe finale était `\S*$` — elle matche AUSSI un « ) », donc
// une URL entre parenthèses DÉJÀ REFERMÉE en fin de ligne (« … (https://…/abc) », le cas
// COURANT d'un glossaire, pas l'exception) satisfaisait la regex tout autant qu'une vraie
// parenthèse non refermée, et collait sans espace le vrai rang qui suivait — réintroduisant
// le bug de collage que ce garde-fou vise à éliminer. La classe finale doit donc rester
// `[^()\s]*$` comme celle qui précède « https?:\/\/ » : le moindre « ) » après le début de
// l'URL invalide le match, seule une parenthèse RÉELLEMENT non refermée passe.
const OPEN_PAREN_URL_TAIL_RE = /\([^()\s]*https?:\/\/[^()\s]*$/i
function isOpenUrlTail(p, nt) {
  const trimmed = p.trimEnd()
  return OPEN_PAREN_URL_TAIL_RE.test(trimmed) && nt.length > 0 && !/\s/.test(nt)
}

// mode para : en plus des règles typographiques, deux lignes séparées par un
// interligne normal (≤ 1.6 × corps) appartiennent au même paragraphe — utilisé
// pour les blocs d'introduction, où la référence suit les paragraphes du PDF.
export function reflowLines(lines, { para = false, isGerman = false } = {}) {
  const out = []
  let lastY = null
  for (const l of lines || []) {
    const prev = out[out.length - 1]
    const gap = prev && lastY != null ? lastY - (l.y ?? 0) : null
    const sameParagraph =
      para && gap != null && gap > 0 && gap <= 1.6 * (l.size || 10) &&
      !NEW_ITEM_RE.test(l.text.trim()) && !KV_RE.test(l.text.trim())
    if (prev && isOpenUrlTail(prev.text, l.text)) {
      prev.text = `${prev.text.replace(/\s+$/, '')}${l.text.trim()}`
      prev.bold = prev.bold || l.bold
      prev.parts = undefined
      lastY = l.y ?? lastY
      continue
    }
    // COPYRIGHT_HEAD_RE en condition NÉGATIVE du `if` lui-même, pas dans shouldJoin :
    // sameParagraph (2e chemin du OU) court-circuite tous les gardes de shouldJoin —
    // cf. commentaire de COPYRIGHT_HEAD_RE (cas Cortina p.2).
    if (prev && !COPYRIGHT_HEAD_RE.test(l.text.trim()) && (shouldJoin(prev.text, l.text, isGerman) || sameParagraph)) {
      prev.text = `${prev.text.replace(/\s+$/, '')} ${l.text.trim()}`
      prev.bold = prev.bold || l.bold // une fusion garde le gras de l'une ou l'autre
      prev.parts = undefined // le texte a changé : les positions ne correspondent plus
      lastY = l.y ?? lastY
      continue
    }
    out.push({ ...l })
    lastY = l.y ?? null
  }
  return out
}

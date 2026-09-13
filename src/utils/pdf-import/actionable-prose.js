// Détection d'une prose de construction ACTIONNABLE (verbe d'action tricot/crochet) dans
// une section repliée sur kind='pelote' faute de mot-clé de titre reconnu ET SANS aucun
// rang numéroté détectable (sectionHasRowLine, segment.js — déjà couvert par la
// reclassification post-hoc palier 4). Sans ce filet, du texte qui décrit de vraies étapes
// en prose continue (ex. patrons espagnols rédigés sans "Rang N :") reste 100 % non
// cochable — clôture de campagne 40 patrons,
// bellis-purse-es-80beb715 (0 % de cochabilité, 8/8 sections).
//
// Vocabulaire fermé, MESURÉ sur un balayage de 160 PDF réels du corpus (40/langue,
// FR/EN/ES/DE — périmètre linguistique du projet), jamais inventé. Voir le plan
// d'implémentation pour la méthode complète et le détail des citations sources par verbe.

// EN — le corpus réel n'utilise quasi QUE l'impératif direct pour une instruction
// ("Cast on 18 sts...", "Sew around the hair piece..."). Recherché n'importe où dans la
// ligne (pas ancré en tête) : le mode impératif seul est un signal peu ambigu dans ce
// registre — il ne se confond pas avec la voix passive ("is worked", "worked" est un mot
// différent de "work" au sens de \b) ni avec une clause introductive/négation avant lui
// (vérifié : "...change to a smaller needle...", "don't work the bobble" matchent bien
// via une recherche non ancrée).
const EN_VERB_RE =
  /\b(?:sew|change|work|knit|purl|continue|cast|bind|pick|fold|weave|attach|increase|decrease|remove|slip|gather|embroider|fasten|connect|arrange|repeat|start|turn|join|rotate|keep)\b/i

// ES — le corpus réel n'utilise quasi QUE l'impératif tú (2e pers. sing. familier) pour
// une instruction directe ("Monta 34 puntos...", "Teje hasta que..."). Recherché n'importe
// où dans la ligne, même raison qu'EN. "cortes" (forme subjonctive figée de "cortar",
// utilisée UNIQUEMENT à la forme négative "no cortes") ajoutée explicitement — mot
// distinct de l'impératif "corta", pas une variante orthographique.
const ES_VERB_RE =
  /\b(?:teje|monta|cierra|repite|contin[uú]a|trabaja|cose|termina|haz|empieza|remata|gira|deja|coge|disminuye|distribuye|desliza|dobla|levanta|inserta|comprueba|crea|recoge|junta|corta|cortes|pon|coloca)\b/i

// ES — infinitifs de consigne, même angle mort que DE_INFINITIV_RE ci-dessous (ES_VERB_RE
// ci-dessus ne liste que l'impératif tú) : constaté sur un balayage des 111 PDF ES réels de
// hobbii+drops (corpus-web) que « tejer » (434 occ. brutes), « trabajar » (214), « repetir »
// (57) sont massivement employés à l'infinitif-consigne, jamais reconnus faute de forme
// correspondante (idem all., « teje\b » ne matche pas « tejer »).
// PIÈGE DIFFÉRENT de l'allemand — ne PAS transposer mécaniquement le même correctif :
// l'espagnol est SVO, l'infinitif-consigne se place en TÊTE de ligne (« Tejer el canesú… »,
// « Trabajar 1 pr… », « Repetir estas dos v… »), jamais en position finale de clause comme en
// allemand (V-final). Ancré en tête (même principe que FR_INFINITIF_RE ci-dessous), mesuré sur
// les lignes RÉELLEMENT REFLOWÉES (pas le texte brut pdftotext, qui confond un retour à la
// ligne de mise en page avec un vrai début de phrase — écart mesuré sur « empezar »/« terminar »)
// : tejer (38 lignes), trabajar (17), montar (14), continuar (14), coser (4), terminar (4, dont
// 2 contaminées par le futur, cf. garde ci-dessous), repetir (3), rematar (3), empezar (2).
// Vocabulaire retenu : les 9 verbes mesurés ci-dessus avec des occurrences GENUINEMENT
// actionnables (tous les échantillons relus un à un). « hacer » écarté : verbe trop générique
// (« faire »), seulement 2 occurrences réelles en tête de ligne dans tout le corpus mesuré —
// preuve insuffisante pour un verbe aussi polyvalent, risque de faux positifs non mesuré.
// Deux garde-fous, un seul mesuré nécessaire (l'autre l'est structurellement, sans coût) :
// - l'ancrage en tête de ligne suffit À LUI SEUL à écarter le substantif verbal derrière une
//   préposition/déterminant (« Al tejer las secciones… », « Para trabajar a lo largo… ») : le
//   mot qui précède l'infinitif (« Al », « Para »…) est TOUJOURS le premier mot de la ligne
//   dans le corpus mesuré, jamais élidé — contrairement à l'allemand (où l'infinitif est en
//   fin de clause, donc peut avoir n'importe quoi devant), aucune règle d'exclusion séparée
//   n'est nécessaire ici. Vérifié aussi : aucune occurrence d'infinitif-sujet en tête de ligne
//   (« Tejer es relajante », substantif elliptique) dans tout le corpus mesuré.
// - `(?![\p{L}\p{N}_])` (garde-fou déjà établi ailleurs dans ce fichier de code, cf.
//   DANGLING_FR_A_RE/GERMAN_DANGLING_UBER_RE dans reflow.js) au lieu de `\b` : `\b` seul est
//   ASCII, et « trabajar\b » matche À TORT à l'intérieur de « Trabajarás » ou « terminar\b »
//   dans « Terminarás » (le futur 2e pers. sing., pas l'infinitif) — le caractère accentué qui
//   suit forme une fausse frontière de mot en JS sans cette garde. Piège RÉEL, mesuré : deux
//   des quatre occurrences brutes de « terminar » en tête de ligne étaient en fait des futurs
//   narratifs (« Terminarás con un total de 32 vueltas… », description, pas une consigne —
//   même famille que le futur périphrastique français déjà exclu plus bas).
const ES_INFINITIVO_RE =
  /^(?:tejer|trabajar|montar|continuar|coser|terminar|repetir|rematar|empezar)(?![\p{L}\p{N}_])/imu

// FR — le corpus réel MÊLE deux registres, traités différemment :
// - infinitif-comme-consigne (majoritaire, "Tricoter jusqu'à...", "Monter 18 m...") :
//   ANCRÉ en tête de ligne OU immédiatement après un deux-points (1er mot, tolère une
//   négation "Ne " en tête, "Ne couper pas..."). La 2e position est la signature DROPS
//   FR « Après/Avant le marqueur: Crocheter… » (défauts DROPS vague 2, D1) : la consigne
//   d'augmentation/diminution y suit directement le deux-points du marqueur, jamais un
//   début de ligne. Mesure 03/09 sur le corpus drops FR : crocheter ×3, tricoter ×8,
//   augmenter ×2, répéter ×1 ; impératifs : 0 occurrence, FR_IMPERATIF_RE inchangé.
//   Sans cet ancrage, un infinitif narratif au milieu d'une phrase biographique/marketing
//   ("Nous allons travailler...", "...lui a appris à tricoter...") déclencherait à tort —
//   vérifié : aucun des 2 contre-exemples réels n'a l'infinitif en 1er mot ni derrière
//   un deux-points.
//   Garde LIGNE (premier correctif, en revue) : une clef de légende NUE devant le deux-points
//   n'arme PAS l'infinitif — liste fermée mesurée END|ENV|RS|WS, désarmée par lookbehind
//   négatif. Mesure du réviseur sur les 231 MD du rejeu + PDF bruts : toutes les lignes
//   « deux-points + verbe du vocabulaire » se partitionnent en (i) préfixe à chiffre ou
//   préfixe long → consignes réelles, (ii) clef nue END/ENV → entrées de légende de
//   diagramme (hiedra-shawl-…-fr, 6 lignes, seules formes fautives du corpus) ; ZÉRO
//   consigne réelle FR du corpus ne porte une clef nue avant le deux-points. END/ENV =
//   clefs de face des légendes de diagramme DROPS/Hobbii ; RS/WS inclus dans la liste
//   par symétrie avec le lexique du dépôt, mais seuls END/ENV sont mesurés fautifs
//   (liste fermée documentée comme telle). INFO/NOTE/ASTUCE restent ARMANTS : encarts
//   à consigne. La garde est à l'échelle LIGNE, jamais SECTION : une garde de section
//   casserait le nonreg laura-sweater (ses « RS: »/« WS: » sont des rangs cochables via
//   la clause longueur ≤220 + EN_VERB_RE non ancré, indépendants de cette branche FR —
//   une garde ligne ne peut pas les casser). Une clef PARENTHÉSÉE (« Rang 2 (ENV):
//   glisser… ») n'est pas une clef nue : la parenthèse brise le lookbehind, la consigne
//   reste armée. Lookbehind variable déjà en production dans ce fichier (DE_INFINITIV_RE
//   ci-dessous) — pas de nouveauté technique.
// - impératif vous (minoritaire, "Montez 36 m...", "Cousez les cornes...") : recherché
//   n'importe où, même raison qu'EN/ES (mode peu ambigu). "obtenez" EXCLU délibérément :
//   trouvé dans une bannière commerciale réelle (hilma-baby-blanket-fr), pas une consigne
//   de patron — seul cas du corpus mesuré où un impératif de la liste serait un faux
//   positif système, donc retiré plutôt que patché au cas par cas.
const FR_INFINITIF_RE =
  /(?:^|(?<!\b(?:END|ENV|RS|WS)\s*:\s*)(?<=:\s*))(?:ne\s+)?(?:tricoter|travailler|continuer|rabattre|couper|r[ée]p[ée]ter|monter|placer|changer|utiliser|sauter|coudre|positionner|retirer|soulever|joindre|cr[ée]er|commencer|diminuer|augmenter|marquer|laisser|garder|rembourrer|relever|recommencer|mettre|glisser|finir|essayer|connecter|bloquer|crocheter|tourner|s[ée]parer|plier|laver|arr[êe]ter)\b/i
const FR_IMPERATIF_RE = /\b(?:disposez|cousez|montez|continuez)\b/i

// DE — impératif ET infinitif confondus, recherchés n'importe où dans la ligne (contraste
// avec FR où seul l'infinitif est ancré) : la position du verbe allemand résiste
// structurellement à un ancrage fiable pour 2 raisons vérifiées sur le corpus réel —
// (a) préverbe séparable détaché en fin de ligne ("Schlage 18 M... an", radical et
// particule à ~19 mots l'un de l'autre) ; (b) verbe rejeté en toute fin de proposition
// par la négation "nicht" ou une subordonnée comparative ("das Garn NICHT abschneiden",
// "wie beim Häkeln... die Maschen abketten"). Un ancrage en tête de ligne raterait ces
// deux familles, toutes deux réelles et récurrentes (pas un artefact isolé).
const DE_VERB_RE =
  /\b(?:arbeite|wechsle|wiederhole|beginne|schneide|beachte|h[äa]kle|mache|schlage|forme|befestige|verwende|verstecke|wickle|w[äa]hle|ziehe|z[äa]hle|nimm|lege|lass|sichere|setze|schlie[ßs]e|stricke|fahre|platziere|positioniere|abschneiden|zusammenziehen|abketten)\b/i

// DE — infinitifs de consigne, angle mort mesuré sur brianza-shawl-de-7df22b4d
// (Retours-banc vague3) : DE_VERB_RE ci-dessus ne liste que des IMPÉRATIFS
// ("stricke", "wechsle"...) — plusieurs éditeurs DE rédigent pourtant leur mode
// d'emploi de diagramme à l'INFINITIF ("Nach Strickschrift in R stricken. [...]
// Mit den 8 M vor dem Rapport beginnen [...]"), jamais reconnu faute de forme
// correspondante ("stricke\b" ne matche pas "stricken", le "n" est collé).
// Vocabulaire mesuré sur un balayage des 111 PDF DE réels de hobbii+drops
// (corpus-web) : stricken/häkeln/arbeiten/wiederholen/beginnen/lesen apparaissent
// des dizaines à centaines de fois chacun en position de VERBE FINAL DE PROPOSITION
// (juste avant la ponctuation de fin de clause) — jamais en emploi narratif à cette
// position dans tout le balayage.
// Un infinitif allemand est AUSSI le substantif verbal ("das Stricken", "beim
// Häkeln", "zum Arbeiten" — même mot, majuscule au sens du substantif comme au
// sens du 1er mot de phrase, donc la casse ne distingue rien). Deux garde-fous
// mesurés sur le MÊME balayage, tous deux nécessaires (un seul laisse passer un
// faux positif réel du corpus) :
// - la ponctuation de fin de clause doit suivre IMMÉDIATEMENT (élimine la forme
//   conjuguée au pluriel "Alle häkeln unterschiedlich: manche häkeln mit einer..."
//   — cosy-dolls-conni-de/granny-shawl-jacket-de — qui n'est pas en position finale) ;
// - un déterminant ou une contraction préposition+article ne doit pas précéder
//   (der/die/das/des/dem/den/ein.../beim/vom/zum/im/am/...) : élimine "Viel Spaß
//   beim Stricken !" (pascal-unisex-slipover-de, formule de clôture réelle) où la
//   seule ponctuation aurait fait basculer une note en rang ;
// - le verbe ne doit JAMAIS être le tout premier mot de la chaîne testée
//   (`(?<!^)`) : hasActionableVerb() est aussi appelé sur un MOT SEUL par
//   segment.js (looksLikeActionTitle, `firstWord`) — sans cette garde, un
//   simple TITRE DE SECTION allemand comme "Stricken" (rencontré tel quel
//   dans brianza-shawl-de-7df22b4d, page STRICKSCHRIFT) matcherait à tort ;
//   toutes les occurrences réelles mesurées ci-dessus ont du texte AVANT le
//   verbe (jamais un mot isolé), donc aucune perte de rappel.
//
// Angle mort trouvé après coup (ellie-summer-top-de-3b3fd253, Retours-banc vague5,
// section « TRÄGER ») : « ... feste Maschen häkeln (leicht gestreckt gemessen). » —
// la ponctuation de fin de clause ne suit PAS immédiatement le verbe, une incise
// parenthétique s'intercale avant le point. Le garde-fou « ponctuation immédiate »
// (nécessaire par ailleurs, cf. « Alle häkeln unterschiedlich: » ci-dessus) ratait
// ce cas et la section entière retombait en `pelote` (aucun kind, rendu blockquote
// non cochable) faute d'autre signal. Confirmé récurrent sur le corpus
// (Retours-banc vague1/3/4/5) : « ... im 1x1-Rippenmuster arbeiten (in Hin- und
// Rückreihen). » (amulet-open-cardigan-de), « ... in Reihen häkeln (5-6 Reihen mit
// festen Maschen, mit einer gelben Reihe in der Mitte). » (stanley-the-knitting-
// bear-de, vérifié sur la ligne REFLOWÉE — la parenthèse ne se referme qu'après
// recollage des lignes PDF, jamais dans le texte brut) — même construction « verbe
// + incise parenthétique + point » à chaque fois. Vocabulaire cible RESTREINT à une
// incise TERMINALE (parenthèse suivie IMMÉDIATEMENT d'un « .», « !», « ?» ou de la
// fin de chaîne) — PAS n'importe quelle ponctuation après la parenthèse : élargir à
// « [.,;:!?] » comme pour le cas sans parenthèse laisserait passer « Alle häkeln
// (fest), manche stricken locker. », exactement la même virgule non finale que le
// garde-fou « ponctuation immédiate » exclut déjà pour la forme sans incise — la
// virgule/deux-points/point-virgule n'a jamais été observée après une incise dans
// le corpus mesuré, seul le point (ou la fin de ligne, cf. « wiederholen (50 M) »
// nu) l'a été. Une seule incise plate tolérée (pas de parenthèse imbriquée observée
// dans le corpus) ; le garde-fou déterminant reste, lui, inchangé (il porte sur ce
// qui précède le verbe, pas sur ce qui le suit).
const DE_INFINITIV_RE =
  /(?<!^)(?<!\b(?:der|die|das|des|dem|den|ein|eine|einer|einem|eines|beim|vom|zum|im|am|ans|aufs|durchs|fürs|ins|überm|unterm|vorm|hinterm)\s)\b(?:stricken|h[äa]keln|arbeiten|wiederholen|beginnen|lesen)\b(?=\s*(?:[.,;:!?]|$|\([^()]*\)\s*(?:[.!?]|$)))/i

// Premier correctif (chantier « récupération blocs Fil/Aiguilles », revue) —
// export additif au niveau LIGNE (pas section) : le filet de secours par FRAGMENT
// (reference.js) a besoin de tester une PHRASE isolée, pas une section entière. Réutilise
// EXACTEMENT les mêmes constantes que sectionHasActionableProse (vocabulaire fermé,
// mesuré, ci-dessus) — aucune regex dupliquée, aucune modification des constantes
// existantes ni de sectionHasActionableProse (qui délègue maintenant à cette fonction,
// comportement bit-identique : même trim, même garde chaîne vide, même disjonction).
export function hasActionableVerb(text) {
  const t = String(text ?? '').trim()
  if (!t) return false
  return (
    EN_VERB_RE.test(t) ||
    ES_VERB_RE.test(t) ||
    ES_INFINITIVO_RE.test(t) ||
    FR_IMPERATIF_RE.test(t) ||
    FR_INFINITIF_RE.test(t) ||
    DE_VERB_RE.test(t) ||
    DE_INFINITIV_RE.test(t)
  )
}

export function sectionHasActionableProse(sec) {
  return (sec.lines || []).some((l) => hasActionableVerb(l?.text))
}

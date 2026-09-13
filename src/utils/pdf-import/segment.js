// Segmentation par mise en page : titres = lignes courtes, gras/majuscules/grande police.
// Le kind est deviné par mots-clés MULTILINGUES (11 langues du corpus Hobbii :
// da de en es fi fr it nl no pl sv) ; les sections « référence » (matériel, fil,
// aiguilles, échantillon, abréviations, mesures) sont routées vers reference.js ;
// les sections « info » alimentent l'introduction (Présentation).
import { isKind } from '../section-kinds'
import { foldEszett } from './text-norm'
import { sectionHasActionableProse, hasActionableVerb } from './actionable-prose'
// Aide-mémoire — réutilise le détecteur d'entrée de glossaire déjà présent dans
// reference.js (ABBR_LINE_RE/execAbbrLine) plutôt que d'en écrire un second. Import direct :
// reference.js importe déjà `looksLikeTableRow` d'ICI (cycle), mais les deux usages sont
// des appels DIFFÉRÉS dans un corps de fonction (jamais évalués à l'import), donc sans effet
// de bord au chargement — vérifié empiriquement par la suite de tests complète (aucune
// régression, aucune erreur d'initialisation).
import { execAbbrLine, looksLikeBareCountDef } from './reference'
import { readColumnGlossary } from './glossary-columns'
import { isLetterSpaced, despace, restoreWords } from './spaced-title'
// sizes.js n'importe que text-norm (vérifié : /usr/bin/grep "^import"
// src/utils/pdf-import/sizes.js), donc pas de cycle NEUF ajouté par cet import (le seul
// cycle du fichier reste segment.js <-> reference.js ci-dessus, déjà vérifié inoffensif).
import { findSizeVectors, DIMENSIONAL_SIZE_TITLE_RE } from './sizes'

// Mots « seulement » des 11 langues du corpus (da de en es fi fr it nl no pl sv).
// Accolé à un mot de TAILLE, ce lookahead fait basculer le titre du tableau de
// RÉFÉRENCE vers un bloc d'INSTRUCTIONS réservé à ces tailles (cf. `mesures`).
// La liste est volontairement LARGE : un mot manquant détruit des rangs en
// silence, un mot en trop ne coûte qu'une entrée d'aide-mémoire (cf. `mesures`).
const SEULEMENT = String.raw`(?!.*\b(?:only|seulement|uniquement|nur|solo|s[óo]lo|solamente|soltanto|alleen|endast|bara|kun|bare|tylko|vain|ainoastaan)\b)`

// Encart technique DROPS « INFO CROCHET »/« INFO TRICOT » (Bug 2, campagne vague 2,
// to-the-beach-fr-c33da181) : un rappel récurrent de cette source (comment commencer/
// terminer chaque tour de brides/mailles serrées) que le patron référence explicitement
// ailleurs (« VOIR INFO CROCHET », « ne pas oublier INFO CROCHET! »). Ancrer l'alternative
// crochet de la famille `aiguilles` (cf. plus bas) l'empêche de partir vers l'extracteur de
// taille. Vague 2 : exclu AVANT le balayage de KIND_KEYWORDS (null → repli 'pelote', section
// sauvée mais NON typée). Un arbitrage (03/09) : harmonisé dans la famille `infos` ci-dessous
// — l'encart reçoit le kind dédié au lieu du null, même ancrage de titre exact.

const KIND_KEYWORDS = [
  ['abbr', /abb?r[ée]viations?|abbreviations?|abk[üu]rzungen|forkortelser|f[öo]rkortningar|lyhenteet|abreviaturas|abbreviazioni|afkortingen|skr[óo]ty/i],
  ['echantillon', /[ée]chantillon|gauge|tension\b|swatch|masch(?:en|w)probe|musterprobe|masket[æe]thed|strikkefasthed|h[æe]klefasthed|maskfasthet|stickfasthet|virkfasthet|neuletiheys|tiheys|muestra|tensi[óo]n|campione|stekenproef|proeflapje|pr[óo]bka/i],
  // « Fibra(s) » (espagnol, sous-titre matériau/composition/métrage de fil, cf. holiday-
  // ornament-es et serenity-sweater-es, corpus réel palier 6) : synonyme espagnol usuel de
  // « hilo »/« lana » pour la fibre elle-même — non classé jusqu'ici.
  ['fil', /\bfil\b|\blaine\b|\byarn\b|\bwool\b|\bgarn(?:et)?\b|\bgaren\b|\blanka\b|\blangat\b|\bhilo\b|\blana\b|\bfibras?\b|\bfilato\b|w[łl][óo]czka|garenkwaliteit|garnkvalit\w*|garnqualit\w*|lankalaatu|calidad de(?:l| los) hilos?|qualit[àé] de[il] filat[oi]|qualit[ée]s? d(?:u|es) fils?/i],
  // « crochet\s*(?::|n[°o]|\d) » ANCRÉ EN TÊTE (Bug 2, campagne vague 2, to-the-beach-fr-
  // c33da181) : cette alternative reconnaît l'annonce de taille de crochet écrite en un mot
  // nu (« Crochet 6 mm », « Crochet : 6 mm », « CROCHET: » suivi de « CROCHET DROPS n° 6 »
  // en ligne suivante) — le seul mot « crochet » n'est PAS dans le reste de l'alternance
  // (contrairement à « ganchillo »/« uncinetto »/« hooks? » des autres langues), car bare il
  // collisionnerait avec le verbe/nom très fréquent en milieu de phrase de travail.
  // Non ancrée, elle matchait aussi « INFO CROCHET: », encart technique récurrent des
  // patrons DROPS (comment commencer/terminer chaque tour de brides/mailles serrées, PAS une
  // taille de crochet) : la section partait vers l'extracteur de taille d'aiguille (qui n'y
  // trouve aucune taille) et ses phrases retombaient en puces anonymes dans ## Matériel, alors
  // que le patron y renvoie explicitement (« VOIR INFO CROCHET », « ne pas oublier INFO
  // CROCHET! »). Sondage sur 10 PDF DROPS fr (corpus-web/drops) : le même encart apparaît dans
  // 3/10 (back-to-the-beach, blueberry-picking, to-the-beach) — défaut structurel de cette
  // source (~110 PDF du corpus). L'ancre `^` règle la collision SANS toucher la reconnaissance
  // légitime : un vrai titre de taille commence TOUJOURS par le mot crochet lui-même
  // (« Crochet 6 mm », « CROCHET: »), jamais précédé de « INFO »/« ASTUCE ». Vérifié sur les 10
  // PDF : aucune annonce de taille légitime du corpus n'est précédée d'un préfixe (le format
  // fréquent « CROCHET DROPS n° 6 » ne matchait déjà PAS cette alternative avant ce correctif —
  // "DROPS" s'intercale entre "crochet" et "n°" — donc rien d'ancien ne dépendait de matcher un
  // « crochet » non initial).
  ['aiguilles', /aiguilles?|needles?|\bhooks?\b|nadel(?:n)?\b|stricknadeln?|h[äa]kelnadel|strikkepinde|\bpinde\b|h[æe]klen[åa]l|\bn[åa]l(?:er)?\b|stickor|virkn[åa]l|puikot|virkkuukoukku|\bkoukku\b|agujas?|ganchillo|\bferri\b|uncinetto|naalden|breinaald|haaknaald|druty|szyde[łl]ko|^crochet\s*(?::|n[°o]|\d)/i],
  // « Notions » (EN, mercerie du patron : marqueurs, aiguille à laine, arrête-mailles) —
  // Aide-mémoire, Juice_Sweater_by_Kutovakika (corpus réel) : la section « NOTIONS »
  // (16 marqueurs) n'était routée vers AUCUNE rubrique référence, son contenu (le vrai
  // matériel du patron) n'atteignait jamais le bloc Matériel. Même famille lexicale ajoutée
  // pour le périmètre linguistique du projet (FR/EN/ES/DE) : « mercerie » (FR,
  // déjà le vocabulaire de l'app elle-même — src/constants/sample-patterns.js, onglet
  // « Fils, aiguilles & mercerie »), « haberdashery » (EN, synonyme usuel de « notions »),
  // « mercería »/« mercerías » (ES), « Kurzwaren » (DE).
  ['materiel', /mat[ée]riel|fournitures?|materials?|supplies|material(?:ien|er|en)?\b|materiaal\b|materiaalit|tarvikkeet|materiales|materiali|materia[łl]y|benodigdheden|akcesoria|verbrauch|\bnotions?\b|\bmercerie\b|\bhaberdashery\b|\bmercer[ií]as?\b|\bkurzwaren\b/i],
  // Deux familles de mots, deux traitements — la distinction porte tout le kind :
  //  - mots de MESURE (« Mesures », « Measurements », « Maße ») : ils annoncent des
  //    COTES, jamais du travail → jamais gardés. « Measurements (finished garment
  //    only) » reste donc un tableau de mesures.
  //  - mots de TAILLE (« Tailles », « Sizes », « Tallas »…) : ambigus. Ils ouvrent le
  //    tableau de référence, MAIS aussi le titre d'un bloc d'INSTRUCTIONS réservé à
  //    certaines tailles (« Sizes 1 and 4 only: ») → gardés par SEULEMENT.
  // Sans ce garde, le bloc est classé ref='mesures' et jeté EN BLOC par assemble.js
  // (filtre `!s.ref`) : 14 sections, ~189 lignes de rangs détruites en silence sur Mia
  // Cardigan. Le garde couvre les 11 langues : le limiter aux mots ANCRÉS (en/fr/de)
  // laissait « Tallas 1 y 4 solo », « Storlekar 1 och 4 endast »… détruire leur contenu.
  // Deux groupes de taille, car l'ancre « ^ » n'est PAS uniforme (comportement d'origine) :
  //  - tailles/sizes/größen sont ancrés : sinon « TAILLE ET JUPE » (section de travail,
  //    waist + jupe) tomberait dans ## Tailles avec ses rangs porteurs de vecteurs de
  //    tailles — d'où le second garde « (?!\s+et\b) » (cf. boble-joy-children-s-skirt) ;
  //  - les autres restent non ancrés : « Tabla de tallas » doit rester un tableau.
  ['mesures', new RegExp(
    // « (Ab)?messungen\b » (allemand, synonyme usuel de « Maße » pour les cotes de l'ouvrage
    // fini, ex. « Abmessungen : Durchmesser ca. 10 cm ») : ma(?:ß|ss)e\b, plus haut dans cette
    // même alternance, ne le couvre PAS — « Abmessungen » ne contient PAS la sous-chaîne
    // « Maße »/« Masse » (préfixe « Ab- » + racine « -messungen », pas « -maße »). Cas réel
    // snowman-coaster-de-623a0c1d : sans cette entrée, la section titrée « ABMESSUNGEN »
    // (une seule cote, « Durchmesser ca. 10 cm ohne Hut ») n'est classée dans AUCUNE des deux
    // familles ('mesures' ni 'tailles') et reste une section générique à part, au lieu de
    // rejoindre le même tableau Tailles que la section « GRÖSSE » adjacente. Non ancrée,
    // comme le reste de ce groupe non-SEULEMENT : « Abmessungen » n'a pas l'ambiguïté
    // travail/référence des mots de TAILLE (cf. commentaire au-dessus sur SEULEMENT).
    String.raw`mesures?|measurements?|dimensions?|ma(?:ß|ss)e\b|\b(?:ab)?messungen\b|\bm[åa]l\b|\bm[åa]tt\b|mitat|medidas|misure|afmetingen|wymiary`
    + String.raw`|^(?:tailles?\b(?!\s+et\b)|sizes?\b|gr[öo](?:ß|ss)en?\b)` + SEULEMENT
    + String.raw`|(?:st[øo]rrelser?|storlek(?:ar)?|\bkoot\b|tallas?|tama[ñn]os?|taglie|taglia|\bmaten\b|\bmaat\b|rozmiar(?:y)?)` + SEULEMENT,
    'i')],
  // Explications de TECHNIQUE (maille spéciale, montage, assemblage particulier) : titre
  // « Techniques », « Comment faire/crocheter … », « Astuces/Conseils/Tips POUR … » —
  // routée vers reference.js (bug journalisé 4 fois : « ASTUCES
  // POUR RÉALISER LES AUGMENTATIONS/DIMINUTIONS » (Barley Field) perdait titre+structure,
  // diluée en Présentation faute de famille dédiée). Testée AVANT `info` : les mots
  // d'astuce/conseil/tips y sont DÉJÀ présents (nus), pour les rubriques d'AIDE GÉNÉRALE
  // homonymes — « INFO AND TIPS »/« INFO ET CONSEILS »/« INFO UND TIPPS »/« INFO EN TIPS »
  // (4 langues du gate 25-refs : Decorative Pumpkins EN, Soft Twist Mittens FR, Penny the
  // Panda DE, Easter Egg NO/ainsa-bandana NL) sont gate-VALIDÉES vers `info` (oracle
  // {other}, jamais {techniques}), tout comme « Wskazówka » (PL).
  // On ne route donc PAS ces mots NUS : ici, ils ne comptent QUE liés à un complément
  // d'action (« pour »/« for »/« für »/…) — seule une VRAIE explication de technique
  // (« Astuces POUR réaliser… ») les porte ainsi ; une rubrique d'aide générale ne le fait
  // jamais dans le corpus mesuré. Le mot « techniques » lui-même, en revanche, est toujours
  // sûr NU (Lotus Bag EN, gate) ; de même « comment/hoe/cómo + verbe » (Soft Twist Mittens
  // FR « Comment faire le croisement »/« Comment crocheter un point étoile », ainsa-bandana
  // NL « Hoe haak je 4-stokjes-samen »).
  ['techniques', new RegExp(
    String.raw`\btechniques?\b|\btechniken\b|tecnich[ei]\b|t[ée]cnicas?\b|technieken\b|teknik(?:er|ker)?\b`
    + String.raw`|\bcomment\s+\w+|\bhoe\s+\w+|\bc[óo]mo\s+\w+|\bhow\s*to\b|\bcome fare\b`
    + String.raw`|(?:astuces?|conseils?|tips?|tipps|consejos?|suggerimenti|trucs?|tricks?|trucos?)\s+(?:pour|for|f[üu]r|zum|para|per|voor)\b`
    + String.raw`|points?\s+utilis[ée]s?|stitches?\s+used|puntos?\s+utilizados?|punti\s+utilizzati|gebruikte\s+steken|verwendete\s+maschen`
    // D4 (défauts DROPS vague 2) : titres de sections « AUGMENTATIONS »/« DIMINUTIONS »
    // nus ou suffixés — des explications de COMMENT augmenter/diminuer, pas du travail
    // en rangs : l'oracle de référence (to-the-beach-fr, l.32-46) place
    // « ### AUGMENTATIONS » sous « ## Techniques {techniques} ». Attestations mesurées
    // (corpus-web/drops) : « AUGMENTATIONS-2 (à intervalles réguliers): »,
    // « AUGMENTATIONS EMMANCHURE: », « ZUNAHMEN FÜR DEN HALSAUSSCHNITT: »,
    // « DIMINUZIONI PER IL TALLONE (lavorate a maglia rasata): ». La borne `.{0,44}`
    // écarte les lignes de CORPS homonymes (contre-exemples mesurés : « augmentations
    // pour les emmanchures sont terminées, on a 98-106-114-114-122-136-148 mailles.
    // Arrêter », « AUMENTI e RICORDARSI DI MANTENERE LA CORRETTA TENSIONE DEL LAVORO!
    // Terminati gli aumenti, ci », « Zunahmen für die Armausschnitt weiterarbeiten,
    // wie folgt stricken: » — complément de 58 à 86 car., jamais ≤ 44 ; le plus long
    // complément LÉGITIME observé : « DIMINUZIONI PER IL TALLONE (lavorate a maglia
    // rasata): » à 43 car.). L'alternative EN « increase(s) for » EXIGE « for » pour ne
    // pas voler « INCREASE TIP-1: »/« DECREASE TIP » à `infos` —
    // attestations « INCREASE FOR NECKLINE: »/« INCREASE FOR ARMHOLE: » ; « INCREASE
    // 1 STITCH TOWARDS LEFT – from RIGHT SIDE: » (corpus réel) ne matche pas.
    + String.raw`|^(?:augmentations?|diminutions?|aumenti|diminuzioni|zunahmen|abnahmen)\b.{0,44}$`
    + String.raw`|^increas(?:es?)?\s+for\b`,
    'i',
  )],
  // Un arbitrage (vague 7, tranché le 03/09, option 1) : rubriques de SERVICE/CONSEILS
  // des 4 langues du périmètre → kind dédié
  // `infos`. La rubrique RESTE une section consultable du flux : `infos` n'est ni dans
  // REF_KEYS (jamais l'aide-mémoire), ni dans INTRO_KEYS (jamais la Présentation), ni dans
  // NOISE_KEYS — le corps du patron y renvoie (« HÄKELINFORMATION lesen », back-to-the-beach-
  // de-9b230bc0 ; « VOIR INFO CROCHET », vague 2), le renvoi doit aboutir. Jusqu'ici ces
  // titres étaient happés par la famille `info` (fondu dans la Présentation : INFORMACIÓN Y
  // CONSEJOS, INFO UND TIPPS, HÄKELINFORMATION — « information » en sous-chaîne SANS
  // frontière de tête, le composé allemand matchait déjà) ou retombaient en kind='pelote'
  // (titre nu dans le MD : HÄKELTIPP, ZUNAHMETIPP, ATENCIÓN, KURZBESCHREIBUNG).
  // Position ENTRE `techniques` et `info`, la seule correcte des deux côtés :
  //  - APRÈS `techniques` : une explication de technique (« ASTUCES POUR RÉALISER LES
  //    AUGMENTATIONS », « CONSEJOS PARA AUMENTOS ») garde son routage référence — les mots
  //    d'astuce/conseil y comptent déjà, liés à un complément d'action ;
  //  - AVANT `info` : reprend à `info` tout ce qui porte un complément conseils/astuces
  //    (ET CONSEILS, AND TIPS, UND TIPPS, Y CONSEJOS) ou un mot de technique composé
  //    (HÄKELINFORMATION, INCREASE TIP, ZUNAHMETIPP).
  // Restent VOLONTAIREMENT à `info` (→ Présentation) : les « information SUR le patron »
  // sans complément conseils (INFORMATION SUR LE TUTORIEL, INFORMATION ZUR ANLEITUNG,
  // INFORMACIÓN SOBRE EL PATRÓN — hors périmètre de l'arbitrage) et le mot « Tips » NU
  // (ambigu, gate easter-egg-no). L'exclusion vague 2 (INFO_CRAFT_INSERT_RE → null) est
  // REPLIÉE ICI : « INFO CROCHET »/« INFO TRICOT » (titre exact) rejoignent la famille ;
  // l'ancre `^crochet` de `aiguilles` ci-dessus n'entre pas en collision (jamais de
  // préfixe devant une vraie annonce de taille, cf. son propre commentaire).
  // Ancrages, calqués sur les garde-fous du reste du tableau : « ATENCIÓN » et « TIPP(S) »
  // nus = titres ENTIERS (un mot noyé dans un titre de travail — « Puntos de atención » —
  // ne matche pas) ; les formes DROPS suffixées gardent leur complément APRÈS le mot-clé
  // (« INCREASE TIP », « ZUNAHMETIPP-2 (gleichmäßig verteilt) », « NETZ - KURZBESCHREIBUNG
  // DER ARBEIT ») : le préfixe DROPS (increase/decrease/zunahme/abnahme/häkel/strick) borne
  // déjà le risque côté titres de travail, vérifié contre le corpus mesuré.
  ['infos', new RegExp(
    // FR : encart technique DROPS (vague 2, harmonisé) + « … ET CONSEILS/ASTUCES ».
    // « ASTUCE CROCHET » (D4, vague 2) : jumeau sémantique de « INFO CROCHET » (même
    // encart « comment commencer/terminer un tour », attestations sunny-daze-fr l.23 /
    // back-to-the-beach-fr l.65 :
    // « ASTUCE CROCHET », « ASTUCE CROCHET (pour les mailles en l'air): ») — même
    // arbitrage, même kind dédié. L'exigence `astuces?\s+crochet` (et pas `astuces?\s+pour`)
    // ne vole rien à `techniques` : « ASTUCES POUR RÉALISER… » garde son complément
    // d'action (« crochet » s'intercale avant « pour » dans « ASTUCE CROCHET (pour… »).
    String.raw`^astuces?\s+crochet\b`
    + String.raw`|^info(?:rmation)?\s+(?:crochet|tricot)\b`
    + String.raw`|^infos?(?:rmations?)?\s+et\s+(?:conseils?|astuces?)\b`
    // EN : « INFO AND TIPS », encarts suffixés DROPS « INCREASE/DECREASE TIP »,
    // « CROCHET/KNITTING INFORMATION »
    + String.raw`|^info(?:rmation)?\s+and\s+tips?\b`
    + String.raw`|(?:increase|decrease)\s+tips?\b|(?:crochet|knitting)\s+information\b`
    // DE : « INFO/INFOS/INFORMATIONEN UND TIPPS », composés « HÄKEL-/STRICKINFORMATION »,
    // « ZUNAHME-/ABNAHME-/HÄKEL-/STRICK-TIPP », « TIPP(S) » nu,
    // « …-KURZBESCHREIBUNG DER ARBEIT » (spring-catch/top/stola/netz)
    + String.raw`|^infos?(?:rmationen)?\s+und\s+tipps?\b`
    + String.raw`|h[äa]kelinformation(?:en)?\b|strickinformation(?:en)?\b`
    + String.raw`|(?:zunahme|abnahme|h[äa]kel|strick)-?tipps?\b|^tipps?\b|kurzbeschreibung\b`
    // ES : « INFORMACIÓN/INFO Y CONSEJOS » (hooked-on-you), « ATENCIÓN » (bird-nest)
    + String.raw`|^info(?:rmaci[óo]n)?\s+y\s+consejos?\b|^[¡!]?\s*atenci[óo]n\s*[!:.]?\s*$`,
    'i')],
  ['info', /informations?\b|\binfo\b|about (?:the|this) pattern|zur anleitung|om (?:opskriften|m[øo]nster(?:et)?|m[öo]nstret)|informaci[óo]n|informazioni|informatie|informacje|tieto[aj]a?|acerca de|wskaz[óo]wk[ai]|porady|\btips?\b|tipps\b|astuces|consejos|suggerimenti|vinkit|gode r[åa]d/i],
  ['noise', /\bdudas\b|preguntas|questions?\b|sp[øo]rgsm[åa]l|fragen\b|\bhilfe\b|support|kundenservice|customer service|contact(?:o|s|ez)?\b|contatti|kontakt\b|yhteys|hj[äa]lp|hjelp|pomoc\b|vragen\b|klantenservice|besoin d'aide|domande|kysymyksi[äa]|fr[åa]gor/i],
  // « esquemas? » (espagnol, vague 7 : primula-bloomers-es, section « Esquema » perdue alors
  // que le corps du patron y renvoie 6 fois). « diagram(?:mets?|s)?\b » (vague 7,
  // owen-stoat-en) : l'ancienne « diagram(?:met)?\b » ne matchait PAS le pluriel anglais
  // « diagrams » — \b exige une frontière de mot, or entre « m » et « s » les deux sont des
  // caractères de mot ; « mets? » couvre le suédois fléchi (diagrammet/diagrammets).
  ['diagramme', /diagramme?s?|charts?|grilles?|diagramm\b|z[äa]hlmuster|diagram(?:mets?|s)?\b|kaavio|gr[áa]fico|schema\b|esquemas?|telpatroon|wykres/i],
  // `[äa]rmar` → `ärmar` (même classe de défaut latent que tete/membre, vague 6) : le « a » nu
  // ne matchait AUCUN mot de manche des 11 langues du corpus (sv = ärmar, da/no = ærme/ærmer,
  // de = Arm/Ärmel) et servait uniquement le verbe espagnol « armar » (assembler) — un titre
  // « ARMAR » partait en {sleeve}. Le ä seul suffit : foldEszett ne touche pas aux trémas, et
  // PAS d'ancre finale — les formes fléchies suédoises (« Ärmarna ») doivent rester couvertes.
  ['manche', /manches?|sleeves?|[äa]rmel|[æe]rmer?\b|mangas?|maniche|mouwen|r[ęe]kawy?|hihat?|ärmar/i],
  // « Escote » (espagnol, synonyme usuel de « cuello » pour l'encolure — holiday-ornament-es/
  // serenity-sweater-es, corpus réel palier 6) non classé jusqu'ici.
  ['encolure', /encolure|\bcol\b|neck(?:band|line)?|collar\b|capuche|hood|halsausschnitt|halskante?|kraven?\b|halskant|cuello|escote|scollo|collo\b|colletto|\bhals\b|halsboord|halsopening|ko[łl]nierz|kaula-?aukko|p[ää]ntie|krage/i],
  // finitions AVANT bordure : un titre d'assemblage (« Montering en boorden ») contient
  // aussi un mot de bordure (« boorden ») ; le premier match l'emportant, finitions doit
  // être testé d'abord pour ne pas être volé par bordure.
  // « Unión »/« Union » (assemblage, espagnol) ajouté aux côtés de « montaje ». « Asemblaje »
  // (orthographe fautive du PDF pour « ensamblaje », corpus réel palier 6, serenity-sweater-
  // es-f1e18764 : titre RÉEL « ASEMBLAJE », confirmé {finishing} par l'oracle de
  // référence) — préfixe optionnel « en »/« a » + voyelle variable [ae] pour couvrir la forme
  // correcte ET la coquille observée en une seule alternative, plutôt que lister les deux
  // variantes en dur.
  // « fertigstellung » (nom) élargi en « fertig\s*stell\w* » (palier 7) : couvre AUSSI la
  // forme verbale/impérative « fertigstellen »/« FERTIGSTELLEN » (titre RÉEL du PDF corpus
  // peonie-flower-de-bc2e2ed0, section de finition couper/coller/enrouler le fil — seul
  // « Fertigstellung » nominal matchait jusqu'ici) et la variante espacée « fertig stellen ».
  // Aucune collision trouvée dans le corpus mesuré (« fertig » n'apparaît ailleurs qu'en
  // milieu de longue phrase — « … fertig stricken … », « … ist fertig. » — jamais comme titre
  // court, seul terrain où kindForTitle est invoqué).
  // « Finish » nu (EN, PDF réel Mia Cardigan) : ancré titre ENTIER (`^…$`), jamais en
  // sous-chaîne — « finish » est un mot anglais très fréquent en milieu de rang
  // (« finish the row », « in the already established pattern »), une frontière de mot
  // seule laisserait n'importe quelle phrase de travail basculer en finitions.
  // « zusammenfügen » (allemand, assembler — vague 7 : bernadette-tote-bag, titre réel
  // « ZUSAMMENFÜGEN » routé {other} alors que « zusammennähen » est couvert juste à côté).
  ['finitions', /finitions?|finishing|assembl(?:age|y)|blocage|blocking|couture|seam|fertig\s*stell\w*|zusammenn[äa]hen|zusammenf[üu]gen|ausarbeit\w*|montering|a[fv]slutning|afwerken|afhechten|samling|kokoaminen|viimeistely|montaje|\buni[óo]n\b|\b(?:en|a)s[ae]mblaje\b|confecci[óo]n|acabados?|rifiniture|assemblaggio|cucitura|afwerking|in elkaar zetten|wyko[ńn]czenie|monta[żz]|^\s*finish\s*$/i],
  // « Rand » (allemand/néerlandais, bord/bordure) est un mot COURT et courant qui
  // apparaît aussi en sous-chaîne d'artefacts de segmentation (rangée de tableau de
  // mesures mal détectée en titre, ex. « C Rand* 2 cm » = point C, 2 cm, une FOIS le
  // tableau reconstitué — cf. gate ainsa-bandana-nl). Ancré ^…$ (titre ENTIER, pas
  // sous-chaîne) pour ne capturer que le vrai titre de section (« Rand », « RAND »),
  // jamais une rangée de tableau qui le contient.
  // « bund\b » (allemand, bord-côtes — palier 7) ajouté à côté du diminutif « bündchen » déjà
  // couvert : sans frontière de mot EN TÊTE (contrairement à « ^rand$ » ci-dessus), pour
  // matcher aussi bien « Bund » isolé qu'un COMPOSÉ COLLÉ, forme réelle du corpus
  // (« RIPPENBUND », PDF ydun-hat-de-c7811f90 — bord-côtes du bonnet, aucun espace entre
  // « Rippen » et « Bund »). Frontière de mot en FIN seule (\b après « bund ») : vérifié sur
  // le corpus mesuré que « verbunden »/« gebunden » (formes verbales très courantes,
  // « joint(e) », jamais en titre court) ne matchent PAS (le « d » de « bund » y est suivi de
  // « en », donc d'un caractère de mot — pas de frontière). Seul « Verbund » (nom, « réseau/
  // association ») matcherait s'il apparaissait un jour comme TITRE nu — aucune occurrence de
  // ce cas trouvée dans le corpus mesuré (25 réf. gate + PDF déjà traités).
  // « Button Band » (EN, PDF réel Mia Cardigan) : une bande boutonnée est une bordure
  // (bande rapportée sur un bord), pas une boutonnière (le trou lui-même) — testée
  // AVANT `boutonniere` ci-dessous, qui NE porte plus cette alternative (sinon
  // `button\s*band` y volerait le match, `boutonniere` étant testé après `bordure`
  // ici mais l'ordre inverse ailleurs dans le fichier serait fragile à un futur
  // réarrangement de KIND_KEYWORDS).
  // « hems? » ancré par frontières UNICODE explicites (vague 7 : amelia-colourwork-vest-en,
  // « SCHEMATIC » contient « hem » en sous-chaîne → section de schéma routée {border}) :
  // sans aucune frontière, l'alternative matchait n'importe où ; \p{L} (flag `u`) exige
  // « pas de lettre » de part et d'autre, comme « tails » de la famille queue ci-dessous.
  ['bordure', /bordures?|borders?|\bbordes?\b|ourlets?|(?<![\p{L}])hems?(?![\p{L}])|poignets?|cuffs?|ceinture|waistband|b[üu]ndchen|bund\b|blende|ribkant|kant(?:en)?\b|^rand$|el[áa]stico|bordo|orlo|boord(?:en)?\b|[śs]ci[ąa]gacz|resori|mudd(?:ar)?|linning|\bbutton\s*band\b/iu],
  ['boutonniere', /boutonni[èe]res?|buttonholes?|boutonnage|knopfloch|knaphul|ojales?|asole|knoopsgat|dziurki|napinl[äa]vet|knapph[åa]l/i],
  // Nom d'un VÊTEMENT entier (jupe, robe, pull…) = la pièce principale = corps. Ces
  // titres sont des sections de TRAVAIL (rendus en rangs cochables) : sans eux, un
  // titre comme « TAILLE ET JUPE » retombait en `pelote` (kind non-travail) et son
  // corps se sérialisait en notes `>` au lieu de rangs `-` (cf. boble-joy).
  // « Cuerpo(s) » (espagnol) ajouté ici (campagne vague 6, norma-jeane-halter-top-es-
  // 99b86539, corpus réel) : le mot vivait jusqu'ici SEULEMENT dans `corpsrond`
  // ci-dessous (famille amigurumi) — un titre « CUERPO » de patron VÊTEMENT (top, pull,
  // robe…) était donc classé à tort amigurumi. Sondage sur les PDF ES du corpus
  // (Retours-banc vague3+vague6) : 7 occurrences de titre « CUERPO » nu, dont 6 sur des
  // VÊTEMENTS (tidepool-tee, candy-cane-stripes-sweater, maddy-top, norma-jeane,
  // spring-falls-cardigan…) contre 1 seule en amigurumi (spring-birds-es, oiseau en
  // crochet à rembourrer — CABEZA/COLA en sections sœurs). `corps` est testé EN PREMIER
  // dans ce tableau, donc gagne cette ambiguïté par défaut ; le cas amigurumi minoritaire
  // est repêché par une reclassification post-hoc ciblée en fin de segmentSections
  // (recherche d'un titre « Cuerpo » nu accompagné d'une VRAIE section sœur anatomique
  // d'amigurumi — tête/museau/queue/oreille/membre — dans le même document), plutôt que
  // par un second mot-clé ici qui rouvrirait la même collision en sens inverse.
  // Vague 7 : « shawls? » (lemon-heart, « ## SHAWL » → {other}), « canes[úu] » (cella,
  // « ## CANESÚ », empiècement espagnol), « rumpfteil » (sunflower, aux côtés de
  // rückenteil/vorderteil déjà couverts), « devants? » élargi au pluriel (very-granny,
  // « ## DEVANTS » resté sans kind alors que le singulier existait).
  ['corps', /\bcorps\b|\bbody\b|\bdos\b|\bderri[èe]re\b|\bback\b|\bdevants?\b|\bfront\b|empi[èe]cement|canes[úu]|\byoke\b|\bpasse\b|r[üu]cken(?:teil)?|rumpfteil|vorderteil|\bryg\b|forstykke|bagstykke|espalda|delantero|trasero|dietro|davanti|\bmaglione\b|\brug\b|voorpand|achterpand|\brugpand\b|\barmsgat\b|ty[łl]\b|prz[óo]d|takakappale|etukappale|bakstycke|framstycke|b[æä]restycke|b[æä]restykke|\boket\b|jupes?|skirts?|shawls?|\brock\b|nederdel(?:en)?|kjol(?:en|e)?|kjole|robes?|dress(?:es)?|falda|gonna|jurk|\brok\b|sp[óo]dnic\w*|hame(?:et)?|kl[äa]nning|vestido|sukienk\w*|\bcuerpos?\b/i],
  // Ancrages \b ajoutés partout (défaut latent campagne vague 6, « zéro occurrence dans le
  // corpus ») : l'alternative « cabeza » sans frontière de TÊTE matchait l'intérieur
  // d'« enCABEZAdo » (ES « encabezado » = en-tête) — un tel titre basculait en `tete` et
  // armait le repêchage hasAmigurumiSibling. « cabezas? » : le pluriel ES, matché par
  // l'ancienne forme en sous-chaîne, reste couvert (convention `brazos?`/`piernas?`).
  ['tete', /\bt[êe]tes?\b|\bheads?\b|\bkopf\b|\bhoved(?:et)?\b|\bcabezas?\b|\btesta\b|\bhoofd\b|\bg[łl]owa\b|\bp[ää][äa]?\b|\bhuvud(?:et)?\b/i],
  // « Tripa » (espagnol, ventre) : pièce ronde d'amigurumi cousue sur le corps (Hilda
  // the Horse) — même nature que « krop », d'où le rattachement à cette famille plutôt
  // qu'à `corps` (réservée aux pièces de VÊTEMENT).
  // « cuerpo » RETIRÉ d'ici (campagne vague 6, cf. commentaire `corps` ci-dessus) : listé
  // ici, il ne matchait jamais de toute façon (`corps`, testé avant, l'aurait déjà
  // absorbé) — sa présence n'était qu'un vestige trompeur. Le cas amigurumi minoritaire
  // (spring-birds-es) est repêché par contexte en fin de segmentSections, pas ici.
  ['corpsrond', /k[öo]rper\b|\bkrop(?:pen)?\b|\bcorpo\b|lichaam|cia[łl]o|tu[łl][óo]w|vartalo|\bkropp(?:en)?\b|\blijf\b|\btripa\b/i],
  // Ancrages partout (défaut latent campagne vague 6, zéro occurrence mesurée) + alternative
  // islandaise « ar » (pluriel de « bras ») RETIRÉE : le corpus Hobbii n'a pas d'islandais
  // (11 langues : da,de,en,es,fr,it,nl,no,pl,sv,fi) et « arm(?:ar)? » sans frontière de tête
  // matchait le verbe ES « ARMAR » (assembler) ou « ALARME »/« alARME » en sous-chaîne —
  // mauvais kind de section ET repêchage hasAmigurumiSibling. Le même « ARMAR » était aussi
  // attrapé par `[äa]rmar` de `manche` ci-dessus, restreint à `ärmar` dans le même lot.
  // « [łl]apki » ancré par lookaround Unicode et PAS \b : « Ł » n'est pas un caractère de
  // mot pour \b, un ancrage `\b` ne matcherait plus jamais « Łapki » en tête de chaîne
  // (cf. le cas « øre » documenté sur `oreille`, et « tails »/`hem` pour le même correctif).
  ['membre', /\bjambes?\b|\blegs?\b|\bbras\b|\barms?\b|\bpattes?\b|\bpaws?\b|\bbeine?\b|\barme?\b|\barm(?:e|er)?\b|\bben\b|\bpiernas?\b|\bbrazos?\b|\bgambe\b|\bbraccia\b|\bbenen\b|\barmen\b|\bnogi\b|\br[ęe]ce\b|\bskrzyd[łl]a\b|(?<![\p{L}])[łl]apki\b|\bjalat\b|\bk[äa]det\b|\btassar\b|\bpoter\b/iu],
  // « [øo]rer?\b » scindé en deux branches (campagne vague 5, explorer-hat-en-532723fb,
  // corpus réel) : la branche ASCII nue « orer?\b » n'avait qu'une frontière de mot EN FIN,
  // pas en tête — elle matchait donc en sous-chaîne la fin de n'importe quel mot anglais
  // fréquent terminé par « -ore »/« -orer » (« Explorer », mais aussi « before », « store »,
  // « score », « adore » auraient fait basculer un titre entier vers `oreille`). Le titre nu
  // « Explorer » (page de garde, nom du patron) tombait ainsi à tort en section {ear} avec
  // « Hat » comme corps. Ancrée `\borer?\b`, cette branche ne capture plus qu'un MOT ASCII
  // isolé (« ORER » nu, hypothétique) — aucune occurrence, légitime ou non, trouvée dans le
  // corpus mesuré (67 PDF, vagues 1/3/4/5) hors ce faux positif. La branche « ø » (danoise/
  // norvégienne « øre »/« ører », ears) reste NON ancrée — mais PAS parce qu'elle serait à
  // l'abri du même risque de sous-chaîne : elle y est exposée À L'IDENTIQUE (vérifié :
  // `/ører?\b/i.test('Stører')` → true, exactement le bug corrigé côté ASCII), simplement
  // jamais observée dans le corpus mesuré (0 occurrence de « ø »), donc ni confirmée ni
  // infirmée par les tests. La vraie raison de ne PAS ancrer est différente : `\b` marque
  // toute transition \w/\W, et « ø » est lui-même hors de `\w` (= [A-Za-z0-9_] seul) — une
  // lettre ASCII immédiatement suivie de « ø » (« Stører ») crée déjà cette transition
  // QUELLE QUE SOIT la présence d'un ancrage explicite, donc ancrer ne bloquerait PAS ce
  // risque. En revanche ancrer CASSERAIT le cas légitime en tête de chaîne (« Ører »/
  // « ØRER ») : là, la transition est \W→\W (début de chaîne, puis « ø » non-mot), donc
  // AUCUNE frontière — `\bører?\b` ne matcherait alors plus jamais en tête (vérifié :
  // `/\bører?\b/i.test('Ører')` → false). Ancrer supprimerait donc en silence la détection
  // danoise/norvégienne sans neutraliser le risque de sous-chaîne. Risque restant OUVERT
  // sur cette branche, à surveiller si un patron DA/NO fait apparaître ce motif.
  // Note (préexistant, hors périmètre de ce correctif) : `ohren?\b` juste en dessous partage
  // la même classe de vulnérabilité EN FIN de mot (« Bohren » matche) — non touché ici.
  ['oreille', /oreilles?|\bears?\b|ohren?\b|ører?\b|\borer?\b|orejas?|orecchie|\boren\b|uszy|korvat|[öo]ron/i],
  ['museau', /museau|muzzle|snout|schnauze|snude\b|hocico|\bmuso\b|snuit|pysk|kuono|\bnos\b/i],
  // « tails » ancré par frontières UNICODE explicites (vague 7 : boo-the-bat-fr, « Ajouter
  // les détails » routé {tail}) : \b de JS est aveugle hors ASCII — « é » n'est pas un
  // caractère de mot, donc \b voyait une frontière entre « é » et « t » de « détails »
  // (angle mort Unicode déjà documenté deux fois dans reflow.js). \p{L} (flag `u`) exige
  // « pas de lettre » autour, même famille de correctif que « hem » de la famille bordure.
  ['queue', /\bqueues?\b|(?<![\p{L}])tails?(?![\p{L}])|schwanz|\bhale(?:n)?\b|\bcola\b|\bcoda\b|staart|ogon|[żz][ąa]d[łl]o|h[äa]nt[äa]|svans/iu],
  // « Crin » (espagnol, crinière du cheval amigurumi, Hilda the Horse) : 3 pièces de
  // texture (mèches en chaînettes) cousues sur la tête, sans famille anatomique dédiée
  // (ni tête/oreille/museau/queue/membre) — rattachée à `motif` (texture/mèches).
  // « PATTERN » nu (EN, PDF réel Mia Cardigan) : ancré titre ENTIER, jamais en
  // sous-chaîne — « pattern » est un mot anglais très fréquent (« in the already
  // established pattern », « knitting pattern »), une frontière de mot seule ferait
  // basculer des phrases de travail entières du corpus.
  // « muster\b »/« m[øo]nster\b » : PAS ancrés en tête, à dessein — « Ajourmuster »,
  // « Blattmuster » (composés allemands réels du corpus, brianza-shawl-de/antoinette-
  // children-s-coat-de) sont de VRAIES sections {motif}, un ancrage `\bmuster\b` les
  // ferait retomber à `null`. Le bandeau de couverture nu « STRICKMUSTER » (campagne vague
  // 5, spring-headband-de-cfeb6f9e) qui matchait ce même mot-clé nu est traité EN AMONT,
  // par l'alternative dédiée « (?:strick|häkel)muster » de CRAFT_BANNER_RE ci-dessous
  // (page 0 uniquement) — pas ici, où toucher l'ancrage casserait les composés légitimes.
  ['motif', /motifs?|points? (?:employ|fantaisie|utilis)|stitch pattern|pattern stitch|muster\b|m[øo]nster\b|punto(?:s)? (?:empleado|fantas[íi]a)|punti|steek\b|[śs]cieg|kuvio|m[öo]nster\b|\bcrin(?:es)?\b|^\s*pattern\s*$/i],
  ['accessoires', /poches?|pockets?|taschen?\b|lommer?\b|bolsillos?|tasche|zakken\b|kieszenie|taskut|fickor|\bscialle\b|\bsciarpa\b|\bcappello\b/i],
  // Éléments amigurumi sans famille dédiée (antennes « Czułki », bonnet « Czapka ») :
  // routés vers le kind générique `autre` (le corpus/oracle de référence les tague {autre}).
  ['autre', /czu[łl]ki|czapka/i],
]

// Sections consommées par reference.js (aide-mémoire) au lieu du travail.
const REF_KEYS = new Set(['abbr', 'materiel', 'mesures', 'echantillon', 'fil', 'aiguilles', 'techniques'])
// Sections d'introduction (description/construction) → Présentation.
const INTRO_KEYS = new Set(['info'])
// Sections de service (SAV, réseaux sociaux) : écartées du patron.
const NOISE_KEYS = new Set(['noise'])

export function kindForTitle(title) {
  // Test contre une copie foldée (ẞ→ß, cf. text-norm.js) : ne classifie JAMAIS le texte
  // stocké — `title` original repart inchangé côté appelant (cur.title = line.text).
  // (« INFO CROCHET »/« INFO TRICOT » : l'exclusion vague 2 AVANT balayage a été retirée —
  // un arbitrage, ces encarts sont désormais portés par la famille `infos` elle-même,
  // cf. son commentaire dans KIND_KEYWORDS.)
  const folded = foldEszett(title)
  for (const [key, re] of KIND_KEYWORDS) if (re.test(folded)) return key
  return null
}

// Bandeau « type d'ouvrage » de COUVERTURE : « TUTORIEL CROCHET », « KNITTING
// PATTERN », « HAAK PATROON », « MODELLO PER MAGLIA », « HÆKLEOPSKRIFT »,
// « HÄKELANLEITUNG »… Le nom+sous-titre sont déjà dans titre: (detectTitle) et
// l'auteur dans auteur: → ce bandeau est un DOUBLON, classé bruit. Reconnu
// UNIQUEMENT sur la page de garde (page 0) + court + capitales/gras, pour ne
// JAMAIS toucher une vraie section « Motif »/« MÖNSTER » du corps (les variantes
// SV/FI exigent un préfixe craft — jamais « MÖNSTER » nu). Chaque alternative est
// ancrée ^…$ (les langues hors corpus n'ont qu'un rôle anti-régression futur).
// « (?:strick|häkel)muster » (DE, campagne vague 5, spring-headband-de-cfeb6f9e, corpus
// réel) ajouté aux côtés de l'existant « (?:häkel|strick)anleitung » : bandeau DE manquant
// pour le même bandeau « type d'ouvrage », déjà couvert côté SV par
// « (?:virk|stick)(?:mönster|beskrivning) » juste en dessous. Sans lui, « STRICKMUSTER »
// (page de garde, 1re ligne du PDF, suivie du nom « Spring »/sous-titre « Haarreifen ») ne
// matchait ce bandeau nulle part : kindForTitle le classait `motif` via le mot-clé nu
// `muster\b` de KIND_KEYWORDS (non ancré EN TÊTE à dessein, cf. son propre commentaire —
// requis par les composés « Ajourmuster »/« Blattmuster », de VRAIES sections corps),
// entraînant « Spring »/« Haarreifen » comme fausse section = fuite du titre dans le corps.
// Ancré ^…$ + gate page0/court/capitales comme les autres alternatives : une vraie section
// « Strickmuster » PLUS LOIN dans le document (hors page 0) reste `motif` sans changement.
// ES additionnel : « patrón/modelo de dos agujas » (littéralement « deux aiguilles » —
// tournure usuelle espagnole pour TRICOT, par opposition à « ganchillo » = crochet),
// absente jusqu'ici. Cas réel penny-socks-es-3b0f0a03 (vague 5) : sans elle,
// kindForTitle classait le bandeau `aiguilles` par collision `agujas?` (la sous-chaîne
// AGUJAS du bandeau lui-même matche la famille aiguilles), fusionnant sa page de garde
// avec les vraies sections Aiguilles (2 items fabriqués dans Matériel au final).
// Vérifié sans régression sur le corpus complet (3122 PDF, `yarn corpus:measure`,
// 11/09) : diff structurel nul sur les sections de travail (attendu — ce bandeau ne
// vit que dans des sections référence, hors mesure de ce banc) ; balayage dédié de la
// page 0 des 45 PDF ES/tricot du corpus hobbii confirme exactement 14 patrons portant
// ce bandeau, penny-socks-es-3b0f0a03 parmi eux.
const CRAFT_BANNER_RE = new RegExp(
  '^(?:' +
  'tutoriel\\s+(?:crochet|tricot)' +                                      // fr
  '|(?:mod[èe]le|patron)\\s+de\\s+(?:tricot|crochet)' +                   // fr
  '|(?:crochet|knit(?:ting|ted)?)\\s+pattern' +                          // en
  '|(?:crochet|knit(?:ting)?)\\s+tutorial' +                             // en (var.)
  '|(?:haak|brei)\\s*patroon' +                                          // nl
  '|modello\\s+(?:per|a|di)\\s+(?:maglia|uncinetto)' +                   // it
  '|(?:h[æe]kle|strikke?)opskrift' +                                     // da
  '|(?:hekle|strikke)oppskrift' +                                        // no
  '|(?:h[äa]kel|strick)anleitung' +                                      // de
  '|(?:h[äa]kel|strick)muster' +                                        // de (var.)
  '|(?:virk|stick)(?:m[öo]nster|beskrivning)' +                          // sv (préfixé)
  '|(?:virkkaus|neule)ohje' +                                            // fi
  '|(?:patr[óo]n|modelo)\\s+de\\s+(?:punto|ganchillo|croch[eé]t?|tricot|dos\\s+agujas)' + // es
  '|wz[óo]r\\s+(?:na\\s+)?(?:szyde[łl]k\\w*|drut\\w*)' +                  // pl
  ')$',
  'i',
)

// Bandeau BOUTIQUE « ACHETEZ VOTRE FIL ICI » / « BUY THE YARN HERE » / « KOOP HET
// GAREN HIER » / « KØB GARNET HER »… : verbe d'achat impératif en tête + mot fil.
// Classé « fil » par kindForTitle (« fil »/« yarn » dans le titre), il fait fuir son
// ancre de lien (« Tutoriel », « Pattern », slug produit) dans ## Fil. Reconnu ici
// pour être routé en bruit — MAIS seulement s'il existe une VRAIE section fil sœur
// (cf. segmentSections), afin de préserver les patrons où ce bandeau porte lui-même
// la conso (« Verbruik: Ca. 35g », cf. curly-nl). Une vraie section « QUALITÉ DU
// FIL »/« YARN QUALITY » ne commence PAS par un verbe d'achat → jamais capturée.
const BUY_YARN_RE = new RegExp(
  '^(?:achetez?|buy|koop|compra|k[øo]b|k[öo]p|kj[øo]p|bestell(?:e|en)?|osta|kupuj?|kauf(?:e|en)?)\\b' +
  '.*\\b(?:fil|yarn|garn(?:et)?|garen|filat[oi]|hilo|lana|lanka|langan|w[łl][óo]czk\\w*)\\b',
  'i',
)
const isBuyYarnBanner = (title) => BUY_YARN_RE.test(String(title ?? '').trim())

// Aiguille-ACCESSOIRE espagnole (couture/finition, PAS une déclaration de taille
// d'aiguille de travail) : « aguja(s) lanera(s) » (aiguille à laine/tapisserie).
// Mirroir ES de NEEDLE_ACCESSORY_QUALIFIER_ADJACENT_RE (reference.js), qui traite déjà
// FR « aiguille à laine »/DE « Garnnadel »/scandinave mais pas l'ES — la même famille
// lexicale « aguja »/« agujas » sert en espagnol à la fois l'aiguille à TRICOTER (une
// vraie déclaration de taille, ex. « Un juego de 5 agujas de doble punta de 2,25 mm »)
// et l'aiguille à LAINE (un article de Matériel, jamais une taille). Cas réel
// penny-socks-es-3b0f0a03 (vague 5) : « Aguja lanera », qualifiée ADJACENTE à
// « lanera » (comme le veut le motif ES déjà mesuré, cf. reference.js pour le
// raisonnement sur l'adjacence stricte), matche quand même l'alternative `agujas?` de
// KIND_KEYWORDS (famille aiguilles) et se retrouve promue en fausse section référence.
// Portée volontairement fermée à ce seul qualificatif mesuré (pas de fenêtre, pas de
// liste ouverte) : élargir sans mesure corpus regagnerait le risque déjà vu sur la
// piste rejetée.
const NEEDLE_ACCESSORY_ES_RE = /\bagujas?\s+laner[ao]s?\b/i

// Collision de mot-clé « fil » : un titre classé `kind==='fil'` par pur hasard lexical
// (« Aiguille à laine », « Obtenez votre fil et vos accessoires ici »…) sans être une
// vraie section fil — condition PARTAGÉE par deux gardes qui doivent rester synchronisées :
// `refKeywordCollision` (rétrogradation post-boucle, plus bas, avec en plus la condition
// géométrique BOX_REF.has(prev?.ref)) et `curRescuableIfEmptied` (garde emptiesPrecedingSection,
// plus haut — approxime la même collision SANS le contexte `prev` du post-boucle,
// pas disponible pendant la boucle principale). Factorisée pour que les deux gardes ne
// divergent pas sur ce cœur commun si la définition de la collision évolue.
const isFilKeywordCollision = (kind, title) =>
  kind === 'fil' && !/\d/.test(title) && !isBuyYarnBanner(title)

// Accroche de vente croisée (« Vous aimez son style, mais préférez une [forme
// différente ? Découvrez la version rectangulaire] ») promue en section fantôme.
// Motif étroit : soit l'accroche FR spécifique, soit « découvrez … version » et
// équivalents multilingues (both mots requis) — jamais une instruction du corps.
const CROSS_SELL_RE = /^(?:vous aimez\b.*\bstyle|d[ée]couvrez\b.*\bversion|you (?:might|may|'?ll|will)\s+(?:also\s+)?(?:like|love)\b|(?:check out|discover)\b.*\bversion|entdecke\b.*\bversion|scopri\b.*\bversione|descubre\b.*\bversi[óo]n)/i

function modalBodySize(all) {
  const counts = new Map()
  for (const l of all) {
    const s = Math.round(l.size)
    counts.set(s, (counts.get(s) || 0) + l.text.length)
  }
  let best = 0
  let size = 10
  for (const [s, w] of counts) if (w > best) { best = w; size = s }
  return size
}

// « rondas? »/« vts? » (espagnol crochet, ronda/vuelta abrégée « vt ») et « hilera » (espagnol
// crochet, rang à plat) ajoutés aux côtés de « vueltas?/filas? » déjà présents (palier 6).
// « vt » est un token court (comme « r.\ »/« krs » déjà dans l'alternance) : sans risque de
// collision, la ligne doit COMMENCER par lui (ancre ^) et un chiffre doit suivre immédiatement
// (holiday-ornament-es, serenity-sweater-es, corpus réel palier 6).
//
// « reihen? » (allemand, mot complet « Reihe(n) ») ajouté palier 7 : même mécanisme que
// « hilera » ci-dessus — résorbé ICI À LA SOURCE plutôt que via la garde locale MISSED_ROW_RE
// (retirée à ce palier, devenue intégralement redondante : elle ne couvrait QUE « reihen? »).
// Impact réel confirmé sur peonie-flower-de-bc2e2ed0 (corpus réel, crochet allemand) : 6 des 8
// sections de travail du corps (rangs « R 1: », « R 2: »… numérotés) restaient kind='pelote'
// faute de détection par sectionHasRowLine — la reclassification post-hoc pelote→autre ne se
// déclenchait donc jamais pour elles.
//
// « r\.? » (abréviation allemande courte de « Reihe », même palier 7) EXIGE UN ESPACE avant le
// chiffre (`\s+\d`, pas le `\s*\d` partagé par les autres tokens de l'alternance) — seul token
// de cette alternance à recevoir cette garde renforcée. Raison : un token d'UNE SEULE lettre
// est structurellement plus exposé aux collisions que « krs »/« vt » (2-3 lettres) — vérifié
// sur le corpus réel (25 réf. gate) : venetien-shawl-fr-00cde606 porte deux lignes autonomes
// « R0416 » (référence de patron/SKU, cf. pied de page « hobbii-pattern-sku:pattern-R0416 »),
// qui auraient matché à tort un « r\.?\s*\d » permissif (aucun espace entre le « R » et les
// chiffres). Toutes les occurrences RÉELLES de rangs courts mesurées (« R 1 :», « R. 41: »,
// peonie-flower/donkey) portent un espace après le « R » : l'exigence \s+ ne coûte donc rien
// sur les vrais rangs et bloque cette collision précise, confirmée non hypothétique.
//
// Palier 8 (lush-life-crochet-blanket-en-97699620, corpus réel, crochet Yarnspirations/
// Bernat) : les branches ci-dessus exigent toutes MOT DE RANG PUIS CHIFFRE (« Row 3 »).
// Les patrons anglophones de cette famille écrivent l'inverse, ordinal ANTÉPOSÉ au chiffre
// (« 1st row: … », « 2nd row: … »), jamais couvert. Branche dédiée `\d+(?:ordinal)\s*(?:mot
// de rang)` ci-dessous — anglais (st/nd/rd/th) et français (er/ère/e/ème, formes non
// accentuées ere/eme tolérées côté extraction PDF). Sans risque de collision avec un
// simple compte numérique suivi du mot de rang SANS ordinal (« 2 rows below », définition
// de l'abréviation « Trfp » dans ce même PDF réel ; « 3 rangs de plus ») : ces lignes n'ont
// PAS le suffixe ordinal collé au chiffre, la branche ne les touche donc jamais — vérifié
// explicitement par test dédié, pas supposé.
//
// Palier 9 (knit-domino-shawl-de-61747066, corpus réel, Hobbii DE) : la convention de cet
// éditeur écrit l'ordinal collé au POINT, sans espace (« 1.Reihe (linke Seite): … »,
// « 1.Rd: … ») — la branche du palier 8 exige un suffixe ordinal (st/nd/er/e…) que cette
// forme n'a pas, et BARE_ITEM_RE (plus bas) exige un ESPACE après le point. AUCUNE des
// deux ne fermait donc la soupape echantillon de ce PDF : 16 lignes d'instructions
// déversées dans la carte Échantillon avant le premier « 2. Reihe » espacé. ARBITRAGE :
// OUI pour ROW_START_RE — c'est le point d'entrée de la soupape (sectionHasRowLine) et de
// la garde isTitleLine, fermer au premier « 1.Reihe » est tout l'objet du correctif. La
// branche exige le MOT DE RANG allemand après le point (reihe/runde/rd) : « 1. Masche »/
// « 3. Stb » (ordinal + nom non-rang) et un numéro de liste nu « 1. » ne matchent jamais,
// et « 1. Reihe » espacé continue de matcher ce qui le matchait déjà (via BARE_ITEM_RE —
// le `\s*` de la branche couvre les deux graisses d'espacement).
// Palier 10 (bernadette-tote-bag-de-1e86ff98, corpus réel Hobbii DE, crochet) : « Rd »
// PRÉFIXE — abréviation de « Runde » AVANT le chiffre (« Rd 6: 1 Lm… ») — manquait ici
// comme dans ROW_RE (steps.js), alors que NEW_ITEM_RE (reflow.js) la connaissait déjà
// (asymétrie). Effet en cascade via sectionHasRowLine : la section « Bild 1 » de ce PDF
// ne portait AUCUN rang reconnu → jamais reclassée pelote→autre (restait non-travail),
// et ses longues rondes (>220 car.) basculaient en notes non cochables côté steps.
// ARBITRAGE : OUI, même branche « rd\.? » que ROW_RE (règle de synchronisation des
// sœurs) ; banc de fidélité vérifié : 26 mesurés, aucun recul. Le token partage le
// `\s*\d` de ses voisins multi-lettres — pas besoin de la garde `\s+` réservée au « r »
// d'une seule lettre (SKU « R0416 », venetien-shawl) : « rd » collé à des chiffres
// n'est pas une forme de SKU observée, et NEW_ITEM_RE applique déjà `\s*` à « rd »
// sans collision mesurée sur le corpus.
// Exporté pour reference.js (garde anti-rang des sous-labels de la rubrique
// techniques : un libellé « Row 1 (RS) » qui DÉMARRE par un marqueur de rang n'est
// pas un nom de technique — test PRÉFIXE, l'ancre de fin n'existe pas ici).
export const ROW_START_RE = /^\s*(?:(?:rangs?|rgs?|rows?|rounds?|tours?|trs?|rnds?|runde?n?|rd\.?|reihen?|omg(?:ang)?e?|omgangen|vueltas?|rondas?|vts?|filas?|hilera|giro|giri|rig(?:a|he)|toeren?|rz[ąęe]dy?|krs|varvet?|kierros|kerrokset)\s*\d|r\.?\s+\d|\d+(?:st|nd|rd|th|ère|ere|ème|eme|er|e)\s*(?:rows?|rounds?|rangs?|tours?)\b|\d{1,3}\.\s*(?:reihen?|runde?n?|rd\.?))/i

// Rang fondateur d'un patron crocheté EN ROND, SANS numéro de rang (bug réel DROPS EN,
// sunny-daze-en-bc4eee5a, campagne 27/08) : « Hat: Crochet 4 ch and make a ring with a sl
// st in the first ch. » est le tout premier rang du patron (celui qui forme l'anneau de
// départ avant le « 1st round »), mais ROW_START_RE/BARE_ITEM_RE ne le reconnaissent pas
// (aucun numéro de rang, aucune puce). Faute de signal de rupture, cette ligne — collée à
// la suite du bloc Matériel/Aiguilles/Échantillon sur la même page, sans titre promu (la
// mise en page DROPS n'espace pas plus cette ligne que ses voisines) — restait à l'intérieur
// de la section référence en cours et finissait scannée par isNeedleLine (reference.js,
// NEEDLE_BARE_RE) : « Crochet 4 » y ressemble à une taille de crochet nue (« Crochet
// 2,5 »), la ligne entière atterrissait donc dans ## Aiguilles au lieu d'## Instructions.
// Vocabulaire FERMÉ, volontairement étroit (un « anneau »/« ring » de départ est un idiome
// de technique reconnaissable, jamais une prose de matériel/échantillon) : « make/form a
// ring » (EN, forme mesurée sur ce PDF réel) et « magic ring » (EN, variante usuelle du
// même geste en amigurumi/crochet). Non ancrée en tête : le rang fondateur est
// systématiquement précédé d'un label de pièce collé sur la même ligne (« Hat: », « Body: »
// …), jamais en 1ère position.
const FOUNDING_RING_RE = /\b(?:make|form)\s+a\s+ring\b|\bmagic\s+ring\b/i

// Item numéroté « nu » (« 1. Monter 126 ml … », « 2) Tricoter … ») : un numéro (1 à 3
// chiffres) suivi d'un point ou d'une parenthèse et d'une PROSE d'instruction. Comme
// ROW_START_RE, sert à refermer une section abbr qui déborderait sur le corps du patron
// quand celui-ci est numéroté SANS mot de rang (« 1. » au lieu de « Rang 1 »). Les
// exclusions (KV_RE, looksLikeTableRow) au point d'appel évitent de confondre une vraie
// abréviation (« 2 br: … ») ou une rangée du tableau des tailles.
const BARE_ITEM_RE = /^\s*\d{1,3}[.)]\s+\S/

// Rangée réelle : mot de rang + chiffre (ROW_START_RE) OU item numéroté nu (BARE_ITEM_RE,
// « 1. Monter … »). Détecteur PARTAGÉ entre deux usages distincts dans segmentSections :
// la rétrogradation (une section porteuse d'un rang n'est jamais une étiquette de boîte,
// cf. hasRowLine ci-dessous) et la reclassification post-hoc (une section repliée sur
// `pelote` faute de mot-clé, mais porteuse d'un vrai rang, est du travail mal titré — pas
// une section non-actionable). Un seul détecteur : deux copies divergeraient en silence.
function sectionHasRowLine(sec) {
  return sec.lines.some((l) => {
    const t = l.text.trim()
    return ROW_START_RE.test(t) || BARE_ITEM_RE.test(t)
  })
}

// Ligne-tableau de mesures (garde-titre G4a) : un LABEL texte suivi d'AU MOINS 3
// nombres séparés par des espaces (décimale à virgule « 74,5 » ou plage à tiret
// « 23-25 » admises, « cm » traînant toléré). Une telle ligne est une RANGÉE du
// tableau des tailles — jamais un titre, même en gras ou tout en capitales (sans
// quoi « ## Tailles » se fait déchiqueter, cf. « Taille (cm) 34 36 38 40 42 … »).
const TABLE_ROW_NUM = String.raw`\d+(?:[.,]\d+)?(?:-\d+(?:[.,]\d+)?)?`
// `^\s*` en tête — ANCRAGE, pas un filtre. Sans lui, le moteur relançait le motif entier
// depuis CHACUNE des positions de la ligne, et `.*` y reparcourait chaque blanc : coût
// cubique, mesuré 4 min 22 s sur une ligne de 8 000 caractères de chiffres (une simple page
// de tableau de tailles y mène, via le recollage de cellules de lines.js). L'ancrage est
// SANS EFFET SÉMANTIQUE sur une ligne (le motif exige déjà de démarrer sur un `\S`, donc au
// premier non-blanc, et `^\s*` mène exactement là) : vérifié par 600 000 tirages aléatoires
// sans retour à la ligne — zéro divergence. Gain mesuré : 261 827 ms → 159 ms à 8 000
// caractères, 3 552 ms → 8,6 ms à 2 000.
const TABLE_ROW_RE = new RegExp(
  String.raw`^\s*\S.*\s${TABLE_ROW_NUM}(?:\s+${TABLE_ROW_NUM}){2,}(?:\s*cm)?\s*$`,
  'i',
)
// Seconde borne, sur le MODÈLE du garde de longueur de `isTitleLine` juste en dessous
// (`t.length > 42`) : l'ancrage ci-dessus abaisse le coût de trois ordres de grandeur mais
// le laisse quadratique, et ce prédicat est appelé PAR LIGNE. Une rangée de tableau des
// tailles réelle est courte — la plus longue plausible (un libellé + 20 colonnes de mesures)
// tient en ~150 caractères ; 2 000 laisse un facteur 13 de marge tout en plafonnant le pire
// cas adversarial à 8,6 ms. Au-delà, la ligne n'est PAS reconnue comme rangée : les quatre
// appelants s'en servent uniquement pour ÉCARTER un candidat titre/prose, donc le repli est
// « on ne suppprime rien » — jamais une perte de contenu.
const TABLE_ROW_MAX_LEN = 2000
export function looksLikeTableRow(text) {
  const t = String(text ?? '').trim()
  return t.length <= TABLE_ROW_MAX_LEN && TABLE_ROW_RE.test(t)
}

// Une valeur UNIQUE (pas de vecteur groupé) n'est reconnue « mesure » que si le
// nombre est IMMÉDIATEMENT suivi d'une vraie unité de longueur (cm, mm, in/inch, po) —
// jamais un mot court quelconque. Régression mesurée sur le corpus (3234 PDF),
// lavender-field-skirt-fr-54807b3d : sans cette borne, un décompte de brides/mailles
// (« 132 br », « 126 br »…) était pris pour une mesure unique — « XS procéder au Point
// Ajouré » (un vrai sous-titre de travail par taille) se voyait désarmée à tort, 31 lignes
// d'instructions réelles (Tour 1 à 4, plusieurs tailles) absorbées dans le bloc Tailles.
// « m » et « g » NE SONT PAS dans cette liste : trop ambigus (« m » = mètre OU maille en
// français — collision directe avec un décompte de mailles).
const BARE_SINGLE_MEASURE_RE = /^\d+(?:[.,]\d+)?\s*(?:cm|mm|in\b|inch(?:es)?\b|po\b)/i
// Ligne qui ne porte QUE des valeurs de mesure : soit un vecteur de tailles
// groupé (« 97 (102.5, 106.5, 112, 116) (121.5, 131, 142.5, 152) 161.5, 171 cm »), soit une
// valeur UNIQUE identique pour toutes les tailles (« 47 cm (measured from underarm
// cast-on edge) », PDF réel Mia Cardigan : la longueur de manche recommandée ne varie pas
// selon la taille, une seule valeur suffit — aucun vecteur groupé, mais une vraie unité de
// longueur, cf. BARE_SINGLE_MEASURE_RE ci-dessus). Dans le cas du vecteur, au plus une
// unité (« cm », « m », « g ») et une parenthèse explicative : aucun verbe, aucune
// consigne. Appelée UNIQUEMENT depuis segmentSections, gardée par `cur?.ref === 'mesures'`
// (cf. plus bas) — jamais globalement, sinon une vraie consigne de travail qui se termine
// par un compte de tailles (« Cast on 99 (99, 101, 101, 101) … sts. », corpus réel) serait
// désarmée à tort.
export function isBareSizeVectorLine(text) {
  const t = String(text ?? '').trim()
  // Resserré (régression mesurée sur le corpus, colonne étroite néerlandaise « Pull femme
  // col camionneur.pdf ») : une ligne PDF y est coupée EN PLEINE PARENTHÈSE (« Op
  // 33-34-34-35-36 cm (74-76-76-78- », la suite « 80 nld.) totale hoogte aan beide
  // kanten » est sur la ligne SUIVANTE, avant tout reflow — segmentSections travaille sur
  // les lignes BRUTES, sans reflow). La parenthèse ouvrante sans fermeture cache la prose
  // qui aurait normalement disqualifié la ligne (« totale hoogte… », 3 mots ≥ 4 lettres) :
  // sans cette garde, un vrai titre de section (« Armsgaten : », néerlandais pour
  // « emmanchures ») était désarmé à tort, engloutissant 19 lignes d'instructions réelles
  // (dont les décomptes S/M/L/XL) dans le bloc Tailles — silencieusement perdues. Une
  // parenthèse déséquilibrée signale une ligne coupée par la mise en page : jamais bare.
  if ((t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length) return false
  const vecs = findSizeVectors(t)
  let rest
  if (vecs.length) {
    rest = t.slice(0, vecs[0].start) + t.slice(vecs[vecs.length - 1].end)
  } else if (BARE_SINGLE_MEASURE_RE.test(t)) {
    rest = t.replace(/^\d+(?:[.,]\d+)?/, '')
  } else {
    return false
  }
  return !/[A-Za-zÀ-ÿ]{4,}/.test(rest.replace(/\([^)]*\)/g, ''))
}

// Garde changement d'outil en cours de rang (P0, corpus réel ups-and-downs-blanket-en-
// 258ffe33, campagne palier 7/8) : « Change hook to 4.5mm : » était promue à tort en titre de
// section — kindForTitle classe ce titre fantôme ref='aiguilles' (alias \bhooks?\b), et
// reference.js (branche ref==='aiguilles', ~l.613) engloutit alors tout ce qui suit dans
// materials.push dès que ça ne matche pas un motif outil : Round 3-5, la clôture (« After
// completing… », « Weave all ends in. ») et la signature de l'autrice disparaissaient de
// BORDER AND FINISH pour ressurgir en puces désordonnées sous Matériel. Sa jumelle
// syntaxique plus longue, « Change hook to 3.5mm (or even 3mm), just for this round : »
// (même page, même rôle, même formulation), reste correctement NON promue.
//
// PROMOTION RÉELLE (vérifié sur les vraies données pdf.js, pas sur une hypothèse) : les
// deux lignes sont bold=false dans le PDF réel — isTitleLine (gras/majuscules/grande police)
// les rejette déjà TOUTES LES DEUX avant tout correctif. La promotion fantôme vient
// entièrement d'isSpacedTitle (repli par ESPACEMENT, plus bas) : gap réel 24 ≥ 1,7×modalGap
// (12) pour les deux lignes, mais seule « Change hook to 4.5mm : » (22 caractères) passe son
// plafond de longueur (42) — sa jumelle (57 caractères) en est déjà exclue. SEULE la
// longueur distinguait les deux lignes dans isSpacedTitle, exactement comme documenté pour
// isTitleLine ci-dessous : preuve que ce signal — « : » final + mesure mm/US en son sein —
// doit garder les DEUX fonctions, pas seulement celle nommément visée au départ.
//
// Signal retenu : une ligne qui se termine par « : » (annonce d'instruction en cours de
// travail, pas une étiquette de titre) ET porte une mesure mm/US en son sein n'est jamais un
// titre de section légitime dans le corpus mesuré (215 fichiers ideal/engine du corpus web,
// 25 réf. gate incluses) — passé au crible : aucun titre existant ne finit par « : » avec une
// mesure mm/US en son sein. Le seul titre du corpus nommé d'après une taille d'aiguille
// (« ## Rundpind 3 mm, 40 cm », dorn-children-s-sweater-da, patron multi-tailles-d'aiguilles)
// NE finit PAS par « : » et n'est donc pas concerné — vérifié avant ce correctif, pas supposé.
// Garde SUPPRESS-ONLY, même principe et même prudence que STITCH_COUNT_END_RE plus bas
// (n'autorise jamais une nouvelle promotion, n'en empêche qu'une → risque asymétrique et
// borné, cf. décision documentée palier 6). Appliquée EN L'ÉTAT dans le texte ORIGINAL
// (avant que isSpacedTitle ne retire le « : » final pour former son `t` local) : c'est
// justement ce « : » qui distingue une consigne (à supprimer) d'un titre-étiquette légitime.
const TOOL_SIZE_MEASURE_RE = /\d+(?:[.,]\d+)?\s*mm\b|\bUS\s?\d+\b/i
function isToolSizeChangeLine(text) {
  return /:\s*$/.test(text) && TOOL_SIZE_MEASURE_RE.test(text)
}

// Ligne d'annonce de couleur de fil (« In nude », « In brown », « In pink yarn », « In
// pastel mint » — motif anglais Hobbii courant) : indique la couleur utilisée pour LA
// PIÈCE en cours, jamais un titre de section. Mesuré sur gingerbread-doll-en-68a5ddbc
// (campagne 27/08) : isSpacedTitle (repli par espacement, plus bas) la promeut À TORT en
// titre quand le VRAI titre de la pièce qui la précède immédiatement (« Head », « Hood »,
// « Bow », « Cheeks (Make 2) » — gras/grande police, aucun rang entre les deux) tient sur
// une seule ligne : le blanc de paragraphe avant l'annonce de couleur dépasse alors le
// seuil 1,7×modalGap (isSpacedTitle), qui n'a aucun moyen lexical de la distinguer d'un
// vrai 2ᵉ titre. Conséquence mesurée : le VRAI titre de la pièce se retrouve vidé (0
// ligne) puis jeté en silence (isRescuableTitle, assemble.js, exige une parenthèse
// absente ici) — « Head »/« Hood »/« Bow » disparaissent purement et simplement,
// remplacés par la couleur ; quand le vrai titre PORTE une parenthèse (« Cheeks (Make
// 2) »), la ligne de couleur déclenche en plus, pour « In pink yarn », la clé référence
// « fil » (mot « yarn », cf. isFilKeywordCollision) — la soupape ROW_START_RE plus bas
// jette alors la section « fil » entière (titre ET contenu) au premier rang venu.
// Restreinte au strict motif observé (« In » + jusqu'à 25 caractères de mots, sans borne
// sur leur nombre — « In the main color yarn », 4 mots, matche tout autant que « In
// brown »), aucune ponctuation finale, aucun chiffre : ni « Introduction » (un seul mot,
// sans espace après « In »), ni une consigne de rang (« In front loop only on round 7. »
// finit par un point, déjà écartée en amont par SENTENCE_END_RE dans isSpacedTitle avant
// d'atteindre ce garde).
const YARN_COLOR_ANNOUNCEMENT_RE = /^In\s+\p{L}[\p{L}\s]{1,24}$/u

// isTitleLine ne rencontre AUCUN cas réel de ce motif dans le corpus mesuré (les deux
// occurrences connues sont bold=false, cf. ci-dessus) : garde de défense en profondeur pour
// un futur PDF où la même consigne serait grasse — n'a encore rien changé sur le corpus gate.
export function isTitleLine(line, bodySize) {
  const t = line.text
  if (looksLikeTableRow(t)) return false
  if (t.length < 3 || t.length > 42) return false
  if (/[.!?]\s*$/.test(t)) return false
  if (ROW_START_RE.test(t)) return false
  if (isToolSizeChangeLine(t)) return false
  if (BARE_COUNT_PAREN_UNIT_TITLE_RE.test(t)) return false
  const upper = t === t.toUpperCase() && /[A-ZÀ-Ý]/.test(t)
  // Item numéroté nu (« 1. Wann die Seelenwärmer gehäkelt ist, », BARE_ITEM_RE) promu à
  // tort en TITRE via le SEUL signal taille (`line.size >= bodySize * 1.15`) : bug réel
  // granny-shawl-jacket-de-5f09f875 (campagne vague 5, crochet allemand), page « photo du
  // Seelenwärmer fini » — 3 consignes d'assemblage numérotées (« 1. …, », « 2. …, », « 3.
  // …, ») PUIS une légende de schéma elle-même numérotée (« 1. Falte In zwei Hälften »,
  // « 2. Näh am », « 3. Armloch ») sont écrites en taille 10, plus grandes que le corps de
  // la page (taille 8, dominée en poids de caractères par les blocs fil/matériel/légendes
  // du PDF entier — pas par le corps réel du patron, taille 9) : ratio 10/8 = 1,25 ≥ 1,15,
  // seuil `strongTitle` franchi par simple mise en emphase typographique d'un ENCART
  // (légende sous photo), jamais un vrai titre de section. Impact bloquant : 4 « ## »
  // fantômes scindent une liste d'assemblage/une légende de schéma qui n'auraient dû
  // former qu'une seule liste dans la section en cours (Fur Lux), chacun avec 0-3 lignes
  // de contenu, confiance du document dégradée.
  // Garde ÉTROITE (asymétrique, SUPPRESS-ONLY comme ses voisines de ce fichier) : seul le
  // signal `size` est désarmé pour une ligne BARE_ITEM_RE, PAS `bold` ni `upper` — un
  // titre de pièce numéroté RÉEL (« 1. VORDERTEIL », tout capitales, ou mis en gras dans
  // le PDF) reste promu normalement. Les 6 lignes réelles de ce bug sont TOUTES
  // bold=false et mixtes (jamais upper) : aucune des deux n'est perdue en resserrant sur
  // elles seules, contrairement à un rejet total de BARE_ITEM_RE qui aurait aussi supprimé
  // « 3. Armloch »/« 2. Näh am » — des libellés courts SANS verbe, formellement identiques
  // à un vrai titre de pièce numéroté (« 1. Vorderteil », « 2. Rückenteil ») : rien ne les
  // distingue par la forme seule, seul bold/upper reste un signal fiable pour ceux-là.
  // Compromis assumé (balayage corpus complet, 3122 patrons, revue) : un vrai titre de
  // pièce en CASSE MIXTE sans gras ni majuscules perd quand même son `##` sur cette garde
  // — aucun signal ne le distingue plus d'un item de liste dans ce cas précis. Cas réel
  // ravelry/plant-buddies-en-c42069ae : « 4. Top Leaves (Lace yarn, 1.75 mm hook) » et
  // « 5. Petals (Lace yarn, 1.75 mm hook) » (taille 19,98 contre un corps à 14, casse
  // mixte, non gras) perdent leur section propre, leurs rangs absorbés dans une section
  // diagramme. Aucune perte de contenu mesurée sur ce fichier (76 lignes identiques avant/
  // après) et la fidélité globale s'y améliore quand même (66→73, medium→high, l'état
  // antérieur n'étant pas propre non plus — le titre partait déjà ailleurs par une autre
  // collision) : pas une régression nette, mais un compromis réel, non gratuit, retenu
  // faute d'heuristique meilleure sans plus de données (bold/majuscules restent les SEULS
  // signaux fiables disponibles ici ; élargir sur autre chose que BARE_ITEM_RE réintroduit
  // le bug bloquant d'origine, cf. tests/unit/pdf-import-segment.spec.js).
  if (BARE_ITEM_RE.test(t) && !line.bold && !upper) return false
  return line.bold || upper || line.size >= bodySize * 1.15
}

// Total de mailles nu, replié par la colonne PDF sur SA PROPRE ligne, parenthèses ET unité
// collée (« (12 M) », « (24 M) ») : reflowLines (reflow.js, BARE_COUNT_PAREN_UNIT_JOIN_RE — nom
// DÉLIBÉRÉMENT DIFFÉRENT de la regex ci-dessous, cf. son propre commentaire sur la divergence de
// portée) le recolle normalement au rang qui précède — MAIS segmentSections() tourne AVANT
// reflowLines (cf. assemble.js), donc cette ligne isolée est encore présente quand
// isTitleLine() l'examine. Son critère « upper » (`t === t.toUpperCase() &&
// /[A-ZÀ-Ý]/.test(t)`) la classe alors à tort en titre fort : les chiffres/parenthèses/espaces
// ne changent jamais de casse, et l'unité allemande « M » (Masche) est TOUJOURS en majuscule —
// la ligne entière est donc « déjà en majuscules » au sens de ce test, sans qu'aucun vrai mot
// n'y soit pour quoi que ce soit. Testée AVANT ce calcul de `upper` (donc AVANT tout le test
// final `line.bold || upper || line.size >= bodySize * 1.15`) : elle court-circuite les TROIS
// signaux forts, pas seulement `upper` — une ligne de cette forme qui serait EN PLUS grasse ou
// en grande police (jamais observé dans le corpus, mais pas exclu) resterait donc, à dessein,
// non promue.
// Cas réel snowman-coaster-de-623a0c1d : « Runde 1: … schließen. » / « (12 M) » sur sa
// propre ligne PDF → promue en faux titre `##`, puis « Runde 2: … » / « (24 M) » itou,
// scindant en TROIS sections un corps de rangs qui n'en formait qu'une seule (bloquant :
// un rang entier disparaît de sa section de travail). Garde SUPPRESS-ONLY, même principe que
// STITCH_COUNT_END_RE/isToolSizeChangeLine plus bas (n'autorise jamais une promotion nouvelle,
// n'en empêche qu'une) : restreinte à un total NU (chiffres seuls) suivi d'une unité COURTE
// (1 à 4 lettres, motif observé « M » ; borne large par prudence plutôt que le seul littéral
// « M » — un futur PDF pourrait replier « (24 St) »/« (12 sts) » de la même façon), rien
// d'autre dans la parenthèse.
// ⚠️ PORTÉE DÉLIBÉRÉMENT PLUS LARGE que sa jumelle de reflow.js (BARE_COUNT_PAREN_UNIT_JOIN_RE,
// restreinte au seul littéral « M ») : ici, le risque d'une promotion ratée est SUPPRESS-ONLY
// (borné), alors qu'en recollage une unité mal devinée fusionnerait à tort du texte non lié —
// les deux regex ne sont PAS synchronisées à dessein, ne pas les fusionner ni élargir l'une en
// pensant élargir l'autre.
const BARE_COUNT_PAREN_UNIT_TITLE_RE = /^\(\s*\d+\s*[\p{L}]{1,4}\s*\)$/u

const KV_RE = /^.{1,40}:\s+\S/
// Une entrée de glossaire (« K = knit », « BOR = beginning of round ») n'est JAMAIS un titre
// de section. Sans cette garde, isSpacedTitle les promeut toutes (glossaire aéré : ~28 pt
// d'interligne contre ~14 pt pour le corps, Juice_Sweater_by_Kutovakika) : la rubrique est
// éclatée en 9 morceaux et les fragments sans contenu (« P = purl », « PM = place marker »,
// « RM = remove marker ») sont ensuite supprimés comme sections vides — perte réelle.
// Garde SUPPRESS-ONLY (n'autorise jamais une promotion nouvelle, n'en empêche qu'une) :
// risque asymétrique et borné, comme STITCH_COUNT_END_RE et isToolSizeChangeLine.
const GLOSSARY_ENTRY_RE = /^[^\s=]{1,12}(?:\s[^\s=]{1,12}){0,2}\s*=\s*\S/
// Correctif A (mesure de campagne, 26/07) — GLOSSARY_ENTRY_RE seule était TROP LARGE : un
// vrai TITRE de section au format « clé = compte » (« Corner = 3trc, ch2, 3trc », sunshine-
// children-s-sweater-en, 179 mots perdus derrière) ou une donnée de taille par taille
// (« S = 29 ml », wrap-me-on-jacket-fr/nl) matchent aussi cette forme sans être des entrées
// de glossaire. Discriminant : ce qui suit le « = » — un MOT (« knit ») signe une vraie
// définition ; un NOMBRE NU (« 3trc… », « 29 ml ») signe un compte ou un titre, jamais un
// glossaire. `looksLikeBareCountDef` (reference.js) porte déjà ce garde, réutilisé tel quel
// (même discriminant que le balayage global de reference.js, pas une regex maison à côté :
// cf. leçon du lot — une garde `[=:]` maison avait régressé tout un dialecte). La clé étant
// bornée à `[^\s=]` par GLOSSARY_ENTRY_RE, le premier « = » du texte est nécessairement le
// séparateur : `text.indexOf('=')` le retrouve sans re-matcher.
function isGlossaryEntryTitle(text) {
  if (!GLOSSARY_ENTRY_RE.test(text)) return false
  const def = text.slice(text.indexOf('=') + 1).trim()
  return !looksLikeBareCountDef(def)
}
const SENTENCE_END_RE = /[.!?,;:…]\s*$/
// Compte de mailles/rangs crochet en fin de ligne (« … a further 13 times. 258dc ») :
// abréviations anglaises courantes (double/single/half-double/treble crochet, stitch(es)).
// « m » seul est délibérément EXCLU (trop générique/ambigu — collision avec des mots
// courts non crochet). Une ligne d'instruction qui finit ainsi n'est jamais un titre de
// section légitime dans le corpus mesuré (cf. isSpacedTitle ci-dessous).
const STITCH_COUNT_END_RE = /\d+\s*(?:dc|sc|hdc|tr|sts?)\s*$/

// (à placer au NIVEAU MODULE, près des autres regexes de segment.js — pas dans la
// fonction : isSpacedTitle est appelée pour CHAQUE ligne de CHAQUE page.)
const LABEL_DOT_RE = /^[\p{Lu}][\p{L}\s]{1,19}\.$/u
const ACTION_LEAD_RE = /^(?:break|weave|bind|cast|work|knit|purl|place|repeat|continue|change|sew|join|slip|remove|pick|finish|casser|couper|rentrer|rabattre|monter|tricoter|placer|r[ée]p[ée]ter|continuer|changer|coudre|joindre|glisser|retirer|relever|terminer)\b/i
// Garde-fou ajouté après mesure corpus (3234 PDF) : LABEL_DOT_RE seul est bien plus large
// que l'intention du correctif (« All sizes. », « Toutes les tailles. ») — il attrapait aussi
// des notes de couleur de fil courtes du corpus réel (« Fil beige. », 2 mots, sans verbe),
// fragmentant à tort des sections de travail (ex. albers-hanging-basket-fr : confiance
// 60 → 49, "PIÈCE PRINCIPALE" passé de 15 à 4 lignes). On borne donc `shortLabelDot` aux
// SEULS titres qui portent un mot de TAILLE.
// ⚠️ CORRECTION (re-revue, 20/08) — le commentaire disait auparavant que ceci « réutilise
// tel quel » le lexique de la famille 'mesures' de KIND_KEYWORDS (ci-dessus) : c'était
// FAUX sur les deux points. Ce n'est PAS ce lexique : KIND_KEYWORDS['mesures'] porte aussi
// mesures|measurements|dimensions|maße|mål|mitat|medidas… (le mot générique « mesure »,
// pas seulement un mot de TAILLE), que SIZE_WORD_RE n'a jamais eu. Et ce n'est PAS une
// réutilisation : SIZE_WORD_RE est un littéral neuf, distinct.
// Mesuré (re-revue) : le lexique de tailles existe en AU MOINS CINQ copies PLEINES dans le
// moteur — segment.js:63 (KIND_KEYWORDS['mesures']), segment.js:474 (SIZE_WORD_RE,
// ci-dessous), sizes.js:226 (SIZE_LINE_RE), sizes.js:232 (SIZE_KEYWORD_ONLY_RE),
// reference.js:515 (entrée 'sizes' des LABELS) — plus une copie PARTIELLE à
// reference.js:329 (NEEDLE_SF_PREFIX, sous-ensemble volontairement réduit pour la
// détection de taille d'aiguille, pas un doublon complet). BARE_SINGLE_MEASURE_RE
// (plus bas dans ce fichier) N'EN FAIT PAS PARTIE : c'est un lexique d'UNITÉS
// (cm|mm|in|po), pas une copie du lexique de TAILLES — à ne pas compter ici.
// Les 5 copies pleines ont déjà DIVERGÉ, sur DEUX mots, pas un seul : `koko` (finnois
// singulier) est présent dans sizes.js:226, sizes.js:232 et reference.js:515, absent de
// segment.js:63 et segment.js:474 (qui n'ont que `koot`, le pluriel) ; `tama[ñn]os`
// (espagnol) est présent dans segment.js:63, segment.js:474 et sizes.js:232, absent de
// sizes.js:226 et reference.js:515. Aucune des 5 copies n'a les deux mots à la fois.
// C'est précisément ce que la leçon M2 (« une garde taille rédigée en double avait déjà
// régressé un dialecte entier ») dit d'éviter, en l'ayant fait quand même, cinq fois.
// NE PAS factoriser ici en urgence de fin de lot : c'est un vrai chantier (unifier les 5
// lexiques sans régresser aucun des 3234 PDF du corpus), noté comme suite à donner, pas
// une correction de commentaire à la volée.
const SIZE_WORD_RE = /\b(?:tailles?|sizes?|gr[öo](?:ß|ss)en?|st[øo]rrelser?|storlek(?:ar)?|koot|tallas?|tama[ñn]os?|taglie|taglia|maten|maat|rozmiar(?:y)?)\b/i
// Factorisée (pas dupliquée) : appelée à la fois par isSpacedTitle (décider si le point
// final est toléré) et par segmentSections (décider si la promotion viderait la section en
// cours, cf. `emptiesPrecedingSection` plus bas — correction, revue).
function isSizeLabelDot(raw) {
  return LABEL_DOT_RE.test(raw) &&
    raw.replace(/\.$/, '').split(/\s+/).length <= 3 &&
    !ACTION_LEAD_RE.test(raw) &&
    SIZE_WORD_RE.test(raw)
}

// Interligne modal (gaps positifs arrondis) : sert d'étalon pour repérer les
// titres « par espacement » dans les mises en page sans gras ni grande police.
function modalLineGap(pages) {
  const counts = new Map()
  for (const page of pages || []) {
    let prevY = null
    for (const l of page) {
      if (prevY != null && prevY - l.y > 0 && prevY - l.y < 60) {
        const g = Math.round(prevY - l.y)
        counts.set(g, (counts.get(g) || 0) + 1)
      }
      prevY = l.y
    }
  }
  let best = 0
  let gap = 0
  for (const [g, nb] of counts) if (nb > best) { best = nb; gap = g }
  return gap
}

// Titre « par espacement » : ligne courte sans ponctuation finale (un « : » nu est
// toléré : « Stem: »), précédée d'un blanc ≥ 1.7 interligne (ou en tête de colonne),
// qui n'est ni un rang ni un « clé : valeur ». Un premier mot TOUT EN CAPITALES
// (« PATTERN – … ») autorise un titre plus long.
//
// Fragment de légende photo (cycle 9, teddy-snuggle-rag-rabbit / sara-doll) : dans un
// tutoriel pas-à-pas dense, un rang coupé par un GRAND BLOC PHOTO (plusieurs vignettes,
// invisibles de pdf.js — aucun texte extrait pour une image) mesure un gap Y géant
// (190-280px) avant sa reprise, très au-dessus du seuil ci-dessus (1,7×modalGap ≈ 15-27px
// sur le corpus) : ce grand blanc vient du bloc photo, pas d'un titre. Signal négatif
// géométrique + lexical : si la ligne SUIVANTE enchaîne à espacement NORMAL (≤ 1,3×modalGap,
// donc pas elle-même précédée d'un bloc photo) et commence par une MINUSCULE, la ligne
// courante est la 1ʳᵉ moitié d'une phrase coupée par un simple retour à la ligne physique,
// pas un titre. Garde CRITIQUE : ce signal ne s'applique JAMAIS si la ligne courante finit
// elle-même par « : » dans le texte ORIGINAL (avant que `:` soit retiré pour former `t`) —
// un vrai titre-étiquette (« Abréviations: », « Abbreviazioni: », « Skróty: ») est très
// souvent suivi d'une ligne de contenu à espacement normal commençant par une clé en
// minuscule (« cm: cercle magique »), géométriquement indiscernable d'une phrase coupée sans
// cette exclusion (mesuré : sans elle, gate −0,0009, boris-the-bee-pl et dino-pram-chain-it
// perdent leur table d'abréviations).
//
// Garde compte de mailles crochet (P0, corpus réel confetti-glass-triangular-shawl-en,
// campagne palier 6) : « Rep rows 2-4 a further 13 times. 258dc » clôt le corps du châle
// juste avant « FINISHING » (MAJUSCULES). Ligne courte, sans ponctuation finale, précédée
// d'un grand blanc de paragraphe → candidate normale à la promotion « par espacement ». La
// garde anti-phrase-coupée ci-dessus ne s'arme QUE si la ligne suivante commence en
// minuscule à espacement normal : ici « FINISHING » est en capitales, donc elle ne
// s'applique pas, et la ligne était promue en titre de section fantôme (0 ligne, sans
// parenthèse donc non rescapable par isRescuableTitle) → jetée en silence par
// mergeEmptyTitledSections, contenu perdu. Une ligne d'instruction qui finit par un compte
// de mailles/rangs de ce format n'est JAMAIS un titre de section légitime dans le corpus
// mesuré : garde SUPPRESS-ONLY (n'autorise jamais une nouvelle promotion, n'en empêche
// qu'une), donc à risque asymétrique et borné (cf. décision documentée).
// Allemand — Piste 2 (remplace le bypass en bloc Piste 1, jugé trop agressif : régression
// mesurée -0,39 sur le gate DE au câblage bout en bout). Signal POSITIF testé sur la ligne CANDIDATE
// elle-même (pas la ligne suivante) : se termine-t-elle sur un mot-outil allemand
// (conjonction/préposition) ou un adjectif décliné en attente d'un nom (« die gesamte ») ?
// Un vrai titre ne se termine jamais ainsi ; une vraie continuation de phrase, souvent.
// Isolé à isGerman : FR/EN/ES gardent le test minuscule inchangé.
const GERMAN_DANGLING_RE = /\b(?:dass|weil|wenn|als|ob|während|bevor|nachdem|auf|an|bei|vor|über|unter|durch|ohne|um|gegen|zwischen|nach|aus|bis|seit)\s*$/i
// Adjectif décliné en attente d'un nom. Liste CHOISIE, pas un suffixe brut : un nom
// féminin allemand complet finit AUSSI en « -e » (« die Länge », « die Masche ») — un
// suffixe seul confondrait un adjectif en attente d'un nom avec un nom déjà complet.
// Liste non exhaustive, à étendre si la jauge révèle un trou (même logique incrémentale
// que DANGLING_RE existant dans reflow.js).
const GERMAN_ADJ_RE = /\b(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+(?:gesamt|restlich|übrig|folgend|nächst|letzt|ganz|ander|gleich)(?:e|en|em|er|es)?\s*$/i
// Phrase de transition à forme VERBALE (« Decrease rounds are worked as follows »,
// « Les diminutions se travaillent comme suit ») : elle annonce ce qui suit, elle ne
// nomme pas une partie du vêtement. Liste FERMÉE de tournures, pas un suffixe : un vrai
// titre du même PDF (« Button Band », « Sleeves », « Buttonholes ») ne porte jamais de
// verbe conjugué.
// Resserré (balayage corpus 3234 PDF) : la branche alternative sans exigence de verbe
// conjugué (juste « as follows: »/« comme suit: » en fin de ligne) rétrogradait à tort de
// vrais titres-étiquettes du corpus (« Work as follows: », « Travailler comme suit: »,
// « Répartir les diminutions comme suit: ») — 11 PDF régressés, dont 3 perdant leur N1
// (sectionnement) : beach-bag-rainbow-en, ombre-beach-bag-fr, rille-dishcloth-fr. Seule la
// forme VERBALE (sujet + verbe conjugué avant la locution) reste gardée : un titre-étiquette
// ne porte jamais lui-même un verbe conjugué entre son sujet et la locution.
const TRANSITION_RE = /\b(?:are|is|se)\s+\w+\s+(?:as follows|comme suit|wie folgt|como sigue)\s*:?\s*$/i
// (bug1, knit-dishcloth-basket-stitch-de-3163a83e) : titre de section réel « Anleitung –
// Siehe Beschreibung mit Bildern weiter unten in der Anleitung: » — pas le mot nu
// « Anleitung » que reconnaît déjà GENERIC_INSTRUCTIONS_TITLE_RE (segmentSections,
// plus bas), mais une phrase COMPLÈTE démarrant par ce même mot-clé, en tête de PAGE
// (donc gap == null, aucun blanc de paragraphe mesurable — cf. branche « tête de
// colonne/page » ci-dessous). Sans ce repli, la ligne dépasse le plafond de 32/70
// caractères de cette branche (73 caractères) et reste absorbée par la section
// glossaire précédente (« Randmasche »/« Würfelmuster ») au lieu d'ouvrir sa propre
// section — les rangs 1-12 et le montage (66 M) se retrouvent alors classés {other}
// sous un titre de glossaire, jamais cochables comme travail. Ancré sur le mot-clé
// EN TÊTE (pas ailleurs dans la ligne) et un « : » final : mêmes deux mots-clés
// fr/es/de que GENERIC_INSTRUCTIONS_TITLE_RE, jamais élargi au-delà (pas de lexique
// neuf). Plafonné à 90 caractères (mesuré 73, marge mesurée mais bornée) pour ne
// jamais avaler un paragraphe entier qui commencerait par hasard par ce mot.
const GENERIC_INSTRUCTIONS_LEAD_RE = /^(?:instructions|instrucciones|anleitung)\b/i

// (bug2, knit-dishcloth-basket-stitch-de-3163a83e) : formule de politesse finale
// allemande (« Viel Spass☺ » / « Viel Spaß beim Stricken! », déjà citée comme formule de
// clôture réelle dans actionable-prose.js à propos de pascal-unisex-slipover-de) — courte,
// sans ponctuation finale reconnue (ici un émoji, jamais un « . »/« ! » simple), précédée
// d'un grand blanc de paragraphe : passe tous les gardes existants d'isSpacedTitle et se
// fait promouvoir en titre de section fantôme. Conséquence mesurée : la ligne de rang
// suivante (« 4. Die letzte Masche lang ziehen… », dernière étape RÉELLE du rabattage)
// se retrouve classée sous ce faux titre au lieu de rester dans la section de travail en
// cours. Garde SUPPRESS-ONLY (comme isToolSizeChangeLine/isSizeLabelDot ci-dessus) :
// n'autorise jamais une promotion nouvelle, n'en empêche qu'une — risque asymétrique et
// borné. Ancrée sur le seul mot-clé mesuré (« Viel Spaß »/« Viel Spass », les deux
// orthographes allemande et suisse) plutôt qu'une liste multilingue devinée : à étendre
// quand un autre cas réel du corpus l'exigera, pas par anticipation.
// « (?!\p{L}) », pas « \b » : « ß » n'est PAS un caractère de mot pour \b en JS sans
// portée Unicode (seul [A-Za-z0-9_] compte) — \b échouait donc juste après un « ß » suivi
// d'un espace ou d'un émoji (le cas RÉEL de ce PDF), l'orthographe allemande ne bloquait
// alors JAMAIS la promotion (repéré en écrivant le test de non-régression : seul
// SENTENCE_END_RE, sur le « ! » final du témoin, masquait ce trou). Le négatif Unicode
// exige `u`, d'où aussi `i` recombiné en `iu` plutôt que deux flags séparés.
const CLOSING_FORMULA_RE = /^viel spa[ßs]s?(?!\p{L})/iu
function isClosingFormula(text) {
  return CLOSING_FORMULA_RE.test(String(text ?? '').trim())
}
// Titre de VARIANTE PAR TAILLE (« Sizes 2 and 5 only », « Size 4 only », « All sizes »,
// « Tailles 2 et 5 uniquement ») : hissé au niveau du module (au lieu d'une déclaration locale
// dans segmentSections, plus bas) pour servir DEUX usages avec un seul détecteur — cf.
// commentaire de sectionHasRowLine plus haut, même principe (« deux copies divergeraient en
// silence ») : segmentSections l'utilise pour faire hériter le kind de la section précédente
// (sans quoi ces titres tombent en {other} au lieu de {body}, PDF réel Mia Cardigan), et
// isSpacedTitle ci-dessous l'utilise pour relâcher son plafond de longueur (cf. commentaire à
// son point d'usage : bug lucent-sweater-en, où deux formes JUMELLES de la même étiquette
// franchissaient ou non le plafond générique selon un pur hasard de longueur des codes de
// taille listés).
const SIZE_VARIANT_TITLE_RE =
  /^(?:sizes?|tailles?|gr[öo]ssen?|gr[öo][ßs]e|tallas?|maten?)\b.*\b(?:only|uniquement|nur|solo|s[óo]lo|alleen)\b|^(?:all sizes|toutes les tailles|alle gr[öo]ssen|alle gr[öo][ßs]en|todas las tallas|alle maten)\b/i
// Groupe parenthésé de codes de taille COURTS (« (S, M, L, XL) », « (-, 3XL, -, -) ») : chaque
// token séparé par virgule fait AU PLUS 4 caractères. Sert UNIQUEMENT à isSpacedTitle (cf. son
// commentaire, plus bas, à l'usage de sizeVariantLead) pour écarter une phrase de PROSE
// ordinaire qui contiendrait incidemment le vocabulaire de SIZE_VARIANT_TITLE_RE (« Sizes for
// this pattern are only approximate: ») — aucun mot de prose réel du corpus (« measurements »,
// « approximate »…) ne tient dans 4 caractères, contrairement à un vrai code de taille (« S »,
// « XL », « 2XL », « - »…). N'affecte QUE cet usage : SIZE_VARIANT_TITLE_RE reste seul pour
// l'héritage de kind dans segmentSections, où des titres courts déjà couverts (« Sizes 1 and 4
// only », sans parenthèses) doivent continuer à matcher tels quels.
const SIZE_VARIANT_GROUP_RE = /\(\s*[\w-]{1,4}(?:\s*,\s*[\w-]{1,4}){1,}\s*\)/
export function isSpacedTitle(line, gap, modalGap, nextLine, nextGap, isGerman = false) {
  if (looksLikeTableRow(line.text)) return false
  if (isGlossaryEntryTitle(line.text)) return false
  if (isClosingFormula(line.text)) return false
  // Garde changement d'outil (cf. isToolSizeChangeLine ci-dessus, palier 7/8) : testée sur
  // line.text ORIGINAL, AVANT que `t` ne retire le « : » final — c'est ce « : » qui signe une
  // consigne de rang, jamais un titre-étiquette. Chemin réel de promotion du bug (vérifié
  // sur les données pdf.js réelles : les deux lignes candidates sont bold=false, isTitleLine
  // les rejetait déjà ; c'est ICI, dans le repli par espacement, qu'une seule des deux —
  // la plus courte, sous le plafond 42 caractères de `t` ci-dessous — était promue à tort).
  if (isToolSizeChangeLine(line.text)) return false
  const t = line.text.replace(/\s*:\s*$/, '')
  if (TRANSITION_RE.test(t)) return false
  const capsLead = /^\p{Lu}{4,}\b/u.test(t)
  // Ligne démarrant par un mot-clé générique d'instructions (« Anleitung – Siehe … »)
  // ET finissant par « : » : cf. commentaire GENERIC_INSTRUCTIONS_LEAD_RE ci-dessus.
  // Doit être vérifiée sur line.text (pas `t`, qui vient de perdre son « : » final).
  // Restreinte à `gap == null` (tête de page/colonne, seul cas mesuré sur le PDF réel) :
  // ne relâche PAS le plafond de la branche « gap != null » (blanc de paragraphe en
  // milieu de page), jamais vérifiée sur un témoin réel et où « instructions »/
  // « instrucciones » (bien plus fréquents que « Anleitung » en tête de phrase) pourraient
  // promouvoir à tort une consigne ordinaire commençant par ce mot.
  const genericLeadColon = gap == null && GENERIC_INSTRUCTIONS_LEAD_RE.test(t) && /:\s*$/.test(line.text)
  // Étiquette de VARIANTE PAR TAILLE (« Sizes … only: », cf. SIZE_VARIANT_TITLE_RE au niveau
  // du module, juste avant cette fonction) : le plafond générique (42 caractères) départage à
  // tort deux formes JUMELLES de la même construction, selon un pur hasard de longueur des
  // codes de taille qu'elles énumèrent — jamais selon la présence ou non d'un « - » (taille
  // placeholder) juste après « Sizes »/« Tailles ». Cas réel lucent-sweater-en (banc vague
  // 4, patron à 9 tailles réparties en 1 taille nue + 2 groupes de 4) : « Sizes XS (-, -, -,
  // -) (2XL, -, 4XL, 5XL) only: » (45 caractères, taille nue retenue « XS ») dépasse le
  // plafond et reste une simple annotation dans la section courante, tandis que sa jumelle
  // structurelle « Sizes - (S, M, L, XL) (-, 3XL, -, -) only: » (41 caractères, taille nue
  // EXCLUE donc remplacée par un tiret) passe SOUS le plafond et devient une section H2
  // autonome — même contexte (juste après un « Rows N-M: … » dans BACK+FRONT), traitement
  // incohérent SEULEMENT à cause de la longueur des codes listés (« 2XL »/« 3XL »/« 4XL »/
  // « 5XL », 3 caractères, contre « S »/« M »/« L », 1 caractère). Plafond choisi (65) au-delà
  // du pire cas mesuré sur les 6 langues couvertes par SIZE_VARIANT_TITLE_RE (56 caractères,
  // « Tailles 5XL (XS, S, M, L) (XL, 2XL, 3XL, 4XL) uniquement »), avec une marge modérée —
  // bien en-deçà des plafonds capsLead/genericLeadColon (70/90), le motif étant beaucoup plus
  // restreint que les leurs. Restreint, comme genericLeadColon, à une ligne qui se termine par
  // « : » (sur line.text ORIGINAL, avant que `t` ne perde ce « : ») : un deux-points signe une
  // étiquette qui annonce ce qui suit, jamais une phrase de prose ordinaire qui contiendrait
  // incidemment ce vocabulaire de taille.
  // Garde supplémentaire (revue) : le « : » seul ne suffit pas à écarter toute prose — une
  // phrase ordinaire qui contient incidemment le vocabulaire « Sizes … only » ET se termine
  // par « : » (« Sizes for this pattern are only approximate: », 43 caractères, DANS la
  // fenêtre 43-65 relâchée) matchait encore SIZE_VARIANT_TITLE_RE et aurait été promue à tort
  // dès qu'un vrai blanc de paragraphe existe au-dessus — l'heuristique de blanc
  // (1,7×modalGap, plus bas) ne suffit pas seule à l'écarter, un vrai blanc précédant
  // N'IMPORTE QUEL nouveau paragraphe. SIZE_VARIANT_GROUP_RE (module, cf. son commentaire)
  // exige donc EN PLUS un vrai groupe parenthésé de codes de taille courts dans la ligne.
  const sizeVariantLead =
    SIZE_VARIANT_TITLE_RE.test(t) && /:\s*$/.test(line.text) && SIZE_VARIANT_GROUP_RE.test(line.text)
  // `capsLead` passe avant `genericLeadColon` dans ce ternaire, sans incidence réelle :
  // un mot-clé générique (« Anleitung »/« Instructions »/« Instrucciones ») commence par
  // une seule majuscule, jamais 4 majuscules consécutives — les deux conditions sont
  // mutuellement exclusives, l'ordre du ternaire ne change donc jamais le résultat. Même
  // raisonnement pour sizeVariantLead, testé en dernier : un titre à variante par taille
  // commence par « Sizes »/« Tailles »/… (1 majuscule), jamais 4 majuscules consécutives ni
  // le vocabulaire d'instructions générique.
  if (t.length < 3 || t.length > (capsLead ? 70 : genericLeadColon ? 90 : sizeVariantLead ? 65 : 42)) return false
  // Point final toléré sur une ÉTIQUETTE très courte sans verbe (« All sizes. »,
  // « Toutes les tailles. ») : PDF réel Mia Cardigan, où les 5 lignes « All sizes. »
  // ouvrent une variante par taille et où le SEUL discriminant mesuré est ce point
  // (« All sizes » sans point était déjà promu). Périmètre volontairement ÉTROIT — le
  // même PDF porte « Break the yarn. » et « Weave in all ends. », 3 et 4 mots, qui
  // doivent RESTER du texte : d'où la limite à 3 mots ET 20 caractères ET l'absence de
  // verbe d'action en tête (liste fermée, pas un suffixe). Le « : » nu reste toléré en
  // amont par le .replace() ci-dessus, inchangé.
  // `gap != null` exigé : le témoin réel (Mia Cardigan) porte un vrai blanc de paragraphe
  // mesuré (26,6). Sans cette borne, l'exception fuit dans le repli « tête de colonne/page »
  // (gap == null, aucun espacement à vérifier) et promeut à tort de la prose générique à
  // point final (« Ligne un. », « Ligne deux. »…) — régression vue sur
  // pdf-import-segment.spec.js, fixture à lignes toutes en y=0.
  const raw = line.text.trim()
  const shortLabelDot = gap != null && isSizeLabelDot(raw)
  if (!shortLabelDot && SENTENCE_END_RE.test(t)) return false
  if (STITCH_COUNT_END_RE.test(t)) return false
  if (ROW_START_RE.test(t) || /^\d/.test(t) || KV_RE.test(t)) return false
  if (!/^\p{Lu}/u.test(t)) return false
  // Tête de colonne / de page : aucun blanc n'est mesurable avant la ligne, on ne peut
  // pas s'appuyer sur l'espacement. Le plafond était ici de 32 caractères ET 4 mots,
  // bien plus serré que le plafond de la branche normale (42 caractères, AUCUNE limite
  // de mots). PDF réel Mia Cardigan : « Sizes 2 and 5 only: » (5 mots) et « Sizes 8, 9,
  // 10, and 11 only: » (7 mots) ouvrent une colonne et étaient rétrogradés en remarque —
  // leurs rangs partaient dans la section précédente, donc les mauvaises cases à cocher.
  // Témoin discriminant : « Size 4 only: » (3 mots, MÊME position) passait déjà.
  // On aligne sur la branche normale (42 caractères) et on lève la limite de mots
  // SEULEMENT quand la ligne se termine par « : » — un deux-points signe une étiquette
  // qui annonce ce qui suit, jamais une phrase de prose coupée par la colonne.
  // Resserrement mesuré (deuxième passe, balayage corpus 3234 PDF) : la version SANS
  // exigence de chiffre faisait reculer 2 patrons du corpus (N1 : knit-baby-hat-cotton-fr,
  // N2 : alice-slipover-pl). Cause dans les deux cas : un texte de tête de colonne SANS
  // aucun chiffre, qui n'est jamais une étiquette de taille — un bandeau de vente croisée
  // (« Obtenez votre fil et vos accessoires ici: », mot-clé « fil » en collision, avale la
  // vraie section Abréviations qui suit) ou un sous-titre générique (« Jak połączyć obie
  // przednie części: », qui reclasse des rangs cochables en notes non cochables). Toutes
  // les étiquettes de taille réelles mesurées (« Sizes 2 and 5 only: », « Sizes 8, 9, 10,
  // and 11 only: », « Only sizes XS, 2XL, 3XL, 4Xl and 5XL: ») portent AU MOINS un chiffre
  // — une étiquette de taille sans aucun chiffre n'a pas de sens. On restreint donc
  // l'exception « : » à un candidat qui porte au moins un chiffre : narrows le périmètre,
  // ne l'élargit pas — aucun des 9 témoins isSpacedTitle existants ne porte de
  // ligne à promouvoir sans chiffre.
  // Le plafond ÉTROIT (32 caractères ET 4 mots) reste évalué EN PREMIER, sans exigence de
  // chiffre : « Gauge: », « Échantillon: » (courts titres-étiquettes déjà promus avant
  // ce resserrement) doivent continuer à passer même sans chiffre. Un retour anticipé sur la seule
  // branche « : » aurait cassé ce cas (témoin pdf-import-segment.spec.js, « coupe toujours
  // sur un vrai rang après une phrase terminée », trouvé en régression lors d'une passe antérieure).
  // Titre à tête MAJUSCULE (« PEACOCK PATTERN ») suivi d'une précision entre parenthèses
  // en minuscules (« (aka wave pattern) ») : capsLead (ci-dessus) l'admet déjà dans le
  // plafond de longueur GÉNÉRAL (70 au lieu de 42, testé plus haut), mais cette branche
  // « tête de colonne/page » (gap == null, aucun blanc mesurable — le cas EXACT d'un
  // titre posé en toute première ligne d'une nouvelle page) porte son PROPRE plafond,
  // plus étroit (32 caractères ET 4 mots), sans jamais consulter capsLead. Bug réel
  // (peacock-shawl-in-kid-silk-en, campagne 27/08, corpus réel) : « PEACOCK PATTERN
  // (aka wave pattern) » (34 caractères, 5 mots) ouvre la page 3, juste après le
  // bandeau « Hashtags for social media » de la page 2 — bold=false et même taille de
  // police que le corps (isTitleLine le rejette aussi, cf. ce fichier), donc SEUL ce
  // repli par espacement peut le promouvoir. Faute de la relaxation capsLead ici, la
  // définition du point (4 rangs) tombe en contenu du bandeau réseaux sociaux au lieu
  // d'ouvrir sa propre section — perte de la structure la plus utile du patron.
  // Relaxation restreinte à capsLead (même garde que la branche générale, aucune
  // extension supplémentaire) : le plafond de mots tombe SEULEMENT quand la ligne
  // porte déjà ce signal fort (4+ majuscules consécutives en tête), jamais pour une
  // étiquette ordinaire.
  if (gap == null) {
    if (t.length <= (capsLead ? 70 : 32) && (capsLead || t.split(/\s+/).length <= 4)) return true // tête de colonne/page
    const endsWithColon = /:\s*$/.test(line.text)
    if (genericLeadColon) return true // déjà borné à 90 caractères par le plafond ci-dessus
    // Même relâchement que le plafond général plus haut (65 au lieu de 42) pour
    // sizeVariantLead : cette branche « tête de colonne/page » a son PROPRE plafond de repli,
    // séparé de celui testé en tête de fonction — sans le consulter ici aussi, une étiquette
    // « Sizes … only: » de 43 à 65 caractères qui tombe EN TÊTE DE COLONNE (gap == null,
    // au lieu du blanc de paragraphe mesuré en milieu de page) rouvrirait la même
    // incohérence entre formes jumelles que le correctif visait à éliminer (revue :
    // lucent-sweater-en n'expose que la branche gap != null, mais rien ne garantit qu'un
    // futur PDF du corpus ne place pas la même étiquette en tête de page/colonne).
    return endsWithColon && t.length <= (sizeVariantLead ? 65 : 42) && /\d/.test(t)
  }
  if (!(modalGap > 0 && gap >= 1.7 * modalGap)) return false
  const endsWithColon = /:\s*$/.test(line.text)
  // Le test minuscule reste valide EN PLUS du signal allemand, pas remplacé par lui —
  // même raisonnement que shouldJoin (reflow.js).
  const germanLooksIncomplete = isGerman && (GERMAN_DANGLING_RE.test(t) || GERMAN_ADJ_RE.test(t))
  if (
    !endsWithColon && nextLine && nextGap != null &&
    modalGap > 0 && nextGap <= 1.3 * modalGap &&
    (/^\p{Ll}/u.test(nextLine.text) || germanLooksIncomplete)
  ) {
    return false
  }
  return true
}

// Légende de symbole de diagramme : « = <description> » où la description porte des LETTRES
// (≥3 consécutives) — donc pas un simple calcul « = 60 m. ». Sert à reconnaître un LABEL de
// diagramme (ex. « Dos-Devant » du kit Phildar torsades) qui précède sa légende de symboles :
// promu en section (via son espacement), il couperait la vraie section de travail voisine et
// happerait le contenu qui suit (façonnage par taille des manches). Cf. reference torsades p2.
export const SYMBOL_LEGEND_RE = /^\s*=\s*.*\p{L}{3,}/u

// Premier correctif (mesure 3187 PDF, revue) — puce/numérotation ASCII simple
// tolérée avant le verbe d'action d'une consigne de travail (cf. commentaire au point
// d'usage) : « -/*/• » ou « 1./1) ». Un symbole décoratif (« ☆ ») n'y figure PAS.
const LEADING_MARKER_RE = /^(?:[-*•]\s*|\d{1,2}[.)]\s*)/

export function segmentSections(pages, { isGerman = false, onMerge = null } = {}) {
  const all = (pages || []).flat()
  const bodySize = modalBodySize(all)
  const modalGap = modalLineGap(pages)
  // gap avant chaque ligne (null en tête de colonne : y remonte ou page nouvelle)
  const gaps = new Map()
  for (const page of pages || []) {
    let prevY = null
    for (const l of page) {
      const g = prevY != null ? prevY - l.y : null
      gaps.set(l, g != null && g > 0 ? g : null)
      prevY = l.y
    }
  }
  const pageOf = new Map()
  ;(pages || []).forEach((page, i) => page.forEach((l) => pageOf.set(l, i)))
  const sections = []
  let cur = null
  // Texte de la ligne précédente : sert uniquement à savoir si elle a laissé une phrase
  // ouverte (cf. la soupape de sûreté plus bas).
  let prevLineText = ''
  for (let idx = 0; idx < all.length; idx++) {
    const line = all[idx]
    const strongTitle = isTitleLine(line, bodySize)
    // Dans un bloc ÉCHANTILLON déjà ouvert (cur.ref === 'echantillon'), on n'arme PAS le
    // repli faible isSpacedTitle (aucun signal fort de gras/majuscules/grande police) : un
    // simple saut de paragraphe DANS le bloc y est fréquent (phrase de continuation) et une
    // repromotion y coupe la phrase en deux avec perte de contenu (cf. Umber Cloud « Always
    // use the needle size that gives you », scindée dans le bloc GAUGE — kindForTitle la
    // classe 'aiguilles' via « needle »). strongTitle reste actif : ses signaux sont fiables
    // même en section référence. Restreint à 'echantillon' (jamais materiel/fil/abbr/mesures/
    // aiguilles) : sur plusieurs patrons du corpus (delight-tube-fr, classical-attitude-
    // poncho-fr, curly-baby-duckling-nl, donkey-baby-comforter-en), le bloc MATÉRIEL/FIL/
    // ABRÉVIATIONS ne compte AUCUN signal fort pour ses titres suivants (Abréviations, Tour 1,
    // Patroon…) — seul l'espacement les détecte ; désarmer isSpacedTitle y avale alors tout le
    // reste du patron dans une unique section référence (régression −0,05 à −0,18 de fidélité
    // mesurée). Restreindre à 'echantillon' élimine ces régressions (gate 25 refs identique au
    // bit près, y compris les 13 refs qui ONT un bloc {gauge} : leur contenu interne ne
    // contient simplement aucune ligne à grand blanc — le gate ne couvre donc PAS ce chemin,
    // il prouve seulement l'absence de régression sur les autres kinds ref). Seule preuve
    // positive du chemin echantillon : Umber Cloud (hors gate). Risque résiduel assumé : un
    // bloc échantillon suivi d'un VRAI titre qui ne porterait QUE le signal spacing (sans gras/
    // majuscules/grande police) serait, comme materiel/fil/abbr, avalé à tort — non observé
    // dans le corpus mesuré, non exclu ailleurs.
    // [Un arbitrage, 03/09/2026 — limite assumée pour la 1.0] : le risque résiduel ci-dessus
    // s'est matérialisé UNE fois en vague 7 (knit-domino-shawl-de : « Anleitung – Siehe… »
    // ne referme pas la jauge, 4 lignes d'intitulés déversées dans la carte Échantillon ;
    // les rangs ordinaux « 1.Reihe » referment désormais la soupape plus tôt — cf. 7ef3c237 —
    // mais le titre lui-même reste avalé). Armer génériquement le repli faible dans la jauge
    // exigerait de re-passer le gate complet : reporté à post-1.0 avec le chantier BARE_COUNT.
    const nextLine = all[idx + 1]
    // Libellé de MESURE (« Bust circumference of finished garment: »,
    // « Yoke depth: », « Recommended length of finished sleeve: ») : bold=false dans le
    // PDF réel Mia Cardigan (vérifié empiriquement, isTitleLine les rejette déjà toutes),
    // mais le repli isSpacedTitle les promeut par simple espacement — la ligne SUIVANTE, à
    // l'intérieur d'une section « Tailles » déjà ouverte, ne porte alors qu'un vecteur de
    // tailles ou une valeur de mesure seule, jamais une consigne. Un vrai titre de section
    // (« Yoke », « Sleeves ») est TOUJOURS suivi d'une CONSIGNE (verbe + texte), jamais
    // d'un nombre seul. Restreint à `cur?.ref === 'mesures'` (section Tailles déjà
    // ouverte) : hors de là, une ligne suivie d'un vecteur de tailles est une consigne de
    // travail parfaitement normale (« Cast on 99 (99, 101, 101, 101) … sts. », corpus
    // mesuré) et ne doit jamais être désarmée — d'où ce garde posé ICI, au site d'appel
    // (isSpacedTitle n'a pas connaissance de `cur`), plutôt que dans isSpacedTitle
    // lui-même, ce qui l'aurait appliqué sans discrimination à TOUT le corpus.
    const measureLabelFollowedByBareValue =
      cur?.ref === 'mesures' && !/\d/.test(line.text) &&
      !!nextLine && isBareSizeVectorLine(nextLine.text)
    // V2a : une rangée de GRILLE APPARIÉE (readPairedGrid) n'est jamais un
    // titre « par espacement ». Dans le flux unique de la grille, chaque ligne de la 2ᵉ
    // colonne suit sa jumelle de rangée à Y IDENTIQUE — gap nul, donc « tête de
    // colonne » aux yeux d'isSpacedTitle — et chaque clé courte s'y faisait promouvoir
    // en titre de section : le glossaire entier se retrouvait éclaté en sections d'une
    // ligne (« ## REP repeat », « ## St st stockinette stitch » — loupy p4 ; « ## FLO
    // Front Loops Only » — mini-kawaii p1) AVANT que le routage abbr d'assemble.js ne
    // puisse le lire en colonnes. Garde SUPPRESS-ONLY au site d'appel, comme
    // measureLabelFollowedByBareValue voisin (le flag porte le contexte, pas la
    // fonction) ; strongTitle reste actif — gras/majuscules/grande police restent des
    // signaux fiables, même sur une rangée de grille.
    const spacedTitle =
      cur?.ref !== 'echantillon' && !measureLabelFollowedByBareValue && !line.pairedRow &&
      isSpacedTitle(line, gaps.get(line), modalGap, nextLine, gaps.get(nextLine), isGerman)
    const titled = strongTitle || spacedTitle
    // Label de diagramme FAIBLE (« Dos-Devant ») : détecté seulement par espacement (ni gras,
    // ni majuscules, ni grande police), plus petit que le corps, sans « : » final, et suivi
    // IMMÉDIATEMENT d'une légende de symbole « = <texte> ». Ce n'est pas une section de
    // travail : le promouvoir couperait la section courante et happerait le contenu suivant
    // (façonnage par taille). On ne l'ouvre pas → il retombe dans la section courante.
    const isDiagramLabel =
      titled && !strongTitle && Math.round(line.size) < bodySize &&
      !/:\s*$/.test(line.text) && !!nextLine &&
      pageOf.get(nextLine) === pageOf.get(line) && // la légende est sur la MÊME page que le label
      SYMBOL_LEGEND_RE.test(nextLine.text)
    // Étiquette de taille à point final (« All sizes. », correction) : si
    // c'est la TOUTE PREMIÈRE ligne de la section en cours (cur.lines encore vide), la
    // promouvoir viderait cette section — mergeEmptyTitledSections (assemble.js) jette alors
    // son titre EN SILENCE s'il n'est pas rescapable (pas de parenthèse), perte d'un titre
    // réel (mesuré : Mia Cardigan, « ## Body » disparaissait, remplacé par « ## All sizes. »
    // à sa place — le fichier idéal veut les DEUX : « ## Body » PUIS « > All sizes. » en
    // note dans son corps). Repli identique à isDiagramLabel : on ne l'ouvre pas, la ligne
    // retombe dans la section déjà ouverte. Restreint à shortLabelDot (le point final n'est
    // TOLÉRÉ que par cette exception ; le repli espacement général, lui, n'a jamais laissé un
    // titre au point final passer jusqu'ici, donc aucun risque de toucher un autre
    // chemin de promotion).
    // Même risque, second chemin : la branche « tête de colonne, finit par : »
    // ci-dessus (isSpacedTitle, gap == null) promeut désormais des titres plus longs que 4
    // mots. Si un tel titre est la TOUTE PREMIÈRE ligne de la section en cours, même
    // perte silencieuse que ci-dessus. Témoin : pdf-import-segment.spec.js, « Sleeves »
    // suivi immédiatement de « Only sizes XS, 2XL, 3XL, 4Xl and 5XL: » AVANT tout contenu
    // (Juice_Sweater_by_Kutovakika, corpus réel) — sans ce repli, « ## Sleeves » disparaît
    // en silence, remplacé par « ## Only sizes... ». Repli identique : on ne l'ouvre pas.
    // Restreint à une section en cours dont le titre est un VRAI titre de rubrique
    // reconnu (kindForTitle truthy), PAS à n'importe quelle section : un `strongTitle`
    // (gras/majuscules/grande police) SEUL ne suffit pas à distinguer un vrai titre d'un
    // faux positif — mesuré en régression sur le corpus (3234 PDF),
    // flamingo-love-blanket-de-f1f48ccf : chaque ligne d'une simple liste de coloris de
    // fil (« White (#1) - 1 Knäuel », « Sunflower (#36) - 1 Knäuel »…) est classée
    // `strongTitle` par isTitleLine (taille/police de la page de garde) SANS être un vrai
    // titre — kindForTitle n'y reconnaît aucun mot-clé (`null`). Protéger une section
    // pareille contre le vidage empêchait le VRAI titre qui suit (« Abkürzungen: », lui
    // aussi en tête de colonne) de s'ouvrir ; comme "Sunflower..." n'était PLUS vidée, le
    // filet de rattrapage post-boucle (plus bas, isMiniLabel/demote — justement prévu pour
    // ces étiquettes sans kind) n'avait plus rien à nettoyer : tout le glossaire ET le
    // patron grille (212 abréviations, 245 lignes) se retrouvaient avalés sous
    // « ## Sunflower... ». On exclut symétriquement le cas déjà couvert par ce même filet
    // pour `kind==='fil'` (collision de mot-clé, cf. refKeywordCollision plus bas) : c'est
    // exactement le cas mesuré sur knit-baby-hat-cotton-fr-9ffabfc0 (bandeau de vente
    // croisée « Obtenez votre fil et vos accessoires ici: ») qui a motivé ce garde-fou —
    // s'il reste protégé ici, cette 2ᵉ régression revient. Un titre de rubrique RÉEL
    // (« Sleeves » → manche, « Body » → corps) n'est, lui, JAMAIS rattrapable par ce filet
    // (kind non vide, pas 'fil') : il reste protégé.
    // Factorisée : les deux gardes ci-dessous (emptiesHeadOfColumnColon et
    // emptiesRealTitleWithColorAnnouncement) partent toutes deux de « cur a été ouvert par
    // une ligne formatée comme un vrai titre (gras/majuscules/grande police) ».
    const curTitleLineIsStrong = !!cur?.titleLine && isTitleLine(cur.titleLine, bodySize)
    const curKind = cur?.titleLine ? kindForTitle(cur.title) : null
    const curRescuableIfEmptied = !curKind || isFilKeywordCollision(curKind, cur.title)
    const curWasStrongTitle = curTitleLineIsStrong && !curRescuableIfEmptied
    const emptiesHeadOfColumnColon =
      curWasStrongTitle && gaps.get(line) == null && /:\s*$/.test(line.text.trim())
    // cf. YARN_COLOR_ANNOUNCEMENT_RE ci-dessus : ici on ne réutilise PAS curWasStrongTitle
    // (qui exige `!curRescuableIfEmptied`, donc un `kind` reconnu par kindForTitle OU une
    // collision « fil ») — on retient curTitleLineIsStrong SEUL. Raison : « Cheeks (Make 2) »
    // n'est reconnu par AUCUN mot-clé de rubrique (curKind=null) alors que son titre est
    // tout aussi réel et gras que « Head » (curKind='tete') — exiger curRescuableIfEmptied
    // ici laisserait « Cheeks » se faire vider par « In pink yarn », l'un des deux cas
    // mesurés que ce garde doit justement couvrir (cf. commentaire ci-dessus). Aucun
    // recoupement dangereux avec l'usage existant de curWasStrongTitle : les deux gardes
    // sont des ALTERNATIVES dans le même OR (emptiesPrecedingSection, plus bas), jamais
    // combinées — élargir le signal ici ne change pas ce que emptiesHeadOfColumnColon
    // décide pour sa propre ligne candidate (finit par « : », gap==null), un motif que
    // YARN_COLOR_ANNOUNCEMENT_RE ne matche de toute façon jamais (« In... » ne finit pas
    // par « : », cf. son commentaire).
    const emptiesRealTitleWithColorAnnouncement =
      curTitleLineIsStrong && YARN_COLOR_ANNOUNCEMENT_RE.test(line.text.trim())
    const emptiesPrecedingSection =
      titled && !strongTitle && !!cur && cur.lines.length === 0 &&
      (isSizeLabelDot(line.text.trim()) || emptiesHeadOfColumnColon || emptiesRealTitleWithColorAnnouncement)
    // Bug réel moss-stitch-basket-square-fr-d86efcef (vague 6, Retours-banc, Go Handmade,
    // paniers crochet 3 tailles) : le titre fort dimensionnel « Panier 15 x 15 x H 9 cm »
    // (size 14 sur un corps à 8, NON gras — promu par la seule grande police d'isTitleLine)
    // est immédiatement suivi de la sous-étiquette faible « Le fond: » (size 8, gap 29 pour
    // un interligne modal ~9 → promue par isSpacedTitle), puis de rangs, puis « Les parois: »
    // idem, puis « Panier 18 x 18 x H 10 cm », etc. Chaque sous-étiquette ouvrait sa propre
    // section, laissant la section « Panier … » refermée VIDE : mergeEmptyTitledSections
    // (assemble.js) la jette alors en silence — isRescuableTitle exige une parenthèse — et
    // les TROIS titres de taille disparaissaient du document (sizes: T1·T2·T3 fabriqués en
    // repli, cf. detectSizeLabels). La sous-étiquette doit retomber en LIGNE de la section
    // dimensionnelle courante (chemin commun ci-dessous, comme isDiagramLabel et
    // emptiesPrecedingSection : pas de `continue` spécial).
    // Contre-exemple flamingo-love-blanket-de-f1f48ccf (cf. emptiesHeadOfColumnColon plus
    // haut) : un faux titre fort NON dimensionnel (« Sunflower (#36) - 1 Knäuel », page de
    // garde) suivi d'un vrai titre faible (« Abkürzungen: ») ne doit PAS être protégé —
    // c'est le discriminateur DIMENSIONNEL (DIMENSIONAL_SIZE_TITLE_RE, sizes.js) qui fait
    // tout le travail, PAS le signal kind : ici, comme emptiesRealTitleWithColorAnnouncement,
    // on retient curTitleLineIsStrong SEUL (exiger curRescuableIfEmptied laisserait « Panier
    // … » — kindForTitle null — sans protection, exactement le bug mesuré).
    // Portée STICKY voulue : la condition porte sur le TITRE de cur, pas sur
    // cur.lines.length === 0 — elle couvre « Le fond: » (cur vide) ET « Les parois: » (cur
    // déjà alimenté). BORNES : candidat FAIBLE uniquement (un vrai titre fort suivant,
    // ex. « Panier 18 … », referme normalement la section) ; « : » final ; ≤ 4 mots (une
    // étiquette plus longue reste une vraie rubrique) ; jamais une étiquette de kind
    // référence (REF_KEYS — « Matériel: » sous un « Panier … » ouvre sa rubrique).
    // Résiduel assumé : la borne kind ne couvre que les kinds RÉFÉRENCE — une étiquette
    // faible d'un kind de TRAVAIL non-référence (p. ex. « Finitions: ») serait absorbée
    // elle aussi sous le titre dimensionnel ; aucun cas mesuré dans le corpus (sweep 3122
    // du 04/09, seul moss-stitch change).
    // Garde SUPPRESS-ONLY au site d'appel comme ses voisines.
    const subLabelUnderDimensionalTitle =
      titled && !strongTitle && !!cur && curTitleLineIsStrong &&
      DIMENSIONAL_SIZE_TITLE_RE.test(String(cur.title).trim()) &&
      /:\s*$/.test(line.text.trim()) &&
      line.text.trim().split(/\s+/).length <= 4 &&
      !REF_KEYS.has(kindForTitle(line.text) || '')
    if (titled && !isDiagramLabel && !emptiesPrecedingSection && !subLabelUnderDimensionalTitle) {
      let key = kindForTitle(line.text)
      // Bandeaux de couverture/vente écartés d'emblée (bruit) : bandeau craft
      // (page 0, court, capitales/gras) et accroche de vente croisée (partout).
      const t0 = line.text.trim()
      const page0 = (pageOf.get(line) ?? 0) === 0
      const capsOrBold = line.bold || (t0 === t0.toUpperCase() && /[A-ZÀ-Ý]/.test(t0))
      if ((page0 && capsOrBold && t0.length <= 32 && CRAFT_BANNER_RE.test(t0)) || CROSS_SELL_RE.test(t0)) {
        key = 'noise'
      }
      // Aide-mémoire (cas réels Juice_Sweater_by_Kutovakika) — un titre qui matche
      // un mot-clé de rubrique référence n'en est pas forcément une : une entrée de
      // glossaire (« DPN = double pointed needle », le mot « needle » déclenche à tort la
      // clé aiguilles) ou une consigne de travail (« Join new yarn and work as follows »,
      // le mot « yarn » déclenche à tort la clé fil) prennent la même forme courte/grasse
      // qu'un vrai titre sans en être un. Écartées ICI, AVANT la création de la section :
      // pas de `continue`, la ligne retombe dans le chemin commun plus bas (comme une ligne
      // non titrée), attachée à la section déjà ouverte — jamais une nouvelle section,
      // jamais perdue. Détecteurs réutilisés tels quels, aucun vocabulaire inventé :
      // execAbbrLine (reference.js, structure « clé = définition ») et hasActionableVerb
      // (actionable-prose.js, vocabulaire fermé mesuré sur 160 PDF FR/EN/ES/DE).
      //
      // Premier correctif (mesure 3187 PDF, revue) — la version initiale des deux gardes
      // était trop large et perdait 6 rubriques légitimes :
      //
      // 1. Glossaire : un vrai titre référence contient parfois un « = »/tiret dans son
      //    énoncé sans être une entrée de glossaire (« Gauge 18 sts x 24 rows= 4"/10cm in
      //    pattern », « Stickfasthet – stickad enligt diagram », « Tensione della maglia a
      //    coste: 1 dir, 1 », « Obwód w klatce piersiowej od-do: Próbka », « US 9 - 5.5mm
      //    NEEDLES »). Discriminant déjà utilisé par reference.js pour son propre balayage
      //    global (ligne ~982, `m[1].trim().length <= 8 && !/\s/.test(...)`) : une VRAIE
      //    clé de glossaire est courte ET sans espace (« DPN », « DS »…) ; les 5 titres
      //    ci-dessus ont une clé longue et/ou espacée. Même critère réutilisé ici tel quel.
      //
      // 2. Consigne de travail : une consigne commence TOUJOURS par son verbe (« Join new
      //    yarn and work as follows », « Work German Short Rows as follows »), un titre ne
      //    le fait jamais même s'il contient le même mot plus loin (« How to Join Squares »,
      //    « How to Change Colours » : le verbe est précédé de « How to » ; « ☆ knit with
      //    two yarns together YARN », shawl-nebula-ja : le verbe « knit » est le 2ᵉ mot,
      //    précédé d'un symbole DÉCORATIF ☆, jamais une puce). Seules une puce ou une
      //    numérotation ASCII simple (-, *, •, 1., 1)) sont tolérées avant le verbe — un
      //    symbole comme ☆ ne l'est pas, donc ne libère jamais la position de tête.
      const abbrMatch = execAbbrLine(t0)
      const abbrKey = abbrMatch ? abbrMatch[1].trim() : ''
      const looksLikeGlossaryEntry = !!abbrMatch && abbrKey.length <= 8 && !/\s/.test(abbrKey)
      const firstWord = t0.replace(LEADING_MARKER_RE, '').match(/^\S+/)?.[0] ?? ''
      const looksLikeActionTitle = !!firstWord && hasActionableVerb(firstWord)
      // 3. Aiguille-accessoire ES (« Aguja lanera ») : même famille de bug que les deux
      //    ci-dessus (collision lexicale incidente), restreinte à `key === 'aiguilles'`
      //    — seule cette famille porte l'ambiguïté aiguille de travail/aiguille
      //    accessoire en espagnol. Cf. NEEDLE_ACCESSORY_ES_RE plus haut pour le
      //    diagnostic complet et la mesure corpus.
      const looksLikeNeedleAccessory = key === 'aiguilles' && NEEDLE_ACCESSORY_ES_RE.test(t0)
      const isFalseRefTitle =
        key && REF_KEYS.has(key) && (looksLikeGlossaryEntry || looksLikeActionTitle || looksLikeNeedleAccessory)
      if (!isFalseRefTitle) {
        // Point final retiré au même titre que le « : » (ligne ci-dessus, inchangée) : seule
        // l'exception shortLabelDot laisse passer un point final jusqu'ici — un
        // strongTitle ne le peut jamais (isTitleLine rejette déjà tout titre à ponctuation
        // finale .!? ). Sans ce retrait, chaque section promue par shortLabelDot porte un
        // titre « All sizes. » au lieu de « All sizes » (idéal mesuré), comptant comme une
        // ligne « en trop » dans le banc de fidélité au lieu de correspondre.
        cur = {
          title: line.text.replace(/\s*:\s*$/, '').replace(/\s*\.\s*$/, ''),
          kind: key && isKind(key) ? key : 'pelote',
          ref: key && REF_KEYS.has(key) ? key : null,
          intro: !!(key && INTRO_KEYS.has(key)),
          noise: !!(key && NOISE_KEYS.has(key)),
          page: pageOf.get(line) ?? 0,
          titleLine: line,
          lines: [],
        }
        // Un titre referme toute phrase en cours : sans cette remise à zéro, la séquence
        // « ligne finissant par une virgule » → « TITRE » → « 150) … » désarmerait à tort
        // la soupape plus bas, la virgule appartenant à une phrase déjà refermée par le titre.
        prevLineText = ''
        // Un titre de section RÉFÉRENCE qui porte lui-même une donnée (« Crochet 6 mm »,
        // « Aiguilles 2,5 et 3 ») verrait son texte jeté au profit de l'en-tête réservé
        // (## Aiguilles) : on le conserve comme ligne pour qu'extractReference le route
        // dans le champ (sinon perte — ex. la taille de crochet disparaît).
        // Élargi (bug réel DROPS EN, sunny-daze-en-bc4eee5a, campagne 27/08) : la donnée
        // portée par le titre n'a pas TOUJOURS de chiffre — « Materials:DROPS Paris from
        // Garnstudio » (mise en page DROPS : étiquette et valeur collées SANS espace après
        // le « : », d'où sa promotion en titre par isSpacedTitle, KV_RE exigeant un espace
        // après le « : ») porte le nom de la laine, aucun chiffre. Second signe, DISJOINT du
        // premier (jamais un remplacement) : un « : » en position d'étiquette (dans les 40
        // premiers caractères, comme labelFor/referenceFieldForHeading) suivi d'un texte non
        // vide — la seule autre forme sous laquelle un titre référence peut porter une VRAIE
        // valeur plutôt que d'être son propre libellé nu (« Matériel », « Matériel: » sans
        // suite ne matchent pas, rien n'est perdu pour ces cas déjà corrects).
        if (cur.ref && (/\d/.test(line.text) || /^.{1,40}?:\s*\S/.test(line.text))) cur.lines.push(line)
        sections.push(cur)
        continue
      }
    }
    if (!cur) {
      cur = { title: 'Présentation', kind: 'pelote', ref: null, intro: true, page: pageOf.get(line) ?? 0, lines: [] }
      sections.push(cur)
    }
    // Bug P0 : un corps de patron (« Row 1 : … », « Row 2 : … ») collé DIRECTEMENT
    // sous le bloc d'abréviations, sans titre de section intermédiaire, serait
    // entièrement avalé par la section abbr dédiée (chaque rang parsé en abréviation).
    // Dès la 1re ligne d'INSTRUCTION de rang, on clôt les abréviations et on ouvre une
    // section de travail (ref null) qui recevra ce rang et les suivants. Ne déclenche que
    // sur ROW_START_RE (mot de rang + chiffre) : les vraies abréviations (« Row = rang »,
    // « Row counter recommended ») n'ont pas de chiffre → aucun split.
    // Un corps de patron collé sous les abréviations doit refermer la section abbr, que
    // les rangs portent un mot de rang (« Tour 1 », ROW_START_RE) OU un simple numéro nu
    // (« 1. Monter … », BARE_ITEM_RE). Exclusions : KV_RE (vraie abréviation « clé : déf »)
    // et looksLikeTableRow (rangée du tableau des tailles) — ni l'une ni l'autre ne ferme.
    // Même bug, même correctif pour `materiel` (campagne de test, snuggle-blanket-fr-e45fa989) :
    // un titre de section trop long (> plafond isSpacedTitle) n'est jamais promu en titre →
    // ## Matériel reste ouverte et avale tout le corps du patron qui suit.
    // Même bug, même correctif pour `echantillon` (campagne de test, knit-domino-shawl-de-
    // 61747066) : police embarquée 'serif' générique pour titres ET corps (aucun signal
    // gras) + isSpacedTitle désarmé en bloc echantillon (l.317-340, cf. commentaire) → aucun
    // titre suivant n'est jamais promu, ## Échantillon avale tout le reste du patron (confiance
    // 40, 3 sections). Portée volontairement limitée à abbr/materiel/echantillon (pas fil/
    // aiguilles/mesures) : ces trois seuls kinds sont mesurés produire ce piège dans le corpus.
    //
    // Deuxième passe (revue) — `fil` PRODUIT désormais ce même piège, mesuré :
    // depuis que la garde « consigne de travail » (plus haut) rattache un titre écarté à la
    // section en cours au lieu d'ouvrir une nouvelle section, une section `ref==='fil'` peut
    // rester ouverte sur un corps de patron entier (« SUGGESTED YARN » puis « Join new yarn
    // and work as follows » écarté puis 25 rangs, cf. Juice_Sweater/Blueberry Cream Sweater).
    // `fil` route vers `pushYarn` (reference.js), plafonné SANS repli avant la deuxième passe de
    // reference.js — les rangs disparaissaient purement et simplement, ni dans Fil ni ailleurs.
    // Rejoint donc `abbr`/`materiel`/`echantillon` dans cette fermeture : dès qu'un vrai rang
    // apparaît, il retourne au corps du patron, là où il doit être.
    const bareItem =
      BARE_ITEM_RE.test(line.text) && !KV_RE.test(line.text) && !looksLikeTableRow(line.text)
    // La soupape referme une section de référence dès qu'un vrai rang apparaît. Un nombre nu
    // suivi d'une parenthèse peut pourtant être la SUITE d'une phrase coupée par la mise en
    // page : Mia_Cardigan porte « … held together with 150 (150, 150, 150, » puis
    // « 150) (150, 200, 200, 200) 200, 200 g Silk Mohair … ». La virgule finale de la ligne
    // précédente signe une phrase laissée ouverte — jamais un rang. Garde
    // limitée à BARE_ITEM_RE : « Rang 1 » après une virgule reste un rang.
    // Balayage corpus (3232 PDF) — EXCLU de `abbr` : beyond-cables-skirt/vest-fr portent une
    // ligne-rang égarée dans le glossaire (« Rang de départ (ENV): …, 16 (16, 16, 16, » suivi
    // de « 6) 6, 7, 8 m end, PM, … »). Contrairement à materiel/fil/echantillon (qui poussent
    // toute ligne verbatim dans un tableau, sans perte possible), l'extraction `abbr`
    // (reference.js) n'accepte que « clé = déf »/« clé – déf » et deux replis de prose
    // explicites (formRejectedAbbrLine, looksLikeSetupProseLine) — tous deux EXCLUENT
    // explicitement une ligne BARE_ITEM_RE (isRowMarkerLine / BARE_ITEM_LINE_RE). Sans
    // section de secours pour l'éjecter, cette ligne ne correspond à AUCUN chemin
    // d'extraction et disparaît silencieusement (24 jetons perdus, mesuré, 0 gagnés) : la
    // même famille de défaut que la soupape existe pour prévenir. Garder la soupape ARMÉE
    // pour `abbr` referme donc la section et éjecte la ligne vers une section de travail
    // normale, où elle est bien conservée — seuls materiel/echantillon/fil bénéficient de
    // l'exception virgule.
    const prevLeftSentenceOpen = cur.ref !== 'abbr' && /,\s*$/.test(prevLineText)
    // FOUNDING_RING_RE volontairement EXCLUE de `abbr` : « MR = magic ring » est une entrée
    // de glossaire authentique et récurrente (amigurumi) — l'y armer romprait le glossaire
    // en cours au lieu de laisser execAbbrLine la traiter normalement.
    const isMaterielRef = cur.ref === 'materiel' || cur.ref === 'echantillon' || cur.ref === 'fil'
    if (
      (cur.ref === 'abbr' || isMaterielRef) &&
      (ROW_START_RE.test(line.text) || (bareItem && !prevLeftSentenceOpen) ||
        (isMaterielRef && FOUNDING_RING_RE.test(line.text)))
    ) {
      // Titre NON vide : un « ## » nu n'est pas relu par mdToPattern (section perdue au
      // round-trip → rangs supprimés), on donne donc un en-tête « Instructions ».
      cur = { title: 'Instructions', kind: 'pelote', ref: null, intro: false, page: pageOf.get(line) ?? 0, titleLine: null, lines: [] }
      sections.push(cur)
    }
    cur.lines.push(line)
    prevLineText = line.text
  }
  // Titre écrit sur DEUX lignes physiques : star-stitch-fr porte « ABRÉVIATIONS » (y533,5)
  // puis « ET DÉFINITIONS » (y522,5), toutes deux à x=227 et en taille 10 — un seul titre
  // coupé par la mise en page. La première ouvre la rubrique mais reste VIDE, la seconde
  // devient un faux titre classé en finitions et emporte tout le glossaire.
  // Conditions cumulatives, volontairement étroites : section précédente sans AUCUNE ligne,
  // même page, même abscisse (quand elle est connue), même taille de police, interligne
  // simple. La garde « aucune ligne » est ce qui empêche de recoller deux vrais titres
  // séparés par du contenu.
  // Deuxième passe (balayage corpus 3232 PDF, revue) : la garde géométrique seule (page/x/taille/
  // interligne + « a vide ») capturait 2638 fusions sur 1355 patrons (42 % du corpus), dont
  // 514 où « a » est une rubrique référence VIDE suivie d'une VRAIE ligne de contenu promue
  // à tort en titre (mise en page Hobbii très courante) — le contenu se retrouvait alors
  // dans `a.title`, jeté au silence à la sérialisation d'une section référence (seul un
  // en-tête fixe « ## Tailles »/« ## Matériel » est écrit, jamais `sec.title`). Cas mesurés :
  // CECILE_Top_EN (« SIZES » vide ++ « XS (S) M (L) XL (XXL) », tour de poitrine perdu),
  // cosy-dolls-conni-fr (« Yeux de sécurité : 12 mm », « Conni H : 33 cm » perdus),
  // bucket-bag-*-da/fr (conso fil « 200 g » et ## Matériel entier perdus), granny-shawl-
  // jacket-de/fr (« Cosy 108 x 108 cm 600 g », « Fur Lux 150 g » perdus). Un titre RÉELLEMENT
  // coupé par la mise en page (le seul cas visé, cf. star-stitch ci-dessus) n'a JAMAIS cette
  // forme : sa 2ᵉ moitié est un fragment de PHRASE-TITRE (court, sans chiffre, sans
  // ponctuation de structuration), jamais une donnée. `looksLikeContentNotTitle` ci-dessous
  // rejette donc tout candidat b qui ressemble à du contenu — chiffre, « clé : valeur »/« clé
  // = valeur » (KV_RE/execAbbrLine, déjà utilisés ailleurs dans ce fichier pour la même
  // distinction contenu/titre), parenthèse (liste de tailles « XS (S) M (L) » notamment),
  // ponctuation de fin de phrase, ou plus de 4 mots (une vraie moitié de titre coupé,
  // mesurée sur tout le corpus des fusions restantes, ne dépasse jamais ce seuil).
  //
  // 2ᵉ danger mesuré (cosy-dolls-conni-fr) : quand « b » est lui-même une VRAIE section
  // référence indépendante (ex. ref='fil' juste après une section ref='materiel'), la fusion
  // avale silencieusement son `ref`/`kind` propre — son contenu fil est ensuite routé vers le
  // mauvais extracteur (celui de « a »). On exclut donc tout candidat b dont le titre, PRIS
  // SEUL, se classe déjà dans REF_KEYS : une vraie 2ᵉ moitié de titre coupé n'a par
  // construction aucune identité de rubrique à elle seule (« ET DÉFINITIONS », « couleurss »,
  // « Belt bag » ne matchent aucun mot-clé REF_KEYS ; seul « ET DÉFINITIONS » matche
  // accessoirement `finitions` — hors REF_KEYS, donc non bloqué, cf. star ci-dessus).
  const looksLikeContentNotTitle = (text) => {
    const t = String(text ?? '').trim()
    if (/\d/.test(t)) return true
    if (KV_RE.test(t)) return true
    if (execAbbrLine(t)) return true
    if (/[()]/.test(t)) return true
    if (SENTENCE_END_RE.test(t)) return true
    if (t.split(/\s+/).filter(Boolean).length > 4) return true
    return false
  }
  // Troisième passe (balayage corpus 3232 PDF, revue) : même avec `looksLikeContentNotTitle` ci-
  // dessus, le balayage mesurait ENCORE 1778 fusions / 1281 patrons et 46 patrons en perte
  // SÈCHE. Diagnostic par diff MD ligne à ligne (pas par relecture de code) sur les cas
  // restants :
  //  - silly-owl-children-s-sweater-nl : « AFMETINGEN VAN HET »(ref='mesures', vide) ++
  //    « KLEDINGSTUK » — titre recollé CORRECT (« dimensions du vêtement »), mais reroute le
  //    contenu de b (2 blocs de mesures : Omtrek + Totale lengte, chiffres 33/35/44/45/53/58)
  //    dans l'EXTRACTEUR de la rubrique 'mesures' (reference.js), qui n'a JAMAIS été durci
  //    pour tolérer 2 blocs de mesures concaténés dans une même section — il n'en lit que le
  //    premier et jette le second EN SILENCE. cabled-jacket-with-hood-baby-fr, caterpillar-
  //    summer-top-fr (mêmes chiffres perdus) : même cause, même extracteur 'mesures'.
  //  - « avec capuche »+« -- BabyBaby », « Gilet à capuche »+« - Baby », « Base 15 x 15 cm, »+
  //    « Snøre, Skulderrem » (sections SANS ref, kind générique 'pelote'/'encolure'/'oreille')
  //    : titres COURTS et sans chiffre (passent `looksLikeContentNotTitle`), mais ce sont de
  //    VRAIES étiquettes de taille/pièce distinctes, pas des moitiés de titre coupé — la
  //    géométrie seule (page/x/taille/interligne) ne les distingue pas d'un vrai titre coupé
  //    dans une mise en page dense où TOUTES les puces/étiquettes partagent la même police.
  // Seule la rubrique 'abbr' a été DURCIE dans ce même chantier (sepLines/notes de
  // readColumnGlossary) pour tolérer exactement ce genre de contenu multi-bloc — c'est le
  // SEUL extracteur dont la tolérance est mesurée, pas supposée. Le recollage est donc borné
  // à ce seul cas : `a.ref === 'abbr'` exclut d'un coup tous les ref non durcis (mesures,
  // materiel, fil, aiguilles, echantillon, techniques) ET toutes les sections génériques
  // (ref=null) où aucun signal fiable ne sépare un titre coupé d'une étiquette voisine.
  //
  // Quatrième passe (balayage corpus, revue) : même restreint à 'abbr', 10 patrons restaient en
  // perte sèche. Cause, diagnostiquée par diff MD (mice-sisters-no, 108 jetons perdus) :
  // l'extracteur d'abréviations n'a été mesuré ROBUSTE QUE pour la forme géométrique de star
  // (colonnes alignées, ≥3 votes, cf. glossary-columns.js) ou la forme « clé = valeur » par
  // ligne (execAbbrLine, reference.js) — PAS pour toute forme de glossaire. Sur mice-sisters-
  // no, les entrées sont plusieurs par ligne SANS séparateur ni alignement colonne fiable
  // (« m maske r rett vr vrang ») : `readColumnGlossary` rend null (assemble.js l.~234,
  // `if (!g) continue`) ET `execAbbrLine` ne matche aucune ligne — extractReference ne
  // récupère alors RIEN de la section fusionnée, qui disparaît intégralement (aucun repli :
  // une section ref='abbr' n'est JAMAIS rendue par le chemin générique). Avant recollage, ce
  // même contenu vivait dans une section SANS ref (rendu générique verbatim, sans perte) :
  // le recollage est ce qui l'expose à ce trou pré-existant de l'extracteur. On vérifie donc
  // AVANT de recoller que le contenu de b sera bien lu par l'UN des deux mécanismes que
  // l'extracteur sait effectivement lire (colonnes alignées OU clé=valeur par ligne) — si
  // ni l'un ni l'autre n'y trouve rien, le recollage est refusé et les deux sections restent
  // séparées (comportement antérieur, sans perte). Remesuré après ce 3ᵉ resserrement : 0
  // patron en perte sèche sur le corpus complet.
  //
  // Cinquième passe (relecture individuelle des 57 fusions restantes, sur ordre exprès de la revue —
  // « pas seulement comptée ») : 2 fusions passaient encore le garde-fou ci-dessus tout en
  // perdant du contenu réel — cardigan-cable-fr-aa494e24, cardigan-moss-stitch-fr-22dd7693.
  // Diagnostic par diff MD ligne à ligne : ces 2 glossaires « torsade » ont des ENTRÉES
  // ÉCRITES SUR PLUSIEURS LIGNES PHYSIQUES (repli de mise en page, ex. « Boutonnière Est
  // travaillée sur les 6 m de la patte de » + 4 lignes suivantes = UNE seule entrée/note) —
  // ni `readColumnGlossary` (pas de colonnes alignées ici) ni `execAbbrLine` par ligne (le
  // séparateur « : » n'apparaît que sur la ligne de repli, pas sur la 1ʳᵉ) ne les reconnaissent
  // : `execAbbrLine` matchait quand même ≥3 AUTRES lignes courtes (« Torsade 1. p : {…} »),
  // le compte seul (≥3) suffisait donc à autoriser la fusion — mesuré : SEULEMENT 22,7 % du
  // texte de b.lines était réellement couvert par ces 6 lignes matchées sur 26, le reste
  // (« m Maille(s) », « r Rang(s) », « Boutonnière … ») disparaissant en silence à
  // l'extraction. Un simple COMPTE de lignes reconnues ne garantit donc PAS que la totalité
  // du contenu sera lue — on exige maintenant un taux de COUVERTURE (longueur de texte
  // effectivement rattachée à une entrée/note, sur la longueur totale de b.lines) ≥ 90 %,
  // sur les DEUX mécanismes (colonnes ET clé=valeur par ligne). Remesuré : ces 2 fusions
  // sont exclues (couverture 0 %/0 % via colonnes, 22,7 % via clé=valeur, dans les deux cas
  // < 90 %) ; les 55 autres restent admises (couverture mesurée ≥ 95 % sur l'ensemble du
  // corpus, cf. rapport de tâche pour le détail).
  const COVERAGE_MIN = 0.9
  const probablyParsesAsAbbr = (lines) => {
    const totalLen = lines.reduce((sum, l) => sum + (l.text || '').length, 0)
    if (totalLen === 0) return false
    const g = readColumnGlossary(lines)
    if (g && g.entries.length >= 3) {
      const capturedLen = g.entries.reduce((sum, e) => sum + e.key.length + e.def.length, 0) +
        g.notes.reduce((sum, n) => sum + n.length, 0)
      if (capturedLen / totalLen >= COVERAGE_MIN) return true
    }
    const matched = lines.filter((l) => execAbbrLine(l.text))
    if (matched.length < 3) return false
    const matchedLen = matched.reduce((sum, l) => sum + (l.text || '').length, 0)
    return matchedLen / totalLen >= COVERAGE_MIN
  }
  const titleX = (l) => l?.parts?.find((p) => p.x != null)?.x ?? null
  for (let i = sections.length - 2; i >= 0; i--) {
    const a = sections[i]
    const b = sections[i + 1]
    if (a.ref !== 'abbr' || a.lines.length || !a.titleLine || !b.titleLine || a.page !== b.page) continue
    if (Math.abs((a.titleLine.size || 0) - (b.titleLine.size || 0)) > 0.5) continue
    const xa = titleX(a.titleLine)
    const xb = titleX(b.titleLine)
    if (xa != null && xb != null && Math.abs(xa - xb) > 1) continue
    const gap = (a.titleLine.y ?? 0) - (b.titleLine.y ?? 0)
    if (!(gap > 0 && gap <= 1.5 * (a.titleLine.size || 10))) continue
    if (looksLikeContentNotTitle(b.title)) continue
    const bKey = kindForTitle(b.title)
    if (bKey && REF_KEYS.has(bKey)) continue
    if (!probablyParsesAsAbbr(b.lines)) continue
    onMerge?.(a, b)
    a.title = `${a.title} ${b.title}`.replace(/\s+/g, ' ').trim()
    a.lines = b.lines
    // `a.titleLine` resynchronisé sur le titre recollé (texte ET position) : x/y/size
    // servent aux comparaisons géométriques d'un ÉVENTUEL recollage suivant à ce même index
    // (titre coupé sur 3 lignes physiques ou plus) — sans quoi la 2ᵉ passe comparerait la
    // géométrie de la toute PREMIÈRE moitié, pas celle du titre déjà recollé. `a.ref` reste
    // 'abbr' (garde ci-dessus) : jamais recalculé, jamais démis en mini-étiquette (kindForTitle
    // reconnaît « abréviations » en sous-chaîne quel que soit le texte recollé autour).
    a.titleLine = { ...a.titleLine, text: a.title }
    sections.splice(i + 1, 1)
  }
  // Rétrogradation : sur la PAGE DE GARDE (page 0), une mini-section (≤ 3 lignes)
  // au kind inconnu et au titre pas tout-en-capitales est une étiquette de boîte
  // (« Borduurnaald », « Friends Wheel, Hobbii »), pas une section : son titre et
  // ses lignes retournent dans la section précédente.
  // Au2 : le même piège existe sur la PAGE DE RÉFÉRENCE (souvent page 1). Une
  // sous-étiquette en gras (« Glitter Deluxe, 30 g » = 2ᵉ fil) suivant IMMÉDIATEMENT
  // une section de référence est promue en section bare → son contenu n'atteint
  // jamais ## Fil/## Matériel et le 2ᵉ fil est perdu. On étend donc la
  // rétrogradation au cas « prev est une section de référence boîte », avec les
  // mêmes gardes (mini-section sans kind, pas tout-caps, ≤ 3 lignes). On EXCLUT
  // abbr (les abréviations ne portent pas d'étiquette de boîte) pour ne pas
  // absorber une vraie section de travail titrée qui les suivrait.
  const BOX_REF = new Set(['fil', 'materiel', 'aiguilles', 'echantillon', 'mesures'])
  const out = []
  for (const sec of sections) {
    const prev = out[out.length - 1]
    const allCaps = sec.title === sec.title.toUpperCase() && /[A-ZÀ-Ý]/.test(sec.title)
    // Seuil ≤ 3 d'origine ; étendu à 4 lignes (violet-dress : liste d'accessoires sous un
    // mini-titre non-caps) UNIQUEMENT si aucune ligne n'est un rang. Un rang (« Rang 1 : »…)
    // signe une vraie section de travail, jamais une étiquette de boîte : on ne la rétrograde
    // pas (sinon régression du test « NE rétrograde PAS une section de travail > 3 lignes »).
    // Un rang peut aussi s'écrire en item numéroté NU (« 1. Monter … », BARE_ITEM_RE, cf.
    // l.299-301) plutôt qu'avec un mot de rang (ROW_START_RE) : sans ce second test, un
    // bloc « Sizes N only » court dont les instructions sont numérotées nues passait à
    // travers cette garde et se faisait rétrograder (rangs détruits en silence, Mia
    // Cardigan et consorts).
    const hasRowLine = sectionHasRowLine(sec)
    const kind = kindForTitle(sec.title)
    // Collision de mot-clé référence : un item de MATÉRIEL non numéroté dont le titre
    // contient par hasard un mot-clé « fil » (« Aiguille à laine » → clé fil via « laine »)
    // est classé section référence fil et son titre est jeté (perte, nahia-sweater). S'il
    // suit un bloc référence, on le traite comme une mini-étiquette et on le rétrograde.
    // Restreint à 'fil' (les autres collisions sont plus risquées : la version large a
    // régressé le gate −0.0035), sans chiffre (un vrai 2ᵉ fil « … 30 g » garde sa section),
    // hors bandeau boutique.
    const refKeywordCollision = isFilKeywordCollision(kind, sec.title) && BOX_REF.has(prev?.ref)
    // Garde !hasRowLine factorisée sur TOUTE la disjonction (avant : seule la branche
    // ≤ 4 lignes l'appliquait, la branche ≤ 3 rétrogradait un bloc porteur de rang sans
    // condition — d'où un bloc « Sizes N only » court avec 1-2 rangs rétrogradé et ses
    // rangs détruits en silence, cf. tests/unit/segment-titre-sizes-only.spec.js).
    const isMiniLabel =
      sec.titleLine && !sec.noise && (!kind || refKeywordCollision) && !allCaps &&
      (!hasRowLine && sec.lines.length <= 4)
    // Aperçu/légende de la VRAIE section de travail qui suit plus loin dans le document,
    // sous un TITRE IDENTIQUE (bug réel granny-shawl-jacket-de-5f09f875, campagne vague 5) :
    // une page de mise en avant montre le motif au fil « x » avec une légende « Der erste
    // Runde von der Seelenwärmer besteht aus … » sous un titre « Granny Seelenwärmer » en
    // grande police, JUSTE APRÈS le bloc GARNVERBRAUCH (ref='materiel') — court (3 lignes),
    // sans mot-clé de rubrique reconnu (`kind` null, « Seelenwärmer » n'en porte aucun),
    // donc `isMiniLabel` vrai comme une vraie étiquette de boîte (« Glitter Deluxe, 30 g »).
    // Mais CE titre n'est pas une étiquette : il RÉAPPARAÎT, verbatim, plus loin dans
    // `sections` comme titre de la VRAIE section de travail (« Anfangen mit Cosy. », les
    // rangs 1-12) — une étiquette de boîte authentique, elle, ne réapparaît jamais comme
    // titre ailleurs dans le document. Rétrograder ce doublon dans le bloc Matériel qui
    // précède noyait la description du 1er rang dans une section référence sans rapport
    // (perte de contexte, extractReference risque de la mal router) au lieu de la laisser
    // former sa propre section — imparfaite (toujours pas fusionnée avec la VRAIE section
    // de travail, hors de portée de cette garde) mais au moins pas absorbée en silence.
    // `sec.lines.length > 0` exclu : une section-titre VIDE (« Lange Seite », légende de
    // schéma répétée deux fois dans ce même PDF, cf. bug voisin) n'a aucun contenu propre à
    // préserver — la protéger romprait le filet de rattrapage sans rien gagner.
    const titleReappearsLater = (candidate) => {
      const idx = sections.indexOf(candidate)
      return sections.slice(idx + 1).some((s) => s.title === candidate.title)
    }
    const isDuplicateWorkPreview = isMiniLabel && sec.lines.length > 0 && titleReappearsLater(sec)
    const demote =
      prev && isMiniLabel && !isDuplicateWorkPreview && (sec.page === 0 || BOX_REF.has(prev.ref))
    if (demote) {
      // Garde : ne pas re-pousser le titre s'il est déjà la 1ʳᵉ ligne de la section.
      if (sec.lines[0] !== sec.titleLine) prev.lines.push(sec.titleLine)
      prev.lines.push(...sec.lines)
      continue
    }
    out.push(sec)
  }
  // Défaut — collision de mot-clé « mesures » NON ancré (Bug 1, campagne vague 2,
  // mountaintop-pullover-es-b0cc556d) : « Talla infantil »/« Tallas adultas » ne sont pas des
  // en-têtes de tableau de cotes, ce sont les instructions du canesú raglan RÉPARTIES par
  // groupe de tailles — mais l'alternative espagnole `tallas?|tama[ñn]os?` (comme les cinq
  // autres mots non ancrés `storlek/koot/taglia/maten/rozmiar`, cf. le commentaire sur
  // KIND_KEYWORDS['mesures'] plus haut) matche en sous-chaîne, sans ancre `^`. Contrairement
  // à `tailles/sizes/größen`, ces six mots ne PEUVENT PAS être ancrés sans casser un vrai
  // tableau titré autrement (« Tabla de tallas » ne commence pas par « tallas » — cf. fix
  // 3c577ce7) : la distinction ne peut donc pas se faire sur le TITRE seul.
  // Elle se fait sur le CONTENU, une fois les lignes de la section connues : un tableau de
  // cotes n'a jamais de RANG numéroté (mot de rang + chiffre) — ses lignes sont des libellés
  // suivis d'un vecteur de nombres (looksLikeTableRow), jamais des instructions.
  //
  // `sectionHasRowLine` (même détecteur que la reclassification pelote→autre plus bas,
  // fonction l.309-314) N'EST PAS réutilisé TEL QUEL ici : sa branche BARE_ITEM_RE (item
  // numéroté nu, « 1. Monter … ») donne un FAUX positif mesuré sur un vrai tableau de cotes —
  // un vecteur de tailles entre parenthèses WRAPPÉ sur plusieurs lignes physiques prend
  // exactement cette forme (« … 100, 110, 120, » puis « 130) 140, 150 cm. » — Mia Cardigan,
  // cf. tests/unit/pdf-import-reference.spec.js « bloc Tailles bout en bout »). BARE_ITEM_RE
  // seule matche « 130) 140, » (nombre + parenthèse fermante + prose), faisant reclasser à
  // tort tout le tableau des tailles en travail. Repris ici le même garde que la soupape de
  // sûreté plus haut (l.916-934, `prevLeftSentenceOpen`) : un item numéroté nu dont la ligne
  // PRÉCÉDENTE laisse une phrase ouverte par une virgule finale n'est pas un vrai rang, c'est
  // la suite d'un vecteur wrappé. ROW_START_RE (mot de rang RÉEL, jamais un simple chiffre)
  // n'a besoin d'aucun garde : un vecteur de tailles ne contient jamais le mot « vuelta »/
  // « row »/« tour »… — c'est cette seule branche qui couvre le cas RÉEL (canesú en
  // « Vuelta N : », « Vuelta N (LR): »).
  //
  // Une section 'mesures' porteuse d'au moins un vrai rang est du TRAVAIL mal classé, pas un
  // tableau — restituée comme telle (ref=null, kind='autre', même repli que pelote→autre),
  // pour ne plus être jetée EN BLOC par assemble.js (filtre `!s.ref`) ni vidée par la branche
  // « mesures » de reference.js. Mountaintop-pullover-es : 1018 mots (toutes les augmentations
  // du canesú, tailles enfant ET adulte) restaurés par ce correctif.
  //
  // 2e variante du même bug (campagne 2026-08-27-vague6, open-back-sweater-fr-c9b6e744, corpus
  // réel) : un titre de taille NU sans « seulement/uniquement » (« TAILLE S », « TAILLE M »…,
  // cf. le garde SEULEMENT sur KIND_KEYWORDS['mesures'] plus haut, qui ne le couvre QUE si le
  // titre porte lui-même ce mot) ouvre ici un bloc entier de rangs réservés à cette seule
  // taille — 8 sections mesures fantômes (2 pièces × 4 tailles), chacune classée 'mesures' à
  // tort. Mais ROW_START_RE/BARE_ITEM_RE ne les reconnaissent PAS : ce patron étiquette ses
  // rangs par une abréviation dérivée du nom de la pièce (« EA »/« EAR »/« M »/« C » — Empiè-
  // cement Avant/Arrière, Manche, Col — jamais le mot « rang »/« row » lui-même), forme absente
  // du vocabulaire de ROW_START_RE ; BARE_ITEM_RE exige un chiffre EN TÊTE de ligne, absent ici
  // (la ligne commence par l'abréviation, « EAR 27 Faites 3 ml… »). Sans signal de repli, ces 8
  // sections restent classées 'mesures' → écartées du travail (assemble.js) → leurs rangs
  // retombent dans le filet de secours de reference.js (`notes.push`, même mécanisme documenté
  // pour mountaintop-pullover-es) : une liste PLATE réinjectée en tête de document par
  // consolidateIntro, SANS le titre de taille (jamais poussé en note, lui) — la taille de
  // chaque rang devient indevinable.
  // Signal retenu, ÉTROIT et LOCAL à ce seul garde (n'affecte ni hasActionableVerb ni la
  // reclassification pelote→autre partagée par tout le corpus) : « Faites » (impératif vous,
  // forme la plus fréquente des consignes de crochet Hobbii FR) immédiatement suivi d'un
  // chiffre. Vocabulaire mesuré sur tout le corpus 2026-08-27-vague{1,3,4,5,6} (105 occurrences
  // de « faites », TOUJOURS une consigne — « Faites 1 ml… », « Faites 20 ml », « Faites 50
  // (51, 52, 53) ml »… — jamais un faux positif observé, y compris en milieu de phrase ou en
  // minuscule) ; exclut par construction « Faites attention »/« Faites-en autant » (aucun
  // chiffre immédiat), qui ne signent pas un rang.
  const CROCHET_ACTION_ROW_RE = /\bfaites\s+\d/i
  const sectionHasWorkRow = (sec) => {
    let prevText = ''
    for (const l of sec.lines) {
      const t = l.text.trim()
      const prevLeftSentenceOpen = /,\s*$/.test(prevText)
      if (
        ROW_START_RE.test(t) ||
        (BARE_ITEM_RE.test(t) && !prevLeftSentenceOpen) ||
        CROCHET_ACTION_ROW_RE.test(t)
      ) return true
      prevText = t
    }
    return false
  }
  for (const sec of out) {
    if (sec.ref === 'mesures' && !sec.noise && sectionHasWorkRow(sec)) {
      sec.ref = null
      sec.kind = 'autre'
    }
  }
  // Défaut 2 — bandeau boutique « ACHETEZ VOTRE FIL ICI »… classé fil : on le route
  // en bruit (ref null → son ancre ne fuit plus dans ## Fil) UNIQUEMENT si une VRAIE
  // section fil sœur existe. Sinon (le bandeau est la seule source fil, il porte la
  // conso, cf. curly-nl) on le conserve tel quel.
  const hasRealFil = out.some((s) => s.ref === 'fil' && !isBuyYarnBanner(s.title))
  if (hasRealFil) {
    for (const s of out) {
      if (s.ref === 'fil' && isBuyYarnBanner(s.title)) {
        s.ref = null
        s.noise = true
        s.kind = 'pelote'
      }
    }
  }
  // Défaut — « guide en images » (da « Billedvejledning » / « VEJLEDNING - <élément> ») :
  // pas-à-pas PHOTO qui REDOUBLE une section de travail déjà décrite. Ses légendes sont
  // déversées en vrac multi-colonnes (numéros dans le désordre, « Sådan. » répété) →
  // bruit pur que l'oracle de référence écarte entièrement (cf. babyfryd-sensory-cube, +153
  // lignes en trop). Écarté SEULEMENT si « billed… » (explicitement « en images ») OU si
  // le sujet après « vejledning - » redouble le titre d'une section de travail ANTÉRIEURE
  // (préfixe partagé ≥ 4 car.) — JAMAIS une section d'instructions « Vejledning »
  // autoportante, ni un « VEJLEDNING - X » sans contrepartie.
  const PICTURE_GUIDE_RE = /^billed\s*vejledning\b|^vejledning\s*[-–—:]\s*(.+)$/i
  const normTitle = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim()
  for (let i = 0; i < out.length; i++) {
    const m = PICTURE_GUIDE_RE.exec(out[i].title.trim())
    if (!m) continue
    let isGuide = !m[1] // « Billedvejledning » nu → toujours bruit
    const subj = m[1] ? normTitle(m[1]) : null
    if (subj && subj.length >= 4) {
      for (let j = 0; j < i; j++) {
        const prev = out[j]
        if (prev.noise || prev.ref) continue
        const t = normTitle(prev.title)
        if (t.length >= 4 && (t.startsWith(subj) || subj.startsWith(t))) { isGuide = true; break }
      }
    }
    if (isGuide) { out[i].noise = true; out[i].ref = null; out[i].kind = 'pelote' }
  }
  // Défaut — reclassification post-hoc pelote → travail (bug systémique, campagne de test,
  // 4e signalement) : une section repliée sur `pelote` FAUTE de mot-clé anatomique/
  // fonctionnel (kindForTitle n'a rien reconnu, cf. le repli « kind: key && isKind(key) ?
  // key : 'pelote' » à la création de section ci-dessus) MAIS porteuse
  // d'au moins un VRAI rang (sectionHasRowLine, même détecteur que le garde de
  // rétrogradation) est du TRAVAIL mal titré, pas une section non-actionable — sans ce
  // correctif, `pelote` ∈ NON_WORK_KINDS (steps.js) dégrade CHAQUE ligne de la section en
  // remarque `>` non cochable, y compris de la prose qui n'est pas elle-même un rang
  // explicite (perte fonctionnelle majeure : titres génériques sans famille dédiée, ex.
  // « Instructions » fr — probablement le titre de section le plus fréquent du corpus
  // français —, « PIEZA DELANTERA/TRASERA » es (accord féminin absent des familles),
  // « Träger »/« Armausschnitt » de). On reclasse vers `autre` (={other} du dialecte, un
  // kind de TRAVAIL légitime — « en cas de doute → other » ;
  // NON_WORK_KINDS l'exclut désormais, cf. steps.js ; confirmé par la réf réelle
  // summer-sea-top-fr, « ## Bretelles {other} » où de la simple prose est rendue en puce
  // cochable) — jamais une section référence/intro/bruit (déjà écartées du travail
  // ailleurs, jamais concernées par ce repli). Placé en TOUT DERNIER (après les défauts
  // bandeau boutique / guide en images ci-dessus) pour n'agir que sur l'état FINAL des
  // sections : une section reclassée puis reroutée en bruit par un défaut précédent
  // n'existe de toute façon plus en tant que 'pelote' à ce stade (les deux défauts
  // ci-dessus, quand ils s'appliquent, forcent kind='pelote' ET noise=true ensemble) —
  // le garde `!sec.noise` ci-dessous couvre ce cas si l'ordre venait à changer.
  //
  // Second déclencheur, ajouté en clôture de campagne 40 patrons (repli pelote résiduel
  // escaladé) : une section SANS
  // rang détectable mais dont au moins une ligne contient un verbe d'action tricot/
  // crochet en position d'instruction (sectionHasActionableProse, actionable-prose.js)
  // est aussi du travail mal titré — cas des patrons rédigés en prose continue sans
  // aucun rang numéroté (ex. bellis-purse-es, 0% de cochabilité avant ce correctif).
  //
  // Restriction : ce second déclencheur (sectionHasActionableProse) est lui-même inactif
  // pour les titres génériques GENERIC_INSTRUCTIONS_TITLE_RE (« Instructions »/
  // « Instrucciones »/« Anleitung », définie ci-dessous) — ces titres-là restent gouvernés
  // par la promotion intro du palier 5 ci-dessous (cf. la note sur la mutuelle exclusivité
  // plus bas) : seul sectionHasActionableProse y est exclu, sectionHasRowLine restant, lui,
  // un déclencheur commun au palier 4 et à cette exception (cleo-tube-scarf-fr, qui a un
  // vrai rang, continue donc de basculer vers 'autre' malgré son titre générique).
  const GENERIC_INSTRUCTIONS_TITLE_RE = /^(?:instructions|instrucciones|anleitung)$/i
  for (const sec of out) {
    // Titre générique (« Instructions »/« Instrucciones »/« Anleitung », cf. palier 5
    // ci-dessous) : le verbe d'action seul ne doit PAS faire basculer ces sections vers
    // `autre` — elles doivent rester repliables en intro (palier 5) si elles n'ont AUCUN
    // rang. Un vrai rang (sectionHasRowLine) continue en revanche de les faire basculer,
    // comme au palier 4 (cleo-tube-scarf-fr) — seul sectionHasActionableProse est exclu
    // pour ces titres-là, pas sectionHasRowLine.
    const isGenericInstructionsTitle = GENERIC_INSTRUCTIONS_TITLE_RE.test(sec.title.trim())
    if (
      sec.kind === 'pelote' &&
      !sec.ref &&
      !sec.intro &&
      !sec.noise &&
      (sectionHasRowLine(sec) || (!isGenericInstructionsTitle && sectionHasActionableProse(sec)))
    ) {
      sec.kind = 'autre'
    }
  }
  // Défaut — promotion post-hoc pelote → intro (titre générique « vue d'ensemble » SANS
  // aucun rang réel, campagne de test palier 5, bellis-purse-es-80beb715) : une section
  // repliée sur `pelote` FAUTE de mot-clé (comme ci-dessus) MAIS dont le titre est un mot
  // générique « Instructions » (fr/en, même orthographe) / « Instrucciones » (es) /
  // « Anleitung » (de — non couvert ailleurs comme titre nu, seulement en mot composé dans
  // CRAFT_BANNER_RE) ET qui ne porte AUCUN vrai rang détectable (sectionHasRowLine) est une
  // vue d'ensemble de construction en PROSE, pas une section de travail : elle doit
  // rejoindre l'introduction en tête de fichier (consolidateIntro, assemble.js), pas rester
  // une fausse section positionnée après les blocs référence avec son contenu en remarques
  // non grasses.
  //
  // Portée volontairement limitée à FR/EN/ES/DE (décision produit tricoche-offline-
  // multilingue, phase 1) : ne PAS étendre à d'autres langues du corpus 11 langues sans
  // rouvrir cette décision.
  //
  // Marqué intro:true ICI, en POST-HOC (après connaissance de TOUTES les lignes de la
  // section) — JAMAIS en l'ajoutant à INTRO_KEYS à la création (kindForTitle/segmentSections
  // ci-dessus) : ce même mot générique porte AUSSI de VRAIES sections de travail dans le
  // corpus (« Instructions » de cleo-tube-scarf-fr-639429a8, corrigée au palier 4 vers
  // kind='autre' via la reclassification pelote→autre juste au-dessus). Ajouter ces mots à
  // INTRO_KEYS marquerait intro:true DÈS LA CRÉATION, avant que les lignes soient connues :
  // le garde-fou de consolidateIntro (≥2 rangs numérotés) renverrait alors la section de
  // Cleo dans le travail, mais SANS restaurer son kind (resté 'pelote' d'origine) — et
  // `pelote` ∈ NON_WORK_KINDS (steps.js) dégraderait de nouveau ses rangs en remarques non
  // cochables (régression du correctif palier 4). Le garde !sectionHasRowLine(sec) ci-dessous
  // rend ce nouveau défaut et la reclassification pelote→autre ci-dessus MUTUELLEMENT
  // EXCLUSIFS sur le même critère (sectionHasRowLine) : aucun des deux ne peut jamais
  // interférer avec l'autre.
  // Garde historique SCOPÉE À CETTE SEULE branche (n'affecte ni sectionHasRowLine partagée,
  // ni ROW_START_RE, ni la reclassification pelote→autre ci-dessus) : ROW_START_RE
  // (segment.js) était un SOUS-ENSEMBLE strict de ROW_RE (steps.js, le détecteur de rang réel
  // utilisé au rendu final) — tout mot de rang présent dans ROW_RE mais absent de
  // ROW_START_RE était un angle mort pour sectionHasRowLine, comblé ici par une garde locale
  // MISSED_ROW_RE le temps que chaque mot manquant soit résorbé À LA SOURCE (ROW_START_RE) :
  // « hilera » (espagnol) au palier 6, « reihen? » (allemand) au palier 7 — le dernier mot
  // encore manquant des 4 langues du déclencheur ci-dessus (fr/en/es/de ; da/no/nl/sv/pl ne
  // comptent pas ici, leurs titres de section ne peuvent jamais matcher
  // GENERIC_INSTRUCTIONS_TITLE_RE). MISSED_ROW_RE ne couvrait plus QUE « reihen? » depuis le
  // palier 6 : sa résorption au palier 7 la rend intégralement redondante avec
  // sectionHasRowLine (qui couvre désormais ROW_RE au complet pour ces 4 langues) — retirée
  // ici plutôt que laissée vide.
  for (const sec of out) {
    if (
      sec.kind === 'pelote' && !sec.ref && !sec.intro && !sec.noise &&
      GENERIC_INSTRUCTIONS_TITLE_RE.test(sec.title.trim()) &&
      !sectionHasRowLine(sec)
    ) {
      sec.intro = true
    }
  }
  // Titre de VARIANTE PAR TAILLE (« Sizes 2 and 5 only », « Size 4 only », « All sizes »,
  // « Tailles 2 et 5 uniquement ») : ce n'est pas un nouvel élément du vêtement, c'est la
  // SUITE du même élément pour certaines tailles. Il n'a donc pas de type propre — il
  // hérite de la section précédente. Sans cela, PDF réel Mia Cardigan : 14 sections
  // d'empiècement classées {other} au lieu de {body}. SIZE_VARIANT_TITLE_RE est désormais
  // déclaré au niveau du module (cf. juste avant isSpacedTitle) : partagé avec ce dernier,
  // pas dupliqué ici.
  for (let i = 1; i < out.length; i++) {
    const sec = out[i]
    if (!SIZE_VARIANT_TITLE_RE.test(sec.title.trim())) continue
    const prev = out[i - 1]
    // Ne jamais hériter d'un type NON-TRAVAIL : les rangs de la variante doivent rester
    // cochables (cf. NON_WORK_KINDS dans steps.js).
    if (!prev || prev.kind === 'pelote' || prev.ref) continue
    sec.kind = prev.kind
  }
  // Reclassification par CONTEXTE — « Cuerpo » nu, amigurumi vs vêtement (campagne
  // vague 6, norma-jeane-halter-top-es-99b86539 vs spring-birds-es-d4d4c462, corpus
  // réel) : `corps` (ci-dessus) gagne désormais l'ambiguïté par défaut — correct pour la
  // majorité mesurée (vêtements), mais faux pour un patron amigurumi où « CUERPO »
  // désigne le corps ROND rembourré de la peluche (spring-birds-es : « CUERPO » suivi de
  // « CABEZA »/« COLA », jamais de manche/encolure/bordure). Le titre seul ne permet pas
  // de trancher (cf. commentaire `corps` plus haut) ; la présence d'une VRAIE section
  // sœur anatomique d'amigurumi ailleurs dans le MÊME document (tête/museau/queue/
  // oreille/membre) le permet. Portée volontairement étroite : titre EXACT « Cuerpo »/
  // « Cuerpos », jamais une sous-chaîne plus longue (« Cuerpo de la prenda » reste
  // `corps` quel que soit le contexte — seul le mot nu, forme réellement observée dans
  // les deux corpus, est concerné).
  const AMIGURUMI_ANATOMY_KINDS = new Set(['tete', 'museau', 'queue', 'oreille', 'membre'])
  const hasAmigurumiSibling = out.some((s) => AMIGURUMI_ANATOMY_KINDS.has(s.kind))
  if (hasAmigurumiSibling) {
    for (const sec of out) {
      if (sec.kind === 'corps' && /^cuerpos?$/i.test(sec.title.trim())) sec.kind = 'corpsrond'
    }
  }
  // Compromis assumé, limite CONNUE de ce repêchage (revue, suivi immédiat
  // du commit ci-dessus) : un amigurumi SIMPLE (une seule pièce ronde cousue/fermée,
  // « CUERPO » puis « MONTAJE »/« ACABADO », sans tête/museau/queue/oreille/membre en
  // section À PART) ne porte aucune sœur anatomique reconnue par
  // AMIGURUMI_ANATOMY_KINDS — `hasAmigurumiSibling` reste faux, et son « CUERPO » reste
  // `corps` (vêtement) au lieu de `corpsrond`. Cas non couvert PAR CONSTRUCTION : le
  // discriminant choisi ci-dessus est justement l'existence d'une pièce anatomique
  // SŒUR, absente ici. Ne PAS élargir `hasAmigurumiSibling` à des mots de contenu
  // (« relleno », « amigurumi », « montaje »…) pour combler ce trou : ces signaux n'ont
  // aucune preuve corpus derrière eux (contrairement au sondage 7 PDF qui a motivé le
  // choix `corps` par défaut ci-dessus) et rouvriraient la même collision titre-seul que
  // ce commit vient de fermer, cette fois sur le contenu plutôt que sur le titre. Aucune
  // occurrence de ce cas dans le corpus mesuré (vagues 1-6) au moment de ce correctif —
  // à instruire par un signalement réel si un tel amigurumi apparaît, pas par anticipation.
  return out
}

// Bug lush-life-crochet-blanket-en-97699620 (corpus réel, crochet) : le chiffre du
// pictogramme CYC d'épaisseur de fil (« 6 », Super Bulky) est rendu en très grande police
// sur la couverture — il bat le vrai bandeau de titre « LUSH LIFE CROCHET BLANKET » dans
// le tri par taille ci-dessous, et `front-matter.title` se retrouve valoir « 6 » (patron
// introuvable par nom dans la bibliothèque). Un vrai titre porte toujours au moins une
// lettre : un chiffre nu, un symbole isolé ou de la ponctuation seule n'en sont jamais un,
// quelle que soit leur taille de police. `\p{L}` (Unicode) plutôt que `[A-Za-z]` pour ne
// pas disqualifier à tort un titre accentué/non-latin.
//
// LIMITE CONNUE, non couverte ici : sur ce même PDF réel, écarter le « 6 » ne suffit PAS
// à faire gagner « LUSH LIFE CROCHET BLANKET » — mesuré à 10 pt, alors que plusieurs lignes
// de CORPS (« Bernat® Blanket™ (10.5 oz/300g; 220 yds/201 m) », « ABBREVIATIONS »,
// « MEASUREMENTS »…) sont à 12 pt, donc encore devant lui dans le tri. C'est un défaut
// DISTINCT du tri par seule taille de police (aucun signal ici ne dit qu'un vrai titre de
// couverture peut être RENDU plus petit que du texte de liste) — hors périmètre de ce
// correctif, qui ne traite que « un candidat sans lettre ne doit jamais gagner ».
const HAS_LETTER_RE = /\p{L}/u
export function detectTitle(pages, { metaTitle = '' } = {}) {
  // Filtrées AVANT tout calcul : une ligne sans lettre ne doit ni devenir candidate au
  // titre, ni contaminer `maxNormalSize` (qui sert de plancher pour les vrais titres
  // interlettrés ci-dessous) — un chiffre nu à 40 pt ne doit pas relever ce plancher au
  // point d'écarter un titre légitime.
  const two = (pages || []).slice(0, 2).flat().filter((l) => HAS_LETTER_RE.test(l.text))
  // Plus grande taille parmi les lignes NORMALES (non interlettrées) : sert de plancher
  // pour décider si une ligne interlettrée est un tampon/logo (Phildar « Q U A L I F I É E »)
  // ou le vrai titre. Régression réelle trouvée en testant une première version du code : un
  // seuil `>= maxSize` global (sur TOUTES les lignes) ne discrimine plus rien quand le
  // tampon et le titre partagent la même taille (fixture existante « Q U A L I F I É E 328 »
  // / « Pull torsades ajourées », toutes deux 19 pt) — le tampon gagnait le tri à égalité.
  // Ici, la ligne interlettrée n'est retenue que si elle dépasse STRICTEMENT la plus grande
  // ligne normale de la page — PDF réel Mia Cardigan : « M I A C A R D I G A N » à 28,1 pt
  // contre 10,1 pt pour tout le reste, aucune ambiguïté.
  const maxNormalSize = two.reduce(
    (m, l) => (!isLetterSpaced(l.text) && (l.size || 0) > m ? l.size || 0 : m), 0,
  )
  const cand = two.filter(
    (l) => l.text.length <= 60 && (!isLetterSpaced(l.text) || (l.size || 0) > maxNormalSize),
  )
  cand.sort((a, b) => b.size - a.size)
  const main = cand[0]
  if (!main) return ''
  // Recolle le résultat final si la ligne retenue est interlettrée : le PDF n'encode PAS
  // la coupure entre les mots, on ne la retrouve que si la fiche d'identité porte les
  // mêmes lettres. Sinon on garde la ligne VERBATIM — jamais « MIACARDIGAN » collé, qui
  // serait une invention.
  const finish = (t) => {
    if (!isLetterSpaced(t)) return t
    return restoreWords(despace(t), metaTitle) || t
  }
  // Sous-titre : la ligne suivante immédiate, presque aussi grande, courte, sans
  // ponctuation finale ni numéro de patron (« Berenjena » + « Comida de juguete »).
  const page = (pages || []).find((p) => p.includes(main)) || []
  const next = page[page.indexOf(main) + 1]
  // Seuil de taille : un sous-titre de couverture (« Blusa », « Oblong », « Jupe
  // enfant » : ~20 pt) est plus petit qu'un titre en très grande police (41-50 pt),
  // donc `main.size * 0.5` le rejetait à tort. Un plancher absolu 15 pt sépare les
  // vrais sous-titres (display, ≥ ~18 pt) des taglines / lignes « Design: » (12-14 pt).
  if (
    next && next.text.length <= 40 && next.size >= Math.max(15, main.size * 0.34) &&
    main.y - next.y <= 2.2 * next.size && !/[.!?:]$/.test(next.text) &&
    !/^no\.?\s*\d|^\d|^by\b|^af\b|^von\b|^par\b|^de\b|design|conception|\|/i.test(next.text.trim()) &&
    !isLetterSpaced(next.text) && HAS_LETTER_RE.test(next.text)
  ) {
    return finish(`${main.text} ${next.text}`)
  }
  return finish(main.text)
}

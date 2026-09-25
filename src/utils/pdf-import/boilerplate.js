// Filtrage du bruit d'édition AVANT segmentation : pieds/têtes de page répétés,
// mentions légales, numéros de page, SKU, liens boutique. Deux mécanismes :
// 1) motifs connus (multilingues), 2) lignes quasi identiques répétées sur
// plusieurs pages (en-tête/pied de page structurel).

import { execAbbrLine } from './reference'
import { ROW_START_RE } from './segment'
import { isGridToken } from './lines'

// Ligne réduite à un lien boutique/réseau connu — extrait pour être réutilisé par le
// garde-fou de fragment d'URL enroulée sur deux lignes (cf. plus bas, isUrlFragment).
const SHOP_URL_RE =
  /^(?:https?:\/\/|www\.)\S*(?:hobbii\.(?:de|com|dk|fr|es|it|nl|se|no|fi|pl)|garnstudio\.com|instagram\.com|facebook\.com)\S*$/i

// Plafond de longueur des lignes soumises au balayage NOISE_RES ci-dessous — cf. le
// commentaire au point d'appel, qui porte la mesure et le raisonnement sur le repli.
const NOISE_MAX_LEN = 4000

const NOISE_RES = [
  /^hobbii-pattern-sku:/i,
  /powered by tcpdf/i,
  /copyright\s*©|©\s*\d{4}|all rights reserved|alle rechte vorbehalten|alle rettigheder|tutti i diritti|todos los derechos|wszelkie prawa|kaikki oikeudet|med ensamrätt|alle rechten voorbehouden/i,
  // Mention légale « usage personnel uniquement » — PDF réel Mia Cardigan v1.1 :
  // « Pattern and items knitted using this pattern are for personal use only. »
  // Sans © ni « rights reserved », elle échappe à la RE copyright ci-dessus ; effet
  // en cascade du correctif de titre interlettré (spaced-title.js) : une fois le
  // titre du document corrigé, la déduplication de assemble.js retire bien la
  // section fantôme, mais cette ligne (dans son intro) survivait sans ce motif.
  // Ancrée sur la formule complète (pas juste « personal use ») : trop générique,
  // « personal » collisionnerait avec une vraie instruction (mesures personnalisées).
  /\bfor personal use only\b/i,
  // « side » (page, da/no) exige le total : « Side 1 » seul est aussi un intertitre anglais
  // (face d'un coussin) ; un folio danois répété en bande reste retiré par `repeated`.
  /^(?:seite|page|pagina|página|sida|sivu|strona|pag\.?)\s*\d+(?:\s*(?:\/|af|of|de|di|van|av|z)\s*\d+)?$/i,
  /^side\s*\d+\s*(?:\/|af|av|of)\s*\d+$/i,
  /^\d+\s*\/\s*\d+$/, // « 3 / 7 »
  /^-?\s*\d{1,3}\s*-?$/, // numéro de page nu
  /^No\.?\s*\d{3,}[-\d]*$/i, // numéro de patron Hobbii « No. 2004-184-5508 »
  /^[-–—_](?:\s*[-–—_]){3,}$/, // bannière/séparateur « ------ » (DROPS entre filets) ; ≥4 tirets
  // Ligne réduite à un lien : bruit SEULEMENT si le domaine est une boutique/réseau
  // connu — jamais un domaine générique. Un lien de tuto (youtu.be, youtube.com)
  // référencé dans le corps du patron est du VRAI contenu qui doit survivre : vérifié
  // sur le PDF réel « Hilma - Manta de bebé » (es), où un lien tuto i-Cord seul sur sa
  // ligne disparaissait en entier ; confirmé aussi dans le corpus mesuré
  // (potholder-in-waffle-pattern-8-4, en : la référence garde le lien youtu.be du tuto).
  SHOP_URL_RE,
  /^[@#]\w+(?:\s+[@#]\w+)*$/, // réseaux sociaux / hashtags
  /\bhobbii\.(?:de|com|dk|fr|es|it|nl|se|no|fi|pl)\b/i,
  /^(?:das garn erh[äa]ltst du hier|garnet finder du her|find the yarn here|encuentra (?:el hilo|los hilos) aqu[íi]|trova il filato qui|hier vind je het garen|znajdziesz w[łl][óo]czk[ęe] tutaj|garnet finner du her|garnet hittar du h[äa]r|l[öo]yd[äa]t langan t[äa][äa]lt[äa]|le fil est disponible ici)/i,
  /^o[ùu] acheter|where (?:to|you can) buy|hvor k[øo]ber|wo (?:du|sie).*kauf|d[óo]nde comprar|dove (?:comprare|acquistare)|waar (?:je .*)?koop|gdzie kupi[ćc]|mist[äa] ost|var (?:du )?k[öo]per/i,
  /^(?:suis|follow|folg|f[øo]lg|sigue|segui|volg|obserwuj|seuraa|f[öo]lj)\b.*(?:hobbii|instagram|facebook)/i,
  // « del » (partage) : préfixe NU dangereux — « del » est aussi le début très courant
  // de mots espagnols par contraction (« del » = « de + el », ex. « del i-Cord y unir…
  // el final del borde con punto colchón. », un vrai rang de patron), italiens et
  // néerlandais. Ancré à la vraie formule de partage (démonstratif dette/denne) plutôt
  // qu'un simple préfixe de ligne — les autres alternatives de cette liste restent
  // inchangées (non vérifiées comme problématiques sur le corpus mesuré).
  // « teil » (partage, de) : même piège — préfixe NU collisionnant avec « Teil »/
  // « Teile », mot allemand TRÈS courant en patron (« pièce(s) » à assembler). Détruisait
  // 3 fragments réels sur le PDF « Hilma - Babydecke » (hilma-baby-blanket-de-2adbb17d) :
  // « Teile mit dem Leiterstich zusammen. », « Teile in der KF 1, KF 3 und KF 5
  // beginnen », « Teile in KF 2 und KF 4 beginnen und ». Recherche dans le corpus DE
  // mesuré (60+ PDF hobbii/*/de) : AUCUNE ligne PDF brute ne commence par « teil »
  // comme appel au partage — la vraie formule trouvée sur ce même PDF (« Wenn du
  // magst, teile dein Werk auf Instagram mit dem Hashtag #hilmablanketbaby … ») est
  // enchâssée en milieu de phrase, jamais en tête de ligne, et la référence la GARDE
  // d'ailleurs comme contenu légitime (note personnelle de la designer, pas un CTA
  // générique). Faute d'un vrai cas ancrable en tête de ligne, motif de repli prudent :
  // exige un signal réseau social (instagram/facebook/hashtag/@mention/#hashtag) à
  // proximité immédiate, sur le modèle du fallback suggéré pour ce bug. NB : @/#
  // sont hors groupe \w — un \b juste avant eux ne matche jamais après un espace
  // (aucune transition mot/non-mot), d'où l'alternative séparée [@#]\w+ sans \b.
  // « partage/share/deel/dela/jaa » : même piège que « teil » — le verbe ouvre aussi une
  // consigne de répartition (« Partager les mailles sur 2 aiguilles », « Share the stitches
  // evenly », « Deel de steken », « Dela maskorna »). Filtré seulement suivi d'un possessif
  // (« ta création », « your project », « je werk », « ditt arbete ») ou d'un signal réseau.
  /^(?:(?:partage[rz]?|share|deel|dela|jaa)\s+(?:(?:ton|ta|tes|votre|vos|your|je|jouw|ditt|din|dina|dit)\s|.{0,60}(?:instagram|facebook|hashtag|[@#]\w+))|teil(?:e|en)?\s+.{0,30}(?:\b(?:instagram|facebook|hashtag)\b|[@#]\w+)|del\s+(?:dette|denne)|comparte|condividi|udost[ęe]pnij)/i,
  // --- Pied/CTA de clôture DROPS (Garnstudio), multilingue ---
  // Présent sur tout patron DROPS, absent des références → fuit en « > ». Motifs
  // ancrés (question fermée en fin de ligne) ou très spécifiques (mention légale),
  // pour ne JAMAIS mordre une instruction, ni la mention fabricant « … de Garnstudio »
  // (sans « .com »), ni une vraie ligne « fil DROPS ».
  // Groupes réutilisés : démonstratif + nom de « patron » selon la langue.
  // this = (?:ce|this|questo|questa|dette|deze|dit|dieses?|dieser?|este|esta|denne|t[äa]m[äa]n|tego)
  // patron = (?:mod[èe]les?|patterns?|modello|m[øo]nster\w*|patroon|patr[óo]n|anleitung|opskrift\w*|oppskrift\w*|wzór|wzor\w*|ohje\w*|kaava\w*)
  // (a) « Avete terminato questo modello? » / « Vous avez terminé ce modèle? » /
  //     « ¿Terminaste este patrón? » — verbe « fini » … démonstratif + patron + « ? » EN FIN de ligne
  /\b(?:termin\w*|finished|finito|fertig|f[æe]rdig\w*|klar\w*|klaar|zako[ńn]cz\w*|valmi\w*)\b.{0,20}?\b(?:ce|this|questo|questa|dette|deze|dit|dieses?|dieser?|este|esta|denne|t[äa]m[äa]n|tego)\s+(?:mod[èe]les?|patterns?|modello|m[øo]nster\w*|patroon|patr[óo]n|anleitung|opskrift\w*|oppskrift\w*|wzór|wzor\w*|ohje\w*|kaava\w*)\s*[?？]\s*$/i,
  // (b) « Avete bisogno di aiuto con questo modello? » / « Heeft u hulp nodig voor dit patroon? »
  /\b(?:besoin d['’]aide|need help|bisogno di aiuto|hj[æe]lp|hulp nodig|ayuda|\bhilfe\b|ajuda|apua)\b.{0,25}?\b(?:ce|this|questo|questa|dette|deze|dit|dieses?|dieser?|este|esta|denne|t[äa]m[äa]n|tego)\s+(?:mod[èe]les?|patterns?|modello|m[øo]nster\w*|patroon|patr[óo]n|anleitung|opskrift\w*|oppskrift\w*|wzór|wzor\w*|ohje\w*|kaava\w*)\s*[?？]?\s*$/i,
  // (c) lien vidéos/tutos Garnstudio — « … su garnstudio.com » (avec ou sans « www. » ;
  //     « .com » obligatoire : la mention fabricant « … de Garnstudio » DOIT survivre)
  /\bgarnstudio\.com/i,
  // (d) hashtags DROPS noyés dans une phrase (« taggate … #dropspattern #dropsfan »)
  /#drops\w+/i,
  // (e) mention légale « droit à l'aide du magasin qui a vendu le fil » : dans toutes les
  //     langues cette clause figure sur la MÊME ligne brute que la question d'achat
  //     (« … acquistato i filati DROPS … diritto a ricevere un aiuto dal negozio … »),
  //     donc ce seul motif suffit — inutile (et risqué) de filtrer « verbe + DROPS »
  //     séparément (« the yarn used is DROPS … » est du vrai contenu). Couvre aussi le
  //     fragment de fin de ligne « venduto il filato. » (reflow non encore appliqué).
  /\b(?:diritto a ricevere|aiuto dal negozio|negozio che.{0,12}vendut\w*|vendut\w+ il filato|magasin qui vous a vendu|contacter le magasin|anspruch auf hilfe|hilfe von dem (?:laden|gesch[äa]ft)|help from the (?:shop|store)|aide du magasin|hulp van de winkel|tienda que te vendi)\b/i,
  // (f) mention copyright DROPS sans symbole © (« … leggi sul copyright … », « … droits
  //     d'auteur (copyright) … », « copyright. Læs mere … ») — la RE copyright générique exige un ©
  /\b(?:lois|leggi|laws|leyes|prawa|lagar|wetten|gesetz\w*|\blov\w*|lakien|d['’]auteur)\b.{0,14}?\bcopyright\b|(?:prot[ée]g\w*|protett\w*|protected|gesch[üu]tzt|protegid\w*|beschermd|beskyttet|chronion\w*)\b.{0,35}\bcopyright\b|\bcopyright[).]?\s*(?:l[æe]s mere|apprenez|potete leggere|read more|erfahren|lue lis|lees meer|l[äa]s mer|dowiedz)/i,
  // (bug3, brianza-shawl-de) « Bitte beachten Sie die Nutzungsbedingungen … » : mention
  // légale « conditions d'utilisation » qui n'apparaît qu'UNE fois dans le document (pas
  // de mécanisme de répétition à mobiliser) et ne contient ni « copyright » ni « rights
  // reserved ». « Nutzungsbedingungen » est un terme juridique allemand sans ambiguïté,
  // jamais une instruction de tricot/crochet.
  /\bnutzungsbedingungen\b/i,
  // (bug3) « © Copyright MEZ GmbH, 2024. » : le symbole © précède ici le mot « Copyright »
  // (ordre inverse de « copyright © 2024 »/« © 2024 » déjà couverts plus haut) — RE dédiée
  // plutôt que réordonner l'alternative existante, pour ne rien changer aux cas déjà vérifiés.
  /©\s*copyright\b/i,
  // (bug3) « MEZ GmbH · Schnewlinstraße 12 · D-79098 Freiburg, Germany · … » : ligne
  // d'adresse d'éditeur/imprimeur. Ancré sur le code postal allemand « D-NNNNN » (format
  // DIN 5008) : une combinaison lettre-tiret-5 chiffres qui n'a aucune raison d'apparaître
  // dans une instruction de tricot/crochet (les comptes de mailles n'ont jamais ce préfixe).
  /\bD-\d{5}\b/,
  // (bug4, lisbon-tiles-de) « Haben Sie diese Anleitung nachgearbeitet? » : variante
  // allemande de la question de clôture DROPS (a) ci-dessus, mais à ordre des mots
  // INVERSÉ (verbe en fin de proposition) — « diese/dieses Anleitung/Muster/Modell » puis,
  // plus loin, le verbe de clôture, puis « ? » en fin de ligne. Motif dédié plutôt que
  // toucher l'alternative (a) : les langues romanes/anglaise déjà vérifiées gardent le
  // verbe EN TÊTE, ce motif ne les recouvre pas.
  /\bdiese[ns]?\s+(?:anleitung|muster|modell)\b.{0,30}?\b(?:nachgearbeitet|fertig(?:gestellt)?|abgeschlossen)\b\s*[?？]\s*$/i,
  // (bug4) « aufrufen. » et « bei dem Sie das Garn gekauft haben. » : moitiés de phrases
  // dont l'autre moitié (« … wenn sie die Anleitung bei garnstudio.com », « … Anspruch auf
  // Hilfe von dem Laden, ») est déjà filtrée par (c)/(e) ci-dessus — mais le filtrage se
  // fait ligne à ligne, AVANT le recollage des phrases coupées par la mise en page, donc le
  // second fragment survit seul. Ancrées sur la ligne ENTIÈRE (pas un simple mot-clé) pour
  // rester aussi étroites que possible : reproduisent exactement les deux fragments
  // orphelins observés sur lisbon-tiles-de-dfde7cd8, aucune généralisation plus large.
  /^aufrufen\.?$/i,
  /^bei dem sie das garn gekauft haben\.?$/i,
  // (bug4) « Urheberrechte. Mehr dazu, was Sie … » : suite de la mention copyright DROPS
  // allemande (« … hat Urheberrechte. ») coupée par la mise en page — la première moitié
  // (« © 1982-2026 DROPS Design A/S. … ») est déjà filtrée par la RE copyright générique
  // (elle contient « © 1982 »), mais « Urheberrecht(e) » (mot allemand, pas « copyright »)
  // n'est reconnu par aucun motif existant. Exige la co-présence de « mehr dazu » pour
  // rester ancré à cette formule de clôture précise, plutôt que bannir le mot seul.
  /\burheberrechte?\b.{0,15}\bmehr dazu\b/i,
  // (vague 7) Satellites du bandeau CTA/clôture Hobbii qui survivent seuls en pleine
  // section Fil/Échantillon : le filtrage étant LIGNE À LIGNE avant recoll, la moitié
  // « utile » (URL boutique, hashtags eux-mêmes, copyright) est déjà filtrée mais pas
  // l'intitulé du bandeau ni la formule de clôture. Ancrés LIGNE ENTIÈRE (voie ad hoc
  // assumée, mêmes précédents que « ^aufrufen\.?$ » ci-dessus) ; formes énumérées sur
  // le corpus complet (2 972 PDF) : bang optionnel (FR : 1 PDF sans « ! »), smileys ☺
  // et «  :) » observés en DE, « ¡Pásalo bien tejiendo! ☺ » en ES ; le CTA FR existe à
  // 248 exemplaires sous 8 graphies (« …accessoires », « …accessoires: », « …accessoires
  // ici », « …accessoires ici: », avec espace avant « : », avec ZWSP final, …) — la
  // variante « ici » sur la LIGNE SUIVANTE est couverte par orphanTails plus bas.
  /^hashtags f[üu]r die sozialen medien\s*$/i,
  /^hashtags para redes sociales\s*$/i,
  /^ganz viel vergn[üu]gen(?:\s*[!☺]|\s*:\))?\s*$/i,
  /^¡p[áa]salo bien tejiendo!?\s*☺?\s*$/i,
  /^obtenez votre fil et vos accessoires(?:\s+ici)?\s*:?\s*\u200b?\s*$/i,
  /^tricotez joyeusement!?\s*$/i,
  // (vague 7) Queue du copyright DROPS anglais : « …copyrights. Read more / about what
  // you can do with our patterns… » — la 1re moitié (avec « © 1982 ») est déjà filtrée
  // par la RE copyright générique. 10/10 occurrences du corpus = DROPS, contre-test
  // inexistant (ligne hyper-spécifique). Miroir EN du « Anleitung. » couvert plus bas.
  /^about what you can do with our patterns at the bottom of each pattern on our site\.?\s*$/i,
]

// (bug2, kawaii-watermelon-rattle-en / kawaii-strawberry-pram-chain-es) : le lien
// boutique wrappe parfois sur deux lignes PDF (« http://shop.hobbii.com/kawaii-water »
// puis « melon-rattle » ; « http://shop.hobbii.es/kawaii-fresa » puis
// « -cadena-para-carrito »). SHOP_URL_RE exige que la ligne ENTIÈRE soit l'URL : la
// seconde moitié, qui ne commence ni par http(s):// ni par www., lui échappe et survit
// comme un fragment de contenu isolé au milieu d'une section. Un fragment de slug
// d'URL n'a pas de forme naturelle en tricot/crochet : uniquement lettres/chiffres/
// tirets, sans espace, avec au moins un tiret (jamais un simple mot ou une abréviation
// courte comme « sc », « ch »). Volontairement scopé à la ligne qui suit IMMÉDIATEMENT
// une ligne déjà reconnue comme lien boutique (isUrlFragment n'est jamais appliqué seul).
// (vague 7, primula-bloomers-es) : la queue peut être un MOT SIMPLE à tiret INITIAL
// (« primula-pantalones / -cortos ») — le tiret interne exiger par toutes les branches
// laissait passer celle-là. Toute branche exige TOUJOURS au moins un tiret (initial ou
// interne) : un mot nu sans aucun tiret (« maschenprobe ») reste du contenu, et la
// garde contextuelle (ligne suivant un lien boutique) limite de toute façon l'exposition.
// Formes mesurées dans le corpus : « -enfant » ×4, « -couverture » ×2, « -unisexe »,
// « -sweater », « -solid », … toujours après une URL boutique pleine ligne.
const URL_FRAGMENT_RE = /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)+|-[a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/i
const isUrlFragment = (t) => URL_FRAGMENT_RE.test(t.trim())

const norm = (t) => t.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase()

// Garde-fou bug critique (campagne fidélité, vague 3, blueberry-picking-en-77762884) :
// un rang de patron n'est JAMAIS un en-tête/pied de page répété, même s'il tombe dans
// la bande haute/basse d'une page et que son gabarit — une fois les chiffres écrasés
// par norm() — coïncide avec celui d'un autre rang ailleurs dans le document. C'est
// précisément ce que norm() ne peut pas distinguer : « ROUND 4: … 2 single crochets in
// the next stitch … = 24 stitches. » et « ROUND 7: … = 42 stitches. » partagent le même
// gabarit normalisé dès que seul le mot de rang + les compteurs changent — mesuré sur ce
// PDF réel où ROUND 4 à 9 tombent en bord de page (bas p.1, haut p.2) et se font
// supprimer EN BLOC comme « en-tête structurel répété » (six tours de patron perdus,
// progression 18 -> 60 mailles sans transition). Le garde s'appuie sur ROW_START_RE
// (segment.js), IMPORTÉE depuis la source unique : ce fichier portait d'abord une copie
// locale « pour ne pas créer de couplage », mais chaque extension de l'originale (« rd »
// le 03/09, ordinaux allemands collés avant) divergeait de la copie SANS test qui l'attrape
// — le garde anti-suppression ne protégeait plus les notations les plus récentes, et des
// rangs « Rd N »/« 1.Reihe » tombés en bord de page repartaient en bloc comme le bug
// ci-dessus. Importer ne crée aucun cycle : segment.js n'importe pas boilerplate.js (le
// seul cycle du voisinage, segment↔reference, est documenté comme inoffensif dans les
// deux fichiers, et boilerplate importe déjà reference). Mot de rang multilingue +
// chiffre en tête de ligne, « R 1 » (notation Hobbii dominante du corpus — vérifiée sur
// R 23/24/25/26 du PDF réel kawaii-watermelon-rattle-en), et l'ordinal collé au chiffre
// (« 1st row », « 1.Reihe »). Sans la branche « r\.?\s+\d », un patron Hobbii dont des
// rangs « R N » de même gabarit chevauchent un saut de page resterait exposé au même
// mécanisme que le bug ci-dessus. Le garde reste VOLONTAIREMENT scopé à la seule
// détection « bord de page + répété » (repeated.has ci-dessous) : les motifs NOISE_RES
// explicites (copyright, pagination, SKU…) restent inchangés et ne visent jamais un
// texte qui commence par un mot de rang.
// Rang numéroté NU (« 1. Ch 26 », « 2) Monter 30 m ») : miroir de BARE_ITEM_RE
// (segment.js), que `sectionHasRowLine` teste EN PLUS de ROW_START_RE. Ce garde-fou
// ne reprenait que la moitié du détecteur : un patron dont les rangs sont numérotés
// SANS mot de rang — forme dominante des patrons crochet/amigurumi — n'était donc pas
// protégé du tout, et retombait mot pour mot dans le bug que ce garde existe pour
// empêcher (rangs de même gabarit normalisé tombant en bord de page, supprimés en bloc
// comme « en-tête structurel répété »). Le seuil `max(2, pageCount/2)` valant 2 pour
// tout document de 2 à 4 pages, les PDF crochet courts y étaient les plus exposés.
const BARE_ITEM_RE = /^\s*\d{1,3}[.)]\s+\S/
// Mots de rang présents dans ROW_RE (steps.js) mais absents de ROW_START_RE ci-dessus :
// danois/norvégien (« Række 4 », « Rekke 4 »), néerlandais (« Rij 12 »), polonais
// (« Okr. 3 »), finnois (« Kerros 3 »). Ajoutés ICI seulement, sans toucher à
// ROW_START_RE (partagée avec segment.js, où l'élargir déplacerait des sections).
// Élargir isRowStart est MONOTONE : ce prédicat ne sert qu'à RETIRER des lignes de
// l'ensemble supprimé (l.271), donc il ne peut que préserver davantage de contenu.
const ROW_WORD_EXTRA_RE = /^\s*(?:r[æe]kker?|rekke|rij(?:en)?|okr\.?|kerros)\s*\d/i
const isRowStart = (t) => ROW_START_RE.test(t) || BARE_ITEM_RE.test(t) || ROW_WORD_EXTRA_RE.test(t)

// En-tête/pied structurel : ligne dans la bande haute ou basse de SA page. La
// détection de répétition ne regarde que ces bandes — un rang légitime répété au
// milieu de plusieurs pages (« Rang # : … ») ne doit jamais être pris pour du bruit.
function edgeLines(page) {
  const ys = page.map((l) => l.y ?? 0)
  const min = Math.min(...ys)
  const max = Math.max(...ys)
  const band = (max - min) * 0.12
  return new Set(page.filter((l) => (l.y ?? 0) <= min + band || (l.y ?? 0) >= max - band))
}

// Une colonne droite est une colonne de LÉGENDES (photos) si la plupart de ses
// lignes sont courtes. Mesuré sur le PDF réel Mia Cardigan : sa colonne droite est
// une vraie colonne de TEXTE (longueur médiane ~60 caractères, seulement 7 à 22 % de
// lignes courtes selon la page) ; ses lignes courtes y sont des fins de phrase
// coupées par la mise en colonnes, pas des légendes. Sur le poncho (bug #8), mesuré
// sur le PDF réel, le profil n'est PAS net : sur les 11 pages à deux colonnes,
// seules 5 qualifient comme colonne de légendes (p1, p4, p6, p14, p15) ; 6 pages
// sont à 20–50 % de lignes courtes (isCaptionColumn=false), dont deux à exactement
// 50 %. Conséquence : la légende récurrente « #. comme ceci. » n'est apprise
// qu'avec 3 occurrences, pile le seuil (≥ 3, cf. plus bas) — la marge est NULLE,
// pas confortable ; resserrer ce seuil en pensant avoir du mou rouvrirait le bug #8.
const CAPTION_LEN = 20
function isCaptionColumn(page) {
  const rc = page.filter((l) => l.rightCol)
  if (!rc.length) return false
  const short = rc.filter((l) => norm(l.text).length <= CAPTION_LEN).length
  return short * 2 > rc.length
}

export function stripBoilerplate(pages) {
  const pageCount = (pages || []).length
  const edges = (pages || []).map((p) => (p.length ? edgeLines(p) : new Set()))
  // Lignes structurelles : même texte normalisé, en bande de page, sur ≥ max(2, moitié) des pages.
  // (V2b2) Une ligne pairedRow n'APPREND jamais (exclue du comptage ci-dessous) : le
  // gabarit d'une rangée de GRILLE APPARIÉE (chart key imprimé sur plusieurs pages,
  // ex. saroyan-it p3/p4 « for reference ») ne doit pas nourrir repeated — sinon une
  // copie ORDINAIRE du même texte, ailleurs en bande, se ferait filtrer par
  // contamination. Restore-only : apprendre moins ne peut jamais supprimer plus.
  const seenOnPages = new Map()
  pages?.forEach((page, i) => {
    const uniq = new Set(page.filter((l) => edges[i].has(l) && !l.pairedRow).map((l) => norm(l.text)).filter((t) => t.length >= 4))
    for (const t of uniq) seenOnPages.set(t, (seenOnPages.get(t) || 0) + 1)
  })
  const threshold = Math.max(2, Math.ceil(pageCount / 2))
  const repeated = new Set(
    [...seenOnPages.entries()].filter(([, n]) => pageCount >= 2 && n >= threshold).map(([t]) => t),
  )
  // Légendes photo récurrentes : une ligne COURTE de colonne droite (rightCol, posée
  // par lines.js sur les pages à deux colonnes) dont le texte normalisé se répète sur
  // plusieurs pages est une légende d'illustration (« Comme ceci », « Wie hier »),
  // jamais une instruction — routée en bruit. Contrairement à la répétition
  // structurelle (bandes de page), la garde ici est la COLONNE + la brièveté, ce qui
  // épargne un vrai rang répété au milieu de la page (« Finir avec 1 mc. »).
  // Garde ajoutée : on n'apprend une légende QUE sur une page dont la colonne droite
  // est réellement une colonne d'illustration. Sans elle, sur une page à deux colonnes
  // de TEXTE, la brièveté désignait du contenu : sur Mia Cardigan étaient détruits en
  // silence l'intertitre « All sizes. » (x5) et les fins de phrase coupées par la mise
  // en colonnes « increased) » (x7), « sts increased) » (x7) et « follows: » (x6).
  // Garde ajoutée (PDF réel ottolie-chevron-cardigan-with-pockets-fr/nl, colonne droite
  // « Diagramme X Légende ») : une entrée de glossaire (« END: maille endroit »,
  // « ENV: maille envers ») a la FORME clé/définition d'execAbbrLine — jamais une
  // légende photo. Une légende de diagramme redéfinit ses clés sur CHAQUE diagramme du
  // patron (Diagramme A/C/D/E…) : dès 3 diagrammes, la même clé franchit le seuil
  // d'occurrences ci-dessous et disparaissait en silence de TOUS les diagrammes sauf
  // le dernier lu. Retour du correctif crochet-cotton-makeup-pads-de-921e621a
  // (excludeExtremeBands, lines.js) : en corrigeant la détection bimodale 2-colonnes,
  // ce correctif fait basculer côté rightCol des pages jusque-là lues en mono-flux —
  // dont celle-ci, qui exerçait déjà ce garde-fou latent (jamais déclenché avant faute
  // de twoCols=true sur cette page précise).
  const capSeen = new Map()
  pages?.forEach((page) => {
    if (!isCaptionColumn(page)) return
    for (const l of page) {
      if (!l.rightCol || norm(l.text).length > CAPTION_LEN) continue
      if (execAbbrLine(norm(l.text))) continue
      // (V2b1, flower-child-children-s-sweater-fr p6) Un TOKEN DE GRILLE numérique
      // n'est jamais une légende photo : la colonne Manches de la table de mesures
      // (Taille | Devant-Dos | Manches) sort rightCol de la lecture 2-colonnes avec
      // des lignes courtes « 2 x 2 »/« 2 x 3 »/« 3 x 4 » dont le gabarit normalisé
      // « # x # » revenait 7 fois — appris comme légende récurrente (≥ 3), il
      // détruisait TOUTE la colonne (7 lignes de mesures perdues). Discriminant :
      // une vraie légende photo (« Comme ceci », « Wie hier ») n'est JAMAIS un token
      // numérique pur. Prédicat IMPORTÉ de lines.js (source unique, exporté en
      // préparatoire c54f7bb2) — jamais de copie locale (piège ROW_START_RE documenté
      // ci-dessus). Restore-only : n'apprendre MOINS de légendes ne peut jamais
      // supprimer davantage de contenu.
      if (isGridToken(l.text)) continue
      const k = norm(l.text)
      capSeen.set(k, (capSeen.get(k) || 0) + 1)
    }
  })
  // ≥ 3 occurrences d'une même légende courte de colonne droite = illustration
  // récurrente (« Comme ceci » revient à chaque photo de tour). Comptage par
  // occurrences (et non par page) : deux légendes sur la même page comptent double.
  const captions = new Set(
    [...capSeen.entries()].filter(([, n]) => n >= 3).map(([t]) => t),
  )
  // bug2 : fragment de lien enroulé — la ligne qui suit IMMÉDIATEMENT un lien boutique
  // reconnu (SHOP_URL_RE) et qui a la forme d'un reste de slug d'URL (isUrlFragment) est
  // elle-même du bruit, même si elle ne matche aucune NOISE_RES à elle seule.
  const urlFragments = (pages || []).map((page) => {
    const set = new Set()
    for (let j = 0; j < page.length - 1; j++) {
      if (SHOP_URL_RE.test(page[j].text.trim()) && isUrlFragment(page[j + 1].text)) {
        set.add(page[j + 1])
      }
    }
    return set
  })
  // (vague 7) Queues orphelines de pieds de page : la 1re moitié de la phrase est déjà
  // filtrée par un motif ci-dessus, mais le filtrage se fait ligne à ligne AVANT le
  // recoll des phrases coupées (bug documenté plus haut) — la queue wrappée survit
  // seule. Trois paires mesurées sur le corpus complet :
  //  - « ici » après « Obtenez votre fil et vos accessoires » (nadia + 5 PDF FR ; l'URL
  //    qui suit est déjà filtrée par SHOP_URL_RE) ;
  //  - « yarn. » après « …entitled to receive help from the store that sold you the »
  //    (lemon-heart, sunny-song + 8 PDF DROPS EN) ;
  //  - « Anleitung. » après « Urheberrechte. Mehr dazu … ganz unten auf der Seite zu
  //    jeder » (sunflower, back-to-the-beach + 8 PDF DROPS DE).
  // Volontairement CONTEXTUELLES (paire mot-orphelin + fin de ligne précédente), JAMAIS
  // globales : « ^yarn\.$ » nu détruirait du VRAI contenu — mesuré dans le corpus
  // (bow-children-s-suit « …on stitch wire/scrap / yarn. », pink-heart-sweater
  // « Remember extra / yarn. », frozen-flower/the-jack-cat « …and cut the / yarn. ») ;
  // « ^ici$ » nu détruirait le titre letter-spaced « Comm / encer / ici » (« Commencer
  // ici », butterfly-besties) ; « Anleitung. » seul serait un titre DE plausible
  // (aucune occurrence pleine ligne hors DROPS dans le corpus, mais la garde reste
  // requise par construction). Même voie ad hoc qu'urlFragments ci-dessus.
  const ORPHAN_TAIL_RE = /^(?:ici|yarn\.|anleitung\.)$/i
  const ORPHAN_TAIL_PREV_RE =
    /(?:obtenez votre fil et vos accessoires\s*:?\s*|sold you the\s*|zu jeder\s*)$/i
  const orphanTails = (pages || []).map((page) => {
    const set = new Set()
    for (let j = 1; j < page.length; j++) {
      if (ORPHAN_TAIL_RE.test(page[j].text.trim()) && ORPHAN_TAIL_PREV_RE.test(page[j - 1].text.trim())) {
        set.add(page[j])
      }
    }
    return set
  })
  // (D3, défauts DROPS vague 2, 03/09) Cascades directionnelles : le filtrage étant ligne à
  // ligne AVANT recollage, une phrase de pied de page coupée en deux par la mise en page
  // n'était filtrée qu'à moitié — la moitié « utile » part (NOISE_RES), la queue survit
  // seule en note absurde. Témoins mesurés to-the-beach-fr-c33da181.pdf.txt l.68-77 :
  // « …vous a vendu le fil pour toute » + « assistance complémentaire. » ;
  // « …en bas de chacune des pages de » + « notre site. » ;
  // « …en vous rendant sur la page du modèle » avant « sur garnstudio.com ».
  // « Bruit explicite » = retiré par NOISE_RES seul (jamais repeated/captions, qui
  // requièrent des conditions supplémentaires ; lignes complètes par construction).
  // Cascades bornées à la MÊME PAGE et à une bande de cascade PROPRE (cascadeEdges,
  // 12 % ∪ bas de page 35 % — cf. commentaire dédié) ; les satellites Hobbii mid-section
  // restent hors périmètre (orphanTails les garde). Trois configurations géométriques
  // mesurées sur le corpus complet :
  //  1. pied dans la bande 12 % haut/bas d'edgeLines → couvert dès le round 0 ;
  //  2. pied de page multi-lignes DROPS (~100-110 px) occupant jusqu'à 35 % de
  //     l'étendue y de SA page → couvert par l'extension bas de page (round 1, le
  //     gabarit fusionné « Vous trouverez N tutoriels vidéo… la page du modèle /
  //     assistance complémentaire. » sur 10 PDF FR + 8 NL) ;
  //  3. pied DÉBORDÉ sur la page suivante (blueberry-picking fr/nl, lemon-heart fr,
  //     sunflower-slip-top fr/nl) → résiduel documenté HORS périmètre : le trancher
  //     exigerait une règle « page majoritairement bruit », non tentée dans ce lot.
  const explicitNoise = (pages || []).map((page) => {
    const set = new Set()
    for (const l of page) {
      const t = l.text.trim()
      if (t && t.length <= NOISE_MAX_LEN && NOISE_RES.some((re) => re.test(t))) set.add(l)
    }
    return set
  })
  const LOWER_START_RE = /^[a-zà-öø-ÿæœ]/
  // (round 1) Bande de cascade PROPRE, distincte d'edgeLines : edgeLines reste INTACT
  // (répétition structurelle et légendes continuent de consulter la bande 12 %), les
  // cascades voient l'union avec une extension BAS DE PAGE UNIQUEMENT à 35 % de
  // l'étendue y (coords PDF, y vers le haut : bas de page = y FAIBLE, soit
  // y ≤ min + 0,35 × étendue — mesuré sur to-the-beach p3, le bloc pied de page DROPS
  // occupe les positions 0-28 % de l'étendue). Jamais le côté HAUT : mesuré, une bande
  // symétrique élargie (40 %) détruirait « uA » (légende allemande de diagramme,
  // stanley-the-knitting-bear p8) que la bande 12 % haute protège.
  const cascadeEdges = (pages || []).map((p, i) => {
    if (!p.length) return edges[i]
    const ys = p.map((l) => l.y ?? 0)
    const min = Math.min(...ys)
    const ext = (Math.max(...ys) - min) * 0.35
    return new Set([...edges[i], ...p.filter((l) => (l.y ?? 0) <= min + ext)])
  })
  // (round 1) Garde « déclencheur = prose » : la ligne de bruit qui DÉCLENCHE la
  // cascade doit être de la prose (pied de page DROPS : « sur garnstudio.com »,
  // « …contacter le magasin qui vous a vendu… », copyright), pas un bloc contact/CTA
  // compacté. Hors prose = ligne commençant par une URL ou un @/#, email entier, ou
  // contenant un domaine boutique Hobbii. Mesuré sur le corpus : la bande 35 % seule
  // détruirait 15 lignes Hobbii (« If you have any questions… email us at »,
  // « Buy the yarn here », « Bestelle Garn und Zubehör hier »…) dont les voisins ne
  // sont PAS des queues de phrase. Substituée au simple !SHOP_URL_RE.test(prev) du
  // round 0 (elle le subsume) et appliquée AUSSI à la cascade arrière.
  const NON_PROSE_START_RE = /^(?:https?:\/\/|www\.|[@#]\w+)/
  const EMAIL_LINE_RE = /^\S+@\S+\.\S+$/
  const SHOP_DOMAIN_RE = /\bhobbii\.(?:de|com|dk|fr|es|it|nl|se|no|fi|pl)\b/i
  const isProseTrigger = (t) =>
    !NON_PROSE_START_RE.test(t) && !EMAIL_LINE_RE.test(t) && !SHOP_DOMAIN_RE.test(t)
  const noiseCascades = (pages || []).map((page, i) => {
    const set = new Set()
    for (let j = 1; j < page.length; j++) {
      const prev = page[j - 1]
      const cur = page[j]
      const t = cur.text.trim()
      // Cascade AVANT : queue minuscule courte juste après une ligne de bruit explicite
      // en bande (« …vous a vendu le fil pour toute » + « assistance complémentaire. » ;
      // « …en bas de chacune des pages de » + « notre site. »). Borne 26 = longueur
      // normalisée du plus long témoin, « assistance complémentaire. », point final
      // compris. Gardes : pas un rang (isRowStart), pas une entrée de glossaire
      // (execAbbrLine), DÉCLENCHEUR = prose (isProseTrigger — sans elle, « maschenprobe »,
      // vrai titre de section, après un lien boutique disparaissait), et la QUEUE
      // elle-même en bande + MINUSCULE en tête : le pied de page structurel Hobbii (SKU,
      // « Powered by TCPDF ») précède dans l'ordre de lecture le titre de section qui
      // suit (« Abréviations: », « Anleitung », « ACABADO », « Amusez-vous! »,
      // « Abb. 7 » — mesuré, 40 lignes de titres/légendes détruites sur 25 PDF du
      // corpus sans ces deux gardes ; « uA », légende allemande, même sort depuis un
      // SKU). Les trois témoins ci-dessus sont tous minuscules et en bande — aucune
      // vraie queue ne commence par une majuscule.
      if (
        explicitNoise[i].has(prev) && cascadeEdges[i].has(prev) && isProseTrigger(prev.text.trim()) &&
        cascadeEdges[i].has(cur) && LOWER_START_RE.test(t) && norm(t).length <= 26 &&
        !isRowStart(t) && !execAbbrLine(norm(t))
      ) { set.add(cur); continue }
      // Cascade ARRIÈRE : la précédente finit SANS ponctuation sur un mot minuscule et la
      // retirée est un fragment court minuscule en bande (« …sur la page du modèle » +
      // « sur garnstudio.com »). La garde « fin sans ponctuation + mot minuscule » est la
      // signature d'une phrase coupée, pas d'un titre ni d'un rang ; déclencheur =
      // prose (même garde que la cascade avant).
      if (
        explicitNoise[i].has(cur) && cascadeEdges[i].has(cur) && isProseTrigger(t) &&
        cascadeEdges[i].has(prev) &&
        t.length <= 40 && LOWER_START_RE.test(t) &&
        /[a-zà-öø-ÿæœ]$/.test(prev.text.trim())
      ) set.add(prev)
    }
    return set
  })
  return (pages || []).map((page, i) =>
    page
      .filter((l) => {
        const t = l.text.trim()
        if (!t) return false
        // Borne de longueur AVANT le balayage NOISE_RES — c'est la boucle la plus chaude du
        // module (chaque ligne de chaque page y passe). Deux motifs de la liste sont
        // quadratiques : `^o[ùu] acheter|…|wo (?:du|sie).*kauf|…|waar (?:je .*)?koop|…` ne
        // porte son `^` que sur SA PREMIÈRE alternative, si bien que les suivantes sont
        // relancées depuis chaque position de la ligne, `.*` compris (mesuré : 731 ms sur
        // 96 000 caractères, 196 ms sur 48 000). Ancrer les autres alternatives changerait
        // la reconnaissance (elles matchent aujourd'hui en milieu de ligne) : on borne donc,
        // sans toucher aux motifs. Une ligne de bruit d'édition — numéro de page, mention
        // légale, lien boutique — est courte par nature ; à 4 000 caractères le pire cas
        // tombe à ~1,4 ms et le repli va dans le bon sens : la ligne est CONSERVÉE, jamais
        // supprimée à tort (règle du dépôt : ne jamais perdre d'information).
        if (t.length <= NOISE_MAX_LEN && NOISE_RES.some((re) => re.test(t))) return false
        // (V2b2) Exemption pairedRow : une rangée de GRILLE APPARIÉE (readPairedGrid,
        // lines.js — chart key saroyan-it, défaut PRÉEXISTANT : 6/10 entrées déjà
        // perdues avant V1 par ces mêmes filtres) n'est jamais un en-tête/pied
        // structurel, même courte et répétée en bande de page sur plusieurs pages.
        // Une garde TEXTE seule est insuffisante : execAbbrLine exige un séparateur
        // (« = », « : ») et un libellé de diagramme comme « knit thru back loop » n'en
        // a pas — seul le FLAG posé par lines.js (et voyagé par les spreads {...l} de
        // toLines/reflow) porte le contexte « rangée de grille ». Restore-only.
        const nt = norm(t) // calculé une fois, réutilisé par les deux gardes ci-dessous (repeated/captions)
        if (edges[i].has(l) && !l.pairedRow && repeated.has(nt) && !isRowStart(t)) return false
        if (urlFragments[i].has(l)) return false
        if (orphanTails[i].has(l)) return false
        if (noiseCascades[i].has(l)) return false
        // Légende APPRISE de la colonne droite : une fois identifiée, on l'écarte
        // partout où elle forme une ligne à elle seule — y compris les grilles photo
        // où certaines légendes tombent côté gauche (rc=false), sans toucher aux
        // instructions (dont le texte normalisé ne coïncide jamais avec la légende).
        // (V2b1) Miroir de la garde d'apprentissage : un token de grille numérique
        // (isGridToken) n'est jamais une légende, même si son gabarit normalisé
        // coïncide avec une clé apprise — une clé « # x # » ne peut plus être apprise
        // depuis un token court, mais peut encore l'être depuis une ligne LONGUE de
        // chiffres (> 12 chars, hors isGridToken) dont le gabarit écrasé
        // collisionnerait avec un token court d'une autre page. Restore-only par
        // construction.
        if (captions.has(nt) && !isGridToken(t)) return false
        return true
      })
      // BB4 : une bannière de tirets peut se coller à du texte via le reflow
      // (« Garngrupp C eller A + A ------------------------ »). La ligne n'est plus
      // PUREMENT une bannière (elle a du texte) donc NOISE_RES ne l'enlève pas :
      // on NETTOIE (sans supprimer la ligne) un run terminal de ≥ 6 tirets/underscore.
      // Seuil ≥ 6 pour ne pas toucher « 8-10 » ni un tiret cadratin isolé ; fin de ligne seule.
      .map((l) => {
        const cleaned = l.text.replace(/\s*[-–—_]{6,}\s*$/, '')
        // Le texte change ici (bannière de tirets retirée) : parts pointerait vers
        // l'ancien découpage et mentirait sur le texte réellement produit — invalidée.
        return cleaned === l.text ? l : { ...l, text: cleaned, parts: undefined }
      }),
  )
}

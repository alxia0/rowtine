// Lignes d'une section → steps reader (ROW cochable / NOTE / REP compteur).
// Règle d'or : jamais d'invention — le texte reste verbatim, seule la
// notation multi-tailles cohérente devient {{i}} (via applySizeVectors).
import { applySizeVectors } from './sizes'
// Réutilise la MÊME regex que segment.js (pas de duplication : deux copies divergeraient).
import { SYMBOL_LEGEND_RE } from './segment'
// Vocabulaire fermé de verbes de construction (mesuré sur le corpus), déjà utilisé pour
// repêcher la prose actionnable en section 'pelote' repliée. Réutilisé ici tel quel — pas
// de copie de la liste de verbes, qui divergerait.
import { hasActionableVerb } from './actionable-prose'

// « rondas? »/« vts? » (espagnol crochet, ronda/vuelta abrégée « vt ») ajoutés aux côtés de
// « vueltas?/filas? » — même paire que ROW_START_RE (segment.js), ne doivent jamais diverger.
// Ordinal allemand COLLÉ (knit-domino-shawl-de-61747066, corpus réel, Hobbii DE) :
// « 1.Reihe (linke Seite): … » — ARBITRAGE : OUI, la règle de synchronisation ci-dessus
// l'exige (ROW_START_RE, segment.js, reçoit la même branche : l'étendre sans celle-ci
// ferait diverger détection de section et rendu) et c'est le but recherché — ces lignes
// deviennent des RANGS cochables dès « 1.Reihe », quel que soit le kind (le test
// ROW_RE/NUM_ROW_RE ci-dessous précède le repli isWorkSection). Le mot de rang
// (reihe/runde/rd) reste exigé après le point : « 1.Masche »/« 3.Stb » ne matchent pas.
// « Rd » PRÉFIXE (bernadette-tote-bag-de-1e86ff98, corpus réel Hobbii DE, crochet) :
// l'abréviation allemande de « Runde » AVANT le chiffre (« Rd 6: 1 Lm… ») était connue de
// NEW_ITEM_RE (reflow.js) mais absente d'ICI — asymétrie : le reflow voyait bien une amorce
// d'item (refus de fusion) pendant que ces mêmes lignes, longues (>220 car., pas de
// vecteur), basculaient en NOTE non cochable. ARBITRAGE : OUI, la règle de synchronisation
// ci-dessus l'exige — ROW_START_RE (segment.js) reçoit la même branche « rd », banc de
// fidélité vérifié stable (26 mesurés, aucun recul). Comme ses voisins, le token exige un
// chiffre : « Rd. für Runde » sans chiffre ne matche pas (contre-test en spec).
// Ordinal anglais ANTÉPOSÉ « 1st row: (RS). … » (revue de fin de campagne) : ROW_START_RE
// (segment.js) le reconnaît depuis le 27/08 (commit 8a3420dc, famille Yarnspirations/
// Bernat) mais la branche n'avait jamais été propagée ici — même asymétrie que « Rd » :
// le reflow (NEW_ITEM_RE, même branche ajoutée côté reflow.js) refusait la fusion pendant
// que la ligne restait une NOTE non cochable. Miroir compact de la branche de ROW_START_RE,
// `\b` final exigé : « 2 rows below » (compte sans suffixe ordinal, définition
// d'abréviation de lush-life-crochet-blanket-en) ne matche pas — contre-test en spec.
const ROW_RE = /^\s*(?:(?:rangs?|rgs?|rows?|rounds?|tours?|trs?|rnds?|runde?n?|rd\.?|reihen?|r[æe]kker?|rekke|\brad\b|rij(?:en)?|omg(?:ang)?e?|vueltas?|rondas?|vts?|filas?|giro|giri|rig(?:a|he)|toeren?|rz[ąę]d|rz[ąę]dy|krs\.?|okr\.?|varv|kierros|kerros|hilera|r\.?)\s*\d|\d{1,3}\.\s*(?:reihen?|runde?n?|rd\.?)|\d+(?:st|nd|rd|th)\s*(?:rows?|rounds?)\b)/i
// Rang numéroté « 1. Ch 26 » / « 2.-5. Work sc around » : cochable quel que soit le kind.
// La forme « 2.-5. » (ponctuation APRÈS le premier nombre ET plage) ne matchait pas :
// l'ancienne alternance exigeait SOIT la ponctuation SOIT la plage, jamais les deux, si
// bien que l'exemple cité juste au-dessus retombait sur REP_RE et ressortait en compteur
// « × » — exactement ce que le commentaire de linesToSteps interdit pour un rang numéroté.
// Élargissement STRICTEMENT additif : la plage devient un suffixe OPTIONNEL de la branche
// ponctuée, l'ancienne branche plage (« 2-5. » / « 2-5 ») est conservée telle quelle. Une
// ponctuation ou une plage reste OBLIGATOIRE — « 26 sc in next st » ne doit jamais matcher.
// Ordinal allemand COLLÉ (même PDF que ROW_RE ci-dessus) — ARBITRAGE : OUI pour la
// numérotation : « 1. Reihe » ESPACÉ est déjà un rang par la branche ponctuée ci-dessus
// (`\s+\S`), la forme collée « 1.Reihe » est la MÊME convention Hobbii DE sans l'espace
// que cette regex ne voyait pas (pas de whitespace après le point). Même garde que ROW_RE :
// le mot de rang est exigé, un numéro de liste nu « 1. » ne matche pas.
// ASYMÉTRIE DE CASSE assumée : NUM_ROW_RE n'a PAS de /i (aucune de ses branches n'en a
// jamais eu), sa branche ordinale ne voit donc pas « 1.REIHE » tout en majuscules — sans
// impact : ROW_RE (/i, testée EN PREMIER dans linesToSteps) couvre la forme, et NUM_ROW_RE
// n'est plus atteinte dans ce cas. Documenté pour la prochaine branche ajoutée ici : ne pas
// « corriger » la casse unilatéralement, la règle de synchronisation passe par ROW_RE.
const NUM_ROW_RE = /^\s*(?:\d+\s*(?:[.):]\s*(?:[-–]\s*\d+\s*[.):]?)?|[-–]\s*\d+\s*[.):]?)\s+\S|\d{1,3}\.\s*(?:reihen?|runde?n?|rd\.?))/
// « Rép » NON ponctué (sans point, sans « répéter » en toutes lettres) : forme SYSTÉMATIQUE
// des patrons Hobbii FR (« Rép rangs 1-2 pour... », « Rép tour 3... »), absente jusqu'ici —
// aucune de leurs répétitions chiffrées n'obtenait de compteur (corpus réel
// diaphane-top-buttoned-shirt-fr-09bb8728, >15 occurrences, dont les diminutions d'encolure
// et rangs raccourcis d'épaule où l'erreur de comptage coûte le plus cher). Le 3e alt `\b`
// borne « rép »/« rep » à une frontière de mot IMMÉDIATE (espace, ponctuation, fin de
// chaîne) : « réparer »/« répartir »/« répondre » ont un caractère de mot juste après
// (« répa… », « répo… ») donc aucune frontière là, donc aucun risque de faux positif — la
// même garde par digit+unité de comptage (fin de motif) borne le reste.
// Le groupe optionnel `(?<vec>...)` après le nombre couvre la convention Hobbii FR pour un
// vecteur multi-tailles DANS une répétition : « <taille 1> (<taille 2>, …, <taille n>) fois »
// — la parenthèse touche directement l'unité (contrairement à « 8 (9) 10 fois », convention
// alternée déjà gérée par le `(\d+)` seul). Nommé pour permettre à l'appelant de refuser un
// total fabriqué quand la liste capturée ne correspond PAS à un vecteur reconnu (cf. steps.js
// plus bas, non-invention : une liste de compte incohérent avec n reste verbatim, jamais
// diffusée sur les tailles à partir du seul nombre isolé qui la précède).
// Unité « x » non suivie d'un chiffre : « 2 x 2 rib » (côtes) n'est pas un compte de répétitions.
const REP_RE = /(?:r[ée]p(?:[ée]ter\b|\.|\b)|repeat\b|gentag\b|gjenta\b|upprepa\b|toista\b|wiederhol\w*|\bwdh\b|repit[ea]\w*|repetir\b|ripet\w+|herhaal\b|powt[óo]rz\w*)[^.]*?(\d+)\s*(?:\(\s*(?<vec>\d+(?:\s*[,;]\s*\d+){0,23})\s*\)\s*)?(?:fois|times|x(?!\s*\d)|gange?|ganger|g[åa]nger|kertaa|mal\b|veces|volte|keer|razy)\b/i
// Bug 2 (campagne 2026-08-27, mountaintop-pullover-es-b0cc556d) : une ligne de répétition
// peut porter PLUSIEURS vecteurs multi-tailles (ex. « Rep las últimas 17 (11)… rdas 2 (5)…
// veces » : durée en rangs PUIS nombre de répétitions). `c` (applySizeVectors) les liste
// dans l'ordre d'apparition — prendre systématiquement `c[0]` prend alors la DURÉE au lieu
// du COMPTE. MÊME structure que REP_RE (verbe rép. … puis quantité … puis unité, `[^.]*?`
// paresseux = même sélection « premier match valide » qu'elle, donc cohérente avec une
// ligne à répétitions multiples), appliquée à `t` (texte déjà substitué en {{i}}) : la
// quantité y est soit un placeholder {{i}} (vecteur reconnu → on veut son index i), soit un
// chiffre nu resté tel quel (nombre non reconnu comme vecteur cohérent). Pas de duplication
// du corps de REP_RE : seule la quantité change de forme (`\d+` → `\{\{(\d+)\}\}|\d+`).
const REP_RE_UNIT_VECTOR_RE = /(?:r[ée]p(?:[ée]ter\b|\.|\b)|repeat\b|gentag\b|gjenta\b|upprepa\b|toista\b|wiederhol\w*|\bwdh\b|repit[ea]\w*|repetir\b|ripet\w+|herhaal\b|powt[óo]rz\w*)[^.]*?(?:\{\{(\d+)\}\}|\d+)\s*(?:fois|times|x(?!\s*\d)|gange?|ganger|g[åa]nger|kertaa|mal\b|veces|volte|keer|razy)\b/i
// Plafond de longueur de ligne des deux motifs ci-dessus (même classe de parade que
// `NEEDLE_SF_MAX_LEN`, reference.js) — cf. le commentaire au point d'appel, dans
// `linesToSteps`, qui porte la mesure et le raisonnement sur le repli.
const REP_MAX_LEN = 4000

// Kinds « non-travail » : sections où le texte reste informatif (pas de suivi ligne à ligne).
// Exporté : les tests de kindForTitle (segment.js) vérifient CONTRE cette liste réelle
// qu'un nouveau mot-clé anatomique route bien vers un kind cochable (pas de copie qui
// pourrait diverger silencieusement de la source de vérité).
// `autre` (={other} du dialecte) N'EST PAS non-travail : le dialecte le documente comme un
// kind de TRAVAIL légitime (« en cas de doute → other »), confirmé par la réf réelle
// summer-sea-top-fr (« ## Bretelles {other} », chaque ligne — y compris de la prose simple
// — rendue en puce `-` cochable). Avant ce correctif, `autre` était ICI À TORT : combiné au
// repli kind='pelote' de segment.js (titre sans mot-clé anatomique/fonctionnel → 'pelote'),
// une reclassification post-hoc vers `autre` (cf. segmentSections) n'aurait eu AUCUN effet
// tant que `autre` restait lui aussi non-travail. `pelote` reste seul repli non-travail :
// une section qui y reste (aucun vrai rang détecté, cf. reclassification post-hoc) est
// réellement non-actionnable, pas juste mal titrée.
// `infos` (un arbitrage, 03/09) : rubriques de service/conseils (INFO ET CONSEILS,
// HÄKELTIPP, ATENCIÓN…) — leur prose est du CONSEIL à lire, pas du travail à cocher :
// rendue en notes `>`, exactement comme sous l'ancien repli 'pelote' et comme l'oracle
// de référence les sérialise (penny-the-panda « ## INFO UND TIPPS {other} » en notes). Les
// vrais rangs numérotés restent cochables quel que soit le kind (ROW_RE/NUM_ROW_RE sont
// testés AVANT le repli isWorkSection, cf. linesToSteps).
export const NON_WORK_KINDS = new Set(['echantillon', 'diagramme', 'pelote', 'infos'])

function toNumber(v) {
  return Number(String(v).replace(',', '.')) || 0
}

// Ligne en gras (au niveau ligne, cf. lines.js) → texte enrobé de `**…**` dans le MD.
// Le signal `bold` est line-granulaire : on enrobe le texte entier du step.
function emphasize(t, bold) {
  return bold && String(t ?? '').trim() ? `**${t}**` : t
}

export function linesToSteps(lines, { kind = 'pelote', n = 1 } = {}) {
  return (lines || []).map((line) => {
    const src = line.text
    const { t, c } = applySizeVectors(src, n)
    const et = emphasize(t, line.bold)
    // Un rang numéroté (ROW_RE / NUM_ROW_RE) est un RANG, pas une directive de
    // répétition — même s'il contient « repeat 6 times » en incise (instruction de
    // maille interne, ex. donkey « R 2: (inc) repeat 6 times »). Le marqueur « × »
    // (Rowtine-MD, serialize.js) est réservé aux lignes qui SONT une directive de
    // répétition (« Répéter les tours… », « Repeat rows… ») — celles-ci commencent
    // par le verbe, jamais par un marqueur de rang. On teste donc la nature de rang
    // AVANT REP_RE, sinon toute incise « repeat N times » d'un rang chiffré devient
    // un « × » parasite que les références ne mettent pas.
    if (ROW_RE.test(src) || NUM_ROW_RE.test(src)) return { t: et, c }
    // Borne de longueur AVANT REP_RE (même parade que `NEEDLE_SF_MAX_LEN` dans
    // reference.js) : son `[^.]*?` paresseux s'arrête à chaque position de la ligne, et
    // le `(\d+)` qui suit y reparcourt tout le run de chiffres — quadratique. Mesuré sur
    // « repeat » suivi de N chiffres sans point : 138 ms à 8 000 caractères, 2 258 ms à
    // 32 000. Une VRAIE directive de répétition est une phrase, jamais un pavé : 4 000
    // caractères (plafond du pire cas à ~33 ms) est hors d'atteinte du contenu réel, et le
    // repli au-delà est la dégradation la plus douce possible — la ligne suit son chemin
    // rang/note normal, aucun texte n'est perdu.
    const rep = src.length <= REP_MAX_LEN ? REP_RE.exec(src) : null
    // `rep.groups.vec` = REP_RE a vu un nombre isolé suivi d'une liste parenthésée juste
    // avant l'unité de comptage (convention Hobbii « <t1> (<t2>, …, <tn>) fois »). Si cette
    // liste (+ le nombre isolé qui la précède) ne forme PAS un vecteur reconnu par
    // applySizeVectors pour ce n (c vide), le nombre isolé seul n'est PAS un total fiable à
    // diffuser sur toutes les tailles — ce serait fabriquer un compteur (non-invention).
    // On laisse alors la ligne suivre son repli normal (rang/note) plutôt qu'inventer.
    const repVectorUnresolved = rep && rep.groups?.vec && !c.length
    // Bug 2 : quand la ligne porte PLUSIEURS vecteurs (c.length > 1), `c[0]` (le premier
    // rencontré dans la ligne) n'est pas forcément celui du COMPTE de répétitions — cf.
    // commentaire de REP_RE_UNIT_VECTOR_RE ci-dessus. On ne recherche l'index correct que
    // dans ce cas (c.length <= 1 : comportement strictement inchangé, aucun risque de
    // régression). Non-invention : si REP_RE_UNIT_VECTOR_RE ne retrouve pas de placeholder
    // avant l'unité (ne devrait pas arriver, structure identique à REP_RE), on NE fabrique
    // PAS de compteur à partir du premier vecteur venu — la ligne suit son repli normal.
    let repVector = c[0]
    let repVectorIndexAmbiguous = false
    if (c.length > 1) {
      // Même borne que pour REP_RE juste au-dessus : REP_RE_UNIT_VECTOR_RE en est la copie
      // structurelle (`[^.]*?` puis une quantité), donc exactement le même coût quadratique.
      const onT = t.length <= REP_MAX_LEN ? REP_RE_UNIT_VECTOR_RE.exec(t) : null
      if (onT && onT[1] !== undefined) {
        repVector = c[Number(onT[1])]
      } else {
        repVectorIndexAmbiguous = true
      }
    } else if (c.length === 1 && rep) {
      // Un SEUL vecteur n'est le compte que s'il porte l'unité (« 4 (5, 6) fois ») : devant
      // un compte nu (« Répéter 4 fois jusqu'à avoir 20 (22, 24) m »), le vecteur est un
      // nombre de mailles ou une mesure, et le total vient du nombre nu (rep[1]).
      const onT = t.length <= REP_MAX_LEN ? REP_RE_UNIT_VECTOR_RE.exec(t) : null
      if (onT && onT[1] === undefined) repVector = null
    }
    if (rep && !repVectorUnresolved && !repVectorIndexAmbiguous) {
      const total = repVector
        ? repVector.map(toNumber)
        : Array.from({ length: Math.max(1, n) }, () => Number(rep[1]) || 0)
      return { t: et, c, repeat: true, total }
    }
    // Légende de symbole de diagramme (« = <texte ≥3 lettres> ») glissée dans une section de
    // travail (kit torsades : MANCHE/DeVant/ManChes) : c'est une NOTE, jamais un rang cochable —
    // un vrai rang ne commence pas par « = ». Confiné aux sections de travail : en section
    // non-travail ces lignes sont déjà des notes (repli final). Cf. plan lot #3 coupe minimale.
    if (SYMBOL_LEGEND_RE.test(src)) return { t: et, c, note: true }
    const isWorkSection = !NON_WORK_KINDS.has(kind)
    // Bug 1 (campagne 2026-08-27, ~110 PDF DROPS + diaphane-top-buttoned-shirt-fr-09bb8728,
    // love-for-squares-blanket-fr-a4af4182) : le plafond `src.length <= 220` seul confondait
    // LONGUEUR et NATURE. Les patrons DROPS rédigent chaque tour en paragraphe continu de
    // 250-450 caractères (pas de « Rang N : » découpé) — tout basculait en note non
    // cochable. Sur diaphane, un même gabarit de rang (« Rang de mise en place N ») dépasse
    // 220 caractères d'un seul côté d'une pièce symétrique (plus de couleurs/sections sur le
    // DOS que sur le DEVANT) et devenait incohéremment non cochable.
    // Un vrai rang de travail reste un rang MÊME LONG dès qu'il porte l'une des deux preuves
    // de contenu déjà fiables dans ce fichier (non-invention : on ne se fie qu'à des signaux
    // déjà vérifiés, jamais à la longueur du texte) :
    //  - un verbe de construction reconnu (hasActionableVerb, vocabulaire fermé mesuré sur
    //    le corpus, déjà utilisé pour repêcher la prose actionnable ailleurs) — capture les
    //    paragraphes DROPS (« Crocheter… ») ;
    //  - un vecteur multi-tailles cohérent pour n (c.length > 0, même garde de non-invention
    //    qu'ailleurs dans ce fichier) — capture les rangs de comptage sans verbe (diaphane
    //    « Rang de mise en place N : 19 (22)… »).
    // Le seuil ≤220 reste le repli par défaut pour tout le reste (inchangé, aucune régression
    // possible : cette clause ne fait qu'ÉLARGIR les cas classés RANG, jamais les réduire).
    // Une remarque conditionnelle/conseil restant sans verbe reconnu ni vecteur (ex. « NOTA:
    // Ajusta… si… », lollipop-dream-top-es-6be67c67) continue de basculer en note même en
    // section de travail — la distinction recherchée n'est donc pas « travail vs non-travail »
    // (déjà tranché par `kind` en amont, hors de portée ici) mais bien « preuve de contenu
    // actionnable vs absence de preuve », ce que la longueur seule ne mesurait pas.
    if (
      isWorkSection &&
      !src.trimEnd().endsWith(':') &&
      (src.length <= 220 || hasActionableVerb(src) || c.length > 0)
    )
      return { t: et, c }
    return { t: et, c, note: true }
  })
}

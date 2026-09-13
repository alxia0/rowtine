import { describe, it, expect } from 'vitest'
import { findSizeVectors, applySizeVectors, detectSizeLabels, sizeLineTokens, DIMENSIONAL_SIZE_TITLE_RE } from '@/utils/pdf-import/sizes'

describe('findSizeVectors', () => {
  it('notation alternée PetiteKnit', () => {
    const v = findSizeVectors('Monter 104 (108) 112 (116) 120 (124) m.')
    expect(v).toHaveLength(1)
    expect(v[0].values).toEqual(['104', '108', '112', '116', '120', '124'])
  })
  it('notation groupée avec virgules', () => {
    const v = findSizeVectors('Tour de buste : 102 (112, 122, 132) (142, 152, 163) cm')
    expect(v[0].values).toEqual(['102', '112', '122', '132', '142', '152', '163'])
  })
  it('conserve décimales à virgule et plages', () => {
    const v = findSizeVectors('80-85 (85-90) 90-95 cm, aiguilles 4,5 (5) 5,5 mm')
    expect(v).toHaveLength(2)
    expect(v[0].values).toEqual(['80-85', '85-90', '90-95'])
    expect(v[1].values).toEqual(['4,5', '5', '5,5'])
  })
  it('un nombre isolé ou une parenthèse textuelle ne matchent pas', () => {
    expect(findSizeVectors('Monter 104 m. (voir photo 2)')).toEqual([])
  })
  it('ne fabrique pas un vecteur depuis une légende de diagramme couleur « Corazón color N (0XX) » (heart-full-of-joy-pillow-es, patron mono-taille)', () => {
    expect(findSizeVectors('Corazón color 1 (019)')).toEqual([])
    expect(findSizeVectors('Corazón color 2 (010)')).toEqual([])
    expect(findSizeVectors('Corazón color 3 (011)')).toEqual([])
    expect(findSizeVectors('Corazón color 4 (006)')).toEqual([])
  })
  it('non-régression : un vecteur à 2 tailles de forme « N (code 3 chiffres) » SANS mot-clé couleur adjacent reste détecté (la forme seule ne suffit pas à exclure, il faut le mot-clé)', () => {
    const v = findSizeVectors('Tour de poitrine 100 (140) cm')
    expect(v).toHaveLength(1)
    expect(v[0].values).toEqual(['100', '140'])
  })
  it('non-régression : garde un vrai vecteur composé multi-tailles même précédé de « farver » loin dans la phrase (dorn-children-s-sweater-da)', () => {
    const v = findSizeVectors('Strik nu diagrammet med to farver i alt 20 (21) 22 (24) 25 gange pr. omgang.')
    expect(v).toHaveLength(1)
    expect(v[0].values).toEqual(['20', '21', '22', '24', '25'])
  })
  // Notation à crochets-DEUX-POINTS ES/DE (serenity-sweater-es-f1e18764,
  // palier 6/8) : « 95 [107:117:129:139]pts », 51 occurrences dans tout le document (quasi
  // chaque compte de mailles/mesure du corps). Avant correctif : ni les parenthèses ([,;]
  // seulement, jamais « [ » ni « : ») ni BRACKET_VEC_RE (grammaire flattened-list à virgule,
  // exige une virgule AVANT le groupe — absente ici, juste un espace) ne reconnaissent cette
  // forme → `## Tailles {measurements}` disparaissait entièrement (20 valeurs perdues) et la
  // mise en évidence par taille ({{i}}) n'était générée pour AUCUNE des 51 occurrences.
  it('notation à crochets-deux-points ES/DE (serenity-sweater-es, palier 6) : « 95 [107:117:129:139]pts »', () => {
    const v = findSizeVectors('Con agujas de 4mm, monta 95 [107:117:129:139]pts y teje 4 vts del derecho')
    expect(v).toHaveLength(1)
    expect(v[0].values).toEqual(['95', '107', '117', '129', '139'])
  })
  it('notation à crochets-deux-points ES/DE : mesure « 47 [49:51:53:55] cm »', () => {
    const v = findSizeVectors('Largo: 47 [49:51:53:55] cm')
    expect(v).toHaveLength(1)
    expect(v[0].values).toEqual(['47', '49', '51', '53', '55'])
  })
  it('ne backtrack pas sur un groupe à crochets-deux-points non fermé (ReDoS, garde du nouveau BRACKET_GROUP)', () => {
    const evil = '1 [' + Array.from({ length: 200 }, (_, i) => i).join(':') // jamais de « ] »
    const t0 = performance.now()
    const out = findSizeVectors(evil)
    const ms = performance.now() - t0
    expect(out).toEqual([]) // groupe non fermé : aucun vecteur
    expect(ms).toBeLessThan(500)
  })
  it('ne backtrack pas sur une longue suite de chiffres sans séparateur (ReDoS)', () => {
    // Numérotation de colonnes d'un diagramme mosaïque : chiffres concaténés.
    const evil = Array.from({ length: 100 }, (_, i) => 99 - i).join('') // ~190 chiffres
    const t0 = performance.now()
    const out = findSizeVectors(evil)
    const ms = performance.now() - t0
    expect(out).toEqual([]) // aucun vecteur : pas de parenthèse, pas de séparateur
    expect(ms).toBeLessThan(500) // vide ET rapide (avant correctif : ne rend jamais la main)
  })
})

// Vecteurs DROPS imbriqués (témoin pennine-es-3cb3c709, corrigé 04/09) : la
// convention DROPS des patrons à nombreuses tailles écrit les vecteurs par groupes de 4
// séparés par des parenthèses — « 6-7-8-9 (10-11-12-13) 14-15-16-17 » = 12 valeurs. Avant
// correctif, DASH_VEC_RE coupait à la parenthèse et produisait TROIS vecteurs de 4 : sur
// un patron à 12 tailles, aucun vecteur ne s'alignait (rejeu 04/09 : vectorsSeen 18,
// vectorsOk 0, confiance globale 29). La tête du run garde son plancher de 3 valeurs — la
// forme simple « 80-88-96 » produit exactement les mêmes matchs qu'avant ; l'extension ne
// s'active que si une parenthèse contient PUREMENT un run à tirets immédiatement suivi
// d'un autre run à tirets (non-invention : toute prose « (ou 20-25) » casse la fusion).
describe('findSizeVectors — vecteurs DROPS imbriqués (pennine-es-3cb3c709)', () => {
  it('« 6-7-8-9 (10-11-12-13) 14-15-16-17 » → UN vecteur de 12 valeurs, dans l\'ordre exact', () => {
    const v = findSizeVectors('6-7-8-9 (10-11-12-13) 14-15-16-17')
    expect(v).toHaveLength(1)
    expect(v[0].values).toEqual(['6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17'])
  })
  it('pennine : « Mont 44-48-52-52 (56-56-64-64) 64-68-72-76 pts » → un vecteur de 12 couvrant tout le run', () => {
    const line = 'Mont 44-48-52-52 (56-56-64-64) 64-68-72-76 pts'
    const v = findSizeVectors(line)
    expect(v).toHaveLength(1)
    expect(v[0].values).toEqual(['44', '48', '52', '52', '56', '56', '64', '64', '64', '68', '72', '76'])
    expect(v[0].start).toBe(line.indexOf('44'))
    expect(v[0].end).toBe(line.indexOf(' pts'))
  })
  it('16+ tailles : deux groupes parenthésés → 20 valeurs fusionnées', () => {
    const v = findSizeVectors('1-2-3-4 (5-6-7-8) 9-10-11-12 (13-14-15-16) 17-18-19-20')
    expect(v).toHaveLength(1)
    expect(v[0].values).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)))
  })
  it('décimales à virgule : segments de 4 à la DROPS → fusion en 12 valeurs', () => {
    const v = findSizeVectors('3,5-4-4,5-5 (5-5,5-6-6,5) 7-7,5-8-8,5')
    expect(v).toHaveLength(1)
    expect(v[0].values).toEqual(['3,5', '4', '4,5', '5', '5', '5,5', '6', '6,5', '7', '7,5', '8', '8,5'])
  })
  // Limite OBSERVÉE de portée (comportement vérifié identique avant/après correctif sur
  // HEAD) : la variante à segments courts « 3,5-4-4,5 (5-5,5) 6-6,5-7 » est captée AVANT
  // la branche DASH par VEC_RE (notation « plage (plage) plage », cf. test « conserve
  // décimales à virgule et plages » : VEC_NUM absorbe UN dash-pair par valeur) → lue
  // comme 3 plages. Déplacer cette priorité serait hors du périmètre du correctif
  // (VEC_RE et l'ordre des branches de findSizeVectors restent inchangés) ; la fusion
  // décimale DROPS s'exerce donc sur la forme réelle à segments de 4 (test précédent).
  it('non-régression : la variante décimale à segments courts reste lue par VEC_RE comme 3 plages (priorité antérieure conservée)', () => {
    const v = findSizeVectors('3,5-4-4,5 (5-5,5) 6-6,5-7')
    expect(v).toHaveLength(1)
    expect(v[0].values).toEqual(['4-4,5', '5-5,5', '6-6,5'])
  })
  it('non-régression forme simple : « 80-88-96-100-110-122-134 » → 1 vecteur de 7, valeurs identiques à l\'ancien comportement', () => {
    const v = findSizeVectors('80-88-96-100-110-122-134')
    expect(v).toHaveLength(1)
    expect(v[0].values).toEqual(['80', '88', '96', '100', '110', '122', '134'])
  })
  it('non-régression forme simple espacée : « 80 - 88 - 96 » → mêmes valeurs qu\'avant', () => {
    const v = findSizeVectors('80 - 88 - 96')
    expect(v).toHaveLength(1)
    expect(v[0].values).toEqual(['80', '88', '96'])
  })
  it('non-régression décimale simple : « 3,5-4-4,5 » → mêmes valeurs qu\'avant', () => {
    const v = findSizeVectors('3,5-4-4,5')
    expect(v).toHaveLength(1)
    expect(v[0].values).toEqual(['3,5', '4', '4,5'])
  })
  it('non-invention : une parenthèse de prose « (ou 20-25) » casse la fusion → AUCUN vecteur', () => {
    expect(findSizeVectors('travailler 10-15 cm (ou 20-25 pour la grande) 30-35 rangs')).toEqual([])
  })
  it('non-invention : « Rangs 1-2-3 (voir 4-5) 6-7-8 » → DEUX vecteurs séparés de 3, jamais fusionnés', () => {
    const v = findSizeVectors('Rangs 1-2-3 (voir 4-5) 6-7-8')
    expect(v).toHaveLength(2)
    expect(v[0].values).toEqual(['1', '2', '3'])
    expect(v[1].values).toEqual(['6', '7', '8'])
  })
})

describe('applySizeVectors', () => {
  it('remplace par {{i}} les vecteurs de bonne longueur', () => {
    const { t, c } = applySizeVectors('Monter 104 (108) 112 m. puis 8 (9) 10 rangs', 3)
    expect(t).toBe('Monter {{0}} m. puis {{1}} rangs')
    expect(c).toEqual([['104', '108', '112'], ['8', '9', '10']])
  })
  it('non-invention : vecteur de mauvaise longueur laissé verbatim', () => {
    const { t, c } = applySizeVectors('Monter 104 (108) m.', 3)
    expect(t).toBe('Monter 104 (108) m.')
    expect(c).toEqual([])
  })
  it('n = 0 ou 1 → aucun remplacement', () => {
    expect(applySizeVectors('Monter 104 (108) 112 m.', 1).t).toBe('Monter 104 (108) 112 m.')
  })
  // pennine-es-3cb3c709 : le vecteur DROPS imbriqué à 12 valeurs doit devenir
  // UN SEUL repère {{0}} une fois fusionné (avant correctif : trois vecteurs de 4, aucun
  // ne matchait n=12, la ligne restait verbatim).
  it('pennine : vecteur DROPS imbriqué à 12 valeurs → un seul repère {{0}}', () => {
    const { t, c } = applySizeVectors('Mont 44-48-52-52 (56-56-64-64) 64-68-72-76 pts', 12)
    expect(t).toBe('Mont {{0}} pts')
    expect(c).toEqual([['44', '48', '52', '52', '56', '56', '64', '64', '64', '68', '72', '76']])
  })
})

describe('detectSizeLabels', () => {
  const L = (text) => ({ text, size: 10, bold: false, y: 0 })
  it('ligne « Tailles : XS (S) M (L) XL »', () => {
    const r = detectSizeLabels([[L('Tailles : XS (S) M (L) XL')]])
    expect(r.labels).toEqual(['XS', 'S', 'M', 'L', 'XL'])
    expect(r.from).toBe('line')
  })
  it('repli sur la longueur modale des vecteurs', () => {
    const pages = [[L('Monter 104 (108) 112 m.'), L('Tricoter 8 (9) 10 rangs'), L('Continuer 5 (6) 7 fois')]]
    const r = detectSizeLabels(pages)
    expect(r.labels).toEqual(['T1', 'T2', 'T3'])
    expect(r.from).toBe('modal')
  })
  it('aucun vecteur → Taille unique', () => {
    const r = detectSizeLabels([[L('Monter 104 mailles.')]])
    expect(r.labels).toEqual([])
    expect(r.from).toBe('none')
  })
  it('libellés « âge » avec unité unique en fin de groupe (primula-bonnet)', () => {
    const r = detectSizeLabels([[L('Tailles'), L('Prématuré-0 (0-3, 3-6, 6-9, 9-12) mois')]])
    expect(r.labels).toEqual(['Prématuré-0', '0-3', '3-6', '6-9', '9-12 mois'])
    expect(r.from).toBe('line')
  })
  it('libellés « âge » : « ans » final réattaché à la dernière valeur (boble-joy)', () => {
    const r = detectSizeLabels([[L('Tailles'), L('1-2 (2-3) 3-4 (4-5) 5-6 (6-7) ans')]])
    expect(r.labels).toEqual(['1-2', '2-3', '3-4', '4-5', '5-6', '6-7 ans'])
    expect(r.from).toBe('line')
  })
  it('rejette une légende de grille « taille M = 122 m. » (PT2b, pas des tailles)', () => {
    const r = detectSizeLabels([[{ text: 'taille M = 122 m.', size: 10, bold: false, y: 0 }]])
    expect(r.labels).toEqual([])
    expect(r.from).toBe('none')
  })
  it('conserve des tailles cm/EU numériques légitimes (garde PT2b non trop large)', () => {
    const r = detectSizeLabels([[{ text: 'Tailles : 104 110 116 122', size: 10, bold: false, y: 0 }]])
    expect(r.labels).toEqual(['104', '110', '116', '122'])
  })
  it('reconnaît un en-tête de tailles préfixé par une cellule parasite (PT2a Phildar)', () => {
    const r = detectSizeLabels([[{ text: 'sibéRie tailles s M L XL XXL', size: 11, bold: false, y: 0 }]])
    expect(r.labels).toEqual(['s', 'M', 'L', 'XL', 'XXL'])
  })
  it('ne capte pas « tailles » dans une phrase quelconque', () => {
    const r = detectSizeLabels([[{ text: 'Voir le tableau des tailles disponibles ci-dessous', size: 10, bold: false, y: 0 }]])
    expect(r.labels).toEqual([])
  })
  it('ne capte pas une liste de tailles en fin de phrase de prose (préfixe long)', () => {
    const r = detectSizeLabels([[{ text: 'Ce headband doux et chaud est proposé en tailles S M', size: 10, bold: false, y: 0 }]])
    expect(r.labels).toEqual([])
  })
  // Bug : AGE_UNIT (allemand « Monate »/« Monat », espagnol « años »/« año »)
  // manquait à la liste des unités d'âge, malgré « mois »/« months »/« meses » déjà couverts.
  // Conséquence vérifiée sur 2 patrons réels : `sizes:` retombait sur le placeholder générique
  // T1..Tn au lieu des vraies tranches d'âge.
  it('libellés « âge » allemand : « Monate »/« Monat » reconnus au même titre que « mois » (mot-clé seul sur sa ligne)', () => {
    const r = detectSizeLabels([[L('Größe'), L('1 Monat, 6 Monate')]])
    expect(r.labels).toEqual(['1 Monat', '6 Monate'])
    expect(r.from).toBe('line')
  })
  it('libellés « âge » espagnol : « años »/« año » reconnus (accent ñ) au même titre que « meses »', () => {
    const r = detectSizeLabels([[L('Tallas'), L('1 año, 4 años')]])
    expect(r.labels).toEqual(['1 año', '4 años'])
    expect(r.from).toBe('line')
  })
  it('libellés « âge » allemand, unité finale de groupe réattachée (mot-clé seul sur sa ligne)', () => {
    const r = detectSizeLabels([[L('Größe'), L('6 (12, 18, 24) Monate')]])
    expect(r.labels).toEqual(['6', '12', '18', '24 Monate'])
    expect(r.from).toBe('line')
  })
  // Bug de routage : la branche « mot-clé + valeurs SUR LA MÊME LIGNE » (SIZE_LINE_RE,
  // « Größe: … », « Talla: … ») n'appelait QUE tokensOf, jamais les helpers d'âge — même
  // avec AGE_UNIT étendu, ces lignes retombaient sur des tokens nus SANS unité (« 6 », « 12 »
  // au lieu de « 24 Monate »), perdant la distinction mois/années.
  it('« Größe: … » (mot-clé + valeurs même ligne) reconnaît les libellés d’âge allemands avec leur unité', () => {
    const r = detectSizeLabels([[L('Größe: 6 (12, 18, 24) Monate')]])
    expect(r.labels).toEqual(['6', '12', '18', '24 Monate'])
    expect(r.from).toBe('line')
  })
  it('« Talla: … » (mot-clé + valeurs même ligne) reconnaît les libellés d’âge espagnols avec leur unité', () => {
    const r = detectSizeLabels([[L('Talla: 2 (4, 6) años')]])
    expect(r.labels).toEqual(['2', '4', '6 años'])
    expect(r.from).toBe('line')
  })
  // Cas réel : « Größe: 18 Monate, (2, 4, 6, 8) Jahre » — DEUX unités
  // d'âge sur la même ligne (unité individuelle « 18 Monate » PUIS unité de groupe « … Jahre »).
  // vectorAgeLabelsOf fusionnait à tort le préfixe « 18 Monate, » dans le premier libellé
  // (« 18 Monate, 2 »), ne rendant que 4 libellés au lieu de 5 — et comme n = labels.length
  // dans le pipeline réel (assemble.js), ce miscompte aurait GELÉ le gabarit multi-tailles de
  // TOUT LE RESTE DU DOCUMENT (les vecteurs corps à 5 valeurs, `applySizeVectors(…, n)`, ne
  // matchent plus n=4). La garde anti-fusion doit faire échouer vectorAgeLabelsOf ici et
  // replier sur tokensOf (5 tokens numériques nus, sans unité mais avec le BON compte).
  // Bug (heart-full-of-joy-pillow-es-ba96e958, palier 5/8) : la légende
  // d'un diagramme de points colorés « Corazón color N (0XX) », répétée 1×/couleur (4
  // occurrences), était CHACUNE matchée par findSizeVectors comme un vecteur à 2 valeurs
  // (le nombre libre + le groupe parenthésé). Le repli modal (≥3 occurrences cohérentes)
  // en déduisait à tort n=2 tailles (T1/T2) sur un patron en réalité MONO-TAILLE (« Talla
  // única » / Ancho / Largo) → `sizes:` fabriquait « T1 · T2 » et le bloc Tailles entier
  // disparaissait du corps (aucune branche de extractReference n'a de filet pour n=2 sur
  // une ligne à valeur unique). Une fois la légende exclue, aucun autre repli (mot-clé,
  // en-tête, préfixe, modal) ne trouve de tailles → labels=[] → assemble.js retombe sur
  // le n=1 par défaut (['Taille unique']), ce qui ouvre le bon filet dans reference.js.
  it('ne fabrique pas de repli modal T1/T2 depuis 4 légendes de couleur répétées (patron mono-taille, heart-full-of-joy-pillow-es)', () => {
    const pages = [[
      L('BC color Grey (08)'),
      L('Corazón color 1 (019)'),
      L('Corazón color 2 (010)'),
      L('Corazón color 3 (011)'),
      L('Corazón color 4 (006)'),
      L('TALLA'),
      L('Talla única'),
      L('Ancho: 58 cm'),
      L('Largo: 50 cm'),
    ]]
    const r = detectSizeLabels(pages)
    expect(r.labels).toEqual([])
    expect(r.from).toBe('none')
  })
  // hazy-whisper-sweater-de-3f672f59 (corpus réel, tricot, palier 6) : le PDF utilise le
  // ẞ CAPITAL moderne (U+1E9E, rendu Google Docs de l'eszett en majuscules — orthographe
  // allemande correcte depuis 2017), PAS « SS ». Le flag /i de SIZE_KEYWORD_ONLY_RE ne
  // case-fold PAS U+1E9E → U+00DF (ß) comme le ferait .toLowerCase() : le mot-clé « GRÖẞE »
  // seul sur sa ligne n'était donc jamais reconnu, et `sizes:` retombait sur le repli
  // modal générique T1..Tn au lieu des vraies tailles numériques « 1 (2) 3 (4) 5 (6) 7 (8) ».
  it('« GRÖẞE » (ẞ capital moderne, mot-clé seul sur sa ligne) reconnaît les tailles numériques suivantes', () => {
    const r = detectSizeLabels([[L('GRÖẞE'), L('1 (2) 3 (4) 5 (6) 7 (8)')]])
    expect(r.labels).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(r.from).toBe('line')
  })
  it('E2E : ligne allemande à double unité — le compte (n) reste cohérent avec les vecteurs du corps (pas de gel du gabarit)', () => {
    const pages = [[
      L('Größe: 18 Monate, (2, 4, 6, 8) Jahre'),
      L('Monter 40 (42) 44 (46) 48 mailles.'),
    ]]
    const r = detectSizeLabels(pages)
    expect(r.from).toBe('line')
    expect(r.labels).toEqual(['18', '2', '4', '6', '8'])
    const { t, c } = applySizeVectors('Monter 40 (42) 44 (46) 48 mailles.', r.labels.length)
    expect(t).toBe('Monter {{0}} mailles.')
    expect(c).toEqual([['40', '42', '44', '46', '48']])
  })
  // Cas réel (palier 8/8, knitted-crown-headband-es-a5a5513c) : mot-clé « Tallas »
  // seul sur sa ligne, puis « Bebé/0-1 año (Niño/2-15 años) Adulto » — 3 libellés TEXTE+ÂGE
  // complets, un SEUL (le 2e) entre parenthèses (parenthèse PARTIELLE : contrairement à la
  // notation vectorielle « 36 (38) 40 » où c'est le NOMBRE qui est parenthésé, ici c'est un
  // item texte entier). ageTokensOf échoue (préfixe « Bebé/ »/« Niño/ » n'est pas un résidu de
  // ponctuation) ; vectorAgeLabelsOf échoue (la ligne ne finit pas par une unité d'âge nue :
  // dernier item « Adulto », un mot sans chiffre) ; tokensOf échoue (aucun token brut n'est un
  // token de taille valide sur cette ligne accentuée). Avant correctif : aucun des 3 analyseurs
  // ne reconnaissait la ligne → repli modal générique `sizes: T1 · T2 · T3`, perdant les 3
  // vrais libellés (« Bebé/0-1 año », « Niño/2-15 años », « Adulto »).
  it('libellés « texte+âge » à parenthèse PARTIELLE (knitted-crown-headband-es, palier 8/8)', () => {
    const r = detectSizeLabels([[L('Tallas'), L('Bebé/0-1 año (Niño/2-15 años) Adulto')]])
    expect(r.labels).toEqual(['Bebé/0-1 año', 'Niño/2-15 años', 'Adulto'])
    expect(r.from).toBe('line')
  })
  it('« texte+âge » à parenthèse partielle : forme mot-clé+valeurs SUR LA MÊME LIGNE (via sizeLineTokens)', () => {
    const r = detectSizeLabels([[L('Tallas: Bebé/0-1 año (Niño/2-15 años) Adulto')]])
    expect(r.labels).toEqual(['Bebé/0-1 año', 'Niño/2-15 años', 'Adulto'])
    expect(r.from).toBe('line')
  })
  it('non-régression : « texte+âge » à parenthèse partielle n\'interfère pas avec un en-tête S/M/L classique à 2 groupes (« XS (S) M (L) XL »)', () => {
    const r = detectSizeLabels([[L('Tailles : XS (S) M (L) XL')]])
    expect(r.labels).toEqual(['XS', 'S', 'M', 'L', 'XL'])
    expect(r.from).toBe('line')
  })
  it('non-régression : ne capte pas une parenthèse de prose sans aucun chiffre ni unité d\'âge (garde anti faux positif — items à un seul mot, seule forme qui atteint la garde plutôt que d\'être déjà rejetée par la forme de l\'item)', () => {
    const r = detectSizeLabels([[L('Tailles'), L('Rojo (Azul) Verde')]])
    expect(r.labels).toEqual([])
    expect(r.from).toBe('none')
  })
  // Bug réel (penny-socks-es-3b0f0a03) : « tallas » atterrit en
  // tête de LIGNE par pur hasard de retour à la ligne du PDF, au milieu d'une phrase de
  // prose marketing (« …ancho. Se ajusta aproximadamente a las » / « tallas 36/37 - 38/39
  // - 40/41. »). SIZE_LINE_RE (ancrée en tête de LIGNE, pas de phrase) la prenait pour un
  // en-tête et fabriquait 3 FAUSSES tailles alors que le patron n'en déclare qu'une seule
  // (TALLA: 36-41, plage de pointure d'une taille élastique unique). Le seul signal retenu
  // (revue) est la ponctuation de fin de phrase de la queue — ici le point final de
  // « …40/41. » : la ligne précédente n'intervient plus (cf. commentaire sizes.js sur le
  // signal écarté).
  it('ne fabrique pas de tailles depuis un mot-clé de taille tombé en tête de ligne par un simple retour à la ligne (phrase de prose finie par un point, pas un en-tête, penny-socks-es)', () => {
    const r = detectSizeLabels([[
      L('ancho. Se ajusta aproximadamente a las'),
      L('tallas 36/37 - 38/39 - 40/41.'),
    ]])
    expect(r.labels).toEqual([])
  })
  // Isole le signal retenu (point final de la queue) de tout signal tiré de la ligne
  // précédente : ici la ligne précédente finit par une MAJUSCULE (« MEDIDAS »), donc un
  // ancien signal « minuscule précédente » ne rejetterait pas — seul le point final de
  // « …104. » explique le rejet.
  it('le point final de la queue suffit seul à rejeter, même précédé d\'un vrai titre de section (majuscule)', () => {
    const r = detectSizeLabels([[L('MEDIDAS'), L('tallas 36/37 - 38/39 - 40/41.')]])
    expect(r.labels).toEqual([])
  })
  // Couvre le « ! » de SIZE_LINE_SENTENCE_END_RE (jusqu'ici seul « . » était exercé par un
  // test) : le point d'exclamation clôt aussi une phrase de prose dans ce corpus même
  // (« ¡Que te diviertas tejiendo! », penny-socks-es), donc ce n'est pas une alternative
  // spéculative — une prose exclamative qui contiendrait par hasard le même mot-clé de
  // taille en tête de ligne ne doit pas fabriquer de tailles non plus.
  it('un point d\'exclamation final rejette aussi (même signal que le point, prose exclamative)', () => {
    const r = detectSizeLabels([[
      L('ancho. Se ajusta aproximadamente a las'),
      L('tallas 36/37 - 38/39 - 40/41!'),
    ]])
    expect(r.labels).toEqual([])
  })
  // Revue (finding confirmé empiriquement) : un second signal « la ligne précédente finit
  // par une minuscule » avait été envisagé, mais un nom allemand porte sa majuscule sur sa
  // PREMIÈRE lettre, pas la dernière — un titre Title-Case légitime (« Größentabelle », une
  // légende, une phrase-titre sans ponctuation finale) finit presque toujours par une
  // minuscule SANS être une phrase inachevée. Ce signal aurait rejeté à tort le VRAI en-tête
  // qui suit. Retiré : ces trois cas (témoins directs de la revue) doivent tous les trois
  // reconnaître leurs vraies tailles.
  it('garde retirée (revue) : un titre Title-Case allemand sans ponctuation finale ne doit pas faire rejeter le vrai en-tête qui suit', () => {
    const r = detectSizeLabels([[L('Größentabelle'), L('Größe: 92 (98) 104')]])
    expect(r.labels).toEqual(['92', '98', '104'])
    expect(r.from).toBe('line')
  })
  it('garde retirée (revue) : une légende allemande sans ponctuation finale ne doit pas faire rejeter le vrai en-tête qui suit', () => {
    const r = detectSizeLabels([[L('Für Babys im Alter von 0 bis 3 Monaten'), L('Größe: 56 (62) 68')]])
    expect(r.labels).toEqual(['56', '62', '68'])
    expect(r.from).toBe('line')
  })
  it('garde retirée (revue) : une phrase-titre allemande sans ponctuation finale ne doit pas faire rejeter le vrai en-tête qui suit', () => {
    const r = detectSizeLabels([[L('Empfohlen für folgende Körpergröße'), L('Größen 92 (98) 104')]])
    expect(r.labels).toEqual(['92', '98', '104'])
    expect(r.from).toBe('line')
  })
  // Discriminant (garde pas trop large) : un VRAI en-tête « mot-clé + valeurs » précédé
  // d'un titre de section (finit par une majuscule, pas de point) doit continuer à
  // fonctionner — sinon la garde anti faux positif ci-dessus serait devenue trop large.
  it('non-régression : un vrai en-tête « mot-clé + valeurs » précédé d\'un titre de section reste reconnu', () => {
    const r = detectSizeLabels([[L('MEDIDAS'), L('Tallas: 36 (38) 40')]])
    expect(r.labels).toEqual(['36', '38', '40'])
    expect(r.from).toBe('line')
  })
  // Bug réel (candy-cane-stripes-children-s-sweater-es-76c22b04) :
  // « TALLA » seul sur sa ligne, puis « (1-2, 3-4, 5-6) (7-8, 9-10) año/s » — Hobbii ES note
  // couramment le pluriel optionnel d'un mot par un « /s » final (même convention que
  // « p/pts = punto/s » dans la légende ABREVIATURAS de ce même document), forme qu'AGE_UNIT
  // (a[ñn]os?) ne couvrait pas. vectorAgeLabelsOf échouait donc (TRAILING_AGE_UNIT_RE ne
  // matchait jamais « año/s »), et faute d'aucun autre analyseur reconnaissant la ligne,
  // detectSizeLabels retombait sur le repli modal générique (le document contient de
  // nombreux vecteurs à 5 valeurs dans le corps) : `sizes: T1 · T2 · T3 · T4 · T5`,
  // FABRIQUANT une fausse structure de tailles à la place des 5 vraies tranches d'âge.
  it('libellés « âge » espagnol avec pluriel noté « /s » (candy-cane-stripes-es)', () => {
    const r = detectSizeLabels([[L('TALLA'), L('(1-2, 3-4, 5-6) (7-8, 9-10) año/s')]])
    expect(r.labels).toEqual(['1-2', '3-4', '5-6', '7-8', '9-10 año/s'])
    expect(r.from).toBe('line')
  })
  // Bornes réelles du même document (PAS synthétiques) : deux lignes de PROSE du corps qui
  // partagent exactement la même forme lexicale (groupe(s) + « año/s ») mais avec le mauvais
  // nombre de tailles pour CE patron (2 et 4, alors que n=5) et une ponctuation finale « : »
  // qui casse l'ancrage `$` de TRAILING_AGE_UNIT_RE. Un correctif trop large (qui tolérerait
  // la ponctuation finale) fabriquerait ici 2 puis 4 fausses tailles depuis de la prose de
  // corps — non-régression du garde-fou existant, pas seulement du nouveau cas.
  it('non-régression : une ligne de CORPS à la même forme lexicale mais au mauvais compte de tailles (2 valeurs) n\'est pas lue comme un en-tête', () => {
    expect(sizeLineTokens('(1-2) (7-8) año/s:')).toBeNull()
  })
  it('non-régression : une ligne de CORPS à la même forme lexicale mais au mauvais compte de tailles (4 valeurs) n\'est pas lue comme un en-tête', () => {
    expect(sizeLineTokens('(1-2, 3-4, 5-6) (7-8) año/s:')).toBeNull()
  })
  // Composition avec le garde (penny-socks-es, point final = phrase de prose) :
  // la variante « /s » ne doit pas contourner ce garde-fou.
  it('non-régression : la variante « /s » ne contourne pas le garde phrase-de-prose (point final) de la vague 5', () => {
    const r = detectSizeLabels([[
      L('foo'),
      L('Ronda 3: Repite la Ronda 2. Talla (1-2, 3-4) año/s, remata.'),
    ]])
    expect(r.labels).toEqual([])
  })
  // Revue (finding Important sur le commit c1968436) : AGE_UNIT_TRAILING_RE doit ajouter le
  // « /s » à la SEULE alternative espagnole (a[ñn]os?), pas à toute la disjonction AGE_UNIT.
  // Une première version fautive (`${AGE_UNIT}(?:/s)?`) attachait le suffixe optionnel APRÈS
  // le groupe entier, donc à N'IMPORTE QUELLE alternative — « ans/s », « months/s », « yrs/s »,
  // « Jahre/s » matchaient tous, alors que cette convention « barre de pluriel » n'a été
  // vérifiée QUE pour l'espagnol de ce document (cf. commentaire ci-dessus, « p/pts =
  // punto/s »). Aucune de ces autres langues n'a cette convention dans le corpus mesuré :
  // les accepter serait la même invention non vérifiée que ce fichier proscrit ailleurs.
  it('non-régression : une unité d\'âge NON espagnole suivie de « /s » ne matche pas (garde étroite à a[ñn]os? seul, pas à toute la disjonction AGE_UNIT)', () => {
    expect(detectSizeLabels([[L('Tailles'), L('1-2 (2-3) 3-4 (4-5) 5-6 (6-7) ans/s')]]).labels).toEqual([])
    expect(detectSizeLabels([[L('Größe'), L('6 (12, 18, 24) Monate/s')]]).labels).toEqual([])
    expect(detectSizeLabels([[L('Sizes'), L('6 (12, 18, 24) months/s')]]).labels).toEqual([])
    expect(detectSizeLabels([[L('Sizes'), L('1 (2) 3 (4) yrs/s')]]).labels).toEqual([])
  })
  // Bug réel (very-granny-cardigan-fr-cb10fc64) : le PDF déclare
  // 4 GROUPES de tailles « TAILLE / (XS - S) (M - XL) (2XL - 4XL) (5XL) » et TOUS ses
  // vecteurs ont 4 valeurs (« (7) (8) (8) (9) pelotes », « Circonférence: (96) (128) (160)
  // (192) cm »). LABEL_TOKEN_RE ne reconnaissant le séparateur de groupe que COLLÉ
  // (« [/-] » sans espaces autour), « XS - S » éclatait en DEUX tokens → 7 tailles
  // individuelles XS·S·M·XL·2XL·4XL·5XL pour des vecteurs à 4 valeurs : l'invariant
  // tokens.length === raw.length passait (7=7) sans rien détecter, et le mapping
  // tailles↔valeurs était faux sur tout le patron (une utilisatrice taille S croyait
  // S=8 pelotes alors que XS-S=7). Correctif : normaliser les espaces autour des
  // séparateurs de groupes AVANT le scan (dans tokensOf uniquement, pour la seule
  // DÉCISION de tokenisation) → chaque groupe devient UN token.
  it('groupes de tailles « (XS - S) (M - XL) (2XL - 4XL) (5XL) » → 4 tokens de GROUPE, pas 7 tailles individuelles (very-granny-cardigan-fr)', () => {
    expect(sizeLineTokens('(XS - S) (M - XL) (2XL - 4XL) (5XL)')).toEqual(['XS-S', 'M-XL', '2XL-4XL', '5XL'])
    const r = detectSizeLabels([[L('TAILLE'), L('(XS - S) (M - XL) (2XL - 4XL) (5XL)')]])
    expect(r.labels).toEqual(['XS-S', 'M-XL', '2XL-4XL', '5XL'])
    expect(r.from).toBe('line')
  })
  it('la normalisation des séparateurs espacés ne casse ni la chaîne à barres collée ni les tailles individuelles', () => {
    // Chaîne pure à barres COLLÉE : chaque segment reste une taille individuelle.
    expect(sizeLineTokens('XS/S/M/L')).toEqual(['XS', 'S', 'M', 'L'])
    // Tailles individuelles séparées par des espaces (ni « - » ni « / ») : inchangé.
    expect(sizeLineTokens('XS S M L XL')).toEqual(['XS', 'S', 'M', 'L', 'XL'])
  })
  it('non-régression anti-prose : un tiret espacé dans une phrase ne la fait pas parser (invariant tokens === raw)', () => {
    // « bas - en » devient « bas-en » après normalisation : le token joint n'est pas un
    // token de taille valide → rejet, comme avant. La normalisation ne doit ouvrir AUCUNE
    // ligne de prose au parsing.
    expect(sizeLineTokens('Se tricote de haut en bas - en une seule pièce')).toBeNull()
    expect(sizeLineTokens('Coupe oversize - cintrée aux bonnes places')).toBeNull()
  })
  // Régression réelle introduite par la normalisation ci-dessus (commit 3abc667f, bug
  // vérifié sur sunny-song-en-7331474f) : une liste NUE à tirets
  // espacés « SIZE: / S - M - L - XL - XXL – XXXL » (séparateur ENTRE tailles
  // individuelles, AUCUN groupement) voyait ses tirets resserrés en groupes faux →
  // 4 tokens « S-M · L-XL · XXL · XXXL » au lieu des 6 tailles individuelles, et les
  // vecteurs DROPS à 6 valeurs (« 84-92-100-110-122-134 ») ne matchaient plus n=4 :
  // plus aucun {{i}}, subsizes perdue. Deux formes réelles en tension, départagées par
  // le corpus (échantillon 231 PDF corpus-web) : les groupes à séparateur
  // espacé n'existent QUE parenthésés « (XS - S) (M - XL) » (very-granny, seul cas du
  // corpus) ; les listes NUES à tirets espacés (sunny-song ×9 lang. à tirets ASCII,
  // sunflower-slip-top ×4 lang. au cadratin « – ») sont TOUJOURS des tailles
  // individuelles. La normalisation ne s'applique donc QUE si la ligne contient un
  // groupe parenthésé avec séparateur dedans ; une liste nue garde le comportement
  // d'origine (tokens individuels).
  it('liste NUE à tirets espacés → tailles INDIVIDUELLES, pas des groupes (sunny-song-en-7331474f)', () => {
    // Citation exacte du PDF : tirets ASCII espacés, cadratin « – » devant XXXL (le
    // cadratin n'a jamais été dans [/-] ; sans normalisation, LABEL_TOKEN_RE le saute
    // comme n'importe quel caractère hors token — comportement d'origine pré-3abc667f).
    expect(sizeLineTokens('S - M - L - XL - XXL – XXXL')).toEqual(['S', 'M', 'L', 'XL', 'XXL', 'XXXL'])
    // Variante tout-cadratin (sunflower-slip-top-es-44ee6478, citation exacte) : le
    // cadratin n'étant pas dans [/-], cette forme n'a jamais été touchée par la
    // normalisation — 7 tailles individuelles avant comme après.
    expect(sizeLineTokens('XS – S – M – L – XL – XXL – XXXL')).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'])
    // Niveau detectSizeLabels, citation exacte de la mise en page (« SIZE: » seul sur
    // sa ligne, la liste sur la suivante) : 6 tailles individuelles.
    const r = detectSizeLabels([[L('SIZE:'), L('S - M - L - XL - XXL – XXXL')]])
    expect(r.labels).toEqual(['S', 'M', 'L', 'XL', 'XXL', 'XXXL'])
    expect(r.from).toBe('line')
  })
  it('non-régression du correctif very-granny : les groupes PARENTHÉSÉS à tirets espacés restent des groupes', () => {
    // La condition « parenthésé » ne doit pas retirer le comportement visé par 3abc667f :
    // la ligne very-granny contient bien des « (…) » avec séparateur dedans → normalisée.
    expect(sizeLineTokens('(XS - S) (M - XL) (2XL - 4XL) (5XL)')).toEqual(['XS-S', 'M-XL', '2XL-4XL', '5XL'])
    // Un groupe parenthésé à BARRE espacée aussi (même forme, séparateur /) : normalisé.
    expect(sizeLineTokens('(XS / S) (M / L)')).toEqual(['XS/S', 'M/L'])
  })
  // Bug réel (stripe-raglan-sweater-little-one-s-tweens-girls-fr-ce80f303 et
  // flutterby-top-en-e2b5644a) : la branche « mot-clé + valeurs
  // sur la MÊME ligne » (SIZE_LINE_RE) ne lisait que la PREMIÈRE ligne physique et
  // retournait dès 2 libellés. La mise en page du PDF wrappe pourtant la liste :
  // « Tailles: 1-2 ans (3-4 ans) 5-6 ans » puis « (7-8 ans) 9-10 ans (11-12 ans) » →
  // 3 tailles lues sur 6 déclarées, alors que TOUS les vecteurs du corps ont 6 valeurs :
  // n = labels.length pilote le gabarit multi-tailles de tout le document (assemble.js),
  // donc plus aucun {{i}} ne matchait. Miroir du recoll multi-lignes déjà existant pour
  // la branche « TAILLES » seul sur sa ligne (continuations d'âge) : recoll BORNÉ à
  // 1-2 lignes suivantes, accepté SEULEMENT si le texte recollé parse ENTIÈREMENT
  // (l'invariant tokens.length === raw.length de tokensOf reste le garde anti-fabrication).
  it('« Tailles: … » wrappée sur deux lignes : le recoll borné rend les 6 tailles (stripe-raglan)', () => {
    const r = detectSizeLabels([[
      L('DIMENSIONS FINALES DU PULL'),
      L('Tailles: 1-2 ans (3-4 ans) 5-6 ans'),
      L('(7-8 ans) 9-10 ans (11-12 ans)'),
      L('Buste'),
    ]])
    expect(r.labels).toEqual(['1-2 ans', '3-4 ans', '5-6 ans', '7-8 ans', '9-10 ans', '11-12 ans'])
    expect(r.from).toBe('line')
  })
  // flutterby : « SIZE » seul sur sa ligne (autre branche), valeurs wrappées sur DEUX
  // lignes « XXS (XS, S, M) [L, XL, 2XL] (3XL, 4XL, 5XL, » / « 6XL) » → 10 tailles lues
  // sur 11 (la 6XL, coupée en fin de wrap, manquait), vecteurs du corps à 11 valeurs
  // décalés d'un cran sur tout le patron. Exige AUSSI le token « 6XL » : le préfixe
  // lettré de SIZE_TOKEN_RE plafonnait à 5XL (jamais observé au-delà de 6XL dans le
  // corpus mesuré — refs banc —, 7XL+ resterait hors grammaire, non-invention).
  it('« SIZE » seul, valeurs wrappées : le recoll borné rend les 11 tailles dont 6XL (flutterby)', () => {
    const r = detectSizeLabels([[
      L('SIZE'),
      L('XXS (XS, S, M) [L, XL, 2XL] (3XL, 4XL, 5XL,'),
      L('6XL)'),
      L('MEASUREMENTS'),
    ]])
    expect(r.labels).toEqual(['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'])
    expect(r.from).toBe('line')
  })
  it('contre-test : une prose « Tailles: … » partielle suivie de sa suite ne fabrique aucune taille', () => {
    // La ligne seule échoue (« et » n'est ni un résidu de ponctuation ni un token de
    // taille) ; le recoll borné avec la ligne suivante doit échouer pareillement — le
    // garde anti-fabrication doit tenir sur le texte recollé, pas seulement la 1re ligne.
    const r = detectSizeLabels([[
      L('Tailles: 1-2 ans et'),
      L('3-4 ans pour les plus grands.'),
    ]])
    expect(r.labels).toEqual([])
    expect(r.from).toBe('none')
  })
  it('non-régression : un en-tête complet suivi d’une ligne de corps quelconque garde sa lecture mono-ligne', () => {
    // Le recoll ne doit JAMAIS dégrader la lecture déjà acquise : une continuation qui
    // ne parse pas entièrement (prose de corps) laisse la ligne seule au résultat.
    const r = detectSizeLabels([[
      L('Tailles: S M L'),
      L('Tricoter 20 mailles.'),
    ]])
    expect(r.labels).toEqual(['S', 'M', 'L'])
    expect(r.from).toBe('line')
  })
  // (revue) Une continuation PUREMENT NUMÉRIQUE parse intégralement
  // en tokens de tailles (SIZE_TOKEN_RE admet les nombres nus) et, « best garde le plus
  // grand nombre » faisant foi, écrasait la lecture mono-ligne CORRECTE de l'en-tête :
  // les mesures de buste wrappées, un vecteur DROPS ou un simple numéro orphelin
  // devenaient autant de fausses tailles supplémentaires — n = labels.length pilote le
  // gabarit multi-tailles de tout le document (plus aucun {{i}} ne matchait). Durcissement :
  // une continuation n'est recollée QUE si elle apporte au moins un token NON purement
  // numérique (lettre, âge, XS/S/M/L…) ; les continuations à nombres nus et unités
  // filtrées (cm/mm/in) sont rejetées. Les vraies continuations mesurées (stripe-raglan
  // « (7-8 ans)… », flutterby « 6XL) ») contiennent des lettres — non-régression couverte
  // par les deux tests ci-dessus.
  it('une continuation purement numérique (mesures + unités filtrées) ne recolle pas : « Tailles: S M L » + « 76 82 88 cm »', () => {
    const r = detectSizeLabels([[
      L('Tailles: S M L'),
      L('76 82 88 cm'),
    ]])
    expect(r.labels).toEqual(['S', 'M', 'L'])
  })
  it('une continuation vectorielle DROPS purement numérique ne recolle pas : « Tailles: S M L » + « 84-92-100-108 »', () => {
    const r = detectSizeLabels([[
      L('Tailles: S M L'),
      L('84-92-100-108'),
    ]])
    expect(r.labels).toEqual(['S', 'M', 'L'])
  })
  it('un numéro orphelin ne recolle pas : « Tailles: S M L » + « 16 »', () => {
    const r = detectSizeLabels([[
      L('Tailles: S M L'),
      L('16'),
    ]])
    expect(r.labels).toEqual(['S', 'M', 'L'])
  })
  // Change 2 (bug moss-stitch-basket-square-fr-d86efcef) : le PDF ne déclare ses
  // tailles NULLE PART ailleurs qu'en TITRES DE SECTION DIMENSIONNELS (« Panier 15 x 15 x
  // H 9 cm », « Panier 18 x 18 x H 10 cm », « Panier 22 x 22 x H 11 cm » — typographie
  // size 14 vs corps 8, titres reconnus par DIMENSIONAL_SIZE_TITLE_RE depuis le change 1).
  // Aucune source ci-dessus ne les voit → detectSizeLabels retombait sur le repli modal
  // générique T1·T2·T3 (le corps porte 3 vecteurs à 3 valeurs, « 73 (97) 105 » ×3) et le
  // front-matter FABRIQUAIT des tailles fantômes. La branche dimensionnelle ne s'exprime
  // qu'À CET ENDROIT de la cascade — après toutes les autres sources, au moment précis où
  // le repli modal allait fabriquer ses T1..Tn — et sous DOUBLE garde : ≥2 libellés
  // DISTINCTS (≤8, dédupliqués), ET cohérence du compte de libellés avec la longueur
  // vectorielle dominante du corps (une divergence signale qu'on a capté autre chose que
  // des tailles → repli sur le comportement antérieur).
  it('titres dimensionnels → libellés « dims+unité » SANS la tête lettrée, à la place du repli modal T1·T2·T3 (moss-stitch-basket-square-fr)', () => {
    const pages = [[
      L('Panier 15 x 15 x H 9 cm'),
      L('Le fond:'),
      L('2.) 73 (97) 105 ms en pba.'),
      L('20. - 21.) 73 (97) 105 mc.'),
      L('Panier 18 x 18 x H 10 cm'),
      L('Le fond:'),
      L('2.) 73 (97) 105 ms en pba.'),
      L('Panier 22 x 22 x H 11 cm'),
      L('Le fond:'),
    ]]
    const r = detectSizeLabels(pages)
    expect(r.labels).toEqual(['15 x 15 x H 9 cm', '18 x 18 x H 10 cm', '22 x 22 x H 11 cm'])
    expect(r.from).toBe('dimensional')
  })
  it('une SEULE ligne dimensionnelle (mono-taille) → pas de capture par la branche, comportement antérieur', () => {
    const pages = [[
      L('Panier 15 x 15 x H 9 cm'),
      L('Le fond:'),
      L('1.) 8 ms in mr, dans la 1ère ms'),
      L('2.) 1 châin, 1 ms dans le même m, 3 ms udt, *1 ms, 3 ms udt* x 3, 1 mc en châin. (16)'),
    ]]
    const r = detectSizeLabels(pages)
    expect(r.labels).toEqual([])
    expect(r.from).toBe('none')
  })
  it('une vraie ligne de tailles S/M/L + titres dimensionnels → la source S/M/L gagne (la branche n’est qu’un dernier recours avant le repli modal)', () => {
    const pages = [[
      L('Tailles : S M L'),
      L('Monter 104 (108) 112 m.'),
      L('Tricoter 8 (9) 10 rangs'),
      L('Continuer 5 (6) 7 fois.'),
      L('Panier 15 x 15 x H 9 cm'),
      L('Panier 18 x 18 x H 10 cm'),
      L('Panier 22 x 22 x H 11 cm'),
    ]]
    const r = detectSizeLabels(pages)
    expect(r.labels).toEqual(['S', 'M', 'L'])
    expect(r.from).toBe('line')
  })
  it('2 lignes dimensionnelles mais vecteurs du corps à 3 valeurs → incohérence : la branche ne s’exprime pas, repli modal antérieur conservé', () => {
    const pages = [[
      L('Panier 15 x 15 x H 9 cm'),
      L('Panier 18 x 18 x H 10 cm'),
      L('Monter 104 (108) 112 m.'),
      L('Tricoter 8 (9) 10 rangs'),
      L('Continuer 5 (6) 7 fois.'),
    ]]
    const r = detectSizeLabels(pages)
    expect(r.labels).toEqual(['T1', 'T2', 'T3'])
    expect(r.from).toBe('modal')
  })
  it('non-régression : lignes parasites « Dimensions: D … cm/Cosy fil … g. » du même PDF ne sont pas captées (hors grammaire DIMENSIONAL_SIZE_TITLE_RE)', () => {
    const pages = [[
      L('Dimensions: D 15 cm x H 9 cm/Cosy fil 150 g.'),
      L('Dimensions: D 18 cm x H 10 cm/Cosy fil 200 g.'),
      L('Dimensions: D 22 cm x H 11 cm/Cosy fil 275 g.'),
      L('Monter 104 (108) 112 m.'),
      L('Tricoter 8 (9) 10 rangs'),
      L('Continuer 5 (6) 7 fois.'),
    ]]
    const r = detectSizeLabels(pages)
    expect(r.labels).toEqual(['T1', 'T2', 'T3'])
    expect(r.from).toBe('modal')
  })
  it('dédupe : un titre dimensionnel répété (rappel de mise en page) ne fabrique pas de libellé en double', () => {
    const pages = [[
      L('Panier 15 x 15 x H 9 cm'),
      L('2.) 73 (97) 105 ms en pba.'),
      L('Panier 18 x 18 x H 10 cm'),
      L('20. - 21.) 73 (97) 105 mc.'),
      L('Panier 22 x 22 x H 11 cm'),
      L('2.) 73 (97) 105 ms en pba.'),
      L('Panier 15 x 15 x H 9 cm'),
    ]]
    const r = detectSizeLabels(pages)
    expect(r.labels).toEqual(['15 x 15 x H 9 cm', '18 x 18 x H 10 cm', '22 x 22 x H 11 cm'])
    expect(r.from).toBe('dimensional')
  })
})

// Bug moss-stitch-basket-square-fr-d86efcef — grammaire des titres de
// taille DIMENSIONNELS, exportée pour segment.js (garde subLabelUnderDimensionalTitle) et
// vocation partagée avec detectSizeLabels (branche dimensionnelle). Contrat verrouillé ici
// car la moindre extension (unité non finale, tête à chiffres, queue après l'unité)
// régresserait l'un des deux consommateurs : cf. les contre-exemples cités dans sizes.js.
describe('DIMENSIONAL_SIZE_TITLE_RE', () => {
  it('matche les titres de taille dimensionnels réels (moss-stitch-basket-square-fr, Go Handmade)', () => {
    expect(DIMENSIONAL_SIZE_TITLE_RE.test('Panier 15 x 15 x H 9 cm')).toBe(true)
    expect(DIMENSIONAL_SIZE_TITLE_RE.test('Panier 18 x 18 x H 10 cm')).toBe(true)
    expect(DIMENSIONAL_SIZE_TITLE_RE.test('Panier 22 x 22 x H 11 cm')).toBe(true)
  })
  it('capture la queue mesures+unité (libellé de taille) dans son groupe 1', () => {
    // La coupe tête/queue est déterministe (ancre ^ + tête greedy) : le groupe 1 commence
    // à la 1re mesure. Un éventuel « H » de tête est absorbé par la tête lettrée (jamais
    // un suffixe leftmost ambigu comme avec une regex sœur séparée).
    expect(DIMENSIONAL_SIZE_TITLE_RE.exec('Panier 15 x 15 x H 9 cm')[1]).toBe('15 x 15 x H 9 cm')
    expect(DIMENSIONAL_SIZE_TITLE_RE.exec('Panier H 15 x 15 cm')[1]).toBe('15 x 15 cm')
  })
  it('rejette les contre-exemples qui bornent le scope', () => {
    // Unité pas en fin de ligne (du texte suit la 1re mesure) + tête interrompue par « : ».
    expect(DIMENSIONAL_SIZE_TITLE_RE.test('Dimensions: D 15 cm x H 9 cm/Cosy fil 150 g.')).toBe(false)
    // Pas de tête lettrée (plage d'aiguilles).
    expect(DIMENSIONAL_SIZE_TITLE_RE.test('4,0 - 4,5 mm')).toBe(false)
    // Étiquette de pelote flamingo-love-blanket-de (faux titre fort de page de garde).
    expect(DIMENSIONAL_SIZE_TITLE_RE.test('Sunflower (#36) - 1 Knäuel')).toBe(false)
    // Titre de section sans aucune mesure.
    expect(DIMENSIONAL_SIZE_TITLE_RE.test('Panier avec fond rigide et trous')).toBe(false)
    // Grammage APRÈS l'unité (étiquette de pelote granny-shawl-jacket) — l'unité doit être finale.
    expect(DIMENSIONAL_SIZE_TITLE_RE.test('Cosy 108 x 108 cm 600 g')).toBe(false)
  })
})

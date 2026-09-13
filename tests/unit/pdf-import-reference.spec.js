import { describe, it, expect } from 'vitest'
import { extractReference } from '@/utils/pdf-import/reference'
import { segmentSections, isBareSizeVectorLine } from '@/utils/pdf-import/segment'
import { buildReaderFromPages } from '@/utils/pdf-import/assemble'

const L = (text) => ({ text, size: 10, bold: false, y: 0 })
const sec = (title, ref, texts, kind = 'pelote') => ({ title, kind, ref, lines: texts.map(L) })

describe('extractReference', () => {
  it('abréviations « X = déf » et « X : déf » depuis la section dédiée', () => {
    const { reference } = extractReference([sec('ABRÉVIATIONS', 'abbr', ['m. = maille(s)', 'end. : à l’endroit', 'AugD = augmentation inclinée à droite'])], { n: 1 })
    expect(reference.abbr['m.']).toBe('maille(s)')
    expect(reference.abbrFull).toHaveLength(3)
  })
  // ups-and-downs-blanket-en-258ffe33 (corpus réel, crochet, palier 7) : ABBR_LINE_RE
  // plafonnait la CLÉ à 24 caractères — « Spike double crochet stitches » (29 car.) dépassait
  // ce plafond, execAbbrLine/formRejectedAbbrLine échouaient tous deux (même regex clé),
  // l'entrée disparaissait du tableau Abréviations (texte survivant mais sans étiquette,
  // noyé dans l'intro). Plafond élargi 24→40 (même geste que le plafond auteur 40→70,
  // palier 6).
  it('capte une clé d’abréviation de 25-40 caractères (plafond élargi 24→40)', () => {
    const abbrSec = sec('ABBREVIATIONS', 'abbr', [
      'Spike double crochet stitches = made by inserting the hook into a stitch ( or a space) the row (or several rows ) below the row currently being worked.',
    ])
    const { reference } = extractReference([abbrSec], { n: 1 })
    expect(reference.abbr['Spike double crochet stitches']).toBe(
      'made by inserting the hook into a stitch ( or a space) the row (or several rows ) below the row currently being worked.',
    )
  })
  // Non-régression (recherche de faux positif imposée par le palier) : le plafond élargi
  // ouvre la porte à une clé de 25-40 caractères qui n'est PAS une vraie clé de glossaire.
  // Trouvé dans le corpus mesuré (hazy-whisper-sweater-de-3f672f59, palier 6) : un bug de
  // reflow allemand déjà documenté (shouldJoin) recolle la queue d'une définition à la clé
  // SUIVANTE sur une seule ligne — « Stricke ihn rechts ab. M1RP = rechts geneigte » (def
  // « rechts geneigte », courte, single-clause : passe tous les autres gardes). Signe
  // distinctif : la clé contient elle-même un point de fin de phrase suivi d'une majuscule —
  // une vraie clé de glossaire, même longue (« Spike double crochet stitches »), n'en
  // contient jamais.
  it('n’ajoute pas à tort une clé de 25-40 caractères contenant une phrase entière (fragment de reflow, hazy-whisper-sweater-de)', () => {
    const abbrSec = sec('ABKÜRZUNGEN', 'abbr', ['Stricke ihn rechts ab. M1RP = rechts geneigte'])
    const { reference } = extractReference([abbrSec], { n: 1 })
    expect(reference.abbr['Stricke ihn rechts ab. M1RP']).toBeUndefined()
    expect(reference.abbrFull).toHaveLength(0)
  })
  // Retour banc (picture-ornament-fr-047559ed, Hobbii crochet) : la légende des symboles de
  // répétition (« [ ] indique que… », « { } indique que… ») n'a NI séparateur (=/:/tiret) NI
  // ponctuation finale dans le PDF source — elle disparaissait entièrement (ni dans le
  // tableau, ni en note). Doit désormais rejoindre le tableau Abréviations, à côté des vraies
  // entrées, plutôt qu'une note isolée sans rapport avec les symboles qu'elle explique.
  it('capte la légende de notation « [ ] indique que… »/« { } indique que… » à côté des vraies abréviations (picture-ornament-fr)', () => {
    const abbrSec = sec('ABRÉVIATIONS', 'abbr', [
      'ml = maille en l’air',
      'm = maille',
      'cc = changer de couleur',
      '[ ] indique que les mailles sont travaillées dans la même maille',
      '{ } indique que les mailles sont répétées plus tard sur le tour',
    ])
    const { reference } = extractReference([abbrSec], { n: 1 })
    expect(reference.abbr['[ ]']).toBe('indique que les mailles sont travaillées dans la même maille')
    expect(reference.abbr['{ }']).toBe('indique que les mailles sont répétées plus tard sur le tour')
    // Les vraies abréviations restent intactes, rien n'est déplacé ni perdu autour du fix.
    expect(reference.abbr.ml).toBe('maille en l’air')
    expect(reference.abbr.cc).toBe('changer de couleur')
    expect(reference.abbrFull).toHaveLength(5)
  })
  // Même motif mesuré ailleurs dans le corpus (DE « bedeutet, dass », ES « indica que », FR
  // au pluriel « indiquent »/« signifie que ») : le verbe de légende est une liste FERMÉE
  // (cf. commentaire d'execNotationLegendLine), pas une simple absence de ponctuation — sinon
  // n'importe quelle clé « [ ] »/« { } » suivie de n'importe quel texte serait captée.
  it('reconnaît la légende dans les autres langues mesurées (DE/ES) et au pluriel (FR)', () => {
    const abbrSec = sec('ABKÜRZUNGEN', 'abbr', [
      '[ ] bedeutet, dass die Maschen in dieselbe Masche gearbeitet werden',
      '{ } indica que los puntos se repiten más adelante en la vuelta',
      '{ } indiquent que les mailles seront répétées plus loin dans le modèle',
    ])
    const { reference } = extractReference([abbrSec], { n: 1 })
    expect(reference.abbr['[ ]']).toBe('bedeutet, dass die Maschen in dieselbe Masche gearbeitet werden')
    expect(reference.abbrFull).toHaveLength(2)
    // Dédoublonnage global par clé (addAbbr) : deux entrées « { } » sur le même document,
    // la première rencontrée (ES) gagne — comportement existant, pas spécifique à ce fix.
    expect(reference.abbr['{ }']).toBe('indica que los puntos se repiten más adelante en la vuelta')
  })
  // Non-régression (penny-the-panda, cf. commentaire de SENTENCE_END_RE) : une vraie queue de
  // définition repliée par reflow (pas de séparateur, pas de ponctuation finale, mais AUCUN
  // verbe de légende fermé) ne doit surtout pas être happée par ce nouveau chemin — seule la
  // clé « [ ]/{ } » + verbe fermé compte, jamais une absence de ponctuation à elle seule.
  it('ne capte pas une queue de définition repliée sans verbe de légende (non-régression penny-the-panda)', () => {
    const abbrSec = sec('ABKÜRZUNGEN', 'abbr', [
      '(xx) = Klammern nach der Runde = Anzahl',
      'Maschen am Ende der Runde',
    ])
    const { reference } = extractReference([abbrSec], { n: 1 })
    expect(reference.abbr['(xx)']).toBe('Klammern nach der Runde = Anzahl')
    expect(reference.abbrFull).toHaveLength(1)
  })
  // Non-régression : une clé « [ ] »/« { } » qui n'introduit PAS une légende (texte
  // quelconque derrière, sans verbe fermé) ne doit pas devenir une fausse entrée de
  // glossaire — la clé seule ne suffit pas, cf. principe glossary-columns.js.
  it('ne capte pas « [ ] »/« { } » suivi d’un texte qui n’est pas une légende', () => {
    const abbrSec = sec('ABRÉVIATIONS', 'abbr', ['[ ] voir le diagramme page 3'])
    const { reference } = extractReference([abbrSec], { n: 1 })
    expect(reference.abbrFull).toHaveLength(0)
  })
  // Défauts 1+2 (banc, baby-unicorn-fr-a5fc31d5, corpus réel Hobbii) — une section
  // Abréviations dédiée qui enchaîne, sans transition, un rappel de fil (« Fil: Rainbow
  // 8/4 Glitter Silver ») puis ses coloris (« Optic White Silver (#001) - 1 pelote »,
  // « Antique Rose Silver (#061) - 1 pelote ») : ces lignes ne sont JAMAIS des
  // abréviations, qu'elles soient captées à tort (clé courte, « Rose (#44) ») ou
  // perdues (clé > plafond ABBR_DASH_ASCII_RE, « Optic White Silver (#001) », 26 car.).
  // Les deux symptômes ont la même cause : le correctif doit à la fois (a) ne plus les
  // faire apparaître dans le glossaire et (b) les faire atterrir quelque part d'utile
  // (le bloc Fil), pas juste disparaître.
  it('route une ligne « Fil: » et ses coloris hors du glossaire, vers le fil (baby-unicorn)', () => {
    const abbrSec = sec('ABRÉVIATIONS', 'abbr', [
      'ml - maille en l’air',
      'ms - maille serrée',
      '1 dim - travailler 2 m ensemble',
      'mc - maille coulée',
      'Fil: Rainbow 8/4 Glitter Silver',
      'Optic White Silver (#001) - 1 pelote',
      'Antique Rose Silver (#061) - 1 pelote',
    ])
    const { reference } = extractReference([abbrSec], { n: 1 })
    // Vraies abréviations toujours captées.
    expect(reference.abbr['ml']).toBe('maille en l’air')
    expect(reference.abbr['ms']).toBe('maille serrée')
    expect(reference.abbr['1 dim']).toBe('travailler 2 m ensemble')
    expect(reference.abbr['mc']).toBe('maille coulée')
    // Ni « Fil » ni les coloris ne polluent le glossaire (défaut 2).
    expect(reference.abbr['Fil']).toBeUndefined()
    expect(reference.abbr['Optic White Silver (#001)']).toBeUndefined()
    expect(reference.abbr['Antique Rose Silver (#061)']).toBeUndefined()
    expect(reference.abbrFull).toHaveLength(4)
    // Les deux couleurs (et le rappel de fil) atterrissent dans le bloc Fil (défaut 1).
    const mat = reference.tabs.find((t) => t.id === 'materiel')
    const texts = mat.blocks.flatMap((b) => b.p || [])
    const yarnText = texts.join('\n')
    expect(yarnText).toContain('Rainbow 8/4 Glitter Silver')
    expect(yarnText).toContain('Optic White Silver (#001)')
    expect(yarnText).toContain('Antique Rose Silver (#061)')
  })
  it('jauge et fil verbatim depuis le matériel', () => {
    const { reference } = extractReference([sec('MATÉRIEL', 'materiel', ['Fil : Silk Mohair, 25 g = 210 m', 'Aiguilles circulaires 4 mm et 5 mm', '20 m x 28 rangs = 10 cm en jersey'])], { n: 1 })
    const mat = reference.tabs.find((t) => t.id === 'materiel')
    const texts = mat.blocks.flatMap((b) => b.p || [])
    expect(texts).toContain('20 m x 28 rangs = 10 cm en jersey')
    // v2 : les étiquettes en ligne sont typées et le préfixe « Fil : » retiré ; la
    // valeur du fil est routée verbatim dans son bloc « Fil » (pas de perte).
    expect(texts).toContain('Silk Mohair, 25 g = 210 m')
    expect(texts).toContain('Aiguilles circulaires 4 mm et 5 mm')
  })
  // Aide-mémoire sous-titres et faux titres —
  // Juice_Sweater_by_Kutovakika (EN, corpus réel) : « Notions: 16 stitch markers » est une
  // étiquette EN LIGNE (labelFor/LABELS, table 'materials'), indépendante du mot-clé de
  // TITRE ajouté dans segment.js (KIND_KEYWORDS) — section volontairement non dédiée
  // (kind='pelote', ref=null, forme réelle rencontrée dans le PDF avant le correctif
  // segment.js) pour isoler ce second mécanisme.
  it('étiquette en ligne « Notions: 16 stitch markers » (Juice_Sweater_by_Kutovakika, EN, corpus réel) route vers le bloc Matériel', () => {
    const notionsSec = sec('NOTIONS', null, ['Notions: 16 stitch markers'], 'pelote')
    const { reference } = extractReference([notionsSec], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const matText = blocks.flatMap((b) => b.p || []).join('\n')
    expect(matText).toContain('16 stitch markers')
  })
  // hazy-whisper-sweater-de-3f672f59 (corpus réel, tricot, palier 6) : NEEDLE_RE/
  // NEEDLE_BARE_RE portaient l'alternative allemande « nadel\b » SANS pluriel — le « n » de
  // « Stricknadeln » colle au mot et casse la frontière \b, contrairement à segment.js:19
  // (KIND_KEYWORDS 'aiguilles') qui a déjà le bon motif « nadel(?:n)?\b ». Conséquence
  // observée : « Strumpfstricknadeln 4 mm » (2e paire d'aiguilles, section matériel)
  // n'atteignait jamais le bloc Aiguilles.
  it('pluriel allemand « Stricknadeln » (le "n" colle au mot) est reconnu comme aiguille, pas matériel (NEEDLE_RE, avec unité mm)', () => {
    const materiel = sec('MATERIAL', 'materiel', ['Rundstricknadel 4 mm, 40-60-80 cm.', 'Strumpfstricknadeln 4 mm', 'Garnnadel'])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    const needleText = (needleBlock?.p || []).join('\n')
    expect(needleText).toContain('Rundstricknadel 4 mm, 40-60-80 cm.')
    expect(needleText).toContain('Strumpfstricknadeln 4 mm')
    // « Garnnadel » (aiguille à laine, sans mesure) reste un accessoire de matériel, pas
    // une aiguille de travail — non-régression anti-collision du même correctif.
    expect((matBlock?.p || []).join('\n')).toContain('Garnnadel')
    expect(needleText).not.toContain('Garnnadel')
  })
  it('pluriel allemand « Stricknadeln » SANS unité mm (nombre nu) est aussi reconnu comme aiguille (NEEDLE_BARE_RE)', () => {
    const materiel = sec('MATERIAL', 'materiel', ['Stricknadeln 4', 'Garnnadel'])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).toContain('Stricknadeln 4')
  })
  // scallops-rectangular-placemat-de-85957bc1 (corpus réel, crochet, palier 7) : dans le
  // filet ligne-à-ligne d'une section ref==='aiguilles', le motif NON ANCRÉ « n[åa]l » (censé
  // matcher le scandinave « nål ») matchait par collision de sous-chaîne l'anglais
  // « optio-nal » dans « Maschenmarkierer (optional) » (marqueur de mailles, un accessoire)
  // → classée à tort Aiguilles au lieu de Matériel.
  it('« Maschenmarkierer (optional) » n’est pas classée aiguille via collision de sous-chaîne « optional »→« nal »', () => {
    const aig = sec('FERRI', 'aiguilles', ['Häkelnadel 6,00 mm', 'Maschenmarkierer (optional)'])
    const { reference } = extractReference([aig], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    expect((needleBlock?.p || []).join('\n')).not.toContain('Maschenmarkierer')
    expect((matBlock?.p || []).join('\n')).toContain('Maschenmarkierer (optional)')
  })
  // Non-régression : un vrai spec d'outil scandinave garde toujours sa mesure mm accolée
  // (gabarit Hobbii systématique) → reste capté par NEEDLE_RE (alternative n[åa]l NON
  // touchée par cet ancrage, cf. ligne ~239), vérifié empiriquement sur les 338 PDF da/no/sv
  // du corpus : aucun spec d'outil réel n'a changé de classement après ancrage.
  it('non-régression : « Virknål 4 mm » (scandinave légitime, avec mesure) reste reconnu comme aiguille après l’ancrage \\b', () => {
    const aig = sec('AIGUILLES', 'aiguilles', ['Virknål 4 mm'])
    const { reference } = extractReference([aig], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).toContain('Virknål 4 mm')
  })
  // 90-s-memories-sweater-fr-9da4d67c (corpus réel, tricot) : dans une section ref='materiel'
  // (« FOURNITURES »), une ligne peut annoncer la TAILLE avant le mot-outil (« 4 mm et
  // 4,5mm aiguilles circulaires ») plutôt qu'après. NEEDLE_RE (mot-outil PUIS taille) et
  // NEEDLE_BARE_RE (mot-outil PUIS chiffre nu) exigent tous deux cet ordre : la ligne
  // n'était captée par aucun des deux et finissait en Matériel au lieu d'Aiguilles.
  it('taille AVANT le mot-outil (« 4 mm et 4,5mm aiguilles circulaires ») est reconnue comme aiguille, pas matériel', () => {
    const materiel = sec('FOURNITURES', 'materiel', ['4 mm et 4,5mm aiguilles circulaires'])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    expect((needleBlock?.p || []).join('\n')).toContain('4 mm et 4,5mm aiguilles circulaires')
    expect((matBlock?.p || []).join('\n')).not.toContain('4 mm et 4,5mm aiguilles circulaires')
  })
  // Garde anti-faux-positif (doit passer avant ET après le correctif) : la nouvelle
  // alternative « taille avant mot-outil » ne doit pas transformer une mesure d'accessoire
  // sans mot-outil (« Anneau en bois 45 mm ») ni un métrage de fil (« 25 g = 210 m de
  // laine », qui n'a pas de « mm ») en aiguille.
  it('garde : « Anneau en bois 45 mm » reste au matériel et « 25 g = 210 m de laine » ne devient pas une aiguille', () => {
    const materiel = sec('FOURNITURES', 'materiel', ['Anneau en bois 45 mm', '25 g = 210 m de laine'])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    const needleText = (needleBlock?.p || []).join('\n')
    expect(needleText).not.toContain('Anneau en bois 45 mm')
    expect(needleText).not.toContain('25 g = 210 m de laine')
    expect((matBlock?.p || []).join('\n')).toContain('Anneau en bois 45 mm')
  })
  // Premier correctif (en revue, mesure sur 3187 PDF) : la version précédente de la voie
  // « taille avant mot-outil » vivait DANS NEEDLE_RE avec une zone médiane non bornée en
  // contenu (`.{0,24}?`, n'importe quel caractère) — elle captait aussi des lignes qui ne
  // sont PAS des spécifications d'aiguilles (cf. les 4 tests « faux positif écarté »
  // ci-dessous). Sortie dans sa propre constante NEEDLE_SIZE_FIRST_RE (NEEDLE_RE redevient
  // bit-identique), ancrée en tête de ligne, zone médiane restreinte à une whitelist.
  // 4 autres cas réels mesurés confirmant que la voie corrigée reste opérante (crochet et
  // tricot, EN/FI) :
  it('taille avant mot-outil : « 3.5mm / US E crochet hook » (grisaille-triangular-lace-shawl-en, corpus réel)', () => {
    const materiel = sec('MATERIALS', 'materiel', ['3.5mm / US E crochet hook'])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).toContain('3.5mm / US E crochet hook')
  })
  it('taille avant mot-outil : « 4 mm, 60 - 100 cm pyöröpuikot », composé finnois soudé (beachcomber-sweater-fi, corpus réel)', () => {
    const materiel = sec('MATERIAALIT', 'materiel', ['4 mm, 60 - 100 cm pyöröpuikot'])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).toContain('4 mm, 60 - 100 cm pyöröpuikot')
  })
  it('taille avant mot-outil : préfixe fermé « Size U.S. N/15 » + calibre (lush-life-crochet-blanket-en, corpus réel)', () => {
    const line = 'Size U.S. N/15 (10 mm) crochet hook or size needed to obtain gauge.'
    const materiel = sec('MATERIALS', 'materiel', [line])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).toContain(line)
  })
  it('taille avant mot-outil : calibre nu sans préfixe « L/8mm crochet hook » (yip-yips-crochet-en, corpus réel)', () => {
    const line = 'L/8mm crochet hook'
    const materiel = sec('MATERIALS', 'materiel', [line])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).toContain(line)
  })
  // Deuxième correctif (en revue, rescan 71 patrons réels) : le premier correctif avait ajouté une
  // whitelist FERMÉE de connecteurs sur la zone médiane, en pensant qu'un mot de sens entre
  // taille et mot-outil signait toujours un faux positif. C'était linguistiquement faux :
  // en anglais l'adjectif PRÉCÈDE le nom (« circular needles »), donc « circular » retombe
  // entre la taille et le mot-outil sur un vrai cas — la whitelist cassait alors TOUS les
  // cas anglais, dont les 3 gains réels du corpus (rescan retombé exactement à la baseline).
  // Règle (c) annulée : seuls l'ancrage en tête de ligne et la garde GAUGE_RE protègent
  // désormais contre les faux positifs (zone médiane redevenue une plage de caractères
  // bornée, hors `;!?` pour ne pas franchir une frontière de phrase).
  // Ligne verbatim COMPLÈTE (172 caractères — la plus longue vraie ligne de fourniture
  // mesurée sur tout le corpus, cf. troisième passe ci-dessous) : sert aussi de preuve que la
  // borne de longueur de la troisième passe (300 caractères) ne mord jamais sur un vrai cas.
  it('taille avant mot-outil : adjectif anglais interposé « circular needles » avec libellé US, ligne complète de 172 caractères (Juice_Sweater_by_Kutovakika__EN_, corpus réel — gain restauré)', () => {
    const line = '4.5 mm / US7: circular needles 80-100 cm / 32-40” for body, 40-60 cm / 16-24” for sleeves or DPNs, or just 80- 100 cm / 32-40” needles if you’re using Magic Loop technique.'
    const materiel = sec('MATERIALS', 'materiel', [line])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).toContain(line)
  })
  it('taille avant mot-outil : adjectif anglais interposé « circular needles », deux tailles reliées par « and » (Pull_ErikEN4, corpus réel — gain restauré)', () => {
    const line = '3,5 mm and 4 mm circular needles, 40, 60 and 80 cm'
    const materiel = sec('MATERIALS', 'materiel', [line])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).toContain(line)
  })
  // Faux positifs mesurés en revue (premier correctif, rescan 3187 PDF) — DOIVENT rester
  // hors du bloc Aiguilles malgré la présence d'un « mm » et d'un mot-outil dans la ligne.
  it('faux positif écarté : mesure d’un accessoire (bouton), pas une aiguille (amelia-colourwork-vest-fr, corpus réel)', () => {
    const line = 'Un reste de fil ou un arrête mailles, un marqueur de maille, 5 boutons (15 mm de diamètre), aiguille à laine'
    const materiel = sec('FOURNITURES', 'materiel', [line])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).not.toContain(line)
  })
  it('faux positif écarté : mesure d’un accessoire (bouton), pas une aiguille (diaphane-top-buttoned-shirt-fr, corpus réel)', () => {
    const line = '1 marqueur de maille, 7 marqueurs de maille amovibles, un reste de fil, 4 boutons 18 mm, aiguille à laine'
    const materiel = sec('FOURNITURES', 'materiel', [line])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).not.toContain(line)
  })
  it('faux positif écarté : ligne d’ÉCHANTILLON (assimile deux grandeurs), pas une aiguille (poppy-children-s-cardigan-nl, corpus réel)', () => {
    const line = 'Stekenverhouding: 25 s en 34-35 n tricotsteek op 3,5 mm naalden = 10 x 10 cm'
    const materiel = sec('MATERIAAL', 'materiel', [line])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).not.toContain(line)
  })
  it('faux positif écarté : ligne d’ÉCHANTILLON (assimile deux grandeurs), pas une aiguille (rosmarino-eyelet-ankle-socks-nl, corpus réel)', () => {
    const line = '30 st & 44 rijen = 10 cm in Trst met 2,5 mm naalden na opspannen'
    const materiel = sec('MATERIAAL', 'materiel', [line])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).not.toContain(line)
  })
  it('faux positif écarté : phrase d’INSTRUCTION (ne commence pas par « avec/met/with »), pas une aiguille (little-elves-nl, corpus réel)', () => {
    const line = 'Zet 8 s op met de 3,25 mm naalden.'
    const materiel = sec('MATERIAAL', 'materiel', [line])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).not.toContain(line)
  })
  // Ancrage (exigence b) — preuve DÉDIÉE, ciblée par la mutation : si la taille n'est pas en
  // tête de ligne mais au milieu d'une phrase, le rapprochement doit échouer même si le reste
  // de la ligne ressemble au cas réel plus haut (« et 4,5mm aiguilles »). Retirer le `^` en
  // tête de NEEDLE_SIZE_FIRST_RE fait échouer CE test précisément (cf. rapport de correction
  // pour la preuve par mutation).
  it('garde ancrage : une taille au milieu d’une phrase ne devient pas une aiguille (pas en tête de ligne)', () => {
    const line = 'Voir aussi 4 mm et 4,5mm aiguilles circulaires en option'
    const materiel = sec('FOURNITURES', 'materiel', [line])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).not.toContain(line)
  })
  // Garde échantillon (exigence d) — preuve DÉDIÉE, ciblée par la mutation : ligne CONSTRUITE
  // (recombinaison de vocabulaire déjà reconnu ailleurs dans le fichier — GAUGE_RE, filet
  // aiguilles — aucun mot inventé) pour isoler le rôle du garde-fou, faute de cas réel du
  // corpus où la taille est en tête de ligne ET la ligne est aussi un échantillon : la taille
  // est en tête, le mot-outil la suit à courte distance (structure identique aux vrais cas
  // ci-dessus), mais la ligne assimile aussi deux grandeurs (mailles + 10 cm) — signature
  // GAUGE_RE. Retirer `!GAUGE_RE.test(t)` de isNeedleLine fait échouer CE test précisément
  // (cf. rapport de correction pour la preuve par mutation).
  it('garde échantillon : une taille en tête de ligne suivie du mot-outil reste hors Aiguilles si la ligne est un échantillon (GAUGE_RE)', () => {
    const line = '3,5 mm naalden, 30 steken = 10 cm'
    const materiel = sec('MATERIAAL', 'materiel', [line])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).not.toContain(line)
  })
  // Troisième correctif (en revue) — garde longueur, preuve DÉDIÉE ciblée par la mutation :
  // GAUGE_RE (deux lookaheads non ancrés `(?=.*A)(?=.*B)`) devenait, via la garde échantillon
  // ci-dessus, atteignable depuis isNeedleLine sur des chaînes arbitrairement longues — un
  // chemin d'appel NEUF vers une complexité quadratique (déjà mesurée : plusieurs secondes
  // sur une ligne de 32-80k caractères, cf. rapport de correction pour le chrono). Chemin
  // atteignable en production via isNeedleSpecForScavenge, qui balaie les intros REFLOWÉES EN
  // UN SEUL PARAGRAPHE. Ligne CONSTRUITE de plus de 300 caractères qui COMMENCERAIT sinon par
  // une taille + mot-outil valide (« 4 mm aiguilles » en tête) : sans la borne
  // NEEDLE_SF_MAX_LEN, elle alimenterait le bloc Aiguilles.
  it('garde longueur : une ligne de plus de 300 caractères ne peut pas alimenter le bloc Aiguilles via la nouvelle voie, même si elle commence par taille + mot-outil', () => {
    const line = '4 mm aiguilles ' + 'et du texte reflowé qui continue tres longtemps sans jamais sarreter '.repeat(5)
    expect(line.length).toBeGreaterThan(300)
    const materiel = sec('FOURNITURES', 'materiel', [line])
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).not.toContain(line)
  })
  // Revue (récupération blocs Fil/Aiguilles) — instrumentation
  // du plafond sur le corpus : 28 lignes perdues sur 12 patrons, TOUTES par ce même motif
  // (`if (needles.length < 6) needles.push(t)` SANS `else`, branche sec.ref==='materiel',
  // voie isNeedleLine). Une 7e ligne d'aiguille valide, une fois le plafond de 6 atteint, ne
  // disparaît nulle part — elle retombe au Matériel (règle « jamais perdre d'info »).
  it("jamais perdre d'info : au plafond des Aiguilles (6, section materiel, voie isNeedleLine) une 7e ligne d'aiguille valide retombe au Matériel plutôt que de disparaître", () => {
    const lignes = [
      'Aiguilles 1 mm', 'Aiguilles 2 mm', 'Aiguilles 3 mm',
      'Aiguilles 4 mm', 'Aiguilles 5 mm', 'Aiguilles 6 mm',
      'Aiguilles 7 mm',
    ]
    const materiel = sec('FOURNITURES', 'materiel', lignes)
    const { reference } = extractReference([materiel], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleText = (blocks.find((b) => /aiguille/i.test(b.h3 || ''))?.p || []).join('\n')
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    expect(needleText).toContain('Aiguilles 6 mm')
    expect(needleText).not.toContain('Aiguilles 7 mm')
    expect(matBlock.p).toContain('Aiguilles 7 mm')
  })
  it('tableau des tailles depuis les mesures « label : vecteur »', () => {
    const { reference } = extractReference([sec('MESURES', 'mesures', ['a. Tour de buste : 102 (112) 122 cm', 'b. Longueur : 50 (51) 53 cm'])], { n: 3 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    expect(tab.blocks[0].sizeTable.rows).toEqual([
      { label: 'a. Tour de buste', values: ['102', '112', '122'] },
      { label: 'b. Longueur', values: ['50', '51', '53'] },
    ])
  })
  // (P0-4, Mia Cardigan English v1.1, corpus réel) — UNE SEULE ligne « mesures »
  // porte DEUX vecteurs de longueur n : le vecteur des numéros de taille (1..11), puis
  // (après « are intended to fit an approximate actual bust circumference of ») le
  // vecteur de mesure (75..150 cm) qui alimente sizeSub. Avant ce correctif,
  // `vecs.find(...)` ne gardait que le PREMIER vecteur et faisait `continue` : le second
  // — la seule vraie mesure de la phrase — disparaissait en silence, avec lui l'unique
  // phrase de sous-tailles du patron (perte de contenu réelle, pas cosmétique).
  it('sizeSub capte le SECOND vecteur d’une ligne « mesures » qui en porte deux (Mia Cardigan, perte P0-4)', () => {
    const line =
      'Sizes 1 (2, 3, 4, 5) (6, 7, 8, 9) 10, 11 are intended to fit an approximate actual bust circumference of 75 (80, 85, 90, 95) (100, 110, 120, 130) 140, 150 cm.'
    const { sizeSub } = extractReference([sec('Sizes', 'mesures', [line])], { n: 11 })
    expect(sizeSub).not.toBeNull()
    expect(sizeSub.values).toEqual(['75', '80', '85', '90', '95', '100', '110', '120', '130', '140', '150'])
  })
  it('balayage global : abréviation courte hors section dédiée', () => {
    const { reference } = extractReference([sec('Notes', null, ['AM = anneau marqueur', 'Cette longue phrase : ne doit pas devenir une abréviation'])], { n: 1 })
    expect(reference.abbr['AM']).toBe('anneau marqueur')
    expect(Object.keys(reference.abbr)).toHaveLength(1)
  })
  // agnes-sweater-en-4f1102bf (retour banc) : le balayage global happait des
  // instructions de TRAVAIL au motif qu'elles contiennent un « = » N'IMPORTE OÙ dans la
  // ligne. « Armscye: Knit until … bind off 6 (8) 10 (12) sts = 54 (54) 54 (54) sts. » :
  // le séparateur capté est le « : », mais le « = » du TOTAL DE MAILLES cochait la garde
  // à distance /=/.test(t) → l'instruction quittait sa section Sleeves pour le glossaire ;
  // « Neck: … = 13 (14) » même mécanisme, ligne coupée en deux (moitié glossaire, moitié
  // puce orpheline). Le « = » doit se situer en ZONE DE CLÉ (adjacent à la clé capturée,
  // marge +2 pour les formes sans espace « k1=knit »), pas à distance dans la définition.
  it('balayage global : « Armscye: … = 54 (54) 54 (54) sts. » (instruction de travail, agnes-sweater-en) n’est pas happée en abréviation', () => {
    const s = sec('SLEEVES', null, [
      'Armscye: Knit until 3 (4) 5 (6) sts before the marker, loosely bind off 6 (8) 10 (12) sts = 54 (54) 54 (54) sts.',
      'Neck: Increase 1 st at the neck (same side as the neckline) on every row 3 times = 13 (14) 15 (16) sts.',
    ], 'sleeve')
    const { reference } = extractReference([s], { n: 4 })
    expect(reference.abbr.Armscye).toBeUndefined()
    expect(reference.abbr.Neck).toBeUndefined()
    expect(s.lines.every((l) => !l.consumed)).toBe(true)
  })
  it('balayage global : « k1 = knit one » hors section dédiée reste une abréviation (le « = » est LE séparateur, en zone de clé)', () => {
    const { reference } = extractReference([sec('Notes', null, ['k1 = knit one', 'k1= knit one'])], { n: 1 })
    expect(reference.abbr.k1).toBe('knit one')
    expect(Object.keys(reference.abbr)).toHaveLength(1)
  })
  it('measure-row ne consomme pas une instruction « Tour de … » sans mesure (pas de perte)', () => {
    // Cas réel : pink-heart-sweater, section MANCHES. « Tour de diminution: » matche
    // le label measure-row mais ne porte AUCUN vecteur → la ligne doit rester dans la
    // section de travail, pas disparaître.
    const s = sec('MANCHES', null, ['Tour de diminution: Tricoter jusqu’à ce qu’il reste 3 mailles avant le marqueur, tricoter 2 mailles ensemble, tricoter tout le tour.'], 'sleeve')
    const { reference } = extractReference([s], { n: 5 })
    expect(s.lines[0].consumed).toBeFalsy()
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab ? tab.blocks.flatMap((b) => b.sizeTable?.rows || []) : []
    expect(rows.find((r) => /diminution/i.test(r.label))).toBeUndefined()
  })
  it('sizes : la ligne allemande à double unité d’âge (bug historique) — compte correct (n=5) mais unité perdue → reste dans le corps', () => {
    // Cas réel (mesuré en test) : « Größe: 18 Monate, (2, 4, 6, 8) Jahre » (deux unités
    // d'âge sur la même ligne). sizeLineTokens résout cette ligne en 5 tokens numériques nus
    // (['18','2','4','6','8'], via le repli tokensOf — la garde anti-fusion de
    // vectorAgeLabelsOf refuse de fondre « 18 Monate, » avec le groupe suivant). n = 5 dans
    // le pipeline réel (n = sizeLabels.length, cf. assemble.js) colle donc au compte — MAIS
    // les mots d'unité (« Monate », « Jahre ») ne sont dans AUCUN token retenu : les perdre
    // du front-matter ET du corps violerait « jamais perdre d'info ». La ligne doit rester
    // verbatim dans le corps, seul endroit où l'unité d'origine reste lisible.
    const s = sec('INTRO', null, ['Größe: 18 Monate, (2, 4, 6, 8) Jahre'], 'pelote')
    extractReference([s], { n: 5 })
    expect(s.lines[0].consumed).toBeFalsy()
  })
  // hazy-whisper-sweater-de-3f672f59 (corpus réel, tricot, palier 6) : le PDF utilise le
  // ẞ CAPITAL moderne (U+1E9E, rendu Google Docs de l'eszett en majuscules — orthographe
  // allemande correcte depuis 2017), PAS « SS ». Le flag /i de LABELS ne case-fold PAS
  // U+1E9E → U+00DF (ß) comme le ferait .toLowerCase() — « MAẞE: … » n'était donc jamais
  // reconnu comme étiquette de mesure. Le correctif classe sur une COPIE normalisée
  // seulement : le libellé ÉMIS dans le tableau de tailles doit garder le glyphe ẞ
  // D'ORIGINE (jamais folder le texte stocké/émis — règle « jamais perdre d'info »).
  it('« MAẞE: … » (ẞ capital moderne) est reconnu comme mesure ET le libellé émis garde le ẞ d’origine (texte stocké non altéré)', () => {
    const s = sec('MATERIAL', null, ['MAẞE: 87 (95) cm'], 'pelote')
    const { reference } = extractReference([s], { n: 2 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const row = tab?.blocks?.[0]?.sizeTable?.rows?.[0]
    expect(row?.label).toBe('MAẞE')
    expect(row?.values).toEqual(['87', '95'])
  })
  it('sizes : une ligne de tailles NUMÉRIQUES sans unité d’âge reste consommée (non-régression)', () => {
    // Garde anti-régression du garde « unité perdue » ci-dessus : une ligne de tailles
    // purement numérique, SANS aucun mot d'unité d'âge, n'a rien à perdre — elle doit
    // rester consommée comme avant (Größen: 104 110 116 122 → tokens numériques, mais
    // hasAgeUnitWord() est faux, donc pas de garde déclenchée).
    const s = sec('INTRO', null, ['Größen: 104 110 116 122'], 'pelote')
    extractReference([s], { n: 4 })
    expect(s.lines[0].consumed).toBe(true)
  })
  it('sizes : une ligne « mot-clé + valeurs » dont le compte ne colle PAS à n n’est pas perdue (pas de correspondance N)', () => {
    // Mécanisme de sécurité générique de reference.js, indépendant du bug d'unité d'âge :
    // si CETTE ligne ne porte pas exactement n tailles (ici une « Größe: » répétée ailleurs
    // dans le document, incohérente avec le n établi par la vraie ligne de tailles), elle ne
    // doit pas disparaître du corps sans que son contenu ait été récupéré nulle part.
    const s = sec('INTRO', null, ['Größe: 6 (12, 18) Monate'], 'pelote')
    extractReference([s], { n: 5 })
    expect(s.lines[0].consumed).toBeFalsy()
  })
  it('sizes : une ligne « mot-clé + valeurs » dont le compte colle exactement à n reste consommée (non-régression)', () => {
    const s = sec('INTRO', null, ['Größe: 6 (12, 18, 24) Monate'], 'pelote')
    extractReference([s], { n: 4 })
    expect(s.lines[0].consumed).toBe(true)
  })
  it('sizes : une ligne « Tailles : XS (S) M (L) XL » (tokens lettrés, aucun vecteur NUMÉRIQUE) reste consommée (non-régression, n>1)', () => {
    // Garde anti-régression : le cas le PLUS courant (en-têtes de tailles lettrées S/M/L…)
    // n'a jamais de vecteur NUMÉRIQUE (findSizeVectors ne matche que des chiffres) — un
    // correctif naïf « ne consomme que si un vecteur numérique de longueur n existe » ferait
    // réapparaître CETTE ligne très fréquente dans le corps à chaque patron lettré.
    const s = sec('INTRO', null, ['Tailles : XS (S) M (L) XL'], 'pelote')
    extractReference([s], { n: 5 })
    expect(s.lines[0].consumed).toBe(true)
  })
  // mammatus-bandana-es-41564957 : le PDF distingue deux jeux de
  // mesures sous un sous-titre SANS chiffre (« Antes/Después de lavar y bloquear: »),
  // chacun suivi de measure-row qui portent déjà leur propre libellé (« Ancho »/« Largo »)
  // — sans qualificatif, les deux jeux produisaient des rangées « Ancho »/« Largo »
  // strictement dupliquées, sans distinction avant/après blocage possible.
  it('measure-row : le qualificatif de groupe « avant/après lavage-blocage » distingue deux rangées de même libellé (mammatus-bandana-es, non-régression)', () => {
    const s = sec('MEDIDAS', 'mesures', [
      'Antes de lavar y bloquear:',
      'Ancho: Aprox. 50 (55) cm',
      'Largo: 27 (30) cm',
      'Después de lavar y bloquear:',
      'Ancho: Aprox. 60 (65) cm',
      'Largo: 33 (36) cm',
    ])
    const { reference } = extractReference([s], { n: 2 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks.flatMap((b) => b.sizeTable?.rows || [])
    expect(rows).toContainEqual({ label: 'Ancho (Antes de lavar y bloquear)', values: ['50', '55'] })
    expect(rows).toContainEqual({ label: 'Largo (Antes de lavar y bloquear)', values: ['27', '30'] })
    expect(rows).toContainEqual({ label: 'Ancho (Después de lavar y bloquear)', values: ['60', '65'] })
    expect(rows).toContainEqual({ label: 'Largo (Después de lavar y bloquear)', values: ['33', '36'] })
  })
  it('measure-row : un sous-titre HORS vocabulaire avant/après blocage n’est jamais attaché comme qualificatif (garde étroite, non-invention)', () => {
    const s = sec('MEDIDAS', 'mesures', [
      'Nota: las medidas son aproximadas',
      'Ancho: 50 (55) cm',
    ])
    const { reference } = extractReference([s], { n: 2 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks.flatMap((b) => b.sizeTable?.rows || [])
    expect(rows).toContainEqual({ label: 'Ancho', values: ['50', '55'] })
  })
  // serenity-sweater-es-f1e18764 : « Circunferencia de pecho de la
  // prenda: 86 » puis, ligne PDF suivante, « [97:106:117:126] cm » — le vecteur est coupé
  // en plein milieu par le retour à la ligne, aucune des deux lignes prises seule ne porte
  // les 5 valeurs attendues.
  it('mesures : libellé + vecteur scindés sur deux lignes PDF sont rejoints (serenity-sweater-es, non-régression)', () => {
    const s = sec('MEDIDAS', 'mesures', [
      'Circunferencia de pecho de la prenda: 86',
      '[97:106:117:126] cm',
    ])
    const { reference } = extractReference([s], { n: 5 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks.flatMap((b) => b.sizeTable?.rows || [])
    expect(rows).toContainEqual({
      label: 'Circunferencia de pecho de la prenda',
      values: ['86', '97', '106', '117', '126'],
    })
  })
  // Garde anti-régression mesurée sur le corpus large (elin-top-es, sweet-as-pie-dress-en,
  // selina-kimono-cardigan-es, pink-heart-sweater…) : une phrase SANS RAPPORT qui précède
  // une ligne DÉJÀ complète (son propre vecteur de longueur n) ne doit jamais lui être
  // fusionnée en tête de libellé — sinon une phrase d'intro polluait une rangée déjà juste.
  it('mesures : une ligne SANS vecteur n’est jamais fusionnée dans la ligne SUIVANTE si celle-ci porte déjà un vecteur complet (garde anti-régression)', () => {
    const s = sec('MEDIDAS', 'mesures', [
      'El top tiene un talle ajustado y se da de sí.',
      'Largo de cintura a sisa: aprox 26 (27, 28, 29, 30) cm',
    ])
    const { reference } = extractReference([s], { n: 5 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks.flatMap((b) => b.sizeTable?.rows || [])
    expect(rows).toContainEqual({
      label: 'Largo de cintura a sisa: aprox',
      values: ['26', '27', '28', '29', '30'],
    })
    expect(rows.find((r) => /talle ajustado/.test(r.label))).toBeUndefined()
  })
  // floral-breeze-dress-es-4340dc10 : notation Hobbii ES « label: (v1),
  // v2, …, vN cm » — 1re valeur parenthésée (convention VEC_GROUP) suivie d'une LISTE à
  // virgules SANS second groupe, forme que findSizeVectors (VEC_RE) ne couvre pas.
  it('mesures : notation « label: (v1), v2, …, vN cm » (liste à virgules sans second groupe) est reconnue (floral-breeze-dress-es, non-régression)', () => {
    const s = sec('MEDIDAS', 'mesures', [
      'Ancho, a través de los cuadrados: (38), 44, 50, 55, 61, 66, 71, 77 cm',
    ])
    const { reference } = extractReference([s], { n: 8 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks.flatMap((b) => b.sizeTable?.rows || [])
    expect(rows).toContainEqual({
      label: 'Ancho, a través de los cuadrados',
      values: ['38', '44', '50', '55', '61', '66', '71', '77'],
    })
  })
  // floral-breeze-dress-es-4340dc10 : une mesure identique pour toutes les tailles, sur un
  // libellé COMPOSÉ (non reconnu par les étiquettes measure-row de labelFor, donc jamais
  // poussée par pushMeasure en amont) — le fallback générique de la branche sec.ref==='mesures'
  // doit la diffuser sur les n colonnes.
  it('mesures : une valeur unique valable pour toutes les tailles, sur un libellé COMPOSÉ, est diffusée sur les n colonnes (floral-breeze-dress-es, non-régression)', () => {
    const s = sec('MEDIDAS', 'mesures', [
      'Longitud de la manga: 22 cm o longitud preferida',
    ])
    const { reference } = extractReference([s], { n: 8 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks.flatMap((b) => b.sizeTable?.rows || [])
    expect(rows).toContainEqual({ label: 'Longitud de la manga', values: Array(8).fill('22') })
  })
  // Même défaut, mais sur un libellé measure-row RECONNU (« Largo »), capté par pushMeasure
  // en amont (pass 1), pas par le fallback de la branche sec.ref==='mesures' ci-dessus.
  it('measure-row : une valeur unique valable pour toutes les tailles, sur un libellé measure-row reconnu, est diffusée (floral-breeze-dress-es « Largo », non-régression)', () => {
    const s = sec('MEDIDAS', null, ['Largo: 66 cm o longitud preferida'], 'pelote')
    const { reference } = extractReference([s], { n: 8 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks.flatMap((b) => b.sizeTable?.rows || [])
    expect(rows).toContainEqual({ label: 'Largo', values: Array(8).fill('66') })
  })
  it('measure-row capte bien une vraie mesure « Tour de … : vecteur » (non-régression)', () => {
    const s = sec('MESURES', null, ['Tour de poitrine: 80 (84) 88 (92) 96 cm'], 'pelote')
    const { reference } = extractReference([s], { n: 5 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks.flatMap((b) => b.sizeTable?.rows || [])
    expect(rows).toContainEqual({ label: 'Tour de poitrine', values: ['80', '84', '88', '92', '96'] })
  })
  it('rangs numérotés « 1: » sans mot-outil (amigurumi) ne sont pas avalés en abréviations', () => {
    // the-sisters : chaque pièce recommence à « 1: » → sans garde, le scan de bloc les avale
    // en glossaire puis le dédoublonnage global fait disparaître les rangs des pièces suivantes.
    const jambe = sec('JAMBE', null, ['1: 6 ms dans un CM (6)', '2: aug x6 (12)', '3: (1 ms, aug) x6 (18)'], 'body')
    const cheveux = sec('CHEVEUX', null, ['1: monter 20 ms', '2: ms tout le tour (20)', '3: fermer'], 'body')
    const { reference } = extractReference([jambe, cheveux], { n: 1 })
    expect(reference.abbr['1']).toBeUndefined()
    expect(jambe.lines[0].consumed).toBeFalsy()
    expect(cheveux.lines[0].consumed).toBeFalsy()
  })
  // Bug 1 (retour banc, laura-sweater-en-6322fc86) — le façonnage d'épaule par
  // rangs raccourcis écrit chaque rang « RS: … »/« WS: … » (côté d'ouvrage en tête de
  // ligne) : sans garde, le scan de bloc (≥3 lignes consécutives « clé: déf ») les avale
  // comme un glossaire, addAbbr ne garde que la première occurrence de chaque clé, et les
  // 13 lignes de façonnage disparaissent avec une fausse section « Abréviations » que le
  // PDF ne contient pas.
  it('marqueurs de côté d’ouvrage « RS: »/« WS: » (façonnage d’épaule, laura-sweater-en) ne sont pas avalés en abréviations', () => {
    const s = sec('SHOULDER SHAPING', null, [
      'RS: work 27 (30, 33) stitches knitwise, turn.',
      'WS: slip 1 stitch, work until 7 stitches remain at shoulder, turn.',
      'RS: slip 1 stitch, work until 3 stitches remain at neck, turn.',
      'WS: slip 1 stitch, work until 15 stitches remain at shoulder, turn.',
      'RS: slip 1 stitch, work until 6 stitches remain at neck, turn.',
    ], 'body')
    const { reference } = extractReference([s], { n: 1 })
    expect(reference.abbr['RS']).toBeUndefined()
    expect(reference.abbr['WS']).toBeUndefined()
    expect(reference.abbrFull).toHaveLength(0)
    expect(s.lines.every((l) => !l.consumed)).toBe(true)
  })
  // Équivalent français constaté sur le corpus web (renee-slipover-fr, hiedra-shawl-wrap-
  // fr…) : END/ENV (endroit/envers), même construction, même risque.
  it('équivalent français « END: »/« ENV: » (endroit/envers, renee-slipover-fr) ne sont pas avalés en abréviations', () => {
    const s = sec('FAÇONNAGE ÉPAULE', null, [
      'END: 1 m end, tricoter au point de riz jusqu’à ce qu’il reste 1 m, 1 m end.',
      'ENV: 1 m env, tricoter au point de riz jusqu’à ce qu’il reste 1 m, 1 m env.',
      'END: rab 3 (3, 4, 4) m et tricoter le reste du rang.',
    ], 'body')
    const { reference } = extractReference([s], { n: 1 })
    expect(reference.abbrFull).toHaveLength(0)
  })
  // Équivalent espagnol/italien constaté sur le corpus web (antanilla-lace-cardigan-es/it,
  // saroyan-it…) : LD/LR (lado derecho/revés, lato diritto/rovescio — même paire de
  // lettres dans les deux langues).
  it('équivalent espagnol/italien « LD: »/« LR: » (lado derecho/revés, lato diritto/rovescio) ne sont pas avalés en abréviations', () => {
    const s = sec('CANESÚ RAGLAN', null, [
      'LD: chiudi 3 m a dir (passa la prima m), lavora secondo lo schema finché non hai 19 m.',
      'LR: lavora seguendo il motivo finché non rimane 1 m, 1 dir.',
      'LD: chiudi 22 m e lavora il resto del giro.',
    ], 'body')
    const { reference } = extractReference([s], { n: 1 })
    expect(reference.abbrFull).toHaveLength(0)
  })
  // Défaut 3 (banc, summer-squares-wrap-cardigan-de-69dc5aed, corpus réel Hobbii) —
  // le carré moyen (« DIE MITTLEREN QUADRATE (MQ) ») numérote ses rangs avec une clé PROPRE
  // AU PATRON (« MQ3 », « MQ4 »…) que ROW_MARKER_KEY_RE/ROW_SIDE_MARKER_KEY_RE ne peuvent
  // pas connaître à l'avance : 5 rangs consécutifs (MQ3-MQ7), chacun une seule longue phrase
  // à virgules (donc jamais rejetée par isNonGlossaryDef, qui exige ≥2 phrases), étaient
  // happés par le scan de bloc comme un faux glossaire. Discriminant retenu : la NATURE de
  // la définition — une marque de répétition « * … répéter/wiederholen » et une forte
  // densité de décomptes de mailles chiffrés (chaque rang réel en porte des dizaines,
  // jamais une vraie entrée de glossaire, même verbeuse à un seul décompte fixe).
  it('rangs à clé propre au patron (« MQ3 »-« MQ7 ») ne sont pas avalés en abréviations (summer-squares-wrap-cardigan-de)', () => {
    const s = sec('DIE MITTLEREN QUADRATE (MQ)', null, [
      'MQ3: Wechsle zu Farbe A, indem du die Km beendest, 4 Lm (zählen als Stb, 1 Lm), Stb in denselben Bg, 2 Lm, V-M in denselben Bg, *1 Lm, V-M in den nächsten Bg (zwischen den Mg von KQ2), 1 Lm, (V-M, 2 Lm, V-M) in den 2-Lm-Eckbogen, ab * noch 2-mal wiederholen, 1 Lm, V-M in den nächsten Bg, 1 Lm, Km in die 3. der 4 Lm, Km in den 1-Lm-Bg, Km in das Stb, Km in den 2-Lm-Bg, zu Farbe C wechseln, indem du die Km beendest.',
      'MQ4: 3 Lm, Stb in denselben Bg, 2 Lm, 2 Stb in denselben Bg, *2 Stb in den 1-Lm-Bg der V-M, den nächsten 1-Lm-Bg üb, Mg in den nächsten 1-Lm-Bg der V-M, den nächsten 1-Lm-Bg üb, 2 Stb in den nächsten 1-Lm-Bg der V-M, (2 Stb, 2 Lm, 2 Stb) in den 2-Lm-Eckbogen, ab * noch 2-mal wiederholen, 2 Stb in den 1-Lm-Bg der V-M, den nächsten 1-Lm-Bg üb, Mg in den nächsten 1-Lm-Bg der V-M, den nächsten 1-Lm-Bg üb, 2 Stb in den nächsten 1-Lm-Bg der V-M, Km in die 3. der 3 Lm, Km ins hMg des nächsten Stb, Km in den 2-Lm-Bg.',
      'MQ5: 3 Lm, Stb in denselben Bg, 2 Lm, 2 Stb in denselben Bg, *2 Stb in den nächsten Bg, Mg in den nächsten Bg (zwischen den Mg von MQ4), Mg in den nächsten Bg, 2 Stb in den nächsten Bg, (2 Stb, 2 Lm, 2 Stb) in den 2-Lm-Eckbogen, ab * noch 2-mal wiederholen, 2 Stb in den nächsten Bg, Mg in den nächsten Bg (zwischen den Mg von MQ4), Mg in den nächsten Bg, 2 Stb in den nächsten Bg, Km in die 3. der 3 Lm, Km ins hMg des nächsten Stb, Km in den 2-Lm-Bg, zu Farbe A wechseln, indem du die Km beendest.',
      'MQ6: 4 Lm (zählen als Stb, 1 Lm), Stb in denselben Bg, 2 Lm, V-M in denselben Bg, *V-M in den nächsten Bg (zwischen den Mg), bis zur nächsten Ecke wiederholen, (V-M, 2 Lm, V-M) in den 2-Lm-Eckbogen, ab * noch 2-mal wiederholen, V-M in den nächsten Bg (zwischen den Mg), bis zur nächsten Ecke wiederholen, Km in die 3. der 4 Lm, Km in den 1-Lm-Bg, das Stb, Km in den 2-Lm-Bg, zu Farbe D wechseln, indem du die Km beendest.',
      'MQ7: 3 Lm, Stb in denselben Bg, 2 Lm, 2 Stb in denselben Bg, *2 Stb in den 1-Lm-Bg der V-M, (Mg in den nächsten 1-Lm-Bg der V-M) noch 4x, 2 Stb in den nächsten 1-Lm-Bg der V-M, (2 Stb, 2 Lm, 2 Stb) in den 2-Lm-Eckbogen, ab * noch 2-mal wiederholen, 2 Stb in den 1-Lm-Bg der V-M, (Mg in den nächsten 1-Lm-Bg der V-M) noch 4x, 2 Stb in den nächsten 1-Lm-Bg der V-M, Km in die 3. der 3 Lm, Km ins hMg des nächsten Stb, Km in den 2-Lm-Bg.',
    ], 'body')
    const { reference } = extractReference([s], { n: 1 })
    expect(reference.abbrFull).toHaveLength(0)
    expect(s.lines.every((l) => !l.consumed)).toBe(true)
  })
  // Non-régression : une VRAIE abréviation longue à un seul décompte fixe (torsades
  // tricot FR, cf. commentaire isNonGlossaryDef l.75-79) ne doit pas être rejetée par ce
  // nouveau discriminant : elle n'a ni marque de répétition « * » ni densité de décomptes
  // (un seul nombre, répété, jamais ≥3 décomptes distincts).
  it('non-régression : une abréviation longue à un seul décompte (torsade) reste captée par le scan de bloc', () => {
    const s = sec('INTRO', null, [
      'Ggt = glisser les 2 m suivantes, une par une, à l’endroit; insérer la pointe de Aig.G dans les 2 m ainsi glissées et les remettre sur Aig.G',
      'AugD = augmentation inclinée à droite',
      'end. = à l’endroit',
    ], 'pelote')
    const { reference } = extractReference([s], { n: 1 })
    expect(reference.abbr['Ggt']).toBe('glisser les 2 m suivantes, une par une, à l’endroit; insérer la pointe de Aig.G dans les 2 m ainsi glissées et les remettre sur Aig.G')
    expect(reference.abbrFull).toHaveLength(3)
  })
  // Non-régression : un marqueur qui n'est PAS en tête de ligne (« Row 1, WS: … ») n'a de
  // toute façon jamais été dans le périmètre du scan de bloc (ABBR_KV_RE exige la clé dès
  // le début de la ligne) — doit continuer à survivre tel quel.
  it('non-régression : un marqueur au milieu de ligne (« Row 1, WS: purl all stitches. ») reste hors du scan de bloc', () => {
    const s = sec('BODY', null, [
      'Row 1, WS: purl all stitches.',
      'Row 2, RS: knit all stitches.',
      'Row 3, WS: purl all stitches.',
    ], 'body')
    const { reference } = extractReference([s], { n: 1 })
    expect(reference.abbrFull).toHaveLength(0)
    expect(s.lines.every((l) => !l.consumed)).toBe(true)
  })
  // Non-régression : un « RS: » isolé (seuil de 3 lignes consécutives non atteint) reste
  // hors du scan de bloc, comme avant ce correctif.
  it('non-régression : un « RS: » isolé (seuil de 3 lignes non atteint) reste hors du scan de bloc', () => {
    const s = sec('BODY', null, [
      'RS: work even until piece measures 10 cm from cast-on edge.',
      'Continue in pattern as established until desired length.',
    ], 'body')
    const { reference } = extractReference([s], { n: 1 })
    expect(reference.abbrFull).toHaveLength(0)
  })
  // Non-régression (le risque explicitement signalé en amont) : dans une VRAIE section
  // dédiée ref==='abbr', « RS: Rechte Seite der Arbeit » reste une entrée de glossaire —
  // le nouveau garde ne s'applique QU'AU scan de bloc (`!sec.ref`), jamais à execAbbrLine
  // (chemin partagé avec les sections dédiées). Constaté sur le corpus web (foretoken-
  // textured-kerchief-de : ABKÜRZUNGEN listant Abn/Zun/re/2Mrezus/M1L/li/Mm an/wdh/RS/abh…).
  it('non-régression : dans une vraie section dédiée « ABKÜRZUNGEN », « RS: Rechte Seite der Arbeit » reste une entrée de glossaire (foretoken-textured-kerchief-de, corpus réel)', () => {
    const abbrSec = sec('ABKÜRZUNGEN', 'abbr', [
      'Abn: Abnahme(n)',
      'Zun: Zunahme(n)',
      're: rechts',
      'li: links',
      'RS: Rechte Seite der Arbeit',
      'abh: abheben',
    ])
    const { reference } = extractReference([abbrSec], { n: 1 })
    expect(reference.abbr['RS']).toBe('Rechte Seite der Arbeit')
  })
  it('boîte « Fournitures » (materiel) : « Échantillon: » nu + jauge → bloc Échantillon, pas bullet matériel', () => {
    // poncho Timeless Twister enfant : la jauge sous une étiquette « Echantillon: » nue,
    // dans une boîte classée ref=materiel, doit rejoindre le bloc gauge (dialecte).
    const { reference } = extractReference([sec('Fournitures', 'materiel', [
      'Crochet 4 mm',
      'Echantillon:',
      '10 x 10 cm = 21 mailles x 13 rangs',
    ])], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const gaugeBlock = blocks.find((b) => /échantillon/i.test(b.h3 || ''))
    expect(gaugeBlock?.p).toContain('10 x 10 cm = 21 mailles x 13 rangs')
  })
  it('G4d : mesure unique en prose sous ref=mesures (n=1) → le titre sert de libellé', () => {
    // phoebe-bag : « 25 cm de large x 8 cm de profondeur » sous le titre « TAILLE ».
    const { reference } = extractReference([sec('TAILLE', 'mesures', ['25 cm de large x 8 cm de profondeur'])], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks.flatMap((b) => b.sizeTable?.rows || [])
    expect(rows).toContainEqual({ label: 'TAILLE', values: ['25 cm de large x 8 cm de profondeur'] })
  })
  it('G4d : repère de diagramme « A » retiré, libellé inline gardé (« A Breedte* 100 cm »)', () => {
    const { reference } = extractReference([sec('Dimensions', 'mesures', ['A Breedte* 100 cm'])], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks.flatMap((b) => b.sizeTable?.rows || [])
    expect(rows).toContainEqual({ label: 'Breedte*', values: ['100 cm'] })
  })
  // Bug réel (retour banc, peacock-shawl-in-kid-silk-en-56e7da11, mesuré le 27/08) : une
  // mesure CARRÉE/RECTANGLE en prose (« Ca. 110 x 110 cm », sans « : ») se scindait à
  // tort sur le « x » — SUBMEASURE_VALUE_RE (groupe libellé paresseux, groupe valeur
  // ancré au dernier nombre+unité de la ligne) s'arrêtait au PREMIER nombre du couple,
  // donnant label="Ca. 110 x" / values=["110 cm"] : le carré 110×110 cm perdait sa
  // moitié gauche. Le groupe valeur reconnaît désormais un second nombre séparé par
  // « x »/« × » avant l'unité, sans toucher le groupe libellé — la paire reste ENTIÈRE
  // dans la valeur.
  it('G4d : mesure carrée « Ca. 110 x 110 cm » n’est plus coupée sur le « x » (peacock-shawl-in-kid-silk-en)', () => {
    const { reference } = extractReference([sec('Measurements', 'mesures', ['Ca. 110 x 110 cm'])], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks.flatMap((b) => b.sizeTable?.rows || [])
    expect(rows).toContainEqual({ label: 'Ca.', values: ['110 x 110 cm'] })
  })
  // Même garde, forme « env. » (déjà tolérée par le groupe valeur AVANT le correctif) :
  // vérifie que l'extension du groupe valeur ne casse pas ce chemin existant quand le
  // second nombre du couple est absent (mesure à un seul nombre).
  it('G4d : « env. 45 cm » (un seul nombre) reste inchangé (non-régression du groupe valeur étendu)', () => {
    const { reference } = extractReference([sec('Longueur', 'mesures', ['Longueur totale env. 45 cm'])], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks.flatMap((b) => b.sizeTable?.rows || [])
    expect(rows).toContainEqual({ label: 'Longueur totale', values: ['env. 45 cm'] })
  })
  // G4e — RÉCIDIVE 3x (Confetti Glass palier 6 « Size: One size », Ydun-hat-de « GRÖSSE » →
  // « Onesize », Scallops-rectangular-placemat-de « GRÖSSE » → « One size ») : une section
  // ref==='mesures' à n===1 dont l'UNIQUE ligne est une déclaration de taille unique SANS
  // AUCUN chiffre ne satisfait jamais la garde `/\d/` de G4d → disparaissait en silence.
  it('G4e : « Onesize » (sans espace, sans chiffre) devient la mesure finale (n=1), pas jetée (ydun-hat-de)', () => {
    const { reference } = extractReference([sec('GRÖSSE', 'mesures', ['Onesize'])], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab ? tab.blocks.flatMap((b) => b.sizeTable?.rows || []) : []
    expect(rows).toContainEqual({ label: 'GRÖSSE', values: ['Onesize'] })
  })
  it('G4e : « One size » (avec espace, sans chiffre) devient la mesure finale (n=1), pas jetée (scallops-rectangular-placemat-de)', () => {
    const { reference } = extractReference([sec('GRÖSSE', 'mesures', ['One size'])], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab ? tab.blocks.flatMap((b) => b.sizeTable?.rows || []) : []
    expect(rows).toContainEqual({ label: 'GRÖSSE', values: ['One size'] })
  })
  it('G4e : vocabulaire multilingue reconnu (« Taille unique », « Einheitsgröße », « Talla única », « Taglia unica »)', () => {
    for (const [title, line] of [
      ['Tailles', 'Taille unique'],
      ['Größe', 'Einheitsgröße'],
      ['Talla', 'Talla única'],
      ['Taglia', 'Taglia unica'],
    ]) {
      const { reference } = extractReference([sec(title, 'mesures', [line])], { n: 1 })
      const tab = reference.tabs.find((t) => t.id === 'tailles')
      const rows = tab ? tab.blocks.flatMap((b) => b.sizeTable?.rows || []) : []
      expect(rows).toContainEqual({ label: title, values: [line] })
    }
  })
  // Non-régression 1 : G4e ne doit PAS relâcher la garde `/\d/` de G4d pour n'importe quelle
  // prose courte SANS vocabulaire reconnu — seul un vocabulaire FERMÉ déclenche le filet.
  it('G4e : une prose courte SANS vocabulaire « taille unique » reste jetée (pas de filet générique sans chiffre)', () => {
    const { reference } = extractReference([sec('Notes', 'mesures', ['Modèle très facile à réaliser'])], { n: 1 })
    expect(reference.tabs.find((t) => t.id === 'tailles')).toBeUndefined()
  })
  // Non-régression 2 : si une AUTRE branche a déjà poussé une vraie mesure pour CETTE
  // section, G4e ne doit pas ajouter de rangée fantôme même si une ligne ultérieure de la
  // MÊME section matche le vocabulaire taille unique (protège les sections mesures réelles).
  it('G4e : ne s’ajoute pas si une mesure numérique a déjà été poussée pour la MÊME section', () => {
    const { reference } = extractReference([sec('MAßE', 'mesures', ['Länge: 45 cm', 'One size'])], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab ? tab.blocks.flatMap((b) => b.sizeTable?.rows || []) : []
    expect(rows).toEqual([{ label: 'Länge', values: ['45 cm'] }])
  })
  it('taille unique : « Taille: … cm » devient la mesure finale (n=1), pas jetée', () => {
    // kawaii-ghost : pour un patron mono-taille, la ligne « Taille: … » porte la seule
    // mesure du patron ; elle était jetée inconditionnellement (routée vers le front-matter).
    const { reference } = extractReference([sec('Dimensions', null, ['Taille: environ 11 x 7 cm'], 'pelote')], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab ? tab.blocks.flatMap((b) => b.sizeTable?.rows || []) : []
    expect(rows).toContainEqual({ label: 'Taille', values: ['environ 11 x 7 cm'] })
  })
  it('« Taille: Unique » (sans chiffre) reste jetée — pas de rangée fantôme', () => {
    const { reference } = extractReference([sec('Dimensions', null, ['Taille: Unique'], 'pelote')], { n: 1 })
    expect(reference.tabs.find((t) => t.id === 'tailles')).toBeUndefined()
  })
  it('balayage global : rejette une déf commençant par un chiffre ou une clé non-lettre (fragment de rang)', () => {
    // venetien-shawl : « mousse = 15 m. » et « (= env. 44 cm). » (fragments de rang mal
    // recollés) devenaient de fausses abréviations et amputaient la section de travail.
    // Fragments ISOLÉS (entre des instructions) → chemin balayage per-ligne, pas le bloc
    // « ≥ 3 kv consécutifs » (qui, lui, signe un vrai glossaire dense).
    const { reference } = extractReference([sec('Châle', null, [
      'Rang 1 : monter 80 m.',
      'mousse = 15 m.',
      'Tricoter en rond.',
      '(= env. 44 cm).',
      'Continuer jusqu’à la fin.',
      'AM = anneau marqueur',
    ], 'body')], { n: 1 })
    expect(reference.abbr['AM']).toBe('anneau marqueur')
    expect(reference.abbr['mousse']).toBeUndefined()
    expect(Object.keys(reference.abbr)).toHaveLength(1)
  })
  it('PT4 : le façonnage par taille (clés = tailles du patron) n’est pas happé en table d’abréviations', () => {
    // Pull torsades ajourées (Phildar, 3 colonnes) : une fois les 3 colonnes démêlées
    // (PT1, lines.js), les lignes de façonnage DOS par taille deviennent CONSÉCUTIVES et
    // ressemblent structurellement à un glossaire (≥3 lignes « clé : déf » courtes). Les
    // clés sont les TAILLES du patron (sizeLabels), pas des abréviations : elles ne
    // doivent ni former une fausse table d'abréviations, ni disparaître (rester en texte
    // de la section de travail).
    const dos = sec('DOS', null, [
      's : 4 x 7 m.',
      'M : 1 x 7 m., 3 x 8 m.',
      'L : 2 x 7 m., 2 x 8 m.',
      'XL : 4 x 8 m.',
      'XXL : 1 x 7 m., 3 x 8 m.',
    ], 'body')
    const { reference } = extractReference([dos], { n: 5, sizeLabels: ['s', 'M', 'L', 'XL', 'XXL'] })
    expect(Object.keys(reference.abbr)).toHaveLength(0)
    expect(dos.lines.every((l) => !l.consumed)).toBe(true)
  })
  it('non-régression PT4 : « m = maille » reste une abréviation même quand la taille « M » existe', () => {
    // Le garde sizeLabels ne doit PAS confondre la vraie abréviation « m » (maille) avec
    // le label de taille « M » (Medium) sous prétexte de comparaison insensible à la casse.
    const { reference } = extractReference(
      [sec('ABRÉVIATIONS', 'abbr', ['m = maille(s)', 'aug = augmentation', 'dim = diminution'])],
      { n: 5, sizeLabels: ['s', 'M', 'L', 'XL', 'XXL'] })
    expect(reference.abbr['m']).toBe('maille(s)')
  })
  it('section aiguilles : un accessoire mesuré en mm (sans mot-outil) va au matériel', () => {
    // babyfryd : anneau en bois 45 mm, yeux 6 mm étaient classés aiguilles à cause du
    // token « mm » nu dans le filet. Le crochet (mot-outil) reste aux aiguilles.
    const { reference } = extractReference([sec('OUTILS', 'aiguilles', [
      'Crochet 2.5 mm',
      'Anneau en bois 45 mm',
      'Yeux de sécurité 6 mm',
    ])], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^matériel$/i.test((b.h3 || '').trim()))
    expect(needleBlock.p).toContain('Crochet 2.5 mm')
    expect(matBlock.p).toContain('Anneau en bois 45 mm')
    expect(matBlock.p).toContain('Yeux de sécurité 6 mm')
    expect(needleBlock.p).not.toContain('Anneau en bois 45 mm')
  })
  // M4 (récupération blocs Fil/Aiguilles) — Gilet manches 3-4
  // Madelaine.pdf (corpus réel, patron trilingue) : le patron ouvre TROIS sections
  // ref='aiguilles' d'une seule ligne chacune, verbatim « n° 3,5 et 4 » / « 3.5 mm & 4 mm »
  // / « nr. 3,5 en 4 » — le TITRE de la section porte déjà AIGUILLES/NEEDLES/NADELS, la
  // ligne ne répète donc pas le mot-outil. Avant ce correctif, ces valeurs nues échouaient
  // le filet mots-outils de la branche 'aiguilles' et finissaient au Matériel (le bloc
  // Aiguilles restait vide malgré une VRAIE section dédiée détectée). Un test par langue.
  it('section aiguilles : valeur nue FR « n° 3,5 et 4 » (sans mot-outil) rejoint les Aiguilles (Gilet manches 3-4 Madelaine, corpus réel trilingue)', () => {
    const aiguilles = sec('AIGUILLES', 'aiguilles', ['n° 3,5 et 4'])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect(needleBlock.p).toContain('n° 3,5 et 4')
  })
  it('section aiguilles : valeur nue EN « 3.5 mm & 4 mm » (sans mot-outil) rejoint les Aiguilles (Gilet manches 3-4 Madelaine, corpus réel trilingue)', () => {
    const aiguilles = sec('NEEDLES', 'aiguilles', ['3.5 mm & 4 mm'])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect(needleBlock.p).toContain('3.5 mm & 4 mm')
  })
  it('section aiguilles : valeur nue NL « nr. 3,5 en 4 » (sans mot-outil) rejoint les Aiguilles (Gilet manches 3-4 Madelaine, corpus réel trilingue)', () => {
    const aiguilles = sec('NADELS', 'aiguilles', ['nr. 3,5 en 4'])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect(needleBlock.p).toContain('nr. 3,5 en 4')
  })
  // Test de garde OBLIGATOIRE : DANS LA MÊME SECTION que les 3 valeurs
  // nues ci-dessus, la garde babyfryd doit rester intacte — « Anneau en bois 45 mm »/
  // « Yeux de sécurité 6 mm » sont des accessoires mesurés en mm (mots hors liste fermée de
  // connecteurs : « Anneau »/« bois »/« Yeux »/« sécurité »), pas des tailles nues.
  it('section aiguilles : les valeurs nues (FR/EN/NL) rejoignent les Aiguilles, les accessoires mesurés en mm restent au Matériel dans la MÊME section (garde babyfryd, Gilet manches 3-4 Madelaine, corpus réel trilingue)', () => {
    const aiguilles = sec('AIGUILLES', 'aiguilles', [
      'n° 3,5 et 4',
      '3.5 mm & 4 mm',
      'nr. 3,5 en 4',
      'Anneau en bois 45 mm',
      'Yeux de sécurité 6 mm',
    ])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    const needleText = (needleBlock?.p || []).join('\n')
    expect(needleText).toContain('n° 3,5 et 4')
    expect(needleText).toContain('3.5 mm & 4 mm')
    expect(needleText).toContain('nr. 3,5 en 4')
    expect(matBlock.p).toContain('Anneau en bois 45 mm')
    expect(matBlock.p).toContain('Yeux de sécurité 6 mm')
    expect(needleText).not.toContain('Anneau en bois 45 mm')
    expect(needleText).not.toContain('Yeux de sécurité 6 mm')
  })
  // Garde DÉDIÉE à l'exigence « au moins un chiffre » : une ligne qui ne
  // porte aucun chiffre n'a rien à faire aux Aiguilles (rien à mesurer). Ligne CONSTRUITE
  // (aucun cas réel du corpus mesuré n'est une section aiguilles réduite à ça) : isole le
  // rôle du garde `!/\d/.test` d'isBareSizeLine, même précédent que la garde échantillon de
  // NEEDLE_SIZE_FIRST_RE ci-dessus (ligne ~255, « ligne CONSTRUITE … pour isoler le rôle du
  // garde-fou »).
  // Revue (récupération blocs Fil/Aiguilles) — fixture
  // corrigée : la version précédente (« et », un connecteur seul) était NON DISCRIMINANTE.
  // Preuve par mutation (garde retirée, `if (!/\d/.test(s)) return false` → `if (false)
  // return false`) : isBareSizeLine('et') reste false même sans la garde, car le connecteur
  // seul échoue de toute façon à `hasUnitOrPrefix` (aucun token mm/US/n°/nr) — la garde
  // chiffre n'est jamais celle qui bloque « et », le test passait donc pour une AUTRE raison
  // et restait vert sous la mutation. « mm » discrimine réellement : sans la garde,
  // isBareSizeLine('mm') vaut true (le seul token « mm » signe hasUnitOrPrefix ET passe
  // allValid) — avec la garde, false. Vérifié empiriquement (mutation ciblée, testé isolément
  // avant restauration).
  it('section aiguilles : une unité seule SANS AUCUN chiffre (« mm ») ne devient pas une aiguille (garde du chiffre exigé, ligne construite)', () => {
    const aiguilles = sec('AIGUILLES', 'aiguilles', ['mm'])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    expect(needleBlock?.p || []).not.toContain('mm')
    expect(matBlock.p).toContain('mm')
  })
  // Non-régression demandée en amont : c'est CE cas réel
  // (scallops-rectangular-placemat-de, corpus réel) qui a motivé l'ancrage `\bn[åa]l\b` des
  // deux côtés — sans lui, « optio-nal » collisionnerait avec le scandinave « nål ». Doit
  // rester vert avant ET après ce correctif (aucune des voies ajoutées ici ne doit rouvrir
  // cette collision).
  it('section aiguilles : « Maschenmarkierer (optional) » reste au matériel (collision de sous-chaîne « optional »/« nål » évitée par l’ancrage, scallops-rectangular-placemat-de, corpus réel)', () => {
    const aiguilles = sec('NADELN', 'aiguilles', ['Maschenmarkierer (optional)'])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    expect(matBlock.p).toContain('Maschenmarkierer (optional)')
    expect(needleBlock?.p || []).not.toContain('Maschenmarkierer (optional)')
  })
  // AJOUT EN REVUE (découvert et mesuré) : le filet mots-outils
  // générique de la branche 'aiguilles' n'avait pas le mot anglais « needle(s) » — présent
  // dans NEEDLE_RE (ligne ~253) mais absent de cette liste ad hoc. NEEDLE_RE ne suffit pas
  // seul ici : il exige une taille APRÈS le mot-outil, or ces deux lignes réelles portent la
  // taille AVANT (« 4.5 mm / US7: circular needles… », « 3.5 mm / US 4: circular needles… »)
  // — NEEDLE_RE ne matche donc pas, et la liste ad hoc était le seul filet de secours,
  // justement incomplet pour l'anglais. Ces deux lignes portent aussi une vraie taille
  // d'outil (« 4.5 mm », « US7 »/« US 4 ») : elles passent donc AUSSI la garde de taille du
  // premier correctif ci-dessous (non affectées par ce correctif, qui ne retire QUE les mentions sans
  // taille).
  it('section aiguilles : mot-outil anglais « needles » (Juice_Sweater_by_Kutovakika, corpus réel, section titrée NEEDLES)', () => {
    const line = '4.5 mm / US7: circular needles 80-100 cm / 32-40” for body, 40-60 cm / 16-24” for sleeves or DPNs, or just 80- 100 cm / 32-40” needles if you’re using Magic Loop technique.'
    const aiguilles = sec('NEEDLES', 'aiguilles', [line])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect(needleBlock.p).toContain(line)
  })
  it('section aiguilles : mot-outil anglais « needles » (Stay_Toasty_Scarf_By_Kutovakika, corpus réel, section titrée NEEDLES)', () => {
    const line = '3.5 mm / US 4: circular needles 60-100 cm / 24- 40” or DPNs.'
    const aiguilles = sec('NEEDLES', 'aiguilles', [line])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect(needleBlock.p).toContain(line)
  })
  it('section aiguilles : « Size 4 mm / US 6 circular needle, 100 cm / 40 inch long. » (mot-outil + vraie taille) rejoint les Aiguilles (corpus réel mesuré, premier correctif)', () => {
    const line = 'Size 4 mm / US 6 circular needle, 100 cm / 40 inch long.'
    const aiguilles = sec('NEEDLES', 'aiguilles', [line])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect(needleBlock.p).toContain(line)
  })
  // Premier correctif (en revue, mesure sur 3187 PDF) : la version initiale de cet ajout
  // ajoutait needle(s)/stickor/pinde/ganchillo/uncinetto/szydełko SANS condition, comme les
  // mots historiques de la liste — mesuré : 73 blocs Aiguilles du corpus web ont changé de
  // CONTENU, dominés par des ACCESSOIRES (aiguille à laine/à broder/à torsades, donc du
  // MATÉRIEL selon la convention déjà en place pour cette branche) et de la PROSE happée par
  // la seule présence du mot. Ces lignes réelles DOIVENT rester au Matériel.
  it('section aiguilles : « Tapestry needle » et « Cable needle » (accessoires à laine, sans taille) restent au Matériel (corpus web réel, premier correctif)', () => {
    const aiguilles = sec('NEEDLES', 'aiguilles', ['Tapestry needle', 'Cable needle'])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    // Assertion sur needleBlock EN PREMIER (forme optionnelle needleBlock?.p) : sous la
    // mutation qui retire la garde de taille, les lignes partent aux Aiguilles et
    // matBlock devient undefined — matBlock.p planterait avant que l'assertion utile
    // (« pas dans les Aiguilles ») ne s'exécute. needleBlock.p est un tableau à UN SEUL
    // élément (les lignes aiguilles sont pré-jointes par '\n', reader-reference.js ligne
    // ~18 : p: [ref.needles]) — .join('\n') est OBLIGATOIRE ici : deux lignes poussées
    // (« Tapestry needle », « Cable needle ») ne sont PAS deux éléments du tableau, un
    // .toContain brut sur le tableau ne les détecterait jamais (piège vécu en revue).
    const needleText = (needleBlock?.p || []).join('\n')
    expect(needleText).not.toContain('Tapestry needle')
    expect(needleText).not.toContain('Cable needle')
    expect(matBlock.p).toContain('Tapestry needle')
    expect(matBlock.p).toContain('Cable needle')
  })
  // Revue (récupération blocs Fil/Aiguilles) — même motif que
  // ci-dessus mais dans la branche sec.ref==='aiguilles' (`if (needles.length < 6)
  // needles.push(t)` SANS `else`) : 8036-436-striped-woman-s-jumper-fr (corpus réel, patron
  // multilingue) perd « Rund-Stricknadeln: Nr. 5 Seillänge 40 cm » ET « Ferri circolari: 5 mm
  // con cavo da 40 cm » — deux vraies spécifications d'aiguilles jetées sans trace une fois le
  // plafond de 6 atteint. Elles doivent retomber au Matériel.
  it("jamais perdre d'info : au plafond des Aiguilles (6, section aiguilles) une 7e ligne d'aiguille valide retombe au Matériel plutôt que de disparaître", () => {
    const lignes = [
      'Aiguilles 1 mm', 'Aiguilles 2 mm', 'Aiguilles 3 mm',
      'Aiguilles 4 mm', 'Aiguilles 5 mm', 'Aiguilles 6 mm',
      'Aiguilles 7 mm',
    ]
    const aiguilles = sec('AIGUILLES', 'aiguilles', lignes)
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleText = (blocks.find((b) => /aiguille/i.test(b.h3 || ''))?.p || []).join('\n')
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    expect(needleText).toContain('Aiguilles 6 mm')
    expect(needleText).not.toContain('Aiguilles 7 mm')
    expect(matBlock.p).toContain('Aiguilles 7 mm')
  })
  it('section aiguilles : une phrase de PROSE mentionnant « needle » sans taille reste au Matériel, pas avalée par la seule présence du mot (corpus web réel, forme reconstituée — citation tronquée par la revue, premier correctif)', () => {
    const line = 'The needle size is only a guide. If you get too many stitches on 10 cm = 4", change to a larger needle.'
    const aiguilles = sec('NEEDLES', 'aiguilles', [line])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    expect(needleBlock?.p || []).not.toContain(line)
    expect(matBlock.p).toContain(line)
  })
  // Reste du vocabulaire cité : stickor (SV), pinde (DA), ganchillo (ES),
  // uncinetto (IT), szydełko (PL). Vocabulaire NON inventé : les 5 mots existent déjà dans
  // NEEDLE_RE (ligne ~253). Symétrie du premier correctif : une mention SANS taille reste au
  // Matériel (comme « Tapestry needle » ci-dessus) ; une mention AVEC une vraie taille
  // rejoint les Aiguilles. « Uncinetto DROPS n° 3,5 » et « Ganchillos de 3 y 4 mm » sont des
  // lignes réelles mesurées en revue ; stickor/pinde/szydełko sont CONSTRUITES
  // (mot-outil + taille), faute de cas réel du corpus mesuré pour ces langues précises.
  it('section aiguilles : stickor/pinde/ganchillo/uncinetto/szydełko SANS taille restent au Matériel', () => {
    const aiguilles = sec('AIGUILLES', 'aiguilles', [
      'Stickor',
      'Pinde',
      'Ganchillo',
      'Uncinetto',
      'Szydełko',
    ])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    const needleText = (needleBlock?.p || []).join('\n')
    expect(needleText).toBe('')
    expect(matBlock.p).toEqual(['Stickor', 'Pinde', 'Ganchillo', 'Uncinetto', 'Szydełko'])
  })
  it('section aiguilles : stickor/pinde/ganchillo/uncinetto/szydełko AVEC une vraie taille rejoignent les Aiguilles (Ganchillos/Uncinetto = corpus réel mesuré, premier correctif)', () => {
    const aiguilles = sec('AIGUILLES', 'aiguilles', [
      'Stickor 4 mm',
      'Pinde 4 mm',
      'Ganchillos de 3 y 4 mm',
      'Uncinetto DROPS n° 3,5',
      'Szydełko 4 mm',
    ])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const needleText = (needleBlock?.p || []).join('\n')
    expect(needleText).toContain('Stickor 4 mm')
    expect(needleText).toContain('Pinde 4 mm')
    expect(needleText).toContain('Ganchillos de 3 y 4 mm')
    expect(needleText).toContain('Uncinetto DROPS n° 3,5')
    expect(needleText).toContain('Szydełko 4 mm')
  })
  // Premier correctif (en revue, mesure sur 3187 PDF) : isBareSizeLine laissait passer un
  // NUMÉRO D'ARTICLE nu (« 15012 », 2 patrons du corpus web) — uniquement des chiffres, donc
  // « valeur nue » au sens du prédicat initial, sans qu'aucune unité/préfixe de taille ne
  // soit présent nulle part dans la ligne.
  it('section aiguilles : un numéro d’article nu (« 15012 », sans unité ni préfixe de taille) reste au Matériel (corpus web réel, premier correctif)', () => {
    const aiguilles = sec('AIGUILLES', 'aiguilles', ['15012'])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    expect(needleBlock?.p || []).not.toContain('15012')
    expect(matBlock.p).toContain('15012')
  })
  // Non-régression : les cas déjà couverts par les tests plus haut (« n° 3,5 et 4 »,
  // « 3.5 mm & 4 mm », « nr. 3,5 en 4 ») et les cas mesurés depuis en revue restent
  // acceptés — tous portent au moins un « mm »/« n° »/« nr ».
  it('section aiguilles : non-régression — valeurs nues mesurées depuis (« 2,5 et 3,0 mm », « 9 mm », « n° 5,5 et 6,5 », « 5.0 mm and 5.5 mm ») rejoignent toujours les Aiguilles', () => {
    const aiguilles = sec('AIGUILLES', 'aiguilles', [
      '2,5 et 3,0 mm',
      '9 mm',
      'n° 5,5 et 6,5',
      '5.0 mm and 5.5 mm',
    ])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const needleText = (needleBlock?.p || []).join('\n')
    expect(needleText).toContain('2,5 et 3,0 mm')
    expect(needleText).toContain('9 mm')
    expect(needleText).toContain('n° 5,5 et 6,5')
    expect(needleText).toContain('5.0 mm and 5.5 mm')
  })
  // Deuxième correctif (en revue, mesure sur 3187 PDF) : NEEDLE_SF_SIZE_RE cherche une
  // taille N'IMPORTE OÙ dans la ligne, sans lien avec le mot-outil — un ACCESSOIRE mesuré en
  // mm sur la MÊME ligne qu'une aiguille qualifiée (« aiguille à… ») contournait donc la
  // garde babyfryd : « 6 mm safety eyes, tapestry needle » et « Stitch markers 6 mm, darning
  // needle » (corpus web réel) partaient en Aiguilles à cause du « 6 mm » de l'accessoire,
  // alors qu'aucune vraie aiguille de travail n'est présente sur la ligne. Qualificatifs
  // FERMÉS mesurés sur le corpus (Tapestry needle ×11, Darning needle ×6, Yarn needle ×4,
  // Yarn sewing needle, Embroidery needle, wool needle/embroidery needle for sewing, Large
  // darning needle with blunt tip, Cable needle) : tapestry/darning/yarn/wool/embroidery/
  // sewing/cable/blunt.
  it('section aiguilles : un accessoire mesuré en mm SUR LA MÊME LIGNE qu’une aiguille qualifiée (« tapestry »/« darning ») reste au Matériel (corpus web réel, deuxième passe)', () => {
    const aiguilles = sec('AIGUILLES', 'aiguilles', [
      '6 mm safety eyes, tapestry needle',
      'Stitch markers 6 mm, darning needle',
    ])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    const needleText = (needleBlock?.p || []).join('\n')
    expect(needleText).not.toContain('6 mm safety eyes, tapestry needle')
    expect(needleText).not.toContain('Stitch markers 6 mm, darning needle')
    expect(matBlock.p).toContain('6 mm safety eyes, tapestry needle')
    expect(matBlock.p).toContain('Stitch markers 6 mm, darning needle')
  })
  it('section aiguilles : « Large darning needle with blunt tip » (accessoire qualifié, sans taille) reste au Matériel (corpus web réel, deuxième passe, non-régression)', () => {
    const aiguilles = sec('AIGUILLES', 'aiguilles', ['Large darning needle with blunt tip'])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    expect(needleBlock?.p || []).not.toContain('Large darning needle with blunt tip')
    expect(matBlock.p).toContain('Large darning needle with blunt tip')
  })
  // Cas MIXTE (demandé en revue) : la ligne porte AUSSI une vraie aiguille de
  // travail non qualifiée (« circular needle ») — ce n'est que « aucune aiguille non
  // qualifiée sur la ligne » qui doit déclencher l'exclusion, pas la simple présence d'un
  // qualificatif quelque part dans la ligne.
  it('section aiguilles : une ligne mixte (aiguille de travail non qualifiée + aiguille qualifiée) rejoint quand même les Aiguilles', () => {
    const line = '4 mm circular needle and a tapestry needle'
    const aiguilles = sec('AIGUILLES', 'aiguilles', [line])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const needleText = (needleBlock?.p || []).join('\n')
    expect(needleText).toContain(line)
  })
  // Troisième correctif (en revue, mesure sur 3187 PDF) : la fenêtre de 24 caractères en
  // arrière (deuxième passe) SUR-neutralisait — « yarn »/« cable » (et par extension « wool »/
  // « sewing ») sont des noms communs du domaine tricot/crochet, pas des qualificatifs
  // EXCLUSIFS d'accessoire. Le phrasé « fil tenu double », très courant, plaçait « yarn »
  // dans la fenêtre de 24 caractères précédant « needles » sans le qualifier — la ligne
  // perdait à tort son vrai bloc Aiguilles.
  it('section aiguilles : « fil tenu double » (yarn) avant la taille d’aiguille ne neutralise plus la ligne (corpus web réel, troisième passe)', () => {
    const aiguilles = sec('AIGUILLES', 'aiguilles', [
      'Yarn held double, 4mm needles',
      'Yarn doubled, 4.5mm needles',
      'Worked with yarn doubled on 4mm needles',
      'using yarn double and 4mm needles',
    ])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const needleText = (needleBlock?.p || []).join('\n')
    expect(needleText).toContain('Yarn held double, 4mm needles')
    expect(needleText).toContain('Yarn doubled, 4.5mm needles')
    expect(needleText).toContain('Worked with yarn doubled on 4mm needles')
    expect(needleText).toContain('using yarn double and 4mm needles')
  })
  it('section aiguilles : « cable » sans rapport avec le mot-outil (« cable panel ») ne neutralise plus la ligne (corpus web réel, troisième passe)', () => {
    const line = '24 sts cable panel, 4mm needles'
    const aiguilles = sec('AIGUILLES', 'aiguilles', [line])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const needleText = (needleBlock?.p || []).join('\n')
    expect(needleText).toContain(line)
  })
  // Non-régression : le nouveau critère (adjacence IMMÉDIATE, au plus un espace ou un trait
  // d'union entre le qualificatif et le mot-outil) doit encore écarter les 4 cas réels de la
  // deuxième passe — le qualificatif y est TOUJOURS collé directement au mot-outil.
  it('section aiguilles : non-régression deuxième passe — les qualificatifs COLLÉS au mot-outil excluent toujours la ligne (adjacence immédiate, troisième passe)', () => {
    const aiguilles = sec('AIGUILLES', 'aiguilles', [
      '6 mm safety eyes, tapestry needle',
      'Stitch markers 6 mm, darning needle',
      'Large darning needle with blunt tip',
      '1 wool needle/embroidery needle for sewing',
    ])
    const { reference } = extractReference([aiguilles], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    const needleText = (needleBlock?.p || []).join('\n')
    expect(needleText).toBe('')
    expect(matBlock.p).toEqual([
      '6 mm safety eyes, tapestry needle',
      'Stitch markers 6 mm, darning needle',
      'Large darning needle with blunt tip',
      '1 wool needle/embroidery needle for sewing',
    ])
  })
  it("filet global : une section intro reflowée en un seul paragraphe n'est pas avalée entière par le filet aiguilles à cause d'un fragment ressemblant à une spec (Ellie - Summer Top, de)", () => {
    // Ellie : les vraies aiguilles vivent dans une section ref='materiel' (pas 'aiguilles'
    // dédiée) → hasNeedleSec est FAUX (garde A) alors que les aiguilles existent bel et
    // bien ailleurs. Le paragraphe d'intro (reflowLines para:true en amont, simulé ici en
    // une seule ligne déjà fusionnée) mentionne « Nadel 4 mm »/« Nadel 5 mm » au fil de sa
    // prose (5 phrases) : le filet de secours le confondait avec LA ligne aiguilles et
    // avalait tout le paragraphe — l'intro entière disparaissait du patron.
    const materiel = sec('MATERIAL', 'materiel', ['Häkelnadel 4 mm für den Körper', 'Häkelnadel 5 mm für die Kanten'])
    const introText =
      'Das Top geht bis zur Taille und ist eng anliegend. Der Körper wird mit Nadel 4 mm ' +
      'und beide Kanten mit Nadel 5 mm gehäkelt, damit es nicht zu stramm wird.'
    const intro = { title: 'INFORMATION ZUR ANLEITUNG', kind: 'pelote', ref: null, intro: true, lines: [L(introText)] }
    const { reference } = extractReference([materiel, intro], { n: 1 })
    // L'intro doit survivre INTACTE (pas consommée par le filet) : c'est ce texte que
    // consolidateIntro (assemble.js) recopie ensuite dans la section Présentation.
    expect(intro.lines[0].consumed).toBeFalsy()
    // Les vraies aiguilles (section materiel) restent présentes, le paragraphe d'intro
    // n'a pas remplacé/pollué le bloc Aiguilles.
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const needleText = (needleBlock?.p || []).join('\n')
    expect(needleText).toContain('Häkelnadel 4 mm für den Körper')
    expect(needleText).toContain('Häkelnadel 5 mm für die Kanten')
    expect(needleText).not.toContain('Das Top geht')
  })
  it('non-régression : sans AUCUNE section dédiée aiguilles/fil/échantillon nulle part, le filet de secours continue de glaner une ligne aiguilles COURTE et ISOLÉE depuis une section intro', () => {
    // Le garde ajouté pour Ellie (ci-dessus) ne doit pas désarmer le filet de secours
    // légitime : un patron dont la SEULE mention d'aiguilles est une ligne courte, à une
    // seule clause, dans l'intro (aucune section dédiée nulle part) doit toujours la
    // récupérer, comme avant ce correctif.
    const intro = { title: 'INFO', kind: 'pelote', ref: null, intro: true, lines: [L('Crochet 4 mm pour tout le modèle.')] }
    const { reference } = extractReference([intro], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock?.p || []).join('\n')).toContain('Crochet 4 mm pour tout le modèle.')
  })
  it('même garde C sur le filet fil, RENFORCÉE par le mécanisme fragment (M1) : un paragraphe intro multi-phrases mentionnant un fil en passant alimente ## Fil avec SEULEMENT la phrase porteuse', () => {
    // Même classe de bug que le filet aiguilles (garde C partagée) : une intro reflowée en
    // paragraphe qui MENTIONNE un fil (mot-fibre + grammage/métrage) au fil de sa prose ne
    // doit pas être avalée ENTIÈRE par le filet fil de secours — mais désormais (M1), au
    // lieu de disparaître purement et simplement, la PHRASE PORTEUSE seule doit alimenter
    // ## Fil (§2). Test RENFORCÉ (pas affaibli) par rapport à sa version précédente
    // (qui asserte encore aujourd'hui `yarnBlock === undefined`) : le bloc doit désormais
    // EXISTER, ne contenir QUE la phrase porteuse, et ne pas contenir ses voisines.
    // Premier correctif (en revue) — fixture RECHANGÉE : « Verwende dazu … » (impératif
    // allemand « utilise ») est désormais À BON DROIT rejetée par la garde d'instruction
    // (hasActionableVerb, cf. point b du premier correctif ci-dessous) — « verwende » fait partie
    // du vocabulaire fermé DE_VERB_RE. La phrase porteuse ne doit donc plus mener par un
    // verbe d'action ; « Das Projekt braucht … » (aucun verbe de la liste fermée) illustre
    // le même cas sans se heurter à la nouvelle garde.
    const introText =
      'Dieses Top ist superweich und leicht zu tragen. Das Projekt braucht Fil Rainbow ' +
      'Bamboo, 100 g = 250 m für das ganze Projekt. Es passt zu jedem Sommerlook.'
    const intro = { title: 'INFO', kind: 'pelote', ref: null, intro: true, lines: [L(introText)] }
    const { reference } = extractReference([intro], { n: 1 })
    // L'intro n'est pas consommée : le paragraphe reste intact à sa place (le fragment est
    // RECOPIÉ dans le bloc, jamais déplacé) — §2, condition de sûreté du mécanisme.
    expect(intro.lines[0].consumed).toBeFalsy()
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnBlock = blocks.find((b) => /^fil$/i.test((b.h3 || '').trim()))
    const yarnText = (yarnBlock?.p || []).join('\n')
    expect(yarnText).toBe('Das Projekt braucht Fil Rainbow Bamboo, 100 g = 250 m für das ganze Projekt.')
    expect(yarnText).not.toContain('Dieses Top ist superweich')
    expect(yarnText).not.toContain('Es passt zu jedem Sommerlook')
  })
  it('non-régression fil : intro à une seule phrase, ligne fil courte et isolée toujours glanée', () => {
    const intro = { title: 'INFO', kind: 'pelote', ref: null, intro: true, lines: [L('Fil Rainbow Bamboo, 100 g = 250 m pour tout le modèle.')] }
    const { reference } = extractReference([intro], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnBlock = blocks.find((b) => /^fil$/i.test((b.h3 || '').trim()))
    expect((yarnBlock?.p || []).join('\n')).toContain('Fil Rainbow Bamboo, 100 g = 250 m pour tout le modèle.')
  })
  it('même garde C sur le filet échantillon : un paragraphe intro multi-phrases mentionnant une jauge en passant ne pollue pas ## Échantillon', () => {
    const introText =
      'Dieses Top ist toll für den Sommer. Die Maschenprobe beträgt 20 Maschen auf 10 cm ' +
      'mit Nadel 4 mm. Viel Spaß beim Häkeln.'
    const intro = { title: 'INFO', kind: 'pelote', ref: null, intro: true, lines: [L(introText)] }
    const { reference } = extractReference([intro], { n: 1 })
    expect(intro.lines[0].consumed).toBeFalsy()
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const gaugeBlock = blocks.find((b) => /échantillon/i.test(b.h3 || ''))
    expect(gaugeBlock).toBeUndefined()
  })
  it('non-régression échantillon : intro à une seule phrase, ligne jauge courte et isolée toujours glanée', () => {
    const intro = { title: 'INFO', kind: 'pelote', ref: null, intro: true, lines: [L('20 Maschen auf 10 cm mit Nadel 4 mm.')] }
    const { reference } = extractReference([intro], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const gaugeBlock = blocks.find((b) => /échantillon/i.test(b.h3 || ''))
    expect((gaugeBlock?.p || []).join('\n')).toContain('20 Maschen auf 10 cm mit Nadel 4 mm.')
  })
  // M1 (récupération blocs Fil/Aiguilles) — filet de secours par
  // FRAGMENT : au lieu de bloquer purement et simplement (garde C ci-dessus) le filet sur
  // une intro reflowée en paragraphe multi-phrases, extrait UNIQUEMENT la PHRASE PORTEUSE
  // (SENTENCE_SPLIT_RE) et la recopie en réserve, fusionnée dans needles/yarns en toute
  // fin d'extractReference SEULEMENT si le champ est resté vide. Le paragraphe n'est
  // JAMAIS consommé (le fragment est une copie, pas un déplacement).
  describe('extractReference — filet de secours par FRAGMENT (M1)', () => {
    it("intro reflowée en paragraphe (fixture Ellie, SANS section matériel dédiée) : le bloc Aiguilles reçoit UNIQUEMENT la phrase porteuse, l'intro n'est pas consommée, les phrases voisines sont absentes", () => {
      const introText =
        'Das Top geht bis zur Taille und ist eng anliegend. Der Körper wird mit Nadel 4 mm ' +
        'und beide Kanten mit Nadel 5 mm gehäkelt, damit es nicht zu stramm wird.'
      const intro = { title: 'INFORMATION ZUR ANLEITUNG', kind: 'pelote', ref: null, intro: true, lines: [L(introText)] }
      const { reference } = extractReference([intro], { n: 1 })
      expect(intro.lines[0].consumed).toBeFalsy()
      const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
      const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
      const needleText = (needleBlock?.p || []).join('\n')
      expect(needleText).toBe('Der Körper wird mit Nadel 4 mm und beide Kanten mit Nadel 5 mm gehäkelt, damit es nicht zu stramm wird.')
      expect(needleText).not.toContain('Das Top geht')
    })
    it('garde échantillon OBLIGATOIRE : une phrase de jauge noyée dans une intro ne doit JAMAIS alimenter le bloc Aiguilles, même si elle mentionne aussi une taille d’aiguille', () => {
      const introText =
        'Dieses Top ist toll für den Sommer. Die Maschenprobe beträgt 20 Maschen auf 10 cm ' +
        'mit Nadel 4 mm. Viel Spaß beim Häkeln.'
      const intro = { title: 'INFO', kind: 'pelote', ref: null, intro: true, lines: [L(introText)] }
      const { reference } = extractReference([intro], { n: 1 })
      expect(intro.lines[0].consumed).toBeFalsy()
      const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
      const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
      expect((needleBlock?.p || []).join('\n')).toBe('')
    })
    it('garde A : une phrase menant par « Avec/With/Mit… » (INSTRUCTION_LEAD_RE) n’est jamais capturée comme fragment', () => {
      const introText = 'Es ist ein schönes Projekt für den Sommer. Mit Nadel 4 mm wird der Körper gehäkelt.'
      const intro = { title: 'INFO', kind: 'pelote', ref: null, intro: true, lines: [L(introText)] }
      const { reference } = extractReference([intro], { n: 1 })
      expect(intro.lines[0].consumed).toBeFalsy()
      const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
      const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
      expect((needleBlock?.p || []).join('\n')).toBe('')
    })
    it('priorité : un fragment glané dans une intro ne prend pas la place d’une vraie ligne aiguilles rencontrée plus loin dans le document (réserve non fusionnée)', () => {
      const introText =
        'Das Top geht bis zur Taille und ist eng anliegend. Der Körper wird mit Nadel 5 mm ' +
        'gehäkelt, damit es nicht zu stramm wird.'
      const intro = { title: 'INFO', kind: 'pelote', ref: null, intro: true, lines: [L(introText)] }
      const shortLine = { title: 'INFO2', kind: 'pelote', ref: null, intro: false, lines: [L('Crochet 4 mm pour tout le modèle.')] }
      const { reference } = extractReference([intro, shortLine], { n: 1 })
      const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
      const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
      const needleText = (needleBlock?.p || []).join('\n')
      expect(needleText).toBe('Crochet 4 mm pour tout le modèle.')
      expect(needleText).not.toContain('Nadel 5 mm')
    })
    it('spécifications multiples : une ligne à 2 phrases portant chacune une taille d’aiguille donne 2 entrées, pas 1', () => {
      const introText = 'Für den Kragen benutze Nadel 3 mm. Für den Körper benutze Nadel 4 mm.'
      const intro = { title: 'INFO', kind: 'pelote', ref: null, intro: true, lines: [L(introText)] }
      const { reference } = extractReference([intro], { n: 1 })
      expect(intro.lines[0].consumed).toBeFalsy()
      const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
      const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
      const needleText = (needleBlock?.p || []).join('\n')
      expect(needleText).toBe('Für den Kragen benutze Nadel 3 mm.\nFür den Körper benutze Nadel 4 mm.')
    })
    // Premier correctif (en revue, mesure sur 3187 PDF) : 3 correctifs après première
    // mesure — a) YARN_RE (isYarnLine), même forme quadratique `(?=.*A)(?=.*B)` que
    // GAUGE_RE, n'était bornée nulle part avant d'être appelée sur une phrase-fragment ;
    // b) la garde A (INSTRUCTION_LEAD_RE) ne protège qu'une phrase qui COMMENCE par
    // « avec/with/mit », pas une consigne à structure verbe-en-tête ; c) un fragment fil
    // SEUL peut être du bruit pur (YARN_RE satisfaite par un couple mot-fibre/mot-métrage
    // SANS quantité chiffrée réelle).
    it('premier correctif, point a : une phrase-fragment de plus de 300 caractères n’est jamais évaluée par isYarnLine (même coût quadratique que GAUGE_RE, mesuré 29 934 ms à 96 000 caractères sans cette borne)', () => {
      // « Wool » + « 100 g » satisferait YARN_RE si évaluée en entier (fibre + grammage) —
      // la longueur (> NEEDLE_SF_MAX_LEN = 300) doit l’écarter AVANT même l’appel à
      // isYarnLine, pour ne jamais exposer YARN_RE (deux lookaheads non ancrés) à une
      // chaîne de cette taille.
      const longSentence = `Wool blend yarn ${'padding word '.repeat(40)}100 g really long filler that keeps going and going`
      expect(longSentence.length).toBeGreaterThan(300)
      const introText = `Petite intro générique. ${longSentence}`
      const intro = { title: 'INFO', kind: 'pelote', ref: null, intro: true, lines: [L(introText)] }
      const { reference } = extractReference([intro], { n: 1 })
      expect(intro.lines[0].consumed).toBeFalsy()
      const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
      const yarnBlock = blocks.find((b) => /^fil$/i.test((b.h3 || '').trim()))
      expect((yarnBlock?.p || []).join('\n')).toBe('')
    })
    it('premier correctif, point b : une consigne à structure verbe-en-tête (« Montez 40 mailles avec les aiguilles 4 mm… ») n’est plus volée par le fragment, même si elle ne mène pas par « avec/with/mit » (hasActionableVerb, actionable-prose.js)', () => {
      const introText = 'Ce patron se travaille en rond. Montez 40 mailles avec les aiguilles 4 mm et tricotez au point mousse.'
      const intro = { title: 'INFO', kind: 'pelote', ref: null, intro: true, lines: [L(introText)] }
      const { reference } = extractReference([intro], { n: 1 })
      expect(intro.lines[0].consumed).toBeFalsy()
      const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
      const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
      expect((needleBlock?.p || []).join('\n')).toBe('')
    })
    it('premier correctif, point b — non-régression (exemples vérifiés en revue) : les phrases SANS verbe d’action de la liste FERMÉE restent captées (vocabulaire non exhaustif, limite assumée ailleurs dans le fichier)', () => {
      const cases = [
        // « travaillé » n'est ni un infinitif FR ancré en tête (FR_INFINITIF_RE) ni un
        // impératif de la liste fermée (FR_IMPERATIF_RE).
        'Ce châle est travaillé avec un crochet de 3 mm en rangs, en aller retour sur la largeur.',
        // « utilisez » n'est pas dans FR_IMPERATIF_RE (liste fermée mesurée sur le corpus,
        // limite assumée documentée dans actionable-prose.js).
        'Si vous utilisez le fil doublé, utilisez un crochet 3,75 mm.',
        // « use »/« recommends » ne sont pas dans EN_VERB_RE.
        'I used worsted weight yarn which recommends a 5.5mm hook, so I use 5mm.',
      ]
      for (const carrying of cases) {
        const introText = `Petite intro générique. ${carrying}`
        const intro = { title: 'INFO', kind: 'pelote', ref: null, intro: true, lines: [L(introText)] }
        const { reference } = extractReference([intro], { n: 1 })
        const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
        const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
        expect((needleBlock?.p || []).join('\n')).toBe(carrying)
      }
    })
    it("premier correctif, point c : un fragment fil doit porter un CHIFFRE — « yarn »/« yardage » sans quantité (cool-90-s-s-overlay-mosaic-crochet-panel-en, corpus réel) n'alimente pas ## Fil", () => {
      const introText =
        'Cette pièce est prévue pour un débutant. This does take extra yarn, so the yardage ' +
        'estimates listed in this pattern would not be enough.'
      const intro = { title: 'INFO', kind: 'pelote', ref: null, intro: true, lines: [L(introText)] }
      const { reference } = extractReference([intro], { n: 1 })
      expect(intro.lines[0].consumed).toBeFalsy()
      const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
      const yarnBlock = blocks.find((b) => /^fil$/i.test((b.h3 || '').trim()))
      expect((yarnBlock?.p || []).join('\n')).toBe('')
    })
    it('premier correctif, point c — non-régression : un fragment fil qui porte un chiffre reste capté (le test « bloc Fil = phrase porteuse » ci-dessus le vérifie déjà avec « 100 g = 250 m »)', () => {
      const introText = 'Ce modèle utilise très peu de fil. Il faut environ 50 g de laine mérinos pour ce projet. Bon tricot !'
      const intro = { title: 'INFO', kind: 'pelote', ref: null, intro: true, lines: [L(introText)] }
      const { reference } = extractReference([intro], { n: 1 })
      const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
      const yarnBlock = blocks.find((b) => /^fil$/i.test((b.h3 || '').trim()))
      expect((yarnBlock?.p || []).join('\n')).toBe('Il faut environ 50 g de laine mérinos pour ce projet.')
    })
  })
})

// Palier 8/8 (Rigmor - Jumper, rigmor-jumper-en-c890d246) : YARN_RE/isYarnLine ne
// reconnaissaient QUE le vocabulaire fibre naturel/classique (fil/laine/yarn/coton/
// cotton/mohair/alpaga/alpaca/wool/mérinos/garn/merino) — aucun mot-fibre SYNTHÉTIQUE
// (acrylic/acrylique/acrílico/Acryl, polyester/poliéster). Conséquence mesurée : dans un
// patron SANS section {yarn} dédiée détectée (repli scavenge depuis une section
// materiel générique, sec.ref==='materiel'), la ligne de composition — pourtant complète
// (fibre + grammage/métrage) — restait une puce Matériel au lieu de rejoindre Fil.
// Vocabulaire ajouté mesuré sur le corpus réel (pas inventé), voir commentaire par test.
describe('extractReference — vocabulaire fibre synthétique (## Fil {yarn})', () => {
  it('anglais « Acrylic »/« Polyester » (ligne réelle verbatim, rigmor-jumper-en-c890d246) rejoint Fil, pas Matériel', () => {
    const line = '98% Acrylic, 2% Polyester/ 100 g = 462 meters'
    const { reference } = extractReference([sec('MATERIALS', 'materiel', [line])], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnBlock = blocks.find((b) => b.h3 === 'Fil')
    const matBlock = blocks.find((b) => b.h3 === 'Matériel')
    expect((yarnBlock?.p || []).join('\n')).toContain(line)
    expect(matBlock?.p || []).not.toContain(line)
  })
  it('français « Acrylique »/« Polyester » (lignes réelles verbatim, hygge-blanket-fr + aurora-headband-fr) rejoignent Fil', () => {
    const l1 = 'Mega Ball Aran, Hobbii — 100% Acrylique — 400 g = 700 m'
    const l2 = 'Glitter Deluxe, 30 g, Go Handmade — 100% Polyester — 30 g = 1800-2100 m — 1 pelote Gold (18121)'
    const { reference } = extractReference([sec('MATÉRIEL', 'materiel', [l1, l2])], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnText = (blocks.find((b) => b.h3 === 'Fil')?.p || []).join('\n')
    expect(yarnText).toContain(l1)
    expect(yarnText).toContain(l2)
  })
  // serenity-sweater-es-f1e18764 : « 51% lana, 49% acrílico » (composition) et « 100 g =
  // 350 m » (grammage) sont 2 lignes ADJACENTES du bloc fil dans le PDF source ;
  // recombinées ici sur UNE ligne pour isoler isYarnLine (testée ligne par ligne). « lana »
  // (laine espagnole) n'est pas dans YARN_RE — seul l'ajout d'« acrílico » doit suffire.
  it('espagnol « acrílico » isolé (sans autre mot-fibre déjà couvert) rejoint Fil — vocabulaire réel recombiné', () => {
    const line = '51% lana, 49% acrílico, 100 g = 350 m'
    const { reference } = extractReference([sec('MATERIALES', 'materiel', [line])], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnText = (blocks.find((b) => b.h3 === 'Fil')?.p || []).join('\n')
    expect(yarnText).toContain(line)
  })
  // martha-blouse-with-lace-pattern-de-7ccae5a1 : « 40% Acryl, 30% Alpaka/ 30% Polyamid »
  // et « 25 g = 225 Meter » sont 2 lignes adjacentes, recombinées pour isoler isYarnLine.
  // « Alpaka » (orthographe allemande) n'est pas couvert non plus (hors périmètre de ce
  // correctif) — seul l'ajout d'« Acryl » doit suffire à faire matcher la ligne.
  it('allemand « Acryl » isolé rejoint Fil — vocabulaire réel recombiné (martha-blouse-with-lace-pattern-de)', () => {
    const line = '40% Acryl, 30% Alpaka/ 30% Polyamid, 25 g = 225 Meter'
    const { reference } = extractReference([sec('MATERIAL', 'materiel', [line])], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnText = (blocks.find((b) => b.h3 === 'Fil')?.p || []).join('\n')
    expect(yarnText).toContain(line)
  })
  // Non-régression 1 : le vocabulaire fibre CLASSIQUE déjà couvert (« coton ») continue de
  // matcher après l'élargissement — ligne réelle verbatim aurora-headband-fr.
  it('non-régression : vocabulaire fibre classique déjà couvert (« coton », ligne réelle aurora-headband-fr) matche toujours', () => {
    const line = 'Friends Cotton 8/4, Hobbii — 100% coton — 50 g = 160 m'
    const { reference } = extractReference([sec('MATÉRIEL', 'materiel', [line])], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnText = (blocks.find((b) => b.h3 === 'Fil')?.p || []).join('\n')
    expect(yarnText).toContain(line)
  })
  // Non-régression 2 : garde-fou frontière de mot — un composé allemand qui COMMENCE par
  // « Acryl » mais désigne un autre matériau (peinture acrylique, terme plausible pour
  // peindre des yeux d'amigurumi — pas tiré du corpus, construit pour la frontière de
  // mot) ne doit pas matcher \bacryl\b : « Acrylfarbe » n'a pas de coupure après « Acryl ».
  // La ligne porte quand même une quantité valide (« 20 g ») pour prouver que c'est bien
  // le mot-fibre, et non la quantité, qui bloque le faux positif.
  it('garde de frontière de mot : « Acrylfarbe » (composé, pas un fil) ne déclenche pas isYarnLine à tort', () => {
    const line = 'Acrylfarbe zum Bemalen der Augen, 20 g'
    const { reference } = extractReference([sec('MATERIAL', 'materiel', [line])], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnText = (blocks.find((b) => b.h3 === 'Fil')?.p || []).join('\n')
    const matText = (blocks.find((b) => b.h3 === 'Matériel')?.p || []).join('\n')
    expect(yarnText).not.toContain('Acrylfarbe')
    expect(matText).toContain(line)
  })
})

// (récupération blocs Fil/Aiguilles) — Harlow_Sweater_FR.pdf (corpus
// réel) : un sous-titre NU (« Laine », « Aiguilles suggérées »), sans « : », bold=false,
// jamais détecté comme titre de section par segment.js ni comme étiquette par labelFor
// (qui exige un « : »), introduit ses valeurs sur les lignes SUIVANTES. Avant M2 : aucun
// des deux n'est reconnu, tout finit dans le bloc Échantillon (section ref='echantillon'
// sur-étendue par un défaut de détection hors périmètre ici).
describe("extractReference — M2 : libellé NU ouvrant un bloc de champ (## Fil / ## Aiguilles, spec §3.2/§3.3)", () => {
  // Extrait EXACT des 11 premières lignes de la section ref='echantillon' + les 2 lignes
  // suivantes (« Mercerie », « 2 marqueurs… ») qui prouvent la fermeture du bloc — recopié
  // verbatim, jamais reformulé.
  it('fixture Harlow_Sweater_FR (verbatim) : « Laine »/« Aiguilles suggérées » nus ouvrent Fil/Aiguilles ; l’Échantillon garde sa ligne ; le bloc se referme sur « Mercerie » (pas de fuite du glossaire)', () => {
    const lignes = [
      '19 m par 28 rangs = 10 x 10 cm sur aiguilles de 4,5 mm, après lavage et blocage.',
      'Laine',
      'Environ 300, (325), 350, (400), 450, (500), 500, (550), 550 g de BC Garn “Semilla',
      'Pura”, 100 g = 350 m, ici en coloris 03 et 125, (125), 150, (150), 175, (175), 175, (200), 200 g de Kremke Soul Wool “Silky',
      "Kid”, 25 g = 210 m. Ici en coloris “06_064”. Vous tiendrez les deux fils ensemble tout au long de l'ouvrage.",
      'Aiguilles suggérées',
      "Aiguilles circulaires de 4,5 mm de 80 cm de long pour le corps et de 40 cm de long ou aiguilles doubles pointes pour les maches, ou grosseur nécessaire pour obtenir l'échantillon correct, +",
      'Aiguilles circulaires de 3,5 mm de 25 - 40 cm de long pour le col et / ou aiguilles doubles pointes pour les poignets +',
      'Aiguilles circulaires de 5 mm ou aiguilles doubles pointes.',
      'Mercerie',
      '2 marqueurs, 2 marqueurs amovibles, aiguille à laine.',
    ]
    const echantillon = sec('ÉCHANTILLON', 'echantillon', lignes, 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    const yarnText = (blocks.find((b) => b.h3 === 'Fil')?.p || []).join('\n')
    const needleText = (blocks.find((b) => /aiguille/i.test(b.h3 || ''))?.p || []).join('\n')
    const matBlock = blocks.find((b) => b.h3 === 'Matériel')

    // L'échantillon n'a JAMAIS perdu sa propre ligne.
    expect(gaugeText).toContain('19 m par 28 rangs = 10 x 10 cm sur aiguilles de 4,5 mm, après lavage et blocage.')

    // Le bloc Fil reçoit les 3 lignes de laine, verbatim.
    expect(yarnText).toContain('Environ 300, (325), 350, (400), 450, (500), 500, (550), 550 g de BC Garn “Semilla')
    expect(yarnText).toContain('Pura”, 100 g = 350 m, ici en coloris 03 et 125, (125), 150, (150), 175, (175), 175, (200), 200 g de Kremke Soul Wool “Silky')
    expect(yarnText).toContain("Kid”, 25 g = 210 m. Ici en coloris “06_064”. Vous tiendrez les deux fils ensemble tout au long de l'ouvrage.")

    // Le bloc Aiguilles reçoit les 3 lignes d'aiguilles, verbatim.
    expect(needleText).toContain("Aiguilles circulaires de 4,5 mm de 80 cm de long pour le corps et de 40 cm de long ou aiguilles doubles pointes pour les maches, ou grosseur nécessaire pour obtenir l'échantillon correct, +")
    expect(needleText).toContain('Aiguilles circulaires de 3,5 mm de 25 - 40 cm de long pour le col et / ou aiguilles doubles pointes pour les poignets +')
    expect(needleText).toContain('Aiguilles circulaires de 5 mm ou aiguilles doubles pointes.')

    // Fermeture PAR CONTENU (cœur du mécanisme) : « Mercerie » et la ligne de mercerie qui
    // suit ne sont PAS aspirées dans Aiguilles.
    expect(needleText).not.toContain('Mercerie')
    expect(needleText).not.toContain('2 marqueurs, 2 marqueurs amovibles, aiguille à laine.')
    // (aide-mémoire sous-titres et faux titres) — « Mercerie » n'est
    // PLUS un simple sous-titre inconnu qui retombe dans le fallback Échantillon (état
    // précédent, ci-dessus, avant l'extension de bareLabelFor à `materials`) : il ouvre
    // désormais son propre bloc Matériel, verbatim en tête, comme Fil/Aiguilles.
    expect(gaugeText).not.toContain('Mercerie')
    expect(gaugeText).not.toContain('2 marqueurs, 2 marqueurs amovibles, aiguille à laine.')
    expect(matBlock.p).toEqual(['Mercerie', '2 marqueurs, 2 marqueurs amovibles, aiguille à laine.'])

    // Point b (premier correctif) : « Laine » et « Aiguilles suggérées » sont chacune suivies de
    // vraies valeurs → consommées comme AVANT ce correctif, elles ne fuient pas dans le
    // repli Échantillon.
    expect(gaugeText).not.toContain('Laine')
    expect(gaugeText).not.toContain('Aiguilles suggérées')

    // Décision produit (25/07) : le libellé d'origine est conservé EN TÊTE du bloc,
    // verbatim — « Aiguilles suggérées » porte une nuance (substituable) que le titre
    // réservé « Aiguilles » ne dit pas. Le bloc Fil commence par « Laine » puis ses 3
    // lignes de laine DANS L'ORDRE ; le bloc Aiguilles commence par « Aiguilles suggérées »
    // puis ses 3 lignes, dans l'ordre.
    expect(yarnText.split('\n')).toEqual([
      'Laine',
      'Environ 300, (325), 350, (400), 450, (500), 500, (550), 550 g de BC Garn “Semilla',
      'Pura”, 100 g = 350 m, ici en coloris 03 et 125, (125), 150, (150), 175, (175), 175, (200), 200 g de Kremke Soul Wool “Silky',
      "Kid”, 25 g = 210 m. Ici en coloris “06_064”. Vous tiendrez les deux fils ensemble tout au long de l'ouvrage.",
    ])
    expect(needleText.split('\n')).toEqual([
      'Aiguilles suggérées',
      "Aiguilles circulaires de 4,5 mm de 80 cm de long pour le corps et de 40 cm de long ou aiguilles doubles pointes pour les maches, ou grosseur nécessaire pour obtenir l'échantillon correct, +",
      'Aiguilles circulaires de 3,5 mm de 25 - 40 cm de long pour le col et / ou aiguilles doubles pointes pour les poignets +',
      'Aiguilles circulaires de 5 mm ou aiguilles doubles pointes.',
    ])
  })

  it('titre qualifié isolé : « Aiguilles suggérées » (mot-clé + qualificatif LABEL_QUALIFIER_RE) ouvre le bloc Aiguilles', () => {
    // ref='echantillon' plutôt que ref=null : dans une section ref='echantillon', le
    // filet global (isNonWorkSection, garde A/B/C) ne peut JAMAIS s'exécuter — le routage
    // verbatim `if (sec.ref === 'echantillon') { gaugeLines.push(t); continue }` intercepte
    // toute ligne non consommée AVANT lui. Seul M2 peut donc faire migrer cette ligne vers
    // Aiguilles : test discriminant (sans le qualificatif reconnu, les 2 lignes restent
    // dans l'Échantillon).
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Aiguilles suggérées', 'Aiguilles circulaires 4 mm'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleText = (blocks.find((b) => /aiguille/i.test(b.h3 || ''))?.p || []).join('\n')
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    expect(needleText).toContain('Aiguilles circulaires 4 mm')
    expect(gaugeText).not.toContain('Aiguilles circulaires 4 mm')
  })

  it('libellé seul + valeur : « AIGUILLES » ⏎ « n° 3,5 et 4 » (valeur nue sans mot-outil, M4/isBareSizeLine) rejoint Aiguilles', () => {
    // Motif Gilet manches 3-4 Madelaine (déjà géré pour sec.ref==='aiguilles' via M4) :
    // le TITRE porte déjà le mot-outil, la valeur elle-même ne le répète pas.
    // isNeedleSpecForScavenge seule échoue ici (aucun mot-outil dans « n° 3,5 et 4 ») — le
    // filet global (isNonWorkSection) ne captera donc jamais cette ligne : seul le repli
    // isBareSizeLine du bloc nu M2 le permet. Test discriminant de cette brique précise.
    const s = sec('DIVERS', null, ['AIGUILLES', 'n° 3,5 et 4'])
    const { reference } = extractReference([s], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleText = (blocks.find((b) => /aiguille/i.test(b.h3 || ''))?.p || []).join('\n')
    expect(needleText).toContain('n° 3,5 et 4')
  })

  it('garde : un libellé nu suivi d’une ligne qui n’est PAS une spec du champ ne capture rien (fermeture immédiate)', () => {
    const s = sec('PRÉSENTATION', null, ['Laine', 'Le pull se tricote de haut en bas.'])
    const { reference } = extractReference([s], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnBlock = blocks.find((b) => b.h3 === 'Fil')
    expect(yarnBlock).toBeUndefined()
  })

  it("garde B : une section dédiée ref='fil' déjà présente empêche un libellé nu « Laine » ailleurs de doubler le bloc Fil", () => {
    const fil = sec('FIL', 'fil', ['Fil Fibrany 100% laine, 50 g = 100 m'])
    const ailleurs = sec('AILLEURS', null, ['Laine', 'Coton bio, 100 g = 200 m'])
    const { reference } = extractReference([fil, ailleurs], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnText = (blocks.find((b) => b.h3 === 'Fil')?.p || []).join('\n')
    expect(yarnText).toContain('Fil Fibrany 100% laine, 50 g = 100 m')
    expect(yarnText).not.toContain('Coton bio, 100 g = 200 m')
  })

  it("non-régression : un bloc `block` déjà ouvert par une étiquette RÉELLE (« Fil: » avec ':', mécanisme préexistant) garde la priorité — M2 n'ouvre jamais un bloc nu par-dessus", () => {
    // Chemin PRÉEXISTANT (avant cet ajout) : « Fil: » (': ' sans valeur) ouvre block='yarn' ;
    // la ligne suivante « Laine » (sans ':') est alors poussée comme VALEUR par le
    // mécanisme existant (`block && !sec.ref`). Sans la garde `!block` sur l'ouverture de
    // bareBlock, « Laine » matcherait bareLabelFor (mot-clé nu reconnu) et ouvrirait à tort
    // un SECOND bloc nu par-dessus — elle serait alors consommée comme LIBELLÉ (jamais
    // poussée) au lieu d'être poussée comme VALEUR : le mot « Laine » disparaîtrait.
    const s = sec('DIVERS', null, ['Fil:', 'Laine'])
    const { reference } = extractReference([s], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnText = (blocks.find((b) => b.h3 === 'Fil')?.p || []).join('\n')
    expect(yarnText).toContain('Laine')
  })

  it("jamais perdre d'info : au plafond du champ (6 aiguilles, cf. push), la ligne EXCÉDENTAIRE n'est pas consommée sans être poussée — elle repart dans le flux normal (fallback échantillon)", () => {
    // Depuis la conservation du libellé en tête de bloc (décision produit du 25/07), le
    // libellé « Aiguilles suggérées » occupe lui-même 1 des 6 places du plafond : seules
    // 5 valeurs (et non 6) rentrent encore avec lui. Frontière décalée d'un cran vs avant
    // ce correctif (6 mm passait, 7 mm débordait).
    const lignes = [
      'Aiguilles suggérées',
      'Aiguilles 1 mm', 'Aiguilles 2 mm', 'Aiguilles 3 mm',
      'Aiguilles 4 mm', 'Aiguilles 5 mm', 'Aiguilles 6 mm',
      'Aiguilles 7 mm',
    ]
    const echantillon = sec('ÉCHANTILLON', 'echantillon', lignes, 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleText = (blocks.find((b) => /aiguille/i.test(b.h3 || ''))?.p || []).join('\n')
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    expect(needleText).toContain('Aiguilles suggérées')
    expect(needleText).toContain('Aiguilles 5 mm')
    expect(needleText).not.toContain('Aiguilles 6 mm')
    expect(gaugeText).toContain('Aiguilles 6 mm')
    expect(gaugeText).toContain('Aiguilles 7 mm')
  })

  // Décision produit (25/07, suite immédiate des travaux) : « oui, il faut conserver le
  // libellé d'origine en tête du bloc » — motivé par Harlow (« Aiguilles suggérées » porte
  // une nuance de substituabilité que le titre réservé « Aiguilles » ne dit pas). Le
  // libellé est poussé verbatim, EN TÊTE, mais SEULEMENT s'il introduit vraiment une
  // valeur (invariant préexistant, point b) : un libellé jamais suivi de valeur reste NON
  // consommé, NON poussé. Ce test couvre la variante « étiquette RÉELLE à deux-points sans
  // valeur » (point 5, « Aiguilles: » seule) — le mécanisme partage le même bareBlock
  // que le libellé nu sans « : » (déjà couvert par le test kodachi-ja plus haut) : même
  // invariant, chemin d'entrée différent (labelFor à valeur vide, pas bareLabelFor).
  it("invariant : « Aiguilles: » (étiquette RÉELLE, valeur vide) jamais suivie d'une vraie valeur n'est ni consommée ni poussée dans Aiguilles", () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Aiguilles:', 'Ce pull se tricote de haut en bas.'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    expect(needleBlock).toBeUndefined()
    expect(gaugeText).toContain('Aiguilles:')
  })

  // Règle (point 4) : « libellé et première valeur forment un tout, poussés ensemble ou pas
  // du tout ». Si le plafond (6 aiguilles) est déjà atteint par le libellé qu'on vient tout
  // juste de pousser, la valeur qui suit ne peut plus rentrer — il faut alors RETIRER le
  // libellé qu'on vient d'ajouter (sinon il resterait affiché sans rien introduire) et
  // refermer le bloc sans rien consommer : ni le libellé ni la valeur ne sont perdus, ils
  // repartent tous les deux dans le flux normal (fallback échantillon). Les 5 aiguilles
  // pré-existantes (étiquettes RÉELLES avec valeur, mécanisme hors périmètre de ce
  // correctif) doivent rester intactes, inchangées par le rollback.
  it("plafond : le libellé tout juste poussé est retiré si la valeur qui suit ne peut plus l'être — rien n'est perdu, les entrées existantes ne bougent pas", () => {
    const lignes = []
    for (let i = 1; i <= 5; i++) lignes.push(`Aiguilles: ${i} mm`)
    lignes.push('Aiguilles suggérées')
    lignes.push('Aiguilles 6 mm')
    const echantillon = sec('ÉCHANTILLON', 'echantillon', lignes, 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleText = (blocks.find((b) => /aiguille/i.test(b.h3 || ''))?.p || []).join('\n')
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    // Le bloc Aiguilles garde EXACTEMENT ses 5 valeurs pré-existantes, sans le libellé.
    for (let i = 1; i <= 5; i++) expect(needleText).toContain(`${i} mm`)
    expect(needleText).not.toContain('Aiguilles suggérées')
    // Le libellé et la valeur qu'il n'a pas pu introduire repartent TOUS LES DEUX dans le
    // flux normal — rien n'est perdu.
    expect(gaugeText).toContain('Aiguilles suggérées')
    expect(gaugeText).toContain('Aiguilles 6 mm')
  })

  // Revue (25/07) — préoccupation que le rapport signalait déjà lui-même : le
  // test de plafond ci-dessus porte sur AIGUILLES, où le rollback n'a qu'à faire un
  // `arr.pop()` (plafond = simple longueur). Côté FIL, `pushYarn` a un DEUXIÈME compteur,
  // `yarnQualityCount` (plafond de qualité à 8, cf. pushYarn), qui doit LUI AUSSI être
  // restauré au rollback — sinon le libellé retiré laisse quand même une place de qualité
  // « consommée » à tort, et une ligne-fil légitime PLUS LOIN dans le document est bloquée
  // sans raison. Scénario de revue : 7 lignes-fil réelles (compteur à 7), un libellé nu
  // « Laine » ouvre le bloc, une valeur qui sature le plafond de qualité au 8e rang
  // (rollback), puis une 9e ligne-fil réelle — qui ne doit être bloquée QUE si le compteur
  // n'a pas été restauré.
  it("plafond de qualité du fil (spec point 4, yarnQualityCount) : le compteur de qualité est restauré au rollback du libellé — une 9e ligne-fil réelle rejoint ensuite le bloc Fil au lieu d'être bloquée à tort", () => {
    const lignes = []
    for (let i = 1; i <= 7; i++) lignes.push(`Laine : Fibre ${i}, 100 g = 200 m`)
    lignes.push('Laine')
    lignes.push('Coton bio, 100 g = 200 m')
    lignes.push('Laine : Fibre 9, 100 g = 200 m')
    const divers = sec('DIVERS', null, lignes)
    const { reference } = extractReference([divers], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnText = (blocks.find((b) => b.h3 === 'Fil')?.p || []).join('\n')
    // Les 7 lignes-fil d'origine restent, le libellé nu et sa valeur (bloquée par le
    // plafond de qualité, 7+1=8) sont retirés — même rollback que le test ci-dessus.
    for (let i = 1; i <= 7; i++) expect(yarnText).toContain(`Fibre ${i}, 100 g = 200 m`)
    expect(yarnText).not.toContain('Laine')
    expect(yarnText).not.toContain('Coton bio, 100 g = 200 m')
    // Le vrai test : le compteur de qualité doit être revenu à 7 (pas resté bloqué à 8) —
    // sinon cette 9e ligne, arrivée par une étiquette RÉELLE (mécanisme hors périmètre,
    // jamais concerné par le rollback lui-même), serait rejetée du bloc Fil à tort.
    expect(yarnText).toContain('Fibre 9, 100 g = 200 m')
  })

  // Revue (récupération blocs Fil/Aiguilles) — troisième site :
  // la passe des étiquettes en ligne (labelFor, une vraie « Laine : … ») marque la ligne
  // `consumed` AVANT même de savoir si pushYarn a accepté la valeur. Une étiquette « Laine :
  // Coton bio 100 g = 200 m » disparaissait donc en silence une fois le plafond de qualité du
  // champ Fil atteint (8 lignes-fil de qualité, cf. pushYarn/yarnQualityCount) — ni dans Fil,
  // ni dans Matériel, ni nulle part. Doit maintenant retomber au Matériel, même mécanisme que
  // bareBlock (~ligne 847).
  it("jamais perdre d'info : au plafond de qualité du champ Fil (8, cf. pushYarn), une étiquette « Laine : … » supplémentaire retombe au Matériel plutôt que de disparaître", () => {
    const lignes = []
    for (let i = 1; i <= 8; i++) lignes.push(`Laine : Fibre ${i}, 100 g = 200 m`)
    lignes.push('Laine : Coton bio, 100 g = 200 m')
    const divers = sec('DIVERS', null, lignes)
    const { reference } = extractReference([divers], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnText = (blocks.find((b) => b.h3 === 'Fil')?.p || []).join('\n')
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    expect(yarnText).toContain('Fibre 8, 100 g = 200 m')
    expect(yarnText).not.toContain('Coton bio, 100 g = 200 m')
    expect(matBlock.p).toContain('Coton bio, 100 g = 200 m')
  })

  // En revue — quatrième site, différent des trois ci-dessus :
  // la branche « 1. Routage verbatim des sections dédiées » (`if (sec.ref === 'fil') {
  // pushYarn(t); continue }`) n'avait AUCUN repli, contrairement à ses sœurs `aiguilles`
  // (`needles.length < 6 ? needles.push(t) : materials.push(t)`, déjà en place depuis le
  // commit 2b7d086) et `materiel`. Une section fil DÉDIÉE (titre réel « FIL »/« YARN », pas
  // le balayage d'étiquettes en ligne des tests ci-dessus) qui dépasse le plafond de qualité
  // (8) perdait ses lignes-fil excédentaires purement et simplement — ni dans Fil, ni dans
  // Matériel, ni nulle part.
  it("jamais perdre d'info : au plafond de qualité du champ Fil (8, section fil DÉDIÉE, pas le balayage d'étiquettes) une 9e ligne-fil retombe au Matériel plutôt que de disparaître", () => {
    const lignes = []
    for (let i = 1; i <= 8; i++) lignes.push(`Fibre ${i}, 100 g = 200 m`)
    lignes.push('Coton bio, 100 g = 200 m')
    const fil = sec('FIL', 'fil', lignes)
    const { reference } = extractReference([fil], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnText = (blocks.find((b) => b.h3 === 'Fil')?.p || []).join('\n')
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    expect(yarnText).toContain('Fibre 8, 100 g = 200 m')
    expect(yarnText).not.toContain('Coton bio, 100 g = 200 m')
    expect(matBlock.p).toContain('Coton bio, 100 g = 200 m')
  })

  it('exclusion échantillon : une ligne reconnue GAUGE_RE ne migre jamais vers Aiguilles, même si isNeedleSpecForScavenge la reconnaît par ailleurs', () => {
    // Ligne verbatim citée dans le commentaire NEEDLE_SIZE_FIRST_RE (corpus mesuré) :
    // assimile 2 grandeurs (« 20 m x 26 rangs », « 10 x 10 cm ») ET mentionne un mot-outil
    // qualifié d'une taille — sans l'exclusion GAUGE_RE dédiée à M2, elle satisferait
    // isNeedleSpecForScavenge et serait avalée par le bloc Aiguilles ouvert par « Aiguilles
    // suggérées » juste au-dessus.
    const line = '20 m x 26 rangs = 10 x 10 cm avec les aiguilles 4 mm'
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Aiguilles suggérées', line], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleText = (blocks.find((b) => /aiguille/i.test(b.h3 || ''))?.p || []).join('\n')
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    expect(needleText).not.toContain(line)
    expect(gaugeText).toContain(line)
  })

  // Premier correctif (en revue, mesure 71 patrons réels) — kodachi-ja-5afa3a73 (corpus
  // web) : le bloc Échantillon perdait la ligne « Needle », consommée comme libellé nu
  // alors qu'aucune ligne suivante n'était routée derrière (ni valeur fil, ni valeur
  // aiguille) — violation de « jamais perdre d'info » (masquer n'est pas perdre, mais
  // supprimer sans rien mettre à la place EST perdre). Reconstruction minimale du symptôme
  // (les lignes exactes du PDF source ne sont pas connues ici, seul le nom du patron et
  // le diagnostic ont été transmis en revue) : un libellé nu suivi d'une ligne qui
  // ne satisfait NI isNeedleSpecForScavenge NI isBareSizeLine.
  it("jamais perdre d'info (kodachi-ja-5afa3a73, corpus réel) : un libellé nu qui ne route AUCUNE ligne derrière lui n'est PAS consommé — il reste visible dans le flux normal", () => {
    const echantillon = sec('GAUGE', 'echantillon', ['Needle', 'Work is completed using a smaller hook size.'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    expect(needleBlock).toBeUndefined()
    expect(gaugeText).toContain('Needle')
  })

  // Premier correctif, point a (en revue) — GAUGE_RE (deux lookaheads non ancrés, coût
  // QUADRATIQUE, cf. isNeedleLine : 314 ms mesurés à 20 000 caractères, 5 053 ms à
  // 80 000) était invoquée SANS la borne NEEDLE_SF_MAX_LEN que porte pourtant tout autre
  // point d'appel du fichier — chemin d'appel neuf, atteignable en production sur une
  // intro reflowée en un seul (très long) paragraphe tant qu'un bloc `needles` nu est
  // ouvert. Preuve FONCTIONNELLE (comme le test « garde longueur » déjà en place pour
  // NEEDLE_SIZE_FIRST_RE) : une ligne CONSTRUITE, signature GAUGE_RE authentique (même
  // préfixe verbatim que le test « exclusion échantillon » ci-dessus) allongée par du
  // texte reflowé au-delà de 300 caractères tout en gardant intact le motif mot-outil +
  // taille (NEEDLE_RE n'est pas borné en longueur, donc baseValid reste vrai). Sans la
  // borne AVANT GAUGE_RE, cette ligne serait EXCLUE (comme sa version courte ci-dessus) ;
  // avec la borne, GAUGE_RE n'est plus évaluée du tout au-delà du seuil — la ligne est
  // acceptée (même compromis, déjà en place ailleurs dans ce fichier pour la voie
  // NEEDLE_SIZE_FIRST_RE : une vraie ligne de fourniture est COURTE).
  it('garde longueur (premier correctif, ReDoS) : GAUGE_RE n’est jamais évaluée sur une continuation Aiguilles de plus de NEEDLE_SF_MAX_LEN caractères', () => {
    const line = '20 m x 26 rangs = 10 x 10 cm avec les aiguilles 4 mm ' +
      'et du texte reflowé qui continue tres longtemps sans jamais sarreter '.repeat(5)
    expect(line.length).toBeGreaterThan(300)
    // sec.lines pousse le texte via L(text), et la boucle appelante teste/pousse
    // `line.text.trim()` — même comportement de trim que le reste du pipeline (vérifié
    // ailleurs dans ce fichier) : la ligne poussée dans le bloc Aiguilles n'a plus l'espace
    // final de trailing accumulé par `.repeat`.
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Aiguilles suggérées', line], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleText = (blocks.find((b) => /aiguille/i.test(b.h3 || ''))?.p || []).join('\n')
    expect(needleText).toContain(line.trim())
  })

  // Premier correctif, point c (en revue) — une étiquette RÉELLE yarn/needles à valeur
  // VIDE (« Laine: ») dans une section ref='echantillon' (le mécanisme `block` classique ne
  // peut pas y jouer la continuation, `block && !sec.ref` exigeant `!sec.ref`) était
  // consommée par le `if (lab) { … }` existant SANS que sa continuation ne rejoigne jamais
  // aucun bloc — perte latente, jamais mesurée sur le corpus mais structurellement
  // identique à la forme « section Échantillon sur-étendue » ciblée ici.
  // Décision en revue : la disparition du préfixe « Laine : » lui-même est ACCEPTÉE
  // (mise en cohérence avec « Fil: »/« Yarn: »/« Garn: », la donnée survit verbatim) —
  // seule la VALEUR compte ici.
  it("« Laine: » (étiquette RÉELLE, valeur vide) dans une section ref='echantillon' route sa continuation par bareBlock, pas par le mécanisme `block` (qui ne peut pas y jouer)", () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Laine:', 'Fibrany 100% laine, 50 g = 100 m'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnText = (blocks.find((b) => b.h3 === 'Fil')?.p || []).join('\n')
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    expect(yarnText).toContain('Fibrany 100% laine, 50 g = 100 m')
    expect(gaugeText).not.toContain('Fibrany 100% laine, 50 g = 100 m')
  })

  it("« Laine: » (valeur vide) dans une section ref='echantillon' n'est PAS consommée si aucune valeur ne suit (point b appliqué au point c)", () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Laine:', 'Ce pull se tricote de haut en bas.'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnBlock = blocks.find((b) => b.h3 === 'Fil')
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    expect(yarnBlock).toBeUndefined()
    expect(gaugeText).toContain('Laine:')
  })

  // Preuve d'atteignabilité (revue : « pas de code mort ») — la clause « : »
  // terminal NU de bareLabelFor n'est JAMAIS atteinte pour un mot-clé nu seul (« Laine: »,
  // cf. point c ci-dessus, intercepté plus tôt par labelFor) mais L'EST pour un libellé
  // QUALIFIÉ + « : » (« Aiguilles suggérées: ») : labelFor ne reconnaît PAS « Aiguilles
  // suggérées » (le mot-clé LABELS est ancré ^…$, la qualificatif casse le match), la ligne
  // atteint donc bareLabelFor, où le « : » terminal est retiré avant le test du
  // qualificatif. Vérifié empiriquement (labelFor("Aiguilles suggérées:") → null) avant
  // d'écrire ce test.
  it('« Aiguilles suggérées: » (libellé qualifié + « : » terminal nu) atteint bareLabelFor et ouvre le bloc Aiguilles', () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Aiguilles suggérées:', 'Aiguilles circulaires 4 mm'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleText = (blocks.find((b) => /aiguille/i.test(b.h3 || ''))?.p || []).join('\n')
    expect(needleText).toContain('Aiguilles circulaires 4 mm')
  })
})

// (aide-mémoire sous-titres et faux titres) — Harlow_Sweater_FR.pdf
// (corpus réel, retour direct d'usage) : dans le bloc Échantillon, le sous-titre nu
// « Abréviations » (bold=false, jamais un titre de section ni une étiquette labelFor,
// même famille que « Laine »/« Aiguilles suggérées » ci-dessus) n'était pas reconnu, si
// bien que le glossaire ET le matériel (« Mercerie ») restaient noyés dans l'Échantillon.
// Étend le mécanisme M2 (bareLabelFor/bareBlock) à deux destinations de PLUS :
// `materials` (fermeture au sous-titre nu suivant ou à un plafond de sécurité, aucun
// prédicat de contenu) et `abbr` (fermeture par le contenu, réutilise execAbbrLine/
// addAbbr). Le champ `tips` (« Conseils ») est désormais couvert (cf.
// describe dédié plus bas) : la ligne « Conseils » et celle qui la suit rejoignent
// leur propre bloc, au lieu de rester noyées dans l'Échantillon.
describe("extractReference — sous-titres nus étendus au Matériel et au glossaire (## Matériel / ## Abréviations)", () => {
  // Extrait VERBATIM (fixture réelle Harlow_Sweater_FR, section
  // ref='echantillon', kind='echantillon', intro=false, toutes lignes bold=false),
  // jamais reformulé. La ligne gauge en tête représente les lignes 1-5 déjà traitées
  // précédemment ; le test démarre directement à la 2e ligne.
  const harlowLignes = [
    '19 m par 28 rangs = 10 x 10 cm sur aiguilles de 4,5 mm, après lavage et blocage.',
    'Mercerie',
    '2 marqueurs, 2 marqueurs amovibles, aiguille à laine.',
    'Abréviations',
    'endroit - endroit du travail',
    'envers - envers du travail',
    'DDT - marqueur du début du tour',
    'm - maille(s)',
    'ggt - glisse, glisse, tricote - diminution à gauche',
    '2 m ens - travaillez 2 mailles ensemble - diminution à droite',
    'A1G - augmentation à gauche',
    "A1D - augmentation à droite g1m fav - glissez 1 m comme à l'envers, fil tenu vers l'avant",
    'MD - maille double : maille tournée sur le rang/tour, qui apparaît double et se travaille comme une maille simple sur le rang/tour suivant.',
    'Conseils',
    'Joindre les fils avec une aiguille à feutrer : Vidéo Relever des mailles sur les bords du tricot : Vidéo Vous trouverez plus de vidéos en support aux techniques sur : www.caidree.com',
  ]

  it('fixture Harlow_Sweater_FR (verbatim) : « Mercerie » ouvre le Matériel, « Abréviations » ouvre le glossaire, « Conseils » ouvre le bloc Conseils (T5)', () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', harlowLignes, 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    const matBlock = blocks.find((b) => b.h3 === 'Matériel')

    // Le bloc Matériel contient « Mercerie » (verbatim, en tête) puis sa ligne de
    // contenu — RIEN d'autre : preuve du point de vigilance n°2 (le glossaire qui suit
    // ne doit surtout pas être aspiré ici).
    expect(matBlock.p).toEqual(['Mercerie', '2 marqueurs, 2 marqueurs amovibles, aiguille à laine.'])

    // Le glossaire contient les 9 entrées de la fixture. NB (empirique, cf. rapport) :
    // ABBR_LINE_RE (essayé EN PREMIER par execAbbrLine, partagé avec la section dédiée
    // ref='abbr' et segment.js, jamais retouché ici) capte, pour la dernière ligne, la
    // clé « MD - maille double » plutôt que « MD » seul — le « : » interne à la ligne
    // (avant le tiret ASCII) est pris comme séparateur clé/déf avant que le tiret ASCII
    // ne soit même essayé. C'est un comportement PRÉEXISTANT du détecteur partagé, hors
    // périmètre ici (le modifier casserait la règle centrale bit-identique et
    // affecterait la mesure sur 3187 PDF) : le test reflète la clé réellement produite.
    expect(reference.abbrFull).toHaveLength(9)
    expect(reference.abbr['endroit']).toBe('endroit du travail')
    expect(reference.abbr['envers']).toBe('envers du travail')
    expect(reference.abbr['DDT']).toBe('marqueur du début du tour')
    expect(reference.abbr['m']).toBe('maille(s)')
    expect(reference.abbr['ggt']).toBe('glisse, glisse, tricote - diminution à gauche')
    expect(reference.abbr['2 m ens']).toBe('travaillez 2 mailles ensemble - diminution à droite')
    expect(reference.abbr['A1G']).toBe('augmentation à gauche')
    expect(reference.abbr['A1D']).toBe("augmentation à droite g1m fav - glissez 1 m comme à l'envers, fil tenu vers l'avant")
    expect(reference.abbr['MD - maille double']).toBe('maille tournée sur le rang/tour, qui apparaît double et se travaille comme une maille simple sur le rang/tour suivant.')

    // Point de vigilance n°2 : aucune des 9 lignes de glossaire ne
    // doit fuiter dans le Matériel — preuve dédiée, pas seulement l'égalité stricte
    // ci-dessus sur matBlock.p (qui le prouve déjà, mais un test séparé, discriminant
    // sur CE risque précis, documente l'intention).
    for (const frag of ['endroit du travail', 'DDT', 'ggt', 'maille double']) {
      expect(matBlock.p.join('\n')).not.toContain(frag)
    }

    // « Conseils » ouvre désormais son propre bloc (T5) : le libellé est IDENTIQUE au
    // titre réservé du bloc (« Conseils ») — un mécanisme dédié (retour terrain) le masque donc (pas
    // de doublon « Conseils » / « Conseils »), le fallback Échantillon ne garde que la
    // ligne gauge d'origine.
    const tipsTab = reference.tabs.find((t) => t.id === 'tips')
    expect(tipsTab.blocks[0].p).toEqual([
      'Joindre les fils avec une aiguille à feutrer : Vidéo Relever des mailles sur les bords du tricot : Vidéo Vous trouverez plus de vidéos en support aux techniques sur : www.caidree.com',
    ])
    expect(gaugeText.split('\n')).toEqual([
      '19 m par 28 rangs = 10 x 10 cm sur aiguilles de 4,5 mm, après lavage et blocage.',
    ])
  })

  it("garde (plafond) : « Mercerie » suivi d'une ligne puis d'une longue suite de prose ne doit pas avaler toute la section — le plafond (MATERIALS_BAREBLOCK_CAP) referme le bloc sans rien perdre", () => {
    const lignes = ['Mercerie', '2 marqueurs, aiguille à laine.']
    // 10 lignes de « section » sans rapport, largement au-dessus du plafond (6).
    for (let i = 1; i <= 10; i++) lignes.push(`Ligne de section sans rapport numéro ${i}.`)
    const echantillon = sec('ÉCHANTILLON', 'echantillon', lignes, 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const matBlock = blocks.find((b) => b.h3 === 'Matériel')
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    // Le Matériel garde EXACTEMENT le libellé + 6 lignes de contenu (le compteur de
    // plafond ne compte QUE les lignes de contenu, pas le libellé lui-même, cf.
    // MATERIALS_BAREBLOCK_CAP = 6 : « 2 marqueurs… » + les 5 premières lignes de
    // section atteignent le plafond, la 6e ligne de section le fait déborder).
    expect(matBlock.p).toEqual([
      'Mercerie',
      '2 marqueurs, aiguille à laine.',
      'Ligne de section sans rapport numéro 1.',
      'Ligne de section sans rapport numéro 2.',
      'Ligne de section sans rapport numéro 3.',
      'Ligne de section sans rapport numéro 4.',
      'Ligne de section sans rapport numéro 5.',
    ])
    // Rien n'est perdu : les lignes excédentaires retombent dans le fallback
    // Échantillon existant, plutôt que de disparaître ou d'être avalées sans fin.
    for (let i = 6; i <= 10; i++) expect(gaugeText).toContain(`Ligne de section sans rapport numéro ${i}.`)
  })

  it("garde : un sous-titre nu « Mercerie » qui n'introduit rien (immédiatement suivi d'un autre sous-titre nu) reste NON consommé", () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Mercerie', 'Abréviations', 'm - maille(s)'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    const matBlock = blocks.find((b) => b.h3 === 'Matériel')
    // « Mercerie » n'a rien introduit (la ligne suivante est elle-même un sous-titre) :
    // aucun bloc Matériel n'est créé, la ligne reste visible dans le fallback.
    expect(matBlock).toBeUndefined()
    expect(gaugeText).toContain('Mercerie')
    // « Abréviations », elle, introduit bien une vraie entrée : consommée normalement.
    expect(reference.abbr['m']).toBe('maille(s)')
    expect(gaugeText).not.toContain('Abréviations')
  })

  it("garde : un sous-titre nu « Abréviations » qui n'introduit rien (ligne suivante sans forme clé/déf) reste NON consommé", () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Abréviations', 'Ceci est une phrase de prose ordinaire.'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    expect(reference.abbrFull).toHaveLength(0)
    expect(gaugeText).toContain('Abréviations')
    expect(gaugeText).toContain('Ceci est une phrase de prose ordinaire.')
  })

  it('garde : le bloc Échantillon reste une destination interdite — un sous-titre nu « Échantillon » (mot-clé gauge) n’ouvre jamais de bloc nu', () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Échantillon', '19 m x 28 r = 10 x 10 cm'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    // Aucun bloc Matériel/Fil/Aiguilles ne doit apparaître : les 2 lignes retombent,
    // verbatim, dans le fallback Échantillon existant (chemin inchangé).
    expect(blocks.find((b) => b.h3 === 'Matériel')).toBeUndefined()
    expect(blocks.find((b) => b.h3 === 'Fil')).toBeUndefined()
    expect(blocks.find((b) => /aiguille/i.test(b.h3 || ''))).toBeUndefined()
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    expect(gaugeText).toContain('Échantillon')
    expect(gaugeText).toContain('19 m x 28 r = 10 x 10 cm')
  })

  // Revue (avant commit) — `materials` n'a AUCUN prédicat de contenu
  // (contrairement à yarn/needles/abbr), donc la garde de section large héritée
  // (`isNonWorkSection` : intro===true OU kind==='pelote') est DANGEREUSE pour ce champ
  // précis : `kind='pelote'` est le repli GÉNÉRIQUE de segment.js pour tout titre non
  // reconnu, y compris un chapitre du corps du patron (« Dos », « Devant »…) sans
  // section ref dédiée. Vérifié empiriquement AVANT ce garde : une section de travail
  // kind='pelote'/ref=null contenant une ligne « Matériel » (sous-titre nu qui matche
  // LABELS materials) avalait les 2 rangs réels qui suivaient dans le bloc Matériel de
  // l'aide-mémoire — perte de contenu du CORPS du patron, la classe de risque que
  // INSTRUCTION_LEAD_RE/hasActionableVerb gardent ailleurs dans ce fichier. Correctif :
  // `materials` est restreint au SEUL `sec.ref === 'echantillon'` (le cas réel Harlow),
  // plus étroit que yarn/needles/abbr, qui eux gardent `isNonWorkSection` (protégés par
  // leur propre prédicat de contenu).
  it("garde (sécurité) : un sous-titre nu « Matériel » dans une VRAIE section de travail (kind='pelote', pas d'échantillon) n'avale PAS les rangs qui suivent", () => {
    const dos = sec('DOS', null, ['Matériel', 'Rang 1 : monter 40 m.', 'Rang 2 : tricoter à l’endroit.'])
    const { reference } = extractReference([dos], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    expect(blocks.find((b) => b.h3 === 'Matériel')).toBeUndefined()
    // Les 3 lignes restent NON consommées : elles restent dans la section DOS, non
    // aspirées ailleurs — aucun bloc Matériel/aide-mémoire n'est créé du tout ici.
    expect(dos.lines.every((l) => !l.consumed)).toBe(true)
  })

  it("garde B (matériel) : un « Mercerie » nu ouvre son bloc même si une section dédiée ref='materiel' existe déjà ailleurs (bucket global, pas de plafond de collision, cf. hasYarnSec/hasNeedleSec inapplicables)", () => {
    const materiel = sec('FOURNITURES', 'materiel', ['Ciseaux, épingles à nourrice'])
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Mercerie', 'Aiguille à laine'], 'echantillon')
    const { reference } = extractReference([materiel, echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const matBlock = blocks.find((b) => b.h3 === 'Matériel')
    expect(matBlock.p).toContain('Ciseaux, épingles à nourrice')
    expect(matBlock.p).toEqual(['Ciseaux, épingles à nourrice', 'Mercerie', 'Aiguille à laine'])
  })

  it("garde B (abbr) : une section dédiée ref='abbr' déjà présente n'empêche pas un « Abréviations » nu ailleurs de compléter le même glossaire (addAbbr dédoublonne par clé, pas de collision)", () => {
    const abbrSec = sec('ABRÉVIATIONS', 'abbr', ['end. = endroit'])
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Abréviations', 'env. - envers'], 'echantillon')
    const { reference } = extractReference([abbrSec, echantillon], { n: 1 })
    expect(reference.abbr['end.']).toBe('endroit')
    expect(reference.abbr['env.']).toBe('envers')
    expect(reference.abbrFull).toHaveLength(2)
  })
})

// (aide-mémoire sous-titres et faux titres) — Harlow_Sweater_FR
// (corpus réel) : le sous-titre nu « Conseils » (renvois vers des vidéos de technique)
// ouvre désormais son propre bloc `tips`, sur le modèle EXACT de `materials` —
// aucun prédicat de contenu, fermeture au sous-titre nu suivant ou à un plafond de
// sécurité. Restreint au SEUL `sec.ref === 'echantillon'` comme `materials` (même
// prudence : `isNonWorkSection` avalerait les rangs d'une vraie section de travail
// kind='pelote' non liée à l'échantillon).
describe("extractReference — sous-titre nu « Conseils » (## Conseils {tips})", () => {
  // NB (cf. describe dédié plus bas) : « Conseils » est le titre RÉSERVÉ FR du
  // bloc tips — depuis le correctif de masquage, il n'est plus recopié en tête. On utilise
  // ici « Astuces » (vocabulaire reconnu mais PAS un titre réservé) pour prouver le
  // mécanisme d'ouverture/recopie verbatim indépendamment du masquage.
  it('« Astuces » nu suivi d’une ligne l’ouvre : le libellé et sa ligne rejoignent le bloc tips, verbatim', () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Astuces', 'Voir la vidéo de montage.'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tips')
    expect(tab.blocks[0].p).toEqual(['Astuces', 'Voir la vidéo de montage.'])
  })

  // « Tips » EST le titre réservé EN du bloc (cf. i18n en.json) : masqué, à la
  // différence de Astuces/Consejos/Tipps qui ne sont titre réservé dans AUCUNE des deux
  // langues de l'interface et restent donc recopiés verbatim.
  it.each(['Astuces', 'Consejos', 'Tipps'])(
    'vocabulaire multilingue reconnu comme sous-titre nu, recopié verbatim (pas un titre réservé) : « %s »',
    (word) => {
      const echantillon = sec('ÉCHANTILLON', 'echantillon', [word, 'Une ligne de contenu quelconque.'], 'echantillon')
      const { reference } = extractReference([echantillon], { n: 1 })
      const tab = reference.tabs.find((t) => t.id === 'tips')
      expect(tab.blocks[0].p).toEqual([word, 'Une ligne de contenu quelconque.'])
    },
  )
  it('« Tips » (titre réservé EN du bloc) est reconnu comme sous-titre nu mais MASQUÉ', () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Tips', 'Une ligne de contenu quelconque.'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tips')
    expect(tab.blocks[0].p).toEqual(['Une ligne de contenu quelconque.'])
  })

  it("« Astuces » se referme sur le sous-titre nu suivant (« Abréviations »), sans l'avaler", () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Astuces', 'Voir la vidéo.', 'Abréviations', 'm - maille(s)'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tips')
    expect(tab.blocks[0].p).toEqual(['Astuces', 'Voir la vidéo.'])
    expect(reference.abbr['m']).toBe('maille(s)')
  })

  it("garde : un sous-titre nu « Astuces » qui n'introduit rien (immédiatement suivi d'un autre sous-titre nu) reste NON consommé", () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Astuces', 'Abréviations', 'm - maille(s)'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    expect(reference.tabs.find((t) => t.id === 'tips')).toBeUndefined()
    expect(gaugeText).toContain('Astuces')
    expect(reference.abbr['m']).toBe('maille(s)')
  })

  it("garde (plafond) : « Astuces » suivi d'une longue suite de prose ne doit pas avaler toute la section — le plafond referme le bloc sans rien perdre", () => {
    const lignes = ['Astuces', 'Voir la vidéo de montage.']
    for (let i = 1; i <= 10; i++) lignes.push(`Ligne de section sans rapport numéro ${i}.`)
    const echantillon = sec('ÉCHANTILLON', 'echantillon', lignes, 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const tipsTab = reference.tabs.find((t) => t.id === 'tips')
    const gaugeText = (blocks.find((b) => b.h3 === 'Échantillon')?.p || []).join('\n')
    // Le libellé + 6 lignes de contenu, comme le plafond de Matériel (MATERIALS_BAREBLOCK_CAP).
    expect(tipsTab.blocks[0].p).toEqual([
      'Astuces',
      'Voir la vidéo de montage.',
      'Ligne de section sans rapport numéro 1.',
      'Ligne de section sans rapport numéro 2.',
      'Ligne de section sans rapport numéro 3.',
      'Ligne de section sans rapport numéro 4.',
      'Ligne de section sans rapport numéro 5.',
    ])
    // Rien n'est perdu : l'excédent retombe dans le fallback Échantillon existant.
    for (let i = 6; i <= 10; i++) expect(gaugeText).toContain(`Ligne de section sans rapport numéro ${i}.`)
  })

  it("garde (sécurité) : un sous-titre nu « Astuces » dans une VRAIE section de travail (kind='pelote', pas d'échantillon) n'avale PAS les rangs qui suivent", () => {
    const dos = sec('DOS', null, ['Astuces', 'Rang 1 : monter 40 m.', 'Rang 2 : tricoter à l’endroit.'])
    const { reference } = extractReference([dos], { n: 1 })
    expect(reference.tabs.find((t) => t.id === 'tips')).toBeUndefined()
    expect(dos.lines.every((l) => !l.consumed)).toBe(true)
  })

  it("garde B : un « Astuces » nu ouvre son bloc même si une section techniques dédiée existe déjà ailleurs (pas de plafond de collision, comme materials)", () => {
    const techniques = sec('TECHNIQUES', 'techniques', ['Point mousse : tricoter à l’endroit sur tous les rangs.'])
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Astuces', 'Voir la vidéo.'], 'echantillon')
    const { reference } = extractReference([techniques, echantillon], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tips')
    expect(tab.blocks[0].p).toEqual(['Astuces', 'Voir la vidéo.'])
  })
})

// Après revue (retour d'usage) — le libellé d'ouverture d'un bloc de
// sous-titre nu (yarn/needles/materials/tips) reste recopié EN TÊTE du bloc pour apporter
// une nuance (« Mercerie » sous Matériel, « Aiguilles suggérées » sous Aiguilles) — mais
// quand le libellé est IDENTIQUE au titre réservé du bloc lui-même (« Conseils » sous
// ## Conseils), la recopie est un pur doublon. Règle GÉNÉRALE (pas spécifique à Conseils) :
// masquer le libellé quand il est identique (accents/casse ignorés) au titre réservé du
// champ, dans L'UNE OU L'AUTRE des deux langues de l'interface (fr/en) — un patron anglais
// titrant « Tips » sous un bloc « Tips » (app en anglais) produirait le même doublon. Le
// libellé reste CONSOMMÉ dans tous les cas (il ne réapparaît nulle part ailleurs) : seule sa
// recopie est retirée, puisque le titre réservé porte déjà la même information.
describe('extractReference — masquage du libellé identique au titre réservé (fr/en, casse/accents ignorés)', () => {
  it('« Conseils » (titre réservé FR de tips) est masqué : une seule occurrence du mot en sortie (le h3, pas le contenu)', () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Conseils', 'Joindre les fils avec une aiguille à feutrer.'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tips')
    expect(tab.blocks[0].h3).toBe('Conseils')
    expect(tab.blocks[0].p).toEqual(['Joindre les fils avec une aiguille à feutrer.'])
    // Rien n'est perdu : le mot « Conseils » lui-même n'a pas disparu, il est porté par le
    // titre h3 — la vérification ci-dessus le prouve déjà, ce commentaire documente l'intention.
  })

  it('« Tips » (titre réservé EN de tips) est masqué aussi', () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Tips', 'See the tutorial video.'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tips')
    expect(tab.blocks[0].p).toEqual(['See the tutorial video.'])
  })

  it('« CONSEILS » (majuscules) et accents/casse variables sont ignorés dans la comparaison', () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['CONSEILS', 'Voir la vidéo.'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tips')
    expect(tab.blocks[0].p).toEqual(['Voir la vidéo.'])
  })

  it('« MATERIEL » (majuscules, SANS accent) est reconnu comme un doublon du titre réservé « Matériel » — accents ET casse ignorés', () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['MATERIEL', '2 marqueurs.'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const matBlock = blocks.find((b) => b.h3 === 'Matériel')
    expect(matBlock.p).toEqual(['2 marqueurs.'])
  })

  // Fil/Aiguilles sont des champs TEXTE (les lignes internes sont jointes par '\n' avant
  // d'être enveloppées dans un p à un seul élément, cf. `needles.join('\n')`/`yarns.join
  // ('\n')` dans extractReference) — même idiome `.join('\n')` que les tests M2 ci-dessus
  // pour comparer le texte final, pas la forme tableau (propre à materials/tips).
  it('« Fil » (titre réservé FR de yarn) et « Needles » (titre réservé EN de needles) sont masqués', () => {
    const s1 = sec('ÉCHANTILLON', 'echantillon', ['Fil', 'Coton DK, 3 pelotes.'], 'echantillon')
    const r1 = extractReference([s1], { n: 1 }).reference
    const b1 = r1.tabs.find((t) => t.id === 'materiel')?.blocks || []
    expect((b1.find((b) => b.h3 === 'Fil')?.p || []).join('\n')).toBe('Coton DK, 3 pelotes.')

    const s2 = sec('ÉCHANTILLON', 'echantillon', ['Needles', 'Circular needles 4mm.'], 'echantillon')
    const r2 = extractReference([s2], { n: 1 }).reference
    const b2 = r2.tabs.find((t) => t.id === 'materiel')?.blocks || []
    expect((b2.find((b) => /aiguille/i.test(b.h3 || ''))?.p || []).join('\n')).toBe('Circular needles 4mm.')
  })

  // Non-régression EXPLICITE (déjà couverte par égalité stricte dans les tests précédents /
  // M2 ci-dessus, reformulée ici pour documenter précisément cette garde) : un
  // libellé qui apporte une VRAIE nuance (mot différent du titre réservé) n'est jamais
  // masqué, même s'il ouvre le même champ.
  it('« Mercerie » (mot différent du titre réservé « Matériel ») reste conservé, verbatim en tête', () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Mercerie', '2 marqueurs.'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const matBlock = blocks.find((b) => b.h3 === 'Matériel')
    expect(matBlock.p).toEqual(['Mercerie', '2 marqueurs.'])
  })

  it('« Aiguilles suggérées » (nuance : substituable) reste conservé, verbatim en tête', () => {
    const echantillon = sec('ÉCHANTILLON', 'echantillon', ['Aiguilles suggérées', 'Aiguilles circulaires 4 mm.'], 'echantillon')
    const { reference } = extractReference([echantillon], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const needleBlock = blocks.find((b) => /aiguille/i.test(b.h3 || ''))
    expect((needleBlock.p || []).join('\n').split('\n')).toEqual(['Aiguilles suggérées', 'Aiguilles circulaires 4 mm.'])
  })
})

describe('extractReference — techniques (## Techniques {techniques})', () => {
  it('découpe une section techniques en entrées {title, body} sur des sous-labels « clé : texte » (Barley Field, M1R/M1L)', () => {
    const s = sec('ASTUCES POUR RÉALISER LES AUGMENTATIONS', 'techniques', [
      'Les augmentations sont réalisées de chaque côté d’une maille raglan.',
      'M1R : Piquer l’aiguille gauche sous le brin entre deux mailles depuis l’arrière et tricoter le brin end.',
      'M1L : Piquer l’aiguille gauche sous le brin entre deux mailles depuis le devant et tricoter le brin torse à l’end.',
    ])
    const { reference } = extractReference([s], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tech')
    expect(tab).toBeTruthy()
    const titles = tab.blocks.map((b) => b.h3)
    expect(titles).toEqual(['ASTUCES POUR RÉALISER LES AUGMENTATIONS', 'M1R', 'M1L'])
    const m1r = tab.blocks.find((b) => b.h3 === 'M1R')
    expect(m1r.p[0]).toBe('Piquer l’aiguille gauche sous le brin entre deux mailles depuis l’arrière et tricoter le brin end.')
    // la prose avant le 1er sous-label n'est pas perdue : elle reste sous le titre de section.
    const preamble = tab.blocks.find((b) => b.h3 === 'ASTUCES POUR RÉALISER LES AUGMENTATIONS')
    expect(preamble.p[0]).toBe('Les augmentations sont réalisées de chaque côté d’une maille raglan.')
  })
  it('un libellé qui DÉMARRE par un marqueur de rang n’ouvre PAS d’entrée : la ligne rejoint le body de l’entrée courante (melting-pot-shawl-en, « Row 1 (RS): k3, yo… »)', () => {
    // Corpus réel melting-pot-shawl-en : la section « How to work a bobble » du bloc
    // BOBBLE STITCH contenait 11 lignes « Row N (…): … » happées par TECH_LABEL_RE
    // (clé courte + « : texte ») → 11 faux « ### Row N » vidant la section du patron.
    const s = sec('How to work a bobble', 'techniques', [
      'Make 5 sts: *k1 in the front loop, k1 in the back loop* repeat this in the indicated st.',
      'Row 1 (RS): k3, yo. K to maker, yo, slm, k1, slm, yo. Turn.',
      'Row 2 (WS): k3. P until 3 sts left. K3. Turn.',
      'Rows 6 to 8: Repeat Rows 2 to 4. (3 rows)',
    ])
    const { reference } = extractReference([s], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tech')
    expect(tab.blocks.map((b) => b.h3)).toEqual(['Make 5 sts'])
    expect(tab.blocks[0].p[0]).toBe(
      '*k1 in the front loop, k1 in the back loop* repeat this in the indicated st.\n' +
      'Row 1 (RS): k3, yo. K to maker, yo, slm, k1, slm, yo. Turn.\n' +
      'Row 2 (WS): k3. P until 3 sts left. K3. Turn.\n' +
      'Rows 6 to 8: Repeat Rows 2 to 4. (3 rows)',
    )
  })
  it('un rang sans entrée courante reste dans le corps de la rubrique (entrée titrée par la section), jamais un H3', () => {
    const s = sec('How to work a bobble', 'techniques', [
      'Row 1 (RS): k3, yo. K to maker. Turn.',
      'Row 2 (WS): k3. P until 3 sts left. K3. Turn.',
    ])
    const { reference } = extractReference([s], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tech')
    expect(tab.blocks).toHaveLength(1)
    expect(tab.blocks[0].h3).toBe('How to work a bobble')
    expect(tab.blocks[0].p[0]).toBe('Row 1 (RS): k3, yo. K to maker. Turn.\nRow 2 (WS): k3. P until 3 sts left. K3. Turn.')
  })
  it('contre-tests : M1R/M1L/C4B/Bobble ouvrent TOUJOURS des entrées malgré la garde anti-rang', () => {
    const s = sec('ASTUCES', 'techniques', [
      'M1R : Piquer l’aiguille gauche sous le brin.',
      'M1L: Piquer l’aiguille gauche sous le brin depuis le devant.',
      'C4B : Glisser 4 m sur une aiguille auxiliaire derrière.',
      'Bobble : Tricoter 5 fois la même maille.',
    ])
    const { reference } = extractReference([s], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tech')
    expect(tab.blocks.map((b) => b.h3)).toEqual(['M1R', 'M1L', 'C4B', 'Bobble'])
  })
  it('sans sous-label détecté (section technique sans structure interne), toute la section devient UNE seule entrée {title: <titre section>, body: <texte joint>}', () => {
    // ainsa-bandana-nl (gate) : « Hoe haak je 4-stokjes-samen » n'a pas de sous-label
    // interne — un « : » nu SANS texte à sa suite (amorce de phrase) ne doit PAS ouvrir
    // une entrée à tort, sous peine de scinder ce bloc en 2 (régression gate).
    const s = sec('Hoe haak je 4-stokjes-samen', 'techniques', [
      'Alles is gemaakt in dezelfde steek:',
      '[Omslaan, steek de naald in de steek] x 4 keer.',
    ])
    const { reference } = extractReference([s], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tech')
    expect(tab.blocks).toHaveLength(1)
    expect(tab.blocks[0].h3).toBe('Hoe haak je 4-stokjes-samen')
    expect(tab.blocks[0].p[0]).toBe(
      'Alles is gemaakt in dezelfde steek:\n[Omslaan, steek de naald in de steek] x 4 keer.',
    )
  })
  it('un sous-label EN GRAS sans « : » (ligne courte, sans ponctuation de fin) ouvre aussi une entrée', () => {
    const s = {
      title: 'Techniques',
      kind: 'pelote',
      ref: 'techniques',
      lines: [
        { text: 'Un rappel des points spéciaux utilisés dans ce modèle.', size: 10, bold: false, y: 0 },
        { text: 'Point de blé', size: 10, bold: true, y: 0 },
        { text: 'Tricoter 1 m end, 1 m env en alternance sur 4 rangs.', size: 10, bold: false, y: 0 },
      ],
    }
    const { reference } = extractReference([s], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tech')
    const titles = tab.blocks.map((b) => b.h3)
    expect(titles).toEqual(['Techniques', 'Point de blé'])
    const entry = tab.blocks.find((b) => b.h3 === 'Point de blé')
    expect(entry.p[0]).toBe('Tricoter 1 m end, 1 m env en alternance sur 4 rangs.')
  })
  it('plusieurs sections ref=techniques distinctes (titres « éclatés ») fusionnent dans le MÊME onglet, dans l’ordre', () => {
    // soft-twist-mittens-and-headband-fr (gate) : « Comment faire le croisement » et
    // « Comment crocheter un point étoile » sont 2 sections SÉPARÉES (pas une seule
    // section-parapluie) mais doivent alimenter le MÊME bloc Techniques.
    const a = sec('Comment faire le croisement', 'techniques', ['Plier la chaînette de départ.'])
    const b = sec('Comment crocheter un point étoile', 'techniques', ['Insérer le crochet dans la maille.'])
    const { reference } = extractReference([a, b], { n: 1 })
    const tab = reference.tabs.find((t) => t.id === 'tech')
    expect(tab.blocks.map((x) => x.h3)).toEqual(['Comment faire le croisement', 'Comment crocheter un point étoile'])
  })
})

describe('extractReference — étiquette de rubrique dans une section Échantillon', () => {
  it('« Materials: » ouvre le bloc Matériel au lieu d’être avalé par l’Échantillon (Mia_Cardigan)', () => {
    const texts = [
      '21 sts x 28 rows in stockinette stitch on 4mm needles = 10 x 10 cm after blocking',
      '29.5 sts x 28 rows double-knit button band on 3mm needles after blocking = 10 x 10 cm after blocking',
      'Needles:',
      'Circular needles: 3mm (100-120cm), 3.5mm (40-120 cm), 4mm (40-120 cm)',
      'Double-pointed needles: 3mm',
      'Materials:',
      '5 x 22-25 mm buttons',
      '5 locking stitch markers to mark buttonholes',
    ]
    const sections = [{ title: 'Gauge', ref: 'echantillon', kind: 'echantillon', page: 1,
      lines: texts.map((text) => ({ text, size: 10, bold: false })) }]
    const { reference } = extractReference(sections, { n: 1, sizeLabels: ['Taille unique'] })
    // Forme vérifiée : reference.tabs[0].blocks = [{ h3, h3Key, p: [string] }].
    const blocks = reference.tabs[0].blocks
    const byTitle = (h3) => blocks.find((b) => b.h3 === h3)?.p.join('\n') ?? ''
    expect(byTitle('Échantillon')).not.toContain('buttons')
    expect(byTitle('Échantillon')).toContain('21 sts x 28 rows in stockinette stitch')
    expect(byTitle('Aiguilles/Crochet')).toContain('Circular needles: 3mm')
    expect(byTitle('Matériel')).toContain('5 x 22-25 mm buttons')
    expect(byTitle('Matériel')).toContain('5 locking stitch markers to mark buttonholes')
  })
  it('« Tips: » ouvre le bloc Conseils au lieu d’être avalé par l’Échantillon (chemin PRÉ-EXISTANT, PAS la branche de cette tâche)', () => {
    // Note d'auto-revue : contrairement à « Materials: », « Tips: » n'est jamais
    // intercepté par labelFor (aucune entrée `tips` dans LABELS, cf. reference.js ~l.482-499)
    // — donc `lab` est null pour cette ligne et la NOUVELLE branche (celle qui
    // teste `lab.field === 'tips'`) n'est ici JAMAIS atteinte. Ce test passe déjà (vérifié) par
    // le mécanisme bareLabelFor pré-existant (garde `sectionEligible` ~l.1162) : « Tips: »
    // avec un « : » terminal NU est strippé par bareLabelFor et route via ce chemin, pas via le
    // nôtre. Preuve : retirer `|| lab.field === 'tips'` de la nouvelle branche laisse ce test VERT.
    // Gardé quand même — il documente que « Tips: » fonctionne bien dans ce cas, et protège le
    // clone `tips` de la nouvelle branche si `tips` gagnait un jour une entrée dans LABELS (auquel
    // cas labelFor l'intercepterait AVANT bareLabelFor, empruntant alors le même chemin mort que
    // « Materials: » — notre branche deviendrait alors le SEUL chemin qui fonctionne).
    const texts = [
      '21 sts x 28 rows in stockinette stitch on 4mm needles = 10 x 10 cm after blocking',
      'Tips:',
      'Block your swatch before measuring.',
      'Re-check gauge after washing.',
    ]
    const sections = [{ title: 'Gauge', ref: 'echantillon', kind: 'echantillon', page: 1,
      lines: texts.map((text) => ({ text, size: 10, bold: false })) }]
    const { reference } = extractReference(sections, { n: 1, sizeLabels: ['Taille unique'] })
    // « Conseils » vit dans son propre onglet (id: 'tips'), pas dans tabs[0] (id: 'materiel')
    // — cf. reader-reference.js.
    const gaugeBlocks = reference.tabs.find((tb) => tb.id === 'materiel').blocks
    const byTitle = (h3) => gaugeBlocks.find((b) => b.h3 === h3)?.p.join('\n') ?? ''
    expect(byTitle('Échantillon')).not.toContain('Block your swatch')
    expect(byTitle('Échantillon')).toContain('21 sts x 28 rows in stockinette stitch')
    const tipsTab = reference.tabs.find((tb) => tb.id === 'tips')
    expect(tipsTab).toBeTruthy()
    const conseils = tipsTab.blocks.find((b) => b.h3 === 'Conseils').p.join('\n')
    expect(conseils).toContain('Block your swatch before measuring.')
    expect(conseils).toContain('Re-check gauge after washing.')
  })
})

// (trois bloquants avant diffusion) — GAUGE_RE et isYarnLine (YARN_RE)
// sont deux lookaheads non ancrés `(?=.*A)(?=.*B)`, coûteux sur une chaîne longue. Quand
// aucune section dédiée fil/aiguilles/échantillon n'existe, le filet de secours (§3,
// isNonWorkSection) les applique à la ligne BRUTE, sans borne de longueur — mesuré sur un
// vrai patron du corpus : un paragraphe d'introduction mal recollé par le reflow (~91 000
// caractères, aucune ponctuation de fin de phrase pour le découper) fait geler l'import
// environ 18,5 secondes. Cas réel, pas un scénario construit : un paragraphe d'intro mal
// recollé est une forme de sortie normale du reflow (assemble.js) sur un PDF à la mise en
// page dégradée.
describe('extractReference — performance (lot 2, borne de longueur du filet de secours)', () => {
  it("ne gèle plus sur une intro reflowée de ~91 000 caractères sans section dédiée (GAUGE_RE/isYarnLine non bornés)", () => {
    // Prose plate, SANS « . » suivi d'une majuscule (SENTENCE_SPLIT_RE ne doit rien couper
    // ici : on veut taper directement les filets GAUGE_RE/isYarnLine de la ligne 1465/1467,
    // pas la branche fragment M1 qui, elle, est déjà bornée depuis le 25/07).
    const phrase = 'ce patron a été dessiné avec soin par une créatrice qui aimait mêler les techniques traditionnelles et modernes '
    let intro = ''
    while (intro.length < 91000) intro += phrase
    const s = sec('INTRO', null, [intro], 'pelote')
    const t0 = performance.now()
    extractReference([s], { n: 1 })
    const ms = performance.now() - t0
    // Seuil à 1 s : très large marge par rapport aux deux bornes connues — le défaut mesure
    // ~18,5 s (voire ~30 s pour isYarnLine seule sur une chaîne comparable), le correctif
    // descend sous la milliseconde. Un seuil à 1 s ne clignotera donc pas au hasard d'une
    // machine chargée.
    expect(ms).toBeLessThan(1000)
  })
  // Revue (constat critique) : la branche SŒUR, `bareBlock === 'yarn'` (continuation
  // d'un label NU « Laine: » sans valeur, dans une section ref='echantillon'/non-travail),
  // appelait isYarnLine SANS la même borne que sa sœur `bareBlock === 'needles'` (celle-ci
  // borne bien son GAUGE_RE.test interne, l.1087-1088) — chemin d'appel neuf, symétrique de
  // celui du test ci-dessus, manqué par la liste initiale des quatre sites.
  it("ne gèle plus sur une continuation de bloc « Laine: » nu suivie d'un paragraphe de ~91 000 caractères (isYarnLine non borné, bareBlock==='yarn')", () => {
    const phrase = 'ce patron a été dessiné avec soin par une créatrice qui aimait mêler les techniques traditionnelles et modernes '
    let paragraphe = ''
    while (paragraphe.length < 91000) paragraphe += phrase
    // sec.ref='echantillon' + kind='pelote' (défaut) : satisfait la garde d'éligibilité du
    // bareBlock nu (l.872-873, sec.ref==='echantillon' OU isNonWorkSection). « Laine: » (avec
    // deux-points, valeur vide) ouvre le bloc nu ; la ligne suivante, sans deux-points, tombe
    // dans la branche de continuation (l.1055+) qui appelle isYarnLine directement dessus.
    const s = sec('ÉCHANTILLON', 'echantillon', ['Laine:', paragraphe])
    const t0 = performance.now()
    extractReference([s], { n: 1 })
    const ms = performance.now() - t0
    // Même seuil et même marge que le test jumeau ci-dessus (défaut ~10,4 s reproduit en
    // revue, correctif attendu sous la milliseconde).
    expect(ms).toBeLessThan(1000)
  })
})

// (P1-5, Mia Cardigan English v1.1, corpus réel) — les 5 libellés de mesure
// (« Bust circumference of finished garment: », « Upper arm circumference of finished
// garment: », « Recommended length of finished garment: », « Recommended length of
// finished sleeve: », « Yoke depth: ») sont sur leur PROPRE ligne, séparée de leur(s)
// valeur(s) par un retour à la ligne PDF (pas de « : valeur » sur la même ligne). Deux
// causes enchaînées : (1) segment.js promouvait ces libellés en titres de section — ils
// n'atteignaient jamais la branche `mesures` de reference.js ; (2) même routés vers cette
// branche, elle n'acceptait le libellé QUE sur la MÊME ligne que le vecteur, jamais sur la
// ligne PRÉCÉDENTE — la ligne de valeurs était alors jetée en silence (label vide).
describe('bloc mesures — libellé sur la ligne PRÉCÉDENTE (Mia Cardigan, PDF réel)', () => {
  // Épingle les 3 resserrements de isBareSizeVectorLine trouvés par le balayage corpus
  // (3234 PDF) APRÈS le premier jet du correctif — chacun sur un cas réel qui régressait :
  // - « 132 br » (lavender-field-skirt-fr) : un décompte de brides n'est pas une mesure
  //   (pas d'unité de longueur reconnue) ;
  // - « 28 masker på 10 cm » (ash-knit-wrist-warmers-de) : un second chiffre trahit un
  //   taux/ratio (points/cm), pas une valeur unique ;
  // - « Op 33-34-34-35-36 cm (74-76-76-78- » (Pull femme col camionneur.pdf) : une
  //   parenthèse ouverte non refermée signale une ligne coupée par la mise en page —
  //   jamais bare, la prose disqualifiante est sur la ligne suivante.
  it('isBareSizeVectorLine rejette un décompte, un taux et une ligne coupée en pleine parenthèse — accepte une vraie mesure unique', () => {
    expect(isBareSizeVectorLine('132 br')).toBe(false)
    expect(isBareSizeVectorLine('28 masker på 10 cm')).toBe(false)
    expect(isBareSizeVectorLine('Op 33-34-34-35-36 cm (74-76-76-78-')).toBe(false)
    expect(isBareSizeVectorLine('47 cm (measured from underarm cast-on edge)')).toBe(true)
  })

  it('apparie un libellé (ligne précédente, sans chiffre) à son vecteur de 11 tailles (ligne suivante)', () => {
    const { reference } = extractReference([
      sec('Sizes', 'mesures', [
        'Bust circumference of finished garment:',
        '97 (102.5, 106.5, 112, 116) (121.5, 131, 142.5, 152) 161.5, 171 cm',
        'Yoke depth:',
        '21.5 (22, 22, 23, 23.5) (23.5, 23.5, 24.5, 25) 25, 25.5 cm',
      ]),
    ], { n: 11 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks[0].sizeTable.rows
    const bust = rows.find((r) => r.label === 'Bust circumference of finished garment')
    const yoke = rows.find((r) => r.label === 'Yoke depth')
    expect(bust).toBeTruthy()
    expect(bust.values).toEqual(['97', '102.5', '106.5', '112', '116', '121.5', '131', '142.5', '152', '161.5', '171'])
    expect(yoke).toBeTruthy()
    expect(yoke.values).toEqual(['21.5', '22', '22', '23', '23.5', '23.5', '23.5', '24.5', '25', '25', '25.5'])
  })

  // « Recommended length of finished sleeve: » -> « 47 cm (measured from underarm
  // cast-on edge) » : une seule valeur (identique pour toutes les tailles), jamais un
  // vecteur groupé. Sans ce filet, la ligne aurait 0 vecteur ET pas de « : » sur sa propre
  // ligne : rien ne l'aurait poussée dans sizeTable, la seule mesure de manche disparaissait.
  it('répète une valeur UNIQUE (mesure identique pour toutes les tailles) sur les n colonnes, sans rien inventer', () => {
    const { reference } = extractReference([
      sec('Sizes', 'mesures', [
        'Recommended length of finished sleeve:',
        '47 cm (measured from underarm cast-on edge)',
      ]),
    ], { n: 11 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks[0].sizeTable.rows
    const sleeve = rows.find((r) => r.label === 'Recommended length of finished sleeve')
    expect(sleeve).toBeTruthy()
    expect(sleeve.values).toEqual(Array(11).fill('47'))
  })

  // Le libellé en attente ne doit jamais fuir d'une section « mesures » à la suivante :
  // un libellé jamais consommé (aucune ligne de valeur derrière lui, la section se
  // termine) doit rester sans effet sur la section « mesures » SUIVANTE.
  it("un libellé jamais consommé ne fuit pas vers la section « mesures » suivante", () => {
    const { reference } = extractReference([
      sec('Sizes A', 'mesures', ['Bust circumference of finished garment:']),
      sec('Sizes B', 'mesures', ['21.5 (22, 22, 23, 23.5) (23.5, 23.5, 24.5, 25) 25, 25.5 cm']),
    ], { n: 11 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab ? tab.blocks.flatMap((b) => b.sizeTable?.rows || []) : []
    expect(rows.find((r) => /Bust circumference/i.test(r.label))).toBeUndefined()
    expect(rows.find((r) => r.values?.[0] === '21.5')).toBeUndefined()
  })

  // Garde ligne ~1476 (reference.js) : le filet « valeur unique repetee » n'accepte que le
  // TOUT PREMIER nombre-unite de la ligne, jamais un second chiffre plus loin (taux/ratio,
  // ex. « 10 cm x 10 cm on 4 mm » — un echantillon, pas une mesure). Sans le controle
  // !/\d/.test(t.slice(...)), cette ligne d'echantillon produirait une fausse ligne
  // « Tension over pattern » repetee sur les n tailles au lieu de rien.
  it('une ligne d’echantillon (2 chiffres) apres un libellé en attente ne fabrique pas de fausse mesure', () => {
    const { reference } = extractReference([
      sec('Mesures', 'mesures', ['Tension over pattern:', '10 cm x 10 cm on 4 mm']),
    ], { n: 3 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab ? tab.blocks.flatMap((b) => b.sizeTable?.rows || []) : []
    expect(rows.find((r) => /Tension over pattern/i.test(r.label))).toBeUndefined()
  })
})

// Bout en bout (segment.js + reference.js), géométrie VERBATIM du PDF réel Mia Cardigan
// (texte et coordonnées Y relevés le 20/08 sur `Mia_Cardigan__English__v1.1.pdf`, page 1) —
// couvre la chaîne complète : promotion supprimée (segment.js) PUIS appariement
// libellé/vecteur (reference.js), y compris la ligne « Recommended length of finished
// sleeve: » qui interrompt la séquence de vecteurs entre le libellé garment-length et
// Yoke depth (seule une fixture qui reproduit CETTE ligne peut prouver que Yoke depth
// n'est pas perdu par la coupure).
describe('bloc Tailles bout en bout — Mia Cardigan (géométrie PDF réelle)', () => {
  const L = (text, y, size = 10.08) => ({ text, y, size, bold: false })
  const pagesMia = () => [
    [
      L('C O C O A M O U R K N I T W E A R', 796.2992),
      L('M I A C A R D I G A N', 753.8192, 28.08),
    ],
    [
      L('Sizes:', 796.2992),
      L('1 (2, 3, 4, 5) (6, 7, 8, 9) 10, 11', 783.3392),
      L('Sizes 1 (2, 3, 4, 5) (6, 7, 8, 9) 10, 11 are intended to fit an approximate actual bust circumference of 75 (80, 85, 90, 95) (100, 110, 120,', 756.4592),
      L('130) 140, 150 cm.', 743.4992),
      L('Bust circumference of finished garment:', 717.5792),
      L('97 (102.5, 106.5, 112, 116) (121.5, 131, 142.5, 152) 161.5, 171 cm', 704.6192),
      L('Upper arm circumference of finished garment:', 677.7392),
      L('34.5 (34.5, 38, 38, 38) (40, 42, 45.5, 49.5) 53.5, 57 cm', 664.7792),
      L('Recommended length of finished garment:', 637.8992),
      L('48.5 (49, 49, 50, 50.5) (50.5, 50.5, 51.5, 52) 52, 52.5 cm (measured mid-back excluding neck edge)', 624.9392),
      L('Recommended length of finished sleeve:', 598.0592),
      L('47 cm (measured from underarm cast-on edge)', 585.0992),
      L('Yoke depth:', 558.2192),
      L('21.5 (22, 22, 23, 23.5) (23.5, 23.5, 24.5, 25) 25, 25.5 cm', 545.2592),
      L('Gauge:', 518.1392),
      L('21 sts x 28 rows in stockinette stitch on 4mm needles = 10 x 10 cm after blocking', 505.1792),
    ],
  ]

  it('les 5 libellés de mesure deviennent des lignes du tableau Tailles, pas des titres de section', () => {
    const secs = segmentSections(pagesMia())
    const titles = secs.map((s) => s.title)
    expect(titles).not.toContain('Bust circumference of finished garment')
    expect(titles).not.toContain('Upper arm circumference of finished garment')
    expect(titles).not.toContain('Recommended length of finished garment')
    expect(titles).not.toContain('Recommended length of finished sleeve')
    expect(titles).not.toContain('Yoke depth')
    // La section suivante, elle, reste un vrai titre promu (non-régression : le garde
    // n'assomme pas tout ce qui suit « Sizes: », seulement les libellés-valeur).
    expect(titles).toContain('Gauge')
  })

  it('produit les 5 mesures, 11 valeurs chacune, dans reader.reference (bout en bout)', () => {
    const { reader } = buildReaderFromPages(pagesMia(), { fileName: 'mia.pdf' })
    const tab = reader.reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks[0].sizeTable.rows
    const byLabel = (label) => rows.find((r) => r.label === label)
    expect(byLabel('Bust circumference of finished garment')?.values).toHaveLength(11)
    expect(byLabel('Upper arm circumference of finished garment')?.values).toHaveLength(11)
    expect(byLabel('Recommended length of finished garment')?.values).toHaveLength(11)
    expect(byLabel('Recommended length of finished sleeve')?.values).toHaveLength(11)
    expect(byLabel('Yoke depth')?.values).toHaveLength(11)
    expect(byLabel('Yoke depth')?.values[0]).toBe('21.5')
    expect(byLabel('Yoke depth')?.values[10]).toBe('25.5')
  })
})

// (P1-7) — Mia Cardigan range ses 2 fils sous le sous-titre nu « Materials: »
// (aucune section « Fil » dédiée dans le PDF) : reference n'a PAS de champ plat
// `yarn`/`materiel` (relevé fait sur src/utils/reader-reference.js — buildReference ne
// renvoie que { abbr, abbrFull, tiles, tabs }, le fil/matériel vit dans
// tabs.find(id==='materiel').blocks, chaque bloc {h3, p}), même idiome que les tests
// « bloc materiel » plus haut dans ce fichier.
// Second relevé (remesuré sur le PDF réel, 20/08) : la section « Materials: » de Mia
// n'est PAS sa propre section segment.js — un test buildReaderFromPages qui pose
// « Materials: » juste après « Sizes: » avec des lignes à y:0 identiques fait promouvoir
// « Materials » en section dédiée ref==='materiel' (vérifié par segmentSections direct :
// kind=pelote ref=materiel), ce qui exerce l'AUTRE branche (sec.ref==='materiel',
// ligne ~1371, qui avait déjà isYarnLine avant ce correctif) et ne teste PAS le vrai
// correctif. Dans le PDF réel, « Materials: » est un sous-titre NU imbriqué dans la
// section « Gauge » (ref==='echantillon', 32 lignes : Gauge + Aiguilles + Matériel + Fil
// bare-blocks, confirmé par la sortie moteur du 20/08 — aucune section titrée « Fil » ni
// « Materiel » séparée n'apparaît dans les 32 sections). Le bareBlock `materials` ne
// s'ouvre QUE sous sec.ref==='echantillon' (reference.js ~l.1200,
// `sectionEligible = sec.ref === 'echantillon'` pour bl==='materials'/'tips') : c'est
// donc CE chemin — extractReference([sec(..., 'echantillon', [...])]) — qui reproduit
// fidèlement le bug et le correctif, pas buildReaderFromPages.
describe('bloc materiel — les fils partent vers Fil (Mia Cardigan)', () => {
  const blockText = (reference, h3Re) => {
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const block = blocks.find((b) => h3Re.test((b.h3 || '').trim()))
    return (block?.p || []).join('\n')
  }

  it('une puce portant un metrage va dans Fil, le reste reste dans Materiel', () => {
    const gaugeSec = sec('GAUGE', 'echantillon', [
      '21 sts x 28 rows in stockinette stitch on 4mm needles = 10 x 10 cm',
      'Materials:',
      '5 x 22-25 mm buttons',
      '5 locking stitch markers to mark buttonholes',
      '300 (300, 350) 350, 400 g Merino Singles by Sysleriget (100g = 366m)',
    ])
    const { reference } = extractReference([gaugeSec], { n: 1 })
    const yarn = blockText(reference, /^fil$/i)
    const materials = blockText(reference, /^mat[ée]riel$/i)
    expect(yarn).toContain('Merino Singles by Sysleriget')
    expect(materials).toContain('buttons')
    expect(materials).toContain('locking stitch markers')
    expect(materials).not.toContain('Merino Singles')
  })

  it('une puce SANS metrage reste dans Materiel', () => {
    const gaugeSec = sec('GAUGE', 'echantillon', [
      '21 sts x 28 rows in stockinette stitch on 4mm needles = 10 x 10 cm',
      'Materials:',
      '1 tapestry needle',
    ])
    const { reference } = extractReference([gaugeSec], { n: 1 })
    const materials = blockText(reference, /^mat[ée]riel$/i)
    const yarn = blockText(reference, /^fil$/i)
    expect(materials).toContain('tapestry needle')
    expect(yarn).not.toContain('tapestry needle')
  })

  // Témoin de la garde « jamais perdre d'info » ajoutée au point d'ajout
  // (`yarnsBefore`/`materials.push(t)` de repli) : même idiome que les 3 témoins
  // jumeaux déjà dans ce fichier pour les sites `sec.ref==='fil'` (~l.1510) et le
  // balayage d'étiquettes (~l.1488) — `pushYarn` est plafonné à 8 lignes-fil « de
  // qualité » (yarnQualityCount). Une section `fil` DÉDIÉE sature le plafond en
  // premier (ordre du document, `sections` traversées dans l'ordre) ; la puce à
  // métrage rencontrée ensuite dans le bloc Matériel ne peut plus rejoindre `yarns`
  // — sans le repli, elle disparaîtrait (ni Fil, ni Matériel, ni nulle part).
  it("jamais perdre d'info : au plafond de qualite du champ Fil (8), une puce a metrage du bloc Materiel retombe au Materiel plutot que de disparaitre", () => {
    const lignes = []
    for (let i = 1; i <= 8; i++) lignes.push(`Fibre ${i}, 100 g = 200 m`)
    const filSec = sec('FIL', 'fil', lignes)
    const gaugeSec = sec('GAUGE', 'echantillon', [
      '21 sts x 28 rows in stockinette stitch on 4mm needles = 10 x 10 cm',
      'Materials:',
      '300 g Merino Singles by Sysleriget (100g = 366m)',
    ])
    const { reference } = extractReference([filSec, gaugeSec], { n: 1 })
    const blocks = reference.tabs.find((t) => t.id === 'materiel')?.blocks || []
    const yarnText = (blocks.find((b) => b.h3 === 'Fil')?.p || []).join('\n')
    const matBlock = blocks.find((b) => /^mat[ée]riel$/i.test((b.h3 || '').trim()))
    // Garde d'existence : sans le repli teste ici, matBlock reste undefined et
    // `matBlock.p` plante en TypeError au lieu d'un rouge lisible — cette ligne rend le
    // rouge parlant (assertion explicite) si le repli disparait.
    expect(matBlock).toBeTruthy()
    expect(yarnText).not.toContain('Merino Singles')
    expect(matBlock.p).toContain('300 g Merino Singles by Sysleriget (100g = 366m)')
  })
})

// Bug 2 (retour banc) — filet de sécurité générique : une ligne qui n'entre dans
// aucun motif attendu d'une section DÉDIÉE (ref!==null) ne doit plus disparaître en
// silence. Une section dédiée écartée du travail en aval (assemble.js) est une IMPASSE
// pour toute ligne non explicitement poussée dans un collecteur qui survit (sizeTable,
// abbr, gaugeLines, yarns, needles, materials, techniques, notes) — `line.consumed` seul
// ne protège rien ici (contrairement à une section de travail ordinaire). Les deux
// branches ci-dessous (`mesures`, `abbr`) sont les deux seules, dans ce fichier, qui
// pouvaient encore atteindre une impasse sans y pousser la ligne nulle part.
describe('extractReference — Bug 2 : filet de sécurité, aucune ligne ne disparaît sans trace', () => {
  // mountaintop-pullover-es-b0cc556d : les sous-titres « Talla infantil »/
  // « Tallas adultas » routent toute la construction du canesú raglan vers une section
  // ref==='mesures' — ce sont des rangs de façonnage, pas des mesures ; aucune branche de
  // la section 'mesures' ne les reconnaît, et la section entière est écartée du travail
  // (assemble.js), donc ils disparaissaient (1018 mots, aucune trace nulle part).
  it('ref==="mesures" : un rang de façonnage mal routé (sous-titre « Talla infantil », mountaintop-pullover-es) n’est pas jeté — recueilli en note', () => {
    const ligne = 'Vuelta 3: pd hasta el m, aum1d, pm, 1 pd, pm, aum1i, pd hasta el m, aum1d, pm, 1 pd, pm, aum1i, pd hasta el m, aum1d, pm, 1 pd, pm, aum1i, pd hasta el m, aum1d, pm, 1 pd, pm, aum1i, pd hasta el final.'
    const s = sec('Talla infantil', 'mesures', [ligne])
    const { reference, notes } = extractReference([s], { n: 3 })
    // Ni fabriquée en fausse mesure...
    expect(reference.tabs.find((t) => t.id === 'tailles')).toBeUndefined()
    // ...ni perdue : recueillie verbatim en note (limite assumée : `notes` est une liste
    // plate côté assemble.js, non modifiable ici — elle atterrit en Présentation, pas
    // juste à côté de la section « Talla infantil » d'où elle vient).
    expect(notes).toContain(ligne)
    expect(s.lines[0].consumed).toBe(true)
  })
  // La section abbr, elle, contient de vraies abréviations à côté de la ligne perdue —
  // le filet ne doit pas les affecter.
  it('ref==="mesures" : les branches existantes (vecteur de tailles) restent intactes à côté du filet de sécurité', () => {
    const s = sec('Sizes', 'mesures', [
      'Bust circumference:',
      '75 (80, 85) cm',
      'Rang 5: tricoter 1 fois sans façonnage particulier.',
    ])
    const { reference, notes } = extractReference([s], { n: 3 })
    const tab = reference.tabs.find((t) => t.id === 'tailles')
    const rows = tab.blocks.flatMap((b) => b.sizeTable?.rows || [])
    expect(rows).toContainEqual({ label: 'Bust circumference', values: ['75', '80', '85'] })
    expect(notes).toContain('Rang 5: tricoter 1 fois sans façonnage particulier.')
  })
  // Trou structurel documenté (commit 475250bd n'a corrigé que le cas ciblé
  // « [ ] indique que… ») : une ligne SANS séparateur clé/valeur ET SANS ponctuation
  // finale traverse execAbbrLine, execNotationLegendLine, formRejectedAbbrLine ET
  // looksLikeSetupProseLine sans être captée par aucun des quatre.
  it('ref==="abbr" : une ligne sans séparateur clé/valeur ni ponctuation finale (trou structurel) n’est pas jetée — recueillie en note', () => {
    const abbrSec = sec('ABRÉVIATIONS', 'abbr', ['[ ] voir le diagramme page 3'])
    const { reference, notes } = extractReference([abbrSec], { n: 1 })
    expect(reference.abbrFull).toHaveLength(0)
    expect(notes).toContain('[ ] voir le diagramme page 3')
  })
  // Non-régression : les vraies entrées de glossaire d'une section abbr ne doivent pas se
  // retrouver dupliquées en note par le nouveau filet.
  it('non-régression : les vraies entrées de glossaire ne rejoignent pas les notes (le filet ne joue que si les 4 autres filets ont échoué)', () => {
    const abbrSec = sec('ABRÉVIATIONS', 'abbr', ['m = maille(s)', 'aug = augmentation', '[ ] voir le diagramme page 3'])
    const { reference, notes } = extractReference([abbrSec], { n: 1 })
    expect(reference.abbr['m']).toBe('maille(s)')
    expect(reference.abbr['aug']).toBe('augmentation')
    expect(notes).not.toContain('m = maille(s)')
    expect(notes).not.toContain('aug = augmentation')
    expect(notes).toContain('[ ] voir le diagramme page 3')
  })
})

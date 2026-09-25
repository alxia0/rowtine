import { describe, it, expect } from 'vitest'
import { linesToSteps, NON_WORK_KINDS } from '@/utils/pdf-import/steps'

const L = (text) => ({ text, size: 10, bold: false, y: 0 })

describe('linesToSteps', () => {
  it('marqueur de rang → ROW, avec vecteurs remplacés', () => {
    const steps = linesToSteps([L('Rang 1 : monter 104 (108) 112 m.')], { kind: 'corps', n: 3 })
    expect(steps).toEqual([{ t: 'Rang 1 : monter {{0}} m.', c: [['104', '108', '112']] }])
  })
  it('répétition → REP avec total par taille', () => {
    const steps = linesToSteps([L('Répéter ce rang 8 (9) 10 fois.')], { kind: 'corps', n: 3 })
    expect(steps[0]).toMatchObject({ repeat: true, total: [8, 9, 10] })
  })
  // Le seul vecteur de tailles d'une ligne n'est le total que s'il porte l'unité de répétition.
  it('répétition à compte nu : un vecteur de mailles/cm sur la même ligne ne devient pas le total', () => {
    const lignes = [
      "Répéter 4 fois jusqu'à avoir 20 (22, 24) m",
      'Repeat these 2 rows 5 times until work measures 30 (32, 34) cm',
      '40 (44, 48) m. Répéter 3 fois.',
    ]
    const steps = linesToSteps(lignes.map(L), { kind: 'dos', n: 3 })
    expect(steps.map((s) => s.total)).toEqual([[4, 4, 4], [5, 5, 5], [3, 3, 3]])
    expect(steps.every((s) => s.repeat)).toBe(true)
  })
  // « 2 x 2 » (côtes) n'est pas un compte de répétitions.
  it('« 2 x 2 rib » dans une répétition indéfinie ne fabrique pas de total', () => {
    const [step] = linesToSteps([L('Repeat rows 1-4 in 2 x 2 rib until piece measures 10 cm')], { kind: 'dos', n: 3 })
    expect(step.total).toBeUndefined()
    const [ok] = linesToSteps([L('Repeat rows 1-4 3 x.')], { kind: 'dos', n: 1 })
    expect(ok).toMatchObject({ repeat: true, total: [3] })
  })
  it('répétition mono-taille → total diffusé', () => {
    const steps = linesToSteps([L('Repeat rows 1-2 six… repeat 6 times')], { kind: 'corps', n: 2 })
    expect(steps[0].total).toEqual([6, 6])
  })
  it('forme abrégée « Rép. » → REP', () => {
    const steps = linesToSteps([L('Rép. ce tour 8 fois.')], { kind: 'corps', n: 2 })
    expect(steps[0]).toMatchObject({ repeat: true, total: [8, 8] })
  })
  // Bug corpus réel (diaphane-top-buttoned-shirt-fr-09bb8728, patrons Hobbii FR) : « Rép »
  // NON ponctué (ni « répéter » en toutes lettres, ni point) est la forme SYSTÉMATIQUE de ce
  // patron (« Rép rangs 1-2 pour... », « Rép tour 3... »), donc AUCUNE de ses >15 répétitions
  // chiffrées n'obtenait de compteur avant ce correctif — précisément sur les diminutions
  // d'encolure et rangs raccourcis d'épaule, là où une erreur de comptage coûte le plus cher.
  it('« Rép » non ponctué (sans point, sans "répéter" en toutes lettres) → REP', () => {
    const steps = linesToSteps([L('Rép ce rang pour 4 fois de plus.')], { kind: 'corps', n: 1 })
    expect(steps[0]).toMatchObject({ repeat: true, total: [4] })
  })
  it('non-régression : « Réparer »/« Répartir »/« Répondre » ne déclenchent jamais REP (rép exige une frontière de mot, pas un simple préfixe)', () => {
    const cases = [
      'Réparer 3 fois si nécessaire.',
      'Répartir 5 fois les diminutions.',
      'Répondre 10 fois au questionnaire.',
    ]
    for (const text of cases) {
      const steps = linesToSteps([L(text)], { kind: 'corps', n: 1 })
      expect(steps[0].repeat).toBeUndefined()
    }
  })
  // Convention Hobbii FR pour les vecteurs multi-tailles DANS une directive de répétition :
  // « <val taille 1> (<val taille 2>, …, <val taille n>) fois » — la parenthèse touche
  // directement « fois » (contrairement à « 8 (9) 10 fois », convention alternée testée plus
  // haut) : le nombre juste avant l'unité de comptage est DANS la parenthèse, pas hors d'elle.
  // Corpus réel : diminutions d'encolure (10 tailles), la répétition la plus coûteuse à rater.
  it('« Rép » non ponctué + vecteur multi-tailles « N (liste) fois » (corpus réel, diminutions encolure) → REP avec total par taille', () => {
    const line =
      "Continuer en mt, rép Rang Dim Encolure tous les rangs END pour 4 (3, 4, 6, 9, 14, 10, 11, 13, 16) fois de plus, ensuite rép Rang Dim Encolure tous les 6ème rang 9 (10, 10, 10, 10, 9, 11, 11, 11, 11) fois, finir avec un rang END."
    const steps = linesToSteps([L(line)], { kind: 'corps', n: 10 })
    expect(steps[0].repeat).toBe(true)
    expect(steps[0].total).toEqual([4, 3, 4, 6, 9, 14, 10, 11, 13, 16])
  })
  // Piège identifié en vérification (corpus réel, même patron, Manches) : une liste
  // parenthésée dont le compte total NE correspond PAS à n (ici 11 valeurs pour n=10, aléa du
  // PDF source) n'est PAS un vecteur reconnu par applySizeVectors (c reste vide). Sans garde,
  // le nombre isolé avant la parenthèse (« 4 ») serait diffusé à tort sur les 10 tailles —
  // un compteur FABRIQUÉ, contraire à la règle d'or de non-invention (§4.2).
  it('« Rép » non ponctué + liste parenthésée dont le compte NE correspond PAS à n → pas de compteur fabriqué (non-invention)', () => {
    const line = 'Rép Rangs raccourcis 3-4 pour 4 (5, 5, 6, 6, 7, 8, 10, 11, 12, 12) fois de plus.'
    const steps = linesToSteps([L(line)], { kind: 'manche', n: 10 })
    expect(steps[0].repeat).toBeUndefined()
  })
  // Bug corpus réel (mountaintop-pullover-es-b0cc556d) : la ligne porte DEUX vecteurs
  // multi-tailles complets — la durée en rangs (« rdas ») PUIS le nombre de répétitions
  // (« veces ») — et l'ancien code prenait systématiquement `c[0]` (le premier vecteur
  // rencontré, ici la durée), donnant un total de 17 au lieu de 2 pour la plus petite
  // taille. Le bon vecteur est celui qui précède réellement l'unité de comptage « veces ».
  it('deux vecteurs multi-tailles sur la même ligne (durée ET nombre de répétitions, ES « veces ») → le total prend le vecteur qui précède « veces », pas le premier de la ligne', () => {
    const line =
      'Rep las últimas 17 (11) 9 (12) 9 (7) 6 (5) 4 (4) rdas 2 (5) 8 (6) 9 (12) 14 (17) 20 (22) veces más.'
    const steps = linesToSteps([L(line)], { kind: 'corps', n: 10 })
    expect(steps[0].repeat).toBe(true)
    expect(steps[0].total).toEqual([2, 5, 8, 6, 9, 12, 14, 17, 20, 22])
  })
  it('section travail : ligne courte → ROW, paragraphe long → NOTE', () => {
    const long = 'x'.repeat(230)
    const steps = linesToSteps([L('Tricoter en jersey jusqu’à 20 cm.'), L(long)], { kind: 'corps', n: 1 })
    expect(steps[0].note).toBeUndefined()
    expect(steps[1].note).toBe(true)
  })
  it('section non-travail : tout en NOTE sauf rang explicite', () => {
    const steps = linesToSteps([L('Laver l’échantillon avant de mesurer.'), L('Rang 1 (END) : ML 22.')], { kind: 'echantillon', n: 1 })
    expect(steps[0].note).toBe(true)
    expect(steps[1].note).toBeUndefined()
  })
  it('non-invention : vecteur incohérent laissé verbatim', () => {
    const steps = linesToSteps([L('Rang 2 : 104 (108) m.')], { kind: 'corps', n: 3 })
    expect(steps[0].t).toBe('Rang 2 : 104 (108) m.')
    expect(steps[0].c).toEqual([])
  })

  // Légende de symbole de diagramme (« = <texte ≥3 lettres> ») glissée dans une section de
  // TRAVAIL (MANCHE/DeVant/ManChes du kit torsades) : c'est une note, pas un rang cochable —
  // sinon fausses étapes + dénominateur de progression gonflé. Coupe minimale volontaire.
  it('légende de symbole en section travail → NOTE, pas un rang', () => {
    const steps = linesToSteps([L('= 1 m. jersey envers')], { kind: 'manche', n: 1 })
    expect(steps[0].note).toBe(true)
    expect(steps[0].t).toBe('= 1 m. jersey envers')
  })
  it('annotation de taille « = uniquement pour… » en section travail → NOTE', () => {
    const steps = linesToSteps([L('= uniquement pour taille XL')], { kind: 'manche', n: 1 })
    expect(steps[0].note).toBe(true)
  })
  it('un vrai rang en section travail reste un RANG (pas note)', () => {
    const steps = linesToSteps([L('Rang 1 : monter 104 m.')], { kind: 'manche', n: 1 })
    expect(steps[0].note).toBeUndefined()
  })
  // Memory Game (ES, crochet) : « Fila » (rang à plat) manquait à côté de « Vuelta »
  // (tour en rond, déjà couvert) → moitié des rangs du patron non cochables. Le repli
  // « section travail + ligne courte » (l.52) masque le bug en section de travail (kind
  // non listé dans NON_WORK_KINDS) : il faut donc une section non-travail (kind par défaut
  // 'pelote', comme une section non reconnue par kindForTitle) pour isoler ROW_RE.
  it('« Fila N » (espagnol, rang à plat) est un RANG cochable comme « Vuelta », même en section non-travail', () => {
    const vuelta = linesToSteps([L('Vuelta 1: 6 pb en el 2do anillo desde el gancho.')], { kind: 'pelote', n: 1 })
    const fila = linesToSteps([L('Fila 1: 6 pb en el 2do anillo desde el gancho.')], { kind: 'pelote', n: 1 })
    expect(vuelta[0].note).toBeUndefined()
    expect(fila[0].note).toBeUndefined()
  })
  // (en revue) Ordinal anglais antéposé : ROW_START_RE (segment.js) le
  // reconnaît depuis le 27/08 (commit 8a3420dc, famille Yarnspirations/Bernat
  // « 1st row: … », « 2nd row: … »), mais la branche n'avait jamais été propagée à ROW_RE
  // — la règle de synchronisation documentée en tête de ce fichier (détection de section
  // et rendu ne doivent pas diverger) exigeait de la recevoir aussi. Même isolement que
  // « Fila » : section non-travail pour court-circuiter le repli « section travail ».
  it('« 1st row: » (ordinal anglais antéposé) est un RANG cochable, même en section non-travail', () => {
    const first = linesToSteps([L('1st row: (RS). 1 dc in each dc to end of row.')], { kind: 'pelote', n: 1 })
    const second = linesToSteps([L('2nd row: Ch 3 (counts as dc), turn.')], { kind: 'pelote', n: 1 })
    expect(first[0].note).toBeUndefined()
    expect(second[0].note).toBeUndefined()
  })
  it('non-régression : « 2 rows » sans suffixe ordinal ne devient pas un rang (compte, pas un marqueur)', () => {
    // Même contre-test que la branche ROW_START_RE de segment.js : sans suffixe ordinal
    // collé au chiffre, « 2 rows below… » (définition d’abréviation) reste une note.
    const steps = linesToSteps([L('2 rows below the armhole are worked in garter st.')], { kind: 'pelote', n: 1 })
    expect(steps[0].note).toBe(true)
  })
  it('« Filas N a M » (pluriel espagnol) est un RANG cochable, même en section non-travail', () => {
    const steps = linesToSteps([L('Filas 2 a 5: teje en pb alrededor.')], { kind: 'pelote', n: 1 })
    expect(steps[0].note).toBeUndefined()
  })
  // holiday-ornament-es-c3ac4214 (corpus réel, crochet, palier 6) : « Ronda »/« Rondas »
  // (mot de rang crochet ES très courant, en rond) manquait à ROW_RE. Conséquence observée
  // pire qu'une simple note : une incise « Repite { } N veces » DANS un rang non reconnu
  // comme tel se faisait à tort marquer compteur REP (« × », cf. steps.js l.42-49) au lieu
  // de rester un rang cochable normal — testé ici via ROW_RE en premier (priorité sur REP_RE).
  it('« Ronda N » (espagnol crochet, en rond) est un RANG cochable comme « Vuelta », même en section non-travail', () => {
    const steps = linesToSteps([L('Ronda 1: 6 pb en el círculo mágico.')], { kind: 'pelote', n: 1 })
    expect(steps[0].note).toBeUndefined()
  })
  it('« Ronda N » contenant une incise « Repite … veces » reste un RANG (pas un compteur REP parasite)', () => {
    const steps = linesToSteps([L('Ronda 2: [pa]. Repite { } 4 veces más. Pr en la parte superior (24).')], { kind: 'pelote', n: 1 })
    expect(steps[0].note).toBeUndefined()
    expect(steps[0].repeat).toBeUndefined()
  })
  it('« Rondas N a M » (pluriel espagnol) est un RANG cochable', () => {
    const steps = linesToSteps([L('Rondas 2 a 5: teje en pa alrededor.')], { kind: 'pelote', n: 1 })
    expect(steps[0].note).toBeUndefined()
  })
  // serenity-sweater-es-f1e18764 (corpus réel, tricot, palier 6) : « Vt » (abréviation
  // documentée de « Vuelta » dans le patron lui-même, | Vt | Vuelta |) manquait à ROW_RE.
  it('« Vt N » (espagnol tricot, abréviation de « Vuelta ») est un RANG cochable', () => {
    const steps = linesToSteps([L('Vt 1: *D1, r1, repite de * hasta el último pt, d1.')], { kind: 'pelote', n: 1 })
    expect(steps[0].note).toBeUndefined()
  })
  it('« Vts N » (pluriel) est un RANG cochable', () => {
    const steps = linesToSteps([L('Vts 4 del derecho, ida y vuelta.')], { kind: 'pelote', n: 1 })
    expect(steps[0].note).toBeUndefined()
  })
  // knit-domino-shawl-de-61747066 (corpus réel, Hobbii DE) : la convention de ce patron
  // écrit l'ordinal COLLÉ au point (« 1.Reihe (linke Seite): … »). La forme ESPACÉE
  // « 1. Reihe » est déjà un rang via NUM_ROW_RE, mais la collée n'était reconnue ni de
  // ROW_RE ni de NUM_ROW_RE : en section non-travail elle basculait en note, et même en
  // section travail sa nature de rang ne venait que du repli longueur (≤220), pas du
  // marqueur. Testée en kind non-travail ('pelote'), comme les cas Fila/Ronda ci-dessus,
  // pour isoler ROW_RE/NUM_ROW_RE du repli isWorkSection.
  it('« 1.Reihe (linke Seite) » (ordinal allemand collé, Hobbii DE) est un RANG cochable, même en section non-travail', () => {
    const steps = linesToSteps([L('1.Reihe (linke Seite): 1 M re abheben, re bis Ende der Nadel.')], { kind: 'pelote', n: 1 })
    expect(steps[0].note).toBeUndefined()
  })
  it('« 2.Runde »/« 1.Rd » (ordinal collé sur les autres mots de la branche) sont aussi des RANGS cochables', () => {
    expect(linesToSteps([L('2.Runde: 1 Rd fM an allen Rändern.')], { kind: 'pelote', n: 1 })[0].note).toBeUndefined()
    expect(linesToSteps([L('1.Rd re bis Nadelende.')], { kind: 'pelote', n: 1 })[0].note).toBeUndefined()
  })
  // bernadette-tote-bag-de-1e86ff98 (corpus réel, Hobbii DE, crochet) : « Rd » est
  // l'abréviation PRÉFIXE de « Runde » (« Rd 4: », « Rd 6: »…), déjà connue de
  // NEW_ITEM_RE (reflow.js) mais absente de ROW_RE — asymétrie documentée. Les longues
  // rondes de ce patron (>220 car., aucun vecteur) basculaient donc par le repli
  // longueur en note non cochable (« > ») en section non-travail.
  it('« Rd 6: … » (allemand, abréviation PRÉFIXE de « Runde », Hobbii DE) est un RANG cochable, même long et en section non-travail', () => {
    const long =
      'Rd 6: 1 Lm (zählt nicht als M), *(3 fM in den nächsten 3-Lm-Bg, 3 Lm, 2 Cluster und 1-Lm-Bg dazwischen üb) x 2, (3 Stb, 3 Lm, 3 Stb) in den nächsten 3-Lm-Bg, 3 Lm, 2 Cluster und 1-Lm-Bg dazwischen üb* 4-mal, die letzten 3 Lm auslassen, mit einem Stb mit der 1. fM verbinden (das Verbindungs-Stb zählt als letzter 3-Lm-Bg). (Insgesamt: 24 fM, 16 3-Lm-Bg, 24 Stb).'
    expect(long.length).toBeGreaterThan(220)
    const steps = linesToSteps([L(long)], { kind: 'pelote', n: 1 })
    expect(steps[0].note).toBeUndefined()
    expect(steps[0].repeat).toBeUndefined()
  })
  it('D1 vague 2 : paragraphe >220 car. avec « : Crocheter … » reste cochable en section travail', () => {
    const long = 'Avant le marqueur: Crocheter jusqu’à ce qu’il reste 2 mailles serrées avant le marqueur, crocheter 2 mailles serrées dans la première maille serrée, puis 1 maille serrée dans la maille suivante, tourner'.repeat(2)
    expect(long.length).toBeGreaterThan(220)
    const [step] = linesToSteps([{ text: long }], { kind: 'corps', n: 1 })
    expect(step.note).toBeUndefined()
  })
  it('non-régression : « Rd » sans chiffre qui suit reste une note en section non-travail', () => {
    const steps = linesToSteps([L('Rd. für Runde, M für Masche.')], { kind: 'pelote', n: 1 })
    expect(steps[0].note).toBe(true)
  })
  it('non-régression : « 1. Reihe » ESPACÉ reste un RANG cochable (déjà couvert par NUM_ROW_RE)', () => {
    const steps = linesToSteps([L('1. Reihe (linke Seite): rechts bis Nadelende')], { kind: 'pelote', n: 1 })
    expect(steps[0].note).toBeUndefined()
  })
  it('non-régression : ordinal collé + mot NON-rang, ou numéro de liste nu, ne sont PAS des rangs en section non-travail', () => {
    // Contre-tests de la branche ordinale collée : le mot de rang (reihe/runde/rd) est
    // EXIGÉ après le point — « 1.Masche »/« 3.Stb » (ordinal + nom non-rang) et un
    // numéro de liste nu « 1. » ne matchent jamais, la ligne reste une note hors
    // section travail, exactement comme avant le correctif.
    expect(linesToSteps([L('1.Masche abheben, re bis Ende.')], { kind: 'pelote', n: 1 })[0].note).toBe(true)
    expect(linesToSteps([L('3.Stb in dieselbe Masche häkeln.')], { kind: 'pelote', n: 1 })[0].note).toBe(true)
    expect(linesToSteps([L('1.')], { kind: 'pelote', n: 1 })[0].note).toBe(true)
  })
  it('non-régression : « vt » en milieu de phrase (pas en tête de ligne) ne devient jamais un rang à tort', () => {
    const steps = linesToSteps([L('Consulte le tableau vt 2 fois si besoin, avant de continuer.')], { kind: 'pelote', n: 1 })
    // Ni ROW_RE (pas en tête de ligne) ni REP_RE (pas de « répéter »/« veces ») ne doivent
    // matcher : la ligne de prose simple, en section non-travail, doit rester une NOTE.
    expect(steps[0].note).toBe(true)
    expect(steps[0].repeat).toBeUndefined()
  })
  it('instruction normale (non-légende) en section travail reste un RANG', () => {
    const steps = linesToSteps([L('Tricoter en jersey jusqu’à 20 cm.')], { kind: 'manche', n: 1 })
    expect(steps[0].note).toBeUndefined()
  })
  it('cote « taille M = 60 m. » (le = n’est PAS en tête) reste un RANG', () => {
    const steps = linesToSteps([L('taille M = 60 m.')], { kind: 'manche', n: 1 })
    expect(steps[0].note).toBeUndefined()
  })
  it('frontière : « = 60 m. » (pas 3 lettres consécutives) reste un RANG', () => {
    const steps = linesToSteps([L('= 60 m.')], { kind: 'manche', n: 1 })
    expect(steps[0].note).toBeUndefined()
  })
  it('non-régression : légende en section NON-travail reste NOTE', () => {
    const steps = linesToSteps([L('= 1 m. jersey envers')], { kind: 'diagramme', n: 1 })
    expect(steps[0].note).toBe(true)
  })

  // Bug systémique (tests en cours, 4e signalement) : les titres génériques
  // sans famille anatomique/fonctionnelle (« Instructions » fr, « PIEZA DELANTERA/
  // TRASERA » es, « Träger »/« Armausschnitt » de) retombent en kind='pelote' (repli
  // segment.js l.351). `pelote` ET `autre` étaient TOUS LES DEUX dans NON_WORK_KINDS →
  // toute ligne de prose (pas explicitement un rang chiffré) y devenait une remarque `>`
  // non cochable. Or {other} (= 'autre') est documenté par le dialecte comme un kind de
  // TRAVAIL légitime ("en cas de doute → other") — confirmé empiriquement par la
  // référence réelle summer-sea-top-fr : « ## Bretelles {other} » avec CHAQUE
  // ligne (y compris de la prose simple comme « Coupez, nouez et cachez votre fil de
  // travail. ») rendue en puce `-` cochable, jamais en remarque `>`. `autre` doit donc
  // sortir de NON_WORK_KINDS ; `pelote` y reste (repli par défaut, section non reclassée
  // faute de tout rang réel — cf. reclassification post-hoc de segment.js).
  it('NON_WORK_KINDS ne contient plus "autre" ({other} est un kind de travail légitime, cf. dialecte + fixture summer-sea-top-fr « Bretelles »)', () => {
    expect(NON_WORK_KINDS.has('autre')).toBe(false)
    expect(NON_WORK_KINDS.has('pelote')).toBe(true)
    expect(NON_WORK_KINDS.has('echantillon')).toBe(true)
    expect(NON_WORK_KINDS.has('diagramme')).toBe(true)
  })
  it('kind "autre" : une ligne de prose SIMPLE (pas un rang) devient cochable, plus une remarque', () => {
    const steps = linesToSteps([L('Coupez, nouez et cachez votre fil de travail.')], { kind: 'autre', n: 1 })
    expect(steps[0].note).toBeUndefined()
  })
  it('kind "pelote" (repli par défaut, resté non-travail) : la même ligne de prose reste une remarque', () => {
    const steps = linesToSteps([L('Coupez, nouez et cachez votre fil de travail.')], { kind: 'pelote', n: 1 })
    expect(steps[0].note).toBe(true)
  })

  // Bug corpus réel (mesuré le 2026-08-27, DROPS ~110 PDF du corpus) : chaque tour y est
  // rédigé en paragraphe continu de 250-450 caractères (pas de « Rang N : » explicite).
  // Le plafond `src.length <= 220` bascule tout le travail réel en notes non cochables
  // (to-the-beach-fr-c33da181, sections SAC/ANSES). Le paragraphe commence par un verbe
  // de construction reconnu (« Crocheter… ») : ce n'est pas une explication mais une
  // vraie instruction, donc cochable même long.
  it('long paragraphe de travail avec verbe de construction (DROPS, pas de "Rang N :") → RANG cochable malgré >220 car.', () => {
    // to-the-beach-fr-c33da181, section ANSES (corpus réel) : ni ROW_RE (pas de « Rang N »)
    // ni REP_RE (pas de « fois »/« veces ») ne matchent — seul le verbe de construction en
    // tête (« Crocheter ») distingue cette instruction réelle d'un paragraphe d'explication.
    const long =
      "Crocheter 1 maille serrée dans chacune des 12 premières mailles serrées, crocheter 58 mailles en l'air, sauter 12 mailles serrées, crocheter 1 maille serrée dans chacune des 24 mailles serrées suivantes, crocheter 58 mailles en l'air, sauter 12 mailles serrées, crocheter 1 maille serrée dans chacune des 12 dernières mailles serrées."
    expect(long.length).toBeGreaterThan(220)
    const steps = linesToSteps([L(long)], { kind: 'autre', n: 1 })
    expect(steps[0].repeat).toBeUndefined()
    expect(steps[0].note).toBeUndefined()
  })

  // Bug corpus réel (diaphane-top-buttoned-shirt-fr-09bb8728) : « Rang de mise en place N »
  // ne matche pas ROW_RE (mots interposés entre « Rang » et le chiffre) ; côté DOS (5
  // sections Fil A/Fil B) le même gabarit dépasse 220 caractères et devient une note, alors
  // que la version plus courte (DEVANT, 2 sections) reste cochable — incohérence entre
  // pièces symétriques. La ligne ne contient aucun verbe de construction reconnu, mais elle
  // porte un vecteur multi-tailles cohérent (n=10) : c'est un signal de rang réel fiable
  // (même règle de non-invention qu'ailleurs dans ce fichier).
  it('long rang de comptage de mailles sans verbe reconnu, mais avec vecteur multi-tailles cohérent (diaphane DOS) → RANG cochable malgré >220 car.', () => {
    const long =
      "Rang de mise en place 1 (END): 19 (22) 24 (27) 30 (33) 38 (44) 47 (48) m end avec Fil A, 3 m end avec Fil B, 17 (18) 21 (22) 24 (25) 26 (27) 28 (30) m end avec Fil A, 3 m end avec Fil B, 13 (15) 17 (23) 19 (19) 23 (17) 21 (27) m end avec Fil A, 3 m end avec Fil B, 17 (18) 21 (22) 24 (25) 26 (27) 28 (30) m end avec Fil A, 3 m end avec Fil B, 19 (22) 24 (27) 30 (33) 38 (44) 47 (48) m end avec Fil A."
    expect(long.length).toBeGreaterThan(220)
    const steps = linesToSteps([L(long)], { kind: 'corps', n: 10 })
    expect(steps[0].note).toBeUndefined()
    expect(steps[0].c.length).toBeGreaterThan(0)
  })

  // Non-régression (corpus réel lollipop-dream-top-es-6be67c67, section {neckline}, kind de
  // travail) : une note conditionnelle/conseil (« Ajusta… si… ») n'a ni verbe de construction
  // reconnu (« Ajusta » n'est pas dans le vocabulaire fermé ES_VERB_RE) ni vecteur
  // multi-tailles — elle doit rester une remarque non cochable même en section de travail,
  // preuve que le nouveau critère ne bascule pas tout long texte en rang.
  it('non-régression : longue remarque conditionnelle sans verbe reconnu ni vecteur, en section de travail → reste NOTE', () => {
    const long =
      'NOTA: Ajusta el número de cadenetas si el top es demasiado ancho en el escote y/o las sisas. Por ejemplo, para crear una vuelta de 4 cadenetas alrededor del escote y/o las sisas, seguida de una vuelta de 3 cadenetas, sigue ajustando hasta que consigas el ajuste deseado.'
    expect(long.length).toBeGreaterThan(220)
    const steps = linesToSteps([L(long)], { kind: 'neckline', n: 1 })
    expect(steps[0].note).toBe(true)
  })
})

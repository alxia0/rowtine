import { describe, it, expect } from 'vitest'
import { detectEaseHint, consumeEaseHintLine } from '@/utils/pdf-import/ease'

// Sections au format segmentSections/reflowLines (cf. assemble.js) : { ref, lines: [{ text }] }.
const sec = (ref, lines) => ({ ref, lines: lines.map((text) => ({ text })) })

describe('detectEaseHint', () => {
  // Phrases RÉELLES d'un corpus de 40 patrons (palier 8/8 + passage complet du corpus) —
  // non inventées.
  it('FR « aisance » (nahia-sweater-fr, aisance positive chiffrée)', () => {
    const sections = [sec('mesures', [
      'Largeur du Devant/Dos: (48, 54, 61) (68, 74, 81) (88, 94, 101) cm',
      'Le pull est conçu pour être porté avec une aisance positive entre 15 - 30 cm autour du buste. Si vous souhaitez un vêtement plus ajusté, choisissez une taille plus petite. Le modèle porte une taille 3.',
    ])]
    expect(detectEaseHint(sections)).toBe(
      'Le pull est conçu pour être porté avec une aisance positive entre 15 - 30 cm autour du buste. Si vous souhaitez un vêtement plus ajusté, choisissez une taille plus petite. Le modèle porte une taille 3.',
    )
  })

  it('DE « Bewegungsspielraum » (picnic-children-s-top-de, correctif ciblé de ce lot)', () => {
    const sections = [sec('mesures', [
      'Weite: 55 (60, 64,5, 69) (73,5, 78) cm',
      'Länge: 31,5 (34, 36, 38,5) (40,5, 44) cm',
      'Das Stück ist mit einem Bewegungsspielraum von 2-7 cm konzipiert.',
    ])]
    expect(detectEaseHint(sections)).toBe('Das Stück ist mit einem Bewegungsspielraum von 2-7 cm konzipiert.')
  })

  it('DE « Ease » (mountaintop-pullover-de, emprunt anglais utilisé tel quel en allemand)', () => {
    const sections = [sec('mesures', ['Dieser Pullover ist mit einer positiven Ease von 5-10 cm entworfen.'])]
    expect(detectEaseHint(sections)).toBe('Dieser Pullover ist mit einer positiven Ease von 5-10 cm entworfen.')
  })

  it('DE « eng anliegend » (ellie-summer-top-de, aisance qualitative SANS valeur chiffrée)', () => {
    const sections = [sec('mesures', ['Das Top ist eng anliegend.'])]
    expect(detectEaseHint(sections)).toBe('Das Top ist eng anliegend.')
  })

  it('EN « ease » (umber-cloud-sweater-en)', () => {
    const sections = [sec('mesures', ['Designed with 30 cm / 12 inches of positive ease.'])]
    expect(detectEaseHint(sections)).toBe('Designed with 30 cm / 12 inches of positive ease.')
  })

  it('ES « holgura » (cotton-candy-dot-children-s-sweater-es)', () => {
    const sections = [sec('mesures', ['El jersey está diseñado para llevarlo con una holgura positiva de 5 a 10 cm.'])]
    expect(detectEaseHint(sections)).toBe('El jersey está diseñado para llevarlo con una holgura positiva de 5 a 10 cm.')
  })

  it('non-régression : section mesures purement numérique, aucune mention d’aisance → vide', () => {
    const sections = [sec('mesures', [
      'Brustumfang: 87,5 (95) 103 (110,5) 120 (127,5) 135 (145) cm',
      'Länge: 58 (58,5) 60 (60,5) 63 (64,5) 66,5 (68) cm',
    ])]
    expect(detectEaseHint(sections)).toBe('')
  })

  it('non-régression : aucune section mesures du tout → vide', () => {
    expect(detectEaseHint([sec('fil', ['Friends Cotton 8/6, Hobbii'])])).toBe('')
    expect(detectEaseHint([])).toBe('')
    expect(detectEaseHint(undefined)).toBe('')
  })

  it('non-régression : le mot-vocabulaire dans une section HORS mesures est ignoré (pas de faux positif hors périmètre)', () => {
    // ex. réel : la même phrase d'aisance ressurgit verbatim dans une section « INFO ET
    // CONSEILS » (ref=null) plus loin dans nahia-sweater-fr — ce n'est PAS là qu'elle doit
    // être captée (elle survit déjà verbatim dans le corps) ;
    // seule la section mesures alimente easeHint.
    const sections = [
      sec('mesures', ['Largeur du Devant/Dos: (48, 54, 61) cm']),
      sec(null, ['Le pull est conçu pour être porté avec une aisance positive entre 15 - 30 cm.']),
    ]
    expect(detectEaseHint(sections)).toBe('')
  })

  it('ne confond pas un mot anglais courant contenant « ease » en sous-chaîne (increase/decrease/please/release)', () => {
    const sections = [sec('mesures', [
      'Increase 4 sts every other row, then decrease and release evenly, please.',
    ])]
    expect(detectEaseHint(sections)).toBe('')
  })

  it('première occurrence retenue si plusieurs sections mesures matchent', () => {
    const sections = [
      sec('mesures', ['1 (2) 3 (4)']),
      sec('mesures', ['Positive ease of approx 2-5 cm.']),
    ]
    expect(detectEaseHint(sections)).toBe('Positive ease of approx 2-5 cm.')
  })
})

describe('detectEaseHint — hors du bloc mesures', () => {
  // Phrase REELLE de Mia Cardigan (English) v1.1, page 2, rangee par le moteur dans la
  // section « Gauge » (ref='echantillon') et non dans « Sizes » (ref='mesures').
  it('EN, phrase d’aisance tombee dans le bloc echantillon', () => {
    const sections = [sec('echantillon', [
      '21 sts x 28 rows in stockinette stitch on 4mm needles = 10 x 10 cm after blocking',
      'Size guide',
      'Mia Cardigan is designed to have approximately 21-22.5 cm of positive ease, meaning it is designed to be approximately 21-22.5 cm larger in circumference than your bust measurement.',
    ])]
    expect(detectEaseHint(sections)).toBe(
      'Mia Cardigan is designed to have approximately 21-22.5 cm of positive ease, meaning it is designed to be approximately 21-22.5 cm larger in circumference than your bust measurement.',
    )
  })

  it('une section de TRAVAIL (ref null) reste hors du balayage', () => {
    const sections = [{ ref: null, lines: [{ text: 'Work with ease until 20 cm.' }] }]
    expect(detectEaseHint(sections)).toBe('')
  })

  it('le vocabulaire ferme reste le garde-fou', () => {
    const sections = [sec('echantillon', ['Please increase 4 sts on the next row.'])]
    expect(detectEaseHint(sections)).toBe('')
  })

  it('le bloc mesures garde la priorite quand les deux portent une phrase', () => {
    const sections = [
      sec('echantillon', ['Designed with 10 cm of positive ease.']),
      sec('mesures', ['Designed with 30 cm of positive ease.']),
    ]
    expect(detectEaseHint(sections)).toBe('Designed with 30 cm of positive ease.')
  })
})

describe('consumeEaseHintLine — la ligne promue ne doit plus ressurgir dans le corps', () => {
  // Reproduit le doublon reel : la phrase, une fois promue en ease:, restait aussi
  // dans reference.gauge (deversee verbatim par extractReference() pour toute section
  // ref==='echantillon' non consommee, cf. reference.js:1261) -> rendue une 2e fois
  // sous « ## Echantillon {gauge} ».
  it('marque consumed sur la ligne EXACTE trouvee par detectEaseHint, dans une section echantillon', () => {
    const gaugeLine = { text: 'Gauge line, untouched.' }
    const easeLine = {
      text: 'Mia Cardigan is designed to have approximately 21-22.5 cm of positive ease.',
    }
    const sections = [{ ref: 'echantillon', lines: [gaugeLine, easeLine] }]
    const returned = consumeEaseHintLine(sections)
    expect(returned).toBe(easeLine.text)
    expect(easeLine.consumed).toBe(true)
    expect(gaugeLine.consumed).toBeUndefined()
  })

  it('ne marque rien quand detectEaseHint ne trouve rien (pas d’effet de bord)', () => {
    const line = { text: 'Please increase 4 sts on the next row.' }
    const sections = [{ ref: 'echantillon', lines: [line] }]
    expect(consumeEaseHintLine(sections)).toBe('')
    expect(line.consumed).toBeUndefined()
  })

  it('le bloc mesures garde la priorite : seule SA ligne est consommee, pas le doublon en echantillon', () => {
    const echantillonLine = { text: 'Designed with 10 cm of positive ease.' }
    const mesuresLine = { text: 'Designed with 30 cm of positive ease.' }
    const sections = [
      { ref: 'echantillon', lines: [echantillonLine] },
      { ref: 'mesures', lines: [mesuresLine] },
    ]
    expect(consumeEaseHintLine(sections)).toBe(mesuresLine.text)
    expect(mesuresLine.consumed).toBe(true)
    expect(echantillonLine.consumed).toBeUndefined()
  })

  it('consumeEaseHintLine et detectEaseHint trouvent toujours la meme ligne (meme scan partage)', () => {
    const sections = [sec('echantillon', [
      '21 sts x 28 rows in stockinette stitch on 4mm needles = 10 x 10 cm after blocking',
      'Size guide',
      'Mia Cardigan is designed to have approximately 21-22.5 cm of positive ease, meaning it is designed to be approximately 21-22.5 cm larger in circumference than your bust measurement.',
    ])]
    expect(consumeEaseHintLine(sections)).toBe(detectEaseHint(sections))
  })
})

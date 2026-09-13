import { describe, it, expect } from 'vitest'
import { isLetterSpaced, despace, restoreWords } from '@/utils/pdf-import/spaced-title'

describe('isLetterSpaced', () => {
  it('reconnait un titre interlettre reel', () => {
    expect(isLetterSpaced('M I A C A R D I G A N')).toBe(true)
    expect(isLetterSpaced('C O C O A M O U R K N I T W E A R')).toBe(true)
    expect(isLetterSpaced('Q U A L I F I É E')).toBe(true)
  })

  it('ne reconnait pas un texte normal', () => {
    expect(isLetterSpaced('Mia Cardigan')).toBe(false)
    expect(isLetterSpaced('Sizes:')).toBe(false)
    expect(isLetterSpaced('Bust circumference of finished garment')).toBe(false)
  })
})

describe('despace', () => {
  it('recolle les lettres isolees', () => {
    expect(despace('M I A C A R D I G A N')).toBe('MIACARDIGAN')
    expect(despace('C O C O A M O U R K N I T W E A R')).toBe('COCOAMOURKNITWEAR')
  })
})

describe('restoreWords', () => {
  // Fiche d’identite REELLE du PDF Mia Cardigan (English) v1.1.
  const META = 'Microsoft Word - Mia Cardigan (English) v1.1.docx'

  it('retrouve la decoupe en mots dans la fiche d’identite', () => {
    expect(restoreWords('MIACARDIGAN', META)).toBe('Mia Cardigan')
  })

  it('rend null quand les lettres ne correspondent pas', () => {
    expect(restoreWords('AUTRETITRE', META)).toBeNull()
  })

  it('rend null sans fiche d’identite', () => {
    expect(restoreWords('MIACARDIGAN', '')).toBeNull()
    expect(restoreWords('MIACARDIGAN', null)).toBeNull()
  })

  it('n’invente rien : une correspondance partielle ne suffit pas', () => {
    expect(restoreWords('MIACARDIGANXL', META)).toBeNull()
  })

  // Garde de borne (metaTitle vient de `doc.getMetadata().info.Title`, une chaîne
  // ARBITRAIRE du PDF — jamais bornée par le moteur en amont). Assertion STRUCTURELLE,
  // pas temporelle : plutôt qu'un seuil de temps (instable selon la machine), on prouve
  // directement que la borne coupe l'entrée en construisant une correspondance qui existe
  // UNIQUEMENT au-delà d'elle — si la borne saute (élargie ou retirée), ce témoin devient
  // faux négatif (il attend `null`, la fonction trouverait la correspondance) et rougit.
  it('une correspondance au-dela de la borne n’est pas trouvee (mais rend toujours null, jamais une exception)', () => {
    const padding = 'A'.repeat(305) // > 300 : pousse "Test Word" hors de la tranche bornee
    const beyond = `${padding} Test Word`
    expect(restoreWords('TESTWORD', beyond)).toBeNull()
  })

  it('une correspondance EN-DECA de la borne est trouvee normalement', () => {
    const padding = 'A'.repeat(50) // tres en-deca de 300
    const within = `${padding} Test Word`
    expect(restoreWords('TESTWORD', within)).toBe('Test Word')
  })

  it('ne gele pas sur une entree longue (5000 caracteres) : reste sous une marge large', () => {
    const long = 'x'.repeat(5000)
    const t0 = performance.now()
    const result = restoreWords('MIACARDIGAN', long)
    const elapsed = performance.now() - t0
    expect(result).toBeNull()
    // Marge tres large (mesure reelle avant correctif a 5000 caracteres : plusieurs
    // secondes ; apres correctif, quelques ms) : seuil choisi pour ne jamais devenir
    // instable selon la machine, seulement pour attraper une regression grossiere.
    expect(elapsed).toBeLessThan(500)
  })
})

import { detectTitle } from '@/utils/pdf-import/segment'

const P = (text, size, y) => ({ text, size, bold: false, y })

describe('detectTitle — titre interlettre', () => {
  // Geometrie REELLE de la page 1 de Mia Cardigan (English) v1.1.
  const PAGES = [[
    P('C O C O A M O U R K N I T W E A R', 10.1, 796.3),
    P('M I A C A R D I G A N', 28.1, 753.8),
    P('Share your version of the Mia Cardigan on social media with hashtags', 10.1, 200),
  ], [
    P('Sizes:', 10.1, 780),
    P('1 (2, 3, 4, 5) (6, 7, 8, 9) 10, 11', 10.1, 766),
  ]]

  it('retrouve « Mia Cardigan » via la fiche d’identite du PDF', () => {
    expect(detectTitle(PAGES, { metaTitle: 'Microsoft Word - Mia Cardigan (English) v1.1.docx' }))
      .toBe('Mia Cardigan')
  })

  it('sans fiche d’identite, garde la ligne verbatim et JAMAIS « MIACARDIGAN »', () => {
    const t = detectTitle(PAGES, {})
    expect(t).toBe('M I A C A R D I G A N')
    expect(t).not.toBe('MIACARDIGAN')
  })

  it('ne retient plus « Sizes: » comme titre', () => {
    expect(detectTitle(PAGES, {})).not.toBe('Sizes:')
  })

  it('un tampon de difficulte en PETITE taille reste ecarte', () => {
    const AVEC_TAMPON = [[
      P('Q U A L I F I É E', 9, 800),
      P('Pull Torsades', 24, 760),
    ]]
    expect(detectTitle(AVEC_TAMPON, {})).toBe('Pull Torsades')
  })
})

import { describe, it, expect } from 'vitest'
import { toPaperNotation } from '@/utils/pdf-import/sizes'
import { extractReference } from '@/utils/pdf-import/reference'

const L = (text) => ({ text, size: 10, bold: false, y: 0 })
const sec = (title, ref, texts, kind = 'pelote') => ({ title, kind, ref, lines: texts.map(L) })

describe('toPaperNotation', () => {
  it('reecrit un vecteur groupe par le PDF en notation alternee', () => {
    expect(toPaperNotation('97 (102.5, 106.5, 112, 116) (121.5, 131, 142.5, 152) 161.5, 171 cm', 11))
      .toBe('97 (102.5) 106.5 (112) 116 (121.5) 131 (142.5) 152 (161.5) 171 cm')
  })

  it('reecrit les DEUX vecteurs d’une meme ligne', () => {
    const src = '300 (300, 350, 350, 350) (400, 400, 400, 450) 500, 500 g A held together with 150 (150, 150, 150, 150) (150, 200, 200, 200) 200, 200 g B'
    const out = toPaperNotation(src, 11)
    expect(out).toContain('300 (300) 350 (350) 350 (400) 400 (400) 450 (500) 500 g A')
    expect(out).toContain('150 (150) 150 (150) 150 (150) 200 (200) 200 (200) 200 g B')
  })

  it('laisse verbatim un vecteur INCOMPLET', () => {
    const src = '150) (150, 200, 200, 200) 200, 200 g'
    expect(toPaperNotation(src, 11)).toBe(src)
  })

  it('laisse verbatim quand il n’y a qu’une taille', () => {
    expect(toPaperNotation('90 mailles', 1)).toBe('90 mailles')
  })

  it('n’invente aucune valeur', () => {
    const out = toPaperNotation('21.5 (22, 22, 23, 23.5) (23.5, 23.5, 24.5, 25) 25, 25.5 cm', 11)
    expect(out.match(/\d+(?:\.\d+)?/g)).toHaveLength(11)
  })
})

describe('toPaperNotation — \\n est une frontière', () => {
  // findSizeVectors traite \n comme un \s ordinaire : sans frontière explicite, un nombre
  // en fin d'une ligne joint(\n) peut se lier au groupe de la ligne SUIVANTE et fabriquer
  // un vecteur qui n'existe dans AUCUNE des deux lignes prise seule. Vérifié : AVANT ce
  // garde, `findSizeVectors('Cast on 10\n(15, 20) mm')` rend déjà un vecteur à 3 valeurs
  // [10, 15, 20] qui fusionne les deux lignes. toPaperNotation reçoit précisément ce genre
  // de texte joint (`needles.join('\n')`, `yarns.join('\n')`, `gaugeLines.join('\n')`).
  it('ne fusionne pas un nombre de fin de ligne avec un groupe de la ligne suivante', () => {
    const src = 'Cast on 10\n(15, 20) mm'
    // Chaque ligne prise seule est incomplète pour n=3 (10 seul : pas de groupe ; (15, 20)
    // seul : 2 valeurs) → verbatim, comme un vrai vecteur incomplet.
    expect(toPaperNotation(src, 3)).toBe(src)
  })

  it('reecrit quand meme un vecteur complet CONTENU DANS UNE SEULE ligne d’un texte multi-lignes', () => {
    const src = '4 mm\n5 (5, 6, 6) 7 mm'
    expect(toPaperNotation(src, 5)).toBe('4 mm\n5 (5) 6 (6) 7 mm')
  })
})

// Test d'INTÉGRATION (câblage) : toPaperNotation est prouvée pure ci-dessus, mais rien
// ne prouvait que reference.js l'appelle vraiment sur les 4 blocs. Un refactor qui
// retirerait les 4 appels (dans extractReference, au moment de construire l'objet passé
// à buildReference) laissait la suite 595/595 verte — aucun test n'assertionnait le
// TEXTE RÉEL d'un bloc référence. Ici on passe par extractReference (le vrai point
// d'entrée du moteur pour ces blocs, pas un appel direct à toPaperNotation) et on lit le
// texte final dans reference.tabs, exactement ce que l'app affiche.
describe('extractReference — notation papier cablee sur les 4 blocs', () => {
  it('reecrit Echantillon/Aiguilles/Fil/Materiel en notation alternee (pas seulement toPaperNotation en isolation)', () => {
    const sections = [
      sec('ÉCHANTILLON', 'echantillon', ['21 (21, 22, 22) 23 mailles pour 10 cm']),
      sec('AIGUILLES', 'aiguilles', ['Aiguilles circulaires 4 (4, 4.5, 4.5) 5 mm']),
      sec('FIL', 'fil', ['300 (300, 350, 350) 400 g laine']),
      sec('MATÉRIEL', 'materiel', ['6 (6, 7, 7) 8 boutons']),
    ]
    const { reference } = extractReference(sections, { n: 5 })
    const mat = reference.tabs.find((t) => t.id === 'materiel')
    const textOf = (h3) => mat.blocks.find((b) => b.h3 === h3).p.join('\n')

    expect(textOf('Échantillon')).toBe('21 (21) 22 (22) 23 mailles pour 10 cm')
    expect(textOf('Aiguilles/Crochet')).toBe('Aiguilles circulaires 4 (4) 4.5 (4.5) 5 mm')
    expect(textOf('Fil')).toBe('300 (300) 350 (350) 400 g laine')
    expect(textOf('Matériel')).toBe('6 (6) 7 (7) 8 boutons')

    // Non-régression explicite : la notation groupée du PDF ne doit PLUS apparaître.
    expect(textOf('Fil')).not.toContain('(300, 350, 350)')
  })
})

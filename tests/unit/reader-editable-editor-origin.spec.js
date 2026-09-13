import { describe, it, expect } from 'vitest'
import { mdToPattern } from '@/utils/pattern-md/parse'
import { retagLine } from '@/utils/pattern-md/md-retag'
import { readerToEditable, editableToReader } from '@/utils/pattern-md/reader-editable'

// BUG #2 (reader-editable.js) : quand la travailleuse retague une ligne en
// « Compteur = 5 » ({×5}), le parse pur donne bien total=5 avec origin:'editor'.
// Mais carveUneditedSteps voit le texte « papier » identique (le marqueur {×5} et
// le « 5 times » de la prose sont hors signature) → il juge la ligne NON éditée et
// restaure le step d'origine (total stocké 80). Le correctif : un step d'origine
// ÉDITEUR prime sur le carving (saute restore ET rescueRepeatTotal).
const N = 9
const FAULTY = 'Repeat R 1-2 in total 5 times (= 80 (80) 80 (82) 82 (82) 84 (84) 84 sts).'
const HEAD = [
  '---',
  'rowtine: 1',
  'title: Roni',
  'sizes: XS · S · M · L · XL · 2XL · 3XL · 4XL · 5XL',
  '---',
  '',
  '## Yoke {yoke}',
  '',
].join('\n')
const repStep = (reader) => {
  for (const sec of reader.sections) for (const st of sec.steps || []) if (st.repeat) return st
  return null
}

// Reader « stocké » (import antérieur, avant tout correctif) : total figé à
// `storedTotal`, SANS tag de provenance éditeur.
function baseReaderWithStoredTotal(storedTotal) {
  const reader = mdToPattern(HEAD + '- × ' + FAULTY + '\n').pattern.reader
  const st = repStep(reader)
  st.total = storedTotal
  delete st.origin
  return reader
}

describe('BUG #2 — un compteur {×N} posé dans l’éditeur prime sur le carving', () => {
  it('la correction « Compteur = 5 » survit à l’enregistrement (ne réaffiche PAS le total stocké 80)', () => {
    const baseReader = baseReaderWithStoredTotal(Array(N).fill(80))
    // L'éditeur dérive le MD du reader, la travailleuse retague la ligne en {×5}.
    const { md: editableMd } = readerToEditable(baseReader)
    const editedMd = editableMd
      .split('\n')
      .map((l) => (l.includes('Repeat R 1-2') && l.trim().startsWith('- ') ? retagLine(l, 'compteur-rep', { times: 5 }) : l))
      .join('\n')
    // Enregistrement = editableToReader(md, baseReader) (comme CorrectionView).
    const { reader } = editableToReader(editedMd, baseReader)
    const st = repStep(reader)
    expect(st.origin).toBe('editor')
    expect(st.total).toEqual(Array(N).fill(5))
  })

  it('le compteur éditeur écrase même un total stocké « lossy » (total ≠ mailles) sans faux avertissement', () => {
    // storedTotal ≠ c[0] : sans le garde origin, rescueRepeatTotal ré-imposerait le
    // total stocké ET remainingCarveLoss pousserait un avertissement mensonger.
    const baseReader = baseReaderWithStoredTotal([9, 9, 9, 9, 9, 9, 9, 9, 9])
    const { md: editableMd } = readerToEditable(baseReader)
    const editedMd = editableMd
      .split('\n')
      .map((l) => (l.includes('Repeat R 1-2') && l.trim().startsWith('- ') ? retagLine(l, 'compteur-rep', { times: 7 }) : l))
      .join('\n')
    const { reader, warnings } = editableToReader(editedMd, baseReader)
    const st = repStep(reader)
    expect(st.total).toEqual(Array(N).fill(7))
    expect(warnings).toEqual([])
  })

  it('base LOSSY + retag {×7} + retouche de prose : le total éditeur tient SANS faux avertissement de perte-total', () => {
    // Finding 2 (chemin ÉDITÉ) : storedTotal ≠ c[0] (lossy) → remainingCarveLoss entre
    // dans la branche total ; le retag {×7} ET la retouche de prose changent la signature
    // → chemin rescueRepeatTotal (pas restore). rescueRepeatTotal saute déjà (origin
    // éditeur), donc le total éditeur [7…] survit ; mais SANS le court-circuit du message,
    // remainingCarveLoss poussait « le total n'a pas pu être conservé » À TORT (la valeur
    // [7] est CHOISIE, pas perdue). Les comptes de mailles (c) restant intacts (prose seule
    // retouchée), c'est bien le cas « éditeur authoritative » → aucun avertissement attendu.
    const N = 9
    const baseReader = baseReaderWithStoredTotal([9, 9, 9, 9, 9, 9, 9, 9, 9])
    const { md: editableMd } = readerToEditable(baseReader)
    const editedMd = editableMd
      .split('\n')
      .map((l) => (l.includes('Repeat R 1-2') && l.trim().startsWith('- ')
        ? retagLine(l, 'compteur-rep', { times: 7 }).replace('Repeat R 1-2', 'Redo R 1-2')
        : l))
      .join('\n')
    const { reader, warnings } = editableToReader(editedMd, baseReader)
    const st = repStep(reader)
    expect(st.origin).toBe('editor')
    expect(st.total).toEqual(Array(N).fill(7))
    expect(warnings).toEqual([])
  })

  it('retag {×5} + retouche de prose sur la MÊME ligne (signature différente) : le total éditeur tient (garde de rescueRepeatTotal)', () => {
    // Second verrou de fix (b) : quand la travailleuse retague ET change un mot, la
    // signature « papier » DIFFÈRE → chemin rescueRepeatTotal (pas restore). Comme les
    // comptes de mailles (c) n'ont pas bougé, rescueRepeatTotal ré-imposerait l'ancien
    // total SI le garde origin manquait — c'est le bug Roni par une seconde porte.
    // total stocké = le vecteur de mailles lui-même (non lossy : total === c[0]) → aucun
    // avertissement de perte attendu, on isole la garde rescue.
    const stitches = [80, 80, 80, 82, 82, 82, 84, 84, 84]
    const baseReader = baseReaderWithStoredTotal(stitches)
    const { md: editableMd } = readerToEditable(baseReader)
    const editedMd = editableMd
      .split('\n')
      .map((l) => {
        if (!(l.includes('Repeat R 1-2') && l.trim().startsWith('- '))) return l
        return retagLine(l, 'compteur-rep', { times: 5 }).replace('Repeat R 1-2', 'Redo R 1-2') // retouche de prose
      })
      .join('\n')
    const { reader, warnings } = editableToReader(editedMd, baseReader)
    const st = repStep(reader)
    expect(st.total).toEqual(Array(N).fill(5))
    expect(warnings).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import { SWATCH_MODES, emptySwatch, cleanSwatches, swatchSummary } from '../../src/utils/yarn-swatches'

const t = (k) => k

describe('yarn-swatches', () => {
  // Protège la forme d'un échantillon vierge et la liste des modes.
  it('expose les modes et un échantillon vide', () => {
    expect(SWATCH_MODES).toEqual(['flat', 'round'])
    expect(emptySwatch()).toEqual({ mode: 'flat', sizeMm: '', stitches: '', rows: '' })
  })

  // Protège la tolérance aux valeurs non tableau.
  it('cleanSwatches rend [] hors tableau', () => {
    expect(cleanSwatches('x')).toEqual([])
    expect(cleanSwatches(null)).toEqual([])
    expect(cleanSwatches(undefined)).toEqual([])
  })

  // Protège la conversion en chaînes rognées.
  it('cleanSwatches passe les champs en chaînes rognées', () => {
    expect(cleanSwatches([{ mode: 'round', sizeMm: ' 4,5 ', stitches: 20, rows: '' }])).toEqual([
      { mode: 'round', sizeMm: '4,5', stitches: '20', rows: '' },
    ])
  })

  // Protège le retrait des entrées vides ou non objets et le repli du mode inconnu.
  it('cleanSwatches retire les entrées vides et corrige le mode', () => {
    const out = cleanSwatches([
      { mode: 'flat', sizeMm: '', stitches: '', rows: '' },
      null,
      { mode: 'zigzag', sizeMm: '3', stitches: '', rows: '' },
    ])
    expect(out).toEqual([{ mode: 'flat', sizeMm: '3', stitches: '', rows: '' }])
  })

  // Protège la construction du résumé et l'omission des parties vides.
  it('swatchSummary omet les parties vides', () => {
    expect(swatchSummary({ mode: 'flat', sizeMm: '4', stitches: '22', rows: '30' }, t)).toBe(
      'yarn.swatches.modeFlat · 4 mm · 22 yarn.swatches.stitchesShort × 30 yarn.swatches.rowsShort yarn.swatches.per10',
    )
    expect(swatchSummary({ mode: 'round', sizeMm: '', stitches: '', rows: '30' }, t)).toBe(
      'yarn.swatches.modeRound · 30 yarn.swatches.rowsShort yarn.swatches.per10',
    )
    expect(swatchSummary({ mode: 'flat', sizeMm: '4', stitches: '', rows: '' }, t)).toBe(
      'yarn.swatches.modeFlat · 4 mm',
    )
  })
})

describe('yarn-swatches durcissement', () => {
  // Un objet, un tableau ou NaN dans un champ donnent '' ; l'entrée vide est écartée.
  it('ne garde que chaînes et nombres finis', () => {
    expect(cleanSwatches([{ mode: 'flat', sizeMm: {}, stitches: [1], rows: NaN }])).toEqual([])
    expect(cleanSwatches([{ mode: 'flat', sizeMm: Infinity, stitches: 22, rows: {} }])).toEqual([
      { mode: 'flat', sizeMm: '', stitches: '22', rows: '' },
    ])
  })
})

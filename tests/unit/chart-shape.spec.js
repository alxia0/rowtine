// Forme d'un diagramme non-linéaire (radial ou par tracé) : nouveauté du 23/08/2026, donc
// AUCUN patron existant ne porte cette valeur — contrairement à `readDir` (chart-readdir.spec.js),
// pas besoin d'un double mot+tag pour préserver une phrase héritée : absent = linéaire
// (comportement historique, inchangé), un mot suffit pour les 4 formes non-linéaires.
import { describe, it, expect } from 'vitest'
import { chartShapeToMd, chartShapeFromMd } from '@/utils/pattern-md/dialect'
import { patternToMd, mdToPattern } from '@/utils/pattern-md'

describe('chartShapeToMd / chartShapeFromMd (dialecte Rowtine-MD)', () => {
  it('traduit les 4 formes vers un mot lisible', () => {
    expect(chartShapeToMd('radial-square')).toBe('radial-carré')
    expect(chartShapeToMd('radial-circle')).toBe('radial-rond')
    expect(chartShapeToMd('radial-hexagon')).toBe('radial-hexagone')
    expect(chartShapeToMd('path')).toBe('tracé')
  })

  it("renvoie une chaîne vide pour une forme absente ou inconnue (pas d'invention)", () => {
    expect(chartShapeToMd(undefined)).toBe('')
    expect(chartShapeToMd('linear')).toBe('')
  })

  it('le mot redonne le code exact (bijection)', () => {
    expect(chartShapeFromMd('radial-carré')).toBe('radial-square')
    expect(chartShapeFromMd('radial-rond')).toBe('radial-circle')
    expect(chartShapeFromMd('radial-hexagone')).toBe('radial-hexagon')
    expect(chartShapeFromMd('tracé')).toBe('path')
  })

  it('un mot inconnu ne produit rien (jamais de valeur inventée)', () => {
    expect(chartShapeFromMd('carré')).toBeUndefined()
    expect(chartShapeFromMd('')).toBeUndefined()
  })
})

function chartPattern(shape) {
  return {
    name: 'Test chart shape',
    author: '',
    reader: {
      sizeLabels: ['S', 'M'],
      sections: [
        {
          id: 'diagramme-1',
          kind: 'diagramme',
          title: 'Diagramme 1',
          steps: [{ chart: true }],
          chart: { img: 'data:image/png;base64,QUJD', rows: 5, cols: 5, shape, repeat: '5 m × 5 rangs', builtinLegend: false },
        },
      ],
    },
  }
}

describe('chart.shape — fidélité du format Rowtine-MD (serialize ↔ parse)', () => {
  it('une forme radiale carrée est écrite lisible', () => {
    const { md } = patternToMd(chartPattern('radial-square'))
    expect(md).toContain('5 m × 5 rangs · forme radial-carré')
  })

  it('round-trip : les 4 formes survivent intactes', () => {
    for (const shape of ['radial-square', 'radial-circle', 'radial-hexagon', 'path']) {
      const { md } = patternToMd(chartPattern(shape))
      const { pattern: reparsed, warnings } = mdToPattern(md)
      expect(warnings).toEqual([])
      const diag = reparsed.reader.sections.find((s) => s.title === 'Diagramme 1')
      expect(diag.chart.shape).toBe(shape)
    }
  })

  it('point fixe : re-sérialiser le patron relu redonne EXACTEMENT le même texte', () => {
    const { md } = patternToMd(chartPattern('path'))
    const { pattern: reparsed } = mdToPattern(md)
    expect(patternToMd(reparsed).md).toBe(md)
  })

  it('un diagramme SANS shape (patron existant) : round-trip inchangé, aucun segment "forme" ajouté', () => {
    const { md } = patternToMd(chartPattern(undefined))
    expect(md).not.toContain('forme')
    const { pattern: reparsed, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    const diag = reparsed.reader.sections.find((s) => s.title === 'Diagramme 1')
    expect(diag.chart.shape).toBeUndefined()
    expect(patternToMd(reparsed).md).toBe(md)
  })

  it('rows:0, cols:0 (diagramme fraichement promu) : shape est quand meme emis et relu', () => {
    const pattern = chartPattern('radial-square')
    pattern.reader.sections[0].chart.rows = 0
    pattern.reader.sections[0].chart.cols = 0
    const { md } = patternToMd(pattern)
    expect(md).toContain('0 m × 0 rangs · forme radial-carré')
    const { pattern: reparsed, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    const diag = reparsed.reader.sections.find((s) => s.title === 'Diagramme 1')
    expect(diag.chart.shape).toBe('radial-square')
    expect(diag.chart.rows).toBe(0)
    expect(diag.chart.cols).toBe(0)
  })

  it('forme + lecture + répéter + tailles : tous les segments coexistent, dans le bon ordre', () => {
    const pattern = chartPattern('radial-circle')
    pattern.reader.sections[0].chart.readDir = 'rtl'
    pattern.reader.sections[0].chart.reps = 3
    pattern.reader.sections[0].chart.sizes = ['S', 'M']
    const { md } = patternToMd(pattern)
    expect(md).toContain('5 m × 5 rangs · forme radial-rond · lecture droite à gauche {rtl} · répéter 3 fois · tailles S, M')
    const { pattern: reparsed, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    const diag = reparsed.reader.sections.find((s) => s.title === 'Diagramme 1')
    expect(diag.chart.shape).toBe('radial-circle')
    expect(diag.chart.readDir).toBe('rtl')
    expect(diag.chart.reps).toBe(3)
    expect(diag.chart.sizes).toEqual(['S', 'M'])
  })
})

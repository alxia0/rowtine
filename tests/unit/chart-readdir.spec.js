// Sens de lecture d'un diagramme : depuis le 30/07, la donnée porte un CODE ('rtl'/'ltr')
// traduit à l'affichage. Rétro-compatibilité : les patrons déjà importés portent une phrase
// toute faite dans leur langue d'origine (français ou autre) — elle doit passer telle quelle,
// jamais un code brut à l'écran ni une info perdue.
import { describe, it, expect } from 'vitest'
import { readDirLabel } from '@/utils/reader'
import { readDirToMd, readDirFromMd } from '@/utils/pattern-md/dialect'
import { patternToMd, mdToPattern } from '@/utils/pattern-md'

const fakeT = (key) => key

describe('sens de lecture du diagramme', () => {
  it('traduit les codes', () => {
    expect(readDirLabel('rtl', fakeT)).toBe('reader.chart.readDir.rtl')
    expect(readDirLabel('ltr', fakeT)).toBe('reader.chart.readDir.ltr')
  })

  it('laisse passer une valeur héritée telle quelle (patrons déjà importés)', () => {
    // Ces patrons existent déjà dans les bases installées : la phrase française qu'ils
    // portent vaut mieux qu'un code brut affiché à l'écran.
    expect(readDirLabel('droite à gauche', fakeT)).toBe('droite à gauche')
    expect(readDirLabel('von rechts nach links', fakeT)).toBe('von rechts nach links')
  })

  it("rend une chaîne vide quand il n'y a rien à dire", () => {
    expect(readDirLabel('', fakeT)).toBe('')
    expect(readDirLabel(undefined, fakeT)).toBe('')
  })
})

// Revue coordinateur (31/07) : serialize.js écrivait la valeur BRUTE de chart.readDir dans le
// texte Rowtine-MD (« · lecture rtl » le jour où un code y arrive) — même défaut que celui
// corrigé côté écran, mais sur le format Markdown, réellement lu par la tricoteuse (éditeur de
// correction, fichier patron.md sur disque). Solution : même convention que le tag {kind} déjà
// utilisé par ce dialecte (dialect.js) — le mot français rend la ligne lisible, le tag {rtl|ltr}
// qui le suit est ce que parse.js relit, pour un aller-retour save/reload fidèle au CODE (donc
// toujours traduisible ensuite). Une valeur héritée (phrase déjà toute faite) n'a jamais ce tag
// et ressort inchangée, sans réinterprétation.
describe('readDirToMd / readDirFromMd (dialecte Rowtine-MD)', () => {
  it('un code devient un mot lisible suivi du tag technique', () => {
    expect(readDirToMd('rtl')).toBe('droite à gauche {rtl}')
    expect(readDirToMd('ltr')).toBe('gauche à droite {ltr}')
  })

  it('le tag technique redonne le code exact (bijection)', () => {
    expect(readDirFromMd('droite à gauche {rtl}')).toBe('rtl')
    expect(readDirFromMd('gauche à droite {ltr}')).toBe('ltr')
  })

  it('une valeur héritée (sans tag) : ni transformée à l’écriture, ni réinterprétée à la lecture', () => {
    expect(readDirToMd('droite à gauche')).toBe('droite à gauche')
    expect(readDirToMd('von rechts nach links')).toBe('von rechts nach links')
    expect(readDirFromMd('droite à gauche')).toBe('droite à gauche')
    expect(readDirFromMd('von rechts nach links')).toBe('von rechts nach links')
  })
})

function chartPattern(readDir) {
  return {
    name: 'Test lecture diagramme',
    author: '',
    reader: {
      sizeLabels: [],
      sections: [
        {
          id: 'diagramme-1',
          kind: 'diagramme',
          title: 'Diagramme 1',
          steps: [{ chart: true }],
          chart: { img: 'data:image/png;base64,QUJD', rows: 4, cols: 4, readDir, repeat: '4 m × 4 rangs', builtinLegend: false },
        },
      ],
    },
  }
}

describe('sens de lecture — fidélité du format Rowtine-MD (serialize ↔ parse)', () => {
  it('un code est écrit lisible (mot + tag), jamais le code seul', () => {
    const { md } = patternToMd(chartPattern('rtl'))
    expect(md).toContain('lecture droite à gauche {rtl}')
    expect(md).not.toMatch(/lecture rtl(?![\p{L}])/u)
  })

  it('round-trip : le code survit intact (donc reste traduisible après relecture)', () => {
    const { md } = patternToMd(chartPattern('rtl'))
    const { pattern: reparsed, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    const diag = reparsed.reader.sections.find((s) => s.title === 'Diagramme 1')
    expect(diag.chart.readDir).toBe('rtl')
    expect(readDirLabel(diag.chart.readDir, fakeT)).toBe('reader.chart.readDir.rtl')
  })

  it('point fixe : re-sérialiser le patron relu redonne EXACTEMENT le même texte', () => {
    const { md } = patternToMd(chartPattern('rtl'))
    const { pattern: reparsed } = mdToPattern(md)
    expect(patternToMd(reparsed).md).toBe(md)
  })

  it('une phrase héritée (patron déjà importé) : round-trip inchangé, aucun tag ajouté', () => {
    const { md } = patternToMd(chartPattern('von rechts nach links'))
    expect(md).toContain('lecture von rechts nach links')
    expect(md).not.toContain('{rtl}')
    expect(md).not.toContain('{ltr}')
    const { pattern: reparsed, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    const diag = reparsed.reader.sections.find((s) => s.title === 'Diagramme 1')
    expect(diag.chart.readDir).toBe('von rechts nach links')
    expect(patternToMd(reparsed).md).toBe(md)
  })
})

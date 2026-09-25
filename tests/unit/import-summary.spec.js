// Bilan du patron enregistré (carte « Ton patron est importé », LocalPdfImportView.vue) —
// module pur, testé isolément (aucun store, aucun DOM).
import { describe, it, expect } from 'vitest'
import { summarizeImportedPattern } from '@/utils/import-summary'

// Section « normale » à N rangs cochables (aucune note, aucun diagramme).
function rowSection(id, title, n) {
  return {
    id,
    kind: 'body',
    title,
    steps: Array.from({ length: n }, () => ({ text: 'x' })),
  }
}

// Forme EXACTE d'une section-diagramme telle que produite par promote-grids.js
// (gridSection) : un unique step `{chart:true}`, jamais cochable, plus l'objet `chart`.
// Reproduite à la main ici plutôt qu'en passant par `promoteGridSections` (qui exige une
// géométrie de régions/pages hors sujet pour ce test) : mêmes clés, même prédicat
// `sectionIsChart` à l'arrivée.
function chartSection(id, title) {
  return {
    id,
    kind: 'diagramme',
    title,
    steps: [{ chart: true }],
    chart: { rows: 0, cols: 0, img: 'data:image/png;base64,X', repeat: '', readDir: '', builtinLegend: false },
  }
}

describe('summarizeImportedPattern', () => {
  it('patron démo : compte sections, étapes cochables, tailles et diagrammes', () => {
    const pattern = {
      reader: {
        sizeLabels: ['S', 'M', 'L'],
        sections: [rowSection('corps', 'Corps', 4), rowSection('manches', 'Manches', 3)],
      },
    }
    expect(summarizeImportedPattern(pattern)).toEqual({
      sections: 2,
      steps: 7,
      sizes: 3,
      charts: 0,
      singleSize: false,
    })
  })

  it('patron vide (aucune section, aucune taille) : tout à zéro, aucune erreur', () => {
    const pattern = { reader: { sizeLabels: [], sections: [] } }
    expect(summarizeImportedPattern(pattern)).toEqual({
      sections: 0,
      steps: 0,
      sizes: 0,
      charts: 0,
      singleSize: false,
    })
  })

  it('reader absent (patron sans reader) : ne lève pas, tout à zéro', () => {
    expect(summarizeImportedPattern({})).toEqual({
      sections: 0,
      steps: 0,
      sizes: 0,
      charts: 0,
      singleSize: false,
    })
  })

  it('taille unique : singleSize vrai, sizes vaut 1 (la sentinelle compte pour une taille)', () => {
    const pattern = { reader: { sizeLabels: ['Taille unique'], sections: [rowSection('corps', 'Corps', 2)] } }
    const s = summarizeImportedPattern(pattern)
    expect(s.singleSize).toBe(true)
    expect(s.sizes).toBe(1)
  })

  it('diagrammes promus (promote-grids) : comptés à part, exclus de « sections » et « steps »', () => {
    const pattern = {
      reader: {
        sizeLabels: ['Taille unique'],
        sections: [rowSection('corps', 'Corps', 5), chartSection('diagramme-1', 'Diagramme 1'), chartSection('diagramme-2', 'Diagramme 2')],
      },
    }
    expect(summarizeImportedPattern(pattern)).toEqual({
      sections: 1, // seule « Corps » — les 2 sections-diagramme n'y comptent pas
      steps: 5, // le step {chart:true} de chaque diagramme n'est pas cochable
      sizes: 1,
      charts: 2,
      singleSize: true,
    })
  })

  it('un `reader.chart` de repli, SANS section-diagramme correspondante, ne compte pas dans charts', () => {
    // Rappel du brief : « charts » compte les sections affichées avec un diagramme
    // (sectionIsChart), jamais le repli reader.chart seul.
    const pattern = {
      reader: {
        sizeLabels: ['M'],
        sections: [rowSection('corps', 'Corps', 1)],
        chart: { rows: 4, cols: 4, img: 'data:image/png;base64,Y' },
      },
    }
    expect(summarizeImportedPattern(pattern).charts).toBe(0)
  })
})

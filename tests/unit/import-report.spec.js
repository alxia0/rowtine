// Store transitoire (#4) : relais des avertissements d'un import réussi vers
// PatternView, qui saute désormais l'écran de revue post-conversion. set() est appelé
// par LocalPdfImportView (ensureSaved) au moment de l'enregistrement ; consume() est
// appelé par PatternView au montage — UNE fois, pour ne jamais réafficher un bandeau
// déjà fermé/consommé après un aller-retour.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useImportReportStore } from '@/stores/import-report'

beforeEach(() => setActivePinia(createPinia()))

describe('useImportReportStore', () => {
  it('set() puis consume(même id) renvoie les warnings et vide le store', () => {
    const s = useImportReportStore()
    s.set(7, ['Section « Manches » incertaine'])
    expect(s.patternId).toBe(7)
    expect(s.warnings).toEqual(['Section « Manches » incertaine'])

    const out = s.consume(7)
    expect(out).toEqual({ warnings: ['Section « Manches » incertaine'], lowConfidence: false })
    expect(s.patternId).toBe(null)
    expect(s.warnings).toEqual([])
  })

  it('consume() un id différent : ne renvoie rien et NE VIDE PAS le store (jamais perdre d’info)', () => {
    const s = useImportReportStore()
    s.set(7, ['w1'])
    const out = s.consume(42)
    expect(out).toEqual({ warnings: [], lowConfidence: false })
    // Le store garde les warnings du patron 7 intacts : un futur consume(7) doit
    // encore les trouver (ex. l'utilisateur ouvre un autre patron d'abord).
    expect(s.patternId).toBe(7)
    expect(s.warnings).toEqual(['w1'])
  })

  it('consume() compare id en chaîne/nombre indifféremment (route.params.id est une chaîne)', () => {
    const s = useImportReportStore()
    s.set(7, ['w1'])
    const out = s.consume('7')
    expect(out).toEqual({ warnings: ['w1'], lowConfidence: false })
    expect(s.patternId).toBe(null)
  })

  it('consume() sans warnings préalables renvoie un objet vide', () => {
    const s = useImportReportStore()
    expect(s.consume(1)).toEqual({ warnings: [], lowConfidence: false })
  })

  it('set() avec un tableau vide : consume(même id) renvoie warnings: []', () => {
    const s = useImportReportStore()
    s.set(3, [])
    expect(s.consume(3)).toEqual({ warnings: [], lowConfidence: false })
    expect(s.patternId).toBe(null) // consommé quand même (retire l'entrée transitoire)
  })

  it('transporte le drapeau lowConfidence', () => {
    const s = useImportReportStore()
    s.set(5, ['w'], true)
    const out = s.consume('5')
    expect(out.warnings).toEqual(['w'])
    expect(out.lowConfidence).toBe(true)
  })

  it('consume renvoie un objet vide non-consommant pour un autre id', () => {
    const s = useImportReportStore()
    s.set(5, ['w'], true)
    expect(s.consume('9')).toEqual({ warnings: [], lowConfidence: false })
  })
})

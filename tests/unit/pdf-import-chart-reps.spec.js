import { describe, it, expect, vi } from 'vitest'

vi.mock('@/utils/pdf', () => ({
  extractPages: vi.fn(),
  renderPdfPageToDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,xxx'),
  extractImagesWithPos: vi.fn(),
  readFileAsDataUrl: vi.fn(),
}))
import { detectChartReps } from '@/utils/pdf-import/index'

describe('detectChartReps', () => {
  it('capte « Répéter le diagramme 5 fois » → 5', () => {
    expect(detectChartReps('Diagramme du motif. Répéter le diagramme 5 fois au total.')).toBe(5)
  })
  it('anglais « repeat the chart 4 times » → 4', () => {
    expect(detectChartReps('Chart legend. Repeat the chart 4 times.')).toBe(4)
  })
  it('« répéter le motif 3 fois » → 3', () => {
    expect(detectChartReps('Répéter le motif 3 fois.')).toBe(3)
  })
  it('rien à capter → null', () => {
    expect(detectChartReps('Diagramme : lire de droite à gauche.')).toBeNull()
    expect(detectChartReps('')).toBeNull()
  })
})

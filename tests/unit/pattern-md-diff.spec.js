import { describe, it, expect } from 'vitest'
import { mdSimilarity } from '@/utils/pattern-md/diff'

describe('mdSimilarity', () => {
  it('identiques → ratio 1', () => {
    expect(mdSimilarity('a\nb\n', 'a\nb\n')).toEqual({ ratio: 1, missing: 0, extra: 0 })
  })
  it('ligne manquante (l’intro perdue est visible)', () => {
    const r = mdSimilarity('## Corps\n- tric.\n', 'Une belle intro.\n\n## Corps\n- tric.\n')
    expect(r.missing).toBe(1)
    expect(r.extra).toBe(0)
    expect(r.ratio).toBeCloseTo(4 / 5, 5)
  })
  it('vides / trim ignorés', () => {
    expect(mdSimilarity('a\n\n  b  \n', 'a\nb\n').ratio).toBe(1)
  })
  it('tout différent → ratio 0', () => {
    expect(mdSimilarity('a\n', 'b\n').ratio).toBe(0)
  })
})

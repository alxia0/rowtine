import { describe, it, expect } from 'vitest'
import { LOCAL_PHASES, ZIP_PHASES, phaseByKey, easedPct, fracPct, estimateTau, computeProgress } from '@/utils/import-progress'

describe('import-progress — bandes', () => {
  it('les bandes locales sont croissantes et couvrent 0→100', () => {
    expect(LOCAL_PHASES[0].lo).toBe(0)
    expect(LOCAL_PHASES[LOCAL_PHASES.length - 1].hi).toBe(100)
    for (const p of LOCAL_PHASES) expect(p.hi).toBeGreaterThanOrEqual(p.lo)
  })
  it('les bandes zip sont croissantes et couvrent 0→100', () => {
    expect(ZIP_PHASES[0].lo).toBe(0)
    expect(ZIP_PHASES[ZIP_PHASES.length - 1].hi).toBe(100)
    for (const p of ZIP_PHASES) expect(p.hi).toBeGreaterThanOrEqual(p.lo)
  })
  it('phaseByKey retrouve une phase', () => {
    expect(phaseByKey(LOCAL_PHASES, 'extract').hi).toBe(40)
    expect(phaseByKey(ZIP_PHASES, 'images').lo).toBe(30)
    expect(phaseByKey(LOCAL_PHASES, 'inconnu')).toBeNull()
  })
})

describe('easedPct — asymptotique', () => {
  it('démarre à lo (t=0) et croît sans atteindre hi', () => {
    expect(easedPct(10, 90, 0, 60)).toBe(10)
    const a = easedPct(10, 90, 30, 60)
    const b = easedPct(10, 90, 90, 60)
    expect(a).toBeGreaterThan(10)
    expect(b).toBeGreaterThan(a) // monotone
    expect(b).toBeLessThan(90) // jamais la borne haute
  })
  it('reste sous hi même pour un temps énorme', () => {
    expect(easedPct(10, 90, 100000, 60)).toBeLessThan(90)
  })
  it('tau invalide → repli 30 sans planter', () => {
    expect(easedPct(0, 100, 30, 0)).toBeGreaterThan(0)
  })
})

describe('fracPct — réel', () => {
  it('fraction bornée dans la bande', () => {
    expect(fracPct(0, 40, 0, 10)).toBe(0)
    expect(fracPct(0, 40, 5, 10)).toBe(20)
    expect(fracPct(0, 40, 10, 10)).toBe(40)
    expect(fracPct(0, 40, 99, 10)).toBe(40) // borné
  })
  it('total nul → borne basse', () => {
    expect(fracPct(50, 92, 3, 0)).toBe(50)
  })
})

describe('estimateTau', () => {
  it('borné entre 30 et 120 s', () => {
    expect(estimateTau(0)).toBe(30)
    expect(estimateTau(100 * 1024 * 1024)).toBe(120)
    expect(estimateTau(2 * 1024 * 1024)).toBe(60)
  })
})

describe('computeProgress', () => {
  it('phase à fraction réelle (local extract) → fracPct + labelKey', () => {
    const r = computeProgress(LOCAL_PHASES, 'extract', 0, 5, 10, 60)
    expect(r.pct).toBe(20) // 0→40 à 50 %
    expect(r.labelKey).toBe('import.phase.extract')
  })
  it('phase opaque (zip images) sans total → easing', () => {
    const r = computeProgress(ZIP_PHASES, 'images', 30, 0, 0, 60)
    expect(r.pct).toBeGreaterThan(30)
    expect(r.pct).toBeLessThan(90)
    expect(r.labelKey).toBe('importZip.phase.images')
  })
  it('phase inconnue → 0', () => {
    expect(computeProgress(LOCAL_PHASES, 'zzz', 0, 0, 0, 60)).toEqual({ pct: 0, labelKey: '' })
  })
})

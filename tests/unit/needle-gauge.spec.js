// Unitaire — src/utils/needle-gauge.js : recommandation de taille d'aiguilles/crochet
// pour retrouver l'echantillon vise par un patron avec une laine differente.
import { describe, it, expect } from 'vitest'
import { recommendNeedle } from '@/utils/needle-gauge'

describe('recommendNeedle', () => {
  it('recommande une aiguille plus grosse quand la laine tricote plus serre que la cible', () => {
    const r = recommendNeedle({ technique: 'knitting', labelNeedleMm: 4, labelStitches: 22, targetStitches: 20 })
    expect(r.recommendedMm).toBe(4.5)
    expect(r.rawMm).toBeCloseTo(4.4)
    expect(r.direction).toBe('bigger')
    expect(r.sameGauge).toBe(false)
    expect(r.outOfRange).toBe(false)
  })

  it('recommande une aiguille plus fine quand la laine tricote plus lache que la cible', () => {
    const r = recommendNeedle({ technique: 'knitting', labelNeedleMm: 4, labelStitches: 18, targetStitches: 20 })
    expect(r.recommendedMm).toBe(3.5)
    expect(r.rawMm).toBeCloseTo(3.6)
    expect(r.direction).toBe('smaller')
  })

  it('indique qu\'aucun changement n\'est necessaire quand les mailles sont identiques', () => {
    const r = recommendNeedle({ technique: 'knitting', labelNeedleMm: 4, labelStitches: 20, targetStitches: 20 })
    expect(r.sameGauge).toBe(true)
    expect(r.recommendedMm).toBe(4)
  })

  it('reste dans la tolerance de 2 % (20 vs 20,4 mailles) -> pas de changement', () => {
    const r = recommendNeedle({ technique: 'knitting', labelNeedleMm: 4, labelStitches: 20, targetStitches: 20.4 })
    expect(r.sameGauge).toBe(true)
  })

  it('sort de la tolerance de 2 % (20 vs 20,6 mailles) : la taille standard la plus proche peut rester identique', () => {
    const r = recommendNeedle({ technique: 'knitting', labelNeedleMm: 4, labelStitches: 20, targetStitches: 20.6 })
    expect(r.sameGauge).toBe(false)
    expect(r.direction).toBe('same') // ecart reel, mais trop faible pour changer de palier standard (3,88mm arrondit a 4mm)
  })

  it('utilise une table de tailles distincte pour le crochet (pas de taille a 3 mm pile, contrairement au tricot -- verifie aupres du bareme standard Craft Yarn Council)', () => {
    const knitting = recommendNeedle({ technique: 'knitting', labelNeedleMm: 6, labelStitches: 10, targetStitches: 20 })
    const crochet = recommendNeedle({ technique: 'crochet', labelNeedleMm: 6, labelStitches: 10, targetStitches: 20 })
    expect(knitting.recommendedMm).toBe(3)
    expect(crochet.recommendedMm).toBe(2.75)
  })

  it('signale un ecart hors gamme quand le resultat calcule sort de la table standard', () => {
    const r = recommendNeedle({ technique: 'knitting', labelNeedleMm: 5, labelStitches: 10, targetStitches: 40 })
    expect(r.outOfRange).toBe(true)
    expect(r.recommendedMm).toBe(2)
    expect(r.direction).toBe('smaller')
  })

  it('signale une divergence de tendance sur les rangs sans changer la recommandation', () => {
    const r = recommendNeedle({
      technique: 'knitting',
      labelNeedleMm: 4,
      labelStitches: 22,
      targetStitches: 20,
      labelRows: 26,
      targetRows: 28,
    })
    expect(r.rowNote).toBe('diverges')
    expect(r.direction).toBe('bigger')
  })

  it('ne signale rien sur les rangs quand ils ne sont pas renseignes', () => {
    const r = recommendNeedle({ technique: 'knitting', labelNeedleMm: 4, labelStitches: 22, targetStitches: 20 })
    expect(r.rowNote).toBe(null)
  })

  it('renvoie null si un champ requis est vide', () => {
    expect(recommendNeedle({ technique: 'knitting', labelNeedleMm: '', labelStitches: 22, targetStitches: 20 })).toBe(null)
  })

  it('renvoie null si une valeur requise est negative ou nulle', () => {
    expect(recommendNeedle({ technique: 'knitting', labelNeedleMm: -4, labelStitches: 22, targetStitches: 20 })).toBe(null)
    expect(recommendNeedle({ technique: 'knitting', labelNeedleMm: 4, labelStitches: 0, targetStitches: 20 })).toBe(null)
  })
})

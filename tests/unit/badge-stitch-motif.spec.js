import { describe, it, expect } from 'vitest'
import { drawStitchMotif, STITCH_MOTIF_HEIGHT } from '@/utils/badge-stitch-motif'

function stubCtx() {
  const calls = []
  return {
    calls,
    save() {}, restore() {},
    beginPath() { calls.push(['beginPath']) },
    moveTo(...a) { calls.push(['moveTo', ...a]) },
    lineTo(...a) { calls.push(['lineTo', ...a]) },
    quadraticCurveTo(...a) { calls.push(['quadraticCurveTo', ...a]) },
    closePath() { calls.push(['closePath']) },
    stroke() { calls.push(['stroke', this.strokeStyle, this.lineWidth, this.globalAlpha]) },
    set strokeStyle(v) { this._strokeStyle = v }, get strokeStyle() { return this._strokeStyle },
    set lineWidth(v) { this._lineWidth = v }, get lineWidth() { return this._lineWidth },
    set globalAlpha(v) { this._globalAlpha = v }, get globalAlpha() { return this._globalAlpha },
    lineCap: '', lineJoin: '',
  }
}

describe('drawStitchMotif', () => {
  it('dessine des mailles en V pour le tricot, des boucles pour le crochet', () => {
    const ctxKnit = stubCtx()
    drawStitchMotif(ctxKnit, 0, 0, { technique: 'knitting', done: 3, total: 10, textColor: '#111', maxWidth: 400 })
    expect(ctxKnit.calls.filter((c) => c[0] === 'stroke').length).toBeGreaterThan(0)
    expect(ctxKnit.calls.some((c) => c[0] === 'quadraticCurveTo')).toBe(false)

    const ctxCrochet = stubCtx()
    drawStitchMotif(ctxCrochet, 0, 0, { technique: 'crochet', done: 3, total: 10, textColor: '#111', maxWidth: 400 })
    expect(ctxCrochet.calls.some((c) => c[0] === 'quadraticCurveTo')).toBe(true)
  })

  it('ne dessine jamais au-delà de maxWidth', () => {
    const ctx = stubCtx()
    const maxWidth = 60 // volontairement étroit : force le plafonnement par la largeur
    drawStitchMotif(ctx, 0, 0, { technique: 'knitting', done: 5, total: 40, textColor: '#111', maxWidth })
    const xs = ctx.calls.filter((c) => c[0] === 'moveTo' || c[0] === 'lineTo').map((c) => c[1])
    expect(Math.max(...xs)).toBeLessThanOrEqual(maxWidth)
  })

  it('ne plante pas et ne dessine rien de visible quand maxWidth est trop étroit pour une seule maille', () => {
    const ctx = stubCtx()
    drawStitchMotif(ctx, 0, 0, { technique: 'knitting', done: 1, total: 10, textColor: '#111', maxWidth: 2 })
    expect(ctx.calls.filter((c) => c[0] === 'stroke').length).toBe(0)
  })

  it('STITCH_MOTIF_HEIGHT vaut exactement 13 * SCALE (échelle badge, pas échelle écran)', () => {
    // Valeur EXACTE (pas juste « > 13 ») : un changement accidentel de `SCALE` doit se voir ici,
    // pas seulement rester une hauteur plausible qui passerait quand même le test.
    expect(STITCH_MOTIF_HEIGHT).toBe(26) // 13px (StitchProgress.vue) * SCALE (2, badge-stitch-motif.js)
  })
})

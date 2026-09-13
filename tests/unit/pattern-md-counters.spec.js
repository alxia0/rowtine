import { describe, it, expect } from 'vitest'
import { parseStepCounter, emitStepCounter, parseSectionRepeat, emitSectionRepeat } from '../../src/utils/pattern-md/counters.js'

describe('compteurs de rang', () => {
  it('parse une répétition {×N}', () => {
    expect(parseStepCounter('{×6} Refaire ce rang.')).toEqual({
      counter: { kind: 'repetition', times: 6 }, rest: 'Refaire ce rang.',
    })
  })
  it('parse une cadence {cadence X×N}', () => {
    expect(parseStepCounter('{cadence 4×6} Augmenter 1 m.')).toEqual({
      counter: { kind: 'cadence', every: 4, times: 6 }, rest: 'Augmenter 1 m.',
    })
  })
  it('sans marqueur : counter absent, rest = contenu', () => {
    expect(parseStepCounter('Faire 8 ms.')).toEqual({ rest: 'Faire 8 ms.' })
  })
  it('emit répétition et cadence', () => {
    expect(emitStepCounter({ kind: 'repetition', times: 6 })).toBe('{×6} ')
    expect(emitStepCounter({ kind: 'cadence', every: 4, times: 6 })).toBe('{cadence 4×6} ')
    expect(emitStepCounter(null)).toBe('')
  })
})

describe('compteur de section', () => {
  it('parse {×N} final de titre', () => {
    expect(parseSectionRepeat('Motif dentelle {×5}')).toEqual({ title: 'Motif dentelle', repeat: 5 })
  })
  it('titre sans compteur', () => {
    expect(parseSectionRepeat('Dos')).toEqual({ title: 'Dos' })
  })
  it('emit', () => {
    expect(emitSectionRepeat(5)).toBe(' {×5}')
    expect(emitSectionRepeat(undefined)).toBe('')
  })
})

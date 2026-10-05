import { describe, it, expect } from 'vitest'
import { toggleSectionDone } from '@/utils/section-mark'
import { readerProgress } from '@/utils/reader'

// Reader minimal : une section 'a' avec une NOTE en tete (#0, non cochable),
// deux rangs (#1, #2) et une repetition (#3). La note en tete verifie que les ids
// suivent l'index du tableau COMPLET (a#1, a#2, a#3) et pas la liste filtree.
function makeReader() {
  return {
    sizeLabels: ['S', 'M'],
    sections: [
      { id: 'a', title: 'Corps', steps: [
        { t: 'Monter 20 m.', note: true },
        { t: 'Rang 1' },
        { t: 'Rang 2' },
        { t: 'Repeter', repeat: true, total: [3, 4] },
      ] },
    ],
  }
}

describe('toggleSectionDone', () => {
  it('coche : marque rangs + repetition, sans decaler les ids (note en tete)', () => {
    const reader = makeReader()
    const next = toggleSectionDone(reader, {}, 'a', 0)
    expect(next.done['a#1']).toBe(true)
    expect(next.done['a#2']).toBe(true)
    expect(next.done['a#0']).toBeUndefined()      // note non marquee, pas de decalage
    expect(next.counters['a#3']).toBe(3)          // branche repetition (counters), pas done
    expect(readerProgress(reader, next).sections[0].complete).toBe(true)
  })

  it('decoche : restaure exactement la progression partielle davant', () => {
    const reader = makeReader()
    const start = { done: { 'a#1': true }, counters: {} }   // 1/3 cochable fait
    const checked = toggleSectionDone(reader, start, 'a', 0)
    expect(readerProgress(reader, checked).sections[0].complete).toBe(true)
    const back = toggleSectionDone(reader, checked, 'a', 0)   // decocher
    const prog = readerProgress(reader, back).sections[0]
    expect(prog.complete).toBe(false)
    expect(prog.done).toBe(1)                     // restaure a 1/3
    expect(back.done['a#1']).toBe(true)
    expect(back.done['a#2']).toBeUndefined()
    expect(back.counters['a#3']).toBeUndefined()
  })

  it('decoche sans instantane (section deja complete au chargement) : vide la section', () => {
    const reader = makeReader()
    const full = { done: { 'a#1': true, 'a#2': true }, counters: { 'a#3': 3 } }
    expect(readerProgress(reader, full).sections[0].complete).toBe(true)
    const cleared = toggleSectionDone(reader, full, 'a', 0)
    const prog = readerProgress(reader, cleared).sections[0]
    expect(prog.done).toBe(0)
    expect(cleared.done['a#1']).toBeUndefined()
    expect(cleared.counters['a#3']).toBeUndefined()
  })

  it('preserves other keys in state and does not mutate input', () => {
    const reader = makeReader()
    const start = { size: 1, chartRows: { x: 2 }, done: {}, counters: {} }
    const next = toggleSectionDone(reader, start, 'a', 1)
    expect(next).not.toBe(start)                  // immutable
    expect(start.done['a#1']).toBeUndefined()     // input untouched
    expect(next.size).toBe(1)
    expect(next.chartRows).toEqual({ x: 2 })
  })

  it('unknown section returns state unchanged', () => {
    const reader = makeReader()
    const state = { done: {} }
    expect(toggleSectionDone(reader, state, 'zzz', 0)).toBe(state)
  })
})

describe('toggleSectionDone : exemplaires', () => {
  const reader = { sizeLabels: ['S'], sections: [{ id: 'p', kind: 'pied', copies: 2, title: 'Pied', steps: [{ t: 'a' }, { t: 'b' }] }] }

  it('cocher coche tous les exemplaires, décocher les vide, sans muter l\'entrée', () => {
    const start = { done: {}, counters: {}, copyState: { 2: { done: {}, counters: {} } } }
    const on = toggleSectionDone(reader, start, 'p', 0)
    expect(on.done).toEqual({ 'p#0': true, 'p#1': true })
    expect(on.copyState[2].done).toEqual({ 'p#0': true, 'p#1': true })
    expect(start.copyState[2].done).toEqual({})
    const off = toggleSectionDone(reader, on, 'p', 0)
    expect(off.done).toEqual({})
    expect(off.copyState[2].done).toEqual({})
  })

  it('un exemplaire seulement fait : cocher complète l\'autre, décocher restaure les deux', () => {
    const start = { done: { 'p#0': true, 'p#1': true }, counters: {}, copyState: { 2: { done: { 'p#0': true }, counters: {} } } }
    const on = toggleSectionDone(reader, start, 'p', 0)
    expect(on.copyState[2].done).toEqual({ 'p#0': true, 'p#1': true })
    const off = toggleSectionDone(reader, on, 'p', 0)
    expect(off.done).toEqual({ 'p#0': true, 'p#1': true })
    expect(off.copyState[2].done).toEqual({ 'p#0': true })
    expect(off.sectionSnap.p).toBeUndefined()
  })

  it('une section à 1 exemplaire garde la forme historique (pas de copyState ni de copies)', () => {
    const r1 = { sections: [{ id: 'c', kind: 'corps', title: 'C', steps: [{ t: 'a' }] }] }
    const on = toggleSectionDone(r1, { done: {}, counters: {} }, 'c', 0)
    expect(on).toEqual({ done: { 'c#0': true }, counters: {}, sectionSnap: { c: { done: {}, counters: {} } } })
  })
})

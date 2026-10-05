import { describe, it, expect } from 'vitest'
import { copiesOf, copyModeOf, sockPairSections, copyView, activeCopyOf, withCopyView, laggingCopy, counterCopy, copyStepId, parseCopyStepId, MAX_COPIES, applyPairedDefaults, copiesSummary } from '../../src/utils/section-copies'

describe('copiesOf', () => {
  it('borne 1..99 et retombe sur 1 pour toute valeur invalide ou un type non répétable', () => {
    expect(MAX_COPIES).toBe(99)
    expect(copiesOf({ kind: 'manche', copies: 2 })).toBe(2)
    expect(copiesOf({ kind: 'manche', copies: 99 })).toBe(99)
    expect(copiesOf({ kind: 'manche', copies: 150 })).toBe(MAX_COPIES)
    for (const v of [0, -3, 'abc', null, undefined, 1.9]) expect(copiesOf({ kind: 'manche', copies: v })).toBe(1)
    expect(copiesOf({ kind: 'corps', copies: 4 })).toBe(1)
    expect(copiesOf({ kind: 'manche' })).toBe(1)
  })
})

describe('copyModeOf', () => {
  it('simultané seulement si le projet le choisit et que la section est une chaussette à 2', () => {
    expect(copyModeOf({ kind: 'talon', copies: 2 }, 'simultaneous')).toBe('simultaneous')
    expect(copyModeOf({ kind: 'talon', copies: 3 }, 'simultaneous')).toBe('sequential')
    expect(copyModeOf({ kind: 'manche', copies: 2 }, 'simultaneous')).toBe('sequential')
    expect(copyModeOf({ kind: 'talon', copies: 2 })).toBe('sequential')
    expect(copyModeOf({ kind: 'talon', copies: 2 }, 'together')).toBe('sequential')
  })
  it("le mode posé sur la section n'est plus lu", () => {
    expect(copyModeOf({ kind: 'talon', copies: 2, copyMode: 'simultaneous' })).toBe('sequential')
  })
})

describe('copiesSummary', () => {
  it('nombre et technique du projet ; null à 1 exemplaire', () => {
    expect(copiesSummary({ kind: 'manche', copies: 3 }, 'simultaneous')).toEqual({ n: 3, together: false })
    expect(copiesSummary({ kind: 'talon', copies: 2 }, 'simultaneous')).toEqual({ n: 2, together: true })
    expect(copiesSummary({ kind: 'talon', copies: 2 })).toEqual({ n: 2, together: false })
    expect(copiesSummary({ kind: 'talon', copies: 1 })).toBeNull()
    expect(copiesSummary({ kind: 'corps', copies: 4 })).toBeNull()
  })
})

describe('sockPairSections', () => {
  it('les parties de chaussette à 2 exemplaires seulement', () => {
    const s = [{ id: 'a', kind: 'talon', copies: 2 }, { id: 'b', kind: 'pied', copies: 3 }, { id: 'c', kind: 'manche', copies: 2 }, { id: 'd', kind: 'pointe', copies: 2 }]
    expect(sockPairSections(s).map((x) => x.id)).toEqual(['a', 'd'])
    expect(sockPairSections(undefined)).toEqual([])
  })
})

describe('copyView / withCopyView', () => {
  const state = { done: { 'a#0': true }, counters: {}, copyState: { 2: { done: { 'a#1': true }, counters: { 'a#2': 3 } } } }
  it("l'exemplaire 1 lit done/counters, les suivants lisent copyState", () => {
    expect(copyView(state, 1).done).toEqual({ 'a#0': true })
    expect(copyView(state, 2).done).toEqual({ 'a#1': true })
    expect(copyView(state, 3)).toEqual({ done: {}, counters: {} })
  })
  it("withCopyView remplace la vue d'un exemplaire sans toucher les autres", () => {
    const s2 = withCopyView(state, 2, { done: {}, counters: {} })
    expect(s2.copyState[2]).toEqual({ done: {}, counters: {} })
    expect(s2.done).toEqual({ 'a#0': true })
    const s1 = withCopyView(state, 1, { done: { 'a#9': true }, counters: {} })
    expect(s1.done).toEqual({ 'a#9': true })
    expect(s1.copyState[2].done).toEqual({ 'a#1': true })
  })
})

describe('activeCopyOf', () => {
  it("borne l'exemplaire actif au nombre d'exemplaires courant", () => {
    const sec = { id: 'p', kind: 'pied', copies: 2 }
    expect(activeCopyOf({ activeCopy: { p: 2 } }, sec)).toBe(2)
    expect(activeCopyOf({ activeCopy: { p: 5 } }, sec)).toBe(1)
    expect(activeCopyOf({}, sec)).toBe(1)
  })
})

describe('laggingCopy', () => {
  it("rend l'exemplaire (1-based) au moins de rangs faits, 1 en cas d'égalité", () => {
    expect(laggingCopy([3, 1])).toBe(2)
    expect(laggingCopy([2, 2])).toBe(1)
    expect(laggingCopy([5])).toBe(1)
  })
})
describe('counterCopy', () => {
  // Revue finale I2 : en simultané, « + » suit le compteur en retard et « − » défait le dernier « + ».
  it('« + » vise le compteur le plus bas (1 à égalité), « − » le plus haut (2 à égalité)', () => {
    expect(counterCopy([0, 0], 1)).toBe(1)
    expect(counterCopy([1, 0], 1)).toBe(2)
    expect(counterCopy([3, 5], 1)).toBe(1)
    expect(counterCopy([1, 1], -1)).toBe(2)
    expect(counterCopy([1, 0], -1)).toBe(1)
    expect(counterCopy([8, 0], -1)).toBe(1)
    expect(counterCopy([2, 3], -1)).toBe(2)
  })
})

const sec = (kind, title = kind) => ({ id: title, kind, title, steps: [] })

describe('applyPairedDefaults', () => {
  it('double une manche, même avec une autre section manche, mais pas une section qui nomme son côté', () => {
    expect(applyPairedDefaults([sec('manche')])[0].copies).toBe(2)
    const both = applyPairedDefaults([sec('manche', 'Manches'), sec('manche', 'Poignets des manches')])
    expect(both.every((s) => s.copies === 2)).toBe(true)
    const sides = applyPairedDefaults([sec('manche', 'Manche gauche'), sec('manche', 'Manche droite')])
    expect(sides.every((s) => s.copies === undefined)).toBe(true)
    for (const t of ['Left sleeve', 'Ärmel rechts', 'Linker Ärmel', 'Manga izquierda', 'Manga derecha', 'Patte d’Épaule Droite', 'Manches droites', 'Bras droit', 'Oreilles gauches']) {
      expect(applyPairedDefaults([sec('manche', t)])[0].copies).toBeUndefined()
    }
  })
  it('oreilles, membres et jambes hors chaussettes sont doublés aussi', () => {
    const out = applyPairedDefaults([sec('oreille', 'Oreilles'), sec('oreille', 'Intérieur des oreilles'), sec('membre', 'Bras'), sec('jambe', 'Jambes'), sec('corps')])
    expect(out.map((s) => s.copies)).toEqual([2, 2, 2, 2, undefined])
  })
  it('double les types chaussette seulement avec au moins 3 types chaussette distincts', () => {
    const sock = ['pointe', 'pied', 'talon'].map((k) => sec(k))
    expect(applyPairedDefaults(sock).every((s) => s.copies === 2)).toBe(true)
    expect(applyPairedDefaults([sec('pointe'), sec('pied')]).every((s) => s.copies === undefined)).toBe(true)
  })
  it('patron de chaussettes : la bordure devient un bord-côtes à 2, ailleurs elle reste bordure', () => {
    const sock = applyPairedDefaults([sec('bordure', 'Côtes'), sec('jambe'), sec('talon'), sec('pied')])
    expect(sock[0]).toMatchObject({ kind: 'cotes', title: 'Côtes', copies: 2 })
    const pull = applyPairedDefaults([sec('bordure', 'Côtes'), sec('corps'), sec('manche')])
    expect(pull[0].kind).toBe('bordure')
    expect(pull[0].copies).toBeUndefined()
    const fewSock = applyPairedDefaults([sec('bordure', 'Cuff'), sec('pied'), sec('pointe')])
    expect(fewSock[0].kind).toBe('bordure')
  })
  it('ne touche ni les types non appariés ni une section qui a déjà copies, et ne pose jamais copyMode', () => {
    const out = applyPairedDefaults([sec('corps'), { ...sec('oreille'), copies: 4 }])
    expect(out[0].copies).toBeUndefined()
    expect(out[1].copies).toBe(4)
    expect(out.some((s) => s.copyMode)).toBe(false)
  })
})

describe('copyStepId / parseCopyStepId', () => {
  it.each(['sec#3@', 'sec#3@abc', 'sec#3@0', 'sec#3@@', 'sec#3@1'])("id mal formé %s : lu comme l'exemplaire 1 sur l'id entier", (raw) => {
    expect(parseCopyStepId(raw)).toEqual({ stepId: raw, copy: 1 })
  })
  it("l'exemplaire 1 garde l'id nu, les autres portent @c, et le décodage fait l'aller-retour", () => {
    expect(copyStepId('pied#3', 1)).toBe('pied#3')
    expect(copyStepId('pied#3', 2)).toBe('pied#3@2')
    expect(parseCopyStepId('pied#3@2')).toEqual({ stepId: 'pied#3', copy: 2 })
    expect(parseCopyStepId('pied#3')).toEqual({ stepId: 'pied#3', copy: 1 })
    expect(parseCopyStepId(copyStepId('a#0', 12))).toEqual({ stepId: 'a#0', copy: 12 })
  })
  it('un suffixe illisible se lit comme l\'exemplaire 1 sur l\'id entier', () => {
    expect(parseCopyStepId('pied#3@x')).toEqual({ stepId: 'pied#3@x', copy: 1 })
    expect(parseCopyStepId(undefined)).toEqual({ stepId: undefined, copy: 1 })
  })
})

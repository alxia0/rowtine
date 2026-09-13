import { describe, it, expect } from 'vitest'
import { stepTextToMd, mdTextToStep } from '@/utils/pattern-md/line'

const C6 = [104, 108, 108, 112, 116, 120]

describe('stepTextToMd', () => {
  it('remplace {{i}} par la notation papier', () => {
    expect(stepTextToMd('Monter {{0}} m.', [C6])).toBe('Monter 104 (108) 108 (112) 116 (120) m.')
  })
  it('retire proprement un vecteur vide (placeholder orphelin)', () => {
    expect(stepTextToMd('placer {{0}} AM comme suit', [[0, 0, 0, 0, 0, 0]])).toBe('placer AM comme suit')
  })
  it('gère plusieurs vecteurs', () => {
    expect(stepTextToMd('{{0}} m. end., AM, {{1}} m. end.', [[26, 26], [51, 53]])).toBe('26 (26) m. end., AM, 51 (53) m. end.')
  })
  it('texte sans placeholder inchangé', () => {
    expect(stepTextToMd('Rentrer les fils.', [])).toBe('Rentrer les fils.')
  })
})

describe('mdTextToStep', () => {
  it('reconnaît un vecteur à exactement n valeurs', () => {
    const st = mdTextToStep('Monter 104 (108) 108 (112) 116 (120) m.', 6)
    expect(st.t).toBe('Monter {{0}} m.')
    expect(st.c).toEqual([['104', '108', '108', '112', '116', '120']])
  })
  it('ignore les séquences qui n\'ont pas n valeurs', () => {
    const st = mdTextToStep('Rép. les rgs 3 et 4 encore 18 (18) 14 (14) 11 (9) autres fois.', 6)
    expect(st.c).toEqual([['18', '18', '14', '14', '11', '9']])
    expect(st.t).toBe('Rép. les rgs 3 et 4 encore {{0}} autres fois.')
  })
  it('laisse un nombre isolé en texte', () => {
    expect(mdTextToStep('tric 4 m end', 6)).toEqual({ t: 'tric 4 m end' })
  })
  it('sans tailles (n<2) : passthrough', () => {
    expect(mdTextToStep('Monter 104 (108) m.', 0)).toEqual({ t: 'Monter 104 (108) m.' })
  })
  it('aller-retour ligne', () => {
    const md = stepTextToMd('Monter {{0}} m.', [C6])
    expect(mdTextToStep(md, 6)).toEqual({ t: 'Monter {{0}} m.', c: [C6.map(String)] })
  })
})

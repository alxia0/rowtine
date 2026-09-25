// Unitaire — export CSV (séparateur « ; », guillemets, échappement).
import { describe, it, expect } from 'vitest'
import { toCsv } from '@/utils/csv'

describe('toCsv', () => {
  it('joint les cellules par « ; » et les lignes par CRLF', () => {
    const csv = toCsv(['a', 'b'], [['1', '2'], ['3', '4']])
    expect(csv).toBe('a;b\r\n1;2\r\n3;4')
  })

  it('protège les cellules contenant ; " ou retour ligne', () => {
    const csv = toCsv(['x'], [['a;b'], ['dit "ok"'], ['deux\nlignes']])
    expect(csv).toBe('x\r\n"a;b"\r\n"dit ""ok"""\r\n"deux\nlignes"')
  })

  it('rend les valeurs nulles/indéfinies comme cellules vides', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a;b\r\n;')
  })

  it('convertit les nombres en chaînes', () => {
    expect(toCsv(['n'], [[42], [0]])).toBe('n\r\n42\r\n0')
  })

  // Protège : une chaîne lue comme formule par le tableur est neutralisée, un nombre négatif reste un nombre.
  it('préfixe d’une apostrophe les chaînes commençant par = + - @ tabulation ou retour chariot', () => {
    expect(toCsv(['x'], [['=1+1'], ['+A1'], ['-2+3'], ['@SUM(A1)'], ['\tx'], ['\rx']])).toBe(
      'x\r\n\'=1+1\r\n\'+A1\r\n\'-2+3\r\n\'@SUM(A1)\r\n\'\tx\r\n"\'\rx"',
    )
    expect(toCsv(['n'], [[-3], [-0.5]])).toBe('n\r\n-3\r\n-0.5')
  })
})

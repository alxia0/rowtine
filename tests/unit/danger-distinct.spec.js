// Le rouge « danger » doit se distinguer de la couleur de marque, sinon une action
// destructive se lit comme une action ordinaire. Cf. audit UX 16/07.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')

const token = (nom) => {
  const m = css.match(new RegExp(`--${nom}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`token --${nom} introuvable`)
  const h = m[1].slice(1)
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

function lin(c) {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
function contraste(a, b) {
  const [x, y] = [lum(a), lum(b)]
  const [hi, lo] = x > y ? [x, y] : [y, x]
  return (hi + 0.05) / (lo + 0.05)
}

describe('token --danger', () => {
  it('se distingue nettement de --brand', () => {
    expect(distance(token('danger'), token('brand'))).toBeGreaterThan(40)
  })

  it('reste lisible en texte sur une carte sable (--surface)', () => {
    expect(contraste(token('danger'), token('surface'))).toBeGreaterThanOrEqual(4.5)
  })

  it('accepte du blanc par-dessus (bouton plein)', () => {
    expect(contraste([255, 255, 255], token('danger'))).toBeGreaterThanOrEqual(4.5)
  })
})

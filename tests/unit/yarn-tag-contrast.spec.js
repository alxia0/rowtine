// tests/unit/yarn-tag-contrast.spec.js
// Intent contrastes-restants-sage-et-reserve : .tag--reserved (YarnCard.vue,
// YarnDetailDialog.vue) posait var(--mustard) sur var(--tile) — 1,83:1, sous AA.
// --mustard-deep existe déjà (tokens.css, utilisé par STATUS_META.pause) : même
// remplacement mécanique que le badge de statut « en pause ».
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrast(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)]
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const repoRoot = resolve(process.cwd())

describe('tag « Réservé » des cartes laine', () => {
  it('YarnCard.vue et YarnDetailDialog.vue utilisent --mustard-deep (et plus --mustard, 1,83:1 sur --tile)', () => {
    for (const file of ['src/components/YarnCard.vue', 'src/components/YarnDetailDialog.vue']) {
      const src = readFileSync(resolve(repoRoot, file), 'utf8')
      expect(src, file).toMatch(/\.tag--reserved\s*\{\s*color:\s*var\(--mustard-deep\)/)
    }
  })

  it('--mustard-deep atteint AA 4,5:1 sur --tile dans les DEUX thèmes (littéraux tokens.css)', () => {
    const css = readFileSync(`${repoRoot}/src/styles/tokens.css`, 'utf8')
    const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'))
    const darkStart = css.indexOf(":root[data-theme='dark']")
    const darkBlock = css.slice(darkStart, css.indexOf('}', darkStart))
    const read = (block, prop) => {
      const m = block.match(new RegExp(`${prop}: (#[0-9a-f]{6})`))
      expect(m, `${prop} introuvable dans le bloc`).not.toBeNull()
      return hexToRgb(m[1])
    }
    const clair = contrast(read(lightBlock, '--mustard-deep'), read(lightBlock, '--tile'))
    const sombre = contrast(read(darkBlock, '--mustard-deep'), read(darkBlock, '--tile'))
    expect(clair).toBeGreaterThanOrEqual(4.5)
    expect(sombre).toBeGreaterThanOrEqual(4.5)
  })
})

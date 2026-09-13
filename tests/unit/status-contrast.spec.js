// Le badge de statut est du VRAI texte : il doit viser 4,5:1.
// --ink-40 (2,34) échoue ; --ink-55 (5,85) passe. Cf. audit UX 16/07.
// « En pause » avait le même défaut — --mustard
// (#e8b23a) mesurait 1,79:1 sur --bg, illisible. Corrigé par --mustard-deep
// (tokens.css) : 5,48:1 en clair, pire cas 5,45:1 sur les 360° de teinte d'accent
// (--bg tourne avec applyAccent) ; en sombre le token vaut --mustard (#eab94f),
// déjà conforme à 10,23:1. Ratios épinglés ci-dessous sur les littéraux tokens.css.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { STATUS_META } from '@/constants/status'

// --- Copié VERBATIM de tests/unit/theme-palette.spec.js (lui-même repris des specs e2e
// theme-contrast — convention du dépôt) ; parse() omis : les tokens se lisent en hex. ---
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
// --- fin du bloc copié ---

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const repoRoot = resolve(process.cwd())

describe('couleurs des statuts', () => {
  it('aucun statut n’utilise le gris décoratif --ink-40 comme couleur de texte', () => {
    const fautifs = Object.entries(STATUS_META)
      .filter(([, meta]) => meta.color === 'var(--ink-40)')
      .map(([nom]) => nom)
    expect(fautifs).toEqual([])
  })

  it('le statut « abandonné » utilise --ink-55', () => {
    expect(STATUS_META.abandoned.color).toBe('var(--ink-55)')
  })

  it('le statut « en pause » utilise --mustard-deep (et plus --mustard, illisible sur --bg)', () => {
    expect(STATUS_META.pause.color).toBe('var(--mustard-deep)')
  })

  it('« en pause » : --mustard-deep atteint AA 4,5:1 sur --bg dans les DEUX thèmes (littéraux tokens.css)', () => {
    const css = readFileSync(`${repoRoot}/src/styles/tokens.css`, 'utf8')
    // Bloc clair : de ':root {' à la media query sombre ; bloc sombre : le bloc
    // data-theme (valeurs identiques au bloc media query, non-dérive testée ailleurs —
    // cf. tests/e2e/theme.spec.js). Même découpe que theme-palette.spec.js.
    const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'))
    const darkStart = css.indexOf(":root[data-theme='dark']")
    const darkBlock = css.slice(darkStart, css.indexOf('}', darkStart))
    const read = (block, prop) => {
      const m = block.match(new RegExp(`${prop}: (#[0-9a-f]{6})`))
      expect(m, `${prop} introuvable dans le bloc`).not.toBeNull()
      return hexToRgb(m[1])
    }
    const clair = contrast(read(lightBlock, '--mustard-deep'), read(lightBlock, '--bg'))
    const sombre = contrast(read(darkBlock, '--mustard-deep'), read(darkBlock, '--bg'))
    // Mesures du 06/09 : 5,48:1 (clair, défaut dynamique bleu 230) et 10,23:1
    // (sombre, rose 320). L'épinglage garde une marge : le seuil AA, pas la valeur.
    expect(clair).toBeGreaterThanOrEqual(4.5)
    expect(sombre).toBeGreaterThanOrEqual(4.5)
  })

  it('le statut « terminé » utilise --sage-deep (et plus --sage, 4,43:1 sous AA sur --bg)', () => {
    expect(STATUS_META.done.color).toBe('var(--sage-deep)')
  })

  it('« terminé » : --sage-deep atteint AA 4,5:1 sur --bg dans les DEUX thèmes (littéraux tokens.css)', () => {
    const css = readFileSync(`${repoRoot}/src/styles/tokens.css`, 'utf8')
    const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'))
    const darkStart = css.indexOf(":root[data-theme='dark']")
    const darkBlock = css.slice(darkStart, css.indexOf('}', darkStart))
    const read = (block, prop) => {
      const m = block.match(new RegExp(`${prop}: (#[0-9a-f]{6})`))
      expect(m, `${prop} introuvable dans le bloc`).not.toBeNull()
      return hexToRgb(m[1])
    }
    const clair = contrast(read(lightBlock, '--sage-deep'), read(lightBlock, '--bg'))
    const sombre = contrast(read(darkBlock, '--sage-deep'), read(darkBlock, '--bg'))
    expect(clair).toBeGreaterThanOrEqual(4.5)
    expect(sombre).toBeGreaterThanOrEqual(4.5)
  })
})

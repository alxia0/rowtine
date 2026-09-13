// Les icônes d'action (croix de suppression, etc.) doivent atteindre 3:1 (WCAG 1.4.11,
// élément d'interface non textuel). --ink-40 = 2,34 ; --ink-55 = 5,85. Cf. audit UX 16/07.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

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

function parse(rgb) {
  // Peut renvoyer 3 (rgb) ou 4 (rgba) composantes.
  return rgb.match(/[\d.]+/g).map(Number)
}

// --ink-40 est une couleur translucide (rgba(..., 0.42)) : le navigateur ne l'affiche pas
// telle quelle, il la mélange visuellement avec le fond. Ignorer l'alpha (comme le ferait
// un simple parse RVB) sous-estime la clarté réelle du glyphe et fait passer le test à tort.
// On recompose donc la couleur effectivement visible avant de mesurer le contraste.
function composite([r, g, b, a = 1], bg) {
  return [
    a * r + (1 - a) * bg[0],
    a * g + (1 - a) * bg[1],
    a * b + (1 - a) * bg[2],
  ]
}

test('la croix de suppression de la bibliothèque atteint 3:1', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/library')

  const del = page.locator('.pcard__del').first()
  await expect(del).toBeVisible()

  const { fg, bg } = await del.evaluate((el) => {
    const style = getComputedStyle(el)
    // Le fond du bouton est transparent : on prend celui de la carte parente.
    let node = el.parentElement
    let background = 'rgba(0, 0, 0, 0)'
    while (node) {
      const bgc = getComputedStyle(node).backgroundColor
      if (bgc && bgc !== 'rgba(0, 0, 0, 0)' && bgc !== 'transparent') {
        background = bgc
        break
      }
      node = node.parentElement
    }
    return { fg: style.color, bg: background }
  })

  const bgRgb = parse(bg)
  const effectiveFg = composite(parse(fg), bgRgb)
  expect(contrast(effectiveFg, bgRgb)).toBeGreaterThanOrEqual(3)
})

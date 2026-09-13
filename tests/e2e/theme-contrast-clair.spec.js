// Point B (lot correction-ux) : contraste AA du chip « Diagramme interactif »
// (.corr-chip--on, CorrectionView.vue) EN THÈME CLAIR — angle mort de
// theme-contrast.spec.js, qui ne couvre que le sombre (cf. son commentaire de tête).
// Texte 13px/600 sur --sage-tile-bg, un DÉGRADÉ (linear-gradient), donc « petit texte »
// (seuil AA 4.5:1, pas le seuil 3:1 du « grand texte » — il faudrait ≥ 14px) à mesurer
// contre CHACUN des deux arrêts de couleur, pas juste un point du dégradé.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

// --- Copié VERBATIM de tests/e2e/theme-contrast.spec.js (lui-même repris tel quel
// depuis icon-contrast.spec.js — convention du dépôt) ; composite() ajouté
// depuis theme-contrast.spec.js, même convention, pour composer l'alpha du texte. ---
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

function composite([r, g, b, a = 1], bg) {
  return [
    a * r + (1 - a) * bg[0],
    a * g + (1 - a) * bg[1],
    a * b + (1 - a) * bg[2],
  ]
}
// --- fin du bloc copié ---

// Bascule CLAIRE explicite (miroir de forceDark, theme-contrast.spec.js) : le thème
// 'system' par défaut dépend de l'environnement d'exécution, non déterministe.
async function forceLight(page) {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Clair', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light')
}

// Garde-fou anti-théâtre (miroir d'assertReallyDark) : un test de contraste qui mesure
// le mauvais thème passerait pour de mauvaises raisons — le garde de route réconcilie
// le thème depuis Dexie à CHAQUE navigation, donc on revérifie APRÈS avoir atterri sur
// l'écran de correction, pas seulement juste après le clic « Clair ».
async function assertReallyLight(page) {
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  // Défaut dynamique T2 (31/08) : bleu 230 en clair → rgb(243, 246, 254) (#f3f6fe).
  expect(bg).toBe('rgb(243, 246, 254)')
}

test('clair — chip « Diagramme interactif » (--sage-deep-strong sur --sage-tile-bg) atteint AA contre les deux arrêts du dégradé', async ({
  page,
}) => {
  await forceLight(page)

  // Bonnet Torsade (patron démo) porte déjà une section-diagramme : le chip
  // « Diagramme interactif » (corr-chip--on) s'affiche dès le dépli, sans bascule.
  await page.goto('/library')
  await page.getByRole('button', { name: 'Bonnet Torsade' }).click()
  await expect(page).toHaveURL(/\/pattern\/(\d+)/)
  const id = page.url().match(/\/pattern\/(\d+)/)[1]
  await page.goto(`/pattern/${id}/correct`)
  await assertReallyLight(page)

  const toggle = page.getByRole('button', { name: /Diagrammes \(\d+\)/ })
  await expect(toggle).toBeVisible()
  await toggle.click()

  const chip = page.locator('.corr-chip--on').first()
  await expect(chip).toBeVisible()

  // `getComputedStyle(el).backgroundColor` renvoie `transparent` sur un dégradé — il
  // faut lire `backgroundImage` et en extraire les DEUX arrêts par expression
  // régulière (le format `linear-gradient(165deg, #e7ecdd, #dde6d2)` est sérialisé par
  // le navigateur en `rgb(...)`, jamais en hexadécimal, d'où le motif rgba?\([^)]*\)).
  const { color, bgImage } = await chip.evaluate((el) => {
    const s = getComputedStyle(el)
    return { color: s.color, bgImage: s.backgroundImage }
  })
  const stops = bgImage.match(/rgba?\([^)]*\)/g)
  expect(stops, `backgroundImage inattendu (pas un dégradé lisible) : ${bgImage}`).not.toBeNull()
  expect(stops.length).toBeGreaterThanOrEqual(2)

  const fg = parse(color)
  const ratios = stops.map((stop) => contrast(fg, parse(stop)))
  console.log(`[contrast clair] chip diagramme texte(--sage-deep-strong)/dégradé(--sage-tile-bg) = ${ratios.map((r) => r.toFixed(2)).join(' ; ')}`)
  for (const ratio of ratios) {
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  }
})

// Miroir CLAIR du test sombre « texte sur bouton primaire (--on-accent) atteint AA »
// (theme-contrast.spec.js) — angle mort symétrique de celui qui a motivé ce fichier.
// Contexte (défaut 1) : le blanc mesuré à 3,96:1 sur le haut du
// dégradé (#bd6a40, palette d'avant T2) a été résorbé DE FACTO par la retouche AA des
// rôles brand/brandGradTop (theme/palette.js, « seule façon de garantir >= 4.5:1 sur
// les 360° ») ; le balayage unitaire (theme-palette.spec.js, tous les 2°) épingle les
// 360 teintes des DEUX thèmes — ici on mesure le rendu VIVANT au défaut dynamique
// clair (bleu 230), contre le PIRE arrêt du dégradé réellement rendu.
test('clair — texte sur bouton primaire (--on-accent) atteint AA', async ({ page }) => {
  await forceLight(page)
  await page.goto('/settings')
  await assertReallyLight(page)
  const btn = page.locator('.btn--primary').first()
  await expect(btn).toBeVisible()
  // Même méthode que le miroir sombre : backgroundColor renvoie transparent sur un
  // dégradé, on extrait les arrêts de backgroundImage (sérialisés en rgb()).
  const { fg, bgImg } = await btn.evaluate((el) => ({
    fg: getComputedStyle(el).color,
    bgImg: getComputedStyle(el).backgroundImage,
  }))
  const stops = bgImg.match(/rgba?\([^)]*\)/g).map((s) => parse(s))
  // Deux arrêts minimum, comme le test du chip : un dégradé silencieusement réduit à
  // un aplat ne doit pas passer pour de bonnes raisons.
  expect(stops.length).toBeGreaterThanOrEqual(2)
  let worst = Infinity
  for (const bgRgb of stops) {
    worst = Math.min(worst, contrast(composite(parse(fg), bgRgb), bgRgb))
  }
  console.log(`[contrast clair] bouton primaire (--on-accent)/(--brand-grad, pire arrêt) = ${worst.toFixed(2)}`)
  expect(worst).toBeGreaterThanOrEqual(4.5)
})

// Contexte (défaut 2) : le badge « En pause » (STATUS_META.pause) était rendu
// en --mustard (#e8b23a) = 1,79:1 sur --bg, illisible. Corrigé par --mustard-deep
// (#8a5a00, 5,48:1 en clair) ; en sombre le token vaut --mustard (#eab94f, 10,23:1,
// déjà conforme) — le défaut est purement clair, d'où la mesure ICI et non dans
// theme-contrast.spec.js. Élément VIVANT (convention de la suite) : on bascule le
// premier projet démo « En pause » via le menu du badge, exactement comme
// l'utilisatrice, puis on mesure le texte rendu sur son fond --bg.
test('clair — badge « En pause » (--mustard-deep sur --bg) atteint AA', async ({ page }) => {
  await forceLight(page)
  // Les cartes projet (et leur badge éditable) vivent sur l'ACCUEIL — /library liste
  // les patrons. completeOnboarding y atterrit déjà ; le goto explicite documente
  // l'écran mesuré.
  await page.goto('/')
  const badge = page.locator('.pcard__badge .badge').first()
  await expect(badge).toBeVisible()
  await badge.click()
  // Le déclencheur porte l'aria-label « Changer le statut » : le seul bouton nommé
  // « En pause » est l'item du menu qui vient de s'ouvrir.
  await page.getByRole('button', { name: 'En pause', exact: true }).click()
  await expect(badge).toContainText('En pause')

  const { fg, bg } = await badge.evaluate((el) => {
    const s = getComputedStyle(el)
    return { fg: s.color, bg: s.backgroundColor }
  })
  const bgRgb = parse(bg)
  const ratio = contrast(composite(parse(fg), bgRgb), bgRgb)
  console.log(`[contrast clair] badge pause texte(--mustard-deep)/fond(--bg) = ${ratio.toFixed(2)}`)
  expect(ratio).toBeGreaterThanOrEqual(4.5)
})

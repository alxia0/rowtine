// Parcours — grille (diagramme) inline : bouton agrandir → plein écran (ChartFullscreen),
// suivi rang/répétition partagé avec l'inline, et calage (frame) persistant.
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { completeOnboarding, openDemoReaderWithChart } from './helpers'
import { chartBands } from '../../src/utils/reader.js'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

// Copie locale de la fonction `audit` de tests/e2e/a11y.spec.js (non exportée là-bas ;
// pas d'import croisé entre specs Playwright pour ne pas coupler l'isolation des fichiers).
async function audit(page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const blocking = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))
  return blocking.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }))
}

test('grille : agrandir → plein écran, rang +, fermer → inline à jour', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await openDemoReaderWithChart(page)
  await page.locator('.chart__zoom').first().click()
  await expect(page.locator('.cfs')).toBeVisible()
  await page.locator('.cfs__next').click()
  await page.locator('.cfs__close').click()
  await expect(page.locator('.cfs')).toBeHidden()
  await expect(page.locator('.chart__val').first()).toContainText('2 /')
})

test('grille : caler persiste après rechargement', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await openDemoReaderWithChart(page)
  await page.locator('.chart__zoom').first().click()
  await page.locator('.cfs__cal').click()
  const canvas = page.locator('.cfs__canvas')
  const box = await canvas.boundingBox()
  const top = page.locator('.cfs__handle--top')
  await top.hover()
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.1)
  await page.mouse.up()
  await page.locator('.cfs__calsave').click()
  await page.locator('.cfs__close').click()
  await page.reload()
  await openDemoReaderWithChart(page)

  // Le surlignage inline doit refléter le frame calé. NOTE (adaptation du squelette du
  // plan) : le patron de démo (Bonnet Torsade) a 24 rangs — au rang 1 (le plus
  // bas), la formule chartBands donne un `top` PROCHE du bas du cadre que le calage soit
  // actif ou non (row=1 est déjà tout en bas du cadre, quel que soit le déplacement de la
  // seule poignée du HAUT) : une comparaison de préfixe de chaîne (« top: … ») est donc
  // trompeuse ici. On compare plutôt la valeur numérique réelle à la valeur plein-cadre
  // calculée par la même fonction (chartBands) que le composant utilise : tout calage
  // non nul l'écarte, même légèrement, de la référence plein-cadre.
  const hl = page.locator('.chart__hl').first()
  const style = await hl.getAttribute('style')
  const m = style.match(/top:\s*([\d.]+)%/)
  expect(m).not.toBeNull()
  const gotTop = Number(m[1])
  const fullFrame = chartBands(1, 24, null)
  expect(Math.abs(gotTop - fullFrame.hlTop)).toBeGreaterThan(0.03)
})

test('plein écran diagramme — sans violation a11y bloquante', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await openDemoReaderWithChart(page)
  await page.locator('.chart__zoom').first().click()
  await expect(page.locator('.cfs')).toBeVisible()
  expect(await audit(page)).toEqual([])
})

// Retour device 28/07 : à 28 px de pastille (zone tactile 44 px), la poignée du rideau est
// difficile à viser au doigt sur tablette — ~7 mm sur un écran à 320 dpi, contre les 9 mm
// recommandés. Elle grossit au-dessus de 900 px de large ; sur téléphone elle ne bouge pas,
// où sa taille a été validée sur appareil et où une pastille plus grosse masquerait des mailles.
//
// Scopé à `.cfs` (la fenêtre plein écran), comme le test des butées plus bas : à 1024 px
// le lecteur à deux volets est aussi actif et affiche SA PROPRE poignée dans le volet
// droit — sans ce scope le sélecteur global est ambigu (2 éléments portent ces classes).
async function tailleDeLaPoignee(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('.cfs')
    const grip = dialog.querySelector('.cfs__curtain-grip')
    const line = dialog.querySelector('.cfs__curtain-line')
    return {
      pastille: Math.round(grip.getBoundingClientRect().width),
      zone: Math.round(line.getBoundingClientRect().width),
    }
  })
}

test('poignée du rideau : inchangée sur téléphone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await completeOnboarding(page, { firstName: 'Alex' })
  await openDemoReaderWithChart(page)
  await page.locator('.chart__zoom').first().click()
  await expect(page.locator('.cfs')).toBeVisible()
  expect(await tailleDeLaPoignee(page)).toEqual({ pastille: 28, zone: 44 })
})

test('poignée du rideau : plus grande sur grand écran', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await completeOnboarding(page, { firstName: 'Alex' })
  await openDemoReaderWithChart(page)
  await page.locator('.chart__zoom').first().click()
  await expect(page.locator('.cfs')).toBeVisible()
  expect(await tailleDeLaPoignee(page)).toEqual({ pastille: 40, zone: 56 })
})

// Retour device 28/07 : le clamp() du `left` de .cfs__curtain-line (voir commentaire dans
// ChartStage.vue) borne la position sur --cfs-grip-w pour que la poignée ne déborde pas des
// bords de l'image aux positions extrêmes. Une poignée plus large agrandit cette marge :
// vérifié ici par la mesure, aux deux butées, à 1024 px de large (seuil grand écran).
test('poignée du rideau : ne déborde pas du viewport aux butées (1024 px)', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await completeOnboarding(page, { firstName: 'Alex' })
  await openDemoReaderWithChart(page)
  await page.locator('.chart__zoom').first().click()
  await expect(page.locator('.cfs')).toBeVisible()

  // Scoper à la boîte de dialogue plein écran (.cfs) : à 1024 px le lecteur à deux volets
  // est aussi actif et affiche SA PROPRE .cfs__curtain-line épinglée dans le volet — sans
  // ce scope, le sélecteur global est ambigu (2 éléments).
  const dialog = page.locator('.cfs')
  const line = dialog.locator('.cfs__curtain-line')
  await line.focus()

  async function assertGripInsideViewport() {
    const grip = await dialog.locator('.cfs__curtain-grip').boundingBox()
    const viewport = await dialog.locator('.cfs__viewport').boundingBox()
    expect(grip.x).toBeGreaterThanOrEqual(viewport.x - 1)
    expect(grip.x + grip.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1)
  }

  // Butée gauche (0 %) : 20 × Maj+Flèche gauche (pas de 5) suffit à atteindre l'extrême.
  for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowLeft')
  await assertGripInsideViewport()

  // Butée droite (100 %).
  for (let i = 0; i < 40; i++) await page.keyboard.press('Shift+ArrowRight')
  await assertGripInsideViewport()
})

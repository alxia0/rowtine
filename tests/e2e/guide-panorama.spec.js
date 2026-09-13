// e2e — la capture PANORAMIQUE de l'année s'ouvre pivotée et lisible (12/08/2026).
//
// Constat sur appareil : `07c-stats-annee.webp` (1920 × 305, une année entière de grille
// calendaire) s'ouvrait sur un téléphone tenu verticalement en une bande de quelques
// millimètres de haut — lisible seulement après un pincement. La visionneuse la présente
// désormais d'un quart de tour, assez grande pour être comprise sans geste.
//
// Ce test tourne sur le projet `android-pixel5` (viewport 393 × 851, portrait) : c'est
// exactement le cas visé. Il est le SEUL à exercer un vrai moteur de rendu — jsdom, où vivent
// les tests unitaires, ne décode aucune image et ne calcule aucune mise en page.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers.js'

// Rapport largeur/hauteur de l'empreinte À L'ÉCRAN, mesuré, selon l'état :
//   • pivotée (attendu)  : 305 / 1920 = 0,159
//   • NON pivotée (bug)  : 1920 / 305 = 6,30
//   • image pas encore décodée : `canvasStyle` retombe sur { 100 %, 100 % }, soit la taille du
//     viewport entier, ≈ 0,44 — un état qui remplit bien l'écran SANS aucune rotation.
// C'est ce troisième état qui rend une assertion de seule HAUTEUR incapable d'échouer : elle
// passerait au vert sur le repli. On discrimine donc sur le RAPPORT, et on attend le décodage.
const RAPPORT_MAX_PIVOTE = 0.25

test('Guide : la capture de l’année s’ouvre pivotée et occupe presque toute la hauteur de l’écran', async ({
  page,
}) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/guide')
  await expect(page.locator('.section')).toHaveCount(10)

  // La section Statistiques, trouvée par la figure qu'elle porte plutôt que par son numéro :
  // un remaniement du contenu du guide ne doit pas casser ce test en silence. Un <details>
  // replié garde ses figures dans le DOM, on peut donc les localiser avant de l'ouvrir.
  // `07c-stats-annee` sans extension ni dossier : la même capture existe en clair et en sombre,
  // et dans les quatre langues.
  const vignette = page.locator('.figure__btn').filter({ has: page.locator('img[src*="07c-stats-annee"]') })
  await expect(vignette).toHaveCount(1)
  const section = page.locator('.section').filter({ has: vignette })
  await section.locator('summary').click()
  await expect(vignette).toBeVisible()

  await vignette.click()
  const visionneuse = page.locator('.lb[role="dialog"]')
  await expect(visionneuse).toBeVisible()
  const img = visionneuse.locator('[data-test="lb-img"]')
  await expect(img).toHaveAttribute('src', /07c-stats-annee/)

  // Attendre le DÉCODAGE : `canvasStyle` ne connaît les dimensions qu'à l'événement `load`, et
  // le critère de rotation en dépend. Sans cette attente, une mesure prise juste après le clic
  // peut tomber sur l'état de repli — un faux vert, ou un faux rouge, selon le hasard.
  await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0)
  await expect(img).toHaveAttribute('data-rotated', 'true')

  // Mesure du RENDU réel. `boundingBox()` renvoie la boîte englobante APRÈS transformation :
  // pour une rotation d'un quart de tour, c'est bien l'empreinte visible à l'écran.
  // Le viewport est relu en direct plutôt que codé en dur : le test ne doit pas dépendre des
  // marges de `.lb` ni de la taille exacte de l'appareil émulé.
  const boiteViewport = await visionneuse.locator('.lb__viewport').boundingBox()
  const boiteImg = await img.boundingBox()

  // 1. Elle est bien PIVOTÉE : son empreinte est nettement plus haute que large, alors que
  //    l'image, elle, est six fois plus large que haute.
  expect(
    boiteImg.width / boiteImg.height,
    `empreinte ${Math.round(boiteImg.width)} × ${Math.round(boiteImg.height)} : la capture n'est pas pivotée`,
  ).toBeLessThan(RAPPORT_MAX_PIVOTE)

  // 2. Elle occupe une part SUBSTANTIELLE de l'écran : presque toute la hauteur du viewport.
  //    Un élément peut être « visible » en CSS et rendu minuscule ou hors cadre.
  expect(boiteImg.height).toBeGreaterThan(boiteViewport.height * 0.9)

  // 3. Elle tient ENTIÈREMENT dans le viewport (rien de rogné, rien qui déborde) : la marge de
  //    1 px absorbe les arrondis de mise en page du moteur.
  expect(boiteImg.width).toBeLessThanOrEqual(boiteViewport.width + 1)
  expect(boiteImg.height).toBeLessThanOrEqual(boiteViewport.height + 1)

  // 4. Et le viewport n'est PAS devenu défilant à taille normale : la boîte de mise en page de
  //    l'image pivotée est bien plus large que le canvas, et si elle débordait, le défilement
  //    natif et le balayage « figure suivante » redeviendraient actifs en même temps — le
  //    conflit que le lot du 09/08 avait éliminé.
  const debordement = await visionneuse
    .locator('.lb__viewport')
    .evaluate((el) => ({ x: el.scrollWidth - el.clientWidth, y: el.scrollHeight - el.clientHeight }))
  expect(debordement.x, 'le viewport est devenu défilant horizontalement à zoom 100 %').toBeLessThanOrEqual(1)
  expect(debordement.y, 'le viewport est devenu défilant verticalement à zoom 100 %').toBeLessThanOrEqual(1)

  // La fermeture marche toujours sur une figure pivotée.
  await page.keyboard.press('Escape')
  await expect(visionneuse).toHaveCount(0)
  await expect(page).toHaveURL(/\/guide$/)
})

// Le pendant indispensable : sans lui, « pivoter TOUTES les images » passerait le test ci-dessus.
test('Guide : une capture ordinaire du même guide n’est PAS pivotée', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/guide')
  await expect(page.locator('.section')).toHaveCount(10)

  // La première figure du guide : une capture d'écran de téléphone (480 × 888, plus haute que
  // large) — le cas le plus courant, et celui qui ne doit strictement rien changer.
  const premiere = page.locator('.figure__btn').first()
  const sectionPremiere = page.locator('.section').filter({ has: premiere }).first()
  await sectionPremiere.locator('summary').click()
  await expect(premiere).toBeVisible()
  await premiere.click()

  const visionneuse = page.locator('.lb[role="dialog"]')
  await expect(visionneuse).toBeVisible()
  const img = visionneuse.locator('[data-test="lb-img"]')
  await expect.poll(() => img.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0)
  await expect(img).toHaveAttribute('data-rotated', 'false')

  // Et son rendu est bien celui d'avant ce lot : plafonné par la LARGEUR du viewport.
  const boiteViewport = await visionneuse.locator('.lb__viewport').boundingBox()
  const boiteImg = await img.boundingBox()
  expect(boiteImg.width).toBeCloseTo(boiteViewport.width, 0)
  expect(boiteImg.height).toBeLessThanOrEqual(boiteViewport.height + 1)
})

// Défaut remonté par un retour terrain le 25/07 : avec beaucoup de pelotes, les totaux du stock
// dépassaient 4 chiffres et l'en-tête débordait un peu de l'écran.
//
// Trois causes, trois corrections, un seul symptôme visible : le format (bascule km/kg,
// cf. src/utils/units.js), la grille (`grid-auto-columns: 1fr` a un `min-width: auto`
// implicite, la piste refusait de se comprimer) ET la police (`clamp()` sur `.recap__num`,
// arbitrage produit du 25/07 après comparaison de 3 captures d'écran). Ces deux derniers correctifs ne se laissent PAS co-prouver dans un
// seul scénario : réduire la police pour faire tenir le chiffre dans sa tuile supprime
// mécaniquement la marge dont la preuve par mutation de la grille a besoin (mesuré, cf.
// rapport). D'où deux tests séparés ci-dessous, chacun avec le scénario qui le rend
// discriminant.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

// Ajoute une laine avec un métrage, un poids et un prix — variante du helper local de
// stash.spec.js, qui ne remplit que la quantité.
async function addYarn(page, { brand, colorKey, qty, lengthM, grams, price }) {
  await page.getByRole('button', { name: /Ajouter une laine/ }).click()
  await page.locator('.addform select').first().selectOption('__other__')
  await page.locator('input[placeholder="Saisis la marque"]').fill(brand)
  await page.locator(`.palette__sw[aria-label="${colorKey}"]`).click()
  await page.locator('input[placeholder="100"]').fill(String(lengthM))
  await page.locator('input[placeholder="50"]').fill(String(grams))
  await page.locator('input[placeholder="1"]').fill(String(qty))
  await page.locator('input[placeholder="—"]').fill(String(price))
  await page.getByRole('button', { name: 'Enregistrer' }).click()
}

async function setup(page, { qty = 99 } = {}) {
  await completeOnboarding(page, { firstName: 'Alex' })
  // 360 px : l'écran étroit le plus courant, le pire cas pour 4 tuiles côte à côte.
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/stash')
  // 99 pelotes × 497 m = 49 203 m ; × 98 g = 9 702 g ; × 14,90 € = 1 475 €.
  // (qty=251 → 124 747 m, cas 7 caractères du correctif 1.)
  await addYarn(page, { brand: 'Maison', colorKey: 'rouge', qty, lengthM: 497, grams: 98, price: '14,90' })
  return page.locator('.recap')
}

test('les totaux du stock basculent en km/kg et chaque chiffre tient dans sa tuile', async ({ page }) => {
  const recap = await setup(page)
  await expect(recap).toBeVisible()

  // 1. Les unités ont bien basculé.
  await expect(recap).toContainText('km')
  await expect(recap).toContainText('kg')

  // 2. Les 4 tuiles sont bien présentes (le prix fait apparaître la 4e).
  await expect(page.locator('.recap__stat')).toHaveCount(4)

  // 3. Aucun débordement horizontal de la page.
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(pageOverflow).toBeLessThanOrEqual(0)

  // 4. Ni de la grille du récap elle-même.
  const recapOverflow = await recap.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(recapOverflow).toBeLessThanOrEqual(0)

  // 5. Ni du nombre dans sa propre tuile : `clamp(13px, 4.2vw, 22px)` sur `.recap__num`
  //    réduit la police juste ce qu'il faut sur écran étroit (mesuré : 0-1 px de reste).
  //    Preuve par mutation : retirer le `clamp`
  //    (retour à `font-size: 22px` fixe) fait tomber CETTE assertion à 25 px de
  //    débordement — c'est le garde-fou contre une régression de taille de police.
  //    Tolérance 3px (et non 1px) : la mesure de référence vaut 0-1px, la mutation en
  //    donne 25 — tout le pouvoir discriminant reste, sans dépendre du rendu de police
  //    de la machine (correctif 2).
  for (const num of await page.locator('.recap__num').all()) {
    const overflow = await num.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(3) // 3 px de tolérance sub-pixel (correctif 2)
  }
})

test('les totaux à 7 chiffres ne débordent pas non plus de leur tuile', async ({ page }) => {
  // 251 pelotes × 497 m = 124 747 m → « 124,747 » km, 7 caractères. Mesuré (correctif 1) :
  // avant le resserrement du padding/gap, ce nombre débordait de sa tuile de 5px à 360px ;
  // après (padding var(--sp-3) var(--sp-2), gap var(--sp-1)), le débordement tombe à 0px —
  // sans la marge récupérée, le défaut d'origine reviendrait.
  const recap = await setup(page, { qty: 251 })
  await expect(recap).toBeVisible()
  await expect(recap).toContainText('km')

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(pageOverflow).toBeLessThanOrEqual(0)

  const recapOverflow = await recap.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(recapOverflow).toBeLessThanOrEqual(0)

  for (const num of await page.locator('.recap__num').all()) {
    const overflow = await num.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(3) // 3px de tolérance sub-pixel (correctif 2)
  }
})

test('la grille ne déborde plus de l’écran, même avec l’ancienne police fixe', async ({ page }) => {
  // Ce test prouve `minmax(0, 1fr)` isolément. Avec la police réduite (clamp) ET la marge
  // de largeur récupérée par le correctif 1 (padding/gap resserrés), le scénario à qty=99
  // ne met PLUS la grille sous tension : la mutation `grid-auto-columns: 1fr` y passerait
  // inaperçue (mesuré : 0 px de débordement dans les deux cas, revérifié après correctif 1).
  // On prend donc le scénario à 7 caractères (qty=251, le pire cas du correctif 1) ET on
  // force `font-size: 22px` par-dessus le clamp, pour recréer une tension réelle sur la
  // grille et vérifier qu'elle seule absorbe le débordement, indépendamment de tout choix
  // de police futur.
  const recap = await setup(page, { qty: 251 })
  await page.addStyleTag({ content: '.recap__num { font-size: 22px !important; }' })
  await expect(recap).toBeVisible()

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(pageOverflow).toBeLessThanOrEqual(0)

  const recapOverflow = await recap.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(recapOverflow).toBeLessThanOrEqual(0)
})

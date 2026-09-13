// (P2, audit UX 17/07) — cases à cocher maison (AppCheckbox), remplace les
// cases natives du navigateur (~16 px, style système) sur les 3 usages : CounterForm
// (suivre augm./dim., suivre répétitions) et ProjectEditView (sélection des laines,
// sélection MULTIPLE + pool de pelotes device-validé).
//
// Ce que l'unitaire (jsdom) ne peut pas prouver et que ce fichier vérifie en réel :
// - cible tactile ≥ 44 px (bounding box réelle du navigateur)
// - Tab atteint le vrai <input>, Espace le coche, l'anneau de focus est visible
// - toute la ligne (le texte compris, pas juste la pastille visuelle) est cliquable
// - l'input réel n'est ni display:none (WCAG 2.1.1) ni « visible » au sens Playwright
//   (piège opacity:0+inset:0 déjà rencontré — ici c'est le motif 1×1 px +
//   clip-path qui doit s'appliquer, cf. `.lib-import__input` de LibraryView).
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

// Reprend le helper local de tests/e2e/stash.spec.js (marque libre + coloris palette),
// avec une attente explicite de la fermeture du formulaire (l'enregistrement est
// asynchrone — sans cette attente, un 2ᵉ appel enchaîné peut cliquer « Ajouter une
// laine » avant que le store ait fini d'écrire la 1ʳᵉ laine).
async function addYarn(page, { brand, colorKey, qty }) {
  await page.getByRole('button', { name: /Ajouter une laine/ }).click()
  await page.locator('.addform select').first().selectOption('__other__')
  await page.locator('input[placeholder="Saisis la marque"]').fill(brand)
  await page.locator(`.palette__sw[aria-label="${colorKey}"]`).click()
  await page.locator('input[placeholder="1"]').fill(String(qty))
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  // Le panneau refermé signe la fin des DEUX écritures (fiche + ligne d'achat) depuis le
  // correctif du 06/08 : on l'attend AVANT de chercher la carte.
  await expect(page.locator('.addform')).toHaveCount(0)
  // Cibler la carte du stock, et non n'importe quel texte : tant que le formulaire est
  // ouvert, `getByText(/Drops/)` attrape aussi l'<option> « Drops » du catalogue de
  // marques (violation du mode strict), ce qui n'a rien à voir avec la laine créée.
  await expect(page.locator('.ycard__name').filter({ hasText: brand })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
})

test.describe('AppCheckbox — CounterForm (compteur indépendant)', () => {
  test('cible tactile ≥ 44 px ; cliquer le TEXTE (pas la pastille) coche la case', async ({ page }) => {
    await page.goto('/counters')

    const row = page.locator('.chk').first()
    await expect(row).toBeVisible()
    const box = await row.boundingBox()
    expect(box.height).toBeGreaterThanOrEqual(44)

    await page.getByText('Suivre des augmentations / diminutions').click()
    await expect(page.locator('input[type="checkbox"]').first()).toBeChecked()
    // Le câblage n'est pas cassé : les champs de forme apparaissent bien.
    await expect(page.getByText('Augmentation', { exact: true })).toBeVisible()
    await expect(page.getByText('Diminution', { exact: true })).toBeVisible()
  })

  test('input réel présent, jamais display:none, focalisable au clavier (WCAG 2.1.1)', async ({ page }) => {
    await page.goto('/counters')

    const input = page.locator('.chk__input').first()
    await expect(input).toHaveCount(1)
    await expect(input).not.toHaveCSS('display', 'none')
    await input.focus()
    await expect(input).toBeFocused()
  })

  test('Tab atteint la case, Espace la coche ; anneau de focus visible sur la case', async ({ page }) => {
    await page.goto('/counters')

    const nameField = page.locator('input[placeholder="Nom du compteur"]')
    await nameField.focus()
    await page.keyboard.press('Tab') // -> 1ère case (suivre augm./dim.)

    const firstRow = page.locator('.chk').first()
    const input = firstRow.locator('input[type="checkbox"]')
    await expect(input).toBeFocused()

    // L'anneau est porté par la CASE, pas par la ligne : depuis le 19/07 (b56456f)
    // `.chk:focus-within` a été remplacé par `.chk__input:focus-visible + .chk__box`
    // (l'anneau persistait après un tap tactile). Ce test visait encore `.chk` et était
    // donc rouge en permanence depuis — corrigé le 29/07 en visant la vraie cible.
    await expect(firstRow.locator('.chk__box')).not.toHaveCSS('outline-style', 'none')
    // Discriminant : sans le focus clavier, aucune autre case ne porte d'anneau — sinon
    // l'assertion ci-dessus passerait aussi avec un `outline` posé en permanence.
    await expect(page.locator('.chk').nth(1).locator('.chk__box')).toHaveCSS('outline-style', 'none')

    await page.keyboard.press('Space')
    await expect(input).toBeChecked()
  })
})

test.describe('AppCheckbox — ProjectEditView (sélection des laines, pool de pelotes)', () => {
  test('cible tactile ≥ 44 px, sélection MULTIPLE non cassée, pool de pelotes intact', async ({ page }) => {
    await page.goto('/stash')
    // Écran vide : depuis le 20/07 c'est une carte exemple + accroche
    // (« … Ajoute ta première laine … ») qui remplace l'ancien « Stock vide. ».
    await expect(page.getByText(/Ajoute ta première laine/)).toBeVisible()
    await addYarn(page, { brand: 'Drops', colorKey: 'bleu', qty: 4 })
    await addYarn(page, { brand: 'Phildar', colorKey: 'vert', qty: 2 })

    await page.goto('/project/new')
    await page.locator('#name').fill('Pull test')

    // Depuis le filtre par marque (18/08) : la liste reste vide tant qu'aucune
    // marque n'est choisie. On coche Drops sous son propre filtre (les laines cochées
    // restent toujours visibles, quelle que soit la marque affichée ensuite), puis on
    // bascule sur Phildar pour faire apparaître les deux laines ensemble.
    await page.locator('.ypick__brandfilter select').selectOption('Drops')
    await page.locator('.ypick__row', { hasText: 'Drops' }).getByText(/Drops/).click()
    await page.locator('.ypick__brandfilter select').selectOption('Phildar')

    const rows = page.locator('.ypick__row')
    await expect(rows).toHaveCount(2)
    // Ordre d'affichage NON garanti = ordre d'insertion (liste triée côté store) : on
    // localise chaque ligne par sa marque, jamais par index.
    const dropsRow = page.locator('.ypick__row', { hasText: 'Drops' })
    const phildarRow = page.locator('.ypick__row', { hasText: 'Phildar' })
    for (const row of [dropsRow, phildarRow]) {
      const box = await row.locator('.ypick__pick').boundingBox()
      expect(box.height).toBeGreaterThanOrEqual(44)
    }

    // Drops est déjà cochée (ci-dessus) ; coche Phildar en cliquant sur son texte (toute
    // la ligne cliquable).
    await phildarRow.getByText(/Phildar/).click()
    await expect(dropsRow.locator('input[type="checkbox"]')).toBeChecked()
    await expect(phildarRow.locator('input[type="checkbox"]')).toBeChecked()

    // Pool de pelotes : le sélecteur de quantité apparaît pour les 2, borné au dispo.
    await expect(page.locator('.ypick__qtyin')).toHaveCount(2)
    await expect(dropsRow.locator('.ypick__qtyin')).toHaveAttribute('max', '4')
    await expect(phildarRow.locator('.ypick__qtyin')).toHaveAttribute('max', '2')

    // Décocher Drops ne touche pas Phildar (sélection multiple préservée). On repasse le
    // filtre sur Drops pour que sa ligne reste affichée après décochage — sinon, resté
    // sur Phildar, la ligne Drops décochée disparaîtrait de la vue (elle ne serait plus
    // ni cochée ni de la marque filtrée) et l'assertion ci-dessous n'aurait plus de ligne
    // à interroger.
    await page.locator('.ypick__brandfilter select').selectOption('Drops')
    await dropsRow.getByText(/Drops/).click()
    await expect(dropsRow.locator('input[type="checkbox"]')).not.toBeChecked()
    await expect(phildarRow.locator('input[type="checkbox"]')).toBeChecked()
    await expect(page.locator('.ypick__qtyin')).toHaveCount(1)
  })
})

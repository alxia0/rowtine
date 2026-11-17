// Parcours « Mes outils » (lot stock d'outils, spec interne) :
// écran vide, ajout d'une circulaire, d'un kit et d'un crochet, filtre par taille, duplication,
// suppression annulable. Libellés français : la suite ordinaire tourne en locale fr-FR.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

// Les types se choisissent sur une grille de boutons (aria-pressed) ; les valeurs des listes
// (taille, longueur) sont des nombres : on passe par la valeur, indépendante de la langue.
async function chooseType(page, key) {
  await page.locator(`[data-test="type-${key}"]`).click()
  await expect(page.locator(`[data-test="type-${key}"]`)).toHaveAttribute('aria-pressed', 'true')
}

// Case maison (AppCheckbox) : le vrai input est masqué, on clique l'étiquette comme un doigt,
// puis on exige que l'input soit bien coché (un clic qui ne coche rien ne doit pas passer).
async function tick(page, kind, value) {
  const pill = page.locator(`[data-test="${kind}"][data-value="${value}"]`)
  await pill.locator('label').click()
  await expect(pill.getByRole('checkbox')).toBeChecked()
}

async function save(page) {
  await page.locator('[data-test="tool-save"]').click()
  // Enregistrer mène à la fiche : c'est le signal que l'écriture est faite.
  await page.waitForURL(/\/tools\/\d+$/)
}

async function addCircular(page, { brand = 'ChiaoGoo', line = '' } = {}) {
  await page.getByRole('button', { name: 'Ajouter un outil' }).click()
  await page.waitForURL('**/tools/new')
  await chooseType(page, 'circular')
  await page.locator('#tool-size').selectOption('4')
  await page.locator('#tool-length').selectOption('80')
  await page.locator('#tool-material').selectOption('bamboo')
  await page.locator('#tool-brand').fill(brand)
  if (line) await page.locator('#tool-line').fill(line)
  await save(page)
}

async function addKit(page) {
  await page.goto('/tools')
  await page.getByRole('button', { name: 'Ajouter un outil' }).click()
  await page.waitForURL('**/tools/new')
  await chooseType(page, 'interchangeable')
  for (const mm of ['3.5', '4', '5']) await tick(page, 'kit-size', mm)
  for (const cm of ['60', '80']) await tick(page, 'kit-cable', cm)
  await page.locator('#tool-brand').fill('KnitPro')
  await page.locator('#tool-line').fill('Zing')
  await save(page)
}

async function addHook(page) {
  await page.goto('/tools')
  await page.getByRole('button', { name: 'Ajouter un outil' }).click()
  await page.waitForURL('**/tools/new')
  await chooseType(page, 'standard')
  await page.locator('#tool-size').selectOption('5')
  await page.locator('#tool-handle').selectOption('ergonomic')
  await save(page)
}

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
})

test('parcours complet : ajout, kit, filtre par taille, duplication, corbeille', async ({ page }) => {
  // 1. Le menu mène à « Mes outils » ; écran vide.
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: 'Mes outils' }).click()
  await page.waitForURL('**/tools')
  await expect(page.getByText(/Aucun outil pour l’instant/)).toBeVisible()
  // La ligne d'exemple (aria-hidden, inerte) n'est pas un outil : aucune ligne de la vraie liste.
  await expect(page.locator('.tlist .trow')).toHaveCount(0)

  // 2. Une circulaire 4 mm, 80 cm, bambou, ChiaoGoo.
  await addCircular(page)
  await expect(page.getByRole('heading', { level: 1, name: /4 mm/ })).toBeVisible()
  await page.goto('/tools')
  await expect(page.locator('.tlist .trow')).toHaveCount(1)
  // Ligne 1 : la marque, puis la taille ; ligne 2 : type, longueur, matière, puis l'état.
  await expect(page.locator('.tlist .trow').first().locator('.trow__title')).toHaveText('ChiaoGoo · 4 mm · US 6')
  await expect(page.locator('.tlist .trow').first().locator('.trow__sub')).toHaveText('circ. 80 cm · bambou · disponible')

  // 3. Un kit KnitPro Zing : 3,5 / 4 / 5 mm et câbles 60 / 80 cm.
  await addKit(page)
  await expect(page.locator('[data-test="kit-size"]')).toHaveCount(3)
  await expect(page.locator('[data-test="kit-cable"]')).toHaveCount(2)
  // La fiche du kit nomme chaque taille et chaque câble (ordre croissant), pas seulement leur nombre.
  const kitSizes = page.locator('[data-test="kit-size"]')
  await expect(kitSizes.nth(0)).toHaveText(/^3,5 mm/)
  await expect(kitSizes.nth(1)).toHaveText(/^4 mm/)
  await expect(kitSizes.nth(2)).toHaveText(/^5 mm/)
  await expect(page.locator('[data-test="kit-cable"]').nth(0)).toHaveText(/^60 cm$/)
  await expect(page.locator('[data-test="kit-cable"]').nth(1)).toHaveText(/^80 cm$/)

  // 4. Un crochet 5 mm ergonomique.
  await addHook(page)
  // La fiche du crochet dit la poignée choisie.
  await expect(page.getByText('ergonomique')).toBeVisible()
  await page.goto('/tools')
  await expect(page.locator('.tlist .trow')).toHaveCount(3)

  // 5. « Par taille », pastille 4 mm : exactement deux lignes, la circulaire et les pointes du kit.
  await page.getByRole('button', { name: 'Par taille' }).click()
  await expect(page.getByRole('button', { name: 'Par taille' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Filtrer sur 4 mm' }).click()
  await expect(page.getByRole('button', { name: 'Filtrer sur 4 mm' })).toHaveAttribute('aria-pressed', 'true')
  const rows = page.locator('.tlist .trow')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'ChiaoGoo' })).toHaveCount(1)
  await expect(rows.filter({ hasText: 'pointes du kit KnitPro Zing' })).toHaveCount(1)
  // Le crochet de 5 mm n'est PAS dans le filtre.
  await expect(rows.filter({ hasText: 'crochet' })).toHaveCount(0)

  // 6. Ouvrir la circulaire, la dupliquer, passer à 60 cm : deux circulaires 4 mm.
  await rows.filter({ hasText: 'ChiaoGoo' }).click()
  await page.waitForURL(/\/tools\/\d+$/)
  await page.getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('button', { name: 'Dupliquer' }).click()
  await page.waitForURL(/\/tools\/new\?duplicateFrom=/)
  // Le formulaire reprend la fiche source avant toute retouche.
  await expect(page.locator('#tool-length')).toHaveValue('80')
  await page.locator('#tool-length').selectOption('60')
  await save(page)
  await page.goto('/tools')
  await page.getByRole('button', { name: 'Par type' }).click()
  const circulars = page.locator('.tlist .trow').filter({ hasText: 'circ.' })
  await expect(circulars).toHaveCount(2)
  await expect(circulars.filter({ hasText: '80 cm' })).toHaveCount(1)
  await expect(circulars.filter({ hasText: '60 cm' })).toHaveCount(1)
  await expect(circulars.filter({ hasText: '4 mm' })).toHaveCount(2)

  // 7. Supprimer le crochet, puis « Annuler » dans la snackbar : il revient.
  const hook = page.locator('.tlist .trow').filter({ hasText: 'crochet' })
  await expect(hook).toHaveCount(1)
  await hook.click()
  await page.waitForURL(/\/tools\/\d+$/)
  await page.getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('button', { name: 'Supprimer' }).click()
  await page.waitForURL('**/tools')
  await expect(page.getByText('Outil supprimé.')).toBeVisible()
  await expect(page.locator('.tlist .trow').filter({ hasText: 'crochet' })).toHaveCount(0)
  await expect(page.locator('.tlist .trow')).toHaveCount(3)
  await page.getByRole('button', { name: 'Annuler' }).click()
  await expect(page.locator('.tlist .trow').filter({ hasText: 'crochet' })).toHaveCount(1)
  await expect(page.locator('.tlist .trow')).toHaveCount(4)
})

// Lien outil <-> projet (lot 4, spec interne) : lier une
// circulaire 4 mm à un projet en cours depuis sa fiche, puis retrouver le lien des deux côtés.
test('kit de crochets 4 et 5 mm : retrouvé sous la pastille 4 mm, « crochets du kit »', async ({ page }) => {
  await page.goto('/tools')
  await page.getByRole('button', { name: 'Ajouter un outil' }).click()
  await page.waitForURL('**/tools/new')
  await chooseType(page, 'hookKit')
  for (const mm of ['4', '5']) await tick(page, 'kit-size', mm)
  await page.locator('#tool-brand').fill('ChiaoGoo')
  await save(page)
  await expect(page.locator('[data-test="kit-size"]').nth(0)).toHaveText(/^4 mm · G-6/)
  await page.goto('/tools')
  await page.getByRole('button', { name: 'Par taille' }).click()
  await page.getByRole('button', { name: 'Filtrer sur 4 mm' }).click()
  const rows = page.locator('.tlist .trow')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('crochets du kit ChiaoGoo')
})

// Diamètre de la fixation (spec 2026-11-17) : un 80 cm S et un 80 cm L se retrouvent séparément.
test('kit : un câble de 80 cm S et un de 80 cm L restent deux câbles sur la fiche', async ({ page }) => {
  await page.goto('/tools')
  await page.getByRole('button', { name: 'Ajouter un outil' }).click()
  await page.waitForURL('**/tools/new')
  await chooseType(page, 'interchangeable')
  await tick(page, 'kit-size', '4')
  await page.getByRole('radio', { name: 'S', exact: true }).click()
  await tick(page, 'kit-cable', '80')
  await page.getByRole('radio', { name: 'L', exact: true }).click()
  await expect(page.locator('[data-test="kit-cable"][data-value="80"]').getByRole('checkbox')).not.toBeChecked()
  await tick(page, 'kit-cable', '80')
  await expect(page.locator('[data-test="cable-summary"]')).toHaveText('80 cm S, 80 cm L')
  await save(page)
  const cables = page.locator('[data-test="kit-cable"]')
  await expect(cables).toHaveCount(2)
  await expect(cables.nth(0)).toHaveText('80 cm S')
  await expect(cables.nth(1)).toHaveText('80 cm L')
})

test('lier une circulaire à un projet en cours, « en cours » dans Mes outils, projet sur la fiche', async ({ page }) => {
  await page.goto('/tools')
  await addCircular(page)
  // Un crochet 5 mm : hors des tailles du projet, il doit passer après la circulaire.
  await addHook(page)

  // Projet tricot 4 mm, passé « En cours » dès la création.
  await page.goto('/')
  await page.getByRole('button', { name: /Créer un projet/ }).click()
  await page.locator('#name').fill('Bonnet rayé')
  await page.locator('#needle-mm-0').fill('4')
  await page.getByRole('button', { name: 'En cours', exact: true }).click()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  const projectUrl = page.url()

  // Onglet Détails : la tuile « Mes outils » propose de choisir des outils.
  await page.getByRole('tab', { name: 'Détails' }).click()
  const tile = page.locator('[data-test="project-tools"]')
  await expect(tile).toContainText('Aucun outil lié')
  await tile.getByRole('button', { name: 'Choisir des outils' }).click()

  // La feuille : la circulaire 4 mm en tête, sous « Aux tailles du projet » ; le crochet après.
  const sheet = page.getByRole('dialog', { name: 'Choisir des outils' })
  await expect(sheet).toBeVisible()
  const groups = sheet.locator('[data-test="tool-picker-group"]')
  await expect(groups.first().getByRole('heading')).toHaveText('Aux tailles du projet')
  await expect(groups.first().getByRole('checkbox')).toHaveCount(1)
  const circ = groups.first().getByRole('checkbox', { name: /ChiaoGoo/ })
  await expect(groups.nth(1).getByRole('checkbox', { name: /crochet/ })).toHaveCount(1)
  await groups.first().locator('label').first().click()
  await expect(circ).toBeChecked()
  await sheet.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(tile.locator('.trow')).toHaveCount(1)
  await expect(tile.locator('.trow')).toContainText('ChiaoGoo')

  // « Mes outils » : la circulaire porte « en cours : » et le nom du projet, le crochet « disponible ».
  await page.goto('/tools')
  const circRow = page.locator('.tlist .trow').filter({ hasText: 'ChiaoGoo' })
  await expect(circRow.locator('.trow__status')).toHaveText('en cours : Bonnet rayé')
  await expect(page.locator('.tlist .trow').filter({ hasText: 'crochet' }).locator('.trow__status')).toHaveText('disponible')

  // Fiche de la circulaire : le projet, qui ouvre sa fiche.
  await circRow.click()
  await page.waitForURL(/\/tools\/\d+$/)
  const projectLink = page.locator('[data-test="tool-project"]')
  await expect(projectLink).toHaveText('Bonnet rayé')
  await projectLink.click()
  await expect(page).toHaveURL(projectUrl)
})

// Projet tricot 4 mm passé « En cours » dès la création ; rend l'URL de sa fiche.
async function createWipProject(page, name) {
  await page.goto('/')
  await page.getByRole('button', { name: /Créer un projet/ }).click()
  await page.locator('#name').fill(name)
  await page.locator('#needle-mm-0').fill('4')
  await page.getByRole('button', { name: 'En cours', exact: true }).click()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  return page.url()
}

// Feuille ouverte depuis la fiche projet : coche une taille du kit, puis choisit un câble.
// `cable` : début du libellé de l'option du menu (« 80 cm », « 80 cm L »), qui peut finir par « (pris : … ) ».
async function pickFromKit(page, mm, cable) {
  await page.getByRole('tab', { name: 'Détails' }).click()
  await page.locator('[data-test="project-tools"]').getByRole('button', { name: 'Choisir des outils' }).click()
  const sheet = page.getByRole('dialog', { name: 'Choisir des outils' })
  const size = sheet.locator(`[data-test="tool-picker-kit-size"][data-value="${mm}"]`)
  await size.locator('label').click()
  await expect(size.getByRole('checkbox')).toBeChecked()
  if (cable) {
    const menu = size.getByRole('combobox', { name: 'Câble' })
    const text = (await menu.locator('option').allTextContents()).find((o) => o === cable || o.startsWith(`${cable} (`))
    await menu.selectOption({ label: text })
  }
  return sheet
}

// Spec interne : prendre 4 mm + 80 cm d'un kit pour un
// projet en cours n'occupe que cette taille ; la carte du kit ne cite jamais le câble, la fiche du
// kit et la fiche projet, oui.
test('prendre 4 mm et le câble 80 cm d’un kit pour un projet en cours', async ({ page }) => {
  await addKit(page)
  const projectUrl = await createWipProject(page, 'Bonnet rayé')
  const sheet = await pickFromKit(page, '4', '80 cm')
  // Pas de case pour le kit entier : seulement ses trois tailles.
  await expect(sheet.locator('[data-test="tool-picker-kit"]').getByRole('checkbox')).toHaveCount(3)
  await sheet.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(sheet).toHaveCount(0)
  const tile = page.locator('[data-test="project-tools"]')
  await expect(tile.locator('.trow__title')).toHaveText('KnitPro Zing · 4 mm + 80 cm')

  await page.goto('/tools')
  const kitRow = page.locator('.tlist .trow').filter({ hasText: 'KnitPro Zing' })
  await expect(kitRow.locator('.trow__status')).toHaveText('en cours : 4 mm (Bonnet rayé)')
  await expect(kitRow).not.toContainText('80')

  await kitRow.click()
  await page.waitForURL(/\/tools\/\d+$/)
  await expect(page.locator('[data-test="kit-size"]').nth(1)).toHaveText(/^4 mm .*\(Bonnet rayé\)$/)
  await expect(page.locator('[data-test="kit-cable"]').nth(1)).toHaveText('80 cm, 1 pris (Bonnet rayé)')
  await expect(page.locator('[data-test="tool-project"]')).toHaveText('Bonnet rayé')
  await page.locator('[data-test="tool-project"]').click()
  await expect(page).toHaveURL(projectUrl)
})

// Diamètre de la fixation (spec 2026-11-17) : prendre 4 mm + 80 cm L d'un kit qui a aussi un 80 cm S
// ne prend pas le 80 cm S ; la carte du kit ne cite toujours pas le câble.
test('prendre 4 mm et le câble 80 cm L d’un kit qui a aussi un 80 cm S', async ({ page }) => {
  await page.goto('/tools')
  await page.getByRole('button', { name: 'Ajouter un outil' }).click()
  await page.waitForURL('**/tools/new')
  await chooseType(page, 'interchangeable')
  for (const mm of ['3.5', '4', '5']) await tick(page, 'kit-size', mm)
  await page.getByRole('radio', { name: 'S', exact: true }).click()
  await tick(page, 'kit-cable', '80')
  await page.getByRole('radio', { name: 'L', exact: true }).click()
  await tick(page, 'kit-cable', '80')
  await page.locator('#tool-brand').fill('KnitPro')
  await page.locator('#tool-line').fill('Zing')
  await save(page)
  await createWipProject(page, 'Bonnet rayé')
  const sheet = await pickFromKit(page, '4', '80 cm L')
  await sheet.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.locator('[data-test="project-tools"] .trow__title')).toHaveText('KnitPro Zing · 4 mm + 80 cm L')

  await page.goto('/tools')
  const kitRow = page.locator('.tlist .trow').filter({ hasText: 'KnitPro Zing' })
  await expect(kitRow.locator('.trow__status')).toHaveText('en cours : 4 mm (Bonnet rayé)')
  await expect(kitRow).not.toContainText('80')
  await kitRow.click()
  await page.waitForURL(/\/tools\/\d+$/)
  const cables = page.locator('[data-test="kit-cable"]')
  await expect(cables.nth(0)).toHaveText('80 cm S')
  await expect(cables.nth(1)).toHaveText('80 cm L, 1 pris (Bonnet rayé)')
})

// Anti-objectif de la spec interne : à 360 px, une
// ligne longue (marque, gamme, nom de projet) ne déborde pas, et l'état reste lisible.
test.describe('ligne d’outil à 360 px', () => {
  test.use({ viewport: { width: 360, height: 780 } })

  test('marque, gamme et projet longs : chaque ligne tient sur une ligne, coupée par une ellipse', async ({ page }) => {
    const project = 'Bonnet torsadé à côtes anglaises et pompon de fourrure'
    await page.goto('/tools')
    await addCircular(page, { brand: 'ChiaoGoo', line: 'Twist Red Lace Interchangeable Premium' })

    await page.goto('/')
    await page.getByRole('button', { name: /Créer un projet/ }).click()
    await page.locator('#name').fill(project)
    await page.locator('#needle-mm-0').fill('4')
    await page.getByRole('button', { name: 'En cours', exact: true }).click()
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page).toHaveURL(/\/project\/\d+/)
    await page.getByRole('tab', { name: 'Détails' }).click()
    const tile = page.locator('[data-test="project-tools"]')
    await tile.getByRole('button', { name: 'Choisir des outils' }).click()
    const sheet = page.getByRole('dialog', { name: 'Choisir des outils' })
    await sheet.locator('[data-test="tool-picker-group"]').first().locator('label').first().click()
    await sheet.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(sheet).toHaveCount(0)

    await page.goto('/tools')
    const row = page.locator('.tlist .trow').first()
    await expect(row.locator('.trow__status')).toHaveText(`en cours : ${project}`)
    const m = await row.evaluate((el) => {
      const box = (sel) => el.querySelector(sel).getBoundingClientRect()
      const body = el.querySelector('.trow__body')
      const sub = el.querySelector('.trow__sub')
      const lineHeight = (sel) => parseFloat(getComputedStyle(el.querySelector(sel)).lineHeight)
      return {
        // Le corps porte les deux lignes ; la ligne 2 ne coupe rien elle-même (ses parties le font).
        body: [body.scrollWidth, body.clientWidth],
        sub: [sub.scrollWidth, sub.clientWidth],
        titleHeight: [box('.trow__title').height, lineHeight('.trow__title')],
        subHeight: [box('.trow__sub').height, lineHeight('.trow__sub')],
        statusInRow: box('.trow__status').right <= box('.trow__body').right + 0.5,
        statusWidth: box('.trow__status').width,
        page: [document.documentElement.scrollWidth, window.innerWidth],
      }
    })
    expect(m.body[0]).toBeLessThanOrEqual(m.body[1])
    expect(m.sub[0]).toBeLessThanOrEqual(m.sub[1])
    // Une seule ligne de texte chacune : la hauteur ne dépasse pas une hauteur de ligne et demie.
    expect(m.titleHeight[0]).toBeLessThan(m.titleHeight[1] * 1.5)
    expect(m.subHeight[0]).toBeLessThan(m.subHeight[1] * 1.5)
    expect(m.statusInRow).toBe(true)
    expect(m.statusWidth).toBeGreaterThan(40)
    expect(m.page[0]).toBeLessThanOrEqual(m.page[1])
  })

  test('feuille dépliée sur un kit, taille prise par un projet au nom long : rien ne déborde', async ({ page }) => {
    const long = 'Bonnet torsadé à côtes anglaises et pompon de fourrure'
    await addKit(page)
    await createWipProject(page, long)
    const first = await pickFromKit(page, '4', '80 cm')
    await first.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(first).toHaveCount(0)
    await createWipProject(page, 'Snood')
    const sheet = await pickFromKit(page, '4', '80 cm')
    await expect(sheet.locator('[data-test="tool-picker-kit-size"][data-value="4"]')).toContainText(`pris : ${long}`)
    const m = await sheet.evaluate((card) => {
      const body = card.querySelector('.tps__body')
      const targets = [...card.querySelectorAll('.chk, select, button')].map((el) => el.getBoundingClientRect().height)
      return {
        body: [body.scrollWidth, body.clientWidth],
        page: [document.documentElement.scrollWidth, window.innerWidth],
        minTarget: Math.min(...targets),
      }
    })
    expect(m.body[0]).toBeLessThanOrEqual(m.body[1])
    expect(m.page[0]).toBeLessThanOrEqual(m.page[1])
    expect(m.minTarget).toBeGreaterThanOrEqual(44)
  })
})

// WCAG 2.4.11 (focus non masqué) : un élément pris au clavier ne doit pas finir SOUS l'en-tête
// collant (AppHeader). Cf. src/utils/focus-under-header.js. Largeur 375 px.
//
// Chromium ne fait défiler, au focus, qu'une cible ENTIÈREMENT hors de la fenêtre (il la
// recentre alors : mesuré, aucun masquage possible). Une cible PARTIELLEMENT visible, dont le
// haut tombe dans la bande occupée par l'en-tête, est jugée « visible » et laissée en place :
// c'est elle qui passe dessous. Les deux scénarios ci-dessous amènent une cible dans cette bande.
test.describe('focus clavier sous l’en-tête collant', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  const focusIn = (selector) => `!!document.activeElement && !!document.activeElement.closest('${selector}')`

  async function tabUntil(page, key, selector) {
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press(key)
      if (await page.evaluate(focusIn(selector))) return true
    }
    return false
  }

  async function openKitForm(page) {
    await page.goto('/tools')
    await page.getByRole('button', { name: 'Ajouter un outil' }).click()
    await page.waitForURL('**/tools/new')
    await chooseType(page, 'interchangeable')
  }

  // Écart entre le haut de la cible et le bas de l'en-tête. Boîtes et non toBeInViewport() :
  // une cible cachée sous l'en-tête est « dans la fenêtre ».
  const gapUnderHeader = async (page, locator) => {
    const headerBox = await page.locator('header.hdr').boundingBox()
    const box = await locator.boundingBox()
    return box.y - (headerBox.y + headerBox.height)
  }

  const isFocusVisible = (page) => page.evaluate(() => document.activeElement.matches(':focus-visible'))

  test('Maj+Tab depuis « Marque » : la liste « Matière » reste sous l’en-tête, pas dessous', async ({ page }) => {
    await openKitForm(page)
    // « Marque » est un champ texte : l'évitement du clavier cale son étiquette sous l'en-tête,
    // ce qui laisse la liste « Matière », juste au-dessus, dans la bande de l'en-tête.
    expect(await tabUntil(page, 'Tab', '#tool-brand')).toBe(true)
    // L'évitement du clavier cale l'ÉTIQUETTE de « Marque » sous l'en-tête (respiration 16 px +
    // hauteur de l'étiquette, ~20 px) : le champ se pose ~36 px sous l'en-tête. 80 est une borne
    // large qui dit seulement « le défilement s'est posé près de l'en-tête », pas une mesure fine.
    await expect.poll(() => gapUnderHeader(page, page.locator('#tool-brand'))).toBeLessThan(80)
    await expect.poll(() => gapUnderHeader(page, page.locator('#tool-brand'))).toBeGreaterThan(0)

    await page.keyboard.press('Shift+Tab')
    expect(await page.evaluate(() => document.activeElement.id)).toBe('tool-material')
    expect(await isFocusVisible(page)).toBe(true)
    // Le défilement (doux) peut prendre quelques images : on attend qu'il se pose.
    await expect.poll(() => gapUnderHeader(page, page.locator('#tool-material'))).toBeGreaterThanOrEqual(0)
  })

  test('une case du kit prise par Maj+Tab après un défilement reste sous l’en-tête', async ({ page }) => {
    await openKitForm(page)
    const sizes = page.locator('[data-test="kit-size"]')
    const lastSize = sizes.last()
    const lastSizeValue = await lastSize.getAttribute('data-value')

    // Au clavier jusqu'au choix du diamètre de la fixation (juste après la dernière taille).
    expect(await tabUntil(page, 'Tab', '[data-test="cable-join"]')).toBe(true)
    // Puis l'utilisatrice fait défiler à la molette, de sorte que la dernière taille passe
    // dans la bande de l'en-tête (haut ≈ 30, en-tête jusqu'à ≈ 76).
    const headerBox = await page.locator('header.hdr').boundingBox()
    const target = 30
    await page.mouse.move(180, 400)
    await page.mouse.wheel(0, (await lastSize.boundingBox()).y - target)
    await expect.poll(async () => (await lastSize.boundingBox()).y).toBeLessThan(headerBox.y + headerBox.height - 10)
    await expect.poll(async () => (await lastSize.boundingBox()).y).toBeGreaterThan(0)

    await page.keyboard.press('Shift+Tab')
    expect(await page.evaluate(focusIn(`[data-test="kit-size"][data-value="${lastSizeValue}"]`))).toBe(true)
    expect(await isFocusVisible(page)).toBe(true)
    await expect.poll(() => gapUnderHeader(page, lastSize)).toBeGreaterThanOrEqual(0)
  })

  // Fix round 1 de la revue : un bouton DANS l'en-tête collant a un haut < hauteur de l'en-tête
  // sans être recouvert. Le prendre au clavier ne doit pas faire sauter la page.
  test('Tab entre les boutons de l’en-tête, page défilée : la page ne bouge pas', async ({ page }) => {
    await openKitForm(page)
    // Remonter au clavier jusqu'au bouton retour (le focus quitte le bouton de type cliqué).
    expect(await tabUntil(page, 'Shift+Tab', '.hdr__back')).toBe(true)
    expect(await isFocusVisible(page)).toBe(true)
    // Puis défiler la page à la molette, le focus restant sur le bouton retour.
    await page.mouse.move(180, 400)
    await page.mouse.wheel(0, 600)
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300)
    let settled = -1
    await expect
      .poll(async () => {
        const y = await page.evaluate(() => scrollY)
        const same = y === settled
        settled = y
        return same
      })
      .toBe(true)

    // Tab vers le bouton du menu, puis Maj+Tab vers le retour : tous deux dans l'en-tête.
    // Attente fixe et non poll : on prouve une ABSENCE de défilement, il faut laisser au
    // défilement fautif (une frame, puis une animation douce) le temps de se produire.
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement.classList.contains('hdr__burger'))).toBe(true)
    await page.waitForTimeout(600)
    expect(await page.evaluate(() => scrollY)).toBe(settled)
    await page.keyboard.press('Shift+Tab')
    expect(await page.evaluate(() => document.activeElement.classList.contains('hdr__back'))).toBe(true)
    await page.waitForTimeout(600)
    expect(await page.evaluate(() => scrollY)).toBe(settled)
  })
})

// Menus « Filtrer » / « Trier » du stock de laine : le PARCOURS réel à
// l'écran — pelotes créées via le formulaire, puis filtrage et tri via les popups.
// La navigation interne des popups (deux pages, émissions, Échap) est couverte par les
// tests composants : on valide ici les comptes de cartes, le badge et les ordres.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/stash')
})

// Ajoute une laine via le formulaire (marque libre + pastille + épaisseur + matières
// cochées + date d'achat de la 1re ligne). La fermeture du panneau EST le signal de fin
// d'enregistrement : fiche ET ligne d'achat écrites (cf. stash.spec.js).
async function ajouterLaine(page, { marque, couleur = 'moutarde', epaisseur = '', matieres = [], dateAchat = '' }) {
  await page.getByRole('button', { name: 'Ajouter une laine' }).click()
  await page.locator('.addform select').first().selectOption('__other__')
  await page.locator('input[placeholder="Saisis la marque"]').fill(marque)
  await page.locator(`.palette__sw[aria-label="${couleur}"]`).click()
  if (epaisseur) await page.locator('#yarn-weight').selectOption(epaisseur)
  if (dateAchat) await page.locator('#yarn-purchased-at').fill(dateAchat)
  for (const m of matieres) await page.locator('.chip', { hasText: m }).click()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.locator('.addform')).toHaveCount(0)
}

// Pose un filtre depuis la popup : critère → option (« Toutes… » si `libelle` est null).
// Choisir une option REVIENT à la page des critères sans refermer : on enchaîne donc les
// critères popup ouverte, et chaque test referme explicitement quand il en a besoin.
async function filtrer(page, critere, libelle) {
  await page.locator('[data-test="filter-menu-btn"]').click()
  await page.locator(`[data-test="filter-crit-${critere}"]`).click()
  if (libelle == null) await page.locator('[data-test="filter-all"]').click()
  else await page.locator('[data-test="filter-option"]', { hasText: libelle }).click()
}

// Choisit un ordre depuis la popup Trier : choisir applique ET referme.
async function trier(page, valeur) {
  await page.locator('[data-test="sort-menu-btn"]').click()
  await page.locator(`[data-test="sort-option-${valeur}"]`).click()
  await expect(page.locator('[data-test="yarn-sort-dialog"]')).toHaveCount(0)
}

test('deux critères se cumulent (marque + épaisseur)', async ({ page }) => {
  await ajouterLaine(page, { marque: 'Drops', epaisseur: 'lace' })
  await ajouterLaine(page, { marque: 'Drops', epaisseur: 'dk' })
  await ajouterLaine(page, { marque: 'Katia', epaisseur: 'lace' })

  await expect(page.locator('.ycard')).toHaveCount(3)

  await filtrer(page, 'brand', 'Drops')
  await expect(page.locator('.ycard')).toHaveCount(2)
  await expect(page.locator('[data-test="filter-badge"]')).toHaveText('1')

  // Enchaînement popup ouverte (le geste normal) : reste la Drops en Lace seulement.
  await page.locator('[data-test="filter-crit-weight"]').click()
  await page.locator('[data-test="filter-option"]', { hasText: 'Lace' }).click()
  await expect(page.locator('.ycard')).toHaveCount(1)
  await expect(page.locator('.ycard')).toContainText('Drops')
  await expect(page.locator('[data-test="filter-badge"]')).toHaveText('2')

  // « Toutes les épaisseurs » ne débranche que ce critère : la 2e Drops revient.
  await page.locator('[data-test="filter-crit-weight"]').click()
  await page.locator('[data-test="filter-all"]').click()
  await expect(page.locator('.ycard')).toHaveCount(2)
  await expect(page.locator('[data-test="filter-badge"]')).toHaveText('1')

  await page.locator('[data-test="filter-close"]').click()
  await expect(page.locator('[data-test="yarn-filter-dialog"]')).toHaveCount(0)
})

test('le filtre couleur regroupe les pelotes par famille de la palette', async ({ page }) => {
  await ajouterLaine(page, { marque: 'Drops', couleur: 'moutarde' })
  await ajouterLaine(page, { marque: 'Katia', couleur: 'bleu' })

  await expect(page.locator('.ycard')).toHaveCount(2)

  await page.locator('[data-test="filter-menu-btn"]').click()
  await page.locator('[data-test="filter-crit-color"]').click()
  // Seules les familles PRÉSENTES dans le stock sont proposées (moutarde avant bleu :
  // l'ordre de la palette fait foi), pas tout le catalogue.
  await expect(page.locator('[data-test="filter-option"]')).toHaveText(['Moutarde', 'Bleu'])
  await page.locator('[data-test="filter-option"]', { hasText: 'Moutarde' }).click()
  await expect(page.locator('.ycard')).toHaveCount(1)
  await expect(page.locator('.ycard')).toContainText('Drops · Moutarde')

  await page.locator('[data-test="filter-close"]').click()
})

test('le filtre matière ne garde que les laines qui la contiennent', async ({ page }) => {
  await ajouterLaine(page, { marque: 'Drops', matieres: ['Laine'] })
  await ajouterLaine(page, { marque: 'Katia', matieres: ['Coton'] })

  await expect(page.locator('.ycard')).toHaveCount(2)

  await filtrer(page, 'composition', 'Laine')
  await expect(page.locator('.ycard')).toHaveCount(1)
  await expect(page.locator('.ycard')).toContainText('Drops')

  await page.locator('[data-test="filter-close"]').click()
})

test('les trois tris s’appliquent depuis la popup, date d’achat plus récent d’abord', async ({ page }) => {
  await ajouterLaine(page, { marque: 'Drops', epaisseur: 'dk', dateAchat: '2026-01-15' })
  await ajouterLaine(page, { marque: 'Katia', epaisseur: 'lace' }) // date du jour proposée par défaut

  await expect(page.locator('.ycard')).toHaveCount(2)

  // Marque : ordre alphabétique.
  await trier(page, 'brand')
  await expect(page.locator('.ycard__name')).toHaveText(['Drops · Moutarde', 'Katia · Moutarde'])

  // Épaisseur : ordre réel du fil (lace avant dk), donc PAS l'ordre alphabétique.
  await trier(page, 'weight')
  await expect(page.locator('.ycard__name')).toHaveText(['Katia · Moutarde', 'Drops · Moutarde'])

  // Date d'achat : la Katia (aujourd'hui) passe devant la Drops (15/01/2026).
  await trier(page, 'purchasedAt')
  await expect(page.locator('.ycard__name')).toHaveText(['Katia · Moutarde', 'Drops · Moutarde'])
})

test('le badge compte les critères actifs et « Réinitialiser » remet tout à zéro', async ({ page }) => {
  await ajouterLaine(page, { marque: 'Drops', epaisseur: 'lace' })
  await ajouterLaine(page, { marque: 'Katia', epaisseur: 'dk' })

  // Aucun critère actif : pas de badge.
  await expect(page.locator('[data-test="filter-badge"]')).toHaveCount(0)

  await filtrer(page, 'brand', 'Drops')
  await page.locator('[data-test="filter-crit-weight"]').click()
  await page.locator('[data-test="filter-option"]', { hasText: 'Lace' }).click()
  await expect(page.locator('[data-test="filter-badge"]')).toHaveText('2')
  await expect(page.locator('.ycard')).toHaveCount(1)

  // « Réinitialiser » vide les critères ET LAISSE LA POPUP OUVERTE : la liste derrière
  // repart à zéro, la popup se referme d'un geste séparé.
  await page.locator('[data-test="filter-reset"]').click()
  await expect(page.locator('[data-test="yarn-filter-dialog"]')).toBeVisible()
  await expect(page.locator('[data-test="filter-badge"]')).toHaveCount(0)
  await expect(page.locator('.ycard')).toHaveCount(2)

  await page.locator('[data-test="filter-close"]').click()
  await expect(page.locator('[data-test="yarn-filter-dialog"]')).toHaveCount(0)
})

test('un tap sur le scrim ferme la popup Filtrer', async ({ page }) => {
  await ajouterLaine(page, { marque: 'Drops' })

  await expect(page.locator('.ycard')).toHaveCount(1)

  await page.locator('[data-test="filter-menu-btn"]').click()
  await expect(page.locator('[data-test="yarn-filter-dialog"]')).toBeVisible()
  // La carte occupe le bas de l'écran : on vise le haut du scrim, découvert.
  await page.locator('.yfd__scrim').click({ position: { x: 20, y: 20 } })
  await expect(page.locator('[data-test="yarn-filter-dialog"]')).toHaveCount(0)
})

import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/stash')
})

async function ouvrirFormulaire(page) {
  await page.getByRole('button', { name: 'Ajouter une laine' }).click()
  await page.waitForURL('**/stash/new')
  await page.locator('.addform select').first().selectOption('__other__')
  await page.locator('input[placeholder="Saisis la marque"]').fill('Drops')
  await page.locator('.palette__sw[aria-label="moutarde"]').click()
}

// La frontière de CE test s'arrête à la saisie et à la persistance des
// caractéristiques — leur affichage dans la fiche détaillée (`.ydet`) est prévu séparément,
// pas encore écrit. Le test relit donc en réouvrant le formulaire
// d'ÉDITION (pas la fiche), et vérifie à la fois les deux pastilles cochées ET que les
// six autres ne le sont pas (`.labelchip--on` a un compte de 2, pas plus) — la preuve que
// `labels` survit à l'aller-retour IndexedDB (`save()` fait `payload = { ...form, ... }`)
// et que `normalizeLabels` posé dans `openEdit` est bien sur le chemin réellement emprunté.
test('les huit caractéristiques se cochent et se relisent après enregistrement', async ({ page }) => {
  await ouvrirFormulaire(page)
  await page.locator('.labelchip', { hasText: 'Vegan' }).click()
  await page.locator('.labelchip', { hasText: 'Fibres biologiques (GOTS)' }).click()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  // « Enregistrer » navigue directement vers la fiche fraîchement créée (route stash-item) :
  // pas besoin de repasser par la liste. Le kebab (Modifier/Dupliquer/Supprimer) y vit
  // désormais, plus sur la carte de la liste.
  await page.waitForURL(/\/stash\/\d+$/)
  await page.getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('button', { name: 'Modifier' }).click()
  await page.waitForURL(/\/stash\/\d+\/edit/)
  await expect(page.locator('.labelchip--on', { hasText: 'Vegan' })).toBeVisible()
  await expect(page.locator('.labelchip--on', { hasText: 'Fibres biologiques (GOTS)' })).toBeVisible()
  await expect(page.locator('.labelchip--on')).toHaveCount(2)
})

test('cocher Vegan sur une laine contenant du mohair AVERTIT sans bloquer', async ({ page }) => {
  await ouvrirFormulaire(page)
  await page.locator('.chip', { hasText: 'Mohair' }).click()
  await page.locator('.labelchip', { hasText: 'Vegan' }).click()

  await expect(page.locator('.veganwarn')).toBeVisible()
  await expect(page.locator('.veganwarn')).toContainText('mohair')
  // La case reste cochée : on informe, on ne décide pas à sa place.
  await expect(page.locator('.labelchip--on', { hasText: 'Vegan' })).toBeVisible()
})

test('cocher Vegan sur une composition sans fibre animale reconnue N’AVERTIT PAS', async ({ page }) => {
  await ouvrirFormulaire(page)
  await page.locator('.chip', { hasText: 'Coton' }).click()
  await page.locator('.labelchip', { hasText: 'Vegan' }).click()
  await expect(page.locator('.veganwarn')).toHaveCount(0)
})

// Portage d'un test qu'un test précédent devait écrire (retiré de là : il testait le livrable
// d'un autre test, pas le sien) — la fiche détaillée (`.ydet`) est le livrable de CE test.
test('les caractéristiques cochées apparaissent dans la fiche détaillée', async ({ page }) => {
  await ouvrirFormulaire(page)
  await page.locator('.labelchip', { hasText: 'Vegan' }).click()
  await page.locator('.labelchip', { hasText: 'Fibres biologiques (GOTS)' }).click()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  // Déjà sur la fiche fraîchement créée après « Enregistrer » (route stash-item) : pas besoin
  // de rouvrir quoi que ce soit. `.ydet` (bloc racine de l'ancien tiroir) n'existe plus ;
  // YarnDetailView.vue porte les mêmes caractéristiques dans `.ydet__labels`.
  await page.waitForURL(/\/stash\/\d+$/)
  await expect(page.locator('.ydet__labels')).toContainText('Vegan')
  await expect(page.locator('.ydet__labels')).toContainText('Fibres biologiques (GOTS)')
})

test('le filtre par caractéristique ne garde que les laines la portant', async ({ page }) => {
  const ajouter = async (marque, labels) => {
    await page.getByRole('button', { name: 'Ajouter une laine' }).click()
    await page.waitForURL('**/stash/new')
    await page.locator('.addform select').first().selectOption('__other__')
    await page.locator('input[placeholder="Saisis la marque"]').fill(marque)
    await page.locator('.palette__sw[aria-label="moutarde"]').click()
    for (const l of labels) await page.locator('.labelchip', { hasText: l }).click()
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await page.waitForURL(/\/stash\/\d+$/)
    await page.goto('/stash')
  }
  await ajouter('AvecVegan', ['Vegan'])
  await ajouter('SansRien', [])

  await expect(page.locator('.ycard')).toHaveCount(2)
  // Même parcours popup que le filtre marque : critère Label → option « Vegan ».
  await page.locator('[data-test="filter-menu-btn"]').click()
  await page.locator('[data-test="filter-crit-label"]').click()
  await page.locator('[data-test="filter-option"]', { hasText: 'Vegan' }).click()
  await expect(page.locator('.ycard')).toHaveCount(1)
  await expect(page.locator('.ycard')).toContainText('AvecVegan')

  await page.locator('[data-test="filter-crit-label"]').click()
  await page.locator('[data-test="filter-all"]').click()
  await expect(page.locator('.ycard')).toHaveCount(2)
})

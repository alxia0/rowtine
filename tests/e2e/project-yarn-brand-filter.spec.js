import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
})

async function ajouterLaine(page, marque) {
  await page.goto('/stash')
  await page.getByRole('button', { name: 'Ajouter une laine' }).click()
  await page.waitForURL('**/stash/new')
  await page.locator('.addform select').first().selectOption('__other__')
  await page.locator('input[placeholder="Saisis la marque"]').fill(marque)
  await page.locator('.palette__sw[aria-label="moutarde"]').click()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  // « Enregistrer » navigue vers la fiche fraîchement créée (route stash-item) — le prochain
  // appelant (creerProjetEtOuvrirEdition) navigue lui-même ailleurs ensuite, pas besoin de
  // revenir sur /stash ici.
  await page.waitForURL(/\/stash\/\d+$/)
}

async function creerProjetEtOuvrirEdition(page, nom) {
  // Le bouton « Créer un projet » ne vit que sur l'accueil (HomeView.vue) — ajouterLaine()
  // termine sur /stash, il faut donc y revenir explicitement avant de cliquer.
  await page.goto('/')
  await page.getByRole('button', { name: /Créer un projet/ }).click()
  await page.locator('#name').fill(nom)
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  // Le bouton « Modifier le projet » vit dans le menu ⋮ (kebab), pas visible sans l'ouvrir
  // d'abord — meme motif que tests/e2e/project-menu-danger-spacing.spec.js.
  await page.locator('.phdr__kebab').click()
  await page.getByRole('button', { name: 'Modifier le projet' }).click()
  await expect(page).toHaveURL(/\/project\/\d+\/edit/)
}

test('la liste de laines reste vide tant qu’aucune marque n’est choisie', async ({ page }) => {
  await ajouterLaine(page, 'Drops')
  await ajouterLaine(page, 'Katia')
  await creerProjetEtOuvrirEdition(page, 'Pull test marque')

  await expect(page.locator('.ypick__row')).toHaveCount(0)
  await expect(page.locator('.ypick__brandfilter')).toBeVisible()

  await page.locator('.ypick__brandfilter select').selectOption('Drops')
  await expect(page.locator('.ypick__row')).toHaveCount(1)
  await expect(page.locator('.ypick__row')).toContainText('Drops')
})

test('une laine cochee reste visible et cochee apres avoir change de marque', async ({ page }) => {
  await ajouterLaine(page, 'Drops')
  await ajouterLaine(page, 'Katia')
  await creerProjetEtOuvrirEdition(page, 'Pull test marque 2')

  await page.locator('.ypick__brandfilter select').selectOption('Drops')
  await page.locator('.ypick__row', { hasText: 'Drops' }).locator('.ypick__pick').click()
  await expect(page.locator('.ypick__row--on')).toHaveCount(1)

  await page.locator('.ypick__brandfilter select').selectOption('Katia')
  // La laine Drops cochée reste visible (toujours montrée) + la laine Katia filtrée apparaît.
  await expect(page.locator('.ypick__row')).toHaveCount(2)
  await expect(page.locator('.ypick__row--on', { hasText: 'Drops' })).toBeVisible()

  await page.locator('.ypick__brandfilter select').selectOption('')
  // Retour au placeholder vide : seule la laine deja cochee (Drops) reste visible,
  // Katia (non cochee) disparait — "vide" veut dire "seulement les cochees", jamais
  // "tout le catalogue" comme dans l'ecran Bibliotheque.
  await expect(page.locator('.ypick__row')).toHaveCount(1)
  await expect(page.locator('.ypick__row--on', { hasText: 'Drops' })).toBeVisible()
})

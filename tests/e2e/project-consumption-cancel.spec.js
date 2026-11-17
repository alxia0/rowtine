// Consommation de pelotes à la fin d'un projet (lot « correction de la quantité de pelotes ») :
// la fenêtre « Projet terminé ! » a un bouton Annuler, refuse une quantité au-dessus de ce qui
// est DISPONIBLE pour ce projet (sa réservation plus le stock libre ; avec un bouton pour corriger
// le stock), et la quantité tricotée se corrige après
// coup depuis l'écran de modification du projet. Libellés français : la suite ordinaire
// tourne en locale fr-FR.
// Tout est vérifié sur l'état PERSISTÉ (IndexedDB), pas seulement sur l'écran : un test qui ne
// lirait que l'affichage resterait vert si la fenêtre affichait juste sans écrire.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'
import { seedRows, readRows } from './helpers-seed-yarns'

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  // Amorçage HORS de l'app (même raison que price-currency-launch-reprise.spec.js : la chaîne
  // de démarrage de App.vue peut encore tourner juste après l'accueil).
  await page.goto('/favicon.ico')
})

// Stock de 4 pelotes, dont 3 réservées par un projet en cours.
async function seedProjetEtLaine(page) {
  await seedRows(page, 'projects', [{ name: 'Pull de test', technique: 'knitting', status: 'wip' }])
  const projet = (await readRows(page, 'projects')).find((p) => p.name === 'Pull de test')
  await seedRows(page, 'yarns', [
    {
      brand: 'Drops',
      model: 'Alpaca',
      colorKey: 'rouge',
      colorName: 'Rouge',
      quantity: 4,
      reservations: { [projet.id]: 3 },
      consumed: {},
      photos: [],
    },
  ])
  return projet.id
}

const laine = async (page) => (await readRows(page, 'yarns')).find((y) => y.brand === 'Drops')
const projetDe = async (page, id) => (await readRows(page, 'projects')).find((p) => p.id === id)

async function terminerDepuisLaFiche(page, id) {
  await page.goto(`/project/${id}`)
  await page.getByRole('button', { name: 'Changer le statut' }).click()
  await page.getByRole('button', { name: 'Terminé', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Projet terminé !' })).toBeVisible()
}

test('Annuler, croix, voile et Échap laissent le projet et la laine intacts', async ({ page }) => {
  const id = await seedProjetEtLaine(page)
  const intact = async () => {
    expect((await projetDe(page, id)).status).toBe('wip')
    const y = await laine(page)
    expect(y.quantity).toBe(4)
    expect(y.reservations).toEqual({ [id]: 3 })
    expect(y.consumed).toEqual({})
  }

  await terminerDepuisLaFiche(page, id)
  const dialogue = page.getByRole('dialog', { name: 'Projet terminé !' })
  await dialogue.getByRole('button', { name: 'Annuler' }).click()
  await expect(dialogue).toHaveCount(0)
  await intact()

  // La croix de l'en-tête vaut Annuler : elle ne consomme rien non plus.
  await page.getByRole('button', { name: 'Changer le statut' }).click()
  await page.getByRole('button', { name: 'Terminé', exact: true }).click()
  await dialogue.getByRole('button', { name: 'Fermer' }).click()
  await expect(dialogue).toHaveCount(0)
  await intact()

  // Le voile aussi (la fiche est en bas de l'écran : on clique en haut, sur le voile).
  await page.getByRole('button', { name: 'Changer le statut' }).click()
  await page.getByRole('button', { name: 'Terminé', exact: true }).click()
  await expect(dialogue).toBeVisible()
  await page.locator('.ycn__scrim').click({ position: { x: 10, y: 10 } })
  await expect(dialogue).toHaveCount(0)
  await intact()

  // Échap aussi.
  await page.getByRole('button', { name: 'Changer le statut' }).click()
  await page.getByRole('button', { name: 'Terminé', exact: true }).click()
  await expect(dialogue).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialogue).toHaveCount(0)
  await intact()
})

test('dépassement du stock refusé, correction du stock, fin du projet, puis correction après coup', async ({ page }) => {
  const id = await seedProjetEtLaine(page)

  // 1. 6 pelotes saisies pour 4 disponibles (3 réservées + 1 libre) : ramené à 4, avertissement,
  // rien n'est écrit.
  await terminerDepuisLaFiche(page, id)
  const dialogue = page.getByRole('dialog', { name: 'Projet terminé !' })
  const champ = dialogue.getByRole('textbox', { name: /Drops/ })
  await champ.fill('6')
  await expect(champ).toHaveValue('4')
  await expect(dialogue.getByRole('alert')).toContainText('Il ne reste que 4 pelote(s) disponible(s) pour cette laine')
  expect((await projetDe(page, id)).status).toBe('wip')
  expect((await laine(page)).quantity).toBe(4)

  // 2. « Corriger le stock » ouvre la fiche de la laine ; le projet est toujours en cours.
  await dialogue.getByRole('button', { name: 'Corriger le stock' }).click()
  await page.waitForURL(/\/stash\/\d+\/edit/)
  expect((await projetDe(page, id)).status).toBe('wip')

  // 3. Le stock passe à 8 (on avait en réalité plus de pelotes que noté).
  await page.locator('#yarn-quantity').fill('8')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  // Une hausse de quantité propose d'écrire un achat : on passe (le sujet ici est le stock).
  await page.locator('[data-test="qty-increase-ignore"]').click()
  await page.waitForURL(/\/stash\/\d+$/)
  await expect.poll(async () => (await laine(page)).quantity).toBe(8)

  // 4. On recommence : 6 passe, Valider termine le projet et retire 6 du stock.
  await terminerDepuisLaFiche(page, id)
  const champ2 = dialogue.getByRole('textbox', { name: /Drops/ })
  await champ2.fill('6')
  await expect(champ2).toHaveValue('6')
  await expect(dialogue.getByRole('alert')).toHaveCount(0)
  await dialogue.getByRole('button', { name: 'Valider' }).click()
  await expect(dialogue).toHaveCount(0)

  await expect.poll(async () => (await projetDe(page, id)).status).toBe('done')
  const apres = await laine(page)
  expect(apres.quantity).toBe(2)
  expect(apres.consumed).toEqual({ [id]: 6 })
  expect(apres.reservations).toEqual({})
  // La ligne « tricotée(s) » vit dans l'onglet Détails de la fiche.
  await page.getByRole('tab', { name: 'Détails' }).click()
  await expect(page.getByText('6 pelote(s) tricotée(s)')).toBeVisible()

  // 5. Correction après coup depuis « Modifier le projet » : 5 au lieu de 6, une pelote rendue.
  await page.locator('.edit-btn').click()
  await page.waitForURL(/\/project\/\d+\/edit/)
  const bloc = page.locator('[data-test="consumed-block"]')
  await expect(bloc).toBeVisible()
  await bloc.getByRole('textbox').fill('5')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect.poll(async () => (await laine(page)).quantity).toBe(3)
  expect((await laine(page)).consumed).toEqual({ [id]: 5 })
  expect((await projetDe(page, id)).status).toBe('done')
})

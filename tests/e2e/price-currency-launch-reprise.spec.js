// Reprise de devise au lancement (src/App.vue) : une laine d'avant ce lot porte un prix SANS
// devise ; au lancement, l'app lui pose la devise des réglages. Sans l'appel de App.vue, la fiche
// resterait sans devise et changerait de sens au prochain changement de devise des réglages.
import { test, expect } from '@playwright/test'
import { completeOnboarding, writeSetting } from './helpers'
import { seedYarns, readYarns, seedRows, readRows } from './helpers-seed-yarns'

test('au lancement, une laine ancienne (prix sans devise) reçoit la devise des réglages', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  // Amorçage HORS de l'app : juste après l'accueil, la chaîne de démarrage de App.vue peut
  // encore tourner et estampiller la laine semée avec la devise de la session (EUR), avant la
  // vérification de départ (course vue le 14/11 : 6 échecs sur 8 en `--repeat-each`). Un
  // fichier statique du même domaine donne accès à la même IndexedDB sans exécuter l'app.
  await page.goto('/favicon.ico')
  await writeSetting(page, 'currency', 'CHF')
  await seedYarns(page, [{ brand: 'Ancienne', colorKey: 'rouge', quantity: 1, price: 5, photos: [] }])
  expect((await readYarns(page))[0].priceCurrency).toBeUndefined()

  await page.goto('/stash')
  await expect.poll(async () => (await readYarns(page))[0].priceCurrency).toBe('CHF')
})

test('au lancement, un patron ancien (prix sans devise) reçoit la devise des réglages', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  // Même amorçage hors de l'app que ci-dessus, pour la même course avec le démarrage.
  await page.goto('/favicon.ico')
  await writeSetting(page, 'currency', 'CHF')
  await seedRows(page, 'patterns', [
    { name: 'Ancien patron', type: 'knitting', price: '12', sections: [], photos: [], gallery: [], sizes: [] },
  ])
  const ancien = async () => (await readRows(page, 'patterns')).find((p) => p.name === 'Ancien patron')
  expect((await ancien()).priceCurrency).toBeUndefined()

  await page.goto('/library')
  await expect.poll(async () => (await ancien()).priceCurrency).toBe('CHF')
})

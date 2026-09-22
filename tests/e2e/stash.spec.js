// Parcours #7 — Stock de laines : ajout, récap, recherche, suppression annulable.
import { test, expect } from '@playwright/test'
import { completeOnboarding, setCameraPhoto } from './helpers'

// Ajoute une laine via le formulaire (marque libre + coloris via palette + quantité).
// `colorKey` = clé d'une pastille (ex. 'rouge') ; le nom affiché est la clé capitalisée.
// « Ajouter une laine » navigue désormais vers l'écran dédié (route stash-new) — on attend
// cette navigation avant de remplir les champs (mêmes id/placeholder qu'avant, StashView.vue
// ne porte plus le formulaire). « Enregistrer » navigue à son tour vers la fiche de la laine
// tout juste créée (route stash-item) : ce helper referme la boucle en revenant sur /stash,
// pour que l'appelant retrouve la liste comme avant.
async function addYarn(page, { brand, colorKey, qty, price }) {
  await page.getByRole('button', { name: /Ajouter une laine/ }).click()
  await page.waitForURL('**/stash/new')
  // Le select de marque est dans le formulaire (le 1er select de la page est le tri).
  await page.locator('.addform select').first().selectOption('__other__')
  await page.locator('input[placeholder="Saisis la marque"]').fill(brand)
  // La couleur se choisit sur la palette de pastilles (remplit colorName en interne).
  await page.locator(`.palette__sw[aria-label="${colorKey}"]`).click()
  await page.locator('input[placeholder="1"]').fill(String(qty))
  if (price != null) await page.locator('input[placeholder="—"]').fill(String(price))
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  // La navigation vers la fiche EST le signal de fin d'enregistrement : depuis le correctif du
  // 06/08, l'écran ne quitte le formulaire qu'une fois la fiche ET sa ligne d'achat écrites.
  // Aucune pause arbitraire ici — on attend l'état, pas un délai.
  await page.waitForURL(/\/stash\/\d+$/)
  await page.goto('/stash')
}

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/stash')
  // Écran vide : depuis le lot UX 20/07 c'est une carte exemple + accroche
  // (« … Ajoute ta première laine … ») qui remplace l'ancien « Stock vide. ».
  await expect(page.getByText(/Ajoute ta première laine/)).toBeVisible()
})

test('ajouter une laine l’affiche et met à jour le récap', async ({ page }) => {
  await addYarn(page, { brand: 'Maison', colorKey: 'rouge', qty: 3 })

  await expect(page.getByText(/Maison.*Rouge/)).toBeVisible()
  await expect(page.locator('.recap__num').first()).toHaveText('3') // total pelotes
})

// Bug du 06/08 (écran Dépenses des captures du site) : deux laines saisies d'affilée —
// le geste normal de quelqu'un qui rentre son stock — et le budget n'en comptait qu'une
// (12,80 € au lieu de 30,50 €). Ce test tient le bout en bout : de la saisie au chiffre lu.
// Portée honnête : il ne remplace AUCUN des deux tests qui prouvent les correctifs pris
// séparément — vérifié par mutation, il reste vert si l'on rétablit à lui seul l'ordre
// fautif de YarnEditView (le temps que Playwright constate la navigation vers la fiche
// suffit à l'écriture pour aboutir). Ce sont tests/unit/store-load-course.spec.js (rechargement
// périmé) et tests/unit/YarnEditView.spec.js (describe « la navigation n'a lieu qu'une fois
// la ligne d'achat écrite »), qui forcent tous deux l'entrelacement, qui portent la preuve.
// AUCUNE pause entre les deux ajouts ici : c'est justement l'enchaînement qui est testé.
test('deux laines achetées d’affilée comptent TOUTES LES DEUX dans les dépenses', async ({ page }) => {
  await addYarn(page, { brand: 'Drops', colorKey: 'bleu', qty: 2, price: '6,40' })
  await addYarn(page, { brand: 'Katia', colorKey: 'rouge', qty: 1, price: '17,70' })

  await page.goto('/expenses')
  await expect(page.getByText(/Drops.*Bleu/)).toBeVisible()
  await expect(page.getByText(/Katia.*Rouge/)).toBeVisible()
  // Les DEUX montants de ligne, au centime (profil « detail ») : 2 × 6,40 et 1 × 17,70.
  await expect(page.locator('.exp__line-amount')).toHaveText(['17,70 €', '12,80 €'])
  // Total du bandeau : profil « total », arrondi à l'entier pour rester lisible en gros
  // chiffre — 30,50 € s'y affiche donc « 31 ». C'est ce chiffre-là qui montrait « 13 »
  // (12,80 € seuls) quand la seconde ligne d'achat se perdait.
  await expect(page.locator('[data-test="expenses-totals"] .exp__stat-num')).toHaveText('31')
})

// La prise de photo vit désormais sur la fiche (galerie, route stash-item, Task 2 du plan
// « refonte stock laine ») — le formulaire d'ajout (YarnEditView.vue) n'a plus de champ
// photo. On crée donc d'abord la laine, on ouvre sa fiche, puis on ajoute la photo là.
test('prendre une photo de la pelote l’enregistre', async ({ page }) => {
  await addYarn(page, { brand: 'Angora', colorKey: 'rose', qty: 1 })
  await page.locator('.ycard__view', { hasText: 'Angora' }).click()
  await page.waitForURL(/\/stash\/\d+$/)

  await setCameraPhoto(page)
  await page.getByRole('button', { name: 'Ajouter une photo' }).click()
  await expect(page.locator('.pgrid img')).toBeVisible()
})

test('la recherche filtre le stock', async ({ page }) => {
  await addYarn(page, { brand: 'Drops', colorKey: 'bleu', qty: 1 })
  await addYarn(page, { brand: 'Phildar', colorKey: 'vert', qty: 1 })

  await page.locator('input[placeholder="Rechercher une laine…"]').fill('drops')
  await expect(page.getByText(/Drops.*Bleu/)).toBeVisible()
  await expect(page.getByText(/Phildar.*Vert/)).toHaveCount(0)
})

test('supprimer une laine est annulable (soft delete)', async ({ page }) => {
  await addYarn(page, { brand: 'Katia', colorKey: 'ecru', qty: 2 })
  await expect(page.getByText(/Katia.*Ecru/)).toBeVisible()

  // Le kebab (dupliquer/modifier/supprimer) vit désormais sur la fiche, plus sur la carte de
  // la liste : ouvrir la fiche d'abord, PUIS son kebab (.phdr__kebab, même aria-label « Actions »).
  await page.locator('.ycard__view', { hasText: 'Katia' }).click()
  await page.waitForURL(/\/stash\/\d+$/)
  await page.getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('button', { name: 'Supprimer' }).click()
  // La suppression ramène directement sur la liste (YarnDetailView.remove()).
  await page.waitForURL('**/stash')
  await expect(page.getByText('Laine supprimée.')).toBeVisible()
  await expect(page.getByText(/Katia.*Ecru/)).toHaveCount(0)

  // « Annuler » restaure la laine.
  await page.getByRole('button', { name: 'Annuler' }).click()
  await expect(page.getByText(/Katia.*Ecru/)).toBeVisible()
})

test('dupliquer une laine via le menu kebab crée une 2e fiche, la source reste intacte', async ({ page }) => {
  await addYarn(page, { brand: 'Drops', colorKey: 'bleu', qty: 3 })
  await expect(page.getByText(/Drops.*Bleu/)).toBeVisible()

  await page.locator('.ycard__view', { hasText: 'Drops' }).click()
  await page.waitForURL(/\/stash\/\d+$/)
  await page.getByRole('button', { name: 'Actions' }).click()
  await page.getByRole('button', { name: 'Dupliquer' }).click()
  await page.waitForURL(/\/stash\/new/)
  await page.locator('#yarn-color-name').fill('Verte')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await page.waitForURL(/\/stash\/\d+$/)

  await page.goto('/stash')
  await expect(page.getByText(/Drops.*Bleu/)).toBeVisible() // fiche source intacte
  await expect(page.getByText(/Drops.*Verte/)).toBeVisible() // nouvelle fiche
  await expect(page.locator('.recap__num').first()).toHaveText('4') // 3 (source) + 1 (nouvelle, quantité repartie à 1)
})

test('une composition personnalisée persiste pour les fiches futures', async ({ page }) => {
  await page.getByRole('button', { name: /Ajouter une laine/ }).click()
  await page.waitForURL('**/stash/new')
  await page.getByRole('button', { name: 'Autre', exact: true }).click()
  await page.getByPlaceholder('Autre matière…').fill('kapok')
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click()
  await page.locator('.palette__sw[aria-label="bleu"]').click()
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await page.waitForURL(/\/stash\/\d+$/)

  await page.goto('/stash')
  await page.getByRole('button', { name: /Ajouter une laine/ }).click()
  await page.waitForURL('**/stash/new')
  await expect(page.getByRole('button', { name: 'kapok', exact: true })).toBeVisible()
})

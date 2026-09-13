// Garde « modifs non enregistrées » sur l'écran de correction. Un seul
// point d'interception (onBeforeRouteLeave dans CorrectionView.vue) couvre TOUS
// les départs — en-tête AppHeader, bouton Annuler, geste/bouton physique Android —
// car ils convergent tous vers une navigation de route. Ce
// test couvre le chemin observable au banc Playwright (bouton Annuler) : le
// dialogue « Quitter sans enregistrer ? » doit apparaître dès que le texte a été
// modifié, « Rester » doit annuler la sortie, et Enregistrer doit sortir SANS
// jamais demander confirmation (confirmedLeave posé avant son router.back()).
//
// Frontière CM6 (cf. avertissement en tête de correction-editor-keys.spec.js) :
// en vue ENRICHIE (hideMarkup=true, défaut), le préfixe `- ` d'une ligne rang est
// masqué derrière un RowCheckWidget non-éditable, et `keyboard.type` peut se
// désynchroniser à sa frontière. On bascule donc d'abord « Modifier le texte »
// (hideMarkup=false, cf. cm-editor.js : aucun widget n'est appliqué dans ce mode)
// avant de cliquer/taper — texte 100% plain, aucune frontière de widget à traverser.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

const PATTERN = {
  name: 'Correction Discard Guard Test',
  type: 'knitting',
  category: '',
  sizes: [],
  gallery: [],
  photos: [],
  pdf: '',
  reader: {
    sizeLabels: [],
    sections: [
      {
        id: 'corps',
        kind: 'corps',
        title: 'Corps',
        steps: [{ t: 'Monter soixante mailles' }, { t: 'Tricoter en jersey' }],
      },
    ],
  },
}

async function seedPattern(page, pattern) {
  return page.evaluate(async (pat) => {
    const r = indexedDB.open('rowtine')
    return await new Promise((res, rej) => {
      r.onsuccess = () => {
        const db = r.result
        const tx = db.transaction('patterns', 'readwrite')
        const a = tx.objectStore('patterns').add(pat)
        a.onsuccess = () => res(a.result)
        a.onerror = () => rej(a.error)
      }
      r.onerror = () => rej(r.error)
    })
  }, pattern)
}

test('correction : le retour avec modifs demande confirmation ; Enregistrer part sans demander', async ({ page }) => {
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN)
  await page.goto(`/pattern/${id}/correct`)
  const content = page.locator('.rte .cm-content').first()
  await expect(content).toBeVisible()

  // Vue balisage brute (pas de widget non-éditable) : rend le texte modifiable
  // sans risque de flake à une frontière de widget.
  await page.getByRole('button', { name: 'Modifier le texte' }).click()
  const line = page.locator('.rte__host .cm-line').filter({ hasText: 'Tricoter en jersey' })
  await expect(line).toBeVisible()
  await line.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' modifié') // rend l'écran "dirty"
  await expect(line).toContainText('Tricoter en jersey modifié')

  await page.getByRole('button', { name: /Annuler/ }).click()
  await expect(page.getByText('Quitter sans enregistrer ?')).toBeVisible()
  await page.getByRole('button', { name: /Rester/ }).click() // on reste
  await expect(content).toBeVisible()
  await expect(page.getByText('Quitter sans enregistrer ?')).toHaveCount(0)

  // Enregistrer : pas de dialogue, on quitte l'écran de correction.
  await page.getByRole('button', { name: /Enregistrer/ }).click()
  await expect(page.getByText('Quitter sans enregistrer ?')).toHaveCount(0)
  await expect(content).toHaveCount(0)
})

test('correction : sans modification, Annuler quitte directement sans dialogue', async ({ page }) => {
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN)
  await page.goto(`/pattern/${id}/correct`)
  const content = page.locator('.rte .cm-content').first()
  await expect(content).toBeVisible()

  await page.getByRole('button', { name: /Annuler/ }).click()
  await expect(page.getByText('Quitter sans enregistrer ?')).toHaveCount(0)
  await expect(content).toHaveCount(0)
})

// Régression revue finale : l'en-tête (AppHeader) monte TOUJOURS un menu burger qui
// navigue en AVANT (router.push({name}), cf. AppHeader.vue `go()`), indépendamment du
// bouton Annuler/retour de cet écran. Avec des modifs non enregistrées, la garde doit
// intercepter CETTE navigation-là aussi et, une fois confirmée via « Quitter », atterrir
// sur la DESTINATION visée par le menu (ex. Bibliothèque) — PAS sur l'écran précédent
// (bug : l'ancien correctif appelait goBack() sans jamais regarder `to`, ramenant en
// arrière au lieu d'aller vers la destination demandée).
test('correction : quitter via le menu de l’en-tête (dirty) atterrit sur la destination du menu, pas l’écran précédent', async ({
  page,
}) => {
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN)
  await page.goto(`/pattern/${id}/correct`)
  const content = page.locator('.rte .cm-content').first()
  await expect(content).toBeVisible()

  // Vue balisage brute (pas de widget non-éditable) : rend le texte modifiable
  // sans risque de flake à une frontière de widget.
  await page.getByRole('button', { name: 'Modifier le texte' }).click()
  const line = page.locator('.rte__host .cm-line').filter({ hasText: 'Tricoter en jersey' })
  await expect(line).toBeVisible()
  await line.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' modifié') // rend l'écran "dirty"
  await expect(line).toContainText('Tricoter en jersey modifié')

  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: 'Bibliothèque de patrons' }).click()
  await expect(page.getByText('Quitter sans enregistrer ?')).toBeVisible()
  await page.getByRole('button', { name: 'Quitter', exact: true }).click()

  await expect(page).toHaveURL(/\/library/)
})

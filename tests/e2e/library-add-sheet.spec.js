// (P2, audit UX 17/07) — Bibliothèque : un seul bouton « Ajouter un patron »,
// qui ouvre une feuille du bas à 3 choix (import PDF, import .zip, ajout manuel), au lieu
// des 3 gros boutons empilés qui poussaient la liste très bas.
// 19/07 : le choix « Import IA » est retiré, remplacé par « Importer un patron
// (.zip) » (route import-zip, B2) — la feuille reste à 3 choix.
// 08/08 : la feuille passe à 2 choix, l'import .zip devient une porte de service cachée.
// 23/09 : il redevient visible, la feuille a **3** choix (import PDF, « Importer au format
// Rowtine » pour un .rowtine ou un .zip, ajout manuel).
//
// Piège de cette tâche : le 1er choix (« Importer un patron PDF ») est un
// <label class="btn"> enveloppant un <input type="file"> masqué — le sélecteur de
// fichiers natif exige un geste utilisateur DIRECT sur ce label. Déplacer ce label dans
// la feuille ne doit pas casser l'ouverture du sélecteur : c'est la preuve la plus
// importante de ce test (2e test ci-dessous), plus solide que `setInputFiles()` (utilisé
// dans import-pdf.spec.js), qui contourne entièrement les vérifications de geste
// utilisateur en posant les fichiers directement — il ne peut PAS détecter une régression
// de ce type. `page.waitForEvent('filechooser')` ne se résout QUE si le clic déclenche
// réellement l'activation native de l'input fichier.
import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { completeOnboarding, openAddPatternSheet } from './helpers'

const FIXTURE = fileURLToPath(new URL('./fixtures/Pull Sabai Test.pdf', import.meta.url))

test.beforeEach(async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/library')
})

test('un seul bouton d’ajout visible ; le tap ouvre une feuille à 3 choix', async ({ page }) => {
  // Un seul bouton d'ajout au chargement.
  const trigger = page.getByRole('button', { name: 'Ajouter un patron' })
  await expect(trigger).toBeVisible()

  // Les 3 anciens boutons ne sont pas directement présents. `toHaveCount(0)` (pas
  // `not.toBeVisible()`, qui ignore l'opacité) : ils doivent être absents du DOM, pas
  // seulement masqués visuellement — sinon un masquage CSS cassé (`opacity: 0`) passerait
  // ce test à tort.
  await expect(page.getByText('Importer un patron PDF')).toHaveCount(0)
  await expect(page.getByText('Importer un patron (.zip)')).toHaveCount(0)
  await expect(page.getByText('Importer au format Rowtine')).toHaveCount(0)
  await expect(page.getByText(/Import IA/)).toHaveCount(0)
  await expect(page.getByText('Créer manuellement')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await trigger.click()

  // La feuille est ouverte et porte les 3 choix, chacun une cible tactile ≥ 44 px. Aucun
  // ne mentionne plus l'IA (retirée le 19/07).
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Importer un patron PDF')
  await expect(dialog).toContainText('Importer au format Rowtine')
  await expect(dialog).toContainText('Créer manuellement')
  // Le texte d'avertissement retiré ne doit plus apparaître dans la
  // feuille. Ancré sur un fragment stable du texte français, pas sur la clé JSON — un
  // garde-fou qui ne teste que la clé ne rougirait pas si le <span> revenait avec un texte
  // en dur au lieu de `t('pattern.importPdfNotice')`.
  await expect(dialog).not.toContainText('ne sont pas reconnus')
  await expect(dialog).not.toContainText('IA')

  const opts = dialog.locator('.pas__opt')
  await expect(opts).toHaveCount(3)
  for (let i = 0; i < 3; i++) {
    const box = await opts.nth(i).boundingBox()
    expect(box.height).toBeGreaterThanOrEqual(44)
  }

  // Deux inputs fichier (PDF et format Rowtine), tous deux focusables au clavier (WCAG 2.1.1).
  const inputs = page.locator('.lib-import__input')
  await expect(inputs).toHaveCount(2)
  for (let i = 0; i < 2; i++) {
    await expect(inputs.nth(i)).not.toHaveCSS('display', 'none')
    await inputs.nth(i).focus()
    await expect(inputs.nth(i)).toBeFocused()
  }

  // Échap ferme la feuille.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('🚩 le tap sur « Importer un patron PDF » dans la feuille ouvre le VRAI sélecteur de fichiers natif', async ({
  page,
}) => {
  await openAddPatternSheet(page)

  // Preuve du geste utilisateur direct : le clic sur le label (désormais dans la feuille,
  // plus sur l'écran directement) doit faire émerger l'évènement navigateur `filechooser`
  // — impossible s'il manque un vrai <input type="file"> activé par un geste direct, p.
  // ex. si le label avait été remplacé par un <button @click="input.click()"> ou si le
  // <label>/<input> avaient été séparés en déplaçant le contenu dans la feuille.
  const chooserPromise = page.waitForEvent('filechooser')
  // Deux labels `.lib-import` dans la feuille (PDF et format Rowtine, 23/09) : on cible
  // celui du PDF par son input.
  await page.locator('label.lib-import').filter({ has: page.locator('.lib-import__input--pdf') }).click()
  const chooser = await chooserPromise
  expect(chooser.isMultiple()).toBe(false)

  // Bout en bout : fournir le fichier au chooser mène bien à l'écran d'import local,
  // exactement comme avant le déplacement du label (non-régression fonctionnelle) —
  // puis au lecteur, une fois l'enregistrement terminé ET le bouton tapé (le fixture a des
  // sections, bouton principal « Prévisualiser le patron » depuis la refonte du bilan,
  // lot du 23/09/2026).
  await chooser.setFiles(FIXTURE)
  await page.getByRole('button', { name: 'Prévisualiser le patron' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/read$/)
})

test('le tap sur « Importer au format Rowtine » ouvre lui aussi le sélecteur natif', async ({ page }) => {
  await openAddPatternSheet(page)
  const chooserPromise = page.waitForEvent('filechooser')
  await page.locator('label.lib-import').filter({ has: page.locator('.lib-import__input--rowtine') }).click()
  const chooser = await chooserPromise
  expect(chooser.isMultiple()).toBe(false)
})

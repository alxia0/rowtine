// (P2, audit UX 17/07) — Bibliothèque : un seul bouton « Ajouter un patron »,
// qui ouvre une feuille du bas à 3 choix (import PDF, import .zip, ajout manuel), au lieu
// des 3 gros boutons empilés qui poussaient la liste très bas.
// 19/07 : le choix « Import IA » est retiré, remplacé par « Importer un patron
// (.zip) » (route import-zip, B2) — la feuille reste à 3 choix.
// Porte de service (08/08) : la feuille passe à **2** choix (import PDF, ajout manuel).
// L'import .zip n'a pas disparu — il est devenu une porte de service invisible, fondue dans
// l'import PDF (cf. utils/import-kind.js) : plus aucun libellé, titre ni icône ne le nomme.
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

test('un seul bouton d’ajout visible ; le tap ouvre une feuille à 2 choix', async ({ page }) => {
  // Un seul bouton d'ajout au chargement.
  const trigger = page.getByRole('button', { name: 'Ajouter un patron' })
  await expect(trigger).toBeVisible()

  // Les 3 anciens boutons ne sont pas directement présents. `toHaveCount(0)` (pas
  // `not.toBeVisible()`, qui ignore l'opacité) : ils doivent être absents du DOM, pas
  // seulement masqués visuellement — sinon un masquage CSS cassé (`opacity: 0`) passerait
  // ce test à tort.
  await expect(page.getByText('Importer un patron PDF')).toHaveCount(0)
  await expect(page.getByText('Importer un patron (.zip)')).toHaveCount(0)
  await expect(page.getByText(/Import IA/)).toHaveCount(0)
  await expect(page.getByText('Créer manuellement')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await trigger.click()

  // La feuille est ouverte et porte les 2 choix, chacun une cible tactile ≥ 44 px. Aucun
  // ne mentionne plus l'IA (retirée le 19/07) ni le zip (porte de service, 08/08).
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Importer un patron PDF')
  await expect(dialog).toContainText('Créer manuellement')
  // Le texte d'avertissement retiré ne doit plus apparaître dans la
  // feuille. Ancré sur un fragment stable du texte français, pas sur la clé JSON — un
  // garde-fou qui ne teste que la clé ne rougirait pas si le <span> revenait avec un texte
  // en dur au lieu de `t('pattern.importPdfNotice')`.
  await expect(dialog).not.toContainText('ne sont pas reconnus')
  await expect(dialog).not.toContainText('IA')

  // Porte de service (08/08) : la fonction .zip existe toujours, fondue dans l'import PDF,
  // mais RIEN ne doit la nommer dans la feuille. Garde de discrétion.
  await expect(dialog).not.toContainText('zip')
  await expect(dialog).not.toContainText('.zip')

  const opts = dialog.locator('.pas__opt')
  await expect(opts).toHaveCount(2)
  for (let i = 0; i < 2; i++) {
    const box = await opts.nth(i).boundingBox()
    expect(box.height).toBeGreaterThanOrEqual(44)
  }

  // Un seul input fichier désormais (l'import PDF, qui accepte aussi le zip en sous-main),
  // toujours focusable au clavier (WCAG 2.1.1).
  const inputs = page.locator('.lib-import__input')
  await expect(inputs).toHaveCount(1)
  await expect(inputs.first()).not.toHaveCSS('display', 'none')
  await inputs.first().focus()
  await expect(inputs.first()).toBeFocused()

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
  // Un seul label `.lib-import` désormais dans la feuille (porte de service 08/08 : le
  // choix .zip a disparu de l'interface, fondu dans l'import PDF) : le sélecteur n'a plus
  // besoin d'être scopé par texte.
  await page.locator('label.lib-import').click()
  const chooser = await chooserPromise
  expect(chooser.isMultiple()).toBe(false)

  // Bout en bout : fournir le fichier au chooser mène bien à l'écran d'import local,
  // exactement comme avant le déplacement du label (non-régression fonctionnelle) —
  // puis à la fiche patron, une fois l'enregistrement terminé ET le bouton tapé.
  await chooser.setFiles(FIXTURE)
  await page.getByRole('button', { name: 'Voir le patron' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+$/)
})

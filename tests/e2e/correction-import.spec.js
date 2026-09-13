// Task C3 — e2e du flux de correction post-import (zone de texte, VRAI CodeMirror 6).
//
// Ce que les tests unitaires (CorrectionView.spec.js, reader-text-editor.spec.js)
// ne peuvent pas couvrir : le vrai éditeur CM6 monté dans le DOM (ReaderTextEditor
// -> @/components/cm/cm-editor.js), pas un `view` CM6 mocké. On pilote donc un
// vrai navigateur (Chromium/Playwright) pour prouver bout-en-bout : ouvrir un
// patron -> "Prévisualiser le patron" -> "Corriger le patron" (l'action a migré
// de la fiche vers l'aperçu Prévisualiser) -> poser le curseur sur
// une ligne -> requalifier via la barre CM6 -> corriger du texte -> flèche descendre
// déplace la ligne -> Enregistrer -> retour à l'aperçu Prévisualiser -> celui-ci
// reflète texte + catégorie + ordre.
//
// Seed (Task D2) : depuis le retrait de l'éditeur texte du crayon PatternForm
// (ReaderMdEditor, remplacé par cette même correction screen), le formulaire
// "Ajouter manuellement" ne sait plus composer de reader. On injecte donc le
// patron directement dans IndexedDB (même technique que reader-charts.spec.js,
// `indexedDB.open('rowtine')` -> object store `patterns`), en conservant le
// même contenu qu'avant (2 rangs simples). Volontairement SANS taille ni
// compteur : `editableToReader` (reader-editable.js) ne doit déclencher aucun
// warning de carving, et aucun projet n'est lié au patron (pas de
// SyncReportDialog qui interromprait le flux Enregistrer -> retour fiche).
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

const PATTERN = {
  name: 'Correction Test', type: 'knitting', category: '', sizes: [], gallery: [], photos: [], pdf: '',
  reader: {
    sizeLabels: [],
    sections: [
      { id: 'corps', kind: 'corps', title: 'Corps', steps: [{ t: 'Monter 60 mailles' }, { t: 'Tricoter en jersey' }] },
    ],
  },
}

async function seedPattern(page, pattern) {
  return page.evaluate(async (pat) => {
    const r = indexedDB.open('rowtine')
    return await new Promise((res, rej) => {
      r.onsuccess = () => { const db = r.result; const tx = db.transaction('patterns', 'readwrite'); const a = tx.objectStore('patterns').add(pat); a.onsuccess = () => res(a.result); a.onerror = () => rej(a.error) }
      r.onerror = () => rej(r.error)
    })
  }, pattern)
}

test('correction import : réétiqueter une ligne en note, corriger le texte, déplacer la ligne, enregistrer -> la fiche patron reflète texte + catégorie + ordre', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })

  // --- Seed : patron avec 2 rangs simples (aucune taille, aucun compteur).
  const id = await seedPattern(page, PATTERN)

  // --- Fiche patron -> "Prévisualiser le patron" -> "Corriger le patron" (Corriger
  // vit désormais sur l'aperçu Prévisualiser, pas la fiche).
  await page.goto(`/pattern/${id}`)
  await expect(page).toHaveURL(/\/pattern\/\d+$/)
  await page.getByRole('button', { name: 'Prévisualiser le patron' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/read$/)
  await page.getByRole('button', { name: 'Corriger le patron' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/correct$/)

  // --- Éditeur CM6 réel monté (ReaderTextEditor -> createCmEditor).
  const cmLines = page.locator('.rte__host .cm-line')
  await expect(cmLines.filter({ hasText: 'Monter 60 mailles' })).toBeVisible()
  await expect(cmLines.filter({ hasText: 'Tricoter en jersey' })).toBeVisible()

  // --- Poser le curseur sur la ligne "Monter 60 mailles" (1er rang) puis cliquer
  // "Note" dans la barre de requalification (caret-line tagging, pas de sélection).
  await cmLines.filter({ hasText: 'Monter 60 mailles' }).click()
  await page.locator('.cm-retag-toolbar button[data-retag="note"]').click()

  // Preuve que le retag a touché EXACTEMENT la ligne visée (pas un repli ligne 1
  // si le clic n'avait pas posé le curseur au bon endroit) : une seule ligne note,
  // portant le bon texte ; l'autre ligne reste un rang, avec le sien.
  await expect(page.locator('.cm-line.md-note')).toHaveCount(1)
  await expect(page.locator('.cm-line.md-note')).toContainText('Monter 60 mailles')
  await expect(page.locator('.cm-line.md-rang')).toHaveCount(1)
  await expect(page.locator('.cm-line.md-rang')).toContainText('Tricoter en jersey')

  // --- Corriger le texte de cette ligne (curseur en fin de ligne, ajout de texte).
  await page.locator('.cm-line.md-note').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' (corrigé)')
  await expect(page.locator('.cm-line.md-note')).toContainText('Monter 60 mailles (corrigé)')

  // --- Ordre AVANT la flèche : la note (Monter) précède le rang (Tricoter) —
  // on opère sur la 1re ligne (pas la dernière) pour que "descendre" ne soit pas
  // un no-op silencieux (moveLineDown ne fait rien en bord de document).
  const linesBefore = (await cmLines.allTextContents()).filter((t) => t.trim())
  const idxNoteBefore = linesBefore.findIndex((t) => t.includes('corrigé'))
  const idxRangBefore = linesBefore.findIndex((t) => t.includes('Tricoter'))
  expect(idxNoteBefore).toBeGreaterThanOrEqual(0)
  expect(idxRangBefore).toBeGreaterThanOrEqual(0)
  expect(idxNoteBefore).toBeLessThan(idxRangBefore)

  // --- Flèche descendre : échange la ligne du curseur (note) avec sa voisine du dessous.
  await page.locator('.rte__arrow--down').click()
  const linesAfter = (await cmLines.allTextContents()).filter((t) => t.trim())
  const idxNoteAfter = linesAfter.findIndex((t) => t.includes('corrigé'))
  const idxRangAfter = linesAfter.findIndex((t) => t.includes('Tricoter'))
  expect(idxRangAfter).toBeLessThan(idxNoteAfter) // ordre inversé : Tricoter passe devant

  // --- Enregistrer -> retour à l'aperçu Prévisualiser (d'où "Corriger le patron" a été
  // ouvert, cf. router.back() dans CorrectionView.onSave — plus la fiche directement,
  // puisque l'entrée se fait maintenant via Prévisualiser).
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/read$/)

  // --- L'aperçu reflète texte + catégorie (note) + ORDRE inversé (preuve que l'édition
  // ET le déplacement ont bien été persistés, pas juste l'un des deux).
  const noteStep = page.locator('.rnote')
  await expect(noteStep).toHaveCount(1)
  await expect(noteStep).toContainText('Monter 60 mailles (corrigé)')

  const stepTexts = await page.locator('.rnote, .rstep').allTextContents()
  const idxTricoterFinal = stepTexts.findIndex((t) => t.includes('Tricoter'))
  const idxNoteFinal = stepTexts.findIndex((t) => t.includes('corrigé'))
  expect(idxTricoterFinal).toBeGreaterThanOrEqual(0)
  expect(idxNoteFinal).toBeGreaterThanOrEqual(0)
  expect(idxTricoterFinal).toBeLessThan(idxNoteFinal)
})

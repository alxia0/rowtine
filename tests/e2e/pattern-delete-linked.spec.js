// Supprimer un patron utilisé par un projet vidait la fiche du projet SANS un mot.
// Cf. audit UX 16/07 (« perte silencieuse = bug »).
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test('supprimer un patron utilisé demande confirmation', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/library')

  // Le projet démo (Bonnet Torsade) est lié au patron « Bonnet Torsade » seedé à l'onboarding.
  const carte = page.locator('.pcard', { hasText: 'Bonnet Torsade' }).first()
  await carte.locator('.pcard__del').click()

  const dialogue = page.getByRole('dialog')
  await expect(dialogue).toBeVisible()
  await expect(dialogue).toContainText(/1 projet/i)

  // Annuler => le patron est toujours là.
  await dialogue.getByRole('button', { name: /annuler/i }).click()
  await expect(page.locator('.pcard', { hasText: 'Bonnet Torsade' })).toHaveCount(1)
})

test('confirmer « Supprimer quand même » retire le patron et bannière le projet orphelin', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/library')

  // Le projet démo (Bonnet Torsade) est lié au patron « Bonnet Torsade » seedé à l'onboarding.
  const carte = page.locator('.pcard', { hasText: 'Bonnet Torsade' }).first()
  await carte.locator('.pcard__del').click()

  const dialogue = page.getByRole('dialog')
  await expect(dialogue).toBeVisible()

  // Chemin réel du lot : on confirme, on ne se contente pas d'annuler.
  await dialogue.getByRole('button', { name: /supprimer quand même/i }).click()

  // Le patron a bien disparu de la bibliothèque.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.pcard', { hasText: 'Bonnet Torsade' })).toHaveCount(0)

  // La fiche du projet démo (id 2, cf. test « ouvrir le lecteur… » ci-dessous) affiche
  // désormais le bandeau projet-orphelin.
  await page.goto('/project/2')
  await expect(page.locator('.orphan')).toBeVisible()
})

test('ouvrir le lecteur d’un projet sans patron explique pourquoi', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })

  // On casse le lien : le patron du projet démo pointe dans le vide. On lit le VRAI
  // patternId du projet plutôt que de supposer un id de patron fixe — l'ordre de création
  // patrons/projet-libre au seed n'est pas un contrat figé (cf. task C4-fix2, 31/07 : le
  // patron libre est désormais créé APRÈS les 3 patrons démo, plus avant, ce qui décale
  // tous les id de patron d'un cran).
  const patternId = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('rowtine')
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction(['projects'], 'readonly')
          tx.objectStore('projects').get(2).onsuccess = (e) => resolve(e.target.result.patternId)
        }
      }),
  )
  await page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const req = indexedDB.open('rowtine')
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction(['patterns'], 'readwrite')
          tx.objectStore('patterns').delete(id)
          tx.oncomplete = () => resolve()
        }
      }),
    patternId,
  )

  await page.goto('/project/2/read')

  // On est renvoyé sur la fiche projet...
  await expect(page).toHaveURL(/\/project\/2$/)
  // ...mais AVANT la redirection, un snackbar explique le renvoi. On vise le snackbar
  // lui-même (et sa chaîne courte dédiée `project.patternMissingShort`) plutôt que le
  // bandeau permanent de la fiche projet : ce bandeau (T2, `project.patternMissing`)
  // s'affiche déjà tout seul une fois sur place, donc un test qui ne cherche que
  // « patron…supprimé » sur la page d'arrivée passerait même sans ce correctif.
  const snack = page.locator('.snack')
  await expect(snack).toBeVisible()
  await expect(snack).toContainText('patron de ce projet a été supprimé')
})

test('supprimer un patron NON utilisé ne demande rien', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/library')

  // « Sac Granny » est le seul patron démo encore semé SANS projet associé — et non plus
  // « Écharpe Nuage », qui servait ici jusqu'au 11/08 : depuis le commit 1862ab6c, le projet
  // d'exemple « idée » (Écharpe douillette) reçoit AU SEMIS le patternId du patron de
  // l'écharpe (cf. src/constants/demo/fr.js et OnboardingView.seedExamples). Supprimer
  // l'écharpe ouvre donc désormais la confirmation « utilisé par 1 projet », ce qui est
  // exactement le contraire de ce que ce cas doit prouver.
  // Le sac est bien visible pour une utilisatrice « tricot » malgré son type `crochet` :
  // `libraryPatterns` (src/stores/patterns.js:45) ne filtre que sur
  // `ownerProjectId == null && !builtin`, et LibraryView.vue:83 ne filtre que par CATÉGORIE
  // — jamais par technique.
  const carte = page.locator('.pcard', { hasText: 'Sac Granny' }).first()
  await carte.locator('.pcard__del').click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.pcard', { hasText: 'Sac Granny' })).toHaveCount(0)
})

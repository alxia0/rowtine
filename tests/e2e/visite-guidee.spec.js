// Parcours — visite guidée du lecteur (lot « onboarding après import », 23/09/2026) : trois
// bulles posées sur le projet d'exemple (le bonnet, en cours), depuis ses trois points
// d'entrée (Réglages, bienvenue du premier lancement, Guide) — plus le cas où le projet
// d'exemple a été supprimé entre-temps. La visite ne fait que MONTRER (cf. ReaderTour.vue :
// le voile plein écran capte tous les appuis), donc rien n'est jamais coché ni écrit dans le
// projet — vérifié ici en comparant la ligne IndexedDB avant/après, pas seulement en
// observant l'écran.
import { test, expect } from '@playwright/test'
import { completeOnboarding, writeSetting, readSetting } from './helpers'

// Lit une ligne de la table `projects` directement dans IndexedDB (même raison que
// `writeSetting`/`readSetting` dans helpers.js : pas d'import du module app sous
// `vite preview`) — sert à prouver que la visite n'a rien changé au projet du bonnet.
async function readProject(page, id) {
  return page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('rowtine')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('projects', 'readonly')
          const getReq = tx.objectStore('projects').get(id)
          getReq.onsuccess = () => {
            resolve(getReq.result ?? null)
            db.close()
          }
          getReq.onerror = () => {
            reject(getReq.error)
            db.close()
          }
        }
      }),
    id,
  )
}

// Extrait l'id numérique d'une URL `/project/<id>` ou `/project/<id>/read...`.
function projectIdFromUrl(url) {
  const m = new URL(url).pathname.match(/\/project\/(\d+)/)
  return m ? Number(m[1]) : null
}

// Nombre de lignes dans `db.patterns` (même technique que `readProject` ci-dessus) — sert au
// test « bonnet supprimé » ci-dessous à prouver que la recréation du projet RÉUTILISE le
// patron de bibliothèque survivant plutôt que d'en ajouter un doublon à chaque suppression.
async function countPatterns(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('rowtine')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('patterns', 'readonly')
          const countReq = tx.objectStore('patterns').count()
          countReq.onsuccess = () => {
            resolve(countReq.result)
            db.close()
          }
          countReq.onerror = () => {
            reject(countReq.error)
            db.close()
          }
        }
      }),
  )
}

// Bulle de la visite guidée, scopée : `getByRole('dialog')` seul résout aussi le volet
// aide-mémoire du lecteur (.rs, role="dialog"), toujours présent dans le DOM (replié hors
// écran, pas démonté). Le nom accessible de la bulle est `tour.label` + le titre courant
// (cf. ReaderTour.vue, aria-labelledby) : filtrer sur le préfixe stable suffit.
function tourDialog(page) {
  return page.getByRole('dialog', { name: /Visite guidée du lecteur/ })
}

test('relance depuis les Réglages : trois bulles sur le bonnet en cours, puis visite terminée sans rien changer au projet', async ({
  page,
}) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })

  // Le bonnet en cours (tuile « Reprendre » de l'accueil) est le projet que la visite
  // utilise — on relève son id et son état AVANT toute visite, pour prouver ensuite
  // qu'elle n'a rien écrit dedans.
  await page.locator('.resume').click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  const bonnetId = projectIdFromUrl(page.url())
  expect(bonnetId).not.toBeNull()
  const avant = await readProject(page, bonnetId)
  expect(avant.readerState).toBeUndefined()

  await page.goto('/settings')
  await page.locator('[data-test="replay-tour"]').click()

  // Elle ouvre bien le lecteur DU BONNET (même id), pas un autre projet.
  await expect(page).toHaveURL(new RegExp(`/project/${bonnetId}/read`))

  const dialog = tourDialog(page)
  await expect(dialog).toBeVisible()
  await expect(page.locator('.tour__title')).toHaveText('Ta taille, une fois pour toutes')
  await expect(page.locator('.tour__dot')).toHaveCount(3)

  await page.locator('[data-test="tour-next"]').click()
  await expect(page.locator('.tour__title')).toHaveText('Coche ce que tu as fait')

  await page.locator('[data-test="tour-next"]').click()
  await expect(page.locator('.tour__title')).toHaveText('Le diagramme suit ton rang')
  // Dernière bulle : le bouton devient « Commencer ».
  await expect(page.locator('[data-test="tour-next"]')).toHaveText('Commencer')

  await page.locator('[data-test="tour-next"]').click()

  // Fin : la visite se ferme, le lecteur reste ouvert, `tour` quitte l'URL.
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-test="reader-tour"]')).toHaveCount(0)
  await expect(page).not.toHaveURL(/tour=1/)
  await expect(page).toHaveURL(new RegExp(`/project/${bonnetId}/read$`))
  await expect(page.locator('.rhdr')).toBeVisible()

  // Rien n'a été coché ni écrit dans le projet pendant la visite.
  await expect(page.locator('.rstep--done')).toHaveCount(0)
  const apres = await readProject(page, bonnetId)
  expect(apres).toEqual(avant)
})

test('« Passer » ferme la visite dès la première bulle', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/settings')
  await page.locator('[data-test="replay-tour"]').click()

  const dialog = tourDialog(page)
  await expect(dialog).toBeVisible()
  await expect(page.locator('.tour__title')).toHaveText('Ta taille, une fois pour toutes')

  await page.locator('[data-test="tour-skip"]').click()

  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-test="reader-tour"]')).toHaveCount(0)
  await expect(page).not.toHaveURL(/tour=1/)
  await expect(page.locator('.rhdr')).toBeVisible()
})

test('premier lancement automatique : confirmer la bienvenue ouvre la visite', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })

  // Sur le web, la porte du dossier (seule à poser `welcomeDue`) ne s'affiche jamais (cf.
  // le commentaire de `completeOnboarding` dans helpers.js) : on sème donc le drapeau
  // directement en IndexedDB, même technique que `swipeHintSeen`, pour observer le VRAI
  // enchaînement bienvenue → visite une fois le drapeau posé.
  await writeSetting(page, 'welcomeDue', true)
  await page.reload()

  const dialog = page.getByRole('dialog', { name: 'Bienvenue dans Rowtine !' })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('button', { name: 'Découvrir le lecteur' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Plus tard' })).toBeVisible()

  await page.locator('[data-test="confirm-ok"]').click()

  // La bienvenue se ferme, le drapeau est acquitté, et la visite s'ouvre sur le bonnet.
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(/\/project\/\d+\/read/)
  await expect(tourDialog(page)).toBeVisible()
  await expect(page.locator('.tour__title')).toHaveText('Ta taille, une fois pour toutes')
  expect(await readSetting(page, 'welcomeDue')).toBe(false)
})

test('bonnet supprimé (corbeille) puis relance : le projet est recréé sans dupliquer le patron en bibliothèque, même après plusieurs suppressions', async ({
  page,
}) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })

  await page.locator('.resume').click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  const oldId = projectIdFromUrl(page.url())
  expect(oldId).not.toBeNull()
  const patternsAvant = await countPatterns(page)

  // Suppression réelle via l'UI (menu ⋯ → « Supprimer le projet ») : pas de confirmation
  // intermédiaire, l'action retire tout de suite le projet et ramène à l'accueil.
  await page.locator('.phdr__kebab').click()
  await page.getByRole('button', { name: 'Supprimer le projet' }).click()
  await expect(page).toHaveURL(/\/$/)

  // Rechargement complet avant de relancer : la snackbar de suppression (avec son option
  // d'annulation) ne doit pas masquer celle de recréation qu'on attend juste après.
  await page.goto('/settings')
  await page.locator('[data-test="replay-tour"]').click()

  // Le bonnet n'existe plus (ni sous son ancien id, ni via le registre du semis initial) :
  // `ensureTourProject` le recrée, prévient par snackbar, puis ouvre la visite dessus.
  await expect(page.locator('.snack__msg')).toHaveText('Le projet d\'exemple a été recréé pour la visite.')
  await expect(page).toHaveURL(/\/project\/\d+\/read/)
  const newId = projectIdFromUrl(page.url())
  expect(newId).not.toBe(oldId)
  await expect(tourDialog(page)).toBeVisible()
  await expect(page.locator('.tour__title')).toHaveText('Ta taille, une fois pour toutes')
  // Le patron de bibliothèque, lui, N'A PAS été dupliqué : la suppression d'un PROJET ne
  // supprime pas un patron de bibliothèque (cf. projects.js::remove(), qui ne retire que les
  // patrons « instance », jamais posés par le semis) — `ensureTourProject` réutilise donc
  // celui qui a survécu plutôt que d'en recréer un.
  expect(await countPatterns(page)).toBe(patternsAvant)

  // Constat de la revue finale (23/09/2026, important n°2) : « à chaque fois » — une
  // SECONDE suppression, du projet fraîchement recréé, ne doit pas doubler le patron non
  // plus. Sans le correctif (mémoire `tourPatternId`), ce second tour ne peut plus s'appuyer
  // sur le semis initial (ce projet-ci n'y a jamais été inscrit) et recréait un doublon.
  await page.goto(`/project/${newId}`)
  await page.locator('.phdr__kebab').click()
  await page.getByRole('button', { name: 'Supprimer le projet' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.goto('/settings')
  await page.locator('[data-test="replay-tour"]').click()

  await expect(page.locator('.snack__msg')).toHaveText('Le projet d\'exemple a été recréé pour la visite.')
  await expect(page).toHaveURL(/\/project\/\d+\/read/)
  const secondNewId = projectIdFromUrl(page.url())
  expect(secondNewId).not.toBe(newId)
  await expect(tourDialog(page)).toBeVisible()
  expect(await countPatterns(page)).toBe(patternsAvant)
})

test('guide : le bouton de la section 0 relance la visite', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/guide')

  // Section 0 = « {app} en 4 étapes », première entrée du sommaire.
  await page.locator('.toc__item').first().click()
  await page.locator('[data-test="guide-replay-tour"]').click()

  await expect(page).toHaveURL(/\/project\/\d+\/read/)
  await expect(tourDialog(page)).toBeVisible()
  await expect(page.locator('.tour__title')).toHaveText('Ta taille, une fois pour toutes')
})

// Parcours critique #1 — Onboarding + garde de route persistante.
// Si cette porte casse, l'app est inutilisable : on vérifie l'entrée ET la persistance.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test('au 1er lancement, la garde renvoie vers l’onboarding', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/onboarding/)
  await expect(page.getByRole('heading', { name: 'Bienvenue sur Rowtine' })).toBeVisible()
})

test('onboarding complété → accueil personnalisé', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await expect(page.getByRole('heading', { name: 'Bonjour Alex !' })).toBeVisible()
})

test('après onboarding, un rechargement ne repasse PAS par l’onboarding', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })

  await page.reload()
  await expect(page).not.toHaveURL(/onboarding/)
  await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible()

  // Et un accès direct à l'onboarding renvoie vers l'accueil (settings.onboarded = true).
  await page.goto('/onboarding')
  await expect(page).not.toHaveURL(/onboarding/)
})

test('le choix de langue bascule l’interface (FR → EN)', async ({ page }) => {
  await page.goto('/')
  // Sélecteur de langue passé en liste déroulante (commit 5b75715) : la bascule à boutons
  // n'existe plus, cf. tests/e2e/language-switch.spec.js pour le même patron.
  await page.locator('[data-test="onb-language"]').selectOption('en')
  // Le titre d'accueil de l'onboarding reste la marque, mais le CTA technique passe en anglais.
  await expect(page.getByRole('button', { name: /Start knitting/i })).toBeVisible()
})

// Pop-ups du premier lancement (10/08/2026) : l'astuce « balaie pour revenir »
// (P3) a quitté l'accueil pour FirstDetailTip.vue. Ce qui a pris sa place sur
// l'accueil, la pop-up de BIENVENUE, n'est posée que par la porte du dossier SAF
// (OnboardingFolderPrompt.vue::onChooseNow → settingsStore.setWelcomeDue()), un flux
// NATIF UNIQUEMENT (Capacitor.isNativePlatform()) : sur le web, terrain de cette suite
// Playwright, cette porte ne s'affiche jamais (cf. onboarding-folder.spec.js), donc
// `welcomeDue` reste à `false` toute la session et la bienvenue est structurellement
// inatteignable ici — vérifié par exécution (l'accueil ne porte alors aucun `dialog`).
// Sa couverture vit en unitaire (tests/unit/home-welcome-popup.spec.js).
//
// Avertissement d'import et file des messages (19/08/2026, décision
// produit prise en cours de route) : l'astuce a de nouveau bougé, cette fois de la fiche
// patron vers les écrans de LISTE (Bibliothèque, Stock) et la fiche projet — « elle n'a
// rien à voir avec l'étape d'import d'un patron ». Ce test est réécrit en conséquence :
// il ouvre la Bibliothèque en PREMIER (pas une fiche patron) et vérifie que l'astuce s'y
// affiche déjà, puis que la fiche patron, elle, n'en montre AUCUNE — le cœur de la
// décision produit.
//
// Ce test NE PASSE PAS par le helper completeOnboarding() — qui sème désormais
// `swipeHintSeen` en IndexedDB pour que l'astuce n'interrompe pas les 51 autres fichiers
// e2e — afin d'observer et de valider le vrai flux de premier lancement : c'est le seul
// test e2e qui exerce cette astuce.
test('au 1er lancement, l’accueil n’affiche rien, l’astuce se montre à la 1ère LISTE visitée, jamais sur la fiche patron', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('#fn').fill('Alex')
  await page.getByRole('button', { name: 'Tricot', exact: true }).click()
  await page.getByRole('button', { name: /Commence à tricoter/ }).click()
  await expect(page.getByRole('heading', { name: 'Bonjour Alex !' })).toBeVisible()

  // Rien sur l'accueil : la bienvenue (native uniquement) n'est jamais atteinte ici.
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Première LISTE visitée (la Bibliothèque) : l'astuce s'affiche DÈS L'ARRIVÉE sur
  // l'écran, avant même d'ouvrir un patron — c'est le nouveau point de montage.
  await page.goto('/library')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Le sais-tu ?')).toBeVisible()
  await expect(dialog.getByText(/Balaie l'écran vers la droite pour revenir en arrière/)).toBeVisible()

  await dialog.getByRole('button', { name: "C'est compris" }).click()
  await expect(dialog).toBeHidden()

  // Cœur de la décision produit : la fiche d'un patron n'affiche PAS l'astuce — ni
  // maintenant (drapeau déjà posé), ni structurellement (elle a quitté PatternView).
  await page.getByRole('button', { name: 'Bonnet Torsade' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Persistée (swipeHintSeen) : revenir sur la Bibliothèque ne la remontre pas.
  await page.goto('/library')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Ni un rechargement complet.
  await page.reload()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

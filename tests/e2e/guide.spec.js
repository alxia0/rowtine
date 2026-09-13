// Écran Guide utilisateur — ajouté avec l'écran À propos et guide in-app. Ajouté en
// revue du 02/08 : ce chantier livrait GuideView.spec.js (montage isolé, AppHeader bouchonné) mais
// aucun e2e — rien n'exerçait la VRAIE route, le vrai lien depuis l'À propos, ni le
// chargement réel des images WebP (cf. l'écran précédent, qui avait ajouté 18 tests e2e pour ses 3
// écrans ; ce chantier-ci n'en ajoutait aucun pour le sien).
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers.js'

test('À propos ne porte plus le lien vers le guide : il a déménagé dans le menu ☰ (12/08)', async ({ page }) => {
  // Retourné, pas supprimé. Ce test cliquait le lien « Guide utilisateur » d'À propos et
  // vérifiait qu'il menait à /guide ; ce lien a été retiré (lot du 12/08, une seule porte
  // d'entrée désormais : le menu ☰, cf. AppHeader.vue). L'effacer purement et simplement
  // aurait laissé passer sans bruit un retour du lien à cet endroit. La reddition du
  // guide par le menu est couverte par tests/e2e/menu-items.spec.js et
  // tests/unit/AppHeader-menu.spec.js.
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/about')
  // Attendre un repère sûr du chargement de l'écran AVANT de vérifier une absence : la
  // route est chargée en lazy import, et `toHaveCount(0)` passerait vrai (mais pour de
  // mauvaises raisons) tant que rien n'est encore monté.
  await expect(page.locator('[data-test="about-link-privacy"]')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Guide utilisateur' })).toHaveCount(0)
})

test('Guide : le sommaire liste les 10 sections et n’affiche aucun bandeau de repli en français', async ({
  page,
}) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/guide')
  // On cible le BLOC du sommaire, pas son texte : la prose du guide cite désormais le mot
  // « sommaire » (§3, sommaire du lecteur) et getByText('Sommaire') résolvait 4 éléments.
  await expect(page.locator('.toc__title')).toBeVisible()
  // 10 sections mesurées dans src/content/guide/fr.md le 02/08 (l'intro « L'esprit de
  // Rowtine » + 9 sections numérotées) — si ce nombre change, ce test doit être relu, pas
  // juste ajusté en silence.
  await expect(page.locator('.toc__item')).toHaveCount(10)
  await expect(page.locator('.notice')).toHaveCount(0)
})

test('Guide : cliquer une entrée du sommaire ouvre la section correspondante', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/guide')
  const target = page.locator('.toc__item').nth(3) // « 2. Tes projets — le cœur de l'app »
  const label = await target.textContent()
  await target.click()
  const openSection = page.locator('.section[open]').filter({ hasText: label.trim() })
  await expect(openSection).toHaveCount(1)
})

test('Guide : chaque image du contenu français se charge réellement (aucune image cassée)', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/guide')
  // `.count()` n'attend PAS que Vue ait fini de monter la vue : sans cette assertion qui, elle,
  // réessaie jusqu'à un compte stable, une lecture immédiate après `goto()` peut tomber à 0
  // par pure course de rendu (observé en revue du 02/08).
  await expect(page.locator('.section')).toHaveCount(10)

  // `<details>` fermé ne retire PAS son contenu du DOM (les <img> y sont déjà, `.count()` les
  // trouve), mais les masque VISUELLEMENT — `toBeVisible()` échoue tant que la section reste
  // repliée. Il faut donc les ouvrir pour vérifier une vraie image, pas seulement sa présence.
  const summaries = page.locator('.section summary')
  const sectionCount = await summaries.count()
  for (let i = 0; i < sectionCount; i++) await summaries.nth(i).click()

  const images = page.locator('.figure img')
  const total = await images.count()
  expect(total).toBeGreaterThan(0)
  for (let i = 0; i < total; i++) {
    const img = images.nth(i)
    await expect(img).toBeVisible()
    // naturalWidth reste à 0 si le fichier n'a pas pu être décodé (nom introuvable, WebP
    // corrompu…) même quand l'élément <img> lui-même est "visible" dans le DOM.
    const naturalWidth = await img.evaluate((el) => el.naturalWidth)
    expect(naturalWidth, `image cassée : ${await img.getAttribute('src')}`).toBeGreaterThan(0)
  }
})

// Figures agrandissables (travaux du 11/08, §6). Deux choses à prouver ENSEMBLE : le tap
// ouvre bien la visionneuse partagée sur LA figure touchée, et le geste retour la referme
// SANS quitter le guide (la précédence vit dans App.vue, pas dans GuideView : la fermeture
// et le maintien sur /guide doivent être vérifiés tous les deux, l'un sans l'autre ne prouve
// rien — un retour qui ferme la visionneuse ET navigue serait tout aussi cassé).
test('Guide : toucher une figure l’ouvre en plein écran ; le geste retour la referme sans quitter le guide', async ({
  page,
}) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/guide')
  await expect(page.locator('.section')).toHaveCount(10)
  // Le bandeau de décision de sauvegarde AVALE le retour (App.vue, `interceptBackupPrompt`,
  // qui passe avant la visionneuse) : s'il était affiché ici, l'assertion de fermeture
  // échouerait pour une raison étrangère à cette fonctionnalité.
  await expect(page.locator('[data-test="backup-decision-prompt"]')).toHaveCount(0)

  // Première section portant au moins DEUX figures : cliquer la deuxième est ce qui distingue
  // « ouvre la bonne » de « ouvre la première ». Trouvée dans le DOM (un <details> replié
  // garde ses figures, cf. plus haut) plutôt qu'en recopiant un numéro de section du guide,
  // qui bougerait au premier remaniement du contenu.
  const sections = page.locator('.section')
  const total = await sections.count()
  let cible = -1
  for (let i = 0; i < total; i++) {
    if ((await sections.nth(i).locator('.figure__btn').count()) >= 2) {
      cible = i
      break
    }
  }
  expect(cible, 'aucune section du guide ne porte 2 figures').toBeGreaterThanOrEqual(0)

  await sections.nth(cible).locator('summary').click()
  const figures = sections.nth(cible).locator('.figure__btn')
  const deuxieme = figures.nth(1)
  await expect(deuxieme).toBeVisible()
  const srcAttendue = await deuxieme.locator('img').getAttribute('src')

  // La vignette EN LIGNE reste plafonnée à 320 px (décision du lot : c'est l'agrandissement
  // qui règle la lisibilité, pas la taille dans le fil du texte). Le plafond a changé
  // d'élément — il est désormais porté par le bouton qui enveloppe l'image — donc on le
  // mesure sur le rendu réel, pas dans la feuille de style.
  const boite = await deuxieme.boundingBox()
  expect(boite.width).toBeLessThanOrEqual(320)

  await deuxieme.click()
  const visionneuse = page.locator('.lb[role="dialog"]')
  await expect(visionneuse).toBeVisible()
  await expect(visionneuse.locator('[data-test="lb-img"]')).toHaveAttribute('src', srcAttendue)

  // Geste retour : balayage depuis le bord gauche, écouté par `useSwipeBack` sur `window`
  // (App.vue) — le MÊME point d'entrée (`onBack`) que le bouton retour Android, dont le
  // plugin Capacitor est absent sur le web. Événements fabriqués comme dans
  // tests/unit/App.back-precedence.spec.js : `useSwipeBack` ne lit que `touches[0]` et
  // `changedTouches[0]`.
  await page.evaluate(() => {
    function toucher(type, x, y) {
      const ev = new Event(type)
      Object.defineProperty(ev, 'touches', { value: [{ clientX: x, clientY: y }] })
      Object.defineProperty(ev, 'changedTouches', { value: [{ clientX: x, clientY: y }] })
      return ev
    }
    window.dispatchEvent(toucher('touchstart', 10, 200)) // bord gauche (seuil : 28 px)
    window.dispatchEvent(toucher('touchend', 140, 200)) // ≥ 70 px, quasi horizontal
  })

  await expect(visionneuse).toHaveCount(0) // la visionneuse s'est fermée…
  await expect(page).toHaveURL(/\/guide$/) // … et on est TOUJOURS dans le guide
  await expect(page.locator('.toc__item')).toHaveCount(10)
})

test('Guide : retour vers l’écran d’origine (accueil, via le menu)', async ({ page }) => {
  // Depuis le lot du 12/08, le guide ne s'atteint plus qu'en passant par le menu ☰ (cf.
  // AppHeader.vue) — plus par À propos. Ce test vérifiait le retour intelligent
  // (useSmartBack, src/composables/useSmartBack.js) depuis /guide vers l'écran d'où l'on
  // venait ; seule l'origine change avec le nouveau chemin d'accès, pas le comportement
  // testé.
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.locator('.hdr__burger').click()
  await page.getByRole('button', { name: 'Guide utilisateur' }).click()
  await expect(page).toHaveURL(/\/guide$/)
  await page.locator('.hdr__back').click()
  await expect(page).toHaveURL(/\/$/)
})

test('guide — en réglage « Système », les captures suivent la préférence de l’OS', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Système', exact: true }).click()

  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/guide')
  // Chaque section démarre repliée (<details> sans `open`, comme documenté plus haut dans ce
  // fichier) : sans cette ouverture, la 1re image reste masquée par l'UA stylesheet et
  // `toBeVisible()` échoue sur un timeout n'ayant rien à voir avec le thème (constaté : Playwright
  // résout bien l'élément mais le rapporte "hidden").
  await page.locator('.section summary').first().click()
  const premiere = page.locator('figure.figure img').first()
  await expect(premiere).toBeVisible()
  const clair = await premiere.getAttribute('src')

  // Pas de rechargement : c'est la RÉACTIVITÉ qu'on mesure. Un composant qui lirait le thème
  // une seule fois à l'initialisation passerait si on rechargeait la page ici.
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => premiere.getAttribute('src')).not.toBe(clair)
})

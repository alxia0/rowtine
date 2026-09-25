// Les 4 onglets de la fiche projet (Sections/Détails/Photos/Sessions) débordent sur un
// écran étroit — le défilement horizontal EXISTE déjà (`.tabs { overflow-x: auto }`), mais
// la barre de scroll est masquée volontairement (`scrollbar-width: none`) : rien ne dit
// donc que « Sessions », coupé à droite, est atteignable. On vérifie ici l'indice de
// dégradé (`.tabs--fade`, `mask-image`) : PRÉSENT seulement quand ça déborde réellement,
// ABSENT sinon — un indice permanent mentirait sur un écran qui tient tout. Cf. P2.
//
// Piège de mesure de ce chantier : `not.toBeVisible()` ignore l'opacité/le masque → on lit
// le style calculé (`getComputedStyle().maskImage`), pas la visibilité Playwright.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test('un indice de dégradé signale que les onglets défilent, seulement quand ça déborde vraiment', async ({
  page,
}) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.locator('.resume').click()
  await expect(page).toHaveURL(/\/project\/\d+/)

  // --- écran étroit (360px) : la bande de 4 onglets déborde réellement (mesuré : 13px) ---
  //
  // 🔄 Ce cas se mesurait à 375 px jusqu'au 17/08/2026, où il débordait de 19 px. Le
  // changement de police (DM Sans → Source Sans 3, plus étroite) a fait TENIR les quatre
  // onglets dans 375 px : le débordement y est tombé à 0, et ce test a échoué — correctement.
  // Il ne fabriquait plus le cas qu'il prétendait éprouver.
  //
  // Seuil re-mesuré le 17/08, largeur par largeur : 280→93 px de débordement · 320→53 ·
  // 340→33 · **360→13** · 375→0 · 390→0 · 412→0. La bascule tombe donc entre 360 et 375 px.
  // On descend à 360 px, palier « petit téléphone » déjà employé dans responsive.spec.js.
  //
  // ⚠️ Ce n'est PAS un défaut corrigé : c'est un changement de ce que voit l'utilisatrice.
  // Sur un téléphone de 375 px ou plus — la majorité — les onglets ne défilent plus du tout
  // et l'indice de dégradé ne s'affiche plus. En dessous, tout est inchangé.
  await page.setViewportSize({ width: 360, height: 800 })

  const tabs = page.locator('.tabs')
  // Attend un élément RÉEL (pas le SkeletonScreen) avant de mesurer quoi que ce soit.
  await expect(page.getByRole('tab').first()).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(4)

  // Débordement réel du conteneur — sinon on teste l'inverse de ce qu'on croit.
  const overflowNarrow = await tabs.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflowNarrow).toBeGreaterThan(1)

  await expect(tabs).toHaveClass(/tabs--fade/)
  const maskNarrow = await tabs.evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage)
  expect(maskNarrow).not.toBe('none')

  // --- bout de course : défilé jusqu'au bout à droite, plus rien à défiler, l'indice doit
  // s'éteindre lui aussi (sinon il annonce une suite qui n'existe pas). Vrai scroll
  // navigateur (pas un mock jsdom) : seul ce test exerce ce cas. `toHaveClass` réessaie
  // tant que Playwright n'observe pas la classe attendue — l'écouteur `scroll` du
  // composable n'est pas forcément synchrone avec l'assignation de `scrollLeft`.
  await tabs.evaluate((el) => {
    el.scrollLeft = el.scrollWidth
  })
  await expect(tabs).not.toHaveClass(/tabs--fade/)
  const maskScrolledEnd = await tabs.evaluate(
    (el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage,
  )
  expect(maskScrolledEnd).toBe('none')

  // Revenir au début pour ne pas fausser les assertions suivantes.
  await tabs.evaluate((el) => {
    el.scrollLeft = 0
  })
  await expect(tabs).toHaveClass(/tabs--fade/)

  // --- écran large (900px, > 840px de .screen) : tout tient, l'indice ne doit PAS mentir ---
  await page.setViewportSize({ width: 900, height: 800 })

  // Le composable écoute 'resize' : attend la réévaluation réactive (pas un sleep fixe).
  await expect(tabs).not.toHaveClass(/tabs--fade/)
  const overflowWide = await tabs.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflowWide).toBeLessThanOrEqual(1)
  const maskWide = await tabs.evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage)
  expect(maskWide).toBe('none')

  // Régression : l'onglet Sessions reste atteignable et fonctionnel (gate device #10).
  await page.getByRole('tab', { name: 'Sessions' }).click()
  await expect(page.locator('#panel-sessions')).toBeVisible()
})

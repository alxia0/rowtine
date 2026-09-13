// Les 10 filtres de catégorie de la bibliothèque (« Tous » + 9 catégories) tenaient sur 4
// rangées (`.chips { flex-wrap: wrap }`) avant la liste de patrons — une bande horizontale
// qui défile rend la hauteur constante. Même motif que les onglets de la fiche projet (T8,
// `project-tabs-scroll.spec.js`) : `overflow-x: auto` + indice de dégradé `useScrollFade`,
// PRÉSENT seulement quand ça déborde réellement — un indice permanent mentirait sur un
// écran qui tient tout. Cf. P2.
//
// Différence mesurée avec T8 (onglets) : la largeur de contenu est plafonnée par l'échelle
// `--w-content` (480px sur téléphone, 720px en tablette portrait, 840px en tablette
// paysage — cf. tokens.css). Les 10 chips (labels longs : « Jouets / Peluches »,
// « Déco maison »…) mesurent ~999px de large — plus que le plafond le plus large.
// Contrairement aux 4 onglets de T8 (qui TIENNENT à 900px), la
// bande de chips DÉBORDE TOUJOURS dans cette app, à n'importe quelle largeur de fenêtre
// réaliste : il n'existe donc pas de scénario "tout tient" reproductible ici en e2e. On ne
// duplique pas ce volet du test — la garantie « inactif quand tout tient » est déjà prouvée
// génériquement au niveau du composable (`tests/unit/useScrollFade.spec.js`, T8), qu'on ne
// réécrit pas. Ce test-ci prouve la bonne CÂBLAGE dans LibraryView.vue avec du contenu réel.
//
// Piège de mesure de ce chantier : `not.toBeVisible()` ignore l'opacité/le masque → on lit
// le style calculé (`getComputedStyle().maskImage`), pas la visibilité Playwright.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test('une seule rangée de filtres qui défile, avec un indice de dégradé quand ça déborde vraiment', async ({
  page,
}) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/library')

  const chips = page.locator('.chips')
  // Attend un élément RÉEL avant de mesurer quoi que ce soit.
  await expect(page.getByRole('button', { name: 'Tous' })).toBeVisible()

  for (const width of [375, 393]) {
    await page.setViewportSize({ width, height: 800 })

    // Une seule rangée : la hauteur du conteneur ne dépasse pas ~1,5 chip (marge de
    // tolérance sub-pixel), alors qu'en `flex-wrap: wrap` elle en occuperait 4.
    const chipHeight = await page.locator('.chip').first().evaluate((el) => el.getBoundingClientRect().height)
    const chipsHeight = await chips.evaluate((el) => el.getBoundingClientRect().height)
    expect(chipsHeight).toBeLessThan(chipHeight * 1.5)

    // Cible tactile du projet (min-height 44 px, cf. CorrectionView) : les chips sont de
    // vrais boutons — l'élargissement ne doit pas non plus repasser la bande sur 2 rangées.
    const box = await page.locator('.chip').first().boundingBox()
    expect(box.height).toBeGreaterThanOrEqual(44)

    const overflowX = await chips.evaluate((el) => getComputedStyle(el).overflowX)
    expect(['auto', 'scroll']).toContain(overflowX)

    // Débordement réel du conteneur — sinon on teste l'inverse de ce qu'on croit.
    const overflow = await chips.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeGreaterThan(1)

    await expect(chips).toHaveClass(/chips--fade/)
    const mask = await chips.evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage)
    expect(mask).not.toBe('none')
  }

  // Régression : les chips restent cliquables et filtrent bien la liste.
  await page.getByRole('button', { name: 'Amigurumi' }).click()
  await expect(page.getByRole('button', { name: 'Amigurumi' })).toHaveClass(/chip--on/)
})

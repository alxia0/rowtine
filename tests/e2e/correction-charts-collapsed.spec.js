// La bande « Diagrammes de ce patron » de l'écran
// « Corriger le patron » est repliée par défaut derrière une puce « Diagrammes (N) »
// qui déplie/replie la liste des sections chart-éligibles au tap. La LOGIQUE de
// bascule (setChartType/demoteImage/workingReader/chartStripRows, cf. CorrectionView.vue)
// n'est pas testée ici (couverte ailleurs) : seul l'habillage replié/déplié l'est.
//
// Patron démo chart-éligible : « Bonnet Torsade » (seedé à l'onboarding) contient un
// diagramme → chartStripRows non vide sur son écran de correction. On récupère son id
// directement depuis /library (PAS helpers.openDemoReaderWithChart, qui crée un projet
// et ouvre le lecteur /project/:id/read — ici on veut l'écran de correction du patron,
// /pattern/:id/correct).
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test('correction : bande diagrammes repliée par défaut, se déplie au tap', async ({ page }) => {
  await completeOnboarding(page)
  await page.goto('/library')
  await page.getByRole('button', { name: 'Bonnet Torsade' }).click()
  await expect(page).toHaveURL(/\/pattern\/(\d+)/)
  const id = page.url().match(/\/pattern\/(\d+)/)[1]
  await page.goto(`/pattern/${id}/correct`)

  const toggle = page.getByRole('button', { name: /Diagrammes \(\d+\)/ })
  await expect(toggle).toBeVisible()

  // Repliée par défaut : les lignes de bascule (Suivre comme diagramme / Juste une image)
  // sont cachées.
  await expect(page.getByRole('button', { name: /Suivre comme diagramme|Juste une image/ })).toHaveCount(0)

  await toggle.click()
  await expect(page.getByRole('button', { name: /Suivre comme diagramme|Juste une image/ }).first()).toBeVisible()
})

// Point A : AppIcon.vue rend LUI AUSSI un <span class="app-icon">
// (cf. AppIcon.vue) — un sélecteur `.chart-strip__toggle span { flex: 1 }` naïf frappe
// donc les TROIS enfants directs du bouton (icône, libellé, chevron) à parts égales.
// Mesuré sur ce patron : 100px chacun sur un bouton de 327px, le libellé perd la place
// et passe sur deux lignes (42px de haut au lieu de 18). Un seul page.evaluate (les 3
// getBoundingClientRect doivent provenir du MÊME instantané de mise en page — deux
// aller-retours séparés risqueraient un reflow entre les deux, faussant la comparaison
// des largeurs) : le libellé (span du milieu) doit être bien plus large que les deux
// icônes réunies, ET tenir sur une seule ligne (hauteur < 1,3x sa line-height calculée
// — marge pour l'arrondi du rendu, mais bien en-deçà du doublement qu'un passage à la
// ligne provoquerait).
test('correction : le libellé « Diagrammes (N) » ne se casse pas sur deux lignes', async ({ page }) => {
  await completeOnboarding(page)
  await page.goto('/library')
  await page.getByRole('button', { name: 'Bonnet Torsade' }).click()
  await expect(page).toHaveURL(/\/pattern\/(\d+)/)
  const id = page.url().match(/\/pattern\/(\d+)/)[1]
  await page.goto(`/pattern/${id}/correct`)

  const toggle = page.getByRole('button', { name: /Diagrammes \(\d+\)/ })
  await expect(toggle).toBeVisible()

  const layout = await toggle.evaluate((el) => {
    // Les 3 enfants DIRECTS du bouton, dans l'ordre du template (CorrectionView.vue) :
    // AppIcon(chart) — span libellé — AppIcon(chevron). `el.children[1]`, PAS
    // `el.querySelector('span')` : AppIcon rend LUI AUSSI un <span class="app-icon">
    // (premier span du sous-arbre en ordre document), dont le line-height réinitialisé
    // par ses propres styles (flex icône) n'a rien à voir avec celui du texte.
    const [iconEl, labelEl, chevronEl] = [...el.children]
    const icon = iconEl.getBoundingClientRect()
    const label = labelEl.getBoundingClientRect()
    const chevron = chevronEl.getBoundingClientRect()
    // `getComputedStyle(labelEl).lineHeight` renvoie littéralement "normal" (Chromium,
    // aucun line-height explicite sur .chart-strip__toggle) — pas une valeur px
    // exploitable. La hauteur d'UNE seule ligne de texte, elle, reste mesurable même si
    // le span entier s'étale déjà sur deux lignes : un Range posé sur son texte rend un
    // rect PAR LIGNE (getClientRects), le premier donnant la hauteur d'une ligne — la
    // vraie « line-height calculée », indépendante de l'état (cassé ou non) qu'on teste.
    const range = document.createRange()
    range.selectNodeContents(labelEl)
    const lineHeight = range.getClientRects()[0].height
    return {
      iconWidth: icon.width,
      chevronWidth: chevron.width,
      labelWidth: label.width,
      labelHeight: label.height,
      lineHeight,
    }
  })

  expect(layout.labelWidth).toBeGreaterThan(layout.iconWidth + layout.chevronWidth)
  expect(layout.labelHeight).toBeLessThan(layout.lineHeight * 1.3)
})

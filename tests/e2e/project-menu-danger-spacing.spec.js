// L'action destructive « Supprimer le projet » était trop collée à « Modifier le projet »
// dans le menu ⋯ de la fiche projet : un doigt qui vise « Modifier » peut taper « Supprimer »
// sans le vouloir. Cf. audit UX 16/07, item P1 n°3 volet « espace », reporté au P2 (item 0)
// puis rouvert sur retour terrain le 17/07.
//
// Note vérifiée dans le code (5e correction de cet audit) : contrairement à ce qu'écrivait
// l'audit (« collée à Modifier sans aucune séparation »), un `.menu__sep` existe déjà — depuis
// le tout premier commit du dépôt, jamais supprimé — et rend un vrai espace (~9 px : 4 px de
// marge de chaque côté d'un liseré de 1 px à 12 % d'opacité). L'audit avait donc tort sur le
// fait qu'il n'existe AUCUNE séparation. Mais à l'échelle réelle d'un téléphone, ce liseré fin
// et pâle passe inaperçu — d'où le retour terrain. On renforce l'espace du `.menu__sep`
// existant plutôt que d'empiler margin/border/padding sur `.menu__item--danger` (ce qui
// doublonnerait le mécanisme de séparation).
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test('un espace net sépare « Supprimer le projet » de « Modifier le projet » dans le menu ⋯', async ({
  page,
}) => {
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })

  // Le projet démo (bouton « Reprendre ») a une fiche standard avec le menu ⋯.
  await page.locator('.resume').click()
  await expect(page).toHaveURL(/\/project\/\d+/)

  await page.locator('.phdr__kebab').click()
  const menu = page.locator('.menu')
  await expect(menu).toBeVisible()
  // Laisse finir la transition d'entrée (translateY) avant de mesurer les positions : les deux
  // boutons se déplacent ensemble, donc l'écart mesuré entre eux ne dépend pas du timing —
  // mais on attend quand même l'état stable par hygiène.
  await expect(menu).toHaveCSS('opacity', '1')

  const edit = menu.getByRole('button', { name: 'Modifier le projet' })
  const del = menu.getByRole('button', { name: 'Supprimer le projet' })
  await expect(edit).toBeVisible()
  await expect(del).toBeVisible()

  const editBox = await edit.boundingBox()
  const delBox = await del.boundingBox()
  const gap = delBox.y - (editBox.y + editBox.height)

  // Avant correctif : ~9 px (margin: var(--sp-1) de chaque côté d'un liseré de 1 px).
  // Après correctif : ~17 px (margin: var(--sp-2)). Seuil à mi-chemin : discrimine les deux
  // sans être fragile au pixel près.
  expect(gap).toBeGreaterThan(13)
})

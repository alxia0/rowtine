// Ce que ce test prouve : les caractéristiques n'introduisent AUCUN nouvel écart de hauteur.
// Ce qu'il ne prouve PAS : que toutes les cartes ont la même hauteur — elles ne l'ont déjà
// pas (164 px contre 249 px selon la longueur du nom, mesuré le 05/08). D'où les TROIS noms
// de même longueur ci-dessous : sans cela, le test mesurerait l'enroulement du nom et non
// l'effet des icônes.
//
// ⚠️ TROIS cartes, pas deux — ne JAMAIS revenir à deux. Deux cartes côte à côte tombent
// dans la MÊME ligne de la grille (`.ygrid`), et CSS Grid les égalise par défaut
// (`align-items: stretch` étire chaque item à la hauteur de sa ligne) — quel que soit LEUR
// CONTENU. Une paire mesure donc une égalité imposée par la grille, pas par
// `.ycard__labels` : ce piège a été mesuré en revue (06/08), le test à deux
// cartes restait vert même avec `min-height: 20px` remplacé par `0` sur `.ycard__labels`.
// Avec TROIS cartes de même longueur de nom sur une grille à 2 colonnes, la troisième se
// retrouve SEULE sur sa ligne : rien ne l'étire, sa hauteur est la sienne. Mesuré :
// [141, 141, 141] sans le bug, [137, 137, 121] avec — la 3e carte (sans icône, seule sur sa
// ligne) est la seule à révéler l'écart. Il faut au moins une carte seule sur sa ligne pour
// que la hauteur mesurée lui appartienne en propre.
//
// ⚠️ Ce test suppose que la grille du stock affiche exactement DEUX colonnes à la largeur
// d'écran émulée par le projet e2e (`devices['Pixel 5']`, playwright.config.js:35) — c'est
// ce qui fait retomber la 3e carte seule sur sa ligne. Si cette largeur ou le point de
// rupture de `.ygrid` changeait un jour vers TROIS colonnes, les trois cartes retomberaient
// sur une seule ligne, `align-items: stretch` les égaliserait de nouveau, et ce test redeviendrait
// aveugle — exactement le piège qu'il vient de fermer (revue finale, correction 5,
// 06/08/2026). Revérifie le nombre de colonnes obtenu si la largeur d'écran émulée change.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test('en vue grille, une carte sans icône et une carte à quatre icônes ont la même hauteur', async ({ page }) => {
  test.setTimeout(180_000)
  await completeOnboarding(page, { firstName: 'Alex', technique: 'knitting' })
  await page.goto('/stash')

  const ajouter = async (marque, labels) => {
    await page.getByRole('button', { name: 'Ajouter une laine' }).click()
    await page.locator('.addform select').first().selectOption('__other__')
    await page.locator('input[placeholder="Saisis la marque"]').fill(marque)
    await page.locator('.palette__sw[aria-label="moutarde"]').click()
    for (const l of labels) await page.locator('.labelchip', { hasText: l }).click()
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await page.waitForTimeout(300)
  }

  // Noms de MÊME longueur : c'est le nom qui fait varier la hauteur, pas les icônes.
  // Grille à 2 colonnes → Alpha/Bravo forment la 1re ligne (étirées l'une vers l'autre,
  // ce qui ne prouve rien), Cesar forme la 2e ligne À ELLE SEULE (rien ne l'étire).
  await ajouter('Alpha', [])
  await ajouter('Bravo', ['Vegan', 'Recyclée', 'Éthique', 'Sans mulesing'])
  await ajouter('Cesar', [])

  await page.goto('/stash')
  await page.locator('.viewtoggle').click()
  await expect(page.locator('.ygrid')).toBeVisible()
  await page.waitForTimeout(400)

  const h = await page.evaluate(() =>
    [...document.querySelectorAll('.ygrid .ycard')].map((c) => Math.round(c.getBoundingClientRect().height)),
  )
  expect(h).toHaveLength(3)
  expect(new Set(h).size, `hauteurs différentes : ${h.join(' vs ')}`).toBe(1)
})

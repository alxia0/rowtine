// Travaux sur les zones de sécurité et les retours tablette — retour device : en paysage court
// (Huawei Mate 20 Pro), le carré saturation×valeur (`max-height: 62vw`, calculé sur la
// LARGEUR) dépassait à lui seul la hauteur de l'écran et poussait la bande de teinte, le
// champ hexa et les boutons hors champ, dès l'ouverture (pas un problème de clavier).
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test.use({ viewport: { width: 812, height: 375 } }) // paysage type Mate 20 Pro
const VIEWPORT_HEIGHT = 375

async function openCustomColorPicker(page) {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/stash')
  await page.getByRole('button', { name: /Ajouter une laine/ }).click()
  await page.getByRole('button', { name: 'Couleur personnalisée' }).click()
  await expect(page.locator('.cpick__card')).toBeVisible()
}

test('en paysage, tout le sélecteur de couleur est visible', async ({ page }) => {
  await openCustomColorPicker(page)

  for (const sel of ['.cpick__area', '.cpick__hue', '.cpick__hex', '.cpick__ok']) {
    const box = await page.locator(sel).boundingBox()
    expect(box, `${sel} absent`).not.toBeNull()
    // chaque élément clé tient entièrement dans la hauteur du viewport
    expect(box.y, `${sel} sort par le haut`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `${sel} sort par le bas`).toBeLessThanOrEqual(VIEWPORT_HEIGHT)
  }
})

// Relecture (constat 2, 27/07) : `keyboardOpen` est piloté par @focus/@blur DOM sur
// `.cpick__hex` (ColorPickerDialog.vue) — Playwright ne pilote pas de vraie IME Android,
// mais `.focus()`/`.blur()` suffisent à exercer tout le déclencheur et donc toute la règle
// CSS `.cpick--kb-open` en paysage court (le clavier natif lui-même n'a rien à voir avec ce
// qui est vérifié ici).
test('paysage court, focus du champ hexa : carré et teinte se masquent, hexa et boutons restent atteignables, couleur conservée', async ({
  page,
}) => {
  await openCustomColorPicker(page)

  // On choisit une couleur via la bande de teinte AVANT de toucher au champ hexa, pour
  // vérifier ensuite qu'elle survit au cycle masquage/réaffichage.
  const hue = page.locator('.cpick__hue')
  await hue.evaluate((el) => {
    el.value = '200'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const hex = page.locator('.cpick__hex')
  const hexBeforeFocus = await hex.inputValue()

  await hex.focus()
  await expect(page.locator('.cpick')).toHaveClass(/cpick--kb-open/)
  await expect(page.locator('.cpick__area')).toBeHidden()
  await expect(page.locator('.cpick__hue')).toBeHidden()

  for (const sel of ['.cpick__hex', '.cpick__ok', '.cpick__cancel']) {
    const box = await page.locator(sel).boundingBox()
    expect(box, `${sel} absent`).not.toBeNull()
    expect(box.y, `${sel} sort par le haut`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `${sel} sort par le bas`).toBeLessThanOrEqual(VIEWPORT_HEIGHT)
  }

  await hex.blur()
  await expect(page.locator('.cpick')).not.toHaveClass(/cpick--kb-open/)
  await expect(page.locator('.cpick__area')).toBeVisible()
  await expect(page.locator('.cpick__hue')).toBeVisible()
  await expect(hex).toHaveValue(hexBeforeFocus)
})

// Relecture (constat 1, 27/07) : mesuré au device, le bouton retour Android
// ferme le clavier natif SANS déclencher `blur` DOM —
// `activeElement` reste le champ hexa. On reproduit ce point mort précis avec un
// `pointerdown` synthétique (`dispatchEvent`, qui ne déclenche PAS le changement de focus
// par défaut du navigateur contrairement à `.click()`) sur une zone de la carte hors du
// champ hexa : le focus DOM reste sur `.cpick__hex`, exactement comme après le bouton
// retour, et on vérifie que le correctif (pointerdown → reset `keyboardOpen`) ressort
// quand même le carré et la bande de teinte.
test('paysage court, bouton retour Android (pas de blur) : un tap ailleurs sur la carte ressort le carré', async ({
  page,
}) => {
  await openCustomColorPicker(page)

  const hex = page.locator('.cpick__hex')
  await hex.focus()
  await expect(page.locator('.cpick')).toHaveClass(/cpick--kb-open/)
  await expect(page.locator('.cpick__area')).toBeHidden()

  // Simule l'état laissé par le bouton retour Android : le focus DOM ne bouge pas.
  await page.locator('.cpick__head').dispatchEvent('pointerdown')
  await expect(hex).toBeFocused()

  await expect(page.locator('.cpick')).not.toHaveClass(/cpick--kb-open/)
  await expect(page.locator('.cpick__area')).toBeVisible()
  await expect(page.locator('.cpick__hue')).toBeVisible()
})

// Relecture 2e passe (avant commit, 27/07) : `.cpick__hexwrap` est un `<label>` qui
// enveloppe implicitement le champ hexa — taper le libellé ou l'aperçu couleur (même
// ligne, hors du champ lui-même) focalise un champ déjà actif : aucun nouvel évènement
// `focus` ne repart, donc si le pointerdown avait déjà remis `keyboardOpen` à `false`,
// rien ne le repasserait à `true` — carré/teinte réapparaîtraient avec le clavier natif
// toujours à l'écran. D'où l'exclusion élargie à toute la ligne (`.cpick__row`), pas
// seulement au champ.
test("paysage court, tap sur le libellé du champ hexa (même ligne, hors champ) ne referme pas l'état clavier ouvert", async ({
  page,
}) => {
  await openCustomColorPicker(page)

  const hex = page.locator('.cpick__hex')
  await hex.focus()
  await expect(page.locator('.cpick')).toHaveClass(/cpick--kb-open/)

  await page.locator('.cpick__hexlbl').dispatchEvent('pointerdown')

  await expect(page.locator('.cpick')).toHaveClass(/cpick--kb-open/)
  await expect(page.locator('.cpick__area')).toBeHidden()
})

// Relecture 2e passe (28/07) : DÉCOUVERT en durcissant le correctif du constat 1 — taper
// Enregistrer PENDANT que le champ hexa a le focus, en paysage court, pouvait ne pas
// fermer le pop-up (le blur natif reflow la grille avant le relâchement du doigt, le clic
// synthétique rate alors le bouton). C'est le geste central de cet écran — reproduit sur
// le commit de livraison initial de cette tâche. `.tap()` (pas `.click()`) est
// indispensable ici : c'est spécifiquement l'écart entre le point où le doigt se pose et
// celui où il se relève, propre au tactile, qui déclenche le défaut.
test("paysage court, saisie hexa puis Enregistrer sans passer par une zone neutre : le pop-up se ferme et la couleur s'applique", async ({
  page,
}) => {
  await openCustomColorPicker(page)

  const hex = page.locator('.cpick__hex')
  await hex.focus()
  await expect(page.locator('.cpick')).toHaveClass(/cpick--kb-open/)

  await hex.fill('2b883f')
  await page.locator('.cpick__ok').tap()

  await expect(page.locator('.cpick__card')).toBeHidden()
  const customSwatch = page.locator('.palette__cust')
  await expect(customSwatch).toHaveClass(/palette__sw--on/)
  await expect(customSwatch).toHaveCSS('background-color', 'rgb(43, 136, 63)') // #2b883f
})

// Même défaut, côté Annuler : le tap ne doit ni rater le bouton, ni appliquer la couleur
// en cours de saisie (Annuler doit toujours annuler sans rien appliquer).
test('paysage court, saisie hexa puis Annuler sans passer par une zone neutre : le pop-up se ferme sans rien appliquer', async ({
  page,
}) => {
  await openCustomColorPicker(page)

  const hex = page.locator('.cpick__hex')
  await hex.focus()
  await expect(page.locator('.cpick')).toHaveClass(/cpick--kb-open/)

  await hex.fill('2b883f')
  await page.locator('.cpick__cancel').tap()

  await expect(page.locator('.cpick__card')).toBeHidden()
  await expect(page.locator('.palette__cust')).not.toHaveClass(/palette__sw--on/)
})

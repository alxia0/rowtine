// Gate qualité — contraste AA MESURÉ en thème sombre. On mesure la couleur
// EFFECTIVEMENT visible (alpha composé sur le fond), jamais la rgba brute — cf.
// icon-contrast.spec.js. Bascule sombre forcée comme theme-a11y.spec.js (clic « Sombre »
// en Réglages, persistance Dexie ; addInitScript(localStorage) seul est effacé par le
// garde de route) + auto-vérification body bg avant chaque mesure.
import { test, expect } from '@playwright/test'
import { completeOnboarding, openDemoReaderWithChart } from './helpers'

// --- Copié verbatim de tests/e2e/icon-contrast.spec.js ---
function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)]
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

function parse(rgb) {
  // Peut renvoyer 3 (rgb) ou 4 (rgba) composantes.
  return rgb.match(/[\d.]+/g).map(Number)
}

function composite([r, g, b, a = 1], bg) {
  return [
    a * r + (1 - a) * bg[0],
    a * g + (1 - a) * bg[1],
    a * b + (1 - a) * bg[2],
  ]
}
// --- fin du bloc copié ---

// Bascule sombre forcée (calquée sur theme-a11y.spec.js::forceDark) : onboarding puis clic
// explicite sur « Sombre » en Réglages (persistance Dexie + localStorage), attend le
// data-theme='dark' effectif avant de continuer.
async function forceDark(page) {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sombre', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark')
}

// Garde-fou anti-théâtre : le sombre est-il RÉELLEMENT rendu avant de mesurer ? Fond attendu
// au défaut dynamique T2 : rose 320 → rgb(21, 18, 21) (#151215).
async function assertReallyDark(page) {
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgb(21, 18, 21)')
}

test('sombre — texte principal et secondaire atteignent AA (réglages)', async ({ page }) => {
  await forceDark(page)
  await page.goto('/settings')
  await assertReallyDark(page)
  await expect(page.getByText(/Apparence/).first()).toBeVisible()

  const pairs = await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor
    const title = getComputedStyle(document.querySelector('.block__title')).color
    const muted = getComputedStyle(document.querySelector('.muted')).color
    const tile = getComputedStyle(document.querySelector('.block')).backgroundColor
    return { bg, title, muted, tile }
  })
  const tile = parse(pairs.tile)
  // Titre (--ink) sur tuile : ≥ 4.5 (texte normal)
  const titleRatio = contrast(composite(parse(pairs.title), tile), tile)
  // Texte atténué (--ink-55, translucide) sur tuile : ≥ 4.5
  const mutedRatio = contrast(composite(parse(pairs.muted), tile), tile)
  console.log(`[contrast] réglages — titre(--ink)/tuile = ${titleRatio.toFixed(2)} ; atténué(--ink-55)/tuile = ${mutedRatio.toFixed(2)}`)
  expect(titleRatio).toBeGreaterThanOrEqual(4.5)
  expect(mutedRatio).toBeGreaterThanOrEqual(4.5)
})

// « À propos » (02/08) : le texte de licence tierce (ThirdPartyLicensesView.vue,
// .pkg__text) utilise --ink-55 sur --bg, une paire NEUVE — ailleurs dans l'app --ink-55 n'est
// mesuré que sur --tile (test ci-dessus), un fond plus clair en sombre. Pas la même paire,
// donc pas déjà couverte.
test('sombre — texte de licence tierce (--ink-55 sur --bg) atteint AA', async ({ page }) => {
  await forceDark(page)
  await page.goto('/about/licenses')
  await assertReallyDark(page)
  await expect(page.locator('.pkg').first()).toBeVisible()
  // <details> replié par défaut : .pkg__text n'est réellement RENDU qu'après ouverture.
  await page.locator('.pkg summary').first().click()
  await expect(page.locator('.pkg__text').first()).toBeVisible()

  const pairs = await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor
    const text = getComputedStyle(document.querySelector('.pkg__text')).color
    return { bg, text }
  })
  const bg = parse(pairs.bg)
  const ratio = contrast(composite(parse(pairs.text), bg), bg)
  console.log(`[contrast] licences tierces — texte(--ink-55)/fond = ${ratio.toFixed(2)}`)
  expect(ratio).toBeGreaterThanOrEqual(4.5)
})

test('sombre — texte sur bouton primaire (--on-accent) atteint AA', async ({ page }) => {
  await forceDark(page)
  await page.goto('/settings')
  await assertReallyDark(page)
  const btn = page.locator('.btn--primary').first()
  await expect(btn).toBeVisible()
  // T2 (31/08) : le fond du bouton est un DÉGRADÉ (--brand-grad) dont la couleur dépend de
  // la teinte par défaut dynamique (rose 320 en sombre) — plus le littéral ambre figé
  // d'avant T2. On mesure le PIRE arrêt du dégradé réellement rendu.
  const { fg, bgImg } = await btn.evaluate((el) => ({
    fg: getComputedStyle(el).color,
    bgImg: getComputedStyle(el).backgroundImage,
  }))
  const stops = bgImg.match(/rgba?\([^)]*\)/g).map((s) => parse(s))
  expect(stops.length).toBeGreaterThanOrEqual(1)
  let worst = Infinity
  for (const bgRgb of stops) {
    worst = Math.min(worst, contrast(composite(parse(fg), bgRgb), bgRgb))
  }
  console.log(`[contrast] bouton primaire (--on-accent)/(--brand, pire arrêt) = ${worst.toFixed(2)}`)
  expect(worst).toBeGreaterThanOrEqual(4.5)
})

// Punch-list #1 : lien d'action de la snackbar (.snack__action, --mustard sur le fond de
// .snack qui est var(--ink) — un fond INVERSÉ par rapport au corps de page : clair en
// sombre). Déclenché par une VRAIE snackbar (suppression d'un compteur indépendant, qui
// affiche une action « Annuler »), pas seulement lu sur :root.
// Corrigé (fix pass) : couleur fixe pour .snack__action en sombre (indépendante
// de --mustard, qui reste correct sur ses 5 autres sites à fond sombre).
test('sombre — lien d\'action de la snackbar (--mustard sur .snack) mesuré', async ({ page }) => {
  await forceDark(page)
  await page.goto('/counters')
  await assertReallyDark(page)
  await expect(page.getByText('Compteur').first()).toBeVisible()

  await page.locator('.addcard .input').first().fill('Test contraste')
  // (07/09/2026) Le « + » typographique du CTA est devenu une icône AppIcon décorative :
  // le nom accessible du bouton est désormais le libellé seul (home.toolCounter = « Compteur »).
  await page.getByRole('button', { name: 'Compteur' }).click()
  await expect(page.locator('.ccard__del').first()).toBeVisible()
  await page.locator('.ccard__del').first().click()

  const action = page.locator('.snack__action')
  await expect(action).toBeVisible()
  const { fg, bg } = await action.evaluate((el) => {
    const s = getComputedStyle(el)
    // Le bouton lui-même est transparent : le fond réel vient de .snack (parent).
    const snackBg = getComputedStyle(el.closest('.snack')).backgroundColor
    return { fg: s.color, bg: snackBg }
  })
  const bgRgb = parse(bg)
  const ratio = contrast(composite(parse(fg), bgRgb), bgRgb)
  console.log(`[contrast] snackbar action (couleur fixe sombre)/(--ink, fond inversé) = ${ratio.toFixed(2)} — méthode : élément vivant déclenché`)
  expect(ratio).toBeGreaterThanOrEqual(4.5)
})

// Punch-list #2 : bordure de la pastille de légende du diagramme (.chart__sw, --ink-40 sur
// fond FIXE blanc #fff — volontairement invariant au thème, cf. commentaire ReaderChart.vue).
// Seuil « élément d'interface non textuel » (WCAG 1.4.11) : 3:1.
// Corrigé (fix pass) : border-color fixe pour .chart__sw en sombre (même
// traitement que le point intérieur .chart__sw--dot::after, déjà fixe pour la même
// raison) — --ink-40 reste inchangé et correct sur son autre site (.rl-abbr).
test('sombre — bordure de la pastille de légende du diagramme (--ink-40/#fff) mesurée', async ({ page }) => {
  await forceDark(page)
  await openDemoReaderWithChart(page)
  await assertReallyDark(page)

  const sw = page.locator('.chart__sw').first()
  await expect(sw).toBeVisible()
  const { borderColor, bg } = await sw.evaluate((el) => {
    const s = getComputedStyle(el)
    return { borderColor: s.borderTopColor, bg: s.backgroundColor }
  })
  const bgRgb = parse(bg)
  const ratio = contrast(composite(parse(borderColor), bgRgb), bgRgb)
  console.log(`[contrast] pastille diagramme bordure (couleur fixe sombre)/fond fixe(${bg}) = ${ratio.toFixed(2)} — méthode : élément vivant déclenché`)
  expect(ratio).toBeGreaterThanOrEqual(3)
})

// Régressions device sombre (18/07) — écran LECTEUR, angle mort du gate initial (il ne
// mesurait que réglages/counters/diagramme). Deux bugs remontés en retour terrain :
//  (1) .chrono-fab--idle : un override sombre de .chrono-fab (spécificité 0,2,0 > 0,1,0)
//      écrasait son fond ambre (--brand-grad) vers la surface sombre en LAISSANT le texte
//      espresso (--on-accent) → texte invisible. Corrigé par `:not(.chrono-fab--idle)`,
//      puis l'override sombre a disparu tout court (09/09 : l'état en marche suit
//      rgba(var(--brand-rgb), …) dans les deux thèmes — ChronoPill.vue).
//  (2) .rstep--done : `opacity: 0.58` en sombre dissout la tuile (#2a211a) dans le fond
//      quasi-noir (#161210) → carte perdue + texte crème boueux. Corrigé (dark-only) :
//      opacity 1 + carte aplatie + texte atténué lisible --ink-55.
test('sombre — bouton chrono idle lisible + rang fait lisible/distinct (lecteur)', async ({ page }) => {
  await forceDark(page)
  await openDemoReaderWithChart(page)
  await assertReallyDark(page)

  // (1) Chrono à l'arrêt : fond ambre (PAS la surface sombre) + texte espresso lisible.
  const chrono = page.locator('.chrono-fab--idle')
  await expect(chrono).toBeVisible()
  const idle = await chrono.evaluate((el) => {
    const lbl = el.querySelector('.chrono-fab__lbl') || el
    return { fg: getComputedStyle(lbl).color, bgImg: getComputedStyle(el).backgroundImage }
  })
  // Le texte espresso doit atteindre AA sur le PIRE stop du dégradé ambre (garde aussi
  // contre la régression « fond redevenu surface sombre » : espresso/surface ≈ 1:1 → échec).
  const stops = idle.bgImg.match(/rgba?\([^)]*\)/g).map((s) => parse(s))
  const fgRgb = parse(idle.fg)
  const worst = Math.min(...stops.map((bg) => contrast(composite(fgRgb, bg), bg)))
  console.log(`[contrast] chrono idle texte espresso/(fond ambre, pire stop) = ${worst.toFixed(2)}`)
  expect(worst).toBeGreaterThanOrEqual(4.5)

  // (2) Rang FAIT : cocher le 1er rang cochable → carte NON dissoute (opacity 1) + texte
  // atténué mais lisible (AA) sur sa tuile.
  const doneRow = page.locator('.rstep', { has: page.locator('.rcheck') }).first()
  await doneRow.locator('.rcheck').click()
  await expect(doneRow).toHaveClass(/rstep--done/)
  const done = await doneRow.evaluate((el) => {
    const s = getComputedStyle(el)
    return { opacity: s.opacity, fg: s.color, bg: s.backgroundColor }
  })
  expect(done.opacity).toBe('1') // en sombre : plus d'atténuation par opacité (carte préservée)
  const dbgRgb = parse(done.bg)
  const dRatio = contrast(composite(parse(done.fg), dbgRgb), dbgRgb)
  console.log(`[contrast] rang fait texte(--ink-55)/tuile = ${dRatio.toFixed(2)}`)
  expect(dRatio).toBeGreaterThanOrEqual(4.5)
})

// Lecteur à deux volets : les 2 éléments qui vivent sur le fond de la PAGE (pas dans le
// volet, lui déjà sombre dans les deux thèmes) — le renvoi .rchart-ref (grille déjà
// épinglée) et le bouton .rchart-pin (« Afficher à droite » sur une autre grille). Ils
// réutilisent les tokens --ink/--ink-55/--surface déjà mesurés ci-dessus (réglages), mais
// on garde une mesure dédiée pour attraper toute régression future qui leur serait propre.
//
// Bonnet Torsade (patron démo depuis le 30/07) n'a qu'UNE seule grille, contrairement à
// l'ancien patron démo (Twist Loop Top, deux grilles) qui permettait de mesurer .rchart-ref
// (carte épinglée) et .rchart-pin (une AUTRE carte, non épinglée) SIMULTANÉMENT. Avec une
// seule grille, on mesure les deux états en SÉQUENCE sur la MÊME carte : .rchart-ref
// pendant qu'elle est épinglée, puis on la décroche (comme le fait déjà
// tests/e2e/reader-split.spec.js « décrocher élargit la colonne… ») pour faire apparaître
// .rchart-pin sur cette même carte redevenue « dans le texte ». Rien n'est perdu : les deux
// éléments sont toujours mesurés, seulement pas au même instant.
test('sombre — renvoi diagramme + bouton « Afficher à droite » lisibles (lecteur, volets)', async ({ page }) => {
  await forceDark(page)
  await page.setViewportSize({ width: 1024, height: 768 })
  await openDemoReaderWithChart(page)
  await assertReallyDark(page)

  const ref = page.locator('.rchart-ref')
  await expect(ref).toBeVisible()
  const refPair = await ref.evaluate((el) => {
    const bg = getComputedStyle(el).backgroundColor
    const title = getComputedStyle(el.querySelector('.rchart-ref__t')).color
    const sub = getComputedStyle(el.querySelector('.rchart-ref__s')).color
    return { bg, title, sub }
  })
  const refBg = parse(refPair.bg)
  const refTitleRatio = contrast(composite(parse(refPair.title), refBg), refBg)
  const refSubRatio = contrast(composite(parse(refPair.sub), refBg), refBg)
  console.log(`[contrast] renvoi diagramme titre(--ink)/fond = ${refTitleRatio.toFixed(2)} ; sous-titre(--ink-55)/fond = ${refSubRatio.toFixed(2)}`)
  expect(refTitleRatio).toBeGreaterThanOrEqual(4.5)
  expect(refSubRatio).toBeGreaterThanOrEqual(4.5)

  // Décroche l'unique grille : .rchart-pin (« Afficher à droite ») apparaît sur cette même
  // carte, redevenue « dans le texte ».
  await page.locator('.rchart-unpin').click()
  const pin = page.locator('.rchart-pin').first()
  await expect(pin).toBeVisible()
  const pinPair = await pin.evaluate((el) => {
    const s = getComputedStyle(el)
    return { fg: s.color, bg: s.backgroundColor }
  })
  const pinBg = parse(pinPair.bg)
  const pinRatio = contrast(composite(parse(pinPair.fg), pinBg), pinBg)
  console.log(`[contrast] bouton Afficher à droite texte(--ink)/fond(--surface) = ${pinRatio.toFixed(2)}`)
  expect(pinRatio).toBeGreaterThanOrEqual(4.5)
})

// Même vérification en CLAIR : ces 2 éléments vivent sur le fond de la page dans les DEUX
// thèmes (contrairement au volet, toujours sombre). Bascule explicite (miroir de forceDark)
// plutôt que de compter sur le thème 'system' par défaut, dont le rendu dépend de
// l'environnement d'exécution — non déterministe.
async function forceLight(page) {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Clair', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light')
}

// Garde-fou anti-théâtre (miroir d'assertReallyDark) : le clic « Clair » persiste avant la
// navigation, mais le garde de route réconcilie le thème depuis Dexie à CHAQUE navigation
// (cf. commentaire de forceDark plus haut) — sans cette vérification post-navigation, un
// échec silencieux du mécanisme de bascule ferait mesurer le sombre en silence, et les deux
// thèmes passant le même seuil AA (4,5), le test ne s'en apercevrait jamais. Fond attendu au
// défaut dynamique T2 : bleu 230 → rgb(243, 246, 254) (#f3f6fe).
async function assertReallyLight(page) {
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(bg).toBe('rgb(243, 246, 254)')
}

test('clair — renvoi diagramme + bouton « Afficher à droite » lisibles (lecteur, volets)', async ({ page }) => {
  await forceLight(page)
  await page.setViewportSize({ width: 1024, height: 768 })
  await openDemoReaderWithChart(page)
  await assertReallyLight(page)

  const ref = page.locator('.rchart-ref')
  await expect(ref).toBeVisible()
  const refPair = await ref.evaluate((el) => {
    const bg = getComputedStyle(el).backgroundColor
    const title = getComputedStyle(el.querySelector('.rchart-ref__t')).color
    const sub = getComputedStyle(el.querySelector('.rchart-ref__s')).color
    return { bg, title, sub }
  })
  const refBg = parse(refPair.bg)
  const refTitleRatio = contrast(composite(parse(refPair.title), refBg), refBg)
  const refSubRatio = contrast(composite(parse(refPair.sub), refBg), refBg)
  console.log(`[contrast clair] renvoi diagramme titre(--ink)/fond = ${refTitleRatio.toFixed(2)} ; sous-titre(--ink-55)/fond = ${refSubRatio.toFixed(2)}`)
  expect(refTitleRatio).toBeGreaterThanOrEqual(4.5)
  expect(refSubRatio).toBeGreaterThanOrEqual(4.5)

  // Décroche l'unique grille (cf. commentaire de tête de la variante SOMBRE ci-dessus) :
  // .rchart-pin apparaît sur cette même carte.
  await page.locator('.rchart-unpin').click()
  const pin = page.locator('.rchart-pin').first()
  await expect(pin).toBeVisible()
  const pinPair = await pin.evaluate((el) => {
    const s = getComputedStyle(el)
    return { fg: s.color, bg: s.backgroundColor }
  })
  const pinBg = parse(pinPair.bg)
  const pinRatio = contrast(composite(parse(pinPair.fg), pinBg), pinBg)
  console.log(`[contrast clair] bouton Afficher à droite texte(--ink)/fond(--surface) = ${pinRatio.toFixed(2)}`)
  expect(pinRatio).toBeGreaterThanOrEqual(4.5)
})

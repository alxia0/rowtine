import { test, expect } from '@playwright/test'
import { completeOnboarding, seedHeatmapSessions, readSetting } from './helpers'

test('onboarding — choisir Sombre applique le thème en direct', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bienvenue sur Rowtine' })).toBeVisible()
  await page.getByRole('button', { name: 'Sombre', exact: true }).click()
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  expect(theme).toBe('dark')
})

test('réglages — bascule Sombre puis Clair change le rendu', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sombre', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark')
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await page.getByRole('button', { name: 'Clair', exact: true }).click()
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(darkBg).not.toBe(lightBg)
})

test('choix Clair explicite gagne contre un OS en nuit', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'dark' })
  const page = await ctx.newPage()
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Clair', exact: true }).click()
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  // Défaut dynamique T2 (31/08) : bleu 230 en clair → bgHex(230, 'light') = #f3f6fe.
  expect(bg).toBe('rgb(243, 246, 254)')
  await ctx.close()
})

// Liste EXHAUSTIVE des custom properties déclarées dans les DEUX blocs sombres de
// src/styles/tokens.css (@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }
// et :root[data-theme='dark']) — les deux blocs doivent rester byte-identiques token par
// token. Si un futur edit ne touche qu'un seul bloc (ex. --brand seul), ce test doit le voir.
const DARK_TOKENS = [
  '--brand', '--brand-deep', '--sage', '--mustard', '--slate',
  '--ink', '--ink-70', '--ink-55', '--ink-40', '--ink-25',
  '--line', '--line-soft', '--surface', '--surface-lin', '--bg', '--page',
  '--danger', '--warning',
  '--e-1', '--e-2', '--e-3',
  '--clay', '--clay-sm', '--clay-press',
  '--tile', '--sage-tile-bg', '--sage-tile-line', '--sage-deep',
  '--brand-grad', '--on-accent',
]

test('non-dérive : Système+OS-nuit rend exactement comme Sombre explicite', async ({ browser }) => {
  async function darkTokens(setup) {
    const ctx = await browser.newContext({ colorScheme: 'dark' })
    const page = await ctx.newPage()
    await completeOnboarding(page, { firstName: 'Alex' })
    await setup(page)
    const values = await page.evaluate((names) => {
      const cs = getComputedStyle(document.documentElement)
      const out = {}
      for (const name of names) out[name] = cs.getPropertyValue(name).trim()
      return out
    }, DARK_TOKENS)
    await ctx.close()
    return values
  }
  const viaSystem = await darkTokens(async (page) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Système', exact: true }).click()
  })
  const viaExplicit = await darkTokens(async (page) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Sombre', exact: true }).click()
  })
  const keyCount = Object.keys(viaSystem).length
  console.log(`[non-dérive] ${keyCount} tokens sombres comparés entre Système(OS-nuit) et Sombre explicite`)
  // Preuve que le test lit bien un large vecteur de tokens (pas juste --bg) : sous peine
  // de régresser silencieusement vers un test à un seul token si la liste est vidée.
  expect(keyCount).toBeGreaterThanOrEqual(25)
  // Ancrage : les deux rendus doivent être RÉELLEMENT sombres (le --bg du défaut sombre,
  // valeur verrouillée par l'assertion ci-dessous — inutile de réciter le hex ici, il a
  // déjà dérivé une fois), pas juste égaux
  // entre eux — sinon un double échec silencieux (les deux en clair, p. ex. émulation
  // colorScheme qui ne prend pas) ferait passer le test à tort.
  // --bg est désormais écrit en style inline par applyAccent() — même couleur,
  // forme de chaîne différente (rgb(...) au lieu du littéral hex de tokens.css).
  // Défaut dynamique T2 : rose 320 en sombre → rgb(21, 18, 21) (#151215).
  expect(viaSystem['--bg']).toBe('rgb(21, 18, 21)')
  expect(viaExplicit['--bg']).toBe('rgb(21, 18, 21)')
  // Le cœur du test : les DEUX blocs CSS sombres doivent être identiques, token par
  // token (pas seulement --bg) — une dérive sur --brand/--ink/--surface/etc. doit casser ici.
  expect(viaSystem).toEqual(viaExplicit)
})

test('les huit couleurs de l’échelle de la grille sont celles de la spec, dans les deux modes', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  // Quatre séances, une par niveau (< 30 min, 30 min–1 h, 1–2 h, ≥ 2 h) — cf. seedHeatmapSessions.
  await seedHeatmapSessions(page)
  await page.goto('/stats')

  // Sélecteur scopé à `.hm__cols` : la légende (`.hm__legend .hm__swatch`) porte les MÊMES
  // classes `hm__cell--lN` (0 à 4) que les cases de la grille et se rend TOUJOURS, même sans
  // aucune séance — un `.hm__cell--lN` non scopé matcherait la légende et le test resterait
  // vert même si le seed de séances ne servait à rien (mutation vérifiée ci-dessous).
  const lire = () =>
    page.evaluate(() =>
      [1, 2, 3, 4].map(
        (n) => getComputedStyle(document.querySelector(`.hm__cols .hm__cell--l${n}`)).backgroundColor,
      ),
    )

  // StatsView ne charge les séances qu'APRÈS son montage (onMounted → sessionsStore.allSessions(),
  // une lecture IndexedDB asynchrone) : lire les couleurs juste après `goto` mesurerait parfois
  // une grille encore vide (course gagnée par le test). On attend la case de niveau 4, la
  // dernière à apparaître dans le DOM (colonne la plus à droite) — scopée à la grille, pas à
  // la légende, pour la même raison que `lire()`.
  await expect(page.locator('.hm__cols .hm__cell--l4').first()).toBeVisible()

  // Clair (thème par défaut de l'onboarding).
  // Défaut dynamique T2 : generateHeatColors(230) en clair.
  expect(await lire()).toEqual(['rgb(126, 181, 224)', 'rgb(70, 151, 196)', 'rgb(2, 129, 173)', 'rgb(0, 105, 147)'])

  // Sombre. `saveTheme()` met à jour `data-theme` de façon SYNCHRONE mais persiste en
  // IndexedDB de façon ASYNCHRONE : un `goto('/stats')` lancé entre les deux gagne la
  // course et /stats se recharge avec le réglage encore CLAIR (mesuré : ~30 % des passages
  // en lançant ce test seul, en boucle). On attend la persistance RÉELLE, pas seulement
  // l'attribut du DOM.
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sombre', exact: true }).click()
  await expect.poll(() => readSetting(page, 'theme')).toBe('dark')
  await page.goto('/stats')
  await expect(page.locator('.hm__cols .hm__cell--l4').first()).toBeVisible()
  // Défaut dynamique T2 : generateHeatColors(320) en sombre.
  expect(await lire()).toEqual(['rgb(106, 65, 82)', 'rgb(156, 92, 116)', 'rgb(206, 121, 153)', 'rgb(250, 148, 192)'])
})

test('la grille reste ancrée à droite après un changement de fenêtre', async ({ page }) => {
  // Le Trimestre (fenêtre par défaut, 13 semaines) n'est PAS scrollable : rien à vérifier
  // à l'ouverture par ce test (couvert par le test de mutation unitaire du composant). Le
  // Semestre (26 semaines), lui, l'est — et c'est le SEUL moyen d'atteindre le chemin de
  // code qui réancre la bande sans démonter le composant (le sélecteur de fenêtre ne fait
  // que recalculer `grid`, sans `:key` sur `<StatsHeatmap>`).
  // La grille (comme le reste de l'écran) est masquée tant qu'aucune activité n'existe
  // (`v-if="hasAnyActivity"` dans StatsView.vue) — on en sème une pour l'atteindre.
  await completeOnboarding(page, { firstName: 'Alex' })
  await seedHeatmapSessions(page)
  await page.goto('/stats')
  await page.getByRole('button', { name: 'Semestre', exact: true }).click()
  await expect(page.locator('.hm__scroll--scrolls')).toBeVisible()

  const scrollState = () =>
    page.evaluate(() => {
      const el = document.querySelector('.hm__scroll')
      return { left: el.scrollLeft, max: el.scrollWidth - el.clientWidth }
    })
  // `expect.poll` : le réancrage suit un `nextTick`, pas instantané au clic.
  await expect.poll(async () => {
    const { left, max } = await scrollState()
    return max > 0 && left >= max - 1
  }).toBe(true)
})

// Justifie le choix v-if (plutôt que v-show) des deux panneaux d'onglets, tâche D du 11/08
// (StatsView.vue) — dans un VRAI navigateur, pas le stub jsdom du test unitaire équivalent
// (StatsView.spec.js) qui MODÉLISE ce comportement plutôt que de le mesurer. Le chemin exact :
// la fenêtre change PENDANT que l'onglet « Rythme » est affiché (donc le panneau « Calendrier »,
// et StatsHeatmap avec lui, est DÉMONTÉ — son `watch` sur `grid` ne peut pas réagir), puis on
// revient sur « Calendrier ». Seul un remontage frais (`onMounted`) peut ancrer la bande à droite.
test('un changement de fenêtre pendant l’onglet « Rythme », puis un retour sur « Calendrier », ancre quand même la grille à droite', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await seedHeatmapSessions(page)
  await page.goto('/stats')
  await page.getByRole('tab', { name: 'Rythme' }).click()
  await page.getByRole('button', { name: 'Semestre', exact: true }).click()
  await page.getByRole('tab', { name: 'Calendrier' }).click()
  await expect(page.locator('.hm__scroll--scrolls')).toBeVisible()

  const scrollState = () =>
    page.evaluate(() => {
      const el = document.querySelector('.hm__scroll')
      return { left: el.scrollLeft, max: el.scrollWidth - el.clientWidth }
    })
  await expect.poll(async () => {
    const { left, max } = await scrollState()
    return max > 0 && left >= max - 1
  }).toBe(true)
})

test('réglages — teinte d\'accent personnalisée persiste après rechargement', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/settings')

  const hueInput = page.locator('.accent-hue')
  await hueInput.fill('190')
  await hueInput.dispatchEvent('input')

  await expect.poll(() => readSetting(page, 'accentHue')).toBe(190)
  const brandBefore = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand'))

  await page.reload()

  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand')))
    .toBe(brandBefore)
})

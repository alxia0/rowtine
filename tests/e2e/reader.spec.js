// Parcours — lecteur de patron.
//  - Bibliothèque « Lire le patron » = APERÇU EN LECTURE SEULE.
//  - Projet « Suivre le patron » (onglet Sections) = SUIVI INTERACTIF (taille, progression, diagramme, chrono).
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { completeOnboarding } from './helpers'

async function openBonnetPattern(page) {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/library')
  await page.getByRole('button', { name: 'Bonnet Torsade' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+/)
}

async function openProjectReader(page) {
  await openBonnetPattern(page)
  await page.getByRole('button', { name: /Créer un projet/ }).click()
  await page.locator('#name').fill('Test Bonnet')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  // L'onglet Sections est premier → le bouton « Suivre le patron » est visible.
  await page.getByRole('button', { name: /Suivre le patron/ }).click()
  await expect(page).toHaveURL(/\/project\/\d+\/read/)
}

test('bibliothèque : l’aperçu Prévisualiser du patron est en lecture seule', async ({ page }) => {
  await openBonnetPattern(page)
  // La fiche est épurée (plus d'aperçu inline) ; l'aperçu se consulte
  // désormais via le bouton « Prévisualiser le patron », qui mène au Lecteur en lecture
  // seule (route pattern-read). Les sections s'affichent en continu et le diagramme de la
  // section « Corps et torsade » est rendu.
  await page.getByRole('button', { name: /Prévisualiser le patron/ }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/read$/)
  await expect(page.locator('.rsec').first()).toBeVisible()
  await expect(page.locator('.rstep__chart').first()).toBeVisible()
  // Preuve POSITIVE du mode lecture seule : la grille du Bonnet Torsade a 24 rangs (rows>0),
  // donc en mode interactif elle afficherait la barre de navigation de rang (.chart__rowbar,
  // rendue seulement si !readOnly && hasRows). Son ABSENCE prouve que l'aperçu est bien
  // read-only.
  await expect(page.locator('.chart__rowbar')).toHaveCount(0)
})

test('projet : filtre de taille dans le suivi', async ({ page }) => {
  await openProjectReader(page)
  // Bonnet Torsade a 3 tailles (S, M, L) — l'ancien patron démo (Twist Loop Top) en avait 6.
  await expect(page.locator('.szpill')).toHaveCount(3)
  await expect(page.locator('.rl-num--all').first()).toBeVisible()
  await page.locator('.szpill', { hasText: /^M/ }).click()
  await expect(page.locator('.rl-num--picked').first()).toBeVisible()
  await expect(page.locator('.rl-num--all')).toHaveCount(0)
})

test('projet : cocher fait progresser', async ({ page }) => {
  await openProjectReader(page)
  await expect(page.locator('.rhdr__pct')).toHaveText('0 %')
  await page.locator('.rcheck').first().click()
  await expect(page.locator('.rstep').first()).toHaveClass(/rstep--done/)
  await expect(page.locator('.rhdr__pct')).not.toHaveText('0 %')
})

test('projet : l’étape en cours a un fond teinté, distinct des autres étapes', async ({ page }) => {
  await openProjectReader(page)
  // Il FAUT au moins une étape cochée : sinon l'étape en cours est la PREMIÈRE du DOM,
  // et le « témoin » (.rstep ordinaire) risquerait d'être l'étape en cours elle-même.
  await page.locator('.rcheck').first().click()
  await expect(page.locator('.rstep').first()).toHaveClass(/rstep--done/)

  const cur = page.locator('.rstep--cur')
  await expect(cur).toHaveCount(1) // l'étape en cours existe bien

  // Témoin explicite : une étape ni faite, ni en cours (jamais .first(), qui est l'étape faite).
  const plain = page.locator('.rstep:not(.rstep--cur):not(.rstep--done)').first()
  await expect(plain).toBeVisible()

  const bg = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor)
  const curBg = await bg(cur)
  const plainBg = await bg(plain)

  // Le fond de l'étape en cours doit DIFFÉRER de celui des étapes ordinaires…
  expect(curBg).not.toBe(plainBg)
  // …et rester un vrai fond opaque (pas transparent).
  expect(curBg).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
  // …sans faire disparaître le contour de l'accent, qui reste (fond EN PLUS, pas À LA PLACE).
  // --brand est désormais écrit en style inline par applyAccent() ; la valeur claire par
  // DÉFAUT est la teinte 230 (bleu) depuis le lot « thème par défaut » du 31/08
  // (src/styles/tokens.css --brand-rgb) — l'attente suit, la teinte choisie resterait respectée.
  await expect(cur).toHaveCSS('border-color', 'rgb(14, 115, 151)') // --brand (hue 230 par défaut)
})

test('projet : diagramme inline + chrono discret', async ({ page }) => {
  await openProjectReader(page)
  // chrono présent
  await expect(page.locator('.chrono-fab')).toBeVisible()
  // la grille est rendue inline (plus d'overlay) ; le FAB défile jusqu'à elle
  await page.locator('.fab--chart').click()
  const val = page.locator('.chart__val').first()
  await expect(val).toHaveText('1 / 24')
  await page.locator('.chart__next').first().click()
  await expect(val).toHaveText('2 / 24')
})

test('projet : la progression persiste après rechargement', async ({ page }) => {
  await openProjectReader(page)
  await page.locator('.szpill', { hasText: /^M/ }).click()
  await page.locator('.rcheck').first().click()
  await expect(page.locator('.rhdr__pct')).not.toHaveText('0 %')
  await page.waitForTimeout(300) // laisse l'écriture IndexedDB se vider avant le rechargement
  await page.reload()
  await expect(page.locator('.szpill', { hasText: /^M/ })).toHaveClass(/szpill--on/)
  await expect(page.locator('.rstep').first()).toHaveClass(/rstep--done/)
})

test('projet : le chrono lancé alimente une session', async ({ page }) => {
  await openProjectReader(page)
  // L'id du projet, capturé avant tout le parcours : impossible d'y revenir par la tuile
  // « Reprendre » de l'accueil — elle ne classe que les projets EN COURS, et celui-ci
  // reste « en attente » tant qu'aucun geste de progression (rang coché, compteur…)
  // ne l'a armé ; la tuile ouvrirait un projet de démonstration. D'où l'URL directe.
  const projectId = page.url().match(/\/project\/(\d+)/)[1]
  await page.locator('.chrono-fab__body').click() // démarre le chrono
  await page.waitForTimeout(1100)
  // retour à la fiche projet : même projet, la séance poursuit (rien n'est enregistré) ;
  // puis sortie de la bulle : le garde enregistre et le signale. Le projet a été créé
  // DEPUIS la fiche patron : le retour de la fiche projet y remonte l'historique — c'est
  // déjà hors bulle, la séance s'écrit donc à ce moment-là (le snackbar, lui, est global).
  await page.locator('.rhdr__back').click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  await page.locator('.phdr__back').click()
  await expect(page).toHaveURL(/\/pattern\/\d+$/)
  await expect(page.getByText(/Temps enregistré/)).toBeVisible()
  // La séance est bien au journal du projet : retour direct à sa fiche, onglet Sessions.
  await page.goto(`/project/${projectId}`)
  await page.getByRole('tab', { name: /Sessions/ }).click()
  await expect(page.locator('.ses-row')).toHaveCount(1)
})

test('rectifier le temps d’une session', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.getByRole('button', { name: /Créer un projet/ }).click()
  await page.locator('#name').fill('Sess test')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  await page.getByRole('tab', { name: /Sessions/ }).click()
  await page.getByRole('button', { name: /Ajouter une session/ }).click()
  await page.locator('input[placeholder="30"]').fill('20')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.locator('.ses-row')).toHaveCount(1)
  await page.locator('.ses-row__edit').click()
  await page.locator('.addform input[inputmode="numeric"]').first().fill('45')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Session mise à jour.')).toBeVisible()
  await expect(page.locator('.ses-row__meta')).toContainText('45')
})

test('lecteur (suivi projet) — sans violation a11y bloquante', async ({ page }) => {
  await openProjectReader(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const blocking = results.violations
    .filter((v) => ['serious', 'critical'].includes(v.impact))
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))
  expect(blocking).toEqual([])
})

test('projet : le bandeau se compacte au défilement, sans perdre le surtitre', async ({ page }) => {
  await openProjectReader(page)
  const header = page.locator('.rhdr')
  // `page.evaluate` ne fait AUCUNE attente automatique (contrairement aux locators) : sans
  // ce repère, on risque de mesurer la page pendant qu'elle affiche encore le squelette de
  // chargement (SkeletonScreen), avant que Vue n'ait rendu les étapes → scrollHeight ≈ 0,
  // faussement « rien à défiler ».
  await page.locator('.rstep').first().waitFor()

  // Assez de contenu pour défiler réellement : sinon on mesurerait l'état non défilé
  // et le test serait aveugle (piège déjà rencontré sur ce chantier).
  const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
  expect(scrollable).toBeGreaterThan(400)

  const topHeight = await header.evaluate((el) => el.getBoundingClientRect().height)
  await expect(header).not.toHaveClass(/rhdr--compact/)

  await page.mouse.wheel(0, 800)
  await page.waitForFunction(() => window.scrollY > 4)
  await expect(header).toHaveClass(/rhdr--compact/)
  // Laisse la transition CSS (padding/police) se terminer avant de mesurer,
  // sinon on mesure une valeur intermédiaire et le test devient instable.
  await page.waitForTimeout(300)

  const scrolledHeight = await header.evaluate((el) => el.getBoundingClientRect().height)
  expect(scrolledHeight).toBeLessThan(topHeight)

  // Le surtitre (nom du projet / « Aperçu du patron ») n'est pas SUPPRIMÉ, seulement
  // réduit : masquer ≠ perdre. On vérifie l'état réel (opacité + hauteur calculées),
  // pas juste `toBeVisible()` qui ignore l'opacité (piège déjà rencontré sur ce chantier).
  const eyebrowState = await page.locator('.rhdr__eyebrow').evaluate((el) => {
    const cs = getComputedStyle(el)
    return { opacity: Number(cs.opacity), height: el.getBoundingClientRect().height }
  })
  expect(eyebrowState.opacity).toBeLessThan(1)

  // Remonter en haut : le bandeau retrouve sa hauteur et son opacité d'origine (rien perdu).
  await page.mouse.wheel(0, -800)
  await page.waitForFunction(() => window.scrollY <= 4)
  await expect(header).not.toHaveClass(/rhdr--compact/)
  await page.waitForTimeout(300)

  const restoredHeight = await header.evaluate((el) => el.getBoundingClientRect().height)
  expect(restoredHeight).toBe(topHeight)
  const restoredEyebrow = await page.locator('.rhdr__eyebrow').evaluate((el) => Number(getComputedStyle(el).opacity))
  expect(restoredEyebrow).toBe(1)
})

test('projet en cours : le lecteur s’ouvre déjà défilé → le bandeau s’ouvre déjà compact', async ({ page }) => {
  await openProjectReader(page)
  // Un projet ENTAMÉ : à la réouverture, le lecteur saute tout seul à l'étape en cours
  // (ReaderView `resume('auto')`). L'écran s'ouvre donc DÉJÀ défilé — le bandeau doit
  // s'ouvrir déjà compact, sans attendre un geste de défilement.
  await page.locator('.rcheck').first().click()
  await expect(page.locator('.rstep').first()).toHaveClass(/rstep--done/)
  await page.waitForTimeout(300) // laisse l'écriture IndexedDB se vider avant le rechargement

  await page.reload()
  await page.locator('.rstep').first().waitFor()
  // Le saut de reprise a bien eu lieu (sinon le reste ne prouverait rien).
  await page.waitForFunction(() => window.scrollY > 4)
  await expect(page.locator('.rhdr')).toHaveClass(/rhdr--compact/)
})

test('lecteur projet : le surtitre du bandeau n’est pas rogné à l’état plein (descendantes)', async ({ page }) => {
  // Task #6 : l'aperçu read-only de la fiche n'a plus de bandeau (rendu inline). Le bandeau
  // .rhdr — et sa règle anti-rognage du surtitre — vit toujours dans le Lecteur de PROJET,
  // surface bien réelle et joignable. On y ancre donc cette non-régression, sur un nom de
  // projet PORTANT des descendantes (les « p », « g », « j » des lettres qui plongent sous
  // la ligne de base) pour que la mesure soit honnête (un nom sans descendante ne prouverait
  // rien). « Bonnet Torsade » (le nouveau patron démo, task C4, 30/07) n'en porte plus aucune
  // — on écrase donc le pré-remplissage par un nom qui en porte, plutôt que de perdre la
  // mesure.
  await openBonnetPattern(page)
  await page.getByRole('button', { name: /Créer un projet/ }).click()
  // Le formulaire project-new PRÉ-REMPLIT le nom avec celui du patron (async, watch
  // patternSel → fillProjectFromPattern) : on vérifie D'ABORD ce pré-remplissage (preuve que
  // fillProjectFromPattern fonctionne toujours), PUIS on écrase avec un nom à descendantes
  // pour la suite de ce test précis.
  await expect(page.locator('#name')).toHaveValue('Bonnet Torsade')
  await page.locator('#name').fill('Gros pull jaune')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  await page.getByRole('button', { name: /Suivre le patron/ }).click()
  await expect(page).toHaveURL(/\/project\/\d+\/read/)
  await page.locator('.rstep').first().waitFor()

  const eyebrow = page.locator('.rhdr__eyebrow')
  // En mode projet, le surtitre du bandeau est le nom du projet (ici « Gros pull jaune »,
  // avec descendantes g/p/j — un nom sans descendante ne prouverait rien).
  await expect(eyebrow).toHaveText('Gros pull jaune')
  // Projet NEUF (non entamé) : pas de saut de reprise → l'écran s'ouvre à l'état plein, pas
  // .rhdr--compact — justement l'état où le surtitre est censé être PLEINEMENT lisible.
  await expect(page.locator('.rhdr')).not.toHaveClass(/rhdr--compact/)

  const overflow = await eyebrow.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }))
  // scrollHeight > clientHeight = le texte déborde de la boîte tronquée (overflow:hidden
  // + max-height) : les descendantes (g, p, q, y, j) seraient rognées à l'état plein.
  expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight)
})

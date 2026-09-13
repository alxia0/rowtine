// Audit d'accessibilité automatisé (axe-core) sur les écrans clés.
// On bloque sur les violations « serious » et « critical » (WCAG 2 A/AA) — les niveaux
// inférieurs (best-practice/moderate) sont tolérés pour ne pas figer le design.
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { completeOnboarding, openDemoReaderWithChart, attendreFinFondu } from './helpers'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function audit(page) {
  // Fondu d'entrée des écrans : axe mesure le rendu — un scan lancé pendant le
  // fondu d'opacité (150 ms) voie des contrastes fautifs qui n'existent pas à l'état posé.
  await attendreFinFondu(page)
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const blocking = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))
  // Message lisible en cas d'échec : id + impact + 1er sélecteur fautif.
  return blocking.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }))
}

test('onboarding — sans violation a11y bloquante', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bienvenue sur Rowtine' })).toBeVisible()
  expect(await audit(page)).toEqual([])
})

const ROUTES = [
  { path: '/', ready: /Bonjour/ },
  { path: '/library', ready: /Ajouter un patron/ },
  { path: '/stash', ready: /Ajouter une laine|Stock vide/ },
  // « Sauvegarder » a disparu de l'écran (écriture continue, plus de
  // bouton explicite) : on attend le bloc « Mes données », stable et propre à la vue.
  { path: '/settings', ready: /Mes données/ },
  { path: '/calculator', ready: /Mailles actuelles|Calculateur/ },
  { path: '/counters', ready: /Compteur/ },
  // À propos (02/08) : 3 nouveaux écrans.
  { path: '/about', ready: /Tes données/ },
  { path: '/about/privacy', ready: /Quelles données existent/ },
  { path: '/about/licenses', ready: /bibliothèques libres/ },
  // Guide in-app (02/08) : sections repliées par défaut (<details> fermés), donc
  // le sommaire (toujours visible) sert de repère « prêt » plutôt qu'un texte de contenu.
  { path: '/guide', ready: /Sommaire/ },
]

for (const route of ROUTES) {
  test(`écran ${route.path} — sans violation a11y bloquante`, async ({ page }) => {
    await completeOnboarding(page, { firstName: 'Alex' })
    await page.goto(route.path)
    await expect(page.getByText(route.ready).first()).toBeVisible()
    expect(await audit(page)).toEqual([])
  })
}

test('fiche projet — sans violation a11y bloquante', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.getByRole('button', { name: /Créer un projet/ }).click()
  await page.locator('#name').fill('Projet a11y')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  expect(await audit(page)).toEqual([])
})

test('suivi lecteur (ex-session de tricot) — sans violation a11y bloquante', async ({ page }) => {
  // Lot A : « Reprendre » va maintenant sur la fiche projet (/project/{id}),
  // plus sur l'ancienne SessionView (/section/). L'audit porte sur la vue reader.
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.locator('.resume').click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  await page.getByRole('button', { name: /Suivre le patron/ }).click()
  await expect(page).toHaveURL(/\/project\/\d+\/read/)
  expect(await audit(page)).toEqual([])
})

test('lecteur à deux volets : aucune violation bloquante', async ({ page }) => {
  // Le plus long test de la suite : onboarding par l'interface, création d'un projet,
  // ouverture du lecteur, décrochage du volet, PUIS deux passes axe-core complètes.
  // Mesuré 16 s lancé seul, ~40 s sous la charge de la suite entière (4 workers) — donc
  // au-delà du plafond par défaut de 30 s, d'où des échecs par intermittence qui ne
  // signalaient aucun défaut réel. Plafond relevé pour ce test uniquement : le rendre
  // déterministe vaut mieux qu'un rouge aléatoire qu'on apprend à ignorer. L'alléger
  // vraiment demanderait de semer l'état directement en base plutôt que de passer par
  // l'interface, comme le font d'autres fichiers e2e du projet — limite connue.
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1024, height: 768 })
  await completeOnboarding(page, { firstName: 'Alex' })
  await openDemoReaderWithChart(page)
  await expect(page.locator('.rpane')).toBeVisible()
  expect(await audit(page)).toEqual([])

  // Décroché (« Ramener dans le texte ») : le volet se ferme, le diagramme revient
  // dans le fil — même exigence d'absence de violation bloquante une fois refermé.
  await page.locator('.rchart-unpin').click()
  await expect(page.locator('.rpane')).toHaveCount(0)
  expect(await audit(page)).toEqual([])
})

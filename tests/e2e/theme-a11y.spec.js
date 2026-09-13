// Audit d'accessibilité automatisé (axe-core) sur les écrans clés, en thème SOMBRE.
// Calqué sur tests/e2e/a11y.spec.js (mêmes seuils : on bloque sur « serious »/« critical »).
//
// Mécanisme de bascule : PAS de `page.addInitScript(() => localStorage.setItem(...))` seul —
// vérifié empiriquement inopérant ici. Le garde de route (src/router/index.js) réconcilie le
// pré-paint avec Dexie à la 1re navigation : `applyTheme(settings.theme)` où `settings.theme`
// vaut 'system' par défaut (l'onboarding standard n'appuie sur aucun bouton de thème), ce qui
// EFFACE l'attribut data-theme et réécrit localStorage à 'system' avant même que l'écran
// « prêt » ne s'affiche. Un test qui se contenterait de cet addInitScript auditerait donc le
// thème CLAIR en silence — un test qui ne teste rien. À la place, on force le sombre comme le
// ferait une personne réelle : onboarding puis clic explicite sur « Sombre » dans Réglages, ce
// qui persiste `theme: 'dark'` dans Dexie ET localStorage — un `page.goto()` plein (rechargement
// complet, nécessaire pour changer d'écran ici) réconcilie alors systématiquement vers sombre.
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { completeOnboarding } from './helpers'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function audit(page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const blocking = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))
  return blocking.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }))
}

// Onboarding + bascule explicite vers Sombre (persistée Dexie + localStorage), puis attend
// que le rendu ait effectivement basculé avant de continuer.
async function forceDark(page) {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sombre', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark')
}

const ROUTES = [
  { path: '/', ready: /Bonjour/ },
  { path: '/library', ready: /Ajouter un patron/ },
  { path: '/settings', ready: /Apparence/ },
  { path: '/counters', ready: /Compteur/ },
]

for (const route of ROUTES) {
  test(`écran ${route.path} en SOMBRE — sans violation a11y bloquante`, async ({ page }) => {
    await forceDark(page)
    await page.goto(route.path)
    await expect(page.getByText(route.ready).first()).toBeVisible()
    // Garde-fou anti-théâtre : vérifie que l'écran est RÉELLEMENT rendu en sombre (#161210 =
    // rgb(22, 18, 16)) avant de lancer l'audit — sinon un échec silencieux du mécanisme de
    // bascule ferait passer ce test en auditant le clair par erreur, sans jamais le signaler.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    // Défaut dynamique T2 (31/08) : rose 320 en sombre → rgb(21, 18, 21) (#151215).
    expect(bg).toBe('rgb(21, 18, 21)')
    expect(await audit(page)).toEqual([])
  })
}

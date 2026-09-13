// tests/e2e/onboarding-langue.spec.js
import { test, expect } from '@playwright/test'

// La langue de l'appareil est PRÉ-SÉLECTIONNÉE à l'accueil (lot A, 30/07) : une
// utilisatrice allemande ne doit plus voir d'abord du français.
test.describe('langue pré-sélectionnée', () => {
  test.use({ locale: 'de-DE' })

  test("un appareil allemand ouvre l'accueil en allemand", async ({ page }) => {
    await page.goto('/')
    // Le sélecteur de langue de l'écran de bienvenue porte l'identifiant réel `onb-language`
    // (vérifié dans OnboardingView.vue : `<select id="onb-language" ...>`), pas `onb-lang`.
    await expect(page.locator('#onb-language')).toHaveValue('de')
    // Et l'écran lui-même est en allemand : l'attribut de langue du document suit.
    await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  })
})

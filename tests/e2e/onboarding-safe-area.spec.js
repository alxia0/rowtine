// tests/e2e/onboarding-safe-area.spec.js
import { test, expect } from '@playwright/test'

// Retour device du 09/08/2026 (Pixel 7, Android 16) : l'écran de bienvenue passait SOUS la
// barre d'état — le titre « Bienvenue » était à moitié masqué. Cause dans le code, pas dans
// la configuration Android : depuis targetSdk 35 la WebView s'affiche bord à bord, et c'est
// l'en-tête de chaque vue qui réserve le haut (AppHeader.vue, et les en-têtes propres de
// PatternView / ProjectDetailView / ReaderView). `.screen` (tokens.css) ne réserve QUE les
// côtés et le bas ; OnboardingView est la seule vue sans en-tête, donc la seule exposée.
//
// Pourquoi ce test peut échouer (et échoue bien si on retire la ligne de OnboardingView.vue) :
// on POSE l'inset nous-mêmes. Sur un navigateur de bureau `--sa-top` vaut 0 et aucune
// assertion ne mordrait ; c'est exactement le piège des « 2 appareils » — le défaut n'était
// visible que sur celui qui a une vraie barre d'état par-dessus la WebView. On simule donc
// ce que le plugin natif écrit réellement (src/native/safe-area.js : `--sa-top` posé en
// inline sur documentElement, en px).
const INSET_TOP = 48

test.describe('écran de bienvenue — zone sûre du haut', () => {
  test("le titre reste sous la barre d'état quand l'appareil remonte un inset", async ({
    page,
  }) => {
    await page.goto('/')

    const titre = page.locator('.onb__title')
    await expect(titre).toBeVisible()

    // Témoin : sans inset, le titre est haut dans la page. Si cette mesure était DÉJÀ
    // au-delà de INSET_TOP, l'assertion finale passerait sans rien prouver.
    const avant = await titre.evaluate((el) => el.getBoundingClientRect().top)
    expect(avant).toBeLessThan(INSET_TOP)

    // On pose l'inset exactement comme le fait le plugin natif.
    await page.evaluate((v) => {
      document.documentElement.style.setProperty('--sa-top', `${v}px`)
    }, INSET_TOP)

    const apres = await titre.evaluate((el) => el.getBoundingClientRect().top)

    // Le haut du titre doit être ENTIÈREMENT sous la barre d'état, pas seulement décalé.
    expect(apres).toBeGreaterThanOrEqual(INSET_TOP)
    // Et le décalage vient bien de l'inset : l'air voulu au-dessus du titre est conservé
    // en plus (calc(--sp-6 + --sa-top)), il n'est pas absorbé par la barre d'état.
    expect(apres - avant).toBeCloseTo(INSET_TOP, 0)
  })

  // Un second test « le premier champ du formulaire n'est pas sous la barre d'état » a été
  // écrit puis RETIRÉ : mesuré sans le correctif, ce champ était déjà à plus de 48 px du haut
  // (il vient après le titre et la baseline). Il passait donc dans les DEUX états et
  // n'apportait aucun signal. La généralisation utile n'est pas plus bas dans cet écran-ci,
  // elle est dans le balayage de TOUTES les vues : tests/unit/safe-area-top.spec.js.
})

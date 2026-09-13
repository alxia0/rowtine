// Le burger d'AppHeader.vue porte 9 entrées (Sessions, 31/08 ; Statistiques,
// Dépenses et Guide y sont entrés). Preuve visuelle dans les cas serrés déjà identifiés —
// écran étroit, EN PAYSAGE, et la tablette cible en paysage où c'est la
// hauteur qui est le facteur limitant — et dans les 4 langues (l'allemand rallonge les
// libellés). À 9 entrées, le panneau ne tient PLUS en 640×360 sans hauteur bornée : c'est
// exactement ce que ce fichier mesure.
//
// Revue du 02/08 : la 1re version de ce fichier ne couvrait que 360×640 (étroit, PORTRAIT) et
// 960×584 (large, paysage) — jamais la combinaison littérale, étroit ET paysage à la
// fois. Ajouté : 640×360 (téléphone étroit tourné).
//
// `toBeVisible()` seul ne suffit PAS ici (leçon du 01/08 : vrai hors du cadre photographié) :
// on mesure la position réelle du panneau de menu contre la fenêtre, pas seulement sa
// visibilité CSS.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

const LOCALES = ['fr', 'en', 'de', 'es']

// Bascule la locale depuis les Réglages (motif de tests/e2e/language-switch.spec.js) : passer
// par l'onboarding dans une AUTRE langue changerait aussi les libellés des boutons technique
// qu'utilise completeOnboarding() (écrits en français), donc on onboarde toujours en français
// puis on change la langue APRÈS, une fois sur l'app.
async function setLocale(page, code) {
  if (code === 'fr') return
  await page.goto('/settings')
  await page.locator('[data-test="language-select"]').selectOption(code)
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(code)
}

async function openMenu(page) {
  await page.goto('/')
  // Défensif (trouvé en investiguant une flakiness intermittente le 02/08, cause détaillée
  // dans le rapport de lot) : `completeOnboarding()` déclenche `markSwipeHintSeen()` en tâche
  // de fond (écriture Dexie asynchrone) avant de rendre la main ; pour toute locale non-fr,
  // `setLocale()` enchaîne aussitôt un `page.goto('/settings')`, la seule navigation dure du
  // parcours — si elle part avant la fin de l'écriture, celle-ci est interrompue et l'astuce
  // « balaie pour revenir » (ConfirmDialog, HomeView.vue) réapparaît au retour sur '/', son
  // voile plein écran (`.cfd__scrim`) interceptant alors le clic sur le burger. Locale fr :
  // jamais de `goto` intermédiaire, jamais de fenêtre de course — d'où les échecs concentrés
  // sur en/de/es. Course dépendante de la charge machine, pas déterministe (cf. mémoire du
  // 24/07 : « ne jamais mesurer un correctif sur son seul échantillon de départ »).
  //
  // Correctif défensif côté test : `isVisible()` est un instantané — si l'astuce est encore en
  // train d'apparaître (transition `<Transition>`), il répond `false` et le clic suivant
  // retombe sur le voile. On attend donc jusqu'à 1 s qu'elle apparaisse ET on clique dessus
  // dans la foulée ; `.catch()` avale l'absence (cas fr, et cas normal où elle ne revient pas).
  await page
    .locator('[data-test="confirm-ok"]')
    .click({ timeout: 1000 })
    .catch(() => {})

  await page.locator('.hdr__burger').click()
  const items = page.locator('.menu__item')
  await expect(items).toHaveCount(9)
  return items
}

async function checkMenuReachable(page, locale, { scrolls }) {
  await completeOnboarding(page)
  await setLocale(page, locale)
  const items = await openMenu(page)

  const menuBox = await page.locator('.menu').boundingBox()
  const viewport = page.viewportSize()
  expect(menuBox.x).toBeGreaterThanOrEqual(0)
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width)
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height)

  // LE GARDE DE LA BORNE (revue finale du 12/08). Les trois assertions ci-dessus disent
  // que le panneau ne SORT pas de l'écran ; celle-ci dit POURQUOI il n'en sort pas dans le
  // cas serré — parce que `max-height` le borne et qu'il défile en interne. Sans elle,
  // supprimer la borne d'AppHeader.vue laisserait ce fichier vert : le panneau non borné
  // déborderait vers le bas et c'est `boundingBox()` qui aurait dû le voir, mais la boucle
  // `scrollIntoViewIfNeeded()` plus bas rattrape tout par le défilement de la PAGE.
  // Mesuré AVANT cette boucle : `scrollHeight`/`clientHeight` ne dépendent pas de la
  // position de défilement, mais l'ordre rend la lecture non ambiguë.
  // Cas serré (640×360) : la hauteur de défilement dépasse la hauteur visible. Cas larges :
  // elle ne la dépasse PAS — le panneau tient sans défiler, et l'assertion resterait donc
  // muette si on la posait partout sans distinguer.
  const { scrollHeight, clientHeight } = await page
    .locator('.menu')
    .evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
  if (scrolls) {
    expect(scrollHeight, 'le panneau borné doit défiler en interne').toBeGreaterThan(clientHeight)
  } else {
    expect(scrollHeight, 'le panneau tient sans défiler').toBeLessThanOrEqual(clientHeight)
  }

  // Le panneau défile en interne quand il est borné : `toBeVisible()` sur la 9e entrée
  // serait faux sans amener celle-ci dans le cadre. On fait défiler puis on vérifie —
  // c'est la preuve que les 9 sont ATTEIGNABLES, pas seulement présentes dans le DOM.
  for (let i = 0; i < 9; i++) {
    await items.nth(i).scrollIntoViewIfNeeded()
    await expect(items.nth(i)).toBeVisible()
  }
}

// `scrolls` : le panneau est-il attendu PLUS HAUT que la place qui lui reste, donc borné et
// défilant ? Seul le téléphone tourné (360 px de haut) est dans ce cas — c'est justement le
// format qui a motivé la borne.
const SCENARIOS = [
  { label: 'petit téléphone (360×640, portrait)', viewport: { width: 360, height: 640 }, scrolls: false },
  { label: 'petit téléphone en paysage (640×360, étroit ET paysage)', viewport: { width: 640, height: 360 }, scrolls: true },
  { label: 'tablette cible en paysage (960×584, mesure device)', viewport: { width: 960, height: 584 }, scrolls: false },
]

for (const locale of LOCALES) {
  for (const scenario of SCENARIOS) {
    test.describe(`${scenario.label} — locale ${locale}`, () => {
      test.use({ viewport: scenario.viewport })

      // Titre honnête (revue finale du 12/08) : depuis l'ajout de `scrollIntoViewIfNeeded()`,
      // ce test ne prouve PAS que les 9 entrées sont visibles à la fois — en 640×360 il y en a
      // environ 6 sur 9 dans le cadre. Ce qu'il prouve, c'est qu'elles sont toutes ATTEIGNABLES.
      test('les 9 entrées du menu restent toutes atteignables, le panneau défilant si besoin', async ({ page }) => {
        await checkMenuReachable(page, locale, { scrolls: scenario.scrolls })
      })
    })
  }
}

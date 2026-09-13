// e2e — le guide ouvert sur une section DÉFILE jusqu'à elle (défaut vu sur Nexus 7, 19/08/2026).
//
// POURQUOI CE FICHIER EXISTE. Le garde-fou unitaire `tests/unit/guide-section-cible.spec.js`
// (G9) vérifiait que `/guide?section=<id>` DÉPLIE la bonne section — et rien d'autre. Sur
// l'appareil, la section s'ouvrait bien mais l'écran restait tout en haut, sur le bandeau
// « Télécharger le guide » : le contenu visé était entièrement sous la ligne de flottaison,
// l'utilisatrice devait le chercher elle-même. Un test jsdom ne pouvait pas le voir : jsdom
// ne calcule AUCUNE mise en page (ni hauteur, ni position, ni défilement) et son
// `scrollIntoView` est un bouchon vide posé par tests/unit/setup.js. Seul un vrai moteur de
// rendu répond à la question « est-ce qu'on la VOIT ? ».
//
// ⚠️ Une assertion `toBeInViewport()` SANS ratio serait verte sur le défaut photographié :
// sur la Nexus 7, le titre de la section 4 dépassait à peine en bas de l'écran — donc il
// « intersectait » la fenêtre. On exige donc le titre ENTIER (`ratio: 1`), dégagé du bandeau
// collant, et le début du contenu au-dessus de la ligne de flottaison.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers.js'

// Même identifiant que `src/constants/guide-sections.js` (GUIDE_SECTION_BIBLIOTHEQUE), écrit
// en clair ici : les tests e2e n'importent pas de source applicative, et c'est bien l'URL
// littérale que produisent les deux boutons « Comment corriger » qu'on veut exercer.
const CIBLE = 'section-4'

test('Guide : /guide?section=… défile jusqu’à la section, pas seulement la déplie', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto(`/guide?section=${CIBLE}`)

  // ── PRÉCONDITIONS ────────────────────────────────────────────────────────────────────
  // Sans elles, « la section n'est pas visible » serait vrai sur une page blanche, et
  // « elle est visible » serait vrai sur une page trop courte pour avoir à défiler.
  await expect(page.locator('.section')).toHaveCount(10)
  const cible = page.locator(`.section[data-section-id="${CIBLE}"]`)
  await expect(cible).toHaveCount(1)
  await expect(page.locator('.section[open]')).toHaveCount(1)
  await expect(cible).toHaveAttribute('open', '')

  const depassement = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
  expect(depassement, 'la page tient dans la fenêtre : ce test ne prouverait rien').toBeGreaterThan(0)

  // Le défilement est LISSÉ (`behavior: 'smooth'`, sauf sous « réduire les animations ») :
  // mesuré, il met ~500 ms à parcourir les ~816 px. Une mesure prise en vol lirait une
  // position de PASSAGE — et cette position de passage satisfait déjà les assertions
  // ci-dessous, ce qui en ferait des tests non concluants. On attend donc que la position se
  // pose (deux lectures consécutives identiques) avant de mesurer quoi que ce soit.
  // ⚠️ Un écran qui ne défile JAMAIS est « posé » lui aussi : cette attente ne prouve rien à
  // elle seule, ce sont les assertions qui suivent qui tranchent (vérifié : sur le code
  // d'avant le correctif, on se pose à y = 0 et `toBeInViewport` rougit).
  const yPose = await attendreDefilementPose(page)

  // ── CE QUI A ÉCHOUÉ SUR L'APPAREIL ───────────────────────────────────────────────────
  const titre = cible.locator('summary')
  await expect(titre).toBeInViewport({ ratio: 1 })

  // Mesures explicites, en plus du `toBeInViewport` ci-dessus : elles disent DE COMBIEN
  // c'est raté quand ça rate (le rapport de Playwright ne donne qu'un ratio), et elles
  // couvrent deux choses que `toBeInViewport` ignore — le bandeau collant qui passe
  // PAR-DESSUS le titre (AppHeader est `position: sticky; top: 0` et opaque : un titre calé
  // à y = 0 est « dans la fenêtre » tout en étant invisible), et le début du contenu.
  const m = await page.evaluate((sel) => {
    const d = document.querySelector(sel)
    const s = d.querySelector('summary')
    const premier = d.querySelector('.section__body').firstElementChild
    const bandeau = document.querySelector('.hdr')
    return {
      vh: window.innerHeight,
      scrollY: window.scrollY,
      bandeauBas: bandeau.getBoundingClientRect().bottom,
      titreHaut: s.getBoundingClientRect().top,
      titreBas: s.getBoundingClientRect().bottom,
      premierBlocHaut: premier.getBoundingClientRect().top,
    }
  }, `.section[data-section-id="${CIBLE}"]`)

  expect(m.titreHaut, `titre à ${m.titreHaut}px, bas du bandeau collant à ${m.bandeauBas}px`).toBeGreaterThanOrEqual(
    m.bandeauBas,
  )
  expect(m.titreBas, `titre bas à ${m.titreBas}px pour une fenêtre de ${m.vh}px`).toBeLessThanOrEqual(m.vh)
  expect(
    m.premierBlocHaut,
    `1er bloc de contenu à ${m.premierBlocHaut}px pour une fenêtre de ${m.vh}px`,
  ).toBeLessThan(m.vh)

  // ── ET ÇA TIENT ──────────────────────────────────────────────────────────────────────
  // Le défaut d'origine était STABLE (deux captures identiques à 3 s d'intervalle) : ce
  // n'était pas une animation en cours. La réciproque doit être vraie aussi — la position
  // atteinte ne doit pas être reprise après coup (par le routeur, par une image en cours de
  // chargement qui change la hauteur…). On laisse donc passer du temps et on re-mesure.
  await page.waitForTimeout(1000)
  const apres = await page.evaluate(() => Math.round(window.scrollY))
  expect(Math.abs(apres - yPose), `défilement repris après coup : ${yPose}px → ${apres}px`).toBeLessThan(2)
  await expect(titre).toBeInViewport({ ratio: 1 })
})

// Deux lectures consécutives identiques (à 1 px près) : le défilement lissé ne bouge plus.
// Rend la position posée, pour que l'appelant puisse vérifier plus tard qu'elle a tenu.
async function attendreDefilementPose(page) {
  let precedent = null
  let pose = null
  await expect
    .poll(
      async () => {
        const y = await page.evaluate(() => Math.round(window.scrollY))
        const stable = precedent !== null && Math.abs(y - precedent) < 2
        precedent = y
        if (stable) pose = y
        return stable
      },
      { timeout: 5000, intervals: [150] },
    )
    .toBe(true)
  return pose
}

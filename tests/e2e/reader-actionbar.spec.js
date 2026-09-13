// Barre d'action du suivi — le bouton Chrono ne doit pas manger toute la largeur
// disponible avant les boutons diagramme/aide-mémoire (retour device 27/07).
// Depuis le 08/09 (fusion chrono + œil) : l'ancien bouton œil a disparu de la rangée — la
// pastille porte désormais son chevron ▾ en bout de capsule (masquage via mini-menu),
// si bien que la rangée n'a plus que TROIS items : pastille (avec chevron), diagramme,
// aide-mémoire.
// Les GESTES nommés (chevron, entrée du menu, action du snackbar) passent par le nom
// accessible — getByRole('button', { name }) ; seul le toggle lecture/pause du CORPS est
// ciblé par classe (.chrono-fab__body) : son nom accessible change d'état en état (Pause /
// Chrono, traduit), et les tests de ce fichier le déclenchent en série dans ses trois
// états — la classe désigne le composant, pas un glyphe ; le nom accessible des gestes de
// masquage est épinglé au test « chrono masqué » ci-dessous.
import { test, expect } from '@playwright/test'
import { completeOnboarding, openDemoReaderWithChart } from './helpers'

// Mesuré : au viewport Pixel 5 par défaut (393 px), la barre est déjà bridée à la largeur
// de l'écran par .actionbar (left:0;right:0), donc même AVEC le bug (flex:1) le chrono ne
// dépasse jamais 187 px sur une barre de 393 px (< 50 %) — le seuil ne mord pas et le test
// ne prouverait rien. La régression constatée en usage apparaît sur tablette, où
// --w-content passe à 720/840 px (adaptation à la largeur) : la barre s'élargit
// mais les 3 autres boutons restent à taille fixe, donc flex:1 étire le chrono d'autant
// plus. On reproduit ce viewport (tablette paysage, --w-content=840) pour que l'assertion
// soit discriminante.
test.use({ viewport: { width: 900, height: 700 } })

test('le chrono ne mange pas la largeur de la barre d’action', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await openDemoReaderWithChart(page)

  const bar = page.locator('.actionbar')
  const chrono = page.locator('.chrono-fab')
  await expect(chrono).toBeVisible()

  const bBox = await bar.boundingBox()
  const cBox = await chrono.boundingBox()

  // N'occupe pas toute la place laissée par les autres boutons.
  expect(cBox.width).toBeLessThan(bBox.width * 0.5)

  // Disposition voulue : le chrono est calé à GAUCHE de la barre, pas groupé à droite.
  // Le padding latéral de .actionbar vaut au moins --sp-4 (16 px), d'où la tolérance.
  expect(cBox.x - bBox.x).toBeLessThan(24)

  // Le libellé n'est PAS vérifié ici : à 900 px (tablette large), il y a toujours assez
  // de place — l'assertion passerait que le mécanisme de troncature existe ou non, elle
  // ne prouverait rien (relecture du 27/07). La vérification réelle est à 360 px, où le
  // risque existe, voir le test « rangée à 360 px » plus bas et son test.fixme.
})

// Chrono masqué (chevron de la pastille → « Masquer le chrono », project.showTimer=false) :
// les deux boutons restants (diagramme, aide-mémoire) doivent rester groupés à DROITE —
// c'est le rôle du `justify-content: flex-end` de .actionbar. La marge `margin-right: auto`
// du chrono (sur un élément qui disparaît du DOM) ne doit rien changer à ce comportement.
//
// Locateurs par NOM ACCESSIBLE (règle maison, jamais par classe/glyphe pour les gestes) :
// le banc e2e force locale fr-FR (playwright.config.js) — libellés stables du banc, issus
// des 4 locales de src/i18n : fr « Masquer le chrono » / en « Hide timer » / de « Timer
// ausblenden » / es « Ocultar el cronómetro » (et « Afficher le chrono » / « Show timer » /
// « Timer anzeigen » / « Mostrar el cronómetro »). Même convention que les specs existantes
// (libellés fr du banc, cf. session.spec.js « Supprimer le projet »).
test('chrono masqué : les boutons restants restent groupés à droite', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  await openDemoReaderWithChart(page)

  // Masquage par le geste réel, nom accessible reader.hideTimer : le chevron d'abord (à cet
  // instant, seul bouton du nom sur la page).
  await page.getByRole('button', { name: 'Masquer le chrono' }).click()
  // …puis l'entrée du mini-menu : menu ouvert, le chevron (aria-label) et l'entrée (texte)
  // portent le MÊME nom — l'ambiguïté se lève en scendant l'entrée par le rôle navigation
  // du <nav> du menu, toujours par nom accessible pour le bouton lui-même.
  await page.getByRole('navigation').getByRole('button', { name: 'Masquer le chrono' }).click()
  await expect(page.locator('.chrono-fab')).toBeHidden()

  const bar = page.locator('.actionbar')
  const ref = page.locator('.fab--ref')
  const bBox = await bar.boundingBox()
  const rBox = await ref.boundingBox()

  // Le dernier bouton (aide-mémoire) doit coller au bord droit de la barre (± padding),
  // pas flotter au milieu ou à gauche.
  expect(bBox.x + bBox.width - (rBox.x + rBox.width)).toBeLessThan(24)

  // Retour en un geste : le snackbar porte « Afficher le chrono » (reader.showTimer),
  // qui fait revenir la pastille — à cet instant la pastille est masquée, le nom est unique.
  await page.getByRole('button', { name: 'Afficher le chrono' }).click()
  await expect(page.locator('.chrono-fab')).toBeVisible()
})

// À 360 px (petit téléphone), l'état EN PAUSE (icône + « Reprendre » + temps) est le plus
// large des trois états du bouton et le plus à risque de chevaucher ou de passer à la ligne
// avec les boutons diagramme/aide-mémoire voisins. On vérifie les trois états sur une rangée.
test.describe('rangée à 360 px', () => {
  test.use({ viewport: { width: 360, height: 640 } })

  test('les trois boutons tiennent sur une rangée dans les trois états du chrono', async ({ page }) => {
    await completeOnboarding(page, { firstName: 'Alex' })
    await openDemoReaderWithChart(page)

    const bar = page.locator('.actionbar')
    const chrono = page.locator('.chrono-fab')
    const chev = page.locator('.chrono-fab__chev')
    const chart = page.locator('.fab--chart')
    const ref = page.locator('.fab--ref')

    // `.actionbar` est en flex-nowrap (pas de flex-wrap posé) : un débordement ne se
    // manifeste PAS par un retour à la ligne mais par un chevauchement des boutons voisins
    // ou par un bouton poussé hors de la boîte de la barre (à droite, hors du pouce).
    // Depuis la fusion chevron (08/09), la rangée n'a plus que TROIS items : la
    // chevron vit DANS la capsule (c'est l'adjacence capsule→diagramme la plus serrée,
    // surtout en pause où la pastille est la plus large) — on vérifie donc que la pastille
    // ENTIÈRE (chevron compris) précède le diagramme sans le chevaucher, et que le dernier
    // bouton (aide-mémoire) reste dans la boîte de la barre.
    async function noOverlapAndInBounds() {
      const b = await bar.boundingBox()
      const c = await chrono.boundingBox()
      const v = await chev.boundingBox()
      const g = await chart.boundingBox()
      const r = await ref.boundingBox()
      // Le chevron est bien l'EXTRÉMITÉ droite de la capsule (il fait partie d'elle).
      expect(v.x + v.width).toBeLessThanOrEqual(c.x + c.width + 0.5)
      expect(g.x + g.width).toBeLessThanOrEqual(r.x + 0.5)
      expect(r.x + r.width).toBeLessThanOrEqual(b.x + b.width + 0.5)
      expect(c.x).toBeGreaterThanOrEqual(b.x - 0.5)
      // Pas de chevauchement capsule → diagramme.
      expect(c.x + c.width).toBeLessThanOrEqual(g.x + 0.5)
    }

    // État 1 : à l'arrêt (icône + « Chrono »).
    await expect(chrono).toHaveClass(/chrono-fab--idle/)
    await noOverlapAndInBounds()

    // État 2 : en marche (icône + temps).
    await page.locator('.chrono-fab__body').click()
    await expect(chrono).not.toHaveClass(/chrono-fab--idle/)
    await noOverlapAndInBounds()

    // État 3 : en pause (icône + « Reprendre » + temps) — le plus large des trois.
    await page.waitForTimeout(1100) // laisse le chrono accumuler un elapsedSec > 0
    await page.locator('.chrono-fab__body').click()
    await expect(chrono).toHaveClass(/chrono-fab--idle/)
    await expect(page.locator('.chrono-fab__lbl')).toHaveText(/Reprendre/i)
    await noOverlapAndInBounds()
    // Troncature du libellé « Reprendre » à 360 px : constat séparé, voir test.fixme
    // ci-dessous (addendum) — pas d'assertion de non-troncature ici,
    // ce serait actuellement faux.
  })

  // HISTORIQUE — ce test était un `test.fixme` (constat de la revue du 27/07) : à 360 px,
  // l'état EN PAUSE tronquait réellement le libellé, mesuré clientWidth 52 px pour un
  // contenu de 78 px (« Repr… »), soit ~26 px de déficit. La cause n'était pas le style du
  // chrono lui-même mais la largeur que la RANGÉE lui laissait — donc hors de ce qui avait
  // été constaté alors. Retour d'usage du 01/08 (« on ne voit plus
  // Reprendre en entier ») : c'est ce correctif qui la traite, en sortant le bouton retour-en-haut
  // du flux de la rangée (cf. `.actionbar :deep(.btt)` dans ReaderView.vue). Le test est
  // donc actif ; il doit rougir si un futur bouton revient prendre de la largeur ici.
  //
  // Vérifié dans les QUATRE langues, et pas seulement en français : la marge dégagée par
  // le correctif est de quelques pixels, et le libellé le plus long n'est PAS le français
  // (mesuré : « Fortsetzen » 79 px, « Reprendre » 78, « Reanudar » 71, « Resume » 59).
  // Un test au seul français laisserait passer une troncature en allemand.
  for (const [code, attendu] of [
    ['fr', /Reprendre/i],
    ['de', /Fortsetzen/i],
    ['es', /Reanudar/i],
    ['en', /Resume/i],
  ]) {
    test(`à 360 px, le libellé de reprise n’est pas tronqué (${code})`, async ({ page }) => {
      // Le parcours se fait en français (les helpers ne connaissent que ces libellés),
      // puis on bascule la langue et on revient sur le lecteur déjà ouvert.
      await completeOnboarding(page, { firstName: 'Alex' })
      await openDemoReaderWithChart(page)
      if (code !== 'fr') {
        const url = page.url()
        await page.goto('/settings')
        await page.locator('[data-test="language-select"]').selectOption(code)
        await page.goto(url)
        await expect(page.locator('.chrono-fab')).toBeVisible()
      }

      const chrono = page.locator('.chrono-fab')
      await page.locator('.chrono-fab__body').click()
      await page.waitForTimeout(1100)
      await page.locator('.chrono-fab__body').click()
      const lbl = page.locator('.chrono-fab__lbl')
      // Garde-fou : sans elle, une locale muette (clé manquante → libellé vide) rendrait
      // l'assertion de largeur trivialement vraie.
      await expect(lbl).toHaveText(attendu)

      const { clientWidth, scrollWidth } = await lbl.evaluate((el) => ({
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
      }))
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
    })
  }

  // Le bouton retour-en-haut, désormais empilé AU-DESSUS de l'aide-mémoire (retour
  // d'usage du 01/08). Deux choses à prouver, et la première est celle qui compte :
  //  1. il ne prend AUCUNE largeur dans la rangée — sinon le test ci-dessus redeviendrait
  //     faux ; on le vérifie en comparant la largeur du chrono avant et après son
  //     apparition, qui doit être RIGOUREUSEMENT identique ;
  //  2. il est bien au-dessus du bouton aide-mémoire, et non à côté : bord bas au-dessus
  //     du bord haut du fab, bord droit aligné sur le sien.
  test('le retour-en-haut se pose au-dessus de l’aide-mémoire, sans voler de largeur au chrono', async ({ page }) => {
    await completeOnboarding(page, { firstName: 'Alex' })
    await openDemoReaderWithChart(page)

    const chrono = page.locator('.chrono-fab')
    const ref = page.locator('.fab--ref')
    const btt = page.locator('.actionbar button.btt')

    // Mettre le chrono dans son état le PLUS LARGE (en pause : « Reprendre » + temps) :
    // c'est le seul état où une largeur volée se verrait.
    await page.locator('.chrono-fab__body').click()
    await page.waitForTimeout(1100)
    await page.locator('.chrono-fab__body').click()
    await expect(page.locator('.chrono-fab__lbl')).toHaveText(/Reprendre/i)

    await expect(btt).toBeHidden() // pas encore défilé : le bouton n'existe pas
    const avant = await chrono.boundingBox()

    // Au-delà d'une hauteur et demie d'écran, le bouton apparaît.
    await page.evaluate(() => window.scrollTo(0, 4000))
    await expect(btt).toBeVisible()

    const apres = await chrono.boundingBox()
    // Aucune largeur prise : si le bouton redevenait un item de la rangée flex, le chrono
    // (flex: 0 1 auto, rétrécissable) perdrait sa largeur ici et le libellé se tronquerait.
    expect(apres.width).toBe(avant.width)

    const b = await btt.boundingBox()
    const r = await ref.boundingBox()
    expect(b.y + b.height).toBeLessThanOrEqual(r.y + 0.5) // au-dessus, pas à côté
    expect(Math.abs(b.x + b.width - (r.x + r.width))).toBeLessThanOrEqual(1) // bords droits alignés
  })
})

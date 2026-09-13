// Lecteur à deux volets : le diagramme reste épinglé à droite du texte sur tablette en
// paysage, et rien ne change sur téléphone.
import { test, expect } from '@playwright/test'
import { completeOnboarding, openDemoReaderWithChart } from './helpers'

test.describe('lecteur à deux volets', () => {
  test('tablette en paysage : le volet est à droite du texte et ne le recouvre pas', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await completeOnboarding(page, { firstName: 'Alex' })
    await openDemoReaderWithChart(page)

    const pane = page.locator('.rpane')
    await expect(pane).toBeVisible()

    const paneBox = await pane.boundingBox()
    const textBox = await page.locator('main.screen').boundingBox()
    expect(paneBox.width).toBeGreaterThan(300)
    // Les deux volets ne se chevauchent pas : le texte finit avant que le volet commence.
    expect(textBox.x + textBox.width).toBeLessThanOrEqual(paneBox.x + 1)
    // Le volet occupe toute la hauteur : un diagramme haut reste atteignable.
    expect(paneBox.height).toBeGreaterThan(700)

    // Le diagramme lui-même est visible et remplit le volet (pas juste un cadre vide :
    // .rpane pourrait être dimensionné correctement tout en laissant .cstage à hauteur nulle
    // si le flex enfant ne se propageait pas).
    const viewport = page.locator('.rpane .cfs__viewport')
    await expect(viewport).toBeVisible()
    await expect(page.locator('.rpane .cfs__canvas img')).toBeVisible()
    const viewportBox = await viewport.boundingBox()
    expect(viewportBox.height).toBeGreaterThan(paneBox.height * 0.5)

    // La barre d'action ne passe pas sous le diagramme.
    const barBox = await page.locator('.actionbar').boundingBox()
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(paneBox.x + 1)

    // Les 4 bandes du fil (en-tête, barre de progression, texte, barre d'action) restent
    // alignées entre elles en mode deux volets : `.actionbar` est en `position: fixed` et
    // reçoit sa largeur par un mécanisme DIFFÉRENT des 3 autres (le `padding-right` de
    // `.reader--split`, cf. ReaderView.vue) — 2 chemins de code qui doivent s'accorder,
    // classique candidat à la dérive silencieuse (tests/e2e/responsive.spec.js couvre déjà
    // cet invariant hors mode volet, sur un patron sans diagramme).
    const bandes = await page.evaluate(() =>
      ['.rhdr', '.rhdr__prog', 'main.screen', '.actionbar'].map((sel) => {
        const el = document.querySelector(sel)
        return { sel, w: el ? Math.round(el.getBoundingClientRect().width) : null }
      }),
    )
    for (const { sel, w } of bandes) expect(w, `${sel} introuvable`).not.toBeNull()
    expect(new Set(bandes.map((b) => b.w)).size, `largeurs mesurées : ${JSON.stringify(bandes)}`).toBe(1)

    // Le bouton Agrandir (rendu dans le slot `tools` de ChartStage, donc avec le scope CSS de
    // ReaderView et non celui de ChartStage) doit avoir la même cible tactile 44×44 que les
    // 3 autres outils, pas le style de bouton par défaut du navigateur.
    const zoomBtn = pane.getByRole('button', { name: 'Agrandir le diagramme' })
    const zoomBox = await zoomBtn.boundingBox()
    expect(zoomBox.width).toBeCloseTo(44, 0)
    expect(zoomBox.height).toBeCloseTo(44, 0)
  })

  test('téléphone : aucun volet, aucun débordement horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 })
    await completeOnboarding(page, { firstName: 'Alex' })
    await openDemoReaderWithChart(page)

    await expect(page.locator('.rpane')).toHaveCount(0)
    // Débordement mesuré sur le document, pas sur window.innerWidth (qui suit la fenêtre
    // et rendrait l'assertion vraie par construction).
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(over).toBeLessThanOrEqual(0)
  })

  test('téléphone en paysage (915×412) : pas de volet — la hauteur fait partie du seuil', async ({ page }) => {
    await page.setViewportSize({ width: 915, height: 412 })
    await completeOnboarding(page, { firstName: 'Alex' })
    await openDemoReaderWithChart(page)
    await expect(page.locator('.rpane')).toHaveCount(0)
  })

  // Taille réelle mesurée via CDP sur la tablette cible (Nexus 7, Android 11) : 960×584 en
  // paysage (la barre de navigation Android consomme 16px de hauteur CSS). Avec l'ancien
  // seuil à 600px de hauteur, cet appareil ne basculait JAMAIS en deux volets — c'est cette
  // garde qui aurait attrapé le défaut avant la mesure sur device (cf. useSplitReader.js).
  test('tablette cible (960×584, mesure device) : le volet apparaît', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 584 })
    await completeOnboarding(page, { firstName: 'Alex' })
    await openDemoReaderWithChart(page)
    await expect(page.locator('.rpane')).toBeVisible()
  })

  // Même tablette cible, mais en navigation 3 boutons plutôt qu'en mode gestuel : la barre
  // de navigation Android y occupe 48px de hauteur CSS au lieu de 16, ce qui fait tomber la
  // hauteur du viewport à environ 552px. C'est exactement le scénario qui rendait le mode
  // deux volets inatteignable avec l'ancien seuil de 560 (cf. useSplitReader.js) : cette
  // garde protège le correctif contre une régression au premier changement de réglage
  // système de l'utilisatrice.
  test('tablette cible en navigation 3 boutons (960×552) : le volet apparaît', async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 552 })
    await completeOnboarding(page, { firstName: 'Alex' })
    await openDemoReaderWithChart(page)
    await expect(page.locator('.rpane')).toBeVisible()
  })

  test('la progression écrite dans le volet est la même que celle du plein écran', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    // Contexte navigateur neuf (isolation Playwright) : sans l'onboarding, /library
    // redirige vers l'écran d'accueil du 1er lancement (même garde de route que les
    // 3 autres tests de ce fichier, qui l'appellent déjà).
    await completeOnboarding(page, { firstName: 'Alex' })
    await openDemoReaderWithChart(page)

    // Avancer de 2 rangs dans le volet.
    await page.locator('.rpane .cfs__next').click()
    await page.locator('.rpane .cfs__next').click()
    await expect(page.locator('.rpane .cfs__rowval')).toHaveText(/^3 \//)

    // Ouvrir le plein écran depuis le volet : il doit s'ouvrir sur le MÊME rang.
    await page.locator('.rpane .cfs__tool').last().click()
    await expect(page.locator('.cfs .cfs__rowval')).toHaveText(/^3 \//)

    // Avancer d'un rang en plein écran, fermer : le volet doit avoir suivi.
    await page.locator('.cfs .cfs__next').click()
    await page.locator('.cfs .cfs__close').click()
    await expect(page.locator('.rpane .cfs__rowval')).toHaveText(/^4 \//)
  })

  // Arbitrage produit (revue du 28/07) : la carte du diagramme épinglé reste dans le fil
  // (avant, tout le bloc <ReaderChart> était remplacé par une ligne de renvoi — les boutons
  // request-rows/request-reps, qui n'ont AUCUN autre point d'entrée dans l'appli, en devenaient
  // inatteignables sur un patron à une seule grille). Seule l'IMAGE de la carte doit disparaître,
  // car c'est le seul élément déjà montré au même instant dans le volet de droite.
  test('la carte du diagramme épinglé garde ses boutons accessibles, seule l’image est masquée', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await completeOnboarding(page, { firstName: 'Alex' })
    await openDemoReaderWithChart(page)

    // « Corps » porte l'UNIQUE grille du patron démo (Bonnet Torsade) — c'est donc elle qui
    // est épinglée par défaut à l'ouverture (cf. tests/unit/reader-split-pane.spec.js).
    const pinnedCard = page.locator('#rchart-corps')
    await expect(pinnedCard).toBeVisible()

    // L'image de CETTE carte est masquée (déjà affichée à droite)...
    await expect(pinnedCard.locator('.chart__viewport')).toBeHidden()
    // ...mais le renvoi cliquable vers le volet reste présent...
    await expect(pinnedCard.locator('.rchart-ref')).toBeVisible()
    // ...ainsi que la légende et les repères de rang : rien n'est perdu au même instant sauf
    // l'image elle-même.
    await expect(pinnedCard.locator('.chart__legend')).toBeVisible()
    await expect(pinnedCard.locator('.chart__end')).toBeVisible()

    // Le patron démo a déjà un nombre de rangs connu (rows:24) mais pas de compteur de
    // répétition (chart.reps non défini) : c'est donc le bouton « Ajouter un compteur de
    // répétition » (request-reps) qui est exposé sur cette carte, pas « Indiquer le nombre
    // de rangs » (déjà réglé). Il doit rester visible ET cliquable — sans ce correctif, toute
    // la carte disparaissait du fil et ce bouton devenait inatteignable pour de bon sur un
    // patron à une seule grille — c'est justement le cas ici : Bonnet Torsade n'a QU'UNE
    // seule grille, contrairement à l'ancien patron démo (Twist Loop Top, deux grilles).
    page.once('dialog', (dialog) => dialog.accept('2'))
    const addRepBtn = pinnedCard.locator('.chart__addrep')
    await expect(addRepBtn).toBeVisible()
    await addRepBtn.click()
    // La preuve que le clic a bien été reçu (pas juste "cliquable sans effet") : le bouton
    // + compteur disparaît, remplacé par la barre de compteur nouvellement activée.
    await expect(pinnedCard.locator('.chart__repbar')).toBeVisible()
    await expect(addRepBtn).toHaveCount(0)

    // Note : l'ancien patron démo (2 grilles) permettait aussi de vérifier ICI qu'une grille
    // NON épinglée garde son image visible normalement dans le fil. Bonnet Torsade n'a qu'une
    // seule grille — cet invariant reste couvert par le test « décrocher élargit la colonne… »
    // ci-dessous (lignes 209-216 au moment de l'écriture), qui prouve qu'une carte décrochée
    // (donc non épinglée) réaffiche bien son image en vrai.
  })

  test('cliquer le renvoi ramène le focus dans le volet épinglé', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await completeOnboarding(page, { firstName: 'Alex' })
    await openDemoReaderWithChart(page)

    const ref = page.locator('.rchart-ref')
    await expect(ref).toBeVisible()
    await ref.click()

    // Le focus doit atterrir dans le viewport du diagramme épinglé (à droite), pas rester
    // sur le bouton de renvoi ni ailleurs dans le fil.
    const focusedInPane = await page.evaluate(() => {
      const el = document.activeElement
      return !!el && !!el.closest('.rpane')
    })
    expect(focusedInPane).toBe(true)
  })

  test('décrocher élargit la colonne de texte, ré-épingler la rétrécit', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await completeOnboarding(page, { firstName: 'Alex' })
    await openDemoReaderWithChart(page)

    const texte = page.locator('main.screen')
    const avant = (await texte.boundingBox()).width
    await expect(page.locator('.rpane')).toBeVisible()

    // Capturer l'id de la carte épinglée AVANT de décrocher : `.rstep__chart--pinned`
    // disparaît avec `splitMode`, donc après le clic on ne pourrait plus la retrouver
    // par cette classe (revue 28/07).
    const pinnedId = await page.locator('.rstep__chart--pinned').getAttribute('id')

    await page.locator('.rchart-unpin').click() // « Ramener dans le texte »
    await expect(page.locator('.rpane')).toHaveCount(0)
    await expect(page.locator('.rchart-unpin')).toHaveCount(0) // plus rien n'est épinglé
    const apres = (await texte.boundingBox()).width
    expect(apres).toBeGreaterThan(avant + 100) // la colonne a réellement grandi

    // Invariant central (« aucune perte d'information ») : décrochée, l'image de la carte
    // qui était épinglée doit être VISIBLE EN VRAI, pas seulement présente dans le DOM —
    // sans quoi décrocher serait un aller sans retour pour cette image (le mécanisme est
    // passé de display:none à un v-if/v-else qui ne la rend plus du tout tant que le volet
    // existe ; rien ne prouvait ailleurs qu'elle revient une fois le volet fermé).
    const revenue = page.locator(`#${pinnedId} .chart__viewport`)
    await expect(revenue).toBeVisible()
    await expect(revenue.locator('img')).toBeVisible()

    await page.locator('.rchart-pin').first().click() // « Afficher à droite »
    await expect(page.locator('.rpane')).toBeVisible()
    expect((await texte.boundingBox()).width).toBeCloseTo(avant, 0)
  })

  // Retour device 28/07 : une assertion sur la classe/le sélecteur ne prouve pas une
  // POSITION — seule une mesure géométrique attrape le défaut d'origine (bouton posé
  // au-dessus de la carte, hors de son rectangle).
  test('les commandes du volet sont géométriquement dans la carte', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await completeOnboarding(page, { firstName: 'Alex' })
    await openDemoReaderWithChart(page)

    const bouton = page.locator('.rchart-unpin')
    await expect(bouton).toBeVisible()
    const carte = page.locator('.rstep__chart--pinned .chart')
    const b = await bouton.boundingBox()
    const c = await carte.boundingBox()
    // Le bouton est inclus dans le rectangle de la carte — c'est ce qui manquait avant.
    expect(b.x).toBeGreaterThanOrEqual(c.x - 1)
    expect(b.y).toBeGreaterThanOrEqual(c.y - 1)
    expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width + 1)
    expect(b.y + b.height).toBeLessThanOrEqual(c.y + c.height + 1)
  })

  // Retour terrain du 28/07 : les deux commandes n'étaient qu'une icône + aria-label —
  // « je pense qu'il faut un libellé qui explique à quoi servent ces flèches ». Ce test
  // aurait attrapé le défaut d'origine : il échoue si un bouton visible du volet ne porte
  // qu'une icône (aucun texte affiché).
  test('à 1024×768, chaque commande visible du volet porte un texte non vide', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await completeOnboarding(page, { firstName: 'Alex' })
    await openDemoReaderWithChart(page)

    // Grille épinglée par défaut (Corps, l'unique grille du patron démo) : bouton
    // « Ramener dans le texte ».
    const unpinLabel = page.locator('.rchart-unpin .rchart-label')
    await expect(unpinLabel).toBeVisible()
    expect((await unpinLabel.textContent()).trim().length).toBeGreaterThan(0)

    // Bonnet Torsade n'a qu'une seule grille (contrairement à l'ancien patron démo, qui en
    // avait deux) : pour vérifier le libellé du bouton « Afficher à droite » (repin), on
    // décroche d'abord CETTE MÊME carte — comme le fait déjà le test « décrocher élargit la
    // colonne… » plus bas — plutôt que d'inventer une seconde grille hors du périmètre de ces
    // travaux (contenu des exemples, cf. src/constants/demo/).
    await page.locator('.rchart-unpin').click()
    const pinLabel = page.locator('.rchart-pin .rchart-label')
    await expect(pinLabel).toBeVisible()
    expect((await pinLabel.textContent()).trim().length).toBeGreaterThan(0)
  })

  // Mesure avant de choisir (consigne de travail), CORRIGÉE le
  // 28/07 après mesure sur la tablette réelle de test (Nexus 7, 960×584 en paysage) :
  // la carte y mesure 452px et son `.chart__title` bascule sur 2 lignes (51px de haut) —
  // c'est un rendu VU ET ACCEPTÉ (« ça me va, on garde »), pas un défaut. Les deux
  // viewports ci-dessous (1019/1024) sont ceux du BANC (Chromium desktop), pas une
  // reproduction fidèle de la tablette : à ces largeurs, la colonne du banc (~518-521px)
  // est plus large que la vraie colonne tablette (452px) — c'est cet écart de LARGEUR DE
  // COLONNE (pas le texte du titre, identique des deux côtés) qui explique que le banc ne
  // bascule jamais sur 2 lignes à ces deux viewports précis, contrairement à l'appareil —
  // ce test vérifie donc seulement l'absence de RÉGRESSION GRAVE sur le banc (colonne qui
  // dérive, titre qui explose sur 3+ lignes), pas l'exactitude au pixel près d'un rendu
  // tablette.
  for (const { viewport, label } of [
    { viewport: 1019, label: '1019px (colonne ≈518px sur le banc)' },
    { viewport: 1024, label: '1024px (colonne ≈521px sur le banc)' },
  ]) {
    test(`barre de titre du diagramme sur au plus 2 lignes, colonne stable, à ${label}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport, height: 768 })
      await completeOnboarding(page, { firstName: 'Alex' })
      await openDemoReaderWithChart(page)

      // Bornée des DEUX côtés : l'ancienne version (`toBeLessThan(525)` seul) laissait
      // passer n'importe quelle colonne plus étroite sans broncher — la tablette réelle
      // (452px) l'aurait traversée sans échec alors que sa prémisse (« colonne ≈518-521px
      // sur ce banc ») aurait dû être signalée comme fausse pour CE viewport de banc précis.
      // Mutation vérifiée (cf. rapport) : `--pane-w` élargi fait chuter cardWidth à ~274px
      // → échoue bien sur la borne basse.
      const cardWidth = (await page.locator('#rchart-corps .chart').boundingBox()).width
      expect(cardWidth, `colonne attendue ~518-521px à un viewport de ${viewport}px`).toBeGreaterThan(505)
      expect(cardWidth, `colonne attendue ~518-521px à un viewport de ${viewport}px`).toBeLessThan(530)

      // Corps : l'unique carte de ce patron démo (Bonnet Torsade) qui porte une commande de
      // volet (épinglée par défaut, bouton unpin). L'ancien patron démo (Twist Loop Top) en
      // portait deux (Devant + Corps) ; une seule suffit à exercer l'assertion, qui est
      // per-carte (largeur de colonne pilotée par --pane-w, pas par le contenu du diagramme).
      for (const sel of ['#rchart-corps .chart__title']) {
        const title = page.locator(sel)
        await expect(title).toBeVisible()
        const box = await title.boundingBox()
        // Pas d'assertion de troncature ici : `.chart__title` (ReaderChart.vue) n'a ni
        // `white-space: nowrap` ni `overflow: hidden`/`text-overflow: ellipsis` — son texte
        // se renvoie à la ligne au lieu de déborder. La mutation « bouton surdimensionné »
        // (`min-width: 260px` sur `.rchart-pin`/`.rchart-unpin`) ne fait varier que la
        // hauteur (`scrollWidth === clientWidth` avant/après, cf. rapport). Un libellé de
        // bouton très allongé PEUT faire apparaître `scrollWidth > clientWidth` (mesuré),
        // mais dans ce même cas la hauteur explose aussi (76,5px, cf. rapport) — la borne
        // de hauteur ci-dessous détecte donc déjà ce défaut, sans perte de couverture.

        // Au plus 2 lignes, PAS « une seule ligne » : la tablette réelle en fait déjà 2
        // (51px) et c'est accepté. 36px = 1 ligne (hauteur plancher imposée par les
        // boutons 36×36 du volet) ; 51px = 2 lignes mesurées sur la tablette réelle ; 60px
        // = borne choisie avec marge au-dessus de 51 et nettement sous les 76,5px mesurés
        // pour 3 lignes sur ce même banc (mutation de titre, cf. rapport) — un vrai passage
        // à 3 lignes ferait donc échouer ce test, un passage à 2 lignes non.
        expect(box.height, `${sel} sur plus de 2 lignes à ${viewport}px`).toBeLessThanOrEqual(60)
      }

      // Débordement horizontal du document entier : vérifié par mutation (injection d'un
      // élément de 3000px de large dans <body>) — l'assertion échoue bien dans ce cas
      // (`Received: true`), donc ce garde-fou est réellement discriminant (cf. rapport).
      const overflowH = await page.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth)
      expect(overflowH, `débordement horizontal à ${viewport}px`).toBe(false)
    })
  }
})

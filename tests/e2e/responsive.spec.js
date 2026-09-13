// Garde de non-régression sur la largeur (adaptation à la largeur de l'appareil,
// 25/07). Deux garanties distinctes :
//   1. le contenu ne dépasse JAMAIS la fenêtre (sinon la page glisse latéralement) ;
//   2. sur tablette, le contenu s'élargit vraiment au lieu de rester bloqué à 480 px.
// Les deux sont couvertes par ce fichier : la 1re par le bloc « petit téléphone » (360px),
// qui mesure scrollWidth vs clientWidth sur plusieurs routes et grilles ; la 2e par les
// blocs tablette, qui vérifient le palier --w-content et le nombre de colonnes des grilles.
import { test, expect } from '@playwright/test'
import { completeOnboarding, setCameraPhoto, seedHeatmapSessions, seedCrochetProject, attendreFinFondu } from './helpers'

const TABLETTE_PORTRAIT = { width: 768, height: 1024 }
const TABLETTE_PAYSAGE = { width: 1024, height: 768 }

test.describe('tablette en portrait', () => {
  test.use({ viewport: TABLETTE_PORTRAIT })

  test('le contenu suit le palier intermédiaire de 720 px', async ({ page }) => {
    await completeOnboarding(page)

    const largeur = await page.locator('main.screen').evaluate((el) => el.getBoundingClientRect().width)

    // Palier `--w-content` à 600px+ : 720px. Avec box-sizing: border-box (reset global),
    // max-width est la largeur totale de l'élément : la valeur mesurée est 720 pile, ni le
    // plafond téléphone (480) ni le plafond tablette paysage (840).
    expect(largeur).toBe(720)
  })
})

test.describe('tablette en paysage', () => {
  test.use({ viewport: TABLETTE_PAYSAGE })

  test("le contenu s'élargit au-delà de l'ancien plafond de 480 px", async ({ page }) => {
    await completeOnboarding(page)

    const largeur = await page.locator('main.screen').evaluate((el) => el.getBoundingClientRect().width)

    // Avant ce lot : 480 px (box-sizing: border-box global fait que max-width EST la largeur
    // totale de l'élément, sans soustraction des marges intérieures). On exige nettement plus.
    expect(largeur).toBeGreaterThan(700)
    // Mais pas toute la largeur : une ligne de texte de 1024 px se lit mal.
    expect(largeur).toBeLessThanOrEqual(840)
  })

  test('le stock de laines affiche plus de 2 colonnes sur tablette', async ({ page }) => {
    await completeOnboarding(page)
    await page.goto('/stash')
    // Le stock est vide à l'onboarding (seul le lecteur de patrons est pré-rempli) : la
    // bascule et la grille elle-même n'existent dans le DOM que si `yarnsStore.yarns.length`
    // (StashView.vue, `<template v-if>`). Sans laine, le test expire au lieu d'échouer sur le
    // nombre de colonnes — défaut du dossier, corrigé ici avec 3 laines.
    for (const colorKey of ['rouge', 'bleu', 'vert']) {
      await page.getByRole('button', { name: /Ajouter une laine/ }).click()
      await page.locator('.addform select').first().selectOption('__other__')
      await page.locator('input[placeholder="Saisis la marque"]').fill('Maison')
      await page.locator(`.palette__sw[aria-label="${colorKey}"]`).click()
      await page.locator('input[placeholder="1"]').fill('1')
      await page.getByRole('button', { name: 'Enregistrer' }).click()
    }

    // Vue grille non active par défaut (StashView.vue: `const grid = ref(false)`).
    await page.getByRole('button', { name: "Changer l'affichage" }).click()

    const colonnes = await page.locator('.ygrid').evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
    )
    expect(colonnes).toBeGreaterThan(2)
  })

  test('les quatre bandes du lecteur restent alignées entre elles', async ({ page }) => {
    await completeOnboarding(page)
    // Patron SANS diagramme : depuis l'introduction du lecteur à deux volets, un patron AVEC
    // diagramme ouvrirait le volet épinglé sur cette même tablette en paysage (900×500 est
    // franchi), ce qui rétrécit intentionnellement le fil pour laisser la place au volet —
    // cas déjà couvert par tests/e2e/reader-split.spec.js. Ici on veut l'invariant général
    // (les 4 bandes du lecteur restent alignées ET élargies au plafond tablette), qui ne
    // concerne que le lecteur SANS volet. Le projet démo (tuile « Reprendre ») est
    // maintenant lié à « Bonnet Torsade », qui A un diagramme — on passe donc par
    // « Écharpe Nuage » (bibliothèque), seedée sans diagramme, plutôt que par la tuile.
    await page.goto('/library')
    await page.getByRole('button', { name: 'Écharpe Nuage' }).click()
    await expect(page).toHaveURL(/\/pattern\/\d+/)
    await page.getByRole('button', { name: /Créer un projet/ }).click()
    await page.locator('#name').fill('Test Écharpe')
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page).toHaveURL(/\/project\/\d+/)
    await page.getByRole('button', { name: /Suivre le patron/ }).click()
    await expect(page).toHaveURL(/\/project\/\d+\/read/)
    // Fondu d'entrée des écrans : la `page.evaluate` de mesure ne sait pas
    // attendre — attendre la fin du fondu d'opacité, sinon elle lit un lecteur pas encore
    // (ou à peine) monté et `.rhdr` ressort null.
    await attendreFinFondu(page)
    await expect(page.locator('.rpane')).toHaveCount(0)

    const largeurs = await page.evaluate(() =>
      ['.rhdr', '.rhdr__prog', 'main.screen', '.actionbar'].map((sel) => {
        const el = document.querySelector(sel)
        return { sel, w: el ? Math.round(el.getBoundingClientRect().width) : null }
      }),
    )

    // Aucun sélecteur ne doit être introuvable : sinon le test ne mesurerait rien.
    for (const { sel, w } of largeurs) expect(w, `${sel} introuvable`).not.toBeNull()

    // `box-sizing: border-box` est global (tokens.css:179, sélecteur `*`) : les quatre
    // bandes ont des marges intérieures différentes mais la même largeur extérieure, donc
    // les comparer directement est légitime.
    // Toutes identiques, et toutes élargies au-delà de l'ancien plafond.
    const distinctes = new Set(largeurs.map((l) => l.w))
    expect(distinctes.size, `largeurs mesurées : ${JSON.stringify(largeurs)}`).toBe(1)
    expect(largeurs[0].w).toBeGreaterThan(700)
  })

  test('la bibliothèque affiche les patrons sur 2 colonnes sur tablette', async ({ page }) => {
    await completeOnboarding(page)
    await page.goto('/library')
    await expect(page.locator('.pcard').first()).toBeVisible()

    // Deux cartes côte à côte ont le même haut ; empilées, elles ne l'ont pas.
    const hauts = await page.locator('.pcard').evaluateAll((els) =>
      els.slice(0, 2).map((el) => Math.round(el.getBoundingClientRect().top)),
    )
    expect(hauts.length, 'il faut au moins 2 patrons de démo').toBe(2)
    expect(hauts[0]).toBe(hauts[1])
  })
})

const PETIT_TELEPHONE = { width: 360, height: 640 }

test.describe('petit téléphone', () => {
  test.use({ viewport: PETIT_TELEPHONE })

  test('le formulaire de projet ne déborde pas de la fenêtre', async ({ page }) => {
    await completeOnboarding(page)
    await page.goto('/project/new')
    await expect(page.locator('#name')).toBeVisible()

    const { contenu, fenetre, coupables } = await page.evaluate(() => {
      // `document.documentElement.clientWidth`, pas `window.innerWidth` : sous émulation
      // mobile (Pixel 5, deviceScaleFactor 2.75), `innerWidth` s'aligne silencieusement sur
      // le contenu qui déborde et ne peut donc plus servir de référence — la même page
      // rapporte alors 395 pour les deux valeurs comparées, masquant le débordement.
      // `clientWidth` reste, lui, fixé à la largeur réelle de l'appareil (360). Même
      // convention que `stash-recap-overflow.spec.js`.
      const iw = document.documentElement.clientWidth
      const coupables = []
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.width && r.right > iw + 1) {
          coupables.push(`${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/)[0]}`)
        }
      })
      return { contenu: document.documentElement.scrollWidth, fenetre: iw, coupables: [...new Set(coupables)] }
    })

    expect(contenu, `éléments qui débordent : ${coupables.join(', ')}`).toBeLessThanOrEqual(fenetre)
  })

  test('les grilles ne débordent pas sur un petit téléphone', async ({ page }) => {
    await completeOnboarding(page)

    // Ancre par route : sans elle, `page.evaluate` peut s'exécuter avant que la page cible
    // ne soit montée (goto() recharge complètement, ce n'est pas une navigation SPA), auquel
    // cas scrollWidth === clientWidth trivialement et l'assertion ne mesure rien — même
    // piège que window.innerWidth signalé en tête de fichier, sous une autre forme.
    const ANCRES = { '/': '.bento', '/stash': 'main.screen' }

    for (const route of ['/', '/stash']) {
      await page.goto(route)
      await expect(page.locator(ANCRES[route])).toBeVisible()
      const { contenu, fenetre } = await page.evaluate(() => ({
        // document.documentElement.clientWidth, pas window.innerWidth : sous émulation
        // mobile, innerWidth s'aligne silencieusement sur le contenu qui déborde et rend
        // l'assertion tautologique (cf. en-tête du fichier et stash-recap-overflow.spec.js).
        contenu: document.documentElement.scrollWidth,
        fenetre: document.documentElement.clientWidth,
      }))
      expect(contenu, `débordement sur ${route}`).toBeLessThanOrEqual(fenetre)
    }
  })

  // Preuve dédiée du garde-fou min(150px, 100%) de .bento (mutation 2). À 360px,
  // .bento reçoit assez de largeur pour que même minmax(150px, 1fr) SANS min() tienne
  // (2 pistes de ~158px tiennent dans les ~328px disponibles) : la régression n'y est donc
  // pas observable en pleine page, quelle que soit la largeur de fenêtre choisie sous ~210px
  // — en dessous, d'autres éléments hors périmètre (button.cta, span.ex-badge) débordent
  // déjà indépendamment de .bento, ce qui rendrait un test plein écran non discriminant.
  // On isole donc le conteneur lui-même via addStyleTag, technique déjà utilisée dans
  // stash-recap-overflow.spec.js pour forcer une tension réelle sans dépendre du viewport.
  test('.bento ne déborde pas même si son conteneur devient plus étroit que 150px', async ({ page }) => {
    await completeOnboarding(page)
    await expect(page.locator('.bento')).toBeVisible()
    await page.addStyleTag({ content: '.bento { width: 100px; }' })

    const overflow = await page.locator('.bento').evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  // Preuve dédiée de la correction du plancher de .pgrid (revue finale, point 1) : à 360px de
  // fenêtre, .screen laisse 328px disponibles. Avant la correction, minmax(min(110px, 100%),
  // 1fr) ne laissait tenir que 2 colonnes (3×110 + 2×8 = 346 > 328) — régression par rapport
  // à l'avant-lot (1fr 1fr 1fr fixe). Avec 100px : 3×100 + 2×8 = 316 ≤ 328 (3 colonnes
  // tiennent) et 4×100 + 3×8 = 424 > 328 (pas de 4e colonne). 4 photos (plus que les 3
  // colonnes attendues) pour que la mesure ne dépende pas du comportement de collapse des
  // pistes vides d'auto-fit sur un nombre d'éléments inférieur au nombre de colonnes.
  test('la galerie photo du projet garde 3 colonnes sur un petit téléphone', async ({ page }) => {
    await completeOnboarding(page)
    await page.goto('/library')
    await page.getByRole('button', { name: 'Bonnet Torsade' }).click()
    await page.getByRole('button', { name: /Créer un projet/ }).click()
    await page.locator('#name').fill('Test galerie')
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page).toHaveURL(/\/project\/\d+/)

    await page.getByRole('tab', { name: 'Galerie' }).click()
    await setCameraPhoto(page)
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole('button', { name: 'Ajouter une photo' }).click()
    }

    const pgrid = page.locator('.pgrid')
    await expect(pgrid.locator('.pthumb')).toHaveCount(4)
    const colonnes = await pgrid.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length,
    )
    expect(colonnes).toBe(3)
  })
})

// Preuve dédiée du garde-fou min(320px, 100%) là où il porte vraiment (revue finale, point 4).
// Le test du garde-fou sur .bento (plancher 150px) ne peut pas être discriminant à une largeur
// réaliste : à 320px de fenêtre (288px disponibles), .group__list (HomeView) et .list
// (LibraryView), plancher 320px, sont les deux grilles où minmax(320px, 1fr) SANS min()
// déborderait réellement (320 > 288, débordement de 32px). Aucun autre bloc de ce fichier ne
// descend sous 360px : sans celui-ci, retirer le min() de .list passerait vert partout ailleurs.
test.describe('petit téléphone 320px (plancher 320 des grilles)', () => {
  test.use({ viewport: { width: 320, height: 640 } })

  test('accueil et bibliothèque ne débordent pas', async ({ page }) => {
    await completeOnboarding(page)

    // Un projet est nécessaire pour que .group__list existe dans le DOM (HomeView.vue,
    // `v-if="!groups.length"` sinon). La bibliothèque, elle, a déjà des patrons de démo.
    await page.goto('/library')
    await page.getByRole('button', { name: 'Bonnet Torsade' }).click()
    await page.getByRole('button', { name: /Créer un projet/ }).click()
    await page.locator('#name').fill('Test 320px')
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page).toHaveURL(/\/project\/\d+/)

    for (const route of ['/', '/library']) {
      await page.goto(route)
      const ANCRES = { '/': '.group__list', '/library': '.list' }
      await expect(page.locator(ANCRES[route]).first()).toBeVisible()
      // document.documentElement.clientWidth, jamais window.innerWidth : sous émulation
      // mobile, innerWidth s'aligne silencieusement sur le contenu qui déborde et rend
      // l'assertion tautologique (cf. en-tête du fichier et stash-recap-overflow.spec.js).
      const { contenu, fenetre } = await page.evaluate(() => ({
        contenu: document.documentElement.scrollWidth,
        fenetre: document.documentElement.clientWidth,
      }))
      expect(contenu, `débordement sur ${route}`).toBeLessThanOrEqual(fenetre)
    }
  })
})

const TELEPHONE_COURANT = { width: 412, height: 915 }

test.describe('téléphone courant', () => {
  test.use({ viewport: TELEPHONE_COURANT })

  test("le titre du bandeau d'aide de la correction tient sur une ligne", async ({ page }) => {
    await completeOnboarding(page)
    await page.goto('/library')
    await page.getByRole('button', { name: 'Bonnet Torsade' }).click()
    await expect(page).toHaveURL(/\/pattern\/\d+/)
    const id = page.url().match(/\/pattern\/(\d+)/)[1]
    await page.goto(`/pattern/${id}/correct`)

    // Tâche B (aide accolades + hiérarchie des titres) : le titre est passé de
    // <span> à <h2> (cf. CorrectionHelp.vue) pour combler le saut H1 (AppHeader) -> H3
    // (corps de l'aide) qu'un lecteur d'écran annonçait — le sélecteur suit.
    const titre = page.locator('.help__summary-title', { hasText: 'Comment corriger le patron' })
    await expect(titre).toBeVisible()

    const { hauteur, largeur, icones } = await page.evaluate(() => {
      const sommaire = document.querySelector('.help__summary')
      const label = [...sommaire.children].find((e) => !e.classList.contains('app-icon'))
      return {
        hauteur: Math.round(label.getBoundingClientRect().height),
        largeur: Math.round(label.getBoundingClientRect().width),
        icones: [...sommaire.querySelectorAll('.app-icon')].map((e) => Math.round(e.getBoundingClientRect().width)),
      }
    })

    // Une ligne de texte fait ~23px ; trois lignes en font ~68.
    expect(hauteur, `titre ${largeur}×${hauteur}, icônes ${icones.join(' et ')} px`).toBeLessThan(40)
    // Les icônes ne doivent pas s'étirer : une icône de 18px doit rester petite.
    for (const w of icones) expect(w).toBeLessThan(40)
  })
})

// Garde dédiée au sélecteur de langue (liste déroulante, retour ergonomie device du 29/07 —
// remplace la bascule à 4 boutons du même jour, jugée trop encombrante en usage sur Nexus 7,
// deux rangées de deux boutons). L'écran de référence fait 480px de large (`--w-content` sous
// le palier 600px, tokens.css) ; 320px est le plancher déjà établi ailleurs dans ce fichier.
//
// Les gardes « 2 boutons par rangée » de l'ancienne bascule (offsetTop comparés) n'ont plus
// d'objet : un `<select>` natif n'occupe jamais plus d'une ligne visible, quel que soit le
// nombre ou la longueur de ses options — elles ne s'affichent que dans la liste OUVERTE, un
// dialogue rendu par l'OS et hors de portée de la mesure DOM. Supprimées avec la bascule.
//
// La garde anti-débordement, elle, garde tout son sens : rien n'empêche a priori un `<select>`
// de déborder de son conteneur — measure sur l'ÉLÉMENT LUI-MÊME (scrollWidth vs clientWidth),
// jamais sur window.innerWidth (piège documenté en tête de fichier).
// ⚠️ Piège mesuré en écrivant ce test : forcer une largeur CSS fixe plus grande sur le
// `<select>` (ex. `width: 400px` alors que son conteneur ne fait que 200px) NE fait PAS
// rougir `scrollWidth - clientWidth` sur l'élément lui-même — un `<select>` fermé n'a pas de
// contenu interne qui déborde de sa propre boîte du seul fait d'une largeur imposée ; c'est le
// CONTENEUR PARENT qui déborderait, pas le select. Vérifié par mutation, résultat nul (0),
// sur les deux vues. Ce qui FAIT rougir la mesure sur l'élément lui-même, c'est un libellé
// d'option plus large que la largeur réellement disponible du select : mutation du libellé
// `fr` (constants/languages.js, langue par défaut donc affichée sans interaction) allongé
// artificiellement, rejouée sur les 4 tests ci-dessous : les 4 rougissent, débordement mesuré
// 233px à 480px et 393px à 320px (mêmes valeurs sur les deux vues, même CSS `select.input`
// partagé) ; libellé restauré, les 4 repassent au vert.
// ⚠️ Piège d'outillage rencontré en vérifiant cette mutation : `playwright.config.js` a
// `reuseExistingServer: !process.env.CI` — si un serveur de preview tourne déjà sur le port
// configuré (5173) d'un run précédent, Playwright le RÉUTILISE sans rebuild et une mutation
// de code passe inaperçue (rejouée au vert alors que le code réellement servi est l'ancien).
// Toujours vérifier qu'aucun process n'écoute déjà sur ce port avant de fier un résultat de
// mutation à ce fichier.
for (const largeur of [480, 320]) {
  test.describe(`sélecteur de langue (${largeur}px)`, () => {
    test.use({ viewport: { width: largeur, height: 900 } })

    test(`le sélecteur de langue de l'onboarding ne déborde pas à ${largeur}px`, async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Bienvenue sur Rowtine' })).toBeVisible()

      const select = page.locator('[data-test="onb-language"]')
      await expect(select).toBeVisible()
      const overflow = await select.evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(overflow, 'débordement du sélecteur de langue (onboarding)').toBeLessThanOrEqual(0)
    })

    test(`le sélecteur de langue des réglages ne déborde pas à ${largeur}px`, async ({ page }) => {
      await completeOnboarding(page)
      await page.goto('/settings')

      const select = page.locator('[data-test="language-select"]')
      await expect(select).toBeVisible()
      const overflow = await select.evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(overflow, 'débordement du sélecteur de langue (réglages)').toBeLessThanOrEqual(0)
    })
  })
}

const TELEPHONE_PAYSAGE = { width: 844, height: 390 }

test.describe('téléphone en paysage', () => {
  test.use({ viewport: TELEPHONE_PAYSAGE })

  test("la puce « Revenir à mon étape » n'est pas recouverte par la barre d'action", async ({ page }) => {
    await completeOnboarding(page)
    await page.goto('/library')
    await page.getByRole('button', { name: 'Bonnet Torsade' }).click()
    await page.getByRole('button', { name: /Créer un projet/ }).click()
    await page.locator('#name').fill('Test paysage')
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await page.getByRole('button', { name: /Suivre le patron/ }).click()
    await expect(page).toHaveURL(/\/project\/\d+\/read/)

    // La puce est visible dès l'ouverture : `currentStepId` (ReaderView.vue:334) vaut la
    // première étape de rang NON cochée, donc il y en a toujours une sur un patron neuf.
    await expect(page.locator('.chip--resume')).toBeVisible()

    const mesure = await page.evaluate(() => {
      const p = document.querySelector('.chip--resume').getBoundingClientRect()
      const b = document.querySelector('.actionbar').getBoundingClientRect()
      return { basPuce: Math.round(p.bottom), hautBarre: Math.round(b.top) }
    })

    expect(
      mesure.basPuce,
      `bas de la puce ${mesure.basPuce}px, haut de la barre ${mesure.hautBarre}px`,
    ).toBeLessThanOrEqual(mesure.hautBarre)
  })
})

// Date de fin sur la tuile (§7quater) : mesure dédiée à 360px, dans les 4
// langues, sur le cas le plus défavorable — cinq étoiles (icônes à droite) + nom long +
// taille active + date de fin, tout dans la même ligne `.pcard__meta` (flex,
// justify-content: space-between). Le préfixe allemand court (« Fertig am », pas
// « Fertiggestellt am ») a été choisi pour cette raison (cf. rapport de tâche).
//
// Le montage passe par l'UI EN FRANÇAIS (complet, une seule fois : `completeOnboarding` et
// les libellés du formulaire de projet sont câblés en dur en français, cf. son commentaire
// d'en-tête) puis bascule la LANGUE D'AFFICHAGE via /settings pour chaque mesure — le nom du
// projet n'est pas traduit, il reste le même ancre `.pcard` dans les 4 langues.
const PETIT_TELEPHONE_DATE_FIN = { width: 360, height: 800 }
const NOM_PROJET_LONG = 'Pull irlandais à torsades et col montant'

// Préfixe attendu de `project.finishedOn` par langue (sans la date : son format varie avec
// la locale — cf. `formatLocalDate`/`toLocaleDateString` — et n'est pas ce qu'on veut figer
// ici, seulement la preuve que LA LANGUE a bien basculé et que le libellé est bien rendu).
const PREFIXE_TERMINE = { fr: 'Terminé le', en: 'Finished', es: 'Terminado el', de: 'Fertig am' }

test.describe('date de fin sur la tuile (360px, 4 langues)', () => {
  test.use({ viewport: PETIT_TELEPHONE_DATE_FIN });

  test('la ligne meta ne déborde dans aucune des 4 langues', async ({ page }) => {
    await completeOnboarding(page)

    // Projet le plus défavorable pour la ligne meta : nom long, crochet (icônes à droite
    // occupent la même largeur qu'en tricot), taille active, 5 étoiles, date de fin.
    await page.goto('/project/new')
    await page.locator('#name').fill(NOM_PROJET_LONG)
    await page.getByRole('button', { name: 'Crochet', exact: true }).click()
    // Le champ « Tailles » a été retiré de cet écran (11/09, vit désormais sur le patron,
    // corrigé depuis SON écran) : sans patron sélectionné ici, `sizeOptions` est vide et
    // `#asize` reste un `<input>` texte libre (rendu conditionné par `sizeOptions.length`).
    await page.locator('#asize').fill('M')
    await page.locator('#end').fill('2026-07-15')
    await page.getByRole('button', { name: '5 sur 5' }).click()
    await page.getByRole('button', { name: 'Terminé', exact: true }).click()
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(page).toHaveURL(/\/project\/\d+/)

    const resultats = {}
    for (const langue of ['fr', 'en', 'es', 'de']) {
      if (langue !== 'fr') {
        await page.goto('/settings')
        await page.locator('[data-test="language-select"]').selectOption(langue)
      }
      await page.goto('/')

      const carte = page.locator('.pcard', { hasText: NOM_PROJET_LONG })
      await expect(carte).toBeVisible()
      const meta = carte.locator('.pcard__meta')
      // Preuve que la bascule de langue a bien touché CETTE tuile (et pas seulement le
      // reste de l'écran) : sans cette assertion, un débordement à 0 px dans une langue où
      // le libellé ne s'est jamais affiché ne prouverait rien (piège documenté en tête de
      // fichier).
      await expect(meta).toContainText(PREFIXE_TERMINE[langue])

      // ⚠️ Avant de mesurer des PIXELS EXACTS, attendre que les fontes web soient posées
      // (Source Sans 3 / Literata embarquées en .woff2, tokens.css) : chaque `page.goto('/')`
      // recharge le document, donc repart d'une fonte éventuellement non chargée — mesurer
      // pendant que le navigateur dispose encore avec la fonte de substitution décale largeurs
      // et sommets, d'où 2 échecs sur 10 lancements avant les nouvelles polices puis 4 sur 13
      // après (deux tests instables préexistants, observé le 05/09). `document.fonts.ready`
      // est le fait observable (fontes chargées, layout prêt à être relu), pas un délai
      // arbitraire — même philosophie que le `expect.poll` de stats-journal-jours-actifs.spec.js.
      await page.evaluate(async () => { await document.fonts.ready })

      const mesure = await meta.evaluate((el) => ({
        debordement: el.scrollWidth - el.clientWidth,
        hauteur: Math.round(el.getBoundingClientRect().height),
        // Sommets (en Y) des 5 icônes d'étoile : sur UNE seule rangée, les 5 partagent le
        // même sommet. Éclatées (4 sur une rangée, 1 sur la suivante — le défaut mesuré ici
        // avant correctif, dans les 4 langues), la 5e a un sommet différent des 4 premières.
        sommetsEtoiles: [...el.querySelectorAll('.pcard__stars .app-icon')].map((e) =>
          Math.round(e.getBoundingClientRect().top),
        ),
      }))
      resultats[langue] = mesure
    }

    for (const langue of ['fr', 'en', 'es', 'de']) {
      expect(resultats[langue].debordement, `débordement (${langue}) : ${JSON.stringify(resultats)}`).toBeLessThanOrEqual(0)
    }
    // Repli anti-vacuité (cf. commentaire d'en-tête sur le piège du <select> fermé, et rapport
    // de tâche) : un débordement nul ne prouve rien si la ligne s'est simplement enroulée sur
    // 2 lignes au lieu de déborder horizontalement — `scrollWidth - clientWidth` ne voit PAS
    // cet enroulement, et une comparaison des HAUTEURS entre langues ne le voit pas non plus
    // (vérifié par mutation : sans `flex-wrap: wrap` sur `.pcard__meta`, les 5 étoiles
    // éclatent en 2 rangées — 4 puis 1 — à l'IDENTIQUE dans les 4 langues, 34px partout ; le
    // test passait quand même). Le sommet des étoiles, lui, discrimine : sur une seule
    // rangée, les 5 partagent le même sommet.
    for (const langue of ['fr', 'en', 'es', 'de']) {
      const sommets = resultats[langue].sommetsEtoiles
      expect(sommets, `étoiles (${langue}) : ${JSON.stringify(resultats)}`).toHaveLength(5)
      expect(new Set(sommets).size, `étoiles éclatées sur 2 rangées (${langue}) : ${JSON.stringify(resultats)}`).toBe(1)
    }
    // La tuile doit garder la même FORME dans les 4 langues.
    const hauteurs = ['fr', 'en', 'es', 'de'].map((l) => resultats[l].hauteur)
    expect(new Set(hauteurs).size, `hauteurs par langue : ${JSON.stringify(resultats)}`).toBe(1)
  })
})

// Sélecteurs de l'écran Statistiques (fenêtre et technique,
// §4 et §8) : mesure dédiée à 360px, dans les 4 langues.
//
// ⚠️ PIÈGE MESURÉ (revue du 11/08, mutation d'un libellé allemand en un mot très long et
// injecable) : `scrollWidth - clientWidth` d'une CASE reste à 0 quel que soit le libellé, PAR
// CONSTRUCTION — `.toggle__opt { flex: 1 }` n'a pas de `min-width: 0`, donc un bouton flex
// GROSSIT pour épouser son contenu (min-content = la largeur du mot le plus long, insécable en
// allemand) au lieu de le contenir. Le débordement réel se déplace donc D'UN CRAN AU-DESSUS —
// au conteneur `.toggle` (qui, lui, ne grossit pas) puis à la PAGE entière. C'est le même piège
// qu'ailleurs (`scrollWidth - clientWidth` valait 0 alors que la ligne visible débordait,
// parce que le CSS enroulait au lieu de déborder), mais transposé au parent flex plutôt qu'à
// l'enfant. On mesure donc TROIS choses, jamais une seule, sur CHACUN des deux groupes :
//   1. les cases elles-mêmes (débordement et troncature — documentent l'état, mais ne
//      peuvent PAS rougir sur ce mode de rupture précis, cf. ci-dessus) ;
//   2. le conteneur `.toggle` (débordement RÉEL si les cases grossissent au-delà de la place
//      disponible) ;
//   3. la PAGE entière (`document.documentElement.scrollWidth` vs `.clientWidth`, jamais
//      `window.innerWidth` — piège documenté en tête de fichier, aliasing sous émulation
//      mobile) : c'est le symptôme que l'utilisatrice subit réellement.
// Une garde contre l'ENROULEMENT (une case sur 2 lignes) complète le tableau : comparaison des
// HAUTEURS entre les cases d'une même langue et entre les 4 langues (idiome de la mesure
// « date de fin sur la tuile », qui comparait le sommet des étoiles pour la même
// raison — ici, l'équivalent est la hauteur de la case).
//
// ⚠️ DEUX GROUPES `.toggle` coexistent désormais (période, puis technique juste sous) :
// un sélecteur `.toggle`/`.toggle__opt` non qualifié devient AMBIGU (4 + 3 = 7 cases). On scope
// donc chaque mesure au groupe voulu par sa POSITION (`nth(0)` = période, `nth(1)` = technique),
// et on mesure le second groupe avec le même protocole que le premier : il porte le même risque
// de débordement (mot le plus long : « Ganchillo » en espagnol, « Knitting »/« Stricken » en
// anglais/allemand), même si sa rangée de 3 cases (contre 4) lui laisse plus de place chacune.
const PETIT_TELEPHONE_STATS = { width: 360, height: 800 }
// Libellés longs attendus, dans l'ordre du sélecteur (Mois, Trimestre, Semestre, Année) —
// cf. src/i18n/{fr,en,es,de}.json, clé stats.period.*.
const LIBELLES_PERIODE = {
  fr: ['Mois', 'Trimestre', 'Semestre', 'Année'],
  en: ['Month', 'Quarter', 'Half-year', 'Year'],
  es: ['Mes', 'Trimestre', 'Semestre', 'Año'],
  de: ['Monat', 'Quartal', 'Halbjahr', 'Jahr'],
}
// Libellés attendus du filtre technique, dans l'ordre (Tout, Tricot, Crochet) — cf.
// src/i18n/{fr,en,es,de}.json, clés stats.technique.all et technique.{knitting,crochet}
// (réutilisées telles quelles, cf. ProjectCard).
const LIBELLES_TECHNIQUE = {
  fr: ['Tout', 'Tricot', 'Crochet'],
  en: ['All', 'Knitting', 'Crochet'],
  es: ['Todo', 'Punto', 'Ganchillo'],
  de: ['Alle', 'Stricken', 'Häkeln'],
}
// Libellés attendus des DEUX ONGLETS (Calendrier, Rythme), tâche D (11/08) — cf.
// src/i18n/{fr,en,es,de}.json, clé stats.tab.*. Troisième groupe de boutons de l'écran, à
// mesurer avec le MÊME protocole que les deux `.toggle` ci-dessus (piège déjà mesuré deux fois
// sur ce lot, tâches 4 et 5 : une case flex sans `min-width: 0` grossit au lieu de déborder).
const LIBELLES_TABS = {
  fr: ['Calendrier', 'Rythme'],
  en: ['Calendar', 'Rhythm'],
  es: ['Calendario', 'Ritmo'],
  de: ['Kalender', 'Rhythmus'],
}
// Titre traduit de l'écran Réglages (clé nav.settings) : sert de PREUVE que la bascule de
// langue a réellement abouti avant de quitter la page — `setLocale` (SettingsView.vue) attend
// une écriture Dexie (`await settings.saveProfile`) avant de faire suivre `i18n.global.locale` ;
// naviguer vers /stats immédiatement après `selectOption()` peut donc gagner la course contre
// cette écriture et laisser la page suivante dans l'ANCIENNE langue (piège rencontré en
// écrivant ce test : la mesure « de » reprenait silencieusement les valeurs « es »).
const TITRE_REGLAGES = { fr: 'Réglages', en: 'Settings', es: 'Ajustes', de: 'Einstellungen' }

test.describe('sélecteurs de la page statistiques (360px, 4 langues)', () => {
  test.use({ viewport: PETIT_TELEPHONE_STATS })

  test('les cases des TROIS groupes (période, technique, onglets) ne débordent, ne tronquent ni ne s’enroulent dans aucune des 4 langues', async ({ page }) => {
    await completeOnboarding(page)
    // Les onglets (`.tabs`) ne rendent QUE si `hasAnyActivity` — sans aucune activité, l'écran
    // affiche son état vide et le troisième groupe n'existe pas du tout à mesurer.
    await seedHeatmapSessions(page)
    // (11/08) : le 2e groupe (technique) ne rend plus QUE si la bibliothèque contient les
    // DEUX techniques — `completeOnboarding` + `seedHeatmapSessions` ne créent que du tricot.
    // Sans ce témoin, ce test mesurerait un groupe qui n'existe plus.
    await seedCrochetProject(page)

    const resultats = {}
    for (const langue of ['fr', 'en', 'es', 'de']) {
      if (langue !== 'fr') {
        await page.goto('/settings')
        await page.locator('[data-test="language-select"]').selectOption(langue)
        // Attendre que la bascule ait RÉELLEMENT abouti (cf. commentaire ci-dessus) avant de
        // quitter la page — sinon /stats peut s'afficher encore dans la langue précédente.
        await expect(page.getByRole('heading', { name: TITRE_REGLAGES[langue] })).toBeVisible()
      }
      await page.goto('/stats')

      const toggles = page.locator('.toggle')
      await expect(toggles).toHaveCount(2) // période, puis technique
      // Scopé par POSITION (nth) : `.toggle__opt` seul serait ambigu entre les deux groupes.
      await expect(toggles.nth(0).locator('.toggle__opt')).toHaveCount(4)
      await expect(toggles.nth(1).locator('.toggle__opt')).toHaveCount(3)
      await expect(toggles.nth(0)).toBeVisible()
      await expect(toggles.nth(1)).toBeVisible()
      // Troisième groupe (tâche D, 11/08) : les deux onglets Calendrier/Rythme, `.tabs` — une
      // classe DISTINCTE de `.toggle`, jamais réutilisée, pour ne pas rendre `.toggle` ambigu
      // (3 groupes) ni décaler les index `nth()` ci-dessus.
      const tabs = page.locator('.tabs')
      await expect(tabs).toHaveCount(1)
      await expect(tabs.locator('.tab')).toHaveCount(2)
      await expect(tabs).toBeVisible()

      // Une seule capture, au même instant de layout, pour les 3 niveaux de mesure (cf.
      // commentaire d'en-tête : la case, le conteneur, la page), sur les TROIS groupes.
      const mesures = await page.evaluate(() => {
        const mesurerGroupe = (conteneur, selecteurCase) => ({
          cases: [...conteneur.querySelectorAll(selecteurCase)].map((el) => ({
            texte: el.textContent.trim(),
            debord: el.scrollWidth - el.clientWidth,
            tronque: getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth,
            hauteur: Math.round(el.getBoundingClientRect().height),
          })),
          debordConteneur: conteneur.scrollWidth - conteneur.clientWidth,
        })
        const [periode, technique] = [...document.querySelectorAll('.toggle')]
        return {
          periode: mesurerGroupe(periode, '.toggle__opt'),
          technique: mesurerGroupe(technique, '.toggle__opt'),
          onglets: mesurerGroupe(document.querySelector('.tabs'), '.tab'),
          // document.documentElement.clientWidth, jamais window.innerWidth : sous émulation
          // mobile, innerWidth s'aligne silencieusement sur le contenu qui déborde et rend
          // l'assertion tautologique (piège documenté en tête de fichier).
          debordPage: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      })
      resultats[langue] = mesures
    }

    // Repli anti-vacuité : le libellé traduit doit être réellement rendu, pas une case vide
    // (qui ne déborderait ni ne tronquerait jamais faute de contenu).
    for (const langue of ['fr', 'en', 'es', 'de']) {
      expect(
        resultats[langue].periode.cases.map((m) => m.texte),
        `libellés période (${langue}) : ${JSON.stringify(resultats)}`,
      ).toEqual(LIBELLES_PERIODE[langue])
      expect(
        resultats[langue].technique.cases.map((m) => m.texte),
        `libellés technique (${langue}) : ${JSON.stringify(resultats)}`,
      ).toEqual(LIBELLES_TECHNIQUE[langue])
      expect(
        resultats[langue].onglets.cases.map((m) => m.texte),
        `libellés onglets (${langue}) : ${JSON.stringify(resultats)}`,
      ).toEqual(LIBELLES_TABS[langue])
    }

    // Aucun débordement, aucune troncature — dans chaque case, des TROIS groupes, dans les 4
    // langues. Ne peut PAS rougir sur le piège décrit en tête de fichier (bouton flex qui
    // grossit plutôt que de déborder ou tronquer) : les deux gardes suivantes (conteneur, page)
    // couvrent ce mode de rupture précis.
    for (const langue of ['fr', 'en', 'es', 'de']) {
      for (const groupe of ['periode', 'technique', 'onglets']) {
        for (const m of resultats[langue][groupe].cases) {
          expect(m.debord, `débordement case ${groupe} (${langue}, "${m.texte}") : ${JSON.stringify(resultats)}`).toBeLessThanOrEqual(0)
          expect(m.tronque, `troncature case ${groupe} (${langue}, "${m.texte}") : ${JSON.stringify(resultats)}`).toBe(false)
        }
      }
    }

    // Débordement du CONTENEUR (`.toggle` ou `.tabs`), des trois groupes : c'est ici que rougit
    // le piège des cases qui grossissent pour épouser un libellé trop long au lieu de le
    // contenir.
    for (const langue of ['fr', 'en', 'es', 'de']) {
      for (const groupe of ['periode', 'technique', 'onglets']) {
        expect(resultats[langue][groupe].debordConteneur, `débordement conteneur ${groupe} (${langue}) : ${JSON.stringify(resultats)}`).toBeLessThanOrEqual(0)
      }
    }

    // Débordement de la PAGE ENTIÈRE : le symptôme final que l'utilisatrice subit réellement
    // (glissement latéral de l'écran), au-delà des trois seuls sélecteurs.
    for (const langue of ['fr', 'en', 'es', 'de']) {
      expect(resultats[langue].debordPage, `débordement de la page (${langue}) : ${JSON.stringify(resultats)}`).toBeLessThanOrEqual(0)
    }

    // Même forme partout, GROUPE PAR GROUPE : les cases d'une même langue ont la même hauteur
    // (aucune ne s'enroule sur 2 lignes alors que ses voisines restent sur 1), et cette hauteur
    // est la MÊME dans les 4 langues (chaque sélecteur garde sa forme quelle que soit la langue
    // active). Les groupes n'ont pas nécessairement la même hauteur ENTRE eux (nombre de cases
    // et paddings différents) — on ne compare donc les hauteurs qu'À L'INTÉRIEUR d'un même
    // groupe, jamais entre « periode », « technique » et « onglets ».
    for (const groupe of ['periode', 'technique', 'onglets']) {
      const toutesLesHauteurs = []
      for (const langue of ['fr', 'en', 'es', 'de']) {
        const hauteurs = resultats[langue][groupe].cases.map((m) => m.hauteur)
        expect(new Set(hauteurs).size, `hauteurs des cases ${groupe} (${langue}) : ${JSON.stringify(resultats)}`).toBe(1)
        toutesLesHauteurs.push(hauteurs[0])
      }
      expect(new Set(toutesLesHauteurs).size, `hauteur par langue (${groupe}) : ${JSON.stringify(resultats)}`).toBe(1)
    }
  })
})

// Boutons d'export (§ Réglages) : mesure dédiée à 360px en allemand — le libellé le plus
// défavorable des trois boutons `.exports .btn` (nav.stash / settings.exportProjects /
// nav.library). « Anleitungen » (nav.library en allemand) est un mot composé insécable, plus
// long que ses équivalents fr/en/es — même piège qu'ailleurs dans ce fichier (`.toggle__opt`,
// tâches 4/5) : `.exports .btn { flex: 1 }` sans `min-width: 0` fait grossir le bouton pour
// épouser son contenu au lieu de le contenir, et le débordement remonte jusqu'à la PAGE.
const PETIT_TELEPHONE_REGLAGES = { width: 360, height: 700 }

test.describe('boutons export en allemand (360px)', () => {
  test.use({ viewport: PETIT_TELEPHONE_REGLAGES })

  test('Réglages en allemand à 360px : aucun débordement de page', async ({ page }) => {
    await completeOnboarding(page)
    await page.goto('/settings')
    await page.locator('[data-test="language-select"]').selectOption('de')

    // Témoin que la bascule de langue a bien abouti (pas seulement lancée) : le bouton
    // d'export des patrons porte le libellé allemand coupable, « Anleitungen » — sans cette
    // attente, une mesure prise trop tôt lirait encore le français (qui ne déborde pas) et
    // masquerait le défaut (même piège anti-vacuité que le reste du fichier).
    await expect(page.getByRole('button', { name: 'Anleitungen' })).toBeVisible()

    // Fontes web posées avant de mesurer des pixels (Source Sans 3 / Literata, tokens.css) —
    // même garde que « date de fin sur la tuile » ci-dessus.
    await page.evaluate(async () => { await document.fonts.ready })

    // document.documentElement.clientWidth, jamais window.innerWidth : sous émulation mobile,
    // innerWidth s'aligne silencieusement sur le contenu qui déborde et rend l'assertion
    // tautologique (piège documenté en tête de fichier).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
  })
})

// Fusion des deux
// bandeaux collants de ReaderTextEditor.vue (`.rte__controls` + `.cm-retag-toolbar`)
// en un seul conteneur `.rte__bar`.
//
// AVANT ce lot, les deux bandeaux avaient chacun leur propre `top` sticky en
// `calc()`, censés s'accorder mais mesurés en désaccord de 8px (le `gap:
// var(--sp-2)` du conteneur `.rte`, qui reste de l'espace de FLUX réel entre
// les deux bandeaux) : entre les deux `top` mesurés, une fente laisse une
// tranche de texte du patron défiler, hachée, entre deux barres par ailleurs
// opaques. Fusionner en un seul conteneur collant élimine structurellement
// tout accord de `calc()` à maintenir : il n'y a plus qu'un seul `top`.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

test.describe('correction : un seul bandeau collant dans l’éditeur', () => {
  async function openCorrectionEditor(page) {
    await completeOnboarding(page)
    await page.goto('/library')
    await page.getByRole('button', { name: 'Bonnet Torsade' }).click()
    await expect(page).toHaveURL(/\/pattern\/(\d+)/)
    const id = page.url().match(/\/pattern\/(\d+)/)[1]
    await page.goto(`/pattern/${id}/correct`)
    // createCmEditor monte l'éditeur CM6 (et sa barre de requalification) après le
    // montage Vue du composant : attendre que la barre soit dans le DOM avant de
    // mesurer, sinon la mesure peut courir avant elle (flaky sans ce garde-fou).
    await page.waitForSelector('.cm-retag-toolbar')
  }

  // Limite connue de ce test : `elementFromPoint` fait du test de SURVOL (quel nœud
  // occupe ce point dans l'arbre de rendu), pas de la peinture opaque. Une sonde à
  // l'intérieur du rectangle de `.rte__bar` renvoie le wrapper que sa règle
  // `background: var(--bg)` soit posée ou non — si ce fond disparaissait un jour, le
  // texte redeviendrait visible PAR TRANSPARENCE sous le bandeau sans que ce test le
  // détecte (aucun de ces deux tests ne vérifie l'opacité réellement peinte, seulement
  // la structure du DOM/layout aux coordonnées visées).
  test('aucune tranche de texte du patron n’est peinte entre les bandeaux', async ({ page }) => {
    await openCorrectionEditor(page)

    // Défiler pour amener le texte du patron sous les bandeaux collants (là où
    // la fente incriminée se trouvait, entre .rte__controls et .cm-retag-toolbar).
    await page.evaluate(() => window.scrollBy(0, 400))
    // Attendre la stabilisation du scroll/layout (pas d'animation à attendre
    // ici, une frame suffit) avant de mesurer les coordonnées réellement peintes.
    await page.waitForTimeout(200)

    const result = await page.evaluate(() => {
      const hdr = document.querySelector('.hdr')
      const bar = document.querySelector('.rte__bar')
      if (!hdr || !bar) return { error: 'bandeaux introuvables (.hdr ou .rte__bar)' }
      const hdrRect = hdr.getBoundingClientRect()
      const barRect = bar.getBoundingClientRect()
      const xs = [barRect.left + 4, (barRect.left + barRect.right) / 2, barRect.right - 4]
      const hits = []
      let probeCount = 0
      for (let y = Math.ceil(hdrRect.bottom) + 1; y <= Math.floor(barRect.bottom) - 1; y += 2) {
        for (const x of xs) {
          probeCount++
          const el = document.elementFromPoint(x, y)
          if (el?.closest('.cm-content')) hits.push({ x, y })
        }
      }
      return { hits, probeCount }
    })

    expect(result.error).toBeUndefined()
    // Garde-fou contre un balayage silencieusement vide : si `.rte__bar` perdait son
    // `position: sticky` (la régression du 22/07 documentée dans sticky-top.js), son
    // rectangle défilerait hors écran après le scrollBy ci-dessus, `barRect.bottom`
    // tomberait sous `hdrRect.bottom`, la boucle ferait 0 itération, `hits` resterait
    // vide et le test passerait à tort sur le pire scénario possible. Borne basse
    // crédible (pas un simple > 0) : au pas de 2px sur 3 abscisses, un bandeau normal
    // (~150-200px) donne plusieurs dizaines de sondes ; en dessous de 30, le balayage
    // n'a manifestement pas couvert un bandeau réel.
    expect(result.probeCount).toBeGreaterThanOrEqual(30)
    // Mesure du nœud RÉELLEMENT peint à ces coordonnées (pas une valeur CSS
    // déclarée) : sur le code d'avant ce correctif, ce test échoue à y ≈ 140 (dans la
    // fente 136→144 mesurée au banc Playwright) où
    // elementFromPoint renvoie une `.cm-line` du texte du patron.
    expect(result.hits).toEqual([])
  })

  // Invariant dont dépend measureStickyTopHeight() (src/utils/sticky-top.js) : elle
  // prend le MAXIMUM de top+hauteur sur tous les nœuds `position: sticky` de la page
  // pour poser scrollMarginTop (keyboard-avoidance.js). Avec deux bandeaux collants
  // dans l'éditeur, un désaccord entre leurs `top` (comme celui qui a motivé ce lot)
  // resterait invisible à cette mesure tant que les deux valent moins que le vrai
  // bas de l'empilement — un seul bandeau collant dans .rte élimine la classe
  // entière de régression, pas seulement l'instance mesurée par le test A.
  test('un seul bandeau collant dans l’éditeur (.rte)', async ({ page }) => {
    await openCorrectionEditor(page)

    const stickyCount = await page.evaluate(
      () =>
        [...document.querySelectorAll('.rte, .rte *')].filter(
          (el) => getComputedStyle(el).position === 'sticky',
        ).length,
    )
    expect(stickyCount).toBe(1)
  })

  // `.rte__bar--compact`
  // (posée précédemment, sans règle CSS jusqu'ici) rétrécit la barre en mode texte.
  //
  // Test C — le mode texte remonte réellement le curseur.
  // Chaîne complète mesurée (pas une valeur CSS écrite) : mise en page réelle →
  // measureStickyTopHeight() (src/utils/sticky-top.js) → scrollMarginTop, posé par
  // onFocusIn (keyboard-avoidance.js) DANS un requestAnimationFrame — d'où
  // `expect.poll`, jamais une lecture synchrone juste après le clic. Seuil exprimé en
  // ÉCART DE PIXELS (pas en nombre de lignes) : une tâche ultérieure qui changerait la
  // police de l'éditeur changerait un compte de lignes sans changer la justification de
  // ce test.
  //
  // Seuil ABAISSÉ de 40 à 15px (revue finale, constat 2, 2026-08-22) — mécanisme du
  // décalage changé, PAS cassé. Avant le retrait de `.cm-retag-break`, la barre en vue
  // enrichie était TOUJOURS forcée sur 2 lignes sous 600px : passer en mode
  // texte (1 ligne, défilante) faisait alors gagner >40px à coup sûr. `.cm-retag-break`
  // retiré, les 6 puces 44px tiennent DÉJÀ sur 1 ligne en vue enrichie à cette largeur
  // (mesuré, cf. plan) : il n'y a donc plus de « 2 lignes -> 1 ligne » à gagner en soi.
  // Ce qui reste RÉELLEMENT mesuré ici (avec le patron « Bonnet Torsade », dont la
  // 1re ligne est un bloc Aide-mémoire/matériel) : l'indicateur `.cm-retag-ref-type`,
  // rempli sur cette ligne, ENROULE sur sa propre ligne en vue enrichie (`flex-wrap:
  // wrap`, +~23px mesurés) mais reste sur la MÊME ligne, simplement hors champ et
  // défilable, en mode texte (`flex-wrap: nowrap; overflow-x: auto`) — d'où un
  // décalage réel mais plus petit qu'avant. 15px reste une marge de sécurité
  // confortable sous les ~23px mesurés, sans prétendre à une magnitude qui n'existe
  // plus.
  test('le mode texte remonte réellement le curseur (scrollMarginTop)', async ({ page }) => {
    await openCorrectionEditor(page)

    // Clic souris réel dans le texte (pas les flèches clavier de l'éditeur) : c'est lui
    // qui déclenche le vrai `focusin` mesuré par keyboard-avoidance.js.
    await page.locator('.rte__host .cm-line').first().click()

    const readScrollMarginTop = () =>
      page.evaluate(() => parseFloat(document.querySelector('.cm-content')?.style.scrollMarginTop || '0'))

    await expect.poll(readScrollMarginTop).toBeGreaterThan(0)
    const before = await readScrollMarginTop()

    // ⚠️ Séquencement fragile à la relecture, cf. le commentaire posé près
    // d'onToggleCode (ReaderTextEditor.vue) : ce clic déclenche `codeMode.value = true`
    // PUIS `setKeyboard(true)` (blur()+focus()) — un `focusin` synchrone repart donc
    // AVANT que Vue ait patché le DOM avec `rte__bar--compact`. `onFocusIn` diffère sa
    // mesure d'un `requestAnimationFrame` (après la file de microtâches, donc après le
    // patch Vue) : la mesure ci-dessous voit bien la barre déjà compacte, mais UNIQUEMENT
    // parce qu'on repasse par `expect.poll` plutôt que par une lecture immédiate.
    await page.getByRole('button', { name: 'Modifier le texte' }).click()

    await expect.poll(readScrollMarginTop).toBeLessThan(before - 15)
  })

  // Test D — la barre compacte tient sur une ligne et défile vraiment.
  // Revue : `scrollWidth > clientWidth` reste vrai même avec
  // `overflow-x: hidden` — l'overflow existe toujours, seul le GESTE de défilement
  // disparaît. Une régression qui retirerait `overflow-x: auto` en gardant
  // `flex-wrap: nowrap` laisserait ce test vert alors que « Section » et « Texte »
  // deviendraient inatteignables au doigt — exactement le défaut que cette tâche
  // existe pour éviter.
  // ⚠️ Piège #1 mesuré en écrivant ce test : un aller-retour sur `el.scrollLeft = 200`
  // suivi d'une relecture NE PROUVE RIEN ici — vérifié au banc (script jetable),
  // Chromium applique l'écriture PROGRAMMATIQUE de `scrollLeft` même sous
  // `overflow-x: hidden` (seul le geste UTILISATEUR — molette/glissé tactile — est
  // bloqué). La preuve retenue est donc un VRAI geste de molette
  // (`page.mouse.wheel`, même mécanisme que `reader.spec.js`) positionné sur la
  // barre, pas une écriture directe de propriété : sous `hidden`, `scrollLeft`
  // reste à 0 après un `mouse.wheel(200, 0)` réel (vérifié au banc) ; sous `auto`,
  // il bouge. C'est ce geste-là, pas une assignation JS, que ferait une
  // utilisatrice en glissant le doigt.
  // ⚠️ Piège #2 (revue, 2e passe) : `page.mouse.move(x, y)` avec des
  // coordonnées calculées à la main (`boundingBox()` + moitié largeur/hauteur) NE
  // SUFFIT PAS ici — mesuré : le geste molette qui suit échouait de façon
  // DÉTERMINISTE (5/5, sur CE test précis, y compris rejoué sur un commit antérieur
  // à toute modification de cette tâche — donc un piège du GESTE, pas du CSS) après
  // avoir lu `scrollWidth`/`clientWidth` juste avant. `locator.hover()` (utilisé
  // ci-dessous) refait le même déplacement mais avec les vérifications
  // d'actionabilité de Playwright (élément stable, réellement récepteur des
  // évènements pointeur à cet endroit) — remplace `mouse.move` de façon fiable
  // (5/5 sur ce même test, rejoué). Lequel des deux réglages exacts de Chromium
  // est en cause n'a pas été identifié plus précisément ; la CORRECTION, elle, est
  // vérifiée par la mesure, pas supposée.
  test('la barre compacte (mode texte) tient sur une ligne et défile vraiment', async ({ page }) => {
    await openCorrectionEditor(page)

    await page.getByRole('button', { name: 'Modifier le texte' }).click()
    await expect(page.locator('.rte__bar')).toHaveClass(/rte__bar--compact/)

    const toolbar = page.locator('.cm-retag-toolbar')
    await expect(toolbar).toBeVisible()

    const height = await toolbar.evaluate((el) => el.getBoundingClientRect().height)
    expect(height).toBeLessThan(70)

    const overflows = await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(overflows).toBe(true)

    // Geste de molette RÉEL (pas une assignation `scrollLeft` en JS, cf. Piège #1
    // ci-dessus) au-dessus de la barre — `hover()` plutôt que `mouse.move` à la
    // main (cf. Piège #2 ci-dessus) — puis relecture de ce que le navigateur a
    // effectivement déplacé.
    await toolbar.hover()
    await page.mouse.wheel(200, 0)
    await expect.poll(() => toolbar.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  })

  // Test E — la règle de base (masque statique) reste HORS de la garde `@supports`
  // (revue). Contexte : sans garde, sur une WebView qui ne reconnaît pas
  // `animation-timeline: scroll()`, `animation-timeline` retombe seule sur `auto`
  // (la timeline DOCUMENT) alors que la déclaration `animation`, elle, reste valide
  // et se met à jouer dans le temps : le masque deviendrait opaque une seconde après
  // l'ouverture du mode texte, sans plus AUCUN indice de défilement — pire que
  // l'ancien dégradé permanent. D'où la règle de base inconditionnelle ci-dessous,
  // et `@property`/`@keyframes`/l'animation enveloppés dans
  // `@supports (animation-timeline: scroll(self inline))`.
  // Ce test ne relit PAS juste le `mask-image` calculé : sur le Chromium qui fait
  // tourner cette suite, `@supports` vaut vrai, donc la règle calculée serait un
  // dégradé même si le masque de base avait été déplacé PAR ERREUR dans la garde
  // (rien ne le distinguerait alors). Il inspecte la FEUILLE DE STYLE elle-même :
  // une règle `.cm-retag-toolbar` portant un `mask-image` doit exister au niveau
  // RACINE d'une feuille (pas nichée dans un `CSSSupportsRule`) — une régression
  // qui redéplacerait le masque dans la garde ferait alors tomber ce test, même sur
  // un navigateur qui supporte `animation-timeline: scroll()`.
  test('le masque de défilement de base est une règle inconditionnelle', async ({ page }) => {
    await openCorrectionEditor(page)

    const found = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        let rules
        try {
          rules = sheet.cssRules
        } catch {
          continue // feuille inter-origine illisible (aucune ici, garde-fou seulement)
        }
        for (const rule of rules) {
          // Niveau RACINE uniquement : on ne descend PAS dans les at-rules
          // (@supports, @media…) — c'est justement ce qui distingue « hors garde »
          // de « dans la garde ».
          if (
            rule instanceof CSSStyleRule &&
            rule.selectorText?.includes('cm-retag-toolbar') &&
            rule.selectorText?.includes('rte__bar--compact') &&
            rule.style.maskImage &&
            rule.style.maskImage !== 'none'
          ) {
            return rule.style.maskImage
          }
        }
      }
      return null
    })

    expect(found).not.toBeNull()
    expect(found).toContain('gradient')
  })

  // Test F — le dégradé s'efface RÉELLEMENT au bout du défilement (revue).
  // Preuve du mécanisme retenu (`--fade-a`, animée de 0% à 100% par
  // `animation-timeline: scroll(self inline)` sur les 15 derniers % de la course,
  // cf. bloc `@supports` de ReaderTextEditor.vue) : à 100%, l'extrémité du masque
  // redevient opaque comme le reste, donc plus aucun fondu.
  // Piloté par ÉCRITURE PROGRAMMATIQUE de `scrollLeft` (`el.scrollLeft =
  // el.scrollWidth - el.clientWidth`), pas par un geste de molette : le Test D
  // ci-dessus a DÉJÀ établi, par un vrai geste, que le navigateur laisse
  // effectivement défiler cette barre (distinction `auto`/`hidden`, cf. son
  // commentaire) — pas besoin de la re-prouver ici. Une écriture programmatique de
  // `scrollLeft` déclenche un véritable évènement `scroll` natif (Chromium
  // l'applique et le notifie que ce soit un geste ou une assignation JS, cf. Piège
  // #1 du Test D) : `animation-timeline: scroll()` lit la position de défilement
  // RÉELLE de l'élément, quelle que soit la façon dont elle a été atteinte — la
  // même chaîne de production tourne donc, sans dépendre du minutage d'un
  // défilement natif potentiellement animé/inertiel sous charge.
  test('le dégradé disparaît au bout réel du défilement (scrollLeft programmatique)', async ({ page }) => {
    await openCorrectionEditor(page)

    await page.getByRole('button', { name: 'Modifier le texte' }).click()
    const toolbar = page.locator('.cm-retag-toolbar')
    await expect(toolbar).toBeVisible()

    // Prémisse mesurée AVANT de défiler, ajoutée en même temps que le test G ci-dessous :
    // le fondu doit être PEINT tant qu'il reste du contenu à droite. Sans cette
    // assertion, ce test passerait encore si le fondu était détruit PARTOUT — c'est
    // exactement le mode de panne du correctif de G si l'image-clé `from` explicite
    // venait à disparaître des `@keyframes` — et la barre défilerait de nouveau muette,
    // deux contrôles hors écran et rien qui le signale. Ordre de priorité assumé du lot :
    // un fondu de trop vaut mieux qu'un fondu manquant.
    const overflows = await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(overflows).toBe(true)
    expect(await toolbar.evaluate((el) => el.scrollLeft)).toBe(0)
    expect(
      await toolbar.evaluate((el) => getComputedStyle(el).getPropertyValue('--fade-a').trim()),
    ).toBe('0%')

    await toolbar.evaluate((el) => {
      el.scrollLeft = el.scrollWidth - el.clientWidth
    })

    await expect
      .poll(() => toolbar.evaluate((el) => getComputedStyle(el).getPropertyValue('--fade-a').trim()))
      .toBe('100%')
  })

  // Test G — aucun fondu quand il n'y a RIEN à défiler (revue, 3e passe).
  // Régression trouvée à la revue et confirmée par mesure : une timeline
  // `scroll(self inline)` est INACTIVE quand l'élément n'a pas de débordement dans cet
  // axe ; l'animation ne s'applique alors pas et `--fade-a` retombe sur sa valeur
  // DÉCLARÉE. Tant que celle-ci valait 0%, un écran assez large pour que les 6 contrôles
  // tiennent peignait quand même le fondu — un indice qui promet du contenu à droite là
  // où il n'y en a pas, soit le faux indice que toute cette tâche visait à supprimer,
  // simplement déplacé d'un cas à l'autre. Les tests D, E et F asserent tous
  // `overflows === true` avant de continuer : ce cas-là n'était couvert par aucun.
  // Largeur choisie : la barre cesse de déborder à 640 px de viewport (balayage
  // Playwright 360 → 1000 px par pas de 20 px : à 620 px, clientWidth 588 < scrollWidth
  // 591 ; à 640 px, 608 = 608). On prend 800 px, franchement au-delà de la charnière
  // mesurée plutôt qu'assis dessus, pour que ce test ne bascule pas au premier changement
  // de police ou de rembourrage — et sa prémisse `overflows === false` ci-dessous le
  // dirait aussitôt si ça arrivait quand même.
  // `test.use` dans un describe imbriqué plutôt qu'un `setViewportSize` en cours de test :
  // le descripteur Pixel 5 pose `isMobile`, et la page se monte directement à la bonne
  // largeur — pas de redimensionnement en cours de route à faire retomber avant de
  // mesurer. Tout le reste du descripteur (tactile, user agent) est hérité.
  test.describe('barre compacte sur un écran assez large pour la contenir', () => {
    test.use({ viewport: { width: 800, height: 851 } })

    test('aucun dégradé n’est peint quand la barre ne déborde pas', async ({ page }) => {
      await openCorrectionEditor(page)

      await page.getByRole('button', { name: 'Modifier le texte' }).click()
      const toolbar = page.locator('.cm-retag-toolbar')
      await expect(toolbar).toBeVisible()

      // Prémisse, miroir de celle des tests D/E/F : sans elle, ce test passerait à vide
      // le jour où la barre se remettrait à déborder à cette largeur.
      const overflows = await toolbar.evaluate((el) => el.scrollWidth > el.clientWidth)
      expect(overflows).toBe(false)

      // Deux mesures complémentaires : la variable qui pilote le masque, puis le
      // `mask-image` RÉELLEMENT calculé — c'est lui que le moteur peint, et une
      // régression pourrait très bien laisser `--fade-a` juste et casser le masque.
      // Sur le code d'avant ce correctif, `--fade-a` vaut ici 0% et le masque calculé
      // finit sur `rgba(0, 0, 0, 0)` : ce test échoue.
      expect(
        await toolbar.evaluate((el) => getComputedStyle(el).getPropertyValue('--fade-a').trim()),
      ).toBe('100%')
      // Ancrée sur le DERNIER arrêt du dégradé (fin de chaîne) : un simple
      // `toContain('rgb(0, 0, 0)')` passerait quoi qu'il arrive, le PREMIER arrêt étant
      // déjà opaque par construction — ce serait une assertion morte lue comme une preuve.
      const mask = await toolbar.evaluate((el) => getComputedStyle(el).maskImage)
      expect(mask).not.toMatch(/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/)
      expect(mask).toMatch(/rgb\(\s*0,\s*0,\s*0\s*\)\s*\)$/)
    })
  })

  // Tâche B (aide accolades + hiérarchie des titres) — AppHeader pose le <h1> de
  // l'écran, et CorrectionHelp.vue posait directement des <h3> dans son corps déplié : aucun
  // <h2> entre les deux, un lecteur d'écran annonce donc un saut de niveau (1 -> 3). Ni
  // tests/e2e/a11y.spec.js (sa liste ROUTES ne couvre pas /pattern/:id/correct, et il filtre
  // de toute façon les règles de niveau « moderate », dont heading-order) ni aucun autre test
  // existant ne couvre cette route : ce test-ci le fait, en relevant les niveaux RÉELLEMENT
  // rendus dans le DOM, aide dépliée (c'est SON contenu qui posait les <h3> orphelins).
  //
  // Sur le code d'avant ce correctif, la suite relevée est [1, 3, 3] (H1 AppHeader, puis les
  // deux <h3> « À quoi sert chaque catégorie »/« Les blocs Référence » de CorrectionHelp) :
  // ce test échoue avec un écart de 2 entre le 1er et le 2e niveau.
  test('aide dépliée : la hiérarchie des titres ne saute aucun niveau (H1 -> H2 -> H3)', async ({ page }) => {
    await openCorrectionEditor(page)

    await page.locator('.help__summary').click()

    const levels = await page.evaluate(() =>
      [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1])),
    )

    // Garde-fou contre un balayage silencieusement vide (même motif que le test D plus
    // haut, sur `probeCount`) : si le clic ci-dessus cessait un jour d'ouvrir le <details>
    // (regression sur .help__summary ou sur l'attribut `open`), `levels` retomberait à
    // `[1]` (le seul <h1> d'AppHeader) — la boucle ferait 0 itération et ce test passerait
    // à tort sur le pire scénario possible : l'aide jamais dépliée, jamais auditée. Sur le
    // DOM RÉELLEMENT rendu, aide dépliée : H1 (AppHeader) + H2 (résumé) + 3×H3 (corps) = 5.
    expect(levels.length).toBeGreaterThanOrEqual(5)

    expect(levels[0]).toBe(1)
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1)
    }
  })
})

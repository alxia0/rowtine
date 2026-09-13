// Audit UI #13 : finition visuelle de l'éditeur « Corriger le patron » (CM6). Le contenu
// hérite d'un défaut petit (cm-editor.js ne pose aucun fontSize/lineHeight) et les contrôles
// (flèches monter/descendre) sont sous la cible tactile 44px. Ce test lit les styles
// RÉELLEMENT RENDUS (getComputedStyle / getBoundingClientRect), pas la feuille CSS — la
// hauteur de `.cm-line` en particulier ne doit pas dupliquer la valeur `padding-block`
// qu'on vient d'écrire (sinon le test est tautologique) : elle prouve que le texte a
// réellement grossi ET que les lignes se sont aérées à l'écran.
import { test, expect } from '@playwright/test'
import { completeOnboarding, waitForScrollSettled } from './helpers'

const PATTERN = {
  name: 'Correction Visual Test',
  type: 'knitting',
  category: '',
  sizes: [],
  gallery: [],
  photos: [],
  pdf: '',
  reader: {
    sizeLabels: [],
    sections: [
      {
        id: 'corps',
        kind: 'corps',
        title: 'Corps',
        steps: [{ t: 'Monter soixante mailles' }, { t: 'Tricoter en jersey' }],
      },
    ],
  },
}

// Patron dédié à la mesure de l'indicateur d'aide-mémoire (.cm-retag-ref-type) : porte un
// bloc référence Aiguilles/Crochet (le plus LONG des 7 libellés de la barre, cf. fr.json
// correction.toolbar.needles), pour maximiser la marge de preuve. Const SÉPARÉE de PATTERN
// ci-dessus (pas de bloc référence dessus) : les 4 tests existants de ce fichier mesurent
// des positions/hauteurs sur ce patron précis (1re ligne du document, hauteurs de .cm-line),
// un bloc référence en tête décalerait tout et re-validerait leurs assertions pour rien.
const PATTERN_REF = {
  name: 'Correction Visual Test — aide-mémoire',
  type: 'knitting',
  category: '',
  sizes: [],
  gallery: [],
  photos: [],
  pdf: '',
  reader: {
    sizeLabels: [],
    sections: [{ id: 'corps', kind: 'corps', title: 'Corps', steps: [{ t: 'Monter soixante mailles' }] }],
    // -> `## Aiguilles/Crochet {needles}` en Rowtine-MD (referenceBlocksToMd, refblocks.js) :
    // reference.tabs.materiel.blocks routé par h3Key (reference-flat.js) vers flat.needles.
    reference: { tabs: [{ id: 'materiel', blocks: [{ h3Key: 'reader.reference.h3.needles', p: ['4 mm'] }] }] },
  },
}

async function seedPattern(page, pattern) {
  return page.evaluate(async (pat) => {
    const r = indexedDB.open('rowtine')
    return await new Promise((res, rej) => {
      r.onsuccess = () => {
        const db = r.result
        const tx = db.transaction('patterns', 'readwrite')
        const a = tx.objectStore('patterns').add(pat)
        a.onsuccess = () => res(a.result)
        a.onerror = () => rej(a.error)
      }
      r.onerror = () => rej(r.error)
    })
  }, pattern)
}

test('éditeur de correction : contenu ≥16px, lignes aérées, contrôles ≥44px', async ({ page }) => {
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN)
  await page.goto(`/pattern/${id}/correct`)
  const content = page.locator('.rte .cm-content').first()
  await expect(content).toBeVisible()
  // Taille du texte réellement rendue : au moins 16px (l'audit veut « grossir »).
  const fontPx = await content.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(fontPx).toBeGreaterThanOrEqual(16)
  // Police RÉELLEMENT résolue par le moteur (getComputedStyle, pas la feuille CSS) :
  // CodeMirror pose sa propre police par défaut sur `.cm-content` (monospace, une
  // chasse fixe de terminal) — la tricoteuse corrigeait donc son patron dans une
  // typographie différente de celle du lecteur (ReaderView, --font-ui). La règle
  // `.rte .cm-content` doit désormais reprendre --font-ui, et rien de la chaîne
  // résolue ne doit plus mentionner `monospace`.
  const fontFamily = await content.evaluate((el) => getComputedStyle(el).fontFamily)
  expect(fontFamily.toLowerCase()).not.toContain('monospace')
  expect(fontFamily).toContain('Source Sans 3')
  // Aération : on mesure la HAUTEUR RENDUE d'une ligne de l'éditeur (pas la valeur CSS
  // qu'on vient d'écrire — sinon le test est tautologique). Une ligne par défaut CM6
  // (~13px, interligne ~1.4, sans padding) fait ~18px ; à 16px + interligne 1,75 +
  // padding-block 3px×2 elle dépasse ~34px. Le seuil ≥28px ne passe QUE si le texte a
  // réellement grossi ET les lignes se sont aérées à l'écran.
  const lineH = await page.locator('.rte .cm-line').first().evaluate((el) => el.getBoundingClientRect().height)
  expect(lineH).toBeGreaterThanOrEqual(28)
  // Flèches monter/descendre à la cible tactile.
  const up = page.locator('.rte__arrow--up')
  const box = await up.boundingBox()
  expect(box.height).toBeGreaterThanOrEqual(44)
  expect(box.width).toBeGreaterThanOrEqual(44)
})

// Retour device 28/07 : regroupement de la barre en deux lignes équilibrées.
const CONTROLES = ['[data-retag="rang"]', '[data-retag="note"]', '.cm-retag-ref',
                   '.cm-retag-counter', '.cm-retag-section', '[data-retag="texte"]']

// Relève les 6 contrôles ET, si `selEnPlus` est fourni, un élément supplémentaire —
// TOUT dans le MÊME `page.evaluate`, donc dans le même instantané de mise en page.
// Deux `page.evaluate` séparés, même lancés en `Promise.all`, sont deux allers-retours
// distincts vers le navigateur : ils ne sont PAS atomiques et peuvent voir deux positions
// de défilement différentes (défaut réel du 30/07, cf. le test de l'indicateur plus bas).
// Même idiome que `clickAtVisibleOffset` dans correction-editor-keys.spec.js.
async function mesureBarre(page, selEnPlus = null) {
  return page.evaluate(
    ({ sels, selEnPlus }) => {
      const lire = (el) => {
        const r = el.getBoundingClientRect()
        // `bottom` (pas une hauteur codée en dur) : sert au test de l'indicateur d'aide-mémoire
        // ci-dessous, robuste si la cible tactile des contrôles change un jour de hauteur.
        // `x`/`right` : ajoutés pour le même test — détecter un
        // chevauchement RECTANGLE (pas seulement vertical) entre l'indicateur et un contrôle,
        // devenu nécessaire quand Section/Aide-mémoire sont passés de <select> à puce 44px
        // (cf. commentaire du test).
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), right: Math.round(r.right), bottom: Math.round(r.bottom) }
      }
      const rows = sels.map((s) => ({ sel: s, ...lire(document.querySelector(`.cm-retag-toolbar ${s}`)) }))
      const enPlus = selEnPlus ? lire(document.querySelector(selEnPlus)) : null
      return { rows, enPlus }
    },
    { sels: CONTROLES, selEnPlus },
  )
}

// Décrocher diagramme et barre éditeur (28/07) : position verticale de
// chaque contrôle — deux contrôles d'une même ligne partagent leur `y`.
async function rows(page) {
  return (await mesureBarre(page)).rows
}

// Revue finale (constat 2, 2026-08-22) — `.cm-retag-break` RETIRÉ : ce test attendait
// auparavant 2 lignes (« deux lignes groupées sur téléphone »), forcées par ce <span> +
// son CSS. Mesuré Playwright réel (avant retrait) : les 6 puces 44px (6×44 +
// 5 gaps ≈ 284px) tiennent sur UNE SEULE ligne à 360px, sans débordement — plus rien ne
// justifiait la coupure forcée. cf. correction-editor-toolbar-order.spec.js pour la
// preuve que le <span> n'est plus émis.
test('barre de l’éditeur : une seule ligne à 360px (téléphone)', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN)
  await page.goto(`/pattern/${id}/correct`)
  await expect(page.locator('.cm-retag-toolbar')).toBeVisible()
  const r = await rows(page)
  const lignes = [...new Set(r.map((x) => x.y))].sort((a, b) => a - b)
  expect(lignes.length).toBe(1)
  expect(r.map((x) => x.sel)).toEqual(CONTROLES)
  // Rien ne déborde de la fenêtre.
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(over).toBeLessThanOrEqual(0)
})

// Revue finale (constat additionnel, 2026-08-23) — un correctif a resserré la marge
// résiduelle du budget de largeur à 360px (13px -> ~8px). Le
// test ci-dessus (« une seule ligne à 360px ») verrouille déjà ce budget pour les 6
// CONTROLES : vérifié par mutation (script jetable, `padding-left` +6px sur
// `.rte__bar`, simulant un budget dépassé), il échoue bien (`lignes.length` passe de
// 1 à 2, la puce Texte reculant seule à une 2e ligne). Ce qu'AUCUN test ne couvrait
// encore : « Modifier le texte » (.rte__toggle), logé dans un conteneur frère
// (.rte__controls) du même bandeau `.rte__bar`, qui partage pourtant le même budget
// de largeur sans jamais être placé relativement aux 6 puces — un changement localisé
// à `.rte__controls` (pas aux 6 CONTROLES) pourrait déplacer le seul toggle sans que
// le test ci-dessus le voie.
//
// Confirmé par la même mutation (`padding-left` +6px) : le bandeau ne DÉBORDE PAS
// horizontalement quand le budget casse — `.rte__bar` grandit en HAUTEUR au lieu de
// déborder (`scrollWidth === clientWidth` reste à 0 d'écart), même piège que celui
// déjà documenté plus haut pour `.cm-retag-btn-label`. Sous cette mutation précise,
// « Modifier le texte » se recentre verticalement dans le bandeau élargi (y=296), une
// position qui ne coïncide NI avec la ligne des puces restées en place (y=272) NI
// avec celle de la puce repoussée (y=320) : un test `scrollWidth`/`clientWidth` sur
// `.rte__bar` ne l'aurait jamais détecté. On vérifie donc à la place que les 6 puces
// ET « Modifier le texte » partagent tous la MÊME ligne (à l'état actuel, non muté :
// 1 seule ligne ; sous la mutation ci-dessus : 3 lignes distinctes, 272/296/320).
// Comparaison par `y` exact (pas par chevauchement de rectangle) : le toggle est
// centré verticalement (`align-items: center`) tandis que les puces sont positionnées
// par leur ligne de boîte — les deux coïncident tant que toggle et puces partagent la
// même hauteur (44px). Une tâche future qui changerait la hauteur du toggle SEUL
// pourrait faire échouer ce test à tort sans casser la mise en page réelle.
test('barre de l’éditeur : « Modifier le texte » reste sur la même ligne que les 6 puces à 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN)
  await page.goto(`/pattern/${id}/correct`)
  await expect(page.locator('.cm-retag-toolbar')).toBeVisible()
  const { rows: r, enPlus: toggle } = await mesureBarre(page, '.rte__toggle')
  const lignes = [...new Set([...r.map((x) => x.y), toggle.y])]
  expect(lignes.length).toBe(1)
})

// Retour terrain (second tour) — « Modifier le texte » a quitté
// l'extrême gauche de `.rte__bar` pour la FIN du bandeau (après les 6 puces), reprenant la
// place laissée libre par la pastille de type de ligne retirée pour Note. Deux exigences
// mesurées ici, aux deux largeurs de téléphone déjà couvertes par cette suite (360,
// 393) : la cible tactile reste ≥44×44px (le repositionnement ne doit pas la faire rétrécir),
// et le bouton reste atteignable SANS défilement horizontal supplémentaire — `.rte__bar`
// porte `overflow-x: auto` pour la barre de puces (mode compact), un débordement introduit
// par le déplacement pousserait le bouton hors du `scrollLeft` initial (0) sans que rien ne
// le signale visuellement. `scrollWidth <= clientWidth` sur `.rte__bar` lui-même (pas
// seulement `document.documentElement`, déjà vérifié par le test précédent) : c'est le
// conteneur qui défile réellement, un débordement pourrait s'y confiner sans jamais atteindre
// le document.
for (const width of [360, 393]) {
  test(`barre de l’éditeur : « Modifier le texte » ≥44×44px, atteignable sans défilement supplémentaire à ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 })
    await completeOnboarding(page)
    const id = await seedPattern(page, PATTERN)
    await page.goto(`/pattern/${id}/correct`)
    const toggle = page.locator('.rte__toggle')
    await expect(toggle).toBeVisible()
    const box = await toggle.boundingBox()
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)

    const { barOverflow, docOverflow } = await page.evaluate(() => {
      const bar = document.querySelector('.rte__bar')
      return {
        barOverflow: bar.scrollWidth - bar.clientWidth,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    expect(barOverflow).toBeLessThanOrEqual(0)
    expect(docOverflow).toBeLessThanOrEqual(0)
  })
}

// `vitest.config.js` a `css: false` : les tests unitaires
// (cm-editor-toolbar-i18n.spec.js) prouvent seulement que `<span class="cm-retag-btn-label">`
// existe dans le HTML produit, jamais qu'il est PEINT à l'écran. Les 3 boutons Étape/Note/
// Texte sont des carrés 44×44px fixes (cf. ReaderTextEditor.vue, `.cm-retag-toolbar
// button.cm-retag-btn`) : le libellé (10px, gras) est le contenu le plus susceptible d'y
// déborder ou d'être invisible. Mesuré à 360px (la largeur la plus contrainte de cette
// suite) sur les 3 boutons à la fois, dans le MÊME `page.evaluate` (même idiome que
// mesureBarre : un seul aller-retour, un seul instantané de mise en page).
//
// `scrollWidth <= clientWidth` (la formulation naturelle de « pas tronqué ») a été ESSAYÉE
// et REJETÉE : vérifié par mutation (forcer un très long textContent sur le span), le span
// n'a ni `overflow`, ni `white-space: nowrap`, ni `max-width` — un libellé trop long
// s'ENROULE sur plusieurs lignes au lieu de déborder horizontalement, donc `scrollWidth`
// grandit EXACTEMENT comme `clientWidth` et l'assertion ne peut jamais échouer
// (tautologique, cf. piège documenté en tête de fichier). Le vrai symptôme observé lors de
// la mutation : le bouton parent, censé rester un carré 44×44 (cf. commentaire CSS « P4 »),
// s'étire alors à 92px de haut (contre 44px de large, inchangé — seule la largeur est fixée
// en CSS) pour loger le texte enroulé — cassant la mise en page en 2 lignes de la barre. On
// vérifie donc à la place que chaque bouton reste bien un carré (hauteur ≤ largeur, sans
// coder 44 en dur — même principe que `bottom` dans `mesureBarre` : reste correct si la
// cible tactile change un jour) ET que le libellé reste contenu dans ce carré — deux
// mesures qui, elles, ont échoué pendant la mutation (92 > 44) et passent avec les libellés
// réels.
//
// Paramétré sur les 4 langues (même idiome que responsive.spec.js:407 et
// reader-actionbar.spec.js:136) : « Schritt » (DE, 7 caractères) est le plus long des 4
// libellés du bouton Étape (contre « Étape », « Step », « Paso ») — mesuré séparément à
// 31px de large dans le carré 44px, sans s'enrouler. Un test fr-only ne le couvrirait pas.
//
// Repli anti-vacuité (même piège que responsive.spec.js:433, PREFIXE_TERMINE) : sans
// vérifier le texte RÉELLEMENT rendu, un `selectOption` qui ne prendrait pas effet (ou un
// éditeur remonté avant la propagation de la langue) mesurerait 4 fois les mêmes libellés
// FR et le test passerait quand même, malgré son nom. LIBELLES ci-dessous vient de
// src/i18n/{fr,en,es,de}.json (correction.toolbar.step/note/text) — codé en dur ici comme
// PREFIXE_TERMINE, pas dérivé des fichiers i18n, pour que ce test échoue si LEUR contenu
// dérive silencieusement.
const LIBELLES = {
  fr: { rang: 'Étape', note: 'Note', texte: 'Texte' },
  en: { rang: 'Step', note: 'Note', texte: 'Text' },
  es: { rang: 'Paso', note: 'Nota', texte: 'Texto' },
  de: { rang: 'Schritt', note: 'Notiz', texte: 'Text' },
}

test('barre de l’éditeur : le libellé texte des boutons Étape/Note/Texte est réellement peint, non tronqué, dans les 4 langues', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN)

  for (const langue of ['fr', 'en', 'es', 'de']) {
    if (langue !== 'fr') {
      await page.goto('/settings')
      await page.locator('[data-test="language-select"]').selectOption(langue)
    }
    await page.goto(`/pattern/${id}/correct`)
    await expect(page.locator('.cm-retag-toolbar')).toBeVisible()

    const boutons = await page.evaluate(() => {
      const types = ['rang', 'note', 'texte']
      return types.map((type) => {
        const btn = document.querySelector(`.cm-retag-toolbar [data-retag="${type}"]`)
        const label = btn.querySelector('.cm-retag-btn-label')
        const b = btn.getBoundingClientRect()
        const l = label.getBoundingClientRect()
        return {
          type,
          texte: label.textContent,
          display: getComputedStyle(label).display,
          label: { x: l.x, y: l.y, width: l.width, height: l.height, right: l.right, bottom: l.bottom },
          bouton: { width: b.width, height: b.height, x: b.x, y: b.y, right: b.right, bottom: b.bottom },
        }
      })
    })

    expect(boutons.length, `(${langue}) nombre de boutons`).toBe(3)
    for (const { type, texte, display, label, bouton } of boutons) {
      const desc = `${langue}/${type} (${texte})`
      // Preuve que la bascule de langue a bien touché CE bouton (et pas seulement le reste
      // de l'écran) : sans cette assertion, les mesures ci-dessous ne prouveraient rien
      // dans une langue où le libellé ne s'est jamais affiché.
      expect(texte, `${desc} : libellé traduit`).toBe(LIBELLES[langue][type])
      expect(display, `${desc} : display`).not.toBe('none')
      expect(label.width, `${desc} : largeur du libellé`).toBeGreaterThan(0)
      expect(label.height, `${desc} : hauteur du libellé`).toBeGreaterThan(0)
      // Le bouton reste un carré : un libellé qui s'enroule sur 2 lignes le ferait grandir
      // en hauteur (mesuré 92 contre 44 de large pendant la mutation, cf. commentaire
      // ci-dessus) sans jamais réduire sa largeur (fixée en CSS, `width: 44px`).
      expect(bouton.height, `${desc} : le bouton reste carré (hauteur ≤ largeur)`).toBeLessThanOrEqual(bouton.width)
      // Le libellé reste dans le carré de son bouton (ni débordement, ni recouvrement d'un
      // contrôle voisin).
      expect(label.x, `${desc} : libellé dans le bouton (gauche)`).toBeGreaterThanOrEqual(bouton.x)
      expect(label.right, `${desc} : libellé dans le bouton (droite)`).toBeLessThanOrEqual(bouton.right)
      expect(label.y, `${desc} : libellé dans le bouton (haut)`).toBeGreaterThanOrEqual(bouton.y)
      expect(label.bottom, `${desc} : libellé dans le bouton (bas)`).toBeLessThanOrEqual(bouton.bottom)
    }
  }
})

// Même mesure que le test 4-langues ci-dessus (Étape/Note/
// Texte), pour les 3 puces à popover (retagMenuBtn) : Section, Aide-mémoire, Compteur.
//
// Revue finale (constat 1, 2026-08-22) — cette mesure ne portait à l'origine QUE sur
// Compteur, en argumentant que « Compteur »/« Contador » (8 caractères) était le pire
// cas. C'était FAUX : Section et Aide-mémoire portent des libellés plus longs dans
// d'autres langues — DE « Abschnitt » (9 caractères), ES « Referencia » (10
// caractères) — jamais mesurés. Un mot unique qui ne s'enroule pas sur 2 lignes peut
// très bien déborder HORIZONTALEMENT de son carré 44px sans que le test de non-wrap
// (ci-dessus, Étape/Note/Texte) le détecte. Mesuré RÉELLEMENT (Playwright, avant
// correctif, font-size 10px) : ES « Referencia » débordait de 1,5px du carré de la
// puce Aide-mémoire — et EN « Reference »/DE « Abschnitt » tenaient à 0px de marge
// PILE (aucune tolérance). Corrigé en abaissant `.cm-retag-btn-label` à 9px
// (ReaderTextEditor.vue) plutôt qu'en raccourcissant l'i18n : le problème touchait 3
// langues sur 4 pour Aide-mémoire (pas seulement ES), un ajustement CSS unique couvre
// tous les cas sans multiplier les clés de traduction courtes. Remesuré après
// correctif : marge minimale -1px (ES Referencia), tout le reste entre -1 et -9,5px.
//
// Un seul mot par langue pour chaque puce (pas d'espace, contrairement à l'ex-« Aide
// mémoire » avant que labels.referenceChip ne la raccourcisse en FR) : aucun retour à
// la ligne à l'intérieur du libellé n'est attendu, mais SEUL un vrai navigateur peut
// prouver que rien ne déborde du carré 44×44 (jsdom ne calcule aucune mise en page,
// cf. vitest.config.js `css: false`).
const LIBELLES_MENU = {
  '.cm-retag-section': { fr: 'Section', en: 'Section', es: 'Sección', de: 'Abschnitt' },
  '.cm-retag-ref': { fr: 'Mémoire', en: 'Reference', es: 'Referencia', de: 'Referenz' },
  '.cm-retag-counter': { fr: 'Compteur', en: 'Counter', es: 'Contador', de: 'Zähler' },
}

test('barre de l’éditeur : le libellé des puces Section/Aide-mémoire/Compteur est réellement peint, non tronqué, dans les 4 langues', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN)

  for (const langue of ['fr', 'en', 'es', 'de']) {
    if (langue !== 'fr') {
      await page.goto('/settings')
      await page.locator('[data-test="language-select"]').selectOption(langue)
    }
    await page.goto(`/pattern/${id}/correct`)
    await expect(page.locator('.cm-retag-toolbar')).toBeVisible()

    const mesures = await page.evaluate((sels) => {
      return sels.map((sel) => {
        const btn = document.querySelector(`.cm-retag-toolbar ${sel}`)
        const label = btn.querySelector('.cm-retag-btn-label')
        const b = btn.getBoundingClientRect()
        const l = label.getBoundingClientRect()
        return {
          sel,
          texte: label.textContent,
          display: getComputedStyle(label).display,
          label: { x: l.x, y: l.y, width: l.width, height: l.height, right: l.right, bottom: l.bottom },
          bouton: { width: b.width, height: b.height, x: b.x, y: b.y, right: b.right, bottom: b.bottom },
        }
      })
    }, Object.keys(LIBELLES_MENU))

    for (const mesure of mesures) {
      const desc = `${langue}/${mesure.sel} (${mesure.texte})`
      // Preuve que la bascule de langue a bien touché CETTE puce.
      expect(mesure.texte, `${desc} : libellé traduit`).toBe(LIBELLES_MENU[mesure.sel][langue])
      expect(mesure.display, `${desc} : display`).not.toBe('none')
      // La puce reste un carré (hauteur ≤ largeur) : un libellé qui s'enroulerait sur 2
      // lignes la ferait grandir en hauteur (même symptôme que le test Étape/Note/Texte).
      expect(mesure.bouton.height, `${desc} : la puce reste carrée`).toBeLessThanOrEqual(mesure.bouton.width)
      // Le libellé reste dans le carré de sa puce (ni débordement, ni recouvrement d'un
      // contrôle voisin).
      expect(mesure.label.x, `${desc} : libellé dans la puce (gauche)`).toBeGreaterThanOrEqual(mesure.bouton.x)
      expect(mesure.label.right, `${desc} : libellé dans la puce (droite)`).toBeLessThanOrEqual(mesure.bouton.right)
      expect(mesure.label.y, `${desc} : libellé dans la puce (haut)`).toBeGreaterThanOrEqual(mesure.bouton.y)
      expect(mesure.label.bottom, `${desc} : libellé dans la puce (bas)`).toBeLessThanOrEqual(mesure.bouton.bottom)
    }
  }
})

// Revue finale (constat 2, 2026-08-22) — ce test attendait auparavant une coupure
// forcée en 2 lignes à 480px (`.cm-retag-break`, RETIRÉ). Depuis que Compteur est lui
// aussi une puce 44px, les 6 contrôles (6×44 + 5 gaps ≈ 284px) tiennent
// ensemble sur une seule ligne, largement sous les ~450px utiles à cette largeur —
// converti en test « une seule ligne », même idiome que le test tablette (1024px)
// ci-dessous.
test('barre de l’éditeur : une seule ligne à une largeur intermédiaire (480px)', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 740 })
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN)
  await page.goto(`/pattern/${id}/correct`)
  await expect(page.locator('.cm-retag-toolbar')).toBeVisible()
  const r = await rows(page)
  expect(new Set(r.map((x) => x.y)).size).toBe(1)
})

test('barre de l’éditeur : une seule ligne sur tablette', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN)
  await page.goto(`/pattern/${id}/correct`)
  await expect(page.locator('.cm-retag-toolbar')).toBeVisible()
  const r = await rows(page)
  expect(new Set(r.map((x) => x.y)).size).toBe(1)
})

// 1024px passe trivialement (largement au-dessus du seuil) et ne prouve pas grand-chose
// sur la valeur 599.98px elle-même : n'importe quel seuil raisonnable la laisserait
// passer. Ce test pointe pile au-dessus de la charnière — c'est ici que le pari « les 6
// contrôles (510px) tiennent sur une seule ligne dès que la coupure est désactivée »
// est réellement mis à l'épreuve. Mesuré : à 600px, les 6 contrôles partagent bien le
// même `y` (confirmé avant d'écrire ce test).
test('barre de l’éditeur : une seule ligne juste au-dessus du seuil de coupure (600px)', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 740 })
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN)
  await page.goto(`/pattern/${id}/correct`)
  await expect(page.locator('.cm-retag-toolbar')).toBeVisible()
  const r = await rows(page)
  expect(new Set(r.map((x) => x.y)).size).toBe(1)
})

// Correctif initial (revue 28/07) — indicateur d'aide-mémoire (.cm-retag-ref-type, rempli
// quand le curseur est sur une ligne `## … {tag}`) : posé EN DERNIER dans la barre
// regroupée en 2 lignes, un libellé long pourrait le faire déborder sur une 3e ligne.
// MESURÉ à l'époque (Playwright, 360 à 599px, les 7 libellés de référence) : à 360px, le
// libellé le plus long (« Aiguilles/Crochet ») ne tenait pas dans les ~52px restants de la
// 2e ligne (108+100+44+gaps=260 sur 312 dispo) et basculait PROPREMENT sur sa propre 3e
// ligne — comportement verrouillé par ce test à l'époque : indicateur strictement SOUS la
// 2e ligne (`y >= bas de la 2e ligne`).
//
// Révisé — Section/Aide-mémoire sont passés de <select> (100/150px)
// à des puces 44px : la 2e ligne (Compteur 108 + Section 44 + Texte 44 = 196 + gaps) laisse
// désormais ~140px de reste à 360px, largement assez pour « Aiguilles/Crochet » (mesuré :
// l'indicateur reste EN LIGNE après Texte, capture Playwright à l'appui)
// — la prémisse « ne tient pas » de ce test est donc devenue FAUSSE, pas juste sa
// valeur numérique : l'ancienne assertion (`refBox.y >= bas de ligne 2`) échoue non pas parce
// que l'indicateur chevauche un contrôle, mais parce qu'il partage maintenant la même ligne
// qu'eux (y plus PETIT que prévu, pas plus grand). Le VRAI invariant qui comptait — l'un ne
// doit jamais en recouvrir un autre — ne dépend pas de savoir sur QUELLE ligne l'indicateur
// atterrit (ça, c'est un détail d'implémentation qui dépend des largeurs des contrôles
// voisins, appelées à rebouger encore) : on vérifie donc désormais un
// chevauchement RECTANGLE (x ET y) contre chacun des 6 contrôles, qui reste vrai que
// l'indicateur finisse sur la 2e ligne (cas actuel) ou sur une 3e (cas d'une langue au
// libellé encore plus long, ou d'un futur réglage de largeur) — sans jamais coder en dur
// LEQUEL des deux cas doit se produire. Compteur a lui aussi bougé à
// son tour (108px -> 44px) sans qu'il ait fallu toucher à ce
// test : c'était précisément le « futur réglage de largeur » anticipé ci-dessus.
//
// Revue finale (constat 2, 2026-08-22) — `.cm-retag-break` RETIRÉ : les 6 contrôles
// tiennent maintenant sur UNE SEULE ligne (plus 2), l'indicateur passant sur sa PROPRE
// ligne EN DESSOUS quand il est rempli (mesuré Playwright réel : aucun chevauchement,
// aucun débordement). `lignes.length` passe donc de 2 à 1 — l'invariant qui compte
// reste inchangé (le chevauchement rectangle ci-dessous), seul le NOMBRE de lignes des
// 6 contrôles bouge, cohérent avec le reste de la suite après le retrait de la coupure.
test('barre de l’éditeur : l’indicateur d’aide-mémoire ne recouvre jamais un des 6 contrôles, à 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN_REF)
  await page.goto(`/pattern/${id}/correct`)
  await expect(page.locator('.cm-retag-toolbar')).toBeVisible()

  // Curseur sur la ligne `## Aiguilles/Crochet {needles}` (markup masqué en vue enrichie,
  // le titre reste le seul texte visible de la ligne).
  const refLine = page.locator('.rte__host .cm-line').filter({ hasText: 'Aiguilles/Crochet' })
  await expect(refLine).toBeVisible()
  await refLine.click()

  // L'indicateur est bien rempli du libellé de la ligne courante (aria-live, cf. cm-editor.js
  // updateToolbarActive) — sans ça, le reste du test mesurerait un span vide (`:empty` masqué).
  await expect(page.locator('.cm-retag-ref-type')).toHaveText('Aiguilles/Crochet')

  // Le clic vient de donner le focus au `contenteditable` de CodeMirror : depuis le lot
  // « clavier » du 30/07, ce focus déclenche un défilement ANIMÉ (~130 ms) qui décale la
  // barre collante pendant qu'il court (mesuré image par image : la barre passe de 254 à
  // 144). On attend qu'il ait fini AVANT de mesurer — sans quoi la comparaison
  // géométrique ci-dessous porte sur deux instants différents. L'attente ne touche à
  // aucune assertion : elle ne change QUE l'instant du relevé.
  await waitForScrollSettled(page, '.cm-retag-toolbar')
  const { rows: r, enPlus: refBox } = await mesureBarre(page, '.cm-retag-ref-type')
  // Les 6 contrôles principaux restent sur EXACTEMENT 1 ligne (même garde que les tests
  // ci-dessus) : l'indicateur ne doit jamais entraîner un des 6 avec lui sur une 2e ligne.
  const lignes = [...new Set(r.map((x) => x.y))].sort((a, b) => a - b)
  expect(lignes.length).toBe(1)
  // Chevauchement RECTANGLE (x ET y) entre l'indicateur et CHACUN des 6 contrôles : `>=`/`<=`
  // (pas `>`/`<`) pour rester cohérent avec le `w`/`right` mesurés en pixels arrondis — un
  // simple contact bord à bord (0px) n'est pas un chevauchement.
  const chevauche = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y
  for (const controle of r) {
    expect(chevauche(refBox, controle), `indicateur × ${controle.sel}`).toBe(false)
  }

  // Rien ne déborde horizontalement pendant que l'indicateur est rempli (seul risque
  // réel : le test existant à 360px ci-dessus ne le vérifie qu'indicateur VIDE).
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(over).toBeLessThanOrEqual(0)
})

// Le tableau des tailles et celui des abréviations rendus en vraie <table>.
// Les tests unitaires (tests/unit/cm-editor-tableau.spec.js) prouvent le DOM produit par
// CodeMirror ; ils ne peuvent RIEN prouver de la mise en page, jsdom n'ayant pas de moteur
// de rendu. Or c'est précisément là qu'un défaut est apparu en capture : `.cm-lineWrapping`
// (thème de base de @codemirror/view) pose `word-break: break-word` sur tout le contenu, et
// la colonne des abréviations se laissait alors rétrécir jusqu'à couper `dim.` en « di / m. ».
// D'où cette mesure en navigateur réel : largeurs de colonnes plausibles et aucun
// débordement horizontal de la page.
const PATTERN_TABLEAU = {
  name: 'Correction Visual Test — tableaux',
  type: 'knitting',
  category: '',
  sizes: ['S', 'M', 'L'],
  gallery: [],
  photos: [],
  pdf: '',
  reader: {
    sizeLabels: ['S', 'M', 'L'],
    sections: [{ id: 'corps', kind: 'corps', title: 'Corps', steps: [{ t: 'Monter soixante mailles' }] }],
    reference: {
      // -> `## Abréviations {abbreviations}` + sa table (refblocks.js). La 2e définition est
      // volontairement longue : c'est elle qui écrasait la 1re colonne.
      abbrFull: [
        ['dim.', 'diminuer une maille en tricotant deux mailles ensemble a l endroit'],
        ['aug.', 'augmenter une maille'],
      ],
      // -> `## Tailles {measurements}` + sa table à 4 colonnes. Les deux rangées portent les
      // deux formes irrégulières que l'émetteur réel produit et qui ne doivent PAS faire
      // replier le tableau (cf. tableBlockModel, cm-editor.js) : une valeur vide en fin
      // (taille ajoutée non renseignée → `| … | 20 | 21 |  |`) et une rangée plus COURTE que
      // l'en-tête (`referenceBlocksToMd` ne complète jamais, et le recadrage n'a lieu qu'à
      // l'enregistrement) → `| Tour de tete | 52 |` sous 4 colonnes.
      tabs: [
        {
          id: 'tailles',
          blocks: [
            {
              sizeTable: {
                rows: [
                  { label: 'Tour de tete', values: ['52'] },
                  { label: 'Hauteur totale', values: ['20', '21', ''] },
                ],
              },
            },
          ],
        },
      ],
    },
  },
}

test('éditeur de correction : les tableaux sont rendus en vraie <table>, sans mot coupé ni débordement', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 })
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN_TABLEAU)
  await page.goto(`/pattern/${id}/correct`)
  await expect(page.locator('.rte .cm-content').first()).toBeVisible()

  // Les deux blocs à table du patron sont rendus, aucune barre verticale à l'écran.
  const tables = page.locator('.rte table.cm-md-table')
  await expect(tables).toHaveCount(2)
  await expect(page.locator('.rte .cm-content').first()).not.toContainText('|')

  const mesures = await page.evaluate(() => {
    const [abbr, tailles] = [...document.querySelectorAll('.rte table.cm-md-table')]
    // Nombre de LIGNES DE TEXTE réellement dessinées dans une cellule : un Range sur son
    // contenu rend un rectangle par ligne de rendu. Mesure de mise en page authentique —
    // ni la hauteur de la cellule (en tableau, toutes les cellules d'une rangée s'étirent
    // à la plus haute : `dim.` mesurerait la hauteur de sa définition sur 3 lignes), ni
    // `getComputedStyle` (qui ne ferait que relire la règle CSS qu'on vient d'écrire).
    const lignesDessinees = (el) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      return r.getClientRects().length
    }
    return {
      // 1re colonne des abréviations : `dim.` doit tenir sur UNE ligne. Coupé en « di / m. »
      // par le `word-break: break-word` hérité de CodeMirror, il en occuperait deux.
      lignesCleAbbr: lignesDessinees(abbr.querySelector('tbody tr td')),
      // Contre-preuve que la mesure n'est pas triviale : la définition longue, elle, revient
      // BIEN à la ligne (entre les mots) — la cellule voisine occupe plusieurs lignes.
      lignesDefinitionAbbr: lignesDessinees(abbr.querySelectorAll('tbody tr td')[1]),
      // Le tableau des tailles a bien ses 4 colonnes (mesure + 3 tailles).
      colonnesTailles: tailles.querySelectorAll('thead th').length,
      // Les deux rangées irrégulières sont rendues comme rangées, pas repliées en texte…
      rangeesTailles: tailles.querySelectorAll('tbody tr').length,
      // …et la rangée courte est complétée à la largeur de l'en-tête, donc les colonnes
      // restent alignées à l'écran (mesure de mise en page : les bords gauches des cellules
      // de la 1re rangée coïncident avec ceux de la 2e).
      bordsRangee1: [...tailles.querySelectorAll('tbody tr')[0].querySelectorAll('td')].map((c) =>
        Math.round(c.getBoundingClientRect().left)
      ),
      bordsRangee2: [...tailles.querySelectorAll('tbody tr')[1].querySelectorAll('td')].map((c) =>
        Math.round(c.getBoundingClientRect().left)
      ),
      debordement: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(mesures.lignesCleAbbr).toBe(1)
  expect(mesures.lignesDefinitionAbbr).toBeGreaterThan(1)
  expect(mesures.colonnesTailles).toBe(4)
  expect(mesures.rangeesTailles).toBe(2)
  expect(mesures.bordsRangee1).toEqual(mesures.bordsRangee2)
  expect(mesures.debordement).toBeLessThanOrEqual(0)

  // Affordance « rangée du curseur » : les tests unitaires prouvent que la classe est posée
  // au bon endroit ; seul un vrai navigateur peut dire qu'elle PEINT quelque chose (le fond
  // de `th` et la prise en charge de `color-mix` ne se vérifient pas en jsdom). On compare
  // donc deux fonds calculés — celui de la rangée marquée et celui de sa voisine.
  await tables.nth(1).locator('tbody tr').nth(1).locator('td').first().click()
  const marquee = page.locator('.rte table.cm-md-table tr.is-cursor-row')
  await expect(marquee).toHaveCount(1)
  const fonds = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.rte table.cm-md-table')][1]
    const rangees = [...t.querySelectorAll('tbody tr')]
    const fond = (tr) => getComputedStyle(tr.querySelector('td')).backgroundColor
    return { marquee: fond(rangees[1]), voisine: fond(rangees[0]) }
  })
  expect(fonds.marquee).not.toBe(fonds.voisine)
  expect(fonds.marquee).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
})

// Retour terrain (Nexus 7) — vérification VISUELLE (vrai navigateur,
// pas jsdom) nécessaire au départ. Les tests unitaires (cm-menu-popover.spec.js) prouvent
// que le <style> injecté CONTIENT la bonne déclaration CSS, mais `vitest.config.js` a
// `css: false` (cf. commentaire en tête de ce fichier) : aucun test unitaire ne peut prouver
// qu'un vrai navigateur l'applique réellement. Root cause plus large qu'anticipé au départ,
// trouvée en implémentant ce correctif : AVANT lui, un accent grave non échappé dans
// `ensureMenuPopoverStyles` coupait tout le gabarit CSS-en-JS en deux, réduisant
// `style.textContent` à la chaîne littérale "NaN" — AUCUNE règle du popover (fond/bordure/
// padding/coche des items, position du scrim) ne s'appliquait jamais en production, pas
// seulement le fond du scrim relevé initialement (cf. cm-editor.js). Ce test vérifie donc le
// scrim des TROIS popovers (Section/Aide-mémoire/Compteur), et la marque de sélection sur
// Section — même piège de fond-transparent-vacuité que le test de rangée marquée ci-dessus
// (on compare des `getComputedStyle`, pas seulement une classe posée en vain).
test('popover de la barre : scrim assombri sur les 3 popovers + item actif marqué visuellement (Section)', async ({
  page,
}) => {
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN)
  await page.goto(`/pattern/${id}/correct`)
  await expect(page.locator('.cm-retag-toolbar')).toBeVisible()

  const scrimBg = () =>
    page.evaluate(() => getComputedStyle(document.querySelector('.cm-menu-popover-scrim')).backgroundColor)
  const opaque = /rgba\(0, 0, 0, 0\)|transparent/

  await page.locator('.cm-retag-section').click()
  await expect(page.locator('.cm-menu-popover')).toBeVisible()
  expect(await scrimBg()).not.toMatch(opaque)
  // Curseur par défaut en tête de document = 1re ligne = « ## Corps {body} » (PATTERN,
  // section kind:'corps' — cf. sa définition en haut de ce fichier) : l'item « Corps » du
  // popover Section doit porter la marque de sélection, avec un fond RÉELLEMENT distinct
  // d'un item non sélectionné (pas seulement une classe posée sans effet visible).
  const selected = page.locator('.cm-menu-popover__item--selected')
  await expect(selected).toHaveCount(1)
  await expect(selected).toHaveText('Corps')
  const fonds = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.cm-menu-popover__item')]
    const sel = document.querySelector('.cm-menu-popover__item--selected')
    const autre = all.find((b) => b !== sel)
    return { selectionne: getComputedStyle(sel).backgroundColor, autre: getComputedStyle(autre).backgroundColor }
  })
  expect(fonds.selectionne).not.toBe(fonds.autre)
  await page.keyboard.press('Escape')
  await expect(page.locator('.cm-menu-popover')).toHaveCount(0)

  await page.locator('.cm-retag-ref').click()
  await expect(page.locator('.cm-menu-popover')).toBeVisible()
  expect(await scrimBg()).not.toMatch(opaque)
  await page.keyboard.press('Escape')
  await expect(page.locator('.cm-menu-popover')).toHaveCount(0)

  await page.locator('.cm-retag-counter').click()
  await expect(page.locator('.cm-menu-popover')).toBeVisible()
  expect(await scrimBg()).not.toMatch(opaque)
  await page.keyboard.press('Escape')
})

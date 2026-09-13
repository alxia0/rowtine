// Parcours — corriger une ligne sans quitter le suivi (2026-08-20).
// Le test qui compte le plus est le dernier : une séance lancée DANS le lecteur
// donne UNE seule entrée au journal après un aller-retour, pas deux.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

async function openProjectReader(page) {
  await completeOnboarding(page, { firstName: 'Alex' })
  await page.goto('/library')
  await page.getByRole('button', { name: 'Bonnet Torsade' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+/)
  await page.getByRole('button', { name: /Créer un projet/ }).click()
  await page.locator('#name').fill('Test Bonnet')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page).toHaveURL(/\/project\/\d+/)
  await page.getByRole('button', { name: /Suivre le patron/ }).click()
  await expect(page).toHaveURL(/\/project\/\d+\/read/)
}

async function tapFirstCard(page) {
  const card = page.locator('.rstep').first()
  await card.locator('.rstep__body').click()
  await expect(card.locator('.rfix')).toBeVisible()
  return card
}

test('un appui sur une carte propose de la corriger', async ({ page }) => {
  await openProjectReader(page)
  await expect(page.locator('.rfix')).toHaveCount(0) // au repos, rien n’est ajouté
  const card = await tapFirstCard(page)
  // Scopé à la carte : un « Fermer » identique existe aussi sur la feuille
  // « Aide-mémoire » (toujours dans le DOM), page.getByRole('button', { name:
  // 'Fermer' }) sans portée résout donc à deux éléments (mode strict).
  await expect(card.getByRole('button', { name: 'Corriger' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Fermer' })).toBeVisible()
})

test('les deux cibles tiennent le plancher tactile de 56 px', async ({ page }) => {
  // Retouche 2026-08-21 après essai sur Nexus 7 réelle : 44 px (7,0 mm au
  // doigt) n'était que le plancher absolu, pas le confort, et « Corriger » se
  // déclenchait par erreur. Les deux cibles sont passées à 56 px (8,9 mm).
  // `close` n'a plus de largeur imposée (son texte « Fermer » la fixe) : on ne
  // mesure donc plus sa largeur, seulement sa hauteur comme pour « Corriger ».
  await openProjectReader(page)
  // `boundingBox()` ne réattend pas comme les assertions Playwright : deux
  // appels séquentiels après une pose ancienne du voile risqueraient de
  // tomber de part et d'autre d'une fermeture automatique (3 s). `tapFirstCard`
  // pose le voile ICI, juste avant les deux mesures qui suivent — rien
  // d'autre ne s'intercale, le budget de 3 s est donc plein aux deux appels.
  await tapFirstCard(page)
  const fix = await page.locator('.rfix__do').boundingBox()
  const close = await page.locator('.rfix__close').boundingBox()
  expect(fix.height).toBeGreaterThanOrEqual(56)
  expect(close.height).toBeGreaterThanOrEqual(56)
  // Exigence : les deux boutons sont côte à côte, ils DOIVENT garder
  // la même hauteur.
  expect(close.height).toBe(fix.height)
})

test('le voile posé disparaît seul, sans qu’on touche à rien', async ({ page }) => {
  // Fermeture automatique après 3 s d'inactivité (retouche 2026-08-21). On
  // attend la disparition avec une assertion Playwright — jamais un
  // `waitForTimeout(3000)` : le timeout par défaut de `expect` (5 s) dépasse
  // déjà les 3 s, donc `toBeHidden()` porte la preuve à lui seul.
  await openProjectReader(page)
  const card = await tapFirstCard(page)
  await expect(card.locator('.rfix')).toBeHidden()
})

test('poser le voile ne déplace AUCUNE carte', async ({ page }) => {
  await openProjectReader(page)
  const first = page.locator('.rstep').first()
  const second = page.locator('.rstep').nth(1)
  // `offsetTop`/`offsetHeight`, pas boundingClientRect : ce sont des grandeurs
  // de MISE EN PAGE pures, relatives au bloc positionné englobant — jamais
  // affectées par le défilement. Un boundingBox() viewport-relatif, lui,
  // varie avec le scroll déclenché par le clic sur la première carte
  // (Playwright auto-scroll avant un clic), y compris à quelques dixièmes de
  // pixel une fois le défilement « immobilisé » (arrondi de sous-pixel) — un
  // bruit de mesure qui n'a rien à voir avec la carte elle-même.
  const docBox = (loc) => loc.evaluate((el) => ({ y: el.offsetTop, height: el.offsetHeight }))
  await first.scrollIntoViewIfNeeded()
  // Polices prêtes AVANT la mesure « before » : un swap de police (FOUT) entre
  // les deux mesures reflow le texte des cartes indépendamment du voile.
  await page.evaluate(() => document.fonts.ready)
  // L'en-tête « .rhdr » est sticky et bascule en mode compact dès 4px de
  // défilement (ReaderView.vue, HEADER_SCROLL_THRESHOLD) — ce que
  // `scrollIntoViewIfNeeded` vient de déclencher — via une TRANSITION CSS de
  // 220ms (--motion-base) sur son padding/sa taille de police. Sans cette
  // attente, « before » peut être capturé pendant que l'en-tête rapetisse
  // encore : les cartes plus bas se déplacent TOUTES du même delta, à cause de
  // l'en-tête, pas du voile — observé en local (jusqu'à 15px selon l'instant).
  await page.waitForTimeout(300)
  const before = await docBox(second)
  await first.locator('.rstep__body').click()
  await expect(first.locator('.rfix')).toBeVisible()
  const after = await docBox(second)
  expect(after.y).toBe(before.y)
  expect(after.height).toBe(before.height)
})

test('« Corriger » ouvre l’éditeur sur la ligne de la carte', async ({ page }) => {
  await openProjectReader(page)
  const card = page.locator('.rstep').first()
  const text = (await card.locator('.rstep__p').innerText()).trim()
  await card.locator('.rstep__body').click()
  // Scopé à la carte, comme « Fermer » plus haut : sans ça, le jour où l'entrée
  // globale « Corriger le patron » deviendrait visible en contexte projet, le
  // matching en sous-chaîne de `name` viserait le mauvais bouton ou deviendrait
  // ambigu (mode strict).
  await card.getByRole('button', { name: 'Corriger' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/correct\?section=[^&]+&line=\d+$/)
  // `highlightActiveLine` n’est PAS activé dans cet éditeur : il n’existe aucune
  // classe `.cm-activeLine` à interroger. On prouve donc l’effet VISIBLE du
  // geste — la ligne visée est amenée à l’écran. La position réelle du curseur
  // est prouvée unitairement (reveal-line.spec.js, CorrectionView-reveal.spec.js).
  const targetLine = page.locator('.cm-line', { hasText: text.slice(0, 16) }).first()
  await expect(targetLine).toBeInViewport()
  // Retour tablette (2026-08-20) : « la ligne sélectionnée est trop
  // haut sur l'écran et cachée sous la barre de boutons ». `toBeInViewport()`
  // ne l'aurait PAS attrapé — la ligne était dans le cadre tout en étant
  // masquée sous les barres collantes. Deux mesures géométriques à la place.
  const box = await targetLine.boundingBox()
  const viewport = page.viewportSize()
  // CodeMirror centre la PREMIÈRE LIGNE VISUELLE (`coordsAt(line.from)`,
  // cf. reveal-line.js) — pour une ligne qui s'enroule sur plusieurs lignes
  // visuelles (fréquent : le texte d'un patron, sur un viewport téléphone,
  // déborde vite des 16px/1.75 d'interligne configurés), `box.height` (le
  // bloc `.cm-line` ENTIER, replis compris) ne mesure PAS la même chose — son
  // centre dérive d'un DEMI-INTERLIGNE PAR LIGNE VISUELLE EN TROP, un artefact
  // de MESURE, pas un défaut de centrage. On prend donc le rectangle du
  // PREMIER CARACTÈRE de la ligne (`Range.getBoundingClientRect()`, jamais
  // `window.getSelection()` : `revealLine` ne prend délibérément jamais le
  // focus, cf. son en-tête — la sélection DOM peut ne pas être synchronisée).
  const firstRow = await targetLine.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const textNode = walker.nextNode()
    if (!textNode) return null
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, Math.min(1, textNode.length))
    const rect = range.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom }
  })
  const lineCenter = (firstRow.top + firstRow.bottom) / 2
  // Et le cœur du défaut original : le haut de la ligne doit être PLUS BAS
  // que le bas du bandeau collant unique de l'éditeur, `.rte__bar` (issu d'une
  // fusion antérieure, cf. ReaderTextEditor.vue) — c'est LUI que `measureStickyTopHeight()`
  // mesure réellement (élément `position: sticky`), pas `.cm-retag-toolbar`
  // qu'il contient (relecture : mesurer la toolbar plutôt que le
  // bandeau introduisait un écart entre ce que ce test vise et ce que l'app
  // calcule réellement — un padding du bandeau, notamment, n'y était pas
  // compté). Mesurée en direct plutôt qu'écrite en dur : sa hauteur réelle
  // (encoche, police, largeur d'écran) est ce qui aurait attrapé
  // `yMargin: 48` insuffisant.
  const rteBarBox = await page.locator('.rte__bar').boundingBox()
  expect(box.y).toBeGreaterThan(rteBarBox.y + rteBarBox.height)
  // Retour terrain (2026-08-23) : la ligne visée
  // atterrissait en haut de l'écran (CodeMirror centre sur `window.innerHeight`
  // ENTIER — les bandeaux collants ne sont jamais des ANCÊTRES de
  // `.cm-scroller`, cf. reveal-line.js). Corrigé pour centrer dans la zone
  // RÉELLEMENT visible : `window.innerHeight` moins la bande occultée du HAUT
  // (bas de `.rte__bar`, mesuré ci-dessus) moins celle du BAS
  // (`.correct__actions`, Annuler/Enregistrer). On mesure `.correct__actions`
  // en direct, comme `rteBarBox` ci-dessus — jamais une fraction fixe du
  // viewport (l'ancienne bande 25 %–75 %, soit ± 213 px sur ce viewport, était
  // trop large pour détecter le défaut d'origine sur tous les viewports).
  // Hauteur PROPRE de la barre (pas `viewport.height - actionsBox.y`) : c'est
  // exactement `actionsHeight` côté app (ReaderTextEditor.vue, ResizeObserver
  // `box: 'border-box'`) — la grandeur que le calcul de centrage utilise
  // réellement, indépendante de savoir si le bandeau est déjà « collé » au
  // moment précis de la mesure.
  const actionsBox = await page.locator('.correct__actions').boundingBox()
  const topOccluded = rteBarBox.y + rteBarBox.height
  const bottomOccluded = actionsBox.height
  const visibleCenter = (viewport.height + topOccluded - bottomOccluded) / 2
  // Tolérance resserrée à 5 px (revue, finding Important #1 — un
  // seuil à 20px ne pouvait pas distinguer une lecture périmée des hauteurs
  // occultées d'une lecture fraîche : ΔA/2 mesuré ~19.75px avec une lecture
  // synchrone périmée, tout juste sous 20). Mesuré en pratique avec le
  // correctif actuel (`EditorView.scrollMargins`, valeurs lues durant la
  // PROPRE passe de mesure de CodeMirror, jamais en synchrone — cf.
  // reveal-line.js) : écart réel de l'ordre de 2px sur ce fixture — 5px
  // couvre l'arrondi sous-pixel et le délai de mesure Playwright avec de la
  // marge, sans retomber dans la zone morte de l'ancien seuil à 20.
  // `firstRow` mesure la MÊME grandeur que celle que CodeMirror centre
  // réellement (cf. calcul de reveal-line.js — la hauteur de ligne s'y annule
  // entièrement, aucune approximation ne reste à couvrir ici).
  expect(Math.abs(lineCenter - visibleCenter)).toBeLessThan(5)
  // Le second volet du défaut terrain, jamais vérifié jusqu'ici : la ligne
  // doit aussi rester AU-DESSUS du bandeau Annuler/Enregistrer, pas seulement
  // sous le bandeau du haut.
  expect(box.y + box.height).toBeLessThan(actionsBox.y)
})

// Relecture : `EditorView.scrollMargins` posé par `revealLine()`
// PERSISTE pour toute la vie de l'éditeur (`StateEffect.appendConfig` ne se
// retire jamais, cf. reveal-line.js) — un geste APRÈS l'ouverture initiale
// (flèche bas, qui redonne le focus via `moveLineDown`/`view.focus()`,
// cm-editor.js/move-line.js, et réarme `keyboard-avoidance.js`) doit donc
// LUI AUSSI laisser la ligne active hors des deux bandeaux, pas seulement le
// scroll d'ouverture. Ce chemin n'était jamais exercé par les autres specs de
// correction : aucune n'ouvre l'écran avec `?section=&line=` (seul déclencheur
// de `revealLine`), donc le facet n'y est jamais posé.
test('après « Corriger », le curseur déplacé reste hors des bandeaux', async ({ page }) => {
  await openProjectReader(page)
  const card = page.locator('.rstep').first()
  const text = (await card.locator('.rstep__p').innerText()).trim()
  await card.locator('.rstep__body').click()
  await card.getByRole('button', { name: 'Corriger' }).click()
  await expect(page).toHaveURL(/\/pattern\/\d+\/correct\?section=[^&]+&line=\d+$/)
  // Même repère que le test précédent (le document porte plusieurs `.cm-line`,
  // sections d'aide-mémoire comprises — `.first()` seul ne vise pas forcément
  // la ligne révélée) : celui dont le texte correspond à la carte cliquée.
  await expect(page.locator('.cm-line', { hasText: text.slice(0, 16) }).first()).toBeInViewport()

  await page.locator('.rte__arrow--down').click()
  const activeLine = page.locator('.cm-line.cm-active-block').first()
  await expect(activeLine).toBeVisible()
  const activeBox = await activeLine.boundingBox()
  // `.rte__bar`, pas `.cm-retag-toolbar` : c'est le bandeau collant que
  // `measureStickyTopHeight()` mesure réellement (cf. le test précédent).
  const rteBarBox = await page.locator('.rte__bar').boundingBox()
  const actionsBox = await page.locator('.correct__actions').boundingBox()
  expect(activeBox.y).toBeGreaterThan(rteBarBox.y + rteBarBox.height)
  expect(activeBox.y + activeBox.height).toBeLessThan(actionsBox.y)
})

test('le retour ramène sur la section corrigée', async ({ page }) => {
  await openProjectReader(page)
  const card = await tapFirstCard(page)
  // Scopé à la carte, même raison que la carte voisine « Fermer ».
  await card.getByRole('button', { name: 'Corriger' }).click()
  await expect(page).toHaveURL(/\/correct\?/)
  await page.goBack()
  await expect(page).toHaveURL(/\/project\/\d+\/read\?section=[^&]+$/)
})

// Compte les entrées du journal des séances (objectStore `sessions` de la base `rowtine`).
// Lu deux fois par le test qui suit : après le retour de correction (la pause de départ
// a déjà commis SA ligne — et c'est la seule) et après la sortie de bulle (le solde a
// fusionné dedans : toujours une seule entrée, pas une par aller-retour).
async function countSessions(page) {
  return page.evaluate(async () => {
    const req = indexedDB.open('rowtine')
    const dbase = await new Promise((res) => { req.onsuccess = () => res(req.result) })
    return await new Promise((res) => {
      const tx = dbase.transaction('sessions', 'readonly').objectStore('sessions').count()
      tx.onsuccess = () => res(tx.result)
    })
  })
}

test('un aller-retour donne UNE seule entrée au journal, pas deux', async ({ page }) => {
  await openProjectReader(page)
  // Lancer le chrono DANS le lecteur : c’est le cas que ce test doit protéger.
  // Nom accessible du bouton à l’arrêt : `reader.chronoStart` = « Chrono ».
  // `exact: true` : sans lui, « Masquer le chrono » (bouton voisin) matche
  // aussi par sous-chaîne et le clic échoue en mode strict (deux éléments).
  await page.getByRole('button', { name: 'Chrono', exact: true }).click()
  await page.waitForTimeout(1500)

  const card = await tapFirstCard(page)
  // Scopé à la carte, même raison que la carte voisine « Fermer ».
  await card.getByRole('button', { name: 'Corriger' }).click()
  await expect(page).toHaveURL(/\/correct\?/)
  await page.waitForTimeout(1200) // temps passé DANS l’éditeur : jamais compté
  await page.goBack()
  await expect(page).toHaveURL(/\/read\?section=/)
  await page.waitForTimeout(1200)

  // Retour à la fiche du MÊME projet : la séance poursuit — c'est la promesse du lot.
  // Depuis « séances live » (30/08), la pause du départ en correction est COMMITTANTE :
  // le journal connaît DÉJÀ la ligne de l'épisode (une, née du premier commit). Ce que
  // ce retour vers la fiche ne doit PAS faire, c'est écrire une DEUXIÈME ligne : le
  // temps qui re-poursuit vers la fiche reste dans la même ligne, la sortie de bulle
  // commettera son solde par fusion (dernier contact < 2 h).
  await page.getByRole('button', { name: 'Retour' }).click()
  await expect(page).toHaveURL(/\/project\/\d+$/)
  expect(await countSessions(page)).toBe(1)

  // Sortie franche de la BULLE : le retour de la fiche projet remonte l'historique
  // jusqu'au patron d'où elle est née (créée depuis lui) — hors bulle, le garde clôt.
  // La fermeture verse le solde DANS la ligne existante : l'aller-retour complet par
  // la correction n'aura produit qu'UNE entrée, jamais une par écran traversé.
  await page.locator('.phdr__back').click()
  await expect(page.getByText(/Temps enregistré/)).toBeVisible()
  expect(await countSessions(page)).toBe(1)
})

// Retour terrain (2026-08-23) : le titre d'une section est lui aussi
// une cible « Corriger », jusque-là réservée aux cartes Étape/Note/Diagramme/
// Répétition. Ciblé par TEXTE, jamais `.first()` : la section « Présentation »
// (dépliée hors des `##` par serialize.js, cf. step-line.js) retomberait sur le
// repli accepté (ouverture en tête de document) — un résultat qui ressemblerait
// à un échec réel sans en être un.
// ⚠️ « Diminutions du sommet », PAS la première section (« Bordure en côtes ») :
// si `CorrectionView.vue` retombait silencieusement sur `?? 1` (tête de
// document, le repli qu'un `line` MAL transporté déclencherait) au lieu du
// vrai repli `sectionLine`, la première section serait de toute façon en
// viewport à l'ouverture — le test passerait sans rien prouver. Une section
// plus bas dans le document ne l'est QUE si le défilement a réellement eu lieu.
test('un appui sur le TITRE d’une section propose de la corriger', async ({ page }) => {
  await openProjectReader(page)
  const head = page.locator('.rsec__head', { hasText: 'Diminutions du sommet' })
  await head.scrollIntoViewIfNeeded()
  await head.click()
  await expect(head.locator('.rfix')).toBeVisible()
  // Même plancher tactile que les cartes (retouche 2026-08-21) : `.rsec__head`
  // est une ligne flex bien plus basse qu'une carte `.rstep`, jamais mesurée
  // jusqu'ici — rien ne garantissait que le voile y tienne les mêmes 56 px.
  const fixBtn = head.getByRole('button', { name: 'Corriger' })
  const fixBox = await fixBtn.boundingBox()
  expect(fixBox.height).toBeGreaterThanOrEqual(56)

  await fixBtn.click()
  // Sans `&line=` : contrairement à « Corriger » depuis une carte
  // (`?section=...&line=...`), un titre de section n'a pas de position à
  // transporter — `CorrectionView.vue` retombe nativement sur `sectionLine`.
  await expect(page).toHaveURL(/\/pattern\/\d+\/correct\?section=[^&]+$/)
  await expect(page.locator('.cm-line', { hasText: 'Diminutions du sommet' }).first()).toBeInViewport()
})

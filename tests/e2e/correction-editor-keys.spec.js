// Bug confirmé (diagnostic desktop, Playwright) : dans l'éditeur CM6 de l'écran de
// correction (ReaderTextEditor -> @/components/cm/cm-editor.js), en vue ENRICHIE
// (hideMarkup=true, défaut — le préfixe `- ` d'une ligne rang est masqué derrière
// RowCheckWidget, une case à cocher visuelle `contenteditable=false`), cm-editor.js
// n'installe AUCUN keymap (@codemirror/commands n'est même pas une dépendance) :
// Entrée/Retour-arrière tombent alors sur le comportement natif contentEditable, qui
// désynchronise la sélection modèle CM6 à la frontière du widget non-éditable —
// Entrée coupe la ligne au mauvais endroit, Retour-arrière en tête de ligne
// sur-supprime au lieu de fusionner proprement avec la ligne précédente.
//
// On pilote un VRAI CLIC SOURIS (jamais les flèches clavier : un curseur
// posé au clavier ne passe pas par le même chemin DOM qu'un tap utilisateur réel) à
// un offset de caractère précis du texte VISIBLE d'une ligne, via Range.getClientRects
// (clickAtVisibleOffset ci-dessous) — le widget RowCheckWidget ne porte aucun texte,
// donc l'offset visible N correspond exactement à la position juste après lui.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

const PATTERN = {
  name: 'Correction Keys Test',
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
        steps: [
          { t: 'Monter soixante mailles' },
          { t: 'Tricoter en jersey' },
          { t: 'Rabattre les mailles' },
        ],
      },
    ],
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

// Clique à un OFFSET DE CARACTÈRE précis dans le texte visible d'une ligne CM6 (le
// widget case-à-cocher masquant `- ` ne porte aucun texte, donc l'offset 0 tombe pile
// juste après lui). Calcule la position PIXEL relative à la ligne via Range.getClientRects,
// puis délègue le clic à `locator.click({ position })` — jamais `page.mouse.click(x, y)`
// en coordonnées absolues : ce dernier ne fait aucune vérification d'« actionability »
// (scroll, stabilité, séquence d'événements qui donne réellement le focus) et peut
// arriver alors que le focus est ailleurs, produisant un no-op silencieux sans rapport
// avec le bug réel (flake du harnais, cf. investigation — pas un défaut utilisateur :
// un tap posé sur un état stabilisé fonctionne). `locator.click` reproduit fidèlement
// un tap réel et garantit le focus sur l'éditeur avant l'appui clavier qui suit.
async function clickAtVisibleOffset(page, lineLocator, offset) {
  const line = lineLocator.first()
  const el = await line.elementHandle()
  // Boîte de la ligne ET point cible calculés dans LE MÊME evaluate (un seul aller-retour,
  // même instantané de layout) : deux appels séparés (boundingBox() puis Range) risquaient
  // un décalage si un reflow survenait entre les deux, décalant le clic d'un cran.
  const relative = await page.evaluate(
    ({ el, offset }) => {
      const box = el.getBoundingClientRect()
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let remaining = offset
      let node = walker.nextNode()
      let point = null
      while (node) {
        if (remaining <= node.textContent.length) {
          const range = document.createRange()
          range.setStart(node, remaining)
          range.setEnd(node, remaining)
          const rect = range.getClientRects()[0] || range.getBoundingClientRect()
          point = { x: rect.left, y: rect.top + rect.height / 2 }
          break
        }
        remaining -= node.textContent.length
        node = walker.nextNode()
      }
      if (!point) point = { x: box.right - 1, y: box.top + box.height / 2 }
      return { x: point.x - box.left, y: point.y - box.top }
    },
    { el, offset },
  )
  // Position RELATIVE à la boîte de la ligne (contrat de `locator.click({ position })`).
  await line.click({ position: relative })
  // Garde web-first : le focus doit être réellement passé à l'éditeur CM6 avant de
  // presser la touche qui suit (cf. classe `cm-focused`, posée par CodeMirror au focus).
  await expect(page.locator('.rte__host .cm-editor.cm-focused')).toBeVisible()
}

async function openCorrection(page) {
  await completeOnboarding(page, { firstName: 'Alex' })
  const id = await seedPattern(page, PATTERN)
  // Navigation directe vers la route de correction (pas via le bouton d'entrée de la
  // fiche patron, dont le libellé est un détail hors périmètre de ce test — seule la
  // route /pattern/:id/correct compte ici, cf. router-name pattern-correct).
  await page.goto(`/pattern/${id}/correct`)
  await expect(page).toHaveURL(/\/pattern\/\d+\/correct$/)
}

test('correction (vue enrichie) : Entrée en milieu de ligne coupe exactement au curseur, sans indentation parasite', async ({
  page,
}) => {
  await openCorrection(page)

  const line = page.locator('.rte__host .cm-line').filter({ hasText: 'Tricoter en jersey' })
  await expect(line).toBeVisible()

  const before = await page.locator('.rte__host .cm-line').allTextContents()
  const beforeIdx = before.findIndex((t) => t === 'Tricoter en jersey')
  expect(beforeIdx).toBeGreaterThanOrEqual(0)

  // Curseur juste après "Tricoter " (9 caractères visibles, espace inclus).
  await clickAtVisibleOffset(page, line, 9)
  await page.keyboard.press('Enter')

  // La transaction CM6 (découpage de ligne) est bien synchrone, mais la lecture
  // `allTextContents()` passe par un aller-retour CDP séparé de celui du `press` :
  // un one-shot immédiatement après peut donc encore lire un DOM pas tout à fait
  // retourné (flake constaté : le compte de lignes retombe parfois sur `before.length`
  // pendant un instant avant de passer à `before.length + 1`). `expect.poll` relit
  // jusqu'à stabilisation au lieu de courir contre ce battement, sans jamais
  // affaiblir l'assertion elle-même (même égalité stricte, juste non one-shot).
  await expect
    .poll(async () => (await page.locator('.rte__host .cm-line').allTextContents()).length)
    .toBe(before.length + 1)

  const after = await page.locator('.rte__host .cm-line').allTextContents()
  expect(after.length).toBe(before.length + 1)
  // Coupe EXACTEMENT au curseur : "Tricoter" reste seul sur sa ligne...
  expect(after[beforeIdx].trimEnd()).toBe('Tricoter')
  // ...et "en jersey" démarre la suivante SANS le moindre espace/tabulation parasite
  // en tête (une indentation automatique injectée par insertNewlineAndIndent ferait
  // échouer cette égalité stricte).
  expect(after[beforeIdx + 1]).toBe('en jersey')
  // Rien d'autre n'a bougé ni été perdu autour de la ligne coupée.
  expect(after.slice(0, beforeIdx)).toEqual(before.slice(0, beforeIdx))
  expect(after.slice(beforeIdx + 2)).toEqual(before.slice(beforeIdx + 1))
})

test('correction (vue enrichie) : Retour-arrière en tout début de ligne — 1ʳᵉ pression retire le balisage `- ` proprement (sans rien perdre), 2ᵉ fusionne avec la ligne précédente', async ({
  page,
}) => {
  await openCorrection(page)

  const line = page.locator('.rte__host .cm-line').filter({ hasText: 'Tricoter en jersey' })
  await expect(line).toBeVisible()

  const before = await page.locator('.rte__host .cm-line').allTextContents()
  const beforeIdx = before.findIndex((t) => t === 'Tricoter en jersey')
  expect(beforeIdx).toBeGreaterThanOrEqual(0)
  expect(before[beforeIdx - 1]).toBe('Monter soixante mailles')

  // Curseur EN TOUT DÉBUT de ligne (offset visible 0, juste après le widget case-à-cocher).
  await clickAtVisibleOffset(page, line, 0)
  await page.keyboard.press('Backspace')

  // 1ʳᵉ pression : le préfixe `- ` (2 caractères masqués, atomiques) est retiré d'un bloc —
  // la ligne cesse d'être un rang (elle redevient "texte" — même comportement que Word/
  // Docs/Notion au Retour-arrière en tête d'un élément de liste : retrait du balisage
  // AVANT toute fusion). AUCUNE autre ligne n'est touchée : c'est la preuve qu'il n'y a
  // aucune sur-suppression au premier appui (contrairement au bug original, qui mangeait
  // silencieusement l'espace masqué de `- ` sans que rien ne redevienne visible).
  const afterFirst = await page.locator('.rte__host .cm-line').allTextContents()
  expect(afterFirst.length).toBe(before.length)
  expect(afterFirst[beforeIdx]).toBe('Tricoter en jersey')
  const classesFirst = await page.locator('.rte__host .cm-line').evaluateAll((els) => els.map((e) => e.className))
  expect(classesFirst[beforeIdx]).not.toContain('md-rang')
  expect(afterFirst).toEqual(before)

  // 2ᵉ pression : désormais en VRAI début de ligne (plus de balisage à traverser), Retour-
  // arrière fusionne avec la ligne précédente — concaténation EXACTE, sans le moindre
  // caractère perdu ni ajouté des deux côtés de la jointure.
  await page.keyboard.press('Backspace')
  const after = await page.locator('.rte__host .cm-line').allTextContents()
  expect(after.length).toBe(before.length - 1)
  expect(after[beforeIdx - 1]).toBe('Monter soixante maillesTricoter en jersey')
  // Rien avant, ni après (au-delà de la jointure), n'a été touché — preuve contre une
  // sur-suppression qui aurait mangé plus que le seul saut de ligne.
  expect(after.slice(0, beforeIdx - 1)).toEqual(before.slice(0, beforeIdx - 1))
  expect(after.slice(beforeIdx)).toEqual(before.slice(beforeIdx + 1))
})

// Le curseur posé sur la ligne d'une image
// dans l'éditeur de correction doit ouvrir/mettre en évidence la ligne correspondante
// dans la bande « Diagrammes de ce patron » (bascule image↔diagramme déjà existante et
// entièrement fonctionnelle, cf. correction-charts-collapsed.spec.js). C'est un pont Vue
// pur (onCursorLine, CorrectionView.vue) : zéro nouvelle action de requalification, cf.
// tête de CorrectionView.vue — ce test ne vérifie QUE le focus visuel.
//
// Patron dédié À UNE SEULE section chart (mêmes fixtures que
// correction-charts-actionbar.spec.js, chartSection()) : section.chart + step
// {chart:true} suffit à peupler chartStripRows sans image réellement décodable
// (sectionFingerprint retombe sur son repli, cf. commentaire de chartSection
// là-bas). Volontairement SANS section de remplissage : tout le document tient
// dans le viewport initial de CodeMirror — CM6 ne décore (widgets image compris)
// que ses `visibleRanges`, une ligne hors-écran ne serait donc pas cliquable
// sans scroll supplémentaire, hors sujet pour ce test.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

function chartSection(id, title) {
  return {
    id,
    kind: 'corps',
    title,
    chart: { img: 'x' },
    steps: [{ t: `Voir le diagramme ${title}`, chart: true }],
  }
}

const PATTERN = {
  name: 'Correction Pastille Diagramme Test',
  type: 'knitting',
  category: '',
  sizes: [],
  gallery: [],
  photos: [],
  pdf: '',
  reader: {
    sizeLabels: [],
    sections: [chartSection('motif', 'Motif torsadé')],
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

test('sélectionner la ligne image ouvre et surligne la bande diagrammes', async ({ page }) => {
  await completeOnboarding(page)
  const id = await seedPattern(page, PATTERN)
  await page.goto(`/pattern/${id}/correct`)
  await expect(page).toHaveURL(/\/pattern\/\d+\/correct$/)

  // Repliée par défaut (cf. correction-charts-collapsed.spec.js) : la preuve que le
  // clic sur la ligne image l'ouvre TOUTE SEULE, sans passer par la puce « Diagrammes ».
  const toggle = page.getByRole('button', { name: /Diagrammes \(\d+\)/ })
  await expect(toggle).toBeVisible()
  await expect(page.locator('.chart-strip__list')).toHaveCount(0)

  // Seule ligne image du document (le diagramme de « Motif torsadé ») : vignette réelle
  // (`.cm-image-thumb`) si sa source résout dans la map d'images de l'éditeur, sinon
  // placeholder texte (`.cm-image-placeholder`). Le CLIC n'y pose plus le curseur depuis
  // l'introduction du menu diagramme (a8ff3f94, 24/08) : il ouvre le menu « Changer le type »
  // (le repli selectImageLine ne joue que si la section n'est pas chart-éligible — or
  // ici elle l'est, c'est le sujet). Le pont onCursorLine — ouvrir la bande et surligner
  // sa rangée — s'atteint par un déplacement de sélection SANS mutation : clic sur la
  // ligne de titre (même motif que correction-discard-guard.spec.js), puis flèche bas
  // jusqu'à la ligne image. Borné à 5 pressions : le document fait 2-3 lignes, la boucle
  // ne dépend pas d'un éventuel blanc d'espacement entre titre et image.
  const imageLine = page.locator('.rte__host .cm-image-thumb, .rte__host .cm-image-placeholder').first()
  await expect(imageLine).toBeVisible()
  const titleLine = page.locator('.rte__host .cm-line').filter({ hasText: 'Motif torsadé' }).first()
  // Décalé à droite du badge de genre (« Corps ») en tête de ligne : le clic pose le
  // curseur dans le texte du titre, il n'actionne pas le badge.
  await titleLine.click({ position: { x: 250, y: 10 } })
  for (let i = 0; i < 5 && (await page.locator('.chart-strip__list').count()) === 0; i++) {
    await page.keyboard.press('ArrowDown')
  }

  await expect(page.locator('.chart-strip__list')).toBeVisible()
  const activeRow = page.locator('.chart-strip__row--active')
  await expect(activeRow).toBeVisible()

  // La classe seule ne prouve rien : `--brand-deep`/`--tile` pourraient être des jetons
  // absents (silencieusement ignorés par le CSS, cf. correction-editor-visual.spec.js qui
  // lit systématiquement les styles RÉELLEMENT RENDUS, jamais la feuille). `box-shadow`
  // vaut `none` par défaut — une valeur DIFFÉRENTE de `none` prouve que `--brand-deep` a
  // bien résolu vers une vraie couleur, pas une chaîne vide qui invaliderait toute la
  // déclaration au calcul.
  const boxShadow = await activeRow.evaluate((el) => getComputedStyle(el).boxShadow)
  expect(boxShadow).not.toBe('none')
})

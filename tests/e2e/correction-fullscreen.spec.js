// La barre d'action de l'écran de correction
// (Annuler + Enregistrer) doit rester COLLÉE en bas de l'écran (position: sticky), pas
// en fin de <main> où un patron long la pousse hors du viewport. La barre d'étiquetage
// CM6 est déjà sticky en haut (ReaderTextEditor.vue) ; ce test couvre la barre du bas.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

const PATTERN = {
  name: 'Correction Fullscreen Test',
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

test('correction : Enregistrer et Annuler collés en bas, visibles sans défiler', async ({ page }) => {
  await completeOnboarding(page)
  // Patron LONG pour pousser le bouton hors écran s'il n'était pas sticky.
  const long = {
    ...PATTERN,
    reader: {
      sizeLabels: [],
      sections: [
        {
          id: 'corps',
          kind: 'corps',
          title: 'Corps',
          steps: Array.from({ length: 60 }, (_, i) => ({ t: `Rang ${i + 1} : tricoter en jersey` })),
        },
      ],
    },
  }
  const id = await seedPattern(page, long)
  await page.goto(`/pattern/${id}/correct`)
  const save = page.getByRole('button', { name: /Enregistrer/ })
  const cancel = page.getByRole('button', { name: /Annuler/ })
  await expect(save).toBeInViewport()
  await expect(cancel).toBeInViewport()
})

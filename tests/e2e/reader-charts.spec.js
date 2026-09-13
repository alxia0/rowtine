// Parcours — lecteur de patron, grilles multiples.
//  - Patron 2 grilles (S, M) : filtrage par taille choisie, suivi indépendant, persistance.
//  - Aperçu bibliothèque : toutes les grilles restent visibles (lecture seule, pas de filtrage).
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// Patron 2 grilles : une pour S, une pour M ; + une section de rangs pour choisir la taille.
const PATTERN = {
  name: 'Multi grilles', type: 'knitting', category: '', sizes: ['S', 'M'], gallery: [], photos: [], pdf: '',
  reader: {
    sizeLabels: ['S', 'M'],
    sections: [
      { id: 'corps', kind: 'corps', title: 'Corps', steps: [{ t: 'Monter 10 m.' }] },
      { id: 'grille-dos', kind: 'diagramme', title: 'Grille dos', steps: [{ chart: true }], chart: { rows: 20, cols: 10, img: PNG, repeat: '10 m × 20 rangs', readDir: 'bas→haut', sizes: ['S'], builtinLegend: false } },
      { id: 'grille-manche', kind: 'diagramme', title: 'Grille manche', steps: [{ chart: true }], chart: { rows: 30, cols: 12, img: PNG, repeat: '12 m × 30 rangs', readDir: 'bas→haut', sizes: ['M'], builtinLegend: false } },
    ],
  },
}

async function seedAndOpenProject(page) {
  await completeOnboarding(page, { firstName: 'Alex' })
  const id = await page.evaluate(async (pat) => {
    const addTo = (store, obj) => new Promise((res, rej) => {
      const r = indexedDB.open('rowtine')
      r.onsuccess = () => { const db = r.result; const tx = db.transaction(store, 'readwrite'); const a = tx.objectStore(store).add(obj); a.onsuccess = () => res(a.result); a.onerror = () => rej(a.error) }
      r.onerror = () => rej(r.error)
    })
    const patternId = await addTo('patterns', pat)
    const projectId = await addTo('projects', { name: 'P', technique: 'knitting', status: 'active', patternId, readerState: {} })
    return projectId
  }, PATTERN)
  await page.goto(`/project/${id}/read`)
  await expect(page).toHaveURL(/\/project\/\d+\/read/)
}

test('projet : seule la grille de la taille choisie est suivie', async ({ page }) => {
  await seedAndOpenProject(page)
  // Aucune taille : les deux grilles visibles (rien perdu).
  await expect(page.locator('.rstep__chart')).toHaveCount(2)
  // Choisir S → seule la grille dos (rows 20) reste.
  await page.locator('.szpill', { hasText: /^S/ }).click()
  await expect(page.locator('.rstep__chart')).toHaveCount(1)
  await expect(page.locator('.chart__val')).toHaveText('1 / 20')
  // Choisir M → seule la grille manche (rows 30).
  await page.locator('.szpill', { hasText: /^M/ }).click()
  await expect(page.locator('.rstep__chart')).toHaveCount(1)
  await expect(page.locator('.chart__val')).toHaveText('1 / 30')
})

test('projet : rang suivi indépendant + persistance', async ({ page }) => {
  await seedAndOpenProject(page)
  await page.locator('.szpill', { hasText: /^M/ }).click()
  await page.locator('.chart__next').click()
  await expect(page.locator('.chart__val')).toHaveText('2 / 30')
  await page.waitForTimeout(300)
  await page.reload()
  await expect(page.locator('.szpill', { hasText: /^M/ })).toHaveClass(/szpill--on/)
  await expect(page.locator('.chart__val')).toHaveText('2 / 30')
})

test('aperçu bibliothèque : toutes les grilles visibles (lecture seule)', async ({ page }) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  const pid = await page.evaluate(async (pat) => {
    const r = indexedDB.open('rowtine')
    return await new Promise((res, rej) => {
      r.onsuccess = () => { const db = r.result; const tx = db.transaction('patterns', 'readwrite'); const a = tx.objectStore('patterns').add(pat); a.onsuccess = () => res(a.result); a.onerror = () => rej(a.error) }
      r.onerror = () => rej(r.error)
    })
  }, PATTERN)
  await page.goto(`/pattern/${pid}/read`)
  await expect(page.locator('.rstep__chart')).toHaveCount(2)
  await expect(page.locator('.szpill')).toHaveCount(0) // pas de sélecteur de taille en aperçu
})

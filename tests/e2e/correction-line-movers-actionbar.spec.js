// Retour terrain (Nexus 7, second tour) : les flèches monter/descendre
// (.rte__line-movers, position: fixed, ReaderTextEditor.vue) chevauchaient parfois le
// bouton « Enregistrer » (.correct__actions, position: sticky; bottom: 0).
//
// Cause RACINE mesurée (pas supposée) : le composant lisait
// `entries[0].contentRect.height` (ResizeObserver) — la boîte de CONTENU de
// `.correct__actions`, qui EXCLUT son propre padding/bordure (48px mesurés) — au lieu
// de sa boîte de BORDURE (73px mesurés, ce qu'elle occupe RÉELLEMENT depuis le bas du
// viewport, elle est collée à `bottom: 0`). L'écart (25px, exactement
// padding-top+padding-bottom+border-top) manquait au calc `bottom` des flèches,
// REPRODUIT en défilant simplement en bas de page — AUCUN focus ni clavier virtuel
// requis, ce n'est donc pas un défaut de synchronisation avec l'ouverture du clavier
// (les pistes `visualViewport`/z-index envisagées ont été écartées).
//
// Les deux scénarios ci-dessous couvrent : (A) le cas nu — défiler en bas de page — qui
// suffit déjà à reproduire le bug avant correctif ; (B) le cas rapporté sur le terrain —
// focus d'une ligne de texte près de la fin du patron, qui déclenche le VRAI mécanisme
// de keyboard-avoidance.js (padding-bottom 45vh + rattrapage de scroll du curseur) —
// pour prouver que le correctif tient aussi sous ce mécanisme, sans le simuler à la main.
import { test, expect } from '@playwright/test'
import { completeOnboarding } from './helpers'

function fillerSection() {
  const steps = []
  for (let i = 1; i <= 80; i++) {
    steps.push({ t: `Rang de remplissage numéro ${i}, texte assez long pour déborder largement du viewport et forcer un défilement réel jusqu'en bas de page.` })
  }
  return { id: 'remplissage', kind: 'corps', title: 'Corps', steps }
}

const PATTERN = {
  name: 'Correction Line Movers Actionbar Test',
  type: 'knitting',
  category: '',
  sizes: [],
  gallery: [],
  photos: [],
  pdf: '',
  reader: { sizeLabels: [], sections: [fillerSection()] },
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

// Instantané ATOMIQUE (un seul evaluate) : geometrie ET un vrai test de survol (le
// centre du bouton Enregistrer doit encore retomber SUR lui, pas sur les flèches qui
// le recouvriraient sinon) — même patron que correction-charts-actionbar.spec.js.
async function measureOverlap(page) {
  return page.evaluate(() => {
    const actions = document.querySelector('.correct__actions')
    const movers = document.querySelector('.rte__line-movers')
    const saveBtn = [...actions.querySelectorAll('button')].find((b) => b.textContent.includes('Enregistrer'))
    const aRect = actions.getBoundingClientRect()
    const mRect = movers.getBoundingClientRect()
    const sRect = saveBtn.getBoundingClientRect()
    const cx = sRect.left + sRect.width / 2
    const cy = sRect.top + sRect.height / 2
    const hit = document.elementFromPoint(cx, cy)
    return {
      actionsTop: aRect.top,
      moversBottom: mRect.bottom,
      overlap: mRect.bottom > aRect.top,
      saveButtonHit: !!hit && (hit === saveBtn || saveBtn.contains(hit)),
      // Correctif 2 — hauteur RENDUE des boutons (pas la déclaration `min-height` :
      // un simple scrape CSS prouverait la règle écrite, pas ce que le navigateur
      // peint réellement). Contrainte globale du plan : jamais sous 44px.
      buttonHeights: [...actions.querySelectorAll('button')].map((b) => b.getBoundingClientRect().height),
    }
  })
}

test.describe('correction : les flèches monter/descendre restent au-dessus du bandeau Annuler/Enregistrer', () => {
  test('scénario A — simple défilement en bas de page (aucun clavier requis pour reproduire)', async ({ page }) => {
    await completeOnboarding(page, { firstName: 'Alex' })
    const id = await seedPattern(page, PATTERN)
    await page.goto(`/pattern/${id}/correct`)
    await expect(page).toHaveURL(/\/pattern\/\d+\/correct$/)

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(200)

    const result = await measureOverlap(page)
    expect(result.overlap, `flèches bas=${result.moversBottom} vs bandeau haut=${result.actionsTop}`).toBe(false)
    expect(result.saveButtonHit, 'le centre du bouton Enregistrer ne retombe pas sur lui (recouvert)').toBe(true)
    for (const h of result.buttonHeights) expect(h, 'cible tactile Annuler/Enregistrer rendue').toBeGreaterThanOrEqual(44)
  })

  test('scénario B — focus de la dernière ligne du texte (déclenche keyboard-avoidance.js pour de vrai)', async ({ page }) => {
    await completeOnboarding(page, { firstName: 'Alex' })
    const id = await seedPattern(page, PATTERN)
    await page.goto(`/pattern/${id}/correct`)
    await expect(page).toHaveURL(/\/pattern\/\d+\/correct$/)

    await page.getByRole('button', { name: 'Modifier le texte' }).click()
    // Clic réel dans la DERNIÈRE ligne (juste avant .correct__actions dans le flux) :
    // déclenche le VRAI `focusin` que keyboard-avoidance.js écoute sur `document`.
    await page.locator('.rte__host .cm-line').last().click()
    // Laisse tourner le mécanisme (rAF de onFocusIn, puis scrollCaretIntoView).
    await page.waitForTimeout(300)

    // Garde-fou : le mécanisme a bien tourné (sinon ce scénario ne prouverait rien de
    // plus que le scénario A, qui ne dépend d'aucun focus).
    const paddingBottom = await page.evaluate(() => document.scrollingElement.style.paddingBottom)
    expect(paddingBottom).toBe('45vh')

    const result = await measureOverlap(page)
    expect(result.overlap, `flèches bas=${result.moversBottom} vs bandeau haut=${result.actionsTop}`).toBe(false)
    expect(result.saveButtonHit, 'le centre du bouton Enregistrer ne retombe pas sur lui (recouvert)').toBe(true)
    for (const h of result.buttonHeights) expect(h, 'cible tactile Annuler/Enregistrer rendue').toBeGreaterThanOrEqual(44)
  })
})

// Point D (lot correction-ux) : quand on déplie la bande « Diagrammes de ce patron »
// (cf. correction-charts-collapsed.spec.js pour le repli/dépli lui-même) EN BAS DE PAGE,
// ses rangées ne doivent PAS passer sous la barre d'action collante « Annuler /
// Enregistrer » (.correct__actions, position: sticky; bottom: 0).
//
// Cause MESURÉE (pas devinée) en écrivant ce test : (a). Diagnostic posé sur le code
// AVANT correctif — déjà scrollée en bas de la page COLLAPSED, puis toggle.click() SANS
// re-scroll ensuite — donnait :
//   avant toggle : actionsRect.top = 654 (barre déjà "posée", pas recouvrante — on est
//                  au vrai bas de page à ce moment-là)
//   juste après  : actionsRect.top = 654 (INCHANGÉ — la barre reste "collée" au bas du
//                  viewport) alors que scrollHeight vient de grandir (+338px, les 3
//                  nouvelles rangées) et que scrollY, lui, n'a PAS bougé : on n'est plus
//                  au vrai bas de page réel, donc la barre reste "sticky" (flottante) au
//                  lieu de reprendre sa place en flux — et flotte PILE sur les rangées
//                  fraîchement ajoutées (row[0] = y:673→780, recouvert par la barre
//                  y:654→727). Un `window.scrollTo` explicite APRÈS coup fait disparaître
//                  le symptôme (on atteint alors le vrai nouveau bas, où la barre reprend
//                  sa place en flux) — ce n'est PAS un correctif, seulement un geste que
//                  rien dans l'app ne fait pour l'utilisatrice. D'où le fix (b) : cf.
//                  toggleCharts (CorrectionView.vue) qui reproduit CE geste — scrollMarginBottom
//                  mesuré + scrollIntoView — à sa place.
// (b) le dégagement bas (.correct__body { padding-bottom: var(--sp-4) }, 16px pour une
//     barre ~73px) n'est PAS en cause : une fois au vrai bas de page, la barre — TOUJOURS
//     en flux normal (dernier enfant, jamais détachée du document par le sticky) — réserve
//     elle-même sa hauteur, quel que soit le padding du bloc qui la précède. Mesuré aussi.
import { test, expect } from '@playwright/test'
import { completeOnboarding, waitForScrollSettled } from './helpers'

// Trois sections DÉJÀ diagramme (section.chart + step {chart:true}) : suffisant pour
// peupler chartStripRows (sectionCanDemote), sans avoir besoin d'une vraie image
// valide — sectionFingerprint() retombe sur son repli `photo-0.bin` pour une chaîne
// qui n'est pas une data-URL (cf. photoFileName, backup/naming.js), ce qui suffit à
// rendre chaque section ÉLIGIBLE : aucun consommateur de ce test n'a besoin que
// l'image soit réellement décodable.
function chartSection(id, title) {
  return {
    id,
    kind: 'corps',
    title,
    chart: { img: 'x' },
    steps: [{ t: `Voir le diagramme ${title}`, chart: true }],
  }
}

// Section de remplissage : uniquement pour que l'éditeur (CodeMirror, hauteur auto)
// dépasse largement le viewport Pixel 5 (727px de haut ; 851 est la hauteur d'ÉCRAN du
// descripteur Playwright, jamais celle de la fenêtre — cf. les mesures ci-dessus, où la
// barre d'action se pose à y:654→727) — SANS page assez longue pour exiger un
// défilement, la barre d'action sticky ne peut jamais recouvrir quoi que ce soit (elle
// suit simplement la fin d'un contenu qui tient déjà à l'écran).
function fillerSection() {
  const steps = []
  for (let i = 1; i <= 40; i++) steps.push({ t: `Rang de remplissage numéro ${i}` })
  return { id: 'remplissage', kind: 'corps', title: 'Corps', steps }
}

const PATTERN = {
  name: 'Correction Actionbar Test',
  type: 'knitting',
  category: '',
  sizes: [],
  gallery: [],
  photos: [],
  pdf: '',
  reader: {
    sizeLabels: [],
    sections: [
      fillerSection(),
      chartSection('diagramme-1', 'Diagramme un'),
      chartSection('diagramme-2', 'Diagramme deux'),
      chartSection('diagramme-3', 'Diagramme trois'),
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

test('correction : la bande diagrammes dépliée EN BAS DE PAGE reste au-dessus de la barre Annuler/Enregistrer', async ({
  page,
}) => {
  await completeOnboarding(page, { firstName: 'Alex' })
  const id = await seedPattern(page, PATTERN)
  await page.goto(`/pattern/${id}/correct`)
  await expect(page).toHaveURL(/\/pattern\/\d+\/correct$/)

  const toggle = page.getByRole('button', { name: /Diagrammes \(\d+\)/ })
  await expect(toggle).toBeVisible()

  // Scénario du titre du point D : « en bas de page » AU MOMENT du dépli — c'est cet
  // ordre précis qui reproduit le bug (cf. diagnostic en tête de fichier). Scroller
  // APRÈS le clic, lui, masque toujours le symptôme (on atteint alors le vrai nouveau
  // bas de page) sans rien prouver sur ce que voit réellement l'utilisatrice au tap.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await toggle.click()

  const rows = page.locator('.chart-strip__row')
  await expect(rows).toHaveCount(3)

  // Laisse le rattrapage de scroll (toggleCharts, scrollIntoView `behavior: 'smooth'`)
  // se stabiliser avant de mesurer — même garde que le reste de la suite (cf.
  // commentaire de tête de waitForScrollSettled, helpers.js) : une mesure prise en
  // plein milieu de l'animation ne prouverait rien.
  await waitForScrollSettled(page, '.chart-strip')

  // Instantané ATOMIQUE (un seul evaluate) : bottom de chaque rangée vs top de la barre
  // d'action, ET vérification qu'un point posé au centre de chaque rangée retombe bien
  // dessus (pas sur la barre, qui la recouvrirait sinon).
  const result = await page.evaluate(() => {
    const actions = document.querySelector('.correct__actions')
    const actionsTop = actions.getBoundingClientRect().top
    const rowEls = [...document.querySelectorAll('.chart-strip__row')]
    return rowEls.map((row) => {
      const rect = row.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const hit = document.elementFromPoint(cx, cy)
      return {
        bottom: rect.bottom,
        actionsTop,
        underneathBar: rect.bottom > actionsTop,
        hitIsRow: !!hit && (hit === row || row.contains(hit)),
      }
    })
  })

  for (const r of result) {
    expect(r.underneathBar, `rangée sous la barre : bottom=${r.bottom} vs top barre=${r.actionsTop}`).toBe(false)
    expect(r.hitIsRow, 'le point central de la rangée ne retombe pas sur elle (recouverte)').toBe(true)
  }
})

// ACCESSIBILITÉ — « réduire les animations » (point 2 de la revue finale du lot).
//
// Le rattrapage de scroll du dépli (toggleCharts, CorrectionView.vue) passe un `behavior`
// EXPLICITE à `scrollIntoView`. Or `tokens.css` impose bien `scroll-behavior: auto
// !important` sous `prefers-reduced-motion: reduce`, mais cette règle CSS ne gouverne QUE
// le défilement laissé au navigateur : une valeur passée en argument JavaScript la
// contourne (piège mesuré le 30/07, puis re-mesuré — cf. src/utils/scroll-behavior.js, qui
// porte la seule copie de la règle). Une tricoteuse qui a demandé moins d'animations
// recevait ici un défilement animé.
//
// Le test intercepte `scrollIntoView` et lit le `behavior` REÇU plutôt que de chronométrer
// une animation : c'est exactement la valeur que la règle CSS ne peut pas corriger, donc
// exactement ce qui doit être prouvé, et c'est déterministe (un chronomètre sur un défilement
// de quelques centaines de millisecondes serait une source de flakiness). Le mouchard
// RAPPELLE l'original : le comportement asséré ensuite (les rangées au-dessus de la barre)
// est bien celui de l'app, pas celui d'un défilement désactivé par le test.
//
// Les DEUX sens sont vérifiés dans le même test — 'auto' sous la préférence, 'smooth' sans
// elle. Sans le second, l'assertion passerait aussi sur un `'auto'` écrit en dur, qui ne
// prouverait rien : ce qu'on veut, c'est que la préférence soit LUE.
test('correction : sous « réduire les animations », le dépli de la bande diagrammes ne défile PAS en animé', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    window.__stripScrollBehaviors = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (options) {
      if (this.classList && this.classList.contains('chart-strip')) {
        window.__stripScrollBehaviors.push(options && options.behavior ? options.behavior : '(aucun)')
      }
      return original.apply(this, arguments)
    }
  })

  await completeOnboarding(page, { firstName: 'Alex' })
  const id = await seedPattern(page, PATTERN)
  await page.goto(`/pattern/${id}/correct`)
  await expect(page).toHaveURL(/\/pattern\/\d+\/correct$/)

  const toggle = page.getByRole('button', { name: /Diagrammes \(\d+\)/ })
  await expect(toggle).toBeVisible()

  // Même scénario que le test ci-dessus : en bas de page AU MOMENT du dépli, seul cas où
  // le rattrapage a quelque chose à faire.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await toggle.click()
  await expect(page.locator('.chart-strip__row')).toHaveCount(3)
  await waitForScrollSettled(page, '.chart-strip')

  expect(await page.evaluate(() => window.__stripScrollBehaviors)).toEqual(['auto'])

  // ET le correctif du point D tient toujours sous la préférence : un défilement non animé
  // reste un défilement, les rangées ne passent pas sous la barre d'action.
  const sousLaBarre = await page.evaluate(() => {
    const actionsTop = document.querySelector('.correct__actions').getBoundingClientRect().top
    return [...document.querySelectorAll('.chart-strip__row')].map((r) => r.getBoundingClientRect().bottom > actionsTop)
  })
  expect(sousLaBarre).toEqual([false, false, false])

  // Contre-épreuve, sans la préférence : replier puis redéplier rejoue `toggleCharts`, qui
  // doit alors redemander l'animation. Preuve que la valeur est lue, pas figée.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await toggle.click() // repli : `toggleCharts` sort avant tout scroll
  await expect(page.locator('.chart-strip__row')).toHaveCount(0)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await toggle.click()
  await expect(page.locator('.chart-strip__row')).toHaveCount(3)
  await waitForScrollSettled(page, '.chart-strip')

  expect(await page.evaluate(() => window.__stripScrollBehaviors)).toEqual(['auto', 'smooth'])
})

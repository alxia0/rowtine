// @vitest-environment jsdom
// Composant : la visite guidée du lecteur (lot du 23/09/2026) : trois bulles au-dessus du
// lecteur. On vérifie l'enchaînement Suivant / Suivant / Commencer, la sortie immédiate
// par Passer ou Échap, le saut d'une étape dont la cible manque, et que le voile avale
// les appuis. ReaderTour ne connaît pas le lecteur : on lui donne des cibles factices.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import i18n from '@/i18n'
import ReaderTour from '@/components/ReaderTour.vue'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

const wrappers = []
let cibles
// Trois cibles réelles dans le document (le composant les mesure et les fait défiler).
function poseCibles() {
  cibles = ['size', 'steps', 'chart'].map((k) => {
    const el = document.createElement('section')
    el.id = 'cible-' + k
    document.body.appendChild(el)
    return el
  })
}
function etapes({ sansSteps = false } = {}) {
  return [
    { key: 'size', target: () => cibles[0] },
    { key: 'steps', target: () => (sansSteps ? null : cibles[1]) },
    { key: 'chart', target: () => cibles[2] },
  ]
}
async function monte(steps = etapes()) {
  const w = mount(ReaderTour, { props: { steps }, global: { plugins: [i18n] }, attachTo: document.body })
  wrappers.push(w)
  await flushPromises()
  return w
}

beforeEach(() => {
  i18n.global.locale.value = 'fr'
  poseCibles()
  // jsdom n'implémente pas scrollBy (avertissement « Not implemented ») : on le trace.
  window.scrollBy = vi.fn()
})
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  cibles.forEach((el) => el.remove())
})

describe('ReaderTour, enchaînement des bulles', () => {
  it('Suivant, Suivant puis Commencer : trois bulles dans l ordre, puis fin « start »', async () => {
    const w = await monte()
    const titre = () => w.find('.tour__title').text()
    const principal = () => w.find('[data-test="tour-next"]')

    expect(w.find('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect(titre()).toBe(tk('tour.size.title'))
    expect(w.text()).toContain(tk('tour.progress', { n: 1, total: 3 }))
    expect(principal().text()).toBe(tk('tour.next'))

    await principal().trigger('click')
    await flushPromises()
    expect(titre()).toBe(tk('tour.steps.title'))
    expect(w.text()).toContain(tk('tour.progress', { n: 2, total: 3 }))

    await principal().trigger('click')
    await flushPromises()
    expect(titre()).toBe(tk('tour.chart.title'))
    expect(principal().text()).toBe(tk('tour.start'))
    // Rien n'est émis avant le dernier appui.
    expect(w.emitted('done')).toBeUndefined()

    await principal().trigger('click')
    expect(w.emitted('done')).toEqual([['start']])
  })

  it('le focus est posé sur le bouton principal à chaque bulle', async () => {
    const w = await monte()
    expect(document.activeElement).toBe(w.find('[data-test="tour-next"]').element)
    await w.find('[data-test="tour-next"]').trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(w.find('[data-test="tour-next"]').element)
  })

  it('chaque bulle fait défiler sa cible (appel de scrollBy)', async () => {
    // jsdom rend des boîtes nulles : on donne à la cible une position hors de l'écran
    // pour que le recadrage ait un écart à combler.
    cibles[0].getBoundingClientRect = () => ({ top: 2000, left: 0, width: 300, height: 100, bottom: 2100, right: 300 })
    await monte()
    expect(window.scrollBy).toHaveBeenCalled()
    expect(window.scrollBy.mock.calls[0][0].top).toBeGreaterThan(0)
  })
})

describe('ReaderTour, sortie', () => {
  it('Passer ferme tout de suite, dès la première bulle', async () => {
    const w = await monte()
    await w.find('[data-test="tour-skip"]').trigger('click')
    expect(w.emitted('done')).toEqual([['skip']])
  })

  it('Échap vaut Passer', async () => {
    const w = await monte()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('done')).toEqual([['skip']])
  })
})

describe('ReaderTour, cibles', () => {
  it('une étape sans cible est sautée, et les points ne comptent que les présentes', async () => {
    const w = await monte(etapes({ sansSteps: true }))
    expect(w.findAll('.tour__dot')).toHaveLength(2)
    expect(w.text()).toContain(tk('tour.progress', { n: 1, total: 2 }))
    await w.find('[data-test="tour-next"]').trigger('click')
    await flushPromises()
    // La bulle « étapes » est sautée : on passe directement au diagramme, dernière bulle.
    expect(w.find('.tour__title').text()).toBe(tk('tour.chart.title'))
    expect(w.find('[data-test="tour-next"]').text()).toBe(tk('tour.start'))
  })

  it('aucune cible présente : la visite se termine aussitôt, sans rien afficher', async () => {
    const w = await monte([{ key: 'size', target: () => null }])
    expect(w.emitted('done')).toEqual([['skip']])
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })
})

describe('ReaderTour, le voile', () => {
  it('avale les appuis : un clic sur le voile n atteint pas la page', async () => {
    const w = await monte()
    const surPage = vi.fn()
    window.addEventListener('click', surPage)
    try {
      await w.find('[data-test="reader-tour-block"]').trigger('click')
      expect(surPage).not.toHaveBeenCalled()
      expect(w.emitted('done')).toBeUndefined()
    } finally {
      window.removeEventListener('click', surPage)
    }
  })
})

// Revue du lot du 23/09/2026 : une cible plus haute que l'écran (carte diagramme, longue
// section) était recouverte en bas par la bulle, là même où se trouve la bande du rang en
// cours. Règle : la part VISIBLE de la cible n'est jamais sous la bulle.
describe('ReaderTour, cible plus haute que l écran', () => {
  const H = 220 // hauteur simulée de la bulle (jsdom ne fait aucune mise en page)
  let hauteur
  beforeEach(() => {
    hauteur = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
      return this.classList.contains('tour__bubble') ? H : 0
    })
  })
  afterEach(() => hauteur.mockRestore())

  const boite = (top, height) => () => ({ top, left: 10, width: 300, height, bottom: top + height, right: 310 })
  const px = (v) => parseFloat(v)

  it('la bulle ne recouvre jamais la part visible de la cible, anneau coupé au-dessus d elle', async () => {
    cibles[0].getBoundingClientRect = boite(100, 3 * window.innerHeight)
    const w = await monte()
    const trou = w.find('.tour__hole').element.style
    const bulleTop = px(w.find('.tour__bubble').element.style.top)
    // La bulle reste dans l'écran…
    expect(bulleTop + H).toBeLessThanOrEqual(window.innerHeight)
    // …et la découpe (part visible de la cible) s'arrête au-dessus d'elle, anneau compris.
    expect(px(trou.top)).toBe(100)
    expect(px(trou.top) + px(trou.height) + 8).toBeLessThanOrEqual(bulleTop)
    expect(px(trou.height)).toBeGreaterThan(0)
  })

  it('le focus (bande du rang en cours) est amené dans la part visible, hors de la bulle', async () => {
    // Cible haute dont la partie importante est tout en bas : caler le haut de la cible
    // la laisserait sous la bulle, c'est donc elle qu'on recadre.
    const cible = cibles[2]
    cible.getBoundingClientRect = boite(0, 2000)
    const bande = document.createElement('div')
    cible.appendChild(bande)
    bande.getBoundingClientRect = boite(1900, 30)
    const w = await monte([{ key: 'chart', target: () => cible, focus: () => bande }])
    expect(window.scrollBy).toHaveBeenCalledTimes(1)
    const delta = window.scrollBy.mock.calls[0][0].top
    // Position de la bande APRÈS le défilement demandé, comparée à la place de la bulle
    // une fois la cible défilée d'autant.
    cible.getBoundingClientRect = boite(-delta, 2000)
    window.dispatchEvent(new Event('resize'))
    await new Promise((r) => requestAnimationFrame(r))
    await flushPromises()
    const bulleTop = px(w.find('.tour__bubble').element.style.top)
    const bandeTop = 1900 - delta
    expect(bandeTop).toBeGreaterThanOrEqual(0)
    expect(bandeTop + 30 + 8).toBeLessThanOrEqual(bulleTop)
  })

  it('prepare est appelé avec la cible avant la mesure', async () => {
    const prepare = vi.fn()
    await monte([{ key: 'chart', target: () => cibles[2], prepare }])
    expect(prepare).toHaveBeenCalledWith(cibles[2])
  })
})

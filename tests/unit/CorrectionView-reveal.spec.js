// @vitest-environment jsdom
// Cible d'ouverture de l'écran de correction : le curseur se pose sur la ligne
// désignée par le lecteur. ReaderTextEditor est mocké — la commande CM6 réelle
// est prouvée par reveal-line.spec.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'

const nav = vi.hoisted(() => ({
  route: { name: 'pattern-correct', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
  onBeforeRouteLeave: vi.fn(),
}))

const revealed = vi.hoisted(() => ({ calls: [] }))
vi.mock('@/components/ReaderTextEditor.vue', () => ({
  default: {
    name: 'ReaderTextEditor',
    props: ['md', 'images', 'sizeLabels'],
    setup(_, { expose }) {
      expose({ revealLine: (n) => { revealed.calls.push(n); return n !== null } })
      return () => null
    },
  },
}))

import CorrectionView from '@/views/CorrectionView.vue'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

const READER = {
  sizeLabels: ['S', 'M', 'L'],
  sections: [
    {
      id: 'corps',
      title: 'Corps',
      steps: [
        { t: 'Rang 1 : monter.' },
        { t: 'Rang 2 : tricoter.' },
        { t: 'Remarque.', note: true },
      ],
    },
    { id: 'manches', title: 'Manches', steps: [{ t: 'Rang 1 : augmenter.' }] },
  ],
}

const wrappers = []
async function mountCorrection(query) {
  const patternId = await db.patterns.add({ name: 'P', type: 'knitting', reader: READER })
  nav.route = { name: 'pattern-correct', params: { id: String(patternId) }, query }
  const w = mount(CorrectionView, { global: { plugins: [createPinia(), i18n] } })
  wrappers.push(w)
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r))
  }
  return w
}

beforeEach(async () => {
  setActivePinia(createPinia())
  revealed.calls = []
  await db.patterns.clear()
})
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('CorrectionView — cible d’ouverture', () => {
  it('pose le curseur sur la ligne de l’étape désignée', async () => {
    const w = await mountCorrection({ section: 'corps', line: '1' })
    const md = w.findComponent({ name: 'ReaderTextEditor' }).props('md')
    const lines = md.split('\n')
    expect(revealed.calls).toHaveLength(1)
    expect(lines[revealed.calls[0] - 1]).toContain('Rang 2')
  })

  it('vise une NOTE aussi bien qu’un rang', async () => {
    const w = await mountCorrection({ section: 'corps', line: '2' })
    const md = w.findComponent({ name: 'ReaderTextEditor' }).props('md')
    expect(md.split('\n')[revealed.calls[0] - 1]).toContain('Remarque')
  })

  it('ligne introuvable → repli sur la TÊTE DE SECTION, sans message', async () => {
    const w = await mountCorrection({ section: 'manches', line: '99' })
    const md = w.findComponent({ name: 'ReaderTextEditor' }).props('md')
    // `toMatch` et non `toBe` : `serialize.js` ajoute un attribut de catégorie
    // (`## Manches {sleeve}`) dès que `sectionKind(sec)` n’est pas `DEFAULT_KIND`.
    // Ce qui compte ici est le repli sur la TÊTE DE SECTION, pas le dialecte.
    expect(md.split('\n')[revealed.calls[0] - 1]).toMatch(/^## Manches/)
  })

  it('section introuvable → repli sur la TÊTE DE DOCUMENT', async () => {
    await mountCorrection({ section: 'col', line: '0' })
    expect(revealed.calls).toEqual([1])
  })

  it('sans paramètre de cible, aucun appel : le document s’ouvre en haut', async () => {
    await mountCorrection({})
    expect(revealed.calls).toEqual([])
  })

  it('une valeur de ligne non numérique retombe sur la tête de section', async () => {
    const w = await mountCorrection({ section: 'corps', line: 'abc' })
    const md = w.findComponent({ name: 'ReaderTextEditor' }).props('md')
    expect(md.split('\n')[revealed.calls[0] - 1]).toMatch(/^## Corps/)
  })

  // Round 1 (2026-08-21) — test de non-régression : un id qui NE dérive PAS
  // de son titre, comme dans les patrons de démonstration codés à la main
  // (`src/constants/demo/fr.js` : id `'bordure'`, titre « Bordure en côtes »,
  // slug(titre) = `'bordure-en-cotes'`). CorrectionView doit retrouver la
  // section par son id puis apparier sur son TITRE — jamais sur l'id lui-même
  // — sans quoi le curseur retombe silencieusement en tête de document (le
  // bug que ce round corrige).
  it('un id qui ne dérive pas du titre vise quand même sa section, pas la tête de document', async () => {
    const patternId = await db.patterns.add({
      name: 'P2',
      type: 'knitting',
      reader: {
        sizeLabels: ['S', 'M', 'L'],
        sections: [
          {
            id: 'bordure',
            title: 'Bordure en côtes',
            steps: [{ t: 'Monter 88 m.' }, { t: 'Placer un anneau marqueur.' }],
          },
        ],
      },
    })
    nav.route = { name: 'pattern-correct', params: { id: String(patternId) }, query: { section: 'bordure', line: '0' } }
    const w = mount(CorrectionView, { global: { plugins: [createPinia(), i18n] } })
    wrappers.push(w)
    for (let i = 0; i < 4; i++) {
      await flushPromises()
      await new Promise((r) => setTimeout(r))
    }
    const md = w.findComponent({ name: 'ReaderTextEditor' }).props('md')
    expect(revealed.calls).toHaveLength(1)
    expect(md.split('\n')[revealed.calls[0] - 1]).toContain('Monter 88 m.')
  })

  // Round 2 (2026-08-21) — rectificatif : viser une section par TITRE
  // (round 1) résout toujours à la PREMIÈRE section de ce titre. Avec deux
  // sections homonymes (id `corps` / `corps-1`, comme les dédoublonne
  // normalizeReaderForSave), viser la SECONDE par son id retomberait sur la
  // PREMIÈRE — un curseur posé dans la MAUVAISE section, de façon plausible
  // et silencieuse. Deux sections de même titre sont indiscernables dans le
  // Markdown : un résultat qui a l'air juste mais ne l'est pas est pire
  // qu'aucun résultat, parce que l'utilisatrice pourrait corriger la
  // mauvaise ligne sans le remarquer. CorrectionView doit donc détecter
  // l'ambiguïté et ne passer AUCUNE cible aux helpers — repli en tête de
  // document, comme une section introuvable.
  it('titre porté par plus d’une section → repli en tête de document, jamais la mauvaise section', async () => {
    const patternId = await db.patterns.add({
      name: 'P3',
      type: 'knitting',
      reader: {
        sizeLabels: ['S', 'M', 'L'],
        sections: [
          { id: 'corps', title: 'Corps', steps: [{ t: 'Rang A.' }] },
          { id: 'corps-1', title: 'Corps', steps: [{ t: 'Rang B.' }] },
        ],
      },
    })
    nav.route = { name: 'pattern-correct', params: { id: String(patternId) }, query: { section: 'corps-1', line: '0' } }
    const w = mount(CorrectionView, { global: { plugins: [createPinia(), i18n] } })
    wrappers.push(w)
    for (let i = 0; i < 4; i++) {
      await flushPromises()
      await new Promise((r) => setTimeout(r))
    }
    expect(revealed.calls).toEqual([1])
  })

  // Retour terrain (24/08/2026) : une section « diagramme incomplet » (kind:'diagramme'
  // sans chart ni image, cf. CorrectionView.spec.js « vignettes et détection ») propose un
  // bouton « Voir dans le texte » — ce test-ci prouve qu'il ramène bien le curseur sur la
  // ligne de TITRE de cette section (même mécanisme que la cible d'ouverture ?section=),
  // pas seulement qu'il ne plante pas.
  it('« Voir dans le texte » sur un diagramme incomplet pose le curseur sur sa ligne de titre', async () => {
    const patternId = await db.patterns.add({
      name: 'P4',
      type: 'crochet',
      reader: {
        sizeLabels: ['S'],
        sections: [
          { id: 'corps', title: 'Corps', steps: [{ t: 'Row 1.' }] },
          { id: 'img-photo-abcd1234-jpg', kind: 'diagramme', title: 'img/photo-abcd1234.jpg', steps: [] },
        ],
      },
    })
    nav.route = { name: 'pattern-correct', params: { id: String(patternId) }, query: {} }
    const w = mount(CorrectionView, { global: { plugins: [createPinia(), i18n] } })
    wrappers.push(w)
    for (let i = 0; i < 4; i++) {
      await flushPromises()
      await new Promise((r) => setTimeout(r))
    }
    await w.find('.chart-strip__toggle').trigger('click')
    await flushPromises()
    const goTo = w.findAll('button').find((b) => b.text().includes(tk('correction.brokenDiagramGoTo')))
    await goTo.trigger('click')
    const md = w.findComponent({ name: 'ReaderTextEditor' }).props('md')
    expect(revealed.calls).toHaveLength(1)
    expect(md.split('\n')[revealed.calls[0] - 1]).toMatch(/^## img\/photo-abcd1234\.jpg/)
  })
})

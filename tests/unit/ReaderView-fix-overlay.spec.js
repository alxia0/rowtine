// Geste « Corriger » du lecteur : poser, déplacer, retirer le voile. Ce fichier
// ne teste QUE le geste — la navigation et le chrono vivent dans
// ReaderView-fix-chrono.spec.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'

const nav = vi.hoisted(() => ({
  route: { name: 'project-read', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import ReaderView from '@/views/ReaderView.vue'

const FIX_READER = {
  sizeLabels: ['S', 'M', 'L'],
  sections: [
    {
      id: 'corps',
      title: 'Corps',
      steps: [
        { t: 'Monter {{0}} m end.', c: [[10, 12, 14]] }, // corps#0 (rang)
        { t: 'Rang 2 : tric.' },                          // corps#1 (rang)
        { t: 'Remarque : bla.', note: true },             // corps#2 (note)
      ],
    },
  ],
  reference: {
    abbr: { end: 'à l’endroit' },
    abbrLink: {},
    abbrFull: [['end', 'endroit']],
    tiles: [{ tab: 'abbr', title: 'Abréviations', sub: 'end' }],
    tabs: [{ id: 'abbr', label: 'Abréviations', blocks: [{ h3: 'Abr', abbrFull: true }] }],
  },
}

async function seedProject() {
  const patternId = await db.patterns.add({ name: 'Patron test', type: 'knitting', reader: FIX_READER })
  const projectId = await db.projects.add({ name: 'Projet test', technique: 'knitting', patternId })
  nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
  return { patternId, projectId }
}

const wrappers = []
function mountReader() {
  const w = mount(ReaderView, { global: { plugins: [createPinia(), i18n] }, attachTo: document.body })
  wrappers.push(w)
  return w
}
async function settle() {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r))
  }
  await flushPromises()
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.projects.clear()
  await db.patterns.clear()
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
})
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('ReaderView — voile de correction', () => {
  it('au repos, aucun voile', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    expect(w.findAll('.rfix')).toHaveLength(0)
  })

  it('un appui sur une carte pose le voile sur CETTE carte seule', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    // ⚠️ Viser les cartes par CLASSE et rang, jamais par `#rstep-corps\#0` :
    // `.rnote` ne porte aucun `id` (seuls les deux <article> en ont un), et un
    // sélecteur à `#` échappé est fragile pour rien.
    await w.findAll('.rstep')[0].find('.rstep__body').trigger('click')
    expect(w.findAll('.rfix')).toHaveLength(1)
    expect(w.findAll('.rstep')[0].find('.rfix').exists()).toBe(true)
  })

  it('un appui sur une AUTRE carte déplace le voile', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    await w.findAll('.rstep')[0].find('.rstep__body').trigger('click')
    await w.findAll('.rstep')[1].find('.rstep__body').trigger('click')
    expect(w.findAll('.rfix')).toHaveLength(1)
    expect(w.findAll('.rstep')[1].find('.rfix').exists()).toBe(true)
  })

  it('« Fermer » retire le voile', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    await w.findAll('.rstep')[0].find('.rstep__body').trigger('click')
    await w.find('.rfix__close').trigger('click')
    expect(w.findAll('.rfix')).toHaveLength(0)
  })

  it('un appui sur le FOND du voile le retire aussi (pas seulement « Fermer »)', async () => {
    // Round de correction 1 : sans `.stop` sur le `@click` du `<div class="rfix">`
    // (ReaderFixOverlay.vue), un clic sur le fond du voile émet bien `close`, mais
    // le clic natif remonte ensuite à la carte, qui porte `@click="onCardTap(...)"` :
    // `onCardTap` réarme `fixTarget.value = step.id` dans le MÊME cycle synchrone,
    // juste après que `close` l'ait mis à `null`. Le voile resterait affiché. On
    // vise ici `.rfix` lui-même — jamais `.rfix__close`, déjà couvert ci-dessus.
    await seedProject()
    const w = mountReader()
    await settle()
    await w.findAll('.rstep')[0].find('.rstep__body').trigger('click')
    await w.find('.rfix').trigger('click')
    expect(w.findAll('.rfix')).toHaveLength(0)
  })

  it('un appui sur la case COCHE, sans poser le voile', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()
    await w.findAll('.rstep')[0].find('.rcheck').trigger('click')
    await settle()
    expect(w.findAll('.rfix')).toHaveLength(0)
    const p = await db.projects.get(projectId)
    expect(p.readerState.done['corps#0']).toBe(true)
  })

  it('un appui sur une abréviation ouvre sa définition, sans poser le voile', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    await w.findAll('.rstep')[0].find('.rl-abbr').trigger('click')
    await settle()
    expect(w.findAll('.rfix')).toHaveLength(0)
    expect(w.find('#reader-pop').exists()).toBe(true)
  })

  it('une NOTE est aussi une cible', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    await w.find('.rnote').trigger('click')
    expect(w.find('.rnote .rfix').exists()).toBe(true)
  })

  it('déplacé sur une autre carte, le voile repart pour 3 secondes pleines', async () => {
    // Le remontage réinitialise le minuteur (ReaderFixOverlay.vue : posé dans
    // `onMounted`, annulé dans `onBeforeUnmount`) — un `v-if` qui change de
    // cible démonte l'ancien voile et en monte un neuf, donc le nouveau a son
    // plein budget. Timers réels pour le montage (`settle()` dépend de
    // `setTimeout` réels — voir son commentaire) ; on passe en fake timers
    // AVANT de poser le premier voile — sinon `vi.advanceTimersByTime(2000)`
    // ne fait rien avancer sur un minuteur réel posé plus tôt, et le test
    // « prouverait » seulement qu'un voile monté sous fake timers ferme à
    // 3000 ms, pas que le remontage réinitialise quoi que ce soit.
    await seedProject()
    const w = mountReader()
    await settle()

    vi.useFakeTimers()
    try {
      await w.findAll('.rstep')[0].find('.rstep__body').trigger('click')
      vi.advanceTimersByTime(2000) // 2 s écoulées sur le voile de la carte 0
      await w.findAll('.rstep')[1].find('.rstep__body').trigger('click') // déplacement → remontage
      vi.advanceTimersByTime(2900) // en cumulé sur l'ancien budget (2000+2900=4900), le voile déplacé tient encore
      await flushPromises() // le `close` du minuteur ne rendrait qu'au tick suivant
      expect(w.findAll('.rfix')).toHaveLength(1)
      expect(w.findAll('.rstep')[1].find('.rfix').exists()).toBe(true)
      vi.advanceTimersByTime(100) // franchit les 3000 ms PLEINES du voile déplacé (2900+100)
      await flushPromises()
      expect(w.findAll('.rfix')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('aperçu bibliothèque : aucun voile, l’entrée globale reste', async () => {
    const patternId = await db.patterns.add({ name: 'P', type: 'knitting', reader: FIX_READER })
    nav.route = { name: 'pattern-read', params: { id: String(patternId) }, query: {} }
    const w = mountReader()
    await settle()
    await w.findAll('.rstep')[0].find('.rstep__body').trigger('click')
    expect(w.findAll('.rfix')).toHaveLength(0)
    expect(w.find('.ro-correct').exists()).toBe(true)
  })
})

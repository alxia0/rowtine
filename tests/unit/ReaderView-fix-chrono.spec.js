// @vitest-environment jsdom
// Geste « Corriger » du lecteur : l'aller (chrono en pause, relais posé, navigation
// vers l'éditeur) et le retour (chrono repris), précédés du geste lui-même (poser,
// déplacer, retirer le voile), premier bloc du fichier. Depuis le lot
// « chrono unifié » (2026-08-30), la séance ne se ferme plus à AUCUNE sortie d'écran
// — l'écran de correction est dans la bulle du projet, le garde du routeur ne tire
// pas vers lui ; l'aller-retour reste une seule et même séance, remise en marche au
// retour si elle tournait (relais `chronoWasRunning`, l'unique témoin transporté).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import { useActiveSessionStore } from '@/stores/activeSession'
import { useCorrectionHandoff } from '@/stores/correction-handoff'

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
// Pinia PARTAGÉE quand on le demande (retour) : `useXStore()` appelé hors
// composant résout contre la pinia globalement ACTIVE au moment de l'appel
// (cf. pinia.js useStore()), pas contre celle que ce mount va installer. Sans
// réutiliser la même instance, préparer l'état AVANT de monter (scénario
// « retour de l'éditeur ») écrirait dans une pinia que le composant ne verra
// jamais — même motif que project-detail-chrono.spec.js:171-187.
function mountReader(pinia = createPinia()) {
  setActivePinia(pinia)
  const w = mount(ReaderView, { global: { plugins: [pinia, i18n] }, attachTo: document.body })
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
  await db.sessions.clear()
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  nav.router.back.mockClear()
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

describe('ReaderView — « Corriger » : aller', () => {
  it('pose le relais, met le chrono en pause et ouvre l’éditeur sur la ligne', async () => {
    const { patternId, projectId } = await seedProject()
    const w = mountReader()
    await settle()
    const active = useActiveSessionStore()
    await active.play()
    expect(active.running).toBe(true)

    await w.findAll('.rstep')[1].find('.rstep__body').trigger('click')
    await w.find('.rfix__do').trigger('click')
    await settle()

    // Le chrono est en PAUSE, pas clos : la séance existe toujours.
    expect(active.running).toBe(false)
    expect(active.isActive).toBe(true)

    // Le retour ramènera sur la section, pas sur l’étape courante.
    expect(nav.router.replace).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ section: 'corps' }) }),
    )
    // Deux paramètres SÉPARÉS : `?step=corps#1` couperait la requête au `#`.
    expect(nav.router.push).toHaveBeenCalledWith({
      name: 'pattern-correct',
      params: { id: patternId },
      query: { section: 'corps', line: 1 },
    })

    const relay = useCorrectionHandoff().pending
    expect(relay).toEqual({
      projectId,
      sectionId: 'corps',
      stepIndex: 1,
      chronoWasRunning: true,
    })
    // Le voile se retire au départ : au retour, la carte est rendue à ses gestes.
    expect(w.findAll('.rfix')).toHaveLength(0)
  })

  // Retour terrain du 2026-08-23 : le titre de section est lui aussi
  // une cible « Corriger », sans `stepIndex` — `CorrectionView.vue` retombe
  // sur `sectionLine` (le numéro de ligne du `## Titre`) en son absence.
  it('un appui sur le TITRE de section pose le voile et navigue sans `line`', async () => {
    const { patternId } = await seedProject()
    const w = mountReader()
    await settle()

    await w.find('.rsec__head').trigger('click')
    expect(w.findAll('.rfix')).toHaveLength(1)
    expect(w.find('.rsec__head .rfix').exists()).toBe(true)

    await w.find('.rfix__do').trigger('click')
    await settle()

    expect(nav.router.replace).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ section: 'corps' }) }),
    )
    expect(nav.router.push).toHaveBeenCalledWith({
      name: 'pattern-correct',
      params: { id: patternId },
      query: { section: 'corps' },
    })
    const relay = useCorrectionHandoff().pending
    expect(relay.sectionId).toBe('corps')
    expect(relay.stepIndex).toBeUndefined()
    expect(w.findAll('.rfix')).toHaveLength(0)
  })

  it('chrono à l’arrêt : le relais le dit, aucune reprise ne sera tentée', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    await w.findAll('.rstep')[0].find('.rstep__body').trigger('click')
    await w.find('.rfix__do').trigger('click')
    await settle()
    expect(useCorrectionHandoff().pending.chronoWasRunning).toBe(false)
  })

  it('la pause de correction COMMET le temps couru ; le démontage n’écrit rien de plus', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()
    const active = useActiveSessionStore()
    await active.play()
    await new Promise((r) => setTimeout(r, 1100)) // au moins une seconde à compter

    await w.findAll('.rstep')[0].find('.rstep__body').trigger('click')
    await w.find('.rfix__do').trigger('click')
    await settle()

    // Contrat « séances live » : la pause du geste Corriger est COMMITTANTE — le temps
    // couru part immédiatement au journal, dans la ligne de l'épisode (UNE écriture).
    // Mutation interceptée : une pause redevenue non journalisante (contrat d'avant le
    // lot) laisserait 0 ligne ici → rouge. La durée se juge sur l'horloge réelle (ce banc
    // ne truque pas Date.now) : au moins la seconde écoulée, portée par l'unique ligne.
    const rows = await db.sessions.where({ projectId }).toArray()
    expect(rows.length).toBe(1)
    expect(rows[0].durationSec).toBeGreaterThanOrEqual(1)

    // L'éditeur est DANS la bulle : le démontage ne ferme plus rien, donc n'écrit rien de
    // plus — la ligne de l'épisode reste unique tant que la séance n'est pas close hors
    // bulle. Mutation interceptée : une journalisation revenue au démontage → 2 lignes.
    w.unmount()
    await settle()
    expect(await db.sessions.where({ projectId }).count()).toBe(1)
  })
})

describe('ReaderView — « Corriger » : retour', () => {
  it('reprend le chrono qui tournait à l’aller', async () => {
    const { projectId } = await seedProject()
    // Pinia partagée : voir le commentaire de mountReader() plus haut — l'état
    // ci-dessous doit être visible par LE MÊME composant que celui monté plus bas.
    const pinia = createPinia()
    setActivePinia(pinia)
    const handoff = useCorrectionHandoff()
    // Le lecteur est remonté au retour de l’éditeur : la séance est encore
    // active sur le même couple (projet, sentinelle), en pause depuis le départ.
    const active = useActiveSessionStore()
    await active.openFor(projectId, 0, 0)
    handoff.set({
      projectId,
      sectionId: 'corps',
      stepIndex: 0,
      chronoWasRunning: true,
    })

    const w = mountReader(pinia)
    await settle()

    expect(active.running).toBe(true)
    expect(handoff.pending).toBe(null) // take() a vidé le relais
    // Le démontage ne ferme plus rien : la séance est TOUJOURS là (c'est le garde du
    // routeur, hors de ce test au routeur mocké, qui décidera en sortant du projet).
    w.unmount()
    await settle()
    expect(active.isActive).toBe(true)
  })

  it('chrono en pause à l’aller : il reste en pause au retour', async () => {
    const { projectId } = await seedProject()
    const pinia = createPinia()
    setActivePinia(pinia)
    const active = useActiveSessionStore()
    await active.openFor(projectId, 0, 0)
    useCorrectionHandoff().set({
      projectId,
      sectionId: 'corps',
      stepIndex: 0,
      chronoWasRunning: false,
    })
    mountReader(pinia)
    await settle()
    expect(active.running).toBe(false)
  })

  it('relais d’un AUTRE projet : jeté, jamais consommé', async () => {
    const { projectId } = await seedProject()
    const pinia = createPinia()
    setActivePinia(pinia)
    const active = useActiveSessionStore()
    await active.openFor(projectId, 0, 0)
    const handoff = useCorrectionHandoff()
    handoff.set({
      projectId: projectId + 999,
      sectionId: 'corps',
      stepIndex: 0,
      chronoWasRunning: true,
    })
    mountReader(pinia)
    await settle()
    // Pire cas résiduel : une séance restée en pause — ce que fait déjà le
    // bouton pause. Le relais est vidé quoi qu’il arrive.
    expect(active.running).toBe(false)
    expect(handoff.pending).toBe(null)
  })

  // Point 1 (revue) : `?section=<id>` est posé sur l'URL AVANT de partir corriger
  // (ReaderView.vue:670, `router.replace({ query: { ...route.query, section: sec.id } })`) —
  // c'est donc cette URL qui est retrouvée au retour. Si la correction a renommé la section
  // visée, son id DOM n'existe plus : `getElementById` renvoie `null` et un simple `?.` ne
  // fait plus rien, on resterait en haut du patron. Le repli doit tomber sur le rang en cours.
  it('retour avec ?section= visant une section renommée par la correction : repli sur le rang en cours', async () => {
    const RENAMED_READER = {
      ...FIX_READER,
      sections: [{ ...FIX_READER.sections[0], id: 'corps-v2' }],
    }
    const patternId = await db.patterns.add({ name: 'Patron test', type: 'knitting', reader: RENAMED_READER })
    const projectId = await db.projects.add({
      name: 'Projet test',
      technique: 'knitting',
      patternId,
      readerState: { done: { 'corps-v2#0': true } },
    })
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: { section: 'corps' } }
    const scrollCalls = []
    Element.prototype.scrollIntoView = vi.fn(function (opts) {
      scrollCalls.push({ id: this.id, opts })
    })
    mountReader()
    await settle()
    expect(scrollCalls).toEqual([{ id: 'rstep-corps-v2#1', opts: { behavior: 'auto', block: 'center' } }])
  })
})

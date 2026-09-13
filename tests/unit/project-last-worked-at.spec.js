// Unitaire — témoin « dernière séance de tricot » (`project.lastWorkedAt`), décision produit 25/07.
// La tuile « Reprendre » de l'accueil doit suivre le dernier projet sur lequel on a réellement
// AVANCÉ (coché un rang ou une section, avancé une grille, bougé un compteur) — et NON le dernier
// projet écrit, car renommer un projet ou choisir une taille sont des réglages, pas du tricot.
//
// Ce fichier prouve les deux moitiés du contrat :
//   1. ce qui ARME le témoin (cocher un rang dans le suivi, +/− d'un compteur d'étape) ;
//   2. ce qui ne l'arme PAS (choisir une taille, éditer la fiche) — la moitié qu'un test naïf
//      oublie, et sans laquelle le champ vaudrait exactement `updatedAt`.
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

// Reader minimal avec DEUX tailles (pour pouvoir cliquer une pastille de taille) et deux rangs.
const READER = {
  sizeLabels: ['S', 'M'],
  sections: [
    {
      id: 'a',
      title: 'Dos',
      steps: [
        { id: 's1', t: 'Rang 1 : tout à l’endroit' },
        { id: 's2', t: 'Rang 2 : tout à l’envers' },
      ],
    },
  ],
}

async function seedProject() {
  const patternId = await db.patterns.add({ name: 'Libre', type: 'knitting', reader: READER })
  const projectId = await db.projects.add({
    name: 'P',
    technique: 'knitting',
    status: 'wip',
    patternId,
    needles: [{ mm: '', us: '' }],
    showTimer: false, // pas de chrono : rien d'autre n'écrit sur le projet pendant le test
  })
  nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
  return projectId
}

// Nombre de rangs cochés dans l'état enregistré du projet.
function doneCount(project) {
  return Object.values(project?.readerState?.done || {}).filter(Boolean).length
}

const wrappers = []
function mountReader() {
  const w = mount(ReaderView, { global: { plugins: [createPinia(), i18n] } })
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
  localStorage.clear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('lastWorkedAt — armé par les gestes de progression', () => {
  it('cocher un rang dans le suivi horodate la séance de tricot', async () => {
    const projectId = await seedProject()
    const w = mountReader()
    await settle()

    expect((await db.projects.get(projectId)).lastWorkedAt).toBeFalsy()

    await w.findAll('.rcheck')[0].trigger('click')
    await settle()

    const after = await db.projects.get(projectId)
    expect(after.lastWorkedAt).toBeTruthy()
    // Vraie date ISO, pas une chaîne quelconque.
    expect(Number.isNaN(Date.parse(after.lastWorkedAt))).toBe(false)
    // Le rang coché est bien enregistré : le témoin accompagne une VRAIE progression.
    // (Les clés de `done` sont les ids d'étape recalculés par le lecteur — `sec.id#index` —, on
    // vérifie donc qu'UNE coche existe plutôt que de coder en dur un identifiant interne.)
    expect(doneCount(after)).toBe(1)
  })

  it('🚩 choisir une taille n’est PAS du tricot : le témoin reste vide', async () => {
    const projectId = await seedProject()
    const w = mountReader()
    await settle()

    await w.findAll('.szpill')[1].trigger('click')
    await settle()

    const after = await db.projects.get(projectId)
    // La taille a bien été enregistrée (le geste n'est pas ignoré)…
    expect(after.activeSize).toBe('M')
    // … mais il ne doit PAS faire remonter le projet dans la tuile « Reprendre ».
    expect(after.lastWorkedAt).toBeFalsy()
  })

  it('décocher un rang compte aussi comme du tricot (correction en cours de séance)', async () => {
    const projectId = await seedProject()
    const w = mountReader()
    await settle()
    await w.findAll('.rcheck')[0].trigger('click')
    await settle()
    const firstStamp = (await db.projects.get(projectId)).lastWorkedAt

    // On force un horodatage antérieur pour rendre l'avancée du témoin mesurable
    // (deux clics rapprochés peuvent tomber sur la même milliseconde).
    await db.projects.update(projectId, { lastWorkedAt: '2020-01-01T00:00:00.000Z' })
    await w.findAll('.rcheck')[0].trigger('click')
    await settle()

    const after = await db.projects.get(projectId)
    expect(after.lastWorkedAt).toBeTruthy()
    expect(after.lastWorkedAt > '2020-01-01T00:00:00.000Z').toBe(true)
    expect(firstStamp).toBeTruthy()
    expect(doneCount(after)).toBe(0) // le rang est bien décoché
  })
})

// Les deux gestes de progression qui vivent dans la FICHE projet (hors suivi). Ils passent par
// des chemins différents du lecteur — la case « section faite » écrit sur le projet, le compteur
// vit dans sa propre table — donc chacun a son propre câblage à prouver. Sans ces tests, un
// `markWorked` oublié ou visant un identifiant vide serait invisible : Dexie ignore en silence
// une mise à jour sur une clé inconnue, le compteur s'incrémenterait quand même et l'écran
// aurait l'air correct.
describe('lastWorkedAt — gestes de progression dans la fiche projet', () => {
  async function seedDetail() {
    const patternId = await db.patterns.add({ name: 'Libre', type: 'knitting', reader: READER })
    const projectId = await db.projects.add({
      name: 'P',
      technique: 'knitting',
      status: 'wip',
      patternId,
      needles: [{ mm: '', us: '' }],
    })
    nav.route = { name: 'project', params: { id: String(projectId) }, query: {} }
    return projectId
  }

  async function mountDetail() {
    const { default: ProjectDetailView } = await import('@/views/ProjectDetailView.vue')
    const w = mount(ProjectDetailView, {
      global: {
        plugins: [createPinia(), i18n],
        stubs: { StatusBadge: true, CounterForm: true },
      },
    })
    wrappers.push(w)
    return w
  }

  it('+/− sur un compteur du projet horodate la séance de tricot', async () => {
    const projectId = await seedDetail()
    const { useCountersStore } = await import('@/stores/counters')
    const w = await mountDetail()
    await settle()

    await useCountersStore().add(projectId, 'Rangs')
    await settle()
    const counter = useCountersStore().counters[0]
    expect((await db.projects.get(projectId)).lastWorkedAt).toBeFalsy()

    // Émis par CounterCard quand on tape sur + (le câblage @set → setCounter est ce qu'on teste).
    await w.findComponent({ name: 'CounterCard' }).vm.$emit('set', counter.id, 1)
    await settle()

    expect((await db.projects.get(projectId)).lastWorkedAt).toBeTruthy()
  })

  it('cocher la case « section faite » de la fiche horodate la séance de tricot', async () => {
    const projectId = await seedDetail()
    const w = await mountDetail()
    await settle()

    expect((await db.projects.get(projectId)).lastWorkedAt).toBeFalsy()

    await w.findComponent({ name: 'AppCheckbox' }).vm.$emit('update:modelValue', true)
    await settle()

    const after = await db.projects.get(projectId)
    expect(after.lastWorkedAt).toBeTruthy()
    expect(doneCount(after)).toBeGreaterThan(0) // la section est bien cochée
  })
})

describe('lastWorkedAt — store projets', () => {
  it('markWorked() horodate le projet sans rien écraser d’autre', async () => {
    const { useProjectsStore } = await import('@/stores/projects')
    const store = useProjectsStore()
    const id = await db.projects.add({ name: 'Q', status: 'wip', notes: 'ma note', needles: [{ mm: '', us: '' }] })
    await store.load()

    await store.markWorked(id)

    const after = await db.projects.get(id)
    expect(after.lastWorkedAt).toBeTruthy()
    expect(after.notes).toBe('ma note')
  })
})

// `startedAt` — décision produit du 12/09 : une utilisatrice qui ne renseigne jamais la date
// de début ne doit pas voir un projet sans date pour autant. Elle se pose SEULE fois, au
// premier signe d'activité — un geste de progression (même témoin que lastWorkedAt) OU un
// premier lancement de chrono (`ensureStarted`, qui n'arme JAMAIS lastWorkedAt : lancer un
// chrono n'est pas en soi tricoter, cf. le contrat de lastWorkedAt).
describe('startedAt — première séance', () => {
  it('cocher un rang dans le suivi pose la date de début si elle est vide', async () => {
    const projectId = await seedProject()
    const w = mountReader()
    await settle()
    expect((await db.projects.get(projectId)).startedAt).toBeFalsy()

    await w.findAll('.rcheck')[0].trigger('click')
    await settle()

    const after = await db.projects.get(projectId)
    expect(after.startedAt).toBeTruthy()
    expect(Number.isNaN(Date.parse(after.startedAt))).toBe(false)
  })

  it('une date de début déjà renseignée n’est jamais réécrite par un geste de progression', async () => {
    const patternId = await db.patterns.add({ name: 'Libre', type: 'knitting', reader: READER })
    const projectId = await db.projects.add({
      name: 'P', technique: 'knitting', status: 'wip', patternId,
      needles: [{ mm: '', us: '' }], showTimer: false, startedAt: '2020-01-01',
    })
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
    const w = mountReader()
    await settle()

    await w.findAll('.rcheck')[0].trigger('click')
    await settle()

    expect((await db.projects.get(projectId)).startedAt).toBe('2020-01-01')
  })

  it('ensureStarted() pose la date si elle est vide, sans toucher lastWorkedAt', async () => {
    const { useProjectsStore } = await import('@/stores/projects')
    const store = useProjectsStore()
    const id = await db.projects.add({ name: 'Q', status: 'wip', needles: [{ mm: '', us: '' }] })
    await store.load()

    await store.ensureStarted(id)

    const after = await db.projects.get(id)
    expect(after.startedAt).toBeTruthy()
    expect(after.lastWorkedAt).toBeFalsy() // lancer un chrono n'est pas tricoter
  })

  it('ensureStarted() ne réécrit jamais une date déjà renseignée', async () => {
    const { useProjectsStore } = await import('@/stores/projects')
    const store = useProjectsStore()
    const id = await db.projects.add({
      name: 'Q', status: 'wip', needles: [{ mm: '', us: '' }], startedAt: '2020-01-01',
    })
    await store.load()

    await store.ensureStarted(id)

    expect((await db.projects.get(id)).startedAt).toBe('2020-01-01')
  })
})

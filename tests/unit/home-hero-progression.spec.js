// @vitest-environment jsdom
// Unitaire — HomeView, héros « Reprendre » : le visuel de mailles (`StitchProgress`) et le
// « X % » ne s'affichent que si la progression DIT quelque chose — même prédicat que les
// cartes (ProjectCard.vue : `known && pct > 0`, règle du 31/08/2026). Retour utilisateur :
// un projet en cours jamais avancé (0/40) affichait « 0 % » au-dessus d'une rangée de
// mailles VIDES ; à 0 % il n'y a plus rien à la place — ni mailles vides, ni « 0 % », ni
// mention inventée. La tuile garde nom, ligne « où » (le « rang 0 / 40 » est une
// localisation, pas un avancement) et CTA.
//
// Cas de la spec (31/08 soir, §3) : 0/0, 0/40, 1/1000 (pct ARRONDI 0 → masqué, le prédicat
// porte sur le pourcentage après `Math.round`, pas sur `done > 0`), 5/40 (affiché « 13 % »).
//
// Motif de montage calqué sur home-resume-last-worked.spec.js (vue-router mocké, Dexie
// réelle via fake-indexeddb, enfants lourds stubbés).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRouter: () => nav.router }))

import HomeView from '@/views/HomeView.vue'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

// `needles` déjà au nouveau format : la migration paresseuse de `projectsStore.load()` ne
// s'exécute pas du tout — le fixture reste inerte, aucune écriture parasite.
function wipProject(name) {
  return {
    name,
    technique: 'knitting',
    status: 'wip',
    needles: [{ mm: '', us: '' }],
    sizes: [],
    photos: [],
    activeSectionId: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
  }
}

function addSection(projectId, { name, rowsTotal, rowsDone }) {
  return db.sections.add({
    projectId,
    name,
    rowsTotal,
    rowsDone,
    instructions: '',
    bySize: {},
    isDiagram: false,
    markedDone: false,
    order: 0,
  })
}

function mountHome() {
  return mount(HomeView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { ProjectCard: true, StitchProgress: true },
    },
  })
}

let projectId

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  await db.settings.put({ key: 'onboarded', value: true })
  projectId = await db.projects.add(wipProject('Châle Bellis'))
})

async function resumeTile(w) {
  await vi.waitFor(() => expect(w.find('.resume').exists()).toBe(true), { timeout: 10000 })
  return w.find('.resume')
}

// La ligne « où » porte le nom de la section : quand elle s'affiche, `heroSection` (donc la
// progression testée) est CHARGÉE — les assertions d'absence qui suivent ne courent plus
// derrière un montage asynchrone.
async function waitWhereLoaded(tile, sectionName) {
  await vi.waitFor(() => expect(tile.find('.resume__where').text()).toContain(sectionName), {
    timeout: 10000,
  })
}

// Cas sans section : aucun signal dans la tuile ne prouve la fin du chargement ; on attend
// `homeReady`, posé à la TOUTE FIN du `onMounted`, après `progressByProject()`.
async function waitHomeReady(w) {
  await vi.waitFor(() => expect(w.find('[data-test="home-loading"]').exists()).toBe(false), {
    timeout: 10000,
  })
}

describe('HomeView — héros « Reprendre » : progression masquée à 0 % (prédicat des cartes)', () => {
  it('total 0 (aucune section) : ni mailles, ni pourcentage — la tuile reste nom + CTA', async () => {
    const w = mountHome()
    const tile = await resumeTile(w)
    await waitHomeReady(w)
    expect(tile.find('.resume__stitch').exists()).toBe(false)
    expect(tile.find('.resume__pct').exists()).toBe(false)
    expect(tile.find('.resume__title').text()).toBe('Châle Bellis')
    expect(tile.find('.cta').exists()).toBe(true)
  })

  it('🚩 0/40 (jamais commencée) : ni mailles vides, ni « 0 % » — mais nom, « rang 0 / 40 » et CTA', async () => {
    const sectionId = await addSection(projectId, { name: 'Corps', rowsTotal: 40, rowsDone: 0 })
    await db.projects.update(projectId, { activeSectionId: sectionId })

    const w = mountHome()
    const tile = await resumeTile(w)
    await waitWhereLoaded(tile, 'Corps')
    expect(tile.find('.resume__stitch').exists()).toBe(false)
    expect(tile.find('.resume__pct').exists()).toBe(false)
    // Le « rang 0 / 40 » est une LOCALISATION dans le patron, pas un avancement : gardé.
    expect(tile.find('.resume__where').text()).toContain(tk('home.resumeRow', { done: 0, total: 40 }))
    expect(tile.find('.resume__title').text()).toBe('Châle Bellis')
    expect(tile.find('.cta').exists()).toBe(true)
  })

  it('1/1000 : le pourcentage ARRONDI vaut 0 % → masqué (le prédicat porte sur pct, pas sur done)', async () => {
    const sectionId = await addSection(projectId, { name: 'Dos', rowsTotal: 1000, rowsDone: 1 })
    await db.projects.update(projectId, { activeSectionId: sectionId })

    const w = mountHome()
    const tile = await resumeTile(w)
    await waitWhereLoaded(tile, 'Dos')
    expect(tile.find('.resume__stitch').exists()).toBe(false)
    expect(tile.find('.resume__pct').exists()).toBe(false)
  })

  it('5/40 : progression affichée, « 13 % » (même arrondi Math.round que ProjectCard)', async () => {
    const sectionId = await addSection(projectId, { name: 'Corps', rowsTotal: 40, rowsDone: 5 })
    await db.projects.update(projectId, { activeSectionId: sectionId })

    const w = mountHome()
    const tile = await resumeTile(w)
    await waitWhereLoaded(tile, 'Corps')
    expect(tile.find('.resume__stitch').exists()).toBe(true)
    expect(tile.find('.resume__pct').text()).toBe('13 %')
  })

  it('taille tricotée : libellé traduit d’un bloc, sans casse forcée (noms allemands capitalisés)', async () => {
    await db.projects.update(projectId, { activeSize: 'M' })
    const before = i18n.global.locale.value
    i18n.global.locale.value = 'de'
    try {
      const w = mountHome()
      const tile = await resumeTile(w)
      await vi.waitFor(() => expect(tile.find('.resume__where').text()).toBe(tk('home.resumeSize', { size: 'M' })), {
        timeout: 10000,
      })
    } finally {
      i18n.global.locale.value = before
    }
  })
})

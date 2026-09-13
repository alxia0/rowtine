// Unitaire — HomeView, tuile « Reprendre » : elle doit pointer le dernier projet TRAVAILLÉ,
// pas le dernier CRÉÉ (retour terrain 25/07). Le store `projects` renvoie la liste triée par id
// décroissant ; un simple `find(p => p.status === 'wip')` y sélectionne donc structurellement le
// projet en cours le plus RÉCEMMENT CRÉÉ — d'où le bug.
//
// 🚩 Le fixture est délibérément CONFLICTUEL, sinon le test passerait aussi avec le bug :
//   - « Châle Bellis » : inséré EN PREMIER (id le plus petit) mais `updatedAt` RÉCENT
//   - « Pull torsades » : inséré EN SECOND (id le plus grand) mais `updatedAt` ANCIEN
// Avec l'ancien code, la tuile affiche « Pull torsades » ; avec le correctif, « Châle Bellis ».
//
// Motif de montage calqué sur home-view.spec.js (vue-router mocké, Dexie réelle via
// fake-indexeddb, enfants lourds stubbés).
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

// `needles` déjà au nouveau format : la migration paresseuse de `projectsStore.load()` ne
// s'exécute pas du tout — le fixture reste inerte, aucune écriture parasite.
function wipProject(name, { createdAt, updatedAt }) {
  return {
    name,
    technique: 'knitting',
    status: 'wip',
    needles: [{ mm: '', us: '' }],
    sizes: [],
    photos: [],
    activeSectionId: null,
    createdAt,
    updatedAt,
  }
}

function mountHome() {
  return mount(HomeView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { ProjectCard: true, StitchProgress: true },
    },
  })
}

let oldestCreatedId
let newestCreatedId

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  await db.settings.put({ key: 'onboarded', value: true })
  await db.settings.put({ key: 'swipeHintSeen', value: true }) // pas de pop-up d'astuce en travers

  // Créé en PREMIER (id le plus petit) mais travaillé HIER → doit gagner.
  oldestCreatedId = await db.projects.add(
    wipProject('Châle Bellis', { createdAt: '2026-07-01T09:00:00.000Z', updatedAt: '2026-07-24T18:30:00.000Z' }),
  )
  // Créé en DERNIER (id le plus grand) mais plus retouché depuis le 2 juillet.
  newestCreatedId = await db.projects.add(
    wipProject('Pull torsades', { createdAt: '2026-07-20T09:00:00.000Z', updatedAt: '2026-07-02T10:00:00.000Z' }),
  )
})

async function resumeTile(w) {
  await vi.waitFor(() => expect(w.find('.resume').exists()).toBe(true), { timeout: 10000 })
  return w.find('.resume')
}

describe('HomeView — tuile « Reprendre » = dernier projet travaillé', () => {
  it('🚩 affiche le projet au `updatedAt` le plus récent, pas le dernier créé', async () => {
    const w = mountHome()
    const tile = await resumeTile(w)
    expect(tile.find('.resume__title').text()).toBe('Châle Bellis')
  })

  it('le bouton « Reprendre » ouvre bien CE projet (et pas le dernier créé)', async () => {
    const w = mountHome()
    const tile = await resumeTile(w)
    await tile.find('.cta').trigger('click')
    expect(nav.router.push).toHaveBeenCalledWith({ name: 'project', params: { id: oldestCreatedId } })
    expect(nav.router.push).not.toHaveBeenCalledWith({ name: 'project', params: { id: newestCreatedId } })
  })

  it('projets antérieurs au champ `updatedAt` : repli sur le plus récemment créé (aucune régression)', async () => {
    await Promise.all(db.tables.map((t) => t.clear()))
    await db.settings.put({ key: 'onboarded', value: true })
    await db.settings.put({ key: 'swipeHintSeen', value: true })
    await db.projects.add(wipProject('Ancien A', { createdAt: undefined, updatedAt: undefined }))
    const lastId = await db.projects.add(wipProject('Ancien B', { createdAt: undefined, updatedAt: undefined }))

    const w = mountHome()
    const tile = await resumeTile(w)
    expect(tile.find('.resume__title').text()).toBe('Ancien B')
    await tile.find('.cta').trigger('click')
    expect(nav.router.push).toHaveBeenCalledWith({ name: 'project', params: { id: lastId } })
  })

  // Décision produit 25/07 : « travaillé » = un rang coché, pas n'importe quelle écriture. Le
  // témoin dédié `lastWorkedAt` (armé par les seuls gestes de progression, cf.
  // project-last-worked-at.spec.js) PRIME donc sur `updatedAt`, qui bouge aussi pour un simple
  // renommage. Sans cette priorité, un projet juste renommé volerait la tuile à celui qu'on tricote.
  it('🚩 un projet tricoté hier bat un projet seulement renommé aujourd’hui', async () => {
    await db.projects.update(oldestCreatedId, {
      lastWorkedAt: '2026-07-24T18:30:00.000Z', // tricoté hier
      updatedAt: '2026-07-24T18:30:00.000Z',
    })
    await db.projects.update(newestCreatedId, {
      updatedAt: '2026-07-25T11:00:00.000Z', // renommé ce matin, jamais tricoté
    })

    const w = mountHome()
    const tile = await resumeTile(w)
    expect(tile.find('.resume__title').text()).toBe('Châle Bellis')
  })

  it('entre deux projets tricotés, c’est la séance la plus récente qui gagne', async () => {
    await db.projects.update(oldestCreatedId, { lastWorkedAt: '2026-07-20T09:00:00.000Z' })
    await db.projects.update(newestCreatedId, { lastWorkedAt: '2026-07-25T08:00:00.000Z' })

    const w = mountHome()
    const tile = await resumeTile(w)
    expect(tile.find('.resume__title').text()).toBe('Pull torsades')
  })

  it('la section affichée suit le projet retenu, même quand il change APRÈS le montage', async () => {
    const sectionId = await db.sections.add({
      projectId: oldestCreatedId,
      name: 'Empiècement',
      rowsTotal: 40,
      rowsDone: 12,
      instructions: '',
      bySize: {},
      isDiagram: false,
      markedDone: false,
      order: 0,
    })
    const otherSectionId = await db.sections.add({
      projectId: newestCreatedId,
      name: 'Manches',
      rowsTotal: 30,
      rowsDone: 3,
      instructions: '',
      bySize: {},
      isDiagram: false,
      markedDone: false,
      order: 0,
    })
    await db.projects.update(oldestCreatedId, { activeSectionId: sectionId })
    await db.projects.update(newestCreatedId, { activeSectionId: otherSectionId })

    const w = mountHome()
    const tile = await resumeTile(w)
    await vi.waitFor(() => expect(tile.find('.resume__where').text()).toContain('Empiècement'), { timeout: 10000 })

    // L'utilisatrice travaille l'autre projet : `updatedAt` bascule → la tuile ET la section suivent.
    const { useProjectsStore } = await import('@/stores/projects')
    await useProjectsStore().update(newestCreatedId, { notes: 'rang 4 fait' })
    await vi.waitFor(() => expect(w.find('.resume__title').text()).toBe('Pull torsades'), { timeout: 10000 })
    await vi.waitFor(() => expect(w.find('.resume__where').text()).toContain('Manches'), { timeout: 10000 })
  })
})

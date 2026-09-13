// Unitaire — le JOURNAL DES JOURS ACTIFS (lot 2, §7ter). `lastWorkedAt` est écrasé à chaque
// geste : cette table est le SEUL historique des jours où une action a eu lieu.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { recordActiveDay, allActiveDays } from '@/db/active-days'
import { ymdLocal } from '@/utils/time-periods'
import { useProjectsStore } from '@/stores/projects'
import i18n from '@/i18n'

// Routeur minimal pour monter ProjectEditView (cf. tests/unit/ProjectEditView.spec.js, même
// motif) — nécessaire pour le bloc « ProjectEditView ne doit jamais reporter le témoin » plus bas.
const nav = vi.hoisted(() => ({
  route: { params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRoute: () => nav.route, useRouter: () => nav.router }))

import ProjectEditView from '@/views/ProjectEditView.vue'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.activeDays.clear()
  await db.projects.clear()
})

describe('journal des jours actifs — la table', () => {
  it('la table `activeDays` existe au schéma courant et sa clé primaire est le jour', () => {
    expect(db.tables.map((t) => t.name)).toContain('activeDays')
    expect(db.activeDays.schema.primKey.keyPath).toBe('day')
  })

  it("deux gestes le MÊME jour n'écrivent QU'UNE ligne (idempotence par la clé primaire)", async () => {
    await recordActiveDay('2026-08-11T09:12:00.000Z')
    await recordActiveDay('2026-08-11T18:44:00.000Z')
    await recordActiveDay('2026-08-11T21:03:00.000Z')
    expect(await db.activeDays.count()).toBe(1)
  })

  it('deux jours différents font deux lignes', async () => {
    await recordActiveDay(new Date(2026, 7, 10, 12, 0, 0).toISOString())
    await recordActiveDay(new Date(2026, 7, 11, 12, 0, 0).toISOString())
    expect((await allActiveDays()).sort()).toEqual(['2026-08-10', '2026-08-11'])
  })

  it("une valeur qui n'est pas une date n'écrit RIEN et ne jette pas", async () => {
    // Sans la garde, `ymdLocal(new Date('n’importe quoi'))` produirait la clé primaire
    // 'NaN-NaN-NaN' : une ligne fantôme, indélogeable, comptée comme un jour par la série.
    await expect(recordActiveDay('pas une date')).resolves.toBeUndefined()
    await expect(recordActiveDay('')).resolves.toBeUndefined()
    await expect(recordActiveDay(undefined)).resolves.toBeUndefined()
    expect(await db.activeDays.count()).toBe(0)
  })
})

describe('journal des jours actifs — le jour est LOCAL, à l’ouest de Greenwich', () => {
  const TZ_ORIGINE = process.env.TZ
  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles'
  })
  afterEach(() => {
    if (TZ_ORIGINE === undefined) delete process.env.TZ
    else process.env.TZ = TZ_ORIGINE
  })

  it('TÉMOIN : la bascule de fuseau a réellement eu lieu — sinon ce bloc ne prouve rien', () => {
    // FAUSSE depuis la France. C'est le garde-fou de tout le reste du bloc.
    expect(ymdLocal(new Date('2026-08-10'))).toBe('2026-08-09')
  })

  it('un geste du 10 août à 18 h heure locale est inscrit au 10 août, pas au 11', async () => {
    // 18 h à Los Angeles = 01 h UTC le 11 : `toISOString().slice(0, 10)` rendrait '2026-08-11'.
    const instant = new Date(2026, 7, 10, 18, 0, 0)
    expect(instant.toISOString().slice(0, 10)).toBe('2026-08-11') // le piège, nommé
    await recordActiveDay(instant.toISOString())
    expect(await allActiveDays()).toEqual(['2026-08-10'])
  })
})

describe('journal des jours actifs — SITE 1 sur 4 : markWorked() direct', () => {
  it("markWorked() inscrit le jour d'aujourd'hui au journal", async () => {
    const store = useProjectsStore()
    const id = await db.projects.add({ name: 'Pull marin', status: 'wip', readerState: {} })
    await store.markWorked(id)
    expect(await allActiveDays()).toEqual([ymdLocal(new Date())])
  })

  it("une mise à jour SANS `lastWorkedAt` n'inscrit RIEN", async () => {
    const store = useProjectsStore()
    const id = await db.projects.add({ name: 'Pull marin', status: 'wip', readerState: {} })
    await store.update(id, { name: 'Pull marin II' })
    await store.update(id, { lastWorkedAt: '' }) // valeur vide d'`emptyProject()` : pas un geste
    expect(await db.activeDays.count()).toBe(0)
  })
})

describe('journal des jours actifs — le semis du premier lancement', () => {
  it("⛔ GARDE : le semis d'exemples n'écrit AUCUNE ligne de journal", async () => {
    // Pourquoi cette garde existe : si un semis futur passait par `update()` avec un
    // `lastWorkedAt`, le journal serait rempli DÈS L'INSTALLATION et la série mentirait au
    // premier lancement — et l'écran Statistiques quitterait son état vide sur une
    // base où l'utilisatrice n'a rien fait. Vérifié empiriquement, jamais déduit du fait
    // qu'`isDbRestorable` teste déjà `p.lastWorkedAt`.
    // Les deux fonctions réellement appelées par OnboardingView.vue:135-143 (le seul écran
    // qui sème), dans le même ordre.
    const { usePatternsStore } = await import('@/stores/patterns')
    await db.patterns.clear()
    await db.projects.clear()
    await db.activeDays.clear()

    const ids = await usePatternsStore().seedSamplesIfEmpty('fr')
    const seeded = await useProjectsStore().seedExamplesIfEmpty('knitting', null, {
      idea: { name: 'Idée', notes: 'note' },
      wip: { name: 'En cours', notes: 'note' },
    })

    // Garde-fou du test lui-même : si le semis n'a RIEN créé, l'assertion finale serait
    // vraie pour la mauvaise raison et ce test serait un vert vide.
    expect(Object.keys(ids).length).toBeGreaterThan(0)
    expect(await db.projects.count()).toBeGreaterThan(0)
    expect(seeded?.wipId).toBeDefined()

    expect(await db.activeDays.count()).toBe(0)
  })
})

describe('journal des jours actifs — ProjectEditView ne doit jamais reporter le témoin', () => {
  beforeEach(() => {
    nav.route.params = {}
    nav.route.query = {}
  })

  it("renommer un projet portant un `lastWorkedAt` ancien n'inscrit RIEN au journal", async () => {
    // Geste RÉEL : un projet a déjà tricoté (lastWorkedAt de juillet, comme chez une utilisatrice), on
    // ouvre son formulaire, on le renomme (un RÉGLAGE, pas une séance) et on enregistre.
    const pid = await db.projects.add({
      name: 'Pull marin',
      technique: 'knitting',
      status: 'wip',
      readerState: {},
      lastWorkedAt: '2026-07-02T10:00:00.000Z',
    })
    nav.route.params = { id: String(pid) }

    const w = mount(ProjectEditView, { global: { plugins: [createPinia(), i18n] } })
    await flushPromises()
    await vi.waitFor(() => expect(w.vm.hydrating).toBe(false), { timeout: 2000 })
    await flushPromises()

    await w.find('#name').setValue('Pull marin (renommé)')
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalled(), { timeout: 10000 })
    await flushPromises()

    // Garde-fou du test lui-même : si `save()` n'écrivait rien, l'assertion du journal serait
    // vraie pour la mauvaise raison — vérifier que le renommage a bien atteint la base.
    expect((await db.projects.get(pid)).name).toBe('Pull marin (renommé)')
    expect(await db.activeDays.count()).toBe(0)

    // Le témoin doit aussi SURVIVRE à l'enregistrement : ne pas se contenter de « rien n'a été
    // écrit au journal », prouver aussi que `lastWorkedAt` n'a pas été vidé au passage (un
    // `payload.lastWorkedAt = ''` au lieu d'un `delete` laisserait ce test vert, cf. rapport).
    expect((await db.projects.get(pid)).lastWorkedAt).toBe('2026-07-02T10:00:00.000Z')
  })
})

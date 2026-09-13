// Unitaire — store sessions : tri par date, filtrage par projet, cumul de temps,
// dernière ligne chrono d'un projet (décision fusion/split du store activeSession),
// garde « l'édition inline n'est pas un contact chrono ».
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { useSessionsStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('store sessions', () => {
  it('loadForProject ne garde que le projet visé, du plus récent au plus ancien', async () => {
    const store = useSessionsStore()
    await store.add({ projectId: 1, date: '2026-01-10', durationSec: 60 })
    await store.add({ projectId: 1, date: '2026-03-01', durationSec: 60 })
    await store.add({ projectId: 2, date: '2026-02-01', durationSec: 60 })

    await store.loadForProject(1)
    expect(store.sessions.map((s) => s.date)).toEqual(['2026-03-01', '2026-01-10'])
  })

  it('secondsSince cumule le temps de toutes les sessions depuis une date', async () => {
    const store = useSessionsStore()
    await store.add({ projectId: 1, date: '2026-06-01', durationSec: 100 })
    await store.add({ projectId: 2, date: '2026-06-20', durationSec: 200 })
    await store.add({ projectId: 1, date: '2026-05-01', durationSec: 999 }) // avant la borne

    const total = await store.secondsSince(new Date('2026-06-01'))
    expect(total).toBe(300)
  })

  it('allSessions renvoie toutes les sessions, tous projets confondus', async () => {
    const store = useSessionsStore()
    await store.add({ projectId: 1, date: '2026-06-01', durationSec: 100 })
    await store.add({ projectId: 2, date: '2026-06-20', durationSec: 200 })

    const all = await store.allSessions()
    expect(all).toHaveLength(2)
    expect(all.map((s) => s.durationSec).sort()).toEqual([100, 200])
  })

  it('recentSessions : tri antéchronologique, nom du projet joint, limite optionnelle', async () => {
    const store = useSessionsStore()
    const projectsStore = useProjectsStore()
    const a = await projectsStore.create({ name: 'Chaussettes' })
    const b = await projectsStore.create({ name: 'Pull' })
    await store.add({ projectId: a, date: '2026-01-10T10:00:00.000Z', durationSec: 60 })
    await store.add({ projectId: b, date: '2026-03-01T10:00:00.000Z', durationSec: 120 })
    await store.add({ projectId: a, date: '2026-02-15T10:00:00.000Z', durationSec: 90 })
    // Sans date : triée en dernier (même convention lexicographique que loadForProject,
    // l'ISO vide passe après tout le monde).
    await store.add({ projectId: b, date: '', durationSec: 30 })

    const rows = await store.recentSessions()
    expect(rows.map((r) => r.date.slice(0, 10))).toEqual(['2026-03-01', '2026-02-15', '2026-01-10', ''])
    expect(rows[0].projectName).toBe('Pull')
    expect(rows[1].projectName).toBe('Chaussettes')
    // Projet disparu : le nom tombe à '' (l'écran affiche alors son repli discret).
    await db.projects.delete(Number(a))
    await projectsStore.load()
    const after = await store.recentSessions()
    expect(after.find((r) => r.projectId === a).projectName).toBe('')
    // Limite : les N plus récentes seulement (interface promise à T5).
    const top2 = await store.recentSessions(2)
    expect(top2.map((r) => r.projectName)).toEqual(['Pull', ''])
  })

  it('remove renvoie la session et restore la réinsère', async () => {
    const store = useSessionsStore()
    await store.add({ projectId: 5, date: '2026-06-30', durationSec: 30 })
    await store.loadForProject(5)
    const id = store.sessions[0].id
    const removed = await store.remove(id)
    expect(store.sessions).toHaveLength(0)
    await store.restore(removed)
    expect(store.sessions).toHaveLength(1)
  })

  it('update : l écriture Dexie ne reçoit JAMAIS lastWriteAt — l édition n est pas un contact chrono', async () => {
    const store = useSessionsStore()
    await store.add({ projectId: 4, date: '2026-06-01T10:00:00.000Z', durationSec: 60 })
    await store.loadForProject(4)
    const id = store.sessions[0].id
    // Espion EN PASSANT-THROUGH (spyOn garde l'implémentation réelle) : c'est le PAYLOAD
    // reçu par Dexie qui fait foi — la garde vit dans le store, pas dans la base.
    const update = vi.spyOn(db.sessions, 'update')
    await store.update(id, { durationSec: 120, lastWriteAt: '2026-09-08T12:00:00.000Z' })
    const payload = update.mock.calls[0][1]
    // Mutation interceptée : passer `data` tel quel -> lastWriteAt rafraîchi par une simple
    // édition inline : la mèche des 2 h repartrait sur une ligne morte (fenêtre de fusion
    // ressuscitée, lastChronoSession réélue au prochain play). La durée, elle, passe.
    expect(payload).not.toHaveProperty('lastWriteAt')
    expect(payload.durationSec).toBe(120)
    // En base : ni champ réintroduit, ni durée perdue.
    const row = await db.sessions.get(id)
    expect(row.lastWriteAt).toBeUndefined()
    expect(row.durationSec).toBe(120)
  })

  it('lastChronoSession : la ligne NON manuelle au DERNIER CONTACT, du projet visé seulement', async () => {
    const NOW = 1_700_000_000_000
    const iso = (ms) => new Date(ms).toISOString()
    // Née il y a 3 jours, TOUCHÉE il y a 10 min par le chrono (lastWriteAt) : c'est ELLE
    // que la reprise doit adopter — la mèche des 2 h se mesure au dernier contact.
    const a = await db.sessions.add({
      projectId: 5, sectionId: 1, date: iso(NOW - 3 * 86_400_000),
      lastWriteAt: iso(NOW - 10 * 60_000), durationSec: 10,
    })
    // La plus récente du projet à la naissance… mais saisie à la main : exclue.
    await db.sessions.add({
      projectId: 5, sectionId: 2, date: iso(NOW - 5 * 60_000), durationSec: 99, manual: true,
    })
    // Née APRÈS A, jamais retouchée (pas de lastWriteAt, repli sur date) : plus ancienne au contact.
    const c = await db.sessions.add({
      projectId: 5, sectionId: 3, date: iso(NOW - 2 * 86_400_000), durationSec: 7,
    })
    // Très récente, mais d'un AUTRE projet : hors de la requête du projet 5.
    const d = await db.sessions.add({
      projectId: 6, sectionId: 0, date: iso(NOW - 60_000), durationSec: 5,
    })

    const store = useSessionsStore()
    // Mutation interceptée : tri par date de NAISSANCE (ou par id) sans lastWriteAt -> C
    // élue ; filtre `!manual` retiré -> la saisie main élue ; bornage projet absent -> D.
    const last5 = await store.lastChronoSession(5)
    expect(last5.id).toBe(a)
    expect(last5.id).not.toBe(c)
    expect((await store.lastChronoSession(6)).id).toBe(d)
    expect(await store.lastChronoSession(999)).toBe(null) // projet vierge : null, pas d'erreur
  })
})

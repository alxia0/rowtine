// tests/unit/sessions-view.spec.js
// Écran Sessions (T4, 31/08) : toutes les séances, tous projets, du
// plus récent au plus ancien, chaque ligne ouvrant la fiche de son projet.
//
// Montage calqué sur tests/unit/expenses-view.spec.js : i18n réel (pas de mock de `t`),
// Pinia réelle, base Dexie réelle (fake-indexeddb) écrite via les VRAIS stores — les
// données passent par le même chemin que dans l'app (recentSessions joint le nom du
// projet via useProjectsStore). AppHeader est stubbé ; le routeur est un mock minimal
// (l'écran n'appelle que router.push).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { db } from '@/db/db'
import { useSessionsStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import SessionsView from '@/views/SessionsView.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }
vi.mock('vue-router', () => ({
  useRouter: () => router,
}))

let wrapper

beforeEach(async () => {
  setActivePinia(createPinia())
  router.push.mockClear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

function mountView() {
  wrapper = mount(SessionsView, {
    global: { plugins: [i18n], stubs: { AppHeader: true, AppIcon: true, BackToTop: true } },
    attachTo: document.body,
  })
  return wrapper
}

describe('SessionsView', () => {
  it('liste les séances du plus récent au plus ancien, avec projet, date et durée', async () => {
    const projectsStore = useProjectsStore()
    const sessionsStore = useSessionsStore()
    const a = await projectsStore.create({ name: 'Chaussettes' })
    const b = await projectsStore.create({ name: 'Pull' })
    await sessionsStore.add({ projectId: a, date: '2026-01-10T10:00:00.000Z', durationSec: 3600 })
    await sessionsStore.add({ projectId: b, date: '2026-03-01T10:00:00.000Z', durationSec: 120 })
    await sessionsStore.add({ projectId: a, date: '2026-02-15T10:00:00.000Z', durationSec: 90 })

    const w = mountView()
    await flushPromises()

    const names = w.findAll('.ses-list__name').map((n) => n.text())
    expect(names).toEqual(['Pull', 'Chaussettes', 'Chaussettes']) // 01/03 avant 15/02 avant 10/01
    const metas = w.findAll('.ses-list__meta').map((n) => n.text())
    expect(metas[0]).toContain('2:00') // 120 s → « 2:00 », pas d'heure creuse
    expect(metas[2]).toContain('1:00:00') // 3600 s → format horaire « 1:00:00 »
  })

  it('un appui sur une ligne ouvre la fiche du projet correspondant', async () => {
    const projectsStore = useProjectsStore()
    const sessionsStore = useSessionsStore()
    const a = await projectsStore.create({ name: 'Chaussettes' })
    const b = await projectsStore.create({ name: 'Pull' })
    // La séance la plus RÉCENTE est celle du projet b : c'est la PREMIÈRE ligne qui doit
    // y mener — l'ordre affiché et la destination ne doivent pas se désynchroniser.
    await sessionsStore.add({ projectId: a, date: '2026-01-10T10:00:00.000Z', durationSec: 60 })
    await sessionsStore.add({ projectId: b, date: '2026-03-01T10:00:00.000Z', durationSec: 60 })

    const w = mountView()
    await flushPromises()

    await w.findAll('.ses-list__btn')[0].trigger('click')
    expect(router.push).toHaveBeenCalledWith({ name: 'project', params: { id: b } })
  })

  it('séance sans date : durée seule, jamais « Invalid Date » ni séparateur orphelin', async () => {
    const projectsStore = useProjectsStore()
    const sessionsStore = useSessionsStore()
    const a = await projectsStore.create({ name: 'Chaussettes' })
    await sessionsStore.add({ projectId: a, date: '2026-03-01T10:00:00.000Z', durationSec: 60 })
    await sessionsStore.add({ projectId: a, date: '', durationSec: 120 })

    const w = mountView()
    await flushPromises()

    const metas = w.findAll('.ses-list__meta').map((n) => n.text())
    expect(metas).toHaveLength(2)
    expect(metas[0]).toContain('01/03') // la datée trie en premier
    expect(metas[0]).not.toContain('Invalid Date')
    // La sans-date sort EN DERNIER (tri du store) et n'affiche que « 2:00 ».
    expect(metas[1]).toBe('2:00')
  })

  it('base vide : état vide avec indice, aucune ligne', async () => {
    const w = mountView()
    await flushPromises()

    expect(w.findAll('.ses-list__row')).toHaveLength(0)
    expect(w.text()).toContain(fr.sessions.empty)
    expect(w.text()).toContain(fr.sessions.emptyHint)
  })
})

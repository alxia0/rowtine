// @vitest-environment jsdom
// Unitaire — HomeView : tuile « Dernières sessions » (T5, 31/08 ; ligne
// « {jour} · {durée} » ajoutée par T4, 31/08 soir). Rendu CONDITIONNEL uniquement : la tuile
// n'existe que s'il y a au moins une séance, et montre au plus 2 séances (nom du projet en
// ligne principale, « jour · durée » en ligne secondaire). Le tri, la jointure du nom et la
// limite vivent dans le store (`recentSessions`, couvert par sessions.store.spec.js) :
// ici, l'action est stubbée (createTestingPinia) et retourne la fixture directement.
//
// Pas de base Dexie réelle : l'état du composant ne dépend QUE de ce que le stub renvoie.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@/i18n'
import HomeView from '@/views/HomeView.vue'
import { useSessionsStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import { useYarnsStore } from '@/stores/yarns'
import { usePatternsStore } from '@/stores/patterns'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => nav.router }))

const stubs = { ProjectCard: true, StitchProgress: true }

// `recent` : ce que le stub de `recentSessions` renvoie (défaut : aucune séance).
async function mountHome({ recent = [] } = {}) {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const sessionsStore = useSessionsStore(pinia)
  sessionsStore.recentSessions.mockResolvedValue(recent)
  // Les autres lectures du onMounted : vides, pour isoler la tuile sessions.
  const projectsStore = useProjectsStore(pinia)
  projectsStore.projects = []
  projectsStore.loaded = true
  const yarnsStore = useYarnsStore(pinia)
  yarnsStore.yarns = []
  yarnsStore.loaded = true
  const patternsStore = usePatternsStore(pinia)
  patternsStore.patterns = []
  patternsStore.loaded = true
  const w = mount(HomeView, { global: { plugins: [pinia, i18n], stubs } })
  await flushPromises()
  return w
}

function sessionsTile(w) {
  return w.find('[data-test="home-sessions"]')
}

beforeEach(() => {
  nav.router.push.mockClear()
})

describe('HomeView — tuile dernières sessions', () => {
  it('1. aucune séance : la tuile est absente', async () => {
    const w = await mountHome({ recent: [] })
    expect(sessionsTile(w).exists()).toBe(false)
  })

  it('2. des séances : 2 lignes max — nom en principale, « jour · durée » en secondaire (T4)', async () => {
    // L'horloge seule est figée (pas les timers, dont `flushPromises` dépend) : le lundi
    // 31 août 2026 10:00 rend les libellés de jour déterministes sur tout poste.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 31, 10, 0))
    try {
      const w = await mountHome({
        recent: [
          { id: 3, projectId: 1, date: '2026-08-30T10:00:00', durationSec: 5400, projectName: 'Chaussettes' },
          { id: 2, projectId: 2, date: '2026-08-29T10:00:00', durationSec: 1500, projectName: 'Châle' },
        ],
      })
      const tile = sessionsTile(w)
      expect(tile.exists()).toBe(true)
      const rows = tile.findAll('.tile__row')
      expect(rows).toHaveLength(2)
      // Ligne PRINCIPALE : le nom du projet — rien n'est perdu (T4, ne jamais perdre d'info).
      expect(rows[0].find('.tile__row-name').text()).toBe('Chaussettes')
      expect(rows[1].find('.tile__row-name').text()).toBe('Châle')
      // Ligne SECONDAIRE : « {jour} · {durée} », durée au format existant (fmtDuration,
      // le même que l'écran Sessions) ; jour calculé en temps local (dates sans 'Z' de la
      // fixture lues en local, comme le fait `new Date(iso sans Z)` dans la vue).
      expect(rows[0].find('.tile__row-sub').text()).toBe('Hier · 1:30:00')
      expect(rows[1].find('.tile__row-sub').text()).toBe('Samedi · 25:00')
      // La limite « 2 max » est posée par l'appelant : c'est BIEN 2 qui est demandé au store.
      const sessionsStore = useSessionsStore()
      expect(sessionsStore.recentSessions).toHaveBeenCalledWith(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('3. la tuile mène à la vue sessions au clic, sans aria-label', async () => {
    const w = await mountHome({
      recent: [{ id: 1, projectId: 1, date: '2026-08-30T10:00:00', durationSec: 600, projectName: 'Échantillon' }],
    })
    const tile = sessionsTile(w)
    // Même règle WCAG 2.5.3 que la tuile « cette semaine » : pas d'aria-label,
    // sinon le nom lisible écraserait les durées affichées.
    expect(tile.attributes('aria-label')).toBeUndefined()
    await tile.trigger('click')
    expect(nav.router.push).toHaveBeenCalledWith({ name: 'sessions' })
  })

  it('4. projet disparu (projectName vide) : repli sur le libellé discret, ligne rendue', async () => {
    const w = await mountHome({
      recent: [{ id: 9, projectId: 42, date: '2026-08-28T10:00:00', durationSec: 600, projectName: '' }],
    })
    expect(sessionsTile(w).find('.tile__row-name').text()).toBe(tk('sessions.unknownProject'))
  })
})

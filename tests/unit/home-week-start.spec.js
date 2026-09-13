// Unitaire — ÉVO E (11/08) : le premier jour de la semaine (Réglages) gouverne aussi la remise
// à zéro du total « cette semaine » de l'Accueil (tuile `home.thisWeek`).
//
// ⚠️ PIÈGE À VACUITÉ (leçon du dossier de ce projet) : une fixture sans AUCUNE séance le
// dimanche rendrait ce test vert QUELLE QUE SOIT la borne choisie — les deux réglages donneraient
// le même total, et l'assertion ne prouverait rien. On sème donc DÉLIBÉRÉMENT une séance sur le
// dimanche qui précède le lundi de la semaine de référence : sous « lundi », elle tombe la
// semaine PRÉCÉDENTE (exclue) ; sous « dimanche », elle tombe DANS la semaine courante (incluse).
// Même fixture, les deux réglages, deux résultats opposés — c'est ce qui rend la preuve possible.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@/i18n'
import HomeView from '@/views/HomeView.vue'
import { useSettingsStore } from '@/stores/settings'
import { useSessionsStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => nav.router }))

const stubs = { ProjectCard: true, StitchProgress: true }

// Mercredi 15 juillet 2026, 10h locales — semaine du lundi 13/07. Le dimanche qui précède ce
// lundi est le 12/07 : c'est LUI qui bascule d'une semaine à l'autre selon le réglage.
const REF = new Date(2026, 6, 15, 10, 0, 0)
const SUNDAY_SESSION = { projectId: 1, sectionId: 1, date: new Date(2026, 6, 12, 10, 0, 0).toISOString(), durationSec: 1800, rowsDone: 0 }

// `secondsSince` (stores/sessions.js) est une ACTION, stubbée par `createTestingPinia` — on lui
// fournit une implémentation FIDÈLE (même filtre `date >= sinceDate`, même somme) plutôt que de
// coder en dur un résultat : c'est ce qui fait que le test exerce réellement la borne que
// HomeView calcule, et pas seulement l'affichage d'un chiffre préparé à l'avance.
function mountHome({ weekStart = 1, sessions = [] } = {}) {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const settings = useSettingsStore(pinia)
  settings.weekStart = weekStart
  settings.loaded = true
  useProjectsStore(pinia).loaded = true
  const sessionsStore = useSessionsStore(pinia)
  sessionsStore.secondsSince.mockImplementation(async (sinceDate) =>
    sessions.filter((s) => s.date && new Date(s.date) >= sinceDate).reduce((acc, s) => acc + (s.durationSec || 0), 0),
  )
  return mount(HomeView, { global: { plugins: [pinia, i18n], stubs } })
}

// `.tile--sage` est la classe SPÉCIFIQUE de cette tuile (unique dans HomeView.vue) : plus fiable
// qu'une recherche par texte traduit, qui dépendrait de la locale active de l'instance i18n.
function thisWeekValue(w) {
  return w.find('.tile--sage .tile__v').text()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(REF)
})
afterEach(() => vi.useRealTimers())

describe('HomeView — le premier jour de la semaine (ÉVO E) gouverne le total « cette semaine »', () => {
  it('réglage LUNDI (défaut) : la séance du dimanche précédent tombe HORS de la semaine courante', async () => {
    const w = mountHome({ weekStart: 1, sessions: [SUNDAY_SESSION] })
    await flushPromises()
    expect(thisWeekValue(w)).toBe('0 h')
  })

  it('réglage DIMANCHE : la MÊME séance tombe DANS la semaine courante — même fixture, résultat opposé', async () => {
    const w = mountHome({ weekStart: 0, sessions: [SUNDAY_SESSION] })
    await flushPromises()
    expect(thisWeekValue(w)).not.toBe('0 h')
    expect(thisWeekValue(w)).toBe('0 h 30')
  })

  it('non-régression : sans 3e argument explicite, le comportement par défaut (lundi) est inchangé', async () => {
    // `weekStart` par défaut du store (1, jamais réglé ici) — reproduit un compte qui n'a
    // jamais ouvert les Réglages depuis ce lot.
    const pinia = createTestingPinia({ createSpy: vi.fn })
    useProjectsStore(pinia).loaded = true
    const sessionsStore = useSessionsStore(pinia)
    sessionsStore.secondsSince.mockImplementation(async (sinceDate) =>
      [SUNDAY_SESSION].filter((s) => s.date && new Date(s.date) >= sinceDate).reduce((acc, s) => acc + (s.durationSec || 0), 0),
    )
    const w = mount(HomeView, { global: { plugins: [pinia, i18n], stubs } })
    await flushPromises()
    expect(thisWeekValue(w)).toBe('0 h') // même verdict que « réglage LUNDI (défaut) » ci-dessus
  })
})

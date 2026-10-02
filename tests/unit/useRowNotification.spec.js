// @vitest-environment jsdom
// Notification du rang en cours côté lecteur : suit la progression, coche, incrémente et acquitte par le chemin du lecteur, permission demandée une fois.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, ref, reactive } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createTestI18n } from './helpers/i18n-router.js'
import { repeatTotal } from '../../src/utils/reader.js'
import { useSettingsStore } from '@/stores/settings'

const native = vi.hoisted(() => ({
  showRowNotification: vi.fn(async () => {}),
  cancelRowNotification: vi.fn(async () => {}),
  checkRowNotificationPermission: vi.fn(async () => 'granted'),
  requestRowNotificationPermission: vi.fn(async () => 'granted'),
  onRowAction: vi.fn(),
  isRowNotificationAvailable: vi.fn(() => true),
  readPendingRowAction: vi.fn(async () => null),
  clearPendingRowAction: vi.fn(async () => {}),
  ackRowAction: vi.fn(async () => {}),
}))
vi.mock('@/native/row-notification', () => native)
const capApp = vi.hoisted(() => ({ listeners: {}, removeResume: null, addListener: null }))
vi.mock('@capacitor/app', () => ({ App: { addListener: (...a) => capApp.addListener(...a) } }))

import { useRowNotification } from '@/composables/useRowNotification'

const READER = {
  sections: [
    { id: 'devant', title: 'Devant', steps: [{ t: 'Monter {{0}} mailles', c: [[80, 90]] }, { t: 'Rang deux' }] },
    { id: 'dos', title: 'Dos', steps: [{ t: 'Rang trois' }] },
  ],
}

let action // callback passé à onRowAction
let removeListener

function setup({
  enabled = true,
  done = {},
  counters = {},
  projectId = 7,
  canAsk = false,
  suspended = false,
  batteryIgnoring = true,
  readerData = READER,
  isChartVisible,
} = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const settings = useSettingsStore()
  // Opt-in (01/10) : le défaut du store est false — ces tests fixent le comportement du
  // lecteur quand la notification EST activée, ils la posent donc explicitement.
  // `Asked` aussi : l'ancien demandeur auto (askPermissionOnce, retiré au lot suivant)
  // doit rester inerte entre les deux tâches.
  settings.rowNotification = true
  settings.rowNotificationAsked = true
  const project = ref({ id: projectId, name: 'Pull test' })
  const reader = ref(readerData)
  const state = reactive({ size: null, done: { ...done }, counters: { ...counters }, chartRows: {} })
  // Même sémantique que ReaderView.toggleDone : un décochage SUPPRIME la clé.
  const toggleDone = vi.fn((id) => {
    state.done[id] = !state.done[id]
    if (!state.done[id]) delete state.done[id]
  })
  // Même sémantique que ReaderView.bumpCounter : borné à [0, total].
  const bumpCounter = vi.fn((step, delta) => {
    const total = repeatTotal(step, state.size)
    state.counters[step.id] = Math.max(0, Math.min(total, (state.counters[step.id] || 0) + delta))
  })
  const canAskPermission = ref(canAsk)
  const suspendedRef = ref(suspended)
  const batteryIgnoringRef = ref(batteryIgnoring)
  const Host = defineComponent({
    setup() {
      useRowNotification({
        enabled,
        project,
        reader,
        state,
        toggleDone,
        bumpCounter,
        isChartVisible,
        ready: canAskPermission,
        suspended: suspendedRef,
        batteryIgnoring: batteryIgnoringRef,
      })
      return () => null
    },
  })
  const wrapper = mount(Host, { global: { plugins: [createTestI18n(), pinia] } })
  return { wrapper, settings, project, reader, state, toggleDone, bumpCounter, canAskPermission, suspended: suspendedRef, batteryIgnoring: batteryIgnoringRef }
}

const i18n = createTestI18n()
const lastShown = () => native.showRowNotification.mock.calls.at(-1)?.[0]

beforeEach(() => {
  vi.clearAllMocks()
  native.checkRowNotificationPermission.mockImplementation(async () => 'granted')
  native.requestRowNotificationPermission.mockImplementation(async () => 'granted')
  removeListener = vi.fn()
  action = null
  native.onRowAction.mockImplementation(async (cb) => {
    action = cb
    return removeListener
  })
  native.isRowNotificationAvailable.mockImplementation(() => true)
  capApp.listeners = {}
  capApp.removeResume = vi.fn()
  capApp.addListener = vi.fn(async (name, cb) => {
    capApp.listeners[name] = cb
    return { remove: capApp.removeResume }
  })
})

describe('useRowNotification : porte d\'autorisation (spec 2026-10-01)', () => {
  it('batteryIgnoring faux : rien ne s\'affiche ; repassé vrai, la notification repart', async () => {
    const { batteryIgnoring } = setup({ batteryIgnoring: false })
    await flushPromises()
    expect(native.showRowNotification).not.toHaveBeenCalled()
    // Le watch du payload émet null → cancelRowNotification à vide : inoffensif, rien
    // n'était affiché.
    batteryIgnoring.value = true
    await flushPromises()
    expect(native.showRowNotification).toHaveBeenCalledTimes(1)
  })

  it('porte d\'affichage SEULEMENT : le rejeu d\'un appui retenu s\'applique, pop-up ouverte ou pas', async () => {
    native.readPendingRowAction.mockResolvedValueOnce({ projectId: 7, stepId: 'devant#0', delta: 1 })
    const { batteryIgnoring, canAskPermission, toggleDone } = setup({ batteryIgnoring: false, canAsk: false })
    canAskPermission.value = true
    await flushPromises()
    expect(toggleDone).toHaveBeenCalledTimes(1)
    expect(toggleDone).toHaveBeenCalledWith('devant#0')
    expect(native.clearPendingRowAction).toHaveBeenCalledTimes(1)
    // La charge du rejeu est partie hors porte : un show a suivi le cochage.
    expect(native.showRowNotification).not.toHaveBeenCalled()
    // La porte se rouvre : l'affichage suit.
    batteryIgnoring.value = true
    await flushPromises()
    expect(lastShown().stepId).toBe('devant#1')
  })

  it('plus AUCUNE demande automatique : la pop-up d\'onboarding est le seul chemin', async () => {
    native.checkRowNotificationPermission.mockResolvedValue('prompt')
    const { canAskPermission } = setup({ canAsk: true })
    await flushPromises()
    expect(native.checkRowNotificationPermission).not.toHaveBeenCalled()
    expect(native.requestRowNotificationPermission).not.toHaveBeenCalled()
  })
})

describe('useRowNotification : affichage', () => {
  it('au montage, montre le rang en cours du projet', async () => {
    setup()
    await flushPromises()
    expect(native.showRowNotification).toHaveBeenCalledTimes(1)
    expect(lastShown()).toMatchObject({ projectId: 7, stepId: 'devant#0', text: 'Monter 80 (90) mailles' })
  })

  it('un rang coché (st.done muté en place) : nouveau show avec le rang suivant', async () => {
    const { toggleDone } = setup()
    await flushPromises()
    toggleDone('devant#0')
    await flushPromises()
    expect(native.showRowNotification).toHaveBeenCalledTimes(2)
    expect(lastShown().stepId).toBe('devant#1')
  })

  it('un rang décoché (clé supprimée de st.done) : la notification revient à ce rang', async () => {
    const { toggleDone } = setup({ done: { 'devant#0': true } })
    await flushPromises()
    expect(lastShown().stepId).toBe('devant#1')
    toggleDone('devant#0')
    await flushPromises()
    expect(lastShown().stepId).toBe('devant#0')
  })

  it('st.done remplacé (rechargement après synchro) : la notification suit', async () => {
    const { state } = setup()
    await flushPromises()
    state.done = { 'devant#0': true, 'devant#1': true }
    await flushPromises()
    expect(lastShown().stepId).toBe('dos#0')
  })

  it('taille changée : nouveau show ; charge identique : aucun renvoi', async () => {
    const { state, reader } = setup()
    await flushPromises()
    reader.value = { sections: READER.sections.map((s) => ({ ...s })) }
    await flushPromises()
    expect(native.showRowNotification).toHaveBeenCalledTimes(1)
    state.size = 1
    await flushPromises()
    expect(native.showRowNotification).toHaveBeenCalledTimes(2)
    expect(lastShown().text).toBe('Monter 90 mailles')
  })

  it('dernier rang coché : cancel', async () => {
    const { toggleDone } = setup({ done: { 'devant#0': true, 'devant#1': true } })
    await flushPromises()
    native.cancelRowNotification.mockClear()
    toggleDone('dos#0')
    await flushPromises()
    expect(native.cancelRowNotification).toHaveBeenCalledTimes(1)
  })

  it('enabled faux (aperçu bibliothèque) : ni show, ni écouteur, ni demande de permission', async () => {
    setup({ enabled: false, canAsk: true })
    await flushPromises()
    expect(native.showRowNotification).not.toHaveBeenCalled()
    expect(native.onRowAction).not.toHaveBeenCalled()
    expect(native.checkRowNotificationPermission).not.toHaveBeenCalled()
    expect(native.requestRowNotificationPermission).not.toHaveBeenCalled()
  })

  it('visite guidée (suspended) : aucune notification tant qu’elle dure, ni au resume, puis le rang en cours', async () => {
    const { suspended } = setup({ suspended: true })
    await vi.waitFor(() => expect(capApp.listeners.resume).toBeTypeOf('function'))
    capApp.listeners.resume()
    await flushPromises()
    expect(native.showRowNotification).not.toHaveBeenCalled()
    suspended.value = false
    await flushPromises()
    expect(native.showRowNotification).toHaveBeenCalledTimes(1)
    expect(lastShown().stepId).toBe('devant#0')
  })

  it('visite guidée lancée pendant l’affichage : la notification est retirée', async () => {
    const { suspended } = setup()
    await flushPromises()
    native.cancelRowNotification.mockClear()
    suspended.value = true
    await flushPromises()
    expect(native.cancelRowNotification).toHaveBeenCalledTimes(1)
  })

  it('réglage coupé : cancel, puis plus aucun show', async () => {
    const { settings, toggleDone } = setup()
    await flushPromises()
    native.showRowNotification.mockClear()
    settings.rowNotification = false
    await flushPromises()
    expect(native.cancelRowNotification).toHaveBeenCalledTimes(1)
    toggleDone('devant#0')
    await flushPromises()
    expect(native.showRowNotification).not.toHaveBeenCalled()
  })
})

describe('useRowNotification : retour au premier plan', () => {
  it('resume : la charge courante est renvoyée (notification balayée, permission accordée ailleurs)', async () => {
    setup()
    await vi.waitFor(() => expect(capApp.listeners.resume).toBeTypeOf('function'))
    expect(native.showRowNotification).toHaveBeenCalledTimes(1)
    capApp.listeners.resume()
    await flushPromises()
    expect(native.showRowNotification).toHaveBeenCalledTimes(2)
    expect(native.showRowNotification.mock.calls[1][0]).toEqual(native.showRowNotification.mock.calls[0][0])
  })

  it('démontage : écouteur resume retiré, et un resume tardif ne montre rien', async () => {
    const { wrapper } = setup()
    await vi.waitFor(() => expect(capApp.listeners.resume).toBeTypeOf('function'))
    const resume = capApp.listeners.resume
    wrapper.unmount()
    expect(capApp.removeResume).toHaveBeenCalledTimes(1)
    native.showRowNotification.mockClear()
    resume()
    await flushPromises()
    expect(native.showRowNotification).not.toHaveBeenCalled()
  })

  it('écouteur resume posé après le démontage : retiré, sans rejet non géré', async () => {
    let resolveAdd
    capApp.addListener = vi.fn(() => new Promise((r) => { resolveAdd = r }))
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const { wrapper } = setup()
      await vi.waitFor(() => expect(capApp.addListener).toHaveBeenCalled())
      wrapper.unmount()
      // Fonction nue : un vi.fn suit la promesse rendue et en capterait le rejet.
      let removed = 0
      const remove = () => {
        removed += 1
        return Promise.reject(new Error('remove'))
      }
      resolveAdd({ remove })
      await flushPromises()
      await new Promise((r) => setTimeout(r, 10))
      expect(removed).toBe(1)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('hors natif : aucun écouteur resume', async () => {
    native.isRowNotificationAvailable.mockImplementation(() => false)
    setup()
    await flushPromises()
    expect(capApp.addListener).not.toHaveBeenCalled()
  })
})

describe('useRowNotification : bouton « Cocher le rang »', () => {
  it('stepId courant du même projet (projectId en nombre ou en chaîne) : toggleDone une fois', async () => {
    const { toggleDone } = setup({ projectId: '7' })
    await flushPromises()
    action({ projectId: 7, stepId: 'devant#0' })
    expect(toggleDone).toHaveBeenCalledTimes(1)
    expect(toggleDone).toHaveBeenCalledWith('devant#0')
  })

  it('pendant la visite guidée (suspended) : appui ignoré', async () => {
    const { toggleDone } = setup({ suspended: true })
    await flushPromises()
    action({ projectId: 7, stepId: 'devant#0' })
    expect(toggleDone).not.toHaveBeenCalled()
  })

  it('double appui (second rowAction avec l’ancien stepId) : jamais de décochage', async () => {
    const { toggleDone, state } = setup()
    await flushPromises()
    action({ projectId: 7, stepId: 'devant#0' })
    action({ projectId: 7, stepId: 'devant#0' })
    expect(toggleDone).toHaveBeenCalledTimes(1)
    expect(state.done['devant#0']).toBe(true)
  })

  it('action d’un autre projet : ignorée', async () => {
    const { toggleDone } = setup()
    await flushPromises()
    action({ projectId: 8, stepId: 'devant#0' })
    expect(toggleDone).not.toHaveBeenCalled()
  })
})

// Rang, compteur (3 répétitions), grille seule, puis rang : les trois kind de la notification.
const MIX = {
  sections: [
    { id: 'dos', title: 'Dos', steps: [{ t: 'Rang un' }, { repeat: true, t: 'Répéter 3 fois', total: [3] }] },
    { id: 'motif', title: 'Motif', chart: { rows: 24, cols: 8 }, steps: [{ chart: true }] },
    { id: 'manche', title: 'Manche', steps: [{ t: 'Rang manche' }] },
  ],
}
const onCounter = { readerData: MIX, done: { 'dos#0': true } }
const onChart = { readerData: MIX, done: { 'dos#0': true }, counters: { 'dos#1': 3 } }

describe('useRowNotification : compteurs et diagrammes', () => {
  it('+1 sur le compteur affiché : bumpCounter(step, 1), jamais toggleDone', async () => {
    const { bumpCounter, toggleDone } = setup(onCounter)
    await flushPromises()
    expect(lastShown()).toMatchObject({ kind: 'counter', stepId: 'dos#1' })
    action({ projectId: 7, stepId: 'dos#1' })
    expect(bumpCounter).toHaveBeenCalledTimes(1)
    expect(bumpCounter.mock.calls[0][0]).toMatchObject({ id: 'dos#1', repeat: true })
    expect(bumpCounter.mock.calls[0][1]).toBe(1)
    expect(toggleDone).not.toHaveBeenCalled()
  })

  it('-1 sur le compteur affiché : bumpCounter(step, -1)', async () => {
    const { bumpCounter, toggleDone } = setup({ ...onCounter, counters: { 'dos#1': 2 } })
    await flushPromises()
    action({ projectId: 7, stepId: 'dos#1', delta: -1 })
    expect(bumpCounter).toHaveBeenCalledTimes(1)
    expect(bumpCounter.mock.calls[0][1]).toBe(-1)
    expect(toggleDone).not.toHaveBeenCalled()
  })

  it('st.counters muté en place : nouveau show avec la nouvelle valeur', async () => {
    const { state } = setup(onCounter)
    await flushPromises()
    state.counters['dos#1'] = 2
    await flushPromises()
    expect(native.showRowNotification).toHaveBeenCalledTimes(2)
    expect(lastShown().title).toBe(i18n.global.t('rowNotif.counterTitle', { count: 2, total: 3, section: 'Dos' }))
  })

  it('compteur atteint par +1 : la notification rappelle le diagramme franchi', async () => {
    setup({ ...onCounter, counters: { 'dos#1': 2 } })
    await flushPromises()
    action({ projectId: 7, stepId: 'dos#1' })
    await flushPromises()
    expect(lastShown()).toMatchObject({ kind: 'chart', stepId: 'motif#0' })
  })

  it('Diagramme traité : acquitté, la charge passe à l\'étape, rien d\'écrit', async () => {
    const { toggleDone, bumpCounter } = setup(onChart)
    await flushPromises()
    expect(lastShown()).toMatchObject({ kind: 'chart', stepId: 'motif#0' })
    action({ projectId: 7, stepId: 'motif#0' })
    await flushPromises()
    expect(lastShown()).toMatchObject({ kind: 'row', stepId: 'manche#0' })
    expect(toggleDone).not.toHaveBeenCalled()
    expect(bumpCounter).not.toHaveBeenCalled()
  })

  it('stepId qui n\'est pas celui de la charge affichée : ignoré pour chaque kind', async () => {
    const row = setup({ readerData: MIX })
    await flushPromises()
    action({ projectId: 7, stepId: 'dos#1' })
    expect(row.toggleDone).not.toHaveBeenCalled()
    expect(row.bumpCounter).not.toHaveBeenCalled()

    const counter = setup(onCounter)
    await flushPromises()
    action({ projectId: 7, stepId: 'dos#0' })
    action({ projectId: 7, stepId: 'motif#0' })
    expect(counter.toggleDone).not.toHaveBeenCalled()
    expect(counter.bumpCounter).not.toHaveBeenCalled()
    expect(counter.state.done['dos#0']).toBe(true)

    const chart = setup(onChart)
    await flushPromises()
    action({ projectId: 7, stepId: 'manche#0' })
    action({ projectId: 7, stepId: 'dos#1' })
    await flushPromises()
    expect(chart.toggleDone).not.toHaveBeenCalled()
    expect(chart.bumpCounter).not.toHaveBeenCalled()
    expect(lastShown()).toMatchObject({ kind: 'chart', stepId: 'motif#0' })
  })

  it('visibilité du diagramme (règle de taille du lecteur) : suivie, invisible = aucun rappel', async () => {
    const visible = ref(false)
    setup({ ...onChart, isChartVisible: () => visible.value })
    await flushPromises()
    expect(lastShown()).toMatchObject({ kind: 'row', stepId: 'manche#0' })
    visible.value = true
    await flushPromises()
    expect(lastShown()).toMatchObject({ kind: 'chart', stepId: 'motif#0' })
  })

  it('double +1 synchrone : deux incréments, comme deux appuis sur le + du lecteur', async () => {
    const { bumpCounter, state } = setup(onCounter)
    await flushPromises()
    action({ projectId: 7, stepId: 'dos#1' })
    action({ projectId: 7, stepId: 'dos#1' })
    expect(bumpCounter).toHaveBeenCalledTimes(2)
    expect(state.counters['dos#1']).toBe(2)
  })

  it('+1 qui atteint le total : un second appui sur le compteur est ignoré', async () => {
    const { bumpCounter, state } = setup({ ...onCounter, counters: { 'dos#1': 2 } })
    await flushPromises()
    action({ projectId: 7, stepId: 'dos#1' })
    action({ projectId: 7, stepId: 'dos#1' })
    expect(bumpCounter).toHaveBeenCalledTimes(1)
    expect(state.counters['dos#1']).toBe(3)
  })

  it('double Diagramme traité : le second appui ne touche pas l\'étape suivante', async () => {
    const { toggleDone, bumpCounter } = setup(onChart)
    await flushPromises()
    action({ projectId: 7, stepId: 'motif#0' })
    action({ projectId: 7, stepId: 'motif#0' })
    await flushPromises()
    expect(toggleDone).not.toHaveBeenCalled()
    expect(bumpCounter).not.toHaveBeenCalled()
    expect(lastShown()).toMatchObject({ kind: 'row', stepId: 'manche#0' })
  })

  it('st.chartRows muté en place : nouveau show avec la position de la grille', async () => {
    const { state } = setup(onChart)
    await flushPromises()
    const before = native.showRowNotification.mock.calls.length
    state.chartRows.motif = 5
    await flushPromises()
    expect(native.showRowNotification).toHaveBeenCalledTimes(before + 1)
    expect(lastShown().text).toBe(i18n.global.t('rowNotif.chartRow', { row: 5, rows: 24 }))
  })

  // Chaque montage tient son propre ensemble d'acquittements (jamais partagé au niveau module).
  it('démontage : acquittements oubliés, un nouveau montage rappelle le diagramme', async () => {
    const { wrapper } = setup(onChart)
    await flushPromises()
    action({ projectId: 7, stepId: 'motif#0' })
    await flushPromises()
    expect(lastShown().kind).toBe('row')
    wrapper.unmount()
    setup(onChart)
    await flushPromises()
    expect(lastShown()).toMatchObject({ kind: 'chart', stepId: 'motif#0' })
  })
})

describe('useRowNotification : démontage', () => {
  it('cancel et retrait de l’écouteur', async () => {
    const { wrapper } = setup()
    await flushPromises()
    native.cancelRowNotification.mockClear()
    wrapper.unmount()
    expect(native.cancelRowNotification).toHaveBeenCalledTimes(1)
    expect(removeListener).toHaveBeenCalledTimes(1)
  })

  it('démontage avant la résolution de onRowAction : écouteur retiré dès son arrivée, action ignorée', async () => {
    let resolve
    native.onRowAction.mockImplementation((cb) => {
      action = cb
      return new Promise((r) => (resolve = r))
    })
    const { wrapper, toggleDone } = setup()
    wrapper.unmount()
    resolve(removeListener)
    await flushPromises()
    expect(removeListener).toHaveBeenCalledTimes(1)
    action({ projectId: 7, stepId: 'devant#0' })
    expect(toggleDone).not.toHaveBeenCalled()
  })
})

describe('useRowNotification : appui retenu quand l’app a été fermée', () => {
  it('lecteur prêt, appui visant l’étape courante : toggleDone, puis effacement', async () => {
    native.readPendingRowAction.mockResolvedValueOnce({ projectId: 7, stepId: 'devant#0', delta: 1 })
    const { canAskPermission, toggleDone } = setup({ canAsk: false })
    canAskPermission.value = true
    await flushPromises()
    expect(toggleDone).toHaveBeenCalledTimes(1)
    expect(toggleDone).toHaveBeenCalledWith('devant#0')
    expect(native.clearPendingRowAction).toHaveBeenCalledTimes(1)
    // Le cochage passe l'étape suivante dans la notification.
    expect(lastShown().stepId).toBe('devant#1')
  })

  it('compteur retenu : bumpCounter(step, delta) borné, jamais toggleDone', async () => {
    native.readPendingRowAction.mockResolvedValue({ projectId: 7, stepId: 'dos#1', delta: 1 })
    const plus = setup(onCounter)
    plus.canAskPermission.value = true
    await flushPromises()
    expect(plus.bumpCounter).toHaveBeenCalledTimes(1)
    expect(plus.bumpCounter.mock.calls[0][0]).toMatchObject({ id: 'dos#1', repeat: true })
    expect(plus.bumpCounter.mock.calls[0][1]).toBe(1)
    expect(plus.toggleDone).not.toHaveBeenCalled()
    expect(native.clearPendingRowAction).toHaveBeenCalledTimes(1)

    native.readPendingRowAction.mockResolvedValue({ projectId: 7, stepId: 'dos#1', delta: -1 })
    const minus = setup({ ...onCounter, counters: { 'dos#1': 2 } })
    minus.canAskPermission.value = true
    await flushPromises()
    expect(minus.bumpCounter).toHaveBeenCalledTimes(1)
    expect(minus.bumpCounter.mock.calls[0][1]).toBe(-1)
  })

  it('diagramme retenu : acquitté, la charge passe à l’étape, rien d’écrit', async () => {
    native.readPendingRowAction.mockResolvedValueOnce({ projectId: 7, stepId: 'motif#0', delta: 1 })
    const { canAskPermission, toggleDone, bumpCounter } = setup(onChart)
    canAskPermission.value = true
    await flushPromises()
    expect(lastShown()).toMatchObject({ kind: 'row', stepId: 'manche#0' })
    expect(toggleDone).not.toHaveBeenCalled()
    expect(bumpCounter).not.toHaveBeenCalled()
    expect(native.clearPendingRowAction).toHaveBeenCalledTimes(1)
  })

  it('appui périmé (stepId ≠ charge) : effacé, ignoré en silence', async () => {
    native.readPendingRowAction.mockResolvedValueOnce({ projectId: 7, stepId: 'devant#1', delta: 1 })
    const { canAskPermission, toggleDone, bumpCounter } = setup({ canAsk: false })
    canAskPermission.value = true
    await flushPromises()
    expect(toggleDone).not.toHaveBeenCalled()
    expect(bumpCounter).not.toHaveBeenCalled()
    expect(native.clearPendingRowAction).toHaveBeenCalledTimes(1)
  })

  it('charge nulle (tout est coché) : effacé sans application', async () => {
    native.readPendingRowAction.mockResolvedValueOnce({ projectId: 7, stepId: 'devant#0', delta: 1 })
    const { canAskPermission, toggleDone } = setup({
      canAsk: false,
      done: { 'devant#0': true, 'devant#1': true, 'dos#0': true },
    })
    canAskPermission.value = true
    await flushPromises()
    expect(toggleDone).not.toHaveBeenCalled()
    expect(native.clearPendingRowAction).toHaveBeenCalledTimes(1)
  })

  it('appui d’un autre projet : ni application, ni effacement', async () => {
    native.readPendingRowAction.mockResolvedValueOnce({ projectId: 8, stepId: 'devant#0', delta: 1 })
    const { canAskPermission, toggleDone } = setup({ canAsk: false })
    canAskPermission.value = true
    await flushPromises()
    expect(toggleDone).not.toHaveBeenCalled()
    expect(native.clearPendingRowAction).not.toHaveBeenCalled()
  })

  it('visite guidée au moment de l’application : rien, entrée conservée ; appliqué au retour', async () => {
    native.readPendingRowAction.mockResolvedValue({ projectId: 7, stepId: 'devant#0', delta: 1 })
    const { canAskPermission, suspended, toggleDone } = setup({ canAsk: false, suspended: true })
    canAskPermission.value = true
    await flushPromises()
    expect(toggleDone).not.toHaveBeenCalled()
    expect(native.clearPendingRowAction).not.toHaveBeenCalled()
    // Retour de la visite guidée : le même signal redevient vrai, le rejeu repart.
    suspended.value = false
    canAskPermission.value = false
    await flushPromises()
    canAskPermission.value = true
    await flushPromises()
    expect(toggleDone).toHaveBeenCalledWith('devant#0')
    expect(native.clearPendingRowAction).toHaveBeenCalledTimes(1)
  })

  it('réglage notifications coupé : le rejeu applique quand même la progression', async () => {
    native.readPendingRowAction.mockResolvedValueOnce({ projectId: 7, stepId: 'devant#0', delta: 1 })
    const { canAskPermission, settings, toggleDone } = setup({ canAsk: false })
    await flushPromises()
    expect(native.showRowNotification).toHaveBeenCalledTimes(1)
    settings.rowNotification = false
    await flushPromises()
    native.showRowNotification.mockClear()
    canAskPermission.value = true
    await flushPromises()
    expect(toggleDone).toHaveBeenCalledWith('devant#0')
    // La progression avance ; l'affichage, lui, reste coupé.
    expect(native.showRowNotification).not.toHaveBeenCalled()
    expect(native.clearPendingRowAction).toHaveBeenCalledTimes(1)
  })

  it('lecture rejetée : rien, pas d’effacement, aucune promesse rejetée non gérée', async () => {
    const unhandled = []
    const onUnhandled = (err) => unhandled.push(err)
    process.on('unhandledRejection', onUnhandled)
    try {
      native.readPendingRowAction.mockRejectedValueOnce(new Error('plugin absent'))
      const { canAskPermission, toggleDone } = setup({ canAsk: false })
      canAskPermission.value = true
      await flushPromises()
      expect(toggleDone).not.toHaveBeenCalled()
      expect(native.clearPendingRowAction).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toEqual([])
  })

  it('deux déclencheurs rapprochés : une seule application', async () => {
    let resolveRead
    native.readPendingRowAction.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRead = resolve }),
    )
    const { canAskPermission, toggleDone, state } = setup({ canAsk: false })
    canAskPermission.value = true
    await flushPromises()
    // Première lecture en vol, promise retenue ; le signal repart pendant ce temps.
    expect(resolveRead).toBeTypeOf('function')
    canAskPermission.value = false
    await flushPromises()
    canAskPermission.value = true
    await flushPromises()
    resolveRead({ projectId: 7, stepId: 'devant#0', delta: 1 })
    await flushPromises()
    expect(toggleDone).toHaveBeenCalledTimes(1)
    expect(state.done['devant#0']).toBe(true)
    expect(native.clearPendingRowAction).toHaveBeenCalledTimes(1)
  })
})

describe('useRowNotification : suit le dernier geste (intent 2026-09-30)', () => {
  it('le REMPLACEMENT de st.last fait recalculer la notification (Julie saute de section)', async () => {
    const { state } = setup({ done: { 'devant#0': true } })
    await flushPromises()
    expect(lastShown().stepId).toBe('devant#1')
    // Julie coche « Rang trois » (dos#0) sans avoir tricoté devant#1 : le dernier geste la
    // place là, la notification le suit — st.last est toujours remplacé (jamais muté), la
    // simple lecture de la propriété doit suffire à abonner le computed.
    state.last = { kind: 'step', id: 'dos#0' }
    await flushPromises()
    expect(native.showRowNotification).toHaveBeenCalledTimes(2)
    expect(lastShown().stepId).toBe('dos#0')
  })
})

describe('useRowNotification : acquittement et déduplication des appuis (spec 2026-10-01 appui-webview-gele)', () => {
  it('appui appliqué : acquitté avec son tapId', async () => {
    const { toggleDone } = setup()
    await flushPromises()
    action({ projectId: 7, stepId: 'devant#0', delta: 1, tapId: 'T-ack-1' })
    expect(toggleDone).toHaveBeenCalledWith('devant#0')
    expect(native.ackRowAction).toHaveBeenCalledWith('T-ack-1')
  })

  it('appui sans tapId (ancien format) : appliqué, aucun acquittement', async () => {
    const { toggleDone } = setup()
    await flushPromises()
    action({ projectId: 7, stepId: 'devant#0', delta: 1 })
    expect(toggleDone).toHaveBeenCalledTimes(1)
    expect(native.ackRowAction).not.toHaveBeenCalled()
  })

  it('appui rejeté (autre projet) : acquitté, rien appliqué, charge reposée', async () => {
    const { toggleDone } = setup()
    await flushPromises()
    native.showRowNotification.mockClear()
    action({ projectId: 99, stepId: 'devant#0', delta: 1, tapId: 'T-rej-1' })
    await flushPromises()
    expect(toggleDone).not.toHaveBeenCalled()
    expect(native.ackRowAction).toHaveBeenCalledWith('T-rej-1')
    // Le repli natif a pu remplacer la notification : le JS repose sa charge courante.
    expect(native.showRowNotification).toHaveBeenCalledTimes(1)
  })

  it('appui caduc (étape dépassée) : acquitté, rien appliqué, charge reposée', async () => {
    const { toggleDone } = setup()
    await flushPromises()
    native.showRowNotification.mockClear()
    action({ projectId: 7, stepId: 'dos#0', delta: 1, tapId: 'T-cad-1' })
    await flushPromises()
    expect(toggleDone).not.toHaveBeenCalled()
    expect(native.ackRowAction).toHaveBeenCalledWith('T-cad-1')
    expect(native.showRowNotification).toHaveBeenCalledTimes(1)
  })

  it('visite guidée : acquitté SANS effacer l\'entrée retenue (keep), rien appliqué', async () => {
    const { toggleDone } = setup({ suspended: true })
    await flushPromises()
    action({ projectId: 7, stepId: 'devant#0', delta: 1, tapId: 'T-susp-1' })
    expect(toggleDone).not.toHaveBeenCalled()
    expect(native.ackRowAction).toHaveBeenCalledWith('T-susp-1', { keep: true })
  })

  it('porte d\'affichage fermée (batteryIgnoring faux) : l\'appui en file est appliqué, jamais effacé à tort', async () => {
    const { toggleDone } = setup({ batteryIgnoring: false })
    await flushPromises()
    action({ projectId: 7, stepId: 'devant#0', delta: 1, tapId: 'T-gate-1' })
    expect(toggleDone).toHaveBeenCalledWith('devant#0')
    expect(native.ackRowAction).toHaveBeenCalledWith('T-gate-1')
  })

  it('lecteur pas prêt (reader nul) : acquitté SANS effacer l\'entrée retenue (keep), rien appliqué', async () => {
    const { reader, toggleDone } = setup()
    await flushPromises()
    reader.value = null
    action({ projectId: 7, stepId: 'devant#0', delta: 1, tapId: 'T-noreader-1' })
    expect(toggleDone).not.toHaveBeenCalled()
    expect(native.ackRowAction).toHaveBeenCalledWith('T-noreader-1', { keep: true })
  })

  it('même tapId reçu deux fois : appliqué une seule fois, second acquitté', async () => {
    const { toggleDone } = setup()
    await flushPromises()
    action({ projectId: 7, stepId: 'devant#0', delta: 1, tapId: 'T-dbl-1' })
    action({ projectId: 7, stepId: 'devant#0', delta: 1, tapId: 'T-dbl-1' })
    expect(toggleDone).toHaveBeenCalledTimes(1)
    expect(native.ackRowAction).toHaveBeenCalledTimes(2)
  })

  it('événement PUIS rejeu du même tapId : un seul comptage, entrée effacée sans être appliquée', async () => {
    const { canAskPermission, toggleDone } = setup({ canAsk: false })
    await flushPromises()
    action({ projectId: 7, stepId: 'devant#0', delta: 1, tapId: 'T-ord-1' })
    native.readPendingRowAction.mockResolvedValueOnce({ projectId: 7, stepId: 'devant#0', delta: 1, tapId: 'T-ord-1' })
    canAskPermission.value = true
    await flushPromises()
    expect(toggleDone).toHaveBeenCalledTimes(1)
    expect(native.clearPendingRowAction).toHaveBeenCalledTimes(1)
  })

  it('rejeu PUIS événement du même tapId : un seul comptage', async () => {
    native.readPendingRowAction.mockResolvedValueOnce({ projectId: 7, stepId: 'devant#0', delta: 1, tapId: 'T-ord-2' })
    const { canAskPermission, toggleDone } = setup({ canAsk: false })
    canAskPermission.value = true
    await flushPromises()
    expect(toggleDone).toHaveBeenCalledTimes(1)
    action({ projectId: 7, stepId: 'devant#0', delta: 1, tapId: 'T-ord-2' })
    expect(toggleDone).toHaveBeenCalledTimes(1)
    expect(native.ackRowAction).toHaveBeenCalledWith('T-ord-2')
  })

  it('entrée retenue sans tapId (processus mort, ancien format) : rejouée comme avant', async () => {
    native.readPendingRowAction.mockResolvedValueOnce({ projectId: 7, stepId: 'devant#0', delta: 1 })
    const { canAskPermission, toggleDone } = setup({ canAsk: false })
    canAskPermission.value = true
    await flushPromises()
    expect(toggleDone).toHaveBeenCalledWith('devant#0')
    expect(native.clearPendingRowAction).toHaveBeenCalledTimes(1)
  })
})

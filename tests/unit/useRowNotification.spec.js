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
  readerData = READER,
  isChartVisible,
} = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const settings = useSettingsStore()
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
        canAskPermission,
        suspended: suspendedRef,
      })
      return () => null
    },
  })
  const wrapper = mount(Host, { global: { plugins: [createTestI18n(), pinia] } })
  return { wrapper, settings, project, reader, state, toggleDone, bumpCounter, canAskPermission, suspended: suspendedRef }
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

describe('useRowNotification : permission', () => {
  it('canAskPermission faux (visite guidée) : aucune demande', async () => {
    setup({ canAsk: false })
    await flushPromises()
    expect(native.checkRowNotificationPermission).not.toHaveBeenCalled()
    expect(native.requestRowNotificationPermission).not.toHaveBeenCalled()
  })

  it('devient vrai, jamais demandée, état prompt : request puis demande retenue, et charge renvoyée si accordée', async () => {
    native.checkRowNotificationPermission.mockImplementation(async () => 'prompt')
    let askedDuringRequest
    const { settings, canAskPermission } = setup({ canAsk: false })
    native.requestRowNotificationPermission.mockImplementation(async () => {
      askedDuringRequest = settings.rowNotificationAsked
      return 'granted'
    })
    await flushPromises()
    expect(native.showRowNotification).toHaveBeenCalledTimes(1)
    canAskPermission.value = true
    await flushPromises()
    expect(native.requestRowNotificationPermission).toHaveBeenCalledTimes(1)
    expect(askedDuringRequest).toBe(false)
    expect(settings.rowNotificationAsked).toBe(true)
    expect(native.showRowNotification).toHaveBeenCalledTimes(2)
    expect(lastShown().stepId).toBe('devant#0')
  })

  it('état déjà tranché (denied) : pas de request, demande retenue quand même', async () => {
    native.checkRowNotificationPermission.mockImplementation(async () => 'denied')
    const { settings } = setup({ canAsk: true })
    await flushPromises()
    expect(native.checkRowNotificationPermission).toHaveBeenCalledTimes(1)
    expect(native.requestRowNotificationPermission).not.toHaveBeenCalled()
    expect(settings.rowNotificationAsked).toBe(true)
  })

  it('déjà demandée : rien', async () => {
    const { settings, canAskPermission } = setup({ canAsk: false })
    settings.rowNotificationAsked = true
    canAskPermission.value = true
    await flushPromises()
    expect(native.checkRowNotificationPermission).not.toHaveBeenCalled()
    expect(native.requestRowNotificationPermission).not.toHaveBeenCalled()
  })

  it('bascules rapprochées de canAskPermission : une seule demande', async () => {
    native.checkRowNotificationPermission.mockImplementation(async () => 'prompt')
    const { canAskPermission } = setup({ canAsk: true })
    canAskPermission.value = false
    await flushPromises()
    canAskPermission.value = true
    await flushPromises()
    expect(native.requestRowNotificationPermission).toHaveBeenCalledTimes(1)
  })

  it('hors natif : ni check, ni request, demande jamais retenue', async () => {
    native.isRowNotificationAvailable.mockImplementation(() => false)
    const { settings } = setup({ canAsk: true })
    await flushPromises()
    expect(native.checkRowNotificationPermission).not.toHaveBeenCalled()
    expect(native.requestRowNotificationPermission).not.toHaveBeenCalled()
    expect(settings.rowNotificationAsked).toBe(false)
  })

  it('démontage pendant la vérification : pas de request', async () => {
    let resolve
    native.checkRowNotificationPermission.mockImplementation(() => new Promise((r) => (resolve = r)))
    const { wrapper } = setup({ canAsk: true })
    await flushPromises()
    wrapper.unmount()
    resolve('prompt')
    await flushPromises()
    expect(native.requestRowNotificationPermission).not.toHaveBeenCalled()
  })

  it('réglage coupé : aucune demande', async () => {
    const { settings, canAskPermission } = setup({ canAsk: false })
    settings.rowNotification = false
    canAskPermission.value = true
    await flushPromises()
    expect(native.checkRowNotificationPermission).not.toHaveBeenCalled()
  })
})

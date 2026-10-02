// @vitest-environment jsdom
// Unitaire — pop-up d'onboarding de la notification du rang en cours (spec 2026-10-01) :
// le SEUL chemin d'activation. Couvre : le flux complet (activée, emit authorized) ; le
// refus POST (désactivée + snackbar, fermée) ; le refus du dialogue batterie direct
// (restée ouverte sur « pas encore autorisé », désactivée) ; le chemin repli (restée
// ouverte, RIEN d'écrit — l'activation attend la relecture au retour au premier plan) ;
// la relecture au resume qui conclut (exemption venue, y compris boutons débloqués d'un
// appel perdu) ; « Désactiver la notification » ; et l'absence de fermeture hors boutons
// (Échap inclus).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { useSettingsStore } from '@/stores/settings'
import { useSnackbarStore } from '@/stores/snackbar'
import RowNotifOnboardingDialog from '@/components/RowNotifOnboardingDialog.vue'

// Pont natif mocké : le composant doit câbler CES fonctions au service d'activation.
vi.mock('@/native/row-notification', () => ({
  isRowNotificationAvailable: vi.fn(() => true),
  checkRowNotificationPermission: vi.fn(async () => 'granted'),
  requestRowNotificationPermission: vi.fn(async () => 'granted'),
  isBatteryOptimizationIgnored: vi.fn(async () => ({ ignoring: true })),
  requestIgnoreBatteryOptimizations: vi.fn(async () => ({ ignoring: true, fallback: false })),
}))

// Écouteur `resume` : capturé pour simuler les retours au premier plan.
let resumeHandler = null
const removeResume = vi.fn()
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn((_, cb) => {
      resumeHandler = cb
      return Promise.resolve({ remove: removeResume })
    }),
  },
}))

const natif = vi.mocked(await import('@/native/row-notification'))

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

// Les écritures du store passent par fake-indexeddb : flushPromises seul ne suffit pas,
// un temps macrotâche est nécessaire (même motif que settings-view.spec.js::settle).
const settle = () => new Promise((r) => setTimeout(r, 50))

let wrapper
const mountIt = async (open = true) => {
  wrapper = mount(RowNotifOnboardingDialog, {
    props: { open },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.style.overflow = ''
  vi.clearAllMocks()
  natif.checkRowNotificationPermission.mockResolvedValue('granted')
  natif.requestRowNotificationPermission.mockResolvedValue('granted')
  natif.isBatteryOptimizationIgnored.mockResolvedValue({ ignoring: true })
  natif.requestIgnoreBatteryOptimizations.mockResolvedValue({ ignoring: true, fallback: false })
  resumeHandler = null
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('RowNotifOnboardingDialog', () => {
  it('fermée : rien de rendu, aucun écouteur resume', async () => {
    await mountIt(false)
    expect(wrapper.find('[data-test="row-notif-onboarding"]').exists()).toBe(false)
    expect(resumeHandler).toBeNull()
  })

  it('ouverte : titre, textes, boutons, et l\'écouteur resume est armé', async () => {
    await mountIt()
    const racine = wrapper.find('[data-test="row-notif-onboarding"]')
    expect(racine.attributes('role')).toBe('dialog')
    expect(racine.text()).toContain(i18n.global.t('rowNotif.onboardingTitle'))
    expect(wrapper.find('[data-test="row-notif-onboarding-allow"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="row-notif-onboarding-disable"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="row-notif-onboarding-notyet"]').exists()).toBe(false)
    expect(resumeHandler).toBeTypeOf('function')
  })

  it('« Autoriser », tout déjà accordé : activée, emit authorized, fermée', async () => {
    const settings = useSettingsStore()
    await settings.saveRowNotification(false)
    await mountIt()
    await wrapper.find('[data-test="row-notif-onboarding-allow"]').trigger('click')
    await flushPromises()
    await settle()
    expect(settings.rowNotification).toBe(true)
    // Le composant émet ; c'est le parent qui bascule open — simuler-le.
    expect(wrapper.emitted('authorized')).toHaveLength(1)
    expect(wrapper.emitted('disabled')).toBeUndefined()
    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(wrapper.find('[data-test="row-notif-onboarding"]').exists()).toBe(false)
  })

  it('POST refusée : désactivée, snackbar, emit disabled, fermée', async () => {
    natif.checkRowNotificationPermission.mockResolvedValue('prompt')
    natif.requestRowNotificationPermission.mockResolvedValue('denied')
    const settings = useSettingsStore()
    await mountIt()
    await wrapper.find('[data-test="row-notif-onboarding-allow"]').trigger('click')
    await flushPromises()
    await settle()
    expect(settings.rowNotification).toBe(false)
    expect(settings.rowNotificationAsked).toBe(true)
    const snackbar = useSnackbarStore()
    expect(snackbar.visible).toBe(true)
    expect(snackbar.message).toBe(i18n.global.t('rowNotif.onboardingPermissionRefused'))
    // Le composant émet ; c'est le parent qui bascule open — simuler-le.
    expect(wrapper.emitted('disabled')).toHaveLength(1)
    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(wrapper.find('[data-test="row-notif-onboarding"]').exists()).toBe(false)
  })

  it('dialogue batterie refusé : restée ouverte sur « pas encore autorisé », désactivée', async () => {
    natif.isBatteryOptimizationIgnored.mockResolvedValue({ ignoring: false })
    natif.requestIgnoreBatteryOptimizations.mockResolvedValue({ ignoring: false, fallback: false })
    const settings = useSettingsStore()
    await mountIt()
    await wrapper.find('[data-test="row-notif-onboarding-allow"]').trigger('click')
    await flushPromises()
    await settle()
    expect(settings.rowNotification).toBe(false)
    expect(wrapper.find('[data-test="row-notif-onboarding"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="row-notif-onboarding-notyet"]').exists()).toBe(true)
    expect(wrapper.emitted('authorized')).toBeUndefined()
    expect(wrapper.emitted('disabled')).toBeUndefined()
  })

  it('chemin repli : restée ouverte, RIEN d\'écrit', async () => {
    natif.isBatteryOptimizationIgnored.mockResolvedValue({ ignoring: false })
    natif.requestIgnoreBatteryOptimizations.mockResolvedValue({ ignoring: false, fallback: true })
    const settings = useSettingsStore()
    await settings.saveRowNotification(false)
    await mountIt()
    await wrapper.find('[data-test="row-notif-onboarding-allow"]').trigger('click')
    await flushPromises()
    await settle()
    expect(settings.rowNotification).toBe(false)
    expect(wrapper.find('[data-test="row-notif-onboarding"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="row-notif-onboarding-notyet"]').exists()).toBe(true)
    expect(wrapper.emitted('authorized')).toBeUndefined()
  })

  it('retour au premier plan pendant l\'attente : l\'exemption venue conclut l\'activation', async () => {
    natif.isBatteryOptimizationIgnored.mockResolvedValue({ ignoring: false })
    natif.requestIgnoreBatteryOptimizations.mockResolvedValue({ ignoring: false, fallback: true })
    const settings = useSettingsStore()
    await settings.saveRowNotification(false)
    await mountIt()
    await wrapper.find('[data-test="row-notif-onboarding-allow"]').trigger('click')
    await flushPromises()
    await settle()
    natif.isBatteryOptimizationIgnored.mockResolvedValue({ ignoring: true })
    await resumeHandler()
    await flushPromises()
    await settle()
    expect(settings.rowNotification).toBe(true)
    expect(wrapper.emitted('authorized')).toHaveLength(1)
    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(wrapper.find('[data-test="row-notif-onboarding"]').exists()).toBe(false)
    expect(removeResume).toHaveBeenCalled()
  })

  it('retour au premier plan d\'un appel perdu (boutons restés occupés) : débloqués, pop-up honnête', async () => {
    // Le dialogue batterie ne répond jamais (callback d'activité perdu) : le clic reste
    // suspendu, les boutons désactivés.
    natif.isBatteryOptimizationIgnored.mockResolvedValue({ ignoring: false })
    natif.requestIgnoreBatteryOptimizations.mockImplementation(() => new Promise(() => {}))
    await mountIt()
    await wrapper.find('[data-test="row-notif-onboarding-allow"]').trigger('click')
    await flushPromises()
    await settle()
    expect(wrapper.find('[data-test="row-notif-onboarding-allow"]').attributes('disabled')).toBeDefined()
    // Retour au premier plan : l'état effectif ne suit pas, mais les boutons doivent
    // revenir et la pop-up dire où elle en est (aucun emit, rien d'écrit sur ce chemin).
    natif.isBatteryOptimizationIgnored.mockResolvedValue({ ignoring: false })
    await resumeHandler()
    await flushPromises()
    await new Promise((r) => setTimeout(r, 900)) // délai de grâce laissé à l'appel en vol
    expect(wrapper.find('[data-test="row-notif-onboarding-allow"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-test="row-notif-onboarding-notyet"]').exists()).toBe(true)
    expect(wrapper.emitted('authorized')).toBeUndefined()
    expect(wrapper.emitted('disabled')).toBeUndefined()
  })

  it('resume pendant un « Autoriser » en vol : boutons gardés occupés, pas de « pas encore autorisé » à tort', async () => {
    natif.isBatteryOptimizationIgnored.mockResolvedValue({ ignoring: false })
    let repondre
    natif.requestIgnoreBatteryOptimizations.mockImplementation(() => new Promise((r) => { repondre = r }))
    await mountIt()
    await wrapper.find('[data-test="row-notif-onboarding-allow"]').trigger('click')
    await settle()
    await resumeHandler()
    await settle()
    expect(wrapper.find('[data-test="row-notif-onboarding-allow"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="row-notif-onboarding-notyet"]').exists()).toBe(false)
    repondre({ ignoring: true, fallback: false })
    await settle()
    expect(wrapper.emitted('authorized')).toHaveLength(1)
  })

  it('boutons occupés : le focus reste dans l\'overlay (panneau), puis revient sur « Autoriser »', async () => {
    natif.isBatteryOptimizationIgnored.mockResolvedValue({ ignoring: false })
    let repondre
    natif.requestIgnoreBatteryOptimizations.mockImplementation(() => new Promise((r) => { repondre = r }))
    await mountIt()
    await wrapper.find('[data-test="row-notif-onboarding-allow"]').trigger('click')
    await settle()
    expect(document.activeElement).toBe(wrapper.find('.rno-overlay__panel').element)
    repondre({ ignoring: false, fallback: false })
    await settle()
    expect(document.activeElement).toBe(wrapper.find('[data-test="row-notif-onboarding-allow"]').element)
  })

  it('« Désactiver la notification » : désactivée, emit disabled, fermée', async () => {
    const settings = useSettingsStore()
    await settings.saveRowNotification(true)
    await mountIt()
    await wrapper.find('[data-test="row-notif-onboarding-disable"]').trigger('click')
    await flushPromises()
    await settle()
    expect(settings.rowNotification).toBe(false)
    // Le composant émet ; c'est le parent qui bascule open — simuler-le.
    expect(wrapper.emitted('disabled')).toHaveLength(1)
    await wrapper.setProps({ open: false })
    await flushPromises()
    expect(wrapper.find('[data-test="row-notif-onboarding"]').exists()).toBe(false)
  })

  it('resume qui conclut pendant un « Autoriser » en vol : un SEUL emit authorized', async () => {
    // Scénario du rattrapage : la POST manque, son dialogue est ouvert (request jamais
    // résolu), le retour au premier plan lit l'état complet et conclut ; le service
    // finira par aboutir et ne doit PAS conclure une seconde fois.
    natif.checkRowNotificationPermission.mockResolvedValue('prompt')
    let resoudrePermission
    natif.requestRowNotificationPermission.mockImplementation(
      () => new Promise((resolve) => { resoudrePermission = resolve }),
    )
    natif.isBatteryOptimizationIgnored.mockResolvedValue({ ignoring: true })
    const settings = useSettingsStore()
    await settings.saveRowNotification(false)
    await mountIt()
    await wrapper.find('[data-test="row-notif-onboarding-allow"]').trigger('click')
    await flushPromises()
    await settle()
    expect(wrapper.find('[data-test="row-notif-onboarding"]').exists()).toBe(true)
    // L'utilisatrice a accordé la POST dans le dialogue : en revenant, l'état effectif est complet.
    natif.checkRowNotificationPermission.mockResolvedValue('granted')
    await resumeHandler()
    await flushPromises()
    await settle()
    expect(settings.rowNotification).toBe(true)
    expect(wrapper.emitted('authorized')).toHaveLength(1)
    // Le service finit par aboutir : le réglage reste vrai, mais pas de second emit.
    resoudrePermission('granted')
    await flushPromises()
    await settle()
    expect(settings.rowNotification).toBe(true)
    expect(wrapper.emitted('authorized')).toHaveLength(1)
  })

  it('Échap : pas de fermeture hors boutons, aucun emit, aucun écrit', async () => {
    const settings = useSettingsStore()
    const avant = settings.rowNotification
    await mountIt()
    await wrapper.find('[data-test="row-notif-onboarding"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(wrapper.find('[data-test="row-notif-onboarding"]').exists()).toBe(true)
    expect(wrapper.emitted('authorized')).toBeUndefined()
    expect(wrapper.emitted('disabled')).toBeUndefined()
    expect(settings.rowNotification).toBe(avant)
  })
})

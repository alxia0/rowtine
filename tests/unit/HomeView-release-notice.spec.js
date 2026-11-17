// @vitest-environment jsdom
// Unitaire — la pop-up « Nouveautés » de l'accueil après une mise à jour.
//
// Elle montre les points de l'entrée du journal dont la version est CELLE de l'app, une fois,
// puis la version est notée. Une installation neuve n'en voit jamais : le marqueur avance en
// silence. Modèle de montage : home-welcome-popup.spec.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import { useProjectsStore } from '@/stores/projects'
import { db, setSetting, getSetting } from '@/db/db'
import { APP_VERSION } from '@/constants/app-info'
import { resolveReleaseNotes } from '@/content/release-notes'
import { withAppName } from '@/utils/app-name-token'
import i18n from '@/i18n'
import fr from '@/i18n/fr.json'

const nav = vi.hoisted(() => ({
  route: { name: 'home', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))
// Même raison que home-welcome-popup.spec.js : la visite guidée n'est pas l'objet ici.
vi.mock('@/utils/tour-sample', () => ({ ensureTourProject: vi.fn().mockResolvedValue({ id: 1, created: false }) }))

import HomeView from '@/views/HomeView.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const wrappers = []
// Une seule Pinia par test : un second montage est la MÊME session.
let pinia
function doMount() {
  const w = mount(HomeView, { global: { plugins: [pinia, i18n] }, attachTo: document.body })
  wrappers.push(w)
  return w
}
async function settle() {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r))
  }
  await flushPromises()
}
// Les dialogues de l'accueil : celui des nouveautés, repéré par ses points, et OUVERT
// (les points sont calculés en permanence depuis la langue ; seul `open` dit s'il est à l'écran).
function noticeDialog(w) {
  return w.findAllComponents(ConfirmDialog).find((d) => d.props('items').length > 0 && d.props('open'))
}
const entry = () => resolveReleaseNotes('fr').notes.find((e) => e.version === APP_VERSION)

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  nav.router.push.mockClear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  document.body.innerHTML = ''
})

describe('la pop-up « Nouveautés » de l’accueil', () => {
  it('s’affiche sur une base existante sans marqueur, avec les points de la version installée', async () => {
    await setSetting('onboarded', true)
    const w = doMount()
    await settle()
    const dlg = noticeDialog(w)
    expect(dlg).toBeTruthy()
    expect(dlg.props('open')).toBe(true)
    expect(dlg.props('items')).toEqual(entry().notes.map((n) => withAppName(n, fr.app.name)))
    expect(dlg.props('title')).toBe(fr.releaseNotice.title.replace('{version}', APP_VERSION))
    expect(dlg.props('centered')).toBe(true)
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy()
  })

  it('ne s’affiche pas sur une installation neuve, mais avance le marqueur en silence', async () => {
    // `onboarded` absent = jamais passée par l'accueil.
    const w = doMount()
    await settle()
    expect(noticeDialog(w)).toBeFalsy()
    expect(document.body.querySelector('[role="dialog"]')).toBeFalsy()
    expect(await getSetting('lastSeenVersion')).toBe(APP_VERSION)
  })

  it('ne s’affiche pas quand la version installée est déjà celle qui a été vue', async () => {
    await setSetting('onboarded', true)
    await setSetting('lastSeenVersion', APP_VERSION)
    const w = doMount()
    await settle()
    expect(noticeDialog(w)).toBeFalsy()
    expect(document.body.querySelector('[role="dialog"]')).toBeFalsy()
  })

  it('« Compris » ferme la pop-up ET écrit le marqueur en base ; elle ne revient pas au remontage', async () => {
    await setSetting('onboarded', true)
    const w = doMount()
    await settle()
    document.body.querySelector('[data-test="confirm-ok"]').click()
    await settle()
    expect(noticeDialog(w)?.props('open') ?? false).toBe(false)
    expect(document.body.querySelector('[role="dialog"]')).toBeFalsy()
    // On relit la base : c'est elle qui décide au prochain démarrage.
    expect(await getSetting('lastSeenVersion')).toBe(APP_VERSION)

    const w2 = doMount()
    await settle()
    expect(noticeDialog(w2)).toBeFalsy()
    expect(document.body.querySelector('[role="dialog"]')).toBeFalsy()
  })

  it('« Tout voir » enregistre le marqueur puis ouvre l’écran À propos', async () => {
    await setSetting('onboarded', true)
    doMount()
    await settle()
    document.body.querySelector('[data-test="confirm-cancel"]').click()
    await settle()
    expect(await getSetting('lastSeenVersion')).toBe(APP_VERSION)
    expect(nav.router.push).toHaveBeenCalledWith({ name: 'about' })
  })

  it('attend l’écriture du marqueur avant de quitter l’accueil (écriture ATTENDUE, pas lancée en fond)', async () => {
    await setSetting('onboarded', true)
    doMount()
    await settle()
    // Écriture retenue : tant qu'elle n'est pas terminée, la navigation ne doit pas partir.
    let finir
    const settings = useSettingsStore()
    vi.spyOn(settings, 'setLastSeenVersion').mockImplementation(() => new Promise((r) => { finir = r }))
    document.body.querySelector('[data-test="confirm-cancel"]').click()
    await settle()
    expect(nav.router.push).not.toHaveBeenCalled()
    finir()
    await settle()
    expect(nav.router.push).toHaveBeenCalledWith({ name: 'about' })
  })

  it('laisse la bienvenue seule à l’écran, puis montre les nouveautés une fois la bienvenue acquittée', async () => {
    await setSetting('onboarded', true)
    await setSetting('welcomeDue', true)
    const w = doMount()
    await settle()
    // Un seul dialogue ouvert : celui de la bienvenue.
    const open = () => w.findAllComponents(ConfirmDialog).filter((d) => d.props('open'))
    expect(open()).toHaveLength(1)
    expect(open()[0].props('title')).toBe(fr.onboarding.welcomeTitle)
    expect(await getSetting('lastSeenVersion')).toBeUndefined()

    await open()[0].vm.$emit('confirm')
    await settle()
    expect(open()).toHaveLength(1)
    expect(open()[0].props('items').length).toBeGreaterThan(0)
  })

  it('une écriture du marqueur qui échoue n’empêche pas l’accueil de charger ses projets', async () => {
    // Installation neuve : la décision demande d'avancer le marqueur en silence.
    const settings = useSettingsStore()
    vi.spyOn(settings, 'setLastSeenVersion').mockRejectedValue(new Error('écriture refusée'))
    await db.projects.add({ name: 'Châle', status: 'wip', technique: 'knitting' })
    doMount()
    await settle()
    const projets = useProjectsStore()
    expect(projets.loaded).toBe(true)
    expect(projets.projects).toHaveLength(1)
  })

  it('les points suivent la langue de l’interface quand elle change fenêtre ouverte', async () => {
    await setSetting('onboarded', true)
    const w = doMount()
    await settle()
    expect(noticeDialog(w).props('items')).toEqual(entry().notes.map((n) => withAppName(n, fr.app.name)))
    const en = resolveReleaseNotes('en').notes.find((e) => e.version === APP_VERSION)
    expect(en.notes).not.toEqual(entry().notes)
    i18n.global.locale.value = 'en'
    try {
      await settle()
      expect(noticeDialog(w).props('items')).toEqual(en.notes.map((n) => withAppName(n, 'Rowtine')))
    } finally {
      i18n.global.locale.value = 'fr'
    }
  })
})

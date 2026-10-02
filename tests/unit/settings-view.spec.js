// @vitest-environment jsdom
// Composant — SettingsView : le bloc « Sauvegarde (dossier
// natif) » et ses boutons explicites (Sauvegarder maintenant / Restaurer une
// sauvegarde / Activer la sauvegarde) ont disparu — l'état de synchro vit
// désormais dans SafFolderSection (testée en isolation, cf.
// tests/unit/saf-folder-section.spec.js). Corbeille + export CSV, hors
// périmètre de ce chantier, restent inchangés.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import { useSettingsStore } from '@/stores/settings'
import { useTrashStore } from '@/stores/trash'
import { useSnackbarStore } from '@/stores/snackbar'
import { useYarnsStore } from '@/stores/yarns'
import { useProjectsStore } from '@/stores/projects'
import { usePatternsStore } from '@/stores/patterns'
import fr from '@/i18n/fr.json'
import { generatePalette, presetHuesFor } from '@/theme/palette'

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: {}, query: {} }), useRouter: () => nav.router }))

const rowNotif = vi.hoisted(() => ({
  available: vi.fn(() => false),
  check: vi.fn(async () => 'granted'),
  request: vi.fn(async () => 'granted'),
  openSettings: vi.fn(async () => {}),
  checkBattery: vi.fn(async () => ({ ignoring: true })),
  requestBattery: vi.fn(async () => ({ ignoring: true, fallback: false })),
}))
vi.mock('@/native/row-notification', () => ({
  isRowNotificationAvailable: () => rowNotif.available(),
  checkRowNotificationPermission: () => rowNotif.check(),
  requestRowNotificationPermission: () => rowNotif.request(),
  openRowNotificationSettings: () => rowNotif.openSettings(),
  isBatteryOptimizationIgnored: () => rowNotif.checkBattery(),
  requestIgnoreBatteryOptimizations: () => rowNotif.requestBattery(),
}))

const keepAwake = vi.hoisted(() => ({ available: vi.fn(() => false) }))
vi.mock('@/native/keep-awake', () => ({ isKeepScreenOnAvailable: () => keepAwake.available() }))

const capApp = vi.hoisted(() => ({ listeners: {}, removeResume: null, addListener: null }))
vi.mock('@capacitor/app', () => ({ App: { addListener: (...a) => capApp.addListener(...a) } }))

import { KOFI_URL, GITHUB_ISSUES_URL } from '@/constants/app-links'
import SettingsView from '@/views/SettingsView.vue'

// Laisse finir une bascule en cours (le clic est ignoré tant qu'elle n'est pas terminée).
const settle = () => new Promise((r) => setTimeout(r, 50))

function mountView() {
  return mount(SettingsView, {
    global: {
      plugins: [createPinia(), i18n],
      // SafFolderSection a ses propres tests dédiés (mocks de la chaîne
      // backup/restore) — ici on vérifie seulement qu'elle est bien montée à
      // la place de l'ancien bloc de sauvegarde, pas son comportement interne.
      stubs: { SafFolderSection: true },
    },
  })
}

beforeEach(async () => {
  rowNotif.available.mockReturnValue(false)
  keepAwake.available.mockReturnValue(false)
  rowNotif.check.mockResolvedValue('granted')
  rowNotif.request.mockResolvedValue('granted')
  rowNotif.openSettings.mockClear()
  rowNotif.request.mockClear()
  rowNotif.check.mockClear()
  rowNotif.checkBattery.mockResolvedValue({ ignoring: true })
  rowNotif.requestBattery.mockResolvedValue({ ignoring: true, fallback: false })
  capApp.listeners = {}
  capApp.removeResume = vi.fn()
  capApp.addListener = vi.fn(async (name, cb) => {
    capApp.listeners[name] = cb
    return { remove: capApp.removeResume }
  })
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('SettingsView', () => {
  it('ne contient plus le bloc de sauvegarde explicite ni ses boutons', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).not.toMatch(/sauvegarder maintenant/i)
    expect(w.text()).not.toMatch(/restaurer une sauvegarde/i)
    expect(w.text()).not.toMatch(/activer la sauvegarde/i)
  })

  it('monte SafFolderSection (dossier Rowtine) à la place', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.html().toLowerCase()).toContain('saf-folder-section')
  })

  it('conserve la corbeille et l\'export CSV', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toMatch(/export tableur/i)
    expect(w.text()).toMatch(/corbeille/i)
  })

  it('vider la corbeille demande confirmation : Annuler garde tout, Vider efface', async () => {
    await db.trash.add({ type: 'yarn', label: 'Laine test', deletedAt: new Date().toISOString(), payload: {} })
    const w = mountView()
    await flushPromises()
    await w.get('.trash-toggle').trigger('click')
    const emptyBtn = () => w.findAll('button').find((b) => b.text() === i18n.global.t('settings.emptyTrash'))

    await emptyBtn().trigger('click')
    await flushPromises()
    expect(await db.trash.count()).toBe(1)
    await w.get('[data-test="confirm-cancel"]').trigger('click')
    await flushPromises()
    expect(await db.trash.count()).toBe(1)

    await emptyBtn().trigger('click')
    await flushPromises()
    await w.get('[data-test="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(await db.trash.count()).toBe(0)
  })

  it('bloc Apparence : cliquer sur Sombre enregistre le thème', async () => {
    const w = mountView()
    await flushPromises()
    await w.get('[data-test="theme-dark"]').trigger('click')
    const store = useSettingsStore()
    expect(store.theme).toBe('dark')
  })

  it('bloc Couleur d\'accent : affiche le nuancier, prévisualise en direct, persiste au relâché', async () => {
    const w = mountView()
    await flushPromises()
    // Nuancier PAR THÈME (spec 08/09) : jsdom n'a pas de matchMedia → thème effectif clair
    // → la liste CLAIRE (10 pastilles ; 44 orange corail et 70 jaune doré y remplacent
    // 170/210). Avant la tâche : 8 pastilles, liste unique.
    expect(w.findAll('.accent-swatch').length).toBe(10)
    expect(presetHuesFor('light')).toHaveLength(10)
    // Les pastilles sont peintes par le rendu EFFECTIF du thème courant (generatePalette) :
    // la première de la liste claire (15, rouge grenat, hors bande chaude) garde le rendu
    // clair historique — preuve que le câblage accentSwatchColor → generatePalette suit.
    const first = w.findAll('.accent-swatch')[0]
    expect(first.attributes('style')).toContain(generatePalette(15, 'light')['--brand'])

    // `wrapper.setValue()` déclenche 'input' PUIS 'change' en interne (compat v-model.lazy,
    // cf. @vue/test-utils/dist/vue-test-utils.cjs.js) — inutilisable ici : la persistance
    // aurait déjà eu lieu avant l'assertion "pas encore persisté" ci-dessous. On pose donc la
    // valeur DOM directement et on ne déclenche que 'input', pour isoler l'état AVANT 'change'.
    const hueInput = w.get('.accent-hue')
    hueInput.element.value = '190'
    await hueInput.trigger('input')
    const store = useSettingsStore()
    // Pendant le glissé (avant 'change') : la prévisualisation s'applique, mais RIEN n'est
    // encore persisté — c'est le point même du correctif (pas une rafale d'écritures Dexie).
    expect(store.accentHue).not.toBe(190)
    await hueInput.trigger('change')
    expect(store.accentHue).toBe(190)
  })

  // ÉVO E (11/08) — premier jour de la semaine. Même motif que le bloc Apparence ci-dessus :
  // deux boutons seulement (lundi/dimanche), effet et persistance immédiats.
  describe('bloc « Premier jour de la semaine » (ÉVO E)', () => {
    it('lundi est actif par défaut sur une base vierge', async () => {
      const w = mountView()
      await flushPromises()
      expect(w.get('[data-test="weekstart-1"]').classes()).toContain('toggle__opt--on')
      expect(w.get('[data-test="weekstart-0"]').classes()).not.toContain('toggle__opt--on')
    })

    it('cliquer sur Dimanche enregistre le réglage et le PERSISTE (résiste à une nouvelle instance)', async () => {
      const w = mountView()
      await flushPromises()
      await w.get('[data-test="weekstart-0"]').trigger('click')
      const store = useSettingsStore()
      expect(store.weekStart).toBe(0)
      expect(w.get('[data-test="weekstart-0"]').classes()).toContain('toggle__opt--on')
      expect(w.get('[data-test="weekstart-1"]').classes()).not.toContain('toggle__opt--on')

      setActivePinia(createPinia())
      const reloaded = useSettingsStore()
      await reloaded.load()
      expect(reloaded.weekStart).toBe(0)
    })
  })

  // Réglage « Rang en cours dans les notifications » : natif seulement, opt-in (spec
  // 2026-10-01). La bascule ON ouvre la pop-up d'onboarding, qui SEULE écrit true (après
  // les deux autorisations) ; OFF écrit false directement. Lignes d'état lues au montage
  // et au resume.
  describe('interrupteur « Rang en cours dans les notifications »', () => {
    it('est absent hors natif', async () => {
      const w = mountView()
      await flushPromises()
      expect(w.find('[data-test="row-notif-switch"]').exists()).toBe(false)
    })

    it('base vierge : désactivée ; la bascule ON ouvre la pop-up, « Autoriser » active', async () => {
      rowNotif.available.mockReturnValue(true)
      const w = mountView()
      await flushPromises()
      const store = useSettingsStore()
      expect(store.rowNotification).toBe(false)
      const sw = w.get('[data-test="row-notif-switch"]')
      expect(sw.attributes('role')).toBe('switch')
      expect(sw.attributes('aria-checked')).toBe('false')
      await sw.trigger('click')
      await flushPromises()
      // La bascule n'a rien écrit : la pop-up pilote.
      expect(store.rowNotification).toBe(false)
      const dlg = w.get('[data-test="row-notif-onboarding"]')
      await dlg.get('[data-test="row-notif-onboarding-allow"]').trigger('click')
      await flushPromises()
      await settle()
      await vi.waitFor(() => expect(store.rowNotification).toBe(true))
      expect(w.find('[data-test="row-notif-onboarding"]').exists()).toBe(false)
      await vi.waitFor(() => expect(w.get('[data-test="row-notif-switch"]').attributes('aria-checked')).toBe('true'))
    })

    it('bascule OFF écrit false directement, sans pop-up', async () => {
      rowNotif.available.mockReturnValue(true)
      const w = mountView()
      await flushPromises()
      const store = useSettingsStore()
      await store.saveRowNotification(true)
      await flushPromises()
      await w.get('[data-test="row-notif-switch"]').trigger('click')
      await vi.waitFor(() => expect(store.rowNotification).toBe(false))
      expect(w.find('[data-test="row-notif-onboarding"]').exists()).toBe(false)
    })

    it('pop-up « Désactiver la notification » : réglage false, pop-up fermée', async () => {
      rowNotif.available.mockReturnValue(true)
      const w = mountView()
      await flushPromises()
      const store = useSettingsStore()
      // La bascule ON ouvre la pop-up ; on change d'avis : « Désactiver la notification ».
      await w.get('[data-test="row-notif-switch"]').trigger('click')
      await flushPromises()
      await w.get('[data-test="row-notif-onboarding-disable"]').trigger('click')
      await flushPromises()
      await settle()
      await vi.waitFor(() => expect(store.rowNotification).toBe(false))
      expect(w.find('[data-test="row-notif-onboarding"]').exists()).toBe(false)
    })

    it('POST refusée dans la pop-up : réglage false, snackbar, pop-up fermée', async () => {
      rowNotif.available.mockReturnValue(true)
      rowNotif.check.mockResolvedValue('prompt')
      rowNotif.request.mockResolvedValue('denied')
      const w = mountView()
      await flushPromises()
      const store = useSettingsStore()
      await w.get('[data-test="row-notif-switch"]').trigger('click')
      await flushPromises()
      await w.get('[data-test="row-notif-onboarding-allow"]').trigger('click')
      await flushPromises()
      await settle()
      await vi.waitFor(() => expect(store.rowNotification).toBe(false))
      expect(store.rowNotificationAsked).toBe(true)
      const snackbar = useSnackbarStore()
      expect(snackbar.visible).toBe(true)
      expect(snackbar.message).toBe(i18n.global.t('rowNotif.onboardingPermissionRefused'))
      expect(w.find('[data-test="row-notif-onboarding"]').exists()).toBe(false)
    })

    it('réglage true et exemption d\'arrière-plan absente : ligne d\'état qui rouvre la pop-up', async () => {
      rowNotif.available.mockReturnValue(true)
      rowNotif.checkBattery.mockResolvedValue({ ignoring: false })
      const w = mountView()
      await flushPromises()
      const store = useSettingsStore()
      await store.saveRowNotification(true)
      await flushPromises()
      const ligne = w.get('[data-test="row-notif-battery"]')
      expect(ligne.text()).toBe(i18n.global.t('rowNotif.settingBattery'))
      await ligne.trigger('click')
      await flushPromises()
      expect(w.find('[data-test="row-notif-onboarding"]').exists()).toBe(true)
    })

    it('réglage true et exemption absente, mais POST à demander : la ligne POST passe devant', async () => {
      rowNotif.available.mockReturnValue(true)
      rowNotif.check.mockResolvedValue('prompt')
      rowNotif.checkBattery.mockResolvedValue({ ignoring: false })
      const w = mountView()
      await flushPromises()
      const store = useSettingsStore()
      await store.markRowNotificationAsked()
      await store.saveRowNotification(true)
      await flushPromises()
      expect(w.find('[data-test="row-notif-ask"]').exists()).toBe(true)
      expect(w.find('[data-test="row-notif-battery"]').exists()).toBe(false)
    })

    it('permission refusée : le libellé d\'aide est là et son clic ouvre les réglages Android', async () => {
      rowNotif.available.mockReturnValue(true)
      rowNotif.check.mockResolvedValue('denied')
      const w = mountView()
      await flushPromises()
      await useSettingsStore().saveRowNotification(true)
      await flushPromises()
      const denied = w.get('[data-test="row-notif-denied"]')
      expect(denied.text()).toBe(i18n.global.t('rowNotif.settingDenied'))
      await denied.trigger('click')
      expect(rowNotif.openSettings).toHaveBeenCalledTimes(1)
    })

    it('retour des réglages Android (resume) : la permission est relue, l\'aide disparaît si accordée', async () => {
      rowNotif.available.mockReturnValue(true)
      rowNotif.check.mockResolvedValue('denied')
      const w = mountView()
      await vi.waitFor(() => expect(capApp.listeners.resume).toBeTypeOf('function'))
      await flushPromises()
      await useSettingsStore().saveRowNotification(true)
      await flushPromises()
      expect(w.find('[data-test="row-notif-denied"]').exists()).toBe(true)
      rowNotif.check.mockResolvedValue('granted')
      await capApp.listeners.resume()
      await flushPromises()
      expect(w.find('[data-test="row-notif-denied"]').exists()).toBe(false)
    })

    it('démontage : écouteur resume retiré ; hors natif : aucun écouteur', async () => {
      const web = mountView()
      await flushPromises()
      expect(capApp.addListener).not.toHaveBeenCalled()
      web.unmount()

      rowNotif.available.mockReturnValue(true)
      const w = mountView()
      await vi.waitFor(() => expect(capApp.listeners.resume).toBeTypeOf('function'))
      const resume = capApp.listeners.resume
      w.unmount()
      expect(capApp.removeResume).toHaveBeenCalledTimes(1)
      rowNotif.check.mockClear()
      await resume()
      expect(rowNotif.check).not.toHaveBeenCalled()
    })

    it('refus unique (prompt, déjà demandée) : action qui redemande la permission', async () => {
      rowNotif.available.mockReturnValue(true)
      rowNotif.check.mockResolvedValue('prompt')
      const w = mountView()
      await flushPromises()
      expect(w.find('[data-test="row-notif-ask"]').exists()).toBe(false)
      await useSettingsStore().markRowNotificationAsked()
      await useSettingsStore().saveRowNotification(true)
      await flushPromises()
      const ask = w.get('[data-test="row-notif-ask"]')
      expect(ask.text()).toBe(i18n.global.t('rowNotif.settingAsk'))
      expect(w.find('[data-test="row-notif-denied"]').exists()).toBe(false)
      rowNotif.request.mockResolvedValue('denied')
      await ask.trigger('click')
      await flushPromises()
      expect(rowNotif.request).toHaveBeenCalledTimes(1)
      expect(w.find('[data-test="row-notif-ask"]').exists()).toBe(false)
      expect(w.find('[data-test="row-notif-denied"]').exists()).toBe(true)
    })

    it('refus unique puis accord : plus ni action ni aide', async () => {
      rowNotif.available.mockReturnValue(true)
      rowNotif.check.mockResolvedValue('prompt')
      const w = mountView()
      await flushPromises()
      await useSettingsStore().markRowNotificationAsked()
      await useSettingsStore().saveRowNotification(true)
      await flushPromises()
      rowNotif.request.mockResolvedValue('granted')
      await w.get('[data-test="row-notif-ask"]').trigger('click')
      await flushPromises()
      expect(w.find('[data-test="row-notif-ask"]').exists()).toBe(false)
      expect(w.find('[data-test="row-notif-denied"]').exists()).toBe(false)
    })

    it('refus unique mais réglage désactivé : pas d\'action', async () => {
      rowNotif.available.mockReturnValue(true)
      rowNotif.check.mockResolvedValue('prompt')
      const w = mountView()
      await flushPromises()
      const store = useSettingsStore()
      await store.markRowNotificationAsked()
      await store.saveRowNotification(false)
      await flushPromises()
      expect(w.find('[data-test="row-notif-ask"]').exists()).toBe(false)
    })

    it('permission refusée mais réglage désactivé : pas de libellé d\'aide', async () => {
      rowNotif.available.mockReturnValue(true)
      rowNotif.check.mockResolvedValue('denied')
      const w = mountView()
      await flushPromises()
      await useSettingsStore().saveRowNotification(false)
      await flushPromises()
      expect(w.find('[data-test="row-notif-denied"]').exists()).toBe(false)
    })
  })

  // Réglage « Garder l'écran allumé pendant le suivi » : natif seulement, inactif par défaut.
  describe('interrupteur « Garder l\'écran allumé pendant le suivi »', () => {
    it('est absent hors natif', async () => {
      const w = mountView()
      await flushPromises()
      expect(w.find('[data-test="keep-screen-switch"]').exists()).toBe(false)
    })

    it('est présent en natif, actif par défaut, et sa bascule enregistre le réglage', async () => {
      keepAwake.available.mockReturnValue(true)
      const w = mountView()
      await flushPromises()
      const store = useSettingsStore()
      const sw = w.get('[data-test="keep-screen-switch"]')
      expect(sw.attributes('role')).toBe('switch')
      expect(sw.attributes('aria-checked')).toBe('true')
      expect(w.get('#keep-screen-title').text()).toBe(i18n.global.t('settings.keepScreenOn'))
      await sw.trigger('click')
      await vi.waitFor(() => expect(store.keepScreenOn).toBe(false))
      await vi.waitFor(() =>
        expect(w.get('[data-test="keep-screen-switch"]').attributes('aria-checked')).toBe('false'),
      )
      await w.get('[data-test="keep-screen-switch"]').trigger('click')
      await vi.waitFor(() => expect(store.keepScreenOn).toBe(true))
    })
  })

  // Bloc « Contribuer » — lien de don Ko-fi (05/08/2026). La rangée « Soutenir » existait
  // depuis le début avec un href bouchon `https://github.com` : personne ne l'avait jamais
  // suivi, donc rien ne l'aurait signalé si elle était restée sur le bouchon.
  describe('bloc Contribuer', () => {
    it('la rangée « Soutenir » pointe vers la page de dons Ko-fi', async () => {
      const w = mountView()
      await flushPromises()
      const row = w.get('[data-test="settings-link-support"]')
      // On compare à la CONSTANTE (le href est-il bien CÂBLÉ ?) et, séparément, la constante
      // à l'adresse littérale de référence (est-ce la BONNE page ?). Un seul des deux
      // tests laisserait passer soit un fil débranché, soit une URL silencieusement modifiée.
      expect(row.attributes('href')).toBe(KOFI_URL)
      expect(KOFI_URL).toBe('https://ko-fi.com/rowtine_app')
    })

    it('ouvre le don HORS de l’app et ne retombe pas sur le bouchon github.com', async () => {
      const w = mountView()
      await flushPromises()
      const row = w.get('[data-test="settings-link-support"]')
      // Sur Android, `target` est ignoré (Capacitor n'active pas les fenêtres multiples) et
      // c'est `Bridge.launchIntent` qui sort vers le navigateur système, l'hôte ko-fi.com
      // n'étant ni celui de l'app ni dans `allowNavigation`. `target`/`rel` servent au web et
      // interdisent à la page ouverte de reprendre la main sur celle de l'app.
      expect(row.attributes('target')).toBe('_blank')
      expect(row.attributes('rel')).toContain('noopener')
      expect(row.attributes('href')).not.toContain('github.com')
    })

    // 10/08/2026 : cette rangée mène désormais aux TICKETS du dépôt, plus au client mail.
    // Elle ouvrait le même `mailto:` que « Nous contacter » (À propos) — deux rangées, une
    // seule destination. Le mail reste sur « Nous contacter », seule porte de l'app qui
    // n'exige aucun compte (mesuré sur Pixel 7 : un lien github.com y affiche
    // « Sign in to GitHub.com », navigateur compris).
    it('la rangée « Suggérer » mène aux TICKETS du dépôt, pas à la page d’accueil de GitHub', async () => {
      const w = mountView()
      await flushPromises()
      const row = w.get('[data-test="settings-link-suggest"]')
      expect(row.attributes('href')).toBe(GITHUB_ISSUES_URL)
      // Le lien sort de l'app : sans `rel`, la page ouverte garderait un accès `window.opener`.
      expect(row.attributes('target')).toBe('_blank')
      expect(row.attributes('rel')).toBe('noopener')
      // ⚠️ Cette rangée a porté un BOUCHON `https://github.com` (page d'accueil du site, pas
      // le dépôt) avant le 05/08. La distinction n'est pas cosmétique : l'accueil de GitHub
      // n'offre aucun moyen de signaler quoi que ce soit. On exige donc l'URL EXACTE
      // ci-dessus, et on vérifie ci-dessous qu'aucune AUTRE rangée de l'écran — y compris une
      // troisième ajoutée plus tard — ne réintroduit ce bouchon.
      // On lit les `href` et non `w.html()` : le HTML rendu inclut les commentaires du
      // template, dont un qui CITE l'ancien bouchon — une assertion sur le texte brut
      // échouerait sur une phrase d'explication, pas sur un lien (constaté en écrivant ce test).
      const hrefs = w.findAll('a').map((a) => a.attributes('href') || '')
      expect(hrefs.length).toBeGreaterThan(0)
      expect(hrefs.filter((h) => h.includes('github.com') && h !== GITHUB_ISSUES_URL)).toEqual([])
    })
  })

  it('avertit quand une restauration alloue moins de pelotes que prévu', async () => {
    await db.yarns.add({ id: 30, brand: 'Drops', quantity: 3, reservations: { 2: 2 } })
    const trash = useTrashStore()
    await trash.add('project', { project: { id: 1, name: 'Pull' }, yarnLinks: [{ id: 30, qty: 3 }] })
    await trash.load()

    const w = mountView()
    await flushPromises()
    await w.find('.trash-toggle').trigger('click')
    await flushPromises()
    await w.find('.trash-row .link').trigger('click')

    // `restoreTrash` enchaîne plusieurs opérations Dexie/fake-indexeddb réelles
    // (trash.restore, puis 3 store.load() en parallèle) avant d'afficher le
    // snackbar — fake-indexeddb planifie chaque étape via un vrai setTimeout(0)
    // (cf. node_modules/fake-indexeddb/build/cjs/lib/scheduling.js), si bien
    // qu'un seul flushPromises() (un setImmediate, qui s'exécute même AVANT un
    // setTimeout(0) déjà planifié) ne suffit pas à dérouler toute la chaîne.
    // Même limitation déjà documentée/contournée par App.restore-offer.spec.js
    // et CorrectionView.spec.js : on attend la condition plutôt qu'un nombre de
    // ticks fixe.
    const snackbar = useSnackbarStore()
    await vi.waitFor(() => expect(snackbar.visible).toBe(true), { timeout: 10000 })
    expect(snackbar.message).toBe(fr.settings.restoreShortfall)
  })

  it('n’avertit pas quand la restauration obtient l’intégralité de l’allocation', async () => {
    await db.yarns.add({ id: 30, brand: 'Drops', quantity: 5, reservations: {} })
    const trash = useTrashStore()
    await trash.add('project', { project: { id: 1, name: 'Pull' }, yarnLinks: [{ id: 30, qty: 2 }] })
    await trash.load()

    const w = mountView()
    await flushPromises()
    await w.find('.trash-toggle').trigger('click')
    await flushPromises()
    await w.find('.trash-row .link').trigger('click')

    // Même chaîne Dexie que le test précédent : on attend un signal FIABLE et
    // INCONDITIONNEL prouvant que `restoreTrash` a bien atteint le point de
    // décision (fin du `Promise.all` des 3 `store.load()`, juste avant le test
    // `if (shortfalls.length)`) avant de vérifier l'ABSENCE d'avertissement —
    // sinon un `snackbar.show()` bogué (ex. appelé sans garde) pourrait se
    // déclencher APRÈS notre lecture et passer inaperçu (test qui ne teste
    // rien). `Promise.all([projectsStore.load(), yarnsStore.load(),
    // patternsStore.load()])` ne se résout que quand LES TROIS `.loaded`
    // passent à `true` : n'attendre que `yarnsStore.loaded` ne prouve rien sur
    // les deux autres. Miroir du 2e test de App.restore-offer.spec.js (waitFor
    // un signal positif → flushPromises → assert négatif).
    const projectsStore = useProjectsStore()
    const yarnsStore = useYarnsStore()
    const patternsStore = usePatternsStore()
    await vi.waitFor(
      () => expect(projectsStore.loaded && yarnsStore.loaded && patternsStore.loaded).toBe(true),
      { timeout: 10000 },
    )
    await flushPromises()

    const snackbar = useSnackbarStore()
    expect(snackbar.visible).toBe(false)
  })
})

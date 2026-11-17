// @vitest-environment jsdom
// Composant — ProjectDetailView (vue lourde) : onglets, infos, sections, taille active.
// vue-router mocké ; enfants lourds stubbés ; base Dexie réelle.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import fr from '@/i18n/fr.json'
import { db, setSetting } from '@/db/db'
import i18n from '@/i18n'
import { SESSION_NO_SECTION } from '@/constants/session'
import { createTestI18n, makeTk } from './helpers/i18n-router'

const nav = vi.hoisted(() => ({
  route: { params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRoute: () => nav.route, useRouter: () => nav.router }))

// Même objet que la route du mock hoisté ci-dessus (vue-router mocké).
const route = nav.route

// Menu ⋮ — « Voir le PDF original » : on prouve QUI est appelé, pas le détail
// natif/web du module (déjà couvert par open-pdf.spec.js).
const { openPdfExternally } = vi.hoisted(() => ({ openPdfExternally: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/utils/open-pdf', () => ({ openPdfExternally }))

import ProjectDetailView from '@/views/ProjectDetailView.vue'
import YarnConsumptionDialog from '@/components/YarnConsumptionDialog.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import ToolParkingDialog from '@/components/ToolParkingDialog.vue'
import { useSnackbarStore } from '@/stores/snackbar'
import { useCropperStore } from '@/stores/cropper'
import { useSettingsStore } from '@/stores/settings'
import { useTrashStore } from '@/stores/trash'
import { useProjectsStore } from '@/stores/projects'

const tk = makeTk(i18n)

async function seedProject(extra = {}) {
  const pid = await db.projects.add({
    name: 'Pull torsadé',
    technique: 'knitting',
    status: 'wip',
    sizes: ['S', 'M', 'L'],
    activeSize: 'M',
    needleMm: '4.5',
    ...extra,
  })
  nav.route.params = { id: String(pid) }
  nav.route.query = {}
  return pid
}

function mountDetail() {
  return mount(ProjectDetailView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { StatusBadge: true, CounterCard: true, CounterForm: true },
    },
  })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  nav.router.back.mockClear()
  openPdfExternally.mockClear()
  // Explicite plutôt qu'implicite : `nav.route.query` est un mock hoisté PARTAGÉ entre tous
  // les tests du fichier. Jusqu'ici remis à `{}` uniquement par `seedProject()`, ce qui
  // tenait par convention (chaque `mountDetail()` du fichier est précédé d'un `seedProject()`
  // ou équivalent) et pas par garantie — un futur test qui omettrait ce préalable hériterait
  // silencieusement du `{ tab: 'stats' }` posé par le repro Julien ci-dessous.
  nav.route.query = {}
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('ProjectDetailView', () => {
  it('affiche le titre du projet et les 5 onglets', async () => {
    await seedProject()
    const w = mountDetail()
    await flushPromises()

    expect(w.find('.phdr__title').text()).toBe('Pull torsadé')
    expect(w.findAll('[role="tab"]')).toHaveLength(5)
    // L'onglet Sections est désormais le premier (ouvert par défaut).
    expect(w.find('#panel-sections').exists()).toBe(true)
  })

  it('handleBackPressed() : retour progressif, un appel ramène sur Sections, le suivant laisse passer', async () => {
    await seedProject()
    const w = mountDetail()
    await flushPromises()

    // Onglet par défaut ('sections') : le retour n'est PAS avalé, smartBack() doit s'exécuter.
    expect(w.vm.handleBackPressed()).toBe(false)
    // Bascule sur un autre onglet (ex. 'stats') : le premier retour ramène sur l'onglet par
    // défaut (feedback visible) et avale ce geste-là, la fiche reste affichée.
    await w.vm.changeTab('stats')
    expect(w.vm.handleBackPressed()).toBe(true)
    expect(w.vm.tab).toBe('sections')
    // Le changement d'onglet EST le retour visible pour l'utilisatrice : vérifié aussi côté
    // rendu (bouton d'onglet actif), pas seulement sur l'état interne `tab`.
    await w.vm.$nextTick()
    expect(w.find('#tab-sections').attributes('aria-selected')).toBe('true')
    // Un second retour, maintenant sur l'onglet par défaut, n'est plus avalé.
    expect(w.vm.handleBackPressed()).toBe(false)
  })

  // Retour Julien, 20/09 : un geste de retour depuis le composeur de badge ouvert quittait la
  // fiche (composeur local, jamais gardé par App.vue) au lieu de le refermer. Ouvre le composeur
  // par le VRAI bouton (comme les autres tests du composeur dans ce fichier), depuis l'onglet
  // Stats — délibérément pas l'onglet d'entrée — pour prouver que la garde composeur est
  // vérifiée EN PREMIER : si la logique d'onglet passait avant, ce premier retour changerait
  // d'onglet au lieu de fermer le composeur.
  it('handleBackPressed() : ferme le composeur de badge en premier, avant la logique d’onglet', async () => {
    await seedProject()
    const w = mountDetail()
    await flushPromises()

    await w.vm.changeTab('stats')
    await w.vm.$nextTick()
    await w.find('[data-test="open-badge-composer"]').trigger('click')
    await flushPromises()
    expect(w.vm.showBadgeComposer).toBe(true)

    expect(w.vm.handleBackPressed()).toBe(true) // avalé
    expect(w.vm.showBadgeComposer).toBe(false) // composeur refermé
    expect(w.vm.tab).toBe('stats') // pas de changement d'onglet : la garde composeur a joué en premier
  })

  // Reproduit le scénario LITTÉRAL signalé par Julien (20/09) : composeur ouvert alors qu'on est
  // DÉJÀ sur l'onglet d'entrée. Avant le correctif, `handleBackPressed()` ne connaissait que la
  // logique d'onglet — `tab.value === entryTab` étant déjà vrai dans ce cas, elle renvoyait
  // `false` sans rien faire, laissant le geste retomber sur `smartBack()` (sortie vers
  // l'Accueil), composeur toujours ouvert par-dessus l'écran disparu. `entryTab` est capturé une
  // seule fois à l'ouverture depuis `route.query.tab` (cf. sa déclaration plus haut) : on force
  // ici une entrée directe sur l'onglet Stats pour que `tab.value === entryTab` soit vrai DÈS le
  // montage, sans passer par un `changeTab()` — ce qui rendrait la scène indiscernable du test
  // `tab='stats'` précédent (qui, lui, couvre le cas où l'onglet d'entrée diffère).
  it('handleBackPressed() : ferme le composeur ouvert alors qu’on est déjà sur l’onglet d’entrée (repro Julien)', async () => {
    await seedProject()
    nav.route.query = { tab: 'stats' }
    const w = mountDetail()
    await flushPromises()

    expect(w.vm.tab).toBe('stats') // onglet d'entrée dès le montage, aucun changeTab() ici
    await w.find('[data-test="open-badge-composer"]').trigger('click')
    await flushPromises()
    expect(w.vm.showBadgeComposer).toBe(true)

    // Sans le correctif : tab.value === entryTab ⇒ `false` ici, composeur resté ouvert, geste
    // tombant sur smartBack().
    expect(w.vm.handleBackPressed()).toBe(true) // avalé
    expect(w.vm.showBadgeComposer).toBe(false) // composeur refermé, pas de sortie vers smartBack()
  })

  // Revue finale du lot (20/09) : le recadreur (PhotoCropper, instance unique montée dans
  // App.vue) s'ouvre PAR-DESSUS le composeur de badge depuis BadgePhotoPicker, rendu à
  // l'intérieur du composeur. Même garde que le gestionnaire Échap du composeur lui-même
  // (`if (cropper.open) return`, BadgeComposer.vue) : sans elle, ce geste de retour fermait le
  // composeur SOUS le recadreur encore ouvert, perdant en silence la configuration en cours
  // (gabarit, couleur, stats) et laissant le recadreur orphelin à l'écran.
  it('handleBackPressed() : avale le geste sans fermer le composeur tant que le recadreur est ouvert par-dessus', async () => {
    await seedProject()
    const w = mountDetail()
    await flushPromises()

    // Le bouton d'ouverture du composeur vit dans l'onglet Stats (cf. autres tests du composeur
    // ci-dessus) : y basculer d'abord, ce test ne porte pas sur la logique d'onglet.
    await w.vm.changeTab('stats')
    await w.vm.$nextTick()
    await w.find('[data-test="open-badge-composer"]').trigger('click')
    await flushPromises()
    expect(w.vm.showBadgeComposer).toBe(true)

    const cropper = useCropperStore()
    cropper.open = true

    // Sans la garde : le composeur se fermerait ici (même comportement que le test précédent),
    // recadreur orphelin par-dessus un composeur démonté.
    expect(w.vm.handleBackPressed()).toBe(true) // geste avalé
    expect(w.vm.showBadgeComposer).toBe(true) // composeur préservé, configuration intacte

    cropper.open = false
    expect(w.vm.handleBackPressed()).toBe(true) // avalé
    expect(w.vm.showBadgeComposer).toBe(false) // recadreur refermé : le composeur se ferme normalement
  })

  // Le retour ferme d'abord la visionneuse photo locale, sans changer d'onglet derrière elle.
  it('handleBackPressed() : ferme la visionneuse photo avant la logique d’onglet', async () => {
    await seedProject({ photos: ['data:image/png;base64,A'] })
    const w = mountDetail()
    await flushPromises()
    await w.vm.changeTab('photos')
    await w.vm.$nextTick()
    await w.find('.pthumb__open').trigger('click')
    expect(w.vm.viewerIdx).toBe(0)

    expect(w.vm.handleBackPressed()).toBe(true)
    expect(w.vm.viewerIdx).toBe(null)
    expect(w.vm.tab).toBe('photos')
  })

  it('onglet Stats : agrège les séances du projet, les pelotes utilisées et affiche la mini-heatmap', async () => {
    const pid = await seedProject({ startedAt: '2026-01-05', finishedAt: '' })
    await db.sessions.add({
      projectId: pid, sectionId: SESSION_NO_SECTION, date: '2026-01-05T10:00:00.000Z',
      durationSec: 1800, manual: true,
    })
    await db.sessions.add({
      projectId: pid, sectionId: SESSION_NO_SECTION, date: '2026-01-06T10:00:00.000Z',
      durationSec: 3600, manual: true,
    })
    // Couvre le câblage réel de aggregateProjectStats(project, sessions, yarnsStore.yarns) —
    // sans laine seedée, ballsUsed vaudrait 0 par construction et ne prouverait rien.
    // `lengthM` renseigné : couvre aussi la branche « métrage affiché » du template
    // (`v-if="projectStats.metersUsed"`), invisible avec une laine sans métrage — 3 pelotes
    // réservées × 100 m = 300 m attendus dans la tuile, à côté du compte de pelotes.
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, lengthM: 100, reservations: { [pid]: 3 } })
    const w = mountDetail()
    await flushPromises()

    await w.findAll('[role="tab"]').find((b) => b.text() === tk('project.tab.stats')).trigger('click')
    await flushPromises()

    const panel = w.find('#panel-stats')
    expect(panel.exists()).toBe(true)
    expect(panel.text()).toContain(tk('project.stats.sessionsValue', 2))
    expect(panel.text()).toContain(tk('project.stats.ballsValue', 3))
    expect(panel.text()).toContain('300 m')
    // Projet EN COURS : phrase dédiée, pas « 05/01/2026 au en cours » ; dates localisées,
    // jamais l'ISO brut (mêmes règles que la ligne « période » du badge).
    expect(panel.text()).toContain(tk('project.stats.periodOngoing', { from: '05/01/2026' }))
    expect(panel.text()).not.toContain('2026-01-05')
    expect(w.findComponent({ name: 'StatsHeatmap' }).exists()).toBe(true)
  })

  it('onglet Stats : pelotes utilisées décimales affichées avec la virgule (2,5, pas 2.5)', async () => {
    const pid = await seedProject({ startedAt: '2026-01-05', finishedAt: '' })
    await db.sessions.add({
      projectId: pid, sectionId: SESSION_NO_SECTION, date: '2026-01-05T10:00:00.000Z',
      durationSec: 1800, manual: true,
    })
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2.5 } })
    const w = mountDetail()
    await flushPromises()

    await w.findAll('[role="tab"]').find((b) => b.text() === tk('project.tab.stats')).trigger('click')
    await flushPromises()

    const panel = w.find('#panel-stats')
    expect(panel.text()).toContain(tk('project.stats.ballsValue', { count: '2,5' }, 2.5))
  })

  it('onglet Stats : projet terminé, période bornée avec deux dates localisées', async () => {
    const pid = await seedProject({ startedAt: '2026-01-05', finishedAt: '2026-01-06' })
    await db.sessions.add({
      projectId: pid, sectionId: SESSION_NO_SECTION, date: '2026-01-05T10:00:00.000Z',
      durationSec: 1800, rowsDone: 4, manual: true,
    })
    const w = mountDetail()
    await flushPromises()
    await w.findAll('[role="tab"]').find((b) => b.text() === tk('project.tab.stats')).trigger('click')
    await flushPromises()

    expect(w.find('#panel-stats').text()).toContain(tk('project.stats.periodValue', { from: '05/01/2026', to: '06/01/2026' }))
  })

  it('onglet Stats : état vide sans exception pour un projet sans séance', async () => {
    await seedProject()
    const w = mountDetail()
    await flushPromises()

    await w.findAll('[role="tab"]').find((b) => b.text() === tk('project.tab.stats')).trigger('click')
    await flushPromises()

    expect(w.find('#panel-stats').exists()).toBe(true)
  })

  it('onglet Stats : le bouton Partager reste accessible même sans aucune séance', async () => {
    await seedProject()
    const w = mountDetail()
    await flushPromises()

    await w.findAll('[role="tab"]').find((b) => b.text() === tk('project.tab.stats')).trigger('click')
    await flushPromises()

    expect(w.find('#panel-stats').text()).toContain(tk('project.stats.empty'))
    await w.find('[data-test="open-badge-composer"]').trigger('click')
    await flushPromises()

    expect(w.findComponent({ name: 'BadgeComposer' }).exists()).toBe(true)
  })

  it('ouvre le composeur de badge depuis l’onglet Stats', async () => {
    const pid = await seedProject({ startedAt: '2026-01-05', finishedAt: '' })
    await db.sessions.add({
      projectId: pid, sectionId: SESSION_NO_SECTION, date: '2026-01-05T10:00:00.000Z',
      durationSec: 1800, rowsDone: 4, manual: true,
    })
    const w = mountDetail()
    await flushPromises()
    await w.findAll('[role="tab"]').find((b) => b.text() === tk('project.tab.stats')).trigger('click')
    await flushPromises()

    await w.find('[data-test="open-badge-composer"]').trigger('click')
    await flushPromises()

    expect(w.findComponent({ name: 'BadgeComposer' }).exists()).toBe(true)
  })

  // Câblage réel ProjectDetailView.vue → aggregateProjectStats (revue finale du lot « badge
  // motif d'avancement ») : le bug corrigé par ce lot passait `sectionsStore.sections` (table
  // `sections`, toujours vide ici : aucune section déclarée à la main) au lieu de
  // `linkedPattern.value` en 4e argument — `rowsProgress` retombait alors systématiquement à
  // `null`, sans qu'aucun test hors de ce fichier ne puisse le voir (les tests de
  // project-stats.spec.js appellent `aggregateProjectStats` directement avec un `pattern`
  // construit à la main, ils ne passent jamais par ce point d'appel). Ce test seed un patron
  // AVEC lecteur structuré (même forme que `seedWithSections` ci-dessus) et un `readerState`
  // partiel, puis lit `rowsProgress` là où l'appli le consomme réellement : la prop `stats`
  // reçue par `BadgeComposer` (`:stats="projectStats"`).
  it('le badge reçoit un rowsProgress calculé depuis le lecteur du patron RÉELLEMENT lié (câblage projectStats → BadgeComposer)', async () => {
    const patId = await db.patterns.add({
      name: 'SABAI',
      reader: {
        sizeLabels: [],
        sections: [
          { id: 's1', kind: 'pelote', title: 'Encolure', steps: [{ t: 'Rg 1' }, { t: 'Rg 2' }, { t: 'Rg 3' }] },
          { id: 's2', kind: 'pelote', title: 'Corps', steps: [{ t: 'Rg 1' }, { t: 'Rg 2' }] },
        ],
      },
    })
    // 2 rangs faits sur les 3 de la section « Encolure », rien coché dans « Corps » :
    // 2 faits / 5 au total, connu à l'avance — pas un stub, le calcul passe par readerProgress.
    await seedProject({ patternId: patId, readerState: { done: { 's1#0': true, 's1#1': true } } })
    const w = mountDetail()
    await flushPromises()

    await w.findAll('[role="tab"]').find((b) => b.text() === tk('project.tab.stats')).trigger('click')
    await flushPromises()
    await w.find('[data-test="open-badge-composer"]').trigger('click')
    await flushPromises()

    const composer = w.findComponent({ name: 'BadgeComposer' })
    expect(composer.props('stats').rowsProgress).toEqual({ done: 2, total: 5 })
  })

  // Spec §141 : après génération, la feuille RESTE ouverte pour montrer l'aperçu du badge.
  // Elle se refermait sur `saved`, ce qui rendait cet aperçu inatteignable.
  it('la feuille de badge reste ouverte après génération, et se ferme sur Fermer', async () => {
    const pid = await seedProject({ startedAt: '2026-01-05', finishedAt: '' })
    await db.sessions.add({
      projectId: pid, sectionId: SESSION_NO_SECTION, date: '2026-01-05T10:00:00.000Z',
      durationSec: 1800, rowsDone: 4, manual: true,
    })
    const w = mountDetail()
    await flushPromises()
    await w.findAll('[role="tab"]').find((b) => b.text() === tk('project.tab.stats')).trigger('click')
    await flushPromises()
    await w.find('[data-test="open-badge-composer"]').trigger('click')
    await flushPromises()

    const composer = w.findComponent({ name: 'BadgeComposer' })
    composer.vm.$emit('saved')
    await flushPromises()
    expect(w.findComponent({ name: 'BadgeComposer' }).exists()).toBe(true)
    // Aucun snackbar de confirmation : il serait rendu SOUS la feuille opaque (z-index 100
    // contre 1050), donc invisible. C'est l'aperçu affiché dans la feuille qui confirme.
    expect(useSnackbarStore().message).toBeFalsy()

    composer.vm.$emit('close')
    await flushPromises()
    expect(w.findComponent({ name: 'BadgeComposer' }).exists()).toBe(false)
  })

  it("l'onglet Infos liste les tailles et la taille active est marquée", async () => {
    await seedProject()
    const w = mountDetail()
    await flushPromises()
    await w.find('#tab-infos').trigger('click')
    await flushPromises()

    const chips = w.findAll('.chips--sizes .chip')
    expect(chips.map((c) => c.text())).toEqual(['S', 'M', 'L'])
    expect(chips.find((c) => c.text() === 'M').classes()).toContain('chip--on')
  })

  it('cliquer une taille met à jour activeSize et le persiste', async () => {
    const pid = await seedProject()
    const w = mountDetail()
    await flushPromises()
    await w.find('#tab-infos').trigger('click')
    await flushPromises()

    await w.findAll('.chips--sizes .chip').find((c) => c.text() === 'L').trigger('click')
    await vi.waitFor(async () => expect((await db.projects.get(pid)).activeSize).toBe('L'), { timeout: 10000 })
  })

  it("bascule sur l'onglet Sections et affiche le panneau sections (projet sans patron lié)", async () => {
    await seedProject()
    const w = mountDetail()
    await flushPromises()

    await w.find('#tab-sections').trigger('click')
    await flushPromises()

    // Projet sans patron lié : pas d'aperçu reader, mais le bloc Compteurs est présent.
    expect(w.find('#panel-sections').exists()).toBe(true)
    expect(w.findAll('.rovw')).toHaveLength(0)
    expect(w.find('.counters-block').exists()).toBe(true)
  })

  it("l'onglet Sections somme les exemplaires : section à 2 exemplaires dont un fini, 50 %", async () => {
    const patId = await db.patterns.add({
      name: 'Chaussettes',
      reader: { sizeLabels: [], sections: [{ id: 'p1', kind: 'pied', title: 'Pied', copies: 2, steps: [{ t: 'Rg 1' }, { t: 'Rg 2' }] }] },
    })
    await seedProject({ patternId: patId, readerState: { done: { 'p1#0': true, 'p1#1': true } } })
    const w = mountDetail()
    await flushPromises()
    expect(w.find('.rovw__pct').text()).toBe('50 %')
    expect(w.find('.rprog__frac').text()).toBe('2 / 4')
  })

  describe('clic sur une section de l’aperçu → atterrit DANS cette section (#9)', () => {
    async function seedWithSections() {
      const patId = await db.patterns.add({
        name: 'SABAI',
        reader: {
          sizeLabels: [],
          sections: [
            { id: 's1', kind: 'pelote', title: 'Encolure', steps: [{ t: 'Rg 1' }] },
            { id: 's2', kind: 'pelote', title: 'Corps', steps: [{ t: 'Rg 1' }] },
          ],
        },
      })
      const pid = await seedProject({ patternId: patId })
      return pid
    }

    it('ouvre le lecteur avec ?section=<id> DE LA SECTION CLIQUÉE (pas la reprise générale)', async () => {
      const pid = await seedWithSections()
      const w = mountDetail()
      await flushPromises()

      // Case « section faite » : la tuile `.rovw` est un div, le clic-ouverture
      // vit désormais sur son bouton enfant `.rovw__main` (la case `.rovw__done` est sa
      // sœur, pour ne jamais ouvrir le lecteur en cochant).
      const secBtn = w.findAll('.rovw__main').find((b) => b.text().includes('Corps'))
      expect(secBtn).toBeTruthy()
      await secBtn.trigger('click')

      // project.value.id vient de projectsStore.get() (db.projects.get(Number(id))) : c'est
      // le NOMBRE (clé Dexie), pas la chaîne de route.params.id — à ne pas confondre avec
      // les autres assertions du fichier qui comparent route.params.id (déjà une chaîne).
      expect(nav.router.push).toHaveBeenCalledWith({
        name: 'project-read',
        params: { id: pid },
        query: { section: 's2' },
      })
    })

    it('bouton « Suivre le patron » (global) reste sans query.section — comportement inchangé', async () => {
      const pid = await seedWithSections()
      const w = mountDetail()
      await flushPromises()

      await w.find('.reader-btn').trigger('click')

      expect(nav.router.push).toHaveBeenCalledWith({ name: 'project-read', params: { id: pid } })
      expect(nav.router.push).not.toHaveBeenCalledWith(expect.objectContaining({ query: expect.anything() }))
    })
  })

  it("le menu Actions permet d'éditer (navigation)", async () => {
    const pid = await seedProject()
    const w = mountDetail()
    await flushPromises()

    await w.find('.phdr__kebab').trigger('click')
    await w.findAll('.menu__item').find((b) => b.text() === tk('project.edit')).trigger('click')

    expect(nav.router.push).toHaveBeenCalledWith({ name: 'project-edit', params: { id: String(pid) } })
  })

  // Spec 08/09 (fusion chrono + œil) : l'entrée chrono REVIINT dans le menu — dynamique
  // selon l'état de project.showTimer (elle avait quitté ce menu pour l'œil du suivi, puis
  // l'œil lui-même a disparu au profit du chevron de la pastille ; le kebab est redevenu
  // une porte de retour durable). Le détail des gestes est couvert par
  // project-detail-chrono.spec.js ; ici : la présence et la DYNAMIQUE du libellé.
  // Demande Julien (21/09) : « Partager » dans le kebab, second chemin vers le composeur de
  // badge, disponible depuis n'importe quel onglet (pas seulement Stats).
  it('le menu porte « Partager », qui ouvre le composeur de badge sans changer d’onglet', async () => {
    await seedProject()
    const w = mountDetail()
    await flushPromises()
    const avant = w.vm.tab

    await w.find('.phdr__kebab').trigger('click')
    await flushPromises()
    const item = w.find('[data-test="menu-share-badge"]')
    expect(item.exists()).toBe(true)
    expect(item.text()).toBe(i18n.global.t('project.stats.badge.create'))

    await item.trigger('click')
    await flushPromises()
    expect(w.vm.showBadgeComposer).toBe(true)
    expect(w.vm.menuOpen).toBe(false)
    expect(w.vm.tab).toBe(avant)
  })

  it('le menu porte la bascule chrono, dynamique selon project.showTimer', async () => {
    const pid = await seedProject()
    const w = mountDetail()
    await flushPromises()

    await w.find('.phdr__kebab').trigger('click')
    await flushPromises()

    const labels = w.findAll('.menu__item').map((n) => n.text())
    // Le menu est bien ouvert (garde-fou anti-test-vide) : il reste au moins « Modifier le projet ».
    expect(labels.length).toBeGreaterThan(0)
    expect(labels).toContain(i18n.global.t('project.edit'))
    // État par défaut (chrono affiché) : l'entrée propose de le MASQUER…
    expect(labels).toContain(i18n.global.t('reader.hideTimer'))
    expect(labels).not.toContain(i18n.global.t('reader.showTimer'))

    // …et une fois le chrono masqué (showTimer:false posé À LA CRÉATION — la fiche lit le
    // projet une seule fois au montage), elle propose de le RÉAFFICHER (jamais les deux
    // à la fois).
    await w.unmount()
    await seedProject({ showTimer: false })
    const wMasque = mountDetail()
    await flushPromises()
    await wMasque.find('.phdr__kebab').trigger('click')
    await flushPromises()
    const labelsMasque = wMasque.findAll('.menu__item').map((n) => n.text())
    expect(labelsMasque).toContain(i18n.global.t('reader.showTimer'))
    expect(labelsMasque).not.toContain(i18n.global.t('reader.hideTimer'))
  })

  describe('onglet Infos : trace des pelotes tricotées (décision 2)', () => {
    it('laine réservée (non terminée) : affiche le rendu réservé habituel, sans mention « tricotées »', async () => {
      const pid = await seedProject()
      await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      // Deux passes, pas une (correctif revue du 10/08/2026) : `FirstDetailTip`,
      // monté par cette vue, marque désormais `swipeHintSeen` DÈS SON AFFICHAGE (écriture
      // Dexie attendue, cf. son commentaire) — cette écriture partage la même file
      // d'attente IndexedDB (fake-indexeddb) que le `db.projects.get(pid)` de CETTE vue,
      // et une seule `flushPromises()` ne suffit plus toujours à sortir du squelette de
      // chargement (`#tab-infos` resterait alors introuvable).
      await flushPromises()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      const items = w.findAll('.yarnlist li')
      expect(items).toHaveLength(1)
      expect(items[0].text()).toContain('Drops')
      expect(items[0].text()).not.toContain(i18n.global.t('project.yarnKnitted', { n: 2 }))
    })

    it('laine réservée : affiche « ×réservé / stock » avec des décimales à la virgule', async () => {
      const pid = await seedProject()
      await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5.5, reservations: { [pid]: 2.5 } })
      const w = mountDetail()
      await flushPromises()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      expect(w.find('.yarnlist li').text()).toContain('×2,5 / 5,5')
    })

    it('projet terminé dont les pelotes ont été consommées (plus aucune réservation) : la laine reste visible, « n pelotes tricotées »', async () => {
      const pid = await seedProject({ status: 'done' })
      await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 3, reservations: {}, consumed: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      // Sans l'extension à `consumed`, cette laine n'apparaîtrait plus du tout
      // (jamais perdre l'info — décision produit) : garde-fou anti-régression.
      const items = w.findAll('.yarnlist li')
      expect(items).toHaveLength(1)
      expect(items[0].text()).toContain('Drops')
      expect(items[0].text()).toContain(i18n.global.t('project.yarnKnitted', { n: 2 }))
    })

    it('pelotes tricotées décimales : la virgule remplace le point (2,5, pas 2.5)', async () => {
      const pid = await seedProject({ status: 'done' })
      await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 3, reservations: {}, consumed: { [pid]: 2.5 } })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      expect(w.find('.yarnlist li').text()).toContain(i18n.global.t('project.yarnKnitted', { n: '2,5' }))
    })

    it('une laine réservée par ce projet ET une autre consommée par lui apparaissent toutes les deux', async () => {
      const pid = await seedProject()
      await db.yarns.add({ brand: 'Réservée', quantity: 5, reservations: { [pid]: 1 } })
      await db.yarns.add({ brand: 'Consommée', quantity: 1, reservations: {}, consumed: { [pid]: 4 } })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      const texts = w.findAll('.yarnlist li').map((n) => n.text())
      expect(texts).toHaveLength(2)
      expect(texts.some((t) => t.includes('Réservée'))).toBe(true)
      expect(texts.some((t) => t.includes('Consommée') && t.includes(i18n.global.t('project.yarnKnitted', { n: 4 })))).toBe(true)
    })

    it('ni réservation ni consommation : retombe sur « aucune laine liée »', async () => {
      await seedProject()
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      expect(w.find('.yarnlist').exists()).toBe(false)
      expect(w.find('.yarnlist__empty').text()).toBe(i18n.global.t('project.yarnsNone'))
    })
  })

  describe('suppression : ne pose plus de question (R1 — retrait du dialogue « pelotes tricotées ? »)', () => {
    it('aucune laine réservée : supprime directement, sans poser de question', async () => {
      const pid = await seedProject()
      const w = mountDetail()
      await flushPromises()

      await w.find('.phdr__kebab').trigger('click')
      await w.findAll('.menu__item').find((b) => b.text() === i18n.global.t('project.delete')).trigger('click')

      // La cascade de suppression (Dexie) retombe sur plusieurs micro-tâches : on attend
      // le résultat plutôt qu'un seul flushPromises (même motif que le test « taille active »).
      await vi.waitFor(async () => {
        expect(await db.projects.get(pid)).toBeUndefined()
        expect(await db.trash.count()).toBe(1)
      }, { timeout: 10000 })
      expect(nav.router.replace).toHaveBeenCalledWith({ name: 'home' })
      // Passe bien par softDelete : le projet est récupérable depuis la corbeille (annulable).
      expect(await db.trash.count()).toBe(1)
    })

    it('laine réservée : supprime quand même directement, sans poser de question — la quantité n’est jamais touchée', async () => {
      const pid = await seedProject()
      const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()

      await w.find('.phdr__kebab').trigger('click')
      await w.findAll('.menu__item').find((b) => b.text() === i18n.global.t('project.delete')).trigger('click')

      await vi.waitFor(async () => {
        expect(await db.projects.get(pid)).toBeUndefined()
        expect(await db.trash.count()).toBe(1)
      }, { timeout: 10000 })
      expect(nav.router.replace).toHaveBeenCalledWith({ name: 'home' })
      const y = await db.yarns.get(yid)
      expect(y.reservations).toEqual({}) // la réservation revient au pool
      expect(y.quantity).toBe(5) // la suppression ne déduit JAMAIS la quantité (R1)
      expect(await db.trash.count()).toBe(1) // passe bien par softDelete (annulable)
    })
  })

  describe('clôture (statut Terminé) : « combien de pelotes as-tu utilisées ? »', () => {
    it('aucune laine réservée : passe à Terminé directement, sans poser de question', async () => {
      const pid = await seedProject()
      const w = mountDetail()
      await flushPromises()

      await w.findComponent(StatusBadge).vm.$emit('change', 'done')
      await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('done'), { timeout: 10000 })
      expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(false)
    })

    it('laine réservée : ouvre le dialogue et ne change pas le statut tant que non validé', async () => {
      const pid = await seedProject()
      const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()

      await w.findComponent(StatusBadge).vm.$emit('change', 'done')
      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })
      expect(w.findComponent(YarnConsumptionDialog).props('yarns')).toEqual([
        { id: yid, name: 'Drops · Bleu', reserved: 2, available: 5, othersReserved: false },
      ])
      expect((await db.projects.get(pid)).status).toBe('wip')
    })

    it('Valider avec les valeurs par défaut déduit tout le réservé et passe à Terminé', async () => {
      const pid = await seedProject()
      const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()

      await w.findComponent(StatusBadge).vm.$emit('change', 'done')
      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })

      await w.findComponent(YarnConsumptionDialog).vm.$emit('confirm', [{ id: yid, used: 2 }])
      await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('done'), { timeout: 10000 })
      expect((await db.yarns.get(yid)).quantity).toBe(3) // 5 - 2 tricotées
      expect((await db.yarns.get(yid)).reservations).toEqual({})
      expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(false)
    })

    it('Annuler : ferme sans consommer et sans changer le statut', async () => {
      const pid = await seedProject()
      const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()

      await w.findComponent(StatusBadge).vm.$emit('change', 'done')
      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })

      await w.findComponent(YarnConsumptionDialog).vm.$emit('cancel')
      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(false), { timeout: 10000 })
      expect((await db.projects.get(pid)).status).toBe('wip')
      expect((await db.yarns.get(yid)).quantity).toBe(5)
    })

    it('valider avec une quantité rectifiée déduit seulement ce qui est saisi, le reste retourne au stock', async () => {
      const pid = await seedProject()
      const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()

      await w.findComponent(StatusBadge).vm.$emit('change', 'done')
      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })

      await w.findComponent(YarnConsumptionDialog).vm.$emit('confirm', [{ id: yid, used: 0 }])
      await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('done'), { timeout: 10000 })
      expect((await db.yarns.get(yid)).quantity).toBe(5) // rien tricoté : rien déduit
    })

    it("passer à Terminé depuis la fiche affiche IMMÉDIATEMENT la date de fin dans l'onglet Infos, sans recharger l'écran", async () => {
      // Défaut trouvé en revue : `changeStatus` ne recopiait que `project.value.status` après
      // l'écriture. La RÈGLE 1 (statut → date, §7bis) écrit `finishedAt` en base comme
      // effet de bord de `projectsStore.update()` — mais un objet local qui ne recopie pas ce
      // champ n'en sait rien : la tuile « Fin » de l'onglet Infos resterait vide jusqu'au
      // prochain chargement de l'écran, alors que l'utilisatrice vient de clôturer son projet
      // sous ses yeux. Vise le RENDU (ce test), pas la base (déjà couvert par le test
      // précédent) : sinon on prouverait à nouveau l'écriture, jamais l'affichage.
      const pid = await seedProject()
      const w = mountDetail()
      await flushPromises()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      const finTile = () => w.findAll('.itile').find((el) => el.find('.itile__k').text() === i18n.global.t('project.finishedAt'))
      expect(finTile()).toBeUndefined() // pas encore de date : le projet est 'wip'

      await w.findComponent(StatusBadge).vm.$emit('change', 'done')
      await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('done'), { timeout: 10000 })
      await vi.waitFor(() => expect(finTile()).toBeDefined(), { timeout: 10000 })
      expect(finTile().find('.itile__v').text()).not.toBe('')
    })
  })

  describe('abandon (statut Abandonné, R3) : même question, défaut inversé à 0', () => {
    it('laine réservée : passer à Abandonné ouvre le dialogue en mode « abandonné » (défaut 0)', async () => {
      const pid = await seedProject()
      await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()

      await w.findComponent(StatusBadge).vm.$emit('change', 'abandoned')
      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })
      expect(w.findComponent(YarnConsumptionDialog).props('mode')).toBe('abandoned')
      expect((await db.projects.get(pid)).status).toBe('wip')
    })

    it('Valider avec le défaut (0 perdu) ne déduit rien : tout revient au stock', async () => {
      const pid = await seedProject()
      const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()

      await w.findComponent(StatusBadge).vm.$emit('change', 'abandoned')
      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })

      await w.findComponent(YarnConsumptionDialog).vm.$emit('confirm', [{ id: yid, used: 0 }])
      await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('abandoned'), { timeout: 10000 })
      expect((await db.yarns.get(yid)).quantity).toBe(5) // rien perdu : rien déduit
      expect((await db.yarns.get(yid)).reservations).toEqual({}) // le réservé revient au pool
    })
  })

  describe('projet dont le patron a disparu', () => {
    // Le patron supprimé de la bibliothèque laissait la fiche VIDE, sans explication.
    // Cf. audit UX 16/07 (« perte silencieuse = bug »).
    it('affiche un bandeau explicatif', async () => {
      await seedProject({ patternId: 999 }) // 999 : aucun patron ne porte cet id
      const w = mountDetail()
      await flushPromises()

      expect(w.text()).toMatch(/patron.*supprim/i)
      expect(w.text()).toMatch(/corbeille/i)
    })

    it('n’affiche pas « Suivre le patron » puisqu’il n’y a plus de patron', async () => {
      await seedProject({ patternId: 999 })
      const w = mountDetail()
      await flushPromises()

      expect(w.text()).not.toMatch(/Suivre le patron/i)
    })

    it('n’affiche aucun bandeau pour un projet libre (sans patron)', async () => {
      await seedProject({ patternId: null })
      const w = mountDetail()
      await flushPromises()

      expect(w.text()).not.toMatch(/patron.*supprim/i)
    })

    it('n’affiche aucun bandeau quand le patron est bien là', async () => {
      // Cas sain : le bandeau ne doit JAMAIS apparaître sur un projet dont le patron existe
      // (patternMissing = patternId != null ET linkedPattern == null). Ce test échoue si on
      // cassait la clause `linkedPattern == null` — la garde qui protège les projets sains.
      const patId = await db.patterns.add({ name: 'SABAI', reader: { sizeLabels: [], sections: [] } })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()

      expect(w.text()).not.toMatch(/patron.*supprim/i)
    })
  })

  describe('onglet Détails : section « Patron source » — vignette couverture + lien PDF', () => {
    it("plus de boutons Aperçu/Ouvrir (ProjectPdfGallery variant pdf retiré) même avec un PDF lié", async () => {
      const patId = await db.patterns.add({ name: 'SABAI', pdf: 'data:application/pdf;base64,AAAA' })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      const section = w.find('.patron-source')
      expect(section.exists()).toBe(true)
      expect(section.text()).not.toContain(i18n.global.t('patternExtras.preview'))
      expect(section.text()).not.toContain(i18n.global.t('patternExtras.openExternal'))
    })

    it('le lien « Voir le PDF original » appelle viewPatternPdf (openPdfExternally)', async () => {
      const patId = await db.patterns.add({ name: 'SABAI', pdf: 'data:application/pdf;base64,AAAA' })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      const link = w.find('.patron-source__open')
      expect(link.exists()).toBe(true)
      expect(link.text()).toContain(i18n.global.t('project.viewPdf'))
      await link.trigger('click')
      await flushPromises()

      expect(openPdfExternally).toHaveBeenCalledTimes(1)
      expect(openPdfExternally.mock.calls[0][0]).toBe('data:application/pdf;base64,AAAA')
    })

    it('sans PDF : le lien « Voir le PDF original » est absent', async () => {
      const patId = await db.patterns.add({ name: 'SABAI' })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      expect(w.find('.patron-source__open').exists()).toBe(false)
    })

    it("avec une photo de patron (photos[0]) : la vignette couverture est affichée et son tap ouvre le PDF", async () => {
      const patId = await db.patterns.add({
        name: 'SABAI',
        pdf: 'data:application/pdf;base64,AAAA',
        photos: ['data:image/png;base64,COVER', 'data:image/png;base64,SECOND'],
      })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      const cover = w.find('.patron-source__cover')
      expect(cover.exists()).toBe(true)
      const img = cover.find('img.patron-source__img')
      expect(img.exists()).toBe(true)
      expect(img.attributes('src')).toBe('data:image/png;base64,COVER') // 1re photo, pas la 2e

      await cover.trigger('click')
      await flushPromises()
      expect(openPdfExternally).toHaveBeenCalledTimes(1)
    })

    it('sans photo de patron : pas de vignette couverture', async () => {
      const patId = await db.patterns.add({ name: 'SABAI', pdf: 'data:application/pdf;base64,AAAA' })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      expect(w.find('.patron-source__cover').exists()).toBe(false)
    })

    it("avec une photo MAIS sans PDF retenu (import best-effort partiel) : pas de vignette couverture — éviterait un tap mort", async () => {
      const patId = await db.patterns.add({ name: 'SABAI', photos: ['data:image/png;base64,COVER'] })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      expect(w.find('.patron-source__cover').exists()).toBe(false)
    })
  })

  describe('menu ⋮ : « Voir le PDF original » + « Corriger le patron » (patron rattaché, #7+#8)', () => {
    async function openMenu(w) {
      await w.find('.phdr__kebab').trigger('click')
      await flushPromises()
    }
    function menuLabels(w) {
      return w.findAll('.menu__item').map((n) => n.text())
    }

    it('sans patron rattaché : ni « Voir le PDF original » ni « Corriger le patron »', async () => {
      await seedProject()
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      const labels = menuLabels(w)
      expect(labels).not.toContain(i18n.global.t('project.viewPdf'))
      expect(labels).not.toContain(i18n.global.t('project.correctPattern'))
    })

    it('patron rattaché sans PDF ni sections de lecteur : ni l’un ni l’autre item', async () => {
      const patId = await db.patterns.add({ name: 'SABAI' })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      const labels = menuLabels(w)
      expect(labels).not.toContain(i18n.global.t('project.viewPdf'))
      expect(labels).not.toContain(i18n.global.t('project.correctPattern'))
    })

    it('patron avec PDF : l’item « Voir le PDF original » ouvre le PDF et ferme le menu', async () => {
      const patId = await db.patterns.add({ name: 'SABAI', pdf: 'data:application/pdf;base64,AAAA' })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      const item = w.findAll('.menu__item').find((b) => b.text() === i18n.global.t('project.viewPdf'))
      expect(item).toBeTruthy()
      await item.trigger('click')
      await flushPromises()

      expect(openPdfExternally).toHaveBeenCalledTimes(1)
      expect(openPdfExternally.mock.calls[0][0]).toBe('data:application/pdf;base64,AAAA')
      expect(w.find('.menu').exists()).toBe(false) // le menu s'est fermé
    })

    it('patron sans PDF : l’item « Voir le PDF original » est absent', async () => {
      const patId = await db.patterns.add({ name: 'SABAI', reader: { sizeLabels: [], sections: [{ id: 's1', kind: 'pelote', title: 'Corps', steps: [] }] } })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      expect(menuLabels(w)).not.toContain(i18n.global.t('project.viewPdf'))
    })

    it('patron avec des sections de lecteur : l’item « Corriger le patron » route vers l’éditeur et ferme le menu', async () => {
      const patId = await db.patterns.add({
        name: 'SABAI',
        reader: { sizeLabels: [], sections: [{ id: 's1', kind: 'pelote', title: 'Corps', steps: [] }] },
      })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      const item = w.findAll('.menu__item').find((b) => b.text() === i18n.global.t('project.correctPattern'))
      expect(item).toBeTruthy()
      await item.trigger('click')

      expect(nav.router.push).toHaveBeenCalledWith({ name: 'pattern-correct', params: { id: patId } })
      expect(w.find('.menu').exists()).toBe(false) // le menu s'est fermé
    })

    it('patron sans sections de lecteur (reader.sections vide) : l’item « Corriger le patron » est absent', async () => {
      const patId = await db.patterns.add({ name: 'SABAI', pdf: 'data:application/pdf;base64,AAAA', reader: { sizeLabels: [], sections: [] } })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      expect(menuLabels(w)).not.toContain(i18n.global.t('project.correctPattern'))
    })

    it('patron créé manuellement (pas de sections, une galerie) : l’item « Corriger le patron » est présent et route vers l’éditeur', async () => {
      const patId = await db.patterns.add({ name: 'SABAI', gallery: [{ src: 'data:image/png;base64,GAL', page: 0, w: 10, h: 10 }] })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      const item = w.findAll('.menu__item').find((b) => b.text() === i18n.global.t('project.correctPattern'))
      expect(item).toBeTruthy()
      await item.trigger('click')

      expect(nav.router.push).toHaveBeenCalledWith({ name: 'pattern-correct', params: { id: patId } })
    })

    it('échec de l’ouverture du PDF : ferme quand même le menu et avertit sans planter', async () => {
      openPdfExternally.mockRejectedValueOnce(new Error('boom'))
      const patId = await db.patterns.add({ name: 'SABAI', pdf: 'data:application/pdf;base64,AAAA' })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      const item = w.findAll('.menu__item').find((b) => b.text() === i18n.global.t('project.viewPdf'))
      await item.trigger('click')
      await flushPromises()

      expect(useSnackbarStore().message).toBe(i18n.global.t('patternExtras.openError'))
    })
  })
})

// ── Fiche projet montée avec l'i18n français seul (prix du patron, coût du projet) ────────
// Instance dédiée : les assertions de ces deux blocs lisent des chaînes françaises et le
// format « 8,50 », que l'i18n de l'application ne garantit pas sous jsdom (locale en-US).
const i18nFr = createTestI18n()

// La fiche projet AFFICHE le prix du patron, en lecture seule (lot 07/08). Elle ne l'édite
// pas : la saisie est dans le formulaire du projet et sur la fiche du patron.
//
// Trois états à distinguer, et c'est tout l'enjeu :
//   prix renseigné -> le montant ;  prix « 0 » -> « Gratuit » ;  prix vide -> AUCUNE LIGNE
// (pas une ligne vide : une étiquette sans valeur est du bruit).
describe('fiche projet — prix du patron', () => {
  async function monterAvecPrix(over) {
    const patId = await db.patterns.add({ name: 'Sabai', type: 'knitting', ...over })
    const projectId = await db.projects.add({ name: 'Bonnet', patternId: patId })
    route.params = { id: String(projectId) }
    // Correction de fixture : .patron-source vit dans le panneau « Infos », pas dans l'onglet
    // par défaut (« Sections », cf. ProjectDetailView.vue:59 `tab = ref(route.query.tab ||
    // 'sections')`). Sans ce query, le bloc n'est jamais monté — pour une raison étrangère
    // au prix du patron.
    route.query = { tab: 'infos' }
    const w = mount(ProjectDetailView, { global: { plugins: [i18nFr], stubs: { AppHeader: true } } })
    // Correction de fixture (héritée d'un correctif antérieur) : un seul flushPromises() ne vide pas la
    // chaîne Dexie de loadAll() (project → linkedPattern → Promise.all des 4 stores). `loading`
    // reste `true` un tour de plus que `linkedPattern`, et le template masque TOUT derrière
    // <SkeletonScreen v-else-if="loading">, y compris le bloc .patron-source — attendre le
    // signal de fin réel plutôt qu'un délai fixe.
    await flushPromises()
    await vi.waitFor(() => expect(w.vm.loading).toBe(false))
    return w
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.delete()
    await db.open()
  })

  it('1. prix renseigné ⇒ le montant s’affiche', async () => {
    // CHF plutôt que le EUR d'origine : EUR est DEFAULT_CURRENCY, et la
    // seule assertion de montant ne regarde de toute façon jamais la devise — l'ajout de
    // `toContain('CHF')` ci-dessous est ce qui rend `p.priceCurrency` (et non un repli codé
    // en dur) réellement exercé.
    const w = await monterAvecPrix({ price: '8,50', priceCurrency: 'CHF' })
    const ligne = w.find('[data-test="project-pattern-price"]')
    expect(ligne.exists()).toBe(true)
    expect(ligne.text()).toContain('8,50')
    expect(ligne.text()).toContain('CHF')
  })

  it('2. prix « 0 » ⇒ « Gratuit », pas « 0,00 € »', async () => {
    const w = await monterAvecPrix({ price: '0', priceCurrency: 'EUR' })
    const ligne = w.find('[data-test="project-pattern-price"]')
    expect(ligne.exists()).toBe(true)
    expect(ligne.text()).toContain(fr.pattern.priceFree)
    // `not.toContain('0,00')` (tel quel) ne peut jamais rougir : le profil
    // « detail » de formatMoney omet les centimes sur un montant rond (« 0 € », jamais
    // « 0,00 € ») — même si la branche « Gratuit » disparaissait, ce texte n'apparaîtrait
    // toujours pas. On vérifie l'absence de tout chiffre à la place : ça mord sur la vraie
    // mutation (M1, plus bas), qui ferait apparaître « 0 € ».
    expect(ligne.text()).not.toMatch(/\d/)
  })

  it('2 bis. prix illisible ⇒ « Prix inconnu », jamais « Gratuit »', async () => {
    const w = await monterAvecPrix({ price: 'environ 5', priceCurrency: 'EUR' })
    const ligne = w.find('[data-test="project-pattern-price"]')
    expect(ligne.exists()).toBe(true)
    expect(ligne.text()).toContain(fr.purchases.priceUnknown)
    expect(ligne.text()).not.toContain(fr.pattern.priceFree)
  })

  it('3. prix VIDE ⇒ AUCUNE ligne (pas une ligne vide)', async () => {
    const w = await monterAvecPrix({ price: '' })
    expect(w.find('[data-test="project-pattern-price"]').exists()).toBe(false)
  })
})

describe('fiche projet : designer du patron source', () => {
  async function monterAvecPatron(over) {
    const patId = await db.patterns.add({ type: 'knitting', ...over })
    const projectId = await db.projects.add({ name: 'Bonnet', patternId: patId })
    route.params = { id: String(projectId) }
    route.query = { tab: 'infos' }
    const w = mount(ProjectDetailView, { global: { plugins: [i18nFr], stubs: { AppHeader: true } } })
    await flushPromises()
    await vi.waitFor(() => expect(w.vm.loading).toBe(false))
    return w
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.delete()
    await db.open()
  })

  // La fiche projet lit le designer en direct sur le patron lié, et rien sans designer ou sur le patron libre.
  it('affiche « par <designer> » sous le patron source', async () => {
    const w = await monterAvecPatron({ name: 'Bonnet', author: 'Sys Fredens' })
    expect(w.find('[data-test="project-pattern-designer"]').text()).toContain('Sys Fredens')
  })
  it('sans designer ou patron libre : aucune ligne', async () => {
    const a = await monterAvecPatron({ name: 'Bonnet', author: '' })
    expect(a.find('[data-test="project-pattern-designer"]').exists()).toBe(false)
    const b = await monterAvecPatron({ name: 'Libre', author: 'X', builtin: true })
    expect(b.find('[data-test="project-pattern-designer"]').exists()).toBe(false)
  })
  // Protège : un author blanc ou non-chaîne ne laisse pas un « par » orphelin.
  it('author blanc ou non-chaîne : aucune ligne', async () => {
    const a = await monterAvecPatron({ name: 'Bonnet', author: '  ' })
    expect(a.find('[data-test="project-pattern-designer"]').exists()).toBe(false)
    const b = await monterAvecPatron({ name: 'Bonnet', author: 42 })
    expect(b.find('[data-test="project-pattern-designer"]').exists()).toBe(false)
  })
})

// La fiche projet affiche le COÛT du projet (lot 08/08) : le prix des laines qu'il a
// réservées ou déjà tricotées. Lecture seule — la saisie des prix vit sur les fiches laine.
//
// Fixture : trois points MESURÉS avant écriture du plan, ne pas les retirer —
//  1. `route.query = { tab: 'infos' }` : la tuile vit dans le panneau « Détails », qui n'est
//     PAS l'onglet par défaut (ProjectDetailView.vue:59) ;
//  2. `vi.waitFor(loading === false)` : un seul flushPromises() laisse le squelette masquer
//     tout le panneau ;
//  3. `setSetting('currency') + settings.load()` : la devise des laines vient du réglage
//     global. EUR étant DEFAULT_CURRENCY, tester en EUR ne prouverait rien.
//
// LIMITE ASSUMÉE de cette fixture : parce qu'elle charge le magasin `settings` AVANT le
// montage, le filet `if (!settings.loaded) settings.load()` de la vue n'est exercé par
// AUCUN test de ce bloc. Il reproduit à l'identique le motif de StashView.vue:86 et
// d'ExpensesView — à ne pas compter comme couvert lors de la revue.
describe('fiche projet — coût du projet (laines)', () => {
  // Monte la fiche d'un projet neuf. `yarns` : laines à créer (le projet leur est injecté via
  // `reserved` / `knitted`). `pattern` : champs du patron lié (omis = projet sans patron).
  // `currency` : le réglage global, qui pilote la devise des LAINES (jamais celle du patron).
  async function monter({ yarns = [], pattern = null, currency = 'CHF' } = {}) {
    // `patternId` n'est POSÉ que s'il y a un patron : écrire `patternId: undefined` sur un
    // projet libre le ferait passer pour un projet dont le patron a été supprimé
    // (`patternMissing`, ProjectDetailView.vue:111) — un autre écran, un autre test.
    const projectId = pattern
      ? await db.projects.add({
          name: 'Bonnet',
          patternId: await db.patterns.add({ name: 'Sabai', type: 'knitting', ...pattern }),
        })
      : await db.projects.add({ name: 'Bonnet' })
    for (const y of yarns) {
      const { reserved = 0, knitted = 0, ...rest } = y
      await db.yarns.add({
        brand: 'Drops', quantity: 10, ...rest,
        reservations: reserved ? { [projectId]: reserved } : {},
        consumed: knitted ? { [projectId]: knitted } : {},
      })
    }
    await setSetting('currency', currency)
    await useSettingsStore().load()
    route.params = { id: String(projectId) }
    route.query = { tab: 'infos' }
    const w = mount(ProjectDetailView, { global: { plugins: [i18nFr], stubs: { AppHeader: true } } })
    await flushPromises()
    await vi.waitFor(() => expect(w.vm.loading).toBe(false))
    return w
  }

  const tuile = (w) => w.find('[data-test="project-total-cost"]')

  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.delete()
    await db.open()
  })

  it('1. ni laine ni prix de patron ⇒ AUCUNE tuile (pas une tuile vide)', async () => {
    const w = await monter()
    expect(tuile(w).exists()).toBe(false)
  })

  it('2. laines réservées et tricotées ⇒ le montant, dans la devise du RÉGLAGE', async () => {
    const w = await monter({
      currency: 'CHF',
      yarns: [
        { price: '4,50', reserved: 3 }, // 13,50
        { price: '2', knitted: 2 },     //  4
      ],
    })
    const txt = tuile(w).text()
    // 17,50 : valeur à CENTIMES à dessein — sur un montant rond, formatMoney profil
    // « detail » n'écrit aucune décimale, et le format ne serait pas réellement exercé.
    expect(txt).toContain('17,50')
    // CHF et non EUR : EUR est DEFAULT_CURRENCY, l'assertion passerait sur un repli codé
    // en dur. C'est CE `toContain` qui prouve que `settings.currency` est lu.
    expect(txt).toContain('CHF')
  })

  it('2b. deux laines en devises différentes ⇒ les DEUX montants, chacun dans sa devise', async () => {
    const w = await monter({
      currency: 'CHF',
      yarns: [
        { price: '4,50', priceCurrency: 'EUR', reserved: 3 }, // 13,50 EUR
        { price: '2', priceCurrency: 'USD', knitted: 2 },     //  4 USD
      ],
    })
    const txt = tuile(w).text()
    expect(txt).toMatch(/(?<!\d)13,50/)
    expect(txt).toContain('€')
    expect(txt).toMatch(/(?<!\d)4\D/)
    expect(txt).toContain('$')
    expect(txt).not.toContain('CHF')
  })

  it('3. des pelotes mais AUCUN prix connu ⇒ « — », jamais « 0 € »', async () => {
    const w = await monter({ yarns: [{ price: '', reserved: 4 }] })
    const txt = tuile(w).text()
    expect(tuile(w).exists()).toBe(true)
    // Aucun chiffre de MONTANT : afficher « 0 » ferait passer une ignorance pour une
    // gratuité. (`not.toContain('0,00')` ne pourrait jamais rougir — formatMoney n'écrit
    // pas les centimes d'un montant rond.)
    expect(txt).toContain('—')
  })

  it('4. laine réservée par un AUTRE projet ⇒ elle ne compte pas ici', async () => {
    const autre = await db.projects.add({ name: 'Écharpe' })
    await db.yarns.add({ brand: 'Katia', quantity: 9, price: '100', reservations: { [autre]: 5 }, consumed: {} })
    const w = await monter({ yarns: [{ price: '4,50', reserved: 3 }] })
    // Prémisse ASSERTÉE, pas supposée : tout ce test repose sur le fait que les deux projets
    // ont des ids différents. Si un changement d'ordre de création dans `monter` les faisait
    // coïncider, le test deviendrait un no-op qui passe toujours.
    expect(autre).not.toBe(w.vm.project.id)
    const txt = tuile(w).text()
    // `toContain('13,50')` seul ne mord pas : sous la fuite entre projets (tout le stock
    // compté), le montant devient 513,50 CHF — cette chaîne CONTIENT « 13,50 » ET NE
    // CONTIENT PAS « 500 », donc les deux assertions passeraient quand même (constat de
    // revue, 08/08). `\b` ne mord pas non plus ici : les deux spans (`itile__k` puis
    // `itile__v`) sont collés sans espace dans le rendu (« ...projet13,50 CHF »), et entre
    // « t » et « 1 » il n'y a AUCUNE frontière de mot (lettre et chiffre sont tous deux
    // `\w`). Le lookbehind négatif sur un chiffre distingue vraiment les deux cas : rien
    // (ou une lettre) précède « 13,50 » dans le bon montant, un « 5 » le précède dans la fuite.
    expect(txt).toMatch(/(?<!\d)13,50/)
    expect(txt).not.toContain('500')
  })

  it('5. prix du patron ⇒ entre parenthèses, dans SA propre devise', async () => {
    // Laines en CHF (réglage), patron en EUR (devise propre du patron) : ce cas EXISTE dans
    // la vraie vie. C'est la seule assertion qui interdit qu'un jour les deux montants
    // soient additionnés — une somme unique ne pourrait pas porter deux devises.
    const w = await monter({
      currency: 'CHF',
      yarns: [{ price: '4,50', reserved: 3 }],
      pattern: { price: '18,90', priceCurrency: 'EUR' },
    })
    const txt = tuile(w).text()
    expect(txt).toContain('13,50')
    expect(txt).toContain('CHF')
    expect(txt).toContain('18,90')
    expect(txt).toContain('€')
    expect(txt).toContain('patron')
  })

  it('6. patron sans prix noté ⇒ AUCUNE parenthèse', async () => {
    const w = await monter({ yarns: [{ price: '4,50', reserved: 3 }], pattern: { price: '' } })
    expect(tuile(w).text()).not.toContain('(')
  })

  it('7. patron à « 0 » ⇒ « patron : Gratuit », jamais un montant', async () => {
    const w = await monter({
      yarns: [{ price: '4,50', reserved: 3 }],
      pattern: { price: '0', priceCurrency: 'EUR' },
    })
    const txt = tuile(w).text()
    expect(txt).toContain(fr.pattern.priceFree)
    // Le montant des LAINES reste, celui du patron ne devient pas « 0 € ».
    expect(txt).toContain('13,50')
  })

  it('8. laine sans prix parmi des laines chiffrées ⇒ le total le DIT', async () => {
    const w = await monter({
      currency: 'CHF',
      yarns: [{ price: '4,50', reserved: 3 }, { price: '', reserved: 2 }, { price: '', knitted: 1 }],
    })
    const txt = tuile(w).text()
    expect(txt).toContain('13,50') // le total ne compte que ce qui est connu
    // Deux LAINES sans prix (et non trois pelotes) : la mention compte des fiches.
    expect(txt).toContain(fr.project.costUnknownPrices.replace('{n}', '2'))
  })

  it('9. laine réservée ⇒ la liste affiche RÉSERVÉ / STOCK, pas le stock seul', async () => {
    // Constat de revue (08/08) : `×{{ y.quantity }}` seul affichait le STOCK (10 pelotes),
    // jamais ce que la tuile de coût, juste en dessous, facture (1 pelote réservée par
    // défaut) — « ×10 » suivi d'un coût pour 1 pelote se lisait comme un total cassé.
    const w = await monter({ yarns: [{ price: '4,50', reserved: 1 }] }) // quantity: 10 (défaut de `monter`)
    const txt = w.find('.yarnlist').text()
    // Doit distinguer vraiment « 1 / 10 » de « 10 » seul : sous la mutation qui remet
    // `y.quantity` seul, la ligne redevient « ×10 » et ce test doit rougir.
    expect(txt).toMatch(/×1\s*\/\s*10/)
    expect(txt).not.toMatch(/×10(?!\s*\/)/)
  })
})

describe('fiche projet — rectifier une séance', () => {
  async function openEdit(durationSec) {
    const pid = await seedProject()
    const sid = await db.sessions.add({ projectId: pid, sectionId: null, date: '2026-08-10T10:00:00.000Z', durationSec, rowsDone: 0, manual: true })
    const w = mountDetail()
    await flushPromises()
    await w.find('#tab-sessions').trigger('click')
    await flushPromises()
    await w.find('.ses-row__edit').trigger('click')
    return { w, sid }
  }
  const save = async (w) => {
    await w.find('.addform .btn--primary').trigger('click')
    await flushPromises()
  }

  // Deux appuis rapprochés sur Enregistrer n'ajoutent qu'une séance manuelle.
  it('ajout manuel, double appui : une seule séance', async () => {
    const pid = await seedProject()
    const w = mountDetail()
    await flushPromises()
    await w.find('#tab-sessions').trigger('click')
    await flushPromises()
    await w.find('.sessions-tab .btn--block').trigger('click')
    await w.find('#sm').setValue('30')
    const btn = w.find('.addform .btn--primary')
    btn.trigger('click')
    btn.trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 20))
    await flushPromises()
    expect(await db.sessions.where('projectId').equals(pid).count()).toBe(1)
  })

  // Une durée vidée ou illisible n'est jamais enregistrée comme 0.
  it('durée vidée : la séance garde sa durée', async () => {
    const { w, sid } = await openEdit(1800)
    await w.find(`#esm-${sid}`).setValue('')
    await save(w)
    expect((await db.sessions.get(sid)).durationSec).toBe(1800)
  })

  // Rectifier la date seule ne réécrit pas une durée arrondie à la minute.
  it('date seule modifiée : la durée à la seconde près est conservée', async () => {
    const { w, sid } = await openEdit(610)
    await w.find('.addform input[type="date"]').setValue('2026-08-11')
    await save(w)
    const row = await db.sessions.get(sid)
    expect(row.durationSec).toBe(610)
    expect(row.date.slice(0, 10)).toBe('2026-08-11')
  })

  // Un champ date vidé ne déplace pas la séance à aujourd'hui.
  it('date vidée : la séance garde sa date', async () => {
    const { w, sid } = await openEdit(600)
    await w.find('.addform input[type="date"]').setValue('')
    await save(w)
    expect((await db.sessions.get(sid)).date).toBe('2026-08-10T10:00:00.000Z')
  })
})

// Protège la mention « taille absente du stock » : une ligne par taille manquante, et jamais tant que le stock d'outils est vide.
describe('fiche projet : taille absente du stock d’outils', () => {
  const sizes = [{ mm: '4', us: '' }, { mm: '5', us: '' }]
  it('signale la taille 5 seule quand le stock a une circulaire 4', async () => {
    await db.tools.add({ type: 'circular', category: 'needle', sizeMm: 4, status: 'available' })
    await seedProject({ needles: sizes })
    const w = mountDetail()
    await flushPromises()
    await w.vm.changeTab('infos')
    await flushPromises()
    const notes = w.findAll('.itile__missing').map((n) => n.text())
    expect(notes).toEqual([tk('project.missingSize', { mm: '5' })])
  })
  it('aucune mention quand le stock d’outils est vide', async () => {
    await seedProject({ needles: sizes })
    const w = mountDetail()
    await flushPromises()
    await w.vm.changeTab('infos')
    await flushPromises()
    expect(w.find('.itile__k').exists()).toBe(true)
    expect(w.find('.itile__missing').exists()).toBe(false)
  })
})

// Protège la tuile « Mes outils » : absente sans stock d'outils, lignes liées qui ouvrent la fiche
// outil, feuille de sélection (tailles du projet d'abord) qui enregistre les liens, fermée au retour.
describe('fiche projet : outils liés', () => {
  // Écriture Dexie (fake-indexeddb, tâches macro) : quelques tours de file suffisent, sans minuterie.
  async function settle() {
    for (let i = 0; i < 10; i++) await flushPromises()
  }
  const circ4 = { type: 'circular', category: 'needle', sizeMm: 4, brand: 'ChiaoGoo', status: 'available' }
  const circ6 = { type: 'circular', category: 'needle', sizeMm: 6, brand: 'Addi', status: 'available' }
  async function openInfos(extra = {}) {
    await seedProject({ needles: [{ mm: '4', us: '' }], ...extra })
    const w = mountDetail()
    await flushPromises()
    await w.vm.changeTab('infos')
    await flushPromises()
    return w
  }

  // Protège l'affichage de la fiche : la lecture de la liste des projets n'est pas attendue.
  it('la fiche s’affiche même si le chargement de la liste des projets ne se résout pas', async () => {
    await seedProject()
    const pinia = createPinia()
    setActivePinia(pinia)
    vi.spyOn(useProjectsStore(), 'load').mockReturnValue(new Promise(() => {}))
    const w = mount(ProjectDetailView, {
      global: { plugins: [pinia, i18n], stubs: { StatusBadge: true, CounterCard: true, CounterForm: true } },
    })
    await settle()
    expect(w.vm.loading).toBe(false)
    expect(w.text()).toContain('Pull torsadé')
  })

  it('aucune tuile « Mes outils » quand le stock d’outils est vide', async () => {
    const w = await openInfos()
    expect(w.find('[data-test="project-tools"]').exists()).toBe(false)
  })

  it('un outil lié montre sa ligne, qui ouvre la fiche de l’outil', async () => {
    const toolId = await db.tools.add(circ4)
    await db.tools.add(circ6)
    const w = await openInfos({ toolIds: [toolId] })
    const tile = w.get('[data-test="project-tools"]')
    expect(tile.text()).toContain(tk('tools.title'))
    const rows = tile.findAll('.trow')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('ChiaoGoo')
    await rows[0].trigger('click')
    expect(nav.router.push).toHaveBeenCalledWith({ name: 'tool', params: { id: toolId } })
  })

  it('la tuile et la feuille nomment le projet en cours qui utilise l’outil', async () => {
    const toolId = await db.tools.add(circ4)
    const w = await openInfos({ toolIds: [toolId] })
    await settle()
    const inUse = tk('tools.inUseBy', { name: 'Pull torsadé' })
    expect(w.get('[data-test="project-tools"] .trow__status').text()).toBe(inUse)
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
    expect(w.get('[data-test="tool-picker"] .trow__status').text()).toBe(inUse)
  })

  it('sans lien, la tuile le dit et propose de choisir des outils', async () => {
    await db.tools.add(circ4)
    const w = await openInfos()
    const tile = w.get('[data-test="project-tools"]')
    expect(tile.text()).toContain(tk('project.toolsNone'))
    expect(tile.get('[data-test="project-tools-choose"]').text()).toContain(tk('project.chooseTools'))
  })

  it('la feuille met en tête les outils aux tailles du projet et enregistre les cases cochées', async () => {
    await db.tools.add(circ6)
    const id4 = await db.tools.add(circ4)
    const w = await openInfos()
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
    const sheet = w.get('[data-test="tool-picker"]')
    expect(sheet.attributes('role')).toBe('dialog')
    const groups = sheet.findAll('[data-test="tool-picker-group"]')
    expect(groups.map((g) => g.get('h3').text())).toEqual([tk('tools.picker.matching'), tk('tools.picker.others')])
    expect(groups[0].text()).toContain('ChiaoGoo')
    expect(groups[1].text()).toContain('Addi')
    await groups[0].get('input[type="checkbox"]').setValue(true)
    await sheet.get('[data-test="tool-picker-save"]').trigger('click')
    await settle()
    expect(w.find('[data-test="tool-picker"]').exists()).toBe(false)
    const pid = Number(nav.route.params.id)
    expect((await db.projects.get(pid)).toolIds).toEqual([id4])
    expect(w.get('[data-test="project-tools"]').findAll('.trow')).toHaveLength(1)
  })

  it('à l’ouverture, le focus entre dans la feuille', async () => {
    await db.tools.add(circ4)
    await seedProject({ needles: [{ mm: '4', us: '' }] })
    const w = mount(ProjectDetailView, {
      attachTo: document.body,
      global: { plugins: [createPinia(), i18n], stubs: { StatusBadge: true, CounterCard: true, CounterForm: true } },
    })
    await flushPromises()
    await w.vm.changeTab('infos')
    await flushPromises()
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
    expect(document.activeElement.closest('[data-test="tool-picker"]')).not.toBeNull()
    w.unmount()
  })

  it('une écriture des liens qui échoue le dit et garde la feuille ouverte', async () => {
    await db.tools.add(circ4)
    const w = await openInfos()
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
    await w.get('[data-test="tool-picker"] input[type="checkbox"]').setValue(true)
    const spy = vi.spyOn(db.projects, 'update').mockRejectedValueOnce(new Error('disque plein'))
    await w.get('[data-test="tool-picker-save"]').trigger('click')
    await settle()
    spy.mockRestore()
    expect(useSnackbarStore().message).toBe(tk('project.toolsSaveError'))
    expect(w.find('[data-test="tool-picker"]').exists()).toBe(true)
  })

  it('le geste retour ferme la feuille sans quitter la fiche ni enregistrer', async () => {
    await db.tools.add(circ4)
    const w = await openInfos()
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
    await w.get('[data-test="tool-picker"] input[type="checkbox"]').setValue(true)
    expect(w.vm.handleBackPressed()).toBe(true)
    await flushPromises()
    expect(w.find('[data-test="tool-picker"]').exists()).toBe(false)
    expect(w.find('#panel-infos').exists()).toBe(true)
    expect((await db.projects.get(Number(nav.route.params.id))).toolIds ?? []).toEqual([])
  })

  // Protège le lien d'un outil en corbeille : absent de la feuille, il survit à « Enregistrer ».
  it('un id lié absent du stock (outil en corbeille) reste lié après « Enregistrer »', async () => {
    const trashed = await db.tools.add(circ6)
    const id4 = await db.tools.add(circ4)
    await useTrashStore().moveToTrash('tool', trashed)
    const w = await openInfos({ toolIds: [trashed] })
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
    const sheet = w.get('[data-test="tool-picker"]')
    expect(sheet.text()).not.toContain('Addi')
    await sheet.get('input[type="checkbox"]').setValue(true)
    await sheet.get('[data-test="tool-picker-save"]').trigger('click')
    await settle()
    expect((await db.projects.get(Number(nav.route.params.id))).toolIds).toEqual([id4, trashed])
  })
  // Protège les prises de kit : un kit se déplie en tailles (jamais de case pour le kit entier),
  // une taille cochée propose un câble, l'enregistrement écrit kitPicks et la tuile les montre.
  const zing = { type: 'interchangeable', category: 'kit', kitSizes: [3.5, 4, 5], kitCables: [60, 80], brand: 'KnitPro', line: 'Zing', status: 'available' }
  const kitBlock = (w) => w.get('[data-test="tool-picker-kit"]')
  const sizeBox = (block, mm) => block.get(`[data-test="tool-picker-kit-size"][data-value="${mm}"]`)

  it('un kit se déplie en tailles, celles du projet d’abord, sans case pour le kit entier', async () => {
    await db.tools.add(zing)
    const w = await openInfos()
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
    const block = kitBlock(w)
    expect(block.findAll('[data-test="tool-picker-kit-size"]').map((b) => b.attributes('data-value'))).toEqual(['4', '3.5', '5'])
    expect(block.findAll('input[type="checkbox"]')).toHaveLength(3)
    expect(block.find('[data-test="tool-picker-whole-kit"]').exists()).toBe(false)
  })

  it('cocher 4 mm puis choisir 80 cm écrit la prise, et la tuile la montre', async () => {
    const kitId = await db.tools.add(zing)
    const w = await openInfos()
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
    const block = kitBlock(w)
    expect(block.find('select').exists()).toBe(false)
    await sizeBox(block, 4).get('input[type="checkbox"]').setValue(true)
    const select = sizeBox(block, 4).get('select')
    expect(select.findAll('option').map((o) => o.text())).toEqual([tk('tools.picker.noCable'), '60 cm', '80 cm'])
    await select.setValue('80|')
    await w.get('[data-test="tool-picker-save"]').trigger('click')
    await settle()
    const saved = await db.projects.get(Number(nav.route.params.id))
    expect(saved.kitPicks).toEqual([{ toolId: kitId, sizeMm: 4, cableCm: 80, cableJoin: null }])
    expect(saved.toolIds).toEqual([])
    const rows = w.get('[data-test="project-tools"]').findAll('.trow__title')
    expect(rows.map((r) => r.text())).toEqual([`KnitPro Zing · ${tk('tools.kitPick', { size: '4 mm', cable: '80 cm' })}`])
  })

  it('une taille ou un câble pris par un autre projet en cours reste cochable, avec « pris : »', async () => {
    const kitId = await db.tools.add({ ...zing, kitCables: [80] })
    await db.projects.add({ name: 'Bonnet', status: 'wip', kitPicks: [{ toolId: kitId, sizeMm: 4, cableCm: 80 }] })
    await db.projects.add({ name: 'Fini', status: 'done', kitPicks: [{ toolId: kitId, sizeMm: 5, cableCm: null }] })
    const w = await openInfos()
    await settle()
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
    const block = kitBlock(w)
    const taken = tk('tools.picker.takenBy', { name: 'Bonnet' })
    expect(sizeBox(block, 4).text()).toContain(taken)
    expect(sizeBox(block, 5).text()).not.toContain(tk('tools.picker.takenBy', { name: 'Fini' }))
    await sizeBox(block, 4).get('input[type="checkbox"]').setValue(true)
    expect(sizeBox(block, 4).findAll('option').map((o) => o.text())).toEqual([tk('tools.picker.noCable'), `80 cm (${taken})`])
    await sizeBox(block, 4).get('select').setValue('80|')
    await w.get('[data-test="tool-picker-save"]').trigger('click')
    await settle()
    expect((await db.projects.get(Number(nav.route.params.id))).kitPicks).toEqual([{ toolId: kitId, sizeMm: 4, cableCm: 80, cableJoin: null }])
  })

  it('un lien ancien au kit entier reste affiché, coché, et se décoche', async () => {
    const kitId = await db.tools.add(zing)
    const w = await openInfos({ toolIds: [kitId] })
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
    const whole = kitBlock(w).get('[data-test="tool-picker-whole-kit"] input[type="checkbox"]')
    expect(whole.element.checked).toBe(true)
    await whole.setValue(false)
    await w.get('[data-test="tool-picker-save"]').trigger('click')
    await settle()
    expect((await db.projects.get(Number(nav.route.params.id))).toolIds).toEqual([])
  })

  it('cocher une taille d’un kit lié en entier remplace le lien ancien', async () => {
    const kitId = await db.tools.add(zing)
    const w = await openInfos({ toolIds: [kitId] })
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
    const block = kitBlock(w)
    await sizeBox(block, 4).get('input[type="checkbox"]').setValue(true)
    expect(block.get('[data-test="tool-picker-whole-kit"] input[type="checkbox"]').element.checked).toBe(false)
    await w.get('[data-test="tool-picker-save"]').trigger('click')
    await settle()
    const saved = await db.projects.get(Number(nav.route.params.id))
    expect(saved.toolIds).toEqual([])
    expect(saved.kitPicks).toEqual([{ toolId: kitId, sizeMm: 4, cableCm: null, cableJoin: null }])
  })

  it('les prises d’un kit en corbeille survivent à « Enregistrer »', async () => {
    const id4 = await db.tools.add(circ4)
    const trashed = await db.tools.add(zing)
    await useTrashStore().moveToTrash('tool', trashed)
    const pick = { toolId: trashed, sizeMm: 4, cableCm: 60 }
    const w = await openInfos({ kitPicks: [pick] })
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="tool-picker-kit"]').exists()).toBe(false)
    await w.get('[data-test="tool-picker"] input[type="checkbox"]').setValue(true)
    await w.get('[data-test="tool-picker-save"]').trigger('click')
    await settle()
    const saved = await db.projects.get(Number(nav.route.params.id))
    expect(saved.toolIds).toEqual([id4])
    expect(saved.kitPicks).toEqual([{ ...pick, cableJoin: null }])
  })

  it('une prise dont le câble n’est plus dans le kit s’ouvre cochée, sans câble', async () => {
    const kitId = await db.tools.add(zing)
    const w = await openInfos({ kitPicks: [{ toolId: kitId, sizeMm: 5, cableCm: 100 }] })
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
    const box = sizeBox(kitBlock(w), 5)
    expect(box.get('input[type="checkbox"]').element.checked).toBe(true)
    expect(box.get('select').element.value).toBe('')
  })

  it('les prises déjà enregistrées sont cochées à l’ouverture, câble compris', async () => {
    const kitId = await db.tools.add(zing)
    const w = await openInfos({ kitPicks: [{ toolId: kitId, sizeMm: 5, cableCm: 60 }] })
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
    const box = sizeBox(kitBlock(w), 5)
    expect(box.get('input[type="checkbox"]').element.checked).toBe(true)
    expect(box.get('select').element.value).toBe('60|')
  })

  // Diamètre de la fixation (spec 2026-11-17) : un couple longueur + diamètre est une option du menu.
  const twin = { ...zing, kitCables: [{ cm: 80, join: 's' }, { cm: 80, join: 'l' }] }
  const openSheet = async (w) => {
    await w.get('[data-test="project-tools-choose"]').trigger('click')
    await flushPromises()
  }

  it('un 80 cm S et un 80 cm L sont deux options du menu', async () => {
    await db.tools.add(twin)
    const w = await openInfos()
    await openSheet(w)
    await sizeBox(kitBlock(w), 4).get('input[type="checkbox"]').setValue(true)
    expect(sizeBox(kitBlock(w), 4).findAll('option').map((o) => o.text())).toEqual([tk('tools.picker.noCable'), '80 cm S', '80 cm L'])
  })

  it('choisir 80 cm L écrit cableJoin, la tuile dit « 80 cm L », et la feuille rouverte reprend L', async () => {
    const kitId = await db.tools.add(twin)
    const w = await openInfos()
    await openSheet(w)
    await sizeBox(kitBlock(w), 4).get('input[type="checkbox"]').setValue(true)
    await sizeBox(kitBlock(w), 4).get('select').setValue('80|l')
    await w.get('[data-test="tool-picker-save"]').trigger('click')
    await settle()
    expect((await db.projects.get(Number(nav.route.params.id))).kitPicks).toEqual([{ toolId: kitId, sizeMm: 4, cableCm: 80, cableJoin: 'l' }])
    expect(w.get('[data-test="project-tools"]').findAll('.trow__title').map((r) => r.text())).toEqual([`KnitPro Zing · ${tk('tools.kitPick', { size: '4 mm', cable: '80 cm L' })}`])
    await openSheet(w)
    expect(sizeBox(kitBlock(w), 4).get('select').element.value).toBe('80|l')
  })

  it('un 80 cm S pris ailleurs ne marque pas le 80 cm L', async () => {
    const kitId = await db.tools.add(twin)
    await db.projects.add({ name: 'Bonnet', status: 'wip', kitPicks: [{ toolId: kitId, sizeMm: 5, cableCm: 80, cableJoin: 's' }] })
    const w = await openInfos()
    await settle()
    await openSheet(w)
    await sizeBox(kitBlock(w), 4).get('input[type="checkbox"]').setValue(true)
    const taken = tk('tools.picker.takenBy', { name: 'Bonnet' })
    expect(sizeBox(kitBlock(w), 4).findAll('option').map((o) => o.text())).toEqual([tk('tools.picker.noCable'), `80 cm S (${taken})`, '80 cm L'])
  })

  it('une prise ancienne sans diamètre sur un kit à un seul 80 cm S s’ouvre sur « 80 cm S »', async () => {
    const kitId = await db.tools.add({ ...zing, kitCables: [{ cm: 80, join: 's' }] })
    const w = await openInfos({ kitPicks: [{ toolId: kitId, sizeMm: 4, cableCm: 80 }] })
    await openSheet(w)
    const select = sizeBox(kitBlock(w), 4).get('select')
    expect(select.element.value).toBe('80|s')
    expect(select.findAll('option').map((o) => o.text())).toContain('80 cm S')
  })
})

describe('ProjectDetailView : pause et reprise, outils liés', () => {
  const tool = { type: 'needle', name: 'Aiguille 4 mm' }

  it('pause : « Libérer » met en pause, vide les liens et les range dans parkedTools', async () => {
    const tid = await db.tools.add(tool)
    const pid = await seedProject({ toolIds: [tid], kitPicks: [] })
    const w = mountDetail()
    await flushPromises()
    await w.findComponent(StatusBadge).vm.$emit('change', 'pause')
    await vi.waitFor(() => expect(w.findComponent(ToolParkingDialog).props('open')).toBe(true), { timeout: 10000 })
    expect((await db.projects.get(pid)).status).toBe('wip')
    await w.findComponent(ToolParkingDialog).vm.$emit('confirm', [])
    await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('pause'), { timeout: 10000 })
    const saved = await db.projects.get(pid)
    expect(saved.toolIds).toEqual([])
    expect(saved.parkedTools).toEqual({ toolIds: [tid], kitPicks: [] })
  })

  it('pause : « Les garder » met en pause en gardant les liens', async () => {
    const tid = await db.tools.add(tool)
    const pid = await seedProject({ toolIds: [tid], kitPicks: [] })
    const w = mountDetail()
    await flushPromises()
    await w.findComponent(StatusBadge).vm.$emit('change', 'pause')
    await vi.waitFor(() => expect(w.findComponent(ToolParkingDialog).props('open')).toBe(true), { timeout: 10000 })
    await w.findComponent(ToolParkingDialog).vm.$emit('cancel')
    await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('pause'), { timeout: 10000 })
    const saved = await db.projects.get(pid)
    expect(saved.toolIds).toEqual([tid])
    expect(saved.parkedTools).toBeUndefined()
  })

  it('pause sans outil lié : aucune question, le statut change tout de suite', async () => {
    const pid = await seedProject({ toolIds: [], kitPicks: [] })
    const w = mountDetail()
    await flushPromises()
    await w.findComponent(StatusBadge).vm.$emit('change', 'pause')
    await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('pause'), { timeout: 10000 })
    expect(w.findComponent(ToolParkingDialog).props('open')).toBe(false)
  })

  it('reprise : « Reprendre » relie l\'outil resté libre et oublie le mis de côté', async () => {
    const tid = await db.tools.add(tool)
    const pid = await seedProject({ status: 'pause', toolIds: [], kitPicks: [], parkedTools: { toolIds: [tid], kitPicks: [] } })
    const w = mountDetail()
    await flushPromises()
    await w.findComponent(StatusBadge).vm.$emit('change', 'wip')
    await vi.waitFor(() => expect(w.findComponent(ToolParkingDialog).props('open')).toBe(true), { timeout: 10000 })
    expect(w.findComponent(ToolParkingDialog).props('mode')).toBe('resume')
    await w.findComponent(ToolParkingDialog).vm.$emit('confirm', [`tool:${tid}`])
    await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('wip'), { timeout: 10000 })
    const saved = await db.projects.get(pid)
    expect(saved.toolIds).toEqual([tid])
    expect(saved.parkedTools ?? null).toBeNull()
  })
})

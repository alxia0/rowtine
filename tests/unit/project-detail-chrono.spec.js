// La pastille chrono FLOTTANTE de la fiche projet (lot « chrono unifié », 2026-08-30).
// Elle remplace deux choses : le bloc « Temps de travail » en bas de l'onglet Sections (le
// temps de travail n'est pas une propriété de cet onglet — on tricote aussi depuis les
// compteurs, la galerie ou la relecture des séances) et le bandeau « Session en cours » de
// l'onglet Séances (sa couverture — rappel visible quand une séance tourne — passe ici :
// pastille visible sur CET onglet, séance en cours comprise). Même composant que le lecteur
// (ChronoPill) : la pastille lit elle-même le store activeSession et rend ses états ; la
// fiche ne porte que la POLITIQUE — démarrage (openFor + play), pause, et le masquage
// (chevron de la pastille / entrée kebab, spec 08/09 : masquer = clôt la séance active,
// enregistrée).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fr from '@/i18n/fr.json'
import { db, getSetting } from '@/db/db'
import { buildFreePattern } from '@/constants/free-pattern'
import { SESSION_NO_SECTION } from '@/constants/session'
import { useActiveSessionStore } from '@/stores/activeSession'
import { useProjectsStore } from '@/stores/projects'
import { useSnackbarStore } from '@/stores/snackbar'
import ProjectDetailView from '@/views/ProjectDetailView.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const T0 = 1_700_000_000_000
const atTime = (ms) => Date.now.mockReturnValue(ms)

const FREE = buildFreePattern({ name: 'Patron libre', sectionTitle: 'Mon tricot', stepText: 'Note' })

// Pinia PARTAGÉE entre le montage et le test (setActivePinia AVANT le mount, puis la même
// instance passée en plugin) : la vue et les assertions voient le MÊME store activeSession.
// Une pinia créée inline dans les options de mount reste lisible depuis le test seulement
// via la pinia « active » résiduelle d'un test précédent du fichier — un hasard de
// contexte, pas un partage.
async function mountView(pattern = FREE, projectPatch = {}, tab = 'sections', extraGlobal = {}) {
  await db.patterns.clear()
  await db.projects.clear()
  await db.sessions.clear()
  await db.settings.clear()
  const pid = await db.patterns.add(pattern)
  const prj = await db.projects.add({
    name: 'Mon ouvrage', patternId: pid, status: 'wip', readerState: {}, ...projectPatch,
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/project/:id', name: 'project', component: ProjectDetailView },
      { path: '/project/:id/read', name: 'project-read', component: { template: '<div/>' } },
    ],
  })
  router.push(`/project/${prj}?tab=${tab}`)
  await router.isReady()
  // `extraGlobal` : option de montage ponctuelle (p. ex. `config.errorHandler` pour capturer
  // le rejet d'un handler async — motif reader-view-sync-on-open.spec.js —, sinon il
  // sortirait de la spec en unhandled rejection).
  const w = mount(ProjectDetailView, { global: { plugins: [router, i18n, pinia], ...extraGlobal } })
  // Fait observable (panneau de l'onglet demandé rendu), jamais un délai en dur — motif
  // imposé partout dans ces tests.
  if (tab === 'sections') await vi.waitFor(() => expect(w.find('.counters-block').exists()).toBe(true))
  else await vi.waitFor(() => expect(w.find(`#panel-${tab}`).exists()).toBe(true))
  return { w, router, projectId: prj }
}

// Démarre via le CORPS de la pastille (la capsule porte aussi le chevron depuis la spec
// 08/09 — seul le corps lance/pause), attend le fait observable « en marche » (aria-label
// Pause — la pastille n'affiche PAS le mot, son libellé accessible le porte, désormais porté
// par le corps), puis fait courir `sec` secondes sur l'horloge truquée et attend le temps
// rendu. Sans ce point d'ancrage avant `atTime`, l'heure avancée pourrait être lue par
// `play()` lui-même : `runningSince` et `Date.now()` seraient égaux et le temps resterait
// bloqué à 0 (commentaire hérité du banc du bloc d'origine, le piège n'a pas changé de
// place). Le passage au temps affiché dépend du setInterval RÉEL (1 s) du magasin actif :
// délai explicite, même motif que vitest.config.js.
async function startAndRun(w, sec = 5) {
  await w.find('.chrono-dock .chrono-fab__body').trigger('click')
  await vi.waitFor(
    () => expect(w.find('.chrono-dock .chrono-fab__body').attributes('aria-label')).toBe(fr.session.pause),
    { timeout: 10000 },
  )
  atTime(T0 + sec * 1000)
  await vi.waitFor(
    () => expect(w.find('.chrono-dock .chrono-fab').text()).toContain(`0:0${sec}`),
    { timeout: 10000 },
  )
}

// Geste de masquage par le CHEVRON de la pastille (spec 08/09, variante B : l'œil a disparu
// du dock) : appui sur la zone chevron, puis sur l'unique entrée du mini-menu.
async function masquerViaChevron(w) {
  await w.find('.chrono-dock .chrono-fab__chev').trigger('click')
  await w.find('.chrono-dock .chrono-fab__menu-item').trigger('click')
}

// Entrée du kebab de la fiche : deuxième chemin vers le MÊME geste (dynamique selon l'état,
// libellé reader.hideTimer/showTimer). Retourne le bouton après ouverture du menu.
async function entreeKebab(w, label) {
  await w.find('.phdr__kebab').trigger('click')
  const item = w.findAll('.menu__item').find((b) => b.text() === label)
  expect(item, `entrée kebab « ${label} » introuvable`).toBeTruthy()
  return item
}

describe('ProjectDetailView — pastille chrono flottante', () => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(T0))
  afterEach(() => vi.restoreAllMocks())

  it('présente sur l’onglet Sections, à l’arrêt (« Chrono »), sans bloc ni bandeau', async () => {
    const { w } = await mountView()
    const pill = w.find('.chrono-dock .chrono-fab')
    expect(pill.exists()).toBe(true)
    // À l'arrêt sans temps écoulé, la pastille n'affiche PAS « 0:00 » : elle invite à
    // démarrer (aspect pulsé du composant partagé).
    expect(pill.text()).toContain(fr.reader.chronoStart)
    // Les deux anciens emplacements ont disparu : le bloc de l'onglet Sections…
    expect(w.find('.chrono-block').exists()).toBe(false)
    expect(w.find('.chrono-row__go').exists()).toBe(false)
    // …et le bandeau de l'onglet Séances.
    expect(w.find('.reminder').exists()).toBe(false)
  })

  it('aussi présente sur un patron structuré (la forme de la fiche ne dépend pas du patron)', async () => {
    const { w } = await mountView({
      name: 'Écharpe',
      reader: { sizeLabels: [], sections: [{ id: 's1', title: 'Corps', steps: [{ t: 'Rg 1' }] }] },
    })
    expect(w.find('.chrono-dock .chrono-fab').exists()).toBe(true)
  })

  // Couverture reprise de project-detail-chrono-reminder.spec.js (retiré) : le rappel
  // « une séance tourne » vit désormais dans la pastille, visible sur l'onglet Séances.
  it('visible sur TOUS les onglets, séance en cours comprise', async () => {
    const { w } = await mountView()
    await startAndRun(w)
    // Les onglets dans l'ordre du swipe : la pastille reste posée (ancre fixe, HORS du
    // panneau transitionné — c'est tout l'objet du lot). L'onglet Séances est le cas
    // chargé : c'est lui qui héritait du bandeau « Session en cours ».
    for (const tb of ['infos', 'photos', 'sessions', 'sections']) {
      await w.find(`#tab-${tb}`).trigger('click')
      await vi.waitFor(() => expect(w.find(`#panel-${tb}`).exists()).toBe(true))
      const pill = w.find('.chrono-dock .chrono-fab')
      expect(pill.exists()).toBe(true)
      expect(pill.text()).toContain('0:05')
    }
    expect(w.find('.reminder').exists()).toBe(false)
    await useActiveSessionStore().pause() // coupe le setInterval réel, sinon il fuit d'un test à l'autre
  })

  it('états : en marche (temps seul), en pause (« Reprendre » + temps), reprise', async () => {
    const { w } = await mountView()
    await startAndRun(w)
    // Pause : la pastille (composant partagé) bascule sur son aspect le plus large. Geste
    // sur le CORPS : le chevron, voisin dans la même capsule, n'y répond jamais.
    await w.find('.chrono-dock .chrono-fab__body').trigger('click')
    await vi.waitFor(() => expect(w.find('.chrono-dock .chrono-fab').text()).toContain(fr.reader.chronoResume))
    const paused = w.find('.chrono-dock .chrono-fab')
    expect(paused.text()).toContain('0:05')
    expect(paused.find('.chrono-fab__body').attributes('aria-label')).toBe(fr.reader.chronoStart)
    // Reprise : le même geste relance (openFor idempotent sur le même couple + play).
    await paused.find('.chrono-fab__body').trigger('click')
    await vi.waitFor(
      () => expect(w.find('.chrono-dock .chrono-fab__body').attributes('aria-label')).toBe(fr.session.pause),
      { timeout: 10000 },
    )
    atTime(T0 + 12000)
    await vi.waitFor(
      () => expect(w.find('.chrono-dock .chrono-fab').text()).toContain('0:12'),
      { timeout: 10000 },
    )
    await useActiveSessionStore().pause()
  })

  it('projet Terminé : pastille absente même si showTimer est vrai', async () => {
    const { w } = await mountView(FREE, { status: 'done' })
    expect(w.find('.chrono-dock .chrono-fab').exists()).toBe(false)
  })

  it('projet Abandonné : pastille absente même si showTimer est vrai', async () => {
    const { w } = await mountView(FREE, { status: 'abandoned' })
    expect(w.find('.chrono-dock .chrono-fab').exists()).toBe(false)
  })
})

// ── Spec 08/09 (fusion chrono + œil, variante B) : l'œil a disparu du dock. Masquer passe
// par le CHEVRON de la pastille (mini-menu « Masquer le chrono ») ou l'entrée DYNAMIQUE du
// kebab ; réafficher par le kebab ou l'interrupteur du formulaire (ProjectEditView). La
// sémantique de l'ancien œil est conservée TELLE QUELLE (mêmes fonctions branchées).
describe('ProjectDetailView — geste chevron / kebab (parité avec le lecteur)', () => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(T0))
  afterEach(() => vi.restoreAllMocks())

  it('masquer (chevron → menu) clôt la séance active : écrite avec la sentinelle de section, pastille disparue ENTIÈREMENT', async () => {
    const { w, projectId } = await mountView()
    await startAndRun(w)
    await masquerViaChevron(w)
    // La persistance du réglage est le DERNIER effet du geste : l'attendre garantit que
    // la clôture (qui la précède) est retombée aussi.
    await vi.waitFor(async () => expect((await db.projects.get(projectId)).showTimer).toBe(false), {
      timeout: 10000,
    })
    // Pastille ET chevron disparus — l'ancien « œil toujours rendu » est supprimé. Les
    // portes de retour durables sont le kebab (test plus bas) et le formulaire.
    // Rendu attendu via waitFor : la mutation `p.showTimer` est appliquée au DOM au tick
    // Vue suivant l'écriture en base, qui lui peut être polluée avant.
    await vi.waitFor(() => expect(w.find('.chrono-dock .chrono-fab').exists()).toBe(false), { timeout: 10000 })
    expect(w.find('.chrono-dock .chrono-fab__chev').exists()).toBe(false)
    expect(useActiveSessionStore().isActive).toBe(false) // séance bien close
    // La séance close est journalisée, avec la bonne durée…
    const rows = await db.sessions.where('projectId').equals(projectId).toArray()
    expect(rows.length).toBe(1)
    expect(rows[0].durationSec).toBe(5)
    // …et ⚠️ sur la SENTINELLE de section — le garde-fou central du lot, déjà celui du
    // bloc d'origine : c'est lui qui porte « un seul chrono, partagé avec l'écran de
    // suivi ». Une autre valeur ici donnerait deux chronos concurrents sur le même projet.
    expect(rows[0].sectionId).toBe(SESSION_NO_SECTION)
  })

  // ORDRE ÉPINGLÉ (spec 08/09, invariant 1) : séance COMMITÉE en base AVANT l'écriture
  // showTimer:false — intercepté au seuil du store, même banc que le lecteur (ReaderView.spec).
  it('masquer un chrono en marche : la séance est déjà en base AU MOMENT de l’écriture showTimer:false', async () => {
    const { w, projectId } = await mountView()
    await startAndRun(w)
    let duréeEnBaseAuMomentDEcrire = null
    const projects = useProjectsStore()
    const réel = projects.update.bind(projects)
    vi.spyOn(projects, 'update').mockImplementation(async (id, patch) => {
      if (patch?.showTimer === false) {
        const rows = await db.sessions.where('projectId').equals(projectId).toArray()
        duréeEnBaseAuMomentDEcrire = rows.length ? rows[0].durationSec : null
      }
      return réel(id, patch)
    })
    await masquerViaChevron(w)
    await vi.waitFor(() => expect(duréeEnBaseAuMomentDEcrire).not.toBeNull(), { timeout: 10000 })
    expect(duréeEnBaseAuMomentDEcrire).toBe(5)
  })

  it('masquer affiche le snackbar « Chrono masqué » ; son Réafficher repasse showTimer:true SANS rouvrir de séance', async () => {
    const { w, projectId } = await mountView()
    const snackbar = useSnackbarStore()
    await startAndRun(w)
    await masquerViaChevron(w)
    // Même facture que le lecteur : snackbar porteur de « Réafficher » (reader.showTimer).
    // ⚠️ Ancrage sur le MESSAGE, pas sur `visible` seul : closeChronoSession (clôture de la
    // séance) affiche LUI-MÊME un snackbar intermédiaire (« Temps enregistré ») — un
    // visible=true capté avant notre show serait le sien, et le message lu à ce moment
    // ferait un faux rouge sous charge. Notre message n'apparaît qu'APRÈS, porteur des
    // deux assertions (message + action posés atomiquement par le même show()).
    await vi.waitFor(() => {
      expect(snackbar.visible).toBe(true)
      expect(snackbar.message).toBe(fr.reader.timerHidden)
    }, { timeout: 10000 })
    expect(snackbar.actionLabel).toBe(fr.reader.showTimer)
    await vi.waitFor(async () => expect((await db.projects.get(projectId)).showTimer).toBe(false), {
      timeout: 10000,
    })
    expect(await db.sessions.where('projectId').equals(projectId).count()).toBe(1)
    // Réafficher depuis le snackbar : pastille de retour À L'ARRÊT. Différence assumée de la
    // fiche (conservée à l'identique) : AFFICHER ne rouvre RIEN — le geste play de la
    // pastille ouvrira ; rouvrir ici ferait démarrer un comptage par un simple affichage.
    snackbar.runAction()
    await vi.waitFor(async () => expect((await db.projects.get(projectId)).showTimer).toBe(true), {
      timeout: 10000,
    })
    await vi.waitFor(() => expect(w.find('.chrono-dock .chrono-fab').exists()).toBe(true), { timeout: 10000 })
    expect(useActiveSessionStore().isActive).toBe(false)
    expect(await db.sessions.where('projectId').equals(projectId).count()).toBe(1)
  })

  it('masquer un chrono resté à zéro n’écrit AUCUNE séance', async () => {
    const { w, projectId } = await mountView()
    await w.find('.chrono-dock .chrono-fab__body').trigger('click')
    await vi.waitFor(
      () => expect(w.find('.chrono-dock .chrono-fab__body').attributes('aria-label')).toBe(fr.session.pause),
      { timeout: 10000 },
    )
    await masquerViaChevron(w)
    await vi.waitFor(async () => expect((await db.projects.get(projectId)).showTimer).toBe(false), {
      timeout: 10000,
    })
    // Le réglage écrit ne prouve pas l'absence d'écriture : on laisse retomber les
    // chaînes Dexie avant de compter (même ancrage que l'ancien banc).
    for (let i = 0; i < 10; i += 1) await flushPromises()
    expect(await db.sessions.where('projectId').equals(projectId).count()).toBe(0)
  })

  it('kebab, état affiché : porte l’entrée « Masquer le chrono » qui masque (même fonction que le chevron)', async () => {
    const { w, projectId } = await mountView()
    const item = await entreeKebab(w, fr.reader.hideTimer)
    await item.trigger('click')
    await vi.waitFor(async () => expect((await db.projects.get(projectId)).showTimer).toBe(false), {
      timeout: 10000,
    })
    // Rendu attendu via waitFor (mutation `p.showTimer` → tick Vue suivant l'écriture).
    await vi.waitFor(() => expect(w.find('.chrono-dock .chrono-fab').exists()).toBe(false), { timeout: 10000 })
  })

  it('kebab, état masqué : porte l’entrée « Afficher le chrono » qui réaffiche la pastille SANS ouvrir de séance (différence assumée avec le lecteur)', async () => {
    const { w, projectId } = await mountView()
    await startAndRun(w)
    await masquerViaChevron(w)
    await vi.waitFor(async () => expect((await db.projects.get(projectId)).showTimer).toBe(false), {
      timeout: 10000,
    })
    expect(await db.sessions.where('projectId').equals(projectId).count()).toBe(1)
    // Ré-affiche PAR LE KEBAB : la pastille revient À L'ARRÊT. Contrairement au lecteur (qui
    // rouvre une séance en réaffichant, reprenant ce qu'il avait pris en charge à l'arrivée),
    // la fiche ne rouvre RIEN : c'est le geste play de la pastille qui ouvrira. Rouvrir ici
    // ferait démarrer un comptage par un simple affichage.
    const item = await entreeKebab(w, fr.reader.showTimer)
    await item.trigger('click')
    await vi.waitFor(() => expect(w.find('.chrono-dock .chrono-fab').exists()).toBe(true), { timeout: 10000 })
    expect(w.find('.chrono-dock .chrono-fab').text()).toContain(fr.reader.chronoStart)
    expect(useActiveSessionStore().isActive).toBe(false)
    expect(await db.sessions.where('projectId').equals(projectId).count()).toBe(1)
  })

  it('showTimer faux au montage : pastille absente (chevron compris), le kebab est la porte de retour', async () => {
    const { w } = await mountView(FREE, { showTimer: false })
    expect(w.find('.chrono-dock .chrono-fab').exists()).toBe(false)
    expect(w.find('.chrono-dock .chrono-fab__chev').exists()).toBe(false)
    // L'entrée dynamique du kebab remplace l'ancien œil permanent : « Afficher le chrono ».
    await entreeKebab(w, fr.reader.showTimer)
  })

  it('afficher (kebab) écrit vraiment le réglage en base', async () => {
    const { w, projectId } = await mountView(FREE, { showTimer: false })
    const item = await entreeKebab(w, fr.reader.showTimer)
    await item.trigger('click')
    // Le DOM seul ne suffirait pas : l'écriture locale `project.value.showTimer = true`
    // ferait repasser le test au vert sans la persistance. Seule la base survivra à la
    // fermeture de l'app.
    await vi.waitFor(async () => expect((await db.projects.get(projectId)).showTimer).toBe(true), {
      timeout: 10000,
    })
  })
})

describe('ProjectDetailView — chrono ouvert sur un AUTRE projet', () => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(T0))
  afterEach(() => vi.restoreAllMocks())

  it('l’appui enregistre la séance de l’autre projet (sans la perdre), puis démarre celle-ci', async () => {
    await db.patterns.clear()
    await db.projects.clear()
    await db.sessions.clear()
    await db.settings.clear()
    const pid = await db.patterns.add(FREE)
    const autre = await db.projects.add({ name: 'Un autre ouvrage', patternId: pid, status: 'wip', readerState: {} })
    const mien = await db.projects.add({ name: 'Mon ouvrage', patternId: pid, status: 'wip', readerState: {} })

    // Une séance tourne sur l'AUTRE projet. État inatteignable par l'UI réelle depuis T2 —
    // le garde « sortie de bulle » du routeur la ferme avant toute arrivée sur la fiche de
    // B — mais le démarrage doit rester robuste : le banc monte la vue sans ce garde, comme
    // un résidu de séance persistée au démarrage de l'app.
    const pinia = createPinia()
    setActivePinia(pinia)
    const active = useActiveSessionStore()
    await active.openFor(autre, SESSION_NO_SECTION, 0)
    await active.play()
    atTime(T0 + 5000)

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/project/:id', name: 'project', component: ProjectDetailView },
        { path: '/project/:id/read', name: 'project-read', component: { template: '<div/>' } },
      ],
    })
    router.push(`/project/${mien}?tab=sections`)
    await router.isReady()
    const w = mount(ProjectDetailView, { global: { plugins: [router, i18n, pinia] } })
    await vi.waitFor(() => expect(w.find('.counters-block').exists()).toBe(true))

    // La pastille reflète le chrono GLOBAL (composant partagé, même information partout) :
    // elle montre le temps de A qui tourne, et son appui le REPREND pour CE projet.
    const pill = w.find('.chrono-dock .chrono-fab')
    expect(pill.exists()).toBe(true)
    expect(pill.text()).toContain('0:05')
    // Geste sur le CORPS de la pastille (le chevron voisin n'y répond pas).
    await pill.find('.chrono-fab__body').trigger('click')

    // Contrat « séances live » : c'est openFor (store journalisant) qui commet le temps
    // de A dans la ligne de l'épisode de A PUIS pose le nouveau couple — les deux dans la
    // MÊME étape en file. Le banc attend donc la POSE du nouveau projectId (après
    // l'écriture) avant de juger : sortir sur la seule écriture lirait l'ancien slot, la
    // bascule n'a pas encore eu lieu. Mutation interceptée : un openFor redevenu non
    // commitant (contrat d'avant le lot, journalisation à l'appelant) laisserait la
    // séance de A PERDUE → 0 ligne ici → rouge. Garde-fou point 2 de la revue du
    // lot précédent, reconduit au niveau de la vue.
    await vi.waitFor(() => expect(useActiveSessionStore().projectId).toBe(mien), { timeout: 10000 })
    const rows = await db.sessions.where('projectId').equals(autre).toArray()
    expect(rows.length).toBe(1)
    expect(rows[0].durationSec).toBe(5)
    // …et celle-ci démarre : le geste a bien enchaîné play derrière openFor.
    await vi.waitFor(() => expect(useActiveSessionStore().running).toBe(true), { timeout: 10000 })
    await useActiveSessionStore().pause() // le chrono tourne maintenant sur B : coupe l'intervalle réel
  })
})

describe('ProjectDetailView — quitter l’écran n’enregistre pas la séance', () => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(T0))
  afterEach(() => vi.restoreAllMocks())

  it('démonter la vue laisse le chrono ouvert et n’écrit rien', async () => {
    const { w, projectId } = await mountView()
    await startAndRun(w)
    w.unmount()
    // `onUnmounted` ne renvoie rien d'asynchrone : pas de fait observable pour une ABSENCE
    // d'écriture. Drainage volontairement GÉNÉREUX (la fermeture par le garde du routeur
    // enchaînerait plusieurs écritures Dexie réelles, chacune sur fake-indexeddb qui
    // s'appuie sur `setTimeout`) : un compte ajusté au plus juste redeviendrait aveugle en
    // silence le jour où une étape asynchrone s'ajoute — vingt tours laissent cette marge.
    for (let i = 0; i < 20; i += 1) await flushPromises()
    expect(await db.sessions.where('projectId').equals(projectId).count()).toBe(0)
    expect(useActiveSessionStore().isActive).toBe(true)
    await useActiveSessionStore().pause() // coupe le setInterval réel, sinon il fuit sur les tests suivants
  })
})

describe('ProjectDetailView — suppression : bord « discard réussi + cascade en échec »', () => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(T0))
  afterEach(() => vi.restoreAllMocks())

  it('cascade rejetée APRÈS le discard : chrono vidé, AUCUNE séance écrite, le projet survit', async () => {
    // La vue appelle discard() AVANT la cascade (l'ordre voulu : l'inverse recréerait une
    // séance orpheline via le garde du routeur). Ce bord épingle l'AUTRE moitié : la
    // cascade rejette une fois le discard passé — fenêtre à deux échecs consécutifs, le
    // projet SURVIT sans son temps non commis, direction tranchée en amont (jamais de
    // séance orpheline). Le rejet du handler `remove()` est routé vers
    // app.config.errorHandler (cf. mountView), sinon il fuirait en unhandled rejection.
    let cascadeError = null
    const { w, projectId } = await mountView(FREE, {}, 'sections', {
      config: { errorHandler: (e) => { cascadeError = e } },
    })
    await startAndRun(w) // 5 s courues, RIEN de commis : tout le temps est non écrit
    // La cascade est sabotée au seuil de la vue (le contrat de remove() est avec le store).
    // L'état du chrono est capturé À L'APPEL : il prouve que le discard a eu lieu AVANT.
    const projects = useProjectsStore()
    let chronoActifALaCascade = null
    const cascade = vi.spyOn(projects, 'remove').mockImplementation(async () => {
      chronoActifALaCascade = useActiveSessionStore().isActive
      throw new Error('cascade en échec')
    })
    // Le geste réel : menu ⋮ puis « Supprimer » (remove n'est pas exposé — script setup).
    await w.find('.phdr__kebab').trigger('click')
    await w.find('.menu__item--danger').trigger('click')
    await vi.waitFor(() => expect(cascadeError?.message).toBe('cascade en échec'), {
      timeout: 10000,
    })
    expect(cascade).toHaveBeenCalledTimes(1)
    expect(chronoActifALaCascade).toBe(false) // discard passé AVANT la cascade : l'ordre voulu
    // Le chrono est bien vidé par le discard : plus actif, payload de réglage effacé.
    const active = useActiveSessionStore()
    expect(active.isActive).toBe(false)
    expect(await getSetting('activeSession')).toBe(null)
    // Mutation interceptée : journaliser le temps (stopAndClear / closeChronoSession à la
    // place de discard) -> une ligne naîtrait pour un projet en cours de disparition —
    // l'orpheline que tout ce geste existe pour empêcher. Ici : zéro ligne, le temps non
    // commis est perdu AVEC le projet (et s'il survit, c'est la perte assumée).
    for (let i = 0; i < 20; i += 1) await flushPromises()
    expect(await db.sessions.where('projectId').equals(projectId).count()).toBe(0)
    // La cascade ayant échoué, le projet SURVIT — sans son temps non commis.
    expect(await db.projects.get(projectId)).not.toBeUndefined()
  })
})

// Revue finale du lot « corrections stats/badge » (16/09) : `changeStatus` posait le
// nouveau statut sans jamais toucher au chrono actif. `chronoVisible` masque la pastille
// dès que le statut passe à Terminé/Abandonné (bloc plus haut), mais un chrono qui
// tournait sur CE projet à cet instant-là continuait — plus aucun contrôle à l'écran
// jusqu'à la prochaine « sortie de bulle » du routeur (aucune perte de temps, mais une
// séance de durée arbitraire journalisée contre un projet déjà clos). Même correctif que
// le geste chevron/kebab ci-dessus (closeChronoSession), branché depuis changeStatus.
describe('ProjectDetailView — changement de statut avec un chrono actif', () => {
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(T0))
  afterEach(() => vi.restoreAllMocks())

  it('passer au statut Terminé clôt le chrono de CE projet : journalisé, plus actif, pastille disparue', async () => {
    const { w, projectId } = await mountView()
    await startAndRun(w) // 5 s courues sur le chrono de ce projet
    await w.find('.badge--editable').trigger('click')
    const item = w.findAll('.menu__item').find((b) => b.text() === fr.status.done)
    expect(item, 'entrée de menu « Terminé » introuvable').toBeTruthy()
    await item.trigger('click')
    await vi.waitFor(async () => expect((await db.projects.get(projectId)).status).toBe('done'), {
      timeout: 10000,
    })
    // Le chrono est bien fermé, pas seulement masqué par `chronoVisible` : sinon la
    // séance resterait ouverte, invisible, jusqu'à la prochaine navigation.
    expect(useActiveSessionStore().isActive).toBe(false)
    expect(w.find('.chrono-dock .chrono-fab').exists()).toBe(false)
    // …et journalisé avec une durée saine (rien perdu).
    const rows = await db.sessions.where('projectId').equals(projectId).toArray()
    expect(rows.length).toBe(1)
    expect(rows[0].durationSec).toBe(5)
  })

  it('passer au statut Abandonné clôt aussi le chrono de CE projet', async () => {
    const { w, projectId } = await mountView()
    await startAndRun(w)
    await w.find('.badge--editable').trigger('click')
    const item = w.findAll('.menu__item').find((b) => b.text() === fr.status.abandoned)
    expect(item, 'entrée de menu « Abandonné » introuvable').toBeTruthy()
    await item.trigger('click')
    await vi.waitFor(async () => expect((await db.projects.get(projectId)).status).toBe('abandoned'), {
      timeout: 10000,
    })
    expect(useActiveSessionStore().isActive).toBe(false)
    const rows = await db.sessions.where('projectId').equals(projectId).toArray()
    expect(rows.length).toBe(1)
    expect(rows[0].durationSec).toBe(5)
  })

  it('passer à un statut qui ne clôt pas (En pause) laisse le chrono de ce projet tourner', async () => {
    const { w, projectId } = await mountView()
    await startAndRun(w)
    await w.find('.badge--editable').trigger('click')
    const item = w.findAll('.menu__item').find((b) => b.text() === fr.status.pause)
    expect(item, 'entrée de menu « En pause » introuvable').toBeTruthy()
    await item.trigger('click')
    await vi.waitFor(async () => expect((await db.projects.get(projectId)).status).toBe('pause'), {
      timeout: 10000,
    })
    expect(useActiveSessionStore().isActive).toBe(true)
    await useActiveSessionStore().pause() // coupe le setInterval réel, sinon il fuit d'un test à l'autre
  })
})

// jsdom ne rend pas les styles (vitest.config.js a `css: false`) : la DISPOSITION du
// chrono flottant — ancre fixe, empilement du retour-en-haut, dégagement du contenu —
// se verrouille en lisant le source de la vue, comme back-to-top-wiring.spec.js le fait
// pour la barre du lecteur. Le rendu réel reste un gate device.
describe('ProjectDetailView — verrous de disposition (source)', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/views/ProjectDetailView.vue'), 'utf8')

  // Échappe TOUS les métacaractères regex du sélecteur (même précaution que
  // back-to-top-wiring.spec.js : `:deep(.btt)` contient des parenthèses).
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  function ruleBody(css, selector) {
    // Ancré en DÉBUT DE LIGNE : `.chrono-dock` est aussi le SUFFIXE des sélecteurs sombres
    // (`html[data-theme='dark'] .chrono-dock`) — sans l'ancre, la règle serait « trouvée
    // plusieurs fois » (même piège documenté pour `.actionbar` dans
    // back-to-top-wiring.spec.js).
    const re = new RegExp('^(?:' + escapeRegExp(selector) + ')\\s*\\{([\\s\\S]*?)\\n\\}', 'gm')
    const matches = [...css.matchAll(re)]
    if (matches.length === 0) throw new Error(`règle introuvable : ${selector}`)
    if (matches.length > 1) throw new Error(`règle trouvée ${matches.length} fois (attendu 1) : ${selector}`)
    return matches[0][1]
  }
  function declValue(body, prop) {
    const m = body.match(new RegExp(`(?:^|\\s)${prop}\\s*:\\s*([^;]+);`))
    if (!m) throw new Error(`déclaration introuvable : ${prop}`)
    return m[1].replace(/\s+/g, ' ').trim()
  }

  it('le dock est une ancre fixe en bas d’écran (visible sur tous les onglets, hors du panneau transitionné)', () => {
    const body = ruleBody(src, '.chrono-dock')
    expect(declValue(body, 'position')).toBe('fixed')
    expect(declValue(body, 'bottom')).toBe('0')
    expect(declValue(body, 'pointer-events')).toBe('none')
  })

  it('BackToTop empilé AU-DESSUS du dock, hors du flux de la rangée (même motif que la barre du lecteur)', () => {
    const body = ruleBody(src, '.chrono-dock :deep(.btt)')
    // `absolute` le retire du flux ; `bottom: 100%` le pose juste au-dessus du bord haut
    // du dock, sans hauteur de rangée écrite en dur (la pastille change d'aspect).
    expect(declValue(body, 'position')).toBe('absolute')
    expect(declValue(body, 'bottom')).toBe('100%')
  })

  it('le contenu dégage la hauteur du dock (le dernier rang ne passe pas sous la pastille)', () => {
    // Même correctif que le lecteur (ReaderView.vue, 104 px = padding + pastille) : sans
    // lui, la fin de chaque onglet défile SOUS le chrono flottant, invisible au banc jsdom.
    // Sélecteur scopé `:not(.notfound)` : la branche « projet introuvable »
    // partage la classe .screen mais n'a PAS de dock — le dégagement ne la concerne pas.
    const body = ruleBody(src, '.screen:not(.notfound)')
    expect(declValue(body, 'padding-bottom')).toBe('calc(104px + var(--sa-bottom))')
  })
})

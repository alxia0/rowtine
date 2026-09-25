// @vitest-environment jsdom
// Composant — ProjectEditView : formulaire d'édition/création de projet. Couvre le
// TROISIÈME point d'entrée (R2) qui peut clore/abandonner un projet : le sélecteur de
// statut par pastilles (~lignes 249-258) ne fait que poser `form.status` — le statut
// n'est réel qu'à l'ENREGISTREMENT. La question « combien de pelotes as-tu utilisées/
// perdues ? » (R3 : mode 'done' ou 'abandoned') doit donc être posée à l'enregistrement,
// pas au clic sur la pastille, et seulement APRÈS `applyYarnLinks` (les réservations
// doivent exister avant de demander combien en a été utilisé).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import { useActiveSessionStore } from '@/stores/activeSession'
import { SESSION_NO_SECTION } from '@/constants/session'

const nav = vi.hoisted(() => ({
  route: { params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRoute: () => nav.route, useRouter: () => nav.router }))

import ProjectEditView from '@/views/ProjectEditView.vue'
import YarnConsumptionDialog from '@/components/YarnConsumptionDialog.vue'

async function seedProject(extra = {}) {
  const pid = await db.projects.add({
    name: 'Pull torsadé',
    technique: 'knitting',
    status: 'wip',
    ...extra,
  })
  nav.route.params = { id: String(pid) }
  nav.route.query = {}
  return pid
}

function mountEdit() {
  return mount(ProjectEditView, { global: { plugins: [createPinia(), i18n] } })
}

// L'hydratation initiale (`onMounted`) enchaîne plusieurs tours Dexie/fake-indexeddb
// (yarnsStore.load, patternsStore.load, ensureFreePattern, puis projectsStore.get en
// édition) qui s'étalent sur plusieurs tours de boucle d'évènements, pas de simples
// micro-tâches (même motif que project-card.spec.js) : sans attendre la VRAIE fin de
// l'hydratation, un clic sur Enregistrer trop tôt tombe sur `form.name` encore vide
// (`emptyProject()`) et `save()` s'arrête silencieusement sur la validation du nom.
//
// Attente sur CONDITION réelle (`hydrating` passe à `false` seulement tout à la fin
// d'onMounted, après tous ses `await`), pas un délai fixe (décision produit, revue lot 2,
// 26/07 : un délai fixe de 30 ms est une bombe à retardement sur une machine chargée — mesuré
// intermittent en pratique). `w.vm.hydrating` reste accessible même en `<script setup>` sans
// `defineExpose`, via l'exposition de test de Vue Test Utils.
async function waitHydrated(w) {
  await flushPromises()
  await vi.waitFor(() => expect(w.vm.hydrating).toBe(false), { timeout: 2000 })
  await flushPromises()
}

function chip(w, statusKey) {
  return w.findAll('.chips .chip').find((c) => c.text() === i18n.global.t(`status.${statusKey}`))
}

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  nav.router.back.mockClear()
  nav.route.params = {}
  nav.route.query = {}
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('ProjectEditView — 3ᵉ point d\'entrée Terminé/Abandonné (R2 + R3)', () => {
  it("statut laissé à 'wip' : aucune question, enregistre et navigue directement", async () => {
    const pid = await seedProject()
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountEdit()
    await waitHydrated(w)

    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(false)
  })

  it("laine réservée + passage à 'done' : la question est posée à l'enregistrement (pas au clic sur la pastille), et bloque la navigation tant qu'elle n'est pas répondue", async () => {
    const pid = await seedProject()
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountEdit()
    await waitHydrated(w)

    await chip(w, 'done').trigger('click')
    // Le clic sur la pastille seul ne doit rien déclencher : pas de question tant
    // que non enregistré.
    expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(false)

    await w.find('.btn--primary').trigger('click')
    await flushPromises()

    await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })
    expect(w.findComponent(YarnConsumptionDialog).props('mode')).toBe('done')
    expect(w.findComponent(YarnConsumptionDialog).props('yarns')).toEqual([
      { id: yid, name: 'Drops · Bleu', reserved: 2 },
    ])
    // Le statut est déjà écrit (écriture du projet faite avant la question), mais la
    // navigation attend la réponse — jamais de "terminé" silencieux sans consommation.
    expect((await db.projects.get(pid)).status).toBe('done')
    expect(nav.router.replace).not.toHaveBeenCalled()
    expect((await db.yarns.get(yid)).reservations).toEqual({ [pid]: 2 }) // pas encore consommée
  })

  it("Valider la question déduit le réservé puis navigue vers la fiche", async () => {
    const pid = await seedProject()
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountEdit()
    await waitHydrated(w)

    await chip(w, 'done').trigger('click')
    await w.find('.btn--primary').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })

    await w.findComponent(YarnConsumptionDialog).vm.$emit('confirm', [{ id: yid, used: 2 }])

    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    expect((await db.yarns.get(yid)).quantity).toBe(3) // 5 - 2 tricotées
    expect((await db.yarns.get(yid)).reservations).toEqual({})
  })

  it("passage à 'abandoned' avec laine réservée : la question est posée en mode « abandonné » (défaut 0)", async () => {
    const pid = await seedProject()
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountEdit()
    await waitHydrated(w)

    await chip(w, 'abandoned').trigger('click')
    await w.find('.btn--primary').trigger('click')
    await flushPromises()

    await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })
    expect(w.findComponent(YarnConsumptionDialog).props('mode')).toBe('abandoned')

    await w.findComponent(YarnConsumptionDialog).vm.$emit('confirm', [{ id: yid, used: 0 }])
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    expect((await db.yarns.get(yid)).quantity).toBe(5) // rien perdu : rien déduit
    expect((await db.yarns.get(yid)).reservations).toEqual({})
  })

  it("création directe en Terminé avec une laine liée : les réservations viennent d'être créées par applyYarnLinks, la question est quand même posée", async () => {
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5 })
    nav.route.params = {}
    nav.route.query = {}
    const w = mountEdit()
    await waitHydrated(w)

    await w.find('#name').setValue('Nouveau pull')
    // (lot marque) : la liste reste vide tant qu'aucune marque n'est choisie.
    await w.find('.ypick__brandfilter select').setValue('Drops')
    await flushPromises()
    await w.find('.ypick__row input[type=checkbox]').trigger('change')
    await chip(w, 'done').trigger('click')
    await w.find('.btn--primary').trigger('click')
    await flushPromises()

    await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })
    const created = (await db.projects.toArray()).find((p) => p.name === 'Nouveau pull')
    expect(created.status).toBe('done')
    expect(w.findComponent(YarnConsumptionDialog).props('yarns')).toEqual([
      { id: yid, name: 'Drops · Bleu', reserved: 1 },
    ])

    await w.findComponent(YarnConsumptionDialog).vm.$emit('confirm', [{ id: yid, used: 1 }])
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: created.id } }), { timeout: 10000 })
    expect((await db.yarns.get(yid)).quantity).toBe(4)
  })

  it('saisir une date de fin sur un projet QUI RÉSERVE DES PELOTES ouvre le dialogue de consommation', async () => {
    // Un projet en cours, une laine réservée par lui, aucune date de fin.
    // On saisit une date dans le champ « Terminé le », on enregistre :
    //   → le statut doit passer à 'done' PAR LE CHEMIN NORMAL,
    //   → donc YarnConsumptionDialog doit être OUVERT,
    //   → et une fois la question validée, le projet doit être RÉELLEMENT terminé en base,
    //     avec la date TAPÉE (pas une date estampillée par-dessus).
    // Vérifié par mutation, DEUX fois :
    // 1. la règle 2 déplacée dans projectsStore.update() (et retirée de save()) fait ÉCHOUER
    //    ce test : `open` reste `false`, le statut change en base sans passer par
    //    `requestStatusChange`.
    // 2. la règle 2 laissée dans save() mais déplacée APRÈS l'appel à
    //    projectsStore.update()/create() (au lieu d'avant, cf. point d'attention 3)
    //    fait ÉCHOUER l'assertion de statut final ci-dessous : `open` reste vrai (payload.status
    //    est corrigé à temps pour requestStatusChange), mais la base garde `status: 'wip'`
    //    pour toujours — le projet resterait « en cours » alors que l'utilisatrice l'a clos.
    //    C'est pourquoi le test ne s'arrête pas à `open === true`.
    const pid = await seedProject({ finishedAt: '' })
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountEdit()
    await waitHydrated(w)

    await w.find('#end').setValue('2026-07-15')
    await w.find('.btn--primary').trigger('click')
    await flushPromises()

    await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })
    expect(w.findComponent(YarnConsumptionDialog).props('yarns')).toEqual([
      { id: yid, name: 'Drops · Bleu', reserved: 2 },
    ])

    await w.findComponent(YarnConsumptionDialog).vm.$emit('confirm', [{ id: yid, used: 2 }])
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    const fresh = await db.projects.get(pid)
    expect(fresh.status).toBe('done')
    expect(fresh.finishedAt).toBe('2026-07-15')
  })
})

// Lot 2 — échantillon : ré-étiquetage SEUL selon le système d'unités. 4 pouces
// valent 10,16 cm : « 20 mailles / 10 cm » et « 20 mailles / 4 po » décrivent la MÊME
// mesure — convertir produirait des fractions de maille, qui n'existent pas. Ce qui suit
// verrouille l'absence de calcul : saisir 20 en mode impérial doit stocker EXACTEMENT 20.
describe('ProjectEditView — échantillon suit le système d’unités (libellé seul, aucun calcul)', () => {
  it('mode métrique (défaut) : libellés « Mailles / 10 cm » et « Rangs »', async () => {
    const w = mountEdit()
    await waitHydrated(w)
    expect(w.text()).toContain(i18n.global.t('project.gaugeStitches'))
    expect(w.text()).toContain(i18n.global.t('project.gaugeRows'))
    expect(w.text()).not.toContain(i18n.global.t('project.gaugeStitchesImperial'))
  })

  it('mode impérial : libellés « Mailles / 4 po » et « Rangs / 4 po », pas les libellés métriques', async () => {
    await db.settings.put({ key: 'unitSystem', value: 'imperial' })
    const w = mountEdit()
    await waitHydrated(w)
    expect(w.text()).toContain(i18n.global.t('project.gaugeStitchesImperial'))
    expect(w.text()).toContain(i18n.global.t('project.gaugeRowsImperial'))
    expect(w.text()).not.toContain(i18n.global.t('project.gaugeStitches'))
  })

  it('mode impérial : l’aide contextuelle (bouton d’aide) du champ mailles déplie le hint impérial, pas le hint métrique', async () => {
    // Le hint n'est plus porté par `aria-label` (nom accessible du bouton) : il ne
    // désigne désormais que l'ACTION du bouton (« Afficher l'aide pour {label} »),
    // cf. FieldHelp.vue — répéter l'astuce dans le nom du bouton la faisait lire deux
    // fois par un lecteur d'écran. Le hint réel est vérifié là où il apparaît vraiment :
    // le `<p>` déplié après clic (`v-if="open && hint"`, fermé par défaut).
    await db.settings.put({ key: 'unitSystem', value: 'imperial' })
    const w = mountEdit()
    await waitHydrated(w)
    const hintBtn = w.find('label[for="gs"] .fh__btn')
    expect(hintBtn.exists()).toBe(true)
    await hintBtn.trigger('click')
    const hintP = hintBtn.element.closest('.fh').querySelector('.fh__hint')
    expect(hintP?.textContent).toBe(i18n.global.t('project.gaugeHintImperial'))
  })

  it('mode métrique : l’aide contextuelle du champ mailles déplie le hint métrique', async () => {
    const w = mountEdit()
    await waitHydrated(w)
    const hintBtn = w.find('label[for="gs"] .fh__btn')
    await hintBtn.trigger('click')
    const hintP = hintBtn.element.closest('.fh').querySelector('.fh__hint')
    expect(hintP?.textContent).toBe(i18n.global.t('project.gaugeHint'))
  })

  it('mode impérial : saisir 20 mailles enregistre EXACTEMENT 20, aucune conversion (garde anti-régression)', async () => {
    await db.settings.put({ key: 'unitSystem', value: 'imperial' })
    const w = mountEdit()
    await waitHydrated(w)
    await w.find('#name').setValue('Châle impérial')
    await w.find('#gs').setValue('20')
    await w.find('#gr').setValue('28')
    await w.find('.btn--primary').trigger('click')
    await flushPromises()
    const created = (await db.projects.toArray()).find((p) => p.name === 'Châle impérial')
    // Comparaison STRICTE à la chaîne saisie : un facteur de conversion (× 1,016)
    // produirait '20.32' ou 20.32, jamais '20'.
    expect(created.gaugeStitches).toBe('20')
    expect(created.gaugeRows).toBe('28')
  })
})

// ── Interrupteur « Chrono » (08/09, fusion chrono + œil) : porte de retour durable
// du chrono masqué. Il lit et persiste project.showTimer (défaut true) ; le chevron de la
// pastille et le kebab de la fiche restent les gestes rapides, celui-ci est le réglage posé.
describe('ProjectEditView — interrupteur Chrono (project.showTimer)', () => {
  const champChrono = (w) => w.find('input[type="checkbox"][aria-label="Afficher le chronomètre"]')

  it('création : la case est cochée par défaut (chrono affiché) et un projet créé sans y toucher reste showTimer:true', async () => {
    const w = mountEdit()
    await waitHydrated(w)
    expect(champChrono(w).exists()).toBe(true)
    expect(champChrono(w).element.checked).toBe(true)
    await w.find('#name').setValue('Projet neuf')
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalled(), { timeout: 10000 })
    const created = (await db.projects.toArray()).find((p) => p.name === 'Projet neuf')
    expect(created.showTimer).toBe(true)
  })

  it('édition : la case reflète l’état existant (showTimer:false → décochée) et le recocher persiste true', async () => {
    const pid = await seedProject({ showTimer: false })
    const w = mountEdit()
    await waitHydrated(w)
    expect(champChrono(w).element.checked).toBe(false)
    await champChrono(w).setValue(true)
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    // Le DOM seul ne suffirait pas : seule la base prouve la persistance.
    expect((await db.projects.get(pid)).showTimer).toBe(true)
  })

  it('édition : décocher la case persiste showTimer:false', async () => {
    const pid = await seedProject()
    const w = mountEdit()
    await waitHydrated(w)
    await champChrono(w).setValue(false)
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    expect((await db.projects.get(pid)).showTimer).toBe(false)
  })

  it('vieux projet sans showTimer en base : la case est COCHÉE (défaut), et enregistrer sans y toucher n’écrit jamais false', async () => {
    // Object.assign(form, p) poserait undefined dans le formulaire : sans le garde du
    // montage, une simple ouverture + enregistrement écrirait showTimer:false sous les
    // pieds de l'utilisatrice. Le défaut « affiché » est exigé (emptyProject()).
    const pid = await seedProject()
    await db.projects.update(pid, { showTimer: undefined })
    const w = mountEdit()
    await waitHydrated(w)
    expect(champChrono(w).element.checked).toBe(true)
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    expect((await db.projects.get(pid)).showTimer).toBe(true)
  })
})

// Revue finale du lot « corrections stats/badge » (16/09) : `project-edit` reste dans la
// « bulle » du garde de routeur (src/router/index.js, inChronoBubble) tant que l'id ne
// change pas — et `finishSave` renvoie précisément vers `project` avec le MÊME id. Le
// garde « sortie de bulle » ne ferme donc RIEN à l'entrée ni à la sortie de cet écran :
// si le statut enregistré ici est Terminé/Abandonné, un chrono qui tournait sur CE projet
// resterait actif et invisible (chronoVisible masque la pastille sur la fiche dès l'arrivée).
// Même correctif que ProjectDetailView.changeStatus : fermer AVANT l'écriture du statut.
describe('ProjectEditView — chrono actif sur ce projet à l’enregistrement', () => {
  const T0 = 1_700_000_000_000
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(T0))
  afterEach(() => vi.restoreAllMocks())

  // Pinia PARTAGÉE entre le montage et le test (même motif que project-detail-chrono.spec.js) :
  // setActivePinia AVANT de démarrer le chrono ET avant le mount, puis la même instance passée
  // en plugin — sinon la vue et l'assertion `active.isActive` ne verraient pas le même store.
  async function mountEditSharedPinia(pid) {
    const pinia = createPinia()
    setActivePinia(pinia)
    const active = useActiveSessionStore()
    await active.openFor(pid, SESSION_NO_SECTION, 0)
    await active.play()
    Date.now.mockReturnValue(T0 + 5000) // 5 s courues avant l'enregistrement
    const w = mount(ProjectEditView, { global: { plugins: [pinia, i18n] } })
    await waitHydrated(w)
    return { w, active }
  }

  it('passer au statut Terminé pendant que le chrono de CE projet tourne le clôt avant d’enregistrer', async () => {
    const pid = await seedProject()
    const { w, active } = await mountEditSharedPinia(pid)

    await chip(w, 'done').trigger('click')
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })

    // Le chrono est bien fermé (pas seulement masqué à l'arrivée sur la fiche) : sinon la
    // séance resterait ouverte, invisible, jusqu'à la prochaine « vraie » sortie de bulle.
    expect(active.isActive).toBe(false)
    // …et journalisé avec une durée saine (rien perdu).
    const rows = await db.sessions.where('projectId').equals(pid).toArray()
    expect(rows.length).toBe(1)
    expect(rows[0].durationSec).toBe(5)
  })

  it('passer au statut Abandonné pendant que le chrono de CE projet tourne le clôt aussi', async () => {
    const pid = await seedProject()
    const { w, active } = await mountEditSharedPinia(pid)

    await chip(w, 'abandoned').trigger('click')
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })

    expect(active.isActive).toBe(false)
    const rows = await db.sessions.where('projectId').equals(pid).toArray()
    expect(rows.length).toBe(1)
    expect(rows[0].durationSec).toBe(5)
  })

  it('laisser le statut à « En cours » n’y touche pas : le chrono de ce projet continue', async () => {
    const pid = await seedProject()
    const { w, active } = await mountEditSharedPinia(pid)

    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })

    expect(active.isActive).toBe(true)
    await active.pause() // coupe le setInterval réel, sinon il fuit d'un test à l'autre
  })
})

describe('ProjectEditView — suivi du lecteur (readerState)', () => {
  const READER = { sizeLabels: ['S', 'M', 'L'], sections: [{ id: 'a', title: 'A', steps: [{ t: 'Rang' }] }] }

  // Le formulaire ne réécrit pas un readerState recalé en base pendant qu'il était ouvert (synchro).
  it('enregistrer ne renvoie pas le readerState lu à l’ouverture', async () => {
    const pid = await seedProject({ readerState: { size: 0, done: { 'a#0': true } } })
    const w = mountEdit()
    await waitHydrated(w)
    await db.projects.update(pid, { readerState: { size: 0, done: { 'a#1': true } } })
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalled(), { timeout: 10000 })
    expect((await db.projects.get(pid)).readerState.done).toEqual({ 'a#1': true })
  })

  // Changer la taille tricotée ici pilote aussi l'index du lecteur (même règle que la fiche).
  it('changer la taille tricotée met à jour readerState.size', async () => {
    const patternId = await db.patterns.add({ name: 'Pull', type: 'knitting', reader: READER, sizes: ['S', 'M', 'L'] })
    const pid = await seedProject({ patternId, sizes: ['S', 'M', 'L'], activeSize: 'S', readerState: { size: 0, done: { 'a#0': true } } })
    const w = mountEdit()
    await waitHydrated(w)
    await w.find('select#asize').setValue('L')
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalled(), { timeout: 10000 })
    const p = await db.projects.get(pid)
    expect(p.activeSize).toBe('L')
    expect(p.readerState).toEqual({ size: 2, done: { 'a#0': true } })
  })
})

describe('ProjectEditView — bornes des dates', () => {
  // Protège : les champs de date proposent la même plage d'années que celle retenue par les statistiques.
  it('début et fin portent min 1900-01-01 et max à la fin de l’année suivante', async () => {
    await seedProject()
    const w = mountEdit()
    await waitHydrated(w)
    const max = `${new Date().getFullYear() + 1}-12-31`
    for (const id of ['#start', '#end']) {
      expect(w.find(id).attributes('min')).toBe('1900-01-01')
      expect(w.find(id).attributes('max')).toBe(max)
    }
    w.unmount()
  })
})

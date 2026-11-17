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
import { ymdLocal } from '@/utils/time-periods'

const nav = vi.hoisted(() => ({
  route: { params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRoute: () => nav.route, useRouter: () => nav.router }))

import ProjectEditView from '@/views/ProjectEditView.vue'
import YarnConsumptionDialog from '@/components/YarnConsumptionDialog.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import ToolParkingDialog from '@/components/ToolParkingDialog.vue'

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
      { id: yid, name: 'Drops · Bleu', reserved: 2, available: 5, othersReserved: false },
    ])
    // Le statut final n'est PAS encore écrit : il ne l'est qu'à la validation (Annuler doit
    // laisser le projet tel qu'il était). La navigation attend aussi la réponse.
    expect((await db.projects.get(pid)).status).toBe('wip')
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
    // Créé en « En attente » (défaut d'emptyProject) : Terminé n'est écrit qu'à la validation.
    expect(created.status).toBe('waiting')
    expect(w.findComponent(YarnConsumptionDialog).props('yarns')).toEqual([
      { id: yid, name: 'Drops · Bleu', reserved: 1, available: 5, othersReserved: false },
    ])

    await w.findComponent(YarnConsumptionDialog).vm.$emit('confirm', [{ id: yid, used: 1 }])
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: created.id } }), { timeout: 10000 })
    expect((await db.yarns.get(yid)).quantity).toBe(4)
    expect((await db.projects.get(created.id)).status).toBe('done')
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
      { id: yid, name: 'Drops · Bleu', reserved: 2, available: 5, othersReserved: false },
    ])

    await w.findComponent(YarnConsumptionDialog).vm.$emit('confirm', [{ id: yid, used: 2 }])
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    const fresh = await db.projects.get(pid)
    expect(fresh.status).toBe('done')
    expect(fresh.finishedAt).toBe('2026-07-15')
  })
})

// Annuler la question des pelotes (décision de Julien, 15/11) : toute fermeture sans
// « Valider » laisse le statut tel qu'il était et ne touche à aucune laine. Sur cet écran, le
// statut Terminé/Abandonné n'est donc écrit qu'APRÈS la validation ; les autres champs, eux,
// sont enregistrés tout de suite, et Annuler mène quand même à la fiche du projet.
describe('ProjectEditView, Annuler la question des pelotes', () => {
  const dialog = (w) => w.findComponent(YarnConsumptionDialog)

  async function saveAsDone(w) {
    await chip(w, 'done').trigger('click')
    await w.find('.btn--primary').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(dialog(w).props('open')).toBe(true), { timeout: 10000 })
  }

  it('(a) projet en cours passé à Terminé puis Annuler : statut inchangé, laine intacte, autres champs enregistrés, retour à la fiche', async () => {
    const pid = await seedProject({ finishedAt: '' })
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountEdit()
    await waitHydrated(w)

    await w.find('#name').setValue('Pull torsadé rouge')
    await saveAsDone(w)
    await dialog(w).vm.$emit('cancel')

    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    const p = await db.projects.get(pid)
    expect(p.status).toBe('wip')
    expect(p.finishedAt).toBe('')
    expect(p.name).toBe('Pull torsadé rouge')
    const y = await db.yarns.get(yid)
    expect(y.quantity).toBe(5)
    expect(y.reservations).toEqual({ [pid]: 2 })
    expect(y.consumed ?? {}).toEqual({}) // aucune trace de consommation
    expect(dialog(w).props('open')).toBe(false)
  })

  it('(b) même chose puis Valider : statut Terminé, date de fin du jour, laine consommée', async () => {
    const pid = await seedProject({ finishedAt: '' })
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountEdit()
    await waitHydrated(w)

    await w.find('#name').setValue('Pull torsadé rouge')
    await saveAsDone(w)
    await dialog(w).vm.$emit('confirm', [{ id: yid, used: 2 }])

    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    const p = await db.projects.get(pid)
    expect(p.status).toBe('done')
    expect(p.finishedAt).toBe(ymdLocal(new Date()))
    expect(p.name).toBe('Pull torsadé rouge')
    const y = await db.yarns.get(yid)
    expect(y.quantity).toBe(3)
    expect(y.reservations).toEqual({})
    expect(y.consumed).toEqual({ [pid]: 2 })
  })

  it('(c) sans laine réservée : aucune question, Terminé écrit directement avec la date du jour', async () => {
    const pid = await seedProject({ finishedAt: '' })
    const w = mountEdit()
    await waitHydrated(w)

    await chip(w, 'done').trigger('click')
    await w.find('.btn--primary').trigger('click')

    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    expect(dialog(w).props('open')).toBe(false)
    const p = await db.projects.get(pid)
    expect(p.status).toBe('done')
    expect(p.finishedAt).toBe(ymdLocal(new Date()))
  })

  it('(d) création directe en Terminé avec une laine puis Annuler : un seul projet, créé « En attente », retour à sa fiche', async () => {
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5 })
    const w = mountEdit()
    await waitHydrated(w)

    await w.find('#name').setValue('Nouveau pull')
    await w.find('.ypick__brandfilter select').setValue('Drops')
    await flushPromises()
    await w.find('.ypick__row input[type=checkbox]').trigger('change')
    await saveAsDone(w)
    await dialog(w).vm.$emit('cancel')

    expect(await db.projects.count()).toBe(1)
    const [created] = await db.projects.toArray()
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: created.id } }), { timeout: 10000 })
    expect(created.name).toBe('Nouveau pull')
    expect(created.status).toBe('waiting')
    expect(created.finishedAt).toBe('')
    const y = await db.yarns.get(yid)
    expect(y.quantity).toBe(5)
    expect(y.reservations).toEqual({ [created.id]: 1 })
    expect(y.consumed ?? {}).toEqual({}) // aucune trace de consommation
  })

  it('(f) création directe en Terminé SANS laine réservée : aucune question, un seul projet, Terminé écrit tout de suite avec la date du jour', async () => {
    const w = mountEdit()
    await waitHydrated(w)

    await w.find('#name').setValue('Bonnet express')
    await chip(w, 'done').trigger('click')
    await w.find('.btn--primary').trigger('click')

    await vi.waitFor(async () => expect(await db.projects.count()).toBe(1), { timeout: 10000 })
    const [created] = await db.projects.toArray()
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: created.id } }), { timeout: 10000 })
    expect(dialog(w).props('open')).toBe(false)
    const p = await db.projects.get(created.id)
    expect(p.name).toBe('Bonnet express')
    expect(p.status).toBe('done')
    expect(p.finishedAt).toBe(ymdLocal(new Date()))
  })

  it('date de fin saisie puis Annuler : ni statut ni date écrits (la date seule est le geste de clôture)', async () => {
    const pid = await seedProject({ finishedAt: '' })
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountEdit()
    await waitHydrated(w)

    await w.find('#end').setValue('2026-07-15')
    await w.find('.btn--primary').trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(dialog(w).props('open')).toBe(true), { timeout: 10000 })
    await dialog(w).vm.$emit('cancel')

    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    const p = await db.projects.get(pid)
    expect(p.status).toBe('wip')
    expect(p.finishedAt).toBe('')
  })

  it('« Corriger le stock » : annule (statut inchangé), passe par la fiche puis ouvre la laine', async () => {
    const pid = await seedProject()
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountEdit()
    await waitHydrated(w)

    await saveAsDone(w)
    await dialog(w).vm.$emit('fix-stock', yid)

    await vi.waitFor(() => expect(nav.router.push).toHaveBeenCalledWith({ name: 'stash-edit', params: { id: yid } }), { timeout: 10000 })
    expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } })
    expect((await db.projects.get(pid)).status).toBe('wip')
    expect((await db.yarns.get(yid)).reservations).toEqual({ [pid]: 2 })
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

  it('(e) avec une laine réservée : Annuler laisse le chrono tourner, seul Valider le ferme', async () => {
    const pid = await seedProject()
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
    const { w, active } = await mountEditSharedPinia(pid)
    const dialog = () => w.findComponent(YarnConsumptionDialog)

    await chip(w, 'done').trigger('click')
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(dialog().props('open')).toBe(true), { timeout: 10000 })
    // Question posée : rien n'est encore décidé, le chrono tourne toujours.
    expect(active.isActive).toBe(true)
    await dialog().vm.$emit('cancel')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalled(), { timeout: 10000 })
    expect(active.isActive).toBe(true)
    expect(await db.sessions.where('projectId').equals(pid).count()).toBe(0)
    expect((await db.projects.get(pid)).status).toBe('wip')

    // Nouvel enregistrement en Terminé, cette fois validé : le chrono est fermé et journalisé.
    nav.router.replace.mockClear()
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(dialog().props('open')).toBe(true), { timeout: 10000 })
    await dialog().vm.$emit('confirm', [{ id: yid, used: 2 }])
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    expect(active.isActive).toBe(false)
    const rows = await db.sessions.where('projectId').equals(pid).toArray()
    expect(rows.length).toBe(1)
    expect(rows[0].durationSec).toBe(5)
    expect((await db.projects.get(pid)).status).toBe('done')
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

describe('ProjectEditView — libellé des aiguilles', () => {
  // Protège : le libellé aiguilles/crochets pointe vers le premier champ mm (labelOffsetAbove s'appuie sur field.labels).
  it('le libellé a un for égal à l’id du premier champ mm', async () => {
    await seedProject()
    const w = mountEdit()
    await waitHydrated(w)
    const label = w.findAll('label.field-label').find((l) => l.text() === i18n.global.t('project.needles'))
    const first = w.find('.needle-row input')
    expect(first.attributes('id')).toBeTruthy()
    expect(label.attributes('for')).toBe(first.attributes('id'))
    expect(first.element.labels[0]).toBe(label.element)
    w.unmount()
  })
})

describe('ProjectEditView — technique des chaussettes', () => {
  // Protège : la fiche écrit la même technique que le lecteur, sans écraser le reste du suivi.
  const SOCK = { sections: [{ id: 'p', kind: 'pied', copies: 2, title: 'Pied', steps: [{ t: 'Rang A' }] }] }
  const PLAIN = { sections: [{ id: 'c', title: 'Corps', steps: [{ t: 'Rang A' }] }] }
  const save = async (w) => {
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalled(), { timeout: 10000 })
  }
  const dlg = (w) => w.findAllComponents(ConfirmDialog).find((d) => d.props('title') === i18n.global.t('reader.copies.resetTitle'))

  it("champ visible seulement pour un patron à parties de chaussette x2, « l'une après l'autre » par défaut", async () => {
    const sockId = await db.patterns.add({ name: 'Chaussettes', type: 'knitting', reader: SOCK })
    await seedProject({ patternId: sockId })
    let w = mountEdit()
    await waitHydrated(w)
    expect(w.find('select#techsel').element.value).toBe('sequential')
    w.unmount()
    const plainId = await db.patterns.add({ name: 'Pull', type: 'knitting', reader: PLAIN })
    await seedProject({ patternId: plainId })
    w = mountEdit()
    await waitHydrated(w)
    expect(w.find('select#techsel').exists()).toBe(false)
    w.unmount()
  })

  it('le champ se trouve dans le bloc « Technique & matériel »', async () => {
    const sockId = await db.patterns.add({ name: 'Chaussettes', type: 'knitting', reader: SOCK })
    await seedProject({ patternId: sockId })
    const w = mountEdit()
    await waitHydrated(w)
    const card = w.findAll('section.card').find((c) => c.find('.card__title').text() === i18n.global.t('project.sectionGear'))
    expect(card.find('select#techsel').exists()).toBe(true)
    w.unmount()
  })

  it('création : « Les deux en même temps » écrit readerState.copyMode', async () => {
    const sockId = await db.patterns.add({ name: 'Chaussettes', type: 'knitting', reader: SOCK })
    nav.route.params = {}
    nav.route.query = { pattern: String(sockId) }
    const w = mountEdit()
    await waitHydrated(w)
    await w.find('#name').setValue('Paire bleue')
    await w.find('select#techsel').setValue('simultaneous')
    await save(w)
    const [p] = (await db.projects.toArray()).filter((x) => x.name === 'Paire bleue')
    expect(p.readerState).toEqual({ copyMode: 'simultaneous' })
    w.unmount()
  })

  it('modification sans rang de chaussette fait : enregistré sans dialogue, le reste du suivi intact', async () => {
    const sockId = await db.patterns.add({ name: 'Chaussettes', type: 'knitting', reader: SOCK })
    const pid = await seedProject({ patternId: sockId, readerState: { size: 1, chartRows: { x: 2 }, done: { 'autre#0': true } } })
    const w = mountEdit()
    await waitHydrated(w)
    await w.find('select#techsel').setValue('simultaneous')
    await save(w)
    expect(dlg(w).props('open')).toBe(false)
    expect((await db.projects.get(pid)).readerState).toEqual({ size: 1, chartRows: { x: 2 }, done: { 'autre#0': true }, counters: {}, copyMode: 'simultaneous' })
    w.unmount()
  })

  it('modification avec un rang de chaussette fait : Annuler ne change rien, Recommencer remet les chaussettes à zéro', async () => {
    const sockId = await db.patterns.add({ name: 'Chaussettes', type: 'knitting', reader: SOCK })
    const pid = await seedProject({ patternId: sockId, readerState: { done: { 'p#0': true }, copyMode: 'simultaneous' } })
    const w = mountEdit()
    await waitHydrated(w)
    await w.find('select#techsel').setValue('sequential')
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(dlg(w).props('open')).toBe(true))
    expect(dlg(w).props('message')).toBe(i18n.global.t('reader.copies.resetMsg'))
    dlg(w).vm.$emit('cancel')
    await flushPromises()
    expect(nav.router.replace).not.toHaveBeenCalled()
    expect((await db.projects.get(pid)).readerState).toEqual({ done: { 'p#0': true }, copyMode: 'simultaneous' })
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(dlg(w).props('open')).toBe(true))
    dlg(w).vm.$emit('confirm')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalled(), { timeout: 10000 })
    expect((await db.projects.get(pid)).readerState).toEqual({ done: {}, counters: {} })
    w.unmount()
  })

  // « Corriger le stock » du bloc « Pelotes tricotées » passe par le même enregistrement : si
  // la question « Recommencer les chaussettes ? » l'interrompt, la confirmation relance `save`,
  // qui doit encore ouvrir la laine ensuite (sinon le bouton ne mène qu'à la fiche).
  it('« Corriger le stock » interrompu par la question des chaussettes : après Recommencer, la laine s’ouvre quand même', async () => {
    const sockId = await db.patterns.add({ name: 'Chaussettes', type: 'knitting', reader: SOCK })
    const pid = await seedProject({ status: 'done', finishedAt: '2026-07-01', patternId: sockId, readerState: { done: { 'p#0': true }, copyMode: 'simultaneous' } })
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 4, reservations: {}, consumed: { [pid]: 3 } })
    const w = mountEdit()
    await waitHydrated(w)
    await w.find('select#techsel').setValue('sequential')
    const champ = w.find('[data-test="consumed-block"] input')
    champ.element.value = '12'
    await champ.trigger('input')
    await flushPromises()
    await w.find('[data-test="consumed-fix-stock"]').trigger('click')
    await vi.waitFor(() => expect(dlg(w).props('open')).toBe(true))
    expect(nav.router.push).not.toHaveBeenCalled()
    dlg(w).vm.$emit('confirm')
    await vi.waitFor(() => expect(nav.router.push).toHaveBeenCalledWith({ name: 'stash-edit', params: { id: yid } }), { timeout: 10000 })
    expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } })
    w.unmount()
  })
})

// Bloc « Pelotes tricotées » : corrige APRÈS COUP combien de pelotes un projet terminé a
// consommées. Les assertions lisent la base (quantity, consumed), pas des appels de fonction.
describe('ProjectEditView, bloc « Pelotes tricotées » (correction après coup)', () => {
  const mountBlock = () => mount(ProjectEditView, { global: { plugins: [createPinia(), i18n] } })
  const block = (w) => w.find('[data-test="consumed-block"]')
  const fixBtn = (w) => block(w).find('[data-test="consumed-fix-stock"]')
  const field = (w) => block(w).find('input')
  async function typeQty(w, text, i = 0) {
    const input = block(w).findAll('input')[i]
    input.element.value = text
    await input.trigger('input')
  }
  async function saveNow(w) {
    nav.router.replace.mockClear()
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalled(), { timeout: 10000 })
  }
  // Projet terminé qui a consommé 3 pelotes d'une laine dont il reste 4 pelotes.
  async function seedDone() {
    const pid = await seedProject({ status: 'done', finishedAt: '2026-07-01' })
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 4, reservations: {}, consumed: { [pid]: 3 } })
    return { pid, yid }
  }

  // Le bouton enregistre, et l'enregistrement peut ouvrir la question des pelotes (statut passé à
  // Abandonné avec une laine B réservée). « Corriger le stock » sur B, DANS le dialogue, annule :
  // l'annulation ne doit plus pousser la laine A en plus, sinon l'historique empile
  // projet, A, B et le Retour depuis B atterrit sur A.
  it('« Corriger le stock » de la laine A puis de la laine B dans le dialogue : une seule poussée, vers B', async () => {
    const { pid, yid } = await seedDone()
    const yidB = await db.yarns.add({ brand: 'Rico', colorName: 'Rouge', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountBlock()
    await waitHydrated(w)
    await chip(w, 'abandoned').trigger('click')
    await typeQty(w, '12')
    await flushPromises()
    await fixBtn(w).trigger('click')
    const d = w.findComponent(YarnConsumptionDialog)
    await vi.waitFor(() => expect(d.props('open')).toBe(true), { timeout: 10000 })
    await d.vm.$emit('fix-stock', yidB)

    await vi.waitFor(() => expect(nav.router.push).toHaveBeenCalledWith({ name: 'stash-edit', params: { id: yidB } }), { timeout: 10000 })
    expect(nav.router.push).toHaveBeenCalledTimes(1)
    expect(nav.router.push).not.toHaveBeenCalledWith({ name: 'stash-edit', params: { id: yid } })
    w.unmount()
  })

  it('Annuler simple dans le dialogue ouvert par « Corriger le stock » : la laine A reste ouverte', async () => {
    const { pid, yid } = await seedDone()
    await db.yarns.add({ brand: 'Rico', colorName: 'Rouge', quantity: 5, reservations: { [pid]: 2 } })
    const w = mountBlock()
    await waitHydrated(w)
    await chip(w, 'abandoned').trigger('click')
    await typeQty(w, '12')
    await flushPromises()
    await fixBtn(w).trigger('click')
    const d = w.findComponent(YarnConsumptionDialog)
    await vi.waitFor(() => expect(d.props('open')).toBe(true), { timeout: 10000 })
    await d.vm.$emit('cancel')

    await vi.waitFor(() => expect(nav.router.push).toHaveBeenCalledWith({ name: 'stash-edit', params: { id: yid } }), { timeout: 10000 })
    expect(nav.router.push).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('absent sur un projet sans trace de consommation', async () => {
    const pid = await seedProject()
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 4, reservations: { [pid]: 2 }, consumed: {} })
    const w = mountBlock()
    await waitHydrated(w)
    expect(block(w).exists()).toBe(false)
  })

  it('absent sur un nouveau projet', async () => {
    nav.route.params = {}
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 4, reservations: {}, consumed: { 99: 3 } })
    const w = mountBlock()
    await waitHydrated(w)
    expect(block(w).exists()).toBe(false)
  })

  it('une ligne par laine tracée, avec son nom et sa valeur', async () => {
    const { pid } = await seedDone()
    await db.yarns.add({ brand: 'Rico', colorName: 'Rouge', quantity: 1, reservations: {}, consumed: { [pid]: 1.5 } })
    await db.yarns.add({ brand: 'Autre', colorName: 'Vert', quantity: 1, reservations: {}, consumed: { 999: 2 } })
    const w = mountBlock()
    await waitHydrated(w)
    const rows = block(w).findAll('.ypick__row')
    expect(rows).toHaveLength(2)
    // l'ordre des lignes suit le store : on retrouve chaque laine par son nom
    const rowOf = (label) => rows.find((r) => r.text().includes(label))
    expect(rowOf('Drops · Bleu').find('input').element.value).toBe('3')
    expect(rowOf('Rico · Rouge').find('input').element.value).toBe('1,5')
  })

  it('3 vers 5 avec 4 en stock : consumed 5, quantity 2', async () => {
    const { pid, yid } = await seedDone()
    const w = mountBlock()
    await waitHydrated(w)
    await typeQty(w, '5')
    await saveNow(w)
    const y = await db.yarns.get(yid)
    expect(y.consumed).toEqual({ [pid]: 5 })
    expect(y.quantity).toBe(2)
  })

  it('5 vers 2 rend 3 pelotes au stock', async () => {
    const pid = await seedProject({ status: 'done', finishedAt: '2026-07-01' })
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 4, reservations: {}, consumed: { [pid]: 5 } })
    const w = mountBlock()
    await waitHydrated(w)
    await typeQty(w, '2')
    await saveNow(w)
    const y = await db.yarns.get(yid)
    expect(y.consumed).toEqual({ [pid]: 2 })
    expect(y.quantity).toBe(7)
  })

  it('un 0 réellement saisi retire la trace et rend tout au stock', async () => {
    const { pid, yid } = await seedDone()
    const w = mountBlock()
    await waitHydrated(w)
    await typeQty(w, '0')
    await saveNow(w)
    const y = await db.yarns.get(yid)
    expect(y.consumed ?? {}).toEqual({})
    expect(y.quantity).toBe(7)
    // La trace de CE projet est bien retirée (pas seulement vide par accident), et corriger sa
    // consommation ne touche pas à son statut.
    expect(y.consumed ?? {}).not.toHaveProperty(String(pid))
    expect((await db.projects.get(pid)).status).toBe('done')
  })

  it('valeur au-dessus du maximum : champ ramené au maximum, message et bouton vers la laine', async () => {
    const { pid, yid } = await seedDone() // maximum = 3 + 4 = 7
    const w = mountBlock()
    await waitHydrated(w)
    await typeQty(w, '12')
    await flushPromises()
    expect(field(w).element.value).toBe('7')
    expect(block(w).text()).toContain(i18n.global.t('project.consumedOverStockPlain', { n: '7' }))
    expect(block(w).text()).not.toContain(i18n.global.t('project.consumedOverStock', { n: '7' }))
    expect(fixBtn(w).text()).toBe(i18n.global.t('project.consumedFixStock'))
    // jamais de troncature silencieuse : l'enregistrement écrit le maximum, pas 12
    await saveNow(w)
    const y = await db.yarns.get(yid)
    expect(y.consumed).toEqual({ [pid]: 7 })
    expect(y.quantity).toBe(0)
  })

  // Reste n°2 du lot du 17/11 : seule la réservation propre du projet limite le maximum
  // (stock 5, réservé 2, consommé 3 : 6 et non 8). Ni « autres projets » (faux), ni le texte nu.
  const pickQty = (w) => w.findAll('.ypick__qtyin').find((el) => !block(w).element.contains(el.element))
  async function typePick(w, text) {
    const input = pickQty(w)
    input.element.value = text
    await input.trigger('input')
  }
  async function seedOwnReserved() {
    const pid = await seedProject({ status: 'done', finishedAt: '2026-07-01' })
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 }, consumed: { [pid]: 3 } })
    return { pid, yid }
  }

  it('maximum qui remonte (laine décochée) : le message périmé disparaît', async () => {
    await seedOwnReserved()
    const w = mountBlock()
    await waitHydrated(w)
    await typeQty(w, '9') // borné à 6, message affiché
    await flushPromises()
    expect(fixBtn(w).exists()).toBe(true)
    await w.find('.ypick__pick input').setValue(false) // décocher : plus de réservation, maximum 8
    await flushPromises()
    expect(fixBtn(w).exists()).toBe(false)
  })

  it('seule la réservation propre limite : texte dédié, ni « autres projets » ni texte nu', async () => {
    await seedOwnReserved()
    const w = mountBlock()
    await waitHydrated(w)
    await typeQty(w, '9')
    await flushPromises()
    expect(field(w).element.value).toBe('6')
    const own = i18n.global.t('project.consumedOverStockOwn', { n: '6' })
    expect(block(w).text()).toContain(own)
    expect(block(w).text()).not.toContain('autres projets')
    expect(block(w).text()).not.toContain(i18n.global.t('project.consumedOverStock', { n: '6' }))
  })

  // Reste n°1 : le maximum du bloc tient compte de la réservation EN ATTENTE dans le même
  // formulaire, sinon on accepte 6 à l'écran et l'enregistrement écrit 5 sans rien dire.
  it('réservation relevée dans le formulaire : le maximum du bloc suit (5, pas 6)', async () => {
    const { pid, yid } = await seedOwnReserved()
    const w = mountBlock()
    await waitHydrated(w)
    await typePick(w, '3')
    await typeQty(w, '6')
    await flushPromises()
    expect(field(w).element.value).toBe('5')
    expect(block(w).text()).toContain(i18n.global.t('project.consumedOverStockOwn', { n: '5' }))
    // Un projet terminé qui garde une réservation repose la question des pelotes : Annuler
    // laisse les champs déjà enregistrés (liens puis corrections) tels quels.
    nav.router.replace.mockClear()
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })
    await w.findComponent(YarnConsumptionDialog).vm.$emit('cancel')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalled(), { timeout: 10000 })
    const y = await db.yarns.get(yid)
    expect(y.reservations).toEqual({ [pid]: 3 })
    expect(y.consumed).toEqual({ [pid]: 5 })
    expect(y.quantity).toBe(3)
  })

  it('valeur déjà tapée, puis réservation relevée : la valeur est ramenée et dite', async () => {
    await seedOwnReserved()
    const w = mountBlock()
    await waitHydrated(w)
    await typeQty(w, '6') // permis : maximum 6
    await flushPromises()
    expect(fixBtn(w).exists()).toBe(false)
    await typePick(w, '3')
    await flushPromises()
    expect(field(w).element.value).toBe('5')
    expect(block(w).text()).toContain(i18n.global.t('project.consumedOverStockOwn', { n: '5' }))
  })

  it('le message disparaît quand la valeur redevient permise', async () => {
    await seedDone()
    const w = mountBlock()
    await waitHydrated(w)
    await typeQty(w, '12')
    await typeQty(w, '6')
    await flushPromises()
    expect(fixBtn(w).exists()).toBe(false)
  })

  // Régression (revue finale) : stock 5, A réserve 2, B réserve 3, A clôt à 2. Il reste 3
  // pelotes, toutes réservées par B : la correction de A ne peut pas monter au-dessus de 2.
  it('A/B : les pelotes réservées par un autre projet ne sont pas à prendre (maximum 2, pas 5)', async () => {
    const pid = await seedProject({ status: 'done', finishedAt: '2026-07-01' })
    const autre = await db.projects.add({ name: 'B', technique: 'knitting', status: 'wip' })
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 3, reservations: { [autre]: 3 }, consumed: { [pid]: 2 } })
    const w = mountBlock()
    await waitHydrated(w)
    await typeQty(w, '5')
    await flushPromises()
    expect(field(w).element.value).toBe('2')
    expect(block(w).text()).toContain(i18n.global.t('project.consumedOverStock', { n: '2' }))
    expect(block(w).text()).toContain('autres projets')
    await saveNow(w)
    const y = await db.yarns.get(yid)
    expect(y.quantity).toBe(3)
    expect(y.consumed).toEqual({ [pid]: 2 })
    expect(y.reservations).toEqual({ [autre]: 3 })
  })

  // « Corriger le stock » était un lien : le suivre quittait l'écran sans enregistrer, et tout ce
  // qui avait été tapé ailleurs dans le formulaire était perdu en silence. Le bouton enregistre
  // d'abord (même parcours qu'Enregistrer), atterrit sur la fiche du projet, puis ouvre la laine
  // par-dessus (le Retour depuis la laine ramène à la fiche, comme depuis le dialogue).
  it('« Corriger le stock » enregistre d’abord les autres modifications, passe par la fiche puis ouvre la laine', async () => {
    const { pid, yid } = await seedDone()
    const autreYid = await db.yarns.add({ brand: 'Rico', colorName: 'Rouge', quantity: 2, reservations: {}, consumed: { [pid]: 1 } })
    const w = mountBlock()
    await waitHydrated(w)
    await w.find('#name').setValue('Pull torsadé corrigé')
    const rows = block(w).findAll('.ypick__row')
    const rowOf = (label) => rows.find((r) => r.text().includes(label))
    // Une correction permise sur une autre laine : elle est enregistrée avec le reste.
    const rico = rowOf('Rico · Rouge').find('input')
    rico.element.value = '2'
    await rico.trigger('input')
    // Dépassement sur la laine à corriger : le bouton apparaît.
    const drops = rowOf('Drops · Bleu').find('input')
    drops.element.value = '12'
    await drops.trigger('input')
    await flushPromises()
    await fixBtn(w).trigger('click')

    await vi.waitFor(() => expect(nav.router.push).toHaveBeenCalledWith({ name: 'stash-edit', params: { id: yid } }), { timeout: 10000 })
    expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } })
    expect(nav.router.replace.mock.invocationCallOrder[0]).toBeLessThan(nav.router.push.mock.invocationCallOrder[0])
    const p = await db.projects.get(pid)
    expect(p.name).toBe('Pull torsadé corrigé')
    expect(p.status).toBe('done')
    const rouge = await db.yarns.get(autreYid)
    expect(rouge.consumed).toEqual({ [pid]: 2 })
    expect(rouge.quantity).toBe(1)
    // La laine dont le stock est à corriger n'est PAS touchée : sa saisie bornée n'est pas une
    // vraie consommation (même règle que « Corriger le stock » dans le dialogue, qui ne
    // consomme rien). Écrire le maximum viderait le stock juste avant qu'on aille le corriger.
    const bleu = await db.yarns.get(yid)
    expect(bleu.consumed).toEqual({ [pid]: 3 })
    expect(bleu.quantity).toBe(4)
  })

  it('« Corriger le stock » avec un nom vidé : rien n’est enregistré, on reste sur le formulaire', async () => {
    const { pid } = await seedDone()
    const w = mountBlock()
    await waitHydrated(w)
    await w.find('#name').setValue('')
    await typeQty(w, '12')
    await flushPromises()
    await fixBtn(w).trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 50))
    expect(nav.router.replace).not.toHaveBeenCalled()
    expect(nav.router.push).not.toHaveBeenCalled()
    expect((await db.projects.get(pid)).name).toBe('Pull torsadé')
  })

  it('champ vidé puis Enregistrer : rien ne change (jamais 0)', async () => {
    const { pid, yid } = await seedDone()
    const w = mountBlock()
    await waitHydrated(w)
    await typeQty(w, '5')
    await typeQty(w, '')
    await saveNow(w)
    const y = await db.yarns.get(yid)
    expect(y.consumed).toEqual({ [pid]: 3 })
    expect(y.quantity).toBe(4)
  })

  it('champ illisible (virgule seule) : rien ne change non plus', async () => {
    const { pid, yid } = await seedDone()
    const w = mountBlock()
    await waitHydrated(w)
    await typeQty(w, ',')
    await saveNow(w)
    const y = await db.yarns.get(yid)
    expect(y.consumed).toEqual({ [pid]: 3 })
    expect(y.quantity).toBe(4)
  })

  it('modifier deux fois (3 vers 5 puis 5 vers 3) redonne l\'état d\'origine', async () => {
    const { pid, yid } = await seedDone()
    const w = mountBlock()
    await waitHydrated(w)
    await typeQty(w, '5')
    await saveNow(w)
    expect((await db.yarns.get(yid)).quantity).toBe(2)
    await typeQty(w, '3')
    await saveNow(w)
    const y = await db.yarns.get(yid)
    expect(y.consumed).toEqual({ [pid]: 3 })
    expect(y.quantity).toBe(4)
  })

  it('laine supprimée entre le chargement et Enregistrer : ignorée sans erreur', async () => {
    const { pid, yid } = await seedDone()
    const w = mountBlock()
    await waitHydrated(w)
    await typeQty(w, '5')
    await db.yarns.delete(yid)
    // le store est la source de lecture : on le met au courant comme le ferait un autre écran
    const { useYarnsStore } = await import('@/stores/yarns')
    await useYarnsStore().load()
    await saveNow(w)
    expect(await db.yarns.get(yid)).toBeUndefined()
    expect((await db.projects.get(pid)).name).toBe('Pull torsadé')
  })

  it('le stock est relu à l\'enregistrement : un stock changé depuis le chargement n\'est pas écrasé', async () => {
    const { pid, yid } = await seedDone()
    const w = mountBlock()
    await waitHydrated(w)
    // un autre écran fait passer le stock de 4 à 10 pendant que celui-ci est ouvert
    const { useYarnsStore } = await import('@/stores/yarns')
    await useYarnsStore().update(yid, { quantity: 10 })
    await typeQty(w, '5')
    await saveNow(w)
    const y = await db.yarns.get(yid)
    expect(y.consumed).toEqual({ [pid]: 5 })
    expect(y.quantity).toBe(8) // 10 + 3 - 5, pas 4 + 3 - 5
  })

  it('valeur inchangée : la laine n\'est pas réécrite', async () => {
    const { pid, yid } = await seedDone()
    const w = mountBlock()
    await waitHydrated(w)
    await saveNow(w)
    const y = await db.yarns.get(yid)
    expect(y.consumed).toEqual({ [pid]: 3 })
    expect(y.quantity).toBe(4)
  })
})

describe('ProjectEditView : pause, outils liés', () => {
  it('avec un outil lié : le statut est déjà écrit dialogue ouvert, « Libérer » range les liens puis navigue', async () => {
    const tid = await db.tools.add({ type: 'needle', name: 'Aiguille' })
    const pid = await seedProject({ toolIds: [tid], kitPicks: [] })
    const w = mountEdit()
    await waitHydrated(w)
    await chip(w, 'pause').trigger('click')
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(w.findComponent(ToolParkingDialog).props('open')).toBe(true), { timeout: 10000 })
    // Non-blocage : le statut est parti avec l'enregistrement, sans attendre la réponse.
    expect((await db.projects.get(pid)).status).toBe('pause')
    expect(nav.router.replace).not.toHaveBeenCalled()
    await w.findComponent(ToolParkingDialog).vm.$emit('confirm', [])
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    const saved = await db.projects.get(pid)
    expect(saved.status).toBe('pause')
    expect(saved.toolIds).toEqual([])
    expect(saved.parkedTools).toEqual({ toolIds: [tid], kitPicks: [] })
  })

  it('sans outil lié : aucune question, le statut change et on navigue', async () => {
    const pid = await seedProject({ toolIds: [], kitPicks: [] })
    const w = mountEdit()
    await waitHydrated(w)
    await chip(w, 'pause').trigger('click')
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    expect(w.findComponent(ToolParkingDialog).props('open')).toBe(false)
    expect((await db.projects.get(pid)).status).toBe('pause')
  })

  async function seedParked() {
    const tid = await db.tools.add({ type: 'needle', name: 'Aiguille' })
    const pid = await seedProject({ status: 'pause', toolIds: [], kitPicks: [], parkedTools: { toolIds: [tid], kitPicks: [] } })
    return { tid, pid }
  }

  it('reprise (pause -> en cours) : statut déjà écrit, « Reprendre » relie l\'outil dans une seconde écriture', async () => {
    const { tid, pid } = await seedParked()
    const w = mountEdit()
    await waitHydrated(w)
    await chip(w, 'wip').trigger('click')
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(w.findComponent(ToolParkingDialog).props('open')).toBe(true), { timeout: 10000 })
    expect(w.findComponent(ToolParkingDialog).props('mode')).toBe('resume')
    expect((await db.projects.get(pid)).status).toBe('wip')
    expect((await db.projects.get(pid)).toolIds).toEqual([])
    expect(nav.router.replace).not.toHaveBeenCalled()
    await w.findComponent(ToolParkingDialog).vm.$emit('confirm', [`tool:${tid}`])
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    const saved = await db.projects.get(pid)
    expect(saved.toolIds).toEqual([tid])
    expect(saved.parkedTools ?? null).toBeNull()
  })

  it('reprise : « Pas maintenant » écrit parkedTools null et navigue', async () => {
    const { pid } = await seedParked()
    const w = mountEdit()
    await waitHydrated(w)
    await chip(w, 'wip').trigger('click')
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(w.findComponent(ToolParkingDialog).props('open')).toBe(true), { timeout: 10000 })
    await w.findComponent(ToolParkingDialog).vm.$emit('cancel')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    const saved = await db.projects.get(pid)
    expect(saved.status).toBe('wip')
    expect(saved.toolIds).toEqual([])
    expect(saved.parkedTools ?? null).toBeNull()
  })

  it('création : jamais de question de pause ni de reprise', async () => {
    nav.route.params = {}
    nav.route.query = {}
    const w = mountEdit()
    await waitHydrated(w)
    await w.find('#name').setValue('Nouveau')
    await chip(w, 'wip').trigger('click')
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalled(), { timeout: 10000 })
    expect(w.findComponent(ToolParkingDialog).props('open')).toBe(false)
  })

  it('statut inchangé (en pause, enregistrer) : aucune question de reprise', async () => {
    const tid = await db.tools.add({ type: 'needle', name: 'Aiguille' })
    const pid = await seedProject({ status: 'pause', toolIds: [], kitPicks: [], parkedTools: { toolIds: [tid], kitPicks: [] } })
    const w = mountEdit()
    await waitHydrated(w)
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: pid } }), { timeout: 10000 })
    expect(w.findComponent(ToolParkingDialog).props('open')).toBe(false)
  })
})

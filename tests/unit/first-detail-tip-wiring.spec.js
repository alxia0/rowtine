// Unitaire — CÂBLAGE de l'astuce sur les écrans où elle vit désormais (décision produit
// du 19/08/2026, prise en cours des travaux sur « avertissement d'import et file des messages »
// : l'astuce « n'a rien à voir avec l'étape d'import d'un patron »). Avant ce
// lot elle vivait sur les TROIS FICHES (projet, patron, laine) ; elle vit maintenant sur la
// fiche PROJET (inchangée) et sur les DEUX ÉCRANS DE LISTE (Bibliothèque, Stock) — jamais
// sur la fiche patron. La présence sur chaque écran pris isolément est prouvée par
// `first-detail-tip-bandeau-import.spec.js` (une pinia neuve par test) ; ce fichier-ci
// prouve en plus ce qu'un montage isolé ne peut pas voir : une astuce consommée sur UN
// écran ne réapparaît pas sur un AUTRE, dans la MÊME session.
//
// Montage réel des vues (pas d'inspection de source) : une garde qui lit le texte d'un
// fichier peut se contenter d'un commentaire et mentir. Le patron de montage est repris
// de back-to-top-wiring.spec.js, qui câble le même genre de composant transverse.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'

const nav = vi.hoisted(() => ({
  route: { name: 'stash', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import StashView from '@/views/StashView.vue'
import ProjectDetailView from '@/views/ProjectDetailView.vue'
import FirstDetailTip from '@/components/FirstDetailTip.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

async function seedPatternRecord() {
  return db.patterns.add({ name: 'Patron test', type: 'knitting' })
}
async function seedProjectRecord() {
  const patternId = await seedPatternRecord()
  return db.projects.add({ name: 'Projet test', technique: 'knitting', patternId })
}

const wrappers = []
// ⚠️ UNE SEULE Pinia par test : le dernier test monte DEUX vues à la suite et vérifie que
// la seconde ne remontre pas l'astuce. Avec une `createPinia()` par montage, chaque vue
// aurait son propre store et l'assertion passerait au vert sans rien prouver.
let pinia
function doMount(Component) {
  const w = mount(Component, { global: { plugins: [pinia, i18n] }, attachTo: document.body })
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

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  nav.route = { name: 'stash', params: {}, query: {} }
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

// ⚠️ Ce bloc monte la fiche PROJET et le STOCK, pas la Bibliothèque : la présence sur la
// Bibliothèque est prouvée par `first-detail-tip-bandeau-import.spec.js` (cf. l'en-tête).
// Ce qui se prouve ICI et nulle part ailleurs est la CONSOMMATION PARTAGÉE entre deux
// écrans d'une même session — le troisième test ci-dessous.
describe("l'astuce est posée sur la fiche projet et sur le Stock, et se consomme une seule fois pour tous", () => {
  it('fiche projet', async () => {
    const id = await seedProjectRecord()
    nav.route = { name: 'project', params: { id: String(id) }, query: {} }
    const w = doMount(ProjectDetailView)
    await settle()
    expect(w.findComponent(FirstDetailTip).exists()).toBe(true)
  })

  it('écran Stock : présente dès le montage, sans qu aucune fiche laine ne soit ouverte', async () => {
    // Avant ce lot, l'astuce n'était posée qu'à l'OUVERTURE d'une fiche laine
    // (`v-if="detailYarn != null"`) : ce mécanisme a disparu, elle est désormais posée dès
    // qu'on visite l'écran Stock lui-même — c'est le cœur de la décision produit.
    await db.yarns.add({ brand: 'Test', model: 'Laine', quantity: 1, grams: 50, lengthM: 100 })
    nav.route = { name: 'stash', params: {}, query: {} }
    const w = doMount(StashView)
    await settle()

    expect(w.findComponent(FirstDetailTip).exists()).toBe(true)
  })

  it("le Stock visité en PREMIER consomme l'astuce : le projet ouvert ensuite n'en montre plus", async () => {
    // L'ordre compte : la spec veut UNE astuce en tout, pas une par écran. Ce test prend
    // l'écran le moins évident (le Stock, qui a perdu sa condition d'ouverture) pour
    // prouver que la consommation reste bien partagée entre écrans très différents.
    const projectId = await seedProjectRecord()

    nav.route = { name: 'stash', params: {}, query: {} }
    const stash = doMount(StashView)
    await settle()
    // Portée par FirstDetailTip, JAMAIS `stash.findComponent(ConfirmDialog)` tout court :
    // StashView rend déjà YarnDetailDialog, ColorPickerDialog et YarnWeightHelp, et la
    // recherche renverrait le premier dialogue de l'arbre, pas forcément le nôtre.
    expect(stash.findComponent(FirstDetailTip).findComponent(ConfirmDialog).props('open')).toBe(true)
    await stash.findComponent(FirstDetailTip).findComponent(ConfirmDialog).vm.$emit('confirm')
    await settle()

    nav.route = { name: 'project', params: { id: String(projectId) }, query: {} }
    const projet = doMount(ProjectDetailView)
    await settle()
    // Le composant est bien posé sur la fiche projet, mais il ne s'ouvre pas.
    expect(projet.findComponent(FirstDetailTip).exists()).toBe(true)
    expect(projet.findComponent(FirstDetailTip).findComponent(ConfirmDialog).props('open')).toBe(false)
  })
})

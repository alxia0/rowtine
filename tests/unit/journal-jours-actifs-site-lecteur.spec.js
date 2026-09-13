// Unitaire — COUVERTURE du site 4/4 qui arme `lastWorkedAt` (§7ter), le suivi interactif
// du lecteur (ReaderView, contexte `project-read`). Voir tests/unit/journal-jours-actifs-sites.spec.js
// pour les sites 2 et 3 et l'explication du fichier séparé : le mock `vue-router` hoisté ci-dessous
// (repris de tests/unit/ReaderView.spec.js) est incompatible avec le vrai routeur utilisé là-bas.
//
// ⛔ Aucun de ces tests n'appelle `update({ lastWorkedAt })` : ce serait tester le goulot une
// quatrième fois. Chacun part du GESTE.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import { allActiveDays } from '@/db/active-days'
import { ymdLocal } from '@/utils/time-periods'

const nav = vi.hoisted(() => ({
  route: { name: 'project-read', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import ReaderView from '@/views/ReaderView.vue'

const AUJOURDHUI = () => ymdLocal(new Date())

// Fixture minimale : un patron d'une section à deux rangs et une taille (pour exercer la
// pastille de taille du site « choisir une taille n'inscrit rien »).
const FIX_READER = {
  sizeLabels: ['S', 'M'],
  sections: [
    {
      id: 's1', icon: '🧶', title: 'Section 1',
      steps: [
        { t: 'Monter m end.' }, // s1#0 (rang)
        { t: 'Rang 2 : tric.' }, // s1#1 (rang)
      ],
    },
  ],
}

async function seedProject() {
  const patternId = await db.patterns.add({ name: 'Patron test', type: 'knitting', reader: FIX_READER })
  const projectId = await db.projects.add({ name: 'Projet test', technique: 'knitting', patternId })
  nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
  return { patternId, projectId }
}

const wrappers = []
// M2 (revue, correction) : UNE seule instance pinia — celle active devient aussi celle
// injectée au montage, pour qu'un futur `useXxxStore()` côté test parle au même store que le
// composant. Recréée à chaque test dans `beforeEach`.
let pinia
function mountReader() {
  const w = mount(ReaderView, { global: { plugins: [pinia, i18n] }, attachTo: document.body })
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
async function monterLecteurProjet() {
  const { projectId } = await seedProject()
  const w = mountReader()
  await settle()
  return { w, projectId }
}

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  localStorage.clear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('journal des jours actifs — SITE 4 sur 4 : cocher un rang dans le suivi', () => {
  it("cocher un rang du lecteur inscrit le jour au journal", async () => {
    // Harnais repris de tests/unit/ReaderView.spec.js (contexte `project-read`, FIX_READER).
    // Le bouton de rang est `.rcheck` (ReaderView.vue:797) — un `role="checkbox"`.
    const { w } = await monterLecteurProjet()
    expect(w.findAll('.rcheck').length).toBeGreaterThan(0) // le rang est bien rendu : sinon test muet
    expect(await db.activeDays.count()).toBe(0)
    await w.findAll('.rcheck')[0].trigger('click')
    await settle()
    expect(await allActiveDays()).toEqual([AUJOURDHUI()])
  })

  it("choisir une taille n'est pas un geste de progression et n'inscrit RIEN", async () => {
    // `persist()` sans argument (ReaderView.vue:407, selectSize) : `worked` vaut false, donc pas
    // de `lastWorkedAt` dans le patch (writeSnap, ReaderView.vue:288). Contre-épreuve du test
    // précédent — sans elle, « le lecteur écrit au journal » pourrait vouloir dire « le lecteur
    // écrit TOUJOURS ». Le sélecteur de taille est `.szpill` (ReaderView.vue:597), pas `.rsize`
    // (vérifié dans le template le 11/08 : `.rsize` n'existe pas).
    const { w, projectId } = await monterLecteurProjet()
    expect(w.findAll('.szpill').length).toBeGreaterThan(0) // la pastille est bien rendue
    expect(await db.activeDays.count()).toBe(0)
    await w.findAll('.szpill')[0].trigger('click')
    await settle()
    // Témoin POSITIF (revue, I-2) : sans lui, `db.activeDays.count() === 0` ne distingue
    // pas « le geste a persisté sans inscrire le témoin » de « rien ne s'est produit du tout » (un
    // clic sans effet, ou une écriture pas encore atterrie, se lisent pareil). `writeSnap` écrit
    // `activeSize` dans le MÊME patch (ReaderView.vue:287) que celui qui aurait porté
    // `lastWorkedAt` : le voir changer prouve que le patch a bien été écrit.
    expect((await db.projects.get(projectId)).activeSize).toBe('S')
    expect(await db.activeDays.count()).toBe(0)
  })
})

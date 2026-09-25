// @vitest-environment jsdom
// Unitaire — COUVERTURE des quatre sites qui arment `lastWorkedAt`. Le journal des
// jours actifs est instrumenté en UN SEUL endroit (`projectsStore.update()`) : ce fichier prouve
// que les gestes d'interface passent bien par là. Le site 1 (`markWorked()` direct) est couvert
// dans tests/unit/journal-jours-actifs.spec.js.
//
// ⛔ Aucun de ces tests n'appelle `update({ lastWorkedAt })` : ce serait tester le goulot une
// quatrième fois. Chacun part du GESTE. C'est la leçon des travaux sur l'import .zip du 08/08 — une
// exigence portant sur plusieurs sites veut autant de tests que de sites.
//
// Le site 4 (ReaderView) est dans son propre fichier : tests/unit/journal-jours-actifs-site-lecteur.spec.js
// — le mock `vue-router` hoisté de ReaderView.spec.js est incompatible avec le vrai routeur
// utilisé ici (project/project-read réels, nécessaires pour monter ProjectDetailView).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/db'
import { allActiveDays } from '@/db/active-days'
import { ymdLocal } from '@/utils/time-periods'
import ProjectDetailView from '@/views/ProjectDetailView.vue'
import CounterCard from '@/components/CounterCard.vue'
import { createTestI18n, createTestRouter } from './helpers/i18n-router'

const i18n = createTestI18n()
const AUJOURDHUI = () => ymdLocal(new Date())

// M2 (revue, correction) : UNE seule instance pinia — celle active devient aussi celle
// injectée au montage (sinon un futur `useXxxStore()` côté test parlerait à un store différent
// de celui du composant). Recréée à chaque test.
let pinia
// M1 (revue, correction) : les `ProjectDetailView` montés fuyaient d'un test à l'autre
// (pas de démontage), ce qui nourrissait la contention visée par I-3 ci-dessous.
const wrappers = []

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  await db.activeDays.clear()
  await db.projects.clear()
  await db.patterns.clear()
  await db.counters.clear()
})
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

// `avecCompteur` : le compteur doit exister EN BASE avant le montage — `loadForProject` (appelé
// depuis l'onMounted de la fiche) ne le relirait pas s'il était ajouté après coup.
async function monterFiche(sections = [{ name: 'Corps', instructions: 'Rg 1\nRg 2' }], { avecCompteur } = {}) {
  const patternId = await db.patterns.add({ name: 'Écharpe', sections })
  const pid = await db.projects.add({ name: 'Mon écharpe', patternId, status: 'wip', readerState: {} })
  if (avecCompteur) await db.counters.add({ projectId: pid, name: 'Rangs', value: 7 })
  const router = createTestRouter([
    { path: '/project/:id', name: 'project', component: ProjectDetailView },
    { path: '/project/:id/read', name: 'project-read', component: { template: '<div/>' } },
  ])
  router.push(`/project/${pid}?tab=sections`)
  await router.isReady()
  const w = mount(ProjectDetailView, { global: { plugins: [router, i18n, pinia] } })
  wrappers.push(w)
  return { w, pid }
}

// `loadAll()` (onMounted) enchaîne plusieurs allers-retours IndexedDB (sections, compteurs,
// séances…) avant qu'un élément donné n'apparaisse dans le DOM, ou avant qu'une écriture déclenchée
// par un geste n'atterrisse. Une seule attente fixe suffit en isolation mais pas sous CONTENTION
// (suite complète, plusieurs fichiers de test en parallèle, cf. note « faux rouges sous contention »
// du projet — MESURÉ en revue, I-3, sur cette même fiche) : on interroge plutôt l'état
// jusqu'à ce que `verifier()` devienne vrai (elle peut être async), avec un plafond généreux.
// Généralisée (I-3) : sert au rendu (case, compteur) ET à l'écriture (journal, valeur du compteur).
async function attendreRendu(verifier) {
  for (let i = 0; i < 40; i++) {
    if (await verifier()) return
    await flushPromises()
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('journal des jours actifs — SITE 2 sur 4 : la case « section faite » de la fiche projet', () => {
  it("cocher une section inscrit le jour au journal", async () => {
    const { w } = await monterFiche()
    await attendreRendu(() => w.find('.rovw__done input').exists())
    expect(w.find('.rovw__done input').exists()).toBe(true) // la case existe : la suite mord vraiment
    expect(await db.activeDays.count()).toBe(0) // rien avant le geste
    await w.find('.rovw__done input').setValue(true)
    await attendreRendu(async () => (await db.activeDays.count()) > 0)
    expect(await allActiveDays()).toEqual([AUJOURDHUI()])
  })
})

describe('journal des jours actifs — SITE 3 sur 4 : avancer un compteur depuis la fiche projet', () => {
  it("bouger un compteur inscrit le jour au journal", async () => {
    const { w } = await monterFiche(undefined, { avecCompteur: true })
    await attendreRendu(() => w.findAllComponents(CounterCard).length > 0)
    expect(w.findAllComponents(CounterCard)).toHaveLength(1) // le compteur est bien rendu : sinon test muet
    expect(await db.activeDays.count()).toBe(0)
    // I-1 (revue, correction) : `CounterCard` émet TOUJOURS deux arguments
    // (`emit('set', props.counter.id, valeur)`, CounterCard.vue:16). Un `$emit('set', 1)` fabriqué
    // n'en passe qu'un ⇒ `setCounter(1, undefined)` → la valeur retombe à 0 (Number(undefined)||0)
    // au lieu d'avancer — le titre du test serait alors faux, et un `id` erroné laisserait le test
    // vert quand même (l'écriture échouerait silencieusement, mais `markWorked` partirait). On
    // passe donc par le VRAI bouton d'incrément. ⛔ Pas `.ccard__pm` : la classe matche AUSSI le
    // bouton « Diminuer » — sélectionner par l'aria-label humain (icounter.increase, cf. la
    // migration des glyphes +/− vers AppIcon) lève l'ambiguïté.
    const cc = w.findComponent(CounterCard)
    await cc.find('[aria-label="Augmenter"]').trigger('click')
    // `setCounter` (ProjectDetailView.vue:285) attend d'abord `countersStore.setValue`, PUIS
    // `projectsStore.markWorked` : on sonde sur le journal (la dernière écriture de la chaîne),
    // qui garantit que le compteur est déjà à jour au moment où on le lit.
    await attendreRendu(async () => (await db.activeDays.count()) > 0)
    // Témoin : le compteur a VRAIMENT avancé (7 → 8), pas seulement « le journal a été écrit ».
    expect((await db.counters.toArray())[0].value).toBe(8)
    expect(await allActiveDays()).toEqual([AUJOURDHUI()])
  })
})

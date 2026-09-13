// Les warnings d'un import PDF survivent au saut DIRECT vers la fiche
// patron (LocalPdfImportView n'affiche plus d'écran de revue) via le
// store transitoire import-report. PatternView les consomme au montage et les
// affiche en bandeau persistant, fermable — JAMAIS en snackbar, qui disparaîtrait
// seule (règle « jamais perdre d'info »).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { db, getSetting } from '@/db/db'
import i18n from '@/i18n'
import fr from '@/i18n/fr.json'
import { useImportReportStore } from '@/stores/import-report'
import { usePatternsStore } from '@/stores/patterns'
import FirstDetailTip from '@/components/FirstDetailTip.vue'

// Même approche que pattern-view-correct-entry.spec.js : mock vue-router pour
// contrôler route.params.id.
const nav = vi.hoisted(() => ({
  route: { params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import PatternView from '@/views/PatternView.vue'

async function seedPattern(overrides = {}) {
  const id = await db.patterns.add({ name: 'Pull', type: 'knitting', sizes: [], ...overrides })
  nav.route.params = { id: String(id) }
  nav.route.query = {}
  return id
}

const wrappers = []
// pinia explicite (jamais `setActivePinia` global) : useImportReportStore(pinia)
// doit résoudre EXACTEMENT le même store que celui que PatternView utilisera une
// fois monté avec ce pinia — sinon la préparation du test et le composant liraient
// deux stores différents.
function mountView(pinia = createPinia()) {
  const w = mount(PatternView, { global: { plugins: [pinia, i18n] } })
  wrappers.push(w)
  return { w, pinia }
}

async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r))
  await flushPromises()
}

beforeEach(async () => {
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('PatternView — bandeau warnings d’import', () => {
  it('warnings poussés dans le store pour CE patron → bandeau visible avec le titre et les messages', async () => {
    const id = await seedPattern()
    const pinia = createPinia()
    useImportReportStore(pinia).set(id, ['Section « Manches » incertaine', 'Taille M à vérifier'])
    const { w } = mountView(pinia)
    await settle()
    expect(w.text()).toContain(fr.pattern.importWarningsTitle)
    expect(w.text()).toContain('Section « Manches » incertaine')
    expect(w.text()).toContain('Taille M à vérifier')
  })

  it('aucun warning dans le store → pas de bandeau', async () => {
    await seedPattern()
    const { w } = mountView()
    await settle()
    expect(w.text()).not.toContain(fr.pattern.importWarningsTitle)
  })

  it('warnings dans le store pour un AUTRE patron → pas de bandeau ici, et le store les garde intacts (rien de perdu)', async () => {
    const pinia = createPinia()
    const otherId = 999999
    useImportReportStore(pinia).set(otherId, ['w-autre'])
    await seedPattern()
    const { w } = mountView(pinia)
    await settle()
    expect(w.text()).not.toContain('w-autre')
    expect(w.text()).not.toContain(fr.pattern.importWarningsTitle)
    expect(useImportReportStore(pinia).patternId).toBe(otherId)
    expect(useImportReportStore(pinia).warnings).toEqual(['w-autre'])
  })

  it('fermer le bandeau le fait disparaître (pas de snackbar auto-masquée : fermeture manuelle uniquement)', async () => {
    const id = await seedPattern()
    const pinia = createPinia()
    useImportReportStore(pinia).set(id, ['w1'])
    const { w } = mountView(pinia)
    await settle()
    expect(w.text()).toContain(fr.pattern.importWarningsTitle)
    const closeBtn = w.find('.iwarn__close')
    expect(closeBtn.exists()).toBe(true)
    await closeBtn.trigger('click')
    expect(w.text()).not.toContain(fr.pattern.importWarningsTitle)
    expect(w.text()).not.toContain('w1')
  })

  it('consume() vide le store au montage : une re-consultation de la même fiche ne réaffiche plus le bandeau', async () => {
    const id = await seedPattern()
    const pinia = createPinia()
    useImportReportStore(pinia).set(id, ['w1'])
    const { w: w1 } = mountView(pinia)
    await settle()
    expect(w1.text()).toContain('w1')

    // Le store a été consommé par le 1er montage (retour en arrière puis
    // re-entrée sur la même fiche, par ex.) : rien à réafficher.
    const { w: w2 } = mountView(pinia)
    await settle()
    expect(w2.text()).not.toContain('w1')
    expect(w2.text()).not.toContain(fr.pattern.importWarningsTitle)
  })

  it('les warnings sont consommés AVANT l’await de lecture du patron : capturés dès le montage même si la lecture IndexedDB est lente (fenêtre de perte à l’unmount fermée)', async () => {
    // Revue (point important) : si consume() était placé APRÈS
    // `await patternsStore.get(...)` et que l'utilisatrice quittait l'écran pendant
    // cette lecture (retour/geste), la continuation async draînerait quand même le
    // store — destructif et one-shot — SANS jamais rendre le bandeau → warnings
    // perdus définitivement. route.params.id étant dispo de façon synchrone au
    // montage, consume() doit s'exécuter en toute première ligne d'onMounted, avant
    // toute suspension. On le prouve en bloquant la lecture du patron : le store doit
    // déjà être vidé à l'instant SYNCHRONE qui suit le montage (aucun await ici).
    const id = await seedPattern()
    const pinia = createPinia()
    useImportReportStore(pinia).set(id, ['w1'])
    // Lecture du patron volontairement bloquée (ne résout jamais) : reproduit une
    // lecture lente / un écran quitté avant résolution.
    usePatternsStore(pinia).get = vi.fn(() => new Promise(() => {}))
    mountView(pinia)
    // PAS de settle() : on inspecte l'état juste après le montage synchrone.
    // Avec le bug (consume après l'await), get() jamais résolu ⇒ consume jamais
    // appelé ⇒ le store porterait encore ['w1']. Avec le correctif, consume a déjà
    // capturé et vidé le store avant l'await.
    expect(useImportReportStore(pinia).patternId).toBe(null)
    expect(useImportReportStore(pinia).warnings).toEqual([])
  })

  it('affiche le message qualité faible quand lowConfidence', async () => {
    const id = await seedPattern()
    const pinia = createPinia()
    useImportReportStore(pinia).set(id, [], true)
    const { w } = mountView(pinia)
    await settle()
    expect(w.text()).toContain(fr.pattern.importWarningsTitle)
    expect(w.text()).toContain(fr.pattern.importLowConfidence)
  })

  it('lowConfidence=false et aucun warning → pas de bandeau (non-régression)', async () => {
    const id = await seedPattern()
    const pinia = createPinia()
    useImportReportStore(pinia).set(id, [], false)
    const { w } = mountView(pinia)
    await settle()
    expect(w.text()).not.toContain(fr.pattern.importWarningsTitle)
    expect(w.text()).not.toContain(fr.pattern.importLowConfidence)
  })
})

// Changement du 19/08/2026 (décision produit, prise en cours de travaux) : l'astuce de balayage n'a
// « rien à voir avec l'étape d'import d'un patron ». Elle quitte entièrement cet écran — un
// correctif antérieur l'y avait fait céder devant le bandeau (prop `suppressed`) ; le correctif suivant
// retire la prop et le montage : ils n'ont plus d'objet, `PatternView` ne connaît plus
// `FirstDetailTip`. Ce test remplace les deux ci-dessus (qui prouvaient la transmission
// d'une prop désormais inexistante) par la garantie que la décision produit ne se
// défera pas toute seule à la prochaine modification de cet écran.
describe('l astuce de balayage a quitté la fiche patron (décision produit, 19/08)', () => {
  it('FirstDetailTip n est PAS monté sur PatternView', async () => {
    const pinia = createPinia()
    const id = await seedPattern()
    // Bandeau présent ou non, ça n'a plus d'incidence : l'astuce n'a plus de montage sur
    // cet écran. On le prouve avec un bandeau affiché ET un drapeau non posé, pour que
    // l'absence ne puisse s'expliquer ni par le bandeau ni par le drapeau.
    useImportReportStore(pinia).set(id, ['w1'], false)

    const { w } = mountView(pinia)
    await settle()

    // PRÉCONDITION : le bandeau est RÉELLEMENT rendu (sinon ce test ne dirait rien d'utile
    // sur la cohabitation des deux), et le drapeau n'est pas posé (sinon l'absence de
    // l'astuce s'expliquerait par lui, pas par la décision produit).
    expect(w.find('.iwarn').exists()).toBe(true)
    expect(await getSetting('swipeHintSeen')).toBeUndefined()

    expect(w.findComponent(FirstDetailTip).exists()).toBe(false)
  })
})

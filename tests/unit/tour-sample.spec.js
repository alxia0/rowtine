// @vitest-environment jsdom
// Identité du projet d'exemple utilisé par la visite guidée (lot du 23/09/2026) :
// `isTourCandidate` (pur, sans IO) et
// `ensureTourProject` (retrouve ou recrée le projet « bonnet »), sur une vraie base Dexie
// de test (fake-indexeddb, cf. tests/unit/setup.js), à l'image de seed-demo.spec.js.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db, getSetting, setSetting } from '@/db/db'
import { usePatternsStore } from '@/stores/patterns'
import { useProjectsStore } from '@/stores/projects'
import { recordSeededSamples } from '@/utils/seeded-samples'
import { loadDemoContent, DEMO_PATTERN_DEMO_ID } from '@/constants/demo'
import { isTourCandidate, ensureTourProject } from '@/utils/tour-sample'

// Patron minimal, deux tailles et une section à diagramme — même forme que le reader du
// bonnet (sizeLabels + sections[].chart + sections[].steps[].chart).
function chartPattern() {
  return {
    reader: {
      sizeLabels: ['S', 'M', 'L'],
      sections: [
        { id: 'bordure', steps: [{ t: 'Monter des mailles.' }] },
        { id: 'corps', chart: { rows: 24 }, steps: [{ t: 'Voir diagramme.' }, { chart: true }] },
      ],
    },
  }
}

describe('isTourCandidate', () => {
  const project = { id: 1 }

  it('vrai : projet + patron 2 tailles avec une section à diagramme', () => {
    expect(isTourCandidate(project, chartPattern())).toBe(true)
  })

  it('faux : ni projet ni patron', () => {
    expect(isTourCandidate(null, chartPattern())).toBe(false)
    expect(isTourCandidate(project, null)).toBe(false)
  })

  it('faux : patron « Taille unique » (une seule taille, pas de sélecteur à montrer)', () => {
    const p = chartPattern()
    p.reader.sizeLabels = ['Taille unique']
    expect(isTourCandidate(project, p)).toBe(false)
  })

  it('faux : une seule taille nommée (le sélecteur de taille n’aurait rien à montrer)', () => {
    const p = chartPattern()
    p.reader.sizeLabels = ['M']
    expect(isTourCandidate(project, p)).toBe(false)
  })

  it('faux : patron sans diagramme (aucune section ne porte chart + étape { chart: true })', () => {
    const p = chartPattern()
    p.reader.sections = [{ id: 'bordure', steps: [{ t: 'Monter des mailles.' }] }]
    expect(isTourCandidate(project, p)).toBe(false)
  })

  it('faux : une section porte chart mais aucune étape { chart: true } (diagramme non atteignable)', () => {
    const p = chartPattern()
    p.reader.sections = [{ id: 'corps', chart: { rows: 24 }, steps: [{ t: 'Voir diagramme.' }] }]
    expect(isTourCandidate(project, p)).toBe(false)
  })
})

describe('ensureTourProject', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.patterns.clear()
    await db.projects.clear()
    await db.settings.clear()
    await db.trash.clear()
  })

  // Sème patron + projet « en cours » comme le fait OnboardingView, sans enregistrer
  // `tourProjectId` (au contraire de la vraie écriture de l'écran) : au test d'y revenir
  // explicitement selon le cas qu'il exerce.
  async function seedBonnetProject() {
    const patternsStore = usePatternsStore()
    const projectsStore = useProjectsStore()
    const ids = await patternsStore.seedSamplesIfEmpty('fr')
    const content = await loadDemoContent('fr')
    const demoPattern = content.patterns.find((p) => p.demoId === DEMO_PATTERN_DEMO_ID)
    const demo = {
      name: demoPattern.name,
      patternId: ids[DEMO_PATTERN_DEMO_ID],
      sizes: demoPattern.sizes,
      activeSize: 'M',
    }
    const seeded = await projectsStore.seedExamplesIfEmpty('knitting', demo, content.projects, null)
    return { ids, seeded }
  }

  it('cas a : tourProjectId enregistré et toujours candidat → le renvoie tel quel, sans rien recréer', async () => {
    const { seeded } = await seedBonnetProject()
    await setSetting('tourProjectId', seeded.wipId)
    const patternsBefore = await db.patterns.count()
    const projectsBefore = await db.projects.count()

    const result = await ensureTourProject({ locale: 'fr', technique: 'knitting' })

    expect(result).toEqual({ id: seeded.wipId, created: false })
    expect(await db.patterns.count()).toBe(patternsBefore)
    expect(await db.projects.count()).toBe(projectsBefore)
  })

  it('cas b : sans tourProjectId enregistré, reprend le premier projet semé encore candidat et l’enregistre', async () => {
    const { ids, seeded } = await seedBonnetProject()
    // Installation onboardée avant cette fonctionnalité : seededSampleIds existe (fixé par
    // l'ancien semis), mais tourProjectId n'a jamais été écrit.
    await recordSeededSamples({ patterns: Object.values(ids), projects: [seeded.ideaId, seeded.wipId] })
    expect(await getSetting('tourProjectId')).toBeUndefined()

    const result = await ensureTourProject({ locale: 'fr', technique: 'knitting' })

    // Le projet « idée » (première entrée de seededSampleIds.projects) n'a pas de patron
    // lié ici (ideaDemo null) : il n'est pas candidat, le wip lui est bien préféré.
    expect(result).toEqual({ id: seeded.wipId, created: false })
    expect(await getSetting('tourProjectId')).toBe(seeded.wipId)
  })

  it('cas c : sans aucun candidat retrouvable, recrée le patron et le projet du bonnet', async () => {
    expect(await db.patterns.count()).toBe(0)
    expect(await db.projects.count()).toBe(0)

    const result = await ensureTourProject({ locale: 'fr', technique: 'crochet' })

    expect(result.created).toBe(true)
    expect(typeof result.id).toBe('number')
    const project = await db.projects.get(result.id)
    expect(project.status).toBe('wip')
    // Même comportement que seedExamplesIfEmpty côté demo : le projet démo bonnet est du
    // tricot, quelle que soit la technique choisie à l'onboarding.
    expect(project.technique).toBe('knitting')
    expect(project.activeSize).toBe('M')
    expect(project.readerState).toBeUndefined()
    expect(project.lastWorkedAt).toBe('')
    const pattern = await db.patterns.get(project.patternId)
    expect(pattern).toBeTruthy()
    expect(pattern.demoId).toBeUndefined() // clé de semis, jamais stockée (cf. seedSamplesIfEmpty)
    expect(isTourCandidate(project, pattern)).toBe(true)
    expect(await getSetting('tourProjectId')).toBe(result.id)
  })

  it('projet enregistré passé à la corbeille (supprimé) → recrée un nouveau projet, en RÉUTILISANT le patron survivant (pas de doublon en bibliothèque)', async () => {
    const projectsStore = useProjectsStore()
    const { ids, seeded } = await seedBonnetProject()
    // Même écriture que le VRAI semis (OnboardingView.seedExamples) : les trois patrons
    // semés entrent dans `seededSampleIds` — c'est ce registre, et pas seulement
    // `tourProjectId`, qui permet ici à (c) de retrouver le patron du bonnet plutôt que
    // d'en recréer un.
    await recordSeededSamples({ patterns: Object.values(ids), projects: [seeded.ideaId, seeded.wipId] })
    await setSetting('tourProjectId', seeded.wipId)
    const patternsBefore = await db.patterns.count()

    // Suppression en cascade (même mécanisme que le bouton « Supprimer » + corbeille) :
    // le projet quitte db.projects, seul un bundle en db.trash le garde récupérable — le
    // patron, lui, N'EST PAS une instance dédiée à ce projet (`ownerProjectId` non posé
    // par `seedSamplesIfEmpty`) : il reste en bibliothèque, intact.
    await projectsStore.remove(seeded.wipId)
    expect(await db.projects.get(seeded.wipId)).toBeUndefined()
    expect(await db.patterns.get(ids[DEMO_PATTERN_DEMO_ID])).toBeTruthy()

    const result = await ensureTourProject({ locale: 'fr', technique: 'knitting' })

    expect(result.created).toBe(true)
    expect(result.id).not.toBe(seeded.wipId)
    expect(await getSetting('tourProjectId')).toBe(result.id)
    // Le point du correctif : la bibliothèque ne gagne PAS un second bonnet.
    expect(await db.patterns.count()).toBe(patternsBefore)
    const project = await db.projects.get(result.id)
    expect(project.patternId).toBe(ids[DEMO_PATTERN_DEMO_ID])
  })

  it('bonnet recréé une première fois (cas c), puis supprimé À NOUVEAU : tourPatternId retrouve ce même patron recréé, sans passer par seededSampleIds', async () => {
    const projectsStore = useProjectsStore()

    const first = await ensureTourProject({ locale: 'fr', technique: 'knitting' })
    expect(first.created).toBe(true)
    const firstProject = await db.projects.get(first.id)
    const firstPatternId = firstProject.patternId
    expect(await db.patterns.count()).toBe(1)
    // `recreateTourProject` ne touche JAMAIS `seededSampleIds` (mémoire du semis
    // INITIAL uniquement, cf. son commentaire) : si la réutilisation marche malgré tout
    // au second appel ci-dessous, c'est bien `tourPatternId` (posé par `rememberPattern`)
    // qui l'a permise, pas ce registre — resté vide ici.
    const { getSeededSampleIds } = await import('@/utils/seeded-samples')
    expect(await getSeededSampleIds()).toEqual({ patterns: [], projects: [] })
    expect(await getSetting('tourPatternId')).toBe(firstPatternId)

    await projectsStore.remove(first.id)
    expect(await db.projects.get(first.id)).toBeUndefined()
    expect(await db.patterns.get(firstPatternId)).toBeTruthy() // le patron, lui, survit

    const second = await ensureTourProject({ locale: 'fr', technique: 'knitting' })

    expect(second.created).toBe(true)
    expect(second.id).not.toBe(first.id)
    expect(await db.patterns.count()).toBe(1) // toujours un seul bonnet en bibliothèque
    const secondProject = await db.projects.get(second.id)
    expect(secondProject.patternId).toBe(firstPatternId)
  })
})

// @vitest-environment jsdom
// Unitaire — revue (04/08/2026), constat Mineur 3 : aucun test ne couvrait
// le câblage OnboardingView → recordSeededSamples avant ce fichier. C'est le maillon PORTEUR
// des travaux sur la restauration inatteignable : `isDbRestorable` (src/backup/restore-service.js)
// s'appuie entièrement sur `getSeededSampleIds()` pour reconnaître « base neuve avec ses
// exemples » — si le semis omet d'enregistrer les bons ids (ou en enregistre de faux), le
// repli sûr d'`isDbRestorable` joue (« rien d'enregistré → PAS restaurable ») et TOUT le
// correctif de ces travaux devient inerte, EN SILENCE : aucun test existant ne l'aurait détecté,
// puisque tous ceux qui exercent `isDbRestorable`/`runRestore` appellent `recordSeededSamples`
// eux-mêmes avec des ids fabriqués (cf. tests/unit/backup-restore-service.spec.js), sans
// jamais passer par le VRAI semis d'OnboardingView.
//
// Ce test laisse le semis s'exécuter réellement (aucun mock sur seedSamplesIfEmpty /
// seedExamplesIfEmpty / recordSeededSamples), sur une vraie base Dexie (fake-indexeddb, cf.
// tests/unit/setup.js), puis vérifie que `getSeededSampleIds()` retrouve EXACTEMENT les ids
// des 3 patrons et 2 projets réellement écrits en base — pas des valeurs codées en dur, mais
// ceux lus dans db.patterns/db.projects après coup. Motif de montage repris de
// tests/unit/onboarding-locale-persist.spec.js (base réelle, clic réel, attente de la
// conséquence observable plutôt qu'un nombre fixe de flushPromises).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { db, getSetting } from '@/db/db'
import OnboardingView from '@/views/OnboardingView.vue'
import ProjectDetailView from '@/views/ProjectDetailView.vue'
import { getSeededSampleIds } from '@/utils/seeded-samples'
import { loadDemoContent, DEMO_PATTERN_IDEA_ID } from '@/constants/demo'
import { resolveCover } from '@/utils/project-cover'
import { ymdLocal } from '@/utils/time-periods'
import { createTestI18n, createTestRouter } from './helpers/i18n-router'

const i18n = createTestI18n()

async function mountOnboarding() {
  const router = createTestRouter([
    { path: '/', name: 'onboarding', component: OnboardingView },
    { path: '/home', name: 'home', component: { template: '<div/>' } },
  ])
  router.push('/')
  await router.isReady()
  const w = mount(OnboardingView, { global: { plugins: [router, i18n, createPinia()] } })
  await flushPromises()
  return w
}

// Monte la FICHE d'un projet semé, telle que l'utilisatrice la voit après l'accueil. Routes
// minimales exigées par ProjectDetailView (`router.push` vers le lecteur, l'édition, la
// correction de patron et l'accueil) : une route manquante ferait échouer le montage sur un
// avertissement de vue-router, pas sur l'assertion qu'on veut lire.
// ⚠️ `tab` compte : le nom du patron lié (`.patron-source`) est dans l'onglet « Infos », les
// sections en aperçu dans l'onglet « Sections » (celui par défaut). `ancre` est le sélecteur
// dont on attend l'apparition : attendre l'en-tête ne suffirait pas, `loadAll()` publie le
// projet avant le patron lié et l'assertion pourrait lire un rendu intermédiaire.
async function mountProjectDetail(projectId, tab, ancre) {
  const router = createTestRouter([
    { path: '/project/:id', name: 'project', component: ProjectDetailView },
    { path: '/project/:id/read', name: 'project-read', component: { template: '<div/>' } },
    { path: '/project/:id/edit', name: 'project-edit', component: { template: '<div/>' } },
    { path: '/pattern/:id/correct', name: 'pattern-correct', component: { template: '<div/>' } },
    { path: '/home', name: 'home', component: { template: '<div/>' } },
  ])
  router.push(`/project/${projectId}?tab=${tab}`)
  await router.isReady()
  const w = mount(ProjectDetailView, { global: { plugins: [router, i18n, createPinia()] } })
  // `loadAll()` enchaîne cinq lectures Dexie : on attend la conséquence observable, pas un
  // nombre fixe de flushPromises.
  await vi.waitFor(async () => {
    await flushPromises()
    if (!w.find(ancre).exists()) throw new Error(`fiche pas encore chargée (${ancre} absent)`)
  })
  return w
}

async function clickStart(w) {
  await w.findAll('button').find((b) => /Commence à/.test(b.text())).trigger('click')
  // Même mesure que onboarding-locale-persist.spec.js : `start()` enchaîne plusieurs
  // écritures Dexie dont un `import()` dynamique dans `seedExamples()`, un nombre fixe
  // de flushPromises() s'est révélé instable — on attend la conséquence observable.
  await vi.waitFor(async () => {
    const seeded = await getSeededSampleIds()
    if (!seeded.patterns.length && !seeded.projects.length) throw new Error('semis pas encore enregistré')
  })
}

describe('OnboardingView → recordSeededSamples : câblage réel du semis (maillon porteur du lot restauration)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR', 'fr'])
  })

  it("après le semis réel, getSeededSampleIds() retrouve exactement les 3 patrons et 2 projets créés en base", async () => {
    const w = await mountOnboarding()
    await clickStart(w)

    // Vérité de référence : ce qui est RÉELLEMENT en base après le semis, pas une valeur
    // supposée. Le patron libre (`builtin: true`, créé juste après par `ensureFreePattern`)
    // est écarté : il n'est jamais un exemple semé, cf. seeded-samples.js et
    // restore-service.js::isDbEmpty qui l'excluent au même titre.
    const patternsInDb = await db.patterns.filter((p) => !p.builtin && p.ownerProjectId == null).toArray()
    const projectsInDb = await db.projects.toArray()
    expect(patternsInDb).toHaveLength(3) // Bonnet Torsade, Écharpe Nuage, Sac Granny
    expect(projectsInDb).toHaveLength(2) // idée + en cours

    const seeded = await getSeededSampleIds()
    expect(new Set(seeded.patterns)).toEqual(new Set(patternsInDb.map((p) => p.id)))
    expect(new Set(seeded.projects)).toEqual(new Set(projectsInDb.map((p) => p.id)))
    expect(seeded.patterns).toHaveLength(3)
    expect(seeded.projects).toHaveLength(2)
  })

  // Lot du 23/09/2026 : `ensureTourProject` a besoin de retrouver le projet « en cours »
  // sans un aller-retour de recherche à chaque lancement de la visite — l'écran
  // l'enregistre donc dès le semis, une fois son id connu.
  it('enregistre tourProjectId sur le projet « en cours » qu’il vient de semer', async () => {
    const w = await mountOnboarding()
    await clickStart(w)

    const wip = (await db.projects.toArray()).find((p) => p.status === 'wip')
    expect(wip, 'le projet « en cours » doit exister').toBeTruthy()
    expect(await getSetting('tourProjectId')).toBe(wip.id)
  })

  // Complète le test ci-dessus par le CONSOMMATEUR réel de ce câblage : si le semis
  // n'enregistrait pas les bons ids, `isDbRestorable` (le garde-fou qui décide si la
  // restauration peut procéder) retomberait sur son repli sûr et refuserait à tort une
  // base ne contenant QUE les exemples semés — exactement le bug que ce lot corrige.
  it("le semis réel rend la base restaurable (isDbRestorable) sans qu'aucun id ne soit fabriqué à la main", async () => {
    const { isDbRestorable } = await import('@/backup/restore-service')
    const w = await mountOnboarding()
    await clickStart(w)

    expect(await isDbRestorable()).toBe(true)
  })

  // Les travaux sur les finitions du guide (constats §4) : le projet « idée » était
  // une coquille vide (un nom, « Projet exemple. »), alors que le second projet d'exemple est
  // riche parce qu'il est ADOSSÉ À UN PATRON. La seule voie qui lui donne une image sans
  // casser la restauration de sauvegarde est le RICOCHET : `resolveCover` retombe sur la 1re
  // photo du patron lié, et le lecteur lit les sections DU PATRON. Écrire dans
  // `project.photos` ou dans `db.sections` rendrait au contraire `isDbRestorable()` faux à
  // jamais sur une installation neuve — sinistre déjà vécu deux fois (04/08, 10/08).
  //
  // Ce test part du SEMIS RÉEL (aucun id fabriqué) et va jusqu'à la FICHE MONTÉE : c'est
  // l'écran qui doit montrer l'image, pas seulement le helper. Il tient aussi la garde
  // inverse — `photos` reste vide, `sections` reste vide, aucun témoin de geste.
  it("la fiche du projet « idée » affiche l'image et le patron de l'écharpe, sans une seule photo sur le projet", async () => {
    const w = await mountOnboarding()
    await clickStart(w)

    const echarpe = (await loadDemoContent('fr')).patterns.find((p) => p.demoId === DEMO_PATTERN_IDEA_ID)
    const projets = await db.projects.toArray()
    const idea = projets.find((p) => p.status === 'future')
    expect(idea, 'le projet « idée » (statut future) doit exister').toBeTruthy()
    const linked = await db.patterns.get(idea.patternId)

    // 1. Le rattachement : le patron lié est bien celui de l'écharpe, PAS le patron libre
    //    (que `migrateFreeProjects` lui donnait jusqu'ici) ni un patron manquant.
    expect(linked?.name).toBe(echarpe.name)
    expect(linked?.builtin).not.toBe(true)

    // 2. La couverture résolue est EXACTEMENT la photo du patron — comparée à l'identique et
    //    non à « non vide » : le patron libre pourrait un jour porter une image, et une
    //    assertion de non-vacuité survivrait alors pour la mauvaise raison.
    expect(resolveCover(idea, linked)).toBe(echarpe.photos[0])

    // 3. Les interdits de `isDbRestorable`, sur la ligne réellement écrite par le semis.
    expect(idea.photos).toEqual([])
    expect(await db.sections.count()).toBe(0)
    expect(idea.lastWorkedAt).toBe('')
    expect(idea.readerState).toBeUndefined()
    expect(idea.status).toBe('future')

    // 4. Les caractéristiques reprises du patron, et la date dérivée de MAINTENANT.
    expect(idea.needles).toEqual([{ mm: echarpe.needleMm, us: '' }])
    expect(idea.gaugeStitches).toBe(echarpe.gaugeStitches)
    expect(idea.gaugeRows).toBe(echarpe.gaugeRows)
    expect(idea.startedAt).toBe(ymdLocal(new Date())) // heure LOCALE depuis le 21/08
    expect(idea.notes.length).toBeGreaterThan(40) // une note parlante, plus « Projet exemple. »

    // 5. La FICHE elle-même, onglet « Infos » : une vraie vignette photo (ThumbImage ne rend
    //    `.thumb__img` que si la couverture est non vide, sinon c'est l'échantillon SVG de
    //    repli) et le nom du patron source affiché.
    const infos = await mountProjectDetail(idea.id, 'infos', '.patron-source')
    expect(infos.find('.thumb__img').exists(), 'la fiche doit porter une vraie vignette photo').toBe(true)
    expect(infos.find('.thumb__img').attributes('src')).toBe(echarpe.photos[0])
    expect(infos.find('.thumb__svg').exists()).toBe(false)
    expect(infos.find('.patron-source__name').text()).toBe(echarpe.name)
    // Démontage explicite : ProjectDetailView pose un écouteur `keydown` global et deux
    // observateurs (défilement, menu) que seul `onUnmounted` retire. Un wrapper laissé monté
    // à la fin du fichier fait surgir l'erreur au TEARDOWN de jsdom, attribuée à un AUTRE
    // fichier de test — un faux signal très coûteux à diagnostiquer.
    infos.unmount()

    // 6. Onglet « Sections » : les instructions arrivent par RICOCHET — autant de tuiles
    //    d'aperçu que de sections DU PATRON, alors que `db.sections` est resté vide (assertion
    //    3 ci-dessus). C'est précisément ce que la voie « pas de sections » devait préserver.
    const sections = await mountProjectDetail(idea.id, 'sections', '.rovw')
    expect(sections.findAll('.rovw')).toHaveLength(echarpe.reader.sections.length)
    sections.unmount()
  })
})

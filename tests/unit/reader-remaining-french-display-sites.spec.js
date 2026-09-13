// Correctifs de revue du lot 3b (T1/T2/T3) : sites d'affichage supplémentaires montraient
// encore du français en dur, en dehors du Lecteur déjà couvert par
// reader-single-size-i18n.spec.js et reader-section-intro-i18n.spec.js.
//
// IMPORTANT (revue) : un 4e chemin écrit « Taille unique » dans `pattern.sizes` en base —
// parse.js:101 (`sizes: [...sizeLabels]`) et merge-pattern-md.js:41 (`merged.sizes = md.sizes`,
// appelé par patron-md-sync.js:237) — antérieur à ce lot, PAS touché ici (stratégie du lot :
// on ne modifie jamais le chemin d'écriture). Seuls les sites d'AFFICHAGE qui lisent ce
// champ sont corrigés : PatternView.vue:126 et LibraryView.vue:176, avec le helper
// sizeLabelText déjà utilisé dans le Lecteur (T2).
//
// IMPORTANT (revue finale du 31/07/01-08) : la même chaîne se prolonge jusqu'au PROJET —
// project-fill.js:47 recopie `pattern.sizes` (donc « Taille unique » tel quel) dans
// `project.sizes` à la création du projet — et un 3e site d'affichage le rendait encore brut :
// ProjectDetailView.vue:442 (sélecteur de taille tricotée du projet, onglet Infos). Mesure qui
// a motivé la correction : 1 715 des 3 225 fichiers .md du corpus portent `sizes: Taille
// unique` — c'est de loin le français le plus probable à l'écran. Même solution (sizeLabelText,
// affichage uniquement) ; `project.activeSize === sz` (comparaison de sélection, ligne 442)
// reste sur la donnée brute, jamais sur le libellé traduit — cf. test dédié plus bas.
//
// MINEUR (revue) : deux sites supplémentaires affichaient le titre de section brut, donc
// « Présentation » en français quelle que soit la langue : ProjectDetailView.vue:497
// (aperçu des sections d'un projet) et CorrectionView.vue:317 (bandeau diagrammes), avec le
// helper sectionTitleLabel déjà utilisé dans le Lecteur (T3).
//
// Chaque test ci-dessous est un test PAR MUTATION : il assert à la fois la présence de la
// traduction ET l'absence du terme français brut — une régression qui reviendrait à
// `pattern.sizes.join(', ')`/`sec.title` nu ferait échouer l'assertion négative, pas
// seulement rater l'assertion positive.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { setActivePinia, createPinia } from 'pinia'
import es from '@/i18n/es.json'
import { db } from '@/db/db'

// Un seul mock de vue-router pour tout le fichier (PatternView, ProjectDetailView et
// CorrectionView en ont besoin ; LibraryView utilise un vrai routeur mémoire, plus bas).
const nav = vi.hoisted(() => ({
  route: { params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useRoute: () => nav.route,
    useRouter: () => nav.router,
    // CorrectionView.vue pose une garde onBeforeRouteLeave (dirty) : la vraie implémentation
    // exige un routeur injecté par un <router-view> réel, absent de ce montage isolé (même
    // stub que CorrectionView.spec.js). Sans ce stub : avertissement Vue Router, et surtout
    // le composant n'atteint jamais la fin de son onMounted dans certains cas.
    onBeforeRouteLeave: () => {},
  }
})

import PatternView from '@/views/PatternView.vue'
import ProjectDetailView from '@/views/ProjectDetailView.vue'
import CorrectionView from '@/views/CorrectionView.vue'
import LibraryView from '@/views/LibraryView.vue'

const wrappers = []
function track(w) {
  wrappers.push(w)
  return w
}

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  nav.route = { params: {}, query: {} }
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r))
  await flushPromises()
}

// --- IMPORTANT : PatternView.vue (fiche patron) ------------------------------------------
describe('PatternView — pattern.sizes affiché (4e chemin : sync patron.md, parse.js:101)', () => {
  it('en espagnol : "Taille unique" (écrit tel quel par le chemin de sync, non touché) s’affiche traduit, pas en français', async () => {
    // pattern.sizes = ['Taille unique'] simule exactement ce qu'écrit merge-pattern-md.js:41
    // après une synchro de patron.md (parse.js:101 : sizes: [...sizeLabels]), sans passer par
    // le filtre isSingleSize de l'import PDF/zip (T1) — c'est le chemin que la revue a relevé.
    const id = await db.patterns.add({ name: 'Écharpe', type: 'knitting', sizes: ['Taille unique'], reader: { sizeLabels: ['Taille unique'], sections: [] } })
    nav.route = { params: { id: String(id) }, query: {} }
    const esI18n = createI18n({ legacy: false, locale: 'es', messages: { es } })
    const w = track(mount(PatternView, { global: { plugins: [createPinia(), esI18n] } }))
    await settle()
    expect(w.find('.meta').text()).toContain('Talla única')
    expect(w.find('.meta').text()).not.toContain('Taille unique')
  })
})

// --- IMPORTANT : ProjectDetailView.vue (sélecteur de taille du projet) -------------------
describe('ProjectDetailView — project.sizes affiché sur la pastille de taille (5e chemin : project-fill.js)', () => {
  it('en espagnol : la pastille de taille montre "Talla única", pas "Taille unique", et reste sélectionnée (comparaison sur la donnée brute)', async () => {
    // project.sizes/activeSize = 'Taille unique' simule exactement ce qu'écrit
    // project-fill.js:47 en recopiant pattern.sizes à la création du projet.
    const projectId = await db.projects.add({
      name: 'P',
      technique: 'knitting',
      sizes: ['Taille unique'],
      activeSize: 'Taille unique',
    })
    nav.route = { params: { id: String(projectId) }, query: {} }
    const esI18n = createI18n({ legacy: false, locale: 'es', messages: { es } })
    const w = track(mount(ProjectDetailView, {
      global: {
        plugins: [createPinia(), esI18n],
        stubs: { StatusBadge: true, CounterCard: true, CounterForm: true },
      },
    }))
    await settle()
    await w.find('#tab-infos').trigger('click')
    await settle()

    const chip = w.find('.chips--sizes .chip')
    expect(chip.text()).toBe('Talla única')
    expect(chip.text()).not.toContain('Taille unique')
    // La sélection (chip--on) doit survivre à la traduction d'affichage : elle compare
    // project.activeSize à la valeur BRUTE de sz (ProjectDetailView.vue:442), jamais au
    // libellé traduit — sinon changer de langue désélectionnerait la taille active.
    expect(chip.classes()).toContain('chip--on')
  })
})

// --- IMPORTANT : LibraryView.vue (carte de bibliothèque) ---------------------------------
describe('LibraryView — p.sizes affiché sur la carte (même 4e chemin)', () => {
  it('en espagnol : la carte de bibliothèque montre "Talla única", pas "Taille unique"', async () => {
    await db.patterns.add({ name: 'Écharpe', type: 'knitting', sizes: ['Taille unique'], reader: { sizeLabels: [], sections: [] } })
    const esI18n = createI18n({ legacy: false, locale: 'es', messages: { es } })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'library', component: LibraryView },
        { path: '/pattern/:id', name: 'pattern', component: { template: '<div/>' } },
        { path: '/project/new', name: 'project-new', component: { template: '<div/>' } },
      ],
    })
    router.push('/')
    await router.isReady()
    const w = track(mount(LibraryView, { global: { plugins: [router, esI18n, createPinia()] } }))
    await settle()
    // `onMounted` attend désormais `settings.load()` (12 lectures Dexie séquentielles, lot
    // du 19/08/2026 — avertissement d'import) AVANT de lancer `patternsStore.load()` : un
    // seul tour d'horloge (`settle()`, un `setTimeout(r)` sans délai) ne suffit plus
    // toujours à laisser toute la chaîne aboutir sur IndexedDB simulée. Même correctif que
    // `tests/unit/LibraryView-counts.spec.js`/`library-excludes-instances.spec.js` — un
    // délai explicite plutôt qu'un troisième `settle()`, pour la même marge partout où ce
    // montage se répète — sans rien changer pour les autres vues de ce fichier (qui ne
    // dépendent pas de `settings`).
    await new Promise((r) => setTimeout(r, 50))
    await flushPromises()
    expect(w.find('.pcard__meta').text()).toContain('Talla única')
    expect(w.find('.pcard__meta').text()).not.toContain('Taille unique')
  })
})

// --- MINEUR : ProjectDetailView.vue (aperçu des sections d'un projet) --------------------
describe('ProjectDetailView — aperçu des sections : titre "Présentation" traduit', () => {
  it('en espagnol : la carte d’aperçu de section montre "Presentación", pas "Présentation"', async () => {
    const patternId = await db.patterns.add({
      name: 'Écharpe',
      type: 'knitting',
      reader: {
        sizeLabels: [],
        sections: [
          { id: 'presentation', kind: 'autre', title: 'presentation', steps: [{ t: 'Monter 80 mailles.' }] },
        ],
      },
    })
    const projectId = await db.projects.add({ name: 'P', technique: 'knitting', patternId })
    nav.route = { params: { id: String(projectId) }, query: {} }
    const esI18n = createI18n({ legacy: false, locale: 'es', messages: { es } })
    const w = track(mount(ProjectDetailView, {
      global: {
        plugins: [createPinia(), esI18n],
        stubs: { StatusBadge: true, CounterCard: true, CounterForm: true },
      },
    }))
    await settle()
    expect(w.find('.rovw__title').text()).toBe('Presentación')
  })
})

// --- MINEUR : CorrectionView.vue (bandeau « Diagrammes de ce patron ») -------------------
describe('CorrectionView — bandeau diagrammes : titre de section "Présentation" traduit', () => {
  it('en espagnol : la ligne du bandeau diagrammes montre "Presentación", pas "Présentation"', async () => {
    const patternId = await db.patterns.add({
      name: 'Écharpe',
      type: 'knitting',
      reader: {
        sizeLabels: [],
        sections: [
          { id: 'presentation', kind: 'autre', title: 'Présentation', steps: [{ t: 'Voir le diagramme :' }, { chart: true }], chart: { rows: 4, cols: 4, img: '/x.png' } },
        ],
      },
    })
    nav.route = { params: { id: String(patternId) }, query: {} }
    const esI18n = createI18n({ legacy: false, locale: 'es', messages: { es } })
    const w = track(mount(CorrectionView, { global: { plugins: [createPinia(), esI18n] } }))
    await settle()
    // La bande « Diagrammes de ce patron » est repliée par défaut (chartsOpen: false) :
    // il faut l'ouvrir pour que .chart-strip__list (et son titre de section) soit rendu.
    await w.find('.chart-strip__toggle').trigger('click')
    await settle()
    const label = w.find('.chart-strip__label')
    expect(label.exists()).toBe(true)
    expect(label.text()).toContain('Presentación')
    expect(label.text()).not.toContain('Présentation')
  })
})

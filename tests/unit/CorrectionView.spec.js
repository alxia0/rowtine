// @vitest-environment jsdom
// CorrectionView.spec.js — Task C2 : réécrit l'écran de correction post-import
// autour de l'éditeur zone-de-texte (ReaderTextEditor, Task C1) + reader-editable
// (readerToEditable/editableToReader, Phase B). Charge → édite (md) → enregistre
// (editableToReader(md, baseReader) → écriture DB). La bande « Diagrammes
// de ce patron » (sous l'éditeur) préserve la capacité interactif↔image du cluster
// C (reader-correction.js), keyed par empreinte image (robuste au renommage/
// réordre par l'édition texte — même clé que Task B2). Une ré-édition mi-projet
// (readerState porté par le PROJET, cf. project.readerState) passe par
// reconcileReaderState et signale toute perte via le dialogue de synchro existant
// (syncReportStore + SyncReportDialog), jamais silencieusement.
//
// Harnais (Task D, durcissement onSave) : base Dexie RÉELLE (fake-indexeddb, cf.
// tests/unit/setup.js) + vrais stores Pinia — PAS `createTestingPinia`. Motif : D1
// enveloppe l'écriture des projets liés ET du patron dans UNE transaction Dexie
// (`db.transaction('rw', db.projects, db.patterns, …)`, calquée sur
// `patron-md-sync.processFolder`) — les écritures ne passent donc plus par
// `projectsStore.update`/`patternsStore.update` (spiables via testingPinia) mais
// directement par `db.projects.update`/`db.patterns.update`. Les assertions
// portent sur l'état DB PERSISTÉ (`db.patterns.get`/`db.projects.get`), pas sur des
// espions de store : cette forme reste vraie que l'implémentation passe par le
// store ou par la transaction directe, donc prouve la non-régression du
// comportement observable (cf. patron-md-sync-integration.spec.js, ReaderView.spec.js,
// ProjectDetailView.spec.js — même motif ailleurs dans la suite).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import { db } from '@/db/db'
import { useProjectsStore } from '@/stores/projects'
import { usePatternsStore } from '@/stores/patterns'
import { useSnackbarStore } from '@/stores/snackbar'
import { useSyncReportStore } from '@/stores/sync-report'
import { WARNING_CODES } from '@/utils/pattern-md/warning-codes'
import { createTestI18n, makeTk } from './helpers/i18n-router'

// Mock vue-router : même approche que pattern-view-preview.spec.js (route + router
// mockés via vi.hoisted pour éviter la TDZ avec vi.mock hoisté).
const nav = vi.hoisted(() => ({
  route: { params: { id: '7' } },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  leaveGuard: null,
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
  // Garde de sortie : CAPTURE le callback enregistré par CorrectionView
  // (au lieu de le jeter) pour pouvoir l'invoquer directement en test — cf.
  // describe « garde modifs non enregistrées » plus bas. Pas besoin d'un vrai
  // routeur pour vérifier le comportement de la garde elle-même : la navigation
  // réelle (retour d'en-tête, geste, bouton physique Android) est couverte
  // end-to-end par tests/e2e/correction-discard-guard.spec.js.
  onBeforeRouteLeave: (cb) => {
    nav.leaveGuard = cb
  },
}))

const pickImageMock = vi.hoisted(() => vi.fn())
// `pickAndCropImage` est ré-exporté ici bien qu'AUCUN import de CorrectionView ne le
// réclame aujourd'hui : `vi.mock` remplace le module ENTIER, donc un futur import du vrai
// module échouerait de façon opaque (« No export named ») plutôt que sur la ligne fautive.
// Même parade que tests/unit/pattern-form-gallery.spec.js.
// `resizeDataUrl` n'est plus mocké ici (harmonisation du 22/09/2026) : CorrectionView.vue ne
// l'importe plus depuis ce module, le sélecteur système « Parcourir les fichiers » a disparu
// avec le menu popover, seule source qui le réclamait. Même surface de mock que
// tests/unit/pattern-form-gallery.spec.js pour ce même module.
vi.mock('@/utils/photo', () => ({
  pickAndCropImage: vi.fn().mockResolvedValue(null),
  pickImage: (...args) => pickImageMock(...args),
}))
const cropMock = vi.hoisted(() => vi.fn())
vi.mock('@/stores/cropper', () => ({ useCropperStore: () => ({ crop: cropMock }) }))

// CorrectionView importe désormais PdfPagePickerDialog (en defineAsyncComponent, cf. sa
// propre justification dans CorrectionView.vue) → PdfViewer → @/utils/pdf (pdfjs-dist), qui
// utilise `DOMMatrix`, absent de jsdom. Même mock que pdf-viewer.spec.js,
// pdf-page-picker-dialog.spec.js et pattern-form-gallery.spec.js (même composant) :
// évite de charger pdfjs-dist pour de vrai ici, qui ne teste jamais le rendu PDF lui-même
// (seulement le câblage crop après `pick`).
vi.mock('@/utils/pdf', () => ({
  renderPdfPageToDataUrl: vi.fn().mockResolvedValue('data:image/jpeg;base64,PAGE'),
  pdfPageCount: vi.fn().mockResolvedValue(1),
}))

import CorrectionView from '@/views/CorrectionView.vue'
import { readerToEditable, editableToReader } from '@/utils/pattern-md/reader-editable'
import { photoFileName } from '@/backup/naming'

const i18n = createTestI18n()

const tk = makeTk(i18n)

// ReaderTextEditor (C1) monte CM6 réel — non exploitable en jsdom (cf. sa propre
// spec, tests/unit/reader-text-editor.spec.js). On le remplace ici par un stub
// minimal qui respecte le même contrat observable (md initial affiché, emit
// update:md sur édition) : CorrectionView n'a pas besoin de connaître CodeMirror.
const ReaderTextEditorStub = {
  // `sizeLabels` est déclaré en prop (et non laissé en attribut de repli) pour que les tests
  // du point 5 puissent lire la valeur RÉELLE reçue par l'éditeur : c'est elle qui fixe le
  // nombre de colonnes émis par le bouton « Aide mémoire > Tailles ».
  // `imageActions` déclaré en prop (Task D) pour que `w.findComponent(ReaderTextEditorStub)
  // .props('imageActions')` (nouveau describe plus bas) lise la valeur RÉELLE reçue —
  // VTU ne résout `.props()` que sur les props déclarées du composant, sinon la valeur
  // atterrit en attribut de repli et resterait invisible aux tests.
  props: ['md', 'images', 'sizeLabels', 'imageActions'],
  emits: ['update:md', 'cursor-line', 'cursor-moved'],
  // `replaceLine`/`insertImageLine` reproduisent le contrat OBSERVABLE du vrai composant
  // (Task « renommer un diagramme » / insertion galerie 27/08/2026) : ils écrivent dans le
  // DOCUMENT, ce qui fait remonter le nouveau texte au parent par `update:md`. Le sens est
  // important — le parent est la DESTINATION, jamais la source (`value: props.md` au montage
  // seulement, cf. l'en-tête de ReaderTextEditor.vue) : un stub qui se contenterait de
  // renvoyer `props.md` retouché laisserait passer un CorrectionView qui écrirait `draftMd`
  // en direct, exactement le bug que ce contrat évite. Le curseur, lui, se simule par
  // `vm.$emit('cursor-line', n)` directement depuis le test (cf. setCursorLine plus bas) —
  // PAS une méthode `expose()`-ée : `global.stubs` (VTU) ne fait PAS suivre les méthodes
  // exposées jusqu'à `wrapper.vm` (constaté empiriquement), seul `$emit` traverse encore.
  // `replaceLine`/`insertImageLine` restent atteignables parce que CorrectionView.vue les
  // appelle via son PROPRE template ref (`editorRef.value`), jamais via `wrapper.vm`.
  setup(props, { expose, emit }) {
    expose({
      replaceLine(lineNumber, text) {
        const lines = String(props.md).split('\n')
        if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lines.length) return false
        lines[lineNumber - 1] = text
        emit('update:md', lines.join('\n'))
        return true
      },
      insertImageLine(lineNumber, mdPath) {
        const lines = String(props.md).split('\n')
        if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lines.length) return false
        // Indentée (2 espaces) : même forme que le vrai composant (ancrage sous une étape,
        // cf. imageAnchorLine/serialize.js — non indentée, l'image deviendrait un diagramme).
        lines.splice(lineNumber, 0, `  ![](${mdPath})`)
        emit('update:md', lines.join('\n'))
        return true
      },
    })
  },
  template: `<textarea class="rte-stub" :value="md" @input="$emit('update:md', $event.target.value)" />`,
}
const stubs = { AppHeader: true, ReaderTextEditor: ReaderTextEditorStub }

const CHART_DATA_URL = 'data:image/png;base64,CCCC'
const IMG_DATA_URL = 'data:image/png;base64,DDDD'

// Fixture proche de tests/unit/reader-editable.spec.js (chart réel qui round-trip,
// cf. makeChartSection) : (a) section-diagramme réelle, (b) section avec image
// ancrée sur texte (promouvable), (c) section texte simple. n=2 tailles (évite le
// cas lossy taille-unique, hors sujet ici).
// `chartTitle` par défaut = 'Diagramme 1' (tous les appels existants inchangés) ;
// un appelant peut le forcer à '' pour reproduire le cas « bloc sans titre connu »
// (cf. CORRECTION_CHART_OP_LOST vs. sa variante _NAMED, D5.2 plus bas).
function fixtureReader(chartTitle = 'Diagramme 1') {
  return {
    sizeLabels: ['S', 'M'],
    sections: [
      {
        id: 'diagramme-1',
        kind: 'diagramme',
        title: chartTitle,
        steps: [{ chart: true }],
        chart: { rows: 0, cols: 0, img: CHART_DATA_URL, readDir: '', reps: '', sizes: [], builtinLegend: false },
      },
      {
        id: 'encolure',
        kind: 'encolure',
        title: 'Encolure',
        // Forme RÉELLE du moteur : l'image est ancrée sur un step qui porte du
        // texte (cf. associate.js), jamais sur un step nu.
        steps: [{ t: 'Monter les mailles', imgs: [IMG_DATA_URL] }],
      },
      {
        id: 'corps',
        kind: 'corps',
        title: 'Corps',
        steps: [{ t: 'Tricoter au point mousse.' }],
      },
    ],
  }
}

// Seed base Dexie réelle (patron + projets liés) puis monte le composant avec un
// pinia dédié (créé + activé ICI, passé tel quel au mount) : `linkedProjects()`
// (CorrectionView) lit `projectsStore.projects` (état réactif, pas une requête
// DB), donc `projectsStore.load()` doit tourner AVANT le montage pour que le
// composant voie les projets seedés — mime la précondition de prod (App.vue
// charge les stores au boot, bien avant qu'un écran comme CorrectionView monte).
async function mountView({ pattern, projects = [] } = {}) {
  const thePattern = { id: 7, name: 'Pull', reader: fixtureReader(), ...pattern }
  await db.patterns.add(thePattern)
  for (const p of projects) await db.projects.add(p)

  const pinia = createPinia()
  setActivePinia(pinia)
  await useProjectsStore(pinia).load()

  nav.route.params = { id: String(thePattern.id) }
  const w = mount(CorrectionView, { global: { plugins: [pinia, i18n], stubs } })
  await flushPromises()
  return { w, pinia, pattern: thePattern }
}

function textarea(w) {
  return w.find('.rte-stub')
}
function findButtonByText(w, text) {
  return w.findAll('button').find((b) => b.text().includes(text))
}
// La bande « Diagrammes de ce patron » est repliée par défaut derrière
// une puce toggle (chartsOpen) — les lignes de bascule (justImage/followAsChart)
// ne sont dans le DOM qu'une fois dépliée.
async function openChartsStrip(w) {
  await w.find('.chart-strip__toggle').trigger('click')
  await flushPromises()
}

const UI_VALUE_BY_SHAPE_LABEL = {
  [fr.correction.chartShape.standard.label]: 'standard',
  [fr.correction.chartShape.radialSquare.label]: 'radial-square',
  [fr.correction.chartShape.radialCircle.label]: 'radial-circle',
  [fr.correction.chartShape.path.label]: 'path',
}

// Promotion d'une IMAGE DU TEXTE (section « Encolure » du fixture) — par le clic-image, seul
// chemin qui reste depuis les travaux « bandes du bas » (26/08/2026) : le panneau Diagrammes ne
// liste plus que de vrais diagrammes, donc plus aucun bouton « Suivre comme diagramme » n'y
// existe pour une image simple. Le comportement VISÉ par les tests qui appellent ce helper
// (une op 'promote' en attente sur 'encolure') est inchangé ; seul son point d'entrée bouge.
// `mdPath` réaliste (`img/photo-<hash>.<ext>`, cf. encolureImageLine plus bas pour le pourquoi
// détaillé) : la data-URL brute n'apparaît nulle part dans le texte édité.
async function promoteEncolureImage(w, shapeLabel = fr.correction.chartShape.standard.label) {
  const assetPath = `img/${photoFileName(IMG_DATA_URL, 0)}`
  const lineNumber = textarea(w).element.value.split('\n').findIndex((l) => l.includes(assetPath)) + 1
  w.findComponent(ReaderTextEditorStub)
    .props('imageActions')
    .setShape(lineNumber, assetPath, UI_VALUE_BY_SHAPE_LABEL[shapeLabel])
  await flushPromises()
}

// `flushPromises()` (un seul tick de macrotâche, cf. @vue/test-utils) ne suffit
// PAS à vider la chaîne d'awaits RÉELLE que `onSave` déclenche à travers
// fake-indexeddb (écriture patron + son `.load()` interne = plusieurs allers-
// retours IDB asynchrones, potentiellement encore plus après D1 avec la
// transaction + le double `.load()` de post-commit) — même piège documenté dans
// tests/unit/App.restore-offer.spec.js. On attend un signal OBSERVABLE que
// `onSave` a fini, plutôt qu'un nombre de ticks fixe : `router.back()` est la
// toute dernière instruction du chemin succès (avant ET après D1).
async function clickSaveAndSettle(w) {
  await findButtonByText(w, fr.correction.save).trigger('click')
  await vi.waitFor(() => expect(nav.router.back).toHaveBeenCalled(), { timeout: 10000 })
}

async function setCursorLine(w, n) {
  // `cursor-moved`, PAS `cursor-line` : c'est lui qui alimente `cursorLine` côté
  // CorrectionView.vue (cf. son commentaire — `cursor-line` porte le garde-fou de la
  // pastille diagramme, périmé pendant la frappe, jamais la bonne source pour ce test).
  w.findComponent(ReaderTextEditorStub).vm.$emit('cursor-moved', n)
  await flushPromises()
}

async function openGalleryStrip(w) {
  await w.find('.gallery-strip__toggle').trigger('click')
  await flushPromises()
}

// UN bouton, plus de popover (harmonisation du 22/09/2026, cf. PatternForm.vue et
// tests/unit/pattern-form-gallery.spec.js pour le même geste) : le clic ouvre directement
// `pickImage` (mocké dans ce fichier via `pickImageMock`), qui résout soit une data-URL
// classique, soit `'extra'` (choix PDF de la feuille standard, cf. addGalleryImage), soit
// `null` (annulation).
async function clickGalleryAdd(w) {
  await w.find('.gallery-strip__add').trigger('click')
  await flushPromises()
}

beforeEach(async () => {
  nav.route.params = { id: '7' }
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  nav.router.back.mockClear()
  nav.leaveGuard = null
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CorrectionView — charge/édite/enregistre (Step 1)', () => {
  it('onMounted charge le patron et passe md+images (readerToEditable) à ReaderTextEditor', async () => {
    const reader = fixtureReader()
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader } })
    const expected = readerToEditable(reader)
    expect(textarea(w).exists()).toBe(true)
    expect(textarea(w).element.value).toBe(expected.md)
  })

  it('éditer le md (update:md) met à jour le brouillon affiché', async () => {
    const { w } = await mountView()
    await textarea(w).setValue('## Corps\n- Un tout autre texte.\n')
    expect(textarea(w).element.value).toBe('## Corps\n- Un tout autre texte.\n')
  })

  it('« Enregistrer » persiste editableToReader(md, baseReader) sur le patron (DB), snackbar + retour', async () => {
    const reader = fixtureReader()
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader } })
    const snackbar = useSnackbarStore()
    const editedMd = readerToEditable(reader).md.replace('Tricoter au point mousse.', 'Tricoter au point de riz.')
    await textarea(w).setValue(editedMd)
    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(7)
    const expectedReader = editableToReader(editedMd, reader).reader
    expect(persisted.reader).toEqual(expectedReader)
    expect(persisted.reader.sections.find((s) => s.id === 'corps').steps[0].t).toBe('Tricoter au point de riz.')

    expect(snackbar.message).toBe(fr.correction.saved)
    expect(snackbar.visible).toBe(true)
    expect(nav.router.back).toHaveBeenCalledTimes(1)
  })

  it('une édition qui vide tout le md ne wipe pas le reader enregistré (garde mdFragmentToReader)', async () => {
    const reader = fixtureReader()
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader } })
    await textarea(w).setValue('')
    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(7)
    expect(persisted.reader.sections.length).toBe(3)
    expect(persisted.reader.sections.map((s) => s.id).sort()).toEqual(['corps', 'diagramme-1', 'encolure'])
  })

  // Point C (lot correction-ux) : `onMounted` lit la base (patternsStore.get) avant de
  // poser `pattern` — sans squelette, le `v-if="pattern"` du <main> laisse la page vide
  // sous l'en-tête pendant l'attente. On contrôle la résolution de `get` (Promise
  // JAMAIS résolue tant qu'on ne l'a pas fait explicitement) pour observer un état
  // INTERMÉDIAIRE réel : squelette présent AVANT résolution, absent après — pas
  // seulement les deux états stables qu'un simple mount() ne distinguerait pas.
  it('affiche un squelette de chargement tant que le patron n’a pas résolu, puis le retire', async () => {
    const reader = fixtureReader()
    const thePattern = { id: 7, name: 'Pull', reader }
    await db.patterns.add(thePattern)

    const pinia = createPinia()
    setActivePinia(pinia)
    await useProjectsStore(pinia).load()

    let resolveGet
    const pending = new Promise((resolve) => {
      resolveGet = resolve
    })
    vi.spyOn(usePatternsStore(pinia), 'get').mockReturnValue(pending)

    nav.route.params = { id: '7' }
    const w = mount(CorrectionView, { global: { plugins: [pinia, i18n], stubs } })
    await flushPromises()

    // AVANT résolution : squelette visible, éditeur (donc le vrai contenu) absent.
    expect(w.find('.skel').exists()).toBe(true)
    expect(textarea(w).exists()).toBe(false)

    resolveGet(thePattern)
    await flushPromises()

    // APRÈS résolution : squelette retiré, éditeur affiché.
    expect(w.find('.skel').exists()).toBe(false)
    expect(textarea(w).exists()).toBe(true)
  })

  it('patron introuvable → redirige vers la bibliothèque', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    nav.route.params = { id: '999' } // aucun patron seedé sous cet id
    mount(CorrectionView, { global: { plugins: [pinia, i18n], stubs } })
    await flushPromises()
    expect(nav.router.replace).toHaveBeenCalledWith({ name: 'library' })
    // La garde de sortie doit LAISSER PASSER cette redirection : `pattern` vaut encore
    // `null` à cet instant, et un `dirty()` qui lève (galleryDirty déréférençait
    // `pattern.value.gallery`) ANNULAIT le router.replace — utilisatrice bloquée sur un
    // écran vide (correctif de revue). Le vrai routeur appelle réellement cette garde ;
    // ici, `nav.leaveGuard` en a capturé le callback.
    expect(nav.leaveGuard()).toBe(true)
  })
})

describe('CorrectionView — bande diagrammes conservée (Step 2)', () => {
  it('expose un contrôle diagramme interactif ↔ juste une image pour la section-diagramme, replié par défaut', async () => {
    const { w } = await mountView()
    // Repliée par défaut : la puce affiche le compte, les lignes de
    // bascule ne sont pas dans le DOM.
    const toggle = w.find('.chart-strip__toggle')
    expect(toggle.exists()).toBe(true)
    // (1) et non (2) depuis les travaux « bandes du bas » (26/08/2026) : le fixture porte UN vrai
    // diagramme et UNE image du texte promouvable ('Encolure') — cette dernière n'est plus
    // comptée ni listée ici (elle se promeut en tapant dessus dans le texte).
    expect(toggle.text()).toContain(tk('correction.diagramsToggle', { count: 1 }))
    expect(findButtonByText(w, fr.correction.justImage)).toBeFalsy()

    await openChartsStrip(w)
    expect(w.text()).toContain(fr.correction.isChart)
    expect(findButtonByText(w, fr.correction.justImage)).toBeTruthy()
  })

  it('démoter le diagramme puis Enregistrer : le reader enregistré n’a plus le chart (image conservée), AUCUN faux avertissement (D5.2)', async () => {
    const reader = fixtureReader()
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader } })
    const syncReportStore = useSyncReportStore()
    await openChartsStrip(w)

    await findButtonByText(w, fr.correction.justImage).trigger('click')
    await flushPromises()
    // La démotion est IMMÉDIATE et RÉELLE (retour terrain 27/08/2026, actions immédiates) :
    // la section n'est plus un diagramme, elle sort donc du panneau tout de suite — pas de
    // bascule affichée « sur place » (comportement pré-Step-11, obsolète), cf. le describe
    // « le panneau Diagrammes ne liste que des diagrammes » pour la même assertion.
    expect(w.find('.chart-strip__toggle').exists()).toBe(false)

    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(7)
    const diag = persisted.reader.sections.find((s) => s.id === 'diagramme-1')
    expect(diag.chart).toBeUndefined()
    expect(diag.steps.some((s) => s.chart)).toBe(false)
    expect(diag.steps.some((s) => Array.isArray(s.imgs) && s.imgs.includes(CHART_DATA_URL))).toBe(true)

    // D5.2 : un toggle de diagramme RÉUSSI (l'empreinte matche bien une section
    // reparsée, pas de projet lié) ne doit produire AUCUN avertissement — le
    // dialogue de synchro ne doit pas s'ouvrir pour rien.
    expect(syncReportStore.report).toBeNull()
  })

  it('promouvoir l’image de la section « Encolure » en diagramme puis Enregistrer : chart présent, AUCUN faux avertissement (D5.2)', async () => {
    const reader = fixtureReader()
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader } })
    const syncReportStore = useSyncReportStore()
    await openChartsStrip(w)

    await promoteEncolureImage(w)

    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(7)
    const encolure = persisted.reader.sections.find((s) => s.id === 'encolure')
    expect(encolure.chart).toBeTruthy()
    expect(encolure.chart.img).toBe(IMG_DATA_URL)
    expect(encolure.steps.some((s) => s.chart)).toBe(true)

    expect(syncReportStore.report).toBeNull()
  })

  it('le toggle repose sur l’empreinte image (survit à un renommage de titre dans le texte édité)', async () => {
    const reader = fixtureReader()
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader } })

    // Renomme le titre de la section-diagramme DANS LE TEXTE (l'id recalculé au
    // reparse change en conséquence) avant de démoter via la bande (dérivée de
    // baseReader, donc affichée sous l'ANCIEN titre) puis d'enregistrer.
    const before = textarea(w).element.value
    const renamed = before.replace('## Diagramme 1 {chart}', '## Grille torsade {chart}')
    expect(renamed).not.toBe(before)
    await textarea(w).setValue(renamed)
    await openChartsStrip(w)

    await findButtonByText(w, fr.correction.justImage).trigger('click')
    await flushPromises()
    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(7)
    const renamedSection = persisted.reader.sections.find((s) => s.title === 'Grille torsade')
    expect(renamedSection).toBeTruthy()
    expect(renamedSection.chart).toBeUndefined()
    expect(renamedSection.steps.some((s) => Array.isArray(s.imgs) && s.imgs.includes(CHART_DATA_URL))).toBe(true)
  })

})

describe('CorrectionView — réconciliation workingReader/baseReader à l’Enregistrer', () => {
  // Restaurées et adaptées (mécanisme "workingReader muté en place" + réconciliation
  // par empreinte à l'Enregistrer, cf. reconcileWorkingReaderOnSave) — ex-D5.1/D5.2,
  // supprimées à tort quand le mécanisme pendingOps a été retiré (elles redeviennent
  // pertinentes : la perte qu'elles couvrent est réelle sous CE mécanisme aussi).
  it('un geste dont l’empreinte ne matche plus aucune section reparsée est SIGNALÉ, jamais silencieux', async () => {
    const reader = fixtureReader()
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader } })
    const syncReportStore = useSyncReportStore()
    await openChartsStrip(w)

    // Démote la section-diagramme (geste immédiat sur workingReader, keyed par
    // l'empreinte de CHART_DATA_URL).
    await findButtonByText(w, fr.correction.justImage).trigger('click')
    await flushPromises()

    // Retire ENSUITE la ligne image du diagramme DANS LE TEXTE (l'utilisatrice édite la
    // même ligne que celle visée par le geste) : au reparse frais (contre baseReader), la
    // section ne porte plus AUCUNE image exploitable -> son empreinte ne matche plus rien,
    // le geste ne peut plus être réconcilié.
    const before = textarea(w).element.value
    const chartLine = `![Diagramme](img/${photoFileName(CHART_DATA_URL, 0)})`
    expect(before).toContain(chartLine)
    const edited = before.replace(`${chartLine}\n\n`, '')
    expect(edited).not.toBe(before)
    await textarea(w).setValue(edited)

    await clickSaveAndSettle(w)

    // Le patron est bien enregistré (pas de crash), mais le geste perdu doit être surfacé
    // via le MÊME dialogue de synchro que les autres pertes — alors qu'il n'y a AUCUN projet
    // lié (reconcile neutre/vide) : ce sont bien les WARNINGS SEULS qui déclenchent le dialogue.
    const persisted = await db.patterns.get(7)
    expect(persisted).toBeTruthy()
    expect(syncReportStore.report).not.toBeNull()
    const report = syncReportStore.report
    expect(report.merged.length).toBe(1)
    expect(report.merged[0].warnings.length).toBeGreaterThan(0)
    expect(
      report.merged[0].warnings.some(
        (w) => w?.code === WARNING_CODES.CORRECTION_CHART_OP_LOST_NAMED && w.params?.blockTitle === 'Diagramme 1',
      ),
    ).toBe(true)
    // reconcile VIDE (aucun projet lié à réconcilier) : neutre sur tous les compteurs.
    expect(report.merged[0].reconcile).toEqual({
      doneKept: 0,
      doneLost: 0,
      countersKept: 0,
      countersLost: 0,
      sizeReset: false,
      chartRowsLost: 0,
      chartRepsLost: 0,
      chartFramesLost: 0,
      chartCurtainsLost: 0,
    })
  })

  // La branche « titre inconnu » (original?.title falsy -> CORRECTION_CHART_OP_LOST, SANS le
  // paramètre blockTitle) est celle où l'information est la plus pauvre, donc celle qu'il
  // faut surveiller le plus, pas le moins (règle cardinale « rien de ce qui remonte à
  // l'utilisatrice ne doit disparaître »). Même scénario que le test précédent, mais le
  // bloc-diagramme n'a PAS de titre (chartTitle='').
  it('un geste perdu sur un bloc SANS titre connu émet CORRECTION_CHART_OP_LOST, jamais la variante nommée', async () => {
    const reader = fixtureReader('')
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader } })
    const syncReportStore = useSyncReportStore()
    await openChartsStrip(w)

    await findButtonByText(w, fr.correction.justImage).trigger('click')
    await flushPromises()

    const before = textarea(w).element.value
    const chartLine = `![Diagramme](img/${photoFileName(CHART_DATA_URL, 0)})`
    expect(before).toContain(chartLine)
    const edited = before.replace(`${chartLine}\n\n`, '')
    expect(edited).not.toBe(before)
    await textarea(w).setValue(edited)

    await clickSaveAndSettle(w)

    expect(syncReportStore.report).not.toBeNull()
    const report = syncReportStore.report
    expect(report.merged.length).toBe(1)
    const warnings = report.merged[0].warnings
    expect(warnings.length).toBeGreaterThan(0)
    // Le code générique (sans paramètre) est bien émis...
    expect(warnings.some((w) => w?.code === WARNING_CODES.CORRECTION_CHART_OP_LOST)).toBe(true)
    // ... et JAMAIS la variante nommée : un titre vide ne doit pas fuiter comme
    // `blockTitle: ''` sous le code _NAMED (qui rendrait « du bloc «  » » à l'écran).
    expect(warnings.some((w) => w?.code === WARNING_CODES.CORRECTION_CHART_OP_LOST_NAMED)).toBe(false)
  })

  // IDEMPOTENCE aller-retour (premier arbitrage, point 2 — minimum de couverture attendu) :
  // promouvoir PUIS démouvoir (retour à l'état de base) doit laisser workingReader
  // structurellement identique à un reader jamais touché, ET chartsDirty()/dirty() doit
  // valoir false EN SESSION, avant tout Enregistrer — sans ça, `promoteImageToChart` et
  // `demoteChartToImage` (reader-correction.js) ne sont PAS des transforms inverses l'une de
  // l'autre au niveau structurel (step d'ancrage scindé en deux, `kind` non restauré, cf.
  // applyImageAction/sameChartSignature) : sans la restauration "retour exact à la base",
  // la garde de sortie se déclencherait pour rien après un aller-retour qui, du point de vue
  // de l'utilisatrice, n'a RIEN changé.
  it('promouvoir une image PUIS la démouvoir (retour à la base) : AUCUNE garde de sortie, patron inchangé après Enregistrer', async () => {
    const reader = fixtureReader()
    const { w, pattern } = await mountView({ pattern: { id: 7, name: 'Pull', reader } })
    await promoteEncolureImage(w)
    await openChartsStrip(w)
    expect(nav.leaveGuard()).toBe(false) // promotion bien en attente

    // Démote la MÊME section ('Encolure', désormais diagramme dans le panneau) : retour
    // exact à son état de base (jamais un diagramme dans le fixture).
    const rows = w.findAll('.chart-strip__row')
    const encolureRow = rows.find((r) => r.text().includes('Encolure'))
    expect(encolureRow).toBeTruthy()
    const demoteBtn = encolureRow.findAll('button').find((b) => b.text().includes(fr.correction.justImage))
    expect(demoteBtn).toBeTruthy()
    await demoteBtn.trigger('click')
    await flushPromises()

    // AUCUNE garde de sortie : l'aller-retour ramène workingReader à un état
    // structurellement identique à baseReader (chartsDirty() false).
    expect(nav.leaveGuard()).toBe(true)

    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(pattern.id)
    const encolure = persisted.reader.sections.find((s) => s.id === 'encolure')
    // Structurellement identique à la section d'origine (fixtureReader) : un seul step,
    // texte ET image ensemble, kind d'origine conservé — aucune trace de l'aller-retour.
    expect(encolure).toEqual({
      id: 'encolure',
      kind: 'encolure',
      title: 'Encolure',
      steps: [{ t: 'Monter les mailles', imgs: [IMG_DATA_URL] }],
    })
  })

  // C1 (revue) : « Envoyer vers la galerie » retire ENTIÈREMENT la section
  // "Diagramme 1" du fixture (elle ne porte que son step {chart:true}, cf.
  // demoteChartToGallery) — son id `diagramme-1` redevient donc libre dans workingReader.
  // `nextDiagramSection` (reader-correction.js) numérote/dédoublonne contre workingReader
  // SEUL : la promotion de galerie qui suit RÉÉMET ce même id `diagramme-1`. L'ancienne
  // déduction de nouveauté (`!baseIds.has(id)`) s'y trompait — `diagramme-1` EST dans
  // `baseIds` (c'était l'id de la section tout juste envoyée en galerie) — et classait à
  // tort la nouvelle section comme « pas neuve », la faisant passer par le chemin de
  // réconciliation par empreinte, où elle n'a AUCUNE correspondance dans le reparse frais
  // (jamais dans draftMd) → perdue silencieusement (aucune trace ni dans reader.sections,
  // ni dans pattern.gallery, seulement un avertissement qui se lit comme une confirmation).
  it('envoyer un diagramme vers la galerie PUIS promouvoir une image de galerie (id libéré réutilisé) : l’image promue n’est jamais perdue', async () => {
    const { w, pattern } = await mountView({ pattern: { gallery: [{ src: 'data:image/png;base64,GAL', page: 4, w: 10, h: 10 }] } })
    await openChartsStrip(w)
    await findButtonByText(w, fr.correction.sendToGallery).trigger('click') // Diagramme 1 → galerie, libère 'diagramme-1'
    await flushPromises()
    await openGalleryStrip(w)
    // GAL → diagramme : nextDiagramSection réémet l'id 'diagramme-1', tout juste libéré.
    await promoteGalleryImageViaStrip(w, 0, fr.correction.chartShape.radialSquare.label)

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    // L'image envoyée en galerie (CHART_DATA_URL) doit y être exactement une fois.
    expect(persisted.gallery.filter((g) => g.src === CHART_DATA_URL).length).toBe(1)
    // GAL, promue en diagramme, doit être RETROUVABLE comme diagramme après Enregistrer —
    // jamais perdue silencieusement, ni dupliquée en galerie.
    const galSections = persisted.reader.sections.filter((s) => s.chart?.img === 'data:image/png;base64,GAL')
    expect(galSections).toHaveLength(1)
    expect(galSections[0].chart.shape).toBe('radial-square')
    expect(persisted.gallery.some((g) => g.src === 'data:image/png;base64,GAL')).toBe(false)
  })
})

describe('CorrectionView — ré-édition mi-projet signale la perte (Step 3)', () => {
  function forkedPatternAndProject(reader) {
    const pattern = { id: 7, name: 'Pull', ownerProjectId: 42, reader }
    const project = {
      id: 42,
      patternId: 7,
      readerState: { size: 0, done: { 'corps#0': true }, counters: {}, chartRows: {}, chartReps: {}, chartFrames: {} },
    }
    return { pattern, project }
  }

  it('état transféré quand la ligne ne change pas : done conservé, pas de dialogue de perte', async () => {
    const reader = fixtureReader()
    const { pattern, project } = forkedPatternAndProject(reader)
    const { w } = await mountView({ pattern, projects: [project] })
    const syncReportStore = useSyncReportStore()

    // Édition qui NE touche PAS la ligne « corps » (seule l'encolure change).
    const edited = textarea(w).element.value.replace('Monter les mailles', 'Monter toutes les mailles')
    await textarea(w).setValue(edited)
    await clickSaveAndSettle(w)

    const persistedPattern = await db.patterns.get(7)
    expect(persistedPattern.reader).toBeTruthy()
    const persistedProject = await db.projects.get(42)
    expect(persistedProject.readerState.done['corps#0']).toBe(true)
    expect(syncReportStore.report).toBeNull()
  })

  it('renommer la ligne cochée fait perdre la coche → signalé (jamais silencieux), jamais planté', async () => {
    const reader = fixtureReader()
    const { pattern, project } = forkedPatternAndProject(reader)
    const { w } = await mountView({ pattern, projects: [project] })
    const syncReportStore = useSyncReportStore()

    // Édite la ligne « corps » (celle cochée dans project.readerState.done) :
    // le texte change, reconcileReaderState ne peut plus l'apparier par contenu.
    const edited = textarea(w).element.value.replace('Tricoter au point mousse.', 'Tricoter tout autrement.')
    await textarea(w).setValue(edited)
    await clickSaveAndSettle(w)

    const persistedProject = await db.projects.get(42)
    expect(persistedProject.readerState.done['corps#0']).toBeUndefined()

    // Perte signalée via le dialogue de synchro existant (jamais silencieuse).
    expect(syncReportStore.report).not.toBeNull()
    const report = syncReportStore.report
    expect(report.merged.length).toBe(1)
    expect(report.merged[0].reconcile.doneLost).toBeGreaterThan(0)
  })

  it('patron de bibliothèque (pas de fork) partagé par plusieurs projets : réconciliation en fan-out', async () => {
    const reader = fixtureReader()
    const pattern = { id: 7, name: 'Pull', reader } // pas d'ownerProjectId : patron de bibliothèque
    const projectA = {
      id: 10,
      patternId: 7,
      readerState: { size: 0, done: { 'corps#0': true }, counters: {}, chartRows: {}, chartReps: {}, chartFrames: {} },
    }
    const projectB = {
      id: 11,
      patternId: 7,
      readerState: { size: 0, done: { 'corps#0': true }, counters: {}, chartRows: {}, chartReps: {}, chartFrames: {} },
    }
    const { w } = await mountView({ pattern, projects: [projectA, projectB] })
    const syncReportStore = useSyncReportStore()

    const edited = textarea(w).element.value.replace('Tricoter au point mousse.', 'Tricoter tout autrement.')
    await textarea(w).setValue(edited)
    await clickSaveAndSettle(w)

    const persistedA = await db.projects.get(10)
    const persistedB = await db.projects.get(11)
    expect(persistedA.readerState.done['corps#0']).toBeUndefined()
    expect(persistedB.readerState.done['corps#0']).toBeUndefined()
    expect(syncReportStore.report).not.toBeNull()
    // Fan-out : les pertes des deux projets sont AGRÉGÉES dans le même rapport.
    expect(syncReportStore.report.merged[0].reconcile.doneLost).toBe(2)
  })

  // Deux appuis sur Enregistrer : une seule sauvegarde, un seul retour arrière.
  it('double appui sur Enregistrer : un seul router.back()', async () => {
    const reader = fixtureReader()
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader } })
    const btn = findButtonByText(w, fr.correction.save)
    btn.trigger('click')
    btn.trigger('click')
    await vi.waitFor(() => expect(nav.router.back).toHaveBeenCalled(), { timeout: 10000 })
    await flushPromises()
    await new Promise((r) => setTimeout(r, 50))
    expect(nav.router.back).toHaveBeenCalledTimes(1)
  })

  // Un projet sans taille retenue dans le suivi (size null) ne doit pas basculer sur la 1re taille.
  it('readerState sans taille : la taille reste non choisie après l’Enregistrer', async () => {
    const reader = fixtureReader()
    const pattern = { id: 7, name: 'Pull', reader }
    const project = { id: 10, patternId: 7, activeSize: 'M', readerState: { size: null, done: {}, counters: {} } }
    const { w } = await mountView({ pattern, projects: [project] })

    const edited = textarea(w).element.value.replace('Tricoter au point mousse.', 'Tricoter tout autrement.')
    await textarea(w).setValue(edited)
    await clickSaveAndSettle(w)

    const persisted = await db.projects.get(10)
    expect(persisted.readerState.size).toBe(null)
  })
})

// Task D (D1) : les écritures des projets liés ET du patron doivent être
// ATOMIQUES (une seule transaction Dexie). Preuve par mutation directe de la
// primitive DB (`db.patterns.update`) plutôt que d'une méthode de store : ce
// même espion discrimine les deux implémentations —
//  - AVANT le correctif (écritures séparées, projectsStore.update() puis
//    patternsStore.update()) : le projet est déjà persisté quand le patron
//    échoue → ce test ROUGIT (le readerState reconcilié survit à l'échec).
//  - APRÈS le correctif (une seule `db.transaction('rw', db.projects,
//    db.patterns, …)`) : l'échec du patron fait annuler TOUT, y compris le
//    projet déjà écrit dans la même transaction → ce test VERDIT.
//
// Task D (D-onSave) : `onSave` enveloppe la transaction dans un `try/catch` —
// l'échec est donc un comportement produit GÉRÉ (snackbar d'erreur, pas de
// navigation), pas juste une propriété DB interne. Ce catch consomme aussi la
// rejection à la source, donc plus d'unhandled rejection Dexie côté process.
describe('CorrectionView — atomicité de l’enregistrement (Task D, D1 + échec géré D-onSave)', () => {
  it('un échec de l’écriture patron ne laisse PAS le readerState du projet lié persisté (rollback), ne navigue pas, et affiche un snackbar d’erreur', async () => {
    const reader = fixtureReader()
    const pattern = { id: 7, name: 'Pull', ownerProjectId: 42, reader }
    const project = {
      id: 42,
      patternId: 7,
      readerState: { size: 0, done: { 'corps#0': true }, counters: {}, chartRows: {}, chartReps: {}, chartFrames: {} },
    }
    const { w } = await mountView({ pattern, projects: [project] })
    const snackbar = useSnackbarStore()

    // Édite la ligne cochée « corps » : reconcileReaderState VA changer le
    // readerState du projet (doneLost) avant l'écriture (échouée) du patron —
    // condition nécessaire pour que le test discrimine (si rien ne changeait,
    // une persistance séparée ET une transaction donneraient le même résultat).
    const edited = textarea(w).element.value.replace('Tricoter au point mousse.', 'Tricoter tout autrement.')
    await textarea(w).setValue(edited)

    // Simule l'échec (ex. quota IndexedDB dépassé) via le hook Dexie NATIF
    // `updating` plutôt qu'un `vi.spyOn(db.patterns, 'update')` : un spy
    // REMPLACE la méthode de la table et échappe à la zone de Promise interne
    // que Dexie tisse autour du callback de `db.transaction(...)` pour son
    // suivi PSD — cela laissait fuiter un faux `unhandledRejection` de process
    // (bruit, mais géré par Node/Vitest AVANT que Dexie n'ait fini d'aborter/
    // rollback la transaction). Le hook `updating`, lui, est un point
    // d'extension DOCUMENTÉ exécuté PAR Dexie DANS cette même zone : le jeter
    // déclenche l'abandon (rollback) de manière parfaitement supportée. Le
    // `try/catch` posé dans `onSave` (D-onSave) consomme ensuite la rejection
    // de `db.transaction(...)` à la source : plus d'artefact de Promise
    // orpheline côté test, même sans awaiter/catcher quoi que ce soit ici.
    let updateHookCalls = 0
    function failingUpdateHook() {
      updateHookCalls += 1
      throw new Error('quota dépassé (test)')
    }
    db.patterns.hook('updating', failingUpdateHook)

    // Chemin ÉCHEC : `router.back()` n'est JAMAIS atteint (cf. clickSaveAndSettle,
    // qui l'attend pour le chemin succès) — le signal OBSERVABLE de fin sur ce
    // chemin est désormais le snackbar d'erreur affiché par le `catch` de
    // `onSave`, dernière instruction avant son `return` anticipé.
    await findButtonByText(w, fr.correction.save).trigger('click')
    await vi.waitFor(() => expect(snackbar.visible).toBe(true), { timeout: 10000 })
    db.patterns.hook('updating').unsubscribe(failingUpdateHook)

    expect(updateHookCalls).toBeGreaterThan(0)
    expect(snackbar.message).toBe(fr.correction.saveError) // échec CLAIREMENT dit, jamais confondu avec un succès

    const persistedProject = await db.projects.get(42)
    expect(persistedProject.readerState.done['corps#0']).toBe(true) // ANCIEN état : rollback, pas de fausse coche perdue

    const persistedPattern = await db.patterns.get(7)
    expect(persistedPattern.reader).toEqual(reader) // ANCIEN reader : l'échec n'a RIEN appliqué

    expect(nav.router.back).not.toHaveBeenCalled() // pas de nav « succès » sur un échec
  })
})

describe('CorrectionView — i18n parité stricte fr/en (Step 6)', () => {
  it('correction.* : mêmes clés en fr et en (0 clé orpheline)', () => {
    expect(Object.keys(fr.correction).sort()).toEqual(Object.keys(en.correction).sort())
  })
})

// La garde de sortie elle-même (isDirty testé isolément dans
// tests/unit/correction-dirty.spec.js ; le chemin texte modifié -> dialogue ->
// Rester/Enregistrer est prouvé end-to-end par
// tests/e2e/correction-discard-guard.spec.js sur un vrai routeur). ICI, on
// vérifie que la garde WIRÉE dans CorrectionView (le callback réellement passé
// à onBeforeRouteLeave, capturé par le mock vue-router ci-dessus) réagit
// correctement à un geste diagramme sur `workingReader` (chartsDirty()) — seul
// chemin de `isDirty` que ni l'e2e ni le reste de ce fichier n'exerce à travers
// la garde réelle du composant (le mock d'origine se contentait de jeter le
// callback, cf. historique de ce fichier).
describe('CorrectionView — garde modifs non enregistrées', () => {
  it('rien de modifié : la garde laisse passer la navigation (return true)', async () => {
    await mountView()
    expect(nav.leaveGuard()).toBe(true)
  })

  it('geste diagramme immédiat (workingReader diffère de baseReader), texte inchangé : la garde bloque et ouvre le dialogue', async () => {
    const { w } = await mountView()
    await openChartsStrip(w)
    // Bascule via la bande « Diagrammes de ce patron » (workingReader), SANS toucher au texte.
    await promoteEncolureImage(w)

    expect(nav.leaveGuard()).toBe(false)
    await flushPromises()
    expect(w.text()).toContain(fr.correction.discardTitle)
  })

  it('texte modifié : la garde bloque ; « Quitter » confirme, et un nouvel appel de la garde laisse alors passer', async () => {
    const { w } = await mountView()
    await textarea(w).setValue(textarea(w).element.value + '\nUne ligne en plus.')

    expect(nav.leaveGuard()).toBe(false)
    await flushPromises()
    expect(w.text()).toContain(fr.correction.discardTitle)

    await findButtonByText(w, fr.correction.leave).trigger('click')
    await flushPromises()

    // confirmedLeave posé par onDiscardConfirm : une ré-invocation de la garde
    // (mime un 2ᵉ retour Android pendant que la navigation initiale aboutit)
    // laisse désormais passer sans rouvrir le dialogue.
    expect(nav.leaveGuard()).toBe(true)
  })
})

// Revue (I1) : le champ « Tailles » doit atteindre le PARSEUR, pas seulement
// l'enregistrement. Avant, le fragment était relu au nombre de colonnes d'ORIGINE
// (baseReader) : la table tout juste réémise au nouveau nombre de colonnes était rejetée
// (sizes.countMismatch) et rétrogradée en section de repli titrée `sizeTable-notes`. Le
// geste — corriger les tailles pour réparer une table cassée à l'import — échouait au
// premier essai.
describe('CorrectionView — le champ Tailles atteint le parseur en un seul passage (I1)', () => {
  const MD_TABLE_3 = `## Tailles {measurements}

| mesure | S | M | L |
|---|---|---|---|
| Tour de poitrine | 74 | 82 | 90 |

## Corps {body}

- Tricoter au point mousse.
`

  it('changer 2 tailles en 3 et retaguer la table : la rubrique est alimentée dès le premier enregistrement', async () => {
    const { w } = await mountView() // fixtureReader : sizeLabels ['S', 'M']
    await w.find('#correction-sizes').setValue('S, M, L')
    await textarea(w).setValue(MD_TABLE_3)
    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(7)
    expect(persisted.reader.sizeLabels).toEqual(['S', 'M', 'L'])
    const tailles = persisted.reader.reference.tabs.find((t) => t.id === 'tailles')
    expect(tailles.blocks[0].sizeTable.rows).toEqual([{ label: 'Tour de poitrine', values: ['74', '82', '90'] }])
    // Aucune rétrogradation en notes : la table n'a PAS été rejetée au passage.
    const notes = persisted.reader.sections.flatMap((sec) => (sec.steps || []).filter((st) => st.note))
    expect(notes).toEqual([])
  })
})

// Revue (I2) : chemin REEL du desalignement, verifie et non suppose — quand le
// fragment relu ne porte plus AUCUN bloc de reference, mdFragmentToReader (fragment.js)
// retombe sur `baseReader.reference`, donc sur les rangees d'AVANT le changement de tailles.
// Sans recadrage, le patron s'enregistre avec 2 en-tetes et des rangees a 3 valeurs :
// colonne orpheline dans la fiche, surlignage de la taille active decale.
describe('CorrectionView — les rangees du tableau des tailles suivent les tailles (I2)', () => {
  const readerWithSizeTable = () => ({
    ...fixtureReader(),
    sizeLabels: ['S', 'M', 'L'],
    reference: {
      tabs: [
        {
          id: 'tailles',
          label: 'Tableau des tailles',
          blocks: [{ h3: 'Tailles', sizeTable: { rows: [{ label: 'Tour de poitrine', values: ['90', '100', '110'] }] } }],
        },
      ],
      tiles: [],
    },
  })

  it('réduire les tailles recadre les rangées héritées de baseReader, sans perdre la valeur en trop', async () => {
    const { w } = await mountView({ pattern: { reader: readerWithSizeTable() } })
    await w.find('#correction-sizes').setValue('S, M')
    // Texte sans aucun bloc de référence : le reparse n'en produit pas, la référence de
    // baseReader (rangées à 3 valeurs) est reprise telle quelle par la garde anti-effacement.
    await textarea(w).setValue('## Corps {body}\n\n- Tricoter au point mousse.\n')
    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(7)
    expect(persisted.reader.sizeLabels).toEqual(['S', 'M'])
    const rows = persisted.reader.reference.tabs.find((t) => t.id === 'tailles').blocks[0].sizeTable.rows
    expect(rows).toEqual([{ label: 'Tour de poitrine', values: ['90', '100 110'] }])
  })
})

// Régression (revue qualité, 20/08/2026) : décision produit — un patron à taille
// unique porte `reader.sizeLabels = ['Taille unique']` MAIS `pattern.sizes = []`, pour
// ne jamais afficher un sélecteur de taille à un seul choix (menu déroulant à une seule
// entrée). Les trois chemins d'import (zip-import.js, pdf-import/assemble.js,
// LocalPdfImportView.vue:187) appliquent cette règle via `isSingleSize` — CorrectionView
// devait faire pareil à l'écriture, ce qu'il ne faisait pas au départ.
describe('CorrectionView — champ Tailles : sentinelle mono-taille préservée (revue)', () => {
  it('patron mono-taille NON touché : sizes reste vide (pas de sélecteur fantôme)', async () => {
    const reader = { ...fixtureReader(), sizeLabels: ['Taille unique'] }
    const pattern = { id: 7, name: 'Pull', reader, sizes: [] }
    const { w } = await mountView({ pattern })
    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(7)
    expect(persisted.reader.sizeLabels).toEqual(['Taille unique']) // sentinelle intacte
    expect(persisted.sizes).toEqual([]) // pas de sélecteur à un seul choix
  })

  // Revue (point 5) : la sentinelle « Taille unique » est une chaîne FR gelée EN
  // DONNÉE, pas un libellé d'interface. L'afficher dans un champ de saisie invitait à la
  // traduire — « Einheitsgröße » fait basculer isSingleSize à faux, donc `pattern.sizes` à
  // un seul choix : le sélecteur de taille fantôme que fee1cccd venait d'empêcher, rentré
  // par le clavier. Le champ part donc VIDE sur cette classe de patrons.
  it('patron mono-taille : le champ Tailles part vide (la sentinelle n est pas modifiable)', async () => {
    const reader = { ...fixtureReader(), sizeLabels: ['Taille unique'] }
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader, sizes: [] } })
    expect(w.find('#correction-sizes').element.value).toBe('')
    // Champ vide ≠ « aucune taille » : l'éditeur reçoit quand même la sentinelle, sinon le
    // bouton « Aide mémoire > Tailles » émettrait la table à zéro colonne.
    expect(w.findComponent(ReaderTextEditorStub).props('sizeLabels')).toEqual(['Taille unique'])
    // Et la garde « modifications non enregistrées » reste muette : rien n'a changé.
    expect(nav.leaveGuard()).toBe(true)
  })

  it('patron mono-taille : saisir de vraies tailles fonctionne normalement', async () => {
    const reader = { ...fixtureReader(), sizeLabels: ['Taille unique'] }
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader, sizes: [] } })
    await w.find('#correction-sizes').setValue('S, M, L')
    expect(nav.leaveGuard()).toBe(false) // le champ seul suffit à rendre l'écran « sale »
    await flushPromises()
    await findButtonByText(w, fr.correction.stay).trigger('click')
    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(7)
    expect(persisted.reader.sizeLabels).toEqual(['S', 'M', 'L'])
    expect(persisted.sizes).toEqual(['S', 'M', 'L'])
  })

  it('patron multi-tailles : sizes reste aligné sur reader.sizeLabels (comportement conservé)', async () => {
    const reader = fixtureReader() // sizeLabels: ['S', 'M']
    const pattern = { id: 7, name: 'Pull', reader, sizes: [] }
    const { w } = await mountView({ pattern })
    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(7)
    expect(persisted.sizes).toEqual(['S', 'M'])
  })
})

describe('CorrectionView — choix de type de diagramme (panneau + clic-image)', () => {
  function imageActionsOf(w) {
    return w.findComponent(ReaderTextEditorStub).props('imageActions')
  }

  // Le Rowtine-MD réel (readerToMdFragment/serialize.js) ne porte JAMAIS la data-URL en
  // clair sur une ligne image : chaque image est émise en `img/photo-<hash>.<ext>`
  // (nommage déterministe par CONTENU, photoFileName) — c'est ce chemin, jamais la
  // data-URL, que cm-editor.js transmet en `mdPath` à `imageActions.getInfo/setShape`
  // (cf. openImageActionsMenu, path = m[2] extrait de `![alt](path)`). On retrouve donc
  // la ligne ET on appelle les callbacks avec ce même chemin réaliste — jamais la
  // data-URL brute, qui n'apparaît nulle part dans le texte édité (vérifié : `md.includes
  // (IMG_DATA_URL)` est faux sur ce fixture, cf. tests/unit/reader-editable.spec.js pour
  // le même nommage d'assets).
  function encolureImageLine(md) {
    const assetPath = `img/${photoFileName(IMG_DATA_URL, 0)}`
    const lineNumber = md.split('\n').findIndex((l) => l.includes(assetPath)) + 1
    return { lineNumber, mdPath: assetPath }
  }

  it('promouvoir avec le type "Radial-carré" via le panneau : shape persisté à l’enregistrement', async () => {
    const reader = fixtureReader()
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader } })
    await openChartsStrip(w)
    await promoteEncolureImage(w, fr.correction.chartShape.radialSquare.label)
    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(7)
    const encolure = persisted.reader.sections.find((s) => s.id === 'encolure')
    expect(encolure.chart.shape).toBe('radial-square')
  })

  // Mirroir du test du chemin clic-image (cm-editor-image-menu.spec.js, « présélectionné
  // sur selectedShape ») pour le chemin PANNEAU (openPanelShapeMenu) : jusqu'ici seul le
  // clic-image vérifiait aria-checked sur l'item présélectionné du sous-popover.
  it('ouvrir « Changer le type » depuis le panneau présélectionne le type actuel (aria-checked)', async () => {
    const reader = fixtureReader() // 'diagramme-1' déjà chart, chart.shape absent → 'standard'
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader } })
    await openChartsStrip(w)
    await findButtonByText(w, fr.correction.changeType).trigger('click')
    await flushPromises()
    const items = [...document.querySelectorAll('.cm-menu-popover__item')]
    expect(items.length).toBe(5)
    expect(items[0].getAttribute('aria-checked')).toBe('true') // 'standard' présélectionné
    expect(items.slice(1).every((el) => el.getAttribute('aria-checked') === 'false')).toBe(true)
  })

  it('un diagramme déjà promu affiche « Changer le type » + « Juste une image » (2 actions) dans le panneau, et changer de type conserve le diagramme (pas de démotion)', async () => {
    const { w } = await mountView()
    await openChartsStrip(w)
    expect(findButtonByText(w, fr.correction.changeType)).toBeTruthy()
    expect(findButtonByText(w, fr.correction.justImage)).toBeTruthy()

    await findButtonByText(w, fr.correction.changeType).trigger('click')
    await flushPromises()
    const item = [...document.querySelectorAll('.cm-menu-popover__item')].find((el) =>
      el.textContent.includes(fr.correction.chartShape.path.label),
    )
    item.click()
    await flushPromises()

    // Toujours diagramme (pas basculé en image) : le panneau propose encore « Juste une image ».
    expect(findButtonByText(w, fr.correction.justImage)).toBeTruthy()
  })

  // Distinct du test « Radial-carré » plus haut (celui-là promeut une IMAGE, jamais encore
  // diagramme) : ici la section visée par `applyImageAction` (workingReader) EST DÉJÀ un
  // diagramme — `setChartType` route alors vers `setSectionChartShape`, jamais vers
  // `promoteImageToChart` (qui no-op délibérément sur une section déjà chart, cf. sa propre
  // garde `sectionIsChart(src)`). Seul le TYPE doit changer ici, jamais la structure (déjà
  // correcte) : couvre le chemin RÉEL du bouton « Changer le type » jusqu'à l'enregistrement.
  it('changer le type d’un diagramme DÉJÀ promu persiste le nouveau type (pas seulement en session)', async () => {
    const reader = fixtureReader()
    // Rangs/mailles non nuls (la fixture par défaut les pose à 0, valeur qui ne prouverait
    // rien face à un `delete`/reset silencieux) : setSectionChartShape (CorrectionView.vue)
    // ne doit patcher QUE `chart.shape`, jamais réinitialiser rows/cols au passage.
    const diagChart = reader.sections.find((s) => s.id === 'diagramme-1').chart
    diagChart.rows = 12
    diagChart.cols = 20
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader } })
    await openChartsStrip(w)
    await findButtonByText(w, fr.correction.changeType).trigger('click')
    await flushPromises()
    const item = [...document.querySelectorAll('.cm-menu-popover__item')].find((el) =>
      el.textContent.includes(fr.correction.chartShape.path.label),
    )
    item.click()
    await flushPromises()
    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(7)
    const diag = persisted.reader.sections.find((s) => s.id === 'diagramme-1')
    expect(diag.chart).toBeTruthy()
    expect(diag.chart.shape).toBe('path')
    // Un changement de TYPE ne doit pas effacer les rangs/mailles déjà saisis — c'est
    // justement ce que le bug corrigé en 7f094715 aurait pu regresser silencieusement.
    expect(diag.chart.rows).toBe(12)
    expect(diag.chart.cols).toBe(20)
  })

  it('getInfo(line, mdPath) : image éligible (1re image ancrée de « Encolure »), pas encore diagramme', async () => {
    const { w } = await mountView()
    const md = textarea(w).element.value
    const { lineNumber, mdPath } = encolureImageLine(md)
    const info = imageActionsOf(w).getInfo(lineNumber, mdPath)
    expect(info.enabled).toBe(true)
    expect(info.isChart).toBe(false)
    expect(info.primary.label).toBe(fr.correction.followAsChart)
    expect(info.demoteLabel).toBeNull()
    expect(info.selectedShape).toBe('standard')
    expect(info.shapeOptions.map((o) => o.value)).toEqual(['standard', 'radial-square', 'radial-circle', 'radial-hexagon', 'path'])
  })

  it("getInfo(line, mdPath) : image qui n'est pas la 1re image ancrée de sa section → enabled:false + hint", async () => {
    const { w } = await mountView()
    const info = imageActionsOf(w).getInfo(1, 'img/pas-la-bonne-image.png')
    expect(info.enabled).toBe(false)
    expect(info.primary.hint).toBe(fr.correction.chartMenuIneligible)
  })

  it('getInfo(line, mdPath) : null quand la ligne n’appartient à aucune section chart-éligible', async () => {
    const { w } = await mountView()
    const md = textarea(w).element.value
    const lineNumber = md.split('\n').findIndex((l) => l.includes('Tricoter au point mousse.')) + 1
    expect(imageActionsOf(w).getInfo(lineNumber, '')).toBeNull()
  })

  it('setShape(line, mdPath, "radial-circle") sur une image éligible applique le type choisi immédiatement', async () => {
    const { w } = await mountView()
    const md = textarea(w).element.value
    const { lineNumber, mdPath } = encolureImageLine(md)
    imageActionsOf(w).setShape(lineNumber, mdPath, 'radial-circle')
    await flushPromises()
    await openChartsStrip(w)
    expect(findButtonByText(w, fr.correction.changeType)).toBeTruthy()
    expect(findButtonByText(w, fr.correction.justImage)).toBeTruthy()
  })

  it('setShape sur une image NON éligible ne modifie rien', async () => {
    const { w } = await mountView()
    imageActionsOf(w).setShape(1, 'img/pas-la-bonne-image.png', 'path')
    await flushPromises()
    // « Ne modifie rien » observé sur l'état réellement porté par workingReader, pas sur un
    // libellé de bouton : le panneau compte DEUX rangées (diagramme-1 déjà chart, encolure
    // pas encore) — son bouton « Suivre comme diagramme » resterait affiché pour la ligne
    // encolure quoi qu'il arrive à ce no-op, une assertion sur ce libellé ne prouverait
    // donc rien. La garde de sortie, elle, reflète fidèlement workingReader.
    expect(nav.leaveGuard()).toBe(true)
  })

  it('demote(line, mdPath) sur l’image-empreinte d’un diagramme existant : no-op car mauvaise empreinte', async () => {
    const { w } = await mountView()
    imageActionsOf(w).demote(1, 'img/pas-la-bonne-image.png') // n'est pas l'empreinte -> no-op
    await flushPromises()
    await openChartsStrip(w)
    expect(findButtonByText(w, fr.correction.justImage)).toBeTruthy()
  })

  // Le test précédent (repris tel quel) n'exerce que la branche NO-OP de
  // `demoteImageAtLine` (empreinte non trouvée). Celui-ci couvre la branche qui tourne
  // réellement en production — empreinte trouvée sur la ligne image du diagramme —, seule
  // affectée par la résolution `fingerprintOfPath` (data-URL/chemin d'asset) retenue ici.
  it('demote(line, mdPath) sur la VRAIE ligne image du diagramme applique la démotion immédiatement', async () => {
    const { w } = await mountView()
    const md = textarea(w).element.value
    const assetPath = `img/${photoFileName(CHART_DATA_URL, 0)}`
    const lineNumber = md.split('\n').findIndex((l) => l.includes(assetPath)) + 1
    imageActionsOf(w).demote(lineNumber, assetPath)
    await flushPromises()
    expect(nav.leaveGuard()).toBe(false) // workingReader diffère désormais de baseReader
  })

  it('revenir exactement au type de base après un changement ne laisse workingReader dans AUCUN état modifié (optimisation existante préservée)', async () => {
    const reader = fixtureReader() // section 'diagramme-1' déjà chart, chart.shape absent (rangs standards)
    const { w } = await mountView({ pattern: { id: 7, name: 'Pull', reader } })
    await openChartsStrip(w)
    await findButtonByText(w, fr.correction.changeType).trigger('click')
    await flushPromises()
    const item = [...document.querySelectorAll('.cm-menu-popover__item')].find((el) =>
      el.textContent.includes(fr.correction.chartShape.standard.label),
    )
    item.click()
    await flushPromises()

    // Retour à l'état de base (déjà "standard") : la garde de sortie ne doit PAS se déclencher
    // pour ce seul geste (workingReader reste structurellement identique à baseReader).
    expect(nav.leaveGuard()).toBe(true)
  })
})

// Sous-popover de type, ouvert depuis une vignette de la bande Galerie — MÊME mécanisme
// que le sous-popover du panneau Diagrammes (openPanelShapeMenu), même 4 options.
async function promoteGalleryImageViaStrip(w, rowIndex = 0, shapeLabel = fr.correction.chartShape.standard.label) {
  await w.findAll('.gallery-strip__promote')[rowIndex].trigger('click')
  await flushPromises()
  const item = [...document.querySelectorAll('.cm-menu-popover__item')].find((el) => el.textContent.includes(shapeLabel))
  item.click()
  await flushPromises()
}

describe('CorrectionView — galerie du patron (ajout/suppression, sans promotion)', () => {
  beforeEach(() => {
    pickImageMock.mockReset()
  })

  it('la bande Galerie est toujours visible (même patron sans image de galerie), avec un bouton d\'ajout', async () => {
    const { w } = await mountView({ pattern: { gallery: [] } })
    expect(w.find('.gallery-strip__toggle').exists()).toBe(true)
    await openGalleryStrip(w)
    expect(w.find('.gallery-strip__add').exists()).toBe(true)
  })

  it('affiche une vignette par image de galerie du patron', async () => {
    const { w } = await mountView({ pattern: { gallery: [{ src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 }] } })
    await openGalleryStrip(w)
    expect(w.findAll('.gallery-strip__img')).toHaveLength(1)
  })

  it('ajoute une image (pickImage) : nouvelle vignette, persistée dans pattern.gallery après Enregistrer', async () => {
    pickImageMock.mockResolvedValue('data:image/png;base64,NEW')
    const { w, pattern } = await mountView({ pattern: { gallery: [] } })
    await openGalleryStrip(w)
    await clickGalleryAdd(w)
    expect(w.findAll('.gallery-strip__img')).toHaveLength(1)

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    expect(persisted.gallery).toEqual([{ src: 'data:image/png;base64,NEW', page: 0, w: 0, h: 0 }])
  })

  it('supprime une image : disparaît de la bande, pattern.gallery réduit après Enregistrer', async () => {
    const { w, pattern } = await mountView({
      pattern: { gallery: [
        { src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 },
        { src: 'data:image/png;base64,B', page: 2, w: 10, h: 10 },
      ] },
    })
    await openGalleryStrip(w)
    await w.findAll('.gallery-strip__del')[0].trigger('click')
    await flushPromises()
    expect(w.findAll('.gallery-strip__img')).toHaveLength(1)

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    expect(persisted.gallery).toEqual([{ src: 'data:image/png;base64,B', page: 2, w: 10, h: 10 }])
  })

  it('supprime l\'image de couverture : coverIndex recalé à 0 après Enregistrer', async () => {
    const { w, pattern } = await mountView({
      pattern: { coverIndex: 1, gallery: [
        { src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 },
        { src: 'data:image/png;base64,B', page: 2, w: 10, h: 10 },
      ] },
    })
    await openGalleryStrip(w)
    await w.findAll('.gallery-strip__del')[1].trigger('click') // retire B, la couverture (coverIndex: 1)
    await flushPromises()

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    expect(persisted.coverIndex).toBe(0)
  })

  it('supprime une image AVANT la couverture : coverIndex décrémenté d\'un cran après Enregistrer', async () => {
    const { w, pattern } = await mountView({
      pattern: { coverIndex: 2, gallery: [
        { src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 },
        { src: 'data:image/png;base64,B', page: 2, w: 10, h: 10 },
        { src: 'data:image/png;base64,C', page: 3, w: 10, h: 10 },
      ] },
    })
    await openGalleryStrip(w)
    await w.findAll('.gallery-strip__del')[0].trigger('click') // retire A, avant la couverture (C, coverIndex: 2)
    await flushPromises()

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    expect(persisted.coverIndex).toBe(1)
    expect(persisted.gallery.map((g) => g.src)).toEqual(['data:image/png;base64,B', 'data:image/png;base64,C'])
  })

  it('supprime une image APRÈS la couverture : coverIndex inchangé après Enregistrer', async () => {
    const { w, pattern } = await mountView({
      pattern: { coverIndex: 0, gallery: [
        { src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 },
        { src: 'data:image/png;base64,B', page: 2, w: 10, h: 10 },
      ] },
    })
    await openGalleryStrip(w)
    await w.findAll('.gallery-strip__del')[1].trigger('click') // retire B, après la couverture (A, coverIndex: 0)
    await flushPromises()

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    expect(persisted.coverIndex).toBe(0)
  })

  it('Annuler (leave sans Enregistrer) ne persiste aucun changement de coverIndex', async () => {
    const { w, pattern } = await mountView({
      pattern: { coverIndex: 1, gallery: [
        { src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 },
        { src: 'data:image/png;base64,B', page: 2, w: 10, h: 10 },
      ] },
    })
    await openGalleryStrip(w)
    await w.findAll('.gallery-strip__del')[1].trigger('click') // retirerait la couverture, si persisté
    await flushPromises()
    // Ne clique PAS Enregistrer : équivalent à une navigation confirmée par "Quitter".
    w.unmount()
    const persisted = await db.patterns.get(pattern.id)
    expect(persisted.coverIndex).toBe(1)
  })

  it('dirty()/garde de sortie déclenchée par un changement de galerie SEUL (texte et tailles inchangés)', async () => {
    pickImageMock.mockResolvedValue('data:image/png;base64,NEW')
    const { w } = await mountView({ pattern: { gallery: [] } })
    expect(nav.leaveGuard()).toBe(true)
    await openGalleryStrip(w)
    await clickGalleryAdd(w)
    expect(nav.leaveGuard()).toBe(false)
  })

  it('Annuler (leave sans Enregistrer) ne persiste aucun changement de galerie', async () => {
    pickImageMock.mockResolvedValue('data:image/png;base64,NEW')
    const { w, pattern } = await mountView({ pattern: { gallery: [] } })
    await openGalleryStrip(w)
    await clickGalleryAdd(w)
    // Ne clique PAS Enregistrer : le composant est simplement démonté (équivalent à
    // une navigation confirmée par "Quitter") — rien n'a jamais été écrit en base.
    w.unmount()
    const persisted = await db.patterns.get(pattern.id)
    expect(persisted.gallery ?? []).toEqual([])
  })
})

// Insertion d'une image de galerie DANS LE TEXTE (retour terrain 27/08/2026, distinct de
// « Suivre comme diagramme ») : contrairement à la promotion (pendingGalleryPromotions,
// appliquée seulement à l'Enregistrer), ce geste écrit IMMÉDIATEMENT dans draftMd (comme
// une frappe). Une image ne peut s'ancrer QUE sous un rang/étape existant (indentée, collée
// dessous) — non indentée elle deviendrait un diagramme, orpheline elle serait perdue en
// silence (cf. imageAnchorLine, step-line.js) : le bouton reste désactivé tant que le
// curseur n'a aucun rang au-dessus de lui dans la section.
describe('CorrectionView — insérer une image de galerie dans le texte', () => {
  beforeEach(() => {
    pickImageMock.mockReset()
  })

  it('désactivé par défaut (curseur au tout début du texte, aucun rang au-dessus)', async () => {
    const { w } = await mountView({ pattern: { gallery: [{ src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 }] } })
    await openGalleryStrip(w)
    expect(findButtonByText(w, fr.correction.insertIntoText).attributes('disabled')).not.toBeUndefined()
  })

  it('activé une fois le curseur posé sur un rang ; le clic insère l’image juste sous ce rang et la retire de la galerie', async () => {
    const reader = fixtureReader()
    const { w } = await mountView({
      pattern: { id: 7, name: 'Pull', reader, gallery: [{ src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 }] },
    })
    const md = readerToEditable(reader).md
    const lineNumber = md.split('\n').findIndex((l) => l.includes('Tricoter au point mousse.')) + 1
    await openGalleryStrip(w)
    await setCursorLine(w, lineNumber)

    const btn = findButtonByText(w, fr.correction.insertIntoText)
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    await flushPromises()

    const editedMd = textarea(w).element.value
    const lines = editedMd.split('\n')
    expect(lines[lineNumber]).toBe(`  ![](img/${photoFileName('data:image/png;base64,A', 0)})`)
    // L'image a quitté la galerie (même geste que « Suivre comme diagramme »).
    expect(w.findAll('.gallery-strip__img')).toHaveLength(0)
  })

  it('l’image insérée survit à l’Enregistrement (résolution via opts.extraImages, pas cassée)', async () => {
    const reader = fixtureReader()
    const galleryDataUrl = 'data:image/png;base64,A'
    const { w, pattern } = await mountView({
      pattern: { id: 7, name: 'Pull', reader, gallery: [{ src: galleryDataUrl, page: 1, w: 10, h: 10 }] },
    })
    const md = readerToEditable(reader).md
    const lineNumber = md.split('\n').findIndex((l) => l.includes('Tricoter au point mousse.')) + 1
    await openGalleryStrip(w)
    await setCursorLine(w, lineNumber)
    await findButtonByText(w, fr.correction.insertIntoText).trigger('click')
    await flushPromises()

    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(pattern.id)
    const corps = persisted.reader.sections.find((s) => s.id === 'corps')
    expect(corps.steps.some((s) => Array.isArray(s.imgs) && s.imgs.includes(galleryDataUrl))).toBe(true)
    expect(persisted.gallery ?? []).toEqual([])
  })

  it('n’apparaît pas sur une ligne de galerie déjà promue en diagramme en attente', async () => {
    const { w } = await mountView({ pattern: { gallery: [{ src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 }] } })
    await openGalleryStrip(w)
    await w.findAll('.gallery-strip__promote')[0].trigger('click')
    await flushPromises()
    const item = [...document.querySelectorAll('.cm-menu-popover__item')].find((el) =>
      el.textContent.includes(fr.correction.chartShape.standard.label),
    )
    item.click()
    await flushPromises()

    expect(findButtonByText(w, fr.correction.insertIntoText)).toBeFalsy()
  })
})

describe('CorrectionView — transformer une image de galerie en diagramme', () => {
  beforeEach(() => {
    pickImageMock.mockReset()
  })

  it('promotion avec le type "Radial-carré" : après Enregistrer, une nouvelle section "Diagramme N" apparaît, l\'image quitte pattern.gallery', async () => {
    const { w, pattern } = await mountView({ pattern: { gallery: [{ src: 'data:image/png;base64,GAL', page: 4, w: 10, h: 10 }] } })
    await openGalleryStrip(w)
    await promoteGalleryImageViaStrip(w, 0, fr.correction.chartShape.radialSquare.label)

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    expect(persisted.gallery).toEqual([])
    // Le patron de fixtureReader() porte déjà "Diagramme 1" (chart de démo) : la promotion
    // de galerie doit donc produire "Diagramme 2" (scan des titres existants).
    const added = persisted.reader.sections.find((s) => s.title === 'Diagramme 2')
    expect(added).toBeTruthy()
    expect(added.chart.img).toBe('data:image/png;base64,GAL')
    expect(added.chart.shape).toBe('radial-square')
  })

  it('promouvoir l\'image de couverture : coverIndex recalé à 0 après Enregistrer', async () => {
    const { w, pattern } = await mountView({
      pattern: { coverIndex: 1, gallery: [
        { src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 },
        { src: 'data:image/png;base64,B', page: 2, w: 10, h: 10 },
      ] },
    })
    await openGalleryStrip(w)
    // Ligne 1 = B, la couverture (coverIndex: 1) : la promotion la retire de la galerie
    // exactement comme removeGalleryImage, même recalage attendu.
    await promoteGalleryImageViaStrip(w, 1, fr.correction.chartShape.radialSquare.label)

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    expect(persisted.coverIndex).toBe(0)
  })

  it('promouvoir une image AVANT la couverture : coverIndex décrémenté d\'un cran après Enregistrer', async () => {
    // 3 images, coverIndex: 2 (C) — décrémenter (2 → 1) et remettre à 0 donneraient tous
    // deux "0" avec seulement 2 images, ce qui ne distinguerait pas un vrai décrément d'une
    // remise à zéro accidentelle ; ce fixture à 3 images tranche.
    const { w, pattern } = await mountView({
      pattern: { coverIndex: 2, gallery: [
        { src: 'data:image/png;base64,A', page: 1, w: 10, h: 10 },
        { src: 'data:image/png;base64,B', page: 2, w: 10, h: 10 },
        { src: 'data:image/png;base64,C', page: 3, w: 10, h: 10 },
      ] },
    })
    await openGalleryStrip(w)
    // Ligne 0 = A, avant la couverture (C, coverIndex: 2).
    await promoteGalleryImageViaStrip(w, 0, fr.correction.chartShape.radialSquare.label)

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    expect(persisted.coverIndex).toBe(1)
    // B et C (la couverture) n'ont pas été promues : elles restent dans la galerie, décalées
    // d'un cran — d'où le recalage de coverIndex (2 → 1) vérifié ci-dessus.
    expect(persisted.gallery).toEqual([
      { src: 'data:image/png;base64,B', page: 2, w: 10, h: 10 },
      { src: 'data:image/png;base64,C', page: 3, w: 10, h: 10 },
    ])
  })

  it('patron créé manuellement (reader.sections vide au départ, pas de fixtureReader) : promouvoir une image de galerie crée la toute première section', async () => {
    const { w, pattern } = await mountView({
      pattern: { reader: { sizeLabels: [], sections: [] }, gallery: [{ src: 'data:image/png;base64,GAL', page: 0, w: 10, h: 10 }] },
    })
    await openGalleryStrip(w)
    await promoteGalleryImageViaStrip(w, 0, fr.correction.chartShape.radialSquare.label)

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    expect(persisted.reader.sections).toHaveLength(1)
    expect(persisted.reader.sections[0].chart.img).toBe('data:image/png;base64,GAL')
    expect(persisted.reader.sections[0].chart.shape).toBe('radial-square')
    expect(persisted.gallery).toEqual([])
  })

  it('promotion avec le type "Radial-hexagone" : après Enregistrer, la nouvelle section porte chart.shape "radial-hexagon"', async () => {
    const { w, pattern } = await mountView({ pattern: { gallery: [{ src: 'data:image/png;base64,GAL', page: 4, w: 10, h: 10 }] } })
    await openGalleryStrip(w)
    await promoteGalleryImageViaStrip(w, 0, fr.correction.chartShape.radialHexagon.label)

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    const added = persisted.reader.sections.find((s) => s.chart?.img === 'data:image/png;base64,GAL')
    expect(added?.chart.shape).toBe('radial-hexagon')
  })

  it('deux images de galerie au src BYTE-IDENTIQUE (même empreinte) : promouvoir la PREMIÈRE seulement ne perd pas la seconde, visible tout de suite', async () => {
    const { w, pattern } = await mountView({
      pattern: {
        gallery: [
          { src: 'data:image/png;base64,DUP', page: 1, w: 10, h: 10 },
          { src: 'data:image/png;base64,DUP', page: 2, w: 10, h: 10 },
        ],
      },
    })
    await openGalleryStrip(w)
    // Les deux vignettes partagent la même empreinte (même src) : seule la ligne 0 est promue.
    await promoteGalleryImageViaStrip(w, 0, fr.correction.chartShape.radialSquare.label)
    // La seconde vignette (non promue, doublon de src) reste visible IMMÉDIATEMENT — pas
    // silencieusement perdue parce qu'elle partage l'empreinte de la première (promotion
    // indexée, pas par empreinte de contenu, cf. tête de pushDraftGalleryImage).
    expect(w.findAll('.gallery-strip__img')).toHaveLength(1)

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    // La seconde entrée (non promue, doublon de src) doit SURVIVRE dans la galerie — pas
    // silencieusement perdue parce qu'elle partage l'empreinte de la première.
    expect(persisted.gallery).toEqual([{ src: 'data:image/png;base64,DUP', page: 2, w: 10, h: 10 }])
    // Exactement UNE nouvelle section diagramme — pas deux (une seule promotion).
    const addedSections = persisted.reader.sections.filter((s) => s.title === 'Diagramme 2')
    expect(addedSections).toHaveLength(1)
    expect(addedSections[0].chart.shape).toBe('radial-square')
    expect(persisted.reader.sections.find((s) => s.title === 'Diagramme 3')).toBeUndefined()
  })

  it('deux images de galerie au src BYTE-IDENTIQUE promues avec des types DIFFÉRENTS : DEUX sections, chacune son type, galerie vidée', async () => {
    const { w, pattern } = await mountView({
      pattern: {
        gallery: [
          { src: 'data:image/png;base64,DUP', page: 1, w: 10, h: 10 },
          { src: 'data:image/png;base64,DUP', page: 2, w: 10, h: 10 },
        ],
      },
    })
    await openGalleryStrip(w)
    // Deux types DIFFÉRENTS : le `src` étant identique, `chart.shape` est le SEUL
    // discriminant possible entre les deux sections produites. Avec une clé de promotion
    // par empreinte de contenu (ancien mécanisme), la seconde promotion écrasait la
    // première. Avec une clé de RÉCONCILIATION par empreinte (ancien mécanisme
    // d'Enregistrer aussi), une seule des deux sections aurait survécu à la sauvegarde —
    // c'est ce que ce test verrouille désormais côté réconciliation (id, pas empreinte).
    //
    // Promotion à REBROUSSE-POIL (ligne 1 AVANT ligne 0), délibérément : chaque promotion
    // est IMMÉDIATE et retire aussitôt la ligne du brouillon — la numérotation
    // « Diagramme N » suit donc l'ORDRE DES CLICS, pas l'ordre de la galerie (limite
    // assumée, cf. commentaire de tête de promoteGalleryImage, CorrectionView.vue).
    await promoteGalleryImageViaStrip(w, 1, fr.correction.chartShape.path.label)
    await promoteGalleryImageViaStrip(w, 0, fr.correction.chartShape.radialSquare.label)
    // Les deux vignettes ont bien disparu de la galerie tout de suite.
    expect(w.findAll('.gallery-strip__img')).toHaveLength(0)

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    expect(persisted.gallery).toEqual([])
    // Numérotation par ORDRE DE CLIC (ligne 1 promue en premier → "Diagramme 2").
    const first = persisted.reader.sections.find((s) => s.title === 'Diagramme 2')
    const second = persisted.reader.sections.find((s) => s.title === 'Diagramme 3')
    expect(first?.chart.shape).toBe('path')
    expect(second?.chart.shape).toBe('radial-square')
    expect(first.chart.img).toBe('data:image/png;base64,DUP')
    expect(second.chart.img).toBe('data:image/png;base64,DUP')
  })
})

// Retour terrain (24/08/2026, Huawei « Dragon Scale Shawl ») : une section peut porter
// kind:'diagramme' (import mal classé, ou corruption non encore élucidée) sans le moindre
// chart ni image exploitable — jusqu'ici invisible dans le panneau (chartStripRows la
// sautait en silence, cf. `if (!baseIsChart && !sectionCanPromote(sec)) continue`), donc
// impossible à retrouver. Le panneau doit désormais la signaler au lieu de la cacher.
describe('CorrectionView — vignettes et détection des diagrammes incomplets', () => {
  it('les diagrammes normaux du panneau affichent un aperçu de l’image — et SEULS eux', async () => {
    const { w } = await mountView()
    await openChartsStrip(w)
    const srcs = w.findAll('.chart-strip__preview').map((img) => img.attributes('src'))
    expect(srcs).toContain(CHART_DATA_URL)
    // L'image de la section « Encolure » n'est PAS un diagramme : elle n'a rien à faire dans
    // ce panneau (retour terrain 26/08/2026 — « Diagrammes (4) » sur un patron qui en compte
    // 3, la 4e ligne étant une simple image). C'est la non-régression de ce filtre.
    expect(srcs).not.toContain(IMG_DATA_URL)
  })

  it('une section kind:"diagramme" sans chart ni image apparaît dans le panneau, signalée comme incomplète', async () => {
    const reader = {
      ...fixtureReader(),
      sections: [
        ...fixtureReader().sections,
        { id: 'img-photo-abcd1234-jpg', kind: 'diagramme', title: 'img/photo-abcd1234.jpg', steps: [] },
      ],
    }
    const { w } = await mountView({ pattern: { reader } })
    await openChartsStrip(w)
    expect(w.text()).toContain(fr.correction.brokenDiagramLabel)
    expect(findButtonByText(w, fr.correction.brokenDiagramGoTo)).toBeTruthy()
  })

  it('une section incomplète ne propose ni "Suivre comme diagramme" ni "Juste une image"', async () => {
    const reader = {
      sizeLabels: ['S', 'M'],
      sections: [
        { id: 'img-photo-abcd1234-jpg', kind: 'diagramme', title: 'img/photo-abcd1234.jpg', steps: [] },
      ],
    }
    const { w } = await mountView({ pattern: { reader } })
    await openChartsStrip(w)
    const row = w.find('.chart-strip__row--broken')
    expect(row.exists()).toBe(true)
    expect(row.findAll('button').map((b) => b.text())).not.toContain(fr.correction.followAsChart)
    expect(row.findAll('button').map((b) => b.text())).not.toContain(fr.correction.justImage)
  })
})

describe('CorrectionView, sources d\'ajout d\'image de galerie (feuille standard)', () => {
  beforeEach(() => {
    pickImageMock.mockReset()
    cropMock.mockReset()
  })

  // UN bouton, plus de popover (harmonisation du 22/09/2026) : le menu à 3 options (dont un
  // « Parcourir les fichiers » redondant avec le sélecteur système déjà proposé par la feuille
  // standard) a été retiré au profit de PhotoSourceSheet, même changement que PatternForm.vue
  // (cf. tests/unit/pattern-form-gallery.spec.js pour le test équivalent).
  it('un seul bouton d\'ajout (feuille standard, plus de menu popover)', async () => {
    const { w } = await mountView({ pattern: { gallery: [], pdf: '' } })
    await openGalleryStrip(w)
    expect(w.findAll('.gallery-strip__add')).toHaveLength(1)
  })

  it('choix "extra" (4e bouton de la feuille) ouvre le picker PDF quand le patron a un PDF stocké', async () => {
    pickImageMock.mockResolvedValue('extra')
    const { w } = await mountView({ pattern: { gallery: [], pdf: 'data:application/pdf;base64,AAAA' } })
    await openGalleryStrip(w)
    await clickGalleryAdd(w)
    expect(pickImageMock).toHaveBeenCalledWith(fr.patternExtras.addImagePdf)
    // PdfPagePickerDialog est chargé en defineAsyncComponent (cf. CorrectionView.vue) : sa
    // résolution passe par une microtâche de plus que flushPromises() ne draine à froid —
    // même parade que tests/unit/pattern-form-gallery.spec.js (même composant).
    await vi.waitFor(() => expect(w.findComponent({ name: 'PdfPagePickerDialog' }).exists()).toBe(true), { timeout: 10000 })
    expect(w.findComponent({ name: 'PdfPagePickerDialog' }).props('open')).toBe(true)
  })

  it('sans PDF sur le patron, pickImage est appelé avec null (pas de 4e bouton demandé)', async () => {
    pickImageMock.mockResolvedValue(null)
    const { w } = await mountView({ pattern: { gallery: [], pdf: '' } })
    await openGalleryStrip(w)
    await clickGalleryAdd(w)
    expect(pickImageMock).toHaveBeenCalledWith(null)
  })

  it('avec un PDF stocké : choisir une page l\'enchaîne sur le recadrage puis l\'ajoute au brouillon', async () => {
    pickImageMock.mockResolvedValue('extra')
    cropMock.mockResolvedValue('data:image/jpeg;base64,CROPPED')
    const { w } = await mountView({ pattern: { gallery: [], pdf: 'data:application/pdf;base64,AAAA' } })
    await openGalleryStrip(w)
    await clickGalleryAdd(w)
    // PdfPagePickerDialog est chargé en defineAsyncComponent (cf. CorrectionView.vue) : sa
    // résolution passe par une microtâche de plus que flushPromises() ne draine à froid.
    // Même parade que tests/unit/pattern-form-gallery.spec.js (même composant).
    await vi.waitFor(() => expect(w.findComponent({ name: 'PdfPagePickerDialog' }).exists()).toBe(true), { timeout: 10000 })
    await w.findComponent({ name: 'PdfPagePickerDialog' }).vm.$emit('pick', 'data:image/jpeg;base64,PAGE')
    await flushPromises()
    expect(cropMock).toHaveBeenCalledWith('data:image/jpeg;base64,PAGE')
    expect(w.findAll('.gallery-strip__img')).toHaveLength(1)
  })
})

describe('CorrectionView — envoyer un diagramme du texte vers la galerie (panneau)', () => {
  it('le panneau propose "Envoyer vers la galerie" sur un diagramme existant', async () => {
    const { w } = await mountView()
    await openChartsStrip(w)
    expect(findButtonByText(w, fr.correction.sendToGallery)).toBeTruthy()
  })

  it('cliquer "Envoyer vers la galerie" puis Enregistrer : la section disparaît (sans ancrage), l’image rejoint pattern.gallery', async () => {
    const { w, pattern } = await mountView()
    await openChartsStrip(w)
    await findButtonByText(w, fr.correction.sendToGallery).trigger('click')
    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    expect(persisted.reader.sections.find((s) => s.title === 'Diagramme 1')).toBeUndefined()
    // Exactement UNE fois : déjà poussée dans draftGallery au clic (sendChartToGallery), la
    // réconciliation d'Enregistrer ne doit pas la rajouter une seconde fois.
    expect(persisted.gallery.filter((g) => g.src === CHART_DATA_URL).length).toBe(1)
  })

  it('"Envoyer vers la galerie" déclenche la garde de sortie, même sans autre changement', async () => {
    const { w } = await mountView()
    expect(nav.leaveGuard()).toBe(true)
    await openChartsStrip(w)
    await findButtonByText(w, fr.correction.sendToGallery).trigger('click')
    expect(nav.leaveGuard()).toBe(false)
  })

  it('promouvoir une image PUIS "Envoyer vers la galerie" (le geste est immédiat, plus de distinction effectif/base)', async () => {
    const reader = {
      sizeLabels: ['S', 'M'],
      sections: [
        {
          id: 'encolure',
          kind: 'encolure',
          title: 'Encolure',
          steps: [{ t: 'Monter les mailles', imgs: [IMG_DATA_URL] }],
        },
      ],
    }
    const { w, pattern } = await mountView({ pattern: { reader, gallery: [] } })
    await promoteEncolureImage(w) // immédiat : 'encolure' EST déjà un diagramme dans workingReader
    await openChartsStrip(w)
    // Le bouton apparaît tout de suite : plus de distinction effectif/base.
    expect(findButtonByText(w, fr.correction.sendToGallery)).toBeTruthy()
    await findButtonByText(w, fr.correction.sendToGallery).trigger('click')
    await flushPromises()
    // La section a immédiatement quitté le panneau (elle n'est plus un diagramme)…
    expect(findButtonByText(w, fr.correction.sendToGallery)).toBeFalsy()
    // …et l'image est visible tout de suite dans la bande Galerie, SANS Enregistrer.
    await openGalleryStrip(w)
    expect(w.find(`.gallery-strip__img[src="${IMG_DATA_URL}"]`).exists()).toBe(true)

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    // La section SURVIT (demoteChartToGallery, reader-correction.js, ne retire une section
    // ENTIÈREMENT que si elle ne portait RIEN d'autre que son step {chart:true} — ici « Monter
    // les mailles » reste, aucune donnée texte n'est perdue) : seule l'image en part.
    const encolure = persisted.reader.sections.find((s) => s.id === 'encolure')
    expect(encolure).toBeTruthy()
    expect(encolure.chart).toBeUndefined()
    expect(encolure.steps.some((s) => Array.isArray(s.imgs) && s.imgs.includes(IMG_DATA_URL))).toBe(false)
    // Exactement UNE fois dans la galerie — jamais dupliquée (déjà poussée dans draftGallery
    // au clic, cf. sendChartToGallery : la réconciliation d'Enregistrer ne doit pas la
    // rajouter une seconde fois).
    expect(persisted.gallery.filter((g) => g.src === IMG_DATA_URL).length).toBe(1)
  })

  // I1 (revue) : `chartSignature` réduisait le cas non-chart à `{chart:false,
  // hasImage:<booléen>}` — sur une section à image SŒUR (steps: [{ imgs: [IMG, SIBLING] }]),
  // `demoteChartToGallery` ne retire que `chart.img` (IMG) et laisse SIBLING ancrée : le
  // booléen reste `true` des deux côtés (base ET après le geste), la signature "après geste"
  // coïncide donc à tort avec celle de `baseReader`, et le « retour exact à la base »
  // d'`applyImageAction` ressuscitait IMG dans workingReader — alors qu'elle avait déjà
  // rejoint `draftGallery` au clic. Résultat : IMG dupliquée, à la fois dans le texte ET la
  // galerie, à l'Enregistrer. Correctif : « Envoyer vers la galerie » ne repasse plus JAMAIS
  // par ce chemin de restauration (il déplace une image HORS du reader, pas une bascule
  // chart/pas-chart symétrique) — cf. `applyImageAction({ restoreToBase: false })`.
  it('promouvoir une image ayant une image SŒUR puis l’envoyer en galerie : l’image sœur n’est jamais confondue avec elle (I1)', async () => {
    const SIBLING_DATA_URL = 'data:image/png;base64,EEEE'
    const reader = {
      sizeLabels: ['S', 'M'],
      sections: [
        {
          id: 'encolure',
          kind: 'encolure',
          title: 'Encolure',
          steps: [{ t: 'Monter les mailles', imgs: [IMG_DATA_URL, SIBLING_DATA_URL] }],
        },
      ],
    }
    const { w, pattern } = await mountView({ pattern: { reader, gallery: [] } })
    await promoteEncolureImage(w) // promeut la 1re image (IMG_DATA_URL) ; SIBLING reste ancrée
    await openChartsStrip(w)
    await findButtonByText(w, fr.correction.sendToGallery).trigger('click')
    await flushPromises()

    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    const encolure = persisted.reader.sections.find((s) => s.id === 'encolure')
    expect(encolure).toBeTruthy()
    expect(encolure.chart).toBeUndefined()
    // IMG n'apparaît QU'une fois, dans la galerie — jamais aussi dans le texte.
    expect(persisted.gallery.filter((g) => g.src === IMG_DATA_URL).length).toBe(1)
    expect(encolure.steps.some((s) => Array.isArray(s.imgs) && s.imgs.includes(IMG_DATA_URL))).toBe(false)
    // SIBLING, elle, reste ancrée dans le texte — jamais touchée par ce geste.
    expect(encolure.steps.some((s) => Array.isArray(s.imgs) && s.imgs.includes(SIBLING_DATA_URL))).toBe(true)
    expect(persisted.gallery.some((g) => g.src === SIBLING_DATA_URL)).toBe(false)
  })

  it('imageActions.getInfo expose toGalleryLabel sur un diagramme existant, et sendToGallery applique la démotion immédiatement', async () => {
    const { w } = await mountView()
    const lines = textarea(w).element.value.split('\n')
    // La ligne de l'image du diagramme "Diagramme 1" (fixtureReader()) porte un chemin
    // d'asset (`img/photo-<hash>.<ext>`, cf. serialize.js), jamais la data URL en clair —
    // on la retrouve par position, juste après le titre "## Diagramme 1", plus robuste
    // que de chercher CHART_DATA_URL dans le texte.
    const titleLineIdx = lines.findIndex((l) => l.startsWith('## Diagramme 1'))
    const imgLineIdx = lines.findIndex((l, i) => i > titleLineIdx && l.startsWith('!['))
    const imgLineNumber = imgLineIdx + 1 // 1-based, cf. contrat imageActions
    const mdPath = lines[imgLineIdx].match(/\(([^)]+)\)/)[1]

    const imageActions = w.findComponent(ReaderTextEditorStub).props('imageActions')
    const info = imageActions.getInfo(imgLineNumber, mdPath)
    expect(info.toGalleryLabel).toBe(fr.correction.sendToGallery)

    imageActions.sendToGallery(imgLineNumber, mdPath)
    await flushPromises()
    expect(nav.leaveGuard()).toBe(false) // workingReader diffère désormais de baseReader
    await openGalleryStrip(w)
    expect(w.find(`.gallery-strip__img[src="${CHART_DATA_URL}"]`).exists()).toBe(true)
  })
})

describe('CorrectionView — promotion galerie→diagramme immédiate', () => {
  it('promouvoir une image de galerie la fait apparaître IMMÉDIATEMENT comme VRAI diagramme dans le panneau, et disparaître de la galerie, sans Enregistrer', async () => {
    const { w } = await mountView({ pattern: { gallery: [{ src: 'data:image/png;base64,GAL', page: 4, w: 10, h: 10 }] } })
    await openGalleryStrip(w)
    await promoteGalleryImageViaStrip(w, 0, fr.correction.chartShape.radialSquare.label)
    // Plus de rangée synthétique « Nouveau diagramme (à enregistrer) » : c'est un diagramme
    // pour de vrai tout de suite.
    await openChartsStrip(w)
    expect(w.find('.chart-strip__preview[src="data:image/png;base64,GAL"]').exists()).toBe(true)
    expect(findButtonByText(w, fr.correction.justImage)).toBeTruthy() // vraie section chart
    // Sortie immédiate de la galerie.
    await openGalleryStrip(w)
    expect(w.find('.gallery-strip__img[src="data:image/png;base64,GAL"]').exists()).toBe(false)
    // Geste bien vu par la garde de sortie, avant tout Enregistrer.
    expect(nav.leaveGuard()).toBe(false)
  })

  it('après Enregistrer, le diagramme est bien persisté', async () => {
    const { w, pattern } = await mountView({ pattern: { gallery: [{ src: 'data:image/png;base64,GAL', page: 4, w: 10, h: 10 }] } })
    await openGalleryStrip(w)
    await promoteGalleryImageViaStrip(w)
    await clickSaveAndSettle(w)
    const persisted = await db.patterns.get(pattern.id)
    expect(persisted.reader.sections.some((s) => s.chart?.img === 'data:image/png;base64,GAL')).toBe(true)
    expect(persisted.gallery.some((g) => g.src === 'data:image/png;base64,GAL')).toBe(false)
  })
})

// Lot « bandes du bas » (retour terrain 26/08/2026, Huawei « Dragon Scale Shawl ») : le
// panneau annonçait « Diagrammes (4) » sur un patron qui en compte 3 — la 4e ligne était une
// simple image du texte, listée là parce qu'elle est PROMOUVABLE. Le filtre d'affichage
// (chartPanelRows) l'écarte, sans toucher à chartStripRows, qui reste la table de résolution
// du menu du clic-image (imageActions).
describe('CorrectionView — le panneau Diagrammes ne liste que des diagrammes', () => {
  it("une image du texte jamais promue n'apparaît pas dans le panneau, et n'est pas comptée", async () => {
    const { w } = await mountView()
    expect(w.find('.chart-strip__toggle').text()).toContain(tk('correction.diagramsToggle', { count: 1 }))
    await openChartsStrip(w)
    expect(w.findAll('.chart-strip__row')).toHaveLength(1)
    expect(w.text()).toContain('Diagramme 1')
    expect(w.text()).not.toContain('Encolure')
  })

  it("mais le menu du clic-image reste vivant sur cette même image (le filtre est d'AFFICHAGE)", async () => {
    const { w } = await mountView()
    const assetPath = `img/${photoFileName(IMG_DATA_URL, 0)}`
    const lineNumber = textarea(w).element.value.split('\n').findIndex((l) => l.includes(assetPath)) + 1
    const info = w.findComponent(ReaderTextEditorStub).props('imageActions').getInfo(lineNumber, assetPath)
    expect(info).not.toBeNull()
    expect(info.enabled).toBe(true)
    expect(info.primary.label).toBe(fr.correction.followAsChart)
  })

  it('promue depuis le texte, elle entre AUSSITÔT dans le panneau', async () => {
    const { w } = await mountView()
    await promoteEncolureImage(w)
    expect(w.find('.chart-strip__toggle').text()).toContain(tk('correction.diagramsToggle', { count: 2 }))
    await openChartsStrip(w)
    expect(w.text()).toContain('Encolure')
  })

  it('ramener un vrai diagramme à « juste une image » le fait disparaître du panneau IMMÉDIATEMENT (la démotion est réelle, pas une prévisualisation)', async () => {
    const { w } = await mountView()
    await openChartsStrip(w)
    await findButtonByText(w, fr.correction.justImage).trigger('click')
    await flushPromises()
    // Plus de rangée pour cette section : elle n'est plus un diagramme, pour de vrai.
    expect(w.find('.chart-strip__toggle').exists()).toBe(false)
  })

  it('…mais reste re-promouvable depuis le texte : le clic sur l’image propose encore « Suivre comme diagramme »', async () => {
    const { w } = await mountView()
    await openChartsStrip(w)
    await findButtonByText(w, fr.correction.justImage).trigger('click')
    await flushPromises()
    const assetPath = `img/${photoFileName(CHART_DATA_URL, 0)}`
    const lineNumber = textarea(w).element.value.split('\n').findIndex((l) => l.includes(assetPath)) + 1
    const info = w.findComponent(ReaderTextEditorStub).props('imageActions').getInfo(lineNumber, assetPath)
    expect(info).not.toBeNull()
    expect(info.enabled).toBe(true)
    expect(info.primary.label).toBe(fr.correction.followAsChart)
  })
})

describe('CorrectionView — renommer un diagramme depuis le panneau', () => {
  async function openRenameField(w) {
    await openChartsStrip(w)
    await w.find('.chart-strip__rename-btn').trigger('click')
    await flushPromises()
  }

  it('le champ est semé du titre BRUT et affiche l’avertissement de perte de progression', async () => {
    const { w } = await mountView()
    await openRenameField(w)
    expect(w.find('.chart-strip__rename input').element.value).toBe('Diagramme 1')
    expect(w.find('.chart-strip__rename-warn').text()).toBe(fr.correction.renameProgressWarning)
  })

  it('renommer réécrit la ligne de titre DANS le texte (via l’éditeur), et le panneau suit', async () => {
    const { w } = await mountView()
    await openRenameField(w)
    await w.find('.chart-strip__rename input').setValue('Écailles de dragon')
    await w.find('.chart-strip__rename button').trigger('click')
    await flushPromises()

    const md = textarea(w).element.value
    expect(md).toContain('## Écailles de dragon')
    expect(md).not.toContain('## Diagramme 1')
    expect(w.text()).toContain('Écailles de dragon')
    // Le champ se referme, et la garde de sortie voit bien une modification du texte.
    expect(w.find('.chart-strip__rename').exists()).toBe(false)
    expect(nav.leaveGuard()).toBe(false)
  })

  it('le nouveau titre est persisté à l’Enregistrer, chart intact', async () => {
    const { w, pattern } = await mountView()
    await openRenameField(w)
    await w.find('.chart-strip__rename input').setValue('Écailles de dragon')
    await w.find('.chart-strip__rename button').trigger('click')
    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(pattern.id)
    const sec = persisted.reader.sections.find((s) => s.title === 'Écailles de dragon')
    expect(sec).toBeTruthy()
    expect(sec.chart?.img).toBe(CHART_DATA_URL)
    expect(persisted.reader.sections.some((s) => s.title === 'Diagramme 1')).toBe(false)
  })

  // Le point le plus fragile du renommage : `chartStripRows` dérive de `baseReader`, FIGÉ à
  // l'ouverture. Sans le report du nouveau titre (renames), tous les appariements par slug de
  // ce fichier — surlignage de la rangée, et surtout `chartRowAtLine` qui adosse le menu du
  // clic-image — chercheraient encore l'ANCIEN titre et ne trouveraient plus rien.
  it('après un renommage, le menu du clic-image de CETTE section marche encore', async () => {
    const { w } = await mountView()
    await openRenameField(w)
    await w.find('.chart-strip__rename input').setValue('Écailles de dragon')
    await w.find('.chart-strip__rename button').trigger('click')
    await flushPromises()

    const lines = textarea(w).element.value.split('\n')
    const titleIdx = lines.findIndex((l) => l.startsWith('## Écailles de dragon'))
    const imgIdx = lines.findIndex((l, i) => i > titleIdx && l.startsWith('!['))
    const mdPath = lines[imgIdx].match(/\(([^)]+)\)/)[1]
    const info = w.findComponent(ReaderTextEditorStub).props('imageActions').getInfo(imgIdx + 1, mdPath)
    expect(info).not.toBeNull()
    expect(info.enabled).toBe(true)
    expect(info.isChart).toBe(true)
  })

  it('un titre vide ou inchangé ne touche pas au texte', async () => {
    const { w } = await mountView()
    const before = textarea(w).element.value
    await openRenameField(w)
    await w.find('.chart-strip__rename input').setValue('   ')
    await w.find('.chart-strip__rename button').trigger('click')
    await flushPromises()
    expect(textarea(w).element.value).toBe(before)
    expect(nav.leaveGuard()).toBe(true)
  })

  // Deuxième renommage SANS quitter l'écran : `row.title` vient alors de `renames`, pas de
  // `baseReader` — c'est le seul chemin où le report de titre se réalimente lui-même. Si
  // `sectionLine` cherchait encore le titre d'origine, ce second geste ne trouverait plus sa
  // ligne et tomberait dans le repli d'échec.
  it('renommer DEUX FOIS de suite retrouve bien la ligne la seconde fois', async () => {
    const { w } = await mountView()
    const snackbar = useSnackbarStore()
    await openRenameField(w)
    await w.find('.chart-strip__rename input').setValue('Écailles')
    await w.find('.chart-strip__rename button').trigger('click')
    await flushPromises()

    await w.find('.chart-strip__rename-btn').trigger('click')
    await flushPromises()
    expect(w.find('.chart-strip__rename input').element.value).toBe('Écailles')
    await w.find('.chart-strip__rename input').setValue('Écailles de dragon')
    await w.find('.chart-strip__rename button').trigger('click')
    await flushPromises()

    const md = textarea(w).element.value
    expect(md).toContain('## Écailles de dragon')
    expect(md).not.toContain('## Écailles\n')
    expect(snackbar.visible).toBe(false) // aucun repli d'échec déclenché
  })

  // Dans une ligne de titre, `{…}` est de la SYNTAXE (l'attribut de catégorie lu par le
  // parseur), pas du texte : un nom saisi avec des accolades reposerait une catégorie sur la
  // section au prochain reparse, sans que rien ne le dise.
  it('les accolades saisies dans le nom sont retirées, pas écrites dans le titre', async () => {
    const { w, pattern } = await mountView()
    await openRenameField(w)
    await w.find('.chart-strip__rename input').setValue('Motif {sleeve}')
    await w.find('.chart-strip__rename button').trigger('click')
    await clickSaveAndSettle(w)

    const persisted = await db.patterns.get(pattern.id)
    const sec = persisted.reader.sections.find((s) => s.title === 'Motif sleeve')
    expect(sec).toBeTruthy()
    expect(sec.kind).toBe('diagramme') // JAMAIS 'manche' : l'accolade n'a pas été lue comme un attribut
    expect(sec.chart?.img).toBe(CHART_DATA_URL)
  })

  // L'attribut de catégorie du titre (`{sleeve}`, cf. md-line-type.js) est une DONNÉE lue par
  // le parseur : l'écraser ferait retomber la section en section de travail ordinaire.
  it('l’attribut de catégorie du titre est conservé', async () => {
    const { w } = await mountView()
    await openRenameField(w)
    await w.find('.chart-strip__rename input').setValue('Écailles')
    await w.find('.chart-strip__rename button').trigger('click')
    await flushPromises()
    const titleLine = textarea(w).element.value.split('\n').find((l) => l.startsWith('## Écailles'))
    const before = readerToEditable(fixtureReader()).md.split('\n').find((l) => l.startsWith('## Diagramme 1'))
    expect(titleLine.replace('## Écailles', '')).toBe(before.replace('## Diagramme 1', ''))
  })

  // Signalé au contrôleur (lot « clé stable », T3) : la section d'INTRO (`id:'presentation'`,
  // sentinelle posée par parseIntro) peut être promue en diagramme (cf. plus haut, retour
  // terrain 26/08/2026 : une simple image de la section « Présentation » est promouvable).
  // Renommée depuis CE panneau, elle doit afficher le nouveau nom IMMÉDIATEMENT — `row.id`
  // reste 'presentation' tant que le reparse n'a pas tourné (seul `renames.value` se met à
  // jour tout de suite, cf. chartStripRows), donc sans le court-circuit `row.renamed` au site
  // d'appel, `sectionTitleLabel` reprendrait la branche id et retraduirait, faisant
  // disparaître le renommage à l'écran jusqu'au prochain reparse.
  it('renommer la section d’intro (id "presentation") promue en diagramme affiche le nouveau nom, pas « Présentation » retraduit', async () => {
    const introReader = fixtureReader()
    introReader.sections[0] = { ...introReader.sections[0], id: 'presentation', title: 'presentation' }
    const { w } = await mountView({ pattern: { reader: introReader } })

    await openChartsStrip(w)
    // Avant renommage : id 'presentation' → traduit, comme n'importe quelle intro.
    expect(w.find('.chart-strip__name').text()).toBe(fr.reader.section.intro)

    await w.find('.chart-strip__rename-btn').trigger('click')
    await flushPromises()
    await w.find('.chart-strip__rename input').setValue('Écailles de dragon')
    await w.find('.chart-strip__rename button').trigger('click')
    await flushPromises()

    // Après renommage : le nom choisi s'affiche, PAS la traduction de l'intro (id encore
    // 'presentation', non resynchronisé avant le prochain reparse).
    expect(w.find('.chart-strip__name').text()).toBe('Écailles de dragon')
  })
})

// @vitest-environment jsdom
// Unitaire — rapport de synchro MD, UI. Couvre la décision
// d'affichage (`classifySyncReport`, pure — cf. src/backup/sync-report-decision.js)
// ET le rendu de la modale `SyncReportDialog` : cas propre → PAS de modale (le
// câblage snackbar est vérifié via le décideur, la snackbar elle-même vit dans
// App.vue, hors périmètre de ce test de composant) ; cas à signaler → modale
// visible listant patrons/skipped/erreurs ; dédoublonnage des images manquantes ;
// « Compris » vide le rapport et referme ; parité des clés i18n `patronSync`
// FR/EN ; aucune emoji dans le template.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import { classifySyncReport } from '@/backup/sync-report-decision'
import { useSyncReportStore } from '@/stores/sync-report'
import SyncReportDialog from '@/components/SyncReportDialog.vue'
import { useNoticeQueueStore } from '@/stores/notice-queue'
import { NOTICE } from '@/constants/notice-queue'
import { W, E, WARNING_CODES } from '@/utils/pattern-md/warning-codes'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr, en } })

let wrapper
const mountIt = () => {
  wrapper = mount(SyncReportDialog, { global: { plugins: [i18n] }, attachTo: document.body })
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  // Le verrou de défilement s'écrit sur `document.body`, partagé par tout le fichier :
  // sans cette remise à zéro, un test hériterait de l'état laissé par le précédent.
  document.body.style.overflow = ''
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

const emptyReconcile = () => ({
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

describe('classifySyncReport (décision pure)', () => {
  it('rien à synchroniser → none', () => {
    expect(classifySyncReport(null).kind).toBe('none')
    expect(classifySyncReport({ merged: [], skipped: [], errors: [] }).kind).toBe('none')
  })

  it('tolère la forme dégradée du drapeau in-progress ({ skipped: "running" })', () => {
    expect(classifySyncReport({ skipped: 'running' }).kind).toBe('none')
  })

  it('cas propre (1 fusion sans rien à signaler) → snackbar, count=1', () => {
    const report = {
      merged: [{ kind: 'pattern', id: 1, name: 'SABAI', reconcile: emptyReconcile(), warnings: [], missingAssets: [] }],
      skipped: [],
      errors: [],
    }
    expect(classifySyncReport(report)).toEqual({ kind: 'snackbar', count: 1 })
  })

  it('cas propre à N fusions → snackbar, count=N', () => {
    const clean = { kind: 'pattern', id: 1, name: 'A', reconcile: emptyReconcile(), warnings: [], missingAssets: [] }
    const report = { merged: [clean, { ...clean, id: 2, name: 'B' }], skipped: [], errors: [] }
    expect(classifySyncReport(report)).toEqual({ kind: 'snackbar', count: 2 })
  })

  it('progression perdue (doneLost>0) → modal', () => {
    const report = {
      merged: [
        {
          kind: 'pattern',
          id: 1,
          name: 'SABAI',
          reconcile: { ...emptyReconcile(), doneLost: 2 },
          warnings: [],
          missingAssets: [],
        },
      ],
      skipped: [],
      errors: [],
    }
    expect(classifySyncReport(report).kind).toBe('modal')
  })

  it('perte d’état de grille (rows/reps/frames/curtains Lost > 0) → modal (pas snackbar)', () => {
    for (const field of ['chartRowsLost', 'chartRepsLost', 'chartFramesLost', 'chartCurtainsLost']) {
      const report = {
        merged: [
          {
            kind: 'pattern',
            id: 1,
            name: 'SABAI',
            reconcile: { ...emptyReconcile(), [field]: 1 },
            warnings: [],
            missingAssets: [],
          },
        ],
        skipped: [],
        errors: [],
      }
      expect(classifySyncReport(report).kind, field).toBe('modal')
    }
  })

  it('skipped avec motif (même sans merged) → modal', () => {
    const report = { merged: [], skipped: [{ folder: 'Patrons/x [9]', kind: 'pattern', reason: 'MD tronqué' }], errors: [] }
    expect(classifySyncReport(report).kind).toBe('modal')
  })

  it('erreurs → modal', () => {
    const report = { merged: [], skipped: [], errors: [{ folder: 'Patrons/x [9]', error: 'boom' }] }
    expect(classifySyncReport(report).kind).toBe('modal')
  })
})

describe('SyncReportDialog', () => {
  it('cas propre : la modale ne s’affiche PAS', async () => {
    const w = mountIt()
    useSyncReportStore().setReport({
      merged: [{ kind: 'pattern', id: 1, name: 'SABAI', reconcile: emptyReconcile(), warnings: [], missingAssets: [] }],
      skipped: [],
      errors: [],
    })
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('report vide/nul : la modale ne s’affiche PAS', async () => {
    const w = mountIt()
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('progression perdue : modale visible, liste le patron + le compte « à refaire »', async () => {
    const w = mountIt()
    useSyncReportStore().setReport({
      merged: [
        {
          kind: 'pattern',
          id: 1,
          name: 'SABAI',
          reconcile: { ...emptyReconcile(), doneLost: 2, countersLost: 1 },
          warnings: [],
          missingAssets: [],
        },
      ],
      skipped: [],
      errors: [],
    })
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.text()).toContain('SABAI')
    expect(w.text()).toContain('3') // doneLost(2) + countersLost(1)
    // Aucune perte de grille ici → la ligne dédiée ne doit PAS apparaître.
    expect(w.text()).not.toContain(fr.patronSync.reportChartStateLost)
  })

  it('perte d’état de grille : ligne d’avertissement affichée (réglages de grille à refaire)', async () => {
    const w = mountIt()
    useSyncReportStore().setReport({
      merged: [
        {
          kind: 'pattern',
          id: 1,
          name: 'SABAI',
          reconcile: { ...emptyReconcile(), chartFramesLost: 1 },
          warnings: [],
          missingAssets: [],
        },
      ],
      skipped: [],
      errors: [],
    })
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.text()).toContain('SABAI')
    expect(w.text()).toContain(fr.patronSync.reportChartStateLost)
  })

  // Non-régression (bug trouvé en revue finale) : `chartCurtainsLost` a été ajouté à
  // `isMergedEntryFlagged` (la modale s'ouvre bien) mais oublié dans la sommation d'affichage
  // de ce composant — une entrée qui ne perd QUE son rideau ouvrait la modale sans aucune
  // ligne de raison visible. Isolé : tous les autres compteurs de perte sont à 0.
  it('perte du rideau SEUL : ligne d’avertissement affichée quand même', async () => {
    const w = mountIt()
    useSyncReportStore().setReport({
      merged: [
        {
          kind: 'pattern',
          id: 1,
          name: 'SABAI',
          reconcile: { ...emptyReconcile(), chartCurtainsLost: 1 },
          warnings: [],
          missingAssets: [],
        },
      ],
      skipped: [],
      errors: [],
    })
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.text()).toContain('SABAI')
    expect(w.text()).toContain(fr.patronSync.reportChartStateLost)
  })

  it('avertissements, image manquante, skipped et erreur : tous affichés', async () => {
    const w = mountIt()
    useSyncReportStore().setReport({
      merged: [
        {
          kind: 'pattern',
          id: 1,
          name: 'SABAI',
          reconcile: emptyReconcile(),
          warnings: ['étape non reconnue'],
          missingAssets: ['photo-abc.jpg', 'photo-abc.jpg', 'photo-def.jpg'],
        },
      ],
      skipped: [{ folder: 'Patrons/mia [3]', kind: 'pattern', reason: 'MD tronqué' }],
      errors: [{ folder: 'Patrons/juna [4]', error: 'lecture impossible' }],
    })
    await flushPromises()
    const text = w.text()
    expect(text).toContain('étape non reconnue')
    expect(text).toContain('MD tronqué')
    expect(text).toContain('lecture impossible')
    // Dédoublonnage : 'photo-abc.jpg' apparaît deux fois dans missingAssets → affiché une seule fois.
    const occurrences = (text.match(/photo-abc\.jpg/g) || []).length
    expect(occurrences).toBe(1)
    expect(text).toContain('photo-def.jpg')
  })

  it('reste ouverte si une resynchro (ex. resume) écrase le rapport par un propre/vide entre-temps', async () => {
    // Reproduit le scénario resume : la modale affiche une perte de progression,
    // puis l'app revient au premier plan et relance une synchro qui, cette fois,
    // ne trouve plus rien à fusionner (témoins déjà à jour) → `store.report` est
    // réécrit par un rapport propre. La modale ne doit PAS disparaître toute seule :
    // l'utilisateur n'a pas encore cliqué « Compris ».
    const w = mountIt()
    const store = useSyncReportStore()
    store.setReport({
      merged: [
        { kind: 'pattern', id: 1, name: 'SABAI', reconcile: { ...emptyReconcile(), doneLost: 2 }, warnings: [], missingAssets: [] },
      ],
      skipped: [],
      errors: [],
    })
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.text()).toContain('SABAI')

    store.setReport({ merged: [], skipped: [], errors: [] }) // resynchro propre pendant que la modale est ouverte
    await flushPromises()

    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.text()).toContain('SABAI')

    await w.find('[data-test="close"]').trigger('click')
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('« Compris » vide le rapport et referme la modale', async () => {
    const w = mountIt()
    const store = useSyncReportStore()
    store.setReport({
      merged: [
        { kind: 'pattern', id: 1, name: 'SABAI', reconcile: { ...emptyReconcile(), doneLost: 1 }, warnings: [], missingAssets: [] },
      ],
      skipped: [],
      errors: [],
    })
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)

    await w.find('[data-test="close"]').trigger('click')
    await flushPromises()

    expect(store.report).toBe(null)
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('Échap referme la modale (comme « Compris »)', async () => {
    const w = mountIt()
    const store = useSyncReportStore()
    store.setReport({
      merged: [
        { kind: 'pattern', id: 1, name: 'SABAI', reconcile: { ...emptyReconcile(), doneLost: 1 }, warnings: [], missingAssets: [] },
      ],
      skipped: [],
      errors: [],
    })
    await flushPromises()

    await w.find('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(store.report).toBe(null)
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('fallback : nom absent (skipped sans entité connue) → affiche le dossier', async () => {
    const w = mountIt()
    useSyncReportStore().setReport({
      merged: [],
      skipped: [{ folder: 'Patrons/orphelin [99]', kind: 'pattern', reason: 'patron inconnu en base' }],
      errors: [],
    })
    await flushPromises()
    expect(w.text()).toContain('Patrons/orphelin [99]')
  })

  it('aucune emoji dans le template rendu', async () => {
    const w = mountIt()
    useSyncReportStore().setReport({
      merged: [
        { kind: 'pattern', id: 1, name: 'SABAI', reconcile: { ...emptyReconcile(), doneLost: 1 }, warnings: ['x'], missingAssets: ['y.jpg'] },
      ],
      skipped: [{ folder: 'f', kind: 'pattern', reason: 'r' }],
      errors: [{ folder: 'f2', error: 'e' }],
    })
    await flushPromises()
    // Plage Unicode couvrant emoji/pictos/symboles usuels.
    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    expect(emojiRe.test(w.text())).toBe(false)
  })
})

// Depuis le 01/09 : les trois motifs de saut de la synchro ne voyagent plus en
// phrases françaises en dur mais en CODES structurés (WARNING_CODES sync.*), traduits à
// l'affichage par warningText. Ces tests montent un VRAI i18n et vérifient le rendu dans la
// langue ACTIVE du composant — l'ex-française ne doit plus jamais apparaître, et un écran
// allemand ne doit plus lire du français. (La COUVERTURE des phrases dans les 4 langues est
// déjà verrouillée par tests/unit/warning-i18n.spec.js ; ici on éprouve le CÂBLAGE.)
describe('motifs de saut : codes sync.* rendus dans la langue active', () => {
  const skippedReport = (reason) => ({
    merged: [],
    skipped: [{ folder: 'Patrons/orphelin [99]', kind: 'pattern', reason }],
    errors: [],
  })

  it('fr : sync.orphanFolder est rendu traduit (ex-phrase française en dur)', async () => {
    const w = mountIt()
    useSyncReportStore().setReport(skippedReport(W(WARNING_CODES.SYNC_ORPHAN_FOLDER)))
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.text()).toContain('Ignoré')
    expect(w.text()).toContain('dossier orphelin')
    expect(w.text()).not.toContain('warnings.sync')
  })

  it('en : le même code se rend en anglais (plus AUCUN français hérité)', async () => {
    const enI18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
    wrapper = mount(SyncReportDialog, { global: { plugins: [enI18n] }, attachTo: document.body })
    useSyncReportStore().setReport(skippedReport(W(WARNING_CODES.SYNC_ORPHAN_FOLDER)))
    await flushPromises()
    expect(wrapper.text()).toContain('Skipped')
    expect(wrapper.text()).toContain('orphan folder')
    expect(wrapper.text()).not.toContain('dossier orphelin')
    expect(wrapper.text()).not.toContain('warnings.sync')
  })

  it('fr : sync.projectWithoutPattern et sync.noForkedPattern sont rendus traduits', async () => {
    const w = mountIt()
    useSyncReportStore().setReport(
      skippedReport(W(WARNING_CODES.SYNC_PROJECT_WITHOUT_PATTERN)),
    )
    await flushPromises()
    expect(w.text()).toContain('projet introuvable ou sans patron lié')

    const w2 = mountIt()
    useSyncReportStore().setReport(skippedReport(W(WARNING_CODES.SYNC_NO_FORKED_PATTERN)))
    await flushPromises()
    expect(w2.text()).toContain('aucun patron forké')
  })

  it('fr : l’avertissement chart.repeatLabelLost (perte du libellé de diagramme) est rendu traduit', async () => {
    const w = mountIt()
    useSyncReportStore().setReport({
      merged: [
        {
          kind: 'pattern',
          id: 1,
          name: 'DEMO',
          reconcile: emptyReconcile(),
          warnings: [W(WARNING_CODES.CHART_REPEAT_LABEL_LOST)],
          missingAssets: [],
        },
      ],
      skipped: [],
      errors: [],
    })
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.text()).toContain('libellé(s) de diagramme non conservés')
    expect(w.text()).not.toContain('warnings.chart')
  })
})

// Erreurs SAF : une erreur portant un code du catalogue (fabrique E(),
// transportée ENTIÈRE par patron-md-sync.js dans report.errors) est rendue TRADUITE par
// warningText — même canal que les motifs de saut ci-dessus — pendant que son verbatim
// français d'origine (.message) reste accessible en attribut title (« le libellé i18n
// raconte, le verbatim diagnostique »). Une erreur brute (chaîne, objet hors catalogue)
// reste rendue telle quelle, SANS title. (La COUVERTURE des phrases dans les 4 langues est
// déjà verrouillée par tests/unit/warning-i18n.spec.js ; ici on éprouve le CÂBLAGE.)
describe('erreurs structurées saf.* : rendues traduites, verbatim en title', () => {
  const errorReport = (error) => ({
    merged: [],
    skipped: [],
    errors: [{ folder: 'Projets/lourde [1]', error }],
  })
  const safError = () =>
    E(
      WARNING_CODES.SAF_SIZE_MISMATCH,
      { path: 'Projets/lourde [1]/patron.json', read: 20, expected: 26 },
      'taille incohérente pour Projets/lourde [1]/patron.json : 20 octets lus pour 26 annoncés — fichier modifié pendant la lecture ?',
    )

  it('fr : saf.sizeMismatch est rendu traduit, le title porte le verbatim', async () => {
    const w = mountIt()
    useSyncReportStore().setReport(errorReport(safError()))
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(w.text()).toContain(
      'taille incohérente pour Projets/lourde [1]/patron.json : 20 octets lus pour 26 annoncés',
    )
    expect(w.text()).not.toContain('warnings.saf')
    // Le verbatim diagnostique survit au survol, pas dans le texte rendu.
    expect(w.find('.srd__line--warn').attributes('title')).toContain(
      'fichier modifié pendant la lecture ?',
    )
  })

  it('en : la même erreur se rend en anglais (plus AUCUN français hérité), verbatim en title', async () => {
    const enI18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
    wrapper = mount(SyncReportDialog, { global: { plugins: [enI18n] }, attachTo: document.body })
    useSyncReportStore().setReport(errorReport(safError()))
    await flushPromises()
    expect(wrapper.text()).toContain(
      'inconsistent size for Projets/lourde [1]/patron.json: 20 bytes read for 26 announced',
    )
    expect(wrapper.text()).not.toContain('taille incohérente')
    expect(wrapper.text()).not.toContain('warnings.saf')
    expect(wrapper.find('.srd__line--warn').attributes('title')).toContain(
      'fichier modifié pendant la lecture ?',
    )
  })

  it('erreur brute (chaîne) : rendue telle quelle, SANS attribut title', async () => {
    const w = mountIt()
    useSyncReportStore().setReport(errorReport('lecture impossible'))
    await flushPromises()
    expect(w.text()).toContain('lecture impossible')
    expect(w.find('.srd__line--warn').attributes('title')).toBeUndefined()
  })
})

describe('i18n patronSync — parité FR/EN', () => {
  it('mêmes clés dans fr.json et en.json', () => {
    expect(Object.keys(fr.patronSync).sort()).toEqual(Object.keys(en.patronSync).sort())
  })

  it('toutes les clés attendues sont présentes', () => {
    const expected = [
      'synced1',
      'syncedN',
      'reportTitle',
      'reportKeptProgress',
      'reportRedo',
      'reportWarning',
      'reportMissingImg',
      'reportChartStateLost',
      'reportSkipped',
      'reportError',
      'close',
    ]
    for (const key of expected) {
      expect(fr.patronSync).toHaveProperty(key)
      expect(en.patronSync).toHaveProperty(key)
    }
  })
})

// Revue du 19/08/2026, important 5. Un correctif antérieur a fait passer la condition
// de RENDU de la modale de `visible` à `hasSlot` (la file des messages), mais a laissé les
// EFFETS DE BORD calés sur `visible`. Conséquence mesurée quand un message plus fort tient
// l'écran (scénario réel : décision de sauvegarde non tranchée + resynchro au retour au
// premier plan, cf. App.vue) : le fond était verrouillé alors qu'aucune modale n'était
// peinte, et quand la modale apparaissait enfin, le focus n'y entrait jamais — son piège de
// focus (`onKeydown`) ne s'amorçait donc jamais. Régression d'accessibilité née de ce lot.
describe('effets de bord de la modale : ils suivent la FILE, pas la seule condition propre', () => {
  const rapportASignaler = () => ({
    merged: [
      { kind: 'pattern', id: 1, name: 'SABAI', reconcile: { ...emptyReconcile(), doneLost: 1 }, warnings: [], missingAssets: [] },
    ],
    skipped: [],
    errors: [],
  })

  it('montée alors que le rapport est DÉJÀ là : le verrou et le focus arrivent quand même', async () => {
    // Le `watch` de `displayedReport` est immédiat : `hasSlot` peut être vrai dès le setup.
    // Un `watch` d'effets de bord non immédiat serait alors INERTE — modale peinte, aucun
    // verrou, focus resté sur BODY (mesuré). Ce test est le seul à monter dans cet ordre-là.
    useSyncReportStore().setReport(rapportASignaler())

    const w = mountIt()
    await flushPromises()

    // PRÉCONDITION : la modale est bien peinte — sinon l'absence de verrou serait normale.
    expect(w.find('.srd-overlay').exists()).toBe(true)

    expect(document.body.style.overflow).toBe('hidden')
    expect(document.activeElement?.textContent).toBe(fr.patronSync.close)
  })

  it("ne touche PAS au verrou d un autre composant tant qu elle n a rien verrouillé", async () => {
    // L'autre moitié de `immediate: true` : au tout premier appel, `hasSlot` est faux. Sans
    // garde, cet appel effacerait un verrou posé par la visionneuse de photos ou la porte du
    // dossier — un fond qui redéfile sous une modale ouverte par quelqu'un d'autre.
    document.body.style.overflow = 'hidden' // un autre composant tient le fond

    mountIt()
    await flushPromises()

    expect(document.body.style.overflow).toBe('hidden')
  })

  it('retenue par un message plus fort : le fond N EST PAS verrouillé, et le focus entre quand elle apparaît', async () => {
    const q = useNoticeQueueStore()
    // Rang 3 contre rang 4 : exactement la paire du scénario réel (décision de sauvegarde
    // en attente pendant qu'une resynchro produit un rapport à signaler).
    q.request(NOTICE.BACKUP_DECISION)

    const w = mountIt()
    useSyncReportStore().setReport(rapportASignaler())
    await flushPromises()

    // PRÉCONDITION : la situation existe vraiment — le rapport VEUT l'écran, un plus fort le
    // tient, et rien n'est peint. Sans elle, les deux assertions suivantes seraient vraies
    // pour la mauvaise raison.
    expect(q.requesters).toContain(NOTICE.SYNC_REPORT)
    expect(q.active).toBe(NOTICE.BACKUP_DECISION)
    expect(w.find('.srd-overlay').exists()).toBe(false)

    // Ce qui est prouvé : aucune modale peinte ⇒ aucun verrou de défilement sur le fond.
    expect(document.body.style.overflow).toBe('')

    // Le plus fort se retire : la modale apparaît POUR DE BON — c'est à cet instant que le
    // verrou doit se poser et que le focus doit entrer dans le dialogue.
    q.withdraw(NOTICE.BACKUP_DECISION)
    await flushPromises()

    expect(w.find('.srd-overlay').exists()).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.activeElement?.textContent).toBe(fr.patronSync.close)
  })
})

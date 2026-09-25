// @vitest-environment jsdom
// Depuis le 17/08 (chantier 3, trois retouches) : après une conversion locale réussie
// (PDF non scanné), l'écran enregistre le patron et RESTE affiché — un bloc de réussite
// montre son nom et un bouton d'action principal, « Voir le patron », qui fait la
// navigation au clic (depuis le 19/08, un second bouton, « Comment corriger », renvoie
// au guide — cf. le describe dédié plus bas). Plus de navigation automatique, sur aucun
// des trois chemins d'import (PDF, ZIP,
// « Importer quand même », cf. tests/unit/local-pdf-import-blocking.spec.js et
// tests/unit/local-import-zip-door.spec.js). Les warnings d'import sont poussés dans le
// store transitoire import-report (consommés par PatternView, affichés en bandeau
// persistant fermable — jamais en snackbar, règle « jamais perdre d'info »).
// L'abandon PENDANT la conversion (busy) reste possible et intact.
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import fr from '@/i18n/fr.json'
import { createTestI18n } from './helpers/i18n-router'

vi.mock('@/utils/pdf-import', () => ({ parsePdfLocally: vi.fn() }))
// Objet partagé (via vi.hoisted, sinon TDZ car vi.mock est hoisté avant les
// const normales) : permet aux tests d'espionner router.replace/push, quel
// que soit le montage qui a déclenché l'appel.
const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => router }))
import { parsePdfLocally } from '@/utils/pdf-import'
import { GUIDE_SECTION_BIBLIOTHEQUE } from '@/constants/guide-sections'
import LocalPdfImportView from '@/views/LocalPdfImportView.vue'
import ImportProgress from '@/components/ImportProgress.vue'
import { usePatternsStore } from '@/stores/patterns'
import { useImportHandoff } from '@/stores/import-handoff'
import { useImportReportStore } from '@/stores/import-report'
import { CONTACT_EMAIL } from '@/constants/app-links'

const i18n = createTestI18n()
const stubs = { AppHeader: true, AppIcon: true }

const okResult = (overrides = {}) => ({
  scanned: false,
  pattern: { name: 'Pull', photos: [] },
  reader: { sizeLabels: [], sections: [], reference: {} },
  warnings: [],
  confidence: { global: 90, level: 'high', bySection: {} },
  stats: {},
  ...overrides,
})

function mountView() {
  return mount(LocalPdfImportView, {
    global: { plugins: [createTestingPinia({ createSpy: vi.fn }), i18n], stubs },
  })
}

// Variante qui expose le pinia de test pour pouvoir configurer le retour de
// patternsStore.add (id sauvegardé), nécessaire pour vérifier la navigation.
function mountViewWithSavedId(id) {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n], stubs } })
  usePatternsStore(pinia).add.mockResolvedValue(id)
  return { w, pinia }
}

function findButtonByText(w, text) {
  return w.findAll('button').find((b) => b.text().includes(text))
}

async function pick(wrapper, file = new File(['x'], 'pull.pdf')) {
  const input = wrapper.find('input[type=file]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

describe('LocalPdfImportView', () => {
  it('écran au repos : dit ce qui se passe après l’analyse (enregistrement direct), et l’input reste enfant direct du label (sélecteur natif intact)', () => {
    const w = mountView()
    expect(w.text()).toContain(fr.importLocal.leadNext)
    // 🚩 Garde anti-régression du piège : rien ne doit s'être glissé entre le <label>
    // et son <input> — le sélecteur de fichiers natif exige un enfant DIRECT.
    const label = w.find('label.file-pick')
    expect(label.exists()).toBe(true)
    const input = label.element.querySelector(':scope > input[type="file"]')
    expect(input).not.toBeNull()
  })

  it('le sélecteur de fichier est un bouton design-system, pas un input brut', () => {
    const w = mountView()
    const label = w.find('label.file-pick.btn')
    expect(label.exists()).toBe(true)
    const input = label.find('input[type="file"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('accept')).toContain('pdf')
  })

  it('l’input fichier reste focusable au clavier (pas [hidden], WCAG 2.1.1)', () => {
    // [hidden] = display:none → hors ordre de tabulation et arbre d'accessibilité.
    const w = mountView()
    const input = w.find('label.file-pick input[type="file"]')
    expect(input.attributes('hidden')).toBeUndefined()
    expect(input.classes()).toContain('file-pick__input')
  })

  it('import réussi (non scanné) → enregistre, reste sur l’écran, et affiche un bloc avec « Voir le patron »', async () => {
    parsePdfLocally.mockResolvedValue(okResult())
    router.push.mockClear()
    router.replace.mockClear()
    const { w } = mountViewWithSavedId(7)
    await pick(w)
    // Pas de navigation automatique : c'est tout le sens de ce chantier.
    expect(router.replace).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
    // Le bloc de réussite affiche le nom du patron enregistré.
    expect(w.text()).toContain(fr.importLocal.summaryTitle)
    expect(w.text()).toContain('Pull') // okResult() → pattern.name = 'Pull'
    // « Voir le patron » est là (depuis le 19/08, « Comment corriger » s'y ajoute — cf.
    // le describe dédié plus bas — mais les boutons du sélecteur/de l'abandon, eux, ont
    // bien disparu).
    expect(findButtonByText(w, fr.importLocal.viewPattern)).toBeTruthy()
    expect(w.find('.file-pick').exists()).toBe(false)
    expect(findButtonByText(w, fr.importLocal.cancelImport)).toBeUndefined()
  })

  it('« Voir le patron » navigue vers la fiche, avec l’id enregistré', async () => {
    parsePdfLocally.mockResolvedValue(okResult())
    router.replace.mockClear()
    const { w } = mountViewWithSavedId(7)
    await pick(w)
    await findButtonByText(w, fr.importLocal.viewPattern).trigger('click')
    expect(router.replace).toHaveBeenCalledWith({ name: 'pattern', params: { id: 7 } })
  })

  it('le bloc de réussite annonce le nombre de points à vérifier, quand il y en a', async () => {
    parsePdfLocally.mockResolvedValue(okResult({ warnings: ['Section « Manches » incertaine'] }))
    const { w } = mountViewWithSavedId(8)
    await pick(w)
    expect(w.text()).toContain(fr.importLocal.warnings.replace('{n}', '1'))
  })

  it('sans avertissement, le bloc de réussite ne mentionne aucun point à vérifier', async () => {
    parsePdfLocally.mockResolvedValue(okResult({ warnings: [] }))
    const { w } = mountViewWithSavedId(9)
    await pick(w)
    expect(w.text()).not.toContain('à vérifier')
  })

  it('les avertissements de l’import sont poussés dans le store transitoire, keyés par l’id enregistré', async () => {
    // confidence.global: 90 (défaut okResult) → qualité haute, 3e argument low=false explicite
    // (set() pousse désormais toujours le drapeau lowConfidence).
    parsePdfLocally.mockResolvedValue(okResult({ warnings: ['Section « Manches » incertaine'] }))
    const pinia = createTestingPinia({ createSpy: vi.fn })
    usePatternsStore(pinia).add.mockResolvedValue(13)
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n], stubs } })
    await pick(w)
    expect(useImportReportStore(pinia).set).toHaveBeenCalledWith(13, ['Section « Manches » incertaine'], false)
  })

  it('sans avertissement, le store transitoire est quand même mis à jour (tableau vide) — PatternView décide de ne rien afficher', async () => {
    parsePdfLocally.mockResolvedValue(okResult({ warnings: [] }))
    const pinia = createTestingPinia({ createSpy: vi.fn })
    usePatternsStore(pinia).add.mockResolvedValue(14)
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n], stubs } })
    await pick(w)
    expect(useImportReportStore(pinia).set).toHaveBeenCalledWith(14, [], false)
  })

  it('confidence.global < 50 pousse lowConfidence=true dans le store transitoire', async () => {
    parsePdfLocally.mockResolvedValue(okResult({ warnings: [], confidence: { global: 42, level: 'low', bySection: {} } }))
    const pinia = createTestingPinia({ createSpy: vi.fn })
    usePatternsStore(pinia).add.mockResolvedValue(15)
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n], stubs } })
    await pick(w)
    expect(useImportReportStore(pinia).set).toHaveBeenCalledWith(15, [], true)
  })

  it('confidence.global === 50 (limite) ne déclenche PAS lowConfidence (seuil strict <50)', async () => {
    parsePdfLocally.mockResolvedValue(okResult({ warnings: [], confidence: { global: 50, level: 'medium', bySection: {} } }))
    const pinia = createTestingPinia({ createSpy: vi.fn })
    usePatternsStore(pinia).add.mockResolvedValue(16)
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n], stubs } })
    await pick(w)
    expect(useImportReportStore(pinia).set).toHaveBeenCalledWith(16, [], false)
  })

  it('PDF scanné → pas d’enregistrement automatique ; le message rendu affiche l’adresse de contact', async () => {
    // Le message « PDF scanné » invite à la saisie manuelle ou au contact — et cette adresse
    // vient de `t('importLocal.scanned', { email: CONTACT_EMAIL })` : ancré sur le texte
    // RENDU, pas sur la clé JSON (« la chaîne existe dans le JSON » ne prouve rien —
    // leçon du lot « guide à jour »). Une interpolation manquante rendrait le littéral
    // "{email}" au lieu de l'adresse : les deux assertions ci-dessous le détecteraient.
    parsePdfLocally.mockResolvedValue({ scanned: true, notPattern: false, notPatternReason: null, rejected: { reason: 'scanned', detail: null }, pattern: null, reader: null, warnings: [], confidence: null, stats: null, blocking: null })
    router.replace.mockClear()
    const pinia = createTestingPinia({ createSpy: vi.fn })
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n], stubs } })
    await pick(w)
    expect(w.text()).toMatch(/scann/i)
    expect(w.text().toLowerCase()).not.toContain('zip')
    expect(w.text()).toContain(CONTACT_EMAIL)
    expect(w.text()).not.toContain('{email}')
    expect(usePatternsStore(pinia).add).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('pas un patron → refus : message avec l’adresse de contact, rien d’enregistré, pas de forçage', async () => {
    parsePdfLocally.mockResolvedValue({ scanned: false, notPattern: true, notPatternReason: 'otherCraft', rejected: { reason: 'notPattern', detail: 'otherCraft' }, pattern: null, reader: null, warnings: [], confidence: null, stats: null, blocking: null })
    router.replace.mockClear()
    const pinia = createTestingPinia({ createSpy: vi.fn })
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n], stubs } })
    await pick(w)
    expect(w.text()).toContain(fr.importLocal.notPattern.replace('{email}', CONTACT_EMAIL))
    expect(w.text()).not.toContain('{email}')
    expect(w.find('.block-anyway').exists()).toBe(false)
    expect(usePatternsStore(pinia).add).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
    // On peut choisir un autre fichier.
    expect(w.find('label.file-pick input[type="file"]').exists()).toBe(true)
  })

  it('la sauvegarde utilise le reader tel quel : une section-diagramme (promote-grids) n’est pas re-normalisée/altérée', async () => {
    // Avant ce lot, currentPattern() repassait le reader dans normalizeReaderForSave,
    // ce qui recalcule les ids (slug du titre) — risque de désynchroniser une
    // section-diagramme déjà assemblée par promoteGridSections (plan §Self-Review).
    const chartSection = {
      id: 'diagramme-1',
      kind: 'diagramme',
      title: 'Diagramme 1',
      steps: [{ chart: true }],
      chart: { rows: 0, cols: 0, img: 'data:image/png;base64,X', repeat: '', readDir: '', builtinLegend: false },
    }
    parsePdfLocally.mockResolvedValue(okResult({ reader: { sizeLabels: ['Taille unique'], sections: [chartSection], reference: {} } }))
    const pinia = createTestingPinia({ createSpy: vi.fn })
    usePatternsStore(pinia).add.mockResolvedValue(9)
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n], stubs } })
    await pick(w)
    const saved = usePatternsStore(pinia).add.mock.calls[0][0]
    expect(saved.reader.sections[0].chart).toEqual(chartSection.chart)
    expect(saved.reader.sections[0].steps[0]).toEqual({ chart: true })
  })

  it('bouton « Interrompre l’import » : abandon PENDANT la conversion — rien n’est enregistré, résultat tardif ignoré', async () => {
    let resolveParse
    parsePdfLocally.mockReturnValue(new Promise((resolve) => { resolveParse = resolve }))
    router.replace.mockClear()
    const pinia = createTestingPinia({ createSpy: vi.fn })
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n], stubs } })
    const input = w.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'pull.pdf')] })
    await input.trigger('change')
    await flushPromises()
    const abortBtn = findButtonByText(w, fr.importLocal.cancelImport)
    expect(abortBtn).toBeTruthy() // toujours accessible pendant la conversion (busy)
    await abortBtn.trigger('click')
    // La conversion en cours n'est pas annulable côté moteur : elle se termine
    // quand même, mais son résultat tardif doit être ignoré par l'écran déjà réinitialisé —
    // en particulier, il ne doit PAS déclencher l'enregistrement + navigation auto.
    resolveParse(okResult())
    await flushPromises()
    expect(usePatternsStore(pinia).add).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
    expect(w.text()).not.toContain('Pull')
  })

  it('un 2e fichier choisi PENDANT que la 1re écriture est encore en vol invalide sa résolution tardive : nettoyage, pas de navigation', async () => {
    // Variante « race » de l'abandon : le jeton d'import change aussi quand un nouvel
    // import démarre (pas seulement via le bouton Interrompre). ensureSaved doit
    // détecter que sa propre écriture est devenue obsolète et nettoyer la ligne
    // orpheline, exactement comme pour un abandon explicite (cf. ensureSaved).
    parsePdfLocally.mockResolvedValue(okResult())
    router.replace.mockClear()
    const pinia = createTestingPinia({ createSpy: vi.fn })
    let resolveAdd
    usePatternsStore(pinia).add.mockReturnValue(new Promise((resolve) => { resolveAdd = resolve }))
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n], stubs } })

    await pick(w, new File(['a'], 'a.pdf')) // parse résout, ensureSaved démarre, add() reste en vol
    // Le sélecteur .file-pick est maintenant masqué tant que `busy`
    // est vrai (or `busy` reste vrai pendant toute l'écriture en vol ci-dessus) —
    // impossible d'atteindre l'input via le DOM ici. On appelle directement le
    // handler exposé par le composant (script setup l'expose sans defineExpose,
    // cf. vérification faite en amont) pour continuer à couvrir la garde par
    // jeton d'ensureSaved, qui reste une protection valide en profondeur même si
    // ce chemin UI précis n'est plus atteignable au clic.
    await w.vm.onFile({ target: { files: [new File(['b'], 'b.pdf')], value: '' } }) // un 2e import démarre : incrémente le jeton
    await flushPromises()

    resolveAdd(42) // la 1re écriture (devenue obsolète) se termine malgré tout
    await flushPromises()

    // Plus aucun appel de replace n'est fait par le composant lui-même désormais
    // (seul le clic sur « Voir le patron » le ferait, jamais atteint ici).
    expect(router.replace).not.toHaveBeenCalled()
    expect(usePatternsStore(pinia).remove).toHaveBeenCalledWith(42)
  })

  it('masque le choix de fichier pendant l’extraction (busy)', async () => {
    // parsePdfLocally qui ne se résout jamais → busy reste vrai
    parsePdfLocally.mockImplementationOnce(() => new Promise(() => {}))
    const w = mountView()
    // Choix de fichier visible AVANT l'import
    expect(w.find('.file-pick').exists()).toBe(true)
    // Déclenche l'import (réutilise le helper de sélection de fichier du fichier de test)
    await pick(w)
    // Pendant l'extraction : plus de choix de fichier, mais la progression est là
    expect(w.find('.file-pick').exists()).toBe(false)
    expect(w.findComponent(ImportProgress).exists()).toBe(true)
  })

  it('démarre l’import au montage si un fichier est en attente (relais biblio), et affiche le bloc de réussite une fois enregistré', async () => {
    parsePdfLocally.mockResolvedValue(okResult({ pattern: { name: 'Écharpe', photos: [] } }))
    router.replace.mockClear()
    // stubActions:false : useImportHandoff.set()/take() doivent tourner pour de vrai
    // (sinon take() — stubbé par défaut — renverrait toujours undefined, et l'import
    // ne démarrerait jamais au montage). patternsStore.add est ensuite remplacé
    // manuellement par un spy pour contrôler l'id renvoyé (assertion de navigation).
    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false })
    useImportHandoff(pinia).set(new File(['x'], 'echarpe.pdf'))
    usePatternsStore(pinia).add = vi.fn().mockResolvedValue(21)
    // Le mock parsePdfLocally est partagé par tout le fichier de test (pas de
    // clearMocks configuré) : on repart d'un compteur propre pour n'observer
    // que l'appel déclenché par ce montage.
    parsePdfLocally.mockClear()
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n], stubs } })
    await flushPromises()
    expect(parsePdfLocally).toHaveBeenCalledTimes(1)
    expect(router.replace).not.toHaveBeenCalled()
    expect(w.text()).toContain('Écharpe')
  })

  // Lot du 19/08/2026 — LE BLOC DE RÉUSSITE AVERTIT TOUJOURS.
  //
  // Avant ce lot, il ne disait rien du tout quand l'import ne levait aucun avertissement : la
  // ligne « n point(s) à vérifier » est conditionnée à n > 0. Or c'est exactement le cas qui
  // inquiète — la conversion peut se tromper SANS lever le moindre avertissement.
  describe('bloc de réussite : l avertissement de conversion', () => {
    it('G6 — avec ZÉRO avertissement, la phrase fixe est là', async () => {
      parsePdfLocally.mockResolvedValue(okResult({ warnings: [] }))
      const { w } = mountViewWithSavedId(7)
      await pick(w)

      // PRÉCONDITION 1 : le bloc de réussite est bien rendu — l'import a abouti.
      expect(w.find('.done').exists()).toBe(true)
      // PRÉCONDITION 2 : on est bien dans le cas SANS avertissement. Sans elle, le test
      // pourrait passer sur un import qui en lève, et ne prouverait rien du cas muet.
      expect(w.find('.done__warncount').exists()).toBe(false)

      expect(w.text()).toContain(fr.importLocal.caveatBody)
    })

    it('avec des avertissements, la phrase fixe est là AUSSI, en plus du compte', async () => {
      parsePdfLocally.mockResolvedValue(okResult({ warnings: [{ code: 'x' }, { code: 'y' }] }))
      const { w } = mountViewWithSavedId(8)
      await pick(w)

      expect(w.find('.done').exists()).toBe(true)
      expect(w.find('.done__warncount').exists()).toBe(true) // le compte est bien là
      expect(w.text()).toContain(fr.importLocal.caveatBody) // et la phrase fixe aussi
    })

    it('« Comment corriger » mène au guide, sur la section Bibliothèque', async () => {
      router.push.mockClear() // aucun autre test du fichier n'appelle push, mais on isole quand même
      parsePdfLocally.mockResolvedValue(okResult({ warnings: [] }))
      const { w } = mountViewWithSavedId(9)
      await pick(w)

      const bouton = findButtonByText(w, fr.importLocal.doneHowToFix)
      expect(bouton).toBeTruthy() // précondition : le bouton existe
      await bouton.trigger('click')

      expect(router.push).toHaveBeenCalledWith({
        name: 'guide',
        query: { section: GUIDE_SECTION_BIBLIOTHEQUE },
      })
    })

    it('tant que rien n est enregistré, aucune phrase d avertissement', () => {
      const w = mountView()
      // ANCRAGE POSITIF, en premier : deux assertions d'absence seules resteraient vertes
      // sur un écran complètement cassé (rien ne s'affiche ⇒ rien ne dépasse). On prouve
      // d'abord que l'écran au repos EST là, avec son bouton de choix de fichier.
      expect(w.find('label.file-pick').exists()).toBe(true)
      expect(w.text()).toContain(fr.importLocal.pick)
      expect(w.find('.done').exists()).toBe(false)
      expect(w.text()).not.toContain(fr.importLocal.caveatBody)
    })
  })
})

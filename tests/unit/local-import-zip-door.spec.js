// @vitest-environment jsdom
// Import d'un patron au format Rowtine (.rowtine ou .zip : patron .md + images) sur l'écran
// d'import. Porte visible depuis le 23/09 (mode `format: 'rowtine'`) ; un zip déposé par la
// porte PDF reste reconnu à son contenu. Garde e2e associée : tests/e2e/import-zip.spec.js.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { zipSync, strToU8 } from 'fflate'
import fr from '@/i18n/fr.json'
import { createTestI18n, makeTk } from './helpers/i18n-router'

// Le moteur PDF est simulé : il ne doit JAMAIS être appelé pour un zip — c'est une des
// assertions ci-dessous.
vi.mock('@/utils/pdf-import', () => ({ parsePdfLocally: vi.fn() }))
const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => router }))
// Vraie reconnaissance, enveloppée pour pouvoir simuler une lecture qui échoue.
vi.mock('@/utils/import-kind', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, sniffFile: vi.fn(actual.sniffFile) }
})

import { parsePdfLocally } from '@/utils/pdf-import'
import { sniffFile } from '@/utils/import-kind'
import LocalPdfImportView from '@/views/LocalPdfImportView.vue'
import { usePatternsStore } from '@/stores/patterns'
import { useImportHandoff } from '@/stores/import-handoff'
import { useImportReportStore } from '@/stores/import-report'

const i18n = createTestI18n()
const tk = makeTk(i18n)
const stubs = { AppHeader: true, AppIcon: true, ImportProgress: true }

const MD = `---
rowtine: 1
title: Mini Patron
sizes: Taille unique
---

## Corps {body}

- Monter 20 mailles.
`

// ⚠️ Le front-matter Rowtine-MD sépare les tailles par un middot ` · `, PAS par la forme
// YAML [S, M, L] (piège relevé le 19/07). Ici « Taille unique », donc sans objet.
function zipFile(files = { 'patron.md': strToU8(MD) }, name = 'mini-patron.zip') {
  return new File([zipSync(files)], name, { type: 'application/zip' })
}

function mountWithSavedId(id, props = {}) {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const w = mount(LocalPdfImportView, { props, global: { plugins: [pinia, i18n], stubs } })
  usePatternsStore(pinia).add.mockResolvedValue(id)
  return { w, pinia }
}

async function pick(w, file) {
  const input = w.find('input[type=file]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

describe('un .zip déposé dans l’import PDF', () => {
  beforeEach(() => {
    router.replace.mockClear()
    router.push.mockClear()
    parsePdfLocally.mockClear()
  })

  it('est reconnu, enregistré, et reste sur l’écran avec un bouton vers la fiche', async () => {
    const { w, pinia } = mountWithSavedId(42)
    await pick(w, zipFile())
    const add = usePatternsStore(pinia).add
    expect(add).toHaveBeenCalledOnce()
    expect(add.mock.calls[0][0].name).toBe('Mini Patron')
    // Pas de navigation automatique — le zip est un des trois chemins concernés.
    expect(router.replace).not.toHaveBeenCalled()
    expect(w.text()).toContain('Mini Patron')
    // Le patron.md de zipFile() a une vraie section (« Corps ») : le bloc de réussite
    // propose donc « Prévisualiser le patron » (bouton principal), pas le repli
    // « Voir le patron » — même condition que le bouton Prévisualiser de PatternView.vue.
    const previewBtn = w.findAll('button').find((b) => b.text().includes(fr.pattern.preview))
    await previewBtn.trigger('click')
    expect(router.replace).toHaveBeenCalledWith({ name: 'pattern', params: { id: 42 } })
    expect(router.push).toHaveBeenCalledWith({ name: 'pattern-read', params: { id: 42 } })
  })

  it('n’appelle JAMAIS le moteur PDF', async () => {
    // Sans cette assertion, un aiguillage cassé qui enverrait le zip dans parsePdfLocally
    // passerait inaperçu tant que le moteur simulé ne lève pas.
    const { w } = mountWithSavedId(1)
    await pick(w, zipFile())
    expect(parsePdfLocally).not.toHaveBeenCalled()
  })

  it('pousse les avertissements vers la fiche, sans qualité faible', async () => {
    const { w, pinia } = mountWithSavedId(7)
    const report = useImportReportStore(pinia)
    await pick(w, zipFile())
    // 3e argument `low` = false : l’import zip n’a pas d’indice de confiance, il ne doit
    // donc PAS faire afficher le bandeau « qualité faible » de la fiche patron.
    expect(report.set).toHaveBeenCalledWith(7, expect.any(Array), false)
    // L'ordre AVANT/navigation n'a plus de sens : il n'y a plus de navigation
    // automatique. Ce qui reste vérifiable : le relais est posé dès l'enregistrement,
    // avant même que le bloc de réussite (donc son bouton d'action) existe.
    expect(w.findAll('button').some((b) => b.text().includes(fr.pattern.preview))).toBe(true)
  })

  it('un zip sans fichier patron affiche le message dédié, et n’enregistre rien', async () => {
    const { w, pinia } = mountWithSavedId(3)
    await pick(w, zipFile({ 'lisezmoi.txt': strToU8('rien ici') }))
    expect(w.text()).toContain(fr.importZip.noMd)
    expect(usePatternsStore(pinia).add).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('un abandon pendant la lecture de l’archive n’enregistre rien et ne navigue pas', async () => {
    // Fait mordre la garde `if (token !== importToken) return` de startZipImport (ligne
    // juste après `await file.arrayBuffer()`) : c'est la fenêtre d'abandon documentée en
    // commentaire, jusqu'ici jamais exercée par un test (constat de revue, ronde 1).
    const { w, pinia } = mountWithSavedId(99)
    const file = zipFile()
    // Octets réels capturés AVANT de médiatiser l'appel : si la garde disparaît, la suite
    // (unzipToPattern → saveAndFinish → ensureSaved) doit pouvoir aller au bout avec un
    // contenu valide — sinon un simple échec de parsing masquerait l'absence de garde.
    const realBuf = await file.arrayBuffer()
    let resolveBuf
    file.arrayBuffer = vi.fn(() => new Promise((resolve) => { resolveBuf = resolve }))

    const input = w.find('input[type=file]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    // Attend que startZipImport soit arrivé à `await file.arrayBuffer()` (lecture EN VOL,
    // jamais résolue tant que resolveBuf n'est pas appelé).
    await vi.waitFor(() => expect(file.arrayBuffer).toHaveBeenCalled())

    // Abandon pendant que la lecture de l'archive est en vol : le bouton « Interrompre
    // l'import » est visible tant que `busy` est vrai et `saving` faux (pas encore atteint
    // ensureSaved).
    await w.find('button.mt2').trigger('click')

    // La lecture se termine APRÈS l'abandon, avec de VRAIS octets : sans la garde, l'import
    // irait jusqu'au bout (enregistrement + navigation) malgré l'abandon.
    resolveBuf(realBuf)
    await flushPromises()

    expect(usePatternsStore(pinia).add).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('consomme aussi le relais depuis la Bibliothèque', async () => {
    // Le relais est semé AVANT le montage, et `add` est armé AVANT lui aussi : onMounted
    // démarre l'import immédiatement (la reconnaissance du fichier est déjà en vol quand
    // le test reprend la main). Armer après le montage laisserait passer une course.
    //
    // ⚠️ Ne PAS utiliser `stubActions: false` ici : `patternsStore.add` deviendrait la VRAIE
    // action, qui écrit en IndexedDB.
    // Avec les actions simulées, `set()` n'écrit rien ET `take()` rendrait `undefined` :
    // c'est donc le RETOUR de `take()` qu'on arme, pas l'état du relais. (Le relais réel est
    // `pendingFile` + `set`/`take`, cf. src/stores/import-handoff.js.)
    const pinia = createTestingPinia({ createSpy: vi.fn })
    useImportHandoff(pinia).take.mockReturnValue(zipFile())
    usePatternsStore(pinia).add.mockResolvedValue(11)
    const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n], stubs } })
    await flushPromises()
    expect(router.replace).not.toHaveBeenCalled()
    expect(w.text()).toContain(fr.importLocal.summaryTitle)
  })

  it('en mode PDF, le filtre du sélecteur ne propose que le PDF', async () => {
    const { w } = mountWithSavedId(1)
    const accept = w.find('label.file-pick input[type="file"]').attributes('accept')
    expect(accept).toBe('application/pdf,.pdf')
  })
})

describe('mode Rowtine (porte « Importer au format Rowtine »)', () => {
  const ROWTINE = { format: 'rowtine' }
  const pdfFile = () => new File(['%PDF-1.4 faux'], 'patron.pdf', { type: 'application/pdf' })

  beforeEach(() => {
    router.replace.mockClear()
    parsePdfLocally.mockClear()
  })

  it('titre, accroche et bouton de choix disent le format Rowtine', () => {
    const { w } = mountWithSavedId(1, ROWTINE)
    expect(w.findComponent({ name: 'AppHeader' }).attributes('title')).toBe(tk('importLocal.titleRowtine'))
    expect(w.text()).toContain(tk('importLocal.leadRowtine'))
    expect(w.find('label.file-pick').text()).toContain(tk('importLocal.pickRowtine'))
    expect(w.text()).not.toContain(tk('importLocal.lead'))
  })

  it('le filtre du sélecteur accepte .rowtine et .zip, types MIME compris (Android)', () => {
    const { w } = mountWithSavedId(1, ROWTINE)
    const accept = w.find('label.file-pick input[type="file"]').attributes('accept').split(',')
    for (const a of ['.rowtine', '.zip', 'application/zip', 'application/x-zip-compressed', 'application/octet-stream']) {
      expect(accept).toContain(a)
    }
    expect(accept.join(',')).not.toContain('pdf')
  })

  it('importe un .rowtine (même format qu’un zip)', async () => {
    const { w, pinia } = mountWithSavedId(5, ROWTINE)
    await pick(w, zipFile(undefined, 'mini.rowtine'))
    expect(usePatternsStore(pinia).add).toHaveBeenCalledOnce()
    expect(parsePdfLocally).not.toHaveBeenCalled()
  })

  it('un PDF est refusé avec l’erreur d’archive, sans passer par le moteur PDF', async () => {
    const { w, pinia } = mountWithSavedId(2, ROWTINE)
    await pick(w, pdfFile())
    expect(w.text()).toContain(tk('importZip.badZip'))
    expect(parsePdfLocally).not.toHaveBeenCalled()
    expect(usePatternsStore(pinia).add).not.toHaveBeenCalled()
    // L'écran reste utilisable : le bouton de choix revient.
    expect(w.find('label.file-pick').exists()).toBe(true)
  })

  it('un contenu inconnu est refusé (pas de repli sur la voie PDF)', async () => {
    const { w } = mountWithSavedId(2, ROWTINE)
    await pick(w, new File(['bonjour'], 'x.rowtine'))
    expect(w.text()).toContain(tk('importZip.badZip'))
    expect(parsePdfLocally).not.toHaveBeenCalled()
  })

  it('un fichier illisible est refusé lui aussi', async () => {
    sniffFile.mockRejectedValueOnce(new Error('illisible'))
    const { w } = mountWithSavedId(2, ROWTINE)
    await pick(w, new File(['x'], 'x.rowtine'))
    expect(w.text()).toContain(tk('importZip.badZip'))
    expect(parsePdfLocally).not.toHaveBeenCalled()
  })
})

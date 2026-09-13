// PORTE DE SERVICE (08/08) — un .zip déposé dans l'import PDF est traité comme un patron
// déjà mis en forme. Invisible dans l'interface : c'est le point du lot. Ce fichier et
// tests/e2e/import-zip.spec.js sont les DEUX seuls gardes de cette fonction ; tous deux
// doivent être prouvés par mutation (cf. plan, étape 5).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { createI18n } from 'vue-i18n'
import { zipSync, strToU8 } from 'fflate'
import fr from '@/i18n/fr.json'

// Le moteur PDF est simulé : il ne doit JAMAIS être appelé pour un zip — c'est une des
// assertions ci-dessous.
vi.mock('@/utils/pdf-import', () => ({ parsePdfLocally: vi.fn() }))
const { router } = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }))
vi.mock('vue-router', () => ({ useRouter: () => router }))

import { parsePdfLocally } from '@/utils/pdf-import'
import LocalPdfImportView from '@/views/LocalPdfImportView.vue'
import { usePatternsStore } from '@/stores/patterns'
import { useImportHandoff } from '@/stores/import-handoff'
import { useImportReportStore } from '@/stores/import-report'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
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

function mountWithSavedId(id) {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const w = mount(LocalPdfImportView, { global: { plugins: [pinia, i18n], stubs } })
  usePatternsStore(pinia).add.mockResolvedValue(id)
  return { w, pinia }
}

async function pick(w, file) {
  const input = w.find('input[type=file]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

describe('porte de service : un .zip déposé dans l’import PDF', () => {
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
    const viewBtn = w.findAll('button').find((b) => b.text().includes(fr.importLocal.viewPattern))
    await viewBtn.trigger('click')
    expect(router.replace).toHaveBeenCalledWith({ name: 'pattern', params: { id: 42 } })
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
    // avant même que le bloc de réussite (donc le bouton « Voir le patron ») existe.
    expect(w.findAll('button').some((b) => b.text().includes(fr.importLocal.viewPattern))).toBe(true)
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
    expect(w.text()).toContain(fr.importLocal.doneTitle)
  })

  it('le filtre du sélecteur laisse passer le zip (sinon la porte ne s’ouvre pas sur Android)', async () => {
    const { w } = mountWithSavedId(1)
    const accept = w.find('label.file-pick input[type="file"]').attributes('accept')
    expect(accept).toContain('pdf')
    expect(accept).toContain('zip')
  })
})

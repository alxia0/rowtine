// @vitest-environment jsdom
// Écran d'import Ravelry : bloc explicatif → sélecteur de fichier → résumé → confirmation.
// Motif de montage/déclenchement de fichier : tests/unit/local-pdf-import-view.spec.js.
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import fr from '@/i18n/fr.json'
import RavelryImportView from '@/views/RavelryImportView.vue'
import { useYarnsStore } from '@/stores/yarns'
import { usePurchasesStore } from '@/stores/purchases'
import { useSettingsStore } from '@/stores/settings'
import { makeRavelryFile } from './helpers/make-ravelry-file'
import { createTestI18n } from './helpers/i18n-router'

const i18n = createTestI18n()
const stubs = { AppHeader: true, AppIcon: true }

const HEADERS = [
  'Status', 'Brand', 'Yarn', 'Colorway', 'Weight', 'Grams/skein', 'Meters/skein',
  'Skeins', 'Remaining skeins', 'Price paid', 'Purchase date', 'Dye lot', 'Purchased at',
]

function mountView(existingYarns = [], currency = 'CHF') {
  const pinia = createTestingPinia({ createSpy: vi.fn })
  const yarnsStore = useYarnsStore(pinia)
  yarnsStore.yarns = existingYarns
  yarnsStore.loaded = true
  const settingsStore = useSettingsStore(pinia)
  // Devise volontairement différente du défaut (EUR) : une assertion sur EUR passerait
  // même si confirmImport() ne lisait jamais le store des réglages.
  settingsStore.currency = currency
  settingsStore.loaded = true
  const w = mount(RavelryImportView, { global: { plugins: [pinia, i18n], stubs } })
  return { w, yarnsStore, purchasesStore: usePurchasesStore(pinia), settingsStore }
}

async function pick(w, file) {
  const input = w.find('input[type=file]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

describe('RavelryImportView', () => {
  it('affiche le bloc explicatif au repos', () => {
    const { w } = mountView()
    expect(w.text()).toContain(fr.ravelryImport.lead1)
  })

  it('analyse le fichier choisi et affiche le résumé', async () => {
    const file = makeRavelryFile(HEADERS, [
      ['In stash', 'Drops', 'Baby Merino', 'Bleu nuit', 'DK (11 wpi)', 50, 105, 3, 3, 15, '2026-05-01', 'A123', 'Boutique X'],
      ['All used up', 'Katia', 'Concept Cotton', 'Vert', 'DK (11 wpi)', 50, 120, 1, 0, 6, '2025-11-02', '', ''],
    ])
    const { w } = mountView()
    await pick(w, file)
    await w.find('[data-test="ravelry-analyze"]').trigger('click')
    await flushPromises()

    const summary = w.find('[data-test="ravelry-summary"]')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain(fr.ravelryImport.summaryTotal.replace('{n}', '2'))
    expect(summary.text()).toContain(fr.ravelryImport.summaryCreate.replace('{n}', '1'))
    expect(w.find('[data-test="ravelry-confirm"]').attributes('disabled')).toBeUndefined()
  })

  it('la confirmation écrit une fiche puis sa ligne d’achat par laine retenue', async () => {
    const file = makeRavelryFile(HEADERS, [
      ['In stash', 'Drops', 'Baby Merino', 'Bleu nuit', 'DK (11 wpi)', 50, 105, 3, 3, 15, '2026-05-01', 'A123', 'Boutique X'],
    ])
    const { w, yarnsStore, purchasesStore } = mountView()
    yarnsStore.add.mockResolvedValueOnce(42)
    await pick(w, file)
    await w.find('[data-test="ravelry-analyze"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="ravelry-confirm"]').trigger('click')
    await flushPromises()

    expect(yarnsStore.add).toHaveBeenCalledTimes(1)
    expect(yarnsStore.add).toHaveBeenCalledWith(
      expect.objectContaining({ brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu nuit' }),
    )
    expect(purchasesStore.add).toHaveBeenCalledWith(
      expect.objectContaining({ yarnId: 42, quantity: 3, bain: 'A123', purchasedFrom: 'Boutique X', reconstructed: true }),
    )
    expect(w.find('[data-test="ravelry-done"]').exists()).toBe(true)
  })

  it('une ligne déjà présente dans le stock (clé normalisée) désactive la confirmation si rien à créer', async () => {
    const file = makeRavelryFile(HEADERS, [
      ['In stash', 'Drops', 'Baby Merino', 'Bleu nuit', 'DK (11 wpi)', 50, 105, 3, 3, 15, '2026-05-01', '', ''],
    ])
    const { w } = mountView([{ brand: 'drops', model: 'baby merino', colorName: 'bleu nuit' }])
    await pick(w, file)
    await w.find('[data-test="ravelry-analyze"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-test="ravelry-confirm"]').attributes('disabled')).toBeDefined()
  })

  it('la ligne d\'achat importée porte la devise des réglages (finding 2)', async () => {
    const file = makeRavelryFile(HEADERS, [
      ['In stash', 'Drops', 'Baby Merino', 'Bleu nuit', 'DK (11 wpi)', 50, 105, 3, 3, 15, '2026-05-01', 'A123', 'Boutique X'],
    ])
    const { w, yarnsStore, purchasesStore, settingsStore } = mountView([], 'CHF')
    yarnsStore.add.mockResolvedValueOnce(42)
    await pick(w, file)
    await w.find('[data-test="ravelry-analyze"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="ravelry-confirm"]').trigger('click')
    await flushPromises()

    expect(purchasesStore.add).toHaveBeenCalledWith(
      expect.objectContaining({ currency: settingsStore.currency }),
    )
    expect(settingsStore.currency).toBe('CHF')
  })

  it('une écriture qui échoue en cours de boucle affiche une erreur et ne masque pas la progression réelle (finding 3)', async () => {
    const file = makeRavelryFile(HEADERS, [
      ['In stash', 'Drops', 'Baby Merino', 'Bleu nuit', 'DK (11 wpi)', 50, 105, 3, 3, 15, '2026-05-01', '', ''],
      ['In stash', 'Cheval Blanc', 'Sunny', '56 Vieux Rose', 'Sport (12 wpi)', 50, 130, 2, 2, 8, '2026-03-10', '', ''],
      ['In stash', 'Katia', 'Concept Cotton', 'Vert', 'DK (11 wpi)', 50, 120, 1, 1, 6, '2025-11-02', '', ''],
    ])
    const { w, yarnsStore, purchasesStore } = mountView()
    yarnsStore.add.mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(3)
    purchasesStore.add
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('quota dépassé'))
    await pick(w, file)
    await w.find('[data-test="ravelry-analyze"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="ravelry-confirm"]').trigger('click')
    await flushPromises()

    expect(yarnsStore.add).toHaveBeenCalledTimes(2)
    expect(purchasesStore.add).toHaveBeenCalledTimes(2)
    expect(w.find('[data-test="ravelry-done"]').exists()).toBe(true)
    expect(w.text()).toContain(fr.ravelryImport.doneTitle.replace('{n}', '1'))
    expect(w.text()).toContain('quota dépassé')
    expect(w.find('[data-test="ravelry-confirm"]').exists()).toBe(false)
  })

  it('un fichier sans colonne Status affiche le message dédié plutôt que « plus en stock » (finding 5)', async () => {
    const noStatusHeaders = HEADERS.filter((h) => h !== 'Status')
    const file = makeRavelryFile(noStatusHeaders, [
      ['Drops', 'Baby Merino', 'Bleu nuit', 'DK (11 wpi)', 50, 105, 3, 3, 15, '2026-05-01', 'A123', 'Boutique X'],
    ])
    const { w } = mountView()
    await pick(w, file)
    await w.find('[data-test="ravelry-analyze"]').trigger('click')
    await flushPromises()

    const summary = w.find('[data-test="ravelry-summary"]')
    expect(summary.text()).toContain(fr.ravelryImport.summaryNoStatusColumn)
    expect(summary.text()).not.toContain(fr.ravelryImport.summaryExcluded.replace('{n}', '1'))
  })

  it('le bouton de confirmation affiche un libellé occupé pendant confirming (backlog fix 1)', async () => {
    const file = makeRavelryFile(HEADERS, [
      ['In stash', 'Drops', 'Baby Merino', 'Bleu nuit', 'DK (11 wpi)', 50, 105, 3, 3, 15, '2026-05-01', 'A123', 'Boutique X'],
    ])
    const { w, yarnsStore, purchasesStore } = mountView()
    yarnsStore.add.mockResolvedValueOnce(42)
    let releasePurchase
    purchasesStore.add.mockReturnValueOnce(new Promise((resolve) => { releasePurchase = resolve }))
    await pick(w, file)
    await w.find('[data-test="ravelry-analyze"]').trigger('click')
    await flushPromises()

    const confirmBtn = w.find('[data-test="ravelry-confirm"]')
    expect(confirmBtn.text()).toBe(fr.ravelryImport.confirm.replace('{n}', '1'))

    // Ne pas attendre confirmImport() en entier : purchasesStore.add() reste en suspens,
    // exactement le moment où le libellé occupé doit être visible.
    const clicked = w.find('[data-test="ravelry-confirm"]').trigger('click')
    await Promise.resolve()
    await Promise.resolve()
    expect(w.find('[data-test="ravelry-confirm"]').text()).toBe(fr.ravelryImport.confirming)

    releasePurchase(undefined)
    await clicked
    await flushPromises()
  })

  it("analyze() sur un fichier illisible affiche le message traduit, jamais l'erreur brute SheetJS (backlog fix 2)", async () => {
    // Magie ZIP tronquée : XLSX.read() lève une vraie exception (« Unsupported ZIP file »),
    // contrairement à un simple texte que SheetJS retombe à lire comme un CSV permissif.
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02])], 'bad.xlsx')
    const { w } = mountView()
    await pick(w, file)
    await w.find('[data-test="ravelry-analyze"]').trigger('click')
    await flushPromises()

    expect(w.text()).toContain(fr.ravelryImport.parseError)
    expect(w.text()).not.toContain('ZIP')
    expect(w.find('[data-test="ravelry-summary"]').exists()).toBe(false)
  })

  it('un fichier sans ligne de données affiche le message dédié, pas le résumé normal (backlog fix 3)', async () => {
    const file = makeRavelryFile(HEADERS, [])
    const { w } = mountView()
    await pick(w, file)
    await w.find('[data-test="ravelry-analyze"]').trigger('click')
    await flushPromises()

    const summary = w.find('[data-test="ravelry-summary"]')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain(fr.ravelryImport.summaryEmpty)
    expect(summary.text()).not.toContain(fr.ravelryImport.summaryTotal.replace('{n}', '0'))
    expect(summary.text()).not.toContain(fr.ravelryImport.summaryCreate.replace('{n}', '0'))
    // Le bouton reste disabled (toCreate.length === 0, logique déjà existante) : seul le
    // contenu du résumé change ici, pas le libellé du bouton lui-même.
    expect(w.find('[data-test="ravelry-confirm"]').attributes('disabled')).toBeDefined()
  })

  it('la confirmation pose yarn.price au même montant que purchase.unitPrice (backlog fix 4)', async () => {
    const file = makeRavelryFile(HEADERS, [
      ['In stash', 'Drops', 'Baby Merino', 'Bleu nuit', 'DK (11 wpi)', 50, 105, 3, 3, 15, '2026-05-01', 'A123', 'Boutique X'],
    ])
    const { w, yarnsStore, purchasesStore } = mountView()
    // `row.yarn` est le MÊME objet que `yarnsStore.add` reçoit puis que le spy enregistre :
    // `toHaveBeenCalledWith` relirait son état au moment de l'ASSERTION, pas de l'appel, et
    // laisserait passer une version cassée qui poserait `price` APRÈS l'appel. On capture donc
    // une copie au moment même de l'appel, dans l'implémentation du mock.
    let capturedYarn = null
    yarnsStore.add.mockImplementationOnce((y) => {
      capturedYarn = { ...y }
      return Promise.resolve(42)
    })
    await pick(w, file)
    await w.find('[data-test="ravelry-analyze"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="ravelry-confirm"]').trigger('click')
    await flushPromises()

    // "Price paid" (15) / skeins (3) : mapRow() calcule déjà un prix UNITAIRE (map-row.js),
    // pas le prix payé brut, expect(5) plutôt que expect(15).
    const unitPrice = purchasesStore.add.mock.calls[0][0].unitPrice
    expect(unitPrice).toBe(5)
    expect(capturedYarn.price).toBe(unitPrice)
  })
})

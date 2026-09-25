// Intégration des 3 modules purs (parse → map → dedupe) sans écriture en base, c'est le
// résumé affiché par RavelryImportView.vue avant confirmation (spec, « Bout en bout »,
// point 9).
import { describe, it, expect } from 'vitest'
import { planRavelryImport } from '@/utils/ravelry-import'
import { makeRavelryFile, makeRavelryWorkbookFile } from './helpers/make-ravelry-file'

const HEADERS = [
  'Status', 'Brand', 'Yarn', 'Colorway', 'Weight', 'Grams/skein', 'Meters/skein',
  'Skeins', 'Remaining skeins', 'Price paid', 'Purchase date', 'Dye lot', 'Purchased at',
  'Stored in', 'Comments', 'ID Ravelry',
]

describe('planRavelryImport', () => {
  it('classe les lignes (nouvelle / déjà présente / hors statut) et remonte les en-têtes non reconnus', async () => {
    const rows = [
      ['In stash', 'Drops', 'Baby Merino', 'Bleu nuit', 'DK (11 wpi)', 50, 105, 3, 3, 15, '2026-05-01', 'A123', 'Boutique X', 'Étagère 2', 'Douce', '111'],
      ['In stash', 'Cheval Blanc', 'Sunny', '56 Vieux Rose', 'Sport (12 wpi)', 50, 130, 2, 2, 8, '2026-03-10', '', 'Gifi', '', '', '222'],
      ['All used up', 'Katia', 'Concept Cotton', 'Vert', 'DK (11 wpi)', 50, 120, 1, 0, 6, '2025-11-02', '', '', '', '', '333'],
    ]
    const file = makeRavelryFile(HEADERS, rows)
    const existingYarns = [{ brand: 'Cheval Blanc', model: 'Sunny', colorName: '56 vieux rose' }]

    const result = await planRavelryImport(file, existingYarns)

    expect(result.totalRows).toBe(3)
    expect(result.unmappedHeaders).toEqual(['ID Ravelry'])
    expect(result.toCreate).toHaveLength(1)
    expect(result.toCreate[0].status).toBe('In stash')
    expect(result.toCreate[0].yarn).toMatchObject({
      brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu nuit', weight: 'dk', storedIn: 'Étagère 2',
    })
    expect(result.toCreate[0].purchase).toMatchObject({ quantity: 3, bain: 'A123', purchasedFrom: 'Boutique X' })
    expect(result.alreadyPresentCount).toBe(1)
    expect(result.excludedStatusCount).toBe(1)
    expect(result.statusColumnMissing).toBe(false)
  })

  it('aucune ligne "In stash" nouvelle : toCreate vide, pas d\'erreur', async () => {
    const file = makeRavelryFile(HEADERS, [
      ['All used up', 'X', 'Y', 'Z', '', '', '', 0, 0, '', '', '', '', '', '', ''],
    ])
    const result = await planRavelryImport(file, [])
    expect(result.toCreate).toEqual([])
    expect(result.excludedStatusCount).toBe(1)
    expect(result.statusColumnMissing).toBe(false)
  })

  it('fichier sans colonne Status reconnue : statusColumnMissing à true, pas juste « excluded » (finding 5)', async () => {
    const noStatusHeaders = HEADERS.filter((h) => h !== 'Status')
    const rows = [
      ['Drops', 'Baby Merino', 'Bleu nuit', 'DK (11 wpi)', 50, 105, 3, 3, 15, '2026-05-01', 'A123', 'Boutique X', 'Étagère 2', 'Douce', '111'],
    ]
    const file = makeRavelryFile(noStatusHeaders, rows)

    const result = await planRavelryImport(file, [])

    expect(result.statusColumnMissing).toBe(true)
    expect(result.excludedStatusCount).toBe(1)
    expect(result.toCreate).toEqual([])
  })

  it('fichier vide (aucune ligne de données) : statusColumnMissing reste à false', async () => {
    const file = makeRavelryFile(HEADERS, [])

    const result = await planRavelryImport(file, [])

    expect(result.totalRows).toBe(0)
    expect(result.statusColumnMissing).toBe(false)
  })

  it('export réel à un onglet par statut : seules les lignes de l’onglet « In stash » sont créées', async () => {
    const headers = HEADERS.slice(1)
    const file = makeRavelryWorkbookFile(headers, {
      'In stash': [
        ['', 'Like Mohair', '', 'Worsted (9 wpi)', 50, 100, 10, 10, '', '', '', '', '', '', ''],
        ['', 'Soffio', '', 'Fingering (14 wpi)', 50, 250, 5, 5, '', '', '', 'Tre sfere', '', '', ''],
      ],
      'All used up': [['Katia', 'Concept Cotton', 'Vert', 'DK (11 wpi)', 50, 120, 1, 0, '', '', '', '', '', '', '']],
      'Will trade or sell': [],
      'Traded, sold, gifted': [],
    })

    const result = await planRavelryImport(file, [])

    expect(result.totalRows).toBe(3)
    expect(result.statusColumnMissing).toBe(false)
    expect(result.toCreate.map((r) => r.yarn.model)).toEqual(['Like Mohair', 'Soffio'])
    expect(result.excludedStatusCount).toBe(1)
  })

  it('onglet au nom quelconque et pas de colonne Status : signale le statut introuvable', async () => {
    const file = makeRavelryWorkbookFile(['Brand', 'Yarn'], { Sheet1: [['Drops', 'Alpaca']] })
    const result = await planRavelryImport(file, [])
    expect(result.statusColumnMissing).toBe(true)
    expect(result.toCreate).toHaveLength(0)
  })
})

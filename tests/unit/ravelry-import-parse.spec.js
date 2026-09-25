import { describe, it, expect } from 'vitest'
import { parseRavelryFile } from '@/utils/ravelry-import/parse'
import { makeRavelryFile, makeRavelryWorkbookFile } from './helpers/make-ravelry-file'

describe('parseRavelryFile', () => {
  it('résout chaque en-tête connu vers son champ, garde la liste des en-têtes inconnus', async () => {
    const file = makeRavelryFile(
      ['Status', 'Brand', 'Yarn', 'Colorway', 'ID Ravelry'],
      [['In stash', 'Drops', 'Baby Merino', 'Bleu nuit', '1234']],
    )
    const { headers, unmappedHeaders, rows } = await parseRavelryFile(file)
    expect(headers).toEqual(['Status', 'Brand', 'Yarn', 'Colorway', 'ID Ravelry'])
    expect(unmappedHeaders).toEqual(['ID Ravelry'])
    expect(rows).toEqual([{ status: 'In stash', brand: 'Drops', model: 'Baby Merino', colorway: 'Bleu nuit' }])
  })

  it('ignore les lignes entièrement vides', async () => {
    const file = makeRavelryFile(
      ['Brand', 'Yarn'],
      [['Drops', 'Baby Merino'], ['', '']],
    )
    const { rows } = await parseRavelryFile(file)
    expect(rows).toHaveLength(1)
  })

  it('lit aussi un CSV (même format de sortie qu’un .xlsx)', async () => {
    const csv = 'Brand,Yarn\nKatia,Concept Cotton\n'
    const file = new File([csv], 'stash.csv', { type: 'text/csv' })
    const { rows } = await parseRavelryFile(file)
    expect(rows).toEqual([{ brand: 'Katia', model: 'Concept Cotton' }])
  })

  // Un CSV retouché ne doit pas passer par l'interprétation de SheetJS (virgule lue comme
  // séparateur de milliers, date non ISO ancrée à minuit LOCAL) : map-row.js s'en charge.
  it('CSV : nombres et dates restent des chaînes brutes', async () => {
    const csv = 'Price Paid,Skeins,Purchase Date\n"12,50","2,5",09/25/2026\n'
    const file = new File([csv], 'stash.csv', { type: 'text/csv' })
    const { rows } = await parseRavelryFile(file)
    expect(rows).toEqual([{ pricePaid: '12,50', skeins: '2,5', purchaseDate: '09/25/2026' }])
  })

  describe('export réel à un onglet par statut (pas de colonne Status)', () => {
    const headers = ['Brand', 'Yarn', 'Colorway', 'Remaining skeins']

    it('lit tous les onglets et prend le nom de l’onglet comme statut', async () => {
      const file = makeRavelryWorkbookFile(headers, {
        'In stash': [['Drops', 'Alpaca', 'Gris', 2]],
        'All used up': [['Katia', 'Merino', 'Rouge', 0]],
        'Will trade or sell': [],
        'Traded, sold, gifted': [],
      })
      const { rows } = await parseRavelryFile(file)
      expect(rows).toEqual([
        { status: 'In stash', brand: 'Drops', model: 'Alpaca', colorway: 'Gris', remainingSkeins: 2 },
        { status: 'All used up', brand: 'Katia', model: 'Merino', colorway: 'Rouge', remainingSkeins: 0 },
      ])
    })

    it('une colonne Status présente prime sur le nom de l’onglet', async () => {
      const file = makeRavelryWorkbookFile(['Status', 'Yarn'], { 'In stash': [['All used up', 'Alpaca']] })
      const { rows } = await parseRavelryFile(file)
      expect(rows).toEqual([{ status: 'All used up', model: 'Alpaca' }])
    })

    it('un onglet au nom quelconque (Sheet1) ne fournit PAS de statut', async () => {
      const file = makeRavelryWorkbookFile(['Yarn'], { Sheet1: [['Alpaca']] })
      const { rows } = await parseRavelryFile(file)
      expect(rows).toEqual([{ model: 'Alpaca' }])
    })

    it('ne signale pas comme inconnues les colonnes dérivées volontairement ignorées', async () => {
      const file = makeRavelryWorkbookFile(
        ['Yarn', 'Total yards', 'Total meters', 'Total grams', 'Remaining yards', 'Remaining meters', 'Remaining grams', 'Has photo', 'Bidule'],
        { 'In stash': [['Alpaca', 1, 1, 1, 1, 1, 1, 'no', 'x']], 'All used up': [] },
      )
      const { unmappedHeaders } = await parseRavelryFile(file)
      expect(unmappedHeaders).toEqual(['Bidule'])
    })
  })
})

// @vitest-environment jsdom
// Unitaire : la devise des prix de laine et d'outil. Les prix existants n'ont pas de devise ;
// la reprise leur pose celle des réglages, une seule fois par ligne (idempotente par construction).
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/db/db'
import { hasPrice, priceCurrencyOf, stockTotalsByCurrency } from '@/utils/price-currency'
import { fillMissingPriceCurrency } from '@/db/price-currency-reprise'
import { serializeYarns, serializeTools } from '@/backup/serialize'
import { deserializeYarns, deserializeTools } from '@/backup/deserialize'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('hasPrice / priceCurrencyOf', () => {
  it('0 et "0" sont des prix déclarés, vide et absent non', () => {
    expect(hasPrice(0)).toBe(true)
    expect(hasPrice('0')).toBe(true)
    expect(hasPrice('')).toBe(false)
    expect(hasPrice('  ')).toBe(false)
    expect(hasPrice(null)).toBe(false)
    expect(hasPrice(undefined)).toBe(false)
  })
  it('priceCurrencyOf : devise de la fiche, sinon repli', () => {
    expect(priceCurrencyOf({ price: 1 }, 'USD')).toBe('USD')
    expect(priceCurrencyOf({ price: 1, priceCurrency: 'EUR' }, 'USD')).toBe('EUR')
  })
})

describe('fillMissingPriceCurrency', () => {
  it('pose la devise sur la laine et l\'outil qui ont un prix, rend 2', async () => {
    const yid = await db.yarns.add({ brand: 'A', price: 4.5 })
    const tid = await db.tools.add({ type: 'standard', price: '12' })
    expect(await fillMissingPriceCurrency('EUR')).toBe(2)
    expect((await db.yarns.get(yid)).priceCurrency).toBe('EUR')
    expect((await db.tools.get(tid)).priceCurrency).toBe('EUR')
  })
  it('laine sans prix : intacte, sans devise', async () => {
    const id = await db.yarns.add({ brand: 'A', price: '' })
    expect(await fillMissingPriceCurrency('EUR')).toBe(0)
    expect('priceCurrency' in (await db.yarns.get(id))).toBe(false)
  })
  it('une devise existante n\'est jamais écrasée', async () => {
    const id = await db.yarns.add({ brand: 'A', price: 3, priceCurrency: 'GBP' })
    expect(await fillMissingPriceCurrency('EUR')).toBe(0)
    expect((await db.yarns.get(id)).priceCurrency).toBe('GBP')
  })
  it('deuxième appel : rend 0', async () => {
    await db.yarns.add({ brand: 'A', price: 4.5 })
    expect(await fillMissingPriceCurrency('EUR')).toBe(1)
    expect(await fillMissingPriceCurrency('EUR')).toBe(0)
  })
  it('corbeille : laine et outil reçoivent la devise dans le payload, un projet reste intact', async () => {
    const y = await db.trash.add({ type: 'yarn', payload: { id: 1, price: 2 } })
    const t = await db.trash.add({ type: 'tool', payload: { id: 2, price: '7' } })
    const p = await db.trash.add({ type: 'project', payload: { id: 3, price: 2 } })
    expect(await fillMissingPriceCurrency('EUR')).toBe(2)
    expect((await db.trash.get(y)).payload.priceCurrency).toBe('EUR')
    expect((await db.trash.get(t)).payload.priceCurrency).toBe('EUR')
    expect((await db.trash.get(p)).payload).toEqual({ id: 3, price: 2 })
  })
})

describe('fillMissingPriceCurrency : patrons', () => {
  it('pose la devise sur un patron qui a un prix, gratuit déclaré compris', async () => {
    const a = await db.patterns.add({ name: 'A', price: '18,90' })
    const b = await db.patterns.add({ name: 'B', price: '0' })
    expect(await fillMissingPriceCurrency('CHF')).toBe(2)
    expect((await db.patterns.get(a)).priceCurrency).toBe('CHF')
    expect((await db.patterns.get(b)).priceCurrency).toBe('CHF')
  })
  it('patron sans prix ou à devise posée : intact', async () => {
    const vide = await db.patterns.add({ name: 'Vide', price: '', priceCurrency: '' })
    const gbp = await db.patterns.add({ name: 'GBP', price: '5', priceCurrency: 'GBP' })
    const copie = await db.patterns.add({ name: 'Copie', ownerProjectId: 1, sourcePatternId: 9 })
    expect(await fillMissingPriceCurrency('CHF')).toBe(0)
    expect((await db.patterns.get(vide)).priceCurrency).toBe('')
    expect((await db.patterns.get(gbp)).priceCurrency).toBe('GBP')
    expect('priceCurrency' in (await db.patterns.get(copie))).toBe(false)
  })
  it('corbeille : un patron supprimé reçoit la devise dans son payload', async () => {
    const id = await db.trash.add({ type: 'pattern', payload: { id: 4, name: 'P', price: '12' } })
    expect(await fillMissingPriceCurrency('CHF')).toBe(1)
    expect((await db.trash.get(id)).payload.priceCurrency).toBe('CHF')
  })
  it('deuxième appel : rend 0', async () => {
    await db.patterns.add({ name: 'A', price: '3' })
    expect(await fillMissingPriceCurrency('EUR')).toBe(1)
    expect(await fillMissingPriceCurrency('EUR')).toBe(0)
  })
})

describe('sauvegarde : priceCurrency fait l\'aller-retour', () => {
  it('laine et outil gardent leur devise', () => {
    const yarns = deserializeYarns(JSON.parse(serializeYarns([{ id: 1, price: 2, priceCurrency: 'GBP' }]).files.at(-1).data))
    const tools = deserializeTools(JSON.parse(serializeTools([{ id: 1, price: 2, priceCurrency: 'USD' }]).files.at(-1).data))
    expect(yarns[0].priceCurrency).toBe('GBP')
    expect(tools[0].priceCurrency).toBe('USD')
  })
})

describe('stockTotalsByCurrency', () => {
  it('regroupe par devise, quantité × prix, repli sur la devise des réglages', () => {
    const items = [
      { price: 2, quantity: 3, priceCurrency: 'EUR' },
      { price: 5, quantity: 1, priceCurrency: 'USD' },
      { price: 1, quantity: 2 },
    ]
    expect(stockTotalsByCurrency(items, 'EUR')).toEqual({ EUR: 8, USD: 5 })
  })

  it('ignore les entrées sans prix, garde le prix 0 déclaré', () => {
    const items = [{ price: '', quantity: 2 }, { price: undefined, quantity: 2 }, { price: '0', quantity: 2, priceCurrency: 'USD' }]
    expect(stockTotalsByCurrency(items, 'EUR')).toEqual({ USD: 0 })
  })
})

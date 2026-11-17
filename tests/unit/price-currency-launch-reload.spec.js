// La reprise de devise du lancement recharge les stores laines, outils et patrons quand elle a
// changé quelque chose en base. Sans ce rechargement, l'écran Dépenses (qui ne recharge un
// store que s'il n'est pas déjà chargé) montrerait la fiche reprise SANS devise pendant toute la
// session, ce qui est le défaut que la reprise corrige. Avant ce test, retirer un `load()` de
// App.vue laissait tout vert.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '@/db/db'
import { runPriceCurrencyReprise } from '@/db/price-currency-reprise'

const stores = () => ({ yarns: { load: vi.fn() }, tools: { load: vi.fn() }, patterns: { load: vi.fn() } })

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('runPriceCurrencyReprise', () => {
  it('une fiche reprise ⇒ les trois stores sont rechargés', async () => {
    await db.patterns.add({ name: 'P', price: '12' })
    const s = stores()
    await runPriceCurrencyReprise('CHF', s)
    expect(s.yarns.load).toHaveBeenCalledTimes(1)
    expect(s.tools.load).toHaveBeenCalledTimes(1)
    expect(s.patterns.load).toHaveBeenCalledTimes(1)
  })

  it('rien à reprendre ⇒ aucun rechargement', async () => {
    await db.patterns.add({ name: 'P', price: '12', priceCurrency: 'EUR' })
    const s = stores()
    await runPriceCurrencyReprise('CHF', s)
    expect(s.yarns.load).not.toHaveBeenCalled()
    expect(s.tools.load).not.toHaveBeenCalled()
    expect(s.patterns.load).not.toHaveBeenCalled()
  })

  it('une erreur de la reprise est avalée (rejouée au lancement suivant)', async () => {
    const s = stores()
    s.patterns.load.mockRejectedValue(new Error('boom'))
    await db.patterns.add({ name: 'P', price: '12' })
    await expect(runPriceCurrencyReprise('CHF', s)).resolves.toBeUndefined()
  })
})

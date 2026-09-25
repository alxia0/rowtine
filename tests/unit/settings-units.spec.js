// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import { db } from '@/db/db'

describe('réglages unités et devise', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await db.settings.clear()
  })

  it('vaut métrique et euro quand rien n’a jamais été réglé', async () => {
    // Condition non négociable : un compte existant ne doit pas changer de comportement.
    const s = useSettingsStore()
    await s.load()
    expect(s.unitSystem).toBe('metric')
    expect(s.currency).toBe('EUR')
  })

  it('persiste le choix et le retrouve après rechargement', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.saveUnits({ unitSystem: 'imperial', currency: 'USD' })

    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    await s2.load()
    expect(s2.unitSystem).toBe('imperial')
    expect(s2.currency).toBe('USD')
  })

  it('enregistre chaque réglage indépendamment de l’autre', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.saveUnits({ currency: 'GBP' })
    expect(s.currency).toBe('GBP')
    expect(s.unitSystem).toBe('metric') // inchangé
  })

  it('refuse une valeur hors liste plutôt que de la stocker', async () => {
    // Un réglage corrompu ferait afficher un symbole vide partout.
    const s = useSettingsStore()
    await s.load()
    await s.saveUnits({ unitSystem: 'lunaire', currency: 'ZZZ' })
    expect(s.unitSystem).toBe('metric')
    expect(s.currency).toBe('EUR')
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'

const store = new Map()
vi.mock('@/db/db', () => ({
  getSetting: async (k) => store.get(k),
  setSetting: async (k, v) => void store.set(k, v),
}))
const name = vi.fn()
vi.mock('@/backup/saf-plugin', () => ({ RowtineSaf: { deviceName: (...a) => name(...a) } }))

import { deviceId, deviceName, composeDeviceName } from '@/backup/device-identity'

describe('device-identity', () => {
  beforeEach(() => { store.clear(); name.mockReset() })

  it('crée un identifiant au premier appel et le REPREND ensuite', async () => {
    const first = await deviceId()
    expect(first).toMatch(/[0-9a-f-]{16,}/)
    expect(await deviceId()).toBe(first)          // stable
    expect(store.get('deviceId')).toBe(first)     // persisté
  })

  it('un identifiant déjà persisté est réutilisé tel quel, jamais régénéré', async () => {
    store.set('deviceId', 'deja-la')
    expect(await deviceId()).toBe('deja-la')
  })

  it('deviceName délègue au natif puis compose', async () => {
    name.mockResolvedValue({ userName: '', model: 'LYA-L29', manufacturer: 'HUAWEI' })
    expect(await deviceName()).toBe('HUAWEI LYA-L29')
  })

  it('deviceName renvoie null si le plugin ne l’implémente pas (web/dev, build ancien)', async () => {
    name.mockRejectedValue(new Error('UNIMPLEMENTED'))
    expect(await deviceName()).toBeNull()
  })
})

describe('composeDeviceName', () => {
  const C = composeDeviceName
  it('un nom donné par l’utilisatrice l’emporte', () =>
    expect(C({ userName: 'Le tel de Marie', model: 'SM-G991B', manufacturer: 'samsung' }))
      .toBe('Le tel de Marie'))
  it('un nom identique au modèle n’est PAS un choix : on compose', () =>
    expect(C({ userName: 'LYA-L29', model: 'LYA-L29', manufacturer: 'HUAWEI' }))
      .toBe('HUAWEI LYA-L29'))
  it('comparaison insensible à la casse et aux espaces', () =>
    expect(C({ userName: '  lya-l29 ', model: 'LYA-L29', manufacturer: 'HUAWEI' }))
      .toBe('HUAWEI LYA-L29'))
  it('marque tout en minuscules : première lettre en capitale', () =>
    expect(C({ userName: '', model: 'Nexus 7', manufacturer: 'asus' })).toBe('Asus Nexus 7'))
  it('marque déjà dans le modèle : pas de doublon', () =>
    expect(C({ userName: '', model: 'Samsung Galaxy S21', manufacturer: 'Samsung' }))
      .toBe('Samsung Galaxy S21'))
  it('doublon détecté sans tenir compte de la casse', () =>
    expect(C({ userName: '', model: 'HUAWEI P30', manufacturer: 'huawei' })).toBe('HUAWEI P30'))
  it('marque absente : le modèle seul', () =>
    expect(C({ userName: '', model: 'Pixel 8', manufacturer: '' })).toBe('Pixel 8'))
  it('rien d’exploitable : null, jamais une chaîne vide', () =>
    expect(C({ userName: '   ', model: '  ', manufacturer: '' })).toBeNull())
  it('tout absent : null', () => expect(C({})).toBeNull())
})

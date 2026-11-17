import { describe, it, expect } from 'vitest'
import { ICONS, hasIcon } from '@/utils/icons'
describe('icons — nouvelles entrées barre éditeur', () => {
  it('checkbox/counter/note/text/image existent', () => {
    for (const n of ['checkbox', 'counter', 'note', 'text', 'image']) {
      expect(hasIcon(n)).toBe(true)
      expect(ICONS[n].body).toContain('<path')
    }
  })
  it("move existe (bouton « Déplacer » de l'assistant de calage radial)", () => {
    expect(hasIcon('move')).toBe(true)
    expect(ICONS.move.body).toContain('<path')
  })
  it("repeat existe (puce d'exemplaires des sections répétables)", () => {
    expect(hasIcon('repeat')).toBe(true)
    expect(ICONS.repeat.body).toContain('<path')
  })
})

describe('icons — types d’outils', () => {
  it('chaque type d’outil a une icône du registre', async () => {
    const { TOOL_TYPES } = await import('@/constants/tools')
    for (const def of Object.values(TOOL_TYPES)) expect(hasIcon(def.icon)).toBe(true)
  })
  it('le câble a sa propre icône, distincte de la circulaire', async () => {
    const { TOOL_TYPES } = await import('@/constants/tools')
    expect(TOOL_TYPES.cable.icon).toBe('tool-cable')
    expect(ICONS['tool-cable'].body).not.toBe(ICONS['tool-circular'].body)
  })
})

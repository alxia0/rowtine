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
})

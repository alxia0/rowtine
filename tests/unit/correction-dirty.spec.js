import { describe, it, expect } from 'vitest'
import { isDirty } from '@/utils/correction-dirty'

describe('isDirty', () => {
  it('faux quand le texte est inchangé et rien d’autre n’a changé', () => {
    expect(isDirty('abc', 'abc', false)).toBe(false)
  })
  it('vrai quand le texte a changé', () => {
    expect(isDirty('abc', 'abd', false)).toBe(true)
  })
  it('vrai quand les diagrammes ont changé, même texte inchangé', () => {
    expect(isDirty('abc', 'abc', true)).toBe(true)
  })
})

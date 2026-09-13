import { describe, it, expect } from 'vitest'
import { lineClass } from '@/components/cm/cm-editor'

describe('lineClass — classe de ligne CM6', () => {
  it('marque la ligne du curseur comme bloc actif', () => {
    // type=rang, ligne courante → inclut md-rang ET cm-active-block
    const cls = lineClass('rang', /*isSelectedLine*/ true, /*isImageSelected*/ false)
    expect(cls).toContain('md-rang')
    expect(cls).toContain('cm-active-block')
  })
  it('ligne non courante : pas de cm-active-block', () => {
    expect(lineClass('note', false, false)).toBe('md-note')
  })
  it('ligne image sélectionnée : conserve la classe image sélectionnée', () => {
    const cls = lineClass('image', true, true)
    expect(cls).toContain('cm-image-line-selected')
    expect(cls).toContain('cm-active-block')
  })
})

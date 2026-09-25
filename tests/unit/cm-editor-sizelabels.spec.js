// @vitest-environment jsdom
// La conversion du bouton « Tailles » a besoin du nombre de tailles pour emettre le bon
// nombre de colonnes. Ce test verrouille le passage de la valeur de bout en bout, AVANT
// que quiconque la consomme — un cablage muet se casse sans bruit.
import { describe, it, expect } from 'vitest'

describe('createCmEditor — option sizeLabels', () => {
  it('expose les sizeLabels recus', async () => {
    const { createCmEditor } = await import('@/components/cm/cm-editor')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createCmEditor(host, { value: '- Rang 1', sizeLabels: ['S', 'M', 'L'] })
    expect(editor.getSizeLabels()).toEqual(['S', 'M', 'L'])
    host.remove()
  })

  it('retombe sur un tableau vide quand l option est absente', async () => {
    const { createCmEditor } = await import('@/components/cm/cm-editor')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createCmEditor(host, { value: '- Rang 1' })
    expect(editor.getSizeLabels()).toEqual([])
    host.remove()
  })

  it('setSizeLabels remplace la valeur (le champ Tailles est editable a chaud)', async () => {
    const { createCmEditor } = await import('@/components/cm/cm-editor')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createCmEditor(host, { value: '- Rang 1', sizeLabels: ['S'] })
    editor.setSizeLabels(['S', 'M', 'L', 'XL'])
    expect(editor.getSizeLabels()).toEqual(['S', 'M', 'L', 'XL'])
    host.remove()
  })
})

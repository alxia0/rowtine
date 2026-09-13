import { describe, it, expect } from 'vitest'
import { buildReaderFromPages } from '@/utils/pdf-import/assemble'

// Reproduit le motif du bug A (Twist Loop / OTHER LOOPS) : intro AVANT « Tailles ».
function line(text, y, { size = 10, bold = false } = {}) { return { text, size, bold, y } }

describe('bug A — intro avant « Tailles » reprise en Présentation', () => {
  it('consolide le texte d’intro en 1re section Présentation (notes)', () => {
    const pages = [[
      line('TWIST LOOP TOP est un débardeur ajouré tricoté de haut en bas.', 800),
      line('Le top se tricote de haut en bas, en commençant par l’encolure.', 785),
      line('Tailles', 750, { bold: true }),
      line('XS (S) M (L) XL (XXL)', 735),
      line('Encolure', 700, { bold: true }),
      line('Monter 104 (108) 108 (112) 116 (120) m.', 685),
    ]]
    const { reader } = buildReaderFromPages(pages, { fileName: 'twist.pdf' })
    const intro = reader.sections[0]
    expect(intro.title).toMatch(/présentation/i)
    expect(intro.steps.every((s) => s.note)).toBe(true)
    const introText = intro.steps.map((s) => s.t).join(' ')
    expect(introText).toContain('débardeur')
    expect(introText).toContain('haut en bas')
  })
})

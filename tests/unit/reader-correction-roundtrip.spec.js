// Vérifie que la section MIXTE produite par promoteImageToChart (Lot C) —
// un step texte + un step {chart:true} dans la même section — survit au
// round-trip Rowtine-MD (readerToMdFragment -> mdFragmentToReader). C'est
// le chemin que la synchro SAF/patron.md ré-emprunte à l'ouverture sur device :
// si le round-trip perdait le texte ou l'image, la correction se perdrait en
// silence au ré-ouverture (viole « jamais perdre »).
import { describe, it, expect } from 'vitest'
import { readerToMdFragment, mdFragmentToReader } from '@/utils/pattern-md/fragment'
import { promoteImageToChart, demoteChartToImage } from '@/utils/reader-correction'

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCA',
  IMG2 = 'data:image/png;base64,ZZZZ'

function baseReader() {
  return {
    sizeLabels: ['Taille unique'],
    sections: [
      {
        id: 'devant',
        kind: 'corps',
        title: 'Devant',
        steps: [{ t: 'Rang 1 : monter 20 m et tricoter en jersey.', imgs: [IMG, IMG2] }],
      },
    ],
    reference: null,
  }
}

describe('round-trip MD d’une section mixte (promote — Lot C)', () => {
  it('promote → MD → reparse : texte d’ancrage + chart (image) préservés', () => {
    const promoted = promoteImageToChart(baseReader(), 'devant')
    // sanity : forme mixte attendue
    const sec0 = promoted.sections[0]
    expect(sec0.steps.some((s) => s.t)).toBe(true)
    expect(sec0.steps.some((s) => s.chart)).toBe(true)
    expect(sec0.chart.img).toBe(IMG)

    const frag = readerToMdFragment(promoted)
    const { reader: back } = mdFragmentToReader(frag, promoted)
    const sec = back.sections.find((s) => s.title === 'Devant') || back.sections[0]

    // Le texte d’ancrage doit survivre.
    const joined = (sec.steps || []).map((s) => s.t || '').join(' ')
    expect(joined).toContain('monter 20 m')
    // Le diagramme (step chart) doit survivre AVEC une image. Note : le sérialiseur
    // Rowtine-MD externalise les images (data-URL -> chemin de fichier `img/photo-*.png`,
    // écrit par la synchro SAF) ; l'image n'est donc pas identique au data-URL d'origine
    // mais elle est PRÉSENTE (référencée) — pas perdue. C'est le comportement SAF normal.
    expect((sec.steps || []).some((s) => s.chart)).toBe(true)
    expect(sec.chart?.img).toBeTruthy()
  })

  it('round-trip promote→demote reste cohérent après passage MD', () => {
    const promoted = promoteImageToChart(baseReader(), 'devant')
    const frag = readerToMdFragment(promoted)
    const { reader: back } = mdFragmentToReader(frag, promoted)
    const secId = (back.sections.find((s) => s.chart) || back.sections[0]).id
    const demoted = demoteChartToImage(back, secId)
    // après rétrogradation, l’image n’est pas perdue (présente dans un step imgs)
    const hasImg = (demoted.sections.find((s) => s.id === secId)?.steps || []).some((s) => s.imgs?.length)
    expect(hasImg).toBe(true)
  })
})

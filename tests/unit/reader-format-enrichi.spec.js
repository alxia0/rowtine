// Régression B2 : le format Rowtine-MD « enrichi » (front-matter EN + balises
// de section EN + images inline indentées) doit produire, de bout en bout, un
// pattern PRÊT-READER : kinds internes FR (reader.sections[].kind), image
// d'étape en data URL (via resolveReaderAssets), bloc référence EN routé à part
// (pas absorbé en section de travail). Couvre mdToPattern (@/utils/pattern-md/parse)
// + resolveReaderAssets (@/backup/resolve-reader-assets) enchaînés.
import { describe, it, expect } from 'vitest'
import { mdToPattern } from '@/utils/pattern-md/parse'
import { resolveReaderAssets } from '@/backup/resolve-reader-assets'

// Patron enrichi réaliste : front-matter EN, un bloc référence balisé EN
// (Matériel {materials}), une section de travail échantillon balisée EN
// (Carré {swatch}) et une section de travail balisée EN (Dos {body}) portant
// une étape avec image inline indentée.
const ENRICHI_MD = `---
rowtine: 1
title: Bonnet Aïnsa
author: Julie Fournier
sizes: S · M · L
---

## Matériel {materials}

- 1 aiguille à laine
- Marqueurs de mailles

## Carré {swatch}

- Monter 20 m. et tricoter 20 rangs au point mousse.

## Dos {body}

- Monter 90 (100) 110 m. avec les aig. circulaires n° 4 et fermer en rond.
  ![](img/p05-1.png)
`

describe('format enrichi (balises EN + images) → pattern prêt-reader', () => {
  const { pattern, warnings } = mdToPattern(ENRICHI_MD)
  const reader = pattern.reader

  it('aucun avertissement parasite', () => {
    expect(warnings).toEqual([])
  })

  it('front-matter EN lu (nom, auteur, tailles)', () => {
    expect(pattern.name).toBe('Bonnet Aïnsa')
    expect(pattern.author).toBe('Julie Fournier')
    expect(pattern.sizes).toEqual(['S', 'M', 'L'])
    expect(reader.sizeLabels).toEqual(['S', 'M', 'L'])
  })

  it('bloc « Matériel {materials} » routé en RÉFÉRENCE, pas en section de travail', () => {
    expect(reader.sections.some((s) => s.title === 'Matériel')).toBe(false)
    const mat = reader.reference.tabs.find((t) => t.id === 'materiel')
    expect(mat.blocks.find((b) => b.h3 === 'Matériel').p).toEqual(['1 aiguille à laine', 'Marqueurs de mailles'])
  })

  it('section « Carré {swatch} » : kind interne FR echantillon (jamais absorbée en référence)', () => {
    const carre = reader.sections.find((s) => s.title === 'Carré')
    expect(carre).toBeTruthy()
    expect(carre.kind).toBe('echantillon')
  })

  it('section « Dos {body} » : kind interne FR corps, étape porteuse avec image nue', () => {
    const dos = reader.sections.find((s) => s.title === 'Dos')
    expect(dos).toBeTruthy()
    expect(dos.kind).toBe('corps')
    const [monter] = dos.steps
    expect(monter.c).toEqual([[90, 100, 110]])
    expect(monter.imgs).toEqual(['img/p05-1.png'])
  })

  it('resolveReaderAssets résout le chemin nu de l\'étape en data URL, prête pour StepImages', () => {
    const filesByName = { 'img/p05-1.png': 'QkFTRTY0TUlOSU1BTA==' }
    const { entity: resolved, missing } = resolveReaderAssets(pattern, filesByName)
    const dos = resolved.reader.sections.find((s) => s.title === 'Dos')
    const img = dos.steps[0].imgs[0]
    expect(img.startsWith('data:')).toBe(true)
    expect(img).toBe('data:image/png;base64,QkFTRTY0TUlOSU1BTA==')
    expect(missing).toEqual([])
  })
})

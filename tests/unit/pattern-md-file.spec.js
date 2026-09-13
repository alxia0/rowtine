import { describe, it, expect } from 'vitest'
import { buildPatternMdFiles } from '@/backup/pattern-md-file'
import { hash8 } from '@/backup/naming'

const IMG = 'data:image/jpeg;base64,QUJD'

describe('buildPatternMdFiles', () => {
  const entity = {
    name: 'Torsade', reader: { sizeLabels: [], sections: [
      { title: 'Corps', steps: [{ t: 'monter', imgs: [IMG] }] },
    ] },
    gallery: [{ src: 'data:image/jpeg;base64,REVG', page: 3 }],
  }

  it('émet patron.md sous dir, en utf8', () => {
    const { mdFile } = buildPatternMdFiles(entity, 'Patrons/torsade [1]')
    expect(mdFile.path).toBe('Patrons/torsade [1]/patron.md')
    expect(mdFile.encoding).toBe('utf8')
    expect(mdFile.data).toContain('Torsade')
  })

  it('assets préfixés par dir, à plat (photo-/gallery-), base64', () => {
    const { assetFiles } = buildPatternMdFiles(entity, 'Patrons/torsade [1]')
    expect(assetFiles.every((f) => f.path.startsWith('Patrons/torsade [1]/'))).toBe(true)
    expect(assetFiles.some((f) => f.path.includes('/photo-'))).toBe(true)
    expect(assetFiles.some((f) => f.path.includes('/gallery-'))).toBe(true)
    expect(assetFiles.every((f) => f.encoding === 'base64')).toBe(true)
  })

  it('CRITÈRE : chaque image référencée par le md existe dans assetFiles', () => {
    const { mdFile, assetFiles } = buildPatternMdFiles(entity, 'Patrons/torsade [1]')
    const refs = [...mdFile.data.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1])
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      expect(assetFiles.some((f) => f.path === `Patrons/torsade [1]/${ref}`)).toBe(true)
    }
  })

  it('hash = hash8 du md exact', () => {
    const { mdFile, hash } = buildPatternMdFiles(entity, 'Patrons/torsade [1]')
    expect(hash).toBe(hash8(mdFile.data))
  })

  it('dédup : deux images identiques → un seul fichier', () => {
    const dup = { name: 'X', reader: { sizeLabels: [], sections: [
      { title: 'A', steps: [{ t: 'x', imgs: [IMG] }] },
      { title: 'B', steps: [{ t: 'y', imgs: [IMG] }] },
    ] } }
    const { assetFiles } = buildPatternMdFiles(dup, 'Patrons/x [2]')
    const photoPaths = assetFiles.filter((f) => f.path.includes('/photo-')).map((f) => f.path)
    expect(new Set(photoPaths).size).toBe(photoPaths.length)
    expect(photoPaths.length).toBe(1)
  })
})

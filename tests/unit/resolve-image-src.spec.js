import { describe, it, expect } from 'vitest'
import { resolveImageSrc } from '@/utils/pattern-md/resolve-image-src.js'

describe('resolveImageSrc', () => {
  it('résout une map clée par chemin complet img/… (cas app, régression aperçu)', () => {
    const map = new Map([['img/photo-abc.png', 'data:image/png;base64,AAA']])
    expect(resolveImageSrc('img/photo-abc.png', map)).toBe('data:image/png;base64,AAA')
  })
  it('résout une map clée par basename (cas banc webkitdirectory)', () => {
    const map = new Map([['photo-abc.png', 'blob:xyz']])
    expect(resolveImageSrc('img/photo-abc.png', map)).toBe('blob:xyz')
  })
  it('passe une data URL telle quelle', () => {
    expect(resolveImageSrc('data:image/png;base64,ZZZ', null)).toBe('data:image/png;base64,ZZZ')
  })
  it('renvoie null sur miss réel', () => {
    expect(resolveImageSrc('img/absent.png', new Map())).toBeNull()
  })
  it('renvoie null si map absente et chemin non-data', () => {
    expect(resolveImageSrc('img/x.png', null)).toBeNull()
  })
})

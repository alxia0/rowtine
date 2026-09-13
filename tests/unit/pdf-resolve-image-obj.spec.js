import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// resolveImageObj n'importe que setTimeout + page.objs.get (pas de canvas) → testable seul.
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {}, OPS: {} }))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
import { resolveImageObj } from '@/utils/pdf'

describe('resolveImageObj — borne le get d’objet image', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('résout l’image quand le callback pdfjs répond', async () => {
    const page = { objs: { get: (name, cb) => cb({ width: 10, height: 10 }) } }
    await expect(resolveImageObj(page, 'img_a', 4000)).resolves.toEqual({ width: 10, height: 10 })
  })

  it('résout à null (image sautée) si le callback ne vient jamais — pas de gel', async () => {
    const page = { objs: { get: () => {} } } // ne rappelle jamais
    const p = resolveImageObj(page, 'img_b', 4000)
    vi.advanceTimersByTime(4000)
    await expect(p).resolves.toBeNull()
  })

  it('résout à null si objs.get jette', async () => {
    const page = { objs: { get: () => { throw new Error('boom') } } }
    await expect(resolveImageObj(page, 'img_c', 4000)).resolves.toBeNull()
  })
})

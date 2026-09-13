// Unitaire — garde d'exclusion mutuelle import↔synchro MD (cf. import-guard.js).
import { afterEach, describe, expect, it } from 'vitest'
import { beginImport, endImport, isImportRunning } from '@/backup/import-guard'

afterEach(() => {
  // Le drapeau est module-level (partagé entre tests) : on ne le laisse jamais
  // levé d'un test à l'autre, même si le test a échoué avant son propre endImport().
  endImport()
})

describe('import-guard', () => {
  it('faux par défaut, vrai entre beginImport et endImport', () => {
    expect(isImportRunning()).toBe(false)
    beginImport()
    expect(isImportRunning()).toBe(true)
    endImport()
    expect(isImportRunning()).toBe(false)
  })

  it('endImport sans beginImport préalable ne lève pas', () => {
    expect(() => endImport()).not.toThrow()
    expect(isImportRunning()).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'

describe('empty-samples', () => {
  it('parité i18n des clés exemple', () => {
    expect(fr.common.example && en.common.example).toBeTruthy()
    expect(fr.yarn.emptyExampleHint && en.yarn.emptyExampleHint).toBeTruthy()
    expect(fr.pattern.emptyExampleHint && en.pattern.emptyExampleHint).toBeTruthy()
    expect(fr.yarn.emptyExampleColor && en.yarn.emptyExampleColor).toBeTruthy()
    expect(fr.pattern.emptyExampleName && en.pattern.emptyExampleName).toBeTruthy()
  })
})

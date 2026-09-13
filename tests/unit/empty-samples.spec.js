import { describe, it, expect } from 'vitest'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import { EXAMPLE_YARN, EXAMPLE_PATTERN } from '@/constants/empty-samples'

describe('empty-samples', () => {
  it('expose des exemples plausibles', () => {
    expect(EXAMPLE_YARN.brand).toBeTruthy()
    expect(EXAMPLE_YARN.quantity).toBeGreaterThan(0)
    expect(EXAMPLE_PATTERN.sizes.length).toBeGreaterThan(0)
  })
  it('parité i18n des clés exemple', () => {
    expect(fr.common.example && en.common.example).toBeTruthy()
    expect(fr.yarn.emptyExampleHint && en.yarn.emptyExampleHint).toBeTruthy()
    expect(fr.pattern.emptyExampleHint && en.pattern.emptyExampleHint).toBeTruthy()
    expect(fr.yarn.emptyExampleColor && en.yarn.emptyExampleColor).toBeTruthy()
    expect(fr.pattern.emptyExampleName && en.pattern.emptyExampleName).toBeTruthy()
  })
})

// Le « (s) » mécanique fait négligé : vue-i18n sait accorder. Cf. audit UX 16/07.
import { describe, it, expect } from 'vitest'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'

function make(locale) {
  return createI18n({ legacy: false, locale, messages: { fr, en } }).global
}

describe('accord de home.wipSummary', () => {
  it('accorde au singulier en FR', () => {
    const { t } = make('fr')
    expect(t('home.wipSummary', { n: 1 }, 1)).toBe('Tu as 1 ouvrage en cours.')
  })

  it('accorde au pluriel en FR', () => {
    const { t } = make('fr')
    expect(t('home.wipSummary', { n: 3 }, 3)).toBe('Tu as 3 ouvrages en cours.')
  })

  it('accorde au singulier en EN', () => {
    const { t } = make('en')
    expect(t('home.wipSummary', { n: 1 }, 1)).toBe('You have 1 project in progress.')
  })

  it('accorde au pluriel en EN', () => {
    const { t } = make('en')
    expect(t('home.wipSummary', { n: 3 }, 3)).toBe('You have 3 projects in progress.')
  })

  it('ne contient plus le « (s) » mécanique', () => {
    expect(fr.home.wipSummary).not.toContain('(s)')
    expect(en.home.wipSummary).not.toContain('(s)')
  })
})

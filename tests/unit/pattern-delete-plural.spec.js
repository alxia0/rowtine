// pattern.deleteLinkedMsg est le SEUL message du projet à utiliser la syntaxe
// vue-i18n « singulier | pluriel ». L'e2e (pattern-delete-linked.spec.js) ne vérifie
// que le cas n=1 ; ce test protège l'accord pour n=1 ET n≥2, en FR et en EN.
import { describe, it, expect } from 'vitest'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'

function t(locale) {
  return createI18n({ legacy: false, locale, messages: { fr, en } }).global.t
}

describe('pattern.deleteLinkedMsg — pluralisation', () => {
  it('FR : accorde singulier (n=1) et pluriel (n=2), et les deux diffèrent', () => {
    const tr = t('fr')
    const singulier = tr('pattern.deleteLinkedMsg', { n: 1 }, 1)
    const pluriel = tr('pattern.deleteLinkedMsg', { n: 2 }, 2)

    expect(singulier).not.toBe(pluriel)
    expect(singulier).toContain('1 projet utilise ce patron')
    expect(pluriel).toContain('2 projets utilisent ce patron')
  })

  it('EN : accorde singulier (n=1) et pluriel (n=2), et les deux diffèrent', () => {
    const tr = t('en')
    const singular = tr('pattern.deleteLinkedMsg', { n: 1 }, 1)
    const plural = tr('pattern.deleteLinkedMsg', { n: 2 }, 2)

    expect(singular).not.toBe(plural)
    expect(singular).toContain('1 project uses this pattern')
    expect(plural).toContain('2 projects use this pattern')
  })
})

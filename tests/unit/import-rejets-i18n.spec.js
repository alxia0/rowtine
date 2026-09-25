import { describe, it, expect } from 'vitest'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'

describe('i18n des refus d’import', () => {
  for (const [lang, d] of Object.entries({ fr, en, de, es })) {
    it(`${lang} : notPattern et blockMultiPattern présents, adresse interpolée, aucun tiret long`, () => {
      const np = d.importLocal.notPattern
      const mp = d.importLocal.blockMultiPattern
      expect(typeof np).toBe('string')
      expect(np).toContain('{email}')
      expect(typeof mp).toBe('string')
      expect(np).not.toMatch(/[–—]/)
      expect(mp).not.toMatch(/[–—]/)
      expect(np).not.toMatch(/\|/) // vue-i18n lit « | » comme un pluriel
    })
  }
})

// Libellé du lien « Télécharger le guide sur le site » (`guide.downloadOnSite`), fixé VERBATIM
// par décision produit dans les 4 langues. Chaînes littérales : i18n-parity ne voit que les
// valeurs vides, pas un libellé remplacé par un autre texte.
import { describe, it, expect } from 'vitest'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'

const MESSAGES = { fr, en, de, es }

// Allemand : « Anleitung », aligné sur `about.guide` et `nav.library`, pas « Leitfaden ».
const EXPECTED = {
  fr: 'Télécharger le guide sur le site',
  en: 'Download the guide from the website',
  de: 'Die Anleitung auf der Website herunterladen',
  es: 'Descargar la guía en el sitio web',
}

describe('i18n — guide.downloadOnSite, VERBATIM dans les 4 langues', () => {
  for (const lang of Object.keys(EXPECTED)) {
    it(`${lang} : "${EXPECTED[lang]}"`, () => {
      expect(MESSAGES[lang].guide.downloadOnSite).toBe(EXPECTED[lang])
    })
  }
})

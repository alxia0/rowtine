// Libellé du lien « Télécharger le guide sur le site » sur l'écran Guide (clé
// `guide.downloadOnSite`), fixé VERBATIM par décision produit dans les 4 langues (« lien
// guide site », 12/08/2026) — le français en particulier n'est pas reformulable.
//
// Comparé à des CHAÎNES LITTÉRALES, pas juste « présent et non vide » : cette dernière
// vérification est déjà couverte par la règle 4 de tests/unit/i18n-parity.spec.js (aucune
// valeur vide dans les 4 fichiers) — mais elle ne verrait pas passer un libellé remplacé par
// un texte différent, toujours non vide. Preuve par mutation : vider UNE seule langue fait
// rougir l'assertion CI-DESSOUS (`toBe`, contre une valeur vide ce serait faux), pas
// seulement la règle 4.
import { describe, it, expect } from 'vitest'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'

const MESSAGES = { fr, en, de, es }

// Allemand : le projet tutoie, mais ce libellé est un infinitif sans personne — rien à
// accorder. Le mot retenu pour « guide » est « Anleitung », ALIGNÉ sur `about.guide` =
// « Anleitung zur App » (l'écran Guide lui-même) et `nav.library` = « Anleitungen » — pas
// « Leitfaden ». `guide.notTranslatedYet` employait aussi « Leitfaden » (incohérence relevée
// ici mais laissée hors périmètre de cette tâche) : corrigé le 12/08/2026 (parité guide ↔ app,
// même mot « Anleitung » partout), cf. guide-notranslatedyet-parite.spec.js.
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

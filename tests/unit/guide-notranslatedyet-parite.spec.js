// Balayage allemand (12/08/2026) : `guide.notTranslatedYet` (de.json) employait « Leitfaden »
// pour désigner CE guide, alors que l'écran s'intitule `about.guide` = « Anleitung zur App »
// et que la rangée « Télécharger le guide sur le site » (`guide.downloadOnSite`, 12/08) dit
// « Die Anleitung… » juste en dessous sur le même écran — deux mots différents pour la même
// chose, l'un absent de partout ailleurs dans l'interface. Cf. le commentaire de
// tests/unit/guide-download-on-site-i18n.spec.js, qui documentait déjà cette incohérence
// avant qu'elle ne soit corrigée ici.
//
// Comparé à des CHAÎNES LITTÉRALES (même motif que guide-download-on-site-i18n.spec.js) :
// une vérification « non vide » ne verrait pas passer un texte qui garde « Leitfaden ».
import { describe, it, expect } from 'vitest'
import de from '@/i18n/de.json'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import es from '@/i18n/es.json'

describe('i18n de — guide.notTranslatedYet nomme "Anleitung", pas "Leitfaden"', () => {
  it('vaut la formulation VERBATIM retenue', () => {
    expect(de.guide.notTranslatedYet).toBe(
      'Diese Anleitung ist noch nicht in deine Sprache übersetzt. Hier ist sie auf {lang}.',
    )
  })

  it('ne contient plus le mot "Leitfaden"', () => {
    expect(de.guide.notTranslatedYet).not.toContain('Leitfaden')
  })

  // fr/en/es ne sont pas concernés par ce défaut (leur propre mot pour « guide » est aussi
  // celui de leur menu) : preuve que rien n'y a bougé.
  it('fr/en/es restent inchangés', () => {
    expect(fr.guide.notTranslatedYet).toBe('Ce guide n\'est pas encore traduit dans ta langue : le voici en {lang}.')
    expect(en.guide.notTranslatedYet).toBe("This guide isn't translated into your language yet: here it is in {lang}.")
    expect(es.guide.notTranslatedYet).toBe('Esta guía todavía no está traducida a tu idioma. Aquí la tienes en {lang}.')
  })
})

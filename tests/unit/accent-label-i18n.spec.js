import { describe, it, expect } from 'vitest'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'

// Garde sur le libellé du bloc Réglages « Couleur d'ambiance » (retour terrain
// du 08/09) : l'ancien libellé « Couleur d'accent » a été renommé dans les 4
// langues, SANS changer la clé i18n `accent` (ni `accent.preset`/`accent.custom`).
// Le test de parité structurelle (i18n-parity.spec.js) vérifie que la clé existe
// partout, mais pas sa VALEUR : sans ce garde, un retour arrière du libellé fr
// (« Couleur d'accent ») ou un libellé vidé passerait inaperçu. Épinglé au
// caractère près côté français (langue de référence), simple présence non vide
// dans les trois autres langues (leur traduction peut évoluer en revue).
describe('accent.label : libellé « Couleur d’ambiance » dans les 4 langues', () => {
  it("fr : le libellé est exactement « Couleur d'ambiance » (renommage du 08/09, clé `accent` inchangée)", () => {
    expect(fr.accent.label).toBe("Couleur d'ambiance")
  })

  it.each([
    ['en', en],
    ['de', de],
    ['es', es],
  ])('%s : accent.label est présent et non vide', (_, dict) => {
    expect(typeof dict.accent.label).toBe('string')
    expect(dict.accent.label.length).toBeGreaterThan(0)
  })
})

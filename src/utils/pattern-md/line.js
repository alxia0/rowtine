// Aller-retour texte de rang ↔ placeholders {{i}} + vecteurs de comptes.
// Sérialisation : notation papier « a (b) c (d) … » (formatSizes) ; les vecteurs
// vides (isBlankCount) sont retirés. Parsing : réutilise la grammaire de
// non-invention de l'import PDF (exactement n valeurs → {{i}}).
import { formatSizes, isBlankCount } from '../reader'
import { applySizeVectors } from '../pdf-import/sizes'

export function stepTextToMd(t, c = []) {
  return String(t ?? '')
    .replace(/\s*\{\{(\d+)\}\}/g, (_m, d) => {
      const values = c[Number(d)] || []
      return isBlankCount(values) ? '' : ' ' + formatSizes(values)
    })
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function mdTextToStep(text, n) {
  const src = String(text ?? '')
  if (!n || n < 2) return { t: src }
  const { t, c } = applySizeVectors(src, n)
  return c.length ? { t, c } : { t: src }
}

// Tolère la virgule décimale (saisie FR, clavier numérique Android) là où Number() natif
// n'accepte que le point (tarif de pelote, taille d'aiguilles…).
export function parseDecimal(v) {
  return Number(String(v).replace(',', '.'))
}

// Ne garde d'une saisie que ce qui peut être un nombre : les chiffres, et le PREMIER
// séparateur décimal rencontré (virgule ou point, les deux sont acceptés — `parseDecimal`
// ci-dessus ramène l'un à l'autre).
//
// Un prix tapé « 18,90 € » — avec le symbole — donnait NaN, puis 0,
// puis s'affichait « Gratuit » aux trois endroits qui montrent un prix, et le total des
// dépenses ne bougeait pas. Décision produit : bloquer la saisie, plutôt que
// d'inventer un quatrième état d'affichage ou de deviner ce que l'utilisatrice voulait dire.
//
// Un séparateur SEUL est conservé (« 0, » reste « 0, ») : sans cela, la virgule serait
// effacée à l'instant même où elle est tapée et « 0,5 » deviendrait « 05 ».
// Le signe moins tombe : un prix négatif n'existe pas.
export function filtrerSaisieDecimale(v) {
  let vu = false
  let out = ''
  for (const c of String(v ?? '')) {
    if (c >= '0' && c <= '9') out += c
    else if ((c === ',' || c === '.') && !vu) {
      vu = true
      out += c
    }
  }
  return out
}

// Affiche une valeur décimale SAISIE en texte libre (diamètre d'aiguille, échantillon) avec le
// séparateur de la langue de l'app : « 4.5 » s'écrit « 4,5 » en fr/de/es, « 4.5 » en en, quelle
// que soit la saisie. La donnée stockée n'est jamais réécrite. Autant de décimales que la saisie
// (ni arrondi ni zéro ajouté). Une saisie qui n'est pas un nombre seul (« 4-4.5 », « 4 mm ») est
// rendue telle quelle : mieux vaut un séparateur étranger qu'une valeur perdue.
export function formatDecimalText(raw, locale) {
  const s = String(raw ?? '').trim()
  if (!/^\d+(?:[.,]\d+)?$/.test(s)) return s
  const frac = (s.split(/[.,]/)[1] || '').length
  // Au-delà de 20 décimales, Intl.NumberFormat lève une RangeError : rendu tel quel.
  if (frac > 20) return s
  return new Intl.NumberFormat(locale || 'fr', {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
    useGrouping: false,
  }).format(parseDecimal(s))
}

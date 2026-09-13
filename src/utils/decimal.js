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

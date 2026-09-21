// Géométrie pure du recadreur — extrait de PhotoCropper.vue pour rester testable sans monter
// de composant ni simuler d'événements pointeur. Zéro DOM, zéro store : uniquement des rects
// `{ x, y, w, h }`.

// Rect au ratio imposé, le plus grand possible dans `disp` (rect d'affichage « contain » de
// l'image), centré. Utilisé par PhotoCropper.computeLayout() quand un ratio est demandé.
export function initialRectForAspect(disp, ratio) {
  let w = disp.w
  let h = w / ratio
  if (h > disp.h) {
    h = disp.h
    w = h * ratio
  }
  return {
    x: disp.x + (disp.w - w) / 2,
    y: disp.y + (disp.h - h) / 2,
    w,
    h,
  }
}

// Redimensionnement par un coin (`mode` ∈ 'tl'|'tr'|'bl'|'br') à ratio FIXE : la largeur suit
// le geste (bornée par `bounds` et `min`, même calcul que le mode libre), la hauteur en dérive
// (`h = w / ratio`) ; si elle déborde verticalement, on repart de la hauteur maximale possible
// et on recalcule la largeur — jamais de rect final hors de `bounds` ni sous `min`.
export function resizeWithAspect(mode, orig, dx, dy, bounds, ratio, min) {
  const right = orig.x + orig.w
  const bottom = orig.y + orig.h
  // Le plancher ne peut pas porter sur la largeur SEULE : pour ratio > 1 (ex. 4/3), une
  // largeur au plancher `min` dériverait une hauteur SOUS `min` (h = w/ratio < min). Le
  // plancher combiné (`min * max(1, ratio)` en largeur, `min * max(1, 1/ratio)` en hauteur)
  // garantit que la dimension DÉRIVÉE respecte aussi `min`, pas seulement celle pilotée par
  // le geste.
  const minW = min * Math.max(1, ratio)
  const minH = min * Math.max(1, 1 / ratio)
  let w = orig.w
  if (mode.includes('l')) w = Math.max(minW, Math.min(orig.w - dx, right - bounds.x))
  if (mode.includes('r')) w = Math.max(minW, Math.min(orig.w + dx, bounds.x + bounds.w - orig.x))
  let h = w / ratio
  const maxH = mode.includes('t') ? bottom - bounds.y : bounds.y + bounds.h - orig.y
  if (h > maxH) {
    // Cas dégénéré assumé : si `bounds` est lui-même plus petit que le rect minimal au ratio
    // demandé, `minH` l'emporte sur `maxH` (léger débordement de `bounds`) plutôt que de
    // livrer un cadre sous `MIN` — inatteignable en pratique (le stage fait toujours
    // largement plus que 80px sur cette app).
    h = Math.max(minH, maxH)
    w = h * ratio
  }
  const x = mode.includes('l') ? right - w : orig.x
  const y = mode.includes('t') ? bottom - h : orig.y
  return { x, y, w, h }
}

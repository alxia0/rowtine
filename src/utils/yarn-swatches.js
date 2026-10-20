// Échantillons d'une laine : `yarn.swatches`, tableau de { mode, sizeMm, stitches, rows }.
// Tous les champs sont des chaînes ; mailles et rangs sont comptés pour 10 cm.
export const SWATCH_MODES = ['flat', 'round']

export function emptySwatch() {
  return { mode: 'flat', sizeMm: '', stitches: '', rows: '' }
}

const str = (v) =>
  typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v).trim() : ''

// Normalise une valeur lue en base : tolérante, jamais d'exception.
export function cleanSwatches(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const sw of value) {
    if (!sw || typeof sw !== 'object') continue
    const clean = {
      mode: SWATCH_MODES.includes(sw.mode) ? sw.mode : 'flat',
      sizeMm: str(sw.sizeMm),
      stitches: str(sw.stitches),
      rows: str(sw.rows),
    }
    if (clean.sizeMm || clean.stitches || clean.rows) out.push(clean)
  }
  return out
}

// Texte de lecture ; les parties vides sont omises, le mode est toujours présent.
export function swatchSummary(sw, t) {
  const stitches = str(sw?.stitches)
  const rows = str(sw?.rows)
  const sizeMm = str(sw?.sizeMm)
  const tension = [
    stitches && `${stitches} ${t('yarn.swatches.stitchesShort')}`,
    rows && `${rows} ${t('yarn.swatches.rowsShort')}`,
  ]
    .filter(Boolean)
    .join(' × ')
  return [
    t(sw?.mode === 'round' ? 'yarn.swatches.modeRound' : 'yarn.swatches.modeFlat'),
    sizeMm && `${sizeMm} mm`,
    tension && `${tension} ${t('yarn.swatches.per10')}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

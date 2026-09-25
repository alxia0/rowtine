// Export tableur (CSV). Séparateur « ; » (défaut Excel francophone) + BOM UTF-8 (accents).

// Une CHAÎNE qui commence par = + - @ tabulation ou retour chariot est lue comme une formule
// par le tableur (injection) : préfixée d'une apostrophe. Un nombre n'est jamais touché,
// un négatif doit rester un nombre.
const FORMULA_START_RE = /^[=+\-@\t\r]/

function cell(v) {
  let s = v == null ? '' : String(v)
  if (typeof v === 'string' && FORMULA_START_RE.test(s)) s = "'" + s
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function toCsv(headers, rows) {
  const lines = [headers.map(cell).join(';')]
  for (const r of rows) lines.push(r.map(cell).join(';'))
  return lines.join('\r\n')
}

export function downloadCsv(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)
}

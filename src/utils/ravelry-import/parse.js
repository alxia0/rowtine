// Lecture du fichier d'export Ravelry (.xls/.xlsx/.csv), tout se passe EN MÉMOIRE via la
// lib `xlsx` (SheetJS), aucun accès réseau. Résout chaque en-tête vers son champ rowtine
// (field-aliases.js) une fois pour toutes : map-row.js (Task 5) travaille ensuite sur des
// lignes déjà keyées par CHAMP, jamais par en-tête brut, un fichier dont les colonnes ne
// sont pas dans le même ordre que l'export de référence reste importable.
import * as XLSX from 'xlsx'
import { fieldForHeader, isIgnoredHeader, normalizeHeader } from './field-aliases'

// Noms des onglets de l'export stash Ravelry, normalisés (cf. field-aliases.js#normalizeHeader).
const RAVELRY_STATUSES = new Set(['in stash', 'all used up', 'will trade or sell', 'traded, sold, gifted'])

export async function parseRavelryFile(file) {
  const buffer = await file.arrayBuffer()
  // `cellDates: true` : sans cette option, une cellule Excel réellement TYPÉE date revient
  // de SheetJS sous forme de nombre de série brut (ex. 46165.08...), jamais d'objet `Date`.
  // La branche `raw instanceof Date` de `map-row.js` (`toDateString`) serait alors
  // inatteignable pour ce cas-là, malgré le commentaire qui le prévoit.
  // `raw: true` : sans effet sur un .xls/.xlsx (cellules déjà typées, vérifié sur les exports
  // réels), mais un CSV garde alors ses cellules en chaînes brutes. Sinon SheetJS lit « 12,50 »
  // comme 1250 (virgule prise pour un séparateur de milliers) et ancre une date non ISO à
  // minuit LOCAL, que `toDateString` reculait d'un jour à l'est de Greenwich.
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, raw: true })
  // Le vrai export stash Ravelry n'a PAS de colonne Status : il range chaque statut dans son
  // propre onglet (« In stash », « All used up », ...), chacun avec sa ligne d'en-têtes. On lit
  // donc tous les onglets, et le nom d'un onglet sert de statut quand la ligne n'en a pas, mais
  // seulement s'il s'agit d'un statut Ravelry connu : un « Sheet1 » ne doit pas masquer
  // l'absence de statut (signalée par index.js#statusColumnMissing).
  let headers = []
  const unmappedHeaders = []
  const rows = []
  for (const sheetName of workbook.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' })
    const [headerRow, ...dataRows] = grid
    const sheetHeaders = (headerRow || []).map((h) => String(h || '').trim())
    if (!headers.length) headers = sheetHeaders
    for (const h of sheetHeaders) {
      if (h && !fieldForHeader(h) && !isIgnoredHeader(h) && !unmappedHeaders.includes(h)) unmappedHeaders.push(h)
    }
    const sheetStatus = RAVELRY_STATUSES.has(normalizeHeader(sheetName)) ? sheetName : ''
    for (const r of dataRows) {
      if (!(r || []).some((cell) => String(cell ?? '').trim() !== '')) continue
      const row = {}
      sheetHeaders.forEach((h, i) => {
        const field = fieldForHeader(h)
        if (field) row[field] = r[i]
      })
      if (!('status' in row) && sheetStatus) row.status = sheetStatus
      rows.push(row)
    }
  }
  return { headers, unmappedHeaders, rows }
}

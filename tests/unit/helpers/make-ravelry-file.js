// Construit un fichier .xlsx en mémoire (en-têtes + lignes) pour les tests de
// src/utils/ravelry-import/, les deux fichiers réels examinés pendant le brainstorming
// (un stash de test public, un stash réel d'Alexia) vivent hors du dépôt (/tmp, kDrive),
// donc aucun fichier fixture n'est commité : ce helper reconstruit le format vérifié
// (25 en-têtes fixes) à la volée.
import * as XLSX from 'xlsx'

export function makeRavelryFile(headers, rows, name = 'stash.xlsx') {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Stash')
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new File([buffer], name)
}

// Variante multi-onglets, fidèle au VRAI export stash Ravelry : pas de colonne Status, le
// statut est porté par le nom de l'onglet (« In stash », « All used up », « Will trade or
// sell », « Traded, sold, gifted »), chaque onglet répète la ligne d'en-têtes.
// `sheets` : { [nomOnglet]: lignes[] }.
export function makeRavelryWorkbookFile(headers, sheets, name = 'stash.xls') {
  const wb = XLSX.utils.book_new()
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), sheetName)
  }
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new File([buffer], name)
}

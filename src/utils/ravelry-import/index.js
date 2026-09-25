// Orchestrateur de l'import Ravelry : lit le fichier, mappe chaque ligne, dédoublonne,
// SANS rien écrire en base (c'est RavelryImportView.vue qui écrit, à la confirmation).
import { parseRavelryFile } from './parse'
import { mapRow } from './map-row'
import { classifyRows } from './dedupe'

export async function planRavelryImport(file, existingYarns) {
  const { unmappedHeaders, rows } = await parseRavelryFile(file)
  const mappedRows = rows.map((row) => {
    const { yarn, purchase, colorNameFromFamily } = mapRow(row)
    return { status: row.status, yarn, purchase, colorNameFromFamily }
  })
  const { created, alreadyPresent, excludedStatus } = classifyRows(mappedRows, existingYarns)
  // Colonne Status absente (ou en-tête non reconnu) : `parseRavelryFile` ne pose alors AUCUNE
  // clé `status` sur les lignes (cf. son commentaire), donc chaque ligne finit dans
  // `excludedStatus` pour la mauvaise raison. On le détecte sur les lignes brutes (`rows`,
  // pas `mappedRows` où `status` existe toujours, ne serait-ce qu'à `undefined`) : un fichier
  // vide ne doit pas non plus déclencher ce signal, il n'y a alors rien à diagnostiquer.
  const statusColumnMissing = rows.length > 0 && !rows.some((row) => 'status' in row)
  return {
    totalRows: rows.length,
    unmappedHeaders,
    toCreate: created,
    alreadyPresentCount: alreadyPresent.length,
    excludedStatusCount: excludedStatus.length,
    statusColumnMissing,
  }
}

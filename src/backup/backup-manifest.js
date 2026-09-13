// Rowtine — la fiche d'identité de la sauvegarde (depuis le 06/08/2026).
//
// POURQUOI CE FICHIER EXISTE. Avant lui, rien dans le dossier ne disait QUAND la
// sauvegarde avait été écrite ni PAR QUI. L'auteur de l'app lui-même n'a pas su décider
// s'il devait restaurer, le 06/08 au matin.
//
// ⚠️ ON NE PEUT PAS SE SERVIR DE `reglages.json` POUR ÇA. Il porte bien un `lastBackupAt`,
// mais l'instantané est collecté par `collectBackupData()` AVANT que
// `setSetting('lastBackupAt')` ne soit appelé : la date qu'il contient est celle de
// l'écriture PRÉCÉDENTE. Mesuré deux fois le 06/08 (07:14:22 dans le fichier contre
// 07:15:18 affiché, puis 08:53:46 contre 08:54). D'où `ecritLe`, produit ICI, au moment
// de l'écriture.
//
// ⚠️ SÛRETÉ : `reconcile` (orchestrator.js) ne balaie que `Projets/` et `Patrons/`,
// jamais la racine — ce fichier ne peut donc pas être emporté par le mécanisme qui a
// détruit 33 Mo le 04/08. Cette propriété est vérifiée par un test, pas supposée.
import { db } from '@/db/db'
import { deviceId, deviceName } from './device-identity'
import { isLibraryPattern } from '@/utils/pattern-price'

export const MANIFEST_PATH = 'sauvegarde.json'

async function localCounts() {
  const [projets, patrons, laines] = await Promise.all([
    db.projects.count(),
    db.patterns.filter(isLibraryPattern).count(),
    db.yarns.count(),
  ])
  return { projets, patrons, laines }
}

export async function buildManifest() {
  // ⚠️ La clé `modeleAppareil` reste inchangée alors que la valeur qu'elle porte a
  // changé : ce n'est plus le seul `Build.MODEL` mais un NOM composé, plus large qu'un
  // modèle (marque + modèle, voire le nom donné par l'utilisatrice — cf.
  // `composeDeviceName`). La renommer priverait de nom les fiches déjà écrites depuis le
  // 07/08 jusqu'à leur prochaine sauvegarde, sans rien apporter.
  const [appareil, modeleAppareil, contenu] = await Promise.all([
    deviceId(),
    deviceName(),
    localCounts(),
  ])
  return {
    version: 1,
    ecritLe: new Date().toISOString(),
    appareil,
    modeleAppareil,
    contenu,
  }
}

// Ne lève JAMAIS : une fiche non écrite ne doit pas faire échouer une sauvegarde qui a
// réussi. Le cas se rattrape à l'écriture suivante.
export async function writeManifest(storage) {
  try {
    const manifest = await buildManifest()
    await storage.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), { encoding: 'utf8' })
    return true
  } catch {
    return false
  }
}

// TROIS états, jamais deux. « absent » = sauvegarde écrite avant l'ajout de cette fiche : comportement
// historique, aucune alerte. « invalid » = fichier présent mais inexploitable : repli
// prudent, on suspend. Les confondre bloquerait toutes les utilisatrices existantes dès
// l'installation, ou au contraire laisserait écraser sur un fichier corrompu.
export async function readManifest(storage) {
  let raw
  try {
    if (!(await storage.exists(MANIFEST_PATH))) return { state: 'absent' }
    raw = await storage.readFile(MANIFEST_PATH, { encoding: 'utf8' })
  } catch {
    return { state: 'invalid' }
  }
  try {
    const manifest = JSON.parse(raw)
    if (!manifest || typeof manifest !== 'object') return { state: 'invalid' }
    if (typeof manifest.appareil !== 'string' || !manifest.appareil) return { state: 'invalid' }
    return { state: 'ok', manifest }
  } catch {
    return { state: 'invalid' }
  }
}

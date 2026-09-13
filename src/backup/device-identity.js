// Rowtine — l'identité de CET appareil (lot du 06/08/2026).
//
// ⚠️ `deviceId` DOIT figurer dans EXCLUDED_SETTINGS_KEYS (serialize.js). S'il partait
// dans la sauvegarde, `writeSnapshotToDb` — qui fait primer les réglages du snapshot —
// donnerait à un téléphone neuf l'identité de l'ancien : il se croirait propriétaire du
// dossier, et l'alerte « un autre appareil a écrit ici » ne se déclencherait JAMAIS.
// C'est mot pour mot le défaut déjà corrigé pour `backupDecision` le 04/08.
import { getSetting, setSetting } from '@/db/db'
import { RowtineSaf } from './saf-plugin'

const KEY = 'deviceId'

function newId() {
  // `crypto.randomUUID` existe dans la WebView Android de Capacitor 8 et sous Node ≥ 19.
  // Le repli couvre les environnements de test plus anciens : il n'a pas besoin d'être
  // cryptographiquement fort, seulement de ne pas collisionner entre deux appareils.
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `dev-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

// Identifiant stable de cet appareil. Créé au premier appel, jamais régénéré ensuite —
// le régénérer ferait passer l'appareil pour un autre à ses propres yeux.
export async function deviceId() {
  const existing = await getSetting(KEY)
  if (typeof existing === 'string' && existing) return existing
  const id = newId()
  await setSetting(KEY, id)
  return id
}

// `Build.MODEL` est une loterie : lisible sur certains appareils (« Nexus 7 »), un code
// sur d'autres (« LYA-L29 », mesuré le 07/08). Composer avec la marque et, quand elle
// existe, avec le nom que l'utilisatrice a donné à son appareil rend le résultat
// exploitable dans TOUS les cas plutôt que de dépendre de la chance du fabricant.
//
// Fonction PURE, sans mock à écrire : aucun accès plateforme ici, seulement les trois
// interfaces publiques déjà lues par le natif (`Settings.Global.device_name`,
// `Build.MODEL`, `Build.MANUFACTURER` — jamais le nom commercial, restreint depuis
// Android 9).
export function composeDeviceName({ userName = '', model = '', manufacturer = '' } = {}) {
  const trimmedUserName = (userName || '').trim()
  const trimmedModel = (model || '').trim()
  const trimmedManufacturer = (manufacturer || '').trim()

  // Règle 1 : le nom donné par l'utilisatrice ne compte que s'il DIFFÈRE du modèle.
  // Sur les deux appareils mesurés le 07/08, le système préremplit `device_name` AVEC
  // le modèle — le retenir tel quel ne dirait rien de plus qu'afficher le modèle brut ;
  // ce n'est un choix de l'utilisatrice que s'il s'en écarte.
  if (trimmedUserName && trimmedUserName.toLowerCase() !== trimmedModel.toLowerCase()) {
    return trimmedUserName
  }

  // Règle 2 : marque + modèle. Ne pas dupliquer une marque déjà présente dans le modèle
  // (« Samsung Samsung SM-… » serait absurde), comparaison insensible à la casse.
  if (!trimmedModel) return null
  if (!trimmedManufacturer) return trimmedModel
  if (trimmedModel.toLowerCase().includes(trimmedManufacturer.toLowerCase())) {
    return trimmedModel
  }
  // Marque tout en minuscules (« asus ») ⇒ première lettre en capitale. Une marque déjà
  // mixte (« HUAWEI », « OnePlus ») est laissée telle quelle : c'est la forme voulue par
  // le fabricant, la modifier introduirait une casse jamais vue sur l'appareil réel.
  const brand =
    trimmedManufacturer === trimmedManufacturer.toLowerCase()
      ? trimmedManufacturer.charAt(0).toUpperCase() + trimmedManufacturer.slice(1)
      : trimmedManufacturer
  return `${brand} ${trimmedModel}`
}

// Nom lisible de l'appareil, pour nommer l'appareil dans les messages plutôt que de dire
// « un autre appareil ». FACULTATIF par construction : `null` sur web/dev, sur un build
// natif antérieur à ce lot (la méthode n'existe pas → UNIMPLEMENTED), sur erreur, ou si
// rien d'exploitable n'a pu être composé. Aucun appelant ne doit en dépendre.
export async function deviceName() {
  try {
    const { userName, model, manufacturer } = await RowtineSaf.deviceName()
    return composeDeviceName({ userName, model, manufacturer })
  } catch {
    return null
  }
}

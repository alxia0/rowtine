// Désignation du dossier SAF, en un seul geste (lot « premier lancement simplifié »,
// 09/08/2026). Le natif ouvre le sélecteur et prend la permission SANS PERSISTER
// (`chooseFolder`), puis `confirmFolder(base)` crée le sous-dossier si la base le
// demande et persiste.
//
// LA CONFIRMATION A ÉTÉ RETIRÉE. Avant ce lot, un `window.confirm` demandait
// « Rowtine stockera ses données dans "Documents/Rowtine". Créer ce dossier ? » entre
// les deux phases. C'était la TROISIÈME question posée au premier lancement, pour une
// réponse dont l'app n'a rien à faire : refuser ne menait nulle part. Elle était en
// revanche le SEUL endroit où l'app annonçait l'emplacement réel — d'où `label`
// ci-dessous, remonté à l'appelant.
//
// DEPUIS L'ADOPTION (plan 06/09/2026), ce label n'est plus un champ natif
// (`resolvedLabel` a disparu avec `computeBase`) : il est COMPOSÉ ICI. La décision
// d'emplacement vit dans folder-base.js (`decideBase`, règle à 4 branches sur les
// faits bruts du plugin) ; `composeLabel` rend « <choisi> » ou « <choisi>/Rowtine ».
// C'est la seule occasion de connaître l'emplacement : `name` n'est rapporté qu'à
// la désignation, et `uri` sert d'identifiant discriminant (folderKey(), cf.
// saf-folder.js), pas de nom lisible.
//
// `discardFolder` n'a plus d'appelant ICI (il n'y a plus rien à annuler entre les deux
// phases) mais reste exporté par saf-folder.js : le plugin natif garde la méthode, et
// la retirer sortirait du périmètre de ce lot.
//
// NE CAPTURE PAS les erreurs : `confirmFolder` rejette quand la création de « Rowtine »
// est impossible (plugin, `call.reject`). Avant ce lot ce rejet n'était capté nulle
// part — une promesse rejetée silencieuse. C'est l'APPELANT qui sait quoi afficher.
import { chooseFolder, confirmFolder } from './saf-folder'
import { decideBase, composeLabel } from './folder-base'

export async function designateFolder() {
  const picked = await chooseFolder()
  if (!picked.granted) return { granted: false, label: null }
  // L'enfant « Rowtine » (branche 2) est rapporté comme n'importe quelle
  // sonde de PROBES : un hit en DOSSIER fait l'enfant établi — un simple
  // FICHIER nommé « Rowtine » n'en est pas un.
  const rowtineChildExists = picked.probeHits.some((h) => h.name === 'Rowtine' && h.isDir)
  const base = decideBase({ name: picked.name, rowtineChildExists, probeHits: picked.probeHits })
  const { granted } = await confirmFolder(base)
  return { granted, label: composeLabel(picked.name, base) }
}

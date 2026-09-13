// Rowtine — orchestrateur de sauvegarde.
// `backupAll` écrit l'arborescence complète via une `BackupStorage` (mémoire en test,
// native sur device) : dossiers Projets/Patrons, renommage sans perte de photos,
// écriture incrémentale des fichiers lourds (photos, PDF), nettoyage des orphelins,
// réconciliation des suppressions calée sur la corbeille (`snapshot.keepIds`), et
// écriture de `corbeille.json` (`snapshot.trashIds`) — index que S3 consulte pour ne
// PAS restaurer comme actif un dossier dont le contenu a été supprimé (cf. restore.js).
import { serializeProject, serializePattern, serializeYarns, serializePurchases, serializeActiveDays, serializeIndependentCounters, serializeSettings, serializeTrashIndex, YARN_PHOTOS_DIR } from './serialize'
import { parseEntryId, hash8 } from './naming'

// Motif des fichiers lourds "gérés" d'un dossier d'entrée (photos, images de galerie
// + PDF importé) : seuls ceux-là sont candidats au nettoyage des orphelins (le *.json
// n'est jamais considéré comme orphelin, il est toujours réécrit). `startsWith` (et non
// `===`) pour `original.pdf` : ça couvre aussi le résidu `original.pdf.tmp` d'une écriture
// atomique interrompue (cf. `writeEntry`), qui doit être nettoyé comme les autres.
//
// `gallery-` a été AJOUTÉ à la revue du 15/08/2026 : il manquait depuis l'origine, alors
// que `buildGalleryFiles` (serialize.js) écrit bien des `gallery-<hash>.jpg` dans le
// dossier de l'entrée. Chaque modification d'une galerie laissait donc l'ancienne version
// sur le disque, définitivement — et une galerie issue d'un PDF compte des dizaines
// d'images. C'est sans danger parce que les DEUX producteurs de ces fichiers émettent
// toujours dans `files` ce qu'ils référencent, sous un nom dérivé du CONTENU : côté
// serialize (`buildGalleryFiles`) comme côté patron.md (`patternToMd`, dont le helper
// `asset` pousse le fichier dans `files` avant d'en rendre le chemin). Un `gallery-*`
// absent de `keepNames` n'est donc jamais un fichier encore référencé — même règle, et
// même raisonnement, que pour `photo-` depuis l'origine.
function isManagedHeavyFile(name) {
  return (
    name.startsWith('photo-') ||
    name.startsWith('patron-photo-') ||
    name.startsWith('gallery-') ||
    name.startsWith('original.pdf')
  )
}

// Index id -> nom de dossier sous `rootDir`, construit par UN SEUL `readdir` — appelé
// une fois par racine (Projets, puis Patrons) avant la boucle correspondante dans
// `backupAll`, et le Map résultant est passé tel quel à `writeEntry` pour chaque
// entrée de cette boucle : sans cet index, `writeEntry` relisait l'INTÉGRALITÉ de
// `rootDir` à CHAQUE entrée écrite (N appels `readdir` natifs pour N entrées, au lieu
// d'un seul). « premier trouvé gagne » (comme l'ancien `.find`) : sur une corruption
// préexistante (deux dossiers pour le même id, cf. writeEntry), le doublon obsolète
// reste ignoré, pas seulement laissé intact.
async function folderNameIndex(storage, rootDir) {
  const entries = await storage.readdir(rootDir)
  const byId = new Map()
  for (const entry of entries) {
    if (!entry.isDir) continue
    const id = parseEntryId(entry.name)
    if (id != null && !byId.has(id)) byId.set(id, entry.name)
  }
  return byId
}

// Détecte une édition externe de `patron.md` NON ENCORE fusionnée par la synchro
// MD — correctif revue finale (Critical, perte de données) : sans cette
// garde, une sauvegarde auto (débounce sur mutation, AUCUNE synchro en cours —
// les gardes d'exclusion mutuelle backup↔sync ne protègent pas ce cas)
// régénère `patron.md` depuis la base et écrase silencieusement une édition PC
// en attente de fusion, pour toujours (le témoin réaligné ferait croire à la
// prochaine synchro que rien n'a changé).
// Renvoie `true` si un `patron.md` existe sur disque et que son hash ne
// correspond PAS au témoin `patron.json.patronMd.hash` — auquel cas l'entrée
// entière ne doit PAS être réécrite par cette passe. Prudence par défaut :
// si le témoin ne peut pas être déterminé (patron.json absent, illisible, ou
// sans `patronMd.hash`) alors qu'un patron.md existe déjà, on considère
// l'édition comme en attente plutôt que de risquer un écrasement.
async function hasPendingExternalMdEdit(storage, dir) {
  const mdPath = `${dir}/patron.md`
  if (!(await storage.exists(mdPath))) return false // rien sur disque : 1er backup, pas d'édition à préserver.

  const jsonPath = `${dir}/patron.json`
  try {
    if (!(await storage.exists(jsonPath))) return true // md sans témoin : ne peut pas prouver l'absence d'édition.
    const diskMd = await storage.readFile(mdPath, { encoding: 'utf8' })
    const diskJson = JSON.parse(await storage.readFile(jsonPath, { encoding: 'utf8' }))
    const witness = diskJson.patronMd?.hash
    if (witness == null) return true // pas de témoin exploitable : prudence.
    return hash8(diskMd) !== witness
  } catch {
    return true // JSON illisible/corrompu : prudence, on ne touche à rien.
  }
}

// Écrit une entrée sérialisée (projet ou patron de bibliothèque) : gère le
// renommage éventuel, écrit les *.json (toujours) et les fichiers lourds
// (incrémental — seulement s'ils n'existent pas déjà), puis nettoie les fichiers
// lourds orphelins (ex. photo retirée de l'entité depuis la dernière sauvegarde).
// Note : `original.pdf` a un nom FIXE (contrairement aux photos, nommées par hash
// de contenu) ; s'il existe déjà, il n'est pas réécrit même si le contenu source a
// changé. Non testé ici car le flux applicatif ne permet pas de remplacer le PDF
// d'un patron/instance sous le même id (un ré-import crée une nouvelle entité) —
// à revalider si ce flux évolue.
async function writeEntry(storage, rootDir, serialized, id, stats, report, folderIndex) {
  const { dir, files } = serialized
  const targetName = dir.slice(rootDir.length + 1)

  const existingName = folderIndex.get(id) ?? null
  if (existingName != null && existingName !== targetName && !(await storage.exists(dir))) {
    // Renomme le dossier : les fichiers déjà présents (photos) suivent, pas de
    // réécriture nécessaire.
    // Garde : si un dossier existe déjà pile au nom cible, on ne renomme PAS
    // par-dessus (rename remplace la destination — ça détruirait son contenu).
    // Cas d'edge de corruption pré-existante (deux dossiers pour le même id) :
    // on laisse le doublon obsolète tel quel et on écrit simplement dans la cible.
    await storage.rename(`${rootDir}/${existingName}`, dir)
    // Le cache doit refléter le renommage : une entrée suivante qui chercherait le
    // même id (ne devrait pas arriver dans un même snapshot, mais par prudence)
    // doit retrouver le nom À JOUR, pas l'ancien.
    folderIndex.set(id, targetName)
  }

  // Garde anti-écrasement (correctif revue finale) : si cette entrée PRODUIT un
  // patron.md (patron de bibliothèque, ou projet avec instancePattern forké) ET
  // qu'une édition externe non fusionnée est détectée sur disque, on N'ÉCRIT
  // RIEN pour cette entrée (ni fichiers légers/lourds, ni nettoyage des
  // orphelins) — un skip TOTAL, pas seulement du patron.md/patron.json : une
  // écriture partielle (ex. régénérer les photos depuis la DB puis balayer les
  // orphelins) pourrait supprimer un asset que le patron.md externe référence
  // mais que l'état DB courant ne référence plus, corrompant l'édition en
  // attente. La prochaine synchro MD (N2) fusionnera cette édition ; l'entrée
  // sera de nouveau sauvegardée normalement au cycle suivant.
  if (files.some((f) => f.path === `${dir}/patron.md`) && (await hasPendingExternalMdEdit(storage, dir))) {
    return
  }

  // Ensemble des noms de fichiers produits par CETTE sérialisation — sert à la fois
  // de garde d'écriture (rien, on écrit toujours ce qui est dans `files`) et de
  // référence pour le nettoyage des orphelins ci-dessous. On le construit à partir
  // des fichiers réellement produits (pas de `photoNames`, qui peut contenir des
  // doublons et mélanger plusieurs préfixes) — plus sûr.
  const keepNames = new Set(files.map((f) => f.path.split('/').pop()))

  for (const file of files) {
    if (file.encoding === 'utf8') {
      // JSON : léger, toujours (ré)écrit pour refléter l'état courant.
      await storage.writeFile(file.path, file.data, { encoding: file.encoding })
      stats.written++
      report?.()
    } else if (!(await storage.exists(file.path))) {
      // Fichier lourd (photo, PDF) : écriture incrémentale, seulement s'il manque.
      // Écriture ATOMIQUE (temp + rename) : si l'appli est tuée pendant l'écriture,
      // on obtient un résidu `<nom>.tmp` (jamais `<nom>` lui-même) — le prochain
      // backup le retentera au lieu de le considérer, à tort, comme déjà présent
      // (sans ça, un fichier partiel sous le nom final ne serait plus jamais réécrit,
      // le nom étant dérivé du hash de contenu donc stable). `rename` remplace la
      // cible atomiquement côté storage (natif comme mémoire).
      const tmpPath = `${file.path}.tmp`
      await storage.writeFile(tmpPath, file.data, { encoding: file.encoding })
      await storage.rename(tmpPath, file.path)
      stats.written++
      report?.()
    }
  }

  const dirEntries = await storage.readdir(dir)
  for (const entry of dirEntries) {
    if (entry.isDir) continue
    if (isManagedHeavyFile(entry.name) && !keepNames.has(entry.name)) {
      await storage.remove(`${dir}/${entry.name}`)
      stats.removed++
    }
  }

  // Dossier de PROJET uniquement (un dossier de patron de bibliothèque a toujours
  // un patron.json — rien à nettoyer là) : si cette sérialisation n'a pas produit
  // de patron.json (l'instancePattern a été retiré — projet relié à un autre
  // patron), mais qu'un patron.json d'une sauvegarde précédente traîne encore,
  // c'est un orphelin — on le supprime. `projet.json` n'est jamais concerné.
  if (rootDir === 'Projets' && !keepNames.has('patron.json')) {
    const patronJsonPath = `${dir}/patron.json`
    if (await storage.exists(patronJsonPath)) {
      await storage.remove(patronJsonPath)
      stats.removed++
    }
  }
}

// Supprime, sous `rootDir`, les dossiers dont l'id ne fait plus partie de
// `keepIds` (ids actifs ∪ corbeille) — un dossier dont l'id reste en corbeille
// n'est PAS touché ici (il n'est simplement pas écrit tant qu'il n'est pas réactivé).
async function reconcile(storage, rootDir, keepIds, stats) {
  const keep = new Set(keepIds)
  const entries = await storage.readdir(rootDir)
  for (const entry of entries) {
    if (!entry.isDir) continue
    const id = parseEntryId(entry.name)
    // Dossier ne suivant pas le format `<slug> [id]` : on ne le touche pas
    // (prudence — pourrait être un fichier déposé manuellement par l'utilisateur).
    if (id === null) continue
    if (!keep.has(id)) {
      await storage.remove(`${rootDir}/${entry.name}`)
      stats.removed++
    }
  }
}

// Supprime, sous `Laines/`, les photos de laine que plus AUCUNE laine ne référence
// (21/08/2026). C'est le ménage que la racine ne pouvait pas recevoir : `reconcile`
// ci-dessus raisonne sur des DOSSIERS `<slug> [id]`, alors qu'une photo de laine est un
// fichier plat. Résultat, depuis le 15/08 une photo remplacée ou supprimée restait sur le
// disque POUR TOUJOURS (dette technique connue) — ranger les photos dans leur dossier est ce
// qui rend ce nettoyage possible sans risque.
//
// ⚠️ Deux prudences, toutes deux délibérées :
//   - on ne touche QUE les fichiers `laine-photo-*` : un fichier étranger déposé à la main
//     dans le dossier est laissé tranquille, comme `reconcile` laisse un dossier au nom
//     non conforme ;
//   - on ne touche JAMAIS la racine, où dorment les photos d'avant ce lot. La restauration
//     les lit encore (cf. restore.js) ; les effacer ici serait une perte silencieuse.
//
// 🔎 Les résidus d'écriture SONT balayés, et c'est VOULU — divergence assumée d'avec
// `RESIDU_ECRITURE` (restore.js), qui les ignore à la LECTURE. Le pont natif écrit d'abord
// dans `<nom>.part` puis renomme (saf-storage.js) : un `laine-photo-<hash>.jpg.part` observé
// sur le Huawei le 21/08 est le résidu d'une écriture interrompue, un déchet que personne ne
// lira jamais. Ce ménage tourne APRÈS l'écriture séquentielle des fichiers racine, donc
// jamais pendant qu'une photo s'écrit.
async function reconcileYarnPhotos(storage, keepNames, stats) {
  const keep = new Set(keepNames || [])
  const entries = await storage.readdir(YARN_PHOTOS_DIR)
  for (const entry of entries) {
    if (entry.isDir) continue
    if (!entry.name.startsWith('laine-photo-')) continue
    if (keep.has(entry.name)) continue
    await storage.remove(`${YARN_PHOTOS_DIR}/${entry.name}`)
    stats.removed++
  }
}

// Sauvegarde complète : écrit l'arborescence Projets/Patrons + fichiers racine,
// puis réconcilie les suppressions. Renvoie des compteurs (fichiers écrits,
// fichiers/dossiers supprimés) — utilisés pour le retour utilisateur.
//
// `onProgress` est OPTIONNEL et n'est passé que par les
// opérations que l'utilisatrice a explicitement demandées. La sauvegarde
// automatique de fond n'en fournit aucun : elle reste donc muette, sans quoi
// l'interface clignoterait toutes les huit secondes pendant qu'elle tricote.
//
// Deux granularités, volontairement : `done`/`total` comptent les ENTRÉES (un
// dossier chacune), tandis que `written` compte les FICHIERS. Un ouvrage à
// quarante photos est une seule entrée mais la moitié du temps — sans le compteur
// de fichiers, la barre semblerait figée pile au moment le plus long.
export async function backupAll(storage, snapshot, { onProgress } = {}) {
  const stats = { written: 0, removed: 0 }
  const projects = snapshot.projects || []
  const libraryPatterns = snapshot.libraryPatterns || []
  const total = projects.length + libraryPatterns.length
  let done = 0
  const report = onProgress
    ? () => onProgress({ phase: 'backup', done, total, written: stats.written })
    : null

  await storage.mkdir('Projets')
  await storage.mkdir('Patrons')
  report?.()

  // Un seul `readdir` par racine (Projets, puis Patrons) — cf. folderNameIndex.
  // `backupAll` boucle une racine à la fois, donc chaque index n'a besoin d'être
  // construit qu'une fois, juste avant sa boucle.
  const projectsFolderIndex = await folderNameIndex(storage, 'Projets')
  for (const project of projects) {
    // `instancePattern` (patron forké pour ce projet) est sérialisé à part dans
    // serializeProject ; les autres champs embarqués (sections, counters, …) sont
    // déjà des propriétés de `project` — on les extrait pour ne pas les laisser
    // fuiter tels quels via le spread `...project` de serializeProject.
    const { sections, counters, sessions, diagrams, instancePattern, ...projectFields } = project
    const serialized = serializeProject(projectFields, {
      sections,
      counters,
      sessions,
      diagrams,
      instancePattern,
    })
    await writeEntry(storage, 'Projets', serialized, project.id, stats, report, projectsFolderIndex)
    done++
    report?.()
  }

  const patternsFolderIndex = await folderNameIndex(storage, 'Patrons')
  for (const pattern of libraryPatterns) {
    const serialized = serializePattern(pattern)
    await writeEntry(storage, 'Patrons', serialized, pattern.id, stats, report, patternsFolderIndex)
    done++
    report?.()
  }

  // serializeYarns renvoie PLUSIEURS fichiers depuis le 15/08/2026 (laines.json + un
  // laine-photo-* par photo externalisée) — les autres sérialiseurs racine en renvoient
  // toujours un seul chacun.
  const { files: yarnFiles, photoNames: yarnPhotoNames } = serializeYarns(snapshot.yarns || [])
  const rootFiles = [
    ...yarnFiles,
    serializePurchases(snapshot.purchases || []),
    serializeActiveDays(snapshot.activeDays || []),
    serializeIndependentCounters(snapshot.independentCounters || []),
    serializeSettings(snapshot.settings || {}),
    serializeTrashIndex(snapshot.trashIds || { projects: [], patterns: [] }),
  ]
  // SÉQUENTIEL, jamais en concurrence : c'est cet ordre-là (photos de laine avant
  // laines.json — cf. serializeYarns) qui garantit qu'une écriture interrompue ne publie
  // jamais un laines.json pointant vers des laine-photo-* absents. Paralléliser cette
  // boucle (Promise.all) casserait cette garantie silencieusement.
  for (const file of rootFiles) {
    await storage.writeFile(file.path, file.data, { encoding: file.encoding })
    stats.written++
    report?.()
  }

  const keepIds = snapshot.keepIds || {}
  await reconcile(storage, 'Projets', keepIds.projects || [], stats)
  await reconcile(storage, 'Patrons', keepIds.patterns || [], stats)
  await reconcileYarnPhotos(storage, yarnPhotoNames, stats)

  return stats
}

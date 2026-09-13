// Rowtine — restauration depuis l'arborescence de sauvegarde.
// Inverse de l'orchestrateur de sauvegarde (orchestrator.js) :
// `readBackup` parcourt l'arbo (via une `BackupStorage`) et reconstruit un
// dbSnapshot prêt pour Dexie (ids d'origine préservés) ; `writeSnapshotToDb`
// remplace l'état courant de la base par ce snapshot, dans une transaction.
import { db } from '@/db/db'
import { parseEntryId, displayEntryName } from './naming'
import { YARN_PHOTOS_DIR } from './serialize'
import { normalizeYarnReservations } from '@/utils/yarn-usage'
import { runReprise } from '@/db/purchases-reprise'
import { DEFAULT_CURRENCY } from '@/constants/currencies'
import {
  deserializeProject,
  deserializePattern,
  deserializeYarns as deserializeYarnsRaw,
  deserializeIndependentCounters,
  deserializePurchases,
  deserializeActiveDays,
  deserializeSettings,
} from './deserialize'

// Laines : `deserializeYarnsRaw` (deserialize.js) résout d'abord la photo de chaque laine —
// inline (ancien format, avant le 15/08/2026) OU fichier `laine-photo-*` via `filesByName`
// (nouveau format, cf. serializeYarns) — sans rien migrer côté réservations. C'est ICI, à la
// restauration d'une sauvegarde qui peut dater d'AVANT le passage au pool, qu'on applique EN PLUS
// cette migration-là (mêmes scalaires reservedFor/reservedQty que stores/yarns.js `load()`) :
// une sauvegarde ancienne sur un disque utilisateur doit rester restaurable, convertie à la volée.
// Idempotent : une laine déjà au nouveau format traverse inchangée.
export function deserializeYarns(json, filesByName = {}) {
  return deserializeYarnsRaw(json, filesByName).map((y) => {
    const patch = normalizeYarnReservations(y)
    if (!patch) return y
    const next = { ...y, ...patch }
    delete next.reservedFor
    delete next.reservedQty
    return next
  })
}

// Vrai si une sauvegarde semble présente sur le stockage : dossiers Projets/Patrons
// (créés par `backupAll` même vides — cf. orchestrator.js) ou fichiers racine
// laines.json/reglages.json. Ne garantit pas que la sauvegarde soit non vide, juste
// qu'une arborescence de sauvegarde existe.
export async function hasBackup(storage) {
  if (await storage.exists('Projets')) return true
  if (await storage.exists('Patrons')) return true
  if (await storage.exists('laines.json')) return true
  if (await storage.exists('reglages.json')) return true
  return false
}

// Suffixes des fichiers de travail laissés par une écriture interrompue : `.part`
// (document temporaire du pont natif, publié par renommage) et `.tmp` (écriture
// atomique des fichiers lourds, cf. orchestrator.js). Jamais du contenu de
// sauvegarde — toujours à ignorer à la lecture. `patron-md-sync.js::readAssetFiles`
// applique la MÊME exclusion sur les mêmes dossiers, mais en gardant son propre
// littéral plutôt que d'importer celui-ci :
// tests/unit/saf-ecriture-tranches-bornee.spec.js pin le texte source exact de
// cette regex là-bas comme garde anti-régression — les deux doivent donc rester
// alignées À LA MAIN si l'une des deux change.
const RESIDU_ECRITURE = /\.(part|tmp)$/i

// Construit le `filesByName` (convention documentée dans deserialize.js) d'un
// dossier d'entrée (Projets/<...> ou Patrons/<...>) : tous les fichiers du dossier
// SAUF le JSON principal (`mainJsonName`, fourni séparément déjà parsé par
// l'appelant). Un éventuel `patron.json` imbriqué (instance de patron dans un
// dossier de projet) est lu en UTF8 brut (texte JSON, pas encore parsé — c'est
// `deserializeProject` qui s'en charge) ; tous les autres fichiers (photos,
// original.pdf) sont lus en base64.
//
// `entries` est DÉJÀ lu par l'appelant (UNE readdir par dossier, en tête
// d'itération — le total du dossier doit être connu AVANT la première tranche du
// JSON principal) et `readOne` est la fonction de lecture du dossier, celle qui
// alimente la sous-barre (voir `lecteurDossier` dans readBackup) ; par défaut,
// lecture simple — les dossiers hors progression (Laines/) n'ont pas de sous-barre
// à nourrir.
async function readFolderFiles(storage, dir, mainJsonName, entries, readOne) {
  const read = readOne ?? ((path, encoding) => storage.readFile(path, { encoding }))
  // SANS PROTOTYPE : les clés sont des noms de fichiers lus sur le disque. Sur un objet
  // littéral, `filesByName['__proto__'] = contenu` ne range rien — l'affectation change
  // le prototype et le fichier est perdu EN SILENCE ; en lecture, la même clé rendrait
  // `Object.prototype` pour un fichier qui n'existe pas. `Object.create(null)` ferme les
  // deux sens d'un coup (les lectures de deserialize.js gardent en plus leur `hasOwn`,
  // ce module n'étant pas le seul appelant).
  const filesByName = Object.create(null)
  for (const entry of entries) {
    if (entry.isDir) continue
    if (entry.name === mainJsonName) continue
    // Résidu d'une écriture interrompue (`<nom>.part` côté pont natif, `<nom>.tmp`
    // côté orchestrateur) : `filesByName` est consulté PAR NOM, jamais énuméré —
    // un résidu n'y servirait donc jamais, mais il serait quand même lu
    // INTÉGRALEMENT, tranche par tranche, au moment le plus lent de l'app et sur
    // l'appareil le plus faible. Une photo à moitié écrite, c'est plusieurs Mo lus
    // pour rien.
    if (RESIDU_ECRITURE.test(entry.name)) continue
    if (entry.name === 'patron.json') {
      filesByName[entry.name] = await read(`${dir}/${entry.name}`, 'utf8', entry.name)
    } else {
      filesByName[entry.name] = await read(`${dir}/${entry.name}`, 'base64', entry.name)
    }
  }
  return filesByName
}

// Construit le filesByName (même convention que readFolderFiles) des fichiers RACINE dont
// le nom commence par `prefix` — utilisé pour laine-photo-*, qui vivent à la racine de la
// sauvegarde (laines.json, contrairement à projet.json/patron.json, n'a pas de dossier).
async function readRootFilesByPrefix(storage, prefix) {
  const entries = await storage.readdir('')
  // Sans prototype, même raison que `readFolderFiles` ci-dessus.
  const filesByName = Object.create(null)
  for (const entry of entries) {
    if (entry.isDir) continue
    if (!entry.name.startsWith(prefix)) continue
    if (RESIDU_ECRITURE.test(entry.name)) continue
    filesByName[entry.name] = await storage.readFile(entry.name, { encoding: 'base64' })
  }
  return filesByName
}

// Lit un JSON à la racine du stockage (ex. laines.json), ou renvoie `fallback` si
// le fichier n'existe pas (sauvegarde ancienne/partielle — pas une erreur).
//
// UN FICHIER ILLISIBLE OU MALFORMÉ NE FAIT PLUS ÉCHOUER LA RESTAURATION ENTIÈRE
// (correctif sécurité/disponibilité) : `JSON.parse` sur un `laines.json` tronqué par une
// écriture interrompue levait ici, et les projets, les patrons, les réglages — tout ce
// qui n'a rien à voir avec ce fichier — devenaient irrécupérables. Même patron défensif
// que `syncPatronMd` (patron-md-sync.js), qui enveloppe CHAQUE dossier et consigne dans
// `report.errors` : on retombe sur `fallback` et on consigne l'écart.
//
// CE QUE CE REPLI COÛTE, DIT ICI PLUTÔT QUE DÉCOUVERT PLUS TARD :
//  - `corbeille.json` illisible → aucun id en corbeille → les entrées supprimées mais
//    conservées sur disque REVIENNENT actives. Récupérable d'un geste (les resupprimer) ;
//  - `achats.json` illisible → `[]` alors que `hasPurchasesFile` reste vrai → pas de
//    reprise, budget à zéro. Récupérable aussi (ressaisie), et `ensureReprise` reste
//    disponible. Les deux valent mieux qu'une restauration qui n'aboutit jamais.
async function readRootJson(storage, path, fallback, errors) {
  if (!(await storage.exists(path))) return fallback
  try {
    return JSON.parse(await storage.readFile(path, { encoding: 'utf8' }))
  } catch (err) {
    errors?.push({ where: path, error: err?.message || String(err) })
    return fallback
  }
}

// Validation MINIMALE d'une entité restaurée, appliquée AVANT le `bulkPut`. Le JSON du
// disque est réparti tel quel (`...rest`) dans l'entité : rien ne garantit sa forme, et
// il est éditable à la main. Deux contrôles seulement, ceux dont l'absence casse tout :
//  - objet simple : un `null` dans `laines.json` fait lever le premier écran qui lit
//    `y.brand` ;
//  - `id` ENTIER : un id devenu la chaîne `"3"` (guillemets ajoutés par une édition)
//    n'est plus la même clé Dexie que `3` — tous les liens `patternId`/`projectId` qui
//    le désignent pointent alors dans le vide, en silence et définitivement.
// On ne va pas plus loin : le but est d'éviter le plantage, pas de refuser une structure
// légitime qu'on n'aurait pas prévue.
function isRestorableEntity(row) {
  return !!row && typeof row === 'object' && !Array.isArray(row) && Number.isInteger(row.id)
}

// Code d'écart — un CODE, jamais une phrase. `tests/unit/warnings-no-french.spec.js`
// refuse tout littéral de chaîne derrière un champ « error » dans `src/**` (l'écrire ici
// entre accents graves suffirait à faire échouer sa propre garde) : une phrase en dur ne
// se traduit pas, et ce rapport est destiné à être affiché un jour. Les entrées issues
// d'une exception, elles, portent le `message` natif (une variable, pas un littéral).
const ENTITY_REJECTED = 'entity-rejected'

// Même règle que ENTITY_REJECTED : un CODE, jamais une phrase (garde
// tests/unit/warnings-no-french.spec.js). Un fichier référencé par le JSON restauré
// (photo, image de galerie) mais absent du dossier — effacé à la main, écriture
// interrompue. Le fichier manquant est retiré (jamais remplacé par une image vide qui
// se graverait à la sauvegarde suivante, cf. deserialize.js::photoFromEntry).
const MISSING_ASSET = 'missing-asset'

// Pousse dans `errors` une ligne par fichier manquant consigné dans `missing`
// (rempli par deserializePattern/deserializeProject). Appelé APRÈS chaque
// désérialisation de dossier, `missing` étant partagé (projet + instance de patron).
function reportMissingAssets(missing, dir, errors) {
  for (const file of missing) errors.push({ where: dir, code: MISSING_ASSET, file })
}

// Filtre un tableau d'entités ; chaque ligne écartée est CONSIGNÉE (jamais de perte
// silencieuse — principe cardinal de la synchro MD, repris ici).
function keepEntities(rows, table, errors, where) {
  const kept = []
  for (const row of rows) {
    if (isRestorableEntity(row)) kept.push(row)
    else errors.push({ where, table, code: ENTITY_REJECTED })
  }
  return kept
}

// Parcourt l'arborescence de sauvegarde (Projets/, Patrons/, fichiers racine) et
// reconstruit un dbSnapshot prêt à écrire dans Dexie (ids d'origine préservés).
// `patterns` regroupe les patrons de bibliothèque (dont le/les `builtin`, lus sous
// Patrons/) ET les patrons d'instance (forkés pour un projet, lus dans le dossier de
// ce projet) — `writeSnapshotToDb` les remet tous dans `db.patterns` indifféremment.
// Les dossiers dont l'id figure dans `corbeille.json` sont ignorés (ni lus, ni
// ajoutés au snapshot) : un item supprimé par l'utilisateur (soft-delete) garde son
// dossier sur disque (cf. orchestrator.js) mais ne doit pas ressusciter actif à la
// restauration.
export async function readBackup(storage, { onProgress } = {}) {
  const projects = []
  const patterns = []
  const sections = []
  const counters = []
  const sessions = []
  const diagrams = []
  // Écarts consignés (même forme que `report.errors` de `syncPatronMd`) : un dossier
  // illisible, un JSON malformé, une entité écartée. Remonté dans le snapshot ;
  // `writeSnapshotToDb` n'itère que `REPLACED_TABLES`, cette clé le traverse sans effet.
  const errors = []

  // Index des ids en corbeille (`corbeille.json`, écrit par `backupAll` depuis
  // `snapshot.trashIds`) : leur dossier reste sur disque (réconciliation calée sur
  // `keepIds`, cf. orchestrator.js) mais ne doit PAS être restauré comme entité
  // active — l'utilisateur l'a supprimé, il ne doit pas ressusciter. Sauvegarde sans
  // ce fichier (ancienne, pré-fix) → ensembles vides, comportement inchangé.
  const corbeille = await readRootJson(storage, 'corbeille.json', { projects: [], patterns: [] }, errors)
  const trashedIds = {
    projects: new Set(Array.isArray(corbeille?.projects) ? corbeille.projects : []),
    patterns: new Set(Array.isArray(corbeille?.patterns) ? corbeille.patterns : []),
  }

  // Progression. Les entrées en corbeille sont écartées
  // AVANT le comptage : autrefois filtrées dans la boucle, elles auraient gonflé
  // `total` sans jamais faire avancer `done` — la barre se serait arrêtée avant la
  // fin sur toute sauvegarde contenant un élément supprimé.
  const projectEntries = (await storage.exists('Projets'))
    ? (await storage.readdir('Projets')).filter(
        (e) => e.isDir && !trashedIds.projects.has(parseEntryId(e.name)),
      )
    : []
  const patternEntries = (await storage.exists('Patrons'))
    ? (await storage.readdir('Patrons')).filter(
        (e) => e.isDir && !trashedIds.patterns.has(parseEntryId(e.name)),
      )
    : []
  const total = projectEntries.length + patternEntries.length
  let done = 0
  // `current` : nom lisible du dossier EN COURS de lecture (le suffixe « [id] » est un
  // détail de stockage — cf. displayEntryName). Le report initial porte une chaîne vide
  // (rien n'est encore lu) ; le `finally` de chaque dossier ré-émet SANS argument →
  // `current: undefined` → le reporter de progress.js GARDE le libellé précédent
  // (sémantique `??` des autres champs) pendant que le dossier se termine.
  // `sub` partage le même canal : absent → on garde, null → on tue la
  // sous-barre, objet → on la remplace.
  const report = onProgress
    ? (current, sub) => onProgress({ phase: 'read', done, total, current, sub })
    : null
  report?.('')

  // Sous-barre du dossier EN COURS (retour d'usage sur marisol-shawl : ~8 Mo
  // figés 10-25 s, « j'ai cru qu'il avait planté »). Le nom du dossier seul ne suffit
  // pas : entre deux avancées de la barre principale, il faut du MOUVEMENT — chaque
  // tranche réussie de chaque fichier du dossier ré-émet la progression avec
  // `sub {file, done, total}` : le fichier nommé, le cumul d'OCTETS DU DOSSIER, le
  // total du dossier.
  //
  // Préparé à partir des entries DÉJÀ lus du dossier (UNE readdir par itération, AVANT
  // le JSON principal : c'est lui la majorité des octets — patron.json d'un dossier
  // marisol —, la sous-barre doit vivre dès sa première tranche, pas après les
  // petites pièces). total = Σ des tailles CONNUES des fichiers qui seront lus :
  // le JSON principal EST inclus (il fait partie des entries), les résidus
  // d'écriture exclus (ils ne sont jamais lus). Taille inconnue → total 0 → sub:null
  // ÉMIS EXPLICITEMENT, pour tuer la sous-barre héritée du dossier précédent :
  // DocumentFile.length() rend 0 chez certains fournisseurs SAF — on se MASQUE, on
  // n'invente jamais une progression sur des tailles absentes. L'appelant sans
  // onProgress (sauvegarde de fond) ne paie rien : lecture simple.
  const lecteurDossier = (entries) => {
    if (!onProgress) return (path, encoding) => storage.readFile(path, { encoding })
    const subTotal = entries
      .filter((e) => !e.isDir && !RESIDU_ECRITURE.test(e.name))
      .reduce((somme, e) => somme + (e.size > 0 ? e.size : 0), 0)
    if (subTotal <= 0) {
      report?.(undefined, null)
      return (path, encoding) => storage.readFile(path, { encoding })
    }
    let dejaLus = 0
    return async (path, encoding, file) => {
      const socle = dejaLus
      let cumul = 0
      const contenu = await storage.readFile(path, {
        encoding,
        onChunk: (n) => {
          cumul = n
          report?.(undefined, { file, done: socle + n, total: subTotal })
        },
      })
      dejaLus = socle + cumul
      return contenu
    }
  }

  // UN DOSSIER ABÎMÉ N'EMPORTE PLUS LES AUTRES (correctif sécurité/disponibilité). Ces
  // deux boucles enchaînaient `readFile` + `JSON.parse` + désérialisation sans aucun
  // filet : un seul sous-dossier créé à la main, un `projet.json` tronqué par une
  // écriture interrompue, un item de galerie sans `src` ni `name` — et TOUTE la
  // restauration échouait, sur un chemin qui n'a par ailleurs aucune autre porte de
  // sortie que le bouton destructeur « Repartir de zéro ». Même patron défensif que
  // `syncPatronMd` (patron-md-sync.js) : chaque dossier dans son propre `try`/`catch`,
  // l'écart consigné dans `errors`, et on continue avec le suivant. `done++`/`report?.()`
  // restent DANS le `finally` — sinon la barre de progression s'arrêterait avant la fin
  // dès qu'un dossier est écarté (le défaut déjà corrigé pour la corbeille, plus haut).
  for (const entry of projectEntries) {
    const dir = `Projets/${entry.name}`
    // Annoncé AVANT le try, avec sub:null EXPLICITE : sans lui, le reporter garderait
    // la sous-barre (PLEINE) du dossier PRÉCÉDENT sous le nom du nouveau pendant le
    // readdir et la première tranche (~1-3 s, avec le nom de l'ANCIEN fichier dans le
    // libellé) — un dossier qui commence repart à zéro, toujours. (Le `finally` ne
    // ré-émet qu'à la fin, sans current ni sub.)
    report?.(displayEntryName(entry.name), null)
    try {
      // UNE readdir du dossier, AVANT le JSON principal (cf. lecteurDossier) : le
      // total du dossier en découpe et la sous-barre vit dès la première tranche du
      // gros fichier. Même comptage d'appels qu'avant ce changement : readFolderFiles ne
      // fait plus le sien, il reçoit ces entries.
      const entries = await storage.readdir(dir)
      const lire = lecteurDossier(entries)
      const projetJson = JSON.parse(await lire(`${dir}/projet.json`, 'utf8', 'projet.json'))
      const filesByName = await readFolderFiles(storage, dir, 'projet.json', entries, lire)
      const missing = []
      const restored = deserializeProject(projetJson, filesByName, missing)
      reportMissingAssets(missing, dir, errors)

      // Le projet lui-même est écarté EN ENTIER s'il ne passe pas la validation : sans
      // id entier, ses sections/compteurs/sessions pointeraient vers un projet qui
      // n'existe pas — mieux vaut un projet manquant, visible, que des orphelins.
      if (!isRestorableEntity(restored.project)) {
        errors.push({ where: dir, table: 'projects', code: ENTITY_REJECTED })
        continue
      }
      projects.push(restored.project)
      sections.push(...keepEntities(restored.sections, 'sections', errors, dir))
      counters.push(...keepEntities(restored.counters, 'counters', errors, dir))
      sessions.push(...keepEntities(restored.sessions, 'sessions', errors, dir))
      diagrams.push(...keepEntities(restored.diagrams, 'diagrams', errors, dir))
      if (restored.instancePattern) {
        patterns.push(...keepEntities([restored.instancePattern], 'patterns', errors, dir))
      }
    } catch (err) {
      errors.push({ where: dir, error: err?.message || String(err) })
    } finally {
      done++
      report?.()
    }
  }

  for (const entry of patternEntries) {
    const dir = `Patrons/${entry.name}`
    // Même annonce que la boucle projets : nom + sub:null AVANT le try (cf.
    // commentaire plus haut), readdir unique EN TÊTE de try, lectures via le lecteur
    // à sous-barre.
    report?.(displayEntryName(entry.name), null)
    try {
      const entries = await storage.readdir(dir)
      const lire = lecteurDossier(entries)
      const patronJson = JSON.parse(await lire(`${dir}/patron.json`, 'utf8', 'patron.json'))
      const filesByName = await readFolderFiles(storage, dir, 'patron.json', entries, lire)
      const missing = []
      patterns.push(...keepEntities([deserializePattern(patronJson, filesByName, missing)], 'patterns', errors, dir))
      reportMissingAssets(missing, dir, errors)
    } catch (err) {
      errors.push({ where: dir, error: err?.message || String(err) })
    } finally {
      done++
      report?.()
    }
  }

  // Les photos de laine vivent sous `Laines/` depuis le 21/08/2026, et vivaient à la
  // RACINE avant. On lit les deux et on les fusionne — indexées par NOM dans les deux cas,
  // puisque laines.json n'a jamais porté que le nom.
  // ⚠️ La lecture de la racine n'est PAS provisoire : une sauvegarde oubliée sur un
  // support ancien restaurerait sinon des laines sans leurs photos, EN SILENCE. Le nouvel
  // endroit gagne en cas de collision de nom (même nom = même contenu, le hash le garantit).
  // `Object.assign(Object.create(null), …)` et NON `{ ...a, ...b }` : répandre dans un
  // objet littéral rendrait un prototype à la fusion, réouvrant exactement le trou que
  // `readFolderFiles`/`readRootFilesByPrefix` viennent de fermer.
  // Le dossier `Laines/` peut ne pas exister (sauvegarde d'avant le 21/08/2026) — sa
  // lecture ne doit pas faire échouer le reste.
  const yarnPhotoFiles = Object.assign(
    Object.create(null),
    await readRootFilesByPrefix(storage, 'laine-photo-'),
  )
  try {
    // readdir passé au site d'appel (readFolderFiles n'en fait plus lui-même) ;
    // pas de `lecteurDossier` ici — les photos de laine sont hors progression dossier
    // par dossier (elles ne comptent dans aucun `total`), lecture simple.
    Object.assign(
      yarnPhotoFiles,
      await readFolderFiles(
        storage,
        YARN_PHOTOS_DIR,
        null,
        await storage.readdir(YARN_PHOTOS_DIR),
      ),
    )
  } catch (err) {
    errors.push({ where: YARN_PHOTOS_DIR, error: err?.message || String(err) })
  }
  const yarns = keepEntities(
    deserializeYarns(await readRootJson(storage, 'laines.json', [], errors), yarnPhotoFiles),
    'yarns',
    errors,
    'laines.json',
  )
  const independentCounters = keepEntities(
    deserializeIndependentCounters(await readRootJson(storage, 'compteurs.json', [], errors)),
    'counters',
    errors,
    'compteurs.json',
  )
  const settings = deserializeSettings(await readRootJson(storage, 'reglages.json', {}, errors))
  // `readRootJson` rend le repli quand le fichier n'existe pas — on veut savoir LEQUEL
  // des deux cas s'est produit : une sauvegarde d'avant l'ajout des achats (pas de fichier) doit
  // faire reconstruire l'historique (cf. `writeSnapshotToDb`), une sauvegarde vide
  // (fichier présent, tableau vide) non — l'utilisateur a le droit d'avoir zéro achat.
  const hasPurchasesFile = await storage.exists('achats.json')
  const purchases = keepEntities(
    deserializePurchases(await readRootJson(storage, 'achats.json', [], errors)),
    'purchases',
    errors,
    'achats.json',
  )

  // Journal des jours actifs (lot 2). ⛔ PAS de drapeau « fichier présent ? » à la manière de
  // `hasPurchasesFile` : celui-là ne sert qu'à déclencher `runReprise`, une RECONSTRUCTION. Ici
  // il n'y a rien à reconstruire — l'information n'existe nulle part ailleurs qu'ici. Fichier
  // absent (sauvegarde d'avant l'ajout de ce journal) → `[]` → table vidée → la série retombe sur les seules
  // sessions. Dégradation propre, jamais une erreur.
  // ⛔ PAS de `keepEntities` ici : `activeDays` est clé par `day` (chaîne), pas par un
  // `id` entier — le même filtre y écarterait TOUTES les lignes. Même remarque pour
  // `settings`, clé par `key`.
  const activeDays = deserializeActiveDays(await readRootJson(storage, 'jours-actifs.json', [], errors))

  return {
    // Le canal d'écarts n'apparaît QUE s'il a quelque chose à dire : sur le chemin
    // nominal (le cas de très loin le plus fréquent), le snapshot garde exactement la
    // forme qu'il avait avant ce correctif. Les appelants lisent `snapshot.errors || []`.
    ...(errors.length ? { errors } : {}),
    projects,
    patterns,
    sections,
    counters: [...counters, ...independentCounters],
    sessions,
    diagrams,
    yarns,
    purchases,
    activeDays,
    hasPurchasesFile,
    settings,
  }
}

// Tables de données remplacées telles quelles par le contenu du dbSnapshot
// (contrairement à `settings`, fusionnée — cf. plus bas). `purchases` DOIT y être :
// sans ça, une restauration AJOUTERAIT les achats du snapshot à ceux déjà en base
// au lieu de les remplacer (budget doublé).
// `activeDays` (journal des jours actifs, lot 2) DOIT y être : restaurer, c'est remettre
// l'appareil dans l'état de la sauvegarde. Un `bulkPut` sans `clear()` préalable laisserait en
// place des jours qui n'appartiennent pas à l'état restauré — la série mentirait dans l'autre
// sens. La clé primaire étant le jour, le `bulkPut` lui-même ne peut créer aucun doublon.
const REPLACED_TABLES = ['projects', 'patterns', 'sections', 'diagrams', 'counters', 'sessions', 'yarns', 'purchases', 'activeDays']

// Remplace l'état courant de la base par `dbSnapshot`, dans une transaction :
// chaque table est vidée puis repeuplée (`bulkPut`, ids d'origine préservés).
// `trash` (corbeille) est vidée — elle n'est pas sauvegardée (cf. plan). `settings`
// n'est PAS simplement remplacée : on part des réglages courants et on les
// surcharge avec ceux du snapshot, pour préserver les clés exclues de la
// sauvegarde (secrets tiers, session active — cf. EXCLUDED_SETTINGS_KEYS dans
// serialize.js) plutôt que de les perdre silencieusement à la restauration.
export async function writeSnapshotToDb(dbSnapshot) {
  await db.transaction(
    'rw',
    [
      db.projects,
      db.patterns,
      db.sections,
      db.diagrams,
      db.counters,
      db.sessions,
      db.yarns,
      db.purchases,
      db.activeDays,
      db.settings,
      db.trash,
    ],
    async () => {
      for (const table of REPLACED_TABLES) {
        await db[table].clear()
        const rows = dbSnapshot[table]
        if (rows && rows.length) await db[table].bulkPut(rows)
      }

      const currentSettings = await db.settings.toArray()
      const restoredKeys = new Set((dbSnapshot.settings || []).map((s) => s.key))
      const preserved = currentSettings.filter((s) => !restoredKeys.has(s.key))
      const mergedSettings = [...(dbSnapshot.settings || []), ...preserved]
      await db.settings.clear()
      if (mergedSettings.length) await db.settings.bulkPut(mergedSettings)

      await db.trash.clear()
    },
  )

  // Reprise de l'historique d'achat (`purchases-reprise.js`) — DÉCLENCHÉE
  // ICI, sur `hasPurchasesFile`, PAS sur le drapeau `settings` (`ensureReprise`
  // serait le mauvais choix) : ce drapeau vit dans la table `settings`, qui est
  // FUSIONNÉE et non remplacée ci-dessus — il peut donc être déjà posé sur une
  // base qui restaure une sauvegarde ANCIENNE (d'avant ce lot, sans achats.json).
  // `ensureReprise` ne ferait alors rien : l'utilisatrice retrouverait un stock
  // rempli et un budget à zéro. `runReprise` force la reconstruction à chaque
  // fois qu'une sauvegarde sans achats.json est restaurée ; il reste sans danger
  // à rejouer car il saute lui-même les laines qui ont déjà une ligne (2e garde,
  // cf. purchases-reprise.js).
  // Fichier présent (même vide) → l'utilisatrice a le droit d'avoir zéro achat,
  // on ne reconstruit rien. Aucune laine restaurée → rien à reconstruire non plus.
  if (dbSnapshot.hasPurchasesFile === false && dbSnapshot.yarns?.length) {
    const currency = dbSnapshot.settings?.find((s) => s.key === 'currency')?.value ?? DEFAULT_CURRENCY
    try {
      await runReprise(currency)
    } catch {
      // La transaction ci-dessus a DÉJÀ committé (correctif de revue) :
      // projets/patrons/laines/réglages de l'utilisatrice sont restaurés, quoi qu'il
      // arrive à la reprise du budget. Faire échouer TOUTE la restauration pour un
      // souci sur `runReprise` serait pire que le problème que cette reprise règle
      // (avant ce lot, `writeSnapshotToDb` était intégralement atomique — un rollback
      // sur exception était vrai ; ce n'est plus le cas UNIQUEMENT pour ce bout hors
      // transaction, volontairement, pour ne pas perdre le reste). Rattrapage sûr et
      // déjà en place : `runReprise` ne pose `REPRISE_FLAG` (settings) qu'À LA FIN,
      // une fois toutes les laines traitées (cf. purchases-reprise.js) — s'il lève en
      // cours de route, le drapeau reste absent, et l'`ensureReprise` du prochain
      // lancement (App.vue, onMounted) reconstruira alors ce qui n'a pas pu l'être ici.
    }
  }
}

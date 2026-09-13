// Rowtine — orchestration de la synchro MD→DB. Impur : scanne
// l'arborescence de sauvegarde, compare le hash du `patron.md` de chaque dossier au
// témoin `patron.json.patronMd.hash`, reparse et fusionne les
// dossiers édités en externe. S'appuie exclusivement sur les primitives PURES
// (`reconcileReaderState`, `resolveReaderAssets`, `mergePatternFromMd` +
// `isMdSafeToMerge`) : ce module ne fait QUE l'IO et l'aiguillage, aucune règle de
// fusion/réconciliation n'est décidée ici.
//
// Chemin rapide : l'entité patron porte un témoin DB `patronMdSyncHash`
// (« hash du dernier patron.md auquel CETTE base est alignée »). Quand il égalé déjà
// le hash du `patron.md` sur disque, le dossier est conclu SANS relire `patron.json`
// (le gros fichier : images inline en data URLs). Ce témoin n'est qu'une
// optimisation CONSERVATRICE : `patron.json` reste l'autorité sur disque
// (`hasPendingExternalMdEdit` n'est pas touché), il est posé APRÈS le témoin
// disque (jamais dans la transaction de fusion), et au moindre doute on retombe
// sur le chemin lourd ci-dessous.
//
// Principe cardinal : jamais de perte silencieuse. Un dossier cassé,
// un MD illisible/tronqué ou une entité DB introuvable ne doivent jamais interrompre
// la synchro des autres dossiers ni écraser silencieusement l'état interne — chaque
// écart est consigné dans le rapport renvoyé par `syncPatronMd`.
import { hash8, parseEntryId } from './naming'
import { mdToPattern } from '@/utils/pattern-md'
import { W, WARNING_CODES, isStructuredWarning } from '@/utils/pattern-md/warning-codes'
import { resolveReaderAssets } from './resolve-reader-assets'
import { capReaderAssets } from './cap-reader-assets'
import { reconcileReaderState } from './reconcile-reader-state'
import { mergePatternFromMd, isMdSafeToMerge, chartRepeatLabelsLost } from './merge-pattern-md'
import { suppressAutoBackup } from './auto-backup'
import { isAutoBackupRunning } from './backup-service'
import { isImportRunning } from './import-guard'
import { isRestoreRunning, isRestoreDecisionPending, isFolderCleanSinceRestore } from './restore-guard'

// Drapeau in-progress module-level : empêche deux synchros concurrentes de courir
// sur le même dossier (entrelacement possible avec la sauvegarde-pause). Une 2ᵉ
// invocation pendant qu'une première tourne renvoie immédiatement, sans scanner.
let running = false

export function isSyncRunning() {
  return running
}

// Promesse du passage en cours :
// contrairement au drapeau `running` (qui fait échouer une 2ᵉ invocation par
// { skipped:'running' }), `inflight` permet à un appelant d'ATTENDRE la fin du
// passage en cours plutôt que d'être simplement éconduit — c'est le besoin de
// `syncPatronMdOnOpen` (sync-on-open.js) : à l'ouverture d'un patron, si une
// synchro complète est déjà en train de tourner, elle a peut-être déjà fusionné
// CE dossier ; autant attendre son terme que de renvoyer un rapport vide et
// afficher un contenu qui vient d'être dépassé.
let inflight = null

// whenSyncIdle() → Promise qui se résout dès qu'aucune synchro n'est en cours (ou
// immédiatement si aucune ne tourne). NE REJETTE JAMAIS : un échec du passage en
// cours n'est pas l'affaire de l'appelant, qui veut juste savoir « le champ est
// libre » ; un éventuel rapport d'erreur reste porté par le retour de la synchro
// elle-même (remonté au store par son propre appelant).
export function whenSyncIdle() {
  return inflight ? inflight.catch(() => {}) : Promise.resolve()
}

// Ce module importe `isAutoBackupRunning` de backup-service.js de façon
// statique (ci-dessous). Correctif revue finale (Important) : backup-service.js
// importe désormais aussi CE module (dynamiquement, dans `runBackup`, pour
// poser la même garde d'exclusion mutuelle côté appel direct) — un import
// STATIQUE symétrique refermerait le cycle dès l'évaluation des modules ; côté
// backup-service.js, c'est donc un `await import('./patron-md-sync')`
// paresseux (même stratégie que `callRunBackup` dans auto-backup.js).

// Rapport de réconciliation à zéro (même forme que `reconcileReaderState`), utilisé
// comme neutre d'agrégation (patron de bibliothèque sans aucun projet lié : la
// fusion a bien lieu mais il n'y a rien à réconcilier).
// EXPORTÉ : CorrectionView.onSave a besoin du MÊME neutre pour son
// propre fan-out de réconciliation (mi-projet) — évite une 2ᵉ copie qui pourrait
// dériver de celle-ci si la forme du rapport change.
export function emptyReconcileReport() {
  return {
    doneKept: 0,
    doneLost: 0,
    countersKept: 0,
    countersLost: 0,
    sizeReset: false,
    // Pertes d'état par grille (remplacent l'ancien booléen `chartRowReset`, mort depuis
    // que la réconciliation transfère les maps chartRows/chartReps/chartFrames/chartCurtains).
    chartRowsLost: 0,
    chartRepsLost: 0,
    chartFramesLost: 0,
    chartCurtainsLost: 0,
  }
}

// Agrège plusieurs rapports de réconciliation (fan-out vers N projets liés à un même
// patron de bibliothèque) : compteurs sommés (dont les pertes d'état par grille), et le
// seul booléen restant `sizeReset` en OU (un projet ayant perdu sa taille suffit à le signaler).
// EXPORTÉ : partagé avec CorrectionView.onSave (même besoin d'agrégation
// pour son propre fan-out mi-projet) — une seule implémentation, pas de copie fidèle
// susceptible de diverger silencieusement.
export function aggregateReconcileReports(list) {
  return (list || []).reduce(
    (acc, r) => ({
      doneKept: acc.doneKept + (r?.doneKept || 0),
      doneLost: acc.doneLost + (r?.doneLost || 0),
      countersKept: acc.countersKept + (r?.countersKept || 0),
      countersLost: acc.countersLost + (r?.countersLost || 0),
      sizeReset: acc.sizeReset || !!r?.sizeReset,
      // Pertes d'état par grille sommées (comme doneLost/countersLost) : un fan-out où
      // plusieurs projets perdent leur suivi de grille doit refléter le total.
      chartRowsLost: acc.chartRowsLost + (r?.chartRowsLost || 0),
      chartRepsLost: acc.chartRepsLost + (r?.chartRepsLost || 0),
      chartFramesLost: acc.chartFramesLost + (r?.chartFramesLost || 0),
      chartCurtainsLost: acc.chartCurtainsLost + (r?.chartCurtainsLost || 0),
    }),
    emptyReconcileReport(),
  )
}

// Fichiers d'assets d'un dossier d'entrée : tout ce qui n'est ni un .json ni un .md
// (donc ni `patron.json`/`patron.md`, ni un éventuel `projet.json` voisin) — lus en
// base64, prêts pour `resolveReaderAssets`.
async function readAssetFiles(storage, dir) {
  const entries = await storage.readdir(dir)
  // SANS PROTOTYPE : les clés sont des noms de fichiers lus sur le disque. Sur un objet
  // littéral, un fichier nommé `__proto__` verrait son contenu perdu en silence
  // (l'affectation change le prototype au lieu de ranger la valeur), et une lecture de
  // cette même clé rendrait `Object.prototype` pour un fichier inexistant. Même geste
  // que `readFolderFiles` (restore.js), sur la même arborescence.
  const filesByName = Object.create(null)
  for (const entry of entries) {
    if (entry.isDir) continue
    if (/\.(json|md)$/i.test(entry.name)) continue
    // Résidu d'une écriture interrompue (`<nom>.part` du pont natif, `<nom>.tmp` de
    // l'orchestrateur) : `patron.md.part` ne se termine ni par `.json` ni par `.md`,
    // il atterrissait donc dans les assets du lecteur. Même trou que celui que
    // restore.js referme, sur le fichier d'à côté — et l'atomicité désormais
    // universelle le rend atteignable pour TOUT fichier, plus seulement les lourds.
    // Regex tenue IDENTIQUE à RESIDU_ECRITURE (restore.js) à la main : gardée en
    // littéral ici (pas d'import partagé) parce que
    // tests/unit/saf-ecriture-tranches-bornee.spec.js pin le texte source exact de
    // cette ligne comme garde anti-régression — un import y casserait l'assertion
    // sans rien changer au comportement.
    if (/\.(part|tmp)$/i.test(entry.name)) continue
    filesByName[entry.name] = await storage.readFile(`${dir}/${entry.name}`, { encoding: 'base64' })
  }
  return filesByName
}

// Résout l'entité live correspondant à un dossier `Patrons/*` : le patron de
// bibliothèque lui-même. `forkProjectId` reste `null` (pas d'instance de projet
// unique concernée — une éventuelle réconciliation se fait en fan-out vers TOUS
// les projets liés, cf. plus bas).
async function resolveLibraryPatternEntity(db, folderName) {
  const id = parseEntryId(folderName)
  const live = id != null ? await db.patterns.get(id) : null
  // Décision du 01/09 : motif de saut en CODE structuré (jamais une phrase figée) — la
  // traduction se fait à l'affichage (warningText, SyncReportDialog), dans la langue
  // courante. Le rapport de synchro n'est pas persisté : aucun format de fichier concerné.
  if (!live) return { error: W(WARNING_CODES.SYNC_ORPHAN_FOLDER) }
  return { live, forkProjectId: null }
}

// Résout l'entité live correspondant à un dossier `Projets/*` : le patron FORKÉ
// (instancePattern) de ce projet — celui dont le `patron.md` vit dans ce même
// dossier. Un projet non forké (patron de bibliothèque partagé, pas de copie
// dédiée) n'a pas de `patron.md` dans son propre dossier ; s'il en traîne un
// (résidu), on ne fusionne pas dessus : ce n'est l'instance de personne.
async function resolveProjectForkEntity(db, folderName) {
  const projectId = parseEntryId(folderName)
  const project = projectId != null ? await db.projects.get(projectId) : null
  if (!project || project.patternId == null) {
    return { error: W(WARNING_CODES.SYNC_PROJECT_WITHOUT_PATTERN) }
  }
  const pat = await db.patterns.get(project.patternId)
  if (!pat || pat.ownerProjectId !== projectId) {
    return { error: W(WARNING_CODES.SYNC_NO_FORKED_PATTERN) }
  }
  return { live: pat, forkProjectId: projectId, project }
}

// IndexedDB ne sait pas cloner un objet réactif (proxy) — jamais le cas ici (tout
// est pur/JS-plain jusqu'à ce point) mais on l'applique par cohérence avec
// `patternsStore.update`/`projectsStore.update`, dont on reproduit ici l'essentiel
// (cf. tête de fichier — écritures DB atomiques).
function plain(o) {
  return JSON.parse(JSON.stringify(o))
}

// Réconcilie la progression AVANT d'écraser le reader (l'ancien reader du live sert
// de référence). Cas forké : un seul projet concerné. Cas bibliothèque : fan-out
// vers tous les projets `patternId === live.id` qui ne sont PAS leur propre fork
// (un patron de bibliothèque, par construction, n'est le fork d'aucun projet — donc
// tous les projets qui le pointent sont des projets liés/partagés).
//
// PUREMENT calculatoire : ne touche PAS la DB. Renvoie les rapports de
// réconciliation ET les patches `{ projectId, readerState }` à appliquer — c'est
// l'appelant (`processFolder`) qui les exécutera, dans la MÊME transaction que
// l'écriture du patron fusionné (cf. commentaire de tête de fichier, atomicité).
async function reconcileProgress({ db }, live, resolvedReader, forkProjectId, project) {
  if (forkProjectId != null) {
    const oldState = project.readerState || {}
    const { state, report } = reconcileReaderState(live.reader, oldState, resolvedReader)
    return { reports: [report], projectPatches: [{ projectId: forkProjectId, readerState: state }] }
  }
  const linked = await db.projects.filter((p) => p.patternId === live.id).toArray()
  const reports = []
  const projectPatches = []
  for (const p of linked) {
    const oldState = p.readerState || {}
    const { state, report } = reconcileReaderState(live.reader, oldState, resolvedReader)
    reports.push(report)
    projectPatches.push({ projectId: p.id, readerState: state })
  }
  return { reports, projectPatches }
}

// Traite un dossier candidat (`Projets/<slug> [id]` ou `Patrons/<slug> [id]`) déjà
// vérifié comme contenant `patron.md` ET `patron.json`. Pousse le résultat dans
// `report` (`merged`/`skipped`) ; ne lève jamais (l'appelant capture les erreurs
// restantes dossier par dossier).
async function processFolder(storage, dir, folderName, kind, deps, report) {
  const mdPath = `${dir}/patron.md`
  const jsonPath = `${dir}/patron.json`

  const mdText = await storage.readFile(mdPath, { encoding: 'utf8' })
  const current = hash8(mdText)

  // Résolution de l'entité AVANT toute lecture de patron.json : le témoin
  // DB `patronMdSyncHash` vit sur l'entité, le chemin rapide en a besoin. Coût d'un
  // dossier : une lecture Dexie LOCALE, sans rapport avec l'IO SAF du gros fichier.
  // L'erreur de résolution n'est PAS consignée ici (elle ne le serait qu'après la
  // constatation d'une divergence réelle, plus bas) — un dossier propre ou orphelin
  // au témoin à jour ne doit pas changer de catégorie de rapport.
  const resolved =
    kind === 'pattern'
      ? await resolveLibraryPatternEntity(deps.db, folderName)
      : await resolveProjectForkEntity(deps.db, folderName)

  // Chemin rapide : témoin DB == hash du md sur disque → cette base est
  // DÉJÀ alignée sur ce fichier, retour immédiat sans relire patron.json (lecture
  // multi-mégaoctets économisée par dossier propre, à chaque passage). Le témoin DB
  // n'est posé qu'APRÈS une écriture disque confirmée (cf. bas de fonction), donc
  // son égalité garantit que la fusion correspondante a bien eu lieu — pas de saut
  // risqué, et toujours aucun critère de mtime/taille.
  if (resolved.live && resolved.live.patronMdSyncHash === current) return

  // Chemin lourd (inchangé) : patron.json reste l'autorité sur disque.
  const patronJson = JSON.parse(await storage.readFile(jsonPath, { encoding: 'utf8' }))
  const witness = patronJson.patronMd?.hash
  if (current === witness) {
    // Guérison : le témoin disque est à jour mais le témoin DB est absent
    // (vieilles sauvegardes, restauration/import antérieurs) ou périmé (édition
    // locale suivie d'une sauvegarde qui a réaligné le disque) — on le (re)pose
    // pour retrouver le chemin rapide au prochain passage. Coût de la guérison :
    // UNE lecture lourde, une fois. Écriture unique sous `suppressAutoBackup`
    // (même geste que la fusion ci-dessous) : sinon le hook Dexie armerait une
    // sauvegarde débouncée inutile ; jamais dans une transaction de fusion.
    if (resolved.live && resolved.live.patronMdSyncHash !== current) {
      await suppressAutoBackup(async () => {
        await deps.db.patterns.update(resolved.live.id, { patronMdSyncHash: current })
      })
    }
    return // inchangé depuis la dernière synchro : rien à faire.
  }

  if (resolved.error) {
    report.skipped.push({ folder: dir, kind, reason: resolved.error })
    return
  }
  const { live, forkProjectId, project } = resolved

  const { pattern: mdPattern, warnings } = mdToPattern(mdText)

  const safety = isMdSafeToMerge(mdPattern, live, warnings)
  if (!safety.safe) {
    // Garde de dégénérescence : on garde l'interne, on NE touche PAS au témoin (la
    // prochaine synchro retentera tant que le MD n'est pas corrigé), et on avertit.
    report.skipped.push({
      folder: dir,
      kind,
      id: live.id,
      name: live.name,
      reason: safety.reason,
      warnings,
    })
    return
  }

  // Décision du 01/09 — perte du libellé `chart.repeat` : la fusion ci-dessous remplace le
  // reader ENTIER par celui du MD, qui ne peut pas porter ce libellé (format Rowtine-MD,
  // cf. merge-pattern-md.js). Poussé APRÈS la garde : si le dossier vient d'être sauté,
  // l'interne est conservé et rien n'est perdu — pas d'avertissement. L'avertissement
  // voyage dans le tableau `warnings` existant (rapport.merged[].warnings), déjà traduit
  // à l'affichage par warningText.
  if (chartRepeatLabelsLost(live) > 0) {
    warnings.push(W(WARNING_CODES.CHART_REPEAT_LABEL_LOST))
  }

  const filesByName = await readAssetFiles(storage, dir)
  const { entity: resolvedMdRaw, missing } = resolveReaderAssets(mdPattern, filesByName)
  // 4ᵉ porte d'entrée d'images (intent `quatrieme-porte-images-sans-plafond`) : cette
  // synchro injectait jusqu'ici une image déposée à la main dans le dossier de
  // sauvegarde SANS le plafond des 3 autres portes (galerie, PDF, kit .zip). Ne
  // plafonne QUE ce qui dépasse réellement dimensions ou poids (cf. capReaderAssets) —
  // jamais une image déjà conforme, pour ne pas la dégrader à chaque édition du MD.
  const resolvedMd = await capReaderAssets(resolvedMdRaw)

  // Réconciliation de la progression AVANT d'écraser le reader (elle a besoin de
  // l'ANCIEN reader du live comme référence de contenu) — calcul PUR, aucune
  // écriture DB à ce stade (cf. `reconcileProgress` et tête de fichier).
  const { reports: reconcileReports, projectPatches } = await reconcileProgress(
    deps,
    live,
    resolvedMd.reader,
    forkProjectId,
    project,
  )
  const merged = mergePatternFromMd(live, resolvedMd)
  const plainMerged = plain(merged)

  // Écriture DB ATOMIQUE (correctif revue — cardinal « jamais de fausse coche ») :
  // les readerStates rebasés (fan-out) et le patron fusionné sont écrits dans UNE
  // seule transaction Dexie. Si l'écriture du patron échoue après un ou plusieurs
  // readerStates déjà posés, Dexie annule TOUT (rollback réel en production) — on
  // ne se retrouve donc jamais avec un `project.readerState` rebasé sur le NOUVEAU
  // reader pendant que `live.reader` (en base) est encore l'ANCIEN : c'est
  // exactement l'appariement incohérent qui pouvait placer une coche sur le
  // mauvais step au prochain passage (le témoin n'ayant pas bougé, le même MD
  // re-déclenche un `reconcileReaderState(oldReader=live.reader, ...)` faussé).
  //
  // Anti-régénération : cette écriture (et le refresh de
  // stores qui suit) tourne sous `suppressAutoBackup` — sans quoi le hook
  // Dexie armerait une sauvegarde débouncée qui, une fois déclenchée,
  // régénère `patron.md` depuis la DB et écraserait l'édition manuelle que
  // cette fusion vient précisément de préserver/intégrer.
  await suppressAutoBackup(async () => {
    await deps.db.transaction('rw', deps.db.projects, deps.db.patterns, async () => {
      for (const { projectId, readerState } of projectPatches) {
        await deps.db.projects.update(projectId, { readerState, updatedAt: new Date().toISOString() })
      }
      await deps.db.patterns.update(live.id, plainMerged)
    })

    // Recharge les stores Pinia réactifs APRÈS le commit (mirroring `runRestore` /
    // `reloadStores` dans restore-service.js) : la transaction ci-dessus a déjà
    // persisté les données, il ne reste qu'à faire relire les stores pour que l'UI
    // reflète immédiatement le nouvel état.
    await Promise.all([deps.patternsStore.load(), deps.projectsStore.load()])
  })

  // Témoin mis à jour SEULEMENT APRÈS un commit réussi (et le refresh des stores) —
  // on ne réémet jamais `patron.md` lui-même (cela écraserait l'édition manuelle
  // par une régénération). Si la transaction ci-dessus lève, on n'atteint jamais
  // cette ligne : l'erreur remonte au try/catch de l'appelant (`report.errors`), le
  // témoin reste inchangé, et Dexie a annulé tous les écrits partiels — le prochain
  // passage retentera le même merge depuis un état interne intact. Cas résiduel
  // bénin (non couvert par le fake de test) : la transaction
  // commite mais CETTE écriture du témoin échoue ensuite → au prochain passage,
  // `live.reader` vaut déjà celui du MD, donc la réconciliation est quasi-identité
  // (rien à perdre, pas de fausse coche possible).
  patronJson.patronMd = { ...patronJson.patronMd, hash: current }
  await storage.writeFile(jsonPath, JSON.stringify(patronJson, null, 2), { encoding: 'utf8' })

  // Témoin DB : posé en DERNIER, après le SUCCÈS de l'écriture du témoin
  // disque — jamais dans la transaction de fusion. Ordre strict opposé au danger :
  // un témoin DB écrit avant un échec disque ferait skipper à jamais les passages
  // suivants (l'entrée ne serait plus jamais sauvegardée = perte silencieuse,
  // interdite par le principe cardinal). Ici l'écriture disque est confirmée : on
  // peut aligner le témoin DB et profiter du chemin rapide au prochain passage.
  // Sous `suppressAutoBackup` (même geste que la fusion) : sinon le hook Dexie
  // armerait un cycle auto-backup complet pour un champ purement interne.
  await suppressAutoBackup(async () => {
    await deps.db.patterns.update(live.id, { patronMdSyncHash: current })
  })

  report.merged.push({
    kind,
    id: kind === 'project' ? forkProjectId : live.id,
    name: merged.name,
    reconcile: aggregateReconcileReports(reconcileReports),
    warnings,
    missingAssets: missing,
  })
}

// syncPatronMd(storage, { db, patternsStore, projectsStore }, { only } = {}) →
// rapport de synchro. Scanne `Projets/` et `Patrons/` ; pour chaque sous-dossier
// portant à la fois `patron.md` et `patron.json`, compare le hash côté dossier au
// témoin, fusionne si besoin. Une exception dans un dossier n'interrompt jamais le
// scan des autres.
// `db` doit exposer `.transaction(mode, ...tables, cb)` + `.patterns`/`.projects.update`
// (API Dexie réelle) ; `patternsStore`/`projectsStore` doivent exposer `.load()` (pas
// `.update()` — les écritures DB passent désormais par `db` directement, dans une
// transaction atomique ; `.load()` sert juste à recharger l'état réactif Pinia
// après le commit, cf. `processFolder`).
//
// `only` (optionnel, `{ kind: 'pattern'|'project', id }`) restreint le passage à UN
// seul dossier — besoin de `syncPatronMdOnOpen` (sync-on-open.js) : à l'ouverture
// d'un patron/projet précis, inutile (et coûteux) de rescanner toute l'arborescence
// SAF ; on ne scanne QUE la racine (`Patrons/` ou `Projets/`) concernée, et on
// n'appelle `processFolder` que pour le dossier dont `parseEntryId` correspond à
// `only.id`. Le chemin de fusion (`processFolder`) est intégralement réutilisé —
// aucune règle de fusion/réconciliation dupliquée ici.
export async function syncPatronMd(storage, deps, { only } = {}) {
  if (running) return { skipped: 'running' }
  // Correctif revue (exclusion mutuelle) : ne jamais démarrer une synchro tant
  // qu'une sauvegarde (debounce, flush-pause, ou explicite) touche encore le
  // dossier SAF — les deux lisent/écrivent la même arborescence.
  if (isAutoBackupRunning()) return { skipped: 'backup-running' }
  // Garde import↔synchro (repro nexus7_2026-08-25) : ne jamais démarrer une
  // synchro tant que l'écran d'import est ouvert — sur un appareil lent, le
  // balayage complet peut prendre plusieurs minutes et masque toute
  // progression d'import pile au moment où l'utilisatrice revient du
  // sélecteur de fichiers système (cf. import-guard.js).
  if (isImportRunning()) return { skipped: 'import-running' }
  // Garde restauration↔synchro (symétrique des deux ci-dessus) : une restauration lit
  // toute l'arborescence puis remplace la base entière. Une synchro qui démarre pendant
  // ce temps-là — typiquement celle du listener `resume` d'App.vue, au retour au premier
  // plan — lit des fichiers en train d'être réécrits, et peut recouvrir le `bulkPut` de
  // la restauration par un état pré-restauration. Cf. `restore-guard.js` pour le détail
  // du cas le plus grave (restauration rendue définitivement impossible).
  if (isRestoreRunning()) return { skipped: 'restore-running' }
  // Garde décision en attente : la modale Restaurer/Perdre peut être ouverte à ce
  // moment-là (retour du sélecteur = resume) — lire les patrons PENDANT qu'elle
  // attend, c'est ~88 s de requêtes SAF pour rien (mesure 06/09), en concurrence
  // avec la restauration qui suivra si l'utilisatrice accepte.
  if (isRestoreDecisionPending()) return { skipped: 'decision-pending' }
  // Garde « dossier propre depuis la restauration » (même lot, 06/09) : la
  // restauration vient de lire TOUT le dossier et d'écrire la base à son image ;
  // tant qu'aucune mutation locale n'a eu lieu (toute écriture efface le drapeau,
  // cf. hook Dexie de db.js), un passage ne lirait que du déjà-lu — mesuré 06/09 :
  // des centaines de secondes de requêtes SAF pour un résultat identique.
  if (isFolderCleanSinceRestore()) return { skipped: 'folder-clean' }
  running = true
  const run = (async () => {
    const report = { merged: [], skipped: [], errors: [] }
    try {
      const roots = only
        ? [{ dir: only.kind === 'project' ? 'Projets' : 'Patrons', kind: only.kind }]
        : [
            { dir: 'Projets', kind: 'project' },
            { dir: 'Patrons', kind: 'pattern' },
          ]
      for (const { dir: rootDir, kind } of roots) {
        if (!(await storage.exists(rootDir))) continue
        const entries = await storage.readdir(rootDir)
        for (const entry of entries) {
          if (!entry.isDir) continue
          if (only && parseEntryId(entry.name) !== only.id) continue
          const dir = `${rootDir}/${entry.name}`
          try {
            const hasMd = await storage.exists(`${dir}/patron.md`)
            const hasJson = await storage.exists(`${dir}/patron.json`)
            if (!hasMd || !hasJson) continue
            await processFolder(storage, dir, entry.name, kind, deps, report)
          } catch (err) {
            // Décision du 07/09 : une erreur portant un code du catalogue (ex. les erreurs SAF
            // de saf-storage.js) voyage ENTIÈRE — code + params + verbatim .message — et
            // l'écran la traduit (warningText → SyncReportDialog), au lieu de pousser ici une
            // phrase figée non traduisible. Une erreur système imprévue (hors catalogue)
            // reste une chaîne brute : l'app ne fabrique plus elle-même de français non
            // traduit dans le rapport.
            // Le verbatim .message (français, gardé POUR le diagnostic) n'a de valeur que
            // s'il est réellement journalisé : SyncReportDialog le met en attribut title,
            // inerte au tactile, et syncPatronMd ne relance rien — sans ce log il ne
            // sortirait nulle part (revue 09/09).
            console.error('[patronSync] dossier', dir, err)
            report.errors.push({ folder: dir, error: isStructuredWarning(err) ? err : err?.message || String(err) })
          }
        }
      }
    } finally {
      running = false
      inflight = null
    }
    return report
  })()
  inflight = run
  return run
}

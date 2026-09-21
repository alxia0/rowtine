// Rowtine — collecte du snapshot de sauvegarde.
// Lit `db` (Dexie) et produit la forme attendue par `backupAll` (orchestrator.js) :
// projets avec leurs entités embarquées + patron d'instance, patrons de
// bibliothèque (y compris le patron `builtin` du projet libre — cf. `ensureFreePattern`
// dans src/stores/patterns.js : un projet "libre" porte `patternId` = son id, et sans
// lui une restauration dans une base neuve ne pourrait pas résoudre ce lien ;
// `builtin: true` reste dans le JSON pour que la restauration le reconnaisse), laines, compteurs
// indépendants, réglages, `keepIds` (actifs ∪ corbeille) pour la réconciliation des
// suppressions, et `trashIds` (corbeille seule) pour qu'à la restauration on sache
// reconnaître les dossiers dont le contenu a été supprimé par l'utilisateur.
import { db } from '@/db/db'

// Récupère les entités liées d'un projet (sections/counters/sessions/diagrams) et
// son éventuel patron d'instance (forké — ownerProjectId === project.id).
// `patternByOwnerProjectId` = Map ownerProjectId -> patron, construite une seule
// fois par `collectBackupData` (pas d'index Dexie sur `ownerProjectId` → filtre JS,
// comme le fait le reste du code, ex. `src/stores/projects.js` — mais en O(1) par
// projet plutôt qu'un scan linéaire de tous les patrons à chaque appel).
async function collectProject(project, patternByOwnerProjectId) {
  const [sections, counters, sessions, diagrams] = await Promise.all([
    db.sections.where('projectId').equals(project.id).toArray(),
    db.counters.where('projectId').equals(project.id).toArray(),
    db.sessions.where('projectId').equals(project.id).toArray(),
    db.diagrams.where('projectId').equals(project.id).toArray(),
  ])
  const instancePattern = patternByOwnerProjectId.get(project.id) || null
  return { ...project, sections, counters, sessions, diagrams, instancePattern }
}

// Extrait, depuis une ligne de corbeille, les ids projet/patron qu'elle référence —
// une entrée de type 'project' est un bundle { project, instancePattern?, … }, une
// entrée de type 'pattern' est le patron lui-même.
function trashIds(rows) {
  const projects = []
  const patterns = []
  for (const row of rows) {
    if (row.type === 'project') {
      const bundle = row.payload || {}
      // Aligné sur le fallback de `trash.js` (`restore`) : le payload est un bundle
      // `{ project, … }` en pratique (seul appelant actuel : `useSoftDelete` avec le
      // bundle de `projectsStore.remove`), mais on tolère aussi un projet nu par
      // robustesse — sans ça, un tel projet en corbeille perdrait son dossier de
      // sauvegarde à la réconciliation suivante.
      const project = bundle.project || bundle
      if (project?.id != null) projects.push(project.id)
      // Le patron d'instance vit sous Projets/, mais on le garde aussi dans
      // keepIds.patterns par prudence.
      if (bundle.instancePattern?.id != null) patterns.push(bundle.instancePattern.id)
    } else if (row.type === 'pattern') {
      if (row.payload?.id != null) patterns.push(row.payload.id)
    }
  }
  return { projects, patterns }
}

export async function collectBackupData() {
  const [projectRows, patternRows, yarns, independentCounters, settingRows, trashRows, purchases, activeDays] =
    await Promise.all([
      db.projects.toArray(),
      db.patterns.toArray(),
      db.yarns.toArray(),
      db.counters.where('projectId').equals(0).toArray(),
      db.settings.toArray(),
      db.trash.toArray(),
      db.purchases.toArray(),
      db.activeDays.toArray(), // journal des jours actifs (lot 2) : table globale, registre plat
    ])

  // `set` seulement si absente : reproduit exactement la sémantique « premier
  // trouvé » de l'ancien `patterns.find(...)` si jamais deux patrons partageaient
  // le même ownerProjectId (ne devrait pas arriver, mais ne change pas le
  // comportement si ça arrivait).
  const patternByOwnerProjectId = new Map()
  for (const p of patternRows) {
    if (p.ownerProjectId != null && !patternByOwnerProjectId.has(p.ownerProjectId)) {
      patternByOwnerProjectId.set(p.ownerProjectId, p)
    }
  }
  const projects = await Promise.all(projectRows.map((p) => collectProject(p, patternByOwnerProjectId)))

  // Inclut le(s) patron(s) builtin (ex. patron "libre") : un projet libre référence
  // son id via `patternId`, il doit donc être sauvegardé pour que la restauration
  // puisse résoudre ce lien plutôt que d'en fabriquer un nouveau (`ensureFreePattern`).
  // Note : ceci ne change pas la bibliothèque visible dans l'UI — le getter
  // `libraryPatterns` du store patterns filtre toujours `builtin` de son côté.
  const libraryPatterns = patternRows.filter((p) => p.ownerProjectId == null)

  // Accumulateur SANS PROTOTYPE : `row.key` vient de `db.settings`, dont les clés
  // peuvent avoir été écrites par une restauration (donc par un `reglages.json` du
  // disque). Une seule ligne de clé `__proto__` sur un objet littéral ne s'ajouterait
  // pas au dictionnaire — elle changerait le prototype de l'accumulateur, et le réglage
  // disparaîtrait de la sauvegarde en silence.
  const settings = Object.create(null)
  for (const row of settingRows) settings[row.key] = row.value

  const trash = trashIds(trashRows)
  const keepIds = {
    projects: [...projectRows.map((p) => p.id), ...trash.projects],
    patterns: [...libraryPatterns.map((p) => p.id), ...trash.patterns],
  }

  // `trash` sert aussi de valeur pour `trashIds` ci-dessous : ids en corbeille
  // (uniquement), exposés à part de `keepIds` pour que S3 sache reconnaître, à la
  // restauration, les dossiers dont le contenu a été supprimé par l'utilisateur (mais
  // conservé sur disque par la réconciliation de `backupAll`, via `keepIds`) — cf.
  // `corbeille.json` (orchestrator.js) et `readBackup` (restore.js).

  return { projects, libraryPatterns, yarns, purchases, activeDays, independentCounters, settings, keepIds, trashIds: trash }
}

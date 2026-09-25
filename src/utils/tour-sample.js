// Identité du projet d'exemple utilisé par la visite guidée du lecteur (lot du
// 23/09/2026) : retrouver — ou, au besoin, recréer — le projet « Bonnet Torsade » semé à
// l'accueil, pour pouvoir lancer la visite dessus à tout moment, même si l'utilisatrice a
// supprimé ses exemples ou restauré une sauvegarde antérieure à cette fonctionnalité
// (`tourProjectId` n'y a jamais été enregistré).
import { db, getSetting, setSetting } from '@/db/db'
import { getSeededSampleIds } from '@/utils/seeded-samples'
import { isSingleSize } from '@/utils/reader'
import { useProjectsStore, buildWipProject } from '@/stores/projects'
import { usePatternsStore } from '@/stores/patterns'
import { loadDemoContent, DEMO_PATTERN_DEMO_ID } from '@/constants/demo'

const SETTING_KEY = 'tourProjectId'
// Dernier patron sur lequel la visite s'est appuyée (n'importe laquelle des trois voies
// a/b/c ci-dessous) : sert UNIQUEMENT à (c) pour RETROUVER un patron de bibliothèque
// survivant plutôt que d'en recréer un doublon, cf. `findReusablePattern` plus bas.
const PATTERN_SETTING_KEY = 'tourPatternId'

// Un patron est candidat à la visite guidée s'il existe encore (une suppression, même
// annulable via la corbeille, RETIRE déjà la ligne de `db.patterns` — cf. `remove()` dans
// patterns.js/trash.js, qui ne conserve le double que dans `db.trash` — donc « existe »
// couvre déjà « pas à la corbeille », pas de champ à part à vérifier) et s'il porte de quoi
// montrer les deux écrans-clés de la visite : un sélecteur de taille (au moins 2 tailles,
// hors la sentinelle « Taille unique », cf. `isSingleSize`) et un diagramme (au moins une
// section qui porte à la fois un `chart` et une étape `{ chart: true }`).
export function isTourPatternCandidate(pattern) {
  if (!pattern) return false
  const sizeLabels = pattern.reader?.sizeLabels
  if (!Array.isArray(sizeLabels) || sizeLabels.length < 2 || isSingleSize(sizeLabels)) return false
  const sections = pattern.reader?.sections
  if (!Array.isArray(sections)) return false
  return sections.some(
    (s) => s?.chart && Array.isArray(s.steps) && s.steps.some((step) => step?.chart === true),
  )
}

// Un projet est candidat à la visite guidée s'il existe encore (même raison qu'au-dessus
// pour « existe » ⇒ « pas à la corbeille ») et si son patron l'est, cf.
// `isTourPatternCandidate` — la vérification du patron proprement dite vit là, pas ici,
// pour pouvoir la rejouer sur un patron seul (voir `findReusablePattern`).
export function isTourCandidate(project, pattern) {
  if (!project) return false
  return isTourPatternCandidate(pattern)
}

// Relit un projet par id et vérifie qu'il est toujours candidat (avec son patron lié).
// `null` si l'un des deux manque (corbeille comprise, cf. isTourCandidate) ou n'est plus
// un candidat valide (patron changé, sections vidées…).
async function candidateFor(projectId) {
  const project = await db.projects.get(Number(projectId))
  if (!project) return null
  const pattern = project.patternId != null ? await db.patterns.get(Number(project.patternId)) : null
  return isTourCandidate(project, pattern) ? project : null
}

// Mémorise le patron sur lequel la visite s'appuie désormais, pour que (c) puisse le
// retrouver la prochaine fois (cf. `findReusablePattern`). Appelée à chaque résolution
// (a/b/c) — pas seulement à la création — pour que ce repli reste à jour même quand (a)
// ou (b) ont fait le travail.
async function rememberPattern(patternId) {
  if (patternId != null) await setSetting(PATTERN_SETTING_KEY, patternId)
}

// Un patron de bibliothèque survivant à réutiliser pour (c), plutôt que d'en recréer un
// et de dupliquer le bonnet à chaque suppression : `patternsStore.add`/`seedSamplesIfEmpty`
// ne posent jamais `ownerProjectId` sur ce patron (ce n'est pas une instance dédiée à un
// projet, cf. `projects.js::remove()`), donc supprimer le PROJET ne supprime pas le
// PATRON — il reste en bibliothèque, réutilisable. Deux sources, dans l'ordre : d'abord
// `tourPatternId` (le dernier patron mémorisé par `rememberPattern`, seul recours si ce
// patron a déjà été recréé une première fois par (c) — ce cas-là n'entre JAMAIS dans
// `seededSampleIds`, cf. son commentaire plus bas) ; puis, à défaut, le premier patron du
// semis INITIAL (`getSeededSampleIds().patterns`) encore candidat — la voie qu'emprunte le
// cas réel « bonnet supprimé juste après l'onboarding », où `seededSampleIds` porte déjà
// les trois patrons semés. `null` si aucun des deux ne convient : (c) devra en créer un.
async function findReusablePattern() {
  const savedPatternId = await getSetting(PATTERN_SETTING_KEY)
  if (savedPatternId != null) {
    const pattern = await db.patterns.get(Number(savedPatternId))
    if (isTourPatternCandidate(pattern)) return pattern
  }
  const { patterns: seededPatternIds } = await getSeededSampleIds()
  for (const patternId of seededPatternIds) {
    const pattern = await db.patterns.get(Number(patternId))
    if (isTourPatternCandidate(pattern)) return pattern
  }
  return null
}

// Recrée le projet « en cours » du bonnet, exactement comme le fait le semis initial pour
// le wip (cf. `projectsStore.seedExamplesIfEmpty` et `buildWipProject`) — utile aux
// installations onboardées avant cette fonctionnalité qui ont depuis supprimé leurs
// exemples. Réutilise un patron survivant quand `findReusablePattern` en trouve un
// (aucune écriture dans `db.patterns` dans ce cas) ; ne recrée le patron du bonnet que
// faute de mieux. Passe par les stores (`patternsStore.add`, `projectsStore.create`) pour
// que les listes déjà chargées en mémoire se mettent à jour. `demoId` n'est jamais stocké
// (même forme que `patternsStore.seedSamplesIfEmpty`) : c'est une clé de semis, pas une
// donnée de patron.
async function recreateTourProject({ locale, technique }) {
  const content = await loadDemoContent(locale)
  const reusablePattern = await findReusablePattern()
  let demo
  if (reusablePattern) {
    demo = { name: reusablePattern.name, patternId: reusablePattern.id, sizes: reusablePattern.sizes || [], activeSize: 'M' }
  } else {
    const demoPattern = content.patterns.find((p) => p.demoId === DEMO_PATTERN_DEMO_ID)
    if (!demoPattern) return null
    const { demoId, ...patternData } = demoPattern
    const patternId = await usePatternsStore().add(patternData)
    demo = { name: demoPattern.name, patternId, sizes: demoPattern.sizes, activeSize: 'M' }
  }
  const id = await useProjectsStore().create(buildWipProject({ technique, demo, texts: content.projects }))
  await rememberPattern(demo.patternId)
  return id
}

// Retrouve — ou recrée — le projet de démonstration sur lequel lancer la visite guidée.
// Trois voies, dans l'ordre :
//   a) `tourProjectId` déjà enregistré et toujours candidat → le renvoyer ;
//   b) sinon, le premier projet semé (`getSeededSampleIds().projects`) encore candidat —
//      installations onboardées avant cette fonctionnalité, où `tourProjectId` n'a jamais
//      été écrit ;
//   c) sinon, recréer le projet du bonnet (patron survivant réutilisé si possible, cf.
//      `recreateTourProject`).
// Enregistre systématiquement l'id trouvé/créé (`tourProjectId`) et le patron dont il
// dépend (`tourPatternId`), pour que les appels suivants retombent directement sur (a) et
// que (c), si (a)/(b) échouent un jour, retrouve ce même patron au lieu d'en dupliquer un.
// Ne touche JAMAIS `seededSampleIds` : ce registre reste la mémoire du semis INITIAL
// (consommé par `isDbRestorable`), pas de la visite guidée. Renvoie `{ id, created }`, ou
// `null` si même la recréation échoue (jeu d'exemples absent de la langue demandée).
export async function ensureTourProject({ locale, technique } = {}) {
  const savedId = await getSetting(SETTING_KEY)
  if (savedId != null) {
    const project = await candidateFor(savedId)
    if (project) {
      await rememberPattern(project.patternId)
      return { id: project.id, created: false }
    }
  }

  const { projects: seededProjectIds } = await getSeededSampleIds()
  for (const projectId of seededProjectIds) {
    const project = await candidateFor(projectId)
    if (project) {
      await setSetting(SETTING_KEY, project.id)
      await rememberPattern(project.patternId)
      return { id: project.id, created: false }
    }
  }

  const id = await recreateTourProject({ locale, technique })
  if (id == null) return null
  await setSetting(SETTING_KEY, id)
  return { id, created: true }
}

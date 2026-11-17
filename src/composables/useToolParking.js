// Logique partagée par les points d'entrée qui changent le statut d'un projet : passer à
// 'pause' propose de libérer les outils liés (mis de côté dans `parkedTools`), repasser de
// 'pause' à 'wip' propose de relier ceux qui sont encore libres. Sans lien à ranger ni à
// reprendre, le statut change tout de suite, comme avant.
//
// Contrat : `applyStatus(extra)` est appelé EXACTEMENT UNE FOIS sur chaque chemin ; les
// appelants écrivent `update(id, { status, ...extra })`. `extra` vaut `{}` quand rien de
// spécial n'est à écrire (dont la pause refusée et l'annulation à la pause : liens gardés).
// Seul le stock d'outils est passé aux fonctions pures (pas la corbeille) : un outil à la
// corbeille ne pose donc aucune question.
import { ref, computed, watch, reactive } from 'vue'
import { useProjectsStore } from '@/stores/projects'
import { useToolsStore } from '@/stores/tools'
import { useToolParkingStore } from '@/stores/tool-parking'
import { parkEntries, parkedEntries, parkedOf, relinkPatch, pruneToolIds, pruneKitPicks } from '@/utils/tool-links'

export function useToolParking() {
  const projectsStore = useProjectsStore()
  const toolsStore = useToolsStore()
  const store = useToolParkingStore()
  // { projectId, project, mode, applyStatus } tant qu'une question est en attente, sinon null.
  // `project` est l'instantané frais lu à l'ouverture, utilisé seulement pour afficher.
  const req = ref(null)

  const open = computed(() => req.value != null)
  const mode = computed(() => req.value?.mode ?? 'pause')
  // Recalculé depuis les stores (jamais figé) : les non libres de la reprise y figurent aussi.
  const entries = computed(() => {
    if (!req.value) return []
    const { project, mode: m } = req.value
    return m === 'pause'
      ? parkEntries(project, toolsStore.tools)
      : parkedEntries(project, toolsStore.tools, projectsStore.projects)
  })

  watch(open, (v) => {
    store.open = v
  })
  // Fermeture externe (Retour Android) : équivaut à Annuler. Si `cancel()` a déjà vidé `req`,
  // le garde évite un second `applyStatus`.
  watch(
    () => store.open,
    (v) => {
      if (v || !req.value) return
      cancel()
    },
  )

  // Valider : à la pause, range les liens ; à la reprise, relie les entrées cochées ET libres.
  async function confirm(selectedKeys = []) {
    const current = req.value
    if (!current) return
    // Effacé AVANT tout await (garde anti-double-traitement, cf. useProjectConsumption).
    req.value = null
    const fresh = (await projectsStore.get(current.projectId)) ?? current.project
    if (current.mode === 'pause') {
      // Seuls les liens valides dans le STOCK partent dans `parkedTools` ; un id d'outil en
      // corbeille (ou une prise orpheline) reste sur le projet, comme dans le store, pour que
      // restaurer l'outil ramène son lien.
      const tools = toolsStore.tools
      const rawIds = Array.isArray(fresh.toolIds) ? fresh.toolIds : []
      const rawPicks = Array.isArray(fresh.kitPicks) ? fresh.kitPicks : []
      const parkedIds = pruneToolIds(rawIds, tools)
      const parkedSet = new Set(parkedIds)
      return current.applyStatus({
        toolIds: rawIds.filter((id) => !parkedSet.has(Number(id))),
        kitPicks: rawPicks.filter((pick) => pruneKitPicks([pick], tools).length === 0),
        parkedTools: { toolIds: parkedIds, kitPicks: pruneKitPicks(rawPicks, tools) },
      })
    }
    const freeKeys = parkedEntries(fresh, toolsStore.tools, projectsStore.projects)
      .filter((e) => e.free)
      .map((e) => e.key)
    const wanted = new Set(selectedKeys)
    return current.applyStatus(relinkPatch(fresh, toolsStore.tools, freeKeys.filter((k) => wanted.has(k))))
  }

  // Annuler : à la pause, le statut change quand même et les liens sont gardés (`{}`) ; à la
  // reprise, le statut change et le mis de côté est abandonné (`parkedTools: null`).
  async function cancel() {
    const current = req.value
    if (!current) return
    req.value = null
    await current.applyStatus(current.mode === 'pause' ? {} : { parkedTools: null })
  }

  // `project` : objet avec `id` ET le statut d'AVANT le changement. Ne bloque jamais en
  // attendant la réponse : sur le chemin « question posée », `req` est armé et on rend la main.
  async function requestStatusChange(project, status, applyStatus) {
    const before = project?.status
    const pausing = status === 'pause' && before === 'wip'
    // Reprise : tout passage vers « En cours » (aussi depuis En attente ou À venir après une
    // pause) ; sans rien de mis de côté, les gardes plus bas ne posent aucune question.
    const resuming = status === 'wip' && before !== 'wip'
    if (!pausing && !resuming) return applyStatus({})
    if (!toolsStore.loaded) await toolsStore.load()
    if (!projectsStore.loaded) await projectsStore.load()
    const fresh = (await projectsStore.get(project.id)) ?? project
    if (pausing) {
      if (parkEntries(fresh, toolsStore.tools).length === 0) return applyStatus({})
      req.value = { projectId: project.id, project: fresh, mode: 'pause', applyStatus }
      return
    }
    if (parkedEntries(fresh, toolsStore.tools, projectsStore.projects).length === 0) {
      const hadParked = parkedOf(fresh).toolIds.length + parkedOf(fresh).kitPicks.length > 0
      return applyStatus(hadParked ? { parkedTools: null } : {})
    }
    req.value = { projectId: project.id, project: fresh, mode: 'resume', applyStatus }
  }

  return reactive({ open, mode, entries, confirm, cancel, requestStatusChange })
}

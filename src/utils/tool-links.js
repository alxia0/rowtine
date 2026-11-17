// Liens outil <-> projet, en JS pur (testés seuls). Le lien vit sur le projet (`toolIds`).
import { toolSizes, cents, servesTechnique, cablesOf, cableSort, cableValue } from '@/utils/tool-list'
import { CABLE_JOINS } from '@/constants/tools'

const idsOf = (project) => (Array.isArray(project?.toolIds) ? project.toolIds : [])

// Outils d'un projet, dans l'ordre de `toolIds` ; un id absent de `tools` (corbeille, supprimé) est ignoré.
export function linkedTools(project, tools) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  return idsOf(project)
    .map((id) => byId.get(id))
    .filter(Boolean)
}

export function projectsUsingTool(toolId, projects) {
  return projects.filter((p) => idsOf(p).includes(toolId))
}

// Un outil est « en cours » s'il figure dans les `toolIds` d'au moins un projet `wip` : on rend
// le nom du premier dans l'ordre de `projects` (chaîne vide si ce projet n'a pas de nom), ou
// `null` si aucun projet en cours ne l'utilise.
export function inUseProjectName(toolId, projects) {
  const wip = projectsUsingTool(toolId, projects).find((p) => p.status === 'wip')
  return wip ? String(wip.name || '').trim() : null
}

// Feuille de sélection : d'abord les outils de la technique du projet (même table que
// `missingSizes`) dont une taille, kit compris, est demandée au centième près. Pas de filtre
// sur l'état : un outil prêté reste liable.
export function pickerOrder(tools, requestedMm, technique) {
  const wanted = new Set((requestedMm || []).map((mm) => cents(Number(mm))))
  const matching = []
  const others = []
  for (const tool of tools) {
    const fits = servesTechnique(tool, technique) && toolSizes(tool).some((mm) => wanted.has(cents(mm)))
    ;(fits ? matching : others).push(tool)
  }
  return { matching, others }
}

// Ids à écrire : des nombres (une valeur de case à cocher arrive en chaîne), seulement ceux
// dont l'outil existe, sans doublon.
export function pruneToolIds(toolIds, tools) {
  const present = new Set(tools.map((t) => t.id))
  return [...new Set((Array.isArray(toolIds) ? toolIds : []).map(Number))].filter((id) => present.has(id))
}

// --- Prises de kit : `project.kitPicks` = [{ toolId, sizeMm, cableCm, cableJoin }], taille (et câble)
// prises dans un kit pour ce projet. Champ absent sur un projet d'avant : se lit comme vide ;
// `cableJoin` absent se lit `null` (câble sans diamètre).
export const kitPicksOf = (project) => (Array.isArray(project?.kitPicks) ? project.kitPicks : [])

const nameOf = (project) => String(project.name || '').trim()

// Tailles d'un kit prises par les projets en cours (les seuls qui occupent), triées par taille.
export function kitTakenSizes(toolId, projects) {
  const taken = []
  for (const p of projects) {
    if (p.status !== 'wip') continue
    for (const pick of kitPicksOf(p)) {
      if (pick.toolId === toolId) taken.push({ sizeMm: pick.sizeMm, projectName: nameOf(p) })
    }
  }
  return taken.sort((a, b) => a.sizeMm - b.sizeMm)
}

// Une taille au centième près dans les tailles du kit (une prise périmée ne compte plus).
const kitHasSize = (tool, mm) => (tool?.kitSizes || []).some((k) => cents(Number(k)) === cents(Number(mm)))

// Prises à écrire : kit présent, taille dans `kitSizes`, câble (longueur ET diamètre) dans `kitCables`
// ou `null`, nombres, sans doublon exact. Une prise ancienne sans diamètre se rattache à l'unique
// diamètre du kit pour sa longueur ; s'il y en a plusieurs, la taille reste prise sans câble.
export function pruneKitPicks(picks, tools) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  const seen = new Set()
  const out = []
  for (const raw of Array.isArray(picks) ? picks : []) {
    const toolId = Number(raw?.toolId)
    const sizeMm = Number(raw?.sizeMm)
    const rawCable = raw?.cableCm == null ? null : Number(raw.cableCm)
    const tool = byId.get(toolId)
    if (!tool || !Number.isFinite(sizeMm) || (rawCable !== null && !Number.isFinite(rawCable))) continue
    if (!(tool.kitSizes || []).some((mm) => cents(mm) === cents(sizeMm))) continue
    // Le câble est facultatif : retiré du kit, il s'efface, la taille reste prise.
    let cableCm = null
    let cableJoin = null
    if (rawCable !== null) {
      const rawJoin = CABLE_JOINS.includes(raw.cableJoin) ? raw.cableJoin : null
      const sameLength = cablesOf(tool).filter((c) => c.cm === rawCable)
      if (sameLength.some((c) => c.join === rawJoin)) {
        cableCm = rawCable
        cableJoin = rawJoin
      } else if (rawJoin === null && new Set(sameLength.map((c) => c.join)).size === 1) {
        cableCm = rawCable
        cableJoin = sameLength[0].join
      }
    }
    const key = `${toolId}|${sizeMm}|${cableCm}|${cableJoin}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ toolId, sizeMm, cableCm, cableJoin })
  }
  return out
}

// Câbles d'un kit : une entrée par couple (longueur, diamètre), dans l'ordre de `cablesOf`, `count`
// exemplaires, `taken` les noms des projets en cours qui en ont pris un (une entrée par prise).
export function kitCableUse(tool, projects) {
  const rows = []
  for (const c of cablesOf(tool)) {
    const last = rows[rows.length - 1]
    if (last && cableSort(last, c) === 0) last.count += 1
    else rows.push({ cm: c.cm, join: c.join, count: 1, taken: [] })
  }
  for (const p of projects) {
    if (p.status !== 'wip') continue
    const own = kitPicksOf(p).filter((pick) => Number(pick.toolId) === tool?.id)
    for (const pick of pruneKitPicks(own, [tool])) {
      rows.find((r) => r.cm === pick.cableCm && r.join === pick.cableJoin)?.taken.push(nameOf(p))
    }
  }
  return rows
}

// Tailles prises à afficher (carte du kit) : comme `kitTakenSizes`, mais seulement les prises
// encore valables (taille et câble présents dans le kit, même règle que `pruneKitPicks`).
export function kitTakenLive(tool, projects) {
  const taken = []
  for (const p of projects) {
    if (p.status !== 'wip') continue
    const own = kitPicksOf(p).filter((pick) => Number(pick.toolId) === tool.id)
    for (const pick of pruneKitPicks(own, [tool])) taken.push({ sizeMm: pick.sizeMm, projectName: nameOf(p) })
  }
  return taken.sort((a, b) => a.sizeMm - b.sizeMm)
}

const othersThan = (projectId, projects) => projects.filter((p) => p.id !== projectId)

// Feuille de sélection, tailles d'un kit : celles demandées par le projet d'abord (au centième
// près), puis les autres, croissantes ; `takenBy` : les autres projets en cours qui la prennent.
export function kitPickerSizes(tool, requestedMm, projects, projectId) {
  const wanted = new Set((requestedMm || []).map((mm) => cents(Number(mm))))
  const taken = kitTakenLive(tool, othersThan(projectId, projects))
  const sizes = toolSizes(tool)
  const ordered = [...sizes.filter((mm) => wanted.has(cents(mm))), ...sizes.filter((mm) => !wanted.has(cents(mm)))]
  return ordered.map((sizeMm) => ({ sizeMm, takenBy: taken.filter((s) => cents(s.sizeMm) === cents(sizeMm)).map((s) => s.projectName) }))
}

// Feuille de sélection, câbles d'un kit : un couple (longueur, diamètre) par entrée, `value` la paire
// « 80|s » ; `takenBy` n'est rempli que si les autres projets en cours en tiennent tous les
// exemplaires (sinon il en reste un de libre).
export function kitPickerCables(tool, projects, projectId) {
  return kitCableUse(tool, othersThan(projectId, projects)).map(({ cm, join, count, taken }) => ({ cm, join, value: cableValue({ cm, join }), takenBy: taken.length >= count ? taken : [] }))
}

// Fiche projet : ses prises de kit avec la fiche du kit ; kit absent de `tools` (corbeille,
// supprimé) ou taille et câble qui n'y sont plus : ignorées à l'affichage.
export function linkedKitPicks(project, tools) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  return pruneKitPicks(kitPicksOf(project), tools).map((pick) => ({ tool: byId.get(pick.toolId), sizeMm: pick.sizeMm, cableCm: pick.cableCm, cableJoin: pick.cableJoin }))
}

// --- Liens mis de côté : à la pause, les liens d'un projet peuvent être rangés dans
// `project.parkedTools` = { toolIds, kitPicks } ; à la reprise on relie ceux qui sont libres.
// Champ absent, `null` ou mal formé : deux tableaux vides.
export function parkedOf(project) {
  const raw = project?.parkedTools
  const ok = raw !== null && typeof raw === 'object'
  return {
    toolIds: ok && Array.isArray(raw.toolIds) ? raw.toolIds : [],
    kitPicks: ok && Array.isArray(raw.kitPicks) ? raw.kitPicks : [],
  }
}

const toolEntry = (tool) => ({ key: `tool:${tool.id}`, kind: 'tool', tool, free: true, takenBy: [] })
const kitEntry = (tool, pick) => ({
  key: `kit:${tool.id}|${pick.sizeMm}|${pick.cableCm}`,
  kind: 'kit',
  tool,
  sizeMm: pick.sizeMm,
  cableCm: pick.cableCm,
  cableJoin: pick.cableJoin ?? null,
  free: true,
  takenBy: [],
})

// Entrées d'une liste d'ids et de prises, périmées écartées (même élagage que l'écriture).
function entriesOf(toolIds, kitPicks, tools) {
  const byId = new Map(tools.map((t) => [t.id, t]))
  return [
    ...pruneToolIds(toolIds, tools).map((id) => toolEntry(byId.get(id))),
    ...pruneKitPicks(kitPicks, tools).map((pick) => kitEntry(byId.get(pick.toolId), pick)),
  ]
}

// Liens valides du projet, à mettre de côté (disponibilité sans objet : toujours « libre »).
export function parkEntries(project, tools) {
  return [
    ...linkedTools(project, tools).map(toolEntry),
    ...linkedKitPicks(project, tools).map((pick) => kitEntry(pick.tool, pick)),
  ]
}

// Mis de côté encore valide, avec sa disponibilité face aux AUTRES projets en cours.
export function parkedEntries(project, tools, projects) {
  const others = othersThan(project.id, projects)
  const parked = parkedOf(project)
  return entriesOf(parked.toolIds, parked.kitPicks, tools).map((entry) => {
    let takenBy = []
    if (entry.kind === 'tool') {
      takenBy = projectsUsingTool(entry.tool.id, others).filter((p) => p.status === 'wip').map(nameOf)
    } else {
      const names = kitTakenLive(entry.tool, others)
        .filter((s) => cents(s.sizeMm) === cents(entry.sizeMm))
        .map((s) => s.projectName)
      if (entry.cableCm !== null) {
        const row = kitCableUse(entry.tool, others).find((r) => r.cm === entry.cableCm && r.join === entry.cableJoin)
        if (row && row.taken.length >= row.count) names.push(...row.taken)
      }
      takenBy = [...new Set(names)]
    }
    return { ...entry, free: takenBy.length === 0, takenBy }
  })
}

// Patch à écrire à la reprise : liens actuels INTACTS (un id d'outil en corbeille y reste exprès,
// l'élagage se fait à l'écriture dans le store) plus les entrées mises de côté choisies (clés
// inconnues ignorées, déjà validées sur le stock), sans doublon, `parkedTools` vidé.
export function relinkPatch(project, tools, selectedKeys) {
  const chosen = new Set(selectedKeys || [])
  const parked = parkedOf(project)
  const picked = entriesOf(parked.toolIds, parked.kitPicks, tools).filter((e) => chosen.has(e.key))
  const kitPicks = []
  const seen = new Set()
  const pickedKits = picked.filter((e) => e.kind === 'kit').map((e) => ({ toolId: e.tool.id, sizeMm: e.sizeMm, cableCm: e.cableCm, cableJoin: e.cableJoin }))
  for (const pick of [...kitPicksOf(project), ...pickedKits]) {
    // Une prise par taille de kit (comme la feuille de sélection) : la prise ACTUELLE passe
    // en premier et garde la place.
    const key = `${pick.toolId}|${cents(Number(pick.sizeMm))}`
    if (seen.has(key)) continue
    seen.add(key)
    kitPicks.push(pick)
  }
  return {
    toolIds: [...new Set([...idsOf(project), ...picked.filter((e) => e.kind === 'tool').map((e) => e.tool.id)])],
    kitPicks,
    parkedTools: null,
  }
}

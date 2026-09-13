// Sections d'un projet (+ diagrammes) — CRUD local + machine à états (feedback 28/06).
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, plain } from '@/db/db'
import { createLoadGuard } from '@/stores/load-guard'

export function emptySection() {
  return { name: '', rowsTotal: 0, rowsDone: 0, instructions: '', bySize: {}, isDiagram: false, markedDone: false, order: 0 }
}

// Instructions d'une section pour une taille donnée : variante par taille si elle existe,
// sinon le texte commun. Centralisé pour un affichage cohérent (session, vue patron).
export function sectionInstructions(section, size) {
  return (size && section?.bySize && section.bySize[size]) || section?.instructions || ''
}

export const useSectionsStore = defineStore('sections', () => {
  const sections = ref([])
  const projectId = ref(null)

  // Jeton de rechargement (cf. `stores/load-guard.js`) : les cases « section faite » et
  // l'avancée des rangs, cochées en rafale, ne doivent jamais réafficher l'état d'avant le
  // clic suivant. Le jeton règle du même coup le changement de projet — si deux chargements
  // de projets DIFFÉRENTS se croisent, c'est le dernier demandé qui gagne, comme `projectId`
  // (posé, lui, avant toute attente).
  const loadGuard = createLoadGuard()
  function loadForProject(pid) {
    projectId.value = Number(pid)
    return loadGuard.run(async (isCurrent) => {
      const rows = await db.sections.where('projectId').equals(Number(pid)).sortBy('order')
      if (!isCurrent()) return
      sections.value = rows
    })
  }
  async function reload() {
    if (projectId.value != null) await loadForProject(projectId.value)
  }
  async function get(id) {
    return db.sections.get(Number(id))
  }
  async function add(pid, data) {
    const count = await db.sections.where('projectId').equals(Number(pid)).count()
    const id = await db.sections.add({ ...emptySection(), ...plain(data), projectId: Number(pid), order: count })
    await loadForProject(pid)
    return id
  }
  async function update(id, data) {
    await db.sections.update(Number(id), plain(data))
    await reload()
  }
  async function remove(id) {
    const s = await db.sections.get(Number(id))
    await db.sections.delete(Number(id))
    await reload()
    return s
  }
  async function restore(s) {
    await db.sections.put(s)
    await reload()
  }
  async function setRowsDone(id, rows) {
    const s = await get(id)
    const clamped = Math.max(0, s.rowsTotal ? Math.min(rows, s.rowsTotal) : rows)
    await update(id, { rowsDone: clamped, markedDone: false })
  }
  async function markDone(id) {
    const s = await get(id)
    await update(id, { markedDone: true, rowsDone: s.rowsTotal || s.rowsDone })
  }
  async function reset(id) {
    await update(id, { rowsDone: 0, markedDone: false })
  }

  // Remplace les sections d'un projet par celles d'un patron (lien projet→patron).
  // rowsTotal est estimé d'après le nombre de lignes d'instructions. Écrase les sections
  // existantes (et leur progression) → l'appelant doit confirmer en cas de perte d'infos.
  async function replaceFromPattern(pid, patternSections, activeSize = '') {
    await db.sections.where('projectId').equals(Number(pid)).delete()
    let order = 0
    for (const ps of patternSections || []) {
      // rowsTotal estimé d'après les instructions de la taille active (sinon communes).
      const instr = sectionInstructions(ps, activeSize)
      const rowsTotal = String(instr).split('\n').filter((l) => l.trim()).length
      await db.sections.add({
        ...emptySection(),
        projectId: Number(pid),
        name: ps.name || '',
        instructions: ps.instructions || '',
        bySize: ps.bySize || {},
        isDiagram: !!ps.isDiagram,
        rowsTotal,
        order: order++,
      })
    }
    await loadForProject(pid)
  }

  // Progression agrégée par projet : { [projectId]: { done, total } } (rangs faits / total).
  // Une section marquée terminée compte comme entièrement faite. Sert aux cartes de l'accueil.
  async function progressByProject() {
    const rows = await db.sections.toArray()
    const map = {}
    for (const s of rows) {
      const total = Number(s.rowsTotal) || 0
      if (!total) continue // sans total connu, on n'estime pas
      const done = s.markedDone ? total : Math.min(total, Number(s.rowsDone) || 0)
      const m = (map[s.projectId] ||= { done: 0, total: 0 })
      m.done += done
      m.total += total
    }
    return map
  }

  return { sections, projectId, loadForProject, reload, get, add, update, remove, restore, setRowsDone, markDone, reset, replaceFromPattern, progressByProject }
})

// Badge d'une section/diagramme (feedback 28/06) :
// Terminée (tous rangs faits ou marquée) · En cours (dernière section lancée)
// · Commencé (≥1 rang fait, hors en cours) · À faire (sinon).
export function sectionState(section, activeSectionId) {
  if (section.markedDone || (section.rowsTotal > 0 && section.rowsDone >= section.rowsTotal)) return 'done'
  if (section.id === activeSectionId) return 'wip'
  if (section.rowsDone > 0) return 'started'
  return 'todo'
}

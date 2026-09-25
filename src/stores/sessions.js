// Sessions de travail (temps + rangs) — liste par projet, ajout manuel, suppression.
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, plain } from '@/db/db'
import { createLoadGuard } from '@/stores/load-guard'
import { useProjectsStore } from '@/stores/projects'

// Plus récent d'abord ; les lignes sans date trient en dernier (même convention que
// `loadForProject` et `recentSessions`, qui partagent ce tri).
function byDateDesc(a, b) {
  return (b.date || '').localeCompare(a.date || '')
}

export const useSessionsStore = defineStore('sessions', () => {
  const sessions = ref([])
  const projectId = ref(null)

  // Jeton de rechargement (cf. `stores/load-guard.js`) : une lecture partie avant
  // l'enregistrement d'une session ne doit pas réafficher la liste d'avant. Couvre aussi le
  // changement de projet (cf. le commentaire jumeau dans `stores/sections.js`).
  const loadGuard = createLoadGuard()
  function loadForProject(pid) {
    projectId.value = Number(pid)
    return loadGuard.run(async (isCurrent) => {
      const rows = await db.sessions.where('projectId').equals(Number(pid)).toArray()
      if (!isCurrent()) return
      sessions.value = rows.sort(byDateDesc)
    })
  }
  async function reload() {
    if (projectId.value != null) await loadForProject(projectId.value)
  }
  async function add(data) {
    await db.sessions.add({ ...plain(data) })
    await reload()
  }
  async function update(id, data) {
    // INVARIANT : l'édition inline (durée corrigée, rangs…) n'est JAMAIS un contact chrono —
    // `lastWriteAt` ne passe pas. Ce champ mesure le DERNIER CONTACT du chrono : c'est lui
    // qui ouvre la fenêtre de fusion des 2 h (utils/chrono-episode.js) et élit la
    // `lastChronoSession` d'une reprise. Rafraîchi par une simple édition, il ressusciterait
    // une fenêtre de fusion pour une ligne morte — une séance fossilisée réadoptée par le
    // prochain play(). Le chrono est le SEUL à avancer sa mèche (commitChunk).
    // `plain(data)` rend déjà une copie neuve : on opère dessus, jamais sur l'objet appelant.
    const patch = plain(data)
    delete patch.lastWriteAt
    await db.sessions.update(Number(id), patch)
    await reload()
  }
  async function remove(id) {
    const s = await db.sessions.get(Number(id))
    await db.sessions.delete(Number(id))
    await reload()
    return s
  }
  async function restore(s) {
    await db.sessions.put(s)
    await reload()
  }

  // Récap Accueil : total de secondes depuis une date (toutes sessions, tous projets).
  async function secondsSince(sinceDate) {
    const all = await db.sessions.toArray()
    return all
      .filter((s) => s.date && new Date(s.date) >= sinceDate)
      .reduce((acc, s) => acc + (s.durationSec || 0), 0)
  }

  // Toutes les sessions, tous projets confondus — pour l'agrégation par période (stats, Epic G).
  async function allSessions() {
    return db.sessions.toArray()
  }

  // Toutes les sessions TOUS PROJETS, du PLUS RÉCENT au PLUS ANCIEN, chacune enrichie du NOM
  // de son projet (`projectName`, '' si le projet a disparu) — pour l'écran Sessions (T4,
  // 31/08) et tout futur « N dernières séances » (T5). Même tri que `loadForProject`
  // (date desc lexicographique sur l'ISO 8601) ; les lignes sans date trient en dernier.
  // Le nom est joint via useProjectsStore CHARGÉ AU BESOIN : le store est déjà en mémoire
  // après l'accueil (HomeView le charge), mais un montage direct (test, deep-link) ne doit
  // pas dépendre d'un écran déjà visité — même filet que ExpensesView sur ses trois stores.
  async function recentSessions(limit = Infinity) {
    const projectsStore = useProjectsStore()
    if (!projectsStore.loaded) await projectsStore.load()
    const names = new Map(projectsStore.projects.map((p) => [p.id, p.name]))
    const rows = await db.sessions.toArray()
    rows.sort(byDateDesc)
    const capped = Number.isFinite(limit) ? rows.slice(0, Math.max(0, limit)) : rows
    return capped.map((s) => ({ ...s, projectName: names.get(s.projectId) ?? '' }))
  }

  // Dernière ligne NON manuelle d'un projet, pour la décision fusion/split du chrono
  // journalisant (lot « séances live », 30/08). Frappe Dexie DIRECTEMENT, jamais la liste
  // réactive `sessions` : celle-ci porte le projet du dernier écran qui l'a chargée — le
  // chrono d'un AUTRE projet jugerait son écart sur des lignes qui ne sont pas les siennes.
  // « Dernière » au DERNIER CONTACT (`lastWriteAt`, rafraîchi à chaque commit du chrono,
  // repli sur `date` pour les lignes écrites avant ce lot) : c'est lui qui mesure la fenêtre
  // des 2 h, pas la naissance de la ligne. Un âge illisible trie comme ancien — le côté sûr
  // (split) reste décidé par adoptMergeTarget, pas par l'ordre de ce tri.
  async function lastChronoSession(pid) {
    const rows = await db.sessions
      .where('projectId')
      .equals(Number(pid))
      .filter((s) => !s.manual)
      .toArray()
    if (rows.length === 0) return null
    const contact = (s) => {
      const t = new Date(s.lastWriteAt || s.date).getTime()
      return Number.isFinite(t) ? t : 0
    }
    return rows.reduce((a, b) => (contact(b) > contact(a) ? b : a))
  }

  return {
    sessions,
    projectId,
    loadForProject,
    reload,
    add,
    update,
    remove,
    restore,
    secondsSince,
    allSessions,
    recentSessions,
    lastChronoSession,
  }
})

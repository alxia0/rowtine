// Compteurs multiples par projet — +/−, correction de valeur, ajout/suppression (PRD §7.9).
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, plain } from '@/db/db'
import { createLoadGuard } from '@/stores/load-guard'

export const useCountersStore = defineStore('counters', () => {
  const counters = ref([])
  const projectId = ref(null)

  // Tout compteur est un compteur de RANGS (value). Il peut porter, en option, un suivi
  // d'augmentations/diminutions (hasShaping) basé sur le même compte de rangs.
  //   target              : objectif de rangs (optionnel)
  //   hasShaping           : suivi augm/dim attaché
  //   shapingMode          : 'inc' | 'dec'
  //   interval             : un façonnage tous les X rangs
  //   shapingTarget        : objectif de façonnages (optionnel)
  //   stitchesPerShaping   : mailles ajoutées/diminuées à chaque façonnage (pour info)
  // Suivi de répétitions optionnel (PRD §7.6 « répéter les rangs x→y, Z fois ») :
  //   hasRepeat            : suivi de répétitions attaché
  //   repeatRows           : longueur d'un bloc à répéter (nb de rangs, ex. y−x+1)
  //   repeatTarget         : nombre total de répétitions visé (Z)
  // Migration douce (en mémoire) des anciens compteurs `type: 'shaping'` → hasShaping.
  function normalize(c) {
    if (c.type === 'shaping' && !c.hasShaping) {
      return { ...c, hasShaping: true, shapingTarget: c.shapingTarget ?? c.target ?? 0, target: 0 }
    }
    return c
  }
  // Jeton de rechargement (cf. `stores/load-guard.js`) : les boutons + et − des compteurs,
  // tapés en rafale, ne doivent jamais réafficher le compte d'avant l'appui suivant. Couvre
  // aussi le changement de projet (cf. le commentaire jumeau dans `stores/sections.js`).
  const loadGuard = createLoadGuard()
  function loadForProject(pid) {
    projectId.value = Number(pid)
    return loadGuard.run(async (isCurrent) => {
      const rows = await db.counters.where('projectId').equals(Number(pid)).toArray()
      if (!isCurrent()) return
      counters.value = rows.map(normalize)
    })
  }
  async function reload() {
    if (projectId.value != null) await loadForProject(projectId.value)
  }
  async function add(pid, name, extra = {}) {
    await db.counters.add({
      projectId: Number(pid),
      name: name || 'Compteur',
      value: 0,
      target: 0,
      hasShaping: false,
      shapingMode: 'inc',
      interval: 0,
      shapingTarget: 0,
      stitchesPerShaping: 0,
      hasRepeat: false,
      repeatRows: 0,
      repeatTarget: 0,
      ...plain(extra),
    })
    await loadForProject(pid)
  }
  async function setValue(id, value) {
    await db.counters.update(Number(id), { value: Math.max(0, Number(value) || 0) })
    await reload()
  }
  async function update(id, data) {
    await db.counters.update(Number(id), plain(data))
    await reload()
  }
  async function remove(id) {
    const c = await db.counters.get(Number(id))
    await db.counters.delete(Number(id))
    await reload()
    return c
  }
  async function restore(c) {
    await db.counters.put(c)
    await reload()
  }

  return { counters, projectId, loadForProject, reload, add, setValue, update, remove, restore }
})

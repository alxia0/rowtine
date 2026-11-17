// Stock d'outils — CRUD local (spec interne).
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db, plain } from '@/db/db'
import { createLoadGuard } from '@/stores/load-guard'
import { sizesFor, sizeScaleFor } from '@/constants/needle-sizes'
import { TOOL_TYPES, DPN_LENGTHS, TIP_LENGTHS } from '@/constants/tools'
import { cablesOf } from '@/utils/tool-list'

export function emptyTool(type = 'circular') {
  return {
    category: TOOL_TYPES[type]?.category || 'needle',
    type,
    sizeMm: null,
    lengthCm: null,
    lengthKind: '',
    dpnCount: null,
    tunisianKind: '',
    handle: '',
    kitSizes: [],
    kitCables: [],
    tunisian: false, // kit de crochets : tunisiens interchangeables, avec câbles
    material: '',
    brand: '',
    line: '',
    quantity: 1,
    purchasedAt: '',
    price: '',
    priceCurrency: '', // devise de ce prix ; vide = pas de prix, ou fiche d'avant (reprise au lancement)
    shop: '',
    storedIn: '',
    status: 'available',
    photos: [],
    coverIndex: 0,
    notes: '',
  }
}

function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// Câbles d'un kit écrits en objets `{ cm, join }` (nombres anciens acceptés), longueur au séparateur
// de la langue tolérée ; `cablesOf` trie et ramène un diamètre inconnu à `null`.
function cableObjects(list) {
  const rows = (Array.isArray(list) ? list : []).map((c) => (c !== null && typeof c === 'object' ? { cm: numOrNull(c.cm), join: c.join } : numOrNull(c)))
  return cablesOf({ kitCables: rows })
}

// Tailles d'un kit : seulement celles que le sélecteur de son type propose (échelle du type, au
// centième ; sous 2 mm, rien sauf un kit de crochets en acier), sinon un changement de type ou
// de matière laisserait des tailles enregistrées mais invisibles.
function kitSizesFor(tool, type) {
  const scale = sizeScaleFor(tool.type)
  const allowed = new Set(sizesFor(scale).filter((mm) => mm >= 2 || (type.tunisianFlag && tool.material === 'steel')).map((mm) => Math.round(mm * 100)))
  return sortedUniqueNumbers(tool.kitSizes).filter((mm) => allowed.has(Math.round(mm * 100)))
}

function sortedUniqueNumbers(list) {
  return [...new Set((list || []).map(numOrNull).filter((n) => n != null))].sort((a, b) => a - b)
}

// Remet à vide tout champ que le type n'utilise pas : changer le type dans le formulaire ne
// doit pas laisser une longueur de câble sur un crochet ou des tailles de kit sur une
// circulaire. Les champs communs (matière, achat, photos…) ne sont jamais touchés.
export function normalizeTool(tool) {
  const def = TOOL_TYPES[tool.type] || TOOL_TYPES.circular
  const isKit = def.size === 'kit'
  const usesLengthCm = def.length === 'straight' || def.length === 'circular' || def.length === 'cable' || def.length === 'free'
  // La longueur nommée n'est gardée que si elle appartient à la liste du type : « chaussette »
  // d'un jeu de DP ne devient pas la longueur des pointes d'un kit. « standard » est dans les
  // deux listes et reste donc d'un type à l'autre.
  const lengthKinds = def.length === 'dpn' ? DPN_LENGTHS : def.length === 'tip' ? TIP_LENGTHS : []
  return {
    ...tool,
    category: def.category,
    sizeMm: def.size === 'required' || def.size === 'optional' ? numOrNull(tool.sizeMm) : null,
    lengthCm: usesLengthCm ? numOrNull(tool.lengthCm) : null,
    lengthKind: lengthKinds.includes(tool.lengthKind) ? tool.lengthKind : '',
    dpnCount: def.count ? numOrNull(tool.dpnCount) : null,
    tunisianKind: def.tunisianKind ? tool.tunisianKind || '' : '',
    handle: def.handle ? tool.handle || '' : '',
    kitSizes: isKit ? kitSizesFor(tool, def) : [],
    // Les câbles gardent leurs doublons : deux câbles de 20 cm s'écrivent deux entrées { cm: 20, join }.
    // Un kit de crochets n'a de câbles que s'il est tunisien interchangeable.
    tunisian: def.tunisianFlag ? !!tool.tunisian : false,
    kitCables: isKit && (!def.tunisianFlag || tool.tunisian) ? cableObjects(tool.kitCables) : [],
  }
}

export const useToolsStore = defineStore('tools', () => {
  const tools = ref([])
  const loaded = ref(false)
  // Même jeton de rechargement que le stock de laine (cf. stores/load-guard.js).
  const loadGuard = createLoadGuard()
  function load() {
    return loadGuard.run(async (isCurrent) => {
      const rows = await db.tools.orderBy('id').reverse().toArray()
      if (!isCurrent()) return
      tools.value = rows
      loaded.value = true
    })
  }
  async function add(data) {
    const id = await db.tools.add(normalizeTool({ ...emptyTool(data?.type), ...plain(data) }))
    await load()
    return id
  }
  async function update(id, data) {
    const current = await db.tools.get(Number(id))
    // Outil disparu entre-temps (restauration, suppression) : ne rien écrire, sinon `put` le
    // ressusciterait ou créerait une ligne fantôme sans type.
    if (!current) return
    await db.tools.put(normalizeTool({ ...current, ...plain(data), id: Number(id) }))
    await load()
  }
  async function remove(id) {
    const t = await db.tools.get(Number(id))
    await db.tools.delete(Number(id))
    await load()
    return t
  }
  async function restore(t) {
    await db.tools.put(t)
    await load()
  }
  return { tools, loaded, load, add, update, remove, restore }
})

export async function refreshToolsIfLoaded() {
  const store = useToolsStore()
  if (store.loaded) await store.load()
}

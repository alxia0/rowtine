// Liste « Mes outils » : regroupements et filtre, en JS pur (testés seuls).
import { TOOL_TYPES, TOOL_TYPE_ORDER, CABLE_JOINS } from '@/constants/tools'
import { sizeScaleFor, sizeEquivalents, KNITTING_SIZES, HOOK_SIZES, STEEL_HOOK_SIZES } from '@/constants/needle-sizes'
import { parseDecimal } from '@/utils/decimal'

const bySize = (a, b) => (toolSizes(a)[0] ?? Infinity) - (toolSizes(b)[0] ?? Infinity)

const sortedUnique = (list) => [...new Set((list || []).map(Number))].sort((a, b) => a - b)

export function toolSizes(tool) {
  if (TOOL_TYPES[tool.type]?.size === 'kit') return sortedUnique(tool.kitSizes)
  return tool.sizeMm == null || tool.sizeMm === '' ? [] : [Number(tool.sizeMm)]
}

const joinRank = (join) => (join == null ? CABLE_JOINS.length : CABLE_JOINS.indexOf(join))
export const cableSort = (a, b) => a.cm - b.cm || joinRank(a.join) - joinRank(b.join)

// Seul lecteur de `kitCables` : une ligne ancienne (nombres) et une nouvelle (objets `{ cm, join }`)
// se lisent pareil. `join` : 's' | 'l' | 'mini' | null (non précisé, ou valeur inconnue). Triés par
// longueur, puis S, L, Mini, non précisé ; doublons gardés (un élément par exemplaire).
export function cablesOf(tool) {
  const list = Array.isArray(tool?.kitCables) ? tool.kitCables : []
  const out = []
  for (const raw of list) {
    const obj = raw !== null && typeof raw === 'object'
    const value = obj ? raw.cm : raw
    if (value == null || value === '') continue
    const cm = Number(value)
    if (!Number.isFinite(cm)) continue
    out.push({ cm, join: obj && CABLE_JOINS.includes(raw.join) ? raw.join : null })
  }
  return out.sort(cableSort)
}

// Câbles d'un kit, un par exemplaire (doublons gardés) ; aucun hors kit.
export function toolCables(tool) {
  return TOOL_TYPES[tool.type]?.size === 'kit' ? cablesOf(tool) : []
}

// Les mêmes câbles regroupés par couple (longueur, diamètre) : [{ cm, join, count }], dans l'ordre de `cablesOf`.
export function cableCounts(tool) {
  const groups = []
  for (const c of toolCables(tool)) {
    const last = groups[groups.length - 1]
    if (last && last.cm === c.cm && last.join === c.join) last.count += 1
    else groups.push({ cm: c.cm, join: c.join, count: 1 })
  }
  return groups
}

// Libellé d'un câble : « 80 cm », « 80 cm S », « 80 cm L », « 80 cm Mini ». Les lettres ne se traduisent pas.
export function cableLabel({ cm, join }, t, num = String) {
  const base = t('tools.lengthCm', { cm: num(cm) })
  return join ? `${base} ${join === 'mini' ? 'Mini' : join.toUpperCase()}` : base
}

// Libellé d'un groupe de câbles identiques : « 20 cm S ×2 » (« 20 cm S » pour un seul exemplaire).
export function cableCountLabel(cable, count, t, num = String) {
  const label = cableLabel(cable, t, num)
  return count > 1 ? `${label} ×${count}` : label
}

// Valeur d'un câble dans un menu : la paire « 80|s » (« 80| » sans diamètre), jamais un simple nombre.
export const cableValue = ({ cm, join }) => `${cm}|${join ?? ''}`
export function parseCableValue(value) {
  const [cm, join = ''] = String(value ?? '').split('|')
  if (cm === '' || !Number.isFinite(Number(cm))) return null
  return { cm: Number(cm), join: CABLE_JOINS.includes(join) ? join : null }
}

export function ownedSizes(tools) {
  return [...new Set(tools.flatMap(toolSizes))].sort((a, b) => a - b)
}

export function filterTools(tools, { sizeMm = null, query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return tools.filter((tool) => {
    if (sizeMm != null && !toolSizes(tool).includes(Number(sizeMm))) return false
    if (!q) return true
    const haystack = [tool.brand, tool.line, tool.notes, tool.storedIn].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(q)
  })
}

export function groupByType(tools) {
  return TOOL_TYPE_ORDER.map((type) => ({
    key: type,
    category: TOOL_TYPES[type].category,
    items: tools.filter((tool) => tool.type === type).sort(bySize),
  })).filter((g) => g.items.length)
}

export function groupBySize(tools) {
  const groups = ownedSizes(tools).map((mm) => ({
    key: `size:${mm}`,
    sizeMm: mm,
    items: tools
      .filter((tool) => toolSizes(tool).includes(mm))
      .map((tool) => ({ tool, viaKit: TOOL_TYPES[tool.type]?.size === 'kit' }))
      .sort((a, b) => Number(a.viaKit) - Number(b.viaKit)),
  }))
  const cables = tools.filter((tool) => tool.type === 'cable')
  const nosize = tools.filter((tool) => tool.type !== 'cable' && !toolSizes(tool).length)
  if (cables.length) groups.push({ key: 'cables', sizeMm: null, items: cables.map((tool) => ({ tool, viaKit: false })) })
  if (nosize.length) groups.push({ key: 'nosize', sizeMm: null, items: nosize.map((tool) => ({ tool, viaKit: false })) })
  return groups
}

export function toolSizeParts(tool, sizeMm) {
  const mm = sizeMm ?? toolSizes(tool)[0] ?? null
  if (mm == null) return { mm: null, us: null }
  return { mm, us: sizeEquivalents(mm, sizeScaleFor(tool.type), tool.material).us }
}

// Texte de taille d'un outil, tel que ToolRow le met en titre et ExpensesView dans son libellé :
// intervalle pour un kit hors regroupement par taille, sinon « mm · équivalent ». '' si l'outil
// n'a pas de taille. `t` et `num` (formatage d'un nombre à la locale) viennent de l'appelant.
export function toolSizeText(tool, t, num, sizeMm = null) {
  if (TOOL_TYPES[tool.type]?.size === 'kit' && sizeMm == null) {
    const sizes = toolSizes(tool)
    if (sizes.length > 1) return t('tools.sizeRange', { min: num(sizes[0]), max: num(sizes[sizes.length - 1]) })
  }
  const { mm, us } = toolSizeParts(tool, sizeMm ?? undefined)
  if (mm == null) return ''
  if (us == null) return t('tools.sizeMm', { mm: num(mm) })
  return t(sizeTemplateKey(tool.type, us), { mm: num(mm), us })
}

// Clé de gabarit d'une taille « mm + équivalent » (`option` : forme de menu entre parenthèses,
// sinon forme de ligne). Une aiguille, ou un crochet dont l'équivalent est un nombre nu
// (acier « 8 », « 7 »), prend le gabarit « US {us} » : sans lui on lirait « 1,5 mm · 8 ».
// Un équivalent à lettres (« G-6 ») garde le gabarit sans préfixe. Le gabarit se lit sur
// l'équivalent lui-même : la matière (qui choisit numéro acier ou lettre) n'a pas à être passée.
export function sizeTemplateKey(type, us, { option = false } = {}) {
  const usLabelled = sizeScaleFor(type) === 'knitting' || !/\p{L}/u.test(String(us))
  if (option) return usLabelled ? 'tools.form.sizeOption' : 'tools.form.sizeOptionHook'
  // `sizeLine` et `sizeLineHook` : textes différents (préfixe « US » ou non) mais identiques d'une langue à
  // l'autre ; deux clés distinctes, aucune fusion possible entre elles.
  return usLabelled ? 'tools.sizeLine' : 'tools.sizeLineHook'
}

// Taille de projet absente du stock : compare ce que la fiche demande (saisie libre) à ce que
// possèdent les outils. Aucune comparaison tant que le stock est vide (anti-objectif : ne rien
// signaler à qui n'a jamais ouvert « Mes outils »).
export const OWNED_STATUSES = ['available', 'damaged', 'replace']

export const cents = (mm) => Math.round(mm * 100)
// Un outil sert une technique de projet selon l'échelle de ses tailles (crochet ou tricot), pas
// selon sa seule catégorie : un kit de crochets sert le crochet, un kit d'aiguilles le tricot.
// Même périmètre qu'avant (aiguilles, kits, crochets) ; seule l'échelle de taille départage les kits.
const SIZED_CATEGORIES = ['needle', 'kit', 'hook']
export const servesTechnique = (tool, technique) =>
  SIZED_CATEGORIES.includes(TOOL_TYPES[tool.type]?.category) &&
  sizeScaleFor(tool.type) === (technique === 'crochet' ? 'hook' : 'knitting')

// Numéro US seul : exact en tricot ; en crochet aussi la lettre (« G ») ou le numéro (« 6 ») d'un « G-6 ».
// Retenu seulement si une seule taille correspond.
function mmFromUs(us, technique) {
  const wanted = String(us ?? '').trim().toUpperCase()
  if (!wanted) return null
  const table = technique === 'crochet' ? HOOK_SIZES : KNITTING_SIZES
  // Crochet : un numéro nu (sans lettre) existe aussi en acier, on ne devine pas la matière.
  if (technique === 'crochet' && !/\p{L}/u.test(wanted) && STEEL_HOOK_SIZES.some((r) => r.us != null && String(r.us) === wanted)) return null
  const hits = new Set()
  for (const row of table) {
    if (row.us == null) continue
    const value = String(row.us).toUpperCase()
    let match = value === wanted
    if (!match && technique === 'crochet') {
      const [letters, number] = value.split('-')
      match = number != null && (letters.split('/').includes(wanted) || number === wanted)
    }
    if (match) hits.add(row.mm)
  }
  return hits.size === 1 ? [...hits][0] : null
}

export function requestedSizeMm(entry, technique) {
  const raw = String(entry?.mm ?? '').trim().replace(/\s*mm$/i, '')
  if (raw) {
    // Saisie non vide mais illisible : ignorée, jamais remplacée par le numéro US.
    const n = parseDecimal(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return mmFromUs(entry?.us, technique)
}

export function missingSizes(entries, tools, technique) {
  if (!tools.length) return []
  const owned = new Set(
    tools
      .filter((tool) => servesTechnique(tool, technique) && (!tool.status || OWNED_STATUSES.includes(tool.status)))
      .flatMap(toolSizes)
      .map(cents),
  )
  const missing = new Map()
  for (const entry of entries || []) {
    const mm = requestedSizeMm(entry, technique)
    if (mm != null && !owned.has(cents(mm)) && !missing.has(cents(mm))) missing.set(cents(mm), mm)
  }
  return [...missing.values()].sort((a, b) => a - b)
}

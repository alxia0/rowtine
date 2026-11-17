// Stock d'outils (14/11/2026) — clés internes STABLES, traduites à l'affichage
// (`tools.types.*`, `tools.materials.*`…). Ne jamais stocker un libellé traduit.

export const TOOL_CATEGORIES = ['needle', 'kit', 'hook']

// `size` : 'required' | 'optional' | 'none' | 'kit' (tailles cochées dans le kit).
// `tunisianFlag` : kit de crochets, dont la case « tunisien interchangeable » commande les câbles.
// `length` : liste fermée à proposer ('straight', 'circular', 'cable', 'dpn', 'tip'), saisie libre
// en cm ('free') ou aucun champ (null).
export const TOOL_TYPES = {
  straight: { category: 'needle', icon: 'tool-straight', size: 'required', length: 'straight' },
  circular: { category: 'needle', icon: 'tool-circular', size: 'required', length: 'circular' },
  dpn: { category: 'needle', icon: 'tool-dpn', size: 'required', length: 'dpn', count: true },
  tips: { category: 'needle', icon: 'tool-kit', size: 'required', length: 'tip' },
  cable: { category: 'needle', icon: 'tool-cable', size: 'none', length: 'cable' },
  flexible: { category: 'needle', icon: 'tool-straight', size: 'required', length: 'free' },
  other: { category: 'needle', icon: 'tool-straight', size: 'optional', length: null },
  interchangeable: { category: 'kit', icon: 'tool-kit', size: 'kit', length: 'tip' },
  hookKit: { category: 'kit', icon: 'tool-hook', size: 'kit', length: null, handle: true, tunisianFlag: true },
  standard: { category: 'hook', icon: 'tool-hook', size: 'required', length: null, handle: true },
  tunisian: { category: 'hook', icon: 'tool-tunisian', size: 'required', length: 'free', handle: true, tunisianKind: true },
}

export const TOOL_TYPE_ORDER = ['straight', 'circular', 'dpn', 'flexible', 'tips', 'cable', 'other', 'interchangeable', 'hookKit', 'standard', 'tunisian']

export const MATERIALS = ['wood', 'bamboo', 'aluminium', 'steel', 'brass', 'nickel', 'carbon', 'plastic', 'glass', 'other']
export const HANDLES = ['classic', 'ergonomic', 'rubber', 'beaded']
export const TOOL_STATUSES = ['available', 'lent', 'lost', 'damaged', 'replace']
export const STRAIGHT_LENGTHS_CM = [25, 30, 35, 40]
export const CIRCULAR_LENGTHS_CM = [40, 50, 60, 80, 100, 120, 150]
// Câble seul et câbles d'un kit : la longueur écrite sur l'étiquette de la marque (câble seul
// chez ChiaoGoo, aiguille montée chez KnitPro/addi), sans conversion.
export const CABLE_LENGTHS_CM = [13, 15, 20, 35, 40, 50, 55, 60, 75, 80, 93, 100, 120, 125, 150]
// Diamètre de la fixation d'un câble de kit (clés de donnée, jamais affichées telles quelles : le
// libellé passe par `cableLabel`). Ordre d'affichage : S et L d'abord, les plus courants.
export const CABLE_JOINS = ['s', 'l', 'mini']
export const DPN_LENGTHS = ['sock', 'standard']
export const TIP_LENGTHS = ['mini', 'short', 'standard']
export const TUNISIAN_KINDS = ['fixed', 'cabled']

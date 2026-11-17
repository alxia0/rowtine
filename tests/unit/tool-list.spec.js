// Protège les regroupements « par type » / « par taille » (kits compris) et le filtre de la liste d'outils.
import { describe, it, expect } from 'vitest'
import { emptyTool } from '@/stores/tools'
import { toolSizes, toolCables, cableCounts, cablesOf, cableLabel, cableCountLabel, cableValue, parseCableValue, ownedSizes, filterTools, groupByType, groupBySize, toolSizeParts, sizeTemplateKey, missingSizes, requestedSizeMm, OWNED_STATUSES } from '@/utils/tool-list'

const t = (type, extra) => ({ ...emptyTool(type), ...extra })
const circ4 = t('circular', { id: 1, sizeMm: 4, lengthCm: 80, brand: 'ChiaoGoo' })
const kit = t('interchangeable', { id: 2, kitSizes: [3.5, 4, 5], brand: 'KnitPro', line: 'Zing' })
const hook5 = t('standard', { id: 3, sizeMm: 5 })
const cable = t('cable', { id: 4, lengthCm: 60 })
const other = t('other', { id: 5, notes: 'aiguille à torsades' })
const rangee = t('circular', { id: 7, sizeMm: 3, storedIn: 'Tiroir bleu' })

describe('tool-list', () => {
  it('toolSizes : taille unique, tailles du kit, aucune pour un câble', () => {
    expect(toolSizes(circ4)).toEqual([4])
    expect(toolSizes(kit)).toEqual([3.5, 4, 5])
    expect(toolSizes(cable)).toEqual([])
  })

  // Protège la lecture des câbles d'un kit, partagée par l'export et la fiche outil.
  it('toolCables et cableCounts : câbles du kit triés, doublons gardés, aucun hors kit', () => {
    expect(toolCables(t('interchangeable', { kitCables: [80, '60', 80] }))).toEqual([{ cm: 60, join: null }, { cm: 80, join: null }, { cm: 80, join: null }])
    expect(cableCounts(t('interchangeable', { kitCables: [35, 20, 20] }))).toEqual([{ cm: 20, join: null, count: 2 }, { cm: 35, join: null, count: 1 }])
    expect(cableCounts(circ4)).toEqual([])
    expect(toolCables(t('interchangeable', {}))).toEqual([])
    expect(toolCables(circ4)).toEqual([])
  })
  // Protège la lecture unique des câbles : ancienne ligne (nombres) et nouvelle (objets) se lisent pareil.
  it('cablesOf : nombres et objets, triés par longueur puis S, L, Mini, non précisé', () => {
    expect(cablesOf({ type: 'interchangeable', kitCables: [80, 20, 80] })).toEqual([{ cm: 20, join: null }, { cm: 80, join: null }, { cm: 80, join: null }])
    const mixed = [{ cm: 80, join: null }, { cm: 80, join: 'mini' }, { cm: 80, join: 'l' }, { cm: 80, join: 's' }, { cm: 20, join: 'l' }]
    expect(cablesOf({ kitCables: mixed })).toEqual([
      { cm: 20, join: 'l' }, { cm: 80, join: 's' }, { cm: 80, join: 'l' }, { cm: 80, join: 'mini' }, { cm: 80, join: null },
    ])
    expect(cablesOf({ kitCables: [{ cm: '60', join: 'x' }, null, 'abc'] })).toEqual([{ cm: 60, join: null }])
    expect(cablesOf({})).toEqual([])
    expect(cablesOf(null)).toEqual([])
  })
  it('cableCounts : un 80 S et un 80 L restent deux entrées', () => {
    const kitS = t('interchangeable', { kitCables: [{ cm: 80, join: 'l' }, { cm: 80, join: 's' }, { cm: 80, join: 's' }] })
    expect(cableCounts(kitS)).toEqual([{ cm: 80, join: 's', count: 2 }, { cm: 80, join: 'l', count: 1 }])
  })
  it('cableLabel : la lettre suit la longueur, jamais la clé brute seule', () => {
    const tr = (key, p) => `${key}:${p.cm}`
    const num = (n) => String(n)
    expect(cableLabel({ cm: 80, join: null }, tr, num)).toBe('tools.lengthCm:80')
    expect(cableLabel({ cm: 80, join: 's' }, tr, num)).toBe('tools.lengthCm:80 S')
    expect(cableLabel({ cm: 80, join: 'l' }, tr, num)).toBe('tools.lengthCm:80 L')
    expect(cableLabel({ cm: 80, join: 'mini' }, tr, num)).toBe('tools.lengthCm:80 Mini')
  })
  it('cableCountLabel : « ×n » après le libellé quand il y a plusieurs exemplaires', () => {
    const tr = (key, p) => `${p.cm} cm`
    expect(cableCountLabel({ cm: 20, join: 's' }, 2, tr)).toBe('20 cm S ×2')
    expect(cableCountLabel({ cm: 20, join: null }, 1, tr)).toBe('20 cm')
  })
  it('cableValue / parseCableValue : la paire fait l’aller-retour', () => {
    expect(cableValue({ cm: 80, join: 's' })).toBe('80|s')
    expect(cableValue({ cm: 80, join: null })).toBe('80|')
    expect(parseCableValue('80|s')).toEqual({ cm: 80, join: 's' })
    expect(parseCableValue('80|')).toEqual({ cm: 80, join: null })
    expect(parseCableValue('80')).toEqual({ cm: 80, join: null })
    expect(parseCableValue('')).toBeNull()
  })
  it('ownedSizes fusionne et trie', () => {
    expect(ownedSizes([circ4, kit, hook5, cable])).toEqual([3.5, 4, 5])
  })
  it('filterTools par taille retient la circulaire ET le kit qui contient 4 mm', () => {
    expect(filterTools([circ4, kit, hook5], { sizeMm: 4 }).map((x) => x.id)).toEqual([1, 2])
  })
  it('filterTools par texte cherche marque, gamme, notes et rangement', () => {
    expect(filterTools([circ4, kit, other], { query: 'zing' }).map((x) => x.id)).toEqual([2])
    expect(filterTools([circ4, kit, other], { query: 'TORSADES' }).map((x) => x.id)).toEqual([5])
    expect(filterTools([circ4, kit, rangee], { query: 'tiroir' }).map((x) => x.id)).toEqual([7])
  })
  it('groupByType suit TOOL_TYPE_ORDER et trie chaque groupe par taille', () => {
    const c3 = t('circular', { id: 6, sizeMm: 3 })
    const groups = groupByType([hook5, circ4, kit, c3])
    expect(groups.map((g) => g.key)).toEqual(['circular', 'interchangeable', 'standard'])
    expect(groups[0].items.map((x) => x.id)).toEqual([6, 1])
  })
  it('groupBySize place un kit sous chacune de ses tailles, câbles et sans-taille à la fin', () => {
    const groups = groupBySize([circ4, kit, hook5, cable, other])
    expect(groups.map((g) => g.key)).toEqual(['size:3.5', 'size:4', 'size:5', 'cables', 'nosize'])
    const g4 = groups.find((g) => g.key === 'size:4')
    expect(g4.items.map((i) => [i.tool.id, i.viaKit])).toEqual([[1, false], [2, true]])
    expect(groups.find((g) => g.key === 'cables').items.map((i) => i.tool.id)).toEqual([4])
    expect(groups.find((g) => g.key === 'nosize').items.map((i) => i.tool.id)).toEqual([5])
  })
  it('groupBySize range l outil seul avant le kit, même si le kit est saisi en premier', () => {
    const g4 = groupBySize([kit, circ4]).find((g) => g.key === 'size:4')
    expect(g4.items.map((i) => [i.tool.id, i.viaKit])).toEqual([[1, false], [2, true]])
  })
  it('groupBySize : un kit de crochets figure sous chacune de ses tailles, marqué viaKit', () => {
    const hk = t('hookKit', { id: 9, kitSizes: [4, 5] })
    const g = groupBySize([circ4, hk])
    expect(g.map((x) => x.key)).toEqual(['size:4', 'size:5'])
    expect(g[0].items.map((i) => [i.tool.id, i.viaKit])).toEqual([[1, false], [9, true]])
  })
  it('toolSizeParts : US tricot pour une aiguille, lettre pour un crochet', () => {
    expect(toolSizeParts(circ4)).toEqual({ mm: 4, us: '6' })
    expect(toolSizeParts(hook5)).toEqual({ mm: 5, us: 'H-8' })
    expect(toolSizeParts(kit, 4)).toEqual({ mm: 4, us: '6' })
    expect(toolSizeParts(cable)).toEqual({ mm: null, us: null })
  })
})

describe('sizeTemplateKey', () => {
  it('aiguille ou équivalent numérique : gabarit avec « US », ligne comme menu', () => {
    expect(sizeTemplateKey('circular', '6')).toBe('tools.sizeLine')
    expect(sizeTemplateKey('standard', '8')).toBe('tools.sizeLine')
    expect(sizeTemplateKey('standard', '8', { option: true })).toBe('tools.form.sizeOption')
  })
  it('équivalent à lettres (G-6) : gabarit sans préfixe', () => {
    expect(sizeTemplateKey('standard', 'G-6')).toBe('tools.sizeLineHook')
    expect(sizeTemplateKey('standard', 'G-6', { option: true })).toBe('tools.form.sizeOptionHook')
  })
})

// Protège le calcul des tailles de projet absentes du stock (saisie libre, kits, états, stock vide).
describe('missingSizes', () => {
  const stock = [t('circular', { id: 1, sizeMm: 4.5 })]
  it('stock vide : jamais de manque', () => {
    expect(missingSizes([{ mm: '4' }], [], 'knitting')).toEqual([])
  })
  it('saisie « 4,5 » et « 4 mm » retrouvent la fiche', () => {
    expect(missingSizes([{ mm: '4,5' }], stock, 'knitting')).toEqual([])
    expect(missingSizes([{ mm: '4 mm' }], [t('circular', { id: 2, sizeMm: 4 })], 'knitting')).toEqual([])
  })
  it('une taille de kit compte en tricot', () => {
    expect(missingSizes([{ mm: '4' }], [t('interchangeable', { id: 3, kitSizes: [4] })], 'knitting')).toEqual([])
  })
  it('crochet : seuls les crochets comptent ; tricot : les crochets ne comptent pas', () => {
    expect(missingSizes([{ mm: '4' }], [t('straight', { id: 4, sizeMm: 4 })], 'crochet')).toEqual([4])
    expect(missingSizes([{ mm: '4' }], [t('standard', { id: 5, sizeMm: 4 })], 'knitting')).toEqual([4])
    expect(missingSizes([{ mm: '4' }], [t('standard', { id: 5, sizeMm: 4 })], 'crochet')).toEqual([])
  })
  // Un kit compte selon l'échelle de ses tailles : jamais des crochets pour du tricot, ni l'inverse.
  it('kit de crochets : compte en crochet, pas en tricot ; kit d\'aiguilles : l\'inverse', () => {
    const hookKit = t('hookKit', { id: 8, kitSizes: [4] })
    const needleKit = t('interchangeable', { id: 9, kitSizes: [4] })
    expect(missingSizes([{ mm: '4' }], [hookKit], 'crochet')).toEqual([])
    expect(missingSizes([{ mm: '4' }], [hookKit], 'knitting')).toEqual([4])
    expect(missingSizes([{ mm: '4' }], [needleKit], 'crochet')).toEqual([4])
    expect(missingSizes([{ mm: '4' }], [needleKit], 'knitting')).toEqual([])
  })
  it('perdu ou prêté ne compte pas, abîmé si', () => {
    for (const status of ['lost', 'lent']) {
      expect(missingSizes([{ mm: '4' }], [t('circular', { id: 6, sizeMm: 4, status })], 'knitting')).toEqual([4])
    }
    expect(missingSizes([{ mm: '4' }], [t('circular', { id: 6, sizeMm: 4, status: 'damaged' })], 'knitting')).toEqual([])
    expect(OWNED_STATUSES).toEqual(['available', 'damaged', 'replace'])
  })
  it('saisie illisible ou vide ignorée', () => {
    expect(missingSizes([{ mm: 'abc' }, { mm: '', us: '' }, {}], stock, 'knitting')).toEqual([])
  })
  it('numéro US seul converti (tricot 6, crochet G-6, G, 6), ambigu ignoré', () => {
    expect(requestedSizeMm({ mm: '', us: '6' }, 'knitting')).toBe(4)
    expect(requestedSizeMm({ mm: '', us: 'G-6' }, 'crochet')).toBe(4)
    expect(requestedSizeMm({ mm: '', us: 'G' }, 'crochet')).toBe(4)
    expect(requestedSizeMm({ mm: '', us: '16' }, 'crochet')).toBe(12)
    expect(requestedSizeMm({ mm: '', us: 'N' }, 'crochet')).toBeNull()
    expect(requestedSizeMm({ mm: '', us: 'zz' }, 'knitting')).toBeNull()
    expect(missingSizes([{ mm: '', us: '6' }], stock, 'knitting')).toEqual([4])
  })
  it('égalité au centième, résultat croissant sans doublon', () => {
    expect(missingSizes([{ mm: '3,75' }], [t('circular', { id: 7, sizeMm: 3.75 })], 'knitting')).toEqual([])
    expect(missingSizes([{ mm: '5' }, { mm: '3,5' }, { mm: '5.0' }], stock, 'knitting')).toEqual([3.5, 5])
  })
  it('mm non vide mais illisible : jamais de repli sur le US', () => {
    expect(requestedSizeMm({ mm: '3.5-4', us: '6' }, 'knitting')).toBeNull()
  })
  it('outil sans statut : possédé', () => {
    const { status, ...bare } = t('circular', { id: 8, sizeMm: 4 })
    expect(status).toBe('available')
    expect(missingSizes([{ mm: '4' }], [bare], 'knitting')).toEqual([])
  })
  it('crochet : numéro nu aussi dans la table acier = ambigu, ignoré', () => {
    expect(requestedSizeMm({ mm: '', us: '6' }, 'crochet')).toBeNull()
    expect(requestedSizeMm({ mm: '', us: '7' }, 'crochet')).toBeNull()
    expect(requestedSizeMm({ mm: '', us: '16' }, 'crochet')).toBe(12)
  })
  it('dédoublonnage au centième', () => {
    expect(missingSizes([{ mm: '4,5' }, { mm: '4,501' }], [t('circular', { id: 9, sizeMm: 3 })], 'knitting')).toHaveLength(1)
  })
})

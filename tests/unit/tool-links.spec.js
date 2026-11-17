// Unitaire — liens outil <-> projet : fonctions pures (orphelins ignorés, « en cours », tri de la feuille).
import { describe, it, expect } from 'vitest'
import { linkedTools, projectsUsingTool, inUseProjectName, pickerOrder, pruneToolIds, kitPicksOf, kitTakenSizes, kitCableUse, pruneKitPicks, kitTakenLive, kitPickerSizes, kitPickerCables, linkedKitPicks, parkedOf, parkEntries, parkedEntries, relinkPatch } from '@/utils/tool-links'

const circ4 = { id: 1, type: 'circular', sizeMm: 4 }
const circ5 = { id: 2, type: 'circular', sizeMm: 5 }
const kit = { id: 3, type: 'interchangeable', kitSizes: [3.5, 4, 4.5] }
const tools = [circ4, circ5, kit]

describe('linkedTools', () => {
  it('filtre les ids orphelins et garde l’ordre de toolIds', () => {
    expect(linkedTools({ toolIds: [3, 99, 1] }, tools)).toEqual([kit, circ4])
  })
  it('un projet sans toolIds se lit comme vide', () => {
    expect(linkedTools({}, tools)).toEqual([])
  })
})

describe('projectsUsingTool / inUseProjectName', () => {
  const projects = [
    { id: 1, status: 'done', toolIds: [1], name: 'Fini' },
    { id: 2, status: 'pause', toolIds: [1], name: 'En pause' },
    { id: 3, status: 'wip', toolIds: [2], name: 'Bonnet' },
    { id: 4, status: 'wip' },
    { id: 5, status: 'wip', toolIds: [2, 3], name: 'Écharpe' },
    { id: 6, status: 'wip', toolIds: [6], name: '  ' },
  ]
  it('liste les projets qui portent l’outil', () => {
    expect(projectsUsingTool(1, projects).map((p) => p.id)).toEqual([1, 2])
    expect(projectsUsingTool(7, projects)).toEqual([])
  })
  it('« en cours » seulement pour un projet wip', () => {
    expect(inUseProjectName(1, projects)).toBe(null)
    expect(inUseProjectName(7, projects)).toBe(null)
  })
  it('nomme le premier projet wip dans l’ordre de la liste', () => {
    expect(inUseProjectName(2, projects)).toBe('Bonnet')
    expect(inUseProjectName(3, projects)).toBe('Écharpe')
  })
  it('un projet wip sans nom rend une chaîne vide, pas null', () => {
    expect(inUseProjectName(6, projects)).toBe('')
  })
})

describe('pickerOrder', () => {
  const hook4 = { id: 4, type: 'standard', sizeMm: 4 }
  const circ375 = { id: 5, type: 'circular', sizeMm: 3.75 }
  it('met en tête les outils (kits compris) aux tailles demandées', () => {
    const { matching, others } = pickerOrder(tools, [4], 'knitting')
    expect(matching).toEqual([circ4, kit])
    expect(others).toEqual([circ5])
  })
  it('sans taille demandée, tout est dans others', () => {
    expect(pickerOrder(tools, [], 'knitting')).toEqual({ matching: [], others: tools })
  })
  it('projet tricot 4 mm : un crochet 4 mm va dans others', () => {
    const { matching, others } = pickerOrder([circ4, hook4], [4], 'knitting')
    expect(matching).toEqual([circ4])
    expect(others).toEqual([hook4])
  })
  it('projet crochet 4 mm : une circulaire 4 mm va dans others', () => {
    const { matching, others } = pickerOrder([circ4, hook4], [4], 'crochet')
    expect(matching).toEqual([hook4])
    expect(others).toEqual([circ4])
  })
  it('un kit qui contient la taille est en tête en tricot', () => {
    expect(pickerOrder([kit], [4], 'knitting').matching).toEqual([kit])
  })
  it('un kit de crochets est en tête d\'un projet crochet à l\'une de ses tailles, et non d\'un projet tricot', () => {
    const hookKit = { id: 8, type: 'hookKit', kitSizes: [4, 5] }
    const needleKit = { id: 3, type: 'interchangeable', kitSizes: [4] }
    expect(pickerOrder([hookKit, needleKit], [4], 'crochet')).toEqual({ matching: [hookKit], others: [needleKit] })
    expect(pickerOrder([hookKit, needleKit], [4], 'knitting')).toEqual({ matching: [needleKit], others: [hookKit] })
  })
  it('3,75 correspond à une demande « 3.75 » au centième', () => {
    expect(pickerOrder([circ375], ['3.75'], 'knitting').matching).toEqual([circ375])
    expect(pickerOrder([circ375], [3.7500000001], 'knitting').matching).toEqual([circ375])
  })
})

describe('pruneToolIds', () => {
  it('garde les ids présents, sans doublon', () => {
    expect(pruneToolIds([1, 1, 99], [{ id: 1 }])).toEqual([1])
  })
  it('convertit en nombres les ids reçus en chaîne (valeur de case à cocher)', () => {
    expect(pruneToolIds(['2', 1, '1', '99'], [{ id: 1 }, { id: 2 }])).toEqual([2, 1])
  })
  it('tolère une valeur absente', () => {
    expect(pruneToolIds(undefined, [{ id: 1 }])).toEqual([])
  })
})

describe('prises de kit', () => {
  const zing = { id: 3, type: 'interchangeable', kitSizes: [4, 5], kitCables: [80, 80, 100] }
  const projects = [
    { id: 1, status: 'wip', name: 'Bonnet', kitPicks: [{ toolId: 3, sizeMm: 4, cableCm: 80 }] },
    { id: 2, status: 'done', name: 'Fini', kitPicks: [{ toolId: 3, sizeMm: 5, cableCm: 100 }] },
    { id: 3, status: 'wip', name: ' Pull ', kitPicks: [{ toolId: 3, sizeMm: 5, cableCm: null }, { toolId: 9, sizeMm: 3, cableCm: null }] },
    { id: 4, status: 'wip' },
    { id: 5, status: 'pause', name: 'Repos', kitPicks: [{ toolId: 3, sizeMm: 4, cableCm: 80 }] },
  ]
  it('kitPicksOf : champ absent ou invalide se lit comme vide', () => {
    expect(kitPicksOf({})).toEqual([])
    expect(kitPicksOf({ kitPicks: 'x' })).toEqual([])
    expect(kitPicksOf(projects[0])).toHaveLength(1)
  })
  it('kitTakenSizes ignore un projet non en cours et trie par taille', () => {
    expect(kitTakenSizes(3, projects)).toEqual([{ sizeMm: 4, projectName: 'Bonnet' }, { sizeMm: 5, projectName: 'Pull' }])
    expect(kitTakenSizes(3, [projects[1]])).toEqual([])
  })
  it('kitCableUse compte les exemplaires et les projets en cours qui les prennent', () => {
    expect(kitCableUse(zing, projects)).toEqual([
      { cm: 80, join: null, count: 2, taken: ['Bonnet'] },
      { cm: 100, join: null, count: 1, taken: [] },
    ])
    expect(kitCableUse({ id: 3 }, projects)).toEqual([])
  })
  // Protège la distinction 80 S / 80 L dans le décompte « pris ».
  it('kitCableUse : un 80 S et un 80 L ne se confondent pas', () => {
    const kitJoins = { id: 3, type: 'interchangeable', kitSizes: [4, 5], kitCables: [{ cm: 80, join: 's' }, { cm: 80, join: 's' }, { cm: 80, join: 'l' }] }
    const pris = [{ id: 1, status: 'wip', name: 'Bonnet', kitPicks: [{ toolId: 3, sizeMm: 4, cableCm: 80, cableJoin: 's' }] }]
    expect(kitCableUse(kitJoins, pris)).toEqual([
      { cm: 80, join: 's', count: 2, taken: ['Bonnet'] },
      { cm: 80, join: 'l', count: 1, taken: [] },
    ])
    const prisL = [{ id: 2, status: 'wip', name: 'Pull', kitPicks: [{ toolId: 3, sizeMm: 5, cableCm: 80, cableJoin: 'l' }] }]
    expect(kitCableUse(kitJoins, prisL).map((c) => c.taken)).toEqual([[], ['Pull']])
  })
  it('kitCableUse : une prise ancienne sans diamètre compte sur l’unique 80 S du kit', () => {
    const kitS = { id: 3, type: 'interchangeable', kitSizes: [4], kitCables: [{ cm: 80, join: 's' }] }
    const ancien = [{ id: 1, status: 'wip', name: 'Bonnet', kitPicks: [{ toolId: 3, sizeMm: 4, cableCm: 80 }] }]
    expect(kitCableUse(kitS, ancien)).toEqual([{ cm: 80, join: 's', count: 1, taken: ['Bonnet'] }])
  })
  it('pruneKitPicks retire kit absent, taille ou câble absents du kit, doublons', () => {
    const picks = [
      { toolId: 3, sizeMm: 4, cableCm: 80 },
      { toolId: 3, sizeMm: '4', cableCm: 80 },
      { toolId: 3, sizeMm: 6, cableCm: null },
      { toolId: 3, sizeMm: 5, cableCm: 60 },
      { toolId: 3, sizeMm: 5 },
      { toolId: 99, sizeMm: 4, cableCm: null },
      { toolId: 3, sizeMm: 'x', cableCm: null },
    ]
    expect(pruneKitPicks(picks, [zing])).toEqual([
      { toolId: 3, sizeMm: 4, cableCm: 80, cableJoin: null },
      { toolId: 3, sizeMm: 5, cableCm: null, cableJoin: null },
    ])
    expect(pruneKitPicks(undefined, [zing])).toEqual([])
  })
  it('pruneKitPicks : câble retiré du kit, la taille reste prise sans câble', () => {
    const sansCable = { ...zing, kitCables: [] }
    expect(pruneKitPicks([{ toolId: 3, sizeMm: 4, cableCm: 80 }], [sansCable])).toEqual([{ toolId: 3, sizeMm: 4, cableCm: null, cableJoin: null }])
    const projet = { id: 1, status: 'wip', name: 'Bonnet', kitPicks: [{ toolId: 3, sizeMm: 4, cableCm: 80 }] }
    expect(kitTakenLive(sansCable, [projet])).toEqual([{ sizeMm: 4, projectName: 'Bonnet' }])
  })
  // Protège le rattachement d'une prise ancienne et la comparaison longueur ET diamètre.
  it('pruneKitPicks : longueur et diamètre comparés ensemble, prise ancienne rattachée si un seul diamètre', () => {
    const kitS = { id: 3, kitSizes: [4], kitCables: [{ cm: 80, join: 's' }] }
    const kitSL = { id: 3, kitSizes: [4], kitCables: [{ cm: 80, join: 's' }, { cm: 80, join: 'l' }] }
    const pick = (cableJoin) => [{ toolId: 3, sizeMm: 4, cableCm: 80, ...(cableJoin === undefined ? {} : { cableJoin }) }]
    expect(pruneKitPicks(pick('s'), [kitS])).toEqual([{ toolId: 3, sizeMm: 4, cableCm: 80, cableJoin: 's' }])
    expect(pruneKitPicks(pick('l'), [kitS])).toEqual([{ toolId: 3, sizeMm: 4, cableCm: null, cableJoin: null }])
    expect(pruneKitPicks(pick(null), [kitS])).toEqual([{ toolId: 3, sizeMm: 4, cableCm: 80, cableJoin: 's' }])
    expect(pruneKitPicks(pick(), [kitS])).toEqual([{ toolId: 3, sizeMm: 4, cableCm: 80, cableJoin: 's' }])
    expect(pruneKitPicks(pick(null), [kitSL])).toEqual([{ toolId: 3, sizeMm: 4, cableCm: null, cableJoin: null }])
    expect(pruneKitPicks(pick('l'), [kitSL])).toEqual([{ toolId: 3, sizeMm: 4, cableCm: 80, cableJoin: 'l' }])
    expect(pruneKitPicks([...pick('s'), ...pick('l')], [kitSL])).toHaveLength(2)
  })
  it('kitCableUse ignore une prise dont la taille n’est plus dans le kit', () => {
    const stale = [{ id: 7, status: 'wip', name: 'Vieux', kitPicks: [{ toolId: 3, sizeMm: 6, cableCm: 100 }] }]
    expect(kitCableUse(zing, stale).find((c) => c.cm === 100).taken).toEqual([])
  })
  it('kitTakenLive : tailles prises encore présentes dans le kit', () => {
    const stale = [...projects, { id: 7, status: 'wip', name: 'Vieux', kitPicks: [{ toolId: 3, sizeMm: 6, cableCm: null }] }]
    expect(kitTakenLive(zing, stale)).toEqual([{ sizeMm: 4, projectName: 'Bonnet' }, { sizeMm: 5, projectName: 'Pull' }])
  })
  it('kitPickerSizes : tailles du projet d’abord, prises des autres projets en cours seulement', () => {
    expect(kitPickerSizes(zing, ['5'], projects, 1)).toEqual([
      { sizeMm: 5, takenBy: ['Pull'] },
      { sizeMm: 4, takenBy: [] },
    ])
    expect(kitPickerSizes(zing, [], projects, 3)).toEqual([
      { sizeMm: 4, takenBy: ['Bonnet'] },
      { sizeMm: 5, takenBy: [] },
    ])
  })
  it('kitPickerCables : « pris » seulement quand les autres projets en tiennent tous les exemplaires', () => {
    const two = [...projects, { id: 8, status: 'wip', name: 'Châle', kitPicks: [{ toolId: 3, sizeMm: 5, cableCm: 80 }] }]
    expect(kitPickerCables(zing, projects, 3)).toEqual([
      { cm: 80, join: null, value: '80|', takenBy: [] },
      { cm: 100, join: null, value: '100|', takenBy: [] },
    ])
    expect(kitPickerCables(zing, two, 3)).toEqual([
      { cm: 80, join: null, value: '80|', takenBy: ['Bonnet', 'Châle'] },
      { cm: 100, join: null, value: '100|', takenBy: [] },
    ])
    expect(kitPickerCables(zing, two, 1)[0]).toEqual({ cm: 80, join: null, value: '80|', takenBy: [] })
  })
  it('linkedKitPicks : prises du projet avec leur kit, celles d’un kit absent ou périmées ignorées', () => {
    const project = { kitPicks: [{ toolId: 3, sizeMm: 4, cableCm: 80 }, { toolId: 3, sizeMm: 6, cableCm: null }, { toolId: 9, sizeMm: 4, cableCm: null }] }
    expect(linkedKitPicks(project, [zing])).toEqual([{ tool: zing, sizeMm: 4, cableCm: 80, cableJoin: null }])
    expect(linkedKitPicks({}, [zing])).toEqual([])
  })
  it('une prise dont le câble n’est plus dans le kit occupe encore la taille', () => {
    const stale = [{ id: 7, status: 'wip', name: 'Vieux', kitPicks: [{ toolId: 3, sizeMm: 4, cableCm: 60 }] }]
    expect(kitTakenLive(zing, stale)).toEqual([{ sizeMm: 4, projectName: 'Vieux' }])
    expect(kitPickerSizes(zing, [], stale, 1)).toEqual([{ sizeMm: 4, takenBy: ['Vieux'] }, { sizeMm: 5, takenBy: [] }])
  })
})

describe('liens mis de côté', () => {
  const circ = { id: 1, type: 'circular', sizeMm: 4 }
  const kitP = { id: 2, type: 'interchangeable', kitSizes: [4, 5], kitCables: [60, 80, 80] }
  const stock = [circ, kitP]
  const keys = (list) => list.map((e) => e.key)

  describe('parkedOf', () => {
    it('champ absent, null ou mal formé : deux tableaux vides', () => {
      const empty = { toolIds: [], kitPicks: [] }
      expect(parkedOf({})).toEqual(empty)
      expect(parkedOf({ parkedTools: null })).toEqual(empty)
      expect(parkedOf({ parkedTools: 'x' })).toEqual(empty)
      expect(parkedOf({ parkedTools: { toolIds: [1] } })).toEqual({ toolIds: [1], kitPicks: [] })
    })
  })

  describe('parkEntries', () => {
    it('rend les liens valides, l’outil absent du stock est ignoré', () => {
      const project = { id: 1, toolIds: [1, 99], kitPicks: [{ toolId: 2, sizeMm: 4, cableCm: 60 }] }
      const out = parkEntries(project, stock)
      expect(keys(out)).toEqual(['tool:1', 'kit:2|4|60'])
      expect(out[0]).toMatchObject({ kind: 'tool', tool: circ, free: true, takenBy: [] })
      expect(out[1]).toMatchObject({ kind: 'kit', tool: kitP, sizeMm: 4, cableCm: 60, free: true, takenBy: [] })
    })
  })

  describe('parkedEntries', () => {
    const mine = (parked) => ({ id: 10, status: 'pause', parkedTools: parked })
    it('outil entier : pris par un autre projet wip, libre si l’autre est en pause', () => {
      const project = mine({ toolIds: [1], kitPicks: [] })
      const wip = { id: 11, status: 'wip', name: 'Bonnet', toolIds: [1] }
      const pause = { id: 12, status: 'pause', name: 'Écharpe', toolIds: [1] }
      expect(parkedEntries(project, stock, [project, wip])[0]).toMatchObject({ key: 'tool:1', free: false, takenBy: ['Bonnet'] })
      expect(parkedEntries(project, stock, [project, pause])[0]).toMatchObject({ free: true, takenBy: [] })
    })
    it('outil pris par plusieurs wip : tous les noms, pas la pause', () => {
      const project = mine({ toolIds: [1], kitPicks: [] })
      const a = { id: 11, status: 'wip', name: 'Bonnet', toolIds: [1] }
      const b = { id: 12, status: 'wip', name: 'Écharpe', toolIds: [1] }
      const pause = { id: 13, status: 'pause', name: 'Pull', toolIds: [1] }
      expect(parkedEntries(project, stock, [project, a, pause, b])[0]).toMatchObject({ free: false, takenBy: ['Bonnet', 'Écharpe'] })
    })
    it('le projet lui-même n’est pas un « autre »', () => {
      const project = { ...mine({ toolIds: [1], kitPicks: [] }), status: 'wip', name: 'Moi', toolIds: [1] }
      expect(parkedEntries(project, stock, [project])[0].free).toBe(true)
    })
    it('taille de kit prise par un autre wip', () => {
      const project = mine({ toolIds: [], kitPicks: [{ toolId: 2, sizeMm: 4, cableCm: null }, { toolId: 2, sizeMm: 5, cableCm: null }] })
      const other = { id: 11, status: 'wip', name: 'Bonnet', kitPicks: [{ toolId: 2, sizeMm: 4, cableCm: null }] }
      const out = parkedEntries(project, stock, [project, other])
      expect(out[0]).toMatchObject({ key: 'kit:2|4|null', free: false, takenBy: ['Bonnet'] })
      expect(out[1]).toMatchObject({ key: 'kit:2|5|null', free: true, takenBy: [] })
    })
    it('câble en deux exemplaires : libre tant qu’un reste, pris quand les deux le sont', () => {
      const project = mine({ toolIds: [], kitPicks: [{ toolId: 2, sizeMm: 5, cableCm: 80 }] })
      const a = { id: 11, status: 'wip', name: 'A', kitPicks: [{ toolId: 2, sizeMm: 4, cableCm: 80 }] }
      const b = { id: 12, status: 'wip', name: 'B', kitPicks: [{ toolId: 2, sizeMm: 4, cableCm: 80 }] }
      expect(parkedEntries(project, stock, [project, a])[0]).toMatchObject({ free: true, takenBy: [] })
      const both = parkedEntries(project, stock, [project, a, b])[0]
      expect(both.free).toBe(false)
      expect(both.takenBy).toEqual(['A', 'B'])
    })
    it('outil supprimé ou taille retirée du kit : entrée absente', () => {
      const project = mine({ toolIds: [1, 99], kitPicks: [{ toolId: 2, sizeMm: 4, cableCm: null }, { toolId: 2, sizeMm: 5, cableCm: null }] })
      const shrunk = { ...kitP, kitSizes: [5] }
      expect(keys(parkedEntries(project, [circ, shrunk], [project]))).toEqual(['tool:1', 'kit:2|5|null'])
      expect(keys(parkedEntries(project, [], [project]))).toEqual([])
    })
  })

  describe('relinkPatch', () => {
    const project = { id: 10, toolIds: [3], kitPicks: [], parkedTools: { toolIds: [1], kitPicks: [{ toolId: 2, sizeMm: 4, cableCm: 60 }] } }
    const all = [...stock, { id: 3, type: 'circular', sizeMm: 3 }]
    it('ajoute les entrées choisies aux liens actuels et vide parkedTools', () => {
      expect(relinkPatch(project, all, ['tool:1'])).toEqual({ toolIds: [3, 1], kitPicks: [], parkedTools: null })
    })
    it('relie une prise de kit choisie', () => {
      const out = relinkPatch(project, all, ['kit:2|4|60'])
      expect(out.toolIds).toEqual([3])
      expect(out.kitPicks).toEqual([{ toolId: 2, sizeMm: 4, cableCm: 60, cableJoin: null }])
    })
    it('un lien actuel vers un outil absent du stock (corbeille) survit', () => {
      const trashed = { ...project, toolIds: [3, 77], kitPicks: [{ toolId: 88, sizeMm: 4, cableCm: null }] }
      const out = relinkPatch(trashed, all, ['tool:1'])
      expect(out.toolIds).toEqual([3, 77, 1])
      expect(out.kitPicks).toEqual([{ toolId: 88, sizeMm: 4, cableCm: null }])
    })
    it('clé inconnue ignorée, parkedTools toujours null', () => {
      const out = relinkPatch(project, all, ['tool:42', 'bidon'])
      expect(out).toEqual({ toolIds: [3], kitPicks: [], parkedTools: null })
    })
    it('une prise par taille de kit : la prise ACTUELLE gagne sur la mise de côté', () => {
      const p = { id: 10, toolIds: [], kitPicks: [{ toolId: 2, sizeMm: 4, cableCm: 60 }], parkedTools: { toolIds: [], kitPicks: [{ toolId: 2, sizeMm: 4, cableCm: 80 }] } }
      const out = relinkPatch(p, all, ['kit:2|4|80'])
      expect(out.kitPicks).toEqual([{ toolId: 2, sizeMm: 4, cableCm: 60 }])
    })
    it('clé déjà présente : pas de doublon', () => {
      const linked = { ...project, toolIds: [3, 1] }
      expect(relinkPatch(linked, all, ['tool:1']).toolIds).toEqual([3, 1])
    })
  })
})

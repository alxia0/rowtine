// @vitest-environment jsdom
// Protège le modèle d'outil (valeurs par défaut, nettoyage par type) et le CRUD du store.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { useToolsStore, emptyTool, normalizeTool } from '@/stores/tools'

describe('modèle d’outil', () => {
  it('emptyTool : circulaire disponible, quantité 1, sans photo', () => {
    expect(emptyTool()).toMatchObject({ category: 'needle', type: 'circular', quantity: 1, status: 'available', photos: [], kitSizes: [] })
  })
  it('emptyTool(type) pose la catégorie du type', () => {
    expect(emptyTool('tunisian').category).toBe('hook')
    expect(emptyTool('interchangeable').category).toBe('kit')
  })
  it('normalizeTool vide les champs que le type n’utilise pas', () => {
    const t = normalizeTool({ ...emptyTool('circular'), sizeMm: 4, lengthCm: 80, handle: 'ergonomic', kitSizes: [3, 4], dpnCount: 5 })
    expect(t).toMatchObject({ sizeMm: 4, lengthCm: 80, handle: '', kitSizes: [], dpnCount: null })
  })
  it('normalizeTool : un câble n’a pas de taille', () => {
    expect(normalizeTool({ ...emptyTool('cable'), sizeMm: 4, lengthCm: 60 }).sizeMm).toBeNull()
  })
  it('normalizeTool : un kit garde ses tailles triées sans doublon et n’a pas de taille unique', () => {
    const t = normalizeTool({ ...emptyTool('interchangeable'), sizeMm: 4, kitSizes: [5, 3.5, 5, '4'] })
    expect(t.sizeMm).toBeNull()
    expect(t.kitSizes).toEqual([3.5, 4, 5])
  })
  it('normalizeTool : un kit de crochets garde ses tailles sans doublon, et ses câbles seulement s’il est tunisien', () => {
    const base = { ...emptyTool('hookKit'), kitSizes: [5, 4, 4], kitCables: [80] }
    expect(emptyTool('hookKit')).toMatchObject({ category: 'kit', tunisian: false })
    expect(normalizeTool({ ...base, tunisian: false })).toMatchObject({ kitSizes: [4, 5], kitCables: [], sizeMm: null, handle: '' })
    expect(normalizeTool({ ...base, tunisian: true })).toMatchObject({ kitSizes: [4, 5], kitCables: [{ cm: 80, join: null }] })
    expect(normalizeTool({ ...base, tunisian: true, handle: 'rubber' }).handle).toBe('rubber')
  })
  it('normalizeTool : les tailles d’un kit restent dans l’échelle de son type', () => {
    // Les tables tricot et crochet sont identiques dès 2 mm : seul le fin (< 2 mm) et l'hors-table se retirent.
    expect(normalizeTool({ ...emptyTool('interchangeable'), kitSizes: [1.5, 3.75, 4, 4.2] }).kitSizes).toEqual([3.75, 4])
    expect(normalizeTool({ ...emptyTool('interchangeable'), kitSizes: [3.5, 4, 5] }).kitSizes).toEqual([3.5, 4, 5])
    expect(normalizeTool({ ...emptyTool('hookKit'), material: 'aluminium', kitSizes: [1.5, 4, 4.2] }).kitSizes).toEqual([4])
    expect(normalizeTool({ ...emptyTool('hookKit'), material: 'steel', kitSizes: [1.5, 4] }).kitSizes).toEqual([1.5, 4])
  })
  it('normalizeTool : tunisian n’appartient qu’au kit de crochets, un kit d’aiguilles garde ses câbles', () => {
    expect(normalizeTool({ ...emptyTool('interchangeable'), tunisian: true, kitCables: [80] })).toMatchObject({ tunisian: false, kitCables: [{ cm: 80, join: null }] })
    expect(normalizeTool({ ...emptyTool('circular'), tunisian: true }).tunisian).toBe(false)
  })
  it('normalizeTool : une longueur hors de la liste du type est retirée (DP chaussette → pointes)', () => {
    expect(normalizeTool({ ...emptyTool('dpn'), type: 'tips', lengthKind: 'sock' }).lengthKind).toBe('')
    expect(normalizeTool({ ...emptyTool('tips'), type: 'dpn', lengthKind: 'short' }).lengthKind).toBe('')
    expect(normalizeTool({ ...emptyTool('dpn'), type: 'interchangeable', lengthKind: 'sock' }).lengthKind).toBe('')
    // « standard » appartient aux deux listes : il reste.
    expect(normalizeTool({ ...emptyTool('dpn'), type: 'tips', lengthKind: 'standard' }).lengthKind).toBe('standard')
    expect(normalizeTool({ ...emptyTool('dpn'), lengthKind: 'sock' }).lengthKind).toBe('sock')
  })
  it('normalizeTool : un câble seul garde sa longueur en cm, une pointe garde « mini »', () => {
    expect(normalizeTool({ ...emptyTool('cable'), lengthCm: 20 }).lengthCm).toBe(20)
    expect(normalizeTool({ ...emptyTool('tips'), sizeMm: 4, lengthKind: 'mini' }).lengthKind).toBe('mini')
    expect(normalizeTool({ ...emptyTool('interchangeable'), lengthKind: 'mini' }).lengthKind).toBe('mini')
    expect(normalizeTool({ ...emptyTool('dpn'), lengthKind: 'mini' }).lengthKind).toBe('')
  })
  it('normalizeTool recalcule la catégorie depuis le type', () => {
    expect(normalizeTool({ ...emptyTool('circular'), type: 'tunisian' }).category).toBe('hook')
  })
})

describe('store tools', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
  })
  it('ajoute un outil normalisé et rend son id', async () => {
    const store = useToolsStore()
    const id = await store.add({ type: 'circular', sizeMm: '4', lengthCm: 80, handle: 'ergonomic' })
    expect(typeof id).toBe('number')
    expect(store.tools[0]).toMatchObject({ type: 'circular', sizeMm: 4, lengthCm: 80, handle: '' })
  })
  it('met à jour en renormalisant (changement de type)', async () => {
    const store = useToolsStore()
    const id = await store.add({ type: 'circular', sizeMm: 4, lengthCm: 80 })
    await store.update(id, { type: 'standard', handle: 'beaded' })
    expect(store.tools[0]).toMatchObject({ category: 'hook', sizeMm: 4, lengthCm: null, handle: 'beaded' })
  })
  it('update sur un id absent n’écrit rien (pas de résurrection ni de ligne fantôme)', async () => {
    const store = useToolsStore()
    const id = await store.add({ brand: 'ChiaoGoo' })
    await store.remove(id)
    await store.update(id, { photos: ['data:image/png;base64,AAAA'] })
    await store.update(9999, { brand: 'Fantôme' })
    expect(await db.tools.count()).toBe(0)
    expect(store.tools).toHaveLength(0)
  })
  it('liste du plus récent au plus ancien', async () => {
    const store = useToolsStore()
    await store.add({ brand: 'A' })
    await store.add({ brand: 'B' })
    expect(store.tools.map((t) => t.brand)).toEqual(['B', 'A'])
  })
  it('remove renvoie l’outil supprimé, restore le réinsère', async () => {
    const store = useToolsStore()
    const id = await store.add({ brand: 'ChiaoGoo' })
    const removed = await store.remove(id)
    expect(store.tools).toHaveLength(0)
    await store.restore(removed)
    expect(store.tools[0].brand).toBe('ChiaoGoo')
  })
})

// Un cas par champ CONSERVÉ : chaque champ propre à un type doit survivre à normalizeTool,
// sinon la fiche perd une donnée en silence à l'enregistrement.
describe('normalizeTool conserve les champs que le type utilise', () => {
  it('dpn garde lengthKind et dpnCount', () => {
    const t = normalizeTool({ ...emptyTool('dpn'), sizeMm: 2.5, lengthKind: 'sock', dpnCount: 5 })
    expect(t).toMatchObject({ lengthKind: 'sock', dpnCount: 5, sizeMm: 2.5 })
  })
  it('tunisien garde tunisianKind, longueur et manche', () => {
    const t = normalizeTool({ ...emptyTool('tunisian'), sizeMm: 5, lengthCm: 35, tunisianKind: 'cabled', handle: 'rubber' })
    expect(t).toMatchObject({ tunisianKind: 'cabled', lengthCm: 35, handle: 'rubber' })
  })
  it('kit garde kitCables triés, doublons conservés (plusieurs câbles de même longueur)', () => {
    const t = normalizeTool({ ...emptyTool('interchangeable'), kitCables: [80, 40, '60', 40] })
    expect(t.kitCables).toEqual([{ cm: 40, join: null }, { cm: 40, join: null }, { cm: 60, join: null }, { cm: 80, join: null }])
    expect(normalizeTool({ type: 'interchangeable', kitCables: [35, 20, 20], kitSizes: [4, 4, 3.5] })).toMatchObject({ kitCables: [{ cm: 20, join: null }, { cm: 20, join: null }, { cm: 35, join: null }], kitSizes: [3.5, 4] })
  })
  // Protège l'écriture des câbles : toujours des objets, diamètre inconnu = non précisé, doublons gardés.
  it('kit : kitCables nombres et objets mélangés s’écrivent en objets, diamètre inconnu devient null', () => {
    const t = normalizeTool({ ...emptyTool('interchangeable'), kitCables: [80, { cm: 80, join: 's' }, { cm: 80, join: 'x' }, { cm: '20,5', join: 'l' }] })
    expect(t.kitCables).toEqual([{ cm: 20.5, join: 'l' }, { cm: 80, join: 's' }, { cm: 80, join: null }, { cm: 80, join: null }])
    expect(normalizeTool({ ...emptyTool('interchangeable'), kitCables: [{ cm: 80, join: 's' }, { cm: 80, join: 's' }] }).kitCables).toHaveLength(2)
  })
  it('une taille saisie avec virgule devient un nombre', () => {
    expect(normalizeTool({ ...emptyTool('circular'), sizeMm: '3,5' }).sizeMm).toBe(3.5)
  })
  it('le type other garde sa taille (optionnelle)', () => {
    expect(normalizeTool({ ...emptyTool('other'), sizeMm: 6 }).sizeMm).toBe(6)
  })
  it('les pointes tips gardent lengthKind', () => {
    expect(normalizeTool({ ...emptyTool('tips'), sizeMm: 4, lengthKind: 'short' })).toMatchObject({ lengthKind: 'short', sizeMm: 4 })
  })
})

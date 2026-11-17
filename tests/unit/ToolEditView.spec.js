// @vitest-environment jsdom
// Formulaire d'ajout et de modification d'un outil (lot « stock d'outils », tâche 10). VRAIE
// base (fake-indexeddb) et vraies actions Pinia, comme ToolDetailView.spec.js : on lit ce qui a
// réellement été écrit, pas seulement l'appel.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { db } from '@/db/db'
import ToolEditView from '@/views/ToolEditView.vue'
import ToolKitPicker from '@/components/ToolKitPicker.vue'
import { useSnackbarStore } from '@/stores/snackbar'
import { emptyTool, normalizeTool } from '@/stores/tools'
import { TOOL_TYPES, TOOL_TYPE_ORDER, TOOL_CATEGORIES, CIRCULAR_LENGTHS_CM, CABLE_LENGTHS_CM, STRAIGHT_LENGTHS_CM, DPN_LENGTHS, TIP_LENGTHS } from '@/constants/tools'
import { sizesFor } from '@/constants/needle-sizes'
import { createTestI18n, createTestRouter, makeTk } from './helpers/i18n-router'

vi.mock('@/utils/photo', () => ({ pickAndCropImage: vi.fn(async () => 'data:image/png;base64,NEW') }))

const i18n = createTestI18n()
const tk = makeTk(i18n)

function makeRouter() {
  return createTestRouter([
    { path: '/tools', name: 'tools', component: { template: '<div />' } },
    { path: '/tools/new', name: 'tool-new', component: { template: '<div />' } },
    { path: '/tools/:id', name: 'tool', component: { template: '<div />' } },
    { path: '/tools/:id/edit', name: 'tool-edit', component: { template: '<div />' } },
  ])
}

async function mountView({ id = null, query = {}, currency = 'EUR' } = {}) {
  const router = makeRouter()
  await router.push(id ? { name: 'tool-edit', params: { id } } : { name: 'tool-new', query })
  await router.isReady()
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    initialState: { settings: { unitSystem: 'metric', currency } },
    stubActions: false,
  })
  const w = mount(ToolEditView, {
    global: { plugins: [pinia, i18n, router], stubs: { AppIcon: true } },
  })
  await flushPromises()
  return { w, router, snackbar: useSnackbarStore(pinia) }
}

async function chooseType(w, type) {
  await w.find(`[data-test="type-${type}"]`).trigger('click')
}
async function save(w) {
  await w.find('[data-test="tool-save"]').trigger('click')
  await flushPromises()
}
// Options porteuses d'une valeur : ni « Non précisé » (valeur null, sans attribut) ni l'invite vide.
const optionValues = (w, sel) => w.find(sel).findAll('option').filter((o) => o.attributes('value') !== undefined).map((o) => o.element.value).filter((v) => v !== '')
// L'écriture Dexie puis le rechargement du store prennent plusieurs tours : on attend la navigation.
const landedOn = (router, name) => vi.waitFor(() => expect(router.currentRoute.value.name).toBe(name))

const CIRC = { category: 'needle', type: 'circular', sizeMm: 4, lengthCm: 80, material: 'bamboo', brand: 'ChiaoGoo', line: 'Red Lace', quantity: 2, price: 12.5, shop: 'La mercerie', storedIn: 'Trousse bleue', status: 'lent', notes: 'pointes fines', photos: ['data:image/png;base64,A'], coverIndex: 0 }

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('ToolEditView : choix du type', () => {
  it('le type se choisit en premier, regroupé par catégorie, icône et libellé', async () => {
    const { w } = await mountView()
    const groups = w.findAll('[data-test^="type-group-"]')
    expect(groups.map((g) => g.attributes('data-test'))).toEqual(TOOL_CATEGORIES.map((c) => `type-group-${c}`))
    const shown = groups.flatMap((g) => g.findAll('[data-test^="type-"]').map((b) => b.attributes('data-test').slice(5)))
    // Ordre de TOOL_TYPE_ORDER à l'intérieur de chaque catégorie.
    expect(shown).toEqual(TOOL_CATEGORIES.flatMap((c) => TOOL_TYPE_ORDER.filter((k) => TOOL_TYPES[k].category === c)))
    const circ = w.find('[data-test="type-circular"]')
    expect(circ.find('app-icon-stub').attributes('name')).toBe(TOOL_TYPES.circular.icon)
    expect(circ.text()).toBe(tk('tools.types.circular'))
    // Rien d'autre tant que le type n'est pas choisi.
    expect(w.find('#tool-size').exists()).toBe(false)
    expect(w.find('#tool-material').exists()).toBe(false)
    expect(w.find('[data-test="tool-save"]').exists()).toBe(false)
  })

  it('circulaire : taille, longueur de la liste fermée et matière, pas de manche', async () => {
    const { w } = await mountView()
    await chooseType(w, 'circular')
    expect(w.find('[data-test="type-circular"]').attributes('aria-pressed')).toBe('true')
    expect(w.find('#tool-size').exists()).toBe(true)
    expect(optionValues(w, '#tool-length').map(Number)).toEqual(CIRCULAR_LENGTHS_CM)
    expect(w.find('#tool-material').exists()).toBe(true)
    expect(w.find('#tool-handle').exists()).toBe(false)
    expect(w.find('#tool-tunisian-kind').exists()).toBe(false)
    expect(w.findComponent(ToolKitPicker).exists()).toBe(false)
  })

  it('câble seul : longueurs des grandes marques (13 à 150), la circulaire propose 50', async () => {
    const { w } = await mountView()
    await chooseType(w, 'cable')
    expect(optionValues(w, '#tool-length').map(Number)).toEqual(CABLE_LENGTHS_CM)
    expect(CABLE_LENGTHS_CM).toHaveLength(15)
    await chooseType(w, 'circular')
    expect(optionValues(w, '#tool-length').map(Number)).toContain(50)
  })

  it('changer de type : 50 cm circulaire reste en câble, 20 cm câble est vidé en circulaire', async () => {
    const { w } = await mountView()
    await chooseType(w, 'circular')
    await w.find('#tool-length').setValue('50')
    await chooseType(w, 'cable')
    expect(w.find('#tool-length').element.value).toBe('50')
    await w.find('#tool-length').setValue('20')
    await chooseType(w, 'circular')
    expect(w.find('#tool-length').element.selectedIndex).toBe(0) // « Non précisé »
  })

  it('crochet tunisien : manche, fixe ou à câble, longueur libre', async () => {
    const { w } = await mountView()
    await chooseType(w, 'tunisian')
    expect(w.find('#tool-handle').exists()).toBe(true)
    expect(optionValues(w, '#tool-tunisian-kind')).toEqual(['fixed', 'cabled'])
    expect(w.find('#tool-length-free').exists()).toBe(true)
    expect(w.find('#tool-length').exists()).toBe(false)
  })

  it('kit : le contenu du kit, la longueur des pointes, aucun sélecteur de taille unique', async () => {
    const { w } = await mountView()
    await chooseType(w, 'interchangeable')
    expect(w.findComponent(ToolKitPicker).exists()).toBe(true)
    expect(w.find('#tool-size').exists()).toBe(false)
    expect(optionValues(w, '#tool-length-kind')).toEqual(TIP_LENGTHS)
  })

  it('kit de crochets : tailles de crochet ; les câbles n’apparaissent qu’avec la case tunisien cochée', async () => {
    const { w } = await mountView()
    await chooseType(w, 'hookKit')
    expect(TOOL_TYPES.hookKit.category).toBe('kit')
    expect(w.find('#tool-size').exists()).toBe(false)
    expect(w.find('[data-test="kit-size"][data-value="4"]').text()).toBe('4 mm (G-6)')
    expect(w.findAll('[data-test="kit-cable"]')).toHaveLength(0)
    await w.find('[data-test="kit-tunisian"] input').setValue(true)
    expect(w.findAll('[data-test="kit-cable"]')).toHaveLength(CABLE_LENGTHS_CM.length)
    expect(w.find('#tool-handle').exists()).toBe(true)
  })

  it('kit d’aiguilles : ni case tunisien ni câbles masqués', async () => {
    const { w } = await mountView()
    await chooseType(w, 'interchangeable')
    expect(w.find('[data-test="kit-tunisian"]').exists()).toBe(false)
    expect(w.findAll('[data-test="kit-cable"]').length).toBeGreaterThan(0)
  })

  it('kit de crochets : décocher tunisien puis enregistrer vide les câbles, recocher ne les invente pas', async () => {
    const id = await db.tools.add(normalizeTool({ ...emptyTool('hookKit'), kitSizes: [4], tunisian: true, kitCables: [80] }))
    const { w, router } = await mountView({ id })
    await w.find('[data-test="kit-tunisian"] input').setValue(false)
    await save(w)
    await landedOn(router, 'tool')
    expect(await db.tools.get(id)).toMatchObject({ tunisian: false, kitCables: [], kitSizes: [4] })
  })

  it('un crochet propose 0,6 mm : toute l’échelle crochet, fines comprises, jusqu’à 25 mm', async () => {
    const { w } = await mountView()
    await chooseType(w, 'standard')
    const values = optionValues(w, '#tool-size').filter((v) => v !== '__other__').map(Number)
    expect(values[0]).toBe(0.6)
    expect(values.at(-1)).toBe(25)
    expect(values).toEqual(sizesFor('hook'))
  })

  it('crochet : choisir la matière acier change l’équivalent proposé (2,25 mm : B-1 puis US 2)', async () => {
    const { w } = await mountView()
    await chooseType(w, 'standard')
    expect(w.find('#tool-size option[value="2.25"]').text()).toBe('2,25 mm (B-1)')
    await w.find('#tool-material').setValue('steel')
    expect(w.find('#tool-size option[value="2.25"]').text()).toBe('2,25 mm (US 2)')
    await w.find('#tool-material').setValue('wood')
    expect(w.find('#tool-size option[value="2.25"]').text()).toBe('2,25 mm (B-1)')
  })

  it('il n’y a plus qu’un type crochet, à côté du tunisien', () => {
    expect(TOOL_TYPE_ORDER.filter((k) => TOOL_TYPES[k].category === 'hook')).toEqual(['standard', 'tunisian'])
  })

  it('aiguilles : toute la table, de 0,5 à 25 mm, libellée « 4 mm (US 6) »', async () => {
    const { w } = await mountView()
    await chooseType(w, 'circular')
    const values = optionValues(w, '#tool-size').filter((v) => v !== '__other__').map(Number)
    expect(values).toEqual(sizesFor('knitting'))
    expect(w.find('#tool-size option[value="4"]').text()).toBe('4 mm (US 6)')
    expect(w.find('#tool-size option[value="3.5"]').text()).toBe('3,5 mm (US 4)')
  })

  it('crochet : libellé avec la lettre (« 4 mm (G-6) »)', async () => {
    const { w } = await mountView()
    await chooseType(w, 'standard')
    expect(w.find('#tool-size option[value="4"]').text()).toBe('4 mm (G-6)')
  })

  it('crochet fin : équivalent numérique préfixé « US » (« 1,5 mm (US 8) »)', async () => {
    const { w } = await mountView()
    await chooseType(w, 'standard')
    expect(w.find('#tool-size option[value="1.5"]').text()).toBe('1,5 mm (US 8)')
  })

  it('changer de type ne perd pas la saisie (retour au type précédent)', async () => {
    const { w } = await mountView()
    await chooseType(w, 'circular')
    await w.find('#tool-length').setValue('80')
    await chooseType(w, 'standard')
    await w.find('#tool-handle').setValue('ergonomic')
    await chooseType(w, 'circular')
    expect(w.find('#tool-length').element.value).toBe('80')
    await chooseType(w, 'standard')
    expect(w.find('#tool-handle').element.value).toBe('ergonomic')
  })
})

describe('ToolEditView : taille', () => {
  it('« Autre taille… » ouvre une saisie libre en mm, virgule acceptée', async () => {
    const { w, router } = await mountView()
    await chooseType(w, 'circular')
    expect(w.find('#tool-size option[value="__other__"]').text()).toBe(tk('tools.form.sizeOther'))
    expect(w.find('#tool-size-free').exists()).toBe(false)
    await w.find('#tool-size').setValue('__other__')
    expect(w.find('#tool-size-free').exists()).toBe(true)
    await w.find('#tool-size-free').setValue('4,2')
    await save(w)
    await landedOn(router, 'tool')
    const [row] = await db.tools.toArray()
    expect(row.sizeMm).toBe(4.2)
    expect(router.currentRoute.value).toMatchObject({ name: 'tool', params: { id: String(row.id) } })
  })

  it('sans taille, un type à taille obligatoire ne s’enregistre pas et le dit', async () => {
    const { w, router, snackbar } = await mountView()
    await chooseType(w, 'circular')
    await save(w)
    expect(snackbar.message).toBe(tk('tools.sizeRequired'))
    expect(await db.tools.count()).toBe(0)
    expect(router.currentRoute.value.name).toBe('tool-new')
  })

  it('un type à taille facultative s’enregistre sans taille', async () => {
    const { w, router } = await mountView()
    await chooseType(w, 'other')
    await save(w)
    await landedOn(router, 'tool')
    expect(await db.tools.count()).toBe(1)
  })

  it('une taille fine de crochet repassée sur une aiguille reste visible et enregistrée', async () => {
    const { w, router } = await mountView()
    await chooseType(w, 'standard')
    await w.find('#tool-size').setValue('0.6')
    await chooseType(w, 'circular')
    expect(w.find('#tool-size').element.value).toBe('__other__')
    expect(w.find('#tool-size-free').element.value).toBe('0,6')
    await save(w)
    await landedOn(router, 'tool')
    const [row] = await db.tools.toArray()
    expect(row).toMatchObject({ type: 'circular', sizeMm: 0.6 })
  })

  it('en modification, une taille hors table s’affiche dans la saisie libre', async () => {
    const id = await db.tools.add({ ...CIRC, sizeMm: 4.2 })
    const { w } = await mountView({ id })
    expect(w.find('#tool-size').element.value).toBe('__other__')
    expect(w.find('#tool-size-free').element.value).toBe('4,2')
  })
})

describe('ToolEditView : enregistrement', () => {
  it('création : écrit la fiche puis ouvre sa fiche détail', async () => {
    const { w, router } = await mountView()
    await chooseType(w, 'circular')
    await w.find('#tool-size').setValue('4')
    await w.find('#tool-length').setValue('80')
    await w.find('#tool-material').setValue('bamboo')
    await w.find('#tool-brand').setValue('ChiaoGoo')
    await w.find('#tool-price').setValue('12,50')
    await save(w)
    await landedOn(router, 'tool')
    const rows = await db.tools.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ category: 'needle', type: 'circular', sizeMm: 4, lengthCm: 80, material: 'bamboo', brand: 'ChiaoGoo', price: 12.5, quantity: 1, status: 'available' })
    expect(router.currentRoute.value).toMatchObject({ name: 'tool', params: { id: String(rows[0].id) } })
  })

  it('kit : les tailles et câbles cochés sont enregistrés', async () => {
    const { w, router } = await mountView()
    await chooseType(w, 'interchangeable')
    const picker = w.findComponent(ToolKitPicker)
    picker.vm.$emit('update:sizes', [3.5, 4])
    picker.vm.$emit('update:cables', [{ cm: 80, join: null }])
    await save(w)
    await landedOn(router, 'tool')
    const [row] = await db.tools.toArray()
    expect(row).toMatchObject({ category: 'kit', type: 'interchangeable', kitSizes: [3.5, 4], kitCables: [{ cm: 80, join: null }], sizeMm: null })
  })

  it('modification : appelle update sur la même fiche et revient à la fiche', async () => {
    const id = await db.tools.add({ ...CIRC })
    const { w, router, snackbar } = await mountView({ id })
    expect(w.find('[data-test="type-circular"]').attributes('aria-pressed')).toBe('true')
    expect(w.find('#tool-size').element.value).toBe('4')
    expect(w.find('#tool-price').element.value).toBe('12,5')
    expect(w.text()).toContain(tk('tools.form.editTitle'))
    await w.find('#tool-brand').setValue('KnitPro')
    await save(w)
    await landedOn(router, 'tool')
    const rows = await db.tools.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ...CIRC, id, brand: 'KnitPro' })
    expect(snackbar.message).toBe(tk('tools.form.updated'))
    expect(router.currentRoute.value).toMatchObject({ name: 'tool', params: { id: String(id) } })
  })

  it('?duplicateFrom préremplit tout sauf l’id et la galerie (comme la laine)', async () => {
    const sourceId = await db.tools.add(normalizeTool({ ...emptyTool('circular'), ...CIRC, photos: ['data:image/png;base64,A', 'data:image/png;base64,B'], coverIndex: 1 }))
    const { w, router } = await mountView({ query: { duplicateFrom: String(sourceId) } })
    expect(w.find('[data-test="type-circular"]').attributes('aria-pressed')).toBe('true')
    expect(w.find('#tool-brand').element.value).toBe('ChiaoGoo')
    expect(w.findAll('.pthumb')).toHaveLength(0)
    expect(w.text()).toContain(tk('tools.add'))
    await save(w)
    await landedOn(router, 'tool')
    const rows = await db.tools.orderBy('id').toArray()
    expect(rows).toHaveLength(2)
    const { id: copyId, ...copy } = rows[1]
    const { id: _sourceId, ...source } = rows[0]
    expect(copyId).not.toBe(sourceId)
    // La source n'avait pas de devise posée : la copie prend celle des réglages.
    expect(copy).toEqual({ ...source, photos: [], coverIndex: 0, priceCurrency: 'EUR' })
    expect(rows[0].photos).toHaveLength(2)
  })

  it('un diamètre de fixation choisi survit à l\'enregistrement et à la réouverture', async () => {
    const { w, router } = await mountView()
    await chooseType(w, 'interchangeable')
    const picker = w.findComponent(ToolKitPicker)
    picker.vm.$emit('update:sizes', [4])
    picker.vm.$emit('update:cables', [{ cm: 80, join: 's' }, { cm: 80, join: 'l' }])
    await save(w)
    await landedOn(router, 'tool')
    const [row] = await db.tools.toArray()
    expect(row.kitCables).toEqual([{ cm: 80, join: 's' }, { cm: 80, join: 'l' }])
    const edit = await mountView({ id: row.id })
    expect(edit.w.findComponent(ToolKitPicker).props('cables')).toEqual([{ cm: 80, join: 's' }, { cm: 80, join: 'l' }])
    await save(edit.w)
    await landedOn(edit.router, 'tool')
    expect((await db.tools.get(row.id)).kitCables).toEqual([{ cm: 80, join: 's' }, { cm: 80, join: 'l' }])
  })

  it('un kit ancien (câbles en nombres) s\'ouvre avec ses câbles sous « Non précisé »', async () => {
    const id = await db.tools.add({ ...normalizeTool({ ...emptyTool('interchangeable'), kitSizes: [4] }), kitCables: [80, 100] })
    const { w } = await mountView({ id })
    expect(w.findComponent(ToolKitPicker).props('cables')).toEqual([{ cm: 80, join: null }, { cm: 100, join: null }])
    expect(w.find('[data-test="cable-join"][data-value=""]').attributes('aria-checked')).toBe('true')
  })

  it('un kit [20, 20, 35] réenregistré ou dupliqué sans toucher aux câbles garde ses doublons', async () => {
    const id = await db.tools.add(normalizeTool({ ...emptyTool('interchangeable'), kitSizes: [4], kitCables: [20, 20, 35] }))
    const edit = await mountView({ id })
    await save(edit.w)
    await landedOn(edit.router, 'tool')
    expect((await db.tools.get(id)).kitCables).toEqual([{ cm: 20, join: null }, { cm: 20, join: null }, { cm: 35, join: null }])
    const dup = await mountView({ query: { duplicateFrom: String(id) } })
    await save(dup.w)
    await landedOn(dup.router, 'tool')
    const rows = await db.tools.orderBy('id').toArray()
    expect(rows.map((r) => r.kitCables)).toEqual([[{ cm: 20, join: null }, { cm: 20, join: null }, { cm: 35, join: null }], [{ cm: 20, join: null }, { cm: 20, join: null }, { cm: 35, join: null }]])
  })

  it('un duplicateFrom périmé donne un formulaire vierge', async () => {
    const { w } = await mountView({ query: { duplicateFrom: '999' } })
    expect(w.findAll('[aria-pressed="true"]')).toHaveLength(0)
    expect(w.find('#tool-size').exists()).toBe(false)
    expect(w.text()).toContain(tk('tools.add'))
  })

  it('les photos se gèrent dans le formulaire (ajout, couverture)', async () => {
    const { w, router } = await mountView()
    await chooseType(w, 'other')
    await w.find('[data-test="tool-add-photo"]').trigger('click')
    await flushPromises()
    await w.find('[data-test="tool-add-photo"]').trigger('click')
    await flushPromises()
    await w.findAll('[data-test="tool-photo-cover"]')[0].trigger('click')
    await save(w)
    await landedOn(router, 'tool')
    const [row] = await db.tools.toArray()
    expect(row.photos).toHaveLength(2)
    expect(row.coverIndex).toBe(1)
  })
})

describe('ToolEditView : champs par type', () => {
  it('droites : longueurs 25 à 40 cm, pas de manche', async () => {
    const { w } = await mountView()
    await chooseType(w, 'straight')
    expect(w.find('#tool-size').exists()).toBe(true)
    expect(optionValues(w, '#tool-length').map(Number)).toEqual(STRAIGHT_LENGTHS_CM)
    expect(w.find('#tool-handle').exists()).toBe(false)
    expect(w.find('#tool-dpn-count').exists()).toBe(false)
  })

  it('double pointes : chaussette ou standard, et 4 ou 5 aiguilles', async () => {
    const { w } = await mountView()
    await chooseType(w, 'dpn')
    expect(optionValues(w, '#tool-length-kind')).toEqual(DPN_LENGTHS)
    expect(optionValues(w, '#tool-dpn-count').map(Number)).toEqual([4, 5])
    expect(w.find('#tool-length').exists()).toBe(false)
  })

  it('le nombre d’aiguilles n’existe que pour les double pointes', async () => {
    const { w } = await mountView()
    await chooseType(w, 'circular')
    expect(w.find('#tool-dpn-count').exists()).toBe(false)
  })

  it('câble : longueur de la liste des câbles, aucun champ taille', async () => {
    const { w } = await mountView()
    await chooseType(w, 'cable')
    expect(w.find('#tool-size').exists()).toBe(false)
    expect(optionValues(w, '#tool-length').map(Number)).toEqual(CABLE_LENGTHS_CM)
  })

  it('flexibles : taille et longueur libre en cm', async () => {
    const { w, router } = await mountView()
    await chooseType(w, 'flexible')
    expect(w.find('#tool-length').exists()).toBe(false)
    await w.find('#tool-size').setValue('3')
    await w.find('#tool-length-free').setValue('22,5')
    await save(w)
    await landedOn(router, 'tool')
    const [row] = await db.tools.toArray()
    expect(row).toMatchObject({ type: 'flexible', sizeMm: 3, lengthCm: 22.5 })
  })

  it('DP « chaussette » puis pointes : la longueur des pointes n’est pas « chaussette »', async () => {
    const { w, router } = await mountView()
    await chooseType(w, 'dpn')
    await w.find('#tool-size').setValue('3')
    await w.find('#tool-length-kind').setValue('sock')
    await chooseType(w, 'tips')
    await save(w)
    await landedOn(router, 'tool')
    const [row] = await db.tools.toArray()
    expect(row).toMatchObject({ type: 'tips', lengthKind: '' })
  })
})

describe('ToolEditView : garde-fous', () => {
  it('une taille de 0 mm ne passe pas pour une taille obligatoire', async () => {
    const { w, router, snackbar } = await mountView()
    await chooseType(w, 'circular')
    await w.find('#tool-size').setValue('__other__')
    await w.find('#tool-size-free').setValue('0')
    await save(w)
    expect(snackbar.message).toBe(tk('tools.sizeRequired'))
    expect(await db.tools.count()).toBe(0)
    expect(router.currentRoute.value.name).toBe('tool-new')
  })

  it('modification : une photo revenue en base pendant l’édition n’est pas écrasée', async () => {
    const A = 'data:image/png;base64,A'
    const B = 'data:image/png;base64,B'
    const id = await db.tools.add(normalizeTool({ ...emptyTool('circular'), ...CIRC, photos: [A], coverIndex: 0 }))
    const { w, router } = await mountView({ id })
    // « Annuler » d'un retrait de photo sur la fiche, arrivé après l'ouverture du formulaire.
    await db.tools.update(id, { photos: [A, B], coverIndex: 1 })
    await w.find('#tool-brand').setValue('KnitPro')
    await save(w)
    await landedOn(router, 'tool')
    const row = await db.tools.get(id)
    expect(row).toMatchObject({ brand: 'KnitPro', photos: [A, B], coverIndex: 1 })
  })

  it('modification : une photo ajoutée dans le formulaire est bien enregistrée', async () => {
    const id = await db.tools.add(normalizeTool({ ...emptyTool('circular'), ...CIRC, photos: ['data:image/png;base64,A'], coverIndex: 0 }))
    const { w, router } = await mountView({ id })
    await w.find('[data-test="tool-add-photo"]').trigger('click')
    await flushPromises()
    await save(w)
    await landedOn(router, 'tool')
    expect((await db.tools.get(id)).photos).toEqual(['data:image/png;base64,A', 'data:image/png;base64,NEW'])
  })
})

describe('ToolEditView : devise du prix', () => {
  it('modification : le libellé garde la devise de la fiche et l’enregistrement ne la change pas', async () => {
    const id = await db.tools.add({ ...CIRC, price: 12, priceCurrency: 'EUR' })
    const { w, router } = await mountView({ id, currency: 'USD' })
    const label = w.find('label[for="tool-price"]').text()
    expect(label).toContain('€')
    expect(label).not.toContain('$')
    await save(w)
    await landedOn(router, 'tool')
    expect((await db.tools.get(id)).priceCurrency).toBe('EUR')
  })

  it('création : un prix prend la devise des réglages, un prix vidé n’en garde aucune', async () => {
    const { w, router } = await mountView()
    await chooseType(w, 'circular')
    await w.find('#tool-size').setValue('4')
    await w.find('#tool-price').setValue('5')
    await save(w)
    await landedOn(router, 'tool')
    const [row] = await db.tools.toArray()
    expect(row).toMatchObject({ price: 5, priceCurrency: 'EUR' })

    const { w: w2, router: r2 } = await mountView({ id: row.id })
    await w2.find('#tool-price').setValue('')
    await save(w2)
    await landedOn(r2, 'tool')
    expect((await db.tools.get(row.id)).priceCurrency).toBe('')
  })
})

describe('ToolEditView : longueur et quantité filtrées', () => {
  it('circulaire 80 cm puis droites : la longueur est vidée et 80 n’est plus proposé', async () => {
    const { w } = await mountView()
    await chooseType(w, 'circular')
    await w.find('#tool-length').setValue('80')
    await chooseType(w, 'straight')
    expect(w.find('#tool-length').element.selectedIndex).toBe(0)
    expect(optionValues(w, '#tool-length')).not.toContain('80')
  })

  it('une longueur hors liste chargée depuis la base reste proposée', async () => {
    const id = await db.tools.add({ ...CIRC, lengthCm: 85 })
    const { w } = await mountView({ id })
    expect(optionValues(w, '#tool-length')).toContain('85')
    expect(w.find('#tool-length').element.value).toBe('85')
    // Recliquer le type courant ne doit pas effacer cette longueur.
    await chooseType(w, 'circular')
    expect(optionValues(w, '#tool-length')).toContain('85')
    expect(w.find('#tool-length').element.value).toBe('85')
  })

  it('double pointes « chaussette » puis pointes : la nature de longueur est vidée', async () => {
    const { w } = await mountView()
    await chooseType(w, 'dpn')
    await w.find('#tool-length-kind').setValue('sock')
    await chooseType(w, 'tips')
    expect(w.find('#tool-length-kind').element.value).toBe('')
  })

  it('quantité : « abc » laisse le champ vide, « 3a » devient « 3 »', async () => {
    const { w } = await mountView()
    await chooseType(w, 'circular')
    const q = w.find('#tool-quantity')
    await q.setValue('abc')
    expect(q.element.value).toBe('')
    await q.setValue('3a')
    expect(q.element.value).toBe('3')
  })
})

// @vitest-environment jsdom
// Fiche détail d'un outil (lot « stock d'outils », tâche 9). Même montage que
// YarnDetailView.spec.js : VRAIE base (fake-indexeddb), vraies actions Pinia, valeurs lues par
// paires <dt>/<dd> pour ne pas se contenter d'un fragment de texte quelque part dans la fiche.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { createRouter, createWebHistory } from 'vue-router'
import { db } from '@/db/db'
import fr from '@/i18n/fr.json'
import ToolDetailView from '@/views/ToolDetailView.vue'
import { useTrashStore } from '@/stores/trash'
import { coverIndexAfterRemoval } from '@/utils/yarn-photos'
import { createTestI18n } from './helpers/i18n-router'

vi.mock('@/utils/photo', () => ({ pickAndCropImage: vi.fn(async () => 'data:image/png;base64,NEW') }))

const i18n = createTestI18n()
const f = fr.tools.fields

function makeRouter(id) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/tools', name: 'tools', component: { template: '<div />' } },
      { path: '/tools/:id', name: 'tool', component: ToolDetailView },
      { path: '/tools/:id/edit', name: 'tool-edit', component: { template: '<div />' } },
      { path: '/tools/new', name: 'tool-new', component: { template: '<div />' } },
      { path: '/project/:id', name: 'project', component: { template: '<div />' } },
    ],
  })
  router.push({ name: 'tool', params: { id } })
  return router
}

async function mountView(toolData, { currency = 'EUR', projects = () => [] } = {}) {
  const id = await db.tools.add({ ...toolData })
  for (const p of projects(id)) await db.projects.add(p)
  const router = makeRouter(id)
  await router.isReady()
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    initialState: { settings: { unitSystem: 'metric', currency } },
    stubActions: false,
  })
  const w = mount(ToolDetailView, {
    global: { plugins: [pinia, i18n, router], stubs: { AppIcon: true, ThumbImage: true } },
  })
  await flushPromises()
  return { w, id, pinia }
}

function fieldValue(w, label) {
  const dts = w.findAll('.ydet__dt')
  const dds = w.findAll('.ydet__dd')
  const i = dts.findIndex((dt) => dt.text() === label)
  return i === -1 ? null : dds[i].text()
}

const CIRC = { category: 'needle', type: 'circular', sizeMm: 4, lengthCm: 80 }

beforeEach(async () => {
  vi.restoreAllMocks()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('ToolDetailView', () => {
  it('le prix garde la devise de la fiche, même si les réglages ont changé', async () => {
    const { w } = await mountView({ ...CIRC, price: 12.5, priceCurrency: 'EUR' }, { currency: 'USD' })
    expect(fieldValue(w, f.price.replace('{symbol}', '€'))).toBe('12,50')
    expect(fieldValue(w, f.price.replace('{symbol}', '$'))).toBeNull()
  })

  it('un prix sans devise (ancienne fiche) prend celle des réglages', async () => {
    const { w } = await mountView({ ...CIRC, price: 12.5 }, { currency: 'USD' })
    expect(fieldValue(w, f.price.replace('{symbol}', '$'))).toBe('12,50')
  })

  it('une aiguille montre la taille avec US et UK', async () => {
    const { w } = await mountView(CIRC)
    expect(fieldValue(w, f.size)).toBe('4 mm · US 6 · UK 8')
  })

  it('une taille à virgule prend le séparateur de la langue (3,5 mm)', async () => {
    const { w } = await mountView({ ...CIRC, sizeMm: 3.5 })
    expect(fieldValue(w, f.size)).toMatch(/^3,5 mm · US 4/)
  })

  it('un crochet montre US seul, sans UK', async () => {
    const { w } = await mountView({ category: 'hook', type: 'standard', sizeMm: 4 })
    const v = fieldValue(w, f.size)
    expect(v).toBe('4 mm · G-6')
  })

  it('un crochet à équivalent numérique est préfixé « US » (1,5 mm · US 8)', async () => {
    const { w } = await mountView({ category: 'hook', type: 'standard', sizeMm: 1.5, material: 'steel' })
    expect(fieldValue(w, f.size)).toBe('1,5 mm · US 8')
  })
  it('la matière choisit l’équivalent d’un crochet de 2,25 mm (acier US 2, sinon B-1)', async () => {
    const { w } = await mountView({ category: 'hook', type: 'standard', sizeMm: 2.25, material: 'steel' })
    expect(fieldValue(w, f.size)).toBe('2,25 mm · US 2')
    const { w: w2 } = await mountView({ category: 'hook', type: 'standard', sizeMm: 2.25, material: 'wood' })
    expect(fieldValue(w2, f.size)).toBe('2,25 mm · B-1')
  })

  it('une taille hors table s’affiche sans équivalence', async () => {
    const { w } = await mountView({ ...CIRC, sizeMm: 4.1 })
    expect(fieldValue(w, f.size)).toBe('4,1 mm')
  })

  it('affiche les champs communs saisis', async () => {
    const { w } = await mountView({
      ...CIRC,
      material: 'bamboo', brand: 'KnitPro', line: 'Zing', quantity: 2,
      purchasedAt: '2026-06-01', price: 12.5, shop: 'La Droguerie', storedIn: 'Tiroir bleu',
      status: 'lent', notes: 'Prêtée à Marie',
    })
    expect(fieldValue(w, fr.tools.fields.type)).toBe(fr.tools.types.circular)
    expect(fieldValue(w, f.length)).toBe('80 cm')
    expect(fieldValue(w, f.material)).toBe(fr.tools.materials.bamboo)
    expect(fieldValue(w, f.brand)).toBe('KnitPro')
    expect(fieldValue(w, f.line)).toBe('Zing')
    expect(fieldValue(w, f.quantity)).toBe('2')
    expect(fieldValue(w, f.purchasedAt)).toBe('01/06/2026')
    expect(fieldValue(w, f.price.replace('{symbol}', '€'))).toBe('12,50')
    expect(fieldValue(w, f.shop)).toBe('La Droguerie')
    expect(fieldValue(w, f.storedIn)).toBe('Tiroir bleu')
    expect(fieldValue(w, f.status)).toBe(fr.tools.statuses.lent)
    expect(fieldValue(w, f.notes)).toBe('Prêtée à Marie')
  })

  it('un champ vide n’a pas de ligne', async () => {
    const { w } = await mountView({ ...CIRC, brand: '', line: '', price: '', shop: '', storedIn: '', notes: '', purchasedAt: '' })
    for (const k of ['brand', 'line', 'shop', 'storedIn', 'notes', 'purchasedAt', 'material', 'handle', 'tunisianKind']) {
      expect(fieldValue(w, f[k]), k).toBeNull()
    }
    expect(w.findAll('.ydet__dt').map((d) => d.text().startsWith('Prix'))).not.toContain(true)
  })

  it('un crochet tunisien montre manche et forme traduits', async () => {
    const { w } = await mountView({ category: 'hook', type: 'tunisian', sizeMm: 5, lengthCm: 30, handle: 'ergonomic', tunisianKind: 'cabled' })
    expect(fieldValue(w, f.handle)).toBe(fr.tools.handles.ergonomic)
    expect(fieldValue(w, f.tunisianKind)).toBe(fr.tools.tunisianKinds.cabled)
  })

  it('un kit liste les tailles et les longueurs de câble présentes', async () => {
    const { w } = await mountView({
      category: 'kit', type: 'interchangeable', kitSizes: [3.5, 4, 5], kitCables: [60, 80, 80], lengthKind: 'short', brand: 'KnitPro',
    })
    const sizes = w.findAll('[data-test="kit-size"]').map((e) => e.text())
    expect(sizes).toEqual(['3,5 mm · US 4', '4 mm · US 6', '5 mm · US 8'])
    const cables = w.findAll('[data-test="kit-cable"]').map((e) => e.text())
    expect(cables).toEqual(['60 cm', '80 cm ×2'])
    expect(w.text()).toContain(fr.tools.kitContent)
  })

  it('un kit de crochets tunisiens : tailles en échelle crochet, câbles présents', async () => {
    const { w } = await mountView({
      category: 'kit', type: 'hookKit', tunisian: true, kitSizes: [4, 5], kitCables: [30, 30], brand: 'ChiaoGoo',
    })
    expect(w.findAll('[data-test="kit-size"]').map((e) => e.text())).toEqual(['4 mm · G-6', '5 mm · H-8'])
    expect(w.findAll('[data-test="kit-cable"]').map((e) => e.text())).toEqual(['30 cm ×2'])
  })

  it('une aiguille simple n’a pas de bloc contenu du kit', async () => {
    const { w } = await mountView(CIRC)
    expect(w.find('[data-test="kit-size"]').exists()).toBe(false)
    expect(w.text()).not.toContain(fr.tools.kitContent)
  })

  it('le menu propose Modifier / Dupliquer / Supprimer', async () => {
    const { w } = await mountView(CIRC)
    await w.find('.phdr__kebab').trigger('click')
    expect(w.findAll('.menu__item').map((b) => b.text())).toEqual([fr.common.edit, fr.common.duplicate, fr.common.delete])
  })

  it('« Modifier » va vers tool-edit', async () => {
    const { w, id } = await mountView(CIRC)
    await w.find('.phdr__kebab').trigger('click')
    await w.findAll('.menu__item')[0].trigger('click')
    await flushPromises()
    expect(w.vm.$router.currentRoute.value.name).toBe('tool-edit')
    expect(w.vm.$router.currentRoute.value.params.id).toBe(String(id))
  })

  it('« Dupliquer » va vers tool-new avec duplicateFrom', async () => {
    const { w, id } = await mountView(CIRC)
    await w.find('.phdr__kebab').trigger('click')
    await w.findAll('.menu__item')[1].trigger('click')
    await flushPromises()
    expect(w.vm.$router.currentRoute.value.name).toBe('tool-new')
    expect(w.vm.$router.currentRoute.value.query.duplicateFrom).toBe(String(id))
  })

  it('« Supprimer » retire l’outil de la base et le met en corbeille', async () => {
    const { w, id, pinia } = await mountView({ ...CIRC, brand: 'KnitPro' })
    const trashStore = useTrashStore(pinia)
    await w.find('.phdr__kebab').trigger('click')
    await w.findAll('.menu__item')[2].trigger('click')
    await vi.waitFor(() => expect(trashStore.moveToTrash).toHaveBeenCalledWith('tool', id))
    await vi.waitFor(async () =>
      expect(await db.trash.toArray()).toEqual([
        expect.objectContaining({ type: 'tool', payload: expect.objectContaining({ id, brand: 'KnitPro' }) }),
      ]),
    )
    await vi.waitFor(() => expect(w.vm.$router.currentRoute.value.name).toBe('tools'))
    expect(await db.tools.get(id)).toBeUndefined()
  })

  it('ajouter une photo l’écrit dans la galerie de l’outil', async () => {
    const { w, id } = await mountView({ ...CIRC, photos: ['data:a'] })
    await w.find('.btn--primary').trigger('click')
    await vi.waitFor(async () => expect((await db.tools.get(id)).photos).toEqual(['data:a', 'data:image/png;base64,NEW']))
  })

  it('retirer une photo la sort de la galerie et décale la couverture', async () => {
    const { w, id } = await mountView({ ...CIRC, photos: ['data:a', 'data:b', 'data:c'], coverIndex: 2 })
    await w.findAll('.pthumb__del')[0].trigger('click')
    await vi.waitFor(async () => {
      const t = await db.tools.get(id)
      expect(t.photos).toEqual(['data:b', 'data:c'])
      expect(t.coverIndex).toBe(1)
    })
  })

  it('coverIndexAfterRemoval : couverture retirée, avant, après', () => {
    expect(coverIndexAfterRemoval(2, 2)).toBe(0)
    expect(coverIndexAfterRemoval(0, 2)).toBe(1)
    expect(coverIndexAfterRemoval(3, 1)).toBe(1)
  })

  it('outil introuvable : message dédié', async () => {
    const router = makeRouter(9999)
    await router.isReady()
    const pinia = createTestingPinia({ createSpy: vi.fn, stubActions: false })
    const w = mount(ToolDetailView, { global: { plugins: [pinia, i18n, router], stubs: { AppIcon: true, ThumbImage: true } } })
    await flushPromises()
    expect(w.text()).toContain(fr.tools.notFound)
  })

  it('les nouvelles clés existent dans les 4 langues', async () => {
    const [en, de, es] = await Promise.all(['en', 'de', 'es'].map((l) => import(`@/i18n/${l}.json`).then((m) => m.default)))
    for (const d of [fr, en, de, es]) {
      for (const k of ['notFound', 'deleted', 'kitContent', 'sizeLineUk', 'photoLabel']) expect(d.tools[k], k).toBeTruthy()
      for (const k of ['classic', 'ergonomic', 'rubber', 'beaded']) expect(d.tools.handles[k], k).toBeTruthy()
      for (const k of ['fixed', 'cabled']) expect(d.tools.tunisianKinds[k], k).toBeTruthy()
      expect(Object.keys(d.tools.fields)).toEqual(Object.keys(fr.tools.fields))
    }
  })
})

// Protège la section « Projets » de la fiche outil : les projets qui la lient, chacun ouvre sa fiche.
describe('ToolDetailView : projets liés', () => {
  it('liste le projet qui utilise l’outil et ouvre sa fiche', async () => {
    const { w } = await mountView(CIRC, {
      projects: (id) => [
        { name: 'Bonnet rayé', status: 'wip', toolIds: [id] },
        { name: 'Pull sans outil', status: 'wip', toolIds: [] },
      ],
    })
    const links = w.findAll('[data-test="tool-project"]')
    expect(links.map((l) => l.text())).toEqual(['Bonnet rayé'])
    expect(w.text()).toContain(fr.tools.projects)
    const router = w.vm.$router
    await links[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('project')
  })

  it('sans projet lié, pas de section « Projets »', async () => {
    const { w } = await mountView(CIRC)
    expect(w.find('[data-test="tool-projects"]').exists()).toBe(false)
  })
})

// Protège les prises de kit sur la fiche du kit : taille prise nommée par son projet, câble pris compté.
describe('ToolDetailView : tailles et câbles pris d’un kit', () => {
  const ZING = { category: 'kit', type: 'interchangeable', kitSizes: [4, 5], kitCables: [80, 80, 100], brand: 'KnitPro' }
  it('une taille prise porte le nom du projet en cours ; un câble pris dit combien et par qui', async () => {
    const { w } = await mountView(ZING, {
      projects: (id) => [
        { name: 'Bonnet', status: 'wip', kitPicks: [{ toolId: id, sizeMm: 4, cableCm: 80 }] },
        { name: 'Fini', status: 'done', kitPicks: [{ toolId: id, sizeMm: 5, cableCm: 100 }] },
      ],
    })
    const tk = i18n.global.t
    expect(w.findAll('[data-test="kit-size"]').map((e) => e.text())).toEqual([tk('tools.kitTakenSize', { size: '4 mm · US 6', name: 'Bonnet' }), '5 mm · US 8'])
    expect(w.findAll('[data-test="kit-cable"]').map((e) => e.text())).toEqual([tk('tools.kitCableTaken', { cable: '80 cm ×2', n: 1, names: 'Bonnet' }), '100 cm'])
  })
  it('un 80 cm S et un 80 cm L restent deux lignes ; le câble pris dit son diamètre', async () => {
    const { w } = await mountView(
      { ...ZING, kitCables: [{ cm: 80, join: 's' }, { cm: 80, join: 's' }, { cm: 80, join: 'l' }, 100] },
      { projects: (id) => [{ name: 'Bonnet', status: 'wip', kitPicks: [{ toolId: id, sizeMm: 4, cableCm: 80, cableJoin: 'l' }] }] },
    )
    const tk = i18n.global.t
    const lines = w.findAll('[data-test="kit-cable"]')
    expect(lines.map((e) => e.text())).toEqual(['80 cm S ×2', tk('tools.kitCableTaken', { cable: '80 cm L', n: 1, names: 'Bonnet' }), '100 cm'])
    expect(w.text()).not.toMatch(/\bs\b|\bmini\b/)
  })
  it('les projets qui prennent une taille du kit figurent dans « Projets »', async () => {
    const { w } = await mountView(ZING, {
      projects: (id) => [
        { name: 'Ancien lien', status: 'wip', toolIds: [id] },
        { name: 'Bonnet', status: 'done', kitPicks: [{ toolId: id, sizeMm: 4, cableCm: null }] },
        { name: 'Sans kit', status: 'wip' },
      ],
    })
    expect(w.findAll('[data-test="tool-project"]').map((l) => l.text()).sort()).toEqual(['Ancien lien', 'Bonnet'])
  })
})

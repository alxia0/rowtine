// @vitest-environment jsdom
// Unitaire : composable useToolParking. Libérer les outils à la pause, les reprendre à la
// reprise ; applyStatus(extra) est appelé EXACTEMENT UNE FOIS sur chaque chemin, y compris
// le Retour Android qui ferme directement le store tool-parking (App.vue).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { STATUS_ORDER } from '@/constants/status'
import { db } from '@/db/db'
import { useToolParking } from '@/composables/useToolParking'
import { useToolParkingStore } from '@/stores/tool-parking'

function mountParking() {
  const pinia = createPinia()
  const Comp = defineComponent({
    setup: () => ({ tp: useToolParking() }),
    render: () => h('div'),
  })
  return mount(Comp, { global: { plugins: [pinia] } })
}

const tick = () => new Promise((r) => setTimeout(r, 50))

async function addTool(extra = {}) {
  return db.tools.add({ type: 'needle', name: 'Aiguille', ...extra })
}

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('useToolParking', () => {
  it('pause sans outil lié : applyStatus({}) tout de suite, open reste false', async () => {
    const pid = await db.projects.add({ name: 'Pull', status: 'wip', toolIds: [], kitPicks: [] })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: 'wip' }, 'pause', applyStatus)
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({})
    expect(w.vm.tp.open).toBe(false)
  })

  it('pause avec outil lié : open true, mode pause, rien écrit ; confirm([]) appelle applyStatus avec toolIds [], kitPicks [] et parkedTools égal aux anciens liens', async () => {
    const tid = await addTool()
    const pid = await db.projects.add({ name: 'Pull', status: 'wip', toolIds: [tid], kitPicks: [] })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: 'wip' }, 'pause', applyStatus)
    expect(w.vm.tp.open).toBe(true)
    expect(w.vm.tp.mode).toBe('pause')
    expect(applyStatus).not.toHaveBeenCalled()
    expect((await db.projects.get(pid)).toolIds).toEqual([tid])
    await w.vm.tp.confirm([])
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({ toolIds: [], kitPicks: [], parkedTools: { toolIds: [tid], kitPicks: [] } })
    expect(w.vm.tp.open).toBe(false)
  })

  it('pause : cancel() appelle applyStatus({}) une seule fois (liens gardés)', async () => {
    const tid = await addTool()
    const pid = await db.projects.add({ name: 'Pull', status: 'wip', toolIds: [tid], kitPicks: [] })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: 'wip' }, 'pause', applyStatus)
    await w.vm.tp.cancel()
    await w.vm.tp.cancel()
    await tick()
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({})
  })

  it('pause : un outil à la corbeille (absent du stock) ne pose aucune question', async () => {
    const pid = await db.projects.add({ name: 'Pull', status: 'wip', toolIds: [999], kitPicks: [] })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: 'wip' }, 'pause', applyStatus)
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({})
    expect(w.vm.tp.open).toBe(false)
  })

  it('reprise : confirm([\'tool:1\']) appelle applyStatus avec toolIds contenant 1 et parkedTools null', async () => {
    const tid = await addTool()
    const pid = await db.projects.add({ name: 'Pull', status: 'pause', toolIds: [], kitPicks: [], parkedTools: { toolIds: [tid], kitPicks: [] } })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: 'pause' }, 'wip', applyStatus)
    expect(w.vm.tp.open).toBe(true)
    expect(w.vm.tp.mode).toBe('resume')
    await w.vm.tp.confirm([`tool:${tid}`])
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({ toolIds: [tid], kitPicks: [], parkedTools: null })
  })

  it('reprise avec outil pris ailleurs : l\'entrée est free false, confirm([\'tool:1\']) ne le relie pas', async () => {
    const tid = await addTool()
    const pid = await db.projects.add({ name: 'Pull', status: 'pause', toolIds: [], kitPicks: [], parkedTools: { toolIds: [tid], kitPicks: [] } })
    await db.projects.add({ name: 'Autre', status: 'wip', toolIds: [tid], kitPicks: [] })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: 'pause' }, 'wip', applyStatus)
    expect(w.vm.tp.entries).toHaveLength(1)
    expect(w.vm.tp.entries[0].free).toBe(false)
    await w.vm.tp.confirm([`tool:${tid}`])
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({ toolIds: [], kitPicks: [], parkedTools: null })
  })

  it('reprise : cancel() appelle applyStatus({ parkedTools: null })', async () => {
    const tid = await addTool()
    const pid = await db.projects.add({ name: 'Pull', status: 'pause', toolIds: [], kitPicks: [], parkedTools: { toolIds: [tid], kitPicks: [] } })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: 'pause' }, 'wip', applyStatus)
    await w.vm.tp.cancel()
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({ parkedTools: null })
  })

  it('reprise avec tout périmé : applyStatus({ parkedTools: null }) sans question', async () => {
    const pid = await db.projects.add({ name: 'Pull', status: 'pause', toolIds: [], kitPicks: [], parkedTools: { toolIds: [999], kitPicks: [] } })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: 'pause' }, 'wip', applyStatus)
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({ parkedTools: null })
    expect(w.vm.tp.open).toBe(false)
  })

  it('statut done depuis pause : applyStatus({}) sans question', async () => {
    const tid = await addTool()
    const pid = await db.projects.add({ name: 'Pull', status: 'pause', toolIds: [], kitPicks: [], parkedTools: { toolIds: [tid], kitPicks: [] } })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: 'pause' }, 'done', applyStatus)
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({})
    expect(w.vm.tp.open).toBe(false)
  })

  it('Retour Android : store.close() équivaut à cancel(), applyStatus une seule fois', async () => {
    const tid = await addTool()
    const pid = await db.projects.add({ name: 'Pull', status: 'wip', toolIds: [tid], kitPicks: [] })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: 'wip' }, 'pause', applyStatus)
    expect(useToolParkingStore().open).toBe(true)
    useToolParkingStore().close()
    await vi.waitFor(() => expect(applyStatus).toHaveBeenCalledTimes(1))
    await tick()
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({})
    expect(w.vm.tp.open).toBe(false)
  })

  // Garde-fou : les littéraux de statut utilisés par le composable existent vraiment.
  it('les statuts wip et pause sont des statuts réels de l\'application', () => {
    expect(STATUS_ORDER).toContain('wip')
    expect(STATUS_ORDER).toContain('pause')
  })

  it.each(['waiting', 'done', 'future', 'abandoned'])('%s -> pause : applyStatus({}) sans question', async (before) => {
    const tid = await addTool()
    const pid = await db.projects.add({ name: 'Pull', status: before, toolIds: [tid], kitPicks: [] })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: before }, 'pause', applyStatus)
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({})
    expect(w.vm.tp.open).toBe(false)
  })

  it('pause puis reprise : le lien d\'un outil à la corbeille reste sur le projet', async () => {
    const tid = await addTool()
    const pid = await db.projects.add({ name: 'Pull', status: 'wip', toolIds: [tid, 999], kitPicks: [] })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: 'wip' }, 'pause', applyStatus)
    await w.vm.tp.confirm([])
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({ toolIds: [999], kitPicks: [], parkedTools: { toolIds: [tid], kitPicks: [] } })
    // Reprise : on part de l'état écrit par la pause.
    await db.projects.update(pid, { status: 'pause', toolIds: [999], kitPicks: [], parkedTools: { toolIds: [tid], kitPicks: [] } })
    const w2 = mountParking()
    const apply2 = vi.fn()
    await w2.vm.tp.requestStatusChange({ id: pid, status: 'pause' }, 'wip', apply2)
    await w2.vm.tp.confirm([`tool:${tid}`])
    expect(apply2).toHaveBeenCalledExactlyOnceWith({ toolIds: [999, tid], kitPicks: [], parkedTools: null })
  })

  it.each(['waiting', 'future'])('%s -> wip avec du mis de côté : la question de reprise est posée', async (before) => {
    const tid = await addTool()
    const pid = await db.projects.add({ name: 'Pull', status: before, toolIds: [], kitPicks: [], parkedTools: { toolIds: [tid], kitPicks: [] } })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: before }, 'wip', applyStatus)
    expect(w.vm.tp.open).toBe(true)
    expect(w.vm.tp.mode).toBe('resume')
    expect(applyStatus).not.toHaveBeenCalled()
  })

  it('waiting -> wip sans rien de mis de côté : aucune question', async () => {
    const pid = await db.projects.add({ name: 'Pull', status: 'waiting', toolIds: [], kitPicks: [] })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: 'waiting' }, 'wip', applyStatus)
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({})
    expect(w.vm.tp.open).toBe(false)
  })

  it('wip -> wip : jamais de question, même avec du mis de côté', async () => {
    const tid = await addTool()
    const pid = await db.projects.add({ name: 'Pull', status: 'wip', toolIds: [], kitPicks: [], parkedTools: { toolIds: [tid], kitPicks: [] } })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: 'wip' }, 'wip', applyStatus)
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({})
    expect(w.vm.tp.open).toBe(false)
  })

  it('pause : confirm lit le projet FRAIS quand l\'instantané de l\'appelant est périmé', async () => {
    const a = await addTool()
    const b = await addTool()
    const pid = await db.projects.add({ name: 'Pull', status: 'wip', toolIds: [a], kitPicks: [] })
    const w = mountParking()
    const applyStatus = vi.fn()
    await w.vm.tp.requestStatusChange({ id: pid, status: 'wip', toolIds: [a] }, 'pause', applyStatus)
    await db.projects.update(pid, { toolIds: [a, b] })
    await w.vm.tp.confirm([])
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith({ toolIds: [], kitPicks: [], parkedTools: { toolIds: [a, b], kitPicks: [] } })
  })
})

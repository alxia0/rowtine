// Restrictions d'un projet Terminé : patron/compteur/case à cocher gelés, rétablis
// dès que le statut change.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { db } from '@/db/db'
import ProjectDetailView from '@/views/ProjectDetailView.vue'
import StatusBadge from '@/components/StatusBadge.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

// seedCounters : mêmes compteurs qu'un projet standalone (cf. mountStandalone) — permet
// de vérifier les trois restrictions (patron, compteur, case) sur UN SEUL projet monté,
// alors qu'un patron+sections seul ne prouve rien sur le bloc compteurs.
async function mountWithPattern(status = 'wip', sections = [{ name: 'Corps', instructions: 'Rg 1\nRg 2' }], seedCounters = []) {
  await db.patterns.clear(); await db.projects.clear(); await db.counters.clear()
  const pid = await db.patterns.add({ name: 'Écharpe', sections })
  const prj = await db.projects.add({ name: 'Mon écharpe', patternId: pid, status, readerState: {} })
  for (const c of seedCounters) await db.counters.add({ projectId: prj, name: c.name, value: c.value ?? 0 })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/project/:id', name: 'project', component: ProjectDetailView },
    { path: '/project/:id/read', name: 'project-read', component: { template: '<div/>' } },
  ] })
  router.push(`/project/${prj}?tab=sections`); await router.isReady()
  const w = mount(ProjectDetailView, { global: { plugins: [router, i18n, createPinia()] } })
  return { w, router, pid: prj }
}

async function mountStandalone(status = 'wip', seedCounters = []) {
  await db.projects.clear(); await db.counters.clear()
  const prj = await db.projects.add({ name: 'Pull torsadé', technique: 'knitting', status })
  for (const c of seedCounters) await db.counters.add({ projectId: prj, name: c.name, value: c.value ?? 0 })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/project/:id', name: 'project', component: ProjectDetailView },
  ] })
  router.push(`/project/${prj}`); await router.isReady()
  const w = mount(ProjectDetailView, {
    global: { plugins: [router, i18n, createPinia()], stubs: { StatusBadge: true, CounterCard: true, CounterForm: true } },
  })
  return { w, router, pid: prj }
}

describe('ProjectDetailView — restrictions projet Terminé', () => {
  it('statut Terminé : bouton « Suivre le patron » absent du DOM, barre de progression conservée', async () => {
    const { w } = await mountWithPattern('done')
    await vi.waitFor(() => expect(w.findAll('.rovw').length).toBeGreaterThan(0), { timeout: 10000 })
    expect(w.find('.reader-btn').exists()).toBe(false)
    expect(w.find('.rprog').exists()).toBe(true)
  })

  it('statut en cours : bouton « Suivre le patron » présent (non-régression)', async () => {
    const { w } = await mountWithPattern('wip')
    await vi.waitFor(() => expect(w.findAll('.rovw').length).toBeGreaterThan(0), { timeout: 10000 })
    expect(w.find('.reader-btn').exists()).toBe(true)
  })

  it('statut Terminé : bouton « + Ajouter un compteur » absent', async () => {
    const { w } = await mountStandalone('done')
    await vi.waitFor(() => expect(w.find('.counters-block').exists()).toBe(true), { timeout: 10000 })
    expect(w.text()).not.toContain(fr.counter.add)
  })

  it('statut Terminé : les compteurs déjà créés restent affichés', async () => {
    const { w } = await mountStandalone('done', [{ name: 'Rangs', value: 3 }])
    await vi.waitFor(() => expect(w.find('.clist').exists()).toBe(true), { timeout: 10000 })
    expect(w.text()).not.toContain(fr.counter.add)
  })

  it('statut en cours : bouton « + Ajouter un compteur » présent (non-régression)', async () => {
    const { w } = await mountStandalone('wip')
    await vi.waitFor(() => expect(w.find('.counters-block').exists()).toBe(true), { timeout: 10000 })
    expect(w.text()).toContain(fr.counter.add)
  })

  it('statut Terminé : la case de section est désactivée, cocher n\'a aucun effet', async () => {
    const { w } = await mountWithPattern('done')
    await vi.waitFor(() => expect(w.find('.rovw__done input').exists()).toBe(true), { timeout: 10000 })
    const input = w.find('.rovw__done input')
    expect(input.element.disabled).toBe(true)
    await input.setValue(true)
    expect(w.text()).not.toContain(fr.reader.sectionDone)
  })

  it('statut en cours : la case de section reste active (non-régression)', async () => {
    const { w } = await mountWithPattern('wip')
    await vi.waitFor(() => expect(w.find('.rovw__done input').exists()).toBe(true), { timeout: 10000 })
    expect(w.find('.rovw__done input').element.disabled).toBe(false)
  })

  it('va-et-vient wip → done → wip → done : les trois restrictions (patron, compteur, case) apparaissent et disparaissent ensemble, sans rechargement', async () => {
    // Un seul projet monté, patron+sections ET compteur déjà créé — condition nécessaire
    // pour que .reader-btn, le bloc compteurs et .rovw__done input coexistent dans le DOM
    // et que les trois restrictions soient prouvées simultanément (pas seulement celle
    // du compteur, comme le faisait l'ancienne version avec mountStandalone).
    const { w, pid } = await mountWithPattern('wip', undefined, [{ name: 'Rangs', value: 3 }])
    await vi.waitFor(() => expect(w.findAll('.rovw').length).toBeGreaterThan(0), { timeout: 10000 })
    await vi.waitFor(() => expect(w.find('.counters-block').exists()).toBe(true), { timeout: 10000 })
    // Le bloc compteurs est toujours dans le DOM ; .clist n'apparaît qu'une fois le store des
    // compteurs chargé (async) — attendre explicitement, sinon la première assertWip() est
    // en course avec ce chargement (constaté sous suite complète, pas en fichier isolé).
    await vi.waitFor(() => expect(w.find('.clist').exists()).toBe(true), { timeout: 10000 })

    const assertWip = () => {
      expect(w.find('.reader-btn').exists()).toBe(true)
      expect(w.text()).toContain(fr.counter.add)
      expect(w.find('.clist').exists()).toBe(true)
      expect(w.find('.rovw__done input').element.disabled).toBe(false)
    }
    const assertDone = () => {
      expect(w.find('.reader-btn').exists()).toBe(false)
      expect(w.text()).not.toContain(fr.counter.add)
      expect(w.find('.clist').exists()).toBe(true) // le compteur déjà créé reste affiché
      expect(w.find('.rovw__done input').element.disabled).toBe(true)
    }

    assertWip()

    await w.findComponent(StatusBadge).vm.$emit('change', 'done')
    await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('done'), { timeout: 10000 })
    await vi.waitFor(() => expect(w.text()).not.toContain(fr.counter.add), { timeout: 10000 })
    assertDone()

    await w.findComponent(StatusBadge).vm.$emit('change', 'wip')
    await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('wip'), { timeout: 10000 })
    await vi.waitFor(() => expect(w.text()).toContain(fr.counter.add), { timeout: 10000 })
    assertWip()

    await w.findComponent(StatusBadge).vm.$emit('change', 'done')
    await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('done'), { timeout: 10000 })
    await vi.waitFor(() => expect(w.text()).not.toContain(fr.counter.add), { timeout: 10000 })
    assertDone()
  })

  it.each(['waiting', 'pause', 'future', 'abandoned'])('statut %s : aucune restriction (non-régression)', async (status) => {
    const { w } = await mountWithPattern(status)
    await vi.waitFor(() => expect(w.findAll('.rovw').length).toBeGreaterThan(0), { timeout: 10000 })
    expect(w.find('.reader-btn').exists()).toBe(true)
    expect(w.find('.rovw__done input').element.disabled).toBe(false)
  })

  it("formulaire d'ajout de compteur resté ouvert : le passage à Terminé le referme (watch isDone), le retour à en cours montre le bouton fermé, pas le formulaire", async () => {
    const { w, pid } = await mountStandalone('wip')
    await vi.waitFor(() => expect(w.find('.counters-block').exists()).toBe(true), { timeout: 10000 })

    const block = () => w.find('.counters-block')
    await block().findAll('button').find((b) => b.text().includes(fr.counter.add)).trigger('click')
    await vi.waitFor(() => expect(block().text()).toContain(fr.common.cancel), { timeout: 10000 })
    expect(block().text()).not.toContain(fr.counter.add)

    await w.findComponent(StatusBadge).vm.$emit('change', 'done')
    await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('done'), { timeout: 10000 })

    await w.findComponent(StatusBadge).vm.$emit('change', 'wip')
    await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('wip'), { timeout: 10000 })

    await vi.waitFor(() => expect(block().text()).toContain(fr.counter.add), { timeout: 10000 })
    expect(block().text()).not.toContain(fr.common.cancel)
  })
})

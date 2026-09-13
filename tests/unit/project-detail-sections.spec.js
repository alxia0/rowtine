// Fiche projet — onglet Sections unifié : aperçu « reader » dérivé, cochage sans navigation,
// guard v-if sur les cases. Les attentes sont des FAITS OBSERVABLES (`vi.waitFor` relit le
// DOM jusqu'à ce que l'attente soit vraie), pas des délais : les tuiles n'existent qu'après
// la cascade Dexie lancée au montage (~92 ms mesurées sous charge), et les six
// `setTimeout(40)` d'origine perdaient cette course une fois sur deux (05/09). Même philosophie que le `expect.poll` de
// tests/e2e/stats-journal-jours-actifs.spec.js, transposée à l'idiome des tests unitaires
// (cf. vitest.config.js : timeout explicite, plafonné sous le testTimeout de 20000 ms).
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { db } from '@/db/db'
import ProjectDetailView from '@/views/ProjectDetailView.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

async function mountDetail(sections = [{ name: 'Corps', instructions: 'Rg 1\nRg 2' }]) {
  await db.patterns.clear(); await db.projects.clear()
  const pid = await db.patterns.add({ name: 'Écharpe', sections })
  const prj = await db.projects.add({ name: 'Mon écharpe', patternId: pid, status: 'wip', readerState: {} })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/project/:id', name: 'project', component: ProjectDetailView },
    { path: '/project/:id/read', name: 'project-read', component: { template: '<div/>' } },
  ] })
  router.push(`/project/${prj}?tab=sections`); await router.isReady()
  const w = mount(ProjectDetailView, { global: { plugins: [router, i18n, createPinia()] } })
  return { w, router }
}

describe('ProjectDetailView — onglet Sections unifié', () => {
  it('affiche l\'aperçu reader (dérivé) et pas le formulaire de section manuelle', async () => {
    const { w } = await mountDetail()
    await vi.waitFor(() => expect(w.findAll('.rovw').length).toBeGreaterThan(0), { timeout: 10000 }) // aperçu reader présent
    expect(w.text()).not.toContain(fr.section.add)                // « + Ajouter une section » retiré
  })

  it('coche la case d’une section → la marque « Faite »', async () => {
    const { w } = await mountDetail()
    await vi.waitFor(() => expect(w.find('.rovw__done input').exists()).toBe(true), { timeout: 10000 })
    await w.find('.rovw__done input').setValue(true)
    // Le cochage traverse une écriture Dexie puis le re-render de l'aperçu : on attend le
    // badge « Faite », sa conséquence observable à l'écran, avant de lire quoi que ce soit.
    await vi.waitFor(() => expect(w.text()).toContain(fr.reader.sectionDone), { timeout: 10000 }) // badge « Faite »
  })

  it('cocher la case ne navigue PAS vers le lecteur', async () => {
    const { w, router } = await mountDetail()
    await vi.waitFor(() => expect(w.find('.rovw__done input').exists()).toBe(true), { timeout: 10000 })
    await w.find('.rovw__done input').setValue(true)
    // Assertion NÉGATIVE : pour qu'elle prouve quelque chose, il faut avoir laissé le temps
    // d'une navigation parasite de partir. On attend donc que le cochage ait été traité
    // JUSQU'À L'ÉCRAN (badge « Faite » rendu), puis on lit la route — l'ancien
    // `setTimeout(40)` ne garantissait ni le traitement, ni la fenêtre d'observation.
    await vi.waitFor(() => expect(w.text()).toContain(fr.reader.sectionDone), { timeout: 10000 })
    expect(router.currentRoute.value.name).toBe('project')          // toujours sur la fiche
  })

  it('une section sans rang cochable n’a pas de case (guard v-if)', async () => {
    // 1 section avec rangs (cochable) + 1 section vide (diagramme, 0 rang cochable → total 0)
    const { w } = await mountDetail([
      { name: 'Corps', instructions: 'Rg 1\nRg 2' },
      { name: 'Schéma', instructions: '', isDiagram: true },
    ])
    // Attendre les DEUX tuiles rendues (pas la première venue) : c'est ce fait observable
    // qui rend la lecture des cases fiable — le guard v-if est alors évalué sur le rendu
    // complet, pas sur un aperçu encore en cours de montage.
    await vi.waitFor(() => expect(w.findAll('.rovw').length).toBe(2), { timeout: 10000 }) // les 2 tuiles s'affichent
    expect(w.findAll('.rovw__done').length).toBe(1)                // mais UNE seule case (section avec rangs)
  })
})

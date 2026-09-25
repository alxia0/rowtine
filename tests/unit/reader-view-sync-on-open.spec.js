// @vitest-environment jsdom
// Composant — ReaderView, câblage de la synchro MD ciblée à l'ouverture (Lot N3,
// tâche B). `syncPatronMdOnOpen` (src/backup/sync-on-open.js) est mocké : ce test
// couvre le CÂBLAGE (bon { kind, id } résolu, ordre synchro→relecture, non-blocage
// en cas d'échec, affichage d'un état de chargement) — pas la logique interne de la
// synchro (déjà couverte par sync-on-open.spec.js / patron-md-sync.spec.js).
//
// Approche : mêmes fixtures/mocks que ReaderView.spec.js (routeur mocké, base Dexie
// réelle), mais dans un fichier séparé pour ne pas alourdir ce spec déjà volumineux
// (et connu flaky en parallèle) avec les mocks de module supplémentaires.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'

const nav = vi.hoisted(() => ({
  route: { name: 'project-read', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

const syncOnOpen = vi.hoisted(() => ({ fn: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/backup/sync-on-open', () => ({
  syncPatronMdOnOpen: (...args) => syncOnOpen.fn(...args),
}))

import ReaderView from '@/views/ReaderView.vue'

const FIX_READER = {
  sizeLabels: [],
  sections: [{ id: 's1', title: 'Section 1', steps: [{ t: 'Rang un' }] }],
}
const NEW_READER = {
  sizeLabels: [],
  sections: [{ id: 's1', title: 'Section modifiée (PC)', steps: [{ t: 'Rang un modifié' }] }],
}

const wrappers = []
function mountReader({ onError } = {}) {
  const w = mount(ReaderView, {
    global: { plugins: [createPinia(), i18n], config: onError ? { errorHandler: onError } : {} },
  })
  wrappers.push(w)
  return w
}
// Laisse l'onMounted async (synchro + chargement) se vider, comme ReaderView.spec.js.
async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r))
  await flushPromises()
}

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  syncOnOpen.fn.mockClear()
  syncOnOpen.fn.mockResolvedValue(undefined)
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('ReaderView — synchro MD ciblée au montage', () => {
  it('projet FORKÉ (copy-on-write) → synchronise { kind: "project", id: projectId }', async () => {
    const patternId = await db.patterns.add({ name: 'P', type: 'knitting', reader: FIX_READER })
    const projectId = await db.projects.add({ name: 'Proj', technique: 'knitting', patternId })
    await db.patterns.update(patternId, { ownerProjectId: projectId })
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }

    mountReader()
    // La synchro est désormais lancée en TOUT DERNIER dans onMounted (correctif
    // 23/08, après le premier rendu) — un seul settle() n'est plus une attente
    // fiable de ce point précis de la chaîne ; vi.waitFor absorbe le nombre
    // réel de tours nécessaires.
    await vi.waitFor(async () => {
      await settle()
      expect(syncOnOpen.fn).toHaveBeenCalledWith({ kind: 'project', id: projectId })
    })
  })

  it('projet lié à un patron de bibliothèque partagé (non forké) → synchronise { kind: "pattern", id: patternId }', async () => {
    const patternId = await db.patterns.add({ name: 'Lib', type: 'knitting', reader: FIX_READER })
    const projectId = await db.projects.add({ name: 'Proj', technique: 'knitting', patternId })
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }

    mountReader()
    await vi.waitFor(async () => {
      await settle()
      expect(syncOnOpen.fn).toHaveBeenCalledWith({ kind: 'pattern', id: patternId })
    })
  })

  it('contexte bibliothèque (aperçu patron) → synchronise { kind: "pattern", id }', async () => {
    const patternId = await db.patterns.add({ name: 'Lib', type: 'knitting', reader: FIX_READER })
    nav.route = { name: 'pattern-read', params: { id: String(patternId) }, query: {} }

    mountReader()
    await vi.waitFor(async () => {
      await settle()
      expect(syncOnOpen.fn).toHaveBeenCalledWith({ kind: 'pattern', id: patternId })
    })
  })

  it('le patron est relu APRÈS la synchro : le contenu fusionné pendant la synchro est bien affiché', async () => {
    const patternId = await db.patterns.add({ name: 'Lib', type: 'knitting', reader: FIX_READER })
    nav.route = { name: 'pattern-read', params: { id: String(patternId) }, query: {} }
    // Simule une fusion qui réécrit le reader EN BASE pendant la synchro (comme le
    // ferait syncPatronMd) : si ReaderView ne relit pas après l'attente, le rendu
    // afficherait encore l'ancienne version chargée avant l'appel.
    syncOnOpen.fn.mockImplementationOnce(async ({ id }) => {
      await db.patterns.update(id, { reader: NEW_READER })
    })

    const w = mountReader()
    await vi.waitFor(async () => {
      await settle()
      expect(w.text()).toContain('Section modifiée (PC)')
    }, { timeout: 10000 })
  })

  it('la synchro peut aussi réécrire project.readerState (fan-out) : relu après coup', async () => {
    const patternId = await db.patterns.add({ name: 'Lib', type: 'knitting', reader: FIX_READER })
    const projectId = await db.projects.add({ name: 'Proj', technique: 'knitting', patternId })
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
    syncOnOpen.fn.mockImplementationOnce(async () => {
      await db.projects.update(projectId, { readerState: { size: null, done: { 's1#0': true }, counters: {}, chartRow: 1 } })
    })

    const w = mountReader()
    // `.rhdr__pct` existe désormais dès le premier rendu (contenu local, correctif
    // 23/08) : c'est son CONTENU qui doit attendre la synchro de fond, pas son
    // existence — la boucle doit donc porter sur le pourcentage lui-même.
    await vi.waitFor(async () => {
      await settle()
      expect(w.find('.rhdr__pct').text()).toBe('100 %')
    }, { timeout: 10000 })
  })

  it("une synchro qui échoue n'empêche pas l'ouverture du patron", async () => {
    const patternId = await db.patterns.add({ name: 'Lib', type: 'knitting', reader: FIX_READER })
    nav.route = { name: 'pattern-read', params: { id: String(patternId) }, query: {} }
    syncOnOpen.fn.mockRejectedValueOnce(new Error('boum'))

    const w = mountReader()
    await settle()

    expect(w.find('.reader').exists()).toBe(true)
    expect(w.find('.rhdr__title').text()).toBe('Lib')
  })

  it("affiche le suivi immédiatement depuis la base locale, SANS attendre la synchro à l'ouverture", async () => {
    // Correctif du 23/08/2026 : entrer dans le suivi ne doit plus attendre
    // syncOnOpen() (qui peut elle-même attendre plusieurs minutes une synchro
    // complète en cours, cf. mémoire synchro-ouverture-patron-bloque-nexus7).
    // La synchro mockée ici ne se résout JAMAIS : si ReaderView l'attendait
    // encore avant le premier rendu, `.reader` n'existerait jamais non plus.
    const patternId = await db.patterns.add({ name: 'Lib', type: 'knitting', reader: FIX_READER })
    nav.route = { name: 'pattern-read', params: { id: String(patternId) }, query: {} }
    syncOnOpen.fn.mockImplementationOnce(() => new Promise(() => {}))

    const w = mountReader()
    await settle()

    expect(w.find('.reader').exists()).toBe(true)
    expect(w.find('.rhdr__title').text()).toBe('Lib')
  })

  it("un patron supprimé PENDANT la synchro de fond ne fait pas planter l'écran déjà affiché", async () => {
    // Revue de code du 23/08/2026 (finding 1) : refreshAfterSync() lisait autrefois
    // directement dans pattern.value/project.value AVANT de vérifier que le résultat
    // existait encore — un patron supprimé pendant la synchro laissait alors des refs
    // nulles sous un écran resté affiché (v-if="ready" jamais réévalué).
    const patternId = await db.patterns.add({ name: 'Lib', type: 'knitting', reader: FIX_READER })
    nav.route = { name: 'pattern-read', params: { id: String(patternId) }, query: {} }
    syncOnOpen.fn.mockImplementationOnce(async () => {
      await db.patterns.delete(patternId)
    })

    // Un rendu qui plante après coup (ex. `pattern.name` sur `null`) ne fait PAS
    // échouer synchroniquement une assertion — Vue le route vers son errorHandler
    // (ou un rejet non géré) plutôt que de le lever au point d'appel. On le capture
    // explicitement pour que le test échoue vraiment s'il se reproduit.
    let renderError = null
    const w = mountReader({ onError: (err) => (renderError = err) })
    await settle()
    expect(w.find('.reader').exists()).toBe(true) // affiché immédiatement, contenu local

    await vi.waitFor(async () => {
      await settle()
      expect(syncOnOpen.fn).toHaveBeenCalled()
    })
    await settle()

    // L'écran reste tel quel — ni crash, ni titre vidé — plutôt que de déréférencer
    // un patron devenu introuvable.
    expect(renderError).toBeNull()
    expect(w.find('.reader').exists()).toBe(true)
    expect(w.find('.rhdr__title').text()).toBe('Lib')
  })

  it("une progression cochée pendant que la synchro de fond tourne encore n'est pas écrasée par la fusion", async () => {
    // Revue de code du 23/08/2026 (finding 2) : rendre le suivi interactif AVANT la
    // fin de la synchro ouvre une fenêtre où l'utilisatrice peut cocher un rang
    // pendant que la synchro calcule encore SA propre réconciliation à partir d'un
    // readerState capturé plus tôt (patron-md-sync.js, reconcileProgress) — sans
    // garde, l'écriture tardive de la synchro effacerait la coche fraîche.
    const patternId = await db.patterns.add({ name: 'P', type: 'knitting', reader: FIX_READER })
    const projectId = await db.projects.add({ name: 'Proj', technique: 'knitting', patternId })
    await db.patterns.update(patternId, { ownerProjectId: projectId })
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }

    let resolveSync
    syncOnOpen.fn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve
        }),
    )

    const w = mountReader()
    await settle()

    // Geste de suivi AVANT que la synchro ne se résolve.
    await w.find('.rcheck').trigger('click')
    await settle()
    expect(w.find('.rhdr__pct').text()).not.toBe('0 %')
    const afterClick = w.find('.rhdr__pct').text()

    // La synchro se résout ENSUITE, avec un readerState qui ne connaît pas cette
    // coche (capturé avant, comme le ferait reconcileProgress en conditions réelles).
    await db.projects.update(projectId, { readerState: { size: null, done: {}, counters: {}, chartRow: 1 } })
    resolveSync()
    await settle()

    expect(w.find('.rhdr__pct').text()).toBe(afterClick)
  })

  it("l'écran démonté avant la fin de la synchro de fond n'écrit plus dans une instance réutilisée", async () => {
    // Revue de code du 23/08/2026 (finding 6) : le `.then(refreshAfterSync)` n'avait
    // aucune garde de démontage — une navigation pendant la synchro pouvait faire
    // écrire un résultat périmé (voire, avec une instance de route réutilisée sur un
    // AUTRE id, sur le mauvais écran).
    const patternId = await db.patterns.add({ name: 'Lib', type: 'knitting', reader: FIX_READER })
    nav.route = { name: 'pattern-read', params: { id: String(patternId) }, query: {} }
    let resolveSync
    syncOnOpen.fn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve
        }),
    )

    const w = mountReader()
    await settle()
    w.unmount()
    wrappers.pop()

    resolveSync()
    // Ne doit lever ni exception ni rejet non géré une fois démonté.
    await expect(settle()).resolves.not.toThrow()
  })
})

// @vitest-environment jsdom
// pattern-view-photo-pdf.spec.js — Task #5 : la photo source (rendu de la 1re page du
// PDF importé) devient elle-même le point d'entrée vers le PDF original. La carte
// « PDF original » séparée disparaît ; son action (ouvrir le PDF) se déplace sur la photo.
// Sans PDF stocké, le tap sur une photo garde son comportement d'origine (lightbox).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import fr from '@/i18n/fr.json'
import { useLightboxStore } from '@/stores/lightbox'
import { useSnackbarStore } from '@/stores/snackbar'

const nav = vi.hoisted(() => ({
  route: { params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

// Mock du module d'ouverture externe : on prouve QUI est appelé (openPdfExternally vs
// lightbox), pas le détail natif/web (déjà couvert par open-pdf.spec.js).
const { openPdfExternally } = vi.hoisted(() => ({ openPdfExternally: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/utils/open-pdf', () => ({ openPdfExternally }))

import PatternView from '@/views/PatternView.vue'

async function seedPattern({ pdf, photos } = {}) {
  const id = await db.patterns.add({ name: 'Test', type: 'knitting', sizes: [], pdf, photos })
  nav.route.params = { id: String(id) }
  nav.route.query = {}
  return id
}

const wrappers = []
function mountView() {
  const w = mount(PatternView, { global: { plugins: [createPinia(), i18n] } })
  wrappers.push(w)
  return w
}

async function settle() {
  await flushPromises()
  await new Promise((r) => setTimeout(r))
  await flushPromises()
}

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  openPdfExternally.mockClear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('PatternView — la photo source ouvre le PDF (#5)', () => {
  it('avec un PDF stocké : tap sur la photo SOURCE (1re) ouvre le PDF, pas la visionneuse', async () => {
    await seedPattern({ pdf: 'data:application/pdf;base64,AAAA', photos: ['data:image/png;base64,BBBB'] })
    const w = mountView()
    await settle()
    const lightbox = useLightboxStore()
    const showSpy = vi.spyOn(lightbox, 'show')

    await w.find('.pphotos__img').trigger('click')

    expect(openPdfExternally).toHaveBeenCalledTimes(1)
    expect(openPdfExternally).toHaveBeenCalledWith('data:application/pdf;base64,AAAA', expect.stringContaining('.pdf'))
    expect(showSpy).not.toHaveBeenCalled()
  })

  it('I3 — avec un PDF stocké : tap sur une photo NON-source (perso) ouvre la visionneuse, pas le PDF', async () => {
    // Photo index 1 = photo perso ajoutée par l'utilisatrice : elle doit rester zoomable
    // (visionneuse), seule la source (index 0) ouvre le PDF.
    await seedPattern({ pdf: 'data:application/pdf;base64,AAAA', photos: ['data:image/png;base64,BBBB', 'data:image/png;base64,CCCC'] })
    const w = mountView()
    await settle()
    const lightbox = useLightboxStore()
    const showSpy = vi.spyOn(lightbox, 'show')

    await w.findAll('.pphotos__img')[1].trigger('click')

    expect(showSpy).toHaveBeenCalledWith(['data:image/png;base64,BBBB', 'data:image/png;base64,CCCC'], 1)
    expect(openPdfExternally).not.toHaveBeenCalled()
  })

  it('sans PDF stocké : tap sur la photo ouvre toujours la visionneuse (comportement inchangé)', async () => {
    await seedPattern({ pdf: '', photos: ['data:image/png;base64,BBBB', 'data:image/png;base64,CCCC'] })
    const w = mountView()
    await settle()
    const lightbox = useLightboxStore()
    const showSpy = vi.spyOn(lightbox, 'show')

    await w.findAll('.pphotos__img')[1].trigger('click')

    expect(showSpy).toHaveBeenCalledWith(['data:image/png;base64,BBBB', 'data:image/png;base64,CCCC'], 1)
    expect(openPdfExternally).not.toHaveBeenCalled()
  })

  it('la carte « PDF original » séparée a disparu, avec ou sans PDF', async () => {
    await seedPattern({ pdf: 'data:application/pdf;base64,AAAA', photos: ['data:image/png;base64,BBBB'] })
    const w = mountView()
    await settle()

    expect(w.find('.ppdf').exists()).toBe(false)
  })

  it('indice discret sous les photos quand un PDF est disponible', async () => {
    await seedPattern({ pdf: 'data:application/pdf;base64,AAAA', photos: ['data:image/png;base64,BBBB'] })
    const w = mountView()
    await settle()

    expect(w.text()).toContain(fr.pattern.tapSourceOpensPdf)
  })

  it("pas d'indice quand il n'y a pas de PDF", async () => {
    await seedPattern({ pdf: '', photos: ['data:image/png;base64,BBBB'] })
    const w = mountView()
    await settle()

    expect(w.text()).not.toContain(fr.pattern.tapSourceOpensPdf)
  })

  it('affiche un retour immédiat (snackbar) au tap sur la photo source, AVANT la fin de l’ouverture native (#3c)', async () => {
    // openPdfExternally écrit le PDF en cache puis ouvre la visionneuse native —
    // plusieurs centaines de ms sans retour visuel. Le snackbar doit s'afficher
    // AVANT l'await, pour accuser le tap immédiatement (cf. openExternal). Preuve
    // par une promesse jamais résolue pendant ce test : si `snackbar.show` n'était
    // appelé qu'APRÈS l'await (régression), il ne le serait toujours pas ici — le
    // test ne dépend donc pas de l'ordre des microtâches entre `trigger` et l'await.
    await seedPattern({ pdf: 'data:application/pdf;base64,AAAA', photos: ['data:image/png;base64,BBBB'] })
    const w = mountView()
    await settle()
    const snackbar = useSnackbarStore()
    const showSpy = vi.spyOn(snackbar, 'show')
    openPdfExternally.mockReturnValueOnce(new Promise(() => {}))

    await w.find('.pphotos__img').trigger('click')

    expect(showSpy).toHaveBeenCalledWith(fr.patternExtras.opening)
  })
})

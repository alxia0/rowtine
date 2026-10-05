// @vitest-environment jsdom
// pattern-view-preview.spec.js (#2/#3d) : la fiche patron est
// épurée (plus d'aperçu inline des sections/étapes/diagrammes) ; le bouton
// « Prévisualiser le patron » est restauré et mène au Lecteur en lecture seule
// (route pattern-read), qui porte désormais l'action « Corriger le patron »
// (cf. reader-view-correct-entry.spec.js). Remplace le contrat précédent (aperçu
// inline ReaderLine multi-taille), devenu obsolète.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import { makeTk } from './helpers/i18n-router'

// Mock vue-router : même approche que ProjectDetailView.spec.js / reader-view.spec.js
const nav = vi.hoisted(() => ({
  route: { params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import PatternView from '@/views/PatternView.vue'
import PatternForm from '@/components/PatternForm.vue'

const tk = makeTk(i18n)

async function seedPattern() {
  const id = await db.patterns.add({
    name: 'Test',
    type: 'knitting',
    sizes: ['S', 'M'],
    reader: {
      sizeLabels: ['S', 'M'],
      sections: [
        {
          id: 'sec-a',
          title: 'Section A',
          steps: [{ t: 'Monter {{0}} m', c: [[10, 12]] }],
        },
      ],
    },
  })
  nav.route.params = { id: String(id) }
  nav.route.query = {}
  return id
}

const wrappers = []
function mountView(attach = false) {
  const w = mount(PatternView, {
    ...(attach ? { attachTo: document.body } : {}),
    global: { plugins: [createPinia(), i18n] },
  })
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
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
})

describe('PatternView — fiche épurée + Prévisualiser', () => {
  it("n'affiche PAS l'aperçu inline des sections", async () => {
    await seedPattern()
    const w = mountView()
    await settle()
    expect(w.find('.psec').exists()).toBe(false)
  })

  it('affiche « Prévisualiser le patron » qui navigue vers pattern-read', async () => {
    const id = await seedPattern()
    const w = mountView()
    await settle()
    const btn = w.findAll('button').find((b) => b.text().includes('Prévisualiser'))
    expect(btn).toBeTruthy()
    await btn.trigger('click')
    expect(nav.router.push).toHaveBeenCalledWith({ name: 'pattern-read', params: { id } })
  })

  it("n'affiche plus « Corriger le patron » sur la fiche", async () => {
    await seedPattern()
    const w = mountView()
    await settle()
    expect(w.text()).not.toContain(tk('correction.entry'))
  })

  it('patron créé manuellement (sections vides, une galerie) : affiche quand même « Prévisualiser le patron » qui navigue vers pattern-read', async () => {
    const id = await db.patterns.add({
      name: 'Test',
      type: 'knitting',
      reader: { sizeLabels: [], sections: [] },
      gallery: [{ src: 'data:image/png;base64,GAL', page: 0, w: 10, h: 10 }],
    })
    nav.route.params = { id: String(id) }
    nav.route.query = {}
    const w = mountView()
    await settle()
    const btn = w.findAll('button').find((b) => b.text().includes('Prévisualiser'))
    expect(btn).toBeTruthy()
    await btn.trigger('click')
    expect(nav.router.push).toHaveBeenCalledWith({ name: 'pattern-read', params: { id } })
  })

  it('patron créé manuellement sans galerie ni section : le message « aucune section » reste affiché', async () => {
    const id = await db.patterns.add({ name: 'Test', type: 'knitting' })
    nav.route.params = { id: String(id) }
    nav.route.query = {}
    const w = mountView()
    await settle()
    expect(w.findAll('button').find((b) => b.text().includes('Prévisualiser'))).toBeFalsy()
    expect(w.text()).toContain(i18n.global.t('pattern.noSections'))
  })
})

describe('PatternView — lien vers le site de l’auteur', () => {
  // Protège : un authorUrl non http(s) déjà en base ne devient jamais un href exécutable.
  it('masque le lien si l’URL n’est pas en http(s)', async () => {
    const id = await db.patterns.add({ name: 'Test', type: 'knitting', author: 'A', authorUrl: 'javascript:alert(1)' })
    nav.route.params = { id: String(id) }
    const w = mountView()
    await settle()
    expect(w.find('a.author__link').exists()).toBe(false)
  })

  it('garde le lien pour une URL https', async () => {
    const id = await db.patterns.add({ name: 'Test', type: 'knitting', author: 'A', authorUrl: 'https://example.org' })
    nav.route.params = { id: String(id) }
    const w = mountView()
    await settle()
    expect(w.find('a.author__link').attributes('href')).toBe('https://example.org')
    // Protège : la marque de sortie est une icône du registre, jamais le glyphe texte.
    expect(w.find('a.author__link').text()).not.toContain('\u2197')
    expect(w.find('a.author__link .app-icon').exists()).toBe(true)
  })
})

describe('PatternView — saisie directe du designer', () => {
  async function monterSans(author, attach = false) {
    const id = await db.patterns.add({ name: 'Test', type: 'knitting', author })
    nav.route.params = { id: String(id) }
    nav.route.query = {}
    const w = mountView(attach)
    await settle()
    return { w, id }
  }

  // Protège : « ajouter » ouvre le formulaire d'édition avec le champ Auteur·rice focalisé.
  it('« ajouter » ouvre le formulaire et focalise le champ auteur', async () => {
    const { w } = await monterSans('', true)
    await w.find('[data-test="designer-add"]').trigger('click')
    await settle()
    expect(w.findComponent(PatternForm).exists()).toBe(true)
    expect(document.activeElement).toBe(w.find('#pat-author').element)
  })

  // Protège : le crayon ouvre le même formulaire sans déplacer le focus sur l'auteur.
  it('le crayon ouvre le formulaire sans focaliser le champ auteur', async () => {
    const { w } = await monterSans('', true)
    await w.find('.phdr__edit').trigger('click')
    await settle()
    expect(w.findComponent(PatternForm).exists()).toBe(true)
    expect(document.activeElement).not.toBe(w.find('#pat-author').element)
  })

  // Protège : enregistrer le formulaire ouvert par « ajouter » persiste l'auteur.
  it('« ajouter » puis enregistrer persiste author', async () => {
    const { w, id } = await monterSans('', true)
    await w.find('[data-test="designer-add"]').trigger('click')
    await settle()
    await w.find('#pat-author').setValue('Sys Fredens')
    await w.find('.btn--primary').trigger('click')
    await settle()
    expect((await db.patterns.get(id)).author).toBe('Sys Fredens')
  })

  // Protège : un author blanc ou non-chaîne affiche « ajouter » et aucune ligne « par ».
  it('author blanc ou non-chaîne : « ajouter » visible, pas de « par »', async () => {
    for (const author of ['  ', 42]) {
      const { w } = await monterSans(author)
      expect(w.find('[data-test="designer-add"]').exists()).toBe(true)
      expect(w.find('.author').exists()).toBe(false)
    }
  })

  it('designer présent : pas de ligne « ajouter »', async () => {
    const { w } = await monterSans('Sys')
    expect(w.find('[data-test="designer-add"]').exists()).toBe(false)
  })
})

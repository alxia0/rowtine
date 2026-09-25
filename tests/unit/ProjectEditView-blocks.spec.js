// @vitest-environment jsdom
// Le formulaire de projet (ProjectEditView.vue) était strictement
// plat (aucun <section>/<fieldset>/carte) : ce fichier prouve qu'il est désormais
// regroupé en <section class="card"> titrées, que chaque champ est dans le BON bloc, et
// surtout que le piège n°2 est respecté : `technique` reste dans le MÊME bloc que
// les aiguilles/crochet — sinon la cause (le sélecteur technique) serait séparée de son effet
// (le libellé « Aiguilles »/« Crochet » qui change dessous).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'

const nav = vi.hoisted(() => ({
  route: { params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({ useRoute: () => nav.route, useRouter: () => nav.router }))

import ProjectEditView from '@/views/ProjectEditView.vue'

function mountEdit() {
  return mount(ProjectEditView, { global: { plugins: [createPinia(), i18n] } })
}

// Même attente que ProjectEditView.spec.js (cf. son commentaire `waitHydrated`) : condition
// réelle (`hydrating` passe à `false` en toute fin d'onMounted), pas un délai fixe — décision
// produit, revue du 26/07.
async function waitHydrated(w) {
  await flushPromises()
  await vi.waitFor(() => expect(w.vm.hydrating).toBe(false), { timeout: 2000 })
  await flushPromises()
}

// Retrouve le titre (h2.card__title) du bloc <section class="card"> qui contient l'élément
// visé par `selector`.
function blockTitleOf(w, selector) {
  const el = w.find(selector).element
  const card = el.closest('.card')
  return card?.querySelector('.card__title')?.textContent?.trim()
}

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.route.params = {}
  nav.route.query = {}
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('ProjectEditView — formulaire en blocs titrés', () => {
  it('le formulaire est structuré en 5 sections .card, chacune titrée', async () => {
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5 })
    const w = mountEdit()
    await waitHydrated(w)
    const cards = w.findAll('section.card')
    expect(cards).toHaveLength(5)
    for (const c of cards) {
      expect(c.find('.card__title').text().length).toBeGreaterThan(0)
    }
  })

  it('le nom, le patron et le statut sont dans le même bloc (Identité)', async () => {
    const w = mountEdit()
    await waitHydrated(w)
    const nameCard = blockTitleOf(w, '#name')
    expect(blockTitleOf(w, '.pattern-sel')).toBe(nameCard)
    expect(blockTitleOf(w, '.chips')).toBe(nameCard)
    expect(nameCard).toBe(i18n.global.t('project.sectionIdentity'))
  })

  it('la laine reste dans son propre bloc, distinct de tout le reste', async () => {
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5 })
    const w = mountEdit()
    await waitHydrated(w)
    // Depuis l'ajout du filtre par marque : la liste des laines reste vide tant qu'aucune marque n'est
    // choisie — il faut filtrer par marque avant que `.ypick` existe dans le DOM.
    await w.find('.ypick__brandfilter select').setValue('Drops')
    await flushPromises()
    const yarnCard = blockTitleOf(w, '.ypick')
    expect(yarnCard).toBe(i18n.global.t('project.yarns'))
    expect(blockTitleOf(w, '#name')).not.toBe(yarnCard)
  })

  it('piège n°2 : technique et aiguilles/crochet cohabitent dans le MÊME bloc', async () => {
    const w = mountEdit()
    await waitHydrated(w)
    const techCard = blockTitleOf(w, '.toggle')
    const needleCard = blockTitleOf(w, '.needle-row')
    expect(techCard).toBeTruthy()
    expect(techCard).toBe(needleCard)
  })

  it('piège n°2 : le libellé sous les aiguilles change sous les yeux, dans ce même bloc, quand on bascule crochet', async () => {
    const w = mountEdit()
    await waitHydrated(w)
    // Par défaut : tricot -> libellé "Aiguilles".
    const needlesLabel = w.findAll('.field-label').find((l) => l.text() === i18n.global.t('project.needles'))
    expect(needlesLabel).toBeTruthy()

    const crochetBtn = w.findAll('.toggle__opt').find((b) => b.text() === i18n.global.t('technique.crochet'))
    await crochetBtn.trigger('click')
    await flushPromises()

    const hooksLabel = w.findAll('.field-label').find((l) => l.text() === i18n.global.t('project.hooks'))
    expect(hooksLabel).toBeTruthy()
    // Toujours dans le même bloc que le sélecteur technique (le lien reste visible) — on
    // vérifie d'abord que le bloc existe VRAIMENT (sinon les deux côtés valent `undefined`
    // et l'égalité passe à vide sans rien prouver).
    const toggleBlock = blockTitleOf(w, '.toggle')
    expect(toggleBlock).toBeTruthy()
    expect(toggleBlock).toBe(blockTitleOf(w, '.needle-row'))
  })

  it('mesures (échantillon + taille tricotée) et dates/notes forment 2 blocs distincts', async () => {
    const w = mountEdit()
    await waitHydrated(w)
    const gaugeCard = blockTitleOf(w, '#gs')
    expect(gaugeCard).toBe(blockTitleOf(w, '#asize'))
    const datesCard = blockTitleOf(w, '#start')
    expect(datesCard).toBe(blockTitleOf(w, '#notes'))
    expect(gaugeCard).not.toBe(datesCard)
    expect(gaugeCard).toBe(i18n.global.t('project.sectionMeasurements'))
    expect(datesCard).toBe(i18n.global.t('project.sectionDates'))
  })
})

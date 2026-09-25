// @vitest-environment jsdom
// Unitaire — YarnFilterDialog : navigation deux pages, set-filter + retour, option
// « toutes », coche sur la valeur courante, reset conditionnel, fermetures, groupes.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import YarnFilterDialog from '@/components/YarnFilterDialog.vue'
import { createTestI18n } from './helpers/i18n-router'

const i18n = createTestI18n()

// Deux critères : le premier sans groupe, le second avec deux groupes (options contiguës)
// pour tester les en-têtes.
const CRITERIA = [
  {
    key: 'weight',
    label: 'Épaisseur',
    allLabel: 'Toutes les épaisseurs',
    options: [
      { value: 'lace', label: 'Lace' },
      { value: 'dk', label: 'DK' },
    ],
  },
  {
    key: 'family',
    label: 'Couleur',
    allLabel: 'Toutes les couleurs',
    options: [
      { value: 'rouge', label: 'Rouge', group: 'Chaudes' },
      { value: 'orange', label: 'Orange', group: 'Chaudes' },
      { value: 'bleu', label: 'Bleu', group: 'Froides' },
    ],
  },
]

function mountDialog(filters = {}, resetLabel = 'Réinitialiser les filtres') {
  return mount(YarnFilterDialog, {
    props: { open: true, title: 'Filtrer', resetLabel, criteria: CRITERIA, filters },
    global: { plugins: [i18n] },
  })
}

// Ouvre la page des options du critère donné.
async function openOptions(w, key) {
  await w.find(`[data-test="filter-crit-${key}"]`).trigger('click')
}

describe('YarnFilterDialog', () => {
  it('fermé : rien n’est rendu', () => {
    const w = mount(YarnFilterDialog, {
      props: { open: false, title: 'Filtrer', resetLabel: '', criteria: CRITERIA, filters: {} },
      global: { plugins: [i18n] },
    })
    expect(w.find('[data-test="yarn-filter-dialog"]').exists()).toBe(false)
  })

  it('ouvert : un bouton par critère, titre visible', () => {
    const w = mountDialog()
    expect(w.text()).toContain('Filtrer')
    expect(w.findAll('[data-test^="filter-crit-"]')).toHaveLength(CRITERIA.length)
    expect(w.text()).toContain('Épaisseur')
    expect(w.text()).toContain('Couleur')
  })

  it('page critères : le texte secondaire porte le libellé « toutes » quand aucun filtre', () => {
    const w = mountDialog()
    expect(w.find('[data-test="filter-crit-weight"]').text()).toContain('Toutes les épaisseurs')
    expect(w.find('[data-test="filter-crit-family"]').text()).toContain('Toutes les couleurs')
  })

  it('page critères : le texte secondaire porte le libellé de l’option choisie', () => {
    const w = mountDialog({ weight: 'dk' })
    expect(w.find('[data-test="filter-crit-weight"]').text()).toContain('DK')
    // le critère sans filtre garde son libellé « toutes »
    expect(w.find('[data-test="filter-crit-family"]').text()).toContain('Toutes les couleurs')
  })

  it('navigation : un tap sur un critère ouvre SA page d’options', async () => {
    const w = mountDialog()
    await openOptions(w, 'weight')
    // les options du critère sont là, celles de l’autre critère jamais
    const labels = w.findAll('[data-test="filter-option"]').map((b) => b.text())
    expect(labels).toEqual(['Lace', 'DK'])
  })

  it('option « toutes » en tête de la page options, libellée avec allLabel', async () => {
    const w = mountDialog()
    await openOptions(w, 'weight')
    const all = w.find('[data-test="filter-all"]')
    expect(all.exists()).toBe(true)
    expect(all.text()).toContain('Toutes les épaisseurs')
    // en tête : premier élément cliquable de la liste d’options
    const first = w.find('.yfd__list button')
    expect(first.attributes('data-test')).toBe('filter-all')
  })

  it('choisir une option émet set-filter(key, value) et RETOURNE à la page critères', async () => {
    const w = mountDialog()
    await openOptions(w, 'weight')
    await w.findAll('[data-test="filter-option"]')[1].trigger('click') // DK
    expect(w.emitted('set-filter')[0]).toEqual(['weight', 'dk'])
    // retour à la page critères : plus d’options, plus de bouton Retour
    expect(w.find('[data-test="filter-option"]').exists()).toBe(false)
    expect(w.find('[data-test="filter-back"]').exists()).toBe(false)
    expect(w.find('[data-test="filter-crit-weight"]').exists()).toBe(true)
  })

  it('choisir « toutes » émet set-filter(key, \'\')', async () => {
    const w = mountDialog({ weight: 'dk' })
    await openOptions(w, 'weight')
    await w.find('[data-test="filter-all"]').trigger('click')
    expect(w.emitted('set-filter')[0]).toEqual(['weight', ''])
    expect(w.find('[data-test="filter-crit-weight"]').exists()).toBe(true)
  })

  it('page options : la coche marque la valeur courante, pas les autres (ni « toutes » si un filtre actif)', async () => {
    const w = mountDialog({ weight: 'dk' })
    await openOptions(w, 'weight')
    const all = w.find('[data-test="filter-all"]')
    const options = w.findAll('[data-test="filter-option"]')
    expect(all.find('.yfd__check').exists()).toBe(false)
    expect(options[0].text()).toContain('Lace')
    expect(options[0].find('.yfd__check').exists()).toBe(false)
    expect(options[1].find('.yfd__check').exists()).toBe(true)
    // aucune valeur courante → c’est « toutes » qui porte la coche
    const wVide = mountDialog({})
    await openOptions(wVide, 'weight')
    expect(wVide.find('[data-test="filter-all"] .yfd__check').exists()).toBe(true)
    expect(wVide.find('[data-test="filter-option"] .yfd__check').exists()).toBe(false)
  })

  it('le bouton Retour ramène à la page critères sans rien émettre', async () => {
    const w = mountDialog()
    await openOptions(w, 'weight')
    await w.find('[data-test="filter-back"]').trigger('click')
    expect(w.find('[data-test="filter-crit-weight"]').exists()).toBe(true)
    expect(w.find('[data-test="filter-back"]').exists()).toBe(false)
    expect(w.emitted('set-filter')).toBeUndefined()
    expect(w.emitted('close')).toBeUndefined()
  })

  it('Réinitialiser : absent sans filtre actif, présent dès qu’une valeur est non vide', () => {
    const inactif = mountDialog({})
    expect(inactif.find('[data-test="filter-reset"]').exists()).toBe(false)
    const actif = mountDialog({ weight: 'dk' })
    expect(actif.find('[data-test="filter-reset"]').exists()).toBe(true)
    expect(actif.find('[data-test="filter-reset"]').text()).toBe('Réinitialiser les filtres')
  })

  it('Réinitialiser : tap émet reset SANS fermer la popup', async () => {
    const w = mountDialog({ weight: 'dk' })
    await w.find('[data-test="filter-reset"]').trigger('click')
    expect(w.emitted('reset')).toBeTruthy()
    // la popup reste ouverte : c’est le parent qui vide `filters`, la page se rafraîchit par props
    expect(w.find('[data-test="yarn-filter-dialog"]').exists()).toBe(true)
    expect(w.emitted('close')).toBeUndefined()
  })

  it('Réinitialiser : jamais rendu sans libellé, même avec des filtres actifs', () => {
    const w = mountDialog({ weight: 'dk' }, '')
    expect(w.find('[data-test="filter-reset"]').exists()).toBe(false)
  })

  it('en-têtes de groupe rendus une fois chacun, avec leurs options dessous', async () => {
    const w = mountDialog()
    await openOptions(w, 'family')
    const groups = w.findAll('.yfd__group').map((g) => g.text())
    expect(groups).toEqual(['Chaudes', 'Froides'])
    const labels = w.findAll('[data-test="filter-option"]').map((b) => b.text())
    expect(labels).toEqual(['Rouge', 'Orange', 'Bleu'])
  })

  it('close : par le bouton Fermer, par le scrim', async () => {
    const w = mountDialog()
    await w.find('[data-test="filter-close"]').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    await w.find('.yfd__scrim').trigger('click')
    expect(w.emitted('close')).toHaveLength(2)
  })

  it('close : sur Échap quand monté déjà ouvert', () => {
    const w = mountDialog()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })
})

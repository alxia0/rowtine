// @vitest-environment jsdom
// Écran vide accueillant du stock (P2 T5) — sur un stock VRAIMENT vide (0 laine), on affiche
// une carte exemple factice (badgée « Exemple », cf. tests/unit/stash-empty-example.spec.js
// pour le détail de cette carte) + le texte guidant, et on masque recherche/tri/compteurs (des
// outils pour trier du rien). Dès la 1ʳᵉ laine, tout redevient visible.
// Piège du chantier : un test « stock non vide » doit avoir de VRAIES données —
// sinon on retombe dans le piège d'un test qui vise un élément non rendu faute de données.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import fr from '@/i18n/fr.json'
import StashView from '@/views/StashView.vue'
import { createTestI18n, makeTk } from './helpers/i18n-router'

const i18n = createTestI18n()

const tk = makeTk(i18n)
const stubs = { AppHeader: true, AppIcon: true, ThumbImage: true, YarnWeightHelp: true, ColorPickerDialog: true }

// Une vraie laine, avec les champs qui alimentent le récap (quantity/lengthM/grams) —
// sinon un test « stock non vide » pourrait passer avec un stock 100 % vide de contenu utile.
function realYarn(overrides = {}) {
  return {
    id: 1,
    brand: 'Drops',
    model: 'Baby Merino',
    colorName: 'Bleu glacier',
    color: 'hsl(210, 60%, 55%)',
    weight: 'dk',
    lengthM: 100,
    grams: 50,
    quantity: 3,
    price: 4.5,
    bain: '',
    purchasedAt: '2026-01-10',
    composition: ['laine'],
    reservations: {},
    consumed: {},
    photo: '',
    ...overrides,
  }
}

function mountView(yarns, settingsState) {
  const pinia = createTestingPinia({
    createSpy: vi.fn,
    initialState: {
      yarns: { yarns, loaded: true },
      projects: { projects: [], loaded: true },
      settings: { loaded: true, ...settingsState },
    },
  })
  return mount(StashView, { global: { plugins: [pinia, i18n], stubs } })
}

describe('StashView — écran vide accueillant', () => {
  it('stock vide : carte exemple + texte guidant présents', () => {
    const w = mountView([])
    expect(w.find('.ycard--example').exists()).toBe(true)
    expect(w.text()).toContain(fr.yarn.emptyExampleHint)
  })

  it('stock vide en réglage impérial : la carte exemple suit le réglage, jamais figée en mètres (revue finale 26/07)', () => {
    // Scénario du correctif : une utilisatrice qui choisit Imperial à l'accueil arrive sur
    // son 1er lancement (stock vide) — avant correctif, la carte exemple écrivait
    // « 175 m · 250 g » en dur, quel que soit le réglage choisi.
    const w = mountView([], { unitSystem: 'imperial' })
    const meta = w.find('.ycard--example .ycard__meta').text()
    expect(meta).toContain(tk('yarn.unit.yd'))
    expect(meta).not.toContain('175 m')
    expect(meta).not.toContain('250 g')
  })

  it('stock vide : recherche, tri et compteurs sont DÉMONTÉS (pas juste invisibles)', () => {
    const w = mountView([])
    expect(w.find('input[placeholder="Rechercher une laine…"]').exists()).toBe(false)
    expect(w.find('.toolbar').exists()).toBe(false)
    expect(w.find('.recap').exists()).toBe(false)
  })

  it('stock vide : le bouton « Ajouter une laine » reste accessible (seul moyen de sortir du vide)', () => {
    const w = mountView([])
    const addBtn = w.findAll('button').find((b) => b.text().includes(fr.yarn.add))
    expect(addBtn.exists()).toBe(true)
  })

  it('stock NON vide (données réelles) : recherche, tri et compteurs reviennent, illustration disparaît', () => {
    const w = mountView([realYarn()])
    // Preuve que le stock a RÉELLEMENT des données (pas un tableau non-vide vide de sens) :
    // la laine est bien rendue à l'écran.
    expect(w.text()).toContain('Drops')
    expect(w.text()).toContain('Bleu glacier')
    expect(w.find('.recap__num').exists()).toBe(true)
    expect(w.find('.recap__num').text()).toBe('3') // quantity de la laine réelle ci-dessus

    expect(w.find('input[placeholder="Rechercher une laine…"]').exists()).toBe(true)
    expect(w.find('.toolbar').exists()).toBe(true)
    expect(w.find('.recap').exists()).toBe(true)
    expect(w.find('.ycard--example').exists()).toBe(false)
  })

  it('stock non vide mais recherche sans résultat : recherche/tri restent affichés (pas un stock vide)', async () => {
    const w = mountView([realYarn()])
    await w.find('input[placeholder="Rechercher une laine…"]').setValue('introuvable')
    expect(w.find('input[placeholder="Rechercher une laine…"]').exists()).toBe(true)
    expect(w.find('.toolbar').exists()).toBe(true)
  })

  it('stock rempli mais recherche sans résultat : « aucune correspondance » + effacement, PAS « Stock vide » (dette audit UX 16/07)', async () => {
    const w = mountView([realYarn()])
    await w.find('input[placeholder="Rechercher une laine…"]').setValue('introuvable')
    // Le message trompeur « Stock vide. Ajoute ta première laine. » est réservé au VRAI
    // état vide (0 laine) — sur un stock rempli, on propose d'effacer recherche + filtres.
    expect(w.text()).not.toContain(fr.yarn.empty)
    expect(w.text()).toContain(fr.yarn.noMatch)
    // Le bouton d'effacement vide la recherche : la carte laine réapparaît.
    await w.find('[data-test="no-match-clear"]').trigger('click')
    expect(w.find('input[placeholder="Rechercher une laine…"]').element.value).toBe('')
    expect(w.text()).toContain('Drops')
  })
})

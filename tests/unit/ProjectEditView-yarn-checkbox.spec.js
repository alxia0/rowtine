// @vitest-environment jsdom
// (P2, audit UX 17/07) — La sélection des laines dans ProjectEditView.vue
// utilise désormais AppCheckbox (case maison) au lieu d'un <input type="checkbox"> natif.
// Piège : ce n'est PAS un v-model simple — `:checked="selectedYarnIds.includes(y.id)"`
// + `@change="toggleYarn(y.id)"` sur une LISTE (sélection multiple). Ce fichier prouve que
// le remplacement n'a pas cassé : (1) la sélection multiple (2 laines cochables
// indépendamment), (2) le pool de pelotes (le sélecteur de quantité apparaît/disparaît
// avec la coche, borné par le disponible). tests/unit/ProjectEditView.spec.js reste la
// référence de non-régression du reste du formulaire (inchangé).
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
import AppCheckbox from '@/components/AppCheckbox.vue'

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

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.route.params = {}
  nav.route.query = {}
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('ProjectEditView — sélection des laines via AppCheckbox', () => {
  it('une AppCheckbox par laine sélectionnable (case maison, pas de checkbox natif nu)', async () => {
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5 })
    await db.yarns.add({ brand: 'Drops', colorName: 'Vert', quantity: 3 })
    const w = mountEdit()
    await waitHydrated(w)
    // Depuis l'ajout du filtre par marque : la liste reste vide tant qu'aucune marque n'est choisie —
    // les deux laines partagent la marque « Drops » pour apparaître ensemble d'un seul filtre.
    await w.find('.ypick__brandfilter select').setValue('Drops')
    await flushPromises()

    // Spec 08/09 : une TROISIÈME AppCheckbox existe désormais dans le formulaire
    // (l'interrupteur « Chrono », project.showTimer) — hors du sélecteur de laines.
    // On compte donc les cases PORTEUSES PAR LE SÉLECTEUR (classe ypick__pick posée par
    // la vue) : exactement une par laine filtrée, jamais celle du champ Chrono.
    const checkboxesLaines = w
      .findAllComponents(AppCheckbox)
      .filter((c) => c.classes().includes('ypick__pick'))
    expect(checkboxesLaines).toHaveLength(2)
  })

  it('sélection multiple : cocher une 2ᵉ laine ne décoche pas la 1ʳᵉ', async () => {
    const yid1 = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5 })
    const yid2 = await db.yarns.add({ brand: 'Drops', colorName: 'Vert', quantity: 3 })
    const w = mountEdit()
    await waitHydrated(w)
    // Idem, filtrer par marque pour voir les deux laines à la fois.
    await w.find('.ypick__brandfilter select').setValue('Drops')
    await flushPromises()

    const rows = w.findAll('.ypick__row')
    expect(rows).toHaveLength(2)
    await rows[0].find('input[type="checkbox"]').trigger('change')
    await rows[1].find('input[type="checkbox"]').trigger('change')

    // `.ypick__row--on` reflète `selectedYarnIds.includes(y.id)` (état RÉEL de l'appli,
    // pas la propriété DOM .checked que `setValue`/`trigger` peut positionner sans que
    // `toggleYarn` ait vraiment tourné) — c'est la preuve que le clic a bien agi sur le
    // store, pas seulement sur l'input.
    expect(w.findAll('.ypick__row')[0].classes()).toContain('ypick__row--on')
    expect(w.findAll('.ypick__row')[1].classes()).toContain('ypick__row--on')
    void yid1
    void yid2
  })

  it('décocher une laine ne touche pas la sélection de l’autre (pool de pelotes préservé)', async () => {
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5 })
    await db.yarns.add({ brand: 'Drops', colorName: 'Vert', quantity: 3 })
    const w = mountEdit()
    await waitHydrated(w)
    // Idem, filtrer par marque pour voir les deux laines à la fois.
    await w.find('.ypick__brandfilter select').setValue('Drops')
    await flushPromises()

    const rows = w.findAll('.ypick__row')
    await rows[0].find('input[type="checkbox"]').setValue(true)
    await rows[1].find('input[type="checkbox"]').setValue(true)
    // le sélecteur de quantité (pool) est apparu pour les 2
    expect(w.findAll('.ypick__qtyin')).toHaveLength(2)

    await rows[0].find('input[type="checkbox"]').setValue(false)
    await flushPromises()

    expect(w.findAll('.ypick__qtyin')).toHaveLength(1) // seule la laine encore cochée garde son stepper
    expect(rows[1].find('input[type="checkbox"]').element.checked).toBe(true)
  })

  it('cocher une laine fait apparaître le sélecteur de quantité (pool), borné au disponible', async () => {
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 4 })
    const w = mountEdit()
    await waitHydrated(w)
    // Depuis l'ajout du filtre par marque : la liste reste vide tant qu'aucune marque n'est choisie.
    await w.find('.ypick__brandfilter select').setValue('Drops')
    await flushPromises()

    expect(w.find('.ypick__qtyin').exists()).toBe(false)
    await w.find('.ypick__row input[type="checkbox"]').setValue(true)
    await flushPromises()

    const qtyInput = w.find('.ypick__qtyin')
    expect(qtyInput.exists()).toBe(true)
    expect(qtyInput.attributes('max')).toBe('4')
  })
})

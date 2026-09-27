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

    // Plus de `max` HTML5 (type="number" abandonné, la virgule y vidait le champ) : le
    // bornage se prouve désormais en tapant au-dessus du disponible.
    const qtyInput = w.find('.ypick__qtyin')
    expect(qtyInput.exists()).toBe(true)
    await qtyInput.setValue('9')
    expect(w.find('.ypick__qtyin').element.value).toBe('4')
  })

  // Protège : la réécriture bornée reste avec la virgule française, pas le point JS d'un `String(next)` nu.
  it('bornage au-dessus d’un disponible décimal : réécrit avec la virgule, pas le point JS', async () => {
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 4.5 })
    const w = mountEdit()
    await waitHydrated(w)
    await w.find('.ypick__brandfilter select').setValue('Drops')
    await flushPromises()
    await w.find('.ypick__row input[type="checkbox"]').setValue(true)
    await flushPromises()

    const qtyInput = w.find('.ypick__qtyin')
    await qtyInput.setValue('9,9')
    expect(w.find('.ypick__qtyin').element.value).toBe('4,5')
  })

  // Le disponible affiché (coché ou pas) suit la locale.
  it('disponible affiché avec la virgule, cochée ou pas (« / 2,5 pelotes », « ×2,5 »)', async () => {
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 2.5 })
    const w = mountEdit()
    await waitHydrated(w)
    await w.find('.ypick__brandfilter select').setValue('Drops')
    await flushPromises()

    expect(w.find('.ypick__meta').text()).toBe('×2,5')

    await w.find('.ypick__row input[type="checkbox"]').setValue(true)
    await flushPromises()
    expect(w.find('.ypick__unit').text()).toContain('2,5')
  })

  // Décimalisation : le pool de pelotes accepte désormais un chiffre après la virgule.
  it('quantité du pool : « 1,5 » saisi est retenu tel quel, « 2, » reste tapable jusqu’à « 2,5 »', async () => {
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 4 })
    const w = mountEdit()
    await waitHydrated(w)
    await w.find('.ypick__brandfilter select').setValue('Drops')
    await flushPromises()
    await w.find('.ypick__row input[type="checkbox"]').setValue(true)
    await flushPromises()

    const qtyInput = w.find('.ypick__qtyin')
    await qtyInput.setValue('1,5')
    expect(qtyInput.element.value).toBe('1,5')

    // « 2, » ne doit pas être réécrit sous le doigt avant que la virgule n'ait pu rejoindre son « 5 ».
    await qtyInput.setValue('2,')
    expect(qtyInput.element.value).toBe('2,')
    await qtyInput.setValue('2,5')
    expect(qtyInput.element.value).toBe('2,5')
  })

  // Un caractère refusé (lettre, signe moins) est retiré de l'affichage à la frappe, pas seulement de la valeur retenue.
  it('quantité du pool : un caractère refusé est filtré de l’affichage (« 2a » → « 2 », « -5 » → « 5 »)', async () => {
    await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 30 })
    const w = mountEdit()
    await waitHydrated(w)
    await w.find('.ypick__brandfilter select').setValue('Drops')
    await flushPromises()
    await w.find('.ypick__row input[type="checkbox"]').setValue(true)
    await flushPromises()

    const qtyInput = w.find('.ypick__qtyin')
    await qtyInput.setValue('2a')
    expect(qtyInput.element.value).toBe('2')
    await qtyInput.setValue('-5')
    expect(qtyInput.element.value).toBe('5')
  })

  // Protège : la quantité tapée est bien celle réservée en base, pas seulement celle affichée.
  it('quantité du pool : « 1,5 » saisi est réservé tel quel en base', async () => {
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 4 })
    const w = mountEdit()
    await waitHydrated(w)
    await w.find('#name').setValue('Pull en 1,5')
    await w.find('.ypick__brandfilter select').setValue('Drops')
    await flushPromises()
    await w.find('.ypick__row input[type="checkbox"]').setValue(true)
    await flushPromises()
    await w.find('.ypick__qtyin').setValue('1,5')

    await w.find('.btn--primary').trigger('click')
    await flushPromises()
    await vi.waitFor(
      async () => expect(Object.keys((await db.yarns.get(yid)).reservations || {})).toHaveLength(1),
      { timeout: 10000 },
    )

    const created = (await db.projects.toArray()).find((p) => p.name === 'Pull en 1,5')
    const saved = await db.yarns.get(yid)
    expect(saved.reservations).toEqual({ [created.id]: 1.5 })
  })

  // Plus de plancher à 1 : une laine avec moins d'une pelote disponible se réserve à 0,5.
  it('0,5 pelote disponible est réservable et survit à l’enregistrement', async () => {
    const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 0.5 })
    const w = mountEdit()
    await waitHydrated(w)
    await w.find('#name').setValue('Mon projet')
    await w.find('.ypick__brandfilter select').setValue('Drops')
    await flushPromises()
    await w.find('.ypick__row input[type="checkbox"]').setValue(true)
    await flushPromises()

    expect(w.find('.ypick__qtyin').element.value).toBe('0,5') // défaut, formaté à la locale

    await w.find('.btn--primary').trigger('click')
    await flushPromises()

    // Deux écritures Dexie enchaînées (la fiche projet PUIS la mise à jour de la laine) :
    // un seul flushPromises() ne suffit pas toujours à tout drainer (même motif que
    // yarn-purchases.spec.js).
    await vi.waitFor(
      async () => expect(Object.keys((await db.yarns.get(yid)).reservations || {})).toHaveLength(1),
      { timeout: 10000 },
    )

    const created = (await db.projects.toArray()).find((p) => p.name === 'Mon projet')
    const saved = await db.yarns.get(yid)
    expect(saved.reservations).toEqual({ [created.id]: 0.5 })
  })
})

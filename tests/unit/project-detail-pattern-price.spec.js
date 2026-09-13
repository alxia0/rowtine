// La fiche projet AFFICHE le prix du patron, en lecture seule (lot 07/08). Elle ne l'édite
// pas : la saisie est dans le formulaire du projet et sur la fiche du patron.
//
// Trois états à distinguer, et c'est tout l'enjeu :
//   prix renseigné -> le montant ;  prix « 0 » -> « Gratuit » ;  prix vide -> AUCUNE LIGNE
// (pas une ligne vide : une étiquette sans valeur est du bruit).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { db } from '@/db/db'
import ProjectDetailView from '@/views/ProjectDetailView.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })
const route = { params: {}, query: {} }
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }))

async function monterAvecPrix(over) {
  const patId = await db.patterns.add({ name: 'Sabai', type: 'knitting', ...over })
  const projectId = await db.projects.add({ name: 'Bonnet', patternId: patId })
  route.params = { id: String(projectId) }
  // Correction de fixture : .patron-source vit dans le panneau « Infos », pas dans l'onglet
  // par défaut (« Sections », cf. ProjectDetailView.vue:59 `tab = ref(route.query.tab ||
  // 'sections')`). Sans ce query, le bloc n'est jamais monté — pour une raison étrangère
  // au prix du patron.
  route.query = { tab: 'infos' }
  const w = mount(ProjectDetailView, { global: { plugins: [i18n], stubs: { AppHeader: true } } })
  // Correction de fixture (héritée d'un correctif antérieur) : un seul flushPromises() ne vide pas la
  // chaîne Dexie de loadAll() (project → linkedPattern → Promise.all des 4 stores). `loading`
  // reste `true` un tour de plus que `linkedPattern`, et le template masque TOUT derrière
  // <SkeletonScreen v-else-if="loading">, y compris le bloc .patron-source — attendre le
  // signal de fin réel plutôt qu'un délai fixe.
  await flushPromises()
  await vi.waitFor(() => expect(w.vm.loading).toBe(false))
  return w
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
})

describe('fiche projet — prix du patron', () => {
  it('1. prix renseigné ⇒ le montant s’affiche', async () => {
    // CHF plutôt que le EUR d'origine : EUR est DEFAULT_CURRENCY, et la
    // seule assertion de montant ne regarde de toute façon jamais la devise — l'ajout de
    // `toContain('CHF')` ci-dessous est ce qui rend `p.priceCurrency` (et non un repli codé
    // en dur) réellement exercé.
    const w = await monterAvecPrix({ price: '8,50', priceCurrency: 'CHF' })
    const ligne = w.find('[data-test="project-pattern-price"]')
    expect(ligne.exists()).toBe(true)
    expect(ligne.text()).toContain('8,50')
    expect(ligne.text()).toContain('CHF')
  })

  it('2. prix « 0 » ⇒ « Gratuit », pas « 0,00 € »', async () => {
    const w = await monterAvecPrix({ price: '0', priceCurrency: 'EUR' })
    const ligne = w.find('[data-test="project-pattern-price"]')
    expect(ligne.exists()).toBe(true)
    expect(ligne.text()).toContain(fr.pattern.priceFree)
    // `not.toContain('0,00')` (tel quel) ne peut jamais rougir : le profil
    // « detail » de formatMoney omet les centimes sur un montant rond (« 0 € », jamais
    // « 0,00 € ») — même si la branche « Gratuit » disparaissait, ce texte n'apparaîtrait
    // toujours pas. On vérifie l'absence de tout chiffre à la place : ça mord sur la vraie
    // mutation (M1, plus bas), qui ferait apparaître « 0 € ».
    expect(ligne.text()).not.toMatch(/\d/)
  })

  it('3. prix VIDE ⇒ AUCUNE ligne (pas une ligne vide)', async () => {
    const w = await monterAvecPrix({ price: '' })
    expect(w.find('[data-test="project-pattern-price"]').exists()).toBe(false)
  })
})

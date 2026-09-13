// tests/unit/project-edit-pattern-price.spec.js
// Le prix du patron, saisi depuis le FORMULAIRE DU PROJET (lot 07/08). Toute la difficulté :
// la saisie vit dans l'écran du projet, mais écrit dans la fiche du PATRON.
//
// Base Dexie réelle (fake-indexeddb) écrite via les VRAIS magasins — les mutations sont ainsi
// réellement observables. Montage calqué sur tests/unit/expenses-view.spec.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { db } from '@/db/db'
import { usePatternsStore } from '@/stores/patterns'
import { useProjectsStore } from '@/stores/projects'
import { useSettingsStore } from '@/stores/settings'
import ProjectEditView from '@/views/ProjectEditView.vue'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

// Routeur minimal : cet écran lit route.params/route.query et appelle router.replace.
const route = { params: {}, query: {} }
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }
vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => router,
}))

// `ProjectEditView` enchaîne plusieurs tours Dexie/fake-indexeddb dans son `onMounted`
// (settings.load, yarnsStore.load, patternsStore.load, ensureFreePattern, projectsStore.get) :
// un simple `flushPromises()` ne suffit pas à les vider tous (même constat que
// tests/unit/ProjectEditView.spec.js:waitHydrated — motif repris à l'identique ici). Sans cette attente sur la VRAIE fin de l'hydratation, une saisie faite
// juste après `monter()` arrive parfois avant que `patternSel`/`priceForm` soient stabilisés.
async function monter() {
  const w = mount(ProjectEditView, {
    global: { plugins: [i18n], stubs: { AppHeader: true } },
  })
  await flushPromises()
  await vi.waitFor(() => expect(w.vm.hydrating).toBe(false), { timeout: 2000 })
  await flushPromises()
  return w
}

// `save()` (cf. ProjectEditView.vue) enchaîne lui aussi plusieurs tours Dexie réels
// (projectsStore.create/update, applyYarnLinks, l'écriture conditionnelle du prix,
// projectConsumption.requestStatusChange) : un `flushPromises()` unique après le clic ne les
// vide pas tous, l'écriture en base peut donc ne pas être encore visible. On attend un signal
// de fin réel — `router.replace`, toujours appelé par `finishSave` en bout de chaîne — plutôt
// qu'un délai fixe (même motif que `waitHydrated` dans tests/unit/ProjectEditView.spec.js).
async function enregistrer(w) {
  await w.find('.btn--primary').trigger('click')
  await vi.waitFor(() => expect(router.replace).toHaveBeenCalled(), { timeout: 5000 })
  await flushPromises()
}

beforeEach(async () => {
  setActivePinia(createPinia())
  route.params = {}
  route.query = {}
  await db.delete()
  await db.open()
  // CHF et non EUR : EUR est DEFAULT_CURRENCY (src/constants/currencies.js) — avec EUR, le
  // test 1 passerait même si l'écriture ne lisait jamais `settings.currency` (cf. leçon du
  // même piège). `loaded = true` évite que le `settings.load()` du montage (filet de
  // sécurité pour un montage direct hors du garde de route) n'écrase cette valeur avec celle,
  // absente, de la base — précédent : tests/unit/home-budget-tile.spec.js.
  const settingsStore = useSettingsStore()
  settingsStore.currency = 'CHF'
  settingsStore.loaded = true
})
afterEach(() => vi.clearAllMocks())

describe('formulaire projet — le prix va dans le PATRON', () => {
  it('1. un prix saisi est écrit sur le patron, PAS sur le projet', async () => {
    const patId = await db.patterns.add({ name: 'Sabai', type: 'knitting' })
    await usePatternsStore().load()
    route.query = { pattern: String(patId) }
    const w = await monter()

    await w.find('#name').setValue('Bonnet du dimanche')
    await w.find('[data-test="pattern-price"]').setValue('8,50')
    await enregistrer(w)

    const pat = await db.patterns.get(patId)
    expect(pat.price).toBe('8,50')
    expect(pat.priceCurrency).toBe('CHF')
    expect(pat.purchasedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const [projet] = await db.projects.toArray()
    expect(projet.price).toBeUndefined()
  })

  it('2. sans y toucher, enregistrer un projet ne RÉÉCRIT PAS la fiche du patron', async () => {
    // Sans ce garde, ouvrir puis enregistrer un projet ré-estamperait `priceCurrency` avec la
    // devise du MOMENT — qui peut avoir changé dans les réglages depuis l'achat.
    const patId = await db.patterns.add({
      name: 'Sabai', type: 'knitting', price: '8,50', priceCurrency: 'GBP', purchasedAt: '2024-11-04',
    })
    await usePatternsStore().load()
    route.query = { pattern: String(patId) }
    const w = await monter()

    await w.find('#name').setValue('Bonnet')
    await enregistrer(w)

    const pat = await db.patterns.get(patId)
    expect(pat.priceCurrency).toBe('GBP') // PAS 'CHF'
    expect(pat.purchasedAt).toBe('2024-11-04')
  })

  it('3. changer de patron dans le menu recharge le prix affiché', async () => {
    const a = await db.patterns.add({ name: 'Sabai', type: 'knitting', price: '8,50', purchasedAt: '2026-03-12' })
    const b = await db.patterns.add({ name: 'Twist', type: 'knitting', price: '19', purchasedAt: '2025-06-01' })
    await usePatternsStore().load()
    route.query = { pattern: String(a) }
    const w = await monter()
    expect(w.find('[data-test="pattern-price"]').element.value).toBe('8,50')

    await w.find('#project-pattern').setValue(String(b))
    await flushPromises()
    expect(w.find('[data-test="pattern-price"]').element.value).toBe('19')
    expect(w.find('[data-test="pattern-purchased-at"]').element.value).toBe('2025-06-01')
  })

  it('4. « Patron libre » : aucun champ de prix, une explication à la place', async () => {
    const libre = await db.patterns.add({ name: 'Patron libre', type: 'knitting', builtin: true })
    await usePatternsStore().load()
    route.query = { pattern: String(libre) }
    const w = await monter()
    expect(w.find('[data-test="pattern-price"]').exists()).toBe(false)
    expect(w.text()).toContain(fr.pattern.priceFreePatternHint)
  })

  it('5. la mention « ce prix appartient au patron » est présente ici', async () => {
    const patId = await db.patterns.add({ name: 'Sabai', type: 'knitting' })
    await usePatternsStore().load()
    route.query = { pattern: String(patId) }
    const w = await monter()
    expect(w.text()).toContain(fr.pattern.priceSharedHint)
  })

  it('6. projet sur une copie de travail : le prix va sur le patron D’ORIGINE', async () => {
    const src = await db.patterns.add({ name: 'Sabai', type: 'knitting' })
    const projectId = await db.projects.add({ name: 'Bonnet', patternId: src })
    const forkId = await db.patterns.add({ name: 'Bonnet', type: 'knitting', ownerProjectId: projectId, sourcePatternId: src })
    await db.projects.update(projectId, { patternId: forkId })
    await usePatternsStore().load()
    await useProjectsStore().load()
    route.params = { id: String(projectId) }
    const w = await monter()

    await w.find('[data-test="pattern-price"]').setValue('8,50')
    await enregistrer(w)

    expect((await db.patterns.get(src)).price).toBe('8,50')
    expect((await db.patterns.get(forkId)).price).toBeUndefined()
  })

  // Réécrit lors d'une passe de nettoyage antérieure à la 1.0 (round de correction du 13/08, 09h20) : une revue a
  // relevé que le comportement du 3ᵉ passage (champ NORMAL, saisie perdue en silence à
  // l'enregistrement) n'était PAS le comportement produit accepté — un champ ouvert dont la valeur
  // disparaît sans un mot est pire qu'un champ absent. Aucun `patron.json` réel ne porte ce cas
  // depuis les travaux sur le prix du patron du 07/08 (`forkForProject` pose systématiquement
  // `sourcePatternId`), et ce n'est PAS le patron libre : la saisie du prix ne doit donc être
  // présentée DU TOUT — ni champ, ni bouton « gratuit », ni message (cf.
  // `ProjectEditView.vue:showPriceFields`).
  it('7. copie de travail sans sourcePatternId (cas jugé impossible) : la saisie du prix ne s’affiche pas du tout', async () => {
    const projectId = await db.projects.add({ name: 'Bonnet' })
    const forkId = await db.patterns.add({ name: 'Bonnet', type: 'knitting', ownerProjectId: projectId })
    await db.projects.update(projectId, { patternId: forkId })
    await usePatternsStore().load()
    await useProjectsStore().load()
    route.params = { id: String(projectId) }
    const w = await monter()
    // Aucun porteur pour ce prix (ni ce patron, ni la bibliothèque) : le composant entier n'est
    // pas rendu — ni champ, ni bouton « gratuit », ni message d'explication.
    expect(w.find('[data-test="pattern-price"]').exists()).toBe(false)
    expect(w.find('[data-test="pattern-price-free"]').exists()).toBe(false)
    expect(w.find('[data-test="pattern-price-hidden"]').exists()).toBe(false)

    // Enregistrer ne doit lever aucune erreur (rien à écrire, priceDirty reste false) et ne
    // doit PAS inventer un prix sur le patron.
    await enregistrer(w)
    expect((await db.patterns.get(forkId)).price).toBeUndefined()
  })

  it('8. le champ affiché reste un modèle VIVANT — piège v-model : lu depuis le DOM, pas depuis l’événement', async () => {
    // Aucun test ne discrimine ce point précis. `v-model="priceForm"` sur un
    // `reactive()` compilerait en RÉAFFECTATION de la variable : l'événement émis porterait
    // quand même la bonne valeur (comme dans le défaut déjà vu), mais l'AFFICHAGE se
    // figerait. On relit donc depuis le DOM (`.element.value`), la seule lecture qui distingue
    // un modèle vivant d'un modèle détaché.
    const patId = await db.patterns.add({ name: 'Sabai', type: 'knitting' })
    await usePatternsStore().load()
    route.query = { pattern: String(patId) }
    const w = await monter()

    await w.find('[data-test="pattern-price"]').setValue('12,90')
    expect(w.find('[data-test="pattern-price"]').element.value).toBe('12,90')

    await w.find('[data-test="pattern-purchased-at"]').setValue('2026-02-14')
    // La saisie de la date ne doit pas avoir perdu celle du prix (même objet réactif tout du
    // long, jamais remplacé) : si `priceForm` avait été réaffecté, cette seconde frappe
    // repartirait d'un objet détaché et le prix pourrait redevenir vide à l'écran.
    expect(w.find('[data-test="pattern-price"]').element.value).toBe('12,90')
    expect(w.find('[data-test="pattern-purchased-at"]').element.value).toBe('2026-02-14')
  })

  it('9. vider le champ prix efface aussi la devise enregistrée', async () => {
    // GBP : ni la devise des réglages (CHF, cf. beforeEach) ni DEFAULT_CURRENCY (EUR) — même
    // raison que le test 2 : une devise qui coïnciderait avec l'une des deux ne prouverait
    // rien. Sans le correctif de ProjectEditView.vue:276 (`? settings.currency : ''`), un prix
    // vidé garderait 'GBP' en base — une devise associée à un achat qui n'existe plus.
    const patId = await db.patterns.add({
      name: 'Sabai', type: 'knitting', price: '18', priceCurrency: 'GBP', purchasedAt: '2023-05-02',
    })
    await usePatternsStore().load()
    route.query = { pattern: String(patId) }
    const w = await monter()
    expect(w.find('[data-test="pattern-price"]').element.value).toBe('18')

    await w.find('[data-test="pattern-price"]').setValue('')
    await enregistrer(w)

    const pat = await db.patterns.get(patId)
    expect(pat.price).toBe('')
    expect(pat.priceCurrency).toBe('')
  })
})

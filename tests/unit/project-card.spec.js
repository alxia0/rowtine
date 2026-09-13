// ProjectCard — statut rapide : le badge de statut ne doit jamais déclencher
// l'ouverture du projet (carte = <button> distinct, badge = élément à part, cf. commentaire
// du template). La sélection d'un statut met à jour le store (et donc la base).
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { db } from '@/db/db'
import ProjectCard from '@/components/ProjectCard.vue'
import YarnConsumptionDialog from '@/components/YarnConsumptionDialog.vue'
import { useProjectsStore } from '@/stores/projects'
import { useYarnsStore } from '@/stores/yarns'

const i18n = createI18n({ legacy: false, locale: 'fr', messages: { fr } })

async function mountCard() {
  await db.projects.clear()
  await db.yarns.clear()
  const id = await db.projects.add({ name: 'Mon pull', technique: 'knitting', status: 'wip' })
  // Même instance Pinia passée au montage ET utilisée ici, pour que le store observé
  // dans le test soit bien le même singleton que celui résolu par ProjectCard.
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useProjectsStore()
  await store.load()
  const project = store.projects.find((p) => p.id === id)
  const w = mount(ProjectCard, { global: { plugins: [i18n, pinia] }, props: { project } })
  return { w, id, store, pinia }
}

// Variante de `mountCard()` acceptant des champs de projet arbitraires (date de fin sur la
// tuile) — sans toucher `mountCard()` elle-même, dont les appels existants ci-dessus
// ne passent aucun paramètre. `progress` (optionnel) alimente la prop du même nom.
async function mountCardWith(fields, progress) {
  await db.projects.clear()
  await db.yarns.clear()
  const id = await db.projects.add({ name: 'Mon pull', technique: 'knitting', status: 'wip', ...fields })
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useProjectsStore()
  await store.load()
  const project = store.projects.find((p) => p.id === id)
  return mount(ProjectCard, { global: { plugins: [i18n, pinia] }, props: { project, progress } })
}

describe('ProjectCard — statut rapide', () => {
  it('cliquer la carte émet `open`', async () => {
    const { w } = await mountCard()
    await w.find('button.pcard__main').trigger('click')
    expect(w.emitted('open')).toBeTruthy()
  })

  it('cliquer le badge de statut n\'émet PAS `open`', async () => {
    const { w } = await mountCard()
    await w.find('button.badge--editable').trigger('click') // ouvre le popover
    expect(w.emitted('open')).toBeFalsy()
    const items = w.findAll('.menu__item')
    await items[3].trigger('click') // choisit 'done' (index 3 de STATUS_ORDER)
    expect(w.emitted('open')).toBeFalsy()
  })

  it('choisir un statut dans le popover met à jour le store/la base', async () => {
    const { w, id, store } = await mountCard()
    await w.find('button.badge--editable').trigger('click')
    const items = w.findAll('.menu__item')
    await items[3].trigger('click') // 'done' (index 3 de STATUS_ORDER)
    await flushPromises()
    // Le rechargement du store (`store.load()`, appelé par `update()`) passe par Dexie/
    // fake-indexeddb, dont la résolution s'étale sur plusieurs tours de boucle d'évènements
    // (pas de simples micro-tâches) — un délai court garantit qu'il est bien terminé ici.
    await new Promise((r) => setTimeout(r, 40))
    const updated = await db.projects.get(id)
    expect(updated.status).toBe('done')
    expect(store.projects.find((p) => p.id === id).status).toBe('done')
  })

  describe('clôture (statut Terminé) : « combien de pelotes as-tu utilisées ? »', () => {
    it('laine réservée : choisir Terminé ouvre le dialogue et ne change pas le statut tant que non validé', async () => {
      const { w, id } = await mountCard()
      const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [id]: 2 } })

      await w.find('button.badge--editable').trigger('click')
      const items = w.findAll('.menu__item')
      await items[3].trigger('click') // 'done' (index 3 de STATUS_ORDER)

      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })
      expect(w.findComponent(YarnConsumptionDialog).props('yarns')).toEqual([
        { id: yid, name: 'Drops · Bleu', reserved: 2 },
      ])
      expect((await db.projects.get(id)).status).toBe('wip')
    })

    it('Valider (défaut = tout tricoté) déduit tout le réservé et passe à Terminé', async () => {
      const { w, id } = await mountCard()
      const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [id]: 2 } })

      await w.find('button.badge--editable').trigger('click')
      const items = w.findAll('.menu__item')
      await items[3].trigger('click') // 'done'
      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })

      await w.findComponent(YarnConsumptionDialog).vm.$emit('confirm', [{ id: yid, used: 2 }])
      await vi.waitFor(async () => expect((await db.projects.get(id)).status).toBe('done'), { timeout: 10000 })
      expect((await db.yarns.get(yid)).quantity).toBe(3) // 5 - 2 tricotées
      expect((await db.yarns.get(yid)).reservations).toEqual({})
    })
  })

  describe('abandon (statut Abandonné, R3) : même question, défaut inversé à 0', () => {
    it('laine réservée : choisir Abandonné ouvre le dialogue en mode « abandonné » (défaut 0)', async () => {
      const { w, id } = await mountCard()
      await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [id]: 2 } })

      await w.find('button.badge--editable').trigger('click')
      const items = w.findAll('.menu__item')
      await items[5].trigger('click') // 'abandoned' (index 5 de STATUS_ORDER)

      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })
      expect(w.findComponent(YarnConsumptionDialog).props('mode')).toBe('abandoned')
      expect((await db.projects.get(id)).status).toBe('wip')
    })

    it('Valider avec le défaut (0 perdu) ne déduit rien : tout revient au stock', async () => {
      const { w, id } = await mountCard()
      const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [id]: 2 } })

      await w.find('button.badge--editable').trigger('click')
      const items = w.findAll('.menu__item')
      await items[5].trigger('click') // 'abandoned'
      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })

      await w.findComponent(YarnConsumptionDialog).vm.$emit('confirm', [{ id: yid, used: 0 }])
      await vi.waitFor(async () => expect((await db.projects.get(id)).status).toBe('abandoned'), { timeout: 10000 })
      expect((await db.yarns.get(yid)).quantity).toBe(5) // rien perdu : rien déduit
    })
  })

  // Icône vegan (lot du 06/08/2026) : ProjectCard ne recharge PAS yarnsStore lui-même
  // (HomeView, seul appelant réel, le fait déjà à son montage — un load() par carte
  // dupliquerait la lecture ET la boucle de migration de yarns.js en concurrence). Le test
  // doit donc déclencher lui-même le (re)chargement après avoir semé les laines, avec le
  // MÊME pinia que celui passé au composant — sinon useYarnsStore() en résoudrait un autre.
  describe('icône vegan', () => {
    async function loadYarns(pinia) {
      setActivePinia(pinia)
      await useYarnsStore().load()
    }

    it('toutes les laines rattachées sont vegan → icône affichée avec le libellé accessible', async () => {
      const { w, id, pinia } = await mountCard()
      await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, labels: ['vegan'], reservations: { [id]: 2 } })
      await db.yarns.add({ brand: 'Katia', colorName: 'Vert', quantity: 3, labels: ['vegan', 'ethique'], reservations: { [id]: 1 } })
      await loadYarns(pinia)
      // Garde-fou anti-vacuité (cf. rapport) : si le store n'a rien chargé, l'icône est
      // absente pour la MAUVAISE raison — ce test ne prouverait alors rien.
      expect(useYarnsStore().yarns).toHaveLength(2)
      await vi.waitFor(() => expect(w.find('.pcard__vegan').exists()).toBe(true), { timeout: 10000 })
      expect(w.find('.pcard__vegan').attributes('aria-label')).toBe(fr.project.allYarnsVegan)
    })

    it('une seule des deux laines rattachées est vegan → aucune icône', async () => {
      const { w, id, pinia } = await mountCard()
      await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, labels: ['vegan'], reservations: { [id]: 2 } })
      await db.yarns.add({ brand: 'Katia', colorName: 'Vert', quantity: 3, labels: ['ethique'], reservations: { [id]: 1 } })
      await loadYarns(pinia)
      expect(useYarnsStore().yarns).toHaveLength(2)
      await w.vm.$nextTick()
      expect(w.find('.pcard__vegan').exists()).toBe(false)
    })

    it('aucune laine rattachée à ce projet → aucune icône', async () => {
      const { w, id, pinia } = await mountCard()
      // Laine vegan, mais rattachée à un AUTRE projet.
      const otherId = await db.projects.add({ name: 'Autre', technique: 'crochet', status: 'wip' })
      await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, labels: ['vegan'], reservations: { [otherId]: 2 } })
      await loadYarns(pinia)
      expect(useYarnsStore().yarns).toHaveLength(1)
      expect(id).not.toBe(otherId)
      await w.vm.$nextTick()
      expect(w.find('.pcard__vegan').exists()).toBe(false)
    })

    it('laine rattachée sans champ `labels` (fiche antérieure au lot des caractéristiques) → aucune icône, sans erreur', async () => {
      const { w, id, pinia } = await mountCard()
      await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [id]: 2 } })
      await loadYarns(pinia)
      expect(useYarnsStore().yarns).toHaveLength(1)
      await w.vm.$nextTick()
      expect(w.find('.pcard__vegan').exists()).toBe(false)
    })
  })

  // Date de fin sur la tuile : condition DOUBLE et non négociable —
  // status === 'done' ET finishedAt non vide. Un projet abandonné peut porter une date de fin
  // (le statut « Abandonné » n'efface jamais la date) : l'afficher dirait
  // « Terminé le… » sur un projet qui ne l'est pas.
  describe('date de fin', () => {
    it('un projet Terminé AVEC date l’affiche dans la ligne meta', async () => {
      const w = await mountCardWith({ status: 'done', finishedAt: '2026-07-15' })
      expect(w.find('.pcard__meta').text()).toContain('Terminé le 15/07/2026')
    })

    it('un projet Terminé SANS date n’affiche rien de plus', async () => {
      const w = await mountCardWith({ status: 'done', finishedAt: '' })
      expect(w.find('.pcard__meta').text()).not.toContain('Terminé le')
    })

    it('un projet ABANDONNÉ portant une date ne l’affiche PAS', async () => {
      // La tuile dirait « Terminé le… » sur un projet qui ne l'est pas.
      const w = await mountCardWith({ status: 'abandoned', finishedAt: '2026-07-15' })
      expect(w.find('.pcard__meta').text()).not.toContain('Terminé le')
    })

    it('un projet En cours portant une date ne l’affiche pas non plus', async () => {
      const w = await mountCardWith({ status: 'wip', finishedAt: '2026-07-15' })
      expect(w.find('.pcard__meta').text()).not.toContain('Terminé le')
    })
  })

  // Signature de mailles (T1, 31/08) : le visuel StitchProgress ne se rend que s'il dit
  // quelque chose — progression connue ET avancée (pct > 0), ou projet Terminé (signature
  // pleine, même à progression inconnue). Inconnue (total 0) ou nulle (0 %) → rien.
  describe('signature de progression vide', () => {
    it('progression inconnue (total 0) sur un projet en cours → pas de visuel', async () => {
      const w = await mountCardWith({}, { done: 0, total: 0 })
      expect(w.find('.pcard__stitch').exists()).toBe(false)
    })

    it('pas de prop progress du tout → pas de visuel', async () => {
      const w = await mountCardWith({}, undefined)
      expect(w.find('.pcard__stitch').exists()).toBe(false)
    })

    it('progression connue mais nulle (0 %) → pas de visuel NI de « 0 % »', async () => {
      const w = await mountCardWith({}, { done: 0, total: 100 })
      expect(w.find('.pcard__stitch').exists()).toBe(false)
      expect(w.find('.pcard__pct').exists()).toBe(false)
      expect(w.find('.pcard__foot').text()).not.toContain('0 %')
    })

    it('progression connue et avancée → visuel rendu et pourcentage affiché', async () => {
      const w = await mountCardWith({}, { done: 40, total: 100 })
      expect(w.find('.pcard__stitch').exists()).toBe(true)
      expect(w.find('.pcard__pct').text()).toBe('40 %')
    })

    it('projet Terminé sans progression connue → signature pleine conservée', async () => {
      const w = await mountCardWith({ status: 'done' }, { done: 0, total: 0 })
      expect(w.find('.pcard__stitch').exists()).toBe(true)
    })

    it('projet Terminé à 0 % garde son affichage complet (signature + « 0 % »)', async () => {
      const w = await mountCardWith({ status: 'done' }, { done: 0, total: 100 })
      expect(w.find('.pcard__stitch').exists()).toBe(true)
      expect(w.find('.pcard__pct').text()).toBe('0 %')
    })
  })
})

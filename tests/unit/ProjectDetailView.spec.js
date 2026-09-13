// Composant — ProjectDetailView (vue lourde) : onglets, infos, sections, taille active.
// vue-router mocké ; enfants lourds stubbés ; base Dexie réelle.
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

// Menu ⋮ — « Voir le PDF original » : on prouve QUI est appelé, pas le détail
// natif/web du module (déjà couvert par open-pdf.spec.js).
const { openPdfExternally } = vi.hoisted(() => ({ openPdfExternally: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/utils/open-pdf', () => ({ openPdfExternally }))

import ProjectDetailView from '@/views/ProjectDetailView.vue'
import YarnConsumptionDialog from '@/components/YarnConsumptionDialog.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import { useSnackbarStore } from '@/stores/snackbar'

async function seedProject(extra = {}) {
  const pid = await db.projects.add({
    name: 'Pull torsadé',
    technique: 'knitting',
    status: 'wip',
    sizes: ['S', 'M', 'L'],
    activeSize: 'M',
    needleMm: '4.5',
    ...extra,
  })
  nav.route.params = { id: String(pid) }
  nav.route.query = {}
  return pid
}

function mountDetail() {
  return mount(ProjectDetailView, {
    global: {
      plugins: [createPinia(), i18n],
      stubs: { StatusBadge: true, CounterCard: true, CounterForm: true },
    },
  })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  nav.router.back.mockClear()
  openPdfExternally.mockClear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('ProjectDetailView', () => {
  it('affiche le titre du projet et les 4 onglets', async () => {
    await seedProject()
    const w = mountDetail()
    await flushPromises()

    expect(w.find('.phdr__title').text()).toBe('Pull torsadé')
    expect(w.findAll('[role="tab"]')).toHaveLength(4)
    // L'onglet Sections est désormais le premier (ouvert par défaut).
    expect(w.find('#panel-sections').exists()).toBe(true)
  })

  it("l'onglet Infos liste les tailles et la taille active est marquée", async () => {
    await seedProject()
    const w = mountDetail()
    await flushPromises()
    await w.find('#tab-infos').trigger('click')
    await flushPromises()

    const chips = w.findAll('.chips--sizes .chip')
    expect(chips.map((c) => c.text())).toEqual(['S', 'M', 'L'])
    expect(chips.find((c) => c.text() === 'M').classes()).toContain('chip--on')
  })

  it('cliquer une taille met à jour activeSize et le persiste', async () => {
    const pid = await seedProject()
    const w = mountDetail()
    await flushPromises()
    await w.find('#tab-infos').trigger('click')
    await flushPromises()

    await w.findAll('.chips--sizes .chip').find((c) => c.text() === 'L').trigger('click')
    await vi.waitFor(async () => expect((await db.projects.get(pid)).activeSize).toBe('L'), { timeout: 10000 })
  })

  it("bascule sur l'onglet Sections et affiche le panneau sections (projet sans patron lié)", async () => {
    await seedProject()
    const w = mountDetail()
    await flushPromises()

    await w.find('#tab-sections').trigger('click')
    await flushPromises()

    // Projet sans patron lié : pas d'aperçu reader, mais le bloc Compteurs est présent.
    expect(w.find('#panel-sections').exists()).toBe(true)
    expect(w.findAll('.rovw')).toHaveLength(0)
    expect(w.find('.counters-block').exists()).toBe(true)
  })

  describe('clic sur une section de l’aperçu → atterrit DANS cette section (#9)', () => {
    async function seedWithSections() {
      const patId = await db.patterns.add({
        name: 'SABAI',
        reader: {
          sizeLabels: [],
          sections: [
            { id: 's1', kind: 'pelote', title: 'Encolure', steps: [{ t: 'Rg 1' }] },
            { id: 's2', kind: 'pelote', title: 'Corps', steps: [{ t: 'Rg 1' }] },
          ],
        },
      })
      const pid = await seedProject({ patternId: patId })
      return pid
    }

    it('ouvre le lecteur avec ?section=<id> DE LA SECTION CLIQUÉE (pas la reprise générale)', async () => {
      const pid = await seedWithSections()
      const w = mountDetail()
      await flushPromises()

      // Case « section faite » : la tuile `.rovw` est un div, le clic-ouverture
      // vit désormais sur son bouton enfant `.rovw__main` (la case `.rovw__done` est sa
      // sœur, pour ne jamais ouvrir le lecteur en cochant).
      const secBtn = w.findAll('.rovw__main').find((b) => b.text().includes('Corps'))
      expect(secBtn).toBeTruthy()
      await secBtn.trigger('click')

      // project.value.id vient de projectsStore.get() (db.projects.get(Number(id))) : c'est
      // le NOMBRE (clé Dexie), pas la chaîne de route.params.id — à ne pas confondre avec
      // les autres assertions du fichier qui comparent route.params.id (déjà une chaîne).
      expect(nav.router.push).toHaveBeenCalledWith({
        name: 'project-read',
        params: { id: pid },
        query: { section: 's2' },
      })
    })

    it('bouton « Suivre le patron » (global) reste sans query.section — comportement inchangé', async () => {
      const pid = await seedWithSections()
      const w = mountDetail()
      await flushPromises()

      await w.find('.reader-btn').trigger('click')

      expect(nav.router.push).toHaveBeenCalledWith({ name: 'project-read', params: { id: pid } })
      expect(nav.router.push).not.toHaveBeenCalledWith(expect.objectContaining({ query: expect.anything() }))
    })
  })

  it("le menu Actions permet d'éditer (navigation)", async () => {
    const pid = await seedProject()
    const w = mountDetail()
    await flushPromises()

    await w.find('.phdr__kebab').trigger('click')
    await w.findAll('.menu__item').find((b) => b.text() === 'Modifier le projet').trigger('click')

    expect(nav.router.push).toHaveBeenCalledWith({ name: 'project-edit', params: { id: String(pid) } })
  })

  // Spec 08/09 (fusion chrono + œil) : l'entrée chrono REVIINT dans le menu — dynamique
  // selon l'état de project.showTimer (elle avait quitté ce menu pour l'œil du suivi, puis
  // l'œil lui-même a disparu au profit du chevron de la pastille ; le kebab est redevenu
  // une porte de retour durable). Le détail des gestes est couvert par
  // project-detail-chrono.spec.js ; ici : la présence et la DYNAMIQUE du libellé.
  it('le menu porte la bascule chrono, dynamique selon project.showTimer', async () => {
    const pid = await seedProject()
    const w = mountDetail()
    await flushPromises()

    await w.find('.phdr__kebab').trigger('click')
    await flushPromises()

    const labels = w.findAll('.menu__item').map((n) => n.text())
    // Le menu est bien ouvert (garde-fou anti-test-vide) : il reste au moins « Modifier le projet ».
    expect(labels.length).toBeGreaterThan(0)
    expect(labels).toContain(i18n.global.t('project.edit'))
    // État par défaut (chrono affiché) : l'entrée propose de le MASQUER…
    expect(labels).toContain(i18n.global.t('reader.hideTimer'))
    expect(labels).not.toContain(i18n.global.t('reader.showTimer'))

    // …et une fois le chrono masqué (showTimer:false posé À LA CRÉATION — la fiche lit le
    // projet une seule fois au montage), elle propose de le RÉAFFICHER (jamais les deux
    // à la fois).
    await w.unmount()
    await seedProject({ showTimer: false })
    const wMasque = mountDetail()
    await flushPromises()
    await wMasque.find('.phdr__kebab').trigger('click')
    await flushPromises()
    const labelsMasque = wMasque.findAll('.menu__item').map((n) => n.text())
    expect(labelsMasque).toContain(i18n.global.t('reader.showTimer'))
    expect(labelsMasque).not.toContain(i18n.global.t('reader.hideTimer'))
  })

  describe('onglet Infos : trace des pelotes tricotées (décision 2)', () => {
    it('laine réservée (non terminée) : affiche le rendu réservé habituel, sans mention « tricotées »', async () => {
      const pid = await seedProject()
      await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      // Deux passes, pas une (correctif revue du 10/08/2026) : `FirstDetailTip`,
      // monté par cette vue, marque désormais `swipeHintSeen` DÈS SON AFFICHAGE (écriture
      // Dexie attendue, cf. son commentaire) — cette écriture partage la même file
      // d'attente IndexedDB (fake-indexeddb) que le `db.projects.get(pid)` de CETTE vue,
      // et une seule `flushPromises()` ne suffit plus toujours à sortir du squelette de
      // chargement (`#tab-infos` resterait alors introuvable).
      await flushPromises()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      const items = w.findAll('.yarnlist li')
      expect(items).toHaveLength(1)
      expect(items[0].text()).toContain('Drops')
      expect(items[0].text()).not.toContain(i18n.global.t('project.yarnKnitted', { n: 2 }))
    })

    it('projet terminé dont les pelotes ont été consommées (plus aucune réservation) : la laine reste visible, « n pelotes tricotées »', async () => {
      const pid = await seedProject({ status: 'done' })
      await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 3, reservations: {}, consumed: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      // Sans l'extension à `consumed`, cette laine n'apparaîtrait plus du tout
      // (jamais perdre l'info — décision produit) : garde-fou anti-régression.
      const items = w.findAll('.yarnlist li')
      expect(items).toHaveLength(1)
      expect(items[0].text()).toContain('Drops')
      expect(items[0].text()).toContain(i18n.global.t('project.yarnKnitted', { n: 2 }))
    })

    it('une laine réservée par ce projet ET une autre consommée par lui apparaissent toutes les deux', async () => {
      const pid = await seedProject()
      await db.yarns.add({ brand: 'Réservée', quantity: 5, reservations: { [pid]: 1 } })
      await db.yarns.add({ brand: 'Consommée', quantity: 1, reservations: {}, consumed: { [pid]: 4 } })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      const texts = w.findAll('.yarnlist li').map((n) => n.text())
      expect(texts).toHaveLength(2)
      expect(texts.some((t) => t.includes('Réservée'))).toBe(true)
      expect(texts.some((t) => t.includes('Consommée') && t.includes(i18n.global.t('project.yarnKnitted', { n: 4 })))).toBe(true)
    })

    it('ni réservation ni consommation : retombe sur « aucune laine liée »', async () => {
      await seedProject()
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      expect(w.find('.yarnlist').exists()).toBe(false)
      expect(w.find('.yarnlist__empty').text()).toBe(i18n.global.t('project.yarnsNone'))
    })
  })

  describe('suppression : ne pose plus de question (R1 — retrait du dialogue « pelotes tricotées ? »)', () => {
    it('aucune laine réservée : supprime directement, sans poser de question', async () => {
      const pid = await seedProject()
      const w = mountDetail()
      await flushPromises()

      await w.find('.phdr__kebab').trigger('click')
      await w.findAll('.menu__item').find((b) => b.text() === i18n.global.t('project.delete')).trigger('click')

      // La cascade de suppression (Dexie) retombe sur plusieurs micro-tâches : on attend
      // le résultat plutôt qu'un seul flushPromises (même motif que le test « taille active »).
      await vi.waitFor(async () => expect(await db.projects.get(pid)).toBeUndefined(), { timeout: 10000 })
      expect(nav.router.replace).toHaveBeenCalledWith({ name: 'home' })
      // Passe bien par softDelete : le projet est récupérable depuis la corbeille (annulable).
      expect(await db.trash.count()).toBe(1)
    })

    it('laine réservée : supprime quand même directement, sans poser de question — la quantité n’est jamais touchée', async () => {
      const pid = await seedProject()
      const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()

      await w.find('.phdr__kebab').trigger('click')
      await w.findAll('.menu__item').find((b) => b.text() === i18n.global.t('project.delete')).trigger('click')

      await vi.waitFor(async () => expect(await db.projects.get(pid)).toBeUndefined(), { timeout: 10000 })
      expect(nav.router.replace).toHaveBeenCalledWith({ name: 'home' })
      const y = await db.yarns.get(yid)
      expect(y.reservations).toEqual({}) // la réservation revient au pool
      expect(y.quantity).toBe(5) // la suppression ne déduit JAMAIS la quantité (R1)
      expect(await db.trash.count()).toBe(1) // passe bien par softDelete (annulable)
    })
  })

  describe('clôture (statut Terminé) : « combien de pelotes as-tu utilisées ? »', () => {
    it('aucune laine réservée : passe à Terminé directement, sans poser de question', async () => {
      const pid = await seedProject()
      const w = mountDetail()
      await flushPromises()

      await w.findComponent(StatusBadge).vm.$emit('change', 'done')
      await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('done'), { timeout: 10000 })
      expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(false)
    })

    it('laine réservée : ouvre le dialogue et ne change pas le statut tant que non validé', async () => {
      const pid = await seedProject()
      const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()

      await w.findComponent(StatusBadge).vm.$emit('change', 'done')
      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })
      expect(w.findComponent(YarnConsumptionDialog).props('yarns')).toEqual([
        { id: yid, name: 'Drops · Bleu', reserved: 2 },
      ])
      expect((await db.projects.get(pid)).status).toBe('wip')
    })

    it('Valider avec les valeurs par défaut déduit tout le réservé et passe à Terminé', async () => {
      const pid = await seedProject()
      const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()

      await w.findComponent(StatusBadge).vm.$emit('change', 'done')
      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })

      await w.findComponent(YarnConsumptionDialog).vm.$emit('confirm', [{ id: yid, used: 2 }])
      await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('done'), { timeout: 10000 })
      expect((await db.yarns.get(yid)).quantity).toBe(3) // 5 - 2 tricotées
      expect((await db.yarns.get(yid)).reservations).toEqual({})
      expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(false)
    })

    it('valider avec une quantité rectifiée déduit seulement ce qui est saisi, le reste retourne au stock', async () => {
      const pid = await seedProject()
      const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()

      await w.findComponent(StatusBadge).vm.$emit('change', 'done')
      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })

      await w.findComponent(YarnConsumptionDialog).vm.$emit('confirm', [{ id: yid, used: 0 }])
      await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('done'), { timeout: 10000 })
      expect((await db.yarns.get(yid)).quantity).toBe(5) // rien tricoté : rien déduit
    })

    it("passer à Terminé depuis la fiche affiche IMMÉDIATEMENT la date de fin dans l'onglet Infos, sans recharger l'écran", async () => {
      // Défaut trouvé en revue : `changeStatus` ne recopiait que `project.value.status` après
      // l'écriture. La RÈGLE 1 (statut → date, §7bis) écrit `finishedAt` en base comme
      // effet de bord de `projectsStore.update()` — mais un objet local qui ne recopie pas ce
      // champ n'en sait rien : la tuile « Fin » de l'onglet Infos resterait vide jusqu'au
      // prochain chargement de l'écran, alors que l'utilisatrice vient de clôturer son projet
      // sous ses yeux. Vise le RENDU (ce test), pas la base (déjà couvert par le test
      // précédent) : sinon on prouverait à nouveau l'écriture, jamais l'affichage.
      const pid = await seedProject()
      const w = mountDetail()
      await flushPromises()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      const finTile = () => w.findAll('.itile').find((el) => el.find('.itile__k').text() === i18n.global.t('project.finishedAt'))
      expect(finTile()).toBeUndefined() // pas encore de date : le projet est 'wip'

      await w.findComponent(StatusBadge).vm.$emit('change', 'done')
      await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('done'), { timeout: 10000 })
      await vi.waitFor(() => expect(finTile()).toBeDefined(), { timeout: 10000 })
      expect(finTile().find('.itile__v').text()).not.toBe('')
    })
  })

  describe('abandon (statut Abandonné, R3) : même question, défaut inversé à 0', () => {
    it('laine réservée : passer à Abandonné ouvre le dialogue en mode « abandonné » (défaut 0)', async () => {
      const pid = await seedProject()
      await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()

      await w.findComponent(StatusBadge).vm.$emit('change', 'abandoned')
      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })
      expect(w.findComponent(YarnConsumptionDialog).props('mode')).toBe('abandoned')
      expect((await db.projects.get(pid)).status).toBe('wip')
    })

    it('Valider avec le défaut (0 perdu) ne déduit rien : tout revient au stock', async () => {
      const pid = await seedProject()
      const yid = await db.yarns.add({ brand: 'Drops', colorName: 'Bleu', quantity: 5, reservations: { [pid]: 2 } })
      const w = mountDetail()
      await flushPromises()

      await w.findComponent(StatusBadge).vm.$emit('change', 'abandoned')
      await vi.waitFor(() => expect(w.findComponent(YarnConsumptionDialog).props('open')).toBe(true), { timeout: 10000 })

      await w.findComponent(YarnConsumptionDialog).vm.$emit('confirm', [{ id: yid, used: 0 }])
      await vi.waitFor(async () => expect((await db.projects.get(pid)).status).toBe('abandoned'), { timeout: 10000 })
      expect((await db.yarns.get(yid)).quantity).toBe(5) // rien perdu : rien déduit
      expect((await db.yarns.get(yid)).reservations).toEqual({}) // le réservé revient au pool
    })
  })

  describe('projet dont le patron a disparu', () => {
    // Le patron supprimé de la bibliothèque laissait la fiche VIDE, sans explication.
    // Cf. audit UX 16/07 (« perte silencieuse = bug »).
    it('affiche un bandeau explicatif', async () => {
      await seedProject({ patternId: 999 }) // 999 : aucun patron ne porte cet id
      const w = mountDetail()
      await flushPromises()

      expect(w.text()).toMatch(/patron.*supprim/i)
      expect(w.text()).toMatch(/corbeille/i)
    })

    it('n’affiche pas « Suivre le patron » puisqu’il n’y a plus de patron', async () => {
      await seedProject({ patternId: 999 })
      const w = mountDetail()
      await flushPromises()

      expect(w.text()).not.toMatch(/Suivre le patron/i)
    })

    it('n’affiche aucun bandeau pour un projet libre (sans patron)', async () => {
      await seedProject({ patternId: null })
      const w = mountDetail()
      await flushPromises()

      expect(w.text()).not.toMatch(/patron.*supprim/i)
    })

    it('n’affiche aucun bandeau quand le patron est bien là', async () => {
      // Cas sain : le bandeau ne doit JAMAIS apparaître sur un projet dont le patron existe
      // (patternMissing = patternId != null ET linkedPattern == null). Ce test échoue si on
      // cassait la clause `linkedPattern == null` — la garde qui protège les projets sains.
      const patId = await db.patterns.add({ name: 'SABAI', reader: { sizeLabels: [], sections: [] } })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()

      expect(w.text()).not.toMatch(/patron.*supprim/i)
    })
  })

  describe('onglet Détails : section « Patron source » — vignette couverture + lien PDF', () => {
    it("plus de boutons Aperçu/Ouvrir (ProjectPdfGallery variant pdf retiré) même avec un PDF lié", async () => {
      const patId = await db.patterns.add({ name: 'SABAI', pdf: 'data:application/pdf;base64,AAAA' })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      const section = w.find('.patron-source')
      expect(section.exists()).toBe(true)
      expect(section.text()).not.toContain(i18n.global.t('patternExtras.preview'))
      expect(section.text()).not.toContain(i18n.global.t('patternExtras.openExternal'))
    })

    it('le lien « Voir le PDF original » appelle viewPatternPdf (openPdfExternally)', async () => {
      const patId = await db.patterns.add({ name: 'SABAI', pdf: 'data:application/pdf;base64,AAAA' })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      const link = w.find('.patron-source__open')
      expect(link.exists()).toBe(true)
      expect(link.text()).toContain(i18n.global.t('project.viewPdf'))
      await link.trigger('click')
      await flushPromises()

      expect(openPdfExternally).toHaveBeenCalledTimes(1)
      expect(openPdfExternally.mock.calls[0][0]).toBe('data:application/pdf;base64,AAAA')
    })

    it('sans PDF : le lien « Voir le PDF original » est absent', async () => {
      const patId = await db.patterns.add({ name: 'SABAI' })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      expect(w.find('.patron-source__open').exists()).toBe(false)
    })

    it("avec une photo de patron (photos[0]) : la vignette couverture est affichée et son tap ouvre le PDF", async () => {
      const patId = await db.patterns.add({
        name: 'SABAI',
        pdf: 'data:application/pdf;base64,AAAA',
        photos: ['data:image/png;base64,COVER', 'data:image/png;base64,SECOND'],
      })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      const cover = w.find('.patron-source__cover')
      expect(cover.exists()).toBe(true)
      const img = cover.find('img.patron-source__img')
      expect(img.exists()).toBe(true)
      expect(img.attributes('src')).toBe('data:image/png;base64,COVER') // 1re photo, pas la 2e

      await cover.trigger('click')
      await flushPromises()
      expect(openPdfExternally).toHaveBeenCalledTimes(1)
    })

    it('sans photo de patron : pas de vignette couverture', async () => {
      const patId = await db.patterns.add({ name: 'SABAI', pdf: 'data:application/pdf;base64,AAAA' })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      expect(w.find('.patron-source__cover').exists()).toBe(false)
    })

    it("avec une photo MAIS sans PDF retenu (import best-effort partiel) : pas de vignette couverture — éviterait un tap mort", async () => {
      const patId = await db.patterns.add({ name: 'SABAI', photos: ['data:image/png;base64,COVER'] })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await w.find('#tab-infos').trigger('click')
      await flushPromises()

      expect(w.find('.patron-source__cover').exists()).toBe(false)
    })
  })

  describe('menu ⋮ : « Voir le PDF original » + « Corriger le patron » (patron rattaché, #7+#8)', () => {
    async function openMenu(w) {
      await w.find('.phdr__kebab').trigger('click')
      await flushPromises()
    }
    function menuLabels(w) {
      return w.findAll('.menu__item').map((n) => n.text())
    }

    it('sans patron rattaché : ni « Voir le PDF original » ni « Corriger le patron »', async () => {
      await seedProject()
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      const labels = menuLabels(w)
      expect(labels).not.toContain(i18n.global.t('project.viewPdf'))
      expect(labels).not.toContain(i18n.global.t('project.correctPattern'))
    })

    it('patron rattaché sans PDF ni sections de lecteur : ni l’un ni l’autre item', async () => {
      const patId = await db.patterns.add({ name: 'SABAI' })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      const labels = menuLabels(w)
      expect(labels).not.toContain(i18n.global.t('project.viewPdf'))
      expect(labels).not.toContain(i18n.global.t('project.correctPattern'))
    })

    it('patron avec PDF : l’item « Voir le PDF original » ouvre le PDF et ferme le menu', async () => {
      const patId = await db.patterns.add({ name: 'SABAI', pdf: 'data:application/pdf;base64,AAAA' })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      const item = w.findAll('.menu__item').find((b) => b.text() === i18n.global.t('project.viewPdf'))
      expect(item).toBeTruthy()
      await item.trigger('click')
      await flushPromises()

      expect(openPdfExternally).toHaveBeenCalledTimes(1)
      expect(openPdfExternally.mock.calls[0][0]).toBe('data:application/pdf;base64,AAAA')
      expect(w.find('.menu').exists()).toBe(false) // le menu s'est fermé
    })

    it('patron sans PDF : l’item « Voir le PDF original » est absent', async () => {
      const patId = await db.patterns.add({ name: 'SABAI', reader: { sizeLabels: [], sections: [{ id: 's1', kind: 'pelote', title: 'Corps', steps: [] }] } })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      expect(menuLabels(w)).not.toContain(i18n.global.t('project.viewPdf'))
    })

    it('patron avec des sections de lecteur : l’item « Corriger le patron » route vers l’éditeur et ferme le menu', async () => {
      const patId = await db.patterns.add({
        name: 'SABAI',
        reader: { sizeLabels: [], sections: [{ id: 's1', kind: 'pelote', title: 'Corps', steps: [] }] },
      })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      const item = w.findAll('.menu__item').find((b) => b.text() === i18n.global.t('project.correctPattern'))
      expect(item).toBeTruthy()
      await item.trigger('click')

      expect(nav.router.push).toHaveBeenCalledWith({ name: 'pattern-correct', params: { id: patId } })
      expect(w.find('.menu').exists()).toBe(false) // le menu s'est fermé
    })

    it('patron sans sections de lecteur (reader.sections vide) : l’item « Corriger le patron » est absent', async () => {
      const patId = await db.patterns.add({ name: 'SABAI', pdf: 'data:application/pdf;base64,AAAA', reader: { sizeLabels: [], sections: [] } })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      expect(menuLabels(w)).not.toContain(i18n.global.t('project.correctPattern'))
    })

    it('échec de l’ouverture du PDF : ferme quand même le menu et avertit sans planter', async () => {
      openPdfExternally.mockRejectedValueOnce(new Error('boom'))
      const patId = await db.patterns.add({ name: 'SABAI', pdf: 'data:application/pdf;base64,AAAA' })
      await seedProject({ patternId: patId })
      const w = mountDetail()
      await flushPromises()
      await openMenu(w)

      const item = w.findAll('.menu__item').find((b) => b.text() === i18n.global.t('project.viewPdf'))
      await item.trigger('click')
      await flushPromises()

      expect(useSnackbarStore().message).toBe(i18n.global.t('patternExtras.openError'))
    })
  })
})

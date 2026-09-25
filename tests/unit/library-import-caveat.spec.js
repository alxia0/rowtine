// @vitest-environment jsdom
// Unitaire — l'avertissement « un patron importé se relit », à la première visite de la
// Bibliothèque (19/08/2026, §4.2).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import fr from '@/i18n/fr.json'
import { db, getSetting } from '@/db/db'
import { useSettingsStore } from '@/stores/settings'
import { useNoticeQueueStore } from '@/stores/notice-queue'
import { NOTICE } from '@/constants/notice-queue'
import { GUIDE_SECTION_BIBLIOTHEQUE } from '@/constants/guide-sections'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { createTestI18n } from './helpers/i18n-router'

const nav = vi.hoisted(() => ({
  route: { name: 'library', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
  RouterLink: { template: '<a><slot/></a>' },
}))

import LibraryView from '@/views/LibraryView.vue'

const i18n = createTestI18n()

// ⚠️ UNE SEULE Pinia pour tous les montages d'un même test — c'est ce qui fait qu'un second
// montage est bien la MÊME session. Une `createPinia()` par montage donnerait un magasin
// neuf, et « G9 » ci-dessous (démontage sans acquittement, puis remontage) passerait sans
// rien prouver : le second montage lirait un magasin vierge, pas la session qu'on a quittée.
beforeEach(async () => {
  setActivePinia(createPinia())
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  nav.router.push.mockClear()
})

async function monter() {
  const w = mount(LibraryView, { global: { plugins: [i18n] } })
  await flushPromises()
  return w
}

function popup(w) {
  return w
    .findAllComponents(ConfirmDialog)
    .find((d) => d.props('title') === fr.importCaveat.title)
}

describe('avertissement d import de la Bibliothèque', () => {
  it('drapeau posé : la pop-up s affiche', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setImportCaveatDue()
    // PRÉCONDITION : le drapeau est bien posé avant le montage.
    expect(s.importCaveatDue).toBe(true)

    const w = await monter()
    expect(popup(w).props('open')).toBe(true)
  })

  it('drapeau faux : la pop-up ne s affiche pas', async () => {
    // Ce test vide toute la base (beforeEach) — il prouve « drapeau faux → pas de pop-up »,
    // pas « base déjà en service » (une base en service a d'autres clés déjà posées,
    // onboarded/swipeHintSeen compris). Cette preuve-là, avec sa précondition exacte, vit
    // dans tests/unit/settings-import-caveat-due.spec.js:31-39 (« G7 »).
    const s = useSettingsStore()
    await s.load()
    expect(s.importCaveatDue).toBe(false)

    const w = await monter()
    expect(popup(w).props('open')).toBe(false)
  })

  it('« J ai compris » efface le drapeau, en mémoire ET en base', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setImportCaveatDue()

    const w = await monter()
    expect(popup(w).props('open')).toBe(true)

    await popup(w).vm.$emit('confirm')
    await flushPromises()

    // La pop-up se FERME : prouvé directement, pas seulement déduit de l'état du drapeau —
    // c'est ce que voit l'utilisatrice, et la seule des deux moitiés qu'un défaut d'affichage
    // pourrait casser sans toucher au drapeau.
    expect(popup(w).props('open')).toBe(false)
    expect(s.importCaveatDue).toBe(false)
    expect(await getSetting('importCaveatDue')).toBe(false)
  })

  it('« Comment corriger » mène au guide, sur la section Bibliothèque, et efface le drapeau', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setImportCaveatDue()

    const w = await monter()
    await popup(w).vm.$emit('cancel')
    await flushPromises()
    // `caveatToGuide` est asynchrone (elle attend l'écriture Dexie avant de naviguer) :
    // `vm.$emit` ne renvoie pas la promesse de son gestionnaire, et `flushPromises()` seul
    // ne vide que les microtâches — pas le tour d'horloge réel dont IndexedDB a besoin
    // (même piège que documenté ailleurs dans ce projet, ex. tests/unit/home-view.spec.js).
    // Sans ce tour, `router.push` n'a pas encore été appelé quand l'assertion s'exécute.
    await new Promise((r) => setTimeout(r))
    await flushPromises()

    expect(nav.router.push).toHaveBeenCalledWith({
      name: 'guide',
      query: { section: GUIDE_SECTION_BIBLIOTHEQUE },
    })
    expect(s.importCaveatDue).toBe(false)
  })

  it('G8 — un message plus fort occupe l écran : le drapeau SURVIT', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setImportCaveatDue()

    const q = useNoticeQueueStore()
    q.request(NOTICE.FOLDER_GATE)

    const w = await monter()

    // PRÉCONDITION : l'écran est RÉELLEMENT occupé par un rang plus fort. Sans elle, la
    // pop-up s'afficherait, l'assertion suivante serait vraie pour la mauvaise raison, et
    // le test ne prouverait rien.
    expect(q.active).toBe(NOTICE.FOLDER_GATE)
    expect(popup(w).props('open')).toBe(false)

    // Ce qui est prouvé : le drapeau n'a pas été consommé par la simple demande.
    expect(s.importCaveatDue).toBe(true)
    expect(await getSetting('importCaveatDue')).toBe(true)

    // Et l'avertissement prend la parole dès que le plus fort se retire.
    q.withdraw(NOTICE.FOLDER_GATE)
    await flushPromises()
    expect(popup(w).props('open')).toBe(true)
  })

  describe('appui à côté (Échap, voile) : ferme sans naviguer (décision produit du 19/08/2026, en revue, mot pour mot : « un appui à côté doit juste fermer »)', () => {
    it('Échap ferme la pop-up, acquitte le drapeau, et NE NAVIGUE PAS', async () => {
      const s = useSettingsStore()
      await s.load()
      await s.setImportCaveatDue()

      const w = await monter()
      // PRÉCONDITION : la pop-up est RÉELLEMENT affichée avant l'appui — sinon sa fermeture
      // ne prouverait rien.
      expect(popup(w).props('open')).toBe(true)

      await document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      // Même tour d'horloge réel que « Comment corriger » ci-dessus : si un gestionnaire
      // asynchrone naviguait, il faut lui laisser le temps de le faire avant de conclure
      // qu'il ne l'a pas fait.
      await flushPromises()
      await new Promise((r) => setTimeout(r))
      await flushPromises()

      // La pop-up se ferme pour de bon (cf. « J'ai compris » plus haut) : la fermeture est
      // la moitié visible du geste, le drapeau en est l'autre.
      expect(popup(w).props('open')).toBe(false)
      expect(s.importCaveatDue).toBe(false)
      expect(await getSetting('importCaveatDue')).toBe(false)
      // Ce qui distingue ce test d'un simple « le bon bouton a changé » : on NOMME la
      // navigation qu'on refuse, pas seulement l'état du drapeau.
      expect(nav.router.push).not.toHaveBeenCalled()
    })

    it('un clic sur le voile fait exactement la même chose', async () => {
      const s = useSettingsStore()
      await s.load()
      await s.setImportCaveatDue()

      const w = await monter()
      expect(popup(w).props('open')).toBe(true)

      await popup(w).find('.cfd__scrim').trigger('click')
      await flushPromises()
      await new Promise((r) => setTimeout(r))
      await flushPromises()

      expect(popup(w).props('open')).toBe(false)
      expect(s.importCaveatDue).toBe(false)
      expect(await getSetting('importCaveatDue')).toBe(false)
      expect(nav.router.push).not.toHaveBeenCalled()
    })

    it('un clic DÉLIBÉRÉ sur « Comment corriger » navigue toujours (la voie secondaire reste ouverte)', async () => {
      // Redondant en partie avec le test « Comment corriger » plus haut — répété ici, à
      // côté des deux précédents, pour que le contraste (appui à côté vs clic délibéré)
      // se lise d'un coup dans ce même bloc.
      const s = useSettingsStore()
      await s.load()
      await s.setImportCaveatDue()

      const w = await monter()
      await popup(w).find('[data-test="confirm-cancel"]').trigger('click')
      await flushPromises()
      await new Promise((r) => setTimeout(r))
      await flushPromises()

      expect(nav.router.push).toHaveBeenCalledWith({
        name: 'guide',
        query: { section: GUIDE_SECTION_BIBLIOTHEQUE },
      })
    })

    it('le focus initial se pose sur « J ai compris », l option sûre — jamais sur « Comment corriger »', async () => {
      const s = useSettingsStore()
      await s.load()
      await s.setImportCaveatDue()

      // attachTo: document.body — nécessaire ici (et seulement ici) : jsdom ne fait vivre
      // `document.activeElement` que pour un élément réellement attaché au DOM du document,
      // contrairement au reste du fichier qui n'a besoin que de l'arbre de rendu isolé de
      // Vue Test Utils. Démonté explicitement à la fin pour ne rien laisser derrière soi.
      const w = mount(LibraryView, { global: { plugins: [i18n] }, attachTo: document.body })
      await flushPromises()
      await new Promise((r) => setTimeout(r))
      await flushPromises()

      // PRÉCONDITION : la pop-up est bien celle qui est affichée — sinon le focus observé
      // pourrait appartenir à un tout autre élément de l'écran.
      expect(popup(w).props('open')).toBe(true)
      expect(document.activeElement?.textContent).toBe(fr.common.gotIt)

      w.unmount()
    })
  })

  // G9 — l'AUTRE moitié de l'invariant du commentaire de LibraryView.vue (« si
  // l'utilisatrice quitte la Bibliothèque avant d'avoir vu la pop-up, celle-ci revient à la
  // visite suivante »). G8 ci-dessus prouve la moitié « message plus fort » ; celle-ci
  // prouve la moitié « démontage sans acquittement ». Trouvée en revue :
  // AUCUN garde-fou ne la couvrait — une mutation qui effacerait le drapeau dès l'AFFICHAGE
  // de la pop-up (au lieu de son acquittement) laissait les 6 tests d'alors tous verts.
  it('G9 — démontée SANS acquittement (navigation) : le drapeau SURVIT, la pop-up revient au remontage', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setImportCaveatDue()

    const w = await monter()
    // PRÉCONDITION : la pop-up est RÉELLEMENT affichée avant le démontage. Sans elle, sa
    // réapparition au remontage ne prouverait rien — elle aurait pu ne jamais être vue.
    expect(popup(w).props('open')).toBe(true)

    // Démontage SANS toucher un bouton : ni « J'ai compris » ni « Comment corriger »
    // n'est déclenché — le cas d'une utilisatrice qui navigue ailleurs avant d'avoir lu.
    w.unmount()

    // Ce qui doit être prouvé : rien n'a effacé le drapeau au seul fait d'avoir été
    // affiché — ni en mémoire, ni en base.
    expect(s.importCaveatDue).toBe(true)
    expect(await getSetting('importCaveatDue')).toBe(true)

    // Remontage dans la MÊME session Pinia (cf. le commentaire du beforeEach) : la pop-up
    // doit reprendre la parole, exactement comme à la première visite — jamais vue une
    // fois pour toutes faute d'acquittement.
    const w2 = await monter()
    expect(popup(w2).props('open')).toBe(true)
  })

  // Paire NOUVELLE, née en cours de lot (une évolution récente a déplacé l'astuce de balayage sur la
  // Bibliothèque) : les deux avertissements demandent maintenant le MÊME écran à la
  // première visite. La file garantit qu'un seul s'affiche à la fois — mais l'utilisatrice verra
  // bien DEUX pop-up de suite, l'avertissement d'import (rang 6) puis l'astuce (rang 7).
  // Ce test devient, avec ce lot, la QUATRIÈME paire réelle (les trois autres sont dans
  // `notice-queue-paires.spec.js` et `first-detail-tip-bandeau-import.spec.js`) : avant
  // ce changement, `importCaveat` n'était câblé nulle part, la cohabitation restait théorique.
  it('paire réelle : import x astuce de balayage — l avertissement parle d abord, l astuce ensuite', async () => {
    const s = useSettingsStore()
    await s.load()
    await s.setImportCaveatDue()
    // PRÉCONDITION : l'astuce n'a jamais été vue non plus — sinon elle ne demanderait pas
    // l'écran, et la suite du test prouverait la mauvaise chose (aucune vraie compétition).
    expect(s.swipeHintSeen).toBe(false)

    const w = await monter()

    const q = useNoticeQueueStore()
    // PRÉCONDITION : les deux sont bien demandeurs EN MÊME TEMPS — c'est la situation
    // réelle vécue par l'utilisatrice à sa première visite de la Bibliothèque, pas un artefact du
    // test.
    expect(q.requesters).toContain(NOTICE.IMPORT_CAVEAT)
    expect(q.requesters).toContain(NOTICE.SWIPE_HINT)
    expect(q.active).toBe(NOTICE.IMPORT_CAVEAT)

    expect(popup(w).props('open')).toBe(true)
    const tipDialog = w
      .findAllComponents(ConfirmDialog)
      .find((d) => d.props('title') === fr.onboarding.tipTitle)
    expect(tipDialog.props('open')).toBe(false)

    // L'avertissement s'acquitte — l'astuce prend la parole tout de suite après.
    await popup(w).vm.$emit('confirm')
    await flushPromises()

    expect(q.active).toBe(NOTICE.SWIPE_HINT)
    expect(tipDialog.props('open')).toBe(true)
  })
})

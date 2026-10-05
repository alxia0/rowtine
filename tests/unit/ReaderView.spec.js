// @vitest-environment jsdom
// Composant — ReaderView. Deux contextes :
//  - biblio (pattern-read) : APERÇU LECTURE SEULE (ni taille, ni coches, ni progression, ni compteur).
//  - projet (project-read) : SUIVI INTERACTIF (taille, progression, compteur, diagramme, persistance projet).
// vue-router mocké ; base Dexie réelle.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import i18n from '@/i18n'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'
import { buildReference } from '@/utils/reader-reference'
import { resolveStitch } from '@/content/stitch-memo'
import { useProjectsStore } from '@/stores/projects'
import { useActiveSessionStore } from '@/stores/activeSession'
import { useSnackbarStore } from '@/stores/snackbar'
import ChronoPill from '@/components/ChronoPill.vue'

const nav = vi.hoisted(() => ({
  route: { name: 'project-read', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import ReaderView from '@/views/ReaderView.vue'
import { makeTk } from './helpers/i18n-router'

const tk = makeTk(i18n)

// Modèle « plat » : chaque item de section est ROW / NOTE / REP(repeat) / CHART. IDs générés
// au rendu sous la forme `${sec.id}#${index}`.
const FIX_READER = {
  sizeLabels: ['S', 'M', 'L'],
  sizeSub: ['80', '90', '100'],
  sizeSubLabel: 'buste',
  easeHint: 'Choisis bien ta taille.',
  chart: { rows: 4, img: '/patterns/twist-chart.png', repeat: '2 m × 4 rangs', readDir: 'droite à gauche' },
  sections: [
    {
      id: 's1', icon: '🧶', title: 'Section 1',
      steps: [
        { t: 'Monter {{0}} m end.', c: [[10, 12, 14]] }, // s1#0 (rang)
        { t: 'Rang 2 : tric.' }, // s1#1 (rang)
        { t: 'Répéter {{0}} fois.', total: [2, 3, 4], c: [[2, 3, 4]], repeat: true }, // s1#2 (compteur)
        { t: 'Remarque : bla.', note: true }, // s1#3 (note, non cochable)
        { chart: true }, // s1#4
      ],
    },
  ],
  reference: {
    abbr: { end: 'à l’endroit' },
    abbrLink: {},
    abbrFull: [['end', 'endroit']],
    tiles: [{ tab: 'abbr', icon: '🔤', title: 'Abréviations', sub: 'end' }],
    tabs: [{ id: 'abbr', label: 'Abréviations', blocks: [{ h3: 'Abr', abbrFull: true }] }],
  },
}

async function seedProject(reader = FIX_READER, extra = {}) {
  const patternId = await db.patterns.add({ name: 'Patron test', type: 'knitting', reader })
  const projectId = await db.projects.add({ name: 'Projet test', technique: 'knitting', patternId, ...extra })
  nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
  return { patternId, projectId }
}
async function seedLibrary(reader = FIX_READER) {
  const patternId = await db.patterns.add({ name: 'Patron test', type: 'knitting', reader })
  nav.route = { name: 'pattern-read', params: { id: String(patternId) }, query: {} }
  return { patternId }
}
const wrappers = []
// `attachTo: document.body` : sans ça, l'arbre monté n'est PAS dans le vrai `document` et
// `document.getElementById('rstep-…' / 'rsec-…')` (utilisé par resume()/le scroll de cible
// de section, #9) ne trouve jamais rien — pas une particularité de nos nouveaux tests, le
// code de prod l'utilise déjà (resume()). `wrapper.unmount()` retire l'élément attaché.
function mountReader() {
  const w = mount(ReaderView, { global: { plugins: [createPinia(), i18n] }, attachTo: document.body })
  wrappers.push(w)
  return w
}
// Laisse l'onMounted async (synchro MD ciblée à l'ouverture, chargement projet/patron,
// chrono) + la file d'écritures se vider. Plusieurs tours : depuis le câblage de la
// synchro ciblée (Lot N3), l'onMounted enchaîne davantage d'allers-retours IndexedDB
// (pré-lecture → synchro → relecture) qu'un seul micro-tick ne suffit pas toujours à
// vider avec fake-indexeddb.
async function settle() {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r))
  }
  await flushPromises()
}

// jsdom n'implémente pas scrollIntoView (élément.scrollIntoView === undefined) : on le
// remplace par un mock qui trace (id de l'élément, options) — nécessaire pour prouver QUELLE
// cible a reçu le défilement (#9 : section ciblée vs reprise au rang courant), pas seulement
// que « un » scrollIntoView a été appelé quelque part (tous les éléments partagent la même
// fonction via le prototype : sans capturer `this.id`, on ne pourrait pas les distinguer).
let scrollCalls
beforeEach(async () => {
  setActivePinia(createPinia())
  nav.router.push.mockClear()
  nav.router.replace.mockClear()
  localStorage.clear()
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  scrollCalls = []
  Element.prototype.scrollIntoView = vi.fn(function (opts) {
    scrollCalls.push({ id: this.id, opts })
  })
})
afterEach(() => {
  // Démonte les composants pour couper leurs tâches async (persist en file, chrono) entre tests.
  while (wrappers.length) wrappers.pop().unmount()
})

describe('ReaderView — suivi de projet (interactif)', () => {
  it('affiche le titre et les pastilles de taille', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    expect(w.find('.rhdr__title').text()).toBe('Patron test')
    expect(w.findAll('.szpill').length).toBe(3)
  })

  // Les marqueurs de suivi et leur légende sont réservés à l'aperçu lecture seule.
  it('ne porte aucun marqueur .rmark ni légende .rlegend', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    expect(w.find('.rmark').exists()).toBe(false)
    expect(w.find('.rlegend').exists()).toBe(false)
  })

  it('filtre les chiffres selon la taille choisie', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    expect(w.find('.rl-num--all').text()).toBe('10 (12) 14')
    await w.findAll('.szpill')[1].trigger('click')
    await settle()
    expect(w.find('.rl-num--picked').text()).toBe('12')
    expect(w.find('.rl-num--all').exists()).toBe(false)
  })

  it('cocher une étape met à jour la progression', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    expect(w.find('.rhdr__pct').text()).toBe('0 %')
    await w.findAll('.rcheck')[0].trigger('click')
    await settle()
    expect(w.findAll('.rstep')[0].classes()).toContain('rstep--done')
    expect(w.find('.rhdr__pct').text()).toBe('33 %')
  })

  it('rend la bande d’images d’un step qui en porte (#5)', async () => {
    const readerImg = {
      ...FIX_READER,
      sections: [{ id: 's1', title: 'Section 1', steps: [{ t: 'Rang illustré.', imgs: ['data:image/png;base64,STEP'] }] }],
    }
    await seedProject(readerImg)
    const w = mountReader()
    await settle()
    const imgs = w.findAll('.stepimgs img')
    expect(imgs.length).toBeGreaterThanOrEqual(1)
    expect(imgs.some((n) => n.attributes('src') === 'data:image/png;base64,STEP')).toBe(true)
  })

  it('le compteur de répétitions incrémente selon la taille', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    await w.findAll('.szpill')[1].trigger('click')
    await settle()
    const counter = w.find('.rcount')
    expect(counter.find('.rcount__val').text()).toBe('0 / 3')
    await counter.findAll('.rcount__btn')[1].trigger('click')
    await settle()
    expect(w.find('.rcount__val').text()).toBe('1 / 3')
  })

  // Un compteur non atteint est l'étape en cours : mise en évidence, puce et reprise s'y arrêtent.
  it('l\'étape en cours s\'arrête sur un compteur de répétition non atteint', async () => {
    await seedProject(FIX_READER, { readerState: { size: 1, done: { 's1#0': true, 's1#1': true } } })
    const w = mountReader()
    await settle()
    const cur = w.findAll('.rstep--cur')
    expect(cur.length).toBe(1)
    expect(cur[0].classes()).toContain('rstep--rep')
    expect(cur[0].attributes('id')).toBe('rstep-s1#2')
    scrollCalls = []
    await w.find('.chip--resume').trigger('click')
    expect(scrollCalls.at(-1).id).toBe('rstep-s1#2')
    expect(scrollCalls.at(-1).opts.block).toBe('center')
    expect(scrollCalls.at(-1).opts.behavior).toBe('smooth')
  })

  // Atteindre le total d'un compteur recentre sur l'étape suivante, comme un cochage.
  it('le + qui atteint le total recentre sur l\'étape suivante', async () => {
    const readerRep = {
      ...FIX_READER,
      sections: [
        {
          id: 's1', title: 'Section 1',
          steps: [{ t: 'Rang un.' }, { t: 'Répéter {{0}} fois.', total: [2, 3, 4], c: [[2, 3, 4]], repeat: true }, { t: 'Rang trois.' }],
        },
      ],
    }
    await seedProject(readerRep, { readerState: { size: 0, done: { 's1#0': true } } })
    const w = mountReader()
    await settle()
    scrollCalls = []
    const plus = () => w.find('.rcount').findAll('.rcount__btn')[1]
    await plus().trigger('click')
    await settle()
    expect(scrollCalls).toEqual([])
    await plus().trigger('click')
    await settle()
    expect(scrollCalls).toEqual([{ id: 'rstep-s1#2', opts: { behavior: 'smooth', block: 'center' } }])
    expect(w.find('#rstep-s1\\#2').classes()).toContain('rstep--cur')
  })

  // Revue du passage multilingue (29/07) : les deux boutons du compteur portaient
  // `aria-label="−"` et `aria-label="+"` — un GLYPHE, et non traduit. Double manquement :
  // la règle « jamais de glyphe dans l'UI » vaut aussi pour un aria-label (leçon déjà tirée
  // sur la case « section faite »), et un lecteur d'écran annonçait donc un caractère au
  // lieu d'une action, en français quelle que soit la langue de l'app.
  //
  // Les valeurs attendues sont lues dans les fichiers de langue BRUTS, pas via l'instance
  // i18n de l'app : celle-ci a `fallbackLocale: 'en'`, donc une clé allemande manquante ou
  // mal orthographiée retomberait silencieusement sur l'anglais et ce test resterait vert —
  // exactement le défaut qu'il est censé attraper.
  const LANGUES_ARIA = [
    ['fr', fr],
    ['en', en],
    ['de', de],
    ['es', es],
  ]
  it.each(LANGUES_ARIA)(
    'les boutons du compteur de répétitions annoncent une ACTION traduite, jamais un glyphe (%s)',
    async (locale, messages) => {
      const localePrecedente = i18n.global.locale.value
      try {
        i18n.global.locale.value = locale
        await seedProject()
        const w = mountReader()
        await settle()
        const btns = w.find('.rcount').findAll('.rcount__btn')
        expect(btns.length).toBe(2)

        const moins = btns[0].attributes('aria-label')
        const plus = btns[1].attributes('aria-label')
        expect(moins, `aria-label du bouton « − » en ${locale}`).toBe(messages.reader.repeatMinus)
        expect(plus, `aria-label du bouton « + » en ${locale}`).toBe(messages.reader.repeatPlus)

        // Un libellé qui serait resté le glyphe, ou qui sortirait le chemin de clé brut
        // (clé absente ET repli anglais absent), doit faire rougir ici même si les deux
        // égalités ci-dessus venaient à être satisfaites par accident.
        for (const [nom, valeur] of [['−', moins], ['+', plus]]) {
          expect(valeur, `aria-label du bouton « ${nom} » en ${locale}`).not.toMatch(/^[−+\-±]$/)
          expect(valeur, `aria-label du bouton « ${nom} » en ${locale}`).not.toMatch(/^reader\./)
          expect(valeur.length, `aria-label du bouton « ${nom} » en ${locale}`).toBeGreaterThan(3)
        }
      } finally {
        i18n.global.locale.value = localePrecedente
      }
    },
  )

  it('un pas cadence (every) affiche « tous les X rangs » ; un pas répétition simple non', async () => {
    const readerCad = {
      ...FIX_READER,
      sections: [
        {
          id: 's1', title: 'Section 1',
          steps: [
            { t: 'Répéter le motif.', total: [4, 5, 6], c: [[4, 5, 6]], repeat: true, every: 4 }, // cadence
            { t: 'Répéter {{0}} fois.', total: [2, 3, 4], c: [[2, 3, 4]], repeat: true }, // répétition simple
          ],
        },
      ],
    }
    await seedProject(readerCad)
    const w = mountReader()
    await settle()
    const cadences = w.findAll('.rstep__cadence')
    expect(cadences.length).toBe(1) // seule la cadence porte le rappel
    expect(cadences[0].text()).toBe(i18n.global.t('reader.cadenceEvery', { every: 4 }))
    expect(cadences[0].text()).toContain('4') // la période est bien interpolée (pas « {every} » littéral)
  })

  it('affiche le diagramme et avance le rang', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    const chart = w.find('.chart')
    expect(chart.exists()).toBe(true)
    expect(chart.find('.chart__val').text()).toBe('1 / 4')
    await chart.findAll('.chart__btn')[1].trigger('click')
    await settle()
    expect(w.find('.chart__val').text()).toBe('2 / 4')
  })

  it('affiche un chrono discret (contexte projet)', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    expect(w.find('.chrono-fab').exists()).toBe(true)
  })

  // Spec 08/09 : masqué = la pastille disparaît ENTIÈREMENT (capsule + chevron). Les
  // portes de retour ne sont plus dans cette barre mais dans le kebab de la fiche et le
  // formulaire d'édition — l'ancien œil « toujours rendu » est un vestige supprimé.
  it('projet avec showTimer:false → pastille absente ENTIÈREMENT, chevron compris', async () => {
    await seedProject(FIX_READER, { showTimer: false })
    const w = mountReader()
    await settle()
    expect(w.find('.chrono-fab').exists()).toBe(false)
    expect(w.find('.chrono-fab__chev').exists()).toBe(false)
  })

  it('projet sans showTimer (défaut) → FAB chrono présent (F.2)', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    expect(w.find('.chrono-fab').exists()).toBe(true)
  })

  it('projet Terminé (contexte projet) → pastille absente même avec showTimer', async () => {
    await seedProject(FIX_READER, { status: 'done' })
    const w = mountReader()
    await settle()
    expect(w.find('.chrono-fab').exists()).toBe(false)
  })

  it('projet Abandonné (contexte projet) → pastille absente même avec showTimer', async () => {
    await seedProject(FIX_READER, { status: 'abandoned' })
    const w = mountReader()
    await settle()
    expect(w.find('.chrono-fab').exists()).toBe(false)
  })

  // ── Chevron de la pastille (spec 08/09, variante B : l'œil a disparu de la barre) ──
  // Le chevron vit DANS la pastille (ChronoPill) ; ses invariants de composant sont dans
  // chrono-pill.spec.js. Ici : le CÂBLAGE vue — canHide en contexte projet, l'appui
  // chevron → menu → entrée qui déclenche la bascule showTimer de CETTE vue.
  it('contexte projet : la pastille reçoit canHide=true et porte le chevron « masquer »', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    const pill = w.findComponent(ChronoPill)
    expect(pill.props('canHide')).toBe(true)
    expect(w.find('.chrono-fab__chev').attributes('aria-label')).toBe(i18n.global.t('reader.hideTimer'))
  })

  it('l’appui sur le chevron ouvre le menu et n’agit pas encore (pas de toggle, pas d’écriture)', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()
    const store = useProjectsStore()
    const spy = vi.spyOn(store, 'update')
    await w.find('.chrono-fab__chev').trigger('click')
    expect(w.find('.chrono-fab__menu').exists()).toBe(true)
    expect(w.find('.chrono-fab__menu-item').text()).toBe(i18n.global.t('reader.hideTimer'))
    // Ouvrir le menu n'est pas masquer : aucune écriture, chrono intact.
    expect(spy).not.toHaveBeenCalled()
    expect((await db.projects.get(projectId)).showTimer).not.toBe(false)
    expect(w.find('.chrono-fab__menu').exists()).toBe(true) // toujours ouvert (l'assertion d'écriture a eu le temps de retomber)
  })

  it('l’entrée du menu bascule project.showTimer via le store, la pastille disparaît ENTIÈREMENT', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()
    const store = useProjectsStore()
    const spy = vi.spyOn(store, 'update')
    await w.find('.chrono-fab__chev').trigger('click')
    await w.find('.chrono-fab__menu-item').trigger('click')
    await settle()
    expect(spy).toHaveBeenCalledWith(projectId, { showTimer: false })
    // La pastille ET son chevron disparaissent : les portes de retour sont désormais le
    // kebab de la fiche et l'interrupteur du formulaire (spec 08/09) — plus d'œil ici.
    // `p.showTimer = next` n'est posé qu'APRÈS l'await de closeChronoSession + update : sous la
    // charge de la suite complète (fake-indexeddb contendue), le settle() à tours fixes peut ne
    // pas couvrir cette chaîne. On attend l'état final au lieu d'un nombre de tours figé.
    await vi.waitFor(() => {
      expect(w.findComponent(ChronoPill).exists()).toBe(false)
    }, { timeout: 10000 })
  })

  it('masquer affiche le snackbar « Chrono masqué » ; son Réafficher repasse showTimer:true ET rouvre la session', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()
    const snackbar = useSnackbarStore()
    await w.find('.chrono-fab__chev').trigger('click')
    await w.find('.chrono-fab__menu-item').trigger('click')
    // Snackbar porteur de l'action « Réafficher » (reader.showTimer), jamais d'aller sans
    // retour. ⚠️ Ancrage sur le MESSAGE, pas sur `visible` seul : closeChronoSession (si le
    // chrono tournait) affiche LUI-MÊME un snackbar intermédiaire — un visible=true capté
    // avant notre show serait le sien (faux rouge sous charge). Message + action sont posés
    // atomiquement par le même show().
    await vi.waitFor(() => {
      expect(snackbar.visible).toBe(true)
      expect(snackbar.message).toBe(i18n.global.t('reader.timerHidden'))
    }, { timeout: 10000 })
    expect(snackbar.actionLabel).toBe(i18n.global.t('reader.showTimer'))
    await vi.waitFor(async () => expect((await db.projects.get(projectId)).showTimer).toBe(false), { timeout: 10000 })
    // Le geste « Réafficher » : showTimer:true persisté ET session rouverte sur le projet
    // (ctx lecteur : il avait pris le chrono en charge à l'arrivée, symétrie exigée).
    snackbar.runAction()
    await vi.waitFor(async () => expect((await db.projects.get(projectId)).showTimer).toBe(true), { timeout: 10000 })
    await settle()
    expect(useActiveSessionStore().isActive).toBe(true)
    expect(useActiveSessionStore().projectId).toBe(projectId)
    expect(w.findComponent(ChronoPill).exists()).toBe(true)
  })

  // ORDRE ÉPINGLÉ (spec 08/09, invariant 1) : la session est COMMITÉE (temps écrit en base)
  // AVANT l'écriture showTimer:false. On intercepte update() au seuil du store : au moment
  // où il est appelé, la séance DOIT déjà être en base — l'inverse laisserait une fenêtre
  // où un échec ferait perdre le temps, ou pire, un comptage invisible persisté.
  it('masquer un chrono EN MARCHE : la séance est déjà en base AU MOMENT de l’écriture showTimer:false', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()
    await w.find('.chrono-fab__body').trigger('click') // démarre le chrono
    const active = useActiveSessionStore()
    await vi.waitFor(() => expect(active.running).toBe(true), { timeout: 10000 })
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000)
    let duréeEnBaseAuMomentDEcrire = null
    const store = useProjectsStore()
    const réel = store.update.bind(store)
    vi.spyOn(store, 'update').mockImplementation(async (id, patch) => {
      if (patch?.showTimer === false) {
        const rows = await db.sessions.where('projectId').equals(projectId).toArray()
        duréeEnBaseAuMomentDEcrire = rows.length ? rows[0].durationSec : null
      }
      return réel(id, patch)
    })
    await w.find('.chrono-fab__chev').trigger('click')
    await w.find('.chrono-fab__menu-item').trigger('click')
    await vi.waitFor(() => expect(duréeEnBaseAuMomentDEcrire).not.toBeNull(), { timeout: 10000 })
    expect(duréeEnBaseAuMomentDEcrire).toBeGreaterThan(0)
    await vi.waitFor(() => expect(active.isActive).toBe(false), { timeout: 10000 })
  })

  it('chrono en marche → masquer l’arrête ET enregistre le temps en session', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()
    // Démarre le chrono (le CORPS de la pastille déclenche active.play()).
    await w.find('.chrono-fab__body').trigger('click')
    const active = useActiveSessionStore()
    expect(active.running).toBe(true)
    // Simule ~2 s écoulées pour que la session ait une durée > 0 (sinon rien à enregistrer).
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000)
    // Masquer alors que le chrono tourne : doit l'arrêter (temps enregistré, pas de comptage invisible).
    await w.find('.chrono-fab__chev').trigger('click')
    await w.find('.chrono-fab__menu-item').trigger('click')
    // Fermeture observée sur l'état final, pas sur un nombre de tours de settle() : la
    // clôture enchaîne des étapes Dexie en file (pause commitante + stopAndClear) qui,
    // sous la charge de la suite complète (fake-indexeddb contendue), peuvent dépasser le
    // settle() à tours fixes — même motif que le banc « entrée du menu » ci-dessus.
    await vi.waitFor(() => expect(active.isActive).toBe(false), { timeout: 10000 })
    await settle()
    nowSpy.mockRestore()
    // Chrono arrêté et vidé (plus de comptage en fond).
    expect(active.running).toBe(false)
    // Le temps écoulé a bien été matérialisé en session pour ce projet.
    const sessions = await db.sessions.where('projectId').equals(projectId).toArray()
    expect(sessions.length).toBe(1)
    expect(sessions[0].durationSec).toBeGreaterThan(0)
  })

  it('chrono EN PAUSE → masquer enregistre quand même le temps ET vide la session (pas de fuite)', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()
    const active = useActiveSessionStore()
    // Démarre le chrono…
    await w.find('.chrono-fab__body').trigger('click')
    expect(active.running).toBe(true)
    // …simule ~2 s puis MET EN PAUSE (running devient faux, mais la session reste active).
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000)
    await w.find('.chrono-fab__body').trigger('click') // pause
    expect(active.running).toBe(false)
    expect(active.isActive).toBe(true)
    // Masquer alors qu'il est EN PAUSE : doit tout de même enregistrer + vider la session
    // active (sinon elle traînerait dans Dexie et serait ré-attribuée à un autre projet).
    await w.find('.chrono-fab__chev').trigger('click')
    await w.find('.chrono-fab__menu-item').trigger('click')
    // Même ancrage que le banc « en marche » : l'état final de la clôture (file Dexie :
    // pause commitante puis stopAndClear) s'attend au lieu de dériver d'un compte de tours.
    await vi.waitFor(() => expect(active.isActive).toBe(false), { timeout: 10000 })
    await settle()
    nowSpy.mockRestore()
    const sessions = await db.sessions.where('projectId').equals(projectId).toArray()
    expect(sessions.length).toBe(1)
    expect(sessions[0].durationSec).toBeGreaterThan(0)
  })

  it('persiste la progression dans project.readerState', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()
    await w.findAll('.szpill')[2].trigger('click') // L
    await w.findAll('.rcheck')[0].trigger('click')
    // les écritures sont sérialisées (file) : on laisse la file se vider
    await settle()
    await new Promise((r) => setTimeout(r, 0))
    await settle()
    const p = await db.projects.get(projectId)
    expect(p.readerState.size).toBe(2)
    expect(p.readerState.done['s1#0']).toBe(true)
    expect(p.activeSize).toBe('L') // synchro taille active du projet
  })

  // La bascule « section faite » de la fiche projet écrit `sectionSnap` dans readerState
  // (instantané « décochage sans perte », section-mark.js). persist() du lecteur reconstruit
  // un snapshot en whitelist : sans report, la première coche détruirait l'instantané en
  // silence. (intent 2026-09-30-reprise — défaut découvert au passage.)
  it('persist() préserve sectionSnap écrit hors lecteur', async () => {
    const { projectId } = await seedProject(FIX_READER, {
      readerState: { done: {}, counters: {}, sectionSnap: { s1: { done: { 's1#1': true }, counters: { 's1#2': 1 } } } },
    })
    const w = mountReader()
    await settle()
    await w.findAll('.rcheck')[0].trigger('click')
    await settle()
    await new Promise((r) => setTimeout(r, 0))
    await settle()
    const p = await db.projects.get(projectId)
    expect(p.readerState.done['s1#0']).toBe(true)
    expect(p.readerState.sectionSnap).toEqual({ s1: { done: { 's1#1': true }, counters: { 's1#2': 1 } } })
  })

  it('persist() conserve copyState et activeCopy, et un projet ancien n\'en gagne pas', async () => {
    const { projectId } = await seedProject(FIX_READER, {
      readerState: { done: {}, counters: {}, copyState: { 2: { done: { 's1#1': true }, counters: {} } }, activeCopy: { s1: 2 } },
    })
    const w = mountReader()
    await settle()
    await w.findAll('.rcheck')[0].trigger('click')
    await settle()
    await new Promise((r) => setTimeout(r, 0))
    await settle()
    const p = await db.projects.get(projectId)
    expect(p.readerState.copyState).toEqual({ 2: { done: { 's1#1': true }, counters: {} } })
    expect(p.readerState.activeCopy).toEqual({ s1: 2 })
  })

  it('persist() n\'invente pas de sectionSnap quand il n\'y en avait pas', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()
    await w.findAll('.rcheck')[0].trigger('click')
    await settle()
    await new Promise((r) => setTimeout(r, 0))
    await settle()
    const p = await db.projects.get(projectId)
    expect(p.readerState.sectionSnap).toBeUndefined()
    expect(p.readerState.copyState).toBeUndefined()
    expect(p.readerState.activeCopy).toBeUndefined()
  })

  // Une taille enregistrée hors des tailles du patron (patron changé) ne doit pas être restaurée.
  it('readerState.size hors bornes : aucune taille retenue, activeSize jamais écrit undefined', async () => {
    const { projectId } = await seedProject(FIX_READER, { readerState: { size: 5 } })
    const w = mountReader()
    await settle()
    expect(w.find('.szpill--on').exists()).toBe(false)
    expect(w.find('.szcard__chosen').text()).toBe(tk('reader.noSize'))
    await w.findAll('.rcheck')[0].trigger('click')
    await settle()
    const p = await db.projects.get(projectId)
    expect(p.readerState.size).toBe(null)
    expect(p.activeSize).toBe('')
  })

  // Index hors bornes mais libellé `activeSize` connu : le libellé reprend la main.
  it('readerState.size hors bornes + activeSize connu : la taille du libellé est retenue', async () => {
    const { projectId } = await seedProject(FIX_READER, { activeSize: 'M', readerState: { size: 5 } })
    const w = mountReader()
    await settle()
    expect(w.find('.szpill--on').text()).toBe('M90')
    await w.findAll('.rcheck')[0].trigger('click')
    await settle()
    const p = await db.projects.get(projectId)
    expect(p.readerState.size).toBe(1)
    expect(p.activeSize).toBe('M')
  })

  it('la section passe en « Faite » quand rangs cochés et répétitions atteintes', async () => {
    await seedProject()
    const w = mountReader()
    await settle()
    await w.findAll('.szpill')[0].trigger('click') // taille S → répétition total 2
    await settle()
    // cocher les 2 rangs
    await w.findAll('.rcheck')[0].trigger('click')
    await w.findAll('.rcheck')[1].trigger('click')
    // amener le compteur de répétitions à 2/2
    const plus = w.find('.rcount').findAll('.rcount__btn')[1]
    await plus.trigger('click')
    await plus.trigger('click')
    await settle()
    expect(w.find('.rsec__prog--done').exists()).toBe(true)
  })

  describe('exemplaires en séquentiel', () => {
    const copiesReader = (sec = {}) => ({
      ...FIX_READER,
      sections: [
        { id: 'p1', kind: 'pied', copies: 2, title: 'Pied', steps: [{ t: 'Rang A' }, { t: 'Rang B' }], ...sec },
      ],
    })
    const nextBtn = (w) => w.find('.rsec__copies-next')

    it('affiche le titre d\'exemplaire et le bouton suivante ; cocher écrit dans done (exemplaire 1)', async () => {
      const { projectId } = await seedProject(copiesReader({ kind: 'manche' }))
      const w = mountReader()
      await settle()
      expect(w.find('.rsec__copy').text()).toBe(tk('reader.copies.title.generic', { n: 1, total: 2 }))
      expect(nextBtn(w).text()).toBe(tk('reader.copies.next.generic'))
      await w.findAll('.rcheck')[0].trigger('click')
      await settle()
      await new Promise((r) => setTimeout(r, 0))
      await settle()
      const p = await db.projects.get(projectId)
      expect(p.readerState.done).toEqual({ 'p1#0': true })
      expect(p.readerState.copyState).toBeUndefined()
    })

    it('passer à l\'exemplaire 2 repart vide, écrit dans copyState[2] et retrouve les coches de l\'exemplaire 1', async () => {
      const { projectId } = await seedProject(copiesReader({ kind: 'manche' }))
      const w = mountReader()
      await settle()
      await w.findAll('.rcheck')[0].trigger('click')
      await nextBtn(w).trigger('click')
      await settle()
      expect(w.find('.rsec__copy').text()).toBe(tk('reader.copies.title.generic', { n: 2, total: 2 }))
      expect(w.findAll('.rstep--done').length).toBe(0)
      await w.findAll('.rcheck')[1].trigger('click')
      await settle()
      await new Promise((r) => setTimeout(r, 0))
      await settle()
      let p = await db.projects.get(projectId)
      expect(p.readerState.done).toEqual({ 'p1#0': true })
      expect(p.readerState.copyState[2].done).toEqual({ 'p1#1': true })
      expect(p.readerState.activeCopy).toEqual({ p1: 2 })
      // Dernier exemplaire : le bouton boucle sur le 1, dont les coches reviennent.
      await nextBtn(w).trigger('click')
      await settle()
      expect(w.find('.rsec__copy').text()).toBe(tk('reader.copies.title.generic', { n: 1, total: 2 }))
      expect(w.findAll('.rstep--done').length).toBe(1)
      expect(w.findAll('.rcheck')[0].attributes('aria-checked')).toBe('true')
    })

    it('« Annuler » du snackbar revient à l\'exemplaire précédent', async () => {
      await seedProject(copiesReader({ kind: 'manche' }))
      const w = mountReader()
      await settle()
      await nextBtn(w).trigger('click')
      await settle()
      const snackbar = useSnackbarStore()
      expect(snackbar.visible).toBe(true)
      expect(snackbar.actionLabel).toBe(tk('common.undo'))
      snackbar.runAction()
      await settle()
      expect(w.find('.rsec__copy').text()).toBe(tk('reader.copies.title.generic', { n: 1, total: 2 }))
    })

    it('un exemplaire complet passe au suivant sans snackbar', async () => {
      await seedProject(copiesReader({ kind: 'manche' }), { readerState: { done: { 'p1#0': true, 'p1#1': true } } })
      const w = mountReader()
      await settle()
      await nextBtn(w).trigger('click')
      await settle()
      expect(useSnackbarStore().visible).toBe(false)
      expect(w.find('.rsec__copy').text()).toBe(tk('reader.copies.title.generic', { n: 2, total: 2 }))
    })

    it("le dernier rang de la chaussette 1 mène à la chaussette 2, pas à la section suivante", async () => {
      const reader = copiesReader()
      reader.sections.unshift({ id: 'm', title: 'Montage', steps: [{ t: 'Rang M' }] })
      reader.sections.push({ id: 'c', title: 'Corps', steps: [{ t: 'Rang Z' }] })
      await seedProject(reader)
      const w = mountReader()
      await settle()
      await w.findAll('.rcheck')[1].trigger('click')
      await w.findAll('.rcheck')[2].trigger('click')
      await settle()
      expect(w.find('.rsec__copy').text()).toBe(tk('reader.copies.title.chaussette', { n: 2, total: 2 }))
      expect(w.findAll('.rstep--done').length).toBe(0)
      expect(scrollCalls.at(-1).id).toBe('rstep-p1#0')
      // L'étape en cours suit la chaussette 2, même avec un rang non fait plus haut (hors ordre).
      expect(w.findAll('.rstep--cur').map((x) => x.attributes('id'))).toEqual(['rstep-p1#0'])
    })

    it("« Annuler » après la bascule automatique revient à la chaussette 1, rangs cochés", async () => {
      await seedProject(copiesReader())
      const w = mountReader()
      await settle()
      await w.findAll('.rcheck')[0].trigger('click')
      await w.findAll('.rcheck')[1].trigger('click')
      await settle()
      const snackbar = useSnackbarStore()
      expect(snackbar.actionLabel).toBe(tk('common.undo'))
      snackbar.runAction()
      await settle()
      expect(w.find('.rsec__copy').text()).toBe(tk('reader.copies.title.chaussette', { n: 1, total: 2 }))
      expect(w.findAll('.rstep--done').length).toBe(2)
    })

    it("chaussette en plusieurs sections : toute la chaussette 1, puis la chaussette 2 depuis sa première partie", async () => {
      const sock = {
        ...FIX_READER,
        sections: ['pointe', 'pied', 'talon'].map((k) => ({ id: k, kind: k, title: k, copies: 2, steps: [{ t: 'Rang A' }] })),
      }
      await seedProject(sock)
      const w = mountReader()
      await settle()
      const titles = () => w.findAll('.rsec__copy').map((x) => x.text())
      const sock1 = tk('reader.copies.title.chaussette', { n: 1, total: 2 })
      const sock2 = tk('reader.copies.title.chaussette', { n: 2, total: 2 })
      await w.findAll('.rcheck')[0].trigger('click')
      await settle()
      expect(titles()).toEqual([sock1, sock1, sock1])
      expect(w.findAll('.rstep--cur').map((x) => x.attributes('id'))).toEqual(['rstep-pied#0'])
      await w.findAll('.rcheck')[1].trigger('click')
      await w.findAll('.rcheck')[2].trigger('click')
      await settle()
      expect(titles()).toEqual([sock2, sock2, sock2])
      expect(w.findAll('.rstep--cur').map((x) => x.attributes('id'))).toEqual(['rstep-pointe#0'])
      expect(scrollCalls.at(-1).id).toBe('rstep-pointe#0')
    })

    it("un compteur qui finit l'exemplaire mène aussi à l'exemplaire suivant", async () => {
      await seedProject(copiesReader({ steps: [{ repeat: true, t: 'rep {{0}}', total: [2, 2], c: [[2, 2]] }] }))
      const w = mountReader()
      await settle()
      const plus = w.find('.rcount').findAll('.rcount__btn')[1]
      await plus.trigger('click')
      await plus.trigger('click')
      await settle()
      expect(w.find('.rsec__copy').text()).toBe(tk('reader.copies.title.chaussette', { n: 2, total: 2 }))
      expect(scrollCalls.at(-1).id).toBe('rstep-p1#0')
    })

    it('un type non chaussette utilise les libellés génériques', async () => {
      await seedProject(copiesReader({ kind: 'manche', copies: 3 }))
      const w = mountReader()
      await settle()
      expect(w.find('.rsec__copy').text()).toBe(tk('reader.copies.title.generic', { n: 1, total: 3 }))
      expect(nextBtn(w).text()).toBe(tk('reader.copies.next.generic'))
    })

    it.each(['talon', 'jambe'])('le type %s porte le titre chaussette, sans bouton suivante', async (kind) => {
      await seedProject(copiesReader({ kind }))
      const w = mountReader()
      await settle()
      expect(w.find('.rsec__copy').text()).toBe(tk('reader.copies.title.chaussette', { n: 1, total: 2 }))
      expect(nextBtn(w).exists()).toBe(false)
    })

    it('aperçu bibliothèque : la répétition demandée, sans bouton', async () => {
      await seedLibrary(copiesReader())
      const w = mountReader()
      await settle()
      expect(w.find('.rsec__copy').text()).toBe(tk('reader.copies.n', { n: 2 }))
      expect(nextBtn(w).exists()).toBe(false)
    })

    it('sans copies : ni sous-titre ni bouton ; en simultané : pas de bouton', async () => {
      await seedProject()
      let w = mountReader()
      await settle()
      expect(w.find('.rsec__copy').exists()).toBe(false)
      expect(nextBtn(w).exists()).toBe(false)
      w.unmount()
      await seedProject(copiesReader(), { readerState: { copyMode: 'simultaneous' } })
      w = mountReader()
      await settle()
      expect(nextBtn(w).exists()).toBe(false)
    })

    // Revue finale I1 : même étape en cours que la notification (section suivante, puis repli sur l'autre exemplaire).
    it('étape en cours : section suivante de l\'exemplaire actif, puis exemplaire non complet quand tout l\'actif est fait', async () => {
      const sock = {
        ...FIX_READER,
        sections: ['pointe', 'pied', 'talon'].map((k) => ({ id: k, kind: k, title: k, copies: 2, steps: [{ t: 'Rang A' }, { t: 'Rang B' }] })),
      }
      await seedProject(sock, { readerState: { done: { 'pointe#0': true, 'pointe#1': true }, last: { kind: 'step', id: 'pointe#1' } } })
      let w = mountReader()
      await settle()
      expect(w.findAll('.rstep--cur').map((x) => x.attributes('id'))).toEqual(['rstep-pied#0'])
      w.unmount()
      const all = Object.fromEntries(['pointe', 'pied', 'talon'].flatMap((k) => [[`${k}#0`, true], [`${k}#1`, true]]))
      await seedProject(sock, {
        readerState: { done: all, copyState: { 2: { done: { 'pointe#0': true, 'pointe#1': true, 'pied#0': true, 'pied#1': true }, counters: {} } }, last: { kind: 'step', id: 'talon#1' } },
      })
      w = mountReader()
      await settle()
      expect(w.findAll('.rstep--cur').map((x) => x.attributes('id'))).toEqual(['rstep-talon#0'])
    })

    it('la progression somme les exemplaires : un exemplaire fini sur deux = 50 %', async () => {
      await seedProject(copiesReader())
      const w = mountReader()
      await settle()
      await w.findAll('.rcheck')[0].trigger('click')
      await w.findAll('.rcheck')[1].trigger('click')
      await settle()
      expect(w.find('.rhdr__pct').text()).toBe('50 %')
      expect(w.find('.rsec__prog').text()).toBe('2/4')
    })
  })

  describe('technique des chaussettes du projet', () => {
    const sockReader = () => ({
      ...FIX_READER,
      sections: [
        { id: 'm', title: 'Montage', steps: [{ t: 'Rang M' }] },
        { id: 'p', kind: 'pied', copies: 2, title: 'Pied', steps: [{ t: 'Rang A' }, { t: 'Rang B' }] },
      ],
    })
    const opts = (w) => w.findAll('.techcard .szpill')
    const settleAll = async () => {
      await settle()
      await new Promise((r) => setTimeout(r, 0))
      await settle()
    }

    it('visible seulement avec des parties de chaussette à 2 exemplaires ; « l\'une après l\'autre » coché par défaut', async () => {
      await seedProject(sockReader())
      let w = mountReader()
      await settle()
      expect(w.find('.techcard h2').text()).toBe(tk('reader.copies.technique'))
      expect(opts(w).map((b) => b.attributes('aria-checked'))).toEqual(['true', 'false'])
      w.unmount()
      await seedProject()
      w = mountReader()
      await settle()
      expect(w.find('.techcard').exists()).toBe(false)
    })

    it('sans rang de chaussette fait : bascule immédiate, persistée, progression du montage gardée', async () => {
      const { projectId } = await seedProject(sockReader(), { readerState: { done: { 'm#0': true } } })
      const w = mountReader()
      await settle()
      await opts(w)[1].trigger('click')
      await settleAll()
      expect(w.findComponent({ name: 'ConfirmDialog' }).props('open')).toBe(false)
      expect(w.findAll('.rstep').filter((s) => s.findAll('.rcheck').length === 2).length).toBe(2)
      const p = await db.projects.get(projectId)
      expect(p.readerState.copyMode).toBe('simultaneous')
      expect(p.readerState.done).toEqual({ 'm#0': true })
    })

    it('toucher la technique déjà choisie ne fait rien', async () => {
      await seedProject(sockReader(), { readerState: { done: { 'p#0': true } } })
      const w = mountReader()
      await settle()
      await opts(w)[0].trigger('click')
      await settle()
      expect(w.findComponent({ name: 'ConfirmDialog' }).props('open')).toBe(false)
    })

    it('avec un rang de chaussette fait : confirmation ; Annuler ne change rien, Recommencer remet les chaussettes à zéro', async () => {
      const { projectId } = await seedProject(sockReader(), {
        readerState: { done: { 'm#0': true, 'p#0': true }, copyMode: 'simultaneous' },
      })
      const w = mountReader()
      await settle()
      await opts(w)[0].trigger('click')
      await settle()
      const dlg = w.findComponent({ name: 'ConfirmDialog' })
      expect(dlg.props('open')).toBe(true)
      expect(dlg.props('message')).toBe(tk('reader.copies.resetMsg'))
      dlg.vm.$emit('cancel')
      await settleAll()
      expect((await db.projects.get(projectId)).readerState.copyMode).toBe('simultaneous')
      await opts(w)[0].trigger('click')
      await settle()
      w.findComponent({ name: 'ConfirmDialog' }).vm.$emit('confirm')
      await settleAll()
      const p = await db.projects.get(projectId)
      expect(p.readerState.copyMode).toBeUndefined()
      expect(p.readerState.done).toEqual({ 'm#0': true })
      expect(w.find('.rsec__copy').text()).toBe(tk('reader.copies.title.chaussette', { n: 1, total: 2 }))
    })

    it('une partie de chaussette ajoutée pendant la chaussette 2 démarre aussi sur la chaussette 2', async () => {
      const reader = {
        ...FIX_READER,
        sections: ['cotes', 'gousset', 'pied'].map((k) => ({ id: k, kind: k, title: k, copies: 2, steps: [{ t: 'Rang A' }] })),
      }
      await seedProject(reader, { readerState: { done: { 'cotes#0': true, 'pied#0': true }, activeCopy: { cotes: 2, pied: 2 } } })
      const w = mountReader()
      await settle()
      const sock2 = tk('reader.copies.title.chaussette', { n: 2, total: 2 })
      expect(w.findAll('.rsec__copy').map((x) => x.text())).toEqual([sock2, sock2, sock2])
    })

    it('une grille de chaussette entamée suffit à demander confirmation, et repart de zéro', async () => {
      const { projectId } = await seedProject(sockReader(), {
        readerState: { done: {}, chartRows: { p: 3, m: 2 }, chartReps: { p: 2 } },
      })
      const w = mountReader()
      await settle()
      await opts(w)[1].trigger('click')
      await settle()
      expect(w.findComponent({ name: 'ConfirmDialog' }).props('open')).toBe(true)
      w.findComponent({ name: 'ConfirmDialog' }).vm.$emit('confirm')
      await settleAll()
      const p = await db.projects.get(projectId)
      expect(p.readerState.copyMode).toBe('simultaneous')
      expect(p.readerState.chartRows).toEqual({ m: 2 })
      expect(p.readerState.chartReps).toEqual({})
    })

    it('« l\'une après l\'autre » : pas de bouton « Chaussette suivante » sur une partie de chaussette, gardé pour une manche', async () => {
      await seedProject(sockReader())
      let w = mountReader()
      await settle()
      expect(w.find('.rsec__copies-next').exists()).toBe(false)
      w.unmount()
      await seedProject({ ...FIX_READER, sections: [{ id: 'mc', kind: 'manche', copies: 2, title: 'Manche', steps: [{ t: 'Rang A' }] }] })
      w = mountReader()
      await settle()
      expect(w.find('.rsec__copies-next').exists()).toBe(true)
    })
  })

  describe('exemplaires en simultané', () => {
    const simulReader = (sec = {}) => ({
      ...FIX_READER,
      sections: [
        {
          id: 'p1',
          kind: 'pied',
          copies: 2,
          title: 'Pied',
          steps: [{ t: 'Rang A' }, { t: 'Rang B' }, { t: 'Rang C' }],
          ...sec,
        },
      ],
    })
    // Le projet choisit la technique (readerState.copyMode), pas la section du patron.
    const seedSim = (reader, extra = {}) =>
      seedProject(reader, { ...extra, readerState: { copyMode: 'simultaneous', ...extra.readerState } })
    const checks = (w, row) => w.findAll('.rstep')[row].findAll('.rcheck')
    const settleAll = async () => {
      await settle()
      await new Promise((r) => setTimeout(r, 0))
      await settle()
    }
    // Tap dans le premier tiers gauche de la carte (jsdom ne mesure rien : boîte simulée).
    const tapZone = async (w, row) => {
      const card = w.findAll('.rstep')[row]
      card.element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 40, right: 300, bottom: 40 })
      await card.trigger('click', { clientX: 20 })
      await settle()
    }

    it("le mode posé sur la section du patron n'a plus d'effet : une coche par rang", async () => {
      await seedProject(simulReader({ copyMode: 'simultaneous' }))
      const w = mountReader()
      await settle()
      expect(checks(w, 0).length).toBe(1)
    })

    it('rend deux coches par rang, repérées 1 et 2, nommées par checkCopy', async () => {
      await seedSim(simulReader())
      const w = mountReader()
      await settle()
      const c = checks(w, 0)
      expect(c.length).toBe(2)
      expect(c[0].attributes('role')).toBe('checkbox')
      expect(c[0].attributes('aria-label')).toBe(tk('reader.copies.checkCopy', { n: 1 }))
      expect(c[1].attributes('aria-label')).toBe(tk('reader.copies.checkCopy', { n: 2 }))
      expect(c[0].text()).toContain('1')
      expect(c[1].text()).toContain('2')
      expect(w.find('.rsec__copies-next').exists()).toBe(false)
    })

    it("le dernier geste porte l'exemplaire coché au-delà du 1 (last.copy), nu pour l'exemplaire 1", async () => {
      const { projectId } = await seedSim(simulReader())
      const w = mountReader()
      await settle()
      await checks(w, 0)[1].trigger('click')
      await settleAll()
      expect((await db.projects.get(projectId)).readerState.last).toEqual({ kind: 'step', id: 'p1#0', copy: 2 })
      await checks(w, 1)[0].trigger('click')
      await settleAll()
      expect((await db.projects.get(projectId)).readerState.last).toEqual({ kind: 'step', id: 'p1#1' })
    })

    it('chaque coche écrit dans son exemplaire ; le rang est fait quand les deux le sont', async () => {
      const { projectId } = await seedSim(simulReader())
      const w = mountReader()
      await settle()
      await checks(w, 0)[0].trigger('click')
      await settle()
      expect(w.findAll('.rstep')[0].classes()).not.toContain('rstep--done')
      expect(checks(w, 0)[0].attributes('aria-checked')).toBe('true')
      expect(checks(w, 0)[1].attributes('aria-checked')).toBe('false')
      await checks(w, 0)[1].trigger('click')
      await settleAll()
      expect(w.findAll('.rstep')[0].classes()).toContain('rstep--done')
      const p = await db.projects.get(projectId)
      expect(p.readerState.done).toEqual({ 'p1#0': true })
      expect(p.readerState.copyState[2].done).toEqual({ 'p1#0': true })
      expect(w.find('.rsec__prog').text()).toBe('2/6')
    })

    it('le tap sur la zone du rang coche l\'exemplaire en retard (1 à égalité)', async () => {
      const { projectId } = await seedSim(simulReader())
      const w = mountReader()
      await settle()
      await tapZone(w, 0) // égalité : exemplaire 1
      expect(checks(w, 0)[0].attributes('aria-checked')).toBe('true')
      expect(checks(w, 0)[1].attributes('aria-checked')).toBe('false')
      await tapZone(w, 0) // l'exemplaire 2 est en retard
      expect(checks(w, 0)[1].attributes('aria-checked')).toBe('true')
      await tapZone(w, 1) // égalité de nouveau : exemplaire 1
      await settleAll()
      const p = await db.projects.get(projectId)
      expect(p.readerState.done).toEqual({ 'p1#0': true, 'p1#1': true })
      expect(p.readerState.copyState[2].done).toEqual({ 'p1#0': true })
    })

    it('l\'indicateur d\'écart apparaît quand les rangs faits diffèrent, disparaît à égalité', async () => {
      await seedSim(simulReader())
      const w = mountReader()
      await settle()
      expect(w.find('.rsec__gap').exists()).toBe(false)
      await checks(w, 0)[0].trigger('click')
      await settle()
      expect(w.find('.rsec__gap').text()).toBe(tk('reader.copies.gap', { n: 2, rows: 1, count: 1 }))
      await checks(w, 1)[0].trigger('click')
      await settle()
      expect(w.find('.rsec__gap').text()).toBe(tk('reader.copies.gap', { n: 2, rows: 2, count: 2 }))
      await checks(w, 0)[1].trigger('click')
      await checks(w, 1)[1].trigger('click')
      await settle()
      expect(w.find('.rsec__gap').exists()).toBe(false)
    })

    it('une seule chaussette cochée ne recentre pas ; la seconde recentre sur le rang suivant', async () => {
      await seedSim(simulReader())
      const w = mountReader()
      await settle()
      const spy = Element.prototype.scrollIntoView
      const centered = () => spy.mock.calls.filter((c) => c[0]?.block === 'center').length
      const before = centered()
      await checks(w, 0)[0].trigger('click')
      await settle()
      expect(centered()).toBe(before)
      await checks(w, 0)[1].trigger('click')
      await settle()
      expect(centered()).toBe(before + 1)
    })

    it('séquentiel : cocher recentre comme avant', async () => {
      await seedProject(simulReader())
      const w = mountReader()
      await settle()
      const spy = Element.prototype.scrollIntoView
      const centered = () => spy.mock.calls.filter((c) => c[0]?.block === 'center').length
      const before = centered()
      await checks(w, 0)[0].trigger('click')
      await settle()
      expect(centered()).toBe(before + 1)
    })

    it('tap en zone : décoche la copie en retard seulement, la copie 1 reste intacte', async () => {
      const { projectId } = await seedSim(simulReader(), {
        readerState: {
          done: { 'p1#0': true, 'p1#1': true, 'p1#2': true },
          copyState: { 2: { done: { 'p1#2': true }, counters: {} } },
        },
      })
      const w = mountReader()
      await settle()
      await tapZone(w, 2)
      await settleAll()
      const p = await db.projects.get(projectId)
      expect(p.readerState.done).toEqual({ 'p1#0': true, 'p1#1': true, 'p1#2': true })
      expect(p.readerState.copyState[2].done).toEqual({})
    })

    it('tap en zone à égalité complète : seul l\'exemplaire 1 est décoché pour ce rang', async () => {
      const { projectId } = await seedSim(simulReader(), {
        readerState: {
          done: { 'p1#0': true },
          copyState: { 2: { done: { 'p1#0': true }, counters: {} } },
        },
      })
      const w = mountReader()
      await settle()
      await tapZone(w, 0)
      await settleAll()
      const p = await db.projects.get(projectId)
      expect(p.readerState.done).toEqual({})
      expect(p.readerState.copyState[2].done).toEqual({ 'p1#0': true })
    })

    // Revue finale I2 : le compteur nomme la chaussette visée, « + » suit le compteur en retard, « − » défait le dernier « + ».
    it('compteur : « + » vise la chaussette au compteur le plus bas, « − » le plus haut, le libellé la nomme', async () => {
      const { projectId } = await seedSim(simulReader({ steps: [{ t: 'Répéter {{0}} fois.', total: [3], c: [[3]], repeat: true }] }), {
        readerState: { size: 0 },
      })
      const w = mountReader()
      await settle()
      const lab = () => w.find('.rcount__lab').text()
      const val = () => w.find('.rcount__val').text()
      const [minus, plus] = w.find('.rcount').findAll('.rcount__btn')
      const sock = (n) => tk('reader.copies.title.chaussette', { n, total: 2 })
      expect(lab()).toContain(sock(1))
      expect(minus.attributes('disabled')).toBeDefined()
      await plus.trigger('click')
      await settle()
      expect(lab()).toContain(sock(2))
      expect(val()).toBe('0 / 3')
      await plus.trigger('click')
      await plus.trigger('click')
      await settle()
      let p = await db.projects.get(projectId)
      expect([p.readerState.counters['p1#0'], p.readerState.copyState[2].counters['p1#0']]).toEqual([2, 1])
      expect(p.readerState.last).toEqual({ kind: 'step', id: 'p1#0' })
      await minus.trigger('click')
      await minus.trigger('click')
      await settleAll()
      p = await db.projects.get(projectId)
      expect([p.readerState.counters['p1#0'], p.readerState.copyState[2].counters['p1#0']]).toEqual([1, 0])
      expect(lab()).toContain(sock(2))
      expect(minus.attributes('disabled')).toBeUndefined()
    })

    // Revue finale m2 : le dernier geste garde l'exemplaire touché, même quand le geste change celui en retard.
    it('« + » qui complète le compteur de la chaussette 1 : le dernier geste reste sur la chaussette 1', async () => {
      const { projectId } = await seedProject(
        simulReader({ steps: [{ t: 'Répéter {{0}} fois.', total: [1], c: [[1]], repeat: true }, { t: 'Rang A' }] }),
        { readerState: { size: 0 } },
      )
      const w = mountReader()
      await settle()
      await w.find('.rcount').findAll('.rcount__btn')[1].trigger('click')
      await settleAll()
      const p = await db.projects.get(projectId)
      expect(p.readerState.counters['p1#0']).toBe(1)
      expect(p.readerState.last).toEqual({ kind: 'step', id: 'p1#0' })
    })

    it('séquentiel et sans copies : une seule coche par rang, pas d\'écart', async () => {
      await seedProject(simulReader())
      const w = mountReader()
      await settle()
      expect(checks(w, 0).length).toBe(1)
      expect(w.find('.rsec__gap').exists()).toBe(false)
    })
  })

  it('redirige si le patron du projet n’a pas de format lecteur', async () => {
    const patternId = await db.patterns.add({ name: 'Sans reader', type: 'knitting' })
    const projectId = await db.projects.add({ name: 'P', technique: 'knitting', patternId })
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
    mountReader()
    await settle()
    expect(nav.router.replace).toHaveBeenCalledWith({ name: 'project', params: { id: String(projectId) } })
  })
})

// #9 : cliquer une section dans l'onglet Sections de la fiche projet doit atterrir au DÉBUT
// de CETTE section, plutôt qu'au rang courant du suivi (resume, comportement historique).
// La cible section PRIME sur la reprise auto ; sans elle, la reprise auto reste inchangée.
describe('ReaderView — cible de section à l’ouverture (?section=, #9)', () => {
  it('avec ?section=, défile au DÉBUT de la section ciblée (pas au rang courant, même suivi entamé)', async () => {
    const { projectId } = await seedProject(FIX_READER, { readerState: { done: { 's1#0': true } } })
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: { section: 's1' } }
    mountReader()
    await settle()
    // Une seule cible touchée : la section, pas le rang courant (précédence, pas cumul).
    expect(scrollCalls).toEqual([{ id: 'rsec-s1', opts: { behavior: 'auto', block: 'start' } }])
  })

  it('sans ?section, comportement inchangé : reprend au rang courant si le suivi est entamé (#6)', async () => {
    await seedProject(FIX_READER, { readerState: { done: { 's1#0': true } } }) // seedProject pose query:{}
    mountReader()
    await settle()
    expect(scrollCalls).toEqual([{ id: 'rstep-s1#1', opts: { behavior: 'auto', block: 'center' } }])
  })

  it('sans ?section, suivi vierge (doneCount=0) : aucun défilement auto (#6 inchangé — on reste en haut)', async () => {
    await seedProject()
    mountReader()
    await settle()
    expect(scrollCalls).toEqual([])
  })

  it('?section= sur un suivi vierge (doneCount=0) : défile quand même à la section (prime même sans reprise)', async () => {
    const { projectId } = await seedProject()
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: { section: 's1' } }
    mountReader()
    await settle()
    expect(scrollCalls).toEqual([{ id: 'rsec-s1', opts: { behavior: 'auto', block: 'start' } }])
  })

  it('aperçu bibliothèque (lecture seule) avec ?section= : défile aussi à la section', async () => {
    const patternId = await db.patterns.add({ name: 'Patron test', type: 'knitting', reader: FIX_READER })
    nav.route = { name: 'pattern-read', params: { id: String(patternId) }, query: { section: 's1' } }
    mountReader()
    await settle()
    expect(scrollCalls).toEqual([{ id: 'rsec-s1', opts: { behavior: 'auto', block: 'start' } }])
  })

  // Retour de l'écran de correction : une correction a pu renommer la section visée par
  // `?section=`, l'id DOM ne pointe plus vers rien. Repli sur le rang en cours plutôt que
  // de rester en haut du patron (le coût que ce lot de correction devait justement supprimer).
  it('?section= dont la cible n’existe plus (renommée par une correction) : repli sur le rang en cours', async () => {
    const { projectId } = await seedProject(FIX_READER, { readerState: { done: { 's1#0': true } } })
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: { section: 'section-disparue' } }
    mountReader()
    await settle()
    expect(scrollCalls).toEqual([{ id: 'rstep-s1#1', opts: { behavior: 'auto', block: 'center' } }])
  })

  it('?section= dont la cible n’existe plus, ET suivi vierge (doneCount=0) : aucun repli, on reste en haut', async () => {
    const { projectId } = await seedProject()
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: { section: 'section-disparue' } }
    mountReader()
    await settle()
    expect(scrollCalls).toEqual([])
  })
})

describe('ReaderView — mémo des techniques de points', () => {
  it('un patron sans reference montre quand même la tuile du mémo et le bouton d’aide', async () => {
    const { reference: _omit, ...noRef } = FIX_READER
    await seedProject(noRef)
    const w = mountReader()
    await settle()
    expect(w.find('.amtile').text()).toContain(i18n.global.t('reader.reference.stitches.label'))
    expect(w.find('.fab--ref').exists()).toBe(true)
  })
  it('affiche la fiche d’un point épinglé dans le panneau', async () => {
    const { patternId } = await seedLibrary()
    await db.patterns.update(patternId, { stitchPins: ['cr-sc'] })
    const w = mountReader()
    await settle()
    const tile = w.findAll('.amtile').find((x) => x.text().includes(i18n.global.t('reader.reference.stitches.label')))
    await tile.trigger('click')
    await settle()
    expect(w.get('.rs').text()).toContain(resolveStitch('cr-sc', 'fr').name)
  })
  it('en aperçu bibliothèque, choisir un point l’enregistre avec le patron et l’affiche dans le mémo', async () => {
    const { patternId } = await seedLibrary()
    const w = mountReader()
    await settle()
    const label = i18n.global.t('reader.reference.stitches.label')
    await w.findAll('.amtile').find((x) => x.text().includes(label)).trigger('click')
    await settle()
    const pick = w.findAll('.rs__action').find((b) => b.text() === i18n.global.t('stitchMemo.pick'))
    await pick.trigger('click')
    await settle()
    await w.findAll('.sp [role="tab"]').find((b) => b.text() === i18n.global.t('stitchMemo.craft.crochet')).trigger('click')
    await w.get('.sp [data-stitch="cr-sc"] input').setValue(true)
    await settle()
    expect((await db.patterns.get(patternId)).stitchPins).toEqual(['cr-sc'])
    await w.get('.sp__done').trigger('click')
    await settle()
    expect(w.get('.rs').text()).toContain(resolveStitch('cr-sc', 'fr').name)
  })
  it('une sélection faite se remodifie : « Modifier les points » en tête du mémo rouvre le sélecteur', async () => {
    const { patternId } = await seedLibrary()
    await db.patterns.update(patternId, { stitchPins: ['cr-sc', 'kn-knit'] })
    const w = mountReader()
    await settle()
    const label = i18n.global.t('reader.reference.stitches.label')
    await w.findAll('.amtile').find((x) => x.text().includes(label)).trigger('click')
    await settle()
    const first = w.get('.rs__scroll .rs__block')
    expect(first.find('.rs__action').text()).toBe(i18n.global.t('stitchMemo.edit'))
    await first.get('.rs__action').trigger('click')
    await settle()
    await w.findAll('.sp [role="tab"]').find((b) => b.text() === i18n.global.t('stitchMemo.craft.crochet')).trigger('click')
    await w.get('.sp [data-stitch="cr-sc"] input').setValue(false)
    await settle()
    expect((await db.patterns.get(patternId)).stitchPins).toEqual(['kn-knit'])
  })
  it('Échap sur le sélecteur rouvre l’aide-mémoire sur l’onglet du mémo, sans la refermer', async () => {
    await seedLibrary()
    const w = mountReader()
    await settle()
    const label = i18n.global.t('reader.reference.stitches.label')
    await w.findAll('.amtile').find((x) => x.text().includes(label)).trigger('click')
    await settle()
    await w.findAll('.rs__action').find((b) => b.text() === i18n.global.t('stitchMemo.pick')).trigger('click')
    await settle()
    await w.get('.sp input[type="search"]').trigger('keydown', { key: 'Escape' })
    await settle()
    expect(w.get('.sp').classes()).not.toContain('sp--on')
    expect(w.get('.rs').classes()).toContain('rs--on')
    expect(w.get('.rs__tab--on').text()).toBe(label)
  })
})

describe('ReaderView — mémo : focus sur le corps de page', () => {
  async function openPicker(w) {
    const label = i18n.global.t('reader.reference.stitches.label')
    await w.findAll('.amtile').find((x) => x.text().includes(label)).trigger('click')
    await settle()
    await w.findAll('.rs__action').find((b) => b.text() === i18n.global.t('stitchMemo.pick')).trigger('click')
    await settle()
    return label
  }
  it('Échap avec le focus hors du sélecteur le ferme et rouvre l’aide-mémoire sur le mémo', async () => {
    await seedLibrary()
    const w = mountReader()
    await settle()
    const label = await openPicker(w)
    expect(w.get('.sp').classes()).toContain('sp--on')
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(w.get('.sp').classes()).not.toContain('sp--on')
    expect(w.get('.rs').classes()).toContain('rs--on')
    expect(w.get('.rs__tab--on').text()).toBe(label)
  })
  it('l’aide-mémoire fait défiler la bande d’onglets jusqu’à l’onglet actif', async () => {
    await seedLibrary()
    const w = mountReader()
    await settle()
    const label = await openPicker(w)
    await w.get('.sp__done').trigger('click')
    await settle()
    const i = Element.prototype.scrollIntoView.mock.contexts.findIndex((el) => el.classList?.contains('rs__tab--on') && el.textContent.trim() === label)
    expect(i).toBeGreaterThan(-1)
    expect(Element.prototype.scrollIntoView.mock.calls[i][0]).toEqual({ inline: 'nearest', block: 'nearest' })
  })
})

describe('ReaderView — aperçu bibliothèque (lecture seule)', () => {
  it('n’affiche ni sélecteur de taille, ni coches, ni progression, ni compteur', async () => {
    await seedLibrary()
    const w = mountReader()
    await settle()
    expect(w.find('.szpill').exists()).toBe(false)
    expect(w.find('.rcheck').exists()).toBe(false)
    expect(w.find('.rhdr__prog').exists()).toBe(false)
    expect(w.find('.rcount').exists()).toBe(false)
    expect(w.find('.chrono-fab').exists()).toBe(false)
  })

  it('affiche les étapes en lecture (chiffres en notation brute) + la note lecture seule', async () => {
    await seedLibrary()
    const w = mountReader()
    await settle()
    expect(w.findAll('.rstep').length).toBe(3)
    expect(w.find('.rl-num--all').text()).toBe('10 (12) 14')
    expect(w.find('.ro-note').exists()).toBe(true)
  })

  it('le rappel de cadence reste visible même sans compteur', async () => {
    const readerCad = {
      ...FIX_READER,
      sections: [{ id: 's1', title: 'S', steps: [{ t: 'Répéter le motif.', total: [4, 5, 6], c: [[4, 5, 6]], repeat: true, every: 4 }] }],
    }
    await seedLibrary(readerCad)
    const w = mountReader()
    await settle()
    expect(w.find('.rcount').exists()).toBe(false) // pas de compteur en lecture seule
    expect(w.find('.rstep__cadence').text()).toBe(i18n.global.t('reader.cadenceEvery', { every: 4 }))
    expect(w.find('.rstep__cadence').text()).toContain('4') // période interpolée, visible sans compteur
  })

  it('garde l’aide-mémoire (tuiles) et le diagramme, sans bouton flottant', async () => {
    await seedLibrary()
    const w = mountReader()
    await settle()
    expect(w.find('.amtile').exists()).toBe(true) // aide-mémoire via les tuiles
    expect(w.find('.fab--ref').exists()).toBe(false) // pas de bouton flottant en lecture seule
    expect(w.find('.chart').exists()).toBe(true)
  })

  // Chaque rang cochable porte un marqueur .rmark--row, jamais .rcheck (scopé à .rstep : la légende porte aussi un swatch .rmark--row).
  it('un rang porte un marqueur .rmark--row, jamais de case .rcheck', async () => {
    await seedLibrary() // FIX_READER : s1#0 et s1#1 sont des rangs
    const w = mountReader()
    await settle()
    expect(w.findAll('.rstep > .rmark--row').length).toBe(2)
    expect(w.find('.rcheck').exists()).toBe(false)
  })

  // Une répétition porte le marqueur compteur .rmark--rep (FIX_READER : s1#2).
  it('une répétition porte le marqueur .rmark--rep', async () => {
    await seedLibrary()
    const w = mountReader()
    await settle()
    expect(w.findAll('.rstep > .rmark--rep').length).toBe(1)
  })

  // Une note porte le marqueur .rmark--note (FIX_READER : s1#3), jamais de coche ni de compteur.
  it('une note porte le marqueur .rmark--note', async () => {
    await seedLibrary()
    const w = mountReader()
    await settle()
    expect(w.findAll('.rnote > .rmark--note').length).toBe(1)
  })

  // Un diagramme (FIX_READER : s1#4) ne porte aucun marqueur : il n'est ni cochable, ni compteur, ni note.
  it('un diagramme ne porte aucun marqueur', async () => {
    await seedLibrary()
    const w = mountReader()
    await settle()
    const chart = w.find('.rstep__chart')
    expect(chart.exists()).toBe(true)
    expect(chart.find('.rmark').exists()).toBe(false)
  })

  // La légende explique les trois marqueurs par leur libellé (clé i18n, pas le texte traduit en dur).
  it('affiche la légende des marqueurs avec ses trois libellés', async () => {
    await seedLibrary()
    const w = mountReader()
    await settle()
    const legend = w.find('.rlegend')
    expect(legend.exists()).toBe(true)
    expect(legend.text()).toContain(i18n.global.t('reader.legend.title'))
    expect(legend.text()).toContain(i18n.global.t('reader.legend.check'))
    expect(legend.text()).toContain(i18n.global.t('reader.legend.count'))
    expect(legend.text()).toContain(i18n.global.t('reader.legend.read'))
  })
})

// M2.2 : les tuiles d'aide-mémoire (grille de ReaderView) rendent le libellé RÉSERVÉ via
// lbl(tile,'titleKey'/'subKey', …) → t(clé). buildReference émet ces clés à côté du libellé
// FR de repli ; ce test garde la branche t(clé) DE ReaderView (les autres tests du fichier
// utilisent une fixture SANS clé, chemin de repli — une régression du câblage EN des tuiles
// y passerait inaperçue). On monte le vrai ReaderView en locale EN avec un reference produit
// par buildReference (donc porteur des titleKey/subKey), pas la fixture figée.
describe('ReaderView — tuiles d’aide-mémoire localisées (locale EN)', () => {
  it('tuile Matériel : titre « Materials & gauge » et sous-titre « Yarn, needles, gauge » (pas le FR figé)', async () => {
    const readerEn = {
      ...FIX_READER,
      reference: buildReference({ gauge: '20 sts x 28 rows = 10cm', yarn: 'Silk Mohair, 2 strands' }),
    }
    await seedLibrary(readerEn)
    const enI18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'fr', messages: { fr, en } })
    const w = mount(ReaderView, { global: { plugins: [createPinia(), enI18n] } })
    wrappers.push(w)
    await settle()

    const titles = w.findAll('.amtile__t').map((n) => n.text())
    const subs = w.findAll('.amtile__s').map((n) => n.text())
    expect(titles).toContain('Materials & gauge')
    expect(titles).not.toContain('Matériel & échantillon') // pas le libellé FR de repli
    expect(subs).toContain('Yarn, needles, gauge')
  })
})

// Ajout du bloc « Conseils » (aide-mémoire sous-titres et faux titres) :
// sa PROPRE tuile (5e, à côté de Matériel & échantillon/Tailles/Techniques/Abréviations),
// affichée seulement si le champ tips est non vide, avec son PROPRE icône enregistrée
// (`tab-tips`, cf. src/utils/icons.js) — sans elle, AppIcon retombe silencieusement sur
// l'icône générique 'pelote' (cf. AppIcon.vue), un vrai défaut visuel qu'un test texte
// seul ne verrait pas.
describe('ReaderView — tuile Conseils (tips)', () => {
  it("le bloc `tips` non vide affiche sa propre tuile, avec une icône DÉDIÉE (pas le repli 'pelote')", async () => {
    const readerTips = {
      ...FIX_READER,
      reference: buildReference({ tips: ['Conseils', 'Voir la vidéo de montage.'] }),
    }
    await seedLibrary(readerTips)
    const w = mountReader()
    await settle()

    const titles = w.findAll('.amtile__t').map((n) => n.text())
    const subs = w.findAll('.amtile__s').map((n) => n.text())
    expect(titles).toContain(tk('reader.reference.tips.label'))
    expect(subs).toContain(tk('reader.reference.tips.sub'))

    const tipsTile = w.findAll('.amtile').find((n) => n.find('.amtile__t').text() === tk('reader.reference.tips.label'))
    const iconSvg = tipsTile.find('.amtile__ic svg').html()
    // Le SVG rendu doit correspondre au tracé enregistré sous `tab-tips` (ampoule),
    // jamais au repli `pelote` (cercle + fils, cf. AppIcon.vue : nom inconnu → ICONS.pelote).
    expect(iconSvg).toContain('4.8a5.2 5.2 0 0 0-3 9.4') // tracé de l'ampoule (tab-tips)
    expect(iconSvg).not.toContain('cx="12" cy="12" r="7.3"') // tracé du repli pelote
  })

  it('le champ tips absent → aucune tuile Conseils', async () => {
    await seedLibrary() // FIX_READER sans reference.tips (fixture existante du fichier)
    const w = mountReader()
    await settle()
    const titles = w.findAll('.amtile__t').map((n) => n.text())
    expect(titles).not.toContain(tk('reader.reference.tips.label'))
  })
})

// (P3) : le chip de navigation « .chip--resume » (reader.resume) et le FAB chrono
// en pause (reader.chronoResume) portaient le MÊME mot « Reprendre »/« Resume » pour deux
// actions différentes (l'un défile jusqu'à l'étape en cours, l'autre relance un minuteur).
// La collision existe dans les DEUX langues : vérifier seulement le FR laisserait passer
// la moitié du bug.
describe('i18n reader — collision « Reprendre » levée (chip navigation vs chrono)', () => {
  it('fr.json : reader.resume ne porte plus le même libellé que reader.chronoResume', () => {
    expect(fr.reader.resume).not.toBe(fr.reader.chronoResume)
  })

  it('en.json : reader.resume ne porte plus le même libellé que reader.chronoResume', () => {
    expect(en.reader.resume).not.toBe(en.reader.chronoResume)
  })

  it('le chrono garde bien « Reprendre »/« Resume » (c’est le mot juste pour un minuteur)', () => {
    expect(fr.reader.chronoResume).toBe('Reprendre')
    expect(en.reader.chronoResume).toBe('Resume')
  })
})

/* ── Reprise sur le dernier geste (intent 2026-09-30) ──
   Julie tricote hors ordre : à la réouverture, le lecteur atterrit sur la dernière place
   travaillée (readerState.last) avec une pill explicative temporaire, l'étape en cours (puce,
   surlignage) suit le dernier geste, et le recentrage après cochage ne replie jamais vers le
   premier non fait du patron. Héritage (pas de last) : comportement historique exact. */
describe('ReaderView — reprise sur le dernier geste', () => {
  const flushPersist = async () => {
    await settle()
    await new Promise((r) => setTimeout(r, 0))
    await settle()
  }

  it('cocher puis décocher posent la trace du dernier geste, persistée', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()
    await w.findAll('.rcheck')[1].trigger('click') // s1#1
    await flushPersist()
    let p = await db.projects.get(projectId)
    expect(p.readerState.last).toEqual({ kind: 'step', id: 's1#1' })
    await w.findAll('.rcheck')[1].trigger('click') // décoche : même trace, le geste compte
    await flushPersist()
    p = await db.projects.get(projectId)
    expect(p.readerState.last).toEqual({ kind: 'step', id: 's1#1' })
  })

  it('compteur plus ET moins posent la trace du dernier geste', async () => {
    const { projectId } = await seedProject()
    const w = mountReader()
    await settle()
    const counter = w.findAll('.rstep--rep')[0]
    await counter.findAll('.rcount__btn')[1].trigger('click') // plus
    await counter.findAll('.rcount__btn')[0].trigger('click') // moins
    await flushPersist()
    const p = await db.projects.get(projectId)
    expect(p.readerState.last).toEqual({ kind: 'step', id: 's1#2' })
  })

  it('rang de grille et répétition de grille posent la trace (kind chart)', async () => {
    const readerRep = {
      ...FIX_READER,
      chart: { ...FIX_READER.chart, reps: 2 },
    }
    const { projectId } = await seedProject(readerRep)
    const w = mountReader()
    await settle()
    await w.find('.chart__next').trigger('click') // rang de grille suivant
    await flushPersist()
    let p = await db.projects.get(projectId)
    expect(p.readerState.last).toEqual({ kind: 'chart', id: 's1' })
    const repNext = w.findAll('.chart__btn').find((b) => b.attributes('aria-label') === tk('reader.chart.repNext'))
    await repNext.trigger('click') // répétition suivante
    await flushPersist()
    p = await db.projects.get(projectId)
    expect(p.readerState.last).toEqual({ kind: 'chart', id: 's1' })
  })

  it('à la réouverture : atterrissage sur le dernier rang travaillé + badge', async () => {
    await seedProject(FIX_READER, { readerState: { done: { 's1#1': true }, last: { kind: 'step', id: 's1#1' } } })
    const w = mountReader()
    await settle()
    expect(scrollCalls.at(-1).id).toBe('rstep-s1#1')
    expect(scrollCalls.at(-1).opts).toEqual({ behavior: 'auto', block: 'center' })
    expect(w.find('.rbadge').text()).toBe(tk('reader.resumeBadgeStep'))
  })

  it('à la réouverture : dernière grille travaillée → carte du diagramme + badge chart', async () => {
    await seedProject(FIX_READER, { readerState: { chartRows: { s1: 3 }, last: { kind: 'chart', id: 's1' } } })
    const w = mountReader()
    await settle()
    expect(scrollCalls.at(-1).id).toBe('rchart-s1')
    expect(w.find('.rbadge').text()).toBe(tk('reader.resumeBadgeChart'))
  })

  it('progression sans trace du dernier geste (héritage) → chemin historique, pas de badge', async () => {
    await seedProject(FIX_READER, { readerState: { done: { 's1#0': true } } })
    const w = mountReader()
    await settle()
    expect(scrollCalls.at(-1).id).toBe('rstep-s1#1') // premier non coché, comme avant
    expect(w.find('.rbadge').exists()).toBe(false)
  })

  it('?section= garde la priorité ; cible de section disparue → repli sur le dernier geste', async () => {
    await seedProject(FIX_READER, { readerState: { done: { 's1#1': true }, last: { kind: 'step', id: 's1#1' } } })
    nav.route = { name: 'project-read', params: nav.route.params, query: { section: 's1' } }
    let w = mountReader()
    await settle()
    expect(scrollCalls.at(-1).id).toBe('rsec-s1')
    expect(w.find('.rbadge').exists()).toBe(false)
    wrappers.pop().unmount()
    // Titre renommé par une correction : l'id DOM de la cible change, la section visée n'est plus trouvée.
    nav.route = { name: 'project-read', params: nav.route.params, query: { section: 'section-absente' } }
    w = mountReader()
    await settle()
    expect(scrollCalls.at(-1).id).toBe('rstep-s1#1')
    expect(w.find('.rbadge').text()).toBe(tk('reader.resumeBadgeStep'))
  })

  it('patron entièrement fait : atterrit quand même sur le dernier geste + badge', async () => {
    await seedProject(FIX_READER, {
      readerState: { done: { 's1#0': true, 's1#1': true }, counters: { 's1#2': 2 }, last: { kind: 'step', id: 's1#1' } },
    })
    const w = mountReader()
    await settle()
    expect(scrollCalls.at(-1).id).toBe('rstep-s1#1')
    expect(w.find('.rbadge').exists()).toBe(true)
  })

  it('le badge s\'efface dès qu\'un geste de progression survient', async () => {
    await seedProject(FIX_READER, { readerState: { done: { 's1#1': true }, last: { kind: 'step', id: 's1#1' } } })
    const w = mountReader()
    await settle()
    expect(w.find('.rbadge').exists()).toBe(true)
    await w.findAll('.rcheck')[0].trigger('click')
    expect(w.find('.rbadge').exists()).toBe(false)
  })

  // fake-indexeddb commite ses transactions via setTimeout : on ne passe l'horloge en fake
  // QU'APRÈS que montage et Dexie soient stabilisés, et on n'y fait aucune écriture pendant —
  // sinon les transactions en vol meurent avec l'horloge fake et empoisonnent tous les tests
  // suivants (constaté : « Hook timed out » en cascade). Le badge du montage a été armé sous
  // vraies horloge : la puce le réarme DANS l'horloge fake (un clic, zéro écriture).
  it('le badge s\'efface après 5 s', async () => {
    await seedProject(FIX_READER, { readerState: { done: { 's1#1': true }, last: { kind: 'step', id: 's1#1' } } })
    const w = mountReader()
    await settle()
    vi.useFakeTimers()
    try {
      await w.find('.chip--resume').trigger('click')
      expect(w.find('.rbadge').exists()).toBe(true)
      vi.advanceTimersByTime(5000)
      await flushPromises()
      expect(w.find('.rbadge').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('visite guidée : jamais de badge, chemin d\'atterrissage historique', async () => {
    await seedProject(FIX_READER, { readerState: { done: { 's1#1': true }, last: { kind: 'step', id: 's1#1' } } })
    nav.route = { name: 'project-read', params: nav.route.params, query: { tour: '1' } }
    const w = mountReader()
    await settle()
    expect(w.find('.tour__bubble').exists()).toBe(true)
    expect(w.find('.rbadge').exists()).toBe(false)
    expect(scrollCalls.at(-1).id).toBe('rstep-s1#2') // étape en cours (historique), pas le dernier geste
  })

  it('recentrage après cochage vise la première non faite APRÈS le dernier geste, sans repli', async () => {
    // Tout est fait après s1#1 : cocher s1#0 ne doit provoquer AUCUN nouveau défilement
    // (le repli « premier non fait du patron » est réservé à l'étape en cours, pas au recentrage).
    await seedProject(FIX_READER, { readerState: { done: { 's1#1': true }, counters: { 's1#2': 2 } } })
    const w = mountReader()
    await settle()
    const afterMount = scrollCalls.length
    await w.findAll('.rcheck')[0].trigger('click') // coche s1#0 : plus rien après s1#0... s1#1/s1#2 déjà faits
    await settle()
    expect(scrollCalls.length).toBe(afterMount)
    // Cas ordinaire : cocher s1#0 sur un patron presque vierge → recentrage sur s1#1.
    await seedProject(FIX_READER, { readerState: { done: {} } })
    const w2 = mountReader()
    await settle()
    await w2.findAll('.rcheck')[0].trigger('click')
    await settle()
    expect(scrollCalls.at(-1).id).toBe('rstep-s1#1')
  })

  it('puce « Revenir à mon étape » : centrage sur l\'étape en cours + badge', async () => {
    await seedProject(FIX_READER, { readerState: { done: { 's1#1': true }, last: { kind: 'step', id: 's1#1' } } })
    const w = mountReader()
    await settle()
    await w.find('.chip--resume').trigger('click')
    expect(scrollCalls.at(-1).id).toBe('rstep-s1#2')
    expect(w.find('.rbadge').text()).toBe(tk('reader.resumeBadgeStep'))
  })
})

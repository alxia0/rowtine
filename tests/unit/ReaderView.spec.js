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

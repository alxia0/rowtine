// Tâche T3 (lot 3b) : traduction à l'AFFICHAGE de « Présentation » — la présentation à
// l'écran suit la langue courante (sectionTitleLabel, reader.js). Depuis le lot « clé
// stable » (2026-09-12), le titre FRAIS que `parseIntro` (parse.js) pose en donnée pour
// l'intro n'est plus la chaîne FR gelée mais `'presentation'` (clé neutre, alignée sur
// l'id) ; `'Présentation'` (majuscule accentuée) ne survit que comme repli — pour les
// patrons déjà enregistrés AVANT ce lot (sectionTitleLabel, isIntro : repli sur le titre
// quand l'id n'est pas encore 'presentation') et pour l'import PDF (assemble.js, hors
// périmètre de ce lot, qui pose encore ce titre littéral).
//
// CORRECTIF (revue finale du 01/08) : ce fichier affirmait à tort qu'un des trois blocs
// ci-dessous « démontrait que traduire l'affichage n'a pas changé l'identifiant ». Faux —
// vérifié par mutation (neutraliser sectionTitleLabel fait rougir l'assertion d'AFFICHAGE,
// jamais celle sur `#rsec-presentation`) : `id: 'presentation'` est un littéral semé à la
// main dans la fixture, qu'aucun chemin de code du test ne réécrit ; l'assertion DOM
// `w.find('#rsec-presentation').exists()` est vraie quoi qu'il arrive, avec ou sans bug.
// Trois preuves de nature différente, à ne pas confondre :
//  - le test « aller-retour MD identique au caractère près » est une preuve DE SANITY (le
//    titre traduit ne doit jamais fuiter dans le fichier), VIDE DE SENS comme garantie de
//    non-régression : T3 ne touche ni parse.js ni serialize.js, donc ce test passerait de
//    toute façon, avec ou sans bug d'affichage.
//  - le bloc « signal d'arrêt évité » (fixture en mémoire, id figé à la main) est un simple
//    test de RENDU DOM — utile pour voir que `:id="'rsec-' + sec.id"` est bien posé et que
//    l'affichage suit la langue, mais il ne garde RIEN : rien, dans ce test, ne pourrait
//    faire diverger l'id du titre.
//  - le test qui garde réellement la garantie (« traduire l'affichage ne fait jamais fuiter
//    la traduction dans un CHEMIN D'ÉCRITURE ») est le dernier bloc du fichier : il persiste
//    le reader en base (ReaderView.requestRows → patternsStore.update, ReaderView.vue:503)
//    avec l'application en espagnol, puis relit la base BRUTE — c'est la seule preuve qui
//    rougirait si une traduction fuyait un jour dans ce chemin d'écriture (vérifié par
//    mutation, voir son commentaire).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import { mdToPattern } from '@/utils/pattern-md/parse'
import { patternToMd } from '@/utils/pattern-md/serialize'
import i18n from '@/i18n'

const nav = vi.hoisted(() => ({
  route: { name: 'project-read', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import ReaderView from '@/views/ReaderView.vue'

const PATTERN_WITH_INTRO = {
  name: 'Mini',
  author: 'A',
  reader: {
    sizeLabels: [],
    sections: [
      { id: 'presentation', kind: 'autre', title: 'Présentation', steps: [
        { t: 'Un joli top d’été.', note: true },
        { t: 'Se tricote de haut en bas.', note: true },
      ] },
      { id: 'corps', kind: 'corps', title: 'Corps', steps: [
        { t: 'Monter 80 mailles.' },
      ] },
    ],
  },
}

describe('T3 — aller-retour MD (preuve de SANITY, pas la garantie de non-régression — voir en-tête)', () => {
  it('le titre affiché ne fuite JAMAIS dans le .md, quelle que soit la locale de génération', () => {
    // « Locale de génération » n'existe même pas ici : patternToMd/mdToPattern sont purs et
    // n'importent aucune dépendance i18n (cf. dialect.js) — c'est justement ce qui garantit
    // qu'aucune traduction ne peut fuiter dans le fichier, quel que soit l'affichage courant.
    const { md } = patternToMd(PATTERN_WITH_INTRO)
    expect(md).not.toContain('Presentación')
    expect(md).not.toContain('Präsentation')
    expect(md).not.toContain('Presentation')
    // L'intro est écrite SANS titre (mesuré par lot-3a-decision.md, §2#6) : aucune forme du
    // titre, traduite ou non, n'apparaît avant le premier bloc référence/section.
    expect(md).not.toContain('## Présentation')

    const { pattern } = mdToPattern(md)
    const intro = pattern.reader.sections[0]
    expect(intro.id).toBe('presentation')
    expect(intro.title).toBe('presentation')

    // Second aller-retour : identique au caractère près (byte-identique).
    const { md: md2 } = patternToMd(pattern)
    expect(md2).toBe(md)
  })

  it('cas où « ## Présentation {other} » atteint littéralement le fichier (intro en 2e position, cf. §2#5 de la note) : titre en donnée inchangé, id stable', () => {
    // isIntro (serialize.js:47) ne s'applique QU'À sections[0] : une section "Présentation"
    // en 2e position n'est jamais absorbée dans le préambule sans titre, elle reçoit son
    // propre en-tête comme n'importe quelle section de travail.
    const patternIntroSecond = {
      name: 'Mini',
      reader: {
        sizeLabels: [],
        sections: [
          { id: 'corps', kind: 'corps', title: 'Corps', steps: [{ t: 'Monter 80 mailles.' }] },
          { id: 'presentation', kind: 'autre', title: 'Présentation', steps: [
            { t: 'Note ajoutée après coup.', note: true },
          ] },
        ],
      },
    }
    const { md } = patternToMd(patternIntroSecond)
    expect(md).toContain('## Présentation {other}')
    expect(md).not.toContain('Presentación')
    expect(md).not.toContain('Präsentation')

    const { pattern } = mdToPattern(md)
    const intro = pattern.reader.sections.find((s) => s.title === 'Présentation')
    expect(intro.id).toBe('presentation')
    expect(intro.title).toBe('Présentation')
  })
})

// Reader en mémoire (pas de round-trip MD ici) pour le test qui porte réellement la preuve :
// mesurer l'AFFICHAGE et l'IDENTIFIANT simultanément, dans une locale non française.
async function seedProjectWithIntro() {
  const patternId = await db.patterns.add({ name: 'Mini', type: 'knitting', reader: PATTERN_WITH_INTRO.reader })
  const projectId = await db.projects.add({ name: 'P', technique: 'knitting', patternId })
  nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
  return { patternId, projectId }
}

const wrappers = []
function mountReader() {
  const w = mount(ReaderView, { global: { plugins: [createPinia(), i18n] } })
  wrappers.push(w)
  return w
}

async function settle() {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r))
  }
  await flushPromises()
}

describe('T3 — rendu DOM : id posé et affichage traduit en espagnol (ne garde rien, cf. en-tête du fichier — la vraie garantie est le bloc suivant)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    nav.router.push.mockClear()
    nav.router.replace.mockClear()
    localStorage.clear()
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
    i18n.global.locale.value = 'fr'
  })
  afterEach(() => {
    while (wrappers.length) wrappers.pop().unmount()
    i18n.global.locale.value = 'fr'
  })

  it('en espagnol : le titre affiché est "Presentación", MAIS section.id reste "presentation" (aucune réinitialisation de progression)', async () => {
    await seedProjectWithIntro()
    const w = mountReader()
    await settle()
    i18n.global.locale.value = 'es'
    await flushPromises()

    // Affichage traduit.
    expect(w.find('.rsec__title').text()).toBe('Presentación')
    // L'id de la section DOM (posé par :id="'rsec-' + sec.id") vient du littéral semé à la
    // main dans la fixture (seedProjectWithIntro) — CETTE assertion ne peut pas rougir : rien
    // ici ne dérive l'id du titre. Elle documente le rendu, elle ne garde rien (cf. en-tête).
    expect(w.find('#rsec-presentation').exists()).toBe(true)
    expect(w.find('#rsec-presentation .rsec__title').text()).toBe('Presentación')
  })

  it('en français : le titre affiché reste littéralement "Présentation" (chaîne gelée = traduction française)', async () => {
    await seedProjectWithIntro()
    const w = mountReader()
    await settle()
    expect(w.find('.rsec__title').text()).toBe('Présentation')
    expect(w.find('#rsec-presentation').exists()).toBe(true)
  })
})

// ── La garantie qui compte réellement (cf. en-tête du fichier) ────────────────────────────
//
// ReaderView.requestRows (ReaderView.vue:503) est le seul chemin d'écriture qui persiste le
// reader ENTIER (donc `sec.title`) en base : la tricoteuse renseigne le nombre de rangs d'une
// grille importée (rows:0 → sentinel « à renseigner »), et `patternsStore.update(id, {
// reader: reader.value })` réécrit tout l'objet dans IndexedDB. Si une traduction fuyait un
// jour dans ce chemin (ex. un dev « corrige » l'affichage en réassignant `sec.title` avant
// persistance), c'est le SEUL test de ce fichier qui la détecterait : il monte le Lecteur en
// espagnol, déclenche réellement ce chemin d'écriture via l'UI (clic sur le bouton du
// diagramme, comme le ferait la tricoteuse), puis relit la base BRUTE (pas le state Vue en
// mémoire, potentiellement traduit côté affichage) pour vérifier ce qui a été écrit.
const PATTERN_WITH_INTRO_CHART = {
  name: 'Mini',
  author: 'A',
  reader: {
    sizeLabels: [],
    sections: [
      {
        id: 'presentation',
        kind: 'autre',
        title: 'Présentation',
        steps: [
          { t: 'Un joli top d’été.', note: true },
          { chart: true }, // grille importée, rangs pas encore renseignés (chart.rows: 0)
        ],
        chart: { rows: 0, img: '/intro.png' },
      },
      { id: 'corps', kind: 'corps', title: 'Corps', steps: [{ t: 'Monter 80 mailles.' }] },
    ],
  },
}

describe('T3 — la garantie réelle : le titre traduit ne fuite JAMAIS dans le chemin d’écriture (requestRows → patternsStore.update)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    nav.router.push.mockClear()
    nav.router.replace.mockClear()
    localStorage.clear()
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
    i18n.global.locale.value = 'fr'
  })
  afterEach(() => {
    while (wrappers.length) wrappers.pop().unmount()
    i18n.global.locale.value = 'fr'
    vi.restoreAllMocks()
  })

  it('en espagnol : saisir le nombre de rangs persiste le reader en base SANS traduire section.title (ni son id, ceinture-bretelles), seul chart.rows change', async () => {
    const patternId = await db.patterns.add({ name: 'Mini', type: 'knitting', reader: PATTERN_WITH_INTRO_CHART.reader })
    const projectId = await db.projects.add({ name: 'P', technique: 'knitting', patternId })
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
    i18n.global.locale.value = 'es'

    const w = mountReader()
    await settle()

    // L'affichage suit bien l'espagnol (sinon la locale serait décorative et un futur
    // retrait de la traduction laisserait ce test vert malgré la régression).
    expect(w.find('.rsec__title').text()).toBe('Presentación')

    // Geste réel de la tricoteuse : la grille importée n'a pas encore de nombre de rangs
    // connu (ReaderChart.vue affiche le bouton `.chart__setrows` tant que chart.rows n'est
    // pas > 0) → elle clique dessus, saisit 20 dans le prompt natif.
    const setRows = w.find('.chart__setrows')
    expect(setRows.exists()).toBe(true)
    vi.spyOn(window, 'prompt').mockReturnValue('20')
    await setRows.trigger('click')
    await flushPromises()

    // On relit la base BRUTE (pas reader.value, potentiellement porteur d'un affichage
    // traduit côté Vue) : c'est elle que reconcile-reader-state.js relira à la prochaine
    // ouverture, et elle seule fait foi pour « qu'est-ce qui a vraiment été écrit ».
    const stored = await db.patterns.get(patternId)
    const intro = stored.reader.sections[0]
    expect(intro.title).toBe('Présentation') // ← l'assertion qui porte la preuve
    expect(intro.id).toBe('presentation') // ceinture-bretelles (rien ne dérive l'id du titre ici)
    expect(intro.chart.rows).toBe(20) // preuve que ce chemin d'écriture a bien été exercé
  })
})

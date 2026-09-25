// @vitest-environment jsdom
// Traduction à l'AFFICHAGE dans le lecteur : la donnée garde la chaîne FR gelée, seule sa
// présentation suit la langue courante. Trois sujets :
// - « Taille unique » (tâche T2, lot 3b) : la chaîne gelée `'Taille unique'` reste le code
//   interne en donnée (isSingleSize, reader.js), rendue par sizeLabelText. Deux garanties :
//   le rendu dans les quatre langues (sur ReaderSheet) et qu'un changement de langue ne
//   modifie JAMAIS la donnée en base (reader.sizeLabels reste strictement ['Taille unique']).
// - les libellés RÉSERVÉS de l'aide-mémoire (ReaderSheet), voir le bloc dédié.
// - « Présentation » (tâche T3, lot 3b), voir l'en-tête des blocs T3.
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/db/db'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'
import i18n from '@/i18n'
import ReaderSheet from '@/components/ReaderSheet.vue'
import { buildReference } from '@/utils/reader-reference'
import { mdToPattern } from '@/utils/pattern-md/parse'
import { patternToMd } from '@/utils/pattern-md/serialize'

// Même approche que reader-view.spec.js : mock vue-router pour éviter la complexité du vrai
// routeur et les leaks async.
const nav = vi.hoisted(() => ({
  route: { name: 'project-read', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import ReaderView from '@/views/ReaderView.vue'

function mountSheetWithSizeTable(locale, messages) {
  const localeI18n = createI18n({ legacy: false, locale, messages })
  const reference = {
    abbrFull: [],
    tabs: [
      {
        id: 'tailles',
        label: 'Tableau des tailles',
        blocks: [{ h3: 'Tailles', sizeTable: { rows: [{ label: 'Tour de poitrine (cm)', values: ['90'] }] } }],
      },
    ],
  }
  return mount(ReaderSheet, {
    props: { reference, sizeLabels: ['Taille unique'], sizeIndex: null, open: true, activeTab: 'tailles' },
    global: { plugins: [localeI18n] },
  })
}

describe('ReaderSheet — « Taille unique » traduite à l’affichage dans les quatre langues', () => {
  it('FR : en-tête de colonne rend « Taille unique » (chaîne gelée, identité)', () => {
    const w = mountSheetWithSizeTable('fr', { fr })
    expect(w.find('.rs__sizes thead th:last-child').text()).toBe('Taille unique')
  })
  it('EN : en-tête de colonne rend « One size », pas le français en dur', () => {
    const w = mountSheetWithSizeTable('en', { en })
    expect(w.find('.rs__sizes thead th:last-child').text()).toBe('One size')
  })
  it('DE : en-tête de colonne rend « Einheitsgröße »', () => {
    const w = mountSheetWithSizeTable('de', { de })
    expect(w.find('.rs__sizes thead th:last-child').text()).toBe('Einheitsgröße')
  })
  it('ES : en-tête de colonne rend « Talla única »', () => {
    const w = mountSheetWithSizeTable('es', { es })
    expect(w.find('.rs__sizes thead th:last-child').text()).toBe('Talla única')
  })
  it('une vraie taille nommée (contenu du patron) n’est JAMAIS traduite, dans aucune langue', () => {
    const reference = {
      abbrFull: [],
      tabs: [{ id: 'tailles', label: 'Tableau des tailles', blocks: [{ h3: 'Tailles', sizeTable: { rows: [] } }] }],
    }
    const localeI18n = createI18n({ legacy: false, locale: 'es', messages: { es } })
    const w = mount(ReaderSheet, {
      props: { reference, sizeLabels: ['M'], sizeIndex: null, open: true, activeTab: 'tailles' },
      global: { plugins: [localeI18n] },
    })
    expect(w.find('.rs__sizes thead th:last-child').text()).toBe('M')
  })
})

// Reader en taille unique, pour le test de non-régression de donnée ci-dessous.
const SINGLE_SIZE_READER = {
  sizeLabels: ['Taille unique'],
  sections: [{ id: 'corps', icon: '🧶', title: 'Corps', steps: [{ t: 'Monter 80 mailles' }] }],
}

async function seedSingleSizeProject() {
  const patternId = await db.patterns.add({ name: 'Écharpe', type: 'knitting', reader: SINGLE_SIZE_READER })
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

// Même stratégie que reader-view.spec.js : laisse l'onMounted async se vider.
async function settle() {
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await new Promise((r) => setTimeout(r))
  }
  await flushPromises()
}

describe('ReaderView — changement de langue : la donnée « Taille unique » ne bouge jamais', () => {
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

  it('après passage en espagnol, l’affichage change mais reader.sizeLabels reste ["Taille unique"] en base', async () => {
    const { patternId } = await seedSingleSizeProject()
    const w = mountReader()
    await settle()
    // Repli initial (langue de l'appareil détectée avant la restauration) : on force ES
    // explicitement pour ce test, sur le modèle documenté dans src/i18n/index.js.
    i18n.global.locale.value = 'es'
    await flushPromises()

    // Affichage : la pastille de taille est traduite.
    expect(w.find('.szpill').text()).toContain('Talla única')

    // Donnée : rien n'a été réécrit. Vérifié à la source (IndexedDB), pas seulement en mémoire.
    const stored = await db.patterns.get(patternId)
    expect(stored.reader.sizeLabels).toEqual(['Taille unique'])
  })

  it('en français (langue d’origine), la pastille de taille reste littéralement « Taille unique »', async () => {
    await seedSingleSizeProject()
    const w = mountReader()
    await settle()
    expect(w.find('.szpill').text()).toContain('Taille unique')
  })
})

// ReaderSheet (aide-mémoire) : libellés RÉSERVÉS (onglet/tuile/h3) localisés
// dans la langue de l'utilisateur (directive produit : « vocabulaire hors patron = langue
// locale »). Le tag balise reste EN (identité stable, cf. reader-reference.js) ; SEULS les
// libellés fixes émis par buildReference (labelKey/h3Key) doivent suivre la locale — les h3
// du tab tech (contenu du patron, ref.techniques[].title) ne portent PAS de clé et restent
// dans la langue source, non testés ici.
function mountLocale(locale, messages, reference, activeTab) {
  const localeI18n = createI18n({ legacy: false, locale, messages })
  return mount(ReaderSheet, {
    props: { reference, sizeLabels: [], sizeIndex: null, open: true, activeTab },
    global: { plugins: [localeI18n] },
  })
}

describe('ReaderSheet — libellés réservés localisés', () => {
  it('locale EN : label de tuile/onglet ET h3 traduits en anglais, pas le FR figé', () => {
    const reference = buildReference({
      gauge: '20 sts x 28 rows = 10cm',
      yarn: 'Silk Mohair, 2 strands',
    })
    const w = mountLocale('en', { en }, reference, 'materiel')

    expect(w.find('.rs__tab').text()).toBe('Materials & gauge')
    expect(w.findAll('h3').map((h) => h.text())).toEqual(['Gauge', 'Yarn'])
  })

  it('locale FR : le chemin par clé rend les libellés FR d’origine (byte-identique)', () => {
    // Chaque libellé réservé porte désormais une clé (labelKey/h3Key) — même en FR, le
    // rendu passe par t(clé) → fr.json, PLUS par le repli brut (qui ne joue que si la
    // clé est absente, cf. h3 du tab tech). Sans ce test, une valeur fr.json mal
    // recopiée romprait le comportement FR par défaut sans qu'aucun test ne le voie.
    const reference = buildReference({
      gauge: '20 m x 28 rgs',
      yarn: 'Silk Mohair',
    })
    const w = mountLocale('fr', { fr }, reference, 'materiel')

    expect(w.find('.rs__tab').text()).toBe('Matériel & échantillon')
    expect(w.findAll('h3').map((h) => h.text())).toEqual(['Échantillon', 'Fil'])
  })

  // Bloc Conseils : sa propre tuile/onglet, sur le modèle exact de tech/abbr,
  // localisée de la même façon (labelKey/h3Key résolus par `t()`, jamais le repli FR figé).
  it('locale EN : la tuile/onglet Conseils (tips) est traduite en anglais', () => {
    const reference = buildReference({ tips: ['Conseils', 'Voir la vidéo de montage.'] })
    const w = mountLocale('en', { en }, reference, 'tips')
    expect(w.find('.rs__tab').text()).toBe('Tips')
    expect(w.find('h3').text()).toBe('Tips')
  })

  it('locale FR : la tuile/onglet Conseils (tips) rend le FR d’origine', () => {
    const reference = buildReference({ tips: ['Conseils', 'Voir la vidéo de montage.'] })
    const w = mountLocale('fr', { fr }, reference, 'tips')
    expect(w.find('.rs__tab').text()).toBe('Conseils')
    expect(w.find('h3').text()).toBe('Conseils')
  })
})

// En-tête des blocs T3 (les renvois « en-tête du fichier » ci-dessous visent ce commentaire,
// écrit quand ces blocs formaient reader-section-intro-i18n.spec.js).
// Tâche T3 (lot 3b) : traduction à l'AFFICHAGE de « Présentation » — la présentation à
// l'écran suit la langue courante (sectionTitleLabel, reader.js). Depuis le lot « clé
// stable » (2026-09-12), le titre FRAIS que `parseIntro` (parse.js) pose en donnée pour
// l'intro n'est plus la chaîne FR gelée mais `'presentation'` (clé neutre, alignée sur
// l'id) ; `'Présentation'` (majuscule accentuée) ne survit que comme repli — pour les
// patrons déjà enregistrés AVANT ce lot (sectionTitleLabel, isIntro : repli sur le titre
// quand l'id n'est pas encore 'presentation') et pour l'import PDF (assemble.js, hors
// périmètre de ce lot, qui pose encore ce titre littéral).
//
// CORRECTIF (revue finale du 01/08) : cet en-tête affirmait à tort qu'un des trois blocs
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

// ── La garantie qui compte réellement (cf. en-tête des blocs T3) ──────────────────────────
//
// ReaderView.requestRows (ReaderView.vue:503) est le seul chemin d'écriture qui persiste le
// reader ENTIER (donc `sec.title`) en base : la tricoteuse renseigne le nombre de rangs d'une
// grille importée (rows:0 → sentinel « à renseigner »), et `patternsStore.update(id, {
// reader: reader.value })` réécrit tout l'objet dans IndexedDB. Si une traduction fuyait un
// jour dans ce chemin (ex. un dev « corrige » l'affichage en réassignant `sec.title` avant
// persistance), c'est le SEUL test des blocs T3 qui la détecterait : il monte le Lecteur en
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

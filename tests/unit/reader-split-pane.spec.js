// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useSplitReader, SPLIT_QUERY } from '@/composables/useSplitReader'
import { db } from '@/db/db'
import i18n from '@/i18n'

// Harnais de montage ReaderView (copié de tests/unit/reader-chart-state.spec.js:92-131) : le
// mock vue-router est hoisté et propre à ce fichier — une copie locale, commentée, est
// préférable à un import croisé qui casserait l'isolation entre specs.
const nav = vi.hoisted(() => ({
  route: { name: 'project-read', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))
// vi.mock est hoisté par Vitest au-dessus des imports : l'import normal ci-dessous reçoit
// donc bien le vue-router mocké (même convention que reader-chart-state.spec.js).
import ReaderView from '@/views/ReaderView.vue'

// Faux matchMedia pilotable : renvoie `matches` selon la requête demandée et garde le
// callback pour simuler une rotation d'écran.
function fakeMatchMedia(matches) {
  const listeners = []
  window.matchMedia = vi.fn((q) => ({
    media: q,
    matches: q === SPLIT_QUERY ? matches : false,
    addEventListener: (_, cb) => listeners.push(cb),
    removeEventListener: () => {},
  }))
  return { fire: (m) => listeners.forEach((cb) => cb({ matches: m })) }
}

const Host = defineComponent({
  setup: () => useSplitReader(),
  template: '<div>{{ wide }}</div>',
})

describe('useSplitReader', () => {
  it('est faux sous le seuil', () => {
    fakeMatchMedia(false)
    expect(mount(Host).text()).toBe('false')
  })

  it('est vrai au-dessus du seuil', () => {
    fakeMatchMedia(true)
    expect(mount(Host).text()).toBe('true')
  })

  it('suit une rotation d’écran sans remontage', async () => {
    const mm = fakeMatchMedia(false)
    const w = mount(Host)
    mm.fire(true)
    await w.vm.$nextTick()
    expect(w.text()).toBe('true')
  })

  // Le seuil est une valeur de spec : le figer ici empêche qu'un « arrondi » à 768px
  // passe inaperçu (un téléphone en paysage basculerait alors en deux volets). Hauteur à
  // 500 depuis le 28/07 (2e mesure du jour : 560 ne laissait que 24px de marge sur la
  // tablette cible, cf. useSplitReader.js).
  it('interroge exactement le seuil de la spec', () => {
    fakeMatchMedia(false)
    mount(Host)
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 900px) and (min-height: 500px)')
  })
})

const IMG_DOS = '/dos.png'
const IMG_MANCHE = '/manche.png'

// Patron à deux grilles + une section de rangs, pour distinguer « diagramme épinglé » de
// « étape courante ». `sizes` sur la 1re grille sert au test de repli par taille.
const READER_2 = {
  sizeLabels: ['S', 'M'],
  sections: [
    { id: 'corps', title: 'Corps', steps: [{ id: 'corps#0', t: 'Monter 10 m.' }] },
    { id: 'grille-dos', title: 'Grille dos', steps: [{ chart: true }], chart: { rows: 20, cols: 10, img: IMG_DOS, repeat: '10 m × 20 rangs', sizes: ['S'] } },
    { id: 'grille-manche', title: 'Grille manche', steps: [{ chart: true }], chart: { rows: 30, cols: 12, img: IMG_MANCHE, repeat: '12 m × 30 rangs' } },
  ],
}

// Tablette en paysage simulée : matchMedia n'existe pas en jsdom.
function stubWide(matches = true) {
  window.matchMedia = (q) => ({ media: q, matches, addEventListener() {}, removeEventListener() {} })
}

describe('diagramme épinglé (deux volets)', () => {
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

  beforeEach(async () => {
    setActivePinia(createPinia())
    nav.router.push.mockClear()
    nav.router.replace.mockClear()
    localStorage.clear()
    await db.open()
    await Promise.all(db.tables.map((t) => t.clear()))
  })
  afterEach(() => {
    while (wrappers.length) wrappers.pop().unmount()
  })

  async function seedTwoCharts(reader = READER_2) {
    const patternId = await db.patterns.add({ name: 'Deux grilles', type: 'knitting', reader })
    const projectId = await db.projects.add({ name: 'Projet test', technique: 'knitting', patternId })
    nav.route = { name: 'project-read', params: { id: String(projectId) }, query: {} }
    return { projectId }
  }

  it('épingle le premier diagramme visible à l’ouverture', async () => {
    stubWide()
    await seedTwoCharts()
    const w = mountReader()
    await settle()
    expect(w.find('.rpane').exists()).toBe(true)
    expect(w.find('.rpane img').attributes('src')).toBe(IMG_DOS)
  })

  it('ne change pas de diagramme quand on avance sur une étape qui n’en a pas', async () => {
    stubWide()
    await seedTwoCharts()
    const w = mountReader()
    await settle()
    w.vm.toggleDone('corps#0')
    await settle()
    expect(w.find('.rpane img').attributes('src')).toBe(IMG_DOS)
  })

  it('épingle un autre diagramme quand on le demande depuis le fil', async () => {
    stubWide()
    await seedTwoCharts()
    const w = mountReader()
    await settle()
    // Le seul bouton « Afficher à droite » présent est celui de la grille NON épinglée.
    await w.find('.rchart-pin').trigger('click')
    await flushPromises()
    expect(w.find('.rpane img').attributes('src')).toBe(IMG_MANCHE)
  })

  // Arbitrage produit (revue finale 28/07) : la carte du diagramme épinglé reste dans le fil
  // (légende, mailles, sens de lecture, repères de rang, boutons request-rows/request-reps —
  // aucun autre point d'entrée dans l'appli) ; seule son IMAGE est masquée, puisque c'est le
  // seul élément déjà montré au même instant dans le volet de droite.
  it('garde la carte des deux grilles dans le fil, masque seulement l’image de celle épinglée', async () => {
    stubWide()
    await seedTwoCharts()
    const w = mountReader()
    await settle()
    // Les DEUX grilles visibles rendent leur carte complète (légende, mailles, etc.)…
    expect(w.findAll('.rstep__chart .chart').length).toBe(2)
    // …mais seule la carte de la grille épinglée à l'ouverture (grille-dos, 1re grille
    // visible) porte la classe qui masque son image (.chart__viewport, en CSS :deep()).
    const pinnedCard = w.find('#rchart-grille-dos')
    const otherCard = w.find('#rchart-grille-manche')
    expect(pinnedCard.classes()).toContain('rstep__chart--pinned')
    expect(otherCard.classes()).not.toContain('rstep__chart--pinned')
    // …et le renvoi cliquable vers le volet reste présent en tête de la carte épinglée — seul
    // point d'entrée qui ramène l'attention là où l'image est réellement affichée.
    expect(w.findAll('.rchart-ref').length).toBe(1)
    // Les deux boutons request-rows/request-reps n'ont AUCUN autre point d'entrée dans
    // l'appli : ils doivent rester atteignables même sur la carte épinglée. Cette grille a
    // déjà ses rangs connus (rows:20/30) → c'est le bouton « Ajouter un compteur de
    // répétition » qui est exposé (chart.reps non défini sur les deux grilles du fixture).
    expect(pinnedCard.find('.chart__addrep').exists()).toBe(true)
  })

  it('mode une colonne : les deux grilles restent dans le fil, aucun renvoi', async () => {
    stubWide(false)
    await seedTwoCharts()
    const w = mountReader()
    await settle()
    expect(w.find('.rpane').exists()).toBe(false)
    expect(w.findAll('.rstep__chart .chart').length).toBe(2)
    expect(w.findAll('.rchart-ref').length).toBe(0)
  })

  it('pas de volet quand le patron n’a aucun diagramme', async () => {
    stubWide()
    await seedTwoCharts({ sizeLabels: ['S'], sections: [{ id: 'corps', title: 'Corps', steps: [{ id: 'corps#0', t: 'Monter 10 m.' }] }] })
    const w = mountReader()
    await settle()
    expect(w.find('.rpane').exists()).toBe(false)
  })

  it('retombe sur une grille visible quand la taille masque la grille épinglée', async () => {
    // grille-dos est réservée à la taille S : choisir M doit la retirer du fil ET du
    // volet, sans laisser un volet vide ni figé sur une grille invisible.
    stubWide()
    await seedTwoCharts()
    const w = mountReader()
    await settle()
    w.vm.selectSize(1) // M
    await settle()
    expect(w.find('.rpane img').attributes('src')).toBe(IMG_MANCHE)
  })

  it('décrocher ferme le volet et rend l’image à la carte', async () => {
    stubWide()
    await seedTwoCharts()
    const w = mountReader()
    await settle()
    expect(w.find('.rpane').exists()).toBe(true)
    // Épinglé, le bouton de décrochage existe bien : sans cette assertion,
    // sa disparition ci-dessous après unpinChart() serait aussi vraie s'il
    // n'avait jamais été rendu — la paire prouve l'apparition PUIS la
    // disparition, pas seulement l'absence finale (revue finale 28/07).
    expect(w.findAll('.rchart-unpin').length).toBe(1)
    // Avant décrochage : la carte épinglée (grille-dos, 1re grille visible) n'a PAS
    // son image (remplacée par le slot viewport-replacement) ; l'autre carte, non
    // épinglée, garde la sienne. Sans cette moitié « avant », l'assertion « les deux
    // cartes ont leur image après décrochage » ne prouverait pas un aller-retour —
    // seulement que l'image est là, ce qui serait aussi vrai si elle n'était JAMAIS
    // retirée (revue 28/07 : le mécanisme est passé de display:none à un v-if/v-else
    // qui NE REND PLUS DU TOUT .chart__viewport tant que le volet est épinglé).
    expect(w.find('#rchart-grille-dos .chart__viewport').exists()).toBe(false)
    expect(w.find('#rchart-grille-manche .chart__viewport').exists()).toBe(true)

    w.vm.unpinChart()
    await settle()

    expect(w.find('.rpane').exists()).toBe(false)
    expect(w.find('.rchart-ref').exists()).toBe(false)
    expect(w.find('.rchart-unpin').exists()).toBe(false)
    // Les deux grilles retrouvent leur image : plus aucune carte n'est marquée épinglée.
    expect(w.findAll('.rstep__chart--pinned').length).toBe(0)
    expect(w.findAll('.rstep__chart .chart').length).toBe(2)
    // L'IMAGE elle-même revient — invariant central de la fonctionnalité (« aucune perte
    // d'information » : un contenu masqué doit être visible ailleurs au même instant ;
    // décroché, il n'y a plus d'« ailleurs », donc l'image doit être RENDUE, pas juste la
    // carte). C'est la paire avec les deux assertions ci-dessus qui prouve l'aller-retour.
    expect(w.find('#rchart-grille-dos .chart__viewport').exists()).toBe(true)
    expect(w.find('#rchart-grille-manche .chart__viewport').exists()).toBe(true)
  })

  // LE test de cette tâche. Sans lui, décrocher est un aller sans retour : le bouton
  // d'épinglage disparaîtrait avec le volet et rien ne permettrait de revenir.
  it('décroché, le bouton « Afficher à droite » reste sur les cartes', async () => {
    stubWide()
    await seedTwoCharts()
    const w = mountReader()
    await settle()

    w.vm.unpinChart()
    await settle()

    expect(w.findAll('.rchart-pin').length).toBe(2)
  })

  // Correctif final (revue 28/07) : patron à UNE SEULE grille. `canPin` (ReaderView.vue)
  // ne dépend que de `hasChart` (au moins une grille visible), jamais du NOMBRE de
  // grilles — mais tous les autres tests de ce fichier passent par seedTwoCharts() et ne
  // le vérifient donc jamais. À une seule grille, son bouton « Afficher à droite » est le
  // SEUL chemin de retour après décrochage : c'est précisément le piège « aller sans
  // retour » que ce lot existe pour éviter. Pas de `sizes` sur la grille : le filtre par
  // taille ne doit pas interférer avec ce test.
  it('patron à une seule grille : décrocher laisse un bouton d’épinglage sur son unique carte', async () => {
    stubWide()
    await seedTwoCharts({
      sizeLabels: [],
      sections: [
        { id: 'corps', title: 'Corps', steps: [{ id: 'corps#0', t: 'Monter 10 m.' }] },
        { id: 'grille-dos', title: 'Grille dos', steps: [{ chart: true }], chart: { rows: 20, cols: 10, img: IMG_DOS, repeat: '10 m × 20 rangs' } },
      ],
    })
    const w = mountReader()
    await settle()
    expect(w.find('.rpane').exists()).toBe(true)

    w.vm.unpinChart()
    await settle()

    expect(w.find('.rpane').exists()).toBe(false)
    expect(w.findAll('.rchart-pin').length).toBe(1)

    await w.find('.rchart-pin').trigger('click')
    await settle()

    expect(w.find('.rpane').exists()).toBe(true)
    expect(w.find('.rpane img').attributes('src')).toBe(IMG_DOS)
  })

  it('ré-épingler après décrochage rétablit le volet sur la grille demandée', async () => {
    stubWide()
    await seedTwoCharts()
    const w = mountReader()
    await settle()
    w.vm.unpinChart()
    await settle()

    await w.findAll('.rchart-pin').at(-1).trigger('click')
    await settle()

    expect(w.find('.rpane').exists()).toBe(true)
    expect(w.find('.rpane img').attributes('src')).toBe(IMG_MANCHE)
  })

  it('la progression survit au décrochage', async () => {
    stubWide()
    await seedTwoCharts()
    const w = mountReader()
    await settle()
    w.vm.setChartRow('grille-dos', 7)
    await settle()

    w.vm.unpinChart()
    await settle()
    await w.find('.rchart-pin').trigger('click')
    await settle()

    expect(w.vm.chartRow('grille-dos')).toBe(7)
  })

  it('mode une colonne : aucun bouton d’épinglage', async () => {
    stubWide(false)
    await seedTwoCharts()
    const w = mountReader()
    await settle()
    expect(w.findAll('.rchart-pin').length).toBe(0)
    expect(w.findAll('.rchart-ref').length).toBe(0)
  })

  // Retour device 28/07 : les commandes étaient posées AVANT la carte, rien ne disait
  // qu'elles s'y rapportaient. Elles vivent désormais DANS la barre de titre du diagramme.
  it('les commandes de volet sont dans la carte, pas avant elle', async () => {
    stubWide()
    await seedTwoCharts()
    const w = mountReader()
    await settle()

    // Chaque bouton est un descendant de la carte .chart de SA section.
    const cartes = w.findAll('.rstep__chart .chart')
    expect(cartes.length).toBe(2)
    expect(cartes.some((c) => c.find('.rchart-unpin').exists())).toBe(true)
    expect(cartes.some((c) => c.find('.rchart-pin').exists())).toBe(true)
    // Plus aucune commande n'est rendue en dehors d'une carte.
    expect(w.findAll('.rstep__chart > .rchart-pin').length).toBe(0)
    expect(w.findAll('.rstep__chart > .rchart-unpin').length).toBe(0)
    expect(w.findAll('.rstep__chart > .rchart-ref').length).toBe(0)
  })

  it('la mention « Affiché à droite » remplace l’image dans la carte épinglée', async () => {
    stubWide()
    await seedTwoCharts()
    const w = mountReader()
    await settle()

    const epinglee = w.findAll('.rstep__chart').find((el) => el.classes().includes('rstep__chart--pinned'))
    expect(epinglee.find('.rchart-ref').exists()).toBe(true)
    // La carte non épinglée, elle, garde son image et n'a pas de mention.
    const autre = w.findAll('.rstep__chart').find((el) => !el.classes().includes('rstep__chart--pinned'))
    expect(autre.find('.rchart-ref').exists()).toBe(false)
  })

  it('mode une colonne : la carte n’a aucune commande de volet', async () => {
    stubWide(false)
    await seedTwoCharts()
    const w = mountReader()
    await settle()
    expect(w.findAll('.rchart-pin').length).toBe(0)
    expect(w.findAll('.rchart-unpin').length).toBe(0)
    expect(w.findAll('.rchart-ref').length).toBe(0)
  })
})

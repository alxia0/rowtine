// Bouton « retour en haut » (BackToTop.vue) posé sur les écrans longs de l'app (revue
// du 02/08 : ajout de l'écran Licences, jusque-là seul écran long du projet à en
// être dépourvu — 211 blocs dépliables, 484 Ko de texte dans le DOM).
// Ce test couvre le CÂBLAGE (le composant est-il présent, avec la bonne cible),
// pas le comportement du composant lui-même — déjà entièrement couvert par
// back-to-top.spec.js (seuil, cible tardive, démontage, rotation d'écran…).
//
// Correctif de cahier des charges (pas une déviation silencieuse) : la version
// initiale de cette tâche demandait de prouver que le lecteur reçoit une cible
// non nulle (son propre volet de texte). Vérification faite sur le code réel :
// le lecteur N'A PAS de volet de texte qui défile — `ReaderView.vue` lit
// `window.scrollY` (bandeau compact au défilement, ligne ~100), attache son
// écouteur de scroll sur `window` (ligne ~192), et navigue vers une étape via
// `document.getElementById(...).scrollIntoView` (resume(), #9). `.screen` et
// `.reader` n'ont ni hauteur contrainte ni `overflow`, et `html,body,#app`
// n'ont qu'un `min-height` (tokens.css) — aucun wrapper ne capte le scroll à la
// place du document. Le lecteur défile donc le DOCUMENT, exactement comme les
// cinq autres écrans. Passer une cible non nulle (ex. `<main class="screen">`)
// aurait livré un bouton INERTE : `scrollTop` y resterait bloqué à 0 pour
// toujours, donc `visible` ne passerait jamais à `true` — précisément la classe
// de bug (assertion qui ne peut pas rougir) déjà coûteuse sur ce projet.
//
// Le vrai point délicat du lecteur n'est donc PAS la cible, mais la collision de
// z-index/coin d'écran avec `.actionbar` (résolue dans ReaderView.vue en nichant
// le composant DANS la barre d'action, cf. commentaire à cet endroit) — c'est ce
// que les tests "lecteur" ci-dessous prouvent, par la position dans le DOM.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { db } from '@/db/db'
import i18n from '@/i18n'

const nav = vi.hoisted(() => ({
  route: { name: 'stash', params: {}, query: {} },
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => nav.route,
  useRouter: () => nav.router,
}))

import StashView from '@/views/StashView.vue'
import LibraryView from '@/views/LibraryView.vue'
import PatternView from '@/views/PatternView.vue'
import ProjectDetailView from '@/views/ProjectDetailView.vue'
import ExpensesView from '@/views/ExpensesView.vue'
import ReaderView from '@/views/ReaderView.vue'
import ThirdPartyLicensesView from '@/views/ThirdPartyLicensesView.vue'
import BackToTop from '@/components/BackToTop.vue'

const FIX_READER = {
  sizeLabels: ['S', 'M'],
  sections: [
    {
      id: 's1',
      title: 'Section 1',
      steps: [{ t: 'Monter {{0}} m end.', c: [[10, 12]] }, { t: 'Rang 2 : tric.' }],
    },
  ],
}

async function seedPatternRecord(reader = FIX_READER) {
  return db.patterns.add({ name: 'Patron test', type: 'knitting', reader })
}
async function seedProjectRecord(reader = FIX_READER) {
  const patternId = await seedPatternRecord(reader)
  return db.projects.add({ name: 'Projet test', technique: 'knitting', patternId })
}

const wrappers = []
function doMount(Component) {
  const w = mount(Component, {
    global: { plugins: [createPinia(), i18n] },
    attachTo: document.body,
  })
  wrappers.push(w)
  return w
}

// Même cadence que ReaderView.spec.js/pattern-view-preview.spec.js : plusieurs tours de
// `flushPromises` + un macro-tick, le temps que les onMounted async (chargement Dexie,
// synchro ciblée pour le lecteur) se vident.
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
  nav.route = { name: 'stash', params: {}, query: {} }
  await db.open()
  await Promise.all(db.tables.map((t) => t.clear()))
  // jsdom n'implémente pas scrollIntoView — le lecteur l'utilise (resume(), retour à
  // une section) au montage ; sans ce mock, mount() lève.
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  while (wrappers.length) wrappers.pop().unmount()
  // Contrepartie du test « défilement réel » ci-dessous : `defineProperty` pose une
  // propriété PROPRE à l'instance par-dessus l'accesseur du prototype — sans ce nettoyage,
  // le test suivant démarrerait avec un scrollTop=5000 résiduel sur documentElement.
  delete document.documentElement.scrollTop
})

describe('BackToTop — câblage sur les écrans à défilement de page', () => {
  it('StashView : présent, sans cible (document)', async () => {
    const w = doMount(StashView)
    await settle()
    const btt = w.findComponent(BackToTop)
    expect(btt.exists()).toBe(true)
    expect(btt.props('target')).toBeFalsy()
  })

  it('LibraryView : présent, sans cible (document)', async () => {
    const w = doMount(LibraryView)
    await settle()
    const btt = w.findComponent(BackToTop)
    expect(btt.exists()).toBe(true)
    expect(btt.props('target')).toBeFalsy()
  })

  it('PatternView (fiche patron) : présent, sans cible (document)', async () => {
    const id = await seedPatternRecord()
    nav.route = { name: 'pattern', params: { id: String(id) }, query: {} }
    const w = doMount(PatternView)
    await settle()
    const btt = w.findComponent(BackToTop)
    expect(btt.exists()).toBe(true)
    expect(btt.props('target')).toBeFalsy()
  })

  it('ProjectDetailView (fiche projet) : présent, sans cible (document), niché dans .chrono-dock (pas de collision avec la pastille)', async () => {
    const id = await seedProjectRecord()
    nav.route = { name: 'project', params: { id: String(id) }, query: {} }
    const w = doMount(ProjectDetailView)
    await settle()
    // Même motif que le lecteur (cf. « NICHÉ dans .actionbar ») : depuis le lot « chrono
    // unifié » (2026-08-30), la fiche porte un chrono flottant fixé en bas d'écran — le
    // bouton vit DANS son conteneur `.chrono-dock`, retiré du flux de la rangée par
    // `.chrono-dock :deep(.btt)` (position absolute, bottom: 100% — verrouillé par ailleurs
    // dans project-detail-chrono.spec.js), sinon son `position: fixed` par défaut le
    // collerait au même coin et au même z-index (40) que le dock.
    const dock = w.find('.chrono-dock')
    expect(dock.exists()).toBe(true)
    const btt = dock.findComponent(BackToTop)
    expect(btt.exists()).toBe(true)
    expect(btt.props('target')).toBeFalsy()
  })

  it('ExpensesView : présent, sans cible (document)', async () => {
    const w = doMount(ExpensesView)
    await settle()
    const btt = w.findComponent(BackToTop)
    expect(btt.exists()).toBe(true)
    expect(btt.props('target')).toBeFalsy()
  })

  // Revue du 02/08 : 211 blocs dépliables, 484 Ko de texte dans le DOM —
  // seul écran long du projet qui en était encore dépourvu (angle mort relevé en revue).
  it('ThirdPartyLicensesView (écran Licences) : présent, sans cible (document)', async () => {
    const w = doMount(ThirdPartyLicensesView)
    await settle()
    const btt = w.findComponent(BackToTop)
    expect(btt.exists()).toBe(true)
    expect(btt.props('target')).toBeFalsy()
  })
})

describe('BackToTop — lecteur : même câblage document, collision d’appui résolue', () => {
  it('suivi de projet (interactif) : présent, sans cible, NICHÉ dans .actionbar (pas de collision de coin)', async () => {
    const id = await seedProjectRecord()
    nav.route = { name: 'project-read', params: { id: String(id) }, query: {} }
    const w = doMount(ReaderView)
    await settle()
    const actionbar = w.find('.actionbar')
    expect(actionbar.exists()).toBe(true)
    const btt = actionbar.findComponent(BackToTop)
    expect(btt.exists()).toBe(true)
    expect(btt.props('target')).toBeFalsy()
  })

  it('aperçu bibliothèque (readOnly) : présent, sans .actionbar (donc sans collision possible)', async () => {
    const id = await seedPatternRecord()
    nav.route = { name: 'pattern-read', params: { id: String(id) }, query: {} }
    const w = doMount(ReaderView)
    await settle()
    expect(w.find('.actionbar').exists()).toBe(false)
    const btt = w.findComponent(BackToTop)
    expect(btt.exists()).toBe(true)
    expect(btt.props('target')).toBeFalsy()
  })

  // Revue (I1) : les deux tests précédents ne verrouillent que « aucune cible n'est
  // passée » — pas l'énoncé sur lequel repose tout l'écart de cette tâche, à savoir
  // « c'est le DOCUMENT qui défile dans le lecteur ». Sans ce test, un futur `.reader`
  // en `height: 100dvh; overflow-y: auto` (plausible pour la disposition à deux volets)
  // rendrait le bouton inerte dans le lecteur SANS faire rougir un seul test existant :
  // `target` resterait `null` (repli document toujours vrai), mais le document ne
  // défilerait plus réellement. Preuve par le comportement, pas par la forme de la prop :
  // on simule un défilement du DOCUMENT (pas d'un volet) et on vérifie que le bouton, qui
  // vit DANS `.actionbar`, apparaît bien.
  it('suivi de projet (interactif) : le bouton réagit à un défilement du DOCUMENT (pas d’un volet)', async () => {
    const id = await seedProjectRecord()
    nav.route = { name: 'project-read', params: { id: String(id) }, query: {} }
    const w = doMount(ReaderView)
    await settle()
    const bar = w.find('.actionbar')
    expect(bar.find('button.btt').exists()).toBe(false) // avant défilement : rien

    Object.defineProperty(document.documentElement, 'scrollTop', { value: 5000, configurable: true })
    window.dispatchEvent(new Event('scroll'))
    await flushPromises()

    // Rougit si le lecteur cesse un jour de défiler le document (ex. `.reader` gagnant
    // son propre `overflow-y: auto`) : le scrollTop simulé ci-dessus ne serait alors plus
    // vu par personne et le bouton resterait absent.
    expect(bar.find('button.btt').exists()).toBe(true)
  })
})

// Revue des travaux (Important) : en disposition deux volets (tablette en paysage,
// atteignable dès 900×500 — la tablette de validation mesure 960×584), l'aperçu
// bibliothèque (readOnly) pose `<BackToTop v-else />` SANS `.actionbar` pour l'englober
// (cf. le test ci-dessus « aperçu bibliothèque… sans collision possible »). Le bouton
// garde donc son `position: fixed` par défaut, collé au bord droit de l'ÉCRAN — pile où
// `.rpane` (le volet diagramme, z-index 35) est lui aussi calé, à un z-index de bouton
// (40) supérieur : sans correctif, le bouton flotterait AU-DESSUS du diagramme.
// `vitest.config.js` a `css: false` (styles non injectés dans jsdom) : un test à base de
// `getComputedStyle` serait aveugle ici (cf. reader-text-editor-sticky.spec.js pour le
// même constat). On lit donc le SOURCE brut du composant, comme ce fichier de tests.
// Le rendu visuel réel (bouton bien décalé, pas de chevauchement à l'écran) reste un gate
// DEVICE — non couvert ici.
describe('BackToTop — aperçu bibliothèque en deux volets : le bouton flottant ne passe plus sous le diagramme', () => {
  const readerSrc = readFileSync(resolve(process.cwd(), 'src/views/ReaderView.vue'), 'utf8')

  // Échappe TOUS les métacaractères regex du sélecteur (le `[.[\]]` d'un précédent copié
  // dans reader-text-editor-sticky.spec.js ne suffirait pas ici : `:deep(.btt)` contient
  // des parenthèses, qui seraient interprétées comme un groupe de capture plutôt que du
  // texte littéral, et la règle ne serait alors jamais trouvée).
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  function ruleBody(css, selector) {
    const re = new RegExp(escapeRegExp(selector) + '\\s*\\{([\\s\\S]*?)\\n\\}', 'gm')
    const matches = [...css.matchAll(re)]
    if (matches.length === 0) throw new Error(`règle introuvable : ${selector}`)
    // Garde-fou : si un futur commentaire citant ce sélecteur ressemblait à une règle
    // (texte suivi de `{`), on veut le savoir plutôt que de lire silencieusement le
    // mauvais bloc.
    if (matches.length > 1) throw new Error(`règle trouvée ${matches.length} fois (attendu 1) : ${selector}`)
    return matches[0][1]
  }
  function declValue(body, prop) {
    const m = body.match(new RegExp(`(?:^|\\s)${prop}\\s*:\\s*([^;]+);`))
    if (!m) throw new Error(`déclaration introuvable : ${prop}`)
    return m[1].replace(/\s+/g, ' ').trim()
  }

  it('un unique <style scoped> couvre tout le fichier (:deep() ne serait sinon pas appliqué)', () => {
    // Ancré en DÉBUT DE LIGNE (`^...gm`) : les balises top-level d'un SFC Vue ne sont
    // jamais indentées, contrairement à du texte de commentaire qui MENTIONNE `<style>`
    // (ex. juste au-dessus dans ce même fichier, dans un commentaire du template) — un
    // motif non ancré prend ces mentions pour de vraies balises et fausse le compte.
    const tags = [...readerSrc.matchAll(/^<style[^>]*>/gm)].map((m) => m[0])
    expect(tags).toEqual(['<style scoped>'])
  })

  it('.reader--split > :deep(.btt) décale le bouton flottant de la largeur du volet + sa marge habituelle', () => {
    const body = ruleBody(readerSrc, '.reader--split > :deep(.btt)')
    // Même marge que le bouton flottant par défaut (BackToTop.vue : max(var(--sp-4),
    // var(--sa-right))), ajoutée après la largeur du volet — pour retrouver exactement
    // le même espacement au bord droit du volet que celui qu'il a normalement au bord
    // droit de l'écran.
    expect(declValue(body, 'right')).toBe('calc(var(--pane-w) + max(var(--sp-4), var(--sa-right)))')
  })

  // Le sélecteur ci-dessus est un ENFANT DIRECT (`>`), et c'est le point qui compte :
  // depuis que le bouton du suivi est `position: absolute` DANS `.actionbar` (retour
  // terrain du 01/08 : empilé au-dessus de l'aide-mémoire pour rendre sa largeur au
  // chrono), il hérite déjà du décalage de la barre (`.reader--split .actionbar`). Un
  // sélecteur DESCENDANT l'atteindrait aussi et lui appliquerait ce décalage une seconde
  // fois — il sortirait de l'écran par la gauche, en disposition deux volets seulement,
  // c'est-à-dire dans le cas que jsdom ne rend pas et qu'aucun autre test ne verrait.
  it('le décalage du volet ne vise QUE le bouton flottant de la lecture seule (enfant direct de .reader)', () => {
    expect(readerSrc).toContain('.reader--split > :deep(.btt)')
    // Rougit si quelqu'un retire le `>` : la forme descendante ne doit exister nulle part.
    expect(readerSrc).not.toMatch(/^\.reader--split :deep\(\.btt\)/m)
  })

  it('.actionbar :deep(.btt) empile le bouton au-dessus de la rangée, hors de son flux', () => {
    const body = ruleBody(readerSrc, '.actionbar :deep(.btt)')
    // `absolute` (et non plus `static`) : c'est ce qui le retire du flux de la rangée
    // flex, donc ce qui rend au chrono la largeur que « Reprendre » réclamait.
    expect(declValue(body, 'position')).toBe('absolute')
    // Au-dessus du bord haut de la barre, sans hauteur de rangée écrite en dur.
    expect(declValue(body, 'bottom')).toBe('100%')
    // Bord droit aligné sur celui du dernier bouton : la MÊME variable que le padding
    // droit de la barre, pas une copie de sa valeur (deux copies avaient divergé, 4 px
    // de décalage constatés).
    expect(declValue(body, 'right')).toBe('var(--bar-pad-x-right)')
    // La variable est bien DÉFINIE, et c'est bien elle que le padding droit de la barre
    // consomme — sinon `right` vaudrait `initial` et le bouton se collerait au bord de
    // la barre au lieu de s'aligner sur le dernier bouton. (`ruleBody('.actionbar')` ne
    // convient pas ici : le sélecteur est aussi un préfixe de `.actionbar--hidden` et de
    // `.reader--split .actionbar`, il matche cinq règles.)
    expect(readerSrc).toMatch(/^\s*padding: var\(--sp-4\) var\(--bar-pad-x-right\) /m)
    // DEUX définitions attendues : la valeur pleine, et celle du resserrage téléphone.
    // C'est le point de rupture : le resserrage doit redéfinir CETTE VARIABLE et jamais
    // `padding-right` seul — sinon le bouton garderait l'alignement de la valeur pleine
    // sur une barre au padding réduit, et se décalerait de 4 px (déjà constaté une fois).
    const defs = [...readerSrc.matchAll(/--bar-pad-x-right:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(defs).toEqual(['max(var(--sp-4), var(--sa-right))', 'max(var(--sp-3), var(--sa-right))'])
    // Le resserrage vit dans une media query placée APRÈS la règle `.actionbar` de
    // base : il y redéfinit `--bar-pad-x-right` à spécificité ÉGALE, donc seul
    // l'ORDRE le fait gagner (piège rencontré — le chrono gardait ses marges pleines
    // et le libellé restait tronqué).
    const iMedia = readerSrc.indexOf('@media (max-width: 430px)')
    expect(iMedia).toBeGreaterThan(readerSrc.indexOf('\n.actionbar {'))
    // Depuis l'extraction de la pastille dans ChronoPill.vue (lot « chrono unifié »),
    // ce seuil resserre le gap et le padding du COMPOSANT. Deux conditions pour que
    // ça gagne DEPUIS cette feuille scopée : viser le bouton par `.actionbar
    // :deep(...)` — un sélecteur nu ne porte pas le data-v de cette vue et
    // n'atteindrait JAMAIS le bouton (resserrage mort en silence) — et hériter du
    // préfixe `.actionbar`, plus spécifique que la base scopée du composant : la
    // victoire ne dépend alors pas de l'ordre d'émission des deux feuilles.
    // Spec 08/09 (fusion chevron) : le padding du geste vit sur le CORPS de la
    // pastille (.chrono-fab__body), plus sur la capsule — c'est lui que resserre ce seuil.
    const chronoTight = ruleBody(readerSrc.slice(iMedia), '.actionbar :deep(.chrono-fab__body)')
    expect(declValue(chronoTight, 'gap')).toBe('6px')
    expect(declValue(chronoTight, 'padding')).toBe('0 var(--sp-3)')
    // La DISPOSITION de la pastille dans la barre (rétrécissable, largeur plancher,
    // calage à gauche) est restée AVEC la barre : c'est elle qui rend au chrono la
    // largeur que « Reprendre » réclame (cf. le commentaire de la règle dans la vue).
    const chronoPlace = ruleBody(readerSrc.slice(0, iMedia), '.actionbar :deep(.chrono-fab)')
    expect(declValue(chronoPlace, 'flex')).toBe('0 1 auto')
    expect(declValue(chronoPlace, 'min-width')).toBe('min(11ch, 100%)')
    expect(declValue(chronoPlace, 'margin-right')).toBe('auto')
  })
})

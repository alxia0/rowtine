// @vitest-environment jsdom
// revealLine — pose le curseur sur une ligne donnée d'un VRAI éditeur CM6
// (créé par createCmEditor, donc avec les plages atomiques des lignes image
// actives, cf. move-line.spec.js). On vérifie la SÉLECTION, pas le défilement :
// jsdom ne fait pas de mise en page, `scrollIntoView` y est sans effet
// observable — le calcul de centrage réel (`EditorView.scrollMargins`)
// est vérifié en lisant la CONFIGURATION résultante de l'éditeur (les sources
// du facet, réellement branchées et appelables), pas un résultat de mise en
// page ; la géométrie réelle (le centrage visuel qui en découle) est prouvée
// en e2e (tests/e2e/reader-fix-line.spec.js).
import { describe, it, expect, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { createCmEditor } from '@/components/cm/cm-editor'
import { revealLine } from '@/components/cm/reveal-line'

const MD = '## Corps\n\n- Rang 1\n![](img/x.png)\n- Rang 2\n'

function mount(value = MD) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  return createCmEditor(host, { value })
}

describe('revealLine', () => {
  it('pose le curseur au début de la ligne demandée', () => {
    const editor = mount()
    expect(revealLine(editor.view, 3)).toBe(true)
    const pos = editor.view.state.selection.main.head
    const line = editor.view.state.doc.lineAt(pos)
    expect(line.number).toBe(3)
    expect(line.text).toBe('- Rang 1')
    expect(pos).toBe(line.from)
  })

  it('atteint une ligne IMAGE malgré sa plage atomique', () => {
    const editor = mount()
    expect(revealLine(editor.view, 4)).toBe(true)
    const pos = editor.view.state.selection.main.head
    expect(editor.view.state.doc.lineAt(pos).number).toBe(4)
  })

  it('ligne hors document → false, curseur inchangé', () => {
    const editor = mount()
    const before = editor.view.state.selection.main.head
    expect(revealLine(editor.view, 99)).toBe(false)
    expect(revealLine(editor.view, 0)).toBe(false)
    expect(revealLine(editor.view, null)).toBe(false)
    expect(editor.view.state.selection.main.head).toBe(before)
  })

  it('vue absente → false, jamais d’exception', () => {
    expect(revealLine(null, 3)).toBe(false)
    expect(revealLine(undefined, 3)).toBe(false)
  })

  it('ne prend PAS le focus (le clavier virtuel resterait fermé)', () => {
    const editor = mount()
    const active = document.activeElement
    revealLine(editor.view, 3)
    expect(document.activeElement).toBe(active)
  })
})

// Retour terrain (2026-08-23) : la ligne visée
// atterrissait en haut de l'écran (`y: 'center'` centre sur `window.innerHeight`
// ENTIER, cf. commentaire de tête de reveal-line.js — les bandeaux collants ne
// sont jamais des ANCÊTRES de `.cm-scroller`, la remontée de CodeMirror ne les
// traverse donc jamais). Correctif retenu : `EditorView.scrollMargins` (facet
// PUBLIC de CM6), branché via `StateEffect.appendConfig` dans la MÊME
// transaction que le scroll — `y: 'center'` reste inchangé, c'est CM6 qui
// gonfle le rectangle visé de nos deux marges avant de centrer (cf. le calcul
// détaillé en tête de reveal-line.js : la hauteur de ligne s'y annule
// entièrement, aucune approximation possible). Deux essais antérieurs
// (yMargin calculé à la main avec `view.defaultLineHeight`, ou un
// `window.scrollBy` correctif après coup) ont été mesurés PUIS écartés — cf.
// le même commentaire pour le détail chiffré.
describe('revealLine — centrage dans la zone visible', () => {
  it('dispatche AUSSI un scrollIntoView `y: "center"` (le centrage lui-même reste géré par CM6, inchangé)', () => {
    const editor = mount()
    const dispatch = vi.spyOn(editor.view, 'dispatch')
    revealLine(editor.view, 3, { top: () => 0, bottom: () => 0 })
    const tr = dispatch.mock.calls[0][0]
    dispatch.mockRestore()
    // `effects` porte ICI un TABLEAU de deux StateEffect (appendConfig du
    // facet + scrollIntoView), pas un seul objet — cf. reveal-line.js.
    expect(Array.isArray(tr.effects)).toBe(true)
    const scrollEffect = tr.effects.find((e) => e.value && typeof e.value.y === 'string')
    expect(scrollEffect).toBeTruthy()
    expect(scrollEffect.value.y).toBe('center')
  })

  it('branche occlusion.top/occlusion.bottom — des FONCTIONS — dans EditorView.scrollMargins, appelées EN DIRECT par CodeMirror (jamais recopiées)', () => {
    const editor = mount()
    let topCalls = 0
    let bottomCalls = 0
    const getTop = () => {
      topCalls++
      return 40
    }
    const getBottom = () => {
      bottomCalls++
      return 15
    }
    revealLine(editor.view, 3, { top: getTop, bottom: getBottom })
    // La transaction a bien été appliquée (pas d'espion cette fois) : la
    // configuration RÉSULTANTE de l'éditeur porte donc déjà notre source.
    const sources = editor.view.state.facet(EditorView.scrollMargins)
    expect(sources.length).toBeGreaterThan(0)
    const ourSource = sources[sources.length - 1]
    // Chaque source est un CALLBACK que CM6 relit à SA convenance (au moment
    // de sa propre passe de mesure, jamais figé par revealLine) : l'appeler
    // ICI, depuis le test, prouve que ce sont bien getTop/getBottom qui
    // répondent, sans valeur déjà lue ni copiée entre-temps.
    expect(ourSource(editor.view)).toEqual({ top: 40, bottom: 15 })
    expect(topCalls).toBe(1)
    expect(bottomCalls).toBe(1)
  })

  it('occlusion omise (paramètre par défaut) : marge nulle des deux côtés, jamais `undefined`', () => {
    const editor = mount()
    revealLine(editor.view, 3)
    const sources = editor.view.state.facet(EditorView.scrollMargins)
    const ourSource = sources[sources.length - 1]
    expect(ourSource(editor.view)).toEqual({ top: 0, bottom: 0 })
  })
})

// Retour device 28/07 : les 6 contrôles étaient alternés (bouton, menu, bouton, menu…),
// ce qui donnait sur téléphone un enchaînement « petit bouton + grand menu » peu lisible.
// Nouvel ordre : les 2 boutons + le menu le plus large, puis les 2 autres menus + 1 bouton.
//
// Section et Aide-mémoire sont passés de <select> à une puce
// 44×44 (retagMenuBtn, même famille que les boutons Étape/Note/Texte) : l'ORDRE des 6
// contrôles est conservé tel quel (seul le CONTRÔLE change, pas sa place) — le budget de
// largeur en commentaire ci-dessus (246/260 px) ne vaut donc plus littéralement
// (Aide-mémoire et Section sont maintenant des 44 px, pas 150/100).
//
// Compteur (dernier <select>, 108px) est à son tour devenu une
// puce 44×44 : les 6 contrôles sont tous des `button` désormais.
//
// Revue finale (constat 2, 2026-08-22) — `.cm-retag-break` (le <span> qui forçait une
// coupure en 2 lignes sous 600px) a été RETIRÉ : mesuré Playwright réel à 360/393px, les
// 6 puces 44px tiennent sur une seule ligne, sans débordement ni chevauchement avec
// l'indicateur d'aide-mémoire. Ce test n'attend donc plus ce <span> dans le HTML produit.
import { describe, it, expect } from 'vitest'
import { buildToolbarHtml, createCmEditor } from '@/components/cm/cm-editor.js'
import fr from '@/i18n/fr.json'

// Position d'apparition de chaque contrôle dans le HTML produit. `ref`/`section`/`counter`
// cherchent la classe SANS le préfixe `class="` (devenu `class="cm-retag-btn cm-retag-ref"`
// depuis que les puces partagent désormais leur classe avec `cm-retag-btn`, Compteur
// inclus) : la sous-chaîne `cm-retag-ref"` reste unique et tombe à la même
// position relative.
function order(html) {
  const marks = [
    ['rang', 'data-retag="rang"'],
    ['note', 'data-retag="note"'],
    ['ref', 'cm-retag-ref"'],
    ['counter', 'cm-retag-counter"'],
    ['section', 'cm-retag-section"'],
    ['texte', 'data-retag="texte"'],
  ]
  return marks
    .map(([name, needle]) => [name, html.indexOf(needle)])
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name)
}

describe('buildToolbarHtml — ordre des 6 contrôles', () => {
  it('émet les contrôles dans l’ordre attendu', () => {
    expect(order(buildToolbarHtml())).toEqual([
      'rang', 'note', 'ref', 'counter', 'section', 'texte',
    ])
  })

  it('chaque contrôle est présent exactement une fois', () => {
    const html = buildToolbarHtml()
    for (const needle of ['data-retag="rang"', 'data-retag="note"', 'data-retag="texte"',
                          'cm-retag-counter', 'cm-retag-section"', 'cm-retag-ref"']) {
      expect(html.split(needle).length - 1, needle).toBe(1)
    }
  })

  it('n’émet plus le <span> de coupure de ligne (.cm-retag-break, retiré)', () => {
    expect(buildToolbarHtml()).not.toContain('cm-retag-break')
  })

  // L'indicateur de type d'aide-mémoire reste le DERNIER élément : son texte est variable
  // (« Abréviations »…) et le placer entre deux contrôles décalerait le groupement dès
  // qu'il se remplit.
  it('garde l’indicateur de type en dernier', () => {
    const html = buildToolbarHtml()
    expect(html.indexOf('cm-retag-ref-type')).toBeGreaterThan(html.indexOf('data-retag="texte"'))
  })

  // Constat 4 (revue finale) : aria-haspopup="menu" aria-expanded="false" posés
  // STATIQUEMENT sur les 3 puces à popover, dès le premier rendu — avant, ces
  // attributs n'existaient qu'après le premier tap (posés par openMenuPopover).
  it('pose aria-haspopup="menu" aria-expanded="false" statiquement sur les 3 puces à popover', () => {
    const html = buildToolbarHtml()
    for (const cls of ['cm-retag-ref', 'cm-retag-counter', 'cm-retag-section']) {
      const btnMatch = html.match(new RegExp(`<button[^>]*class="cm-retag-btn ${cls}"[^>]*>`))
      expect(btnMatch, `bouton ${cls} introuvable`).toBeTruthy()
      expect(btnMatch[0]).toContain('aria-haspopup="menu"')
      expect(btnMatch[0]).toContain('aria-expanded="false"')
    }
  })
})

// Retour terrain, second tour — l'indicateur `.cm-retag-ref-type`
// (rempli à l'exécution par updateToolbarActive, pas par buildToolbarHtml ci-dessus,
// toujours vide statiquement) ne doit plus afficher le mot « Note » : strictement
// identique au libellé déjà visible sous l'icône de la puce Note active, même défaut que
// Texte avait avant elle. Seule Aide-mémoire (type 'reference') y affiche encore une
// information non redondante (sa balise précise). Monte un VRAI éditeur (comme
// cm-editor-toolbar-reference.spec.js) : ce comportement dépend du DOM produit par
// updateToolbarActive, invisible à buildToolbarHtml seul.
describe('barre — indicateur .cm-retag-ref-type (updateToolbarActive)', () => {
  it('reste vide sur une ligne Note (pastille redondante retirée)', () => {
    const doc = '> Une note utile\n## Aiguilles/Crochet {needles}'
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createCmEditor(host, { value: doc })
    // Montage : curseur en ligne 1 (Note) par défaut — état initial déjà vérifié,
    // pas seulement après un dispatch de sélection.
    expect(editor.toolbar.querySelector('.cm-retag-ref-type').textContent).toBe('')
    host.remove()
  })

  it('reste rempli de la balise précise sur une ligne Aide-mémoire (seul cas légitime)', () => {
    const doc = '> Une note utile\n## Aiguilles/Crochet {needles}'
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createCmEditor(host, { value: doc })
    const { state, dispatch } = editor.view
    const line2 = state.doc.line(2)
    dispatch({ selection: { anchor: line2.from, head: line2.from } })
    expect(editor.toolbar.querySelector('.cm-retag-ref-type').textContent).toBe(
      fr.correction.toolbar.needles
    )
    host.remove()
  })
})

// Illustration PROVISOIRE des écrans vides (stock, stats) — cf. src/components/EmptyStateArt.vue.
// Ce test couvre le contrat du composant : rend un <svg>, taille pilotée par prop, couleur
// héritée (currentColor, pas de couleur en dur), décoratif (aria-hidden, rien à annoncer).
// Couvre AUSSI la mise en page (correctif revue finale P2, 17/07) : StashView et StatsView
// utilisaient CHACUN leur propre `.empty-state`/`.empty-state__text` en dupliquant le CSS, avec
// deux définitions qui avaient divergé (les deux écrans vides ne se ressemblaient plus). La
// mise en page vit maintenant ICI, via un slot par défaut (texte principal) + un slot `hint`
// optionnel (texte secondaire, ex. StatsView) — point de remplacement unique préservé : la
// vraie mascotte remplacera ce même fichier, mise en page comprise.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import EmptyStateArt from '@/components/EmptyStateArt.vue'

describe('EmptyStateArt', () => {
  it('rend un <svg> inline', () => {
    const w = mount(EmptyStateArt)
    expect(w.find('svg').exists()).toBe(true)
  })

  it('hérite la couleur de l’appelant (stroke=currentColor, aucune couleur en dur)', () => {
    const w = mount(EmptyStateArt)
    const svg = w.find('svg')
    expect(svg.attributes('stroke')).toBe('currentColor')
    expect(svg.attributes('fill')).toBe('none')
    // Liste blanche plutôt que liste noire : une liste noire de formats de couleur interdits
    // (`#rgb`, `rgb(...)`, `hsl(...)`, noms CSS type `red`…) est toujours incomplète — la
    // regex précédente (`/stroke="#|fill="#/`) ne voyait que le format hexadécimal. Le
    // composant n'est censé fixer QUE `fill="none"` et `stroke="currentColor"`, jamais
    // ailleurs qu'à la racine du <svg> : on l'affirme directement — tout le HTML rendu ne
    // doit contenir QU'UNE occurrence de chaque, avec ces valeurs exactes. `\bfill="`/
    // `\bstroke="` ne capturent pas `stroke-width=`/`stroke-linecap=`/`stroke-linejoin=` (le
    // tiret empêche le match du littéral `stroke="`).
    const html = w.html()
    const fills = [...html.matchAll(/\bfill="([^"]*)"/g)].map((m) => m[1])
    const strokes = [...html.matchAll(/\bstroke="([^"]*)"/g)].map((m) => m[1])
    expect(fills).toEqual(['none'])
    expect(strokes).toEqual(['currentColor'])
  })

  it('respecte la taille passée en prop (largeur ET hauteur du <svg>)', () => {
    const w = mount(EmptyStateArt, { props: { size: 96 } })
    const svg = w.find('svg')
    expect(svg.attributes('width')).toBe('96')
    expect(svg.attributes('height')).toBe('96')
  })

  it('a une taille par défaut raisonnable sans prop', () => {
    const w = mount(EmptyStateArt)
    const svg = w.find('svg')
    expect(Number(svg.attributes('width'))).toBeGreaterThan(0)
    expect(svg.attributes('width')).toBe(svg.attributes('height'))
  })

  it('est décoratif : aria-hidden, rien pour le lecteur d’écran', () => {
    const w = mount(EmptyStateArt)
    // aria-hidden peut être posé sur le <svg> lui-même ou sur un conteneur englobant.
    const hidden = w.find('[aria-hidden="true"]')
    expect(hidden.exists()).toBe(true)
    // Pas de role="img" ni d'aria-label : ce n'est pas une image porteuse de sens.
    expect(w.find('[role="img"]').exists()).toBe(false)
    expect(w.find('[aria-label]').exists()).toBe(false)
  })

  it('rend le slot par défaut (texte principal) dans .empty-state__text', () => {
    const w = mount(EmptyStateArt, { slots: { default: 'Stock vide. Ajoute ta première laine.' } })
    expect(w.find('.empty-state__text').text()).toBe('Stock vide. Ajoute ta première laine.')
  })

  it('sans slot `hint`, aucun .empty-state__hint n’est rendu (pas de faux vide)', () => {
    const w = mount(EmptyStateArt, { slots: { default: 'Texte principal.' } })
    expect(w.find('.empty-state__hint').exists()).toBe(false)
  })

  it('avec un slot `hint`, il est rendu dans .empty-state__hint', () => {
    const w = mount(EmptyStateArt, {
      slots: { default: 'Aucune session enregistrée.', hint: 'Lance le chrono pour commencer.' },
    })
    expect(w.find('.empty-state__hint').text()).toBe('Lance le chrono pour commencer.')
  })

  it('porte la mise en page complète (conteneur .empty-state + art .empty-state__art)', () => {
    const w = mount(EmptyStateArt, { slots: { default: 'Texte.' } })
    expect(w.find('.empty-state').exists()).toBe(true)
    expect(w.find('.empty-state__art').exists()).toBe(true)
    // C'est bien le <svg> qui porte la classe d'art (et pas un <div> englobant supplémentaire) :
    // un seul point de vérité pour "à quoi ressemble l'illustration".
    expect(w.find('.empty-state__art').element.tagName).toBe('svg')
  })
})

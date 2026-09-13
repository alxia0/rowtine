// tests/unit/knitting-loader.spec.js
// Animation d'attente. Deux variantes RÉELLEMENT distinctes (le test doit rougir si les
// deux rendent le même dessin) et un dessin décoratif, muet pour les lecteurs d'écran.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import KnittingLoader from '@/components/KnittingLoader.vue'

describe('KnittingLoader', () => {
  it('variante tricot et variante crochet rendent des dessins DIFFÉRENTS', () => {
    const knit = mount(KnittingLoader, { props: { technique: 'knitting' } }).html()
    const crochet = mount(KnittingLoader, { props: { technique: 'crochet' } }).html()
    expect(knit).not.toBe(crochet)
    expect(mount(KnittingLoader, { props: { technique: 'knitting' } }).find('[data-tool="needles"]').exists()).toBe(true)
    expect(mount(KnittingLoader, { props: { technique: 'crochet' } }).find('[data-tool="hook"]').exists()).toBe(true)
  })

  it('décoratif : aria-hidden, aucun texte lu', () => {
    const w = mount(KnittingLoader, { props: { technique: 'knitting' } })
    expect(w.find('svg').attributes('aria-hidden')).toBe('true')
    expect(w.text().trim()).toBe('')
  })

  it('technique inconnue : repli sur le tricot, pas de rendu vide', () => {
    const w = mount(KnittingLoader, { props: { technique: 'macramé' } })
    expect(w.find('[data-tool="needles"]').exists()).toBe(true)
  })

  // Ajouté après revue : le premier test compare le HTML complet, qui diffère déjà via
  // data-tool/la classe de variante — il ne verrait PAS un outil dont on aurait copié la
  // géométrie du tricot en gardant l'étiquette "hook". Celui-ci compare la géométrie DESSINÉE
  // (les attributs de tracé eux-mêmes) des seuls éléments de l'outil, tous types de balise
  // confondus (les aiguilles sont des <line>, pas des <path> — un sélecteur qui ne prendrait
  // que 'path' les manquerait).
  function toolGeometry(wrapper, dataTool) {
    const tool = wrapper.find(`[data-tool="${dataTool}"]`)
    return tool
      .findAll('path, line, circle, rect, polygon, polyline')
      .map((el) => `${el.element.tagName}:${JSON.stringify(el.attributes())}`)
      .join('|')
  }

  it("les géométries des deux outils sont réellement différentes (pas qu'une étiquette)", () => {
    const knit = mount(KnittingLoader, { props: { technique: 'knitting' } })
    const crochet = mount(KnittingLoader, { props: { technique: 'crochet' } })
    const knitGeo = toolGeometry(knit, 'needles')
    const crochetGeo = toolGeometry(crochet, 'hook')
    expect(knitGeo.length).toBeGreaterThan(0)
    expect(crochetGeo.length).toBeGreaterThan(0)
    expect(knitGeo).not.toBe(crochetGeo)
  })

  // Retour terrain du 31/07 : « les deux aiguilles bougent parallèlement... elles
  // pourraient plutôt se croiser ». La géométrie fautive était mathématiquement PARALLÈLE
  // (produit vectoriel nul) malgré un commentaire qui la disait « croisée » — ce test aurait
  // rougi sur l'ancien dessin.
  it('tricot : les deux aiguilles ne sont PAS parallèles (elles se croisent réellement)', () => {
    const w = mount(KnittingLoader, { props: { technique: 'knitting' } })
    const lines = w.find('[data-tool="needles"]').findAll('line')
    expect(lines.length).toBe(2)
    const vec = (line) => {
      const a = line.attributes()
      return [Number(a.x2) - Number(a.x1), Number(a.y2) - Number(a.y1)]
    }
    const [v1, v2] = lines.map(vec)
    const cross = v1[0] * v2[1] - v1[1] * v2[0]
    expect(Math.abs(cross)).toBeGreaterThan(1)
  })

  // Retour terrain du 31/07 : « le crochet... est courbé au lieu d'être droit ». La tige
  // doit rester une ligne DROITE (commande SVG "L"), jamais une courbe ("c"/"C") sur sa
  // longueur — ce test aurait rougi sur l'ancien dessin (tige en courbe de Bézier).
  it('crochet : la tige est DROITE (pas une courbe sur sa longueur)', () => {
    const w = mount(KnittingLoader, { props: { technique: 'crochet' } })
    const paths = w.find('[data-tool="hook"]').findAll('path')
    // la tige est le premier <path> du groupe hook, avant le bec et la maille
    const shaftD = paths[0].attributes('d')
    expect(shaftD).toMatch(/L/)
    expect(shaftD).not.toMatch(/[cC]/)
  })

  // Retour de relecture du 31/07 (après le correctif du 31/07 sur la tige droite) : un bec
  // mathématiquement ouvert (départ ≠ arrivée) peut quand même se REFERMER À L'ŒIL une fois
  // rendu à 56 px, parce que c'est l'ÉPAISSEUR DE TRAIT RENDUE qui mange l'écart, pas sa seule
  // valeur en unités de viewBox. Ce test compare donc l'écart départ→arrivée du bec à
  // l'épaisseur de trait RÉELLEMENT RENDUE à la taille d'affichage réelle (56 px, celle
  // d'ImportProgress.vue) — pas à la taille par défaut du composant (96 px), qui sous-estime
  // le risque puisque `stroke-width` est compensé pour grossir quand `size` rétrécit.
  // ⚠️ Suppose que le bec reste tracé en UNE SEULE commande "c" (une seule courbe) après un
  // unique "M" : si ce n'est plus le cas, ADAPTER l'analyse du tracé ci-dessous, pas supprimer
  // le test.
  it("crochet : le bec reste OUVERT à 56 px (l'écart domine largement l'épaisseur de trait rendue)", () => {
    const w = mount(KnittingLoader, { props: { technique: 'crochet', size: 56 } })
    const paths = w.find('[data-tool="hook"]').findAll('path')
    const barbD = paths[1].attributes('d') // shaft, bec, maille — le bec est le 2e <path>
    const m = barbD.match(
      /^M(-?[\d.]+) (-?[\d.]+)c(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)$/
    )
    expect(m).not.toBeNull()
    // groupes : 1=x0 2=y0 3=c1x 4=c1y 5=c2x 6=c2y 7=dx 8=dy (dx,dy = arrivée relative au départ)
    const dx = Number(m[7])
    const dy = Number(m[8])
    const gap = Math.hypot(dx, dy) // écart départ→arrivée, en unités de viewBox
    const strokeWidth = Number(w.find('svg').attributes('stroke-width'))
    // seuil : au moins 4x l'épaisseur de trait rendue à 56 px — une marge large, pas un pile-poil
    expect(gap).toBeGreaterThan(strokeWidth * 4)
  })
})

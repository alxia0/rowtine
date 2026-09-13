// Promotion des grilles importées en sections-diagrammes interactives.
// Décision produit : TOUTES les grilles suivables (pas seulement la 1re). Piège central
// (zone de re-synchro) : chaque section-diagramme doit avoir un `id` UNIQUE, sinon le
// suivi de rang d'une grille contaminerait une autre.
import { describe, it, expect } from 'vitest'
import { promoteGridSections } from '@/utils/pdf-import/promote-grids'

// Reader minimal : 2 sections de travail DÉJÀ normalisées (ids assignés, comme après
// buildReaderFromPages). promoteGridSections n'y touche pas et déduplique les nouveaux ids
// contre les leurs.
const reader = () => ({
  sizeLabels: ['T'],
  sections: [
    { id: 'dos', kind: 'corps', title: 'Dos', steps: [{ t: 'Rang 1 : monter', imgs: ['data:photo'] }] },
    { id: 'manches', kind: 'manche', title: 'Manches', steps: [{ t: 'Rang 1 : monter' }] },
  ],
})
// Pages : titres localisés pour l'ancrage géométrique (y décroissant = haut→bas).
const pages = () => [[{ text: 'Dos', y: 700 }, { text: 'Manches', y: 300 }]]
const grid = (page, y, src) => ({ src, page, x: 0, y, w: 100, h: 100, kind: 'grid' })

describe('promoteGridSections', () => {
  it('une région kind:grid → une section diagramme (chart.img, rows:0, étape {chart:true}, id non vide)', () => {
    const out = promoteGridSections(reader(), [grid(1, 500, 'data:img,A')], pages())
    const diag = out.sections.find((s) => s.kind === 'diagramme')
    expect(diag).toBeTruthy()
    expect(diag.chart.img).toBe('data:img,A')
    expect(diag.chart.rows).toBe(0) // rangs inconnus (sentinel « à renseigner »)
    expect(diag.steps.some((st) => st.chart === true)).toBe(true)
    expect(diag.id).toBeTruthy() // id assigné (pas '')
  })

  it('≥2 grilles → ids DISTINCTS (le piège : sinon chartRows se contamine)', () => {
    const out = promoteGridSections(
      reader(),
      [grid(1, 500, 'data:img,A'), grid(1, 480, 'data:img,B')],
      pages(),
    )
    const diags = out.sections.filter((s) => s.kind === 'diagramme')
    expect(diags).toHaveLength(2)
    const ids = diags.map((s) => s.id)
    expect(new Set(ids).size).toBe(2) // ids uniques
    expect(ids.every(Boolean)).toBe(true)
  })

  it('kind:reference → NON promue (aucune section diagramme créée)', () => {
    const ref = { src: 'data:img,R', page: 1, x: 0, y: 500, w: 100, h: 100, kind: 'reference' }
    const out = promoteGridSections(reader(), [ref], pages())
    expect(out.sections.some((s) => s.kind === 'diagramme')).toBe(false)
  })

  it('aucune grille → reader inchangé (référence conservée)', () => {
    const r = reader()
    expect(promoteGridSections(r, [], pages())).toBe(r)
    expect(promoteGridSections(r, [{ src: 'x', kind: 'reference' }], pages())).toBe(r)
  })

  it('placement : grille ancrée après sa section active (ordre de lecture)', () => {
    // Grille A (y=500) sous Dos ; grille B (y=200) sous Manches.
    const out = promoteGridSections(
      reader(),
      [grid(1, 500, 'data:img,A'), grid(1, 200, 'data:img,B')],
      pages(),
    )
    const titles = out.sections.map((s) => s.title)
    // Attendu : Dos, <diagramme A>, Manches, <diagramme B>.
    expect(titles.indexOf('Dos')).toBeLessThan(titles.findIndex((t) => t.startsWith('Diagramme')))
    const dosIdx = out.sections.findIndex((s) => s.title === 'Dos')
    const manchesIdx = out.sections.findIndex((s) => s.title === 'Manches')
    expect(out.sections[dosIdx + 1].kind).toBe('diagramme') // A juste après Dos
    expect(out.sections[manchesIdx + 1].kind).toBe('diagramme') // B juste après Manches
  })

  it('sections d’origine INTACTES (ids + step.imgs préservés, pas de re-normalisation)', () => {
    const out = promoteGridSections(reader(), [grid(1, 500, 'data:img,A')], pages())
    const dos = out.sections.find((s) => s.title === 'Dos')
    expect(dos.id).toBe('dos') // id inchangé
    expect(dos.steps[0].imgs).toEqual(['data:photo']) // step.imgs préservé (pas altéré)
  })

  it('id de diagramme dédupliqué contre un id existant collidant', () => {
    const r = reader()
    r.sections.push({ id: 'diagramme-1', kind: 'autre', title: 'Déjà pris', steps: [{ t: 'x' }] })
    const out = promoteGridSections(r, [grid(1, 500, 'data:img,A')], pages())
    const diag = out.sections.find((s) => s.kind === 'diagramme')
    expect(diag.id).not.toBe('diagramme-1') // collision évitée
    expect(diag.id).toBeTruthy()
  })

  it('grille sans ancre déterminable → ajoutée en fin de patron (rien perdu)', () => {
    // Grille en page 5 (au-delà de tout titre localisé) → afterIdx null → fin.
    const out = promoteGridSections(reader(), [grid(5, 100, 'data:img,Z')], pages())
    const last = out.sections[out.sections.length - 1]
    expect(last.kind).toBe('diagramme')
    expect(last.chart.img).toBe('data:img,Z')
  })
})

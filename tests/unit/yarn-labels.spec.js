import { describe, it, expect } from 'vitest'
import { YARN_LABELS, LABEL_GROUPS, ENGAGEMENTS, normalizeLabels } from '@/constants/yarn-labels'

describe('clés des caractéristiques', () => {
  it('en compte huit, réparties en deux groupes sans recouvrement', () => {
    expect(YARN_LABELS).toHaveLength(8)
    expect(LABEL_GROUPS.engagements).toHaveLength(4)
    expect(LABEL_GROUPS.certifications).toHaveLength(4)
    expect(YARN_LABELS).toEqual(['vegan', 'recyclee', 'ethique', 'sans-mulesing', 'oeko-tex', 'gots', 'rws', 'grs'])
  })

  it("n'expose comme icônes que les engagements", () => {
    // Les certifications restent dans la fiche : quatre sigles dessinés au trait à 16 px
    // seraient indiscernables (§ La liste).
    expect(ENGAGEMENTS).toEqual(['vegan', 'recyclee', 'ethique', 'sans-mulesing'])
  })
})

describe('normalizeLabels', () => {
  it('accepte null et un tableau', () => {
    expect(normalizeLabels(null)).toEqual([])
    expect(normalizeLabels('')).toEqual([])
    expect(normalizeLabels(['vegan', 'gots'])).toEqual(['vegan', 'gots'])
  })

  // La tolérance à l'ancienne saisie en chaîne a été retirée le 13/08/2026 (nettoyage avant la 1.0,
  // réserve produit acceptée) : une chaîne, même non vide, ne produit plus de découpage.
  it('renvoie [] pour une chaîne non vide (ancien format retiré, plus aucun découpage)', () => {
    expect(normalizeLabels('vegan, recyclee')).toEqual([])
  })

  it("dédoublonne en gardant le premier ordre d'apparition", () => {
    expect(normalizeLabels(['gots', 'vegan', 'gots'])).toEqual(['gots', 'vegan'])
  })

  it('ÉCARTE toute clé inconnue', () => {
    // Sans ce filtrage, AppIcon retomberait sur l'icône `pelote` (AppIcon.vue:15) et
    // afficherait une pelote de laine pour chaque valeur parasite, sans la moindre erreur.
    expect(normalizeLabels(['vegan', 'nimportequoi'])).toEqual(['vegan'])
    expect(normalizeLabels(['nimportequoi'])).toEqual([])
  })

  it('ignore la casse et les espaces autour', () => {
    expect(normalizeLabels([' Vegan ', 'GOTS'])).toEqual(['vegan', 'gots'])
  })
})

// Unitaire — politique de l'emplacement effectif (adoption d'un dossier de
// données, 06/09/2026). `decideBase` porte la règle à 4 branches extraite
// du natif (`computeBase`) : chaque cas pince une branche ou l'ORDRE entre
// branches (enfant « Rowtine » prioritaire sur les marqueurs), plus les refus
// d'adoption partielle (un marqueur seul ne revendique rien — hasBackup
// suffirait, l'adoption non) et de nature fausse (un FICHIER « Projets », un
// DOSSIER « reglages.json »).
import { describe, it, expect } from 'vitest'
import { PROBES, decideBase, composeLabel } from '@/backup/folder-base'

// Les deux marqueurs forts d'un vrai dossier de données : toute sauvegarde
// écrit `reglages.json` ET crée `Projets/`/`Patrons/` — cf. folder-base.js.
const DOSSIER_DATA = [
  { name: 'Projets', isDir: true },
  { name: 'reglages.json', isDir: false },
]

describe('PROBES', () => {
  it('vaut exactement la liste passée telle quelle au natif', () => {
    expect(PROBES).toEqual(['Rowtine', 'Projets', 'Patrons', 'reglages.json'])
  })
})

describe('decideBase', () => {
  // Branche 1 : le dossier choisi EST la base, casse ignorée.
  it('dossier nommé « Rowtine » → base vide', () => {
    expect(decideBase({ name: 'Rowtine', rowtineChildExists: false, probeHits: [] })).toBe('')
  })

  it('casse ignorée : « ROWTINE » et « rowtine » → base vide', () => {
    expect(decideBase({ name: 'ROWTINE', rowtineChildExists: false, probeHits: [] })).toBe('')
    expect(decideBase({ name: 'rowtine', rowtineChildExists: false, probeHits: [] })).toBe('')
  })

  // L'ordre 1 > 2 : un dossier « Rowtine » contenant un enfant « Rowtine »
  // reste pris tel quel — le nom plein l'emporte sur le sous-dossier.
  it('nommé « Rowtine » ET enfant présent : la branche 1 gagne', () => {
    expect(decideBase({ name: 'Rowtine', rowtineChildExists: true, probeHits: DOSSIER_DATA })).toBe('')
  })

  // Branche 2 : comportement historique, préserve les installations existantes.
  it('enfant « Rowtine » présent → base « Rowtine »', () => {
    expect(decideBase({ name: 'Documents', rowtineChildExists: true, probeHits: [] })).toBe('Rowtine')
  })

  // Ordre 2 > 3 : la présence de l'enfant tranche AVANT tout examen des
  // marqueurs — le sous-dossier historique reste la base même si le dossier
  // choisi porte aussi des marqueurs (ex. vieilles sauvegardes à la racine).
  it('enfant présent ET marqueurs complets : la branche 2 gagne', () => {
    expect(decideBase({ name: 'Documents', rowtineChildExists: true, probeHits: DOSSIER_DATA })).toBe('Rowtine')
  })

  // Branche 3 — ADOPTION : le cas d'une utilisatrice réelle (copie renommée « Rowtine2 »).
  it('reglages.json (fichier) + Projets (dossier) → adoption, base vide', () => {
    expect(decideBase({ name: 'Rowtine2', rowtineChildExists: false, probeHits: DOSSIER_DATA })).toBe('')
  })

  it('reglages.json (fichier) + Patrons (dossier) suffit aussi', () => {
    expect(
      decideBase({
        name: 'Rowtine2',
        rowtineChildExists: false,
        probeHits: [
          { name: 'Patrons', isDir: true },
          { name: 'reglages.json', isDir: false },
        ],
      })
    ).toBe('')
  })

  // Marqueurs partiels refusés : la revendication exige les deux preuves.
  it('reglages.json seul → pas d\'adoption', () => {
    expect(
      decideBase({ name: 'Documents', rowtineChildExists: false, probeHits: [{ name: 'reglages.json', isDir: false }] })
    ).toBe('Rowtine')
  })

  it('Projets (dossier) seul → pas d\'adoption', () => {
    expect(
      decideBase({ name: 'Documents', rowtineChildExists: false, probeHits: [{ name: 'Projets', isDir: true }] })
    ).toBe('Rowtine')
  })

  // `laines.json` compte pour `hasBackup` (restore.js:44) mais PAS pour
  // l'adoption : les deux prédicats restent distincts — pin que la liste
  // large de hasBackup ne fuit pas dans la revendication.
  it('laines.json seul → pas d\'adoption', () => {
    expect(
      decideBase({ name: 'Documents', rowtineChildExists: false, probeHits: [{ name: 'laines.json', isDir: false }] })
    ).toBe('Rowtine')
  })

  // « Rowtine » est une sonde STRUCTURELLE, pas un marqueur de données : son
  // hit ne participe JAMAIS à la preuve d'adoption (branche 3).
  it('hit « Rowtine » dans probeHits seul → pas d\'adoption', () => {
    expect(
      decideBase({ name: 'Documents', rowtineChildExists: false, probeHits: [{ name: 'Rowtine', isDir: true }] })
    ).toBe('Rowtine')
  })

  // Nature fausse refusée : les types attendus (dossiers Projets/Patrons,
  // fichier reglages.json) font partie de la preuve.
  it('un FICHIER nommé « Projets » ne fait pas la preuve', () => {
    expect(
      decideBase({
        name: 'Documents',
        rowtineChildExists: false,
        probeHits: [
          { name: 'Projets', isDir: false },
          { name: 'reglages.json', isDir: false },
        ],
      })
    ).toBe('Rowtine')
  })

  it('un DOSSIER nommé « reglages.json » ne fait pas la preuve', () => {
    expect(
      decideBase({
        name: 'Documents',
        rowtineChildExists: false,
        probeHits: [
          { name: 'Projets', isDir: true },
          { name: 'reglages.json', isDir: true },
        ],
      })
    ).toBe('Rowtine')
  })

  // Branche 4 : rien de reconnu → sous-dossier « Rowtine » créé au confirm.
  it('dossier vierge → base « Rowtine »', () => {
    expect(decideBase({ name: 'Documents', rowtineChildExists: false, probeHits: [] })).toBe('Rowtine')
  })

  it('name null (dossier vierge) → base « Rowtine », sans crash', () => {
    expect(decideBase({ name: null, rowtineChildExists: false, probeHits: [] })).toBe('Rowtine')
  })
})

describe('composeLabel', () => {
  it('base vide : le libellé est le nom seul', () => {
    expect(composeLabel('Rowtine', '')).toBe('Rowtine')
    expect(composeLabel('Rowtine2', '')).toBe('Rowtine2')
  })

  it('base « Rowtine » : le libellé est le chemin effectif', () => {
    expect(composeLabel('Documents', 'Rowtine')).toBe('Documents/Rowtine')
  })
})

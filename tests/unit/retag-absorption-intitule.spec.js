// @vitest-environment jsdom
// Le faux titre résiduel (constaté le 20/08/2026 sur le Huawei, patron réel
// `Harlow_Sweater_FR`). Quand l'import a laissé un intitulé en TEXTE BRUT (« Abréviations »,
// « Conseils »…) suivi de son contenu, sélectionner le CONTENU et le taguer créait bien le
// bloc — mais la ligne d'intitulé, hors sélection, restait en place : le patron affichait le
// mot deux fois, le faux titre hérité de l'import et le vrai titre de rubrique.
//
// Arbitrage produit du 20/08/2026, piste (a) : la ligne est ABSORBÉE quand son slug désigne
// EXACTEMENT la rubrique visée. Rien ne se perd au sens de la règle cardinale — le mot est
// réémis à l'identique comme titre de rubrique par `referenceBlocksToMd`. Même logique que la
// garde déjà en place sur un titre de rubrique TAGUÉ (`## Matériel {materials}` écarté d'une
// sélection reversée vers Fil, cf. retag-selection-reference.spec.js) : ici c'est le même mot,
// en texte brut.
import { describe, it, expect, afterEach } from 'vitest'
import { retagSelection, mergeIntoReference } from '@/utils/pattern-md/md-retag-selection'
import { createCmEditor } from '@/components/cm/cm-editor'
import { mdToPattern } from '@/utils/pattern-md/parse'
import fr from '@/i18n/fr.json'

// Filet de sécurité : un popover resté ouvert ne doit jamais fuiter vers le test suivant
// (cf. gesture ci-dessous — la puce « Aide mémoire » ouvre un popover générique,
// openMenuPopover, au lieu d'un <select>).
afterEach(() => {
  document.querySelectorAll('.cm-menu-popover, .cm-menu-popover-scrim').forEach((el) => el.remove())
})

// Applique les `changes` sur le texte, comme le ferait CodeMirror.
const apply = (text, changes) => {
  let out = ''
  let cursor = 0
  for (const c of changes) {
    out += text.slice(cursor, c.from) + c.insert
    cursor = c.to
  }
  return out + text.slice(cursor)
}

const FM = '---\nrowtine: 1\n---\n\n'

// Compte les occurrences d'un mot, titre de rubrique COMPRIS : c'est précisément le doublon
// que ce lot supprime, donc on vérifie le nombre, pas seulement l'absence.
const countOf = (text, word) => text.split(word).length - 1

describe('absorption du faux titre — création du bloc', () => {
  it('la ligne d\'intitulé nue au-dessus de la sélection est absorbée, le mot n\'apparaît qu\'une fois', () => {
    const doc = 'Abréviations\n\nm - maille(s)\naug - augmenter'
    const { changes } = retagSelection(doc, 3, 4, 'reference', { tag: 'abbreviations' })
    const out = apply(doc, changes)
    expect(out).toContain('## Abréviations {abbreviations}')
    expect(countOf(out, 'Abréviations')).toBe(1)
  })

  it('le mot absorbé ne devient PAS une entrée de contenu', () => {
    const doc = 'Abréviations\n\nm - maille(s)\naug - augmenter'
    const { changes } = retagSelection(doc, 3, 4, 'reference', { tag: 'abbreviations' })
    const res = mdToPattern(FM + apply(doc, changes))
    expect(res.pattern.reader.reference.abbr).toEqual({ m: 'maille(s)', aug: 'augmenter' })
  })

  it('absorbe une ligne d\'intitulé COLLÉE à la sélection (aucune ligne blanche entre les deux)', () => {
    const doc = 'Conseils\n- Blocage à froid\n- Coutures au point arrière'
    const { changes } = retagSelection(doc, 2, 3, 'reference', { tag: 'tips' })
    const out = apply(doc, changes)
    expect(out).toContain('## Conseils {tips}')
    expect(countOf(out, 'Conseils')).toBe(1)
  })

  it('absorbe malgré la casse, les accents manquants et le deux-points final', () => {
    const doc = 'ABREVIATIONS :\n\nm - maille(s)'
    const { changes } = retagSelection(doc, 3, 3, 'reference', { tag: 'abbreviations' })
    const out = apply(doc, changes)
    expect(out).toContain('## Abréviations {abbreviations}')
    expect(out).not.toContain('ABREVIATIONS')
  })

  it('n\'absorbe PAS un intitulé qui désigne une AUTRE rubrique', () => {
    const doc = 'Matériel\n\nm - maille(s)'
    const { changes } = retagSelection(doc, 3, 3, 'reference', { tag: 'abbreviations' })
    const out = apply(doc, changes)
    expect(out).toContain('Matériel')
  })

  it('n\'absorbe PAS une ligne de texte ordinaire', () => {
    const doc = 'Monter 90 mailles sur aiguilles 4 mm\n\nm - maille(s)'
    const { changes } = retagSelection(doc, 3, 3, 'reference', { tag: 'abbreviations' })
    const out = apply(doc, changes)
    expect(out).toContain('Monter 90 mailles sur aiguilles 4 mm')
  })

  it('n\'absorbe PAS un intitulé élargi qui n\'est plus la rubrique (« Abréviations et symboles »)', () => {
    const doc = 'Abréviations et symboles\n\nm - maille(s)'
    const { changes } = retagSelection(doc, 3, 3, 'reference', { tag: 'abbreviations' })
    const out = apply(doc, changes)
    expect(out).toContain('Abréviations et symboles')
  })

  it('n\'absorbe PAS un titre de SECTION de travail, même si son nom désigne une rubrique', () => {
    const doc = '## Abréviations {body}\n\n- Rang 1 : monter 90 m'
    const { changes } = retagSelection(doc, 3, 3, 'reference', { tag: 'abbreviations' })
    const out = apply(doc, changes)
    expect(out).toContain('## Abréviations {body}')
  })

  it('n\'absorbe PAS par-dessus une ligne de contenu intercalée', () => {
    const doc = 'Abréviations\n\nVoici la liste utilisée dans ce patron.\n\nm - maille(s)'
    const { changes } = retagSelection(doc, 5, 5, 'reference', { tag: 'abbreviations' })
    const out = apply(doc, changes)
    expect(countOf(out, 'Abréviations')).toBe(2)
    expect(out).toContain('Voici la liste utilisée dans ce patron.')
  })

  it('rien à absorber en tête de document : la sélection est traitée telle quelle', () => {
    const doc = 'm - maille(s)\naug - augmenter'
    const { changes } = retagSelection(doc, 1, 2, 'reference', { tag: 'abbreviations' })
    const out = apply(doc, changes)
    expect(out).toContain('## Abréviations {abbreviations}')
    expect(out).toContain('maille(s)')
  })

  // Masquage des sous-titres `###` : `lineType` distingue désormais `### Titre` de
  // `texte` (nouveau type `sous-titre`). Sans élargir `isBareLabelFor`, ce faux titre résiduel
  // ne serait plus reconnu comme un intitulé nu absorbable — régression du mécanisme ci-dessus,
  // simplement déclenchée par un `###` au lieu d'un `#`. Preuve que l'élargissement à
  // `TYPES_INTITULE_NU` (md-retag-selection.js) tient : le comportement observé est identique
  // à celui du cas `Abréviations` nu plus haut, dièses en plus.
  it('absorbe un intitulé résiduel PORTANT des dièses résiduelles (### Abréviations) comme un intitulé nu', () => {
    const doc = '### Abréviations\n\nm - maille(s)\naug - augmenter'
    const { changes } = retagSelection(doc, 3, 4, 'reference', { tag: 'abbreviations' })
    const out = apply(doc, changes)
    expect(out).toContain('## Abréviations {abbreviations}')
    expect(countOf(out, 'Abréviations')).toBe(1)
  })

  // Même propriété que « idempotent : requalifier deux fois… » de
  // retag-selection-reference.spec.js — la sélection reprend le bloc ENTIER, titre compris.
  // `retagSelection` seul ne fusionne pas (c'est `applyRetag` qui essaie d'abord
  // `mergeIntoReference`) : rejouer sur le seul corps créerait un second bloc, et c'est le
  // comportement documenté. Ce qu'on vérifie ici, c'est que l'absorption ne s'ajoute pas à ça.
  it('idempotent : rejouer le geste sur le bloc entier obtenu ne réintroduit aucun doublon', () => {
    const doc = 'Abréviations\n\nm - maille(s)'
    const once = apply(doc, retagSelection(doc, 3, 3, 'reference', { tag: 'abbreviations' }).changes)
    const lines = once.split('\n').length
    const twice = apply(once, retagSelection(once, 1, lines, 'reference', { tag: 'abbreviations' }).changes)
    expect(countOf(twice, 'Abréviations')).toBe(1)
    expect(twice).toContain('maille(s)')
  })
})

describe('absorption du faux titre — fusion dans un bloc existant', () => {
  it('la ligne d\'intitulé nue est absorbée elle aussi quand la sélection rejoint un bloc déjà posé', () => {
    const doc = '## Abréviations {abbreviations}\n\n| m | maille(s) |\n\nAbréviations\n\naug - augmenter'
    const { changes } = mergeIntoReference(doc, 7, 7, { tag: 'abbreviations' })
    const out = apply(doc, changes)
    expect(countOf(out, 'Abréviations')).toBe(1)
  })

  it('la fusion garde les deux entrées après absorption', () => {
    const doc = '## Abréviations {abbreviations}\n\n| m | maille(s) |\n\nAbréviations\n\naug - augmenter'
    const { changes } = mergeIntoReference(doc, 7, 7, { tag: 'abbreviations' })
    const res = mdToPattern(FM + apply(doc, changes))
    expect(res.pattern.reader.reference.abbr).toEqual({ m: 'maille(s)', aug: 'augmenter' })
  })

  // La portée balayée par `findReferenceBlock` court jusqu'au prochain H2 : un intitulé
  // résiduel posé APRÈS le bloc tombe donc dans son corps, et revient par le corps RÉÉMIS —
  // pas par la coupe. La coupe ne peut pas s'en charger (elle chevaucherait la plage du bloc,
  // et `ChangeSet.of` lève sur des plages qui se chevauchent) : c'est le filtre du corps qui
  // le traite. La fusion se fait quand même, et rien ne se perd.
  it('l\'intitulé résiduel tombé DANS la portée du bloc cible est absorbé lui aussi, sans empêcher la fusion', () => {
    const doc = '## Conseils {tips}\n\nConseils\n- Coutures au point arrière'
    const { changes } = mergeIntoReference(doc, 4, 4, { tag: 'tips' })
    expect(changes.length).toBeGreaterThan(0)
    const out = apply(doc, changes)
    expect(countOf(out, 'Conseils')).toBe(1)
    expect(out).toContain('Coutures au point arrière')
  })
})

// Les deux blocs ci-dessus testent chacun UNE fonction. Le geste réel, lui, est une
// COMPOSITION : `applyRetag` (cm-editor.js) tente d'abord `mergeIntoReference`, et ne retombe
// sur `retagSelection` que si la fusion ne renvoie rien. Les deux calculent leur plage de
// coupe différemment — c'est exactement la classe de défaut qui revient à répétition
// (« deux composants corrects séparément »). On monte donc l'éditeur RÉEL et on actionne le
// menu de la barre, comme le ferait un doigt.
describe('absorption du faux titre — le geste réel, de la barre au document', () => {
  const gesture = (doc, fromLine, toLine, tag) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createCmEditor(host, { value: doc })
    const offsetOf = (n) => doc.split('\n').slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0)
    const head = offsetOf(toLine) + doc.split('\n')[toLine - 1].length
    editor.view.dispatch({ selection: { anchor: offsetOf(fromLine), head } })
    // La puce « Aide mémoire » ouvre un popover (openMenuPopover) au lieu d'un
    // <select> — clic sur la puce, puis sur l'item portant le libellé FR de `tag`.
    editor.toolbar.querySelector('.cm-retag-ref').click()
    const label = fr.correction.toolbar[tag]
    const item = [...document.querySelectorAll('.cm-menu-popover__item')].find((b) => b.textContent === label)
    item.click()
    const out = editor.getValue()
    host.remove()
    return out
  }

  // Le cas que ni la création ni la fusion ne couvraient seules : la rubrique existe DÉJÀ
  // ailleurs (donc `applyRetag` prend la voie fusion) et le faux titre est HORS de la portée
  // balayée du bloc cible (donc il ne peut pas partir par le corps réémis — c'est la coupe
  // élargie qui doit s'en charger).
  it('rubrique déjà posée AILLEURS et faux titre hors de sa portée : le mot ne reste pas en double', () => {
    const doc =
      '## Abréviations {abbreviations}\n\n| m | maille(s) |\n\n## Corps {body}\n\n- Rang 1 : monter 90 m\n\nAbréviations\n\naug - augmenter'
    const out = gesture(doc, 11, 11, 'abbreviations')
    expect(countOf(out, 'Abréviations')).toBe(1)
  })

  it('… et rien du patron ne se perd au passage', () => {
    const doc =
      '## Abréviations {abbreviations}\n\n| m | maille(s) |\n\n## Corps {body}\n\n- Rang 1 : monter 90 m\n\nAbréviations\n\naug - augmenter'
    const out = gesture(doc, 11, 11, 'abbreviations')
    expect(out).toContain('## Corps {body}')
    expect(out).toContain('- Rang 1 : monter 90 m')
    const res = mdToPattern(FM + out)
    expect(res.pattern.reader.reference.abbr).toEqual({ m: 'maille(s)', aug: 'augmenter' })
  })

  // Voie création par le geste réel (aucune rubrique existante) : `applyRetag` retombe sur
  // `retagSelection`. Les deux voies doivent donner le même résultat visible.
  it('aucune rubrique existante : le geste réel absorbe aussi, par la voie création', () => {
    const doc = 'Conseils\n\n- Blocage à froid\n- Coutures au point arrière'
    const out = gesture(doc, 3, 4, 'tips')
    expect(out).toContain('## Conseils {tips}')
    expect(countOf(out, 'Conseils')).toBe(1)
    expect(out).toContain('Blocage à froid')
  })
})

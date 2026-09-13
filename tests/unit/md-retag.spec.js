// Verrou de comportement AVANT déplacement du moteur pur de retag (Task A1,
// moteur unique) : {md-line-type,md-retag,md-retag-selection}.js quittent l'outillage de dev
// → src/utils/pattern-md/. Importe depuis le NOUVEAU chemin @/utils/pattern-md/…
// Aucun comportement nouveau ici, seulement la préservation de l'existant.
import { describe, it, expect } from 'vitest'
import { lineType } from '@/utils/pattern-md/md-line-type'
import { retagLine, stripMarkup } from '@/utils/pattern-md/md-retag'
import { retagSelection } from '@/utils/pattern-md/md-retag-selection'
import { isTableSep, isPipeLine, reservedKey } from '@/utils/pattern-md/refblocks'

describe('lineType', () => {
  it('classe un rang (puce)', () => {
    expect(lineType('- Rang 1 : 3 m')).toBe('rang')
  })
  it('classe une note (citation)', () => {
    expect(lineType('> une note')).toBe('note')
  })
  it('classe une section générique (titre nu)', () => {
    expect(lineType('## Corps')).toBe('section')
  })
  it('classe un titre {kind} de travail connu comme section (pas reference)', () => {
    expect(lineType('## Manches {sleeve}')).toBe('section')
  })
  it('classe un bloc référence balisé EN comme reference', () => {
    expect(lineType('## Abréviations {abbreviations}')).toBe('reference')
  })
  it('classe un titre réservé historique (sans balise) comme reference', () => {
    expect(lineType('## Fournitures')).toBe('section') // 'fournitures' n'est pas une clé réservée
    expect(lineType('## Échantillon')).toBe('reference') // slug 'echantillon' est réservé
  })
  it('classe une image', () => {
    expect(lineType('![alt](src.png)')).toBe('image')
  })
  it('classe un compteur (préfixe {×N} ou {cadence…})', () => {
    expect(lineType('- {×3} m end')).toBe('compteur')
    expect(lineType('- {cadence 2×4} m end')).toBe('compteur')
  })
  it('classe le texte nu', () => {
    expect(lineType('juste du texte')).toBe('texte')
  })
  it('classe un sous-titre de technique (###) comme sous-titre, pas comme reference', () => {
    // Émis par refblocks.js pour chaque technique d'un bloc `## Techniques {techniques}` :
    // masquer le `###` en vue enrichie suppose de le distinguer du texte nu.
    expect(lineType('### Croiser une torsade vers la gauche')).toBe('sous-titre')
  })
  it('non-régression : un titre reference {techniques} reste reference malgré le ###', () => {
    expect(lineType('## Techniques {techniques}')).toBe('reference')
  })
  it('non-régression : quatre dièses ne sont pas un sous-titre', () => {
    expect(lineType('#### profond')).toBe('texte')
  })
  it('classe une rangée de tableau (abréviations, tailles) comme tableau', () => {
    // Les deux émetteurs de refblocks.js : `| abr. | définition |` (abréviations) et
    // `| mesure | S | M | L |` (tailles). Les rendre en vraie <table> suppose
    // d'abord de les distinguer du texte nu.
    expect(lineType('| abr. | définition |')).toBe('tableau')
    expect(lineType('| mesure | S | M | L |')).toBe('tableau')
  })
  it('classe la ligne séparatrice comme tableau elle aussi', () => {
    // Même type de ligne : c'est `isTableSep` (ci-dessous) qui la distingue d'une rangée,
    // pas `lineType` — un `md-tableau-separateur` créerait une catégorie de plus dans
    // `lineClass`/la barre pour une ligne qui n'est jamais affichée séparément.
    expect(lineType('|------|------------|')).toBe('tableau')
    expect(lineType('|---|---|---|---|')).toBe('tableau')
  })
  it('garde : une phrase contenant un tuyau reste du texte', () => {
    expect(lineType('un texte avec un | tuyau')).toBe('texte')
    // Ni barre en tête, ni barre en fin : les deux sont exigées.
    expect(lineType('| début seulement')).toBe('texte')
    expect(lineType('fin seulement |')).toBe('texte')
    // Une barre isolée n'est pas une rangée (il en faut deux : ouvrante et fermante).
    expect(lineType('|')).toBe('texte')
  })
  it('équivalence verrouillée : isPipeLine(l) ⟺ lineType(l) === "tableau"', () => {
    // `buildTableDecorations` (cm-editor.js) teste l'appartenance à un bloc de tableau avec
    // `isPipeLine`, pas avec `lineType`, parce qu'il repasse sur le document ENTIER à chaque
    // frappe (mesure dans le commentaire de la fonction). C'est légitime tant que les deux
    // restent équivalents : aucune branche ANTÉRIEURE de `lineType` ne peut matcher une
    // ligne qui commence par une barre. Ce test tombe le jour où ce ne serait plus vrai —
    // sans lui, l'éditeur masquerait derrière un widget une ligne que `lineType` classe
    // autrement, ou l'inverse.
    const echantillon = [
      '| a | b |',
      '|---|---|',
      '|  |  |',
      '## Corps',
      '## Abréviations {abbreviations}',
      '### Jeté',
      '#### profond',
      '![alt](src.png)',
      '> une note',
      '- Rang 1',
      '- {×3} m end',
      'juste du texte',
      'un texte avec un | tuyau',
      '|',
      '',
    ]
    for (const l of echantillon) {
      expect(`${l} -> ${isPipeLine(l)}`).toBe(`${l} -> ${lineType(l) === 'tableau'}`)
    }
  })
  it('isTableSep distingue la séparatrice d’une rangée de données', () => {
    expect(isTableSep('|---|---|')).toBe(true)
    expect(isTableSep('| :--- | ---: |')).toBe(true)
    expect(isTableSep('| abr. | définition |')).toBe(false)
  })
  it('`tableau` n’a pas à rejoindre isBareLabelFor : le prédicat est déjà faux', () => {
    // `isBareLabelFor` (md-retag-selection.js) est le SEUL comparateur direct
    // de `lineType` à `'texte'` ; cet ajustement avait dû y ajouter `'sous-titre'` parce qu'un
    // `### Abréviations` EST un intitulé réservé résiduel. Pas ici : une rangée de tableau
    // ne se slugifie sur aucune clé réservée, donc la seconde moitié de la conjonction
    // (`reservedKey(...) === key`) est fausse quoi qu'il arrive — l'élargir ne changerait
    // rien et ouvrirait la porte à l'absorption d'une vraie rangée de données.
    expect(reservedKey('| abr. | définition |')).toBeNull()
    expect(reservedKey('| mesure | S | M | L |')).toBeNull()
  })
})

describe('stripMarkup', () => {
  it('retire la puce de rang', () => {
    expect(stripMarkup('- 3 m end')).toBe('3 m end')
  })
  it('retire le chevron de note', () => {
    expect(stripMarkup('> une note')).toBe('une note')
  })
  it('retire le titre nu de section', () => {
    expect(stripMarkup('## Corps')).toBe('Corps')
  })
  it('retire le {kind} du titre de section', () => {
    expect(stripMarkup('## Manches {sleeve}')).toBe('Manches')
  })
  it('retire la balise reference du titre', () => {
    expect(stripMarkup('## Abréviations {abbreviations}')).toBe('Abréviations')
  })
  it('retire le préfixe compteur {×N}', () => {
    expect(stripMarkup('- {×3} m end')).toBe('m end')
  })
  it('laisse une image inchangée (hors périmètre)', () => {
    expect(stripMarkup('![alt](src.png)')).toBe('![alt](src.png)')
  })
  it('laisse le texte nu inchangé', () => {
    expect(stripMarkup('juste du texte')).toBe('juste du texte')
  })
})

describe('retagLine', () => {
  it('vers rang', () => {
    expect(retagLine('> une note', 'rang')).toBe('- une note')
  })
  it('vers note', () => {
    expect(retagLine('- x', 'note')).toBe('> x')
  })
  it('vers section générique (kind défaut pelote : pas de {attr})', () => {
    expect(retagLine('- Corps', 'section', { kind: 'pelote' })).toBe('## Corps')
  })
  it('vers section avec kind non défaut (balise EN anglicisée)', () => {
    expect(retagLine('- Manches', 'section', { kind: 'manche' })).toBe('## Manches {sleeve}')
  })
  it('vers section sans opts (kind non fourni = pas de {attr})', () => {
    expect(retagLine('- Corps', 'section')).toBe('## Corps')
  })
  it('vers reference (tag EN déjà résolu, émis tel quel)', () => {
    expect(retagLine('- Abréviations', 'reference', { tag: 'abbreviations' })).toBe(
      '## Abréviations {abbreviations}'
    )
  })
  it('vers compteur-rep', () => {
    expect(retagLine('- 3 m end', 'compteur-rep', { times: 4 })).toBe('- {×4} 3 m end')
  })
  it('vers compteur-cadence', () => {
    expect(retagLine('- 3 m end', 'compteur-cadence', { every: 2, times: 5 })).toBe(
      '- {cadence 2×5} 3 m end'
    )
  })
  it('vers texte (dé-balisage)', () => {
    expect(retagLine('- 3 m end', 'texte')).toBe('3 m end')
  })
  it('idempotence : re-tag rang→rang stable', () => {
    expect(retagLine(retagLine('texte', 'rang'), 'rang')).toBe('- texte')
  })
  it('idempotence : re-tag section→section stable (kind conservé)', () => {
    const once = retagLine('Manches', 'section', { kind: 'manche' })
    expect(retagLine(once, 'section', { kind: 'manche' })).toBe(once)
  })
})

describe('retagSelection', () => {
  it('requalifie une plage de lignes 1-based en changements CM6 { from, to, insert }', () => {
    const doc = '- rang 1\n- rang 2\n> une note'
    const { changes } = retagSelection(doc, 2, 3, 'rang')
    expect(changes).toEqual([
      { from: 9, to: 17, insert: '- rang 2' },
      { from: 18, to: 28, insert: '- une note' },
    ])
  })
  it("clampe les bornes sur les lignes réellement présentes", () => {
    const doc = '- seule ligne'
    const { changes } = retagSelection(doc, 1, 99, 'note')
    expect(changes).toEqual([{ from: 0, to: 13, insert: '> seule ligne' }])
  })
})

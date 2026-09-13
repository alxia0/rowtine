// Cible de la fusion : quand une rubrique existe déjà dans le document, la nouvelle
// sélection la rejoint au lieu de créer un second bloc. Le piège est la `demotedSection`
// (`## Fil (texte conservé) {other}` — ANCIEN format, patrons antérieurs au lot « clé
// stable » ; `## yarn-notes {other}` — format ACTUEL, cf. parse.js) : la fusionner
// ré-enclencherait exactement la destruction que le tag {other} a été posé pour empêcher.
// Les DEUX formes doivent rester protégées : l'ancienne parce que des patrons déjà sur
// disque la portent encore, l'actuelle parce que c'est ce que `demotedSection` émet
// aujourd'hui.
import { describe, it, expect } from 'vitest'
import { findReferenceBlock } from '@/utils/pattern-md/find-reference-block'
import { mergeIntoReference } from '@/utils/pattern-md/md-retag-selection'
import { mdToPattern } from '@/utils/pattern-md/parse'

describe('findReferenceBlock', () => {
  it('trouve un bloc balisé', () => {
    const doc = '## Corps {body}\n\n- Rang 1\n\n## Fil {yarn}\n\nCoton DK\n'
    expect(findReferenceBlock(doc, 'yarn')).toEqual({ titleLine: 5, endLine: 7 })
  })

  it('trouve un titre réservé NU (compat FR héritée)', () => {
    const doc = '## Fil\n\nCoton DK\n'
    expect(findReferenceBlock(doc, 'yarn')).toEqual({ titleLine: 1, endLine: 3 })
  })

  it('ne prend JAMAIS une section rétrogradée {other} pour cible (ANCIEN format legacy)', () => {
    const doc = '## Fil (texte conservé) {other}\n\n> Coton DK\n'
    expect(findReferenceBlock(doc, 'yarn')).toBeNull()
  })

  it('ne prend JAMAIS une section rétrogradée {other} pour cible (format ACTUEL, `${key}-notes`)', () => {
    const doc = '## yarn-notes {other}\n\n> Coton DK\n'
    expect(findReferenceBlock(doc, 'yarn')).toBeNull()
  })

  it('ne prend JAMAIS un kind de travail pour cible', () => {
    const doc = '## Aiguilles {sleeve}\n\n- Rang 1\n'
    expect(findReferenceBlock(doc, 'needles')).toBeNull()
  })

  it('ne confond pas deux rubriques différentes', () => {
    const doc = '## Fil {yarn}\n\nCoton DK\n'
    expect(findReferenceBlock(doc, 'needles')).toBeNull()
  })

  it('s\'arrête au titre suivant', () => {
    const doc = '## Fil {yarn}\n\nCoton DK\n\n## Corps {body}\n\n- Rang 1\n'
    expect(findReferenceBlock(doc, 'yarn')).toEqual({ titleLine: 1, endLine: 3 })
  })

  it('bloc à corps vide : endLine est la ligne du titre', () => {
    const doc = '## Fil {yarn}\n\n## Corps {body}\n'
    expect(findReferenceBlock(doc, 'yarn')).toEqual({ titleLine: 1, endLine: 1 })
  })

  it('renvoie le PREMIER bloc quand il y en a deux', () => {
    const doc = '## Fil {yarn}\n\nCoton DK\n\n## Fil {yarn}\n\nLin\n'
    expect(findReferenceBlock(doc, 'yarn')).toEqual({ titleLine: 1, endLine: 3 })
  })

  it('renvoie null quand la rubrique est absente', () => {
    expect(findReferenceBlock('## Corps {body}\n\n- Rang 1\n', 'yarn')).toBeNull()
  })
})

const apply = (text, changes) => {
  let out = ''
  let cursor = 0
  for (const c of changes) {
    out += text.slice(cursor, c.from) + c.insert
    cursor = c.to
  }
  return out + text.slice(cursor)
}

describe('mergeIntoReference', () => {
  it('verse la sélection dans le bloc existant et la retire de sa place', () => {
    const doc = '## Fil {yarn}\n\nCoton DK\n\n3 pelotes de contraste'
    // La ligne 5 est sélectionnée, le bloc Fil existe aux lignes 1-3.
    const { changes } = mergeIntoReference(doc, 5, 5, { tag: 'yarn' })
    const out = apply(doc, changes)
    // Un SEUL bloc Fil, portant les deux contenus.
    expect(out.match(/## Fil \{yarn\}/g)).toHaveLength(1)
    expect(out).toContain('Coton DK')
    expect(out).toContain('3 pelotes de contraste')

    const res = mdToPattern('---\nrowtine: 1\n---\n\n' + out)
    const tab = res.pattern.reader.reference.tabs.find((t) => t.id === 'materiel')
    const bloc = tab.blocks.find((b) => b.h3Key === 'reader.reference.h3.yarn')
    expect(bloc.p.join(' ')).toContain('Coton DK')
    expect(bloc.p.join(' ')).toContain('3 pelotes de contraste')
  })

  it('produit deux changements triés par offset croissant', () => {
    const doc = '## Fil {yarn}\n\nCoton DK\n\n3 pelotes'
    const { changes } = mergeIntoReference(doc, 5, 5, { tag: 'yarn' })
    expect(changes).toHaveLength(2)
    expect(changes[0].from).toBeLessThan(changes[1].from)
  })

  it('ne reprend PAS le titre du bloc comme contenu', () => {
    const doc = '## Fil {yarn}\n\nCoton DK\n\n3 pelotes'
    const out = apply(doc, mergeIntoReference(doc, 5, 5, { tag: 'yarn' }).changes)
    const res = mdToPattern('---\nrowtine: 1\n---\n\n' + out)
    const tab = res.pattern.reader.reference.tabs.find((t) => t.id === 'materiel')
    const bloc = tab.blocks.find((b) => b.h3Key === 'reader.reference.h3.yarn')
    // Le mot « Fil » ne doit pas redescendre en contenu du bloc.
    expect(bloc.p.join('\n').split('\n')).not.toContain('Fil')
  })

  it('renvoie zéro changement quand aucun bloc cible n\'existe', () => {
    expect(mergeIntoReference('Coton DK', 1, 1, { tag: 'yarn' }).changes).toEqual([])
  })

  // Revue finale (I4) : le titre d'un bloc de référence est filtré de la sélection (voulu),
  // mais le corps du bloc CIBLE suffisait à produire un résultat non nul — le second
  // changement supprimait donc quand même la ligne sélectionnée. Taper sur la seule ligne
  // `## Matériel {materials}` puis cliquer « Fil » faisait disparaître la rubrique Matériel,
  // son contenu se raccrochant à Fil au reparse, sans un mot. Le chemin CRÉATION, lui, ne
  // fait rien sur ce même geste : les deux chemins doivent s'accorder.
  it('sélection réduite à un titre de rubrique : zéro changement, la ligne survit', () => {
    const doc = '## Matériel {materials}\n\n- 3 pelotes\n\n## Fil {yarn}\n\nCoton DK'
    expect(mergeIntoReference(doc, 1, 1, { tag: 'yarn' }).changes).toEqual([])
  })

  it('sélection réduite à une ligne blanche : zéro changement', () => {
    const doc = '## Fil {yarn}\n\nCoton DK\n\n\n'
    expect(mergeIntoReference(doc, 5, 5, { tag: 'yarn' }).changes).toEqual([])
  })

  it('une vraie ligne de contenu reste fusionnée (non-régression de la garde I4)', () => {
    const doc = '## Matériel {materials}\n\n- 3 pelotes\n\n## Fil {yarn}\n\nCoton DK\n\nLin fingering'
    const { changes } = mergeIntoReference(doc, 9, 9, { tag: 'yarn' })
    expect(changes).toHaveLength(2)
    const out = apply(doc, changes)
    expect(out).toContain('Lin fingering')
    expect(out).toContain('## Matériel {materials}')
  })

  it('renvoie zéro changement quand la sélection couvre déjà le bloc cible', () => {
    const doc = '## Fil {yarn}\n\nCoton DK'
    expect(mergeIntoReference(doc, 1, 3, { tag: 'yarn' }).changes).toEqual([])
  })

  it('fusionne un bloc situé APRÈS la sélection', () => {
    const doc = '3 pelotes de contraste\n\n## Fil {yarn}\n\nCoton DK'
    const out = apply(doc, mergeIntoReference(doc, 1, 1, { tag: 'yarn' }).changes)
    expect(out.match(/## Fil \{yarn\}/g)).toHaveLength(1)
    expect(out).toContain('3 pelotes de contraste')
    expect(out).toContain('Coton DK')
  })

  it('fusionne dans une TABLE existante sans la casser', () => {
    const doc = `## Tailles {measurements}

| mesure | S | M | L |
|---|---|---|---|
| Tour de poitrine | 74 | 82 | 90 |

Longueur totale 55 (58) 61`
    const { changes } = mergeIntoReference(doc, 7, 7, {
      tag: 'measurements',
      sizeLabels: ['S', 'M', 'L'],
    })
    const out = apply(doc, changes)
    const res = mdToPattern('---\nrowtine: 1\nsizes: S · M · L\n---\n\n' + out)
    expect(res.warnings).toEqual([])
    const rows = res.pattern.reader.reference.tabs
      .find((t) => t.id === 'tailles').blocks[0].sizeTable.rows
    expect(rows).toEqual([
      { label: 'Tour de poitrine', values: ['74', '82', '90'] },
      { label: 'Longueur totale', values: ['55', '58', '61'] },
    ])
  })

  // Correctif de revue : le corps existant d'un bloc Techniques porte déjà un ou
  // plusieurs titres `### Titre`, que stripMarkup laisse passer tels quels (seuls les `##`
  // sont reconnus). Sans traitement dédié, la ligne fraîchement sélectionnée (qui ne porte
  // pas encore de `###`) se retrouvait absorbée dans le corps de la DERNIÈRE technique
  // existante au lieu de devenir sa propre entrée, et le titre existant pouvait même se
  // retrouver doublé (`### ### Jeté`). Les deux tests suivants vérifient bout en bout,
  // via un reparse (pas seulement l'allure de la chaîne produite).
  it('fusionne dans un bloc Techniques contenant UNE technique existante : deux techniques distinctes, aucun titre double', () => {
    const doc = '## Techniques {techniques}\n\n### Jete\n\nExplication du jete.\n\nMontage tubulaire'
    const { changes } = mergeIntoReference(doc, 7, 7, { tag: 'techniques' })
    const out = apply(doc, changes)
    // Pas de titre double : jamais deux `###` colles.
    expect(out).not.toMatch(/###\s*###/)
    expect(out.match(/^### /gm)).toHaveLength(2)

    const res = mdToPattern('---\nrowtine: 1\n---\n\n' + out)
    expect(res.warnings).toEqual([])
    const blocks = res.pattern.reader.reference.tabs.find((t) => t.id === 'tech').blocks
    expect(blocks.map((b) => b.h3)).toEqual(['Jete', 'Montage tubulaire'])
    expect(blocks[0].p.join(' ')).toContain('Explication du jete.')
  })

  it('fusionne dans un bloc Techniques contenant DEUX techniques existantes : trois techniques distinctes', () => {
    const doc =
      '## Techniques {techniques}\n\n### Jete\n\nExplication du jete.\n\n' +
      '### Montage tubulaire\n\nMonter ainsi.\n\nCabler a droite'
    const { changes } = mergeIntoReference(doc, 11, 11, { tag: 'techniques' })
    const out = apply(doc, changes)
    expect(out).not.toMatch(/###\s*###/)
    expect(out.match(/^### /gm)).toHaveLength(3)

    const res = mdToPattern('---\nrowtine: 1\n---\n\n' + out)
    expect(res.warnings).toEqual([])
    const blocks = res.pattern.reader.reference.tabs.find((t) => t.id === 'tech').blocks
    expect(blocks.map((b) => b.h3)).toEqual(['Jete', 'Montage tubulaire', 'Cabler a droite'])
    expect(blocks[0].p.join(' ')).toContain('Explication du jete.')
    expect(blocks[1].p.join(' ')).toContain('Monter ainsi.')
  })

  // Un arbitrage (20/08, en revue) : un bloc Techniques déjà présent peut
  // lui-même contenir du texte AVANT son premier `###` (import raté, ou une utilisatrice qui
  // a déjà tapé un paragraphe d'intro avant ses sous-titres). Une première version de
  // buildMergeChanges/linesToTechniques laissait ce texte disparaître au premier geste de
  // fusion qui touchait ce bloc, même sans rapport avec lui -- perte silencieuse repérée par
  // sonde, jamais acceptable (règle cardinale du projet). Il devient désormais sa propre
  // technique, vérifié ici par un reparse complet (pas seulement l'allure de la chaîne).
  it('fusionne dans un bloc Techniques dont le corps existant porte du texte AVANT son premier ### : le reliquat survit, en devient sa propre technique', () => {
    const doc =
      '## Techniques {techniques}\n\nRELIQUAT AVANT LE PREMIER TITRE\n\n### Jete\n\n' +
      'Explication du jete.\n\nMontage tubulaire'
    const { changes } = mergeIntoReference(doc, 9, 9, { tag: 'techniques' })
    const out = apply(doc, changes)
    expect(out).toContain('RELIQUAT AVANT LE PREMIER TITRE')
    expect(out).not.toMatch(/###\s*###/)

    const res = mdToPattern('---\nrowtine: 1\n---\n\n' + out)
    expect(res.warnings).toEqual([])
    const blocks = res.pattern.reader.reference.tabs.find((t) => t.id === 'tech').blocks
    expect(blocks.map((b) => b.h3)).toEqual(['RELIQUAT AVANT LE PREMIER TITRE', 'Jete', 'Montage tubulaire'])
    expect(blocks[1].p.join(' ')).toContain('Explication du jete.')
  })

  // Regression trouvee par la revue suivante (20/08) : startsNewTechnique testait la ligne
  // BRUTE de la selection, pas sa forme normalisee. Deux declencheurs reels, tous deux
  // geste courant : une selection qui commence par une ligne blanche (glisser-selectionner)
  // prefixait '' en '### ', qui ne matche plus /^###\s+(.+)$/ une fois retrimee -- la ligne
  // retombait dans le corps de la technique precedente au lieu d'ouvrir la sienne. Une
  // selection qui commence par une puce prefixait le tiret AVEC le texte (`### - Montage
  // tubulaire`), le marqueur de puce atterrissant dans le titre. Les deux sont maintenant
  // normalisees (stripMarkup puis trim) avant la decision de prefixage, et verifiees ici par
  // un aller-retour mdToPattern complet, pas seulement l'allure de la chaine produite.
  it('selection commencant par une ligne blanche (glisser-selectionner) : la ligne blanche est sautee, pas prefixee', () => {
    const doc = '## Techniques {techniques}\n\n### Jete\n\nExplication du jete.\n\n\nMontage tubulaire'
    // Lignes : 1 titre, 3 ### Jete, 5 corps, 7 (blanche), 8 Montage tubulaire -- selection 7-8.
    const { changes } = mergeIntoReference(doc, 7, 8, { tag: 'techniques' })
    const out = apply(doc, changes)
    expect(out).not.toMatch(/###\s*###/)
    // Aucune ligne `###` orpheline (juste le marqueur sans titre) versee en contenu.
    expect(out).not.toMatch(/^###\s*$/m)

    const res = mdToPattern('---\nrowtine: 1\n---\n\n' + out)
    expect(res.warnings).toEqual([])
    const blocks = res.pattern.reader.reference.tabs.find((t) => t.id === 'tech').blocks
    expect(blocks.map((b) => b.h3)).toEqual(['Jete', 'Montage tubulaire'])
  })

  it('selection commencant par une puce : le tiret est retire, pas verse dans le titre', () => {
    const doc = '## Techniques {techniques}\n\n### Jete\n\nExplication du jete.\n\n- Montage tubulaire'
    const { changes } = mergeIntoReference(doc, 7, 7, { tag: 'techniques' })
    const out = apply(doc, changes)
    expect(out).toContain('### Montage tubulaire')
    expect(out).not.toContain('### - Montage tubulaire')

    const res = mdToPattern('---\nrowtine: 1\n---\n\n' + out)
    expect(res.warnings).toEqual([])
    const blocks = res.pattern.reader.reference.tabs.find((t) => t.id === 'tech').blocks
    expect(blocks.map((b) => b.h3)).toEqual(['Jete', 'Montage tubulaire'])
  })
})

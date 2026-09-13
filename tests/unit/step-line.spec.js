// stepLine : du couple (section, position d'étape) au numéro de ligne du
// Rowtine-MD. Pur — aucun composant monté. Le Markdown de référence reproduit
// ce que `patternToMd` (serialize.js) émet réellement : titre de section, ligne
// vide, puis une ligne par étape, les images ANCRÉES sous une étape étant
// indentées de deux espaces (`  ![](…)`) alors qu'un diagramme ou une image de
// galerie ne l'est pas.
import { describe, it, expect } from 'vitest'
import { stepLine, sectionLine, h2Title, sectionTitleAtLine, imageAnchorLine } from '@/utils/pattern-md/step-line'

const MD = [
  '## Corps',            // 1
  '',                    // 2
  '- Rang 1 : tricoter.', // 3  → index 0
  '  ![](img/photo-a.png)', // 4  (continuation, PAS une étape)
  '- Rang 2 : tourner.',  // 5  → index 1
  '> Remarque utile.',    // 6  → index 2
  '![Diagramme](img/photo-b.png)', // 7  → index 3
  '12 m × 20 rangs',      // 8  (dimensions du diagramme, type texte)
  '',                     // 9
  '## Manches {sleeve}',  // 10
  '',                     // 11
  '- Rang 1 : augmenter.', // 12 → index 0
  '',                     // 13
].join('\n')

describe('h2Title', () => {
  it('rend le titre nu, attribut de catégorie retiré', () => {
    expect(h2Title('## Manches {sleeve}')).toBe('Manches')
    expect(h2Title('## Corps')).toBe('Corps')
    expect(h2Title('- Rang 1')).toBe(null)
  })
})

describe('stepLine', () => {
  it('trouve un rang', () => {
    expect(stepLine(MD, 'corps', 0)).toBe(3)
    expect(stepLine(MD, 'corps', 1)).toBe(5)
  })

  it('trouve une note', () => {
    expect(stepLine(MD, 'corps', 2)).toBe(6)
  })

  it('trouve un diagramme (image non indentée)', () => {
    expect(stepLine(MD, 'corps', 3)).toBe(7)
  })

  it('une image INDENTÉE sous une étape ne compte pas comme étape', () => {
    // Sans cette règle, l'index 1 tomberait sur la ligne 4 et tout le reste
    // de la section dériverait d'un cran.
    expect(stepLine(MD, 'corps', 1)).toBe(5)
  })

  it('compte les étapes par section, pas par document', () => {
    expect(stepLine(MD, 'manches', 0)).toBe(12)
  })

  it('trouve la section malgré son attribut de catégorie', () => {
    expect(sectionLine(MD, 'manches')).toBe(10)
  })

  it('un compteur de répétition compte comme étape', () => {
    const md = '## Corps\n\n- {×4} Répéter.\n- Rang 2.\n'
    expect(stepLine(md, 'corps', 0)).toBe(3)
    expect(stepLine(md, 'corps', 1)).toBe(4)
  })

  it('index au-delà de la dernière étape de la section → null', () => {
    expect(stepLine(MD, 'corps', 9)).toBe(null)
  })

  it('section absente → null', () => {
    expect(stepLine(MD, 'col', 0)).toBe(null)
    expect(sectionLine(MD, 'col')).toBe(null)
  })

  it('section renommée (le slug ne correspond plus) → null', () => {
    expect(stepLine(MD, 'corps-et-torsade', 0)).toBe(null)
  })

  it('deux sections de même titre : l’id de la première la vise', () => {
    // normalizeReaderForSave dédoublonne en `corps` / `corps-1` : `corps` vise
    // la première. `corps-1` n’a aucun titre correspondant → repli (null).
    const md = '## Corps\n\n- A\n\n## Corps\n\n- B\n'
    expect(stepLine(md, 'corps', 0)).toBe(3)
    expect(stepLine(md, 'corps-1', 0)).toBe(null)
  })

  it('un bloc de référence n’est jamais pris pour une section', () => {
    // `## Fil {yarn}` est un bloc d’aide-mémoire (lineType → 'reference').
    // ⚠️ `## Fil` NU en serait un aussi : `reservedKey('Fil')` vaut 'yarn'
    // (refblocks.js) — un titre réservé reste réservé sans sa balise. La vraie
    // section de ce cas porte donc un titre non réservé.
    const md = '## Fil {yarn}\n\n- Laine\n\n## Corps\n\n- Rang 1\n'
    expect(stepLine(md, 'corps', 0)).toBe(7)
    expect(stepLine(md, 'fil', 0)).toBe(null)
  })

  it('entrées invalides → null, jamais d’exception', () => {
    expect(stepLine('', 'corps', 0)).toBe(null)
    expect(stepLine(MD, '', 0)).toBe(null)
    expect(stepLine(MD, 'corps', -1)).toBe(null)
    expect(stepLine(MD, 'corps', 1.5)).toBe(null)
    expect(stepLine(null, 'corps', 0)).toBe(null)
  })

  it('un titre à accents et espaces trouve sa section (appariement par titre, pas par id)', () => {
    // Round 1 (2026-08-21) : c'est le cas que l'ancien appariement par id
    // ratait. Le Markdown ne porte que le titre — jamais un id. Un patron de
    // démonstration (`src/constants/demo/fr.js`) code son id à la main
    // (`'bordure'`) sans rapport avec `slug(titre)` (`'bordure-en-cotes'`) :
    // seul un appariement sur le TITRE, ici passé tel quel (accents, espaces,
    // majuscule), retrouve la bonne section.
    const md = '## Bordure en côtes\n\n- Monter 88 m.\n'
    expect(sectionLine(md, 'Bordure en côtes')).toBe(1)
    expect(stepLine(md, 'Bordure en côtes', 0)).toBe(3)
  })
})

describe('sectionTitleAtLine', () => {
  it('retrouve le titre de la section qui contient la ligne donnée', () => {
    const md = '## Corps\n- rang 1\n- rang 2\n## Manche\n- rang 3\n'
    expect(sectionTitleAtLine(md, 3)).toBe('Corps')
    expect(sectionTitleAtLine(md, 5)).toBe('Manche')
  })

  it('renvoie null avant tout titre de section', () => {
    const md = 'Texte libre avant toute section\n## Corps\n- rang 1\n'
    expect(sectionTitleAtLine(md, 1)).toBeNull()
  })

  it('ignore les blocs aide-mémoire (## Fil {yarn}), pas des sections de travail', () => {
    const md = '## Fil {yarn}\nLaine\n## Corps\n- rang 1\n'
    expect(sectionTitleAtLine(md, 2)).toBeNull()
    expect(sectionTitleAtLine(md, 4)).toBe('Corps')
  })
})

// imageAnchorLine : ligne (1-based) après laquelle une image de galerie insérée depuis
// le curseur doit s'écrire pour s'accrocher à une VRAIE étape (rang/compteur/note) —
// jamais poser une image non indentée (deviendrait un diagramme, cf. serialize.js) ni
// une image orpheline (silencieusement perdue, warning section.orphanImage). Réutilise
// le MD de référence en tête de fichier.
describe('imageAnchorLine', () => {
  it('curseur exactement sur un rang sans image ancrée : ancre juste après ce rang', () => {
    expect(imageAnchorLine(MD, 5)).toBe(5) // '- Rang 2 : tourner.'
  })

  it('curseur sur une ligne vide/note/texte : remonte au rang/étape le plus proche AU-DESSUS', () => {
    // ligne 9 est vide, juste après le bloc diagramme de "Corps" (lignes 7-8) — l'étape la
    // plus proche au-dessus est la note (ligne 6), pas le diagramme (image non indentée).
    expect(imageAnchorLine(MD, 9)).toBe(6)
  })

  it('un rang porte déjà une image ancrée : la nouvelle image s’ajoute APRÈS la dernière (images sœurs)', () => {
    // ligne 3 = rang, ligne 4 = sa continuation image déjà présente — l'ancre doit être 4,
    // pas 3 (sinon la nouvelle image s'intercalerait avant l'existante).
    expect(imageAnchorLine(MD, 4)).toBe(4)
  })

  it('aucune étape au-dessus du curseur dans la section (section vide) : null', () => {
    const md = '## Corps\n\n## Manches\n- Rang 1.\n'
    expect(imageAnchorLine(md, 2)).toBeNull()
  })

  it('curseur avant tout titre de section : null', () => {
    const md = 'Texte libre avant toute section\n## Corps\n- rang 1\n'
    expect(imageAnchorLine(md, 1)).toBeNull()
  })
})

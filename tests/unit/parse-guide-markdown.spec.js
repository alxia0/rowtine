// Tests du parseur maison du guide utilisateur (lot 2, écran « À propos »).
// Fixtures inline reprenant EXACTEMENT les constructions mesurées dans
// `src/content/guide/fr.md` (titres, image+légende, gras/italique, listes imbriquées,
// tableau) — pas un test contre le fichier réel, qui vit dans
// tests/unit/guide-content-fresh.spec.js (garde anti-dérive).
import { describe, it, expect } from 'vitest'
import { parseGuideMarkdown, parseInlineSpans, detectInlineWarnings } from '@/content/guide/parse-guide-markdown'

describe('parseInlineSpans', () => {
  it('sépare texte simple, gras et italique', () => {
    expect(parseInlineSpans('texte **gras** puis *italique* fin')).toEqual([
      { text: 'texte ', bold: false, italic: false },
      { text: 'gras', bold: true, italic: false },
      { text: ' puis ', bold: false, italic: false },
      { text: 'italique', bold: false, italic: true },
      { text: ' fin', bold: false, italic: false },
    ])
  })

  it('conserve le marqueur {app} tel quel (substitué à l’affichage, pas ici)', () => {
    expect(parseInlineSpans('{app} t’aide à tricoter')).toEqual([{ text: '{app} t’aide à tricoter', bold: false, italic: false }])
  })

  it('texte sans mise en forme reste un seul span', () => {
    expect(parseInlineSpans('rien de spécial ici')).toEqual([{ text: 'rien de spécial ici', bold: false, italic: false }])
  })
})

describe('parseGuideMarkdown', () => {
  it('ignore le H1 et démarre les sections au premier ##', () => {
    const md = ['# Guide {app}', '', '## Première section', '', 'Un paragraphe.'].join('\n')
    const { sections } = parseGuideMarkdown(md)
    expect(sections).toHaveLength(1)
    expect(sections[0].title).toEqual([{ text: 'Première section', bold: false, italic: false }])
  })

  it('attribue un id positionnel, pas dérivé du titre', () => {
    const md = ['## Un', '', 'Texte.', '', '## Deux', '', 'Texte.'].join('\n')
    const { sections } = parseGuideMarkdown(md)
    expect(sections.map((s) => s.id)).toEqual(['section-0', 'section-1'])
  })

  it('regroupe un sous-titre (###) comme bloc de la section courante', () => {
    const md = ['## Section', '', '### Sous-titre', '', 'Texte.'].join('\n')
    const { sections } = parseGuideMarkdown(md)
    expect(sections[0].blocks[0]).toEqual({ type: 'subsection', title: [{ text: 'Sous-titre', bold: false, italic: false }] })
  })

  it('associe une image à sa légende en italique', () => {
    const md = [
      '## Section',
      '',
      '![Texte alternatif](images/fr/00-bienvenue.webp)',
      '',
      '*Une légende avec **un mot en gras**.*',
      '',
      'Paragraphe suivant.',
    ].join('\n')
    const { sections } = parseGuideMarkdown(md)
    const [image, paragraph] = sections[0].blocks
    expect(image).toEqual({
      type: 'image',
      src: '00-bienvenue',
      alt: 'Texte alternatif',
      caption: [
        { text: 'Une légende avec ', bold: false, italic: false },
        { text: 'un mot en gras', bold: true, italic: false },
        { text: '.', bold: false, italic: false },
      ],
    })
    expect(paragraph.type).toBe('paragraph')
  })

  it('image sans légende (paragraphe suivant non entouré d’astérisques)', () => {
    const md = ['## Section', '', '![Alt](images/fr/x.webp)', '', 'Pas une légende.'].join('\n')
    const { sections } = parseGuideMarkdown(md)
    expect(sections[0].blocks[0].caption).toBeNull()
  })

  it('fusionne un paragraphe replié sur plusieurs lignes', () => {
    const md = ['## Section', '', 'Première ligne qui continue', 'sur une deuxième ligne.'].join('\n')
    const { sections } = parseGuideMarkdown(md)
    expect(sections[0].blocks[0].spans.map((s) => s.text).join('')).toBe('Première ligne qui continue sur une deuxième ligne.')
  })

  it('liste à puces avec un item replié sur plusieurs lignes', () => {
    const md = ['## Section', '', '- Premier item', '  qui continue.', '- Deuxième item.'].join('\n')
    const { sections } = parseGuideMarkdown(md)
    const list = sections[0].blocks[0]
    expect(list.type).toBe('list')
    expect(list.ordered).toBe(false)
    expect(list.items).toHaveLength(2)
    expect(list.items[0].spans.map((s) => s.text).join('')).toBe('Premier item qui continue.')
  })

  it('liste imbriquée sur 2 niveaux', () => {
    const md = ['## Section', '', '- Parent', '  - Enfant un', '  - Enfant deux', '- Autre parent'].join('\n')
    const { sections } = parseGuideMarkdown(md)
    const list = sections[0].blocks[0]
    expect(list.items).toHaveLength(2)
    expect(list.items[0].children.ordered).toBe(false)
    expect(list.items[0].children.items).toHaveLength(2)
    expect(list.items[0].children.items[0].spans[0].text).toBe('Enfant un')
    expect(list.items[1].children).toBeNull()
  })

  it('liste numérotée', () => {
    const md = ['## Section', '', '1. Premier pas.', '2. Deuxième pas.'].join('\n')
    const { sections } = parseGuideMarkdown(md)
    expect(sections[0].blocks[0].ordered).toBe(true)
  })

  it('tableau à 2 colonnes : en-tête ET lignes conservés intégralement (aucune perte)', () => {
    const md = [
      '## Section',
      '',
      '| Catégorie | Description |',
      '|---|---|',
      '| **Étape** | Une case à cocher. |',
      '| **Note** | Un texte informatif. |',
    ].join('\n')
    const { sections } = parseGuideMarkdown(md)
    const table = sections[0].blocks[0]
    expect(table.type).toBe('terms')
    expect(table.header.map((s) => s.map((sp) => sp.text).join(''))).toEqual(['Catégorie', 'Description'])
    expect(table.rows).toHaveLength(2)
    expect(table.rows[0][0]).toEqual([{ text: 'Étape', bold: true, italic: false }])
    expect(table.rows[0][1][0].text).toBe('Une case à cocher.')
  })

  it('tableau à 3 colonnes : la 3e colonne n’est PLUS perdue (régression corrigée en revue)', () => {
    const md = [
      '## Section',
      '',
      '| Nom | Aiguilles | Échantillon |',
      '|---|---|---|',
      '| Bonnet | 4,5 mm | 22 m. |',
    ].join('\n')
    const { sections } = parseGuideMarkdown(md)
    const table = sections[0].blocks[0]
    expect(table.header).toHaveLength(3)
    expect(table.rows[0]).toHaveLength(3)
    expect(table.rows[0][2][0].text).toBe('22 m.')
  })

  it('gras+italique combiné (***texte***) ne laisse plus d’astérisques orphelins', () => {
    const spans = parseInlineSpans('avant ***très important*** après')
    expect(spans).toEqual([
      { text: 'avant ', bold: false, italic: false },
      { text: 'très important', bold: true, italic: true },
      { text: ' après', bold: false, italic: false },
    ])
  })
})

describe('detectInlineWarnings', () => {
  it('signale un « * » isolé entre deux chiffres (multiplication littérale probable)', () => {
    const warnings = detectInlineWarnings('5 * 3 = 15 et 2 * 4 = 8')
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('ne signale rien pour un texte sans construction ambiguë', () => {
    expect(detectInlineWarnings('**gratuite, libre et fonctionne hors ligne**')).toEqual([])
  })

  it('les avertissements remontent jusqu’au résultat de parseGuideMarkdown', () => {
    const md = ['## Section', '', 'Compte 5 * 3 = 15 mailles.'].join('\n')
    const { warnings } = parseGuideMarkdown(md)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('un guide sans construction ambiguë ne produit aucun avertissement', () => {
    const md = ['## Section', '', 'Un texte **normal** et *simple*, rien à signaler.'].join('\n')
    const { warnings } = parseGuideMarkdown(md)
    expect(warnings).toEqual([])
  })
})

// Revue (02/08) : dernier chemin de perte SILENCIEUSE du parseur — un bloc
// situé avant le premier `##` était jeté sans un mot (`if (!currentSection) return`), alors
// que tout le reste des risques de perte est documenté ou signalé.
describe('pushBlock — contenu avant le premier titre de section (##)', () => {
  it('un paragraphe avant le premier ## est ignoré MAIS signalé', () => {
    const md = ['Un paragraphe orphelin, avant toute section.', '', '## Section', '', 'Un paragraphe normal.'].join(
      '\n',
    )
    const { sections, warnings } = parseGuideMarkdown(md)
    // Toujours ignoré : aucune section n'existe pour l'accueillir.
    expect(sections).toHaveLength(1)
    expect(sections[0].blocks).toHaveLength(1)
    // Mais désormais signalé, plus une perte silencieuse.
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.join(' ')).toContain('orphelin')
  })

  it('un guide qui commence directement par un ## ne signale rien de ce type', () => {
    const md = ['## Section', '', 'Un paragraphe normal.'].join('\n')
    const { warnings } = parseGuideMarkdown(md)
    expect(warnings).toEqual([])
  })
})

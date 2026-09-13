import { describe, it, expect } from 'vitest'
import { referenceBlocksToMd, reservedKey, parseReservedBlock, REF_TAG_TO_KEY } from '@/utils/pattern-md/refblocks'
import { WARNING_CODES, formatWarningFr } from '@/utils/pattern-md/warning-codes'

const FLAT = {
  abbr: [{ key: 'm.', def: 'maille' }, { key: 'AM', def: 'anneau marqueur' }],
  gauge: '10 × 10 cm = 20 m × 26 rgs.',
  needles: 'Aig. circulaires n° 4',
  yarn: 'Coton DK',
  materials: ['4 anneaux marqueurs', 'aiguille à laine'],
  tips: ['Conseils', 'Voir la vidéo de montage.'],
  techniques: [{ title: 'Augm. intercalaire', body: 'Relever le brin horizontal…' }],
  sizeTable: [{ label: 'Tour de poitrine (cm)', values: ['74', '82', '90'] }],
}
const LABELS = ['S', 'M', 'L']

describe('reservedKey', () => {
  it('reconnaît les titres réservés, insensible casse/accents', () => {
    expect(reservedKey('Échantillon')).toBe('gauge')
    expect(reservedKey('echantillon')).toBe('gauge')
    expect(reservedKey('Abréviations')).toBe('abbr')
    expect(reservedKey('Tableau des tailles')).toBe('sizeTable')
    expect(reservedKey('Tailles')).toBe('sizeTable')
    expect(reservedKey('Galerie')).toBe('galerie')
    expect(reservedKey('Conseils')).toBe('tips')
    expect(reservedKey('Encolure')).toBe(null)
  })
})

describe('avertissements structurés (code + paramètres, pas de phrase française en dur)', () => {
  it('un bloc réservé non tabulaire produit un code + la clé du bloc (pas son libellé français)', () => {
    const warnings = []
    parseReservedBlock('abbr', ['du texte libre qui n\'est pas une table'], { warnings })
    expect(warnings[0]).toMatchObject({
      code: WARNING_CODES.BLOCK_NOT_A_TABLE,
      params: { blockKey: 'abbr' },
    })
    // La clé, PAS le libellé : « Abréviations » ne doit plus figurer dans l'avertissement.
    expect(JSON.stringify(warnings[0])).not.toContain('Abréviations')
  })
})

describe('émission ↔ parsing des blocs', () => {
  it('émet tous les blocs non vides', () => {
    const md = referenceBlocksToMd(FLAT, LABELS)
    expect(md).toContain('## Échantillon')
    expect(md).toContain('## Abréviations')
    expect(md).toContain('| m. | maille |')
    expect(md).toContain('### Augm. intercalaire')
    expect(md).toContain('| Tour de poitrine (cm) | 74 | 82 | 90 |')
    expect(md).toContain('- Voir la vidéo de montage.')
  })
  it('titres réservés FR CONSERVÉS, balise EN ajoutée (dialecte, spec B1)', () => {
    const md = referenceBlocksToMd(FLAT, LABELS)
    expect(md).toContain('## Échantillon {gauge}')
    expect(md).toContain('## Fil {yarn}')
    expect(md).toContain('## Aiguilles {needles}')
    expect(md).toContain('## Matériel {materials}')
    expect(md).toContain('## Conseils {tips}')
    expect(md).toContain('## Techniques {techniques}')
    expect(md).toContain('## Abréviations {abbreviations}')
    expect(md).toContain('## Tailles {measurements}')
  })
  it('bloc Conseils émis juste après Matériel', () => {
    const md = referenceBlocksToMd(FLAT, LABELS)
    const iMat = md.indexOf('## Matériel {materials}')
    const iTips = md.indexOf('## Conseils {tips}')
    const iTech = md.indexOf('## Techniques {techniques}')
    expect(iMat).toBeGreaterThan(-1)
    expect(iTips).toBeGreaterThan(iMat)
    expect(iTech).toBeGreaterThan(iTips)
  })
  it('taille unique : en-tête « | mesure | valeur | » (prompt), pas le libellé interne', () => {
    const md = referenceBlocksToMd({ sizeTable: [{ label: 'Longueur', values: ['44 cm'] }] }, ['Taille unique'])
    expect(md).toContain('| mesure | valeur |')
    expect(md).not.toContain('Taille unique')
  })
  it('aucune taille déclarée (sizeLabels vide, patron sans tailles/sizes) : en-tête à 1 colonne, pas d\'en-tête vide (bug picture-ornament-fr-047559ed)', () => {
    const md = referenceBlocksToMd({ sizeTable: [{ label: 'Largeur', values: ['7.6 cm'] }] }, [])
    expect(md).toContain('| mesure | valeur |')
    expect(md).toContain('|---|---|')
    expect(md).not.toContain('| mesure |\n')
  })
  it('aucune taille déclarée mais une ligne sans valeur (values: []) : en-tête à 1 colonne quand même (gabarit de ligne émet toujours au moins 2 cellules)', () => {
    const md = referenceBlocksToMd({ sizeTable: [{ label: 'TAILLE', values: [] }] }, [])
    expect(md).toContain('| mesure | valeur |')
    expect(md).toContain('| TAILLE |  |')
  })
  it('multi-tailles : un décompte de valeurs qui ne correspond pas à sizeLabels ne fait JAMAIS disparaître les vrais libellés (S/M/L) derrière « valeur »', () => {
    const md = referenceBlocksToMd({ sizeTable: [{ label: 'Tour de poitrine', values: ['74', '82'] }] }, ['S', 'M', 'L'])
    expect(md).toContain('| mesure | S | M | L |')
  })
  it('forme plate vide → chaîne vide', () => {
    expect(referenceBlocksToMd({ abbr: [], gauge: '', needles: '', yarn: '', materials: [], tips: [], techniques: [], sizeTable: [] }, [])).toBe('')
  })
  it('parse la table des abréviations (en-tête ignoré)', () => {
    const lines = ['| abr. | définition |', '|---|---|', '| m. | maille |', '| AM | anneau marqueur |']
    expect(parseReservedBlock('abbr', lines, { n: 3, warnings: [] })).toEqual({ abbr: FLAT.abbr })
  })
  it('parse le tableau des tailles et vérifie n', () => {
    const warnings = []
    const lines = ['| mesure | S | M | L |', '|---|---|---|---|', '| Tour de poitrine (cm) | 74 | 82 | 90 |']
    expect(parseReservedBlock('sizeTable', lines, { n: 3, warnings })).toEqual({ sizeTable: FLAT.sizeTable })
    expect(warnings).toEqual([])
    parseReservedBlock('sizeTable', ['| mesure | S | M | L |', '|---|---|---|---|', '| x | 1 | 2 |'], { n: 3, warnings })
    // ligne à 2 valeurs pour 3 tailles → ignorée avec avertissement
    expect(warnings.length).toBe(1)
  })
  it('abréviations : en-tête libre exclu structurellement (ligne séparatrice)', () => {
    const lines = ['| Abréviation | Sens |', '|---|---|', '| m. | maille |']
    expect(parseReservedBlock('abbr', lines, { n: 0, warnings: [] })).toEqual({ abbr: [{ key: 'm.', def: 'maille' }] })
  })
  it('abréviations : table sans en-tête ni séparatrice = toutes lignes en données', () => {
    expect(parseReservedBlock('abbr', ['| m. | maille |'], { n: 0, warnings: [] })).toEqual({ abbr: [{ key: 'm.', def: 'maille' }] })
  })
  it('tailles : ligne isolée mal formée sans en-tête → avertissement, mais CONSERVÉE', () => {
    // Avertir ne suffit pas (retour terrain, 16/07/2026) : la ligne ressort en
    // `leftover`, que parse.js rétrograde en note. Rien n'est jeté.
    const warnings = []
    expect(parseReservedBlock('sizeTable', ['| x | 1 | 2 |'], { n: 3, warnings }))
      .toEqual({ sizeTable: [], leftover: ['| x | 1 | 2 |'] })
    expect(warnings.length).toBe(1)
    // Avertissement structuré (code + params) : `JSON.stringify(warnings[0])` ne contiendrait
    // JAMAIS « ignorée » (ni le slug du code ni les params ne portent ce mot) — l'assertion
    // ne pouvait pas rougir. On passe par `formatWarningFr` (comme refblocks-non-destructif.spec.js)
    // pour tester la PHRASE réellement affichée, seul endroit où le mot proscrit pourrait resurgir.
    expect(formatWarningFr(warnings[0])).not.toMatch(/ignorée/i)
  })
  it('parse matériel (puces) et techniques (###)', () => {
    expect(parseReservedBlock('materials', ['- 4 anneaux marqueurs', '- aiguille à laine'], { n: 0, warnings: [] }))
      .toEqual({ materials: FLAT.materials })
    expect(parseReservedBlock('techniques', ['### Augm. intercalaire', 'Relever le brin horizontal…'], { n: 0, warnings: [] }))
      .toEqual({ techniques: FLAT.techniques })
  })
  it('parse le bloc Conseils (puces), sur le modèle exact de matériel', () => {
    expect(parseReservedBlock('tips', ['- Conseils', '- Voir la vidéo de montage.'], { n: 0, warnings: [] }))
      .toEqual({ tips: FLAT.tips })
  })
  it('aller-retour complet sur chaque bloc', () => {
    const md = referenceBlocksToMd(FLAT, LABELS)
    // redécoupe naïve par ## pour re-parser chaque bloc : chaque titre porte
    // désormais une balise EN {tag} (dialecte) — on la résout via
    // REF_TAG_TO_KEY comme le fait le vrai dispatch de parse.js, avec repli
    // reservedKey pour un titre qui en serait dépourvu.
    const blocks = md.split(/^## /m).filter(Boolean).map((b) => {
      const [rawTitle, ...rest] = b.split('\n')
      const tm = /^(.*?)\s*\{([a-z0-9-]+)\}$/.exec(rawTitle.trim())
      const key = tm ? (REF_TAG_TO_KEY[tm[2]] ?? null) : reservedKey(rawTitle.trim())
      return { key, lines: rest.filter((l) => l.trim() !== '') }
    })
    const flat = Object.assign({}, ...blocks.map((b) => parseReservedBlock(b.key, b.lines, { n: 3, warnings: [] })))
    expect(flat).toEqual(FLAT)
  })
})

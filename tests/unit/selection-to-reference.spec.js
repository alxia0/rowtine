// Traduction d'une selection de lignes en forme PLATE de reference. C'est le coeur du
// correctif : avant, chaque ligne devenait le TITRE d'un bloc a corps vide, et le parseur
// la rejetait (a raison) vers les notes.
import { describe, it, expect } from 'vitest'
import { selectionToFlat } from '@/utils/pattern-md/selection-to-reference'
import { referenceBlocksToMd } from '@/utils/pattern-md/refblocks'
import { mdToPattern } from '@/utils/pattern-md/parse'

describe('rubriques de texte libre', () => {
  it('joint les lignes par un saut de ligne', () => {
    expect(selectionToFlat(['Coton DK, 400 m', '3 pelotes'], 'yarn'))
      .toEqual({ yarn: 'Coton DK, 400 m\n3 pelotes' })
  })
  it('route needles et gauge sur leur propre cle', () => {
    expect(selectionToFlat(['Circulaires n 4'], 'needles')).toEqual({ needles: 'Circulaires n 4' })
    expect(selectionToFlat(['18 m x 24 rgs'], 'gauge')).toEqual({ gauge: '18 m x 24 rgs' })
  })
})

describe('rubriques a puces', () => {
  it('materials garde une entree par ligne', () => {
    expect(selectionToFlat(['4 marqueurs', '1 aiguille a laine'], 'materials'))
      .toEqual({ materials: ['4 marqueurs', '1 aiguille a laine'] })
  })
  it('tips suit exactement la meme forme', () => {
    expect(selectionToFlat(['Voir le tuto video'], 'tips'))
      .toEqual({ tips: ['Voir le tuto video'] })
  })
})

describe('techniques', () => {
  it('premiere ligne = titre, suite = corps', () => {
    expect(selectionToFlat(['Montage tubulaire', 'Monter les mailles ainsi.', 'Puis tourner.'], 'techniques'))
      .toEqual({ techniques: [{ title: 'Montage tubulaire', body: 'Monter les mailles ainsi.\nPuis tourner.' }] })
  })
  it('une seule ligne donne un titre sans corps', () => {
    expect(selectionToFlat(['Montage tubulaire'], 'techniques'))
      .toEqual({ techniques: [{ title: 'Montage tubulaire', body: '' }] })
  })
})

// Correctif de revue (fusion) : le corps EXISTANT d'un bloc Techniques déjà
// balisé (retagSelection -> selectionToFlat) peut contenir un ou plusieurs titres
// `### Titre` — stripMarkup ne les touche jamais (seuls les `##` sont reconnus).
// linesToTechniques doit les reconnaître comme séparateurs, exactement comme
// parseReservedBlock (refblocks.js, branche techniques) le fait déjà pour du MD
// écrit à la main — même règle de découpage, pas une seconde qui pourrait diverger.
describe('techniques — corps déjà balisé (### déjà présents, cas de la fusion)', () => {
  it('un seul `###` : une seule technique, le titre ne double pas', () => {
    expect(selectionToFlat(['### Jeté', 'Explication du jeté.'], 'techniques'))
      .toEqual({ techniques: [{ title: 'Jeté', body: 'Explication du jeté.' }] })
  })

  it('plusieurs `###` : autant de techniques que de titres, chacune son corps', () => {
    expect(selectionToFlat(
      ['### Jeté', 'Explication du jeté.', '### Montage tubulaire', 'Monter les mailles ainsi.', 'Puis tourner.'],
      'techniques'
    )).toEqual({
      techniques: [
        { title: 'Jeté', body: 'Explication du jeté.' },
        { title: 'Montage tubulaire', body: 'Monter les mailles ainsi.\nPuis tourner.' },
      ],
    })
  })

  it('`###` sans corps propre (technique suivante immédiate) : corps vide, pas de fuite vers la suivante', () => {
    expect(selectionToFlat(['### Jeté', '### Montage tubulaire', 'Corps.'], 'techniques')).toEqual({
      techniques: [
        { title: 'Jeté', body: '' },
        { title: 'Montage tubulaire', body: 'Corps.' },
      ],
    })
  })

  // Cas mixte : texte AVANT le premier `###`. Un arbitrage (20/08, revue) :
  // une première version alignait ce cas sur parseReservedBlock (refblocks.js), qui IGNORE ce
  // texte — repéré comme une perte silencieuse (règle cardinale : rien de ce que l'utilisatrice
  // a saisi ne doit disparaître, « aligné sur le moteur » n'excuse pas une perte). Le segment de
  // tête devient donc sa PROPRE technique, sur la MÊME règle que « aucun ### du tout » : 1re ligne
  // = titre, le reste = corps. `referenceBlocksToMd` la ré-émettra en `### Titre` + corps comme
  // les autres, donc le parseur la relira sans avertissement au prochain passage (vérifié
  // ci-dessous par un aller-retour mdToPattern, pas seulement l'allure de l'objet plat).
  it('texte avant le premier `###` (cas mixte) : devient sa propre technique, rien ne disparaît', () => {
    expect(selectionToFlat(['Un reliquat de texte libre', '### Jeté', 'Explication du jeté.'], 'techniques'))
      .toEqual({
        techniques: [
          { title: 'Un reliquat de texte libre', body: '' },
          { title: 'Jeté', body: 'Explication du jeté.' },
        ],
      })
  })

  it('cas mixte, vérifié par un aller-retour mdToPattern : le reliquat est bien là, aucun avertissement', () => {
    const flat = selectionToFlat(['Un reliquat de texte libre', '### Jeté', 'Explication du jeté.'], 'techniques')
    const md = referenceBlocksToMd(flat)
    const res = mdToPattern('---\nrowtine: 1\n---\n\n' + md)
    expect(res.warnings).toEqual([])
    const blocks = res.pattern.reader.reference.tabs.find((t) => t.id === 'tech').blocks
    expect(blocks.map((b) => b.h3)).toEqual(['Un reliquat de texte libre', 'Jeté'])
    expect(blocks[1].p.join(' ')).toContain('Explication du jeté.')
  })
})

describe('abreviations', () => {
  it.each([
    ['m = maille', 'm', 'maille'],
    ['aug : augmentation', 'aug', 'augmentation'],
    ['dim - diminution', 'dim', 'diminution'],
    ['ms — maille serree', 'ms', 'maille serree'],
    ['br – bride', 'br', 'bride'],
    ['pm\tplace marker', 'pm', 'place marker'],
  ])('decoupe %s', (line, key, def) => {
    expect(selectionToFlat([line], 'abbreviations')).toEqual({ abbr: [{ key, def }] })
  })

  it('sans separateur : toute la ligne devient la cle, definition vide', () => {
    expect(selectionToFlat(['maille serree'], 'abbreviations'))
      .toEqual({ abbr: [{ key: 'maille serree', def: '' }] })
  })

  it('ne coupe que sur le PREMIER separateur', () => {
    expect(selectionToFlat(['ms = maille serree : 1 jete'], 'abbreviations'))
      .toEqual({ abbr: [{ key: 'ms', def: 'maille serree : 1 jete' }] })
  })

  it('separateur en tete de ligne : pas de decoupe, toute la ligne est la cle', () => {
    // Ligne comme « = maille » ou « : augmentation » — le separateur est au debut.
    // La garde m.index === 0 empeche de decouper, sinon la cle serait vide.
    expect(selectionToFlat(['= maille'], 'abbreviations'))
      .toEqual({ abbr: [{ key: '= maille', def: '' }] })
    expect(selectionToFlat([': augmentation'], 'abbreviations'))
      .toEqual({ abbr: [{ key: ': augmentation', def: '' }] })
  })
})

describe('tableau des tailles', () => {
  const S3 = { sizeLabels: ['S', 'M', 'L'] }

  it('decoupe la notation papier en label + valeurs', () => {
    expect(selectionToFlat(['Tour de poitrine 90 (100) 110'], 'measurements', S3))
      .toEqual({ sizeTable: [{ label: 'Tour de poitrine', values: ['90', '100', '110'] }] })
  })

  it('traite plusieurs lignes independamment', () => {
    const out = selectionToFlat(
      ['Tour de poitrine 90 (100) 110', 'Longueur totale 55 (58) 61'],
      'measurements',
      S3
    )
    expect(out.sizeTable).toEqual([
      { label: 'Tour de poitrine', values: ['90', '100', '110'] },
      { label: 'Longueur totale', values: ['55', '58', '61'] },
    ])
  })

  it('gabarit de repli quand le decoupage echoue : la ligne devient le label, colonnes vides', () => {
    expect(selectionToFlat(['Mesures prises a plat'], 'measurements', S3))
      .toEqual({ sizeTable: [{ label: 'Mesures prises a plat', values: ['', '', ''] }] })
  })

  it('gabarit de repli quand le nombre de valeurs ne correspond pas au nombre de tailles', () => {
    // Deux valeurs pour trois tailles : applySizeVectors ne retient QUE les vecteurs de
    // longueur n — la ligne part donc au gabarit plutot que d'inventer une 3e valeur.
    expect(selectionToFlat(['Longueur dos 40 (42)'], 'measurements', S3))
      .toEqual({ sizeTable: [{ label: 'Longueur dos 40 (42)', values: ['', '', ''] }] })
  })

  it('patron sans tailles : gabarit a zero colonne, rien de perdu', () => {
    expect(selectionToFlat(['Tour de poitrine 90'], 'measurements', { sizeLabels: [] }))
      .toEqual({ sizeTable: [{ label: 'Tour de poitrine 90', values: [] }] })
  })

  it('deux vecteurs valides sur la meme ligne : gabarit plutot que d en choisir un', () => {
    // Deux mesures completes sur une ligne : impossible de savoir laquelle affecter a la rangee
    // Sans la garde c.length === 1, le code prendrait le premier vecteur et inventerait
    // une rangee fausse. La grammaire de non-invention exige de partir au gabarit.
    expect(selectionToFlat(['Poitrine 90 (100) 110 et longueur 55 (58) 61'], 'measurements', S3))
      .toEqual({ sizeTable: [{ label: 'Poitrine 90 (100) 110 et longueur 55 (58) 61', values: ['', '', ''] }] })
  })

  it('ligne qui n est que valeurs : gabarit plutot qu etiquette vide', () => {
    // Cas rare dans les tableaux mal extraits : une ligne reduite aux seules valeurs
    // « 90 (100) 110 » sans libelle. Apres remplacement de {{0}}, le label serait vide.
    // La garde if (label) rejette ce cas au gabarit plutot que de creer une rangee sans nom.
    expect(selectionToFlat(['90 (100) 110'], 'measurements', S3))
      .toEqual({ sizeTable: [{ label: '90 (100) 110', values: ['', '', ''] }] })
  })
})

// La fusion (mergeIntoReference, tache 5) re-emet le corps EXISTANT du bloc en meme temps
// que les nouvelles lignes : quand ce corps est une table, la selection contient son en-tete
// et sa separatrice. Sans ce traitement, chaque fusion ajouterait une rangee parasite
// « | mesure | | | | ».
describe('tables deja formees dans la selection', () => {
  const S3 = { sizeLabels: ['S', 'M', 'L'] }

  it('ecarte l en-tete et la separatrice d une table existante', () => {
    const out = selectionToFlat(
      ['| mesure | S | M | L |', '|---|---|---|---|', '| Tour de poitrine | 74 | 82 | 90 |'],
      'measurements',
      S3
    )
    expect(out).toEqual({ sizeTable: [{ label: 'Tour de poitrine', values: ['74', '82', '90'] }] })
  })

  it('melange une rangee existante et une ligne en notation papier', () => {
    const out = selectionToFlat(
      [
        '| mesure | S | M | L |',
        '|---|---|---|---|',
        '| Tour de poitrine | 74 | 82 | 90 |',
        'Longueur totale 55 (58) 61',
      ],
      'measurements',
      S3
    )
    expect(out.sizeTable).toEqual([
      { label: 'Tour de poitrine', values: ['74', '82', '90'] },
      { label: 'Longueur totale', values: ['55', '58', '61'] },
    ])
  })

  // Revue finale (C1) : ce test epinglait AVANT une perte de donnees. Il attendait
  // `values: ['', '', '']` et l'appelait « gabarit, label conserve » : les valeurs reellement
  // saisies (40, 42) disparaissaient des qu'une rangee n'avait pas exactement n cellules,
  // c'est-a-dire des qu'on corrigeait le champ Tailles — le geste meme pour lequel ce champ
  // a ete cree. Le contrat est desormais l'inverse : AUCUNE cellule ne disparait, dans aucun
  // des deux sens. Completer avec des cases vides n'invente rien ; le surplus, lui, survit.
  it('rangee trop courte : completee par des cases vides, valeurs saisies conservees', () => {
    expect(selectionToFlat(['| Longueur dos | 40 | 42 |'], 'measurements', S3))
      .toEqual({ sizeTable: [{ label: 'Longueur dos', values: ['40', '42', ''] }] })
  })

  it('rangee trop longue : le surplus est replie dans la derniere colonne, jamais tronque', () => {
    expect(selectionToFlat(['| Longueur dos | 40 | 42 | 44 | 46 |'], 'measurements', S3))
      .toEqual({ sizeTable: [{ label: 'Longueur dos', values: ['40', '42', '44 46'] }] })
  })

  it('patron sans tailles : une rangee deja formee garde ses valeurs dans une colonne', () => {
    // n = 0 : la largeur minimale de 1 colonne evite que tout ce qui suit le label parte
    // a la poubelle (cf. fitSizeRowValues, reader.js).
    expect(selectionToFlat(['| Tour de poitrine | 90 | 100 |'], 'measurements', { sizeLabels: [] }))
      .toEqual({ sizeTable: [{ label: 'Tour de poitrine', values: ['90 100'] }] })
  })

  it('glossaire : une rangee existante garde sa cle et sa definition', () => {
    const out = selectionToFlat(
      ['| abr. | définition |', '|------|------------|', '| m | maille |', 'aug = augmentation'],
      'abbreviations'
    )
    expect(out).toEqual({
      abbr: [{ key: 'm', def: 'maille' }, { key: 'aug', def: 'augmentation' }],
    })
  })

  it('hors rubriques a table, une ligne commencant par | reste du contenu', () => {
    expect(selectionToFlat(['| pas une table', 'Coton DK'], 'yarn'))
      .toEqual({ yarn: '| pas une table\nCoton DK' })
  })
})

describe('garde-fous', () => {
  it('renvoie null pour un tag qui n est pas une balise de reference', () => {
    expect(selectionToFlat(['Corps'], 'sleeve')).toBeNull()
    expect(selectionToFlat(['Corps'], 'intro')).toBeNull()
  })
  it('renvoie null pour une selection vide ou blanche', () => {
    expect(selectionToFlat([], 'yarn')).toBeNull()
    expect(selectionToFlat(['', '   '], 'yarn')).toBeNull()
  })
  it('ignore les lignes vides au milieu de la selection', () => {
    expect(selectionToFlat(['Coton DK', '', '3 pelotes'], 'yarn'))
      .toEqual({ yarn: 'Coton DK\n3 pelotes' })
  })
})

// La recherche doit couvrir le modèle, sinon le champ ajouté est introuvable. Retour terrain, 16/07.
import { describe, it, expect } from 'vitest'
import {
  matchesQuery, matchesLabel, matchesBrand, NO_BRAND, sortYarns,
  matchesWeight, matchesGrams, colorFamily, matchesColorFamily, COLOR_CUSTOM, matchesComposition,
} from '@/utils/yarn-filter'
import { YARN_WEIGHTS } from '@/constants/catalog'
import { COLOR_PALETTE } from '@/constants/swatch'

const laine = { brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu glacier' }

describe('recherche de laine', () => {
  it('trouve par la marque', () => {
    expect(matchesQuery(laine, 'drops')).toBe(true)
  })

  it('trouve par le modèle', () => {
    expect(matchesQuery(laine, 'baby merino')).toBe(true)
  })

  it('trouve par le coloris', () => {
    expect(matchesQuery(laine, 'glacier')).toBe(true)
  })

  it('ne trouve pas ce qui n’existe pas', () => {
    expect(matchesQuery(laine, 'alpaga')).toBe(false)
  })

  it('tolère un modèle absent', () => {
    expect(matchesQuery({ brand: 'Drops', colorName: 'Écru' }, 'drops')).toBe(true)
  })

  // Régression : un modèle vide (cas de TOUTES les laines d'avant l'ajout du champ) ne doit pas
  // laisser un trou dans la chaîne cherchée, sinon « drops bleu » cesse de matcher alors qu'il
  // matchait avant l'ajout du modèle. Revue T2 16/07.
  it('trouve sur deux mots quand le modèle est absent', () => {
    expect(matchesQuery({ brand: 'Drops', colorName: 'Bleu glacier' }, 'drops bleu')).toBe(true)
  })

  it('trouve sur deux mots à cheval sur la marque et le modèle', () => {
    expect(matchesQuery(laine, 'drops baby')).toBe(true)
  })

  it('trouve par les couleurs en mots (pelote multicolore)', () => {
    expect(matchesQuery({ brand: 'Drops', colorName: 'Mix', colorNotes: 'vert émeraude' }, 'émeraude')).toBe(true)
  })

  it('trouve par le type de coloris traduit, quand une fonction t est fournie', () => {
    const t = (key) => (key === 'yarn.colorTypes.mouchete' ? 'Moucheté' : key)
    expect(matchesQuery({ brand: 'Drops', colorName: 'Mix', colorType: 'mouchete' }, 'moucheté', t)).toBe(true)
  })

  it('un type "uni" ne s’ajoute pas au texte cherché (comme il ne s’affiche pas à l’écran)', () => {
    const t = (key) => (key === 'yarn.colorTypes.uni' ? 'Uni' : key)
    expect(matchesQuery({ brand: 'Drops', colorName: 'Bleu', colorType: 'uni' }, 'uni', t)).toBe(false)
  })

  it('sans fonction t fournie, le type de coloris est simplement ignoré (pas de crash)', () => {
    const yarn = { brand: 'Drops', colorName: 'Mix', colorType: 'mouchete' }
    expect(() => matchesQuery(yarn, 'mouchete')).not.toThrow()
    expect(matchesQuery(yarn, 'mouchete')).toBe(false)
  })

  it('accepte tout quand la recherche est vide', () => {
    expect(matchesQuery(laine, '')).toBe(true)
  })
})

// `yarn.purchasedAt` a quitté le formulaire — le tri lit
// désormais le registre d'achats via `linesFor(yarnId)` (`usePurchasesStore().forYarn`
// en vrai). AVANT ce correctif, le tri lisait encore `yarn.purchasedAt` : un champ
// qu'aucune fiche créée depuis ne porte plus jamais, donc toute laine neuve
// dégénérait silencieusement en fin de liste, pour toujours (revue précédente).
describe('tri du stock par date d’achat', () => {
  // Une seule ligne par laine ici (le cas multi-lignes — « la plus récente compte » —
  // est couvert par latestPurchaseDate lui-même, tests/unit/yarn-purchases-derived.spec.js).
  // Dates et marques toutes distinctes (règle du projet) : aucune coïncidence qui
  // laisserait passer un tri faux.
  const linesById = {
    1: [{ date: '2024-01-10' }],
    2: [{ date: '2026-07-01' }],
    3: [], // aucune ligne d'achat enregistrée
    4: [{ date: '2025-03-05' }],
  }
  const linesFor = (id) => linesById[id] || []
  const stock = [
    { id: 1, brand: 'Drops' },
    { id: 2, brand: 'Phildar' },
    { id: 3, brand: 'Katia' },
    { id: 4, brand: 'Bergère' },
  ]

  it('met l’achat le plus récent en premier (mai passe avant janvier)', () => {
    const tri = sortYarns(stock, 'purchasedAt', linesFor)
    expect(tri.map((y) => y.brand)).toEqual(['Phildar', 'Bergère', 'Drops', 'Katia'])
  })

  it('range en dernier une laine sans aucune ligne d’achat, sans la perdre', () => {
    const tri = sortYarns(stock, 'purchasedAt', linesFor)
    expect(tri).toHaveLength(4)
    expect(tri[tri.length - 1].brand).toBe('Katia')
  })

  it('une laine neuve sans historique (linesFor absent) ne casse pas le tri', () => {
    // Régression du bug signalé par la revue précédente : sans `linesFor`, le tri ne
    // doit ni planter ni lire un champ `purchasedAt` qui n'existe plus sur la laine.
    expect(() => sortYarns(stock, 'purchasedAt')).not.toThrow()
  })

  it('ne modifie pas la liste d’origine', () => {
    const copie = [...stock]
    sortYarns(stock, 'purchasedAt', linesFor)
    expect(stock).toEqual(copie)
  })

  it('trie toujours par marque quand on le demande', () => {
    const tri = sortYarns(stock, 'brand')
    expect(tri.map((y) => y.brand)).toEqual(['Bergère', 'Drops', 'Katia', 'Phildar'])
  })
})

// Filet sur weightOrder (déplacée de StashView.vue vers yarn-filter.js) : aucun test direct
// ne couvrait le tri par épaisseur. On dérive l'attendu de YARN_WEIGHTS lui-même (ordre réel
// lace → superbulky) plutôt que de recopier un extrait à la main, pour ne pas figer un ordre
// qui divergerait discrètement du catalogue.
describe('tri du stock par épaisseur', () => {
  it('trie toujours par épaisseur (lace → superbulky) quand on le demande', () => {
    const tri = sortYarns([{ brand: 'Z', weight: 'superbulky' }, { brand: 'A', weight: 'lace' }], 'weight')
    expect(tri.map((y) => y.weight)).toEqual(['lace', 'superbulky'])
  })

  it('remet dans l’ordre du catalogue une liste inversée, sur les 8 épaisseurs', () => {
    const inversee = [...YARN_WEIGHTS].reverse().map((w, i) => ({ brand: String(i), weight: w }))
    const tri = sortYarns(inversee, 'weight')
    expect(tri.map((y) => y.weight)).toEqual(YARN_WEIGHTS)
  })
})

describe('matchesLabel', () => {
  it('retient la laine qui porte la caractéristique', () => {
    expect(matchesLabel({ labels: ['vegan', 'gots'] }, 'vegan')).toBe(true)
  })
  it('écarte celle qui ne la porte pas', () => {
    expect(matchesLabel({ labels: ['gots'] }, 'vegan')).toBe(false)
    expect(matchesLabel({}, 'vegan')).toBe(false)
  })
  it('retient TOUT quand aucun filtre n’est choisi', () => {
    expect(matchesLabel({ labels: [] }, '')).toBe(true)
    expect(matchesLabel({}, null)).toBe(true)
  })
})

describe('matchesBrand', () => {
  it('retient la laine de la marque choisie', () => {
    expect(matchesBrand({ brand: 'Drops' }, 'Drops')).toBe(true)
  })
  it('écarte une autre marque', () => {
    expect(matchesBrand({ brand: 'Katia' }, 'Drops')).toBe(false)
  })
  it('retient TOUT quand aucun filtre n\'est choisi', () => {
    expect(matchesBrand({ brand: 'Drops' }, '')).toBe(true)
    expect(matchesBrand({}, '')).toBe(true)
  })
  it('NO_BRAND retient les laines sans marque, écarte les autres', () => {
    expect(matchesBrand({ brand: '' }, NO_BRAND)).toBe(true)
    expect(matchesBrand({}, NO_BRAND)).toBe(true)
    expect(matchesBrand({ brand: '  ' }, NO_BRAND)).toBe(true)
    expect(matchesBrand({ brand: 'Drops' }, NO_BRAND)).toBe(false)
  })
})

describe('recherche par caractéristique', () => {
  it('trouve une laine en tapant le libellé traduit', () => {
    // Sur le LIBELLÉ, pas la clé interne — c'est ce que l'utilisatrice voit et tape
    // (même règle que pour le type de coloris, yarn-filter.js:18).
    const t = (k) => ({ 'yarn.labels.vegan': 'Vegan', 'yarn.labels.gots': 'Fibres biologiques (GOTS)' })[k] || k
    expect(matchesQuery({ brand: 'Drops', labels: ['vegan'] }, 'vegan', t)).toBe(true)
    expect(matchesQuery({ brand: 'Drops', labels: ['gots'] }, 'biologiques', t)).toBe(true)
    expect(matchesQuery({ brand: 'Drops', labels: [] }, 'vegan', t)).toBe(false)
  })
})

// Les filtres des nouveaux menus popup.
// Pour la couleur, on pioche une VRAIE entrée du registre COLOR_PALETTE (aucun hsl
// recopié à la main) : si la palette bouge, le test suit — et il ne peut pas passer
// par coïncidence sur une valeur inventée.
const paletteBleu = COLOR_PALETTE.find((c) => c.key === 'bleu')
// Couleur sûrement hors palette (aucune teinte nommée n'approche saturation 99 % ni
// luminosité 99 %) : le contrat de isCustomColor fait le reste.
const couleurPerso = 'hsl(359 99% 99%)'

describe('matchesWeight', () => {
  it('retient la laine de l’épaisseur choisie', () => {
    expect(matchesWeight({ weight: 'dk' }, 'dk')).toBe(true)
  })
  it('écarte une autre épaisseur', () => {
    expect(matchesWeight({ weight: 'lace' }, 'dk')).toBe(false)
  })
  it('retient TOUT quand aucun filtre n’est choisi', () => {
    expect(matchesWeight({ weight: 'dk' }, '')).toBe(true)
    expect(matchesWeight({}, '')).toBe(true)
    expect(matchesWeight(null, '')).toBe(true)
  })
  it('écarte une laine sans épaisseur (ou inexistante) quand un filtre est choisi', () => {
    expect(matchesWeight({}, 'dk')).toBe(false)
    expect(matchesWeight({ weight: '' }, 'dk')).toBe(false)
    expect(matchesWeight(null, 'dk')).toBe(false)
    expect(matchesWeight(undefined, 'dk')).toBe(false)
  })
})

describe('matchesGrams', () => {
  it('retient la laine du métrage choisi (nombre ou texte de menu)', () => {
    expect(matchesGrams({ grams: 50 }, 50)).toBe(true)
    expect(matchesGrams({ grams: 50 }, '50')).toBe(true)
  })
  it('rattrape une fiche ancienne dont le métrage est stocké en chaîne', () => {
    expect(matchesGrams({ grams: '50' }, 50)).toBe(true)
  })
  it('tolère la virgule décimale des deux côtés', () => {
    expect(matchesGrams({ grams: '22,5' }, '22,5')).toBe(true)
  })
  it('écarte une autre valeur', () => {
    expect(matchesGrams({ grams: 50 }, 100)).toBe(false)
  })
  it('retient TOUT quand aucun filtre n’est choisi', () => {
    expect(matchesGrams({ grams: 50 }, '')).toBe(true)
    expect(matchesGrams({}, '')).toBe(true)
  })
  it('une laine sans métrage exploitable ne matche AUCUNE valeur choisie', () => {
    expect(matchesGrams({}, 50)).toBe(false)
    expect(matchesGrams({ grams: '' }, 50)).toBe(false)
    expect(matchesGrams({ grams: null }, 50)).toBe(false)
    expect(matchesGrams({ grams: 'à peu près' }, 50)).toBe(false)
    expect(matchesGrams(null, 50)).toBe(false)
  })
  // Number('') === 0 : sans garde sur le champ brut, une fiche vide passerait pour
  // un 0 g et resterait visible sous le menu « 0 ». On ne fabrique jamais un 0.
  it('une fiche vide (ou d’espaces seuls) ne matche pas non plus l’option « 0 »', () => {
    expect(matchesGrams({ grams: '' }, '0')).toBe(false)
    // parseDecimal(' ') === 0 : sans trim, des espaces seuls passeraient pour un 0 g.
    expect(matchesGrams({ grams: '   ' }, '0')).toBe(false)
    expect(matchesGrams({ grams: undefined }, 0)).toBe(false)
  })
})

describe('colorFamily', () => {
  it('reconnaît une couleur de la palette et rend sa clé', () => {
    expect(colorFamily({ color: paletteBleu.hsl })).toBe('bleu')
  })
  it('rend la sentinelle COLOR_CUSTOM pour une couleur hors palette', () => {
    expect(colorFamily({ color: couleurPerso })).toBe(COLOR_CUSTOM)
  })
  it('rend une chaîne vide pour une laine sans couleur', () => {
    expect(colorFamily({})).toBe('')
    expect(colorFamily({ color: '' })).toBe('')
    expect(colorFamily(null)).toBe('')
    expect(colorFamily(undefined)).toBe('')
  })
})

describe('matchesColorFamily', () => {
  it('retient la laine de la famille choisie', () => {
    expect(matchesColorFamily({ color: paletteBleu.hsl }, 'bleu')).toBe(true)
  })
  it('écarte une autre famille', () => {
    expect(matchesColorFamily({ color: paletteBleu.hsl }, 'rouge')).toBe(false)
  })
  it('COLOR_CUSTOM ne retient que les couleurs hors palette', () => {
    expect(matchesColorFamily({ color: couleurPerso }, COLOR_CUSTOM)).toBe(true)
    expect(matchesColorFamily({ color: paletteBleu.hsl }, COLOR_CUSTOM)).toBe(false)
  })
  it('retient TOUT quand aucun filtre n’est choisi', () => {
    expect(matchesColorFamily({ color: paletteBleu.hsl }, '')).toBe(true)
    expect(matchesColorFamily({ color: '' }, '')).toBe(true)
  })
  it('une laine sans couleur ne matche rien quand un filtre est choisi', () => {
    expect(matchesColorFamily({}, 'bleu')).toBe(false)
    expect(matchesColorFamily({ color: '' }, COLOR_CUSTOM)).toBe(false)
    expect(matchesColorFamily(null, 'bleu')).toBe(false)
  })
})

describe('matchesComposition', () => {
  it('retient la laine qui contient la matière', () => {
    expect(matchesComposition({ composition: ['laine', 'alpaga'] }, 'alpaga')).toBe(true)
  })
  it('écarte celle qui ne la contient pas', () => {
    expect(matchesComposition({ composition: ['coton'] }, 'alpaga')).toBe(false)
  })
  it('retient TOUT quand aucun filtre n’est choisi', () => {
    expect(matchesComposition({ composition: ['laine'] }, '')).toBe(true)
    expect(matchesComposition({ composition: [] }, '')).toBe(true)
  })
  it('écarte une laine sans composition quand une matière est choisie', () => {
    expect(matchesComposition({}, 'laine')).toBe(false)
    expect(matchesComposition({ composition: [] }, 'laine')).toBe(false)
    expect(matchesComposition(null, 'laine')).toBe(false)
  })
  // normalizeComposition dédoublonne : une fiche saisie deux fois ne doit ni planter
  // ni masquer les autres matières.
  it('les doublons dans la composition ne gênent pas le filtre', () => {
    expect(matchesComposition({ composition: ['laine', 'laine', 'coton'] }, 'coton')).toBe(true)
    expect(matchesComposition({ composition: ['laine', 'laine'] }, 'coton')).toBe(false)
  })
})

// Mapping d'UNE ligne déjà keyée par champ (field-aliases.js) vers les objets partiels
// yarn/purchase de rowtine. Cas limites couverts : Weight non reconnu
// → '' (jamais un bucket approché), repli Yards→Meters, Price paid ÷ Skeins.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mapRow } from '@/utils/ravelry-import/map-row'
import { COLOR_PALETTE } from '@/constants/swatch'

const paletteHsl = (key) => COLOR_PALETTE.find((c) => c.key === key).hsl

describe('mapRow, champs simples', () => {
  it('mappe marque/modele/coloris/lieu de rangement tels quels (cales/trim)', () => {
    const { yarn } = mapRow({ brand: 'Drops', model: 'Baby Merino', colorway: '  Bleu nuit  ', storedIn: 'Etagere 2' })
    expect(yarn).toMatchObject({ brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu nuit', storedIn: 'Etagere 2' })
  })

  it('cale une marque connue sur son orthographe du catalogue rowtine, insensible a la casse', () => {
    const { yarn } = mapRow({ brand: 'cheval blanc' })
    expect(yarn.brand).toBe('Cheval Blanc')
  })

  it('marque inconnue du catalogue : gardee telle quelle', () => {
    const { yarn } = mapRow({ brand: 'Lammy Yarns' })
    expect(yarn.brand).toBe('Lammy Yarns')
  })
})

describe('mapRow, epaisseur (Weight)', () => {
  it.each([
    ['Lace', 'lace'],
    ['Fingering (14 wpi)', 'fingering'],
    ['Sport (12 wpi)', 'sport'],
    ['DK (11 wpi)', 'dk'],
    ['Worsted (9 wpi)', 'worsted'],
    ['Aran', 'aran'],
    ['Bulky', 'bulky'],
    ['Super Bulky', 'superbulky'],
    ['Jumbo', 'superbulky'],
  ])('%s → %s', (raw, expected) => {
    expect(mapRow({ weight: raw }).yarn.weight).toBe(expected)
  })

  it('valeur non reconnue → chaine vide, jamais un bucket approche', () => {
    expect(mapRow({ weight: 'Thread' }).yarn.weight).toBe('')
    expect(mapRow({ weight: '' }).yarn.weight).toBe('')
    expect(mapRow({}).yarn.weight).toBe('')
  })
})

describe('mapRow, metrage', () => {
  it('Meters/skein present : utilise tel quel', () => {
    expect(mapRow({ metersPerSkein: 105 }).yarn.lengthM).toBe(105)
  })

  it('Meters/skein absent : converti depuis Yards/skein (× 0.9144)', () => {
    expect(mapRow({ yardsPerSkein: 115 }).yarn.lengthM).toBeCloseTo(105.156, 2)
  })

  it('ni l\'un ni l\'autre : chaine vide', () => {
    expect(mapRow({}).yarn.lengthM).toBe('')
  })
})

describe('mapRow, quantites et prix', () => {
  it('Remaining skeins → yarn.quantity (stock actuel), Skeins → purchase.quantity (achat d\'origine)', () => {
    const { yarn, purchase } = mapRow({ remainingSkeins: 2, skeins: 5 })
    expect(yarn.quantity).toBe(2)
    expect(purchase.quantity).toBe(5)
  })

  it('Price paid divise par Skeins', () => {
    expect(mapRow({ pricePaid: 15, skeins: 3 }).purchase.unitPrice).toBe(5)
  })

  it('Skeins a 0 ou absent : Price paid garde tel quel (rien a diviser)', () => {
    expect(mapRow({ pricePaid: 12, skeins: 0 }).purchase.unitPrice).toBe(12)
    expect(mapRow({ pricePaid: 12 }).purchase.unitPrice).toBe(12)
  })

  it('Price paid absent : prix vide', () => {
    expect(mapRow({ skeins: 3 }).purchase.unitPrice).toBe('')
  })

  it('nombres en chaîne à virgule décimale (CSV retouché) : lus comme décimaux', () => {
    const { yarn, purchase } = mapRow({ pricePaid: '12,50', skeins: '2,5', gramsPerSkein: '1 234,5', metersPerSkein: '105' })
    expect(purchase.quantity).toBe(2.5)
    expect(purchase.unitPrice).toBe(5)
    expect(yarn.grams).toBe(1234.5)
    expect(yarn.lengthM).toBe(105)
  })
})

describe('mapRow, achat (bain, date, lieu d\'achat)', () => {
  it('Dye lot → purchase.bain, Purchased at → purchase.purchasedFrom', () => {
    const { purchase } = mapRow({ dyeLot: 'A123', purchasedAt: 'Boutique X' })
    expect(purchase.bain).toBe('A123')
    expect(purchase.purchasedFrom).toBe('Boutique X')
  })

  it('Purchase date en chaine : gardee telle quelle', () => {
    expect(mapRow({ purchaseDate: '2026-05-23' }).purchase.date).toBe('2026-05-23')
  })

  it('Purchase date non ISO (CSV retouché) : date vide, valeur brute gardée en note', () => {
    const { yarn, purchase } = mapRow({ purchaseDate: '09/25/2026', comments: 'Douce' })
    expect(purchase.date).toBe('')
    expect(yarn.notes).toBe('Douce\nPurchase date : 09/25/2026')
  })

  it('Purchase date en objet Date (cellule Excel typee date) : convertie en AAAA-MM-JJ', () => {
    expect(mapRow({ purchaseDate: new Date(Date.UTC(2026, 4, 23)) }).purchase.date).toBe('2026-05-23')
  })

  // SheetJS (cellDates: true) ancre une date de cellule Excel a minuit UTC du jour calendaire
  // vise. Composantes LOCALES (ymdLocal) donneraient la veille a l'ouest de Greenwich ; le
  // resultat doit rester le meme quel que soit process.env.TZ de la machine qui importe.
  describe('independance du fuseau horaire de la machine', () => {
    const TZ_ORIGINE = process.env.TZ
    beforeEach(() => {
      process.env.TZ = 'America/Los_Angeles'
    })
    afterEach(() => {
      if (TZ_ORIGINE === undefined) delete process.env.TZ
      else process.env.TZ = TZ_ORIGINE
    })

    it('minuit UTC du 23 mai reste le 23 mai, meme depuis Los Angeles', () => {
      expect(mapRow({ purchaseDate: new Date(Date.UTC(2026, 4, 23)) }).purchase.date).toBe('2026-05-23')
    })
  })
})

describe('mapRow, notes', () => {
  it('Comments seul : repris tel quel', () => {
    expect(mapRow({ comments: 'Douce, pour un pull bebe' }).yarn.notes).toBe('Douce, pour un pull bebe')
  })

  it('Color family sans pastille ET Colorway présent / Color Attributes / Tag List en annexe, une ligne chacun', () => {
    const notes = mapRow({
      comments: 'Douce',
      colorway: 'Arc-en-ciel',
      colorFamily: 'Multicolored',
      colorAttributes: 'heathered',
      tagList: 'gift, cardigan',
    }).yarn.notes
    expect(notes).toBe('Douce\nColor family : Multicolored\nColor attributes : heathered\nTags : gift, cardigan')
  })

  it('Color family devenue pastille : plus reprise en annexe', () => {
    expect(mapRow({ colorway: 'Bleu nuit', colorFamily: 'Blue' }).yarn.notes).toBe('')
    expect(mapRow({ colorFamily: 'Gray' }).yarn.notes).toBe('')
  })

  it('rien a annexer : notes vides', () => {
    expect(mapRow({}).yarn.notes).toBe('')
  })
})

// « Closest color? » d'une fiche Ravelry, exporté dans la colonne « Color family » (valeurs
// toujours en anglais, quelle que soit la langue du site : vérifié le 23/09/2026).
describe('mapRow, couleur (Colorway puis Closest color)', () => {
  it('Colorway vide : le nom retombe sur la pastille issue de Closest color, pastille sélectionnée', () => {
    const { yarn } = mapRow({ colorFamily: 'Gray' })
    expect(yarn.colorName).toBe('Gris')
    expect(yarn.color).toBe(paletteHsl('gris'))
  })

  it('Colorway présent : il garde la main sur le nom, la pastille vient quand même de Closest color', () => {
    const { yarn } = mapRow({ colorway: 'Light Grey Melange', colorFamily: 'Blue' })
    expect(yarn.colorName).toBe('Light Grey Melange')
    expect(yarn.color).toBe(paletteHsl('bleu'))
  })

  it('les 20 valeurs Ravelry : 18 pastilles, Multicolored et Rainbow sans pastille', () => {
    const expected = {
      Black: 'noir', Blue: 'bleu', 'Blue-green': 'turquoise', 'Blue-purple': 'lavande', Brown: 'marron',
      Gray: 'gris', Green: 'vert', 'Natural/Undyed': 'ecru', Orange: 'orange', Pink: 'rose',
      Purple: 'violet', Red: 'rouge', 'Red-orange': 'corail', 'Red-purple': 'prune', White: 'blanc',
      Yellow: 'jaune', 'Yellow-green': 'kaki', 'Yellow-orange': 'moutarde',
    }
    for (const [family, key] of Object.entries(expected)) {
      expect(mapRow({ colorFamily: family }).yarn.color, family).toBe(paletteHsl(key))
    }
    for (const family of ['Multicolored', 'Rainbow']) {
      expect(mapRow({ colorFamily: family }).yarn.color, family).toBe('')
    }
  })

  it('insensible à la casse et aux espaces', () => {
    expect(mapRow({ colorFamily: '  gray ' }).yarn.color).toBe(paletteHsl('gris'))
  })

  it('sans pastille et sans Colorway : le nom reprend la valeur Ravelry telle quelle', () => {
    const { yarn } = mapRow({ colorFamily: 'Multicolored' })
    expect(yarn.colorName).toBe('Multicolored')
    expect(yarn.color).toBe('')
  })

  it('ni Colorway ni Closest color : nom et pastille vides', () => {
    const { yarn } = mapRow({})
    expect(yarn.colorName).toBe('')
    expect(yarn.color).toBe('')
  })

  it('signale un nom de couleur de repli (pour le dédoublonnage des imports précédents)', () => {
    expect(mapRow({ colorFamily: 'Gray' }).colorNameFromFamily).toBe(true)
    expect(mapRow({ colorway: 'Rosalinda', colorFamily: 'Pink' }).colorNameFromFamily).toBe(false)
    expect(mapRow({}).colorNameFromFamily).toBe(false)
  })
})

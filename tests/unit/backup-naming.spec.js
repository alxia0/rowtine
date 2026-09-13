// Unitaire — helpers de nommage & data URL pour la sérialisation de sauvegarde.
import { describe, it, expect } from 'vitest'
import { slugify, entryFolderName, parseEntryId, displayEntryName, parseDataUrl, photoFileName } from '@/backup/naming'

describe('slugify', () => {
  it('translittère les accents et retire le slash (propriétés garanties)', () => {
    // Cas représentatif : on vérifie les propriétés garanties plutôt qu'une
    // chaîne exacte, car le sort des caractères hors de la liste interdite (apostrophe,
    // #…) n'est pas spécifié — ils restent (légaux sur le système de fichiers).
    const s = slugify("Écharpe d'été / #1")
    expect(s).not.toMatch(/[/\\:*?"<>|]/) // pas de caractère interdit
    expect(s).not.toMatch(/[àâäçéèêëîïôöùûü]/i) // accents translittérés
    expect(s).toBe(s.toLowerCase())
    expect(s).not.toMatch(/\s/) // pas d'espace
  })

  it('translittère les accents (cas simple sans ponctuation ambiguë)', () => {
    expect(slugify('Café Crème')).toBe('cafe-creme')
  })

  it('met en minuscules et remplace les espaces par des tirets', () => {
    expect(slugify('Pull Torsadé')).toBe('pull-torsade')
  })

  it('retire tous les caractères illégaux pour un système de fichiers', () => {
    expect(slugify('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
  })

  it('retire les caractères de contrôle', () => {
    expect(slugify('a b\tc')).toBe('a-b-c')
  })

  it('collapse les tirets répétés', () => {
    expect(slugify('a   b---c')).toBe('a-b-c')
  })

  it('coupe les tirets en début et fin de chaîne', () => {
    expect(slugify('  -Bonjour-  ')).toBe('bonjour')
  })

  it('borne la longueur à ~60 caractères', () => {
    const long = 'a'.repeat(100)
    const slug = slugify(long)
    expect(slug.length).toBeLessThanOrEqual(60)
  })

  it("ne coupe pas au milieu en laissant un tiret final après troncature", () => {
    const long = 'mot-'.repeat(30) // 120 chars, plein de tirets
    const slug = slugify(long)
    expect(slug.endsWith('-')).toBe(false)
  })

  it('tronque sans couper un caractère astral (emoji) en deux', () => {
    // 65 emoji (+ 'a') = 66 points de code, largement au-delà des 60 autorisés :
    // on exerce vraiment la branche de troncature, pas seulement son absence.
    const s = slugify('a' + '😀'.repeat(65))
    // Un caractère astral coupé en deux laisse un substitut UTF-16 isolé (invalide).
    // On le détecte via un aller-retour d'encodage UTF-8 (ce que fait le backup natif
    // en écrivant le nom de fichier) : un substitut isolé devient U+FFFD au décodage.
    const roundTrip = new TextDecoder('utf-8').decode(new TextEncoder().encode(s))
    expect(roundTrip).toBe(s)
    expect(roundTrip).not.toContain('�')
    // La longueur reste bornée en points de code.
    expect([...s].length).toBeLessThanOrEqual(60)
  })

  it("retourne 'sans-nom' si le résultat est vide", () => {
    expect(slugify('')).toBe('sans-nom')
    expect(slugify('   ')).toBe('sans-nom')
    expect(slugify('///***')).toBe('sans-nom')
  })

  it("retourne 'sans-nom' pour une entrée non-string (null/undefined)", () => {
    expect(slugify(null)).toBe('sans-nom')
    expect(slugify(undefined)).toBe('sans-nom')
  })
})

describe('entryFolderName', () => {
  it('combine le slug et l\'id entre crochets', () => {
    expect(entryFolderName('Pull', 7)).toBe('pull [7]')
  })

  it("gère les noms accentués", () => {
    expect(entryFolderName('Écharpe', 12)).toBe('echarpe [12]')
  })
})

describe('parseEntryId', () => {
  it('extrait l\'entier entre les derniers crochets', () => {
    expect(parseEntryId('mon-pull [42]')).toBe(42)
  })

  it('renvoie null si pas de crochets', () => {
    expect(parseEntryId('rien')).toBeNull()
  })

  it('ne matche que les crochets en fin de chaîne', () => {
    expect(parseEntryId('[1] pas a la fin')).toBeNull()
  })

  it('matche uniquement le dernier groupe de crochets si plusieurs sont présents', () => {
    expect(parseEntryId('pull [1] [42]')).toBe(42)
  })

  it('renvoie null si le dernier groupe de crochets n\'est pas numérique', () => {
    expect(parseEntryId('pull [42] [old]')).toBeNull()
  })

  it('tolère des espaces avant la fin de chaîne', () => {
    expect(parseEntryId('pull [42]   ')).toBe(42)
  })

  it('renvoie null sur une entrée vide ou non-string', () => {
    expect(parseEntryId('')).toBeNull()
    expect(parseEntryId(null)).toBeNull()
    expect(parseEntryId(undefined)).toBeNull()
  })
})

describe('displayEntryName', () => {
  // Jumeau inverse de parseEntryId : le suffixe « [id] » est un détail de stockage,
  // jamais un nom à montrer (libellé « Lecture… 12 sur 24 — <nom> » de la restauration).
  it('retire le suffixe « [id] » d\'un dossier généré par entryFolderName', () => {
    expect(displayEntryName('marisol-shawl [32]')).toBe('marisol-shawl')
  })

  it('rend tel quel un nom sans id', () => {
    expect(displayEntryName('sans-id')).toBe('sans-id')
  })

  it("l'espace avant le crochet part aussi", () => {
    expect(displayEntryName('x [12]')).toBe('x')
  })

  it("même tolérance aux espaces finaux que parseEntryId", () => {
    expect(displayEntryName('pull [42]   ')).toBe('pull')
  })

  it('rend une entrée non-string telle quelle', () => {
    expect(displayEntryName(null)).toBeNull()
    expect(displayEntryName(undefined)).toBeUndefined()
    expect(displayEntryName(42)).toBe(42)
  })

  it('round-trip avec entryFolderName (le nom affiché ne porte jamais le suffixe)', () => {
    expect(displayEntryName(entryFolderName('Marisol Shawl', 32))).toBe('marisol-shawl')
  })
})

describe('parseDataUrl', () => {
  it('découpe une data URL PNG en mime/ext/base64', () => {
    expect(parseDataUrl('data:image/png;base64,iVBOR')).toEqual({
      mime: 'image/png',
      ext: 'png',
      base64: 'iVBOR',
    })
  })

  it('mappe les extensions connues', () => {
    expect(parseDataUrl('data:image/jpeg;base64,AAAA').ext).toBe('jpg')
    expect(parseDataUrl('data:image/webp;base64,AAAA').ext).toBe('webp')
    expect(parseDataUrl('data:image/gif;base64,AAAA').ext).toBe('gif')
    expect(parseDataUrl('data:application/pdf;base64,AAAA').ext).toBe('pdf')
  })

  it('utilise bin par défaut pour un mime inconnu', () => {
    expect(parseDataUrl('data:application/octet-stream;base64,AAAA').ext).toBe('bin')
  })

  it("renvoie null si ce n'est pas une data URL", () => {
    expect(parseDataUrl('http://example.com/img.png')).toBeNull()
    expect(parseDataUrl('not a url')).toBeNull()
  })

  it("renvoie null si ce n'est pas du base64 (pas de marqueur ;base64,)", () => {
    expect(parseDataUrl('data:image/png,rawtext')).toBeNull()
  })

  it('renvoie null sur une entrée vide/non-string', () => {
    expect(parseDataUrl('')).toBeNull()
    expect(parseDataUrl(null)).toBeNull()
    expect(parseDataUrl(undefined)).toBeNull()
  })
})

describe('photoFileName', () => {
  it('produit un nom photo-<hash8>.<ext> pour une data URL valide', () => {
    const name = photoFileName('data:image/png;base64,iVBORw0KGgo', 0)
    expect(name).toMatch(/^photo-[0-9a-f]{8}\.png$/)
  })

  it('est déterministe : même entrée -> même nom', () => {
    const a = photoFileName('data:image/png;base64,iVBORw0KGgo', 0)
    const b = photoFileName('data:image/png;base64,iVBORw0KGgo', 0)
    expect(a).toBe(b)
  })

  it('est discriminant : deux contenus différents -> noms différents', () => {
    const a = photoFileName('data:image/png;base64,AAAAAAAA', 0)
    const b = photoFileName('data:image/png;base64,BBBBBBBB', 0)
    expect(a).not.toBe(b)
  })

  it('reste discriminant même avec fallbackIndex identique', () => {
    const a = photoFileName('data:image/jpeg;base64,content-one', 5)
    const b = photoFileName('data:image/jpeg;base64,content-two', 5)
    expect(a).not.toBe(b)
  })

  it('utilise le fallback si la data URL est invalide', () => {
    expect(photoFileName('not-a-data-url', 3)).toBe('photo-3.bin')
    expect(photoFileName(null, 9)).toBe('photo-9.bin')
  })

  it('ne dépend pas du fallbackIndex quand la data URL est valide (stabilité du nom)', () => {
    const a = photoFileName('data:image/png;base64,iVBORw0KGgo', 0)
    const b = photoFileName('data:image/png;base64,iVBORw0KGgo', 99)
    expect(a).toBe(b)
  })
})

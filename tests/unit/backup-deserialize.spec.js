// Unitaire — désérialiseurs d'entités (purs, sans IO) pour la restauration depuis
// l'arborescence de sauvegarde. Le cœur de la couverture est le
// ROUND-TRIP avec les sérialiseurs de S2 (serialize.js) : serialize* → deserialize*
// redonne l'entité d'origine à l'identique (photos en data URLs, ids, tableaux
// embarqués, pdf).
import { describe, it, expect } from 'vitest'
import {
  serializeProject,
  serializePattern,
  serializeYarns,
  serializeIndependentCounters,
  serializeSettings,
} from '@/backup/serialize'
import {
  extToMime,
  fileToDataUrl,
  deserializeProject,
  deserializePattern,
  deserializeYarns,
  deserializeIndependentCounters,
  deserializeSettings,
} from '@/backup/deserialize'
import { DEMO_SKETCH_BONNET, DEMO_SKETCH_ECHARPE, DEMO_SKETCH_SAC } from '@/constants/demo-visuals'

const PHOTO_A = 'data:image/jpeg;base64,AAAA'
const PHOTO_B = 'data:image/png;base64,BBBB'
const PDF = 'data:application/pdf;base64,CCCC'

// Construit le filesByName (convention documentée dans deserialize.js) d'un dossier
// à partir des `files` renvoyés par un sérialiseur S2 : { basename: data }, en
// retirant le fichier JSON principal du dossier (fourni séparément, déjà parsé).
function toFilesByName(files, dir, mainJsonName) {
  const map = {}
  for (const f of files) {
    if (!f.path.startsWith(`${dir}/`)) continue
    const name = f.path.slice(dir.length + 1)
    if (name === mainJsonName) continue
    map[name] = f.data
  }
  return map
}

function mainJson(files, dir, mainJsonName) {
  const f = files.find((f) => f.path === `${dir}/${mainJsonName}`)
  return f ? JSON.parse(f.data) : null
}

describe('extToMime', () => {
  it('mappe les extensions connues vers leur type mime', () => {
    expect(extToMime('jpg')).toBe('image/jpeg')
    expect(extToMime('png')).toBe('image/png')
    expect(extToMime('webp')).toBe('image/webp')
    expect(extToMime('gif')).toBe('image/gif')
    expect(extToMime('pdf')).toBe('application/pdf')
  })

  it('retombe sur application/octet-stream pour une extension inconnue', () => {
    expect(extToMime('bin')).toBe('application/octet-stream')
    expect(extToMime('xyz')).toBe('application/octet-stream')
    expect(extToMime('')).toBe('application/octet-stream')
  })
})

describe('fileToDataUrl', () => {
  it('reconstruit une data URL à partir du nom de fichier (extension) et du base64', () => {
    expect(fileToDataUrl('photo-abc12345.jpg', 'AAAA')).toBe('data:image/jpeg;base64,AAAA')
    expect(fileToDataUrl('photo-abc12345.png', 'BBBB')).toBe('data:image/png;base64,BBBB')
    expect(fileToDataUrl('original.pdf', 'CCCC')).toBe('data:application/pdf;base64,CCCC')
  })

  it('extension inconnue → application/octet-stream', () => {
    expect(fileToDataUrl('photo-1.bin', 'ZZZZ')).toBe('data:application/octet-stream;base64,ZZZZ')
  })
})

describe('round-trip serializeProject → deserializeProject', () => {
  const project = {
    id: 7,
    name: 'Pull Torsadé',
    technique: 'aiguilles',
    photos: [PHOTO_A, PHOTO_B],
    activeSectionId: 12,
    patternId: 42,
  }
  const sections = [{ id: 12, projectId: 7, name: 'Dos' }]
  const counters = [{ id: 3, projectId: 7, name: 'Rangs' }]
  const sessions = [{ id: 1, projectId: 7, durationSec: 600 }]
  const diagrams = [{ id: 5, projectId: 7 }]

  it('projet avec 2 photos (sans patron d\'instance) : round-trip identique', () => {
    const result = serializeProject(project, { sections, counters, sessions, diagrams })
    const projetJson = mainJson(result.files, result.dir, 'projet.json')
    const filesByName = toFilesByName(result.files, result.dir, 'projet.json')

    const restored = deserializeProject(projetJson, filesByName)

    expect(restored.project).toEqual(project)
    expect(restored.sections).toEqual(sections)
    expect(restored.counters).toEqual(counters)
    expect(restored.sessions).toEqual(sessions)
    expect(restored.diagrams).toEqual(diagrams)
    expect(restored.instancePattern).toBeNull()
  })

  it('projet avec instance de patron + pdf : round-trip identique (project + instancePattern)', () => {
    const instancePattern = {
      id: 42,
      name: 'Modèle SABAI',
      ownerProjectId: 7,
      photos: [PHOTO_A],
      pdf: PDF,
    }
    const result = serializeProject(project, {
      sections,
      counters,
      sessions,
      diagrams,
      instancePattern,
    })
    const projetJson = mainJson(result.files, result.dir, 'projet.json')
    const filesByName = toFilesByName(result.files, result.dir, 'projet.json')

    const restored = deserializeProject(projetJson, filesByName)

    expect(restored.project).toEqual(project)
    expect(restored.sections).toEqual(sections)
    expect(restored.counters).toEqual(counters)
    expect(restored.sessions).toEqual(sessions)
    expect(restored.diagrams).toEqual(diagrams)
    expect(restored.instancePattern).toEqual(instancePattern)
  })

  it('projet avec instance de patron ayant une galerie : round-trip identique', () => {
    const instancePattern = {
      id: 43,
      name: 'Modèle Twist',
      ownerProjectId: 7,
      photos: [],
      gallery: [{ src: PHOTO_A, page: 4, w: 300, h: 220 }],
    }
    const result = serializeProject(project, {
      sections,
      counters,
      sessions,
      diagrams,
      instancePattern,
    })
    const projetJson = mainJson(result.files, result.dir, 'projet.json')
    const filesByName = toFilesByName(result.files, result.dir, 'projet.json')

    const restored = deserializeProject(projetJson, filesByName)

    expect(restored.instancePattern).toEqual(instancePattern)
  })

  it('projet sans photos ni entités embarquées : tableaux vides préservés', () => {
    const bare = { id: 8, name: 'Sans rien', photos: [] }
    const result = serializeProject(bare, {
      sections: [],
      counters: [],
      sessions: [],
      diagrams: [],
    })
    const projetJson = mainJson(result.files, result.dir, 'projet.json')
    const filesByName = toFilesByName(result.files, result.dir, 'projet.json')

    const restored = deserializeProject(projetJson, filesByName)

    expect(restored.project).toEqual(bare)
    expect(restored.sections).toEqual([])
    expect(restored.counters).toEqual([])
    expect(restored.sessions).toEqual([])
    expect(restored.diagrams).toEqual([])
    expect(restored.instancePattern).toBeNull()
  })

  it('photos dupliquées : round-trip conserve les doublons (même data URL répétée)', () => {
    const dup = { id: 9, name: 'Doublons', photos: [PHOTO_A, PHOTO_A] }
    const result = serializeProject(dup, {
      sections: [],
      counters: [],
      sessions: [],
      diagrams: [],
    })
    const projetJson = mainJson(result.files, result.dir, 'projet.json')
    const filesByName = toFilesByName(result.files, result.dir, 'projet.json')

    const restored = deserializeProject(projetJson, filesByName)

    expect(restored.project.photos).toEqual([PHOTO_A, PHOTO_A])
  })
})

describe('round-trip serializePattern → deserializePattern', () => {
  it('patron biblio avec pdf et 2 photos : round-trip identique', () => {
    const pattern = { id: 9, name: 'Écharpe Twist', photos: [PHOTO_A, PHOTO_B], pdf: PDF }
    const result = serializePattern(pattern)
    const patronJson = mainJson(result.files, result.dir, 'patron.json')
    const filesByName = toFilesByName(result.files, result.dir, 'patron.json')

    const restored = deserializePattern(patronJson, filesByName)

    expect(restored).toEqual(pattern)
  })

  it('patron biblio sans pdf ni photos : round-trip identique, pas de clé pdf', () => {
    const pattern = { id: 10, name: 'Bonnet', photos: [] }
    const result = serializePattern(pattern)
    const patronJson = mainJson(result.files, result.dir, 'patron.json')
    const filesByName = toFilesByName(result.files, result.dir, 'patron.json')

    const restored = deserializePattern(patronJson, filesByName)

    expect(restored).toEqual(pattern)
    expect(restored.pdf).toBeUndefined()
  })

  it('patron builtin (flags additionnels préservés)', () => {
    const pattern = { id: 1, name: 'Libre', photos: [], builtin: true }
    const result = serializePattern(pattern)
    const patronJson = mainJson(result.files, result.dir, 'patron.json')
    const filesByName = toFilesByName(result.files, result.dir, 'patron.json')

    const restored = deserializePattern(patronJson, filesByName)

    expect(restored).toEqual(pattern)
  })

  it('restaure la galerie (gallery-* → data URLs, page/w/h préservés)', () => {
    const patronJson = { name: 'P', photos: [], gallery: [{ name: 'gallery-x.png', page: 3, w: 200, h: 150 }] }
    const pattern = deserializePattern(patronJson, { 'gallery-x.png': 'ABCD' })
    expect(pattern.gallery).toEqual([{ src: 'data:image/png;base64,ABCD', page: 3, w: 200, h: 150 }])
  })

  it('patron avec galerie : round-trip identique (src, page, w, h)', () => {
    const pattern = {
      id: 11,
      name: 'Galerie',
      photos: [],
      gallery: [
        { src: PHOTO_A, page: 1, w: 100, h: 80 },
        { src: PHOTO_B, page: 2, w: 50, h: 40 },
      ],
    }
    const result = serializePattern(pattern)
    const patronJson = mainJson(result.files, result.dir, 'patron.json')
    const filesByName = toFilesByName(result.files, result.dir, 'patron.json')

    const restored = deserializePattern(patronJson, filesByName)

    expect(restored).toEqual(pattern)
  })
})

// GARDE DE NON-RÉGRESSION (ajoutée après une trouvaille sur appareil le
// 12/08/2026) : une vignette CASSÉE a été observée après restauration sur les patrons
// de démonstration. Mécanisme retracé : `parseDataUrl` (naming.js) n'accepte QUE les
// data URL base64 (regex `^data:...;base64,...`) ; l'ancien croquis SVG des patrons
// d'exemple valait `data:image/svg+xml;utf8,…` (pas base64) et faisait échouer
// `parseDataUrl` → `photoFileName` retombait sur `photo-<index>.bin` →
// `buildPhotoFiles` écrivait un fichier VIDE (`data: ''`) → `fileToDataUrl` restaurait
// `data:application/octet-stream;base64,` : une image cassée, silencieusement, sans
// qu'aucun test ne le voie.
//
// Le 30/07-12/08, ces croquis ont cédé la place à de vraies photos WebP (data URL
// base64) — qui, elles, survivent à l'aller-retour. Mais la garantie « la photo
// d'exemple traverse une sauvegarde intacte » n'était vérifiée par AUCUN test : ce lot
// la corrigeait en apparence, sans preuve. Le premier bloc ci-dessous verrouille donc
// que les TROIS exports réels de demo-visuals.js survivent, caractère pour caractère,
// au vrai chemin serializePattern → deserializePattern.
//
// LA SUITE DE L'HISTOIRE (revue du 12/08). La forme base64 ÉTAIT une exigence de
// restauration : jusqu'à cette revue, une data URL non base64 ne survivait pas à
// l'aller-retour, et le test qui suit affirmait cette perte comme le comportement
// attendu. C'était caractériser un défaut, pas s'en protéger — et le défaut mordait pour
// de vrai : le semis des patrons d'exemple ne rejoue jamais (patterns.js), donc toute
// installation antérieure à ce lot garde en base les anciens croquis SVG et produit, à
// chaque sauvegarde, trois fichiers vides. La classe de défaut est corrigée depuis :
// une data URL que `parseDataUrl` ne sait pas analyser n'est plus extraite en fichier,
// elle reste telle quelle dans le JSON et revient IDENTIQUE. Le test est donc retourné.
// Il ne dit plus pourquoi la forme base64 est obligatoire — elle ne l'est plus pour la
// survie — mais il garde le souvenir de ce qui a été réparé, et rougirait si la perte
// revenait.
describe('round-trip serializePattern → deserializePattern : photos de démonstration', () => {
  const DEMO_PHOTOS = [
    ['bonnet', DEMO_SKETCH_BONNET],
    ['echarpe', DEMO_SKETCH_ECHARPE],
    ['sac', DEMO_SKETCH_SAC],
  ]

  for (const [name, photo] of DEMO_PHOTOS) {
    it(`patron démo "${name}" : la data URL réelle survit à l'aller-retour de sauvegarde, identique caractère pour caractère`, () => {
      const pattern = { id: 42, name: `Patron démo ${name}`, photos: [photo] }
      const result = serializePattern(pattern)
      const patronJson = mainJson(result.files, result.dir, 'patron.json')
      const filesByName = toFilesByName(result.files, result.dir, 'patron.json')

      const restored = deserializePattern(patronJson, filesByName)

      expect(restored.photos[0]).toBe(photo)
    })
  }

  it('défaut réparé : une data URL non base64 (ancien croquis SVG) survit maintenant à cet aller-retour', () => {
    // Le cas exact qui cassait : ce que garde en base toute installation antérieure au
    // lot du 12/08, puisque le semis des exemples ne rejoue jamais.
    const oldSketch = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')
    const pattern = { id: 43, name: 'Patron démo (ancien croquis)', photos: [oldSketch] }
    const result = serializePattern(pattern)
    const patronJson = mainJson(result.files, result.dir, 'patron.json')
    const filesByName = toFilesByName(result.files, result.dir, 'patron.json')

    const restored = deserializePattern(patronJson, filesByName)

    expect(restored.photos[0]).toBe(oldSketch)
    // Et plus aucun fichier vide n'est écrit pour elle : la valeur voyage DANS le JSON.
    expect(result.files.some((f) => f.path.endsWith('.bin'))).toBe(false)
    expect(patronJson.photos).toEqual([oldSketch])
  })

  it('symétrie : la même data URL non base64 survit sur un patron d\'INSTANCE (préfixe patron-photo-)', () => {
    // Le patron forké d'un projet passe par le même `buildPhotoFiles`, avec un autre
    // préfixe. Une correction qui ne vaudrait que pour la bibliothèque laisserait la
    // couverture des projets d'exemple cassée — c'est précisément par `resolveCover`
    // que ces images-là remontent.
    const oldSketch = 'data:image/svg+xml;utf8,<svg/>'
    const instancePattern = { id: 44, name: 'Instance', ownerProjectId: 7, photos: [oldSketch] }
    const project = { id: 7, name: 'Pull torsadé', photos: [] }
    const result = serializeProject(project, { instancePattern })
    const projetJson = mainJson(result.files, result.dir, 'projet.json')
    const filesByName = toFilesByName(result.files, result.dir, 'projet.json')

    const restored = deserializeProject(projetJson, filesByName)

    expect(restored.instancePattern).toEqual(instancePattern)
    expect(result.files.some((f) => f.path.endsWith('.bin'))).toBe(false)
  })

  it('symétrie : une image de GALERIE en data URL non base64 survit aussi', () => {
    // `buildGalleryFiles` portait exactement le même défaut que `buildPhotoFiles`.
    const oldSketch = 'data:image/svg+xml;utf8,<svg/>'
    const pattern = {
      id: 45,
      name: 'Galerie mixte',
      photos: [],
      gallery: [
        { src: oldSketch, page: 1, w: 100, h: 80 },
        { src: PHOTO_A, page: 2, w: 50, h: 40 },
      ],
    }
    const result = serializePattern(pattern)
    const patronJson = mainJson(result.files, result.dir, 'patron.json')
    const filesByName = toFilesByName(result.files, result.dir, 'patron.json')

    const restored = deserializePattern(patronJson, filesByName)

    expect(restored).toEqual(pattern)
    // La photo base64 voisine, elle, reste bien extraite en fichier : la correction ne
    // ramène pas tout le poids des images dans le JSON.
    expect(result.files.filter((f) => f.path.includes('/gallery-'))).toHaveLength(1)
  })

  it('les noms de fichiers restants dérivent tous du hash du contenu (prémisse de dedupByPath)', () => {
    // `dedupByPath` (serialize.js) ne garde qu'un fichier par chemin en s'appuyant sur
    // « même nom ⇒ même contenu ». Le repli `photo-<index>.bin` était le seul nom NON
    // dérivé du contenu ; en ne l'émettant plus, la prémisse devient vraie sans exception.
    const oldSketch = 'data:image/svg+xml;utf8,<svg/>'
    const pattern = { id: 46, name: 'Mixte', photos: [oldSketch, PHOTO_A, PHOTO_B] }
    const result = serializePattern(pattern)
    const assets = result.files.filter((f) => f.encoding === 'base64')
    expect(assets).toHaveLength(2)
    for (const f of assets) {
      expect(f.path.split('/').pop()).toMatch(/^photo-[0-9a-f]{8}\.[a-z0-9]+$/)
    }
  })
})

describe('fichier manquant à la restauration : signalé, jamais remplacé par une image vide', () => {
  it('photo manquante dans filesByName : retirée du tableau photos, consignée dans missing', () => {
    const patronJson = { id: 1, name: 'Test', photos: ['photo-abc.jpg', 'photo-def.jpg'] }
    const missing = []
    const pattern = deserializePattern(patronJson, { 'photo-def.jpg': 'ZGVm' }, missing)
    expect(pattern.photos).toEqual([expect.stringContaining('data:image/jpeg;base64,ZGVm')])
    expect(missing).toEqual(['photo-abc.jpg'])
  })

  it('galerie : item avec fichier manquant retiré, page/w/h ne fuient pas orphelins', () => {
    const patronJson = { id: 1, name: 'Test', gallery: [{ name: 'gallery-x.png', page: 2, w: 10, h: 20 }] }
    const missing = []
    const pattern = deserializePattern(patronJson, {}, missing)
    expect(pattern.gallery).toEqual([])
    expect(missing).toEqual(['gallery-x.png'])
  })

  it('sans 3e argument missing : comportement inchangé pour les appelants existants (pas de crash, photo toujours retirée)', () => {
    const patronJson = { id: 1, name: 'Test', photos: ['photo-abc.jpg'] }
    expect(() => deserializePattern(patronJson, {})).not.toThrow()
    expect(deserializePattern(patronJson, {}).photos).toEqual([])
  })

  it('projet : photo manquante consignée avec le bon tableau missing partagé (photos projet + instance)', () => {
    const projetJson = { id: 5, name: 'Proj', photos: ['photo-a.jpg'] }
    const missing = []
    const restored = deserializeProject(projetJson, {}, missing)
    expect(restored.project.photos).toEqual([])
    expect(missing).toEqual(['photo-a.jpg'])
  })
})

// FilesByName des photos de laine : { basename: data } à partir des `files` renvoyés par
// serializeYarns, en retirant laines.json lui-même.
// ⚠️ La clé est le NOM DE BASE, jamais le chemin — depuis le 21/08/2026 les fichiers
// partent sous `Laines/`, et c'est bien le nom nu que `laines.json` référence. Prendre
// `f.path` comme clé rendrait ce round-trip faux sans que rien ne le dise.
function toRootFilesByName(files) {
  const map = {}
  for (const f of files) {
    if (f.path === 'laines.json') continue
    map[f.path.split('/').pop()] = f.data
  }
  return map
}

describe('round-trip serializeYarns → deserializeYarns', () => {
  it('laines avec photo : round-trip identique (photo externalisée en fichier, reconstruite)', () => {
    const yarns = [
      { id: 1, brand: 'Bergère de France', photo: PHOTO_A },
      { id: 2, brand: 'Katia', photo: null },
    ]
    const result = serializeYarns(yarns)
    const laineJson = result.files.find((f) => f.path === 'laines.json')
    const filesByName = toRootFilesByName(result.files)
    const restored = deserializeYarns(JSON.parse(laineJson.data), filesByName)
    expect(restored).toEqual(yarns) // identique à l'original, octets non recompressés
  })

  it('liste vide', () => {
    const result = serializeYarns([])
    const laineJson = result.files.find((f) => f.path === 'laines.json')
    expect(deserializeYarns(JSON.parse(laineJson.data), {})).toEqual([])
  })

  it('rétrocompatibilité : un ancien laines.json (photo inline, sans fichier) se restaure identique', () => {
    // Format d'AVANT le 15/08/2026 : la photo est une data URL brute dans le JSON, aucun
    // fichier laine-photo-* n'existe dans la sauvegarde. Une sauvegarde déjà faite par
    // une utilisatrice doit continuer de se restaurer sans aucun changement de son côté.
    const oldFormatJson = [{ id: 1, brand: 'Ancien format', photo: PHOTO_A }]
    expect(deserializeYarns(oldFormatJson, {})).toEqual(oldFormatJson)
  })
})

describe('round-trip serializeIndependentCounters → deserializeIndependentCounters', () => {
  it('compteurs indépendants : round-trip identique', () => {
    const counters = [{ id: 1, projectId: 0, name: 'Général', value: 10 }]
    const result = serializeIndependentCounters(counters)
    const restored = deserializeIndependentCounters(JSON.parse(result.data))
    expect(restored).toEqual(counters)
  })
})

describe('round-trip serializeSettings → deserializeSettings', () => {
  it('réglages : round-trip en lignes {key, value}, état volatil déjà exclu par serialize', () => {
    const settings = {
      theme: 'clay',
      activeSession: 'peu importe',
      lastBackupAt: '2026-07-02T10:00:00.000Z',
    }
    const result = serializeSettings(settings)
    const restored = deserializeSettings(JSON.parse(result.data))
    expect(restored).toEqual([
      { key: 'theme', value: 'clay' },
      { key: 'lastBackupAt', value: '2026-07-02T10:00:00.000Z' },
    ])
  })

  it('objet vide → tableau vide', () => {
    expect(deserializeSettings({})).toEqual([])
    expect(deserializeSettings(undefined)).toEqual([])
  })
})

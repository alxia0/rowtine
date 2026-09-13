// Unitaire — sérialiseurs d'entités (purs, sans IO) pour la sauvegarde en arborescence
// de fichiers.
import { describe, it, expect } from 'vitest'
import {
  serializeProject,
  serializePattern,
  serializeYarns,
  serializeIndependentCounters,
  serializeSettings,
} from '@/backup/serialize'
import { deserializePattern } from '@/backup/deserialize'

// Deux data URLs distinctes (contenu base64 différent → noms de fichiers différents).
const PHOTO_A = 'data:image/jpeg;base64,AAAA'
const PHOTO_B = 'data:image/png;base64,BBBB'
const PDF = 'data:application/pdf;base64,CCCC'

describe('serializeProject', () => {
  const project = {
    id: 7,
    name: 'Pull Torsadé',
    technique: 'aiguilles',
    photos: [PHOTO_A, PHOTO_B],
    activeSectionId: 12,
  }
  const sections = [{ id: 12, projectId: 7, name: 'Dos' }]
  const counters = [{ id: 3, projectId: 7, name: 'Rangs' }]
  const sessions = [{ id: 1, projectId: 7, durationSec: 600 }]
  const diagrams = [{ id: 5, projectId: 7 }]

  it('range le dossier sous Projets/<slug> [id]', () => {
    const result = serializeProject(project, { sections, counters, sessions, diagrams })
    expect(result.dir).toBe('Projets/pull-torsade [7]')
  })

  it('remplace photos par un tableau de noms de fichiers et embarque sections/counters/sessions/diagrams', () => {
    const result = serializeProject(project, { sections, counters, sessions, diagrams })
    const jsonFile = result.files.find((f) => f.path === 'Projets/pull-torsade [7]/projet.json')
    expect(jsonFile).toBeTruthy()
    expect(jsonFile.encoding).toBe('utf8')

    const parsed = JSON.parse(jsonFile.data)
    expect(parsed.name).toBe('Pull Torsadé')
    expect(parsed.photos).toHaveLength(2)
    expect(parsed.photos.every((n) => /^photo-[0-9a-f]{8}\.(jpg|png)$/.test(n))).toBe(true)
    // Photos différentes → noms différents.
    expect(parsed.photos[0]).not.toBe(parsed.photos[1])
    expect(parsed.sections).toEqual(sections)
    expect(parsed.counters).toEqual(counters)
    expect(parsed.sessions).toEqual(sessions)
    expect(parsed.diagrams).toEqual(diagrams)
  })

  it('produit un fichier base64 par photo, chemins sous le dossier du projet', () => {
    const result = serializeProject(project, { sections, counters, sessions, diagrams })
    const photoFiles = result.files.filter((f) => f.path.includes('/photo-'))
    expect(photoFiles).toHaveLength(2)
    for (const f of photoFiles) {
      expect(f.path.startsWith('Projets/pull-torsade [7]/')).toBe(true)
      expect(f.encoding).toBe('base64')
    }
    // Le contenu base64 correspond bien à la partie après la virgule de la data URL.
    const dataA = photoFiles.find((f) => f.path.endsWith('.jpg'))
    expect(dataA.data).toBe('AAAA')
    const dataB = photoFiles.find((f) => f.path.endsWith('.png'))
    expect(dataB.data).toBe('BBBB')
  })

  it('renvoie photoNames listant les noms de fichiers photo', () => {
    const result = serializeProject(project, { sections, counters, sessions, diagrams })
    expect(result.photoNames.sort()).toEqual(
      result.files
        .filter((f) => f.path.includes('/photo-'))
        .map((f) => f.path.split('/').pop())
        .sort(),
    )
  })

  it('déduplique les fichiers photo par nom (mêmes contenus)', () => {
    const dup = { ...project, photos: [PHOTO_A, PHOTO_A] }
    const result = serializeProject(dup, { sections: [], counters: [], sessions: [], diagrams: [] })
    const photoFiles = result.files.filter((f) => f.path.includes('/photo-'))
    expect(photoFiles).toHaveLength(1)
    const jsonFile = result.files.find((f) => f.path.endsWith('projet.json'))
    const parsed = JSON.parse(jsonFile.data)
    expect(parsed.photos).toEqual([
      photoFiles[0].path.split('/').pop(),
      photoFiles[0].path.split('/').pop(),
    ])
  })

  it('gère un projet sans photos', () => {
    const noPhotos = { ...project, photos: [] }
    const result = serializeProject(noPhotos, {
      sections: [],
      counters: [],
      sessions: [],
      diagrams: [],
    })
    const photoFiles = result.files.filter((f) => f.path.includes('/photo-'))
    expect(photoFiles).toHaveLength(0)
    expect(result.photoNames).toEqual([])
  })

  it('avec instancePattern, ajoute patron.json + ses photos préfixées patron-photo- dans le même dossier', () => {
    const instancePattern = {
      id: 42,
      name: 'Modèle SABAI',
      photos: [PHOTO_A],
    }
    const result = serializeProject(project, {
      sections,
      counters,
      sessions,
      diagrams,
      instancePattern,
    })
    const patronJson = result.files.find((f) => f.path === 'Projets/pull-torsade [7]/patron.json')
    expect(patronJson).toBeTruthy()
    expect(patronJson.encoding).toBe('utf8')
    const parsedPattern = JSON.parse(patronJson.data)
    expect(parsedPattern.name).toBe('Modèle SABAI')
    expect(parsedPattern.photos).toHaveLength(1)
    expect(parsedPattern.photos[0]).toMatch(/^patron-photo-[0-9a-f]{8}\.jpg$/)

    const patronPhotoFile = result.files.find((f) => f.path.includes('/patron-photo-'))
    expect(patronPhotoFile).toBeTruthy()
    expect(patronPhotoFile.encoding).toBe('base64')
    expect(patronPhotoFile.data).toBe('AAAA')

    // Les noms patron-photo-* ne collisionnent pas avec les photos du projet.
    const projectPhotoNames = result.files
      .filter((f) => f.path.includes('/photo-') && !f.path.includes('/patron-photo-'))
      .map((f) => f.path.split('/').pop())
    expect(projectPhotoNames).not.toContain(patronPhotoFile.path.split('/').pop())
  })

  it('sans instancePattern, ne produit pas de patron.json', () => {
    const result = serializeProject(project, { sections, counters, sessions, diagrams })
    expect(result.files.some((f) => f.path.endsWith('patron.json'))).toBe(false)
  })

  it('serializeProject émet patron.md quand instancePattern présent', () => {
    const proj = { id: 5, name: 'Mon pull', photos: [] }
    const instancePattern = {
      id: 9,
      name: 'Torsade',
      ownerProjectId: 5,
      reader: {
        sizeLabels: [],
        sections: [{ title: 'Corps', steps: [{ t: 'monter', imgs: ['data:image/jpeg;base64,QUJD'] }] }],
      },
    }
    const { files } = serializeProject(proj, { instancePattern })
    expect(files.find((f) => f.path === 'Projets/mon-pull [5]/patron.md')).toBeTruthy()
    const pj = JSON.parse(files.find((f) => f.path.endsWith('/patron.json')).data)
    expect(typeof pj.patronMd.hash).toBe('string')
  })

  it('serializeProject SANS instancePattern : pas de patron.md', () => {
    const { files } = serializeProject({ id: 6, name: 'Nu', photos: [] }, {})
    expect(files.some((f) => f.path.endsWith('/patron.md'))).toBe(false)
  })

  it('avec instancePattern ayant un pdf, ajoute original.pdf dans le dossier du projet et retire pdf du JSON', () => {
    const instancePattern = {
      id: 42,
      name: 'Modèle SABAI',
      photos: [],
      pdf: PDF,
    }
    const result = serializeProject(project, {
      sections,
      counters,
      sessions,
      diagrams,
      instancePattern,
    })
    const pdfFile = result.files.find((f) => f.path === 'Projets/pull-torsade [7]/original.pdf')
    expect(pdfFile).toBeTruthy()
    expect(pdfFile.encoding).toBe('base64')
    expect(pdfFile.data).toBe('CCCC')

    const patronJson = result.files.find((f) => f.path === 'Projets/pull-torsade [7]/patron.json')
    const parsedPattern = JSON.parse(patronJson.data)
    expect(parsedPattern.pdf).toBeUndefined()
  })
})

describe('serializePattern', () => {
  it('range le dossier sous Patrons/<slug> [id], convertit photos en noms', () => {
    const pattern = { id: 9, name: 'Écharpe Twist', photos: [PHOTO_A, PHOTO_B] }
    const result = serializePattern(pattern)
    expect(result.dir).toBe('Patrons/echarpe-twist [9]')
    const jsonFile = result.files.find((f) => f.path === 'Patrons/echarpe-twist [9]/patron.json')
    expect(jsonFile).toBeTruthy()
    const parsed = JSON.parse(jsonFile.data)
    expect(parsed.photos).toHaveLength(2)
    expect(parsed.pdf).toBeUndefined()
    const photoFiles = result.files.filter((f) => f.path.includes('/photo-'))
    expect(photoFiles).toHaveLength(2)
  })

  it('avec un pdf en data URL, ajoute original.pdf en base64 et retire pdf du JSON', () => {
    const pattern = { id: 9, name: 'Écharpe Twist', photos: [], pdf: PDF }
    const result = serializePattern(pattern)
    const pdfFile = result.files.find((f) => f.path === 'Patrons/echarpe-twist [9]/original.pdf')
    expect(pdfFile).toBeTruthy()
    expect(pdfFile.encoding).toBe('base64')
    expect(pdfFile.data).toBe('CCCC')
    const jsonFile = result.files.find((f) => f.path.endsWith('patron.json'))
    const parsed = JSON.parse(jsonFile.data)
    expect(parsed.pdf).toBeUndefined()
  })

  it('sans pdf, pas de fichier original.pdf', () => {
    const pattern = { id: 9, name: 'Écharpe Twist', photos: [] }
    const result = serializePattern(pattern)
    expect(result.files.some((f) => f.path.endsWith('original.pdf'))).toBe(false)
  })

  it('photoNames correspond aux fichiers photo produits', () => {
    const pattern = { id: 9, name: 'Écharpe Twist', photos: [PHOTO_A, PHOTO_B] }
    const result = serializePattern(pattern)
    expect(result.photoNames.sort()).toEqual(
      result.files
        .filter((f) => f.path.includes('/photo-'))
        .map((f) => f.path.split('/').pop())
        .sort(),
    )
  })

  it('sérialise la galerie du patron (src → fichiers gallery-*, métadonnées en JSON)', () => {
    const pattern = { id: 1, name: 'P', photos: [], gallery: [{ src: 'data:image/png;base64,ABCD', page: 3, w: 200, h: 150 }] }
    const { files } = serializePattern(pattern)
    const json = JSON.parse(files.find((f) => f.path.endsWith('patron.json')).data)
    expect(json.gallery).toEqual([{ name: expect.stringMatching(/^gallery-/), page: 3, w: 200, h: 150 }])
    const galFile = files.find((f) => f.path.includes('/gallery-'))
    expect(galFile).toBeTruthy()
    expect(galFile.data).toBe('ABCD')
  })

  it('serializePattern émet patron.md + patronMd.hash dans patron.json', () => {
    const pattern = {
      id: 1,
      name: 'Torsade',
      reader: { sizeLabels: [], sections: [{ title: 'Corps', steps: [{ t: 'monter' }] }] },
    }
    const { files } = serializePattern(pattern)
    const md = files.find((f) => f.path === 'Patrons/torsade [1]/patron.md')
    expect(md).toBeTruthy()
    const json = JSON.parse(files.find((f) => f.path.endsWith('/patron.json')).data)
    expect(typeof json.patronMd.hash).toBe('string')
  })

  it('sans .reader, ne produit pas de patron.md', () => {
    const pattern = { id: 9, name: 'Écharpe Twist', photos: [] }
    const result = serializePattern(pattern)
    expect(result.files.some((f) => f.path.endsWith('/patron.md'))).toBe(false)
  })
})

describe('serializeYarns', () => {
  it('externalise chaque photo en fichier laine-photo-*, laines.json ne garde que le nom', () => {
    const yarns = [
      { id: 1, brand: 'Bergère de France', photo: PHOTO_A },
      { id: 2, brand: 'Katia', photo: null },
    ]
    const result = serializeYarns(yarns)
    const laineJson = result.files.find((f) => f.path === 'laines.json')
    expect(laineJson.encoding).toBe('utf8')
    const parsed = JSON.parse(laineJson.data)
    expect(parsed[0].photo).toMatch(/^laine-photo-[0-9a-f]{8}\.jpg$/)
    expect(parsed[1]).toEqual({ id: 2, brand: 'Katia', photo: null }) // pas de photo : inchangé

    // Depuis le 21/08/2026 le fichier part sous `Laines/` ; le JSON garde le nom nu.
    const photoFile = result.files.find((f) => f.path === `Laines/${parsed[0].photo}`)
    expect(photoFile.encoding).toBe('base64')
    expect(photoFile.data).toBe('AAAA') // octets identiques à PHOTO_A, aucune recompression

    // Correctif revue (15/08) : laines.json DOIT être le DERNIER élément — l'orchestrateur
    // écrit rootFiles séquentiellement dans l'ordre du tableau (cf. orchestrator.js), donc
    // une écriture interrompue ne doit jamais laisser sur disque un laines.json qui pointe
    // vers un laine-photo-* pas encore écrit.
    const paths = result.files.map((f) => f.path)
    expect(paths[paths.length - 1]).toBe('laines.json')
  })

  it('déduplique deux laines qui partagent exactement la même photo', () => {
    const yarns = [
      { id: 1, brand: 'A', photo: PHOTO_A },
      { id: 2, brand: 'B', photo: PHOTO_A },
    ]
    const result = serializeYarns(yarns)
    const laineJson = JSON.parse(result.files.find((f) => f.path === 'laines.json').data)
    expect(laineJson[0].photo).toBe(laineJson[1].photo)
    expect(result.files.filter((f) => f.path !== 'laines.json')).toHaveLength(1)
  })

  it('gère une liste vide', () => {
    const result = serializeYarns([])
    const laineJson = result.files.find((f) => f.path === 'laines.json')
    expect(JSON.parse(laineJson.data)).toEqual([])
    expect(result.files).toHaveLength(1) // seulement laines.json, aucun fichier photo
  })
})

describe('serializeIndependentCounters', () => {
  it('renvoie compteurs.json en utf8', () => {
    const counters = [{ id: 1, projectId: 0, name: 'Général', value: 10 }]
    const result = serializeIndependentCounters(counters)
    expect(result.path).toBe('compteurs.json')
    expect(result.encoding).toBe('utf8')
    expect(JSON.parse(result.data)).toEqual(counters)
  })
})

describe('serializeSettings', () => {
  it('renvoie reglages.json en utf8, en excluant les clés volatiles', () => {
    const settings = {
      theme: 'clay',
      activeSession: { projectId: 7 },
      lastBackupAt: '2026-07-02T10:00:00.000Z',
      // Avenant 04/08/2026 : état LOCAL à cet appareil et à CE dossier, ne doit
      // jamais partir dans la sauvegarde (sinon une restauration l'écraserait
      // avec la valeur de l'ancien téléphone — cf. serialize.js).
      backupDecision: { folder: 'Rowtine', at: '2026-08-04T10:00:00.000Z' },
    }
    const result = serializeSettings(settings)
    expect(result.path).toBe('reglages.json')
    expect(result.encoding).toBe('utf8')
    const parsed = JSON.parse(result.data)
    expect(parsed).toEqual({ theme: 'clay', lastBackupAt: '2026-07-02T10:00:00.000Z' })
    expect(parsed.activeSession).toBeUndefined()
    expect(parsed.backupDecision).toBeUndefined()
  })

  it('deviceId ne part JAMAIS dans reglages.json', () => {
    const out = serializeSettings({ deviceId: 'moi', firstName: 'Alexia' })
    const written = JSON.parse(out.data)
    expect(written).not.toHaveProperty('deviceId')
    expect(written.firstName).toBe('Alexia')  // le reste passe toujours
  })

  it('safFolderLabel ne part JAMAIS dans reglages.json (spec §4.4 : ni sauvegardé, ni restauré)', () => {
    const out = serializeSettings({ safFolderLabel: 'Documents/Rowtine', firstName: 'Alexia' })
    const written = JSON.parse(out.data)
    expect(written).not.toHaveProperty('safFolderLabel')
    expect(written.firstName).toBe('Alexia')  // le reste passe toujours
  })

  // Corollaire (lot du 19/08/2026, revue) : `importCaveatDue` DOIT partir
  // dans la sauvegarde — c'est l'exact inverse des deux tests ci-dessus. Ce drapeau n'a
  // rien de LOCAL ni de secret (contrairement à `deviceId`/`safFolderLabel`/les clés API) :
  // c'est un acquittement, dont la valeur restaurée doit primer (cf. le garde-fou de
  // `runRestore` dans backup-restore-service.spec.js, qui documente les 3 cas). L'exclure
  // par analogie serait une régression SILENCIEUSE : le cas « sauvegarde d'après ce lot,
  // déjà acquitté » disparaîtrait, et une restauration ferait réapparaître un avertissement
  // déjà vu.
  it('importCaveatDue part TOUJOURS dans reglages.json — ce n\'est ni un secret ni un état local', () => {
    const out = serializeSettings({ importCaveatDue: true, firstName: 'Alexia' })
    const written = JSON.parse(out.data)
    expect(written).toHaveProperty('importCaveatDue', true)
    expect(written.firstName).toBe('Alexia')  // le reste passe toujours
  })

  it('ne modifie pas l’objet passé en entrée', () => {
    const settings = { theme: 'clay', activeSession: 'peu importe' }
    serializeSettings(settings)
    expect(settings.activeSession).toBe('peu importe')
  })
})

describe('PDF non-base64 : symétrie avec isInlineDataUrl (photos/galerie)', () => {
  it('pattern.pdf en data URL non-base64 : conservé tel quel dans patron.json, aucun original.pdf écrit', () => {
    const pattern = { id: 1, name: 'Test', pdf: 'data:image/svg+xml;utf8,<svg></svg>' }
    const { dir, files } = serializePattern(pattern)
    const patronJsonFile = files.find((f) => f.path === `${dir}/patron.json`)
    const json = JSON.parse(patronJsonFile.data)
    expect(json.pdf).toBe('data:image/svg+xml;utf8,<svg></svg>')
    expect(files.some((f) => f.path === `${dir}/original.pdf`)).toBe(false)
  })

  it('pattern.pdf en base64 valide : comportement inchangé (fichier original.pdf écrit, pas dans le JSON)', () => {
    const pattern = { id: 1, name: 'Test', pdf: 'data:application/pdf;base64,JVBERi0=' }
    const { dir, files } = serializePattern(pattern)
    const patronJsonFile = files.find((f) => f.path === `${dir}/patron.json`)
    const json = JSON.parse(patronJsonFile.data)
    expect(json.pdf).toBeUndefined()
    expect(files.some((f) => f.path === `${dir}/original.pdf`)).toBe(true)
  })

  it("pattern.pdf vide ('') : reste absent, ni JSON ni fichier (pas de régression sur l'absence de PDF)", () => {
    const pattern = { id: 1, name: 'Test', pdf: '' }
    const { dir, files } = serializePattern(pattern)
    const patronJsonFile = files.find((f) => f.path === `${dir}/patron.json`)
    expect(JSON.parse(patronJsonFile.data).pdf).toBeUndefined()
    expect(files.some((f) => f.path === `${dir}/original.pdf`)).toBe(false)
  })

  it('round-trip serialize → deserialize : pdf non-base64 survit identique', () => {
    const pattern = { id: 1, name: 'Test', pdf: 'data:image/svg+xml;utf8,<svg></svg>' }
    const { dir, files } = serializePattern(pattern)
    const patronJsonFile = files.find((f) => f.path === `${dir}/patron.json`)
    const filesByName = {}
    const restored = deserializePattern(JSON.parse(patronJsonFile.data), filesByName)
    expect(restored.pdf).toBe(pattern.pdf)
  })
})

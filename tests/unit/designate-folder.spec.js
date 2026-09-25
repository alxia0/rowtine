// @vitest-environment jsdom
// Unitaire — désignation du dossier SAF (premier lancement simplifié, 09/08/2026 ;
// adoption du dossier, 06/09/2026). La confirmation `window.confirm` a été RETIRÉE :
// le sélecteur système est le seul geste demandé. Le label est désormais COMPOSÉ ici
// (`composeLabel`) à partir de la base décidée par `decideBase` (folder-base.js) — le
// plugin ne renvoie plus que des faits bruts, plus de `resolvedLabel` natif.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Vitest v4 (TDZ) : les objets d'une factory `vi.mock` passent par `vi.hoisted`.
const safFolder = vi.hoisted(() => ({
  chooseFolder: vi.fn(),
  confirmFolder: vi.fn(),
  discardFolder: vi.fn(),
}))
vi.mock('@/backup/saf-folder', () => safFolder)

import { designateFolder } from '@/backup/designate-folder'

// Nouveau contrat plugin (faits bruts) — cf. folder-base.js pour la politique.
const DOSSIER_DATA = [
  { name: 'Projets', isDir: true },
  { name: 'reglages.json', isDir: false },
]

beforeEach(() => {
  safFolder.chooseFolder.mockReset()
  safFolder.confirmFolder.mockReset().mockResolvedValue({ granted: true })
  safFolder.discardFolder.mockReset().mockResolvedValue(undefined)
})

describe('designateFolder', () => {
  it('ne demande AUCUNE confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    safFolder.chooseFolder.mockResolvedValue({ granted: true, name: 'Documents', probeHits: [] })

    await designateFolder()

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(safFolder.confirmFolder).toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  // Le cas d'une utilisatrice réelle : copie des données renommée « Rowtine2 », aucun enfant
  // « Rowtine » — adoptée telle quelle, base vide, libellé = nom choisi.
  it('adoption réelle : base vide, label = nom choisi, confirmFolder("")', async () => {
    safFolder.chooseFolder.mockResolvedValue({ granted: true, name: 'Rowtine2', probeHits: DOSSIER_DATA })

    const res = await designateFolder()

    expect(safFolder.confirmFolder).toHaveBeenCalledWith('')
    expect(res).toEqual({ granted: true, label: 'Rowtine2' })
  })

  it('dossier vierge : base « Rowtine », label = Documents/Rowtine', async () => {
    safFolder.chooseFolder.mockResolvedValue({ granted: true, name: 'Documents', probeHits: [] })

    const res = await designateFolder()

    expect(safFolder.confirmFolder).toHaveBeenCalledWith('Rowtine')
    expect(res).toEqual({ granted: true, label: 'Documents/Rowtine' })
  })

  it('dossier nommé « Rowtine » : base vide, label = nom seul', async () => {
    safFolder.chooseFolder.mockResolvedValue({ granted: true, name: 'Rowtine', probeHits: [] })

    const res = await designateFolder()

    expect(safFolder.confirmFolder).toHaveBeenCalledWith('')
    expect(res).toEqual({ granted: true, label: 'Rowtine' })
  })

  // Ordre 2 > 3 à travers le câblage : un hit « Rowtine » DOSSIER dans les
  // faits bruts bat des marqueurs complets à la racine — le sous-dossier
  // établi reste la base, la racine n'est PAS adoptée.
  it('enfant « Rowtine » rapporté ET marqueurs : base « Rowtine », pas d\'adoption', async () => {
    safFolder.chooseFolder.mockResolvedValue({
      granted: true,
      name: 'Documents',
      probeHits: [
        ...DOSSIER_DATA,
        { name: 'Rowtine', isDir: true },
      ],
    })

    const res = await designateFolder()

    expect(safFolder.confirmFolder).toHaveBeenCalledWith('Rowtine')
    expect(res).toEqual({ granted: true, label: 'Documents/Rowtine' })
  })

  // Un simple FICHIER nommé « Rowtine » n'est pas l'enfant établi : pas de
  // branche 2, les marqueurs complets adoptent la racine (branche 3).
  it('fichier « Rowtine » rapporté ET marqueurs : adoption quand même', async () => {
    safFolder.chooseFolder.mockResolvedValue({
      granted: true,
      name: 'Rowtine2',
      probeHits: [
        ...DOSSIER_DATA,
        { name: 'Rowtine', isDir: false },
      ],
    })

    const res = await designateFolder()

    expect(safFolder.confirmFolder).toHaveBeenCalledWith('')
    expect(res).toEqual({ granted: true, label: 'Rowtine2' })
  })

  // Enfant établi sans aucun marqueur (installations existantes) : branche 2.
  it('enfant « Rowtine » seul, sans marqueurs : base « Rowtine »', async () => {
    safFolder.chooseFolder.mockResolvedValue({
      granted: true,
      name: 'Documents',
      probeHits: [{ name: 'Rowtine', isDir: true }],
    })

    const res = await designateFolder()

    expect(safFolder.confirmFolder).toHaveBeenCalledWith('Rowtine')
    expect(res).toEqual({ granted: true, label: 'Documents/Rowtine' })
  })

  it('sélecteur annulé : ne confirme rien, renvoie granted false', async () => {
    safFolder.chooseFolder.mockResolvedValue({ granted: false, name: null, probeHits: [] })

    const res = await designateFolder()

    expect(safFolder.confirmFolder).not.toHaveBeenCalled()
    expect(res).toEqual({ granted: false, label: null })
  })

  // `confirmFolder` REJETTE quand la création de « Rowtine » est impossible
  // (RowtineSafPlugin.java, `call.reject`). Ce rejet doit remonter à
  // l'appelant, qui seul sait quoi afficher.
  it('confirmFolder qui rejette : le rejet remonte à l\'appelant', async () => {
    safFolder.chooseFolder.mockResolvedValue({ granted: true, name: 'Documents', probeHits: [] })
    safFolder.confirmFolder.mockRejectedValue(new Error('création du dossier Rowtine impossible'))

    await expect(designateFolder()).rejects.toThrow('création du dossier Rowtine impossible')
  })
})

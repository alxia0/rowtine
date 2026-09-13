import { describe, it, expect, vi, beforeEach } from 'vitest'

const plugin = vi.hoisted(() => ({
  chooseFolder: vi.fn(),
  confirmFolder: vi.fn(),
  discardFolder: vi.fn(),
  hasFolder: vi.fn(),
}))
vi.mock('@/backup/saf-plugin', () => ({ RowtineSaf: plugin }))

import { chooseFolder, confirmFolder, discardFolder, hasFolder, folderName, folderKey } from '@/backup/saf-folder'
import { PROBES } from '@/backup/folder-base'

beforeEach(() => {
  plugin.chooseFolder.mockReset()
  plugin.confirmFolder.mockReset()
  plugin.discardFolder.mockReset()
  plugin.hasFolder.mockReset()
})

describe('saf-folder', () => {
  // Depuis l'adoption (plan 06/09/2026), le JS pilote : il passe les sondes
  // (la liste PROBES vit dans folder-base.js, le natif n'en connaît aucune)
  // et rend les faits bruts du plugin, sans aucune décision.
  it('chooseFolder passe PROBES et relaie granted + name + probeHits', async () => {
    plugin.chooseFolder.mockResolvedValue({ granted: true, name: 'Documents', probeHits: [{ name: 'Projets', isDir: true }] })
    const res = await chooseFolder()
    expect(plugin.chooseFolder).toHaveBeenCalledWith({ probes: PROBES })
    expect(res).toEqual({ granted: true, name: 'Documents', probeHits: [{ name: 'Projets', isDir: true }] })
  })

  it('chooseFolder annulé → granted:false + valeurs par défaut', async () => {
    plugin.chooseFolder.mockResolvedValue({ granted: false, name: null, probeHits: [] })
    expect(await chooseFolder()).toEqual({ granted: false, name: null, probeHits: [] })
  })

  // Normalisation : un natif qui omettrait `probeHits` (vieille version,
  // annulation) ne doit jamais laisser `undefined` remonter au décideur.
  it('chooseFolder : probeHits absent du natif → []', async () => {
    plugin.chooseFolder.mockResolvedValue({ granted: true, name: 'Documents' })
    expect(await chooseFolder()).toEqual({ granted: true, name: 'Documents', probeHits: [] })
  })

  it('confirmFolder passe la base décidée côté JS', async () => {
    plugin.confirmFolder.mockResolvedValue({ granted: true })
    expect(await confirmFolder('Rowtine')).toEqual({ granted: true })
    expect(plugin.confirmFolder).toHaveBeenCalledWith({ base: 'Rowtine' })
    expect(await confirmFolder('')).toEqual({ granted: true })
    expect(plugin.confirmFolder).toHaveBeenLastCalledWith({ base: '' })
  })

  it('discardFolder délègue au natif', async () => {
    plugin.discardFolder.mockResolvedValue(undefined)
    await discardFolder()
    expect(plugin.discardFolder).toHaveBeenCalled()
  })

  it('hasFolder relaie le booléen granted', async () => {
    plugin.hasFolder.mockResolvedValue({ granted: true, name: 'Rowtine', uri: 'content://x' })
    expect(await hasFolder()).toBe(true)
    plugin.hasFolder.mockResolvedValue({ granted: false, name: null, uri: null })
    expect(await hasFolder()).toBe(false)
  })

  it('folderName renvoie le nom ou null', async () => {
    plugin.hasFolder.mockResolvedValue({ granted: true, name: 'MonDossier', uri: 'content://x' })
    expect(await folderName()).toBe('MonDossier')
    plugin.hasFolder.mockResolvedValue({ granted: false, name: null, uri: null })
    expect(await folderName()).toBe(null)
  })

  // `folderKey` (avenant 04/08/2026) : identifiant DISCRIMINANT,
  // contrairement à `folderName` qui depuis l'adoption peut porter le nom du
  // dossier choisi (adopté) — plus une constante (cf. RowtineSafPlugin).
  describe('folderKey', () => {
    it('granted + uri : renvoie l’URI', async () => {
      plugin.hasFolder.mockResolvedValue({ granted: true, name: 'Rowtine', uri: 'content://com.android.externalstorage.documents/tree/primary%3ARowtine' })
      expect(await folderKey()).toBe('content://com.android.externalstorage.documents/tree/primary%3ARowtine')
    })

    it('non granted : renvoie null même si une URI est présente', async () => {
      plugin.hasFolder.mockResolvedValue({ granted: false, name: null, uri: 'content://x' })
      expect(await folderKey()).toBe(null)
    })

    // Cas natif possible (permission perdue en cours de route, lecture en échec) :
    // `granted: true` mais `uri: null` — `folderKey` ne doit jamais y voir un
    // identifiant valide.
    it('granted mais uri null : renvoie null', async () => {
      plugin.hasFolder.mockResolvedValue({ granted: true, name: 'Rowtine', uri: null })
      expect(await folderKey()).toBe(null)
    })
  })
})

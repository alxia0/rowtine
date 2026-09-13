// Unitaire — sélection de backend dans `getBackupStorage()` (bascule SAF seule) : SAF si un dossier est désigné, sinon
// `null` (natif sans dossier désigné, ou web/dev — le repli MANAGE hérité a
// été retiré, MANAGE reste présent mais inutilisé). Toutes les dépendances
// externes sont mockées.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Vitest v4 : un `vi.mock` factory ne peut PAS référencer une variable
// top-level déclarée par un `const`/`class` ordinaire (TDZ — le mock est
// hoisté au-dessus de cette déclaration). `vi.hoisted` crée ces bindings
// AVANT le hoisting des `vi.mock`, donc ils sont bien initialisés quand les
// factories s'exécutent.
const { isNativePlatform, safFolder, SafStub } = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  safFolder: { hasFolder: vi.fn() },
  SafStub: class SafStub {},
}))

// `registerPlugin` (correctif du 06/08/2026) : désormais, `backup-service`
// importe `backup-manifest`, qui importe `device-identity`, qui importe `saf-plugin` —
// lequel appelle `registerPlugin('RowtineSaf')` À L'ÉVALUATION du module. Sans cet
// export, ce fichier entier cessait de se charger — « 0 test », jamais un rouge.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
  registerPlugin: () => ({}),
}))
vi.mock('@/backup/saf-folder', () => safFolder)
vi.mock('@/backup/saf-storage', () => ({ SafBackupStorage: SafStub }))

import { getBackupStorage } from '@/backup/backup-service'

beforeEach(() => {
  isNativePlatform.mockReset()
  safFolder.hasFolder.mockReset()
})

describe('getBackupStorage — sélection de backend', () => {
  it('dossier SAF désigné → SafBackupStorage', async () => {
    isNativePlatform.mockReturnValue(true)
    safFolder.hasFolder.mockResolvedValue(true)
    expect(await getBackupStorage()).toBeInstanceOf(SafStub)
  })

  it('natif sans dossier SAF désigné → null (plus de repli MANAGE)', async () => {
    isNativePlatform.mockReturnValue(true)
    safFolder.hasFolder.mockResolvedValue(false)
    expect(await getBackupStorage()).toBeNull()
  })

  it('hors plateforme native (web/dev) → null (sans même consulter SAF)', async () => {
    isNativePlatform.mockReturnValue(false)
    expect(await getBackupStorage()).toBeNull()
    expect(safFolder.hasFolder).not.toHaveBeenCalled()
  })
})

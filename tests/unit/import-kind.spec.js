// Reconnaissance du type de fichier importé. Le couple d'assertions qui compte est le
// dernier : un zip NOMMÉ .pdf doit être reconnu comme un zip, et réciproquement. Sans lui,
// rien ne distingue une reconnaissance par CONTENU d'une reconnaissance par extension —
// or c'est précisément l'extension qui n'est pas fiable sur Android (le sélecteur rend un
// `content://` dont le nom n'est pas toujours exploitable).
import { describe, it, expect } from 'vitest'
import { sniffImportKind, sniffFile } from '@/utils/import-kind'

const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]) // "%PDF-1.7"
const ZIP_HEAD = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]) // "PK\x03\x04…"

describe('sniffImportKind', () => {
  it('reconnaît un en-tête PDF', () => {
    expect(sniffImportKind(PDF_HEAD)).toBe('pdf')
  })

  it('reconnaît un en-tête zip', () => {
    expect(sniffImportKind(ZIP_HEAD)).toBe('zip')
  })

  it('rend « unknown » sur des octets quelconques', () => {
    expect(sniffImportKind(new Uint8Array([1, 2, 3, 4, 5]))).toBe('unknown')
  })

  it('rend « unknown » sur un fichier trop court, sans lever', () => {
    expect(sniffImportKind(new Uint8Array([0x50, 0x4b]))).toBe('unknown')
    expect(sniffImportKind(new Uint8Array([]))).toBe('unknown')
    expect(sniffImportKind(undefined)).toBe('unknown')
  })
})

describe('sniffFile — le CONTENU l’emporte sur le NOM', () => {
  it('un zip nommé « patron.pdf » est reconnu comme un zip', async () => {
    const f = new File([ZIP_HEAD], 'patron.pdf', { type: 'application/pdf' })
    await expect(sniffFile(f)).resolves.toBe('zip')
  })

  it('un PDF nommé « patron.zip » est reconnu comme un PDF', async () => {
    const f = new File([PDF_HEAD], 'patron.zip', { type: 'application/zip' })
    await expect(sniffFile(f)).resolves.toBe('pdf')
  })

  it('un fichier vide est « unknown », sans lever', async () => {
    await expect(sniffFile(new File([], 'vide.pdf'))).resolves.toBe('unknown')
  })
})

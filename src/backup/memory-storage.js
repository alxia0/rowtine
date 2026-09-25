// Implémentation en mémoire de l'interface BackupStorage.
// Sert de fake pour les tests (S2/S3 s'appuieront dessus) et de spécification vivante
// du comportement attendu du plugin natif. Chemins relatifs à la racine (jamais absolus).

// Conversions portables octets <-> utf8 <-> base64 (pas de Buffer : ce fake peut
// être importé côté app/WebView). btoa/atob + TextEncoder/TextDecoder sont dispo partout.
// bytesToB64/b64ToBytes sont partagées avec saf-storage.js (même algorithme,
// mêmes contraintes) ET avec zip-import.js/PdfViewer.vue : voir src/utils/base64.js.
import { bytesToBase64 as bytesToB64, base64ToBytes as b64ToBytes } from '@/utils/base64'
// base64ByteLength partagée avec saf-storage.js (même algorithme, même contrainte :
// mesurer ne doit jamais coûter une copie complète du contenu) — cf. naming.js.
import { base64ByteLength } from './naming'
const utf8ToB64 = (str) => bytesToB64(new TextEncoder().encode(str))
const b64ToUtf8 = (b64) => new TextDecoder().decode(b64ToBytes(b64))

function norm(path) {
  const parts = String(path || '')
    .split('/')
    .filter((p) => p && p !== '.')
  if (parts.includes('..')) throw new Error('chemin invalide (..)')
  return parts.join('/')
}

export class MemoryBackupStorage {
  constructor() {
    // Map chemin -> { isDir: bool, data: string|null } ; data stockée en base64 canonique
    // (représentation lossless commune aux fichiers texte et binaires).
    this.entries = new Map()
    this.entries.set('', { isDir: true, data: null }) // racine
  }

  #ensureDir(path) {
    const parts = norm(path).split('/').filter(Boolean)
    let cur = ''
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part
      const existing = this.entries.get(cur)
      if (existing && !existing.isDir) throw new Error(`n'est pas un dossier : ${cur}`)
      if (!existing) this.entries.set(cur, { isDir: true, data: null })
    }
  }

  // Supprime `base` et tous ses descendants `base/...` (préfixe sûr : ne touche pas
  // à un chemin frère comme `basex` ou `base-autre`).
  #removeSubtree(base) {
    if (!base) return
    const prefix = `${base}/`
    for (const key of Array.from(this.entries.keys())) {
      if (key === base || key.startsWith(prefix)) this.entries.delete(key)
    }
  }

  async mkdir(path) {
    this.#ensureDir(path)
  }

  async writeFile(path, data, { encoding = 'utf8' } = {}) {
    const p = norm(path)
    const slash = p.lastIndexOf('/')
    if (slash >= 0) this.#ensureDir(p.slice(0, slash))
    // Canonicalise en base64, que l'entrée soit du texte ou déjà du base64
    // (round-trip via bytes pour normaliser une éventuelle entrée non canonique).
    const b64 = encoding === 'base64' ? bytesToB64(b64ToBytes(data)) : utf8ToB64(String(data))
    this.#removeSubtree(p)
    this.entries.set(p, { isDir: false, data: b64 })
  }

  async readFile(path, { encoding = 'utf8', onChunk } = {}) {
    const e = this.entries.get(norm(path))
    if (!e || e.isDir) throw new Error(`fichier introuvable : ${path}`)
    // onChunk (restauration lourde) : UNE émission, en fin de lecture, avec
    // la taille réelle en octets — parité de FORME avec le natif (qui émet par
    // tranche) : les consommateurs (restore.js) ne doivent dépendre d'aucune
    // granularité, et un fichier en mémoire n'a aucun aller-retour à économiser.
    onChunk?.(base64ByteLength(e.data))
    return encoding === 'base64' ? e.data : b64ToUtf8(e.data)
  }

  async readdir(path = '') {
    // Chemin absent -> [] (aligné sur le plugin natif : File.listFiles() renvoie
    // null sur un dossier inexistant, traduit ici par une liste vide).
    const base = norm(path)
    const prefix = base ? `${base}/` : ''
    const out = []
    for (const [key, val] of this.entries) {
      if (key === base || !key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      if (rest.includes('/')) continue // pas un enfant immédiat
      // size : octets du fichier, 0 pour un dossier — même contrat que le
      // natif, où 0 signifie aussi « taille inconnue » (DocumentFile.length() rend 0
      // chez certains fournisseurs SAF) et masque la sous-barre de lecture.
      out.push({ name: rest, isDir: val.isDir, size: val.isDir ? 0 : base64ByteLength(val.data) })
    }
    return out
  }

  async exists(path) {
    return this.entries.has(norm(path))
  }

  async remove(path) {
    this.#removeSubtree(norm(path))
  }

  async rename(from, to) {
    const src = norm(from)
    const dst = norm(to)
    if (src === dst) return // no-op, évite la perte de données
    const slash = dst.lastIndexOf('/')
    if (slash >= 0) this.#ensureDir(dst.slice(0, slash))
    this.#removeSubtree(dst) // la destination est remplacée, pas fusionnée
    const prefix = `${src}/`
    for (const key of Array.from(this.entries.keys())) {
      if (key === src) {
        this.entries.set(dst, this.entries.get(key))
        this.entries.delete(key)
      } else if (key.startsWith(prefix)) {
        this.entries.set(dst + key.slice(src.length), this.entries.get(key))
        this.entries.delete(key)
      }
    }
  }
}

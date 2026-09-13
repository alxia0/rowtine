// tests/unit/reader-editable-image-preview.spec.js — Task A3 : preuve d'intégration.
// Prouve, à travers le VRAI pipeline de l'éditeur (pas un data-URL isolé, pas une
// map fabriquée à la main), que l'image d'un patron importé se résout en vignette :
// readerToEditable(reader) émet un fragment .md avec `![](img/photo-<hash>.ext)` ET
// une `images` map peuplée ; resolveImageSrc(cheminDuMd, images) doit renvoyer
// l'URL (non-null), pas un placeholder cassé. Cf. fix `21ddd68`.
import { describe, it, expect } from 'vitest'
import { readerToEditable } from '@/utils/pattern-md/reader-editable.js'
import { resolveImageSrc } from '@/utils/pattern-md/resolve-image-src.js'

// 1x1 PNG transparent, data URL valide (comme une image de pas extraite d'un PDF).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function readerWithStepImage() {
  return {
    sizeLabels: ['M'],
    sections: [
      { title: 'Yoke', kind: 'corps', steps: [
        { t: 'Rang 1 : monter les mailles', imgs: [PNG] },
      ] },
    ],
  }
}

describe('aperçu image via le vrai chemin readerToEditable', () => {
  it('la map images est peuplée et la ligne image du .md se résout en vignette', () => {
    const reader = readerWithStepImage()
    const { md, images } = readerToEditable(reader)

    // La map n'est PAS vide (répond à la crainte « map vide → placeholder »).
    expect(images.size).toBeGreaterThan(0)

    // Extraire le chemin de la ligne image du fragment : ![](<path>)
    const m = md.match(/!\[[^\]]*\]\(([^)]+)\)/)
    expect(m).not.toBeNull()
    const mdPath = m[1]
    // L'app émet un chemin d'asset (img/photo-<hash>.png), pas une data URL.
    expect(mdPath.startsWith('data:')).toBe(false)

    // Le résolveur doit rendre l'URL affichable (la vignette), pas null.
    expect(resolveImageSrc(mdPath, images)).toBe(PNG)
  })
})

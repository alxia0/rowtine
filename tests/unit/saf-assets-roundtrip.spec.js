// Régression B4 — round-trip WRITE→READ d'une image d'étape à travers le
// format Rowtine-MD enrichi et le stockage SAF : data URL (DB) → fichier SAF
// (buildPatternMdFiles) → chemin nu dans le .md (patternToMd, balise EN de
// section) → reparse (mdToPattern) → chemin nu dans le pattern → data URL
// (resolveReaderAssets), sans perte de contenu. Garantit que le pivot
// front-matter/balises anglicisées (B1) n'a pas cassé le pont assets écrit
// dans src/backup/pattern-md-file.js + src/backup/resolve-reader-assets.js
// (cf. tests/unit/pattern-md-file.spec.js, resolve-reader-assets.spec.js,
// reader-format-enrichi.spec.js pour le style et les conventions).
import { describe, it, expect } from 'vitest'
import { buildPatternMdFiles } from '@/backup/pattern-md-file'
import { resolveReaderAssets } from '@/backup/resolve-reader-assets'
import { mdToPattern } from '@/utils/pattern-md/parse'

// 1×1 PNG transparent valide (petit base64 réel, pas un placeholder).
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const IMG = `data:image/png;base64,${PNG_BASE64}`

const DIR = 'Patrons/bonnet-ainsa [1]'

const pattern = {
  name: 'Bonnet Aïnsa',
  author: 'Julie Fournier',
  reader: {
    sizeLabels: ['S', 'M', 'L'],
    sections: [
      {
        title: 'Dos',
        kind: 'corps',
        steps: [{ t: 'monter', imgs: [IMG] }],
      },
    ],
  },
}

describe('round-trip SAF des assets image (format enrichi)', () => {
  it('WRITE : patron.md porte la balise EN {body} et référence un asset écrit à part, en base64', () => {
    const { mdFile, assetFiles } = buildPatternMdFiles(pattern, DIR)

    expect(mdFile.data).toContain('{body}')
    const imgRefs = [...mdFile.data.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1])
    expect(imgRefs.length).toBe(1)
    const [imgPath] = imgRefs
    expect(imgPath.startsWith('data:')).toBe(false)

    const asset = assetFiles.find((f) => f.path === `${DIR}/${imgPath}`)
    expect(asset).toBeTruthy()
    expect(asset.encoding).toBe('base64')
    expect(asset.data).toBe(PNG_BASE64)
  })

  it('WRITE→READ→WRITE : reparse du .md donne un chemin nu, puis resolveReaderAssets restitue la data URL d\'origine sans perte', () => {
    const { mdFile, assetFiles } = buildPatternMdFiles(pattern, DIR)

    // READ : reparse le patron.md tel qu'il serait relu depuis le dossier SAF.
    const { pattern: reparsed, warnings } = mdToPattern(mdFile.data)
    expect(warnings).toEqual([])

    const dos = reparsed.reader.sections.find((s) => s.title === 'Dos')
    expect(dos.kind).toBe('corps')
    expect(dos.steps[0].imgs).toHaveLength(1)
    const barePath = dos.steps[0].imgs[0]
    expect(barePath.startsWith('data:')).toBe(false)

    // filesByName : noms de fichiers RELATIFS AU DOSSIER (sans le préfixe `${DIR}/`
    // porté par assetFiles[].path — cf. resolve-reader-assets.js et son spec : les
    // clés sont les chemins nus tels qu'émis par patternToMd/mdToPattern, pas les
    // chemins absolus du dossier SAF).
    const filesByName = Object.fromEntries(
      assetFiles.map((f) => [f.path.slice(`${DIR}/`.length), f.data])
    )

    // RESOLVE : le chemin nu issu du parse doit trouver son fichier.
    const { entity: resolved, missing } = resolveReaderAssets(reparsed, filesByName)
    expect(missing).toEqual([])
    const resolvedImg = resolved.reader.sections.find((s) => s.title === 'Dos').steps[0].imgs[0]
    expect(resolvedImg.startsWith('data:')).toBe(true)
    expect(resolvedImg).toBe(IMG)
  })
})

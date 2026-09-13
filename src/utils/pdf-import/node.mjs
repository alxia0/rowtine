// Moteur offline v2 : PDF → Rowtine-MD (entrée Node du banc mdlab).
// Point d'entrée Node du MOTEUR UNIQUE (fusion moteur unique) : importe les MÊMES
// modules que l'app (./lines, ./assemble, ../pattern-md/serialize) — aucune copie,
// aucun fork. L'app utilise index.js (navigateur), le banc utilise ce node.mjs ;
// les deux partagent la seule copie de src/utils/pdf-import.
import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { itemsToLines } from './lines.js'
import { buildReaderFromPages } from './assemble.js'
import { patternToMd } from '../pattern-md/serialize.js'

const SCANNED_CHARS_PER_PAGE = 50

export async function extractPagesFromPath(path) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), isEvalSupported: false }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(itemsToLines(content.items, content.styles, { pageWidth: page.view?.[2] || 595 }))
  }
  await doc.loadingTask?.destroy()
  return pages
}

// Sœur de extractPagesFromPath : rend AUSSI la fiche d'identité du PDF (doc.getMetadata()).
// Sert à recoller un titre de couverture écrit lettre par lettre (cf. spaced-title.js) —
// le PDF n'encode pas la coupure entre les mots, seule la fiche d'identité la porte parfois.
export async function extractPagesAndMetaFromPath(path) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), isEvalSupported: false }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(itemsToLines(content.items, content.styles, { pageWidth: page.view?.[2] || 595 }))
  }
  let metaTitle
  try { metaTitle = (await doc.getMetadata())?.info?.Title || '' } catch { metaTitle = '' }
  await doc.loadingTask?.destroy()
  return { pages, metaTitle }
}

export async function pdfToMd(path) {
  const { pages, metaTitle } = await extractPagesAndMetaFromPath(path)
  const chars = pages.reduce((a, p) => a + p.reduce((b, l) => b + l.text.length, 0), 0)
  if (!pages.length || chars / pages.length < SCANNED_CHARS_PER_PAGE) {
    return { md: '', scanned: true, warnings: [], confidence: null }
  }
  const { pattern, reader, warnings, confidence } = buildReaderFromPages(pages, {
    fileName: path.split('/').pop(),
    docMetaTitle: metaTitle,
  })
  const { md: rawMd } = patternToMd({ ...pattern, reader })
  // Dialecte §3.3 : patron mono-taille → pas de clé « sizes » (l'app garde le
  // libellé interne « Taille unique », le MD ne l'écrit pas). La clé est
  // anglicisée (sizes) depuis le lot A1 ; la branche de sécurité qui acceptait
  // en plus l'ancienne clé (tailles) a été retirée le 07/09/2026 (ménage du
  // code hérité — la branche ne pouvait de toute façon plus s'activer :
  // patternToMd n'écrit que `sizes:`). Ce banc travaille sur du texte MD BRUT
  // (pas un tableau sizeLabels) : il ne peut pas être branché sur le prédicat
  // isSingleSize (src/utils/reader.js). Cette regex doit rester alignée avec
  // celle du prédicat (/^taille unique$/i, insensible à la casse) si l'un des
  // deux évolue.
  const md = rawMd.replace(/^sizes: Taille unique\n/m, '')
  return { md, scanned: false, warnings, confidence }
}

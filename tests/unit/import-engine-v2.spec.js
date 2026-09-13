// Tests du moteur offline v2 du banc mdlab (tools/mdlab/engine) : les briques
// pures ajoutées par rapport au parseur de l'app — reflow, boilerplate, colonnes.
import { describe, it, expect } from 'vitest'
import { reflowLines } from '@/utils/pdf-import/reflow'
import { stripBoilerplate } from '@/utils/pdf-import/boilerplate'
import { itemsToLines } from '@/utils/pdf-import/lines'
import { detectSizeLabels } from '@/utils/pdf-import/sizes'

const L = (text, y = 0, size = 11) => ({ text, y, size, bold: false })

describe('mdlab reflow', () => {
  it('recolle une ligne coupée qui reprend en minuscule', () => {
    const out = reflowLines([L('Stricke bis 6 (7) Maschen vor dem'), L('Anfang der Runde stricken.')])
    expect(out.map((l) => l.text)).toEqual(['Stricke bis 6 (7) Maschen vor dem Anfang der Runde stricken.'])
  })
  it('recolle après un mot pendant même si la suite commence par un chiffre', () => {
    const out = reflowLines([L('Crocheter 1 b dans les'), L('63 prochaines m.')])
    expect(out).toHaveLength(1)
  })
  it('ne fusionne ni deux phrases ni deux abréviations', () => {
    const out = reflowLines([L('Première phrase.'), L('Deuxième phrase.'), L('ml = maille en l’air'), L('mc = maille coulée')])
    expect(out).toHaveLength(4)
  })
  it('mode para : regroupe par interligne, coupe aux grands blancs', () => {
    const out = reflowLines(
      [L('Un début de paragraphe.', 100), L('Sa suite immédiate.', 88), L('Nouveau paragraphe.', 50)],
      { para: true },
    )
    expect(out.map((l) => l.text)).toEqual(['Un début de paragraphe. Sa suite immédiate.', 'Nouveau paragraphe.'])
  })
})

describe('mdlab boilerplate', () => {
  it('retire SKU, TCPDF, copyright, liens boutique et pieds de page répétés', () => {
    const noise = ['hobbii-pattern-sku:pattern-1', 'Powered by TCPDF (www.tcpdf.org)', 'Hobbii.de - Copyright © 2018', 'http://shop.hobbii.de/x']
    const pages = [1, 2, 3].map((n) => [
      L('En-tête répété', 800),
      L(`Contenu utile ${n}`, 500),
      L(`Rang ${n} : tricoter à l'endroit`, 400),
      L('Mon pied de page répété', 20),
      ...noise.map((t) => L(t, 10)),
    ])
    const clean = stripBoilerplate(pages)
    expect(clean.flat().map((l) => l.text)).toEqual([
      'Contenu utile 1', "Rang 1 : tricoter à l'endroit",
      'Contenu utile 2', "Rang 2 : tricoter à l'endroit",
      'Contenu utile 3', "Rang 3 : tricoter à l'endroit",
    ])
  })
  it('ne touche pas un rang répété au MILIEU des pages malgré la normalisation des chiffres', () => {
    const pages = [1, 2].map((n) => [L('Titre', 800), L(`Rang ${n} : 3 m end`, 400), L('Pied', 20)])
    const clean = stripBoilerplate(pages)
    expect(clean.flat().some((l) => /Rang 1/.test(l.text))).toBe(true)
    expect(clean.flat().some((l) => /Rang 2/.test(l.text))).toBe(true)
  })
})

describe('mdlab colonnes (itemsToLines)', () => {
  const item = (str, x, y, w = 40) => ({ str, width: w, transform: [1, 0, 0, 1, x, y] })
  it('remet une page à deux colonnes en ordre de lecture', () => {
    const items = [
      item('G1', 50, 700), item('D1', 350, 700),
      item('G2', 50, 680), item('D2', 350, 680),
      item('G3', 50, 660), item('D3', 350, 660),
      item('G4', 50, 640), item('D4', 350, 640),
    ]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual(['G1', 'G2', 'G3', 'G4', 'D1', 'D2', 'D3', 'D4'])
  })
  it('page simple : les cellules d’une même ligne restent réunies', () => {
    const items = [item('ml', 50, 700, 15), item('maille en l’air', 120, 700, 80)]
    const lines = itemsToLines(items, {}, { pageWidth: 596 })
    expect(lines.map((l) => l.text)).toEqual(['ml maille en l’air'])
  })
})

describe('mdlab tailles', () => {
  it('lit une ligne Tailles multilingue avec de vrais tokens', () => {
    const { labels } = detectSizeLabels([[L('Größen: S/M (M/L)')]])
    expect(labels).toEqual(['S/M', 'M/L'])
  })
  it('ignore une phrase qui commence par « Taille »', () => {
    const { labels, from } = detectSizeLabels([[L('Taille : la jupe enfant a été mesurée pour s’assurer du tombé')]])
    expect(from).not.toBe('line')
    expect(labels).toEqual([])
  })
})

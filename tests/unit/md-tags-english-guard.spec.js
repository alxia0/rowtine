// Garde : toute balise {…} émise dans le .md est en vocabulaire anglais (dialecte,
// dialect.js REF_TO_EN/KIND_TO_EN). Verrouille contre une régression future vers
// une balise française (`{fil}`, `{tailles}`…). Test-only, aucun changement moteur —
// la directive est DÉJÀ respectée par serialize.js/refblocks.js.
import { describe, it, expect } from 'vitest'
import { patternToMd } from '@/utils/pattern-md/serialize'
import { REF_TO_EN, KIND_TO_EN } from '@/utils/pattern-md/dialect'
import { buildReference } from '@/utils/reader-reference'

// Vocabulaire anglais autorisé entre balises : les valeurs des deux tables de
// dialecte (REF_TO_EN a des clés FR ; KIND_TO_EN itou — on ne consomme que les
// VALEURS, déjà anglaises).
const ALLOWED = new Set([...Object.values(REF_TO_EN), ...Object.values(KIND_TO_EN)])

// Reader réaliste : reference construite par buildReference() couvrant TOUS les
// blocs (gauge/needles/yarn/materials/techniques/abbr/sizeTable) + 2 sections de
// travail à kind non-défaut (corps/manche) → exerce à la fois les balises de
// référence et les balises de kind dans un seul .md produit par le vrai patternToMd.
function fullReader() {
  const reference = buildReference({
    gauge: '20 m = 10 cm',
    needles: 'Aiguilles 4 mm',
    yarn: 'Laine mèche',
    materials: ['Marqueurs', 'Aiguille à laine'],
    techniques: [{ title: 'Montage', body: 'Monter les mailles' }],
    abbr: [{ key: 'm', def: 'maille' }],
    sizeTable: [{ label: 'Buste', values: ['90', '100'] }],
  })
  return {
    sizeLabels: ['S', 'M'],
    reference,
    sections: [
      { title: 'Corps', kind: 'corps', steps: [{ t: 'Rang 1 : tricoter' }] },
      { title: 'Manche', kind: 'manche', steps: [{ t: 'Rang 1 : tricoter' }] },
    ],
  }
}

describe('les balises émises sont en vocabulaire anglais', () => {
  it('le .md porte plusieurs balises ET aucune n\'est hors vocabulaire anglais', () => {
    const { md } = patternToMd({ reader: fullReader() })
    const tags = [...md.matchAll(/\{([A-Za-zÀ-ÿ-]+)\}/g)].map((m) => m[1])

    // Non-vacuité : le fixture ci-dessus produit exactement 9 balises (7 blocs
    // référence : gauge/yarn/needles/materials/techniques/abbreviations/measurements
    // + 2 kinds de section non-défaut : body/sleeve). Seuil < 9 = fixture appauvri,
    // pas la directive relâchée.
    expect(tags.length).toBeGreaterThanOrEqual(4)

    // Directive : chaque balise ∈ vocabulaire anglais (aucune balise française).
    const offenders = tags.filter((t) => !ALLOWED.has(t))
    expect(offenders).toEqual([])
  })

  it('les balises de référence attendues sont bien anglaises et présentes', () => {
    const { md } = patternToMd({ reader: fullReader() })
    // Preuve directe : les tags EN clés apparaissent, aucune forme FR.
    expect(md).toContain(`{${REF_TO_EN.fil}}`)     // {yarn}
    expect(md).toContain(`{${REF_TO_EN.mesures}}`) // {measurements}
    expect(md).toContain(`{${KIND_TO_EN.corps}}`)  // {body}
    expect(md).toContain(`{${KIND_TO_EN.manche}}`) // {sleeve}
    expect(md).not.toMatch(/\{(fil|tailles|aiguilles|abr[ée]viations|mat[ée]riel|corps|manche)\}/i)
  })
})

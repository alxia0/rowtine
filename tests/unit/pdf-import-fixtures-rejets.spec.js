// @vitest-environment node
// Les fixtures PDF qui servent de patron aux parcours e2e d'import (tests/e2e/import-pdf-vector.spec.js)
// doivent passer les refus nets d'import (reject.js) : un PDF refusé « pas un patron » n'atteint
// jamais l'assemblage, et l'e2e échouerait loin de sa cause (aucun bouton « Prévisualiser le
// patron »). Ce test porte la cause dans la suite rapide. Les deux fixtures multi-grilles ont
// longtemps porté un texte réduit (« Rang 1 endroit Rang 2 envers ») qui ne marque rien pour
// craft-detect.js (score 0) ; leur texte a été enrichi le 2026-09-24 (make-multigrid-pdf.mjs,
// make-vector-title-pdf.mjs).
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { extractPagesFromPath } from '@/utils/pdf-import/node.mjs'
import { detectRejection } from '@/utils/pdf-import/reject'
import { detectCraft, CRAFT_MIN_SCORE } from '@/utils/pdf-import/craft-detect'

const FIXTURES = [
  'tests/fixtures/vector-multigrid.pdf',
  'tests/fixtures/vector-title-multigrid.pdf',
  'tests/e2e/fixtures/vector-multigrid.pdf',
  'tests/e2e/fixtures/vector-title-multigrid.pdf',
  'tests/e2e/fixtures/vector-pattern.pdf',
  'tests/e2e/fixtures/Pull Sabai Test.pdf',
]

describe('fixtures e2e d’import : aucun refus net', () => {
  for (const rel of FIXTURES) {
    it(rel, async () => {
      const pages = await extractPagesFromPath(resolve(__dirname, '../..', rel))
      expect(detectRejection(pages)).toBeNull()
      expect(detectCraft(pages).score).toBeGreaterThanOrEqual(CRAFT_MIN_SCORE)
    })
  }

  // Marge : les deux multi-grilles ne doivent pas dépendre d'un seul marqueur (score ≥ 5, soit
  // au moins deux points au-dessus du seuil), pour qu'un recalage du lexique ne les refasse pas
  // tomber sans bruit.
  for (const rel of ['tests/fixtures/vector-multigrid.pdf', 'tests/fixtures/vector-title-multigrid.pdf']) {
    it(`${rel} : marge au-dessus du seuil`, async () => {
      const pages = await extractPagesFromPath(resolve(__dirname, '../..', rel))
      expect(detectCraft(pages).score).toBeGreaterThanOrEqual(CRAFT_MIN_SCORE + 2)
    })
  }
})

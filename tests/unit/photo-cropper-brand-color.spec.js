// Intent restes-ancienne-teinte-44 : plus un seul littéral #ad5a34 / rgb(173, 90, 52)
// (ancienne teinte de marque, remplacée par --brand-rgb dynamique) dans les styles vivants.
// PhotoCropper.vue était le dernier site restant au 12/09 — tous les autres (tokens.css,
// ReaderView.vue, HomeView.vue, ProjectDetailView.vue, ChronoPill.vue, ChartStage.vue,
// CounterCard.vue) étaient déjà migrés vers rgba(var(--brand-rgb), α) avant ce lot.
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'

describe('aucun littéral de l\'ancienne teinte 44 dans les styles vivants', () => {
  it('balayage src/ : aucune occurrence de rgb(173, 90, 52) ou #ad5a34 hors commentaire tokens.css:122 (mémoire historique)', () => {
    const out = execSync(
      String.raw`grep -rn "173, 90, 52\|ad5a34" src/ || true`,
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const lines = out.split('\n').filter(Boolean)
    // Seule occurrence tolérée : le commentaire historique de tokens.css qui explique
    // POURQUOI --brand-rgb a remplacé ce littéral (valeur documentaire, pas un style vivant).
    const nonComment = lines.filter((l) => !l.startsWith('src/styles/tokens.css:122:'))
    expect(nonComment).toEqual([])
  })
})

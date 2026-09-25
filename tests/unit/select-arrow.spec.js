// Flèche maison sur les <select> (P3).
// Le navigateur/WebView Android dessine encore sa propre flèche sur les <select> —
// seul reste natif visible au repos (la liste ouverte, elle, reste un dialogue OS,
// hors de portée du CSS).
//
// ⚠️ Piège vérifié : `.input` est partagée par TOUS les champs, dont 5
// <input type="date">. `appearance: none` posé sur `.input` tout court ferait
// disparaître l'icône calendrier native de ces 5 champs et les rendrait
// inutilisables — aucun autre test ne le verrait. La règle DOIT donc cibler
// `select.input` uniquement, jamais `.input` seul.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const lire = (p) => readFileSync(resolve(process.cwd(), p), 'utf8')

// Isole le bloc `select.input { ... }` du reste de la feuille de tokens.
const blocSelectInput = (css) => {
  const m = css.match(/select\.input\s*\{([^}]*)\}/s)
  return m ? m[1] : ''
}

// Isole le bloc `.input { ... }` générique (celui que portent aussi les
// <input type="date">) — DOIT rester exempt de tout `appearance`.
const blocInputGenerique = (css) => {
  const m = css.match(/(?:^|\n)\.input\s*\{([^}]*)\}/s)
  return m ? m[1] : ''
}

describe('flèche maison des <select> (charte §2.4bis)', () => {
  const css = lire('src/styles/tokens.css')

  it('select.input neutralise la flèche native (appearance: none)', () => {
    const bloc = blocSelectInput(css)
    expect(bloc).toMatch(/(?<!-webkit-)appearance:\s*none/)
    expect(bloc).toMatch(/-webkit-appearance:\s*none/)
  })

  it('select.input pose une flèche maison en background-image (jamais un glyphe ▾)', () => {
    const bloc = blocSelectInput(css)
    expect(bloc).toMatch(/background-image:\s*url\(/)
    expect(bloc).not.toContain('▾')
    expect(bloc).not.toMatch(/content:\s*['"]▾['"]/)
  })

  it("le champ `.input` générique (partagé par les <input type=\"date\">) ne porte AUCUN appearance", () => {
    const bloc = blocInputGenerique(css)
    expect(bloc).not.toMatch(/appearance/)
  })

  it('les 6 <input type="date"> du dépôt portent bien class="input" (pas de classe dédiée qui échapperait au garde-fou)', () => {
    // Les travaux sur le budget laine (01/08) : StashView.vue a perdu son champ « Date d'achat »
    // (#yarn-purchased, sur la fiche de laine elle-même) — une fiche peut désormais porter
    // PLUSIEURS achats, chacun avec sa propre date, saisie ligne à ligne dans le bloc
    // « Achats et cadeaux » (src/components/YarnPurchases.vue), qui a SON PROPRE
    // <input type="date"> (#ypur-date). Ce fichier a été ajouté à la liste balayée
    // ci-dessous (oubli corrigé depuis) : le compte total reste à 5, la
    // date d'achat a juste changé de porteur — StashView.vue en perd un, YarnPurchases.vue
    // en gagne un.
    //
    // Retour terrain (01/08, jour suivant) : StashView.vue EN REGAGNE un — #yarn-purchased-at,
    // affiché UNIQUEMENT à la création, pour saisir la date de la 1re ligne d'achat écrite
    // automatiquement sans repasser par la fiche. Total : 6.
    //
    // Bascule fiche/navigation (refonte stock laine, cf. plan) : le formulaire d'ajout/
    // édition quitte StashView.vue pour l'écran dédié YarnEditView.vue — #yarn-purchased-at
    // déménage avec lui. StashView.vue n'a donc plus AUCUN <input type="date">, YarnEditView.vue
    // en porte désormais un. Total inchangé : 6.
    const vues = [
      'src/views/YarnEditView.vue',
      'src/views/ProjectDetailView.vue',
      'src/views/ProjectEditView.vue',
      'src/components/YarnPurchases.vue',
    ]
    const dateInputs = vues.flatMap((v) => {
      const contenu = lire(v)
      return [...contenu.matchAll(/<input[^>]*type="date"[^>]*>/g)].map((m) => m[0])
    })
    expect(dateInputs.length).toBe(6)
    for (const balise of dateInputs) {
      expect(balise).toMatch(/class="input"/)
    }
  })
})

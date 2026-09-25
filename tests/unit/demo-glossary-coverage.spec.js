// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { loadDemoContent } from '@/constants/demo'
import { tokenizeLine } from '@/utils/reader'

// Le glossaire anglais des patrons de démo doit déclarer les formes COMPACTES réellement
// écrites (k2, p2, k2tog...) : le VRAI tokenizer (tokenizeLine, src/utils/reader.js) exige des
// frontières de mot, donc une clé générique « k » ne matche jamais dans « k2 », et le bouton
// cliquable du texte ne se déclenche pas.
//
// Deux invariants, dans les DEUX sens, avec le vrai tokenizer (jamais une regex réinventée) :
//   1) DÉCLARÉ → UTILISÉ : toute clé du glossaire d'un patron produit au moins un token
//      cliquable dans le texte de ses étapes.
//   2) UTILISÉ → DÉCLARÉ : toute notation collée compte+abréviation (lettre suivie d'un
//      chiffre) trouvée dans le texte est une clé déclarée. Ce sens cible la forme du défaut,
//      absente du fr/de/es (« 2 M », « 2 m. ») : non vacueux en anglais, trivial ailleurs.
const LANGUES = ['fr', 'en', 'de', 'es']
const GLUED_NOTATION_RE = /\b[a-zA-Z]+\d+[a-zA-Z]*\b/g

function stepsOf(pattern) {
  return pattern.reader.sections.flatMap((s) => s.steps)
}

describe('glossaire des exemples — chaque clé déclarée est réellement cliquable (vrai tokenizer)', () => {
  it('DÉCLARÉ → UTILISÉ : aucune clé de glossaire ne reste un bouton mort', async () => {
    for (const l of LANGUES) {
      const { patterns } = await loadDemoContent(l)
      for (const p of patterns) {
        const abbrKeys = Object.keys(p.reader.reference.abbr)
        const vues = new Set()
        for (const st of stepsOf(p)) {
          for (const tok of tokenizeLine(st.t, st.c || [], abbrKeys)) {
            if (tok.type === 'abbr') vues.add(tok.key)
          }
        }
        const mortes = abbrKeys.filter((k) => !vues.has(k))
        expect(mortes, `${l}/${p.demoId} : clés jamais cliquables dans le texte des étapes`).toEqual([])
      }
    }
  })

  it('UTILISÉ → DÉCLARÉ : aucune notation compte+abréviation collée ne manque au glossaire', async () => {
    let notationsVues = 0
    for (const l of LANGUES) {
      const { patterns } = await loadDemoContent(l)
      for (const p of patterns) {
        const abbrKeys = Object.keys(p.reader.reference.abbr)
        const manquantes = new Set()
        for (const st of stepsOf(p)) {
          const brut = String(st.t ?? '').replace(/\{\{\d+\}\}/g, '')
          for (const m of brut.match(GLUED_NOTATION_RE) || []) {
            notationsVues++
            if (!abbrKeys.includes(m)) manquantes.add(m)
          }
        }
        expect([...manquantes], `${l}/${p.demoId} : notation collée non déclarée au glossaire`).toEqual([])
      }
    }
    // Un test qui ne rencontre jamais son cas ne prouve rien : la notation collée doit être
    // trouvée au moins une fois (en anglais, k2/p2/k2tog/k4), sinon ce 2e test serait vrai
    // par vacuité sur les 4 langues et ne garantirait rien.
    expect(notationsVues).toBeGreaterThan(0)
  })
})

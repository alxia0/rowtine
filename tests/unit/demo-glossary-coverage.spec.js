import { describe, it, expect } from 'vitest'
import { loadDemoContent } from '@/constants/demo'
import { tokenizeLine } from '@/utils/reader'

// Verrou fonctionnel trouvé en revue de la tâche C5 : le glossaire anglais du Bonnet et de
// l'Écharpe était fait de clés génériques (« k », « p », « tog », « st(s) ») qui ne
// matchaient JAMAIS dans le texte réel des étapes, parce que la notation anglaise colle la
// lettre au chiffre (« k2 », « p2 », « k2tog ») alors que le VRAI tokenizer de l'app
// (tokenizeLine, src/utils/reader.js:31) exige des frontières de mot — un chiffre est un
// caractère de mot, donc « k2 » ne contient nulle part la séquence isolée « k ». Rien
// n'était perdu (l'onglet Abréviations liste tout), mais le bouton cliquable dans le texte
// — l'interaction que le patron promet lui-même de montrer — ne se déclenchait jamais pour
// ces clés. Corrigé (tâche C5) en déclarant les formes COMPACTES réellement écrites (k2,
// p2, k2tog, k4, sts/st) plutôt qu'en dégradant la notation anglaise (qu'une tricoteuse
// anglophone ne reconnaîtrait plus) ou en assouplissant le tokenizer partagé par toute
// l'app, y compris les imports réels (hors du périmètre d'un lot de contenu de démo).
//
// Deux invariants, dans les DEUX sens, avec le VRAI tokenizer (jamais une regex
// réinventée) :
//   1) DÉCLARÉ → UTILISÉ : toute clé du glossaire d'un patron doit produire au moins un
//      token cliquable quelque part dans le texte de ses étapes.
//   2) UTILISÉ → DÉCLARÉ : toute notation « collée » compte+abréviation (k2, p2, k2tog…)
//      trouvée dans le texte doit être une clé déclarée du glossaire.
//
// Le 2e sens ne peut pas se généraliser à toute abréviation imaginable sans dictionnaire —
// il cible précisément la forme mesurée du défaut (lettre immédiatement suivie d'un
// chiffre), absente par construction du fr/de/es (ces langues séparent toujours le compte
// de l'unité par une espace : « 2 M », « 2 m. », « 2 p. ») : le test y est donc
// non-vacueusement vrai en anglais, et trivialement vrai ailleurs — pas une garde qui ne
// peut jamais rougir, cf. tests/unit/demo-glossary-coverage.spec.js § preuve par mutation.
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

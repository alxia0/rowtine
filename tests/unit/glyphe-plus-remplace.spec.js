// Dette de juillet (audit UX) — plus AUCUN glyphe « + » / « − » typographique
// dans l'UI : la règle du dépôt est « jamais de glyphe dans l'UI » (cf. tête de
// src/utils/icons.js), et les steppers moitié glyphe moitié icône duraient depuis
// le passage du reste de l'app au registre AppIcon.
//
// Trois niveaux de garde, comme banc-ui-sans-glyphes.spec.js :
//  1. le registre porte bien l'icône `minus` (le « + » existait déjà) ;
//  2. les composants porteurs MONTÉS n'affichent plus de bouton-glyphe, et les
//     steppers icône-seul portent un aria-label humain (CounterCard, dont les
//     aria-labels étaient littéralement '+' et '-', ReaderChart repbar, sans
//     aria-label du tout) ;
//  3. garde statique sur TOUS les fichiers touchés (les vues entières — HomeView,
//     StashView, PatternView, ProjectEditView, ProjectDetailView, ReaderView,
//     ChartStage, RadialCalibrationWizard — tirent stores/routeur/IndexedDB et ne
//     se montent pas raisonnablement en unitaire : leurs boutons sont couverts par
//     un scan du source, même parti-pris que banc-ui-sans-glyphes.spec.js).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import CounterCard from '@/components/CounterCard.vue'
import CounterForm from '@/components/CounterForm.vue'
import ReaderChart from '@/components/ReaderChart.vue'
import { ICONS, hasIcon } from '@/utils/icons'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'

const t = (k) => i18n.global.t(k)

// Fichiers porteurs de boutons « + » / « − » (recensement du 07/09, grep `>\s*[+−]`).
const FICHIERS_TOUCHES = [
  'src/utils/icons.js',
  'src/components/CounterCard.vue',
  'src/components/CounterForm.vue',
  'src/components/ReaderChart.vue',
  'src/components/ChartStage.vue',
  'src/components/RadialCalibrationWizard.vue',
  'src/views/ReaderView.vue',
  'src/views/HomeView.vue',
  'src/views/PatternView.vue',
  'src/views/ProjectEditView.vue',
  'src/views/ProjectDetailView.vue',
  'src/views/StashView.vue',
]

// Même retrait que banc-ui-sans-glyphes.spec.js : les commentaires citent
// légitimement les glyphes qu'ils documentent (ex. le commentaire CSS de
// CounterCard sur le chiffre qui « danse entre les boutons − et + »).
function sansCommentaires(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // blocs /* */ (JS + CSS)
    .replace(/\/\/[^\n]*/g, ' ') // lignes // (JS)
    .replace(/<!--[\s\S]*?-->/g, ' ') // commentaires HTML
}

// Les deux formes recensées : bouton-glyphe seul (`>+</button>`, `>−</button>`)
// et CTA « + libellé » (`>+ {{ t(...) }}`). Le « − » U+2212 seulement : les
// `—` de données (options de sélecteur, tirets cadratins) ne sont pas des glyphes.
const GLYPHE_BOUTON = />\s*[+−]\s*(?:<\/button>|\{\{)/g

describe('registre d\'icônes — entrée minus', () => {
  it('`minus` existe à côté de `plus` (steppers : le « − » passe AUSSI en icône)', () => {
    expect(hasIcon('minus')).toBe(true)
    expect(ICONS.minus.body).toContain('<path')
  })
})

describe('clés i18n — steppers et repbar, 4 langues (valeurs brutes, hors repli)', () => {
  const LANGUES = [
    ['fr', fr, { dec: 'Diminuer', inc: 'Augmenter', prev: 'Répétition précédente', next: 'Répétition suivante' }],
    ['en', en, { dec: 'Decrease', inc: 'Increase', prev: 'Previous repeat', next: 'Next repeat' }],
    ['de', de, { dec: 'Verringern', inc: 'Erhöhen', prev: 'Vorherige Wiederholung', next: 'Nächste Wiederholung' }],
    ['es', es, { dec: 'Disminuir', inc: 'Aumentar', prev: 'Repetición anterior', next: 'Repetición siguiente' }],
  ]
  for (const [loc, m, v] of LANGUES) {
    it(`${loc} : icounter.decrease/increase et reader.chart.repPrev/repNext sont traduits`, () => {
      expect(m.icounter.decrease).toBe(v.dec)
      expect(m.icounter.increase).toBe(v.inc)
      expect(m.reader.chart.repPrev).toBe(v.prev)
      expect(m.reader.chart.repNext).toBe(v.next)
    })
  }
})

describe('CounterCard monté — steppers sans glyphe, aria-labels humains', () => {
  const monter = () =>
    mount(CounterCard, {
      props: { counter: { id: 'c1', name: 'Rangs', value: 7 } },
      global: { plugins: [i18n] },
    })

  it('aucun bouton ne porte le glyphe +/− en texte', () => {
    const w = monter()
    const glyphes = w.findAll('button').filter((b) => ['+', '−'].includes(b.text().trim()))
    expect(glyphes).toHaveLength(0)
  })

  it('les deux steppers annoncent une action (icounter.decrease / increase), plus jamais \'+\'/\'-\'', () => {
    const w = monter()
    const pm = w.findAll('.ccard__pm')
    expect(pm).toHaveLength(2)
    expect(pm[0].attributes('aria-label')).toBe(t('icounter.decrease'))
    expect(pm[1].attributes('aria-label')).toBe(t('icounter.increase'))
    for (const b of pm) {
      expect(b.attributes('aria-label')).not.toMatch(/^[+−-]$/)
    }
    // Le sens reste porté par l'icône, pas par le texte du bouton.
    expect(pm[0].find('svg').exists()).toBe(true)
    expect(pm[1].find('svg').exists()).toBe(true)
  })
})

describe('CounterForm monté — CTA de soumission sans « + »', () => {
  it('le bouton de soumission ne commence plus par le glyphe « + »', () => {
    const w = mount(CounterForm, { global: { plugins: [i18n] } })
    const submit = w.find('.btn--primary')
    expect(submit.exists()).toBe(true)
    expect(submit.text().trim()).not.toMatch(/^\+/)
  })
})

describe('ReaderChart monté — rowbar, repbar et CTA « ajouter une répétition »', () => {
  const monter = (reps) =>
    mount(ReaderChart, {
      props: {
        chart: { rows: 10, cols: 4, img: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', reps },
        modelValue: 2,
        currentRep: 2,
      },
      global: { plugins: [i18n] },
    })

  it('rowbar + repbar : aucun bouton-glyphe, les 4 steppers portent un aria-label non vide', () => {
    const w = monter(3)
    expect(w.find('.chart__rowbar').exists()).toBe(true)
    expect(w.find('.chart__repbar').exists()).toBe(true)
    const glyphes = w.findAll('button').filter((b) => ['+', '−'].includes(b.text().trim()))
    expect(glyphes).toHaveLength(0)
    const rowbar = w.findAll('.chart__rowbar .chart__btn')
    const repbar = w.findAll('.chart__repbar .chart__btn')
    // rowbar = 3 boutons : les deux steppers + « corriger le nombre de rangs » (editrows).
    expect(rowbar).toHaveLength(3)
    expect(repbar).toHaveLength(2)
    // rowbar : aria-labels existants (reader.chart.prev/next) conservés.
    expect(rowbar[0].attributes('aria-label')).toBe(t('reader.chart.prev'))
    expect(rowbar[1].attributes('aria-label')).toBe(t('reader.chart.next'))
    // repbar : aria-labels POSÉS (ils n'existaient pas) — reader.chart.repPrev/repNext.
    expect(repbar[0].attributes('aria-label')).toBe(t('reader.chart.repPrev'))
    expect(repbar[1].attributes('aria-label')).toBe(t('reader.chart.repNext'))
    for (const b of [...rowbar, ...repbar]) {
      expect(b.attributes('aria-label').length).toBeGreaterThan(0)
      expect(b.find('svg').exists()).toBe(true)
    }
  })

  it('CTA « ajouter un compteur de répétition » sans « + » initial', () => {
    const w = monter(0)
    const addrep = w.find('.chart__addrep')
    expect(addrep.exists()).toBe(true)
    expect(addrep.text().trim()).not.toMatch(/^\+/)
  })
})

describe('garde statique — plus aucun bouton-glyphe dans les fichiers touchés', () => {
  for (const f of FICHIERS_TOUCHES) {
    it(`${f} : aucun « + »/« − » typographique dans un bouton (hors commentaires)`, () => {
      const code = sansCommentaires(readFileSync(resolve(process.cwd(), f), 'utf8'))
      const hits = []
      for (const m of code.matchAll(GLYPHE_BOUTON)) {
        const ligne = code.slice(0, m.index).split('\n').length
        hits.push(`ligne ${ligne} : ${m[0].trim()}`)
      }
      expect(hits).toEqual([])
    })
  }
})

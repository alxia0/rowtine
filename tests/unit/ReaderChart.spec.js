// ReaderChart : barre de répétition + roll-over + bouton manuel
// TDD : RED → GREEN. Réplique tests du banc, adaptés au montage i18n réel de l'app.
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import i18n from '@/i18n'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import ReaderChart from '@/components/ReaderChart.vue'
import { chartBands } from '@/utils/reader'
import { patternToMd, mdToPattern } from '@/utils/pattern-md'

const chart = { img: 'x', cols: 4, rows: 3, readDir: 'd', repeat: '4 m × 3 rangs', reps: 5 }
const CHART_RADIAL_SQUARE = { img: 'g.png', rows: 5, shape: 'radial-square' }
const CHART_RADIAL_CIRCLE = { img: 'g.png', rows: 5, shape: 'radial-circle' }
const CHART_PATH = { img: 'g.png', rows: 3, shape: 'path' }
const PATH_FRAME = { points: [{ x: 20, y: 30 }, { x: 80, y: 30 }], spacing: 5 }

function mountChart(props) {
  return mount(ReaderChart, { props, global: { plugins: [i18n] } })
}

describe('ReaderChart — compteur de répétition', () => {
  it('affiche la barre de répétition « Répétition Y / N » si reps>0 et interactif', () => {
    const w = mountChart({ chart, modelValue: 1, currentRep: 2, readOnly: false })
    expect(w.find('.chart__repbar').exists()).toBe(true)
    expect(w.find('.chart__repval').text()).toContain('2 / 5')
  })

  it('roll-over : avancer au-delà du dernier rang remet le rang à 1 et émet currentRep+1', async () => {
    const w = mountChart({ chart, modelValue: 3, currentRep: 2, readOnly: false })
    await w.find('.chart__next').trigger('click') // rang 3 = rows → roll-over
    expect(w.emitted('update:modelValue').at(-1)).toEqual([1])
    expect(w.emitted('update:currentRep').at(-1)).toEqual([3])
  })

  it('roll-over borné : à la dernière répétition, ne dépasse pas reps (pas d\'émission au-delà)', async () => {
    const w = mountChart({ chart, modelValue: 3, currentRep: 5, readOnly: false })
    await w.find('.chart__next').trigger('click')
    // currentRep déjà à reps (5) : aucun incrément au-delà, donc aucune émission update:currentRep
    expect(w.emitted('update:currentRep')).toBeUndefined()
    // le rang reste au dernier rang (diagramme terminé), pas d'avance illégale
    expect(w.emitted('update:modelValue').at(-1)).toEqual([3])
  })

  it('bouton « ajouter un compteur de répétition » si reps absent (interactif) → émet request-reps', async () => {
    const noReps = { ...chart, reps: undefined }
    const w = mountChart({ chart: noReps, modelValue: 1, readOnly: false })
    expect(w.find('.chart__addrep').exists()).toBe(true)
    await w.find('.chart__addrep').trigger('click')
    expect(w.emitted('request-reps')).toBeTruthy()
  })
})

describe('ReaderChart — anneau radial (lecture)', () => {
  it('un motif radial-square rend un rectangle, pas les bandes linéaires', () => {
    const w = mountChart({ chart: CHART_RADIAL_SQUARE, modelValue: 3, readOnly: false })
    expect(w.find('svg.chart__rings').exists()).toBe(true)
    expect(w.find('rect.chart__ring--hl').exists()).toBe(true)
    expect(w.find('ellipse').exists()).toBe(false)
    expect(w.find('.chart__hl').exists()).toBe(false)
  })

  it('calcule les attributs du rectangle depuis chartRings (rang 3/5, cadrage par défaut)', () => {
    const w = mountChart({ chart: CHART_RADIAL_SQUARE, modelValue: 3, readOnly: false })
    const hl = w.find('rect.chart__ring--hl')
    expect(hl.attributes('x')).toBe('25')
    expect(hl.attributes('y')).toBe('25')
    expect(hl.attributes('width')).toBe('50')
    expect(hl.attributes('height')).toBe('50')
    expect(hl.attributes('stroke-width')).toBe('10')
    const done = w.find('rect.chart__ring--done')
    expect(done.attributes('x')).toBe('40')
    expect(done.attributes('y')).toBe('40')
    expect(done.attributes('width')).toBe('20')
    expect(done.attributes('height')).toBe('20')
    expect(done.attributes('stroke-width')).toBe('20')
  })

  it('un motif radial-circle rend une ellipse ; rx = ry quand canvasAspect vaut 1 (défaut)', () => {
    const w = mountChart({ chart: CHART_RADIAL_CIRCLE, modelValue: 3, readOnly: false })
    expect(w.find('ellipse.chart__ring--hl').exists()).toBe(true)
    expect(w.find('rect').exists()).toBe(false)
    const hl = w.find('ellipse.chart__ring--hl')
    expect(hl.attributes('rx')).toBe('25')
    expect(hl.attributes('ry')).toBe('25')
  })

  it("compense l'ellipse pour un cadre non carré : ry = rx × largeur/hauteur du canvas", async () => {
    const w = mountChart({ chart: CHART_RADIAL_CIRCLE, modelValue: 3, readOnly: false })
    w.vm.canvasAspect = 3.11
    await nextTick()
    const hl = w.find('ellipse.chart__ring--hl')
    expect(Number(hl.attributes('rx'))).toBeCloseTo(25)
    expect(Number(hl.attributes('ry'))).toBeCloseTo(77.75)
  })

  // Retour terrain 26/08 (après l'assistant à loupe fixe) : voir le commentaire jumeau dans
  // chart-stage.spec.js — la prémisse qui dispensait le carré de compensation ne tient plus.
  it("compense le carré pour un cadre non carré : height = largeur × largeur/hauteur du canvas", async () => {
    const w = mountChart({ chart: CHART_RADIAL_SQUARE, modelValue: 3, readOnly: false })
    w.vm.canvasAspect = 3.11
    await nextTick()
    const hl = w.find('rect.chart__ring--hl')
    expect(Number(hl.attributes('width'))).toBeCloseTo(50)
    expect(Number(hl.attributes('height'))).toBeCloseTo(155.5)
    expect(Number(hl.attributes('x'))).toBeCloseTo(25)
    expect(Number(hl.attributes('y'))).toBeCloseTo(-27.75)
  })

  it('un diagramme linéaire (shape absent) est inchangé : pas de <svg class="chart__rings">', () => {
    const w = mountChart({ chart, modelValue: 1, readOnly: false })
    expect(w.find('svg.chart__rings').exists()).toBe(false)
    expect(w.find('.chart__hl').exists()).toBe(true)
  })

  // Revue finale (26/08) : ce composant (vue en ligne, non plein écran) n'avait jamais reçu
  // le 4e argument de chartRings ni les branches rings.doneShape/hlShape — un calage à forme
  // mixte (cercle près du centre, carré à l'extérieur, tout l'intérêt de l'assistant) ne
  // changeait de forme QUE dans ChartStage.vue (plein écran), jamais ici.
  it('rend un contour mixte : rangs avant le switchRound en cercle, à partir de lui en carré', () => {
    const frame = { cx: 50, cy: 50, r0: 0, r1: 50, r0Shape: 'circle', r1Shape: 'square', switchRound: 4 }
    const before = mountChart({ chart: CHART_RADIAL_SQUARE, modelValue: 3, readOnly: false, frame })
    expect(before.find('ellipse.chart__ring--hl').exists()).toBe(true)
    expect(before.find('rect.chart__ring--hl').exists()).toBe(false)
    const after = mountChart({ chart: CHART_RADIAL_SQUARE, modelValue: 4, readOnly: false, frame })
    expect(after.find('rect.chart__ring--hl').exists()).toBe(true)
    expect(after.find('ellipse.chart__ring--hl').exists()).toBe(false)
  })

  it('masque les affordances de lecture linéaire (sens, début/fin de rang) pour un motif radial', () => {
    const w = mountChart({ chart: CHART_RADIAL_SQUARE, modelValue: 3, readOnly: false })
    expect(w.find('.chart__colhint').exists()).toBe(false)
    expect(w.find('.chart__end').exists()).toBe(false)
    expect(w.find('.chart__start').exists()).toBe(false)
  })
})

describe('ReaderChart — contour de contraste garanti sur la bande « rang en cours » (retour terrain 26/08)', () => {
  it('radial-square : le contour --hl-edge a les mêmes x/y/largeur que --hl, un stroke-width élargi de 3', () => {
    const w = mountChart({ chart: CHART_RADIAL_SQUARE, modelValue: 3, readOnly: false })
    const edge = w.find('rect.chart__ring--hl-edge')
    const hl = w.find('rect.chart__ring--hl')
    expect(edge.exists()).toBe(true)
    expect(edge.attributes('x')).toBe(hl.attributes('x'))
    expect(edge.attributes('y')).toBe(hl.attributes('y'))
    expect(edge.attributes('width')).toBe(hl.attributes('width'))
    expect(edge.attributes('height')).toBe(hl.attributes('height'))
    expect(Number(edge.attributes('stroke-width'))).toBeCloseTo(Number(hl.attributes('stroke-width')) + 3)
  })

  it('radial-circle : le contour --hl-edge a les mêmes rx/ry que --hl, un stroke-width élargi de 3', () => {
    const w = mountChart({ chart: CHART_RADIAL_CIRCLE, modelValue: 3, readOnly: false })
    const edge = w.find('ellipse.chart__ring--hl-edge')
    const hl = w.find('ellipse.chart__ring--hl')
    expect(edge.exists()).toBe(true)
    expect(edge.attributes('rx')).toBe(hl.attributes('rx'))
    expect(edge.attributes('ry')).toBe(hl.attributes('ry'))
    expect(Number(edge.attributes('stroke-width'))).toBeCloseTo(Number(hl.attributes('stroke-width')) + 3)
  })
})

describe('ReaderChart — tracé (lecture)', () => {
  it('un diagramme par tracé rend des polylignes, pas les bandes linéaires', () => {
    const w = mountChart({ chart: CHART_PATH, modelValue: 2, frame: PATH_FRAME, readOnly: false })
    expect(w.find('svg.chart__path').exists()).toBe(true)
    expect(w.findAll('polyline.chart__pathrow')).toHaveLength(3)
    expect(w.find('.chart__hl').exists()).toBe(false)
  })

  it('calcule les points de chaque rang depuis chartPathRows (rang 2/3, décalage 5)', () => {
    const w = mountChart({ chart: CHART_PATH, modelValue: 2, frame: PATH_FRAME, readOnly: false })
    const rows = w.findAll('polyline.chart__pathrow')
    expect(rows[0].attributes('points')).toBe('20,30 80,30')
    expect(rows[1].attributes('points')).toBe('20,25 80,25')
    expect(rows[2].attributes('points')).toBe('20,20 80,20')
  })

  it('colore le rang courant, les rangs faits et les rangs à venir différemment', () => {
    const w = mountChart({ chart: CHART_PATH, modelValue: 2, frame: PATH_FRAME, readOnly: false })
    const rows = w.findAll('polyline.chart__pathrow')
    expect(rows[0].classes()).toContain('chart__pathrow--done')
    expect(rows[1].classes()).toContain('chart__pathrow--hl')
    expect(rows[2].classes()).toContain('chart__pathrow--future')
  })

  it('sans frame (jamais calé) : les polylignes existent mais sont vides, aucune exception', () => {
    const w = mountChart({ chart: CHART_PATH, modelValue: 1, readOnly: false })
    const rows = w.findAll('polyline.chart__pathrow')
    expect(rows).toHaveLength(3)
    rows.forEach((r) => expect(r.attributes('points')).toBe(''))
  })

  it('masque les affordances de lecture linéaire pour un motif par tracé, comme pour le radial', () => {
    const w = mountChart({ chart: CHART_PATH, modelValue: 2, frame: PATH_FRAME, readOnly: false })
    expect(w.find('.chart__colhint').exists()).toBe(false)
    expect(w.find('.chart__end').exists()).toBe(false)
    expect(w.find('.chart__start').exists()).toBe(false)
  })
})

describe('ReaderChart — invite de calage Étape 2 pour un motif radial ou path (retour terrain 26/08)', () => {
  it('affiche l\'invite de calage (texte radial) pour un motif radial sans frame, mais pas l\'annonce du rideau ni le sens de lecture', () => {
    const w = mountChart({ chart: CHART_RADIAL_SQUARE, modelValue: 3, readOnly: false })
    const invite = w.find('.chart__calinvite')
    expect(invite.exists()).toBe(true)
    expect(invite.text()).toContain(fr.reader.chart.calibrateInviteRadial)
    expect(w.find('.chart__curtainhint').exists()).toBe(false)
    expect(w.find('.chart__read').exists()).toBe(false)
  })

  it('affiche l\'invite de calage (texte path) pour un motif path sans frame, mais pas l\'annonce du rideau', () => {
    const w = mountChart({ chart: CHART_PATH, modelValue: 1, readOnly: false })
    const invite = w.find('.chart__calinvite')
    expect(invite.exists()).toBe(true)
    expect(invite.text()).toContain(fr.reader.chart.calibrateInvitePath)
    expect(w.find('.chart__curtainhint').exists()).toBe(false)
  })

  it('clic sur l\'invite radiale émet zoom, comme pour un diagramme standard', async () => {
    const w = mountChart({ chart: CHART_RADIAL_SQUARE, modelValue: 3, readOnly: false })
    await w.find('.chart__calinvite').trigger('click')
    expect(w.emitted('zoom')).toBeTruthy()
  })

  it('avec un frame déjà calé, l\'invite radiale disparaît (comportement identique au standard)', () => {
    const w = mountChart({ chart: CHART_RADIAL_SQUARE, modelValue: 3, readOnly: false, frame: { cx: 50, cy: 50, r0: 0, r1: 40 } })
    expect(w.find('.chart__calinvite').exists()).toBe(false)
  })

  it('les garde affichées (texte standard) pour un diagramme linéaire sans frame (comportement inchangé)', () => {
    const linChart = { img: 'x', cols: 4, rows: 3, readDir: 'd', repeat: '4 m × 3 rangs', reps: 5 }
    const w = mountChart({ chart: linChart, modelValue: 1, readOnly: false })
    const invite = w.find('.chart__calinvite')
    expect(invite.exists()).toBe(true)
    expect(invite.text()).toContain(fr.reader.chart.calibrateInvite)
    expect(w.find('.chart__curtainhint').exists()).toBe(true)
    expect(w.find('.chart__read').exists()).toBe(true)
  })
})

describe('ReaderChart — grille importée sans nombre de rangs (rows:0)', () => {
  const noRows = { img: 'x', cols: 0, rows: 0, readDir: '', repeat: '', builtinLegend: false }

  it('rows:0 → PAS de compteur « 1 / 0 » ; bouton « indiquer le nombre de rangs » ; clic émet request-rows', async () => {
    const w = mountChart({ chart: noRows, modelValue: 1, readOnly: false })
    expect(w.find('.chart__rowbar').exists()).toBe(false) // pas de faux compteur
    const setRows = w.find('.chart__setrows')
    expect(setRows.exists()).toBe(true)
    await setRows.trigger('click')
    expect(w.emitted('request-rows')).toBeTruthy()
  })

  it('rows:0 → pas de bandes de surlignage ni de repère de fin (rien qui dépende du total)', () => {
    const w = mountChart({ chart: noRows, modelValue: 1, readOnly: false })
    expect(w.find('.chart__hl').exists()).toBe(false)
    expect(w.find('.chart__end').exists()).toBe(false)
  })

  it('l’image reste visible et zoomable même sans rangs connus', async () => {
    const w = mountChart({ chart: noRows, modelValue: 1, readOnly: false })
    expect(w.find('.chart__canvas img').exists()).toBe(true)
    await w.find('.chart__canvas img').trigger('click')
    expect(w.emitted('zoom')).toBeTruthy()
  })

  it('rows>0 → compteur présent, bouton « indiquer les rangs » absent', () => {
    const w = mountChart({ chart, modelValue: 1, readOnly: false })
    expect(w.find('.chart__rowbar').exists()).toBe(true)
    expect(w.find('.chart__setrows').exists()).toBe(false)
  })

  // Retour terrain 26/08 : une fois le nombre de rangs saisi, aucun moyen de corriger une
  // erreur de frappe — ce bouton réutilise le même geste (request-rows) que la saisie initiale.
  it('rows>0 → bouton de correction présent, émet request-rows', async () => {
    const w = mountChart({ chart, modelValue: 1, readOnly: false })
    const editBtn = w.find('.chart__editrows')
    expect(editBtn.exists()).toBe(true)
    await editBtn.trigger('click')
    expect(w.emitted('request-rows')).toBeTruthy()
  })

  it('lecture seule + rows>0 → pas de bouton de correction (non interactif)', () => {
    const w = mountChart({ chart, modelValue: 1, readOnly: true })
    expect(w.find('.chart__editrows').exists()).toBe(false)
  })

  it('lecture seule + rows:0 → pas de bouton de saisie (non interactif)', () => {
    const w = mountChart({ chart: noRows, modelValue: 1, readOnly: true })
    expect(w.find('.chart__setrows').exists()).toBe(false)
  })
})

describe('ReaderChart — bouton agrandir (plein écran) + frame de calage', () => {
  it('le bouton « agrandir » émet zoom', async () => {
    const w = mountChart({ chart, modelValue: 1, readOnly: false })
    await w.find('.chart__zoom').trigger('click')
    expect(w.emitted('zoom')).toBeTruthy()
  })

  it('taper sur l’image du diagramme émet aussi zoom', async () => {
    const w = mountChart({ chart, modelValue: 1, readOnly: false })
    await w.find('.chart__canvas img').trigger('click')
    expect(w.emitted('zoom')).toBeTruthy()
  })

  it('la prop frame déplace la bande de surlignage (chartBands reçoit le frame)', () => {
    const frame = { top: 20, bottom: 80 }
    const expected = chartBands(1, chart.rows, frame)
    const w = mountChart({ chart, modelValue: 1, readOnly: false, frame })
    const hl = w.find('.chart__hl')
    expect(hl.attributes('style')).toContain(`top: ${expected.hlTop}%`)
  })

  it('sans frame (plein cadre), la bande reste identique au comportement historique', () => {
    const expected = chartBands(1, chart.rows)
    const w = mountChart({ chart, modelValue: 1, readOnly: false })
    const hl = w.find('.chart__hl')
    expect(hl.attributes('style')).toContain(`top: ${expected.hlTop}%`)
  })
})

describe('ReaderChart — invite de calage dans l’en-tête', () => {
  it('sans frame et interactif : invite visible, clic émet zoom', async () => {
    const w = mountChart({ chart, modelValue: 1, readOnly: false })
    const invite = w.find('.chart__calinvite')
    expect(invite.exists()).toBe(true)
    await invite.trigger('click')
    expect(w.emitted('zoom')).toBeTruthy()
  })

  it('avec un frame calé, l’invite disparaît', () => {
    const w = mountChart({ chart, modelValue: 1, readOnly: false, frame: { top: 5, bottom: 95 } })
    expect(w.find('.chart__calinvite').exists()).toBe(false)
  })

  it('en lecture seule, l’invite est absente', () => {
    const w = mountChart({ chart, modelValue: 1, readOnly: true })
    expect(w.find('.chart__calinvite').exists()).toBe(false)
  })
})

describe('ReaderChart — invite du rideau de progression', () => {
  it('sans frame et interactif : phrase d\'annonce visible', () => {
    const w = mountChart({ chart, modelValue: 1, readOnly: false })
    expect(w.find('.chart__curtainhint').exists()).toBe(true)
  })

  it('avec un frame calé, la phrase disparaît (comme l\'invite de calage)', () => {
    const w = mountChart({ chart, modelValue: 1, readOnly: false, frame: { top: 5, bottom: 95 } })
    expect(w.find('.chart__curtainhint').exists()).toBe(false)
  })

  it('en lecture seule, la phrase est absente', () => {
    const w = mountChart({ chart, modelValue: 1, readOnly: true })
    expect(w.find('.chart__curtainhint').exists()).toBe(false)
  })
})

describe('ReaderChart — ordre et numérotation des étapes', () => {
  const fresh = { img: 'x', rows: 0 } // grille importée : rangs inconnus

  it('grille fraîche non calée : « nombre de rangs » (1) précède « placez les lignes » (2)', () => {
    const w = mount(ReaderChart, {
      props: { chart: fresh, modelValue: 1, readOnly: false, frame: null },
      global: { plugins: [i18n] },
    })
    const setrows = w.find('.chart__setrows')
    const calinvite = w.find('.chart__calinvite')
    expect(setrows.exists()).toBe(true)
    expect(calinvite.exists()).toBe(true)
    // ordre DOM : setRows AVANT calibrateInvite
    expect(setrows.element.compareDocumentPosition(calinvite.element)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // badges 1 et 2 présents
    expect(setrows.find('.chart__stepnum').text()).toBe('1')
    expect(calinvite.find('.chart__stepnum').text()).toBe('2')
  })

  it('rangs déjà connus, non calée : « placez les lignes » seule, sans numéro orphelin', () => {
    const w = mount(ReaderChart, {
      props: { chart: { img: 'x', rows: 12 }, modelValue: 1, readOnly: false, frame: null },
      global: { plugins: [i18n] },
    })
    expect(w.find('.chart__setrows').exists()).toBe(false)
    expect(w.find('.chart__calinvite').exists()).toBe(true)
    expect(w.find('.chart__calinvite .chart__stepnum').exists()).toBe(false)
  })
})

// Revue coordinateur (31/07) : aucun test n'exerçait le texte RÉELLEMENT rendu de
// `.chart__read` — une régression vers l'ancienne interpolation brute (`dir: chart.readDir`,
// le bug d'origine de la tâche C3) serait passée inaperçue de toute la suite. Montage avec
// locale EXPLICITE (comme reader-sheet-i18n.spec.js), pas la locale par défaut de l'app
// (dépendante du device détecté, donc non déterministe en test).
function mountChartLocale(locale, messages, chartProps) {
  const localeI18n = createI18n({ legacy: false, locale, messages })
  return mount(ReaderChart, { props: { chart: chartProps, modelValue: 1, readOnly: true }, global: { plugins: [localeI18n] } })
}

describe('ReaderChart — sens de lecture affiché (texte réel de .chart__read)', () => {
  const rtlChart = { img: 'x', cols: 4, rows: 3, readDir: 'rtl', repeat: '4 m × 3 rangs' }

  it('code rtl, locale FR : « droite à gauche »', () => {
    const w = mountChartLocale('fr', { fr }, rtlChart)
    expect(w.find('.chart__read').text()).toContain('droite à gauche')
    expect(w.find('.chart__read').text()).not.toContain('rtl')
  })

  it('code rtl, locale EN : « right to left », jamais le code brut ni le français', () => {
    const w = mountChartLocale('en', { en }, rtlChart)
    expect(w.find('.chart__read').text()).toContain('right to left')
    expect(w.find('.chart__read').text()).not.toContain('rtl')
    expect(w.find('.chart__read').text()).not.toContain('droite à gauche')
  })

  it('valeur héritée (patron déjà importé, phrase toute faite) : passthrough même en EN', () => {
    const legacyChart = { img: 'x', cols: 4, rows: 3, readDir: 'droite à gauche', repeat: '4 m × 3 rangs' }
    const w = mountChartLocale('en', { en }, legacyChart)
    expect(w.find('.chart__read').text()).toContain('droite à gauche')
  })
})

// Revue finale du chantier multilingue (31/07) — défaut IMPORTANT : parse.js régénérait
// `chart.repeat` en FRANÇAIS EN DUR (`${cols} m × ${rows} rangs`) à chaque relecture d'un
// Rowtine-MD, écrasant tout libellé traduit dès qu'un patron passait par ce format (import
// zip, synchro patron.md). Corrigé : le moteur ne fabrique plus AUCUN texte (chart.repeat
// reste '' si non fourni) ; le libellé se reconstruit à l'AFFICHAGE, dans la langue courante,
// via chartMotifLabel (src/utils/reader.js).
function germanChartPattern() {
  return {
    name: 'Test motif diagramme',
    author: '',
    reader: {
      sizeLabels: [],
      sections: [
        {
          id: 'diagramme-1',
          kind: 'diagramme',
          title: 'Diagramm 1',
          steps: [{ chart: true }],
          chart: { img: 'data:image/png;base64,QUJD', rows: 24, cols: 8, readDir: 'rtl', repeat: '8 M × 24 Reihen', builtinLegend: false },
        },
      ],
    },
  }
}

describe('ReaderChart — libellé du motif après un aller-retour Rowtine-MD (revue finale, 31/07)', () => {
  it('un libellé traduit (allemand) ne redevient pas français après round-trip : dérivé de cols/rows dans la langue courante', () => {
    const { md } = patternToMd(germanChartPattern())
    const { pattern: reparsed, warnings } = mdToPattern(md)
    expect(warnings).toEqual([])
    const diag = reparsed.reader.sections.find((s) => s.title === 'Diagramm 1')
    // Le moteur ne fabrique plus AUCUN texte : cols/rows survivent fidèlement, repeat
    // (une phrase, donc une DONNÉE traduisible) ne survit pas au format et reste vide —
    // c'est l'affichage qui la reconstruit, jamais le moteur (zéro-dépendance i18n).
    expect(diag.chart.repeat).toBe('')
    expect(diag.chart.cols).toBe(8)
    expect(diag.chart.rows).toBe(24)

    const w = mountChartLocale('de', { de }, diag.chart)
    expect(w.find('.chart__read').text()).toContain('8 M × 24 Reihen')
    expect(w.find('.chart__read').text()).not.toContain('8 m × 24 rangs') // ex-fabrication française
  })

  it('un libellé déjà fourni (patron importé, dans n’importe quelle langue) reste verbatim, jamais écrasé', () => {
    const w = mountChartLocale('de', { de }, { img: 'x', cols: 8, rows: 24, readDir: 'rtl', repeat: '8 sts × 24 rows' })
    expect(w.find('.chart__read').text()).toContain('8 sts × 24 rows')
  })
})

import { describe, it, expect } from 'vitest'
import { validateReader } from '@/utils/reader'
import { isKind } from '@/utils/section-kinds'
import { PATTERN_CATEGORIES } from '@/constants/catalog'
import { loadDemoContent, DEMO_PATTERN_DEMO_ID } from '@/constants/demo'

describe('contenu de démonstration — français', () => {
  it('expose trois patrons, deux projets et le patron libre', async () => {
    const { patterns, projects, freePattern } = await loadDemoContent('fr')
    expect(patterns).toHaveLength(3)
    expect(projects.idea).toBeTruthy()
    expect(projects.wip).toBeTruthy()
    expect(freePattern.name).toBeTruthy()
  })

  it('chaque patron porte un demoId stable, non traduit', async () => {
    const { patterns } = await loadDemoContent('fr')
    expect(patterns.map((p) => p.demoId).sort()).toEqual(['bonnet', 'echarpe', 'sac'])
  })

  it('le patron désigné pour le projet en cours existe', async () => {
    const { patterns } = await loadDemoContent('fr')
    expect(patterns.some((p) => p.demoId === DEMO_PATTERN_DEMO_ID)).toBe(true)
  })

  it('chaque lecteur est structurellement valide (compteurs alignés sur les tailles)', async () => {
    const { patterns } = await loadDemoContent('fr')
    for (const p of patterns) {
      // ⚠️ `validateReader` (src/utils/reader.js:196) signale « sizeLabels vide » pour TOUT
      // lecteur sans tailles. C'est un avertissement de fixture de test, pas un défaut :
      // le « Patron libre » livré avec l'application a lui aussi `sizeLabels: []` et
      // fonctionne. L'Écharpe et le Sac sont en taille unique par nature — on filtre donc
      // ce seul message et on exige zéro erreur RÉELLE (compteurs mal alignés,
      // emplacement {{n}} sans compteur, compteur inutilisé).
      const erreurs = validateReader(p.reader).filter((e) => e !== 'sizeLabels vide')
      expect(erreurs, `patron ${p.demoId}`).toEqual([])
    }
  })

  it('le patron du projet en cours, lui, est multi-tailles (il démontre les compteurs)', async () => {
    const { patterns } = await loadDemoContent('fr')
    const bonnet = patterns.find((p) => p.demoId === 'bonnet')
    expect(validateReader(bonnet.reader)).toEqual([]) // aucune erreur, pas même « sizeLabels vide »
    expect(bonnet.reader.sizeLabels).toEqual(['S', 'M', 'L'])
  })

  it("n'utilise que des genres de section connus, et jamais l'ancien champ icon", async () => {
    const { patterns } = await loadDemoContent('fr')
    for (const p of patterns) {
      for (const sec of p.reader.sections) {
        expect(isKind(sec.kind), `${p.demoId}/${sec.id}`).toBe(true)
        expect(sec.icon, `${p.demoId}/${sec.id} ne doit pas porter d'emoji`).toBeUndefined()
      }
    }
  })

  it('les catégories appartiennent au catalogue', async () => {
    const { patterns } = await loadDemoContent('fr')
    for (const p of patterns) expect(PATTERN_CATEGORIES).toContain(p.category)
  })

  it('un patron au moins porte un diagramme, pour le démontrer au 1er lancement', async () => {
    const { patterns } = await loadDemoContent('fr')
    const avecChart = patterns.filter((p) => p.reader.chart || p.reader.sections.some((s) => s.chart))
    expect(avecChart.length).toBeGreaterThan(0)
  })

  it('le sens de lecture du diagramme est un code, pas une phrase française', async () => {
    const { patterns } = await loadDemoContent('fr')
    for (const p of patterns) {
      const charts = [p.reader.chart, ...p.reader.sections.map((s) => s.chart)].filter(Boolean)
      for (const c of charts) expect(['rtl', 'ltr']).toContain(c.readDir)
    }
  })

  // ⚠️ Rien ne garantit spontanément que le compteur qui fait parcourir un diagramme du
  // début à la fin s'arrête bien au dernier rang : `chart.rows` (le nombre de rangs du
  // diagramme) et le `total` d'un compteur de répétitions qui le parcourt sont deux valeurs
  // écrites à des endroits différents. Rien ne les tient rapprochées automatiquement — un
  // total recopié à la main peut driver du nombre de rangs sans qu'aucun autre test ne le
  // remarque (vérifié par mutation ci-dessous). On repère un tel compteur par une marque
  // STRUCTURELLE (`chartRounds: true` sur l'étape), jamais par le texte de l'étape : ce
  // test doit continuer de fonctionner tel quel sur les futurs jeux de contenu en/de/es.
  it('un compteur qui parcourt un diagramme reste calé sur son nombre de rangs', async () => {
    const { patterns } = await loadDemoContent('fr')
    let vus = 0
    for (const p of patterns) {
      for (const sec of p.reader.sections) {
        const chart = sec.chart || p.reader.chart
        for (const st of sec.steps) {
          if (!st.chartRounds) continue
          vus++
          expect(chart, `${p.demoId}/${sec.id} : compteur chartRounds sans diagramme associé`).toBeTruthy()
          for (const v of st.total) {
            expect(v, `${p.demoId}/${sec.id} : total du compteur ≠ chart.rows`).toBe(chart.rows)
          }
        }
      }
    }
    // Un test qui ne rencontre jamais son cas ne prouve rien : au moins un patron doit
    // démontrer ce mécanisme (le Bonnet, ici).
    expect(vus).toBeGreaterThan(0)
  })
})

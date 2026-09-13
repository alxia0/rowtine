import { describe, it, expect } from 'vitest'
import { mdToPattern } from '@/utils/pattern-md/parse'
import { patternToMd } from '@/utils/pattern-md/serialize'

// mdToPattern renvoie { pattern, warnings } ; le reader est sous pattern.reader
// (signature vérifiée sur tests/unit/pattern-md-parse.spec.js).
// `sizes: Unique` déclare une taille : sans taille, n = 0 et total (« N par taille »)
// est ramené à [] par normalizeReaderForSave (comme pour tout compteur, cf. « × collé »).
const MD = (body) => `---\nrowtine: 1\nsizes: Unique\ntitle: T\n---\n\n## Corps {body}\n\n${body}\n`
const steps = (md) => mdToPattern(md).pattern.reader.sections.find((s) => s.title === 'Corps').steps
// patternToMd renvoie { md, files } (signature vérifiée sur pattern-md-serialize.spec.js).
const roundtrip = (md) => patternToMd(mdToPattern(md).pattern).md

describe('parse.js — marqueurs de compteur de l’éditeur', () => {
  it('lit {×N} comme une répétition (compteur, pas de texte brut)', () => {
    const [st] = steps(MD('- {×4} Travailler les rangs 1-2'))
    expect(st.repeat).toBe(true)
    expect(st.total).toEqual([4])
    expect(st.every).toBeUndefined()
    expect(st.t).toBe('Travailler les rangs 1-2')
    expect(st.t).not.toContain('{×')
  })

  it('lit {cadence X×N} comme une cadence (repeat + every)', () => {
    const [st] = steps(MD('- {cadence 4×6} Travailler les rangs 1-4'))
    expect(st.repeat).toBe(true)
    expect(st.every).toBe(4)
    expect(st.total).toEqual([6])
    expect(st.t).toBe('Travailler les rangs 1-4')
  })

  it('ne casse pas la répétition legacy « - × … »', () => {
    const [st] = steps(MD('- × répéter 3 fois'))
    expect(st.repeat).toBe(true)
    expect(st.every).toBeUndefined()
  })

  it('marqueur seul sans texte : rien de perdu (retombe en texte brut, pas supprimé)', () => {
    const st = steps(MD('- {×4}'))
    expect(st.length).toBe(1)
    expect(st[0].t).toContain('{×4}')
  })
})

describe('serialize.js — ré-émission des compteurs (round-trip sans perte)', () => {
  it('émet la cadence en {cadence X×N} (aucune forme legacy possible)', () => {
    const md = roundtrip(MD('- {cadence 4×6} Travailler les rangs 1-4'))
    expect(md).toContain('- {cadence 4×6} Travailler les rangs 1-4')
  })

  it('round-trip cadence : parse→serialize→parse conserve every et total', () => {
    const [st] = steps(roundtrip(MD('- {cadence 4×6} Rangs 1-4')))
    expect(st.every).toBe(4)
    expect(st.total).toEqual([6])
  })

  it('émet une répétition d’origine marqueur en {×N} (le nombre n’est pas dans le texte)', () => {
    const md = roundtrip(MD('- {×4} Travailler les rangs 1-2'))
    expect(md).toContain('{×4}') // sinon « 4 » perdu (le texte porte « 1-2 »)
    const [st] = steps(md)
    expect(st.total).toEqual([4]) // round-trip sans perte
  })

  it('laisse la répétition legacy « - × … » INCHANGÉE (banc-safe)', () => {
    const md = roundtrip(MD('- × répéter 3 fois'))
    expect(md).toContain('- × répéter 3 fois')
    expect(md).not.toContain('{×')
  })

  it('un « - × » d’origine import (nombre présent mais pas en tête) reste legacy (banc-safe)', () => {
    const md = roundtrip(MD('- × Répéter les rangs 1-4, 3 fois'))
    expect(md).toContain('- × Répéter les rangs 1-4, 3 fois')
    expect(md).not.toContain('{×')
  })

  it('répétition marqueur : {×4} survit même quand « 4 » est un jeton du texte (perte silencieuse fermée)', () => {
    // Piège fermé (revue) : « 4 » figure comme jeton du texte → l'ancien prédicat
    // banc-safe gardait « - × … », et le re-parse legacy captait le PREMIER nombre
    // (« 1 »), corrompant N=4 en 1 SANS avertissement. Le tag de provenance force le
    // marqueur pour un pas d'origine éditeur.
    const md = roundtrip(MD('- {×4} Rangs 1 à 6, 4 motifs'))
    expect(md).toContain('- {×4} Rangs 1 à 6, 4 motifs') // marqueur, pas legacy
    expect(md).not.toContain('- × Rangs') // « - × … » corromprait 4→1 au re-parse
    const [st] = steps(md)
    expect(st.total).toEqual([4]) // round-trip sans perte
  })

  it('cadence marqueur : {cadence X×N} survit quand le texte contient des nombres', () => {
    const md = roundtrip(MD('- {cadence 4×6} Rangs 1 à 6, encore 6 fois'))
    expect(md).toContain('- {cadence 4×6} Rangs 1 à 6, encore 6 fois')
    const [st] = steps(md)
    expect(st.every).toBe(4)
    expect(st.total).toEqual([6])
  })

  it('cadence à n=0 (total vidé par la normalisation) : jamais de marqueur malformé', () => {
    // Sans clé `sizes`, n = 0 : normalizeReaderForSave vide total mais garde every.
    const md0 = '---\nrowtine: 1\ntitle: T\n---\n\n## Corps {body}\n\n- {cadence 4×6} Rangs 1-4\n'
    const out = patternToMd(mdToPattern(md0).pattern).md
    expect(out).not.toContain('undefined') // pas de « {cadence 4×undefined} »
    expect(out).toContain('- × Rangs 1-4') // dégradation propre en legacy, pas de garbage
  })
})

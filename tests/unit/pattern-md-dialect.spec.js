import { describe, it, expect } from 'vitest'
import {
  KIND_TO_EN,
  KIND_TO_FR,
  REF_TO_EN,
  FRONTMATTER_TO_EN,
  FRONTMATTER_TO_FR,
  kindToEn,
  kindToFr,
  frontmatterKeyToEn,
  frontmatterKeyToFr,
} from '@/utils/pattern-md/dialect'

// Kinds de travail (spec section-kinds.js), hors `pelote` (défaut non balisé).
const WORK_KINDS_FR = [
  'corps', 'manche', 'encolure', 'bordure', 'accessoires',
  'tete', 'corpsrond', 'membre', 'oreille', 'museau', 'queue',
  'motif', 'dentelle', 'echantillon', 'diagramme', 'boutonniere',
  'finitions', 'autre',
  // Un arbitrage (03/09) : rubriques de service/conseils — section consultable
  // du flux, tag `info` (distinct du bloc référence `intro` de REF_TO_EN).
  'infos',
]

describe('KIND_TO_EN / KIND_TO_FR', () => {
  it('mappe chaque kind FR vers son EN attendu', () => {
    expect(KIND_TO_EN.corps).toBe('body')
    expect(KIND_TO_EN.manche).toBe('sleeve')
    expect(KIND_TO_EN.encolure).toBe('neckline')
    expect(KIND_TO_EN.bordure).toBe('border')
    expect(KIND_TO_EN.accessoires).toBe('accessory')
    expect(KIND_TO_EN.tete).toBe('head')
    expect(KIND_TO_EN.corpsrond).toBe('round-body')
    expect(KIND_TO_EN.membre).toBe('limb')
    expect(KIND_TO_EN.oreille).toBe('ear')
    expect(KIND_TO_EN.museau).toBe('muzzle')
    expect(KIND_TO_EN.queue).toBe('tail')
    expect(KIND_TO_EN.motif).toBe('motif')
    expect(KIND_TO_EN.dentelle).toBe('lace')
    // kind de travail échantillon = tag distinct `swatch` (le bloc référence, lui,
    // reste `gauge` via REF_TO_EN) — évite la collision/perte au round-trip.
    expect(KIND_TO_EN.echantillon).toBe('swatch')
    expect(KIND_TO_FR.swatch).toBe('echantillon')
    expect(KIND_TO_EN.diagramme).toBe('chart')
    expect(KIND_TO_EN.boutonniere).toBe('buttonhole')
    expect(KIND_TO_EN.finitions).toBe('finishing')
    expect(KIND_TO_EN.autre).toBe('other')
    // Un arbitrage : tag EN `info` — distinct du `intro` de REF_TO_EN (espaces de
    // balises disjoints : kinds de section vs blocs référence), round-trip OK.
    expect(KIND_TO_EN.infos).toBe('info')
    expect(KIND_TO_FR.info).toBe('infos')
  })

  it("n'inclut pas `pelote` (défaut non balisé)", () => {
    expect(KIND_TO_EN.pelote).toBeUndefined()
    expect(KIND_TO_FR.pelote).toBeUndefined()
  })

  it('round-trip FR -> EN -> FR pour tous les kinds de travail', () => {
    for (const fr of WORK_KINDS_FR) {
      const en = KIND_TO_EN[fr]
      expect(en, `KIND_TO_EN.${fr}`).toBeTruthy()
      expect(KIND_TO_FR[en], `KIND_TO_FR.${en}`).toBe(fr)
    }
  })

  it('KIND_TO_FR est bien l\'inverse exact de KIND_TO_EN', () => {
    expect(Object.keys(KIND_TO_FR).length).toBe(Object.keys(KIND_TO_EN).length)
    for (const [fr, en] of Object.entries(KIND_TO_EN)) {
      expect(KIND_TO_FR[en]).toBe(fr)
    }
  })
})

describe('kindToEn / kindToFr (helpers tolérants)', () => {
  it('traduit un kind connu', () => {
    expect(kindToEn('corps')).toBe('body')
    expect(kindToFr('body')).toBe('corps')
  })

  it('round-trip sur tous les kinds de travail via les helpers', () => {
    for (const fr of WORK_KINDS_FR) {
      const en = kindToEn(fr)
      expect(kindToFr(en)).toBe(fr)
    }
  })

  it('tolère un kind inconnu : renvoie tel quel', () => {
    expect(kindToFr('inconnu')).toBe('inconnu')
    expect(kindToEn('inconnu')).toBe('inconnu')
  })

  it('tolère `pelote` (non traduit, ni FR->EN ni EN->FR)', () => {
    expect(kindToEn('pelote')).toBe('pelote')
    expect(kindToFr('pelote')).toBe('pelote')
  })
})

describe('REF_TO_EN (blocs référence)', () => {
  it('mappe les clés internes attendues', () => {
    expect(REF_TO_EN.echantillon).toBe('gauge')
    expect(REF_TO_EN.fil).toBe('yarn')
    expect(REF_TO_EN.aiguilles).toBe('needles')
    expect(REF_TO_EN.materiel).toBe('materials')
    expect(REF_TO_EN.techniques).toBe('techniques')
    expect(REF_TO_EN.abbr).toBe('abbreviations')
    expect(REF_TO_EN.conseils).toBe('tips')
    expect(REF_TO_EN.mesures).toBe('measurements')
    expect(REF_TO_EN.tailles).toBe('measurements')
    expect(REF_TO_EN.galerie).toBe('gallery')
    expect(REF_TO_EN.info).toBe('intro')
  })
})

describe('FRONTMATTER_TO_EN / FRONTMATTER_TO_FR', () => {
  it('mappe chaque clé front-matter FR vers son EN attendu', () => {
    expect(FRONTMATTER_TO_EN.titre).toBe('title')
    expect(FRONTMATTER_TO_EN.auteur).toBe('author')
    expect(FRONTMATTER_TO_EN.lien).toBe('link')
    expect(FRONTMATTER_TO_EN.tailles).toBe('sizes')
    expect(FRONTMATTER_TO_EN['sous-tailles']).toBe('subsizes')
    expect(FRONTMATTER_TO_EN.aisance).toBe('ease')
  })

  it("n'inclut pas `rowtine` (clé technique inchangée)", () => {
    expect(FRONTMATTER_TO_EN.rowtine).toBeUndefined()
    expect(FRONTMATTER_TO_FR.rowtine).toBeUndefined()
  })

  it('round-trip FR -> EN -> FR pour toutes les clés front-matter', () => {
    for (const fr of Object.keys(FRONTMATTER_TO_EN)) {
      const en = FRONTMATTER_TO_EN[fr]
      expect(FRONTMATTER_TO_FR[en]).toBe(fr)
    }
  })

  it('helpers frontmatterKeyToEn / frontmatterKeyToFr : round-trip', () => {
    for (const fr of Object.keys(FRONTMATTER_TO_EN)) {
      const en = frontmatterKeyToEn(fr)
      expect(frontmatterKeyToFr(en)).toBe(fr)
    }
  })

  it('tolère une clé inconnue : renvoie telle quelle', () => {
    expect(frontmatterKeyToEn('inconnue')).toBe('inconnue')
    expect(frontmatterKeyToFr('unknown')).toBe('unknown')
  })

  it('tolère `rowtine` (inchangée par les helpers)', () => {
    expect(frontmatterKeyToEn('rowtine')).toBe('rowtine')
    expect(frontmatterKeyToFr('rowtine')).toBe('rowtine')
  })
})

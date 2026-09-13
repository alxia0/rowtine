// Unitaire — `relativeDayLabel` (date-format.js, T4 du 31/08 soir) : libellé relatif de
// jour de la tuile « Dernières sessions ». Fonction PURE : `now` injecté, aucune horloge
// implicite (règle du projet, cf. time-periods.js). Frontières demandées par la spec :
// d = 0, 1, 2, 6, 7, 29, 30, 359, 360, d négatif (horloge modifiée → ramené à 0), et le
// piège minuit/DST (séance à 23 h 50 un dimanche, vue le lundi 00 h 10 → « Hier »,
// pas « Dimanche »). Spot-checks de locale : fr, en, de, es — la fonction suit la locale,
// aucun texte français n'est figé hors logique.
//
// Toutes les dates sont construites en COMPOSANTES LOCALES puis converties en instant ISO
// (comme l'écrit l'app via `.toISOString()` après une saisie locale) — jamais
// `new Date('AAAA-MM-JJ')`, minuit UTC, piège documenté en tête de date-format.js. Ainsi
// les libellés attendus sont valables quel que soit le fuseau du poste qui exécute les
// tests, bascule d'heure d'été comprise (l'écart est calculé à midi local de chaque jour).
import { describe, it, expect } from 'vitest'
import { relativeDayLabel } from '@/utils/date-format'

// Instant ISO d'une séance, exprimé en heures LOCALES.
const iso = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

// Référence : lundi 31 août 2026, 10:00 locales (le 31/08/2026 est bien un lundi).
const NOW = new Date(2026, 7, 31, 10, 0)

describe('relativeDayLabel — frontières de l’écart en jours calendaires locaux', () => {
  it('d = 0 : « Aujourd’hui » (mot dédié de la locale, pas « il y a 0 jour »)', () => {
    expect(relativeDayLabel(iso(2026, 8, 31, 8), NOW, 'fr')).toBe('Aujourd’hui')
  })

  it('d = 1 : « Hier » (numeric:\'always\' rendrait « il y a 1 jour » — traitement dédié)', () => {
    expect(relativeDayLabel(iso(2026, 8, 30, 12), NOW, 'fr')).toBe('Hier')
  })

  it('d = 2 : nom du jour long de la séance, initiale en capitale (« Samedi »)', () => {
    expect(relativeDayLabel(iso(2026, 8, 29, 12), NOW, 'fr')).toBe('Samedi')
  })

  it('d = 6 : encore le nom du jour (dernier du créneau 2–6)', () => {
    expect(relativeDayLabel(iso(2026, 8, 25, 12), NOW, 'fr')).toBe('Mardi')
  })

  it('d = 7 : bascule sur la forme relative « Il y a 7 jours »', () => {
    expect(relativeDayLabel(iso(2026, 8, 24, 12), NOW, 'fr')).toBe('Il y a 7 jours')
  })

  it('d = 29 : dernier jour rendu en semaines de jours (« Il y a 29 jours »)', () => {
    expect(relativeDayLabel(iso(2026, 8, 2, 12), NOW, 'fr')).toBe('Il y a 29 jours')
  })

  it('d = 30 : bascule en mois, n = floor(30/30) = 1', () => {
    expect(relativeDayLabel(iso(2026, 8, 1, 12), NOW, 'fr')).toBe('Il y a 1 mois')
  })

  it('d = 359 : encore 11 mois (floor(359/30)), pas encore un an', () => {
    expect(relativeDayLabel(iso(2025, 9, 6, 12), NOW, 'fr')).toBe('Il y a 11 mois')
  })

  it('d = 360 : bascule en années, N = floor(360/360) = 1', () => {
    expect(relativeDayLabel(iso(2025, 9, 5, 12), NOW, 'fr')).toBe('Il y a 1 an')
  })
})

describe('relativeDayLabel — cas pièges', () => {
  it('séance future (horloge modifiée) : d < 0 ramené à 0 → « Aujourd’hui »', () => {
    expect(relativeDayLabel(iso(2026, 9, 1, 12), NOW, 'fr')).toBe('Aujourd’hui')
    expect(relativeDayLabel(iso(2027, 2, 15, 12), NOW, 'fr')).toBe('Aujourd’hui')
  })

  it('piège minuit/DST : séance dimanche 23:50, now lundi 00:10 → « Hier », pas « Dimanche »', () => {
    const lundiMinuit10 = new Date(2026, 7, 31, 0, 10)
    expect(relativeDayLabel(iso(2026, 8, 30, 23, 50), lundiMinuit10, 'fr')).toBe('Hier')
  })

  it('tolère une date-jour AAAA-MM-JJ : lue en LOCAL (discipline des deux formes du module)', () => {
    expect(relativeDayLabel('2026-08-30', NOW, 'fr')).toBe('Hier')
  })

  it('valeur invalide ou vide : repli vide — l’appelant garde la durée seule', () => {
    expect(relativeDayLabel('', NOW, 'fr')).toBe('')
    expect(relativeDayLabel('pas-une-date', NOW, 'fr')).toBe('')
    expect(relativeDayLabel(null, NOW, 'fr')).toBe('')
  })
})

describe('relativeDayLabel — la sortie suit la locale (spot-checks)', () => {
  it('en : Today / Yesterday / weekday / 7 days ago / 1 month ago / 1 year ago', () => {
    expect(relativeDayLabel(iso(2026, 8, 31, 8), NOW, 'en')).toBe('Today')
    expect(relativeDayLabel(iso(2026, 8, 30, 12), NOW, 'en')).toBe('Yesterday')
    expect(relativeDayLabel(iso(2026, 8, 29, 12), NOW, 'en')).toBe('Saturday')
    expect(relativeDayLabel(iso(2026, 8, 24, 12), NOW, 'en')).toBe('7 days ago')
    expect(relativeDayLabel(iso(2026, 8, 1, 12), NOW, 'en')).toBe('1 month ago')
    expect(relativeDayLabel(iso(2025, 9, 5, 12), NOW, 'en')).toBe('1 year ago')
  })

  it('de : Heute / Gestern / Vor 7 Tagen (spot-check)', () => {
    expect(relativeDayLabel(iso(2026, 8, 31, 8), NOW, 'de')).toBe('Heute')
    expect(relativeDayLabel(iso(2026, 8, 30, 12), NOW, 'de')).toBe('Gestern')
    expect(relativeDayLabel(iso(2026, 8, 24, 12), NOW, 'de')).toBe('Vor 7 Tagen')
  })

  it('es : Hoy / Ayer / Hace 7 días (spot-check)', () => {
    expect(relativeDayLabel(iso(2026, 8, 31, 8), NOW, 'es')).toBe('Hoy')
    expect(relativeDayLabel(iso(2026, 8, 30, 12), NOW, 'es')).toBe('Ayer')
    expect(relativeDayLabel(iso(2026, 8, 24, 12), NOW, 'es')).toBe('Hace 7 días')
  })
})

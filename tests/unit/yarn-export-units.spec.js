// Unitaire — export tableur du stock (yarnExportTable) suit les unités et la devise
// choisies. L'export est un chemin SÉPARÉ des vues : il construit ses
// en-têtes lui-même à partir de { system, currency, locale } — sans ce passage explicite,
// il resterait silencieusement en métrique/euro alors que le reste de l'app aurait changé.
//
// Règle qui gouverne la colonne prix : la devise est une ÉTIQUETTE, jamais un taux de
// change (cf. src/utils/units.js). Changer de devise ne doit JAMAIS recalculer un montant
// déjà saisi — seul l'en-tête change.
//
// Le passage multilingue (29/07) : le booléen `en` a disparu de la signature. Les en-têtes
// passent par `t(key)` (vérifié dans yarn-export.spec.js) ; ce fichier-ci se concentre sur
// ce qui reste piloté directement par `system`/`currency`/`locale` dans ce module : le choix
// de la clé de longueur (yd/m), le symbole de devise, et le séparateur décimal.
import { describe, it, expect } from 'vitest'
import { yarnExportTable } from '@/utils/yarn-filter'

const t = (key) => `[${key}]`

const laine = {
  brand: 'Drops', model: 'Baby Merino', colorName: 'Bleu glacier', weight: 'dk',
  lengthM: 210, quantity: 3, price: 4.5, bain: 'AB123', purchasedAt: '2026-01-15',
  composition: ['Laine', 'Alpaga'],
}

describe('yarnExportTable — unités et devise', () => {
  it('métrique : en-tête = clé « lengthM », valeur = celle stockée', () => {
    const { head, rows } = yarnExportTable([laine], { t, system: 'metric', currency: 'EUR', locale: 'fr' })
    expect(head[6]).toBe(t('settings.export.yarn.lengthM'))
    expect(rows[0][6]).toBe(210)
  })

  it('impérial (locale "en") : en-tête = clé « lengthYd », valeur convertie, arrondie et à POINT', () => {
    const { head, rows } = yarnExportTable([laine], { t, system: 'imperial', currency: 'EUR', locale: 'en' })
    expect(head[6]).toBe(t('settings.export.yarn.lengthYd'))
    // 210 / 0,9144 = 229,6587... -> arrondi à 2 décimales (précision retenue pour l'export).
    expect(rows[0][6]).toBeCloseTo(229.66, 2)
    expect(rows[0][6]).not.toBe('229,66')
  })

  it('impérial (locale "fr") : en-tête = clé « lengthYd », valeur convertie, arrondie et à VIRGULE (revue finale 26/07)', () => {
    const { head, rows } = yarnExportTable([laine], { t, system: 'imperial', currency: 'EUR', locale: 'fr' })
    expect(head[6]).toBe(t('settings.export.yarn.lengthYd'))
    // Virgule, pas point : un CSV à point-virgule pour Excel francophone où la colonne
    // prix est déjà à virgule (cf. correctif 4, revue finale) — un point ici ferait
    // lire cette colonne comme du TEXTE pendant que la colonne prix serait lue comme un nombre.
    expect(rows[0][6]).toBe('229,66')
    expect(rows[0][6]).not.toBe(210)
  })

  it('impérial (locale "de") : même séparateur décimal (virgule) que le français — l’allemand utilise aussi la virgule', () => {
    // C'est le cas qui aurait attrapé le défaut d'origine : l'ancien code dérivait le
    // séparateur d'un booléen anglais/pas-anglais, jamais de la locale — un hasard heureux
    // pour l'allemand (qui utilise déjà la virgule), mais qui ne le garantissait pas. Ici on
    // vérifie que c'est bien `locale` qui pilote le choix, pas un booléen figé sur 2 langues.
    const { head, rows } = yarnExportTable([laine], { t, system: 'imperial', currency: 'EUR', locale: 'de' })
    expect(head[6]).toBe(t('settings.export.yarn.lengthYd'))
    expect(head[6]).not.toBe('Longueur (yd)') // pas de repli français figé pour une langue tierce
    expect(rows[0][6]).toBe('229,66')
  })

  it('impérial : la conversion est ARRONDIE, jamais une longue fraction (lisibilité tableur), quelle que soit la locale', () => {
    const fr = yarnExportTable([laine], { t, system: 'imperial', currency: 'EUR', locale: 'fr' }).rows[0][6]
    const en = yarnExportTable([laine], { t, system: 'imperial', currency: 'EUR', locale: 'en' }).rows[0][6]
    // Pas de garde-fou métier ici, juste la lisibilité : au plus 2 décimales — chacune avec
    // SON séparateur (virgule côté fr/de/es, point côté en).
    const [, decimalsFr = ''] = String(fr).split(',')
    const [, decimalsEn = ''] = String(en).split('.')
    expect(decimalsFr.length).toBeLessThanOrEqual(2)
    expect(decimalsEn.length).toBeLessThanOrEqual(2)
  })

  it('une longueur vide reste vide en impérial (jamais perdre d’info, jamais de 0 fabriqué)', () => {
    const sansLongueur = { ...laine, lengthM: '' }
    const { rows } = yarnExportTable([sansLongueur], { t, system: 'imperial', currency: 'EUR', locale: 'fr' })
    expect(rows[0][6]).toBe('')
  })

  it('la colonne de prix porte le symbole de la devise choisie dans son en-tête', () => {
    const eur = yarnExportTable([laine], { t, system: 'metric', currency: 'EUR', locale: 'fr' })
    expect(eur.head[8]).toBe(`${t('settings.export.yarn.price')} (€)`)
    const usd = yarnExportTable([laine], { t, system: 'metric', currency: 'USD', locale: 'fr' })
    expect(usd.head[8]).toBe(`${t('settings.export.yarn.price')} ($)`)
  })

  it('la colonne de prix porte le symbole de la devise choisie dans son en-tête, aussi en locale "en"', () => {
    const gbp = yarnExportTable([laine], { t, system: 'metric', currency: 'GBP', locale: 'en' })
    expect(gbp.head[8]).toBe(`${t('settings.export.yarn.price')} (£)`)
  })

  it('la valeur du prix est IDENTIQUE quelle que soit la devise — aucune conversion', () => {
    const eur = yarnExportTable([laine], { t, system: 'metric', currency: 'EUR', locale: 'fr' })
    const usd = yarnExportTable([laine], { t, system: 'metric', currency: 'USD', locale: 'fr' })
    expect(eur.rows[0][8]).toBe(laine.price)
    expect(usd.rows[0][8]).toBe(laine.price)
    expect(eur.rows[0][8]).toBe(usd.rows[0][8])
  })

  it('sans paramètres (appelant historique) : reste en métrique, séparateur virgule (comportement inchangé)', () => {
    const { head, rows } = yarnExportTable([laine], { t })
    expect(head[6]).toBe(t('settings.export.yarn.lengthM'))
    expect(rows[0][6]).toBe(210)
  })
})

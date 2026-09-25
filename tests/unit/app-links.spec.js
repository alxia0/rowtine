// Adresses du site et du guide en ligne, une par langue de l'interface. Comparées à des
// CHAÎNES LITTÉRALES, jamais à la table réimportée : itérer sur la table testée par elle-même
// ne rougirait pas si une adresse était cassée dans app-links.js.
import { describe, it, expect } from 'vitest'
import { CONTACT_EMAIL, guideUrlFor, websiteUrlFor } from '@/constants/app-links'

// Le site suit la langue de l'APP (une adresse par langue), pas celle du navigateur.
describe('app-links — adresses du site web (une par langue, VÉRIFIÉES 12/08/2026)', () => {
  it('fr → https://rowtine.app/fr/', () => {
    expect(websiteUrlFor('fr')).toBe('https://rowtine.app/fr/')
  })
  it('en → https://rowtine.app/en/', () => {
    expect(websiteUrlFor('en')).toBe('https://rowtine.app/en/')
  })
  it('de → https://rowtine.app/de/', () => {
    expect(websiteUrlFor('de')).toBe('https://rowtine.app/de/')
  })
  it('es → https://rowtine.app/es/', () => {
    expect(websiteUrlFor('es')).toBe('https://rowtine.app/es/')
  })

  // Filet 5e langue future, même doctrine que `guideUrlFor` : repli explicite sur l'anglais.
  it("langue inconnue ('xx') : repli explicite sur l'anglais, jamais une adresse cassée", () => {
    expect(websiteUrlFor('xx')).toBe('https://rowtine.app/en/')
  })
})

describe('app-links — adresses du guide en ligne (une par langue, VÉRIFIÉES 12/08/2026)', () => {
  it('fr → https://rowtine.app/fr/guide/', () => {
    expect(guideUrlFor('fr')).toBe('https://rowtine.app/fr/guide/')
  })
  it('en → https://rowtine.app/en/guide/', () => {
    expect(guideUrlFor('en')).toBe('https://rowtine.app/en/guide/')
  })
  it('de → https://rowtine.app/de/guide/', () => {
    expect(guideUrlFor('de')).toBe('https://rowtine.app/de/guide/')
  })
  it('es → https://rowtine.app/es/guide/', () => {
    expect(guideUrlFor('es')).toBe('https://rowtine.app/es/guide/')
  })

  // Une langue inconnue ne produit JAMAIS une adresse cassée : repli sur l'anglais, même choix
  // que `fallbackLocale` (src/i18n/index.js) et `FALLBACK_ORDER` (src/content/guide/index.js).
  it("langue inconnue ('xx') : repli explicite sur l'anglais, jamais une adresse cassée", () => {
    expect(guideUrlFor('xx')).toBe('https://rowtine.app/en/guide/')
  })
})

// Une adresse mal formée (espace, accolade de gabarit non substituée, virgule à la place du
// point) produirait un lien `mailto:` que le téléphone n'ouvrirait pas, et rien d'autre dans la
// suite ne regarde cette valeur (les vues l'affichent telle quelle).
describe('app-links : adresse de contact', () => {
  it("l'adresse de contact est renseignée et bien formée", () => {
    expect(CONTACT_EMAIL).not.toBe('')
    // Volontairement strict plutôt qu'exhaustif : on ne cherche pas à valider la RFC 5322,
    // seulement à interdire ce qui casserait un `mailto:` (espace, chevrons, virgule) et à
    // exiger un domaine avec extension.
    expect(CONTACT_EMAIL).toMatch(/^[^\s<>,@]+@[^\s<>,@]+\.[a-z]{2,}$/i)
  })
})

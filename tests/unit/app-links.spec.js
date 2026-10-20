// Adresses du site et du guide en ligne, une par langue de l'interface. Comparées à des
// CHAÎNES LITTÉRALES, jamais à la table réimportée : itérer sur la table testée par elle-même
// ne rougirait pas si une adresse était cassée dans app-links.js.
import { describe, it, expect } from 'vitest'
import {
  CONTACT_EMAIL,
  converterUrlFor,
  feedbackUrlFor,
  guideUrlFor,
  websiteUrlFor,
} from '@/constants/app-links'
import { APP_VERSION } from '@/constants/app-info'

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

describe('app-links : adresses du convertisseur du site (une par langue, VÉRIFIÉES 29/09/2026)', () => {
  it('fr → https://rowtine.app/fr/convertisseur/', () => {
    expect(converterUrlFor('fr')).toBe('https://rowtine.app/fr/convertisseur/')
  })
  it('en → https://rowtine.app/en/convertisseur/', () => {
    expect(converterUrlFor('en')).toBe('https://rowtine.app/en/convertisseur/')
  })
  it('de → https://rowtine.app/de/convertisseur/', () => {
    expect(converterUrlFor('de')).toBe('https://rowtine.app/de/convertisseur/')
  })
  it('es → https://rowtine.app/es/convertisseur/', () => {
    expect(converterUrlFor('es')).toBe('https://rowtine.app/es/convertisseur/')
  })
  it("langue inconnue ('xx') : repli explicite sur l'anglais, jamais une adresse cassée", () => {
    expect(converterUrlFor('xx')).toBe('https://rowtine.app/en/convertisseur/')
  })
})

// Adresses du formulaire de retours (chantier retours utilisatrices, 11/10/2026) : contrat
// partagé avec la tâche « site » du même chantier (`source=app`, `version`, `android`
// seulement si fourni). PAS ENCORE vérifiées en ligne, contrairement aux trois groupes
// ci-dessus : la page fait l'objet d'un chantier parallèle sur le site.
describe('app-links — adresses et paramètres du formulaire de retours', () => {
  it('fr → source=app et la version courante, sans paramètre android', () => {
    const url = new URL(feedbackUrlFor('fr'))
    expect(url.origin + url.pathname).toBe('https://rowtine.app/fr/retours/')
    expect(url.searchParams.get('source')).toBe('app')
    expect(url.searchParams.get('version')).toBe(String(APP_VERSION))
    expect(url.searchParams.has('android')).toBe(false)
  })

  it('en/de/es → chemin propre à chaque langue', () => {
    expect(new URL(feedbackUrlFor('en')).pathname).toBe('/en/retours/')
    expect(new URL(feedbackUrlFor('de')).pathname).toBe('/de/retours/')
    expect(new URL(feedbackUrlFor('es')).pathname).toBe('/es/retours/')
  })

  // Même doctrine que les trois groupes d'adresses ci-dessus : une langue inconnue retombe
  // sur l'anglais plutôt que de produire une adresse cassée.
  it("langue inconnue ('xx') : repli explicite sur l'anglais", () => {
    expect(new URL(feedbackUrlFor('xx')).pathname).toBe('/en/retours/')
  })

  it('context.version surcharge la version, context.android est transmis si fourni', () => {
    const url = new URL(feedbackUrlFor('fr', { version: '9.9.9', android: '14' }))
    expect(url.searchParams.get('version')).toBe('9.9.9')
    expect(url.searchParams.get('android')).toBe('14')
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

// Adresses du guide EN LIGNE (celui qui se télécharge, sur le site), une par langue de
// l'interface. VÉRIFIÉES EN LIGNE le 12/08/2026 — les quatre répondent HTTP 200
// avec le bon titre par langue, PDF téléchargeable côté français. ⚠️ `curl` nu reçoit 403
// sur tout le domaine (un pare-feu bloque son agent par
// défaut) : ce n'est pas une preuve de mesure ici, la vérification a été faite avec un agent
// de navigateur.
//
// Les 5 assertions ci-dessous comparent à des CHAÎNES LITTÉRALES, jamais à `GUIDE_URLS`
// réimporté : itérer sur la table testée par elle-même ne rougirait jamais si une seule
// adresse était cassée dans app-links.js — exactement le piège déjà documenté dans ce dépôt
// (AboutView.spec.js, test sur APP_CREATOR : « l'assertion ne peut PAS échouer sur un
// changement de créateur, elle compare l'écran à la constante qu'il affiche »).
import { describe, it, expect } from 'vitest'
import { guideUrlFor, websiteUrlFor } from '@/constants/app-links'

// Adresses du SITE (page d'accueil), une par langue de l'interface — VÉRIFIÉES EN LIGNE
// le 12/08/2026 (HTTP 200, titre propre à chaque langue). Remplace l'ancienne
// `WEBSITE_URL` unique : celle-ci redirigeait selon la langue du NAVIGATEUR (mesuré :
// `Accept-Language: fr` → `/fr/`, `en` → `/en/`), pas celle de l'app.
//
// Mêmes 5 assertions à CHAÎNES LITTÉRALES que le bloc guide ci-dessous, pour la même raison :
// itérer sur `WEBSITE_URLS` réimportée ne rougirait jamais si une seule adresse était cassée.
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

  // Filet 5e langue future (même doctrine que src/content/guide/index.js) : une langue
  // inconnue ne doit JAMAIS produire une adresse cassée. Repli sur l'anglais — même choix que
  // `fallbackLocale` de src/i18n/index.js et le premier maillon de `FALLBACK_ORDER` dans
  // src/content/guide/index.js, pas un 3e choix de repli inventé ici.
  it("langue inconnue ('xx') : repli explicite sur l'anglais, jamais une adresse cassée", () => {
    expect(guideUrlFor('xx')).toBe('https://rowtine.app/en/guide/')
  })
})

// Fabriques communes aux specs qui montent un composant : une instance i18n
// neuve (composition API, français seul) et un router en historique mémoire.
// Une spec qui a besoin d'une autre locale, d'autres messages ou d'un
// historique web garde sa propre construction.
import { expect } from 'vitest'
import { createI18n } from 'vue-i18n'
import { createRouter, createMemoryHistory } from 'vue-router'
import fr from '@/i18n/fr.json'

export function createTestI18n() {
  return createI18n({ legacy: false, locale: 'fr', messages: { fr } })
}

export function createTestRouter(routes) {
  return createRouter({ history: createMemoryHistory(), routes })
}

// Libellé attendu rendu par sa clé, qui doit exister en français et dans la locale active (sinon l'assertion passerait à vide).
export function makeTk(i18n) {
  return (k, ...a) => {
    expect(i18n.global.te(k, 'fr'), `clé absente de fr.json : ${k}`).toBe(true)
    const locale = i18n.global.locale.value
    expect(i18n.global.te(k, locale), `clé absente de la locale ${locale} : ${k}`).toBe(true)
    return i18n.global.t(k, ...a)
  }
}

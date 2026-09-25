// Textes des deux portes d'import (décision du 23/09 : l'import d'un patron au format Rowtine,
// .rowtine ou .zip, est une fonction VISIBLE ; la discrétion du 08/08 est levée). Protège :
// la porte PDF ne parle que de PDF, la porte Rowtine nomme ses deux extensions, les messages
// d'erreur de l'archive valent pour les deux extensions.
import { describe, it, expect } from 'vitest'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'

const LOCALES = { fr, en, de, es }

// Clés rendues par la porte PDF (option de la feuille et écran d'import en mode PDF).
const CLES_PORTE_PDF = ['pattern.importPdf', 'importLocal.title', 'importLocal.lead', 'importLocal.pick']

// Clés rendues par la porte Rowtine.
const CLES_PORTE_ROWTINE = [
  'pattern.importRowtine',
  'importLocal.titleRowtine',
  'importLocal.leadRowtine',
  'importLocal.pickRowtine',
]

function lire(messages, chemin) {
  return chemin.split('.').reduce((o, k) => (o == null ? undefined : o[k]), messages)
}

describe('textes des portes d’import PDF et Rowtine', () => {
  it.each(Object.keys(LOCALES))('la porte PDF ne nomme que le PDF (%s)', (locale) => {
    for (const cle of CLES_PORTE_PDF) {
      const valeur = lire(LOCALES[locale], cle)
      expect(valeur, `${locale}.${cle} est introuvable`).toBeTypeOf('string')
      expect(valeur.toLowerCase(), `${locale}.${cle} : "${valeur}"`).not.toContain('zip')
      expect(valeur.toLowerCase(), `${locale}.${cle} : "${valeur}"`).not.toContain('rowtine')
    }
  })

  it.each(Object.keys(LOCALES))('la porte Rowtine a tous ses textes et les nomme (%s)', (locale) => {
    for (const cle of CLES_PORTE_ROWTINE) {
      const valeur = lire(LOCALES[locale], cle)
      expect(valeur, `${locale}.${cle} est introuvable`).toBeTypeOf('string')
      expect(valeur.toLowerCase()).toContain('rowtine')
    }
  })

  it.each(Object.keys(LOCALES))('le bouton de choix nomme les deux extensions acceptées (%s)', (locale) => {
    const s = lire(LOCALES[locale], 'importLocal.pickRowtine')
    expect(s).toContain('.rowtine')
    expect(s).toContain('.zip')
  })

  it.each(Object.keys(LOCALES))('les erreurs de l’archive valent pour .rowtine comme pour .zip (%s)', (locale) => {
    const noMd = lire(LOCALES[locale], 'importZip.noMd')
    const badZip = lire(LOCALES[locale], 'importZip.badZip')
    expect(noMd).toBeTypeOf('string')
    // « Ce zip ... » serait faux pour un fichier .rowtine.
    expect(noMd.toLowerCase()).not.toContain('zip')
    expect(badZip).toContain('.rowtine')
    expect(badZip).toContain('.zip')
    expect(lire(LOCALES[locale], 'importZip.failed')).toBeTypeOf('string')
    expect(lire(LOCALES[locale], 'importZip.phase.read')).toBeTypeOf('string')
    expect(lire(LOCALES[locale], 'importZip.phase.images')).toBeTypeOf('string')
    expect(lire(LOCALES[locale], 'importZip.phase.done')).toBeTypeOf('string')
    expect(lire(LOCALES[locale], 'warnings.zip.missingImage')).toBeTypeOf('string')
  })

  it.each(Object.keys(LOCALES))('le message « PDF scanné » propose le contact, adresse interpolée (%s)', (locale) => {
    const s = lire(LOCALES[locale], 'importLocal.scanned')
    expect(s).toBeTypeOf('string')
    // L'adresse n'est PAS recopiée dans la traduction : elle est interpolée depuis la
    // constante unique du code (src/constants/app-links.js).
    expect(s).toContain('{email}')
    expect(s).not.toContain('@')
  })
})

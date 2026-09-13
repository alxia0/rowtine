// GARDE DE DISCRÉTION (08/08) — la fonction d'import .zip est devenue une porte de service :
// elle marche, mais l'interface ne doit la nommer NULLE PART. Ancré sur les clés
// EFFECTIVEMENT RENDUES par la feuille d'ajout et par l'écran d'import, pas sur une
// recherche libre dans le JSON : « la chaîne n'est plus dans le fichier » ne prouve pas
// qu'elle a cessé d'être affichée, et réciproquement (leçon du lot « guide à jour »).
import { describe, it, expect } from 'vitest'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'

const LOCALES = { fr, en, de, es }

// Les clés que la feuille « Ajouter un patron » et l'écran d'import affichent réellement.
// Ronde de correction 1 (08/08) : la liste initiale n'en couvrait que 9, en oubliant 7 clés
// bel et bien rendues par LocalPdfImportView.vue (snackbar de sauvegarde, bloc « import
// risqué » et son bouton, bouton d'interruption) — trou laissé par le plan, comblé ici pour
// tenir l'intention explicite de la garde : s'ancrer sur les clés EFFECTIVEMENT RENDUES.
const CLES_AFFICHEES = [
  'pattern.add',
  'pattern.importPdf',
  'pattern.addManual',
  'importLocal.title',
  'importLocal.lead',
  'importLocal.leadNext',
  'importLocal.pick',
  'importLocal.scanned',
  'importLocal.saved',
  'importLocal.doneTitle',
  'importLocal.viewPattern',
  'importLocal.blockTitle',
  'importLocal.blockColumns',
  'importLocal.blockMultiPattern',
  'importLocal.blockLead',
  'importLocal.importAnyway',
  'importLocal.cancelImport',
]

function lire(messages, chemin) {
  return chemin.split('.').reduce((o, k) => (o == null ? undefined : o[k]), messages)
}

describe('l’interface ne nomme jamais le zip', () => {
  it.each(Object.keys(LOCALES))('aucune clé affichée ne contient « zip » — %s', (locale) => {
    for (const cle of CLES_AFFICHEES) {
      const valeur = lire(LOCALES[locale], cle)
      // Garde de la garde : une clé absente rendrait l'assertion vacueuse.
      expect(valeur, `${locale}.${cle} est introuvable`).toBeTypeOf('string')
      expect(valeur.toLowerCase(), `${locale}.${cle} nomme le zip : "${valeur}"`).not.toContain('zip')
    }
  })

  it.each(Object.keys(LOCALES))('la clé du choix « .zip » de la feuille a disparu — %s', (locale) => {
    expect(lire(LOCALES[locale], 'pattern.importZip')).toBeUndefined()
  })

  it.each(Object.keys(LOCALES))('l’écran .zip n’a plus ni titre ni accroche ni bouton — %s', (locale) => {
    expect(lire(LOCALES[locale], 'importZip.title')).toBeUndefined()
    expect(lire(LOCALES[locale], 'importZip.lead')).toBeUndefined()
    expect(lire(LOCALES[locale], 'importZip.pick')).toBeUndefined()
    expect(lire(LOCALES[locale], 'importZip.saved')).toBeUndefined()
  })

  it.each(Object.keys(LOCALES))('les messages d’erreur du zip, eux, RESTENT — %s', (locale) => {
    // Ils ne s'affichent qu'à qui a réellement fourni un zip : c'est là que l'information
    // précise vaut quelque chose (dépannage). Ne pas les « nettoyer ».
    expect(lire(LOCALES[locale], 'importZip.noMd')).toBeTypeOf('string')
    expect(lire(LOCALES[locale], 'importZip.badZip')).toBeTypeOf('string')
    expect(lire(LOCALES[locale], 'importZip.failed')).toBeTypeOf('string')
    expect(lire(LOCALES[locale], 'importZip.phase.read')).toBeTypeOf('string')
    // Ronde de correction 1 (08/08) : le contrôle de parité ne vérifie que la symétrie
    // ENTRE langues, pas la présence — un retrait accidentel et symétrique de ces
    // sous-clés dans les 4 langues à la fois lui échapperait. Il faut donc aussi les
    // vérifier ici.
    expect(lire(LOCALES[locale], 'importZip.phase.images')).toBeTypeOf('string')
    expect(lire(LOCALES[locale], 'importZip.phase.done')).toBeTypeOf('string')
    expect(lire(LOCALES[locale], 'warnings.zip.missingImage')).toBeTypeOf('string')
  })

  it.each(Object.keys(LOCALES))('le message « PDF scanné » n’aiguille plus vers le zip et propose le contact — %s', (locale) => {
    const s = lire(LOCALES[locale], 'importLocal.scanned')
    expect(s).toBeTypeOf('string')
    expect(s.toLowerCase()).not.toContain('zip')
    // L'adresse n'est PAS recopiée dans la traduction : elle est interpolée depuis la
    // constante unique du code (src/constants/app-links.js).
    expect(s).toContain('{email}')
    expect(s).not.toContain('@')
  })
})

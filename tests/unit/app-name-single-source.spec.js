// Le nom de l'app n'est jamais écrit en clair dans les clés `about.*`/`nav.about`, les
// contenus longs (`src/content`), le guide (source et généré) ni dans AUCUNE vue ou composant.
// Le dossier entier est balayé : une liste de fichiers à surveiller exige qu'on pense à
// l'étendre. Le reste d'i18n n'est pas balayé (occurrences antérieures, hors périmètre).
// Le nom est lu DYNAMIQUEMENT depuis fr.json (`app.name`).
//
// Aucun commentaire de src/ ne doit nommer l'app non plus (StitchProgress.vue dit « Signature
// de l'app ») : ne pas y « corriger » un nom en dur, c'est voulu.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fr from '@/i18n/fr.json'
import en from '@/i18n/en.json'
import de from '@/i18n/de.json'
import es from '@/i18n/es.json'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const APP_NAME = fr.app.name
// Le nom comme MOT : un identifiant qui le contient (clé `pattern.importRowtine`, variable
// `isRowtine`, porte d'import au format de l'app du 23/09) n'est pas un nom affiché en clair.
const NAME_AS_WORD = new RegExp(`\\b${APP_NAME}\\b`)

function flatten(obj, prefix = '') {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') Object.assign(out, flatten(v, p))
    else out[p] = v
  }
  return out
}

const LOCALES = { fr, en, de, es }

describe('nom de l’app : jamais en dur dans les clés ajoutées par ce lot (about.*, nav.about)', () => {
  it.each(Object.keys(LOCALES))('aucune clé about.*/nav.about ne porte le nom en clair — %s', (locale) => {
    const messages = LOCALES[locale]
    const flat = { ...flatten(messages.about, 'about'), 'nav.about': messages.nav.about }
    expect(Object.keys(flat).length).toBeGreaterThan(0)
    for (const [key, value] of Object.entries(flat)) {
      if (typeof value !== 'string') continue
      expect(value, `${locale}.${key} contient le nom de l'app en dur : "${value}"`).not.toContain(APP_NAME)
    }
  })

  it('aucun fichier de contenu long (src/content/*.js) ne porte le nom en clair', () => {
    const dir = path.resolve(ROOT, 'src/content')
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), 'utf-8')
      expect(source, `${file} contient le nom de l'app en dur`).not.toContain(APP_NAME)
    }
  })

  // Listes d'exception vides : la garde couvre toutes les vues et tous les composants.
  // Les commentaires qui nommaient l'app ou le dossier ont été reformulés sans nom.
  const PRE_EXISTING_VIEWS_WITH_NAME = []
  const PRE_EXISTING_COMPONENTS_WITH_NAME = []

  it('toute vue NOUVELLE (hors exceptions pré-existantes) ne porte pas le nom en clair', () => {
    const dir = path.resolve(ROOT, 'src/views')
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.vue'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      if (PRE_EXISTING_VIEWS_WITH_NAME.includes(file)) continue
      const source = fs.readFileSync(path.join(dir, file), 'utf-8')
      // Le nom du FORMAT de fichier (`${APP_NAME}-MD`, ex. Rowtine-MD) contient le nom de
      // l'app comme sous-chaîne : on le retire avant de chercher le nom de l'app seul.
      const withoutFormatName = source.replaceAll(`${APP_NAME}-MD`, '')
      expect(withoutFormatName, `${file} contient le nom de l'app en dur`).not.toMatch(NAME_AS_WORD)
    }
  })

  // Les composants aussi : GuideSpans.vue rend du texte de contenu long, et une garde limitée
  // aux vues laissait passer un nom en dur ajouté là.

  it('tout composant NOUVEAU (hors exceptions pré-existantes) ne porte pas le nom en clair', () => {
    const dir = path.resolve(ROOT, 'src/components')
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.vue'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      if (PRE_EXISTING_COMPONENTS_WITH_NAME.includes(file)) continue
      const source = fs.readFileSync(path.join(dir, file), 'utf-8')
      // Même précaution que pour les vues : le nom du format (`${APP_NAME}-MD`) contient le
      // nom de l'app comme sous-chaîne, on le retire avant de tester le nom de l'app seul.
      const withoutFormatName = source.replaceAll(`${APP_NAME}-MD`, '')
      expect(withoutFormatName, `${file} contient le nom de l'app en dur`).not.toMatch(NAME_AS_WORD)
    }
  })

  // Le Markdown source du guide et le contenu généré portent le marqueur `{app}`, substitué à
  // l'affichage par GuideView.vue, jamais le nom en clair.
  it('aucun guide Markdown source ne porte le nom en clair', () => {
    const dir = path.resolve(ROOT, 'src/content/guide')
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), 'utf-8')
      expect(source, `${file} contient le nom de l'app en dur`).not.toContain(APP_NAME)
    }
  })

  it('aucun contenu de guide généré ne porte le nom en clair', () => {
    const dir = path.resolve(ROOT, 'src/generated')
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('guide-content.') && f.endsWith('.json'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), 'utf-8')
      expect(source, `${file} contient le nom de l'app en dur`).not.toContain(APP_NAME)
    }
  })
})

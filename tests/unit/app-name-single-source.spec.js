// Le nom de l'app n'est PAS définitif (120 occurrences déjà en dur ailleurs dans src/,
// PRÉ-EXISTANTES, un renommage est un chantier à part — piège n°6, lot 1 :
// « n'en ajoute pas une de plus », pas « corrige les 120 existantes »). Ce test
// balaie ce que ce lot a introduit (clés `about.*`/`nav.about`, fichiers de contenu
// `src/content/*.js`) ET **toutes** les vues (`src/views/*.vue`) — une revue a relevé que la
// première version de ce lot avait écrit le nom en clair à 18 endroits malgré un test qui ne
// couvrait qu'AboutView.vue seul (la même classe de défaut que « test qui ne teste rien »,
// cf. mémoire du projet).
//
// 2e revue : une liste `NEW_VIEWS` figée à la main avait remplacé le grep à 1 fichier — mieux,
// mais toujours une garde qui exige qu'un humain pense à l'étendre (le commentaire l'admettait
// lui-même : « DOIT s'étendre si le lot 2 en ajoute »). Corrigé : on balaie maintenant TOUTES
// les vues du dossier, moins une liste FIGÉE des exceptions PRÉ-EXISTANTES (mesurée le 02/08 :
// 3 vues sur 20 portent déjà le nom — CorrectionView, SettingsView, ZipImportView, toutes
// antérieures à ce lot, hors périmètre). Toute vue nouvelle (lot 2 compris) est donc gardée
// PAR DÉFAUT, sans qu'on ait à s'en souvenir.
// (ZipImportView.vue a été supprimée le 08/08/2026 : son écran a disparu de l'interface,
// fondu en porte de service dans l'import PDF — cf. lot « import .zip, porte de service ».)
//
// Balayer tout i18n ferait remonter à tort les 120 occurrences pré-existantes (ex.
// `onboarding.welcome` = "Bienvenue sur Tricoche", antérieure à ce lot) — ce n'est pas le
// périmètre de la garde i18n ci-dessous, qui reste limitée à `about.*`/`nav.about`.
//
// Le nom lui-même est lu DYNAMIQUEMENT depuis fr.json (`app.name`) plutôt qu'écrit
// "Tricoche" dans ce fichier.
//
// ⚠️ Ce fichier a été rattrapé lors du renommage Tricoche → Rowtine (03/08/2026). Son
// commentaire d'origine affirmait qu'il « reste valide sans qu'on ait à y retoucher » si
// l'app était renommée : c'était FAUX. Lire le nom dynamiquement depuis fr.json rendait
// bien les balayages corrects, mais les deux gardes « les exceptions portent encore le
// nom » comparaient les fichiers au NOUVEAU nom et sont devenues rouges le jour venu.
//
// Second piège découvert au même renommage : le nom du FORMAT de fichier vaut
// `${APP_NAME}-MD` (ex. Rowtine-MD) et contient donc le nom de l'app comme sous-chaîne.
// Vider les listes d'exception a fait remonter ce nom légitime du format comme un faux
// positif du nom de l'app en dur. Les deux gardes « toute vue/composant NOUVEAU » retirent
// donc `${APP_NAME}-MD` du texte avant de chercher le nom de l'app seul.
//
// Troisième piège, même renommage : StitchProgress.vue nommait vraiment l'app dans un
// commentaire (« Signature de Tricoche »). La mettre à jour vers le nouveau nom
// (« Signature de Rowtine ») aurait re-fait échouer la garde une fois la liste vidée : le
// commentaire a donc été reformulé (« Signature de l'app ») pour ne plus citer AUCUN nom.
// Ne pas y « corriger » un nom d'app en dur si l'app est un jour re-renommée : c'est voulu.
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

  // Renommage Rowtine (03/08/2026) : les deux listes d'exception PRÉ-EXISTANTES ont été
  // vidées. Les 6 fichiers concernés ne portaient l'ancien nom que dans des commentaires :
  // 5 des 7 occurrences étaient `Rowtine-MD`, le nom du FORMAT (pas celui de l'app) ; 1
  // nommait vraiment l'app (StitchProgress.vue) ; la 7e (SettingsView.vue:274, « Dossier
  // Tricoche (SAF) ») parlait du DOSSIER, alors gelé à un nom différent de celui de l'app.
  //
  // Le 04/08/2026, ce gel a été levé : le dossier s'appelle désormais LE MÊME
  // MOT que l'app (« Rowtine »). Ce commentaire de SettingsView.vue ne pouvait donc plus
  // nommer le dossier en clair sans re-déclencher cette garde (comme StitchProgress.vue
  // avant lui) : il a été reformulé (« Dossier de sauvegarde (SAF) ») pour ne plus citer
  // aucun nom, plutôt que rallongé une liste d'exceptions. La garde couvre donc maintenant
  // TOUTES les vues et TOUS les composants, sans exception — ce que son commentaire
  // d'entête visait depuis le début.
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
      // l'app comme sous-chaîne : on le retire avant de chercher le nom de l'app tout seul,
      // sinon un commentaire qui cite légitimement le format ferait échouer la garde.
      const withoutFormatName = source.replaceAll(`${APP_NAME}-MD`, '')
      expect(withoutFormatName, `${file} contient le nom de l'app en dur`).not.toContain(APP_NAME)
    }
  })

  // Revue (02/08) : la garde ci-dessus balaie les vues, mais pas
  // `src/components/*.vue` — angle mort prouvé par mutation (nom en dur ajouté dans
  // GuideSpans.vue, 9 tests sur 9 restaient verts). Ce chantier a introduit deux composants
  // qui rendent du texte de contenu long (GuideSpans.vue, consommé par GuideView.vue ET
  // GuideListItem.vue) : exactement la classe de trou déjà mesurée une fois sur les vues (18
  // occurrences échappées, cf. commentaire de tête de ce fichier). Même remède : balayage de
  // TOUT le dossier composants (liste d'exceptions ci-dessus, vidée par le renommage Rowtine).

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
      expect(withoutFormatName, `${file} contient le nom de l'app en dur`).not.toContain(APP_NAME)
    }
  })

  // Lot 2 (guide utilisateur) : le Markdown source (src/content/guide/*.md) et le contenu
  // généré qui en découle (src/generated/guide-content.*.json) portent le marqueur `{app}`,
  // pas le nom en clair — même mécanisme que privacy-policy.fr.js (withAppName, substitué à
  // l'affichage par GuideView.vue). Ce test n'existait pas encore pour ce dossier au moment
  // du 1er passage (src/content/guide n'était pas dans le périmètre de la garde ci-dessus,
  // qui ne balaie que *.js à la racine de src/content) : ajouté ici pour ne pas répéter
  // l'angle mort déjà documenté plus haut (18 occurrences échappées à une garde trop
  // étroite).
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

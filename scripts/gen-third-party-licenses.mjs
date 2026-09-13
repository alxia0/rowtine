// Génère `src/generated/third-party-licenses.json` depuis les dépendances de PRODUCTION
// réellement installées (node_modules), via `license-checker-rseidelsohn` — outil de
// DÉVELOPPEMENT uniquement (jamais embarqué dans l'app). Tâche 1.5, lot 1 du plan
// « écran À propos ».
//
// Pourquoi générer plutôt qu'écrire à la main : Vue, Dexie, pdf.js, Capacitor… sont sous
// licence MIT/Apache/BSD, qui EXIGENT la reproduction de leur mention. Une liste tapée à la
// main se périmerait dès la prochaine dépendance ajoutée ou mise à jour — personne n'y
// repenserait.
//
// Deux modes (revue du 02/08 : le mode écriture seul, lancé automatiquement avant CHAQUE
// `yarn build`, réécrirait EN SILENCE un fichier suivi par git dès qu'une dépendance changerait
// — piège identique à celui déjà documenté pour `yarn lint`, particulièrement dangereux ici
// puisqu'une autre session travaille sur ce dépôt en parallèle) :
//   - écriture (défaut, `yarn licenses:gen`) : régénère et écrit le fichier pour de vrai —
//     étape EXPLICITE, à relire et committer soi-même ;
//   - vérification (`--check`, hook `prebuild` de package.json) : régénère EN MÉMOIRE et
//     compare au fichier committé ; identique → ne touche à rien, sort en 0 ; différent →
//     fait ÉCHOUER le build avec un message clair, plutôt que d'écraser silencieusement.
//
// `production: true` exclut les devDependencies déclarées à la racine (vite, vitest,
// eslint, oxlint, playwright, prettier…) et ne garde que ce qu'une installation de
// production embarquerait. C'est volontairement SUR-inclusif par rapport à ce que Rollup
// finit réellement par empaqueter dans `dist/` (l'arbre npm ≠ le graphe d'imports bundlé,
// mesuré le 02/08 : 211 paquets listés pour une poignée de bibliothèques utilisées) — pour
// une obligation de licence, sur-lister est sans risque, sous-lister ne l'est pas. `vite`
// notamment y figure via une dépendance transitive de `vue-router` (23 % du fichier) : cf.
// tests/unit/ThirdPartyLicensesView.spec.js pour le détail assumé de ce cas précis.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHECK_ONLY = process.argv.includes('--check')

const require = createRequire(import.meta.url)
// CJS sans export ESM par défaut : passer par `createRequire` plutôt qu'un `import` direct
// (mesuré le 02/08 : `import checker from '...'` échoue avec
// "does not provide an export named 'default'").
const checker = require('license-checker-rseidelsohn')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_PATH = path.resolve(ROOT, 'src/generated/third-party-licenses.json')

// ── Les polices, que `license-checker` ne peut PAS voir ────────────────────────────────────
// Constaté le 17/08/2026 : l'app EMBARQUE ses `.woff2`, donc elle les REDISTRIBUE, et la SIL
// Open Font License exige que l'avis de droit d'auteur et le texte de la licence accompagnent
// tout fichier redistribué. Or ni `NOTICE`, ni `LICENSE`, ni cet écran ne les mentionnaient.
//
// Le trou est STRUCTUREL, pas un oubli : ce script interroge `node_modules` avec
// `production: true`, alors que les polices sont posées à la main dans `public/fonts/` et
// n'apparaissent nulle part dans `package.json`. Aucune régénération n'aurait pu les trouver.
// ⚠️ Le manquement PRÉEXISTAIT au changement de couple typographique du 17/08 (il valait pour
// Fraunces et DM Sans) et vaudrait pour n'importe quelle police libre mise à leur place.
//
// Le texte est LU depuis les fichiers réellement embarqués, jamais recopié ici : un texte
// recopié se périmerait en silence le jour où la police change, et c'est précisément le genre
// de silence que cet écran doit éviter.
const FONTS_DIR = path.resolve(ROOT, 'public/fonts')
const POLICES = [
  {
    name: 'Literata',
    version: '3.103',
    license: 'OFL-1.1',
    repository: 'https://github.com/googlefonts/literata',
    publisher: 'The Literata Project Authors',
    licenseFile: 'OFL-Literata.txt',
  },
  {
    name: 'Source Sans 3',
    version: '3.052',
    license: 'OFL-1.1',
    repository: 'https://github.com/adobe-fonts/source-sans',
    publisher: 'Adobe',
    licenseFile: 'OFL-SourceSans3.txt',
  },
]

function policesEmbarquees() {
  return POLICES.map(({ licenseFile, ...reste }) => {
    const chemin = path.join(FONTS_DIR, licenseFile)
    if (!fs.existsSync(chemin)) {
      // Échouer bruyamment plutôt qu'écrire une entrée vide : une obligation de licence non
      // tenue ne doit pas pouvoir se glisser dans un build.
      console.error(
        `Texte de licence introuvable : public/fonts/${licenseFile}. La police « ${reste.name} » ` +
          "est embarquée par l'app, sa licence OFL DOIT l'accompagner.",
      )
      process.exit(1)
    }
    return { ...reste, licenseText: fs.readFileSync(chemin, 'utf-8').trim() }
  })
}

checker.init(
  {
    start: ROOT,
    production: true,
    excludePrivatePackages: true, // exclut "rowtine" lui-même (paquet racine, non publié)
    customFormat: {
      name: '',
      version: '',
      licenses: '',
      repository: '',
      publisher: '',
      licenseText: '',
    },
  },
  (err, packages) => {
    if (err) {
      console.error('Échec de la génération des licences tierces :', err)
      process.exit(1)
    }

    const list = Object.entries(packages)
      .map(([key, info]) => {
        const at = key.lastIndexOf('@')
        const name = info.name || key.slice(0, at)
        const version = info.version || key.slice(at + 1)
        const licenses = info.licenses || 'inconnue'
        const hasText = info.licenseText && info.licenseText.trim()
        return {
          name,
          version,
          license: licenses,
          repository: info.repository || '',
          publisher: info.publisher || '',
          // Repli explicite : rare (1 paquet sur 211 mesuré le 02/08 — @vue/devtools-api,
          // sans fichier LICENSE dans son propre paquet publié), mais on ne veut JAMAIS
          // qu'une absence de fichier côté dépendance produise un bloc vide et silencieux
          // à l'écran — l'obligation de citer la licence reste remplie via le nom SPDX et
          // le dépôt, à défaut du texte intégral.
          licenseText: hasText
            ? info.licenseText.trim()
            : `Texte de licence non fourni par ce paquet. Licence déclarée : ${licenses}.` +
              (info.repository ? ` Voir ${info.repository}.` : ''),
        }
      })
      .concat(policesEmbarquees())
      .sort((a, b) => a.name.localeCompare(b.name))

    const content = JSON.stringify(list, null, 2) + '\n'
    const relOut = path.relative(ROOT, OUT_PATH)

    if (CHECK_ONLY) {
      const current = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf-8') : null
      if (current === content) {
        console.log(
          `licences tierces à jour (${list.length} entrées : paquets npm + polices embarquées) ` +
            `— ${relOut} inchangé.`,
        )
        return
      }
      console.error(
        `${relOut} est PÉRIMÉ par rapport aux dépendances réellement installées ` +
          `et aux polices embarquées (${list.length} entrées attendues). ` +
          `Lance \`yarn licenses:gen\`, relis le diff, ` +
          `puis committe le fichier régénéré — le build ne le réécrit plus tout seul ` +
          `(cf. commentaire d'en-tête de ce script).`,
      )
      process.exit(1)
    }

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
    fs.writeFileSync(OUT_PATH, content, 'utf-8')
    console.log(`${list.length} licences tierces écrites dans ${relOut}`)
  },
)

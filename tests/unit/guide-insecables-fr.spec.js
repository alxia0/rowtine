// Gardes typographiques du guide utilisateur FRANÇAIS (travaux de finitions du guide).
//
// Le français veut une espace INSÉCABLE avant `: ; ? ! %`, après `«` et avant `»`, pour qu'un
// retour à la ligne ne sépare jamais le signe du mot qu'il accompagne. `src/content/guide/fr.md`
// n'en contenait AUCUNE avant le 11/08 (mesuré : 0 occurrence de U+00A0) ; 287 y ont été posées.
// Ces trois gardes existent pour que la dérive ne revienne pas au premier ajout de texte —
// l'anglais, l'allemand et l'espagnol, eux, ne veulent PAS de ces espaces : seul `fr.md` est
// concerné par G1 et G3.
//
// ⚠️ ATTENDU au prochain ajout de prose française dans `fr.md` : G3 rougira sur le texte neuf
// tant qu'il n'aura pas reçu ses insécables. C'est son rôle, pas une régression.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIR = path.resolve(__dirname, '../..', 'src/content/guide')

const INSECABLE = ' ' // espace insécable NORMALE — la seule autorisée dans ce guide
const INSECABLE_FINE = ' ' // espace insécable FINE — INTERDITE (cf. G2)

// Les quatre langues sont nommées EXPRÈS, pas découvertes par `readdirSync` seul : une garde
// qui balaie un dossier passe en silence quand un fichier disparaît, et G2 doit précisément
// couvrir les quatre. Le balayage sert ensuite à vérifier que le dossier n'en contient pas un
// cinquième qui échapperait à la garde.
const LANGUES = ['de.md', 'en.md', 'es.md', 'fr.md']

function lire(fichier) {
  return fs.readFileSync(path.join(SRC_DIR, fichier), 'utf-8')
}

describe('insécables du guide français', () => {
  it('les quatre fichiers de langue attendus sont bien là, et eux seuls', () => {
    const trouves = fs
      .readdirSync(SRC_DIR)
      .filter((f) => f.endsWith('.md'))
      .sort()
    expect(
      trouves,
      `le dossier ${SRC_DIR} ne porte plus exactement les quatre langues attendues — ` +
        'une langue ajoutée doit être ajoutée à LANGUES pour que G2 la couvre'
    ).toEqual(LANGUES)
  })

  // La PRÉMISSE des gardes G1 et G2, prouvée plutôt que supposée : le parseur du guide
  // (`parse-guide-markdown.js`) fait `.trim()` sur chaque ligne, et `String.trim()` supprime
  // les DEUX insécables. Une insécable en bord de ligne serait donc perdue en silence, et la
  // ponctuation se retrouverait collée au mot SANS AUCUNE espace. Si cette assertion venait à
  // échouer un jour (changement de moteur JS), les deux gardes suivantes n'auraient plus de
  // raison d'être sous cette forme.
  it('prémisse mesurée : String.trim() supprime les insécables', () => {
    expect(`mot${INSECABLE}`.trim()).toBe('mot')
    expect(`${INSECABLE}mot`.trim()).toBe('mot')
    expect(`mot${INSECABLE_FINE}`.trim()).toBe('mot')
  })

  // ── G1 ──────────────────────────────────────────────────────────────────────────────────
  // Aucune insécable de `fr.md` ne doit toucher un bord de ligne : elle serait mangée par le
  // `.trim()` du parseur. Le guide est replié à ~95 colonnes, donc le cas se présente dès
  // qu'un `mot :` tombe en fin de ligne — il faut alors reporter le mot ET le signe ensemble
  // sur la ligne suivante.
  describe('G1 — aucune insécable en bord de ligne', () => {
    const lignes = lire('fr.md').split('\n')

    it('aucune ligne de fr.md ne FINIT par une insécable', () => {
      const fautives = lignes
        .map((l, i) => ({ numero: i + 1, ligne: l }))
        .filter(({ ligne }) => ligne.endsWith(INSECABLE))
        .map(({ numero, ligne }) => `ligne ${numero} : …${ligne.slice(-40)}`)
      expect(
        fautives,
        "fr.md : insécable en FIN de ligne — le .trim() du parseur l'efface, la ponctuation " +
          'de la ligne suivante se retrouverait collée sans espace. Reporter le mot ET le signe ' +
          'ensemble sur la ligne suivante.'
      ).toEqual([])
    })

    it('aucune ligne de fr.md ne COMMENCE par une insécable', () => {
      const fautives = lignes
        .map((l, i) => ({ numero: i + 1, ligne: l }))
        .filter(({ ligne }) => ligne.startsWith(INSECABLE))
        .map(({ numero, ligne }) => `ligne ${numero} : ${ligne.slice(0, 40)}…`)
      expect(
        fautives,
        "fr.md : insécable en DÉBUT de ligne — même perte silencieuse qu'en fin de ligne " +
          '(le .trim() du parseur retire les deux bords).'
      ).toEqual([])
    })

    // Même famille de défaut, vue d'un autre côté : le parseur recolle une ligne de
    // continuation à la précédente avec une espace ORDINAIRE (`text += ' ' + lines[j].trim()`).
    // Un `«` en fin de ligne, ou une ponctuation en début de ligne, produit donc du texte
    // rendu avec une espace sécable — invisible dans le Markdown, bien réelle à l'écran.
    // ⚠️ `![…](…)` est de la syntaxe d'image Markdown, pas un `!` de ponctuation : exclu.
    it('aucun bord de ligne de fr.md ne sépare un signe de son mot', () => {
      const fautives = []
      for (let i = 0; i < lignes.length - 1; i++) {
        const courante = lignes[i]
        const suivante = lignes[i + 1]
        if (courante.trim() === '' || suivante.trim() === '') continue
        if (courante.trimEnd().endsWith('«')) {
          fautives.push(`ligne ${i + 1} finit par « : …${courante.slice(-40)}`)
        }
        const debutSuivante = suivante.trimStart()
        if (debutSuivante.startsWith('![')) continue // syntaxe d'image Markdown
        if (/^[:;?!%»]/.test(debutSuivante)) {
          fautives.push(`ligne ${i + 2} commence par une ponctuation : ${debutSuivante.slice(0, 40)}…`)
        }
      }
      expect(
        fautives,
        'fr.md : un bord de ligne sépare une ponctuation de son mot — le parseur les recollera ' +
          'avec une espace SÉCABLE. Ramener le mot et le signe sur la même ligne, avec une insécable.'
      ).toEqual([])
    })
  })

  // ── G2 ──────────────────────────────────────────────────────────────────────────────────
  // 🔴 Mesuré au fontTools le 11/08 sur les trois `.woff2` d'alors (DM Sans, DM Sans italique,
  // Fraunces), puis RE-MESURÉ le 17/08 sur les trois qui les ont remplacées : U+202F (espace
  // insécable FINE) est ABSENTE de Literata, Source Sans 3 et Source Sans 3 italique, alors que
  // U+00A0 y est présente. Le changement de couple typographique n'a donc rien changé à cette
  // garde — c'est bien le motif ORIGINAL qui la maintient, pas une inertie.
  // La typographie française « soignée » recommande pourtant la fine avant `; : ? !` —
  // c'est exactement pour ça que cette garde couvre les QUATRE langues et pas seulement le
  // français : quelqu'un voudra « faire mieux » un jour. Dans une app HORS LIGNE, qui ne peut
  // télécharger aucune police de secours, la fine tomberait en glyphe de repli : au mieux
  // l'espace d'une autre police, au pire un rectangle vide.
  describe('G2 — la fine insécable U+202F est interdite dans les quatre langues', () => {
    it.each(LANGUES)('%s ne contient aucune U+202F', (fichier) => {
      const contenu = lire(fichier)
      const positions = []
      for (const [i, ligne] of contenu.split('\n').entries()) {
        if (ligne.includes(INSECABLE_FINE)) positions.push(`ligne ${i + 1} : ${ligne.trim().slice(0, 60)}`)
      }
      expect(
        positions,
        `${fichier} contient l'espace fine insécable U+202F, ABSENTE des trois polices de l'app ` +
          "(Literata, Source Sans 3, Source Sans 3 italique) : elle sortirait en glyphe de repli " +
          "sur l'appareil. Employer U+00A0 (insécable normale) à la place."
      ).toEqual([])
    })
  })

  // ── G3 ──────────────────────────────────────────────────────────────────────────────────
  // Le pendant positif de G1/G2 : plus aucune espace ORDINAIRE (U+0020) ne doit précéder
  // `: ; ? ! %` ni encadrer les guillemets français dans `fr.md`.
  //
  // ┌ EXCEPTIONS ─────────────────────────────────────────────────────────────────────────┐
  // │ Trois formes où une espace ORDINAIRE devant l'un de ces signes ne serait PAS une     │
  // │ faute de typographie française. Elles sont écrites ici EN CLAIR, et non cachées dans │
  // │ une expression régulière : la prochaine personne doit pouvoir les relire et les      │
  // │ juger.                                                                               │
  // │                                                                                      │
  // │  1. Ligne d'alignement d'un tableau Markdown — `| :--- | ---: |` : ces `:` sont de   │
  // │     la syntaxe, pas de la ponctuation.                                               │
  // │  2. Extrait de code entre accents graves — `` `max-width: 320px` ``,                 │
  // │     `` `data:image/webp;base64,…` `` : du code cité, où la typo française ne         │
  // │     s'applique pas.                                                                  │
  // │  3. Cible d'une image ou d'un lien Markdown — `](images/fr/x.webp)`,                 │
  // │     `](https://…)` : le `:` d'un schéma d'URL n'est pas de la ponctuation.           │
  // │                                                                                      │
  // │ ⚠️ MESURÉ le 11/08 : AUCUNE de ces trois formes n'apparaît dans `fr.md` aujourd'hui  │
  // │ — 0 `:` qui ne soit pas précédé d'une espace, un seul séparateur de tableau          │
  // │ (`|---|---|`, sans `:`), aucun accent grave devant l'un de ces signes. La liste       │
  // │ ci-dessous est donc VIDE, et c'est la vérité du fichier, pas un oubli.               │
  // │                                                                                      │
  // │ ⇒ Pour ajouter une exception : coller ici l'extrait exact que le test affiche, avec  │
  // │ un commentaire disant POURQUOI ce n'est pas de la ponctuation française. Pas de      │
  // │ motif générique : une exception large avalerait une vraie faute.                     │
  // └──────────────────────────────────────────────────────────────────────────────────────┘
  const EXCEPTIONS_ATTENDUES = []

  describe('G3 — plus aucune espace ordinaire avant la ponctuation de fr.md', () => {
    // Un motif par règle, nommé : le message d'échec dit laquelle a mordu.
    const REGLES = [
      { nom: 'espace avant « : »', motif: / :/g },
      { nom: 'espace avant « ; »', motif: / ;/g },
      { nom: 'espace avant « ? »', motif: / \?/g },
      // ⚠️ `![…](…)` est de la syntaxe d'image Markdown, pas un `!` de ponctuation — et une
      // ligne d'image INDENTÉE (légale : `imageLine()` fait `line.trim()`) porterait alors une
      // espace ordinaire juste devant le `!`. Même exclusion que dans G1.
      { nom: 'espace avant « ! »', motif: / !(?!\[)/g },
      { nom: 'espace avant « % »', motif: / %/g },
      { nom: 'espace après le guillemet ouvrant', motif: /« /g },
      { nom: 'espace avant le guillemet fermant', motif: / »/g },
    ]

    const trouvees = []
    lire('fr.md')
      .split('\n')
      .forEach((ligne, i) => {
        for (const { nom, motif } of REGLES) {
          for (const m of ligne.matchAll(motif)) {
            const debut = Math.max(0, m.index - 25)
            trouvees.push({
              numero: i + 1,
              regle: nom,
              extrait: ligne.slice(debut, m.index + m[0].length + 25),
            })
          }
        }
      })

    it('aucune occurrence hors des exceptions déclarées', () => {
      const inattendues = trouvees.filter((t) => !EXCEPTIONS_ATTENDUES.includes(t.extrait))
      expect(
        inattendues.map((t) => `ligne ${t.numero} — ${t.regle} — …${t.extrait}…`),
        "fr.md : espace ORDINAIRE là où le français veut une insécable (U+00A0). Corriger le " +
          "texte, ou — si ce n'est pas de la ponctuation française — ajouter l'extrait à " +
          'EXCEPTIONS_ATTENDUES avec sa raison.'
      ).toEqual([])
    })

    it('aucune exception déclarée devenue inutile', () => {
      const perimees = EXCEPTIONS_ATTENDUES.filter((e) => !trouvees.some((t) => t.extrait === e))
      expect(
        perimees,
        "EXCEPTIONS_ATTENDUES contient un extrait qui n'existe plus dans fr.md — le retirer, " +
          'sinon la liste finit par couvrir des cas que personne ne relit plus.'
      ).toEqual([])
    })
  })
})

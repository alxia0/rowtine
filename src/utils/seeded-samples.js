// Mémoire des exemples semés au 1er lancement (3 patrons + 2 projets, cf.
// OnboardingView.seedExamples). Sert UNIQUEMENT à `isDbRestorable`
// (src/backup/restore-service.js) : une base qui ne contient QUE ces
// identifiants-là n'est pas « pleine », c'est une base neuve — et refuser d'y
// restaurer rendait fausse la promesse du guide (« tu redésignes ce dossier,
// tout revient comme avant »).
//
// On ENREGISTRE les identifiants plutôt que de reconnaître les exemples à leur
// contenu : un nom ou un texte se modifie, un identifiant non. C'est ce qui
// garantit qu'on ne prendra jamais le travail réel d'une utilisatrice pour un
// exemple.
import { getSetting, setSetting } from '@/db/db'

const KEY = 'seededSampleIds'
const EMPTY = { patterns: [], projects: [] }

// L'invariant réel n'est pas « un nombre fini » mais « un entier strictement positif » :
// c'est ce qu'est TOUJOURS un identifiant Dexie (auto-incrément à partir de 1). Tout le
// reste est du bruit (null d'un semis partiel, chaîne d'une sérialisation, `''`/`false`/
// `[]` qui se coercent en 0, flottant, négatif) — et ce bruit n'est pas anodin : cette
// fonction alimente `getSeededSampleIds`, un export public que
// `isDbRestorable` consomme pour distinguer « base neuve avec ses exemples » de
// « base où l'utilisatrice a travaillé ». Une comparaison par LONGUEUR de tableau y est
// naturelle (« la base ne contient pas plus d'ids que ceux enregistrés ») ; un tableau
// gonflé de bruit la rendrait permissive dans le sens dangereux — traiter le travail
// réel d'une utilisatrice comme un exemple, donc l'effacer. D'où aussi la
// déduplication : un doublon gonflerait la longueur sans ajouter d'identifiant réel.
// `null`/`undefined` sont écartés AVANT la conversion : `Number(null)` vaut 0, qui est
// un entier, et se glisserait donc dans le résultat sans ce filtre préalable.
function toIds(value) {
  if (!Array.isArray(value)) return []
  const ids = value
    .filter((v) => v !== null && v !== undefined)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
  return [...new Set(ids)]
}

// Idempotent : le semis n'a lieu qu'une fois, mais un second appel remplace
// proprement plutôt que d'accumuler.
export async function recordSeededSamples({ patterns, projects } = {}) {
  await setSetting(KEY, { patterns: toIds(patterns), projects: toIds(projects) })
}

// Repli sûr : réglage absent, corrompu, ou d'une version antérieure au correctif
// → tableaux vides, donc `isDbRestorable` se comporte exactement comme `isDbEmpty`.
export async function getSeededSampleIds() {
  const raw = await getSetting(KEY)
  if (!raw || typeof raw !== 'object') return { ...EMPTY }
  return { patterns: toIds(raw.patterns), projects: toIds(raw.projects) }
}

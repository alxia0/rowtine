import { describe, it, expect, vi, beforeEach } from 'vitest'

// `vi.hoisted` : le factory de `vi.mock` est hoisté au-dessus des déclarations top-level
// (TDZ Vitest v4) — même précaution qu'en tête de tests/unit/saf-folder-section.spec.js.
const state = vi.hoisted(() => ({ read: { state: 'absent' } }))
vi.mock('@/backup/backup-manifest', () => ({ readManifest: async () => state.read }))
vi.mock('@/backup/device-identity', () => ({ deviceId: async () => 'moi' }))

import { createI18n } from 'vue-i18n'
import fr from '@/i18n/fr.json'
import { describeOrigin, adviceSentence, originSentence } from '@/backup/backup-origin'

// `t` RÉEL (pas un espion qui renverrait sa clé) : ces deux fonctions ne servent qu'à
// produire des phrases lisibles, et le seul défaut qu'un espion laisserait passer est
// justement celui qu'on craint ici — un paramètre non transmis. ⚠️ MESURÉ sur le
// vue-i18n de ce dépôt : un paramètre absent est interpolé en chaîne VIDE, jamais rendu
// en `{date}`. Un `not.toContain('{date}')` ne prouverait donc RIEN ; c'est le blanc à la
// place du mot qu'il faut voir, d'où les égalités complètes ci-dessous.
const { t } = createI18n({ legacy: false, locale: 'fr', messages: { fr } }).global

describe('describeOrigin', () => {
  beforeEach(() => {
    // Défaut déterministe : sans lui, un test qui oublie de poser `state.read` hériterait
    // de celui du test précédent et passerait par coïncidence.
    state.read = { state: 'absent' }
  })

  it('fiche de cet appareil → self', async () => {
    state.read = { state: 'ok', manifest: { appareil: 'moi' } }
    expect((await describeOrigin({})).origin).toBe('self')
  })

  it('fiche d’un autre appareil → other, et la fiche est rendue', async () => {
    state.read = { state: 'ok', manifest: { appareil: 'autre', modeleAppareil: 'LYA-L29' } }
    const r = await describeOrigin({})
    expect(r.origin).toBe('other')
    expect(r.manifest.modeleAppareil).toBe('LYA-L29')
  })

  it('fiche absente → unknown, et AUCUNE fiche', async () => {
    state.read = { state: 'absent' }
    expect(await describeOrigin({})).toEqual({ origin: 'unknown', manifest: null })
  })

  it('fiche illisible → unknown (on n’affiche pas des décomptes qu’on n’a pas su lire)', async () => {
    state.read = { state: 'invalid' }
    expect((await describeOrigin({})).origin).toBe('unknown')
  })

  it('sans stockage → unknown, sans lever', async () => {
    // La fiche mockée dit « ok, cet appareil » EXPRÈS : sans elle, le repli par défaut
    // (`absent`) produirait `unknown` de toute façon et ce test resterait vert même si
    // la garde `!storage` disparaissait — il ne prouverait rien. Ici, seule cette garde
    // peut répondre `unknown`.
    state.read = { state: 'ok', manifest: { appareil: 'moi' } }
    expect((await describeOrigin(null)).origin).toBe('unknown')
  })
})

// Les deux phrases partagées : elles vivaient dans SafFolderSection.vue et sont
// désormais consommées AUSSI par le bandeau de décision. C'est le seul endroit où elles
// sont testées pour elles-mêmes ; les deux composants vérifient qu'ils les affichent au
// bon endroit, pas ce qu'elles disent.
describe('adviceSentence', () => {
  // Le 3e argument est `restorable` — la réponse d'`isDbRestorable()` que l'écran appelant a
  // déjà calculée, à TROIS états : `true` migration, `false` dossier partagé, `null`/absent
  // « la sonde n'a pas su répondre ». Il ne concerne QUE les conseils « un autre appareil » :
  // ce sont les seuls qui recommandent un GESTE.
  it('cet appareil, base restaurable → le conseil « ta propre sauvegarde »', () => {
    expect(adviceSentence(t, 'self', true)).toBe(fr.saf.adviceThisDevice)
  })

  // Le conseil `'self'` ne recommande rien : il constate que les données sont déjà sur cet
  // appareil. Il ne doit donc PAS disparaître avec la restaurabilité — sans ce test, une
  // garde posée trop haut dans la fonction l'emporterait avec l'autre, en silence.
  it('cet appareil, base NON restaurable → le conseil tient quand même', () => {
    expect(adviceSentence(t, 'self', false)).toBe(fr.saf.adviceThisDevice)
  })

  // MIGRATION : ancien téléphone vers le neuf, base encore vierge. Restaurer aboutira.
  it('un autre appareil, base restaurable → le conseil « restaure tes données »', () => {
    expect(adviceSentence(t, 'other', true)).toBe(fr.saf.adviceOtherDevice)
  })

  // DOSSIER PARTAGÉ : deux appareils en usage. `runRestore` REFUSERA (garde `not-empty`) —
  // conseiller de restaurer enverrait vers une porte fermée, au moment précis où elle
  // décide. Mais « ne pas conseiller de restaurer » ne veut PAS dire « ne rien dire »
  // (correctif de revue, 07/08) : ici on sait parfaitement quoi conseiller — ce dossier sert
  // déjà à un autre appareil, il en faut un autre pour celui-ci. La règle « on ne conseille
  // que lorsqu'on sait » n'interdit rien dans ce cas : elle l'exige.
  it('un autre appareil, base NON restaurable → le conseil nomme le REMÈDE (changer de dossier)', () => {
    expect(adviceSentence(t, 'other', false)).toBe(fr.saf.adviceOtherDeviceBlocked)
  })

  // Et il ne cite AUCUN libellé de bouton — règle du lot, adoptée après qu'un renommage a
  // rendu deux textes faux. Épinglé ici plutôt que sur un écran : la phrase est unique.
  it('le conseil du remède ne cite aucun libellé de bouton', () => {
    const phrase = adviceSentence(t, 'other', false)
    for (const libelle of [fr.saf.startFresh, fr.restore.cta, fr.saf.later, fr.saf.change]) {
      expect(phrase).not.toContain(libelle)
    }
  })

  // ⚠️ LE TROISIÈME ÉTAT, et la raison d'être de ce module (correctif de revue, 07/08).
  // La sonde a LEVÉ : ce n'est ni la migration ni le dossier partagé, et les deux conseils
  // « autre appareil » disent des choses OPPOSÉES. Ne rien dire est la seule réponse juste —
  // et surtout, la MÊME des deux côtés. C'est là que les deux écrans divergeaient.
  it('un autre appareil, sonde en échec (null) → aucun conseil', () => {
    expect(adviceSentence(t, 'other', null)).toBeNull()
  })

  // Repli : un appelant qui oublie l'argument obtient « on ne sait pas » ⇒ pas de conseil.
  // Le défaut va dans le sens sûr, et c'est voulu.
  it('un autre appareil, restaurabilité non transmise → aucun conseil (repli sûr)', () => {
    expect(adviceSentence(t, 'other')).toBeNull()
  })

  // Garde contre le raccourci `restorable ? A : B` : un booléen ne peut pas porter trois
  // cas. Sans ce test, `0`/`''` (valeurs qu'aucune sonde ne renvoie aujourd'hui, mais qu'un
  // refactor peut introduire) glisseraient dans la branche « dossier partagé ».
  it('valeur ni vraie ni fausse au sens strict (0) → aucun conseil', () => {
    expect(adviceSentence(t, 'other', 0)).toBeNull()
  })

  // LA règle du lot : on ne conseille que lorsqu'on sait. `null`, donc AUCUNE ligne
  // affichée — pas une phrase de repli, qui serait un conseil déguisé.
  it('origine inconnue → null (aucun conseil, pas même un repli)', () => {
    expect(adviceSentence(t, 'unknown', true)).toBeNull()
  })
})

describe('originSentence', () => {
  const ecritLe = '2026-08-06T05:15:18.402Z'
  const date = new Date(ecritLe).toLocaleString()

  it('origine inconnue → la phrase « version antérieure », sans date inventée', () => {
    expect(originSentence(t, 'unknown', null)).toBe(fr.saf.originUnknown)
  })

  it('cet appareil → phrase COMPLÈTE, date comprise', () => {
    const phrase = originSentence(t, 'self', { ecritLe })
    expect(phrase).toBe(t('saf.originThisDevice', { date }))
    // Contrôle explicite du paramètre : une `{date}` non transmise ne laisserait pas
    // d'accolades, seulement un trou. On vérifie donc que la date EST là.
    expect(phrase).toContain(date)
  })

  it('un autre appareil nommé → le modèle ET la date sont dans la phrase', () => {
    const phrase = originSentence(t, 'other', { ecritLe, modeleAppareil: 'LYA-L29' })
    expect(phrase).toBe(t('saf.originOtherDevice', { model: 'LYA-L29', date }))
    expect(phrase).toContain('LYA-L29')
    expect(phrase).toContain(date)
  })

  // `modeleAppareil` absent (web/dev, build antérieur, erreur native) : la phrase de repli
  // — surtout pas `originOtherDevice` avec un modèle vide, qui afficherait « un autre
  // appareil () ».
  it('un autre appareil sans modèle connu → la phrase de repli, pas de parenthèse vide', () => {
    const phrase = originSentence(t, 'other', { ecritLe })
    expect(phrase).toBe(t('saf.originOtherUnnamed', { date }))
    expect(phrase).not.toContain('()')
    expect(phrase).toContain(date)
  })

  // Fiche sans `ecritLe` : `readManifest` ne valide QUE `appareil`, donc ce cas existe.
  // On l'accepte (la phrase reste vraie sur l'essentiel : qui a écrit) — ce test est là
  // pour que ce choix soit VU, pas subi.
  it('fiche sans date d’écriture → la phrase tient quand même, sans « Invalid Date »', () => {
    const phrase = originSentence(t, 'other', { modeleAppareil: 'LYA-L29' })
    expect(phrase).toBe(t('saf.originOtherDevice', { model: 'LYA-L29', date: '' }))
    expect(phrase).not.toContain('Invalid Date')
  })
})

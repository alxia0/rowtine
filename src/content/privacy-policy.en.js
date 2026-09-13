// Politique de confidentialité, traduction anglaise. Traduite automatiquement depuis
// privacy-policy.fr.js, la source de vérité
// (rédigée en français pour une lectrice non technique) — voir le commentaire de tête de ce
// fichier pour le mécanisme (blocs, pas de Markdown ; marqueur `{app}` substitué à
// l'affichage ; contraintes de parité de src/i18n/*.json qui gardent ce texte HORS de ces
// fichiers).
//
// ⚠️ Texte juridique : engage même traduit automatiquement, tout comme l'original français
// le rappelle dans son propre dernier bloc. Signalé explicitement :
// cette version anglaise n'a PAS été relue par une personne de langue maternelle anglaise,
// même réserve que les traductions d'interface des 29/07 et 31/07.
import { CONTACT_EMAIL } from '../constants/app-links'

export const PRIVACY_POLICY_UPDATED = '2026-09-04'

export const PRIVACY_POLICY_EN = [
  {
    type: 'p',
    text: "{app} collects no data at all. This page explains what that means in practice, with no jargon.",
  },
  { type: 'h2', text: 'What data exists' },
  {
    type: 'p',
    text: "Your projects, your patterns, your yarn stash, your purchase history, your settings (language, units, currency…) and the photos you add from the app: all of that is created by you, for you. {app} never asks for an account, a sign-up, or any information about who you are.",
  },
  { type: 'h2', text: 'Where it lives' },
  {
    type: 'p',
    text: "Only on your phone, in the app's own storage. If you choose a backup folder (in Settings), a copy is written there too — on your phone or a memory card you control. Never on a server: {app} doesn't have one.",
  },
  { type: 'h2', text: 'What leaves your phone' },
  {
    type: 'p',
    text: 'Nothing. {app} works entirely offline and never contacts any server, any third-party service. No advertising, no tracker, no audience measurement.',
  },
  { type: 'h2', text: 'If you uninstall the app' },
  {
    type: 'p',
    text: "The app's database disappears with it. Anything you backed up to your chosen folder (Settings) stays there: you can still find it, or delete it yourself, separately.",
  },
  { type: 'h2', text: 'Publisher and contact' },
  {
    type: 'p',
    text: `{app} is published by Alexia O. For any questions about your data or this policy, write to ${CONTACT_EMAIL}.`,
  },
]

// Politique de confidentialité, traduction allemande. Traduite automatiquement depuis
// privacy-policy.fr.js, la source de vérité
// (rédigée en français pour une lectrice non technique) — voir le commentaire de tête de ce
// fichier pour le mécanisme (blocs, pas de Markdown ; marqueur `{app}` substitué à
// l'affichage ; contraintes de parité de src/i18n/*.json qui gardent ce texte HORS de ces
// fichiers).
//
// Registre : tutoiement informel (« du »), comme le guide (guide/de.md, revu et corrigé pour
// retrouver ce registre après revue) — pas le « Sie » qui domine le gros de
// l'interface existante (traduction en masse du 29/07, jamais relue nativement). Le bloc
// « Deine Daten » de l'écran À propos (about.dataPoint*) tutoie déjà ; cette page se trouve à
// un clic de là et ne doit pas sonner différemment.
//
// ⚠️ Texte juridique : engage même traduit automatiquement, tout comme l'original français le
// rappelle dans son propre dernier bloc. Signalé explicitement :
// cette version allemande n'a PAS été relue par une personne de langue maternelle allemande,
// même réserve que les traductions d'interface des 29/07 et 31/07.
import { CONTACT_EMAIL } from '../constants/app-links'

export const PRIVACY_POLICY_UPDATED = '2026-09-04'

export const PRIVACY_POLICY_DE = [
  {
    type: 'p',
    text: '{app} sammelt keinerlei Daten. Diese Seite erklärt, was das konkret bedeutet, ohne Fachjargon.',
  },
  { type: 'h2', text: 'Um welche Daten es geht' },
  {
    type: 'p',
    text: 'Deine Projekte, deine Anleitungen, dein Garnvorrat, dein Kaufverlauf, deine Einstellungen (Sprache, Einheiten, Währung…) und die Fotos, die du in der App hinzufügst: Das alles entsteht von dir und für dich. {app} verlangt kein Konto, keine Registrierung und keinerlei Angaben dazu, wer du bist.',
  },
  { type: 'h2', text: 'Wo diese Daten liegen' },
  {
    type: 'p',
    text: 'Nur auf deinem Smartphone, im eigenen Speicher der App. Wählst du einen Sicherungsordner (in den Einstellungen), wird dort ebenfalls eine Kopie abgelegt — auf demselben Smartphone oder einer Speicherkarte, die du selbst kontrollierst. Niemals auf einem Server: {app} hat keinen.',
  },
  { type: 'h2', text: 'Was dein Smartphone verlässt' },
  {
    type: 'p',
    text: 'Nichts. {app} funktioniert vollständig offline und kontaktiert weder einen Server noch einen Drittanbieter-Dienst. Keine Werbung, kein Tracker, keine Reichweitenmessung.',
  },
  { type: 'h2', text: 'Wenn du die App deinstallierst' },
  {
    type: 'p',
    text: 'Die Datenbank verschwindet mit ihr. Was im gewählten Ordner (Einstellungen) gesichert wurde, bleibt dort erhalten: Du kannst es dort wiederfinden oder selbst löschen.',
  },
  { type: 'h2', text: 'Verantwortlich und Kontakt' },
  {
    type: 'p',
    text: `{app} wird von Alexia O. herausgegeben. Bei Fragen zu deinen Daten oder dieser Erklärung schreibe an ${CONTACT_EMAIL}.`,
  },
]

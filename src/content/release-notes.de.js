// Journal des nouveautés, traduction allemande (revue du 02/08 — ce fichier
// n'existait pas : la section se rendait en français aux quatre langues). Traduite depuis
// release-notes.fr.js, la source de vérité — voir le commentaire de tête de ce fichier pour
// le mécanisme (une entrée par version, marqueur `{app}` substitué à l'affichage).
//
// Registre : tutoiement informel (« du »), comme le guide (guide/de.md) et la politique de
// confidentialité (privacy-policy.de.js) — même écran, à un clic de là, ne doit pas sonner
// différemment.
//
// ⚠️ Cette version allemande n'a PAS été relue par une personne de langue maternelle
// allemande, même réserve que les traductions d'interface des 29/07 et 31/07.
export const RELEASE_NOTES_DE = [
  {
    version: '1.4.1',
    notes: [
      'Benachrichtigung beim Arbeiten: Ein Tipp auf eine Schaltfläche geht nicht verloren, auch wenn Android die App geschlossen oder eingefroren hat.',
      'Die Benachrichtigung wird nur auf Wunsch aktiviert, mit einem Pop-up für die Hintergrunderlaubnis.',
      'Beim Öffnen eines Projekts geht es bei der zuletzt bearbeiteten Reihe weiter: Eine Anleitung lässt sich in beliebiger Reihenfolge abarbeiten.',
      'Projektseite: Schalter „Bildschirm anlassen“, während der Arbeit erreichbar.',
    ],
  },
  {
    version: '1.4.0',
    notes: [
      'Merkhilfe für Maschentechniken: grundlegende und gängige Techniken zum Stricken und Häkeln (Anschläge, Abketten, Maschen), in den Werkzeugen und im Merkblatt des Lesemodus; für jede Anleitung die Maschen zum Nachschlagen auswählen.',
      'Die aktuelle Reihe als Benachrichtigung beim Arbeiten nach Anleitung: Reihe abhaken, Wiederholungen zählen (Minus und Plus), Erinnerung an das Diagramm, auf dem Sperrbildschirm sichtbar. In den Einstellungen einzuschalten, mit der Hintergrunderlaubnis, die die Schaltfläche zuverlässig macht.',
      'Der Bildschirm bleibt beim Arbeiten nach Anleitung an. Standardmäßig aktiv; einstellbar in den Einstellungen und im Merkzettel-Panel des Verfolgens.',
      'Lesemodus: Der aktuelle Schritt hält auch bei Wiederholungszählern an, und ein Tippen auf das linke Drittel einer Schrittkarte hakt sie ab.',
      'Abzeichen: Farbe jedes Garns, Materialien des Projekts über dem Kalender, schärferes Bild.',
      'Wollvorrat: Jede Karte zeigt die Gesamtlauflänge der Partie.',
      'Projektseite: Einheiten der Maschenprobe übersetzt, Nadelstärke mit dem Dezimaltrennzeichen der Sprache.',
      'Anleitung der App aktualisiert.',
    ],
  },
  {
    version: '1.3.3',
    notes: [
      'Dezimale Garnmengen (z. B. 2,5 Knäuel): Vorrat, Käufe, Reservierungen, Verbrauch pro Projekt, CSV-Export und Teilen.',
      'PDF-Import: Bilder der Anleitung bleiben besser erhalten, Anleitungen werden genauer gelesen, besonders deutsche.',
      'Anleitungsansicht: große Schrittbilder, PDF-Titelseite oben, verbesserte Vorschau.',
      'Verschiedene Verbesserungen der Oberfläche und Fehlerbehebungen.',
    ],
  },
  {
    version: '1.3.2',
    notes: [
      'Wollvorrat aus einem Ravelry-Export (.xlsx) importieren: Status, Farbe, Käufe, Notizen, Aufbewahrungsort und „Gekauft bei“ für jeden Kauf.',
      'Verschiedene Anzeigekorrekturen.',
    ],
  },
  {
    version: '1.3.1',
    notes: [
      'HEIC/HEIF-Fotos werden unterstützt (ab Android 9).',
      'Verbessertes Menü des Wollvorrats.',
    ],
  },
  {
    version: '1.3.0',
    notes: [
      'Neuer Statistik-Tab für jedes Projekt: Gesamtzeit, Sitzungen, verbrauchte Knäuel, Zeitraum, längste Tagesserie und Kalenderansicht.',
      'Ein Badge deines Projekts teilen (Foto, Zahlen, Farben, vier Vorlagen, freier Text, wählbare Sprache).',
      'Ein Projektfoto direkt aus der Galerie teilen.',
      'Wollvorrat: Preis akzeptiert jetzt ein Komma.',
      'Fotozugriffsberechtigung entfernt (Systemauswahl).',
    ],
  },
  {
    version: '1.1 bis 1.2.3',
    notes: ['Anpassungen zur Store-Konformität (F-Droid, Google Play), ohne funktionale Änderungen.'],
  },
  {
    version: '1.0',
    notes: ['Erste Version von {app}.'],
  },
]

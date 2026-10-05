// Journal des nouveautés, traduction espagnole (revue du 02/08 — ce fichier
// n'existait pas : la section se rendait en français aux quatre langues). Traduite depuis
// release-notes.fr.js, la source de vérité — voir le commentaire de tête de ce fichier pour
// le mécanisme (une entrée par version, marqueur `{app}` substitué à l'affichage).
//
// Registre : tuteo, sans double terminaison de genre (même précaution que privacy-policy.es.js
// et guide/es.md).
//
// ⚠️ Cette version espagnole n'a PAS été relue par une personne de langue maternelle
// espagnole, même réserve que les traductions d'interface des 29/07 et 31/07.
export const RELEASE_NOTES_ES = [
  {
    version: '1.4.2',
    notes: [
      'Secciones repetibles: una sección se puede hacer varias veces (calcetines, mangas, orejas o patas de un amigurumi), y cada ejemplar conserva su progreso. Por defecto, las mangas, orejas, extremidades y piernas se hacen por pares.',
      'Par de calcetines: uno tras otro, o los dos a la vez fila por fila.',
      'Ya se pueden importar PDF con varios patrones.',
      'Diseñador del patrón: se muestra en el patrón y en la insignia compartida.',
      'Nuevos tipos de sección para calcetines (puntera, pie, talón, caña, cuña, puño) y un tipo «Genérico repetible».',
    ],
  },
  {
    version: '1.4.1',
    notes: [
      'Notificación del seguimiento: una pulsación en un botón se conserva aunque Android haya cerrado o congelado la app.',
      'Notificación activada solo a petición, con una ventana emergente para el permiso en segundo plano.',
      'Al reabrir un proyecto se vuelve a la última fila trabajada: un patrón se puede trabajar en desorden.',
      'Ficha del proyecto: interruptor «Mantener la pantalla encendida», accesible mientras trabajas.',
    ],
  },
  {
    version: '1.4.0',
    notes: [
      'Memo de técnicas de puntos: los puntos y técnicas básicos y habituales, de punto y ganchillo (montajes, cierres, puntos), en las herramientas y en la guía rápida del lector; elige los puntos que quieres tener a mano para cada patrón.',
      'La fila en curso en una notificación mientras sigues un patrón: marcar la fila, contar las repeticiones (menos y más), recordatorio del diagrama, visible en la pantalla de bloqueo. Se activa en Ajustes, con el permiso de segundo plano que hace fiable el botón.',
      'La pantalla se mantiene encendida mientras sigues un patrón. Activada por defecto; ajustable en Ajustes y desde el panel de recordatorio del seguimiento.',
      'Lector: el paso en curso también se detiene en los contadores de repetición, y tocar el tercio izquierdo de una tarjeta de paso la marca.',
      'Insignia: color de cada lana, materiales de la labor encima del calendario, imagen más nítida.',
      'Stock de lanas: cada tarjeta muestra el metraje total del lote.',
      'Ficha del proyecto: unidades de la muestra traducidas, y grosor de aguja con el separador decimal del idioma.',
      'Guía actualizada.',
    ],
  },
  {
    version: '1.3.3',
    notes: [
      'Cantidades de lana decimales (p. ej. 2,5 ovillos): stock, compras, reservas, consumo por proyecto, exportación CSV y compartir.',
      'Importación de PDF: las imágenes del patrón se conservan mejor y los patrones se leen con más precisión, sobre todo los alemanes.',
      'Visor del patrón: imágenes de paso en grande, portada del PDF arriba, vista previa mejorada.',
      'Diversas mejoras de la interfaz y correcciones.',
    ],
  },
  {
    version: '1.3.2',
    notes: [
      'Importa tu stock de lanas desde una exportación de Ravelry (.xlsx): estado, color, compras, notas, lugar donde se guarda y «Comprado en» en cada compra.',
      'Correcciones de visualización.',
    ],
  },
  {
    version: '1.3.1',
    notes: [
      'Fotos HEIC/HEIF admitidas (Android 9 o posterior).',
      'Menú del stock de lanas mejorado.',
    ],
  },
  {
    version: '1.3.0',
    notes: [
      'Nueva pestaña de Estadísticas en cada proyecto: tiempo total, sesiones, ovillos usados, periodo, racha de días más larga y calendario de actividad.',
      'Compartir una insignia de tu labor (foto, cifras, colores, cuatro plantillas, texto libre, idioma a elegir).',
      'Compartir una foto del proyecto desde la galería.',
      'Stock de lanas: el precio admite coma.',
      'Permiso de acceso a fotos eliminado (selector del sistema).',
    ],
  },
  {
    version: '1.1 a 1.2.3',
    notes: ['Actualizaciones de conformidad con las tiendas (F-Droid, Google Play), sin cambios funcionales.'],
  },
  {
    version: '1.0',
    notes: ['Primera versión de {app}.'],
  },
]

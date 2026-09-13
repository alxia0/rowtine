// Politique de confidentialité, traduction espagnole. Traduite automatiquement depuis
// privacy-policy.fr.js, la source de vérité
// (rédigée en français pour une lectrice non technique) — voir le commentaire de tête de ce
// fichier pour le mécanisme (blocs, pas de Markdown ; marqueur `{app}` substitué à
// l'affichage ; contraintes de parité de src/i18n/*.json qui gardent ce texte HORS de ces
// fichiers).
//
// Registre : tuteo, sans jamais de double terminaison de genre (vérifié avec une attention
// particulière aux adjectifs qui pourraient s'accorder avec la personne qui lit, même piège
// déjà rencontré dans le guide — cf. guide/es.md, correction de « tú mismo » → « tú »).
//
// ⚠️ Texte juridique : engage même traduit automatiquement, tout comme l'original français le
// rappelle dans son propre dernier bloc. Signalé explicitement :
// cette version espagnole n'a PAS été relue par une personne de langue maternelle espagnole,
// même réserve que les traductions d'interface des 29/07 et 31/07.
import { CONTACT_EMAIL } from '../constants/app-links'

export const PRIVACY_POLICY_UPDATED = '2026-09-04'

export const PRIVACY_POLICY_ES = [
  {
    type: 'p',
    text: '{app} no recopila ningún dato. Esta página explica qué significa eso en la práctica, sin jerga técnica.',
  },
  { type: 'h2', text: 'Qué datos existen' },
  {
    type: 'p',
    text: 'Tus proyectos, tus patrones, tu stock de lana, tu historial de compras, tus ajustes (idioma, unidades, moneda…) y las fotos que añades desde la app: todo eso lo creas tú, para ti. {app} no pide ninguna cuenta, ningún registro, ninguna información sobre quién eres.',
  },
  { type: 'h2', text: 'Dónde viven esos datos' },
  {
    type: 'p',
    text: 'Solo en tu teléfono, dentro de la memoria de la app. Si eliges una carpeta de copia de seguridad (en Ajustes), también se escribe una copia allí — en tu teléfono o en una tarjeta de memoria que tú controlas. Nunca en un servidor: {app} no tiene ninguno.',
  },
  { type: 'h2', text: 'Qué sale de tu teléfono' },
  {
    type: 'p',
    text: 'Nada. {app} funciona completamente sin conexión y no contacta con ningún servidor ni ningún servicio de terceros. Sin publicidad, sin rastreadores, sin medición de audiencia.',
  },
  { type: 'h2', text: 'Si desinstalas la app' },
  {
    type: 'p',
    text: 'La base de datos de la app desaparece con ella. Lo que hayas guardado en la carpeta elegida (Ajustes) permanece ahí: puedes encontrarlo, o eliminarlo tú aparte.',
  },
  { type: 'h2', text: 'Responsable y contacto' },
  {
    type: 'p',
    text: `{app} es editada por Alexia O. Para cualquier pregunta sobre tus datos o esta política, escribe a ${CONTACT_EMAIL}.`,
  },
]

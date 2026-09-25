// Règle « pas un patron de tricot ou de crochet » (notPattern). Détecteur PUR sur les pages
// extraites (tableau de pages, chaque page un tableau de lignes { text, … }), évalué AVANT
// l'assemblage par reject.js : un refus ne coûte pas une conversion complète.
//
// Décision : score = somme des poids des marqueurs positifs DISTINCTS (un marqueur compte une
// fois, quelle que soit sa fréquence, pour qu'un mot répété ne suffise pas). Refus si le
// lexique contraire l'emporte nettement, ou si le score est sous CRAFT_MIN_SCORE, ou si
// AUCUN marqueur de consigne (kind 'instr') n'est présent : un catalogue de laines imprime
// aiguilles et échantillon pour chaque fil (kind 'mat') sans jamais donner une consigne.
// La garde de structure du moteur (rangs reconnus) ne sauve jamais un fichier sans marqueur.
//
// Trois exceptions, ajoutées au calage (écarts au plan, rapport de la tâche 4) :
// - patron en vidéo (video) : sans consigne écrite, il faut un marqueur de matériel, un renvoi
//   à une vidéo ET un verbe du métier à l'impératif relevé dans le corpus (VIDEO_VERB). Seuls
//   les deux Hobbii « Trio Crochet Top » (fi, fr) en dépendent. Un catalogue qui imprime
//   aiguilles, échantillon et « laine à tricoter » reste refusé (sondes de la revue en test) ;
// - texte en lettres espacées (illegible) : aucune frontière de mot ne subsiste, le détecteur
//   s'abstient (isPattern vrai) plutôt que de refuser sans avoir pu lire, à condition d'un
//   volume réel, d'un radical du métier et d'aucun radical d'un autre loisir dans le texte
//   recollé (Ravelry « Butter Bloom Flower ») ;
// - page de cotes (tabular) : presque pas de texte courant et surtout des nombres, rien à lire,
//   abstention (Modèles tricot/Ivy_Sweater_Schematics.pdf, décision de la propriétaire).
// Un échantillon ne vaut jamais consigne : « 22 sts » (en-sts) est du matériel, et la seconde
// cote d'un échantillon (« 22 p. x 30 v. ») n'est lue par aucune abréviation (N1).
//
// Classes : 'instr' (consigne propre au métier), 'mat' (matériel et échantillon propres au
// métier), 'word' (mot du métier, faible). Les mots partagés avec d'autres loisirs (patron,
// taille, fil, point, rang seul) n'y figurent pas.
//
// Frontières en classes Unicode : \b est ASCII même sous /u (« \bms\b » verrait une frontière
// dans « 12 msé »). Les abréviations qui sont aussi des unités (64 MB, 70dB, 10 V, 5028 PS,
// 2CH) vivent dans des marqueurs à casse respectée (rxc) ; un nombre de mailles n'est jamais 0
// (« 0 ms ») et ne se lit pas à travers un saut de ligne (N1).
//
// LEXIQUES : calés le 2026-09-24 sur le corpus (tools/corpus/rejets-calage.mjs, positifs
// corpus-web + Modèles, négatifs corpus-negatif hors recueils). Chaque marqueur porte sa
// fréquence documentaire relevée. Alternatives de la graine retirées : côté métier, celles qui
// ne touchaient aucun positif (yfwd, yrn, remat…, chiudere … maglie, masktäthet, …) ; côté
// contraire, celles qui touchaient des positifs sans toucher aucun négatif (broder*, ricam*,
// borduur*, brodere, brodera, bordar, kirjonta, machine à coudre, Nahtzugabe, Nähmaschine,
// mouliné, point de tige, point lancé, punto de cruz, têtes d'alouette) et le marqueur
// c-couture-autres (aucun négatif). Les alternatives contraires qui ne touchent ni positif ni
// négatif (traductions des termes anglais relevés) sont gardées, sur décision de la coordination
// du 2026-09-24. Le même jour, le corpus négatif a été enrichi en français, allemand et espagnol
// (30 → 73 fichiers hors recueils : 25 en, 18 fr, 16 de, 14 es) : ont été attestées depuis
// droit fil, surpiqûre, pied-de-biche, Fadenlauf, Kreuzstich, Stickrahmen, Kreuzknoten,
// Webrahmen, Kettfaden, Schussfaden, telar et urdimbre ; restent non attestées, sans qu'aucune
// touche un positif (aucune ne s'est donc révélée fausse) : valeurs de couture, entoilage,
// thermocollant, coudre endroit contre endroit, Bügeleinlage, Nähfüßchen, tambour à broder,
// nudo plano, Webstuhl et les traductions it, nl, da, no, sv, fi, pl. Ajoutés à ce relevé, chacun
// présent dans au moins un nouveau négatif et dans aucun positif : Webkante (c-couture-de),
// c-couture-es, bastidor, Plattstich, Knötchenstich, Stickvorlage, Kreuzstich en composé
// (c-broderie), Makramee, nudo cuadrado, alondra (c-macrame), Schiffchen (c-tissage) et
// c-couture-fr-tissu. Écartés parce qu'ils touchent des positifs : punto de cruz,
// bordado, Nahtzugabe, Nähmaschine, Stielstich, Kettenstich, Sticknadel, margen de costura,
// pespunte, fer à repasser, machine à coudre, canette. Ces alternatives ne sont pas inoffensives :
// plusieurs marqueurs contraires cumulés PEUVENT refuser un vrai patron (contra ≥ score +
// OTHER_CRAFT_MARGIN : contre un vrai patron de score 3, trois marqueurs contraires, ou
// deux à 2 et un à 1, suffisent). Sur le corpus, score − contra vaut au moins 2 sur les vrais patrons qui
// portent un terme contraire, et aucun n'est refusé par cette branche.

const B = '(?<![\\p{L}\\p{N}])'
const E = '(?![\\p{L}\\p{N}])'
const A = "['’]"
const NUM = '\\d+(?:[.,]\\d+)?'
const rx = (src) => new RegExp(`${B}(?:${src})${E}`, 'iu')
// Casse respectée : abréviations qui sont aussi des unités en capitales (64 MB, 10 V).
const rxc = (src) => new RegExp(`${B}(?:${src})${E}`, 'u')
// Sans frontières : écritures sans espace entre les mots (japonais).
const rxn = (src) => new RegExp(src, 'u')
// Nombre de mailles devant une abréviation : jamais 0 (« 0 ms » est un délai), espace
// horizontale seulement (un saut de ligne relie deux lignes sans rapport : « 100\nTR »), et
// jamais la seconde cote d'un échantillon (« 22 p. x 30 v. » : 30 v. n'est pas 30 vasten).
const N1 = '(?<![x×][ \\t\\u00a0]*)[1-9]\\d*[ \\t\\u00a0]?'

export const CRAFT_MARKERS = [
  // fr
  // relevé 2026-09-24 : 711/1866 positifs fr (782/3249 en tout), 0/73 négatifs
  { id: 'fr-monter', kind: 'instr', w: 2, re: rx(String.raw`mont(?:er|ez|e)(?:\s+\p{L}+)?\s+\d[\d\s()/-]*\s*(?:mailles|m|ml|ms)`) },
  // relevé 2026-09-24 : 847/1866 positifs fr (905/3249 en tout), 3/73 négatifs
  { id: 'fr-endroit', kind: 'instr', w: 2, re: rx(String.raw`(?:à|a)\s+l${A}(?:endroit|envers)|m\.\s*(?:end|env)|\d+[ \t]?m\.?[ \t]+(?:end|env)\.?|mailles?\s+(?:endroit|envers)`) },
  // relevé 2026-09-24 : 527/1866 positifs fr (584/3249 en tout), 0/73 négatifs
  { id: 'fr-points', kind: 'instr', w: 2, re: rx(String.raw`jersey\s+(?:endroit|envers)|point\s+(?:mousse|de\s+riz|jersey)|côtes\s+\d+\s*[/x×-]\s*\d+`) },
  // relevé 2026-09-24 : 416/1866 positifs fr (442/3249 en tout), 0/73 négatifs
  { id: 'fr-rabattre', kind: 'instr', w: 2, re: rx(String.raw`rabatt\p{L}*\s+(?:(?:toutes\s+)?les\s+)?(?:\d+\s+)?(?:mailles|m)`) },
  // relevé 2026-09-24 : 707/1866 positifs fr (772/3249 en tout), 0/73 négatifs
  { id: 'fr-ensemble', kind: 'instr', w: 2, re: rx(String.raw`\d+\s*m(?:ailles)?\.?\s+ens(?:emble|\.)?|surjet\s+(?:simple|double)|glisser\s+\d+\s*m(?:ailles)?`) },
  // relevé 2026-09-24 : 133/1866 positifs fr (153/3249 en tout), 0/73 négatifs
  { id: 'fr-jete', kind: 'instr', w: 2, re: rx(String.raw`${N1}jetés?`) },
  // relevé 2026-09-24 : 403/1866 positifs fr (446/3249 en tout), 0/73 négatifs
  { id: 'fr-tricoter-n', kind: 'instr', w: 2, re: rx(String.raw`tricot(?:er|ez)[ \t]+\d+[ \t]+(?:rangs?|rgs?|tours?|cm)`) },
  // relevé 2026-09-24 : 1108/1866 positifs fr (1133/3249 en tout), 1/73 négatifs
  { id: 'fr-crochet-pts', kind: 'instr', w: 2, re: rx(String.raw`(?:mailles?|m\.)\s*serr[ée]es?|(?:mailles?|m\.)\s*coul[ée]es?|cercle\s+magique|anneau\s+magique|${N1}(?:ms|mc|mcoul)`) },
  // relevé 2026-09-24 : 654/1866 positifs fr (659/3249 en tout), 0/73 négatifs
  { id: 'fr-brides', kind: 'instr', w: 2, re: rxc(String.raw`[Dd]emi-brides?|${N1}(?:br|db|dbr|tbr|brides?)`) },
  // relevé 2026-09-24 : 1059/1866 positifs fr (1073/3249 en tout), 0/73 négatifs
  { id: 'fr-chainette', kind: 'instr', w: 2, re: rx(String.raw`(?:mailles?|m\.)\s*en\s+l${A}air|chaînettes?|${N1}ml`) },
  // relevé 2026-09-24 : 787/1866 positifs fr (861/3249 en tout), 1/73 négatifs
  { id: 'fr-aiguilles', kind: 'mat', w: 2, re: rx(String.raw`aiguilles?\s+(?:circulaires?|doubles?\s+pointes?|à\s+tricoter|droites|n[°ºo]\s*${NUM}|${NUM}\s*mm)`) },
  // relevé 2026-09-24 : 901/1866 positifs fr (944/3249 en tout), 0/73 négatifs
  { id: 'fr-crochet-n', kind: 'mat', w: 2, re: rx(String.raw`crochet\s+(?:n[°ºo]\s*)?${NUM}(?:\s*mm)?`) },
  // relevé 2026-09-24 : 962/1866 positifs fr (1037/3249 en tout), 4/73 négatifs
  { id: 'fr-echantillon', kind: 'mat', w: 2, re: rx(String.raw`\d+\s*(?:m|mailles|ms|br|brides)\.?\s*(?:x|×|et|sur)\s*\d+\s*(?:rangs|rgs|rg|tours|r)`) },
  // relevé 2026-09-24 : 902/1866 positifs fr (985/3249 en tout), 3/73 négatifs
  { id: 'fr-tricoter', kind: 'word', w: 1, re: rx(String.raw`tricot(?:er|ez|é|ée|és|ées|ant|age|e)?`) },
  // relevé 2026-09-24 : 972/1866 positifs fr (983/3249 en tout), 0/73 négatifs
  { id: 'fr-crocheter', kind: 'word', w: 1, re: rx(String.raw`crochet(?:er|ez|é|ée|és|ées|ant)|au\s+crochet`) },
  // relevé 2026-09-24 : 1846/1866 positifs fr (1933/3249 en tout), 0/73 négatifs
  { id: 'fr-mailles', kind: 'word', w: 1, re: rx(String.raw`mailles?`) },
  // en
  // relevé 2026-09-24 : 45/158 positifs en (151/3249 en tout), 0/73 négatifs
  { id: 'en-dec', kind: 'instr', w: 2, re: rx(String.raw`[kp]\d?tog(?:-?tbl)?|ssk|ssp|sk2p|s2kp|skp|psso|cdd`) },
  // relevé 2026-09-24 : 44/158 positifs en (170/3249 en tout), 0/73 négatifs
  { id: 'en-inc', kind: 'instr', w: 2, re: rx(String.raw`kfb|pfb|m1[lrp]?|yo(?=\s*,)`) },
  // relevé 2026-09-24 : 48/158 positifs en (108/3249 en tout), 0/73 négatifs
  { id: 'en-rib', kind: 'instr', w: 2, re: rx(String.raw`[kp]\d+\s*,\s*[kp]\d+|k\d+tbl|(?:knit|purl)\s+\d+\s+(?:sts|stitches)`) },
  // relevé 2026-09-24 : 76/158 positifs en (188/3249 en tout), 0/73 négatifs
  { id: 'en-caston', kind: 'instr', w: 2, re: rx(String.raw`cast\s+on|bind\s+off|cast\s+off|co\s+\d+\s+sts|bo\s+\d+\s+sts`) },
  // relevé 2026-09-24 : 105/158 positifs en (221/3249 en tout), 0/73 négatifs
  { id: 'en-sts', kind: 'mat', w: 1, re: rx(String.raw`\d+\s*sts`) },
  // relevé 2026-09-24 : 56/158 positifs en (111/3249 en tout), 0/73 négatifs
  { id: 'en-stitches', kind: 'instr', w: 2, re: rx(String.raw`stockinette|garter\s+st(?:itch)?|seed\s+st(?:itch)?|moss\s+st(?:itch)?|rev(?:erse)?\s+st\s+st|st\s+st`) },
  // relevé 2026-09-24 : 97/158 positifs en (463/3249 en tout), 0/73 négatifs
  { id: 'en-crochet', kind: 'instr', w: 2, re: rx(String.raw`single\s+crochet|double\s+crochet|half\s+double|treble\s+crochet|sl[ \t]?st|magic\s+(?:ring|circle|loop)|ch\s+from\s+(?:the\s+)?hook`) },
  // relevé 2026-09-24 : 79/158 positifs en (195/3249 en tout), 0/73 négatifs
  { id: 'en-crochet-abbr', kind: 'instr', w: 2, re: rxc(String.raw`${N1}(?:sc|hdc|dc|tr|sl[ \t]?st|ch)|(?:sc|hdc|dc)\d?tog|[Cc]h\s+\d+`) },
  // relevé 2026-09-24 : 66/158 positifs en (122/3249 en tout), 0/73 négatifs
  { id: 'en-needles', kind: 'mat', w: 2, re: rx(String.raw`(?:circular|double[-\s]pointed|straight|knitting)\s+needles?|dpns?|needles?\s*(?:size\s*)?(?:us\s*)?(?:${NUM}\s*mm|\d+\s*\(\s*${NUM}\s*mm\s*\))`) },
  // relevé 2026-09-24 : 83/158 positifs en (132/3249 en tout), 0/73 négatifs
  { id: 'en-hook', kind: 'mat', w: 2, re: rx(String.raw`${NUM}\s*mm\s+(?:crochet\s+)?hook|(?:crochet\s+)?hook\s*(?:size\s*)?(?:[a-n]\s*[/-]\s*)?${NUM}\s*mm|crochet\s+hook`) },
  // relevé 2026-09-24 : 61/158 positifs en (107/3249 en tout), 0/73 négatifs
  { id: 'en-gauge', kind: 'mat', w: 2, re: rx(String.raw`\d+\s*(?:sts|stitches|sc|hdc|dc)\s*(?:x|×|and|by)\s*\d+\s*(?:rows|rounds|rnds)`) },
  // relevé 2026-09-24 : 77/158 positifs en (335/3249 en tout), 7/73 négatifs
  { id: 'en-knit', kind: 'word', w: 1, re: rx(String.raw`knit(?:ting|ted)?|purl(?:wise|ed|ing)?`) },
  // relevé 2026-09-24 : 92/158 positifs en (1373/3249 en tout), 6/73 négatifs
  { id: 'en-crochet-word', kind: 'word', w: 1, re: rx(String.raw`crochet(?:ed|ing)?`) },
  // de
  // relevé 2026-09-24 : 72/129 positifs de (74/3249 en tout), 2/73 négatifs
  // « anschlagen » seul se dit aussi du tassement de la trame au peigne (tissage/archaicarts-
  // kettaufzug-de) : il faut un nombre ou des mailles dans les cinq mots qui précèdent.
  { id: 'de-anschlag', kind: 'instr', w: 2, re: rx(String.raw`(?:\d+|maschen|m|lm|lftm|luftmaschen|luft-m|stb)\.?\s+(?:[\p{L}()-]+\s+){0,4}anschlagen|angeschlagen|aufschlagen|abketten|abgekettet|abk\.`) },
  // relevé 2026-09-24 : 59/129 positifs de (68/3249 en tout), 1/73 négatifs
  { id: 'de-rechts-links', kind: 'instr', w: 2, re: rx(String.raw`rechte\s+maschen?|linke\s+maschen?|glatt\s+(?:rechts|links)|kraus\s+rechts|\d+\s*m\.?\s+(?:re|li)\.?|(?:re|li)\.?\s+zus(?:ammen|\.)?|${N1}(?:re|li)(?=[ \t]*[,;)])|zusammenstricken|rippenmuster|bündchenmuster`) },
  // relevé 2026-09-24 : 69/129 positifs de (268/3249 en tout), 1/73 négatifs
  { id: 'de-haekel', kind: 'instr', w: 2, re: rx(String.raw`feste\s+maschen?|luftmaschen?|kettmaschen?|stäbchen|magischer\s+ring|fadenring|${N1}(?:fm|stb|hstb|lm|lftm|kettm)`) },
  // relevé 2026-09-24 : 111/129 positifs de (114/3249 en tout), 1/73 négatifs
  { id: 'de-nadel', kind: 'mat', w: 2, re: rx(String.raw`rundnadeln?|nadelspiel|stricknadeln?|häkelnadel|nadel(?:n|stärke)?\s*(?:nr\.?\s*)?${NUM}\s*mm`) },
  // relevé 2026-09-24 : 95/129 positifs de (117/3249 en tout), 4/73 négatifs
  { id: 'de-probe', kind: 'mat', w: 2, re: rx(String.raw`maschenprobe|\d+\s*(?:m|maschen)\.?\s*(?:x|×|und)\s*\d+\s*(?:r|reihen|runden|rd|rh)\.?`) },
  // relevé 2026-09-24 : 126/129 positifs de (131/3249 en tout), 2/73 négatifs
  { id: 'de-word', kind: 'word', w: 1, re: rx(String.raw`strick(?:en|t|e|st)|gestrickt|häkel(?:n|t|e)|gehäkelt|maschen?`) },
  // es
  // relevé 2026-09-24 : 26/116 positifs es (28/3249 en tout), 0/73 négatifs
  { id: 'es-montar', kind: 'instr', w: 2, re: rx(String.raw`mont(?:ar|a|e|ad)\s+\d+\s*(?:p|pts|ptos|puntos|m|mallas|cad|cadenetas)|cerrar\s+(?:todos\s+los\s+)?(?:\d+\s+)?(?:p|pts|ptos|puntos|mallas)`) },
  // relevé 2026-09-24 : 50/116 positifs es (65/3249 en tout), 1/73 négatifs
  { id: 'es-puntos', kind: 'instr', w: 2, re: rx(String.raw`punto\s+(?:derecho|revés|reves|jersey|bobo|musgo|elástico|arroz)|\d+\s*(?:p|pts)\.?\s+juntos|\d+\s*(?:d|r)\s*,\s*\d+\s*(?:d|r)`) },
  // relevé 2026-09-24 : 83/116 positifs es (88/3249 en tout), 1/73 négatifs
  { id: 'es-ganchillo-pts', kind: 'instr', w: 2, re: rx(String.raw`punto\s+bajo|punto\s+alto|medio\s+punto\s+alto|punto\s+deslizado|puntos?\s+enanos?|cadenetas?|anillo\s+mágico|${N1}(?:pb|pa|mpa|pd|cad|pe|varetas?|p\.a\.|p\.bjs|p\.b\.)`) },
  // relevé 2026-09-24 : 102/116 positifs es (104/3249 en tout), 2/73 négatifs
  { id: 'es-agujas', kind: 'mat', w: 2, re: rx(String.raw`agujas?\s+(?:circular(?:es)?|de\s+doble\s+punta|de\s+tejer|rectas|(?:n[°ºo.]\s*)?${NUM}(?:\s*mm)?)|ag(?:ujas?)?\.?\s+(?:circular|de\s+ganchillo|de\s+doble\s+punta)|ganchillo\s+(?:de\s+)?(?:n[°ºo.]\s*)?${NUM}(?:\s*mm)?`) },
  // relevé 2026-09-24 : 55/116 positifs es (55/3249 en tout), 0/73 négatifs
  { id: 'es-muestra', kind: 'mat', w: 2, re: rx(String.raw`\d+\s*(?:p|pts|ptos|puntos|pb)\.?\s*(?:x|×|y)\s*\d+\s*(?:vueltas|hileras|filas|v|h)\.?`) },
  // relevé 2026-09-24 : 113/116 positifs es (120/3249 en tout), 3/73 négatifs
  { id: 'es-word', kind: 'word', w: 1, re: rx(String.raw`tejer|teje|tejiendo|tricotar|ganchillo`) },
  // it
  // relevé 2026-09-24 : 42/118 positifs it (43/3249 en tout), 0/73 négatifs
  { id: 'it-avvio', kind: 'instr', w: 2, re: rx(String.raw`avvia(?:re|te|to)?\s+\d+\s*(?:m|maglie)|intrecciar\p{L}*`) },
  // relevé 2026-09-24 : 73/118 positifs it (82/3249 en tout), 0/73 négatifs
  { id: 'it-maglie', kind: 'instr', w: 2, re: rx(String.raw`(?:a\s+)?(?:dritto|diritto|rovescio)|maglia\s+rasata|legaccio|coste\s+\d+\s*[/x×-]\s*\d+|\d+\s*m\.?\s*(?:dir|dr|rov)\.?|${N1}(?:dir|rov)(?=[ \t]*[,;*)])|\d+\s*m\s+insieme|accavallat\p{L}*`) },
  // relevé 2026-09-24 : 64/118 positifs it (66/3249 en tout), 0/73 négatifs
  { id: 'it-uncinetto-pts', kind: 'instr', w: 2, re: rx(String.raw`maglie?\s+bass(?:a|e|issim[ae])|maglie?\s+alt(?:a|e)|mezza\s+maglia\s+alta|catenell[ae]|anello\s+magico`) },
  // relevé 2026-09-24 : 56/118 positifs it (62/3249 en tout), 0/73 négatifs
  { id: 'it-uncinetto-abbr', kind: 'instr', w: 2, re: rxc(String.raw`${N1}(?:mb|ma|mma|cat|mbss)`) },
  // relevé 2026-09-24 : 75/118 positifs it (77/3249 en tout), 0/73 négatifs
  { id: 'it-ferri', kind: 'mat', w: 2, re: rx(String.raw`ferri\s+(?:circolari|a\s+doppia\s+punta|dritti|da\s+maglia|(?:n\.?\s*)?${NUM})|uncinetto\s+(?:n\.?\s*)?${NUM}`) },
  // relevé 2026-09-24 : 54/118 positifs it (55/3249 en tout), 0/73 négatifs
  { id: 'it-campione', kind: 'mat', w: 2, re: rx(String.raw`\d+\s*(?:m|maglie)\.?\s*(?:x|×|e)\s*\d+\s*(?:f|ferri|giri|righe)\.?`) },
  // relevé 2026-09-24 : 110/118 positifs it (111/3249 en tout), 0/73 négatifs
  { id: 'it-word', kind: 'word', w: 1, re: rx(String.raw`lavor(?:are|o)\s+a\s+maglia|uncinetto|maglie`) },
  // nl
  // relevé 2026-09-24 : 27/111 positifs nl (45/3249 en tout), 0/73 négatifs
  { id: 'nl-opzet', kind: 'instr', w: 2, re: rx(String.raw`zet\s+\d+\s*(?:st|steken|l)\.?\s+op|opzetten|afkanten|kant\s+(?:alle\s+)?(?:st|steken)\s+af`) },
  // relevé 2026-09-24 : 51/111 positifs nl (74/3249 en tout), 0/73 négatifs
  { id: 'nl-steken', kind: 'instr', w: 2, re: rx(String.raw`rechte\s+steken|averecht(?:e)?|tricotsteek|ribbelsteek|boordsteek|\d+\s*st\s+(?:r|av|re|samen)|samenbreien|\d+\s*r\s*,\s*\d+\s*av`) },
  // relevé 2026-09-24 : 84/111 positifs nl (138/3249 en tout), 1/73 négatifs
  { id: 'nl-haak', kind: 'instr', w: 2, re: rx(String.raw`vasten|vaste\s+steken|halve\s+vasten?|halve\s+stokjes?|stokjes|losse[n]?|magische\s+ring|haak[ \t]+\d+|${N1}(?:vs|stk|hstk|hst|hv|lossen)`) },
  // relevé 2026-09-24 : 37/111 positifs nl (56/3249 en tout), 0/73 négatifs
  { id: 'nl-haak-abbr', kind: 'instr', w: 2, re: rxc(String.raw`${N1}(?:v|l)(?=[ \t]*[,;.)]|[ \t]+(?:in|op|tot|om))`) },
  // relevé 2026-09-24 : 104/111 positifs nl (115/3249 en tout), 0/73 négatifs
  { id: 'nl-naald', kind: 'mat', w: 2, re: rx(String.raw`rondbreinaald(?:en)?|breinaalden?|haaknaald(?:\s*(?:nr\.?\s*)?${NUM})?`) },
  // relevé 2026-09-24 : 76/111 positifs nl (90/3249 en tout), 0/73 négatifs
  { id: 'nl-proef', kind: 'mat', w: 2, re: rx(String.raw`stekenverhouding|proeflapje|\d+\s*(?:st|steken)\s*(?:x|×|en)\s*\d+\s*(?:r|rijen|toeren|nld|naalden)`) },
  // relevé 2026-09-24 : 110/111 positifs nl (136/3249 en tout), 1/73 négatifs
  { id: 'nl-word', kind: 'word', w: 1, re: rx(String.raw`breien|gebreid|brei|haken|gehaakt|haak`) },
  // da
  // relevé 2026-09-24 : 66/114 positifs da (79/3249 en tout), 0/73 négatifs
  { id: 'da-strik', kind: 'instr', w: 2, re: rx(String.raw`slå\s+\d+\s*(?:m|masker)\.?\s+op|luk\s+(?:alle\s+)?(?:\d+\s+)?(?:m\s+)?af|\d+\s*m\s+(?:ret|vr(?:ang)?)\s+sammen|glatstrik(?:ning)?|retstrik(?:ning)?|\d+\s*r\s*,\s*\d+\s*vr`) },
  // relevé 2026-09-24 : 105/114 positifs da (111/3249 en tout), 0/73 négatifs
  { id: 'da-pind', kind: 'mat', w: 2, re: rx(String.raw`rundpinde?|strømpepinde|hæklenål|pind\s+(?:nr\.?\s*)?${NUM}`) },
  // relevé 2026-09-24 : 82/114 positifs da (94/3249 en tout), 0/73 négatifs
  { id: 'da-fasthed', kind: 'mat', w: 2, re: rx(String.raw`strikkefasthed|hæklefasthed|\d+\s*(?:m|masker)\s*(?:x|×|og)\s*\d+\s*(?:p|pinde|omg|rækker)`) },
  // relevé 2026-09-24 : 105/114 positifs da (218/3249 en tout), 0/73 négatifs
  { id: 'da-word', kind: 'word', w: 1, re: rx(String.raw`strik(?:ke|kes|ket)?|hækl(?:e|es|et)|masker`) },
  // no
  // relevé 2026-09-24 : 57/112 positifs no (80/3249 en tout), 0/73 négatifs
  { id: 'no-strikk', kind: 'instr', w: 2, re: rx(String.raw`legg\s+opp\s+\d+|fell\s+av|felle\s+av|\d+\s*m\s+(?:r|vr)\s+sammen|glattstrikk|rillestrikk|vrangbord|\d+\s*r\s*,\s*\d+\s*vr`) },
  // relevé 2026-09-24 : 106/112 positifs no (107/3249 en tout), 0/73 négatifs
  { id: 'no-pinne', kind: 'mat', w: 2, re: rx(String.raw`rundpinne|strømpepinner|heklenål|pinne\s+(?:nr\.?\s*)?${NUM}`) },
  // relevé 2026-09-24 : 82/112 positifs no (104/3249 en tout), 0/73 négatifs
  { id: 'no-fasthet', kind: 'mat', w: 2, re: rx(String.raw`strikkefasthet|heklefasthet|\d+\s*(?:m|masker)\s*(?:x|×|og)\s*\d+\s*(?:p|pinner|omg|rader)`) },
  // relevé 2026-09-24 : 107/112 positifs no (164/3249 en tout), 0/73 négatifs
  { id: 'no-word', kind: 'word', w: 1, re: rx(String.raw`strikk(?:e|es|et)?|hekl(?:e|es|et)`) },
  // sv
  // relevé 2026-09-24 : 62/112 positifs sv (62/3249 en tout), 0/73 négatifs
  { id: 'sv-sticka', kind: 'instr', w: 2, re: rx(String.raw`lägg\s+upp\s+\d+|maska\s+av|avmaska|slätstickning|rätstickning|räta\s+maskor|aviga\s+maskor|resår|\d+\s*rm\s*,\s*\d+\s*am`) },
  // relevé 2026-09-24 : 108/112 positifs sv (108/3249 en tout), 0/73 négatifs
  { id: 'sv-stickor', kind: 'mat', w: 2, re: rx(String.raw`rundsticka|strumpstickor|virknål|stickor\s+(?:nr\.?\s*)?${NUM}|(?:rundst|strumpst|st)\.?\s+nr\.?\s*${NUM}`) },
  // relevé 2026-09-24 : 78/112 positifs sv (78/3249 en tout), 0/73 négatifs
  { id: 'sv-tathet', kind: 'mat', w: 2, re: rx(String.raw`stickfasthet|virkfasthet|\d+\s*(?:m|maskor)\s*(?:x|×|och)\s*\d+\s*(?:v|varv)`) },
  // relevé 2026-09-24 : 109/112 positifs sv (109/3249 en tout), 0/73 négatifs
  { id: 'sv-word', kind: 'word', w: 1, re: rx(String.raw`sticka|stickad|virka|virkning|virkad|maskor`) },
  // da, no, sv : crochet (vocabulaire commun)
  // relevé 2026-09-24 : 207/338 positifs da+no+sv (283/3249 en tout), 0/73 négatifs
  { id: 'nord-haekle', kind: 'instr', w: 2, re: rx(String.raw`fastmask\p{L}*|stangmask\p{L}*|luftmask\p{L}*|kædemask\p{L}*|kjedemask\p{L}*|smygmask\p{L}*|stavmask\p{L}*|stolpar|${N1}(?:fm|stm|lm)`) },
  // fi
  // relevé 2026-09-24 : 108/117 positifs fi (108/3249 en tout), 0/73 négatifs
  { id: 'fi-neulo', kind: 'instr', w: 2, re: rx(String.raw`luo\s+\d+\s*(?:s|silmukkaa)|päätä\s+(?:kaikki\s+)?silmukat|päättele|neulo\s+\d+\s*(?:s|krs)|sileää\s+neuletta|ainaoikeaa|joustin\p{L}*|\d+\s*o\s*,\s*\d+\s*n`) },
  // relevé 2026-09-24 : 64/117 positifs fi (64/3249 en tout), 0/73 négatifs
  { id: 'fi-virkkaa', kind: 'instr', w: 2, re: rx(String.raw`kiinte(?:ä|ät|ää|itä)\s+silmuk\p{L}*|pylvä\p{L}*|ketjusilmuk\p{L}*|piilosilmuk\p{L}*|taikarengas`) },
  // relevé 2026-09-24 : 57/117 positifs fi (58/3249 en tout), 0/73 négatifs
  { id: 'fi-virkkaa-abbr', kind: 'instr', w: 2, re: rxc(String.raw`${N1}(?:ks|kjs|ps)`) },
  // relevé 2026-09-24 : 116/117 positifs fi (116/3249 en tout), 0/73 négatifs
  { id: 'fi-puikot', kind: 'mat', w: 2, re: rx(String.raw`pyöröpuik\p{L}*|sukkapuik\p{L}*|neulepuik\p{L}*|virkkuukouk\p{L}*|puikot\s*[,:]?\s*(?:nro\s*)?${NUM}|koukku\s*[,:]?\s*(?:nro\s*)?${NUM}`) },
  // relevé 2026-09-24 : 68/117 positifs fi (68/3249 en tout), 0/73 négatifs
  { id: 'fi-tiheys', kind: 'mat', w: 2, re: rx(String.raw`neuletiheys|virkkaustiheys|\d+\s*(?:s|silmukkaa)\s*(?:x|×|ja)\s*\d+\s*(?:krs|kerrosta)`) },
  // relevé 2026-09-24 : 116/117 positifs fi (116/3249 en tout), 0/73 négatifs
  { id: 'fi-word', kind: 'word', w: 1, re: rx(String.raw`neulo\p{L}*|virkka\p{L}*|silmuk\p{L}*`) },
  // pl
  // relevé 2026-09-24 : 57/117 positifs pl (58/3249 en tout), 0/73 négatifs
  { id: 'pl-druty', kind: 'instr', w: 2, re: rx(String.raw`nabra(?:ć|ł|łam)\s+\d+|nabierz\s+\d+|zamkn(?:ąć|ij)\s+(?:wszystkie\s+)?oczka|prawe\s+oczka|lewe\s+oczka|oczka\s+(?:prawe|lewe)|ścieg\p{L}*\s+pończosznicz\p{L}*|ścieg\p{L}*\s+francusk\p{L}*|ściągacz\p{L}*|przerabia(?:ć|j)\s+razem|\d+\s*o\.?\s*(?:pr|lew)\.?`) },
  // relevé 2026-09-24 : 70/117 positifs pl (71/3249 en tout), 0/73 négatifs
  { id: 'pl-szydelko', kind: 'instr', w: 2, re: rx(String.raw`oczk\p{L}*\s+ścisł\p{L}*|półsłup\p{L}*|słupk\p{L}*|oczk\p{L}*\s+łańcuszk\p{L}*|łańcuszk\p{L}*|magiczne\s+kółko|${N1}(?:ob|oł|sł|psł)`) },
  // relevé 2026-09-24 : 114/117 positifs pl (114/3249 en tout), 0/73 négatifs
  { id: 'pl-narzedzia', kind: 'mat', w: 2, re: rx(String.raw`drut\p{L}*\s+(?:z\s+żyłką|okrągł\p{L}*|pończosznicz\p{L}*|na\s+żyłce)|druty\s*[,:]?\s*(?:nr\.?\s*)?${NUM}|szydeł\p{L}*\s*[,:]?\s*(?:drops\s+)?(?:nr\.?\s*)?${NUM}`) },
  // relevé 2026-09-24 : 53/117 positifs pl (53/3249 en tout), 0/73 négatifs
  { id: 'pl-probka', kind: 'mat', w: 2, re: rx(String.raw`\d+\s*(?:o\.?|oczek)\s*(?:x|×|i)\s*\d+\s*(?:rz|rzędów|okr|okrążeń)\.?`) },
  // relevé 2026-09-24 : 115/117 positifs pl (116/3249 en tout), 0/73 négatifs
  { id: 'pl-word', kind: 'word', w: 1, re: rx(String.raw`na\s+drutach|szydełk\p{L}*|oczek|oczka`) },
  // ru (hors des onze langues du moteur, mais présent dans le corpus positif)
  // relevé 2026-09-24 : 0/0 positifs ru (3/3249 en tout), 0/73 négatifs
  { id: 'ru-vyazanie', kind: 'instr', w: 2, re: rx(String.raw`лицев\p{L}*|изнаноч\p{L}*|набра\p{L}*\s+\d+|набор\p{L}*\s+петел\p{L}*`) },
  // relevé 2026-09-24 : 0/0 positifs ru (3/3249 en tout), 0/73 négatifs
  { id: 'ru-spicy', kind: 'mat', w: 2, re: rx(String.raw`спиц\p{L}*`) },
  // relevé 2026-09-24 : 0/0 positifs ru (3/3249 en tout), 0/73 négatifs
  { id: 'ru-word', kind: 'word', w: 1, re: rx(String.raw`петл\p{L}*|петел\p{L}*|вяза\p{L}*|вяж\p{L}*`) },
  // ja (idem) : l'écriture japonaise n'a pas d'espace entre les mots, d'où des motifs sans frontières.
  // relevé 2026-09-24 : 0/0 positifs ja (11/3249 en tout), 0/73 négatifs
  { id: 'ja-me', kind: 'instr', w: 2, re: rxn(String.raw`作り目|\d+\s*[目段]`) },
  // relevé 2026-09-24 : 0/0 positifs ja (11/3249 en tout), 0/73 négatifs
  { id: 'ja-word', kind: 'word', w: 1, re: rxn(String.raw`編[むみん]`) },
]

export const CONTRA_MARKERS = [
  // relevé 2026-09-24 : 6/73 négatifs, 0/3249 positifs
  { id: 'c-couture-fr', w: 2, re: rx(String.raw`valeurs?\s+de\s+couture|droit[-\s]fil|entoilage|thermocollant|surpiqu\p{L}*|pied[-\s]de[-\s]biche|coudre\s+endroit\s+contre\s+endroit`) },
  // relevé 2026-09-24 : 6/73 négatifs, 0/3249 positifs
  // Le bâti (couture) ou le bâti du métier (tissage), et le tissu qu'on coupe : poids 1, le cumul
  // suffit sur couture/cdeacf-couture-au-fil-des-jours-fr (score 3, contra 4 → 5).
  { id: 'c-couture-fr-tissu', w: 1, re: rx(String.raw`bâti[rs]?|quantité\s+de\s+tissu|patrons?\s+(?:sur|dans)\s+(?:le|du)\s+tissu`) },
  // relevé 2026-09-24 : 6/73 négatifs, 2/3249 positifs
  { id: 'c-couture-en', w: 2, re: rx(String.raw`seam\s+allowances?|grain\s*line|interfacing|presser\s+foot|sewing\s+machine|topstitch\p{L}*`) },
  // relevé 2026-09-24 : 3/73 négatifs, 0/3249 positifs
  { id: 'c-couture-de', w: 2, re: rx(String.raw`fadenlauf|bügeleinlage|nähfüßchen|webkante`) },
  // relevé 2026-09-24 : 2/73 négatifs, 0/3249 positifs
  { id: 'c-couture-es', w: 2, re: rx(String.raw`máquinas?\s+de\s+coser|entretelas?|hilv[aá]n\p{L}*|patr[oó]n(?:es)?\s+de\s+costura|derecho\s+con\s+derecho`) },
  // relevé 2026-09-24 : 17/73 négatifs, 36/3249 positifs
  { id: 'c-broderie', w: 2, re: rx(String.raw`toile\s+a[ïi]da|a[ïi]da\s+\d+|point\s+de\s+croix|cross[-\s]?stitch|kreuzstich\p{L}*|punto\s+croce|kruissteek|korssting|korsstygn|ristipisto|haft\s+krzyżykowy|tambour\s+à\s+broder|embroidery\s+hoop|stickrahmen|bastidor(?:es)?|plattstich\p{L}*|knötchenstich\p{L}*|stickvorlage\p{L}*|stem\s+stitch|satin\s+stitch|embroider\p{L}*`) },
  // relevé 2026-09-24 : 10/73 négatifs, 2/3249 positifs
  { id: 'c-dmc', w: 1, re: rx(String.raw`dmc\s+\d{2,4}|stranded\s+cotton|floss|french\s+knots?`) },
  // relevé 2026-09-24 : 10/73 négatifs, 2/3249 positifs
  { id: 'c-macrame', w: 2, re: rx(String.raw`macram[ée]|makramee|nudos?\s+cuadrados?|alondra|n(?:œ|oe)uds?\s+plats?|square\s+knots?|lark${A}?s\s+head|half\s+hitch|demi[-\s]clés?|kreuzknoten|nudo\s+plano|nodo\s+piatto|platte\s+knoop`) },
  // relevé 2026-09-24 : 17/73 négatifs, 20/3249 positifs
  { id: 'c-tissage', w: 2, re: rx(String.raw`métier\s+à\s+tisser|tiss(?:er|age|ée?s?)|chaîne\s+et\s+trame|ensouple|rigid\s+heddle|heddle|warp\s+and\s+weft|weaving\s+loom|loom\s+weaving|webstuhl|webrahmen|(?:weber|web)?schiffchen|kettfaden|schussfaden|telar|urdimbre|telaio|ordito|weefgetouw|schering\s+en\s+inslag|vævestol|vävstol|kangaspuu|krosno`) },
]

// Seuils calés le 2026-09-24 (tools/corpus/rejets-calage.mjs, rapports
// …/Patrons/rejets-calage/2026-09-24-notPattern-v4.md puis -v5-fr-de-es.md) : 0/3249 vrais
// patrons refusés (corpus-web + Modèles, 7 scannés exclus), dont 4 acceptés hors score : les deux
// Trio Crochet Top (video), Butter Bloom (illegible), Ivy_Sweater_Schematics (tabular). Négatifs
// hors recueils, corpus enrichi en fr, de, es : 71/73 refusés (en 25/25, fr 18/18, de 15/16,
// es 13/14 ; couture 15/15, broderie 7/7, point de croix 7/7, macramé 8/8, tissage 12/12,
// catalogues 9/11, divers 13/13) ; aucun n'est accepté par une abstention. Restent acceptés deux
// catalogues de laines bavards, qu'aucun réglage de ce fichier ne refuse sans refuser un vrai
// patron : catalogues/casasol-catalogo-es (score 8, contra 4 : « punto elástico », « cadeneta »,
// « aguja 2-3 » ; retirer « punto elástico » refuse Hobbii Sif Sweater es) et
// catalogues/lanagrossa-lookbook17-farbteil-de (score 10, contra 0 : le glossaire des
// abréviations d'un lookbook, « abk = abketten », « Luft-M = Luftmasche » ; ignorer les lignes
// de glossaire refuse 5 vrais patrons et ne le refuse pas). Les 5 recueils sont acceptés par
// cette règle (celui de catalogues Lana Silvia compris). Score minimal d'un vrai patron jugé au
// score : 3 (pl) ; min/p5 par langue : da 5/6, de 5/7, en 1/5 (le 1 est Butter Bloom), es 4/5,
// fi 4/7, fr 4/8, it 4/5, nl 5/5, no 5/6, pl 3/5, sv 5/6 ; hors des onze langues, ja 5, pt 4,
// ru 5. Score maximal d'un négatif hors recueils refusé qui porte un marqueur de consigne et
// aucun terme contraire : 2 (divers/novexx-ap54-manual-en) ; ceux qui vont au-delà (jusqu'à 5,
// catalogues/topp-garnstaerken-de) n'ont aucune consigne. CRAFT_MIN_SCORE = 3 reste la seule
// valeur entre 2 et le minimum pl. OTHER_CRAFT_MARGIN : score − contra vaut au moins 2 sur les
// 60 vrais patrons qui portent un terme contraire ; sur les négatifs qui en portent un, au plus 0,
// sauf casasol (+4, accepté) et catalogues/fonty-catalogue-public-fr (+4, refusé faute de consigne).
export const CRAFT_MIN_SCORE = 3
export const OTHER_CRAFT_MARGIN = 2

function pagesText(pages) {
  return (Array.isArray(pages) ? pages : [])
    .map((p) => (Array.isArray(p) ? p : []).map((l) => String(l?.text ?? '')).join('\n'))
    .join('\n')
    .normalize('NFC')
}

// Lettres espacées : une ligne dont presque tous les mots sont d'un seul caractère
// (« I n a m a g i c c i r c l e »). L'extraction a perdu les frontières de mots et aucun
// marqueur ne peut s'y lire. Le détecteur s'abstient quand c'est l'essentiel du texte ET un
// volume réel (pas un titre isolé), que le texte recollé nomme le tricot ou le crochet, et
// qu'il ne nomme aucun autre loisir.
const SPACED_MIN_TOKENS = 6
const SPACED_TOKEN_RATIO = 0.7
// Relevé 2026-09-24 (part du texte en lignes espacées) : Butter Bloom 0,88 ; ensuite, sur les
// positifs, BRUME FR 0,44 et Nino 0,41 (lisibles par ailleurs) ; sur les négatifs, au plus 0,42
// (nuancier Yarn and Colors, refusé).
export const ILLEGIBLE_RATIO = 0.6
// Plancher de volume : Butter Bloom porte ~3 100 caractères espacés ; un titre isolé
// (« C A T A L O G U E 2 0 2 6 ») en porte une vingtaine.
export const ILLEGIBLE_MIN_CHARS = 300
// Sur le texte recollé, sans frontières (elles ont disparu) : radicaux du métier et des autres loisirs.
const SQUASHED_CRAFT = /crochet|knit|tricot|strick|häkel|hækl|hekl|virk|neul|brei|haak|ganchill|uncinett|szydeł|drut/iu
// Radicaux assez longs pour ne pas se lire dans un mot recollé du métier (« Butterbloomflower »
// contient « loom », « seam the sides » se dit en tricot).
const SQUASHED_CONTRA = /sewing|seamallowance|embroider|crossstitch|macram|weaving|heddle|couture|coudre|broderie|nähen|nahtzugabe|tissage/iu
const isSpacedLine = (t) => {
  const tokens = t.trim().split(/\s+/)
  return tokens.length >= SPACED_MIN_TOKENS && tokens.filter((x) => x.length === 1).length / tokens.length >= SPACED_TOKEN_RATIO
}
function illegibleText(text) {
  let all = 0
  let spaced = 0
  let squashed = ''
  for (const line of text.split('\n')) {
    all += line.length
    if (isSpacedLine(line)) {
      spaced += line.length
      squashed += line.replace(/\s+/g, '') + '\n'
    }
  }
  return (
    all > 0 && spaced >= ILLEGIBLE_MIN_CHARS && spaced / all >= ILLEGIBLE_RATIO &&
    SQUASHED_CRAFT.test(squashed) && !SQUASHED_CONTRA.test(squashed)
  )
}

// Page de cotes : presque pas de texte courant, surtout des nombres (tableau de mesures par
// taille, Modèles tricot/Ivy_Sweater_Schematics.pdf, décision de la propriétaire du
// 2026-09-24 : jamais refusé). Rien à lire, le détecteur s'abstient, sauf terme contraire.
// Relevé 2026-09-24, mot = 3 lettres ou plus, nombre = chiffres et fractions : Ivy 31 mots
// pour 102 nombres (×3,3) ; les négatifs hors recueils les plus courts, communiqué INSEE 34
// mots / 7 nombres, factures 48 / 0 et 65 / 20 (×0,31 au plus) ; tout autre négatif a plus de
// 130 mots. Positifs : aucun autre sous 60 mots avec deux fois plus de nombres.
export const TABULAR_MAX_WORDS = 60
export const TABULAR_NUMBERS_PER_WORD = 2
// Et un vrai tableau : au moins 40 nombres (Ivy 102 ; un titre « C A T A L O G U E 2 0 2 6 » 4).
export const TABULAR_MIN_NUMBERS = 40
function tabularText(text) {
  const tokens = text.split(/\s+/).filter(Boolean)
  const words = tokens.filter((x) => /^\p{L}{3,}[.,:;!?)]*$/u.test(x)).length
  const numbers = tokens.filter((x) => /^\(?[\d¼½¾.,/%-]+\)?$/u.test(x)).length
  return words < TABULAR_MAX_WORDS && numbers >= TABULAR_MIN_NUMBERS && numbers >= TABULAR_NUMBERS_PER_WORD * words
}

// Patron en vidéo : aucune consigne écrite, la consigne est un lien. Il faut les trois : un
// marqueur de matériel, un renvoi à une vidéo, et un verbe du métier à l'impératif ou à la
// 2e personne. Formes relevées dans les deux seuls positifs qui en dépendent (Hobbii « Trio
// Crochet Top » : fr « crochetez un haut », fi « virkkaa toppi ») ; aucune forme écrite de tête.
// Un catalogue (matériel, échantillon, « laine à tricoter ») n'a ni renvoi ni impératif.
const VIDEO_REF = rx(String.raw`vid[ée]o|youtube|youtu\.be`)
const VIDEO_VERB = rx(String.raw`crochetez|virkkaa`)

export function detectCraft(pages) {
  const text = pagesText(pages)
  const hits = CRAFT_MARKERS.filter((m) => m.re.test(text))
  const contraHits = CONTRA_MARKERS.filter((m) => m.re.test(text))
  const score = hits.reduce((a, m) => a + m.w, 0)
  const contra = contraHits.reduce((a, m) => a + m.w, 0)
  const instr = hits.some((m) => m.kind === 'instr')
  const video = !instr && hits.some((m) => m.kind === 'mat') && VIDEO_REF.test(text) && VIDEO_VERB.test(text)
  const illegible = illegibleText(text)
  const tabular = !illegible && contra === 0 && tabularText(text)
  let reason = null
  if (illegible || tabular) {
    // abstention : aucun verdict sur un texte illisible ou sans texte courant
  } else if (contra > 0 && contra >= score + OTHER_CRAFT_MARGIN) reason = 'otherCraft'
  else if (score < CRAFT_MIN_SCORE || !(instr || video)) reason = contra > 0 ? 'otherCraft' : 'noCraftVocabulary'
  return {
    isPattern: reason === null,
    reason,
    score,
    contra,
    instr,
    video,
    illegible,
    tabular,
    markers: hits.map((m) => m.id),
    contraMarkers: contraHits.map((m) => m.id),
  }
}

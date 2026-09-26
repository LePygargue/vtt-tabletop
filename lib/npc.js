'use strict';
/**
 * Fiches PNJ rapides : une par jeton PNJ, MJ uniquement (jamais envoyées aux joueurs).
 * Volontairement minimales (quelques valeurs + texte libre), décrites par le schéma
 * `npcSheet` du jeu du salon (lib/games).
 */
const { flattenFields, applySimpleField } = require('./sheets');

function defaultNpcSheet(game) {
  const s = {};
  for (const f of flattenFields(game.npcSheet.fields)) {
    if (f.type === 'number') s[f.key] = f.default ?? 0;
    else if (f.type === 'text' || f.type === 'multiline') s[f.key] = f.fallback || '';
  }
  return s;
}

/** Fusionne et valide un patch partiel dans une fiche PNJ existante, en place. */
function applyNpcPatch(game, sheet, patch) {
  if (!patch || typeof patch !== 'object') return;
  for (const f of flattenFields(game.npcSheet.fields)) applySimpleField(sheet, f, patch);
}

module.exports = { defaultNpcSheet, applyNpcPatch };

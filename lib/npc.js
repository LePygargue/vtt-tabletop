'use strict';
/**
 * Fiches PNJ rapides : une par jeton PNJ, MJ uniquement (jamais envoyées aux joueurs).
 * Volontairement minimal (PV + texte libre) contrairement à la fiche joueur complète.
 */
const { clampInt, cleanMultiline } = require('./util');

function defaultNpcSheet() {
  return { hp: 0, hpMax: 10, willpower: 0, willpowerMax: 3, defense: 0, traits: '', notes: '' };
}

/** Fusionne et valide un patch partiel dans une fiche PNJ existante, en place. */
function applyNpcPatch(sheet, patch) {
  if (!patch || typeof patch !== 'object') return;
  if ('hp' in patch) sheet.hp = clampInt(patch.hp, 0, 999, sheet.hp);
  if ('hpMax' in patch) sheet.hpMax = clampInt(patch.hpMax, 1, 999, sheet.hpMax);
  if ('willpower' in patch) sheet.willpower = clampInt(patch.willpower, 0, 20, sheet.willpower);
  if ('willpowerMax' in patch) sheet.willpowerMax = clampInt(patch.willpowerMax, 1, 20, sheet.willpowerMax);
  if ('defense' in patch) sheet.defense = clampInt(patch.defense, 0, 20, sheet.defense);
  if ('traits' in patch) sheet.traits = cleanMultiline(patch.traits, 500);
  if ('notes' in patch) sheet.notes = cleanMultiline(patch.notes, 500);
}

module.exports = { defaultNpcSheet, applyNpcPatch };

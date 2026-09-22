'use strict';
/**
 * Fiches PNJ rapides : une par jeton PNJ, MJ uniquement (jamais envoyées aux joueurs).
 * Volontairement minimal (PV + texte libre) contrairement à la fiche joueur complète.
 */
function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}
const cleanMultiline = (s, max) => String(s == null ? '' : s)
  .replace(/\r\n/g, '\n')
  .replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f<>]/g, '')
  .trim()
  .slice(0, max);

function defaultNpcSheet() {
  return { hp: 0, hpMax: 10, traits: '', notes: '' };
}

/** Fusionne et valide un patch partiel dans une fiche PNJ existante, en place. */
function applyNpcPatch(sheet, patch) {
  if (!patch || typeof patch !== 'object') return;
  if ('hp' in patch) sheet.hp = clampInt(patch.hp, 0, 999, sheet.hp);
  if ('hpMax' in patch) sheet.hpMax = clampInt(patch.hpMax, 1, 999, sheet.hpMax);
  if ('traits' in patch) sheet.traits = cleanMultiline(patch.traits, 500);
  if ('notes' in patch) sheet.notes = cleanMultiline(patch.notes, 500);
}

module.exports = { defaultNpcSheet, applyNpcPatch };

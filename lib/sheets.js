'use strict';
/**
 * Fiches de personnage (tronc commun Chronicles of Darkness : attributs,
 * compétences + spécialité, Santé/Volonté, quelques champs libres).
 * Une fiche par joueur et par salon, comme les jetons.
 */
const ATTRIBUTES = ['force', 'dexterite', 'vigueur', 'charisme', 'manipulation', 'sangFroid', 'intelligence', 'astuce', 'resolution'];

const SKILLS = [
  ['athletisme', 'physical'], ['bagarre', 'physical'], ['artisanat', 'physical'], ['conduite', 'physical'],
  ['armeAFeu', 'physical'], ['larcin', 'physical'], ['melee', 'physical'], ['furtivite', 'physical'], ['survie', 'physical'],
  ['animaux', 'social'], ['etiquette', 'social'], ['empathie', 'social'], ['intimidation', 'social'],
  ['commandement', 'social'], ['representation', 'social'], ['persuasion', 'social'], ['rue', 'social'], ['subterfuge', 'social'],
  ['erudition', 'mental'], ['vigilance', 'mental'], ['finances', 'mental'], ['investigation', 'mental'],
  ['medecine', 'mental'], ['occultisme', 'mental'], ['politique', 'mental'], ['sciences', 'mental'], ['technologie', 'mental'],
];
const SKILL_KEYS = SKILLS.map(([key]) => key);

const { clampInt, cleanText, cleanMultiline } = require('./util');

/** Case d'un tracker de dégâts : '' vide, 's' superficiel, 'a' aggravé. */
const DAMAGE_STATES = new Set(['', 's', 'a']);
function cleanDamageTrack(arr, max) {
  if (!Array.isArray(arr)) return null;
  return arr.slice(0, Math.max(0, max)).map((v) => (DAMAGE_STATES.has(v) ? v : ''));
}

function defaultSheet() {
  const attributes = {};
  for (const a of ATTRIBUTES) attributes[a] = 1;
  const skills = {};
  for (const key of SKILL_KEYS) skills[key] = { rating: 0, specialty: '' };
  return {
    concept: '', virtue: '', vice: '', merits: '', notes: '',
    healthMax: 0, health: [], willpowerMax: 0, willpower: [],
    hunger: 0, hungerMax: 5, hungerLabel: 'Faim',
    morality: 7, moralityMax: 10, moralityLabel: 'Humanité',
    powers: '', powersLabel: 'Disciplines / Dons / Atouts',
    attributes,
    skills,
  };
}

/** Fusionne et valide un patch partiel dans une fiche existante, en place. */
function applySheetPatch(sheet, patch) {
  if (!patch || typeof patch !== 'object') return;
  // Auto-réparation des fiches sauvegardées avant l'introduction du suivi Superficiel/Aggravé
  // (où health/willpower étaient un simple nombre de cases, toutes pleines).
  if (typeof sheet.health === 'number') { sheet.healthMax = sheet.health; sheet.health = []; }
  if (typeof sheet.willpower === 'number') { sheet.willpowerMax = sheet.willpower; sheet.willpower = []; }
  // Fiches antérieures à l'ajout d'un attribut ou d'une compétence : on complète.
  sheet.attributes = sheet.attributes || {};
  sheet.skills = sheet.skills || {};
  if (patch.attributes && typeof patch.attributes === 'object') {
    for (const key of ATTRIBUTES) {
      if (key in patch.attributes) sheet.attributes[key] = clampInt(patch.attributes[key], 1, 5, sheet.attributes[key] ?? 1);
    }
  }
  if (patch.skills && typeof patch.skills === 'object') {
    for (const key of SKILL_KEYS) {
      const p = patch.skills[key];
      if (!p || typeof p !== 'object') continue;
      const cur = sheet.skills[key] || (sheet.skills[key] = { rating: 0, specialty: '' });
      if ('rating' in p) cur.rating = clampInt(p.rating, 0, 5, cur.rating);
      if ('specialty' in p) cur.specialty = cleanText(p.specialty, 40);
    }
  }
  if ('healthMax' in patch) sheet.healthMax = clampInt(patch.healthMax, 0, 20, sheet.healthMax);
  if ('health' in patch) {
    const cleaned = cleanDamageTrack(patch.health, sheet.healthMax);
    if (cleaned) sheet.health = cleaned;
  }
  if ('willpowerMax' in patch) sheet.willpowerMax = clampInt(patch.willpowerMax, 0, 20, sheet.willpowerMax);
  if ('willpower' in patch) {
    const cleaned = cleanDamageTrack(patch.willpower, sheet.willpowerMax);
    if (cleaned) sheet.willpower = cleaned;
  }
  if ('hunger' in patch) sheet.hunger = clampInt(patch.hunger, 0, 10, sheet.hunger);
  if ('hungerMax' in patch) sheet.hungerMax = clampInt(patch.hungerMax, 1, 10, sheet.hungerMax);
  if ('hungerLabel' in patch) sheet.hungerLabel = cleanText(patch.hungerLabel, 30) || 'Faim';
  if ('morality' in patch) sheet.morality = clampInt(patch.morality, 0, 10, sheet.morality);
  if ('moralityMax' in patch) sheet.moralityMax = clampInt(patch.moralityMax, 1, 10, sheet.moralityMax);
  if ('moralityLabel' in patch) sheet.moralityLabel = cleanText(patch.moralityLabel, 30) || 'Humanité';
  if ('powers' in patch) sheet.powers = cleanMultiline(patch.powers, 1000);
  if ('powersLabel' in patch) sheet.powersLabel = cleanText(patch.powersLabel, 40) || 'Disciplines / Dons / Atouts';
  if ('concept' in patch) sheet.concept = cleanText(patch.concept, 60);
  if ('virtue' in patch) sheet.virtue = cleanText(patch.virtue, 40);
  if ('vice' in patch) sheet.vice = cleanText(patch.vice, 40);
  if ('merits' in patch) sheet.merits = cleanMultiline(patch.merits, 500);
  if ('notes' in patch) sheet.notes = cleanMultiline(patch.notes, 2000);
}

/**
 * Reshape un tracker de dégâts pour l'envoi client, en tolérant les fiches
 * sauvegardées avant le suivi Superficiel/Aggravé (un simple nombre de cases,
 * repris ici comme `max` avec un tracker vide, non endommagé).
 */
function pubDamage(sheet, key, maxKey) {
  let max = sheet[maxKey];
  let track = sheet[key];
  if (!Number.isFinite(max) && typeof track === 'number') {
    max = track;
    track = [];
  }
  max = Number.isFinite(max) ? max : 0;
  return { max, track: (Array.isArray(track) ? track : []).slice(0, max) };
}

/** Rien de secret à masquer pour l'instant ; reshape explicite pour cohérence avec pub()/pubStroke(). */
function pubSheet(s) {
  const skills = {};
  for (const key of SKILL_KEYS) {
    const sk = (s.skills && s.skills[key]) || {};
    skills[key] = { rating: sk.rating || 0, specialty: sk.specialty || '' };
  }
  const attributes = {};
  for (const key of ATTRIBUTES) attributes[key] = (s.attributes && s.attributes[key]) || 1;
  const hp = pubDamage(s, 'health', 'healthMax');
  const wp = pubDamage(s, 'willpower', 'willpowerMax');
  return {
    concept: s.concept, virtue: s.virtue, vice: s.vice, merits: s.merits, notes: s.notes,
    healthMax: hp.max, health: hp.track,
    willpowerMax: wp.max, willpower: wp.track,
    hunger: s.hunger ?? 0, hungerMax: s.hungerMax ?? 5, hungerLabel: s.hungerLabel || 'Faim',
    morality: s.morality ?? 7, moralityMax: s.moralityMax ?? 10, moralityLabel: s.moralityLabel || 'Humanité',
    powers: s.powers || '', powersLabel: s.powersLabel || 'Disciplines / Dons / Atouts',
    attributes,
    skills,
  };
}

module.exports = { ATTRIBUTES, SKILLS, SKILL_KEYS, defaultSheet, applySheetPatch, pubSheet };

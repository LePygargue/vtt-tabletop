'use strict';
/**
 * Fiches de personnage pilotées par le schéma du jeu du salon (lib/games) :
 * valeurs par défaut, validation des patchs, projection pour les clients.
 * Une fiche par joueur et par salon, comme les jetons.
 *
 * Types de champs : text, multiline, number, counter (valeur / max, libellé
 * éventuellement modifiable), track (cases vide/superficiel/aggravé), group
 * (attributs, compétences… : un objet par entrée, voir ITEM_TYPES).
 */
const { clampInt, cleanText, cleanMultiline } = require('./util');

/** Aplatit une liste de champs (un sous-tableau = une rangée de champs dans l'interface). */
function flattenFields(fields) {
  const out = [];
  for (const f of fields || []) {
    if (Array.isArray(f)) out.push(...flattenFields(f));
    else if (f && f.key) out.push(f);
  }
  return out;
}
/** Champs d'une fiche : les pistes de dégâts en dernier (elles dépendent de leur champ max). */
function sheetFields(schema) {
  const all = flattenFields((schema.sections || []).flatMap((s) => s.fields));
  return [...all.filter((f) => f.type !== 'track'), ...all.filter((f) => f.type === 'track')];
}
/** Entrées d'un groupe : [{ key, label, ...extra }]. */
function groupItems(f) {
  return (f.columns || []).flatMap((c) => c.items.map(([key, label, extra]) => ({ key, label, ...(extra || {}) })));
}

/** Case d'un tracker de dégâts : '' vide, 's' superficiel, 'a' aggravé. */
const DAMAGE_STATES = new Set(['', 's', 'a']);
function cleanDamageTrack(arr, max) {
  if (!Array.isArray(arr)) return null;
  return arr.slice(0, Math.max(0, max)).map((v) => (DAMAGE_STATES.has(v) ? v : ''));
}

/** Types d'entrée de groupe : défaut, application d'un patch, projection. */
const ITEM_TYPES = {
  rating: {
    init: (item, e) => e.default ?? item.default ?? 0,
    apply: (item, cur, p) => clampInt(p, item.min, item.max, cur),
    pub: (item, e, v) => (Number.isFinite(v) ? v : e.default ?? item.default ?? 0),
  },
  percent: {
    init: (item, e) => e.default ?? item.default ?? 0,
    apply: (item, cur, p) => clampInt(p, item.min ?? 0, item.max ?? 99, cur),
    pub: (item, e, v) => (Number.isFinite(v) ? v : e.default ?? item.default ?? 0),
  },
  skill: {
    init: (item, e) => ({ rating: e.default ?? item.default ?? 0, specialty: '' }),
    apply: (item, cur, p) => {
      if (!p || typeof p !== 'object') return cur;
      const next = { ...cur };
      if ('rating' in p) next.rating = clampInt(p.rating, item.min, item.max, cur.rating);
      if ('specialty' in p) next.specialty = cleanText(p.specialty, 40);
      return next;
    },
    pub: (item, e, v) => ({ rating: (v && v.rating) || 0, specialty: (v && v.specialty) || '' }),
  },
  proficiency: {
    init: (item, e) => ({ rank: e.default ?? 0, bonus: 0 }),
    apply: (item, cur, p) => {
      if (!p || typeof p !== 'object') return cur;
      const next = { ...cur };
      if ('rank' in p) next.rank = clampInt(p.rank, 0, item.ranks.length - 1, cur.rank);
      if ('bonus' in p) next.bonus = clampInt(p.bonus, -20, 20, cur.bonus);
      return next;
    },
    pub: (item, e, v) => ({ rank: (v && v.rank) || 0, bonus: (v && v.bonus) || 0 }),
  },
};

function defaultSheet(game) {
  const s = {};
  for (const f of sheetFields(game.sheet)) {
    switch (f.type) {
      case 'text': case 'multiline': s[f.key] = f.fallback || ''; break;
      case 'number': s[f.key] = f.default ?? 0; break;
      case 'counter':
        s[f.key] = f.default ?? 0;
        if (f.maxKey) s[f.maxKey] = f.defaultMax ?? f.maxMax;
        if (f.labelKey) s[f.labelKey] = f.label;
        break;
      case 'track': s[f.key] = []; break;
      case 'group': {
        const t = ITEM_TYPES[f.item.type];
        s[f.key] = {};
        for (const e of groupItems(f)) s[f.key][e.key] = t.init(f.item, e);
        break;
      }
    }
  }
  return s;
}

/** Valide et applique un champ simple (text, multiline, number) ; commun aux fiches PNJ. */
function applySimpleField(sheet, f, patch) {
  if (!(f.key in patch)) return;
  const v = patch[f.key];
  if (f.type === 'text') sheet[f.key] = cleanText(v, f.max || 60) || f.fallback || '';
  else if (f.type === 'multiline') sheet[f.key] = cleanMultiline(v, f.max || 500);
  else if (f.type === 'number') sheet[f.key] = clampInt(v, f.min, f.max, sheet[f.key] ?? f.default ?? 0);
}

/** Fusionne et valide un patch partiel dans une fiche existante, en place. */
function applySheetPatch(game, sheet, patch) {
  if (!patch || typeof patch !== 'object') return;
  const fields = sheetFields(game.sheet);
  for (const f of fields) {
    // Auto-réparation des fiches sauvegardées avant l'introduction du suivi Superficiel/Aggravé
    // (où le tracker était un simple nombre de cases, toutes pleines).
    if (f.type === 'track' && typeof sheet[f.key] === 'number') { sheet[f.maxKey] = sheet[f.key]; sheet[f.key] = []; }
  }
  for (const f of fields) {
    switch (f.type) {
      case 'text': case 'multiline': case 'number':
        applySimpleField(sheet, f, patch);
        break;
      case 'counter':
        if (f.key in patch) sheet[f.key] = clampInt(patch[f.key], f.min ?? 0, f.max, sheet[f.key] ?? f.default ?? 0);
        if (f.maxKey && f.maxKey in patch) sheet[f.maxKey] = clampInt(patch[f.maxKey], f.maxMin ?? 1, f.maxMax, sheet[f.maxKey] ?? f.defaultMax);
        if (f.labelKey && f.labelKey in patch) sheet[f.labelKey] = cleanText(patch[f.labelKey], 30) || f.label;
        break;
      case 'track':
        if (f.key in patch) {
          const cleaned = cleanDamageTrack(patch[f.key], sheet[f.maxKey]);
          if (cleaned) sheet[f.key] = cleaned;
        }
        break;
      case 'group': {
        // Fiches antérieures à l'ajout d'une entrée : on complète.
        const group = sheet[f.key] && typeof sheet[f.key] === 'object' ? sheet[f.key] : (sheet[f.key] = {});
        const p = patch[f.key];
        if (!p || typeof p !== 'object') break;
        const t = ITEM_TYPES[f.item.type];
        for (const e of groupItems(f)) {
          if (!(e.key in p)) continue;
          const cur = e.key in group ? t.pub(f.item, e, group[e.key]) : t.init(f.item, e);
          group[e.key] = t.apply(f.item, cur, p[e.key]);
        }
        break;
      }
    }
  }
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

/** Projection explicite d'une fiche pour les clients : uniquement les champs du schéma, valeurs par défaut comprises. */
function pubSheet(game, s) {
  const out = {};
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  for (const f of sheetFields(game.sheet)) {
    switch (f.type) {
      case 'text': out[f.key] = s[f.key] || f.fallback || ''; break;
      case 'multiline': out[f.key] = s[f.key] || ''; break;
      case 'number': out[f.key] = num(s[f.key], f.default ?? 0); break;
      case 'counter':
        out[f.key] = num(s[f.key], f.default ?? 0);
        if (f.maxKey) out[f.maxKey] = num(s[f.maxKey], f.defaultMax ?? f.maxMax);
        if (f.labelKey) out[f.labelKey] = s[f.labelKey] || f.label;
        break;
      case 'track': {
        const d = pubDamage(s, f.key, f.maxKey);
        out[f.maxKey] = d.max;
        out[f.key] = d.track;
        break;
      }
      case 'group': {
        const t = ITEM_TYPES[f.item.type];
        const src = s[f.key] || {};
        out[f.key] = {};
        for (const e of groupItems(f)) out[f.key][e.key] = t.pub(f.item, e, src[e.key]);
        break;
      }
    }
  }
  return out;
}

module.exports = { flattenFields, applySimpleField, defaultSheet, applySheetPatch, pubSheet };

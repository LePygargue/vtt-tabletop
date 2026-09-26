'use strict';
/**
 * Pathfinder 2e (Remaster) : modificateurs d'attributs, rangs de maîtrise
 * (bonus = niveau + 2 × rang dès Qualifié), test d20 contre un DD à quatre
 * degrés de réussite (±10, et 20/1 naturels qui décalent d'un cran).
 */
const { clampInt } = require('../util');
const { parseDiceExpr, rollExpr } = require('../dice');

const RANKS = ['Inexpérimenté', 'Qualifié', 'Expert', 'Maître', 'Légendaire'];
const DEGREES = [
  { tier: 'critFailure', label: 'Échec critique', tone: 'botch' },
  { tier: 'failure', label: 'Échec', tone: 'fail' },
  { tier: 'success', label: 'Succès', tone: 'ok' },
  { tier: 'critSuccess', label: 'Succès critique', tone: 'crit' },
];

const prof = (attr) => ({ attr });

const sheet = {
  quick: ['hp', 'heroPoints'],
  help: {
    summary: 'Aide-mémoire (maîtrise et degrés de réussite)',
    tables: [
      {
        caption: 'Bonus de maîtrise (ajouté au modificateur d\'attribut)',
        head: ['Inexpérimenté', 'Qualifié', 'Expert', 'Maître', 'Légendaire'],
        rows: [['+0', 'niveau + 2', 'niveau + 4', 'niveau + 6', 'niveau + 8']],
      },
      {
        caption: 'Degrés de réussite (20 naturel : un cran de mieux, 1 naturel : un cran de moins)',
        head: ['Résultat', 'Degré'],
        rows: [['≥ DD + 10', 'Succès critique'], ['≥ DD', 'Succès'], ['< DD', 'Échec'], ['≤ DD − 10', 'Échec critique']],
      },
    ],
  },
  sections: [
    {
      fields: [
        [
          { type: 'text', key: 'ancestry', label: 'Ascendance', max: 40 },
          { type: 'text', key: 'heritage', label: 'Héritage', max: 40 },
          { type: 'text', key: 'background', label: 'Historique', max: 40 },
        ],
        [
          { type: 'text', key: 'class', label: 'Classe', max: 40 },
          { type: 'number', key: 'level', label: 'Niveau', min: 1, max: 20, default: 1 },
          { type: 'text', key: 'deity', label: 'Divinité', max: 40 },
        ],
      ],
    },
    {
      title: 'Défenses',
      fields: [
        { type: 'counter', key: 'hp', maxKey: 'hpMax', label: 'Points de vie', quickLabel: 'PV', min: 0, max: 999, maxMin: 1, maxMax: 999, default: 10, defaultMax: 10 },
        [
          { type: 'number', key: 'tempHp', label: 'PV temporaires', min: 0, max: 999, default: 0 },
          { type: 'number', key: 'ac', label: 'Classe d\'armure', min: 0, max: 60, default: 10 },
          { type: 'number', key: 'speed', label: 'Vitesse (m)', min: 0, max: 60, default: 7 },
        ],
        { type: 'counter', key: 'heroPoints', label: 'Points d\'héroïsme', quickLabel: 'Héroïsme', min: 0, max: 3, default: 1, fixedMax: 3, display: 'boxes' },
      ],
    },
    {
      title: 'Attributs (modificateurs)',
      fields: [{
        type: 'group', key: 'attributes', item: { type: 'rating', min: -5, max: 7, default: 0, signed: true },
        columns: [
          { title: 'Physiques', items: [['for', 'Force'], ['dex', 'Dextérité'], ['con', 'Constitution']] },
          { title: 'Mentaux', items: [['int', 'Intelligence'], ['sag', 'Sagesse'], ['cha', 'Charisme']] },
        ],
      }],
    },
    {
      title: 'Perception et jets de sauvegarde',
      fields: [{
        type: 'group', key: 'saves', item: { type: 'proficiency', ranks: RANKS, attrGroup: 'attributes', levelKey: 'level' },
        columns: [
          { title: '', items: [['perception', 'Perception', prof('sag')], ['vigueur', 'Vigueur', prof('con')]] },
          { title: '', items: [['reflexes', 'Réflexes', prof('dex')], ['volonte', 'Volonté', prof('sag')]] },
        ],
      }],
    },
    {
      title: 'Compétences',
      fields: [{
        type: 'group', key: 'skills', item: { type: 'proficiency', ranks: RANKS, attrGroup: 'attributes', levelKey: 'level' },
        columns: [
          { title: '', items: [
            ['acrobaties', 'Acrobaties', prof('dex')], ['arcanes', 'Arcanes', prof('int')], ['artisanat', 'Artisanat', prof('int')],
            ['athletisme', 'Athlétisme', prof('for')], ['diplomatie', 'Diplomatie', prof('cha')], ['discretion', 'Discrétion', prof('dex')],
          ] },
          { title: '', items: [
            ['duperie', 'Duperie', prof('cha')], ['intimidation', 'Intimidation', prof('cha')], ['medecine', 'Médecine', prof('sag')],
            ['nature', 'Nature', prof('sag')], ['occultisme', 'Occultisme', prof('int')], ['religion', 'Religion', prof('sag')],
          ] },
          { title: '', items: [
            ['representation', 'Représentation', prof('cha')], ['societe', 'Société', prof('int')], ['survie', 'Survie', prof('sag')],
            ['vol', 'Vol', prof('dex')], ['connaissance1', 'Connaissance (1)', prof('int')], ['connaissance2', 'Connaissance (2)', prof('int')],
          ] },
        ],
      }],
      hint: 'Total = modificateur d\'attribut + maîtrise (niveau + 2 × rang dès Qualifié) + bonus divers (objet, circonstance…).',
    },
    {
      title: 'Attaques',
      fields: [{ type: 'multiline', key: 'attacks', max: 1000, rows: 3, placeholder: 'Épée longue +7 (polyvalent P), 1d8+4 tranchants…' }],
    },
    {
      title: 'Dons et capacités',
      fields: [{ type: 'multiline', key: 'feats', max: 2000, rows: 4, placeholder: 'Dons d\'ascendance, de classe, de compétence, généraux ; capacités de classe…' }],
    },
    {
      title: 'Sorts',
      fields: [{ type: 'multiline', key: 'spells', max: 2000, rows: 3, placeholder: 'Tradition, DD et modificateur d\'attaque des sorts, emplacements, tours de magie…' }],
    },
    {
      title: 'Équipement',
      fields: [{ type: 'multiline', key: 'equipment', max: 1500, rows: 3, placeholder: 'Armes, armure, objets, pièces…' }],
    },
    {
      title: 'Notes',
      fields: [{ type: 'multiline', key: 'notes', max: 2000, rows: 4, placeholder: 'Historique, langues, alliés…' }],
    },
  ],
};

const npcSheet = {
  fields: [
    [
      { type: 'number', key: 'hp', label: 'PV', min: 0, max: 9999, default: 20 },
      { type: 'number', key: 'hpMax', label: 'PV max', min: 1, max: 9999, default: 20 },
      { type: 'number', key: 'ac', label: 'CA', min: 0, max: 60, default: 15 },
    ],
    [
      { type: 'number', key: 'fort', label: 'Vig', min: -10, max: 50, default: 5 },
      { type: 'number', key: 'ref', label: 'Réf', min: -10, max: 50, default: 5 },
      { type: 'number', key: 'will', label: 'Vol', min: -10, max: 50, default: 5 },
    ],
    [
      { type: 'number', key: 'perception', label: 'Perception', min: -10, max: 50, default: 5 },
      { type: 'number', key: 'level', label: 'Niveau', min: -1, max: 25, default: 1 },
    ],
    { type: 'multiline', key: 'traits', label: 'Attaques et capacités', max: 800, rows: 3 },
    { type: 'multiline', key: 'notes', label: 'Notes', max: 500, rows: 3 },
  ],
};

const checks = [
  {
    id: 'd20',
    title: 'Test (d20)',
    fields: [
      { key: 'modifier', label: 'Modificateur', min: -30, max: 60, default: 0, tip: 'Modificateur total du test (attribut + maîtrise + bonus/malus).' },
      { key: 'dc', label: 'DD', min: 1, max: 60, default: 15, tip: 'Degré de difficulté. Succès critique à DD + 10, échec critique à DD − 10 ; un 20 naturel améliore le résultat d\'un cran, un 1 naturel le dégrade d\'un cran.' },
    ],
  },
];

/** Degré de réussite (0 échec critique … 3 succès critique) d'un test d20. */
function degreeOf(natural, total, dc) {
  let d = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (natural === 20) d = Math.min(3, d + 1);
  else if (natural === 1) d = Math.max(0, d - 1);
  return d;
}

function resolveCheck(check, { rng }) {
  if (check.id !== 'd20') return null;
  const modifier = clampInt(check.modifier, -30, 60, 0);
  const dc = clampInt(check.dc, 1, 60, 15);
  const expr = '1d20' + (modifier > 0 ? '+' + modifier : modifier < 0 ? String(modifier) : '');
  const { total, parts } = rollExpr(parseDiceExpr(expr), rng);
  const natural = parts[0].values[0];
  const degree = DEGREES[degreeOf(natural, total, dc)];
  return {
    expr, parts, total,
    target: dc,
    targetLabel: 'DD',
    tier: degree.tier,
    tierLabel: degree.label,
    tone: degree.tone,
  };
}

module.exports = {
  id: 'pf2e',
  label: 'Pathfinder 2e',
  theme: 'pf2e',
  tagline: 'Fantasy héroïque : donjons, sortilèges et aventuriers légendaires.',
  dice: {},
  initiative: { die: '1d20', tip: 'Score exact (bouton +) ou modificateur de Perception ajouté au d20 (bouton dé)' },
  sheet,
  npcSheet,
  gauges: [],
  checks,
  resolveCheck,
  degreeOf,
};

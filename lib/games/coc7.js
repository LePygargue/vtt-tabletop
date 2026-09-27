'use strict';
/**
 * L'Appel de Cthulhu 7e : caractéristiques et compétences en pourcentage,
 * test d100 sous la valeur (Ordinaire, Majeure ≤ ½, Extrême ≤ ⅕, critique sur 01,
 * maladresse sur 100 ou 96-100 si la valeur est inférieure à 50), dés bonus/malus.
 */
const { clampInt } = require('../util');
const { rollPercentile } = require('../dice');

const TIERS = {
  fumble: { rank: 0, label: 'Maladresse', tone: 'botch' },
  failure: { rank: 1, label: 'Échec', tone: 'fail' },
  regular: { rank: 2, label: 'Réussite ordinaire', tone: 'ok' },
  hard: { rank: 3, label: 'Réussite majeure', tone: 'ok' },
  extreme: { rank: 4, label: 'Réussite extrême', tone: 'ok' },
  critical: { rank: 5, label: 'Réussite critique', tone: 'crit' },
};
const REQUIRED = { regular: 'Ordinaire', hard: 'Majeure', extreme: 'Extrême' };

const pct = (d) => ({ default: d });

const sheet = {
  quick: ['hp', 'san', 'mp', 'luck'],
  // Effets visuels chez le joueur quand sa SAN tombe sous sa SAN de départ (= POU) : voir updateMindFx
  mindFx: { key: 'san', ref: 'characteristics.pou' },
  help: {
    summary: 'Aide-mémoire (niveaux de réussite et création)',
    tables: [
      {
        caption: 'Niveaux de réussite (d100 sous la valeur)',
        head: ['Résultat', 'Niveau'],
        rows: [['01', 'Critique'], ['≤ ⅕', 'Extrême'], ['≤ ½', 'Majeure'], ['≤ valeur', 'Ordinaire'], ['> valeur', 'Échec'], ['100 (96-100 si valeur < 50)', 'Maladresse']],
      },
      {
        caption: 'Valeurs dérivées',
        head: ['Trait', 'Calcul'],
        rows: [['PV', '(CON + TAI) / 10'], ['SAN de départ', 'POU'], ['PM', 'POU / 5'], ['Esquive', 'DEX / 2'], ['Langue maternelle', 'ÉDU']],
      },
    ],
  },
  sections: [
    {
      fields: [
        [
          { type: 'text', key: 'occupation', label: 'Occupation', max: 40 },
          { type: 'number', key: 'age', label: 'Âge', min: 0, max: 120, default: 30 },
          { type: 'text', key: 'residence', label: 'Résidence', max: 40 },
        ],
        [
          { type: 'text', key: 'birthplace', label: 'Lieu de naissance', max: 40 },
          { type: 'text', key: 'pronouns', label: 'Sexe / pronoms', max: 30 },
        ],
      ],
    },
    {
      title: 'Caractéristiques',
      fields: [{
        type: 'group', key: 'characteristics', item: { type: 'percent', min: 0, max: 99, default: 50 },
        columns: [
          { title: '', items: [['for', 'FOR'], ['con', 'CON'], ['tai', 'TAI']] },
          { title: '', items: [['dex', 'DEX'], ['app', 'APP'], ['int', 'INT']] },
          { title: '', items: [['pou', 'POU'], ['edu', 'ÉDU']] },
        ],
      }],
    },
    {
      title: 'Jauges',
      fields: [
        { type: 'counter', key: 'hp', maxKey: 'hpMax', label: 'Points de vie', quickLabel: 'PV', min: 0, max: 99, maxMin: 1, maxMax: 99, default: 10, defaultMax: 10 },
        { type: 'counter', key: 'san', maxKey: 'sanMax', label: 'Santé mentale', quickLabel: 'SAN', min: 0, max: 99, maxMin: 1, maxMax: 99, default: 50, defaultMax: 99 },
        { type: 'counter', key: 'mp', maxKey: 'mpMax', label: 'Points de magie', quickLabel: 'PM', min: 0, max: 99, maxMin: 0, maxMax: 99, default: 10, defaultMax: 10 },
        { type: 'counter', key: 'luck', label: 'Chance', min: 0, max: 99, default: 50, fixedMax: 99 },
        [
          { type: 'number', key: 'move', label: 'Mouvement', min: 0, max: 20, default: 8 },
          { type: 'text', key: 'damageBonus', label: 'Impact', max: 10, fallback: '0' },
          { type: 'number', key: 'build', label: 'Carrure', min: -2, max: 10, default: 0 },
        ],
        { type: 'text', key: 'conditions', label: 'États (blessure grave, folie temporaire / persistante…)', max: 120, wide: true },
      ],
    },
    {
      title: 'Compétences',
      fields: [{
        type: 'group', key: 'skills', item: { type: 'percent', min: 0, max: 99, default: 0 },
        columns: [
          { title: '', items: [
            ['anthropologie', 'Anthropologie', pct(1)], ['archeologie', 'Archéologie', pct(1)], ['armesPoing', 'Armes à feu (poing)', pct(20)],
            ['armesEpaule', 'Armes à feu (fusil)', pct(25)], ['artsMetiers', 'Arts et métiers', pct(5)], ['baratin', 'Baratin', pct(5)],
            ['bibliotheque', 'Bibliothèque', pct(20)], ['charme', 'Charme', pct(15)], ['combat', 'Combat rapproché', pct(25)],
            ['comptabilite', 'Comptabilité', pct(5)], ['conduite', 'Conduite', pct(20)], ['credit', 'Crédit', pct(0)],
            ['crochetage', 'Crochetage', pct(1)], ['deguisement', 'Déguisement', pct(5)],
          ] },
          { title: '', items: [
            ['discretion', 'Discrétion', pct(20)], ['droit', 'Droit', pct(5)], ['ecouter', 'Écouter', pct(20)],
            ['electricite', 'Électricité', pct(10)], ['equitation', 'Équitation', pct(5)], ['esquive', 'Esquive', pct(25)],
            ['grimper', 'Grimper', pct(20)], ['histoire', 'Histoire', pct(5)], ['intimidation', 'Intimidation', pct(15)],
            ['lancer', 'Lancer', pct(20)], ['langueAutre', 'Langue étrangère', pct(1)], ['langueMaternelle', 'Langue maternelle', pct(50)],
            ['mecanique', 'Mécanique', pct(10)], ['medecine', 'Médecine', pct(1)],
          ] },
          { title: '', items: [
            ['mondeNaturel', 'Monde naturel', pct(10)], ['mythe', 'Mythe de Cthulhu', pct(0)], ['nager', 'Nager', pct(20)],
            ['naviguer', 'Naviguer', pct(10)], ['occultisme', 'Occultisme', pct(5)], ['persuasion', 'Persuasion', pct(10)],
            ['pister', 'Pister', pct(10)], ['premiersSoins', 'Premiers soins', pct(30)], ['psychanalyse', 'Psychanalyse', pct(1)],
            ['psychologie', 'Psychologie', pct(10)], ['sauter', 'Sauter', pct(20)], ['sciences', 'Sciences', pct(1)],
            ['survie', 'Survie', pct(10)], ['trouverObjet', 'Trouver objet caché', pct(25)],
          ] },
        ],
      }],
      hint: 'Chaque case affiche aussi les seuils Majeure (½) et Extrême (⅕).',
    },
    {
      title: 'Armes',
      fields: [{ type: 'multiline', key: 'weapons', max: 1000, rows: 3, placeholder: 'Revolver .38 — Armes de poing 45 % — 1d10 — portée 15 m…' }],
    },
    {
      title: 'Historique',
      fields: [{ type: 'multiline', key: 'backstory', max: 2000, rows: 4, placeholder: 'Description, idéologie, personnes importantes, lieux significatifs, biens précieux, traits…' }],
    },
    {
      title: 'Équipement et argent',
      fields: [{ type: 'multiline', key: 'equipment', max: 1000, rows: 3, placeholder: 'Objets, niveau de vie, liquidités…' }],
    },
    {
      title: 'Notes',
      fields: [{ type: 'multiline', key: 'notes', max: 2000, rows: 4, placeholder: 'Indices, sorts, tomes lus, rencontres avec le Mythe…' }],
    },
  ],
};

const npcSheet = {
  fields: [
    [
      { type: 'number', key: 'hp', label: 'PV', min: 0, max: 999, default: 10 },
      { type: 'number', key: 'hpMax', label: 'PV max', min: 1, max: 999, default: 10 },
      { type: 'number', key: 'armor', label: 'Armure', min: 0, max: 50, default: 0 },
    ],
    [
      { type: 'number', key: 'dodge', label: 'Esquive %', min: 0, max: 99, default: 25 },
      { type: 'number', key: 'combat', label: 'Combat %', min: 0, max: 99, default: 25 },
      { type: 'text', key: 'damageBonus', label: 'Impact', max: 10, fallback: '0' },
    ],
    { type: 'text', key: 'sanLoss', label: 'Perte de SAN à la rencontre', max: 20, fallback: '0/1d4', wide: true },
    { type: 'multiline', key: 'traits', label: 'Attaques, pouvoirs, sorts', max: 800, rows: 3 },
    { type: 'multiline', key: 'notes', label: 'Notes', max: 500, rows: 3 },
  ],
};

const checks = [
  {
    id: 'd100',
    title: 'Test de compétence (d100)',
    fields: [
      { key: 'value', label: 'Valeur (%)', min: 1, max: 99, default: 50, tip: 'Valeur de la compétence ou de la caractéristique testée.' },
      { key: 'bonus', label: 'Dés bonus / malus', min: -2, max: 2, default: 0, tip: '+1 / +2 : dés bonus (on garde la meilleure dizaine). −1 / −2 : dés malus (on garde la pire).' },
      {
        key: 'difficulty', label: 'Difficulté', type: 'select', default: 'regular',
        options: Object.entries(REQUIRED).map(([value, label]) => [value, label]),
        tip: 'Ordinaire : sous la valeur. Majeure : sous la moitié. Extrême : sous le cinquième.',
      },
    ],
  },
];

/** Niveau de réussite d'un résultat d100 contre une valeur. */
function tierOf(result, value) {
  if (result === 1) return 'critical';
  if (value < 50 ? result >= 96 : result === 100) return 'fumble';
  if (result <= Math.floor(value / 5)) return 'extreme';
  if (result <= Math.floor(value / 2)) return 'hard';
  if (result <= value) return 'regular';
  return 'failure';
}

function resolveCheck(check, { rng }) {
  if (check.id !== 'd100') return null;
  const value = clampInt(check.value, 1, 99, 50);
  const bonus = clampInt(check.bonus, -2, 2, 0);
  const required = REQUIRED[check.difficulty] ? check.difficulty : 'regular';
  const { total, part } = rollPercentile(bonus, rng);
  const tierKey = tierOf(total, value);
  const tier = TIERS[tierKey];
  const passed = tier.rank >= TIERS[required].rank;
  const bonusLabel = bonus > 0 ? ` +${bonus} bonus` : bonus < 0 ? ` ${-bonus} malus` : '';
  return {
    expr: `d100${bonusLabel}`,
    parts: [part],
    total,
    target: value,
    targetLabel: required === 'regular' ? 'valeur' : `valeur ${REQUIRED[required]}`,
    tier: tierKey,
    // Réussite d'un niveau insuffisant pour la difficulté demandée : c'est un échec
    tierLabel: tier.rank >= 2 && !passed ? `${tier.label}, insuffisante (${REQUIRED[required]} requise)` : tier.label,
    tone: tier.tone === 'ok' && !passed ? 'fail' : tier.tone,
    passed,
  };
}

module.exports = {
  id: 'coc7',
  label: "L'Appel de Cthulhu",
  theme: 'coc7',
  tagline: 'Enquêtes dans les années 1920, face à l\'indicible et à la folie.',
  dice: {},
  initiative: { die: null, tip: 'Score exact : la DEX du personnage (les armes à feu dégainées agissent avec +50).' },
  sheet,
  npcSheet,
  gauges: [],
  checks,
  resolveCheck,
  tierOf,
};

'use strict';
/**
 * Hunter: the Reckoning (tronc commun Chronicles of Darkness / Storytelling System) :
 * pool de d10 (6+ = réussite, paire de 10 = +2), Danger et Désespoir de cellule,
 * Overreach/Despair sur les 1 des dés Désespoir.
 * Les clés de la fiche sont celles des salons existants : aucune migration.
 */
const { clampInt, clamp } = require('../util');
const { parseDiceExpr, rollExpr, d10Successes } = require('../dice');

const MAX_DANGER = 5;
const MAX_DESPERATION = 5;
const DMG_TIP = 'Clique sur une case pour la faire passer de vide à dégât superficiel (jaune), puis aggravé (rouge), puis de nouveau vide.';

const sheet = {
  quick: ['health', 'willpower', 'hunger'],
  help: {
    summary: 'Aide à la création (répartition des points par priorité)',
    tables: [
      {
        caption: 'Attributs (priorités 4 / 3 / 2 / 1 points, un point offert par attribut)',
        head: ['4 pts', '3 pts', '2 pts', '1 pt'],
        rows: [['×1', '×3', '×4', '×1']],
      },
      {
        caption: 'Compétences (priorités 3 / 2 / 1 points)',
        head: ['Profil', '3 pts', '2 pts', '1 pt'],
        rows: [
          ['Touche à tout', '×1', '×8', '×10'],
          ['Équilibré', '×3', '×5', '×7'],
          ['Spécialiste (4 pts ×1 en plus)', '×3', '×3', '×3'],
        ],
      },
    ],
  },
  sections: [
    {
      fields: [
        [
          { type: 'text', key: 'concept', label: 'Concept', max: 60 },
          { type: 'text', key: 'virtue', label: 'Vertu', max: 40 },
          { type: 'text', key: 'vice', label: 'Vice', max: 40 },
        ],
        [
          { type: 'number', key: 'healthMax', label: 'Santé (cases)', min: 0, max: 20, default: 0 },
          { type: 'number', key: 'willpowerMax', label: 'Volonté (cases)', min: 0, max: 20, default: 0 },
        ],
        { type: 'track', key: 'health', maxKey: 'healthMax', label: 'Santé', quickLabel: 'PV', tip: DMG_TIP },
        { type: 'track', key: 'willpower', maxKey: 'willpowerMax', label: 'Volonté', tip: DMG_TIP },
      ],
      hint: 'Clique une case pour la faire passer de vide à superficiel puis aggravé.',
    },
    {
      fields: [
        { type: 'counter', key: 'hunger', maxKey: 'hungerMax', labelKey: 'hungerLabel', label: 'Faim', min: 0, max: 10, maxMin: 1, maxMax: 10, default: 0, defaultMax: 5, display: 'boxes' },
        { type: 'counter', key: 'morality', maxKey: 'moralityMax', labelKey: 'moralityLabel', label: 'Humanité', min: 0, max: 10, maxMin: 1, maxMax: 10, default: 7, defaultMax: 10, display: 'boxes' },
      ],
    },
    {
      title: 'Attributs',
      fields: [{
        type: 'group', key: 'attributes', item: { type: 'rating', min: 1, max: 5, default: 1 },
        columns: [
          { title: 'Physique', items: [['force', 'Force'], ['dexterite', 'Dextérité'], ['vigueur', 'Vigueur']] },
          { title: 'Social', items: [['charisme', 'Charisme'], ['manipulation', 'Manipulation'], ['sangFroid', 'Sang-froid']] },
          { title: 'Mental', items: [['intelligence', 'Intelligence'], ['astuce', 'Astuce'], ['resolution', 'Résolution']] },
        ],
      }],
    },
    {
      title: 'Compétences',
      fields: [{
        type: 'group', key: 'skills', item: { type: 'skill', min: 0, max: 5, default: 0 },
        columns: [
          { title: 'Physiques', items: [
            ['athletisme', 'Athlétisme'], ['bagarre', 'Bagarre'], ['artisanat', 'Artisanat'], ['conduite', 'Conduite'],
            ['armeAFeu', 'Arme à feu'], ['larcin', 'Larcin'], ['melee', 'Mêlée'], ['furtivite', 'Furtivité'], ['survie', 'Survie'],
          ] },
          { title: 'Sociales', items: [
            ['animaux', 'Animaux'], ['etiquette', 'Étiquette'], ['empathie', 'Empathie'], ['intimidation', 'Intimidation'],
            ['commandement', 'Commandement'], ['representation', 'Représentation'], ['persuasion', 'Persuasion'], ['rue', 'La rue'], ['subterfuge', 'Subterfuge'],
          ] },
          { title: 'Mentales', items: [
            ['erudition', 'Érudition'], ['vigilance', 'Vigilance'], ['finances', 'Finances'], ['investigation', 'Investigation'],
            ['medecine', 'Médecine'], ['occultisme', 'Occultisme'], ['politique', 'Politique'], ['sciences', 'Sciences'], ['technologie', 'Technologie'],
          ] },
        ],
      }],
    },
    {
      title: 'Mérites',
      fields: [{ type: 'multiline', key: 'merits', max: 500, rows: 3, placeholder: 'Mérites, dons, atouts…' }],
    },
    {
      titleKey: 'powersLabel',
      fields: [
        { type: 'text', key: 'powersLabel', label: 'Libellé', max: 40, fallback: 'Disciplines / Dons / Atouts', wide: true },
        { type: 'multiline', key: 'powers', max: 1000, rows: 4, placeholder: 'Disciplines, Dons de chasseur, Edges… (nom, niveau, description libre)' },
      ],
    },
    {
      title: 'Notes',
      fields: [{ type: 'multiline', key: 'notes', max: 2000, rows: 5, placeholder: 'Historique, contacts, matériel, mécaniques propres au type de personnage…' }],
    },
  ],
};

const npcSheet = {
  fields: [
    [
      { type: 'number', key: 'hp', label: 'PV', min: 0, max: 999, default: 0 },
      { type: 'number', key: 'hpMax', label: 'PV max', min: 1, max: 999, default: 10 },
    ],
    { type: 'boxes', key: 'hp' },
    [
      { type: 'number', key: 'willpower', label: 'Volonté', min: 0, max: 20, default: 0 },
      { type: 'number', key: 'willpowerMax', label: 'Volonté max', min: 1, max: 20, default: 3 },
      { type: 'number', key: 'defense', label: 'Défense', min: 0, max: 20, default: 0, tip: "À toi de décider ce qu'elle représente : difficulté pour toucher ce PNJ, défense passive…" },
    ],
    { type: 'boxes', key: 'willpower' },
    { type: 'multiline', key: 'traits', label: 'Traits (attaques, résistances…)', max: 500, rows: 3 },
    { type: 'multiline', key: 'notes', label: 'Notes', max: 500, rows: 3 },
  ],
};

const gauges = [
  {
    key: 'danger',
    label: 'Danger',
    max: MAX_DANGER,
    color: '--gauge-danger',
    icon: '⚠',
    tip: "Danger : à quel point la cellule est repérée par ses ennemis. Monte selon l'histoire ou quand les chasseurs surjouent (Overreach) ; ne redescend que si le groupe se fait discret.",
    alert: {
      up: 'Le danger monte',
      down: 'Le danger retombe',
      detail: 'Danger {level} / {max}',
      atMax: ' · la cellule est traquée',
      atZero: " · la cellule n'est plus repérée",
    },
  },
  {
    key: 'desperation',
    label: 'Désespoir',
    max: MAX_DESPERATION,
    color: '--crit',
    icon: '☠',
    tip: "Désespoir : jauge partagée par toute la cellule, ajoute des dés à vos tests dans votre domaine (Creed Field). Monte ou descend selon les événements de l'histoire (décision du MJ).",
    alert: {
      up: 'Le désespoir grandit',
      down: 'Le désespoir reflue',
      detail: 'Désespoir {level} / {max} · {level} dé{s} Désespoir aux jets de pool',
      zeroDetail: 'Désespoir 0 / {max} · plus de dés Désespoir',
    },
  },
];

const checks = [
  {
    id: 'pool',
    title: 'Jet de pool (d10)',
    fields: [
      { key: 'normal', label: 'Dés normaux', min: 0, max: 30, default: 0 },
      {
        key: 'desperation', label: 'Dés Désespoir', min: 0, max: 10, default: 0, prefillGauge: 'desperation',
        tip: 'Pré-remplis depuis la jauge de Désespoir de la cellule, modifiables avant de lancer. Un 1 sur ces dés déclenche Overreach (test réussi, Danger augmente) ou Despair (test raté) — un 1 sur les dés normaux ne compte pas.',
      },
      {
        key: 'difficulty', label: 'Difficulté', min: 1, max: 20, default: 3,
        tip: 'Nombre de réussites nécessaires pour réussir le test. Chaque d10 de 6 à 10 compte comme une réussite, et chaque paire de 10 en rapporte 2 de plus (critique).',
      },
    ],
  },
];

/**
 * Pool de d10 contre une difficulté (en réussites). Un 1 sur les dés Désespoir
 * donne Overreach si le test est réussi (le Danger monte d'autant), Despair sinon.
 */
function resolveCheck(check, { rng, gauges: levels }) {
  if (check.id !== 'pool') return null;
  const normal = clampInt(check.normal, 0, 30, 0);
  const desperation = clampInt(check.desperation, 0, 10, 0);
  if (!normal && !desperation) return null;
  const terms = [];
  if (normal) terms.push(`${normal}d10`);
  if (desperation) terms.push(`${desperation}d10`);
  const expr = terms.join('+');
  const { total, parts } = rollExpr(parseDiceExpr(expr), rng);
  const roll = { expr, parts, total, difficulty: clampInt(check.difficulty, 1, 20, 3) };
  roll.successes = parts.reduce((sum, p) => sum + d10Successes(p.values), 0);
  roll.passed = roll.successes >= roll.difficulty;
  if (desperation) {
    roll.hungerIndex = parts.length - 1;
    const ones = parts[roll.hungerIndex].values.filter((v) => v === 1).length;
    if (ones > 0) {
      roll.outcome = roll.passed ? 'overreach' : 'despair';
      if (roll.outcome === 'overreach') {
        levels.danger = clamp((levels.danger || 0) + ones, 0, MAX_DANGER);
        roll.dangerDelta = ones;
        roll.gaugesChanged = ['danger'];
      }
    }
  }
  return roll;
}

module.exports = {
  id: 'hunter',
  label: 'Hunter: the Reckoning',
  theme: 'hunter',
  tagline: 'Chasseurs ordinaires face aux monstres, dans le monde des ténèbres.',
  dice: { poolD10: true },
  initiative: { die: '1d10', tip: 'Score exact (bouton +) ou modificateur ajouté au d10 (bouton dé)' },
  sheet,
  npcSheet,
  gauges,
  checks,
  resolveCheck,
};

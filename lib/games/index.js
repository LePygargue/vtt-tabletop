'use strict';
/**
 * Registre des jeux de rôle proposés. Chaque définition (un fichier par jeu) décrit
 * en données sa fiche, sa fiche PNJ, ses jauges de salon, ses panneaux de jet et son
 * thème ; seule `resolveCheck` (résolution des jets, aléa serveur) reste côté serveur.
 * Ajouter un jeu : un fichier ici + un bloc [data-game="…"] dans public/style.css.
 */
const hunter = require('./hunter');
const pf2e = require('./pf2e');
const coc7 = require('./coc7');

const GAMES = [hunter, pf2e, coc7];
const DEFAULT_GAME = 'hunter';
const byId = new Map(GAMES.map((g) => [g.id, g]));

const isGameId = (id) => typeof id === 'string' && byId.has(id);
/** Jeu d'un salon ; les salons créés avant le choix du jeu sont des salons Hunter. */
const getGame = (id) => byId.get(id) || byId.get(DEFAULT_GAME);

/** Définition envoyée aux clients : tout sauf les fonctions (calculée une fois par jeu). */
const publicDefs = new Map(GAMES.map((g) => [g.id, JSON.parse(JSON.stringify({
  id: g.id, label: g.label, theme: g.theme, tagline: g.tagline, dice: g.dice, initiative: g.initiative,
  sheet: g.sheet, npcSheet: g.npcSheet, gauges: g.gauges, checks: g.checks,
}))]));
const publicGameDef = (game) => publicDefs.get(game.id);

/** Liste courte pour l'accueil. */
const gameList = () => GAMES.map((g) => ({ id: g.id, label: g.label, theme: g.theme, tagline: g.tagline }));

module.exports = { GAMES, DEFAULT_GAME, isGameId, getGame, publicGameDef, gameList };

'use strict';
/**
 * Jeu du salon : applique la définition reçue avec l'état (voir lib/games) —
 * thème visuel (attribut data-game, variables CSS de style.css), puis construction
 * des parties propres au jeu : fiche, fiche PNJ, jauges, panneaux de jet, initiative.
 * Le dernier jeu vu est mémorisé pour appliquer son thème dès le chargement suivant.
 */
const GAME_THEME_KEY = 'plateau.game';

function applyGame(def) {
  if (!def || (game && game.id === def.id)) return;
  game = def;
  document.documentElement.dataset.game = def.theme;
  try { localStorage.setItem(GAME_THEME_KEY, def.theme); } catch (e) { /* thème non mémorisé */ }
  refreshThemeColors();
  buildSheetForm();
  buildQuickStats();
  buildNpcForm();
  buildGauges();
  buildCheckForms();
  setupInitiativeForGame();
  renderRoomLabel();
  syncTopbarHeight(); // les jauges changent la hauteur possible de la barre du haut
}

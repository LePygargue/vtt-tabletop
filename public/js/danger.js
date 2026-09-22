'use strict';
/**
 * Jauges de cellule façon compteur à crans : Danger et Désespoir (Hunter),
 * partagées par tout le salon (pas liées à un jeton), pilotées par le MJ,
 * vues en direct par tous. Widgets dans la barre du haut, à côté de « connecté ».
 * Losange plein/creux (◆/◇) plutôt qu'une étoile, façon jeton de dé.
 */
const CELL_PIPS = 5;

function renderPipMeter(elId, level, sendType, cls) {
  const el = $(elId);
  if (!el) return;
  el.textContent = '';
  const gm = isGM();
  for (let i = 1; i <= CELL_PIPS; i++) {
    const pip = document.createElement(gm ? 'button' : 'span');
    if (gm) pip.type = 'button';
    pip.className = 'dpip ' + cls + (i <= level ? ' on' : '');
    pip.textContent = i <= level ? '◆' : '◇';
    if (gm) {
      pip.title = `Régler à ${i}`;
      pip.addEventListener('click', () => {
        send({ t: sendType, level: level === i ? i - 1 : i });
      });
    }
    el.appendChild(pip);
  }
}

function renderDanger() { renderPipMeter('dangerMeter', dangerLevel, 'danger', 'danger'); }
function renderDesperation() {
  renderPipMeter('desperationMeter', desperationLevel, 'desperation', 'desperation');
  if (!isGM()) {
    const poolHungerInput = $('poolHunger');
    if (poolHungerInput && document.activeElement !== poolHungerInput) poolHungerInput.value = desperationLevel;
  }
}

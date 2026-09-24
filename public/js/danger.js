'use strict';
/**
 * Jauges de cellule façon compteur à crans : Danger et Désespoir (Hunter),
 * partagées par tout le salon (pas liées à un jeton), pilotées par le MJ,
 * vues en direct par tous. Widgets dans la barre du haut, à côté de « connecté ».
 * Losange plein/creux (◆/◇) plutôt qu'une étoile, façon jeton de dé.
 */
const CELL_PIPS = 5;

/**
 * Classe d'animation d'un cran quand la jauge passe de `prev` à `level` :
 * 'new' (gagné, apparaît du plus bas au plus haut) ou 'lost' (perdu, se vide du plus haut au plus bas).
 * Renvoie [classe, rang dans l'enchaînement] ou null.
 */
function pipChange(i, prev, level) {
  if (i > prev && i <= level) return ['new', i - prev - 1];
  if (i > level && i <= prev) return ['lost', prev - i];
  return null;
}

/** `prevLevel` (optionnel) : les crans entre prevLevel et level s'animent (gagnés ou perdus). */
function renderPipMeter(elId, level, sendType, cls, prevLevel = level) {
  const el = $(elId);
  if (!el) return;
  el.textContent = '';
  const gm = isGM();
  for (let i = 1; i <= CELL_PIPS; i++) {
    const pip = document.createElement(gm ? 'button' : 'span');
    if (gm) pip.type = 'button';
    pip.className = 'dpip ' + cls + (i <= level ? ' on' : '');
    const change = pipChange(i, prevLevel, level);
    if (change) {
      pip.classList.add('pip-' + change[0]);
      pip.style.setProperty('--k', change[1]);
    }
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

function renderDanger(prevLevel) { renderPipMeter('dangerMeter', dangerLevel, 'danger', 'danger', prevLevel); }
function renderDesperation(prevLevel) {
  renderPipMeter('desperationMeter', desperationLevel, 'desperation', 'desperation', prevLevel);
  if (!isGM()) {
    const poolHungerInput = $('poolHunger');
    if (poolHungerInput && document.activeElement !== poolHungerInput) poolHungerInput.value = desperationLevel;
  }
}

/* ---------- Alerte quand une jauge monte ou redescend ---------- */
const GAUGE_ALERT_MS = 4200;
const GAUGE_ALERTS = {
  danger: {
    icon: '⚠',
    title: 'Le danger monte',
    titleDown: 'Le danger retombe',
    detail: (level) => `Danger ${level} / ${CELL_PIPS}` + (level >= CELL_PIPS ? ' · la cellule est traquée' : ''),
    detailDown: (level) => `Danger ${level} / ${CELL_PIPS}` + (level === 0 ? ' · la cellule n\'est plus repérée' : ''),
    wrap: 'dangerWrap',
    render: renderDanger,
  },
  desperation: {
    icon: '☠',
    title: 'Le désespoir grandit',
    titleDown: 'Le désespoir reflue',
    detail: (level) => `Désespoir ${level} / ${CELL_PIPS} · ${level} dé${level > 1 ? 's' : ''} Désespoir aux jets de pool`,
    detailDown: (level) => level === 0
      ? `Désespoir 0 / ${CELL_PIPS} · plus de dés Désespoir`
      : `Désespoir ${level} / ${CELL_PIPS} · ${level} dé${level > 1 ? 's' : ''} Désespoir aux jets de pool`,
    wrap: 'desperationWrap',
    render: renderDesperation,
  },
};
/** Moment (performance.now) où les dés d'un jet Overreach sont posés ; renseigné par dice-ui.js. */
let overreachRevealAt = 0;

/** Appelé à chaque changement de jauge reçu du serveur. */
function gaugeChanged(kind, prev, level) {
  if (level === prev || !Number.isFinite(level)) return;
  // Sur un Overreach, le serveur envoie le Danger juste avant le jet : on laisse le message
  // du jet arriver, puis on attend que ses dés soient posés pour ne pas gâcher la surprise.
  setTimeout(() => {
    const wait = level > prev ? Math.max(0, overreachRevealAt - performance.now()) : 0;
    setTimeout(() => showGaugeAlert(kind, prev, level), wait);
  }, 0);
}

/** Relance une animation CSS déjà jouée sur `el` en retirant puis remettant la classe. */
function replayClass(el, ...classes) {
  if (!el) return;
  el.classList.remove(...classes);
  void el.offsetWidth;
  el.classList.add(...classes);
}

function showGaugeAlert(kind, prev, level) {
  const cfg = GAUGE_ALERTS[kind];
  const up = level > prev;
  cfg.render(prev); // crans de la barre du haut : gagnés ou perdus, animés
  const wrap = $(cfg.wrap);
  if (wrap) wrap.classList.remove('gauge-bump', 'gauge-drop');
  replayClass(wrap, up ? 'gauge-bump' : 'gauge-drop');
  const flash = $('gaugeFlash');
  flash.className = '';
  replayClass(flash, kind, up ? 'go' : 'go-down');

  const root = $('gaugeAlerts');
  const old = root.querySelector('.gauge-alert.' + kind);
  if (old) old.remove(); // plusieurs changements rapprochés : une seule carte, à jour

  const card = document.createElement('div');
  card.className = 'gauge-alert ' + kind + (up ? (level >= CELL_PIPS ? ' maxed' : '') : ' down');
  const icon = document.createElement('div');
  icon.className = 'ga-icon';
  icon.textContent = cfg.icon;
  const body = document.createElement('div');
  body.className = 'ga-body';
  const title = document.createElement('div');
  title.className = 'ga-title';
  title.textContent = up ? `${cfg.title} (+${level - prev})` : `${cfg.titleDown} (−${prev - level})`;
  const pips = document.createElement('div');
  pips.className = 'ga-pips';
  for (let i = 1; i <= CELL_PIPS; i++) {
    const pip = document.createElement('span');
    pip.className = 'ga-pip' + (i <= level ? ' on' : '');
    pip.textContent = i <= level ? '◆' : '◇';
    const change = pipChange(i, prev, level);
    if (change) {
      pip.classList.add(change[0]);
      pip.style.setProperty('--k', change[1]);
    }
    pips.appendChild(pip);
  }
  const detail = document.createElement('div');
  detail.className = 'ga-detail';
  detail.textContent = up ? cfg.detail(level) : cfg.detailDown(level);
  body.append(title, pips, detail);
  card.append(icon, body);
  root.appendChild(card);
  announce(`${up ? cfg.title : cfg.titleDown} : ${detail.textContent}`);

  setTimeout(() => {
    card.classList.add('out');
    setTimeout(() => card.remove(), 400);
  }, GAUGE_ALERT_MS);
}

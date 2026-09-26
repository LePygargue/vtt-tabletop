'use strict';
/**
 * Jauges de salon façon compteur à crans, définies par le jeu (Danger et Désespoir
 * pour Hunter ; aucune pour d'autres jeux), partagées par tout le salon (pas liées
 * à un jeton), pilotées par le MJ, vues en direct par tous. Widgets dans la barre
 * du haut, à côté de « connecté ». Losange plein/creux (◆/◇), façon jeton de dé.
 */
const gaugeDef = (key) => (game ? game.gauges.find((g) => g.key === key) : null);

/** Widgets de la barre du haut, un par jauge du jeu. */
function buildGauges() {
  const root = $('gauges');
  root.textContent = '';
  for (const g of game.gauges) {
    const wrap = root.appendChild(el('div', 'danger-wrap'));
    wrap.id = 'gaugeWrap_' + g.key;
    wrap.tabIndex = 0;
    wrap.dataset.tip = g.tip;
    wrap.style.setProperty('--gc', `var(${g.color})`);
    wrap.appendChild(el('span', 'danger-label', g.label));
    wrap.appendChild(el('div', 'danger-meter')).id = 'gaugeMeter_' + g.key;
  }
  root.hidden = !game.gauges.length;
}

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
function renderGauge(key, prevLevel) {
  const def = gaugeDef(key);
  const meter = $('gaugeMeter_' + key);
  if (!def || !meter) return;
  const level = gauges[key] || 0;
  if (prevLevel == null) prevLevel = level;
  meter.textContent = '';
  const gm = isGM();
  for (let i = 1; i <= def.max; i++) {
    const pip = document.createElement(gm ? 'button' : 'span');
    if (gm) pip.type = 'button';
    pip.className = 'dpip' + (i <= level ? ' on' : '');
    const change = pipChange(i, prevLevel, level);
    if (change) {
      pip.classList.add('pip-' + change[0]);
      pip.style.setProperty('--k', change[1]);
    }
    pip.textContent = i <= level ? '◆' : '◇';
    if (gm) {
      pip.title = `Régler à ${i}`;
      pip.addEventListener('click', () => {
        send({ t: 'gauge', key, level: level === i ? i - 1 : i });
      });
    }
    meter.appendChild(pip);
  }
  // Champs de jet pré-remplis depuis cette jauge (dés Désespoir de Hunter), côté joueurs
  if (!isGM()) for (const input of document.querySelectorAll(`[data-prefill-gauge="${key}"]`)) setFieldValue(input, level);
}
function renderGauges() {
  if (game) for (const g of game.gauges) renderGauge(g.key);
}

/* ---------- Alerte quand une jauge monte ou redescend ---------- */
const GAUGE_ALERT_MS = 4200;
/** Texte d'alerte d'une jauge : {level}, {max} et {s} (pluriel) remplacés. */
function gaugeText(tpl, level, max) {
  return String(tpl || '').replace(/\{level\}/g, level).replace(/\{max\}/g, max).replace(/\{s\}/g, level > 1 ? 's' : '');
}
function gaugeDetail(def, level, up) {
  const a = def.alert || {};
  if (!up && level === 0 && a.zeroDetail) return gaugeText(a.zeroDetail, level, def.max);
  let text = gaugeText(a.detail || `${def.label} {level} / {max}`, level, def.max);
  if (up && level >= def.max && a.atMax) text += a.atMax;
  if (!up && level === 0 && a.atZero) text += a.atZero;
  return text;
}
/** Moment (performance.now) où les dés d'un jet qui fait monter une jauge sont posés ; renseigné par dice-ui.js. */
let overreachRevealAt = 0;

/** Appelé à chaque changement de jauge reçu du serveur. */
function gaugeChanged(kind, prev, level) {
  if (level === prev || !Number.isFinite(level)) return;
  // Sur un Overreach, le serveur envoie la jauge juste avant le jet : on laisse le message
  // du jet arriver, puis on attend que ses dés soient posés pour ne pas gâcher la surprise.
  setTimeout(() => {
    const wait = level > prev ? Math.max(0, overreachRevealAt - performance.now()) : 0;
    setTimeout(() => showGaugeAlert(kind, prev, level), wait);
  }, 0);
}

/** Relance une animation CSS déjà jouée sur `el` en retirant puis remettant la classe. */
function replayClass(elem, ...classes) {
  if (!elem) return;
  elem.classList.remove(...classes);
  void elem.offsetWidth;
  elem.classList.add(...classes);
}

function showGaugeAlert(kind, prev, level) {
  const def = gaugeDef(kind);
  if (!def) return;
  const up = level > prev;
  const alert = def.alert || {};
  renderGauge(kind, prev); // crans de la barre du haut : gagnés ou perdus, animés
  const wrap = $('gaugeWrap_' + kind);
  if (wrap) wrap.classList.remove('gauge-bump', 'gauge-drop');
  replayClass(wrap, up ? 'gauge-bump' : 'gauge-drop');
  const flash = $('gaugeFlash');
  flash.className = '';
  flash.style.setProperty('--gc', `var(${def.color})`);
  replayClass(flash, up ? 'go' : 'go-down');

  const root = $('gaugeAlerts');
  const old = root.querySelector('.gauge-alert.' + kind);
  if (old) old.remove(); // plusieurs changements rapprochés : une seule carte, à jour

  const card = document.createElement('div');
  card.className = 'gauge-alert ' + kind + (up ? (level >= def.max ? ' maxed' : '') : ' down');
  card.style.setProperty('--gc', `var(${def.color})`);
  const icon = document.createElement('div');
  icon.className = 'ga-icon';
  icon.textContent = def.icon || '◆';
  const body = document.createElement('div');
  body.className = 'ga-body';
  const title = document.createElement('div');
  title.className = 'ga-title';
  const titleText = (up ? alert.up : alert.down) || def.label;
  title.textContent = up ? `${titleText} (+${level - prev})` : `${titleText} (−${prev - level})`;
  const pips = document.createElement('div');
  pips.className = 'ga-pips';
  for (let i = 1; i <= def.max; i++) {
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
  detail.textContent = gaugeDetail(def, level, up);
  body.append(title, pips, detail);
  card.append(icon, body);
  root.appendChild(card);
  announce(`${titleText} : ${detail.textContent}`);

  setTimeout(() => {
    card.classList.add('out');
    setTimeout(() => card.remove(), 400);
  }, GAUGE_ALERT_MS);
}

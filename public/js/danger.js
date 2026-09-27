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
    for (const url of [g.sound?.up, g.sound?.down, g.sound?.max].filter(Boolean)) gaugeSound(url); // préchargé : pas de délai au premier changement
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
  const level = gaugeHeld.has(key) ? gaugeHeld.get(key) : gauges[key] || 0;
  if (prevLevel == null) prevLevel = level;
  // jauge au maximum (niveau affiché) : ambiance constante du thème (Danger 5 de Hunter)
  document.body.classList.toggle('gauge-max-' + key, level >= def.max);
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
/**
 * Sons d'une jauge, si le jeu en prévoit : def.sound.up / def.sound.down, et def.sound.max
 * (joué dès que la jauge atteint son maximum, avant l'alerte et son son up, voir startGaugeHold).
 */
const gaugeSounds = new Map(); // url -> Audio préchargé
function gaugeSound(url) {
  let base = gaugeSounds.get(url);
  if (!base) {
    base = new Audio(url);
    base.preload = 'auto';
    gaugeSounds.set(url, base);
  }
  return base;
}
/** Joue un son de jauge ; renvoie l'élément audio (pour l'arrêter) ou null. */
function playSoundUrl(url) {
  const volume = soundVolume(); // coupé ou réglé dans l'aide (?)
  if (!url || !volume) return null;
  const audio = gaugeSound(url).cloneNode(); // plusieurs changements rapprochés : les sons se chevauchent
  audio.volume = volume;
  audio.play().catch(() => { /* lecture refusée (aucune interaction avec la page pour l'instant) */ });
  return audio;
}
function playGaugeSound(def, up) {
  if (def.sound) playSoundUrl(up ? def.sound.up : def.sound.down); // au maximum : par-dessus le son de def.sound.max
}

/**
 * Jauge qui atteint son maximum avec un son dédié (Danger 5 de Hunter) : le son part tout de suite,
 * la barre du haut garde l'ancien niveau, et l'alerte visuelle n'arrive que def.sound.maxDelay ms après.
 * Un nouveau changement de cette jauge pendant l'attente annule tout (son compris).
 */
const gaugeHeld = new Map(); // clé -> niveau affiché pendant l'attente
const gaugeHolds = new Map(); // clé -> { timer, audio }
function cancelGaugeHold(kind) {
  const hold = gaugeHolds.get(kind);
  if (!hold) return;
  clearTimeout(hold.timer);
  if (hold.audio) hold.audio.pause();
  gaugeHolds.delete(kind);
  gaugeHeld.delete(kind);
  renderGauge(kind);
}
/** Dès la réception : la barre du haut garde l'ancien niveau. */
function beginGaugeHold(kind, prev) {
  const hold = { timer: 0, audio: null };
  gaugeHolds.set(kind, hold);
  gaugeHeld.set(kind, prev);
  renderGauge(kind);
  return hold;
}
/** Une fois les dés posés (Overreach) : le son part, l'alerte suit après maxDelay. */
function startGaugeHold(hold, kind, def, prev, level) {
  if (gaugeHolds.get(kind) !== hold) return; // annulée entre-temps
  hold.audio = playSoundUrl(def.sound.max);
  hold.timer = setTimeout(() => {
    gaugeHolds.delete(kind);
    gaugeHeld.delete(kind);
    showGaugeAlert(kind, prev, level);
  }, def.sound.maxDelay || 0);
}

/** Moment (performance.now) où les dés d'un jet qui fait monter une jauge sont posés ; renseigné par dice-ui.js. */
let overreachRevealAt = 0;

/** Appelé à chaque changement de jauge reçu du serveur. */
function gaugeChanged(kind, prev, level) {
  if (level === prev || !Number.isFinite(level)) return;
  if (gaugeHolds.has(kind)) {
    // changement pendant l'attente du maximum : on repart du niveau encore affiché
    prev = gaugeHeld.get(kind);
    cancelGaugeHold(kind);
    if (level === prev) return;
  }
  const def = gaugeDef(kind);
  const hold = def && level > prev && level >= def.max && def.sound && def.sound.max ? beginGaugeHold(kind, prev) : null;
  // Sur un Overreach, le serveur envoie la jauge juste avant le jet : on laisse le message
  // du jet arriver, puis on attend que ses dés soient posés pour ne pas gâcher la surprise.
  setTimeout(() => {
    const wait = level > prev ? Math.max(0, overreachRevealAt - performance.now()) : 0;
    setTimeout(() => (hold ? startGaugeHold(hold, kind, def, prev, level) : showGaugeAlert(kind, prev, level)), wait);
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
  glitchGauge(kind, prev, level);
  playGaugeSound(def, up);

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
  title.dataset.text = title.textContent; // copies décalées du titre glitché (thème Hunter)
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
    setTimeout(() => card.remove(), 500);
  }, GAUGE_ALERT_MS);
}

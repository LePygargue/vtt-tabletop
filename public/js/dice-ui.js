'use strict';
/**
 * Dés : historique, bannières de résultat, formule libre, pools de succès (d10).
 */
let rollAdv = 'normal'; // normal | adv | dis
const DIE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
function addRoll(roll) {
  rolls.push(roll);
  if (rolls.length > 50) rolls.shift();
  renderDiceLog();
  const revealMs = showRollBanner(roll); // même bannière animée pour tous, MJ compris
  if (roll.outcome === 'overreach') overreachRevealAt = performance.now() + revealMs;
  // annoncé une fois l'animation de la bannière finie, pas face par face
  const text = `${roll.by}${roll.private ? ' (secret)' : ''} : ${roll.total}${successSuffix(roll).replace(/\s*·\s*/g, ', ')}`;
  setTimeout(() => announce(text), revealMs + 50);
}

/* ---------- Animation des dés ---------- */
const RDIE_MAX_SHOWN = 12;   // au-delà, un « +N » résume le reste du jet
const RDIE_TUMBLE_MS = 1100; // durée de la roulade d'un dé
const RDIE_STAGGER_MS = 70;  // décalage entre deux dés
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Sommets d'un polygone régulier (repère 0-100), premier sommet vers le haut. */
function regularPoints(n, r, cx = 50, cy = 50, start = -90) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = ((start + (360 / n) * k) * Math.PI) / 180;
    pts.push([+(cx + r * Math.cos(a)).toFixed(1), +(cy + r * Math.sin(a)).toFixed(1)]);
  }
  return pts;
}
const ptsStr = (pts) => pts.map((p) => p.join(',')).join(' ');

/** Dodécaèdre vu de face : pentagone central entouré de cinq faces pentagonales. */
function d12Shape() {
  const outer = regularPoints(10, 47, 50, 51);
  const inner = regularPoints(5, 27, 50, 51);
  const faces = [];
  for (let k = 0; k < 5; k++) {
    const pts = [inner[k], outer[2 * k], outer[2 * k + 1], outer[(2 * k + 2) % 10], inner[(k + 1) % 5]];
    faces.push([k === 0 || k === 4 ? 'side' : 'low', ptsStr(pts)]);
  }
  faces.push(['front', ptsStr(inner)]);
  return { faces, edge: ptsStr(outer), shine: '14,40 26,14 50,4', num: [50, 53, 40] };
}
/** Icosaèdre vu de face : triangle central dans un hexagone de faces triangulaires. */
function d20Shape() {
  const [t, ur, lr, b, ll, ul] = regularPoints(6, 48).map((p) => p.join(','));
  const ft = '50,14', fr = '80,68', fl = '20,68';
  return {
    faces: [
      ['side', `${t} ${ur} ${ft}`], ['side', `${t} ${ft} ${ul}`],
      ['side', `${ur} ${fr} ${ft}`], ['side', `${ur} ${lr} ${fr}`],
      ['side', `${ul} ${ft} ${fl}`], ['side', `${ul} ${fl} ${ll}`],
      ['low', `${lr} ${b} ${fr}`], ['low', `${fr} ${b} ${fl}`], ['low', `${fl} ${b} ${ll}`],
      ['front', `${ft} ${fr} ${fl}`],
    ],
    edge: `${t} ${ur} ${lr} ${b} ${ll} ${ul}`,
    shine: '12,68 12,30 44,11',
    num: [50, 51, 33],
  };
}
const D10_SHAPE = {
  faces: [
    ['side', '50,3 20,62 3,56'], ['side', '50,3 80,62 97,56'],
    ['low', '3,56 20,62 50,78 50,97'], ['low', '97,56 80,62 50,78 50,97'],
    ['front', '50,3 80,62 50,78 20,62'],
  ],
  edge: '50,3 97,56 50,97 3,56',
  shine: '28,46 50,9 56,19',
  num: [50, 54, 40],
};
/** Forme de chaque dé (repère 0-100) : faces [classe, points], contour, reflet, [x, y, taille] du chiffre. */
const DIE_SHAPES = {
  4: {
    faces: [['low', '5,90 95,90 88,96 12,96'], ['front', '50,5 95,90 5,90']],
    edge: '50,5 95,90 88,96 12,96 5,90',
    shine: '20,76 47,16',
    num: [50, 66, 36],
  },
  6: {
    faces: [
      ['side', '12,22 28,6 94,6 78,22'], ['low', '78,22 94,6 94,74 78,90'],
      ['front', '12,22 78,22 78,90 12,90'],
    ],
    edge: '12,22 28,6 94,6 94,74 78,90 12,90',
    shine: '18,82 18,28 70,28',
    num: [45, 57, 42],
  },
  8: {
    faces: [
      ['side', '50,3 5,50 12,66'], ['side', '50,3 95,50 88,66'],
      ['low', '5,50 12,66 50,97'], ['low', '95,50 88,66 50,97'], ['low', '12,66 88,66 50,97'],
      ['front', '50,3 88,66 12,66'],
    ],
    edge: '50,3 95,50 50,97 5,50',
    shine: '22,58 48,12',
    num: [50, 45, 36],
  },
  10: D10_SHAPE,
  12: d12Shape(),
  20: d20Shape(),
  100: D10_SHAPE, // dé de pourcentage : même solide que le d10
};
/** Dé sans forme dédiée (d2, d3, d1000…) : un jeton rond. */
const ROUND_SHAPE = (() => {
  const circle = ptsStr(regularPoints(24, 44));
  return { faces: [['front', circle]], edge: circle, shine: '16,42 28,20 48,10', num: [50, 52, 36] };
})();

function prefersReducedMotion() {
  return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}
/** Dés d'un jet, dans l'ordre du détail, avec leur couleur finale. */
function rolledDiceOf(roll) {
  const hIdx = hungerPoolIndex(roll);
  const dice = [];
  roll.parts.forEach((p, i) => {
    if (p.type !== 'dice') return;
    const pool = p.sides === 10 && !p.dropped.length; // pool de réussites (6+ réussit, paire de 10 critique)
    const pairedTens = pool ? Math.floor(p.values.filter((v) => v === 10).length / 2) * 2 : 0;
    let tenSeen = 0;
    let faces = p.values.map((v, idx) => ({ v, dropped: p.dropped.includes(idx) }));
    if (pool) faces = faces.sort((a, b) => b.v - a.v); // même ordre que le détail écrit
    faces.forEach(({ v, dropped }) => {
      let cls;
      if (pool) cls = v === 10 ? (++tenSeen <= pairedTens ? 'crit' : 'ok') : d10Class(v);
      else cls = v === p.sides ? 'max' : v === 1 ? 'min' : 'plain';
      dice.push({ value: v, sides: p.sides, cls, hunger: i === hIdx, dropped });
    });
  });
  return dice;
}
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}
/** Un dé vu de face, selon son nombre de faces : face avant claire, faces latérales et basses plus sombres. */
function buildRolledDie(sides, index) {
  const shape = DIE_SHAPES[sides] || ROUND_SHAPE;
  const die = document.createElement('span');
  die.className = 'rdie';
  die.dataset.sides = sides;
  die.style.setProperty('--i', index);
  const shadow = document.createElement('span');
  shadow.className = 'rdie-shadow';
  const body = document.createElement('span');
  body.className = 'rdie-body';
  const svg = svgEl('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  for (const [cls, points] of shape.faces) svg.appendChild(svgEl('polygon', { class: 'rdie-' + cls, points }));
  svg.appendChild(svgEl('polygon', { class: 'rdie-edge', points: shape.edge }));
  svg.appendChild(svgEl('polyline', { class: 'rdie-shine', points: shape.shine }));
  const [x, y, size] = shape.num;
  const num = svgEl('text', { class: 'rdie-num', x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  svg.appendChild(num);
  body.appendChild(svg);
  die.append(shadow, body);
  // trois chiffres (d100) : police réduite pour rester dans la face
  const setNum = (v) => {
    const s = String(v);
    num.textContent = s;
    num.style.fontSize = (s.length >= 3 ? size * 0.7 : size) + 'px';
  };
  return { die, setNum };
}
/** Fait défiler des valeurs au hasard, de plus en plus lentement, puis pose la vraie valeur. */
function tumbleDie(die, setNum, face, startMs, durMs) {
  const t0 = performance.now() + startMs;
  const random = () => 1 + Math.floor(Math.random() * face.sides);
  const land = () => {
    setNum(face.value);
    die.classList.add('landed', 'is-' + face.cls);
  };
  if (durMs <= 0) return land();
  let last = -Infinity;
  setNum(random());
  function tick(now) {
    const k = (now - t0) / durMs;
    if (k >= 1) return land();
    const gap = 40 + 230 * Math.max(0, k) ** 2; // le dé ralentit
    if (k >= 0 && now - last >= gap) {
      last = now;
      setNum(random());
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
/** Rangée de dés animés, avec le délai (ms) après lequel le dernier dé est posé. */
function buildDiceTray(dice) {
  const tray = document.createElement('div');
  tray.className = 'rdie-tray';
  const still = prefersReducedMotion();
  const shown = dice.slice(0, RDIE_MAX_SHOWN);
  shown.forEach((face, i) => {
    const { die, setNum } = buildRolledDie(face.sides, i);
    if (face.hunger) die.classList.add('hunger');
    if (face.dropped) die.classList.add('dropped');
    if (still) die.classList.add('still');
    tray.appendChild(die);
    tumbleDie(die, setNum, face, still ? 0 : i * RDIE_STAGGER_MS, still ? 0 : RDIE_TUMBLE_MS);
  });
  if (dice.length > shown.length) {
    const more = document.createElement('span');
    more.className = 'rdie-more';
    more.textContent = '+' + (dice.length - shown.length);
    tray.appendChild(more);
  }
  return { tray, landMs: still ? 150 : (shown.length - 1) * RDIE_STAGGER_MS + RDIE_TUMBLE_MS };
}
/** Bannière du bas avec dés animés, pour tous les jets (joueurs et MJ). Renvoie le délai avant le résultat (ms). */
function showRollBanner(roll) {
  const wrap = document.createElement('div');
  wrap.className = 'roll-banner';
  const dice = rolledDiceOf(roll);
  let face;
  let revealMs = 650;
  if (dice.length) {
    const t = buildDiceTray(dice);
    face = t.tray;
    revealMs = t.landMs + 80;
    wrap.classList.add('has-dice');
  } else {
    face = document.createElement('span');
    face.className = 'rb-face';
    face.textContent = DIE_FACES[0];
  }
  const info = document.createElement('div');
  info.className = 'rb-info';
  const who = document.createElement('div');
  who.className = 'rb-who';
  who.textContent = roll.by + (roll.private ? ' 🔒' : '');
  const result = document.createElement('div');
  result.className = 'rb-result';
  result.textContent = '…';
  info.append(who, result);
  wrap.append(face, info);
  $('rollBanner').appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));

  let i = 0;
  const spin = dice.length ? null : setInterval(() => { face.textContent = DIE_FACES[i++ % DIE_FACES.length]; }, 90);
  setTimeout(() => {
    if (spin) {
      clearInterval(spin);
      face.textContent = '🎲';
      face.classList.add('land');
    }
    result.textContent = '';
    appendRollDetail(result, roll);
    if (rollHasCrit(roll)) {
      wrap.classList.add('crit');
      if (spin) face.classList.add('crit-land');
      const badge = document.createElement('div');
      badge.className = 'rb-crit-badge';
      badge.textContent = '✨ Critique !';
      info.appendChild(badge);
    }
    if (roll.outcome === 'overreach') {
      wrap.classList.add('overreach');
      const badge = document.createElement('div');
      badge.className = 'rb-crit-badge rb-overreach-badge';
      badge.textContent = `⚡ Overreach ! Danger +${roll.dangerDelta}`;
      info.appendChild(badge);
    } else if (roll.outcome === 'despair') {
      wrap.classList.add('botch');
      const badge = document.createElement('div');
      badge.className = 'rb-crit-badge rb-botch-badge';
      badge.textContent = '💀 Despair !';
      info.appendChild(badge);
    } else if (roll.difficulty == null && computeRollBotch(roll)) {
      wrap.classList.add('botch');
      const badge = document.createElement('div');
      badge.className = 'rb-crit-badge rb-botch-badge';
      badge.textContent = '💀 Échec critique !';
      info.appendChild(badge);
    }
  }, revealMs);

  setTimeout(() => {
    wrap.classList.remove('show');
    setTimeout(() => wrap.remove(), 300);
  }, revealMs + 8750);
  return revealMs;
}
/** d10 hors valeur 10 : 6-9 = réussite (vert), sinon échec (rouge). */
function d10Class(v) { return v >= 6 ? 'ok' : 'fail'; }
/** Vrai si le jet contient au moins une paire de 10 sur un terme en d10. */
function rollHasCrit(r) {
  return r.parts.some((p) => p.type === 'dice' && p.sides === 10 && !p.dropped.length && p.values.filter((v) => v === 10).length >= 2);
}
/** Nombre de réussites d'un pool de d10 : +1 par dé entre 6 et 10 inclus, +2 par paire de 10. */
function d10Successes(values) {
  const tens = values.filter((v) => v === 10).length;
  const hits = values.filter((v) => v >= 6).length;
  return hits + Math.floor(tens / 2) * 2;
}
/** Somme les réussites de tous les termes en d10 "purs" (non tronqués par kh/kl) d'un jet ; null si aucun. */
function computeRollSuccesses(r) {
  let found = false;
  let total = 0;
  r.parts.forEach((p) => {
    if (p.type !== 'dice' || p.sides !== 10 || p.dropped.length) return;
    found = true;
    total += d10Successes(p.values);
  });
  return found ? total : null;
}
/** Échec critique façon WoD : 0 réussite ET au moins un 1 sur un terme en d10 pur. */
function computeRollBotch(r) {
  const succ = computeRollSuccesses(r);
  if (succ == null || succ > 0) return false;
  return r.parts.some((p) => p.type === 'dice' && p.sides === 10 && !p.dropped.length && p.values.includes(1));
}
/** Indices des termes en d10 purs (non tronqués par kh/kl) d'un jet. */
function pureD10Indices(r) {
  const idx = [];
  r.parts.forEach((p, i) => { if (p.type === 'dice' && p.sides === 10 && !p.dropped.length) idx.push(i); });
  return idx;
}
/** Convention client (et serveur pour Overreach/Despair) : dans un jet à deux termes d10 purs, le second est le pool Désespoir/Danger. */
function hungerPoolIndex(r) {
  const idx = pureD10Indices(r);
  return idx.length === 2 ? idx[1] : -1;
}
/** Note informative sur le pool Désespoir (1 et 10 obtenus) ; l'effet réel (Overreach/Despair) est calculé côté serveur quand une difficulté est fournie. */
function hungerNote(p) {
  if (!p) return '';
  const ones = p.values.filter((v) => v === 1).length;
  const tens = p.values.filter((v) => v === 10).length;
  const bits = [];
  if (ones) bits.push(`⚠ ${ones} sur d${ones > 1 ? 'és' : 'é'} Désespoir`);
  if (tens) bits.push(`✨ ${tens} sur d${tens > 1 ? 'és' : 'é'} Désespoir`);
  return bits.length ? '  ·  ' + bits.join(' ') : '';
}
function buildTermNode(p, i, isHunger) {
  const wrap = document.createElement('span');
  if (p.type === 'mod') {
    wrap.textContent = (i && p.value >= 0 ? '+' : '') + p.value;
    return wrap;
  }
  const sign = p.sign < 0 ? '-' : i ? '+' : '';
  if (p.sides === 10 && !p.dropped.length) {
    const tens = p.values.filter((v) => v === 10).length;
    const pairedTens = Math.floor(tens / 2) * 2; // seuls les 10 appariés (par deux) sont critiques
    let tenSeen = 0;
    if (sign) wrap.appendChild(document.createTextNode(sign + ' '));
    if (isHunger) wrap.appendChild(document.createTextNode('Désespoir '));
    wrap.appendChild(document.createTextNode('('));
    const sorted = [...p.values].sort((a, b) => b - a);
    sorted.forEach((v, idx) => {
      if (idx) wrap.appendChild(document.createTextNode(' - '));
      const span = document.createElement('span');
      let cls;
      if (v === 10) {
        tenSeen++;
        cls = tenSeen <= pairedTens ? 'crit' : 'ok';
      } else {
        cls = d10Class(v);
      }
      span.className = 'dv ' + (isHunger ? 'hunger-' + cls : cls);
      span.textContent = v;
      wrap.appendChild(span);
    });
    wrap.appendChild(document.createTextNode(')'));
  } else {
    const vals = p.values.map((v, idx) => (p.dropped.includes(idx) ? '(' + v + ')' : String(v)));
    wrap.textContent = `${sign}d${p.sides}[${vals.join(',')}]`;
  }
  return wrap;
}
function buildDiceFragment(r) {
  const frag = document.createDocumentFragment();
  const hIdx = hungerPoolIndex(r);
  r.parts.forEach((p, i) => {
    if (i) frag.appendChild(document.createTextNode(' '));
    frag.appendChild(buildTermNode(p, i, i === hIdx));
  });
  return frag;
}
function successSuffix(r) {
  if (r.difficulty != null) {
    let s = `  ·  ${r.successes}${r.successes === 1 ? ' réussite' : ' réussites'} / difficulté ${r.difficulty}  ·  ${r.passed ? 'RÉUSSI' : 'RATÉ'}`;
    if (r.outcome === 'overreach') s += `  ·  ⚡ Overreach (Danger +${r.dangerDelta})`;
    else if (r.outcome === 'despair') s += '  ·  💀 Despair';
    return s;
  }
  const succ = computeRollSuccesses(r);
  if (succ == null) return '';
  if (succ === 0 && computeRollBotch(r)) return '  ·  Échec critique';
  return `  ·  ${succ}${succ === 1 ? ' réussite' : ' réussites'}`;
}
function appendRollDetail(container, r) {
  container.appendChild(buildDiceFragment(r));
  const hIdx = hungerPoolIndex(r);
  container.appendChild(document.createTextNode(' = ' + r.total + successSuffix(r) + (hIdx >= 0 ? hungerNote(r.parts[hIdx]) : '')));
}
function renderDiceLog() {
  const ul = $('diceLog');
  ul.textContent = '';
  for (const r of rolls) {
    const li = document.createElement('li');
    if (r.private) li.classList.add('secret');
    const head = document.createElement('div');
    head.className = 'dr-head';
    const who = document.createElement('span');
    who.textContent = r.by + (r.role === 'gm' ? ' (MJ)' : '') + (r.private ? ' 🔒' : '');
    const total = document.createElement('span');
    total.className = 'dr-total';
    const detail = document.createElement('div');
    detail.className = 'dr-detail';
    total.textContent = r.total;
    detail.appendChild(document.createTextNode(r.expr + '  →  '));
    detail.appendChild(buildDiceFragment(r));
    const hIdx = hungerPoolIndex(r);
    detail.appendChild(document.createTextNode(successSuffix(r) + (hIdx >= 0 ? hungerNote(r.parts[hIdx]) : '')));
    if (r.outcome === 'despair' || (r.difficulty == null && computeRollBotch(r))) li.classList.add('botch');
    if (r.outcome === 'overreach') li.classList.add('overreach');
    head.append(who, total);
    li.append(head, detail);
    ul.appendChild(li);
  }
  ul.scrollTop = ul.scrollHeight;
}
function sendRoll(expr, opts = {}) {
  expr = String(expr || '').trim();
  if (!expr) return;
  const msg = { t: 'roll', expr, private: $('rollSecret').checked };
  if (opts.difficulty != null) msg.difficulty = opts.difficulty;
  send(msg);
}
function quickRoll(sides) {
  const count = Math.min(100, Math.max(1, parseInt($('rollCount').value, 10) || 1));
  $('rollCount').value = count;
  // Avantage/Désavantage : un seul dé gardé ; avec plusieurs dés, on les lance tous normalement.
  let expr = count > 1 ? `${count}d${sides}`
    : rollAdv === 'adv' ? `2d${sides}kh1` : rollAdv === 'dis' ? `2d${sides}kl1` : `1d${sides}`;
  const mod = parseInt($('rollMod').value, 10) || 0;
  if (mod) expr += (mod > 0 ? '+' : '') + mod;
  sendRoll(expr);
}
document.querySelectorAll('.die').forEach((b) => {
  b.addEventListener('click', () => quickRoll(parseInt(b.dataset.sides, 10)));
});
document.querySelectorAll('#dicePanel [data-adv]').forEach((b) => {
  b.addEventListener('click', () => {
    rollAdv = b.dataset.adv;
    document.querySelectorAll('#dicePanel [data-adv]').forEach((x) => setRadioOn(x, x === b));
  });
});
$('rollForm').addEventListener('submit', (e) => {
  e.preventDefault();
  sendRoll($('rollFormula').value);
  $('rollFormula').value = '';
});
$('poolForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const normal = Math.max(0, parseInt($('poolNormal').value, 10) || 0);
  const hunger = Math.max(0, parseInt($('poolHunger').value, 10) || 0);
  if (!normal && !hunger) return;
  const terms = [];
  if (normal) terms.push(`${normal}d10`);
  if (hunger) terms.push(`${hunger}d10`);
  const difficulty = clampDifficulty(parseInt($('poolDifficulty').value, 10));
  sendRoll(terms.join('+'), { difficulty });
});
function clampDifficulty(v) {
  return Math.min(20, Math.max(1, Number.isFinite(v) ? v : 3));
}
$('btnDice').addEventListener('click', () => document.body.classList.toggle('dice-closed'));
closeOnEscape(() => !document.body.classList.contains('dice-closed'), () => document.body.classList.add('dice-closed'));

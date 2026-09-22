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
  if (roll.role === 'gm') flashRoll(roll);
  else showRollBanner(roll);
}
/** Bannière du bas, plus visible, pour les jets des joueurs (pas ceux du MJ). */
function showRollBanner(roll) {
  const wrap = document.createElement('div');
  wrap.className = 'roll-banner';
  const face = document.createElement('span');
  face.className = 'rb-face';
  face.textContent = DIE_FACES[0];
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
  const spin = setInterval(() => { face.textContent = DIE_FACES[i++ % DIE_FACES.length]; }, 90);
  setTimeout(() => {
    clearInterval(spin);
    face.textContent = '🎲';
    result.textContent = '';
    appendRollDetail(result, roll);
    face.classList.add('land');
    if (rollHasCrit(roll)) {
      wrap.classList.add('crit');
      face.classList.add('crit-land');
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
  }, 650);

  setTimeout(() => {
    wrap.classList.remove('show');
    setTimeout(() => wrap.remove(), 300);
  }, 9400);
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
function flashRoll(roll) {
  const el = document.createElement('div');
  el.className = 'roll-flash';
  const who = document.createElement('span');
  who.textContent = roll.by + (roll.private ? ' (secret)' : '') + ' :';
  const total = document.createElement('span');
  total.className = 'rf-total';
  total.textContent = roll.total;
  el.append(who, total);
  $('diceFlash').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 3800);
}
function sendRoll(expr, opts = {}) {
  expr = String(expr || '').trim();
  if (!expr) return;
  const msg = { t: 'roll', expr, private: $('rollSecret').checked };
  if (opts.difficulty != null) msg.difficulty = opts.difficulty;
  send(msg);
}
function quickRoll(sides) {
  let expr = rollAdv === 'adv' ? `2d${sides}kh1` : rollAdv === 'dis' ? `2d${sides}kl1` : `1d${sides}`;
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
    document.querySelectorAll('#dicePanel [data-adv]').forEach((x) => x.classList.toggle('on', x === b));
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

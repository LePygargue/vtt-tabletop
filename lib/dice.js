'use strict';
/**
 * Dés : analyse des formules, tirage aléatoire côté serveur, visibilité des jets.
 */
const crypto = require('crypto');

const DICE_TERM_RE = /^(\d{1,3})d(\d{1,4})(k[hl]\d{1,3})?$/;

/** Découpe une formule ("2d6+1d4-3", "2d20kh1"...) en termes ; renvoie null si invalide. */
function parseDiceExpr(expr) {
  const clean = String(expr == null ? '' : expr).replace(/\s+/g, '').toLowerCase();
  if (!clean || clean.length > 60) return null;
  const terms = [];
  let diceCount = 0;
  for (const m of clean.matchAll(/([+-]?)([^+-]+)/g)) {
    const sign = m[1] === '-' ? -1 : 1;
    const body = m[2];
    const dm = body.match(DICE_TERM_RE);
    if (dm) {
      const count = parseInt(dm[1], 10);
      const sides = parseInt(dm[2], 10);
      if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null;
      diceCount += count;
      if (diceCount > 100) return null;
      let keep = null;
      if (dm[3]) {
        const n = parseInt(dm[3].slice(2), 10);
        if (n < 1 || n > count) return null;
        keep = { mode: dm[3][1], n };
      }
      terms.push({ type: 'dice', sign, count, sides, keep });
    } else if (/^\d{1,6}$/.test(body)) {
      terms.push({ type: 'mod', sign, value: parseInt(body, 10) });
    } else return null;
  }
  return terms.length && terms.length <= 12 ? terms : null;
}

/** Exécute les termes déjà validés (aléa serveur) ; renvoie le total et le détail par terme. */
function rollExpr(terms) {
  const parts = [];
  let total = 0;
  terms.forEach((term, i) => {
    if (term.type === 'mod') {
      const value = term.sign * term.value;
      total += value;
      parts.push({ type: 'mod', value });
      return;
    }
    const values = [];
    for (let j = 0; j < term.count; j++) values.push(crypto.randomInt(1, term.sides + 1));
    let dropped = [];
    let keptSum = values.reduce((a, b) => a + b, 0);
    if (term.keep) {
      const order = values.map((_, idx) => idx).sort((a, b) => values[b] - values[a]);
      const keepSet = new Set(term.keep.mode === 'h' ? order.slice(0, term.keep.n) : order.slice(-term.keep.n));
      dropped = values.map((_, idx) => idx).filter((idx) => !keepSet.has(idx));
      keptSum = values.reduce((sum, v, idx) => (keepSet.has(idx) ? sum + v : sum), 0);
    }
    total += keptSum * term.sign;
    parts.push({ type: 'dice', sides: term.sides, sign: term.sign, values, dropped });
  });
  return { total, parts };
}

/** Réussites d'un pool de d10 façon WoD : +1 par dé ≥6, +2 par paire de 10 appariée. */
function d10Successes(values) {
  const tens = values.filter((v) => v === 10).length;
  const hits = values.filter((v) => v >= 6).length;
  return hits + Math.floor(tens / 2) * 2;
}

/** Un jet privé n'est visible que du MJ et de son auteur. */
function rollVisible(roll, client) {
  if (!roll.private) return true;
  if (client.role === 'gm') return true;
  return !!client.playerId && roll.ownerKey === client.playerId;
}
function broadcastRoll(room, roll) {
  const data = JSON.stringify({ t: 'rollResult', roll });
  for (const c of room.clients) {
    if (!c.ws.closed && rollVisible(roll, c)) c.ws.send(data);
  }
}

module.exports = { parseDiceExpr, rollExpr, rollVisible, broadcastRoll, d10Successes };

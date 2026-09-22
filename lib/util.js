'use strict';
/**
 * Utilitaires génériques : identifiants, comparaisons, nettoyage de chaînes.
 */
const crypto = require('crypto');

const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomId(len) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return s;
}
const randomHex = (n) => crypto.randomBytes(n).toString('hex');
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const cleanName = (s, fallback) => {
  const t = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24);
  return t || fallback;
};
const isColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

module.exports = { randomId, randomHex, safeEqual, clamp, isNum, cleanName, isColor };

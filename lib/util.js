'use strict';
/**
 * Utilitaires génériques : identifiants, comparaisons, nettoyage de chaînes, limitation de débit.
 */
const crypto = require('crypto');

const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomId(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += ID_ALPHABET[crypto.randomInt(ID_ALPHABET.length)]; // sans biais de modulo
  return s;
}
const randomHex = (n) => crypto.randomBytes(n).toString('hex');
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** Texte d'une ligne : sans caractères de contrôle ni chevrons, tronqué à `max`. */
const cleanText = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const cleanName = (s, fallback) => cleanText(s, 24) || fallback;
/** Comme cleanText, mais conserve les retours à la ligne (fiches, notes). */
const cleanMultiline = (s, max) => String(s == null ? '' : s)
  .replace(/\r\n/g, '\n')
  .replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f<>]/g, '')
  .trim()
  .slice(0, max);
const isColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

/**
 * Limiteur à fenêtre glissante : au plus `max` actions par `windowMs` et par clé (IP...).
 * Les clés inactives sont purgées périodiquement pour ne pas grossir indéfiniment.
 */
function createRateLimiter(max, windowMs) {
  const log = new Map(); // clé -> horodatages récents
  setInterval(() => {
    const now = Date.now();
    for (const [key, arr] of log) if (now - arr[arr.length - 1] >= windowMs) log.delete(key);
  }, windowMs).unref();
  return function allow(key) {
    const now = Date.now();
    const arr = (log.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      log.set(key, arr);
      return false;
    }
    arr.push(now);
    log.set(key, arr);
    return true;
  };
}

module.exports = {
  randomId, randomHex, safeEqual, clamp, clampInt, isNum, cleanText, cleanName, cleanMultiline, isColor, createRateLimiter,
};

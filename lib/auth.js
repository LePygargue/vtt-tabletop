'use strict';
/**
 * Authentification HTTP : cookie de session, résolution de l'utilisateur courant.
 */
const { getSession } = require('./sessions');
const { users } = require('./users');
const { createRateLimiter } = require('./util');

const COOKIE_NAME = 'sid';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) { try { out[k] = decodeURIComponent(v); } catch { out[k] = v; } }
  }
  return out;
}

/** Résout l'utilisateur courant à partir de l'en-tête Cookie d'une requête HTTP. */
function userFromCookieHeader(cookieHeader) {
  const cookies = parseCookies(cookieHeader);
  const session = getSession(cookies[COOKIE_NAME]);
  if (!session) return null;
  return users.get(session.userId) || null;
}

function cookieAttrs(token, maxAgeSec, secure) {
  const attrs = [`${COOKIE_NAME}=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}
function setSessionCookie(res, token, secure) {
  res.setHeader('Set-Cookie', cookieAttrs(token, 30 * 24 * 3600, secure));
}
function clearSessionCookie(res, secure) {
  res.setHeader('Set-Cookie', cookieAttrs('', 0, secure));
}

// Limitation simple des tentatives de connexion : 20 essais par heure et par IP.
const allowLoginAttempt = createRateLimiter(20, 3600e3);

module.exports = { COOKIE_NAME, parseCookies, userFromCookieHeader, setSessionCookie, clearSessionCookie, allowLoginAttempt };

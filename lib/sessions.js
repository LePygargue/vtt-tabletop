'use strict';
/**
 * Sessions de connexion et tickets WebSocket, entièrement en mémoire (non
 * persistés : un redémarrage du serveur déconnecte tout le monde).
 *
 * Les tickets existent parce qu'une WebSocket de navigateur ne permet pas de
 * poser un en-tête personnalisé lors de la poignée de main : le client
 * échange son cookie de session contre un ticket à usage unique (courte
 * durée de vie) via une requête HTTP authentifiée, puis l'ajoute à l'URL du
 * WebSocket.
 */
const crypto = require('crypto');

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 jours
const TICKET_TTL_MS = 20 * 1000; // 20 secondes, à usage unique

const sessions = new Map(); // token -> { userId, expiresAt }
const tickets = new Map(); // ticket -> { userId, expiresAt }

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}
function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return s;
}
function destroySession(token) {
  if (token) sessions.delete(token);
}

function createTicket(userId) {
  const ticket = crypto.randomBytes(24).toString('hex');
  tickets.set(ticket, { userId, expiresAt: Date.now() + TICKET_TTL_MS });
  return ticket;
}
/** À usage unique : le ticket est retiré dès sa consultation, valide ou non. */
function consumeTicket(ticket) {
  if (!ticket) return null;
  const t = tickets.get(ticket);
  tickets.delete(ticket);
  if (!t || Date.now() > t.expiresAt) return null;
  return t;
}

function purgeExpired() {
  const now = Date.now();
  for (const [token, s] of sessions) if (now > s.expiresAt) sessions.delete(token);
  for (const [ticket, t] of tickets) if (now > t.expiresAt) tickets.delete(ticket);
}

module.exports = { createSession, getSession, destroySession, createTicket, consumeTicket, purgeExpired };

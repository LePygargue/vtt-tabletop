'use strict';
/**
 * Diffusion : envoi ciblé ou groupé de messages aux clients d'un salon.
 */
function send(client, msg) {
  if (client.ws && !client.ws.closed) client.ws.send(JSON.stringify(msg));
}
/** opts : { gmOnly, playersOnly, except, allowPlayerIds, exceptPlayerIds } (les deux derniers, des Set, ne filtrent que les clients "joueur" ; le MJ passe toujours) */
function broadcast(room, msg, opts = {}) {
  const data = JSON.stringify(msg);
  for (const c of room.clients) {
    if (c === opts.except) continue;
    if (opts.gmOnly && c.role !== 'gm') continue;
    if (opts.playersOnly && c.role === 'gm') continue;
    if (c.role === 'player' && opts.allowPlayerIds && !opts.allowPlayerIds.has(c.playerId)) continue;
    if (c.role === 'player' && opts.exceptPlayerIds && opts.exceptPlayerIds.has(c.playerId)) continue;
    if (!c.ws.closed) c.ws.send(data);
  }
}
/** Envoie un événement de jeton en respectant le flag "caché" et les dérogations (visibleTo). */
function broadcastToken(room, msg, token, except) {
  broadcast(room, msg, { except, allowPlayerIds: token.hidden ? new Set(token.visibleTo || []) : undefined });
}
/** Diffuse un événement de trait en respectant le calque MJ (caché des joueurs). */
function broadcastStroke(room, msg, stroke, except) {
  broadcast(room, msg, { gmOnly: stroke.layer === 'gm', except });
}
/** Envoie un événement d'image en respectant le flag "caché". */
function broadcastImage(room, msg, image, except) {
  broadcast(room, msg, { gmOnly: !!image.hidden, except });
}
/** Diffuse une fiche de personnage à sa/son propriétaire et au MJ, à personne d'autre. */
function broadcastSheet(room, msg, playerId, except) {
  const data = JSON.stringify(msg);
  for (const c of room.clients) {
    if (c === except) continue;
    if (c.role !== 'gm' && c.playerId !== playerId) continue;
    if (!c.ws.closed) c.ws.send(data);
  }
}
/** Jetons des joueurs actuellement connectés (sans doublon si un joueur a plusieurs onglets). */
function onlineTokenIds(room) {
  const online = new Set();
  for (const c of room.clients) {
    const p = c.playerId && room.players.get(c.playerId);
    if (p && p.tokenId) online.add(p.tokenId);
  }
  return [...online];
}
function broadcastOnline(room) {
  broadcast(room, { t: 'online', tokenIds: onlineTokenIds(room) });
}

module.exports = { send, broadcast, broadcastToken, broadcastStroke, broadcastImage, broadcastSheet, onlineTokenIds, broadcastOnline };

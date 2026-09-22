'use strict';
/**
 * Diffusion : envoi ciblé ou groupé de messages aux clients d'un salon.
 */
function send(client, msg) {
  if (client.ws && !client.ws.closed) client.ws.send(JSON.stringify(msg));
}
/** opts : { gmOnly, playersOnly, except } */
function broadcast(room, msg, opts = {}) {
  const data = JSON.stringify(msg);
  for (const c of room.clients) {
    if (c === opts.except) continue;
    if (opts.gmOnly && c.role !== 'gm') continue;
    if (opts.playersOnly && c.role === 'gm') continue;
    if (!c.ws.closed) c.ws.send(data);
  }
}
/** Envoie un événement de jeton en respectant le flag "caché". */
function broadcastToken(room, msg, token, except) {
  if (!token.hidden) return broadcast(room, msg, { except });
  broadcast(room, msg, { gmOnly: true, except });
}
/** Diffuse un événement de trait en respectant le calque MJ (caché des joueurs). */
function broadcastStroke(room, msg, stroke, except) {
  broadcast(room, msg, { gmOnly: stroke.layer === 'gm', except });
}
/** Envoie un événement d'image en respectant le flag "caché". */
function broadcastImage(room, msg, image, except) {
  if (!image.hidden) return broadcast(room, msg, { except });
  broadcast(room, msg, { gmOnly: true, except });
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
function broadcastOnline(room) {
  const online = new Set();
  for (const c of room.clients) {
    if (c.role === 'player' && c.playerId) {
      const p = room.players.get(c.playerId);
      if (p && p.tokenId) online.add(p.tokenId);
    }
  }
  broadcast(room, { t: 'online', tokenIds: [...online] });
}

module.exports = { send, broadcast, broadcastToken, broadcastStroke, broadcastImage, broadcastSheet, broadcastOnline };

'use strict';
/**
 * Plateau JDR : serveur HTTP + WebSocket, sans aucune dépendance (Node >= 20).
 * Les salons sont gardés en mémoire et sauvegardés dans data/rooms/<id>.json (un fichier par salon).
 * Le code est découpé par bloc dans lib/ (config, util, rooms, net, dice, protocol, ws, http).
 */
const http = require('http');
const { PORT, HOST } = require('./lib/config');
const { rooms, loadRooms, saveNow } = require('./lib/rooms');
const { loadUsers } = require('./lib/users');
const { purgeExpired } = require('./lib/sessions');
const { handleRequest, json } = require('./lib/http');
const { handleUpgrade, startHeartbeat } = require('./lib/ws');

loadUsers();
loadRooms();
startHeartbeat();
setInterval(purgeExpired, 5 * 60 * 1000).unref();

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Erreur serveur.' });
    else res.end();
  });
});
server.on('upgrade', handleUpgrade);

function shutdown() {
  saveNow();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`Plateau JDR : http://localhost:${PORT}  (${rooms.size} salon(s) chargé(s))`));
}
module.exports = { server };

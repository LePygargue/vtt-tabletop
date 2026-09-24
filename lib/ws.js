'use strict';
/**
 * WebSocket minimal (RFC 6455) : messages texte uniquement, sans dépendance.
 */
const crypto = require('crypto');
const { users } = require('./users');
const { consumeTicket } = require('./sessions');
const { handleMessage } = require('./protocol');
const { broadcastOnline } = require('./net');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_MAX_PAYLOAD = 256 * 1024;

const sockets = new Set(); // toutes les connexions ouvertes, y compris celles n'ayant pas (encore) rejoint de salon

class WS {
  constructor(socket, onMessage, onClose) {
    this.socket = socket;
    this.closed = false;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragsLen = 0;
    this.alive = true;
    this.onMessage = onMessage;
    this.onClose = onClose;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
    sockets.add(this);
  }

  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (!this.closed) {
      const buf = this.buf;
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(WS_MAX_PAYLOAD)) return this.close(1009);
        len = Number(big);
        off = 10;
      }
      if (!masked || len > WS_MAX_PAYLOAD) return this.close(1002);
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = buf.subarray(off + 4 + len);

      if (opcode === 0x8) return this.close(1000);
      if (opcode === 0x9) {
        this.frame(0xa, payload);
        continue;
      }
      if (opcode === 0xa) {
        this.alive = true;
        continue;
      }
      if (opcode === 0x1 || opcode === 0x0) {
        if (opcode === 0x1) {
          this.frags = [];
          this.fragsLen = 0;
        }
        this.frags.push(payload);
        this.fragsLen += payload.length;
        if (this.fragsLen > WS_MAX_PAYLOAD) return this.close(1009);
        if (fin) {
          const text = Buffer.concat(this.frags, this.fragsLen).toString('utf8');
          this.frags = [];
          this.fragsLen = 0;
          try {
            this.onMessage(text);
          } catch (e) {
            console.error('Erreur de traitement :', e);
          }
        }
      } else {
        return this.close(1003); // binaire non pris en charge
      }
    }
  }

  frame(opcode, payload) {
    if (this.closed || this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | opcode, len]);
    else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(text) {
    this.frame(0x1, Buffer.from(text, 'utf8'));
  }

  close(code = 1000) {
    if (this.closed) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code, 0);
    this.frame(0x8, p);
    this.socket.end();
    this.finish();
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    sockets.delete(this);
    this.socket.destroy();
    this.onClose();
  }
}

function handleUpgrade(req, socket) {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  const origin = req.headers.origin;
  let originOk = true;
  if (origin) {
    try {
      originOk = new URL(origin).host === req.headers.host;
    } catch {
      originOk = false;
    }
  }
  if (url.pathname !== '/ws' || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !originOk) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  // Une WebSocket de navigateur ne peut pas poser d'en-tête personnalisé : l'identité
  // passe par un ticket à usage unique, obtenu via /api/ws-ticket (authentifié par cookie).
  const consumed = consumeTicket(url.searchParams.get('ticket'));
  const user = consumed && users.get(consumed.userId);
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  const client = { ws: null, room: null, role: null, playerId: null, user };
  client.ws = new WS(
    socket,
    (text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      handleMessage(client, msg);
    },
    () => {
      if (client.room) {
        for (const [id, c] of client.room.workplace.openStrokes) {
          if (c === client) client.room.workplace.openStrokes.delete(id);
        }
        client.room.clients.delete(client);
        broadcastOnline(client.room);
      }
    }
  );
  // Un message reçu avec la requête d'upgrade (rare) est déjà dans l'événement 'data'.
}

function startHeartbeat() {
  return setInterval(() => {
    for (const ws of sockets) {
      if (!ws.alive) {
        ws.finish();
        continue;
      }
      ws.alive = false;
      ws.frame(0x9, Buffer.alloc(0));
    }
  }, 30000).unref();
}

module.exports = { WS, handleUpgrade, startHeartbeat };

'use strict';
/**
 * Routes HTTP : authentification, création de salon, upload de carte, fichiers statiques.
 */
const fs = require('fs');
const path = require('path');
const { MAX_UPLOAD, MAX_PORTRAIT_UPLOAD, MAX_ROOMS, MAX_IMAGES, UPLOAD_DIR, PUBLIC_DIR, MIME, SECURITY_HEADERS } = require('./config');
const { randomHex, safeEqual, cleanName, createRateLimiter } = require('./util');
const { rooms, createRoom, scheduleSave, deleteRoom } = require('./rooms');
const { addImage, removeImageFile, setNpcPortrait } = require('./protocol');
const { send } = require('./net');
const { findByUsername, verifyPassword, publicUser } = require('./users');
const { createSession, destroySession, createTicket } = require('./sessions');
const { COOKIE_NAME, parseCookies, userFromCookieHeader, setSessionCookie, clearSessionCookie, allowLoginAttempt } = require('./auth');

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(obj));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end();
}

function isSecure(req) {
  return !!req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
}

function serveFile(res, file, extraHeaders = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      return res.end('Introuvable');
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, ...SECURITY_HEADERS, ...extraHeaders });
    fs.createReadStream(file).pipe(res);
  });
}

function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 6 && buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too_large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const body = await readBody(req, limit);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  }
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
}

// Limitation simple : 30 créations de salon par heure et par IP.
const allowCreate = createRateLimiter(30, 3600e3);

function emptyResponse(res, status) {
  res.writeHead(status, SECURITY_HEADERS);
  res.end();
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const user = userFromCookieHeader(req.headers.cookie);

  /* -------------------------------------------------------------- */
  /* Authentification                                                */
  /* -------------------------------------------------------------- */
  if (req.method === 'POST' && p === '/api/login') {
    if (!allowLoginAttempt(clientIp(req))) return json(res, 429, { error: 'Trop de tentatives, réessaie plus tard.' });
    const body = await readJson(req, 10 * 1024);
    const target = body && findByUsername(body.username);
    if (!body || !(await verifyPassword(target, body.password))) return json(res, 401, { error: 'Identifiants invalides.' });
    const token = createSession(target.id);
    setSessionCookie(res, token, isSecure(req));
    return json(res, 200, { ok: true, user: publicUser(target) });
  }

  if (req.method === 'POST' && p === '/api/logout') {
    const cookies = parseCookies(req.headers.cookie);
    destroySession(cookies[COOKIE_NAME]);
    clearSessionCookie(res, isSecure(req));
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && p === '/api/me') {
    return json(res, user ? 200 : 401, user ? { user: publicUser(user) } : { error: 'Non connecté.' });
  }

  if (req.method === 'GET' && p === '/api/ws-ticket') {
    if (!user) return json(res, 401, { error: 'Non connecté.' });
    return json(res, 200, { ticket: createTicket(user.id) });
  }

  /* -------------------------------------------------------------- */
  /* Salons (réservés aux comptes connus)                             */
  /* -------------------------------------------------------------- */
  if (p.startsWith('/api/rooms') && !user) return json(res, 401, { error: 'Connecte-toi pour continuer.' });

  if (req.method === 'POST' && p === '/api/rooms') {
    if (rooms.size >= MAX_ROOMS || !allowCreate(clientIp(req))) return json(res, 429, { error: 'Trop de salons créés, réessaie plus tard.' });
    const room = createRoom();
    scheduleSave(room);
    return json(res, 200, { id: room.id, gmKey: room.gmKey });
  }

  let m = p.match(/^\/api\/rooms\/([A-Z0-9]{8})$/i);
  if (req.method === 'GET' && m) {
    const room = rooms.get(m[1].toUpperCase());
    return json(res, room ? 200 : 404, room ? { exists: true, name: room.name || null } : { exists: false });
  }
  if (req.method === 'DELETE' && m) {
    const room = rooms.get(m[1].toUpperCase());
    if (!room) return json(res, 404, { error: 'Salon introuvable.' });
    if (!safeEqual(req.headers['x-gm-key'] || '', room.gmKey)) return json(res, 403, { error: 'Réservé au MJ.' });
    for (const image of room.images.values()) removeImageFile(image);
    for (const token of room.tokens.values()) if (token.portrait) removeImageFile({ url: token.portrait });
    for (const client of room.clients) {
      send(client, { t: 'error', code: 'room_deleted', message: 'Ce salon a été supprimé par le MJ.' });
      client.ws.close();
    }
    deleteRoom(room);
    return json(res, 200, { ok: true });
  }

  m = p.match(/^\/api\/rooms\/([A-Z0-9]{8})\/image$/i);
  if (req.method === 'POST' && m) {
    const room = rooms.get(m[1].toUpperCase());
    if (!room) return json(res, 404, { error: 'Salon introuvable.' });
    if (!safeEqual(req.headers['x-gm-key'] || '', room.gmKey)) return json(res, 403, { error: 'Réservé au MJ.' });
    if (room.images.size >= MAX_IMAGES) return json(res, 429, { error: "Trop d'images dans ce salon, supprimes-en une avant d'en ajouter." });
    let body;
    try {
      body = await readBody(req, MAX_UPLOAD);
    } catch (e) {
      return json(res, e.status || 400, { error: 'Image trop lourde (20 Mo maximum).' });
    }
    const ext = sniffImage(body);
    const w = Math.round(Number(url.searchParams.get('w')));
    const h = Math.round(Number(url.searchParams.get('h')));
    const cx = Number(url.searchParams.get('cx'));
    const cy = Number(url.searchParams.get('cy'));
    if (!ext) return json(res, 415, { error: 'Format non pris en charge (PNG, JPEG, WebP ou GIF).' });
    if (!(w >= 100 && w <= 8000 && h >= 100 && h <= 8000)) return json(res, 400, { error: 'Dimensions invalides (100 à 8000 px).' });
    const file = `${room.id}-${randomHex(6)}.${ext}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, file), body);
    const name = cleanName(url.searchParams.get('name'), '') || undefined;
    addImage(room, { url: '/uploads/' + file, width: w, height: h, name, cx, cy });
    return json(res, 200, { ok: true });
  }

  // Portrait d'un PNJ (MJ uniquement), montré aux joueurs qui cliquent sur son jeton
  m = p.match(/^\/api\/rooms\/([A-Z0-9]{8})\/tokens\/([0-9a-z]{1,40})\/portrait$/i);
  if (req.method === 'POST' && m) {
    const room = rooms.get(m[1].toUpperCase());
    if (!room) return json(res, 404, { error: 'Salon introuvable.' });
    if (!safeEqual(req.headers['x-gm-key'] || '', room.gmKey)) return json(res, 403, { error: 'Réservé au MJ.' });
    const token = room.tokens.get(m[2]);
    if (!token || token.owner) return json(res, 404, { error: 'PNJ introuvable.' });
    let body;
    try {
      body = await readBody(req, MAX_PORTRAIT_UPLOAD);
    } catch (e) {
      return json(res, e.status || 400, { error: 'Portrait trop lourd (5 Mo maximum).' });
    }
    const ext = sniffImage(body);
    if (!ext) return json(res, 415, { error: 'Format non pris en charge (PNG, JPEG, WebP ou GIF).' });
    const file = `${room.id}-${randomHex(6)}.${ext}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, file), body);
    if (!room.tokens.has(token.id)) { // PNJ supprimé pendant l'envoi
      removeImageFile({ url: '/uploads/' + file });
      return json(res, 404, { error: 'PNJ introuvable.' });
    }
    setNpcPortrait(room, token, '/uploads/' + file);
    return json(res, 200, { ok: true });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return emptyResponse(res, 405);

  /* -------------------------------------------------------------- */
  /* Pages                                                            */
  /* -------------------------------------------------------------- */
  if (p === '/login' || p === '/login.html') {
    if (user) return redirect(res, '/');
    return serveFile(res, path.join(PUBLIC_DIR, 'login.html'), { 'Cache-Control': 'no-cache' });
  }
  if (p === '/' || p === '/index.html') {
    if (!user) return redirect(res, '/login');
    return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), { 'Cache-Control': 'no-cache' });
  }
  if (/^\/r\/[A-Z0-9]{8}\/?$/i.test(p)) {
    if (!user) return redirect(res, '/login');
    return serveFile(res, path.join(PUBLIC_DIR, 'room.html'), { 'Cache-Control': 'no-cache' });
  }

  if (p.startsWith('/uploads/')) {
    if (!user) return emptyResponse(res, 404);
    const name = path.basename(p);
    if (!/^[A-Z0-9]{8}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/.test(name)) return emptyResponse(res, 404);
    const room = rooms.get(name.slice(0, 8));
    if (!room || !(room.players.has(user.id) || room.gmUserIds.has(user.id))) return emptyResponse(res, 404);
    return serveFile(res, path.join(UPLOAD_DIR, name), { 'Cache-Control': 'private, max-age=2592000, immutable' });
  }

  // fichiers statiques (protégé contre ../) : accessibles sans connexion (CSS, JS, aucune donnée sensible)
  let decoded;
  try {
    decoded = decodeURIComponent(p);
  } catch {
    return emptyResponse(res, 400); // séquence %xx invalide
  }
  const rel = path.normalize(decoded).replace(/^([/\\])+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return emptyResponse(res, 403);
  return serveFile(res, file, { 'Cache-Control': 'no-cache' });
}

module.exports = { handleRequest, json };

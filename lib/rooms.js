'use strict';
/**
 * Modèle des salons : création, persistance, et projection de l'état pour les clients.
 * Un salon a un espace de travail unique (room.workplace) : une grille commune
 * illimitée, avec sa grille, son brouillard de guerre (creux, cases révélées) et
 * ses traits de dessin. Les images (room.images) sont des objets indépendants
 * posés sur cette grille, jamais recadrées ni redimensionnées après ajout, que le
 * MJ peut déplacer/afficher/cacher. Chaque jeton (room.tokens) vit librement sur
 * cette même grille (plus de lien à une carte). Fiches, journaux et jets de dés
 * restent au niveau du salon. Un journal (room.journals) est une liste d'entrées
 * horodatées par joueur, comme une fiche : privé, sauf pour le MJ qui peut le
 * consulter (jamais l'écrire).
 */
const fs = require('fs');
const path = require('path');
const { STATE_FILE, ROOMS_DIR, ROOM_TTL_MS, PALETTE, MAX_FOG_CELLS, MAX_DANGER, MAX_DESPERATION } = require('./config');
const { randomId, randomHex, clamp } = require('./util');
const { rollVisible } = require('./dice');
const { defaultSheet, pubSheet } = require('./sheets');

const rooms = new Map();

function cellKey(cx, cy) {
  return `${cx},${cy}`;
}

function createWorkplace() {
  return {
    grid: { size: 50, visible: true, snap: true },
    fog: { enabled: false, revealed: new Set() }, // cases révélées, clé "cx,cy" (1 = révélé)
    strokes: new Map(), // traits de dessin partagés
    openStrokes: new Map(), // id de trait -> client (verrou pendant le tracé, non persisté)
  };
}

/** Reprojette les cases révélées d'une ancienne taille de case vers une nouvelle. */
function remapFog(fog, oldSize, newSize) {
  if (oldSize === newSize || !fog.revealed.size) return;
  const next = new Set();
  outer: for (const key of fog.revealed) {
    const [ox, oy] = key.split(',').map(Number);
    const x0 = ox * oldSize, y0 = oy * oldSize, x1 = x0 + oldSize, y1 = y0 + oldSize;
    const nx0 = Math.floor(x0 / newSize), nx1 = Math.floor((x1 - 1) / newSize);
    const ny0 = Math.floor(y0 / newSize), ny1 = Math.floor((y1 - 1) / newSize);
    for (let ny = ny0; ny <= ny1; ny++) {
      for (let nx = nx0; nx <= nx1; nx++) {
        next.add(cellKey(nx, ny));
        if (next.size >= MAX_FOG_CELLS) break outer;
      }
    }
  }
  fog.revealed = next;
}

function createRoom() {
  const room = {
    id: randomId(8),
    gmKey: randomHex(24),
    name: null, // nom personnalisé donné par le MJ (facultatif, sinon on affiche l'id)
    createdAt: Date.now(),
    lastActive: Date.now(),
    workplace: createWorkplace(),
    images: new Map(), // id -> image (voir addImage dans protocol.js)
    imageOrderSeq: 0,
    tokens: new Map(),
    players: new Map(), // playerId -> { name, tokenId }
    sheets: new Map(), // playerId -> fiche de personnage
    journals: new Map(), // playerId -> [{ id, ts, text }]
    npcSheets: new Map(), // tokenId -> fiche PNJ rapide (MJ uniquement)
    initiative: { active: false, round: 1, turnIndex: 0, entries: [] }, // { tokenId, score }[]
    danger: 0, // niveau de dangerosité de la scène (façon étoiles GTA), 0..MAX_DANGER
    desperation: 0, // Désespoir : jauge partagée par toute la cellule (Hunter), 0..MAX_DESPERATION
    clients: new Set(), // connexions en ligne (non persisté)
    rolls: [], // historique des jets de dés (non persisté)
  };
  rooms.set(room.id, room);
  return room;
}

function serializeWorkplace(w) {
  return {
    grid: w.grid,
    fog: { enabled: w.fog.enabled, cells: [...w.fog.revealed] },
    strokes: [...w.strokes.values()],
  };
}

function serializeImage(img) {
  return {
    id: img.id, name: img.name, url: img.url, width: img.width, height: img.height,
    x: img.x, y: img.y, hidden: !!img.hidden, locked: !!img.locked, order: img.order, createdAt: img.createdAt,
  };
}

function serializeRoom(r) {
  return {
    id: r.id,
    gmKey: r.gmKey,
    name: r.name || null,
    createdAt: r.createdAt,
    lastActive: r.lastActive,
    workplace: serializeWorkplace(r.workplace),
    images: [...r.images.values()].map(serializeImage),
    imageOrderSeq: r.imageOrderSeq,
    tokens: [...r.tokens.values()],
    players: [...r.players.entries()].map(([playerId, p]) => ({ playerId, ...p })),
    sheets: [...r.sheets.entries()].map(([playerId, sheet]) => ({ playerId, sheet })),
    journals: [...r.journals.entries()].map(([playerId, entries]) => ({ playerId, entries })),
    npcSheets: [...r.npcSheets.entries()].map(([tokenId, sheet]) => ({ tokenId, sheet })),
    initiative: r.initiative,
    danger: r.danger,
    desperation: r.desperation,
  };
}

function loadWorkplace(s) {
  const w = {
    grid: { size: 50, visible: true, snap: true, ...(s && s.grid) },
    fog: { enabled: !!(s && s.fog && s.fog.enabled), revealed: new Set((s && s.fog && s.fog.cells) || []) },
    strokes: new Map(((s && s.strokes) || []).map((st) => [st.id, st])),
    openStrokes: new Map(),
  };
  return w;
}

function loadImage(s) {
  if (!s || !s.id || !s.url) return null;
  return {
    id: s.id,
    name: s.name || 'Image',
    url: s.url,
    width: Number(s.width) || 100,
    height: Number(s.height) || 100,
    x: Number(s.x) || 0,
    y: Number(s.y) || 0,
    hidden: !!s.hidden,
    locked: !!s.locked,
    order: Number.isFinite(s.order) ? s.order : 0,
    createdAt: s.createdAt || Date.now(),
  };
}

/** Reconstruit un salon en mémoire à partir de son snapshot JSON (nouveau ou ancien format). */
function buildRoom(s, now) {
  const room = {
    id: s.id,
    gmKey: s.gmKey,
    name: s.name || null,
    createdAt: s.createdAt || now,
    lastActive: s.lastActive || now,
    workplace: createWorkplace(),
    images: new Map(),
    imageOrderSeq: Number(s.imageOrderSeq) || 0,
    tokens: new Map((s.tokens || []).map((t) => [t.id, t])),
    players: new Map((s.players || []).map((p) => [p.playerId, { name: p.name, tokenId: p.tokenId }])),
    sheets: new Map((s.sheets || []).map((sh) => [sh.playerId, sh.sheet])),
    journals: new Map((s.journals || []).map((j) => [j.playerId, Array.isArray(j.entries) ? j.entries : []])),
    npcSheets: new Map((s.npcSheets || []).map((n) => [n.tokenId, n.sheet])),
    initiative: (s.initiative && typeof s.initiative === 'object')
      ? {
        active: !!s.initiative.active,
        round: Number(s.initiative.round) || 1,
        turnIndex: Number(s.initiative.turnIndex) || 0,
        entries: Array.isArray(s.initiative.entries) ? s.initiative.entries : [],
      }
      : { active: false, round: 1, turnIndex: 0, entries: [] },
    danger: clamp(Number(s.danger) || 0, 0, MAX_DANGER),
    desperation: clamp(Number(s.desperation) || 0, 0, MAX_DESPERATION),
    clients: new Set(),
    rolls: [],
  };
  if (s.workplace) {
    // Nouveau format : workplace unique + images.
    room.workplace = loadWorkplace(s.workplace);
    for (const si of s.images || []) {
      const img = loadImage(si);
      if (img) room.images.set(img.id, img);
    }
  }
  // Ancien format (room.maps/openMapIds, ou le très vieux room.map/grid/fog/strokes) :
  // pas de migration, le salon repart avec un workplace/images vides. Les jetons
  // gardent leurs coordonnées telles quelles (le monde est illimité) ; un éventuel
  // `token.mapId` résiduel est simplement ignoré.
  for (const t of room.tokens.values()) delete t.mapId;
  return room;
}

/** Migration unique de l'ancien fichier agrégé (data/rooms.json) vers un fichier par salon. */
function migrateLegacyStateFile(now) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return false;
  }
  for (const s of raw.rooms || []) {
    if (!s || !s.id || now - (s.lastActive || 0) > ROOM_TTL_MS) continue;
    rooms.set(s.id, buildRoom(s, now));
  }
  for (const room of rooms.values()) saveRoomNow(room);
  try {
    fs.renameSync(STATE_FILE, STATE_FILE + '.migrated');
  } catch (e) {
    console.error('Impossible de finaliser la migration de rooms.json :', e.message);
  }
  return true;
}

function loadRooms() {
  const now = Date.now();
  if (fs.existsSync(STATE_FILE) && migrateLegacyStateFile(now)) return;

  let files;
  try {
    files = fs.readdirSync(ROOMS_DIR);
  } catch {
    return;
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(ROOMS_DIR, f);
    let s;
    try {
      s = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch {
      continue;
    }
    if (!s || !s.id || now - (s.lastActive || 0) > ROOM_TTL_MS) {
      try { fs.unlinkSync(full); } catch { /* tant pis, retentera au prochain démarrage */ }
      continue;
    }
    rooms.set(s.id, buildRoom(s, now));
  }
}

const saveTimers = new Map(); // room.id -> Timeout, sauvegarde différée par salon
function touch(room) {
  room.lastActive = Date.now();
  scheduleSave(room);
}
function scheduleSave(room) {
  if (saveTimers.has(room.id)) return;
  saveTimers.set(room.id, setTimeout(() => {
    saveTimers.delete(room.id);
    saveRoomNow(room);
  }, 1000));
}
function saveRoomNow(room) {
  const file = path.join(ROOMS_DIR, `${room.id}.json`);
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(serializeRoom(room)));
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error(`Sauvegarde du salon ${room.id} impossible :`, e.message);
  }
}
/** Sauvegarde immédiate de tous les salons (arrêt du serveur), sans attendre le débounce. */
function saveNow() {
  for (const timer of saveTimers.values()) clearTimeout(timer);
  saveTimers.clear();
  for (const room of rooms.values()) saveRoomNow(room);
}

/** Supprime définitivement un salon : mémoire, sauvegarde différée en attente, et fichier sur disque. */
function deleteRoom(room) {
  const timer = saveTimers.get(room.id);
  if (timer) {
    clearTimeout(timer);
    saveTimers.delete(room.id);
  }
  rooms.delete(room.id);
  try { fs.unlinkSync(path.join(ROOMS_DIR, `${room.id}.json`)); } catch { /* déjà absent */ }
}

function snapCoord(v, g, size) {
  const even = size >= 1 && Math.round(size) % 2 === 0;
  return even ? Math.round(v / g) * g : (Math.floor(v / g) + 0.5) * g;
}
/** Version d'un jeton envoyée aux clients : jamais l'identifiant secret du joueur (owner). */
function pub(t) {
  return { id: t.id, name: t.name, color: t.color, size: t.size, x: t.x, y: t.y, hidden: !!t.hidden, pc: !!t.owner, conditions: t.conditions || [] };
}
function publicTokens(room, role) {
  return [...room.tokens.values()].filter((t) => role === 'gm' || !t.hidden).map(pub);
}
function fogSnapshot(fog) {
  return {
    enabled: fog.enabled,
    cells: [...fog.revealed].map((k) => k.split(',').map(Number)),
  };
}
/** Version d'un trait envoyée aux clients : jamais l'auteur (identité protégée comme pour les jetons). */
function pubStroke(s) {
  return { id: s.id, tool: s.tool, color: s.color, width: s.width, layer: s.layer, points: s.points, a: s.a, b: s.b };
}
/** Version d'une image envoyée aux clients. */
function pubImage(img) {
  return { id: img.id, name: img.name, url: img.url, x: img.x, y: img.y, width: img.width, height: img.height, hidden: !!img.hidden, locked: !!img.locked, order: img.order };
}
/** Version d'une entrée de journal envoyée aux clients : reshape explicite (rien de secret pour l'instant). */
function pubJournalEntry(e) {
  return { id: e.id, ts: e.ts, text: e.text };
}
/**
 * Version de l'état d'initiative envoyée aux clients : entrées résolues (nom/couleur),
 * jetons cachés filtrés pour les joueurs. On envoie `activeTokenId` plutôt qu'un index
 * de tableau, car la liste `entries` n'a pas la même longueur pour le MJ (tout) et les
 * joueurs (jetons cachés retirés) — un index serait donc incohérent entre les deux.
 */
function pubInitiative(room, role) {
  const init = room.initiative;
  const entries = init.entries
    .map((e) => {
      const t = room.tokens.get(e.tokenId);
      if (!t) return null;
      if (role !== 'gm' && t.hidden) return null;
      return { tokenId: e.tokenId, score: e.score, name: t.name, color: t.color };
    })
    .filter(Boolean);
  const activeEntry = init.active ? init.entries[init.turnIndex] : null;
  const activeToken = activeEntry ? room.tokens.get(activeEntry.tokenId) : null;
  const activeTokenId = activeToken && (role === 'gm' || !activeToken.hidden) ? activeToken.id : null;
  return { active: init.active, round: init.round, activeTokenId, entries };
}
function stateFor(room, client) {
  const online = [];
  for (const c of room.clients) {
    const p = c.playerId && room.players.get(c.playerId);
    if (p && p.tokenId) online.push(p.tokenId);
  }
  const w = room.workplace;
  return {
    t: 'state',
    role: client.role,
    roomId: room.id,
    roomName: room.name || null,
    playerId: client.playerId || null,
    youToken: client.playerId ? (room.players.get(client.playerId) || {}).tokenId || null : null,
    grid: w.grid,
    fog: fogSnapshot(w.fog),
    strokes: [...w.strokes.values()].filter((s) => client.role === 'gm' || s.layer !== 'gm').map(pubStroke),
    images: [...room.images.values()].filter((i) => client.role === 'gm' || !i.hidden).sort((a, b) => a.order - b.order).map(pubImage),
    tokens: publicTokens(room, client.role),
    sheet: client.role === 'player' ? pubSheet(room.sheets.get(client.playerId) || defaultSheet()) : undefined,
    journal: client.role === 'player' ? (room.journals.get(client.playerId) || []).map(pubJournalEntry) : undefined,
    initiative: pubInitiative(room, client.role),
    danger: room.danger,
    desperation: room.desperation,
    online,
    rolls: room.rolls.filter((r) => rollVisible(r, client)),
  };
}

function newPlayerToken(room, name, playerId, color) {
  const g = room.workplace.grid.size;
  const n = room.tokens.size;
  const token = {
    id: randomHex(6),
    name,
    color: color || PALETTE[n % PALETTE.length],
    size: 1,
    x: snapCoord(((n % 5) - 2) * g, g, 1),
    y: snapCoord((Math.floor(n / 5) % 4) * g, g, 1),
    owner: playerId,
    hidden: false,
    conditions: [],
  };
  room.tokens.set(token.id, token);
  return token;
}

module.exports = {
  rooms, cellKey, createWorkplace, remapFog, createRoom, serializeRoom, loadRooms, touch, scheduleSave, saveNow, deleteRoom,
  snapCoord, pub, publicTokens, fogSnapshot, pubStroke, pubImage, pubJournalEntry, pubInitiative, stateFor, newPlayerToken,
};

'use strict';
/**
 * Traitement des messages WebSocket : connexion au salon et logique de jeu
 * (jetons, grille, brouillard, dessin, images, dés). Tout se joue sur la grille
 * commune unique du salon (room.workplace) ; les images (room.images) sont des
 * objets indépendants posés dessus, jamais recadrées ni redimensionnées après
 * ajout. Un jeton n'appartient plus à une carte : ses coordonnées sont libres sur
 * la grille illimitée.
 */
const fs = require('fs');
const path = require('path');
const {
  MAX_TOKENS, MAX_STROKES, MAX_STROKE_POINTS, MAX_IMAGES, MAX_FOG_CELLS, MAX_JOURNAL_ENTRIES, MAX_JOURNAL_ENTRY_LEN,
  MAX_TOKEN_CONDITIONS, MAX_CONDITION_LEN, MAX_DANGER, MAX_DESPERATION, STROKE_TOOLS, STROKE_ID_RE, UPLOAD_DIR, MAX_ROLL_HISTORY,
} = require('./config');
const { randomHex, safeEqual, clamp, isNum, cleanName, isColor } = require('./util');
const {
  rooms, cellKey, remapFog, touch, snapCoord, pub, publicTokens, fogSnapshot, pubStroke, pubImage, pubJournalEntry,
  pubInitiative, stateFor, newPlayerToken,
} = require('./rooms');
const { send, broadcast, broadcastToken, broadcastStroke, broadcastImage, broadcastSheet, broadcastOnline } = require('./net');
const { parseDiceExpr, rollExpr, broadcastRoll, d10Successes } = require('./dice');
const { defaultSheet, applySheetPatch, pubSheet, cleanMultiline } = require('./sheets');
const { defaultNpcSheet, applyNpcPatch } = require('./npc');

function handleJoin(client, msg) {
  if (client.room) return;
  const room = rooms.get(String(msg.room || '').toUpperCase());
  if (!room) return send(client, { t: 'error', code: 'no_room', message: "Ce salon n'existe pas." });

  if (msg.gmKey && safeEqual(msg.gmKey, room.gmKey)) {
    client.role = 'gm';
  } else {
    client.role = 'player';
    // L'identité vient du compte authentifié (pas du message client) : stable
    // sur tous les appareils, contrairement à l'ancien playerId en localStorage.
    const pid = client.user.id;
    client.playerId = pid;
    let p = room.players.get(pid);
    if (!p) {
      p = { name: client.user.displayName, tokenId: null };
      room.players.set(pid, p);
    }
    let token = p.tokenId && room.tokens.get(p.tokenId);
    if (!token) {
      if (room.tokens.size >= MAX_TOKENS) return send(client, { t: 'error', code: 'full', message: 'Trop de jetons dans ce salon.' });
      token = newPlayerToken(room, p.name, pid, client.user.color);
      p.tokenId = token.id;
      broadcastToken(room, { t: 'tokenUpsert', token: pub(token) }, token);
    }
  }
  client.room = room;
  room.clients.add(client);
  touch(room);
  send(client, stateFor(room, client));
  broadcastOnline(room);
}

function handleMessage(client, msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
  if (msg.t === 'join') return handleJoin(client, msg);
  const room = client.room;
  if (!room) return;
  const isGM = client.role === 'gm';
  const w = room.workplace;

  switch (msg.t) {
    case 'move': {
      const token = room.tokens.get(msg.id);
      if (!token || !isNum(msg.x) || !isNum(msg.y)) return;
      if (!isGM && token.owner !== client.playerId) return;
      const g = w.grid.size;
      let x = msg.x;
      let y = msg.y;
      if (msg.final && w.grid.snap) {
        x = snapCoord(x, g, token.size);
        y = snapCoord(y, g, token.size);
      }
      token.x = x;
      token.y = y;
      const out = { t: 'move', id: token.id, x: token.x, y: token.y, final: !!msg.final };
      // le déplacement final est renvoyé aussi à l'émetteur (position aimantée)
      broadcastToken(room, out, token, msg.final ? null : client);
      if (msg.final) touch(room);
      return;
    }

    case 'tokenAdd': {
      if (!isGM || room.tokens.size >= MAX_TOKENS) return;
      const size = [0.5, 1, 2, 3, 4].includes(msg.size) ? msg.size : 1;
      const token = {
        id: randomHex(6),
        name: cleanName(msg.name, 'PNJ'),
        color: isColor(msg.color) ? msg.color : '#888888',
        size,
        x: isNum(msg.x) ? msg.x : 0,
        y: isNum(msg.y) ? msg.y : 0,
        owner: null,
        hidden: !!msg.hidden,
        conditions: [],
      };
      if (w.grid.snap) {
        token.x = snapCoord(token.x, w.grid.size, size);
        token.y = snapCoord(token.y, w.grid.size, size);
      }
      room.tokens.set(token.id, token);
      broadcastToken(room, { t: 'tokenUpsert', token: pub(token) }, token);
      send(client, { t: 'selectToken', id: token.id });
      touch(room);
      return;
    }

    case 'tokenUpdate': {
      const token = room.tokens.get(msg.id);
      const patch = msg.patch;
      if (!token || !patch || typeof patch !== 'object') return;
      const mine = token.owner && token.owner === client.playerId;
      if (!isGM && !mine) return;
      const wasHidden = token.hidden;
      if ('name' in patch) {
        token.name = cleanName(patch.name, token.name);
        if (mine) {
          const p = room.players.get(client.playerId);
          if (p) p.name = token.name;
        }
      }
      if ('color' in patch && isColor(patch.color)) token.color = patch.color;
      if ('conditions' in patch && Array.isArray(patch.conditions)) {
        token.conditions = patch.conditions
          .slice(0, MAX_TOKEN_CONDITIONS)
          .map((c) => cleanName(c, '').slice(0, MAX_CONDITION_LEN))
          .filter(Boolean);
      }
      if (isGM) {
        if ('size' in patch && [0.5, 1, 2, 3, 4].includes(patch.size)) token.size = patch.size;
        if ('hidden' in patch) token.hidden = !!patch.hidden;
      }
      if (!wasHidden && token.hidden) {
        broadcast(room, { t: 'tokenRemove', id: token.id }, { playersOnly: true });
        broadcast(room, { t: 'tokenUpsert', token: pub(token) }, { gmOnly: true });
      } else {
        broadcastToken(room, { t: 'tokenUpsert', token: pub(token) }, token);
      }
      if (wasHidden !== token.hidden && room.initiative.entries.some((e) => e.tokenId === token.id)) {
        broadcastInitiative(room);
      }
      touch(room);
      return;
    }

    case 'tokenRemove': {
      const token = room.tokens.get(msg.id);
      if (!isGM || !token || token.owner) return; // les jetons de joueurs ne se suppriment pas
      room.tokens.delete(token.id);
      room.npcSheets.delete(token.id);
      const idx = room.initiative.entries.findIndex((e) => e.tokenId === token.id);
      if (idx !== -1) {
        room.initiative.entries.splice(idx, 1);
        if (room.initiative.turnIndex > idx) room.initiative.turnIndex--;
        broadcastInitiative(room);
      }
      broadcast(room, { t: 'tokenRemove', id: token.id });
      touch(room);
      return;
    }

    case 'imageMove': {
      if (!isGM) return;
      const image = room.images.get(msg.id);
      if (!image || !isNum(msg.x) || !isNum(msg.y) || image.locked) return;
      image.x = msg.x;
      image.y = msg.y;
      image.order = ++room.imageOrderSeq;
      const out = { t: 'imageMove', id: image.id, x: image.x, y: image.y, final: !!msg.final };
      broadcastImage(room, out, image, msg.final ? null : client);
      if (msg.final) touch(room);
      return;
    }

    case 'imageUpdate': {
      if (!isGM) return;
      const image = room.images.get(msg.id);
      const patch = msg.patch;
      if (!image || !patch || typeof patch !== 'object') return;
      const wasHidden = image.hidden;
      if ('name' in patch) image.name = cleanName(patch.name, image.name);
      if ('hidden' in patch) image.hidden = !!patch.hidden;
      if ('locked' in patch) image.locked = !!patch.locked;
      if (!wasHidden && image.hidden) {
        broadcast(room, { t: 'imageRemove', id: image.id }, { playersOnly: true });
        broadcast(room, { t: 'imageUpsert', image: pubImage(image) }, { gmOnly: true });
      } else {
        broadcastImage(room, { t: 'imageUpsert', image: pubImage(image) }, image);
      }
      touch(room);
      return;
    }

    case 'imageReorder': {
      if (!isGM || !Array.isArray(msg.ids)) return;
      const seen = new Set();
      const ordered = [];
      for (const id of msg.ids) {
        if (typeof id !== 'string' || seen.has(id)) continue;
        const image = room.images.get(id);
        if (!image) continue;
        seen.add(id);
        ordered.push(image);
      }
      // Toute image non citée (message tronqué, image ajoutée entretemps) garde sa place relative, en fin de liste.
      for (const image of [...room.images.values()].sort((a, b) => a.order - b.order)) {
        if (!seen.has(image.id)) ordered.push(image);
      }
      ordered.forEach((image, i) => { image.order = i; });
      room.imageOrderSeq = ordered.length;
      broadcast(room, { t: 'imagesOrder', order: ordered.map((i) => i.id) }, { gmOnly: true });
      broadcast(room, { t: 'imagesOrder', order: ordered.filter((i) => !i.hidden).map((i) => i.id) }, { playersOnly: true });
      touch(room);
      return;
    }

    case 'imageRemove': {
      if (!isGM) return;
      const image = room.images.get(msg.id);
      if (!image) return;
      removeImageFile(image);
      room.images.delete(image.id);
      broadcast(room, { t: 'imageRemove', id: image.id });
      touch(room);
      return;
    }

    case 'grid': {
      if (!isGM) return;
      const oldSize = w.grid.size;
      if (isNum(msg.size)) w.grid.size = clamp(Math.round(msg.size), 20, 200);
      if ('visible' in msg) w.grid.visible = !!msg.visible;
      if ('snap' in msg) w.grid.snap = !!msg.snap;
      remapFog(w.fog, oldSize, w.grid.size);
      broadcast(room, { t: 'grid', grid: w.grid, fog: fogSnapshot(w.fog) });
      touch(room);
      return;
    }

    case 'room': {
      if (!isGM) return;
      if ('name' in msg) {
        const raw = String(msg.name == null ? '' : msg.name).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60);
        room.name = raw || null;
        broadcast(room, { t: 'room', name: room.name });
        touch(room);
      }
      return;
    }

    case 'fog': {
      if (!isGM) return;
      const f = w.fog;
      if (msg.op === 'enabled') {
        f.enabled = !!msg.value;
        broadcast(room, { t: 'fogEnabled', enabled: f.enabled });
      } else if (msg.op === 'fill') {
        f.revealed.clear();
        broadcast(room, { t: 'fog', fog: fogSnapshot(f) });
      } else if (msg.op === 'paint' && Array.isArray(msg.cells)) {
        const v = msg.value ? 1 : 0;
        const cells = [];
        for (const c of msg.cells.slice(0, 5000)) {
          if (!Array.isArray(c) || c.length !== 2) continue;
          const [cx, cy] = c;
          if (!Number.isInteger(cx) || !Number.isInteger(cy) || Math.abs(cx) > 1e5 || Math.abs(cy) > 1e5) continue;
          const key = cellKey(cx, cy);
          if (v) {
            if (!f.revealed.has(key)) {
              if (f.revealed.size >= MAX_FOG_CELLS) continue;
              f.revealed.add(key);
              cells.push([cx, cy]);
            }
          } else if (f.revealed.has(key)) {
            f.revealed.delete(key);
            cells.push([cx, cy]);
          }
        }
        if (cells.length) broadcast(room, { t: 'fogDelta', cells, value: v }, { except: client });
      } else return;
      touch(room);
      return;
    }

    case 'draw': {
      if (msg.op === 'start') {
        if (w.strokes.size >= MAX_STROKES) {
          return send(client, { t: 'error', code: 'strokes_full', message: 'Trop de traits, le MJ doit en effacer.' });
        }
        if (typeof msg.id !== 'string' || !STROKE_ID_RE.test(msg.id) || w.strokes.has(msg.id)) return;
        if (!STROKE_TOOLS.includes(msg.tool) || !isNum(msg.x) || !isNum(msg.y)) return;
        const layer = msg.layer === 'gm' && isGM ? 'gm' : 'shared';
        const x = msg.x;
        const y = msg.y;
        const stroke = {
          id: msg.id,
          tool: msg.tool,
          color: isColor(msg.color) ? msg.color : '#ff2d55',
          width: clamp(isNum(msg.width) ? msg.width : 4, 1, 40),
          layer,
          authorId: isGM ? 'gm' : client.playerId,
          authorRole: client.role,
          points: msg.tool === 'pen' ? [x, y] : undefined,
          a: msg.tool !== 'pen' ? { x, y } : undefined,
          b: msg.tool !== 'pen' ? { x, y } : undefined,
        };
        w.strokes.set(stroke.id, stroke);
        w.openStrokes.set(stroke.id, client);
        broadcastStroke(room, { t: 'drawStart', stroke: pubStroke(stroke) }, stroke, client);
        touch(room);
        return;
      }

      if (msg.op === 'clear') {
        if (!isGM) return;
        w.strokes.clear();
        w.openStrokes.clear();
        broadcast(room, { t: 'drawClear' });
        touch(room);
        return;
      }

      const stroke = w.strokes.get(msg.id);
      if (!stroke) return;

      if (msg.op === 'point') {
        if (w.openStrokes.get(msg.id) !== client) return;
        if (stroke.tool === 'pen') {
          if (!Array.isArray(msg.pts)) return;
          const pts = [];
          for (let i = 0; i + 1 < msg.pts.length && i < 400; i += 2) {
            if (stroke.points.length >= MAX_STROKE_POINTS * 2) break;
            if (!isNum(msg.pts[i]) || !isNum(msg.pts[i + 1])) continue;
            const px = msg.pts[i];
            const py = msg.pts[i + 1];
            stroke.points.push(px, py);
            pts.push(px, py);
          }
          if (pts.length) broadcastStroke(room, { t: 'drawPoint', id: stroke.id, pts }, stroke, client);
        } else {
          if (!isNum(msg.x) || !isNum(msg.y)) return;
          stroke.b = { x: msg.x, y: msg.y };
          broadcastStroke(room, { t: 'drawPoint', id: stroke.id, x: stroke.b.x, y: stroke.b.y }, stroke, client);
        }
        return;
      }

      if (msg.op === 'end') {
        if (w.openStrokes.get(msg.id) !== client) return;
        w.openStrokes.delete(msg.id);
        touch(room);
        return;
      }

      if (msg.op === 'remove') {
        if (!isGM && stroke.authorId !== client.playerId) return;
        w.strokes.delete(msg.id);
        w.openStrokes.delete(msg.id);
        broadcast(room, { t: 'drawRemove', id: msg.id });
        touch(room);
        return;
      }

      return;
    }

    case 'sheet': {
      // Le MJ vise une fiche par le tokenId du joueur (déjà visible dans sa liste de
      // jetons) ; le serveur seul résout le playerId réel, jamais exposé au client.
      // Un joueur non-MJ ne peut cibler que sa propre fiche, quoi qu'il envoie.
      let targetPid;
      if (isGM) {
        const token = room.tokens.get(msg.tokenId);
        if (!token || !token.owner) return;
        targetPid = token.owner;
      } else {
        targetPid = client.playerId;
      }
      const tokenId = (room.players.get(targetPid) || {}).tokenId || null;

      if (msg.op === 'get') {
        send(client, { t: 'sheetData', tokenId, sheet: pubSheet(room.sheets.get(targetPid) || defaultSheet()) });
        return;
      }
      if (msg.op === 'update') {
        const sheet = room.sheets.get(targetPid) || defaultSheet();
        applySheetPatch(sheet, msg.patch);
        room.sheets.set(targetPid, sheet);
        touch(room);
        broadcastSheet(room, { t: 'sheetData', tokenId, sheet: pubSheet(sheet) }, targetPid, null);
        return;
      }
      return;
    }

    case 'journal': {
      // Même résolution de cible que 'sheet' (tokenId -> playerId côté MJ, soi-même
      // sinon). Le MJ peut seulement consulter (op 'get') : le journal est un carnet
      // personnel, jamais modifiable par quelqu'un d'autre que son auteur.
      let targetPid;
      if (isGM) {
        const token = room.tokens.get(msg.tokenId);
        if (!token || !token.owner) return;
        targetPid = token.owner;
      } else {
        targetPid = client.playerId;
      }
      const tokenId = (room.players.get(targetPid) || {}).tokenId || null;
      const entries = room.journals.get(targetPid) || [];

      if (msg.op === 'get') {
        send(client, { t: 'journalData', tokenId, entries: entries.map(pubJournalEntry) });
        return;
      }
      if (isGM) return; // lecture seule pour le MJ

      if (msg.op === 'add') {
        if (entries.length >= MAX_JOURNAL_ENTRIES) {
          return send(client, { t: 'error', code: 'journal_full', message: 'Trop d\'entrées dans le journal, supprimes-en une avant d\'en ajouter.' });
        }
        const text = cleanMultiline(msg.text, MAX_JOURNAL_ENTRY_LEN);
        if (!text) return;
        entries.push({ id: randomHex(6), ts: Date.now(), text });
        room.journals.set(targetPid, entries);
        touch(room);
        broadcastSheet(room, { t: 'journalData', tokenId, entries: entries.map(pubJournalEntry) }, targetPid, null);
        return;
      }
      if (msg.op === 'update') {
        const entry = entries.find((e) => e.id === msg.id);
        const text = cleanMultiline(msg.text, MAX_JOURNAL_ENTRY_LEN);
        if (!entry || !text) return;
        entry.text = text;
        touch(room);
        broadcastSheet(room, { t: 'journalData', tokenId, entries: entries.map(pubJournalEntry) }, targetPid, null);
        return;
      }
      if (msg.op === 'remove') {
        const idx = entries.findIndex((e) => e.id === msg.id);
        if (idx === -1) return;
        entries.splice(idx, 1);
        touch(room);
        broadcastSheet(room, { t: 'journalData', tokenId, entries: entries.map(pubJournalEntry) }, targetPid, null);
        return;
      }
      return;
    }

    case 'initiative': {
      if (!isGM) return;
      const init = room.initiative;
      if (msg.op === 'set') {
        if (!Array.isArray(msg.entries)) return;
        const seen = new Set();
        const entries = [];
        for (const e of msg.entries) {
          if (!e || typeof e !== 'object') continue;
          const token = room.tokens.get(e.tokenId);
          if (!token || seen.has(token.id)) continue;
          seen.add(token.id);
          entries.push({ tokenId: token.id, score: clamp(isNum(e.score) ? e.score : 0, -50, 50) });
        }
        entries.sort((a, b) => b.score - a.score);
        init.entries = entries;
        init.active = entries.length > 0;
        init.round = 1;
        init.turnIndex = 0;
      } else if (msg.op === 'add') {
        const token = room.tokens.get(msg.tokenId);
        if (!token || init.entries.some((e) => e.tokenId === token.id)) return;
        init.entries.push({ tokenId: token.id, score: clamp(isNum(msg.score) ? msg.score : 0, -50, 50) });
        init.entries.sort((a, b) => b.score - a.score);
        init.active = true;
      } else if (msg.op === 'remove') {
        const idx = init.entries.findIndex((e) => e.tokenId === msg.tokenId);
        if (idx === -1) return;
        init.entries.splice(idx, 1);
        if (init.turnIndex > idx) init.turnIndex--;
        if (init.turnIndex >= init.entries.length) init.turnIndex = 0;
        if (!init.entries.length) init.active = false;
      } else if (msg.op === 'score') {
        const entry = init.entries.find((e) => e.tokenId === msg.tokenId);
        if (!entry || !isNum(msg.score)) return;
        const activeId = init.entries[init.turnIndex] ? init.entries[init.turnIndex].tokenId : null;
        entry.score = clamp(msg.score, -50, 50);
        init.entries.sort((a, b) => b.score - a.score);
        if (activeId) init.turnIndex = Math.max(0, init.entries.findIndex((e) => e.tokenId === activeId));
      } else if (msg.op === 'next') {
        if (!init.entries.length) return;
        init.turnIndex++;
        if (init.turnIndex >= init.entries.length) { init.turnIndex = 0; init.round++; }
        init.active = true;
      } else if (msg.op === 'clear') {
        init.active = false;
        init.round = 1;
        init.turnIndex = 0;
        init.entries = [];
      } else return;
      touch(room);
      broadcastInitiative(room);
      return;
    }

    case 'npc': {
      if (!isGM) return;
      const token = room.tokens.get(msg.tokenId);
      if (!token || token.owner) return; // uniquement les jetons PNJ (pas les jetons de joueurs)
      if (msg.op === 'get') {
        send(client, { t: 'npcData', tokenId: token.id, sheet: room.npcSheets.get(token.id) || defaultNpcSheet() });
        return;
      }
      if (msg.op === 'update') {
        const sheet = room.npcSheets.get(token.id) || defaultNpcSheet();
        applyNpcPatch(sheet, msg.patch);
        room.npcSheets.set(token.id, sheet);
        touch(room);
        broadcast(room, { t: 'npcData', tokenId: token.id, sheet }, { gmOnly: true });
        return;
      }
      return;
    }

    case 'danger': {
      if (!isGM || !isNum(msg.level)) return;
      room.danger = clamp(Math.round(msg.level), 0, MAX_DANGER);
      touch(room);
      broadcast(room, { t: 'danger', level: room.danger });
      return;
    }

    case 'desperation': {
      if (!isGM || !isNum(msg.level)) return;
      room.desperation = clamp(Math.round(msg.level), 0, MAX_DESPERATION);
      touch(room);
      broadcast(room, { t: 'desperation', level: room.desperation });
      return;
    }

    case 'roll': {
      const terms = parseDiceExpr(msg.expr);
      if (!terms) return send(client, { t: 'error', code: 'bad_roll', message: 'Formule de dés invalide.' });
      const { total, parts } = rollExpr(terms);
      const name = isGM ? 'MJ' : cleanName((room.players.get(client.playerId) || {}).name, 'Joueur');
      const roll = {
        id: randomHex(6),
        ts: Date.now(),
        by: name,
        role: client.role,
        ownerKey: isGM ? 'gm' : client.playerId,
        kind: 'sum',
        expr: String(msg.expr).slice(0, 60),
        parts,
        total,
        private: !!msg.private,
      };
      // Test à difficulté façon Hunter : si une difficulté est fournie, on calcule
      // réussite/échec et, si un deuxième pool de d10 purs est présent (convention
      // client : le pool Désespoir/Danger), on détecte Overreach/Despair sur les 1
      // obtenus sur CE pool précisément (jamais sur le pool normal).
      if (isNum(msg.difficulty)) {
        const pureD10 = parts.filter((p) => p.type === 'dice' && p.sides === 10 && !p.dropped.length);
        if (pureD10.length) {
          roll.difficulty = clamp(Math.round(msg.difficulty), 1, 50);
          roll.successes = pureD10.reduce((sum, p) => sum + d10Successes(p.values), 0);
          roll.passed = roll.successes >= roll.difficulty;
          if (pureD10.length >= 2) {
            const ones = pureD10[1].values.filter((v) => v === 1).length;
            if (ones > 0) {
              roll.outcome = roll.passed ? 'overreach' : 'despair';
              if (roll.outcome === 'overreach') {
                room.danger = clamp(room.danger + ones, 0, MAX_DANGER);
                roll.dangerDelta = ones;
              }
            }
          }
        }
      }
      room.rolls.push(roll);
      if (room.rolls.length > MAX_ROLL_HISTORY) room.rolls.shift();
      if (roll.outcome === 'overreach') broadcast(room, { t: 'danger', level: room.danger });
      broadcastRoll(room, roll);
      touch(room);
      return;
    }
  }
}

/** Diffuse l'état d'initiative : vue complète au MJ, vue filtrée (jetons cachés retirés) aux joueurs. */
function broadcastInitiative(room) {
  broadcast(room, { t: 'initiative', initiative: pubInitiative(room, 'gm') }, { gmOnly: true });
  broadcast(room, { t: 'initiative', initiative: pubInitiative(room, 'player') }, { playersOnly: true });
}

function removeImageFile(image) {
  if (image.url) {
    const file = path.basename(image.url);
    fs.unlink(path.join(UPLOAD_DIR, file), () => {});
  }
}

/** Ajoute une nouvelle image sur la grille commune du salon (upload HTTP uniquement). */
function addImage(room, { url, width, height, name, cx, cy } = {}) {
  if (room.images.size >= MAX_IMAGES) return null;
  const image = {
    id: randomHex(6),
    name: cleanName(name, '') || `Image ${room.images.size + 1}`,
    url,
    width,
    height,
    x: (isNum(cx) ? cx : 0) - width / 2,
    y: (isNum(cy) ? cy : 0) - height / 2,
    hidden: false,
    locked: false,
    order: ++room.imageOrderSeq,
    createdAt: Date.now(),
  };
  room.images.set(image.id, image);
  broadcast(room, { t: 'imageUpsert', image: pubImage(image) });
  touch(room);
  return image;
}

module.exports = { handleJoin, handleMessage, removeImageFile, addImage };

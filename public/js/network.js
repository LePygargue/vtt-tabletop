'use strict';
/**
 * Connexion WebSocket et répartition des messages reçus.
 */
let ws = null;
let retry = 500;
let stopped = false;

/** Une WebSocket de navigateur ne pouvant pas poser d'en-tête, on échange le
 * cookie de session contre un ticket à usage unique avant d'ouvrir la connexion. */
async function connect() {
  if (stopped) return;
  setConn('connexion…', 'muted');
  let ticket;
  try {
    const r = await fetch('/api/ws-ticket');
    if (r.status === 401) { location.href = '/login'; return; }
    ({ ticket } = await r.json());
  } catch (e) {
    setConn('reconnexion…', 'bad');
    setTimeout(connect, retry);
    retry = Math.min(retry * 1.6, 8000);
    return;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?ticket=${encodeURIComponent(ticket)}`);
  ws.onopen = () => {
    retry = 500;
    setConn('connecté', 'ok');
    send({ t: 'join', room: roomId, gmKey: gmKey || undefined });
  };
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    handle(msg);
  };
  ws.onclose = () => {
    if (stopped) return;
    setConn('reconnexion…', 'bad');
    setTimeout(connect, retry);
    retry = Math.min(retry * 1.6, 8000);
  };
}
function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function renderRoomLabel() {
  const label = roomName ? roomName : 'Salon ' + roomId;
  $('roomLabel').textContent = label;
  $('roomLabel').title = roomName ? 'Salon ' + roomId : '';
  document.title = label + ' — Plateau JDR';
}
function setConn(text, cls) {
  const el = $('conn');
  el.textContent = text;
  el.className = 'badge ' + (cls || 'muted');
}

function handle(m) {
  switch (m.t) {
    case 'state': {
      role = m.role;
      youToken = m.youToken;
      document.body.classList.toggle('is-gm', isGM());
      $('roleBadge').textContent = isGM() ? 'MJ' : 'Joueur';
      roomName = m.roomName || null;
      renderRoomLabel();

      viewport.grid = m.grid;
      setFog(viewport, m.fog);
      viewport.strokes.clear();
      (m.strokes || []).forEach((s) => viewport.strokes.set(s.id, s));

      images.clear();
      (m.images || []).forEach((i) => images.set(i.id, i));

      tokens.clear();
      m.tokens.forEach((t) => tokens.set(t.id, t));
      online = new Set(m.online);
      rolls.length = 0;
      (m.rolls || []).forEach((r) => rolls.push(r));
      renderDiceLog();
      if (isGM()) renderImageList();
      if (m.sheet) { currentSheet = m.sheet; renderSheetForm(); }
      if (m.journal) { currentJournal = m.journal; journalTokenId = youToken; if (!$('journalPanel').hidden) renderJournal(); }
      initiative = m.initiative || initiative;
      renderInitiative();
      dangerLevel = m.danger || 0;
      renderDanger();
      desperationLevel = m.desperation || 0;
      renderDesperation();
      if (youToken && tokens.has(youToken)) {
        selectedId = youToken;
      } else if (selectedId && !tokens.has(selectedId)) selectedId = null;
      viewport.dirty = true;
      if (firstState) { fitViewport(); firstState = false; }
      refreshUI();
      break;
    }
    case 'tokenUpsert': {
      tokens.set(m.token.id, m.token);
      viewport.dirty = true;
      refreshUI();
      break;
    }
    case 'tokenRemove': {
      tokens.delete(m.id);
      npcSheets.delete(m.id);
      if (selectedId === m.id) selectedId = null;
      viewport.dirty = true;
      refreshUI();
      break;
    }
    case 'move': {
      const t = tokens.get(m.id);
      if (!t) break;
      if (viewport.drag && viewport.drag.kind === 'token' && viewport.drag.id === m.id && !m.final) break; // on garde la position locale pendant le glisser
      t.x = m.x;
      t.y = m.y;
      viewport.dirty = true;
      if (m.final && !isGM()) renderTokenList();
      break;
    }
    case 'imageUpsert': {
      images.set(m.image.id, m.image);
      viewport.dirty = true;
      if (isGM()) renderImageList();
      break;
    }
    case 'imageRemove': {
      images.delete(m.id);
      viewport.dirty = true;
      if (isGM()) renderImageList();
      break;
    }
    case 'imagesOrder': {
      m.order.forEach((id, i) => {
        const img = images.get(id);
        if (img) img.order = i;
      });
      viewport.dirty = true;
      if (isGM()) renderImageList();
      break;
    }
    case 'imageMove': {
      const img = images.get(m.id);
      if (!img) break;
      if (viewport.drag && viewport.drag.kind === 'image' && viewport.drag.id === m.id && !m.final) break;
      img.x = m.x;
      img.y = m.y;
      viewport.dirty = true;
      break;
    }
    case 'grid': {
      viewport.grid = m.grid;
      setFog(viewport, m.fog);
      refreshUI();
      break;
    }
    case 'fog': {
      setFog(viewport, m.fog);
      renderTokenList();
      break;
    }
    case 'room': {
      roomName = m.name || null;
      renderRoomLabel();
      break;
    }
    case 'fogEnabled': {
      viewport.fog.enabled = m.enabled;
      viewport.dirty = true;
      refreshUI();
      break;
    }
    case 'fogDelta': {
      m.cells.forEach(([cx, cy]) => applyFogCell(viewport, cx, cy, m.value));
      if (!isGM()) renderTokenList();
      break;
    }
    case 'drawStart': {
      viewport.strokes.set(m.stroke.id, m.stroke);
      viewport.dirty = true;
      break;
    }
    case 'drawPoint': {
      if (viewport.activeStroke && m.id === viewport.activeStroke.id) break; // déjà appliqué en local (optimiste)
      const s = viewport.strokes.get(m.id);
      if (!s) break;
      if (s.tool === 'pen') s.points.push(...m.pts);
      else s.b = { x: m.x, y: m.y };
      viewport.dirty = true;
      break;
    }
    case 'drawRemove': {
      viewport.strokes.delete(m.id);
      viewport.dirty = true;
      break;
    }
    case 'drawClear': {
      viewport.strokes.clear();
      viewport.dirty = true;
      break;
    }
    case 'sheetData':
      currentTokenId = m.tokenId;
      currentSheet = m.sheet;
      renderSheetForm();
      break;
    case 'journalData':
      journalTokenId = m.tokenId;
      currentJournal = m.entries;
      renderJournal();
      break;
    case 'initiative':
      initiative = m.initiative;
      renderInitiative();
      viewport.dirty = true;
      break;
    case 'danger':
      dangerLevel = m.level;
      renderDanger();
      break;
    case 'desperation':
      desperationLevel = m.level;
      renderDesperation();
      break;
    case 'npcData':
      npcSheets.set(m.tokenId, m.sheet);
      if (selectedId === m.tokenId) renderNpcQuick();
      break;
    case 'online':
      online = new Set(m.tokenIds);
      renderTokenList();
      break;
    case 'selectToken':
      selectedId = m.id;
      refreshUI();
      break;
    case 'rollResult':
      addRoll(m.roll);
      break;
    case 'error':
      toast(m.message || 'Erreur');
      if (m.code === 'no_room' || m.code === 'room_deleted') {
        stopped = true;
        setConn(m.code === 'room_deleted' ? 'salon supprimé' : 'salon introuvable', 'bad');
        if (ws) ws.close();
        if (m.code === 'room_deleted') setTimeout(() => { location.href = '/'; }, 1500);
      }
      break;
  }
}

'use strict';
/**
 * Le viewport : la grille commune du salon, affichée dans un unique <canvas>,
 * avec sa caméra (pan/zoom illimités), sa grille, son brouillard et ses traits de
 * dessin. Les jetons (tokens, state.js) et les images (images, state.js) sont des
 * collections partagées au niveau du salon, rendues directement depuis ce
 * viewport. Remplace l'ancien système à plusieurs cartes ouvertes simultanément
 * (viewports.Map, écran scindé).
 */
let viewport = null;

function cellKey(cx, cy) { return `${cx},${cy}`; }

/* ------------------------------------------------------------------ */
/* Caméra                                                              */
/* ------------------------------------------------------------------ */
function toWorld(v, sx, sy) { return { x: (sx - v.cam.x) / v.cam.s, y: (sy - v.cam.y) / v.cam.s }; }
function zoomAt(v, sx, sy, factor) {
  const w = toWorld(v, sx, sy);
  v.cam.s = Math.min(6, Math.max(0.08, v.cam.s * factor));
  v.cam.x = sx - w.x * v.cam.s;
  v.cam.y = sy - w.y * v.cam.s;
  v.dirty = true;
}
/** Recentre la vue sur la boîte englobante des objets visibles ; sinon sur l'origine. */
function fitViewport() {
  const v = viewport;
  if (!v) return;
  const pad = 0.94;
  const cw = v.canvas.clientWidth || 1;
  const ch = v.canvas.clientHeight || 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of tokens.values()) {
    const r = radiusOf(v, t);
    minX = Math.min(minX, t.x - r); maxX = Math.max(maxX, t.x + r);
    minY = Math.min(minY, t.y - r); maxY = Math.max(maxY, t.y + r);
  }
  for (const img of images.values()) {
    if (img.hidden && !isGM()) continue;
    minX = Math.min(minX, img.x); maxX = Math.max(maxX, img.x + img.width);
    minY = Math.min(minY, img.y); maxY = Math.max(maxY, img.y + img.height);
  }
  if (!Number.isFinite(minX)) {
    v.cam.s = 1;
    v.cam.x = cw / 2;
    v.cam.y = ch / 2;
    v.dirty = true;
    return;
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const s = Math.min(cw / w, ch / h, 4) * pad;
  v.cam.s = s;
  v.cam.x = cw / 2 - ((minX + maxX) / 2) * s;
  v.cam.y = ch / 2 - ((minY + maxY) / 2) * s;
  v.dirty = true;
}
function resizeViewport(v) {
  v.dpr = window.devicePixelRatio || 1;
  const cw = v.canvas.clientWidth || 1;
  const ch = v.canvas.clientHeight || 1;
  v.canvas.width = Math.round(cw * v.dpr);
  v.canvas.height = Math.round(ch * v.dpr);
  v.dirty = true;
}

/* ------------------------------------------------------------------ */
/* Brouillard                                                          */
/* ------------------------------------------------------------------ */
function setFog(v, f) {
  v.fog.enabled = f.enabled;
  v.fog.revealed = new Set((f.cells || []).map(([cx, cy]) => cellKey(cx, cy)));
  v.dirty = true;
}
function applyFogCell(v, cx, cy, value) {
  const key = cellKey(cx, cy);
  if (value) v.fog.revealed.add(key);
  else v.fog.revealed.delete(key);
  v.dirty = true;
}
function isFogged(v, wx, wy) {
  if (!v.fog.enabled) return false;
  const cx = Math.floor(wx / v.grid.size);
  const cy = Math.floor(wy / v.grid.size);
  return !v.fog.revealed.has(cellKey(cx, cy));
}

/* ------------------------------------------------------------------ */
/* Images                                                               */
/* ------------------------------------------------------------------ */
function htmlImageFor(v, img) {
  let el = v.htmlImages.get(img.id);
  if (!el) {
    el = new Image();
    el.src = img.url;
    v.htmlImages.set(img.id, el);
    el.onload = () => { v.dirty = true; };
  }
  return el;
}
function sortedImages() {
  return [...images.values()].sort((a, b) => a.order - b.order);
}
function imageAt(v, w) {
  const list = [...images.values()].sort((a, b) => b.order - a.order);
  for (const img of list) {
    if (w.x >= img.x && w.x <= img.x + img.width && w.y >= img.y && w.y <= img.y + img.height) return img;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Rendu                                                               */
/* ------------------------------------------------------------------ */
const radiusOf = (v, t) => (t.size * v.grid.size) / 2 * 0.92;
function textColorFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l > 150 ? '#111' : '#fff';
}

function visibleWorldRect(v) {
  const a = toWorld(v, 0, 0);
  const b = toWorld(v, v.canvas.clientWidth || 1, v.canvas.clientHeight || 1);
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

function drawViewport(v) {
  v.dirty = false;
  const ctx = v.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0a0d0c';
  ctx.fillRect(0, 0, v.canvas.width, v.canvas.height);
  ctx.setTransform(v.dpr * v.cam.s, 0, 0, v.dpr * v.cam.s, v.dpr * v.cam.x, v.dpr * v.cam.y);

  const rect = visibleWorldRect(v);

  // images (jamais recadrées/redimensionnées, taille native)
  for (const img of sortedImages()) {
    const el = htmlImageFor(v, img);
    if (!el.complete || !el.naturalWidth) continue;
    ctx.save();
    if (img.hidden) ctx.globalAlpha = 0.5;
    ctx.drawImage(el, img.x, img.y, img.width, img.height);
    if (img.hidden && isGM()) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1, 2 / v.cam.s);
      ctx.setLineDash([8 / v.cam.s, 6 / v.cam.s]);
      ctx.strokeRect(img.x, img.y, img.width, img.height);
    }
    ctx.restore();
  }

  // grille (par-dessus les images)
  if (v.grid.visible) {
    const g = v.grid.size;
    const x0 = Math.floor(rect.x0 / g) * g, x1 = Math.ceil(rect.x1 / g) * g;
    const y0 = Math.floor(rect.y0 / g) * g, y1 = Math.ceil(rect.y1 / g) * g;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += g) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = y0; y <= y1; y += g) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.strokeStyle = 'rgba(0,0,0,.4)';
    ctx.lineWidth = 2 / v.cam.s;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.lineWidth = 1 / v.cam.s;
    ctx.stroke();
  }

  // brouillard (sous les jetons pour le MJ, cache tout pour les joueurs)
  if (v.fog.enabled) {
    const g = v.grid.size;
    const cx0 = Math.floor(rect.x0 / g), cx1 = Math.floor(rect.x1 / g);
    const cy0 = Math.floor(rect.y0 / g), cy1 = Math.floor(rect.y1 / g);
    ctx.save();
    ctx.fillStyle = '#0d1512';
    ctx.globalAlpha = isGM() ? 0.55 : 1;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (v.fog.revealed.has(cellKey(cx, cy))) continue;
        ctx.fillRect(cx * g, cy * g, g, g);
      }
    }
    ctx.restore();
  }

  // dessins (traits, formes)
  for (const s of v.strokes.values()) drawStroke(v, s);

  // jetons
  const list = [...tokens.values()].sort((a, b) => (a.id === selectedId) - (b.id === selectedId));
  for (const t of list) {
    if (!isGM() && t.id !== youToken && isFogged(v, t.x, t.y)) continue;
    drawToken(v, t);
  }
}

function drawToken(v, t) {
  const ctx = v.ctx;
  const r = radiusOf(v, t);
  ctx.save();
  if (t.hidden) ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
  ctx.fillStyle = t.color;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.08);
  ctx.strokeStyle = t.hidden ? '#fff' : '#0009';
  if (t.hidden) ctx.setLineDash([r * 0.3, r * 0.2]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (t.id === selectedId) {
    ctx.beginPath();
    ctx.arc(t.x, t.y, r + Math.max(3, r * 0.1), 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(2, r * 0.07);
    ctx.stroke();
  } else if (t.id === youToken) {
    ctx.beginPath();
    ctx.arc(t.x, t.y, r + Math.max(2, r * 0.07), 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd24d';
    ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.stroke();
  }
  if (initiative.active && t.id === initiative.activeTokenId) {
    ctx.beginPath();
    ctx.arc(t.x, t.y, r + Math.max(5, r * 0.16), 0, Math.PI * 2);
    ctx.strokeStyle = '#f5c542';
    ctx.lineWidth = Math.max(2, r * 0.09);
    ctx.setLineDash([r * 0.18, r * 0.12]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (t.conditions && t.conditions.length) {
    const bx = t.x + r * 0.72;
    const by = t.y - r * 0.72;
    const br = Math.max(6, r * 0.32);
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = '#8a1f2b';
    ctx.fill();
    ctx.lineWidth = Math.max(1, br * 0.18);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${br * 1.1}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(t.conditions.length), bx, by + br * 0.05);
  }
  // initiales
  const initials = Array.from(t.name).slice(0, 2).join('').toUpperCase();
  ctx.fillStyle = textColorFor(t.color);
  ctx.font = `600 ${Math.max(10, r * 0.85)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, t.x, t.y + r * 0.04);
  // nom sous le jeton
  const fs = Math.max(11 / v.cam.s, v.grid.size * 0.26);
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.lineWidth = fs * 0.28;
  ctx.strokeStyle = '#000c';
  ctx.strokeText(t.name, t.x, t.y + r + fs * 0.15);
  ctx.fillStyle = '#fff';
  ctx.fillText(t.name, t.x, t.y + r + fs * 0.15);
  ctx.restore();
}

function drawStroke(v, s) {
  const ctx = v.ctx;
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.tool === 'pen') {
    const p = s.points;
    if (p && p.length >= 4) {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.stroke();
    } else if (p && p.length === 2) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], s.width / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (s.tool === 'line' || s.tool === 'arrow') {
    const { a, b } = s;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (s.tool === 'arrow') {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const len = Math.max(10, s.width * 3);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - len * Math.cos(ang - Math.PI / 7), b.y - len * Math.sin(ang - Math.PI / 7));
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - len * Math.cos(ang + Math.PI / 7), b.y - len * Math.sin(ang + Math.PI / 7));
      ctx.stroke();
    }
  } else if (s.tool === 'rect') {
    const { a, b } = s;
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else if (s.tool === 'ellipse') {
    const { a, b } = s;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const rx = Math.abs(b.x - a.x) / 2;
    const ry = Math.abs(b.y - a.y) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(rx, 0.01), Math.max(ry, 0.01), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Interactions souris / tactile                                       */
/* ------------------------------------------------------------------ */
function canMove(t) { return isGM() || t.id === youToken; }
function tokenAt(v, w) {
  const list = [...tokens.values()].reverse();
  for (const t of list) {
    if (!isGM() && t.id !== youToken && isFogged(v, t.x, t.y)) continue;
    const r = radiusOf(v, t);
    if ((w.x - t.x) ** 2 + (w.y - t.y) ** 2 <= r * r) return t;
  }
  return null;
}
function snapCoordIn(v, val, size) {
  const g = v.grid.size;
  const even = size >= 1 && Math.round(size) % 2 === 0;
  return even ? Math.round(val / g) * g : (Math.floor(val / g) + 0.5) * g;
}
const paintTool = (v) => isGM() && v.fog.enabled && (tool === 'reveal' || tool === 'hide');
const drawActive = () => drawTool !== 'none';

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0;
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
/** Trouve le trait le plus proche du point `w`, pour la gomme. */
function strokeAt(v, w) {
  const hit = Math.max(8, v.grid.size * 0.12);
  const list = [...v.strokes.values()].reverse();
  for (const s of list) {
    const pad = (s.width || 4) / 2 + hit;
    if (s.tool === 'pen') {
      const p = s.points;
      if (!p || p.length < 2) continue;
      if (p.length === 2) { if (Math.hypot(w.x - p[0], w.y - p[1]) <= pad) return s; continue; }
      for (let i = 0; i + 3 < p.length; i += 2) {
        if (distToSegment(w.x, w.y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= pad) return s;
      }
    } else if (s.tool === 'line' || s.tool === 'arrow') {
      if (distToSegment(w.x, w.y, s.a.x, s.a.y, s.b.x, s.b.y) <= pad) return s;
    } else if (s.tool === 'rect') {
      const x0 = Math.min(s.a.x, s.b.x) - pad, x1 = Math.max(s.a.x, s.b.x) + pad;
      const y0 = Math.min(s.a.y, s.b.y) - pad, y1 = Math.max(s.a.y, s.b.y) + pad;
      if (w.x >= x0 && w.x <= x1 && w.y >= y0 && w.y <= y1) return s;
    } else if (s.tool === 'ellipse') {
      const cx = (s.a.x + s.b.x) / 2, cy = (s.a.y + s.b.y) / 2;
      const rx = Math.abs(s.b.x - s.a.x) / 2 + pad, ry = Math.abs(s.b.y - s.a.y) / 2 + pad;
      if (rx > 0 && ry > 0 && ((w.x - cx) / rx) ** 2 + ((w.y - cy) / ry) ** 2 <= 1) return s;
    }
  }
  return null;
}

function randomStrokeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  let s = '';
  for (let i = 0; i < 20; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
/** Envoie les points accumulés depuis le dernier envoi (pinceau) ou la position courante (formes). */
function flushStrokePoint(v) {
  if (!v.activeStroke) return;
  if (v.activeStroke.tool === 'pen') {
    const sent = v.activeStroke._sent || 0;
    const pts = v.activeStroke.points.slice(sent);
    if (pts.length) {
      v.activeStroke._sent = v.activeStroke.points.length;
      send({ t: 'draw', op: 'point', id: v.activeStroke.id, pts });
    }
  } else {
    send({ t: 'draw', op: 'point', id: v.activeStroke.id, x: v.activeStroke.b.x, y: v.activeStroke.b.y });
  }
}
/** Peint le brouillard du dernier point jusqu'à `w`, en comblant les trous. */
function paintTo(v, w) {
  const g = v.grid.size;
  const brush = parseInt($('brush').value, 10);
  const from = v.painting.last || w;
  const dist = Math.hypot(w.x - from.x, w.y - from.y);
  const steps = Math.max(1, Math.ceil(dist / (g * 0.3)));
  const cells = [];
  for (let i = 1; i <= steps; i++) {
    const px = (from.x + ((w.x - from.x) * i) / steps) / g;
    const py = (from.y + ((w.y - from.y) * i) / steps) / g;
    const r = brush / 2;
    const x0 = brush === 1 ? Math.floor(px) : Math.floor(px - r);
    const x1 = brush === 1 ? Math.floor(px) : Math.ceil(px + r);
    const y0 = brush === 1 ? Math.floor(py) : Math.floor(py - r);
    const y1 = brush === 1 ? Math.floor(py) : Math.ceil(py + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (brush > 1 && (cx + 0.5 - px) ** 2 + (cy + 0.5 - py) ** 2 > r * r) continue;
        const key = cellKey(cx, cy);
        if (v.painting.done.has(key)) continue;
        v.painting.done.add(key);
        const wasRevealed = v.fog.revealed.has(key);
        if (wasRevealed !== !!v.painting.value) cells.push([cx, cy]);
        applyFogCell(v, cx, cy, v.painting.value);
      }
    }
  }
  v.painting.last = w;
  if (cells.length) {
    v.dirty = true;
    send({ t: 'fog', op: 'paint', cells, value: v.painting.value });
  }
}

function wireViewportEvents(v) {
  v.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  v.canvas.addEventListener('pointerdown', (e) => {
    v.canvas.focus({ preventScroll: true });
    v.canvas.setPointerCapture(e.pointerId);
    v.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });

    if (v.pointers.size === 2) {
      // deux doigts : pincer pour zoomer / déplacer
      v.drag = null; v.pan = null; v.painting = null;
      const [a, b] = [...v.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      v.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: v.cam.s, w: toWorld(v, mid.x, mid.y) };
      return;
    }
    if (v.pointers.size > 2) return;

    const w = toWorld(v, e.offsetX, e.offsetY);
    const forcePan = e.button === 1 || e.button === 2 || spaceDown;
    if (!forcePan && paintTool(v)) {
      v.painting = { value: tool === 'reveal' ? 1 : 0, last: null, done: new Set() };
      paintTo(v, w);
      return;
    }
    if (!forcePan && drawActive()) {
      if (drawTool === 'eraser') {
        const s = strokeAt(v, w);
        // pas de suppression optimiste : le serveur refuse si ce n'est pas notre trait
        // (on n'a pas cette info côté client) ; l'effacement arrive via 'drawRemove'.
        if (s) send({ t: 'draw', op: 'remove', id: s.id });
        return;
      }
      const id = randomStrokeId();
      const color = $('drawColor').value;
      const width = parseInt($('drawWidth').value, 10);
      const layer = isGM() && $('drawGmLayer').checked ? 'gm' : 'shared';
      v.activeStroke = drawTool === 'pen'
        ? { id, tool: drawTool, color, width, layer, points: [w.x, w.y], _sent: 2 }
        : { id, tool: drawTool, color, width, layer, a: { x: w.x, y: w.y }, b: { x: w.x, y: w.y } };
      v.strokes.set(id, v.activeStroke);
      v.lastStrokeFlush = performance.now();
      v.dirty = true;
      send({ t: 'draw', op: 'start', id, tool: drawTool, color, width, layer, x: w.x, y: w.y });
      return;
    }
    if (!forcePan) {
      const t = tokenAt(v, w);
      if (t) {
        selectedId = t.id;
        refreshUI();
        if (canMove(t)) v.drag = { kind: 'token', id: t.id, dx: w.x - t.x, dy: w.y - t.y, last: 0 };
        else v.pan = { sx: e.offsetX, sy: e.offsetY, cx: v.cam.x, cy: v.cam.y };
        v.dirty = true;
        return;
      }
      if (isGM()) {
        const img = imageAt(v, w);
        if (img && !img.locked) {
          v.drag = { kind: 'image', id: img.id, dx: w.x - img.x, dy: w.y - img.y, last: 0 };
          v.dirty = true;
          return;
        }
      }
      if (selectedId) { selectedId = null; refreshUI(); }
    }
    v.pan = { sx: e.offsetX, sy: e.offsetY, cx: v.cam.x, cy: v.cam.y };
    v.canvas.style.cursor = 'grabbing';
  });

  v.canvas.addEventListener('pointermove', (e) => {
    if (v.pointers.has(e.pointerId)) v.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });

    if (v.pinch && v.pointers.size >= 2) {
      const [a, b] = [...v.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      v.cam.s = Math.min(6, Math.max(0.08, v.pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / v.pinch.dist)));
      v.cam.x = mid.x - v.pinch.w.x * v.cam.s;
      v.cam.y = mid.y - v.pinch.w.y * v.cam.s;
      v.dirty = true;
      return;
    }
    const w = toWorld(v, e.offsetX, e.offsetY);
    if (v.drag && v.drag.kind === 'token') {
      const t = tokens.get(v.drag.id);
      if (t) {
        t.x = w.x - v.drag.dx;
        t.y = w.y - v.drag.dy;
        v.dirty = true;
        const now = performance.now();
        if (now - v.drag.last > 40) {
          v.drag.last = now;
          send({ t: 'move', id: t.id, x: t.x, y: t.y, final: false });
        }
      }
    } else if (v.drag && v.drag.kind === 'image') {
      const img = images.get(v.drag.id);
      if (img) {
        img.x = w.x - v.drag.dx;
        img.y = w.y - v.drag.dy;
        v.dirty = true;
        const now = performance.now();
        if (now - v.drag.last > 40) {
          v.drag.last = now;
          send({ t: 'imageMove', id: img.id, x: img.x, y: img.y, final: false });
        }
      }
    } else if (v.painting) {
      paintTo(v, w);
    } else if (v.activeStroke) {
      if (v.activeStroke.tool === 'pen') {
        const p = v.activeStroke.points;
        const lx = p[p.length - 2], ly = p[p.length - 1];
        if (Math.hypot(w.x - lx, w.y - ly) >= 2) p.push(w.x, w.y);
      } else {
        v.activeStroke.b = { x: w.x, y: w.y };
      }
      v.dirty = true;
      const now = performance.now();
      if (now - v.lastStrokeFlush > 40) {
        v.lastStrokeFlush = now;
        flushStrokePoint(v);
      }
    } else if (v.pan) {
      v.cam.x = v.pan.cx + (e.offsetX - v.pan.sx);
      v.cam.y = v.pan.cy + (e.offsetY - v.pan.sy);
      v.dirty = true;
    } else if (!v.pointers.size || e.pointerType === 'mouse') {
      const t = tokenAt(v, w);
      const img = !t && isGM() ? imageAt(v, w) : null;
      const draggableImg = img && !img.locked;
      v.canvas.style.cursor = paintTool(v) || drawActive() ? 'crosshair' : (t && canMove(t)) || draggableImg ? 'pointer' : 'grab';
    }
  });

  function endPointer(e) {
    v.pointers.delete(e.pointerId);
    if (v.pointers.size < 2) v.pinch = null;
    if (v.drag && v.drag.kind === 'token') {
      const t = tokens.get(v.drag.id);
      if (t) {
        if (v.grid.snap) {
          t.x = snapCoordIn(v, t.x, t.size);
          t.y = snapCoordIn(v, t.y, t.size);
        }
        send({ t: 'move', id: t.id, x: t.x, y: t.y, final: true });
        v.dirty = true;
      }
      v.drag = null;
    } else if (v.drag && v.drag.kind === 'image') {
      const img = images.get(v.drag.id);
      if (img) {
        send({ t: 'imageMove', id: img.id, x: img.x, y: img.y, final: true });
        v.dirty = true;
      }
      v.drag = null;
    }
    v.painting = null;
    if (v.activeStroke) {
      flushStrokePoint(v);
      send({ t: 'draw', op: 'end', id: v.activeStroke.id });
      v.activeStroke = null;
    }
    if (!v.pointers.size) {
      v.pan = null;
      v.canvas.style.cursor = 'grab';
    }
  }
  v.canvas.addEventListener('pointerup', endPointer);
  v.canvas.addEventListener('pointercancel', endPointer);

  v.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(v, e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
  }, { passive: false });
}

/* ------------------------------------------------------------------ */
/* Cycle de vie                                                        */
/* ------------------------------------------------------------------ */
function initViewport() {
  const canvas = $('viewportCanvas');
  const v = {
    canvas,
    ctx: canvas.getContext('2d'),
    grid: { size: 50, visible: true, snap: true },
    fog: { enabled: false, revealed: new Set() },
    strokes: new Map(),
    htmlImages: new Map(), // image.id -> HTMLImageElement (cache)
    cam: { x: 0, y: 0, s: 1 },
    dpr: 1,
    dirty: true,
    pointers: new Map(),
    drag: null, pan: null, pinch: null, painting: null,
    activeStroke: null, lastStrokeFlush: 0,
  };
  viewport = v;
  wireViewportEvents(v);
  resizeViewport(v);
  canvas.style.cursor = 'grab';

  const loop = () => {
    if (v.dirty) drawViewport(v);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return v;
}

'use strict';
/**
 * Interface : notifications, panneau latéral (jetons, images, grille, brouillard,
 * outils de dessin). Grille/brouillard/dessin/ajout de PNJ visent tous l'unique
 * viewport partagé (cf. viewport.js).
 */
let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function refreshUI() {
  renderTokenList();
  renderSelection();
  renderInitiative();
  const v = viewport;
  if (!v) return;
  // grille
  if (document.activeElement !== $('gridSize')) $('gridSize').value = v.grid.size;
  $('gridVisible').checked = v.grid.visible;
  $('gridSnap').checked = v.grid.snap;
  // brouillard
  $('fogEnabled').checked = v.fog.enabled;
  $('fogTools').classList.toggle('off', !v.fog.enabled);
}

function renderTokenList() {
  const ul = $('tokenList');
  ul.textContent = '';
  const list = [...tokens.values()].sort((a, b) => (b.pc ? 1 : 0) - (a.pc ? 1 : 0) || a.name.localeCompare(b.name));
  for (const t of list) {
    if (!isGM() && t.id !== youToken && isFogged(viewport, t.x, t.y)) continue; // pas de fuite via la liste
    const li = document.createElement('li');
    if (t.id === selectedId) li.classList.add('sel');
    if (t.hidden) li.classList.add('hid');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = t.color;
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = t.name + (t.id === youToken ? ' (toi)' : '');
    const st = document.createElement('span');
    st.className = 'st';
    if (t.pc) {
      st.textContent = online.has(t.id) ? 'en ligne' : 'absent';
      if (online.has(t.id)) st.classList.add('on');
    } else st.textContent = t.hidden ? 'caché' : 'PNJ';
    li.append(dot, nm, st);
    for (const c of t.conditions || []) {
      const cond = document.createElement('span');
      cond.className = 'badge cond';
      cond.textContent = c;
      li.appendChild(cond);
    }
    li.addEventListener('click', () => {
      selectedId = t.id;
      viewport.cam.x = (viewport.canvas.clientWidth || 0) / 2 - t.x * viewport.cam.s;
      viewport.cam.y = (viewport.canvas.clientHeight || 0) / 2 - t.y * viewport.cam.s;
      viewport.dirty = true;
      refreshUI();
    });
    ul.appendChild(li);
  }
}

function renderSelection() {
  const t = tokens.get(selectedId);
  const editable = t && (isGM() || t.id === youToken);
  $('secSel').hidden = !editable;
  const npcPanel = $('npcQuick');
  if (npcPanel) npcPanel.hidden = !(t && !t.pc && isGM());
  if (!editable) {
    if (npcPanel && !npcPanel.hidden) openNpcQuick(t.id);
    return;
  }
  const active = document.activeElement;
  if (active !== $('selName')) $('selName').value = t.name;
  $('selColor').value = t.color;
  $('selSize').value = String(t.size);
  $('selHidden').checked = !!t.hidden;
  $('selDelete').hidden = !!t.pc;
  renderSelConditions(t);
  if (npcPanel && !npcPanel.hidden) openNpcQuick(t.id);
}

function renderSelConditions(t) {
  const ul = $('selConditionList');
  ul.textContent = '';
  for (const c of t.conditions || []) {
    const li = document.createElement('li');
    const nm = document.createElement('span');
    nm.textContent = c;
    const rm = document.createElement('button');
    rm.textContent = '✕';
    rm.addEventListener('click', () => {
      update({ conditions: (t.conditions || []).filter((x) => x !== c) });
    });
    li.append(nm, rm);
    ul.appendChild(li);
  }
}

function update(patch) {
  if (selectedId) send({ t: 'tokenUpdate', id: selectedId, patch });
}
function deleteSelected() {
  const t = tokens.get(selectedId);
  if (t && !t.pc) send({ t: 'tokenRemove', id: t.id });
}

$('selName').addEventListener('change', () => update({ name: $('selName').value }));
$('selColor').addEventListener('change', () => update({ color: $('selColor').value }));
$('selSize').addEventListener('change', () => update({ size: parseFloat($('selSize').value) }));
$('selHidden').addEventListener('change', () => update({ hidden: $('selHidden').checked }));
$('selDelete').addEventListener('click', deleteSelected);

function addSelCondition() {
  const t = tokens.get(selectedId);
  const input = $('selConditionInput');
  const val = input.value.trim().slice(0, 20);
  if (!t || !val) return;
  const list = t.conditions || [];
  if (list.length >= 6 || list.includes(val)) { input.value = ''; return; }
  update({ conditions: [...list, val] });
  input.value = '';
}
$('selConditionAdd').addEventListener('click', addSelCondition);
$('selConditionInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addSelCondition(); });

$('npcAdd').addEventListener('click', () => {
  const c = toWorld(viewport, (viewport.canvas.clientWidth || 0) / 2, (viewport.canvas.clientHeight || 0) / 2);
  send({
    t: 'tokenAdd',
    name: $('npcName').value || 'PNJ',
    color: $('npcColor').value,
    x: c.x,
    y: c.y,
    size: 1,
  });
  $('npcName').value = '';
});
$('npcName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('npcAdd').click(); });

// grille
$('gridSize').addEventListener('change', () => {
  const val = parseInt($('gridSize').value, 10);
  if (val >= 20 && val <= 200) send({ t: 'grid', size: val });
  else { toast('Taille de case : 20 à 200 px'); $('gridSize').value = viewport.grid.size; }
});
$('gridVisible').addEventListener('change', () => {
  send({ t: 'grid', visible: $('gridVisible').checked });
});
$('gridSnap').addEventListener('change', () => {
  send({ t: 'grid', snap: $('gridSnap').checked });
});

// brouillard
$('fogEnabled').addEventListener('change', () => {
  send({ t: 'fog', op: 'enabled', value: $('fogEnabled').checked });
});
$('fogAll').addEventListener('click', () => {
  send({ t: 'fog', op: 'fill' });
});
/** Met à jour le curseur après un changement d'outil (sans attendre le prochain mousemove). */
function refreshCursors() {
  if (viewport) viewport.canvas.style.cursor = paintTool(viewport) || drawActive() ? 'crosshair' : 'grab';
}
document.querySelectorAll('#fogTools [data-tool]').forEach((b) => {
  b.addEventListener('click', () => {
    tool = b.dataset.tool;
    document.querySelectorAll('#fogTools [data-tool]').forEach((x) => x.classList.toggle('on', x === b));
    if (tool !== 'move') {
      drawTool = 'none';
      document.querySelectorAll('#drawTools [data-draw]').forEach((x) => x.classList.toggle('on', x.dataset.draw === 'none'));
    }
    refreshCursors();
  });
});

// dessin
document.querySelectorAll('#drawTools [data-draw]').forEach((b) => {
  b.addEventListener('click', () => {
    drawTool = b.dataset.draw;
    document.querySelectorAll('#drawTools [data-draw]').forEach((x) => x.classList.toggle('on', x === b));
    if (drawTool !== 'none') {
      tool = 'move';
      document.querySelectorAll('#fogTools [data-tool]').forEach((x) => x.classList.toggle('on', x.dataset.tool === 'move'));
    }
    refreshCursors();
  });
});
$('drawClearAll').addEventListener('click', () => {
  if (confirm('Effacer tous les dessins ?')) send({ t: 'draw', op: 'clear' });
});

// images (espace de travail du MJ)
$('imageUpload').addEventListener('click', () => $('imageFile').click());
$('imageFile').addEventListener('change', async () => {
  const file = $('imageFile').files[0];
  $('imageFile').value = '';
  if (file) await uploadImage(file);
});

let draggingImageId = null;
function renderImageList() {
  const ul = $('imageList');
  ul.textContent = '';
  for (const m of [...images.values()].sort((a, b) => a.order - b.order)) {
    const li = document.createElement('li');
    li.dataset.id = m.id;
    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.src = m.url;
    thumb.alt = '';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = m.name;
    nm.draggable = true;
    nm.title = "Glisser pour changer l'ordre de superposition";
    nm.addEventListener('dragstart', (e) => {
      draggingImageId = m.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', m.id);
      li.classList.add('dragging');
    });
    nm.addEventListener('dragend', () => {
      draggingImageId = null;
      li.classList.remove('dragging');
    });
    li.addEventListener('dragover', (e) => {
      if (!draggingImageId || draggingImageId === m.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const before = e.clientY - li.getBoundingClientRect().top < li.offsetHeight / 2;
      li.classList.toggle('drop-before', before);
      li.classList.toggle('drop-after', !before);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before', 'drop-after'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drop-before', 'drop-after');
      const draggedLi = draggingImageId && ul.querySelector(`li[data-id="${CSS.escape(draggingImageId)}"]`);
      if (!draggedLi || draggedLi === li) return;
      const before = e.clientY - li.getBoundingClientRect().top < li.offsetHeight / 2;
      ul.insertBefore(draggedLi, before ? li : li.nextSibling);
      send({ t: 'imageReorder', ids: [...ul.children].map((c) => c.dataset.id) });
    });
    const vis = document.createElement('button');
    vis.textContent = m.hidden ? '🙈' : '👁';
    vis.title = m.hidden ? 'Afficher aux joueurs' : 'Cacher aux joueurs';
    vis.addEventListener('click', (e) => {
      e.stopPropagation();
      send({ t: 'imageUpdate', id: m.id, patch: { hidden: !m.hidden } });
    });
    const lock = document.createElement('button');
    lock.textContent = m.locked ? '🔒' : '🔓';
    lock.title = m.locked ? 'Déverrouiller (autoriser le déplacement)' : 'Verrouiller (empêcher le déplacement)';
    lock.addEventListener('click', (e) => {
      e.stopPropagation();
      send({ t: 'imageUpdate', id: m.id, patch: { locked: !m.locked } });
    });
    const del = document.createElement('button');
    del.textContent = '🗑';
    del.title = 'Supprimer';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Supprimer l'image « ${m.name} » ?`)) send({ t: 'imageRemove', id: m.id });
    });
    li.append(thumb, nm, vis, lock, del);
    ul.appendChild(li);
  }
}

async function uploadImage(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch (e) { return toast('Image illisible.'); }
  let blob = file;
  let w = bmp.width;
  let h = bmp.height;
  const MAXD = 6000;
  if (Math.max(w, h) > MAXD || file.size > 18 * 1024 * 1024) {
    const k = Math.min(1, MAXD / Math.max(w, h));
    w = Math.round(w * k);
    h = Math.round(h * k);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
    if (!blob) return toast('Impossible de réduire cette image.');
  }
  const name = (file.name || '').replace(/\.[^.]+$/, '').slice(0, 24);
  const c = toWorld(viewport, (viewport.canvas.clientWidth || 0) / 2, (viewport.canvas.clientHeight || 0) / 2);
  toast('Envoi de l\'image…');
  try {
    const r = await fetch(`/api/rooms/${roomId}/image?w=${w}&h=${h}&name=${encodeURIComponent(name)}&cx=${c.x}&cy=${c.y}`, {
      method: 'POST',
      headers: { 'X-GM-Key': gmKey, 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Échec de l\'envoi');
    toast('Image ajoutée.');
  } catch (e) {
    toast(e.message);
  }
}

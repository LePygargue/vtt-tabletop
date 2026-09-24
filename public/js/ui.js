'use strict';
/**
 * Interface : notifications, panneau latéral (jetons, images, grille, brouillard,
 * outils de dessin). Grille/brouillard/dessin/ajout de PNJ visent tous l'unique
 * viewport partagé (cf. viewport.js).
 */
let toastTimer = null;
/** `action` optionnel : { label, onClick } affiche un bouton (ex. "Annuler") dans le toast. */
function toast(text, action) {
  const el = $('toast');
  el.textContent = '';
  el.style.pointerEvents = action ? 'auto' : 'none';
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      clearTimeout(toastTimer);
      el.classList.remove('show');
      action.onClick();
    });
    el.appendChild(btn);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2600);
}

/** Remplit un <select> de joueurs (fiche/journal, sélecteur MJ) et renvoie le tokenId choisi. */
function refreshPlayerOptions(selectId) {
  const sel = $(selectId);
  const prev = sel.value;
  sel.textContent = '';
  const list = [...tokens.values()].filter((t) => t.pc).sort((a, b) => a.name.localeCompare(b.name));
  for (const t of list) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  }
  if (list.some((t) => t.id === prev)) sel.value = prev;
  else if (list.length) sel.value = list[0].id;
  return sel.value || null;
}

/** Sélectionne visuellement et pour les lecteurs d'écran un bouton d'un groupe role="radio". */
function setRadioOn(el, on) {
  el.classList.toggle('on', on);
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

/** Echap ferme le panneau tant qu'il est ouvert (utilisé par les 4 panneaux : fiche, journal, jetons/dessin, dés). */
function closeOnEscape(isOpen, close) {
  window.addEventListener('keydown', (e) => {
    // Échap dans une boîte de confirmation ne ferme qu'elle, pas le panneau derrière
    if (e.key === 'Escape' && isOpen() && !document.querySelector('dialog[open]')) close();
  });
}
/** Clic hors de `contentEl` ferme le panneau (réservé aux panneaux modaux fiche/journal :
 *  contrairement aux panneaux latéraux, ils bloquent le reste de l'interface tant qu'ils sont ouverts). */
function closeOnClickOutside(contentEl, isOpen, close) {
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('dialog')) return; // clic dans une boîte de confirmation ouverte depuis ce panneau
    if (isOpen() && !contentEl.contains(e.target)) close();
  });
}

// Les tooltips (`data-tip`) ne se déclenchent qu'au survol/focus, invisibles au tactile : les
// éléments non-bouton (danger/désespoir, labels du pool de dés) s'ouvrent aussi au tap.
// (sauf les rangées de cases PV/Volonté : chaque tap y coche une case, le tooltip clignoterait)
for (const el of document.querySelectorAll('[data-tip]:not(button):not(.dmg-grid)')) {
  el.addEventListener('click', () => el.classList.toggle('tip-open'));
}
document.addEventListener('click', (e) => {
  for (const el of document.querySelectorAll('.tip-open')) {
    if (!el.contains(e.target)) el.classList.remove('tip-open');
  }
});

function refreshUI() {
  renderTokenList();
  renderSelection();
  renderInitiative();
  syncNpcProfile();
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

/** Jetons visibles par ce client (PJ d'abord, puis par nom) : ordre de la liste et du Tab sur le plateau. */
function listedTokens() {
  return [...tokens.values()]
    .filter((t) => isGM() || t.id === youToken || !isFogged(viewport, t.x, t.y)) // pas de fuite via la liste
    .sort((a, b) => (b.pc ? 1 : 0) - (a.pc ? 1 : 0) || a.name.localeCompare(b.name));
}

function renderTokenList() {
  const ul = $('tokenList');
  const focusedId = ul.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  ul.textContent = '';
  for (const t of listedTokens()) {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.dataset.id = t.id;
    li.setAttribute('role', 'button');
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
    if (hasNpcProfile(t)) {
      const info = document.createElement('span');
      info.className = 'badge npc-info';
      info.textContent = 'ⓘ';
      info.title = 'Présentation disponible';
      li.appendChild(info);
    }
    const selectThis = () => {
      selectedId = t.id;
      animateCamTo(viewport, t.x, t.y);
      refreshUI();
      if (!isGM()) openNpcProfile(t.id); // sans effet si ce jeton n'a pas de présentation
    };
    li.addEventListener('click', selectThis);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectThis(); }
    });
    ul.appendChild(li);
    if (t.id === focusedId) li.focus();
  }
}

function renderBannedList() {
  const sec = $('secBanned');
  sec.hidden = !bannedPlayers.length;
  const ul = $('bannedList');
  ul.textContent = '';
  for (const b of bannedPlayers) {
    const li = document.createElement('li');
    const nm = document.createElement('span');
    nm.textContent = b.name;
    const un = document.createElement('button');
    un.textContent = 'Réintégrer';
    un.addEventListener('click', () => send({ t: 'unbanPlayer', playerId: b.playerId }));
    li.append(nm, un);
    ul.appendChild(li);
  }
}

function renderSelection() {
  const t = tokens.get(selectedId);
  const editable = t && (isGM() || t.id === youToken);
  $('viewportCanvas').setAttribute('aria-label', t ? `Plateau — jeton sélectionné : ${t.name}, ${tokenCellText(t)}` : 'Plateau');
  $('secSel').hidden = !editable;
  const npcPanel = $('npcQuick');
  if (npcPanel) npcPanel.hidden = !(t && !t.pc && isGM());
  renderNpcProfileEdit(t);
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
  $('selKick').hidden = !(t.pc && isGM() && t.id !== youToken);
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
    rm.setAttribute('aria-label', `Retirer la condition « ${c} »`);
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
async function deleteSelected() {
  const t = tokens.get(selectedId);
  if (!t || t.pc) return;
  const ok = await confirmDialog({
    title: 'Supprimer le PNJ',
    message: `Supprimer le PNJ « ${t.name} » ?`,
    confirmLabel: 'Supprimer',
    danger: true,
  });
  if (!ok) return;
  send({ t: 'tokenRemove', id: t.id });
  toast(`« ${t.name} » supprimé.`, {
    label: 'Annuler',
    onClick: () => send({ t: 'tokenAdd', name: t.name, color: t.color, size: t.size, x: t.x, y: t.y, hidden: t.hidden }),
  });
}

$('selKick').addEventListener('click', async () => {
  const t = tokens.get(selectedId);
  if (!t || !t.pc) return;
  const ok = await confirmDialog({
    title: 'Exclure le joueur',
    message: `Exclure « ${t.name} » de ce salon ?

Il ne pourra plus le rejoindre tant que tu ne le réintègres pas.`,
    confirmLabel: 'Exclure',
    danger: true,
  });
  if (ok) send({ t: 'kickPlayer', tokenId: t.id });
});

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
    document.querySelectorAll('#fogTools [data-tool]').forEach((x) => setRadioOn(x, x === b));
    if (tool !== 'move') {
      drawTool = 'none';
      document.querySelectorAll('#drawTools [data-draw]').forEach((x) => setRadioOn(x, x.dataset.draw === 'none'));
    }
    refreshCursors();
  });
});

// dessin
document.querySelectorAll('#drawTools [data-draw]').forEach((b) => {
  b.addEventListener('click', () => {
    drawTool = b.dataset.draw;
    document.querySelectorAll('#drawTools [data-draw]').forEach((x) => setRadioOn(x, x === b));
    if (drawTool !== 'none') {
      tool = 'move';
      document.querySelectorAll('#fogTools [data-tool]').forEach((x) => setRadioOn(x, x.dataset.tool === 'move'));
    }
    refreshCursors();
  });
});
// Barre de dessin (icônes seules) : épaisseur en cycle, calque MJ en interrupteur, repliable
const DRAW_WIDTHS = [
  { px: 2, label: 'fine', icon: 1.5 },
  { px: 4, label: 'normale', icon: 2.5 },
  { px: 8, label: 'épaisse', icon: 4 },
  { px: 16, label: 'très épaisse', icon: 6 },
];
function setDrawWidth(i) {
  const w = DRAW_WIDTHS[i];
  const b = $('drawWidth');
  b.value = String(w.px); // lu par viewport.js au début de chaque trait
  b.dataset.index = i;
  b.setAttribute('aria-label', `Épaisseur : ${w.label}`);
  b.dataset.tip = `Épaisseur : ${w.label} (cliquer pour changer)`;
  b.querySelector('.draw-width-line').style.strokeWidth = w.icon;
}
setDrawWidth(1);
$('drawWidth').addEventListener('click', () => {
  setDrawWidth(((Number($('drawWidth').dataset.index) || 0) + 1) % DRAW_WIDTHS.length);
});
$('drawGmLayer').addEventListener('click', () => {
  const on = $('drawGmLayer').getAttribute('aria-pressed') !== 'true';
  $('drawGmLayer').setAttribute('aria-pressed', String(on));
  $('drawGmLayer').classList.toggle('on', on);
});
const DRAW_COLLAPSED_KEY = 'plateau.drawCollapsed';
function setDrawCollapsed(collapsed) {
  document.body.classList.toggle('draw-collapsed', collapsed);
  $('drawBarToggle').setAttribute('aria-expanded', String(!collapsed));
  // menu replié : pas d'outil actif invisible, on revient à « aucun outil »
  if (collapsed && drawTool !== 'none') document.querySelector('#drawTools [data-draw="none"]').click();
}
$('drawBarToggle').addEventListener('click', () => {
  const collapsed = !document.body.classList.contains('draw-collapsed');
  setDrawCollapsed(collapsed);
  try { localStorage.setItem(DRAW_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (e) { /* stockage indisponible : réglage non mémorisé */ }
});
{
  let saved = null;
  try { saved = localStorage.getItem(DRAW_COLLAPSED_KEY); } catch (e) { /* idem */ }
  if (saved === '1') setDrawCollapsed(true);
}
// sections repliables des panneaux latéraux : le titre devient un bouton
const SECTIONS_COLLAPSED_KEY = 'plateau.sectionsCollapsed';
{
  let collapsedSet = new Set();
  try { collapsedSet = new Set(JSON.parse(localStorage.getItem(SECTIONS_COLLAPSED_KEY) || '[]')); } catch (e) { /* stockage indisponible */ }
  for (const h3 of document.querySelectorAll('#panel > section > h3, #dicePanel > section > h3')) {
    const section = h3.parentElement;
    const key = section.closest('aside').id + ':' + h3.textContent.trim();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'section-toggle';
    btn.append(...h3.childNodes);
    h3.appendChild(btn);
    const apply = (collapsed) => {
      section.classList.toggle('collapsed', collapsed);
      btn.setAttribute('aria-expanded', String(!collapsed));
    };
    apply(collapsedSet.has(key));
    btn.addEventListener('click', () => {
      const collapsed = !section.classList.contains('collapsed');
      apply(collapsed);
      if (collapsed) collapsedSet.add(key); else collapsedSet.delete(key);
      try { localStorage.setItem(SECTIONS_COLLAPSED_KEY, JSON.stringify([...collapsedSet])); } catch (e) { /* réglage non mémorisé */ }
    });
  }
}

$('drawClearAll').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Effacer les dessins',
    message: 'Effacer tous les dessins ?',
    confirmLabel: 'Tout effacer',
    danger: true,
  });
  if (ok) send({ t: 'draw', op: 'clear' });
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
    setTip(vis, m.hidden ? 'Afficher aux joueurs' : 'Cacher aux joueurs');
    vis.addEventListener('click', (e) => {
      e.stopPropagation();
      send({ t: 'imageUpdate', id: m.id, patch: { hidden: !m.hidden } });
    });
    const lock = document.createElement('button');
    lock.textContent = m.locked ? '🔒' : '🔓';
    setTip(lock, m.locked ? 'Déverrouiller (autoriser le déplacement)' : 'Verrouiller (empêcher le déplacement)');
    lock.addEventListener('click', (e) => {
      e.stopPropagation();
      send({ t: 'imageUpdate', id: m.id, patch: { locked: !m.locked } });
    });
    const del = document.createElement('button');
    del.textContent = '🗑';
    setTip(del, "Supprimer l'image");
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog({
        title: "Supprimer l'image",
        message: `Supprimer l'image « ${m.name} » ?`,
        confirmLabel: 'Supprimer',
        danger: true,
      });
      if (ok) send({ t: 'imageRemove', id: m.id });
    });
    li.append(thumb, nm, vis, lock, del);
    ul.appendChild(li);
  }
}

/** Position d'un jeton en cases, lisible à voix haute. */
function tokenCellText(t) {
  const g = viewport.grid.size;
  return `colonne ${Math.floor(t.x / g) + 1}, ligne ${Math.floor(t.y / g) + 1}`;
}

/** Annonce un texte aux lecteurs d'écran (zone #srLive). Vider puis remplir permet de réannoncer un texte identique. */
function announce(text) {
  const el = $('srLive');
  el.textContent = '';
  setTimeout(() => { el.textContent = text; }, 50);
}

function setTip(btn, text) {
  btn.dataset.tip = text;
  btn.setAttribute('aria-label', text);
  btn.classList.add('tip-right');
}

async function uploadImage(file) {
  $('imageUpload').disabled = true;
  try {
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
  } finally {
    $('imageUpload').disabled = false;
  }
}

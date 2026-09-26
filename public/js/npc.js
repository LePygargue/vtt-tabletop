'use strict';
/**
 * Fiche PNJ rapide (MJ uniquement) : quelques valeurs et du texte libre, selon le jeu.
 * Jamais envoyée aux joueurs (contrairement à sheet.js) ; chargée à la demande
 * par tokenId au lieu d'être poussée dans l'état initial du salon.
 */
let currentNpcTokenId = null;

function openNpcQuick(tokenId) {
  if (!tokenId) return;
  if (currentNpcTokenId !== tokenId) {
    currentNpcTokenId = tokenId;
    if (npcSheets.has(tokenId)) renderNpcQuick();
    else send({ t: 'npc', op: 'get', tokenId });
  } else {
    renderNpcQuick();
  }
}

let npcRenderers = []; // (fiche PNJ) => void, un par champ du formulaire

/** Formulaire de la fiche PNJ rapide, construit depuis le schéma du jeu (game.npcSheet). */
function buildNpcForm() {
  const root = $('npcFields');
  root.textContent = '';
  npcRenderers = [];
  const numberInput = (f) => {
    const input = el('input');
    input.type = 'number';
    input.min = f.min;
    input.max = f.max;
    input.step = 1;
    input.addEventListener('change', () => sendNpcPatch({ [f.key]: intOr(input.value, f.default ?? 0) }));
    npcRenderers.push((s) => setFieldValue(input, s[f.key]));
    return input;
  };
  const textInput = (f) => {
    const input = el('input');
    input.maxLength = f.max || 60;
    if (f.fallback) input.placeholder = f.fallback;
    input.addEventListener('input', () => queueNpcPatch({ [f.key]: input.value }));
    npcRenderers.push((s) => setFieldValue(input, s[f.key] || ''));
    return input;
  };
  const inline = (f) => labelled(f.label, f.type === 'number' ? numberInput(f) : textInput(f), f.tip);
  for (const f of game.npcSheet.fields) {
    if (Array.isArray(f)) {
      const row = root.appendChild(el('div', 'sheet-row3'));
      for (const x of f) row.appendChild(inline(x));
    } else if (f.type === 'boxes') {
      const grid = root.appendChild(el('div', 'box-grid'));
      npcRenderers.push((s) => renderStatBoxes(grid, s[f.key] || 0));
    } else if (f.type === 'multiline') {
      const ta = el('textarea');
      ta.rows = f.rows || 3;
      ta.maxLength = f.max || 500;
      ta.addEventListener('input', () => queueNpcPatch({ [f.key]: ta.value }));
      npcRenderers.push((s) => setFieldValue(ta, s[f.key] || ''));
      root.appendChild(labelled(f.label, ta));
    } else {
      root.appendChild(inline(f));
    }
  }
  if (currentNpcTokenId && npcSheets.has(currentNpcTokenId)) renderNpcQuick();
}

function renderNpcQuick() {
  const s = npcSheets.get(currentNpcTokenId);
  if (!s) return;
  for (const r of npcRenderers) r(s);
  renderNpcVisibility();
}

/** Liste à cocher (un PC par ligne) des joueurs qui voient malgré tout ce PNJ caché. */
function renderNpcVisibility() {
  const box = $('npcVisibility');
  const t = tokens.get(currentNpcTokenId);
  if (!t || !t.hidden) { box.hidden = true; return; }
  box.hidden = false;
  const allowed = new Set(npcVisibility.get(currentNpcTokenId) || []);
  const ul = $('npcVisibilityList');
  ul.textContent = '';
  const players = [...tokens.values()].filter((tk) => tk.pc).sort((a, b) => a.name.localeCompare(b.name));
  for (const p of players) {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = allowed.has(p.id);
    cb.addEventListener('change', () => toggleNpcVisibility(p.id, cb.checked));
    label.append(cb, document.createTextNode(p.name));
    li.appendChild(label);
    ul.appendChild(li);
  }
}

function toggleNpcVisibility(pcTokenId, allow) {
  const current = new Set(npcVisibility.get(currentNpcTokenId) || []);
  if (allow) current.add(pcTokenId);
  else current.delete(pcTokenId);
  send({ t: 'tokenUpdate', id: currentNpcTokenId, patch: { visibleToTokens: [...current] } });
  send({ t: 'npc', op: 'get', tokenId: currentNpcTokenId }); // resynchronise les cases depuis le serveur
}

function sendNpcPatch(patch) {
  if (!currentNpcTokenId) return;
  send({ t: 'npc', op: 'update', tokenId: currentNpcTokenId, patch });
}
let pendingNpcPatch = null;
let pendingNpcTimer = null;
function queueNpcPatch(patch, delay = 600) {
  pendingNpcPatch = { ...(pendingNpcPatch || {}), ...patch };
  clearTimeout(pendingNpcTimer);
  pendingNpcTimer = setTimeout(() => {
    const p = pendingNpcPatch;
    pendingNpcPatch = null;
    sendNpcPatch(p);
  }, delay);
}

'use strict';
/**
 * Fiche PNJ rapide (MJ uniquement) : PV/PV max, traits libres, notes.
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

function renderNpcQuick() {
  const s = npcSheets.get(currentNpcTokenId);
  if (!s) return;
  renderStatBoxes('npcHpBoxes', s.hp);
  if (document.activeElement !== $('npcHp')) $('npcHp').value = s.hp;
  if (document.activeElement !== $('npcHpMax')) $('npcHpMax').value = s.hpMax;
  renderStatBoxes('npcWillpowerBoxes', s.willpower);
  if (document.activeElement !== $('npcWillpower')) $('npcWillpower').value = s.willpower;
  if (document.activeElement !== $('npcWillpowerMax')) $('npcWillpowerMax').value = s.willpowerMax;
  if (document.activeElement !== $('npcDefense')) $('npcDefense').value = s.defense;
  if (document.activeElement !== $('npcTraits')) $('npcTraits').value = s.traits || '';
  if (document.activeElement !== $('npcNotes')) $('npcNotes').value = s.notes || '';
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

$('npcHp').addEventListener('change', () => sendNpcPatch({ hp: parseInt($('npcHp').value, 10) || 0 }));
$('npcHpMax').addEventListener('change', () => sendNpcPatch({ hpMax: parseInt($('npcHpMax').value, 10) || 1 }));
$('npcWillpower').addEventListener('change', () => sendNpcPatch({ willpower: parseInt($('npcWillpower').value, 10) || 0 }));
$('npcWillpowerMax').addEventListener('change', () => sendNpcPatch({ willpowerMax: parseInt($('npcWillpowerMax').value, 10) || 1 }));
$('npcDefense').addEventListener('change', () => sendNpcPatch({ defense: parseInt($('npcDefense').value, 10) || 0 }));
$('npcTraits').addEventListener('input', () => queueNpcPatch({ traits: $('npcTraits').value }));
$('npcNotes').addEventListener('input', () => queueNpcPatch({ notes: $('npcNotes').value }));

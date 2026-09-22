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
  if (document.activeElement !== $('npcTraits')) $('npcTraits').value = s.traits || '';
  if (document.activeElement !== $('npcNotes')) $('npcNotes').value = s.notes || '';
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
$('npcTraits').addEventListener('input', () => queueNpcPatch({ traits: $('npcTraits').value }));
$('npcNotes').addEventListener('input', () => queueNpcPatch({ notes: $('npcNotes').value }));

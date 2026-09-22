'use strict';
/**
 * Tracker d'initiative / tour de scène (MJ : gestion complète, joueurs : badge
 * lecture seule dans la barre du haut). État synchronisé via `initiative` (state.js).
 */
function renderInitiative() {
  const ol = $('initiativeList');
  if (ol) {
    ol.textContent = '';
    for (const e of initiative.entries) {
      const li = document.createElement('li');
      if (initiative.active && e.tokenId === initiative.activeTokenId) li.classList.add('sel');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = e.color;
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = e.name;
      li.append(dot, nm);
      if (isGM()) {
        const score = document.createElement('input');
        score.type = 'number';
        score.step = '1';
        score.value = e.score;
        score.style.width = '52px';
        score.addEventListener('change', () => {
          send({ t: 'initiative', op: 'score', tokenId: e.tokenId, score: parseInt(score.value, 10) || 0 });
        });
        const rm = document.createElement('button');
        rm.textContent = '✕';
        rm.addEventListener('click', () => send({ t: 'initiative', op: 'remove', tokenId: e.tokenId }));
        li.append(score, rm);
      } else {
        const score = document.createElement('span');
        score.className = 'st';
        score.textContent = e.score;
        li.append(score);
      }
      ol.appendChild(li);
    }
    const round = $('initRound');
    if (round) round.textContent = initiative.round;
    if (isGM()) refreshInitTokenSelect();
  }

  const badge = $('initiativeBadge');
  if (!badge) return;
  if (initiative.active && initiative.activeTokenId) {
    const entry = initiative.entries.find((e) => e.tokenId === initiative.activeTokenId);
    const t = tokens.get(initiative.activeTokenId);
    const name = (entry && entry.name) || (t && t.name) || '?';
    badge.hidden = false;
    badge.textContent = `Tour : ${name} · Round ${initiative.round}`;
  } else {
    badge.hidden = true;
  }
}

function refreshInitTokenSelect() {
  const sel = $('initTokenSelect');
  if (!sel) return;
  const prev = sel.value;
  sel.textContent = '';
  const used = new Set(initiative.entries.map((e) => e.tokenId));
  const list = [...tokens.values()].filter((t) => !used.has(t.id)).sort((a, b) => a.name.localeCompare(b.name));
  for (const t of list) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  }
  if (list.some((t) => t.id === prev)) sel.value = prev;
}

$('initAdd').addEventListener('click', () => {
  const tokenId = $('initTokenSelect').value;
  if (!tokenId) return;
  const score = parseInt($('initScoreInput').value, 10) || 0;
  send({ t: 'initiative', op: 'add', tokenId, score });
  $('initScoreInput').value = 0;
});
$('initNext').addEventListener('click', () => send({ t: 'initiative', op: 'next' }));
$('initClear').addEventListener('click', () => {
  if (confirm("Terminer la scène et vider l'ordre d'initiative ?")) send({ t: 'initiative', op: 'clear' });
});

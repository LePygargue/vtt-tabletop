'use strict';
/**
 * Journal de personnage : un carnet d'entrées horodatées par joueur, privé et
 * lisible par le MJ (jamais modifiable par lui). Même schéma de ciblage que la
 * fiche (sheet.js) : le MJ vise via le tokenId d'un joueur, jamais le playerId.
 */
let currentJournal = [];
let journalTokenId = null; // MJ uniquement : jeton du joueur actuellement affiché

function formatJournalDate(ts) {
  return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderJournal() {
  const root = $('journalEntries');
  root.textContent = '';
  const list = [...currentJournal].sort((a, b) => b.ts - a.ts);
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Aucune entrée pour l\'instant.';
    root.appendChild(empty);
    return;
  }
  const mine = !isGM();
  for (const e of list) {
    const card = document.createElement('div');
    card.className = 'journal-entry';
    const meta = document.createElement('div');
    meta.className = 'journal-entry-meta';
    meta.textContent = formatJournalDate(e.ts);
    const text = document.createElement('div');
    text.className = 'journal-entry-text';
    text.textContent = e.text;
    card.append(meta, text);
    if (mine) {
      const actions = document.createElement('div');
      actions.className = 'journal-entry-actions';
      const edit = document.createElement('button');
      edit.textContent = 'Modifier';
      edit.addEventListener('click', () => startEditJournalEntry(e, text, actions));
      const del = document.createElement('button');
      del.textContent = 'Supprimer';
      del.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: "Supprimer l'entrée",
          message: 'Supprimer cette entrée du journal ?',
          confirmLabel: 'Supprimer',
          danger: true,
        });
        if (!ok) return;
        send({ t: 'journal', op: 'remove', id: e.id });
        toast('Entrée du journal supprimée.', { label: 'Annuler', onClick: () => send({ t: 'journal', op: 'add', text: e.text }) });
      });
      actions.append(edit, del);
      card.appendChild(actions);
    }
    root.appendChild(card);
  }
}

function startEditJournalEntry(entry, textEl, actionsEl) {
  const ta = document.createElement('textarea');
  ta.className = 'journal-edit';
  ta.rows = 3;
  ta.maxLength = 4000;
  ta.value = entry.text;
  textEl.replaceWith(ta);
  actionsEl.hidden = true;
  const editBar = document.createElement('div');
  editBar.className = 'journal-entry-actions';
  const save = document.createElement('button');
  save.textContent = 'Enregistrer';
  save.addEventListener('click', () => {
    const text = ta.value.trim();
    if (text) send({ t: 'journal', op: 'update', id: entry.id, text });
  });
  const cancel = document.createElement('button');
  cancel.textContent = 'Annuler';
  cancel.addEventListener('click', () => renderJournal());
  editBar.append(save, cancel);
  ta.insertAdjacentElement('afterend', editBar);
}

$('journalAddForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('journalText').value.trim();
  if (!text) return;
  send({ t: 'journal', op: 'add', text });
  $('journalText').value = '';
});

/** MJ : liste des jetons de joueurs (déjà connus côté client), jamais le playerId. */
function openJournalForToken(tokenId) {
  if (!tokenId) return;
  journalTokenId = tokenId;
  send({ t: 'journal', op: 'get', tokenId });
}
$('journalPlayerSelect').addEventListener('change', () => openJournalForToken($('journalPlayerSelect').value));

$('btnJournal').addEventListener('click', () => {
  const panel = $('journalPanel');
  panel.hidden = !panel.hidden;
  if (panel.hidden) return;
  if (isGM()) {
    const tokenId = refreshPlayerOptions('journalPlayerSelect');
    if (tokenId && tokenId !== journalTokenId) openJournalForToken(tokenId);
    else renderJournal();
  } else {
    renderJournal();
  }
});
$('btnJournalClose').addEventListener('click', () => { $('journalPanel').hidden = true; });
closeOnEscape(() => !$('journalPanel').hidden, () => { $('journalPanel').hidden = true; });
closeOnClickOutside($('journalPanel').querySelector('.overlay-card'), () => !$('journalPanel').hidden, () => { $('journalPanel').hidden = true; });

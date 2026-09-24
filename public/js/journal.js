'use strict';
/**
 * Journal de personnage : un carnet d'entrées horodatées par joueur, privé et
 * lisible par le MJ (jamais modifiable par lui). Même schéma de ciblage que la
 * fiche (sheet.js) : le MJ vise via le tokenId d'un joueur, jamais le playerId.
 */
let currentJournal = [];
let journalTokenId = null; // MJ uniquement : jeton du joueur actuellement affiché
let journalShown = { tokenId: null, count: 0 }; // dernier rendu, pour savoir quand aller à la dernière page
let journalSpread = 0; // double page affichée (0 = pages 1-2)

function formatJournalDate(ts) {
  return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Pagination : les colonnes CSS (hauteur fixe) remplissent la page de gauche, puis
 * celle de droite, puis débordent sur les doubles pages suivantes ; on n'en montre
 * qu'une à la fois en décalant le bloc d'une largeur de double page.
 */
function layoutJournal(goToEnd = false) {
  if ($('journalPanel').hidden) return;
  const root = $('journalEntries');
  const view = $('journalViewport');
  const cs = getComputedStyle(root);
  const perSpread = parseInt(cs.columnCount, 10) || 1; // 2 (double page) ou 1 (petit écran)
  const gap = parseFloat(cs.columnGap) || 0;
  const width = view.clientWidth;
  const colStep = (width - (perSpread - 1) * gap) / perSpread + gap;
  // Colonne où tombe la fin du texte (repère vide placé après la dernière entrée)
  const end = root.querySelector('.journal-end');
  const endX = end ? end.getBoundingClientRect().left - root.getBoundingClientRect().left : 0; // même décalage des deux côtés
  const spreads = Math.floor(Math.max(0, endX + 1) / colStep / perSpread) + 1;
  journalSpread = goToEnd ? spreads - 1 : Math.min(Math.max(0, journalSpread), spreads - 1);
  root.style.transform = `translateX(${-journalSpread * (width + gap)}px)`;
  const first = journalSpread * perSpread + 1;
  $('journalPageLabel').textContent = perSpread > 1
    ? `Pages ${first}–${first + 1} sur ${spreads * perSpread}`
    : `Page ${first} sur ${spreads}`;
  $('journalPrev').disabled = journalSpread === 0;
  $('journalNext').disabled = journalSpread >= spreads - 1;
}
function turnJournalPage(delta) {
  journalSpread += delta;
  layoutJournal();
}
$('journalPrev').addEventListener('click', () => turnJournalPage(-1));
$('journalNext').addEventListener('click', () => turnJournalPage(1));
window.addEventListener('resize', () => layoutJournal());
$('journalPanel').addEventListener('keydown', (e) => {
  if (e.target.closest('textarea, input, select')) return;
  if (e.key === 'ArrowLeft') turnJournalPage(-1);
  else if (e.key === 'ArrowRight') turnJournalPage(1);
});

/** Entrées dans l'ordre d'écriture (la plus ancienne en premier), comme un vrai carnet. */
function renderJournal(goToEnd = false) {
  const root = $('journalEntries');
  root.textContent = '';
  const list = [...currentJournal].sort((a, b) => a.ts - b.ts);
  // Dernière double page (là où l'on écrit) à l'ouverture, au changement de joueur
  // ou après un ajout — pas lors d'une modification ou d'une suppression.
  if (journalShown.tokenId !== journalTokenId || list.length > journalShown.count) goToEnd = true;
  journalShown = { tokenId: journalTokenId, count: list.length };
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Aucune entrée pour l\'instant.';
    root.appendChild(empty);
    journalSpread = 0;
    layoutJournal();
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
  const end = document.createElement('div');
  end.className = 'journal-end';
  root.appendChild(end);
  layoutJournal(goToEnd);
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
  layoutJournal(); // la zone d'édition peut ajouter une page
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
    else renderJournal(true);
  } else {
    renderJournal(true);
  }
});
$('btnJournalClose').addEventListener('click', () => { $('journalPanel').hidden = true; });
closeOnEscape(() => !$('journalPanel').hidden, () => { $('journalPanel').hidden = true; });
closeOnClickOutside($('journalPanel').querySelector('.overlay-card'), () => !$('journalPanel').hidden, () => { $('journalPanel').hidden = true; });

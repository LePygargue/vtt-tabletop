'use strict';
/**
 * Liens de partage (joueurs / MJ) et boutons de vue.
 */
async function copy(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e2) {}
    ta.remove();
  }
  toast(okMsg);
}
$('btnCopyPlayers').addEventListener('click', () => copy(`${location.origin}/r/${roomId}`, 'Lien joueurs copié.'));
$('btnCopyGM').addEventListener('click', () => copy(`${location.origin}/r/${roomId}#gm=${gmKey}`, 'Lien MJ copié : garde-le secret !'));
$('btnFit').addEventListener('click', fitViewport);
$('btnPanel').addEventListener('click', () => document.body.classList.toggle('panel-closed'));
closeOnEscape(() => !document.body.classList.contains('panel-closed'), () => document.body.classList.add('panel-closed'));
function closeRenamePanel() { $('renamePanel').hidden = true; }
$('btnRenameRoom').addEventListener('click', () => {
  $('renameInput').value = roomName || '';
  $('renamePanel').hidden = false;
  $('renameInput').focus();
});
$('btnRenameClose').addEventListener('click', closeRenamePanel);
$('btnRenameCancel').addEventListener('click', closeRenamePanel);
closeOnEscape(() => !$('renamePanel').hidden, closeRenamePanel);
closeOnClickOutside($('renamePanel').querySelector('.overlay-card'), () => !$('renamePanel').hidden, closeRenamePanel);
$('renameForm').addEventListener('submit', (e) => {
  e.preventDefault();
  send({ t: 'room', name: $('renameInput').value });
  closeRenamePanel();
});

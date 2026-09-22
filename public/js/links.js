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
$('btnRenameRoom').addEventListener('click', () => {
  const next = prompt('Nom du salon (laisser vide pour revenir au code) :', roomName || '');
  if (next === null) return;
  send({ t: 'room', name: next });
});

'use strict';
/**
 * Salon en préparation : le MJ installe sa partie à l'abri des regards. Le serveur
 * n'envoie alors plus rien du plateau aux joueurs (voir hiddenByPrep, lib/net.js) ;
 * ici on n'ajuste que l'affichage : écran d'attente côté joueur (fiche et journal
 * restent accessibles), interrupteur et rappel visuel côté MJ.
 */

/** Applique le statut reçu ; `limited` : ce client est un joueur privé du plateau. */
function setRoomStatus(status, limited) {
  roomStatus = status === 'prep' ? 'prep' : 'open';
  const prep = roomStatus === 'prep';
  document.body.classList.toggle('is-prep', prep);
  document.body.classList.toggle('prep-limited', limited);
  if (limited) firstState = true; // à la réouverture, la vue se cadrera sur le plateau
  const btn = $('btnPrep');
  btn.setAttribute('aria-pressed', String(prep));
  btn.textContent = prep ? 'Ouvrir la partie' : 'Préparation';
  btn.dataset.tip = prep
    ? 'Rendre le plateau aux joueurs (ils le retrouvent aussitôt)'
    : 'Cacher le plateau aux joueurs pour préparer la partie (ils gardent leur fiche et leur journal)';
  $('prepBadge').hidden = !prep;
}

$('btnPrep').addEventListener('click', () => {
  send({ t: 'roomStatus', status: roomStatus === 'prep' ? 'open' : 'prep' });
});
$('prepOpenSheet').addEventListener('click', () => $('btnSheet').click());
$('prepOpenJournal').addEventListener('click', () => $('btnJournal').click());

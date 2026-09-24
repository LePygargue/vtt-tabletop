'use strict';
/**
 * Accessibilité : aide et raccourcis (touche ?), taille du texte, lien d'évitement,
 * état ouvert/fermé des panneaux pour les lecteurs d'écran.
 */
function openHelp() {
  const dlg = $('helpDialog');
  if (!dlg.open) dlg.showModal();
}
$('btnHelp').addEventListener('click', openHelp);
$('btnHelpClose').addEventListener('click', () => $('helpDialog').close());
// clic sur le fond (hors de la carte) = fermer, comme les boîtes de confirmation
$('helpDialog').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

/* Taille du texte des panneaux (mémorisée par navigateur) */
const UI_SIZE_KEY = 'plateau.uiSize';
function applyUiSize(size) {
  document.documentElement.style.setProperty('--ui-zoom', size);
  for (const b of document.querySelectorAll('[data-ui-size]')) setRadioOn(b, b.dataset.uiSize === size);
  syncTopbarHeight();
}
for (const b of document.querySelectorAll('[data-ui-size]')) {
  b.addEventListener('click', () => {
    applyUiSize(b.dataset.uiSize);
    try { localStorage.setItem(UI_SIZE_KEY, b.dataset.uiSize); } catch (e) { /* stockage indisponible : réglage non mémorisé */ }
  });
}

/** Hauteur réelle (zoom compris) de la barre du haut, pour placer les panneaux dessous. */
function syncTopbarHeight() {
  document.documentElement.style.setProperty('--topbar-h', $('topbar').getBoundingClientRect().height + 'px');
}
window.addEventListener('resize', syncTopbarHeight);
{
  let saved = null;
  try { saved = localStorage.getItem(UI_SIZE_KEY); } catch (e) { /* idem */ }
  applyUiSize(document.querySelector(`[data-ui-size="${saved}"]`) ? saved : '1');
}

/* Panneaux : aria-expanded suit les classes du body, quel que soit le déclencheur (bouton, touche, Échap) */
function syncPanelsExpanded() {
  $('btnDice').setAttribute('aria-expanded', String(!document.body.classList.contains('dice-closed')));
  $('btnPanel').setAttribute('aria-expanded', String(!document.body.classList.contains('panel-closed')));
}
new MutationObserver(syncPanelsExpanded).observe(document.body, { attributes: true, attributeFilter: ['class'] });
syncPanelsExpanded();

// « Aller au panneau » : l'ouvre s'il est replié avant d'y mettre le focus
document.querySelector('.skip-link').addEventListener('click', (e) => {
  e.preventDefault();
  document.body.classList.remove('panel-closed');
  $('panel').focus();
});

// Échap referme les infobulles ouvertes au tap
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') for (const el of document.querySelectorAll('.tip-open')) el.classList.remove('tip-open');
});

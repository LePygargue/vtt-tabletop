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

/* Style de Pathfinder : table de l'aventurier (par défaut) ou nef de pierre (mémorisé par navigateur) */
const PF2E_SKIN_KEY = 'plateau.pf2eSkin';
function applyPf2eSkin(skin) {
  if (skin) document.documentElement.dataset.skin = skin;
  else delete document.documentElement.dataset.skin;
  for (const b of document.querySelectorAll('[data-pf2e-skin]')) setRadioOn(b, b.dataset.pf2eSkin === skin);
  refreshThemeColors(); // fond du plateau, quadrillage et liseré des jetons changent avec le style
  syncTopbarHeight();
}
for (const b of document.querySelectorAll('[data-pf2e-skin]')) {
  b.addEventListener('click', () => {
    applyPf2eSkin(b.dataset.pf2eSkin);
    try { localStorage.setItem(PF2E_SKIN_KEY, b.dataset.pf2eSkin); } catch (e) { /* réglage non mémorisé */ }
  });
}
{
  let saved = '';
  try { saved = localStorage.getItem(PF2E_SKIN_KEY) || ''; } catch (e) { /* idem */ }
  applyPf2eSkin(document.querySelector(`[data-pf2e-skin="${saved}"]`) ? saved : '');
}

/* Son du site : coupé ou non, et volume (mémorisés par navigateur) */
const SOUND_KEY = 'plateau.sound';
const soundSettings = { muted: false, volume: 60 };
try { Object.assign(soundSettings, JSON.parse(localStorage.getItem(SOUND_KEY) || '{}')); } catch (e) { /* stockage indisponible */ }
/** Volume à appliquer aux sons du site, entre 0 et 1 (0 si coupé). */
function soundVolume() {
  return soundSettings.muted ? 0 : Math.max(0, Math.min(100, Number(soundSettings.volume) || 0)) / 100;
}
function renderSoundSettings() {
  $('soundMuted').checked = soundSettings.muted;
  $('soundVolume').value = soundSettings.volume;
  $('soundVolume').disabled = soundSettings.muted;
  $('soundVolumeOut').textContent = `${soundSettings.volume} %`;
}
function saveSoundSettings() {
  renderSoundSettings();
  try { localStorage.setItem(SOUND_KEY, JSON.stringify(soundSettings)); } catch (e) { /* réglage non mémorisé */ }
}
$('soundMuted').addEventListener('change', (e) => { soundSettings.muted = e.target.checked; saveSoundSettings(); });
$('soundVolume').addEventListener('input', (e) => { soundSettings.volume = parseInt(e.target.value, 10); saveSoundSettings(); });
renderSoundSettings();

/** Hauteur réelle (zoom compris) de la barre du haut, pour placer les panneaux dessous. */
function syncTopbarHeight() {
  document.documentElement.style.setProperty('--topbar-h', $('topbar').getBoundingClientRect().height + 'px');
}
window.addEventListener('resize', syncTopbarHeight);
// La barre change aussi de hauteur sans redimensionnement (polices web chargées, jauges du jeu, boutons MJ)
if (window.ResizeObserver) new ResizeObserver(syncTopbarHeight).observe($('topbar'));
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

'use strict';
/**
 * Présentation d'un PNJ (portrait + description) : le MJ la renseigne depuis le panneau
 * du jeton sélectionné ; un joueur qui voit ce PNJ l'ouvre en cliquant sur son jeton.
 * Contrairement à la fiche PNJ rapide (npc.js, secrète), elle voyage avec le jeton
 * (champs `portrait` et `description`), donc seulement vers ceux qui voient ce PNJ.
 */
const PORTRAIT_MAX_SIDE = 1200; // réduit côté client avant envoi (le serveur plafonne à 5 Mo)
let npcProfileOpenId = null;
let lastFocusBeforeProfile = null;

/** Vrai si ce jeton est un PNJ avec un portrait ou une description à montrer. */
function hasNpcProfile(t) {
  return !!(t && !t.pc && (t.portrait || (t.description || '').trim()));
}

/* ---------- Popup (joueurs, et aperçu du MJ) ---------- */
function openNpcProfile(tokenId) {
  const t = tokens.get(tokenId);
  if (!hasNpcProfile(t)) return;
  if ($('npcProfilePanel').hidden) lastFocusBeforeProfile = document.activeElement;
  npcProfileOpenId = tokenId;
  fillNpcProfile(t);
  $('npcProfilePanel').hidden = false;
  replayClass($('npcProfilePanel').querySelector('.npc-profile-card'), 'opening');
  $('btnNpcProfileClose').focus({ preventScroll: true });
}

function fillNpcProfile(t) {
  $('npcProfileName').textContent = t.name;
  const desc = (t.description || '').trim();
  $('npcProfileDesc').textContent = desc;
  $('npcProfileDesc').hidden = !desc;
  const img = $('npcProfileImg');
  if (t.portrait) {
    if (img.getAttribute('src') !== t.portrait) img.src = t.portrait;
    img.alt = `Portrait de ${t.name}`;
  } else {
    img.removeAttribute('src');
  }
  $('npcProfilePortrait').hidden = !t.portrait;
  $('npcProfilePanel').querySelector('.npc-profile-card').classList.toggle('no-portrait', !t.portrait);
}

function closeNpcProfile() {
  if ($('npcProfilePanel').hidden) return;
  $('npcProfilePanel').hidden = true;
  npcProfileOpenId = null;
  const back = lastFocusBeforeProfile;
  lastFocusBeforeProfile = null;
  if (back && document.contains(back)) back.focus({ preventScroll: true });
}

/** Appelé à chaque refreshUI : suit les modifications du MJ en direct, ferme si le PNJ disparaît. */
function syncNpcProfile() {
  if (!npcProfileOpenId) return;
  const t = tokens.get(npcProfileOpenId);
  if (!hasNpcProfile(t)) closeNpcProfile();
  else fillNpcProfile(t);
}

$('btnNpcProfileClose').addEventListener('click', closeNpcProfile);
closeOnEscape(() => !$('npcProfilePanel').hidden, closeNpcProfile);
closeOnClickOutside($('npcProfilePanel').querySelector('.overlay-card'), () => !$('npcProfilePanel').hidden, closeNpcProfile);

/* ---------- Édition (MJ) ---------- */
let npcProfileEditId = null;

/** Remplit le bloc « Présentation aux joueurs » pour le PNJ sélectionné (appelé par renderSelection). */
function renderNpcProfileEdit(t) {
  const box = $('npcProfileEdit');
  box.hidden = !(t && !t.pc && isGM());
  if (box.hidden) { npcProfileEditId = null; return; }
  if (npcProfileEditId !== t.id) flushDescription(); // la saisie en cours part vers le PNJ d'avant
  npcProfileEditId = t.id;
  const img = $('npcPortraitPreview');
  if (t.portrait) {
    if (img.getAttribute('src') !== t.portrait) img.src = t.portrait;
  } else {
    img.removeAttribute('src');
  }
  img.hidden = !t.portrait;
  $('npcPortraitRemove').hidden = !t.portrait;
  $('npcPortraitPick').textContent = t.portrait ? 'Changer l\'image…' : 'Choisir une image…';
  if (document.activeElement !== $('npcDescription')) $('npcDescription').value = t.description || '';
  $('npcProfilePreview').disabled = !hasNpcProfile(t);
}

let pendingDescription = null; // { id, text }
let pendingDescriptionTimer = null;
function flushDescription() {
  clearTimeout(pendingDescriptionTimer);
  if (!pendingDescription) return;
  const { id, text } = pendingDescription;
  pendingDescription = null;
  send({ t: 'tokenUpdate', id, patch: { description: text } });
}
$('npcDescription').addEventListener('input', () => {
  if (!npcProfileEditId) return;
  pendingDescription = { id: npcProfileEditId, text: $('npcDescription').value };
  // copie locale immédiate : l'aperçu reflète la saisie sans attendre l'écho du serveur
  const t = tokens.get(npcProfileEditId);
  if (t) t.description = pendingDescription.text;
  $('npcProfilePreview').disabled = !hasNpcProfile(t);
  clearTimeout(pendingDescriptionTimer);
  pendingDescriptionTimer = setTimeout(flushDescription, 600);
});
$('npcDescription').addEventListener('blur', flushDescription);

/** Réduit l'image si besoin (côté le plus long ≤ PORTRAIT_MAX_SIDE) pour un envoi léger. */
async function preparePortrait(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch (e) { throw new Error('Image illisible.'); }
  const k = Math.min(1, PORTRAIT_MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (k === 1 && file.size <= 2 * 1024 * 1024) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, 'image/webp', 0.88));
  if (!blob) throw new Error('Impossible de réduire cette image.');
  return blob;
}

async function uploadPortrait(file) {
  const tokenId = npcProfileEditId;
  if (!tokenId) return;
  $('npcPortraitPick').disabled = true;
  try {
    const blob = await preparePortrait(file);
    toast('Envoi du portrait…');
    const r = await fetch(`/api/rooms/${roomId}/tokens/${tokenId}/portrait`, {
      method: 'POST',
      headers: { 'X-GM-Key': gmKey, 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Échec de l\'envoi');
    toast('Portrait ajouté.');
  } catch (e) {
    toast(e.message);
  } finally {
    $('npcPortraitPick').disabled = false;
  }
}

$('npcPortraitPick').addEventListener('click', () => $('npcPortraitFile').click());
$('npcPortraitFile').addEventListener('change', () => {
  const file = $('npcPortraitFile').files[0];
  $('npcPortraitFile').value = '';
  if (file) uploadPortrait(file);
});
$('npcPortraitRemove').addEventListener('click', async () => {
  const id = npcProfileEditId;
  if (!id) return;
  const ok = await confirmDialog({ title: 'Retirer le portrait ?', message: 'Les joueurs ne verront plus cette image.', confirmLabel: 'Retirer', danger: true });
  if (ok) send({ t: 'tokenUpdate', id, patch: { portrait: null } });
});
$('npcProfilePreview').addEventListener('click', () => {
  flushDescription();
  if (npcProfileEditId) openNpcProfile(npcProfileEditId);
});

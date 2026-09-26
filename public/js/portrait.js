'use strict';
/**
 * Portraits de jetons : envoi (PNJ et joueurs, même route HTTP), rendu rond recadré
 * sur la carte, bloc « Portrait » de la fiche de personnage et fenêtre de cadrage.
 * Le serveur garde l'image complète (`token.portrait`) et la zone ronde choisie
 * (`token.crop` = { x, y, s }) : centre en fraction de la largeur/hauteur de l'image,
 * diamètre en fraction de son plus petit côté. Sans `crop`, le plus grand cercle centré.
 */
const PORTRAIT_MAX_SIDE = 1200; // réduit côté client avant envoi (le serveur plafonne à 5 Mo)
const DEFAULT_CROP = { x: 0.5, y: 0.5, s: 1 };

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

/** Envoie le portrait d'un jeton (le MJ pour tout jeton, un joueur pour le sien) ; renvoie son URL. */
async function uploadTokenPortrait(tokenId, file) {
  const blob = await preparePortrait(file);
  toast('Envoi du portrait…');
  const headers = { 'Content-Type': blob.type || 'application/octet-stream' };
  if (gmKey) headers['X-GM-Key'] = gmKey;
  const r = await fetch(`/api/rooms/${roomId}/tokens/${tokenId}/portrait`, { method: 'POST', headers, body: blob });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Échec de l\'envoi');
  return data.url;
}

/* ---------- Rendu d'un portrait dans un cercle ---------- */
const portraitImages = new Map(); // url -> HTMLImageElement (cache partagé carte / fiche / cadrage)
const portraitListeners = new Set(); // rappels quand une image finit de charger (redessin)

function portraitImage(url) {
  let img = portraitImages.get(url);
  if (!img) {
    img = new Image();
    img.onload = () => { for (const fn of portraitListeners) fn(); };
    img.src = url;
    portraitImages.set(url, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}
portraitListeners.add(() => { if (viewport) viewport.dirty = true; });

const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Ramène le cercle dans l'image (le serveur ne connaît pas ses dimensions, il borne seulement à 0..1). */
function clampCrop(c, w, h) {
  const s = clampNum(c.s, 0.05, 1);
  const hw = (s * Math.min(w, h)) / 2;
  return { x: clampNum(c.x, hw / w, 1 - hw / w), y: clampNum(c.y, hw / h, 1 - hw / h), s };
}
/** Dessine la zone ronde `crop` de `img` dans le cercle (cx, cy, r) — à appeler après un clip sur ce cercle. */
function drawPortraitCrop(ctx, img, crop, cx, cy, r) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = clampCrop(crop || DEFAULT_CROP, w, h);
  const side = c.s * Math.min(w, h);
  ctx.drawImage(img, c.x * w - side / 2, c.y * h - side / 2, side, side, cx - r, cy - r, r * 2, r * 2);
}

/** Aperçu du jeton `t` dans un petit canvas : `img` recadrée selon `crop`, sinon couleur + initiales. */
function drawTokenPreview(canvas, t, img, crop) {
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  const r = size / 2 - 4;
  ctx.clearRect(0, 0, size, size);
  if (!t) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = t.color;
  ctx.fill();
  if (img) {
    ctx.save();
    ctx.clip();
    drawPortraitCrop(ctx, img, crop, size / 2, size / 2, r);
    ctx.restore();
  } else {
    ctx.fillStyle = textColorFor(t.color);
    ctx.font = `600 ${r * 0.85}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Array.from(t.name).slice(0, 2).join('').toUpperCase(), size / 2, size / 2 + r * 0.04);
  }
  ctx.lineWidth = Math.max(3, r * 0.1);
  ctx.strokeStyle = img ? t.color : '#0009';
  ctx.stroke();
  ctx.restore();
}

/* ---------- Bloc « Portrait » de la fiche ---------- */
/** Jeton dont la fiche est affichée : le sien pour un joueur, celui choisi dans le sélecteur pour le MJ. */
const sheetTokenId = () => (isGM() ? currentTokenId : youToken);

function renderSheetPortrait() {
  const t = tokens.get(sheetTokenId());
  $('sheetPortrait').hidden = !t;
  if (!t) return;
  const img = $('sheetPortraitImg');
  if (t.portrait) {
    if (img.getAttribute('src') !== t.portrait) img.src = t.portrait;
    img.alt = `Portrait de ${t.name}`;
  } else {
    img.removeAttribute('src');
  }
  img.hidden = !t.portrait;
  drawTokenPreview($('sheetTokenPreview'), t, t.portrait ? portraitImage(t.portrait) : null, t.crop);
  $('sheetPortraitPick').textContent = t.portrait ? 'Changer l\'image…' : 'Choisir une image…';
  $('sheetPortraitCrop').hidden = !t.portrait;
  $('sheetPortraitRemove').hidden = !t.portrait;
  $('sheetPortraitHint').hidden = !!t.portrait;
}
portraitListeners.add(() => { if (!$('sheetPanel').hidden) renderSheetPortrait(); });

$('sheetPortraitPick').addEventListener('click', () => $('sheetPortraitFile').click());
$('sheetPortraitFile').addEventListener('change', async () => {
  const file = $('sheetPortraitFile').files[0];
  $('sheetPortraitFile').value = '';
  const tokenId = sheetTokenId();
  if (!file || !tokenId) return;
  $('sheetPortraitPick').disabled = true;
  try {
    const url = await uploadTokenPortrait(tokenId, file);
    toast('Portrait ajouté : choisis la partie qui remplit le jeton.');
    openCropEditor(tokenId, url);
  } catch (e) {
    toast(e.message);
  } finally {
    $('sheetPortraitPick').disabled = false;
  }
});
$('sheetPortraitCrop').addEventListener('click', () => {
  const t = tokens.get(sheetTokenId());
  if (t && t.portrait) openCropEditor(t.id, t.portrait);
});
$('sheetPortraitRemove').addEventListener('click', async () => {
  const id = sheetTokenId();
  if (!id) return;
  const ok = await confirmDialog({ title: 'Retirer le portrait ?', message: 'Le jeton reprendra sa couleur et ses initiales sur la carte.', confirmLabel: 'Retirer', danger: true });
  if (ok) send({ t: 'tokenUpdate', id, patch: { portrait: null } });
});

/* ---------- Fenêtre de cadrage ---------- */
const CROP_BOX = 440; // taille max (px CSS) de l'image affichée dans la fenêtre
let cropEdit = null; // { tokenId, img, crop, scale, drag }

/** Ouvre la fenêtre de cadrage pour ce jeton ; `url` est l'image à cadrer (juste envoyée ou actuelle). */
function openCropEditor(tokenId, url) {
  const t = tokens.get(tokenId);
  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = Math.min(1, CROP_BOX / Math.max(w, h));
    const canvas = $('cropCanvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = Math.round(w * scale) + 'px';
    canvas.width = Math.round(w * scale * dpr);
    canvas.height = Math.round(h * scale * dpr);
    const start = t && t.portrait === url && t.crop ? t.crop : DEFAULT_CROP;
    cropEdit = { tokenId, img, scale: scale * dpr, crop: clampCrop(start, w, h), drag: null };
    $('cropSize').value = Math.round(cropEdit.crop.s * 100);
    drawCropEditor();
    if (!$('cropDialog').open) $('cropDialog').showModal();
  };
  img.onerror = () => toast('Image illisible.');
  img.src = url;
}

function drawCropEditor() {
  if (!cropEdit) return;
  const { img, crop, scale } = cropEdit;
  const canvas = $('cropCanvas');
  const ctx = canvas.getContext('2d');
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cx = crop.x * w * scale;
  const cy = crop.y * h * scale;
  const r = (crop.s * Math.min(w, h) * scale) / 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  // voile hors du cercle (rectangle + cercle, règle pair-impair : le cercle reste clair)
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, .6)';
  ctx.fill('evenodd');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  drawTokenPreview($('cropPreview'), tokens.get(cropEdit.tokenId), img, crop);
}

function setCrop(next) {
  if (!cropEdit) return;
  cropEdit.crop = clampCrop(next, cropEdit.img.naturalWidth, cropEdit.img.naturalHeight);
  $('cropSize').value = Math.round(cropEdit.crop.s * 100);
  drawCropEditor();
}
/** Point du canvas (événement souris/doigt) en coordonnées normalisées de l'image. */
function cropPoint(e) {
  const rect = $('cropCanvas').getBoundingClientRect();
  return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
}

$('cropCanvas').addEventListener('pointerdown', (e) => {
  if (!cropEdit) return;
  e.preventDefault();
  $('cropCanvas').setPointerCapture(e.pointerId);
  const p = cropPoint(e);
  const { crop, img } = cropEdit;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const rad = (crop.s * Math.min(w, h)) / 2;
  const inside = Math.hypot((p.x - crop.x) * w, (p.y - crop.y) * h) <= rad;
  // clic hors du cercle : il y saute ; dans le cercle : on le fait glisser depuis ce point
  if (!inside) setCrop({ ...crop, x: p.x, y: p.y });
  cropEdit.drag = { dx: cropEdit.crop.x - p.x, dy: cropEdit.crop.y - p.y };
});
$('cropCanvas').addEventListener('pointermove', (e) => {
  if (!cropEdit || !cropEdit.drag) return;
  const p = cropPoint(e);
  setCrop({ ...cropEdit.crop, x: p.x + cropEdit.drag.dx, y: p.y + cropEdit.drag.dy });
});
const endCropDrag = () => { if (cropEdit) cropEdit.drag = null; };
$('cropCanvas').addEventListener('pointerup', endCropDrag);
$('cropCanvas').addEventListener('pointercancel', endCropDrag);
$('cropCanvas').addEventListener('wheel', (e) => {
  if (!cropEdit) return;
  e.preventDefault();
  setCrop({ ...cropEdit.crop, s: cropEdit.crop.s * (e.deltaY < 0 ? 1.08 : 1 / 1.08) });
}, { passive: false });
$('cropSize').addEventListener('input', () => {
  if (cropEdit) setCrop({ ...cropEdit.crop, s: Number($('cropSize').value) / 100 });
});

function closeCropEditor() {
  cropEdit = null;
  if ($('cropDialog').open) $('cropDialog').close();
}
$('cropCancel').addEventListener('click', closeCropEditor);
$('cropSave').addEventListener('click', () => {
  if (cropEdit) send({ t: 'tokenUpdate', id: cropEdit.tokenId, patch: { crop: cropEdit.crop } });
  closeCropEditor();
});
$('cropDialog').addEventListener('cancel', (e) => { e.preventDefault(); closeCropEditor(); }); // Échap
$('cropDialog').addEventListener('mousedown', (e) => { if (e.target === $('cropDialog')) closeCropEditor(); });

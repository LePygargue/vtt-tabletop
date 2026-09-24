'use strict';
/**
 * Raccourcis clavier (liste affichée par la touche ?, cf. help.js).
 */
const typing = () => /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Touches actives quand le plateau a le focus : flèches, Tab, +/−. Renvoie true si la touche est consommée. */
function boardKey(e) {
  const v = viewport;
  if (ARROWS[e.key]) {
    const [dx, dy] = ARROWS[e.key];
    const t = tokens.get(selectedId);
    if (t && canMove(t)) {
      const n = e.shiftKey ? 5 : 1;
      moveTokenBy(v, t, dx * n, dy * n);
      announce(`${t.name} : ${tokenCellText(t)}`);
      renderSelection();
    } else {
      // sans jeton déplaçable sélectionné, les flèches font défiler la vue
      v.camAnim = null;
      v.cam.x -= dx * 80;
      v.cam.y -= dy * 80;
      v.dirty = true;
    }
    return true;
  }
  if (e.key === 'Tab') {
    // Tab / Maj+Tab passent d'un jeton à l'autre ; au bout de la liste, le focus quitte le plateau
    const list = listedTokens();
    const i = list.findIndex((t) => t.id === selectedId);
    const next = e.shiftKey ? (i === -1 ? list.length - 1 : i - 1) : i + 1;
    if (next < 0 || next >= list.length) return false;
    const t = list[next];
    selectedId = t.id;
    animateCamTo(v, t.x, t.y);
    refreshUI();
    announce(`${t.name}, ${tokenCellText(t)}${canMove(t) ? ' — flèches pour déplacer' : ''}${hasNpcProfile(t) ? ' — Entrée pour sa présentation' : ''}`);
    return true;
  }
  if (e.key === 'Enter') {
    const t = tokens.get(selectedId);
    if (!hasNpcProfile(t)) return false;
    openNpcProfile(t.id);
    return true;
  }
  if (e.key === '+' || e.key === '=' || e.key === '-') {
    v.camAnim = null;
    zoomAt(v, v.canvas.clientWidth / 2, v.canvas.clientHeight / 2, e.key === '-' ? 1 / 1.2 : 1.2);
    return true;
  }
  return false;
}

window.addEventListener('keydown', (e) => {
  if (typing() || document.querySelector('dialog[open]')) return; // pas de raccourcis derrière une boîte de dialogue
  if (e.ctrlKey || e.metaKey || e.altKey) return; // laisse Ctrl+/− (zoom navigateur) et consorts tranquilles
  if (document.activeElement === viewport.canvas && boardKey(e)) { e.preventDefault(); return; }
  if (e.code === 'Space') {
    spaceDown = true;
    viewport.canvas.style.cursor = 'grab';
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('viewport-canvas')) e.preventDefault();
  }
  else if (e.key === '?') openHelp();
  else if (e.key === 'f' || e.key === 'F') fitViewport();
  else if (e.key === 'd' || e.key === 'D') document.body.classList.toggle('dice-closed');
  else if (e.key === 'i' || e.key === 'I') $('btnSheet').click();
  else if (e.key === 'j' || e.key === 'J') $('btnJournal').click();
  else if (e.key === 'Escape') { selectedId = null; refreshUI(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && isGM() && selectedId) deleteSelected();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });

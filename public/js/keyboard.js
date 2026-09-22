'use strict';
/**
 * Raccourcis clavier.
 */
const typing = () => /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
window.addEventListener('keydown', (e) => {
  if (typing()) return;
  if (e.code === 'Space') {
    spaceDown = true;
    viewport.canvas.style.cursor = 'grab';
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('viewport-canvas')) e.preventDefault();
  }
  else if (e.key === 'f' || e.key === 'F') fitViewport();
  else if (e.key === 'd' || e.key === 'D') document.body.classList.toggle('dice-closed');
  else if (e.key === 'Escape') { selectedId = null; refreshUI(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && isGM() && selectedId) deleteSelected();
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });

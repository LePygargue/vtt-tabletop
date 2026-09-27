'use strict';
/**
 * Glitchs du plateau quand une jauge de salon bouge (thème Hunter, --glitch: 1) :
 * déchirures horizontales, image dédoublée en couleurs, neige numérique, secousse ;
 * à la baisse, une ligne de resynchronisation descend l'écran. Uniquement au moment du
 * changement : rien ne reste affiché une fois l'impulsion terminée.
 * Tout se dessine par-dessus l'image finale du plateau (espace écran), après le brouillard :
 * rien de caché ne peut apparaître. Mouvement réduit : un simple voile coloré.
 */
const GLITCH_INTENSITY = 1.6; // « violent »
const GLITCH_PAL = {
  'danger-up': { a: '#ff3a2f', b: '#3dff8a', bars: ['#ff3a2f', '#e8541e', '#3dff8a'] },
  'desperation-up': { a: '#ffb13b', b: '#3dff8a', bars: ['#ffe14a', '#ffb13b', '#3dff8a'] },
  'danger-down': { a: '#3dff8a', b: '#e8541e', bars: ['#3dff8a'], sweep: '#3dff8a' },
  'desperation-down': { a: '#ffe14a', b: '#3dff8a', bars: ['#ffe14a'], sweep: '#ffe14a' },
};
let glitchPulse = null; // { kind, start, dur, power }
let glitchSlices = [];
let glitchSlicesAt = 0;
let glitchBuf = null; // copie de l'image du plateau, puis deux copies teintées
let glitchTintA = null;
let glitchTintB = null;

function glitchReduced() {
  return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function triggerGlitch(kind, power, dur) {
  glitchPulse = { kind, power, dur, start: performance.now() };
  glitchSlicesAt = 0;
  if (viewport) viewport.dirty = true;
}

/** Secousse du plateau (CSS), sauf en mouvement réduit. */
function shakeStage(hard) {
  if (glitchReduced()) return;
  const stage = $('stage');
  stage.classList.remove('glitch-shake', 'glitch-shake-hard');
  void stage.offsetWidth;
  stage.classList.add(hard ? 'glitch-shake-hard' : 'glitch-shake');
}

/** Appelé par showGaugeAlert : impulsion selon la jauge et le sens. */
function glitchGauge(key, prev, level) {
  if (!themeColors.glitch) return;
  const def = gaugeDef(key);
  const up = level > prev;
  const maxed = up && def && level >= def.max;
  if (key === 'danger') {
    if (up) {
      triggerGlitch('danger-up', maxed ? 1.35 : 0.6 + level * 0.1, maxed ? 2000 : 1500);
      shakeStage(maxed);
    } else triggerGlitch('danger-down', 0.45, 1700);
  } else if (up) {
    triggerGlitch('desperation-up', maxed ? 1.2 : 0.55 + level * 0.08, maxed ? 2200 : 1800);
    if (maxed) shakeStage(false);
  } else triggerGlitch('desperation-down', 0.4, 1800);
}

/** À chaque image de la boucle du plateau : garde l'impulsion animée jusqu'à sa fin. */
function glitchTick(v) {
  if (glitchPulse) v.dirty = true;
}

function glitchCanvas(c, w, h) {
  if (!c) c = document.createElement('canvas');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}
/** Copie teintée de l'image (un « canal » du décalage chromatique), transparence conservée. */
function glitchTint(c, color) {
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'copy';
  g.drawImage(glitchBuf, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(glitchBuf, 0, 0);
  g.globalCompositeOperation = 'source-over';
  return c;
}

/** Appelé à la fin de drawViewport. */
function drawGlitch(v) {
  const now = performance.now();
  const W = v.canvas.width;
  const H = v.canvas.height;
  const dpr = v.dpr;
  const reduced = glitchReduced();
  if (!glitchPulse) return;
  const t = (now - glitchPulse.start) / glitchPulse.dur;
  if (t >= 1) { glitchPulse = null; return; }
  const p = Math.pow(1 - t, 1.1) * glitchPulse.power * GLITCH_INTENSITY;
  const pal = GLITCH_PAL[glitchPulse.kind];
  const off = reduced ? 0 : p * 22 * dpr;

  const ctx = v.ctx;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  glitchBuf = glitchCanvas(glitchBuf, W, H);
  const b = glitchBuf.getContext('2d');
  b.clearRect(0, 0, W, H);
  b.drawImage(v.canvas, 0, 0);

  // décalage chromatique
  if (off > 0.4) {
    glitchTintA = glitchTint(glitchCanvas(glitchTintA, W, H), pal.a);
    glitchTintB = glitchTint(glitchCanvas(glitchTintB, W, H), pal.b);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = Math.min(0.5, 0.18 + p * 0.5);
    ctx.drawImage(glitchTintA, -off, 0);
    ctx.drawImage(glitchTintB, off, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  if (p > 0.01) {
    if (reduced) {
      ctx.globalAlpha = p * 0.18;
      ctx.fillStyle = pal.a;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    } else {
      // descente : au-dessus de la ligne de resynchronisation, l'image est de nouveau nette
      const sweep = pal.sweep && glitchPulse ? ((now - glitchPulse.start) / glitchPulse.dur) * H * 1.1 : null;
      if (now - glitchSlicesAt > 80) {
        const power = Math.min(1.4, p);
        const n = Math.round(3 + power * 9);
        glitchSlices = [];
        for (let i = 0; i < n; i++) {
          glitchSlices.push({
            y: Math.random() * H,
            h: (4 + Math.random() * 40 * power) * dpr,
            dx: (Math.random() - 0.5) * 90 * power * dpr,
            bar: Math.random() < 0.35 ? pal.bars[Math.floor(Math.random() * pal.bars.length)] : null,
          });
        }
        glitchSlicesAt = now;
      }
      for (const s of glitchSlices) {
        if (sweep !== null && s.y < sweep) continue;
        ctx.clearRect(0, s.y, W, s.h);
        ctx.drawImage(glitchBuf, 0, s.y, W, s.h, s.dx, s.y, W, s.h);
        if (s.bar) {
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = 0.25 + p * 0.3;
          ctx.fillStyle = s.bar;
          ctx.fillRect(0, s.y, W, Math.max(dpr, s.h * 0.25));
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
      }
      if (sweep !== null) {
        const gr = ctx.createLinearGradient(0, sweep - 30 * dpr, 0, sweep + 2 * dpr);
        gr.addColorStop(0, 'transparent');
        gr.addColorStop(1, pal.sweep);
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = gr;
        ctx.fillRect(0, sweep - 30 * dpr, W, 32 * dpr);
        ctx.globalAlpha = 1;
      }
      // neige numérique
      const specks = Math.round(p * 260);
      for (let i = 0; i < specks; i++) {
        ctx.fillStyle = pal.bars[i % pal.bars.length];
        ctx.fillRect(Math.random() * W, Math.random() * H, (1 + Math.random() * 6) * dpr, dpr);
      }
    }
  }
  ctx.restore();
}

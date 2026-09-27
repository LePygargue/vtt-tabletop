'use strict';
/**
 * Fiche de personnage : formulaire construit depuis le schéma du jeu du salon
 * (game.sheet, voir lib/games) et synchronisation avec le serveur. Un joueur n'a
 * que sa propre fiche ; le MJ choisit un joueur via le tokenId de son jeton
 * (jamais le playerId, qui reste caché du client).
 */
let currentSheet = null;
let currentTokenId = null; // MJ uniquement : jeton du joueur actuellement affiché
let sheetRenderers = []; // (fiche) => void : chaque élément du formulaire se remet à jour depuis la fiche
let quickRenderers = []; // idem pour le résumé « Personnage » du panneau latéral

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}
const signed = (n) => (n > 0 ? '+' + n : String(n));
function intOr(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
/** Met à jour la valeur d'un champ, sauf s'il est en cours de saisie. */
function setFieldValue(input, value) {
  if (document.activeElement !== input) input.value = value;
}

function fillOptions(select, min, max, withSign) {
  for (let i = min; i <= max; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = withSign ? signed(i) : String(i);
    select.appendChild(opt);
  }
}

/** Dessine `value` cases pleines puis des cases creuses jusqu'à `max` (4 par ligne). */
function renderStatBoxes(root, value, max = value) {
  if (typeof root === 'string') root = $(root);
  if (!root) return;
  root.textContent = '';
  const total = Math.max(0, Math.min(40, Math.round(Math.max(value, max)) || 0));
  for (let i = 0; i < total; i++) root.appendChild(el('div', 'box' + (i < value ? '' : ' off')));
}

/** Cycle d'une case de dégâts au clic : vide → superficiel → aggravé → vide. */
const DAMAGE_CYCLE = { '': 's', s: 'a', a: '' };
const DAMAGE_LABELS = { '': 'vide', s: 'superficiel', a: 'aggravé' };
/**
 * Tracker à cases Superficiel/Aggravé (cliquables si `editable`) :
 * `max` cases, chacune dans l'état `track[i]` ('' vide, 's' superficiel, 'a' aggravé).
 */
function renderDamageTrack(root, key, max, track, editable) {
  root.textContent = '';
  const n = Math.max(0, Math.min(20, Math.round(max) || 0));
  for (let i = 0; i < n; i++) {
    const state = track[i] || '';
    const box = document.createElement(editable ? 'button' : 'div');
    box.className = 'box dmg-' + (state || 'empty');
    if (editable) {
      box.type = 'button';
      // l'explication est dans le tooltip (data-tip) de la rangée ; ici, juste l'état de la case
      box.setAttribute('aria-label', `Case ${i + 1} : ${DAMAGE_LABELS[state]}`);
      box.addEventListener('click', () => {
        const next = track.slice(0, n);
        while (next.length < n) next.push('');
        next[i] = DAMAGE_CYCLE[next[i] || ''];
        sendSheetPatch({ [key]: next });
      });
    }
    root.appendChild(box);
  }
}

/* ---------- Champs simples (texte, nombre, texte long) ---------- */
function buildInput(f) {
  if (f.type === 'number') {
    const input = el('input');
    input.type = 'number';
    input.min = f.min;
    input.max = f.max;
    input.step = 1;
    input.addEventListener('change', () => sendSheetPatch({ [f.key]: intOr(input.value, f.default ?? 0) }));
    sheetRenderers.push((s) => setFieldValue(input, s[f.key]));
    return input;
  }
  const input = el('input');
  input.maxLength = f.max || 60;
  if (f.fallback) input.placeholder = f.fallback;
  input.addEventListener('input', () => queueSheetPatch({ [f.key]: input.value }));
  sheetRenderers.push((s) => setFieldValue(input, s[f.key] || ''));
  return input;
}
function labelled(text, control, tip) {
  const label = el('label', null, text);
  if (tip) { label.dataset.tip = tip; label.classList.add('tip-left'); }
  label.appendChild(control);
  return label;
}
function buildRow(fields) {
  const row = el('div', 'sheet-row3');
  for (const f of fields) row.appendChild(labelled(f.label, buildInput(f), f.tip));
  return row;
}
function buildTextarea(f) {
  const ta = el('textarea');
  ta.rows = f.rows || 3;
  ta.maxLength = f.max || 500;
  if (f.placeholder) ta.placeholder = f.placeholder;
  ta.addEventListener('input', () => queueSheetPatch({ [f.key]: ta.value }));
  sheetRenderers.push((s) => setFieldValue(ta, s[f.key] || ''));
  return ta;
}

/* ---------- Jauges et pistes ---------- */
function buildTrack(f) {
  const wrap = el('div', 'stat-track');
  wrap.appendChild(el('span', 'stat-track-label', f.label));
  const grid = el('div', 'box-grid dmg-grid tip-left');
  if (f.tip) grid.dataset.tip = f.tip;
  wrap.appendChild(grid);
  sheetRenderers.push((s) => renderDamageTrack(grid, f.key, s[f.maxKey], s[f.key] || [], true));
  return wrap;
}
const counterMax = (f, s) => (f.maxKey ? s[f.maxKey] : f.fixedMax);
const counterLabel = (f, s) => (f.labelKey && s[f.labelKey]) || f.label;
function buildCounter(f) {
  const wrap = el('div', 'sheet-counter');
  const row = el('div', 'sheet-row3');
  if (f.labelKey) {
    row.appendChild(labelled('Libellé', buildInput({ type: 'text', key: f.labelKey, max: 30, fallback: f.label })));
    row.appendChild(labelled('Valeur', buildInput({ type: 'number', key: f.key, min: f.min ?? 0, max: f.max, default: f.default ?? 0 })));
  } else {
    row.appendChild(labelled(f.label, buildInput({ type: 'number', key: f.key, min: f.min ?? 0, max: f.max, default: f.default ?? 0 })));
  }
  if (f.maxKey) {
    row.appendChild(labelled(f.labelKey ? 'Max' : f.label + ' (max)', buildInput({ type: 'number', key: f.maxKey, min: f.maxMin ?? 1, max: f.maxMax, default: f.defaultMax })));
  }
  wrap.appendChild(row);
  if (f.display === 'boxes') {
    const track = el('div', 'stat-track');
    const lbl = el('span', 'stat-track-label', f.label);
    const grid = el('div', 'box-grid');
    track.append(lbl, grid);
    wrap.appendChild(track);
    sheetRenderers.push((s) => {
      lbl.textContent = counterLabel(f, s);
      renderStatBoxes(grid, s[f.key] || 0, counterMax(f, s) || 0);
    });
  }
  return wrap;
}

/* ---------- Groupes (attributs, compétences…) ---------- */
/** Constructeurs de ligne par type d'entrée : (champ groupe, entrée) => élément. */
const GROUP_ROWS = {
  rating(f, e) {
    const row = el('label', 'sheet-attr-row');
    const select = el('select');
    fillOptions(select, f.item.min, f.item.max, f.item.signed);
    select.addEventListener('change', () => sendSheetPatch({ [f.key]: { [e.key]: parseInt(select.value, 10) } }));
    sheetRenderers.push((s) => { select.value = String(s[f.key][e.key]); });
    row.append(el('span', null, e.label), select);
    return row;
  },
  skill(f, e) {
    const row = el('div', 'sheet-skill-row');
    const select = el('select');
    select.setAttribute('aria-label', e.label);
    fillOptions(select, f.item.min, f.item.max);
    select.addEventListener('change', () => sendSheetPatch({ [f.key]: { [e.key]: { rating: parseInt(select.value, 10) } } }));
    const spec = el('input');
    spec.maxLength = 40;
    spec.placeholder = 'Spécialité';
    spec.setAttribute('aria-label', 'Spécialité : ' + e.label);
    spec.addEventListener('input', () => queueSheetPatch({ [f.key]: { [e.key]: { specialty: spec.value } } }));
    sheetRenderers.push((s) => {
      const sk = s[f.key][e.key];
      select.value = String(sk.rating);
      setFieldValue(spec, sk.specialty);
    });
    row.append(el('span', 'sheet-skill-name', e.label), select, spec);
    return row;
  },
  /** Rang de maîtrise (Pathfinder) : total = attribut + (niveau + 2 × rang dès le 1er rang) + bonus. */
  proficiency(f, e) {
    const row = el('div', 'sheet-prof-row');
    const select = el('select');
    select.setAttribute('aria-label', 'Maîtrise : ' + e.label);
    f.item.ranks.forEach((label, i) => {
      const opt = el('option', null, label);
      opt.value = String(i);
      select.appendChild(opt);
    });
    select.addEventListener('change', () => sendSheetPatch({ [f.key]: { [e.key]: { rank: parseInt(select.value, 10) } } }));
    const bonus = el('input');
    bonus.type = 'number';
    bonus.min = -20;
    bonus.max = 20;
    bonus.title = 'Bonus / malus divers';
    bonus.setAttribute('aria-label', 'Bonus divers : ' + e.label);
    bonus.addEventListener('change', () => sendSheetPatch({ [f.key]: { [e.key]: { bonus: intOr(bonus.value, 0) } } }));
    const total = el('span', 'sheet-prof-total');
    sheetRenderers.push((s) => {
      const p = s[f.key][e.key];
      select.value = String(p.rank);
      setFieldValue(bonus, p.bonus);
      const attr = (s[f.item.attrGroup] || {})[e.attr] || 0;
      const level = s[f.item.levelKey] || 1;
      total.textContent = signed(attr + (p.rank > 0 ? level + 2 * p.rank : 0) + p.bonus);
    });
    const name = el('span', 'sheet-skill-name', e.label);
    if (e.attr) name.appendChild(el('small', null, ' ' + e.attr.toUpperCase()));
    row.append(name, select, bonus, total);
    return row;
  },
  /** Pourcentage (L'Appel de Cthulhu) : valeur, et seuils Majeure (½) / Extrême (⅕). */
  percent(f, e) {
    const row = el('div', 'sheet-pct-row');
    const input = el('input');
    input.type = 'number';
    input.min = f.item.min ?? 0;
    input.max = f.item.max ?? 99;
    input.setAttribute('aria-label', e.label);
    input.addEventListener('change', () => sendSheetPatch({ [f.key]: { [e.key]: intOr(input.value, 0) } }));
    const thresholds = el('span', 'sheet-pct-thresholds');
    sheetRenderers.push((s) => {
      const v = s[f.key][e.key];
      setFieldValue(input, v);
      thresholds.textContent = `${Math.floor(v / 2)} · ${Math.floor(v / 5)}`;
    });
    thresholds.title = 'Majeure (½) · Extrême (⅕)';
    row.append(el('span', 'sheet-skill-name', e.label), input, thresholds);
    return row;
  },
};
function buildGroup(f) {
  const grid = el('div', f.item.type === 'rating' ? 'sheet-attr-grid' : 'sheet-skill-grid');
  grid.style.setProperty('--cols', f.columns.length);
  for (const col of f.columns) {
    const c = el('div', 'sheet-col');
    if (col.title) c.appendChild(el('h4', null, col.title));
    for (const [key, label, extra] of col.items) c.appendChild(GROUP_ROWS[f.item.type](f, { key, label, ...(extra || {}) }));
    grid.appendChild(c);
  }
  return grid;
}

function buildField(f) {
  switch (f.type) {
    case 'text': case 'number': {
      const row = buildRow([f]);
      if (f.wide) row.classList.add('wide');
      return row;
    }
    case 'multiline': return f.label ? labelled(f.label, buildTextarea(f)) : buildTextarea(f);
    case 'track': return buildTrack(f);
    case 'counter': return buildCounter(f);
    case 'group': return buildGroup(f);
    default: return el('div');
  }
}

/** Aide-mémoire repliable du jeu (tableaux de création, règles…). */
function buildSheetHelp(help) {
  const details = $('sheetHelp');
  details.textContent = '';
  details.hidden = !help;
  if (!help) return;
  details.appendChild(el('summary', null, help.summary));
  const tables = el('div', 'sheet-help-tables');
  for (const t of help.tables || []) {
    const table = el('table');
    table.appendChild(el('caption', null, t.caption));
    const head = el('tr');
    for (const h of t.head) head.appendChild(el('th', null, h));
    table.appendChild(el('thead')).appendChild(head);
    const body = table.appendChild(el('tbody'));
    for (const r of t.rows) {
      const tr = body.appendChild(el('tr'));
      for (const c of r) tr.appendChild(el('td', null, c));
    }
    tables.appendChild(table);
  }
  details.appendChild(tables);
}

function buildSheetForm() {
  const body = $('sheetBody');
  body.textContent = '';
  sheetRenderers = [];
  buildSheetHelp(game.sheet.help);
  for (const sec of game.sheet.sections) {
    const section = el('section');
    if (sec.title || sec.titleKey) {
      const h = section.appendChild(el('h3', null, sec.title || ''));
      if (sec.titleKey) sheetRenderers.push((s) => { h.textContent = s[sec.titleKey]; });
    }
    for (const f of sec.fields) section.appendChild(Array.isArray(f) ? buildRow(f) : buildField(f));
    if (sec.hint) section.appendChild(el('p', 'hint', sec.hint));
    body.appendChild(section);
  }
  renderSheetForm();
}

/* ---------- Résumé « Personnage » du panneau latéral (joueur) ---------- */
function findSheetField(key) {
  for (const sec of game.sheet.sections) {
    for (const f of sec.fields.flat()) if (f.key === key) return f;
  }
  return null;
}
function buildQuickStats() {
  const root = $('quickStats');
  root.textContent = '';
  quickRenderers = [];
  for (const key of game.sheet.quick || []) {
    const f = findSheetField(key);
    if (!f) continue;
    const wrap = root.appendChild(el('div', 'stat-track'));
    const lbl = wrap.appendChild(el('span', 'stat-track-label', f.quickLabel || f.label));
    if (f.type === 'track') {
      const grid = wrap.appendChild(el('div', 'box-grid dmg-grid tip-left'));
      if (f.tip) grid.dataset.tip = f.tip;
      quickRenderers.push((s) => renderDamageTrack(grid, f.key, s[f.maxKey], s[f.key] || [], true));
    } else if (f.type === 'counter' && f.display === 'boxes') {
      const grid = wrap.appendChild(el('div', 'box-grid'));
      quickRenderers.push((s) => {
        if (f.labelKey) lbl.textContent = counterLabel(f, s);
        renderStatBoxes(grid, s[f.key] || 0, counterMax(f, s) || 0);
      });
    } else if (f.type === 'counter') {
      // Compteur chiffré (PV, SAN…) : boutons −/+ pour les changements rapides en jeu
      const row = wrap.appendChild(el('div', 'quick-counter'));
      const minus = row.appendChild(el('button', null, '−'));
      const value = row.appendChild(el('span', 'quick-value'));
      const plus = row.appendChild(el('button', null, '+'));
      minus.type = plus.type = 'button';
      minus.setAttribute('aria-label', `${f.label} −1`);
      plus.setAttribute('aria-label', `${f.label} +1`);
      const step = (d) => {
        const s = currentSheet;
        if (!s) return;
        const max = counterMax(f, s) ?? f.max;
        sendSheetPatch({ [f.key]: Math.max(f.min ?? 0, Math.min(max, (s[f.key] || 0) + d)) });
      };
      minus.addEventListener('click', () => step(-1));
      plus.addEventListener('click', () => step(1));
      quickRenderers.push((s) => {
        const max = counterMax(f, s);
        value.textContent = max != null ? `${s[f.key]} / ${max}` : String(s[f.key]);
        wrap.dataset.key = f.key;
        wrap.style.setProperty('--fill', max ? Math.max(0, Math.min(1, s[f.key] / max)) : 1);
      });
    }
  }
}

function renderSheetForm() {
  renderSheetPortrait(); // portrait.js
  const s = currentSheet;
  if (!s || !game) return;
  for (const r of sheetRenderers) r(s);
  if (!isGM()) for (const r of quickRenderers) r(s);
  updateMindFx(s);
}

/**
 * Effets visuels propres à chaque joueur quand une valeur de sa fiche s'effondre (SAN de
 * L'Appel de Cthulhu, game.sheet.mindFx) : rien au-dessus de 80 % de la valeur de référence
 * (SAN de départ = POU), puis --mind monte de 0 à 1 jusqu'à 0. Le MJ n'a jamais d'effet.
 */
function updateMindFx(s) {
  const fx = game && game.sheet.mindFx;
  let mind = 0;
  if (fx && s && !isGM()) {
    const ref = Number(fx.ref.split('.').reduce((o, k) => (o ? o[k] : undefined), s));
    const base = ref > 0 ? ref : 50;
    const ratio = Math.max(0, Math.min(1, (s[fx.key] ?? base) / base));
    mind = Math.max(0, Math.min(1, (0.8 - ratio) / 0.8));
  }
  document.documentElement.style.setProperty('--mind', mind.toFixed(3));
  const tier = mind <= 0 ? '0' : mind < 0.34 ? '1' : mind < 0.67 ? '2' : '3';
  if (document.body.dataset.mind !== tier) {
    document.body.dataset.mind = tier;
    scheduleMindWhisper();
    scheduleMindEyes();
  }
}

/* Murmures du palier 3 : une phrase à un endroit pris au hasard, qui apparaît et s'efface lentement, avec un des chuchotements. */
const MIND_WHISPERS = [
  "ph'nglui mglw'nafh Cthulhu R'lyeh wgah'nagl fhtagn",
  'Iä ! Iä ! Cthulhu fhtagn !',
  'Yog-Sothoth connaît la porte',
  "Ils sont déjà là",
  "N'écoute pas",
  'Le ciel n’a pas la bonne couleur',
  'Tu l’as vu, toi aussi ?',
];
const MIND_WHISPER_SOUNDS = ['/audio/strange-whisper-1.mp3', '/audio/strange-whisper-2.mp3', '/audio/strange-whisper-3.mp3'];
const MIND_WHISPER_FADE_MS = 3500; // durée du fondu (transition CSS de .mind-whisper)
const MIND_WHISPER_HOLD_MS = 1500;
let mindWhisperTimer = 0;
function scheduleMindWhisper() {
  clearTimeout(mindWhisperTimer);
  $('mindWhisper').classList.remove('on');
  if (document.body.dataset.mind !== '3' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const url of MIND_WHISPER_SOUNDS) gaugeSound(url); // préchargés (danger.js)
  mindWhisperTimer = setTimeout(showMindWhisper, 4000 + Math.random() * 8000);
}
function showMindWhisper() {
  const w = $('mindWhisper');
  w.textContent = MIND_WHISPERS[Math.floor(Math.random() * MIND_WHISPERS.length)];
  w.style.left = `${4 + Math.random() * 52}%`; // max-width 40 % : reste dans l'écran
  w.style.top = `${10 + Math.random() * 72}%`;
  w.classList.add('on');
  playSoundUrl(MIND_WHISPER_SOUNDS[Math.floor(Math.random() * MIND_WHISPER_SOUNDS.length)]); // volume réglé dans l'aide (?)
  mindWhisperTimer = setTimeout(() => {
    w.classList.remove('on');
    mindWhisperTimer = setTimeout(scheduleMindWhisper, MIND_WHISPER_FADE_MS);
  }, MIND_WHISPER_FADE_MS + MIND_WHISPER_HOLD_MS);
}

/*
 * Yeux du palier 3 : un œil (ou une paire) à pupille fendue, violet, vert ou rouge, qui s'ouvre
 * quelque part au hasard, cligne, puis s'efface. Même principe que les murmures : fondu d'opacité,
 * clignement par transform (rien à redessiner), une apparition à la fois.
 */
const MIND_EYE_COLORS = ['#9b6fe0', '#3fe0a5', '#d0556a'];
const MIND_EYE_FADE_MS = 3000; // transition CSS de .mind-eyes
const MIND_EYE_HOLD_MS = 2600; // le clignement tombe au milieu
let mindEyeTimer = 0;
let mindEyeId = 0;
/** Œil en SVG (couleur : currentColor), iris et pupille découpés dans la forme en amande. */
function mindEyeSvg() {
  const id = 'mindEyeClip' + ++mindEyeId;
  const lookX = (Math.random() - 0.5) * 10; // regard un peu de côté
  return `<svg class="mind-eye" viewBox="0 0 60 40" width="60" height="40">
    <defs><clipPath id="${id}"><path d="M3 20 Q30 -2 57 20 Q30 42 3 20 Z"/></clipPath></defs>
    <path d="M3 20 Q30 -2 57 20 Q30 42 3 20 Z" fill="#050806"/>
    <g clip-path="url(#${id})">
      <circle cx="${30 + lookX}" cy="20" r="11" fill="currentColor"/>
      <circle cx="${30 + lookX}" cy="20" r="11" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="3"/>
      <circle cx="${30 + lookX}" cy="20" r="6" fill="#000" fill-opacity=".25"/>
      <ellipse cx="${30 + lookX}" cy="20" rx="2" ry="8.5" fill="#000"/>
      <circle cx="${27 + lookX}" cy="16" r="1.6" fill="#fff" fill-opacity=".75"/>
    </g>
    <path d="M3 20 Q30 -2 57 20 Q30 42 3 20 Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-opacity=".8"/>
  </svg>`;
}
function scheduleMindEyes() {
  clearTimeout(mindEyeTimer);
  $('mindEyes').classList.remove('on', 'blink');
  if (document.body.dataset.mind !== '3' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  mindEyeTimer = setTimeout(showMindEyes, 6000 + Math.random() * 10000);
}
function showMindEyes() {
  const box = $('mindEyes');
  box.innerHTML = Math.random() < 0.5 ? mindEyeSvg() : mindEyeSvg() + mindEyeSvg(); // un œil ou une paire
  box.style.color = MIND_EYE_COLORS[Math.floor(Math.random() * MIND_EYE_COLORS.length)];
  box.style.setProperty('--eye-w', `${50 + Math.random() * 60}px`);
  box.style.left = `${4 + Math.random() * 80}%`;
  box.style.top = `${10 + Math.random() * 75}%`;
  box.classList.add('on');
  mindEyeTimer = setTimeout(() => {
    box.classList.add('blink');
    mindEyeTimer = setTimeout(() => {
      box.classList.remove('on', 'blink');
      mindEyeTimer = setTimeout(scheduleMindEyes, MIND_EYE_FADE_MS);
    }, MIND_EYE_HOLD_MS / 2);
  }, MIND_EYE_FADE_MS + MIND_EYE_HOLD_MS / 2);
}

function sendSheetPatch(patch) {
  if (isGM() && !currentTokenId) return;
  send({ t: 'sheet', op: 'update', tokenId: isGM() ? currentTokenId : undefined, patch });
}

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
/** Fusionne un patch dans le patch en attente (pour ne rien perdre entre deux champs modifiés vite). */
function mergeSheetPatch(base, patch) {
  for (const k of Object.keys(patch)) {
    if (!isPlainObject(patch[k])) { base[k] = patch[k]; continue; }
    // groupe (attributs, compétences…) : fusion par entrée, et par champ d'entrée
    base[k] = isPlainObject(base[k]) ? base[k] : {};
    for (const sub of Object.keys(patch[k])) {
      const v = patch[k][sub];
      base[k][sub] = isPlainObject(v) && isPlainObject(base[k][sub]) ? { ...base[k][sub], ...v } : v;
    }
  }
  return base;
}
let pendingSheetPatch = null;
let pendingSheetTimer = null;
function queueSheetPatch(patch, delay = 600) {
  pendingSheetPatch = mergeSheetPatch(pendingSheetPatch || {}, patch);
  clearTimeout(pendingSheetTimer);
  pendingSheetTimer = setTimeout(() => {
    const p = pendingSheetPatch;
    pendingSheetPatch = null;
    sendSheetPatch(p);
  }, delay);
}

/** MJ : liste des jetons de joueurs (déjà connus côté client), jamais le playerId. */
function openSheetForToken(tokenId) {
  if (!tokenId) return;
  currentTokenId = tokenId;
  send({ t: 'sheet', op: 'get', tokenId });
}
$('sheetPlayerSelect').addEventListener('change', () => openSheetForToken($('sheetPlayerSelect').value));

$('btnSheet').addEventListener('click', () => {
  const panel = $('sheetPanel');
  panel.hidden = !panel.hidden;
  if (panel.hidden) return;
  if (isGM()) {
    const tokenId = refreshPlayerOptions('sheetPlayerSelect');
    if (tokenId && tokenId !== currentTokenId) openSheetForToken(tokenId);
  }
});
$('btnSheetClose').addEventListener('click', () => { $('sheetPanel').hidden = true; });
closeOnEscape(() => !$('sheetPanel').hidden, () => { $('sheetPanel').hidden = true; });
closeOnClickOutside($('sheetPanel').querySelector('.overlay-card'), () => !$('sheetPanel').hidden, () => { $('sheetPanel').hidden = true; }, $('btnSheet'));

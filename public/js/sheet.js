'use strict';
/**
 * Fiche de personnage (Chronicles of Darkness) : construction du formulaire
 * (attributs/compétences générés depuis ces tables) et synchronisation avec
 * le serveur. Un joueur n'a que sa propre fiche ; le MJ choisit un joueur via
 * le tokenId de son jeton (jamais le playerId, qui reste caché du client).
 */
const ATTR_GROUPS = [
  ['Physique', [['force', 'Force'], ['dexterite', 'Dextérité'], ['vigueur', 'Vigueur']]],
  ['Social', [['charisme', 'Charisme'], ['manipulation', 'Manipulation'], ['sangFroid', 'Sang-froid']]],
  ['Mental', [['intelligence', 'Intelligence'], ['astuce', 'Astuce'], ['resolution', 'Résolution']]],
];
const SKILL_GROUPS = [
  ['Physiques', [
    ['athletisme', 'Athlétisme'], ['bagarre', 'Bagarre'], ['artisanat', 'Artisanat'], ['conduite', 'Conduite'],
    ['armeAFeu', 'Arme à feu'], ['larcin', 'Larcin'], ['melee', 'Mêlée'], ['furtivite', 'Furtivité'], ['survie', 'Survie'],
  ]],
  ['Sociales', [
    ['animaux', 'Animaux'], ['etiquette', 'Étiquette'], ['empathie', 'Empathie'], ['intimidation', 'Intimidation'],
    ['commandement', 'Commandement'], ['representation', 'Représentation'], ['persuasion', 'Persuasion'], ['rue', 'La rue'], ['subterfuge', 'Subterfuge'],
  ]],
  ['Mentales', [
    ['erudition', 'Érudition'], ['vigilance', 'Vigilance'], ['finances', 'Finances'], ['investigation', 'Investigation'],
    ['medecine', 'Médecine'], ['occultisme', 'Occultisme'], ['politique', 'Politique'], ['sciences', 'Sciences'], ['technologie', 'Technologie'],
  ]],
];

let currentSheet = null;
let currentTokenId = null; // MJ uniquement : jeton du joueur actuellement affiché

function fillOptions(select, min, max) {
  for (let i = min; i <= max; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = String(i);
    select.appendChild(opt);
  }
}

function buildAttributeGrid() {
  const root = $('sheetAttributes');
  for (const [groupLabel, items] of ATTR_GROUPS) {
    const col = document.createElement('div');
    col.className = 'sheet-col';
    const h = document.createElement('h4');
    h.textContent = groupLabel;
    col.appendChild(h);
    for (const [key, label] of items) {
      const row = document.createElement('label');
      row.className = 'sheet-attr-row';
      const span = document.createElement('span');
      span.textContent = label;
      const select = document.createElement('select');
      select.id = 'sheetAttr_' + key;
      fillOptions(select, 1, 5);
      select.addEventListener('change', () => {
        sendSheetPatch({ attributes: { [key]: parseInt(select.value, 10) } });
      });
      row.append(span, select);
      col.appendChild(row);
    }
    root.appendChild(col);
  }
}

function buildSkillGrid() {
  const root = $('sheetSkills');
  for (const [groupLabel, items] of SKILL_GROUPS) {
    const col = document.createElement('div');
    col.className = 'sheet-col';
    const h = document.createElement('h4');
    h.textContent = groupLabel;
    col.appendChild(h);
    for (const [key, label] of items) {
      const row = document.createElement('div');
      row.className = 'sheet-skill-row';
      const span = document.createElement('span');
      span.className = 'sheet-skill-name';
      span.textContent = label;
      const select = document.createElement('select');
      select.id = 'sheetSkillRating_' + key;
      fillOptions(select, 0, 5);
      select.addEventListener('change', () => {
        sendSheetPatch({ skills: { [key]: { rating: parseInt(select.value, 10) } } });
      });
      const spec = document.createElement('input');
      spec.id = 'sheetSkillSpec_' + key;
      spec.maxLength = 40;
      spec.placeholder = 'Spécialité';
      spec.addEventListener('input', () => {
        queueSheetPatch({ skills: { [key]: { specialty: spec.value } } });
      });
      row.append(span, select, spec);
      col.appendChild(row);
    }
    root.appendChild(col);
  }
}
buildAttributeGrid();
buildSkillGrid();

/** Dessine `value` carrés (4 par ligne) dans le conteneur `id` — visualisation simple des jauges. */
function renderStatBoxes(id, value) {
  const root = $(id);
  root.textContent = '';
  const n = Math.max(0, Math.min(40, Math.round(value) || 0));
  for (let i = 0; i < n; i++) {
    const box = document.createElement('div');
    box.className = 'box';
    root.appendChild(box);
  }
}

/** Cycle d'une case de dégâts au clic : vide → superficiel → aggravé → vide. */
const DAMAGE_CYCLE = { '': 's', s: 'a', a: '' };
/**
 * Tracker Santé/Volonté à cases Superficiel/Aggravé (cliquables si `editable`) :
 * `max` cases, chacune dans l'état `track[i]` ('' vide, 's' superficiel, 'a' aggravé).
 */
function renderDamageTrack(id, key, max, track, editable) {
  const root = $(id);
  if (!root) return;
  root.textContent = '';
  const n = Math.max(0, Math.min(20, Math.round(max) || 0));
  for (let i = 0; i < n; i++) {
    const state = track[i] || '';
    const box = document.createElement(editable ? 'button' : 'div');
    box.className = 'box dmg-' + (state || 'empty');
    if (editable) {
      box.type = 'button';
      box.title = 'Cliquer : vide → superficiel → aggravé → vide';
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

function renderSheetForm() {
  const s = currentSheet;
  if (!s) return;
  renderDamageTrack('sheetHealthBoxes', 'health', s.healthMax, s.health, true);
  renderDamageTrack('sheetWillpowerBoxes', 'willpower', s.willpowerMax, s.willpower, true);
  renderDamageTrack('hpBoxes', 'health', s.healthMax, s.health, false);
  renderDamageTrack('willpowerBoxes', 'willpower', s.willpowerMax, s.willpower, false);
  renderStatBoxes('hungerBoxes', s.hunger);
  renderStatBoxes('moralityBoxes', s.morality);
  for (const [, items] of ATTR_GROUPS) {
    for (const [key] of items) $('sheetAttr_' + key).value = String(s.attributes[key] || 1);
  }
  for (const [, items] of SKILL_GROUPS) {
    for (const [key] of items) {
      const sk = s.skills[key] || { rating: 0, specialty: '' };
      $('sheetSkillRating_' + key).value = String(sk.rating || 0);
      $('sheetSkillSpec_' + key).value = sk.specialty || '';
    }
  }
  if (document.activeElement !== $('sheetHealthMax')) $('sheetHealthMax').value = s.healthMax || 0;
  if (document.activeElement !== $('sheetWillpowerMax')) $('sheetWillpowerMax').value = s.willpowerMax || 0;
  $('sheetHunger').value = s.hunger || 0;
  $('sheetHungerMax').value = s.hungerMax || 5;
  $('sheetHungerLabel').value = s.hungerLabel || 'Faim';
  $('sheetMorality').value = s.morality || 0;
  $('sheetMoralityMax').value = s.moralityMax || 10;
  $('sheetMoralityLabel').value = s.moralityLabel || 'Humanité';
  $('sheetPowersLabel').value = s.powersLabel || 'Disciplines / Dons / Atouts';
  $('sheetPowers').value = s.powers || '';
  $('sheetConcept').value = s.concept || '';
  $('sheetVirtue').value = s.virtue || '';
  $('sheetVice').value = s.vice || '';
  $('sheetMerits').value = s.merits || '';
  $('sheetNotes').value = s.notes || '';
  const hungerLbl = $('hungerBoxesLabel');
  if (hungerLbl) hungerLbl.textContent = s.hungerLabel || 'Faim';
  const moralityLbl = $('moralityBoxesLabel');
  if (moralityLbl) moralityLbl.textContent = s.moralityLabel || 'Humanité';
  const powersLbl = $('sheetPowersLegend');
  if (powersLbl) powersLbl.textContent = s.powersLabel || 'Disciplines / Dons / Atouts';
  const miniHungerLbl = $('hungerBoxesMiniLabel');
  if (miniHungerLbl) miniHungerLbl.textContent = s.hungerLabel || 'Faim';
  renderStatBoxes('hungerBoxesMini', s.hunger);
}

function sendSheetPatch(patch) {
  if (isGM() && !currentTokenId) return;
  send({ t: 'sheet', op: 'update', tokenId: isGM() ? currentTokenId : undefined, patch });
}

/** Fusionne un patch dans le patch en attente (pour ne rien perdre entre deux champs modifiés vite). */
function mergeSheetPatch(base, patch) {
  for (const k of Object.keys(patch)) {
    if (k === 'skills') {
      base.skills = base.skills || {};
      for (const sk of Object.keys(patch.skills)) base.skills[sk] = { ...(base.skills[sk] || {}), ...patch.skills[sk] };
    } else if (k === 'attributes') {
      base.attributes = { ...(base.attributes || {}), ...patch.attributes };
    } else {
      base[k] = patch[k];
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

$('sheetConcept').addEventListener('input', () => queueSheetPatch({ concept: $('sheetConcept').value }));
$('sheetVirtue').addEventListener('input', () => queueSheetPatch({ virtue: $('sheetVirtue').value }));
$('sheetVice').addEventListener('input', () => queueSheetPatch({ vice: $('sheetVice').value }));
$('sheetMerits').addEventListener('input', () => queueSheetPatch({ merits: $('sheetMerits').value }));
$('sheetNotes').addEventListener('input', () => queueSheetPatch({ notes: $('sheetNotes').value }));
$('sheetHealthMax').addEventListener('change', () => sendSheetPatch({ healthMax: parseInt($('sheetHealthMax').value, 10) || 0 }));
$('sheetWillpowerMax').addEventListener('change', () => sendSheetPatch({ willpowerMax: parseInt($('sheetWillpowerMax').value, 10) || 0 }));
$('sheetHunger').addEventListener('change', () => sendSheetPatch({ hunger: parseInt($('sheetHunger').value, 10) || 0 }));
$('sheetHungerMax').addEventListener('change', () => sendSheetPatch({ hungerMax: parseInt($('sheetHungerMax').value, 10) || 5 }));
$('sheetHungerLabel').addEventListener('input', () => queueSheetPatch({ hungerLabel: $('sheetHungerLabel').value }));
$('sheetMorality').addEventListener('change', () => sendSheetPatch({ morality: parseInt($('sheetMorality').value, 10) || 0 }));
$('sheetMoralityMax').addEventListener('change', () => sendSheetPatch({ moralityMax: parseInt($('sheetMoralityMax').value, 10) || 10 }));
$('sheetMoralityLabel').addEventListener('input', () => queueSheetPatch({ moralityLabel: $('sheetMoralityLabel').value }));
$('sheetPowersLabel').addEventListener('input', () => queueSheetPatch({ powersLabel: $('sheetPowersLabel').value }));
$('sheetPowers').addEventListener('input', () => queueSheetPatch({ powers: $('sheetPowers').value }));

/** MJ : liste des jetons de joueurs (déjà connus côté client), jamais le playerId. */
function refreshSheetPlayerOptions() {
  const sel = $('sheetPlayerSelect');
  const prev = sel.value;
  sel.textContent = '';
  const list = [...tokens.values()].filter((t) => t.pc).sort((a, b) => a.name.localeCompare(b.name));
  for (const t of list) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  }
  if (list.some((t) => t.id === prev)) sel.value = prev;
  else if (list.length) sel.value = list[0].id;
  return sel.value || null;
}
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
    const tokenId = refreshSheetPlayerOptions();
    if (tokenId && tokenId !== currentTokenId) openSheetForToken(tokenId);
  }
});
$('btnSheetClose').addEventListener('click', () => { $('sheetPanel').hidden = true; });

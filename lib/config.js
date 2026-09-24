'use strict';
/**
 * Constantes partagées et préparation du dossier de données.
 */
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const ROOMS_DIR = path.join(DATA_DIR, 'rooms');
const STATE_FILE = path.join(DATA_DIR, 'rooms.json'); // ancien format agrégé, lu une seule fois pour migration
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MAX_UPLOAD = 20 * 1024 * 1024;
const MAX_PORTRAIT_UPLOAD = 5 * 1024 * 1024; // portrait de PNJ (le client le réduit avant envoi)
const MAX_NPC_DESCRIPTION_LEN = 2000;
const MAX_TOKENS = 200;
const MAX_ROOMS = 2000;
const MAX_ROLL_HISTORY = 50;
const MAX_STROKES = 800;
const MAX_STROKE_POINTS = 1500;
const MAX_IMAGES = 20;
const MAX_FOG_CELLS = 200000; // garde-fou : cases révélées max sur la grille (plan infini)
const MAX_JOURNAL_ENTRIES = 200;
const MAX_JOURNAL_ENTRY_LEN = 4000;
const MAX_TOKEN_CONDITIONS = 6;
const MAX_CONDITION_LEN = 20;
const MAX_DANGER = 5;
const MAX_DESPERATION = 5;
const STROKE_TOOLS = ['pen', 'line', 'arrow', 'rect', 'ellipse'];
const STROKE_ID_RE = /^[0-9a-f]{12,40}$/i;
const ROOM_TTL_MS = 120 * 24 * 3600 * 1000; // salons inactifs supprimés après 120 jours
const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(ROOMS_DIR, { recursive: true });

module.exports = {
  PORT, HOST, DATA_DIR, UPLOAD_DIR, ROOMS_DIR, STATE_FILE, USERS_FILE, PUBLIC_DIR,
  MAX_UPLOAD, MAX_PORTRAIT_UPLOAD, MAX_NPC_DESCRIPTION_LEN, MAX_TOKENS, MAX_ROOMS, MAX_ROLL_HISTORY, MAX_STROKES, MAX_STROKE_POINTS, MAX_IMAGES, MAX_FOG_CELLS,
  MAX_JOURNAL_ENTRIES, MAX_JOURNAL_ENTRY_LEN, MAX_TOKEN_CONDITIONS, MAX_CONDITION_LEN, MAX_DANGER, MAX_DESPERATION,
  STROKE_TOOLS, STROKE_ID_RE, ROOM_TTL_MS, PALETTE, MIME, SECURITY_HEADERS,
};

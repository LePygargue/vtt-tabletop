'use strict';
/**
 * État partagé du plateau : identité, jetons/images/rolls/fiche (au niveau du
 * salon). La grille commune (caméra, grille, brouillard, traits) vit dans l'unique
 * viewport (voir viewport.js) — un seul canvas pour tout le salon.
 * Fichier chargé en premier : les autres scripts lisent/écrivent ces variables
 * (liaison de portée de script, comme s'ils faisaient tous partie d'un seul fichier).
 */
const $ = (id) => document.getElementById(id);
const roomId = (location.pathname.split('/')[2] || '').toUpperCase();

/* ------------------------------------------------------------------ */
/* Identité (clé MJ / joueur)                                          */
/* ------------------------------------------------------------------ */
let gmKey = null;
try {
  const h = new URLSearchParams(location.hash.slice(1)).get('gm');
  if (h) {
    gmKey = h;
    try { localStorage.setItem('gm:' + roomId, h); } catch (e) {}
    history.replaceState(null, '', location.pathname);
  } else {
    gmKey = localStorage.getItem('gm:' + roomId);
  }
} catch (e) {}

/* ------------------------------------------------------------------ */
/* État du salon (partagé entre toutes les cartes ouvertes)            */
/* ------------------------------------------------------------------ */
let role = null; // 'gm' | 'player'
let roomName = null; // nom personnalisé du salon, donné par le MJ (facultatif)
let youToken = null;
const tokens = new Map(); // tous les jetons du salon
const images = new Map(); // toutes les images posées sur la grille commune
const rolls = [];
const npcSheets = new Map(); // tokenId -> fiche PNJ rapide (MJ uniquement, chargée à la demande)
const npcVisibility = new Map(); // tokenId de PNJ -> [tokenId de PC] ayant une dérogation quand il est caché
let initiative = { active: false, round: 1, activeTokenId: null, entries: [] };
let dangerLevel = 0; // niveau de dangerosité de la scène (façon étoiles GTA)
let desperationLevel = 0; // Désespoir : jauge partagée par toute la cellule (Hunter)
let bannedPlayers = []; // [{ playerId, name }] — MJ uniquement
let online = new Set();
let selectedId = null;
let tool = 'move'; // move | reveal | hide (MJ, brouillard) — outil courant
let drawTool = 'none'; // none | pen | line | arrow | rect | ellipse | eraser
let spaceDown = false; // barre espace maintenue : force le panoramique quel que soit l'outil
let firstState = true; // pour ne cadrer automatiquement la vue qu'à la toute première connexion
const pendingErases = new Map(); // id de trait -> trait effacé par nous, en attente de confirmation (undo)

const isGM = () => role === 'gm';

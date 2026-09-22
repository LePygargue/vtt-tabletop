'use strict';
/**
 * Comptes utilisateur globaux : pas d'auto-inscription, les comptes sont
 * créés à la main via scripts/manage-users.js. Persistés dans data/users.json.
 */
const fs = require('fs');
const crypto = require('crypto');
const { USERS_FILE } = require('./config');
const { randomHex, safeEqual, isColor } = require('./util');

const users = new Map(); // id -> user
const byUsername = new Map(); // username (minuscule) -> id

function scryptHash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function normalizeUsername(u) {
  return String(u == null ? '' : u).trim().toLowerCase();
}

function reindex() {
  byUsername.clear();
  for (const u of users.values()) byUsername.set(u.username, u.id);
}

function loadUsers() {
  users.clear();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    reindex();
    return;
  }
  for (const u of raw.users || []) {
    if (!u || !u.id || !u.username) continue;
    users.set(u.id, u);
  }
  reindex();
}

function saveUsers() {
  const tmp = USERS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ users: [...users.values()] }, null, 2));
  fs.renameSync(tmp, USERS_FILE);
}

function findByUsername(username) {
  const id = byUsername.get(normalizeUsername(username));
  return id ? users.get(id) : null;
}

function createUser({ username, password, displayName, color }) {
  const name = normalizeUsername(username);
  if (!/^[a-z0-9_.-]{2,32}$/.test(name)) throw new Error("Nom d'utilisateur invalide (2 à 32 caractères : lettres, chiffres, . _ -).");
  if (findByUsername(name)) throw new Error('Ce nom d\'utilisateur existe déjà.');
  if (!password || String(password).length < 8) throw new Error('Mot de passe trop court (8 caractères minimum).');
  const salt = randomHex(16);
  const user = {
    id: randomHex(12),
    username: name,
    salt,
    passwordHash: scryptHash(password, salt),
    displayName: String(displayName || username).trim().slice(0, 24) || name,
    color: isColor(color) ? color : null,
    createdAt: Date.now(),
  };
  users.set(user.id, user);
  reindex();
  saveUsers();
  return user;
}

function removeUser(username) {
  const u = findByUsername(username);
  if (!u) return false;
  users.delete(u.id);
  reindex();
  saveUsers();
  return true;
}

function setPassword(username, password) {
  const u = findByUsername(username);
  if (!u) throw new Error('Compte introuvable.');
  if (!password || String(password).length < 8) throw new Error('Mot de passe trop court (8 caractères minimum).');
  u.salt = randomHex(16);
  u.passwordHash = scryptHash(password, u.salt);
  saveUsers();
  return u;
}

/** Comparaison à temps constant, même pour un compte inexistant (limite la fuite d'info par le timing). */
const DUMMY_SALT = randomHex(16);
const DUMMY_HASH = scryptHash('dummy-password-for-timing', DUMMY_SALT);
function verifyPassword(user, password) {
  const hash = user ? scryptHash(password, user.salt) : scryptHash(password, DUMMY_SALT);
  const ok = safeEqual(hash, user ? user.passwordHash : DUMMY_HASH);
  return !!user && ok;
}

/** Version d'un compte envoyée au client : jamais le sel ni le hash du mot de passe. */
function publicUser(u) {
  return { id: u.id, username: u.username, displayName: u.displayName, color: u.color };
}

module.exports = {
  users, loadUsers, saveUsers, createUser, removeUser, setPassword, findByUsername, verifyPassword, publicUser,
};

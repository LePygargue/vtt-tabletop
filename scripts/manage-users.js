'use strict';
/**
 * Gestion des comptes utilisateur (pas d'auto-inscription : tout passe par ici).
 *
 *   node scripts/manage-users.js add <utilisateur> <mot-de-passe> [nom-affiché] [#couleur]
 *   node scripts/manage-users.js passwd <utilisateur> <nouveau-mot-de-passe>
 *   node scripts/manage-users.js remove <utilisateur>
 *   node scripts/manage-users.js list
 *
 * Redémarre le serveur après toute modification pour qu'elle soit prise en compte.
 */

const { loadUsers, createUser, removeUser, setPassword, users } = require('../lib/users');

loadUsers();

const [, , cmd, ...args] = process.argv;

function fail(message) {
  console.error(message);
  process.exit(1);
}

switch (cmd) {
  case 'add': {
    const [username, password, displayName, color] = args;
    if (!username || !password) fail('Usage : add <utilisateur> <mot-de-passe> [nom-affiché] [#couleur]');
    try {
      const u = createUser({ username, password, displayName, color });
      console.log(`Compte créé : ${u.username} (${u.displayName})`);
    } catch (e) {
      fail(e.message);
    }
    break;
  }
  case 'passwd': {
    const [username, password] = args;
    if (!username || !password) fail('Usage : passwd <utilisateur> <nouveau-mot-de-passe>');
    try {
      setPassword(username, password);
      console.log('Mot de passe mis à jour.');
    } catch (e) {
      fail(e.message);
    }
    break;
  }
  case 'remove': {
    const [username] = args;
    if (!username) fail('Usage : remove <utilisateur>');
    if (!removeUser(username)) fail('Compte introuvable.');
    console.log('Compte supprimé.');
    break;
  }
  case 'list': {
    if (!users.size) { console.log('Aucun compte.'); break; }
    for (const u of users.values()) {
      console.log(`${u.username}\t${u.displayName}${u.color ? '\t' + u.color : ''}`);
    }
    break;
  }
  default:
    console.log([
      'Usage :',
      '  node scripts/manage-users.js add <utilisateur> <mot-de-passe> [nom-affiché] [#couleur]',
      '  node scripts/manage-users.js passwd <utilisateur> <nouveau-mot-de-passe>',
      '  node scripts/manage-users.js remove <utilisateur>',
      '  node scripts/manage-users.js list',
    ].join('\n'));
    process.exit(cmd ? 1 : 0);
}

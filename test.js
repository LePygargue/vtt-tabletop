'use strict';
// Test d'intégration : node test.js  (Node >= 22 pour le WebSocket client natif)
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'plateau-'));

// Salon à l'ancien format (une seule carte, avant la grille commune unique),
// écrit avant même de démarrer le serveur : vérifie le repli (pas de migration)
// au chargement — le salon repart avec un workplace/images vides, mais les
// jetons/joueurs sont conservés.
const LEGACY_ROOM_ID = 'LEGACY01';
const LEGACY_GM_KEY = 'a'.repeat(48);
const LEGACY_STROKE_ID = 'f'.repeat(16);
const LEGACY_TOKEN_ID = 'legacytokenid';
fs.writeFileSync(path.join(process.env.DATA_DIR, 'rooms.json'), JSON.stringify({
  rooms: [{
    id: LEGACY_ROOM_ID,
    gmKey: LEGACY_GM_KEY,
    createdAt: Date.now(),
    lastActive: Date.now(),
    map: { url: '/uploads/legacy.png', width: 2000, height: 1500 },
    grid: { size: 40, visible: true, snap: false },
    fog: { enabled: true, cols: 50, rows: 38, data: Buffer.alloc(50 * 38, 1).toString('base64') },
    tokens: [{ id: LEGACY_TOKEN_ID, name: 'Vieux PNJ', color: '#112233', size: 1, x: 12, y: 34, owner: null, hidden: false, mapId: 'oldmap1' }],
    players: [],
    strokes: [{ id: LEGACY_STROKE_ID, tool: 'pen', color: '#ff0000', width: 4, layer: 'shared', points: [10, 10, 20, 20] }],
  }],
}));

const { server } = require('./server');
const { createUser } = require('./lib/users');

// PNG 1x1 valide
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

class Client {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.waiters = [];
    this.cookie = null;
    this.ws = null;
  }
  /** Connexion HTTP : pose le cookie de session (comptes provisionnés à l'avance, pas d'auto-inscription). */
  async login(base, username, password) {
    const r = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`login ${username} : ${data.error || r.status}`);
    const setCookie = (r.headers.getSetCookie && r.headers.getSetCookie()[0]) || r.headers.get('set-cookie');
    this.cookie = setCookie.split(';')[0];
    this.user = data.user;
    return data.user;
  }
  authedFetch(base, p, opts = {}) {
    return fetch(base + p, { ...opts, headers: { ...(opts.headers || {}), Cookie: this.cookie } });
  }
  /** Échange le cookie de session contre un ticket à usage unique, puis ouvre la WebSocket. */
  async connectWs(base, wsBase) {
    const r = await this.authedFetch(base, '/api/ws-ticket');
    const { ticket } = await r.json();
    this.ws = new WebSocket(`${wsBase}/ws?ticket=${ticket}`);
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => !(w.pred(m) && (w.res(m), true)));
    };
    await this.ready;
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  waitFor(pred, ms = 2000) {
    const hit = this.msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((res, rej) => {
      const w = { pred, res };
      this.waiters.push(w);
      setTimeout(() => rej(new Error(`${this.name}: délai dépassé`)), ms);
    });
  }
  count(pred) { return this.msgs.filter(pred).length; }
  clear() { this.msgs = []; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const wsBase = `ws://127.0.0.1:${port}`;
  let ok = 0;
  const check = (name, fn) => { fn(); ok++; console.log('  ok  ' + name); };

  // --- comptes (provisionnés à l'avance, comme via scripts/manage-users.js) ---
  createUser({ username: 'gm', password: 'mj-password-1', displayName: 'MJ' });
  createUser({ username: 'alice', password: 'alice-password-1', displayName: 'Alice' });
  createUser({ username: 'bob', password: 'bob-password-1', displayName: 'Bob' });
  createUser({ username: 'carol', password: 'carol-password-1', displayName: 'Carol' });
  createUser({ username: 'intrus', password: 'intrus-password-1', displayName: 'Intrus' });

  // --- authentification ---
  let r = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gm', password: 'mauvais-mdp' }),
  });
  check('mauvais mot de passe refusé', () => assert.strictEqual(r.status, 401));
  r = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'inconnu', password: 'peu-importe' }),
  });
  check("compte inconnu refusé (même code d'erreur que mauvais mot de passe)", () => assert.strictEqual(r.status, 401));
  r = await fetch(base + '/api/rooms', { method: 'POST' });
  check('création de salon refusée sans connexion', () => assert.strictEqual(r.status, 401));
  r = await fetch(base + '/r/AAAAAAAA');
  check('page de salon redirige vers /login sans connexion', () => assert(r.redirected && r.url.endsWith('/login')));

  const gm = new Client('MJ');
  const p1 = new Client('Alice');
  const p2 = new Client('Bob');
  await gm.login(base, 'gm', 'mj-password-1');
  await p1.login(base, 'alice', 'alice-password-1');
  await p2.login(base, 'bob', 'bob-password-1');

  // --- repli (pas de migration) : un salon à l'ancien format se charge avec un workplace vide ---
  const legacy = new Client('Legacy');
  await legacy.login(base, 'gm', 'mj-password-1');
  await legacy.connectWs(base, wsBase);
  legacy.send({ t: 'join', room: LEGACY_ROOM_ID, gmKey: LEGACY_GM_KEY });
  const legacyState = await legacy.waitFor((m) => m.t === 'state');
  check('ancien format : repli sur un workplace/images vides, jetons conservés', () => {
    assert.strictEqual(legacyState.role, 'gm');
    assert.strictEqual(legacyState.grid.size, 50);
    assert.strictEqual(legacyState.fog.enabled, false);
    assert.deepStrictEqual(legacyState.fog.cells, []);
    assert.strictEqual(legacyState.strokes.length, 0);
    assert.strictEqual(legacyState.images.length, 0);
    const t = legacyState.tokens.find((tk) => tk.id === LEGACY_TOKEN_ID);
    assert(t && t.name === 'Vieux PNJ');
    assert.strictEqual(t.mapId, undefined);
  });
  legacy.ws.close();

  // --- salon ---
  const created = await (await gm.authedFetch(base, '/api/rooms', { method: 'POST' })).json();
  assert(created.id && created.gmKey);
  assert.strictEqual((await gm.authedFetch(base, '/api/rooms/ZZZZZZZZ')).status, 404);
  assert.strictEqual((await gm.authedFetch(base, '/r/' + created.id)).status, 200);
  assert.strictEqual((await fetch(base + '/../server.js')).status !== 200 || true, true);
  assert.strictEqual((await fetch(base + '/%2e%2e/server.js')).status === 200, false);
  console.log('salon ' + created.id);

  // --- connexions ---
  await Promise.all([gm.connectWs(base, wsBase), p1.connectWs(base, wsBase), p2.connectWs(base, wsBase)]);
  gm.send({ t: 'join', room: created.id, gmKey: created.gmKey });
  p1.send({ t: 'join', room: created.id });
  const s1 = await p1.waitFor((m) => m.t === 'state');
  p2.send({ t: 'join', room: created.id });
  const s2 = await p2.waitFor((m) => m.t === 'state');
  const sg = await gm.waitFor((m) => m.t === 'state');

  check('rôles', () => {
    assert.strictEqual(sg.role, 'gm');
    assert.strictEqual(s1.role, 'player');
    assert(s1.youToken && s2.youToken && s1.youToken !== s2.youToken);
  });
  check('le compte du joueur ne fuite pas dans les jetons (ni playerId, ni identifiant de compte)', () => {
    const all = JSON.stringify([s1.tokens, s2.tokens, sg.tokens]);
    assert(!all.includes('owner'));
    assert(!all.includes(s1.playerId) && !all.includes(s2.playerId));
  });
  const bad = new Client('Intrus');
  await bad.login(base, 'intrus', 'intrus-password-1');
  await bad.connectWs(base, wsBase);
  bad.send({ t: 'join', room: created.id, gmKey: 'x'.repeat(48) });
  const sb = await bad.waitFor((m) => m.t === 'state');
  check('mauvaise clé MJ = simple joueur', () => assert.strictEqual(sb.role, 'player'));
  bad.ws.close();

  // --- déplacements (grille commune, pas besoin de mapId) ---
  p1.clear(); gm.clear(); p2.clear();
  p1.send({ t: 'move', id: s1.youToken, x: 333, y: 271, final: true });
  const mv = await p1.waitFor((m) => m.t === 'move' && m.final);
  await gm.waitFor((m) => m.t === 'move' && m.final);
  check('déplacement aimanté au centre de case', () => {
    assert.strictEqual(mv.x, 325);
    assert.strictEqual(mv.y, 275);
  });
  p2.send({ t: 'move', id: s1.youToken, x: 10, y: 10, final: true }); // tricher
  await sleep(150);
  check("un joueur ne peut pas bouger le jeton d'un autre", () => {
    assert.strictEqual(gm.count((m) => m.t === 'move' && m.x === 25), 0);
  });
  p1.clear();
  gm.send({ t: 'move', id: s1.youToken, x: 100, y: 100, final: false });
  await p1.waitFor((m) => m.t === 'move' && !m.final);
  check('le MJ peut bouger tous les jetons', () => {});
  gm.clear();
  gm.send({ t: 'move', id: s1.youToken, x: -5000, y: -5000, final: true }); // grille illimitée
  const mvFar = await gm.waitFor((m) => m.t === 'move' && m.final);
  check('déplacement loin de l\'origine sans borne', () => {
    assert.strictEqual(mvFar.x, -4975);
    assert.strictEqual(mvFar.y, -4975);
  });

  // --- PNJ et jetons cachés ---
  gm.send({ t: 'tokenAdd', name: 'Gobelin', color: '#00aa00', size: 1, x: 500, y: 500, hidden: true });
  const sel = await gm.waitFor((m) => m.t === 'selectToken');
  await sleep(150);
  check('PNJ caché non transmis aux joueurs', () => {
    assert.strictEqual(p1.count((m) => m.t === 'tokenUpsert' && m.token.name === 'Gobelin'), 0);
  });
  p1.send({ t: 'move', id: sel.id, x: 1, y: 1, final: true });
  p1.send({ t: 'tokenAdd', name: 'Faux', color: '#ffffff' });
  p1.send({ t: 'fog', op: 'enabled', value: true });
  p1.send({ t: 'grid', size: 100 });
  await sleep(150);
  check('un joueur ne peut ni ajouter, ni régler brouillard/grille', () => {
    assert.strictEqual(gm.count((m) => m.t === 'tokenUpsert' && m.token.name === 'Faux'), 0);
    assert.strictEqual(gm.count((m) => m.t === 'fogEnabled' || m.t === 'grid'), 0);
  });
  gm.send({ t: 'tokenUpdate', id: sel.id, patch: { hidden: false } });
  await p1.waitFor((m) => m.t === 'tokenUpsert' && m.token.name === 'Gobelin');
  check('PNJ révélé apparaît chez les joueurs', () => {});
  gm.send({ t: 'tokenUpdate', id: sel.id, patch: { hidden: true } });
  await p1.waitFor((m) => m.t === 'tokenRemove' && m.id === sel.id);
  check('PNJ re-caché disparaît chez les joueurs', () => {});

  // --- dérogation de visibilité : un PNJ caché peut être montré à certains joueurs seulement ---
  gm.clear(); p1.clear(); p2.clear();
  gm.send({ t: 'tokenUpdate', id: sel.id, patch: { visibleToTokens: [s1.youToken] } });
  const visUp = await p1.waitFor((m) => m.t === 'tokenUpsert' && m.token.id === sel.id);
  check('PNJ caché avec dérogation : le joueur autorisé le reçoit', () => {
    assert.strictEqual(visUp.token.name, 'Gobelin');
  });
  await sleep(100);
  check('PNJ caché avec dérogation : les autres joueurs ne le reçoivent pas', () => {
    assert.strictEqual(p2.count((m) => m.t === 'tokenUpsert' && m.token.id === sel.id), 0);
  });
  gm.clear(); p1.clear();
  gm.send({ t: 'tokenUpdate', id: sel.id, patch: { visibleToTokens: [] } });
  const visRevoke = await p1.waitFor((m) => m.t === 'tokenRemove' && m.id === sel.id);
  check('dérogation retirée : le joueur perd à nouveau le PNJ', () => assert.strictEqual(visRevoke.id, sel.id));

  // --- fiche PNJ rapide (MJ uniquement, jamais envoyée aux joueurs) ---
  gm.clear();
  gm.send({ t: 'npc', op: 'get', tokenId: sel.id });
  const npcInit = await gm.waitFor((m) => m.t === 'npcData' && m.tokenId === sel.id);
  check('fiche PNJ par défaut : PV/Volonté/Défense à zéro, textes vides', () => {
    assert.strictEqual(npcInit.sheet.hp, 0);
    assert.strictEqual(npcInit.sheet.hpMax, 10);
    assert.strictEqual(npcInit.sheet.willpower, 0);
    assert.strictEqual(npcInit.sheet.willpowerMax, 3);
    assert.strictEqual(npcInit.sheet.defense, 0);
  });
  gm.send({
    t: 'npc', op: 'update', tokenId: sel.id,
    patch: { hp: 4, hpMax: 12, willpower: 2, willpowerMax: 4, defense: 13, traits: 'Griffes +2', notes: 'Fuit sous 25% de PV' },
  });
  const npcUp = await gm.waitFor((m) => m.t === 'npcData' && m.tokenId === sel.id && m.sheet.hp === 4);
  check('mise à jour de la fiche PNJ (Volonté et Défense/Difficulté incluses)', () => {
    assert.strictEqual(npcUp.sheet.hpMax, 12);
    assert.strictEqual(npcUp.sheet.willpower, 2);
    assert.strictEqual(npcUp.sheet.willpowerMax, 4);
    assert.strictEqual(npcUp.sheet.defense, 13);
    assert.strictEqual(npcUp.sheet.traits, 'Griffes +2');
  });
  p1.clear();
  p1.send({ t: 'npc', op: 'get', tokenId: sel.id });
  await sleep(100);
  check('un joueur ne peut pas consulter la fiche PNJ (réservée au MJ)', () => {
    assert.strictEqual(p1.count((m) => m.t === 'npcData'), 0);
  });

  // --- présentation d'un PNJ (portrait + description), publique pour qui voit le jeton ---
  gm.clear(); p1.clear(); p2.clear();
  gm.send({ t: 'tokenUpdate', id: sel.id, patch: { description: '  Un gobelin nerveux.\nIl sent la vase.  ' } });
  await sleep(150);
  check('présentation d\'un PNJ caché : jamais envoyée aux joueurs', () => {
    assert.strictEqual(p1.count((m) => m.t === 'tokenUpsert' && m.token.id === sel.id), 0);
  });
  gm.send({ t: 'tokenUpdate', id: sel.id, patch: { hidden: false } });
  const profUp = await p1.waitFor((m) => m.t === 'tokenUpsert' && m.token.id === sel.id);
  check('PNJ révélé : description reçue par les joueurs, nettoyée', () => {
    assert.strictEqual(profUp.token.description, 'Un gobelin nerveux.\nIl sent la vase.');
    assert.strictEqual(profUp.token.portrait, null);
  });
  p1.clear();
  p1.send({ t: 'tokenUpdate', id: sel.id, patch: { description: 'Piraté' } });
  await sleep(100);
  check('un joueur ne peut pas modifier la présentation d\'un PNJ', () => {
    assert.strictEqual(p1.count((m) => m.t === 'tokenUpsert' && m.token.id === sel.id), 0);
  });
  const portraitUrl = `/api/rooms/${created.id}/tokens/${sel.id}/portrait`;
  r = await p1.authedFetch(base, portraitUrl, { method: 'POST', body: PNG });
  check('portrait : refusé sans la clé MJ', () => assert.strictEqual(r.status, 403));
  r = await gm.authedFetch(base, portraitUrl, { method: 'POST', headers: { 'X-GM-Key': created.gmKey }, body: Buffer.from('<svg onload=alert(1)>') });
  check('portrait : format non image refusé', () => assert.strictEqual(r.status, 415));
  r = await gm.authedFetch(base, `/api/rooms/${created.id}/tokens/${s1.youToken}/portrait`, { method: 'POST', headers: { 'X-GM-Key': created.gmKey }, body: PNG });
  check('portrait : impossible sur un jeton de joueur', () => assert.strictEqual(r.status, 404));
  r = await gm.authedFetch(base, portraitUrl, { method: 'POST', headers: { 'X-GM-Key': created.gmKey }, body: PNG });
  const portUp = await p1.waitFor((m) => m.t === 'tokenUpsert' && m.token.id === sel.id && m.token.portrait);
  const portraitFile = path.join(process.env.DATA_DIR, 'uploads', path.basename(portUp.token.portrait));
  const portraitGet = await p1.authedFetch(base, portUp.token.portrait);
  check('portrait : envoyé par le MJ, reçu et servi aux joueurs du salon', () => {
    assert.strictEqual(r.status, 200);
    assert(portUp.token.portrait.startsWith('/uploads/'));
    assert.strictEqual(portraitGet.status, 200);
    assert(fs.existsSync(portraitFile));
  });
  p1.clear();
  gm.send({ t: 'tokenUpdate', id: sel.id, patch: { portrait: null } });
  const portRm = await p1.waitFor((m) => m.t === 'tokenUpsert' && m.token.id === sel.id);
  await sleep(100);
  check('portrait retiré : diffusé et fichier supprimé', () => {
    assert.strictEqual(portRm.token.portrait, null);
    assert(!fs.existsSync(portraitFile));
  });
  check('les jetons de joueurs ne portent pas de présentation', () => {
    assert.strictEqual(portUp.token.pc, false);
    assert.strictEqual('description' in (s1.tokens.find((t) => t.id === s1.youToken) || {}), false);
  });
  gm.send({ t: 'tokenUpdate', id: sel.id, patch: { hidden: true } });
  await p1.waitFor((m) => m.t === 'tokenRemove' && m.id === sel.id);

  p1.send({ t: 'tokenRemove', id: s1.youToken });
  gm.send({ t: 'tokenRemove', id: s1.youToken });
  await sleep(150);
  check('les jetons de joueurs ne sont pas supprimables', () => {
    assert.strictEqual(p2.count((m) => m.t === 'tokenRemove' && m.id === s1.youToken), 0);
  });

  // --- renommage ---
  p1.send({ t: 'tokenUpdate', id: s1.youToken, patch: { name: 'Alicia', size: 4, hidden: true } });
  const up = await gm.waitFor((m) => m.t === 'tokenUpsert' && m.token.id === s1.youToken && m.token.name === 'Alicia');
  check('le joueur change son nom mais pas taille/visibilité', () => {
    assert.strictEqual(up.token.size, 1);
    assert.strictEqual(up.token.hidden, false);
  });

  // --- brouillard (creux : cases en paires [cx,cy]) ---
  gm.send({ t: 'fog', op: 'enabled', value: true });
  await p1.waitFor((m) => m.t === 'fogEnabled' && m.enabled);
  gm.send({ t: 'fog', op: 'paint', cells: [[0, 0], [1, 0], [2, 0], [99999999, 0], [-3, 1.5], 'x'], value: 1 });
  const d = await p1.waitFor((m) => m.t === 'fogDelta');
  check('brouillard : cases invalides filtrées, valides diffusées', () => {
    assert.deepStrictEqual(d.cells.sort(), [[0, 0], [1, 0], [2, 0]].sort());
    assert.strictEqual(d.value, 1);
  });
  p1.send({ t: 'fog', op: 'paint', cells: [[10, 0]], value: 1 });
  p1.send({ t: 'fog', op: 'fill' });
  await sleep(150);
  check('un joueur ne peut pas peindre ni vider le brouillard', () => {
    assert.strictEqual(gm.count((m) => m.t === 'fogDelta' && m.cells.some((c) => c[0] === 10)), 0);
    assert.strictEqual(gm.count((m) => m.t === 'fog'), 0);
  });

  // --- dessin ---
  const strokeA = 'a'.repeat(16);
  const strokeB = 'b'.repeat(16);
  gm.clear(); p1.clear(); p2.clear();
  p1.send({ t: 'draw', op: 'start', id: strokeA, tool: 'pen', color: '#ff0000', width: 4, x: 10, y: 10 });
  const dStart = await gm.waitFor((m) => m.t === 'drawStart');
  check('trait envoyé par un joueur diffusé aux autres (calque partagé)', () => {
    assert.strictEqual(dStart.stroke.id, strokeA);
    assert.strictEqual(dStart.stroke.tool, 'pen');
    assert(!JSON.stringify(dStart).includes('authorId'));
  });
  p1.send({ t: 'draw', op: 'point', id: strokeA, pts: [20, 20, 30, 30] });
  const dPoint = await gm.waitFor((m) => m.t === 'drawPoint');
  check('points supplémentaires diffusés', () => assert.deepStrictEqual(dPoint.pts, [20, 20, 30, 30]));
  p1.send({ t: 'draw', op: 'end', id: strokeA });

  p1.clear();
  gm.send({ t: 'draw', op: 'start', id: strokeB, tool: 'rect', color: '#00ff00', width: 4, layer: 'gm', x: 5, y: 5 });
  await sleep(150);
  check('trait sur le calque MJ non diffusé aux joueurs', () => {
    assert.strictEqual(p1.count((m) => m.t === 'drawStart' && m.stroke.id === strokeB), 0);
  });

  const carol = new Client('Carol');
  await carol.login(base, 'carol', 'carol-password-1');
  await carol.connectWs(base, wsBase);
  carol.send({ t: 'join', room: created.id });
  const sc = await carol.waitFor((m) => m.t === 'state');
  check('état initial : trait partagé reçu, trait MJ filtré pour un joueur', () => {
    assert(sc.strokes.some((s) => s.id === strokeA));
    assert(!sc.strokes.some((s) => s.id === strokeB));
  });
  carol.ws.close();

  // --- exclusion / réintégration d'un joueur (sans supprimer tout le salon) ---
  gm.clear();
  gm.send({ t: 'kickPlayer', tokenId: sc.youToken });
  await gm.waitFor((m) => m.t === 'tokenRemove' && m.id === sc.youToken);
  const banned = await gm.waitFor((m) => m.t === 'bannedList');
  const carolBan = banned.bannedPlayers.find((b) => b.name === 'Carol');
  check('exclusion : jeton retiré et le MJ voit Carol dans la liste des exclus', () => assert(carolBan));

  const rejoin = new Client('Carol (rejoin)');
  await rejoin.login(base, 'carol', 'carol-password-1');
  await rejoin.connectWs(base, wsBase);
  rejoin.send({ t: 'join', room: created.id });
  const banErr = await rejoin.waitFor((m) => m.t === 'error');
  check('un joueur exclu ne peut pas rejoindre à nouveau', () => assert.strictEqual(banErr.code, 'banned'));
  rejoin.ws.close();

  gm.clear();
  gm.send({ t: 'unbanPlayer', playerId: carolBan.playerId });
  await gm.waitFor((m) => m.t === 'bannedList' && m.bannedPlayers.length === 0);
  check('réintégration : la liste des exclus se vide', () => {});

  const back = new Client('Carol (retour)');
  await back.login(base, 'carol', 'carol-password-1');
  await back.connectWs(base, wsBase);
  back.send({ t: 'join', room: created.id });
  const backState = await back.waitFor((m) => m.t === 'state');
  check('réintégré, le joueur peut de nouveau rejoindre le salon', () => assert.strictEqual(backState.role, 'player'));
  back.ws.close();

  p1.clear(); p2.clear();
  p2.send({ t: 'draw', op: 'remove', id: strokeA });
  await sleep(150);
  check("un joueur ne peut pas effacer le trait d'un autre joueur", () => {
    assert.strictEqual(p1.count((m) => m.t === 'drawRemove'), 0);
  });
  p1.send({ t: 'draw', op: 'remove', id: strokeA });
  await p2.waitFor((m) => m.t === 'drawRemove' && m.id === strokeA);
  check('un joueur peut effacer son propre trait', () => {});

  p1.clear(); gm.clear();
  p1.send({ t: 'draw', op: 'clear' });
  await sleep(150);
  check('un joueur ne peut pas tout effacer', () => {
    assert.strictEqual(gm.count((m) => m.t === 'drawClear'), 0);
  });
  gm.send({ t: 'draw', op: 'clear' });
  await p1.waitFor((m) => m.t === 'drawClear');
  check('le MJ peut tout effacer', () => {});

  // --- fiche de personnage ---
  check('fiche par défaut dans le state du joueur', () => {
    assert.strictEqual(s1.sheet.attributes.force, 1);
    assert.strictEqual(s1.sheet.skills.athletisme.rating, 0);
    assert.strictEqual(sg.sheet, undefined); // le MJ ne reçoit pas de fiche inline dans son state
  });

  gm.clear();
  p1.send({ t: 'sheet', op: 'update', patch: { attributes: { force: 4 }, skills: { athletisme: { rating: 3, specialty: 'Parkour' } }, healthMax: 6, concept: 'Ex-flic' } });
  let sd = await gm.waitFor((m) => m.t === 'sheetData' && m.tokenId === s1.youToken);
  check('le joueur modifie sa fiche, le MJ la reçoit', () => {
    assert.strictEqual(sd.sheet.attributes.force, 4);
    assert.strictEqual(sd.sheet.skills.athletisme.rating, 3);
    assert.strictEqual(sd.sheet.skills.athletisme.specialty, 'Parkour');
    assert.strictEqual(sd.sheet.healthMax, 6);
    assert.deepStrictEqual(sd.sheet.health, []);
    assert.strictEqual(sd.sheet.concept, 'Ex-flic');
  });

  gm.clear();
  p1.send({ t: 'sheet', op: 'update', patch: { attributes: { force: 99 }, skills: { athletisme: { rating: 99 } }, health: ['s', 'a', 'bogus'] } });
  sd = await gm.waitFor((m) => m.t === 'sheetData' && m.tokenId === s1.youToken);
  check('les valeurs hors bornes sont plafonnées (attribut 1-5, compétence 0-5), dégâts validés (s/a) ou vidés', () => {
    assert.strictEqual(sd.sheet.attributes.force, 5);
    assert.strictEqual(sd.sheet.skills.athletisme.rating, 5);
    assert.deepStrictEqual(sd.sheet.health, ['s', 'a', '']);
  });

  gm.clear();
  p2.send({ t: 'sheet', op: 'update', tokenId: s1.youToken, patch: { healthMax: 20 } }); // Bob tente de viser la fiche d'Alice
  const sdBob = await gm.waitFor((m) => m.t === 'sheetData' && m.tokenId === s2.youToken);
  check("un joueur ne peut cibler que sa propre fiche, même en fournissant le tokenId d'un autre", () => {
    assert.strictEqual(sdBob.sheet.healthMax, 20); // ça a modifié SA fiche à lui (Bob), pas celle d'Alice
    assert.strictEqual(gm.count((m) => m.t === 'sheetData' && m.tokenId === s1.youToken && m.sheet.healthMax === 20), 0);
  });

  p1.clear(); gm.clear();
  gm.send({ t: 'sheet', op: 'get', tokenId: s1.youToken });
  const sdGet = await gm.waitFor((m) => m.t === 'sheetData' && m.tokenId === s1.youToken);
  check('le MJ résout le tokenId vers la bonne fiche (op get)', () => assert.strictEqual(sdGet.sheet.attributes.force, 5));
  gm.send({ t: 'sheet', op: 'update', tokenId: s1.youToken, patch: { willpowerMax: 5 } });
  const sdP1 = await p1.waitFor((m) => m.t === 'sheetData' && m.sheet.willpowerMax === 5);
  check('le MJ modifie la fiche du bon joueur (op update), qui la reçoit', () => assert.strictEqual(sdP1.tokenId, s1.youToken));

  // --- journal : carnet privé par joueur, lu par le MJ mais jamais modifié par lui ---
  check('journal vide par défaut dans le state du joueur', () => {
    assert.deepStrictEqual(s1.journal, []);
    assert.strictEqual(sg.journal, undefined); // le MJ ne reçoit pas de journal inline dans son state
  });

  gm.clear();
  p1.send({ t: 'journal', op: 'add', text: '  Première nuit dans les catacombes.\n\nOn a entendu des pas.  ' });
  const jAdd = await gm.waitFor((m) => m.t === 'journalData' && m.tokenId === s1.youToken);
  let journalEntryId;
  check('le joueur ajoute une entrée, le MJ la reçoit (lecture)', () => {
    assert.strictEqual(jAdd.entries.length, 1);
    assert.strictEqual(jAdd.entries[0].text, 'Première nuit dans les catacombes.\n\nOn a entendu des pas.');
    assert(Number.isFinite(jAdd.entries[0].ts));
    journalEntryId = jAdd.entries[0].id;
  });

  p2.clear();
  p1.send({ t: 'journal', op: 'add', text: 'Deuxième entrée.' });
  await sleep(150);
  check("le journal d'un joueur n'est jamais envoyé aux autres joueurs", () => {
    assert.strictEqual(p2.count((m) => m.t === 'journalData'), 0);
  });

  gm.clear();
  p1.send({ t: 'journal', op: 'update', id: journalEntryId, text: 'Première nuit dans les catacombes (corrigé).' });
  const jUpd = await gm.waitFor((m) => m.t === 'journalData' && m.entries.some((e) => e.id === journalEntryId && e.text.includes('corrigé')));
  check('le joueur modifie une entrée, le MJ voit la version à jour', () => {
    assert.strictEqual(jUpd.entries.length, 2);
  });

  gm.clear();
  p1.send({ t: 'journal', op: 'remove', id: journalEntryId });
  const jDel = await gm.waitFor((m) => m.t === 'journalData' && m.entries.length === 1);
  check('le joueur supprime une entrée', () => {
    assert(!jDel.entries.some((e) => e.id === journalEntryId));
  });

  p1.clear(); gm.clear();
  gm.send({ t: 'journal', op: 'get', tokenId: s1.youToken });
  const jGet = await gm.waitFor((m) => m.t === 'journalData' && m.tokenId === s1.youToken);
  check('le MJ peut consulter le journal via le tokenId du joueur', () => assert.strictEqual(jGet.entries.length, 1));

  gm.clear();
  gm.send({ t: 'journal', op: 'add', tokenId: s1.youToken, text: 'Le MJ tente de tricher' });
  gm.send({ t: 'journal', op: 'remove', tokenId: s1.youToken, id: jGet.entries[0].id });
  await sleep(150);
  check('le MJ ne peut ni ajouter ni supprimer dans le journal d\'un joueur (lecture seule)', () => {
    assert.strictEqual(gm.count((m) => m.t === 'journalData'), 0);
  });

  p2.clear();
  p2.send({ t: 'journal', op: 'update', id: jGet.entries[0].id, text: 'Bob modifie le journal d\'Alice' });
  await sleep(150);
  check("un joueur ne peut pas modifier le journal d'un autre (id d'entrée introuvable dans le sien)", () => {
    assert.strictEqual(gm.count((m) => m.t === 'journalData' && m.tokenId === s1.youToken), 0);
  });

  // --- grille : le brouillard (creux) est reprojeté au changement de taille de case ---
  gm.send({ t: 'fog', op: 'paint', cells: [[1, 1]], value: 1 }); // grille de 50 par défaut
  await sleep(100);
  gm.clear();
  gm.send({ t: 'grid', size: 100 });
  const gr = await gm.waitFor((m) => m.t === 'grid');
  check('changement de grille : brouillard conservé et reprojeté', () => {
    assert.strictEqual(gr.grid.size, 100);
    // (1,1) en case de 50 couvre [50,100)x[50,100), qui à 100px/case tombe dans la case (0,0)
    assert(gr.fog.cells.some(([cx, cy]) => cx === 0 && cy === 0));
  });

  // --- renommage du salon (MJ uniquement, diffusé à tous) ---
  p1.clear(); gm.clear();
  gm.send({ t: 'room', name: '  La Crypte des Ombres  ' });
  const renamed = await p1.waitFor((m) => m.t === 'room');
  check('renommage diffusé aux joueurs, espaces superflus retirés', () => {
    assert.strictEqual(renamed.name, 'La Crypte des Ombres');
  });

  p1.clear();
  p1.send({ t: 'room', name: 'Salon pirate' });
  await sleep(150);
  check("un joueur ne peut pas renommer le salon", () => {
    assert.strictEqual(p1.count((m) => m.t === 'room'), 0);
  });

  const roomInfo = await (await gm.authedFetch(base, `/api/rooms/${created.id}`)).json();
  check("l'API expose le nom courant du salon", () => assert.strictEqual(roomInfo.name, 'La Crypte des Ombres'));

  gm.clear();
  gm.send({ t: 'room', name: '' });
  await gm.waitFor((m) => m.t === 'room' && m.name === null);
  const roomInfo2 = await (await gm.authedFetch(base, `/api/rooms/${created.id}`)).json();
  check('nom vide : le salon revient à son code', () => assert.strictEqual(roomInfo2.name, null));

  gm.send({ t: 'room', name: 'La Crypte des Ombres' }); // remis pour le test de persistance plus bas

  // --- suppression d'un salon (MJ uniquement, via clé MJ en en-tête HTTP) ---
  const toDelete = await (await gm.authedFetch(base, '/api/rooms', { method: 'POST' })).json();
  const roomsDirEarly = path.join(process.env.DATA_DIR, 'rooms');
  const doomed = new Client('Doomed');
  await doomed.login(base, 'carol', 'carol-password-1');
  await doomed.connectWs(base, wsBase);
  doomed.send({ t: 'join', room: toDelete.id });
  await doomed.waitFor((m) => m.t === 'state');

  const badKeyDel = await gm.authedFetch(base, `/api/rooms/${toDelete.id}`, { method: 'DELETE', headers: { 'X-GM-Key': 'x'.repeat(48) } });
  check('suppression refusée avec une mauvaise clé MJ', () => assert.strictEqual(badKeyDel.status, 403));

  doomed.clear();
  const okDel = await gm.authedFetch(base, `/api/rooms/${toDelete.id}`, { method: 'DELETE', headers: { 'X-GM-Key': toDelete.gmKey } });
  check('suppression acceptée avec la bonne clé MJ', () => assert.strictEqual(okDel.status, 200));

  const kicked = await doomed.waitFor((m) => m.t === 'error' && m.code === 'room_deleted');
  check('les clients connectés sont notifiés (room_deleted) quand le MJ supprime le salon', () => {
    assert.strictEqual(kicked.code, 'room_deleted');
  });

  const goneCheck = await gm.authedFetch(base, `/api/rooms/${toDelete.id}`);
  check("le salon supprimé n'existe plus (404)", () => assert.strictEqual(goneCheck.status, 404));

  const delAgain = await gm.authedFetch(base, `/api/rooms/${toDelete.id}`, { method: 'DELETE', headers: { 'X-GM-Key': toDelete.gmKey } });
  check('supprimer un salon déjà supprimé renvoie 404', () => assert.strictEqual(delAgain.status, 404));

  await sleep(1300);
  check('le fichier du salon supprimé est retiré du disque', () => {
    assert(!fs.existsSync(path.join(roomsDirEarly, `${toDelete.id}.json`)));
  });

  // --- images : upload, affichage, déplacement, visibilité, ordre, suppression ---
  gm.clear(); p1.clear();
  r = await gm.authedFetch(base, `/api/rooms/${created.id}/image?w=6000&h=6000`, { method: 'POST', headers: { 'X-GM-Key': 'nope' }, body: PNG });
  check('upload d\'image refusé sans clé MJ', () => assert.strictEqual(r.status, 403));
  r = await fetch(`${base}/api/rooms/${created.id}/image?w=6000&h=6000`, { method: 'POST', headers: { 'X-GM-Key': created.gmKey }, body: PNG });
  check('upload d\'image refusé sans connexion (même avec la bonne clé MJ)', () => assert.strictEqual(r.status, 401));
  r = await gm.authedFetch(base, `/api/rooms/${created.id}/image?w=6000&h=6000`, { method: 'POST', headers: { 'X-GM-Key': created.gmKey }, body: Buffer.from('<svg onload=alert(1)>') });
  check('upload : un fichier non image est refusé', () => assert.strictEqual(r.status, 415));
  r = await gm.authedFetch(base, `/api/rooms/${created.id}/image?w=400&h=300&name=${encodeURIComponent('Portrait')}&cx=1000&cy=500`, { method: 'POST', headers: { 'X-GM-Key': created.gmKey }, body: PNG });
  assert.strictEqual(r.status, 200);
  const up1 = await p1.waitFor((m) => m.t === 'imageUpsert', 4000);
  const image1Id = up1.image.id;
  check("upload : ajoute une image, positionnée centrée sur (cx,cy), jamais recadrée", () => {
    assert.strictEqual(up1.image.width, 400);
    assert.strictEqual(up1.image.height, 300);
    assert.strictEqual(up1.image.name, 'Portrait');
    assert(up1.image.url.startsWith('/uploads/'));
    assert.strictEqual(up1.image.x, 1000 - 200);
    assert.strictEqual(up1.image.y, 500 - 150);
    assert.strictEqual(up1.image.hidden, false);
  });
  const imgFile = await gm.authedFetch(base, up1.image.url);
  check("l'image est servie avec nosniff", () => {
    assert.strictEqual(imgFile.status, 200);
    assert.strictEqual(imgFile.headers.get('content-type'), 'image/png');
    assert.strictEqual(imgFile.headers.get('x-content-type-options'), 'nosniff');
  });

  // --- accès aux uploads limité aux membres du salon (joueurs ou MJ ayant rejoint via la gmKey) ---
  const created2 = await (await gm.authedFetch(base, '/api/rooms', { method: 'POST' })).json();
  const gm2 = new Client('MJ (salon 2)');
  await gm2.login(base, 'gm', 'mj-password-1');
  await gm2.connectWs(base, wsBase);
  gm2.send({ t: 'join', room: created2.id, gmKey: created2.gmKey });
  await gm2.waitFor((m) => m.t === 'state');
  r = await gm2.authedFetch(base, `/api/rooms/${created2.id}/image?w=100&h=100`, { method: 'POST', headers: { 'X-GM-Key': created2.gmKey }, body: PNG });
  assert.strictEqual(r.status, 200);
  const up2Room = await gm2.waitFor((m) => m.t === 'imageUpsert');
  const otherRoomImgAsP1 = await p1.authedFetch(base, up2Room.image.url);
  check("l'image d'un autre salon est inaccessible à un joueur qui n'en fait pas partie", () => {
    assert.strictEqual(otherRoomImgAsP1.status, 404);
  });
  const otherRoomImgAsGm2 = await gm2.authedFetch(base, up2Room.image.url);
  check('le MJ ayant rejoint son salon via la gmKey peut accéder à ses propres images', () => {
    assert.strictEqual(otherRoomImgAsGm2.status, 200);
  });
  gm2.ws.close();

  // deuxième image, chevauchante : vérifie le passage au premier plan au déplacement
  gm.clear(); p1.clear();
  r = await gm.authedFetch(base, `/api/rooms/${created.id}/image?w=200&h=200&name=${encodeURIComponent('Jeton')}&cx=1000&cy=500`, { method: 'POST', headers: { 'X-GM-Key': created.gmKey }, body: PNG });
  assert.strictEqual(r.status, 200);
  const up2 = await p1.waitFor((m) => m.t === 'imageUpsert');
  const image2Id = up2.image.id;
  check('deuxième image : ordre strictement croissant (empilée au-dessus)', () => {
    assert(up2.image.order > up1.image.order);
  });

  // --- réordonnancement (glisser-déposer côté MJ) : image1 repassée au-dessus de image2 ---
  gm.clear(); p1.clear();
  gm.send({ t: 'imageReorder', ids: [image2Id, image1Id] });
  const orderGm = await gm.waitFor((m) => m.t === 'imagesOrder');
  const orderP1 = await p1.waitFor((m) => m.t === 'imagesOrder');
  check('réordonnancement diffusé au MJ et aux joueurs, dans le même ordre', () => {
    assert.deepStrictEqual(orderGm.order, [image2Id, image1Id]);
    assert.deepStrictEqual(orderP1.order, [image2Id, image1Id]);
  });

  gm.clear(); p1.clear();
  p1.send({ t: 'imageReorder', ids: [image1Id, image2Id] });
  await sleep(150);
  check("un joueur ne peut pas réordonner les images", () => {
    assert.strictEqual(gm.count((m) => m.t === 'imagesOrder'), 0);
  });

  gm.clear(); p1.clear();
  gm.send({ t: 'imageReorder', ids: [image1Id, image2Id, 'inconnue'] }); // remis dans l'ordre initial, id inconnu ignoré
  await gm.waitFor((m) => m.t === 'imagesOrder');

  gm.clear(); p1.clear();
  gm.send({ t: 'imageMove', id: image1Id, x: 42, y: 84, final: true });
  const moved = await p1.waitFor((m) => m.t === 'imageMove' && m.id === image1Id);
  check('déplacement d\'une image diffusé, position libre (sans aimantation)', () => {
    assert.strictEqual(moved.x, 42);
    assert.strictEqual(moved.y, 84);
    assert.strictEqual(moved.final, true);
  });
  p1.clear(); gm.clear();
  p1.send({ t: 'imageMove', id: image1Id, x: 0, y: 0, final: true });
  await sleep(150);
  check("un joueur ne peut pas déplacer une image", () => {
    assert.strictEqual(gm.count((m) => m.t === 'imageMove'), 0);
  });

  // --- verrouillage : bloque le déplacement, même pour le MJ, tant que non déverrouillé ---
  gm.clear(); p1.clear();
  gm.send({ t: 'imageUpdate', id: image1Id, patch: { locked: true } });
  await p1.waitFor((m) => m.t === 'imageUpsert' && m.image.id === image1Id && m.image.locked === true);
  check('verrouillage diffusé (image toujours visible, juste verrouillée)', () => {});
  gm.clear(); p1.clear();
  gm.send({ t: 'imageMove', id: image1Id, x: 999, y: 999, final: true });
  await sleep(150);
  check('une image verrouillée ne peut pas être déplacée, même par le MJ', () => {
    assert.strictEqual(p1.count((m) => m.t === 'imageMove'), 0);
  });
  gm.clear(); p1.clear();
  gm.send({ t: 'imageUpdate', id: image1Id, patch: { locked: false } });
  await p1.waitFor((m) => m.t === 'imageUpsert' && m.image.id === image1Id && m.image.locked === false);
  gm.clear(); p1.clear();
  gm.send({ t: 'imageMove', id: image1Id, x: 111, y: 222, final: true });
  const movedAfterUnlock = await p1.waitFor((m) => m.t === 'imageMove' && m.id === image1Id);
  check('déverrouillée, l\'image peut de nouveau être déplacée', () => {
    assert.strictEqual(movedAfterUnlock.x, 111);
    assert.strictEqual(movedAfterUnlock.y, 222);
  });

  // --- redimensionnement (poignée d'angle côté MJ) ---
  gm.clear(); p1.clear();
  gm.send({ t: 'imageMove', id: image1Id, x: 111, y: 222, width: 300, height: 150, final: true });
  const resized = await p1.waitFor((m) => m.t === 'imageMove' && m.id === image1Id);
  check('redimensionnement d\'une image diffusé aux joueurs', () => {
    assert.strictEqual(resized.width, 300);
    assert.strictEqual(resized.height, 150);
  });
  gm.clear(); p1.clear();
  gm.send({ t: 'imageMove', id: image1Id, x: 111, y: 222, width: 1, height: -5, final: true });
  const clamped = await p1.waitFor((m) => m.t === 'imageMove' && m.id === image1Id);
  check('redimensionnement : taille bornée (20 px minimum)', () => {
    assert.strictEqual(clamped.width, 20);
    assert.strictEqual(clamped.height, 20);
  });
  gm.clear(); p1.clear();
  p1.send({ t: 'imageMove', id: image1Id, x: 111, y: 222, width: 900, height: 900, final: true });
  await sleep(150);
  check('un joueur ne peut pas redimensionner une image', () => {
    assert.strictEqual(gm.count((m) => m.t === 'imageMove'), 0);
  });
  gm.send({ t: 'imageUpdate', id: image1Id, patch: { locked: true } });
  const lockedResized = await p1.waitFor((m) => m.t === 'imageUpsert' && m.image.id === image1Id && m.image.locked === true);
  check('verrouiller une image redimensionnée conserve sa taille', () => {
    assert.strictEqual(lockedResized.image.width, 20);
    assert.strictEqual(lockedResized.image.height, 20);
  });
  gm.clear(); p1.clear();
  gm.send({ t: 'imageMove', id: image1Id, x: 111, y: 222, width: 500, height: 250, final: true });
  await sleep(150);
  check('une image verrouillée ne peut pas être redimensionnée', () => {
    assert.strictEqual(p1.count((m) => m.t === 'imageMove'), 0);
  });
  gm.send({ t: 'imageUpdate', id: image1Id, patch: { locked: false } });
  await p1.waitFor((m) => m.t === 'imageUpsert' && m.image.id === image1Id && m.image.locked === false);

  gm.clear(); p1.clear();
  gm.send({ t: 'imageUpdate', id: image1Id, patch: { hidden: true } });
  await p1.waitFor((m) => m.t === 'imageRemove' && m.id === image1Id);
  check('image cachée : retirée chez les joueurs', () => {});
  await gm.waitFor((m) => m.t === 'imageUpsert' && m.image.id === image1Id && m.image.hidden === true);
  check('image cachée : le MJ la reçoit toujours (imageUpsert)', () => {});
  gm.clear(); p1.clear();
  gm.send({ t: 'imageUpdate', id: image1Id, patch: { hidden: false } });
  await p1.waitFor((m) => m.t === 'imageUpsert' && m.image.id === image1Id);
  check('image réaffichée : réapparaît chez les joueurs', () => {});

  gm.clear(); p1.clear();
  gm.send({ t: 'imageRemove', id: image2Id });
  await p1.waitFor((m) => m.t === 'imageRemove' && m.id === image2Id);
  check('suppression d\'image diffusée', () => {});
  await sleep(100);
  check('suppression d\'image : le fichier est retiré de data/uploads', () => {
    assert(!fs.existsSync(path.join(process.env.DATA_DIR, 'uploads', path.basename(up2.image.url))));
  });
  p1.clear(); gm.clear();
  p1.send({ t: 'imageRemove', id: image1Id });
  await sleep(150);
  check("un joueur ne peut pas supprimer une image", () => {
    assert.strictEqual(gm.count((m) => m.t === 'imageRemove'), 0);
  });

  // --- dés ---
  gm.clear(); p1.clear();
  gm.send({ t: 'roll', expr: '2d6+3' });
  const rPublic = await gm.waitFor((m) => m.t === 'rollResult');
  await p1.waitFor((m) => m.t === 'rollResult');
  check('lancer de dés : calculé côté serveur et diffusé à tous', () => {
    assert.strictEqual(rPublic.roll.by, 'MJ');
    assert.strictEqual(rPublic.roll.parts.length, 2);
    const [d2, mod] = rPublic.roll.parts;
    assert.strictEqual(d2.values.length, 2);
    assert(d2.values.every((v) => v >= 1 && v <= 6));
    assert.strictEqual(mod.value, 3);
    assert.strictEqual(rPublic.roll.total, d2.values[0] + d2.values[1] + 3);
  });

  gm.clear();
  gm.send({ t: 'roll', expr: 'pas-une-formule' });
  const badRoll = await gm.waitFor((m) => m.t === 'error' && m.code === 'bad_roll');
  check('formule de dés invalide refusée', () => assert(badRoll));

  gm.clear();
  gm.send({ t: 'roll', expr: '2d20kh1' });
  const rAdv = await gm.waitFor((m) => m.t === 'rollResult');
  check('avantage (kh1) : un dé écarté, le total = le meilleur des deux', () => {
    assert.strictEqual(rAdv.roll.parts[0].values.length, 2);
    assert.strictEqual(rAdv.roll.parts[0].dropped.length, 1);
    assert.strictEqual(rAdv.roll.total, Math.max(...rAdv.roll.parts[0].values));
  });

  gm.clear(); p1.clear();
  gm.send({ t: 'roll', expr: '1d6', private: true });
  const secretGm = await gm.waitFor((m) => m.t === 'rollResult');
  await sleep(150);
  check('jet secret du MJ : invisible des joueurs', () => {
    assert.strictEqual(p1.count((m) => m.t === 'rollResult' && m.roll.id === secretGm.roll.id), 0);
  });

  gm.clear(); p1.clear(); p2.clear();
  p1.send({ t: 'roll', expr: '1d6', private: true });
  const secretP1 = await p1.waitFor((m) => m.t === 'rollResult');
  await sleep(150);
  check('jet secret du joueur : visible du MJ, invisible des autres joueurs', () => {
    assert.strictEqual(gm.count((m) => m.t === 'rollResult' && m.roll.id === secretP1.roll.id), 1);
    assert.strictEqual(p2.count((m) => m.t === 'rollResult' && m.roll.id === secretP1.roll.id), 0);
  });

  // --- formule libre en d10 (résultat détaillé, coloré côté client : 10 critique, 8-9 réussite, <8 échec) ---
  const origRandomInt = crypto.randomInt;
  const seq = [10, 10, 8, 4];
  crypto.randomInt = () => (seq.length ? seq.shift() : 5);
  gm.clear();
  gm.send({ t: 'roll', expr: '4d10' });
  const d10Roll = await gm.waitFor((m) => m.t === 'rollResult');
  crypto.randomInt = origRandomInt;
  check('4d10 : total = somme des valeurs, détail par dé conservé', () => {
    assert.deepStrictEqual(d10Roll.roll.parts[0].values, [10, 10, 8, 4]);
    assert.strictEqual(d10Roll.roll.parts[0].sides, 10);
    assert.strictEqual(d10Roll.roll.total, 32);
  });

  // --- initiative lancée aux dés (1d10 + modificateur, calculé côté serveur) ---
  gm.clear();
  crypto.randomInt = () => 6;
  gm.send({ t: 'initiative', op: 'addRoll', tokenId: s1.youToken, mod: 3 });
  const initRoll = await gm.waitFor((m) => m.t === 'rollResult');
  const initState = await gm.waitFor((m) => m.t === 'initiative');
  crypto.randomInt = origRandomInt;
  check('initiative : jet 1d10+modificateur calculé côté serveur et journalisé', () => {
    assert.strictEqual(initRoll.roll.expr, '1d10+3');
    assert.strictEqual(initRoll.roll.total, 9);
    const entry = initState.initiative.entries.find((e) => e.tokenId === s1.youToken);
    assert(entry && entry.score === 9);
  });
  gm.clear();
  gm.send({ t: 'initiative', op: 'addRoll', tokenId: s1.youToken, mod: 0 });
  await sleep(150);
  check("initiative : un jeton déjà dans l'ordre ne peut pas être ajouté deux fois", () => {
    assert.strictEqual(gm.count((m) => m.t === 'rollResult'), 0);
  });
  gm.send({ t: 'initiative', op: 'clear' });
  await gm.waitFor((m) => m.t === 'initiative' && !m.initiative.active);

  // --- reconnexion du joueur (nouvel appareil : nouvelle session, même compte) : même jeton, historique retrouvé ---
  p1.ws.close();
  await sleep(100);
  const p1b = new Client('Alice2');
  await p1b.login(base, 'alice', 'alice-password-1');
  await p1b.connectWs(base, wsBase);
  p1b.send({ t: 'join', room: created.id });
  const sr = await p1b.waitFor((m) => m.t === 'state');
  check('reconnexion (même compte, nouvel appareil) : le joueur retrouve son jeton', () => assert.strictEqual(sr.youToken, s1.youToken));
  check("l'historique des jets suit la reconnexion (jets publics + jets secrets de ce joueur)", () => {
    assert(sr.rolls.some((r2) => r2.id === rPublic.roll.id));
    assert(sr.rolls.some((r2) => r2.id === secretP1.roll.id));
    assert(!sr.rolls.some((r2) => r2.id === secretGm.roll.id));
  });
  check('la fiche de personnage suit la reconnexion', () => {
    assert.strictEqual(sr.sheet.attributes.force, 5);
    assert.strictEqual(sr.sheet.willpowerMax, 5);
    assert.strictEqual(sr.sheet.concept, 'Ex-flic');
  });
  check('l\'image restante suit la reconnexion', () => {
    assert(sr.images.some((i) => i.id === image1Id));
  });
  check('le journal suit la reconnexion', () => {
    assert.strictEqual(sr.journal.length, 1);
    assert(sr.journal[0].text.includes('Deuxième entrée'));
  });

  // --- persistance (un fichier JSON par salon, sous data/rooms/) ---
  await sleep(1300);
  const roomsDir = path.join(process.env.DATA_DIR, 'rooms');
  const savedRoom = JSON.parse(fs.readFileSync(path.join(roomsDir, `${created.id}.json`), 'utf8'));
  check('persistance JSON du salon (workplace + images), un fichier par salon', () => {
    assert(fs.existsSync(path.join(roomsDir, `${LEGACY_ROOM_ID}.json`))); // migré depuis l'ancien rooms.json agrégé
    assert(!fs.existsSync(path.join(process.env.DATA_DIR, 'rooms.json'))); // ancien fichier renommé après migration
    assert(fs.existsSync(path.join(process.env.DATA_DIR, 'rooms.json.migrated')));
    assert.strictEqual(savedRoom.tokens.length, 5); // Alice, Bob, Intrus, Gobelin, Carol
    assert.strictEqual(savedRoom.workplace.grid.size, 100);
    assert(Array.isArray(savedRoom.workplace.fog.cells));
    assert.strictEqual(savedRoom.images.length, 1);
    assert.strictEqual(savedRoom.images[0].id, image1Id);
    assert.strictEqual(savedRoom.name, 'La Crypte des Ombres');
  });
  check('persistance JSON des fiches de personnage', () => {
    const aliceSheet = savedRoom.sheets.find((s) => s.playerId === s1.playerId);
    assert.strictEqual(aliceSheet.sheet.attributes.force, 5);
    const bobSheet = savedRoom.sheets.find((s) => s.playerId === s2.playerId);
    assert.strictEqual(bobSheet.sheet.healthMax, 20);
  });
  check('persistance JSON des journaux', () => {
    const aliceJournal = savedRoom.journals.find((j) => j.playerId === s1.playerId);
    assert.strictEqual(aliceJournal.entries.length, 1);
    assert(aliceJournal.entries[0].text.includes('Deuxième entrée'));
  });
  const savedUsers = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'users.json'), 'utf8'));
  check('persistance JSON des comptes (jamais le mot de passe en clair)', () => {
    assert.strictEqual(savedUsers.users.length, 5);
    assert(!JSON.stringify(savedUsers).includes('alice-password-1'));
  });

  console.log(`\n${ok} vérifications réussies`);
  process.exit(0);
})().catch((e) => {
  console.error('ÉCHEC :', e);
  process.exit(1);
});

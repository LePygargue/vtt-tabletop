'use strict';
/**
 * Livres de règles en PDF, un par jeu : data/rules/<id du jeu>.pdf (déposés à la main
 * sur le serveur, jamais dans public/ qui est servi sans connexion). Envoyés par
 * morceaux (requêtes Range) : le lecteur PDF.js du salon ne télécharge que les pages
 * consultées d'un livre de plusieurs centaines de Mo.
 */
const fs = require('fs');
const path = require('path');
const { RULES_DIR, SECURITY_HEADERS } = require('./config');
const { isGameId } = require('./games');

const rulesPath = (gameId) => path.join(RULES_DIR, `${gameId}.pdf`);
const hasRules = (gameId) => isGameId(gameId) && fs.existsSync(rulesPath(gameId));

/** Envoie le PDF d'un jeu, en entier ou la plage d'octets demandée (206). */
function serveRules(req, res, gameId) {
  const file = rulesPath(gameId);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      return res.end('Introuvable');
    }
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="regles-${gameId}.pdf"`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=86400',
      'Last-Modified': st.mtime.toUTCString(),
    };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0;
    let end = st.size - 1;
    let status = 200;
    if (m && (m[1] || m[2])) {
      if (m[1]) {
        start = Number(m[1]);
        if (m[2]) end = Math.min(Number(m[2]), st.size - 1);
      } else {
        start = Math.max(0, st.size - Number(m[2])); // « bytes=-N » : les N derniers octets
      }
      if (start > end || start >= st.size) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
  });
}

module.exports = { rulesPath, hasRules, serveRules };

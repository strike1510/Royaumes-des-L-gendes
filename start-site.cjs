// ============================================================
// SITE WEB - PORT 50006  (avec reverse-proxy Socket.IO intégré)
// ------------------------------------------------------------
// Le navigateur parle UNIQUEMENT à l'origine du site (ex.
// https://play.lavignere.eu via Cloudflare Tunnel -> 127.0.0.1:50006).
//
// Ce script :
//   1. lance le serveur Next.js standalone sur un port interne (50016) ;
//   2. ouvre un serveur public sur 50006 qui :
//        - relaie /socket.io  -> serveur de jeu  127.0.0.1:50007
//          (requêtes HTTP de polling ET upgrade WebSocket)
//        - relaie tout le reste -> Next.js  127.0.0.1:50016
//
// Les "rewrites" de next.config.ts ne proxifient pas correctement
// l'upgrade WebSocket en mode standalone (d'où les 404 sur
// /socket.io?EIO=4&transport=polling). Ce proxy natif règle ça
// sans aucune dépendance externe.
// ============================================================

const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const path = require('path');

const PUBLIC_PORT = 50006;            // port exposé (Cloudflare Tunnel pointe ici)
const PUBLIC_HOST = '0.0.0.0';
const NEXT_PORT = 50016;              // port interne du serveur Next.js standalone
const NEXT_HOST = '127.0.0.1';
const GAME_HOST = '127.0.0.1';        // serveur de jeu Socket.IO
const GAME_PORT = 50007;

console.log('============================================');
console.log('  SITE WEB - PORT 50006 (proxy Socket.IO)');
console.log('============================================');
console.log(`Site public     : http://127.0.0.1:${PUBLIC_PORT}`);
console.log(`Next.js interne : http://${NEXT_HOST}:${NEXT_PORT}`);
console.log(`Serveur de jeu  : http://${GAME_HOST}:${GAME_PORT}`);
console.log('Cloudflare      : play.lavignere.eu -> http://127.0.0.1:50006');
console.log('============================================');

// ------------------------------------------------------------
// 1) Lancer Next.js standalone sur le port interne
// ------------------------------------------------------------
const serverEntry = path.join(__dirname, '.next', 'standalone', 'server.js');

const nextProc = spawn(process.execPath, [serverEntry], {
  env: {
    ...process.env,
    PORT: String(NEXT_PORT),
    HOSTNAME: NEXT_HOST,
    GAME_SERVER_INTERNAL_URL: `http://${GAME_HOST}:${GAME_PORT}`,
    NEXT_PUBLIC_GAME_SERVER_URL: '',
  },
  stdio: 'inherit',
});

nextProc.on('exit', (code) => {
  console.error(`[Proxy] Le serveur Next.js s'est arrêté (code ${code}). Arrêt du proxy.`);
  process.exit(code || 1);
});

// ------------------------------------------------------------
// 2) Helpers de proxy HTTP
// ------------------------------------------------------------
function isSocketIo(url) {
  return url === '/socket.io' || url.startsWith('/socket.io/') || url.startsWith('/socket.io?');
}

function proxyHttp(clientReq, clientRes, targetHost, targetPort) {
  const options = {
    host: targetHost,
    port: targetPort,
    method: clientReq.method,
    path: clientReq.url,
    headers: clientReq.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes, { end: true });
  });

  proxyReq.on('error', (err) => {
    if (!clientRes.headersSent) clientRes.writeHead(502, { 'Content-Type': 'text/plain' });
    clientRes.end('Bad Gateway: ' + err.message);
  });

  clientReq.pipe(proxyReq, { end: true });
}

// ------------------------------------------------------------
// 3) Serveur public 50006
// ------------------------------------------------------------
const publicServer = http.createServer((req, res) => {
  if (isSocketIo(req.url)) {
    proxyHttp(req, res, GAME_HOST, GAME_PORT);   // polling -> serveur de jeu
  } else {
    proxyHttp(req, res, NEXT_HOST, NEXT_PORT);   // pages   -> Next.js
  }
});

// Upgrade WebSocket : /socket.io -> serveur de jeu, le reste -> Next.js
publicServer.on('upgrade', (req, socket, head) => {
  const target = isSocketIo(req.url)
    ? { host: GAME_HOST, port: GAME_PORT }
    : { host: NEXT_HOST, port: NEXT_PORT };

  const upstream = net.connect(target.port, target.host, () => {
    // Reconstitue la requête HTTP d'upgrade et la transmet telle quelle.
    let head_str = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      head_str += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    head_str += '\r\n';
    upstream.write(head_str);
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

publicServer.listen(PUBLIC_PORT, PUBLIC_HOST, () => {
  console.log(`[Proxy] En écoute sur http://${PUBLIC_HOST}:${PUBLIC_PORT}`);
});

// Nettoyage propre
function shutdown() {
  try { nextProc.kill(); } catch {}
  try { publicServer.close(); } catch {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Family Feud Party — entrypoint. Boots the HTTP(S) server, wires up the
// WebSocket hub and game engine, loads survey packs, and prints the links.
import { createServer as createHttp } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config/index.js';
import { loadPacks } from './src/content/packLoader.js';
import { GameEngine } from './src/game/GameEngine.js';
import { createUsedSurveyStore } from './src/game/usedSurveyStore.js';
import { Hub } from './src/server/wsHub.js';
import { createRequestHandler } from './src/server/httpServer.js';
import { lanAddress, qrToTerminal } from './src/server/network.js';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
};

async function main() {
  const { surveyPacks, fastMoney, warnings } = await loadPacks();
  for (const w of warnings) console.warn(`${C.yellow}⚠ pack: ${w}${C.reset}`);

  if (!surveyPacks.length) {
    console.error('No survey packs found. Add packs to ./packs.');
    process.exit(1);
  }

  const engine = new GameEngine(
    { surveyPacks, fastMoneySets: fastMoney },
    { usedStore: createUsedSurveyStore(join(config.paths.data, 'used-surveys.json')) },
  );
  let scheme = 'http'; // finalized below, before the server starts listening
  const handler = createRequestHandler({ getScheme: () => scheme });

  let server;
  if (config.tls.enabled) {
    try {
      const opts = {
        cert: readFileSync(config.tls.certPath),
        key: readFileSync(config.tls.keyPath),
      };
      server = createHttps(opts, handler);
      scheme = 'https';
    } catch (err) {
      console.error(`${C.yellow}TLS enabled but certs could not be read (${err.message}).`);
      console.error(`Run "npm run gen-cert" or set TLS_ENABLED=false. Falling back to HTTP.${C.reset}`);
      server = createHttp(handler);
    }
  } else {
    server = createHttp(handler);
  }

  const hub = new Hub(engine);
  hub.attach(server);

  server.listen(config.port, config.host, () => {
    printBanner(scheme, surveyPacks, fastMoney);
  });

  const shutdown = () => {
    console.log('\nShutting down…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function printBanner(scheme, surveyPacks, fastMoney) {
  const lan = `${scheme}://${lanAddress()}:${config.port}`;
  const surveys = surveyPacks.reduce((n, p) => n + p.surveys.length, 0);

  console.log(`\n${C.bold}${C.cyan}  FAMILY FEUD PARTY${C.reset}  ${C.dim}— survey says!${C.reset}`);
  console.log(`${C.dim}  ─────────────────────────────────────────────${C.reset}`);
  console.log(`  ${C.bold}Game screen + controls:${C.reset}  ${C.green}${scheme}://localhost:${config.port}/${C.reset}`);
  console.log(`  ${C.bold}TV / projector (board):${C.reset}  ${C.green}${lan}/display${C.reset}`);
  console.log(`  ${C.bold}Host controller (answers):${C.reset} ${C.green}${lan}/host${C.reset}`);
  console.log(`${C.dim}  Scan to open the host controller on your phone (same Wi-Fi):${C.reset}`);

  const qr = qrToTerminal(`${lan}/host`);
  if (qr) console.log(qr);

  console.log(
    `${C.dim}  Loaded ${surveyPacks.length} survey pack(s) (${surveys} surveys), ` +
      `${fastMoney.length} Fast Money set(s). Press Ctrl+C to stop.${C.reset}\n`,
  );
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

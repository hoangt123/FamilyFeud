// HTTP route test. Run: node test/http.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequestHandler } from '../src/server/httpServer.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

let passed = 0;
const ok = (label) => {
  passed++;
  console.log(`  ✓ ${label}`);
};

async function main() {
  const server = createServer(createRequestHandler());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.version, pkg.version, 'version should match package.json');
  ok('GET /health returns 200 with JSON status and version');

  for (const path of ['/', '/host', '/display']) {
    const page = await fetch(`${base}${path}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<script type="module" src="\/js\/app.js">/);
  }
  ok('/, /host and /display all serve the game page');

  const info = await (await fetch(`${base}/api/join-info`)).json();
  assert.match(info.hostUrl, /^http:\/\/[\d.]+:\d+\/host$/);
  assert.match(info.displayUrl, /^http:\/\/[\d.]+:\d+\/display$/);
  ok('GET /api/join-info returns LAN links for the host and display screens');

  const shared = await fetch(`${base}/shared/protocol.js`);
  assert.equal(shared.status, 200);
  assert.equal((await fetch(`${base}/shared/..%2f..%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${base}/no-such-route`)).status, 404);
  ok('shared protocol is served; traversal and unknown routes return 404');

  server.close();
  console.log(`\nhttp: all ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

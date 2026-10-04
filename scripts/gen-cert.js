// Generates a self-signed TLS certificate for local HTTPS testing.
// Output goes to ./certs (gitignored). Requires `openssl` on PATH.
//
// Usage: npm run gen-cert
//
// Then set in .env:
//   TLS_ENABLED=true
//   TLS_CERT_PATH=certs/cert.pem
//   TLS_KEY_PATH=certs/key.pem
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { lanAddress } from '../src/server/network.js';

const ROOT = resolve(import.meta.dirname, '..');
const CERT_DIR = resolve(ROOT, 'certs');
const cert = resolve(CERT_DIR, 'cert.pem');
const key = resolve(CERT_DIR, 'key.pem');

if (!existsSync(CERT_DIR)) mkdirSync(CERT_DIR, { recursive: true });

const ip = lanAddress();
const subj = '/C=US/ST=Local/L=Local/O=FamilyFeudParty/CN=family-feud.local';

try {
  execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', cert,
      '-days', '825', '-subj', subj,
      '-addext', `subjectAltName=DNS:localhost,IP:127.0.0.1,IP:${ip}`,
    ],
    { stdio: 'inherit' },
  );
  console.log(`\n✓ Wrote ${key}\n✓ Wrote ${cert}`);
  console.log('\nEnable HTTPS by setting TLS_ENABLED=true in your .env, then `npm start`.');
  console.log('Note: phones will warn about the self-signed cert — accept it to proceed.');
} catch (err) {
  console.error('Failed to generate certificate. Is `openssl` installed and on your PATH?');
  console.error(err.message);
  process.exit(1);
}

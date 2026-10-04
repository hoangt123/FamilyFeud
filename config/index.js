// Centralized configuration. Reads from environment with safe defaults.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, '..');

// Node 20.6+ can load a .env file natively — no dotenv dependency needed.
const envFile = resolve(ROOT, '.env');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* malformed .env — fall back to process.env / defaults */
  }
}

const bool = (v, fallback) =>
  v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

export const config = {
  port: Number(process.env.PORT) || 8080,
  host: process.env.HOST || '0.0.0.0',

  tls: {
    enabled: bool(process.env.TLS_ENABLED, false),
    certPath: resolve(ROOT, process.env.TLS_CERT_PATH || 'certs/cert.pem'),
    keyPath: resolve(ROOT, process.env.TLS_KEY_PATH || 'certs/key.pem'),
  },

  paths: {
    root: ROOT,
    packs: resolve(ROOT, 'packs'),
    data: resolve(ROOT, 'data'),
    public: resolve(ROOT, 'public'),
  },
};

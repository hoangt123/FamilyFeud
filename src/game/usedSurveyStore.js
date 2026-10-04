// Remembers which survey questions have already been played, across games and
// server restarts, so future rounds draw fresh surveys until the pool runs out.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function createUsedSurveyStore(file) {
  return {
    load() {
      try {
        const keys = JSON.parse(readFileSync(file, 'utf8'));
        return Array.isArray(keys) ? keys : [];
      } catch {
        return []; // first run, or unreadable file — start a fresh cycle
      }
    },
    save(keys) {
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(keys, null, 2));
      } catch {
        // best-effort: losing the memory only risks a repeated survey
      }
    },
  };
}

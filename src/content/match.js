// Fuzzy answer matching against survey answers. Drives automatic tile reveals
// and Fast Money score suggestions; the host can always override or undo.

const ARTICLES = new Set(['a', 'an', 'the']);

export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9\s]/g, ' ') // drop punctuation
    .split(/\s+/)
    .filter((w) => w && !ARTICLES.has(w))
    .join(' ')
    .trim();
}

// Levenshtein distance, capped for short strings.
function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Returns a similarity score from 0 (no match) to 1 (exact).
export function similarity(guess, target) {
  const a = normalize(guess);
  const b = normalize(target);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Whole-word containment counts strongly (e.g. "naruto uzumaki" vs "naruto"),
  // but "read" must not match inside "bread".
  if (` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `)) return 0.9;
  const dist = editDistance(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

// Does `guess` plausibly match any of the accepted forms?
export function matchesAny(guess, candidates, threshold = 0.8) {
  return bestMatch(guess, candidates, threshold).matched;
}

// Find the best candidate match. `candidates` is an array of strings.
export function bestMatch(guess, candidates, threshold = 0.8) {
  let best = { matched: false, score: 0, candidate: null };
  for (const c of candidates) {
    const score = similarity(guess, c);
    if (score > best.score) best = { matched: score >= threshold, score, candidate: c };
  }
  return best;
}

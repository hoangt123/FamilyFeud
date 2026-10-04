// Family Feud "Fast Money" finale, played by two members of the winning team.
// Ported from Quiz Clash (hoangt123/Jeopardy).
import { bestMatch } from '../content/match.js';
import { FAST_MONEY } from '../shared/protocol.js';

// Build the initial Fast Money state from a randomly chosen survey set.
// Finalists answer out loud one after the other; the host types each answer.
export function createFastMoney(sets, finalists) {
  const set = sets[Math.floor(Math.random() * sets.length)];
  return {
    questions: set.questions.map((q) => ({ prompt: q.prompt, answers: q.answers })),
    finalists: finalists.map((p) => ({ id: p.id, name: p.name })),
    // answers[slot][questionIndex] = { text, points, revealed, matchedAnswer }
    answers: finalists.map(() => emptyAnswers(set.questions.length)),
    stage: 'answer', // 'answer' (finalists take turns) | 'reveal' (host revealing)
    activeSlot: 0, // whose turn it is during 'answer'
    // The active finalist's clock, started by the host: { slot, seconds, startedAt, endsAt, expired }
    timer: null,
    // The last answer refused because the other finalist already gave it.
    rejection: null, // { slot, questionIndex, text, seq }
    total: 0,
    slotTotals: finalists.map(() => 0),
    target: FAST_MONEY.WIN_TARGET,
    won: false,
  };
}

// Seconds on the clock for a finalist slot.
export function turnSeconds(slot) {
  const t = FAST_MONEY.TURN_SECONDS;
  return t[Math.min(slot, t.length - 1)];
}

// A response can only be given once across the finalists: the same survey
// answer, or the same literal text when neither matches the survey.
export function isDuplicateAnswer(question, text, otherCell) {
  if (!otherCell?.text) return false;
  const norm = (s) => String(s).trim().toLowerCase();
  if (norm(otherCell.text) === norm(text)) return true;
  const mine = scoreAnswer(question, text);
  return Boolean(mine.matchedAnswer && otherCell.matchedAnswer && mine.matchedAnswer === otherCell.matchedAnswer);
}

function emptyAnswers(n) {
  return Array.from({ length: n }, () => ({ text: '', points: 0, revealed: false, matchedAnswer: null }));
}

// The survey's best possible answer for a question.
export function topSurveyAnswer(q) {
  return q.answers.reduce((best, a) => (a.points > best.points ? a : best), q.answers[0]);
}

// Score a typed answer against a question's survey results. Suggestion only —
// the host can override during reveal.
export function scoreAnswer(question, text) {
  if (!text || !text.trim()) return { points: 0, matchedAnswer: null };
  let best = { points: 0, matchedAnswer: null, score: 0 };
  for (const a of question.answers) {
    const candidates = [a.text, ...(a.accept || [])];
    const m = bestMatch(text, candidates, 0.82);
    if (m.matched && a.points >= best.points && m.score > best.score) {
      best = { points: a.points, matchedAnswer: a.text, score: m.score };
    }
  }
  return { points: best.points, matchedAnswer: best.matchedAnswer };
}

export function recomputeTotal(fm) {
  const slotTotals = fm.answers.map((slot) =>
    slot.reduce((sum, a) => sum + (a.revealed ? a.points : 0), 0),
  );
  fm.slotTotals = slotTotals;
  fm.total = slotTotals.reduce((a, b) => a + b, 0);
  fm.won = fm.total >= fm.target;
  return fm.total;
}

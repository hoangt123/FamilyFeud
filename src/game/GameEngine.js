// The authoritative game state machine. One instance per running game.
// It mutates `state`, then calls `notify()` so the server can re-broadcast.
//
// A match is three survey rounds (×1, ×2, ×3 points). Each round opens with a
// face-off: both teams give a response, and the higher answer on the board
// wins control. The controlling team then answers until the board is cleared
// or they collect three strikes, at which point the other team gets one answer
// to steal the bank. The leading team plays Fast Money as the final round.
import { bestMatch } from '../content/match.js';
import { C2S, FAST_MONEY, PHASE, ROLE, ROUNDS, STRIKES, SURVEY, TEAMS } from '../shared/protocol.js';
import {
  createFastMoney,
  drawFastMoneyQuestions,
  isDuplicateAnswer,
  recomputeTotal,
  scoreAnswer,
  topSurveyAnswer,
  turnSeconds,
} from './fastMoney.js';

const now = () => Date.now();
const UNDO_DEPTH = 40;

// Index of the survey answer a response matches, or -1 when it isn't on the board.
export function matchSurvey(answers, text) {
  if (!text || !String(text).trim()) return -1;
  let best = { index: -1, score: 0 };
  answers.forEach((a, i) => {
    const m = bestMatch(text, [a.text, ...(a.accept || [])], 0.82);
    if (m.matched && m.score > best.score) best = { index: i, score: m.score };
  });
  return best.index;
}

export class GameEngine {
  constructor(content, { notify, usedStore, usedFastMoneyStore } = {}) {
    this.content = content; // { surveyPacks, fastMoneyQuestions }
    this.notify = notify || (() => {});
    this.usedStore = usedStore || null; // persists played surveys across games
    this.usedFastMoneyStore = usedFastMoneyStore || null; // ...and played Fast Money questions
    this.timer = null;
    this.eventSeq = 0; // monotonic, so screens never replay an old reveal or strike
    this.fmRejSeq = 0;
    this.toLobby({
      teamNames: ['Team 1', 'Team 2'],
      teamMembers: ['', ''],
      enabledPacks: content.surveyPacks.map((p) => p.id),
    });
  }

  toLobby(config) {
    this.clearTimer();
    this.history = []; // undo snapshots for the current round
    this.usedKeys = new Set(this.usedStore?.load() ?? []);
    this.gameUsedKeys = new Set(); // surveys played tonight — repeated only as a last resort
    this.state = {
      phase: PHASE.LOBBY,
      round: 0,
      suddenDeath: false,
      config,
      teams: config.teamNames.map((name) => ({ name, score: 0 })),
      survey: null, // { prompt, answers: [{ text, points, accept, revealed, by }] }
      bank: 0,
      strikes: 0,
      control: null, // team index playing the board
      faceoff: null, // { responses: [{ team, text, index }], winner }
      roundResult: null, // { team, amount, stolen }
      fastMoney: null,
      fmTeam: null,
      winner: null,
      // What the last command did, in order — e.g. a failed steal is a strike
      // then an award. Drives sounds and animations: [{ kind, seq, ... }]
      events: [],
      message: '',
    };
  }

  // Host control: abandon the match and return to the lobby. Team names stay.
  restartMatch() {
    this.toLobby(this.state.config);
  }

  // ── timers ────────────────────────────────────────────────────────────
  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  setTimer(ms, fn) {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
      this.notify();
    }, ms);
  }

  // ── command dispatch ──────────────────────────────────────────────────
  handle(role, msg) {
    if (role !== ROLE.BOARD && role !== ROLE.HOST) return; // the TV display is read-only
    this.state.events = [];
    const team = Number(msg.team);
    switch (msg.type) {
      case C2S.CONFIG:
        this.applyConfig(msg);
        break;
      case C2S.START_GAME:
        this.startGame();
        break;
      case C2S.RESTART_GAME:
        this.restartMatch();
        break;
      case C2S.NEW_SURVEY:
        this.newSurvey();
        break;
      case C2S.FACEOFF_ANSWER:
        this.faceoffAnswer(team, msg.text);
        break;
      case C2S.FACEOFF_WINNER:
        this.overrideFaceoffWinner(team);
        break;
      case C2S.PLAY_OR_PASS:
        this.playOrPass(Boolean(msg.play));
        break;
      case C2S.ANSWER:
        this.answer(msg.text);
        break;
      case C2S.STRIKE:
        this.manualStrike();
        break;
      case C2S.REVEAL_TILE:
        this.revealTile(Number(msg.index));
        break;
      case C2S.UNDO:
        this.undo();
        break;
      case C2S.NEXT_ROUND:
        this.nextRound();
        break;
      case C2S.ADJUST_SCORE:
        this.adjustScore(team, Math.round(Number(msg.delta) || 0));
        break;
      case C2S.FM_START:
        this.startFastMoney(msg.names);
        break;
      case C2S.FM_START_TIMER:
        this.fmStartTimer();
        break;
      case C2S.FM_SET_ANSWER:
        this.fmSetAnswer(Number(msg.slot), Number(msg.questionIndex), msg.text);
        break;
      case C2S.FM_NEXT_PLAYER:
        this.fmAdvanceSlot();
        break;
      case C2S.FM_REVEAL:
        this.fmReveal(Number(msg.slot), Number(msg.questionIndex));
        break;
      case C2S.FM_SCORE:
        this.fmOverrideScore(Number(msg.slot), Number(msg.questionIndex), Number(msg.points) || 0);
        break;
      case C2S.FM_FINISH:
        this.fmFinish();
        break;
      default:
        return;
    }
    this.notify();
  }

  applyConfig(msg) {
    if (this.state.phase !== PHASE.LOBBY) return;
    const c = this.state.config;
    if (Array.isArray(msg.teamNames)) {
      c.teamNames = c.teamNames.map((old, i) => cleanText(msg.teamNames[i], 24) || old);
      c.teamNames.forEach((name, i) => (this.state.teams[i].name = name));
    }
    if (Array.isArray(msg.teamMembers)) {
      c.teamMembers = c.teamMembers.map((old, i) =>
        typeof msg.teamMembers[i] === 'string' ? cleanText(msg.teamMembers[i], 160) : old,
      );
    }
    if (Array.isArray(msg.enabledPacks)) {
      const valid = this.content.surveyPacks.map((p) => p.id);
      const filtered = msg.enabledPacks.filter((id) => valid.includes(id));
      if (filtered.length) c.enabledPacks = filtered;
    }
  }

  adjustScore(team, delta) {
    if (this.state.phase === PHASE.LOBBY || !this.isTeam(team) || !delta) return;
    this.state.teams[team].score += delta;
  }

  isTeam(team) {
    return Number.isInteger(team) && team >= 0 && team < TEAMS.COUNT;
  }

  // ── rounds ────────────────────────────────────────────────────────────
  startGame() {
    if (this.state.phase !== PHASE.LOBBY) return;
    if (!this.surveyPool().length) {
      this.state.message = 'No survey questions are loaded — add a pack to ./packs.';
      return;
    }
    this.state.message = '';
    for (const t of this.state.teams) t.score = 0;
    this.beginRound(1);
  }

  multiplier() {
    if (this.state.suddenDeath) return ROUNDS.SUDDEN_DEATH_MULTIPLIER;
    return ROUNDS.MULTIPLIER[this.state.round - 1] ?? ROUNDS.MULTIPLIER.at(-1);
  }

  surveyPool() {
    const enabled = this.state.config.enabledPacks;
    return this.content.surveyPacks.filter((p) => enabled.includes(p.id)).flatMap((p) => p.surveys);
  }

  // A survey not played in earlier games; once those run out the cycle starts
  // over, and tonight's surveys come back only when nothing else is left.
  drawSurvey() {
    const pool = this.surveyPool();
    const key = (s) => `${s.packId}:${s.prompt}`;
    let fresh = pool.filter((s) => !this.usedKeys.has(key(s)));
    if (!fresh.length) {
      this.usedKeys = new Set(this.gameUsedKeys);
      fresh = pool.filter((s) => !this.usedKeys.has(key(s)));
    }
    if (!fresh.length) fresh = pool;
    const pick = fresh[Math.floor(Math.random() * fresh.length)];
    this.usedKeys.add(key(pick));
    this.gameUsedKeys.add(key(pick));
    this.usedStore?.save([...this.usedKeys]);
    return {
      prompt: pick.prompt,
      answers: pick.answers.slice(0, SURVEY.MAX_ANSWERS).map((a) => ({ ...a, revealed: false, by: null })),
    };
  }

  beginRound(round) {
    const s = this.state;
    this.history = [];
    s.round = round;
    s.suddenDeath = round > ROUNDS.COUNT;
    s.survey = this.drawSurvey();
    s.bank = 0;
    s.strikes = 0;
    s.control = null;
    s.faceoff = { responses: [], winner: null };
    s.roundResult = null;
    s.message = '';
    s.phase = PHASE.FACEOFF;
    this.emit('round');
  }

  // Before anything is revealed the host may swap in a different question.
  newSurvey() {
    const s = this.state;
    if (s.phase !== PHASE.FACEOFF || s.faceoff.winner !== null) return;
    if (s.survey.answers.some((a) => a.revealed)) return;
    s.survey = this.drawSurvey();
    s.faceoff = { responses: [], winner: null };
    s.message = '';
    this.emit('round');
  }

  emit(kind, extra = {}) {
    this.state.events.push({ kind, seq: ++this.eventSeq, ...extra });
  }

  // Undo restores the round exactly as it was before the last action.
  snapshot() {
    this.history.push(structuredClone(this.state));
    if (this.history.length > UNDO_DEPTH) this.history.shift();
  }

  undo() {
    const roundPhases = [PHASE.FACEOFF, PHASE.PLAY, PHASE.STEAL, PHASE.ROUND_END];
    if (!roundPhases.includes(this.state.phase) || !this.history.length) return;
    this.state = this.history.pop();
    this.emit('undo');
  }

  reveal(index, team) {
    const s = this.state;
    const a = s.survey.answers[index];
    a.revealed = true;
    a.by = team;
    s.bank += a.points;
    this.emit('reveal', { index, team });
  }

  allRevealed() {
    return this.state.survey.answers.every((a) => a.revealed);
  }

  // Where a response lands: the index of an unrevealed answer, or -1 for a
  // miss (not on the board, blank, or an answer that's already showing).
  resolve(text, forcedIndex) {
    const answers = this.state.survey.answers;
    const index = forcedIndex ?? matchSurvey(answers, text);
    if (index < 0 || !answers[index] || answers[index].revealed) {
      return { index: -1, repeat: index >= 0 && Boolean(answers[index]?.revealed) };
    }
    return { index, repeat: false };
  }

  // ── face-off ──────────────────────────────────────────────────────────
  // Each team gives one response, in whichever order they buzzed. The #1
  // answer wins outright; otherwise the higher of the two wins; if neither is
  // on the board, the face-off goes again.
  faceoffAnswer(team, text, forcedIndex) {
    const s = this.state;
    const fo = s.faceoff;
    if (s.phase !== PHASE.FACEOFF || fo.winner !== null || !this.isTeam(team)) return;
    if (fo.responses.some((r) => r.team === team)) return; // one response per team per pass
    this.snapshot();
    const cleaned = cleanText(text, 60);
    const { index, repeat } = this.resolve(cleaned, forcedIndex);
    fo.responses.push({ team, text: cleaned, index });
    s.message = '';
    if (index >= 0) this.reveal(index, team);
    else this.emit('strike', { count: 1, team, repeat });

    if (index === 0) return this.faceoffWon(team);
    if (fo.responses.length < TEAMS.COUNT) return;
    const hits = fo.responses.filter((r) => r.index >= 0).sort((a, b) => a.index - b.index);
    if (hits.length) return this.faceoffWon(hits[0].team);
    fo.responses = [];
    s.message = 'Neither answer is on the board. Face-off again!';
  }

  overrideFaceoffWinner(team) {
    const s = this.state;
    if (s.phase !== PHASE.FACEOFF || s.faceoff.winner !== null || !this.isTeam(team)) return;
    this.snapshot();
    this.faceoffWon(team);
  }

  faceoffWon(team) {
    const s = this.state;
    s.faceoff.winner = team;
    s.message = '';
    // Sudden death is decided by the face-off alone.
    if (s.suddenDeath || this.allRevealed()) this.award(team, false);
  }

  playOrPass(play) {
    const s = this.state;
    if (s.phase !== PHASE.FACEOFF || s.faceoff.winner === null) return;
    this.snapshot();
    s.control = play ? s.faceoff.winner : otherTeam(s.faceoff.winner);
    s.strikes = 0;
    s.phase = PHASE.PLAY;
    this.emit('control', { team: s.control });
  }

  // ── play & steal ──────────────────────────────────────────────────────
  answer(text, forcedIndex) {
    const s = this.state;
    if (s.phase !== PHASE.PLAY && s.phase !== PHASE.STEAL) return;
    const cleaned = cleanText(text, 60);
    if (!cleaned && forcedIndex === undefined) return; // an accidental empty Enter
    this.snapshot();
    const { index, repeat } = this.resolve(cleaned, forcedIndex);
    s.message = '';
    if (s.phase === PHASE.STEAL) {
      const stealer = otherTeam(s.control);
      if (index >= 0) {
        this.reveal(index, stealer);
        this.award(stealer, true);
      } else {
        this.emit('strike', { count: 1, team: stealer, repeat });
        this.award(s.control, false);
      }
      return;
    }
    if (index >= 0) {
      this.reveal(index, s.control);
      if (this.allRevealed()) this.award(s.control, false);
    } else {
      this.addStrike(repeat);
    }
  }

  addStrike(repeat = false) {
    const s = this.state;
    s.strikes++;
    this.emit('strike', { count: s.strikes, team: s.control, repeat });
    if (s.strikes >= STRIKES.MAX) s.phase = PHASE.STEAL;
  }

  // The host's ✗ button: a strike while playing, a failed steal while stealing.
  manualStrike() {
    const s = this.state;
    if (s.phase === PHASE.PLAY) {
      this.snapshot();
      this.addStrike();
    } else if (s.phase === PHASE.STEAL) {
      this.snapshot();
      this.emit('strike', { count: 1, team: otherTeam(s.control) });
      this.award(s.control, false);
    }
  }

  // Clicking a hidden tile: the host heard that answer even though the typed
  // text didn't match. Once the round is decided, it just shows the answer.
  revealTile(index) {
    const s = this.state;
    const a = s.survey?.answers[index];
    if (!a || a.revealed) return;
    if (s.phase === PHASE.ROUND_END) {
      this.snapshot();
      a.revealed = true; // no points: the bank was already awarded
      this.emit('reveal', { index, team: null });
    } else if (s.phase === PHASE.PLAY || s.phase === PHASE.STEAL) {
      this.answer('', index);
    } else if (s.phase === PHASE.FACEOFF && s.faceoff.winner === null) {
      // The only unambiguous face-off responder is the team still to answer.
      const answered = s.faceoff.responses.map((r) => r.team);
      if (answered.length !== 1) {
        s.message = "Type the face-off answer in that team's box first.";
        return;
      }
      this.faceoffAnswer(otherTeam(answered[0]), a.text, index);
    }
  }

  award(team, stolen) {
    const s = this.state;
    const amount = s.bank * this.multiplier();
    s.teams[team].score += amount;
    s.roundResult = { team, amount, stolen };
    s.phase = PHASE.ROUND_END;
    this.emit('award', { team, amount, stolen });
  }

  // What the host's "next" button does after this round.
  nextStep() {
    const s = this.state;
    if (s.phase !== PHASE.ROUND_END) return null;
    if (s.round < ROUNDS.COUNT) return 'round';
    if (s.teams[0].score === s.teams[1].score) return 'sudden_death';
    return this.content.fastMoneyQuestions.length >= FAST_MONEY.QUESTION_COUNT ? 'fast_money' : 'finish';
  }

  leader() {
    const [a, b] = this.state.teams;
    return a.score >= b.score ? 0 : 1;
  }

  nextRound() {
    const step = this.nextStep();
    if (step === 'round' || step === 'sudden_death') this.beginRound(this.state.round + 1);
    else if (step === 'finish') this.endGame();
  }

  // ── fast money (ported from Quiz Clash) ───────────────────────────────
  startFastMoney(names) {
    if (this.nextStep() !== 'fast_money') return;
    const s = this.state;
    const team = this.leader();
    const defaults = this.defaultFinalists(team);
    const finalists = defaults.map((d, i) => ({
      id: `finalist-${i + 1}`,
      name: cleanText(Array.isArray(names) ? names[i] : '', 24) || d,
    }));
    this.history = [];
    s.fmTeam = team;
    s.fastMoney = createFastMoney(this.drawFastMoney(), finalists);
    s.survey = null;
    s.phase = PHASE.FAST_MONEY;
    this.emit('fast_money');
  }

  // Five questions from the whole pool, fresh and on different topics where
  // possible. Once fewer than five unplayed questions remain, the cycle restarts.
  drawFastMoney() {
    const pool = this.content.fastMoneyQuestions;
    let used = new Set(this.usedFastMoneyStore?.load() ?? []);
    const unplayed = pool.filter((q) => !used.has(q.prompt)).length;
    if (unplayed < FAST_MONEY.QUESTION_COUNT) used = new Set();
    const picks = drawFastMoneyQuestions(pool, used);
    for (const q of picks) used.add(q.prompt);
    this.usedFastMoneyStore?.save([...used]);
    return picks;
  }

  // The first two names listed for the team in the lobby, else placeholders.
  defaultFinalists(team) {
    const listed = this.state.config.teamMembers[team]
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    return [0, 1].map((i) => listed[i] || `${this.state.teams[team].name} #${i + 1}`);
  }

  // Host starts (or restarts) the active finalist's clock: 25s for the first,
  // 30s for the second. The board sounds a buzzer when it runs out.
  fmStartTimer() {
    const fm = this.state.fastMoney;
    if (this.state.phase !== PHASE.FAST_MONEY || !fm || fm.stage !== 'answer') return;
    const seconds = turnSeconds(fm.activeSlot);
    const startedAt = now();
    fm.timer = { slot: fm.activeSlot, seconds, startedAt, endsAt: startedAt + seconds * 1000, expired: false };
    this.setTimer(seconds * 1000, () => {
      if (fm.timer?.startedAt === startedAt) fm.timer.expired = true;
    });
  }

  // Host types what a finalist said. Editable any time — during either turn
  // or the reveal — so answers can be fixed on the fly. A blank clears it.
  // An answer the other finalist already gave is refused.
  fmSetAnswer(slot, questionIndex, text) {
    const fm = this.state.fastMoney;
    if (this.state.phase !== PHASE.FAST_MONEY || !fm) return;
    const cell = fm.answers[slot]?.[questionIndex];
    if (!cell) return;
    const cleaned = String(text ?? '').trim().slice(0, 60);
    const question = fm.questions[questionIndex];
    if (cleaned) {
      const others = fm.answers.filter((_, i) => i !== slot).map((a) => a[questionIndex]);
      if (others.some((o) => isDuplicateAnswer(question, cleaned, o))) {
        fm.rejection = { slot, questionIndex, text: cleaned, seq: ++this.fmRejSeq };
        return;
      }
    }
    const suggestion = scoreAnswer(question, cleaned);
    cell.text = cleaned;
    cell.points = suggestion.points;
    cell.matchedAnswer = suggestion.matchedAnswer;
    if (fm.rejection?.slot === slot && fm.rejection?.questionIndex === questionIndex) fm.rejection = null;
    recomputeTotal(fm);
  }

  // Host hands over to the next finalist; after the last one, the reveal.
  fmAdvanceSlot() {
    const fm = this.state.fastMoney;
    if (this.state.phase !== PHASE.FAST_MONEY || !fm || fm.stage !== 'answer') return;
    this.clearTimer();
    fm.timer = null;
    fm.rejection = null;
    if (fm.activeSlot < fm.finalists.length - 1) fm.activeSlot++;
    else fm.stage = 'reveal';
  }

  fmReveal(slot, questionIndex) {
    const fm = this.state.fastMoney;
    if (this.state.phase !== PHASE.FAST_MONEY || !fm || fm.stage !== 'reveal') return;
    const cell = fm.answers[slot]?.[questionIndex];
    if (!cell || cell.revealed) return;
    cell.revealed = true;
    recomputeTotal(fm);
    this.emit(cell.points > 0 ? 'fm_reveal' : 'fm_miss', { slot, questionIndex });
  }

  fmOverrideScore(slot, questionIndex, points) {
    const fm = this.state.fastMoney;
    if (this.state.phase !== PHASE.FAST_MONEY || !fm) return;
    const cell = fm.answers[slot]?.[questionIndex];
    if (!cell) return;
    cell.points = Math.max(0, Math.round(points));
    cell.revealed = true;
    recomputeTotal(fm);
  }

  fmFinish() {
    if (this.state.phase !== PHASE.FAST_MONEY) return;
    recomputeTotal(this.state.fastMoney);
    this.endGame();
  }

  endGame() {
    this.clearTimer();
    this.history = [];
    this.state.winner = this.leader();
    this.state.phase = PHASE.GAME_OVER;
    this.emit('game_over');
  }

  // ── serialization (role-aware) ────────────────────────────────────────
  serialize(role) {
    const s = this.state;
    const isController = role === ROLE.BOARD || role === ROLE.HOST;
    // Hidden survey answers only ever go to the private host controller.
    const peek = role === ROLE.HOST;

    const survey = s.survey
      ? {
          prompt: s.survey.prompt,
          answers: s.survey.answers.map((a) => ({
            text: a.revealed || peek ? a.text : null,
            points: a.revealed || peek ? a.points : null,
            revealed: a.revealed,
            by: a.by,
          })),
        }
      : null;

    let fastMoney = null;
    if (s.fastMoney) {
      const fm = s.fastMoney;
      const answering = fm.stage === 'answer';
      fastMoney = {
        stage: fm.stage,
        activeSlot: fm.activeSlot,
        turnSeconds: fm.finalists.map((_, i) => turnSeconds(i)),
        timer: fm.timer,
        target: fm.target,
        total: fm.total,
        slotTotals: fm.slotTotals,
        won: fm.won,
        finalists: fm.finalists,
        rejection: isController ? fm.rejection : null,
        questions: fm.questions.map((q, qi) => {
          const anyRevealed = fm.answers.some((slotAns) => slotAns[qi]?.revealed);
          return {
            // The host reads questions aloud; the TV doesn't show them early.
            prompt: isController || !answering ? q.prompt : null,
            // The best possible survey answer, shown to everyone on reveal.
            topAnswer: anyRevealed || s.phase === PHASE.GAME_OVER ? topSurveyAnswer(q) : null,
            cells: fm.answers.map((slotAns) => {
              const cell = slotAns[qi];
              const show = isController || cell.revealed;
              return {
                text: show ? cell.text : cell.text ? '•••' : '',
                points: show ? cell.points : null,
                matchedAnswer: isController ? cell.matchedAnswer : null,
                revealed: cell.revealed,
              };
            }),
          };
        }),
      };
    }

    return {
      now: now(), // server clock, so clients can de-skew countdown timers
      role,
      phase: s.phase,
      round: s.round,
      rounds: ROUNDS.COUNT,
      suddenDeath: s.suddenDeath,
      multiplier: s.round ? this.multiplier() : 1,
      config: s.config,
      teams: s.teams,
      survey,
      bank: s.bank,
      strikes: s.strikes,
      maxStrikes: STRIKES.MAX,
      control: s.control,
      faceoff: s.faceoff,
      roundResult: s.roundResult,
      nextStep: this.nextStep(),
      leader: this.leader(),
      finalistDefaults: this.nextStep() === 'fast_money' ? this.defaultFinalists(this.leader()) : null,
      canUndo: isController && this.history.length > 0,
      fastMoney,
      fmTeam: s.fmTeam,
      winner: s.winner,
      events: s.events,
      eventSeq: this.eventSeq,
      message: s.message,
      packs: this.content.surveyPacks.map((p) => ({
        id: p.id,
        title: p.title,
        count: p.surveys.length,
        enabled: s.config.enabledPacks.includes(p.id),
      })),
    };
  }
}

function otherTeam(team) {
  return team === 0 ? 1 : 0;
}

function cleanText(text, max) {
  return String(text ?? '').trim().slice(0, max);
}

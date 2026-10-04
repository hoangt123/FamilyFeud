// End-to-end game logic test. Run: node test/engine.test.mjs
import assert from 'node:assert/strict';
import { loadPacks } from '../src/content/packLoader.js';
import { GameEngine, matchSurvey } from '../src/game/GameEngine.js';
import { PHASE, ROLE } from '../src/shared/protocol.js';

let passed = 0;
const ok = (label) => {
  passed++;
  console.log(`  ✓ ${label}`);
};

const SURVEY = {
  prompt: 'Name something people bring to a picnic.',
  answers: [
    { text: 'Sandwiches', points: 40, accept: ['sandwich'] },
    { text: 'Blanket', points: 25, accept: [] },
    { text: 'Drinks', points: 15, accept: ['soda', 'lemonade'] },
    { text: 'Fruit', points: 10, accept: ['watermelon'] },
    { text: 'Chips', points: 6, accept: [] },
  ],
};

function makeEngine(fastMoneySets) {
  const packs = { surveyPacks: [{ id: 't', title: 'T', surveys: [{ ...SURVEY, packId: 't' }] }], fastMoneySets };
  return new GameEngine(packs);
}

// Drive the engine as the host would.
const host = (e, type, data = {}) => e.handle(ROLE.BOARD, { type, ...data });

async function main() {
  const { surveyPacks, fastMoney, warnings } = await loadPacks();
  assert.equal(warnings.length, 0, `packs should load cleanly:\n${warnings.join('\n')}`);
  assert.ok(surveyPacks.length >= 2 && fastMoney.length >= 2);
  for (const p of surveyPacks)
    for (const s of p.surveys)
      for (let i = 1; i < s.answers.length; i++) assert.ok(s.answers[i - 1].points >= s.answers[i].points);
  ok(`loaded ${surveyPacks.length} survey packs and ${fastMoney.length} Fast Money sets, sorted by points`);

  // Matching: aliases, typos, whole-word containment only.
  assert.equal(matchSurvey(SURVEY.answers, 'sandwich'), 0);
  assert.equal(matchSurvey(SURVEY.answers, 'blankett'), 1);
  assert.equal(matchSurvey(SURVEY.answers, 'a cold lemonade'), 2);
  assert.equal(matchSurvey(SURVEY.answers, 'frisbee'), -1);
  assert.equal(matchSurvey(SURVEY.answers, 'potato chips'), 4);
  assert.equal(matchSurvey([{ text: 'Read', accept: [] }], 'bread'), -1);
  ok('responses match by alias, small typo and whole word; "bread" is not "read"');

  // Fast Money sets: one fixed set so the test can type real answers.
  const fmSets = [fastMoney[0]];
  const e = makeEngine(fmSets);
  host(e, 'config', { teamNames: ['Smiths', 'Joneses'], teamMembers: ['Ann, Bob, Cal', ''] });
  host(e, 'start_game');
  let s = e.state;
  assert.equal(s.phase, PHASE.FACEOFF);
  assert.deepEqual(s.teams.map((t) => t.name), ['Smiths', 'Joneses']);
  ok('lobby names the teams and Start opens round 1 with a face-off');

  // The TV and the shared laptop never see hidden answers; the host page does.
  assert.equal(e.serialize(ROLE.DISPLAY).survey.answers[0].text, null);
  assert.equal(e.serialize(ROLE.BOARD).survey.answers[0].text, null);
  assert.equal(e.serialize(ROLE.HOST).survey.answers[0].text, 'Sandwiches');
  e.handle(ROLE.DISPLAY, { type: 'faceoff_answer', team: 0, text: 'sandwich' });
  assert.equal(s.faceoff.responses.length, 0);
  ok('hidden answers go only to /host, and /display cannot send commands');

  // Face-off: team 1 says #3, team 0 says #2 -> team 0 wins with the higher answer.
  host(e, 'faceoff_answer', { team: 1, text: 'soda' });
  assert.equal(s.faceoff.winner, null);
  assert.equal(s.survey.answers[2].revealed, true);
  host(e, 'faceoff_answer', { team: 1, text: 'chips' }); // second try by the same team is ignored
  assert.equal(s.survey.answers[4].revealed, false);
  host(e, 'faceoff_answer', { team: 0, text: 'blanket' });
  assert.equal(s.faceoff.winner, 0);
  assert.equal(s.bank, 40);
  ok('face-off: each team answers once, the higher-ranked answer wins, both go in the bank');

  host(e, 'play_or_pass', { play: true });
  assert.equal(s.phase, PHASE.PLAY);
  assert.equal(s.control, 0);
  host(e, 'answer', { text: 'sandwiches' });
  assert.equal(s.bank, 80);
  host(e, 'answer', { text: 'frisbee' });
  host(e, 'answer', { text: 'blanket' }); // already on the board: a strike
  assert.equal(s.strikes, 2);
  assert.equal(s.events.at(-1).kind, 'strike');
  assert.equal(s.events.at(-1).repeat, true);
  ok('play: a matched response flips its tile; a miss or repeat is a strike');

  host(e, 'undo');
  s = e.state;
  assert.equal(s.strikes, 1);
  host(e, 'strike');
  host(e, 'strike');
  assert.equal(s.phase, PHASE.STEAL);
  ok('undo takes back the last strike; three strikes hands the other team the steal');

  host(e, 'answer', { text: 'watermelon' });
  assert.equal(s.phase, PHASE.ROUND_END);
  assert.deepEqual(s.roundResult, { team: 1, amount: 90, stolen: true });
  assert.equal(s.teams[1].score, 90);
  host(e, 'reveal_tile', { index: 4 });
  assert.equal(s.survey.answers[4].revealed, true);
  assert.equal(s.teams[1].score, 90);
  ok('a correct steal takes the whole bank; leftover answers are revealed for no points');

  // Round 2 (double): face-off with both misses goes again; #1 wins outright.
  host(e, 'next_round');
  s = e.state;
  assert.equal(s.round, 2);
  assert.equal(e.multiplier(), 2);
  host(e, 'faceoff_answer', { team: 0, text: 'kite' });
  host(e, 'faceoff_answer', { team: 1, text: 'frisbee' });
  assert.equal(s.faceoff.responses.length, 0);
  assert.equal(s.faceoff.winner, null);
  host(e, 'faceoff_answer', { team: 1, text: 'sandwich' });
  assert.equal(s.faceoff.winner, 1);
  ok('face-off: two misses start it over; the #1 answer wins immediately');

  host(e, 'play_or_pass', { play: false });
  assert.equal(s.control, 0);
  for (const t of ['blanket', 'drinks', 'fruit', 'chips']) host(e, 'answer', { text: t });
  assert.equal(s.phase, PHASE.ROUND_END);
  assert.deepEqual(s.roundResult, { team: 0, amount: 192, stolen: false });
  ok('pass gives the board to the other team; clearing it awards the bank ×2');

  // Round 3 (triple): a failed steal goes to the controlling team; host tile click counts.
  host(e, 'next_round');
  s = e.state;
  host(e, 'faceoff_winner', { team: 0 });
  host(e, 'play_or_pass', { play: true });
  host(e, 'reveal_tile', { index: 3 }); // host heard "fruit" even though it wasn't typed
  assert.equal(s.bank, 10);
  for (let i = 0; i < 3; i++) host(e, 'strike');
  host(e, 'answer', { text: 'frisbee' });
  assert.deepEqual(s.events.map((ev) => ev.kind), ['strike', 'award']);
  assert.deepEqual(s.roundResult, { team: 0, amount: 30, stolen: false });
  assert.deepEqual(s.teams.map((t) => t.score), [222, 90]);
  assert.equal(e.serialize(ROLE.BOARD).nextStep, 'fast_money');
  assert.deepEqual(e.serialize(ROLE.BOARD).finalistDefaults, ['Ann', 'Bob']);
  ok('round 3 triples; a failed steal pays the controlling team; the leader goes to Fast Money');

  // Fast Money, ported from Quiz Clash.
  host(e, 'fm_start', { names: ['', 'Bobby'] });
  s = e.state;
  assert.equal(s.phase, PHASE.FAST_MONEY);
  assert.equal(s.fmTeam, 0);
  assert.deepEqual(s.fastMoney.finalists.map((f) => f.name), ['Ann', 'Bobby']);
  const qs = s.fastMoney.questions;
  qs.forEach((q, qi) => host(e, 'fm_set_answer', { slot: 0, questionIndex: qi, text: q.answers[0].text }));
  host(e, 'fm_next_player');
  host(e, 'fm_set_answer', { slot: 1, questionIndex: 0, text: qs[0].answers[0].text });
  assert.ok(s.fastMoney.rejection, 'a duplicate of the first finalist is refused');
  assert.equal(s.fastMoney.answers[1][0].text, '');
  assert.equal(e.serialize(ROLE.DISPLAY).fastMoney.questions[0].cells[0].text, '•••');
  host(e, 'fm_next_player');
  qs.forEach((_, qi) => host(e, 'fm_reveal', { slot: 0, questionIndex: qi }));
  assert.ok(s.fastMoney.total >= 200 === s.fastMoney.won);
  host(e, 'fm_finish');
  assert.equal(e.state.phase, PHASE.GAME_OVER);
  assert.equal(e.state.winner, 0);
  ok(`Fast Money: duplicates refused, answers hidden on the TV until revealed, ${s.fastMoney.total} pts`);

  // A tie after round 3 goes to sudden death, decided by the face-off alone.
  {
    const t = makeEngine(fmSets);
    host(t, 'start_game');
    t.state.round = 3;
    host(t, 'faceoff_winner', { team: 0 });
    host(t, 'play_or_pass', { play: true });
    host(t, 'answer', { text: 'blanket' });
    for (let i = 0; i < 3; i++) host(t, 'strike');
    host(t, 'answer', { text: 'sandwich' });
    t.state.teams[0].score = t.state.teams[1].score;
    assert.equal(t.serialize(ROLE.BOARD).nextStep, 'sudden_death');
    host(t, 'next_round');
    assert.equal(t.state.suddenDeath, true);
    host(t, 'faceoff_answer', { team: 1, text: 'chips' });
    host(t, 'faceoff_answer', { team: 0, text: 'drinks' });
    assert.equal(t.state.phase, PHASE.ROUND_END);
    assert.equal(t.state.roundResult.team, 0);
    assert.equal(t.state.roundResult.amount, 21 * 3);
    assert.equal(t.serialize(ROLE.BOARD).nextStep, 'fast_money');
    ok('a tie after round 3 plays a sudden-death face-off at triple points');
  }

  // Restart keeps the team names; with no Fast Money content the game just ends.
  {
    const t = makeEngine([]);
    host(t, 'config', { teamNames: ['Reds', 'Blues'] });
    host(t, 'start_game');
    host(t, 'adjust_score', { team: 1, delta: 50 });
    host(t, 'restart_game');
    assert.equal(t.state.phase, PHASE.LOBBY);
    assert.deepEqual(t.state.teams, [{ name: 'Reds', score: 0 }, { name: 'Blues', score: 0 }]);
    host(t, 'start_game');
    t.state.round = 3;
    host(t, 'faceoff_answer', { team: 0, text: 'sandwich' });
    host(t, 'play_or_pass', { play: true });
    for (let i = 0; i < 3; i++) host(t, 'strike');
    host(t, 'strike');
    assert.equal(t.serialize(ROLE.BOARD).nextStep, 'finish');
    host(t, 'next_round');
    assert.equal(t.state.phase, PHASE.GAME_OVER);
    assert.equal(t.state.winner, 0);
    ok('restart keeps team names; without Fast Money sets the leader is crowned after round 3');
  }

  console.log(`\nengine: all ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

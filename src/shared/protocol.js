// Shared WebSocket message vocabulary and game constants.
// Imported by the server (Node) and the browser clients (as an ES module).

export const ROLE = {
  BOARD: 'board', // one laptop: the board plus host controls, answers hidden
  HOST: 'host', // private controller: controls plus every hidden answer
  DISPLAY: 'display', // TV / projector: the board only, no controls
};

// Client -> Server. Every command except HELLO is host-only (board or host role).
export const C2S = {
  HELLO: 'hello', // { role }
  CONFIG: 'config', // lobby: { teamNames?: [a, b], teamMembers?: [a, b], enabledPacks? }
  START_GAME: 'start_game',
  RESTART_GAME: 'restart_game', // back to the lobby; team names kept, scores zeroed
  NEW_SURVEY: 'new_survey', // face-off, before anything is revealed: draw another question
  // Face-off: both teams give a response; the higher answer wins control.
  FACEOFF_ANSWER: 'faceoff_answer', // { team, text } — blank text counts as a miss
  FACEOFF_WINNER: 'faceoff_winner', // host override: { team }
  PLAY_OR_PASS: 'play_or_pass', // { play: bool } the face-off winner's choice
  // Main play and the steal
  ANSWER: 'answer', // { text } the controlling (or stealing) team's response
  STRIKE: 'strike', // manual ✗ for the team answering now
  REVEAL_TILE: 'reveal_tile', // { index } host override: that answer was said (or, after the round, just show it)
  UNDO: 'undo', // roll back the last face-off / play / steal action
  NEXT_ROUND: 'next_round',
  ADJUST_SCORE: 'adjust_score', // { team, delta }
  // Fast Money (ported from Quiz Clash)
  FM_START: 'fm_start', // { names: [a, b] } the winning team's two finalists
  FM_START_TIMER: 'fm_start_timer', // (re)start the active finalist's clock
  FM_SET_ANSWER: 'fm_set_answer', // { slot, questionIndex, text } typed from what was said aloud
  FM_NEXT_PLAYER: 'fm_next_player', // hand over to the next finalist, then the reveal
  FM_REVEAL: 'fm_reveal', // { slot, questionIndex }
  FM_SCORE: 'fm_score', // override: { slot, questionIndex, points }
  FM_FINISH: 'fm_finish',
};

// Server -> Client
export const S2C = {
  WELCOME: 'welcome', // { role }
  STATE: 'state', // full game state snapshot
  ERROR: 'error', // { message }
};

export const PHASE = {
  LOBBY: 'lobby',
  FACEOFF: 'faceoff', // both teams give a response to the new board
  PLAY: 'play', // the controlling team answers until the board clears or 3 strikes
  STEAL: 'steal', // the other team gets one answer to steal the bank
  ROUND_END: 'round_end',
  FAST_MONEY: 'fast_money',
  GAME_OVER: 'game_over',
};

export const ROUNDS = {
  COUNT: 3,
  // Points banked in a round are multiplied when awarded: single, double, triple.
  MULTIPLIER: [1, 2, 3],
  // A tie after the last round goes to a face-off-only sudden-death round.
  SUDDEN_DEATH_MULTIPLIER: 3,
};

export const SURVEY = {
  MIN_ANSWERS: 3,
  MAX_ANSWERS: 8, // the board has eight answer slots
};

export const STRIKES = { MAX: 3 };

export const FAST_MONEY = {
  QUESTION_COUNT: 5,
  // The host reads each question aloud and the finalists answer out loud, one
  // after the other. Seconds on the clock for the first and second finalist.
  TURN_SECONDS: [25, 30],
  WIN_TARGET: 200,
};

export const TEAMS = { COUNT: 2 };

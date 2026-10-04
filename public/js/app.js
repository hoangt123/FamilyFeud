// One page, three screens, picked by path:
//   /         the board plus host controls on one laptop (answers stay hidden)
//   /host     the private host controller: controls plus every hidden answer
//   /display  the TV / projector: the board only
// Uses a "view signature" so the DOM skeleton is only rebuilt when the
// structural view changes; dynamic bits are patched in place.
import { GameClient } from '/js/ws-client.js';
import { C2S, PHASE, ROLE } from '/shared/protocol.js';
import * as sfx from '/js/sound.js';

const MODE = { '/host': ROLE.HOST, '/display': ROLE.DISPLAY }[location.pathname] || ROLE.BOARD;
const CONTROLS = MODE !== ROLE.DISPLAY;
const PEEK = MODE === ROLE.HOST;
// On phones, focusing an input pops the keyboard and scrolls the page, so
// only desktop screens jump to the next answer box automatically.
const AUTOFOCUS = !matchMedia('(pointer: coarse)').matches;
const focusInput = (el) => AUTOFOCUS && el?.focus({ preventScroll: true });
document.body.dataset.mode = MODE;
if (MODE === ROLE.HOST) document.title = 'Family Feud — Host';
if (MODE === ROLE.DISPLAY) document.title = 'Family Feud — Board';

const client = new GameClient({ role: MODE, tokenKey: null });
const stageEl = document.getElementById('stage');
const connEl = document.getElementById('conn');
const restartBtn = document.getElementById('restartBtn');
const soundBtn = document.getElementById('soundBtn');
const strikeOverlay = document.getElementById('strikeOverlay');

const byId = (id) => document.getElementById(id);
const esc = (str) =>
  String(str ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let state = null;
let serverOffset = 0; // serverNow - clientNow
let sig = '';
let ctlSig = '';
let lastSeq = null; // newest event already played; null until the first state
let prevRevealed = [];

client.on('status', (s) => connEl.classList.toggle('ok', s === 'connected'));
client.on('welcome', () => (lastSeq = null)); // never replay old events after a reconnect
client.on('state', (s) => {
  state = s;
  serverOffset = s.now - Date.now();
  render();
  playEvents(s);
});

// ── sound toggle ────────────────────────────────────────────────────────────
// On by default for the board and the TV; the private host page stays quiet so
// a room with two screens doesn't hear everything twice.
const SOUND_KEY = `feud-sound-${MODE}`;
function loadSoundPref() {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    if (v !== null) return v === '1';
  } catch {
    /* storage unavailable */
  }
  return MODE !== ROLE.HOST;
}
function setSound(on) {
  sfx.setSoundEnabled(on);
  soundBtn.textContent = on ? '🔊 Sound on' : '🔇 Sound off';
  try {
    localStorage.setItem(SOUND_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}
setSound(loadSoundPref());
soundBtn.addEventListener('click', () => setSound(!sfx.soundEnabled()));
// Browsers only start audio after a user gesture.
document.addEventListener('pointerdown', () => sfx.soundEnabled() && sfx.unlockAudio());
document.addEventListener('keydown', () => sfx.soundEnabled() && sfx.unlockAudio());

// ── second-screen links ─────────────────────────────────────────────────────
// The LAN address, not whatever the host typed (often localhost).
let links = { hostUrl: `${location.origin}/host`, displayUrl: `${location.origin}/display` };
fetch('/api/join-info')
  .then((r) => r.json())
  .then((info) => {
    links = { ...links, ...info };
    drawLinks();
  })
  .catch(() => {});

function drawLinks() {
  const draw = (box, url) => {
    if (!box) return;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
    } catch {
      box.textContent = '';
    }
  };
  draw(byId('qrDisplay'), links.displayUrl);
  draw(byId('qrHost'), links.hostUrl);
  if (byId('linkDisplay')) byId('linkDisplay').textContent = links.displayUrl;
  if (byId('linkHost')) byId('linkHost').textContent = links.hostUrl;
}

// ── render ──────────────────────────────────────────────────────────────────
const ROUND_PHASES = [PHASE.FACEOFF, PHASE.PLAY, PHASE.STEAL, PHASE.ROUND_END];

function viewSignature(s) {
  if (ROUND_PHASES.includes(s.phase)) return `round:${s.round}:${s.survey?.prompt}`;
  if (s.phase === PHASE.FAST_MONEY) return `fm:${s.fastMoney?.stage}:${s.fastMoney?.activeSlot}`;
  return s.phase;
}

function render() {
  if (!state) return;
  restartBtn.classList.toggle(
    'hidden',
    !CONTROLS || state.phase === PHASE.LOBBY || state.phase === PHASE.GAME_OVER,
  );
  const newSig = viewSignature(state);
  if (newSig !== sig) {
    sig = newSig;
    ctlSig = '';
    stageEl.innerHTML = buildSkeleton(state);
    afterBuild(state);
  }
  patch(state);
}

function buildSkeleton(s) {
  if (s.phase === PHASE.LOBBY) return CONTROLS ? lobbySkeleton() : displayLobbySkeleton();
  if (ROUND_PHASES.includes(s.phase)) return roundSkeleton(s);
  if (s.phase === PHASE.FAST_MONEY) return fmSkeleton(s);
  if (s.phase === PHASE.GAME_OVER) return gameOverSkeleton(s);
  return '';
}

function afterBuild(s) {
  if (s.phase === PHASE.LOBBY && CONTROLS) {
    drawLinks();
    s.config.teamNames.forEach((n, i) => (byId(`teamName${i}`).value = n));
    s.config.teamMembers.forEach((m, i) => (byId(`teamMembers${i}`).value = m));
  }
  if (ROUND_PHASES.includes(s.phase)) prevRevealed = s.survey.answers.map((a) => a.revealed);
  if (s.phase === PHASE.FAST_MONEY && CONTROLS && s.fastMoney.stage === 'answer') {
    focusInput(byId(`fmIn${s.fastMoney.activeSlot}_0`));
  }
  if (s.phase === PHASE.GAME_OVER) launchConfetti();
}

function patch(s) {
  if (s.phase === PHASE.LOBBY) patchLobby(s);
  if (ROUND_PHASES.includes(s.phase)) patchRound(s);
  if (s.phase === PHASE.FAST_MONEY) patchFM(s);
}

// ── lobby ───────────────────────────────────────────────────────────────────
function lobbySkeleton() {
  const team = (i) => `<div class="field">
      <h3>Team ${i + 1}</h3>
      <input id="teamName${i}" data-config="name" data-team="${i}" maxlength="24" placeholder="Team name" />
      <input id="teamMembers${i}" data-config="members" data-team="${i}" maxlength="160" placeholder="Players (optional): Ann, Bob, Cal" />
    </div>`;
  return `<div class="logo">FAMILY FEUD</div>
    <div class="lobby">
      <div class="card">
        <h2>Teams</h2>
        <div class="team-setup">${team(0)}${team(1)}</div>
        <div class="muted" style="font-size:.85rem">The first two players listed for the winning team are suggested as Fast Money finalists.</div>
        <h3>Survey packs</h3>
        <div class="config-row" id="packs"></div>
        <div class="ctl-msg" id="lobbyMsg"></div>
        <button class="primary" data-action="start" style="font-size:1.2rem">Start the Feud ▶</button>
      </div>
      <div class="card">
        <h2>How it plays</h2>
        <ol class="rules">
          <li><b>Face-off:</b> one player from each team answers. The higher answer on the board wins, and the #1 answer wins outright.</li>
          <li>The winner chooses to <b>play</b> or <b>pass</b>. The playing team answers until the board is cleared or they get <b>three strikes</b>.</li>
          <li>After three strikes the other team gets <b>one answer to steal</b> the whole bank.</li>
          <li>Rounds 2 and 3 are worth <b>double</b> and <b>triple</b>. The leading team then plays <b>Fast Money</b> for 200 points.</li>
        </ol>
        <h3>Extra screens (optional)</h3>
        <div class="screens">
          <div><div class="qr" id="qrDisplay"></div><b>TV board</b><div class="link" id="linkDisplay"></div></div>
          <div><div class="qr" id="qrHost"></div><b>Host controller</b> <span class="muted">(shows the answers)</span><div class="link" id="linkHost"></div></div>
        </div>
      </div>
    </div>`;
}

function displayLobbySkeleton() {
  return `<div class="display-lobby">
      <div class="logo" style="font-size:clamp(3rem,10vw,8rem)">FAMILY FEUD</div>
      <div class="vs"><span id="dn0"></span><span class="v">vs</span><span id="dn1"></span></div>
      <div class="muted">Waiting for the host to start…</div>
    </div>`;
}

function patchLobby(s) {
  if (!CONTROLS) {
    s.teams.forEach((t, i) => (byId(`dn${i}`).textContent = t.name));
    return;
  }
  // Keep other screens' edits in sync without clobbering the field being typed in.
  s.config.teamNames.forEach((n, i) => {
    const el = byId(`teamName${i}`);
    if (el && el !== document.activeElement && el.value !== n) el.value = n;
  });
  s.config.teamMembers.forEach((m, i) => {
    const el = byId(`teamMembers${i}`);
    if (el && el !== document.activeElement && el.value !== m) el.value = m;
  });
  const packs = byId('packs');
  const html = s.packs
    .map(
      (p) =>
        `<button class="pack-toggle ${p.enabled ? 'on' : ''}" data-action="pack" data-id="${esc(p.id)}">${esc(p.title)} <span style="opacity:.6">${p.count}</span></button>`,
    )
    .join('');
  if (packs.dataset.html !== html) {
    packs.dataset.html = html;
    packs.innerHTML = html;
  }
  byId('lobbyMsg').textContent = s.message || '';
}

// ── main rounds ─────────────────────────────────────────────────────────────
function roundSkeleton(s) {
  const tiles = Array.from({ length: 8 }, (_, i) => `<div class="tile" id="tile${i}" data-i="${i}"></div>`).join('');
  return `<div class="feud-top">
      <div class="team-panel" id="team0"></div>
      <div class="center-col">
        <div class="pill" id="roundBadge"></div>
        <div class="bank"><div class="lbl" id="bankLbl">BANK</div><div class="num" id="bank">0</div></div>
      </div>
      <div class="team-panel" id="team1"></div>
    </div>
    <div class="survey-prompt">${esc(s.survey.prompt)}</div>
    <div class="status-line" id="status"></div>
    <div class="feud-board" id="board">${tiles}</div>
    <div class="strike-row" id="strikes"></div>
    ${CONTROLS ? '<div class="controls card" id="controls"></div><div class="ctl-msg" id="ctlMsg"></div>' : ''}`;
}

const teamName = (s, i) => s.teams[i]?.name ?? `Team ${i + 1}`;
const other = (i) => (i === 0 ? 1 : 0);

// The team the board is focused on right now, and why.
function activeTeam(s) {
  switch (s.phase) {
    case PHASE.FACEOFF:
      return s.faceoff.winner !== null ? { team: s.faceoff.winner, tag: 'Won the face-off' } : null;
    case PHASE.PLAY:
      return { team: s.control, tag: 'Playing' };
    case PHASE.STEAL:
      return { team: other(s.control), tag: 'Stealing' };
    case PHASE.ROUND_END:
      return { team: s.roundResult.team, tag: s.roundResult.stolen ? 'Stole the bank' : 'Won the round' };
    default:
      return null;
  }
}

function statusText(s) {
  switch (s.phase) {
    case PHASE.FACEOFF:
      if (s.faceoff.winner === null) return s.suddenDeath ? 'Sudden-death face-off!' : 'Face-off!';
      return `${teamName(s, s.faceoff.winner)} wins the face-off!`;
    case PHASE.PLAY:
      return `${teamName(s, s.control)} is playing`;
    case PHASE.STEAL:
      return `${teamName(s, other(s.control))} can steal!`;
    case PHASE.ROUND_END: {
      const r = s.roundResult;
      return `${teamName(s, r.team)} ${r.stolen ? 'steals' : 'wins'} ${r.amount} points!`;
    }
    default:
      return '';
  }
}

function roundLabel(s) {
  if (s.suddenDeath) return 'Sudden Death · Triple points';
  const mult = { 2: ' · Double points', 3: ' · Triple points' }[s.multiplier] || '';
  return `Round ${s.round} of ${s.rounds}${mult}`;
}

function setHtml(el, html) {
  if (el && el.dataset.html !== html) {
    el.dataset.html = html;
    el.innerHTML = html;
  }
}

function patchRound(s) {
  const act = activeTeam(s);
  [0, 1].forEach((i) => {
    const el = byId(`team${i}`);
    el.classList.toggle('active', act?.team === i);
    setHtml(
      el,
      `<div class="team-name">${esc(teamName(s, i))}</div>
       <div class="team-score" ${CONTROLS ? `data-dbl="score" data-team="${i}" title="Double-click to set points"` : ''}>${s.teams[i].score}</div>
       <div class="team-tag">${act?.team === i ? act.tag : ''}</div>`,
    );
  });
  byId('roundBadge').textContent = roundLabel(s);
  byId('bankLbl').textContent = s.multiplier > 1 ? `BANK ×${s.multiplier}` : 'BANK';
  byId('bank').textContent = s.bank;
  byId('status').textContent = statusText(s);
  patchBoard(s);

  const showStrikes = s.phase === PHASE.PLAY || s.phase === PHASE.STEAL || (s.phase === PHASE.ROUND_END && s.strikes > 0);
  setHtml(
    byId('strikes'),
    showStrikes
      ? Array.from({ length: s.maxStrikes }, (_, i) => `<div class="x ${i < s.strikes ? 'on' : ''}">✗</div>`).join('')
      : '',
  );
  if (CONTROLS) patchControls(s);
}

function patchBoard(s) {
  const answers = s.survey.answers;
  const canPick =
    CONTROLS &&
    ((s.phase === PHASE.FACEOFF && s.faceoff.winner === null) ||
      [PHASE.PLAY, PHASE.STEAL, PHASE.ROUND_END].includes(s.phase));
  for (let i = 0; i < 8; i++) {
    const el = byId(`tile${i}`);
    const a = answers[i];
    let cls = 'tile';
    let html = '';
    if (!a) cls += ' empty';
    else if (a.revealed) {
      cls += ` revealed${a.by === null ? ' by-none' : ''}`;
      html = `<span class="ans">${esc(a.text)}</span><span class="pts">${a.points}</span>`;
    } else if (PEEK) {
      cls += ' peek';
      html = `<span class="ans">${i + 1}. ${esc(a.text)}</span><span class="pts">${a.points}</span>`;
    } else {
      html = `<span class="num">${i + 1}</span>`;
    }
    if (a && !a.revealed && canPick) cls += ' clickable';
    if (el.dataset.cls !== cls) {
      el.dataset.cls = cls;
      el.className = cls;
      el.title = cls.includes('clickable')
        ? s.phase === PHASE.ROUND_END
          ? 'Show this answer (no points)'
          : 'They said this one: reveal it and score it'
        : '';
    }
    setHtml(el, html);
    if (a?.revealed && !prevRevealed[i]) {
      el.classList.remove('flip');
      void el.offsetWidth; // restart the animation
      el.classList.add('flip');
    }
  }
  prevRevealed = answers.map((a) => a.revealed);
}

// ── host controls ───────────────────────────────────────────────────────────
function controlsSignature(s) {
  const fo = s.faceoff;
  return [
    s.phase,
    fo?.responses.map((r) => `${r.team}:${r.index}:${r.text}`).join('|'),
    fo?.winner,
    s.control,
    s.nextStep,
  ].join('/');
}

function undoBtn() {
  return `<button class="ghost" data-action="undo" title="Take back the last action">↶ Undo</button>`;
}

function answerForm(kind, label, placeholder, missLabel) {
  return `<form class="ctl-form" data-form="${kind}">
      <label>${esc(label)}</label>
      <input name="text" maxlength="60" autocomplete="off" placeholder="${esc(placeholder)}" />
      <button class="primary">Submit</button>
      <button type="button" class="bad" data-action="strike">${missLabel}</button>
    </form>`;
}

function controlsHtml(s) {
  const fo = s.faceoff;
  switch (s.phase) {
    case PHASE.FACEOFF: {
      if (fo.winner !== null) {
        const w = fo.winner;
        return `<div class="ctl-title">${esc(teamName(s, w))} won the face-off. Play or pass?</div>
          <div class="ctl-row">
            <button class="primary" data-action="play">Play ▶</button>
            <button data-action="pass">Pass to ${esc(teamName(s, other(w)))} ↷</button>
            ${undoBtn()}
          </div>`;
      }
      const teamBox = (t) => {
        const r = fo.responses.find((x) => x.team === t);
        const body = r
          ? `<span class="result-chip ${r.index >= 0 ? 'hit' : 'miss'}">“${esc(r.text || '—')}” ${
              r.index >= 0 ? `→ #${r.index + 1}` : '✗ not on the board'
            }</span>`
          : `<form class="ctl-form" data-form="faceoff" data-team="${t}">
              <input name="text" maxlength="60" autocomplete="off" placeholder="Answer for ${esc(teamName(s, t))}" />
              <button class="primary">Submit</button>
              <button type="button" class="bad" data-action="fo-miss" data-team="${t}" title="No answer, or out of time">✗</button>
            </form>`;
        return `<div class="faceoff-team"><div class="who">${esc(teamName(s, t))}</div>${body}</div>`;
      };
      const anyRevealed = s.survey.answers.some((a) => a.revealed);
      return `<div class="ctl-title">Face-off: type each team's answer in the order they buzzed in
          <span class="hint">The #1 answer wins outright; otherwise the higher answer wins. If the text doesn't match, click the tile they meant.</span></div>
        <div class="faceoff-grid">${teamBox(0)}${teamBox(1)}</div>
        <div class="ctl-row">
          <span class="muted">Override:</span>
          <button class="ghost" data-action="fo-winner" data-team="0">${esc(teamName(s, 0))} wins</button>
          <button class="ghost" data-action="fo-winner" data-team="1">${esc(teamName(s, 1))} wins</button>
          <button class="ghost" data-action="new-survey" ${anyRevealed ? 'disabled' : ''} title="Draw a different question">⇄ New question</button>
          ${undoBtn()}
        </div>`;
    }
    case PHASE.PLAY: {
      const t = teamName(s, s.control);
      return `<div class="ctl-title">${esc(t)} is playing: type each answer as it's given
          <span class="hint">On the board, it flips. Not on the board, it's a strike. Three strikes and ${esc(teamName(s, other(s.control)))} can steal. If the text doesn't match, click the tile they meant.</span></div>
        ${answerForm('answer', t, `Answer for ${t}`, '✗ Strike')}
        <div class="ctl-row">${undoBtn()}</div>`;
    }
    case PHASE.STEAL: {
      const t = teamName(s, other(s.control));
      return `<div class="ctl-title">${esc(t)} gets one answer to steal ${s.bank * s.multiplier} points</div>
        ${answerForm('answer', t, `Steal answer for ${t}`, '✗ Wrong')}
        <div class="ctl-row">${undoBtn()}</div>`;
    }
    case PHASE.ROUND_END: {
      let next = '';
      if (s.nextStep === 'round') next = `<button class="primary" data-action="next">Start round ${s.round + 1} ▶</button>`;
      else if (s.nextStep === 'sudden_death')
        next = `<span class="muted">The scores are tied!</span><button class="primary" data-action="next">Sudden-death face-off ▶</button>`;
      else if (s.nextStep === 'finish') next = `<button class="primary" data-action="next">Finish the game 🏆</button>`;
      const fm =
        s.nextStep === 'fast_money'
          ? `<form class="ctl-form" data-form="fm-start">
              <label>${esc(teamName(s, s.leader))} plays Fast Money:</label>
              <input name="f0" maxlength="24" value="${esc(s.finalistDefaults[0])}" placeholder="Finalist 1" />
              <input name="f1" maxlength="24" value="${esc(s.finalistDefaults[1])}" placeholder="Finalist 2" />
              <button class="primary">Start Fast Money 💰</button>
            </form>`
          : '';
      return `<div class="ctl-title">${esc(statusText(s))}
          <span class="hint">Click hidden tiles (or Reveal all) to show the rest of the board. No points are added.</span></div>
        <div class="ctl-row">
          <button class="ghost" data-action="reveal-all">Reveal all remaining</button>
          ${undoBtn()}
          ${next}
        </div>${fm}`;
    }
    default:
      return '';
  }
}

function patchControls(s) {
  const el = byId('controls');
  const nsig = controlsSignature(s);
  if (nsig !== ctlSig) {
    ctlSig = nsig;
    el.innerHTML = controlsHtml(s);
    // Ready for the next answer without reaching for the mouse.
    focusInput(el.querySelector('form[data-form="faceoff"] input, form[data-form="answer"] input'));
  }
  const undo = el.querySelector('[data-action="undo"]');
  if (undo) undo.disabled = !s.canUndo;
  const revealAll = el.querySelector('[data-action="reveal-all"]');
  if (revealAll) revealAll.disabled = s.survey.answers.every((a) => a.revealed);
  byId('ctlMsg').textContent = s.message || '';
}

// ── fast money (ported from Quiz Clash) ─────────────────────────────────────
let fmShowPrev = false; // reveal the earlier finalist's answers on the host screen
let fmLastRejSeq = 0;
let fmRunningTimer = null;

function fmHeader(s) {
  return `<div class="fm-head"><div class="logo">FAST MONEY</div>
    <div class="muted">${esc(teamName(s, s.fmTeam))} · ${s.teams[s.fmTeam].score} points · ${s.fastMoney.target} to win</div></div>`;
}

function fmSkeleton(s) {
  const fm = s.fastMoney;
  const slot = fm.activeSlot;
  const who = fm.finalists[slot];
  const secs = fm.turnSeconds[slot];
  if (fm.stage === 'answer' && !CONTROLS) {
    return `<div class="fm-wrap">${fmHeader(s)}
        <h2 style="text-align:center">Finalist ${slot + 1}: ${esc(who.name)}</h2>
        <div class="fm-clock"><div class="countdown-ring" id="fmTimer"><span>${secs}</span></div></div>
        <div class="fm-grid" id="fmGrid"></div>
      </div>`;
  }
  if (fm.stage === 'answer') {
    // One finalist at a time: the host reads each question aloud, starts the
    // clock, and types what the finalist says. Answers stay editable.
    const prev = slot > 0 ? fm.finalists[slot - 1] : null;
    const last = slot >= fm.finalists.length - 1;
    const rows = fm.questions
      .map(
        (q, qi) => `<div class="fm-row fm-entry-row">
          <div class="fm-q"><span><span class="muted">${qi + 1}.</span> ${esc(q.prompt)}</span></div>
          ${prev ? `<input class="fm-in fm-prev ${fmShowPrev ? '' : 'fm-hidden'}" id="fmIn${slot - 1}_${qi}" data-slot="${slot - 1}" data-q="${qi}" maxlength="60" autocomplete="off" />` : ''}
          <input class="fm-in" id="fmIn${slot}_${qi}" data-slot="${slot}" data-q="${qi}" maxlength="60" autocomplete="off" placeholder="Type ${esc(who.name)}'s answer" />
        </div>`,
      )
      .join('');
    const heads = `<div class="fm-row fm-entry-row"><div></div>
      ${prev ? `<div class="fm-slot-head">${esc(prev.name)} <button class="ghost" data-action="fm-toggle-prev">${fmShowPrev ? 'Hide' : 'Show'}</button></div>` : ''}
      <div class="fm-slot-head">${esc(who.name)}</div></div>`;
    return `<div class="fm-wrap">${fmHeader(s)}
        <h3 style="text-align:center">Finalist ${slot + 1} of ${fm.finalists.length}: ${esc(who.name)} · ${secs} seconds</h3>
        <p class="muted" style="text-align:center;margin:0">Read each question aloud and type the answer as it's said. ${
          prev
            ? `${esc(prev.name)}'s answers are blocked: a repeat gets buzzed and must be changed.`
            : 'Answers stay hidden on the TV until the reveal.'
        }</p>
        <div class="fm-clock">
          <div class="countdown-ring" id="fmTimer"><span>${secs}</span></div>
          <button class="primary" data-action="fm-timer" id="fmTimerBtn">▶ Start ${secs}s timer</button>
        </div>
        <div class="fm-reject" id="fmReject"></div>
        <div class="fm-grid ${prev ? 'fm-grid-3' : 'fm-grid-2'}">${heads}${rows}</div>
        <div class="host-controls"><button data-action="fm-next" class="${last ? 'primary' : 'ghost'}">${
          last ? 'Go to the reveal ▶' : `Next: ${esc(fm.finalists[slot + 1].name)}'s turn ▶`
        }</button></div>
      </div>`;
  }
  // reveal stage — the grid re-renders on every state so reveals show live
  return `<div class="fm-wrap">${fmHeader(s)}
      <div class="fm-target" style="text-align:center">
        <span class="fm-slot-total">${esc(fm.finalists[0].name)}: <span id="fmSlot0">0</span></span>
        <span class="fm-slot-total">${esc(fm.finalists[1].name)}: <span id="fmSlot1">0</span></span>
        <span>Total <span class="cur" id="fmTotal">0</span> / ${fm.target}</span>
      </div>
      <div class="fm-grid" id="fmGrid"></div>
      ${CONTROLS ? '<div class="host-controls"><button class="primary" data-action="fm-finish">Finish & crown the winners 🏆</button></div>' : ''}
    </div>`;
}

function fmGridHtml(fm) {
  let rows = '';
  fm.questions.forEach((q, qi) => {
    // Once a cell is revealed, everyone learns the survey's best answer.
    const top = q.topAnswer
      ? `<div class="fm-top">★ Top answer: ${esc(q.topAnswer.text)} (${q.topAnswer.points})</div>`
      : '';
    rows += `<div class="fm-row">
      <div class="fm-q">${q.prompt ? `<span>${esc(q.prompt)}</span>` : `<span class="muted">Question ${qi + 1}</span>`}${top}</div>
      ${fmCellHtml(fm, 0, qi)}
      ${fmCellHtml(fm, 1, qi)}
    </div>`;
  });
  return `<div class="fm-row"><div></div>
    <div class="fm-slot-head">${esc(fm.finalists[0].name)}</div>
    <div class="fm-slot-head">${esc(fm.finalists[1].name)}</div></div>${rows}`;
}

function fmCellHtml(fm, slot, qi) {
  const cell = fm.questions[qi].cells[slot];
  const cls = cell.revealed ? 'fm-ans revealed' : 'fm-ans';
  const txt = cell.text ? esc(cell.text) : '<span class="muted">(blank)</span>';
  const pts = cell.revealed
    ? `<span class="pts" ${CONTROLS ? `data-dbl="fm-points" data-slot="${slot}" data-q="${qi}" data-points="${cell.points}" title="Double-click to set points"` : ''}>${cell.points}</span>`
    : '';
  let controls = '';
  if (CONTROLS && fm.stage === 'reveal' && state.phase === PHASE.FAST_MONEY) {
    const edit = `<button data-action="fm-edit" data-slot="${slot}" data-q="${qi}" class="ghost" title="Edit answer">✎</button>`;
    controls = cell.revealed
      ? `${edit}<button data-action="fm-score" data-slot="${slot}" data-q="${qi}" class="ghost" title="Set points">±</button>`
      : `${edit}<button data-action="fm-reveal" data-slot="${slot}" data-q="${qi}" class="primary">Reveal</button>`;
  }
  return `<div class="${cls}"><span class="txt">${txt}</span>${pts}
    <span class="controls">${controls}</span></div>`;
}

function patchFM(s) {
  const fm = s.fastMoney;
  setHtml(byId('fmGrid'), fmGridHtml(fm));
  if (fm.stage === 'answer') {
    // Time's-up buzzer, once per run and never on a reload.
    const t = fm.timer;
    if (t && !t.expired) fmRunningTimer = t.startedAt;
    if (t?.expired && fmRunningTimer === t.startedAt) {
      fmRunningTimer = null;
      sfx.playTimeUp();
    }
    if (!CONTROLS) return;
    // Keep entry boxes in sync without clobbering the one being typed in.
    document.querySelectorAll('.fm-in').forEach((input) => {
      if (input === document.activeElement) return;
      const cell = fm.questions[+input.dataset.q]?.cells[+input.dataset.slot];
      if (cell && input.value !== cell.text) input.value = cell.text;
    });
    const rej = fm.rejection;
    if (rej && rej.seq !== fmLastRejSeq) {
      fmLastRejSeq = rej.seq;
      sfx.playDuplicate();
      const input = byId(`fmIn${rej.slot}_${rej.questionIndex}`);
      if (input) {
        input.value = fm.questions[rej.questionIndex].cells[rej.slot].text;
        input.focus();
      }
    }
    const otherName = rej ? fm.finalists.find((_, i) => i !== rej.slot)?.name : '';
    byId('fmReject').textContent = rej
      ? `✗ “${rej.text}” was already said by ${otherName || 'the other finalist'}. Ask for a different answer.`
      : '';
    const btn = byId('fmTimerBtn');
    const secs = fm.turnSeconds[fm.activeSlot];
    btn.textContent = !t ? `▶ Start ${secs}s timer` : t.expired ? `↺ Restart ${secs}s timer` : '↺ Restart timer';
  } else {
    byId('fmTotal').textContent = fm.total;
    fm.slotTotals.forEach((v, i) => {
      const el = byId(`fmSlot${i}`);
      if (el) el.textContent = v;
    });
  }
}

// ── game over ───────────────────────────────────────────────────────────────
function gameOverSkeleton(s) {
  const w = s.winner;
  const fm = s.fastMoney;
  const panels = [0, 1]
    .map(
      (i) => `<div class="team-panel ${i === w ? 'active' : ''}">
        <div class="team-name">${i === w ? '👑 ' : ''}${esc(teamName(s, i))}</div>
        <div class="team-score">${s.teams[i].score}</div></div>`,
    )
    .join('');
  const fmLine = fm
    ? `<div class="fm-result ${fm.won ? 'won' : ''}">Fast Money: ${fm.total} points, ${
        fm.won ? `they hit ${fm.target}! 🎉` : `${fm.target - fm.total} short of ${fm.target}`
      }</div>`
    : '';
  return `<div class="winner-wrap">
      <div class="pill">🏆 Winners</div>
      <div class="winner-name">${esc(teamName(s, w))}</div>
      ${fmLine}
      <div class="final-scores">${panels}</div>
      ${fm ? `<div class="fm-grid" style="width:min(1100px,100%)">${fmGridHtml(fm)}</div>` : ''}
      ${CONTROLS ? '<button class="primary" data-action="new-game">New game</button>' : ''}
    </div>`;
}

// ── events: sounds & the big ✗ ──────────────────────────────────────────────
function playEvents(s) {
  const events = s.events || [];
  if (lastSeq === null) {
    lastSeq = s.eventSeq; // first state after (re)connecting: nothing to replay
    return;
  }
  let delay = 0;
  for (const ev of events) {
    if (ev.seq <= lastSeq) continue;
    const at = delay;
    switch (ev.kind) {
      case 'reveal':
      case 'fm_reveal':
        setTimeout(sfx.playDing, at);
        delay += 500;
        break;
      case 'strike':
        setTimeout(() => {
          showStrikes(ev.count);
          sfx.playStrike();
        }, at);
        delay += 1100;
        break;
      case 'fm_miss':
        setTimeout(sfx.playStrike, at);
        break;
      case 'award':
      case 'game_over':
        setTimeout(sfx.playFanfare, at);
        break;
    }
  }
  lastSeq = Math.max(lastSeq, s.eventSeq);
}

let strikeTimer = null;
function showStrikes(count) {
  strikeOverlay.innerHTML = Array.from({ length: Math.max(1, count) }, () => '<div class="big-x">✗</div>').join('');
  strikeOverlay.classList.remove('hidden');
  clearTimeout(strikeTimer);
  strikeTimer = setTimeout(() => strikeOverlay.classList.add('hidden'), 1100);
}

// ── countdown timer (single ticker) ─────────────────────────────────────────
setInterval(() => {
  if (state?.phase !== PHASE.FAST_MONEY || state.fastMoney?.stage !== 'answer') return;
  const fm = state.fastMoney;
  const ring = byId('fmTimer');
  if (!ring) return;
  const t = fm.timer;
  if (!t) {
    ring.style.setProperty('--p', 0);
    ring.querySelector('span').textContent = fm.turnSeconds[fm.activeSlot];
  } else {
    const remain = t.expired ? 0 : Math.max(0, t.endsAt - (Date.now() + serverOffset));
    ring.style.setProperty('--p', (100 - (remain / (t.seconds * 1000)) * 100).toFixed(0));
    ring.querySelector('span').textContent = remain > 0 ? Math.ceil(remain / 1000) : '⏰';
  }
}, 200);

// ── host input ──────────────────────────────────────────────────────────────
if (CONTROLS) {
  stageEl.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile.clickable');
    if (tile) {
      client.send(C2S.REVEAL_TILE, { index: +tile.dataset.i });
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset;
    switch (a.action) {
      case 'start':
        client.send(C2S.START_GAME);
        break;
      case 'pack': {
        const enabled = state.packs.filter((p) => p.enabled).map((p) => p.id);
        const next = enabled.includes(a.id) ? enabled.filter((x) => x !== a.id) : [...enabled, a.id];
        if (next.length) client.send(C2S.CONFIG, { enabledPacks: next });
        break;
      }
      case 'fo-miss':
        client.send(C2S.FACEOFF_ANSWER, { team: +a.team, text: '' });
        break;
      case 'fo-winner':
        client.send(C2S.FACEOFF_WINNER, { team: +a.team });
        break;
      case 'new-survey':
        client.send(C2S.NEW_SURVEY);
        break;
      case 'play':
      case 'pass':
        client.send(C2S.PLAY_OR_PASS, { play: a.action === 'play' });
        break;
      case 'strike':
        client.send(C2S.STRIKE);
        break;
      case 'undo':
        client.send(C2S.UNDO);
        break;
      case 'reveal-all':
        // One at a time, for the drama.
        state.survey.answers
          .map((ans, i) => (ans.revealed ? -1 : i))
          .filter((i) => i >= 0)
          .forEach((i, n) => setTimeout(() => client.send(C2S.REVEAL_TILE, { index: i }), n * 700));
        break;
      case 'next':
        client.send(C2S.NEXT_ROUND);
        break;
      case 'fm-next':
        fmShowPrev = false;
        client.send(C2S.FM_NEXT_PLAYER);
        break;
      case 'fm-timer':
        client.send(C2S.FM_START_TIMER);
        break;
      case 'fm-toggle-prev':
        fmShowPrev = !fmShowPrev;
        document.querySelectorAll('.fm-prev').forEach((el) => el.classList.toggle('fm-hidden', !fmShowPrev));
        btn.textContent = fmShowPrev ? 'Hide' : 'Show';
        break;
      case 'fm-edit': {
        const cell = state.fastMoney?.questions[+a.q]?.cells[+a.slot];
        const text = prompt('Edit the answer (blank clears it):', cell?.text || '');
        if (text !== null) client.send(C2S.FM_SET_ANSWER, { slot: +a.slot, questionIndex: +a.q, text });
        break;
      }
      case 'fm-reveal':
        client.send(C2S.FM_REVEAL, { slot: +a.slot, questionIndex: +a.q });
        break;
      case 'fm-score': {
        const pts = prompt('Set points for this answer:');
        if (pts !== null && pts.trim() && !Number.isNaN(+pts))
          client.send(C2S.FM_SCORE, { slot: +a.slot, questionIndex: +a.q, points: Math.round(+pts) });
        break;
      }
      case 'fm-finish':
        client.send(C2S.FM_FINISH);
        break;
      case 'new-game': // final screen: the match is over, no confirmation needed
        client.send(C2S.RESTART_GAME);
        break;
    }
  });

  stageEl.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const input = form.querySelector('input[name="text"]');
    const text = input?.value.trim() ?? '';
    switch (form.dataset.form) {
      case 'faceoff':
        if (text) client.send(C2S.FACEOFF_ANSWER, { team: +form.dataset.team, text });
        break;
      case 'answer':
        if (text) client.send(C2S.ANSWER, { text });
        input.value = '';
        focusInput(input);
        break;
      case 'fm-start':
        client.send(C2S.FM_START, { names: [form.elements.f0.value, form.elements.f1.value] });
        break;
    }
  });

  // Lobby team setup: send on change so other screens stay in sync.
  stageEl.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset?.config) {
      const idx = +el.dataset.team;
      const key = el.dataset.config === 'name' ? 'teamNames' : 'teamMembers';
      const values = [...state.config[key]];
      values[idx] = el.value;
      client.send(C2S.CONFIG, { [key]: values });
    } else if (el.classList?.contains('fm-in')) {
      sendFmInput(el);
    }
  });

  // Double-click a team score (or a revealed Fast Money answer's points) to
  // set it to an exact number.
  stageEl.addEventListener('dblclick', (e) => {
    const el = e.target.closest('[data-dbl]');
    if (!el) return;
    const d = el.dataset;
    if (d.dbl === 'score') {
      const current = state.teams[+d.team].score;
      const v = prompt(`Set ${teamName(state, +d.team)}'s points to:`, current);
      if (v === null || !v.trim() || Number.isNaN(+v)) return;
      const delta = Math.round(+v) - current;
      if (delta) client.send(C2S.ADJUST_SCORE, { team: +d.team, delta });
    } else if (d.dbl === 'fm-points') {
      const v = prompt('Set points for this answer:', d.points);
      if (v === null || !v.trim() || Number.isNaN(+v)) return;
      client.send(C2S.FM_SCORE, { slot: +d.slot, questionIndex: +d.q, points: Math.round(+v) });
    }
  });

  // Fast Money entry boxes: Enter sends and moves to the next question.
  stageEl.addEventListener('keydown', (e) => {
    const input = e.target;
    if (e.key !== 'Enter' || !input.classList?.contains('fm-in')) return;
    e.preventDefault();
    sendFmInput(input);
    const next = byId(`fmIn${input.dataset.slot}_${+input.dataset.q + 1}`);
    if (next) next.focus();
    else input.blur();
  });

  restartBtn.addEventListener('click', () => {
    if (confirm('Restart the game? Scores reset to 0 and everyone returns to the lobby.')) {
      client.send(C2S.RESTART_GAME);
    }
  });
}

function sendFmInput(input) {
  const cell = state?.fastMoney?.questions[+input.dataset.q]?.cells[+input.dataset.slot];
  if (cell && input.value.trim() === cell.text) return;
  client.send(C2S.FM_SET_ANSWER, { slot: +input.dataset.slot, questionIndex: +input.dataset.q, text: input.value });
}

function launchConfetti() {
  const box = document.getElementById('confetti');
  box.classList.remove('hidden');
  box.innerHTML = '';
  const colors = ['#ffc23d', '#ff9a1f', '#ffffff', '#4fc3ff', '#2fe6a8', '#1b4fc4'];
  for (let i = 0; i < 120; i++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 2 + Math.random() * 2.5 + 's';
    c.style.animationDelay = Math.random() * 1.5 + 's';
    box.appendChild(c);
  }
  setTimeout(() => box.classList.add('hidden'), 9000);
}

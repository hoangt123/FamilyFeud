// Game-show sound effects synthesized with Web Audio — no asset files.
// Browsers only allow audio after a user gesture, so any click unlocks it.
let ctx = null;
let enabled = false;

export function unlockAudio() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

export function setSoundEnabled(on) {
  enabled = on;
  if (on) unlockAudio();
}

export const soundEnabled = () => enabled;

function tone(freq, start, duration, type = 'square', gain = 0.25) {
  if (!enabled || !ctx) return;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + start;
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.setValueAtTime(gain, t0 + duration - 0.03);
  amp.gain.linearRampToValueAtTime(0, t0 + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration);
}

// A tile flips: a bright two-note bell.
export function playDing() {
  tone(1047, 0, 0.18, 'sine', 0.3);
  tone(1568, 0.12, 0.45, 'sine', 0.25);
}

// A strike: the harsh studio "wrong answer" buzzer.
export function playStrike() {
  tone(92, 0, 0.75, 'sawtooth', 0.32);
  tone(98, 0, 0.75, 'square', 0.18);
}

// A team wins the round: a quick rising fanfare.
export function playFanfare() {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, i === 3 ? 0.5 : 0.14, 'triangle', 0.25));
}

// Fast Money time's up: one long, low buzzer.
export function playTimeUp() {
  tone(110, 0, 1.4, 'sawtooth', 0.3);
  tone(147, 0, 1.4, 'square', 0.15);
}

// Fast Money duplicate answer: the classic double "eh-eh".
export function playDuplicate() {
  tone(160, 0, 0.22, 'square', 0.25);
  tone(160, 0.3, 0.22, 'square', 0.25);
}

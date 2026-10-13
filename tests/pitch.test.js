import test from 'node:test';
import assert from 'node:assert/strict';
import { Yin, gateFor, micVerdict, DEFAULT_GATE } from '../js/pitch.js';

const WINDOW = 2048; // همان اندازه‌ای که برنامه از میکروفون می‌خواند
const cents = (f, ref) => 1200 * Math.log2(f / ref);

// صدایی شبیه صدای آدم: چند هارمونیک با افت ۱/k و کمی نویز
function voice(sr, f, { amp = 0.2, noise = 0.01, phase = 0 } = {}) {
  const buf = new Float32Array(WINDOW);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < WINDOW; i++) {
    let s = 0;
    for (let k = 1; k <= 6; k++) if (f * k < sr / 2) s += Math.sin((2 * Math.PI * f * k * i) / sr + phase * k) / k;
    buf[i] = (amp * s) / 1.6 + noise * rnd();
  }
  return buf;
}

for (const sr of [44100, 48000]) {
  test(`detects sung pitch within 3 cents across the vocal range at ${sr} Hz`, () => {
    const yin = new Yin(sr);
    // از دو (C2، پایین‌تر از صدای باس) تا دو (C6، بالای سوپرانو)، شامل ربع‌پرده‌ها
    for (let midi = 36; midi <= 84; midi += 0.5) {
      const f = 440 * 2 ** ((midi - 69) / 12);
      for (const phase of [0, 1.3, 2.9]) {
        const r = yin.detect(voice(sr, f, { phase }));
        assert.ok(r.freq > 0 && r.clarity > 0.85, `no pitch at midi ${midi}`);
        assert.ok(Math.abs(cents(r.freq, f)) < 3, `midi ${midi}: off by ${cents(r.freq, f).toFixed(1)} cents`);
      }
    }
  });
}

test('silence and noise give no pitch', () => {
  const yin = new Yin(48000);
  assert.equal(yin.detect(new Float32Array(WINDOW)).freq, 0);
  let seed = 7;
  const noise = Float32Array.from({ length: WINDOW }, () => (((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1) * 0.2);
  const r = yin.detect(noise);
  assert.ok(!(r.freq > 0 && r.clarity > 0.85));
});

test('the loudness gate decides what counts as silence', () => {
  const quiet = voice(48000, 220, { amp: 0.008, noise: 0 });
  assert.equal(new Yin(48000).detect(quiet).freq, 0, 'below the default gate');
  const r = new Yin(48000, { gate: 0.003 }).detect(quiet);
  assert.ok(Math.abs(cents(r.freq, 220)) < 3, 'audible once the gate is lowered');
});

test('gateFor scales with room noise and stays within limits', () => {
  assert.equal(gateFor(0), 0.003);
  assert.ok(Math.abs(gateFor(0.004) - 0.012) < 1e-12);
  assert.equal(gateFor(0.5), 0.05);
  assert.ok(gateFor(0.002) < DEFAULT_GATE, 'a quiet room makes the app more sensitive than the default');
});

test('micVerdict classifies the microphone check', () => {
  assert.equal(micVerdict({ noise: 0.001, level: 0.12, peak: 0.2, voiced: 90 }), 'ok');
  assert.equal(micVerdict({ noise: 0.001, level: 0, peak: 0.002, voiced: 0 }), 'silent');
  assert.equal(micVerdict({ noise: 0.001, level: 0.006, peak: 0.01, voiced: 60 }), 'weak');
  assert.equal(micVerdict({ noise: 0.04, level: 0.3, peak: 0.35, voiced: 90 }), 'noisy');
  assert.equal(micVerdict({ noise: 0.001, level: 0.45, peak: 0.6, voiced: 90 }), 'loud');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fa, freqToMidi, midiToFreq, stepName, nearest, estimateVoiceType, fitRoot, fold } from '../js/notes.js';

test('Persian digits', () => {
  assert.equal(fa(2026), '۲۰۲۶');
  assert.equal(fa('نت 3 از 10'), 'نت ۳ از ۱۰');
});

test('frequency and MIDI conversions round-trip', () => {
  assert.equal(freqToMidi(440), 69);
  assert.ok(Math.abs(midiToFreq(60) - 261.6256) < 0.001);
  for (const m of [40, 57.5, 69, 84]) assert.ok(Math.abs(freqToMidi(midiToFreq(m)) - m) < 1e-9);
});

test('semitone names use fixed do = C', () => {
  assert.deepEqual(stepName(60), { fa: 'دو', latin: 'C4' });
  assert.deepEqual(stepName(69), { fa: 'لا', latin: 'A4' });
  assert.deepEqual(stepName(61), { fa: 'دو دیز', latin: 'C#4' });
  assert.deepEqual(stepName(47), { fa: 'سی', latin: 'B2' });
});

test('quarter-tones are named koron below a natural, sori above a natural', () => {
  // می کرن: یک ربع‌پرده پایین‌تر از می (درس شور)
  assert.deepEqual(stepName(63.5), { fa: 'می کرن', latin: 'E4 −¼' });
  assert.deepEqual(stepName(61.5), { fa: 'ر کرن', latin: 'D4 −¼' });
  assert.deepEqual(stepName(65.5), { fa: 'فا سری', latin: 'F4 +¼' });
  assert.deepEqual(stepName(60.5), { fa: 'دو سری', latin: 'C4 +¼' });
});

test('nearest snaps to quarter-tones only in Iranian mode', () => {
  const eKoron = 63.5 + 0.1;
  assert.equal(nearest(eKoron, 'irani').step, 63.5);
  assert.ok(Math.abs(nearest(eKoron, 'irani').cents - 10) < 1e-6);
  assert.equal(nearest(eKoron, 'gharbi').step, 64);
  assert.ok(Math.abs(nearest(eKoron, 'gharbi').cents + 40) < 1e-6);
});

test('voice type follows the middle of the range', () => {
  assert.equal(estimateVoiceType(40, 62, 'male').id, 'bass');
  assert.equal(estimateVoiceType(45, 69, 'male').id, 'baritone');
  assert.equal(estimateVoiceType(50, 74, 'male').id, 'tenor');
  assert.equal(estimateVoiceType(60, 84, 'female').id, 'soprano');
  // صدای نامشخص مثل مردانه حساب می‌شود
  assert.equal(estimateVoiceType(45, 69, null).id, 'baritone');
});

test('fitRoot picks the octave that best fits the range', () => {
  // دو تا سل (۷ نیم‌پرده) برای صدای مردانه‌ی معمولی: C3
  assert.equal(fitRoot(0, 7, 45, 62), 48);
  // همان برای صدای زنانه: C4
  assert.equal(fitRoot(0, 7, 57, 72), 60);
  // ر تا سل (شور) برای صدای مردانه: D3
  assert.equal(fitRoot(2, 5, 45, 62), 50);
  assert.equal(fitRoot(2, 5, 45, 62) % 12, 2);
});

test('fold brings octave errors back next to the target', () => {
  assert.equal(fold(72, 60), 60);
  assert.equal(fold(48.3, 60), 60.3);
  assert.equal(fold(64, 60), 64);
  assert.equal(fold(52, 60), 52);
  assert.equal(fold(57, null), 57);
});

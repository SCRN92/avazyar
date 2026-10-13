import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PhraseTake, scorePhrase } from '../js/phrase.js';

const STEP = 33; // میکروفون حدود ۳۰ بار در ثانیه نت می‌دهد

// parts: [[midi | null, ms], ...] → نمونه‌هایی مثل آنچه میکروفون می‌دهد
function sing(parts, { start = 0 } = {}) {
  const take = new PhraseTake({ start, skipMs: 0 });
  let t = start;
  for (const [midi, ms] of parts) {
    for (let end = t + ms; t < end; t += STEP) take.push(t, typeof midi === 'function' ? midi(t) : midi);
  }
  return take;
}

const tols = (n, v = 35) => new Array(n).fill(v);

test('a phrase sung on the notes scores full marks for every note', () => {
  const r = scorePhrase(sing([[50, 700], [52, 700], [54, 700]]).samples, [50, 52, 54], tols(3));
  assert.equal(r.heard, true);
  assert.equal(r.score, 100);
  assert.deepEqual(r.notes.map((x) => x.score), [100, 100, 100]);
  assert.ok(r.notes.every((x) => !x.missed && Math.abs(x.dev) <= 1 && x.ms > 500));
});

test('tempo is free: slow, fast and uneven singing score the same', () => {
  for (const durations of [[1500, 1500, 1500], [300, 300, 300], [250, 1800, 400]]) {
    const parts = [50, 52, 54].map((m, i) => [m, durations[i]]);
    assert.equal(scorePhrase(sing(parts).samples, [50, 52, 54], tols(3)).score, 100, `durations ${durations}`);
  }
});

test('one wrong note is marked on that note, not on its neighbours', () => {
  const r = scorePhrase(sing([[50, 700], [53.2, 700], [54, 700]]).samples, [50, 52, 54], tols(3));
  assert.deepEqual(r.notes.map((x) => x.score), [100, 0, 100]);
  assert.equal(r.score, 67);
  assert.ok(r.notes[1].dev > 100, 'the wrong note is reported as sharp');
});

test('a note exactly between two targets still belongs to its own place in the phrase', () => {
  const r = scorePhrase(sing([[50, 700], [51, 700], [54, 700]]).samples, [50, 52, 54], tols(3));
  assert.deepEqual(r.notes.map((x) => x.score), [100, 0, 100]);
  assert.equal(r.notes[1].missed, false);
});

test('singing slightly flat lowers the score and reports the direction', () => {
  const r = scorePhrase(sing([[49.8, 700], [51.8, 700], [53.8, 700]]).samples, [50, 52, 54], tols(3, 35));
  assert.equal(r.score, 100, '20 cents flat is inside a 35 cent tolerance');
  assert.ok(r.notes.every((x) => x.dev === -20));
  const strict = scorePhrase(sing([[49.8, 700], [51.8, 700], [53.8, 700]]).samples, [50, 52, 54], tols(3, 15));
  assert.equal(strict.score, 0);
});

test('the glide between two notes does not count against either', () => {
  // ۱۵۰ میلی‌ثانیه سُر خوردن از یک نت به نت بعد
  const glide = (from, to, t0) => (t) => from + ((to - from) * (t - t0)) / 150;
  const r = scorePhrase(sing([[50, 600], [glide(50, 52, 600), 150], [52, 600], [glide(52, 54, 1350), 150], [54, 600]]).samples, [50, 52, 54], tols(3));
  assert.ok(r.notes.every((x) => x.score >= 90), JSON.stringify(r.notes.map((x) => x.score)));
});

test('a breath between notes is allowed', () => {
  const take = sing([[50, 600], [null, 500], [52, 600], [null, 500], [54, 600]]);
  assert.equal(take.done, false, 'a half-second pause does not end the take');
  assert.equal(scorePhrase(take.samples, [50, 52, 54], tols(3)).score, 100);
});

test('the same note twice in a row is split at the breath', () => {
  const r = scorePhrase(sing([[50, 600], [null, 300], [50, 600], [52, 600]]).samples, [50, 50, 52], tols(3));
  assert.deepEqual(r.notes.map((x) => x.score), [100, 100, 100]);
  assert.ok(r.notes[0].ms > 400 && r.notes[1].ms > 400);
});

test('a whole phrase sung an octave away is folded back', () => {
  for (const octave of [-12, 12]) {
    const r = scorePhrase(sing([[50 + octave, 600], [52 + octave, 600], [54 + octave, 600]]).samples, [50, 52, 54], tols(3));
    assert.equal(r.score, 100);
  }
});

test('quarter-tones are scored like any other note', () => {
  const r = scorePhrase(sing([[50, 600], [51.5, 600], [53, 600]]).samples, [50, 51.5, 53], tols(3, 25));
  assert.equal(r.score, 100);
  const asSemitone = scorePhrase(sing([[50, 600], [52, 600], [53, 600]]).samples, [50, 51.5, 53], tols(3, 25));
  assert.deepEqual(asSemitone.notes.map((x) => x.score), [100, 0, 100], 'mi instead of mi-koron is caught');
});

test('a phrase cut short marks the unsung notes as missed', () => {
  const r = scorePhrase(sing([[50, 700], [52, 700]]).samples, [50, 52, 54, 55], tols(4));
  assert.deepEqual(r.notes.map((x) => x.score), [100, 100, 0, 0]);
  assert.deepEqual(r.notes.map((x) => x.missed), [false, false, true, true]);
  assert.equal(r.notes[3].dev, null);
  assert.equal(r.score, 50);
});

test('silence, or a short noise, is not a sung phrase', () => {
  for (const parts of [[[null, 3000]], [[50, 150], [null, 2000]]]) {
    const r = scorePhrase(sing(parts).samples, [50, 52, 54], tols(3));
    assert.equal(r.heard, false);
    assert.equal(r.score, 0);
    assert.ok(r.notes.every((x) => x.missed));
  }
  assert.equal(scorePhrase([], [50, 52, 54], tols(3)).heard, false);
});

test('each note carries a trace of the voice for the result chart', () => {
  const r = scorePhrase(sing([[50, 2000], [52.3, 2000], [54, 2000]]).samples, [50, 52, 54], tols(3));
  for (const [j, note] of r.notes.entries()) {
    assert.ok(note.trace.length >= 2 && note.trace.length <= 25, `trace has ${note.trace.length} points`);
    assert.ok(note.trace.every((p) => p.x >= 0 && p.x <= 1));
    assert.ok(note.trace.every((p, i) => i === 0 || p.x > note.trace[i - 1].x));
    assert.ok(Math.abs(note.trace.at(-1).m - [50, 52.3, 54][j]) < 0.01);
  }
});

test('a take ends after the singer stops, not during a short pause', () => {
  const take = new PhraseTake({ start: 1000 });
  let t = 1000;
  const feed = (midi, ms) => { let done = false; for (const end = t + ms; t < end; t += STEP) done = take.push(t, midi); return done; };
  assert.equal(feed(50, 200), false, 'the first quarter second is skipped');
  assert.equal(take.samples.length, 0);
  assert.equal(feed(50, 800), false);
  assert.equal(feed(null, 600), false);
  assert.equal(feed(52, 800), false);
  assert.equal(feed(null, 1000), true, 'about a second of silence ends it');
  assert.equal(take.heard, true);
  assert.equal(take.push(t, 60), true, 'nothing is added after the end');
});

test('a take gives up when nobody sings, and stops a singer who never pauses', () => {
  const silent = new PhraseTake({ start: 0 });
  let done = false;
  for (let t = 0; t < 6900; t += STEP) done = silent.push(t, null);
  assert.equal(done, false);
  for (let t = 6900; t < 7200; t += STEP) done = silent.push(t, null);
  assert.equal(done, true);
  assert.equal(silent.heard, false);

  const endless = new PhraseTake({ start: 0 });
  let at = 0;
  for (; at < 20000 && !endless.push(at, 50); at += STEP);
  assert.ok(at > 12000 && at < 12600, `stopped at ${at}`);
});

test('a frozen page does not count as seconds of singing', () => {
  const take = new PhraseTake({ start: 0, skipMs: 0 });
  take.push(0, 50);
  take.push(33, 50);
  take.push(5033, 50);
  assert.ok(take.voicedMs <= 140, `voiced ${take.voicedMs}`);
});

test('vibrato and a slow drift do not break a note into wrong notes', () => {
  const vibrato = (centre) => (t) => centre + 0.3 * Math.sin((2 * Math.PI * 5.5 * t) / 1000);
  const r = scorePhrase(sing([[vibrato(50), 900], [vibrato(52), 900], [vibrato(54), 900]]).samples, [50, 52, 54], tols(3));
  assert.deepEqual(r.notes.map((x) => x.score), [100, 100, 100]);
  // نت دوم آرام‌آرام تا ۶۰ سنت پایین می‌آید: همچنان نت دوم است، با امتیاز کمتر
  const sag = (t) => 52 - (0.6 * (t - 700)) / 1500;
  const drift = scorePhrase(sing([[50, 700], [sag, 1500], [54, 700]]).samples, [50, 52, 54], tols(3));
  assert.equal(drift.notes[0].score, 100);
  assert.equal(drift.notes[2].score, 100);
  assert.ok(drift.notes[1].score > 30 && drift.notes[1].score < 90, `drifting note scored ${drift.notes[1].score}`);
  assert.ok(drift.notes[1].dev < -15);
});

test('a step sung too small is a wrong note, not a missing one', () => {
  // نیم‌پرده‌ای که فقط ۵۵ سنت بالا رفته
  const r = scorePhrase(sing([[50, 700], [50.55, 700], [53, 700]]).samples, [50, 51, 53], tols(3));
  assert.deepEqual(r.notes.map((x) => x.missed), [false, false, false]);
  assert.deepEqual(r.notes.map((x) => x.score), [100, 0, 100]);
  assert.equal(r.notes[1].dev, -45);
});

test('a note left out in the middle is marked missed and the rest still count', () => {
  const r = scorePhrase(sing([[50, 700], [54, 700], [55, 700]]).samples, [50, 52, 54, 55], tols(4));
  assert.deepEqual(r.notes.map((x) => x.missed), [false, true, false, false]);
  assert.deepEqual(r.notes.map((x) => x.score), [100, 0, 100, 100]);
});

test('an extra note after the phrase costs the last note, not the earlier ones', () => {
  const r = scorePhrase(sing([[50, 700], [52, 700], [54, 700], [57, 700]]).samples, [50, 52, 54], tols(3));
  assert.deepEqual(r.notes.slice(0, 2).map((x) => x.score), [100, 100]);
  assert.ok(r.notes[2].score > 30 && r.notes[2].score < 70, `last note scored ${r.notes[2].score}`);
});

test('single wrong readings from the detector barely matter', () => {
  let i = 0;
  const glitchy = (centre) => () => (++i % 12 === 0 ? centre + 12 : centre);
  const r = scorePhrase(sing([[glitchy(50), 800], [glitchy(52), 800], [glitchy(54), 800]]).samples, [50, 52, 54], tols(3));
  assert.ok(r.notes.every((x) => !x.missed && x.score >= 85), JSON.stringify(r.notes.map((x) => x.score)));
});

test('scoring a long take stays fast', () => {
  const wobble = (t) => 50 + 3 * Math.sin(t / 130);
  const take = sing([[wobble, 12000]]);
  const t0 = performance.now();
  scorePhrase(take.samples, [50, 52, 54, 55, 57], tols(5));
  assert.ok(performance.now() - t0 < 200, `took ${Math.round(performance.now() - t0)} ms`);
});

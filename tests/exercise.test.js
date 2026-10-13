import test from 'node:test';
import assert from 'node:assert/strict';
import { SustainTracker } from '../js/exercise.js';

const STEP = 33; // فاصله‌ی نمونه‌ها، مثل برنامه (حدود ۳۰ بار در ثانیه)

// نمونه‌ها را با فاصله‌ی ثابت به tracker می‌دهد؛ notes آرایه‌ای از [نت یا null، مدت به میلی‌ثانیه] است
function feed(tracker, parts, t = 1000) {
  for (const [midi, ms] of parts) {
    for (let k = 0; k < ms / STEP; k++, t += STEP) {
      if (tracker.push(t, typeof midi === 'function' ? midi(k) : midi)) return t;
    }
  }
  return t;
}

test('nothing sung: not started, no result', () => {
  const tr = new SustainTracker();
  feed(tr, [[null, 3000]]);
  assert.equal(tr.started, false);
  assert.equal(tr.done, false);
  assert.equal(tr.result(), null);
});

test('a steady note ends with silence and reports its length', () => {
  const tr = new SustainTracker();
  feed(tr, [[null, 500], [57, 6000], [null, 1500]]);
  assert.equal(tr.done, true);
  const r = tr.result();
  assert.ok(Math.abs(r.secs - 6) < 0.15, `secs ${r.secs}`);
  assert.equal(r.steady, 100);
  assert.equal(r.note, 57);
});

test('a short breath gap or detector dropout does not end the note', () => {
  const tr = new SustainTracker();
  feed(tr, [[57, 2000], [null, 300], [57, 2000], [null, 1000]]);
  assert.ok(Math.abs(tr.result().secs - 4.3) < 0.15, `secs ${tr.result().secs}`);
});

test('moving to another note ends the hold at the moment of the change', () => {
  const tr = new SustainTracker();
  feed(tr, [[57, 3000], [62, 3000]]);
  assert.equal(tr.done, true);
  assert.ok(Math.abs(tr.result().secs - 3) < 0.15, `secs ${tr.result().secs}`);
  assert.equal(tr.result().note, 57);
});

test('a wobbly voice still counts but scores lower on steadiness', () => {
  const steady = new SustainTracker();
  feed(steady, [[(k) => 57 + 0.03 * Math.sin(k / 3), 4000], [null, 1000]]);
  const wobbly = new SustainTracker();
  feed(wobbly, [[(k) => 57 + 0.4 * Math.sin(k / 3), 4000], [null, 1000]]);
  assert.ok(Math.abs(wobbly.result().secs - 4) < 0.15);
  assert.ok(steady.result().steady > 90);
  assert.ok(wobbly.result().steady < 60, `steady ${wobbly.result().steady}`);
});

test('a glitch at the very start does not ruin the attempt', () => {
  const tr = new SustainTracker();
  feed(tr, [[69, 66], [57, 5000], [null, 1000]]); // دو نمونه‌ی اول یک اکتاو بالاتر
  const r = tr.result();
  assert.equal(r.note, 57);
  assert.ok(r.secs > 4.8, `secs ${r.secs}`);
  assert.ok(r.steady > 95);
});

test('very long notes stop at the limit', () => {
  const tr = new SustainTracker({ maxMs: 5000 });
  feed(tr, [[57, 20000]]);
  assert.equal(tr.done, true);
  assert.ok(Math.abs(tr.result().secs - 5) < 0.1);
});

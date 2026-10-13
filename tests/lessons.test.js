import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS, LEVEL_UP, QUARTER_MIN_TOL, voiceRange, buildNotes, levelCount, clampLevel, tolFor, levelAfter, suggestNext, earQuestion } from '../js/lessons.js';

const lesson = (id) => LESSONS.find((l) => l.id === id);
const state = (over = {}) => ({ settings: { voice: 'male' }, range: null, home: null, lessons: {}, ...over });
const MALE = { low: 45, high: 62, home: 52 };
const FEMALE = { low: 57, high: 72, home: 63 };

// مولد عدد تصادفی قابل‌تکرار
function rng(seed = 1) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

test('every lesson has the fields its kind needs', () => {
  const ids = new Set();
  for (const l of LESSONS) {
    assert.ok(l.id && l.icon && l.title && l.sub, `lesson ${l.id} is missing a basic field`);
    assert.ok(!ids.has(l.id), `duplicate id ${l.id}`);
    ids.add(l.id);
    assert.ok(['warmup', 'range', 'home', 'sustain', 'seq', 'ear'].includes(l.kind), `unknown kind ${l.kind}`);
    if (l.kind === 'seq') {
      assert.ok(l.intro && l.tols.length >= 1 && l.notes.steps.length >= 3, `seq lesson ${l.id} is incomplete`);
      assert.ok(l.tols.every((t, i) => i === 0 || t < l.tols[i - 1]), `${l.id}: each level must be stricter than the last`);
      assert.ok(l.notes.from === 'home' || Number.isInteger(l.notes.root));
    }
    if (l.kind === 'ear') assert.ok(l.intro && ['updown', 'koron'].includes(l.quiz), `ear lesson ${l.id} is incomplete`);
  }
});

test('default voice ranges when the range test has not been done', () => {
  assert.deepEqual(voiceRange(state()), { low: 45, high: 62, home: 52 });
  assert.deepEqual(voiceRange(state({ settings: { voice: 'female' } })), { low: 57, high: 72, home: 63 });
  assert.deepEqual(voiceRange(state({ range: { low: 40, high: 60, date: 1 }, home: 47 })), { low: 40, high: 60, home: 47 });
});

test('lesson notes are the same as in v0.1', () => {
  assert.deepEqual(buildNotes(lesson('match'), MALE), [52, 54, 50, 56, 53]);
  assert.deepEqual(buildNotes(lesson('scale'), MALE), [48, 50, 52, 53, 55, 53, 52, 50, 48]);
  assert.deepEqual(buildNotes(lesson('shur'), MALE), [50, 51.5, 53, 55, 53, 51.5, 50]);
  assert.deepEqual(buildNotes(lesson('scale'), FEMALE), [60, 62, 64, 65, 67, 65, 64, 62, 60]);
  assert.deepEqual(buildNotes(lesson('shur'), FEMALE), [62, 63.5, 65, 67, 65, 63.5, 62]);
});

test('home-based notes never leave the singer’s range', () => {
  const narrow = { low: 50, high: 53, home: 52 };
  for (const m of buildNotes(lesson('match'), narrow)) assert.ok(m >= 50 && m <= 53);
});

test('levels: count, clamping and tolerance', () => {
  assert.equal(levelCount(lesson('match')), 3);
  assert.equal(levelCount(lesson('updown')), 3);
  assert.equal(levelCount(lesson('koron')), 2);
  assert.equal(levelCount(lesson('warmup')), 1);
  assert.equal(clampLevel(lesson('match'), undefined), 0);
  assert.equal(clampLevel(lesson('match'), 99), 2);
  assert.equal(tolFor(lesson('match'), 0, 52), 35);
  assert.equal(tolFor(lesson('match'), 2, 52), 15);
});

test('quarter-tones are never judged more strictly than the floor', () => {
  const shur = lesson('shur');
  for (let level = 0; level < levelCount(shur); level++) {
    assert.ok(tolFor(shur, level, 51.5) >= QUARTER_MIN_TOL, `level ${level} is too strict for می کرن`);
  }
  assert.equal(tolFor(shur, 2, 50), 15, 'whole notes do tighten');
  assert.equal(tolFor(shur, 2, 51.5), 25);
});

test('a strong score moves up one level, and never past the last', () => {
  const m = lesson('match');
  assert.equal(levelAfter(m, 0, LEVEL_UP - 1), 0);
  assert.equal(levelAfter(m, 0, LEVEL_UP), 1);
  assert.equal(levelAfter(m, 1, 100), 2);
  assert.equal(levelAfter(m, 2, 100), 2);
  assert.equal(levelAfter(lesson('warmup'), 0, 100), 0);
});

test('suggestNext: first unseen lesson, then the weakest scored one', () => {
  assert.equal(suggestNext(state()).id, LESSONS[0].id);
  const done = Object.fromEntries(LESSONS.map((l) => [l.id, { best: 90, last: 90, count: 1, level: 0 }]));
  delete done.sustain;
  assert.equal(suggestNext(state({ lessons: done })).id, 'sustain');
  done.sustain = { best: 40, last: 40, count: 1, level: 0 };
  done.koron.best = 55;
  assert.equal(suggestNext(state({ lessons: done })).id, 'koron', 'unscored kinds like sustain are not suggested as "weakest"');
});

test('higher-or-lower questions: one right answer, gap within the level, both directions', () => {
  const l = lesson('updown');
  for (let level = 0; level < 3; level++) {
    const [min, max] = l.gaps[level];
    const rnd = rng(level + 1);
    let ups = 0;
    for (let i = 0; i < 200; i++) {
      const q = earQuestion(l, level, MALE, rnd);
      const gap = Math.abs(q.tones[1] - q.tones[0]);
      assert.ok(gap >= min && gap <= max, `level ${level}: gap ${gap} outside ${min}–${max}`);
      assert.equal(q.choices.filter((c) => c.right).length, 1);
      const up = q.tones[1] > q.tones[0];
      assert.equal(q.choices.find((c) => c.right).label.startsWith('بالاتر'), up);
      assert.equal(q.names.length, 2);
      ups += up;
    }
    assert.ok(ups > 60 && ups < 140, `directions are unbalanced: ${ups}/200 up`);
  }
});

test('the hardest higher-or-lower level includes quarter-tone gaps', () => {
  const rnd = rng(9);
  const gaps = new Set();
  for (let i = 0; i < 100; i++) { const q = earQuestion(lesson('updown'), 2, MALE, rnd); gaps.add(Math.abs(q.tones[1] - q.tones[0])); }
  assert.deepEqual([...gaps].sort(), [0.5, 1]);
});

test('koron questions: a whole tone or a quarter-tone less, labelled with real note names', () => {
  const l = lesson('koron');
  const rnd = rng(3);
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const q = earQuestion(l, 1, FEMALE, rnd);
    const gap = q.tones[1] - q.tones[0];
    assert.ok(gap === 1.5 || gap === 2);
    const right = q.choices.find((c) => c.right);
    assert.equal(q.choices.filter((c) => c.right).length, 1);
    assert.equal(right.label.endsWith('کرن'), gap === 1.5);
    assert.equal(right.label, q.names[1]);
    seen.add(q.choices.map((c) => c.label).join('/'));
  }
  assert.deepEqual([...seen].sort(), ['سی کرن/سی', 'لا کرن/لا', 'می کرن/می'].sort());
  // سطح اول فقط می و می کرن
  const first = new Set();
  for (let i = 0; i < 50; i++) first.add(earQuestion(l, 0, MALE, rnd).choices.map((c) => c.label).join('/'));
  assert.deepEqual([...first], ['می کرن/می']);
});

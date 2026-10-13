import test from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'avazyar.v1';

// store.js هنگام بارگذاری از localStorage می‌خواند؛ برای هر آزمون یک نسخه‌ی تازه با حافظه‌ی ساختگی می‌سازیم
let n = 0;
async function freshStore(saved) {
  const mem = new Map();
  if (saved !== undefined) mem.set(KEY, typeof saved === 'string' ? saved : JSON.stringify(saved));
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
  };
  const mod = await import(`../js/store.js?fresh=${n++}`);
  return { ...mod, saved: () => JSON.parse(mem.get(KEY)) };
}

const day = (y, m, d) => new Date(y, m - 1, d, 12);

test('starts empty at the current schema', async () => {
  const { store, SCHEMA } = await freshStore();
  const s = store.get();
  assert.equal(s.schema, SCHEMA);
  assert.deepEqual(s.settings, { mode: 'irani', voice: null, micGate: null, hideInstallHint: false });
  assert.deepEqual(s.sessions, []);
});

test('corrupt saved data falls back to an empty state instead of crashing', async () => {
  const { store } = await freshStore('{not json');
  assert.equal(store.get().settings.voice, null);
});

test('v0.1 data is migrated without losing anything', async () => {
  const old = {
    settings: { mode: 'gharbi', voice: 'female' },
    range: { low: 57, high: 72, date: 1700000000000 },
    home: 62,
    lessons: { match: { best: 80, last: 70, count: 3 } },
    sessions: [{ date: 1700000000000, lesson: 'match', score: 70 }],
    days: ['2026-10-01'],
  };
  const { store, SCHEMA } = await freshStore(old);
  const s = store.get();
  assert.equal(s.schema, SCHEMA);
  assert.equal(s.settings.mode, 'gharbi');
  assert.equal(s.settings.voice, 'female');
  assert.equal(s.settings.micGate, null);
  assert.deepEqual(s.range, old.range);
  assert.deepEqual(s.rangeHistory, [old.range], 'the existing range seeds the history');
  assert.equal(s.home, 62);
  assert.deepEqual(s.lessons, { match: { best: 80, last: 70, count: 3, level: 0 } }, 'lessons start at the first level');
  assert.deepEqual(s.sustain, []);
  assert.deepEqual(s.sessions, old.sessions);
  assert.deepEqual(s.days, old.days);
});

test('recordSession tracks best score, count and practice days', async () => {
  const { store, recordSession } = await freshStore();
  recordSession('scale', 60, day(2026, 10, 10));
  recordSession('scale', 85, day(2026, 10, 10));
  recordSession('scale', 70, day(2026, 10, 11));
  recordSession('warmup', null, day(2026, 10, 11));
  const s = store.get();
  assert.deepEqual(s.lessons.scale, { best: 85, last: 70, count: 3, level: 0 });
  assert.deepEqual(s.lessons.warmup, { best: null, last: null, count: 1, level: 0 });
  assert.deepEqual(s.days, ['2026-10-10', '2026-10-11']);
  assert.equal(s.sessions.length, 4);
});

test('session history is capped at 500', async () => {
  const { store, recordSession } = await freshStore();
  for (let i = 0; i < 510; i++) recordSession('match', i % 100, day(2026, 10, 10));
  assert.equal(store.get().sessions.length, 500);
  assert.equal(store.get().lessons.match.count, 510);
});

test('streak counts consecutive days and survives until the end of the next day', async () => {
  const { recordSession, streak } = await freshStore();
  assert.equal(streak(day(2026, 10, 10)), 0);
  recordSession('match', 50, day(2026, 10, 8));
  recordSession('match', 50, day(2026, 10, 9));
  recordSession('match', 50, day(2026, 10, 10));
  assert.equal(streak(day(2026, 10, 10)), 3);
  assert.equal(streak(day(2026, 10, 11)), 3, 'not broken yet on the following day');
  assert.equal(streak(day(2026, 10, 12)), 0, 'broken after a full missed day');
});

test('streak works across a month boundary', async () => {
  const { recordSession, streak } = await freshStore();
  recordSession('match', 50, day(2026, 9, 30));
  recordSession('match', 50, day(2026, 10, 1));
  assert.equal(streak(day(2026, 10, 1)), 2);
});

test('setRange keeps a history of range tests', async () => {
  const { store, setRange } = await freshStore();
  setRange(45, 60, day(2026, 10, 1));
  setRange(43, 64, day(2026, 11, 1));
  const s = store.get();
  assert.equal(s.range.low, 43);
  assert.equal(s.rangeHistory.length, 2);
  assert.equal(s.rangeHistory[0].high, 60);
});

test('changes are written to storage', async () => {
  const { store, saved } = await freshStore();
  store.update((s) => { s.settings.voice = 'male'; });
  assert.equal(saved().settings.voice, 'male');
});

test('a backup can be exported and restored into a clean install', async () => {
  const a = await freshStore();
  a.store.update((s) => { s.settings.voice = 'female'; s.settings.micGate = 0.01; s.home = 60; });
  a.setRange(57, 72, day(2026, 10, 1));
  a.recordSession('shur', 77, day(2026, 10, 2));
  a.setLevel('shur', 2);
  a.recordSustain(8.4, 91, day(2026, 10, 2));
  const backup = a.exportData(day(2026, 10, 3));
  assert.equal(JSON.parse(backup).app, 'avazyar');

  const b = await freshStore();
  b.importData(backup);
  assert.deepEqual(b.store.get(), a.store.get());
  assert.deepEqual(b.saved(), a.store.get(), 'the restored data is saved straight away');
});

test('invalid backups are rejected and leave current data untouched', async () => {
  const { store, importData, recordSession, SCHEMA } = await freshStore();
  recordSession('match', 90, day(2026, 10, 10));
  const before = JSON.stringify(store.get());
  for (const bad of ['', 'hello', '[]', '{"app":"other","data":{}}', '{"app":"avazyar"}', '{"app":"avazyar","data":[1]}']) {
    assert.throws(() => importData(bad), { message: 'invalid' }, `accepted: ${bad}`);
  }
  const newer = JSON.stringify({ app: 'avazyar', data: { schema: SCHEMA + 1 } });
  assert.throws(() => importData(newer), { message: 'newer' });
  assert.equal(JSON.stringify(store.get()), before);
});

test('a backup with junk fields is cleaned up on import', async () => {
  const { store, importData } = await freshStore();
  importData(JSON.stringify({
    app: 'avazyar',
    data: {
      schema: 3,
      settings: { mode: 'klingon', voice: 'robot', micGate: 'loud', extra: 1 },
      range: { low: 'x' },
      rangeHistory: [{ low: 45, high: 60, date: 1 }, null, { low: 1 }],
      home: 'do',
      sessions: [{ date: 1, lesson: 'match', score: 50 }, { lesson: 'match' }, 'x', { date: 2, lesson: 'warmup', score: null }],
      days: ['2026-10-01', 'yesterday', 5],
      lessons: { match: { best: 50, last: 50, count: 1, level: -4.5 }, bad: 'x' },
      sustain: [{ date: 1, secs: 6.2, steady: 80 }, { secs: 3 }, 'x'],
    },
  }));
  const s = store.get();
  assert.deepEqual(s.settings, { mode: 'irani', voice: null, micGate: null, hideInstallHint: false });
  assert.equal(s.range, null);
  assert.equal(s.rangeHistory.length, 1);
  assert.equal(s.home, null);
  assert.equal(s.sessions.length, 2);
  assert.deepEqual(s.days, ['2026-10-01']);
  assert.deepEqual(s.lessons, { match: { best: 50, last: 50, count: 1, level: 0 } });
  assert.deepEqual(s.sustain, [{ date: 1, secs: 6.2, steady: 80 }]);
});

test('v0.2 data gains lesson levels and an empty sustain history', async () => {
  const v2 = {
    schema: 2,
    settings: { mode: 'irani', voice: 'male', micGate: 0.004, hideInstallHint: true },
    range: { low: 45, high: 62, date: 5 },
    rangeHistory: [{ low: 45, high: 62, date: 5 }],
    home: 52,
    lessons: { shur: { best: 90, last: 90, count: 4 } },
    sessions: [{ date: 5, lesson: 'shur', score: 90 }],
    days: ['2026-10-12'],
  };
  const { store, SCHEMA } = await freshStore(v2);
  const s = store.get();
  assert.equal(s.schema, SCHEMA);
  assert.deepEqual(s.lessons.shur, { best: 90, last: 90, count: 4, level: 0 });
  assert.deepEqual(s.sustain, []);
  assert.equal(s.settings.micGate, 0.004);
  assert.equal(s.settings.hideInstallHint, true);
  assert.deepEqual(s.rangeHistory, v2.rangeHistory);
});

test('levels and sustain records are stored', async () => {
  const { store, recordSession, setLevel, recordSustain, bestSustain } = await freshStore();
  setLevel('match', 1);
  assert.equal(store.get().lessons.match, undefined, 'no level for a lesson that was never done');
  recordSession('match', 90, day(2026, 10, 10));
  setLevel('match', 1);
  recordSession('match', 60, day(2026, 10, 11));
  assert.equal(store.get().lessons.match.level, 1, 'a later session keeps the level');
  assert.equal(bestSustain(), 0);
  recordSustain(6.5, 80, day(2026, 10, 10));
  recordSustain(9.1, 70, day(2026, 10, 11));
  recordSustain(4, 95, day(2026, 10, 12));
  assert.equal(bestSustain(), 9.1);
});

test('v0.3 data gains an empty per-note record', async () => {
  const v3 = { schema: 3, settings: { mode: 'irani', voice: 'female' }, sustain: [{ date: 1, secs: 5, steady: 90 }], lessons: { match: { best: 70, last: 70, count: 1, level: 1 } }, sessions: [], days: [] };
  const { store, SCHEMA } = await freshStore(v3);
  assert.equal(store.get().schema, SCHEMA);
  assert.deepEqual(store.get().notes, {});
  assert.equal(store.get().lessons.match.level, 1);
  assert.equal(store.get().sustain.length, 1);
});

test('per-note accuracy accumulates by note name, whatever the octave', async () => {
  const { store, recordNotes, saved } = await freshStore();
  recordNotes([{ step: 50, score: 80, dev: -12 }, { step: 51.5, score: 60, dev: 20 }]);
  recordNotes([{ step: 62, score: 100, dev: -4 }, { step: 63.5, score: 40, dev: 400 }]);
  assert.deepEqual(store.get().notes, { 2: { n: 2, score: 180, dev: -16 }, 3.5: { n: 2, score: 100, dev: 120 } }, 'wild deviations are capped at 100 cents');
  assert.deepEqual(saved().notes, store.get().notes);
});

test('junk in the per-note record is dropped on load', async () => {
  const { store } = await freshStore({ schema: 4, notes: { 2: { n: 2, score: 180, dev: -16 }, 3.5: { n: 1, score: 50, dev: 0 }, x: { n: 1, score: 1, dev: 1 }, 7: { n: 0, score: 0, dev: 0 }, 9: 'no' } });
  assert.deepEqual(Object.keys(store.get().notes).sort(), ['2', '3.5']);
});

test('data from a newer version is never overwritten', async () => {
  const future = { schema: 99, settings: { voice: 'male' }, somethingNew: [1, 2, 3] };
  const { store, recordSession, saved, SCHEMA } = await freshStore(future);
  assert.equal(store.frozen, true);
  assert.equal(store.get().settings.voice, null, 'the app starts empty rather than misreading the data');
  store.update((s) => { s.settings.voice = 'female'; });
  recordSession('match', 80, day(2026, 10, 13));
  assert.deepEqual(saved(), future, 'storage is untouched');
  assert.equal(store.get().sessions.length, 1, 'the app still works in memory');
  store.reset();
  assert.equal(store.frozen, false, 'an explicit reset by the learner takes over');
  assert.equal(saved().schema, SCHEMA);
});

test('ordinary and corrupt data do not freeze the store', async () => {
  assert.equal((await freshStore()).store.frozen, false);
  assert.equal((await freshStore('{broken')).store.frozen, false);
  assert.equal((await freshStore({ settings: { voice: 'male' } })).store.frozen, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, weekSummary, lessonTrends, rangeGrowth, noteStats } from '../js/stats.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 10, 13, 18); // سه‌شنبه
const state = (over = {}) => ({ days: [], sessions: [], lessons: {}, rangeHistory: [], notes: {}, ...over });
const session = (date, lesson, score) => ({ date, lesson, score });

test('dayKey is the local calendar date', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(dayKey(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
});

test('week: seven days ending today, with practised days marked', () => {
  const w = weekSummary(state({ days: ['2026-10-07', '2026-10-11', '2026-10-13', '2026-10-01'] }), NOW);
  assert.deepEqual(w.days.map((d) => d.key), ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']);
  assert.deepEqual(w.days.map((d) => d.practised), [true, false, false, false, true, false, true]);
  assert.deepEqual(w.days.map((d) => d.today), [false, false, false, false, false, false, true]);
  assert.equal(w.days[6].weekday, new Date(NOW).getDay());
  assert.equal(w.days[0].weekday, new Date(at(2026, 10, 7)).getDay());
});

test('week: counts and averages for this week and the one before', () => {
  const sessions = [
    session(at(2026, 9, 20), 'match', 10), // قدیمی‌تر از دو هفته
    session(at(2026, 9, 30), 'match', 40), // هفته‌ی قبل
    session(at(2026, 10, 6, 23), 'match', 60), // هفته‌ی قبل (آخرین ساعتش)
    session(at(2026, 10, 7, 0), 'warmup', null), // این هفته (اولین ساعتش)
    session(at(2026, 10, 12), 'match', 70),
    session(at(2026, 10, 13, 9), 'scale', 90),
    session(at(2026, 10, 13, 20), 'scale', 80), // کمی بعد از «الان»: اگر ساعت دستگاه عقب رفته باشد هم حساب می‌شود
  ];
  const w = weekSummary(state({ sessions }), NOW);
  assert.equal(w.count, 4);
  assert.equal(w.prevCount, 2);
  assert.equal(w.avg, 80, 'unscored sessions are left out of the average');
  assert.equal(w.prevAvg, 50);
});

test('week: empty state', () => {
  const w = weekSummary(state(), NOW);
  assert.deepEqual([w.count, w.prevCount, w.avg, w.prevAvg], [0, 0, null, null]);
  assert.equal(w.days.filter((d) => d.practised).length, 0);
});

test('week: works across a month boundary', () => {
  const w = weekSummary(state({ days: ['2026-10-31'] }), at(2026, 11, 2));
  assert.equal(w.days[0].key, '2026-10-27');
  assert.equal(w.days[4].practised, true);
});

test('lesson trends: last ten scores, and a direction once there is enough to judge', () => {
  const LESSONS = [{ id: 'match' }, { id: 'scale' }, { id: 'shur' }, { id: 'koron' }];
  const scores = (id, list) => list.map((sc, i) => session(i, id, sc));
  const s = state({
    sessions: [
      ...scores('match', [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100, 100]),
      ...scores('scale', [90, 85, 60, 55]),
      ...scores('shur', [70, 72, 71, 73]),
      ...scores('koron', [50, null, 60]),
    ],
    lessons: { match: { best: 100 }, scale: { best: 90 }, shur: { best: 73 }, koron: { best: 60 } },
  });
  const t = Object.fromEntries(lessonTrends(s, LESSONS).map((x) => [x.id, x]));
  assert.deepEqual(t.match.scores, [30, 40, 50, 60, 70, 80, 90, 95, 100, 100]);
  assert.equal(t.match.direction, 'up');
  assert.equal(t.match.last, 100);
  assert.equal(t.scale.direction, 'down');
  assert.equal(t.shur.direction, 'flat');
  assert.deepEqual(t.koron.scores, [50, 60]);
  assert.equal(t.koron.direction, null, 'two scores are too few to call a trend');
  assert.equal(t.koron.best, 60);
});

test('lesson trends: lessons with no scored session are left out', () => {
  assert.deepEqual(lessonTrends(state({ sessions: [session(1, 'warmup', null)] }), [{ id: 'warmup' }, { id: 'match' }]), []);
});

test('range growth compares the first and latest test', () => {
  assert.equal(rangeGrowth(state()), null);
  assert.equal(rangeGrowth(state({ rangeHistory: [{ low: 45, high: 60, date: 1 }] })), null);
  const g = rangeGrowth(state({ rangeHistory: [{ low: 45, high: 60, date: 1 }, { low: 44, high: 62, date: 2 }, { low: 43, high: 64, date: 3 }] }));
  assert.equal(g.tests, 3);
  assert.equal(g.gained, 6);
  assert.equal(g.last.high, 64);
});

test('note accuracy: weakest first, with a tendency only when it is consistent', () => {
  const notes = {
    2: { n: 4, score: 360, dev: -8 }, // میانگین ۹۰٪، انحراف −۲
    3.5: { n: 3, score: 150, dev: 60 }, // ۵۰٪، +۲۰
    5: { n: 2, score: 140, dev: -40 }, // ۷۰٪، −۲۰
    7: { n: 1, score: 30, dev: 50 }, // فقط یک بار
  };
  const list = noteStats(state({ notes }));
  assert.deepEqual(list.map((x) => x.step), [7, 3.5, 5, 2]);
  assert.deepEqual(list.map((x) => x.score), [30, 50, 70, 90]);
  assert.deepEqual(list.map((x) => x.tendency), [null, 'sharp', 'flat', 'true']);
  assert.equal(list[1].dev, 20);
});

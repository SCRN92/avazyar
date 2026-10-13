import test from 'node:test';
import assert from 'node:assert/strict';
import { sparkline, rangeChart } from '../js/charts.js';

const nums = (svg, re) => [...svg.matchAll(re)].map((m) => Number(m[1]));

test('sparkline: one point per value, inside the box, newest highlighted', () => {
  const svg = sparkline([20, 60, 100, 80], { label: 'امتیازها', goal: 80 });
  const pts = svg.match(/points="([^"]+)"/)[1].split(' ').map((p) => p.split(',').map(Number));
  assert.equal(pts.length, 4);
  for (const [x, y] of pts) assert.ok(x >= 0 && x <= 96 && y >= 0 && y <= 28, `point ${x},${y} is outside`);
  assert.ok(pts[2][1] < pts[1][1] && pts[1][1] < pts[0][1], 'higher scores are drawn higher');
  assert.ok(pts[0][0] < pts[3][0], 'time runs left to right');
  const [cx] = nums(svg, /<circle[^>]*cx="([\d.]+)"/g);
  assert.equal(cx, pts[3][0], 'the dot sits on the latest value');
  assert.match(svg, /class="spark-goal"/);
  assert.match(svg, /role="img" aria-label="امتیازها"/);
});

test('sparkline: a single value is just a dot, and zeros do not break it', () => {
  const one = sparkline([50], { label: 'x' });
  assert.doesNotMatch(one, /polyline/);
  assert.match(one, /<circle/);
  assert.doesNotMatch(sparkline([0, 0], { label: 'x', max: 0 }), /NaN|Infinity/);
});

test('sparkline: values above the default maximum still fit', () => {
  const svg = sparkline([3, 12.5, 8], { label: 'ثانیه', max: 0 });
  for (const y of svg.match(/points="([^"]+)"/)[1].split(' ').map((p) => Number(p.split(',')[1]))) assert.ok(y >= 0 && y <= 28);
});

test('sparkline and range chart never use inline styles (the page security policy forbids them)', () => {
  const range = rangeChart([{ low: 45, high: 60, title: 'a' }, { low: 43, high: 64, title: 'b' }], { label: 'l', lowName: 'لا', highName: 'می' });
  assert.doesNotMatch(sparkline([1, 2], { label: 'x' }) + range, /style=/);
});

test('range chart: one bar per test, latest emphasised, wider range drawn taller', () => {
  const svg = rangeChart(
    [{ low: 45, high: 60, title: 'اول' }, { low: 44, high: 62, title: 'دوم' }, { low: 43, high: 64, title: 'سوم' }],
    { label: 'محدوده', lowName: 'سل', highName: 'می' },
  );
  assert.equal((svg.match(/<rect/g) || []).length, 3);
  assert.equal((svg.match(/class="bar-old"/g) || []).length, 2);
  assert.equal((svg.match(/class="bar-now"/g) || []).length, 1);
  const heights = nums(svg, /height="([\d.]+)" rx/g);
  assert.ok(heights[0] < heights[1] && heights[1] < heights[2]);
  const ys = nums(svg, /<rect[^>]* y="([\d.]+)"/g);
  assert.ok(ys[2] < ys[0], 'a higher top note is drawn higher up');
  for (const [i, y] of ys.entries()) assert.ok(y >= 0 && y + heights[i] <= 130, 'bars stay inside the chart');
  assert.match(svg, /<title>سوم<\/title>/);
  assert.match(svg, />می<\/text>/);
  assert.match(svg, />سل<\/text>/);
});

test('range chart: text is escaped', () => {
  assert.doesNotMatch(rangeChart([{ low: 1, high: 2, title: '<b>' }, { low: 1, high: 3, title: 'x' }], { label: '"q"', lowName: '<', highName: '>' }), /<b>|aria-label=""q""/);
});

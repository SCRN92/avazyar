// نمودارهای کوچک به‌صورت رشته‌ی SVG. زمان از چپ به راست است (مثل نمودار زنده‌ی صدا).
// رنگ‌ها از کلاس‌های css می‌آیند؛ اینجا style درون‌خطی نمی‌گذاریم چون سیاست امنیتی صفحه اجازه نمی‌دهد.

import { fa } from './notes.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r1 = (v) => Math.round(v * 10) / 10;

// خط روند کوچک: خط خاکستری، آخرین نقطه پررنگ. label متن جایگزین برای صفحه‌خوان است.
export function sparkline(values, { label, max = 100, goal = null, w = 96, h = 28 } = {}) {
  const pad = 4;
  const top = Math.max(max, ...values, 1);
  const x = (i) => (values.length === 1 ? w - pad : pad + (i * (w - 2 * pad)) / (values.length - 1));
  const y = (v) => r1(h - pad - (v / top) * (h - 2 * pad));
  const pts = values.map((v, i) => `${r1(x(i))},${y(v)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
    ${goal != null ? `<line class="spark-goal" x1="0" x2="${w}" y1="${y(goal)}" y2="${y(goal)}"/>` : ''}
    ${values.length > 1 ? `<polyline class="spark-line" points="${pts}"/>` : ''}
    <circle class="spark-dot" cx="${r1(x(values.length - 1))}" cy="${y(values.at(-1))}" r="4"/>
  </svg>`;
}

// محدوده‌ی صدا در هر تست: یک ستون شناور از پایین‌ترین تا بالاترین نت. آخرین تست پررنگ است و نام نت‌هایش نوشته می‌شود.
// bars: [{ low, high, title }]
export function rangeChart(bars, { label, lowName, highName, w = 300, h = 130 } = {}) {
  const padTop = 20, padBottom = 20, labelW = 56;
  const lo = Math.min(...bars.map((b) => b.low));
  const hi = Math.max(...bars.map((b) => b.high));
  const y = (m) => r1(padTop + ((hi - m) / Math.max(1, hi - lo)) * (h - padTop - padBottom));
  const slot = (w - labelW) / bars.length;
  const bw = Math.min(22, slot - 2);
  const rects = bars.map((b, i) => {
    const cx = slot * i + slot / 2;
    return `<rect class="${i === bars.length - 1 ? 'bar-now' : 'bar-old'}" x="${r1(cx - bw / 2)}" y="${y(b.high)}" width="${r1(bw)}" height="${r1(Math.max(4, y(b.low) - y(b.high)))}" rx="4"><title>${esc(b.title)}</title></rect>`;
  }).join('');
  const last = bars.at(-1);
  const tx = w - labelW + 6;
  return `<svg class="range-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
    ${rects}
    <text class="chart-label" x="${tx}" y="${y(last.high) + 4}">${esc(highName)}</text>
    <text class="chart-label" x="${tx}" y="${Math.max(y(last.low) + 4, y(last.high) + 18)}">${esc(lowName)}</text>
  </svg>`;
}

// نتیجه‌ی یک جمله: برای هر نت یک ستون. نوار = نت درست با دقت لازمش، خط = صدای کاربر روی همان نت.
// بالای هر ستون امتیاز نوشته می‌شود و پایینش نام نت، تا نتیجه فقط به رنگ وابسته نباشد.
// notes: [{ name, target, tol, score, missed, trace: [{ x, m }] }]
export function phraseChart(notes, { label, w = 300, h = 132 } = {}) {
  const top = 24, bottom = 24, pad = 7;
  const lo = Math.min(...notes.map((n) => n.target)) - 1.5;
  const hi = Math.max(...notes.map((n) => n.target)) + 1.5;
  const y = (m) => r1(top + ((hi - Math.min(hi, Math.max(lo, m))) / (hi - lo)) * (h - top - bottom));
  const cw = w / notes.length;
  const cols = notes.map((n, i) => {
    const x0 = r1(i * cw);
    const cx = r1(x0 + cw / 2);
    const t = n.tol / 100;
    const level = n.missed ? 'ph-missed' : n.score >= 80 ? 'ph-good' : n.score >= 50 ? 'ph-mid' : 'ph-low';
    const pts = n.trace.map((p) => `${r1(x0 + pad + p.x * (cw - 2 * pad))},${y(p.m)}`).join(' ');
    return `<g class="${level}">
      <title>${esc(n.name)}: ${n.missed ? 'خوانده نشد' : `${fa(n.score)}٪`}</title>
      <rect class="ph-hit" x="${x0}" y="0" width="${r1(cw)}" height="${h}"/>
      ${i ? `<line class="ph-sep" x1="${x0}" x2="${x0}" y1="${top - 6}" y2="${h - bottom + 6}"/>` : ''}
      <rect class="ph-band" x="${r1(x0 + 2)}" y="${y(n.target + t)}" width="${r1(cw - 4)}" height="${r1(y(n.target - t) - y(n.target + t))}" rx="3"/>
      <line class="ph-target" x1="${r1(x0 + 2)}" x2="${r1(x0 + cw - 2)}" y1="${y(n.target)}" y2="${y(n.target)}"/>
      ${n.trace.length > 1 ? `<polyline class="ph-sung" points="${pts}"/>` : ''}
      <text class="chart-label ph-score" x="${cx}" y="14" text-anchor="middle">${n.missed ? '–' : `${fa(n.score)}٪`}</text>
      <text class="chart-label" x="${cx}" y="${h - 6}" text-anchor="middle">${esc(n.name)}</text>
    </g>`;
  }).join('');
  return `<svg class="phrase-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${cols}</svg>`;
}

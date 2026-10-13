// نمودارهای کوچک به‌صورت رشته‌ی SVG. زمان از چپ به راست است (مثل نمودار زنده‌ی صدا).
// رنگ‌ها از کلاس‌های css می‌آیند؛ اینجا style درون‌خطی نمی‌گذاریم چون سیاست امنیتی صفحه اجازه نمی‌دهد.

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

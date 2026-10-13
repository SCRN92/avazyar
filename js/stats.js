// آمار پیشرفت از روی داده‌های ذخیره‌شده؛ بدون وابستگی به صفحه یا حافظه (تا قابل آزمون باشد)

export const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

// نیمه‌شبِ n روز قبل از امروز (به وقت محلی)
function daysAgo(now, n) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

// هفت روز اخیر (امروز آخرین خانه) و مقایسه با هفت روز قبلش
export function weekSummary(state, now = Date.now()) {
  const practised = new Set(state.days);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = daysAgo(now, i);
    days.push({ key: dayKey(d), weekday: d.getDay(), practised: practised.has(dayKey(d)), today: i === 0 });
  }
  const from = daysAgo(now, 6).getTime();
  const prevFrom = daysAgo(now, 13).getTime();
  const cur = state.sessions.filter((x) => x.date >= from);
  const prev = state.sessions.filter((x) => x.date >= prevFrom && x.date < from);
  const avg = (list) => {
    const m = mean(list.filter((x) => x.score != null).map((x) => x.score));
    return m == null ? null : Math.round(m);
  };
  return { days, count: cur.length, prevCount: prev.length, avg: avg(cur), prevAvg: avg(prev) };
}

// روند هر درس امتیازدار: ده امتیاز آخر، و اینکه نیمه‌ی دوم از نیمه‌ی اول بهتر بوده یا نه
export function lessonTrends(state, lessons, keep = 10) {
  const out = [];
  for (const lesson of lessons) {
    const scores = state.sessions.filter((x) => x.lesson === lesson.id && x.score != null).map((x) => x.score).slice(-keep);
    if (!scores.length) continue;
    let direction = null; // null یعنی هنوز برای قضاوت زود است
    if (scores.length >= 4) {
      const half = Math.floor(scores.length / 2);
      const change = mean(scores.slice(-half)) - mean(scores.slice(0, half));
      direction = change >= 5 ? 'up' : change <= -5 ? 'down' : 'flat';
    }
    out.push({ id: lesson.id, scores, last: scores.at(-1), best: state.lessons[lesson.id]?.best ?? Math.max(...scores), direction });
  }
  return out;
}

// تغییر پهنای محدوده‌ی صدا از اولین تست تا آخرین
export function rangeGrowth(state) {
  const h = state.rangeHistory;
  if (h.length < 2) return null;
  const width = (r) => r.high - r.low;
  return { tests: h.length, first: h[0], last: h.at(-1), gained: width(h.at(-1)) - width(h[0]) };
}

const NEAR = 8; // تا این اندازه (سنت) انحراف میانگین را «دقیق» حساب می‌کنیم

// دقت روی هر نت (بدون توجه به اکتاو): ضعیف‌ترین اول. tendency فقط وقتی هست که نت دست‌کم دو بار خوانده شده باشد.
export function noteStats(state) {
  return Object.entries(state.notes)
    .map(([key, v]) => {
      const dev = v.dev / v.n;
      return {
        step: Number(key),
        n: v.n,
        score: Math.round(v.score / v.n),
        dev: Math.round(dev),
        tendency: v.n < 2 ? null : dev > NEAR ? 'sharp' : dev < -NEAR ? 'flat' : 'true',
      };
    })
    .sort((a, b) => a.score - b.score || a.step - b.step);
}

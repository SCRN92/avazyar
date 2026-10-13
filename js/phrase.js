// جمله: چند نت پشت‌سرهم در یک نفس. گرفتن صدا و امتیازدهی، جدا از صفحه و میکروفون (تا قابل آزمون باشد).
// آواز ایرانی وزن آزاد دارد؛ پس سرعت خواندن آزاد است و فقط زیر و بمی سنجیده می‌شود، نه زمان‌بندی.

const MAX_DT = 100; // فاصله‌ی دو نمونه را بیشتر از این حساب نمی‌کنیم (مثل وقتی که صفحه لحظه‌ای گیر می‌کند)
const HEARD_MS = 300; // کمتر از این، صدا را «خوانده‌شده» حساب نمی‌کنیم
const MIN_NOTE_MS = 150; // نتی که کمتر از این خوانده شده، جا افتاده حساب می‌شود
const SPLIT = 0.4; // نیم‌پرده؛ اگر صدا بیشتر از این جابه‌جا شود و همان‌جا بماند، نت عوض شده
const GAP_MS = 150; // سکوت بلندتر از این (نفس) هم نت را جدا می‌کند
const MIN_PIECE_MS = 100; // تکه‌های کوتاه‌تر، صدای در راهِ بین دو نت هستند
const CAP = 2; // نیم‌پرده؛ خطای بزرگ‌تر از این در هم‌ترازی هزینه‌ی بیشتری ندارد
const WEIGHT_MS = 500; // نتِ کشیده در هم‌ترازی سنگین‌تر از این حساب نمی‌شود
const SKIP = 1.2 * WEIGHT_MS; // نتی که بیش از حدود ۱٫۲ نیم‌پرده دور باشد «جاافتاده» حساب می‌شود، نه «غلط»
const TRACE_POINTS = 24;

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// یک بار خواندن جمله: از لحظه‌ی start گوش می‌دهد و با سکوتِ بعد از خواندن، یا رسیدن به سقف زمان، تمام می‌شود.
// هر بار push(t, midi) با زمان (میلی‌ثانیه) و نت تشخیص‌داده‌شده (یا null برای سکوت) صدا زده می‌شود.
export class PhraseTake {
  constructor({ start = 0, skipMs = 250, endGapMs = 900, waitMs = 7000, maxMs = 12000 } = {}) {
    this.start = start;
    this.skipMs = skipMs; // پژواک نت مرجع در لحظه‌ی اول را نمی‌شنویم
    this.endGapMs = endGapMs;
    this.waitMs = waitMs;
    this.maxMs = maxMs;
    this.samples = []; // { t, midi, dt }
    this.voicedMs = 0;
    this.first = null;
    this.last = null;
    this.prev = null;
    this.done = false;
  }

  get heard() {
    return this.voicedMs >= HEARD_MS;
  }

  push(t, midi) {
    if (this.done) return true;
    if (t - this.start < this.skipMs) return false;
    const dt = this.prev == null ? 0 : Math.min(MAX_DT, t - this.prev);
    this.prev = t;
    this.samples.push({ t, midi, dt });
    if (midi != null) {
      this.voicedMs += dt;
      this.first ??= t;
      this.last = t;
    }
    // مکث کوتاه بین نت‌ها (نفس) جمله را تمام نمی‌کند؛ سکوت طولانی‌تر یعنی خواندن تمام شده
    if (this.heard ? t - this.last >= this.endGapMs : t - this.start >= this.waitMs) this.done = true;
    if (this.first != null && t - this.first >= this.maxMs) this.done = true;
    return this.done;
  }
}

const missed = (target) => ({ target, score: 0, dev: null, ms: 0, missed: true, trace: [] });

// صدای خوانده‌شده را به تکه‌هایی می‌شکند که در هر کدام زیر و بمی تقریباً ثابت است (هر تکه یک نتِ خوانده‌شده)
function pieces(frames) {
  const out = [];
  let cur = null;
  const far = (f) => Math.abs(f.p - cur.centre) > SPLIT;
  for (const [i, f] of frames.entries()) {
    const next = frames[i + 1];
    const gap = i > 0 && f.t - frames[i - 1].t > GAP_MS;
    // یک نمونه‌ی پرت نت را عوض نمی‌کند؛ باید نمونه‌ی بعدی هم همان‌جا باشد
    const moved = cur && far(f) && (!next || next.t - f.t > GAP_MS || far(next));
    if (!cur || gap || moved) out.push((cur = { frames: [], centre: f.p }));
    cur.frames.push(f);
    cur.centre = median(cur.frames.map((x) => x.p));
  }
  for (const piece of out) piece.ms = piece.frames.reduce((a, f) => a + f.dt, 0);
  return out.filter((piece) => piece.ms >= MIN_PIECE_MS);
}

// صدای خوانده‌شده را به ترتیب روی نت‌های جمله می‌نشاند و به هر نت امتیاز می‌دهد.
// samples: خروجی PhraseTake؛ targets: نت‌های جمله؛ tols: دقت لازم هر نت به سنت.
// خروجی: { heard, score, notes: [{ target, score, dev, ms, missed, trace: [{ x, m }] }] }
// dev فاصله‌ی میانه از نت به سنت است (مثبت یعنی بالاتر)؛ trace مسیر صدا روی همان نت با x از ۰ تا ۱.
export function scorePhrase(samples, targets, tols) {
  const voiced = samples.filter((s) => s.midi != null && s.dt > 0);
  const k = targets.length;
  const nothing = { heard: false, score: 0, notes: targets.map(missed) };
  if (voiced.reduce((a, s) => a + s.dt, 0) < HEARD_MS) return nothing;

  // اگر کاربر کل جمله را یک اکتاو بالاتر یا پایین‌تر خوانده، همه را با هم به اکتاو جمله برمی‌گردانیم
  const shift = 12 * Math.round((median(targets) - median(voiced.map((s) => s.midi))) / 12);
  const sung = pieces(voiced.map((s) => ({ t: s.t, dt: s.dt, p: s.midi + shift })));
  const n = sung.length;
  if (!n) return nothing;

  // هم‌ترازی: تکه‌ها به ترتیب روی نت‌ها می‌نشینند. چند تکه می‌توانند مال یک نت باشند، و نتی که خوانده نشده جا می‌افتد.
  const cost = (i, j) => Math.min(sung[i].ms, WEIGHT_MS) * Math.min(Math.abs(sung[i].centre - targets[j]), CAP);
  const best = Array.from({ length: n }, () => new Float64Array(k));
  const from = Array.from({ length: n }, () => new Int8Array(k));
  for (let j = 0; j < k; j++) best[0][j] = SKIP * j + cost(0, j);
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < k; j++) {
      let low = Infinity;
      for (let prev = 0; prev <= j; prev++) {
        const c = best[i - 1][prev] + SKIP * Math.max(0, j - prev - 1);
        if (c < low) { low = c; from[i][j] = prev; }
      }
      best[i][j] = low + cost(i, j);
    }
  }
  let end = 0;
  for (let j = 1; j < k; j++) {
    if (best[n - 1][j] + SKIP * (k - 1 - j) < best[n - 1][end] + SKIP * (k - 1 - end)) end = j;
  }
  const owner = new Array(n);
  for (let i = n - 1, j = end; i >= 0; j = from[i][j], i--) owner[i] = j;

  const notes = targets.map((target, j) => {
    const frames = sung.filter((_, i) => owner[i] === j).flatMap((piece) => piece.frames);
    const ms = frames.reduce((a, f) => a + f.dt, 0);
    if (ms < MIN_NOTE_MS) return missed(target);
    // سر و ته هر نت، صدا در راه رسیدن به نت یا رفتن به نت بعدی است؛ آن را در امتیاز حساب نمی‌کنیم
    const lead = Math.min(120, ms * 0.25);
    const tail = Math.min(80, ms * 0.15);
    let at = 0, kept = 0, inTol = 0;
    const devs = [];
    const trace = [];
    for (const f of frames) {
      const mid = at + f.dt / 2;
      at += f.dt;
      trace.push({ x: mid / ms, m: f.p });
      if (mid < lead || mid > ms - tail) continue;
      const diff = (f.p - target) * 100;
      kept += f.dt;
      devs.push(diff);
      if (Math.abs(diff) <= tols[j]) inTol += f.dt;
    }
    if (!kept) return missed(target);
    const every = Math.ceil(trace.length / TRACE_POINTS);
    return {
      target,
      score: Math.round((100 * inTol) / kept),
      dev: Math.round(median(devs)),
      ms: Math.round(ms),
      missed: false,
      trace: trace.filter((_, i) => i % every === 0 || i === trace.length - 1),
    };
  });
  return { heard: true, score: Math.round(notes.reduce((a, x) => a + x.score, 0) / k), notes };
}

// منطق تمرین‌ها، جدا از صفحه و میکروفون (تا قابل آزمون باشد)

const ONSET = 8; // تعداد نمونه‌های اول که نت شروع از آن‌ها تعیین می‌شود

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// نگه داشتن یک نت: با اولین صدا شروع می‌شود و با سکوت، عوض شدن نت، یا رسیدن به سقف زمان تمام می‌شود.
// هر بار push(t, midi) با زمان (میلی‌ثانیه) و نت تشخیص‌داده‌شده (یا null برای سکوت) صدا زده می‌شود.
export class SustainTracker {
  constructor({ band = 0.75, gapMs = 500, driftMs = 400, maxMs = 30000 } = {}) {
    this.band = band; // بیشترین فاصله از نت شروع (نیم‌پرده) که هنوز «همان نت» حساب می‌شود
    this.gapMs = gapMs;
    this.driftMs = driftMs;
    this.maxMs = maxMs;
    this.held = []; // نت‌های داخل محدوده
    this.start = null;
    this.last = null; // آخرین لحظه‌ای که روی نت بود
    this.center = null;
    this.done = false;
  }

  get started() {
    return this.start != null;
  }

  get ms() {
    return this.started ? this.last - this.start : 0;
  }

  push(t, midi) {
    if (this.done) return true;
    if (!this.started) {
      if (midi == null) return false;
      this.start = this.last = t;
      this.center = midi;
      this.held.push(midi);
      return false;
    }
    if (midi != null) {
      if (this.held.length < ONSET) {
        // نت شروع را از چند نمونه‌ی اول می‌گیریم تا لغزش لحظه‌ی شروع صدا اثر نگذارد
        this.held.push(midi);
        this.last = t;
        this.center = median(this.held);
        if (this.held.length === ONSET) this.held = this.held.filter((m) => Math.abs(m - this.center) <= this.band);
      } else if (Math.abs(midi - this.center) <= this.band) {
        this.held.push(midi);
        this.last = t;
      }
    }
    // سکوت کوتاه (نفس یا خطای لحظه‌ای تشخیص) بخشیده می‌شود؛ بیرون ماندن طولانی‌تر یعنی نت رها یا عوض شده
    const away = t - this.last;
    if (away > (midi == null ? this.gapMs : this.driftMs) || this.ms >= this.maxMs) this.done = true;
    return this.done;
  }

  // مدت (ثانیه) و یکنواختی (۰ تا ۱۰۰؛ از پراکندگی زیر و بمی صدا)
  result() {
    if (!this.started) return null;
    const mean = this.held.reduce((a, b) => a + b, 0) / this.held.length;
    const sd = Math.sqrt(this.held.reduce((a, b) => a + (b - mean) ** 2, 0) / this.held.length);
    return {
      secs: Math.round(this.ms / 100) / 10,
      steady: Math.max(0, Math.min(100, Math.round(100 - sd * 100 * 2))),
      note: Math.round(median(this.held) * 2) / 2,
    };
  }
}

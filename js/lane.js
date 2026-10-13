import { stepName } from './notes.js';

const LABEL_W = 56;

// نمودار زنده‌ی صدا: محور افقی زمان، محور عمودی زیر و بمی
export class Lane {
  constructor(canvas, { span = 8, windowMs = 6000, mode = 'irani' } = {}) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.span = span;
    this.win = windowMs;
    this.mode = mode;
    this.pts = [];
    this.targets = []; // نت‌های هدف: [{ m, tol }]
    this.center = null;
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.c.width = Math.round(r.width * dpr);
    this.c.height = Math.round(r.height * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setTarget(m, tol) {
    this.setTargets(m == null ? [] : [{ m, tol }]);
  }

  // چند نت هدف با هم (برای جمله‌ها)؛ نمودار وسط آن‌ها می‌ایستد
  setTargets(list) {
    this.targets = list;
    if (!list.length) return;
    const ms = list.map((x) => x.m);
    this.center = (Math.min(...ms) + Math.max(...ms)) / 2;
  }

  push(t, m) {
    this.pts.push({ t, m });
    const cut = t - this.win;
    while (this.pts.length && this.pts[0].t < cut) this.pts.shift();
    if (!this.targets.length && m != null) {
      this.center = this.center == null ? m : this.center + (m - this.center) * 0.08;
    }
  }

  clear() {
    this.pts = [];
  }

  start() {
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
  }

  y(m) {
    return this.h / 2 - (m - this.center) * (this.h / this.span);
  }

  draw() {
    if (!this.w) return this.resize();
    const { g, w, h } = this;
    const cs = getComputedStyle(this.c);
    const col = (n) => cs.getPropertyValue(n).trim();
    if (this.center == null) this.center = 57;
    g.clearRect(0, 0, w, h);

    // خطوط نت‌ها
    const step = this.mode === 'irani' ? 0.5 : 1;
    const lo = Math.floor(this.center - this.span / 2) - 1;
    const hi = Math.ceil(this.center + this.span / 2) + 1;
    g.font = '12px Vazirmatn, Tahoma, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    for (let s = lo; s <= hi; s += step) {
      const y = this.y(s);
      if (y < -8 || y > h + 8) continue;
      const quarter = !Number.isInteger(s);
      g.strokeStyle = col(quarter ? '--grid-soft' : '--grid');
      g.setLineDash(quarter ? [3, 5] : []);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(LABEL_W, y);
      g.lineTo(w, y);
      g.stroke();
      // ربع‌پرده‌ها فقط وقتی اسم می‌گیرند که خودشان نت هدف باشند، تا برچسب‌ها شلوغ نشوند
      // اگر جا تنگ است، فقط نت‌های طبیعی (بدون دیز) اسم می‌گیرند
      const crowded = h / this.span < 16;
      const isTarget = this.targets.some((x) => x.m === s);
      // وقتی چند نت هدف هست، فقط همان‌ها اسم می‌گیرند
      const label = isTarget || (this.targets.length < 2 && !quarter && !(crowded && stepName(s).fa.includes('دیز')));
      if (label) {
        g.fillStyle = col(isTarget ? '--accent-ink' : '--muted');
        g.fillText(stepName(s).fa, 4, y);
      }
    }
    g.setLineDash([]);

    // نوار هدف
    for (const target of this.targets) {
      const t = target.tol / 100;
      const y1 = this.y(target.m + t);
      const y2 = this.y(target.m - t);
      g.fillStyle = col('--band');
      g.fillRect(LABEL_W, y1, w - LABEL_W, y2 - y1);
      g.strokeStyle = col('--accent');
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(LABEL_W, this.y(target.m));
      g.lineTo(w, this.y(target.m));
      g.stroke();
    }

    // مسیر صدای کاربر
    const now = performance.now();
    const x = (t) => LABEL_W + (w - LABEL_W - 14) * (1 - (now - t) / this.win);
    const clampY = (v) => Math.max(5, Math.min(h - 5, v));
    const ok = (m) => !this.targets.length || this.targets.some((x) => Math.abs(m - x.m) * 100 <= x.tol);
    g.lineWidth = 3;
    g.lineCap = 'round';
    let prev = null;
    for (const p of this.pts) {
      if (p.m == null) { prev = null; continue; }
      const px = x(p.t);
      const py = clampY(this.y(p.m));
      if (prev) {
        g.strokeStyle = col(ok(p.m) ? '--good' : '--warn');
        g.beginPath();
        g.moveTo(prev.x, prev.y);
        g.lineTo(px, py);
        g.stroke();
      }
      prev = { x: px, y: py };
    }
    const last = this.pts[this.pts.length - 1];
    if (last && last.m != null && now - last.t < 200) {
      // روی نت: دایره‌ی توپر؛ خارج از نت: دایره‌ی توخالی (تا فقط به رنگ وابسته نباشد)
      const on = ok(last.m);
      g.fillStyle = col(on ? '--good' : '--surface');
      g.strokeStyle = col(on ? '--good' : '--warn');
      g.beginPath();
      g.arc(x(last.t), clampY(this.y(last.m)), on ? 7 : 6, 0, Math.PI * 2);
      g.fill();
      if (!on) g.stroke();
    }
  }
}

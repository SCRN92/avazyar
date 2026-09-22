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
    this.target = null;
    this.tol = 35;
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
    this.target = m;
    this.tol = tol;
    if (m != null) this.center = m;
  }

  push(t, m) {
    this.pts.push({ t, m });
    const cut = t - this.win;
    while (this.pts.length && this.pts[0].t < cut) this.pts.shift();
    if (this.target == null && m != null) {
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
      const label = s === this.target || (!quarter && !(crowded && stepName(s).fa.includes('دیز')));
      if (label) {
        g.fillStyle = col(s === this.target ? '--accent' : '--muted');
        g.fillText(stepName(s).fa, 4, y);
      }
    }
    g.setLineDash([]);

    // نوار هدف
    if (this.target != null) {
      const t = this.tol / 100;
      const y1 = this.y(this.target + t);
      const y2 = this.y(this.target - t);
      g.fillStyle = col('--band');
      g.fillRect(LABEL_W, y1, w - LABEL_W, y2 - y1);
      g.strokeStyle = col('--accent');
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(LABEL_W, this.y(this.target));
      g.lineTo(w, this.y(this.target));
      g.stroke();
    }

    // مسیر صدای کاربر
    const now = performance.now();
    const x = (t) => LABEL_W + (w - LABEL_W - 14) * (1 - (now - t) / this.win);
    const clampY = (v) => Math.max(5, Math.min(h - 5, v));
    const ok = (m) => this.target == null || Math.abs(m - this.target) * 100 <= this.tol;
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
      g.fillStyle = col(ok(last.m) ? '--good' : '--warn');
      g.beginPath();
      g.arc(x(last.t), clampY(this.y(last.m)), 7, 0, Math.PI * 2);
      g.fill();
    }
  }
}

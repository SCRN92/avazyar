import { freqToMidi } from './notes.js';

// تشخیص زیر و بمی با الگوریتم YIN
export class Yin {
  constructor(sampleRate, { minFreq = 65, maxFreq = 1100, threshold = 0.12 } = {}) {
    this.sr = sampleRate;
    this.tauMin = Math.floor(sampleRate / maxFreq);
    this.tauMax = Math.ceil(sampleRate / minFreq);
    this.threshold = threshold;
    this.d = new Float32Array(this.tauMax + 2);
  }

  detect(buf) {
    const n = buf.length;
    let rms = 0;
    for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / n);
    if (rms < 0.008) return { freq: 0, clarity: 0, rms };

    const tauMax = Math.min(this.tauMax, Math.floor(n / 2));
    const W = n - tauMax;
    const d = this.d;
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const df = buf[j] - buf[j + tau];
        s += df * df;
      }
      running += s;
      d[tau] = running > 0 ? (s * tau) / running : 1;
    }

    let tau = -1;
    for (let t = Math.max(2, this.tauMin); t <= tauMax; t++) {
      if (d[t] < this.threshold) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return { freq: 0, clarity: 0, rms };

    let better = tau;
    if (tau > 1 && tau < tauMax) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const den = a + c - 2 * b;
      if (den !== 0) better = tau + (a - c) / (2 * den);
    }
    return { freq: this.sr / better, clarity: 1 - d[tau], rms };
  }
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// ورودی میکروفون؛ با ?sim در آدرس، به‌جای میکروفون یک نوسان‌ساز آزمایشی استفاده می‌شود
export class PitchInput {
  constructor(ctx) {
    this.ctx = ctx;
    this.listeners = new Set();
    this.running = false;
    this.hist = [];
  }

  async start() {
    if (this.running) return;
    const sim = new URLSearchParams(location.search).has('sim');
    if (sim) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 220;
      g.gain.value = 0.3;
      osc.connect(g);
      osc.start();
      this.simOsc = osc;
      this.source = g;
      window.__sim = {
        setFreq: (f) => osc.frequency.setValueAtTime(f, this.ctx.currentTime),
        mute: (on) => { g.gain.value = on ? 0 : 0.3; },
      };
    } else {
      if (!navigator.mediaDevices?.getUserMedia) {
        const e = new Error('insecure');
        e.name = 'InsecureContext';
        throw e;
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      this.source = this.ctx.createMediaStreamSource(this.stream);
    }
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.source.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.yin = new Yin(this.ctx.sampleRate);
    this.running = true;
    this.frame = 0;
    this.hist = [];
    this.loop();
  }

  loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    if (++this.frame % 2) return; // حدود ۳۰ بار در ثانیه، برای سبک ماندن روی گوشی
    this.analyser.getFloatTimeDomainData(this.buf);
    const r = this.yin.detect(this.buf);
    let midi = null;
    if (r.freq > 0 && r.clarity > 0.85) {
      this.hist.push(freqToMidi(r.freq));
      if (this.hist.length > 5) this.hist.shift();
      midi = median(this.hist);
    } else {
      this.hist = [];
    }
    const ev = { midi, clarity: r.clarity, rms: r.rms, t: performance.now() };
    this.listeners.forEach((fn) => fn(ev));
  };

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.simOsc?.stop();
    this.source?.disconnect();
    this.stream = this.simOsc = this.source = null;
    this.listeners.clear();
  }
}

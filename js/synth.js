// پخش نت مرجع با صدای نرم
export function playTone(ctx, freq, dur = 1.3) {
  return new Promise((resolve) => {
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.25, t + 0.04);
    out.gain.setValueAtTime(0.25, t + dur - 0.25);
    out.gain.linearRampToValueAtTime(0, t + dur);
    out.connect(ctx.destination);

    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = freq;
    o1.connect(out);

    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'sine';
    o2.frequency.value = freq * 2;
    g2.gain.value = 0.15;
    o2.connect(g2).connect(out);

    for (const o of [o1, o2]) {
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    setTimeout(resolve, dur * 1000 + 120);
  });
}

// چند نت پشت‌سرهم و به‌هم‌پیوسته (یک جمله). با شروع هر نت onNote(i) صدا زده می‌شود.
// خروجی: { done, stop }؛ done وقتی کامل می‌شود که پخش تمام یا متوقف شده باشد.
export function playPhrase(ctx, freqs, each = 0.65, onNote = () => {}) {
  const t = ctx.currentTime + 0.03;
  const end = t + freqs.length * each;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, t);
  out.connect(ctx.destination);
  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  o1.type = 'triangle';
  o2.type = 'sine';
  g2.gain.value = 0.15;
  o1.connect(out);
  o2.connect(g2).connect(out);
  const timers = [];
  freqs.forEach((f, i) => {
    const at = t + i * each;
    const last = i === freqs.length - 1;
    o1.frequency.setValueAtTime(f, at);
    o2.frequency.setValueAtTime(f * 2, at);
    // صدا بین دو نت کمی فرو می‌رود تا شنیده شود که نت عوض شده، بدون اینکه جمله بریده شود
    out.gain.linearRampToValueAtTime(0.25, at + 0.04);
    out.gain.setValueAtTime(0.25, at + each - (last ? 0.25 : 0.07));
    out.gain.linearRampToValueAtTime(last ? 0 : 0.1, at + each);
    timers.push(setTimeout(() => onNote(i), (at - ctx.currentTime) * 1000));
  });
  for (const o of [o1, o2]) {
    o.start(t);
    o.stop(end + 0.05);
  }
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  timers.push(setTimeout(finish, (end - ctx.currentTime) * 1000 + 120));
  return {
    done,
    stop() {
      timers.forEach(clearTimeout);
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0, now, 0.03);
      for (const o of [o1, o2]) {
        try { o.stop(now + 0.2); } catch {}
      }
      finish();
    },
  };
}

// نت ثابت و نرم برای تمرین فاصله‌ها؛ تا وقتی stop صدا زده نشود ادامه دارد
export function startDrone(ctx, freq) {
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, ctx.currentTime);
  out.gain.linearRampToValueAtTime(0.14, ctx.currentTime + 0.4);
  out.connect(ctx.destination);
  const parts = [[1, 'triangle', 1], [2, 'sine', 0.25], [0.5, 'sine', 0.5]].map(([mult, type, gain]) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq * mult;
    g.gain.value = gain;
    o.connect(g).connect(out);
    o.start();
    return { o, mult };
  });
  return {
    setFreq(f) {
      for (const part of parts) part.o.frequency.setTargetAtTime(f * part.mult, ctx.currentTime, 0.05);
    },
    stop() {
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(0, t, 0.08);
      for (const part of parts) part.o.stop(t + 0.5);
    },
  };
}

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

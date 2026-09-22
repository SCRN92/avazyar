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

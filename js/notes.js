// نام نت‌ها به روش ثابت (دو = C)، به‌همراه ربع‌پرده‌های موسیقی ایرانی (کرن و سری)

const NAMES = ['دو', 'دو دیز', 'ر', 'ر دیز', 'می', 'فا', 'فا دیز', 'سل', 'سل دیز', 'لا', 'لا دیز', 'سی'];
const LATIN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NATURAL = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1];
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export const fa = (v) => String(v).replace(/\d/g, (d) => FA_DIGITS[d]);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);

const mod12 = (n) => ((n % 12) + 12) % 12;
const octave = (m) => Math.floor(m / 12) - 1;

// step: عدد صحیح (نیم‌پرده) یا عدد صحیح + ۰.۵ (ربع‌پرده)
export function stepName(step) {
  if (Number.isInteger(step)) {
    const pc = mod12(step);
    return { fa: NAMES[pc], latin: `${LATIN[pc]}${octave(step)}` };
  }
  const lower = Math.floor(step);
  const upper = lower + 1;
  // اگر نت بالایی طبیعی باشد، «کرن» آن را می‌گوییم (مثل «می کرن»)؛ وگرنه «سری» نت پایینی
  if (NATURAL[mod12(upper)]) {
    return { fa: `${NAMES[mod12(upper)]} کرن`, latin: `${LATIN[mod12(upper)]}${octave(upper)} −¼` };
  }
  return { fa: `${NAMES[mod12(lower)]} سری`, latin: `${LATIN[mod12(lower)]}${octave(lower)} +¼` };
}

// نزدیک‌ترین نت؛ در حالت ایرانی ربع‌پرده‌ها هم حساب می‌شوند
export function nearest(midi, mode) {
  const q = mode === 'irani' ? 0.5 : 1;
  const step = Math.round(midi / q) * q;
  return { step, cents: (midi - step) * 100, ...stepName(step) };
}

// تیپ‌های صدا با محدوده‌ی تقریبی (عدد MIDI)
export const VOICE_TYPES = {
  male: [
    { id: 'bass', fa: 'باس', low: 40, high: 64 },
    { id: 'baritone', fa: 'باریتون', low: 45, high: 69 },
    { id: 'tenor', fa: 'تنور', low: 48, high: 72 },
  ],
  female: [
    { id: 'alto', fa: 'آلتو', low: 53, high: 77 },
    { id: 'mezzo', fa: 'متسو سوپرانو', low: 57, high: 81 },
    { id: 'soprano', fa: 'سوپرانو', low: 60, high: 84 },
  ],
};

export function estimateVoiceType(low, high, voice) {
  const center = (low + high) / 2;
  const types = VOICE_TYPES[voice] || VOICE_TYPES.male;
  let best = null;
  for (const [i, t] of types.entries()) {
    // تیپ میانی رایج‌تر است؛ در حالت مساوی، آن را ترجیح می‌دهیم
    const d = Math.abs(center - (t.low + t.high) / 2) + (i === 1 ? 0 : 0.75);
    if (!best || d < best.d) best = { ...t, d };
  }
  return best;
}

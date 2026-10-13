// درس‌ها به‌صورت داده. برای اضافه کردن یک درس «بشنو و تکرار کن» یا یک درس گوش، فقط همین فهرست عوض می‌شود.
//
// kind: 'seq'  نت‌ها را یکی‌یکی پخش می‌کند و کاربر تکرار می‌کند
//   notes: { from: 'home', steps }   فاصله‌ها (نیم‌پرده) نسبت به نت خانه‌ی کاربر
//   notes: { root, steps }           فاصله‌ها نسبت به یک نت ثابت (۰ = دو، ۲ = ر، …) در اکتاوی که به صدای کاربر بخورد
//   tols: دقت لازم (سنت) در هر سطح؛ با بهتر شدن امتیاز، سطح بالا می‌رود
// kind: 'ear'  درس گوش، بدون میکروفون
//   quiz: 'updown' با gaps = بازه‌ی فاصله‌ی دو نت (نیم‌پرده) در هر سطح
//   quiz: 'koron'  با roots = نت‌های شروع در هر سطح
import { fitRoot, stepName } from './notes.js';

export const LESSONS = [
  {
    id: 'warmup', kind: 'warmup', icon: '🌬️',
    title: 'گرم کردن و سلامت صدا', sub: 'قبل از هر تمرین، حدود ۲ دقیقه',
  },
  {
    id: 'range', kind: 'range', icon: '📏',
    title: 'محدوده‌ی صدای من', sub: 'پایین‌ترین و بالاترین نت راحتت',
  },
  {
    id: 'home', kind: 'home', icon: '🏠',
    title: 'نت خانه', sub: 'راحت‌ترین نت صدات رو پیدا کن',
  },
  {
    id: 'sustain', kind: 'sustain', icon: '🫁',
    title: 'نفس و نگه داشتن نت', sub: 'یه نت رو آروم و یکنواخت نگه دار',
  },
  {
    id: 'match', kind: 'seq', icon: '🎯', tols: [35, 25, 15],
    title: 'هم‌صدا شدن با نت', sub: 'بشنو و همون رو بخون',
    intro: 'آوازیار یه نت پخش می‌کنه. خوب گوش کن، بعد با «آ» یا «او» همون نت رو بخون و نگهش دار. هر وقت خطت سبز شد، یعنی دقیقاً روی نتی.',
    notes: { from: 'home', steps: [0, 2, -2, 4, 1] },
  },
  {
    id: 'updown', kind: 'ear', icon: '👂', quiz: 'updown', gaps: [[3, 5], [1, 2], [0.5, 1]],
    title: 'گوش: بالاتر یا پایین‌تر؟', sub: 'بدون خوندن، فقط با گوش',
    intro: 'دو تا نت پشت‌سرهم پخش می‌شه. بگو نت دوم از اولی بالاتره (زیرتر) یا پایین‌تر (بم‌تر). برای این تمرین میکروفون لازم نیست.',
  },
  {
    id: 'scale', kind: 'seq', icon: '🪜', tols: [35, 25, 15],
    title: 'دو، ر، می', sub: 'اولین گام: بالا رفتن و برگشتن',
    intro: 'دو، ر، می، فا، سل… و برگشت. این پایه‌ی همه‌ی ملودی‌هاست. هر نت رو بشنو و تکرار کن.',
    notes: { root: 0, steps: [0, 2, 4, 5, 7, 5, 4, 2, 0] },
  },
  {
    id: 'koron', kind: 'ear', icon: '🎼', quiz: 'koron', roots: [[2], [2, 9, 7]],
    title: 'گوش: می یا می کرن؟', sub: 'رنگ ربع‌پرده رو با گوش بشناس',
    intro: 'اول یه نت پایه پخش می‌شه و بعد نت دوم. نت دوم یا یه پرده‌ی کامل بالاتره، یا یه ربع‌پرده کمتر از اون (کرن). بگو کدوم رو شنیدی. برای این تمرین میکروفون لازم نیست.',
  },
  {
    id: 'shur', kind: 'seq', icon: '🎶', tols: [25, 20, 15],
    title: 'اولین ربع‌پرده: حال‌وهوای شور', sub: 'ر، می کرن، فا',
    intro: 'موسیقی ایرانی نت‌هایی داره که بین دو کلید پیانو هستن. «می کرن» حدود یه ربع‌پرده پایین‌تر از «می»‌ه، و همون رنگ آشنای دستگاه شوره. دقت این درس سخت‌گیرانه‌تره.',
    notes: { root: 2, steps: [0, 1.5, 3, 5, 3, 1.5, 0] },
  },
];

export const PASS = 80; // امتیاز قبولی
export const LEVEL_UP = 85; // امتیاز لازم برای رفتن به سطح بعد
export const EAR_QUESTIONS = 8;

// اندازه‌ی کرن و سری در اجرای واقعی ثابت نیست؛ برای ربع‌پرده‌ها هیچ‌وقت سخت‌گیرتر از این نمی‌شویم
export const QUARTER_MIN_TOL = 25;

const SCORED = ['seq', 'ear'];

export function voiceRange(state) {
  const female = state.settings.voice === 'female';
  const r = state.range || (female ? { low: 57, high: 72 } : { low: 45, high: 62 });
  const home = state.home ?? Math.round((r.low + r.high) / 2 - 2);
  return { low: r.low, high: r.high, home };
}

// نت‌های یک درس «بشنو و تکرار کن» برای صدای این کاربر
export function buildNotes(lesson, { low, high, home }) {
  const n = lesson.notes;
  if (!n) return [];
  if (n.from === 'home') return n.steps.map((o) => Math.min(high, Math.max(low, home + o)));
  const root = fitRoot(n.root, Math.max(...n.steps), low, high);
  return n.steps.map((o) => root + o);
}

export function levelCount(lesson) {
  return (lesson.tols || lesson.gaps || lesson.roots || [null]).length;
}

export const clampLevel = (lesson, level) => Math.min(Math.max(0, level || 0), levelCount(lesson) - 1);

// دقت لازم (سنت) برای یک نت در یک سطح
export function tolFor(lesson, level, step) {
  const tol = lesson.tols[clampLevel(lesson, level)];
  return Number.isInteger(step) ? tol : Math.max(tol, QUARTER_MIN_TOL);
}

export function levelAfter(lesson, level, score) {
  const cur = clampLevel(lesson, level);
  return score >= LEVEL_UP ? Math.min(cur + 1, levelCount(lesson) - 1) : cur;
}

// اول درسی که هنوز انجام نشده؛ بعد، درس امتیازداری که کمترین «بهترین امتیاز» را دارد
export function suggestNext(state) {
  const fresh = LESSONS.find((l) => !state.lessons[l.id]?.count);
  if (fresh) return fresh;
  return LESSONS.filter((l) => SCORED.includes(l.kind))
    .reduce((a, b) => ((state.lessons[b.id]?.best ?? 0) < (state.lessons[a.id]?.best ?? 0) ? b : a));
}

// ---------- درس‌های گوش ----------

const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

// یک سؤال درس گوش: نت‌هایی که پخش می‌شوند، گزینه‌ها، و نام نت‌ها برای نشان دادن بعد از جواب
export function earQuestion(lesson, level, voice, rnd = Math.random) {
  const lv = clampLevel(lesson, level);
  if (lesson.quiz === 'updown') {
    const [min, max] = lesson.gaps[lv];
    const gap = min + Math.floor(rnd() * ((max - min) / 0.5 + 1)) * 0.5;
    const up = rnd() < 0.5;
    const first = voice.home + Math.floor(rnd() * 5) - 2;
    const second = first + (up ? gap : -gap);
    return {
      tones: [first, second],
      choices: [{ label: 'بالاتر ↑', right: up }, { label: 'پایین‌تر ↓', right: !up }],
      names: [stepName(first).fa, stepName(second).fa],
    };
  }
  // koron: نت پایه، و بعد یا یک پرده‌ی کامل بالاتر یا یک ربع‌پرده کمتر از آن
  const root = fitRoot(pick(lesson.roots[lv], rnd), 2, voice.low, voice.high);
  const koron = rnd() < 0.5;
  const second = root + (koron ? 1.5 : 2);
  return {
    tones: [root, second],
    choices: [{ label: stepName(root + 1.5).fa, right: koron }, { label: stepName(root + 2).fa, right: !koron }],
    names: [stepName(root).fa, stepName(second).fa],
  };
}

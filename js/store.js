// ذخیره‌ی پیشرفت روی خود گوشی (localStorage)
const KEY = 'avazyar.v1';

// نسخه‌ی ساختار داده‌ها؛ با هر تغییر ساختار یکی زیاد می‌شود و یک تابع به MIGRATIONS اضافه می‌شود
export const SCHEMA = 2;
const DEFAULT = {
  schema: SCHEMA,
  settings: { mode: 'irani', voice: null, micGate: null, hideInstallHint: false },
  range: null,
  rangeHistory: [],
  home: null,
  lessons: {},
  sessions: [],
  days: [],
};

// هر تابع، داده را از همان نسخه به نسخه‌ی بعدی می‌برد
const MIGRATIONS = {
  1: (s) => {
    s.rangeHistory = s.range ? [{ ...s.range }] : [];
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isRange = (r) => isObj(r) && num(r.low) != null && num(r.high) != null;

// داده‌ی خام (از حافظه یا فایل پشتیبان) را به ساختار فعلی می‌رساند؛ اگر قابل‌استفاده نباشد خطا می‌دهد
export function normalize(raw) {
  if (!isObj(raw)) throw new Error('invalid');
  const s = clone(raw);
  let v = Number.isInteger(s.schema) ? s.schema : 1;
  if (v > SCHEMA) throw new Error('newer');
  for (; v < SCHEMA; v++) MIGRATIONS[v](s);

  const d = clone(DEFAULT);
  const st = isObj(s.settings) ? s.settings : {};
  if (['irani', 'gharbi'].includes(st.mode)) d.settings.mode = st.mode;
  if (['male', 'female'].includes(st.voice)) d.settings.voice = st.voice;
  d.settings.micGate = num(st.micGate);
  d.settings.hideInstallHint = st.hideInstallHint === true;
  if (isRange(s.range)) d.range = s.range;
  if (Array.isArray(s.rangeHistory)) d.rangeHistory = s.rangeHistory.filter(isRange);
  d.home = num(s.home);
  if (Array.isArray(s.sessions)) {
    d.sessions = s.sessions
      .filter((x) => isObj(x) && num(x.date) != null && typeof x.lesson === 'string')
      .map((x) => ({ date: x.date, lesson: x.lesson, score: num(x.score) }));
  }
  if (Array.isArray(s.days)) d.days = s.days.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  if (isObj(s.lessons)) {
    for (const [id, L] of Object.entries(s.lessons)) {
      if (isObj(L)) d.lessons[id] = { best: num(L.best), last: num(L.last), count: num(L.count) ?? 0 };
    }
  }
  return d;
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) return normalize(s);
  } catch {}
  return clone(DEFAULT);
}

let state = load();

export const store = {
  get: () => state,
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  },
  update(fn) {
    fn(state);
    this.save();
  },
  reset() {
    state = clone(DEFAULT);
    this.save();
  },
};

const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function streak(now = new Date()) {
  const set = new Set(state.days);
  const d = new Date(now);
  if (!set.has(fmt(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(fmt(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function recordSession(lessonId, score, now = new Date()) {
  store.update((s) => {
    s.sessions.push({ date: now.getTime(), lesson: lessonId, score });
    if (s.sessions.length > 500) s.sessions.shift();
    const L = s.lessons[lessonId] || { best: null, last: null, count: 0 };
    L.count++;
    L.last = score;
    if (score != null && (L.best == null || score > L.best)) L.best = score;
    s.lessons[lessonId] = L;
    const t = fmt(now);
    if (!s.days.includes(t)) s.days.push(t);
  });
}

export function setRange(low, high, now = new Date()) {
  store.update((s) => {
    s.range = { low, high, date: now.getTime() };
    s.rangeHistory.push({ ...s.range });
    if (s.rangeHistory.length > 100) s.rangeHistory.shift();
  });
}

// ---------- پشتیبان‌گیری ----------

export function exportData(now = new Date()) {
  return JSON.stringify({ app: 'avazyar', exported: now.toISOString(), data: state }, null, 2);
}

// متن یک فایل پشتیبان را جایگزین داده‌های فعلی می‌کند؛ اگر فایل معتبر نباشد خطا می‌دهد و چیزی عوض نمی‌شود
export function importData(text) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error('invalid');
  }
  if (!isObj(file) || file.app !== 'avazyar') throw new Error('invalid');
  state = normalize(file.data);
  store.save();
}

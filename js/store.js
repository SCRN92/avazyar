// ذخیره‌ی پیشرفت روی خود گوشی (localStorage)
const KEY = 'avazyar.v1';
const DEFAULT = {
  settings: { mode: 'irani', voice: null },
  range: null,
  home: null,
  lessons: {},
  sessions: [],
  days: [],
};

const clone = (o) => JSON.parse(JSON.stringify(o));

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) return { ...clone(DEFAULT), ...s, settings: { ...DEFAULT.settings, ...s.settings } };
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

export function streak() {
  const set = new Set(state.days);
  const d = new Date();
  if (!set.has(fmt(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(fmt(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function recordSession(lessonId, score) {
  store.update((s) => {
    s.sessions.push({ date: Date.now(), lesson: lessonId, score });
    if (s.sessions.length > 500) s.sessions.shift();
    const L = s.lessons[lessonId] || { best: null, last: null, count: 0 };
    L.count++;
    L.last = score;
    if (score != null && (L.best == null || score > L.best)) L.best = score;
    s.lessons[lessonId] = L;
    const t = fmt(new Date());
    if (!s.days.includes(t)) s.days.push(t);
  });
}

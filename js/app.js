import { PitchInput, DEFAULT_GATE, gateFor, micVerdict } from './pitch.js';
import { playTone } from './synth.js';
import { fa, nearest, stepName, midiToFreq, estimateVoiceType, fitRoot, fold } from './notes.js';
import { store, recordSession, setRange, streak, exportData, importData } from './store.js';
import { Lane } from './lane.js';

const VERSION = globalThis.AVAZYAR_VERSION;

const $ = (sel, root = document) => root.querySelector(sel);
const main = $('#main');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let actx = null;
let input = null;
let cleanup = null;
let deferredInstall = null;

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------- بیدار نگه داشتن صفحه حین تمرین ----------

let wake = null;
let wakeWanted = false;
let wakeBusy = false;

async function keepAwake(on) {
  wakeWanted = on;
  if (!on) {
    wake?.release().catch(() => {});
    wake = null;
    return;
  }
  if (wake || wakeBusy || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  wakeBusy = true;
  try {
    const w = await navigator.wakeLock.request('screen');
    if (wakeWanted) {
      wake = w;
      w.addEventListener('release', () => { if (wake === w) wake = null; });
    } else {
      w.release().catch(() => {});
    }
  } catch {}
  wakeBusy = false;
}

// مرورگر با رفتن برنامه به پس‌زمینه قفل را آزاد می‌کند؛ با برگشتن، دوباره می‌گیریمش
document.addEventListener('visibilitychange', () => {
  if (wakeWanted && document.visibilityState === 'visible') keepAwake(true);
});

// ---------- پیام برای صفحه‌خوان‌ها ----------

const srBox = $('#sr');
let lastSaid = 0;

// بازخورد زنده خیلی سریع عوض می‌شود؛ حداکثر هر ۲٫۵ ثانیه یک بار اعلامش می‌کنیم
function announce(text) {
  const now = performance.now();
  if (now - lastSaid < 2500) return;
  lastSaid = now;
  srBox.textContent = text;
}

// ---------- صدا و میکروفون ----------

function audio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

async function startMic() {
  const ctx = audio();
  if (!input) input = new PitchInput(ctx);
  input.setGate(store.get().settings.micGate ?? DEFAULT_GATE);
  const page = pageId;
  let failed = null;
  try {
    await input.start();
  } catch (e) {
    failed = e;
  }
  // اگر کاربر وسط پرسش اجازه‌ی میکروفون به صفحه‌ی دیگری رفته، میکروفون را می‌بندیم و آن تمرین را ادامه نمی‌دهیم
  if (page !== pageId) {
    stopMic();
    return new Promise(() => {});
  }
  if (failed) throw failed;
  keepAwake(true);
  return input;
}

function stopMic() {
  input?.stop();
  keepAwake(false);
}

// بعد از هر تمرین از مرورگر می‌خواهیم داده‌های برنامه را خودسرانه پاک نکند
function finishSession(lessonId, score) {
  recordSession(lessonId, score);
  navigator.storage?.persist?.()?.catch(() => {});
}

function micError(e) {
  const map = {
    NotAllowedError: 'اجازه‌ی استفاده از میکروفون داده نشد. از تنظیمات مرورگر اجازه بدید و دوباره امتحان کنید.',
    InsecureContext: 'میکروفون فقط روی آدرس امن (https) کار می‌کنه.',
    NotFoundError: 'میکروفونی پیدا نشد.',
    NotReadableError: 'میکروفون دست یه برنامه‌ی دیگه‌ست. اون برنامه رو ببندید و دوباره امتحان کنید.',
  };
  return map[e?.name] || `میکروفون در دسترس نیست (${e?.message || e}).`;
}

const alertBox = (msg, extra = '') => `<div class="alert" role="alert"><p>${esc(msg)}</p>${extra}</div>`;
const micCheckLink = '<a class="btn small" href="#/mic">تست میکروفون</a>';

// ---------- درس‌ها ----------

const LESSONS = [
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
    id: 'match', kind: 'seq', icon: '🎯', tol: 35,
    title: 'هم‌صدا شدن با نت', sub: 'بشنو و همون رو بخون',
    intro: 'آوازیار یه نت پخش می‌کنه. خوب گوش کن، بعد با «آ» یا «او» همون نت رو بخون و نگهش دار. هر وقت خطت سبز شد، یعنی دقیقاً روی نتی.',
  },
  {
    id: 'scale', kind: 'seq', icon: '🪜', tol: 35,
    title: 'دو، ر، می', sub: 'اولین گام: بالا رفتن و برگشتن',
    intro: 'دو، ر، می، فا، سل… و برگشت. این پایه‌ی همه‌ی ملودی‌هاست. هر نت رو بشنو و تکرار کن.',
  },
  {
    id: 'shur', kind: 'seq', icon: '🎶', tol: 25,
    title: 'اولین ربع‌پرده: حال‌وهوای شور', sub: 'ر، می کرن، فا',
    intro: 'موسیقی ایرانی نت‌هایی داره که بین دو کلید پیانو هستن. «می کرن» حدود یه ربع‌پرده پایین‌تر از «می»‌ه، و همون رنگ آشنای دستگاه شوره. دقت این درس سخت‌گیرانه‌تره.',
  },
];

function voiceRange() {
  const s = store.get();
  const female = s.settings.voice === 'female';
  const r = s.range || (female ? { low: 57, high: 72 } : { low: 45, high: 62 });
  const home = s.home ?? Math.round((r.low + r.high) / 2 - 2);
  return { ...r, home };
}

function buildSeq(id) {
  const { low, high, home } = voiceRange();
  const clamp = (m) => Math.min(high, Math.max(low, m));
  if (id === 'match') return [0, 2, -2, 4, 1].map((o) => clamp(home + o));
  if (id === 'scale') {
    const c = fitRoot(0, 7, low, high);
    return [0, 2, 4, 5, 7, 5, 4, 2, 0].map((o) => c + o);
  }
  if (id === 'shur') {
    const d = fitRoot(2, 5, low, high);
    return [0, 1.5, 3, 5, 3, 1.5, 0].map((o) => d + o);
  }
  return [];
}

function suggestNext() {
  const s = store.get();
  const fresh = LESSONS.find((l) => !s.lessons[l.id]?.count);
  if (fresh) return fresh;
  const seq = LESSONS.filter((l) => l.kind === 'seq');
  return seq.reduce((a, b) => ((s.lessons[b.id]?.best ?? 0) < (s.lessons[a.id]?.best ?? 0) ? b : a));
}

// ---------- مسیریابی ----------

const routes = {
  '': viewHome,
  welcome: viewWelcome,
  tuner: viewTuner,
  progress: viewProgress,
  settings: viewSettings,
  mic: viewMic,
  lesson: viewLesson,
};

let routed = false;
let pageId = 0;

function route() {
  pageId++;
  cleanup?.();
  cleanup = null;
  stopMic();
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if (!store.get().settings.voice && name !== 'welcome') {
    location.hash = '#/welcome';
    return;
  }
  try {
    (routes[name] || viewHome)(arg);
  } catch (e) {
    showFatal(e);
  }
  document.querySelectorAll('.tabbar a').forEach((a) => {
    const active = a.dataset.route === (name || '');
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.body.classList.toggle('no-tabbar', name === 'welcome');
  window.scrollTo(0, 0);
  // بعد از عوض شدن صفحه، صفحه‌خوان از ابتدای محتوای جدید ادامه می‌دهد
  if (routed) main.focus({ preventScroll: true });
  routed = true;
}

// ---------- صفحه‌ها ----------

function viewWelcome() {
  main.innerHTML = `
    <section class="welcome">
      <div class="logo">🎙️</div>
      <h1>آوازیار</h1>
      <p class="lead">آموزش آواز ایرانی از صفر، حتی اگه هیچ سواد موسیقی نداری.</p>
      <div class="card">
        <h2 class="h3">روش ما: اول صدا، بعد نماد</h2>
        <p>اول یاد می‌گیری صدای خودت رو بشناسی و نت‌ها رو درست بخونی. نت‌خوانی و نمادها بعداً میان، روی چیزهایی که از قبل بلدی.</p>
      </div>
      <div class="card">
        <h2 class="h3">صدات به کدوم نزدیک‌تره؟</h2>
        <p class="muted">فقط برای انتخاب نت‌های اولیه‌ست. بعداً با تست محدوده، دقیق‌ترش می‌کنیم.</p>
        <div class="row">
          <button class="btn primary grow" data-voice="male">صدای مردانه</button>
          <button class="btn primary grow" data-voice="female">صدای زنانه</button>
        </div>
      </div>
      <p class="muted small">🔒 صدای تو هیچ‌وقت از گوشیت خارج نمی‌شه. همه‌ی پردازش روی خود گوشی انجام می‌شه.</p>
    </section>`;
  main.querySelectorAll('[data-voice]').forEach((b) => {
    b.onclick = () => {
      store.update((s) => { s.settings.voice = b.dataset.voice; });
      location.hash = '#/';
    };
  });
}

function viewHome() {
  const s = store.get();
  const next = suggestNext();
  const rangeText = s.range ? `${stepName(s.range.low).fa} تا ${stepName(s.range.high).fa}` : '؟';
  // آیفون پیشنهاد نصب خودکار ندارد؛ خودمان راهش را نشان می‌دهیم
  const iosHint = isIOS && !isStandalone() && !s.settings.hideInstallHint;
  main.innerHTML = `
    <header class="hero">
      <div>
        <h1>آوازیار</h1>
        <p class="muted">آموزش آواز ایرانی از صفر</p>
      </div>
      ${deferredInstall ? '<button class="btn small" id="install">نصب روی گوشی</button>' : ''}
    </header>
    ${iosHint ? `<section class="card">
      <h2 class="h3">نصب روی آیفون</h2>
      <p class="muted small">در Safari دکمه‌ی «اشتراک‌گذاری» رو بزن و «Add to Home Screen» رو انتخاب کن. با نصب، پیشرفتت هم مطمئن‌تر روی گوشی می‌مونه.</p>
      <button class="btn small" id="hidehint">باشه</button>
    </section>` : ''}
    <section class="stats">
      <div class="stat"><b>${fa(streak())}</b><span>روز پشت‌سرهم</span></div>
      <div class="stat"><b>${fa(s.sessions.length)}</b><span>تمرین</span></div>
      <div class="stat"><b class="sm">${esc(rangeText)}</b><span>محدوده‌ی صدا</span></div>
    </section>
    <section class="card today">
      <p class="eyebrow">پیشنهاد امروز</p>
      <h2>${next.icon} ${esc(next.title)}</h2>
      <p class="muted">${esc(next.sub)}</p>
      <a class="btn primary block" href="#/lesson/${next.id}">شروع</a>
    </section>
    <h2 class="h3 section-title">درس‌ها</h2>
    <ol class="lessons">
      ${LESSONS.map((l, i) => {
        const r = s.lessons[l.id];
        const badge = r?.best != null ? `<span class="badge">${fa(r.best)}٪</span>` : r?.count ? '<span class="badge done">✓</span>' : '';
        return `<li><a href="#/lesson/${l.id}">
          <span class="num">${fa(i + 1)}</span>
          <span class="li-text"><b>${l.icon} ${esc(l.title)}</b><span class="muted small">${esc(l.sub)}</span></span>
          ${badge}</a></li>`;
      }).join('')}
    </ol>
    <a class="card tuner-link" href="#/tuner">
      <span class="big-icon">🎤</span>
      <span><b>تمرین آزاد</b><br><span class="muted small">ببین الان روی چه نتی می‌خونی</span></span>
    </a>`;
  $('#install')?.addEventListener('click', async () => {
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    viewHome();
  });
  $('#hidehint')?.addEventListener('click', () => {
    store.update((st) => { st.settings.hideInstallHint = true; });
    viewHome();
  });
}

function viewTuner() {
  const mode = store.get().settings.mode;
  const lim = mode === 'irani' ? 25 : 50;
  main.innerHTML = `
    <h1 class="page-title">تمرین آزاد</h1>
    <p class="muted">هر نتی دوست داری بخون. آوازیار نشون می‌ده روی کدوم نتی و چقدر دقیق.</p>
    <div class="card center">
      <div class="note-big" id="nb">–</div>
      <div class="latin" id="nl">&nbsp;</div>
      <div class="meter" dir="ltr">
        <div class="meter-track"><div class="meter-ok"></div><div class="needle" id="needle"></div></div>
        <div class="meter-scale"><span>پایین‌تر</span><span>درست</span><span>بالاتر</span></div>
      </div>
      <div class="muted small" id="hz">&nbsp;</div>
    </div>
    <canvas class="lane" id="lane" role="img" aria-label="نمودار زنده‌ی زیر و بمی صدا"></canvas>
    <div id="err"></div>
    <button class="btn primary block" id="go">روشن کردن میکروفون</button>`;
  const lane = new Lane($('#lane'), { span: 10, mode });
  lane.start();
  const nb = $('#nb'), nl = $('#nl'), needle = $('#needle'), hz = $('#hz'), go = $('#go');
  let off = null;
  go.onclick = async () => {
    if (input?.running) {
      off?.();
      stopMic();
      go.textContent = 'روشن کردن میکروفون';
      return;
    }
    try {
      await startMic();
    } catch (e) {
      $('#err').innerHTML = alertBox(micError(e));
      return;
    }
    $('#err').innerHTML = '';
    go.textContent = 'خاموش کردن میکروفون';
    off = input.on((ev) => {
      lane.push(ev.t, ev.midi);
      if (ev.midi == null) {
        needle.classList.add('idle');
        return;
      }
      const n = nearest(ev.midi, mode);
      nb.textContent = n.fa;
      nl.textContent = n.latin;
      const pos = Math.max(-1, Math.min(1, n.cents / lim));
      needle.style.left = `${50 + pos * 50}%`;
      needle.classList.remove('idle');
      needle.classList.toggle('ok', Math.abs(n.cents) <= lim * 0.4);
      hz.textContent = `${fa(Math.round(midiToFreq(ev.midi)))} هرتز`;
      announce(`${n.fa}، ${Math.abs(n.cents) <= lim * 0.4 ? 'درست' : n.cents > 0 ? 'کمی بالاتر' : 'کمی پایین‌تر'}`);
    });
  };
  cleanup = () => { off?.(); lane.stop(); };
}

function lessonHead(L) {
  return `<a class="back" href="#/">→ بازگشت</a><h1 class="page-title">${L.icon} ${esc(L.title)}</h1>`;
}

function viewLesson(id) {
  const L = LESSONS.find((l) => l.id === id);
  if (!L) {
    location.hash = '#/';
    return;
  }
  ({ warmup: runWarmup, range: runRange, home: runHome, seq: runSeq })[L.kind](L);
}

// گرم کردن
function runWarmup(L) {
  const steps = [
    { t: 15, text: 'صاف بشین یا بایست. شونه‌ها و فک رو رها کن.' },
    { t: 30, text: 'نفس عمیق از شکم: ۴ ثانیه دم، ۶ ثانیه بازدم.' },
    { t: 20, text: 'ویبره‌ی لب: لب‌ها رو شل کن و مثل صدای موتور بچه‌ها «بررررر» کن.' },
    { t: 25, text: 'با دهن بسته، روی یه نت راحت آروم «هوم» کن.' },
    { t: 30, text: 'هوم کن و آروم از پایین به بالا سُر بخور و برگرد، مثل یه آژیر آروم.' },
  ];
  main.innerHTML = `
    ${lessonHead(L)}
    <ol class="steps">${steps.map((s, i) => `<li id="w${i}"><span>${esc(s.text)}</span><span class="muted small">${fa(s.t)} ثانیه</span></li>`).join('')}</ol>
    <div class="card center"><div class="countdown" id="cd">۲ دقیقه</div></div>
    <button class="btn primary block" id="go">شروع</button>
    <div class="card tips">
      <h2 class="h3">سلامت صدا</h2>
      <ul>
        <li>اگه گلوت درد گرفت یا خشک شد، دست نگه دار و آب بخور.</li>
        <li>هیچ‌وقت نت بلند رو با فشار و جیغ نخون. محدوده‌ی صدا با تمرین، خودش بیشتر می‌شه.</li>
        <li>اگه گرفتگی یا درد صدا بیشتر از دو هفته طول کشید، به پزشک گوش و حلق و بینی سر بزن.</li>
      </ul>
    </div>`;
  let timer = null;
  let stopped = false;
  cleanup = () => { stopped = true; clearInterval(timer); };
  $('#go').onclick = async () => {
    $('#go').classList.add('hidden');
    keepAwake(true);
    for (let i = 0; i < steps.length && !stopped; i++) {
      document.querySelectorAll('.steps li').forEach((li, j) => {
        li.classList.toggle('active', j === i);
        li.classList.toggle('done', j < i);
      });
      let left = steps[i].t;
      $('#cd').textContent = fa(left);
      await new Promise((res) => {
        timer = setInterval(() => {
          left--;
          if (!stopped) $('#cd').textContent = fa(left);
          if (left <= 0 || stopped) { clearInterval(timer); res(); }
        }, 1000);
      });
    }
    if (stopped) return;
    document.querySelectorAll('.steps li').forEach((li) => { li.classList.remove('active'); li.classList.add('done'); });
    keepAwake(false);
    finishSession(L.id, null);
    $('#cd').textContent = 'صدات آماده‌ست ✓';
    main.insertAdjacentHTML('beforeend', `<a class="btn primary block" href="#/lesson/${suggestNext().id}">برو سراغ تمرین بعدی</a>`);
  };
}

// تست محدوده
function runRange(L) {
  const mode = store.get().settings.mode;
  const phases = [
    { key: 'low', text: 'یه «آ» آروم بکش و آروم‌آروم پایین بیا، تا جایی که هنوز راحتی. فشار نیار.' },
    { key: 'high', text: 'حالا از یه نت راحت شروع کن و آروم بالا برو، تا جایی که صدات هنوز راحته. جیغ نزن!' },
  ];
  main.innerHTML = `
    ${lessonHead(L)}
    <p class="muted">دو مرحله داره و هر مرحله ۸ ثانیه‌ست. با این تست، تمرین‌ها دقیقاً با صدای خودت تنظیم می‌شن.</p>
    <div class="card center">
      <div class="status" id="ins" role="status">آماده‌ای؟</div>
      <div class="note-big" id="nb">–</div>
      <div class="countdown" id="cd">&nbsp;</div>
    </div>
    <canvas class="lane short" id="lane" role="img" aria-label="نمودار زنده‌ی زیر و بمی صدا"></canvas>
    <div id="err"></div>
    <div id="result"></div>
    <button class="btn primary block" id="go">شروع تست</button>`;
  const lane = new Lane($('#lane'), { span: 14, mode });
  lane.start();
  let off = null;
  let stopped = false;
  cleanup = () => { stopped = true; off?.(); lane.stop(); };
  const pct = (arr, p) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
  };

  $('#go').onclick = async () => {
    const go = $('#go');
    go.classList.add('hidden');
    $('#result').innerHTML = '';
    try {
      await startMic();
    } catch (e) {
      $('#err').innerHTML = alertBox(micError(e));
      go.classList.remove('hidden');
      return;
    }
    $('#err').innerHTML = '';
    let collecting = null;
    off = input.on((ev) => {
      lane.push(ev.t, ev.midi);
      if (ev.midi != null) $('#nb').textContent = nearest(ev.midi, mode).fa;
      if (collecting && ev.midi != null && ev.clarity > 0.9 && ev.rms > input.gate * 1.25) collecting.push(ev.midi);
    });
    const res = {};
    for (const ph of phases) {
      $('#ins').textContent = ph.text;
      for (let i = 3; i > 0 && !stopped; i--) {
        $('#cd').textContent = `آماده… ${fa(i)}`;
        await sleep(800);
      }
      collecting = [];
      for (let i = 8; i > 0 && !stopped; i--) {
        $('#cd').textContent = `بخون! ${fa(i)}`;
        await sleep(1000);
      }
      if (stopped) return;
      const got = collecting;
      collecting = null;
      if (got.length < 20) {
        $('#result').innerHTML = alertBox('صدای کافی نشنیدم. کمی بلندتر یا نزدیک‌تر به گوشی بخون و دوباره امتحان کن. اگه باز هم نشد، تست میکروفون رو انجام بده.', micCheckLink);
        $('#cd').textContent = '';
        go.textContent = 'دوباره';
        go.classList.remove('hidden');
        off();
        stopMic();
        return;
      }
      res[ph.key] = ph.key === 'low' ? pct(got, 0.05) : pct(got, 0.95);
    }
    off();
    stopMic();
    const low = Math.round(res.low);
    const high = Math.round(res.high);
    $('#cd').textContent = '';
    $('#ins').textContent = 'تموم شد ✓';
    if (high - low < 3) {
      $('#result').innerHTML = alertBox('محدوده خیلی کوچیک ثبت شد. در مرحله‌ی اول تا جای ممکن پایین برو و در مرحله‌ی دوم تا جای ممکن بالا، و دوباره امتحان کن.');
      go.textContent = 'دوباره';
      go.classList.remove('hidden');
      return;
    }
    setRange(low, high);
    finishSession(L.id, null);
    const vt = estimateVoiceType(low, high, store.get().settings.voice);
    const span = high - low;
    $('#result').innerHTML = `
      <div class="card result">
        <p class="eyebrow">محدوده‌ی راحت صدای تو</p>
        <h2>${esc(stepName(low).fa)} <span class="muted small">${stepName(low).latin}</span> تا ${esc(stepName(high).fa)} <span class="muted small">${stepName(high).latin}</span></h2>
        <p>${fa(span)} نیم‌پرده${span >= 12 ? `، یعنی حدود ${fa((span / 12).toFixed(1))} اکتاو` : ''}.</p>
        <p>تیپ صدای تخمینی: <b>${esc(vt.fa)}</b></p>
        <p class="muted small">این فقط یه تخمینه. محدوده‌ی صدای مبتدی‌ها با تمرین بیشتر می‌شه، پس هر چند وقت یه بار دوباره تست کن.</p>
      </div>
      <a class="btn primary block" href="#/lesson/home">بعدی: پیدا کردن نت خانه</a>`;
  };
}

// نت خانه
function runHome(L) {
  const mode = store.get().settings.mode;
  main.innerHTML = `
    ${lessonHead(L)}
    <p class="muted">یه نت راحت و طبیعی رو، مثل وقتی که «اوم» می‌گی، با «آ» بخون و ۳ ثانیه ثابت نگهش دار. این نت خانه‌ی صدای توئه و تمرین‌ها از اینجا شروع می‌شن.</p>
    <div class="card center">
      <div class="status" id="ins" role="status">آماده‌ای؟</div>
      <div class="note-big" id="nb">–</div>
      <div class="meter" dir="ltr"><div class="meter-track"><div class="hold" id="hold"></div></div></div>
    </div>
    <canvas class="lane short" id="lane" role="img" aria-label="نمودار زنده‌ی زیر و بمی صدا"></canvas>
    <div id="err"></div>
    <div id="result"></div>
    <button class="btn primary block" id="go">شروع</button>`;
  const lane = new Lane($('#lane'), { span: 10, mode });
  lane.start();
  let off = null;
  let timeout = null;
  cleanup = () => { off?.(); clearTimeout(timeout); lane.stop(); };

  $('#go').onclick = async () => {
    const go = $('#go');
    go.classList.add('hidden');
    $('#result').innerHTML = '';
    try {
      await startMic();
    } catch (e) {
      $('#err').innerHTML = alertBox(micError(e));
      go.classList.remove('hidden');
      return;
    }
    $('#err').innerHTML = '';
    $('#ins').textContent = 'بخون و نگه دار…';
    let win = [];
    const finish = (ok, med, sd) => {
      off();
      off = null;
      clearTimeout(timeout);
      stopMic();
      if (!ok) {
        $('#ins').textContent = '';
        $('#result').innerHTML = alertBox('ثابت نگه داشتن نت اولش سخته و طبیعیه. آروم‌تر و با یه نت راحت‌تر دوباره امتحان کن.');
        go.textContent = 'دوباره';
        go.classList.remove('hidden');
        return;
      }
      const home = Math.round(med);
      const score = Math.max(0, Math.min(100, Math.round(100 - sd * 100 * 2)));
      store.update((s) => { s.home = home; });
      finishSession(L.id, score);
      $('#ins').textContent = 'پیدا شد ✓';
      $('#result').innerHTML = `
        <div class="card result">
          <p class="eyebrow">نت خانه‌ی تو</p>
          <h2>${esc(stepName(home).fa)} <span class="muted small">${stepName(home).latin}</span></h2>
          <p>ثبات صدا: <b>${fa(score)}٪</b></p>
        </div>
        <a class="btn primary block" href="#/lesson/match">بعدی: هم‌صدا شدن با نت</a>`;
    };
    timeout = setTimeout(() => finish(false), 15000);
    off = input.on((ev) => {
      lane.push(ev.t, ev.midi);
      if (ev.midi == null) {
        win = [];
        $('#hold').style.width = '0%';
        return;
      }
      $('#nb').textContent = nearest(ev.midi, mode).fa;
      win.push({ t: ev.t, m: ev.midi });
      while (win.length && ev.t - win[0].t > 1500) win.shift();
      const ms = win.map((p) => p.m);
      const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
      const sd = Math.sqrt(ms.reduce((a, b) => a + (b - mean) ** 2, 0) / ms.length);
      const dur = ev.t - win[0].t;
      const stable = sd <= 0.25;
      $('#hold').style.width = `${stable ? Math.min(100, (dur / 1400) * 100) : 0}%`;
      if (stable && dur >= 1400 && win.length >= 10) {
        const sorted = [...ms].sort((a, b) => a - b);
        finish(true, sorted[Math.floor(sorted.length / 2)], sd);
      }
    });
  };
}

// درس‌های «بشنو و تکرار کن»
function runSeq(L) {
  const mode = store.get().settings.mode;
  const targets = buildSeq(L.id);
  const tol = L.tol;
  main.innerHTML = `
    ${lessonHead(L)}
    <p class="muted">${esc(L.intro)}</p>
    <div class="card center">
      <div class="muted small" id="prog">${fa(targets.length)} نت</div>
      <div class="note-big" id="tn">${esc(stepName(targets[0]).fa)}</div>
      <div class="latin" id="tl">${stepName(targets[0]).latin}</div>
      <div class="status" id="st" role="status">آماده‌ای؟ بهتره با هدفون تمرین کنی.</div>
    </div>
    <canvas class="lane" id="lane" role="img" aria-label="نمودار زنده‌ی زیر و بمی صدا"></canvas>
    <div class="live" id="live">&nbsp;</div>
    <div id="err"></div>
    <button class="btn primary block" id="go">شروع</button>
    <div class="row hidden" id="ctl">
      <button class="btn grow" id="again">🔁 دوباره بشنو</button>
      <button class="btn grow" id="skip">رد کن</button>
    </div>
    <div id="result"></div>`;
  const lane = new Lane($('#lane'), { span: 8, mode });
  lane.setTarget(targets[0], tol);
  lane.start();
  const st = $('#st'), live = $('#live');
  let aborted = false;
  let off = null;
  let cur = null;
  cleanup = () => { aborted = true; off?.(); lane.stop(); };

  const scoreOf = (c) => (c.countedMs > 0 ? Math.round((100 * c.inTolMs) / c.countedMs) : 0);
  const finishNote = () => {
    if (!cur || cur.done) return;
    cur.done = true;
    cur.resolve(scoreOf(cur));
  };
  const hear = async () => {
    const c = cur;
    c.phase = 'listen';
    st.textContent = 'گوش کن… 👂';
    st.className = 'status listen';
    await playTone(audio(), midiToFreq(c.target), 1.3);
    if (aborted || c.done) return;
    c.phase = 'sing';
    c.singStart = performance.now();
    c.lastT = null;
    st.textContent = 'حالا تو بخون 🎤';
    st.className = 'status sing';
  };

  $('#go').onclick = async () => {
    try {
      await startMic();
    } catch (e) {
      $('#err').innerHTML = alertBox(micError(e));
      return;
    }
    $('#err').innerHTML = '';
    $('#go').classList.add('hidden');
    $('#ctl').classList.remove('hidden');
    off = input.on((ev) => {
      lane.push(ev.t, ev.midi == null ? null : fold(ev.midi, cur?.target));
      if (!cur || cur.phase !== 'sing' || cur.done) return;
      const now = ev.t;
      if (now - cur.singStart < 250) { cur.lastT = now; return; }
      const dt = cur.lastT == null ? 0 : Math.min(100, now - cur.lastT);
      cur.lastT = now;
      if (ev.midi != null) {
        const m = fold(ev.midi, cur.target);
        const diff = (m - cur.target) * 100;
        const inTol = Math.abs(diff) <= tol;
        cur.voicedMs += dt;
        if (cur.voicedMs > 300) {
          cur.countedMs += dt;
          if (inTol) cur.inTolMs += dt;
        }
        live.innerHTML = `تو: <b>${esc(nearest(m, mode).fa)}</b> · ${inTol ? '<span class="good">روی نتی ✓</span>' : diff > 0 ? '<span class="warn">کمی بالاتری ↓</span>' : '<span class="warn">کمی پایین‌تری ↑</span>'}`;
        announce(inTol ? 'روی نتی' : diff > 0 ? 'کمی بالاتری' : 'کمی پایین‌تری');
        if (cur.inTolMs >= 1500) finishNote();
      }
      if (now - cur.singStart > 8000) finishNote();
    });

    const scores = [];
    for (let i = 0; i < targets.length && !aborted; i++) {
      const target = targets[i];
      const n = stepName(target);
      $('#prog').textContent = `نت ${fa(i + 1)} از ${fa(targets.length)}`;
      $('#tn').textContent = n.fa;
      $('#tl').textContent = n.latin;
      lane.setTarget(target, tol);
      live.innerHTML = '&nbsp;';
      const sc = await new Promise((resolve) => {
        cur = { target, phase: 'listen', voicedMs: 0, countedMs: 0, inTolMs: 0, done: false, resolve };
        hear();
      });
      if (aborted) return;
      const heard = cur.voicedMs > 0;
      scores.push({ target, sc });
      st.className = 'status';
      st.textContent = !heard ? 'صدایی نشنیدم 🤔' : sc >= 80 ? `عالی! ${fa(sc)}٪ 🌟` : sc >= 50 ? `خوب بود: ${fa(sc)}٪` : `${fa(sc)}٪. تمرین بیشتر، دقت بیشتر.`;
      await sleep(1300);
    }
    if (aborted) return;
    off();
    off = null;
    stopMic();
    const total = Math.round(scores.reduce((a, b) => a + b.sc, 0) / scores.length);
    finishSession(L.id, total);
    $('#ctl').classList.add('hidden');
    st.textContent = 'تموم شد ✓';
    const best = store.get().lessons[L.id].best;
    $('#result').innerHTML = `
      <div class="card result">
        <p class="eyebrow">امتیاز این تمرین</p>
        <div class="score">${fa(total)}٪</div>
        <p class="muted">بهترین امتیازت در این درس: ${fa(best)}٪</p>
        <ul class="note-scores">${scores.map((x) => `<li><span>${esc(stepName(x.target).fa)}</span><span class="${x.sc >= 80 ? 'good' : x.sc >= 50 ? '' : 'warn'}">${fa(x.sc)}٪</span></li>`).join('')}</ul>
      </div>
      <div class="row">
        <button class="btn grow" id="retry">دوباره</button>
        <a class="btn primary grow" href="#/">خانه</a>
      </div>`;
    $('#retry').onclick = () => route();
  };
  $('#again').onclick = () => { if (cur && !cur.done && cur.phase === 'sing') hear(); };
  $('#skip').onclick = () => finishNote();
}

function viewProgress() {
  const s = store.get();
  const scored = s.sessions.filter((x) => x.score != null).slice(-20);
  const lessonTitle = (id) => LESSONS.find((l) => l.id === id)?.title || id;
  const vt = s.range ? estimateVoiceType(s.range.low, s.range.high, s.settings.voice) : null;
  const W = 320, H = 150, bw = scored.length ? W / scored.length : 0;
  const bars = scored.map((x, i) => {
    const h = Math.max(2, (x.score / 100) * (H - 20));
    return `<rect x="${i * bw + 2}" y="${H - h}" width="${Math.max(2, bw - 4)}" height="${h}" rx="3" class="${x.score >= 80 ? 'bar-good' : 'bar'}"><title>${esc(lessonTitle(x.lesson))}: ${fa(x.score)}٪</title></rect>`;
  }).join('');
  main.innerHTML = `
    <h1 class="page-title">پیشرفت من</h1>
    <section class="stats">
      <div class="stat"><b>${fa(streak())}</b><span>روز پشت‌سرهم</span></div>
      <div class="stat"><b>${fa(s.days.length)}</b><span>روز تمرین</span></div>
      <div class="stat"><b>${fa(s.sessions.length)}</b><span>تمرین</span></div>
    </section>
    <div class="card">
      <h2 class="h3">صدای من</h2>
      ${s.range
        ? `<p>محدوده: <b>${esc(stepName(s.range.low).fa)}</b> تا <b>${esc(stepName(s.range.high).fa)}</b> (${fa(s.range.high - s.range.low)} نیم‌پرده)</p>
           <p>تیپ صدای تخمینی: <b>${esc(vt.fa)}</b></p>`
        : '<p class="muted">هنوز تست محدوده رو انجام ندادی.</p><a class="btn small" href="#/lesson/range">انجام تست</a>'}
      ${s.home != null ? `<p>نت خانه: <b>${esc(stepName(s.home).fa)}</b></p>` : ''}
    </div>
    <div class="card">
      <h2 class="h3">امتیاز ۲۰ تمرین آخر</h2>
      ${scored.length
        ? `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="نمودار امتیاز تمرین‌ها"><line x1="0" x2="${W}" y1="${H - (0.8 * (H - 20))}" y2="${H - (0.8 * (H - 20))}" class="goal"/>${bars}</svg>
           <p class="muted small">خط‌چین: امتیاز ۸۰٪</p>`
        : '<p class="muted">بعد از اولین تمرین، نمودارت اینجا نشون داده می‌شه.</p>'}
    </div>
    <div class="card">
      <h2 class="h3">درس‌ها</h2>
      <ul class="note-scores">
        ${LESSONS.map((l) => {
          const r = s.lessons[l.id];
          return `<li><span>${l.icon} ${esc(l.title)}</span><span class="muted">${r ? `${fa(r.count)} بار${r.best != null ? ` · بهترین ${fa(r.best)}٪` : ''}` : '—'}</span></li>`;
        }).join('')}
      </ul>
    </div>`;
}

function viewSettings() {
  const s = store.get().settings;
  main.innerHTML = `
    <h1 class="page-title">تنظیمات</h1>
    <div class="card">
      <h2 class="h3">نمایش نت‌ها</h2>
      <label class="opt"><input type="radio" name="mode" value="irani" ${s.mode === 'irani' ? 'checked' : ''}> ایرانی: با ربع‌پرده‌ها (کرن و سری)</label>
      <label class="opt"><input type="radio" name="mode" value="gharbi" ${s.mode === 'gharbi' ? 'checked' : ''}> غربی: فقط نیم‌پرده‌ها</label>
    </div>
    <div class="card">
      <h2 class="h3">صدا</h2>
      <label class="opt"><input type="radio" name="voice" value="male" ${s.voice === 'male' ? 'checked' : ''}> مردانه</label>
      <label class="opt"><input type="radio" name="voice" value="female" ${s.voice === 'female' ? 'checked' : ''}> زنانه</label>
    </div>
    <div class="card">
      <h2 class="h3">میکروفون</h2>
      <p class="muted small">${s.micGate != null
        ? 'حساسیت میکروفون با محیط تو تنظیم شده. اگه جای تمرینت عوض شد، دوباره تست کن.'
        : 'اگه آوازیار صدات رو خوب نمی‌شنوه، این تست حساسیت میکروفون رو با محیطت تنظیم می‌کنه.'}</p>
      <a class="btn" href="#/mic">تست میکروفون</a>
    </div>
    <div class="card">
      <h2 class="h3">داده‌ها</h2>
      <p class="muted small">همه‌ی پیشرفتت فقط روی همین دستگاه ذخیره شده. اگه داده‌های مرورگر پاک بشه، پیشرفتت هم پاک می‌شه؛ پس هر از گاهی یه فایل پشتیبان بگیر.</p>
      <p class="muted small" id="persist"></p>
      <div class="row">
        <button class="btn grow" id="export">گرفتن پشتیبان</button>
        <button class="btn grow" id="import">بازگردانی پشتیبان</button>
      </div>
      <input type="file" id="file" accept="application/json,.json" class="hidden">
      <div id="datamsg"></div>
      <button class="btn danger" id="reset">پاک کردن همه‌ی داده‌ها</button>
    </div>
    <div class="card">
      <h2 class="h3">درباره‌ی آوازیار</h2>
      <p class="muted small">نسخه‌ی ${fa(VERSION)} · نام نت‌ها به روش ایرانی: «دو» همون C است. آوازیار جایگزین استاد آواز نیست. برای تکنیک درست و سلامت صدا، هر از گاهی از یه استاد بازخورد بگیر.</p>
    </div>`;
  main.querySelectorAll('input[name=mode]').forEach((r) => {
    r.onchange = () => store.update((st) => { st.settings.mode = r.value; });
  });
  main.querySelectorAll('input[name=voice]').forEach((r) => {
    r.onchange = () => store.update((st) => { st.settings.voice = r.value; });
  });
  navigator.storage?.persisted?.().then((ok) => {
    const el = $('#persist');
    if (el) el.textContent = ok
      ? 'مرورگر این داده‌ها رو ماندگار نگه می‌داره.'
      : 'مرورگر ممکنه بعد از مدتی استفاده نکردن، این داده‌ها رو پاک کنه. نصب برنامه روی گوشی جلوی این رو می‌گیره.';
  }).catch(() => {});

  $('#export').onclick = async () => {
    const name = `avazyar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([exportData()], name, { type: 'application/json' });
    // روی آیفون برگه‌ی اشتراک‌گذاری مطمئن‌تر از دانلود مستقیم است
    if (isIOS && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch {}
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('#datamsg').innerHTML = `<p class="muted small">فایل پشتیبان ذخیره شد: <span dir="ltr">${esc(name)}</span></p>`;
  };
  $('#import').onclick = () => $('#file').click();
  $('#file').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!confirm('پیشرفت فعلی با محتوای این فایل جایگزین بشه؟')) return;
    try {
      if (f.size > 2_000_000) throw new Error('invalid');
      importData(await f.text());
    } catch (err) {
      $('#datamsg').innerHTML = alertBox(err.message === 'newer'
        ? 'این فایل با نسخه‌ی جدیدتری از آوازیار ساخته شده. اول برنامه رو به‌روز کن.'
        : 'این فایل، پشتیبان آوازیار نیست یا خراب شده. چیزی عوض نشد.');
      return;
    }
    viewSettings();
    $('#datamsg').innerHTML = '<p class="good small" role="status">پشتیبان بازگردانی شد ✓</p>';
  };
  $('#reset').onclick = () => {
    if (confirm('همه‌ی پیشرفت و تنظیمات پاک بشه؟ این کار برگشت‌پذیر نیست.')) {
      store.reset();
      location.hash = '#/welcome';
    }
  };
}

// تست میکروفون: سر و صدای محیط و بلندی صدای کاربر را می‌سنجد و حساسیت را با آن تنظیم می‌کند
function viewMic() {
  const MESSAGES = {
    ok: 'میکروفون خوب کار می‌کنه ✓ حساسیتش با محیط تو تنظیم شد.',
    silent: 'صدات رو نشنیدم. مطمئن شو میکروفون درست انتخاب شده، کمی نزدیک‌تر شو و دوباره امتحان کن.',
    weak: 'صدات نسبت به سر و صدای محیط ضعیفه. گوشی رو نزدیک‌تر بگیر (حدود یه وجب) یا کمی بلندتر بخون.',
    noisy: 'محیط پر سر و صداست. اگه می‌تونی جای ساکت‌تری تمرین کن یا از هدست میکروفون‌دار استفاده کن.',
    loud: 'صدا خیلی بلند به میکروفون می‌رسه و ممکنه خراب ثبت بشه. کمی از گوشی فاصله بگیر.',
  };
  main.innerHTML = `
    <a class="back" href="#/settings">→ بازگشت</a>
    <h1 class="page-title">تست میکروفون</h1>
    <p class="muted">دو مرحله‌ی کوتاه داره: اول چند ثانیه ساکت بمون تا سر و صدای محیط اندازه گرفته بشه، بعد یه «آ»ی معمولی بکش.</p>
    <div class="card center">
      <div class="status" id="ins" role="status">آماده‌ای؟</div>
      <div class="level" dir="ltr" aria-hidden="true"><div class="level-fill" id="lvl"></div></div>
      <div class="countdown" id="cd">&nbsp;</div>
    </div>
    <div id="err"></div>
    <div id="result"></div>
    <button class="btn primary block" id="go">شروع تست</button>`;
  let off = null;
  let stopped = false;
  cleanup = () => { stopped = true; off?.(); };
  const pct = (arr, p) => {
    const s = [...arr].sort((a, b) => a - b);
    return s.length ? s[Math.floor(p * (s.length - 1))] : 0;
  };

  $('#go').onclick = async () => {
    const go = $('#go');
    go.classList.add('hidden');
    $('#result').innerHTML = '';
    try {
      await startMic();
    } catch (e) {
      $('#err').innerHTML = alertBox(micError(e));
      go.classList.remove('hidden');
      return;
    }
    $('#err').innerHTML = '';
    input.setGate(gateFor(0));
    let frames = [];
    off = input.on((ev) => {
      frames.push(ev);
      const db = 20 * Math.log10(Math.max(ev.rms, 1e-4));
      $('#lvl').style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
    });
    const phase = async (text, secs) => {
      $('#ins').textContent = text;
      await sleep(600); // صدای لمس دکمه را حساب نکن
      frames = [];
      for (let i = secs; i > 0 && !stopped; i--) {
        $('#cd').textContent = fa(i);
        await sleep(1000);
      }
      return frames;
    };
    const quiet = await phase('ساکت بمون… 🤫', 3);
    if (stopped) return;
    const noise = pct(quiet.map((f) => f.rms), 0.9);
    const gate = gateFor(noise);
    input.setGate(gate);
    const sung = await phase('حالا یه «آ» بکش و نگهش دار 🎤', 4);
    if (stopped) return;
    off();
    off = null;
    stopMic();
    const voiced = sung.filter((f) => f.midi != null);
    const verdict = micVerdict({
      noise,
      level: pct(voiced.map((f) => f.rms), 0.5),
      peak: pct(sung.map((f) => f.rms), 0.95),
      voiced: voiced.length,
    });
    if (verdict !== 'silent') store.update((s) => { s.settings.micGate = gate; });
    $('#cd').textContent = '';
    $('#lvl').style.width = '0%';
    $('#ins').textContent = 'تموم شد';
    $('#result').innerHTML = `
      <div class="card result">
        <p class="eyebrow">نتیجه</p>
        <p class="${verdict === 'ok' ? 'good' : ''}">${esc(MESSAGES[verdict])}</p>
      </div>
      ${verdict === 'ok' ? '<a class="btn primary block" href="#/">برگشت به تمرین</a>' : ''}`;
    go.textContent = 'دوباره';
    go.classList.toggle('primary', verdict !== 'ok');
    go.classList.remove('hidden');
  };
}

// ---------- خطاها و به‌روزرسانی ----------

function showFatal(err) {
  console.error(err);
  stopMic();
  if ($('#fatal')) return;
  main.insertAdjacentHTML('afterbegin', `
    <div class="alert" id="fatal" role="alert">
      <p>یه مشکل غیرمنتظره پیش اومد. اگه برنامه درست کار نمی‌کنه، صفحه رو دوباره بارگذاری کن. پیشرفتت سر جاشه.</p>
      <button class="btn small" id="reload">بارگذاری دوباره</button>
    </div>`);
  $('#reload').onclick = () => location.reload();
}

window.addEventListener('error', (e) => showFatal(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showFatal(e.reason));

function toast(text, label, action) {
  $('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(text)}</span><button class="btn small">${esc(label)}</button>`;
  el.querySelector('button').onclick = action;
  document.body.append(el);
}

// اگر نسخه‌ی روی سرور با نسخه‌ی در حال اجرا فرق داشت، پیشنهاد تازه‌سازی می‌دهیم (وسط تمرین چیزی را قطع نمی‌کنیم)
async function checkVersion() {
  try {
    const text = await (await fetch('js/version.js', { cache: 'no-store' })).text();
    const latest = text.match(/AVAZYAR_VERSION\s*=\s*'([^']+)'/)?.[1];
    if (latest && latest !== VERSION) toast(`نسخه‌ی ${fa(latest)} آماده‌ست.`, 'تازه‌سازی', () => location.reload());
  } catch {}
}

// ---------- راه‌اندازی ----------

window.addEventListener('hashchange', route);
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  if (!location.hash || location.hash === '#/') viewHome();
});
if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('sim')) {
  const sw = navigator.serviceWorker;
  sw.register('sw.js').catch(() => {});
  sw.addEventListener('controllerchange', checkVersion);
  // برنامه‌ی نصب‌شده ممکن است روزها باز بماند؛ هر بار که جلو می‌آید دنبال نسخه‌ی جدید می‌گردیم
  let lastCheck = performance.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || performance.now() - lastCheck < 300_000) return;
    lastCheck = performance.now();
    checkVersion();
    sw.getRegistration().then((r) => r?.update()).catch(() => {});
  });
}
route();

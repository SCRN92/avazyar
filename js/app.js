import { PitchInput, DEFAULT_GATE, gateFor, micVerdict } from './pitch.js';
import { playTone, startDrone } from './synth.js';
import { fa, nearest, stepName, midiToFreq, estimateVoiceType, fold } from './notes.js';
import { store, recordSession, setRange, setLevel, recordSustain, recordNotes, bestSustain, streak, exportData, importData } from './store.js';
import { LESSONS, PASS, EAR_QUESTIONS, SESSION_LENGTHS, voiceRange, buildNotes, levelCount, clampLevel, tolFor, levelAfter, suggestNext, earQuestion, planSession } from './lessons.js';
import { SustainTracker } from './exercise.js';
import { weekSummary, lessonTrends, rangeGrowth, noteStats } from './stats.js';
import { sparkline, rangeChart } from './charts.js';
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
  const step = sessionStep();
  if (step?.id === lessonId) {
    step.done = true;
    if (score != null) step.score = Math.max(step.score ?? 0, score);
  }
}

// ---------- تمرین امروز ----------

// جلسه‌ی در حال انجام: { plan: [{ id, why, done, score }], index, startedAt }. فقط در حافظه می‌ماند.
let session = null;
const SESSION_MAX_AGE = 3 * 3600 * 1000;

function activeSession() {
  if (session && Date.now() - session.startedAt > SESSION_MAX_AGE) session = null;
  return session;
}

const sessionStep = () => activeSession()?.plan[session.index];
const inSession = (L) => sessionStep()?.id === L.id;
const lessonById = (id) => LESSONS.find((l) => l.id === id);

// دکمه‌ی اصلی بعد از تمام شدن یک درس: در «تمرین امروز» به قدم بعد می‌رود، وگرنه همان مقصد همیشگی
function nextLink(L, cls, href, label) {
  if (inSession(L)) {
    const next = session.plan[session.index + 1];
    href = '#/session/next';
    label = next ? `بعدی: ${lessonById(next.id).title}` : 'پایان تمرین امروز';
  }
  return `<a class="btn primary ${cls}" href="${href}">${esc(label)}</a>`;
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

const lessonLevel = (L) => clampLevel(L, store.get().lessons[L.id]?.level);

const levelLine = (L, extra = '') => (levelCount(L) > 1
  ? `<p class="muted small">سطح ${fa(lessonLevel(L) + 1)} از ${fa(levelCount(L))}${extra}</p>`
  : '');

// بعد از یک تمرین امتیازدار: ذخیره می‌کند و اگر امتیاز کافی بود به سطح بعد می‌برد. متن نتیجه را برمی‌گرداند.
function finishScored(L, level, score) {
  finishSession(L.id, score);
  const next = levelAfter(L, level, score);
  if (next > level) {
    setLevel(L.id, next);
    return `<p class="good">رفتی سطح ${fa(next + 1)} 🎉 از این به بعد دقت بیشتری لازمه.</p>`;
  }
  if (score >= PASS && level === levelCount(L) - 1) return '<p class="good">این درس رو خوب بلدی ✓</p>';
  return '';
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
  session: viewSession,
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
  if (store.frozen && !$('#frozen')) {
    main.insertAdjacentHTML('afterbegin', `
      <div class="alert" id="frozen" role="alert">
        <p>پیشرفت ذخیره‌شده‌ی تو با نسخه‌ی جدیدتری از آوازیار ساخته شده و این نسخه نمی‌تونه بخوندش. صفحه رو تازه کن تا نسخه‌ی جدید بیاد. تا اون موقع پیشرفتت دست‌نخورده می‌مونه و تمرین‌های الان ذخیره نمی‌شن.</p>
        <button class="btn small" id="refresh">تازه‌سازی</button>
      </div>`);
    $('#refresh').onclick = () => location.reload();
  }
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
  const step = sessionStep();
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
      <p class="eyebrow">تمرین امروز</p>
      ${step ? `
      <h2>${lessonById(step.id).icon} ${esc(lessonById(step.id).title)}</h2>
      <p class="muted">قدم ${fa(session.index + 1)} از ${fa(session.plan.length)}</p>
      <a class="btn primary block" href="#/session">ادامه</a>` : `
      <h2>چقدر وقت داری؟</h2>
      <p class="muted">یه برنامه‌ی کوتاه برات می‌چینیم: گرم کردن، یه چیز تازه، و مرور جاهایی که تمرین بیشتری می‌خوان.</p>
      <div class="row">
        ${SESSION_LENGTHS.map((m) => `<a class="btn grow${m === 10 ? ' primary' : ''}" href="#/session/${m}">${fa(m)} دقیقه</a>`).join('')}
      </div>`}
    </section>
    <h2 class="h3 section-title">درس‌ها</h2>
    <ol class="lessons">
      ${LESSONS.map((l, i) => {
        const r = s.lessons[l.id];
        const badge = r?.best != null ? `<span class="badge">${fa(r.best)}٪</span>` : r?.count ? '<span class="badge done">✓</span>' : '';
        return `<li><a href="#/lesson/${l.id}">
          <span class="num">${fa(i + 1)}</span>
          <span class="li-text"><b>${l.icon} ${esc(l.title)}</b><span class="muted small">${esc(l.sub)}${levelCount(l) > 1 && r?.level ? ` · سطح ${fa(r.level + 1)}` : ''}</span></span>
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
    <button class="btn primary block" id="go">روشن کردن میکروفون</button>
    <div class="card">
      <h2 class="h3">نت پایه</h2>
      <p class="muted small">یه نت ثابت پخش می‌شه تا بقیه‌ی نت‌ها رو نسبت به اون بخونی و فاصله‌ها دستت بیاد. حتماً با هدفون گوش بده، وگرنه میکروفون صدای خود نت پایه رو می‌گیره.</p>
      <div class="row stepper">
        <button class="btn" id="dlow" aria-label="نت پایه نیم‌پرده پایین‌تر">−</button>
        <div class="grow center"><b class="drone-note" id="dname"></b> <span class="latin" id="dlatin"></span></div>
        <button class="btn" id="dhigh" aria-label="نت پایه نیم‌پرده بالاتر">+</button>
      </div>
      <button class="btn block" id="drone" aria-pressed="false">پخش نت پایه</button>
    </div>`;
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
  let droneNote = voiceRange(store.get()).home;
  let drone = null;
  const showDrone = () => {
    const n = stepName(droneNote);
    $('#dname').textContent = n.fa;
    $('#dlatin').textContent = n.latin;
  };
  const shiftDrone = (d) => {
    droneNote = Math.min(84, Math.max(36, droneNote + d));
    showDrone();
    drone?.setFreq(midiToFreq(droneNote));
  };
  $('#dlow').onclick = () => shiftDrone(-1);
  $('#dhigh').onclick = () => shiftDrone(1);
  $('#drone').onclick = () => {
    if (drone) {
      drone.stop();
      drone = null;
    } else {
      drone = startDrone(audio(), midiToFreq(droneNote));
    }
    $('#drone').textContent = drone ? 'قطع نت پایه' : 'پخش نت پایه';
    $('#drone').setAttribute('aria-pressed', String(!!drone));
  };
  showDrone();
  cleanup = () => { off?.(); lane.stop(); drone?.stop(); };
}

function lessonHead(L) {
  const top = inSession(L)
    ? `<nav class="session-bar" aria-label="تمرین امروز">
        <span>تمرین امروز · قدم ${fa(session.index + 1)} از ${fa(session.plan.length)}</span>
        <span><a href="#/session/next">رد کن</a> · <a href="#/session/end">پایان</a></span>
      </nav>`
    : '<a class="back" href="#/">→ بازگشت</a>';
  return `${top}<h1 class="page-title">${L.icon} ${esc(L.title)}</h1>`;
}

const WHY = { warmup: 'گرم کردن', new: 'تازه', retest: 'سنجش دوباره', weak: 'تمرین بیشتر', practice: 'مرور' };

function viewSession(arg) {
  const s = activeSession();
  // «بعدی» و «پایان» فقط جلسه را جلو می‌برند و در تاریخچه‌ی مرورگر نمی‌مانند، تا دکمه‌ی برگشت دوباره اجراشان نکند
  if (arg === 'next' || arg === 'end') {
    if (!s) return location.replace('#/');
    if (arg === 'next') s.index++;
    if (arg === 'end' || s.index >= s.plan.length) return location.replace('#/session/done');
    return location.replace(`#/lesson/${s.plan[s.index].id}`);
  }
  if (arg === 'done') return sessionSummary();
  if (s) return location.replace(`#/lesson/${s.plan[s.index].id}`);

  const minutes = SESSION_LENGTHS.includes(Number(arg)) ? Number(arg) : 10;
  const plan = planSession(store.get(), minutes);
  const total = plan.reduce((a, x) => a + lessonById(x.id).mins, 0);
  main.innerHTML = `
    <a class="back" href="#/">→ بازگشت</a>
    <h1 class="page-title">تمرین امروز</h1>
    <div class="row" role="group" aria-label="مدت تمرین">
      ${SESSION_LENGTHS.map((m) => `<a class="btn grow${m === minutes ? ' primary' : ''}" href="#/session/${m}"${m === minutes ? ' aria-current="true"' : ''}>${fa(m)} دقیقه</a>`).join('')}
    </div>
    <ol class="steps">
      ${plan.map((x) => {
        const L = lessonById(x.id);
        return `<li><span>${L.icon} ${esc(L.title)}</span><span class="muted small">${WHY[x.why]}</span></li>`;
      }).join('')}
    </ol>
    <p class="muted small">${fa(plan.length)} قدم، حدود ${fa(Math.round(total))} دقیقه. هر قدم رو می‌تونی رد کنی یا هر وقت خواستی تمومش کنی.</p>
    <button class="btn primary block" id="start">شروع</button>`;
  $('#start').onclick = () => {
    session = { plan, index: 0, startedAt: Date.now() };
    location.hash = `#/lesson/${plan[0].id}`;
  };
}

function sessionSummary() {
  const s = session;
  session = null;
  const done = s ? s.plan.filter((x) => x.done) : [];
  if (!done.length) return location.replace('#/');
  const mins = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
  main.innerHTML = `
    <h1 class="page-title">تمرین امروز تموم شد 🎉</h1>
    <section class="stats">
      <div class="stat"><b>${fa(done.length)}</b><span>قدم از ${fa(s.plan.length)}</span></div>
      <div class="stat"><b>${fa(mins)}</b><span>دقیقه</span></div>
      <div class="stat"><b>${fa(streak())}</b><span>روز پشت‌سرهم</span></div>
    </section>
    <div class="card">
      <ul class="note-scores">
        ${s.plan.map((x) => {
          const L = lessonById(x.id);
          const result = !x.done ? '<span class="muted">رد شد</span>'
            : x.score != null ? `<span class="${x.score >= PASS ? 'good' : ''}">${fa(x.score)}٪</span>` : '<span class="good">✓</span>';
          return `<li><span>${L.icon} ${esc(L.title)}</span>${result}</li>`;
        }).join('')}
      </ul>
    </div>
    <a class="btn primary block" href="#/">خانه</a>`;
}

function viewLesson(id) {
  const L = LESSONS.find((l) => l.id === id);
  if (!L) {
    location.hash = '#/';
    return;
  }
  ({ warmup: runWarmup, range: runRange, home: runHome, seq: runSeq, sustain: runSustain, ear: runEar })[L.kind](L);
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
    main.insertAdjacentHTML('beforeend', nextLink(L, 'block', `#/lesson/${suggestNext(store.get()).id}`, 'برو سراغ تمرین بعدی'));
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
      ${nextLink(L, 'block', '#/lesson/home', 'بعدی: پیدا کردن نت خانه')}`;
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
        ${nextLink(L, 'block', '#/lesson/match', 'بعدی: هم‌صدا شدن با نت')}`;
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
  const level = lessonLevel(L);
  const targets = buildNotes(L, voiceRange(store.get()));
  main.innerHTML = `
    ${lessonHead(L)}
    <p class="muted">${esc(L.intro)}</p>
    ${levelLine(L, ` · دقت لازم: ${fa(L.tols[level])} سنت`)}
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
  lane.setTarget(targets[0], tolFor(L, level, targets[0]));
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
  // یک نت را پخش می‌کند و امتیاز خواندن کاربر را برمی‌گرداند (اگر کاربر از صفحه رفته باشد: null)
  const singNote = async (target, label) => {
    const n = stepName(target);
    const tol = tolFor(L, level, target);
    $('#prog').textContent = label;
    $('#tn').textContent = n.fa;
    $('#tl').textContent = n.latin;
    lane.setTarget(target, tol);
    live.innerHTML = '&nbsp;';
    const sc = await new Promise((resolve) => {
      cur = { target, tol, phase: 'listen', voicedMs: 0, countedMs: 0, inTolMs: 0, devMs: 0, done: false, resolve };
      hear();
    });
    if (aborted) return null;
    const heard = cur.voicedMs > 0;
    st.className = 'status';
    st.textContent = !heard ? 'صدایی نشنیدم 🤔' : sc >= 80 ? `عالی! ${fa(sc)}٪ 🌟` : sc >= 50 ? `خوب بود: ${fa(sc)}٪` : `${fa(sc)}٪. تمرین بیشتر، دقت بیشتر.`;
    // dev: میانگین فاصله از نت هدف به سنت (مثبت یعنی بالاتر)؛ اگر صدایی نبود null
    const dev = cur.countedMs > 0 ? cur.devMs / cur.countedMs : null;
    await sleep(1300);
    return aborted ? null : { sc, dev };
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
        const inTol = Math.abs(diff) <= cur.tol;
        cur.voicedMs += dt;
        if (cur.voicedMs > 300) {
          cur.countedMs += dt;
          cur.devMs += diff * dt;
          if (inTol) cur.inTolMs += dt;
        }
        live.innerHTML = `تو: <b>${esc(nearest(m, mode).fa)}</b> · ${inTol ? '<span class="good">روی نتی ✓</span>' : diff > 0 ? '<span class="warn">کمی بالاتری ↓</span>' : '<span class="warn">کمی پایین‌تری ↑</span>'}`;
        announce(inTol ? 'روی نتی' : diff > 0 ? 'کمی بالاتری' : 'کمی پایین‌تری');
        if (cur.inTolMs >= 1500) finishNote();
      }
      if (now - cur.singStart > 8000) finishNote();
    });

    const scores = [];
    for (const [i, target] of targets.entries()) {
      const got = await singNote(target, `نت ${fa(i + 1)} از ${fa(targets.length)}`);
      if (!got) return;
      scores.push({ target, ...got });
    }
    // یک دور دیگر برای نت‌هایی که سخت بودند؛ امتیاز بهتر حساب می‌شود
    const weak = scores.filter((x) => x.sc < 50).slice(0, 3);
    if (weak.length && weak.length < scores.length) {
      st.textContent = 'یه بار دیگه، نت‌هایی که سخت بودن…';
      await sleep(1500);
      if (aborted) return;
      for (const [k, x] of weak.entries()) {
        const got = await singNote(x.target, `تکرار: نت ${fa(k + 1)} از ${fa(weak.length)}`);
        if (!got) return;
        if (got.sc > x.sc) Object.assign(x, got);
      }
    }
    off();
    off = null;
    stopMic();
    const total = Math.round(scores.reduce((a, b) => a + b.sc, 0) / scores.length);
    const levelNote = finishScored(L, level, total);
    recordNotes(scores.filter((x) => x.dev != null).map((x) => ({ step: x.target, score: x.sc, dev: x.dev })));
    $('#ctl').classList.add('hidden');
    st.textContent = 'تموم شد ✓';
    const best = store.get().lessons[L.id].best;
    $('#result').innerHTML = `
      <div class="card result">
        <p class="eyebrow">امتیاز این تمرین</p>
        <div class="score">${fa(total)}٪</div>
        <p class="muted">بهترین امتیازت در این درس: ${fa(best)}٪</p>
        ${levelNote}
        <ul class="note-scores">${scores.map((x) => `<li><span>${esc(stepName(x.target).fa)}</span><span class="${x.sc >= 80 ? 'good' : x.sc >= 50 ? '' : 'warn'}">${fa(x.sc)}٪</span></li>`).join('')}</ul>
      </div>
      <div class="row">
        <button class="btn grow" id="retry">دوباره</button>
        ${nextLink(L, 'grow', '#/', 'خانه')}
      </div>`;
    $('#retry').onclick = () => route();
  };
  $('#again').onclick = () => { if (cur && !cur.done && cur.phase === 'sing') hear(); };
  $('#skip').onclick = () => finishNote();
}

// نفس و نگه داشتن نت
function runSustain(L) {
  const mode = store.get().settings.mode;
  const record = bestSustain();
  main.innerHTML = `
    ${lessonHead(L)}
    <p class="muted">یه نفس آروم از شکم بگیر و یه نت راحت رو با «آ» تا جایی که راحتی، یکنواخت نگه دار. قبل از اینکه نفست تموم بشه رها کن؛ قرار نیست به خودت فشار بیاری.</p>
    ${record ? `<p class="muted small">طولانی‌ترین نتت تا حالا: ${fa(record)} ثانیه</p>` : ''}
    <div class="card center">
      <div class="status" id="ins" role="status">آماده‌ای؟</div>
      <div class="note-big" id="nb">–</div>
      <div class="countdown" id="cd">&nbsp;</div>
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
    $('#ins').textContent = 'هر وقت آماده بودی، بخون و نگه دار…';
    $('#nb').textContent = '–';
    $('#cd').innerHTML = '&nbsp;';
    const tracker = new SustainTracker();
    const finish = () => {
      off();
      off = null;
      clearTimeout(timeout);
      stopMic();
      const r = tracker.result();
      go.textContent = 'دوباره';
      go.classList.remove('hidden');
      if (!r || r.secs < 2) {
        $('#ins').textContent = '';
        $('#result').innerHTML = r
          ? alertBox('خیلی کوتاه بود. یه نفس آروم بگیر و نت رو دست‌کم دو ثانیه نگه دار.')
          : alertBox('صدایی نشنیدم. کمی بلندتر یا نزدیک‌تر به گوشی بخون. اگه باز هم نشد، تست میکروفون رو انجام بده.', micCheckLink);
        return;
      }
      const before = bestSustain();
      finishSession(L.id, r.steady);
      recordSustain(r.secs, r.steady);
      go.classList.remove('primary');
      $('#ins').textContent = 'تموم شد ✓';
      $('#result').innerHTML = `
        <div class="card result">
          <p class="eyebrow">نتیجه</p>
          <h2>${fa(r.secs)} ثانیه روی ${esc(nearest(r.note, mode).fa)}</h2>
          <p>یکنواختی صدا: <b>${fa(r.steady)}٪</b></p>
          ${before && r.secs > before ? '<p class="good">رکورد جدید 🎉</p>' : ''}
          <p class="muted small">نفس عمیق از شکم و رها بودن شونه‌ها کمک می‌کنه نت رو طولانی‌تر و یکنواخت‌تر نگه داری. هیچ‌وقت تا آخرین ذره‌ی نفست نرو.</p>
        </div>
        ${nextLink(L, 'block', '#/', 'خانه')}`;
    };
    timeout = setTimeout(() => { if (!tracker.started) finish(); }, 15000);
    off = input.on((ev) => {
      lane.push(ev.t, ev.midi);
      const wasStarted = tracker.started;
      const done = tracker.push(ev.t, ev.midi);
      if (tracker.started && !wasStarted) $('#ins').textContent = 'همین‌طور آروم نگهش دار…';
      if (tracker.started) {
        $('#nb').textContent = nearest(tracker.center, mode).fa;
        $('#cd').textContent = `${fa((tracker.ms / 1000).toFixed(1))} ثانیه`;
      }
      if (done) finish();
    });
  };
}

// درس‌های گوش: فقط شنیدن و انتخاب، بدون میکروفون
function runEar(L) {
  const level = lessonLevel(L);
  const voice = voiceRange(store.get());
  main.innerHTML = `
    ${lessonHead(L)}
    <p class="muted">${esc(L.intro)}</p>
    ${levelLine(L)}
    <div class="card center">
      <div class="muted small" id="prog">${fa(EAR_QUESTIONS)} سؤال</div>
      <div class="status" id="st" role="status">آماده‌ای؟</div>
      <div class="live" id="live">&nbsp;</div>
      <div class="row" id="choices"></div>
    </div>
    <button class="btn primary block" id="go">شروع</button>
    <button class="btn block hidden" id="again">🔁 دوباره بشنو</button>
    <div id="result"></div>`;
  const st = $('#st'), live = $('#live'), box = $('#choices');
  let aborted = false;
  let q = null;
  let waiting = false; // منتظر جواب کاربر
  cleanup = () => { aborted = true; };
  const setChoices = (on) => box.querySelectorAll('button').forEach((b) => { b.disabled = !on; });

  const play = async () => {
    waiting = false;
    setChoices(false);
    st.textContent = 'گوش کن… 👂';
    st.className = 'status listen';
    for (const m of q.tones) {
      await playTone(audio(), midiToFreq(m), 0.8);
      if (aborted) return;
      await sleep(150);
    }
    st.textContent = 'کدوم بود؟';
    st.className = 'status sing';
    setChoices(true);
    waiting = true;
  };

  $('#go').onclick = async () => {
    audio();
    $('#go').classList.add('hidden');
    $('#again').classList.remove('hidden');
    let right = 0;
    for (let i = 0; i < EAR_QUESTIONS; i++) {
      q = earQuestion(L, level, voice);
      $('#prog').textContent = `سؤال ${fa(i + 1)} از ${fa(EAR_QUESTIONS)}`;
      live.innerHTML = '&nbsp;';
      box.innerHTML = q.choices.map((c, k) => `<button class="btn grow" data-k="${k}" disabled>${esc(c.label)}</button>`).join('');
      const picked = new Promise((resolve) => {
        box.querySelectorAll('button').forEach((b) => { b.onclick = () => resolve(q.choices[b.dataset.k]); });
      });
      await play();
      if (aborted) return;
      const choice = await picked;
      if (aborted) return;
      waiting = false;
      setChoices(false);
      if (choice.right) right++;
      st.className = 'status';
      st.textContent = choice.right ? 'درست ✓' : `این بار نه. جواب: ${q.choices.find((c) => c.right).label}`;
      live.textContent = `${q.names[0]}، بعد ${q.names[1]}`;
      await sleep(1500);
      if (aborted) return;
    }
    const score = Math.round((100 * right) / EAR_QUESTIONS);
    const levelNote = finishScored(L, level, score);
    $('#again').classList.add('hidden');
    box.innerHTML = '';
    live.innerHTML = '&nbsp;';
    st.textContent = 'تموم شد ✓';
    $('#result').innerHTML = `
      <div class="card result">
        <p class="eyebrow">امتیاز این تمرین</p>
        <div class="score">${fa(score)}٪</div>
        <p class="muted">${fa(right)} از ${fa(EAR_QUESTIONS)} درست · بهترین امتیازت: ${fa(store.get().lessons[L.id].best)}٪</p>
        ${levelNote}
      </div>
      <div class="row">
        <button class="btn grow" id="retry">دوباره</button>
        ${nextLink(L, 'grow', '#/', 'خانه')}
      </div>`;
    $('#retry').onclick = () => route();
  };
  $('#again').onclick = () => { if (q && waiting) play(); };
}

const WEEKDAYS = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش']; // از یکشنبه
const shortDate = (t) => new Date(t).toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' });

function viewProgress() {
  const s = store.get();
  const vt = s.range ? estimateVoiceType(s.range.low, s.range.high, s.settings.voice) : null;
  const week = weekSummary(s);
  const trends = lessonTrends(s, LESSONS.filter((l) => ['seq', 'ear'].includes(l.kind)));
  const growth = rangeGrowth(s);
  const notes = noteStats(s);
  const holds = s.sustain.slice(-10).map((x) => x.secs);
  const DIRECTION = { up: '↑ رو به بهتر شدن', down: '↓ کمی افت کرده', flat: '→ ثابت' };
  const TENDENCY = { sharp: 'معمولاً کمی بالا ↑', flat: 'معمولاً کمی پایین ↓', true: 'دقیق ✓' };

  const rangeBars = s.rangeHistory.slice(-12).map((r) => ({
    low: r.low,
    high: r.high,
    title: `${shortDate(r.date)}: ${stepName(r.low).fa} تا ${stepName(r.high).fa}`,
  }));
  const weekLine = [
    week.count ? `${fa(week.count)} تمرین در ۷ روز اخیر` : 'این هفته هنوز تمرین نکردی',
    week.prevCount ? `هفته‌ی قبلش ${fa(week.prevCount)} تا` : '',
  ].filter(Boolean).join(' · ');
  const avgLine = week.avg == null ? '' : `میانگین امتیاز: ${fa(week.avg)}٪${week.prevAvg == null ? '' : ` (هفته‌ی قبلش ${fa(week.prevAvg)}٪)`}`;

  main.innerHTML = `
    <h1 class="page-title">پیشرفت من</h1>
    <section class="stats">
      <div class="stat"><b>${fa(streak())}</b><span>روز پشت‌سرهم</span></div>
      <div class="stat"><b>${fa(s.days.length)}</b><span>روز تمرین</span></div>
      <div class="stat"><b>${fa(s.sessions.length)}</b><span>تمرین</span></div>
    </section>
    <div class="card">
      <h2 class="h3">این هفته</h2>
      <ol class="week">
        ${week.days.map((d) => `<li class="${d.practised ? 'on' : ''}${d.today ? ' today' : ''}">
          <span class="dot" aria-hidden="true">${d.practised ? '✓' : ''}</span>
          <span class="wd" aria-hidden="true">${WEEKDAYS[d.weekday]}</span>
          <span class="visually-hidden">${d.today ? 'امروز' : shortDate(`${d.key}T12:00`)}: ${d.practised ? 'تمرین کردی' : 'بدون تمرین'}</span>
        </li>`).join('')}
      </ol>
      <p>${weekLine}</p>
      ${avgLine ? `<p class="muted small">${avgLine}</p>` : ''}
    </div>
    <div class="card">
      <h2 class="h3">صدای من</h2>
      ${s.range
        ? `<p>محدوده: <b>${esc(stepName(s.range.low).fa)}</b> تا <b>${esc(stepName(s.range.high).fa)}</b> (${fa(s.range.high - s.range.low)} نیم‌پرده)</p>
           <p>تیپ صدای تخمینی: <b>${esc(vt.fa)}</b></p>`
        : '<p class="muted">هنوز تست محدوده رو انجام ندادی.</p><a class="btn small" href="#/lesson/range">انجام تست</a>'}
      ${growth ? `
        ${rangeChart(rangeBars, {
          label: `محدوده‌ی صدا در ${fa(rangeBars.length)} تست آخر`,
          lowName: stepName(growth.last.low).fa,
          highName: stepName(growth.last.high).fa,
        })}
        <p class="muted small">${fa(growth.tests)} بار تست کردی. ${growth.gained > 0
          ? `از اولین تست، محدوده‌ات ${fa(growth.gained)} نیم‌پرده بیشتر شده.`
          : growth.gained < 0 ? 'آخرین تست کمی کوچیک‌تر از اولی بود؛ محدوده روز به روز فرق می‌کنه و این طبیعیه.' : 'محدوده‌ات از اولین تست تغییری نکرده.'}</p>` : ''}
      ${s.home != null ? `<p>نت خانه: <b>${esc(stepName(s.home).fa)}</b></p>` : ''}
      ${bestSustain() ? `
        <div class="trend">
          <span>طولانی‌ترین نت: <b>${fa(bestSustain())} ثانیه</b>${holds.length > 1 ? `<br><span class="muted small">آخرین بار ${fa(holds.at(-1))} ثانیه</span>` : ''}</span>
          ${holds.length > 1 ? sparkline(holds, { max: 0, label: `مدت نگه داشتن نت در ${fa(holds.length)} تمرین آخر، به ثانیه: ${holds.map(fa).join('، ')}` }) : ''}
        </div>` : ''}
    </div>
    <div class="card">
      <h2 class="h3">روند درس‌ها</h2>
      ${trends.length ? trends.map((t) => {
        const L = lessonById(t.id);
        return `<div class="trend">
          <span><b>${L.icon} ${esc(L.title)}</b><br>
            <span class="muted small">آخرین ${fa(t.last)}٪ · بهترین ${fa(t.best)}٪${t.direction ? ` · ${DIRECTION[t.direction]}` : ''}</span></span>
          ${sparkline(t.scores, { goal: PASS, label: `امتیاز ${fa(t.scores.length)} تمرین آخر: ${t.scores.map(fa).join('، ')}` })}
        </div>`;
      }).join('') + `<p class="muted small">خط‌چین: امتیاز ${fa(PASS)}٪</p>`
        : '<p class="muted">بعد از اولین تمرین امتیازدار، روندت اینجا نشون داده می‌شه.</p>'}
    </div>
    <div class="card">
      <h2 class="h3">نت‌های من</h2>
      ${notes.length ? `
        <ul class="note-scores">
          ${notes.map((n) => `<li class="note-row">
            <span><b>${esc(stepName(n.step + 60).fa)}</b></span>
            <progress max="100" value="${n.score}" aria-label="دقت روی ${esc(stepName(n.step + 60).fa)}"></progress>
            <span class="muted small">${fa(n.score)}٪${n.tendency ? ` · ${TENDENCY[n.tendency]}` : ''}</span>
          </li>`).join('')}
        </ul>
        <p class="muted small">از درس‌های «بشنو و تکرار کن» حساب می‌شه؛ نت‌هایی که تمرین بیشتری می‌خوان بالاترن.</p>`
        : '<p class="muted">بعد از اولین درس «بشنو و تکرار کن»، اینجا می‌بینی روی کدوم نت‌ها دقیق‌تری و کدوم‌ها رو معمولاً بالا یا پایین می‌خونی.</p>'}
    </div>
    <div class="card">
      <h2 class="h3">درس‌ها</h2>
      <ul class="note-scores">
        ${LESSONS.map((l) => {
          const r = s.lessons[l.id];
          return `<li><span>${l.icon} ${esc(l.title)}</span><span class="muted">${r ? `${fa(r.count)} بار${r.best != null ? ` · بهترین ${fa(r.best)}٪` : ''}${levelCount(l) > 1 && r.level ? ` · سطح ${fa(r.level + 1)}` : ''}` : '—'}</span></li>`;
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

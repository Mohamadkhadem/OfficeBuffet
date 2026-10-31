import { toJalali, toGregorian } from './jalali.js';

let view = document.getElementById('view');
const state = { me: { loggedIn: false }, period: load('period') || 'month', refresh: null };
const isAdmin = () => state.me.role === 'admin';
const isEmployee = () => state.me.role === 'employee';

// ---------- small utilities ----------
// Settings saved before the OfficeBuffet rename used the "officebite." prefix; they are still read.
function load(key) { try { return localStorage.getItem('officebuffet.' + key) ?? localStorage.getItem('officebite.' + key); } catch { return null; } }
function save(key, value) { try { localStorage.setItem('officebuffet.' + key, value); } catch { /* storage unavailable */ } }

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fa = (n) => Number(n || 0).toLocaleString('fa-IR');
const money = (n) => `${fa(n)} <small>تومان</small>`;
const priceHtml = (p) => (p > 0 ? money(p) : '<span class="badge credit">رایگان</span>');
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const byName = (a, b) => a.name.localeCompare(b.name, 'fa');
const isWide = () => matchMedia('(min-width: 900px)').matches;

const dateTimeFmt = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('fa-IR', { month: 'long' });
const fmtDT = (iso) => dateTimeFmt.format(new Date(iso));

const toLatinDigits = (s) => String(s ?? '')
  .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const faDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const pad2 = (n) => String(n).padStart(2, '0');

/** Today's Jalali date as "1405/08/05", optionally shifted by whole days. */
function jalaliLabel(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const j = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}`;
}

/** Parses "۱۴۰۵/۸/۵" style input; returns the normalized label and the Gregorian start of that day, or null. */
function parseJalali(text) {
  const m = toLatinDigits(text).trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (!m) return null;
  const [jy, jm, jd] = m.slice(1).map(Number);
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const g = toGregorian(jy, jm, jd);
  const back = toJalali(g.gy, g.gm, g.gd);
  if (back.jy !== jy || back.jm !== jm || back.jd !== jd) return null; // e.g. 1405/12/30 in a non-leap year
  return { label: `${jy}/${pad2(jm)}/${pad2(jd)}`, date: new Date(g.gy, g.gm - 1, g.gd) };
}

function parseAmount(s) {
  const t = toLatinDigits(s).replace(/[,،٬\s]/g, '');
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = faDigits(message);
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), isError ? 4500 : 2500);
}

/** Small modal asking for a line of text. Resolves to the text, or null when cancelled. */
function askText({ title, text = '', placeholder = '', okText = 'تأیید' }) {
  const dlg = $('#dialog');
  const input = $('#dialog-input');
  $('#dialog-title').textContent = title;
  $('#dialog-text').textContent = text;
  $('#dialog-ok').textContent = okText;
  input.value = '';
  input.placeholder = placeholder;
  input.required = true;
  dlg.returnValue = '';
  $('#dialog-cancel').onclick = () => dlg.close('cancel');
  return new Promise((resolve) => {
    dlg.onclose = () => resolve(dlg.returnValue === 'ok' && input.value.trim() ? input.value.trim() : null);
    dlg.showModal();
    input.focus();
  });
}

async function api(path, { method = 'GET', body } = {}) {
  let res;
  const isFile = body instanceof Blob; // uploads are sent as-is, everything else as JSON
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': isFile ? 'application/octet-stream' : 'application/json' } : {},
      body: body ? (isFile ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new Error('ارتباط با سرور برقرار نشد. اتصال شبکه را بررسی کنید.');
  }
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    state.me = { ...state.me, loggedIn: false, role: null };
    location.hash = '#/login';
    throw new Error('نشست شما تمام شده؛ دوباره وارد شوید.');
  }
  if (res.status === 429) throw new Error('تعداد تلاش‌ها زیاد بود؛ چند دقیقه بعد دوباره امتحان کنید.');
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || 'خطایی رخ داد.'), { data });
  return data;
}

function onSubmit(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button:not([type="button"])');
    if (btn) btn.disabled = true;
    try { await handler(new FormData(form)); }
    catch (err) { toast(err.message, true); }
    finally { if (btn) btn.disabled = false; }
  });
}

/** Shows the formatted value of amount inputs ("۴۵٬۰۰۰ تومان") under the field as the user types. */
function bindAmountHints(root) {
  root.querySelectorAll('[data-amount]').forEach((input) => {
    const hint = input.parentElement.querySelector('.hint');
    const update = () => {
      const n = parseAmount(input.value);
      hint.textContent = input.value === '' ? '' : Number.isNaN(n) ? 'فقط عدد وارد کنید' : `${fa(n)} تومان`;
    };
    input.addEventListener('input', update);
    update();
  });
}

// ---------- periods ----------
const PERIODS = [['today', 'امروز'], ['yesterday', 'دیروز'], ['week', 'این هفته'], ['month', 'این ماه'], ['lastMonth', 'ماه قبل'], ['all', 'همه']];

function jalaliMonthStart(jy, jm) {
  if (jm > 12) { jy += 1; jm = 1; }
  if (jm < 1) { jy -= 1; jm = 12; }
  const g = toGregorian(jy, jm, 1);
  return new Date(g.gy, g.gm - 1, g.gd);
}

function periodRange(key) {
  const now = new Date();
  const day = (offset) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const j = toJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  switch (key) {
    case 'today': return [day(0), day(1)];
    case 'yesterday': return [day(-1), day(0)];
    case 'week': { const back = (now.getDay() + 1) % 7; return [day(-back), day(7 - back)]; } // week starts Saturday
    case 'month': return [jalaliMonthStart(j.jy, j.jm), jalaliMonthStart(j.jy, j.jm + 1)];
    case 'lastMonth': return [jalaliMonthStart(j.jy, j.jm - 1), jalaliMonthStart(j.jy, j.jm)];
    default: return [null, null];
  }
}

function rangeQuery(key, extra = {}) {
  const [from, to] = periodRange(key);
  const p = new URLSearchParams(extra);
  if (from) p.set('from', from.toISOString());
  if (to) p.set('to', to.toISOString());
  return p.toString();
}

function periodLabel(key, label) {
  if (key !== 'month' && key !== 'lastMonth') return label;
  return `${label} (${monthFmt.format(periodRange(key)[0])})`;
}

const chipsHtml = () => `<div class="chips">${PERIODS.map(([k, l]) =>
  `<button class="chip ${k === state.period ? 'active' : ''}" data-period="${k}">${periodLabel(k, l)}</button>`).join('')}</div>`;

// ---------- shared rendering ----------
function balanceBadge(b) {
  if (b > 0) return `<span class="badge debt">بدهکار ${fa(b)}</span>`;
  if (b < 0) return `<span class="badge credit">بستانکار ${fa(-b)}</span>`;
  return '<span class="badge zero">تسویه</span>';
}

const stat = (label, value) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;

function mergeEntries(data) {
  return [
    ...data.orders.map((o) => ({ ...o, kind: 'order' })),
    ...data.payments.map((p) => ({ ...p, kind: 'payment' })),
    ...(data.settlements ?? []).map((s) => ({ ...s, kind: 'settlement' })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || b.id - a.id);
}

function entryHtml(e, { showPerson = true, canVoid = false } = {}) {
  const voided = !!e.voidedAt;
  const isOrder = e.kind === 'order';
  if (e.kind === 'settlement') return settlementHtml(e, { showPerson, canVoid });
  const settledBadge = e.settled && !voided ? ' <span class="badge off">تسویه‌شده</span>' : '';
  const title = (isOrder ? `${esc(e.itemName)}${e.quantity > 1 ? ` × ${fa(e.quantity)}` : ''}` : 'پرداخت') + settledBadge;
  const sub = [
    showPerson ? `<b>${esc(e.personName)}</b>` : null,
    fmtDT(e.createdAt),
    isOrder && e.quantity > 1 ? `هر عدد ${fa(e.unitPrice)}` : null,
    e.note ? esc(e.note) : null,
    `ثبت: ${esc(e.createdBy)}`,
    e.enteredAt ? `<span class="late">ثبت بعدی در ${fmtDT(e.enteredAt)}</span>` : null,
  ].filter(Boolean).join(' · ');
  const amount = isOrder ? money(e.total) : `<span class="pay">${money(e.amount)}</span>`;
  const voidNote = voided
    ? `<div class="void-note">ابطال شد: ${esc(e.voidReason)} (${esc(e.voidedBy)} · ${fmtDT(e.voidedAt)})</div>` : '';
  const voidBtn = canVoid && !voided
    ? `<button class="btn link danger small" data-void="${e.kind}:${e.id}" title="ابطال این ثبت">ابطال</button>` : '';
  return `<div class="list-row ${voided ? 'voided' : ''}">
    <div class="icon">${isOrder ? '☕' : '💵'}</div>
    <div class="grow"><div class="title">${title}</div><div class="sub">${sub}</div>${voidNote}</div>
    <div class="amount">${amount}</div>${voidBtn}</div>`;
}

function settlementHtml(e, { showPerson, canVoid }) {
  const voided = !!e.voidedAt;
  const cleared = e.clearedAmount > 0 ? `بدهی صفرشده ${fa(e.clearedAmount)} تومان`
    : e.clearedAmount < 0 ? `طلب صفرشده ${fa(-e.clearedAmount)} تومان` : 'مانده‌ای نداشت';
  const sub = [
    showPerson ? `<b>${esc(e.personName)}</b>` : null,
    cleared,
    fmtDT(e.createdAt),
    e.note ? esc(e.note) : null,
    `ثبت: ${esc(e.createdBy)}`,
  ].filter(Boolean).join(' · ');
  const voidNote = voided
    ? `<div class="void-note">ابطال شد: ${esc(e.voidReason)} (${esc(e.voidedBy)} · ${fmtDT(e.voidedAt)})</div>` : '';
  const voidBtn = canVoid && !voided
    ? `<button class="btn link danger small" data-void="settlement:${e.id}" title="ابطال این تسویه">ابطال</button>` : '';
  return `<div class="list-row settlement ${voided ? 'voided' : ''}">
    <div class="icon">✅</div>
    <div class="grow"><div class="title">تسویه تا ${faDigits(e.untilLabel)}</div><div class="sub">${sub}</div>${voidNote}</div>
    ${voidBtn}</div>`;
}

const entriesHtml = (list, opts) =>
  list.length ? list.map((e) => entryHtml(e, opts)).join('') : '<div class="empty">موردی ثبت نشده است.</div>';

function bindSearch(input, container) {
  input.addEventListener('input', () => {
    const q = input.value.trim();
    container.querySelectorAll('[data-name]').forEach((el) => {
      el.style.display = !q || el.dataset.name.includes(q) ? '' : 'none';
    });
  });
}

// ---------- views: public ----------
async function viewReport(_, alive) {
  const q = rangeQuery(state.period);
  const [summary, entries] = await Promise.all([api('/api/report/summary?' + q), api('/api/report/entries?' + q)]);
  if (!alive()) return;
  const people = summary.people.sort((a, b) => b.consumed - a.consumed || byName(a, b));
  const recent = mergeEntries(entries).slice(0, 60);
  const totalDebt = sum(people.filter((p) => p.balance > 0), (p) => p.balance);

  view.innerHTML = `
    <div class="page-title"><h1>گزارش مصرف</h1></div>
    ${chipsHtml()}
    <div class="stats">
      ${stat('مصرف در این بازه', money(sum(people, (p) => p.consumed)))}
      ${stat('پرداخت در این بازه', money(sum(people, (p) => p.paid)))}
      ${stat('کل بدهی فعلی', money(totalDebt))}
    </div>
    <div class="cols">
      <div>
        <div class="card">
          <div class="card-head"><h2>افراد</h2><small>مانده = مصرف − پرداخت، بعد از آخرین تسویه</small></div>
          <input class="search" id="q" placeholder="جستجوی نام…" autocomplete="off">
          <div class="list" id="people-list">
            ${people.length ? people.map((p) => `
              <a class="list-row" href="#/person/${p.id}" data-name="${esc(p.name)}">
                <div class="grow">
                  <div class="title">${esc(p.name)} ${p.isActive ? '' : '<span class="badge off">غیرفعال</span>'}</div>
                  <div class="sub">${fa(p.qty)} قلم · مصرف ${fa(p.consumed)} · پرداخت ${fa(p.paid)}${p.settledUntil ? ` · تسویه تا ${faDigits(p.settledUntil)}` : ''}</div>
                </div>
                ${balanceBadge(p.balance)}
              </a>`).join('') : '<div class="empty">هنوز شخصی تعریف نشده است.</div>'}
          </div>
        </div>
        <div class="card"><div class="card-head"><h2>آخرین ثبت‌ها</h2></div>
          <div class="list">${entriesHtml(recent, { canVoid: isAdmin() })}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>اقلام مصرف‌شده</h2></div>
        <div class="list">
          ${summary.byItem.length ? summary.byItem.map((i) => `
            <div class="list-row"><div class="grow"><div class="title">${esc(i.name)}</div>
              <div class="sub">${fa(i.qty)} عدد</div></div><div class="amount">${money(i.total)}</div></div>`).join('')
            : '<div class="empty">در این بازه چیزی مصرف نشده است.</div>'}
        </div>
      </div>
    </div>`;
  bindSearch($('#q'), $('#people-list'));
}

async function viewPerson(id, alive) {
  if (isEmployee()) id = state.me.personId;
  const [summary, entries, cards] = await Promise.all([
    api('/api/report/summary?' + rangeQuery(state.period)),
    api('/api/report/entries?' + rangeQuery(state.period, { personId: id })),
    isEmployee() ? api('/api/report/cards') : [],
  ]);
  if (!alive()) return;
  const list = mergeEntries(entries);
  const p = summary.people.find((x) => String(x.id) === String(id))
    ?? { name: list[0]?.personName ?? 'نامشخص', balance: 0, consumed: 0, paid: 0, qty: 0 };

  view.innerHTML = `
    <div class="page-title"><h1>${esc(p.name)}</h1>${isAdmin() ? '<a class="btn ghost small" href="#/report">بازگشت به گزارش</a>' : ''}</div>
    <div class="card">
      <div class="card-head">
        <div class="muted">مانده‌ی حساب ${p.settledUntil ? `(بعد از تسویه تا ${faDigits(p.settledUntil)})` : '(از ابتدا تا امروز)'}</div>
        ${isAdmin() && p.id ? `<a class="btn ghost small" href="#/payments/${p.id}">پرداخت / تسویه</a>` : ''}
      </div>
      <div class="balance-big">${money(Math.abs(p.balance))}</div>
      ${balanceBadge(p.balance)}
      ${payCardsHtml(cards)}
    </div>
    ${chipsHtml()}
    <div class="stats">
      ${stat('مصرف در این بازه', money(p.consumed))}
      ${stat('پرداخت در این بازه', money(p.paid))}
      ${stat('تعداد اقلام', fa(p.qty))}
    </div>
    <div class="card"><div class="card-head"><h2>ریز ثبت‌ها</h2></div>
      <div class="list">${entriesHtml(list, { showPerson: false, canVoid: isAdmin() })}</div>
    </div>
    ${isEmployee() ? `<div class="card" id="push"></div>${versionLine()}` : ''}`;
  if (isEmployee()) renderPushCard(alive);
}

async function viewLogin(mode) {
  if (state.me.loggedIn) { location.hash = homeHash(); return; }
  const setup = state.me.needsSetup;
  if (mode !== 'admin' && !setup) {
    view.innerHTML = `
      <div class="card login-card">
        <h2>ورود</h2>
        <p class="muted">با کد ملی خود وارد شوید تا صبحانه و نوشیدنی‌هایی را که برایتان ثبت شده ببینید. یک بار ورود کافی است و روی این دستگاه وارد می‌مانید.</p>
        <form class="form" id="f">
          <label>کد ملی<input name="code" inputmode="numeric" maxlength="12" autocomplete="off" required autofocus placeholder="۱۰ رقم" class="code-input"></label>
          <button class="btn block">ورود</button>
        </form>
        <div class="login-alt"><a href="#/login/admin">ورود مسئول بوفه</a></div>
        ${versionLine()}
      </div>`;
    onSubmit($('#f'), async (fd) => {
      await api('/api/auth/employee-login', { method: 'POST', body: { nationalCode: toLatinDigits(fd.get('code')) } });
      await refreshMe();
      location.hash = homeHash();
    });
    return;
  }
  view.innerHTML = `
    <div class="card login-card">
      <h2>${setup ? 'ساخت حساب مسئول' : 'ورود مسئول'}</h2>
      <p class="muted">${setup ? 'اولین اجراست؛ یک حساب برای مسئول بوفه بسازید.' : 'برای ثبت سفارش، مدیریت و دیدن گزارش همه وارد شوید.'}</p>
      <form class="form" id="f">
        <label>نام کاربری<input name="username" autocomplete="username" required autofocus></label>
        <label>رمز عبور<input name="password" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" required></label>
        <button class="btn block">${setup ? 'ساخت حساب و ورود' : 'ورود'}</button>
      </form>
      ${setup ? '' : '<div class="login-alt"><a href="#/login">ورود کارکنان با کد ملی</a></div>'}
      ${versionLine()}
    </div>`;
  onSubmit($('#f'), async (fd) => {
    await api(setup ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST', body: { username: fd.get('username'), password: fd.get('password') },
    });
    await refreshMe();
    location.hash = homeHash();
  });
}

// ---------- views: admin ----------
async function viewOrder(_, alive) {
  const [items, people] = await Promise.all([api('/api/admin/items'), api('/api/admin/people')]);
  if (!alive()) return;
  const activeItems = items.filter((i) => i.isActive);
  const activePeople = people.filter((p) => p.isActive).sort(byName);
  const cart = new Map();
  let person = null;
  // The day the orders belong to; kept while switching people so a whole paper list can be entered for one day.
  let day = parseJalali(jalaliLabel());
  const isToday = () => day.label === jalaliLabel();

  if (!activePeople.length || !activeItems.length) {
    view.innerHTML = `<div class="card empty">
      ${!activePeople.length ? 'هنوز شخصی تعریف نشده. <a href="#/people">تعریف افراد</a><br>' : ''}
      ${!activeItems.length ? 'هنوز کالایی تعریف نشده. <a href="#/items">تعریف کالاها</a>' : ''}</div>`;
    return;
  }

  const categories = [...new Set(activeItems.map((i) => i.category || 'سایر'))];
  view.innerHTML = `
    <div class="order-layout" id="layout">
      <section class="people-pane">
        <div class="card order-date" id="date-card">
          <label>تاریخ سفارش (شمسی)
            <input id="day" inputmode="numeric" placeholder="۱۴۰۵/۰۸/۰۵" autocomplete="off" value="${faDigits(day.label)}">
          </label>
          <div class="chips" style="margin:0">
            <button type="button" class="chip" data-day="${jalaliLabel()}">امروز</button>
            <button type="button" class="chip" data-day="${jalaliLabel(-1)}">دیروز</button>
            <button type="button" class="chip" data-day="${jalaliLabel(-2)}">پریروز</button>
          </div>
          <div class="hint" id="day-hint"></div>
        </div>
        <div class="card">
          <h2 style="margin-bottom:10px">برای چه کسی؟</h2>
          <input class="search" id="pq" placeholder="جستجوی نام…" autocomplete="off">
          <div class="people-grid" id="pgrid">
            ${activePeople.map((p) => `<button class="person-btn" data-person="${p.id}" data-name="${esc(p.name)}">${esc(p.name)}</button>`).join('')}
          </div>
        </div>
      </section>
      <section class="items-pane" id="ipane"></section>
    </div>
    <div class="card"><div class="card-head"><h2 id="day-title">ثبت‌های امروز</h2></div><div class="list" id="today"></div></div>`;

  const layout = $('#layout');
  const ipane = $('#ipane');
  const pq = $('#pq');
  bindSearch(pq, $('#pgrid'));
  pq.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const visible = [...$('#pgrid').children].filter((b) => b.style.display !== 'none');
    if (visible.length === 1) visible[0].click();
  });
  if (isWide()) pq.focus();

  const updateBar = () => {
    const lines = [...cart.entries()].filter(([, q]) => q > 0);
    const count = sum(lines, ([, q]) => q);
    const total = sum(lines, ([id, q]) => activeItems.find((i) => i.id === id).price * q);
    $('#cnt').textContent = count ? `${fa(count)} قلم انتخاب شده` : 'هنوز چیزی انتخاب نشده';
    $('#tot').innerHTML = money(total);
    $('#submit').disabled = count === 0;
    $('#clear-cart').hidden = count === 0;
  };

  const setQty = (id, qty) => {
    qty = Math.max(0, Math.min(50, qty));
    cart.set(id, qty);
    const tile = ipane.querySelector(`[data-item="${id}"]`);
    tile.querySelector('.qty').textContent = fa(qty);
    tile.classList.toggle('selected', qty > 0);
    updateBar();
  };

  const renderItems = () => {
    layout.classList.toggle('has-person', !!person);
    layout.querySelectorAll('.person-btn').forEach((b) => b.classList.toggle('current', person && b.dataset.person == person.id));
    if (!person) {
      ipane.innerHTML = '<div class="card empty-pane"><div class="muted">از لیست، شخص را انتخاب کنید.</div></div>';
      return;
    }
    ipane.innerHTML = `
      <div class="card">
        <div class="order-head">
          <div><small>سفارش برای</small><div class="who">${esc(person.name)}</div>
            <small class="${isToday() ? '' : 'past-day'}">${isToday() ? 'امروز' : 'تاریخ'} ${faDigits(day.label)}</small></div>
          <button type="button" class="btn ghost small back-btn" id="change">تغییر شخص</button>
        </div>
        ${categories.map((c) => `
          <div class="cat-title">${esc(c)}</div>
          <div class="items-grid">
            ${activeItems.filter((i) => (i.category || 'سایر') === c).map((i) => `
              <div class="item-tile" data-item="${i.id}">
                <div class="name">${esc(i.name)}</div>
                <div class="price">${priceHtml(i.price)}</div>
                <div class="stepper">
                  <button type="button" data-step="-1" aria-label="کم کردن">−</button>
                  <span class="qty">۰</span>
                  <button type="button" data-step="1" aria-label="اضافه کردن">+</button>
                </div>
              </div>`).join('')}
          </div>`).join('')}
        <label style="margin-top:14px">توضیح (اختیاری)<input id="note" maxlength="200" placeholder="مثلاً بدون شکر"></label>
        <div class="order-bar">
          <div><div class="pending-count" id="cnt"></div><div class="total" id="tot"></div></div>
          <div class="order-actions">
            <button type="button" class="btn ghost" id="clear-cart" hidden title="صفر کردن همه‌ی اقلام انتخاب‌شده">🗑️ خالی کردن</button>
            <button class="btn" id="submit">ثبت سفارش</button>
          </div>
        </div>
      </div>`;
    updateBar();
  };

  const selectPerson = (p) => {
    if (person?.id !== p?.id) cart.clear();
    person = p;
    renderItems();
    if (!isWide()) window.scrollTo({ top: 0 });
  };

  layout.addEventListener('click', async (e) => {
    const pb = e.target.closest('[data-person]');
    if (pb) return selectPerson(activePeople.find((p) => p.id == pb.dataset.person));
    if (e.target.closest('#change')) return selectPerson(null);
    if (e.target.closest('#clear-cart')) {
      // Empties the items for the selected person; the person and the date stay as they are.
      [...cart.keys()].forEach((id) => setQty(id, 0));
      $('#note').value = '';
      toast('سبد خالی شد.');
      return;
    }
    const tile = e.target.closest('[data-item]');
    if (tile) {
      const id = Number(tile.dataset.item);
      const step = e.target.closest('[data-step]');
      return setQty(id, (cart.get(id) || 0) + (step ? Number(step.dataset.step) : 1));
    }
    if (e.target.closest('#submit')) {
      const btn = $('#submit');
      const lines = [...cart.entries()].filter(([, q]) => q > 0).map(([itemId, quantity]) => ({ itemId, quantity }));
      btn.disabled = true;
      try {
        if (parseJalali($('#day').value)?.label !== day.label) throw new Error('تاریخ سفارش را درست وارد کنید.');
        const body = { personId: person.id, lines, note: $('#note').value };
        if (!isToday()) {
          // Same time of day on the chosen date, so the order sorts naturally within that day.
          const now = new Date();
          const at = new Date(day.date);
          at.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
          body.date = at.toISOString();
        }
        const res = await api('/api/admin/orders', { method: 'POST', body });
        toast(`ثبت شد: ${person.name} — ${fa(res.total)} تومان${isToday() ? '' : ` (${faDigits(day.label)})`}`);
        pq.value = '';
        pq.dispatchEvent(new Event('input'));
        selectPerson(null);
        refreshToday();
        if (isWide()) pq.focus();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
    }
  });

  const refreshToday = async () => {
    const from = new Date(day.date);
    const to = new Date(day.date);
    to.setDate(to.getDate() + 1);
    const data = await api(`/api/report/entries?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    $('#today').innerHTML = entriesHtml(mergeEntries(data), { canVoid: true });
  };
  state.refresh = refreshToday;

  const dayInput = $('#day');
  const setDay = () => {
    const j = parseJalali(dayInput.value);
    const hint = $('#day-hint');
    const ok = j && j.date <= new Date();
    $('#date-card').classList.toggle('past', !!ok && j.label !== jalaliLabel());
    if (!ok) {
      hint.textContent = !j ? 'تاریخ را به شکل ۱۴۰۵/۰۸/۰۵ وارد کنید.' : 'تاریخ آینده قابل انتخاب نیست.';
      $('#submit')?.setAttribute('disabled', '');
      return;
    }
    day = j;
    hint.textContent = isToday() ? '' : `سفارش‌ها برای ${faDigits(j.label)} ثبت می‌شوند (نه امروز).`;
    $('#day-title').textContent = isToday() ? 'ثبت‌های امروز' : `ثبت‌های ${faDigits(j.label)}`;
    view.querySelectorAll('[data-day]').forEach((c) => c.classList.toggle('active', c.dataset.day === j.label));
    renderItemsKeepCart();
    refreshToday().catch((err) => toast(err.message, true));
  };
  // Re-render the open order so its date line updates, without losing the selected quantities.
  const renderItemsKeepCart = () => {
    if (!person) return;
    const note = $('#note')?.value ?? '';
    renderItems();
    $('#note').value = note;
    cart.forEach((q, id) => { if (q > 0) setQty(id, q); });
  };
  dayInput.addEventListener('input', setDay);
  view.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-day]');
    if (chip) { dayInput.value = faDigits(chip.dataset.day); setDay(); }
  });
  view.querySelector('[data-day]').classList.add('active');

  renderItems();
  await refreshToday();
}

async function viewPayments(preselectId, alive) {
  const [people, summary, entries] = await Promise.all([
    api('/api/admin/people'), api('/api/report/summary'), api('/api/report/entries'),
  ]);
  if (!alive()) return;
  const info = new Map(summary.people.map((p) => [p.id, p]));
  const history = mergeEntries({ orders: [], payments: entries.payments, settlements: entries.settlements });
  const lastMonthEnd = (() => {
    const j = parseJalali(jalaliLabel());
    const d = new Date(j.date);
    d.setDate(d.getDate() - Number(j.label.slice(8)));
    const r = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return `${r.jy}/${pad2(r.jm)}/${pad2(r.jd)}`;
  })();

  view.innerHTML = `
    <div class="page-title"><h1>پرداخت و تسویه</h1></div>
    <div class="cols">
      <div>
        <div class="card">
          <label>شخص
            <select id="person">
              <option value="">انتخاب کنید…</option>
              ${people.sort(byName).map((p) => `<option value="${p.id}">${esc(p.name)}${p.isActive ? '' : ' (غیرفعال)'}</option>`).join('')}
            </select>
          </label>
          <div id="bal" class="muted" style="margin-top:8px"></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>ثبت پرداخت</h2></div>
          <form class="form" id="pay">
            <label>مبلغ (تومان)<input name="amount" id="amount" inputmode="numeric" data-amount required autocomplete="off"><span class="hint"></span></label>
            <label>توضیح (اختیاری)<input name="note" maxlength="200" placeholder="مثلاً کارت‌به‌کارت"></label>
            <button class="btn">ثبت پرداخت</button>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><h2>تسویه تا تاریخ</h2></div>
          <p class="muted" style="margin:0 0 12px">همه‌ی سفارش‌ها و پرداخت‌های این شخص تا پایان تاریخ انتخابی بسته می‌شود و مانده‌ی آن دوره صفر می‌شود، فارغ از اینکه چقدر پرداخت کرده است.</p>
          <form class="form" id="settle">
            <label>تا تاریخ (شمسی)
              <input name="until" id="until" inputmode="numeric" placeholder="۱۴۰۵/۰۸/۰۵" required autocomplete="off" value="${faDigits(jalaliLabel())}">
            </label>
            <div class="chips" style="margin:0">
              <button type="button" class="chip" data-until="${jalaliLabel()}">امروز</button>
              <button type="button" class="chip" data-until="${jalaliLabel(-1)}">دیروز</button>
              <button type="button" class="chip" data-until="${lastMonthEnd}">پایان ماه قبل</button>
            </div>
            <div id="preview" class="hint"></div>
            <label>توضیح (اختیاری)<input name="note" maxlength="200" placeholder="مثلاً تسویه‌ی نقدی پایان ماه"></label>
            <button class="btn" id="settle-btn">ثبت تسویه</button>
          </form>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2 id="history-title">آخرین پرداخت‌ها و تسویه‌ها</h2></div>
        <div class="list" id="history"></div>
      </div>
    </div>`;

  const personSel = $('#person');
  const untilInput = $('#until');
  const personId = () => Number(personSel.value) || null;
  const reopen = () => {
    const hash = `#/payments/${personId() ?? ''}`;
    if (location.hash === hash) route(); else location.hash = hash;
  };

  const renderPerson = () => {
    const id = personId();
    const p = info.get(id);
    const b = p?.balance ?? 0;
    $('#bal').innerHTML = id
      ? `مانده: ${balanceBadge(b)}${p?.settledUntil ? ` · آخرین تسویه تا ${faDigits(p.settledUntil)}` : ''}
         ${b > 0 ? ' <button type="button" class="btn link small" id="fill">پرداخت کل بدهی</button>' : ''}`
      : '';
    const list = id ? history.filter((e) => e.personId === id) : history;
    $('#history-title').textContent = id ? `پرداخت‌ها و تسویه‌های ${p?.name ?? ''}` : 'آخرین پرداخت‌ها و تسویه‌ها';
    $('#history').innerHTML = entriesHtml(list, { showPerson: !id, canVoid: true });
    updatePreview();
  };

  let previewSeq = 0;
  async function updatePreview() {
    const seq = ++previewSeq;
    const out = $('#preview');
    const j = parseJalali(untilInput.value);
    $('#settle-btn').disabled = !personId() || !j;
    if (!personId()) { out.textContent = 'ابتدا شخص را انتخاب کنید.'; return; }
    if (!j) { out.textContent = untilInput.value.trim() ? 'تاریخ را به شکل ۱۴۰۵/۰۸/۰۵ وارد کنید.' : ''; return; }
    const cutoff = new Date(j.date);
    cutoff.setDate(cutoff.getDate() + 1);
    try {
      const r = await api(`/api/admin/settlements/preview?personId=${personId()}&until=${encodeURIComponent(cutoff.toISOString())}`);
      if (seq !== previewSeq) return;
      const amount = r.openAmount > 0 ? `بدهی ${fa(r.openAmount)} تومان`
        : r.openAmount < 0 ? `طلب ${fa(-r.openAmount)} تومان` : 'مانده‌ای ندارد';
      out.innerHTML = `تا پایان ${faDigits(j.label)}: <b>${amount}</b> — با ثبت تسویه صفر می‌شود.`;
    } catch (err) {
      if (seq === previewSeq) out.textContent = err.message;
    }
  }

  personSel.addEventListener('change', renderPerson);
  untilInput.addEventListener('input', updatePreview);
  view.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-until]');
    if (chip) { untilInput.value = faDigits(chip.dataset.until); updatePreview(); return; }
    if (e.target.closest('#fill')) {
      $('#amount').value = info.get(personId())?.balance ?? '';
      $('#amount').dispatchEvent(new Event('input'));
    }
  });
  bindAmountHints(view);

  onSubmit($('#pay'), async (fd) => {
    if (!personId()) throw new Error('ابتدا شخص را انتخاب کنید.');
    const amount = parseAmount(fd.get('amount'));
    if (!(amount > 0)) throw new Error('مبلغ معتبر وارد کنید.');
    await api('/api/admin/payments', { method: 'POST', body: { personId: personId(), amount, note: fd.get('note') } });
    toast('پرداخت ثبت شد.');
    reopen();
  });

  onSubmit($('#settle'), async (fd) => {
    const j = parseJalali(fd.get('until'));
    if (!personId() || !j) throw new Error('شخص و تاریخ را درست وارد کنید.');
    const name = info.get(personId())?.name ?? personSel.selectedOptions[0].textContent;
    if (!confirm(`حساب «${name}» تا پایان ${faDigits(j.label)} تسویه شود؟`)) return;
    const cutoff = new Date(j.date);
    cutoff.setDate(cutoff.getDate() + 1);
    await api('/api/admin/settlements', {
      method: 'POST', body: { personId: personId(), until: cutoff.toISOString(), untilLabel: j.label, note: fd.get('note') },
    });
    toast(`حساب ${name} تا ${faDigits(j.label)} تسویه شد.`);
    reopen();
  });

  if (people.some((p) => String(p.id) === preselectId)) personSel.value = preselectId;
  renderPerson();
}

const DEFAULT_CATEGORIES = ['صبحانه', 'نوشیدنی گرم', 'نوشیدنی سرد', 'تنقلات'];

// ---------- Excel import (items and people) ----------
const IMPORT_KINDS = {
  items: {
    title: 'ورود کالاها از اکسل',
    help: 'کالایی که همین عنوان را دارد تکراری ثبت نمی‌شود؛ مبلغ (و دسته، اگر ستونش را انتخاب کنید) به‌روز می‌شود. مبلغ ۰ یا خالی یعنی رایگان.',
    fields: [
      { key: 'name', label: 'ستون عنوان کالا', required: true, guess: /عنوان|نام|کالا|شرح|name|item/i },
      { key: 'price', label: 'ستون مبلغ (تومان)', required: true, guess: /مبلغ|قیمت|بها|price/i },
      { key: 'category', label: 'ستون دسته (اختیاری)', guess: /دسته|گروه|category/i },
    ],
  },
  people: {
    title: 'ورود افراد از اکسل',
    help: 'شخصی که همین نام را دارد تکراری ثبت نمی‌شود؛ اگر کد ملی‌اش خالی بود اضافه می‌شود. کد ملی نامعتبر یا تکراری در لیست مشکل‌دار نشان داده می‌شود و ثبت نمی‌شود.',
    fields: [
      { key: 'name', label: 'ستون نام و نام خانوادگی', required: true, guess: /^(?!.*کد).*(نام|عنوان|name)/i },
      { key: 'nationalCode', label: 'ستون کد ملی', required: true, guess: /کد|ملی|national|code/i },
    ],
  },
};

const IMPORT_STATUS = {
  new: ['جدید', 'credit'], update: ['به‌روزرسانی', 'wait'], same: ['بدون تغییر', 'off'],
  warn: ['هشدار', 'warn'], error: ['مشکل‌دار — ثبت نمی‌شود', 'debt'],
};

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-open-import]');
  if (btn) openImport(btn.dataset.openImport, $('#import'));
});

const colName = (i) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));

/** Card for importing items or people: pick a file, map its columns, preview, then apply. */
function openImport(kind, container) {
  const cfg = IMPORT_KINDS[kind];
  let rows = [];
  let preview = null;
  container.hidden = false;
  container.innerHTML = `
    <div class="card-head"><h2>${cfg.title}</h2><button type="button" class="btn ghost small" data-imp="close">بستن</button></div>
    <p class="muted" style="margin-top:0">فایل Excel (.xlsx) یا CSV را انتخاب کنید و بگویید هر ستون چیست. ${cfg.help}</p>
    <input type="file" id="imp-file" accept=".xlsx,.xlsm,.csv">
    <div id="imp-map"></div>
    <div id="imp-result"></div>`;
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const mapping = () => {
    const m = {};
    cfg.fields.forEach((f) => { const v = $(`#imp-${f.key}`, container).value; m[f.key] = v === '' ? null : Number(v); });
    return m;
  };
  const dataRows = () => {
    const m = mapping();
    const skip = $('#imp-header', container).checked ? 1 : 0;
    return rows.slice(skip).map((cells, i) => {
      const r = { row: i + skip + 1 };
      cfg.fields.forEach((f) => { r[f.key] = m[f.key] == null ? null : cells[m[f.key]] ?? ''; });
      return r;
    });
  };

  const renderMap = () => {
    const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
    const header = rows[0] ?? [];
    const hasHeader = header.some((h) => cfg.fields.some((f) => f.guess.test(h)));
    const sample = (c) => (hasHeader ? header[c] : rows[0]?.[c]) || '';
    const taken = new Set();
    const guess = cfg.fields.map((f, i) => {
      let c = hasHeader ? header.findIndex((h, j) => !taken.has(j) && f.guess.test(h)) : -1;
      if (c < 0 && f.required) c = [...Array(width).keys()].find((j) => !taken.has(j) && (hasHeader ? true : j >= i)) ?? -1;
      if (c >= 0) taken.add(c);
      return c;
    });
    $('#imp-map', container).innerHTML = `
      <div class="import-map">
        ${cfg.fields.map((f, i) => `<label>${f.label}
          <select id="imp-${f.key}">
            ${f.required ? '' : '<option value="">— ندارد —</option>'}
            ${[...Array(width).keys()].map((c) => `<option value="${c}" ${c === guess[i] ? 'selected' : ''}>ستون ${colName(c)}${sample(c) ? ` — ${esc(String(sample(c)).slice(0, 30))}` : ''}</option>`).join('')}
          </select></label>`).join('')}
      </div>
      <label class="check"><input type="checkbox" id="imp-header" ${hasHeader ? 'checked' : ''}> ردیف اول عنوان ستون‌هاست (وارد نشود)</label>`;
    runPreview();
  };

  let seq = 0;
  async function runPreview() {
    const my = ++seq;
    const out = $('#imp-result', container);
    out.innerHTML = '<div class="muted" style="margin-top:12px">در حال بررسی…</div>';
    try {
      const res = await api(`/api/admin/import/${kind}`, { method: 'POST', body: { rows: dataRows(), apply: false } });
      if (my !== seq) return;
      preview = res;
      renderResult(res);
    } catch (err) {
      if (my === seq) out.innerHTML = `<div class="void-note" style="margin-top:12px">${esc(err.message)}</div>`;
    }
  }

  const rowHtml = (r) => `<div class="import-row ${r.status}">
      <div class="num">ردیف ${fa(r.row)}</div>
      <div><b>${esc(r.name) || '—'}</b>${r.value ? ` · ${esc(faDigits(r.value))}` : ''}</div>
      <div class="msg">${r.message ? esc(faDigits(r.message)) : IMPORT_STATUS[r.status][0]}</div></div>`;

  const renderResult = (res, done = false) => {
    const c = res.counts;
    const toApply = res.changes;
    const problems = res.rows.filter((r) => r.status === 'error' || r.status === 'warn');
    const rest = res.rows.filter((r) => r.status !== 'error' && r.status !== 'warn');
    $('#imp-result', container).innerHTML = `
      ${done ? '<p class="badge credit" style="margin:12px 0 0;font-size:14px">✓ ثبت انجام شد. لیست پایین صفحه بعد از «بستن» به‌روز می‌شود.</p>' : ''}
      <div class="import-counts">
        ${Object.entries(IMPORT_STATUS).filter(([k]) => c[k]).map(([k, [label, cls]]) => `<span class="badge ${cls}">${label}: ${fa(c[k])}</span>`).join('')}
        ${res.rows.length ? '' : '<span class="muted">ردیفی برای ورود پیدا نشد؛ ستون‌ها را بررسی کنید.</span>'}
      </div>
      ${problems.length ? `<div class="import-list"><h3 style="margin:8px 0 0;font-size:15px">ردیف‌هایی که باید بررسی شوند (${fa(problems.length)})</h3>
        ${problems.map(rowHtml).join('')}
        ${c.error ? '<p class="hint">ردیف‌های مشکل‌دار ثبت نمی‌شوند؛ در فایل درست کنید و دوباره وارد کنید (ردیف‌های ثبت‌شده تکرار نمی‌شوند).</p>' : ''}</div>` : ''}
      ${rest.length ? `<details class="import-list" ${problems.length ? '' : 'open'}><summary>بقیه‌ی ردیف‌ها (${fa(rest.length)})</summary>${rest.map(rowHtml).join('')}</details>` : ''}
      <div class="row-end" style="margin-top:12px">
        ${done ? '<button type="button" class="btn" data-imp="close">بستن</button>'
          : `<button type="button" class="btn" data-imp="apply" ${toApply ? '' : 'disabled'}>${toApply ? `ثبت ${fa(toApply)} ردیف` : 'تغییری برای ثبت نیست'}</button>`}
      </div>`;
  };
  let applied = false;

  container.onchange = async (e) => {
    if (e.target.id === 'imp-file') {
      const file = e.target.files[0];
      if (!file) return;
      $('#imp-map', container).innerHTML = '<div class="muted" style="margin-top:12px">در حال خواندن فایل…</div>';
      $('#imp-result', container).innerHTML = '';
      try {
        rows = (await api(`/api/admin/import/parse?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })).rows;
        renderMap();
      } catch (err) {
        $('#imp-map', container).innerHTML = `<div class="void-note" style="margin-top:12px">${esc(err.message)}</div>`;
      }
    } else if (e.target.closest('#imp-map')) runPreview();
  };
  container.onclick = async (e) => {
    const action = e.target.closest('[data-imp]')?.dataset.imp;
    if (action === 'close') {
      if (applied) { route(); return; }
      container.hidden = true; container.innerHTML = ''; return;
    }
    if (action !== 'apply' || !preview) return;
    const btn = e.target.closest('button');
    btn.disabled = true;
    try {
      const res = await api(`/api/admin/import/${kind}`, { method: 'POST', body: { rows: dataRows(), apply: true } });
      const c = res.counts;
      toast(`ثبت شد: ${fa(c.new ?? 0)} جدید، ${fa(c.update ?? 0)} به‌روزرسانی${c.warn ? `، ${fa(c.warn)} با هشدار` : ''}${c.error ? ` — ${fa(c.error)} ردیف مشکل‌دار ثبت نشد` : ''}`);
      applied = true;
      preview = null;
      $('#imp-map', container).querySelectorAll('select, input').forEach((el) => { el.disabled = true; });
      $('#imp-file', container).disabled = true;
      renderResult(res, true);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  };
}

async function viewItems(_, alive) {
  const items = await api('/api/admin/items');
  if (!alive()) return;
  const categories = [...new Set([...DEFAULT_CATEGORIES, ...items.map((i) => i.category).filter(Boolean)])];
  const groups = [...new Set(items.map((i) => i.category || 'سایر'))];

  view.innerHTML = `
    <div class="page-title"><h1>کالاها</h1><button type="button" class="btn ghost small" data-open-import="items">📥 ورود از اکسل</button></div>
    <div class="card" id="import" hidden></div>
    <div class="card">
      <div class="card-head"><h2 id="form-title">کالای جدید</h2></div>
      <form class="form" id="f">
        <div class="form-grid">
          <label>نام<input name="name" required maxlength="80" placeholder="مثلاً نیمرو" autocomplete="off"></label>
          <label>دسته<input name="category" list="cats" placeholder="مثلاً صبحانه" autocomplete="off"></label>
          <label>قیمت (تومان)<input name="price" inputmode="numeric" data-amount required autocomplete="off"><span class="hint"></span></label>
        </div>
        <datalist id="cats">${categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        <label class="check" id="active-wrap" hidden><input type="checkbox" name="isActive" checked> فعال (در صفحه‌ی ثبت سفارش نمایش داده شود)</label>
        <div class="row-end">
          <button type="button" class="btn ghost" id="cancel" hidden>انصراف</button>
          <button class="btn" id="save">افزودن</button>
        </div>
      </form>
    </div>
    <div class="card">
      ${items.length ? groups.map((g) => `
        <div class="cat-title">${esc(g)}</div>
        <div class="list">
          ${items.filter((i) => (i.category || 'سایر') === g).map((i) => `
            <div class="list-row">
              <div class="grow"><div class="title">${esc(i.name)} ${i.isActive ? '' : '<span class="badge off">غیرفعال</span>'}</div></div>
              <div class="amount">${priceHtml(i.price)}</div>
              <div class="actions">
                <button class="btn link small" data-edit="${i.id}">ویرایش</button>
                <button class="btn link danger small" data-del="${i.id}">حذف</button>
              </div>
            </div>`).join('')}
        </div>`).join('') : '<div class="empty">هنوز کالایی تعریف نشده است.</div>'}
    </div>`;

  const form = $('#f');
  const fields = form.elements;
  bindAmountHints(view);
  let editingId = null;
  const setEditing = (item) => {
    editingId = item?.id ?? null;
    form.reset();
    if (item) {
      fields.name.value = item.name;
      fields.category.value = item.category;
      fields.price.value = item.price;
      fields.isActive.checked = item.isActive;
    }
    fields.price.dispatchEvent(new Event('input'));
    $('#form-title').textContent = item ? `ویرایش «${item.name}»` : 'کالای جدید';
    $('#save').textContent = item ? 'ذخیره' : 'افزودن';
    $('#cancel').hidden = !item;
    $('#active-wrap').hidden = !item;
    if (item) { form.scrollIntoView({ behavior: 'smooth', block: 'center' }); fields.name.focus(); }
  };

  $('#cancel').addEventListener('click', () => setEditing(null));
  view.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) return setEditing(items.find((i) => i.id == edit.dataset.edit));
    const del = e.target.closest('[data-del]');
    if (del) {
      const item = items.find((i) => i.id == del.dataset.del);
      if (!confirm(`«${item.name}» حذف شود؟`)) return;
      try { await api(`/api/admin/items/${item.id}`, { method: 'DELETE' }); toast('حذف شد.'); route(); }
      catch (err) { toast(err.message, true); }
    }
  });
  onSubmit(form, async (fd) => {
    const price = parseAmount(fd.get('price'));
    if (Number.isNaN(price)) throw new Error('قیمت معتبر وارد کنید.');
    const body = { name: fd.get('name'), category: fd.get('category'), price, isActive: editingId ? fd.get('isActive') === 'on' : true };
    await api(editingId ? `/api/admin/items/${editingId}` : '/api/admin/items', { method: editingId ? 'PUT' : 'POST', body });
    toast(editingId ? 'ذخیره شد.' : 'کالا اضافه شد.');
    route();
  });
}

async function viewPeople(_, alive) {
  const [people, summary] = await Promise.all([api('/api/admin/people'), api('/api/report/summary')]);
  if (!alive()) return;
  const balance = new Map(summary.people.map((p) => [p.id, p.balance]));
  people.sort((a, b) => b.isActive - a.isActive || byName(a, b));
  const missing = people.filter((p) => p.isActive && !p.nationalCode).length;

  view.innerHTML = `
    <div class="page-title"><h1>افراد</h1><button type="button" class="btn ghost small" data-open-import="people">📥 ورود از اکسل</button></div>
    <div class="card" id="import" hidden></div>
    <div class="card">
      <div class="card-head"><h2 id="form-title">شخص جدید</h2></div>
      <form class="form" id="f">
        <div class="form-grid two">
          <label>نام و نام خانوادگی<input name="name" required maxlength="80" placeholder="مثلاً علی رضایی" autocomplete="off"></label>
          <label>کد ملی<input name="nationalCode" inputmode="numeric" maxlength="12" placeholder="۱۰ رقم — برای ورود خودش" autocomplete="off" class="code-input"></label>
        </div>
        <label class="check" id="active-wrap" hidden><input type="checkbox" name="isActive" checked> فعال (در ثبت سفارش نمایش داده شود و بتواند وارد شود)</label>
        <div class="row-end">
          <button type="button" class="btn ghost" id="cancel" hidden>انصراف</button>
          <button class="btn" id="save">افزودن شخص</button>
        </div>
      </form>
    </div>
    <div class="card">
      ${missing ? `<div class="hint" style="margin-bottom:8px">${fa(missing)} نفر هنوز کد ملی ندارند و نمی‌توانند وارد شوند.</div>` : ''}
      <input class="search" id="q" placeholder="جستجوی نام یا کد ملی…" autocomplete="off">
      <div class="list" id="list">
        ${people.length ? people.map((p) => `
          <div class="list-row" data-name="${esc(p.name)} ${esc(p.nationalCode ?? '')} ${faDigits(p.nationalCode ?? '')}">
            <div class="grow">
              <div class="title">${esc(p.name)} ${p.isActive ? '' : '<span class="badge off">غیرفعال</span>'}</div>
              <div class="sub">${p.nationalCode ? `کد ملی ${faDigits(p.nationalCode)}` : '<span class="void-note">بدون کد ملی</span>'}</div>
            </div>
            ${balanceBadge(balance.get(p.id) ?? 0)}
            <div class="actions">
              <button class="btn link small" data-edit="${p.id}">ویرایش</button>
              <button class="btn link danger small" data-del="${p.id}">حذف</button>
            </div>
          </div>`).join('') : '<div class="empty">هنوز شخصی تعریف نشده است.</div>'}
      </div>
    </div>`;

  bindSearch($('#q'), $('#list'));
  const form = $('#f');
  const fields = form.elements;
  let editingId = null;
  const setEditing = (p) => {
    editingId = p?.id ?? null;
    form.reset();
    if (p) {
      fields.name.value = p.name;
      fields.nationalCode.value = p.nationalCode ? faDigits(p.nationalCode) : '';
      fields.isActive.checked = p.isActive;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      fields.name.focus();
    }
    $('#form-title').textContent = p ? `ویرایش «${p.name}»` : 'شخص جدید';
    $('#save').textContent = p ? 'ذخیره' : 'افزودن شخص';
    $('#cancel').hidden = !p;
    $('#active-wrap').hidden = !p;
  };
  $('#cancel').addEventListener('click', () => setEditing(null));

  view.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) return setEditing(people.find((p) => p.id == edit.dataset.edit));
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const p = people.find((x) => x.id == del.dataset.del);
    if (!confirm(`«${p.name}» حذف شود؟`)) return;
    try { await api(`/api/admin/people/${p.id}`, { method: 'DELETE' }); toast('حذف شد.'); route(); }
    catch (err) { toast(err.message, true); }
  });
  onSubmit(form, async (fd) => {
    const body = {
      name: fd.get('name'),
      nationalCode: toLatinDigits(fd.get('nationalCode')),
      isActive: editingId ? fd.get('isActive') === 'on' : true,
    };
    await api(editingId ? `/api/admin/people/${editingId}` : '/api/admin/people', { method: editingId ? 'PUT' : 'POST', body });
    toast(editingId ? 'ذخیره شد.' : 'شخص اضافه شد.');
    route();
  });
}

async function viewSettings(_, alive) {
  const users = await api('/api/admin/users');
  if (!alive()) return;
  view.innerHTML = `
    <div class="page-title"><h1>تنظیمات</h1></div>
    <div class="card" id="push"></div>
    <div class="card" id="cards"></div>
    <div class="cols">
      <div class="card">
        <div class="card-head"><h2>تغییر رمز عبور</h2></div>
        <form class="form" id="pw">
          <label>رمز فعلی<input name="current" type="password" autocomplete="current-password" required></label>
          <label>رمز جدید<input name="new" type="password" autocomplete="new-password" minlength="6" required></label>
          <div class="row-end"><button class="btn">تغییر رمز</button></div>
        </form>
      </div>
      <div class="card">
        <div class="card-head"><h2>حساب‌های مسئول</h2></div>
        <div class="list">
          ${users.map((u) => `
            <div class="list-row">
              <div class="grow"><div class="title">${esc(u.username)}</div><div class="sub">ساخته‌شده ${fmtDT(u.createdAt)}</div></div>
              ${u.username === state.me.username ? '<span class="badge zero">شما</span>' : `<button class="btn link danger small" data-del="${u.id}">حذف</button>`}
            </div>`).join('')}
        </div>
        <form class="form" id="add" style="margin-top:12px">
          <label>نام کاربری<input name="username" autocomplete="off" required minlength="3"></label>
          <label>رمز عبور<input name="password" type="password" autocomplete="new-password" required minlength="6"></label>
          <div class="row-end"><button class="btn">افزودن مسئول</button></div>
        </form>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>درباره</h2>${state.me.version ? `<span class="badge zero">نسخه ${faDigits(state.me.version)}</span>` : ''}</div>
      <p class="muted" style="margin:0">بوفه (OfficeBuffet) نرم‌افزار متن‌باز با مجوز MIT است.
        <a href="${REPO_URL}" target="_blank" rel="noopener">کد و نسخه‌های جدید در GitHub</a></p>
    </div>`;

  onSubmit($('#pw'), async (fd) => {
    await api('/api/auth/password', { method: 'POST', body: { current: fd.get('current'), new: fd.get('new') } });
    toast('رمز عبور تغییر کرد.');
    $('#pw').reset();
  });
  onSubmit($('#add'), async (fd) => {
    await api('/api/admin/users', { method: 'POST', body: { username: fd.get('username'), password: fd.get('password') } });
    toast('مسئول جدید اضافه شد.');
    route();
  });
  view.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-del]');
    if (!del || !confirm('این حساب حذف شود؟')) return;
    try { await api(`/api/admin/users/${del.dataset.del}`, { method: 'DELETE' }); toast('حذف شد.'); route(); }
    catch (err) { toast(err.message, true); }
  });
  renderPushCard(alive);
  renderCardsAdmin($('#cards'), alive);
}

// ---------- bank cards colleagues pay into ----------
/** "6219861904764809" → "6219 8619 0476 4809" in Persian digits. */
const cardNumberText = (n) => faDigits(String(n).replace(/(\d{4})(?=\d)/g, '$1 '));

/** Copies text to the clipboard; also works on plain http, where navigator.clipboard is unavailable. */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall back below */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length); // iOS
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* not supported */ }
  ta.remove();
  return ok;
}

/** Card list with a copy action on each number (colleague's account page). */
const payCardsHtml = (cards) => (cards.length ? `
  <div class="pay-cards">
    <div class="muted" style="font-size:13px">برای پرداخت، روی شماره کارت بزنید تا کپی شود:</div>
    ${cards.map((c) => `
      <button type="button" class="pay-card" data-copy="${esc(c.number)}" title="کپی شماره کارت">
        <span class="t">${esc(c.title)}</span>
        <span class="n">${cardNumberText(c.number)}</span>
        <span class="c">📋 کپی</span>
      </button>`).join('')}
  </div>` : '');

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const ok = await copyText(btn.dataset.copy);
  toast(ok ? `شماره کارت کپی شد: ${cardNumberText(btn.dataset.copy)}` : 'کپی نشد؛ شماره را دستی انتخاب کنید.', !ok);
  if (ok) { btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1500); }
});

/** Settings card where the manager defines the bank cards and their titles. */
async function renderCardsAdmin(card, alive) {
  const cards = await api('/api/admin/cards');
  if (!alive()) return;
  let editingId = null;
  card.innerHTML = `
    <div class="card-head"><h2>شماره کارت‌ها</h2></div>
    <p class="muted" style="margin-top:0">کارت‌هایی که همکاران به آن‌ها پرداخت می‌کنند. در «حساب من» هر همکار، زیر مانده‌ی حساب، با عنوانشان نمایش داده می‌شوند و با یک ضربه کپی می‌شوند.</p>
    <div class="list">
      ${cards.length ? cards.map((c) => `
        <div class="list-row">
          <div class="grow"><div class="title">${esc(c.title)}</div><div class="sub card-no">${cardNumberText(c.number)}</div></div>
          <div class="actions">
            <button class="btn link small" data-card-edit="${c.id}">ویرایش</button>
            <button class="btn link danger small" data-card-del="${c.id}">حذف</button>
          </div>
        </div>`).join('') : '<div class="empty">هنوز کارتی تعریف نشده است.</div>'}
    </div>
    <form class="form" id="card-form" style="margin-top:12px">
      <div class="form-grid two">
        <label>عنوان کارت<input name="title" maxlength="60" required placeholder="مثلاً کارت صبحانه" autocomplete="off"></label>
        <label>شماره کارت<input name="number" inputmode="numeric" maxlength="25" required placeholder="۱۶ رقم" autocomplete="off" class="code-input"></label>
      </div>
      <div class="row-end">
        <button type="button" class="btn ghost" id="card-cancel" hidden>انصراف</button>
        <button class="btn" id="card-save">افزودن کارت</button>
      </div>
    </form>`;

  const form = $('#card-form', card);
  const setEditing = (c) => {
    editingId = c?.id ?? null;
    form.reset();
    if (c) { form.elements.title.value = c.title; form.elements.number.value = faDigits(c.number); form.elements.title.focus(); }
    $('#card-save', card).textContent = c ? 'ذخیره' : 'افزودن کارت';
    $('#card-cancel', card).hidden = !c;
  };
  $('#card-cancel', card).onclick = () => setEditing(null);
  card.onclick = async (e) => {
    const edit = e.target.closest('[data-card-edit]');
    if (edit) return setEditing(cards.find((c) => c.id == edit.dataset.cardEdit));
    const del = e.target.closest('[data-card-del]');
    if (!del) return;
    const c = cards.find((x) => x.id == del.dataset.cardDel);
    if (!confirm(`کارت «${c.title}» حذف شود؟`)) return;
    try { await api(`/api/admin/cards/${c.id}`, { method: 'DELETE' }); toast('کارت حذف شد.'); renderCardsAdmin(card, alive); }
    catch (err) { toast(err.message, true); }
  };
  onSubmit(form, async (fd) => {
    const body = { title: fd.get('title'), number: toLatinDigits(fd.get('number')) };
    const save = () => api(editingId ? `/api/admin/cards/${editingId}` : '/api/admin/cards', { method: editingId ? 'PUT' : 'POST', body });
    try { await save(); }
    catch (err) {
      // Number fails the check digit: probably a typo, but let the manager keep it if they are sure.
      if (!err.data?.confirm || !confirm(`${err.message}\n\nشماره را دوباره نگاه کنید. اگر مطمئنید درست است، «OK» را بزنید تا ثبت شود.`)) throw err;
      body.force = true;
      await save();
    }
    toast(editingId ? 'کارت ذخیره شد.' : 'کارت اضافه شد.');
    renderCardsAdmin(card, alive);
  });
}

// ---------- pantry requests ----------
const REQUEST_STATUS = {
  pending: ['در انتظار', 'wait'], done: ['ثبت شد', 'credit'], rejected: ['رد شد', 'debt'], cancelled: ['لغو شد', 'off'],
};
const linesText = (lines) => lines.map((l) => (l.quantity === 1 ? l.itemName : `${fa(l.quantity)} × ${l.itemName}`)).join('، ');
const statusBadge = (s) => `<span class="badge ${REQUEST_STATUS[s][1]}">${REQUEST_STATUS[s][0]}</span>`;

/** Employee page: the price list doubles as a request form ("I'd like a coffee"). */
async function viewPrices(_, alive) {
  const items = await api('/api/report/prices');
  if (!alive()) return;
  const groups = [...new Set(items.map((i) => i.category || 'سایر'))];
  const cart = new Map();
  view.innerHTML = `
    <div class="page-title"><h1>لیست قیمت و درخواست</h1></div>
    <div class="card" id="push" hidden></div>
    <div class="card">
      ${items.length ? `
        <p class="muted" style="margin-top:0">تعداد را انتخاب کنید و «ارسال درخواست» را بزنید تا مسئول بوفه باخبر شود.</p>
        ${groups.map((g) => `
          <div class="cat-title">${esc(g)}</div>
          <div class="items-grid">
            ${items.filter((i) => (i.category || 'سایر') === g).map((i) => `
              <div class="item-tile" data-item="${i.id}">
                <div class="name">${esc(i.name)}</div>
                <div class="price">${priceHtml(i.price)}</div>
                <div class="stepper">
                  <button type="button" data-step="-1" aria-label="کم کردن">−</button>
                  <span class="qty">۰</span>
                  <button type="button" data-step="1" aria-label="اضافه کردن">+</button>
                </div>
              </div>`).join('')}
          </div>`).join('')}
        <label style="margin-top:14px">توضیح (اختیاری)<input id="note" maxlength="200" placeholder="مثلاً کم‌شیرین، اتاق ۲۰۳"></label>
        <div class="order-bar">
          <div><div class="pending-count" id="cnt"></div><div class="total" id="tot"></div></div>
          <div class="order-actions">
            <button type="button" class="btn ghost" id="clear-cart" hidden title="صفر کردن همه‌ی اقلام انتخاب‌شده">🗑️ خالی کردن</button>
            <button class="btn" id="submit">ارسال درخواست</button>
          </div>
        </div>` : '<div class="empty">هنوز کالایی تعریف نشده است.</div>'}
    </div>
    <div class="card"><div class="card-head"><h2>درخواست‌های من</h2></div><div class="list" id="mine"></div></div>`;

  const updateBar = () => {
    const lines = [...cart.entries()].filter(([, q]) => q > 0);
    const count = sum(lines, ([, q]) => q);
    $('#cnt').textContent = count ? `${fa(count)} قلم انتخاب شده` : 'هنوز چیزی انتخاب نشده';
    $('#tot').innerHTML = money(sum(lines, ([id, q]) => items.find((i) => i.id === id).price * q));
    $('#submit').disabled = count === 0;
    $('#clear-cart').hidden = count === 0;
  };
  const clearCart = () => {
    [...cart.keys()].forEach((id) => setQty(id, 0));
    $('#note').value = '';
  };
  const setQty = (id, qty) => {
    qty = Math.max(0, Math.min(10, qty));
    cart.set(id, qty);
    const tile = view.querySelector(`[data-item="${id}"]`);
    tile.querySelector('.qty').textContent = fa(qty);
    tile.classList.toggle('selected', qty > 0);
    updateBar();
  };

  // Statuses from the previous refresh, so an answer that arrives while the page is open is announced.
  let seen = null;
  const renderMine = async () => {
    const mine = await api('/api/requests');
    if (!alive()) return;
    const answered = seen ? mine.filter((r) => seen.get(r.id) === 'pending' && (r.status === 'done' || r.status === 'rejected')) : [];
    seen = new Map(mine.map((r) => [r.id, r.status]));
    if (answered.length) {
      // One toast for everything answered since the last refresh (a second toast would replace the first).
      toast(answered.map((r) => (r.status === 'done'
        ? `☕ درخواستت (${linesText(r.lines)}) دیده شد و تا دقایقی دیگر آماده می‌شود.`
        : `✋ درخواستت (${linesText(r.lines)}) رد شد${r.rejectReason ? `؛ دلیل: ${r.rejectReason}` : ''}.`)).join('\n'),
        answered.some((r) => r.status === 'rejected'));
      beep();
    }
    $('#mine').innerHTML = mine.length ? mine.map((r) => `
      <div class="list-row">
        <div class="grow">
          <div class="title">${esc(linesText(r.lines))}</div>
          <div class="sub">${fmtDT(r.createdAt)}${r.note ? ' · ' + esc(r.note) : ''}${r.rejectReason ? ' · دلیل: ' + esc(r.rejectReason) : ''}${r.status === 'pending' && r.remindCount ? ` · ${fa(r.remindCount)} بار تلنگر زدی` : ''}</div>
        </div>
        ${statusBadge(r.status)}
        ${r.status === 'pending' ? remindButton(r) : ''}
        ${r.status === 'pending' ? `<button class="btn link danger small" data-cancel="${r.id}">لغو</button>` : ''}
      </div>`).join('') : '<div class="empty">هنوز درخواستی نفرستاده‌اید.</div>';
    tickReminders();
  };

  // "Nudge" button: re-sends the notification to the admin, with a short cooldown shown as a countdown.
  const REMIND_EVERY_MS = 2 * 60 * 1000;
  const MAX_REMINDERS = 2;
  const remindButton = (r) => {
    if (r.remindCount >= MAX_REMINDERS) return '<span class="nudge-done">🚶 به نظر می‌رسه سرش شلوغه؛ یه سر حضوری بزن!</span>';
    const at = new Date(r.remindedAt || r.createdAt).getTime() + REMIND_EVERY_MS;
    return `<button class="btn ghost small nudge" data-remind="${r.id}" data-remind-at="${at}" title="دوباره به مسئول بوفه خبر بده">👋 یه تلنگر بزن!</button>`;
  };
  const tickReminders = () => {
    view.querySelectorAll('[data-remind-at]').forEach((b) => {
      const left = Math.ceil((Number(b.dataset.remindAt) - Date.now()) / 1000);
      b.disabled = left > 0;
      b.textContent = left > 0 ? `⏳ ${faDigits(`${Math.floor(left / 60)}:${pad2(left % 60)}`)}` : '👋 یه تلنگر بزن!';
    });
  };
  const ticker = setInterval(() => (alive() ? tickReminders() : clearInterval(ticker)), 1000);

  view.addEventListener('click', async (e) => {
    const tile = e.target.closest('[data-item]');
    if (tile) {
      const id = Number(tile.dataset.item);
      const step = e.target.closest('[data-step]');
      return setQty(id, (cart.get(id) || 0) + (step ? Number(step.dataset.step) : 1));
    }
    const remind = e.target.closest('[data-remind]');
    if (remind) {
      remind.disabled = true;
      try {
        const res = await api(`/api/requests/${remind.dataset.remind}/remind`, { method: 'POST' });
        toast(res.remindCount >= MAX_REMINDERS
          ? '👋 تلنگر دوم هم زده شد! اگه باز خبری نشد، به نظر می‌رسه باید یه سر حضوری بزنی.'
          : '👋 تلنگر زده شد! مسئول بوفه دوباره خبردار شد.');
      } catch (err) { toast(err.message, true); }
      renderMine();
      return;
    }
    if (e.target.closest('#clear-cart')) {
      clearCart();
      toast('سبد خالی شد.');
      return;
    }
    const cancel = e.target.closest('[data-cancel]');
    if (cancel) {
      if (!confirm('این درخواست لغو شود؟')) return;
      try { await api(`/api/requests/${cancel.dataset.cancel}/cancel`, { method: 'POST' }); toast('درخواست لغو شد.'); renderMine(); }
      catch (err) { toast(err.message, true); }
      return;
    }
    if (e.target.closest('#submit')) {
      const btn = $('#submit');
      const lines = [...cart.entries()].filter(([, q]) => q > 0).map(([itemId, quantity]) => ({ itemId, quantity }));
      btn.disabled = true;
      try {
        await api('/api/requests', { method: 'POST', body: { lines, note: $('#note').value } });
        toast('درخواست شما برای مسئول بوفه فرستاده شد.');
        clearCart();
        renderMine();
      } catch (err) {
        toast(err.message, true);
        updateBar();
      }
    }
  });

  if (items.length) updateBar();
  renderPushCard(alive, { hideWhenOn: true });
  await renderMine();
  // Keep the status of sent requests fresh while the page is open.
  const timer = setInterval(() => (alive() ? !document.hidden && renderMine().catch(() => {}) : clearInterval(timer)), 20000);
}

/** Admin page: incoming requests, plus turning on push notifications for this device. */
async function viewRequests(tab, alive) {
  const data = await api('/api/admin/requests');
  if (!alive()) return;
  setRequestBadge(data.pending.length);
  const done = tab === 'done';
  const estimate = (r) => sum(r.lines, (l) => (l.unitPrice ?? 0) * l.quantity);
  view.innerHTML = `
    <div class="page-title"><h1>درخواست‌ها</h1></div>
    <div class="card" id="push" hidden></div>
    <div class="chips">
      <a class="chip ${done ? '' : 'active'}" href="#/requests">در انتظار${data.pending.length ? ` (${fa(data.pending.length)})` : ''}</a>
      <a class="chip ${done ? 'active' : ''}" href="#/requests/done">رسیدگی‌شده${data.recent.length ? ` (${fa(data.recent.length)})` : ''}</a>
    </div>
    ${done ? '' : `<div class="card">
      <div class="list">
        ${data.pending.length ? data.pending.map((r) => `
          <div class="list-row request-row">
            <div class="grow">
              <div class="title">${esc(r.personName)}</div>
              <div>${esc(linesText(r.lines))}</div>
              <div class="sub">${fmtDT(r.createdAt)}${r.note ? ' · ' + esc(r.note) : ''}</div>
              ${r.remindCount ? `<div class="sub"><span class="badge warn">👋 ${fa(r.remindCount)} بار تلنگر زده · آخرین ${fmtDT(r.remindedAt)}</span></div>` : ''}
            </div>
            <div class="amount">${money(estimate(r))}</div>
            <div class="actions">
              <button class="btn small" data-accept="${r.id}">ثبت سفارش</button>
              <button class="btn link danger small" data-reject="${r.id}">رد</button>
            </div>
          </div>`).join('') : '<div class="empty">درخواستی در انتظار نیست.</div>'}
      </div>
    </div>`}
    ${done ? `
      <div class="card">
        <div class="list">
          ${data.recent.length ? data.recent.map((r) => `
            <div class="list-row">
              <div class="grow">
                <div class="title">${esc(r.personName)}</div>
                <div class="sub">${esc(linesText(r.lines))} · ${fmtDT(r.handledAt || r.createdAt)}${r.handledBy ? ` · ${esc(r.handledBy)}` : ''}${r.rejectReason ? ' · دلیل: ' + esc(r.rejectReason) : ''}</div>
              </div>
              ${statusBadge(r.status)}
            </div>`).join('') : '<div class="empty">هنوز درخواستی رسیدگی نشده است.</div>'}
        </div>
      </div>` : ''}`;

  view.addEventListener('click', async (e) => {
    const accept = e.target.closest('[data-accept]');
    if (accept) {
      accept.disabled = true;
      try {
        const res = await api(`/api/admin/requests/${accept.dataset.accept}/accept`, { method: 'POST' });
        toast(`ثبت شد: ${res.personName} — ${fa(res.total)} تومان`);
      } catch (err) { toast(err.message, true); }
      return route();
    }
    const reject = e.target.closest('[data-reject]');
    if (reject) {
      const reason = await askText({ title: 'رد درخواست', text: 'دلیل را بنویسید تا درخواست‌دهنده ببیند.', placeholder: 'مثلاً شیر تمام شده', okText: 'رد درخواست' });
      if (!reason) return;
      try { await api(`/api/admin/requests/${reject.dataset.reject}/reject`, { method: 'POST', body: { reason } }); toast('درخواست رد شد.'); }
      catch (err) { toast(err.message, true); }
      return route();
    }
  });

  renderPushCard(alive, { hideWhenOn: true });
}

// ---------- push notifications (admin device) ----------
const pushSupported = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64urlBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function currentPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

const chimeButton = '<button type="button" class="btn ghost small" data-chime>🔔 پخش صدای هشدار</button>';
document.addEventListener('click', (e) => { if (e.target.closest('[data-chime]')) beep(); });

/**
 * "Notifications on this device" card, for the admin (new requests) or an employee (rejected requests).
 * With `hideWhenOn` the card only shows until notifications are on; after that it lives on the settings page.
 */
async function renderPushCard(alive, { card = $('#push'), hideWhenOn = false } = {}) {
  if (!card) return;
  const admin = isAdmin();
  const settingsPage = admin ? 'تنظیمات' : 'حساب من';
  if (!pushSupported()) {
    const ios = /iphone|ipad/i.test(navigator.userAgent);
    card.hidden = false;
    card.innerHTML = `<div class="card-head"><h2>اعلان روی گوشی</h2></div>
      <p class="muted" style="margin:0">${!window.isSecureContext
        ? `اعلان روی گوشی فقط وقتی کار می‌کند که برنامه با آدرس <b>https</b> باز شود. ${admin ? 'تا آن موقع، وقتی برنامه باز است درخواست‌های جدید با صدا و پیام اطلاع داده می‌شوند.' : 'تا آن موقع، وقتی همین صفحه باز است جواب درخواست‌ها با پیام اطلاع داده می‌شود.'}`
        : ios ? 'در آیفون، اول برنامه را از منوی Share با «Add to Home Screen» به صفحه‌ی اصلی اضافه کنید و از همان‌جا باز کنید.'
          : 'این مرورگر از اعلان پشتیبانی نمی‌کند.'}</p>
      ${admin ? `<div class="row-end">${chimeButton}</div>` : ''}`;
    return;
  }
  const sub = await currentPushSubscription();
  if (!alive()) return;
  const on = sub && Notification.permission === 'granted';
  if (on) api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() }).catch(() => {}); // keep the server in sync
  card.hidden = on && hideWhenOn;
  if (card.hidden) { card.innerHTML = ''; return; }
  card.innerHTML = `<div class="card-head"><h2>اعلان روی این دستگاه</h2>${on ? '<span class="badge credit">فعال</span>' : ''}</div>
    <p class="muted" style="margin-top:0">${on
      ? (admin ? 'وقتی کسی درخواست بفرستد، روی این دستگاه اعلان می‌آید؛ حتی اگر برنامه بسته باشد.'
        : 'وقتی درخواستت دیده و آماده شود یا رد شود، روی همین گوشی خبردار می‌شوی؛ حتی اگر برنامه بسته باشد.')
      : Notification.permission === 'denied'
        ? 'اجازه‌ی اعلان برای این سایت در تنظیمات مرورگر بسته شده است؛ از تنظیمات سایت آن را روی Allow بگذارید.'
        : `${admin ? 'با فعال‌سازی، درخواست‌های جدید روی این گوشی یا کامپیوتر اعلان می‌شوند؛ حتی وقتی برنامه بسته است.'
          : 'با فعال‌سازی، وقتی مسئول بوفه درخواستت را ببیند و ثبت کند (یا با دلیل رد کند) روی همین گوشی خبردار می‌شوی.'}
          ${hideWhenOn ? `بعد از فعال‌سازی، این بخش به صفحه‌ی «${settingsPage}» می‌رود.` : ''}`}</p>
    ${on && admin && /android/i.test(navigator.userAgent) ? `<p class="hint" style="margin-top:0">برای صدای مخصوص اعلان در اندروید: تنظیمات گوشی ← برنامه‌ها ← «بوفه» (یا Chrome) ← اعلان‌ها ← صدا.</p>` : ''}
    <div class="row-end">
      ${admin ? chimeButton : ''}
      ${on ? `<button class="btn ghost small" id="push-off">غیرفعال کردن</button>${admin ? '<button class="btn small" id="push-test">ارسال اعلان آزمایشی</button>' : ''}`
        : Notification.permission === 'denied' ? '' : '<button class="btn" id="push-on">فعال‌سازی اعلان</button>'}
    </div>`;
  card.onclick = async (e) => {
    const btn = e.target.closest('button');
    if (!btn || 'chime' in btn.dataset) return;
    btn.disabled = true;
    try {
      if (btn.id === 'push-on') {
        await enablePush();
        toast(hideWhenOn ? `اعلان فعال شد. تنظیماتش از این به بعد در صفحه‌ی «${settingsPage}» است.` : 'اعلان فعال شد.');
      }
      if (btn.id === 'push-off') { await disablePush(); toast('اعلان غیرفعال شد.'); }
      if (btn.id === 'push-test') {
        const res = await api('/api/admin/push/test', { method: 'POST' });
        if (res.sent) toast('اعلان آزمایشی فرستاده شد.');
        else toast('ارسال نشد؛ سرور به سرویس اعلان (اینترنت) دسترسی ندارد. لاگ سرور را بررسی کنید.', true);
      }
    } catch (err) { toast(err.message, true); }
    renderPushCard(alive, { card, hideWhenOn });
  };
}

async function enablePush() {
  if (await Notification.requestPermission() !== 'granted') throw new Error('اجازه‌ی نمایش اعلان داده نشد.');
  const reg = await navigator.serviceWorker.ready;
  await (await reg.pushManager.getSubscription())?.unsubscribe(); // may belong to an older server key
  const { publicKey } = await api('/api/push/key');
  let sub;
  try {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlBytes(publicKey) });
  } catch {
    throw new Error('ثبت اعلان ناموفق بود؛ مرورگر به سرویس اعلان دسترسی ندارد.');
  }
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
}

async function disablePush() {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}

// While an admin page is open: badge on the tab, plus a sound and message when a new request arrives.
let lastRequestId = null;
function setRequestBadge(count) {
  state.pendingRequests = count;
  const badge = $('#tabs .tab-badge');
  if (badge) { badge.textContent = fa(count); badge.hidden = !count; }
}

let lastReminder = null;
async function pollRequests() {
  if (!isAdmin() || document.hidden) return;
  try {
    const { count, latestId, lastReminder: reminder } = await api('/api/admin/requests/pending');
    setRequestBadge(count);
    const isNew = lastRequestId !== null && latestId > lastRequestId;
    // An employee pressed "nudge" on a request that is still waiting.
    const nudged = lastRequestId !== null && reminder && reminder !== lastReminder;
    if (isNew || nudged) {
      toast(isNew ? 'درخواست جدید رسید.' : '👋 یک نفر هنوز منتظر درخواستش است!');
      beep();
      if (location.hash.startsWith('#/requests')) route();
    }
    lastRequestId = Math.max(lastRequestId ?? 0, latestId);
    lastReminder = reminder;
  } catch { /* offline: try again on the next tick */ }
}
setInterval(pollRequests, 15000);
document.addEventListener('visibilitychange', pollRequests);

// A new request plays the push message straight away when the app is open (instead of waiting for the next poll).
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'request' && isAdmin()) pollRequests();
});

let audio;
// Browsers only allow sound after the user has touched the page once; unlock it on the first tap.
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => {
  try { audio ??= new AudioContext(); audio.resume(); } catch { /* no audio available */ }
}, { once: true, capture: true }));

/** Loud, distinctive bell chime (rising three notes, played twice) so a new request is hard to miss. */
function beep() {
  try {
    audio ??= new AudioContext();
    audio.resume();
    const out = audio.createDynamicsCompressor();
    out.connect(audio.destination);
    const notes = [784, 988, 1319]; // G5, B5, E6
    [0, 0.9].forEach((start) => notes.forEach((freq, i) => {
      const at = audio.currentTime + start + i * 0.16;
      // Fundamental plus a bright overtone gives a bell-like tone that cuts through room noise.
      [[freq, 0.9], [freq * 2.76, 0.25]].forEach(([f, level]) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = 'triangle';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(level, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.6);
        osc.connect(gain).connect(out);
        osc.start(at);
        osc.stop(at + 0.65);
      });
    }));
  } catch { /* no audio available */ }
  navigator.vibrate?.([300, 120, 300, 120, 600]);
}

// ---------- routing & shell ----------
const routes = {
  report: viewReport, person: viewPerson, me: viewPerson, login: viewLogin, prices: viewPrices, requests: viewRequests,
  order: viewOrder, payments: viewPayments, items: viewItems, people: viewPeople, settings: viewSettings,
};
const adminOnly = new Set(['report', 'person', 'order', 'requests', 'payments', 'items', 'people', 'settings']);
const employeeOnly = new Set(['prices']);
const homeHash = () => (isAdmin() ? '#/order' : isEmployee() ? '#/me' : '#/login');
let routeSeq = 0;

const REPO_URL = 'https://github.com/Mohamadkhadem/OfficeBuffet';
/** Small "OfficeBuffet v1.0.0" line linking to the project, shown under login and account pages. */
const versionLine = () => (state.me.version
  ? `<p class="version-line"><a href="${REPO_URL}" target="_blank" rel="noopener">بوفه · نسخه ${faDigits(state.me.version)}</a></p>` : '');

async function refreshMe() {
  try { state.me = await api('/api/auth/me'); } catch { state.me = { loggedIn: false }; }
}

function renderShell(active) {
  const tabs = isAdmin()
    ? [['order', 'ثبت سفارش'], ['requests', 'درخواست‌ها'], ['report', 'گزارش'], ['payments', 'پرداخت و تسویه'], ['items', 'کالاها'], ['people', 'افراد'], ['settings', 'تنظیمات']]
    : isEmployee() ? [['me', 'حساب من'], ['prices', 'قیمت و درخواست']] : [];
  $('#tabs').hidden = tabs.length === 0;
  const current = active === 'person' ? 'report' : active;
  const count = state.pendingRequests || 0;
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<a href="#/${k}" class="${k === current ? 'active' : ''}">${l}${
    k === 'requests' ? `<span class="tab-badge"${count ? '' : ' hidden'}>${fa(count)}</span>` : ''}</a>`).join('');
  $('#account').innerHTML = state.me.loggedIn
    ? `<span class="muted">${esc(isAdmin() ? state.me.username : state.me.personName)}</span><button class="btn ghost small" id="logout">خروج</button>`
    : '';
}

async function route() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const key = routes[name] ? name : homeHash().slice(2);
  if (!state.me.loggedIn && key !== 'login') { location.hash = '#/login'; return; }
  if ((adminOnly.has(key) && !isAdmin()) || (employeeOnly.has(key) && !isEmployee())) { location.hash = homeHash(); return; }
  pollRequests();
  const seq = ++routeSeq;
  state.refresh = null;
  // Fresh element per page so listeners added by the previous view don't pile up.
  const fresh = view.cloneNode(false);
  view.replaceWith(fresh);
  view = fresh;
  renderShell(key);
  try {
    await routes[key](arg, () => seq === routeSeq);
  } catch (err) {
    if (seq === routeSeq) view.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
  }
}

document.addEventListener('click', async (e) => {
  const chip = e.target.closest('[data-period]');
  if (chip) {
    state.period = chip.dataset.period;
    save('period', state.period);
    return route();
  }
  const voidBtn = e.target.closest('[data-void]');
  if (voidBtn) {
    const [kind, id] = voidBtn.dataset.void.split(':');
    const reason = await askText({
      title: { order: 'ابطال سفارش', payment: 'ابطال پرداخت', settlement: 'ابطال تسویه' }[kind],
      text: kind === 'settlement'
        ? 'با ابطال تسویه، ثبت‌های قبل از آن دوباره در مانده‌ی حساب حساب می‌شوند. خود تسویه با علامت «ابطال» در گزارش باقی می‌ماند.'
        : 'این ثبت پاک نمی‌شود؛ با علامت «ابطال» و دلیل آن در گزارش‌ها باقی می‌ماند.',
      placeholder: 'دلیل ابطال (مثلاً ثبت تکراری)',
      okText: 'ابطال',
    });
    if (!reason) return;
    try {
      const path = { order: 'orders', payment: 'payments', settlement: 'settlements' }[kind];
      await api(`/api/admin/${path}/${id}/void`, { method: 'POST', body: { reason } });
      toast('ابطال شد.');
      state.refresh ? state.refresh() : route();
    } catch (err) { toast(err.message, true); }
    return;
  }
  if (e.target.closest('#logout')) {
    await disablePush().catch(() => {}); // stop this device getting notifications
    lastRequestId = null;
    lastReminder = null;
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    await refreshMe();
    location.hash = '#/login';
    route();
  }
});

// ---------- light / dark toggle ----------
const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const currentTheme = () => document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light');

function renderThemeButton() {
  const dark = currentTheme() === 'dark';
  const btn = $('#theme-btn');
  btn.innerHTML = dark ? SUN : MOON;
  btn.title = dark ? 'حالت روشن' : 'حالت تاریک';
  btn.setAttribute('aria-label', btn.title);
  document.querySelector('meta[name="theme-color"]').content = dark ? '#171c23' : '#2f8f46';
}

$('#theme-btn').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  save('theme', next);
  renderThemeButton();
});
systemDark.addEventListener('change', renderThemeButton);
renderThemeButton();

window.addEventListener('hashchange', route);
await refreshMe();
route();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

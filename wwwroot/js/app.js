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
const money = (n) => `${fa(n)} <small class="money-unit">تومان</small>`;
const priceHtml = (p) => (p > 0 ? money(p) : '<span class="badge credit">رایگان</span>');
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const byName = (a, b) => a.name.localeCompare(b.name, 'fa');
const isWide = () => matchMedia('(min-width: 900px)').matches;

/** Icon from the sprite in index.html, e.g. ic('pencil') or ic('clock', 'sm'). */
const ic = (name, cls = '') => `<svg class="i${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
/** A details line ("Ali | 21 Aban, 11:21 | by manager"); empty parts are skipped. */
const metaHtml = (parts, cls = 'sub') => `<div class="${cls} meta">${parts.filter(Boolean).map((p) => `<span>${p}</span>`).join('')}</div>`;
/** Empty list: an icon for what would be here, and one line on what to do. */
const emptyHtml = (icon, text) => `<div class="empty"><span class="em-icon">${ic(icon)}</span><div>${text}</div></div>`;

const toLatinDigits = (s) => String(s ?? '')
  .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const faDigits = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const pad2 = (n) => String(n).padStart(2, '0');

const monthFmt = new Intl.DateTimeFormat('fa-IR', { month: 'long' });
const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
/** "۲۱ آبان، ۱۱:۲۱" this year, "۱۴۰۴/۱۲/۰۵، ۱۱:۲۱" for other years. */
function fmtDT(iso) {
  const d = new Date(iso);
  const j = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const now = new Date();
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const sameYear = toJalali(now.getFullYear(), now.getMonth() + 1, now.getDate()).jy === j.jy;
  return faDigits(sameYear ? `${j.jd} ${JALALI_MONTHS[j.jm - 1]}، ${time}` : `${j.jy}/${pad2(j.jm)}/${pad2(j.jd)}، ${time}`);
}

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

/** The last day of the previous Jalali month, as "1405/07/30". */
function lastMonthEndLabel() {
  const j = parseJalali(jalaliLabel());
  const d = new Date(j.date);
  d.setDate(d.getDate() - Number(j.label.slice(8)));
  const r = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return `${r.jy}/${pad2(r.jm)}/${pad2(r.jd)}`;
}

/** The moment a Jalali day ends (start of the next day, device time) as an ISO string, for "up to and including" cutoffs. */
function endOfJalaliDay(j) {
  const d = new Date(j.date);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
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

/** Fills the app's dialog and opens it; resolves with the dialog once it closes. */
function openDialog({ title, text = '', okText, danger = true, input = null }) {
  const dlg = $('#dialog');
  const field = $('#dialog-input');
  $('#dialog-title').textContent = title;
  $('#dialog-text').textContent = faDigits(text);
  $('#dialog-ok').textContent = okText;
  $('#dialog-ok').className = danger ? 'btn danger' : 'btn';
  field.hidden = !input;
  field.required = !!input;
  field.value = '';
  field.placeholder = input?.placeholder ?? '';
  dlg.returnValue = '';
  $('#dialog-cancel').onclick = () => dlg.close('cancel');
  return new Promise((resolve) => {
    dlg.onclose = () => resolve(dlg);
    dlg.showModal();
    (input ? field : $('#dialog-cancel')).focus();
  });
}

/** Small modal asking for a line of text. Resolves to the text, or null when cancelled. */
async function askText({ title, text = '', placeholder = '', okText = 'تأیید' }) {
  const dlg = await openDialog({ title, text, okText, input: { placeholder } });
  const value = $('#dialog-input').value.trim();
  return dlg.returnValue === 'ok' && value ? value : null;
}

/** Yes/no question in the app's own dialog (instead of the browser's confirm). The OK button names the action. */
async function askConfirm({ title, text = '', okText, danger = true }) {
  const dlg = await openDialog({ title, text, okText, danger });
  return dlg.returnValue === 'ok';
}

async function api(path, { method = 'GET', body } = {}) {
  let res;
  const isFile = body instanceof Blob; // uploads are sent as-is, everything else as JSON
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      // FormData (a receipt photo with its fields) sets its own multipart content type.
      // X-Buffet tells the server the call comes from this app's own page (protection against cross-site forms).
      headers: {
        'X-Buffet': '1',
        ...(body && !(body instanceof FormData) ? { 'Content-Type': isFile ? 'application/octet-stream' : 'application/json' } : {}),
      },
      body: body ? (isFile || body instanceof FormData ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    throw new Error('ارتباط با سرور برقرار نشد. اتصال شبکه را بررسی کنید.');
  }
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    state.me = { ...state.me, loggedIn: false, role: null };
    location.hash = '#/login';
    throw new Error('نشست شما تمام شده؛ دوباره وارد شوید.');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 429) throw new Error(data?.error || 'تعداد تلاش‌ها زیاد بود؛ چند دقیقه بعد دوباره امتحان کنید.');
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
/** Same as balanceBadge without the amount, for next to a big number that already shows it. */
function balanceState(b) {
  if (b > 0) return '<span class="badge debt lg">بدهکار</span>';
  if (b < 0) return '<span class="badge credit lg">بستانکار</span>';
  return '<span class="badge zero lg">تسویه</span>';
}

/** Menu item with a stepper: "+" first (inline start), then the count, then "−". */
const itemTileHtml = (i) => `
  <div class="item-tile" data-item="${i.id}">
    <div class="name">${esc(i.name)}</div>
    <div class="price">${priceHtml(i.price)}</div>
    <div class="stepper">
      <button type="button" class="plus" data-step="1" aria-label="اضافه کردن">${ic('plus')}</button>
      <span class="qty">۰</span>
      <button type="button" data-step="-1" aria-label="کم کردن">${ic('minus')}</button>
    </div>
  </div>`;

/** Sticky cart bar under a menu: count and total, "empty the cart", and the main action. */
const orderBarHtml = (submitText) => `
  <div class="order-bar">
    <div><div class="pending-count" id="cnt"></div><div class="total" id="tot"></div></div>
    <div class="order-actions">
      <button type="button" class="icon-btn" id="clear-cart" hidden title="خالی کردن سبد" aria-label="خالی کردن سبد">${ic('cart-x')}</button>
      <button class="btn large" id="submit">${submitText}</button>
    </div>
  </div>`;

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
  const title = (isOrder ? `<span class="qty-badge">${fa(e.quantity)}</span>${esc(e.itemName)}` : 'پرداخت') + settledBadge;
  const sub = metaHtml([
    showPerson ? `<b>${esc(e.personName)}</b>` : null,
    fmtDT(e.createdAt),
    isOrder && e.quantity > 1 ? `هر عدد ${fa(e.unitPrice)}` : null,
    !isOrder && e.cardTitle ? `${ic('card', 'sm')} ${esc(e.cardTitle)}` : null,
    !isOrder && e.receiptId ? `<button type="button" class="link-btn" data-receipt="${e.receiptId}" data-title="فیش پرداخت ${fa(e.amount)} تومان">${ic('image', 'sm')}مشاهده فیش</button>` : null,
    e.note ? esc(e.note) : null,
    `ثبت: ${esc(e.createdBy)}`,
    e.enteredAt ? `<span class="late">ثبت بعدی در ${fmtDT(e.enteredAt)}</span>` : null,
  ]);
  const amount = isOrder ? money(e.total) : `<span class="pay">${money(e.amount)}</span>`;
  const voidBtn = canVoid && !voided
    ? `<button class="btn link danger small" data-void="${e.kind}:${e.id}" title="ابطال این ثبت">ابطال</button>` : '';
  return `<div class="list-row ${voided ? 'voided' : ''}">
    <div class="icon${isOrder ? '' : ' pay'}">${ic(isOrder ? 'receipt' : 'banknote')}</div>
    <div class="grow"><div class="title">${title}</div>${sub}${voidNoteHtml(e)}</div>
    <div class="amount">${amount}</div>${voidBtn}</div>`;
}

const voidNoteHtml = (e) => (e.voidedAt
  ? `<div class="void-note">${ic('alert', 'sm')}<span>ابطال شد: ${esc(e.voidReason)} (${esc(e.voidedBy)}، ${fmtDT(e.voidedAt)})</span></div>` : '');

function settlementHtml(e, { showPerson, canVoid }) {
  const voided = !!e.voidedAt;
  const cleared = e.clearedAmount > 0 ? `بدهی صفرشده ${fa(e.clearedAmount)} تومان`
    : e.clearedAmount < 0 ? `طلب صفرشده ${fa(-e.clearedAmount)} تومان` : 'مانده‌ای نداشت';
  const sub = metaHtml([
    showPerson ? `<b>${esc(e.personName)}</b>` : null,
    cleared,
    fmtDT(e.createdAt),
    e.note ? esc(e.note) : null,
    `ثبت: ${esc(e.createdBy)}`,
  ]);
  const voidBtn = canVoid && !voided
    ? `<button class="btn link danger small" data-void="settlement:${e.id}" title="ابطال این تسویه">ابطال</button>` : '';
  return `<div class="list-row settlement ${voided ? 'voided' : ''}">
    <div class="icon done">${ic('check-circle')}</div>
    <div class="grow"><div class="title">تسویه تا ${faDigits(e.untilLabel)}</div>${sub}${voidNoteHtml(e)}</div>
    ${voidBtn}</div>`;
}

const entriesHtml = (list, opts) =>
  list.length ? list.map((e) => entryHtml(e, opts)).join('') : emptyHtml('receipt', 'موردی ثبت نشده است.');

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
                  ${metaHtml([`${fa(p.qty)} قلم`, `مصرف ${fa(p.consumed)}`, `پرداخت ${fa(p.paid)}`, p.settledUntil ? `تسویه تا ${faDigits(p.settledUntil)}` : null])}
                </div>
                ${balanceBadge(p.balance)}
              </a>`).join('') : emptyHtml('users', 'هنوز شخصی تعریف نشده است. <a href="#/people">تعریف افراد</a>')}
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
            : emptyHtml('package', 'در این بازه چیزی مصرف نشده است.')}
        </div>
      </div>
    </div>`;
  bindSearch($('#q'), $('#people-list'));
}

async function viewPerson(id, alive) {
  // "#/me/pay" from older links and notifications: the receipt form now has its own page.
  if (isEmployee() && id === 'pay') { location.replace('#/pay'); return; }
  if (isEmployee()) id = state.me.personId;
  const [summary, entries, balance] = await Promise.all([
    api('/api/report/summary?' + rangeQuery(state.period)),
    api('/api/report/entries?' + rangeQuery(state.period, { personId: id })),
    api(`/api/report/balance?personId=${id}`),
  ]);
  if (!alive()) return;
  const list = mergeEntries(entries);
  const p = summary.people.find((x) => String(x.id) === String(id))
    ?? { name: list[0]?.personName ?? 'نامشخص', balance: 0, consumed: 0, paid: 0, qty: 0 };

  view.innerHTML = `
    ${isEmployee() ? `<div class="card account-card"><div class="sheet-user" style="padding:0;border:0">
        <span class="avatar">${ic('user')}</span>
        <div class="body"><b><bdi>${esc(state.me.personName)}</bdi></b><span class="muted text-sm">همکار</span></div>
        ${logoutButton('btn ghost small')}</div></div>` : ''}
    <div class="page-title"><h1>${esc(p.name)}</h1>${isAdmin() ? `<a class="btn ghost small" href="#/report">${ic('undo', 'flip')}بازگشت به گزارش</a>` : ''}</div>
    ${isEmployee() ? driveBannerHtml(balance) : ''}
    <div class="card">
      <div class="card-head">
        <div class="muted">مانده‌ی حساب ${p.settledUntil ? `(بعد از تسویه تا ${faDigits(p.settledUntil)})` : '(از ابتدا تا امروز)'}</div>
        ${isAdmin() && p.id ? `<a class="btn secondary small" href="#/payments/${p.id}">${ic('wallet')}پرداخت / تسویه</a>` : ''}
      </div>
      <div class="balance-line"><div class="balance-big">${money(Math.abs(p.balance))}</div>${balanceState(p.balance)}</div>
      ${balanceBreakdownHtml(balance, { copy: isEmployee() })}
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

/** Colleague's «ثبت فیش» page: where to pay (card numbers to copy), the receipt form, and earlier receipts. */
async function viewPay(_, alive) {
  const balance = await api('/api/report/balance');
  if (!alive()) return;
  view.innerHTML = `
    <div class="page-title"><h1>ثبت فیش</h1></div>
    ${driveBannerHtml(balance, { payLink: false })}
    ${balance.cards.length && balance.total > 0 ? `<div class="card">
      <div class="card-head"><h2>${ic('card')}کجا واریز کنم؟</h2><span class="badge debt">بدهی ${fa(balance.total)}</span></div>
      ${balanceBreakdownHtml(balance, { copy: true })}
    </div>` : ''}
    <div class="card" id="pay-claim"></div>`;
  await renderClaimForm($('#pay-claim'), balance, alive);
}

/** Manager's «بررسی فیش‌ها» page: receipts waiting for review, then the ones reviewed lately. */
async function viewClaims(_, alive) {
  const data = await api('/api/admin/payment-claims');
  if (!alive()) return;
  view.innerHTML = `
    <div class="page-title"><h1>بررسی فیش‌ها</h1></div>
    <div class="card claims-card" id="claims"></div>
    <div class="card">
      <div class="card-head"><h2>اخیراً بررسی‌شده</h2></div>
      <div class="list">${data.recent.length ? data.recent.map((c) => `
        <div class="list-row">
          <button type="button" class="receipt-thumb" data-receipt="${c.id}" data-title="فیش ${esc(c.personName)}، ${fa(c.amount)} تومان" aria-label="دیدن عکس فیش">
            <img src="${receiptUrl(c.id)}" alt="" loading="lazy" decoding="async"></button>
          <div class="grow">
            <div class="title">${esc(c.personName)}</div>
            ${metaHtml([money(c.amount), c.cardTitle ? `${ic('card', 'sm')} ${esc(c.cardTitle)}` : null, fmtDT(c.reviewedAt), c.reviewedBy ? esc(c.reviewedBy) : null])}
            ${c.rejectReason ? `<div class="void-note">${ic('alert', 'sm')}<span>دلیل: ${esc(c.rejectReason)}</span></div>` : ''}
          </div>
          ${claimBadge(c.status)}
        </div>`).join('') : emptyHtml('image', 'هنوز فیشی بررسی نشده است.')}</div>
    </div>`;
  state.refreshClaims = () => route();
  renderClaimsAdmin($('#claims'), () => route(), data.pending);
}

// ---------- payments reported by employees, with a receipt photo ----------
const CLAIM_STATUS = {
  pending: ['در انتظار بررسی', 'wait', 'timer'], approved: ['تأیید شد', 'credit', 'check-circle'],
  rejected: ['رد شد', 'debt', 'x-circle'], cancelled: ['لغو شد', 'off', 'x'],
};
const claimBadge = (s) => `<span class="badge ${CLAIM_STATUS[s][1]}">${ic(CLAIM_STATUS[s][2])}${CLAIM_STATUS[s][0]}</span>`;
const receiptUrl = (id) => `/api/receipts/${id}`;
const kb = (bytes) => `${fa(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
const MAX_RECEIPT_BYTES = 3 * 1024 * 1024;

/**
 * Shrinks a photo before upload: at most 1600px on the long side, JPEG at 80%. A phone photo of 4–8 MB becomes
 * about 150–350 KB, still sharp enough to read every digit of a receipt. Re-drawing also drops the photo's
 * metadata (location, device). Returns the original file if the browser can't decode it but it is small enough.
 */
async function compressImage(file, maxSide = 1600, quality = 0.8) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
    } catch {
      if (file.size <= MAX_RECEIPT_BYTES && /^image\/(jpeg|png|webp)$/.test(file.type)) return file;
      throw new Error('این عکس باز نشد؛ یک عکس JPG یا PNG از فیش انتخاب کنید.');
    } finally { URL.revokeObjectURL(url); }
  }
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; // transparent PNG screenshots get a white page instead of black
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('آماده‌سازی عکس ناموفق بود؛ دوباره امتحان کنید.');
  return blob;
}

/** Colleague's "I paid" card: receipt photo, card, amount (with one-tap "fill my debt"), note; then the history. */
async function renderClaimForm(card, balance, alive) {
  const cards = balance.cards ?? [];
  const debtOf = (cardId) => (cardId === '' ? balance.general : cards.find((c) => String(c.id) === cardId)?.balance ?? 0);
  // Pre-select the card that is owed the most.
  const owed = [...cards].filter((c) => c.balance > 0).sort((a, b) => b.balance - a.balance)[0];
  let photo = null;

  card.innerHTML = `
    <div class="card-head"><h2>${ic('image')}فیش جدید</h2><span id="claim-pending"></span></div>
    <p class="card-intro">بعد از واریز، عکس فیش را بفرستید. مسئول بوفه آن را بررسی می‌کند و با تأیید، از بدهی شما کم می‌شود.</p>
    <form class="form" id="claim-form" novalidate>
      <div class="field-label">۱. عکس فیش واریزی</div>
      <input type="file" id="receipt-input" accept="image/*" hidden>
      <button type="button" class="receipt-drop" id="receipt-pick">
        <span class="em-icon">${ic('image')}</span>
        <b>انتخاب عکس فیش</b>
        <span class="hint">از گالری یا با دوربین؛ قبل از ارسال کم‌حجم می‌شود</span>
      </button>
      <div class="receipt-preview" id="receipt-preview" hidden>
        <img id="receipt-thumb" alt="پیش‌نمایش فیش">
        <div class="grow"><b>فیش آماده است</b><div class="hint" id="receipt-size"></div></div>
        <button type="button" class="btn ghost small" id="receipt-change">تغییر عکس</button>
      </div>
      ${cards.length ? `<label>۲. به کدام کارت واریز کردید؟
        <select name="cardId" id="claim-card">
          ${cards.map((c) => `<option value="${c.id}" ${owed?.id === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}
          <option value="">سایر (بدون کارت)</option>
        </select></label>` : ''}
      <label>${cards.length ? '۳' : '۲'}. مبلغ واریزی (تومان)
        <input name="amount" id="claim-amount" inputmode="numeric" data-amount autocomplete="off" placeholder="مثلاً ۴۵۰۰۰"><span class="hint"></span>
      </label>
      <div class="chips tight wrap" id="claim-fill"></div>
      <label>توضیح (اختیاری)<input name="note" maxlength="200" placeholder="مثلاً شماره پیگیری یا ۴ رقم آخر کارت مبدأ"></label>
      <button class="btn large block" id="claim-submit" disabled>${ic('check')}ارسال برای بررسی</button>
    </form>
    <div id="claim-list" class="mt-3"></div>`;

  const form = $('#claim-form', card);
  const amount = $('#claim-amount', card);
  const cardSelect = $('#claim-card', card);
  const submit = $('#claim-submit', card);
  const ready = () => { submit.disabled = !photo || !(parseAmount(amount.value) > 0); };

  // "Fill my debt": the debt on the chosen card, and the whole debt when that is different.
  const renderFill = () => {
    const cardId = cardSelect?.value ?? '';
    const own = cards.length ? debtOf(cardId) : balance.total;
    const chips = [];
    if (own > 0) chips.push([own, cards.length ? `درج بدهی این کارت: ${fa(own)}` : `درج مبلغ بدهی: ${fa(own)}`]);
    if (cards.length && balance.total > 0 && balance.total !== own) chips.push([balance.total, `کل بدهی: ${fa(balance.total)}`]);
    if (balance.due > 0 && !chips.some(([n]) => n === balance.due)) chips.push([balance.due, `بدهی دوره‌ی تسویه: ${fa(balance.due)}`]);
    $('#claim-fill', card).innerHTML = chips.map(([n, label]) =>
      `<button type="button" class="chip" data-claim-fill="${n}">${ic('plus', 'sm')}${label}</button>`).join('');
  };
  renderFill();
  bindAmountHints(card);

  const pick = $('#receipt-pick', card);
  const input = $('#receipt-input', card);
  const showPhoto = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('فقط عکس قابل قبول است.', true); return; }
    pick.disabled = true;
    try {
      const blob = await compressImage(file);
      if (blob.size > MAX_RECEIPT_BYTES) throw new Error('حجم عکس بیشتر از ۳ مگابایت است؛ عکس دیگری انتخاب کنید.');
      photo = blob;
      const thumb = $('#receipt-thumb', card);
      if (thumb.src) URL.revokeObjectURL(thumb.src);
      thumb.src = URL.createObjectURL(blob);
      $('#receipt-size', card).textContent = kb(blob.size);
      pick.hidden = true;
      $('#receipt-preview', card).hidden = false;
      if (!amount.value) amount.focus();
    } catch (err) { toast(err.message, true); }
    finally { pick.disabled = false; ready(); }
  };
  input.onchange = () => { showPhoto(input.files[0]); input.value = ''; };
  card.onclick = async (e) => {
    if (e.target.closest('#receipt-pick, #receipt-change')) return input.click();
    const fill = e.target.closest('[data-claim-fill]');
    if (fill) { amount.value = faDigits(fill.dataset.claimFill); amount.dispatchEvent(new Event('input')); return ready(); }
    const cancel = e.target.closest('[data-claim-cancel]');
    if (cancel) {
      if (!await askConfirm({ title: 'این پرداخت از صف بررسی برداشته شود؟', text: 'عکس فیش هم حذف می‌شود.', okText: 'لغو پرداخت' })) return;
      try { await api(`/api/payment-claims/${cancel.dataset.claimCancel}/cancel`, { method: 'POST' }); toast('پرداخت لغو شد.'); renderList(); }
      catch (err) { toast(err.message, true); }
    }
  };
  // Dropping a photo onto the box works on desktop too.
  pick.ondragover = (e) => { e.preventDefault(); pick.classList.add('over'); };
  pick.ondragleave = () => pick.classList.remove('over');
  pick.ondrop = (e) => { e.preventDefault(); pick.classList.remove('over'); showPhoto(e.dataTransfer.files[0]); };
  cardSelect?.addEventListener('change', renderFill);
  amount.addEventListener('input', ready);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const n = parseAmount(fd.get('amount'));
    if (!photo) return toast('عکس فیش واریزی را پیوست کنید.', true);
    if (!(n > 0)) return toast('مبلغ واریزی را وارد کنید.', true);
    const body = new FormData();
    body.append('receipt', photo, 'receipt.jpg');
    body.append('amount', String(n));
    if (fd.get('cardId')) body.append('cardId', fd.get('cardId'));
    if (fd.get('note')) body.append('note', fd.get('note'));
    submit.disabled = true;
    try {
      await api('/api/payment-claims', { method: 'POST', body });
      toast('فیش فرستاده شد؛ بعد از بررسی مسئول بوفه از بدهی‌تان کم می‌شود.');
      photo = null;
      form.reset();
      amount.dispatchEvent(new Event('input'));
      $('#receipt-preview', card).hidden = true;
      pick.hidden = false;
      renderFill();
      await renderList();
    } catch (err) { toast(err.message, true); }
    ready();
  });

  async function renderList() {
    const claims = await api('/api/payment-claims');
    if (!alive()) return;
    const pending = claims.filter((c) => c.status === 'pending');
    $('#claim-pending', card).innerHTML = pending.length
      ? `<span class="badge wait">${ic('timer')}${fa(pending.length)} در انتظار بررسی</span>` : '';
    $('#claim-list', card).innerHTML = claims.length ? `
      <div class="section-label">پرداخت‌های ارسالی</div>
      <div class="list">${claims.map((c) => `
        <div class="list-row">
          ${c.status === 'cancelled' ? `<div class="icon">${ic('image')}</div>`
            : `<button type="button" class="receipt-thumb" data-receipt="${c.id}" data-title="فیش ${fa(c.amount)} تومان" aria-label="دیدن عکس فیش">
                 <img src="${receiptUrl(c.id)}" alt="" loading="lazy" decoding="async"></button>`}
          <div class="grow">
            <div class="title">${money(c.amount)}</div>
            ${metaHtml([fmtDT(c.createdAt), c.cardTitle ? `${ic('card', 'sm')} ${esc(c.cardTitle)}` : null, c.note ? esc(c.note) : null])}
            ${c.rejectReason ? `<div class="void-note">${ic('alert', 'sm')}<span>دلیل: ${esc(c.rejectReason)}</span></div>` : ''}
          </div>
          <div class="actions">${claimBadge(c.status)}
            ${c.status === 'pending' ? `<button type="button" class="icon-btn small danger" data-claim-cancel="${c.id}" title="لغو" aria-label="لغو این پرداخت">${ic('trash')}</button>` : ''}
          </div>
        </div>`).join('')}</div>` : '';
  }
  await renderList();
}

/** Review queue: look at the receipt, then approve (records the payment) or reject with a reason. */
function renderClaimsAdmin(card, onChange, pending) {
  state.pendingClaims = pending.length;
  setTabBadge('claims', pending.length);
  if (!pending.length) {
    card.innerHTML = `<div class="card-head"><h2>${ic('image')}در انتظار بررسی</h2></div>
      ${emptyHtml('check-circle', 'فیشی در انتظار بررسی نیست. فیش‌هایی که همکاران از صفحه‌ی «ثبت فیش» می‌فرستند اینجا می‌آیند.')}`;
    return;
  }
  card.innerHTML = `
    <div class="card-head"><h2>${ic('image')}در انتظار بررسی</h2><span class="badge wait">${fa(pending.length)}</span></div>
    <p class="card-intro">روی عکس بزنید تا بزرگ شود. با «تأیید» پرداخت ثبت و از بدهی همکار کم می‌شود.</p>
    <div class="claims">${pending.map((c) => `
      <article class="claim" data-claim="${c.id}">
        <button type="button" class="claim-photo" data-receipt="${c.id}" data-title="فیش ${esc(c.personName)}، ${fa(c.amount)} تومان" aria-label="بزرگ کردن عکس فیش">
          <img src="${receiptUrl(c.id)}" alt="فیش ${esc(c.personName)}" loading="lazy" decoding="async">
        </button>
        <div class="claim-body">
          <div class="claim-who">${esc(c.personName)}</div>
          <div class="claim-amount">${money(c.amount)}</div>
          ${metaHtml([fmtDT(c.createdAt), c.cardTitle ? `${ic('card', 'sm')} ${esc(c.cardTitle)}` : 'بدون کارت'])}
          ${c.note ? `<div><span class="req-note">${ic('note')}${esc(c.note)}</span></div>` : ''}
          ${c.lookalikeId ? `<div><span class="badge warn">${ic('alert', 'sm')}فیش دیگری با همین مبلغ از همین همکار در همین هفته هست؛ تکراری نباشد</span></div>` : ''}
        </div>
        <div class="claim-actions">
          <button type="button" class="btn" data-claim-approve="${c.id}">${ic('check')}تأیید و ثبت پرداخت</button>
          <button type="button" class="btn link danger" data-claim-reject="${c.id}">${ic('x-circle')}رد</button>
        </div>
      </article>`).join('')}
    </div>`;
  card.onclick = async (e) => {
    const approve = e.target.closest('[data-claim-approve]');
    const reject = e.target.closest('[data-claim-reject]');
    if (!approve && !reject) return;
    const btn = approve ?? reject;
    try {
      if (approve) {
        btn.disabled = true;
        const res = await api(`/api/admin/payment-claims/${approve.dataset.claimApprove}/approve`, { method: 'POST' });
        toast(`پرداخت ${res.personName} ثبت شد: ${fa(res.amount)} تومان`);
      } else {
        const reason = await askText({
          title: 'رد فیش پرداخت', text: 'دلیل را بنویسید تا همکار ببیند و دوباره بفرستد.',
          placeholder: 'مثلاً مبلغ فیش با مبلغ واردشده یکی نیست', okText: 'رد فیش',
        });
        if (!reason) return;
        await api(`/api/admin/payment-claims/${reject.dataset.claimReject}/reject`, { method: 'POST', body: { reason } });
        toast('فیش رد شد و به همکار خبر داده شد.');
      }
      onChange();
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
}

// Full-size receipt in a dialog; works for the manager (any) and an employee (their own).
document.addEventListener('click', (e) => {
  const open = e.target.closest('[data-receipt]');
  if (!open) return;
  const dlg = $('#viewer');
  $('#viewer-title').textContent = open.dataset.title || 'عکس فیش';
  $('#viewer-img').src = receiptUrl(open.dataset.receipt);
  $('#viewer-open').href = receiptUrl(open.dataset.receipt);
  dlg.showModal();
});
$('#viewer-close')?.addEventListener('click', () => $('#viewer').close());
$('#viewer')?.addEventListener('click', (e) => { if (e.target.id === 'viewer') e.target.close(); });

async function viewLogin(mode) {
  if (state.me.loggedIn) { location.hash = homeHash(); return; }
  const setup = state.me.needsSetup;
  if (mode !== 'admin' && !setup) {
    view.innerHTML = `
      <div class="card login-card">
        <h1>ورود</h1>
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
      <h1>${setup ? 'ساخت حساب مسئول' : 'ورود مسئول'}</h1>
      <p class="muted">${setup ? 'اولین اجراست؛ یک حساب برای مسئول بوفه بسازید.' : 'برای ثبت سفارش، مدیریت و دیدن گزارش همه وارد شوید.'}</p>
      <form class="form" id="f">
        <label>نام کاربری<input name="username" autocomplete="username" required autofocus dir="auto"></label>
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
  const [items, people, allCategories] = await Promise.all([api('/api/admin/items'), api('/api/admin/people'), api('/api/admin/categories')]);
  if (!alive()) return;
  const activeItems = items.filter((i) => i.isActive);
  const activePeople = people.filter((p) => p.isActive).sort(byName);
  const cart = new Map();
  let person = null;
  // The day the orders belong to; kept while switching people so a whole paper list can be entered for one day.
  let day = parseJalali(jalaliLabel());
  const isToday = () => day.label === jalaliLabel();

  if (!activePeople.length || !activeItems.length) {
    view.innerHTML = `<div class="card">${emptyHtml(!activePeople.length ? 'users' : 'package', `
      ${!activePeople.length ? 'هنوز شخصی تعریف نشده. <a href="#/people">تعریف افراد</a><br>' : ''}
      ${!activeItems.length ? 'هنوز کالایی تعریف نشده. <a href="#/items">تعریف کالاها</a>' : ''}`)}</div>`;
    return;
  }

  // Menu sections the selected person may order from: categories for everyone or for their staff group,
  // then items without a category. Opening hours are shown but not enforced here (paper lists, late entry).
  const sectionsFor = (p) => [
    ...allCategories.filter((c) => !c.personGroupId || c.personGroupId === p.groupId)
      .map((c) => ({ c, list: activeItems.filter((i) => i.categoryId === c.id) })),
    { c: { name: 'سایر' }, list: activeItems.filter((i) => i.categoryId == null) },
  ].filter((s) => s.list.length);
  view.innerHTML = `
    <div class="order-layout" id="layout">
      <section class="people-pane">
        <div class="card order-date" id="date-card">
          <label>تاریخ سفارش (شمسی)
            <input id="day" inputmode="numeric" placeholder="۱۴۰۵/۰۸/۰۵" autocomplete="off" value="${faDigits(day.label)}">
          </label>
          <div class="chips tight">
            <button type="button" class="chip" data-day="${jalaliLabel()}">امروز</button>
            <button type="button" class="chip" data-day="${jalaliLabel(-1)}">دیروز</button>
            <button type="button" class="chip" data-day="${jalaliLabel(-2)}">پریروز</button>
          </div>
          <div class="hint" id="day-hint"></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>برای چه کسی؟</h2></div>
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
      ipane.innerHTML = `<div class="card empty-pane">${emptyHtml('user', 'از لیست، شخص را انتخاب کنید.')}</div>`;
      return;
    }
    ipane.innerHTML = `
      <div class="card">
        <div class="order-head">
          <div><small>سفارش برای</small><div class="who">${esc(person.name)}</div>
            <small class="${isToday() ? '' : 'past-day'}">${isToday() ? 'امروز' : 'تاریخ'} ${faDigits(day.label)}</small></div>
          <button type="button" class="btn ghost small back-btn" id="change">${ic('undo', 'flip')}تغییر شخص</button>
        </div>
        ${sectionsFor(person).map(({ c, list }) => `
          <div class="cat-title">${esc(c.name)} ${c.id ? categoryRulesHtml(c) : ''}</div>
          <div class="items-grid">${list.map(itemTileHtml).join('')}</div>`).join('')}
        <label class="note-field">توضیح (اختیاری)<input id="note" maxlength="200" placeholder="مثلاً بدون شکر"></label>
        ${orderBarHtml('ثبت سفارش')}
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
  const [people, summary, entries, cards, drive, waiting] = await Promise.all([
    api('/api/admin/people'), api('/api/report/summary'), api('/api/report/entries'), api('/api/admin/cards'), api('/api/report/drive'),
    api('/api/admin/requests/pending'),
  ]);
  if (!alive()) return;
  const info = new Map(summary.people.map((p) => [p.id, p]));
  const history = mergeEntries({ orders: [], payments: entries.payments, settlements: entries.settlements });
  // Active people, plus inactive ones who still have an open balance; debtors first is less useful than a
  // stable alphabetical list here, the badge shows who owes.
  const choosable = people.filter((p) => p.isActive || (info.get(p.id)?.balance ?? 0) !== 0).sort(byName);
  let selected = null;
  const lastMonthEnd = lastMonthEndLabel();

  view.innerHTML = `
    <div class="page-title"><h1>پرداخت و تسویه</h1></div>
    <div class="drive-card" id="drive"></div>
    ${waiting.claims ? `<div class="banner">${ic('image')}
      <div class="b-title">${fa(waiting.claims)} فیش پرداخت در انتظار بررسی است</div>
      <div class="b-actions"><a class="btn small" href="#/claims">بررسی فیش‌ها</a></div>
    </div>` : ''}
    <div class="card">
      <div class="card-head"><h2>برای چه کسی؟</h2></div>
      <input class="search" id="pq" placeholder="جستجوی نام…" autocomplete="off">
      <div class="pick-list" id="pgrid">
        ${choosable.map((p) => `<button type="button" class="pick-row" data-pick="${p.id}" data-name="${esc(p.name)}">
            <span>${esc(p.name)}${p.isActive ? '' : ' <small>(غیرفعال)</small>'}</span>
            ${balanceBadge(info.get(p.id)?.balance ?? 0)}
          </button>`).join('')}
      </div>
    </div>
    <div class="cols">
      <div>
        <div class="card" id="who">
          <div class="muted">از بالا یک نفر را انتخاب کنید؛ مانده‌ی حساب او به تفکیک کارت اینجا نمایش داده می‌شود.</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>ثبت پرداخت</h2></div>
          <form class="form" id="pay">
            <label>مبلغ (تومان)<input name="amount" id="amount" inputmode="numeric" data-amount required autocomplete="off"><span class="hint"></span></label>
            ${cards.length ? `<label>به کدام کارت؟
              <select name="cardId" id="pay-card">
                <option value="">کلی (بدون کارت)</option>
                ${cards.map((c) => `<option value="${c.id}">${esc(c.title)}</option>`).join('')}
              </select></label>` : ''}
            <label>توضیح (اختیاری)<input name="note" maxlength="200" placeholder="مثلاً کارت‌به‌کارت"></label>
            <button class="btn">ثبت پرداخت</button>
          </form>
        </div>
        <div class="card">
          <div class="card-head"><h2>تسویه تا تاریخ</h2></div>
          <p class="card-intro">همه‌ی سفارش‌ها و پرداخت‌های این شخص تا پایان تاریخ انتخابی بسته می‌شود و مانده‌ی آن دوره صفر می‌شود، فارغ از اینکه چقدر پرداخت کرده است.</p>
          <form class="form" id="settle">
            <label>تا تاریخ (شمسی)
              <input name="until" id="until" inputmode="numeric" placeholder="۱۴۰۵/۰۸/۰۵" required autocomplete="off" value="${faDigits(jalaliLabel())}">
            </label>
            <div class="chips tight">
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

  const untilInput = $('#until');
  const personId = () => selected;
  const reopen = () => {
    const hash = `#/payments/${personId() ?? ''}`;
    if (location.hash === hash) route(); else location.hash = hash;
  };
  bindSearch($('#pq'), $('#pgrid'));
  renderDrive($('#drive'), drive, (id) => pick(id));

  let balanceSeq = 0;
  const renderPerson = async () => {
    const id = personId();
    const p = info.get(id);
    const person = people.find((x) => x.id === id);
    view.querySelectorAll('[data-pick]').forEach((b) => b.classList.toggle('current', Number(b.dataset.pick) === id));
    const list = id ? history.filter((e) => e.personId === id) : history;
    $('#history-title').textContent = id ? `پرداخت‌ها و تسویه‌های ${person?.name ?? ''}` : 'آخرین پرداخت‌ها و تسویه‌ها';
    $('#history').innerHTML = entriesHtml(list, { showPerson: !id, canVoid: true });
    updatePreview();
    if (!id) return;
    const seq = ++balanceSeq;
    $('#who').innerHTML = `<div class="who-head"><div class="who">${esc(person?.name ?? '')}</div>${balanceBadge(p?.balance ?? 0)}</div>`;
    const b = await api(`/api/report/balance?personId=${id}`);
    if (seq !== balanceSeq || !alive()) return;
    $('#who').innerHTML = `
      <div class="who-head"><div class="who">${esc(person?.name ?? '')}</div>${balanceBadge(b.total)}</div>
      ${p?.settledUntil ? `<div class="muted text-sm">آخرین تسویه تا ${faDigits(p.settledUntil)}</div>` : ''}
      ${balanceBreakdownHtml(b, { payButtons: true })}
      ${b.total > 0 ? `<div class="row-end mt-3"><button type="button" class="btn secondary small" data-fill="all:${b.total}">${ic('banknote')}پرداخت کل بدهی (${fa(b.total)} تومان)</button></div>` : ''}`;
  };
  // One tap selects; the page scrolls to the payment form on phones.
  const pick = (id) => {
    selected = id;
    renderPerson();
    if (!isWide()) $('#who').scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  untilInput.addEventListener('input', updatePreview);
  view.addEventListener('click', (e) => {
    const person = e.target.closest('[data-pick]');
    if (person) return pick(Number(person.dataset.pick));
    const chip = e.target.closest('[data-until]');
    if (chip) { untilInput.value = faDigits(chip.dataset.until); updatePreview(); return; }
    // "Pay this card's debt" / "pay everything": fills the form, the manager still confirms with the button.
    const fill = e.target.closest('[data-fill]');
    if (fill) {
      const [card, amount] = fill.dataset.fill.split(':');
      $('#amount').value = amount;
      $('#amount').dispatchEvent(new Event('input'));
      if ($('#pay-card')) $('#pay-card').value = card === 'all' || card === 'general' ? '' : card;
      $('#amount').focus();
    }
  });
  bindAmountHints(view);

  onSubmit($('#pay'), async (fd) => {
    if (!personId()) throw new Error('ابتدا شخص را انتخاب کنید.');
    const amount = parseAmount(fd.get('amount'));
    if (!(amount > 0)) throw new Error('مبلغ معتبر وارد کنید.');
    const paymentCardId = fd.get('cardId') ? Number(fd.get('cardId')) : null;
    await api('/api/admin/payments', { method: 'POST', body: { personId: personId(), amount, note: fd.get('note'), paymentCardId } });
    toast('پرداخت ثبت شد.');
    reopen();
  });

  onSubmit($('#settle'), async (fd) => {
    const j = parseJalali(fd.get('until'));
    if (!personId() || !j) throw new Error('شخص و تاریخ را درست وارد کنید.');
    const name = people.find((x) => x.id === personId())?.name ?? '';
    if (!await askConfirm({
      title: `حساب «${name}» تا پایان ${faDigits(j.label)} تسویه شود؟`,
      text: 'مانده‌ی این دوره صفر می‌شود. در صورت اشتباه می‌توانید تسویه را ابطال کنید.',
      okText: 'ثبت تسویه', danger: false,
    })) return;
    const cutoff = new Date(j.date);
    cutoff.setDate(cutoff.getDate() + 1);
    await api('/api/admin/settlements', {
      method: 'POST', body: { personId: personId(), until: cutoff.toISOString(), untilLabel: j.label, note: fd.get('note') },
    });
    toast(`حساب ${name} تا ${faDigits(j.label)} تسویه شد.`);
    reopen();
  });

  if (people.some((p) => String(p.id) === preselectId)) selected = Number(preselectId);
  renderPerson();
}

// ---------- balances by card, settlement drive ----------
/**
 * A balance split by bank card ({ total, cards: [{id, title, number, balance}], general }).
 * With `copy`, card numbers can be tapped to copy (colleague's page); with `payButtons`, each owed part gets a
 * button that fills the payment form (manager's page).
 */
function balanceBreakdownHtml(b, { copy = false, payButtons = false } = {}) {
  if (!b.cards.length) return '';
  const amount = (n) => (n > 0 ? `<span class="badge debt">بدهی ${fa(n)}</span>` : n < 0 ? `<span class="badge credit">طلب ${fa(-n)}</span>` : '<span class="badge zero">بدون بدهی</span>');
  const fill = (key, n) => (payButtons && n > 0 ? `<button type="button" class="btn secondary small" data-fill="${key}:${n}">پرداخت</button>` : '');
  // Row 1: card title, what is owed on it, and "copy" or "pay". Row 2: the number alone, full width, one line.
  return `
    <div class="pay-cards">
      ${copy ? '<div class="lead">بدهی به تفکیک کارت؛ برای پرداخت روی کارت بزنید تا شماره‌اش کپی شود:</div>' : ''}
      ${b.cards.map((c) => (copy
        ? `<button type="button" class="pay-card" data-copy="${esc(c.number)}" title="کپی شماره کارت">
             <span class="t">${ic('card', 'sm')}${esc(c.title)}${amount(c.balance)}</span><span class="c">${ic('copy', 'sm')}کپی</span>
             <span class="n">${cardNumberText(c.number)}</span>
           </button>`
        : `<div class="pay-card">
             <span class="t">${ic('card', 'sm')}${esc(c.title)}${amount(c.balance)}</span><span class="end">${fill(c.id, c.balance)}</span>
             <span class="n">${cardNumberText(c.number)}</span>
           </div>`)).join('')}
      ${b.general !== 0 ? `
        <div class="pay-card">
          <span class="t">سایر (بدون کارت)${amount(b.general)}</span><span class="end">${fill('general', b.general)}</span>
          <span class="n text">اقلامی که دسته‌شان کارت ندارد</span>
        </div>` : ''}
    </div>`;
}

/** Manager's "settlement drive" card on the payments page: start (up to a date) / end, and who still owes. */
async function renderDrive(card, drive, onPick) {
  if (!drive.active) {
    card.className = 'drive-card banner';
    card.innerHTML = `${ic('megaphone')}
      <div class="b-title">تسویه حساب همگانی</div>
      <div class="b-body muted">خریدهای تا پایان تاریخ انتخابی باید پرداخت شوند. فقط به بدهکارهای این بازه اعلان می‌رود و تا پرداخت نکنند درخواست ثبت نمی‌کنند (حتی اقلام رایگان). خریدهای بعد از این تاریخ کسی را متوقف نمی‌کند.</div>
      <form class="b-actions drive-form" id="drive-form">
        <label class="drive-until">تا تاریخ
          <input name="until" inputmode="numeric" placeholder="۱۴۰۵/۰۸/۰۵" required autocomplete="off" value="${faDigits(jalaliLabel())}">
        </label>
        <button type="button" class="chip" data-drive-until="${jalaliLabel()}">امروز</button>
        <button type="button" class="chip" data-drive-until="${jalaliLabel(-1)}">دیروز</button>
        <button type="button" class="chip" data-drive-until="${lastMonthEndLabel()}">پایان ماه قبل</button>
        <button type="submit" class="btn small push-end">شروع تسویه</button>
      </form>`;
  } else {
    const debtors = await api('/api/admin/drive/debtors');
    card.className = 'drive-card banner warn';
    card.innerHTML = `${ic('megaphone')}
      <div class="b-title">تسویه‌ی خریدهای ${drive.untilLabel ? `تا ${faDigits(drive.untilLabel)}` : 'قبل از شروع تسویه'} در جریان است</div>
      <div class="b-body">${metaHtml([`از ${fmtDT(drive.startedAt)}`, drive.startedBy ? `توسط ${esc(drive.startedBy)}` : null], '')}
        ${debtors.length ? `${fa(debtors.length)} نفر بابت این بازه هنوز بدهکارند؛ تا پرداخت نکنند درخواست ثبت نمی‌کنند.` : ''}</div>
      <div class="b-actions">
        ${debtors.length ? debtors.map((d) => `
          <button type="button" class="chip" data-debtor="${d.personId}">${esc(d.name)} <b>${fa(d.balance)}</b></button>`).join('')
          : `<span class="badge credit lg">${ic('check-circle')}همه تسویه کرده‌اند</span>`}
        <button type="button" class="btn danger small push-end" id="drive-end">پایان تسویه</button>
      </div>`;
  }
  card.onclick = async (e) => {
    const debtor = e.target.closest('[data-debtor]');
    if (debtor) return onPick(Number(debtor.dataset.debtor));
    const chip = e.target.closest('[data-drive-until]');
    if (chip) { card.querySelector('[name=until]').value = faDigits(chip.dataset.driveUntil); return; }
    if (!e.target.closest('#drive-end')) return;
    if (!await askConfirm({ title: 'تسویه‌ی همگانی تمام شود؟', text: 'ثبت درخواست برای همه آزاد می‌شود. اعلانی برای کسی نمی‌رود.', okText: 'پایان تسویه' })) return;
    try {
      const next = await api('/api/admin/drive/end', { method: 'POST' });
      toast('تسویه تمام شد.');
      renderDrive(card, next.drive, onPick);
    } catch (err) { toast(err.message, true); }
  };
  const form = card.querySelector('#drive-form');
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const j = parseJalali(form.elements.until.value);
    if (!j) return toast('تاریخ را درست وارد کنید (مثل ۱۴۰۵/۰۸/۲۳).', true);
    if (j.label > jalaliLabel()) return toast('تاریخ تسویه نمی‌تواند در آینده باشد.', true);
    if (!await askConfirm({
      title: `تسویه‌ی خریدهای تا پایان ${faDigits(j.label)} شروع شود؟`,
      text: 'فقط به کسانی که بابت این بازه بدهکارند اعلان می‌رود و تا پرداخت، درخواست ثبت نمی‌کنند.',
      okText: 'شروع تسویه', danger: false,
    })) return;
    try {
      const next = await api('/api/admin/drive/start', { method: 'POST', body: { until: endOfJalaliDay(j), untilLabel: j.label } });
      toast(next.notified ? `تسویه شروع شد؛ برای ${fa(next.notified)} بدهکار اعلان رفت.` : 'تسویه شروع شد؛ در این بازه کسی بدهکار نیست.');
      renderDrive(card, next.drive, onPick);
    } catch (err) { toast(err.message, true); }
  };
}

/** Colleague-facing banner while a settlement drive is on. */
const driveBannerHtml = (b, { payLink = true } = {}) => (b.drive?.active ? `
  <div class="banner ${b.due > 0 ? 'danger' : 'warn'}">
    ${ic('megaphone')}
    <div class="b-title">درخواست تسویه حساب</div>
    <div class="b-body">مسئول بوفه درخواست تسویه‌ی خریدهای ${b.drive.untilLabel ? `تا ${faDigits(b.drive.untilLabel)}` : 'قبل از شروع تسویه'} را ارسال کرده است. ${b.due > 0
      ? `بابت این بازه <b>${fa(b.due)} تومان</b> بدهکارید؛ با احترام، تا پرداخت نکنید سفارش جدید پذیرفته نمی‌شود.`
      : 'بدهی این بازه را پرداخت کرده‌اید؛ ممنون.'}</div>
    ${b.due > 0 && payLink ? `<div class="b-actions"><a class="btn small" href="#/pay">${ic('image')}ثبت فیش پرداخت</a></div>` : ''}
  </div>` : '');

// ---------- Excel import (items and people) ----------
const IMPORT_KINDS = {
  items: {
    title: 'ورود کالاها از اکسل',
    help: 'کالایی که همین عنوان را دارد تکراری ثبت نمی‌شود؛ مبلغ (و دسته، اگر ستونش را انتخاب کنید) به‌روز می‌شود. مبلغ ۰ یا خالی یعنی رایگان. دسته‌ای که هنوز وجود ندارد ساخته می‌شود.',
    fields: [
      { key: 'name', label: 'ستون عنوان کالا', required: true, guess: /^(?!.*(دسته|گروه)).*(عنوان|نام|کالا|شرح|name|item)/i },
      { key: 'price', label: 'ستون مبلغ (تومان)', required: true, guess: /مبلغ|قیمت|بها|price/i },
      { key: 'category', label: 'ستون دسته (اختیاری)', guess: /دسته|گروه|category/i },
    ],
  },
  people: {
    title: 'ورود افراد از اکسل',
    help: 'شخصی که همین نام را دارد تکراری ثبت نمی‌شود؛ اگر کد ملی‌اش خالی بود اضافه می‌شود. کد ملی نامعتبر یا تکراری در لیست مشکل‌دار نشان داده می‌شود و ثبت نمی‌شود. گروهی که هنوز وجود ندارد ساخته می‌شود.',
    fields: [
      { key: 'name', label: 'ستون نام و نام خانوادگی', required: true, guess: /^(?!.*(کد|گروه|شیفت)).*(نام|عنوان|name)/i },
      { key: 'nationalCode', label: 'ستون کد ملی', required: true, guess: /کد|ملی|national|code/i },
      { key: 'group', label: 'ستون گروه پرسنلی (اختیاری)', guess: /گروه|شیفت|واحد|group/i },
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
    <p class="card-intro">فایل Excel (.xlsx) یا CSV را انتخاب کنید و بگویید هر ستون چیست. ${cfg.help}</p>
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
    out.innerHTML = '<div class="muted import-status">در حال بررسی…</div>';
    try {
      const res = await api(`/api/admin/import/${kind}`, { method: 'POST', body: { rows: dataRows(), apply: false } });
      if (my !== seq) return;
      preview = res;
      renderResult(res);
    } catch (err) {
      if (my === seq) out.innerHTML = `<div class="void-note import-status">${esc(err.message)}</div>`;
    }
  }

  const rowHtml = (r) => `<div class="import-row ${r.status}">
      <div class="num">ردیف ${fa(r.row)}</div>
      <div><b>${esc(r.name) || '—'}</b>${r.value ? `، ${esc(faDigits(r.value))}` : ''}</div>
      <div class="msg">${r.message ? esc(faDigits(r.message)) : IMPORT_STATUS[r.status][0]}</div></div>`;

  const renderResult = (res, done = false) => {
    const c = res.counts;
    const toApply = res.changes;
    const problems = res.rows.filter((r) => r.status === 'error' || r.status === 'warn');
    const rest = res.rows.filter((r) => r.status !== 'error' && r.status !== 'warn');
    $('#imp-result', container).innerHTML = `
      ${done ? `<div class="banner import-status">${ic('check-circle')}<div class="b-title">ثبت انجام شد.</div><div class="b-body">لیست پایین صفحه بعد از «بستن» به‌روز می‌شود.</div></div>` : ''}
      <div class="import-counts">
        ${Object.entries(IMPORT_STATUS).filter(([k]) => c[k]).map(([k, [label, cls]]) => `<span class="badge ${cls}">${label}: ${fa(c[k])}</span>`).join('')}
        ${res.rows.length ? '' : '<span class="muted">ردیفی برای ورود پیدا نشد؛ ستون‌ها را بررسی کنید.</span>'}
      </div>
      ${problems.length ? `<div class="import-list"><h3>ردیف‌هایی که باید بررسی شوند (${fa(problems.length)})</h3>
        ${problems.map(rowHtml).join('')}
        ${c.error ? '<p class="hint">ردیف‌های مشکل‌دار ثبت نمی‌شوند؛ در فایل درست کنید و دوباره وارد کنید (ردیف‌های ثبت‌شده تکرار نمی‌شوند).</p>' : ''}</div>` : ''}
      ${rest.length ? `<details class="import-list" ${problems.length ? '' : 'open'}><summary>بقیه‌ی ردیف‌ها (${fa(rest.length)})</summary>${rest.map(rowHtml).join('')}</details>` : ''}
      <div class="row-end import-status">
        ${done ? '<button type="button" class="btn" data-imp="close">بستن</button>'
          : `<button type="button" class="btn" data-imp="apply" ${toApply ? '' : 'disabled'}>${toApply ? `ثبت ${fa(toApply)} ردیف` : 'تغییری برای ثبت نیست'}</button>`}
      </div>`;
  };
  let applied = false;

  container.onchange = async (e) => {
    if (e.target.id === 'imp-file') {
      const file = e.target.files[0];
      if (!file) return;
      $('#imp-map', container).innerHTML = '<div class="muted import-status">در حال خواندن فایل…</div>';
      $('#imp-result', container).innerHTML = '';
      try {
        rows = (await api(`/api/admin/import/parse?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })).rows;
        renderMap();
      } catch (err) {
        $('#imp-map', container).innerHTML = `<div class="void-note import-status">${esc(err.message)}</div>`;
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
  const [items, categories, groups, cards] = await Promise.all([
    api('/api/admin/items'), api('/api/admin/categories'), api('/api/admin/groups'), api('/api/admin/cards'),
  ]);
  if (!alive()) return;
  // Items grouped in menu order; items without a category come last under "سایر".
  const sections = [
    ...categories.map((c) => ({ c, list: items.filter((i) => i.categoryId === c.id) })),
    { c: { id: null, name: 'بدون دسته (سایر)' }, list: items.filter((i) => i.categoryId == null) },
  ].filter((s) => s.list.length);

  view.innerHTML = `
    <div class="page-title"><h1>کالاها</h1><button type="button" class="btn ghost small" data-open-import="items">${ic('import')}ورود از اکسل</button></div>
    <div class="card" id="import" hidden></div>
    <div class="card" id="cats"></div>
    <div class="card">
      <div class="card-head"><h2 id="form-title">کالای جدید</h2></div>
      <form class="form" id="f">
        <div class="form-grid">
          <label>نام<input name="name" required maxlength="80" placeholder="مثلاً نیمرو" autocomplete="off"></label>
          <label>دسته
            <select name="categoryId">
              <option value="">بدون دسته (سایر)</option>
              ${categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            </select>
          </label>
          <label>قیمت (تومان)<input name="price" inputmode="numeric" data-amount required autocomplete="off"><span class="hint"></span></label>
        </div>
        <label class="check" id="active-wrap" hidden><input type="checkbox" name="isActive" checked> فعال (در صفحه‌ی ثبت سفارش نمایش داده شود)</label>
        <div class="row-end">
          <button type="button" class="btn ghost" id="cancel" hidden>انصراف</button>
          <button class="btn" id="save">افزودن</button>
        </div>
      </form>
    </div>
    <div class="card">
      ${sections.length ? sections.map(({ c, list }) => `
        <div class="cat-title">${esc(c.name)} ${c.id ? categoryRulesHtml(c) : ''}</div>
        <div class="list">
          ${list.map((i) => `
            <div class="list-row">
              <div class="grow"><div class="title">${esc(i.name)} ${i.isActive ? '' : '<span class="badge off">غیرفعال</span>'}</div></div>
              <div class="amount">${priceHtml(i.price)}</div>
              ${rowActionsHtml('', i.id)}
            </div>`).join('')}
        </div>`).join('') : emptyHtml('package', 'هنوز کالایی تعریف نشده است؛ با فرم بالا اولین کالا را اضافه کنید.')}
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
      fields.categoryId.value = item.categoryId ?? '';
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
      if (!await askConfirm({ title: `کالای «${item.name}» حذف شود؟`, okText: 'حذف کالا' })) return;
      try { await api(`/api/admin/items/${item.id}`, { method: 'DELETE' }); toast('حذف شد.'); route(); }
      catch (err) { toast(err.message, true); }
    }
  });
  onSubmit(form, async (fd) => {
    const price = parseAmount(fd.get('price'));
    if (Number.isNaN(price)) throw new Error('قیمت معتبر وارد کنید.');
    const categoryId = fd.get('categoryId') ? Number(fd.get('categoryId')) : null;
    const body = { name: fd.get('name'), categoryId, price, isActive: editingId ? fd.get('isActive') === 'on' : true };
    await api(editingId ? `/api/admin/items/${editingId}` : '/api/admin/items', { method: editingId ? 'PUT' : 'POST', body });
    toast(editingId ? 'ذخیره شد.' : 'کالا اضافه شد.');
    route();
  });
  renderCategoriesAdmin($('#cats'), categories, groups, cards);
}

// ---------- menu categories and staff groups ----------
/** "۰۷:۰۰" from "07:00". */
const hhmm = (t) => faDigits(t ?? '');
/** Small badges for a category's rules: opening hours and staff group. */
const categoryRulesHtml = (c) => `
  ${c.startTime ? `<span class="badge ${c.open === false ? 'debt' : 'wait'}" title="${c.open === false ? 'الان بسته است' : 'الان باز است'}">${ic('clock')}${hhmm(c.startTime)} تا ${hhmm(c.endTime)}${c.open === false ? '، بسته' : ''}</span>` : ''}
  ${c.personGroup ? `<span class="badge warn">${ic('users')}فقط ${esc(c.personGroup)}</span>` : ''}
  ${c.paymentCard ? `<span class="badge zero">${ic('card')}${esc(c.paymentCard)}</span>` : ''}`;

/** Edit and delete icon buttons at the end of a list row; `kind` prefixes the data attributes ("cat-", "group-", …). */
const rowActionsHtml = (kind, id, extra = '') => `
  <div class="actions">
    ${extra}
    <button type="button" class="icon-btn small" data-${kind}edit="${id}" title="ویرایش" aria-label="ویرایش">${ic('pencil')}</button>
    <button type="button" class="icon-btn small danger" data-${kind}del="${id}" title="حذف" aria-label="حذف">${ic('trash')}</button>
  </div>`;

/** "Menu categories" card on the items page: name, opening hours, staff group, bank card, order. */
function renderCategoriesAdmin(card, categories, groups, cards) {
  let editingId = null;
  card.innerHTML = `
    <div class="card-head"><h2>دسته‌بندی منو</h2></div>
    <p class="card-intro">
      ساعت کاری: همکاران فقط در همان بازه از دسته درخواست می‌دهند (بدون ساعت، همیشه باز).
      گروه پرسنلی: دسته فقط برای همان گروه نمایش داده می‌شود.
      کارت: بدهی خریدهای دسته جداگانه برای همان کارت حساب می‌شود.
    </p>
    <div class="list">
      ${categories.length ? categories.map((c, i) => `
        <div class="list-row">
          <div class="grow">
            <div class="title">${esc(c.name)} ${categoryRulesHtml(c)}</div>
            ${metaHtml([c.startTime ? null : 'همه‌ی ساعات', c.personGroup ? null : 'برای همه', `${fa(c.itemCount)} کالا`])}
          </div>
          ${rowActionsHtml('cat-', c.id, `
            <button type="button" class="icon-btn small" data-cat-move="${c.id}:-1" ${i === 0 ? 'disabled' : ''} title="بالاتر" aria-label="بالاتر">${ic('chevron-up')}</button>
            <button type="button" class="icon-btn small" data-cat-move="${c.id}:1" ${i === categories.length - 1 ? 'disabled' : ''} title="پایین‌تر" aria-label="پایین‌تر">${ic('chevron-down')}</button>`)}
        </div>`).join('') : emptyHtml('package', 'هنوز دسته‌ای تعریف نشده است.')}
    </div>
    <form class="form mt-3" id="cat-form">
      <div class="form-grid">
        <label>نام دسته<input name="name" required maxlength="40" placeholder="مثلاً صبحانه" autocomplete="off"></label>
        <label>از ساعت (اختیاری)<input name="startTime" type="time"></label>
        <label>تا ساعت (اختیاری)<input name="endTime" type="time"></label>
      </div>
      <label>گروه پرسنلی
        <select name="personGroupId">
          <option value="">همه‌ی پرسنل</option>
          ${groups.map((g) => `<option value="${g.id}">فقط ${esc(g.name)}</option>`).join('')}
        </select>
        ${groups.length ? '' : '<span class="hint">گروه‌ها در صفحه‌ی «افراد» تعریف می‌شوند.</span>'}
      </label>
      <label>کارت پرداخت این دسته
        <select name="paymentCardId">
          <option value="">بدون کارت (در بدهی کلی)</option>
          ${cards.map((c) => `<option value="${c.id}">${esc(c.title)} — ${cardNumberText(c.number)}</option>`).join('')}
        </select>
        ${cards.length ? '' : '<span class="hint">کارت‌ها در صفحه‌ی «تنظیمات» تعریف می‌شوند.</span>'}
      </label>
      <div class="row-end">
        <button type="button" class="btn ghost" id="cat-cancel" hidden>انصراف</button>
        <button class="btn" id="cat-save">افزودن دسته</button>
      </div>
    </form>`;

  const form = $('#cat-form', card);
  const setEditing = (c) => {
    editingId = c?.id ?? null;
    form.reset();
    if (c) {
      form.elements.name.value = c.name;
      form.elements.startTime.value = c.startTime ?? '';
      form.elements.endTime.value = c.endTime ?? '';
      form.elements.personGroupId.value = c.personGroupId ?? '';
      form.elements.paymentCardId.value = c.paymentCardId ?? '';
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.elements.name.focus();
    }
    $('#cat-save', card).textContent = c ? 'ذخیره' : 'افزودن دسته';
    $('#cat-cancel', card).hidden = !c;
  };
  $('#cat-cancel', card).onclick = () => setEditing(null);
  card.onclick = async (e) => {
    const edit = e.target.closest('[data-cat-edit]');
    if (edit) return setEditing(categories.find((c) => c.id == edit.dataset.catEdit));
    const move = e.target.closest('[data-cat-move]');
    const del = e.target.closest('[data-cat-del]');
    try {
      if (move) {
        const [id, direction] = move.dataset.catMove.split(':').map(Number);
        await api(`/api/admin/categories/${id}/move`, { method: 'POST', body: { direction } });
        route();
      } else if (del) {
        const c = categories.find((x) => x.id == del.dataset.catDel);
        if (!await askConfirm({ title: `دسته‌ی «${c.name}» حذف شود؟`, okText: 'حذف دسته' })) return;
        await api(`/api/admin/categories/${c.id}`, { method: 'DELETE' });
        toast('دسته حذف شد.');
        route();
      }
    } catch (err) { toast(err.message, true); }
  };
  onSubmit(form, async (fd) => {
    const body = {
      name: fd.get('name'),
      startTime: fd.get('startTime') || null,
      endTime: fd.get('endTime') || null,
      personGroupId: fd.get('personGroupId') ? Number(fd.get('personGroupId')) : null,
      paymentCardId: fd.get('paymentCardId') ? Number(fd.get('paymentCardId')) : null,
    };
    await api(editingId ? `/api/admin/categories/${editingId}` : '/api/admin/categories', { method: editingId ? 'PUT' : 'POST', body });
    toast(editingId ? 'دسته ذخیره شد.' : 'دسته اضافه شد.');
    route();
  });
}

/** "Staff groups" card on the people page. */
function renderGroupsAdmin(card, groups) {
  let editingId = null;
  card.innerHTML = `
    <div class="card-head"><h2>گروه‌های پرسنلی</h2></div>
    <p class="card-intro">مثلاً «شیفت شب» یا «مدیران». هر شخص می‌تواند در یک گروه باشد یا بدون گروه بماند. در صفحه‌ی «کالاها» می‌توانید یک دسته‌ی منو را فقط به یک گروه بدهید.</p>
    <div class="list">
      ${groups.length ? groups.map((g) => `
        <div class="list-row">
          <div class="icon">${ic('users')}</div>
          <div class="grow">
            <div class="title">${esc(g.name)}</div>
            ${metaHtml([`${fa(g.memberCount)} نفر`, g.categoryCount ? `${fa(g.categoryCount)} دسته‌ی منو` : null])}
          </div>
          ${rowActionsHtml('group-', g.id)}
        </div>`).join('') : emptyHtml('users', 'هنوز گروهی تعریف نشده است.')}
    </div>
    <form class="form mt-3" id="group-form">
      <div class="inline-form">
        <input name="name" required maxlength="40" placeholder="نام گروه، مثلاً شیفت شب" autocomplete="off">
        <button type="button" class="btn ghost" id="group-cancel" hidden>انصراف</button>
        <button class="btn" id="group-save">افزودن گروه</button>
      </div>
    </form>`;

  const form = $('#group-form', card);
  const setEditing = (g) => {
    editingId = g?.id ?? null;
    form.reset();
    if (g) { form.elements.name.value = g.name; form.elements.name.focus(); }
    $('#group-save', card).textContent = g ? 'ذخیره' : 'افزودن گروه';
    $('#group-cancel', card).hidden = !g;
  };
  $('#group-cancel', card).onclick = () => setEditing(null);
  card.onclick = async (e) => {
    const edit = e.target.closest('[data-group-edit]');
    if (edit) return setEditing(groups.find((g) => g.id == edit.dataset.groupEdit));
    const del = e.target.closest('[data-group-del]');
    if (!del) return;
    const g = groups.find((x) => x.id == del.dataset.groupDel);
    if (!await askConfirm({
      title: `گروه «${g.name}» حذف شود؟`,
      text: g.memberCount ? `${fa(g.memberCount)} نفرِ آن بدون گروه می‌شوند.` : '',
      okText: 'حذف گروه',
    })) return;
    try { await api(`/api/admin/groups/${g.id}`, { method: 'DELETE' }); toast('گروه حذف شد.'); route(); }
    catch (err) { toast(err.message, true); }
  };
  onSubmit(form, async (fd) => {
    await api(editingId ? `/api/admin/groups/${editingId}` : '/api/admin/groups', { method: editingId ? 'PUT' : 'POST', body: { name: fd.get('name') } });
    toast(editingId ? 'گروه ذخیره شد.' : 'گروه اضافه شد.');
    route();
  });
}

async function viewPeople(_, alive) {
  const [people, summary, groups] = await Promise.all([api('/api/admin/people'), api('/api/report/summary'), api('/api/admin/groups')]);
  if (!alive()) return;
  const balance = new Map(summary.people.map((p) => [p.id, p.balance]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  people.sort((a, b) => b.isActive - a.isActive || byName(a, b));
  const missing = people.filter((p) => p.isActive && !p.nationalCode).length;

  view.innerHTML = `
    <div class="page-title"><h1>افراد</h1><button type="button" class="btn ghost small" data-open-import="people">${ic('import')}ورود از اکسل</button></div>
    <div class="card" id="import" hidden></div>
    <div class="card">
      <div class="card-head"><h2 id="form-title">شخص جدید</h2></div>
      <form class="form" id="f">
        <div class="form-grid">
          <label>نام و نام خانوادگی<input name="name" required maxlength="80" placeholder="مثلاً علی رضایی" autocomplete="off"></label>
          <label>کد ملی<input name="nationalCode" inputmode="numeric" maxlength="12" placeholder="۱۰ رقم — برای ورود خودش" autocomplete="off" class="code-input"></label>
          <label>گروه پرسنلی
            <select name="groupId">
              <option value="">بدون گروه</option>
              ${groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="check" id="active-wrap" hidden><input type="checkbox" name="isActive" checked> فعال (در ثبت سفارش نمایش داده شود و بتواند وارد شود)</label>
        <div class="row-end">
          <button type="button" class="btn ghost" id="cancel" hidden>انصراف</button>
          <button class="btn" id="save">افزودن شخص</button>
        </div>
      </form>
    </div>
    <div class="card">
      ${missing ? `<div class="banner warn">${ic('alert')}<div class="b-title">${fa(missing)} نفر هنوز کد ملی ندارند</div><div class="b-body">تا کد ملی ثبت نشود نمی‌توانند وارد شوند.</div></div>` : ''}
      <input class="search" id="q" placeholder="جستجوی نام یا کد ملی…" autocomplete="off">
      <div class="list" id="list">
        ${people.length ? people.map((p) => `
          <div class="list-row" data-name="${esc(p.name)} ${esc(p.nationalCode ?? '')} ${faDigits(p.nationalCode ?? '')} ${esc(groupName.get(p.groupId) ?? '')}">
            <div class="grow">
              <div class="title">${esc(p.name)} ${p.groupId ? `<span class="badge warn">${ic('users')}${esc(groupName.get(p.groupId))}</span>` : ''} ${p.isActive ? '' : '<span class="badge off">غیرفعال</span>'}</div>
              <div class="sub">${p.nationalCode ? `کد ملی ${faDigits(p.nationalCode)}` : '<span class="late">بدون کد ملی</span>'}</div>
            </div>
            ${balanceBadge(balance.get(p.id) ?? 0)}
            ${rowActionsHtml('', p.id)}
          </div>`).join('') : emptyHtml('users', 'هنوز شخصی تعریف نشده است؛ با فرم بالا اضافه کنید یا از اکسل وارد کنید.')}
      </div>
    </div>
    <div class="card" id="groups"></div>`;

  renderGroupsAdmin($('#groups'), groups);
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
      fields.groupId.value = p.groupId ?? '';
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
    if (!await askConfirm({ title: `«${p.name}» حذف شود؟`, okText: 'حذف شخص' })) return;
    try { await api(`/api/admin/people/${p.id}`, { method: 'DELETE' }); toast('حذف شد.'); route(); }
    catch (err) { toast(err.message, true); }
  });
  onSubmit(form, async (fd) => {
    const body = {
      name: fd.get('name'),
      nationalCode: toLatinDigits(fd.get('nationalCode')),
      groupId: fd.get('groupId') ? Number(fd.get('groupId')) : null,
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
          <label>رمز جدید<input name="new" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>
          <div class="row-end"><button class="btn">تغییر رمز</button></div>
        </form>
      </div>
      <div class="card">
        <div class="card-head"><h2>حساب‌های مسئول</h2></div>
        <div class="list">
          ${users.map((u) => `
            <div class="list-row">
              <div class="grow"><div class="title">${esc(u.username)}</div><div class="sub">ساخته‌شده ${fmtDT(u.createdAt)}</div></div>
              ${u.username === state.me.username ? '<span class="badge zero">شما</span>' : `<button type="button" class="icon-btn small danger" data-del="${u.id}" title="حذف" aria-label="حذف ${esc(u.username)}">${ic('trash')}</button>`}
            </div>`).join('')}
        </div>
        <form class="form mt-3" id="add">
          <label>نام کاربری<input name="username" autocomplete="off" required minlength="3" dir="auto"></label>
          <label>رمز عبور<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></label>
          <div class="row-end"><button class="btn">افزودن مسئول</button></div>
        </form>
      </div>
    </div>
    <div class="card" id="audit"></div>
    <div class="card">
      <div class="card-head"><h2>درباره</h2>${state.me.version ? `<span class="badge zero">نسخه ${faDigits(state.me.version)}</span>` : ''}</div>
      <p class="muted">بوفه (OfficeBuffet) نرم‌افزار متن‌باز با مجوز MIT است.
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
    if (!del) return;
    const user = users.find((u) => u.id == del.dataset.del);
    if (!await askConfirm({ title: `حساب مسئول «${user?.username ?? ''}» حذف شود؟`, okText: 'حذف حساب' })) return;
    try { await api(`/api/admin/users/${del.dataset.del}`, { method: 'DELETE' }); toast('حذف شد.'); route(); }
    catch (err) { toast(err.message, true); }
  });
  renderPushCard(alive);
  renderCardsAdmin($('#cards'), alive);
  renderAuditLog($('#audit'), alive);
}

// ---------- security log (read-only) ----------
const AUDIT_ACTIONS = {
  'admin.setup': 'ساخت اولین حساب مسئول',
  'admin.login': 'ورود مسئول',
  'admin.login_failed': 'ورود ناموفق مسئول',
  'admin.password': 'تغییر رمز',
  'admin.password_failed': 'رمز فعلی اشتباه (تغییر رمز)',
  'admin.user_create': 'افزودن حساب مسئول',
  'admin.user_delete': 'حذف حساب مسئول',
  'employee.login': 'ورود همکار',
  'employee.login_failed': 'ورود ناموفق با کد ملی',
  'card.create': 'افزودن کارت',
  'card.update': 'تغییر کارت',
  'card.delete': 'حذف کارت',
  'item.price': 'تغییر قیمت',
  'person.code': 'تغییر کد ملی',
  'person.activate': 'فعال‌کردن شخص',
  'person.deactivate': 'غیرفعال‌کردن شخص',
  'import.items': 'ورود کالاها از فایل',
  'import.people': 'ورود افراد از فایل',
};
const AUDIT_WARN = new Set(['admin.login_failed', 'employee.login_failed', 'admin.password_failed', 'card.update', 'card.delete', 'admin.user_create', 'admin.user_delete']);

/** Who logged in from where, and every change to cards, accounts, prices and national codes. Nothing here can be edited. */
async function renderAuditLog(card, alive) {
  const rows = await api('/api/admin/audit');
  if (!alive()) return;
  card.innerHTML = `
    <div class="card-head"><h2>${ic('alert')}رویدادهای امنیتی</h2></div>
    <p class="card-intro">ورودها و تغییر کارت‌ها، حساب‌ها، قیمت‌ها و کدهای ملی. این فهرست قابل ویرایش یا حذف نیست.
      اگر ورودی به نام همکاری می‌بینید که او انجام نداده، کد ملی‌اش را عوض کنید.</p>
    ${rows.length ? `<div class="list">${rows.map((r) => `
      <div class="list-row">
        <div class="grow">
          <div class="title">${AUDIT_WARN.has(r.action) ? `<span class="badge warn">${esc(AUDIT_ACTIONS[r.action] ?? r.action)}</span>` : esc(AUDIT_ACTIONS[r.action] ?? r.action)}
            <bdi>${esc(r.actor)}</bdi></div>
          ${metaHtml([fmtDT(r.at), r.ip ? `<bdi dir="ltr">${esc(r.ip)}</bdi>` : null, r.details ? `<bdi>${esc(r.details)}</bdi>` : null])}
        </div>
      </div>`).join('')}</div>` : emptyHtml('check-circle', 'هنوز رویدادی ثبت نشده است.')}`;
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
    <p class="card-intro">کارت‌هایی که همکاران به آن‌ها پرداخت می‌کنند. در «حساب من» هر همکار، زیر مانده‌ی حساب، با عنوانشان نمایش داده می‌شوند و با یک ضربه کپی می‌شوند.</p>
    <div class="list">
      ${cards.length ? cards.map((c) => `
        <div class="list-row">
          <div class="icon">${ic('card')}</div>
          <div class="grow"><div class="title">${esc(c.title)}</div><div class="card-no">${cardNumberText(c.number)}</div></div>
          ${rowActionsHtml('card-', c.id)}
        </div>`).join('') : emptyHtml('card', 'هنوز کارتی تعریف نشده است.')}
    </div>
    <form class="form mt-3" id="card-form">
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
    if (!await askConfirm({
      title: `کارت «${c.title}» حذف شود؟`,
      text: 'دسته‌ها و پرداخت‌هایی که به این کارت وصل‌اند «بدون کارت» می‌شوند (جمع بدهی‌ها تغییری نمی‌کند).',
      okText: 'حذف کارت',
    })) return;
    try { await api(`/api/admin/cards/${c.id}`, { method: 'DELETE' }); toast('کارت حذف شد.'); renderCardsAdmin(card, alive); }
    catch (err) { toast(err.message, true); }
  };
  onSubmit(form, async (fd) => {
    const body = { title: fd.get('title'), number: toLatinDigits(fd.get('number')) };
    const save = () => api(editingId ? `/api/admin/cards/${editingId}` : '/api/admin/cards', { method: editingId ? 'PUT' : 'POST', body });
    try { await save(); }
    catch (err) {
      // Number fails the check digit: probably a typo, but let the manager keep it if they are sure.
      if (!err.data?.confirm || !await askConfirm({
        title: 'شماره کارت معتبر به نظر نمی‌رسد',
        text: `${err.message}\n\nشماره را دوباره نگاه کنید. اگر مطمئنید درست است، «با همین شماره ثبت شود» را بزنید.`,
        okText: 'با همین شماره ثبت شود', danger: false,
      })) throw err;
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
// "۲ عدد قهوه": plain text (messages, toasts), where "۲ × قهوه" got reordered in right-to-left text.
const linesText = (lines) => lines.map((l) => `${fa(l.quantity)} عدد ${l.itemName}`).join('، ');
/** Request lines as chips with a large count badge, so "how many of what" is clear at a glance. */
const linesHtml = (lines, big = false) => `<div class="lines${big ? ' big' : ''}">${lines.map((l) => `
  <span class="line"><b class="q">${fa(l.quantity)}</b><span class="n">${esc(l.itemName)}</span></span>`).join('')}</div>`;
const statusBadge = (s) => `<span class="badge ${REQUEST_STATUS[s][1]}">${REQUEST_STATUS[s][0]}</span>`;

/** Employee page: the price list doubles as a request form ("I'd like a coffee"). */
async function viewPrices(_, alive) {
  const [{ now: serverNow, menu }, balance] = await Promise.all([api('/api/report/prices'), api('/api/report/balance')]);
  if (!alive()) return;
  const items = menu.flatMap((s) => s.items);
  const cart = new Map();
  // During a settlement drive someone who owes money can't send requests (the server refuses them too).
  const blocked = balance.drive.active && balance.due > 0;

  // Opening hours are in office (server) time; measure this device's clock against it once, so sections
  // open and close on time while the page stays open.
  const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const deviceMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const skew = ((minutes(serverNow) - deviceMinutes() + 720 + 1440) % 1440) - 720;
  const isOpen = (c) => {
    if (!c.startTime) return true;
    const t = (deviceMinutes() + skew + 1440) % 1440;
    const [s, e] = [minutes(c.startTime), minutes(c.endTime)];
    return s <= e ? t >= s && t < e : t >= s || t < e;
  };

  view.innerHTML = `
    <div class="page-title"><h1>لیست قیمت و درخواست</h1></div>
    ${driveBannerHtml(balance)}
    ${blocked && balance.cards.length ? `<div class="card">${balanceBreakdownHtml(balance, { copy: true })}</div>` : ''}
    <div class="card" id="push" hidden></div>
    <div class="card">
      ${items.length ? `
        <p class="card-intro">تعداد را انتخاب کنید و «ارسال درخواست» را بزنید تا مسئول بوفه باخبر شود.</p>
        ${menu.map(({ category: c, items: list }, n) => `
          <section class="menu-section" data-section="${n}">
          <div class="cat-title">${esc(c.name)}
            ${c.startTime ? `<span class="badge wait">${ic('clock')}${hhmm(c.startTime)} تا ${hhmm(c.endTime)}</span>` : ''}
            <span class="closed-note badge debt">بسته است؛ سفارش از ساعت ${hhmm(c.startTime)}</span>
          </div>
          <div class="items-grid">${list.map(itemTileHtml).join('')}</div>
          </section>`).join('')}
        <label class="note-field">توضیح (اختیاری)<input id="note" maxlength="200" placeholder="مثلاً کم‌شیرین، اتاق ۲۰۳"></label>
        ${orderBarHtml('ارسال درخواست')}` : emptyHtml('coffee', 'هنوز کالایی در منو نیست.')}
    </div>
    <div class="card"><div class="card-head"><h2>درخواست‌های من</h2></div><div class="list" id="mine"></div></div>`;

  const updateBar = () => {
    const lines = [...cart.entries()].filter(([, q]) => q > 0);
    const count = sum(lines, ([, q]) => q);
    $('#cnt').textContent = count ? `${fa(count)} قلم انتخاب شده` : 'هنوز چیزی انتخاب نشده';
    $('#tot').innerHTML = money(sum(lines, ([id, q]) => items.find((i) => i.id === id).price * q));
    $('#submit').disabled = count === 0 || blocked;
    if (blocked) $('#submit').textContent = 'اول تسویه کنید';
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

  // Grey out sections outside their hours; anything already picked from a section that just closed is removed.
  const refreshOpenSections = () => {
    menu.forEach(({ category: c, items: list }, n) => {
      const open = isOpen(c);
      view.querySelector(`[data-section="${n}"]`)?.classList.toggle('closed', !open);
      if (open) return;
      const dropped = list.filter((i) => cart.get(i.id) > 0);
      dropped.forEach((i) => setQty(i.id, 0));
      if (dropped.length) toast(`دسته‌ی «${c.name}» بسته شد و از سبد برداشته شد.`, true);
    });
  };
  if (items.length) {
    refreshOpenSections();
    const hours = setInterval(() => (alive() ? refreshOpenSections() : clearInterval(hours)), 30000);
  }

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
        ? `درخواستت (${linesText(r.lines)}) دیده شد و تا دقایقی دیگر آماده می‌شود.`
        : `درخواستت (${linesText(r.lines)}) رد شد${r.rejectReason ? `؛ دلیل: ${r.rejectReason}` : ''}.`)).join('\n'),
        answered.some((r) => r.status === 'rejected'));
      beep();
    }
    $('#mine').innerHTML = mine.length ? mine.map((r) => `
      <div class="list-row request-row">
        <div class="grow">
          <div class="title">${linesHtml(r.lines)}</div>
          ${r.editedAt ? `<div><span class="badge warn">${ic('pencil')}مسئول بوفه تغییرش داد</span></div>` : ''}
          ${metaHtml([fmtDT(r.createdAt), r.note ? esc(r.note) : null, r.rejectReason ? 'دلیل: ' + esc(r.rejectReason) : null,
            r.status === 'pending' && r.remindCount ? `${fa(r.remindCount)} بار تلنگر زدی` : null])}
        </div>
        ${statusBadge(r.status)}
        ${r.status === 'pending' ? `<div class="actions">${remindButton(r)}<button class="btn link danger small" data-cancel="${r.id}">لغو درخواست</button></div>` : ''}
      </div>`).join('') : emptyHtml('inbox', 'هنوز درخواستی نفرستاده‌اید.');
    tickReminders();
  };

  // "Nudge" button: re-sends the notification to the admin, with a short cooldown shown as a countdown.
  const REMIND_EVERY_MS = 2 * 60 * 1000;
  const MAX_REMINDERS = 2;
  const remindButton = (r) => {
    if (r.remindCount >= MAX_REMINDERS) return '<span class="nudge-done">به نظر می‌رسه سرش شلوغه؛ یه سر حضوری بزن!</span>';
    const at = new Date(r.remindedAt || r.createdAt).getTime() + REMIND_EVERY_MS;
    return `<button class="btn ghost small nudge" data-remind="${r.id}" data-remind-at="${at}" title="دوباره به مسئول بوفه خبر بده">${ic('bell-ring')}یه تلنگر بزن!</button>`;
  };
  const tickReminders = () => {
    view.querySelectorAll('[data-remind-at]').forEach((b) => {
      const left = Math.ceil((Number(b.dataset.remindAt) - Date.now()) / 1000);
      b.disabled = left > 0;
      b.innerHTML = left > 0 ? `${ic('timer')}${faDigits(`${Math.floor(left / 60)}:${pad2(left % 60)}`)}` : `${ic('bell-ring')}یه تلنگر بزن!`;
    });
  };
  const ticker = setInterval(() => (alive() ? tickReminders() : clearInterval(ticker)), 1000);

  view.addEventListener('click', async (e) => {
    const tile = e.target.closest('[data-item]');
    if (tile) {
      const id = Number(tile.dataset.item);
      const step = e.target.closest('[data-step]');
      const section = tile.closest('.menu-section');
      if (section?.classList.contains('closed')) {
        const { category: c } = menu[Number(section.dataset.section)];
        return toast(`سفارش از «${c.name}» فقط از ${hhmm(c.startTime)} تا ${hhmm(c.endTime)} ممکن است.`, true);
      }
      return setQty(id, (cart.get(id) || 0) + (step ? Number(step.dataset.step) : 1));
    }
    const remind = e.target.closest('[data-remind]');
    if (remind) {
      remind.disabled = true;
      try {
        const res = await api(`/api/requests/${remind.dataset.remind}/remind`, { method: 'POST' });
        toast(res.remindCount >= MAX_REMINDERS
          ? 'تلنگر دوم هم زده شد! اگه باز خبری نشد، به نظر می‌رسه باید یه سر حضوری بزنی.'
          : 'تلنگر زده شد! مسئول بوفه دوباره خبردار شد.');
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
      if (!await askConfirm({ title: 'این درخواست لغو شود؟', okText: 'لغو درخواست' })) return;
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
    <nav class="segmented" aria-label="وضعیت درخواست‌ها">
      <a class="${done ? '' : 'active'}" href="#/requests" ${done ? '' : 'aria-current="page"'}>در انتظار <span class="n">${fa(data.pending.length)}</span></a>
      <a class="${done ? 'active' : ''}" href="#/requests/done" ${done ? 'aria-current="page"' : ''}>رسیدگی‌شده <span class="n">${fa(data.recent.length)}</span></a>
    </nav>
    ${done ? '' : `<div class="card">
      <div class="list">
        ${data.pending.length ? data.pending.map((r) => `
          <div class="list-row request-row" data-request="${r.id}">
            <div class="grow">
              <div class="title">${esc(r.personName)} ${editedBadge(r)}</div>
              ${metaHtml([fmtDT(r.createdAt), r.remindCount ? `<span class="late">${ic('bell-ring', 'sm')} ${fa(r.remindCount)} بار تلنگر زده، آخرین ${fmtDT(r.remindedAt)}</span>` : null])}
              <div class="req-lines">${linesHtml(r.lines, true)}</div>
              ${r.note ? `<div><span class="req-note">${ic('note')}${esc(r.note)}</span></div>` : ''}
            </div>
            <div class="amount">${money(estimate(r))}</div>
            <div class="actions req-actions">
              <button class="btn" data-accept="${r.id}">${ic('check')}تأیید و ثبت</button>
              <button class="btn secondary" data-edit-request="${r.id}">${ic('pencil')}ویرایش</button>
              <button class="btn link danger" data-reject="${r.id}">${ic('x-circle')}رد</button>
            </div>
          </div>`).join('') : emptyHtml('inbox', 'درخواستی در انتظار نیست. درخواست‌های تازه اینجا می‌آیند و صدا پخش می‌شود.')}
      </div>
    </div>`}
    ${done ? `
      <div class="card">
        <div class="list">
          ${data.recent.length ? data.recent.map((r) => `
            <div class="list-row">
              <div class="grow">
                <div class="title">${esc(r.personName)} ${editedBadge(r)}</div>
                ${linesHtml(r.lines)}
                ${metaHtml([fmtDT(r.handledAt || r.createdAt), r.handledBy ? esc(r.handledBy) : null, r.rejectReason ? 'دلیل: ' + esc(r.rejectReason) : null])}
              </div>
              ${statusBadge(r.status)}
              ${r.status === 'done' || r.status === 'rejected'
                ? `<button class="btn link small" data-reopen="${r.id}:${r.status}" title="برگرداندن به «در انتظار» برای ویرایش و تأیید دوباره">${ic('undo', 'flip')}${r.status === 'done' ? 'بازگشت از تأیید' : 'برگرداندن'}</button>` : ''}
            </div>`).join('') : emptyHtml('inbox', 'هنوز درخواستی رسیدگی نشده است.')}
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
    const edit = e.target.closest('[data-edit-request]');
    if (edit) return openRequestEditor(data.pending.find((r) => r.id == edit.dataset.editRequest));
    const reopen = e.target.closest('[data-reopen]');
    if (reopen) {
      const [id, status] = reopen.dataset.reopen.split(':');
      const text = status === 'done'
        ? 'سفارش‌هایی که این درخواست ساخته بود ابطال می‌شوند (در سابقه می‌مانند) و درخواست به «در انتظار» برمی‌گردد تا ویرایش و دوباره تأیید کنید. ادامه می‌دهید؟'
        : 'این درخواست ردشده به «در انتظار» برمی‌گردد. ادامه می‌دهید؟';
      if (!await askConfirm({
        title: status === 'done' ? 'تأیید این درخواست برگردانده شود؟' : 'این درخواست به «در انتظار» برگردد؟',
        text: text.replace(/ ادامه می‌دهید؟$/, ''),
        okText: status === 'done' ? 'بازگشت از تأیید' : 'برگرداندن', danger: status === 'done',
      })) return;
      try {
        await api(`/api/admin/requests/${id}/reopen`, { method: 'POST' });
        toast('درخواست به «در انتظار» برگشت.');
        location.hash = '#/requests';
      } catch (err) { toast(err.message, true); }
    }
  });

  // Inline editor for a pending request: change counts, remove lines, add items (out of stock, swap, extra).
  let catalog = null;
  async function openRequestEditor(r) {
    const row = view.querySelector(`[data-request="${r.id}"]`);
    catalog ??= await Promise.all([api('/api/admin/items'), api('/api/admin/categories'), api('/api/admin/people')]);
    const [allItems, allCategories, allPeople] = catalog;
    const groupId = allPeople.find((p) => p.id === r.personId)?.groupId ?? null;
    const allowedCategory = new Set(allCategories.filter((c) => !c.personGroupId || c.personGroupId === groupId).map((c) => c.id));
    const choices = allItems.filter((i) => i.isActive && (i.categoryId == null || allowedCategory.has(i.categoryId)));
    const lines = new Map(r.lines.map((l) => [l.itemId, { name: l.itemName, qty: l.quantity }]));

    const editor = document.createElement('div');
    editor.className = 'req-editor';
    const render = () => {
      editor.innerHTML = `
        ${[...lines].map(([id, l]) => `
          <div class="req-edit-line">
            <span class="n">${esc(l.name)}</span>
            <div class="stepper">
              <button type="button" class="plus" data-ed-step="${id}:1" aria-label="اضافه کردن">${ic('plus')}</button>
              <span class="qty">${fa(l.qty)}</span>
              <button type="button" data-ed-step="${id}:-1" aria-label="کم کردن">${ic('minus')}</button>
            </div>
            <button type="button" class="icon-btn small danger" data-ed-remove="${id}" title="حذف این قلم" aria-label="حذف این قلم">${ic('trash')}</button>
          </div>`).join('') || '<div class="muted">هیچ قلمی نمانده؛ یک قلم اضافه کنید یا درخواست را رد کنید.</div>'}
        <div class="inline-form">
          <select data-ed-add aria-label="افزودن قلم">
            <option value="">افزودن قلم…</option>
            ${choices.filter((i) => !lines.has(i.id)).map((i) => `<option value="${i.id}">${esc(i.name)}${i.category ? ` (${esc(i.category)})` : ''}</option>`).join('')}
          </select>
        </div>
        <div class="row-end">
          <button type="button" class="btn ghost small" data-ed-cancel>انصراف</button>
          <button type="button" class="btn secondary small" data-ed-save>ذخیره</button>
          <button type="button" class="btn small" data-ed-save-accept>${ic('check')}ذخیره و تأیید</button>
        </div>`;
    };
    render();
    row.querySelector('.req-lines').replaceChildren(editor);
    row.querySelector('.actions').hidden = true;

    const save = async (accept) => {
      const body = { lines: [...lines].map(([itemId, l]) => ({ itemId, quantity: l.qty })) };
      await api(`/api/admin/requests/${r.id}`, { method: 'PUT', body });
      if (accept) {
        const res = await api(`/api/admin/requests/${r.id}/accept`, { method: 'POST' });
        toast(`ثبت شد: ${res.personName} — ${fa(res.total)} تومان`);
      } else toast('درخواست ویرایش شد.');
      route();
    };
    editor.onclick = async (e) => {
      const step = e.target.closest('[data-ed-step]');
      if (step) {
        const [id, d] = step.dataset.edStep.split(':').map(Number);
        const l = lines.get(id);
        l.qty = Math.max(1, Math.min(10, l.qty + d));
        return render();
      }
      const remove = e.target.closest('[data-ed-remove]');
      if (remove) { lines.delete(Number(remove.dataset.edRemove)); return render(); }
      if (e.target.closest('[data-ed-cancel]')) return route();
      const saveBtn = e.target.closest('[data-ed-save], [data-ed-save-accept]');
      if (saveBtn) {
        saveBtn.disabled = true;
        try { await save('edSaveAccept' in saveBtn.dataset); }
        catch (err) { toast(err.message, true); saveBtn.disabled = false; }
      }
    };
    editor.onchange = (e) => {
      if (!e.target.matches('[data-ed-add]') || !e.target.value) return;
      const item = choices.find((i) => i.id === Number(e.target.value));
      lines.set(item.id, { name: item.name, qty: 1 });
      render();
    };
  }

  renderPushCard(alive, { hideWhenOn: true });
}

/** "ویرایش‌شده" badge when the manager changed a request's lines. */
const editedBadge = (r) => (r.editedAt
  ? `<span class="badge warn" title="${fmtDT(r.editedAt)}">${ic('pencil')}ویرایش‌شده${r.editedBy ? ` توسط ${esc(r.editedBy)}` : ''}</span>` : '');

// ---------- push notifications (admin device) ----------
const pushSupported = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64urlBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function currentPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

const chimeButton = `<button type="button" class="btn ghost small" data-chime>${ic('bell-ring')}پخش صدای هشدار</button>`;
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
    card.innerHTML = `<div class="card-head"><h2>${ic('bell')}اعلان روی گوشی</h2></div>
      <p class="card-intro">${!window.isSecureContext
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
  card.innerHTML = `<div class="card-head"><h2>${ic('bell')}اعلان روی این دستگاه</h2>${on ? '<span class="badge credit">فعال</span>' : ''}</div>
    <p class="card-intro">${on
      ? (admin ? 'وقتی کسی درخواست بفرستد، روی این دستگاه اعلان می‌آید؛ حتی اگر برنامه بسته باشد.'
        : 'وقتی درخواستت دیده و آماده شود یا رد شود، روی همین گوشی خبردار می‌شوی؛ حتی اگر برنامه بسته باشد.')
      : Notification.permission === 'denied'
        ? 'اجازه‌ی اعلان برای این سایت در تنظیمات مرورگر بسته شده است؛ از تنظیمات سایت آن را روی Allow بگذارید.'
        : `${admin ? 'با فعال‌سازی، درخواست‌های جدید روی این گوشی یا کامپیوتر اعلان می‌شوند؛ حتی وقتی برنامه بسته است.'
          : 'با فعال‌سازی، وقتی مسئول بوفه درخواستت را ببیند و ثبت کند (یا با دلیل رد کند) روی همین گوشی خبردار می‌شوی.'}
          ${hideWhenOn ? `بعد از فعال‌سازی، این بخش به صفحه‌ی «${settingsPage}» می‌رود.` : ''}`}</p>
    ${on && admin && /android/i.test(navigator.userAgent) ? `<p class="hint">برای صدای مخصوص اعلان در اندروید: تنظیمات گوشی ← برنامه‌ها ← «بوفه» (یا Chrome) ← اعلان‌ها ← صدا.</p>` : ''}
    <div class="row-end">
      ${admin ? chimeButton : ''}
      ${on ? `<button class="btn ghost small" id="push-off">غیرفعال کردن</button>${admin ? '<button class="btn small" id="push-test">ارسال اعلان آزمایشی</button>' : ''}`
        : Notification.permission === 'denied' ? '' : `<button class="btn" id="push-on">${ic('bell')}فعال‌سازی اعلان</button>`}
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
let lastClaimId = null;
/** Count badge on a tab: "requests" (waiting requests) or "claims" (receipts waiting for review, on the payments tab). */
function setTabBadge(kind, count) {
  if (kind === 'requests') state.pendingRequests = count; else state.pendingClaims = count;
  const badge = $(`#tabs [data-badge="${kind}"]`);
  if (badge) { badge.textContent = fa(count); badge.hidden = !count; }
}
const setRequestBadge = (count) => setTabBadge('requests', count);

let lastReminder = null;
async function pollRequests() {
  if (!isAdmin() || document.hidden) return;
  try {
    const { count, latestId, lastReminder: reminder, claims, latestClaimId } = await api('/api/admin/requests/pending');
    setRequestBadge(count);
    setTabBadge('claims', claims);
    const isNew = lastRequestId !== null && latestId > lastRequestId;
    // An employee pressed "nudge" on a request that is still waiting.
    const nudged = lastRequestId !== null && reminder && reminder !== lastReminder;
    if (isNew || nudged) {
      toast(isNew ? 'درخواست جدید رسید.' : 'یک نفر هنوز منتظر درخواستش است!');
      beep();
      if (location.hash.startsWith('#/requests')) route();
    } else if (lastClaimId !== null && latestClaimId > lastClaimId) {
      // A receipt is not urgent like an order: a message and the badge, no sound.
      toast('یک فیش پرداخت برای بررسی رسید.');
      state.refreshClaims?.();
    }
    lastRequestId = Math.max(lastRequestId ?? 0, latestId);
    lastClaimId = Math.max(lastClaimId ?? 0, latestClaimId);
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
  pay: viewPay, claims: viewClaims,
};
const adminOnly = new Set(['report', 'person', 'order', 'requests', 'payments', 'claims', 'items', 'people', 'settings']);
const employeeOnly = new Set(['prices', 'pay']);
const homeHash = () => (isAdmin() ? '#/order' : isEmployee() ? '#/me' : '#/login');
let routeSeq = 0;

const REPO_URL = 'https://github.com/Mohamadkhadem/OfficeBuffet';
/** Small "OfficeBuffet v1.0.0" line linking to the project, shown under login and account pages. */
const versionLine = () => (state.me.version
  ? `<p class="version-line"><a href="${REPO_URL}" target="_blank" rel="noopener">بوفه، نسخه ${faDigits(state.me.version)}</a></p>` : '');

async function refreshMe() {
  try { state.me = await api('/api/auth/me'); } catch { state.me = { loggedIn: false }; }
}

/**
 * Destinations per role, most used first (the first is the rightmost in the phone's bottom bar).
 * `primary` ones are in the manager's bottom bar; the others sit behind «بیشتر» on phones and under
 * «گزارش و مدیریت» in the wide-screen sidebar. `short` is the label under the icon on phones.
 */
const NAV = {
  admin: [
    { key: 'order', label: 'ثبت سفارش', short: 'سفارش', icon: 'receipt', primary: true },
    { key: 'requests', label: 'درخواست‌ها', icon: 'inbox', primary: true, badge: 'requests' },
    { key: 'claims', label: 'بررسی فیش‌ها', short: 'فیش‌ها', icon: 'image', primary: true, badge: 'claims' },
    { key: 'payments', label: 'پرداخت و تسویه', short: 'پرداخت', icon: 'wallet', primary: true },
    { key: 'report', label: 'گزارش', icon: 'chart', hint: 'مصرف، پرداخت و مانده‌ی همه' },
    { key: 'items', label: 'کالاها', icon: 'package', hint: 'منو، دسته‌ها و قیمت‌ها' },
    { key: 'people', label: 'افراد', icon: 'users', hint: 'همکاران و گروه‌های پرسنلی' },
    { key: 'settings', label: 'تنظیمات', icon: 'sliders', hint: 'کارت‌ها، اعلان و حساب‌های مسئول' },
  ],
  employee: [
    { key: 'prices', label: 'قیمت و درخواست', short: 'منو', icon: 'coffee', primary: true },
    { key: 'pay', label: 'ثبت فیش', icon: 'image', primary: true },
    { key: 'me', label: 'حساب من', icon: 'user', primary: true },
  ],
};

const logoutButton = (cls = 'icon-btn') => `<button type="button" class="${cls}" data-logout title="خروج" aria-label="خروج">${ic('logout', 'flip')}${cls.includes('btn ') ? 'خروج' : ''}</button>`;

function renderShell(active) {
  const role = isAdmin() ? 'admin' : isEmployee() ? 'employee' : '';
  const items = NAV[role] ?? [];
  const nav = $('#tabs');
  document.body.dataset.role = role;
  document.body.classList.toggle('has-nav', items.length > 0);
  nav.hidden = items.length === 0;
  $('.topbar .brand').setAttribute('href', homeHash());
  if ($('#more-sheet').open) $('#more-sheet').close();

  const current = active === 'person' ? 'report' : active;
  const inMore = items.some((i) => !i.primary && i.key === current);
  const who = esc(isAdmin() ? state.me.username : state.me.personName);
  const badge = (kind) => {
    const count = (kind === 'requests' ? state.pendingRequests : state.pendingClaims) || 0;
    return `<span class="tab-badge" data-badge="${kind}"${count ? '' : ' hidden'}>${fa(count)}</span>`;
  };
  const link = (i) => `<a href="#/${i.key}" class="nav-item${i.primary ? '' : ' secondary'}${i.key === current ? ' active' : ''}"${i.key === current ? ' aria-current="page"' : ''}>
      <span class="ic">${ic(i.icon)}</span><span class="lbl">${i.label}</span><span class="lbl-short">${i.short ?? i.label}</span>${i.badge ? badge(i.badge) : ''}</a>`;

  nav.innerHTML = role === 'admin' ? `
    <a class="brand nav-brand" href="${homeHash()}"><img src="/icons/icon.svg" alt=""><span>بوفه</span></a>
    <div class="nav-group" aria-hidden="true">روزانه</div>
    ${items.filter((i) => i.primary).map(link).join('')}
    <div class="nav-group" aria-hidden="true">گزارش و مدیریت</div>
    ${items.filter((i) => !i.primary).map(link).join('')}
    <button type="button" class="nav-item nav-more${inMore ? ' active' : ''}" data-more aria-haspopup="dialog" aria-controls="more-sheet" aria-expanded="false">
      <span class="ic">${ic('menu')}</span><span class="lbl-short">بیشتر</span></button>
    <div class="nav-foot"><span class="who-name"><bdi>${who}</bdi></span>${logoutButton()}
      <button type="button" class="icon-btn" data-theme-toggle></button></div>`
    : items.map(link).join('');

  // «بیشتر» sheet (manager, phones): who is signed in, then the less frequent pages with a line on each.
  $('#more-body').innerHTML = role === 'admin' ? `
    <div class="sheet-user"><span class="avatar">${ic('user')}</span>
      <div class="body"><b><bdi>${who}</bdi></b><span class="muted text-sm">مسئول بوفه</span></div>${logoutButton('btn ghost small')}</div>
    <div class="list">${items.filter((i) => !i.primary).map((i) => `
      <a class="list-row${i.key === current ? ' active' : ''}" href="#/${i.key}"${i.key === current ? ' aria-current="page"' : ''}>
        <div class="icon">${ic(i.icon)}</div>
        <div class="grow"><div class="title">${i.label}</div><div class="sub">${i.hint}</div></div>
        ${ic('chevron-left', 'chev')}</a>`).join('')}</div>` : '';

  $('#account').innerHTML = state.me.loggedIn ? `<span class="muted who-name"><bdi>${who}</bdi></span>${logoutButton()}` : '';
  renderThemeButton();
}

// While a text field has focus the on-screen keyboard needs the room, so the bottom bar steps aside (CSS: body.typing).
{
  const isTextField = (el) => el?.matches?.('textarea, input:not([type="checkbox"], [type="radio"], [type="file"], [type="button"], [type="submit"])');
  document.addEventListener('focusin', (e) => document.body.classList.toggle('typing', !!isTextField(e.target)));
  document.addEventListener('focusout', () => setTimeout(() => document.body.classList.toggle('typing', !!isTextField(document.activeElement)), 0));
}

// «بیشتر»: open from the bar, close on a choice, on the backdrop, with Esc, or by dragging the sheet down.
{
  const sheet = $('#more-sheet');
  const setExpanded = (open) => $('[data-more]')?.setAttribute('aria-expanded', String(open));
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { sheet.showModal(); setExpanded(true); }
  });
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || e.target.closest('a[href]')) sheet.close();
  });
  sheet.addEventListener('close', () => { setExpanded(false); sheet.querySelector('.sheet-panel').style.transform = ''; });
  let startY = null;
  const panel = sheet.querySelector('.sheet-panel');
  sheet.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    const dy = e.touches[0].clientY - (startY ?? e.touches[0].clientY);
    if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', (e) => {
    const dy = e.changedTouches[0].clientY - (startY ?? e.changedTouches[0].clientY);
    startY = null;
    if (dy > 80) sheet.close(); else panel.style.transform = '';
  });
}

async function route() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const key = routes[name] ? name : homeHash().slice(2);
  if (!state.me.loggedIn && key !== 'login') { location.hash = '#/login'; return; }
  if ((adminOnly.has(key) && !isAdmin()) || (employeeOnly.has(key) && !isEmployee())) { location.hash = homeHash(); return; }
  pollRequests();
  const seq = ++routeSeq;
  state.refresh = null;
  state.refreshClaims = null;
  // Fresh element per page so listeners added by the previous view don't pile up.
  const fresh = view.cloneNode(false);
  view.replaceWith(fresh);
  view = fresh;
  renderShell(key);
  try {
    await routes[key](arg, () => seq === routeSeq);
  } catch (err) {
    if (seq === routeSeq) view.innerHTML = `<div class="card">${emptyHtml('alert', esc(err.message))}</div>`;
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
  if (e.target.closest('[data-logout]')) {
    await disablePush().catch(() => {}); // stop this device getting notifications
    lastRequestId = null;
    lastClaimId = null;
    lastReminder = null;
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    await refreshMe();
    location.hash = '#/login';
    route();
  }
});

// ---------- light / dark toggle ----------
const SUN = ic('sun', 'lg');
const MOON = ic('moon', 'lg');
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const currentTheme = () => document.documentElement.dataset.theme || (systemDark.matches ? 'dark' : 'light');

// There can be two toggles (top bar, and the sidebar footer on wide screens); all show the same state.
function renderThemeButton() {
  const dark = currentTheme() === 'dark';
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.innerHTML = dark ? SUN : MOON;
    btn.title = dark ? 'حالت روشن' : 'حالت تاریک';
    btn.setAttribute('aria-label', btn.title);
  });
  document.querySelector('meta[name="theme-color"]').content = dark ? '#151c18' : '#1f7a3a';
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-theme-toggle]')) return;
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

/*
 * NGO donation website API for Netlify Functions.
 * No npm packages: uses Node's crypto and fetch, and stores data in Supabase (Postgres) through its REST API.
 *
 * Environment variables (Netlify > Site configuration > Environment variables):
 *   SUPABASE_URL          e.g. https://abcdxyz.supabase.co
 *   SUPABASE_SERVICE_KEY  the "service_role" secret key (never put it in the website files)
 *   ADMIN_EMAIL           email of the first admin account
 *   ADMIN_PASSWORD        password of the first admin account (min 8 characters)
 */
import crypto from 'node:crypto';

export const config = { path: '/api/*' };

/* ================= errors ================= */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };

/* ================= Supabase REST layer ================= */
function dbConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!url || !key) bad('The server is not set up yet. In Netlify add SUPABASE_URL and SUPABASE_SERVICE_KEY under Site configuration > Environment variables, then deploy again.', 503);
  return { url, key };
}

async function rest(method, table, { params = [], body, prefer, range } = {}) {
  const { url, key } = dbConfig();
  const headers = { apikey: key, Authorization: 'Bearer ' + key };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  if (range) { headers['Range-Unit'] = 'items'; headers.Range = range; }
  let r;
  try {
    r = await fetch(`${url}/rest/v1/${table}${params.length ? '?' + params.join('&') : ''}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    bad('Cannot reach the database. Please check SUPABASE_URL in Netlify.', 502);
  }
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!r.ok) {
    const code = data && data.code;
    console.error('Supabase error', r.status, text.slice(0, 400));
    if (r.status === 401 || r.status === 403) bad('The database key is wrong. Check SUPABASE_SERVICE_KEY in Netlify (use the service_role key).', 503);
    if (code === 'PGRST205' || code === '42P01' || r.status === 404) bad('Database tables are missing. Run supabase-setup.sql in the Supabase SQL Editor.', 503);
    if (code === '23505' || r.status === 409) { const e = new HttpError(409, 'Already exists.'); e.unique = true; throw e; }
    bad('Database error. Please try again.', 500);
  }
  return data;
}
const f = (col, op, val) => `${col}=${op}.${encodeURIComponent(val)}`;

async function select(table, { where = [], cols = '*', order = 'id.asc', limit } = {}) {
  const base = [`select=${cols}`, ...where, `order=${order}`];
  if (limit) return (await rest('GET', table, { params: [...base, `limit=${limit}`] })) || [];
  const out = [];
  for (let from = 0; from < 200000; from += 1000) {
    const rows = (await rest('GET', table, { params: base, range: `${from}-${from + 999}` })) || [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
const one = async (table, where, opts = {}) => (await select(table, { ...opts, where, limit: 1 }))[0] || null;
const insert = async (table, row) => (await rest('POST', table, { body: row, prefer: 'return=representation' }))[0];
const update = async (table, where, patch) => (await rest('PATCH', table, { params: where, body: patch, prefer: 'return=representation' })) || [];
const remove = (table, where) => rest('DELETE', table, { params: where });
const insertIgnore = (table, rows, conflict) => rest('POST', table, { params: [`on_conflict=${conflict}`], body: rows, prefer: 'resolution=ignore-duplicates,return=minimal' });
const upsert = (table, rows, conflict) => rest('POST', table, { params: [`on_conflict=${conflict}`], body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });

/* ================= defaults & seed ================= */
const DEFAULT_SETTINGS = {
  org_name: 'Seva Sankalp Foundation',
  tagline: 'Giving with dignity, one meal, one medicine, one life at a time.',
  hero_title: 'Your small gift becomes someone\'s big relief.',
  hero_text: 'Feed a cow, comfort an elder, buy medicine for a patient. Every rupee you give reaches a real person, and you get a receipt for it.',
  about: 'We are a registered non-profit working for animal welfare, elder care, healthcare, education and disaster relief. Our volunteers verify every cause, and every donation is recorded with the donor\'s name and a receipt.\n\nEdit this text from Admin > Settings.',
  address: 'Your NGO address, City, State, India',
  phone: '+91 00000 00000',
  email: 'contact@example.org',
  reg_info: 'Registered under the Societies / Trust Act. Reg. No. XXXX. PAN: XXXXX. (Edit in Admin > Settings)',
  upi_id: '',
  payee_name: '',
  pay_note: 'Open any UPI app (PhonePe, Google Pay, Paytm, BHIM), scan the QR code, enter the amount you chose and pay. Then type the UPI reference number (UTR) below.',
  auto_approve: '0',
  logo: '',
  qr_image: ''
};
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
const IMAGE_KEYS = new Set(['logo', 'qr_image']);

const SEED_DEPARTMENTS = [
  ['Gaumata Seva', 'Fodder, shelter and medical care for rescued cows and injured cattle.', 'cow', 20, '[20,51,101,501,1100,5100]'],
  ['Vruddhashram (Elder Care)', 'Food, warm clothes, medicines and a safe home for abandoned senior citizens.', 'elder', 20, '[20,101,501,1100,2100,5100]'],
  ['Hospital & Medicine', 'Medicines, tests and treatment for patients who cannot afford them.', 'hospital', 20, '[20,100,500,1000,2500,5000]'],
  ['Annadan (Food for All)', 'Hot, nutritious meals for hungry families and daily-wage workers.', 'food', 20, '[20,50,100,250,500,1000]'],
  ['Child Education', 'School fees, books and uniforms for children from poor families.', 'book', 20, '[20,100,500,1000,2500,5000]'],
  ['Tree Plantation', 'Plant and protect saplings for cleaner air and greener villages.', 'tree', 20, '[20,50,100,500,1000,2000]'],
  ['Disaster Relief', 'Emergency food, shelter and supplies for flood, fire and earthquake victims.', 'relief', 20, '[20,100,500,1000,5000,10000]']
].map((r, i) => ({ name: r[0], description: r[1], icon: r[2], min_amount: r[3], presets: r[4], sort: i + 1 }));
const SEED_PLANS = [
  { name: 'Monthly Member', months: 1, price: 299, perks: 'Member badge on your profile\nMonthly impact update\nPriority receipts', sort: 1 },
  { name: 'Yearly Member', months: 12, price: 2999, perks: 'Everything in Monthly\nSave about 16% compared with monthly\nInvitation to annual NGO event', sort: 2 },
  { name: '3-Year Member', months: 36, price: 7999, perks: 'Everything in Yearly\nBest value for long-term supporters\nName on the NGO supporters board', sort: 3 }
];

let seedPromise = null;
function ready() {
  if (!seedPromise) {
    seedPromise = (async () => {
      dbConfig();
      await insertIgnore('settings', Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })), 'key');
      if (!(await one('departments', [], { cols: 'id' }))) await rest('POST', 'departments', { body: SEED_DEPARTMENTS, prefer: 'return=minimal' });
      if (!(await one('plans', [], { cols: 'id' }))) await rest('POST', 'plans', { body: SEED_PLANS, prefer: 'return=minimal' });
      if (!(await one('users', [f('role', 'eq', 'admin')], { cols: 'id' }))) {
        const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
        const pw = String(process.env.ADMIN_PASSWORD || '');
        if (!validEmail(email) || pw.length < 8) bad('No admin account yet. In Netlify add ADMIN_EMAIL and ADMIN_PASSWORD (at least 8 characters) under Environment variables, then deploy again.', 503);
        try { await insert('users', { name: 'Administrator', email, pass_hash: hashPassword(pw), role: 'admin', created_at: Date.now() }); }
        catch (e) { if (!e.unique) throw e; await update('users', [f('email', 'eq', email)], { role: 'admin' }); }
      }
    })().catch(e => { seedPromise = null; throw e; });
  }
  return seedPromise;
}

/* ================= helpers ================= */
const now = () => Date.now();
const QUOTES = [
  'No one has ever become poor by giving.',
  'The best way to find yourself is to lose yourself in the service of others.',
  'Kindness is the language that the deaf can hear and the blind can see.',
  'What we give today becomes someone\'s tomorrow.',
  'Real wealth is the number of lives you have made lighter.',
  'Small acts, when multiplied by millions of people, can transform the world.',
  'A kind hand opens a closed heart.',
  'Service to humanity is service to God.',
  'Give, even if you only have a little. Hope grows from small gifts.',
  'The hands that help are holier than the lips that pray.',
  'Be the reason someone believes in goodness today.',
  'Charity is not an expense. It is an investment in humanity.'
];
const quoteFor = id => QUOTES[Math.abs(Number(id) || 0) % QUOTES.length];
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const validEmail = e => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const a = Buffer.from(crypto.scryptSync(pw, salt, 64).toString('hex'));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function cleanStr(v, max, field) {
  const s = String(v ?? '').trim();
  if (s.length > max) bad(`${field} is too long (max ${max} characters).`);
  return s;
}
function dataUrlOk(v) { return v === '' || (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 3_000_000); }
function parsePresets(v) {
  let arr = Array.isArray(v) ? v : String(v || '').split(/[,\s]+/);
  arr = arr.map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= 10_000_000);
  return JSON.stringify([...new Set(arr)].sort((a, b) => a - b).slice(0, 8));
}
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/* ================= sessions (signed cookie, no session table) ================= */
const b64u = b => Buffer.from(b).toString('base64url');
const sign = payload => crypto.createHmac('sha256', 'ngo-session:' + dbConfig().key).update(payload).digest('base64url');
function makeToken(u) {
  const payload = b64u(JSON.stringify({ u: u.id, e: now() + 30 * 86400_000, h: sha(u.pass_hash).slice(0, 16) }));
  return payload + '.' + sign(payload);
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip */ } }
  }
  return out;
}
async function currentUser(ctx) {
  const token = parseCookies(ctx.req).sid;
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const want = sign(payload);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  let d; try { d = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!d || d.e < now()) return null;
  const u = await one('users', [f('id', 'eq', d.u)]);
  if (!u || sha(u.pass_hash).slice(0, 16) !== d.h) return null;
  return u;
}
function startSession(ctx, user) {
  ctx.cookies.push(`sid=${makeToken(user)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${ctx.secure ? '; Secure' : ''}`);
}
function endSession(ctx) { ctx.cookies.push(`sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${ctx.secure ? '; Secure' : ''}`); }

/* simple per-instance rate limit (slows down guessing; not a hard guarantee on serverless) */
const hits = new Map();
function rateLimit(ctx, bucket, limit, windowMs) {
  const key = bucket + ':' + ctx.ip, t = now();
  const arr = (hits.get(key) || []).filter(x => t - x < windowMs);
  arr.push(t); hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  if (arr.length > limit) bad('Too many attempts. Please wait a few minutes and try again.', 429);
}

/* ================= data shapes ================= */
async function memberInfo(userId) {
  const rows = await select('payments', { where: [f('user_id', 'eq', userId), f('kind', 'eq', 'membership'), f('status', 'eq', 'approved')], cols: 'ends_at', order: 'id.asc' });
  const ends = rows.reduce((m, r) => Math.max(m, r.ends_at || 0), 0);
  return { active: ends > now(), ends: ends || null };
}
async function userShape(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, phone: u.phone || '', country: u.country || '', role: u.role, member: await memberInfo(u.id) };
}
const deptShape = d => ({ ...d, presets: JSON.parse(d.presets || '[]'), active: !!d.active });
const planShape = p => ({ ...p, active: !!p.active });
const paymentShape = p => ({ ...p, anonymous: !!p.anonymous, quote: quoteFor(p.id) });

async function getSettings() {
  const out = {};
  for (const r of await select('settings', { order: 'key.asc' })) out[r.key] = r.value;
  return out;
}

/* approved donations are read often: keep them in memory for a minute */
let cache = { at: 0, rows: [] };
const bust = () => { cache.at = 0; };
async function approvedDonations() {
  if (now() - cache.at > 60_000) {
    cache = { at: now(), rows: await select('payments', { where: [f('kind', 'eq', 'donation'), f('status', 'eq', 'approved')], cols: 'id,user_id,donor_name,anonymous,label,amount,created_at', order: 'id.asc' }) };
  }
  return cache.rows;
}

async function approvePayment(p) {
  let starts = null, ends = null;
  if (p.kind === 'membership') {
    const plan = await one('plans', [f('id', 'eq', p.plan_id)], { cols: 'months' });
    const cur = await memberInfo(p.user_id);
    const start = new Date(Math.max(now(), cur.ends || 0));
    const end = new Date(start);
    end.setMonth(end.getMonth() + (plan ? plan.months : 1));
    starts = start.getTime(); ends = end.getTime();
  }
  await update('payments', [f('id', 'eq', p.id)], { status: 'approved', reviewed_at: now(), starts_at: starts, ends_at: ends });
  bust();
}

const need = u => { if (!u) bad('Please log in first.', 401); return u; };
const needAdmin = u => { need(u); if (u.role !== 'admin') bad('Admin access only.', 403); return u; };

async function readJson(ctx) {
  if (!String(ctx.req.headers.get('content-type') || '').includes('application/json')) bad('JSON body required.', 415);
  const text = await ctx.req.text();
  if (text.length > 6_000_000) bad('Request too large.', 413);
  try { return JSON.parse(text || '{}'); } catch { return bad('Invalid JSON.'); }
}

/* ================= routes ================= */
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler });

route('GET', '/public', async () => {
  const don = await approvedDonations();
  const [settings, depts, plans] = await Promise.all([
    getSettings(),
    select('departments', { where: [f('active', 'eq', 1)], order: 'sort.asc,id.asc' }),
    select('plans', { where: [f('active', 'eq', 1)], order: 'sort.asc,id.asc' })
  ]);
  return {
    settings,
    departments: depts.map(deptShape),
    plans: plans.map(planShape),
    stats: { total: don.reduce((a, r) => a + r.amount, 0), count: don.length, donors: new Set(don.map(r => r.user_id)).size }
  };
});

route('GET', '/donors', async () => {
  const don = await approvedDonations();
  const recent = [...don].reverse().slice(0, 40)
    .map(r => ({ id: r.id, name: r.anonymous ? 'Anonymous donor' : r.donor_name, label: r.label, amount: r.amount, created_at: r.created_at }));
  const by = new Map();
  for (const r of don) {
    if (r.anonymous) continue;
    const e = by.get(r.user_id) || { name: r.donor_name, total: 0, count: 0 };
    e.name = r.donor_name; e.total += r.amount; e.count++;
    by.set(r.user_id, e);
  }
  return { recent, top: [...by.values()].sort((a, b) => b.total - a.total).slice(0, 10) };
});

route('POST', '/register', async ctx => {
  rateLimit(ctx, 'auth', 20, 900_000);
  const b = await readJson(ctx);
  const name = cleanStr(b.name, 80, 'Name');
  const email = cleanStr(b.email, 120, 'Email').toLowerCase();
  const phone = cleanStr(b.phone, 25, 'Phone');
  const country = cleanStr(b.country, 60, 'Country');
  const password = String(b.password || '');
  if (name.length < 2) bad('Please enter your full name.');
  if (!validEmail(email)) bad('Please enter a valid email address.');
  if (password.length < 8 || password.length > 100) bad('Password must be at least 8 characters.');
  let u;
  try { u = await insert('users', { name, email, phone, country, pass_hash: hashPassword(password), created_at: now() }); }
  catch (e) { if (e.unique) bad('This email is already registered. Please log in.', 409); throw e; }
  startSession(ctx, u);
  return { user: await userShape(u) };
});

route('POST', '/login', async ctx => {
  rateLimit(ctx, 'auth', 20, 900_000);
  const b = await readJson(ctx);
  const u = await one('users', [f('email', 'eq', String(b.email || '').trim().toLowerCase())]);
  if (!u || !verifyPassword(String(b.password || ''), u.pass_hash)) bad('Wrong email or password.', 401);
  startSession(ctx, u);
  return { user: await userShape(u) };
});

route('POST', '/logout', async ctx => { endSession(ctx); return { ok: true }; });
route('GET', '/me', async (ctx, user) => ({ user: await userShape(user) }));

route('PUT', '/me', async (ctx, user) => {
  need(user);
  const b = await readJson(ctx);
  const name = cleanStr(b.name, 80, 'Name');
  if (name.length < 2) bad('Please enter your full name.');
  const patch = { name, phone: cleanStr(b.phone, 25, 'Phone'), country: cleanStr(b.country, 60, 'Country') };
  if (b.new_password) {
    if (!verifyPassword(String(b.old_password || ''), user.pass_hash)) bad('Current password is wrong.');
    if (String(b.new_password).length < 8) bad('New password must be at least 8 characters.');
    patch.pass_hash = hashPassword(String(b.new_password));
  }
  const [u] = await update('users', [f('id', 'eq', user.id)], patch);
  if (patch.pass_hash) startSession(ctx, u); // keep this device logged in
  return { user: await userShape(u) };
});

route('POST', '/pay', async (ctx, user) => {
  need(user);
  rateLimit(ctx, 'pay', 30, 3600_000);
  const b = await readJson(ctx);
  const kind = b.kind === 'membership' ? 'membership' : 'donation';
  const utr = String(b.utr || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,30}$/.test(utr)) bad('Please enter the UPI reference number (UTR) from your payment. It has 6 to 30 letters or digits.');
  if (await one('payments', [f('utr', 'eq', utr), f('status', 'neq', 'rejected')], { cols: 'id' })) bad('This reference number was already used. Please check it and try again.', 409);
  const message = cleanStr(b.message, 300, 'Message');
  let label, amount, deptId = null, planId = null;
  if (kind === 'donation') {
    const d = await one('departments', [f('id', 'eq', Number(b.department_id)), f('active', 'eq', 1)]);
    if (!d) bad('Please choose a cause to donate to.');
    amount = Number(b.amount);
    if (!Number.isInteger(amount) || amount < d.min_amount) bad(`Minimum donation for ${d.name} is ₹${d.min_amount}.`);
    if (amount > 10_000_000) bad('Please contact us directly for donations above ₹1 crore.');
    label = d.name; deptId = d.id;
  } else {
    const p = await one('plans', [f('id', 'eq', Number(b.plan_id)), f('active', 'eq', 1)]);
    if (!p) bad('Please choose a membership plan.');
    amount = p.price; label = /member/i.test(p.name) ? p.name : p.name + ' membership'; planId = p.id;
  }
  let row;
  try {
    row = await insert('payments', {
      kind, user_id: user.id, donor_name: user.name, donor_email: user.email, department_id: deptId, plan_id: planId,
      label, amount, utr, message, anonymous: b.anonymous ? 1 : 0, status: 'pending', created_at: now()
    });
  } catch (e) { if (e.unique) bad('This reference number was already used. Please check it and try again.', 409); throw e; }
  const receipt = (kind === 'donation' ? 'DON-' : 'MEM-') + new Date().getFullYear() + '-' + String(row.id).padStart(5, '0');
  [row] = await update('payments', [f('id', 'eq', row.id)], { receipt_no: receipt });
  const settings = await getSettings();
  if (settings.auto_approve === '1') { await approvePayment(row); row = await one('payments', [f('id', 'eq', row.id)]); }
  return { payment: paymentShape(row), user: await userShape(user) };
});

route('GET', '/my/payments', async (ctx, user) => {
  need(user);
  return { payments: (await select('payments', { where: [f('user_id', 'eq', user.id)], order: 'id.desc' })).map(paymentShape) };
});

route('GET', '/payments/:id', async (ctx, user, params) => {
  need(user);
  const p = await one('payments', [f('id', 'eq', Number(params.id) || 0)]);
  if (!p || (p.user_id !== user.id && user.role !== 'admin')) bad('Receipt not found.', 404);
  return { payment: paymentShape(p) };
});

/* ---- admin ---- */
route('GET', '/admin/summary', async (ctx, user) => {
  needAdmin(user);
  const [ap, pend, users] = await Promise.all([
    select('payments', { where: [f('status', 'eq', 'approved')], cols: 'amount,kind,label,created_at,user_id,ends_at' }),
    select('payments', { where: [f('status', 'eq', 'pending')], cols: 'amount,id' }),
    select('users', { cols: 'id' })
  ]);
  const sum = rows => ({ s: rows.reduce((a, r) => a + r.amount, 0), c: rows.length });
  const dons = ap.filter(r => r.kind === 'donation'), mems = ap.filter(r => r.kind === 'membership');
  const causes = new Map();
  for (const r of dons) { const e = causes.get(r.label) || { label: r.label, total: 0, count: 0 }; e.total += r.amount; e.count++; causes.set(r.label, e); }
  const IST = 19800_000, days = [];
  for (let i = 13; i >= 0; i--) days.push(new Date(now() + IST - i * 86400_000).toISOString().slice(0, 10));
  const map = Object.fromEntries(days.map(d => [d, 0]));
  for (const r of ap) { const k = new Date(r.created_at + IST).toISOString().slice(0, 10); if (k in map) map[k] += r.amount; }
  return {
    total: sum(ap), donations: sum(dons), memberships: sum(mems),
    pending: { c: pend.length, s: pend.reduce((a, r) => a + r.amount, 0) },
    users: users.length,
    activeMembers: new Set(mems.filter(r => r.ends_at > now()).map(r => r.user_id)).size,
    byCause: [...causes.values()].sort((a, b) => b.total - a.total),
    daily: days.map(d => ({ day: d, total: map[d] }))
  };
});

route('GET', '/admin/payments', async (ctx, user) => {
  needAdmin(user);
  const q = ctx.url.searchParams, where = [];
  if (['pending', 'approved', 'rejected'].includes(q.get('status'))) where.push(f('status', 'eq', q.get('status')));
  if (['donation', 'membership'].includes(q.get('kind'))) where.push(f('kind', 'eq', q.get('kind')));
  const s = (q.get('q') || '').trim().toLowerCase();
  let rows = await select('payments', { where, order: 'id.desc', limit: s ? 3000 : 500 });
  if (s) rows = rows.filter(p => [p.donor_name, p.donor_email, p.utr, p.receipt_no].some(v => String(v || '').toLowerCase().includes(s)));
  return { payments: rows.slice(0, 500).map(paymentShape) };
});

route('PATCH', '/admin/payments/:id', async (ctx, user, params) => {
  needAdmin(user);
  const b = await readJson(ctx);
  const p = await one('payments', [f('id', 'eq', Number(params.id) || 0)]);
  if (!p) bad('Payment not found.', 404);
  if (b.status === 'approved') await approvePayment(p);
  else if (b.status === 'rejected' || b.status === 'pending') {
    try { await update('payments', [f('id', 'eq', p.id)], { status: b.status, reviewed_at: now(), starts_at: null, ends_at: null }); }
    catch (e) { if (e.unique) bad('Another payment already uses this reference number.', 409); throw e; }
    bust();
  } else bad('Invalid status.');
  return { payment: paymentShape(await one('payments', [f('id', 'eq', p.id)])) };
});

route('GET', '/admin/export.csv', async (ctx, user) => {
  needAdmin(user);
  const rows = await select('payments', { order: 'id.asc' });
  const head = ['Receipt', 'Date', 'Type', 'Donor', 'Email', 'Cause / Plan', 'Amount (INR)', 'UTR', 'Status', 'Anonymous', 'Message'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) lines.push([r.receipt_no, new Date(r.created_at).toISOString(), r.kind, r.donor_name, r.donor_email, r.label, r.amount, r.utr, r.status, r.anonymous ? 'yes' : 'no', r.message].map(csvCell).join(','));
  return { __raw: '﻿' + lines.join('\r\n'), type: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': 'attachment; filename="donations.csv"' } };
});

route('GET', '/admin/users', async (ctx, user) => {
  needAdmin(user);
  const [users, ap] = await Promise.all([
    select('users', { cols: 'id,name,email,phone,country,role,created_at', order: 'id.desc', limit: 1000 }),
    select('payments', { where: [f('status', 'eq', 'approved')], cols: 'user_id,kind,amount,ends_at' })
  ]);
  return {
    users: users.map(u => {
      const mine = ap.filter(r => r.user_id === u.id);
      const ends = mine.filter(r => r.kind === 'membership').reduce((m, r) => Math.max(m, r.ends_at || 0), 0);
      return { ...u, donated: mine.filter(r => r.kind === 'donation').reduce((a, r) => a + r.amount, 0), member: { active: ends > now(), ends: ends || null } };
    })
  };
});

route('PATCH', '/admin/users/:id', async (ctx, user, params) => {
  needAdmin(user);
  const b = await readJson(ctx);
  const target = await one('users', [f('id', 'eq', Number(params.id) || 0)]);
  if (!target) bad('User not found.', 404);
  const patch = {};
  if (b.password !== undefined) {
    if (String(b.password).length < 8) bad('Password must be at least 8 characters.');
    patch.pass_hash = hashPassword(String(b.password));
  }
  if (b.role !== undefined) {
    if (!['user', 'admin'].includes(b.role)) bad('Invalid role.');
    if (target.id === user.id && b.role !== 'admin') bad('You cannot remove your own admin access.');
    patch.role = b.role;
  }
  if (Object.keys(patch).length) await update('users', [f('id', 'eq', target.id)], patch);
  return { ok: true };
});

route('GET', '/admin/departments', async (ctx, user) => {
  needAdmin(user);
  return { departments: (await select('departments', { order: 'sort.asc,id.asc' })).map(deptShape) };
});
route('GET', '/admin/plans', async (ctx, user) => {
  needAdmin(user);
  return { plans: (await select('plans', { order: 'sort.asc,id.asc' })).map(planShape) };
});

function deptFields(b) {
  const name = cleanStr(b.name, 80, 'Name');
  if (!name) bad('Cause name is required.');
  const min = Number(b.min_amount);
  if (!Number.isInteger(min) || min < 1 || min > 1_000_000) bad('Minimum amount must be a whole number of rupees (1 or more).');
  const image = String(b.image || '');
  if (!dataUrlOk(image)) bad('Image must be a PNG, JPG or WebP under 2 MB.');
  return {
    name, description: cleanStr(b.description, 400, 'Description'),
    icon: ['cow', 'elder', 'hospital', 'food', 'book', 'tree', 'relief', 'heart'].includes(b.icon) ? b.icon : 'heart',
    image, min_amount: min, presets: parsePresets(b.presets), active: b.active ? 1 : 0, sort: Math.trunc(Number(b.sort)) || 0
  };
}
route('POST', '/admin/departments', async (ctx, user) => {
  needAdmin(user);
  return { department: deptShape(await insert('departments', deptFields(await readJson(ctx)))) };
});
route('PUT', '/admin/departments/:id', async (ctx, user, params) => {
  needAdmin(user);
  const rows = await update('departments', [f('id', 'eq', Number(params.id) || 0)], deptFields(await readJson(ctx)));
  if (!rows.length) bad('Cause not found.', 404);
  return { ok: true };
});
route('DELETE', '/admin/departments/:id', async (ctx, user, params) => {
  needAdmin(user);
  const id = Number(params.id) || 0;
  if (await one('payments', [f('department_id', 'eq', id)], { cols: 'id' })) { await update('departments', [f('id', 'eq', id)], { active: 0 }); return { ok: true, hidden: true }; }
  await remove('departments', [f('id', 'eq', id)]);
  return { ok: true };
});

function planFields(b) {
  const name = cleanStr(b.name, 80, 'Name');
  if (!name) bad('Plan name is required.');
  const months = Number(b.months), price = Number(b.price);
  if (!Number.isInteger(months) || months < 1 || months > 120) bad('Duration must be 1 to 120 months.');
  if (!Number.isInteger(price) || price < 1 || price > 10_000_000) bad('Price must be a whole number of rupees.');
  return { name, months, price, perks: cleanStr(b.perks, 600, 'Benefits'), active: b.active ? 1 : 0, sort: Math.trunc(Number(b.sort)) || 0 };
}
route('POST', '/admin/plans', async (ctx, user) => {
  needAdmin(user);
  return { plan: planShape(await insert('plans', planFields(await readJson(ctx)))) };
});
route('PUT', '/admin/plans/:id', async (ctx, user, params) => {
  needAdmin(user);
  const rows = await update('plans', [f('id', 'eq', Number(params.id) || 0)], planFields(await readJson(ctx)));
  if (!rows.length) bad('Plan not found.', 404);
  return { ok: true };
});
route('DELETE', '/admin/plans/:id', async (ctx, user, params) => {
  needAdmin(user);
  const id = Number(params.id) || 0;
  if (await one('payments', [f('plan_id', 'eq', id)], { cols: 'id' })) { await update('plans', [f('id', 'eq', id)], { active: 0 }); return { ok: true, hidden: true }; }
  await remove('plans', [f('id', 'eq', id)]);
  return { ok: true };
});

route('PUT', '/admin/settings', async (ctx, user) => {
  needAdmin(user);
  const b = await readJson(ctx), rows = [];
  for (const k of SETTING_KEYS) {
    if (!(k in b)) continue;
    let v = String(b[k] ?? '');
    if (IMAGE_KEYS.has(k)) { if (!dataUrlOk(v)) bad('Logo / QR must be a PNG, JPG or WebP image under 2 MB.'); }
    else if (k === 'auto_approve') v = v === '1' || v === 'true' ? '1' : '0';
    else v = cleanStr(v, k === 'about' || k === 'hero_text' || k === 'pay_note' ? 3000 : 400, k);
    rows.push({ key: k, value: v });
  }
  if (rows.length) await upsert('settings', rows, 'key');
  return { settings: await getSettings() };
});

/* ================= entry point ================= */
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store'
};

export default async function handler(req) {
  const url = new URL(req.url);
  const respond = (status, body, extra = {}, cookies = []) => {
    const h = new Headers({ 'Content-Type': 'application/json; charset=utf-8', ...SECURITY, ...extra });
    for (const c of cookies) h.append('Set-Cookie', c);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: h });
  };
  const ctx = {
    req, url, cookies: [], secure: url.protocol === 'https:',
    ip: String(req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim()
  };
  try {
    const path = (url.pathname.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '') || '/').replace(/\/+$/, '') || '/';
    const match = routes.find(r => r.method === req.method && r.re.test(path));
    if (!match) return respond(404, { error: 'Not found.' });
    await ready();
    const user = await currentUser(ctx);
    const out = await match.handler(ctx, user, match.re.exec(path).groups || {});
    if (out && out.__raw !== undefined) return respond(200, out.__raw, { 'Content-Type': out.type, ...(out.headers || {}) }, ctx.cookies);
    return respond(200, out, {}, ctx.cookies);
  } catch (e) {
    if (e instanceof HttpError) return respond(e.status, { error: e.message }, {}, ctx.cookies);
    console.error(e);
    return respond(500, { error: 'Server error. Please try again.' });
  }
}

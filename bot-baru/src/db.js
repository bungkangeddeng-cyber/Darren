// SQLite bot-baru — tabel jualan saja (tanpa CF/Zivpn/Sidompul/Pakasir).
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const config = require('./config');

function openDb(dbPath) {
  const p = dbPath || config.dbPath;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const db = new sqlite3.Database(p);
  const run = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function (e) { e ? rej(e) : res({ id: this.lastID, changes: this.changes }); }));
  const get = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (e, r) => e ? rej(e) : res(r)));
  const all = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => e ? rej(e) : res(r)));
  return { db, run, get, all };
}
const { db, run, get, all } = openDb();

const DEFAULT_PRICE_PER_DAY = { member: 500, reseller: 450 };
const PRODUCTS = [
  { key: 'ssh', label: 'SSH' },
  { key: 'vmess', label: 'VMess' },
  { key: 'vless', label: 'VLess' },
  { key: 'trojan', label: 'Trojan' },
  { key: 'shadowsocks', label: 'Shadowsocks' },
];

async function init() {
  await run(`CREATE TABLE IF NOT EXISTS users (telegram_id INTEGER PRIMARY KEY, username TEXT, saldo INTEGER DEFAULT 0, role TEXT DEFAULT 'member', created_at TEXT DEFAULT (datetime('now')))`);
  await run(`CREATE TABLE IF NOT EXISTS vpn_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER, proto TEXT, username TEXT, expiry TEXT, is_trial INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`);
// Migrasi akun Xray (2026-11-02): simpan kredensial + link agar tombol
// export Clash/V2Ray di pesan akun bisa dipakai ulang, dan akun lama
// (tanpa kolom ini) tetap jalan — export-nya akan menolak dengan jelas.
  for (const col of ['uuid TEXT', 'password TEXT', 'link_tls TEXT', 'link_http TEXT', 'link_grpc TEXT', 'save_url TEXT', 'iplimit INTEGER DEFAULT 2', 'locked INTEGER DEFAULT 0']) {
    try { await run(`ALTER TABLE vpn_accounts ADD COLUMN ${col}`); } catch {}
  }
  await run(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER, type TEXT, amount INTEGER, ref_id TEXT, status TEXT DEFAULT 'success', note TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`);
  await run(`CREATE TABLE IF NOT EXISTS deposits (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER, amount INTEGER, status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')))`);
// Migrasi deposit QRIS gateway (2026-11-02): reference -> user, agar webhook
// payment.success bisa auto-credit tanpa menebak. ALTER gagal bila kolom
// sudah ada — itu normal, abaikan.
  for (const col of ['reference TEXT', 'qris_id TEXT', 'trx_id TEXT', 'qris_url TEXT', 'expires_at TEXT']) {
    try { await run(`ALTER TABLE deposits ADD COLUMN ${col}`); } catch {}
  }
  await run(`CREATE TABLE IF NOT EXISTS vpn_prices (product_key TEXT NOT NULL, role TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (product_key, role))`);
  await run(`CREATE TABLE IF NOT EXISTS trial_claims (telegram_id INTEGER PRIMARY KEY, claimed_at TEXT DEFAULT (datetime('now')))`);
  // PPOB PRODUCTS (2026-11-02): katalog hasil SYNC Digiflazz, bukan
  // sekadar price-list live tiap order. Admin bisa sync, lihat per
  // kategori, nonaktifkan produk, dan set harga jual per SKU. User
  // membeli dari katalog ini (fallback live bila katalog masih kosong).
  await run(`CREATE TABLE IF NOT EXISTS ppob_products (buyer_sku_code TEXT PRIMARY KEY, product_name TEXT, category TEXT, brand TEXT, type TEXT DEFAULT 'prepaid', price INTEGER DEFAULT 0, price_sell INTEGER DEFAULT 0, price_sell_custom INTEGER, enabled INTEGER DEFAULT 1, buyer_product_status INTEGER DEFAULT 1, updated_at TEXT DEFAULT (datetime('now')))`);
  // PPOB: ref_id disimpan SEBELUM kirim ke Digiflazz, dipakai lagi
  // (sama persis) untuk cek status/retry. UNIQUE mencegah duplikasi.
  await run(`CREATE TABLE IF NOT EXISTS ppob_orders (ref_id TEXT PRIMARY KEY, telegram_id INTEGER, sku TEXT, product_name TEXT, customer_no TEXT, price_sell INTEGER, status TEXT DEFAULT 'pending', locked INTEGER DEFAULT 0, last_checked_at TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  for (const p of PRODUCTS) for (const role of ['member', 'reseller']) {
    await run('INSERT OR IGNORE INTO vpn_prices (product_key, role, price) VALUES (?,?,?)', [p.key, role, DEFAULT_PRICE_PER_DAY[role]]);
  }
  // Server terdaftar di DB (bukan angka karangan). Server lokal ini
  // dicatat bila domain sudah dikonfigurasi; bila belum, jumlahnya 0.
  await run(`CREATE TABLE IF NOT EXISTS servers (id INTEGER PRIMARY KEY, domain TEXT, api_base TEXT)`);
  if (config.vpn.domain) {
    await run('INSERT OR IGNORE INTO servers (id, domain, api_base) VALUES (1,?,?)', [config.vpn.domain, config.vpn.apiBase]);
  }
}
async function getServerCount() { const r = await get('SELECT COUNT(*) c FROM servers', []); return r ? r.c : 0; }
async function getHistory(id, limit = 15) {
  const tx = await all('SELECT created_at, type, amount, note, status FROM transactions WHERE telegram_id=? ORDER BY id DESC LIMIT ?', [id, limit]);
  const pp = await all('SELECT created_at, sku, product_name, customer_no, price_sell, status FROM ppob_orders WHERE telegram_id=? ORDER BY rowid DESC LIMIT ?', [id, limit]);
  const rows = [
    ...tx.map(t => ({ created_at: t.created_at, kind: t.type, amount: t.amount, note: t.note || '', status: t.status || '' })),
    ...pp.map(p => ({ created_at: p.created_at, kind: 'ppob', amount: -Number(p.price_sell || 0), note: `${p.product_name} -> ${p.customer_no}`, status: p.status || '' })),
  ];
  rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return rows.slice(0, limit);
}
async function getUserStats(id) {
  const vpnActive = await get(`SELECT COUNT(*) c FROM vpn_accounts WHERE telegram_id=? AND expiry >= date('now')`, [id]);
  const vpnTotal = await get('SELECT COUNT(*) c FROM vpn_accounts WHERE telegram_id=?', [id]);
  const tx = await get('SELECT COUNT(*) c FROM transactions WHERE telegram_id=?', [id]);
  const pp = await get('SELECT COUNT(*) c FROM ppob_orders WHERE telegram_id=?', [id]);
  return { vpnActive: vpnActive?.c || 0, vpnTotal: vpnTotal?.c || 0, transactions: tx?.c || 0, ppobOrders: pp?.c || 0 };
}
async function getGlobalStats() {
  const u = await get('SELECT COUNT(*) c, COALESCE(SUM(saldo),0) s FROM users', []);
  const a = await get('SELECT COUNT(*) c FROM vpn_accounts', []);
  const aActive = await get(`SELECT COUNT(*) c FROM vpn_accounts WHERE expiry >= date('now')`, []);
  const t = await get('SELECT COUNT(*) c FROM transactions', []);
  const pp = await get('SELECT COUNT(*) c FROM ppob_orders', []);
  return { users: u?.c || 0, totalSaldo: u?.s || 0, accounts: a?.c || 0, accountsActive: aActive?.c || 0, transactions: t?.c || 0, ppobOrders: pp?.c || 0, servers: await getServerCount() };
}
async function ensureUser(id, username) {
  await run('INSERT OR IGNORE INTO users (telegram_id, username) VALUES (?,?)', [id, username || '']);
  if (username) await run('UPDATE users SET username=? WHERE telegram_id=?', [username, id]);
  return get('SELECT * FROM users WHERE telegram_id=?', [id]);
}
async function getBalance(id) { const r = await get('SELECT saldo FROM users WHERE telegram_id=?', [id]); return r ? r.saldo : 0; }
async function addBalance(id, amount, note = '') {
  await ensureUser(id, '');
  await run('UPDATE users SET saldo = saldo + ? WHERE telegram_id=?', [amount, id]);
  await run('INSERT INTO transactions (telegram_id, type, amount, ref_id, status, note) VALUES (?,?,?,?,?,?)', [id, 'deposit', amount, 'dep-' + Date.now(), 'success', note]);
  return getBalance(id);
}
// Potong saldo hanya bila cukup; kembalikan false bila tidak cukup (tanpa utang).
async function deductBalance(id, amount, note = '') {
  const cur = await getBalance(id);
  if (cur < amount) return false;
  await run('UPDATE users SET saldo = saldo - ? WHERE telegram_id=?', [amount, id]);
  await run('INSERT INTO transactions (telegram_id, type, amount, ref_id, status, note) VALUES (?,?,?,?,?,?)', [id, 'beli', -amount, 'buy-' + Date.now(), 'success', note]);
  return true;
}
async function getPrice(productKey, role) {
  if (role === 'admin') return 0;
  const r = await get('SELECT price FROM vpn_prices WHERE product_key=? AND role=?', [productKey, role === 'reseller' ? 'reseller' : 'member']);
  return r ? Number(r.price) : DEFAULT_PRICE_PER_DAY.member;
}
async function setPrice(productKey, role, price) {
  if (!PRODUCTS.some(p => p.key === productKey)) throw new Error('Produk tidak dikenal: ' + productKey);
  if (!['member', 'reseller'].includes(role)) throw new Error('Role harga hanya member/reseller');
  price = Math.round(Number(price));
  if (!Number.isFinite(price) || price < 0) throw new Error('Harga tidak valid');
  await run('INSERT OR IGNORE INTO vpn_prices (product_key, role, price) VALUES (?,?,?)', [productKey, role, price]);
  await run('UPDATE vpn_prices SET price=? WHERE product_key=? AND role=?', [price, productKey, role]);
  return price;
}
async function canClaimTrial(id) {
  const r = await get(`SELECT claimed_at FROM trial_claims WHERE telegram_id=? AND claimed_at > datetime('now','-24 hours')`, [id]);
  return !r;
}
async function recordTrialClaim(id) { await run('INSERT OR REPLACE INTO trial_claims (telegram_id, claimed_at) VALUES (?, datetime(\'now\'))', [id]); }

module.exports = { db, run, get, all, init, ensureUser, getBalance, addBalance, deductBalance, getPrice, setPrice, canClaimTrial, recordTrialClaim, getServerCount, getHistory, getUserStats, getGlobalStats, PRODUCTS, DEFAULT_PRICE_PER_DAY, openDb };

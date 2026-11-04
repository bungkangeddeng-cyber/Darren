// ============================================================
// Modul Sewa Script VPN — paket, bayar QRIS, aktivasi lisensi
// Alur: pilih paket -> bayar QRIS (gateway H2H milik sendiri) ->
//        input username+IP -> order pending -> fulfillment cron
//        aktivasi lisensi
// ============================================================
const crypto = require('crypto');
const config = require('../src/config');
const h2h = require('../src/h2h');
const digi = require('../src/digiflazz');
const { run, get, all } = require('../src/db');

const PACKAGES = [
  { days: 30, price: 10000 },
  { days: 60, price: 20000 },
  { days: 90, price: 30000 },
];

const refId = (prefix = 'SEWA') =>
  `${prefix}${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

async function initTable() {
  await run(`CREATE TABLE IF NOT EXISTS sewa_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER,
    username TEXT,
    ip TEXT,
    days INTEGER,
    amount INTEGER,
    payment_ref TEXT UNIQUE,
    payment_id TEXT,
    status TEXT DEFAULT 'pending',
    expiry TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  // FASE 1: penanda notifikasi mismatch (pesan ke user cukup sekali,
  // status tetap pending untuk tindak lanjut manual).
  await run(`ALTER TABLE sewa_orders ADD COLUMN mismatch_notified INTEGER DEFAULT 0`).catch(() => {});
}

// ---------- Buat order sewa + QRIS ----------
async function createSewaOrder(telegramId, username, ip, days) {
  const pkg = PACKAGES.find((p) => p.days === days);
  if (!pkg) return { success: false, message: '❌ Paket tidak valid.' };
  const { apiKey } = config.h2h;
  if (!apiKey) return { success: false, message: '❌ Gateway QRIS belum dikonfigurasi.' };

  const ref = refId('SEWA');
  const r = await h2h.createQris(pkg.price, ref);
  if (!r.success) return { success: false, message: r.message };

  await run(
    `INSERT INTO sewa_orders (telegram_id, username, ip, days, amount, payment_ref, payment_id, status)
     VALUES (?,?,?,?,?,?,?,?)`,
    [telegramId, username, ip, days, pkg.price, ref, r.qrisId, 'pending']
  );

  return {
    success: true, ref, paymentId: r.qrisId,
    amount: pkg.price, uniqueAmount: r.uniqueAmount,
    days, username, ip, qrBuffer: r.qrBuffer, qrUrl: r.qrUrl,
  };
}

// ---------- Cek status pembayaran sewa di gateway H2H ----------
// Kembalikan { status, paidAmount }; status 'unknown' bila gateway tak
// menjawab (pemanggil harus melewati putaran ini, bukan mengubah status).
async function checkSewaPayment(paymentId) {
  const r = await h2h.getQrisStatus(paymentId);
  if (!r.ok) return { status: 'unknown', paidAmount: null };
  return { status: r.status, paidAmount: r.paidAmount };
}

// Klaim atomik: hanya order yang masih 'pending' yang berpindah ke 'paid'.
// Kembalikan jumlah baris berubah (0 = sudah diproses putaran lain).
async function markSewaPaid(ref) {
  const r = await run(`UPDATE sewa_orders SET status = 'paid' WHERE payment_ref = ? AND status = 'pending'`, [ref]);
  return r.changes || 0;
}

async function markSewaExpired(ref) {
  const r = await run(`UPDATE sewa_orders SET status = 'expired' WHERE payment_ref = ? AND status = 'pending'`, [ref]);
  return r.changes || 0;
}

// FASE 1: tandai order untuk pemeriksaan manual (paid tanpa nominal yang
// bisa diverifikasi). Poller hanya memproses status pending, jadi order
// review berhenti dipoller sampai admin menindaklanjuti.
async function markSewaReview(ref) {
  const r = await run(`UPDATE sewa_orders SET status = 'review' WHERE payment_ref = ? AND status = 'pending'`, [ref]);
  return r.changes || 0;
}

async function markSewaFulfilled(ref, expiry) {
  // FASE 1: hanya dari status paid — jangan menimpa review/expired.
  await run(`UPDATE sewa_orders SET status = 'fulfilled', expiry = ? WHERE payment_ref = ? AND status = 'paid'`, [expiry, ref]);
}

// FASE 2: resolve manual oleh admin (lihat app.js adm_review).
// Klaim guarded: review -> paid, atau pending+mismatch -> paid. Setelah
// paid, fulfillment cron yang sudah ada (pendingSewaOrders) mengaktifkan
// lisensi; tolak -> rejected (poller berhenti memproses keduanya).
async function resolveSewaPaid(ref) {
  let r = await run(`UPDATE sewa_orders SET status = 'paid' WHERE payment_ref = ? AND status = 'review'`, [ref]);
  if (!(r.changes || 0))
    r = await run(`UPDATE sewa_orders SET status = 'paid' WHERE payment_ref = ? AND status = 'pending' AND mismatch_notified = 1`, [ref]);
  return r.changes || 0;
}

async function resolveSewaRejected(ref) {
  const r = await run(`UPDATE sewa_orders SET status = 'rejected' WHERE payment_ref = ? AND (status = 'review' OR (status = 'pending' AND mismatch_notified = 1))`, [ref]);
  return r.changes || 0;
}

async function reviewSewaOrders() {
  return all(`SELECT * FROM sewa_orders WHERE status = 'review' OR (status = 'pending' AND mismatch_notified = 1) ORDER BY id DESC LIMIT 20`);
}

async function getSewaOrder(ref) {
  return get(`SELECT * FROM sewa_orders WHERE payment_ref = ?`, [ref]);
}

async function mySewaOrders(telegramId) {
  return all(`SELECT * FROM sewa_orders WHERE telegram_id = ? ORDER BY id DESC LIMIT 10`, [telegramId]);
}

async function pendingSewaOrders() {
  return all(`SELECT * FROM sewa_orders WHERE status = 'paid' ORDER BY id ASC`);
}

// ---------- Validasi ----------
function validUsername(u) {
  return /^[a-zA-Z0-9]{3,20}$/.test(u || '');
}

function validIp(ip) {
  const parts = (ip || '').trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function packageListText() {
  return PACKAGES.map((p, i) =>
    `${i + 1}. <b>${p.days} hari</b> — ${digi.rp(p.price)}`
  ).join('\n');
}

module.exports = {
  PACKAGES, initTable, createSewaOrder, checkSewaPayment,
  markSewaPaid, markSewaExpired, markSewaReview, markSewaFulfilled, getSewaOrder,
  resolveSewaPaid, resolveSewaRejected, reviewSewaOrders,
  mySewaOrders, pendingSewaOrders, validUsername, validIp, packageListText,
};

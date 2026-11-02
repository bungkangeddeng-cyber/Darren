// Client Digiflazz Buyer API v1 — dari dokumentasi resmi
// https://developer.digiflazz.com/api/buyer/persiapan/
// dan ringkasan ~/workspace/darren/digiflazz-buyer-notes.md
// Base: https://api.digiflazz.com/v1, POST JSON,
// Content-Type: application/json, sign md5(username+apiKey+value).
// GATE KERAS: bila username/apiKey kosong, semua fungsi menolak
// dengan pesan jelas — tidak pernah mengembalikan harga Rp0,
// produk palsu, atau memotong saldo.
const crypto = require('crypto');
const config = require('./config');
const BASE = 'https://api.digiflazz.com/v1';
function enabled() { return config.ppobEnabled; }
function sign(value) { return crypto.createHash('md5').update(`${config.digiflazz.username}${config.digiflazz.apiKey}${value}`).digest('hex'); }
async function post(endpoint, body) {
  const res = await fetch(BASE + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  return res.json();
}
// Hanya produk aktif yang boleh dijual; harga 0 / gagal = tidak dijual.
async function priceList(cmd = 'prepaid') {
  if (!enabled()) throw new Error('PPOB belum aktif: DIGIFLAZZ_USERNAME / DIGIFLAZZ_API_KEY belum diisi di .env.');
  const r = await post('/price-list', { cmd, username: config.digiflazz.username, sign: sign('pricelist') });
  if (!Array.isArray(r?.data)) throw new Error(r?.data?.message || r?.message || 'Pricelist Digiflazz gagal');
  return r.data
    .filter(p => p.buyer_product_status === true && Number(p.price) > 0)
    .map(p => ({ ...p, price_sell: Number(p.price) + Number(config.digiflazz.margin || 0) }));
}
// Cek saldo deposit supplier SEBELUM jual. Bila saldo supplier kurang
// dari harga, bot wajib menolak dan TIDAK memotong saldo user.
async function cekSaldoSupplier() {
  if (!enabled()) throw new Error('PPOB belum aktif.');
  const r = await post('/cek-saldo', { cmd: 'deposit', username: config.digiflazz.username, sign: sign('depo') });
  const bal = Number(r?.data?.deposit ?? r?.deposit ?? NaN);
  if (!Number.isFinite(bal)) throw new Error(r?.data?.message || r?.message || 'Cek saldo Digiflazz gagal');
  return bal;
}
async function createOrder(sku, customerNo, refId) {
  if (!enabled()) throw new Error('PPOB belum aktif.');
  const r = await post('/transaction', { username: config.digiflazz.username, buyer_sku_code: sku, customer_no: customerNo, ref_id: refId, sign: sign(refId) });
  return r?.data || r;
}
// Cek status prabayar: kirim transaksi yang SAMA dengan ref_id yang SAMA,
// tanpa sku/customer_no. JANGAN buat ref_id baru saat retry.
async function checkStatusPrepaid(refId) {
  if (!enabled()) throw new Error('PPOB belum aktif.');
  const r = await post('/transaction', { username: config.digiflazz.username, ref_id: refId, sign: sign(refId) });
  return r?.data || r;
}
// Pascabayar (belum dibuka di menu awal, tapi disiapkan sesuai dok):
// wajib cek tagihan dulu sebelum bayar, lalu cek status pakai
// commands 'status-pasca'. Cek >90 hari dijawab 'Data belum ada'.
async function checkStatusPasca(sku, customerNo, refId) {
  if (!enabled()) throw new Error('PPOB belum aktif.');
  const r = await post('/transaction', { commands: 'status-pasca', username: config.digiflazz.username, buyer_sku_code: sku, customer_no: customerNo, ref_id: refId, sign: sign(refId) });
  return r?.data || r;
}
// Kategori PPOB (tampilan saja) — kata kunci pemetaan, produknya
// selalu dari price-list live, bukan hardcode daftar produk.
const PPOB_CATEGORIES = [
  { key: 'kuota', label: 'Kuota', keywords: ['kuota', 'paket data', 'internet'] },
  { key: 'pulsa', label: 'Pulsa', keywords: ['pulsa'] },
  { key: 'game', label: 'Game', keywords: ['game', 'diamond', 'mobile legends', 'free fire', 'pubg'] },
  { key: 'pln', label: 'PLN', keywords: ['pln', 'token', 'listrik'] },
  { key: 'emoney', label: 'E-Money', keywords: ['e-money', 'emoney', 'e-wallet', 'dana', 'ovo', 'gopay', 'shopeepay', 'linkaja'] },
  { key: 'voucher', label: 'Voucher', keywords: ['voucher'] },
];
function filterByCategory(products, catKey) {
  const cat = PPOB_CATEGORIES.find(c => c.key === catKey);
  if (!cat) return (products || []).slice(0, 10);
  const list = (products || []).filter(p => cat.keywords.some(k => String(p.product_name || '').toLowerCase().includes(k) || String(p.category || '').toLowerCase().includes(k) || String(p.brand || '').toLowerCase().includes(k)));
  return list.length ? list : (products || []).slice(0, 10);
}
// Aturan throttle resmi: jangan cek status berulang <1 menit (race),
// jangan cek transaksi >90 hari (dianggap transaksi baru).
function canCheckStatus(lastCheckedAt, createdAt, now = new Date()) {
  if (createdAt && (now - new Date(createdAt)) > 90 * 24 * 3600 * 1000) return { ok: false, reason: 'Transaksi sudah >90 hari, tidak bisa dicek lagi (dianggap transaksi baru oleh Digiflazz).' };
  if (lastCheckedAt && (now - new Date(lastCheckedAt)) < 60 * 1000) return { ok: false, reason: 'Tunggu minimal 1 menit sejak cek terakhir sebelum cek lagi.' };
  return { ok: true };
}
function normStatus(s) { return String(s || '').toLowerCase(); }
// Klasifikasi status Digiflazz ke aksi saldo: sukses=potong,
// pending=kunci (potong + bisa refund bila akhirnya gagal),
// gagal=kembalikan (jangan potong / refund bila sudah terkunci).
function saldoActionForStatus(status) {
  const s = normStatus(status);
  if (s.includes('sukses') || s.includes('success')) return 'deduct';
  if (s.includes('pending') || s.includes('proses') || s.includes('process')) return 'lock';
  if (s.includes('gagal') || s.includes('failed') || s.includes('batal')) return 'refund';
  return 'lock'; // status tak dikenal = perlakukan sebagai pending, jangan anggap sukses
}
module.exports = { enabled, priceList, cekSaldoSupplier, createOrder, checkStatusPrepaid, checkStatusPasca, canCheckStatus, saldoActionForStatus, normStatus, PPOB_CATEGORIES, filterByCategory };

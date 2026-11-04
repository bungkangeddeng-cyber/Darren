// ============================================================
// Klien gateway H2H milik sendiri — deposit QRIS GoPay + sewa.
// Base URL publik: https://payment-gateway.outletku.ai.id/api/h2h/v1
// Auth: header x-api-key = kunci tenant gk_ milik OPERATOR bot,
// dibaca dari env H2H_API_KEY di server saat deploy.
// JANGAN pernah menulis nilai kunci di file ini / di repo.
// Pola dipakai: poller 30 detik (deposit) / 60 detik (sewa).
// Webhook H2H (payment.success/expired) TIDAK dipakai di fase ini:
// bot ini tidak punya HTTP listener; receiver adalah pekerjaan
// deploy (URL publik + nginx), bukan kode saja.
// ============================================================
const axios = require('axios');
const QRCode = require('qrcode');
const config = require('./config');

// Status gateway (dibandingkan lowercase) — status tak dikenal
// TIDAK PERNAH dianggap lunas.
const PAID_STATUSES = ['paid', 'success', 'settled', 'completed'];
const EXPIRED_STATUSES = ['expired', 'cancelled', 'canceled'];

function isPaidStatus(s) { return PAID_STATUSES.includes(String(s || '').toLowerCase()); }
function isExpiredStatus(s) { return EXPIRED_STATUSES.includes(String(s || '').toLowerCase()); }

function creds() {
  return {
    baseUrl: (config.h2h?.baseUrl || '').replace(/\/$/, ''),
    apiKey: config.h2h?.apiKey || '',
  };
}

// Respons H2H bisa berbentuk { ... } atau { data: { ... } }.
function unwrap(body) {
  if (body && typeof body === 'object' && body.data && typeof body.data === 'object') return body.data;
  return body || {};
}

function pickAmount(p) {
  const v = p?.amount ?? p?.totalAmount ?? p?.paidAmount ?? p?.uniqueAmount ?? null;
  return v == null ? null : Number(v);
}

function errMessage(status) {
  switch (status) {
    case 409: return '❌ Nominal bentrok dengan QRIS aktif lain di gateway. Coba lagi sebentar atau ganti nominal.';
    case 401:
    case 403: return '❌ Kunci/lisensi gateway tidak valid. Hubungi admin.';
    case 410: return '❌ QRIS sudah kedaluwarsa.';
    case 503: return '❌ Layanan akun gateway tidak jalan. Coba lagi nanti.';
    default: return '❌ Gagal membuat QRIS. Coba lagi.';
  }
}

// Cari QR dari respons gateway, tanpa pernah membuat QR palsu:
// 1) string QR -> generate lokal (paket qrcode);
// 2) URL gambar di host gateway -> unduh dengan header x-api-key;
// 3) URL gambar host lain -> unduh TANPA header (jangan bocorkan kunci).
// Gagal total -> { qrBuffer: null, qrUrl: null } (pemanggil kirim teks saja).
async function resolveQr(p, baseUrl, apiKey) {
  try {
    const str = p?.qr_string ?? p?.qris_string ?? p?.qrString ?? p?.qrisString
      ?? p?.qr_content ?? p?.qrContent ?? (typeof p?.qr === 'string' ? p.qr : null)
      ?? (typeof p?.string === 'string' ? p.string : null);
    if (str) {
      const buf = await QRCode.toBuffer(String(str));
      return { qrBuffer: buf, qrUrl: null };
    }
    const img = p?.qrImage ?? p?.qr_image ?? p?.qrUrl ?? p?.qr_url
      ?? p?.qrisUrl ?? p?.qris_url ?? p?.qr_code_url ?? p?.imageUrl ?? null;
    if (img) {
      let url = String(img);
      let withKey = false;
      if (url.startsWith('/')) {
        url = baseUrl + url;
        withKey = true;
      } else if (url.startsWith('http')) {
        try { withKey = new URL(url).host === new URL(baseUrl).host; } catch (_) { withKey = false; }
      } else {
        return { qrBuffer: null, qrUrl: null };
      }
      const res = await axios.get(url, {
        responseType: 'arraybuffer', timeout: 20000,
        headers: withKey ? { 'x-api-key': apiKey } : {},
      });
      return { qrBuffer: Buffer.from(res.data), qrUrl: url };
    }
  } catch (_) { /* jatuh ke null di bawah */ }
  return { qrBuffer: null, qrUrl: null };
}

// Buat QRIS dinamis H2H (berlaku 5 menit).
// Sukses -> { success: true, qrisId, amount, uniqueAmount, qrBuffer, qrUrl }
// Gagal  -> { success: false, message, httpStatus }
async function createQris(amount, reference) {
  const { baseUrl, apiKey } = creds();
  if (!apiKey) return { success: false, message: '❌ Gateway QRIS belum dikonfigurasi.' };
  let res;
  try {
    res = await axios.post(
      `${baseUrl}/gopay/qris`,
      { amount, reference, use_unique_code: true },
      { headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 20000 }
    );
  } catch (e) {
    const st = e?.response?.status || null;
    return { success: false, message: errMessage(st), httpStatus: st };
  }
  const p = unwrap(res.data);
  const qrisId = p?.qris_id ?? p?.qrisId ?? p?.id ?? null;
  if (!qrisId) return { success: false, message: '❌ Gagal membuat QRIS.' };
  const { qrBuffer, qrUrl } = await resolveQr(p, baseUrl, apiKey);
  return {
    success: true,
    qrisId: String(qrisId),
    amount: pickAmount(p),
    uniqueAmount: p?.uniqueAmount ?? p?.unique_amount ?? null,
    qrBuffer, qrUrl,
  };
}

// Status QRIS H2H.
// Jaringan/HTTP tak dikenal -> { ok: false } (poller lewati putaran ini,
// jangan ubah status apa pun).
async function getQrisStatus(qrisId) {
  const { baseUrl, apiKey } = creds();
  if (!apiKey) return { ok: false };
  let res;
  try {
    res = await axios.get(
      `${baseUrl}/gopay/qris/${encodeURIComponent(qrisId)}/status`,
      { headers: { 'x-api-key': apiKey }, timeout: 15000 }
    );
  } catch (_) {
    return { ok: false };
  }
  const p = unwrap(res.data);
  const status = String(p?.status ?? p?.payment_status ?? '').toLowerCase();
  return { ok: true, status: status || 'unknown', paidAmount: pickAmount(p) };
}

module.exports = { createQris, getQrisStatus, isPaidStatus, isExpiredStatus };

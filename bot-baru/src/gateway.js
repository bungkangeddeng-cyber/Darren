// Gateway H2H GoPay — sesuai Dokumentasi API gateway (api-docs), bukan karangan.
// Base: P2P_GATEWAY_URL + /api/h2h/v1, header x-api-key (gk_).
// POST /gopay/qris {amount, reference, use_unique_code:true}
//   -> data {qris_id, trx_id, reference, qris_url, qris_code, base_amount,
//             unique_code, amount, expires_at (5 menit), verification_mode}
// 409 = nominal bentrok dengan QRIS aktif lain (pakai use_unique_code / ganti nominal)
// 410 = QRIS kedaluwarsa, 503 = layanan akun tidak jalan, 401/403 = kunci tidak valid.
// TIDAK PERNAH kirim event uji (webhooks/test) — tes harus deposit sungguhan.
const config = require('./config');

async function createQris(amount, reference) {
  if (!config.p2p.gatewayUrl || !config.p2p.apiKey) {
    return { success: false, message: 'Gateway belum dikonfigurasi (URL/kunci kosong).' };
  }
  const url = config.p2p.gatewayUrl.replace(/\/$/, '') + '/api/h2h/v1/gopay/qris';
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.p2p.apiKey },
      body: JSON.stringify({ amount: Number(amount), reference, use_unique_code: true }),
    });
  } catch (e) {
    return { success: false, message: 'Gagal menghubungi gateway: ' + e.message };
  }
  let txt = '';
  try { txt = await res.text(); } catch {}
  let json = {};
  try { json = txt ? JSON.parse(txt) : {}; } catch {}
  if (!res.ok || !json.success || !json.data) {
    const msg = json.message || json.error || txt.slice(0, 300) || ('HTTP ' + res.status);
    if (res.status === 409) return { success: false, message: 'Nominal bentrok dengan QRIS aktif lain (409). Coba nominal lain atau tunggu QRIS lama kedaluwarsa (5 menit).' };
    if (res.status === 410) return { success: false, message: 'QRIS kedaluwarsa (410). Buat QRIS baru.' };
    if (res.status === 503) return { success: false, message: 'Layanan akun gateway tidak jalan (503). Coba lagi nanti.' };
    if (res.status === 401 || res.status === 403) return { success: false, message: 'Kunci gateway tidak valid / lisensi tidak aktif (HTTP ' + res.status + '). Periksa kunci gk_ dan lisensi di gateway.' };
    return { success: false, message: 'Gagal buat QRIS gateway (HTTP ' + res.status + '): ' + msg };
  }
  const data = json.data;
  // qris_url dari gateway bisa loopback internal (127.0.0.1) — tidak bisa
  // dibuka dari HP user. Ambil qr_image_url dari metadata QRIS (gateway
  // memakai api.qrserver.com), kalau gagal buat sendiri dari qris_code
  // dengan generator QR publik yang sama — gambar QR-nya tetap dari
  // kode QRIS asli gateway, bukan QR palsu.
  try {
    if (data.qris_id) {
      const m = await fetch(url.replace(/\/gopay\/qris$/, '/gopay/qris/' + encodeURIComponent(data.qris_id)), { headers: { 'x-api-key': config.p2p.apiKey } });
      const mj = await m.json().catch(() => ({}));
      if (mj.data && mj.data.qr_image_url) data.qr_image_url = mj.data.qr_image_url;
    }
  } catch {}
  if (!data.qr_image_url && data.qris_code) {
    data.qr_image_url = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(data.qris_code);
  }
  return { success: true, data };
}

module.exports = { createQris };

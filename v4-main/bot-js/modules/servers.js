// ============================================================
// Modul Server — registrasi server VPN (model bot-baru, TANPA install SSH)
// - Tambah server: admin isi nama/domain/api_base/api_auth, lalu
//   HEALTH CHECK ke {api_base}/health HARUS lolos sebelum server
//   diaktifkan (gerbang seperti bot-baru: gagal = tidak aktif).
// - /health di vpn-api.py bersifat publik (tanpa auth) dan menjawab
//   {"status":"success"} bila API hidup — jadi health check ini TIDAK
//   memakai api_auth dan TIDAK PERNAH mencetak/melog nilai api_auth.
// - Adaptasi dari bot-baru: bot-baru memvalidasi domain + DNS karena
//   ia MENGINSTAL server baru; bot-js hanya MENDAFTARKAN API yang
//   sudah jalan, jadi gerbangnya adalah health check API, bukan DNS.
// ============================================================
const axios = require('axios');

function normalizeApiBase(apiBase) {
  return String(apiBase || '').trim().replace(/\/+$/, '');
}

function validApiBase(apiBase) {
  return /^https?:\/\/.+/.test(normalizeApiBase(apiBase));
}

// Health check: GET {api_base}/health, timeout 10 detik.
// Lolos hanya bila HTTP 200 + body.status === 'success'.
// Gagal: { ok:false, message } dengan alasan jelas (timeout/jaringan/
// HTTP non-200/body tak dikenal/URL tak valid) — tanpa nilai sensitif.
async function checkServerHealth(apiBase, timeoutMs = 10000) {
  const base = normalizeApiBase(apiBase);
  if (!validApiBase(base)) {
    return { ok: false, message: 'API base harus URL http(s), contoh: http://1.2.3.4:5890' };
  }
  try {
    const { status, data } = await axios.get(base + '/health', { timeout: timeoutMs });
    if (status === 200 && data && data.status === 'success') return { ok: true };
    return { ok: false, message: `API menjawab HTTP ${status} tanpa status success — pastikan itu vpn-api (port 5890) yang benar.` };
  } catch (e) {
    if (e.code === 'ECONNABORTED' || /timeout/i.test(e.message || '')) {
      return { ok: false, message: 'Health check timeout (10 detik) — API tidak merespon. Periksa api_base/port/firewall server itu.' };
    }
    if (e.response) {
      return { ok: false, message: `API menjawab HTTP ${e.response.status} — pastikan itu vpn-api (port 5890) yang benar.` };
    }
    return { ok: false, message: 'API tidak bisa dihubungi (' + (e.code || 'jaringan') + ') — periksa api_base dan jaringan server itu.' };
  }
}

module.exports = { normalizeApiBase, validApiBase, checkServerHealth };

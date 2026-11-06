'use strict';
// Bendera negara (emoji) + deteksi negara dari IP — untuk picker server.
// Dipakai pemilih server saat beli VPN (tiap server wajib punya bendera,
// mis. 🇮🇩 Indonesia / 🇸🇬 Singapura) dan saat mendaftarkan server baru
// (negara terdeteksi otomatis dari IP, admin bisa ubah via Edit Negara).
const axios = require('axios');

// Kode negara ISO 2 huruf -> emoji bendera (regional indicator).
// Kode tidak valid / kosong -> 🌐 (globe, netral).
function flagFor(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '🌐';
  const cp = [...c].map((ch) => 0x1F1E6 + (ch.charCodeAt(0) - 65));
  return String.fromCodePoint(...cp);
}

// Deteksi kode negara (ISO 2 huruf, mis. 'SG') dari IP publik via
// ip-api.com (gratis, tanpa key). Gagal / tidak dikenali -> ''.
async function detectCountry(ip) {
  try {
    const r = await axios.get(`http://ip-api.com/json/${ip}?fields=status,countryCode`, { timeout: 8000 });
    if (r.data && r.data.status === 'success' && /^[A-Z]{2}$/.test(r.data.countryCode || '')) {
      return String(r.data.countryCode).toUpperCase();
    }
  } catch (_) {}
  return '';
}

// Daftar negara umum untuk pilihan admin (kode -> nama tampil).
const COMMON_COUNTRIES = [
  ['ID', 'Indonesia'], ['SG', 'Singapura'], ['MY', 'Malaysia'],
  ['TH', 'Thailand'], ['VN', 'Vietnam'], ['PH', 'Filipina'],
  ['JP', 'Jepang'], ['KR', 'Korea Selatan'], ['US', 'Amerika Serikat'],
  ['GB', 'Inggris'], ['NL', 'Belanda'], ['DE', 'Jerman'],
];

module.exports = { flagFor, detectCountry, COMMON_COUNTRIES };

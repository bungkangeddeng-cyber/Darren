// Deteksi lokasi + provider VPS secara otomatis (2026-11-02, atas perintah
// user: pembeli harus tahu server apa yang dibeli, dengan bendera negara).
// Sumber: ipinfo.io/json dari IP egress VPS tempat bot jalan — BUKAN
// hardcode negara. Kalau server pindah (mis. Singapura -> India), bendera
// ikut berubah otomatis setelah cache habis / bot restart.
// Gagal deteksi = null, pemanggil harus tampilkan "deteksi gagal", BUKAN
// negara palsu. Tidak ada secret, tidak ada token.
let cache = null;
let cacheAt = 0;
const TTL_MS = 24 * 3600 * 1000;
function flagFromCountry(code) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (c.length !== 2) return '';
  return String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}
function providerFromOrg(org) {
  // "AS14061 DigitalOcean, LLC" -> "DigitalOcean, LLC"
  const s = String(org || '').replace(/^AS\d+\s+/, '').trim();
  return s || null;
}
async function getGeo() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  try {
    const res = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || !d.country) return null;
    cache = {
      ip: d.ip || null,
      countryCode: d.country,
      country: d.country,
      city: d.city || null,
      region: d.region || null,
      provider: providerFromOrg(d.org),
      flag: flagFromCountry(d.country),
    };
    cacheAt = Date.now();
    return cache;
  } catch { return null; }
}
module.exports = { getGeo, flagFromCountry };

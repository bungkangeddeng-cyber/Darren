// Cek Kuota — mengikuti contoh Milastore (web) yang sudah fix.
// Backend:
//   1. Bila SIDOMPUL_API_KEY + SIDOMPUL_BASIC terisi -> langsung ke Sidompul (kredensial via env).
//   2. Bila kosong -> lewat proxy web Milastore (https://milastore.cloud/proxy/cek-kuota),
//      dengan alur CSRF yang sama seperti frontend web: ambil cookie XSRF dari halaman
//      web dulu, lalu POST dengan Cookie + header X-XSRF-TOKEN.
// Hasil diparsing gaya Milastore (info + paket) dan TIDAK pernah dipalsukan:
// bila upstream gagal / hasil kosong, kembalikan pesan error yang jelas.
const config = require('./config');

const SIDOMPUL_URL = 'https://apigw.kmsp-store.com/sidompul/v4/cek_kuota';
const PROXY_BASE = 'https://milastore.cloud';
const PROXY_PAGE = `${PROXY_BASE}/order/cek-kuota`;
const PROXY_POST = `${PROXY_BASE}/proxy/cek-kuota`;

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

// Escape untuk pesan Telegram (parse_mode HTML).
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Parser gaya Milastore (processApiData): pisahkan info kartu dan paket-paket.
// Pemisah paket = garis === / ---; pasangan key: value atau label-baris-berikutnya.
function parseHasil(rawHtml) {
  if (!rawHtml) return null;
  const lines = stripHtml(rawHtml).split('\n').map(l => l.trim()).filter(Boolean);
  const info = [];
  const packages = [];
  let current = [];
  let inPackages = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/={3,}|-{3,}/.test(line)) {
      inPackages = true;
      if (current.length) packages.push([...current]);
      current = [];
      continue;
    }
    let key = '';
    let val = '';
    if (line.includes(':')) {
      const idx = line.indexOf(':');
      key = line.slice(0, idx).trim();
      val = line.slice(idx + 1).trim();
    } else if (i + 1 < lines.length && !/={3,}|-{3,}/.test(lines[i + 1])) {
      key = line;
      val = lines[i + 1];
      i++;
    } else {
      key = line;
      val = '';
    }
    const cleanKey = key.replace(/[^a-zA-Z0-9 \-\/]/g, '').trim();
    if (inPackages) current.push({ key: cleanKey, val });
    else info.push({ key: cleanKey, val });
  }
  if (current.length) packages.push(current);
  return { info, packages };
}

// Format pesan gaya Milastore (format copy WA-nya), disesuaikan untuk Telegram.
function formatPesan(bersih, parsed, fallback) {
  if (!parsed || (parsed.info.length === 0 && parsed.packages.length === 0)) {
    return `📡 <b>CEK KUOTA</b>\n📱 Nomor: <code>${bersih}</code>\n\n<blockquote>${esc(fallback)}</blockquote>`;
  }
  let out = `📡 <b>CEK KUOTA MILASTORE</b>\n📱 Nomor: <code>${bersih}</code>\n\n📌 <b>INFO KARTU</b>\n`;
  for (const it of parsed.info) {
    if (it.key && it.val) out += `${esc(it.key)}: ${esc(it.val)}\n`;
  }
  if (parsed.packages.length) {
    out += `\n📦 <b>DETAIL PAKET/KUOTA</b>\n`;
    parsed.packages.forEach((pkg, idx) => {
      out += `\n[Paket ${idx + 1}]\n`;
      for (const it of pkg) {
        if (it.key && it.val) out += `- ${esc(it.key)}: ${esc(it.val)}\n`;
      }
    });
  }
  return out.trim().slice(0, 4000);
}

// Ambil cookie dari header Set-Cookie gabungan.
// Atribut cookie (expires/path/domain/dll.) dibuang, hanya nama=nilai yang disimpan.
function parseSetCookies(combined) {
  const cookies = {};
  if (!combined) return cookies;
  const SKIP = new Set(['expires', 'path', 'domain', 'secure', 'httponly', 'samesite', 'max-age', 'partitioned']);
  const re = /(?:^|,)\s*([A-Za-z0-9_\-]+)=([^;,]+)/g;
  let m;
  while ((m = re.exec(combined)) !== null) {
    if (SKIP.has(m[1].toLowerCase())) continue;
    cookies[m[1]] = m[2];
  }
  return cookies;
}

async function cekViaProxy(bersih) {
  // 1. GET halaman web untuk mendapatkan cookie sesi + XSRF.
  const page = await fetch(PROXY_PAGE, {
    signal: AbortSignal.timeout(25000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const setCookie = page.headers.get('set-cookie') || '';
  await page.arrayBuffer().catch(() => {});
  const cookies = parseSetCookies(setCookie);
  const xsrf = cookies['XSRF-TOKEN'];
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  // 2. POST ke proxy dengan cookie + header X-XSRF-TOKEN (seperti axios di web).
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };
  if (cookieHeader) headers.Cookie = cookieHeader;
  // Header X-XSRF-TOKEN harus nilai TER-DECODE (seperti yang dikirim axios di
  // browser); Cookie header tetap memakai nilai mentah (PHP men-decode sendiri).
  if (xsrf) {
    try { headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf); }
    catch { headers['X-XSRF-TOKEN'] = xsrf; }
  }
  const res = await fetch(PROXY_POST, {
    method: 'POST',
    signal: AbortSignal.timeout(25000),
    headers,
    body: JSON.stringify({ msisdn: bersih }),
  });
  if (res.status === 419) throw new Error('CSRF proxy ditolak (419).');
  if (res.status === 429) throw new Error('Terlalu sering (batas proxy 5x/4 menit). Coba lagi beberapa menit.');
  if (!res.ok) throw new Error(`Proxy menjawab HTTP ${res.status}.`);
  return res.json();
}

async function cekViaSidompul(bersih, apiKey) {
  const res = await fetch(`${SIDOMPUL_URL}?msisdn=${encodeURIComponent(bersih)}`, {
    headers: { Authorization: 'Basic ' + config.sidompulBasic, 'X-API-Key': apiKey, 'X-App-Version': '4.0.0' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Sidompul menjawab HTTP ${res.status}.`);
  return res.json();
}

async function cekKuota(msisdn) {
  const nomor = String(msisdn || '').replace(/\D/g, '');
  const bersih = nomor.startsWith('62') ? '0' + nomor.slice(2) : nomor;
  if (!/^08\d{8,13}$/.test(bersih)) {
    return { success: false, message: '❌ Format nomor salah.\nContoh: <code>087862591220</code>' };
  }
  try {
    const apiKey = config.sidompulApiKey;
    const data = (apiKey && config.sidompulBasic) ? await cekViaSidompul(bersih, apiKey) : await cekViaProxy(bersih);
    // Web: sukses = status true + data.hasil. Proxy meneruskan JSON Sidompul apa adanya.
    if (data && data.status === false) {
      const msg = data.message || 'Nomor tidak terdaftar atau sistem pusat sedang sibuk.';
      return { success: false, message: `❌ <b>Pengecekan Gagal</b>\n${esc(String(msg))}` };
    }
    const result = data && data.data ? data.data : data;
    let hasil = '';
    if (result && typeof result === 'object' && result.hasil) hasil = stripHtml(result.hasil);
    else if (typeof result === 'object') hasil = Object.entries(result).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => `- ${k}: ${stripHtml(String(v))}`).join('\n') || stripHtml(JSON.stringify(result)).slice(0, 1500);
    else hasil = stripHtml(String(result)).slice(0, 1500);
    if (!hasil) return { success: false, message: '❌ <b>Pengecekan Gagal</b>\nUpstream tidak mengembalikan hasil.' };
    const parsed = parseHasil(hasil);
    return { success: true, message: formatPesan(bersih, parsed, hasil) };
  } catch (e) {
    return { success: false, message: `❌ <b>Error cek kuota:</b> ${esc(e.message)}` };
  }
}

module.exports = { cekKuota };

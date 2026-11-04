'use strict';
// Pengaturan & API Key (menu admin bot-js) — baca/tulis .env bot-js.
// TIDAK PERNAH mengembalikan nilai kunci/secret; status hanya terisi/kosong.
// Nilai non-rahasia (domain, URL gateway, username) boleh ditampilkan ke admin.
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');

const FIELDS = [
  { key: 'VPN_DOMAIN', label: 'Domain VPN', secret: false },
  { key: 'H2H_BASE_URL', label: 'URL Gateway H2H', secret: false },
  { key: 'H2H_API_KEY', label: 'Kunci Gateway (gk_)', secret: true },
  { key: 'WEBHOOK_SECRET', label: 'Secret Webhook', secret: true },
  { key: 'DIGIFLAZZ_USERNAME', label: 'Username Digiflazz', secret: false },
  { key: 'DIGIFLAZZ_API_KEY', label: 'Kunci Digiflazz', secret: true },
];

function readEnv() {
  try { return fs.readFileSync(ENV_PATH, 'utf8'); } catch (_) { return ''; }
}

function parseEnv() {
  const m = {};
  for (const ln of readEnv().split('\n')) {
    if (!ln || ln.startsWith('#')) continue;
    const i = ln.indexOf('=');
    if (i > 0) m[ln.slice(0, i).trim()] = ln.slice(i + 1).trim();
  }
  return m;
}

// Status: untuk field rahasia value selalu '' (tidak pernah dibaca keluar).
function getStatus() {
  const env = parseEnv();
  return FIELDS.map((f) => ({
    ...f,
    filled: !!(env[f.key] || '').trim(),
    value: f.secret ? '' : (env[f.key] || '').trim(),
  }));
}

// URL webhook deposit publik dari domain VPN; '' bila domain belum diset.
function webhookUrl() {
  const d = (parseEnv().VPN_DOMAIN || '').trim();
  return d ? `http://${d}:81/webhook/deposit` : '';
}

function setKey(key, value) {
  const f = FIELDS.find((x) => x.key === key);
  if (!f) throw new Error('field tidak dikenal');
  const v = String(value || '').trim();
  if (!v) throw new Error('nilai tidak boleh kosong');
  if (/[\r\n]/.test(v)) throw new Error('nilai harus satu baris');
  if (/\s/.test(v)) throw new Error('nilai tidak boleh mengandung spasi');
  if (/['"]/.test(v)) throw new Error('nilai tidak boleh mengandung tanda kutip');
  const lines = readEnv().split('\n');
  let done = false;
  const out = lines.map((ln) => {
    if (ln.startsWith(key + '=')) { done = true; return `${key}=${v}`; }
    return ln;
  });
  if (!done) {
    while (out.length && out[out.length - 1] === '') out.pop();
    out.push(`${key}=${v}`);
  }
  fs.writeFileSync(ENV_PATH, out.join('\n') + '\n');
  try { fs.chmodSync(ENV_PATH, 0o600); } catch (_) {}
  return f;
}

function mask(v) {
  const s = String(v || '');
  if (s.length <= 6) return '***';
  return s.slice(0, 3) + '...' + s.slice(-3);
}

module.exports = { FIELDS, getStatus, webhookUrl, setKey, mask };

// ============================================================
// Konfigurasi bot — dibaca dari environment / .env
// Prioritas: process.env -> default
// JANGAN hardcode token di sini.
// ============================================================
require('dotenv').config();

// Secret webhook: bila belum ada, dibuat otomatis sekali (skrip sewa: tanpa
// input). Disimpan ke .env (600) agar restart berikutnya memakai nilai sama.
let webhookSecretGenerated = false;
if (!process.env.WEBHOOK_SECRET) {
  const gen = require('crypto').randomBytes(32).toString('hex');
  process.env.WEBHOOK_SECRET = gen;
  webhookSecretGenerated = true;
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(__dirname, '..', '.env');
    let cur = '';
    try { cur = fs.readFileSync(envPath, 'utf8'); } catch (_) {}
    const sep = cur && !cur.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(envPath, sep + `WEBHOOK_SECRET=${gen}\n`);
    try { fs.chmodSync(envPath, 0o600); } catch (_) {}
  } catch (_) { /* simpan gagal: secret in-memory saja */ }
}


const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

module.exports = {
  botToken: process.env.BOT_TOKEN || '',
  adminId: num(process.env.ADMIN_ID, 0), // FIXED: no hardcoded admin; 0 = no admin until configured

  vpn: {
    apiBase: (process.env.VPN_API_BASE || 'http://127.0.0.1:5890').replace(/\/$/, ''),
    apiAuth: process.env.VPN_API_AUTH || '',
    domain: process.env.VPN_DOMAIN || '', // FIXED: must be set in .env
  },

  cloudfront: {
    domain: process.env.CF_DOMAIN || '',
    vmessUuid: process.env.CF_VMESS_UUID || '',
    vlessUuid: process.env.CF_VLESS_UUID || '',
    trojanPassword: process.env.CF_TROJAN_PASSWORD || '',
    // Path WebSocket di origin (harus sama dengan setup di server)
    paths: {
      vmess: '/cf-vmess',
      vless: '/cf-vless',
      trojan: '/cf-trojan',
      ssh: '/cf-ssh',
    },
  },

  digiflazz: {
    username: process.env.DIGIFLAZZ_USERNAME || '',
    apiKey: process.env.DIGIFLAZZ_API_KEY || '',
    margin: num(process.env.PPOB_MARGIN, 0),
  },

  h2h: {
    // Gateway H2H milik sendiri (deposit QRIS GoPay + sewa).
    // apiKey = kunci tenant gk_ milik OPERATOR bot, dari env di server.
    // JANGAN tulis nilai kunci di sini / di repo.
    baseUrl: (process.env.H2H_BASE_URL || 'https://payment-gateway.outletku.ai.id/api/h2h/v1').replace(/\/$/, ''),
    apiKey: process.env.H2H_API_KEY || '',
  },

  webhook: {
    // Receiver webhook deposit (Fase 1) — loopback saja.
    // secret = secret webhook akun gateway operator, dari env di server.
    // Tanpa secret, receiver menolak semua (503 fail-closed).
    secret: process.env.WEBHOOK_SECRET || '',
    generated: webhookSecretGenerated, // true bila secret baru dibuat saat boot ini
    port: num(process.env.WEBHOOK_PORT, 8899),
  },

  hcApiKey: process.env.HC_API_KEY || '',

  sidompul: {
    apiKey: process.env.SIDOMPUL_API_KEY || '',
  },

  dbPath: process.env.DB_PATH || require('path').join(__dirname, '../data/bot.db'),

  // ===== Kompatibilitas PPOB Aji (registerPPOB) =====
  admins: (() => { const _id = num(process.env.ADMIN_ID, 0); return _id ? [String(_id)] : []; })(),
  botName: 'RIPZZ VPN',
  channelId: process.env.CHANNEL_ID || '',
  groupId: '', // Grup Aji diatur via panel admin; kosong = tidak ada grup bawaan
  pageSize: 10,
  paymentPollMs: 5000,
  qrisExpireMinutes: 5, // QRIS H2H berlaku 5 menit (dipakai logika reuse deposit)
  requiredChannelId: '',
  requiredChannelUrl: '', // Channel Aji diatur via panel admin; kosong = tidak ada channel wajib bawaan,
  roles: ['bronze', 'silver', 'gold'],
  storePhoto: '',
  syncMinutes: 60,
  trxMaxPolls: 20,
  trxPollMs: 5000,
};

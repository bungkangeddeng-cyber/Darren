// Konfigurasi bot-baru — dibaca dari .env, tanpa hardcode secret/admin.
require('dotenv').config();
const path = require('path');
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const cfg = {
  botToken: process.env.BOT_TOKEN || '',
  adminId: num(process.env.ADMIN_ID, 0),
  // Brand toko user sendiri (dari bot lama), BUKAN brand bot contoh.
  // Jangan ganti ke nama/logo/channel bot lain.
  brand: (process.env.BRAND_NAME || 'RIPZZ STORE').trim(),
  adminUsername: (process.env.ADMIN_USERNAME || '').trim().replace(/^@/, ''),
  // Join-gate OPSIONAL dan NONAKTIF secara default. Kosong = langsung
  // ke menu utama tanpa gate. Jangan hardcode channel/group contoh.
  joinChannel: (process.env.JOIN_CHANNEL || '').trim().replace(/^@/, ''),
  joinGroup: (process.env.JOIN_GROUP || '').trim().replace(/^@/, ''),
  sidompulApiKey: (process.env.SIDOMPUL_API_KEY || '').trim(),
  sidompulBasic: (process.env.SIDOMPUL_BASIC || '').trim(),
  vpn: {
    apiBase: (process.env.VPN_API_BASE || 'http://127.0.0.1:5890').replace(/\/$/, ''),
    apiAuth: process.env.VPN_API_AUTH || '',
    domain: process.env.VPN_DOMAIN || '',
  },
  digiflazz: {
    username: (process.env.DIGIFLAZZ_USERNAME || '').trim(),
    apiKey: (process.env.DIGIFLAZZ_API_KEY || '').trim(),
    margin: num(process.env.PPOB_MARGIN, 0),
    // Form webhook Digiflazz LENGKAP, meniru form dashboard Digiflazz
    // (Pengaturan Koneksi > Edit Koneksi API): Webhook ID, Payload URL,
    // Content type (tetap application/json), Secret, Aktif/Non Aktif.
    // Secret ini TERPISAH dari WEBHOOK_SECRET gateway — jangan dicampur,
    // karena penandatangan dan format event-nya berbeda.
    webhook: {
      id: (process.env.DIGIFLAZZ_WEBHOOK_ID || '').trim(),
      url: (process.env.DIGIFLAZZ_WEBHOOK_URL || '').trim().replace(/\/$/, ''),
      secret: process.env.DIGIFLAZZ_WEBHOOK_SECRET || '',
      active: (process.env.DIGIFLAZZ_WEBHOOK_ACTIVE || '').toLowerCase() === 'true',
      contentType: 'application/json',
    },
  },
  p2p: {
    gatewayUrl: (process.env.P2P_GATEWAY_URL || '').replace(/\/$/, ''),
    apiKey: process.env.P2P_API_KEY || '',
  },
  webhook: {
    // Base URL publik untuk webhook. Default domain VPN; baru jalan setelah
    // nginx menambahkan location /webhook-* -> WEBHOOK_PORT di loopback.
    baseUrl: (process.env.WEBHOOK_BASE_URL || process.env.VPN_DOMAIN ? 'https://' + (process.env.WEBHOOK_BASE_URL || process.env.VPN_DOMAIN).replace(/^https?:\/\//, '').replace(/\/$/, '') : '').replace(/\/$/, ''),
    port: num(process.env.WEBHOOK_PORT, 8899),
    secret: process.env.WEBHOOK_SECRET || '',
    gatewayPath: '/webhook-gateway',
    digiflazzPath: '/webhook-digiflazz',
  },
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bot.db'),
};
cfg.joinEnabled = Boolean(cfg.joinChannel || cfg.joinGroup);
cfg.supportText = cfg.adminUsername ? '@' + cfg.adminUsername : 'Hubungi admin';
cfg.vpnCreateEnabled = Boolean(cfg.vpn.domain && cfg.vpn.apiAuth);
cfg.ppobEnabled = Boolean(cfg.digiflazz.username && cfg.digiflazz.apiKey);
cfg.depositAutoEnabled = Boolean(cfg.p2p.gatewayUrl && cfg.p2p.apiKey);
cfg.isAdmin = (id) => cfg.adminId !== 0 && String(id) === String(cfg.adminId);
// Simpan perubahan dari menu Admin Telegram ke .env + memori bot, tanpa
// menampilkan nilai secret kembali. File .env dicari di folder bot
// (satu level di atas src/), fallback ke cwd. Nilai ditulis apa adanya,
// tanpa echo ke log/chat.
cfg.envPath = path.join(__dirname, '..', '.env');
cfg.refreshFlags = () => {
  cfg.ppobEnabled = Boolean(cfg.digiflazz.username && cfg.digiflazz.apiKey);
  cfg.depositAutoEnabled = Boolean(cfg.p2p.gatewayUrl && cfg.p2p.apiKey);
  cfg.vpnCreateEnabled = Boolean(cfg.vpn.domain && cfg.vpn.apiAuth);
};
cfg.saveEnv = (pairs) => {
  const fs = require('fs');
  const envPath = fs.existsSync(cfg.envPath) ? cfg.envPath : path.join(process.cwd(), '.env');
  let lines = [];
  // BUG LAMA (2026-11-02): .splitlines() BUKAN method JS — melempar dan
  // catch mengosongkan lines, sehingga .env terpotong jadi hanya key baru
  // dan bot crash BOT_TOKEN kosong. Perbaikan: .split('\n') yang benar.
  try { lines = fs.readFileSync(envPath, 'utf8').split('\n'); } catch {}
  const out = []; const seen = new Set();
  for (const line of lines) {
    if (!line.startsWith('#') && line.includes('=')) {
      const k = line.split('=', 1)[0];
      if (Object.prototype.hasOwnProperty.call(pairs, k)) { out.push(k + '=' + pairs[k]); seen.add(k); continue; }
    }
    out.push(line);
  }
  for (const [k, v] of Object.entries(pairs)) if (!seen.has(k)) out.push(k + '=' + v);
  // Pengaman: jangan pernah menimpa .env yang panjang dengan file pendek.
  if (lines.length > 5 && out.length < lines.length) throw new Error('saveEnv dibatalkan: output lebih pendek dari .env asli, agar tidak memotong file.');
  fs.writeFileSync(envPath, out.join('\n') + '\n', { mode: 0o600 });
  try { fs.chmodSync(envPath, 0o600); } catch {}
  // Update memori bot agar langsung berlaku tanpa restart
  if (pairs.DIGIFLAZZ_USERNAME !== undefined) cfg.digiflazz.username = pairs.DIGIFLAZZ_USERNAME;
  if (pairs.DIGIFLAZZ_API_KEY !== undefined) cfg.digiflazz.apiKey = pairs.DIGIFLAZZ_API_KEY;
  if (pairs.PPOB_MARGIN !== undefined) cfg.digiflazz.margin = num(pairs.PPOB_MARGIN, cfg.digiflazz.margin);
  if (pairs.DIGIFLAZZ_WEBHOOK_ID !== undefined) cfg.digiflazz.webhook.id = pairs.DIGIFLAZZ_WEBHOOK_ID;
  if (pairs.DIGIFLAZZ_WEBHOOK_URL !== undefined) cfg.digiflazz.webhook.url = pairs.DIGIFLAZZ_WEBHOOK_URL.replace(/\/$/, '');
  if (pairs.DIGIFLAZZ_WEBHOOK_SECRET !== undefined) cfg.digiflazz.webhook.secret = pairs.DIGIFLAZZ_WEBHOOK_SECRET;
  if (pairs.DIGIFLAZZ_WEBHOOK_ACTIVE !== undefined) cfg.digiflazz.webhook.active = String(pairs.DIGIFLAZZ_WEBHOOK_ACTIVE).toLowerCase() === 'true';
  if (pairs.P2P_GATEWAY_URL !== undefined) cfg.p2p.gatewayUrl = pairs.P2P_GATEWAY_URL.replace(/\/$/, '');
  if (pairs.P2P_API_KEY !== undefined) cfg.p2p.apiKey = pairs.P2P_API_KEY;
  if (pairs.WEBHOOK_SECRET !== undefined) cfg.webhook.secret = pairs.WEBHOOK_SECRET;
  if (pairs.WEBHOOK_BASE_URL !== undefined) cfg.webhook.baseUrl = pairs.WEBHOOK_BASE_URL.replace(/\/$/, '');
  if (pairs.ADMIN_USERNAME !== undefined) { cfg.adminUsername = pairs.ADMIN_USERNAME.replace(/^@/, ''); cfg.supportText = cfg.adminUsername ? '@' + cfg.adminUsername : 'Hubungi admin'; }
  cfg.refreshFlags();
  return envPath;
};
module.exports = cfg;

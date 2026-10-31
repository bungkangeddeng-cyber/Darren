// ============================================================
// Konfigurasi bot — dibaca dari environment / .env
// Prioritas: process.env -> default
// JANGAN hardcode token di sini.
// ============================================================
require('dotenv').config();

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

module.exports = {
  botToken: process.env.BOT_TOKEN || '',
  adminId: num(process.env.ADMIN_ID, 0), // FIXED: no hardcoded admin; 0 = no admin until configured

  vpn: {
    apiBase: (process.env.VPN_API_BASE || 'http://127.0.0.1:5888').replace(/\/$/, ''),
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

  p2p: {
    gatewayUrl: (process.env.P2P_GATEWAY_URL || '').replace(/\/$/, ''), // FIXED: must be set in .env
    apiKey: process.env.P2P_API_KEY || '',
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
  qrisExpireMinutes: 30,
  requiredChannelId: '',
  requiredChannelUrl: '', // Channel Aji diatur via panel admin; kosong = tidak ada channel wajib bawaan,
  roles: ['bronze', 'silver', 'gold'],
  storePhoto: '',
  syncMinutes: 60,
  trxMaxPolls: 20,
  trxPollMs: 5000,
};

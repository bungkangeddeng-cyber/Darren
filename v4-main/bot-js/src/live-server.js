'use strict';
// Live Server — helper status (Fase 3, adaptasi draf untuk bot-js live).
// Deploy: /root/bot-js/src/live-server.js (server2, VPS dulu).
// Tanpa dependensi baru: axios (sudah dipakai bot-js) + net.
// TIDAK PERNAH membaca/menampilkan kredensial server; remote dicek lewat
// health gate yang sama dengan jalur tambah server (modules/servers).
const net = require('net');
const axios = require('axios');
const srvTools = require('../modules/servers');

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tcpProbe(host, port, ms) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (ok) => { try { sock.destroy(); } catch (_) {} resolve(ok); };
    sock.setTimeout(ms);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    sock.connect(port, host);
  });
}

// Status server lokal (server2): vpn-api /health + listener Xray/nginx/haproxy.
async function checkLocal() {
  const t0 = Date.now();
  let vpnApi = { ok: false, ms: -1 };
  try {
    const r = await axios.get('http://127.0.0.1:5890/health', { timeout: 3000 });
    vpnApi = { ok: r.status === 200 && r.data && r.data.status === 'success', ms: Date.now() - t0 };
  } catch (_) {
    vpnApi = { ok: false, ms: Date.now() - t0 };
  }
  const ports = [];
  for (let p = 10000; p <= 10008; p++) ports.push(p);
  const results = await Promise.all(ports.map((p) => tcpProbe('127.0.0.1', p, 1000)));
  const xrayOpen = results.filter(Boolean).length;
  const [nginx, haproxy] = await Promise.all([
    tcpProbe('127.0.0.1', 81, 1000),
    tcpProbe('127.0.0.1', 443, 1000),
  ]);
  return { vpnApi, xrayOpen, xrayTotal: ports.length, nginx, haproxy };
}

// Status satu server remote dari tabel servers (health gate add-server).
async function checkRemote(server) {
  const t0 = Date.now();
  try {
    const h = await srvTools.checkServerHealth(server.api_base, 5000);
    return { ok: !!h.ok, ms: Date.now() - t0 };
  } catch (_) {
    return { ok: false, ms: Date.now() - t0 };
  }
}

function formatStatus(local, remotes) {
  const lines = ['🖥️ <b>LIVE SERVER</b>\n'];
  lines.push('<b>📍 Lokal (server2)</b>');
  lines.push('bot Telegram: ✅ ONLINE');
  lines.push(`vpn-api: ${local.vpnApi.ok ? '✅ ONLINE' : '❌ OFFLINE'}${local.vpnApi.ms >= 0 ? ` (${local.vpnApi.ms} ms)` : ''}`);
  lines.push(`Xray: ${local.xrayOpen}/${local.xrayTotal} port terbuka`);
  lines.push(`nginx (:81): ${local.nginx ? '✅ listener aktif' : '❌ tidak merespons'}`);
  lines.push(`haproxy (:443): ${local.haproxy ? '✅ listener aktif' : '❌ tidak merespons'}`);
  if (!remotes.length) {
    lines.push('\n<i>Belum ada server tambahan di tabel servers.</i>');
  } else {
    lines.push('\n<b>🌐 Server tambahan</b>');
    for (const r of remotes) {
      const st = r.health.ok ? `✅ ONLINE (${r.health.ms} ms)` : '❌ OFFLINE';
      const flag = r.server.active ? '' : ' (nonaktif)';
      lines.push(`• <b>${escHtml(r.server.nama)}</b> — <code>${escHtml(r.server.domain)}</code>${flag}\n  ${st}`);
    }
  }
  return lines.join('\n');
}

module.exports = { checkLocal, checkRemote, formatStatus, escHtml };

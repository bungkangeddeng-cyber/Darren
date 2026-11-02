// iplog.js — parser korelasi log untuk Cek Login IP (versi persiapan, BELUM deploy).
// Masalah yang dipecahkan: log Xray saja tidak cukup, karena sumbernya
// localhost setelah proxy lokal. Log nginx (setelah fix PROXY) mencatat
// IP asli client + path + waktu. Modul ini mengkorelasikan keduanya:
//   Xray:  YYYY/MM/DD HH:MM:SS ... email: <username>
//   Nginx: IP - - [DD/Mon/YYYY:HH:MM:SS +0800] "GET /<path> HTTP/1.1" 101
// Aturan korelasi (jujur soal batasnya):
//  - Path nginx dipetakan ke protokol: /vless, /vmess, /trojan, /ss-ws,
//    dan varian -grpc dengan nama protokol yang sama.
//  - Cocok bila selisih waktu <= 3 detik DAN protokolnya sama.
//  - IP localhost / privat diabaikan (itu log lama sebelum fix PROXY).
//  - Bila satu entri nginx cocok untuk >1 email dalam jendela yang sama,
//    cocokannya ditandai ambiguous dan TIDAK dipakai untuk menghitung
//    limit (lebih baik tidak menghukum user karena data ambigu).
//  - Hasilnya adalah "IP login yang terkorelasi", bukan klaim absolut:
//    bila dua user konek di detik yang sama dengan protokol yang sama,
//    laporan akan menandai ambiguitas itu, bukan memaksakan angka.
// Modul ini read-only: tidak menghapus, tidak mengunci, tidak mengirim
// apa pun. Penguncian (bila user setuju deploy) harus jadi langkah
// terpisah, reversibel, dan hanya dari menu admin, bukan otomatis
// menghapus akun.
const fs = require('fs');

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function protoFromPath(path) {
  if (!path) return null;
  if (path.startsWith('/vless')) return 'vless';
  if (path.startsWith('/vmess')) return 'vmess';
  if (path.startsWith('/trojan')) return 'trojan';
  if (path.startsWith('/ss-ws') || path.startsWith('/ss-grpc')) return 'shadowsocks';
  return null;
}

function isPrivateIp(ip) {
  return ip === '127.0.0.1' || ip === '::1' ||
    /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

function parseNginxLine(line) {
  // 104.29.x.x - - [02/Nov/2026:10:12:55 +0800] "GET /vless HTTP/1.1" 101 898
  const m = line.match(/^(\S+) \S+ \S+ \[(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) [^\]]+\] "GET (\S+) HTTP/);
  if (!m) return null;
  const proto = protoFromPath(m[8]);
  if (!proto) return null;
  const time = Date.UTC(+m[4], MONTHS[m[3]], +m[2], +m[5], +m[6], +m[7]);
  return { ip: m[1], proto, time };
}

function parseXrayLine(line) {
  // 2026/11/02 10:12:55.973089 from 127.0.0.1:44602 accepted ... email: FixIP1
  const m = line.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d+)? .* email: (\S+)/);
  if (!m) return null;
  const time = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return { email: m[7], time };
}

function protoOfEmail(_email) {
  // Email Xray = username akun, protokolnya tidak ada di log Xray.
  // Korelasi memakai path nginx, jadi email tidak perlu dipetakan
  // ke protokol di sini; kecocokan waktu + path-lah yang menentukan.
  return null;
}

function correlate(xrayText, nginxText, windowMs = 3000) {
  const nginx = nginxText.split('\n').map(parseNginxLine).filter(Boolean)
    .filter(n => !isPrivateIp(n.ip));
  const xray = xrayText.split('\n').map(parseXrayLine).filter(Boolean);
  // Indeks nginx per protokol, urut waktu.
  const byProto = {};
  for (const n of nginx) (byProto[n.proto] = byProto[n.proto] || []).push(n);
  const result = {}; // email -> { ips: Set, ambiguous: boolean, lastSeen, samples: [] }
  // Untuk tiap entri Xray, cari nginx terdekat dalam jendela.
  // Karena protokol email tidak diketahui dari log Xray, kita coba
  // semua protokol: ambil kecocokan terdekat secara global, dan bila
  // ada >1 email yang mengklaim entri nginx yang sama dalam jendela,
  // tandai ambiguous (langkah kedua di bawah).
  const claims = new Map(); // nginx index -> [email]
  const matches = []; // { email, ip, time, nginxIdx }
  const allNginx = nginx.map((n, i) => ({ ...n, idx: i }));
  for (const x of xray) {
    let best = null;
    for (const n of allNginx) {
      const diff = Math.abs(n.time - x.time);
      if (diff <= windowMs && (!best || diff < best.diff)) best = { ...n, diff };
    }
    if (best) {
      matches.push({ email: x.email, ip: best.ip, time: x.time, nginxIdx: best.idx });
      if (!claims.has(best.idx)) claims.set(best.idx, []);
      claims.get(best.idx).push(x.email);
    }
  }
  for (const m of matches) {
    const ambiguous = claims.get(m.nginxIdx).length > 1;
    if (!result[m.email]) result[m.email] = { ips: new Set(), ambiguous: false, lastSeen: 0, samples: [] };
    if (ambiguous) { result[m.email].ambiguous = true; continue; }
    result[m.email].ips.add(m.ip);
    if (m.time > result[m.email].lastSeen) result[m.email].lastSeen = m.time;
    if (result[m.email].samples.length < 10) result[m.email].samples.push(m.ip);
  }
  const out = {};
  for (const [email, r] of Object.entries(result)) {
    out[email] = { ips: [...r.ips].sort(), count: r.ips.size, ambiguous: r.ambiguous, lastSeen: r.lastSeen ? new Date(r.lastSeen).toISOString() : null };
  }
  return out;
}

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

module.exports = { protoFromPath, isPrivateIp, parseNginxLine, parseXrayLine, correlate, readIfExists };

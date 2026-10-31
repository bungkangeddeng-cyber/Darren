// ============================================================
// Modul Registrasi IP Lisensi Script — tulis ke repo GitHub
// Dipakai alur Sewa Script: setelah pembayaran lunas, bot
// langsung menulis baris "### username expiry ip" ke file ip
// di repo GitHub pemilik (GitHub Contents API).
//
// Konfigurasi lewat .env (JANGAN hardcode token di kode):
//   GH_IP_TOKEN   = token GitHub pemilik repo (scope: repo)
//   GH_IP_OWNER   = ajijainalganteng-wq
//   GH_IP_REPO    = WendyVpn
//   GH_IP_FILE    = ip
//   GH_IP_BRANCH  = main
// ============================================================
const axios = require('axios');

const OWNER = process.env.GH_IP_OWNER || '';
const REPO = process.env.GH_IP_REPO || '';
const FILE = process.env.GH_IP_FILE || '';
const BRANCH = process.env.GH_IP_BRANCH || 'main';
const TOKEN = process.env.GH_IP_TOKEN || '';

const api = () =>
  axios.create({
    baseURL: 'https://api.github.com',
    timeout: 20000,
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'wendyvpn-bot-js',
    },
  });

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

// Ambil isi file ip + sha terbaru
async function fetchIpFile() {
  const { data } = await api().get(`/repos/${OWNER}/${REPO}/contents/${FILE}`, {
    params: { ref: BRANCH },
  });
  const content = Buffer.from(data.content || '', 'base64').toString('utf-8');
  return { sha: data.sha, content };
}

// Tulis kembali file ip
async function putIpFile(content, sha, message) {
  const { data } = await api().put(`/repos/${OWNER}/${REPO}/contents/${FILE}`, {
    message,
    content: Buffer.from(content, 'utf-8').toString('base64'),
    sha,
    branch: BRANCH,
  });
  return data;
}

// Cari baris penyewa: "### username expiry ip"
function findLine(lines, username) {
  return lines.findIndex((l) => {
    const t = l.trim();
    if (!t.startsWith('###')) return false;
    return t.split(/\s+/)[1] === username;
  });
}

// ------------------------------------------------------------
// registerIp(username, days, ip)
// - Penyewa baru: expiry = hari ini + days, baris disisipkan
//   setelah penanda #limit
// - Penyewa lama: expiry diperpanjang dari expiry lama + days
// Mengembalikan { success, expiry } atau { success:false, message }
// ------------------------------------------------------------
async function registerIp(username, days, ip) {
  if (!OWNER || !REPO || !FILE || !TOKEN) return { success: false, message: 'Registrasi IP belum dikonfigurasi (.env GH_IP_*).' };
  if (!TOKEN) return { success: false, message: 'GH_IP_TOKEN belum diisi di .env server.' };
  try {
    const { sha, content } = await fetchIpFile();
    const lines = content.split('\n');
    const today = new Date();
    let expiry;

    const idx = findLine(lines, username);
    if (idx >= 0) {
      const parts = lines[idx].trim().split(/\s+/);
      const oldExp = parts[2] || '';
      if (oldExp === 'lifetime') {
        expiry = 'lifetime';
      } else {
        const base = /^\d{4}-\d{2}-\d{2}$/.test(oldExp) ? new Date(oldExp + 'T00:00:00') : today;
        expiry = fmtDate(addDays(base < today ? today : base, days));
      }
      lines[idx] = `### ${username} ${expiry} ${ip}`;
    } else {
      expiry = fmtDate(addDays(today, days));
      const marker = lines.findIndex((l) => l.trim() === '#limit');
      const newLine = `### ${username} ${expiry} ${ip}`;
      if (marker >= 0) lines.splice(marker + 1, 0, newLine);
      else lines.push(newLine);
    }

    await putIpFile(lines.join('\n'), sha, `lisensi: ${username} s.d ${expiry} (${ip})`);
    return { success: true, expiry };
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    return { success: false, message: `GitHub: ${msg}` };
  }
}

// Hapus lisensi penyewa dari file ip
async function removeIp(username) {
  if (!TOKEN) return { success: false, message: 'GH_IP_TOKEN belum diisi di .env server.' };
  try {
    const { sha, content } = await fetchIpFile();
    const lines = content.split('\n');
    const idx = findLine(lines, username);
    if (idx < 0) return { success: false, message: 'Penyewa tidak ditemukan.' };
    lines.splice(idx, 1);
    await putIpFile(lines.join('\n'), sha, `lisensi: hapus ${username}`);
    return { success: true };
  } catch (e) {
    const msg = e.response?.data?.message || e.message;
    return { success: false, message: `GitHub: ${msg}` };
  }
}

module.exports = { registerIp, removeIp };

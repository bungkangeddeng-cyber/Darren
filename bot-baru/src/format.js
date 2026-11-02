// Format murni (tanpa Telegram/DB) — mudah dites, tanpa angka karangan.
// Waktu selalu WIB (Asia/Jakarta) meski server VPS berzona lain.
function formatUptime(startMs, nowMs = Date.now()) {
  const s = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}h ${h}j ${m}m ${sec}d`;
  if (h > 0) return `${h}j ${m}m ${sec}d`;
  if (m > 0) return `${m}m ${sec}d`;
  return `${sec}d`;
}
function formatWib(date = new Date()) {
  // Locale id-ID memakai titik sebagai pemisah jam (20.19.28); ubah ke
  // titik dua agar tampil seperti jam pada umumnya (20:19:28 WIB).
  const time = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date).replace(/\./g, ':');
  const day = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  return { time, date: day };
}
module.exports = { formatUptime, formatWib };

// ============================================================
// Auto-cleanup — hapus akun trial menumpuk, akun kadaluarsa,
// dan akun tidak terpakai. Notif expire dikirim MAKSIMAL 1x
// per akun (anti-spam).
// ============================================================
const { run, get, all } = require('../src/db');
const vpn = require('./vpn');

const today = () => new Date().toISOString().slice(0, 10);

async function alreadyNotified(accountId) {
  const row = await get('SELECT 1 FROM notified_expired WHERE account_id = ?', [accountId]);
  return !!row;
}

async function markNotified(accountId) {
  await run('INSERT OR IGNORE INTO notified_expired (account_id) VALUES (?)', [accountId]);
}

// Hapus akun kadaluarsa; kirim notif 1x bila belum pernah
async function cleanupExpired(notifyFn) {
  const rows = await all("SELECT * FROM vpn_accounts WHERE date(expiry) < date('now')");
  let deleted = 0, notified = 0;
  let failed = 0;
  for (const acc of rows) {
    // FIXED: only delete the DB row after the server confirms deletion.
    // Previously the row was deleted even when server delete failed,
    // leaving a live orphan account on the server.
    const res = await vpn.deleteAccount(acc.proto, acc.username, await vpn.getServer(acc.server_id).catch(() => null)).catch(() => ({ success: false }));
    if (!res || !res.success) { failed++; continue; }
    await run('DELETE FROM vpn_accounts WHERE id = ?', [acc.id]);
    deleted++;
    // Trial yang dihapus: tanpa notif. Reguler: notif 1x.
    if (!acc.is_trial && !(await alreadyNotified(acc.id))) {
      await markNotified(acc.id);
      if (notifyFn) await notifyFn(acc).catch(() => {});
      notified++;
    }
  }
  return { deleted, notified, failed };
}

// Hapus trial yang menumpuk (lebih dari maxAge hari sejak dibuat)
async function cleanupOldTrials(maxAgeDays = 3) {
  const rows = await all(
    "SELECT * FROM vpn_accounts WHERE is_trial = 1 AND date(created_at, '+' || ? || ' days') < date('now')",
    [maxAgeDays]
  );
  let failed = 0, deleted = 0;
  for (const acc of rows) {
    const res = await vpn.deleteAccount(acc.proto, acc.username, await vpn.getServer(acc.server_id).catch(() => null)).catch(() => ({ success: false }));
    if (!res || !res.success) { failed++; continue; }
    await run('DELETE FROM vpn_accounts WHERE id = ?', [acc.id]);
    deleted++;
  }
  return { deleted, failed };
}

// Dry-run: tampilkan yang akan dihapus tanpa eksekusi
async function dryRun() {
  const expired = await all("SELECT proto, username, expiry, is_trial FROM vpn_accounts WHERE date(expiry) < date('now')");
  const oldTrials = await all(
    "SELECT proto, username, created_at FROM vpn_accounts WHERE is_trial = 1 AND date(created_at, '+3 days') < date('now')"
  );
  return { expired, oldTrials };
}

module.exports = { cleanupExpired, cleanupOldTrials, dryRun };

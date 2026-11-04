// ============================================================
// Receiver webhook deposit — bot-js (server2)
// Draf siap-deploy (VPS dulu, GitHub kalau sudah sempurna).
// Jalur: POST /webhook/deposit  |  GET /health (pong)
// Keamanan: HMAC-SHA256 atas raw body, secret dari env WEBHOOK_SECRET.
// Tanpa secret -> 503 fail-closed (tidak pernah kredit tanpa verifikasi).
// Kredit mengikuti PERSIS pola poller deposit di app.js:
//   klaim atomik BEGIN IMMEDIATE + guard status pending -> addSaldo ->
//   COMMIT; verifikasi nominal (toleransi <=1000, selebihnya mismatch);
//   paid tanpa nominal -> status review + notifikasi user.
// Dedupe: klaim guard (tidak pernah dobel kredit) + tabel audit
// webhook_deliveries untuk jejak setiap pengiriman.
// Modul ini TIDAK me-require app.js (hindari circular require):
// app.js mengoper ctx { bot, ppob, settings, digi, esc, notifGrup, db }.
// ============================================================
'use strict';

const http = require('http');
const crypto = require('crypto');

const MAX_BODY = 256 * 1024;

function normSig(v) {
  let s = String(v || '').trim().toLowerCase();
  if (s.startsWith('sha256=')) s = s.slice(7);
  return s;
}

function verifySig(secret, rawBody, headerVal) {
  try {
    const expect = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const got = normSig(headerVal);
    if (!got || got.length !== expect.length) return false;
    return crypto.timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(expect, 'utf8'));
  } catch { return false; }
}

// Ambil field dari berbagai varian payload gateway (top-level atau .data).
function pick(obj, names) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const n of names) {
    if (obj[n] !== undefined && obj[n] !== null && obj[n] !== '') return obj[n];
  }
  const d = obj.data;
  if (d && typeof d === 'object') {
    for (const n of names) {
      if (d[n] !== undefined && d[n] !== null && d[n] !== '') return d[n];
    }
  }
  return undefined;
}

function start(ctx) {
  const { bot, ppob, settings, digi, esc, notifGrup, db } = ctx;
  const secret = ctx.secret || '';
  const port = Number(ctx.port) || 8899;
  const host = ctx.host || '127.0.0.1';
  const { run, get } = db;

  // Tabel audit pengiriman (idempotent terhadap start ulang).
  run(`CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT DEFAULT '',
    ref_key TEXT DEFAULT '',
    result TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`).catch(() => {});

  async function audit(event, refKey, result) {
    await run(
      'INSERT INTO webhook_deliveries (event, ref_key, result) VALUES (?,?,?)',
      [event || '', refKey || '', result || '']
    ).catch(() => {});
  }

  async function notifyUser(tgId, text) {
    try {
      await bot.telegram.sendMessage(tgId, text, { parse_mode: 'HTML' });
    } catch { /* abaikan: user mungkin block bot */ }
  }

  // Alur kredit sukses — cermin poller deposit (app.js).
  async function handlePaid(payload, refKey) {
    const ref = pick(payload, ['reference', 'ref_id', 'ref', 'order_id']);
    const qris = pick(payload, ['qris_id', 'payment_id', 'qrisId']);
    const paidAmountRaw = pick(payload, ['paid_amount', 'paidAmount', 'amount', 'nominal']);

    const tx = await get(
      `SELECT * FROM transactions WHERE type = 'deposit' AND status = 'pending'
       AND (ref_id = ? OR payment_id = ?) ORDER BY id DESC LIMIT 1`,
      [ref || '', qris || '']
    ).catch(() => null);
    if (!tx) {
      // Replay pengiriman sukses: bukan "tidak ditemukan" — transaksi sudah
      // lunas sebelumnya. Kembalikan already_processed agar gateway tidak
      // mengulang kirim dan log tidak menyesatkan.
      const done = await get(
        `SELECT * FROM transactions WHERE type = 'deposit' AND status = 'success'
         AND (ref_id = ? OR payment_id = ?) ORDER BY id DESC LIMIT 1`,
        [ref || '', qris || '']
      ).catch(() => null);
      if (done) {
        await audit('payment.success', refKey, 'already_processed');
        return { ok: true, result: 'already_processed' };
      }
      console.error('[webhook] transaksi pending tidak ditemukan:', refKey);
      await audit('payment.success', refKey, 'not_found');
      return { ok: false, error: 'transaksi_tidak_ditemukan' };
    }

    // Paid tanpa nominal = tidak terverifikasi -> review (pola poller).
    if (paidAmountRaw == null) {
      const mv = await run(
        `UPDATE transactions SET status = 'review' WHERE ref_id = ? AND status = 'pending'`,
        [tx.ref_id]
      ).catch(() => ({ changes: 0 }));
      if (mv.changes) {
        await notifyUser(tx.telegram_id,
          `⚠️ <b>Pembayaran tercatat, menunggu verifikasi admin.</b>\n\nPembayaran deposit kamu sudah tercatat di gateway, tapi nominalnya belum bisa diverifikasi. Admin akan memeriksa dan mengkreditkan manual.`);
        console.error('[webhook] paid tanpa nominal, ditandai review:', tx.ref_id);
      }
      await audit('payment.success', refKey, 'review');
      return { ok: true, result: 'review' };
    }

    // Verifikasi nominal (pola poller): selisih >1000 = mismatch, jangan kredit.
    const paidAmount = Number(paidAmountRaw);
    if (Math.abs(paidAmount - Number(tx.amount)) > 1000) {
      if (!tx.mismatch_notified) {
        await run(`UPDATE transactions SET mismatch_notified = 1 WHERE ref_id = ?`,
          [tx.ref_id]).catch(() => {});
        await notifyUser(tx.telegram_id,
          `⚠️ <b>Nominal deposit tidak cocok.</b>\n\nPembayaran kamu tercatat, tapi nominalnya tidak sama dengan deposit yang dibuat (<b>${digi.rp(tx.amount)}</b>). Hubungi admin dengan Ref <code>${esc(tx.ref_id)}</code>.`);
      }
      console.error('[webhook] nominal tidak cocok, tidak dikreditkan:', tx.ref_id,
        'db=', tx.amount, 'gateway=', paidAmount);
      await audit('payment.success', refKey, 'mismatch');
      return { ok: true, result: 'mismatch' };
    }

    // Klaim atomik + kredit (pola poller persis).
    let s = null;
    try {
      await run('BEGIN IMMEDIATE');
      const r = await run(
        `UPDATE transactions SET status = 'success' WHERE ref_id = ? AND status = 'pending'`,
        [tx.ref_id]
      );
      if (!r.changes) { await run('ROLLBACK'); await audit('payment.success', refKey, 'already_processed'); return { ok: true, result: 'already_processed' }; }
      s = await ppob.addSaldo(tx.telegram_id, tx.amount);
      await run('COMMIT');
    } catch (e) {
      await run('ROLLBACK').catch(() => {});
      console.error('[webhook] klaim+kredit gagal, di-rollback:', tx.ref_id, e.message);
      throw e;
    }

    // Otomatis jadi reseller (pola poller persis).
    try {
      const minRes = await settings.getResellerMinTopup();
      if (minRes > 0) {
        const curRole = await ppob.getRole(tx.telegram_id).catch(() => 'member');
        if (curRole === 'member') {
          const tot = await get(
            `SELECT COALESCE(SUM(amount),0) AS t FROM transactions
             WHERE telegram_id = ? AND type = 'deposit' AND status = 'success'`,
            [tx.telegram_id]
          ).catch(() => ({ t: 0 }));
          if (Number(tot?.t || 0) >= minRes) {
            await ppob.setRole(tx.telegram_id, 'reseller');
            await notifyUser(tx.telegram_id,
              `🏪 <b>Selamat! Kamu kini RESELLER</b>\n\nTotal topup kamu mencapai <b>${digi.rp(minRes)}</b>.\nNikmati harga khusus reseller untuk VPN!`);
            notifGrup(bot, `🏪 <b>User naik jadi Reseller</b>\n👤 ID: <code>${tx.telegram_id}</code>\n💰 Total topup: <b>${digi.rp(tot.t)}</b>`);
          }
        }
      }
    } catch (e) { console.error('[webhook] auto-reseller error:', e.message); }

    await notifyUser(tx.telegram_id,
      `✅ <b>Deposit diterima!</b>\n💰 <b>${digi.rp(tx.amount)}</b> masuk ke saldo kamu.` +
      `\n🧾 Ref: <code>${esc(tx.ref_id)}</code>` +
      `\n💳 Saldo sekarang: <b>${digi.rp(s.saldo)}</b>`);
    console.log(`[webhook] ${tx.ref_id} lunas (webhook) → saldo +${tx.amount} (tg:${tx.telegram_id})`);
    await audit('payment.success', refKey, 'credited');
    return { ok: true, result: 'credited' };
  }

  async function handleExpired(payload, refKey) {
    const ref = pick(payload, ['reference', 'ref_id', 'ref', 'order_id']);
    const qris = pick(payload, ['qris_id', 'payment_id', 'qrisId']);
    const r = await run(
      `UPDATE transactions SET status = 'expired' WHERE type = 'deposit' AND status = 'pending'
       AND (ref_id = ? OR payment_id = ?)`,
      [ref || '', qris || '']
    ).catch(() => ({ changes: 0 }));
    await audit('payment.expired', refKey, r.changes ? 'expired' : 'already_processed');
    return { ok: true, result: r.changes ? 'expired' : 'already_processed' };
  }

  const server = http.createServer((req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    if (req.method === 'GET' && req.url.split('?')[0] === '/health') {
      return send(200, { ok: true, service: 'deposit-webhook' });
    }
    if (req.method !== 'POST' || req.url.split('?')[0] !== '/webhook/deposit') {
      return send(404, { ok: false, error: 'not_found' });
    }
    if (!secret) {
      return send(503, { ok: false, error: 'webhook_belum_dikonfigurasi' });
    }

    const chunks = [];
    let tooBig = false;
    req.on('data', (c) => {
      if (tooBig) return;
      chunks.push(c);
      if (Buffer.concat(chunks).length > MAX_BODY) { tooBig = true; send(413, { ok: false, error: 'body_terlalu_besar' }); req.destroy(); }
    });
    req.on('end', async () => {
      if (tooBig) return;
      try {
        const raw = Buffer.concat(chunks);
        const sig = req.headers['x-webhook-signature'] || req.headers['x-signature'] || '';
        if (!verifySig(secret, raw, sig)) {
          console.error('[webhook] signature tidak valid');
          return send(401, { ok: false, error: 'signature_tidak_valid' });
        }
        let payload;
        try { payload = JSON.parse(raw.toString('utf8')); }
        catch { return send(400, { ok: false, error: 'json_tidak_valid' }); }

        const event = String(payload.event || payload.type || '');
        const refKey = String(pick(payload, ['reference', 'ref_id', 'ref', 'order_id', 'qris_id', 'payment_id']) || '');
        if (event === 'webhook.ping') return send(200, { ok: true, status: 'pong' });
        if (event === 'payment.success') return send(200, await handlePaid(payload, refKey));
        if (event === 'payment.expired') return send(200, await handleExpired(payload, refKey));
        await audit(event, refKey, 'unknown_event');
        return send(200, { ok: false, error: 'event_tidak_dikenal' });
      } catch (e) {
        console.error('[webhook] error:', e.message);
        return send(500, { ok: false, error: 'internal' });
      }
    });
  });

  server.on('error', (e) => console.error('[webhook] server error:', e.message));
  server.listen(port, host, () => {
    console.log(`[webhook] receiver jalan di ${host}:${port} (POST /webhook/deposit)`);
  });
  return server;
}

module.exports = { start };

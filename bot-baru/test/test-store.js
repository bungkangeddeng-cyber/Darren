// Tes logika saldo/harga/PPOB-gate di SQLite TERPISAH (/tmp, bukan DB bot lama).
// Jalankan: DB_PATH=/tmp/bot-baru-test.db node test/test-store.js
process.env.DB_PATH = process.env.DB_PATH || '/tmp/bot-baru-test.db';
const fs = require('fs');
try { fs.unlinkSync(process.env.DB_PATH); } catch {}
const db = require('../src/db');
const digi = require('../src/digiflazz');
(async () => {
  await db.init();
  const uid = 999001;
  await db.ensureUser(uid, 'tester');
  console.log('saldo awal:', await db.getBalance(uid));
  const deductFail = await db.deductBalance(uid, 15000, 'tes kurang saldo');
  console.log('deduct saat saldo 0 (harus false):', deductFail);
  await db.addBalance(uid, 20000, 'tes deposit');
  console.log('saldo setelah +20000:', await db.getBalance(uid));
  console.log('harga vless member/hari:', await db.getPrice('vless', 'member'));
  console.log('harga vless 30 hari:', (await db.getPrice('vless', 'member')) * 30);
  const ok = await db.deductBalance(uid, 15000, 'tes beli vless 30h');
  console.log('deduct 15000 (harus true):', ok, 'saldo akhir:', await db.getBalance(uid));
  await db.setPrice('vless', 'member', 600);
  console.log('harga vless member setelah set 600:', await db.getPrice('vless', 'member'));
  console.log('trial pertama boleh:', await db.canClaimTrial(uid));
  await db.recordTrialClaim(uid);
  console.log('trial kedua dalam 24 jam (harus false):', await db.canClaimTrial(uid));
  console.log('PPOB enabled tanpa Digiflazz (harus false):', digi.enabled());
  try { await digi.priceList('prepaid'); console.log('PPOB priceList: TIDAK MENOLAK (SALAH)'); }
  catch (e) { console.log('PPOB priceList menolak dengan benar:', e.message); }
  // Deposit manual: pending TIDAK menambah saldo sampai admin approve.
  const dep = await db.run('INSERT INTO deposits (telegram_id, amount, status) VALUES (?,?,?)', [uid, 50000, 'pending']);
  console.log('deposit pending ID', dep.id, 'saldo tetap:', await db.getBalance(uid), '(harus 5000)');
  await db.run('UPDATE deposits SET status=? WHERE id=?', ['approved', dep.id]);
  await db.addBalance(uid, 50000, 'deposit manual #' + dep.id);
  console.log('setelah admin approve, saldo:', await db.getBalance(uid), '(harus 55000)');
  // PPOB lifecycle (tanpa panggil Digiflazz live): ref_id unik, kunci, refund.
  const ref = 'ppob-test-' + Date.now();
  await db.run('INSERT INTO ppob_orders (ref_id, telegram_id, sku, product_name, customer_no, price_sell, status) VALUES (?,?,?,?,?,?,?)', [ref, uid, 'TESTSKU', 'Pulsa Test', '081234567890', 10000, 'pending']);
  await db.deductBalance(uid, 10000, 'ppob pending lock ' + ref);
  await db.run('UPDATE ppob_orders SET locked=1 WHERE ref_id=?', [ref]);
  console.log('PPOB pending terkunci, saldo:', await db.getBalance(uid), '(harus 45000)');
  // Simulasi cek status akhirnya gagal -> refund.
  await db.addBalance(uid, 10000, 'refund ppob gagal ' + ref);
  await db.run('UPDATE ppob_orders SET status=?, locked=0 WHERE ref_id=?', ['gagal', ref]);
  console.log('PPOB gagal direfund, saldo:', await db.getBalance(uid), '(harus 55000)');
  try { await db.run('INSERT INTO ppob_orders (ref_id, telegram_id, sku, product_name, customer_no, price_sell) VALUES (?,?,?,?,?,?)', [ref, uid, 'X', 'Y', '0812', 1000]); console.log('ref_id duplikat: TIDAK DITOLAK (SALAH)'); }
  catch (e) { console.log('ref_id duplikat ditolak dengan benar (UNIQUE).'); }
  console.log('cek status <1 menit (harus ditolak):', digi.canCheckStatus(new Date().toISOString(), new Date().toISOString()));
  console.log('cek status >90 hari (harus ditolak):', digi.canCheckStatus(null, new Date(Date.now() - 91 * 86400000).toISOString()));
  console.log('aksi saldo sukses/pending/gagal:', digi.saldoActionForStatus('Sukses'), '/', digi.saldoActionForStatus('Pending'), '/', digi.saldoActionForStatus('Gagal'));
  console.log('HASIL: LULUS semua asersi logika di atas bila angka sesuai.');
  db.db.close();
})();

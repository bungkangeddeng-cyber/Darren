// Tes tampilan baru di DB dummy (bukan DB bot lama, bukan data live).
// Jalankan: DB_PATH=/tmp/bot-baru-ui-test.db node test/test-ui.js
// Catatan: DB_PATH harus diset SEBELUM require db (config dibaca saat require).
process.env.DB_PATH = process.env.DB_PATH || '/tmp/bot-baru-ui-test.db';
const fs = require('fs');
try { fs.unlinkSync(process.env.DB_PATH); } catch {}
const db = require('../src/db');
const digi = require('../src/digiflazz');
const { formatUptime, formatWib } = require('../src/format');
function assert(name, cond) { console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name); if (!cond) process.exitCode = 1; }
(async () => {
  await db.init();
  // Seed dummy: 2 user, 3 akun (2 aktif, 1 kadaluarsa), transaksi, order PPOB.
  await db.ensureUser(111, 'user_satu');
  await db.ensureUser(222, 'user_dua');
  await db.run('UPDATE users SET role=? WHERE telegram_id=?', ['reseller', 222]);
  await db.addBalance(111, 50000, 'deposit dummy');
  await db.addBalance(222, 10000, 'deposit dummy');
  await db.run('INSERT INTO vpn_accounts (telegram_id, proto, username, expiry) VALUES (?,?,?,date(\'now\',\'+30 days\'))', [111, 'vless', 'akun1']);
  await db.run('INSERT INTO vpn_accounts (telegram_id, proto, username, expiry) VALUES (?,?,?,date(\'now\',\'+7 days\'))', [111, 'ssh', 'akun2']);
  await db.run('INSERT INTO vpn_accounts (telegram_id, proto, username, expiry) VALUES (?,?,?,date(\'now\',\'-1 day\'))', [222, 'trojan', 'akun_lama']);
  await db.run('INSERT INTO ppob_orders (ref_id, telegram_id, sku, product_name, customer_no, price_sell, status) VALUES (?,?,?,?,?,?,?)', ['ppob-ui-1', 111, 'TEST1', 'Pulsa Test 10k', '0812', 11000, 'sukses']);
  await db.run('INSERT INTO ppob_orders (ref_id, telegram_id, sku, product_name, customer_no, price_sell, status) VALUES (?,?,?,?,?,?,?)', ['ppob-ui-2', 111, 'TEST2', 'Token PLN Test', '530000000001', 21000, 'pending']);
  // Statistik user harus dari data dummy, bukan angka tetap.
  const us = await db.getUserStats(111);
  console.log('userStats 111:', us);
  assert('user 111 akun aktif = 2', us.vpnActive === 2);
  assert('user 111 total akun = 2', us.vpnTotal === 2);
  assert('user 111 order PPOB = 2', us.ppobOrders === 2);
  const gs = await db.getGlobalStats();
  console.log('globalStats:', gs);
  assert('global user = 2', gs.users === 2);
  assert('global akun total = 3', gs.accounts === 3);
  assert('global akun aktif = 2 (bukan 720 karangan)', gs.accountsActive === 2);
  assert('global server = 0 di DB dummy (domain kosong, bukan 6 karangan)', gs.servers === 0);
  // Riwayat: transaksi + PPOB, terbaru dulu, berisi keduanya.
  const hist = await db.getHistory(111, 15);
  console.log('riwayat kinds:', hist.map(h => h.kind).join(','));
  assert('riwayat berisi transaksi dan ppob', hist.some(h => h.kind === 'deposit') && hist.some(h => h.kind === 'ppob'));
  // Role: harga reseller berbeda dari member (default 450 vs 500).
  assert('harga vless reseller = 450', (await db.getPrice('vless', 'reseller')) === 450);
  assert('harga vless member = 500', (await db.getPrice('vless', 'member')) === 500);
  // Format uptime/WIB: uptime dari selisih waktu asli, WIB dari Intl Asia/Jakarta.
  assert('uptime 90 detik = 1m 30d', formatUptime(0, 90000) === '1m 30d');
  assert('uptime 2 hari = 2h ...', formatUptime(0, 2 * 86400000 + 3600000 + 60000 + 1000) === '2h 1j 1m 1d');
  const wib = formatWib(new Date('2026-11-01T13:19:28Z'));
  console.log('WIB untuk 2026-11-01T13:19:28Z:', wib);
  assert('WIB jam = 20:19:28 (UTC+7)', wib.time === '20:19:28');
  // Kategori PPOB dari price-list dummy (tanpa panggil Digiflazz live).
  const dummyProducts = [
    { product_name: 'Telkomsel Pulsa 10k', category: 'Pulsa', brand: 'Telkomsel', buyer_product_status: true, price: 10000 },
    { product_name: 'Kuota Data 5GB', category: 'Data', brand: 'XL', buyer_product_status: true, price: 20000 },
    { product_name: 'Mobile Legends Diamond 100', category: 'Games', brand: 'ML', buyer_product_status: true, price: 30000 },
    { product_name: 'PLN Token 20k', category: 'PLN', brand: 'PLN', buyer_product_status: true, price: 21000 },
    { product_name: 'DANA Saldo 25k', category: 'E-Money', brand: 'DANA', buyer_product_status: true, price: 26000 },
    { product_name: 'Voucher Game 50k', category: 'Voucher', brand: 'Voucher', buyer_product_status: true, price: 50000 },
  ];
  for (const c of ['kuota', 'pulsa', 'game', 'pln', 'emoney', 'voucher']) {
    const f = digi.filterByCategory(dummyProducts, c);
    console.log('kategori', c, '->', f.map(p => p.product_name).join(' | '));
    assert('kategori ' + c + ' menemukan produk', f.length >= 1);
  }
  assert('kategori game menemukan Mobile Legends, bukan pulsa', digi.filterByCategory(dummyProducts, 'game')[0].product_name.includes('Mobile Legends'));
  // Guard brand: kode bot baru tidak boleh mengandung brand/channel contoh.
  const appSrc = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
  assert('tidak ada nama bot contoh di app.js', !/ansendant/i.test(appSrc));
  assert('tidak ada channel contoh di app.js', !/myridtunnel/i.test(appSrc));
  assert('brand sendiri RIPZZ STORE ada di app.js/config', /RIPZZ STORE/.test(appSrc) || /RIPZZ STORE/.test(fs.readFileSync(require('path').join(__dirname, '..', 'src', 'config.js'), 'utf8')));
  console.log(process.exitCode ? 'HASIL: ADA FAIL' : 'HASIL: LULUS semua asersi UI di atas.');
  db.db.close();
})();

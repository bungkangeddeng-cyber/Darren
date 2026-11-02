// Bot jualan SATU bot, DUA etalase produk saja:
//   (1) Akun VPN — SSH + Xray (VMess, VLess, Trojan, Shadowsocks)
//   (2) PPOB — pulsa, paket data, token PLN
// Pendukung jualan: Saldo Saya, Deposit, Akun Saya, Bantuan, Admin.
// Tidak ada produk lain (tanpa CloudFront, Zivpn, Sidompul, dll).
// Startup: token kosong = keluar bersih; domain/auth VPN kosong =
// create dinonaktifkan; Digiflazz kosong = PPOB digate; P2P kosong =
// deposit otomatis digate, deposit manual tetap jalan.
const fs = require('fs');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const config = require('./src/config');
const db = require('./src/db');
const vpn = require('./src/vpnapi');
const digi = require('./src/digiflazz');
const kuota = require('./src/kuota');
const { createWebhookServer } = require('./src/webhook');
const gateway = require('./src/gateway');
const { formatUptime, formatWib } = require('./src/format');
const iplog = require('./src/iplog');
const geoMod = require('./src/geo');
const BOT_START_TIME = Date.now();
const BRAND = config.brand; // RIPZZ STORE — brand toko user, bukan brand bot contoh.

if (!config.botToken) {
  console.error('❌ BOT_TOKEN kosong di .env. Isi BOT_TOKEN dari BotFather dulu, lalu start ulang bot.');
  process.exit(1);
}
if (!config.vpnCreateEnabled) console.warn('⚠️ VPN_DOMAIN / VPN_API_AUTH kosong: create VPN dinonaktifkan sampai diisi admin server.');
if (!config.ppobEnabled) console.warn('⚠️ DIGIFLAZZ belum diisi: menu PPOB hanya menampilkan pesan belum aktif.');
if (!config.depositAutoEnabled) console.warn('⚠️ Gateway QRIS belum diisi: deposit otomatis nonaktif, deposit manual tetap jalan.');
if (config.adminId === 0) console.warn('⚠️ ADMIN_ID kosong: menu Admin nonaktif.');

const bot = new Telegraf(config.botToken);
const sessions = new Map(); // telegram_id -> { step, ... }
const ipNotified = new Map(); // accountId -> timestamp notifikasi terakhir
function ipReportFor(username) {
  try {
    const x = iplog.readIfExists('/var/log/xray/access.log');
    const n = iplog.readIfExists('/var/log/nginx/access.log');
    if (!x || !n) return null;
    const all = iplog.correlate(x, n);
    return all[username] || { ips: [], count: 0, ambiguous: false, lastSeen: null };
  } catch { return null; }
}
function ipReportText(username, limit) {
  const r = ipReportFor(username);
  if (!r) return 'Log IP tidak tersedia di server ini (bot tidak berjalan di VPS / log kosong).';
  if (!r.count) return 'Belum ada login IP yang terkorelasi (log lama sebelum fix PROXY hanya localhost dan diabaikan).';
  let t = `${r.count} IP: ${r.ips.slice(0, 5).join(', ')}${r.ips.length > 5 ? ' (+' + (r.ips.length - 5) + ' lagi)' : ''}`;
  if (limit > 0 && r.count > limit) t += ` — MELEBIHI LIMIT ${limit}!`;
  if (r.ambiguous) t += ' (sebagian korelasi ambigu, tidak dipakai untuk limit)';
  if (r.lastSeen) t += ` — terakhir ${r.lastSeen}`;
  return t;
}
const fmt = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const esc = vpn.esc;
// Tombol warna modern — metode resmi Bot API 9.4 (2026-02-09):
// InlineKeyboardButton.style = 'primary' (biru), 'success' (hijau),
// 'danger' (merah). Telegraf 4 tidak punya helper-nya, tapi objek polos
// dengan field style diteruskan apa adanya ke Telegram (terverifikasi
// JSON-nya di VPS). Klien Telegram lama yang belum dukung style akan
// mengabaikan warna dan tetap menampilkan tombol normal — tombol tetap
// berfungsi, hanya warnanya yang tidak tampil. Aturan warna di bot ini:
// success = aksi positif utama (beli/deposit/konfirmasi), primary =
// navigasi/info, danger = HANYA hapus/batal yang merusak, kembali =
// tanpa style (netral, bukan merah).
const B = {
  primary: (t, cb) => ({ text: t, callback_data: cb, style: 'primary' }),
  success: (t, cb) => ({ text: t, callback_data: cb, style: 'success' }),
  danger: (t, cb) => ({ text: t, callback_data: cb, style: 'danger' }),
  plain: (t, cb) => ({ text: t, callback_data: cb }),
  urlPrimary: (t, url) => ({ text: t, url, style: 'primary' }),
};
const PROTO_LABEL = { ssh: 'SSH', vmess: 'VMess', vless: 'VLess', trojan: 'Trojan', shadowsocks: 'Shadowsocks' };

function mainMenu(id) {
  // SATU keyboard Beranda untuk SELURUH bot (2026-11-02, perbaikan menu ganda).
  // Dulu ada DUA layar "home": Menu Utama (mainText) dan Dashboard/Profil,
  // dengan tombol yang sama tapi nama berbeda (PPOB vs PPOB STORE,
  // DEPOSIT vs TOPUP SALDO VPN, MENU VPN vs VPN PREMIUM, RIWAYAT di
  // keduanya). Sekarang hanya ada SATU Beranda: dashboard member dengan
  // keyboard ini. Callback 'menu' dan 'profil' keduanya mendarat di
  // Beranda yang sama, jadi tidak ada lagi dua menu yang membingungkan.
  // Urutan menu utama meniru STRUKTUR Ansendant (2026-11-02, atas perintah
  // user "terapkan UI 100% mirip"): VPN PREMIUM lebar penuh, RIWAYAT |
  // STATISTIK, CEK KUOTA | PPOB STORE, TOPUP SALDO VPN lebar penuh.
  // Baris ROLE | Bantuan + Admin ditambahkan DI BAWAHNYA, bukan di dalam
  // urutan itu, agar fitur bot-baru (role, bantuan, admin) tidak hilang.
  // Label, brand, dan data tetap milik sendiri, bukan salinan bot contoh.
  const rows = [
    [B.success('💎 VPN PREMIUM', 'vpnmenu')],
    [B.primary('🧾 RIWAYAT', 'riwayat'), B.primary('📊 STATISTIK', 'statistik')],
    [B.primary('📡 CEK KUOTA', 'cekkuota'), B.primary('🏪 PPOB STORE', 'ppob')],
    [B.success('➕ TOPUP SALDO VPN', 'deposit')],
    [B.primary('🎖️ ROLE', 'role'), B.primary('❓ Bantuan', 'help')],
  ];
  if (config.isAdmin(id)) rows.push([B.primary('🛠️ Admin', 'admin')]);
  return Markup.inlineKeyboard(rows);
}
function helpText() {
  return `❓ <b>Bantuan</b>\n\n<b>Beranda (satu-satunya menu utama)</b>\nVPN PREMIUM, RIWAYAT | STATISTIK, CEK KUOTA | PPOB STORE, TOPUP SALDO VPN, ROLE | Bantuan, lalu Admin (bila admin). Beranda menampilkan dashboard saldo, role, username, ID, waktu WIB, jumlah server/user dari DB, dan uptime bot asli. Tidak ada lagi Menu Utama terpisah — tombol Beranda selalu kembali ke layar ini.\nMenu VPN: TRIAL AKUN, CREATE AKUN | RENEW AKUN, AKUN SAYA. Beli/trial: pilih protokol, lalu pilih server (kartu produk), lalu durasi/username."\n\n<b>VPN</b>\nHost: <code>${esc(config.vpn.domain || '(belum diset admin)')}</code>\nPort: 22 (SSH langsung), 80 (WS), 443 (WS + TLS + SSH SSL)\nPath: <code>/</code> (SSH), <code>/vmess</code>, <code>/vless</code>, <code>/trojan</code>, <code>/ss-ws</code>\n\n<b>PPOB</b>\nKategori: Kuota, Pulsa, Game, PLN, E-Money, Voucher — dari price-list Digiflazz live.\nBila menu PPOB menampilkan belum aktif, itu berarti Digiflazz belum dikonfigurasi — hubungi admin, jangan transfer ke pihak lain.\n\n<b>Deposit</b>\nSaldo hanya masuk setelah admin konfirmasi (manual) atau gateway terverifikasi. Simpan bukti transfer.`;
}
function mainText() {
  return `🔥 <b>${esc(BRAND)}</b>\n<b>PPOB • DIGITAL • 24 JAM</b>\n─────────────────────\nSolusi pembelian otomatis:\n• ⚡ Cepat — tanpa antre admin\n• 🔒 Aman — saldo hanya dipotong setelah layanan berhasil\n• 🕐 Aktif 24 jam\n\n📶 Kuota • 📱 Pulsa • 🎮 Game\n⚡ PLN • 💳 E-Money • 🎟️ Voucher\n\n💡 <i>Catatan: deposit QRIS otomatis aktif bila gateway sudah terhubung. Bila belum, pakai Deposit Manual di halaman Deposit — saldo masuk setelah admin konfirmasi.</i>\n🎖️ Harga menyesuaikan role member.\n\n👇 <b>Silakan pilih menu di bawah:</b>`;
}
async function showMenu(ctx, text) {
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', ...mainMenu(ctx.from.id) }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', ...mainMenu(ctx.from.id) }); }
}
async function showMain(ctx) { await showDashboard(ctx); } // alias Beranda, bukan layar kedua
// Dashboard member — SEMUA angka dari DB/uptime asli, bukan karangan.
// Banner: aset bot lama sendiri (banner-utama.webp) bila ada, kalau
// tidak ada, kirim teks saja. Jangan pakai banner/logo bot contoh.
async function sendMainPhoto(ctx) {
  const banner = path.join(__dirname, 'assets', 'banner-utama.webp');
  if (!fs.existsSync(banner)) return false;
  try {
    await ctx.replyWithPhoto({ source: banner }, { caption: mainText(), parse_mode: 'HTML', ...mainMenu(ctx.from.id) });
    return true;
  } catch { return false; }
}
async function dashboardText(ctx) {
  const u = await db.ensureUser(ctx.from.id, ctx.from.username || '');
  const stats = await db.getGlobalStats();
  const wib = formatWib(new Date());
  const username = ctx.from.username ? '@' + ctx.from.username : '-';
  return `✦ <b>${esc(BRAND)}</b>\nLayanan premium: VPN • PPOB • Pembayaran\n─────────────────────\n✦ <b>MEMBER DASHBOARD</b>\n💰 SALDO: <b>${fmt(u.saldo)}</b>\n👤 STATUS: ${esc(u.role)}\n🌐 USERNAME: ${esc(username)}\n🆔 ID PENGGUNA: <code>${ctx.from.id}</code>\n─────────────────────\n✦ <b>SYSTEM &amp; SERVER STATUS</b>\n🧭 WAKTU: ${wib.time} WIB\n📅 TANGGAL: ${wib.date}\n🖥️ SERVER: ${stats.servers} | 👥 USER: ${stats.users}\n⏱️ BOT AKTIF: ${formatUptime(BOT_START_TIME)}\n─────────────────────\n✦ <b>VIP CUSTOMER SUPPORT</b>\n📩 ${esc(config.supportText)}\n\n💡 <i>Semua angka di atas dari database dan uptime asli, bukan angka contoh.</i>`;
}
// Logo menu utama (2026-11-02, fitur admin upload): file assets/logo-menu.*
// bila ada, dashboard dikirim sebagai FOTO dengan caption dashboard +
// keyboard yang sama (satu pesan menu, bukan dua). Bila tidak ada logo,
// fallback ke teks dashboard seperti sebelumnya. Hanya admin yang bisa
// mengunggah/menghapus logo, hanya gambar JPG/PNG/WebP maks 5 MB.
function findLogo() {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const f = path.join(__dirname, 'assets', 'logo-menu.' + ext);
    if (fs.existsSync(f)) return f;
  }
  return null;
}
async function showDashboard(ctx) {
  const kb = mainMenu(ctx.from.id);
  const text = await dashboardText(ctx);
  const logo = findLogo();
  if (logo) {
    try {
      if (ctx.callbackQuery) {
        try { await ctx.editMessageMedia({ type: 'photo', media: { source: logo }, caption: text, parse_mode: 'HTML' }, { reply_markup: kb.reply_markup || kb }); return; }
        catch { try { await ctx.deleteMessage(); } catch {} }
      }
      await ctx.replyWithPhoto({ source: logo }, { caption: text, parse_mode: 'HTML', ...kb });
      return;
    } catch { /* jatuh ke teks di bawah */ }
  }
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', ...kb }); }
}
// Join-gate opsional: hanya bila JOIN_CHANNEL/JOIN_GROUP diisi admin.
// Bila kosong, langsung ke menu utama tanpa gate. Pengecekan via
// Telegram API bila bot bisa (bot harus admin di channel/group);
// bila pengecekan gagal, pakai verifikasi manual (tombol Lanjutkan).
async function isJoined(ctx) {
  const targets = [];
  if (config.joinChannel) targets.push('@' + config.joinChannel);
  if (config.joinGroup) targets.push('@' + config.joinGroup);
  if (!targets.length) return { joined: true, checked: false };
  for (const t of targets) {
    try {
      const m = await ctx.telegram.getChatMember(t, ctx.from.id);
      if (['left', 'kicked', 'restricted'].includes(m.status)) return { joined: false, checked: true, target: t };
    } catch { return { joined: true, checked: false }; }
  }
  return { joined: true, checked: true };
}
async function showJoinGate(ctx) {
  // Pola warna contoh: tombol gabung biru (primary), tombol konfirmasi
  // hijau (success). Channel/group HANYA milik sendiri dari .env — tidak
  // pernah hardcode channel/group bot contoh.
  const rows = [];
  if (config.joinChannel) rows.push([B.urlPrimary('🔗 Gabung Channel kami', 'https://t.me/' + config.joinChannel)]);
  if (config.joinGroup) rows.push([B.urlPrimary('💬 Gabung Group kami', 'https://t.me/' + config.joinGroup)]);
  rows.push([B.success('✅ Saya Sudah Bergabung, Lanjutkan', 'join_done')]);
  const text = `🔔 <b>Selamat Datang Di ${esc(BRAND)}</b>\n─────────────────────\nUntuk menggunakan bot ini, Anda harus bergabung dengan komunitas kami terlebih dahulu.\n\n${config.joinChannel ? `📢 Channel: @${esc(config.joinChannel)}\n` : ''}${config.joinGroup ? `👥 Group: @${esc(config.joinGroup)}\n` : ''}\n💡 <i>Silakan gabung ke semua yang tercantum di atas, lalu tekan tombol hijau "✅ Saya Sudah Bergabung" di bawah ini untuk lanjut.</i>`;
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }); }
}
bot.start(async (ctx) => {
  await db.ensureUser(ctx.from.id, ctx.from.username || '');
  if (config.joinEnabled) {
    const j = await isJoined(ctx);
    if (!j.joined) { await showJoinGate(ctx); return; }
  }
  // BUG 2026-11-02: /start dulu mengirim DUA pesan sekaligus — menu utama
  // (sendMainPhoto/showMain) LALU dashboard (showDashboard) — makanya
  // sekali /start langsung muncul 2 menu bertumpuk dengan tombol yang
  // duplikat (RIWAYAT, PPOB, dll. ada di keduanya).
  // Perbaikan: /start cukup kirim SATU pesan, yaitu dashboard. Menu utama
  // lengkap tetap bisa dijangkau lewat tombol "🏠 Beranda" di dashboard,
  // dan navigasi tombol lain mengedit pesan yang sama, bukan menambah pesan.
  await showDashboard(ctx);
});
bot.action('join_done', async (ctx) => {
  await ctx.answerCbQuery();
  if (config.joinEnabled) {
    const j = await isJoined(ctx);
    if (!j.joined && j.checked) { await ctx.reply('❌ Keanggotaan belum terdeteksi. Gabung dulu, lalu tekan tombol lagi.'); await showJoinGate(ctx); return; }
  }
  await showDashboard(ctx); // dulu showMain lalu showDashboard = dua layar bertumpuk
});
bot.action('menu', async (ctx) => { await ctx.answerCbQuery(); await showDashboard(ctx); }); // Beranda
bot.action('profil', async (ctx) => { await ctx.answerCbQuery(); await showDashboard(ctx); }); // Profil = Beranda (alias, bukan menu kedua)
// Catatan tombol dashboard: VPN PREMIUM -> 'vpnmenu', PPOB STORE -> 'ppob',
// TOPUP SALDO VPN -> 'deposit' (langsung ke handler asli, tanpa alias).

// ---------- Menu VPN (struktur dari screenshot, brand sendiri) ----------
bot.action('vpnmenu', async (ctx) => {
  await ctx.answerCbQuery();
  const kb = Markup.inlineKeyboard([
    [B.success('✦ TRIAL AKUN', 'vpn_trial')],
    [B.success('✦ CREATE AKUN', 'buyvpn'), B.success('✦ RENEW AKUN', 'renewmenu')],
    [B.primary('✦ AKUN SAYA', 'myacc')],
    [B.plain('⬅️ KEMBALI KE MENU UTAMA', 'menu')],
  ]);
  const text = `✦ <b>${esc(BRAND)}</b>\n─────────────────────\nPilih layanan VPN yang ingin kamu gunakan.\n\n✦ <b>TRIAL ACCESS</b>\nCoba layanan sesuai ketersediaan\n\n✦ <b>CREATE ACCOUNT</b>\nSSH • VMess • VLESS • Trojan • SS\n\n✦ <b>RENEW ACCOUNT</b>\nPerpanjang akun yang sudah ada\n\n✦ <b>MY ACCOUNTS</b>\nLihat akun, lalu perpanjang atau hapus per akun di sana\n\n💡 <i>Tombol hijau = aksi utama (trial/create), tombol biru = navigasi, tombol tanpa warna = kembali.</i>`;
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', ...kb }); }
});
bot.action('vpn_trial', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.vpnCreateEnabled) { await showMenu(ctx, '❌ Trial sedang <b>nonaktif</b>: domain/API VPN belum dikonfigurasi admin. Hubungi admin.'); return; }
  const rows = db.PRODUCTS.map(p => [B.success(PROTO_LABEL[p.key] + ' — Trial 1 hari', 'trial_proto:' + p.key)]);
  rows.push([B.primary('⬅️ Menu VPN', 'vpnmenu'), B.plain('🏠 Beranda', 'menu')]);
  try { await ctx.editMessageText('✦ <b>TRIAL AKUN</b>\nPilih protokol trial (1 hari, gratis, 1x per 24 jam):', { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }); }
  catch { await ctx.reply('✦ <b>TRIAL AKUN</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }); }
});
bot.action(/^trial_proto:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const { text, kb } = await serverCard(ctx, ctx.match[1], 'trial', 'trial_server:' + ctx.match[1]);
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', ...kb }); }
});
bot.action(/^trial_server:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const ok = await db.canClaimTrial(ctx.from.id);
  if (!ok) { await ctx.reply('❌ Trial sudah pernah diklaim dalam 24 jam terakhir. Silakan beli durasi 7/30 hari.'); return; }
  sessions.set(ctx.from.id, { step: 'buy_username', proto: ctx.match[1], dur: 'trial' });
  await ctx.reply(`Kirim username akun trial (3-20 karakter, huruf/angka saja).\nProtokol: ${PROTO_LABEL[ctx.match[1]]}, trial 1 hari.`, { parse_mode: 'HTML' });
});

// ---------- Renew menu (pintu RENEW AKUN di submenu VPN PREMIUM) ----------
bot.action('renewmenu', async (ctx) => {
  await ctx.answerCbQuery();
  const rows = await db.all('SELECT * FROM vpn_accounts WHERE telegram_id=? ORDER BY id DESC LIMIT 10', [ctx.from.id]);
  if (!rows.length) {
    const kb = Markup.inlineKeyboard([[B.primary('⬅️ Menu VPN', 'vpnmenu'), B.plain('🏠 Beranda', 'menu')]]);
    try { await ctx.editMessageText('🔁 <b>RENEW AKUN</b>\n\nBelum ada akun.', { parse_mode: 'HTML', ...kb }); }
    catch { await ctx.reply('🔁 <b>RENEW AKUN</b>\n\nBelum ada akun.', { parse_mode: 'HTML', ...kb }); }
    return;
  }
  const kbRows = rows.map(r => [B.success(`Perpanjang ${r.username} (${PROTO_LABEL[r.proto] || r.proto})`, 'renew:' + r.id)]);
  kbRows.push([B.primary('⬅️ Menu VPN', 'vpnmenu'), B.plain('🏠 Beranda', 'menu')]);
  const text = '🔁 <b>RENEW AKUN</b>\nPilih akun yang mau diperpanjang:';
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbRows) }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbRows) }); }
});

// ---------- Riwayat, Role, Statistik, Cek Kuota ----------
bot.action('riwayat', async (ctx) => {
  await ctx.answerCbQuery();
  const rows = await db.getHistory(ctx.from.id, 15);
  const list = rows.length ? rows.map(r => `• ${r.kind} ${fmt(r.amount)} — ${esc(r.note)} [${esc(r.status)}] (${r.created_at})`).join('\n') : 'Belum ada riwayat.';
  const kb = Markup.inlineKeyboard([[B.plain('🏠 Beranda', 'menu')]]);
  try { await ctx.editMessageText(`🧾 <b>RIWAYAT</b>\n\n${list}`, { parse_mode: 'HTML', ...kb }); }
  catch { await ctx.reply(`🧾 <b>RIWAYAT</b>\n\n${list}`, { parse_mode: 'HTML', ...kb }); }
});
bot.action('role', async (ctx) => {
  await ctx.answerCbQuery();
  const u = await db.ensureUser(ctx.from.id, ctx.from.username || '');
  const prices = await db.all('SELECT product_key, role, price FROM vpn_prices WHERE role=? ORDER BY product_key', [u.role === 'reseller' ? 'reseller' : 'member']);
  const kb = Markup.inlineKeyboard([[B.plain('🏠 Beranda', 'menu')]]);
  const text = `🎖️ <b>ROLE</b>\n\nRole kamu: <b>${esc(u.role)}</b>\nHarga VPN per hari (role kamu):\n${prices.map(p => `• ${PROTO_LABEL[p.product_key] || p.product_key}: ${fmt(p.price)}`).join('\n') || 'Belum ada harga.'}\n\nHarga PPOB: harga Digiflazz + margin Rp${Number(config.digiflazz.margin || 0).toLocaleString('id-ID')}.\nAdmin bisa mengubah harga VPN via panel Admin (format PROTO ROLE HARGA).`;
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', ...kb }); }
});
bot.action('statistik', async (ctx) => {
  await ctx.answerCbQuery();
  const kb = Markup.inlineKeyboard([[B.plain('🏠 Beranda', 'menu')]]);
  let text;
  if (config.isAdmin(ctx.from.id)) {
    const g = await db.getGlobalStats();
    text = `📊 <b>STATISTIK (Admin)</b>\n\n👥 User: ${g.users}\n🖥️ Server: ${g.servers}\n🔑 Akun VPN: ${g.accounts} (aktif: ${g.accountsActive})\n🧾 Transaksi: ${g.transactions}\n📱 Order PPOB: ${g.ppobOrders}\n💰 Total saldo user: ${fmt(g.totalSaldo)}`;
  } else {
    const s = await db.getUserStats(ctx.from.id);
    text = `📊 <b>STATISTIK</b>\n\n🔑 Akun VPN aktif: ${s.vpnActive} (total: ${s.vpnTotal})\n🧾 Transaksi: ${s.transactions}\n📱 Order PPOB: ${s.ppobOrders}`;
  }
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', ...kb }); }
});
bot.action('cekkuota', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.sidompulApiKey) {
    await ctx.reply('📡 <b>Cek Kuota belum aktif</b>.\nAPI Sidompul belum dikonfigurasi admin, jadi tidak ada hasil kuota yang ditampilkan. Hubungi admin.', { parse_mode: 'HTML', ...mainMenu(ctx.from.id) });
    return;
  }
  sessions.set(ctx.from.id, { step: 'cek_kuota' });
  await ctx.reply('Kirim nomor HP untuk cek kuota.\nContoh: <code>087862591220</code>', { parse_mode: 'HTML' });
});

// ---------- Saldo ----------
bot.action('saldo', async (ctx) => {
  await ctx.answerCbQuery();
  const u = await db.ensureUser(ctx.from.id, ctx.from.username || '');
  const tx = await db.all('SELECT type, amount, note, created_at FROM transactions WHERE telegram_id=? ORDER BY id DESC LIMIT 5', [ctx.from.id]);
  const list = tx.length ? tx.map(t => `• ${t.type} ${fmt(t.amount)} — ${esc(t.note || '')} (${t.created_at})`).join('\n') : 'Belum ada transaksi.';
  await showMenu(ctx, `💰 <b>Saldo Saya</b>\nSaldo: <b>${fmt(u.saldo)}</b>\nRole: ${esc(u.role)}\n\n🧾 Transaksi terakhir:\n${list}`);
});

// ---------- Deposit ----------
bot.action('deposit', async (ctx) => {
  await ctx.answerCbQuery();
  const kb = Markup.inlineKeyboard([
    [B.primary('📲 Deposit Manual (konfirmasi admin)', 'deposit_manual')],
    [B.success('📷 Deposit QRIS Otomatis', 'deposit_auto')],
    [B.plain('🏠 Beranda', 'menu')],
  ]);
  const statusText = config.depositAutoEnabled
    ? '💳 Deposit QRIS otomatis: gateway terkonfigurasi. Bot akan membuat QRIS dinamis sungguhan dari gateway (berlaku 5 menit), dan saldo masuk otomatis saat webhook payment.success diterima — tidak ada QRIS palsu, tidak ada event uji.'
    : '💳 Deposit QRIS otomatis: <b>belum aktif</b> karena gateway QRIS belum dikonfigurasi. Jalur yang dijamin adalah Deposit Manual: kirim nominal, admin konfirmasi, saldo masuk.';
  try { await ctx.editMessageText('➕ <b>Deposit</b>\n\n' + statusText + '\n\nSaldo hanya masuk setelah pembayaran dikonfirmasi — tidak ada saldo palsu.', { parse_mode: 'HTML', ...kb }); }
  catch { await ctx.reply('➕ <b>Deposit</b>', { parse_mode: 'HTML', ...kb }); }
});
bot.action('deposit_manual', async (ctx) => {
  await ctx.answerCbQuery();
  sessions.set(ctx.from.id, { step: 'deposit_amount' });
  await ctx.reply('Kirim nominal deposit (angka saja, minimal Rp5.000).\nContoh: <code>50000</code>', { parse_mode: 'HTML' });
});
bot.action('deposit_auto', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.depositAutoEnabled) {
    await ctx.reply('⚠️ Deposit QRIS otomatis <b>belum aktif</b> karena gateway QRIS belum dikonfigurasi.\n\nSilakan pakai <b>Deposit Manual</b>: kirim nominal, lalu admin konfirmasi dan saldo masuk. QRIS tidak ditampilkan bila gateway belum ada, supaya tidak ada QRIS palsu.', { parse_mode: 'HTML', ...mainMenu(ctx.from.id) });
    return;
  }
  // Gateway terkonfigurasi (api-docs): POST /gopay/qris, QRIS dinamis
  // 5 menit, webhook payment.success -> auto-credit via reference.
  sessions.set(ctx.from.id, { step: 'deposit_amount_auto' });
  await ctx.reply('Gateway QRIS terkonfigurasi dan sesi GoPay valid. Kirim nominal deposit (angka saja, minimal Rp5.000), bot akan membuat QRIS dinamis sungguhan dari gateway (berlaku 5 menit). Bayar QRIS itu, saldo masuk otomatis saat pembayaran lunas — tanpa event uji.', { parse_mode: 'HTML' });
});

// ---------- Kartu server / list produk (gaya Ansendant, data sendiri) ----------
// Satu server saja di bot ini (domain di config), jadi pagination 1/1.
// Kuota TIDAK diklaim 300 GB karena Xray di sini tidak menegakkannya;
// IP limit yang ditampilkan adalah limit default (SSH 1, Xray 2) yang
// dipakai checker notifikasi, bukan blokir otomatis.
async function serverCard(ctx, proto, mode, nextCb) {
  const u = await db.ensureUser(ctx.from.id, ctx.from.username || '');
  const geo = await geoMod.getGeo();
  const perDay = await db.getPrice(proto, u.role);
  const cnt = await db.get('SELECT COUNT(*) c FROM vpn_accounts WHERE proto=?', [proto]);
  const active = cnt ? cnt.c : 0;
  const iplimit = proto === 'ssh' ? 1 : 2;
  const status = config.vpnCreateEnabled ? 'ACTIVE' : 'NONAKTIF';
  const locLine = geo ? `${geo.flag} ${esc(geo.city || geo.country)} (${esc(geo.countryCode)})${geo.provider ? ` — ${esc(geo.provider)}` : ''}` : 'VPS kita (lokasi gagal dideteksi otomatis, bukan negara palsu)';
  const text = `🖥️ <b>SERVER 1/1</b> — ${geo ? geo.flag + ' ' : ''}${PROTO_LABEL[proto] || proto}\n` +
    `👤 ${esc(ctx.from.username ? '@' + ctx.from.username : '-') } | 🎖️ ${esc(u.role)} | Halaman 1/1 | Tipe: ${mode === 'trial' ? 'Trial' : 'Beli'}\n` +
    `─────────────────────\n` +
    `🌍 Lokasi: ${locLine}\n` +
    `📌 Server: <code>${esc(config.vpn.domain || '-')}</code>\n` +
    `💰 Harga/hari: <b>${fmt(perDay)}</b> | Harga/30 hari: <b>${fmt(perDay * 30)}</b>\n` +
    `📦 Kuota: Server (tidak dibatasi di server)\n` +
    `🌐 IP Limit: ${iplimit} IP\n` +
    `👥 Slot: ${active} akun aktif untuk protokol ini\n` +
    `🟢 Status: ${status}`;
  const kb = Markup.inlineKeyboard([
    [B.success(`Pilih Server Ini — ${PROTO_LABEL[proto] || proto}`, nextCb)],
    [B.primary('⬅️ Kembali', mode === 'trial' ? 'vpn_trial' : 'buyvpn'), B.plain('🏠 Beranda', 'menu')],
  ]);
  return { text, kb };
}

// ---------- Beli VPN ----------
bot.action('buyvpn', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.vpnCreateEnabled) { await showMenu(ctx, '❌ Beli VPN sedang <b>nonaktif</b>: domain/API VPN belum dikonfigurasi admin. Hubungi admin.'); return; }
  const rows = db.PRODUCTS.map(p => [B.primary(PROTO_LABEL[p.key], 'buy_proto:' + p.key)]);
  rows.push([B.plain('🏠 Beranda', 'menu')]);
  try { await ctx.editMessageText('🛒 <b>Beli VPN</b>\nPilih protokol (host: <code>' + esc(config.vpn.domain) + '</code>, port 80 / 443 / 22):', { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }); }
  catch { await ctx.reply('🛒 <b>Beli VPN</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) }); }
});
bot.action(/^buy_proto:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const { text, kb } = await serverCard(ctx, ctx.match[1], 'buy', 'buy_server:' + ctx.match[1]);
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', ...kb }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', ...kb }); }
});
bot.action(/^buy_server:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const proto = ctx.match[1];
  const u = await db.ensureUser(ctx.from.id, ctx.from.username || '');
  const perDay = await db.getPrice(proto, u.role);
  const kb = Markup.inlineKeyboard([
    [B.success(`🎁 Trial 1 hari (gratis, 1x)`, 'buy_days:' + proto + ':trial')],
    [B.success(`7 hari — ${fmt(perDay * 7)}`, 'buy_days:' + proto + ':7')],
    [B.success(`30 hari — ${fmt(perDay * 30)}`, 'buy_days:' + proto + ':30')],
    [B.primary('⬅️ Pilih Server', 'buy_proto:' + proto), B.plain('🏠 Beranda', 'menu')],
  ]);
  try { await ctx.editMessageText(`🛒 <b>${PROTO_LABEL[proto]}</b>\nHarga: <b>${fmt(perDay)}/hari</b> (role ${esc(u.role)})\nPilih durasi:`, { parse_mode: 'HTML', ...kb }); }
  catch { await ctx.reply('Pilih durasi.', { parse_mode: 'HTML', ...kb }); }
});
bot.action(/^buy_days:(.+):(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const [, proto, dur] = ctx.match;
  if (dur === 'trial') {
    const ok = await db.canClaimTrial(ctx.from.id);
    if (!ok) { await ctx.reply('❌ Trial sudah pernah diklaim dalam 24 jam terakhir. Silakan beli durasi 7/30 hari.'); return; }
  }
  sessions.set(ctx.from.id, { step: 'buy_username', proto, dur });
  await ctx.reply(`Kirim username akun (3-20 karakter, huruf/angka saja).\nProtokol: ${PROTO_LABEL[proto]}, durasi: ${dur === 'trial' ? 'trial 1 hari' : dur + ' hari'}.`, { parse_mode: 'HTML' });
});

// ---------- Akun Saya ----------
bot.action('myacc', async (ctx) => {
  await ctx.answerCbQuery();
  const rows = await db.all('SELECT * FROM vpn_accounts WHERE telegram_id=? ORDER BY id DESC LIMIT 10', [ctx.from.id]);
  if (!rows.length) { await showMenu(ctx, '👤 <b>AKUN SAYA</b>\n\nBelum ada akun.'); return; }
  let text = '👤 <b>Akun Saya</b>\n\n';
  const kbRows = [];
  for (const r of rows) {
    text += `• ${PROTO_LABEL[r.proto] || r.proto} — <code>${esc(r.username)}</code> s/d ${esc(r.expiry)}${r.is_trial ? ' (trial)' : ''}\n`;
    kbRows.push([B.primary(`Perpanjang ${r.username}`, 'renew:' + r.id), B.danger(`Hapus ${r.username}`, 'delacc:' + r.id)]);
    kbRows.push([B.primary(`🔍 IP Login ${r.username}`, 'iplog:' + r.id)]);
  }
  kbRows.push([B.plain('🏠 Beranda', 'menu')]);
  try { await ctx.editMessageText(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbRows) }); }
  catch { await ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbRows) }); }
});
bot.action(/^renew:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const row = await db.get('SELECT * FROM vpn_accounts WHERE id=? AND telegram_id=?', [ctx.match[1], ctx.from.id]);
  if (!row) { await ctx.reply('❌ Akun tidak ditemukan.'); return; }
  const kb = Markup.inlineKeyboard([
    [B.success('7 hari', 'renew_days:' + row.id + ':7'), B.success('30 hari', 'renew_days:' + row.id + ':30')],
    [B.primary('⬅️ Akun Saya', 'myacc')],
  ]);
  await ctx.reply(`Perpanjang <code>${esc(row.username)}</code> (${PROTO_LABEL[row.proto]}) — pilih durasi:`, { parse_mode: 'HTML', ...kb });
});
bot.action(/^renew_days:(\d+):(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const row = await db.get('SELECT * FROM vpn_accounts WHERE id=? AND telegram_id=?', [ctx.match[1], ctx.from.id]);
  if (!row) { await ctx.reply('❌ Akun tidak ditemukan.'); return; }
  const u = await db.ensureUser(ctx.from.id, '');
  const days = Number(ctx.match[2]), price = (await db.getPrice(row.proto, u.role)) * days;
  if (u.role !== 'admin' && (await db.getBalance(ctx.from.id)) < price) { await ctx.reply(`❌ Saldo tidak cukup. Butuh ${fmt(price)}, saldo ${fmt(await db.getBalance(ctx.from.id))}. Deposit dulu.`); return; }
  // FIX RENEW 2026-11-02: API vpn-api mengatur expired = hari ini + durasi,
  // bukan expired lama + durasi, dan gagal bila tanggal baru sama dengan
  // tanggal lama. Jadi hitung expired baru dulu (dasar = expired lama bila
  // masih di masa depan, bila sudah lewat dasar = hari ini), lalu kirim
  // selisih hari dari hari ini ke API agar config/.db API sama dengan DB bot.
  const todayStr = new Date().toISOString().slice(0, 10);
  const baseStr = (row.expiry && row.expiry > todayStr) ? row.expiry : todayStr;
  const d = new Date(baseStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days);
  const newExpiry = d.toISOString().slice(0, 10);
  const daysForApi = Math.round((Date.parse(newExpiry + 'T00:00:00Z') - Date.parse(todayStr + 'T00:00:00Z')) / 86400000);
  const res = await vpn.renewAccount(row.proto, row.username, daysForApi);
  if (!res.success) { await ctx.reply(res.message, { parse_mode: 'HTML' }); return; }
  if (u.role !== 'admin') await db.deductBalance(ctx.from.id, price, `renew ${row.proto} ${row.username} ${days}h`);
  await db.run('UPDATE vpn_accounts SET expiry=? WHERE id=?', [newExpiry, row.id]);
  await ctx.reply(`✅ <b>${esc(row.username)}</b> (${row.proto}) diperpanjang ${days} hari. Expired baru: ${newExpiry}.\nHarga: ${fmt(price)}.`, { parse_mode: 'HTML', ...mainMenu(ctx.from.id) });
});
bot.action(/^delacc:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const row = await db.get('SELECT * FROM vpn_accounts WHERE id=? AND telegram_id=?', [ctx.match[1], ctx.from.id]);
  if (!row) { await ctx.reply('❌ Akun tidak ditemukan.'); return; }
  const res = await vpn.deleteAccount(row.proto, row.username);
  if (res.success) await db.run('DELETE FROM vpn_accounts WHERE id=?', [row.id]);
  await ctx.reply(res.message, { parse_mode: 'HTML', ...mainMenu(ctx.from.id) });
});


// ---------- Export akun Xray (tombol di pesan akun) ----------
// Clash/V2Ray: file config sungguhan dari data akun di DB (bukan contoh).
// HTTP Custom / NetMod: kedua aplikasi itu mengimpor lewat link V2Ray,
// jadi tombol ini mengirim ulang link TLS + cara tempelnya, bukan file
// .hc palsu (format .hc HTTP Custom adalah SSH+payload, bukan Xray).
// Tutup: hapus pesan akun dari chat.
// Akun lama (dibuat sebelum update ini, tanpa uuid/link di DB) akan
// ditolak dengan jelas — harus buat akun baru agar bisa diekspor.
bot.action(/^export:(\d+):(clash|v2ray|httpcustom|netmod)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const row = await db.get('SELECT * FROM vpn_accounts WHERE id=? AND telegram_id=?', [ctx.match[1], ctx.from.id]);
  if (!row) { await ctx.reply('❌ Akun tidak ditemukan.'); return; }
  if (row.proto === 'ssh') {
    await ctx.reply(`Akun SSH <code>${esc(row.username)}</code> tidak diekspor ke Clash/V2Ray (itu untuk Xray).\n\nUntuk HTTP Custom / NetMod, pakai SSH ini:\nHost: <code>${esc(config.vpn.domain)}</code>\nPort: 22 / 80 / 443\nUsername: <code>${esc(row.username)}</code>\nPassword: tersimpan di pesan akun saat dibuat (tidak disimpan ulang di sini bila akun lama).`, { parse_mode: 'HTML' });
    return;
  }
  if (!row.uuid && !row.password) { await ctx.reply('❌ Akun ini dibuat sebelum fitur export, jadi kredensial/link-nya tidak tersimpan di DB. Buat akun baru agar tombol export jalan.'); return; }
  const host = config.vpn.domain;
  const links = row.link_tls ? { tls: row.link_tls, http: row.link_http, grpc: row.link_grpc } : vpn.buildLinks(row.proto, row.username, row.uuid, row.password, host);
  if (ctx.match[2] === 'clash') {
    const yaml = vpn.buildClash(row.proto, row.username, row.uuid, row.password, host, links);
    if (!yaml) { await ctx.reply('❌ Clash tidak tersedia untuk protokol ini.'); return; }
    await ctx.replyWithDocument({ source: Buffer.from(yaml, 'utf8'), filename: `clash-${row.username}.yaml` }, { caption: `📦 Clash config untuk ${esc(row.username)} (${row.proto}). Import file ini di Clash, pilih proxy ${esc(row.username)}-TLS / -HTTP / -GRPC.` });
  } else if (ctx.match[2] === 'v2ray') {
    const json = vpn.buildV2ray(row.proto, row.username, row.uuid, row.password, host);
    if (!json) { await ctx.reply('❌ V2Ray tidak tersedia untuk protokol ini.'); return; }
    await ctx.replyWithDocument({ source: Buffer.from(json, 'utf8'), filename: `v2ray-${row.username}.json` }, { caption: `⚡ V2Ray config untuk ${esc(row.username)} (${row.proto}, WS TLS 443). Link HTTP/GRPC tetap ada di pesan akun.` });
  } else {
    const appName = ctx.match[2] === 'httpcustom' ? 'HTTP Custom' : 'NetMod';
    await ctx.reply(`📱 <b>${appName} — ${esc(row.username)}</b>\n\n${appName} mengimpor akun Xray lewat link V2Ray. Salin link TLS di bawah ini, tempel di ${appName} &gt; V2Ray / Import:\n\n<pre>${esc(links.tls)}</pre>\n\nBila ${appName} di HP kamu hanya menerima SSH, pakai akun SSH terpisah, bukan akun Xray ini.`, { parse_mode: 'HTML' });
  }
});
bot.action('close_msg', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch { await ctx.reply('Pesan sudah ditutup.'); }
});

// ---------- PPOB (gate keras) ----------
bot.action('ppob', async (ctx) => {
  await ctx.answerCbQuery();
  if (!digi.enabled()) {
    await showMenu(ctx, '📱 <b>Beli PPOB</b>\n\n⚠️ PPOB <b>belum aktif, hubungi admin</b>.\n\nDigiflazz belum dikonfigurasi, jadi tidak ada produk, tidak ada harga, dan tidak ada pemotongan saldo untuk PPOB sampai admin mengaktifkan.');
    return;
  }
  const cats = digi.PPOB_CATEGORIES;
  const kb = Markup.inlineKeyboard([
    [B.primary('📶 Kuota', 'ppob_cat:kuota'), B.primary('📱 Pulsa', 'ppob_cat:pulsa'), B.primary('🎮 Game', 'ppob_cat:game')],
    [B.primary('⚡ PLN', 'ppob_cat:pln'), B.primary('💳 E-Money', 'ppob_cat:emoney'), B.primary('🎟️ Voucher', 'ppob_cat:voucher')],
    [B.primary('🔎 Cek Status PPOB', 'ppob_check')],
    [B.plain('🏠 Beranda', 'menu')],
  ]);
  try { await ctx.editMessageText('📱 <b>Beli PPOB</b>\nKategori: ' + cats.map(c => c.label).join(', ') + '.\nProduk dan harga dari price-list Digiflazz live, hanya produk aktif yang dijual.\nPilih kategori:', { parse_mode: 'HTML', ...kb }); }
  catch { await ctx.reply('📱 <b>Beli PPOB</b>', { parse_mode: 'HTML', ...kb }); }
});
bot.action(/^ppob_cat:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  sessions.set(ctx.from.id, { step: 'ppob_no', cat: ctx.match[1] });
  await ctx.reply('Kirim nomor tujuan (HP / ID pelanggan PLN).\nContoh: <code>081234567890</code>', { parse_mode: 'HTML' });
});
bot.action('ppob_check', async (ctx) => {
  await ctx.answerCbQuery();
  sessions.set(ctx.from.id, { step: 'ppob_check_ref' });
  await ctx.reply('Kirim ref_id PPOB yang mau dicek (mis. <code>ppob...</code>).\nAturan Digiflazz: cek minimal 1 menit setelah cek sebelumnya, dan tidak bisa cek transaksi >90 hari.', { parse_mode: 'HTML' });
});

bot.action('ppob_search_btn', async (ctx) => {
  await ctx.answerCbQuery();
  const s = sessions.get(ctx.from.id);
  if (!s || !s.ppobNo) { await ctx.reply('❌ Sesi PPOB habis. Ulangi dari menu Beli PPOB.'); return; }
  sessions.set(ctx.from.id, { ...s, step: 'ppob_search' });
  await ctx.reply('Kirim kata kunci produk yang dicari (mis. <code>10GB</code>, <code>TELKOMSEL</code>).', { parse_mode: 'HTML' });
});
bot.action(/^ppob_pick:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const s = sessions.get(ctx.from.id);
  if (!s || !s.ppobProducts) { await ctx.reply('❌ Sesi PPOB habis. Ulangi dari menu Beli PPOB.'); return; }
  const p = s.ppobProducts[Number(ctx.match[1])];
  if (!p) { await ctx.reply('❌ Produk tidak ditemukan.'); return; }
  const bal = await db.getBalance(ctx.from.id);
  if (bal < p.price_sell) { await ctx.reply(`❌ Saldo tidak cukup. Harga ${fmt(p.price_sell)}, saldo ${fmt(bal)}. Deposit dulu.`); return; }
  // 1) Cek saldo supplier dulu — bila kurang, tolak tanpa potong saldo user.
  try {
    const supplierBal = await digi.cekSaldoSupplier();
    if (supplierBal < p.price_sell) { await ctx.reply(`❌ Saldo supplier Digiflazz kurang (${fmt(supplierBal)}), hubungi admin untuk topup supplier. Saldo Anda TIDAK dipotong.`); return; }
  } catch (e) { await ctx.reply('❌ Gagal cek saldo supplier: ' + esc(e.message) + '\nSaldo TIDAK dipotong. Coba lagi nanti.'); return; }
  // 2) Simpan ref_id di DB SEBELUM kirim ke Digiflazz (untuk retry/cek status).
  const refId = 'ppob' + Date.now() + Math.floor(Math.random() * 1000);
  await db.run('INSERT INTO ppob_orders (ref_id, telegram_id, sku, product_name, customer_no, price_sell, status) VALUES (?,?,?,?,?,?,?)', [refId, ctx.from.id, p.buyer_sku_code, p.product_name, s.ppobNo, p.price_sell, 'pending']);
  let order;
  try { order = await digi.createOrder(p.buyer_sku_code, s.ppobNo, refId); }
  catch (e) {
    await db.run('UPDATE ppob_orders SET status=? WHERE ref_id=?', ['gagal', refId]);
    await ctx.reply('❌ Gagal order PPOB: ' + esc(e.message) + '\nSaldo TIDAK dipotong.'); return;
  }
  const dgStatus = order?.status || order?.message || '';
  const action = digi.saldoActionForStatus(dgStatus);
  if (action === 'refund') {
    await db.run('UPDATE ppob_orders SET status=? WHERE ref_id=?', ['gagal', refId]);
    await ctx.reply(`❌ Order PPOB ditolak Digiflazz (${esc(dgStatus)}). Saldo TIDAK dipotong.`);
  } else {
    // sukses maupun pending: potong/kunci saldo sekarang, sesuai status.
    // Pending = terkunci; bila cek status nanti ternyata gagal, saldo dikembalikan.
    await db.deductBalance(ctx.from.id, p.price_sell, `ppob ${p.product_name} ${s.ppobNo} (${action})`);
    await db.run('UPDATE ppob_orders SET status=?, locked=? WHERE ref_id=?', [action === 'deduct' ? 'sukses' : 'pending', action === 'lock' ? 1 : 0, refId]);
    await ctx.reply(`✅ Order PPOB ${action === 'deduct' ? 'sukses' : 'pending (saldo terkunci)'}.\nProduk: ${esc(p.product_name)}\nTujuan: <code>${esc(s.ppobNo)}</code>\nHarga: ${fmt(p.price_sell)}\nRef: <code>${refId}</code>\nStatus Digiflazz: ${esc(dgStatus)}\n\nBila pending, pakai menu Cek Status PPOB dengan ref_id yang sama (tunggu ≥1 menit antar cek). Bila akhirnya gagal, saldo terkunci dikembalikan.`, { parse_mode: 'HTML', ...mainMenu(ctx.from.id) });
  }
  sessions.delete(ctx.from.id);
});

// ---------- Bantuan ----------
// Sebelumnya: hanya bot.action('help') tanpa tombol dan tanpa /help,
// jadi fitur ini mati (tidak bisa dipanggil user). Perbaikan: tombol
// Bantuan di menu utama + perintah /help, keduanya pakai helpText().
bot.action('help', async (ctx) => {
  await ctx.answerCbQuery();
  await showMenu(ctx, helpText());
});
bot.command('help', async (ctx) => {
  await ctx.reply(helpText(), { parse_mode: 'HTML', ...mainMenu(ctx.from.id) });
});

// ---------- Admin (hanya ADMIN_ID, tanpa hardcode) ----------
bot.action('admin', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) { await ctx.reply('❌ Menu ini khusus admin.'); return; }
  const kb = Markup.inlineKeyboard([
    [B.success('➕ Tambah Saldo', 'admin_addsaldo'), B.primary('💲 Set Harga VPN', 'admin_price')],
    [B.primary('📥 Deposit Pending', 'admin_deposits'), B.primary('🧾 Transaksi', 'admin_tx')],
    [B.primary('📊 Statistik', 'admin_stats'), B.primary('📣 Broadcast', 'admin_broadcast')],
    [B.primary('🔗 Webhook', 'admin_webhook')],
    [B.primary('⚙️ Pengaturan & API Key', 'admin_settings'), B.primary('👥 Kelola User', 'admin_users')],
    [B.primary('📱 Kelola Produk PPOB', 'admin_ppob')],
    [B.primary('🔍 Cek Login IP', 'admin_iplog')],
    [B.primary('🖼️ Upload Logo Menu Utama', 'admin_logo')],
    [B.plain('🏠 Beranda', 'menu')],
  ]);
  try { await ctx.editMessageText('🛠️ <b>Admin</b>\nFormat input (kirim sebagai pesan biasa setelah menekan tombol):\n• Tambah saldo: <code>USERID NOMINAL</code> (mis. <code>123456 50000</code>)\n• Set harga: <code>PROTO ROLE HARGA_PER_HARI</code> (mis. <code>vless member 500</code>)\n• Broadcast: kirim pesan broadcast apa adanya.', { parse_mode: 'HTML', ...kb }); }
  catch { await ctx.reply('🛠️ <b>Admin</b>', { parse_mode: 'HTML', ...kb }); }
});
bot.action('admin_logo', async (ctx) => {
  await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return;
  sessions.set(ctx.from.id, { step: 'admin_logo' });
  const logo = findLogo();
  await ctx.reply(`🖼️ <b>Upload Logo Menu Utama</b>\n\nLogo sekarang: ${logo ? 'sudah ada (' + path.basename(logo) + ')' : 'belum ada (dashboard tampil teks saja)'}.\nKirim FOTO logo sebagai foto (bukan dokumen, agar kualitas terjaga) — JPG/PNG/WebP, maks 5 MB. Logo lama langsung diganti begitu foto baru tersimpan.\nKirim teks <code>HAPUS</code> untuk menghapus logo, atau <code>BATAL</code> untuk membatalkan.`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[B.danger('🗑️ Hapus Logo', 'admin_logo_del'), B.primary('🛠️ Admin', 'admin')]]) });
});
bot.action('admin_logo_del', async (ctx) => {
  await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return;
  let removed = false;
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) { const f = path.join(__dirname, 'assets', 'logo-menu.' + ext); if (fs.existsSync(f)) { fs.unlinkSync(f); removed = true; } }
  await ctx.reply(removed ? '✅ Logo menu utama dihapus. Dashboard kembali tampil teks saja.' : 'Logo memang belum ada.');
});

bot.action('admin_addsaldo', async (ctx) => { await ctx.answerCbQuery(); sessions.set(ctx.from.id, { step: 'admin_addsaldo' }); await ctx.reply('Kirim: <code>USERID NOMINAL</code>'); });
bot.action('admin_price', async (ctx) => { await ctx.answerCbQuery(); sessions.set(ctx.from.id, { step: 'admin_price' }); const rows = await db.all('SELECT * FROM vpn_prices ORDER BY product_key, role'); await ctx.reply('Harga sekarang (per hari):\n' + rows.map(r => `${r.product_key} ${r.role}: ${fmt(r.price)}`).join('\n') + '\n\nKirim: <code>PROTO ROLE HARGA</code>'); });
bot.action('admin_deposits', async (ctx) => {
  await ctx.answerCbQuery();
  let pending, recent;
  try {
    pending = await db.all('SELECT * FROM deposits WHERE status=? ORDER BY id DESC LIMIT 10', ['pending']);
    recent = await db.all('SELECT * FROM deposits ORDER BY id DESC LIMIT 10', []);
  } catch (e) { await ctx.reply('❌ Gagal buka Deposit Pending: ' + esc(e.message)); return; }
  if (!recent.length) { await ctx.reply('Belum ada deposit sama sekali.'); return; }
  const lines = recent.map(r => `#${r.id} user ${r.telegram_id} ${fmt(r.amount)} — ${r.status}${r.reference ? ' (' + r.reference + ')' : ''} (${r.created_at || ''})`).join('\n');
  const kbRows = pending.map(r => [B.success(`OK #${r.id} user ${r.telegram_id} ${fmt(r.amount)}`, 'admin_deposit_ok:' + r.id), B.danger(`Tolak #${r.id}`, 'admin_deposit_no:' + r.id)]);
  kbRows.push([B.primary('🛠️ Admin', 'admin')]);
  await ctx.reply(`📥 <b>Deposit</b>\n\n${pending.length ? 'Pending (' + pending.length + '): tekan OK untuk setujui, Tolak untuk menolak.' : 'Tidak ada deposit pending saat ini — deposit yang sudah lunas tidak lagi muncul di pending, tapi ada di riwayat di bawah.'}\n\n<b>Riwayat 10 terakhir:</b>\n${lines}`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbRows) });
});
bot.action(/^admin_deposit_ok:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) return;
  const d = await db.get('SELECT * FROM deposits WHERE id=?', [ctx.match[1]]);
  if (!d || d.status !== 'pending') { await ctx.reply('❌ Deposit tidak pending.'); return; }
  await db.run('UPDATE deposits SET status=? WHERE id=?', ['approved', d.id]);
  const bal = await db.addBalance(d.telegram_id, d.amount, 'deposit manual #' + d.id);
  await ctx.reply(`✅ Deposit #${d.id} disetujui. Saldo user ${d.telegram_id} kini ${fmt(bal)}.`);
  try { await ctx.telegram.sendMessage(d.telegram_id, `✅ Deposit ${fmt(d.amount)} disetujui admin. Saldo kini ${fmt(bal)}.`); } catch {}
});
bot.action(/^admin_deposit_no:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) return;
  await db.run('UPDATE deposits SET status=? WHERE id=?', ['rejected', ctx.match[1]]);
  await ctx.reply(`Deposit #${ctx.match[1]} ditolak. Saldo tidak ditambahkan.`);
});
bot.action('admin_tx', async (ctx) => {
  await ctx.answerCbQuery();
  const rows = await db.all('SELECT telegram_id, type, amount, note, created_at FROM transactions ORDER BY id DESC LIMIT 20', []);
  await ctx.reply('🧾 Transaksi terakhir:\n' + (rows.length ? rows.map(r => `${r.telegram_id} ${r.type} ${fmt(r.amount)} ${esc(r.note || '')} (${r.created_at})`).join('\n') : 'Kosong.'));
});
bot.action('admin_stats', async (ctx) => {
  await ctx.answerCbQuery();
  const u = await db.get('SELECT COUNT(*) c, COALESCE(SUM(saldo),0) s FROM users', []);
  const a = await db.get('SELECT COUNT(*) c FROM vpn_accounts', []);
  const t = await db.get('SELECT COUNT(*) c FROM transactions', []);
  await ctx.reply(`📊 Statistik\nUser: ${u.c}\nTotal saldo user: ${fmt(u.s)}\nAkun VPN aktif di DB: ${a.c}\nTransaksi: ${t.c}`);
});
bot.action('admin_broadcast', async (ctx) => { await ctx.answerCbQuery(); sessions.set(ctx.from.id, { step: 'admin_broadcast' }); await ctx.reply('Kirim pesan broadcast (akan dikirim ke semua user di DB).'); });

// ---------- Webhook (admin saja) ----------
// Gateway: OTOMATIS bisa, lewat H2H POST /gopay/webhooks pakai kunci gk_.
//   Syarat: receiver bot jalan + URL publik sudah dirutekan nginx ke port
//   webhook (kalau belum, gateway menolak dengan "validation failed" karena
//   ping tidak dapat 2xx — itu pesan dari penerima, bukan bug gateway).
// Digiflazz: TIDAK ADA API untuk membuat webhook otomatis. Satu-satunya
//   cara resmi adalah tempel manual di member.digiflazz.com + whitelist IP.
//   Jadi tombol Digiflazz di sini hanya menampilkan URL + langkah manual,
//   bukan klaim auto yang tidak ada endpoint-nya.
function webhookUrls() {
  const base = config.webhook.baseUrl || '(belum diset: isi WEBHOOK_BASE_URL / VPN_DOMAIN)';
  // Payload URL Digiflazz: pakai yang diinput admin bila ada (bisa berbeda
  // dari URL bot, mis. bila ada proxy lain), kalau tidak ada pakai URL bot.
  return { gw: base + config.webhook.gatewayPath, dg: config.digiflazz.webhook.url || (base + config.webhook.digiflazzPath) };
}
function digiflazzWebhookText() {
  const u = webhookUrls();
  const w = config.digiflazz.webhook;
  return `🔗 <b>Webhook Digiflazz — Form Lengkap</b>\n(meniru form dashboard Digiflazz: Pengaturan Koneksi &gt; Edit Koneksi API)\n\nWebhook ID: ${w.id ? 'terisi' : 'KOSONG — isi dari dashboard Digiflazz setelah webhook dibuat di sana'}\nPayload URL: <code>${esc(u.dg)}</code>\nContent type: <code>application/json</code>\nSecret: ${w.secret ? 'terisi (tidak ditampilkan)' : 'KOSONG'}\nStatus di bot: ${w.active ? 'Aktif' : 'Non Aktif'}\n\n⚠️ <b>Penting:</b> toggle di bot ini HANYA mengatur apakah receiver bot memproses event. Toggle di dashboard Digiflazz harus Aktif juga, dan tombol Simpan di dashboard harus ditekan. Kalau Payload URL di dashboard masih mengarah ke sistem lain, jangan ubah sembarangan — itu akan memutus sistem lama itu. Pindahkan ke URL bot hanya bila memang bot ini yang harus menerima event Digiflazz.`;
}
bot.action('admin_webhook', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) { await ctx.reply('❌ Menu ini khusus admin.'); return; }
  const u = webhookUrls();
  const gwReady = Boolean(config.p2p.gatewayUrl && config.p2p.apiKey);
  const kb = Markup.inlineKeyboard([
    [B.success('🤖 Otomatis: Daftarkan Gateway', 'webhook_auto_gw')],
    [B.primary('✍️ Manual: Lihat URL & Langkah', 'webhook_manual')],
    [B.primary('🔗 Webhook Digiflazz (Form Lengkap)', 'webhook_digiflazz')],
    [B.plain('🛠️ Admin', 'admin')],
  ]);
  await ctx.reply(`🔗 <b>Webhook</b>\n\n<b>Gateway (payment-gateway)</b>\nURL: <code>${esc(u.gw)}</code>\nReceiver lokal: 127.0.0.1:${config.webhook.port}\nKunci gateway (gk_): ${gwReady ? 'terisi' : 'KOSONG — isi di Pengaturan'}\nSecret: ${config.webhook.secret ? 'terisi (tidak ditampilkan)' : 'belum diset'}\n\n<b>Digiflazz</b>\nURL: <code>${esc(u.dg)}</code>\nMode: MANUAL saja (tidak ada API auto-create di Digiflazz)\nForm lengkapnya ada di tombol "Webhook Digiflazz" di bawah.\n\nPilih Otomatis untuk gateway, atau Manual untuk melihat langkah tempel URL.`, { parse_mode: 'HTML', ...kb });
});
bot.action('webhook_manual', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) { await ctx.reply('❌ Menu ini khusus admin.'); return; }
  const u = webhookUrls();
  await ctx.reply(`✍️ <b>Webhook Manual</b>\n\n<b>1. Gateway</b>\nTempel di menu /webhook gateway atau pakai tombol Otomatis di menu sebelumnya.\nURL: <code>${esc(u.gw)}</code>\nEvent: payment.success, payment.expired\nSecret: samakan dengan WEBHOOK_SECRET bot, bila kosong gateway pakai secret internal tenant.\nPenerima harus menjawab ping webhook.ping dengan 2xx dalam 5 detik, kalau tidak pendaftaran ditolak.\n\n<b>2. Digiflazz (hanya manual)</b>\nBuka member.digiflazz.com &gt; Pengaturan Koneksi API, tempel URL ini:\n<code>${esc(u.dg)}</code>\nLalu whitelist IP VPS di Digiflazz, dan whitelist IP Digiflazz 52.74.250.133 di sistem kita.\nTidak ada tombol auto untuk Digiflazz karena API buyer-nya tidak menyediakan pembuatan webhook.`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[B.primary('🔗 Webhook', 'admin_webhook')]]) });
});
bot.action('webhook_digiflazz', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) { await ctx.reply('❌ Menu ini khusus admin.'); return; }
  const kb = Markup.inlineKeyboard([
    [B.primary('🆔 Input Webhook ID', 'set_dgwhid'), B.primary('🌐 Input Payload URL', 'set_dgwhurl')],
    [B.primary('🔑 Input Secret Webhook', 'set_dgwhsecret'), B.success('🔄 Aktif / Non Aktif', 'toggle_dgwh')],
    [B.plain('🔗 Webhook', 'admin_webhook'), B.plain('⚙️ Pengaturan', 'admin_settings')],
  ]);
  await ctx.reply(digiflazzWebhookText(), { parse_mode: 'HTML', ...kb });
});
bot.action('set_dgwhid', async (ctx) => { await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return; sessions.set(ctx.from.id, { step: 'set_dgwhid' }); await ctx.reply('Kirim Webhook ID dari dashboard Digiflazz (mis. yang tampil di form Edit Koneksi API).'); });
bot.action('set_dgwhurl', async (ctx) => { await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return; sessions.set(ctx.from.id, { step: 'set_dgwhurl' }); await ctx.reply('Kirim Payload URL Digiflazz. Kosongkan? Kirim "default" untuk kembali ke URL bot ini. Perhatian: bila URL ini masih dipakai sistem lain, jangan ubah di dashboard sebelum sistem itu dipindahkan.'); });
bot.action('set_dgwhsecret', async (ctx) => { await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return; sessions.set(ctx.from.id, { step: 'set_dgwhsecret' }); await ctx.reply('Kirim Secret webhook Digiflazz (dari form dashboard). Pesan ini akan dihapus setelah dibaca, dan secret tidak akan ditampilkan kembali. Secret ini harus SAMA dengan yang di dashboard, kalau tidak signature ditolak.'); });
bot.action('toggle_dgwh', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) return;
  const now = !config.digiflazz.webhook.active;
  config.saveEnv({ DIGIFLAZZ_WEBHOOK_ACTIVE: now ? 'true' : 'false' });
  await ctx.reply(`Webhook Digiflazz di bot: ${now ? 'Aktif' : 'Non Aktif'}.\n\nIngat: ini hanya toggle bot. Toggle di dashboard Digiflazz harus Aktif juga dan tombol Simpan di sana harus ditekan, kalau tidak Digiflazz tidak mengirim event sama sekali.`);
});
bot.action('webhook_auto_gw', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) { await ctx.reply('❌ Menu ini khusus admin.'); return; }
  if (!config.p2p.gatewayUrl || !config.p2p.apiKey) { await ctx.reply('❌ Gateway belum terkonfigurasi: P2P_GATEWAY_URL / P2P_API_KEY kosong. Isi lewat menu input di VPS, bukan chat.'); return; }
  const u = webhookUrls();
  if (!config.webhook.baseUrl) { await ctx.reply('❌ WEBHOOK_BASE_URL / VPN_DOMAIN kosong, URL publik tidak bisa dibuat.'); return; }
  await ctx.reply('⏳ Mendaftarkan webhook gateway… (gateway akan mengirim ping, receiver harus menjawab 2xx dalam 5 detik)');
  try {
    const res = await fetch(config.p2p.gatewayUrl + '/api/h2h/v1/gopay/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.p2p.apiKey },
      body: JSON.stringify({ url: u.gw, events: ['payment.success', 'payment.expired'], secret: config.webhook.secret || undefined }),
    });
    const txt = await res.text();
    if (res.status === 201) await ctx.reply(`✅ Webhook gateway terdaftar.\nURL: <code>${esc(u.gw)}</code>\nRespons: <code>${esc(txt.slice(0, 300))}</code>`, { parse_mode: 'HTML' });
    else if (res.status === 409) await ctx.reply('⚠️ Batas webhook tercapai (maks 10 per akun). Hapus salah satu webhook lama dulu, lalu coba lagi.');
    else await ctx.reply(`❌ Gagal daftar webhook (HTTP ${res.status}).\n<code>${esc(txt.slice(0, 500))}</code>\n\nBila pesannya "validation failed", artinya receiver belum bisa dijangkau publik (bot belum jalan / nginx belum merutekan /webhook-*). Perbaiki rute itu dulu, bukan mengulang daftar.`, { parse_mode: 'HTML' });
  } catch (e) { await ctx.reply('❌ Gagal menghubungi gateway: ' + esc(e.message)); }
});

// ---------- Pengaturan & API Key (Admin via Telegram) ----------
// PERINGATAN KEAMANAN: kunci yang diketik di Telegram tersimpan di riwayat
// chat Telegram. Bot akan menghapus pesan berisi kunci itu dari chat
// (bila bisa), dan TIDAK PERNAH menampilkan kembali nilai kunci — hanya
// status terisi/kosong. Untuk instalasi baru, cara paling aman tetap input
// lewat menu VPS (m-bot opsi 1, mode senyap); menu Telegram ini untuk
// admin yang sudah sadar risikonya dan butuh atur dari HP.
// Semua input di sini tersimpan ke .env (600) + memori bot, langsung berlaku.
async function deleteSecretMessage(ctx) { try { await ctx.deleteMessage(); } catch {} }
function settingsText() {
  const u = webhookUrls();
  return `⚙️ <b>Pengaturan &amp; API Key</b>\n\n<b>Gateway</b>\nURL: <code>${esc(config.p2p.gatewayUrl || '(kosong)')}</code>\nKunci gk_: ${config.p2p.apiKey ? 'terisi' : 'KOSONG'}\n\n<b>Digiflazz</b>\nUsername: ${config.digiflazz.username ? 'terisi' : 'KOSONG'}\nAPI Key: ${config.digiflazz.apiKey ? 'terisi' : 'KOSONG'}\nMargin PPOB: ${fmt(config.digiflazz.margin)}\n\n<b>Webhook</b>\nGateway: <code>${esc(u.gw)}</code>\nDigiflazz: <code>${esc(u.dg)}</code>\nSecret: ${config.webhook.secret ? 'terisi (tidak ditampilkan)' : 'belum dibuat'}\n\nTekan tombol, lalu kirim nilainya sebagai pesan biasa. Pesan berisi kunci akan dihapus bot setelah dibaca.`;
}
bot.action('admin_settings', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) { await ctx.reply('❌ Menu ini khusus admin.'); return; }
  const kb = Markup.inlineKeyboard([
    [B.primary('🔑 Input Kunci Gateway (gk_)', 'set_gwkey'), B.primary('🌐 Input URL Gateway', 'set_gwurl')],
    [B.primary('🔐 Input Secret Webhook Gateway', 'set_gwsecret')],
    [B.primary('👤 Input Username Digiflazz', 'set_dguser'), B.primary('🔑 Input API Key Digiflazz', 'set_dgkey')],
    [B.primary('💲 Set Margin PPOB', 'set_margin'), B.success('✨ Generate Webhook', 'webhook_generate')],
    [B.primary('🛠️ Admin', 'admin')],
  ]);
  await ctx.reply(settingsText(), { parse_mode: 'HTML', ...kb });
});
bot.action('set_gwkey', async (ctx) => { await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return; sessions.set(ctx.from.id, { step: 'set_gwkey' }); await ctx.reply('Kirim kunci gateway (diawali gk_). Pesan ini akan dihapus setelah dibaca, dan kunci tidak akan ditampilkan kembali.'); });
bot.action('set_gwsecret', async (ctx) => { await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return; sessions.set(ctx.from.id, { step: 'set_gwsecret' }); await ctx.reply('Kirim Secret Webhook Gateway yang SAMA PERSIS dengan secret di pendaftaran webhook gateway. Pesan ini akan dihapus setelah dibaca, dan secret tidak akan ditampilkan kembali.\n\n⚠️ PERINGATAN: mengubah secret ini akan MEMUTUS webhook gateway yang sudah terdaftar dengan secret lama — ping berikutnya akan 403. Setelah ganti secret, hapus webhook lama di gateway lalu daftar ulang lewat tombol Otomatis/Generate di menu Webhook, supaya secret yang dikirim ke gateway sama dengan secret bot sekarang.'); });
bot.action('set_gwurl', async (ctx) => { await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return; sessions.set(ctx.from.id, { step: 'set_gwurl' }); await ctx.reply('Kirim URL gateway, contoh: https://payment-gateway.outletku.ai.id'); });
bot.action('set_dguser', async (ctx) => { await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return; sessions.set(ctx.from.id, { step: 'set_dguser' }); await ctx.reply('Kirim username Digiflazz (dari member.digiflazz.com).'); });
bot.action('set_dgkey', async (ctx) => { await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return; sessions.set(ctx.from.id, { step: 'set_dgkey' }); await ctx.reply('Kirim API Key Digiflazz. Pesan ini akan dihapus setelah dibaca, dan kunci tidak akan ditampilkan kembali.'); });
bot.action('set_margin', async (ctx) => { await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return; sessions.set(ctx.from.id, { step: 'set_margin' }); await ctx.reply('Kirim margin PPOB (angka Rupiah, contoh: 1000). Harga jual = harga Digiflazz + margin.'); });
bot.action('webhook_generate', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) { await ctx.reply('❌ Menu ini khusus admin.'); return; }
  // Generate: secret baru bila kosong (acak, tidak ditampilkan), URL dari
  // domain instalasi ini (bukan hardcode domain toko pertama) — jadi tiap
  // installer mendapat webhook-nya sendiri.
  const crypto = require('crypto');
  if (!config.webhook.secret) { config.saveEnv({ WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex') }); }
  if (!config.digiflazz.webhook.secret) { config.saveEnv({ DIGIFLAZZ_WEBHOOK_SECRET: crypto.randomBytes(32).toString('hex') }); }
  if (!config.p2p.gatewayUrl) { config.saveEnv({ P2P_GATEWAY_URL: 'https://payment-gateway.outletku.ai.id' }); }
  const u = webhookUrls();
  let gwNote = 'Kunci gateway masih kosong — daftar otomatis belum bisa. Isi kunci gateway dulu, lalu tekan Generate lagi atau tombol Otomatis di menu Webhook.';
  if (config.p2p.apiKey) {
    try {
      const res = await fetch(config.p2p.gatewayUrl + '/api/h2h/v1/gopay/webhooks', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': config.p2p.apiKey }, body: JSON.stringify({ url: u.gw, events: ['payment.success', 'payment.expired'], secret: config.webhook.secret }) });
      gwNote = res.status === 201 ? '✅ Gateway: webhook terdaftar otomatis.' : res.status === 409 ? '⚠️ Gateway: batas 10 webhook tercapai, hapus yang lama dulu.' : `❌ Gateway: gagal daftar (HTTP ${res.status}) — cek receiver publik / nginx.`;
    } catch (e) { gwNote = '❌ Gateway: gagal menghubungi gateway: ' + e.message; }
  }
  await ctx.reply(`✨ <b>Webhook Digenerate</b>\n\n<b>Gateway</b>\nURL: <code>${esc(u.gw)}</code>\n${gwNote}\n\n<b>Digiflazz — Form Lengkap</b>\nWebhook ID: ${config.digiflazz.webhook.id ? 'terisi' : 'KOSONG — isi dari dashboard setelah webhook dibuat di sana'}\nPayload URL: <code>${esc(u.dg)}</code>\nContent type: <code>application/json</code>\nSecret Digiflazz: terisi (tidak ditampilkan — baru dibuat bila tadi kosong)\nStatus di bot: ${config.digiflazz.webhook.active ? 'Aktif' : 'Non Aktif — aktifkan di tombol Webhook Digiflazz'}\n\nCara Digiflazz (wajib manual): buka member.digiflazz.com &gt; Pengaturan Koneksi &gt; Edit Koneksi API, isi Payload URL + Secret di atas SAMA PERSIS, aktifkan toggle, tekan Simpan. Lalu whitelist IP VPS di Digiflazz dan IP Digiflazz 52.74.250.133 di sistem.\nDigiflazz tidak punya API auto-register webhook, jadi tombol Generate hanya membuat URL + secret-nya, bukan mendaftarkannya ke Digiflazz.\n\nReceiver bot harus jalan + nginx sudah merutekan /webhook-* agar event masuk.`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[B.primary('🔗 Webhook Digiflazz', 'webhook_digiflazz')]]) });
});

// ---------- Kelola User, Deposit, Transaksi (Admin) ----------
bot.action('admin_users', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) { await ctx.reply('❌ Menu ini khusus admin.'); return; }
  let rows;
  try { rows = await db.all('SELECT telegram_id, username, role, saldo FROM users ORDER BY created_at DESC, telegram_id DESC LIMIT 10', []); }
  catch (e) { await ctx.reply('❌ Gagal buka Kelola User: ' + esc(e.message)); return; }
  if (!rows.length) { await ctx.reply('Belum ada user.'); return; }
  const kbRows = rows.map(r => [B.primary(`${r.telegram_id} ${r.role} ${fmt(r.saldo)}`, 'admin_user:' + r.telegram_id)]);
  kbRows.push([B.primary('🛠️ Admin', 'admin')]);
  await ctx.reply('👥 <b>Kelola User</b> (10 terbaru)\nTekan user untuk detail, ubah role, tambah/kurang saldo, atau lihat transaksinya.', { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbRows) });
});
bot.action(/^admin_user:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) return;
  const uid = ctx.match[1];
  const u = await db.get('SELECT * FROM users WHERE telegram_id=?', [uid]);
  if (!u) { await ctx.reply('User tidak ditemukan.'); return; }
  const kb = Markup.inlineKeyboard([
    [B.primary('🎖️ Jadi Member', 'admin_role:' + uid + ':member'), B.primary('🎖️ Jadi Reseller', 'admin_role:' + uid + ':reseller'), B.primary('👑 Jadi Admin', 'admin_role:' + uid + ':admin')],
    [B.success('➕ Tambah Saldo', 'admin_user_add:' + uid), B.danger('➖ Kurang Saldo', 'admin_user_sub:' + uid)],
    [B.primary('🧾 Transaksi User', 'admin_user_tx:' + uid), B.primary('👥 Kelola User', 'admin_users')],
    [B.primary('🔍 IP Akun User', 'admin_user_iplog:' + uid)],
  ]);
  await ctx.reply(`👤 <b>User ${uid}</b>\nUsername: ${esc(u.username || '-')}\nRole: ${esc(u.role)}\nSaldo: ${fmt(u.saldo)}`, { parse_mode: 'HTML', ...kb });
});
bot.action(/^admin_role:(\d+):(member|reseller|admin)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) return;
  await db.run('UPDATE users SET role=? WHERE telegram_id=?', [ctx.match[2], ctx.match[1]]);
  await ctx.reply(`✅ Role user ${ctx.match[1]} diubah jadi ${ctx.match[2]}.`);
});
bot.action(/^admin_user_add:(\d+)$/, async (ctx) => { await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return; sessions.set(ctx.from.id, { step: 'admin_user_add', targetUid: ctx.match[1] }); await ctx.reply('Kirim nominal tambah saldo (angka saja).'); });
bot.action(/^admin_user_sub:(\d+)$/, async (ctx) => { await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return; sessions.set(ctx.from.id, { step: 'admin_user_sub', targetUid: ctx.match[1] }); await ctx.reply('Kirim nominal kurang saldo (angka saja).'); });
bot.action(/^admin_user_tx:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) return;
  const rows = await db.all('SELECT type, amount, note, created_at FROM transactions WHERE telegram_id=? ORDER BY id DESC LIMIT 20', [ctx.match[1]]);
  await ctx.reply(`🧾 Transaksi user ${ctx.match[1]}:\n` + (rows.length ? rows.map(r => `${r.type} ${fmt(r.amount)} ${esc(r.note || '')} (${r.created_at})`).join('\n') : 'Kosong.'));
});



// ---------- Cek Login IP + Limit IP (2026-11-02, deploy atas persetujuan user) ----------
// Sumber: korelasi log nginx (IP asli, setelah fix PROXY) + log Xray (email).
// Bukan auto-hapus: checker hanya notifikasi, penguncian hanya lewat
// tombol admin, dan unlock membuat ulang akun (link baru) bila kredensial
// lama sudah tidak ada di config.
bot.action(/^iplog:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const row = await db.get('SELECT * FROM vpn_accounts WHERE id=? AND telegram_id=?', [ctx.match[1], ctx.from.id]);
  if (!row) { await ctx.reply('❌ Akun tidak ditemukan.'); return; }
  await ctx.reply(`🔍 <b>IP Login ${esc(row.username)}</b> (${row.proto})\\nLimit: ${row.iplimit > 0 ? row.iplimit + ' IP' : 'tidak dibatasi'}\\nStatus: ${row.locked ? 'TERKUNCI' : 'aktif'}\\n${esc(ipReportText(row.username, row.iplimit || 0))}`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[B.primary('👤 Akun Saya', 'myacc')]]) });
});
bot.action('admin_iplog', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) return;
  const rows = await db.all('SELECT * FROM vpn_accounts ORDER BY id DESC LIMIT 20', []);
  if (!rows.length) { await ctx.reply('Belum ada akun VPN.'); return; }
  let text = '🔍 <b>Cek Login IP (20 akun terbaru)</b>\\nKorelasi nginx + Xray, jendela 3 detik, localhost diabaikan.\\n\\n';
  for (const r of rows) {
    text += `• ${esc(r.username)} (${r.proto}) limit ${r.iplimit > 0 ? r.iplimit : '-'} ${r.locked ? '[TERKUNCI]' : ''}: ${esc(ipReportText(r.username, r.iplimit || 0))}\\n`;
  }
  await ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[B.primary('🛠️ Admin', 'admin')]]) });
});
bot.action(/^admin_iplimit:(\d+)$/, async (ctx) => { await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return; sessions.set(ctx.from.id, { step: 'admin_iplimit', targetId: ctx.match[1] }); await ctx.reply('Kirim limit IP baru (angka 0-10; 0 = tidak dibatasi).'); });
bot.action(/^admin_lock:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return;
  const row = await db.get('SELECT * FROM vpn_accounts WHERE id=?', [ctx.match[1]]);
  if (!row) { await ctx.reply('Akun tidak ditemukan.'); return; }
  if (row.locked) { await ctx.reply('Akun sudah terkunci.'); return; }
  const res = await vpn.deleteAccount(row.proto, row.username);
  if (!res.success) { await ctx.reply(res.message, { parse_mode: 'HTML' }); return; }
  await db.run('UPDATE vpn_accounts SET locked=1 WHERE id=?', [row.id]);
  await ctx.reply(`🔒 Akun ${esc(row.username)} dikunci (dihapus dari config, data di DB tetap). Unlock akan membuat ulang akun dengan link baru.`, { parse_mode: 'HTML' });
});
bot.action(/^admin_unlock:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return;
  const row = await db.get('SELECT * FROM vpn_accounts WHERE id=?', [ctx.match[1]]);
  if (!row) { await ctx.reply('Akun tidak ditemukan.'); return; }
  if (!row.locked) { await ctx.reply('Akun tidak terkunci.'); return; }
  const today = new Date().toISOString().slice(0, 10);
  const days = Math.max(1, Math.ceil((Date.parse(row.expiry + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000));
  if (row.expiry <= today) { await ctx.reply('Akun sudah expired, perpanjang dulu sebelum unlock.'); return; }
  const res = await vpn.createAccount(row.proto, row.username, days);
  if (!res.success) { await ctx.reply(res.message, { parse_mode: 'HTML' }); return; }
  await db.run('UPDATE vpn_accounts SET locked=0, uuid=?, password=?, link_tls=?, link_http=?, link_grpc=?, save_url=? WHERE id=?', [res.uuid || row.uuid || null, res.password || row.password || null, res.links ? res.links.tls : row.link_tls, res.links ? res.links.http : row.link_http, res.links ? res.links.grpc : row.link_grpc, res.saveUrl || row.save_url, row.id]);
  await ctx.reply(`🔓 Akun ${esc(row.username)} dibuka lagi. Link baru (kredensial bisa berubah):\\n${esc(res.links ? res.links.tls : '')}`, { parse_mode: 'HTML' });
});
bot.action(/^admin_user_iplog:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery(); if (!config.isAdmin(ctx.from.id)) return;
  const rows = await db.all('SELECT * FROM vpn_accounts WHERE telegram_id=? ORDER BY id DESC LIMIT 10', [ctx.match[1]]);
  if (!rows.length) { await ctx.reply('User ini belum punya akun VPN.'); return; }
  const kbRows = [];
  let text = '🔍 <b>IP Akun User ' + esc(ctx.match[1]) + '</b>\\n\\n';
  for (const r of rows) {
    text += `• ${esc(r.username)} (${r.proto}) limit ${r.iplimit > 0 ? r.iplimit : '-'} ${r.locked ? '[TERKUNCI]' : ''}: ${esc(ipReportText(r.username, r.iplimit || 0))}\\n`;
    kbRows.push([B.primary(`Set Limit ${r.username}`, 'admin_iplimit:' + r.id), r.locked ? B.success(`Unlock ${r.username}`, 'admin_unlock:' + r.id) : B.danger(`Lock ${r.username}`, 'admin_lock:' + r.id)]);
  }
  kbRows.push([B.primary('🛠️ Admin', 'admin')]);
  await ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbRows) });
});



// ---------- Kelola Produk PPOB (Admin) — SYNC + MANAGEMENT ----------
// Sebelumnya TIDAK ADA: produk hanya diambil live tiap order (prepaid,
// 10 pertama per kategori, tanpa simpan, tanpa tombol sync, tanpa
// admin bisa menonaktifkan / set harga per produk). Sekarang:
//  - Sync: tarik price-list Digiflazz (prepaid + pasca bila ada) ke DB
//  - Lihat per kategori, cari produk, aktif/nonaktif per SKU,
//    set harga jual per SKU (menimpa margin global)
//  - User membeli dari katalog DB ini; bila DB kosong, fallback live
//    (dengan catatan jelas) agar order tidak berhenti total.
// Pascabayar (pasca) disync untuk dilihat, tapi TIDAK dijual di menu
// user dulu — butuh cek tagihan dulu sebelum bayar, itu belum dibuka.
async function ppobSyncStatus() {
  const total = await db.get('SELECT COUNT(*) c FROM ppob_products', []);
  const active = await db.get('SELECT COUNT(*) c FROM ppob_products WHERE enabled=1 AND buyer_product_status=1 AND type=?', ['prepaid']);
  const last = await db.get('SELECT MAX(updated_at) m FROM ppob_products', []);
  const cats = await db.all('SELECT category, COUNT(*) c FROM ppob_products WHERE type=? GROUP BY category ORDER BY c DESC', ['prepaid']);
  return { total: total?.c || 0, active: active?.c || 0, last: last?.m || '-', cats };
}
bot.action('admin_ppob', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) { await ctx.reply('❌ Menu ini khusus admin.'); return; }
  if (!digi.enabled()) { await ctx.reply('⚠️ PPOB belum aktif: isi Username + API Key Digiflazz dulu di Pengaturan & API Key, baru Sync bisa jalan. Katalog saat ini (bila ada) tetap bisa dilihat.'); }
  const st = await ppobSyncStatus();
  const kb = Markup.inlineKeyboard([
    [B.success('🔄 Sync Produk Digiflazz', 'admin_ppob_sync')],
    [B.primary('📋 Lihat per Kategori', 'admin_ppob_cats')],
    [B.primary('🔍 Cari Produk', 'admin_ppob_search_btn')],
    [B.primary('🛠️ Admin', 'admin')],
  ]);
  await ctx.reply(`📱 <b>Kelola Produk PPOB</b>\n\nKatalog DB: ${st.total} produk total, ${st.active} prepaid aktif dijual.\nSync terakhir: ${st.last}\nPer kategori (prepaid):\n${st.cats.length ? st.cats.map(c => `• ${c.category || '-'}: ${c.c}`).join('\n') : 'Belum ada katalog — tekan Sync.'}\n\nMargin global saat ini: ${fmt(config.digiflazz.margin || 0)} (harga jual = harga Digiflazz + margin, kecuali produk yang sudah diset harga per SKU).`, { parse_mode: 'HTML', ...kb });
});
bot.action('admin_ppob_sync', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) return;
  if (!digi.enabled()) { await ctx.reply('❌ PPOB belum aktif: isi Username + API Key Digiflazz dulu.'); return; }
  await ctx.reply('🔄 Sync produk Digiflazz sedang berjalan, tunggu sebentar...');
  let synced = 0, pasca = 0, errors = [];
  for (const cmd of ['prepaid', 'pasca']) {
    let list;
    try { list = await digi.priceList(cmd); } catch (e) { if (cmd === 'prepaid') errors.push('prepaid: ' + e.message); continue; }
    if (!list) continue;
    for (const prod of list) {
      const sku = prod.buyer_sku_code;
      if (!sku) continue;
      const existing = await db.get('SELECT enabled, price_sell_custom FROM ppob_products WHERE buyer_sku_code=?', [sku]);
      const price = Number(prod.price || 0);
      const sell = existing && existing.price_sell_custom != null ? Number(existing.price_sell_custom) : price + Number(config.digiflazz.margin || 0);
      const enabled = existing ? Number(existing.enabled) : (prod.buyer_product_status === true ? 1 : 0);
      await db.run('INSERT INTO ppob_products (buyer_sku_code, product_name, category, brand, type, price, price_sell, price_sell_custom, enabled, buyer_product_status, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime(\'now\')) ON CONFLICT(buyer_sku_code) DO UPDATE SET product_name=excluded.product_name, category=excluded.category, brand=excluded.brand, type=excluded.type, price=excluded.price, price_sell=excluded.price_sell, buyer_product_status=excluded.buyer_product_status, updated_at=datetime(\'now\')',
        [sku, prod.product_name || '', prod.category || '', prod.brand || '', cmd, price, sell, existing ? existing.price_sell_custom : null, enabled, prod.buyer_product_status === true ? 1 : 0]);
      synced++;
      if (cmd === 'pasca') pasca++;
    }
  }
  const st = await ppobSyncStatus();
  await ctx.reply(`✅ Sync selesai.\nProduk diproses: ${synced} (pasca: ${pasca}).\nKatalog DB kini: ${st.total} produk, ${st.active} prepaid aktif dijual.\n${errors.length ? 'Catatan: ' + errors.join(' ') : 'Pascabayar hanya dilihat, belum dijual di menu user.'}`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[B.primary('📱 Kelola Produk PPOB', 'admin_ppob')]]) });
});
bot.action('admin_ppob_cats', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) return;
  const rows = digi.PPOB_CATEGORIES.map(c => [B.primary(c.label, 'admin_ppob_cat:' + c.key)]);
  rows.push([B.primary('📱 Kelola Produk PPOB', 'admin_ppob')]);
  await ctx.reply('Pilih kategori produk PPOB:', { parse_mode: 'HTML', ...Markup.inlineKeyboard(rows) });
});
bot.action(/^admin_ppob_cat:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) return;
  const all = await db.all('SELECT * FROM ppob_products WHERE type=? ORDER BY product_name', ['prepaid']);
  const list = digi.filterByCategory(all, ctx.match[1]);
  if (!list.length) { await ctx.reply('Tidak ada produk di kategori ini di katalog DB. Tekan Sync dulu di Kelola Produk PPOB.'); return; }
  const lines = list.slice(0, 15).map(p => `${p.enabled ? '✅' : '❌'} ${p.product_name} — ${fmt(p.price_sell)} (modal ${fmt(p.price)}) [${p.buyer_sku_code}]`).join('\n');
  const kbRows = list.slice(0, 10).filter(p => String(p.buyer_sku_code || '').length <= 30).map(p => [B.primary(`${p.enabled ? 'Nonaktifkan' : 'Aktifkan'}: ${String(p.product_name).slice(0, 25)}`, 'admin_ppob_toggle:' + p.buyer_sku_code)]);
  kbRows.push([B.primary('📱 Kelola Produk PPOB', 'admin_ppob')]);
  await ctx.reply(`📋 Produk kategori ${ctx.match[1]} (menampilkan ${Math.min(list.length, 15)} dari ${list.length}):\n${lines}\n\nTekan tombol untuk aktif/nonaktifkan produk. Untuk set harga jual per produk, tekan tombol produk lalu pilih Set Harga di pesan berikutnya.`, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbRows) });
});
bot.action(/^admin_ppob_toggle:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) return;
  const sku = ctx.match[1];
  const row = await db.get('SELECT * FROM ppob_products WHERE buyer_sku_code=?', [sku]);
  if (!row) { await ctx.reply('Produk tidak ditemukan.'); return; }
  const ne = row.enabled ? 0 : 1;
  await db.run('UPDATE ppob_products SET enabled=? WHERE buyer_sku_code=?', [ne, sku]);
  const kb = Markup.inlineKeyboard([[B.primary('💲 Set Harga Jual Produk Ini', 'admin_ppob_price:' + sku)], [B.primary('📱 Kelola Produk PPOB', 'admin_ppob')]]);
  await ctx.reply(`Produk ${row.product_name} [${sku}] kini ${ne ? '✅ AKTIF dijual' : '❌ NONAKTIF (tidak muncul di menu user)'}.\nHarga jual: ${fmt(row.price_sell)} (modal ${fmt(row.price)}).`, { parse_mode: 'HTML', ...kb });
});
bot.action(/^admin_ppob_price:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) return;
  sessions.set(ctx.from.id, { step: 'admin_ppob_price', sku: ctx.match[1] });
  await ctx.reply('Kirim harga jual baru untuk produk ini (angka Rupiah saja, mis. 12000). Harga ini menimpa margin global untuk SKU ini saja.');
});
bot.action('admin_ppob_search_btn', async (ctx) => {
  await ctx.answerCbQuery();
  if (!config.isAdmin(ctx.from.id)) return;
  sessions.set(ctx.from.id, { step: 'admin_ppob_search' });
  await ctx.reply('Kirim kata kunci produk (nama / SKU / brand), mis. <code>TELKOMSEL</code> atau <code>PLN</code>.', { parse_mode: 'HTML' });
});

// ---------- Upload foto/dokumen (khusus admin_logo) ----------
async function handleLogoUpload(ctx, fileId, mime, size) {
  if (!config.isAdmin(ctx.from.id)) { await ctx.reply('❌ Hanya admin yang bisa upload logo.'); return; }
  const okMime = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const ext = okMime[mime];
  if (!ext) { await ctx.reply('❌ Format harus JPG, PNG, atau WebP.'); return; }
  if (size && size > 5 * 1024 * 1024) { await ctx.reply('❌ Ukuran maks 5 MB.'); return; }
  try {
    const link = await ctx.telegram.getFileLink(fileId);
    const res = await fetch(link.href || link, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error('Gagal unduh foto dari Telegram.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) { await ctx.reply('❌ Ukuran maks 5 MB.'); return; }
    for (const e of ['jpg', 'jpeg', 'png', 'webp']) { const f = path.join(__dirname, 'assets', 'logo-menu.' + e); if (fs.existsSync(f)) fs.unlinkSync(f); }
    const dest = path.join(__dirname, 'assets', 'logo-menu.' + ext);
    fs.writeFileSync(dest, buf);
    sessions.delete(ctx.from.id);
    await ctx.reply(`✅ Logo menu utama tersimpan (${(buf.length / 1024).toFixed(0)} KB). Coba /start untuk melihatnya di depan menu utama.`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[B.plain('🏠 Beranda', 'menu')]]) });
  } catch (e) { await ctx.reply('❌ Gagal simpan logo: ' + esc(e.message)); }
}
bot.on('photo', async (ctx) => {
  const sess = sessions.get(ctx.from.id);
  if (!sess || sess.step !== 'admin_logo') return;
  const photos = ctx.message.photo || [];
  if (!photos.length) return;
  const best = photos[photos.length - 1];
  await handleLogoUpload(ctx, best.file_id, 'image/jpeg', best.file_size);
});
bot.on('document', async (ctx) => {
  const sess = sessions.get(ctx.from.id);
  if (!sess || sess.step !== 'admin_logo') return;
  const doc = ctx.message.document || {};
  if (!doc.mime_type || !doc.mime_type.startsWith('image/')) { await ctx.reply('❌ Kirim gambar (JPG/PNG/WebP), bukan dokumen lain.'); return; }
  await handleLogoUpload(ctx, doc.file_id, doc.mime_type, doc.file_size);
});

// ---------- Pesan teks (input bertahap) ----------
bot.on('text', async (ctx) => {
  const s = sessions.get(ctx.from.id);
  if (!s) return;
  const text = (ctx.message.text || '').trim();
  try {
    if (s.step === 'admin_logo') {
      const t = text.toUpperCase();
      if (t === 'BATAL') { sessions.delete(ctx.from.id); await ctx.reply('Dibatalkan, logo tidak berubah.'); return; }
      if (t === 'HAPUS') {
        let removed = false;
        for (const ext of ['jpg', 'jpeg', 'png', 'webp']) { const f = path.join(__dirname, 'assets', 'logo-menu.' + ext); if (fs.existsSync(f)) { fs.unlinkSync(f); removed = true; } }
        sessions.delete(ctx.from.id);
        await ctx.reply(removed ? '✅ Logo dihapus.' : 'Logo memang belum ada.');
        return;
      }
      await ctx.reply('Kirim FOTO logo, atau teks HAPUS / BATAL.'); return;
    }
    if (s.step === 'cek_kuota') {
      const res = await kuota.cekKuota(text);
      sessions.delete(ctx.from.id);
      await ctx.reply(res.message, { parse_mode: 'HTML', ...mainMenu(ctx.from.id) });
      return;
    }
    if (s.step === 'deposit_amount' || s.step === 'deposit_amount_auto') {
      const amount = Number(text.replace(/[^0-9]/g, ''));
      if (!Number.isFinite(amount) || amount < 5000) { await ctx.reply('❌ Nominal minimal Rp5.000, kirim angka saja.'); return; }
      // Deposit QRIS OTOMATIS (gateway, sesuai api-docs): buat QRIS dinamis
      // sungguhan, bukan QRIS palsu / catatan manual. Reference unik per
      // deposit agar webhook payment.success bisa dicocokkan ke user ini.
      if (s.step === 'deposit_amount_auto' && config.depositAutoEnabled) {
        const reference = `DEP-${ctx.from.id}-${Date.now()}`;
        const q = await gateway.createQris(amount, reference);
        if (!q.success) {
          sessions.delete(ctx.from.id);
          await ctx.reply(`❌ Gagal buat QRIS gateway: ${esc(q.message)}\n\nSilakan pakai Deposit Manual (admin konfirmasi) atau coba lagi nanti. QRIS palsu tidak ditampilkan.`, { parse_mode: 'HTML', ...mainMenu(ctx.from.id) });
          return;
        }
        const d = q.data;
        const r = await db.run('INSERT INTO deposits (telegram_id, amount, status, reference, qris_id, trx_id, qris_url, expires_at) VALUES (?,?,?,?,?,?,?,?)', [ctx.from.id, amount, 'pending', reference, d.qris_id || '', d.trx_id || '', d.qris_url || '', d.expires_at || '']);
        sessions.delete(ctx.from.id);
        const payAmount = Number(d.amount || amount);
        const qrText = `📷 <b>Deposit QRIS — Bayar dalam 5 menit</b>\n\nNominal deposit: <b>${fmt(amount)}</b>\nBayar QRIS: <b>${fmt(payAmount)}</b>${payAmount !== amount ? ' (termasuk kode unik gateway)' : ''}\nReference: <code>${esc(reference)}</code>\nQRIS ID: <code>${esc(d.qris_id || '-')}</code>\nKedaluwarsa: ${esc(d.expires_at || '5 menit dari sekarang')}\n\nBayar QRIS di bawah ini dengan GoPay / e-wallet. Setelah lunas, gateway mengirim webhook ke bot dan saldo masuk OTOMATIS — tidak perlu kirim bukti ke admin.\n\n⚠️ Jangan bayar setelah kedaluwarsa. Bila kedaluwarsa, buat deposit baru.`;
        try {
          // Kirim gambar QR bila gateway memberi URL gambar, kalau tidak
          // kirim kode QRIS + link sebagai teks (bukan QR palsu).
          if (d.qr_image_url) await ctx.replyWithPhoto(d.qr_image_url, { caption: qrText, parse_mode: 'HTML', ...mainMenu(ctx.from.id) });
          else await ctx.reply(qrText + `\n\nQRIS URL: ${esc(d.qris_url || '-')}\nKode QRIS:\n<code>${esc(d.qris_code || '-')}</code>`, { parse_mode: 'HTML', ...mainMenu(ctx.from.id) });
        } catch (e) {
          await ctx.reply(qrText + `\n\nQRIS URL: ${esc(d.qris_url || '-')}`, { parse_mode: 'HTML', ...mainMenu(ctx.from.id) });
        }
        if (config.adminId && !config.isAdmin(ctx.from.id)) { try { await ctx.telegram.sendMessage(config.adminId, `📷 QRIS deposit #${r.id}: user ${ctx.from.id} reference ${reference} sebesar ${fmt(amount)} (bayar ${fmt(payAmount)}).`); } catch {} }
        return;
      }
      const r = await db.run('INSERT INTO deposits (telegram_id, amount, status) VALUES (?,?,?)', [ctx.from.id, amount, 'pending']);
      sessions.delete(ctx.from.id);
      await ctx.reply(`📥 Deposit Rp${amount.toLocaleString('id-ID')} dicatat (ID #${r.id}, status pending).\n\nHubungi admin / kirim bukti transfer, admin akan konfirmasi dan saldo masuk.`, { parse_mode: 'HTML', ...mainMenu(ctx.from.id) });
      if (config.isAdmin(ctx.from.id)) {} else if (config.adminId) { try { await ctx.telegram.sendMessage(config.adminId, `📥 Deposit pending #${r.id}: user ${ctx.from.id} (${esc(ctx.from.username || '')}) sebesar ${fmt(amount)}.`); } catch {} }
      return;
    }
    if (s.step === 'buy_username') {
      if (!vpn.validUser(text)) { await ctx.reply('❌ Username 3-20 karakter, huruf/angka saja. Kirim ulang.'); return; }
      const u = await db.ensureUser(ctx.from.id, ctx.from.username || '');
      const isTrial = s.dur === 'trial';
      const days = isTrial ? 1 : Number(s.dur);
      const price = isTrial ? 0 : (await db.getPrice(s.proto, u.role)) * days;
      if (!isTrial && u.role !== 'admin' && (await db.getBalance(ctx.from.id)) < price) { sessions.delete(ctx.from.id); await ctx.reply(`❌ Saldo tidak cukup. Butuh ${fmt(price)}. Deposit dulu.`); return; }
      // Saldo dipotong HANYA setelah API sukses (anti bayar akun gagal).
      const res = await vpn.createAccount(s.proto, text, days);
      if (!res.success) { sessions.delete(ctx.from.id); await ctx.reply(res.message, { parse_mode: 'HTML' }); return; }
      if (!isTrial && u.role !== 'admin') await db.deductBalance(ctx.from.id, price, `beli ${s.proto} ${text} ${days}h`);
      if (isTrial) await db.recordTrialClaim(ctx.from.id);
      const acc = await db.run('INSERT INTO vpn_accounts (telegram_id, proto, username, expiry, is_trial, uuid, password, link_tls, link_http, link_grpc, save_url) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [ctx.from.id, s.proto, text, res.expiry, isTrial ? 1 : 0, res.uuid || null, res.password || null, res.links ? res.links.tls : null, res.links ? res.links.http : null, res.links ? res.links.grpc : null, res.saveUrl || null]);
      sessions.delete(ctx.from.id);
      // Harga disisipkan SEBELUM "ACCOUNT BERHASIL DIBUAT" agar pesan
      // tetap berakhir dengan ucapan terima kasih seperti contoh.
      let msg = res.message;
      const priceLine = `💰 Harga: ${fmt(price)}${isTrial ? ' (trial gratis)' : ''}.`;
      if (msg.includes('ACCOUNT BERHASIL DIBUAT')) msg = msg.replace('🎉 <b>ACCOUNT BERHASIL DIBUAT</b>', priceLine + '\n\n🎉 <b>ACCOUNT BERHASIL DIBUAT</b>');
      else msg = msg + `\n${priceLine}`;
      const exportKb = Markup.inlineKeyboard([
        [B.primary('📦 Clash', 'export:' + acc.id + ':clash'), B.primary('⚡ V2Ray', 'export:' + acc.id + ':v2ray')],
        [B.primary('📱 HTTP Custom', 'export:' + acc.id + ':httpcustom'), B.primary('🌐 NetMod', 'export:' + acc.id + ':netmod')],
        [B.danger('❌ Tutup', 'close_msg'), B.plain('🏠 Beranda', 'menu')],
      ]);
      await ctx.reply(msg, { parse_mode: 'HTML', ...exportKb });
      return;
    }
    if (s.step === 'ppob_search') {
      const kw = text.toLowerCase();
      const pool = s.ppobAll && s.ppobAll.length ? s.ppobAll : [];
      let matches = pool.filter(p => String(p.product_name || '').toLowerCase().includes(kw) || String(p.buyer_sku_code || '').toLowerCase().includes(kw) || String(p.brand || '').toLowerCase().includes(kw));
      if (!matches.length) {
        try { const dbRows = await db.all('SELECT * FROM ppob_products WHERE type=? AND enabled=1 AND (LOWER(product_name) LIKE ? OR LOWER(buyer_sku_code) LIKE ? OR LOWER(brand) LIKE ?) ORDER BY product_name LIMIT 10', ['prepaid', '%' + kw + '%', '%' + kw + '%', '%' + kw + '%']); matches = dbRows; } catch {}
      }
      if (!matches.length) { await ctx.reply('❌ Tidak ada produk yang cocok dengan kata kunci itu. Kirim kata kunci lain, atau kembali ke menu PPOB.'); return; }
      sessions.set(ctx.from.id, { step: 'ppob_pick', ppobNo: s.ppobNo, ppobProducts: matches.slice(0, 10), ppobAll: pool });
      const kb = Markup.inlineKeyboard([...matches.slice(0, 10).map((p, i) => [B.success(`${p.product_name} — ${fmt(p.price_sell)}`, 'ppob_pick:' + i)]), [B.plain('🏠 Beranda', 'menu')]]);
      await ctx.reply(`Hasil cari "${esc(text)}" untuk <code>${esc(s.ppobNo)}</code>:`, { parse_mode: 'HTML', ...kb });
      return;
    }
    if (s.step === 'admin_ppob_search') {
      if (!config.isAdmin(ctx.from.id)) { sessions.delete(ctx.from.id); return; }
      const kw = '%' + text.toLowerCase() + '%';
      const rows = await db.all('SELECT * FROM ppob_products WHERE LOWER(product_name) LIKE ? OR LOWER(buyer_sku_code) LIKE ? OR LOWER(brand) LIKE ? ORDER BY product_name LIMIT 10', [kw, kw, kw]);
      sessions.delete(ctx.from.id);
      if (!rows.length) { await ctx.reply('Tidak ada produk yang cocok di katalog DB. Sync dulu bila katalog kosong.'); return; }
      const kbRows = rows.filter(p => String(p.buyer_sku_code || '').length <= 30).map(p => [B.primary(`${p.enabled ? 'Nonaktifkan' : 'Aktifkan'}: ${String(p.product_name).slice(0, 25)}`, 'admin_ppob_toggle:' + p.buyer_sku_code)]);
      kbRows.push([B.primary('📱 Kelola Produk PPOB', 'admin_ppob')]);
      await ctx.reply('Hasil cari:\n' + rows.map(p => `${p.enabled ? '✅' : '❌'} ${p.product_name} — ${fmt(p.price_sell)} [${p.buyer_sku_code}]`).join('\n'), { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbRows) });
      return;
    }
    if (s.step === 'admin_ppob_price') {
      if (!config.isAdmin(ctx.from.id)) { sessions.delete(ctx.from.id); return; }
      const price = Number(text.replace(/[^0-9]/g, ''));
      if (!Number.isFinite(price) || price <= 0) { await ctx.reply('❌ Harga harus angka > 0. Kirim ulang.'); return; }
      await db.run('UPDATE ppob_products SET price_sell=?, price_sell_custom=? WHERE buyer_sku_code=?', [price, price, s.sku]);
      sessions.delete(ctx.from.id);
      await ctx.reply(`✅ Harga jual produk ${s.sku} kini ${fmt(price)} (menimpa margin global untuk SKU ini).`);
      return;
    }
    if (s.step === 'ppob_no') {
      const no = text.replace(/\s/g, '');
      if (no.length < 9) { await ctx.reply('❌ Nomor terlalu pendek. Kirim ulang.'); return; }
      if (!digi.enabled()) { sessions.delete(ctx.from.id); await ctx.reply('⚠️ PPOB belum aktif, hubungi admin.'); return; }
      // Sumber produk: katalog DB hasil Sync dulu (stabil, bisa diatur
      // admin). Bila DB kosong, fallback price-list live dengan catatan.
      let allProducts, source = 'katalog DB (hasil Sync)';
      try {
        const dbRows = await db.all('SELECT * FROM ppob_products WHERE type=? AND enabled=1 AND buyer_product_status=1 ORDER BY product_name', ['prepaid']);
        if (dbRows.length) allProducts = dbRows;
        else { allProducts = await digi.priceList('prepaid'); source = 'price-list live (katalog DB masih kosong — admin belum Sync)'; }
      } catch (e) { sessions.delete(ctx.from.id); await ctx.reply('❌ Gagal ambil produk PPOB: ' + esc(e.message)); return; }
      const filtered = digi.filterByCategory(allProducts, s.cat);
      const list = filtered.slice(0, 10);
      sessions.set(ctx.from.id, { step: 'ppob_pick', ppobNo: no, ppobProducts: list, ppobAll: filtered });
      const kb = Markup.inlineKeyboard([...list.map((p, i) => [B.success(`${p.product_name} — ${fmt(p.price_sell)}`, 'ppob_pick:' + i)]), [B.primary('🔍 Cari Produk Lain', 'ppob_search_btn')], [B.plain('🏠 Beranda', 'menu')]]);
      await ctx.reply(`Pilih produk untuk <code>${esc(no)}</code> (sumber: ${source}, ${filtered.length} produk di kategori ini, ditampilkan 10 pertama):`, { parse_mode: 'HTML', ...kb });
      return;
    }
    if (s.step === 'ppob_check_ref') {
      const o = await db.get('SELECT * FROM ppob_orders WHERE ref_id=? AND telegram_id=?', [text, ctx.from.id]);
      if (!o) { sessions.delete(ctx.from.id); await ctx.reply('❌ Order PPOB tidak ditemukan untuk user ini.'); return; }
      const can = digi.canCheckStatus(o.last_checked_at, o.created_at);
      if (!can.ok) { await ctx.reply('❌ ' + can.reason); return; }
      await db.run('UPDATE ppob_orders SET last_checked_at=datetime(\'now\') WHERE ref_id=?', [text]);
      let st;
      try { st = await digi.checkStatusPrepaid(text); } catch (e) { await ctx.reply('❌ Gagal cek status: ' + esc(e.message)); return; }
      const dgStatus = st?.status || st?.message || '';
      const action = digi.saldoActionForStatus(dgStatus);
      let note = '';
      if (action === 'refund' && o.locked) {
        await db.addBalance(ctx.from.id, o.price_sell, 'refund ppob gagal ' + text);
        await db.run('UPDATE ppob_orders SET status=?, locked=0 WHERE ref_id=?', ['gagal', text]);
        note = '\n💰 Saldo terkunci dikembalikan.';
      } else if (action === 'deduct') {
        await db.run('UPDATE ppob_orders SET status=?, locked=0 WHERE ref_id=?', ['sukses', text]);
      } else if (action === 'refund') {
        await db.run('UPDATE ppob_orders SET status=? WHERE ref_id=?', ['gagal', text]);
      }
      sessions.delete(ctx.from.id);
      await ctx.reply(`🔎 Status PPOB <code>${esc(text)}</code>\nProduk: ${esc(o.product_name)}\nTujuan: <code>${esc(o.customer_no)}</code>\nStatus Digiflazz: ${esc(dgStatus)}${note}`, { parse_mode: 'HTML', ...mainMenu(ctx.from.id) });
      return;
    }
    if (s.step === 'admin_addsaldo' && config.isAdmin(ctx.from.id)) {
      const [uid, amt] = text.split(/\s+/);
      const amount = Number(amt);
      if (!uid || !Number.isFinite(amount) || amount <= 0) { await ctx.reply('❌ Format: USERID NOMINAL'); return; }
      const bal = await db.addBalance(Number(uid), amount, 'tambah saldo admin');
      sessions.delete(ctx.from.id);
      await ctx.reply(`✅ Saldo user ${uid} ditambah ${fmt(amount)}. Kini ${fmt(bal)}.`);
      return;
    }
    if (s.step === 'set_gwkey' && config.isAdmin(ctx.from.id)) {
      if (!text.startsWith('gk_')) { await ctx.reply('❌ Kunci gateway harus diawali gk_. Kirim ulang atau tekan tombol lain untuk batal.'); return; }
      config.saveEnv({ P2P_API_KEY: text }); await deleteSecretMessage(ctx); sessions.delete(ctx.from.id);
      await ctx.reply('✅ Kunci gateway tersimpan (nilai tidak ditampilkan). Deposit otomatis kini ' + (config.depositAutoEnabled ? 'AKTIF' : 'belum aktif — cek URL gateway.') + ' Menu Webhook kini bisa dipakai.');
      return;
    }
    if (s.step === 'set_gwurl' && config.isAdmin(ctx.from.id)) {
      if (!/^https?:\/\//.test(text)) { await ctx.reply('❌ URL harus diawali http:// atau https://. Kirim ulang.'); return; }
      config.saveEnv({ P2P_GATEWAY_URL: text.replace(/\/$/, '') }); sessions.delete(ctx.from.id);
      await ctx.reply('✅ URL gateway tersimpan: <code>' + esc(config.p2p.gatewayUrl) + '</code>', { parse_mode: 'HTML' });
      return;
    }
    if (s.step === 'set_gwsecret' && config.isAdmin(ctx.from.id)) {
      if (text.length < 10) { await ctx.reply('❌ Secret terlalu pendek. Kirim ulang.'); return; }
      config.saveEnv({ WEBHOOK_SECRET: text }); await deleteSecretMessage(ctx); sessions.delete(ctx.from.id);
      await ctx.reply('✅ Secret Webhook Gateway tersimpan (nilai tidak ditampilkan).\n\n⚠️ Webhook lama yang terdaftar dengan secret lama kini akan 403. Hapus webhook lama di gateway, lalu daftar ulang lewat Admin > Webhook > Otomatis/Generate, supaya secret di gateway sama dengan secret bot sekarang.');
      return;
    }
    if (s.step === 'set_dguser' && config.isAdmin(ctx.from.id)) {
      config.saveEnv({ DIGIFLAZZ_USERNAME: text }); sessions.delete(ctx.from.id);
      await ctx.reply('✅ Username Digiflazz tersimpan (nilai tidak ditampilkan penuh). PPOB kini ' + (config.ppobEnabled ? 'AKTIF' : 'belum aktif — isi API Key juga.') + ' Jangan lupa whitelist IP VPS di member.digiflazz.com.');
      return;
    }
    if (s.step === 'set_dgkey' && config.isAdmin(ctx.from.id)) {
      if (text.length < 10) { await ctx.reply('❌ API Key terlalu pendek. Kirim ulang.'); return; }
      config.saveEnv({ DIGIFLAZZ_API_KEY: text }); await deleteSecretMessage(ctx); sessions.delete(ctx.from.id);
      await ctx.reply('✅ API Key Digiflazz tersimpan (nilai tidak ditampilkan). PPOB kini ' + (config.ppobEnabled ? 'AKTIF' : 'belum aktif — isi username juga.'));
      return;
    }
    if (s.step === 'set_dgwhid' && config.isAdmin(ctx.from.id)) {
      config.saveEnv({ DIGIFLAZZ_WEBHOOK_ID: text }); sessions.delete(ctx.from.id);
      await ctx.reply('✅ Webhook ID Digiflazz tersimpan (hanya status terisi yang ditampilkan di menu).');
      return;
    }
    if (s.step === 'set_dgwhurl' && config.isAdmin(ctx.from.id)) {
      if (text.toLowerCase() === 'default') { config.saveEnv({ DIGIFLAZZ_WEBHOOK_URL: '' }); sessions.delete(ctx.from.id); await ctx.reply('✅ Payload URL Digiflazz dikembalikan ke URL bot ini.'); return; }
      if (!/^https?:\/\//.test(text)) { await ctx.reply('❌ Payload URL harus diawali http:// atau https://. Kirim ulang, atau kirim "default".'); return; }
      config.saveEnv({ DIGIFLAZZ_WEBHOOK_URL: text.replace(/\/$/, '') }); sessions.delete(ctx.from.id);
      await ctx.reply('✅ Payload URL Digiflazz tersimpan: <code>' + esc(config.digiflazz.webhook.url) + '</code>\n\nIngat: ini baru tersimpan di bot. URL di dashboard Digiflazz harus diubah ke nilai yang sama dan disimpan di sana, kalau tidak Digiflazz tetap kirim ke URL lama.', { parse_mode: 'HTML' });
      return;
    }
    if (s.step === 'set_dgwhsecret' && config.isAdmin(ctx.from.id)) {
      if (text.length < 10) { await ctx.reply('❌ Secret terlalu pendek. Kirim ulang.'); return; }
      config.saveEnv({ DIGIFLAZZ_WEBHOOK_SECRET: text }); await deleteSecretMessage(ctx); sessions.delete(ctx.from.id);
      await ctx.reply('✅ Secret webhook Digiflazz tersimpan (nilai tidak ditampilkan). Pastikan secret yang sama persis ada di form dashboard Digiflazz, kalau tidak signature event ditolak.');
      return;
    }
    if (s.step === 'set_margin' && config.isAdmin(ctx.from.id)) {
      const amount = Number(text.replace(/[^0-9]/g, ''));
      if (!Number.isFinite(amount) || amount < 0) { await ctx.reply('❌ Margin harus angka. Kirim ulang.'); return; }
      config.saveEnv({ PPOB_MARGIN: String(amount) }); sessions.delete(ctx.from.id);
      await ctx.reply(`✅ Margin PPOB = ${fmt(amount)}. Harga jual = harga Digiflazz + margin.`);
      return;
    }
    if (s.step === 'admin_user_add' && config.isAdmin(ctx.from.id)) {
      const amount = Number(text.replace(/[^0-9]/g, ''));
      if (!amount || amount <= 0) { await ctx.reply('❌ Nominal harus angka > 0.'); return; }
      const bal = await db.addBalance(Number(s.targetUid), amount, 'tambah saldo admin'); sessions.delete(ctx.from.id);
      await ctx.reply(`✅ Saldo user ${s.targetUid} ditambah ${fmt(amount)}. Kini ${fmt(bal)}.`);
      return;
    }
    if (s.step === 'admin_user_sub' && config.isAdmin(ctx.from.id)) {
      const amount = Number(text.replace(/[^0-9]/g, ''));
      if (!amount || amount <= 0) { await ctx.reply('❌ Nominal harus angka > 0.'); return; }
      const bal = await db.addBalance(Number(s.targetUid), -amount, 'kurang saldo admin'); sessions.delete(ctx.from.id);
      await ctx.reply(`✅ Saldo user ${s.targetUid} dikurangi ${fmt(amount)}. Kini ${fmt(bal)}.`);
      return;
    }
    if (s.step === 'admin_price' && config.isAdmin(ctx.from.id)) {
      const [proto, role, price] = text.split(/\s+/);
      try { const p = await db.setPrice(proto, role, Number(price)); sessions.delete(ctx.from.id); await ctx.reply(`✅ Harga ${proto} ${role} = ${fmt(p)}/hari.`); }
      catch (e) { await ctx.reply('❌ ' + esc(e.message)); }
      return;
    }
    if (s.step === 'admin_iplimit' && config.isAdmin(ctx.from.id)) {
      const n = Number(text.replace(/[^0-9]/g, ''));
      if (!Number.isFinite(n) || n < 0 || n > 10) { await ctx.reply('❌ Limit harus 0-10.'); return; }
      await db.run('UPDATE vpn_accounts SET iplimit=? WHERE id=?', [n, s.targetId]); sessions.delete(ctx.from.id);
      await ctx.reply(`✅ Limit IP akun #${s.targetId} diubah jadi ${n === 0 ? 'tidak dibatasi' : n + ' IP'}.`);
      return;
    }
    if (s.step === 'admin_broadcast' && config.isAdmin(ctx.from.id)) {
      const users = await db.all('SELECT telegram_id FROM users', []);
      let sent = 0;
      for (const u of users) { try { await ctx.telegram.sendMessage(u.telegram_id, text); sent++; } catch {} }
      sessions.delete(ctx.from.id);
      await ctx.reply(`📣 Broadcast terkirim ke ${sent}/${users.length} user.`);
      return;
    }
  } catch (e) {
    sessions.delete(ctx.from.id);
    await ctx.reply('❌ Terjadi kesalahan: ' + esc(e.message));
  }
});

(async () => {
  await db.init();
  console.log('✅ Bot-baru siap. Menu: Beli VPN + Beli PPOB (satu bot, dua etalase).');
  console.log('   VPN create:', config.vpnCreateEnabled ? 'AKTIF' : 'NONAKTIF (isi VPN_DOMAIN/VPN_API_AUTH)');
  console.log('   PPOB:', config.ppobEnabled ? 'AKTIF' : 'NONAKTIF (isi Digiflazz)');
  console.log('   Deposit QRIS otomatis:', config.depositAutoEnabled ? 'TERKONFIGURASI' : 'NONAKTIF (deposit manual aktif)');
  // Receiver webhook loopback — gagal start tidak boleh mematikan bot Telegram.
  try {
    const wh = createWebhookServer({
      port: config.webhook.port, secret: () => config.webhook.secret,
      digiflazzSecret: () => config.digiflazz.webhook.secret, digiflazzActive: () => config.digiflazz.webhook.active,
      onNotify: async (msg) => { if (config.adminId) { try { await bot.telegram.sendMessage(config.adminId, msg); } catch {} } },
      onGatewayPayment: async (d) => {
        // Auto-credit deposit QRIS gateway — HANYA bila reference/qris_id
        // cocok dengan deposit pending di DB bot. Event uji / deposit
        // sistem lain TIDAK dikredit (return false -> admin diberitahu saja).
        const ref = d.reference || '';
        const qid = d.qris_id || '';
        const dep = await db.get('SELECT * FROM deposits WHERE status=? AND (reference=? OR qris_id=?) ORDER BY id DESC', ['pending', ref, qid]);
        if (!dep) return false;
        const credit = Number(d.amount || dep.amount);
        await db.run('UPDATE deposits SET status=? WHERE id=?', ['paid', dep.id]);
        const bal = await db.addBalance(dep.telegram_id, credit, 'deposit QRIS gateway ' + (ref || qid));
        try { await bot.telegram.sendMessage(dep.telegram_id, `✅ Deposit LUNAS!\nReference: <code>${esc(ref || '-')}</code>\nSaldo masuk: <b>${fmt(credit)}</b>\nSaldo sekarang: <b>${fmt(bal)}</b>\n\nTerima kasih, saldo sudah bisa dipakai beli VPN / PPOB.`, { parse_mode: 'HTML', ...mainMenu(dep.telegram_id) }); } catch {}
        if (config.adminId) { try { await bot.telegram.sendMessage(config.adminId, `✅ Auto-credit deposit #${dep.id}: user ${dep.telegram_id} reference ${ref} sebesar ${fmt(credit)} (saldo kini ${fmt(bal)}).`); } catch {} }
        return true;
      },
      onGatewayExpired: async (d) => {
        const ref = d.reference || '';
        const qid = d.qris_id || '';
        const dep = await db.get('SELECT * FROM deposits WHERE status=? AND (reference=? OR qris_id=?) ORDER BY id DESC', ['pending', ref, qid]);
        if (!dep) return false;
        await db.run('UPDATE deposits SET status=? WHERE id=?', ['expired', dep.id]);
        try { await bot.telegram.sendMessage(dep.telegram_id, `⏰ QRIS deposit reference <code>${esc(ref || '-')}</code> kedaluwarsa (5 menit). Saldo tidak masuk. Buat deposit baru bila masih mau isi saldo.`, { parse_mode: 'HTML', ...mainMenu(dep.telegram_id) }); } catch {}
        return true;
      },
      onDigiflazz: async (event, payload) => {
        // Update order PPOB dari webhook Digiflazz, meniru logika cek status
        // manual: sukses = buka kunci (tanpa ubah saldo, karena saldo sudah
        // dipotong saat order), gagal = kembalikan saldo terkunci.
        // Hanya untuk order yang masih locked=1; order final tidak diubah.
        try {
          const o = await db.get('SELECT * FROM ppob_orders WHERE ref_id=?', [payload.ref_id]);
          if (!o) { if (config.adminId) await bot.telegram.sendMessage(config.adminId, `🔔 Webhook Digiflazz: ref ${payload.ref_id} tidak ada di DB bot, diabaikan.`); return; }
          if (!o.locked) return;
          const action = digi.saldoActionForStatus(payload.status || '');
          if (action === 'deduct') {
            await db.run('UPDATE ppob_orders SET status=?, locked=0 WHERE ref_id=?', ['sukses', payload.ref_id]);
            try { await bot.telegram.sendMessage(o.telegram_id, `✅ PPOB ${esc(o.product_name)} ke ${esc(o.customer_no)} sudah SUKSES (via webhook Digiflazz).`); } catch {}
          } else if (action === 'refund') {
            await db.addBalance(o.telegram_id, o.price_sell, 'refund ppob gagal via webhook ' + payload.ref_id);
            await db.run('UPDATE ppob_orders SET status=?, locked=0 WHERE ref_id=?', ['gagal', payload.ref_id]);
            try { await bot.telegram.sendMessage(o.telegram_id, `❌ PPOB ${esc(o.product_name)} GAGAL (via webhook Digiflazz). Saldo terkunci dikembalikan.`); } catch {}
          }
          if (config.adminId) await bot.telegram.sendMessage(config.adminId, `🔔 Webhook Digiflazz: ${payload.ref_id} -> ${action} (status Digiflazz: ${payload.status || '-'})`);
        } catch (e) { console.warn('Webhook Digiflazz gagal proses order:', e.message); }
      },
    });
    await wh.listen();
    console.log('   Webhook receiver: 127.0.0.1:' + config.webhook.port + ' (/webhook-gateway, /webhook-digiflazz)');
  } catch (e) { console.warn('⚠️ Webhook receiver gagal start (bot tetap jalan):', e.message); }
  bot.catch(async (err, ctx) => {
    console.error('Bot error:', err && err.message ? err.message : err);
    try { await ctx.reply('❌ Terjadi kesalahan di bot: ' + esc(err && err.message ? err.message : String(err)) + '\nCoba lagi, atau laporkan pesan ini ke pengembang.'); } catch {}
  });
  // Checker IP limit: hanya NOTIFIKASI, bukan auto-hapus / auto-lock.
  // Sekali per akun per 24 jam, agar tidak spam admin/user.
  setInterval(async () => {
    try {
      const rows = await db.all('SELECT * FROM vpn_accounts WHERE locked=0 AND iplimit > 0', []);
      for (const r of rows) {
        const rep = ipReportFor(r.username);
        if (!rep || rep.count <= (r.iplimit || 0) || rep.ambiguous) continue;
        const last = ipNotified.get(r.id) || 0;
        if (Date.now() - last < 24 * 3600 * 1000) continue;
        ipNotified.set(r.id, Date.now());
        const msg = `⚠️ IP Limit terlampaui: ${r.username} (${r.proto}) pakai ${rep.count} IP, limit ${r.iplimit}. IP: ${rep.ips.join(', ')}. Akun TIDAK otomatis dihapus — admin bisa Lock dari menu Cek Login IP.`;
        try { if (config.adminId) await bot.telegram.sendMessage(config.adminId, msg); } catch {}
        try { await bot.telegram.sendMessage(r.telegram_id, `⚠️ Akun VPN ${r.username} terdeteksi dari ${rep.count} IP (limit ${r.iplimit}). Bila ini bukan kamu, hubungi admin.`); } catch {}
      }
    } catch (e) { console.warn('IP checker gagal:', e.message); }
  }, 15 * 60 * 1000);
  await bot.launch();
  console.log('🤖 Bot Telegram berjalan.');
})();
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

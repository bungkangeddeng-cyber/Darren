# Bot Jualan — SATU Bot, DUA Produk

Bot Telegram jualan yang dirombak bersih dari `/root/bot-js` lama.
Staging di VPS: `/root/bot-baru`. Bot lama TIDAK ditimpa;
backupnya ada di `/root/bot-js.bak-rombak-20261101`.
Bot baru ini **belum dijalankan via PM2** — sengaja, sampai
konfigurasi live diisi admin server (lihat bawah).

## Tampilan baru (struktur dari screenshot contoh, brand sendiri)

Brand yang dipakai adalah **RIPZZ STORE** (brand toko user dari bot
lama), BUKAN nama/logo/banner/channel/support bot contoh. Tidak ada
gambar, nama, channel, group, atau username support bot contoh yang
disalin. Banner yang dipakai adalah aset bot lama sendiri
(`assets/banner-utama.webp`, `assets/banner-ppob.webp`, disalin dari
`/root/bot-js/assets`); bila file banner tidak ada, bot kirim teks
saja. Ganti file banner dengan banner toko sendiri kapan saja tanpa
ubah kode. Semua angka statistik dari DB/uptime asli — tidak ada
angka karangan (tidak ada 720 user, 6 server, 283 hari, atau
347 pengguna bulanan).

### Menu utama (`/start`, tombol PPOB | SALDO | DEPOSIT, RIWAYAT | ROLE | PROFIL, MENU VPN)
Judul toko, tagline "PPOB • DIGITAL • 24 JAM", teks "Solusi
pembelian otomatis: Cepat, Aman, Tanpa menunggu admin", daftar
produk Kuota, Pulsa, Game, PLN, E-Money, Voucher, catatan deposit
QRIS (lihat halaman Deposit untuk status gateway yang sebenarnya)
dan "Harga menyesuaikan role member". `/start` mengirim menu utama
(lalu dashboard PROFIL sebagai pesan kedua, seperti alur bot contoh).

### Menu VPN (tombol MENU VPN)
Judul toko, "Pilih layanan VPN yang ingin kamu gunakan", daftar
TRIAL ACCESS (coba layanan sesuai ketersediaan), CREATE ACCOUNT
(SSH, VMess, VLESS, Trojan, SS), RENEW ACCOUNT (perpanjang masa
aktif), MY ACCOUNTS (lihat akun dan detail). Tombol: TRIAL AKUN,
CREATE AKUN, RENEW AKUN, AKUN SAYA, KEMBALI KE MENU UTAMA.

### Dashboard member (tombol PROFIL)
MEMBER DASHBOARD: SALDO (DB user asli), STATUS/ROLE (DB),
USERNAME Telegram asli, ID PENGGUNA Telegram asli.
SYSTEM & SERVER STATUS: WAKTU dan TANGGAL asli WIB
(`Asia/Jakarta`, dari server), SERVER (jumlah baris tabel `servers`
di DB — 1 bila domain sudah dikonfigurasi, 0 bila belum, bukan
angka karangan), USER (jumlah user di DB), BOT AKTIF (uptime asli
sejak proses bot start, format hari/jam/menit/detik).
VIP CUSTOMER SUPPORT: hanya bila `ADMIN_USERNAME` di `.env` terisi;
bila kosong, tampil "Hubungi admin" tanpa username karangan.
Tombol: VPN PREMIUM, RIWAYAT, STATISTIK, CEK KUOTA, PPOB STORE,
TOPUP SALDO VPN.

### Join-gate (opsional, NONAKTIF secara default)
Bila `JOIN_CHANNEL` / `JOIN_GROUP` di `.env` kosong, bot langsung
ke menu utama tanpa gate. Jangan isi dengan channel/group bot
contoh — isi hanya dengan channel/group milik sendiri bila mau
gate aktif. Bila aktif, tampil tombol Gabung Channel, Gabung
Group, dan "✅ Saya Sudah Bergabung, Lanjutkan", dengan pengecekan
keanggotaan via Telegram API bila bot bisa (bot harus admin di
channel/group); bila pengecekan gagal, dipakai verifikasi manual
(tombol Lanjutkan).

## Satu bot, dua etalase — dan hanya itu

| Menu | Isi |
|---|---|
| 🛒 Beli VPN | SSH, VMess, VLess, Trojan, Shadowsocks. Durasi 7/30 hari + trial 1 hari gratis 1x per user per 24 jam. |
| 📱 Beli PPOB | Kuota, Pulsa, Game, PLN, E-Money, Voucher — dari price-list Digiflazz live, hanya produk aktif. Hanya bila Digiflazz terkonfigurasi. |
| 💰 Saldo Saya | Saldo + 5 transaksi terakhir. |
| ➕ Deposit | Manual (admin konfirmasi) + QRIS otomatis bila gateway terkonfigurasi dan terverifikasi; halaman Deposit menjelaskan status gateway yang sebenarnya, tidak ada QRIS palsu. |
| 🧾 RIWAYAT | Riwayat transaksi VPN + PPOB user dari DB, terbaru dulu, dengan status sukses/pending/gagal. |
| 🎖️ ROLE | Role user dan tier harganya (member/reseller/admin dari `vpn_prices` + margin PPOB); admin ubah harga via panel Admin. |
| 📊 STATISTIK | User: total akun VPN aktif + total transaksi; admin: total user, total akun, total transaksi (dari DB asli). |
| 📡 CEK KUOTA | Via Sidompul bila `SIDOMPUL_API_KEY` terisi; bila kosong, tampil "belum aktif", tanpa hasil palsu. |
| 👤 Akun Saya / PROFIL | Daftar akun, perpanjang, hapus + dashboard member (lihat atas). |
| ❓ Bantuan | Host, port, path WS. |
| 🛠️ Admin | Tambah saldo, set harga VPN, deposit pending, transaksi, statistik, broadcast. Hanya `ADMIN_ID` di `.env`, tanpa hardcode. |

Tidak ada produk lain. Yang sengaja **dihapus/dibatasi** dari bot lama:
CloudFront, Zivpn, Sidompul (cek kuota), multi-server, Pakasir,
grup/channel wajib, dan semua jalur yang tidak relevan untuk jualan
di server ini. Bila suatu saat dibutuhkan, tambahkan sebagai modul
terpisah, jangan tempel kembali ke alur utama.

## Cara install (di VPS, sebagai root)

```bash
cd /root/bot-baru
npm install
cp .env.example .env
# isi .env (lihat bawah), lalu tes dulu:
node --check app.js && node --check src/*.js && node --check test/*.js
DB_PATH=/tmp/bot-baru-test.db node test/test-store.js
# tes API hanya bila sudah ada auth lokal (lihat tes API di bawah)
# setelah semua lolos, baru:
pm2 start app.js --name bot-baru
pm2 save
```

## Cara isi .env (tanpa nilai asli di dokumen ini)

Salin `.env.example` ke `.env`, isi field berikut. **Jangan pernah
menempel token/key asli di chat, dan jangan commit `.env` ke repo.**

- `BOT_TOKEN` — token bot **baru** dari @BotFather. Bukan token
  Hermes, bukan token bot lama. Kosong = bot keluar bersih dengan
  pesan token kosong, bukan crash loop.
- `ADMIN_ID` — ID Telegram admin (angka). Kosong = menu Admin nonaktif.
- `VPN_DOMAIN` — `vpn.outletku.ai.id` (atau domain server ini).
  Kosong = create VPN dinonaktifkan, bukan dibuat dengan domain kosong.
- `VPN_API_BASE` — default `http://127.0.0.1:5890` (vpn-api lokal).
- `VPN_API_AUTH` — diisi **admin server dari `/etc/vpn-api/auth.env`
  di VPS**, bukan dari chat dan bukan disalin dari `.env` bot lama.
  Kosong = create VPN dinonaktifkan (API akan menolak).
- `DIGIFLAZZ_USERNAME` / `DIGIFLAZZ_API_KEY` — opsional, untuk PPOB.
  Kosong = menu PPOB menampilkan "PPOB belum aktif, hubungi admin",
  tanpa harga Rp0 dan tanpa potong saldo.
- `P2P_GATEWAY_URL` / `P2P_API_KEY` — opsional, untuk deposit QRIS
  otomatis. Kosong = hanya deposit manual yang aktif. QRIS tidak
  pernah ditampilkan bila gateway belum terkonfigurasi / belum
  terverifikasi — tidak ada QRIS palsu, tidak ada saldo palsu.
- `SIDOMPUL_API_KEY` — opsional, untuk CEK KUOTA. Kosong = tampil
  "belum aktif", tanpa hasil palsu.
- `ADMIN_USERNAME` — opsional, untuk VIP CUSTOMER SUPPORT di
  dashboard. Kosong = tampil "Hubungi admin".
- `JOIN_CHANNEL` / `JOIN_GROUP` — opsional, untuk join-gate.
  Kosongkan keduanya = gate nonaktif. Isi hanya dengan
  channel/group milik sendiri (tanpa @).
- `BRAND_NAME` — default `RIPZZ STORE`. Ganti hanya dengan brand
  toko sendiri.
- `DB_PATH` — default `./data/bot.db`. Jangan pakai DB bot lama.

## PPOB Digiflazz (dokumentasi resmi)

Sumber: https://developer.digiflazz.com/api/buyer/persiapan/ dan
`/workspace/darren/digiflazz-buyer-notes.md` (ringkasan yang dipelajari
2026-11-01). Aturan yang diterapkan di bot ini, bukan sekadar salinan
kode lama:

- Base `https://api.digiflazz.com/v1`, POST JSON,
  `Content-Type: application/json`, sign `md5(username+apiKey+value)`
  (`pricelist` untuk price-list, `depo` untuk cek saldo, `ref_id`
  untuk transaksi).
- Endpoint: `/price-list` (cmd `prepaid`/`pasca`), `/cek-saldo`
  (cmd `deposit`), `/transaction` (prabayar + cek status prabayar).
  Pascabayar wajib cek tagihan dulu, cek status pakai command
  `status-pasca` — disiapkan di `src/digiflazz.js`, belum dibuka di
  menu awal karena etalase awal hanya prabayar.
- Hanya produk dengan `buyer_product_status = true` dan harga > 0
  yang dijual. Bila price-list gagal/kosong, menu PPOB nonaktif
  dengan pesan jelas — tidak pernah tampil Rp0.
- Kategori awal (dari price-list live, bukan hardcode daftar produk):
  pulsa, paket data, token PLN, e-money. Kata kunci kategori hanya
  pemetaan, produknya selalu dari price-list live.
- `ref_id` unik per transaksi, disimpan di tabel `ppob_orders`
  SEBELUM kirim ke Digiflazz, dan dipakai lagi persis sama untuk
  cek status/retry. Jangan pernah generate ref_id baru saat retry.
- Cek status: tunggu minimal 1 menit antar cek, jangan cek transaksi
  > 90 hari (Digiflazz menganggapnya transaksi baru).
- Saldo user: sukses = potong, pending = kunci (potong + bisa refund
  bila akhirnya gagal), gagal = kembalikan / tidak dipotong. Bot juga
  cek saldo supplier Digiflazz dulu; bila saldo supplier kurang dari
  harga, order ditolak tanpa potong saldo user.
- Deposit saldo supplier adalah urusan admin di
  member.digiflazz.com, bukan fitur bot user.

### Syarat live PPOB (harus dilakukan user/admin, bukan oleh bot)

1. Ambil username + API Key di member.digiflazz.com > Pengaturan
   Koneksi API, isi ke `.env` bot.
2. **Whitelist IP VPS `206.189.91.251` di Digiflazz** (development
   dan production) — tanpa ini API Digiflazz menolak.
3. **Whitelist IP Digiflazz `52.74.250.133` di sistem kita**
   (untuk callback/report dari Digiflazz).
4. Tes order kecil (pulsa nominal terkecil) sebelum dibuka umum,
   lalu tes cek status dengan ref_id yang sama.

## Alur jualan

1. User `/start` → user dibuat di SQLite (saldo 0).
2. Deposit: user kirim nominal (min Rp5.000) → status `pending`.
   Admin konfirmasi di menu Admin → saldo masuk. Deposit manual
   tidak menambah saldo sebelum admin approve.
3. Beli VPN: pilih protokol → pilih durasi → kirim username
   (3–20 karakter, huruf/angka). Harga = harga per hari di tabel
   `vpn_prices` × durasi. **Saldo dipotong hanya setelah API
   create sukses**; bila API gagal, saldo tidak dipotong dan pesan
   error API ditampilkan.
4. Akun tampil lengkap: username, password/UUID, expired, host,
   port 22 / 80 / 443, path WS (`/`, `/vmess`, `/vless`, `/trojan`,
   `/ss-ws`), dan link WS (VMess/VLess/Trojan/Shadowsocks).
   Shadowsocks server memakai method `aes-128-gcm` dan path
   `/ss-ws` (bot lama salah menulis `aes-256-gcm`).
5. Trial: 1 hari, gratis, 1x per user per 24 jam (tabel
   `trial_claims`). Bukan trial 1 jam seperti bot lama — disederhanakan
   ke 1 hari karena API `exp` memakai satuan hari.
6. PPOB: pilih kategori → kirim nomor → pilih produk dari pricelist
   Digiflazz (harga modal + `PPOB_MARGIN`) → saldo dipotong hanya
   bila order tidak ditolak Digiflazz.
7. Perpanjang: dari Akun Saya, harga per hari × durasi, API `/renew`.

## Harga default

Harga per hari, dari tabel `vpn_prices`, admin bisa ubah via panel
Admin (format `PROTO ROLE HARGA`, mis. `vless member 500`):

| Produk | member/hari | reseller/hari | admin |
|---|---|---|---|
| SSH, VMess, VLess, Trojan, Shadowsocks | Rp500 | Rp450 | Rp0 |

Jadi 7 hari = Rp3.500 (member), 30 hari = Rp15.000 (member).
Harga bukan hardcode di menu — menu selalu baca tabel.

## Tes yang sudah dijalankan

Lihat laporan penyerahan untuk hasil persis per tes. Ringkasnya,
di staging ini dites: `node --check` semua file JS baru, logika
saldo/harga/trial/PPOB-gate/deposit-manual di SQLite terpisah
(`/tmp/bot-baru-test.db`, bukan DB bot lama), logika tampilan baru
di SQLite dummy (`/tmp/bot-baru-ui-test.db`: saldo, role, riwayat,
statistik, server/user dari data dummy, format uptime/WIB, kategori
PPOB, dan guard tidak ada brand bot contoh di `app.js`), startup
tanpa token (keluar bersih), dan create+delete akun tes SSH/VLess
via vpn-api 5890 dengan verifikasi config Xray kembali identik.
Satu kegagalan awal ditemukan dan diperbaiki: format jam WIB
locale `id-ID` memakai titik (20.19.28) sehingga tes jam gagal —
`src/format.js` kini mengubahnya ke titik dua (20:19:28), tes UI
penuh kemudian LULUS.

## Yang masih butuh dari user untuk live

1. `BOT_TOKEN` bot baru dari BotFather (diisi di `.env` di VPS,
   bukan di chat).
2. `ADMIN_ID` (angka ID Telegram admin).
3. `VPN_DOMAIN` (domain server, saat ini `vpn.outletku.ai.id`).
4. `VPN_API_AUTH` diisi admin server dari `/etc/vpn-api/auth.env`.
5. Bila mau PPOB live: `DIGIFLAZZ_USERNAME` + `DIGIFLAZZ_API_KEY`,
   whitelist IP VPS `206.189.91.251` di Digiflazz, whitelist IP
   Digiflazz `52.74.250.133` di sistem kita, lalu tes order kecil
   (pulsa nominal terkecil) sebelum dibuka umum.
6. Bila mau deposit QRIS otomatis: gateway QRIS + verifikasi endpoint
   pembuatan QRIS gateway itu (sampai terverifikasi, pakai deposit
   manual dulu — itu jalur yang dijamin jalan).

**Jangan klaim bot sudah siap jualan live sebelum 1–4 terisi dan
bot di-start via PM2 lalu dites `/start` → deposit manual →
beli VPN dari Telegram sungguhan.**

## Untuk banyak installer (tiap instalasi punya webhook sendiri)

Bot ini dirancang agar bisa diinstal banyak orang, masing-masing dengan
domain, kunci, dan webhook-nya sendiri — tanpa hardcode domain/kunci
instalasi pertama:

1. Isi `.env` instalasi itu (atau lewat menu VPS `m-bot` opsi 1, mode
   senyap): BOT_TOKEN, ADMIN_ID, VPN_DOMAIN (= domain instalasi itu),
   VPN_API_AUTH dari server itu.
2. Jalankan bot via PM2 (`pm2 start app.js --name bot-baru`), lalu
   jalankan skrip route webhook SEKALI di VPS itu:
   `bash install-webhook-nginx.sh` (default port 8899). Skrip ini
   menyisipkan `location ~ ^/webhook-*` sebelum location WS, dengan
   backup + `nginx -t` + reload; bila gagal, backup dikembalikan.
3. Di Telegram, buka Admin > Pengaturan & API Key, isi kunci gateway
   (gk_), username + API Key Digiflazz, margin PPOB. Pesan berisi kunci
   dihapus bot setelah dibaca, dan nilai kunci tidak pernah ditampilkan
   kembali — hanya status terisi/kosong.
4. Di Admin > Pengaturan, tekan Generate Webhook: bot membuat secret
   acak (bila belum ada), menampilkan URL webhook instalasi itu
   (`https://<domain-instalasi>/webhook-gateway` dan
   `/webhook-digiflazz`), mencoba daftar otomatis ke gateway, dan
   memberi langkah tempel manual untuk Digiflazz (Digiflazz tidak punya
   API auto-register webhook, jadi tempel di member.digiflazz.com wajib).
5. Management di Admin: Tambah Saldo, Set Harga VPN, Margin PPOB,
   Deposit Pending (approve/tolak), Transaksi (per user & global),
   Kelola User (role member/reseller/admin, tambah/kurang saldo),
   Statistik, Broadcast. Harga VPN per protokol per role, harga PPOB =
   harga Digiflazz + margin.

Catatan keamanan multi-install: jangan pernah membagikan `.env`,
kunci gk_, API Key Digiflazz, atau WEBHOOK_SECRET instalasi lain.
Tiap instalasi harus memakai token bot, domain, dan kunci-nya sendiri.

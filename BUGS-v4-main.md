# Audit Bug — v4-main (Darren) — audit statis, 2026-11-01

Ruang lingkup: hasil ekstrak `~/workspace/darren/extracted/v4-main`.
Metode: baca statis saja. Tidak ada script/binary yang dijalankan,
tidak ada uji live. Jadi semua temuan di bawah adalah temuan kode,
bukan reproduksi runtime.

## Kritis

1. **Api/vpn-api.py — injeksi perintah shell lewat password SSH**
   Lokasi: fungsi pembuatan akun SSH. Nilai password dari query
   disisipkan langsung ke perintah shell tanpa sanitasi/escaping.
   Dampak: pemanggil API bisa mengeksekusi perintah sebagai root.
   Perbaikan: jangan pakai shell sama sekali untuk useradd/chpasswd;
   pakai argumen list, atau sanitasi ketat dan tulis password lewat
   stdin proses tanpa shell.

2. **Api/vpn-api.py — injeksi perintah shell lewat renew SSH**
   Lokasi: fungsi renew untuk protokol SSH. Nama user dari query
   tidak divalidasi seperti di jalur create/delete, lalu disisipkan
   ke perintah shell. Dampak sama: eksekusi perintah sebagai root.
   Perbaikan: pakai validator username yang sama di semua jalur
   (huruf/angka, panjang terbatas) dan hilangkan shell.

3. **Api/vpn-api.py — auth fail-open**
   Lokasi: handler GET. Pemeriksaan auth hanya aktif bila variabel
   auth terisi; bila kosong, semua endpoint create/renew/delete
   bisa dipanggil tanpa auth. API memang hanya bind localhost,
   tapi ini tetap fail-open: proses lokal lain, atau jalur bot
   yang salah konfigurasi, langsung dapat akses penuh.
   Perbaikan: tolak semua request bila auth tidak dikonfigurasi,
   kecuali endpoint health yang memang aman.

4. **bot-js/src/config.js — admin default hardcoded**
   Lokasi: konfigurasi bot. Bila variabel admin tidak di-set,
   satu ID Telegram tertentu menjadi admin secara otomatis.
   Dampak: instalasi yang lupa set .env langsung punya admin
   yang bukan pemiliknya. Perbaikan: tanpa ID admin yang
   dikonfigurasi secara eksplisit, bot harus menolak start
   atau menonaktifkan semua perintah admin.

## Tinggi

5. **Api/vpn-api.py — duplikasi akun Xray tidak dicek**
   Lokasi: pembuatan VMess/VLess/Trojan/Shadowsocks. Berbeda
   dengan SSH, jalur ini tidak menolak username yang sudah ada.
   Akibatnya config bisa berisi klien ganda dengan email sama,
   database per-protokol ikut ganda, dan hapus/renew jadi ambigu.
   Perbaikan: cek keberadaan user di config dan di database
   sebelum insert, dan tolak duplikat.

6. **Api/vpn-api.py — renew memberi sukses palsu + tidak sinkron**
   Lokasi: fungsi renew. Untuk Xray, bila username tidak ditemukan
   atau format tanggal tidak cocok, fungsi tetap mengembalikan
   sukses. Selain itu renew hanya mengubah tanggal di komentar
   config, tidak mengubah database per-protokol.
   Perbaikan: kembalikan error bila user tidak ditemukan, dan
   perbarui config + database secara atomik.

7. **Api/vpn-api.py — nilai Xray tidak di-escape**
   Lokasi: pembuatan klien Xray. UUID/password disisipkan mentah
   ke baris JSON config. Karakter khusus bisa merusak struktur
   JSON config. Validasi config memang ada sebagai jaring pengaman,
   tapi input yang merusak tetap ditolak terlambat dan pesannya
   menyesatkan. Perbaikan: bangun config sebagai objek JSON
   (bukan string), validasi UUID/password sebelum insert.

8. **Api/vpn-api.py — masa berlaku diam-diam jadi 30 hari**
   Lokasi: helper tanggal. Bila parameter hari bukan angka,
   fungsi diam-diam memakai 30 hari. Pemanggil mengira masa
   berlaku custom-nya dipakai, padahal tidak.
   Perbaikan: tolak parameter hari yang tidak valid, jangan
   fallback diam-diam.

9. **bot-js/modules/cleanup.js — akun yatim di server**
   Lokasi: cleanup akun kadaluarsa dan trial lama. Baris database
   dihapus walau pemanggilan hapus ke server gagal (error
   ditelan). Akibatnya akun tetap hidup di server tapi hilang
   dari database bot: tidak bisa dikelola, tidak kedaluwarsa
   lewat bot, dan bisa dipakai gratis selamanya.
   Perbaikan: hapus baris database hanya setelah server
   mengonfirmasi akun benar-benar hilang; bila gagal, catat
   dan coba lagi di siklus berikutnya.

10. **bot-js — poller deposit tidak memverifikasi nominal**
    Lokasi: poller deposit di app.js, dan jalur cek Pakasir.
    Status lunas dari gateway diterima, lalu saldo dikreditkan
    sebesar nominal yang tercatat di database — tanpa
    membandingkan nominal yang benar-benar dibayar di gateway.
    Dampak: selisih nominal (kode unik, biaya, pembayaran
    parsial) tidak terdeteksi. Perbaikan: bandingkan nominal
    gateway dengan nominal transaksi, dan tolak/flag bila
    tidak cocok.

11. **bot-js — deposit reuse lintas gateway + nominal lama**
    Lokasi: pembuatan deposit QRIS. Bila ada deposit pending
    dalam 30 menit, deposit baru memakai ulang deposit lama
    tanpa memfilter gateway dan tanpa memperhatikan nominal
    baru yang diketik user. User bisa menerima QR nominal lama
    atau payment ID dari gateway lain. Perbaikan: filter reuse
    per gateway, dan tolak/batalkan deposit lama bila nominal
    atau gateway berbeda.

12. **bot-js — jendela poller terlalu pendek, sewa tanpa poller**
    Lokasi: poller deposit (hanya transaksi < 1 hari) dan
    poller PPOB (< 2 jam); order sewa hanya dicek manual lewat
    tombol. Deposit yang lunas setelah 1 hari tidak pernah
    dikreditkan otomatis, dan order sewa yang lunas tapi
    tombolnya tidak ditekan tidak pernah teraktivasi.
    Perbaikan: perpanjang jendela dengan status kedaluwarsa
    eksplisit + jalur klaim manual, dan tambahkan poller sewa
    atau webhook.

13. **bot-js — sewa bisa diaktivasi tanpa cek pemilik**
    Lokasi: handler cek pembayaran sewa. Handler mencari order
    dari referensi saja, tanpa memastikan penekan tombol adalah
    pemilik order. Referensi yang bocor/tertebak bisa dipakai
    orang lain untuk memicu aktivasi lisensi order tersebut.
    Perbaikan: cocokkan ID Telegram penekan dengan pemilik
    order (kecuali admin), seperti yang sudah dilakukan di
    jalur hapus/renew akun.

14. **BotVPN2/app.js — handler reset database tanpa gate eksplisit**
    Lokasi: handler reset dan konfirmasi reset. Di potongan
    handler tersebut tidak ada pemeriksaan admin eksplisit;
    perlindungan hanya mengandalkan tombol yang tidak
    ditampilkan ke user biasa. Itu security by obscurity.
    Perbaikan: tambahkan gate admin di awal setiap handler
    destruktif, dan minta konfirmasi dua langkah dengan
    token sekali pakai.

15. **BotVPN2/app.js — tipe ID admin tidak konsisten**
    Lokasi: beberapa handler membandingkan ID admin dengan
    tipe berbeda (string vs angka, pencocokan substring).
    Akibatnya ada handler yang bisa gagal mengenali admin
    yang sah, atau sebaliknya mencocokkan ID yang hanya
    mirip sebagian. Perbaikan: normalisasi semua ID admin
    menjadi string dan bandingkan dengan kesetaraan persis
    di satu helper terpusat.

## Sedang

16. **bot-js — kredensial lewat URL dan HTTP tanpa TLS**
    Lokasi: pemanggilan API server VPN dari kedua bot. Auth,
    password, dan UUID dikirim sebagai query URL lewat HTTP
    biasa. Query URL tercatat di log/proxy dan mudah disadap
    di jaringan. Perbaikan: pakai HTTPS + header auth, jangan
    pernah taruh kredensial di URL.

17. **bot-js — sesi di memori tanpa kedaluwarsa**
    Lokasi: session Map di app.js. Sesi percakapan (nominal
    deposit, data server, data sewa) tidak kedaluwarsa.
    Sesi basi bisa tertukar dengan alur baru user yang sama.
    Perbaikan: beri TTL per sesi dan hapus sesi setelah
    selesai/gagal.

18. **bot-js — batas waktu memakai UTC vs WIB**
    Lokasi: cleanup, trial, dan poller memakai tanggal UTC
    dari database, sementara user di WIB. Batas kadaluarsa
    bisa bergeser sampai 7 jam dari yang user lihat.
    Perbaikan: simpan dan bandingkan waktu dalam satu zona
    yang eksplisit, dan tampilkan zona itu ke user.

19. **Cfg/config.json — config bawaan bukan JSON valid**
    Lokasi: file config Xray di Cfg/. File ini gagal diparse
    sebagai JSON karena berisi marker/komentar template.
    Bila dipakai apa adanya, Xray gagal start. Perbaikan:
    pisahkan template dan config hasil generate; jangan
    kirim file template sebagai config aktif.

20. **BotVPN2/app.js — port HTTP terbuka tanpa route**
    Lokasi: server HTTP bot di port 9999. Port dibuka tapi
    tidak ada route yang didefinisikan, jadi hanya menambah
    permukaan serang tanpa fungsi. Perbaikan: hapus listener
    bila tidak dipakai, atau pasang route + auth yang jelas.

21. **Update script — timpa kode dari remote tanpa verifikasi**
    Lokasi: script update di root dan di BotVPN2. Kode diunduh
    dan langsung menimpa file lokal tanpa checksum/signature.
    Bila sumber atau jaringan dikompromi, server ikut
    terkompromi. Perbaikan: pin ke commit/tag + verifikasi
    checksum/signature sebelum menimpa.

## Yang dicek dan TIDAK terbukti bug

- SQL injection di bot-js: query utama sudah memakai parameter
  binding, bukan interpolasi string. Satu interpolasi kolom
  di harga VPN aman karena nilainya berasal dari konstanta
  internal, bukan input user.
- Jalur hapus/renew akun di bot-js: sudah memfilter berdasarkan
  ID Telegram pemilik, jadi bukan celah IDOR di jalur itu.
- Poller deposit bot-js: klaim kredit sudah atomik (hanya
  transaksi yang masih pending yang diubah, dan dobel kredit
  dicegah lewat pengecekan perubahan baris). Masalahnya ada
  di verifikasi nominal dan jendela waktu, bukan dobel kredit.
- Fungsi loose status di payment.js: tidak dipakai di jalur
  poller (poller memakai daftar status ketat), jadi saat ini
  dead code, bukan celah live. Tetap sebaiknya dihapus.

## Belum bisa diverifikasi (butuh uji runtime)

- Apakah API port 5889 (yang dipanggil BotVPN2) punya bug yang
  sama dengan API 5890 — API 5889 tidak ada di zip ini.
- Perilaku binary di Fls/ (DNSTT, WS, UDP-mini) — tidak
  dijalankan dalam audit ini.
- Isi zip bersarang (bot.zip, kyt.zip, menu.zip, vpn.zip)
  — baru dilisting, belum diaudit baris per baris.

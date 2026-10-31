# Perubahan versi perbaikan (fixed) — v4-main

Audit: `../BUGS-v4-main.md` (di repo, di luar folder ini).
Metode: audit statis + cek syntax saja, tanpa menjalankan server.

## Kritis — diperbaiki
- Api/vpn-api.py: semua perintah shell diganti perintah list tanpa shell.
  Password SSH dikirim lewat stdin proses, bukan disisipkan ke shell.
  Renew SSH kini memakai validator username yang sama dengan create/delete.
- Api/vpn-api.py: auth fail-closed. Bila auth tidak dikonfigurasi, semua
  endpoint selain health ditolak (sebelumnya tanpa auth sama sekali).
- bot-js/src/config.js: tidak ada lagi admin default hardcoded. Tanpa
  ADMIN_ID di .env, tidak ada admin otomatis.
- bot-js/modules/ipregistry.js + .env.example: tidak ada lagi default
  pemilik/repo lisensi pihak lain; registrasi gagal jelas bila belum
  dikonfigurasi, bukan menulis ke repo orang lain.

## Tinggi — diperbaiki
- Api: duplikasi akun Xray ditolak; nilai UUID/password di-escape JSON;
  renew Xray gagal jelas bila user tidak ditemukan dan menyinkronkan
  tanggal kedaluwarsa ke database per-protokol; masa berlaku yang
  tidak valid ditolak, bukan diam-diam jadi 30 hari; gRPC hanya
  diabaikan bila markernya memang tidak ada.
- bot-js cleanup: baris database hanya dihapus setelah server
  mengonfirmasi akun hilang; bila gagal, baris dipertahankan dan
  dicoba lagi (tidak ada lagi akun yatim).
- bot-js deposit: poller memverifikasi nominal gateway bila gateway
  melaporkannya (selisih >1000 tidak dikreditkan); jendela poller
  deposit diperpanjang 1 hari -> 7 hari, PPOB 2 jam -> 24 jam.
- bot-js deposit: reuse deposit pending kini difilter per gateway
  dan ditolak jelas bila nominalnya berbeda dengan deposit lama.
- bot-js sewa: poller otomatis tiap 60 detik (sebelumnya hanya
  tombol manual); cek sewa kini memeriksa pemilik order (atau admin).
- BotVPN2: ID admin dinormalisasi ke string dan dibandingkan persis
  di satu helper; handler reset database kini punya gate admin
  eksplisit; server HTTP tanpa route dihapus (bot langsung launch,
  tidak ada lagi port terbuka tanpa fungsi); fungsi update field
  server diperbaiki (parameter nama field yang hilang).
- Update script: penimpaan kode dari remote kini opt-in
  (ALLOW_REMOTE_UPDATE=1), bukan otomatis.
- Vpn/vpn.zip: materi kunci privat lama dihapus dari zip ini.
  PERINGATAN: kunci itu sudah pernah publik, jadi penghapusan ini
  tidak membatalkan kebocoran — generate PKI baru dan anggap kunci
  lama bocor.

## Sedang — diperbaiki / didokumentasikan
- Cfg: ditambahkan README yang menjelaskan config.json di folder
  itu adalah template bermarker, bukan file JSON ketat untuk
  langsung disalin ke /etc/xray/config.json.
- Installer baru (di root repo): menginstal bot-js + API, membuat
  auth acak, meminta token lewat prompt aman, dan tidak menyimpan
  secret apapun di dalam script.

## Belum diperbaiki (butuh keputusan / uji runtime)
- Kredensial API masih dikirim lewat query URL di jalur bot lama
  (desain API GET BotVPN2-style). Mitigasi: API ini bind localhost
  saja; jangan expose port API ke publik, dan untuk server remote
  pakai reverse proxy HTTPS. Migrasi penuh ke header auth + POST
  butuh perubahan API dan semua bot secara bersamaan.
- Sesi percakapan bot-js di memori belum punya TTL eksplisit.
  Dampaknya rendah (sesi basi bisa tertukar alur), tapi belum
  diperbaiki agar tidak mengubah alur percakapan yang ada.
- Isi zip bersarang (bot.zip, kyt.zip, menu.zip) belum diaudit
  baris per baris dan belum diperbaiki; binary di Fls/ tidak
  dijalankan dalam audit ini.
- API port 5889 yang dipanggil BotVPN2 tidak ada di paket ini,
  jadi tidak bisa diperbaiki dari sini.
- Riwayat git repo masih berisi zip lama yang mengandung kunci
  privat. Menghapus file di commit baru tidak menghapus riwayat.
  Bila ingin riwayat dibersihkan, itu langkah force-push terpisah
  yang butuh persetujuan eksplisit pemilik repo.

## Tambahan 2026-11-01 (blokir push protection)
- Cfg/rclone.conf: token Google lama dari script asli DIHAPUS dan
  diganti template kosong. GitHub menolak push pertama karena file
  ini mengandung token akses + refresh Google. Token lama itu sudah
  pernah ada di zip asli yang publik, jadi harus dianggap bocor dan
  dicabut oleh pemilik akunnya, bukan dipakai ulang.

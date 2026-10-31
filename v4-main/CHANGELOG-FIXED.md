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

## Tambahan 2026-11-01 — Audit SSH+Xray, perbaikan + tes live di mila
- Cfg/config.json: kunci JSON ganda (stats/api/policy) digabung jadi
  satu; outbound diberi tag (direct, proxy, blocked, block) sehingga
  rule routing tidak lagi merujuk tag yang tidak ada; sniffing
  http/tls diaktifkan di inbound WS/gRPC.
- Cfg/xray.conf (Nginx): timeout 86400000m -> 360s; proxy_protocol
  dihapus dari listen 1012/1013 (tidak ada pengirim PROXY protocol);
  proxy_read/send_timeout WS 3600s, grpc_read_timeout 3600s;
  TLSv1.1 dihapus.
- Cfg/haproxy.cfg: inspect-delay 500ms -> 200ms.
- Fls/sshd: ClientAliveInterval 30, ClientAliveCountMax 3, UseDNS no,
  MaxStartups 50:30:100, LoginGraceTime 60 (eksplisit, bukan default).
- Cfg/dropbear.conf: receive window 65536 -> 262144.
- Cfg/nginx.conf: worker_connections 2048 -> 4096.
- Api/vpn-api.py: ThreadingHTTPServer (bukan single-thread);
  restart Xray di-debounce 2 detik (satu restart per burst perubahan,
  bukan per akun); CFG/XRAY_BIN/RESTART_SCRIPT bisa di-override
  lewat env untuk staging (default produksi tidak berubah).
- bot-js/modules/vpn.js: timeout API 25 detik -> 60 detik.
- Fls/limit IP/kuota: restart Xray sekali per sweep (flag
  NEED_RESTART), bukan per user pelanggar; grep IP limit pakai -w.
- menu/auto-kill (menu.zip + bot.zip): cron tendang opsi 1
  diperbaiki $max -> $iplimit.
- Cfg/slowdns.sh + Vpn/xray.zip: kredensial hardcode diganti
  placeholder/env (nilai tidak pernah ditampilkan).
- Catatan tes: staging di mila user-space (tanpa sudo, tanpa
  ganggu layanan live mila). Lihat TEST-SSH-XRAY.md untuk hasil
  tes live yang sebenarnya, bukan klaim teori.
- Cfg/haproxy.cfg: frontend http/https default_backend diubah dari
  dropbear_backend ke ws_backend (Nginx). Terbukti live di mila:
  acl hdr(Upgrade) di mode tcp selalu gagal, WS jatuh ke Dropbear
  lalu putus (SD, banner SSH 77 byte). Dengan default ws, WS via
  HAProxy 200 (0,96 detik example, 2,49 detik Google) dan log
  HAProxy menunjukkan ws_backend, Nginx 101. SSH polos tetap
  lewat 22/143 langsung, SSH-WS lewat Nginx path /.

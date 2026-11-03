# Darren — v4-main (versi perbaikan)

Paket script jualan VPN (Xray/SSH/OpenVPN + bot Telegram) yang sudah
diperbaiki dari audit bug statis 2026-11-01. Lihat `BUGS-v4-main.md`
untuk daftar bug asli, dan `v4-main/CHANGELOG-FIXED.md` untuk daftar
perbaikan yang sudah diterapkan.

## Instalasi di VPS baru (sebagai root)

Repo ini PRIVATE. Tanpa izin owner, orang lain tidak bisa mengunduh
atau memakai script ini. Setiap install butuh token baca dari HP
owner: GitHub -> token read-only khusus repo Darren, masa berlaku
pendek (buat token baru per install). Token yang sama dipakai di
perintah unduh dan saat installer meminta (atau lewat env
`GH_TOKEN`).

```bash
curl -fsSL -H "Authorization: Bearer ISI_TOKEN_DARI_HP" https://raw.githubusercontent.com/bungkangeddeng-cyber/Darren/main/install.sh -o install.sh
chmod +x install.sh
./install.sh
```

Installer akan meminta token GitHub baca repo, BOT_TOKEN, ADMIN_ID,
dan konfigurasi opsional lewat prompt (tidak di-echo, tidak
disimpan di dalam script), membuat auth API acak, menginstal
bot-js + VPN API, dan menawarkan instalasi Xray secara opsional.
Di akhir installer juga meminta token baca izin menu (disimpan
terkunci di `/etc/xray/izin-token`, mode 600) — wajib setelah repo
private, supaya menu tetap bisa membaca daftar izin. BotVPN2 lama
tidak diinstal secara default.

Bila kamu sudah meng-clone repo ini ke VPS, cukup jalankan
`./install.sh` dari root repo — installer akan memakai source lokal.

Untuk install total (menghapus semua instalasi SC lama dulu, dengan
backup): jalankan `./install.sh --total`. Tanpa flag itu, bila
instalasi lama ditemukan, installer akan bertanya dulu sebelum
menghapus total.

## Uninstall total (sebagai root)

Repo ini private, jadi unduh uninstaller juga butuh token baca
dari HP owner (sama seperti install):

```bash
curl -fsSL -H "Authorization: Bearer ISI_TOKEN_DARI_HP" https://raw.githubusercontent.com/bungkangeddeng-cyber/Darren/main/uninstall.sh -o uninstall.sh
chmod +x uninstall.sh
./uninstall.sh
```

Saat diminta konfirmasi, ketik `YA`. Script akan membackup dulu ke
`/root/darren-uninstall-backup-<waktu>/`, lalu menghapus bot (pm2),
service vpn-api dan xray, file aplikasi, menu utama termasuk
permission (`cek-izin` + log + cache), dan source installer.
Akun-akun ikut terhapus.

Yang sengaja TIDAK dihapus: node, npm, dan pm2. Entri server di
daftar izin permission tetap ada di repo (tidak mengganggu); hapus
barisnya dari `v4-main/Cdy/izin-servers.txt` bila server itu tidak
dipakai lagi.

Bila isi `uninstall.sh` yang terunduh belum menyebut `cek-izin`,
berarti cache GitHub belum segar — tunggu beberapa menit lalu
unduh ulang.

## Permission menu (izin)

Izin menu dikendalikan penuh dari repo ini, bukan server luar.
Menu SSH memanggil helper [v4-main/Cdy/cek-izin](v4-main/Cdy/cek-izin)
di awal tiap script; helper yang sama juga ikut di dalam
`v4-main/Cdy/menu.zip` (terpasang ke `/usr/bin/cek-izin`).

Daftar server yang diizinkan ada di
[v4-main/Cdy/izin-servers.txt](v4-main/Cdy/izin-servers.txt),
format tiap baris: `IP|TANGGAL_EXPIRED(YYYY-MM-DD)|NAMA|STATUS`
(`STATUS`: `active` / `suspended`). Tambah server baru cukup tambah
satu baris di file itu lalu push; menu membaca file itu dari GitHub
(cache 6 jam di VPS). Alasan penolakan dicatat jelas, dan log
auditnya ada di `/var/log/izin.log` di VPS. Jangan taruh secret
di file ini.

Karena repo private, `cek-izin` membaca allowlist memakai token
baca yang tersimpan di `/etc/xray/izin-token` (mode 600, hanya
root). Tanpa token, cek-izin mencoba tanpa autentikasi (jalan
selama repo masih publik, gagal setelah repo private — pesannya
menyebut token). VPS yang sudah terpasang sebelum repo private
tidak perlu install ulang; cukup pasang tokennya (input
tersembunyi, tidak tampil saat diketik):

```bash
read -rs -p "Token baca izin: " TOK; printf '%s' "$TOK" > /etc/xray/izin-token; chmod 600 /etc/xray/izin-token; unset TOK
```

Token baca izin bisa dicabut per server dari HP owner (cabut =
menu server itu berhenti setelah cache habis).

## Keamanan — baca dulu

- Repo ini PRIVATE. Tanpa token baca dari owner, tidak ada yang
  bisa mengunduh atau memakai script ini. Jangan pernah menaruh
  token, password, atau kunci privat di dalam repo, chat, atau log.
- Token bersifat revocable: token install pakai masa berlaku
  pendek (buat baru per install); token baca izin dicabut per
  server dari HP owner bila server itu tidak dipakai lagi.
- Kunci privat OpenVPN lama yang ada di zip asli SUDAH DIHAPUS
  dari versi ini, tapi karena zip lama pernah publik, kunci itu
  harus dianggap bocor. Generate PKI baru, jangan pakai kunci lama.
- API VPN hanya bind localhost (port 5890). Jangan dibuka ke publik.
- File zip lama (`v4-main (1).zip`) sengaja tidak lagi ada di
  branch ini, digantikan folder `v4-main/` yang sudah diperbaiki.
  Riwayat git lama masih berisi zip lama; membersihkan riwayat
  adalah langkah force-push terpisah yang butuh persetujuan pemilik.

## Struktur

- `install.sh` — installer VPS baru (dukung token repo private + token baca izin menu)
- `uninstall.sh` — uninstall total (backup dulu, lalu hapus bot, API, Xray, menu, permission)
- `v4-main/Cdy/cek-izin` — helper permission menu (juga di dalam menu.zip)
- `v4-main/Cdy/izin-servers.txt` — daftar server yang diizinkan (IP|expired|nama|status)
- `v4-main/` — source yang sudah diperbaiki (bot-js, BotVPN2, Api, Cfg, Fls, Vpn, dll)
- `v4-main/CHANGELOG-FIXED.md` — apa yang diperbaiki dan apa yang belum
- `BUGS-v4-main.md` — laporan audit bug asli

# Darren — v4-main (versi perbaikan)

Paket script jualan VPN (Xray/SSH/OpenVPN + bot Telegram) yang sudah
diperbaiki dari audit bug statis 2026-11-01. Lihat `BUGS-v4-main.md`
untuk daftar bug asli, dan `v4-main/CHANGELOG-FIXED.md` untuk daftar
perbaikan yang sudah diterapkan.

## Instalasi di VPS baru (sebagai root)

```bash
curl -fsSL https://raw.githubusercontent.com/bungkangeddeng-cyber/Darren/main/install.sh -o install.sh
chmod +x install.sh
./install.sh
```

Installer akan meminta BOT_TOKEN, ADMIN_ID, dan konfigurasi opsional
lewat prompt (tidak di-echo, tidak disimpan di dalam script), membuat
auth API acak, menginstal bot-js + VPN API, dan menawarkan instalasi
Xray secara opsional. BotVPN2 lama tidak diinstal secara default.

Bila kamu sudah meng-clone repo ini ke VPS, cukup jalankan
`./install.sh` dari root repo — installer akan memakai source lokal.

Untuk install total (menghapus semua instalasi SC lama dulu, dengan
backup): jalankan `./install.sh --total`. Tanpa flag itu, bila
instalasi lama ditemukan, installer akan bertanya dulu sebelum
menghapus total.

## Uninstall total (sebagai root)

```bash
curl -fsSL https://raw.githubusercontent.com/bungkangeddeng-cyber/Darren/main/uninstall.sh -o uninstall.sh
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

## Keamanan — baca dulu

- Repo ini publik. Jangan pernah menaruh token, password, atau
  kunci privat di dalam repo.
- Kunci privat OpenVPN lama yang ada di zip asli SUDAH DIHAPUS
  dari versi ini, tapi karena zip lama pernah publik, kunci itu
  harus dianggap bocor. Generate PKI baru, jangan pakai kunci lama.
- API VPN hanya bind localhost (port 5890). Jangan dibuka ke publik.
- File zip lama (`v4-main (1).zip`) sengaja tidak lagi ada di
  branch ini, digantikan folder `v4-main/` yang sudah diperbaiki.
  Riwayat git lama masih berisi zip lama; membersihkan riwayat
  adalah langkah force-push terpisah yang butuh persetujuan pemilik.

## Struktur

- `install.sh` — installer VPS baru
- `uninstall.sh` — uninstall total (backup dulu, lalu hapus bot, API, Xray, menu, permission)
- `v4-main/` — source yang sudah diperbaiki (bot-js, BotVPN2, Api, Cfg, Fls, Vpn, dll)
- `v4-main/CHANGELOG-FIXED.md` — apa yang diperbaiki dan apa yang belum
- `BUGS-v4-main.md` — laporan audit bug asli

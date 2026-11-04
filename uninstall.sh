#!/usr/bin/env bash
# Uninstaller script Darren (pasangan install.sh).
# Menghapus SELURUH stack Darren: bot-js (pm2), vpn-api, Xray, menu utama,
# permission (cek-izin), DAN Node.js/npm, PM2 (+ startup + ~/.pm2), vnstat.
# Ini uninstall TOTAL untuk stack Darren — setelah ini, install ulang
# (install.sh) akan memasang Node/PM2/vnstat lagi dari nol.
# Yang TIDAK dihapus (bukan wipe total VPS): OS dasar, perkakas generik
# (curl, git, wget, unzip, python3, sqlite3, openssl, ca-certificates, gnupg),
# konfigurasi/kunci SSH, direktori backup (darren-*-backup-* dan *.bak-*),
# dan data aplikasi lain di luar stack Darren.
# Backup dulu ke /root/darren-uninstall-backup-<waktu>/ sebelum menghapus.
# Restore = kembalikan file dari backup + install ulang Node/PM2/vnstat
# (backup TIDAK mengembalikan Node/PM2/vnstat yang terhapus).
#
# Cara pakai di VPS (sebagai root):
#   curl -fsSL https://raw.githubusercontent.com/bungkangeddeng-cyber/Darren/main/uninstall.sh -o uninstall.sh
#   chmod +x uninstall.sh
#   ./uninstall.sh
#
# Script ini TIDAK berisi secret apapun.
# Daftar hapus di hapus_stack_darren() adalah SATU-SATUNYA sumber kebenaran
# untuk penghapusan stack Darren: install.sh mode --total memakai fungsi yang
# sama (source dari uninstall.sh ini), jadi mengubah daftar di sini otomatis
# mengubah --total — jangan membuat daftar hapus kedua di tempat lain.

# hapus_stack_darren [keep-src]
# Menghapus komponen stack Darren. Argumen opsional:
#   keep-src  = JANGAN hapus /root/darren-install (dipakai install.sh --total,
#               karena source baru sudah ada di sana dan masih dibutuhkan
#               langkah install berikutnya).
# Tanpa argumen, /root/darren-install ikut dihapus (uninstall mandiri).
# Fungsi ini HANYA menghapus; konfirmasi + backup dilakukan pemanggil
# (main() di bawah, atau siapkan_install_total() di install.sh).
# Perintah yang bisa gagal memakai || true supaya satu komponen yang sudah
# tidak ada tidak menghentikan penghapusan komponen lain.
# Fungsi ini TIDAK memanggil exit (penting saat di-source install.sh).
hapus_stack_darren() {
  local keep_src="${1:-}"
  local menu_zip="/root/darren-install/v4-main/Cdy/menu.zip"

  # 1. Bot PM2: hapus proses + matikan daemon + cabut startup.
  #    (pm2 save lama dihapus dari alur: tidak ada gunanya menyimpan dump
  #    kosong tepat sebelum PM2 dan ~/.pm2 dihapus total di bawah.)
  pm2 delete ripzz-bot-js 2>/dev/null || true
  pm2 kill 2>/dev/null || true
  pm2 unstartup systemd -u root --hp /root 2>/dev/null || true
  systemctl disable pm2-root 2>/dev/null || true
  rm -f /etc/systemd/system/pm2-root.service

  # 2. Service Darren: vpn-api + xray.
  systemctl disable --now vpn-api 2>/dev/null || true
  systemctl disable --now xray 2>/dev/null || true
  rm -f /etc/systemd/system/vpn-api.service /etc/systemd/system/xray.service
  # FASE 1: hapus juga direktori drop-in Xray (backup dilakukan pemanggil:
  # main() di bawah, atau siapkan_install_total() di install.sh) supaya
  # unit lama yang menimpa ExecStart tidak selamat dari uninstall/--total.
  rm -rf /etc/systemd/system/xray.service.d
  systemctl daemon-reload 2>/dev/null || true

  # 3. Menu (daftar file persis dari menu.zip bila ada; dibaca SEBELUM
  #    source dihapus pada langkah 6).
  if [ -f "$menu_zip" ]; then
    unzip -Z1 "$menu_zip" 2>/dev/null | while IFS= read -r f; do
      case "$f" in
        */) continue ;;
        *) rm -f "/usr/bin/$(basename "$f")" ;;
      esac
    done || true
  else
    echo "menu.zip tidak ditemukan, hanya /usr/bin/menu + /usr/bin/ipsave yang dihapus."
  fi
  rm -f /usr/bin/menu /usr/bin/ipsave

  # 3b. Permission baru (cek-izin): dihapus eksplisit supaya uninstall tetap
  # total walau menu.zip lokal di VPS masih versi lama (tanpa cek-izin).
  # Cache izin ikut terhapus bersama /etc/xray di langkah 4.
  rm -f /usr/bin/cek-izin /var/log/izin.log
  rm -rf /tmp/menu-baru

  # 4. File aplikasi + sisa unduhan Xray.
  rm -rf /root/bot-js /root/vpn-api.py /etc/vpn-api /usr/local/bin/xray /etc/xray
  rm -f /tmp/xray.zip
  rm -rf /tmp/xray-bin

  # 5. PM2 global + data PM2/npm (SETELAH daemon mati; npm masih ada di
  #    titik ini karena Node baru dihapus di langkah 7).
  if command -v npm >/dev/null 2>&1; then
    npm uninstall -g pm2 2>/dev/null || true
  fi
  rm -rf /usr/lib/node_modules/pm2
  rm -f /usr/bin/pm2 /usr/bin/pm2-dev
  rm -rf /root/.pm2 /root/.npm

  # 6. Source installer (kecuali mode keep-src untuk --total).
  #    Catatan: /tmp/install-total-*.sh (salinan install.sh saat re-exec
  #    --total) SENGAJA tidak dihapus — file itu sedang berjalan saat
  #    fungsi ini dipanggil dari install.sh.
  if [ "$keep_src" != "keep-src" ]; then
    rm -rf /root/darren-install
  fi

  # 7. Node.js/npm + vnstat (TERAKHIR: tidak ada langkah sesudah ini yang
  #    memakai npm/node/pm2 — apt sendiri tidak butuh Node).
  #    Bukti pasang (install.sh): Node 20 dari repo apt NodeSource (langkah 2,
  #    hanya bila node belum ada/<18) → paket `nodejs` (npm ikut di paket
  #    NodeSource); vnstat dari apt (langkah 10, untuk traffic menu).
  #    Repo apt NodeSource SENGAJA tidak dihapus: file repo itu inert dan
  #    dibuat ulang identik oleh install.sh langkah 2 saat install ulang.
  DEBIAN_FRONTEND=noninteractive apt-get remove -y --purge nodejs npm 2>/dev/null \
    || echo "PERINGATAN: hapus paket nodejs/npm gagal, lanjut."
  DEBIAN_FRONTEND=noninteractive apt-get remove -y --purge vnstat 2>/dev/null \
    || echo "PERINGATAN: hapus paket vnstat gagal, lanjut."
  rm -rf /var/lib/vnstat
  systemctl daemon-reload 2>/dev/null || true
}

main() {
  if [ "$(id -u)" != "0" ]; then
    echo "Jalankan uninstaller ini sebagai root." >&2
    exit 1
  fi

  echo "=== Uninstaller Darren (TOTAL stack Darren) ==="
  echo "Yang akan dihapus:"
  echo "  - bot ripzz-bot-js (pm2) + daemon PM2 + startup pm2-root + ~/.pm2"
  echo "  - PM2 global (npm uninstall -g pm2 + /usr/lib/node_modules/pm2)"
  echo "  - service vpn-api + xray + file unitnya + direktori drop-in xray"
  echo "  - file /root/bot-js, /root/vpn-api.py, /etc/vpn-api, /usr/local/bin/xray,"
  echo "    /etc/xray, menu /usr/bin/menu + script menu, /usr/bin/ipsave,"
  echo "    /usr/bin/cek-izin, /var/log/izin.log, /root/darren-install"
  echo "  - Node.js + npm (paket apt nodejs + npm) dan vnstat (+ data /var/lib/vnstat)"
  echo "Backup disalin dulu ke /root/darren-uninstall-backup-<waktu>/"
  echo "  (hanya /root/bot-js, /etc/vpn-api, /etc/xray, dan direktori drop-in xray)."
  echo "CATATAN: backup TIDAK mengembalikan Node.js/PM2/vnstat yang terhapus."
  echo "  Restore = kembalikan file dari backup + install ulang (install.sh"
  echo "  akan memasang Node/PM2/vnstat lagi dari nol)."
  echo "Yang TIDAK dihapus: OS dasar, perkakas generik (curl, git, wget, unzip,"
  echo "  python3, sqlite3, openssl, ca-certificates, gnupg), konfigurasi/kunci"
  echo "  SSH, direktori backup lama, dan data aplikasi lain. Ini BUKAN wipe"
  echo "  total VPS."
  echo ""
  read -r -p "Ketik YA (huruf besar) untuk lanjut uninstall: " confirm || true
  if [ "$confirm" != "YA" ]; then
    echo "Dibatalkan. Tidak ada yang diubah."
    exit 0
  fi

  BAK="/root/darren-uninstall-backup-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BAK"
  for d in /root/bot-js /etc/vpn-api /etc/xray /etc/systemd/system/xray.service.d; do
    if [ -e "$d" ]; then cp -a "$d" "$BAK/" 2>/dev/null || echo "Backup $d gagal, lanjut."; fi
  done
  echo "Backup di: $BAK"

  hapus_stack_darren

  echo ""
  echo "=== Selesai uninstall ==="
  echo "Backup: $BAK"
  echo "Terhapus: stack Darren + Node.js/npm + PM2 (+startup, ~/.pm2) + vnstat."
  echo "Tidak dihapus: OS dasar, perkakas generik, konfigurasi/kunci SSH,"
  echo "  direktori backup lama, dan data aplikasi lain (bukan wipe total VPS)."
  echo "Untuk install ulang: jalankan install.sh lagi (Node/PM2/vnstat akan"
  echo "  dipasang lagi dari nol)."
}

# Hanya jalan sebagai program utama; bila di-source (dipakai install.sh
# --total), hanya definisikan hapus_stack_darren tanpa menjalankan main.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi

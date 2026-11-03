#!/usr/bin/env bash
# Uninstaller script Darren (pasangan install.sh).
# Menghapus yang dipasang install.sh: bot-js (pm2), vpn-api, Xray, menu utama, permission (cek-izin).
# TIDAK menghapus: Node.js, npm, pm2, dan paket sistem (alat umum, dipakai
# lagi saat install ulang). Service startup pm2 juga dibiarkan (kosong,
# tidak mengganggu install ulang).
# Backup dulu ke /root/darren-uninstall-backup-<waktu>/ sebelum menghapus.
#
# Cara pakai di VPS (sebagai root):
#   curl -fsSL https://raw.githubusercontent.com/bungkangeddeng-cyber/Darren/main/uninstall.sh -o uninstall.sh
#   chmod +x uninstall.sh
#   ./uninstall.sh
#
# Script ini TIDAK berisi secret apapun.

if [ "$(id -u)" != "0" ]; then
  echo "Jalankan uninstaller ini sebagai root." >&2
  exit 1
fi

echo "=== Uninstaller Darren ==="
echo "Yang akan dihapus: bot ripzz-bot-js (pm2), service vpn-api, service xray,"
echo "file /root/bot-js, /root/vpn-api.py, /etc/vpn-api, /usr/local/bin/xray,"
echo "/etc/xray, menu /usr/bin/menu + script menu, /usr/bin/ipsave, /root/darren-install."
echo "Backup disalin dulu ke /root/darren-uninstall-backup-<waktu>/."
echo ""
read -r -p "Ketik YA (huruf besar) untuk lanjut uninstall: " confirm || true
if [ "$confirm" != "YA" ]; then
  echo "Dibatalkan. Tidak ada yang diubah."
  exit 0
fi

BAK="/root/darren-uninstall-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BAK"
for d in /root/bot-js /etc/vpn-api /etc/xray; do
  if [ -e "$d" ]; then cp -a "$d" "$BAK/" 2>/dev/null || echo "Backup $d gagal, lanjut."; fi
done
echo "Backup di: $BAK"

# 1. Bot (pm2)
pm2 delete ripzz-bot-js 2>/dev/null || true
pm2 save 2>/dev/null || true

# 2. Service
systemctl disable --now vpn-api 2>/dev/null || true
systemctl disable --now xray 2>/dev/null || true
rm -f /etc/systemd/system/vpn-api.service /etc/systemd/system/xray.service
systemctl daemon-reload 2>/dev/null || true

# 3. Menu (daftar file persis dari menu.zip bila ada; dibaca SEBELUM source dihapus)
MENU_ZIP="/root/darren-install/v4-main/Cdy/menu.zip"
if [ -f "$MENU_ZIP" ]; then
  unzip -Z1 "$MENU_ZIP" 2>/dev/null | while IFS= read -r f; do
    case "$f" in
      */) continue ;;
      *) rm -f "/usr/bin/$(basename "$f")" ;;
    esac
  done
else
  echo "menu.zip tidak ditemukan, hanya /usr/bin/menu + /usr/bin/ipsave yang dihapus."
fi
rm -f /usr/bin/menu /usr/bin/ipsave

# 3b. Permission baru (cek-izin): dihapus eksplisit supaya uninstall tetap
# total walau menu.zip lokal di VPS masih versi lama (tanpa cek-izin).
# Cache izin ikut terhapus bersama /etc/xray di langkah 4.
rm -f /usr/bin/cek-izin /var/log/izin.log
rm -rf /tmp/menu-baru

# 4. File aplikasi + source installer + sisa unduhan Xray
rm -rf /root/bot-js /root/vpn-api.py /etc/vpn-api /usr/local/bin/xray /etc/xray /root/darren-install
rm -f /tmp/xray.zip
rm -rf /tmp/xray-bin

echo ""
echo "=== Selesai uninstall ==="
echo "Backup: $BAK"
echo "Yang SENGAJA tidak dihapus: Node.js, npm, pm2, paket sistem, service startup pm2."
echo "Untuk install ulang: jalankan install.sh lagi."

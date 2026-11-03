#!/usr/bin/env bash
# Installer v4-main (versi perbaikan, LENGKAP) untuk VPS baru.
# Yang diinstal: bot-js (Telegram) + VPN API lokal (port 5890, localhost saja),
# Xray opsional, menu utama SSH (menu.zip -> /usr/bin), dan vnstat untuk traffic menu.
# Uninstaller pasangannya: uninstall.sh (repo yang sama).
#
# Cara pakai di VPS baru (sebagai root):
#   curl -fsSL https://raw.githubusercontent.com/bungkangeddeng-cyber/Darren/main/install.sh -o install.sh
#   chmod +x install.sh
#   ./install.sh
#   ./install.sh --total   # install total: backup + hapus instalasi lama, lalu install baru
#
# Script ini TIDAK berisi secret apapun. Token bot dan ID admin diminta
# lewat prompt saat instalasi, auth API dibuat acak, dan file .env
# dibuat dengan permission 600. Jangan pernah menempel token di log/chat.
set -euo pipefail

REPO_URL="https://github.com/bungkangeddeng-cyber/Darren.git"
SRC_DIR="/root/darren-install"
BOT_DIR="/root/bot-js"
API_FILE="/root/vpn-api.py"

if [ "$(id -u)" != "0" ]; then
  echo "Jalankan installer ini sebagai root." >&2
  exit 1
fi

# ---------- Argumen ----------
TOTAL=0
for arg in "$@"; do
  case "$arg" in
    --total) TOTAL=1 ;;
    --help|-h)
      echo "Pakai: ./install.sh [--total]"
      echo "  --total   Install total: backup lalu hapus semua instalasi SC lama,"
      echo "            baru install baru (token bot + admin diminta ulang)."
      echo "  Tanpa --total, bila instalasi lama ditemukan installer akan bertanya"
      echo "  dulu sebelum menghapus total."
      exit 0
      ;;
    *) echo "Argumen tidak dikenal: $arg (pakai --help)" >&2; exit 1 ;;
  esac
done

# Bila script dijalankan dari dalam source lama, jalankan ulang dari /tmp
# supaya source lama bisa dihapus total tanpa menghapus script yang sedang jalan.
if [ "$TOTAL" = 1 ]; then
  script_path="$(readlink -f "$0")"
  case "$script_path" in
    "$SRC_DIR"/*)
      echo "Menjalankan ulang dari /tmp agar source lama bisa dihapus total..."
      cp "$script_path" /tmp/install-total-$$.sh
      exec bash /tmp/install-total-$$.sh --total
      ;;
  esac
fi

# Hapus total instalasi SC lama (dipakai mode --total / jawaban y).
# TIDAK menghapus: node/npm/pm2, backup yang baru dibuat, dan SRC_DIR
# (sudah berisi source baru saat fungsi ini dipanggil).
hapus_instalasi_lama() {
  command -v unzip >/dev/null 2>&1 || apt-get install -y unzip 2>/dev/null || true
  pm2 delete ripzz-bot-js 2>/dev/null || true
  pm2 save 2>/dev/null || true
  systemctl disable --now vpn-api 2>/dev/null || true
  systemctl disable --now xray 2>/dev/null || true
  rm -f /etc/systemd/system/vpn-api.service /etc/systemd/system/xray.service
  systemctl daemon-reload 2>/dev/null || true
  if [ -f "$SRC_DIR/v4-main/Cdy/menu.zip" ]; then
    unzip -Z1 "$SRC_DIR/v4-main/Cdy/menu.zip" 2>/dev/null | while IFS= read -r f; do
      case "$f" in
        */) continue ;;
        *) rm -f "/usr/bin/$(basename "$f")" ;;
      esac
    done
  fi
  rm -f /usr/bin/menu /usr/bin/ipsave /usr/bin/cek-izin /var/log/izin.log
  rm -rf /tmp/menu-baru
  rm -rf /root/bot-js /root/vpn-api.py /etc/vpn-api /usr/local/bin/xray /etc/xray /tmp/xray.zip /tmp/xray-bin
}

# Siapkan install total: backup dulu, ambil source baru (gagal = batal,
# instalasi lama TIDAK dihapus), ganti source lama, lalu hapus total.
siapkan_install_total() {
  local stamp backup tmp_src
  stamp="$(date +%Y%m%d-%H%M%S)"
  backup="/root/darren-reinstall-backup-$stamp"
  echo "Install total: membackup instalasi lama ke $backup ..."
  mkdir -p "$backup"
  [ -d /root/bot-js ] && cp -a /root/bot-js "$backup/" 2>/dev/null || true
  [ -d /etc/vpn-api ] && cp -a /etc/vpn-api "$backup/" 2>/dev/null || true
  [ -d /etc/xray ] && cp -a /etc/xray "$backup/" 2>/dev/null || true
  echo "Mengambil source baru ..."
  tmp_src="/tmp/darren-fresh-$$"
  rm -rf "$tmp_src"
  git clone --depth 1 "$REPO_URL" "$tmp_src" || { echo "Gagal clone source baru, install total dibatalkan (instalasi lama TIDAK dihapus)." >&2; exit 1; }
  if [ ! -f "$tmp_src/v4-main/bot-js/app.js" ]; then
    echo "Source baru tidak lengkap, install total dibatalkan." >&2
    rm -rf "$tmp_src"
    exit 1
  fi
  rm -rf "$SRC_DIR"
  mv "$tmp_src" "$SRC_DIR"
  echo "Menghapus total instalasi SC lama ..."
  hapus_instalasi_lama
  echo "Instalasi lama sudah dihapus total (backup di $backup)."
}

echo "=== v4-main fixed installer ==="
echo "Mode ini menginstal bot-js + VPN API. BotVPN2 lama TIDAK diinstal"
echo "secara default (lebih tua dan lebih banyak jalur lamanya)."
echo ""

# ---------- 1. Dependensi sistem ----------
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg unzip git python3 sqlite3 openssl

# ---------- 2. Node.js >= 18 ----------
need_node=0
if ! command -v node >/dev/null 2>&1; then
  need_node=1
else
  major="$(node -v | sed 's/^v//; s/\..*//')"
  if [ "${major:-0}" -lt 18 ]; then need_node=1; fi
fi
if [ "$need_node" = "1" ]; then
  echo "Menginstal Node.js 20 dari repo apt resmi NodeSource (bukan pipe ke bash)..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  NODE_MAJOR=20
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi
echo "Node: $(node -v)"
npm install -g pm2

# ---------- 3. Ambil source ----------
if [ -f "./v4-main/bot-js/app.js" ]; then
  echo "Memakai source lokal di $(pwd)/v4-main"
  rm -rf "$SRC_DIR"
  cp -a ./v4-main "$SRC_DIR"
elif [ -d "$SRC_DIR/v4-main/bot-js" ]; then
  echo "Memakai source yang sudah ada di $SRC_DIR"
else
  echo "Meng-clone repo Darren..."
  rm -rf "$SRC_DIR"
  git clone --depth 1 "$REPO_URL" "$SRC_DIR"
fi
# ---------- 3b. Install total ----------
if [ "$TOTAL" = 1 ]; then
  siapkan_install_total
elif [ -d "$BOT_DIR" ] || [ -f /usr/bin/menu ]; then
  read -r -p "Instalasi lama ditemukan. Hapus total dulu (backup + hapus semua)? [y/N] " hapus_total || true
  if [ "$hapus_total" = "y" ] || [ "$hapus_total" = "Y" ]; then
    siapkan_install_total
  else
    echo "Lanjut install biasa (instalasi lama dipertahankan)."
  fi
fi
if [ ! -f "$SRC_DIR/v4-main/bot-js/app.js" ]; then
  echo "Source bot-js tidak ditemukan di $SRC_DIR/v4-main" >&2
  exit 1
fi
node --check "$SRC_DIR/v4-main/bot-js/app.js"
python3 -m py_compile "$SRC_DIR/v4-main/Api/vpn-api.py"

# ---------- 4. Backup instalasi lama (bila ada) ----------
if [ -d "$BOT_DIR" ]; then
  bak="/root/bot-js.bak-$(date +%Y%m%d-%H%M%S)"
  echo "Backup bot lama ke $bak"
  cp -a "$BOT_DIR" "$bak"
fi

# ---------- 5. Prompt konfigurasi (aman, tidak di-echo) ----------
echo ""
echo "Isi konfigurasi berikut. Kosongkan yang opsional bila belum ada."
read -r -p "Domain VPS kamu (contoh: vpn.contoh.com, kosong = localhost saja): " VPN_DOMAIN || true
while true; do
  read -r -s -p "BOT_TOKEN Telegram (dari BotFather, tidak akan tampil): " BOT_TOKEN || true
  echo ""
  if [ -n "$BOT_TOKEN" ]; then break; fi
  echo "BOT_TOKEN wajib diisi."
done
while true; do
  read -r -p "ADMIN_ID Telegram (angka saja): " ADMIN_ID || true
  if [[ "$ADMIN_ID" =~ ^[0-9]+$ ]]; then break; fi
  echo "ADMIN_ID harus angka."
done
read -r -p "P2P Gateway URL (opsional, kosong = deposit GoPay nonaktif): " P2P_URL || true
read -r -p "Digiflazz username (opsional): " DIGI_USER || true
if [ -n "$DIGI_USER" ]; then
  read -r -s -p "Digiflazz API key (opsional, tidak akan tampil): " DIGI_KEY || true
  echo ""
else
  DIGI_KEY=""
fi

VPN_API_AUTH="$(openssl rand -hex 24)"
VPN_API_BASE="http://127.0.0.1:5890"

# ---------- 6. Salin bot + API ----------
rm -rf "$BOT_DIR"
cp -a "$SRC_DIR/v4-main/bot-js" "$BOT_DIR"
cp "$SRC_DIR/v4-main/Api/vpn-api.py" "$API_FILE"

# .env: jangan timpa .env lama tanpa konfirmasi
if [ -f "$BOT_DIR/.env" ]; then
  read -r -p ".env sudah ada. Timpa dengan konfigurasi baru? [y/N] " overwrite || true
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    echo "Memakai .env lama. Pastikan VPN_API_AUTH di .env sama dengan auth API di bawah."
  else
    rm -f "$BOT_DIR/.env"
  fi
fi
if [ ! -f "$BOT_DIR/.env" ]; then
  cat > "$BOT_DIR/.env" <<EOF
BOT_TOKEN=$BOT_TOKEN
ADMIN_ID=$ADMIN_ID
VPN_API_BASE=$VPN_API_BASE
VPN_API_AUTH=$VPN_API_AUTH
VPN_DOMAIN=$VPN_DOMAIN
P2P_GATEWAY_URL=$P2P_URL
DIGIFLAZZ_USERNAME=$DIGI_USER
DIGIFLAZZ_API_KEY=$DIGI_KEY
EOF
  chmod 600 "$BOT_DIR/.env"
  echo ".env dibuat (600)."
fi

# ---------- 7. Service VPN API (localhost saja) ----------
mkdir -p /etc/vpn-api
cat > /etc/vpn-api/auth.env <<EOF
VPN_API_AUTH=$VPN_API_AUTH
VPN_API_PORT=5890
EOF
chmod 600 /etc/vpn-api/auth.env
cat > /etc/systemd/system/vpn-api.service <<EOF
[Unit]
Description=VPN API untuk bot-js (localhost 5890)
After=network.target
[Service]
Type=simple
ExecStart=/usr/bin/python3 /root/vpn-api.py
EnvironmentFile=/etc/vpn-api/auth.env
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now vpn-api

# ---------- 8. Bot ----------
cd "$BOT_DIR"
npm install
# Hentikan bot lama bila ada, lalu jalankan yang baru
pm2 delete ripzz-bot-js 2>/dev/null || true
pm2 start app.js --name ripzz-bot-js
pm2 save || true
pm2 startup systemd -u root --hp /root 2>/dev/null || echo "pm2 startup perlu dijalankan manual bila gagal (lihat output pm2)."

# ---------- 9. Xray opsional ----------
read -r -p "Instal Xray juga? [y/N] " install_xray || true
if [[ "$install_xray" =~ ^[Yy]$ ]]; then
  echo "Menginstal Xray dari release resmi XTLS..."
  tag="$(curl -fsSL https://api.github.com/repos/XTLS/Xray-core/releases/latest | grep '"tag_name"' | head -1 | cut -d'"' -f4)" || tag=""
  if [ -z "$tag" ]; then
    echo "Gagal mendapatkan versi Xray terbaru. Lewati instalasi Xray." >&2
  else
    cd /tmp
    if curl -fsSL --retry 3 -o xray.zip "https://github.com/XTLS/Xray-core/releases/download/${tag}/Xray-linux-64.zip"; then
      unzip -o xray.zip -d /tmp/xray-bin
      install -m 755 /tmp/xray-bin/xray /usr/local/bin/xray
      mkdir -p /etc/xray
      if [ ! -f /etc/xray/config.json ]; then
        cp "$SRC_DIR/v4-main/Cfg/config.json" /etc/xray/config.json
        echo "Config Xray disalin dari Cfg/config.json (template bermarker)."
        echo "Periksa domain/UUID di config itu sebelum dipakai produksi."
      fi
      cat > /etc/systemd/system/xray.service <<EOF
[Unit]
Description=Xray
After=network.target
[Service]
Type=simple
ExecStart=/usr/local/bin/xray run -c /etc/xray/config.json
Restart=on-failure
[Install]
WantedBy=multi-user.target
EOF
      systemctl daemon-reload
      if /usr/local/bin/xray run -test -c /etc/xray/config.json; then
        systemctl enable --now xray
        echo "Xray aktif."
      else
        echo "PERINGATAN: config Xray gagal validasi. Xray TIDAK dijalankan."
        echo "Perbaiki /etc/xray/config.json lalu: systemctl enable --now xray"
      fi
    else
      echo "Gagal mengunduh Xray ${tag} (aset release bisa sedang ditarik/diperbarui atau jaringan sesaat). Lewati instalasi Xray." >&2
    fi
  fi
else
  echo "Xray dilewati. Akun non-CF butuh Xray yang sudah berjalan di server ini."
fi

# ---------- 10. Menu utama (bagian dari script lengkap) ----------
# Menu SSH klasik (menu.zip) tidak dipasang installer lama, padahal itu
# bagian dari script lengkap. Dipasang di sini agar perintah `menu` tersedia.
# Jalur config selaras: menu, vpn-api, dan service xray sama-sama memakai
# /etc/xray/config.json, jadi tidak ada split-brain antar pengelola.
echo "Memasang menu utama..."
MENU_ZIP="$SRC_DIR/v4-main/Cdy/menu.zip"
if [ -f "$MENU_ZIP" ]; then
  MENU_TMP="$(mktemp -d)"
  unzip -o -q "$MENU_ZIP" -d "$MENU_TMP"
  chmod +x "$MENU_TMP"/menu/*
  cp -a "$MENU_TMP"/menu/. /usr/bin/
  rm -rf "$MENU_TMP"
  mkdir -p /etc/xray
  MENU_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [ -n "$VPN_DOMAIN" ]; then
    echo "$VPN_DOMAIN" > /etc/xray/domain
  elif [ ! -f /etc/xray/domain ]; then
    echo "${MENU_IP:-127.0.0.1}" > /etc/xray/domain
  fi
  echo "${MENU_IP:-127.0.0.1}" > /usr/bin/ipsave
  apt-get install -y vnstat 2>/dev/null || echo "vnstat gagal diinstal, traffic di menu akan tampil 0."
  if [ -x /usr/bin/menu ]; then
    echo "Menu utama terpasang. Ketik: menu"
  else
    echo "PERINGATAN: menu gagal terpasang." >&2
  fi
else
  echo "PERINGATAN: $MENU_ZIP tidak ditemukan, menu dilewati." >&2
fi

# ---------- 11. Verifikasi ----------
echo ""
echo "=== Verifikasi ==="
systemctl is-active vpn-api || echo "vpn-api TIDAK aktif — cek: journalctl -u vpn-api -n 50"
curl -fsSL http://127.0.0.1:5890/health || echo "Health API tidak merespon."
pm2 list || true
echo ""
echo "=== Selesai ==="
echo "Bot: /root/bot-js (pm2: ripzz-bot-js)"
echo "API: /root/vpn-api.py, service vpn-api, auth di /etc/vpn-api/auth.env (600)"
echo "PENTING:"
echo " - Port API 5890 hanya bind localhost. Jangan dibuka ke publik."
echo " - Bila ini migrasi dari script lama, generate PKI OpenVPN baru."
echo "   Kunci privat lama yang pernah publik harus dianggap bocor."
echo " - Uji dulu dengan trial di bot sebelum jualan."

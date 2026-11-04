#!/usr/bin/env bash
# Installer v4-main (versi perbaikan, LENGKAP) untuk VPS baru.
# Yang diinstal: bot-js (Telegram) + VPN API lokal (port 5890, localhost saja),
# Xray (wajib jalan; default YA), menu utama SSH (menu.zip -> /usr/bin), dan vnstat untuk traffic menu.
# Uninstaller pasangannya: uninstall.sh (repo yang sama).
#
# Cara pakai di VPS baru (sebagai root):
#   curl -fsSL -H "Authorization: Bearer ISI_TOKEN_DARI_HP" https://raw.githubusercontent.com/bungkangeddeng-cyber/Darren/main/install.sh -o install.sh
#   chmod +x install.sh
#   ./install.sh
#   ./install.sh --total   # install total: backup + hapus instalasi lama, lalu install baru
# Token baca dibuat dari HP owner (GitHub -> token read-only khusus repo Darren,
# masa berlaku pendek). Token yang sama dipakai di perintah unduh dan saat
# installer meminta (atau lewat env GH_TOKEN). Repo Darren private: tanpa
# token, unduhan dan clone gagal (404).
#
# Script ini TIDAK berisi secret apapun. Token GitHub, token bot, dan ID admin
# diminta lewat prompt saat instalasi, auth API dibuat acak, dan file .env
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
      echo "            termasuk Node/PM2/vnstat, baru install baru (token bot +"
      echo "            admin diminta ulang; Node/PM2 dipasang lagi dari nol)."
      echo "  Tanpa --total, bila instalasi lama ditemukan installer akan bertanya"
      echo "  dulu sebelum menghapus total."
      echo "  Token GitHub: set GH_TOKEN=... atau isi prompt (token baca repo,"
      echo "            read-only, dari HP owner). Wajib bila repo sudah private,"
      echo "            kosongkan bila repo masih publik."
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

# ---------- Token GitHub ----------
# Repo Darren private: clone butuh token baca (read-only, khusus repo Darren).
# Token bisa lewat env GH_TOKEN (tidak ditanya lagi) atau prompt tersembunyi
# (tidak tampil saat diketik). Kosongkan bila repo masih publik.
# Token TIDAK disimpan di file mana pun dan TIDAK dibiarkan di config git:
# clone memakai header sekali pakai (http.extraHeader), bukan URL bertoken.
if [ -z "${GH_TOKEN:-}" ]; then
  read -r -s -p "Token GitHub baca repo Darren (dari HP owner; kosongkan bila repo masih publik): " GH_TOKEN || true
  echo ""
  TOKEN_SOURCE="prompt"
else
  TOKEN_SOURCE="environment"
fi
git_clone_darren() {
  local dest="$1"
  if [ -n "${GH_TOKEN:-}" ]; then
    # P0 2026-11-03: pra-validasi token + gagal cepat. Tanpa
    # GIT_TERMINAL_PROMPT=0, token buruk -> 401 -> git jatuh ke prompt
    # username interaktif (itulah kegagalan rebuild server2).
    echo "Memvalidasi token GitHub (sumber: $TOKEN_SOURCE; nilai tidak pernah ditampilkan)..."
    if ! GIT_TERMINAL_PROMPT=0 git -c http.extraHeader="Authorization: Bearer $GH_TOKEN" ls-remote "$REPO_URL" >/dev/null 2>&1; then
      echo "ERROR: Token GitHub ditolak (401/403) atau repo tidak terjangkau." >&2
      echo "Periksa: token read-only khusus repo Darren, belum kedaluwarsa, dan repo masih ada. Lalu jalankan ulang." >&2
      exit 1
    fi
    GIT_TERMINAL_PROMPT=0 git -c http.extraHeader="Authorization: Bearer $GH_TOKEN" clone --depth 1 "$REPO_URL" "$dest"
  else
    GIT_TERMINAL_PROMPT=0 git clone --depth 1 "$REPO_URL" "$dest" || { echo "ERROR: Clone repo gagal. Bila repo sudah private, jalankan ulang dengan token GitHub (prompt/env GH_TOKEN)." >&2; exit 1; }
  fi
}

# Hapus total instalasi SC lama (dipakai mode --total / jawaban y).
# SATU SUMBER KEBENARAN: daftar hapus ada di hapus_stack_darren() di
# uninstall.sh (repo root) — fungsi ini hanya memanggilnya, BUKAN salinan
# daftar kedua. Mengubah daftar hapus = ubah uninstall.sh saja.
# Perbedaan yang disengaja vs uninstall mandiri:
#  - backup SUDAH dibuat siapkan_install_total (ke darren-reinstall-backup-*),
#    jadi fungsi hapus tidak membackup lagi;
#  - /root/darren-install TIDAK dihapus (argumen keep-src), karena source
#    baru sudah ada di sana dan masih dibutuhkan langkah install berikut;
#  - Node/PM2/vnstat ikut dihapus (seperti uninstall mandiri); siapkan
#    memasangnya lagi lewat pasang_node_pm2 di akhir (langkah 8 butuh
#    npm/pm2, dan node --check butuh node — keduanya jalan SETELAH total).
hapus_instalasi_lama() {
  command -v unzip >/dev/null 2>&1 || apt-get install -y unzip 2>/dev/null || true
  if [ ! -f "$SRC_DIR/uninstall.sh" ]; then
    echo "ERROR: $SRC_DIR/uninstall.sh tidak ditemukan — hapus total dibatalkan (instalasi lama TIDAK dihapus)." >&2
    exit 1
  fi
  bash -n "$SRC_DIR/uninstall.sh" || { echo "ERROR: $SRC_DIR/uninstall.sh gagal cek sintaks — hapus total dibatalkan." >&2; exit 1; }
  # shellcheck disable=SC1091
  source "$SRC_DIR/uninstall.sh"
  echo "Menghapus stack Darren lama (termasuk Node/PM2/vnstat) ..."
  hapus_stack_darren keep-src
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
  # FASE 1: drop-in Xray ikut dibackup supaya penghapusannya di
  # hapus_stack_darren tidak menghilangkan jejak unit efektif lama.
  [ -d /etc/systemd/system/xray.service.d ] && cp -a /etc/systemd/system/xray.service.d "$backup/" 2>/dev/null || true
  echo "Mengambil source baru ..."
  tmp_src="/tmp/darren-fresh-$$"
  rm -rf "$tmp_src"
  git_clone_darren "$tmp_src" || { echo "Gagal clone source baru, install total dibatalkan (instalasi lama TIDAK dihapus)." >&2; exit 1; }
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
  # Hapus total ikut menghapus Node/PM2 (lihat hapus_stack_darren) —
  # pasang lagi sekarang, sebelum node --check dan langkah 8 (npm/pm2).
  pasang_node_pm2
  echo "Node/PM2 dipasang lagi setelah hapus total."
}

echo "=== v4-main fixed installer ==="
echo "Mode ini menginstal bot-js + VPN API. BotVPN2 lama TIDAK diinstal"
echo "secara default (lebih tua dan lebih banyak jalur lamanya)."
echo ""

# ---------- 1. Dependensi sistem ----------
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg unzip git python3 sqlite3 openssl

# ---------- 2. Node.js >= 18 + PM2 ----------
# Dibungkus fungsi karena dipanggil dua kali: sekali di sini (install biasa)
# dan sekali lagi di akhir siapkan_install_total (install total menghapus
# Node/PM2 lewat hapus_stack_darren, jadi harus dipasang lagi sebelum
# node --check dan langkah 8 yang memakai npm/pm2).
pasang_node_pm2() {
  local need_node=0
  local major=""
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
}
pasang_node_pm2

# ---------- 3. Ambil source ----------
if [ -f "./v4-main/bot-js/app.js" ]; then
  echo "Memakai source lokal di $(pwd)/v4-main"
  # P0 2026-11-03: JANGAN rm -rf "$SRC_DIR" lalu cp dari ./v4-main bila
  # posisi jalan SUDAH di dalam SRC_DIR — itu menghapus sumbernya sendiri
  # (kegagalan rebuild server2). Bila sudah di dalam, tidak ada yang disalin.
  # Bila dari direktori lain, salin ke level $SRC_DIR/v4-main yang benar
  # (cek baris 188 mengharapkan $SRC_DIR/v4-main/bot-js/app.js).
  if [ "$(readlink -f .)" = "$(readlink -f "$SRC_DIR")" ]; then
    echo "Sudah di dalam $SRC_DIR, penyalinan dilewati."
  else
    mkdir -p "$SRC_DIR"
    rm -rf "$SRC_DIR/v4-main"
    cp -a ./v4-main "$SRC_DIR/v4-main"
  fi
elif [ -d "$SRC_DIR/v4-main/bot-js" ]; then
  echo "Memakai source yang sudah ada di $SRC_DIR"
else
  echo "Meng-clone repo Darren..."
  rm -rf "$SRC_DIR"
  git_clone_darren "$SRC_DIR"
fi
# ---------- 5. Prompt konfigurasi (DIPINDAH ke sini, FASE 1) ----------
# Prompt-prompt ini DULU ada di langkah 5 (setelah penghapusan total),
# sehingga batal/EOF di prompt meninggalkan VPS telanjang. Sekarang semua
# ditanyakan SEBELUM penghapusan destruktif apa pun (langkah 3b).
echo ""
echo "Isi konfigurasi berikut. Kosongkan yang opsional bila belum ada."
read -r -p "Domain VPS kamu (contoh: vpn.contoh.com, kosong = localhost saja): " VPN_DOMAIN || true
while true; do
  if ! read -r -s -p "BOT_TOKEN Telegram (dari BotFather, tidak akan tampil): " BOT_TOKEN; then
    echo ""
    if [ -z "$BOT_TOKEN" ]; then echo "ERROR: input berakhir (EOF) sebelum BOT_TOKEN diisi — jalankan installer secara interaktif, bukan lewat pipe tertutup." >&2; exit 1; fi
  fi
  echo ""
  if [ -n "$BOT_TOKEN" ]; then break; fi
  echo "BOT_TOKEN wajib diisi."
done
while true; do
  if ! read -r -p "ADMIN_ID Telegram (angka saja): " ADMIN_ID; then
    if [ -z "$ADMIN_ID" ]; then echo "ERROR: input berakhir (EOF) sebelum ADMIN_ID diisi — jalankan installer secara interaktif, bukan lewat pipe tertutup." >&2; exit 1; fi
  fi
  if [[ "$ADMIN_ID" =~ ^[0-9]+$ ]]; then break; fi
  echo "ADMIN_ID harus angka."
done
read -r -p "H2H Gateway URL (kosong = pakai https://payment-gateway.outletku.ai.id/api/h2h/v1): " H2H_URL || true
read -r -s -p "H2H API key operator (kunci gk_ tenant operator; kosong = deposit H2H nonaktif, tidak akan tampil): " H2H_KEY || true
echo ""
read -r -p "Digiflazz username (opsional): " DIGI_USER || true
if [ -n "$DIGI_USER" ]; then
  read -r -s -p "Digiflazz API key (opsional, tidak akan tampil): " DIGI_KEY || true
  echo ""
else
  DIGI_KEY=""
fi
# Pilihan Xray juga ditanya di sini (dulu di langkah 9); langkah 9 hanya
# memakai variabel ini, tidak bertanya lagi.
read -r -p "Instal Xray? [Y/n, kosong = YA] " install_xray || true

VPN_API_AUTH="$(openssl rand -hex 24)"
VPN_API_BASE="http://127.0.0.1:5890"

# ---------- 3b. Install total ----------
if [ "$TOTAL" = 1 ]; then
  # FASE 1: --total wajib konfirmasi ketik YA (gaya uninstall mandiri)
  # SEBELUM siapkan_install_total berjalan; selain YA = batal total.
  echo "PERINGATAN: --total akan membackup lalu MENGHAPUS TOTAL stack Darren lama (bot, API, Xray, menu, Node/PM2/vnstat)."
  read -r -p "Ketik YA (huruf besar) untuk lanjut install total: " confirm_total || true
  if [ "$confirm_total" != "YA" ]; then
    echo "Dibatalkan. Instalasi lama TIDAK dihapus."
    exit 0
  fi
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

# ---------- 5. Prompt konfigurasi (SUDAH DIPINDAH, FASE 1) ----------
# Blok prompt (domain, BOT_TOKEN, ADMIN_ID, H2H, Digiflazz, pilihan Xray)
# dipindah ke sebelum langkah 3b supaya pembatalan/EOF di prompt tidak
# meninggalkan VPS telanjang. Variabelnya (VPN_DOMAIN, BOT_TOKEN, ADMIN_ID,
# H2H_URL, H2H_KEY, DIGI_USER, DIGI_KEY, install_xray, VPN_API_AUTH,
# VPN_API_BASE) sudah terisi di sana dan dipakai langkah 6-9 di bawah.

# ---------- 6. Salin bot + API ----------
rm -rf "$BOT_DIR"
cp -a "$SRC_DIR/v4-main/bot-js" "$BOT_DIR"
cp "$SRC_DIR/v4-main/Api/vpn-api.py" "$API_FILE"

# .env: jangan timpa .env lama tanpa konfirmasi
if [ -f "$BOT_DIR/.env" ]; then
  read -r -p ".env sudah ada. Timpa dengan konfigurasi baru? [y/N] " overwrite || true
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    echo "Memakai .env lama. Pastikan VPN_API_AUTH di .env sama dengan auth API di bawah."
    grep -q 'H2H_API_KEY=gk_' "$BOT_DIR/.env" 2>/dev/null || echo "PERHATIAN: .env lama tidak berisi H2H_API_KEY — deposit H2H nonaktif sampai kunci gk_ operator ditambahkan."
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
H2H_BASE_URL=${H2H_URL:-https://payment-gateway.outletku.ai.id/api/h2h/v1}
H2H_API_KEY=$H2H_KEY
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
# Restart eksplisit (bukan hanya enable --now yang no-op pada service aktif):
# pada reinstall, biner + auth.env baru harus dimuat proses yang sedang jalan.
systemctl enable vpn-api
if systemctl is-active --quiet vpn-api; then
  systemctl restart vpn-api || echo "PERINGATAN: restart vpn-api gagal — verifikasi akhir akan menandainya." >&2
else
  systemctl start vpn-api || echo "PERINGATAN: start vpn-api gagal — verifikasi akhir akan menandainya." >&2
fi

# ---------- 8. Bot ----------
cd "$BOT_DIR"
npm install
# Hentikan bot lama bila ada, lalu jalankan yang baru
pm2 delete ripzz-bot-js 2>/dev/null || true
pm2 start app.js --name ripzz-bot-js
pm2 save || true
pm2 startup systemd -u root --hp /root 2>/dev/null || echo "pm2 startup perlu dijalankan manual bila gagal (lihat output pm2)."

# ---------- 9. Xray (wajib jalan; default YA) ----------
# Pilihan install_xray sudah ditanya sebelum langkah 3b (FASE 1); di sini
# hanya dipakai, tidak ditanya lagi.
if [[ ! "$install_xray" =~ ^[Nn] ]]; then
  echo "Menginstal Xray dari release resmi XTLS..."
  tag="$(curl -fsSL https://api.github.com/repos/XTLS/Xray-core/releases/latest | grep '"tag_name"' | head -1 | cut -d'"' -f4)" || tag=""
  if [ -z "$tag" ]; then
    echo "Gagal mendapatkan versi Xray terbaru. Instalasi Xray dilewati; verifikasi akhir akan menggagalkan install." >&2
  else
    cd /tmp
    if curl -fsSL --retry 3 -o xray.zip "https://github.com/XTLS/Xray-core/releases/download/${tag}/Xray-linux-64.zip"; then
      unzip -o xray.zip -d /tmp/xray-bin
      install -m 755 /tmp/xray-bin/xray /usr/local/bin/xray
      # FASE 1: template config memakai aturan geoip/geosite — dat file
      # lengkap wajib ada, kalau tidak gate run -test di bawah pasti gagal.
      mkdir -p /usr/local/share/xray
      DAT_FAIL=0
      if ! curl -fsSL --retry 3 -o /usr/local/share/xray/geoip.dat "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat"; then DAT_FAIL=1; fi
      if ! curl -fsSL --retry 3 -o /usr/local/share/xray/geosite.dat "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat"; then DAT_FAIL=1; fi
      for _dat in geoip.dat geosite.dat; do
        _sz="$(stat -c%s "/usr/local/share/xray/$_dat" 2>/dev/null || echo 0)"
        if [ "$_sz" -lt 1048576 ]; then DAT_FAIL=1; fi
      done
      if [ "$DAT_FAIL" != 1 ]; then
      # FASE 1: drop-in systemd peninggalan installer resmi Xray bisa
      # menimpa ExecStart ke /usr/local/etc/xray/config.json (split-brain:
      # service membaca file lain dari yang ditulis installer). Backup lalu
      # hapus isi direktori drop-in supaya service memakai unit ini.
      if [ -d /etc/systemd/system/xray.service.d ] && [ -n "$(ls -A /etc/systemd/system/xray.service.d 2>/dev/null)" ]; then
        _dropbak="/root/xray-dropin-backup-$(date +%Y%m%d-%H%M%S)"
        mkdir -p "$_dropbak"
        cp -a /etc/systemd/system/xray.service.d/. "$_dropbak/" 2>/dev/null || true
        echo "Drop-in Xray lama dibackup ke $_dropbak lalu dihapus (service memakai /etc/xray/config.json)."
        rm -f /etc/systemd/system/xray.service.d/*.conf
      fi
      mkdir -p /etc/xray
      if [ ! -f /etc/xray/config.json ]; then
        cp "$SRC_DIR/v4-main/Cfg/config.json" /etc/xray/config.json
        # FASE 1: kredensial contoh di template ada di repo publik — ganti
        # dengan nilai acak di SALINAN ini (template repo tidak diubah).
        # Hanya nilai yang diganti; struktur dan marker baris (#vless,
        # #vmess, dsb.) tidak diubah. Template tidak punya field
        # domain/SNI/host (TLS terminasi di haproxy); domain tetap ditulis
        # ke /etc/xray/domain di langkah 10.
        for _oldid in $(grep -o '"id": "[^"]*"' /etc/xray/config.json | sed 's/"id": "//; s/"//' | sort -u); do
          _newid="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "")"
          [ -n "$_newid" ] && sed -i "s|\"id\": \"$_oldid\"|\"id\": \"$_newid\"|g" /etc/xray/config.json
        done
        for _oldpw in $(grep -o '"password": "[^"]*"' /etc/xray/config.json | sed 's/"password": "//; s/"//' | sort -u); do
          _newpw="$(openssl rand -hex 16 2>/dev/null || echo "")"
          [ -n "$_newpw" ] && sed -i "s|\"password\": \"$_oldpw\"|\"password\": \"$_newpw\"|g" /etc/xray/config.json
        done
        echo "Config Xray disalin dari Cfg/config.json (template bermarker); kredensial contoh sudah diganti nilai acak."
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
        # Restart eksplisit (bukan hanya enable --now yang no-op pada service aktif).
        systemctl enable xray
        if systemctl is-active --quiet xray; then
          systemctl restart xray || echo "PERINGATAN: restart xray gagal — verifikasi akhir akan menandainya." >&2
        else
          systemctl start xray || echo "PERINGATAN: start xray gagal — verifikasi akhir akan menandainya." >&2
        fi
        echo "Xray aktif."
      else
        echo "PERINGATAN: config Xray gagal validasi. Xray TIDAK dijalankan."
        echo "Perbaiki /etc/xray/config.json lalu: systemctl enable --now xray"
        echo "Verifikasi akhir akan menggagalkan install bila Xray tidak aktif." >&2
      fi
      else
        echo "ERROR: geoip.dat/geosite.dat gagal diunduh atau tidak lengkap — Xray TIDAK dijalankan." >&2
        echo "Perbaiki jaringan lalu jalankan ulang installer." >&2
      fi
    else
      echo "Gagal mengunduh Xray ${tag} (aset release bisa sedang ditarik/diperbarui atau jaringan sesaat). Instalasi Xray dilewati; verifikasi akhir akan menggagalkan install." >&2
    fi
  fi
else
  echo "Xray TIDAK diinstal (jawaban N). Karena Xray wajib jalan setelah install, verifikasi akhir (langkah 11) akan menggagalkan install." >&2
fi

# ---------- 10. Menu utama (bagian dari script lengkap) ----------
# Menu SSH klasik (menu.zip) tidak dipasang installer lama, padahal itu
# bagian dari script lengkap. Dipasang di sini agar perintah `menu` tersedia.
# Jalur config selaras: menu, vpn-api, dan service xray sama-sama memakai
# /etc/xray/config.json, jadi tidak ada split-brain antar pengelola.
# (Drop-in lama yang menimpa ExecStart dihapus di langkah 9, FASE 1.)
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

# Token baca izin untuk menu (cek-izin): dipakai membaca allowlist dari repo
# private. Disimpan terkunci (600) di /etc/xray/izin-token, hanya root yang baca.
# Bisa lewat env IZIN_TOKEN atau prompt tersembunyi. Kosongkan bila repo masih
# publik (cek-izin tetap jalan tanpa token); wajib setelah repo private.
if [ -z "${IZIN_TOKEN:-}" ]; then
  read -r -s -p "Token baca izin menu (dari HP owner; kosongkan bila repo masih publik): " IZIN_TOKEN || true
  echo ""
fi
if [ -n "${IZIN_TOKEN:-}" ]; then
  mkdir -p /etc/xray
  printf '%s' "$IZIN_TOKEN" > /etc/xray/izin-token
  chmod 600 /etc/xray/izin-token
  echo "Token baca izin tersimpan di /etc/xray/izin-token (600)."
fi
unset IZIN_TOKEN

# ---------- 11. Verifikasi (HARUS lolos semua; bila ada yang gagal, install GAGAL) ----------
echo ""
echo "=== Verifikasi ==="
VERIFY_FAIL=0
if systemctl is-active --quiet vpn-api; then
  echo "OK: vpn-api aktif"
else
  echo "GAGAL: vpn-api tidak aktif — cek: journalctl -u vpn-api -n 50" >&2; VERIFY_FAIL=1
fi
if curl -fsSL http://127.0.0.1:5890/health >/dev/null 2>&1; then
  echo "OK: API 127.0.0.1:5890/health merespon"
else
  echo "GAGAL: Health API tidak merespon." >&2; VERIFY_FAIL=1
fi
if pm2 describe ripzz-bot-js 2>/dev/null | grep -q "online"; then
  echo "OK: bot PM2 ripzz-bot-js online"
else
  echo "GAGAL: bot PM2 ripzz-bot-js tidak online — cek: pm2 list" >&2; VERIFY_FAIL=1
fi
if systemctl is-active --quiet xray; then
  echo "OK: xray aktif"
else
  echo "GAGAL: xray tidak aktif — Xray wajib jalan setelah install." >&2; VERIFY_FAIL=1
fi
# FASE 1: is-active saja tidak cukup — drop-in lama bisa membuat unit
# efektif melayani config lain. Cek ExecStart TERAKHIR yang berlaku
# (baris ExecStart kosong = reset, diabaikan).
if systemctl cat xray 2>/dev/null | grep '^ExecStart=' | grep -v '^ExecStart=$' | tail -1 | grep -q '/etc/xray/config.json'; then
  echo "OK: unit xray efektif memakai /etc/xray/config.json"
else
  echo "GAGAL: unit xray efektif TIDAK memakai /etc/xray/config.json — periksa drop-in di /etc/systemd/system/xray.service.d/." >&2; VERIFY_FAIL=1
fi
if [ -x /usr/bin/menu ]; then
  echo "OK: /usr/bin/menu terpasang"
else
  echo "GAGAL: /usr/bin/menu tidak ditemukan/tidak executable." >&2; VERIFY_FAIL=1
fi
if [ -x /usr/bin/cek-izin ]; then
  echo "OK: /usr/bin/cek-izin terpasang"
else
  echo "GAGAL: /usr/bin/cek-izin tidak ditemukan/tidak executable." >&2; VERIFY_FAIL=1
fi
# pm2 startup yang gagal TIDAK menggagalkan verifikasi (bot tetap jalan di sesi
# ini), tapi tampilkan perintah manualnya dengan MENONJOL bila belum aktif.
if ! systemctl is-enabled pm2-root >/dev/null 2>&1; then
  echo "PERHATIAN: pm2 startup belum aktif — bot TIDAK akan auto-start saat boot."
  echo "Jalankan manual: pm2 startup systemd -u root --hp /root"
fi
if [ "$VERIFY_FAIL" = "1" ]; then
  echo "" >&2
  echo "=== VERIFIKASI GAGAL: install TIDAK selesai. Perbaiki item GAGAL di atas lalu jalankan ulang installer. ===" >&2
  exit 1
fi
echo ""
echo "=== Selesai ==="
echo "Bot: /root/bot-js (pm2: ripzz-bot-js)"
echo "API: /root/vpn-api.py, service vpn-api, auth di /etc/vpn-api/auth.env (600)"
echo "PENTING:"
echo " - Port API 5890 hanya bind localhost. Jangan dibuka ke publik."
echo " - Bila ini migrasi dari script lama, generate PKI OpenVPN baru."
echo "   Kunci privat lama yang pernah publik harus dianggap bocor."
echo " - Uji dulu dengan trial di bot sebelum jualan."
# Bersihkan token dari shell (tidak disimpan di file mana pun).
unset GH_TOKEN

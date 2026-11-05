#!/usr/bin/env bash
# DARREN_INSTALLER_VERSION=fix-total-20261105-06
# Installer v4-main (versi perbaikan, LENGKAP) untuk VPS baru.
# Penanda versi yang bisa di-grep: DARREN_INSTALLER_VERSION di atas.
# Xray dipin ke SATU rilis resmi: lihat XRAY_TAG_PIN di bawah (bukan latest mengambang).
# Yang diinstal: bot-js (Telegram) + VPN API lokal (port 5890, localhost saja),
# Xray (wajib jalan; default YA), menu utama SSH (menu.zip -> /usr/bin), dan vnstat untuk traffic menu.
# Uninstaller pasangannya: uninstall.sh (repo yang sama).
#
# Cara pakai di VPS baru (sebagai root):
#   curl -fsSL https://raw.githubusercontent.com/bungkangeddeng-cyber/Darren/main/install.sh -o install.sh
#   chmod +x install.sh
#   ./install.sh
#   ./install.sh --total   # install total: backup + hapus instalasi lama, lalu install baru
# Repo Darren saat ini PUBLIK, jadi unduhan di atas tidak butuh token.
# Bila repo sudah di-private-kan (RENCANA, bukan fakta saat ini), token baca
# read-only khusus repo Darren dibuat dari HP owner (masa berlaku pendek)
# dan dipakai lewat env/prompt saat installer meminta — JANGAN pernah
# menempel nilai token di perintah curl, chat, atau log (nilai token di
# shell history = token bocor). Pola aman: baca token ke variabel lewat
# prompt tersembunyi, lalu pakai referensi variabel di header curl.
#
# Script ini TIDAK berisi secret apapun. Token GitHub, token bot, dan ID admin
# diminta lewat prompt saat instalasi, auth API dibuat acak, dan file .env
# dibuat dengan permission 600. Jangan pernah menempel token di log/chat.
set -euo pipefail

# B18: semua path di script ini absolut atau diturunkan dari direktori
# script sendiri — TIDAK PERNAH berasumsi direktori kerja pemanggil.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# B15: penanda versi (grep DARREN_INSTALLER_VERSION).
DARREN_INSTALLER_VERSION="fix-total-20261105-06"
# B22: SATU rilis resmi Xray-core yang dipin (terverifikasi ada di daftar
# rilis publik XTLS/Xray-core; bukan latest mengambang). Mengganti pin =
# ubah konstanta ini + README, lalu uji live ulang.
XRAY_TAG_PIN="v26.10.31"
# B9: kematian set -e harus menghasilkan verdict jelas, bukan diam.
trap 'echo "=== VERDICT: INSTALL GAGAL (perintah gagal; perbaiki pesan error di atas lalu jalankan ulang) ===" >&2' ERR

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
# Repo Darren saat ini PUBLIK; token baca hanya dibutuhkan bila repo
# sudah private (rencana migrasi). Clone butuh token baca read-only
# khusus repo Darren bila saat itu repo sudah private.
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

# B2/B24: helper backup fail-closed. Sumber yang ada WAJIB tersalin dan
# terverifikasi (ada + tidak kosong bila sumbernya tidak kosong); gagal =
# exit 1 SEBELUM penghapusan apa pun. TIDAK ada '|| true' di jalur ini.
# Direktori backup chmod 700; file secret di dalamnya chmod 600 (B20).
backup_item() {
  local src="$1" dest="$2" base
  [ -e "$src" ] || return 0
  cp -a "$src" "$dest/" || { echo "ERROR: backup $src gagal — penghapusan DIBATALKAN (instalasi lama TIDAK dihapus)." >&2; exit 1; }
  base="$(basename "$src")"
  if [ ! -e "$dest/$base" ]; then
    echo "ERROR: verifikasi backup $src gagal (tidak ditemukan di $dest) — penghapusan DIBATALKAN." >&2; exit 1
  fi
  if [ -d "$src" ] && [ -n "$(ls -A "$src" 2>/dev/null)" ] && [ -z "$(ls -A "$dest/$base" 2>/dev/null)" ]; then
    echo "ERROR: verifikasi backup $src gagal (backup kosong padahal sumber berisi) — penghapusan DIBATALKAN." >&2; exit 1
  fi
}
lock_backup_perms() {
  local bak="$1"
  chmod 700 "$bak" 2>/dev/null || true
  find "$bak" -type f \( -name '.env' -o -name 'auth.env' -o -name 'izin-token' -o -name '*.key' -o -name '*.pem' \) -exec chmod 600 {} + 2>/dev/null || true
}

# B8: kepala remote untuk cek kesegaran clone lama (token hanya via header
# sekali pakai, tidak pernah di URL maupun file).
git_remote_head() {
  if [ -n "${GH_TOKEN:-}" ]; then
    GIT_TERMINAL_PROMPT=0 git -c http.extraHeader="Authorization: Bearer $GH_TOKEN" ls-remote "$REPO_URL" HEAD 2>/dev/null | awk '{print $1}'
  else
    GIT_TERMINAL_PROMPT=0 git ls-remote "$REPO_URL" HEAD 2>/dev/null | awk '{print $1}'
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
  chmod 700 "$backup"
  # B1/B24/K23: backup mencakup bot-js (termasuk data/bot.db di dalamnya),
  # API + unit systemd + entry point menu + /etc/bot (akun) + file stack TLS.
  # Gagal di salah satu = backup_item exit 1, instalasi lama TIDAK dihapus.
  backup_item /root/bot-js "$backup"
  backup_item /etc/vpn-api "$backup"
  backup_item /etc/xray "$backup"
  backup_item /etc/systemd/system/xray.service.d "$backup"
  backup_item /etc/bot "$backup"
  backup_item /etc/haproxy "$backup"
  backup_item /root/vpn-api.py "$backup"
  backup_item /etc/nginx/conf.d/xray.conf "$backup"
  backup_item /usr/bin/speedtest "$backup"
  for _unit in vpn-api.service xray.service limitvmess.service limitvless.service limittrojan.service limitshadowsocks.service; do
    backup_item "/etc/systemd/system/$_unit" "$backup"
  done
  for _menu in menu cek-izin xray-restart; do
    backup_item "/usr/bin/$_menu" "$backup"
  done
  lock_backup_perms "$backup"
  # B24: verifikasi akhir langkah backup — direktori ada dan tidak kosong.
  if [ ! -d "$backup" ] || [ -z "$(ls -A "$backup" 2>/dev/null)" ]; then
    if [ -d /root/bot-js ] || [ -d /etc/xray ] || [ -f /root/vpn-api.py ]; then
      echo "ERROR: backup install total kosong padahal instalasi lama ada — penghapusan DIBATALKAN." >&2; exit 1
    fi
  fi
  echo "Backup terverifikasi di $backup (mode 700; file secret 600)."
  # Catatan jujur --total: backup TIDAK di-restore otomatis. Restore manual =
  # kembalikan file dari $backup lalu install ulang; akun Xray lama ada di
  # backup /etc/xray/config.json. Install biasa (bukan --total) justru
  # me-restore data/bot.db otomatis (langkah 4/6).

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
apt-get install -y ca-certificates curl gnupg unzip git python3 sqlite3 openssl haproxy nginx iproute2 at socat

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
    # Keyring NodeSource selamat dari uninstall (repo apt tidak dihapus) —
    # bila sudah ada dan tidak kosong, pakai lagi tanpa gpg.
    if [ ! -s /etc/apt/keyrings/nodesource.gpg ]; then
      # --batch: gpg tidak boleh menyentuh tty. Tanpa ini, install
      # non-interaktif (stdin pipe, tanpa terminal pengendali) mati
      # 'gpg: cannot open /dev/tty' tepat di langkah ini.
      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --batch --yes --dearmor -o /etc/apt/keyrings/nodesource.gpg || { echo "ERROR: gagal mengunduh/mengolah kunci NodeSource — BERHENTI." >&2; exit 1; }
    fi
    NODE_MAJOR=20
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get update -y
    apt-get install -y nodejs
  fi
  echo "Node: $(node -v)"
  npm install -g pm2
}
pasang_node_pm2

# ---------- 3. Ambil source (B18: path dari SCRIPT_DIR, bukan CWD) ----------
if [ -f "$SCRIPT_DIR/v4-main/bot-js/app.js" ]; then
  echo "Memakai source lokal di $SCRIPT_DIR/v4-main"
  # P0 2026-11-03: JANGAN rm -rf "$SRC_DIR" lalu cp dari ./v4-main bila
  # posisi jalan SUDAH di dalam SRC_DIR — itu menghapus sumbernya sendiri
  # (kegagalan rebuild server2). Bila sudah di dalam, tidak ada yang disalin.
  if [ "$(readlink -f "$SCRIPT_DIR")" = "$(readlink -f "$SRC_DIR")" ]; then
    echo "Sudah di dalam $SRC_DIR, penyalinan dilewati."
  else
    mkdir -p "$SRC_DIR"
    rm -rf "$SRC_DIR/v4-main"
    cp -a "$SCRIPT_DIR/v4-main" "$SRC_DIR/v4-main"
  fi
elif [ -d "$SRC_DIR/v4-main/bot-js" ]; then
  # B8: clone lama TIDAK dipakai ulang tanpa cek kesegaran. Tanpa .git =
  # kesegaran tidak dapat diverifikasi = clone ulang. HEAD lokal != HEAD
  # remote (atau remote tidak terjangkau) = clone ulang, bukan pakai buta.
  echo "Source lama ditemukan di $SRC_DIR — verifikasi kesegaran..."
  _local_head=""; _remote_head=""
  if [ -d "$SRC_DIR/.git" ]; then
    _local_head="$(git -C "$SRC_DIR" rev-parse HEAD 2>/dev/null || echo "")"
    _remote_head="$(git_remote_head)"
    echo "HEAD lokal: ${_local_head:-tidak-terbaca}; HEAD remote: ${_remote_head:-tidak-terjangkau}"
  else
    echo "Source lama tanpa .git — kesegaran tidak dapat diverifikasi."
  fi
  if [ -z "$_local_head" ] || [ -z "$_remote_head" ] || [ "$_local_head" != "$_remote_head" ]; then
    echo "Clone ulang source segar (clone lama dibuang)..."
    rm -rf "$SRC_DIR"
    git_clone_darren "$SRC_DIR"
    echo "HEAD source baru: $(git -C "$SRC_DIR" rev-parse HEAD 2>/dev/null || echo tidak-terbaca)"
  else
    echo "Source lama segar (HEAD sama dengan remote) — dipakai."
  fi
else
  echo "Meng-clone repo Darren..."
  rm -rf "$SRC_DIR"
  git_clone_darren "$SRC_DIR"
  echo "HEAD source baru: $(git -C "$SRC_DIR" rev-parse HEAD 2>/dev/null || echo tidak-terbaca)"
fi
# ---------- 5. Prompt konfigurasi (DIPINDAH ke sini, FASE 1) ----------
# Prompt-prompt ini DULU ada di langkah 5 (setelah penghapusan total),
# sehingga batal/EOF di prompt meninggalkan VPS telanjang. Sekarang semua
# ditanyakan SEBELUM penghapusan destruktif apa pun (langkah 3b).
echo ""
echo "Isi konfigurasi berikut. Kosongkan yang opsional bila belum ada."
read -r -p "Domain VPS kamu (contoh: vpn.contoh.com, kosong = localhost saja): " VPN_DOMAIN || true
if [ -n "$VPN_DOMAIN" ] && ! [[ "$VPN_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "PERINGATAN: domain '$VPN_DOMAIN' mengandung karakter tidak valid — diabaikan (domain kosong = localhost saja)."
  VPN_DOMAIN=""
fi
while true; do
  if ! read -r -s -p "BOT_TOKEN Telegram (dari BotFather, tidak akan tampil): " BOT_TOKEN; then
    echo ""
    if [ -z "$BOT_TOKEN" ]; then echo "ERROR: input berakhir (EOF) sebelum BOT_TOKEN diisi — jalankan installer secara interaktif, bukan lewat pipe tertutup." >&2; exit 1; fi
  fi
  echo ""
  if [ -z "$BOT_TOKEN" ]; then echo "BOT_TOKEN wajib diisi."; continue; fi
  # B7: format token BotFather = angka:token. Format lain ditolak di sini,
  # bukan lolos lalu gagal diam-diam saat bot start.
  if ! [[ "$BOT_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
    echo "BOT_TOKEN tidak sesuai format BotFather (angka:token) — isi ulang."
    BOT_TOKEN=""
    continue
  fi
  break
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
# K5/K6/K7/K8: prompt OPSIONAL (boleh kosong = fitur nonaktif, dicatat).
# Kredensial ini milik layanan pihak ketiga (bukan Darren): lisensi IP
# sewa (registry IP), Sidompul (cek kuota), HC (HTTP Custom), CloudFront
# (CDN). Bila diisi, disimpan ke .env bot (600); bila kosong, dilewati
# dengan catatan di output dan TIDAK menggagalkan install.
read -r -s -p "Token lisensi IP sewa (GH_IP_TOKEN, opsional, tidak akan tampil): " GH_IP_TOKEN || true
echo ""
if [ -n "${GH_IP_TOKEN:-}" ]; then
  read -r -p "Registry lisensi IP — owner repo (GH_IP_OWNER, opsional): " GH_IP_OWNER || true
  read -r -p "Registry lisensi IP — nama repo (GH_IP_REPO, opsional): " GH_IP_REPO || true
  read -r -p "Registry lisensi IP — nama file (GH_IP_FILE, opsional): " GH_IP_FILE || true
else
  GH_IP_OWNER=""; GH_IP_REPO=""; GH_IP_FILE=""
  echo "Lisensi IP sewa dilewati (kosong) — fitur sewa berbasis registry IP nonaktif."
fi
read -r -s -p "SIDOMPUL_API_KEY cek kuota (opsional, tidak akan tampil): " SIDOMPUL_API_KEY || true
echo ""
[ -z "${SIDOMPUL_API_KEY:-}" ] && echo "Sidompul dilewati (kosong) — cek kuota nonaktif."
read -r -s -p "HC_API_KEY (opsional, tidak akan tampil): " HC_API_KEY || true
echo ""
[ -z "${HC_API_KEY:-}" ] && echo "HC dilewati (kosong) — fitur HC nonaktif."
read -r -p "CloudFront domain (CF_DOMAIN, opsional): " CF_DOMAIN || true
if [ -n "${CF_DOMAIN:-}" ]; then
  read -r -s -p "CloudFront VMess UUID (opsional, tidak akan tampil): " CF_VMESS_UUID || true
  echo ""
  read -r -s -p "CloudFront VLESS UUID (opsional, tidak akan tampil): " CF_VLESS_UUID || true
  echo ""
  read -r -s -p "CloudFront Trojan password (opsional, tidak akan tampil): " CF_TROJAN_PASSWORD || true
  echo ""
else
  CF_VMESS_UUID=""; CF_VLESS_UUID=""; CF_TROJAN_PASSWORD=""
  echo "CloudFront dilewati (kosong) — jalur CloudFront nonaktif."
fi
read -r -p "Digiflazz username (opsional): " DIGI_USER || true
if [ -n "$DIGI_USER" ]; then
  read -r -s -p "Digiflazz API key (opsional, tidak akan tampil): " DIGI_KEY || true
  echo ""
else
  DIGI_KEY=""
fi
# Pilihan Xray juga ditanya di sini (dulu di langkah 9); langkah 9 hanya
# memakai variabel ini, tidak bertanya lagi.
# B5: konsekuensi jawaban N disebut eksplisit di prompt, bukan tersembunyi.
echo "PERINGATAN: menjawab N berarti Xray TIDAK diinstal. Karena Xray wajib"
echo "jalan setelah install, verifikasi akhir akan GAGAL dan install"
echo "dinyatakan GAGAL (VPN lewat domain tidak jalan) — pilih N hanya bila"
echo "kamu sengaja ingin install gagal di verifikasi / pasang Xray manual."
read -r -p "Instal Xray? [Y/n, kosong = YA; N = verifikasi akhir GAGAL] " install_xray || true

# B4: randomisasi fail-closed — gagal mengacak = BERHENTI dengan peringatan
# keras, TIDAK PERNAH memakai nilai contoh publik sebagai fallback.
VPN_API_AUTH="$(openssl rand -hex 24)" || { echo "ERROR: gagal mengacak VPN_API_AUTH (openssl gagal) — BERHENTI, tidak memakai nilai contoh." >&2; exit 1; }
[ -n "$VPN_API_AUTH" ] || { echo "ERROR: VPN_API_AUTH kosong setelah randomisasi — BERHENTI, tidak memakai nilai contoh." >&2; exit 1; }
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

# ---------- 4. Backup instalasi lama (bila ada) — B1/B24 ----------
# B1: install biasa TIDAK boleh menghapus data/bot.db diam-diam. Backup ini
# diverifikasi (ada + berisi data/bot.db bila sumbernya punya), lalu
# langkah 6 me-restore data/ dari backup ini. Jalur --total TIDAK memakai
# restore otomatis ini (backup --total hanya untuk restore manual).
STEP4_BAK=""
if [ -d "$BOT_DIR" ]; then
  bak="/root/bot-js.bak-$(date +%Y%m%d-%H%M%S)"
  echo "Backup bot lama ke $bak"
  cp -a "$BOT_DIR" "$bak" || { echo "ERROR: backup bot lama gagal — BERHENTI sebelum penghapusan." >&2; exit 1; }
  chmod 700 "$bak" 2>/dev/null || true
  find "$bak" -type f \( -name '.env' -o -name '*.db' \) -exec chmod 600 {} + 2>/dev/null || true
  if [ ! -d "$bak" ] || [ -z "$(ls -A "$bak" 2>/dev/null)" ]; then
    echo "ERROR: verifikasi backup bot lama gagal (backup kosong) — BERHENTI sebelum penghapusan." >&2; exit 1
  fi
  if [ -f "$BOT_DIR/data/bot.db" ] && [ ! -f "$bak/data/bot.db" ]; then
    echo "ERROR: verifikasi backup gagal — data/bot.db tidak ikut tersalin — BERHENTI sebelum penghapusan." >&2; exit 1
  fi
  STEP4_BAK="$bak"
  echo "Backup terverifikasi: $STEP4_BAK (data/bot.db akan di-restore di langkah 6)."
fi

# ---------- 5. Prompt konfigurasi (SUDAH DIPINDAH, FASE 1) ----------
# Blok prompt (domain, BOT_TOKEN, ADMIN_ID, H2H, Digiflazz, pilihan Xray)
# dipindah ke sebelum langkah 3b supaya pembatalan/EOF di prompt tidak
# meninggalkan VPS telanjang. Variabelnya (VPN_DOMAIN, BOT_TOKEN, ADMIN_ID,
# H2H_URL, H2H_KEY, DIGI_USER, DIGI_KEY, install_xray, VPN_API_AUTH,
# VPN_API_BASE) sudah terisi di sana dan dipakai langkah 6-9 di bawah.

# ---------- 6. Salin bot + API ----------
# FASE 2: cadangkan .env lama SEBELUM rm -rf (salinan baru dari repo
# tidak berisi .env, jadi pemeriksaan .env sesudah rm selalu gagal dan
# cabang "jangan timpa" lama praktis mati).
OLD_ENV_TMP=""
if [ -f "$BOT_DIR/.env" ]; then
  OLD_ENV_TMP="$(mktemp)"
  cp -a "$BOT_DIR/.env" "$OLD_ENV_TMP" 2>/dev/null || OLD_ENV_TMP=""
fi
rm -rf "$BOT_DIR"
cp -a "$SRC_DIR/v4-main/bot-js" "$BOT_DIR"
cp "$SRC_DIR/v4-main/Api/vpn-api.py" "$API_FILE"

# .env: jangan timpa .env lama tanpa konfirmasi. Cadangan dibuat SEBELUM
# rm -rf di atas. Bila dipertahankan, auth API disamakan dengan .env lama
# supaya bot dan API tidak mismatch (peringatan teks saja tidak cukup).
if [ -n "$OLD_ENV_TMP" ]; then
  read -r -p ".env lama ditemukan. Timpa dengan konfigurasi baru? [y/N] " overwrite || true
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    cp -a "$OLD_ENV_TMP" "$BOT_DIR/.env"
    chmod 600 "$BOT_DIR/.env"
    echo "Memakai .env lama (dipulihkan dari cadangan sebelum hapus)."
    OLD_AUTH="$(grep '^VPN_API_AUTH=' "$BOT_DIR/.env" | head -1 | cut -d= -f2-)"
    if [ -n "$OLD_AUTH" ]; then
      VPN_API_AUTH="$OLD_AUTH"
    else
      echo "VPN_API_AUTH=$VPN_API_AUTH" >> "$BOT_DIR/.env"
    fi
    # B6: nilai prompt baru TIDAK boleh dibuang diam-diam oleh .env lama.
    # Domain DISELARASKAN (bukan dibuang): bila prompt domain diisi, tulis
    # ke .env lama supaya bot dan /etc/xray/domain konsisten. Nilai prompt
    # lain yang DIABAIKAN disebut eksplisit di sini.
    if [ -n "$VPN_DOMAIN" ]; then
      if grep -q '^VPN_DOMAIN=' "$BOT_DIR/.env"; then
        sed -i "s|^VPN_DOMAIN=.*|VPN_DOMAIN=$VPN_DOMAIN|" "$BOT_DIR/.env"
      else
        echo "VPN_DOMAIN=$VPN_DOMAIN" >> "$BOT_DIR/.env"
      fi
      echo "Domain diselaraskan ke nilai prompt baru: $VPN_DOMAIN (bot .env = /etc/xray/domain)."
    else
      echo "Prompt domain kosong — domain .env lama dipertahankan; /etc/xray/domain akan mengikuti .env lama."
    fi
    echo "PERINGATAN: karena .env lama dipertahankan, nilai prompt baru berikut DIABAIKAN (bukan dipakai):"
    echo "  BOT_TOKEN, ADMIN_ID, H2H_URL/H2H_KEY, Digiflazz, lisensi IP sewa, SIDOMPUL_API_KEY, HC_API_KEY, CloudFront."
    echo "  Untuk memakai nilai baru itu, jalankan ulang dengan jawaban timpa .env = y."
  fi
  rm -f "$OLD_ENV_TMP"
fi
# B1 (lanjut): restore data bot dari backup langkah 4 (install biasa saja).
if [ -n "${STEP4_BAK:-}" ] && [ -d "$STEP4_BAK/data" ]; then
  mkdir -p "$BOT_DIR/data"
  cp -a "$STEP4_BAK/data/." "$BOT_DIR/data/" || { echo "ERROR: restore data/bot.db gagal — BERHENTI." >&2; exit 1; }
  [ -f "$BOT_DIR/data/bot.db" ] && echo "data/bot.db di-restore dari $STEP4_BAK (saldo/akun bot dipertahankan)."
fi
# Domain efektif = isi .env yang benar-benar dipakai (bukan mentah prompt),
# supaya gate akhir membandingkan bot .env vs /etc/xray/domain secara jujur.
# .env baru belum ditulis saat baris ini jalan (install segar tanpa .env
# lama) — grep yang gagal harus jatuh ke fallback prompt di bawah, bukan
# mati kena trap ERR lewat pipefail.
EFFECTIVE_DOMAIN="$(grep '^VPN_DOMAIN=' "$BOT_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
[ -n "${EFFECTIVE_DOMAIN:-}" ] || EFFECTIVE_DOMAIN="$VPN_DOMAIN"

if [ ! -f "$BOT_DIR/.env" ]; then
  # B7 lapis kedua: tidak ada jalur yang menulis .env dengan token kosong.
  [ -n "${BOT_TOKEN:-}" ] || { echo "ERROR: BOT_TOKEN kosong — .env TIDAK ditulis, install BERHENTI." >&2; exit 1; }
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
GH_IP_TOKEN=$GH_IP_TOKEN
GH_IP_OWNER=$GH_IP_OWNER
GH_IP_REPO=$GH_IP_REPO
GH_IP_FILE=$GH_IP_FILE
SIDOMPUL_API_KEY=$SIDOMPUL_API_KEY
HC_API_KEY=$HC_API_KEY
CF_DOMAIN=$CF_DOMAIN
CF_VMESS_UUID=$CF_VMESS_UUID
CF_VLESS_UUID=$CF_VLESS_UUID
CF_TROJAN_PASSWORD=$CF_TROJAN_PASSWORD
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
# B11: pm2 save/startup adalah gating — gagal = verdict gagal di verifikasi,
# bukan peringatan yang bisa lewat begitu saja.
PM2_SAVE_FAIL=0
PM2_STARTUP_FAIL=0
pm2 save || PM2_SAVE_FAIL=1
if ! pm2 startup systemd -u root --hp /root 2>/dev/null; then
  PM2_STARTUP_FAIL=1
  echo "PERINGATAN: pm2 startup gagal — verifikasi akhir akan menggagalkan install." >&2
fi

# ---------- 9. Xray (wajib jalan; default YA) ----------
# Pilihan install_xray sudah ditanya sebelum langkah 3b (FASE 1); di sini
# hanya dipakai, tidak ditanya lagi.
if [[ ! "$install_xray" =~ ^[Nn] ]]; then
  # B22: Xray dipin ke SATU rilis resmi (XRAY_TAG_PIN), bukan latest mengambang.
  echo "Menginstal Xray rilis resmi yang dipin: $XRAY_TAG_PIN ..."
  tag="$XRAY_TAG_PIN"
  if [ -z "$tag" ]; then
    echo "ERROR: pin Xray kosong — instalasi Xray dibatalkan; verifikasi akhir akan menggagalkan install." >&2
  else
    cd /tmp
    # FASE 2: petakan arsitektur ke aset rilis Xray (selain itu gagal eksplisit).
    case "$(uname -m)" in
      x86_64) XRAY_ZIP="Xray-linux-64.zip" ;;
      aarch64|arm64) XRAY_ZIP="Xray-linux-arm64-v8a.zip" ;;
      *) echo "Arsitektur $(uname -m) tidak didukung untuk unduhan Xray; instalasi Xray dilewati." >&2; XRAY_ZIP="" ;;
    esac
    # FASE 2: unduh + verifikasi digest SHA256 dari rilis (B10: digest tidak
    # tersedia / tak terparse = BERHENTI tanpa verifikasi; digest TIDAK
    # COCOK = berkas dibuang, Xray batal).
    XRAY_OK=0
    if [ -n "$XRAY_ZIP" ] && curl -fsSL --retry 3 -o xray.zip "https://github.com/XTLS/Xray-core/releases/download/${tag}/${XRAY_ZIP}"; then
      if curl -fsSL --retry 3 -o xray.zip.dgst "https://github.com/XTLS/Xray-core/releases/download/${tag}/${XRAY_ZIP}.dgst" 2>/dev/null; then
        # Format .dgst Xray yang sebenarnya memakai label 'SHA2-256=',
        # bukan 'SHA256' — grep lama tidak pernah cocok, dan dengan
        # pipefail kegagalan grep itu memicu trap ERR (installer mati
        # diam-diam). '|| true' membuat parse yang gagal mengalir ke
        # jalur ERROR eksplisit di bawah, bukan ke trap.
        DGST="$(grep -i 'SHA2-256' xray.zip.dgst 2>/dev/null | grep -oE '[0-9a-fA-F]{64}' | head -1 || true)"
        if [ -z "$DGST" ]; then
          DGST="$(grep -i 'SHA256' xray.zip.dgst 2>/dev/null | grep -oE '[0-9a-fA-F]{64}' | head -1 || true)"
        fi
        ACTUAL="$(sha256sum xray.zip 2>/dev/null | awk '{print $1}' || true)"
        if [ -n "$DGST" ] && [ -n "$ACTUAL" ]; then
          if [ "$DGST" = "$ACTUAL" ]; then
            XRAY_OK=1
          else
            echo "Digest SHA256 xray.zip TIDAK COCOK dengan rilis; berkas dibuang, instalasi Xray dibatalkan." >&2
            rm -f xray.zip
          fi
        else
          # B10: digest tak terparse = BERHENTI tanpa verifikasi, bukan lanjut.
          echo "ERROR: digest rilis tidak dapat diparse — BERHENTI tanpa verifikasi SHA256; berkas dibuang, Xray batal." >&2
          rm -f xray.zip
          XRAY_OK=0
        fi
      else
        # B10: digest tidak tersedia = BERHENTI, bukan lanjut dengan peringatan.
        echo "ERROR: file digest rilis tidak tersedia — BERHENTI tanpa verifikasi SHA256; berkas dibuang, Xray batal." >&2
        rm -f xray.zip
        XRAY_OK=0
      fi
    fi
    if [ "$XRAY_OK" = 1 ]; then
      unzip -o xray.zip -d /tmp/xray-bin
      install -m 755 /tmp/xray-bin/xray /usr/local/bin/xray
      # FASE 1: template config memakai aturan geoip/geosite — dat file
      # lengkap wajib ada, kalau tidak gate run -test di bawah pasti gagal.
      mkdir -p /usr/local/share/xray
      DAT_FAIL=0
      if ! curl -fsSL --retry 3 -o /usr/local/share/xray/geoip.dat "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat"; then DAT_FAIL=1; fi
      if ! curl -fsSL --retry 3 -o /usr/local/share/xray/geosite.dat "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat"; then DAT_FAIL=1; fi
      # B23: cek dat bukan ukuran saja — kedua file harus ADA, ukuran di
      # atas ambang, DAN bertipe data biner yang wajar (cek 'file' bila ada).
      for _dat in geoip.dat geosite.dat; do
        if [ ! -f "/usr/local/share/xray/$_dat" ]; then
          echo "ERROR: /usr/local/share/xray/$_dat hilang." >&2; DAT_FAIL=1; continue
        fi
        _sz="$(stat -c%s "/usr/local/share/xray/$_dat" 2>/dev/null || echo 0)"
        if [ "$_sz" -lt 1048576 ]; then echo "ERROR: $_dat terlalu kecil ($_sz byte)." >&2; DAT_FAIL=1; fi
        if command -v file >/dev/null 2>&1; then
          _ft="$(file -b "/usr/local/share/xray/$_dat" 2>/dev/null || echo "")"
          case "$_ft" in
            *data*|*Binary*) : ;;
            *) echo "ERROR: $_dat bertipe tidak wajar untuk geo-dat: $_ft." >&2; DAT_FAIL=1 ;;
          esac
        fi
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
        # B4: gagal mengacak = BERHENTI dengan peringatan keras; kredensial
        # contoh publik TIDAK PERNAH dibiarkan hidup di config terpasang.
        for _oldid in $(grep -o '"id": "[^"]*"' /etc/xray/config.json | sed 's/"id": "//; s/"//' | sort -u); do
          _newid="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "")"
          if [ -z "$_newid" ]; then echo "ERROR: gagal mengacak UUID Xray — BERHENTI, kredensial contoh TIDAK dipakai." >&2; exit 1; fi
          sed -i "s|\"id\": \"$_oldid\"|\"id\": \"$_newid\"|g" /etc/xray/config.json
        done
        for _oldpw in $(grep -o '"password": "[^"]*"' /etc/xray/config.json | sed 's/"password": "//; s/"//' | sort -u); do
          _newpw="$(openssl rand -hex 16 2>/dev/null || echo "")"
          if [ -z "$_newpw" ]; then echo "ERROR: gagal mengacak password Xray — BERHENTI, kredensial contoh TIDAK dipakai." >&2; exit 1; fi
          sed -i "s|\"password\": \"$_oldpw\"|\"password\": \"$_newpw\"|g" /etc/xray/config.json
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
      echo "Xray tidak terunduh atau tidak lolos verifikasi digest (aset release bisa sedang ditarik/diperbarui, jaringan sesaat, atau digest tidak cocok). Instalasi Xray dilewati; verifikasi akhir akan menggagalkan install." >&2
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
  # B6: domain file mengikuti domain EFEKTIF (.env yang dipakai), bukan
  # mentah prompt — bot dan menu konsisten.
  if [ -n "${EFFECTIVE_DOMAIN:-}" ]; then
    echo "$EFFECTIVE_DOMAIN" > /etc/xray/domain
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
# ---------- 10b. Stack TLS: haproxy + nginx + /var/www/html + speedtest ----------
# K1a/K16: apt haproxy+nginx sudah di langkah 1. File Cfg repo disalin ke
# lokasi sistem yang benar: haproxy.cfg -> /etc/haproxy/haproxy.cfg,
# nginx.conf (konfig utama) -> /etc/nginx/nginx.conf,
# xray.conf (server blocks) -> /etc/nginx/conf.d/xray.conf (di-include
# nginx.conf). nginx :81 melayani /var/www/html; haproxy :443 meneruskan
# ke backend nginx (ws_backend 127.0.0.1:1010). Sertifikat LE via acme.sh
# RESMI; bila DNS belum mengarah / port 80 sibuk / unduhan acme gagal,
# installer TIDAK gagal total — stack terpasang, status "TLS pending"
# dilaporkan jelas + langkah manual change-domain (lihat README bagian
# "Pasca-install (wajib)"), dan gate membedakan dua verdict terpisah.
TLS_STATUS="pending"
TLS_REASON="belum diproses"
mkdir -p /var/www/html
if [ -f "$SRC_DIR/v4-main/Cfg/haproxy.cfg" ]; then
  if [ -f /etc/haproxy/haproxy.cfg ] && ! cmp -s "$SRC_DIR/v4-main/Cfg/haproxy.cfg" /etc/haproxy/haproxy.cfg; then
    cp -a /etc/haproxy/haproxy.cfg "/root/haproxy.cfg.bak-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || echo "PERINGATAN: backup haproxy.cfg lama gagal." >&2
  fi
  cp -a "$SRC_DIR/v4-main/Cfg/haproxy.cfg" /etc/haproxy/haproxy.cfg
  echo "haproxy.cfg repo disalin ke /etc/haproxy/haproxy.cfg (tanpa backend dropbear — K10)."
else
  echo "PERINGATAN: Cfg/haproxy.cfg tidak ditemukan di repo — stack TLS tidak lengkap." >&2
  TLS_REASON="Cfg/haproxy.cfg tidak ada di repo"
fi
if [ -f "$SRC_DIR/v4-main/Cfg/nginx.conf" ]; then
  cp -a "$SRC_DIR/v4-main/Cfg/nginx.conf" /etc/nginx/nginx.conf
fi
if [ -f "$SRC_DIR/v4-main/Cfg/xray.conf" ]; then
  cp -a "$SRC_DIR/v4-main/Cfg/xray.conf" /etc/nginx/conf.d/xray.conf
  # K16: server :81 memakai sertifikat LE bila ada; bila belum ada,
  # hapus baris ssl-nya supaya nginx -t lolos dengan HTTP polos :81.
  if [ -f /etc/xray/xray.crt ] && [ -f /etc/xray/xray.key ]; then
    echo "Sertifikat /etc/xray/xray.crt+.key sudah ada — server :81 memakai TLS."
  else
    sed -i 's/^    listen 81 ssl http2 reuseport;/    listen 81 reuseport;/' /etc/nginx/conf.d/xray.conf
    sed -i '/^    ssl_certificate/d; /^    ssl_ciphers/d; /^    ssl_protocols/d' /etc/nginx/conf.d/xray.conf
    echo "Sertifikat LE belum ada — server :81 berjalan HTTP polos (TLS pending)."
  fi
  if [ -n "${EFFECTIVE_DOMAIN:-}" ]; then
    sed -i "s/server_name xxx;/server_name $EFFECTIVE_DOMAIN;/g" /etc/nginx/conf.d/xray.conf
  fi
fi
if nginx -t 2>/dev/null; then
  systemctl enable nginx 2>/dev/null || true
  systemctl restart nginx 2>/dev/null || systemctl start nginx 2>/dev/null || echo "PERINGATAN: nginx gagal start — gate akan menandainya." >&2
  echo "OK: nginx config lolos (nginx -t) dan :81 melayani /var/www/html."
else
  echo "PERINGATAN: nginx -t GAGAL — perbaiki /etc/nginx/nginx.conf + /etc/nginx/conf.d/xray.conf lalu: nginx -t && systemctl restart nginx." >&2
  TLS_REASON="nginx -t gagal"
fi
# Sertifikat LE (acme.sh resmi) — hanya bila domain terisi, port 80 bebas,
# dan belum ada hap.pem yang valid. Gagal di sini = TLS pending, BUKAN gagal total.
if [ -f /etc/haproxy/hap.pem ] && haproxy -c -f /etc/haproxy/haproxy.cfg >/dev/null 2>&1; then
  TLS_STATUS="ready"; TLS_REASON="hap.pem sudah ada + haproxy -c lolos"
  # BUG: cabang ini dulu tidak pernah men-start haproxy (enable/start hanya
  # ada di cabang LE baru) — hap.pem yang selamat dari uninstall membuat
  # installer selalu lewat sini, lalu gate gagal "haproxy tidak aktif".
  systemctl enable haproxy 2>/dev/null || true
  systemctl restart haproxy 2>/dev/null || systemctl start haproxy 2>/dev/null || echo "PERINGATAN: haproxy gagal start — gate akan menandainya." >&2
elif [ -n "${EFFECTIVE_DOMAIN:-}" ] && ! ss -ltn 2>/dev/null | grep -q ':80 '; then
  echo "Mencoba sertifikat LE untuk $EFFECTIVE_DOMAIN via acme.sh resmi (gagal = TLS pending, bukan gagal total)..."
  if [ ! -d "$HOME/.acme.sh" ]; then
    rm -f /tmp/acme-install.sh
    curl -fsSL --retry 2 -o /tmp/acme-install.sh "https://raw.githubusercontent.com/acmesh-official/acme.sh/master/acme.sh" 2>/dev/null || echo "Unduhan acme.sh gagal — TLS pending." >&2
    # Catatan: acme.sh resmi dijalankan dari salinan resminya; bila unduhan
    # di atas gagal/ragu, LEWATI langkah ini dan lanjut sebagai TLS pending.
    if [ -s /tmp/acme-install.sh ]; then
      sh /tmp/acme-install.sh --install 2>/dev/null || echo "Instalasi acme.sh gagal — TLS pending." >&2
      rm -f /tmp/acme-install.sh
    fi
  fi
  if [ -x "$HOME/.acme.sh/acme.sh" ]; then
    "$HOME/.acme.sh/acme.sh" --issue -d "$EFFECTIVE_DOMAIN" --webroot /var/www/html 2>/dev/null || echo "Penerbitan LE gagal (DNS belum mengarah / validasi gagal) — TLS pending." >&2
    if [ -f "$HOME/.acme.sh/$EFFECTIVE_DOMAIN/fullchain.cer" ] && [ -f "$HOME/.acme.sh/$EFFECTIVE_DOMAIN/$EFFECTIVE_DOMAIN.key" ]; then
      cat "$HOME/.acme.sh/$EFFECTIVE_DOMAIN/fullchain.cer" "$HOME/.acme.sh/$EFFECTIVE_DOMAIN/$EFFECTIVE_DOMAIN.key" > /etc/haproxy/hap.pem
      chmod 600 /etc/haproxy/hap.pem
      cp -a "$HOME/.acme.sh/$EFFECTIVE_DOMAIN/fullchain.cer" /etc/xray/xray.crt 2>/dev/null || true
      cp -a "$HOME/.acme.sh/$EFFECTIVE_DOMAIN/$EFFECTIVE_DOMAIN.key" /etc/xray/xray.key 2>/dev/null || true
      chmod 600 /etc/xray/xray.crt /etc/xray/xray.key 2>/dev/null || true
    fi
  fi
  if [ -f /etc/haproxy/hap.pem ] && haproxy -c -f /etc/haproxy/haproxy.cfg >/dev/null 2>&1; then
    systemctl enable haproxy 2>/dev/null || true
    systemctl restart haproxy 2>/dev/null || systemctl start haproxy 2>/dev/null || echo "PERINGATAN: haproxy gagal start." >&2
    TLS_STATUS="ready"; TLS_REASON="sertifikat LE terbit + haproxy -c lolos"
  else
    TLS_REASON="sertifikat LE belum tersedia (DNS/port 80/acme) — jalankan change-domain manual"
  fi
else
  if [ -z "${EFFECTIVE_DOMAIN:-}" ]; then TLS_REASON="domain kosong — isi domain lalu change-domain manual";
  elif ss -ltn 2>/dev/null | grep -q ':80 '; then TLS_REASON="port 80 sibuk — bebaskan port 80 lalu change-domain manual"; fi
fi
echo "STATUS TLS: $TLS_STATUS ($TLS_REASON)"
# K12: salin speedtest dari repo ke /usr/bin bila ada di repo.
if [ -f "$SRC_DIR/v4-main/Cdy/speedtest" ]; then
  install -m 755 "$SRC_DIR/v4-main/Cdy/speedtest" /usr/bin/speedtest && echo "speedtest terpasang ke /usr/bin/speedtest."
else
  echo "PERINGATAN: Cdy/speedtest tidak ada di repo — speedtest dilewati." >&2
fi

# ---------- 10c. SSH-WS stack: ws + tun.conf + ws.service + ws-bridge ----------
# nginx :1010 meneruskan jalur SSH-WS (catch-all -> /newbiestoressh) ke
# ws-bridge 127.0.0.1:10018 (bukan lagi ws :10015). ws-bridge membalas
# upgrade WS dengan 101 LENGKAP (Upgrade + Sec-WebSocket-Accept yang benar,
# RFC6455) lalu menjembatani byte mentah ke ws-shield :10017. Tanpa bridge,
# biner ws membalas 101 KOSONG (tanpa header) dan klien WS ketat (HTTP
# Custom mode SSL 443) menutup koneksi tepat sesudah 101. ws :10015 tetap
# terpasang (OVPN :10012 masih memakainya); tanpa stack ini, SSH lewat
# port 80/443 SELALU 502 (upstream connection refused) walau haproxy/nginx/
# Xray sehat — inilah yang hilang pada install segar 2026-11-04.
# Target bridge = perisai payload ws-shield :10017 (bukan sshd :22 langsung):
# HTTP Custom (bug host + payload enhanced + auto replace) menyisipkan byte
# HTTP ke aliran SSH; ws-shield membuang semua byte klien sampai banner
# "SSH-2.0-" ditemukan, baru meneruskan ke sshd :22. Tanpa shield, config
# bug host selalu gagal "Illegal packet size" / "invalid format" di sshd.
if [ -f "$SRC_DIR/v4-main/Fls/ws" ] && [ -f "$SRC_DIR/v4-main/Cfg/tun.conf" ] && [ -f "$SRC_DIR/v4-main/Fls/ws.service" ]; then
  install -m 755 "$SRC_DIR/v4-main/Fls/ws" /usr/bin/ws
  cp -a "$SRC_DIR/v4-main/Cfg/tun.conf" /usr/bin/tun.conf
  cp -a "$SRC_DIR/v4-main/Fls/ws.service" /etc/systemd/system/ws.service
  if [ -f "$SRC_DIR/v4-main/Cfg/ws-shield.py" ] && [ -f "$SRC_DIR/v4-main/Cfg/ws-shield.service" ]; then
    install -m 755 "$SRC_DIR/v4-main/Cfg/ws-shield.py" /usr/local/bin/ws-shield.py
    cp -a "$SRC_DIR/v4-main/Cfg/ws-shield.service" /etc/systemd/system/ws-shield.service
    systemctl daemon-reload 2>/dev/null || true
    systemctl enable ws-shield 2>/dev/null || true
    systemctl restart ws-shield 2>/dev/null || systemctl start ws-shield 2>/dev/null || echo "PERINGATAN: ws-shield gagal start — SSH config bug host akan gagal invalid format." >&2
  else
    echo "PERINGATAN: Cfg/ws-shield.py atau Cfg/ws-shield.service tidak ada di repo — tun.conf mengarah ke :10017 yang kosong, SSH lewat 80/443 akan gagal." >&2
  fi
  if [ -f "$SRC_DIR/v4-main/Cfg/ws-bridge.py" ] && [ -f "$SRC_DIR/v4-main/Cfg/ws-bridge.service" ]; then
    install -m 755 "$SRC_DIR/v4-main/Cfg/ws-bridge.py" /usr/local/bin/ws-bridge.py
    cp -a "$SRC_DIR/v4-main/Cfg/ws-bridge.service" /etc/systemd/system/ws-bridge.service
    systemctl daemon-reload 2>/dev/null || true
    systemctl enable ws-bridge 2>/dev/null || true
    systemctl restart ws-bridge 2>/dev/null || systemctl start ws-bridge 2>/dev/null || echo "PERINGATAN: ws-bridge gagal start — handshake WS mode SSL 443 akan ditolak klien ketat (101 tanpa Sec-WebSocket-Accept)." >&2
  else
    echo "PERINGATAN: Cfg/ws-bridge.py atau Cfg/ws-bridge.service tidak ada di repo — nginx mengarah ke :10018 yang kosong, SSH lewat 80/443 akan 502." >&2
  fi
  systemctl daemon-reload 2>/dev/null || true
  systemctl enable ws 2>/dev/null || true
  systemctl restart ws 2>/dev/null || systemctl start ws 2>/dev/null || echo "PERINGATAN: ws gagal start — SSH lewat 80/443 akan 502." >&2
  if ss -ltn 2>/dev/null | grep -q ':10015 '; then echo "OK: ws mendengarkan :10015 (SSH lewat 80/443 hidup)."; else echo "PERINGATAN: :10015 tidak mendengarkan — cek systemctl status ws." >&2; fi
  if ss -ltn 2>/dev/null | grep -q ':10017 '; then echo "OK: ws-shield mendengarkan :10017 (perisai payload hidup)."; else echo "PERINGATAN: :10017 tidak mendengarkan — cek systemctl status ws-shield." >&2; fi
  if ss -ltn 2>/dev/null | grep -q ':10018 '; then echo "OK: ws-bridge mendengarkan :10018 (handshake WS RFC6455 hidup)."; else echo "PERINGATAN: :10018 tidak mendengarkan — cek systemctl status ws-bridge." >&2; fi
else
  echo "PERINGATAN: Fls/ws, Cfg/tun.conf, atau Fls/ws.service tidak ada di repo — SSH lewat 80/443 tidak terpasang." >&2
fi

# FASE 2: pasang unit + script limit dari repo LOKAL (Fls) — tanpa unduh
# eksternal. Pemetaan sesuai Fls/limit.sh bawaan repo (hanya pemetaan
# berkasnya yang dipakai; logika unduh eksternal script itu TIDAK dipakai):
# Fls/*.service -> /etc/systemd/system/, Fls/vmess|vless|trojan|shadowsocks
# -> /etc/xray/limit.vmess|vless|trojan|shadowsocks. Unit TIDAK di-enable
# di sini; limit-on-off yang mengaktifkan/menonaktifkan.
if [ -d "$SRC_DIR/v4-main/Fls" ]; then
  mkdir -p /etc/xray
  for _svc in limitvmess limitvless limittrojan limitshadowsocks; do
    if [ -f "$SRC_DIR/v4-main/Fls/$_svc.service" ]; then
      cp -a "$SRC_DIR/v4-main/Fls/$_svc.service" /etc/systemd/system/ 2>/dev/null || echo "PERINGATAN: gagal memasang $_svc.service." >&2
    fi
  done
  for _pair in "vmess:limit.vmess" "vless:limit.vless" "trojan:limit.trojan" "shadowsocks:limit.shadowsocks"; do
    _src="${_pair%%:*}"; _dst="${_pair##*:}"
    if [ -f "$SRC_DIR/v4-main/Fls/$_src" ]; then
      cp -a "$SRC_DIR/v4-main/Fls/$_src" "/etc/xray/$_dst" 2>/dev/null && chmod +x "/etc/xray/$_dst" || echo "PERINGATAN: gagal memasang $_dst." >&2
    fi
  done
  systemctl daemon-reload 2>/dev/null || true
  echo "Unit + script limit terpasang dari repo lokal (belum di-enable; atur via limit-on-off)."
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

# ---------- 10c. Cron harian xp (K18) ----------
# xp sudah diperiksa: tidak meminta input apa pun, dan mendukung flag
# --yes/--non-interactive sebagai penanda aman. Karena itu aman dipasang
# sebagai cron harian (pembersih akun kedaluwarsa). Bila /usr/bin/xp tidak
# ada, cron tidak dipasang dan gate di bawah tidak menggagalkannya — xp
# manual tetap tersedia lewat menu.
if [ -x /usr/bin/xp ]; then
  printf '%s\n' '0 3 * * * root /usr/bin/xp --yes >/var/log/darren-xp.log 2>&1' > /etc/cron.d/darren-xp
  chmod 600 /etc/cron.d/darren-xp
  echo "Cron harian xp terpasang (/etc/cron.d/darren-xp, tiap 03:00)."
else
  echo "PERINGATAN: /usr/bin/xp tidak ditemukan — cron harian xp TIDAK dipasang." >&2
fi

# ---------- 11. Verifikasi (HARUS lolos semua; bila ada yang gagal, install GAGAL) ----------
echo ""
echo "=== Verifikasi ==="
# ---------- 10d. OpenVPN: server TCP 1194 + UDP 2200, PKI baru ----------
echo "=== Langkah 10d: OpenVPN (TCP 1194 + UDP 2200, PKI baru) ==="
export DEBIAN_FRONTEND=noninteractive
apt-get install -y openvpn easy-rsa iptables || { echo "ERROR: apt openvpn gagal." >&2; exit 1; }
PLUGIN_OVPN=$(ls /usr/lib/x86_64-linux-gnu/openvpn/plugins/openvpn-plugin-auth-pam.so 2>/dev/null | head -1)
if [ -z "$PLUGIN_OVPN" ]; then PLUGIN_OVPN=$(find /usr/lib -name openvpn-plugin-auth-pam.so 2>/dev/null | head -1); fi
if [ -z "$PLUGIN_OVPN" ]; then echo "ERROR: plugin auth-pam OpenVPN tidak ditemukan." >&2; exit 1; fi
SRC_CFG=""
for cand in "$PWD/v4-main/Cfg" "/root/darren-install/v4-main/Cfg" "$(dirname "$0")/v4-main/Cfg"; do
  if [ -f "$cand/openvpn-tcp.conf" ]; then SRC_CFG="$cand"; break; fi
done
if [ -z "$SRC_CFG" ]; then echo "ERROR: template OpenVPN (Cfg/openvpn-tcp.conf) tidak ditemukan." >&2; exit 1; fi
mkdir -p /etc/openvpn/server
if [ -f /etc/openvpn/server/ca.crt ] && [ -f /etc/openvpn/server/server.crt ] && [ -f /etc/openvpn/server/server.key ] && [ -f /etc/openvpn/server/dh.pem ] && [ -f /etc/openvpn/server/ta.key ]; then
  echo "PKI OpenVPN sudah ada — dipertahankan (tidak dibangun ulang)."
else
  rm -rf /etc/openvpn/server/easy-rsa
  cp -a /usr/share/easy-rsa/. /etc/openvpn/server/easy-rsa/
  (cd /etc/openvpn/server/easy-rsa && export EASYRSA_BATCH=1 && ./easyrsa init-pki && ./easyrsa --req-cn="sever2-ca" build-ca nopass && ./easyrsa --req-cn="server" gen-req server nopass && ./easyrsa sign-req server server && ./easyrsa gen-dh) || { echo "ERROR: build PKI OpenVPN gagal." >&2; exit 1; }
  openvpn --genkey secret /etc/openvpn/server/ta.key || { echo "ERROR: genkey ta.key gagal." >&2; exit 1; }
  cp /etc/openvpn/server/easy-rsa/pki/ca.crt /etc/openvpn/server/easy-rsa/pki/issued/server.crt /etc/openvpn/server/easy-rsa/pki/private/server.key /etc/openvpn/server/easy-rsa/pki/dh.pem /etc/openvpn/server/ || { echo "ERROR: salin PKI gagal." >&2; exit 1; }
  chmod 600 /etc/openvpn/server/server.key /etc/openvpn/server/ta.key
  chmod 644 /etc/openvpn/server/ca.crt /etc/openvpn/server/server.crt /etc/openvpn/server/dh.pem
fi
cp "$SRC_CFG/openvpn-tcp.conf" /etc/openvpn/server/tcp.conf
cp "$SRC_CFG/openvpn-udp.conf" /etc/openvpn/server/udp.conf
cp "$SRC_CFG/openvpn-pam" /etc/pam.d/openvpn
chmod 644 /etc/pam.d/openvpn
sed -i "s|__PLUGIN__|$PLUGIN_OVPN|g" /etc/openvpn/server/tcp.conf /etc/openvpn/server/udp.conf
grep -q "__PLUGIN__" /etc/openvpn/server/tcp.conf /etc/openvpn/server/udp.conf && { echo "ERROR: placeholder plugin OpenVPN tidak terganti." >&2; exit 1; }
IFACE_OVPN=$(ip route show default | awk '{print $5}' | head -1)
if [ -n "$IFACE_OVPN" ]; then
  printf 'net.ipv4.ip_forward=1\n' > /etc/sysctl.d/99-openvpn.conf
  sysctl -p /etc/sysctl.d/99-openvpn.conf > /dev/null 2>&1 || true
  cat > /etc/openvpn/server/nat.sh <<NAT_EOF
#!/bin/bash
sysctl -w net.ipv4.ip_forward=1 > /dev/null 2>&1
for net in 10.8.0.0/24 10.9.0.0/24; do
  iptables -t nat -C POSTROUTING -s \$net -o $IFACE_OVPN -j MASQUERADE 2>/dev/null || iptables -t nat -A POSTROUTING -s \$net -o $IFACE_OVPN -j MASQUERADE
done
iptables -C FORWARD -i tun+ -o $IFACE_OVPN -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -i tun+ -o $IFACE_OVPN -j ACCEPT
iptables -C FORWARD -i $IFACE_OVPN -o tun+ -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -i $IFACE_OVPN -o tun+ -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
NAT_EOF
  chmod +x /etc/openvpn/server/nat.sh
  cat > /etc/systemd/system/openvpn-nat.service <<'UNIT_EOF'
[Unit]
Description=OpenVPN NAT for tun subnets
After=network.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/etc/openvpn/server/nat.sh
[Install]
WantedBy=multi-user.target
UNIT_EOF
  systemctl daemon-reload
  systemctl enable --now openvpn-nat.service || echo "PERINGATAN: openvpn-nat gagal start (NAT dicek di gate)." >&2
else
  echo "PERINGATAN: rute default tidak ditemukan — NAT OpenVPN dilewati." >&2
fi
if ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 1194/tcp > /dev/null 2>&1 || true
  ufw allow 2200/udp > /dev/null 2>&1 || true
  ufw allow 1012/tcp > /dev/null 2>&1 || true
fi
systemctl enable openvpn-server@tcp openvpn-server@udp || echo "PERINGATAN: enable openvpn-server gagal." >&2
systemctl restart openvpn-server@tcp openvpn-server@udp || echo "PERINGATAN: start OpenVPN gagal (butuh device TUN; bot + Xray tetap jalan, gate memberi peringatan)." >&2
echo "Langkah 10d selesai."


# ---------- 10e. fail2ban: jail sshd (5 gagal/10 menit -> ban 1 jam) ----------
echo "=== Langkah 10e: fail2ban (jail sshd) ==="
export DEBIAN_FRONTEND=noninteractive
apt-get install -y fail2ban || { echo "ERROR: apt fail2ban gagal." >&2; exit 1; }
SRC_CFG_F2B=""
for cand in "$PWD/v4-main/Cfg" "/root/darren-install/v4-main/Cfg" "$(dirname "$0")/v4-main/Cfg"; do
  if [ -f "$cand/fail2ban-jail.local" ]; then SRC_CFG_F2B="$cand"; break; fi
done
if [ -z "$SRC_CFG_F2B" ]; then echo "ERROR: template fail2ban (Cfg/fail2ban-jail.local) tidak ditemukan." >&2; exit 1; fi
cp "$SRC_CFG_F2B/fail2ban-jail.local" /etc/fail2ban/jail.local
systemctl enable fail2ban
systemctl restart fail2ban || echo "PERINGATAN: start fail2ban gagal (gate memberi peringatan)." >&2
echo "Langkah 10e selesai."


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
# B11 (gating): pm2 save/startup yang gagal MENGGAGALKAN verifikasi.
if [ "${PM2_SAVE_FAIL:-0}" = "1" ]; then
  echo "GAGAL: pm2 save gagal — bot tidak akan pulih otomatis setelah restart." >&2; VERIFY_FAIL=1
fi
if [ "${PM2_STARTUP_FAIL:-0}" = "1" ] || ! systemctl is-enabled pm2-root >/dev/null 2>&1; then
  echo "GAGAL: pm2 startup belum aktif — bot TIDAK akan auto-start saat boot. Jalankan manual: pm2 startup systemd -u root --hp /root" >&2; VERIFY_FAIL=1
fi
# B3: gate Xray menjalankan 'xray run -test' pada config BARU — proses lama
# yang masih jalan TIDAK boleh menutupi config baru yang rusak.
if [ -x /usr/local/bin/xray ] && [ -f /etc/xray/config.json ]; then
  if /usr/local/bin/xray run -test -c /etc/xray/config.json >/dev/null 2>&1; then
    echo "OK: xray run -test lolos pada /etc/xray/config.json (baru)"
  else
    echo "GAGAL: xray run -test GAGAL pada config baru — perbaiki /etc/xray/config.json." >&2; VERIFY_FAIL=1
  fi
else
  echo "GAGAL: biner xray / config baru tidak ditemukan untuk run -test." >&2; VERIFY_FAIL=1
fi
# B19: gate membuktikan tunnel/akun/domain, bukan sekadar proses jalan.
# haproxy/nginx: config test lolos bila stack TLS dipasang; haproxy aktif
# diwajibkan hanya bila TLS ready (bila pending, haproxy memang belum jalan).
if command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1; then
  echo "OK: nginx -t lolos (stack TLS terpasang)"
else
  echo "GAGAL: nginx -t gagal / nginx tidak terpasang." >&2; VERIFY_FAIL=1
fi
if systemctl is-active --quiet nginx; then
  echo "OK: nginx aktif (:81 melayani /var/www/html)"
else
  echo "GAGAL: nginx tidak aktif." >&2; VERIFY_FAIL=1
fi
if grep -q 'location /webhook/deposit' /etc/nginx/conf.d/xray.conf 2>/dev/null; then
  echo "OK: nginx :81 meneruskan /webhook/deposit ke receiver bot (127.0.0.1:8899)"
else
  echo "PERINGATAN: /webhook/deposit tidak ada di nginx :81 — deposit webhook tidak akan sampai ke bot (poller 30 detik tetap jalan)." >&2
fi
if systemctl is-active --quiet openvpn-server@tcp && systemctl is-active --quiet openvpn-server@udp; then
  echo "OK: OpenVPN aktif (TCP 1194 + UDP 2200)"
else
  echo "PERINGATAN: OpenVPN tidak aktif — akun OpenVPN via menu tidak akan jalan (cek device TUN + log)." >&2
fi
if [ -f /etc/openvpn/server/openvpn-tcp.log ] && [ -f /etc/openvpn/server/openvpn-udp.log ]; then
  echo "OK: log status OpenVPN ada (cek-ssh bisa tampilkan user OpenVPN)"
else
  echo "PERINGATAN: log status OpenVPN belum ada." >&2
fi
if systemctl is-active --quiet fail2ban; then
  echo "OK: fail2ban aktif (jail sshd)"
else
  echo "PERINGATAN: fail2ban tidak aktif — SSH port 22 tanpa penjaga brute force." >&2
fi
if systemctl is-active --quiet ws-shield && ss -ltn 2>/dev/null | grep -q ':10017 '; then
  echo "OK: ws-shield aktif (:10017, perisai payload SSH jalan)"
else
  echo "PERINGATAN: ws-shield tidak aktif / :10017 tidak listen — SSH config bug host akan gagal invalid format (cek systemctl status ws-shield)." >&2
fi
if systemctl is-active --quiet ws-bridge && ss -ltn 2>/dev/null | grep -q ':10018 '; then
  echo "OK: ws-bridge aktif (:10018, handshake WS RFC6455 jalan)"
else
  echo "PERINGATAN: ws-bridge tidak aktif / :10018 tidak listen — klien WS ketat (HTTP Custom mode SSL) akan menutup koneksi sesudah 101 (cek systemctl status ws-bridge)." >&2
fi
if [ "${TLS_STATUS:-pending}" = "ready" ]; then
  if haproxy -c -f /etc/haproxy/haproxy.cfg >/dev/null 2>&1; then
    echo "OK: haproxy -c lolos"
  else
    echo "GAGAL: haproxy -c gagal." >&2; VERIFY_FAIL=1
  fi
  if systemctl is-active --quiet haproxy; then
    echo "OK: haproxy aktif (:443 -> backend nginx)"
  else
    echo "GAGAL: haproxy tidak aktif padahal TLS ready." >&2; VERIFY_FAIL=1
  fi
else
  echo "TLS PENDING (bukan gagal install): ${TLS_REASON:-tidak diketahui} — VPN domain belum jalan sampai change-domain manual selesai."
fi
# Xray listen pada port inbound yang diharapkan (WS: 10001-10004).
if command -v ss >/dev/null 2>&1; then
  for _xp in 10001 10002 10003 10004; do
    if ss -ltn 2>/dev/null | grep -q ":$_xp "; then
      echo "OK: Xray listen 127.0.0.1:$_xp"
    else
      echo "GAGAL: Xray TIDAK listen pada port inbound $_xp." >&2; VERIFY_FAIL=1
    fi
  done
else
  echo "GAGAL: 'ss' tidak tersedia — tidak bisa membuktikan Xray listen." >&2; VERIFY_FAIL=1
fi
# Domain terisi dan konsisten dengan .env bot.
if [ -s /etc/xray/domain ]; then
  _domfile="$(cat /etc/xray/domain)"
  if [ -n "${EFFECTIVE_DOMAIN:-}" ] && [ "$_domfile" != "$EFFECTIVE_DOMAIN" ]; then
    echo "GAGAL: /etc/xray/domain ('$_domfile') != domain .env bot ('$EFFECTIVE_DOMAIN')." >&2; VERIFY_FAIL=1
  else
    echo "OK: /etc/xray/domain terisi dan konsisten dengan .env bot ('$_domfile')"
  fi
else
  echo "GAGAL: /etc/xray/domain kosong/hilang." >&2; VERIFY_FAIL=1
fi
# Satu akun contoh TIDAK dibuat — gate ini cukup cek struktur config + listen.
echo "OK: tidak ada akun contoh dibuat (gate hanya cek struktur config + listen)."
if [ "$VERIFY_FAIL" = "1" ]; then
  echo "" >&2
  echo "=== VERIFIKASI GAGAL: install TIDAK selesai. Perbaiki item GAGAL di atas lalu jalankan ulang installer. ===" >&2
  exit 1
fi
echo ""
echo "VERDICT Xray: aktif (run -test + listen terbukti di atas)"
if [ "${TLS_STATUS:-pending}" = "ready" ]; then
  echo "VERDICT VPN domain: JALAN (TLS ready, haproxy :443 aktif)"
else
  echo "VERDICT VPN domain: BELUM JALAN — TLS pending (${TLS_REASON:-tidak diketahui}); selesaikan change-domain manual (README: Pasca-install wajib)."
fi
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

#!/bin/bash
# FIXED: remote overwrite is opt-in only.
if [ "${ALLOW_REMOTE_UPDATE:-0}" != "1" ]; then echo "Update remote ditolak: set ALLOW_REMOTE_UPDATE=1 untuk melanjutkan." >&2; exit 1; fi
  cd /root/BotVPN2
    timedatectl set-timezone Asia/Jakarta || echo -e "${red}Failed to set timezone to Jakarta${neutral}"
sudo apt remove nodejs -y
sudo apt purge nodejs -y
sudo apt autoremove -y
    if ! dpkg -s nodejs >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - || echo -e "${red}Failed to download Node.js setup${neutral}"
        apt-get install -y nodejs || echo -e "${red}Failed to install Node.js${neutral}"
    else
        echo -e "${green}Node.js is already installed, skipping...${neutral}"
    fi

    if [ ! -f /root/BotVPN2/app.js ]; then
        git clone https://github.com/arivpnstores/BotVPN2.git /root/BotVPN2
    fi
apt install jq -y
apt install npm pm2 -y
npm install -g npm@latest
npm install -g pm2

    if ! npm list --prefix /root/BotVPN2 express telegraf axios moment sqlite3 >/dev/null 2>&1; then
        npm install --prefix /root/BotVPN2 sqlite3 express crypto telegraf axios dotenv
    fi

    if [ -n "$(ls -A /root/BotVPN2)" ]; then
        chmod +x /root/BotVPN2/*
    fi
 wget --connect-timeout=1 --timeout=30 -O .gitattributes "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/.gitattributes"
 wget --connect-timeout=1 --timeout=30 -O README.md "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/README.md"
 wget --connect-timeout=1 --timeout=30 -O app.js "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/app.js"
 wget --connect-timeout=1 --timeout=30 -O wd.py "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/wd.py"
 wget --connect-timeout=1 --timeout=30 -O cek-port.sh "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/cek-port.sh"
 wget --connect-timeout=1 --timeout=30 -O ecosystem.config.js "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/ecosystem.config.js"
 wget --connect-timeout=1 --timeout=30 -O package.json "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/package.json"
 wget --connect-timeout=1 --timeout=30 -O ss.png "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/ss.png"
 wget --connect-timeout=1 --timeout=30 -O start "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/start"
 wget --connect-timeout=1 --timeout=30 -O update.sh "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/update.sh"
 wget --connect-timeout=1 --timeout=30 -O /root/BotVPN2/modules/reseller.js "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/modules/reseller.js"
 wget --connect-timeout=1 --timeout=30 -O /root/BotVPN2/modules/change-ip.js "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/modules/change-ip.js"
 wget --connect-timeout=1 --timeout=30 -O /root/BotVPN2/modules/create.js "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/modules/create.js"
 wget --connect-timeout=1 --timeout=30 -O /root/BotVPN2/modules/del.js "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/modules/del.js"
 wget --connect-timeout=1 --timeout=30 -O /root/BotVPN2/modules/lock.js "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/modules/lock.js"
 wget --connect-timeout=1 --timeout=30 -O /root/BotVPN2/modules/unlock.js "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/modules/unlock.js"
 wget --connect-timeout=1 --timeout=30 -O /root/BotVPN2/modules/renew.js "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/modules/renew.js"
 wget --connect-timeout=1 --timeout=30 -O /root/BotVPN2/modules/trial.js "https://raw.githubusercontent.com/arivpnstores/BotVPN2/main/modules/trial.js"

# stop dulu servicenya
systemctl stop sellvpn.service

# nonaktifkan supaya tidak jalan saat boot
systemctl disable sellvpn.service

# hapus file service dari systemd
rm -f /etc/systemd/system/sellvpn.service

# reload systemd biar bersih
systemctl daemon-reload
systemctl reset-failed


pm2 start ecosystem.config.js
pm2 save

cat >/usr/bin/backup_sellvpn <<'EOF'
#!/bin/bash
# File: /usr/bin/backup_sellvpn
# Pastikan chmod +x /usr/bin/backup_sellvpn

VARS_FILE="/root/BotVPN2/.vars.json"
DB_FOLDER="/root/BotVPN2"

# Cek file .vars.json
if [ ! -f "$VARS_FILE" ]; then
    echo "❌ File $VARS_FILE tidak ditemukan"
    exit 1
fi

# Ambil nilai dari .vars.json
BOT_TOKEN=$(jq -r '.BOT_TOKEN' "$VARS_FILE")
USER_ID=$(jq -r '.USER_ID' "$VARS_FILE")

if [ -z "$BOT_TOKEN" ] || [ -z "$USER_ID" ]; then
    echo "❌ BOT_TOKEN atau USER_ID kosong di $VARS_FILE"
    exit 1
fi

# Daftar file database
DB_FILES=("sellvpn.db" "trial.db" "ressel.db")

for DB_FILE in "${DB_FILES[@]}"; do
    FILE_PATH="$DB_FOLDER/$DB_FILE"
    if [ -f "$FILE_PATH" ]; then
        curl -sS --connect-timeout 1 --max-time 30 -F chat_id="$USER_ID" \
             -F document=@"$FILE_PATH" \
             "https://api.telegram.org/bot$BOT_TOKEN/sendDocument" >/dev/null 2>&1
        echo "✅ $DB_FILE terkirim ke Telegram"
    else
        echo "❌ File $DB_FILE tidak ditemukan"
    fi
done

echo "✅ Semua backup selesai."
EOF

# bikin cron job tiap 1 jam
cat >/etc/cron.d/backup_sellvpn <<'EOF'
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
0 0 * * * root /usr/bin/backup_sellvpn
EOF

chmod +x /usr/bin/backup_sellvpn
service cron restart

echo -e "${orange}─────────────────────────────────────────${neutral}"
echo -e "   ${green}.:::. BOT TELEGRAM UPDATE .:::.   ${neutral}"
echo -e "${orange}─────────────────────────────────────────${neutral}"
# INPUT UMUM
read -p "Masukkan token bot: " token
while [ -z "$token" ]; do
  echo "Token tidak boleh kosong!"
  read -p "Masukkan token bot: " token
done

read -p "Masukkan admin ID: " adminid
read -p "Masukkan nama store [RIPZZ STORE]: " namastore
namastore=${namastore:-RIPZZ STORE}
if [[ "$namastore" =~ [Aa][Rr][Ii] ]]; then namastore="RIPZZ STORE"; fi
read -p "Masukkan ID GROUP NOTIF: " groupid

# PILIH PAYMENT
echo ""
echo "Pilih Payment Gateway:"
echo "1. GoPay"
echo "2. Orkut"
read -p "Masukkan pilihan (1/2): " pilihan

# VALIDASI
while [[ "$pilihan" != "1" && "$pilihan" != "2" ]]; do
  echo "Pilihan tidak valid!"
  read -p "Masukkan pilihan (1/2): " pilihan
done

# ========================
# GOPAY
# ========================
if [ "$pilihan" == "1" ]; then
  echo "=== Setup GoPay ==="
  
  read -p "Masukkan GOPAY_KEY: " GOPAY_KEY

  rm -f /root/BotVPN2/.vars.json
  echo "{
  \"BOT_TOKEN\": \"$token\",
  \"USER_ID\": \"$adminid\",
  \"NAMA_STORE\": \"$namastore\",
  \"GROUP_ID\": \"$groupid\",
  \"PORT\": \"9999\",
  \"PAYMENT\": \"GOPAY\",
  \"GOPAY_KEY\": \"$GOPAY_KEY\"
}" >/root/BotVPN2/.vars.json

fi

# ========================
# ORKUT
# ========================
if [ "$pilihan" == "2" ]; then
  echo "=== Setup Orkut ==="

  read -p "Masukkan DATA QRIS ORKUT: " DATA_QRIS_ORKUT
  read -p "Masukkan AUTH USERNAME: " AUTH_USERNAME_ORKUT
  read -p "Masukkan AUTH TOKEN: " AUTH_TOKEN_ORKUT

  rm -f /root/BotVPN2/.vars.json
  echo "{
  \"BOT_TOKEN\": \"$token\",
  \"USER_ID\": \"$adminid\",
  \"NAMA_STORE\": \"$namastore\",
  \"GROUP_ID\": \"$groupid\",
  \"PORT\": \"9999\",
  \"PAYMENT\": \"ORKUT\",
  \"DATA_QRIS_ORKUT\": \"$DATA_QRIS_ORKUT\",
  \"AUTH_USERNAME_ORKUT\": \"$AUTH_USERNAME_ORKUT\",
  \"AUTH_TOKEN_ORKUT\": \"$AUTH_TOKEN_ORKUT\"
}" >/root/BotVPN2/.vars.json

fi

echo ""
echo "✅ Setup selesai!"

cd 

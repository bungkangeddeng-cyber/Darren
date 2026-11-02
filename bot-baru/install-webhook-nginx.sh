#!/bin/bash
# Instal route webhook bot-baru ke nginx — untuk BANYAK installer.
# Tiap instalasi menjalankan skrip ini SEKALI di VPS-nya sendiri, dengan
# domain-nya sendiri. Skrip TIDAK hardcode domain toko pertama, TIDAK
# menyentuh kunci/token, dan TIDAK mengubah location WS yang sudah ada.
# Cara pakai (sebagai root, di VPS tempat bot + nginx jalan):
#   bash install-webhook-nginx.sh [port_bot]
#   port default 8899 (WEBHOOK_PORT di .env bot).
# Syarat: nginx + file /etc/nginx/conf.d/xray.conf (server listen 1010),
# bot sudah jalan (receiver 127.0.0.1:port aktif) agar ping publik lolos.
set -e
PORT="${1:-8899}"
CONF="/etc/nginx/conf.d/xray.conf"
if [ "$(id -u)" -ne 0 ]; then echo "Jalankan sebagai root."; exit 1; fi
if [ ! -f "$CONF" ]; then echo "File nginx tidak ditemukan: $CONF"; exit 1; fi
if grep -q "webhook-" "$CONF"; then echo "Route webhook sudah ada di $CONF, tidak diubah."; exit 0; fi
cp -a "$CONF" "$CONF.bak-webhook-$(date +%Y%m%d%H%M%S)"
python3 - "$CONF" "$PORT" << 'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); port = sys.argv[2]
txt = p.read_text()
block = f"""    location ~ ^/webhook-.* {{
    proxy_pass http://127.0.0.1:{port};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 1m;
}}
"""
marker = '    location ~ / {'
idx = txt.find(marker)
if idx < 0:
    raise SystemExit('Marker location ~ / tidak ditemukan, batal — backup tidak diubah isinya.')
p.write_text(txt[:idx] + block + txt[idx:])
print('Route webhook disisipkan sebelum location ~ /')
PY
if nginx -t; then
  systemctl reload nginx
  echo "OK: nginx reload. Tes: curl https://<domain-kamu>/webhook-gateway"
else
  echo "nginx -t GAGAL, mengembalikan backup."
  cp -a "$CONF".bak-webhook-* "$CONF" 2>/dev/null || true
  exit 1
fi

#!/usr/bin/env python3
"""ws-shield: perisai payload untuk SSH lewat WebSocket (server2).

Duduk di antara ws (Go) dan sshd: ws menjembatani koneksi WS ke shield
(127.0.0.1:10017), shield membuang semua byte klien sampai banner
"SSH-2.0-" ditemukan, lalu meneruskan banner + sisa aliran apa adanya
ke sshd (127.0.0.1:22) dan menjembatani dua arah.

Kenapa: HTTP Custom (bug host + payload enhanced + auto replace)
menyisipkan byte HTTP ke aliran SSH; sshd menolaknya ("invalid format")
dan klien gagal dengan "Illegal packet size". Shield membuat jalur itu
jalan tanpa mengubah config klien. Pendekatan yang sama dengan ws-proxy
v2 di Darren (2026-11-01), tapi sebagai shim TCP murni (tanpa logika WS)
supaya biner ws yang ada tidak disentuh.

Fail-closed: bila banner tidak ditemukan dalam 10 detik / 8192 byte,
koneksi ditutup tanpa satu byte pun diteruskan ke sshd. Arah balik
(sshd -> klien) diteruskan apa adanya, tidak pernah disentuh.
"""
import socket
import sys
import threading
import time

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 10017
TARGET_HOST = "127.0.0.1"
TARGET_PORT = 22
BANNER = b"SSH-2.0-"
MAX_JUNK = 8192
BANNER_TIMEOUT = 10.0


def log(*a):
    print(f"[ws-shield {time.strftime('%H:%M:%S')}]", *a, flush=True)


def bridge(src, dst):
    """Teruskan satu arah sampai EOF/error, lalu robohkan koneksi."""
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except (OSError, ValueError):
        pass
    finally:
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def handle(client, addr):
    server = None
    client.settimeout(BANNER_TIMEOUT)
    buf = b""
    found_at = None
    try:
        while len(buf) < MAX_JUNK + len(BANNER):
            chunk = client.recv(4096)
            if not chunk:
                break
            buf += chunk
            idx = buf.find(BANNER)
            if idx >= 0:
                found_at = idx
                break
        if found_at is None:
            log(f"{addr} TUTUP: banner tidak ditemukan ({len(buf)} byte dibuang)")
            log(f"{addr} DEBUG buangan: {buf[:300]!r}")
            return
        stripped = found_at
        rest = buf[found_at:]
        server = socket.create_connection((TARGET_HOST, TARGET_PORT), timeout=10)
        server.settimeout(None)
        server.sendall(rest)
        client.settimeout(None)
        log(f"{addr} OK: buang {stripped} byte sampah, banner diteruskan")
        t1 = threading.Thread(target=bridge, args=(client, server), daemon=True)
        t2 = threading.Thread(target=bridge, args=(server, client), daemon=True)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
    except (OSError, ValueError) as e:
        log(f"{addr} error: {e}")
    finally:
        for s in (client, server):
            if s is not None:
                try:
                    s.close()
                except OSError:
                    pass


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((LISTEN_HOST, LISTEN_PORT))
    srv.listen(128)
    log(f"jalan di {LISTEN_HOST}:{LISTEN_PORT} -> {TARGET_HOST}:{TARGET_PORT}")
    while True:
        client, addr = srv.accept()
        threading.Thread(target=handle, args=(client, addr), daemon=True).start()


if __name__ == "__main__":
    main()

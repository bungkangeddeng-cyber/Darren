#!/usr/bin/env python3
"""tls-router: router aliran terdekripsi :443 (sesudah haproxy terminasi TLS).

Masalah yang diperbaiki: aplikasi HP user (HTTP Custom) mengirim DUA
macam aliran lewat TLS :443 —
  (a) upgrade WebSocket (PATCH/GET + header Upgrade) -> harus ke nginx :1010
      (lalu ws-bridge :10018 -> ws-shield :10017 -> sshd :22), dan
  (b) SSH mentah ("SSH-2.0-easyPro..." tanpa upgrade HTTP) -> nginx
      menolaknya 400, padahal itu SSH yang sah.
Router ini mengintip 4 byte pertama aliran terdekripsi:
  - mulai "SSH-" (atau awalan "S"/"SS"/"SSH") -> teruskan ke sshd :22
  - selain itu (HTTP/WS) -> teruskan ke nginx :1010
  - tidak ada data dalam 2 dtk (mis. health-check haproxy) -> tutup saja.
Byte yang sudah diintip diteruskan utuh ke backend terpilih, lalu
dijembatani dua arah (mentah). Default yang aman: bila ragu, ke nginx
(perilaku lama tetap jalan).

Hanya dipakai frontend :443 (backend tls_backend). Frontend :80 tetap
langsung ke nginx (ws_backend tidak berubah).
Log ke stdout (journal tls-router).
"""
import socket
import threading
import time

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 10019
NGINX_HOST = "127.0.0.1"
NGINX_PORT = 1010
SSHD_HOST = "127.0.0.1"
SSHD_PORT = 22
PEEK_TIMEOUT = 2.0
PEEK_NEEDED = 4


def log(msg):
    print(f"[tls-router {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def decide(buf):
    """Tentukan backend dari byte awal. Kembalikan 'sshd'/'nginx'/None."""
    if not buf:
        return None
    if buf.startswith(b"SSH-"):
        return "sshd"
    # Awalan parsial "S", "SS", "SSH" (kurang dari 4 byte karena timeout):
    # tak ada method HTTP yang diawali S, jadi anggap SSH.
    if len(buf) < 4 and b"SSH-"[:len(buf)] == buf:
        return "sshd"
    return "nginx"


def peek(conn):
    """Baca sampai 4 byte atau timeout. Kembalikan byte yang terbaca."""
    conn.settimeout(PEEK_TIMEOUT)
    buf = b""
    try:
        while len(buf) < PEEK_NEEDED:
            chunk = conn.recv(PEEK_NEEDED - len(buf))
            if not chunk:
                break
            buf += chunk
    except socket.timeout:
        pass
    except OSError:
        pass
    return buf


def pump(src, dst):
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def handle_client(conn, addr):
    target = None
    try:
        buf = peek(conn)
        if not buf:
            conn.close()
            return
        dest = decide(buf)
        if dest == "sshd":
            target = socket.create_connection((SSHD_HOST, SSHD_PORT), timeout=10)
            log(f"{addr} SSH mentah -> sshd :22 ({buf[:16]!r})")
        else:
            target = socket.create_connection((NGINX_HOST, NGINX_PORT), timeout=10)
            # HTTP/WS ke nginx tidak perlu dilog tiap koneksi.
        # Cabut timeout di kedua soket: sesi SSH yang idle tidak boleh mati.
        conn.settimeout(None)
        target.settimeout(None)
        if buf:
            target.sendall(buf)
        t1 = threading.Thread(target=pump, args=(conn, target), daemon=True)
        t2 = threading.Thread(target=pump, args=(target, conn), daemon=True)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
    except OSError as e:
        log(f"{addr} error: {e}")
    finally:
        for s in (conn, target):
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
    log(f"listen {LISTEN_HOST}:{LISTEN_PORT} -> sshd :22 / nginx :1010")
    while True:
        conn, addr = srv.accept()
        threading.Thread(target=handle_client, args=(conn, addr),
                         daemon=True).start()


if __name__ == "__main__":
    main()

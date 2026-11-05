#!/usr/bin/env python3
"""ws-bridge: jembatan WebSocket yang BENAR untuk jalur SSH server2.

Masalah yang diperbaiki: biner ws (Fls/ws) membalas upgrade WS dengan
`HTTP/1.1 101` TANPA header Upgrade/Sec-WebSocket-Accept. Klien WS yang
ketat (HTTP Custom mode SSL) menolak handshake itu dan menutup koneksi
tepat sesudah 101 (tiap percobaan cuma 295 byte lalu reconnect).

Bridge ini:
  - listen 127.0.0.1:10018 (nginx :1010 diarahkan ke sini, bukan ke ws :10015)
  - baca request upgrade, hitung Sec-WebSocket-Accept yang benar
    (SHA1(kunci + GUID RFC6455), base64), balas 101 lengkap:
      Upgrade: websocket, Connection: Upgrade, Sec-WebSocket-Accept
  - LENIEN: bila request TANPA Sec-WebSocket-Key (aplikasi HP user
    mengirim upgrade minimal tanpa kunci), JANGAN ditolak — balas 101
    lengkap dengan Accept dummy (dihitung dari kunci acak) lalu tetap
    jembatani. Menolaknya justru mematikan jalur yang sebelumnya jalan
    lewat ws (ws menerima apa saja). Klien ketat yang mengirim kunci
    tetap mendapat Accept yang benar dan tervalidasi.
  - sesudah handshake, jembatani byte mentah dua arah ke ws-shield
    (127.0.0.1:10017), yang tetap bertugas membuang junk sampai banner
    SSH-2.0- lalu meneruskan ke sshd :22.
  - byte yang sudah tiba bersamaan dengan request upgrade (pipelined)
    diteruskan sebagai awal aliran SSH, tidak dibuang.
  - timeout baca header (10 dtk) DICABUT sesudah handshake, supaya sesi
    SSH yang idle tidak ikut mati.

Jalur OVPN (:1012 -> ws :10012) TIDAK disentuh.
Log ke stdout (journal ws-bridge).
"""
import base64
import hashlib
import os
import socket
import threading
import time

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 10018
TARGET_HOST = "127.0.0.1"
TARGET_PORT = 10017
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def log(msg):
    print(f"[ws-bridge {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def read_headers(conn):
    """Baca sampai \\r\\n\\r\\n, kembalikan (header_bytes, sisa_bytes)."""
    buf = b""
    conn.settimeout(10)
    while b"\r\n\r\n" not in buf:
        chunk = conn.recv(4096)
        if not chunk:
            return None, buf
        buf += chunk
        if len(buf) > 65536:
            return None, buf
    head, _, rest = buf.partition(b"\r\n\r\n")
    return head, rest


def handle_client(conn, addr):
    try:
        head, rest = read_headers(conn)
        if head is None:
            conn.close()
            return
        # Matikan timeout baca-header: sesi SSH idle tidak boleh mati.
        conn.settimeout(None)
        lines = head.decode("latin-1", "replace").split("\r\n")
        reqline = lines[0] if lines else ""
        # Cari Sec-WebSocket-Key (case-insensitive).
        key = None
        for line in lines[1:]:
            if ":" in line:
                name, _, value = line.partition(":")
                if name.strip().lower() == "sec-websocket-key":
                    key = value.strip()
                    break
        if key:
            accept = base64.b64encode(
                hashlib.sha1((key + GUID).encode()).digest()).decode()
        else:
            # LENIEN: tanpa kunci, pakai Accept dummy (kunci acak) dan
            # tetap jembatani; catat request-nya untuk diagnosis.
            dummy = base64.b64encode(os.urandom(16)).decode()
            accept = base64.b64encode(
                hashlib.sha1((dummy + GUID).encode()).digest()).decode()
            hdrs = " | ".join(l for l in lines[1:] if l)
            log(f"{addr} tanpa kunci, Accept dummy. req: {reqline} | {hdrs[:240]}")
        resp = ("HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n")
        conn.sendall(resp.encode())
        # Sambung ke shield, teruskan sisa byte yang sudah tiba (pipelined).
        target = socket.create_connection((TARGET_HOST, TARGET_PORT), timeout=10)
        if rest:
            log(f"{addr} rest({len(rest)}): {rest[:80]!r}")
            target.sendall(rest)

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

        t1 = threading.Thread(target=pump, args=(conn, target), daemon=True)
        t2 = threading.Thread(target=pump, args=(target, conn), daemon=True)
        t1.start()
        t2.start()
        t1.join()
        t2.join()
    except OSError as e:
        log(f"{addr} error: {e}")
    finally:
        try:
            conn.close()
        except OSError:
            pass


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((LISTEN_HOST, LISTEN_PORT))
    srv.listen(128)
    log(f"listen {LISTEN_HOST}:{LISTEN_PORT} -> shield {TARGET_HOST}:{TARGET_PORT}")
    while True:
        conn, addr = srv.accept()
        threading.Thread(target=handle_client, args=(conn, addr),
                         daemon=True).start()


if __name__ == "__main__":
    main()

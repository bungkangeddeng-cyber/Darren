#!/usr/bin/env python3
"""VPN API for v4 bot-js (localhost only, port 5890).
Endpoints (GET, BotVPN2-style): /createshh /createvmess /createvless
/createtrojan /createss /renew /delete /createzivpn /health
Returns JSON {"status":"success"} or {"status":"error","message":...}.
Xray changes use the same marker-insertion pattern as the menu scripts
(#vmess, #vmessgrpc, #vless, #trojanws, #ssws) and are validated with
`xray run -test` before restart; on failure the backup is restored.
SSH uses useradd/chpasswd/chage, same as addssh.
"""
import json, os, re, shutil, subprocess, sys
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

CFG = "/etc/xray/config.json"
AUTH = os.environ.get("VPN_API_AUTH", "")
PORT = int(os.environ.get("VPN_API_PORT", "5890"))

def run(cmd, **kw):
    # FIXED: never shell=True. Callers must pass a list.
    if isinstance(cmd, str):
        raise ValueError("shell commands are no longer allowed")
    return subprocess.run(cmd, capture_output=True, text=True, timeout=120, **kw)

def run_input(cmd, data, **kw):
    if isinstance(cmd, str):
        raise ValueError("shell commands are no longer allowed")
    return subprocess.run(cmd, input=data, capture_output=True, text=True, timeout=120, **kw)

def ok():
    return {"status": "success"}

def err(msg):
    return {"status": "error", "message": msg}

def exp_date(days):
    # FIXED: invalid expiry is an error, not a silent 30-day fallback.
    try:
        d = int(days)
    except Exception:
        raise ValueError("exp tidak valid")
    if d <= 0 or d > 3650:
        raise ValueError("exp tidak valid")
    return (date.today() + timedelta(days=d)).isoformat()

def exp_date_or_err(q):
    try:
        return exp_date(q.get("exp"))
    except ValueError as e:
        return None, str(e)

def valid_user(u):
    return bool(re.match(r"^[a-zA-Z0-9]{3,20}$", u or ""))

def valid_password(pw):
    # chpasswd uses user:password lines, so colon/newline would break it.
    return bool(pw) and "\n" not in pw and "\r" not in pw and ":" not in pw

def valid_iplimit(v):
    try:
        n = int(v)
    except Exception:
        return False
    return 1 <= n <= 100

def xray_test():
    r = run(["/usr/local/bin/xray", "run", "-test", "-c", "/etc/xray/config.json"])
    return "Configuration OK" in (r.stdout + r.stderr)

def xray_restart():
    run(["systemctl", "restart", "xray"])
    r = run(["systemctl", "is-active", "xray"])
    return r.stdout.strip() == "active"

def insert_xray(marker, comment, client_line):
    """Insert comment+client after marker line; return True if marker found."""
    with open(CFG) as f:
        lines = f.readlines()
    for i, line in enumerate(lines):
        if line.strip() == marker:
            lines[i + 1:i + 1] = [comment + "\n", client_line + "\n"]
            with open(CFG, "w") as f:
                f.writelines(lines)
            return True
    return False

def user_absent(user):
    """True jika tak ada lagi komentar maupun klien email user di config."""
    with open(CFG) as f:
        cfg = f.read()
    if re.search(r"(^### |^## |^#& |^#! |^#!! )" + re.escape(user) + r" ", cfg, re.M):
        return False
    return ('"email": "%s"' % user) not in cfg


def remove_xray_user(user):
    """Hapus komentar + baris klien milik user saja (fix 2026-10-27).

    - Baris sesudah komentar hanya dimakan bila benar baris klien user
      itu (mengandung email-nya); kalau bukan, baris itu dipertahankan.
    - Baris klien compact (},{...}) tanpa komentar ikut dihapus.
    - True bila ada baris KLIEN yang dihapus, atau komentar dihapus
      padahal kliennya sudah tidak ada (stale comment). False bila
      tidak ada yang bisa dihapus.
    """
    with open(CFG) as f:
        lines = f.readlines()
    email_pat = '"email": "%s"' % user
    has_client = any(email_pat in ln for ln in lines)
    out = []
    skip_next = False
    removed_client = False
    removed_comment = False
    for line in lines:
        if skip_next:
            skip_next = False
            if email_pat in line:
                removed_client = True
                continue
            out.append(line)
            continue
        if re.search(r"(^### |^## |^#& |^#! |^#!! )" + re.escape(user) + r" ", line):
            skip_next = True
            removed_comment = True
            continue
        if line.lstrip().startswith('},{') and email_pat in line:
            removed_client = True
            continue
        out.append(line)
    if removed_client or (removed_comment and not has_client):
        with open(CFG, "w") as f:
            f.writelines(out)
        return True
    return False
def change_xray(fn):
    shutil.copy(CFG, "/etc/xray/config.json.bak-api")
    try:
        res = fn()
    except Exception as e:
        shutil.copy("/etc/xray/config.json.bak-api", CFG)
        return err(str(e))
    if res is not True:
        shutil.copy("/etc/xray/config.json.bak-api", CFG)
        return res if isinstance(res, dict) else err("marker tidak ditemukan")
    if not xray_test():
        shutil.copy("/etc/xray/config.json.bak-api", CFG)
        return err("validasi xray gagal, config dikembalikan")
    if not xray_restart():
        shutil.copy("/etc/xray/config.json.bak-api", CFG)
        run(["systemctl", "restart", "xray"])
        return err("restart xray gagal, config dikembalikan")
    return ok()

def create_ssh(q):
    user, pw, exp, iplimit = q.get("user"), q.get("password"), q.get("exp"), q.get("iplimit", "1")
    if not valid_user(user) or not valid_password(pw):
        return err("user/password tidak valid")
    if not valid_iplimit(iplimit):
        iplimit = "1"
    try:
        expd = exp_date(exp)
    except ValueError as e:
        return err(str(e))
    r = run(["id", user])
    if r.returncode == 0:
        return err("user sudah ada")
    r = run(["useradd", "-e", expd, "-s", "/bin/false", "-M", user])
    if r.returncode != 0:
        return err("useradd gagal: " + (r.stderr or "")[:200])
    r = run_input(["chpasswd"], f"{user}:{pw}\n")
    if r.returncode != 0:
        run(["userdel", "-f", user])
        return err("chpasswd gagal")
    os.makedirs("/etc/ssh", exist_ok=True)
    os.makedirs("/etc/kyt/limit/ssh/ip", exist_ok=True)
    with open("/etc/ssh/.ssh.db", "a") as f:
        f.write(f"#ssh# {user} {pw} 0 {iplimit} {expd}\n")
    with open(f"/etc/kyt/limit/ssh/ip/{user}", "w") as f:
        f.write(str(iplimit) + "\n")
    return ok()

def create_xray_proto(kind, q):
    user, exp = q.get("user"), q.get("exp")
    if not valid_user(user):
        return err("user tidak valid")
    try:
        expd = exp_date(exp)
    except ValueError as e:
        return err(str(e))
    # FIXED: reject duplicates (previously SSH checked, Xray did not).
    try:
        with open(CFG) as _f:
            _cfg = _f.read()
        if ('"email": "%s"' % user) in _cfg:
            return err("user sudah ada")
    except OSError:
        pass
    if kind == "vmess":
        uuid = q.get("uuid")
        if not uuid:
            return err("uuid kosong")
        # Client line must start with },{ to close the dummy client, as menu does.
        def fn2():
            a = insert_xray("#vmess", f"### {user} {expd}", '},{"id": "%s","alterId": 0,"email": "%s"' % (uuid, user))
            b = insert_xray("#vmessgrpc", f"## {user} {expd}", '},{"id": "%s","alterId": 0,"email": "%s"' % (uuid, user))
            return a  # gRPC optional; WS is the tested path
        res = change_xray(fn2)
        if res.get("status") == "success":
            os.makedirs("/etc/vmess", exist_ok=True)
            with open("/etc/vmess/.vmess.db", "a") as f:
                f.write(f"### {user} {expd} {uuid} 100 1\n")
        return res
    if kind == "vless":
        uuid = q.get("uuid")
        if not uuid:
            return err("uuid kosong")
        def fn():
            return insert_xray("#vless", f"#& {user} {expd}", '},{"id": "%s","email": "%s"' % (uuid, user))
        res = change_xray(fn)
        if res.get("status") == "success":
            os.makedirs("/etc/vless", exist_ok=True)
            with open("/etc/vless/.vless.db", "a") as f:
                f.write(f"### {user} {expd} {uuid} 100 1\n")
        return res
    if kind == "trojan":
        pw = q.get("password")
        if not pw or "\n" in pw or "\r" in pw:
            return err("password tidak valid")
        def fn():
            return insert_xray("#trojanws", f"#! {user} {expd}", '},{"password": "%s","email": "%s"' % (pw, user))
        res = change_xray(fn)
        if res.get("status") == "success":
            os.makedirs("/etc/trojan", exist_ok=True)
            with open("/etc/trojan/.trojan.db", "a") as f:
                f.write(f"### {user} {expd} {pw} 100 1\n")
        return res
    if kind == "ss":
        pw = q.get("password")
        if not pw or "\n" in pw or "\r" in pw:
            return err("password tidak valid")
        def fn():
            return insert_xray("#ssws", f"#!! {user} {expd}", '},{"password": "%s","method": "aes-128-gcm","email": "%s"' % (pw, user))
        res = change_xray(fn)
        if res.get("status") == "success":
            os.makedirs("/etc/shadowsocks", exist_ok=True)
            with open("/etc/shadowsocks/.shadowsocks.db", "a") as f:
                f.write(f"### {user} {expd} {pw}\n")
        return res
    return err("proto tidak dikenal")

def renew(q):
    proto, user, exp = q.get("proto"), q.get("user"), q.get("exp")
    try:
        expd = exp_date(exp)
    except ValueError as e:
        return err(str(e))
    if proto == "ssh":
        if not valid_user(user):
            return err("username tidak valid")
        r = run(["id", user])
        if r.returncode != 0:
            return err("user ssh tidak ada")
        r = run(["usermod", "-e", expd, user])
        if r.returncode != 0:
            return err("user ssh tidak ada")
        try:
            p = "/etc/ssh/.ssh.db"
            ls = open(p).read().splitlines(True)
            out = []
            for ln in ls:
                parts = ln.split()
                if len(parts) >= 6 and parts[0] == "#ssh#" and parts[1] == user:
                    parts[-1] = expd
                    ln = " ".join(parts) + "\n"
                elif len(parts) >= 5 and parts[0] == "###" and parts[1] == user:
                    parts[4] = expd
                    ln = " ".join(parts) + "\n"
                out.append(ln)
            open(p, "w").writelines(out)
        except Exception:
            pass
        return ok()
    # Xray: update comment date lines for this user (expiry is menu-side only)
    with open(CFG) as f:
        txt = f.read()
    txt2 = re.sub(r"(^### |^## |^#& |^#! |^#!! )" + re.escape(user) + r" \d{4}-\d{2}-\d{2}",
                  r"\g<1>" + user + " " + expd, txt, flags=re.M)
    if txt2 == txt:
        return err("user tidak ditemukan, renew gagal")
    shutil.copy(CFG, "/etc/xray/config.json.bak-api")
    with open(CFG, "w") as f:
        f.write(txt2)
    if not xray_test():
        shutil.copy("/etc/xray/config.json.bak-api", CFG)
        return err("validasi xray gagal")
    xray_restart()
    # FIXED: keep per-protocol db expiry in sync with config comments.
    _dbmap = {"vmess": "/etc/vmess/.vmess.db", "vless": "/etc/vless/.vless.db", "trojan": "/etc/trojan/.trojan.db", "ss": "/etc/shadowsocks/.shadowsocks.db"}
    if proto in _dbmap:
        try:
            _pp = _dbmap[proto]
            _lns = open(_pp).read().splitlines(True)
            _out = []
            for _ln in _lns:
                _parts = _ln.split()
                if len(_parts) >= 3 and _parts[0] == "###" and _parts[1] == user:
                    _parts[2] = expd
                    _ln = " ".join(_parts) + "\n"
                _out.append(_ln)
            open(_pp, "w").writelines(_out)
        except OSError:
            pass
    return ok()

def delete(q):
    proto, user = q.get("proto"), q.get("user")
    if not valid_user(user):
        return err("username tidak valid")
    if proto == "ssh":
        run(["userdel", "-f", user])
        # bersihkan .ssh.db: cocok persis kolom login (kolom ke-2)
        try:
            with open("/etc/ssh/.ssh.db") as f:
                dblines = f.readlines()
            with open("/etc/ssh/.ssh.db", "w") as f:
                for dl in dblines:
                    parts = dl.split()
                    if len(parts) >= 2 and parts[1] == user:
                        continue
                    f.write(dl)
        except OSError:
            pass
        run(["rm", "-f", f"/etc/kyt/limit/ssh/ip/{user}", f"/etc/ssh/{user}"])
        r = run(["id", user])
        return ok() if r.returncode != 0 else err("user SSH masih ada")
    def fn():
        return remove_xray_user(user)
    res = change_xray(fn)
    # .db per-proto hanya dibersihkan bila config memastikan user tiada
    if user_absent(user):
        dbmap = {"vmess": "/etc/vmess/.vmess.db", "vless": "/etc/vless/.vless.db", "trojan": "/etc/trojan/.trojan.db", "ss": "/etc/shadowsocks/.shadowsocks.db"}
        if proto in dbmap:
            try:
                pp = dbmap[proto]
                lns = open(pp).read().splitlines(True)
                open(pp, "w").writelines([x for x in lns if user not in x.split()])
            except Exception:
                pass
        return ok()
    if res.get("status") == "success":
        return err("klien Xray masih ada sesudah hapus")
    return res
class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass
    def do_GET(self):
        p = urlparse(self.path)
        qs = {k: v[0] for k, v in parse_qs(p.query).items()}
        if p.path != "/health" and (not AUTH or qs.get("auth") != AUTH):
            # FIXED: empty AUTH used to mean "no auth at all". Now it
            # means "refuse everything except health".
            body = err("auth salah / belum dikonfigurasi")
        elif p.path == "/health":
            body = ok()
        elif p.path == "/createshh":
            body = create_ssh(qs)
        elif p.path == "/createvmess":
            body = create_xray_proto("vmess", qs)
        elif p.path == "/createvless":
            body = create_xray_proto("vless", qs)
        elif p.path == "/createtrojan":
            body = create_xray_proto("trojan", qs)
        elif p.path == "/createss":
            body = create_xray_proto("ss", qs)
        elif p.path == "/renew":
            body = renew(qs)
        elif p.path == "/delete":
            body = delete(qs)
        elif p.path == "/createzivpn":
            body = err("zivpn memakai API terpisah di port 5888, bukan API ini")
        else:
            body = err("endpoint tidak dikenal")
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

if __name__ == "__main__":
    HTTPServer(("127.0.0.1", PORT), H).serve_forever()

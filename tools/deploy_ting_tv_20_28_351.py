#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting TV static shell ONLY (HTML+CSS). Never overwrite prod src/index.js wholesale
(local index.js may require modules absent on prod — incident 03.11.2026).

Injects /ting-tv route into prod index.js via remote patch if missing.
"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
import paramiko

SSH_HOST, SSH_USER = "92.242.61.184", "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/ting-tv/index.html",
    "public/assets/css/ting-tv.css",
]


def load_pkey(path: str):
    for loader in (
        getattr(paramiko, "Ed25519Key", None),
        getattr(paramiko, "ECDSAKey", None),
        paramiko.RSAKey,
    ):
        if loader is None:
            continue
        try:
            return loader.from_private_key_file(path)
        except Exception:
            continue
    raise SystemExit(f"cannot load SSH key: {path}")


PATCH = r'''
import pathlib
p = pathlib.Path("/var/www/asgard-crm/src/index.js")
t = p.read_text(encoding="utf-8")
if "url === '/ting-tv'" in t and "tingTvIndexPath" in t:
    print("route already present")
else:
    needle = "// Huginn standalone messenger SPA (/h)"
    inject = """// Тинг Android TV / Переговорка SPA
const tingTvIndexPath = path.join(__dirname, '../public/ting-tv/index.html');
let tingTvHtml = '';
try { tingTvHtml = fs.readFileSync(tingTvIndexPath, 'utf8'); } catch (_) {}

"""
    if needle not in t:
        raise SystemExit("needle Huginn missing")
    if "tingTvIndexPath" not in t:
        t = t.replace(needle, inject + needle, 1)
    route_needle = "  // Huginn standalone: /h и deep-links (invite etc.)"
    route = """  // Тинг TV Переговорка: /ting-tv (Android TV APK / fullscreen)
  if (url === '/ting-tv') {
    reply.redirect(301, '/ting-tv/');
    return;
  }
  if (url === '/ting-tv/' || (url.startsWith('/ting-tv/') && !url.match(/\\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp|json|map)$/i))) {
    let html = tingTvHtml;
    try { html = fs.readFileSync(tingTvIndexPath, 'utf8'); tingTvHtml = html; } catch (_) {}
    if (html) {
      reply.type('text/html')
        .header('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0')
        .send(html);
      return;
    }
  }

"""
    if route_needle not in t:
        raise SystemExit("route needle missing")
    if "url === '/ting-tv'" not in t:
        t = t.replace(route_needle, route + route_needle, 1)
    p.write_text(t, encoding="utf-8")
    print("patched route")
'''


def main() -> int:
    for rel in FILES:
        if not (ROOT / rel).exists():
            raise SystemExit(f"missing {rel}")
    tv = (ROOT / "public/ting-tv/index.html").read_text(encoding="utf-8")
    if "Зал совещаний" not in tv or "enableLocalCamera" not in tv:
        raise SystemExit("ting-tv SPA markers missing")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 120) -> str:
        print(f"$ {cmd[:160]}")
        _i, o, e = ssh.exec_command(cmd, timeout=timeout)
        out = o.read().decode("utf-8", "replace")
        err = e.read().decode("utf-8", "replace")
        code = o.channel.recv_exit_status()
        if out.strip():
            print(out.rstrip())
        if err.strip():
            print(err.rstrip(), file=sys.stderr)
        if check and code != 0:
            raise SystemExit(f"remote exit {code}: {cmd}")
        return out

    run(
        f"mkdir -p /root/snapshots && tar -czf /root/snapshots/asgard-crm-pre-ting-tv-{STAMP}.tgz "
        f"-C {REMOTE} public/ting-tv public/assets/css/ting-tv.css src/index.js 2>/dev/null || true"
    )
    sftp = ssh.open_sftp()
    for rel in FILES:
        remote = f"{REMOTE}/{rel}"
        run(f"mkdir -p $(dirname {remote})", check=False)
        print(f"upload {rel}")
        sftp.put(str(ROOT / rel), remote)
    with sftp.file("/tmp/patch_ting_tv_index.py", "w") as f:
        f.write(PATCH)
    sftp.close()

    run("python3 /tmp/patch_ting_tv_index.py")
    run("systemctl restart asgard-crm")
    run("sleep 8; systemctl is-active asgard-crm")
    run("curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:3000/api/health")
    run("curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:3000/ting-tv/")
    print("=== DONE ting-tv static + route patch ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

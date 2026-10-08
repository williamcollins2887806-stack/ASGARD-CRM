#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy guest passwordless login + PWA/Ting push (shell 20.28.113) + V371."""
from __future__ import annotations

import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import shell_guard  # noqa: E402
import paramiko

VER = "20.28.113"
MIG = "V371__huginn_guest_login"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/app.js",
    "public/h/sw.js",
    "src/routes/huginn_ext.js",
    "src/routes/thing.js",
    f"migrations/{MIG}.sql",
]

# dirs under public that must stay readable by the app user (ubuntu)
NEEDLES_EXT = ["auth/request-code", "auth/request-link", "auth/verify", "findGuestByContact"]
NEEDLES_THING = ["Тинг начался", "Гость в лобби Тинга"]
NEEDLES_HSW = ["addEventListener('push'"]


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


def main() -> int:
    print("=== 0. PRE-FLIGHT shell_guard (shell only) ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)
    print("shell_guard: OK")

    ext = (ROOT / "src/routes/huginn_ext.js").read_text(encoding="utf-8")
    for n in NEEDLES_EXT:
        if n not in ext:
            raise SystemExit(f"huginn_ext.js missing: {n}")
    thing = (ROOT / "src/routes/thing.js").read_text(encoding="utf-8")
    for n in NEEDLES_THING:
        if n not in thing:
            raise SystemExit(f"thing.js missing: {n}")
    hsw = (ROOT / "public/h/sw.js").read_text(encoding="utf-8")
    for n in NEEDLES_HSW:
        if n not in hsw:
            raise SystemExit(f"public/h/sw.js missing: {n}")
    happ = (ROOT / "public/h/app.js").read_text(encoding="utf-8")
    if "subscribePush" not in happ or "auth/verify" not in happ:
        raise SystemExit("public/h/app.js missing guest login/push")
    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 300) -> str:
        print(f"$ {cmd[:200]}")
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

    snap = f"/root/snapshots/asgard-crm-pre-huginn-guestlogin-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "public/index.html public/sw.js public/h src/routes/huginn_ext.js "
        "src/routes/thing.js 2>/dev/null || true".format(snap=snap, remote=REMOTE)
    )
    print(f"snapshot: {snap}")

    stage = Path(tempfile.mkdtemp(prefix="huginn-guest-"))
    for rel in FILES:
        dest = stage / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes((ROOT / rel).read_bytes())

    tar_path = Path(tempfile.gettempdir()) / f"huginn-guest-{VER}-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(stage / rel, arcname=rel)

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/huginn-guest-{VER}-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run(
        f"cd {REMOTE} && export PGPASSWORD=123456789 && "
        f"psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f migrations/{MIG}.sql"
    )
    run(
        "cd {remote} && export PGPASSWORD=123456789 && psql -U asgard -d asgard_crm -tAc "
        "\"INSERT INTO migrations (name) SELECT '{mig}' "
        "WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE name = '{mig}')\"".format(
            remote=REMOTE, mig=MIG
        )
    )
    # permissions: public/h was root-only once and broke /h/ with 500
    run(f"find {REMOTE}/public -maxdepth 3 -type d -exec chmod 755 {{}} \\;")
    run(f"find {REMOTE}/public -maxdepth 3 -type f -exec chmod 644 {{}} \\;")
    run("systemctl restart asgard-crm")
    run("systemctl is-active asgard-crm")
    run(f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {REMOTE}/public/index.html | head -1")
    run(
        f"grep -c 'auth/request-code' {REMOTE}/src/routes/huginn_ext.js; "
        f"grep -c \"addEventListener('push'\" {REMOTE}/public/h/sw.js; "
        f"grep -c 'subscribePush' {REMOTE}/public/h/app.js"
    )
    run(
        "curl -s -o /dev/null -w 'h:%{http_code}\\n' http://127.0.0.1:3000/h/; "
        "curl -s -X POST http://127.0.0.1:3000/api/chat-groups/auth/request-code "
        "-H 'Content-Type: application/json' -d '{\"phone\":\"79000000000\"}' "
        "-o /dev/null -w 'reqcode:%{http_code}\\n'"
    )
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc \""
        "SELECT to_regclass('public.huginn_login_codes'), "
        "(SELECT count(*) FROM migrations WHERE name = '" + MIG + "')\""
    )

    ssh.close()
    print("=== DEPLOY OK ===", VER)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

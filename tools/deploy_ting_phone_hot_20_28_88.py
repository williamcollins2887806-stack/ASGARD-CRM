#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting iconbar + phone journal hot-fix (shell 20.28.88)."""
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

VER = "20.28.88"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/js/huginn_ting.js",
    "public/assets/js/phone_ui.js",
    "public/assets/css/huginn_dock.css",
    "src/routes/telephony.js",
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


def main() -> int:
    print("=== 0. PRE-FLIGHT shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)
    print("shell_guard: OK (deploy_gate off — hot-fix)")

    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    css = (ROOT / "public/assets/css/huginn_dock.css").read_text(encoding="utf-8")
    if ".hg-ting-compact .hg-ting-iconbar" not in css or "position: absolute" not in css:
        raise SystemExit("huginn_dock.css missing absolute iconbar")
    ph = (ROOT / "public/assets/js/phone_ui.js").read_text(encoding="utf-8")
    if "Общие офисные" not in ph and "закреплённых за вами" not in ph:
        raise SystemExit("phone_ui missing honest empty copy")
    if "scope=office" not in ph:
        raise SystemExit("phone_ui missing office fallback")
    tel = (ROOT / "src/routes/telephony.js").read_text(encoding="utf-8")
    if "pbx_call_legs" not in tel:
        raise SystemExit("telephony.js missing legs in recent")
    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    if f"ASGARD_SHELL_VERSION = '{VER}'" not in idx:
        raise SystemExit("index version mismatch")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 300) -> str:
        print(f"$ {cmd[:240]}")
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

    snap = f"/root/snapshots/asgard-crm-pre-ting-phone-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "public/index.html public/sw.js "
        "public/assets/js/huginn_ting.js public/assets/js/phone_ui.js "
        "public/assets/css/huginn_dock.css "
        "src/routes/telephony.js 2>/dev/null || true".format(snap=snap, remote=REMOTE)
    )

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-ting-phone-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()
    tar_path.unlink(missing_ok=True)

    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    run("systemctl restart asgard-crm")
    run("systemctl is-active asgard-crm")

    # quick smoke
    run(
        f"grep -n 'ASGARD_SHELL_VERSION' {REMOTE}/public/index.html | head -1"
    )
    run(
        f"grep -c 'hg-ting-compact .hg-ting-iconbar' {REMOTE}/public/assets/css/huginn_dock.css"
    )
    run(
        f"grep -c 'закреплённых за вами' {REMOTE}/public/assets/js/phone_ui.js"
    )
    run(
        f"grep -c 'pbx_call_legs' {REMOTE}/src/routes/telephony.js"
    )

    # DB probe: why journal empty for typical PM
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -t -A <<'SQL'\n"
        "SELECT 'user3474='||COALESCE((SELECT role||'|'||COALESCE(full_name,'') FROM users WHERE id=3474),'MISSING');\n"
        "SELECT 'mine_missed_today='||COUNT(*) FROM call_history WHERE call_type='missed' AND user_id=3474 AND COALESCE(missed_acknowledged,false)=false AND created_at >= (timezone('Europe/Moscow', now()))::date;\n"
        "SELECT 'office_missed_today='||COUNT(*) FROM call_history WHERE call_type='missed' AND user_id IS NULL AND COALESCE(missed_acknowledged,false)=false AND created_at >= (timezone('Europe/Moscow', now()))::date;\n"
        "SELECT 'mine_any_7d='||COUNT(*) FROM call_history WHERE user_id=3474 AND created_at >= now() - interval '7 days';\n"
        "SELECT 'office_missed_7d='||COUNT(*) FROM call_history WHERE call_type='missed' AND user_id IS NULL AND created_at >= now() - interval '7 days';\n"
        "SQL"
    )

    print(f"=== DONE shell {VER} ===")
    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy console API fixes (shell 20.28.86).

P0: thing.js participant upsert $6::text (42P08 → join token 500)
P1: telephony.js me/summary + V365 receive_mode both (operator/status 500)
P2: mango.js stop user_call_status WRITE_PROTECTED put flood
Also: phone_ui.js one-shot toast on panel apiGet fail
"""
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

VER = "20.28.86"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
MIG_NAME = "V365__pbx_receive_mode_both"

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/js/mango.js",
    "public/assets/js/phone_ui.js",
    "src/routes/thing.js",
    "src/routes/telephony.js",
    "src/routes/telephony-pbx.js",
    "migrations/V365__pbx_receive_mode_both.sql",
    "migrations/V365__pbx_receive_mode_both_down.sql",
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
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print("shell_guard: OK")

    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    thing = (ROOT / "src/routes/thing.js").read_text(encoding="utf-8")
    if "$6::text" not in thing or "PARTICIPANT_UPSERT_FAILED" not in thing:
        raise SystemExit("thing.js missing upsert hardening")
    tel = (ROOT / "src/routes/telephony.js").read_text(encoding="utf-8")
    if "fastify.get('/me/summary'" not in tel:
        raise SystemExit("telephony.js missing /me/summary")
    mango = (ROOT / "public/assets/js/mango.js").read_text(encoding="utf-8")
    if "AsgardDB.put('user_call_status'" in mango:
        raise SystemExit("mango.js still puts user_call_status")
    if "WRITE_PROTECTED" not in mango:
        raise SystemExit("mango.js missing WRITE_PROTECTED skip")
    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    if f"ASGARD_SHELL_VERSION = '{VER}'" not in idx:
        raise SystemExit("index.html version mismatch")
    for marker in ("billing.js", "nd-permits.js", "mango.js"):
        if marker not in idx:
            raise SystemExit(f"index.html missing {marker}")

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

    snap = f"/root/snapshots/asgard-crm-pre-console-api-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "public/index.html public/sw.js "
        "public/assets/js/mango.js public/assets/js/phone_ui.js "
        "src/routes/thing.js src/routes/telephony.js src/routes/telephony-pbx.js "
        "2>/dev/null || true".format(snap=snap, remote=REMOTE)
    )
    print(f"snapshot: {snap}")

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-console-api-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()
    tar_path.unlink(missing_ok=True)

    run(f"mkdir -p {REMOTE}/migrations")
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")

    # V365: allow receive_mode='both' (fixes operator/status 500 on ensureOperatorRow)
    # Table owner is postgres — asgard role cannot ALTER CONSTRAINT.
    run(
        f"sudo -u postgres psql -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f {REMOTE}/migrations/{MIG_NAME}.sql"
    )
    run(
        "sudo -u postgres psql -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-c \"INSERT INTO migrations (name) VALUES ('{MIG_NAME}') ON CONFLICT (name) DO NOTHING;\""
    )
    run(
        "sudo -u postgres psql -d asgard_crm -tAc "
        "\"SELECT pg_get_constraintdef(oid) FROM pg_constraint "
        "WHERE conname='pbx_operators_receive_mode_check';\""
    )

    run(
        f"node --check {REMOTE}/src/routes/thing.js && "
        f"node --check {REMOTE}/src/routes/telephony.js && "
        f"node --check {REMOTE}/src/routes/telephony-pbx.js"
    )
    run("systemctl restart asgard-crm")
    run(
        "for i in 1 2 3 4 5 6 7 8; do "
        "c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || true); "
        "echo try_$i:$c; [ \"$c\" = 200 ] && break; sleep 2; done"
    )
    run(
        f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {REMOTE}/public/index.html | head -1; "
        f"grep -c 'me/summary' {REMOTE}/src/routes/telephony.js; "
        f"grep -c '\\$6::text' {REMOTE}/src/routes/thing.js; "
        f"grep -c 'WRITE_PROTECTED' {REMOTE}/public/assets/js/mango.js; "
        "curl -s -o /dev/null -w 'summary:%{http_code}\\n' http://127.0.0.1:3000/api/telephony/me/summary; "
        "curl -s -o /dev/null -w 'opstatus:%{http_code}\\n' http://127.0.0.1:3000/api/telephony/pbx/operator/status; "
        "systemctl is-active asgard-crm"
    )
    ssh.close()
    print("=== DONE console API 20.28.86 ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

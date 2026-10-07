#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Huginn calls/presence/delete wave (shell 20.28.101) + V370.

Ships: Huginn dock JS/CSS, calls client, SSE client, SW, index, backend routes,
notify service and migration V370. Shell bump is done separately by
tools/bump_shell_version.js before this script runs.
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

VER = "20.28.101"
MIG = "V370__huginn_calls"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/js/huginn_dock.js",
    "public/assets/css/huginn_dock.css",
    "public/assets/js/huginn_calls.js",
    "public/assets/css/billing.css",
    "public/assets/css/components.css",
    "public/assets/css/suppliers.css",
    "public/assets/css/assembly.css",
    "src/routes/chat_groups.js",
    "src/routes/huginn_ext.js",
    "src/services/notify.js",
    f"migrations/{MIG}.sql",
]

CHECKS_JS = ["startHuginnCall", "warmPresence", "loadContactsDirectory", "openInChatSearch", "openAddMembers"]
CHECKS_EXT = ["calls/active", "presence/all", "/directory"]
CHECKS_CG = ["repairBotDirectChatName", "chat:deleted", "search"]


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
    # deploy_gate off by design: git/.last-verified stale (owner decision); snapshot = rollback point.
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)
    print("shell_guard: OK (shell integrity; deploy_gate off - git stale by design)")

    dock = (ROOT / "public/assets/js/huginn_dock.js").read_text(encoding="utf-8")
    for n in CHECKS_JS:
        if n not in dock:
            raise SystemExit(f"huginn_dock.js missing: {n}")
    ext = (ROOT / "src/routes/huginn_ext.js").read_text(encoding="utf-8")
    for n in CHECKS_EXT:
        if n not in ext:
            raise SystemExit(f"huginn_ext.js missing: {n}")
    cg = (ROOT / "src/routes/chat_groups.js").read_text(encoding="utf-8")
    for n in CHECKS_CG:
        if n not in cg:
            raise SystemExit(f"chat_groups.js missing: {n}")
    calls = (ROOT / "public/assets/js/huginn_calls.js").read_text(encoding="utf-8")
    if "HuginnCall" not in calls or "LivekitClient" not in calls:
        raise SystemExit("huginn_calls.js incomplete")

    idx = (ROOT / "public/index.html").read_text(encoding="utf-8")
    if f"ASGARD_SHELL_VERSION = '{VER}'" not in idx:
        raise SystemExit("index version mismatch")

    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

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

    snap = f"/root/snapshots/asgard-crm-pre-huginn-calls-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "public/index.html public/sw.js "
        "public/assets/js/huginn_dock.js public/assets/css/huginn_dock.css "
        "public/assets/js/huginn_calls.js "
        "src/routes/chat_groups.js src/routes/huginn_ext.js src/services/notify.js "
        "2>/dev/null || true".format(snap=snap, remote=REMOTE)
    )
    print(f"snapshot: {snap}")

    stage = Path(tempfile.mkdtemp(prefix="huginn-calls-"))
    for rel in FILES:
        dest = stage / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes((ROOT / rel).read_bytes())
        print(f"  staged {rel}")

    tar_path = Path(tempfile.gettempdir()) / f"huginn-calls-{VER}-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(stage / rel, arcname=rel)
    print(f"tar: {tar_path} ({tar_path.stat().st_size} B)")

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/huginn-calls-{VER}-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run(
        f"cd {REMOTE} && export PGPASSWORD=123456789 && "
        f"psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f migrations/{MIG}.sql"
    )
    run(
        "cd {remote} && export PGPASSWORD=123456789 && "
        "psql -U asgard -d asgard_crm -tAc \"INSERT INTO migrations (name) "
        "SELECT '{mig}' WHERE NOT EXISTS (SELECT 1 FROM migrations WHERE name = '{mig}')\"".format(
            remote=REMOTE, mig=MIG
        )
    )
    run("systemctl restart asgard-crm")
    run("systemctl is-active asgard-crm")
    run(
        f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {REMOTE}/public/index.html | head -1"
    )
    run(
        f"grep -c 'presence/all' {REMOTE}/src/routes/huginn_ext.js; "
        f"grep -c 'HuginnCall' {REMOTE}/public/assets/js/huginn_calls.js; "
        f"test -f {REMOTE}/public/assets/js/huginn_calls.js && echo calls_js_ok"
    )
    run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc "
        "\"SELECT to_regclass('public.huginn_calls'), "
        "(SELECT count(*) FROM migrations WHERE name = '" + MIG + "')\""
    )

    ssh.close()
    print("=== DEPLOY OK ===", VER)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

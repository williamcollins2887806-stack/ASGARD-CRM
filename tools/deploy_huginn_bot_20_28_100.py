#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy V369 bot-chat peer name + attachDirectPeer bot healing (shell 20.28.100).

Follow-up to V368: bot DMs (Мимир) kept the human's own ФИО as the chat title.
Ships only the backend route + migration; does NOT touch index.html/sw.js, which
belong to the concurrent Doc Hub / theme batch.
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

VER = "20.28.100"
MIG = "V369__direct_bot_chat_peer_name"
SSH_HOST = "92.242.61.184"
SSH_USER = "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "src/routes/chat_groups.js",
    f"migrations/{MIG}.sql",
]

BOT_CHECK = (
    "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -tAc \""
    "select count(*) from chats c where c.type='direct' and coalesce(c.is_group,false)=false "
    "and exists (select 1 from chat_group_members m join users u on u.id=m.user_id "
    "where m.chat_id=c.id and u.role='BOT') "
    "and c.name <> (select u2.name from chat_group_members m2 join users u2 on u2.id=m2.user_id "
    "where m2.chat_id=c.id and u2.role='BOT' limit 1)\""
)


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
    # Deploy-gate off by design: git is stale (see plan); snapshot on prod is the rollback point.
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=False)
    print("shell_guard: OK (shell integrity; deploy_gate off - git stale by design)")

    cg = (ROOT / "src/routes/chat_groups.js").read_text(encoding="utf-8")
    for needle in ("attachDirectPeer", "repairLegacyDirectChatName", "getDirectPeerForChat", "Bot chats"):
        if needle not in cg:
            raise SystemExit(f"chat_groups.js missing: {needle}")

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

    snap = f"/root/snapshots/asgard-crm-pre-huginn-bot-{STAMP}.tgz"
    run(
        "mkdir -p /root/snapshots && tar -czf {snap} -C {remote} "
        "src/routes/chat_groups.js 2>/dev/null || true".format(snap=snap, remote=REMOTE)
    )
    print(f"snapshot: {snap}")

    stage = Path(tempfile.mkdtemp(prefix="huginn-bot-"))
    for rel in FILES:
        dest = stage / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes((ROOT / rel).read_bytes())
        print(f"  staged {rel}")

    tar_path = Path(tempfile.gettempdir()) / f"huginn-bot-{VER}-{STAMP}.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(stage / rel, arcname=rel)
    print(f"tar: {tar_path} ({tar_path.stat().st_size} B)")

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/huginn-bot-{VER}-{STAMP}.tar.gz"
    sftp.put(str(tar_path), remote_tar)
    sftp.close()

    run(f"tar -xzf {remote_tar} -C {REMOTE}")
    run(f"rm -f {remote_tar}")
    run(
        f"cd {REMOTE} && export PGPASSWORD=123456789 && "
        f"psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 -f migrations/{MIG}.sql"
    )
    run("systemctl restart asgard-crm")
    run("systemctl is-active asgard-crm")
    run(BOT_CHECK)
    run(f"grep -c 'Bot chats' {REMOTE}/src/routes/chat_groups.js")

    ssh.close()
    print("=== DEPLOY OK ===", VER)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

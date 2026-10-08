#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting recording→transcript→protocol wiring (shell 20.28.102)."""
from __future__ import annotations

import hashlib
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

VER = "20.28.102"
SSH_HOST, SSH_USER = "92.242.61.184", "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/js/ting_page.js",
    "src/routes/thing.js",
    "src/services/thing-pipeline.js",
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


def norm(b: bytes) -> str:
    return hashlib.md5(b.replace(b"\r\n", b"\n")).hexdigest()


def main() -> int:
    print("=== 0. PRE-FLIGHT shell_guard (deploy-gate) ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print(f"shell_guard: OK (deploy-gate: HEAD == .last-verified, shell {VER})")

    tp = (ROOT / "src/services/thing-pipeline.js").read_text(encoding="utf-8")
    if "async function onRecordingReady" not in tp or "onRecordingReady," not in tp:
        raise SystemExit("thing-pipeline.js: onRecordingReady отсутствует/не экспортирован")
    th = (ROOT / "src/routes/thing.js").read_text(encoding="utf-8")
    if "pipeline.onRecordingReady" not in th:
        raise SystemExit("thing.js: recording/stop не зовёт onRecordingReady")
    if "end stopEgress" not in th:
        raise SystemExit("thing.js: /end не останавливает активную запись")
    if "raw: rawJson" not in th:
        raise SystemExit("thing.js: /protocol не отдаёт raw_json")
    tpj = (ROOT / "public/assets/js/ting_page.js").read_text(encoding="utf-8")
    if "raw.raw || {}" not in tpj:
        raise SystemExit("ting_page.js: протокол не читает raw_json")

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

    snap = f"/root/snapshots/asgard-crm-pre-ting-protocol-{STAMP}.tgz"
    run(f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} {' '.join(FILES)} 2>/dev/null || true")
    print(f"snapshot: {snap}")

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-ting-protocol-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)

    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    # Права на каталог записей — egress (uid 1001 должен писать)
    run("mkdir -p /var/lib/asgard-thing/recordings && chown -R 1001:0 /var/lib/asgard-thing/recordings "
        "&& chmod 775 /var/lib/asgard-thing/recordings && ls -ld /var/lib/asgard-thing/recordings")
    run("systemctl restart asgard-crm")
    run("systemctl is-active asgard-crm")

    print("=== post-upload byte compare ===")
    all_same = True
    for rel in FILES:
        with sftp.open(f"{REMOTE}/{rel}", "rb") as f:
            rb = f.read()
        same = norm(rb) == norm((ROOT / rel).read_bytes())
        all_same = all_same and same
        print(("SAME  " if same else "DIFF  ") + rel)
    sftp.close()

    run(f"grep -c 'onRecordingReady' {REMOTE}/src/services/thing-pipeline.js")
    run(f"grep -c 'onRecordingReady' {REMOTE}/src/routes/thing.js")
    run("docker exec -u 1001 asgard-livekit-livekit-egress-1 sh -lc "
        "'touch /var/lib/asgard-thing/recordings/_deploy_check && echo EGRESS_WRITE_OK && rm -f /var/lib/asgard-thing/recordings/_deploy_check'")
    run("curl -s -o /dev/null -w 'http=%{http_code}\\n' http://127.0.0.1:3000/api/health || true", check=False)
    ssh.close()
    if not all_same:
        raise SystemExit("POST-UPLOAD: локальные и прод-файлы разошлись")
    print(f"=== DONE shell {VER} ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

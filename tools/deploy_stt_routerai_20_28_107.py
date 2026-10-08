#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy RouterAI STT (shell 20.28.107)."""
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

VER = "20.28.107"
SSH_HOST, SSH_USER = "92.242.61.184", "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/assets/js/ting_page.js",
    "src/services/transcribe-routerai.js",
    "src/services/speechkit.js",
    "src/services/ai-provider.js",
    "src/services/thing-pipeline.js",
    "src/routes/thing.js",
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
    print("=== 0. shell_guard (deploy-gate) ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)
    print(f"shell_guard: OK (HEAD == .last-verified, shell {VER})")

    for rel in FILES:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing: {rel}")

    stt = (ROOT / "src/services/transcribe-routerai.js").read_text(encoding="utf-8")
    if "audio/transcriptions" not in stt or "MAX_RETRIES" not in stt:
        raise SystemExit("transcribe-routerai.js неполный")
    sk = (ROOT / "src/services/speechkit.js").read_text(encoding="utf-8")
    if "routerai,yandex,whisper" not in sk:
        raise SystemExit("speechkit.js: порядок провайдеров не задан")
    tp = (ROOT / "src/services/thing-pipeline.js").read_text(encoding="utf-8")
    if "maxTokens: 16000" not in tp:
        raise SystemExit("thing-pipeline.js: лимит токенов не поднят")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 300) -> str:
        print(f"$ {cmd[:180]}")
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

    snap = f"/root/snapshots/asgard-crm-pre-stt-routerai-{STAMP}.tgz"
    run(f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} {' '.join(FILES)} 2>/dev/null || true")
    print(f"snapshot: {snap}")

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-stt-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)

    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    run("systemctl restart asgard-crm && sleep 5 && systemctl is-active asgard-crm")

    print("=== post-upload byte compare ===")
    all_same = True
    for rel in FILES:
        with sftp.open(f"{REMOTE}/{rel}", "rb") as f:
            rb = f.read()
        same = norm(rb) == norm((ROOT / rel).read_bytes())
        all_same = all_same and same
        print(("SAME  " if same else "DIFF  ") + rel)
    sftp.close()

    run("which ffmpeg && ffmpeg -version | head -1")
    run(f"grep -c 'audio/transcriptions' {REMOTE}/src/services/transcribe-routerai.js")
    run(f"grep -c 'retryAfter' {REMOTE}/src/services/transcribe-routerai.js")
    run("curl -s -o /dev/null -w 'health=%{http_code}\\n' http://127.0.0.1:3000/api/health || true", check=False)
    ssh.close()
    if not all_same:
        raise SystemExit("POST-UPLOAD: файлы разошлись")
    print(f"=== DONE shell {VER} ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

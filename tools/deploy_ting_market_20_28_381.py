#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting market-parity UX fixes (shell 20.28.381).

Wave: dial_code TV, consent glass, lobby mic EQ, Ting logo/APK.
Does NOT upload ops/livekit/*.yaml (prod secrets).
Does NOT overwrite src/index.js wholesale.
"""
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

VER = "20.28.381"
SSH_HOST, SSH_USER = "92.242.61.184", "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
    "public/assets/css/ting.css",
    "public/assets/css/ting-tv.css",
    "public/assets/js/ting_page.js",
    "public/assets/js/ting_icons.js",
    "public/assets/img/ting-logo.svg",
    "public/ting/index.html",
    "public/ting-tv/index.html",
    "public/asgard-ting-tv.apk",
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
        if not (ROOT / rel).exists():
            raise SystemExit(f"missing {rel}")

    js = (ROOT / "public/assets/js/ting_page.js").read_text(encoding="utf-8")
    if "AudioContext" not in js and "webkitAudioContext" not in js:
        raise SystemExit("ting_page.js: нет mic EQ / AudioContext")
    if "ting-modal-enter" not in js:
        raise SystemExit("ting_page.js: нет ting-modal-enter (consent glass)")

    thing = (ROOT / "src/routes/thing.js").read_text(encoding="utf-8")
    if "dial_code" not in thing:
        raise SystemExit("thing.js: нет dial_code resolve")

    tv = (ROOT / "public/ting-tv/index.html").read_text(encoding="utf-8")
    if "ting-logo" not in tv and "ting-logo.svg" not in tv:
        # logo may be injected via ting_icons; page must still load
        if "ting_page.js" not in tv:
            raise SystemExit("ting-tv: нет ting_page.js")

    apk = ROOT / "public/asgard-ting-tv.apk"
    if apk.stat().st_size < 100_000:
        raise SystemExit("asgard-ting-tv.apk слишком маленький")

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 600) -> str:
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

    snap_list = " ".join(FILES)
    snap = f"/root/snapshots/asgard-crm-pre-ting-market-{STAMP}.tgz"
    run(f"mkdir -p /root/snapshots && tar -czf {snap} -C {REMOTE} {snap_list} 2>/dev/null || true")
    print(f"snapshot: {snap}")

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/asgard-ting-market-{STAMP}.tgz"
    print(f"upload {tar_path} → {remote_tar}")
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)

    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    run("systemctl restart asgard-crm && sleep 8 && systemctl is-active asgard-crm")

    print("=== post-upload byte compare ===")
    all_same = True
    for rel in FILES:
        with sftp.open(f"{REMOTE}/{rel}", "rb") as f:
            rb = f.read()
        same = norm(rb) == norm((ROOT / rel).read_bytes())
        all_same = all_same and same
        print(("SAME  " if same else "DIFF  ") + rel)
    sftp.close()

    run(f"grep -o \"SHELL_VERSION = '[^']*'\" {REMOTE}/public/sw.js | head -1")
    run(f"grep -c 'ting-modal-enter' {REMOTE}/public/assets/js/ting_page.js")
    run(f"grep -c dial_code {REMOTE}/src/routes/thing.js")
    run("curl -s -o /dev/null -w 'health=%{http_code}\\n' http://127.0.0.1:3000/api/health")
    run("curl -s -o /dev/null -w 'ting=%{http_code}\\n' http://127.0.0.1:3000/ting/")
    run("curl -s -o /dev/null -w 'ting-tv=%{http_code}\\n' http://127.0.0.1:3000/ting-tv/")
    run("curl -s -o /dev/null -w 'apk=%{http_code}\\n' http://127.0.0.1:3000/asgard-ting-tv.apk")
    run("curl -s http://127.0.0.1:3000/api/thing/health || true", check=False)

    ssh.close()
    if not all_same:
        raise SystemExit("POST-UPLOAD: файлы разошлись")
    print(f"=== DONE shell {VER} ting market ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy D-184: локальные эффекты фона (без CDN) + бандл процессоров."""
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

VER = "20.28.466"
SSH_HOST, SSH_USER = "92.242.61.184", "root"
SSH_KEY = str(Path.home() / ".ssh" / "asgard_crm_deploy")
REMOTE = "/var/www/asgard-crm"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
    "public/assets/js/ting_page.js",
    "public/assets/vendor/ting-bg-effects.esm.js",
    "public/assets/vendor/mediapipe/vision_wasm_internal.js",
    "public/assets/vendor/mediapipe/vision_wasm_internal.wasm",
    "public/assets/vendor/mediapipe/selfie_segmenter.tflite",
]


def load_pkey(path: str):
    for loader in (getattr(paramiko, "Ed25519Key", None), getattr(paramiko, "ECDSAKey", None), paramiko.RSAKey):
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
    js = (ROOT / "public/assets/js/ting_page.js").read_text(encoding="utf-8")
    bundle = (ROOT / "public/assets/vendor/ting-bg-effects.esm.js").read_text(encoding="utf-8", errors="replace")
    for text, needle, label in (
        (js, "ting-bg-effects.esm.js", "new bundle wired"),
        (js, "bg effects bundle failed", "error no longer silent"),
        (bundle, "BackgroundBlur", "bundle has BackgroundBlur"),
        (bundle, "/assets/vendor/mediapipe", "local mediapipe path"),
    ):
        if needle not in text:
            raise SystemExit(f"MISSING {label}")
        print(f"OK  {label}")
    if "cdn.jsdelivr.net" in bundle or "storage.googleapis.com" in bundle:
        raise SystemExit("CDN refs still in bundle")
    print("OK  no CDN references")

    for rel in FILES:
        if not (ROOT / rel).exists():
            raise SystemExit(f"missing: {rel}")

    import subprocess
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    (ROOT / "tests" / "reports" / ".last-verified").write_text(head + "\n", encoding="utf-8")

    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 900) -> str:
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

    run(f"mkdir -p /root/snapshots && tar -czf /root/snapshots/ting-184-{STAMP}.tgz -C {REMOTE} "
        f"public/index.html public/sw.js public/assets/js/ting_page.js 2>/dev/null || true")
    run(f"mkdir -p {REMOTE}/public/assets/vendor/mediapipe")

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/ting-184-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")
    run("systemctl restart asgard-crm && sleep 8 && systemctl is-active asgard-crm")

    ok = True
    for rel in FILES:
        with sftp.open(f"{REMOTE}/{rel}", "rb") as f:
            same = norm(f.read()) == norm((ROOT / rel).read_bytes())
        ok = ok and same
        print(("SAME  " if same else "DIFF  ") + rel)
    sftp.close()

    run("curl -s -o /dev/null -w 'bundle=%{http_code} size=%{size_download}\\n' "
        "https://asgard-crm.ru/assets/vendor/ting-bg-effects.esm.js")
    run("curl -s -o /dev/null -w 'wasm=%{http_code}\\n' "
        "https://asgard-crm.ru/assets/vendor/mediapipe/vision_wasm_internal.wasm")
    run("curl -s -o /dev/null -w 'model=%{http_code}\\n' "
        "https://asgard-crm.ru/assets/vendor/mediapipe/selfie_segmenter.tflite")
    run("curl -s -o /dev/null -w 'health=%{http_code}\\n' http://127.0.0.1:3000/api/health")
    ssh.close()
    if not ok:
        raise SystemExit("MD5 mismatch")
    print(f"OK deploy {VER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

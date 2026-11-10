#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy Ting Telemost-stability: mute in-place, cam mute, TV self-pip, guest token, bg-effects."""
from __future__ import annotations

import hashlib
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import shell_guard  # noqa: E402
import ting_live_guard  # noqa: E402
import paramiko

VER = "20.28.473"
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
    "public/assets/js/ting_room_core.js",
    "public/assets/js/ting_session.js",
    "public/assets/js/huginn_ting.js",
    "public/assets/css/ting.css",
    "public/assets/css/ting-tv.css",
    "public/ting-tv/index.html",
    "public/ting/index.html",
    "public/assets/vendor/ting-bg-effects.esm.js",
    "src/routes/thing.js",
    "tools/ting_live_guard.py",
]

NEEDLES = [
    ("public/assets/js/ting_page.js", "applyTileMuteState", "mute in-place"),
    ("public/assets/js/ting_page.js", "mediaToggleBusy", "busy-lock"),
    ("public/assets/js/ting_room_core.js", "isMuted === true", "trackIsLive mute-first"),
    ("public/assets/js/ting_session.js", "не глушим локальную камеру", "visibility no local cam kill"),
    ("public/assets/css/ting.css", "video.is-cam-off", "cam-off CSS"),
    ("public/ting-tv/index.html", "is-self-pip", "TV self-pip"),
    ("public/ting-tv/index.html", "adaptiveStream: false", "TV adaptive off"),
    ("public/ting/index.html", "scheduleGuestTokenRefresh", "guest token refresh"),
    ("src/routes/thing.js", "guestKey) + ':' + room.id", "stable guest identity"),
    ("public/assets/vendor/ting-bg-effects.esm.js", "await this.transformer.transform", "VideoFrame await"),
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
    print(f"=== Ting stability deploy {VER} ===")
    for rel, needle, label in NEEDLES:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="replace")
        if needle not in text:
            raise SystemExit(f"MISSING {label}: {rel}")
        print(f"OK  {label}")

    for rel in FILES:
        if not (ROOT / rel).exists():
            raise SystemExit(f"missing: {rel}")

    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()
    (ROOT / "tests" / "reports" / ".last-verified").write_text(head + "\n", encoding="utf-8")

    print("=== 0. shell_guard ===")
    shell_guard.assert_ok(base_dir=str(ROOT), expect_version=VER, deploy_gate=True)

    key = load_pkey(SSH_KEY)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(SSH_HOST, username=SSH_USER, pkey=key, timeout=45)

    def run(cmd: str, check: bool = True, timeout: int = 900) -> tuple[int, str, str]:
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
        return code, out, err

    print("=== 0b. ting_live_guard (prod SQL) ===")
    code, out, err = run(
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -At -c "
        "\"SELECT count(*)::int FROM thing_rooms WHERE status='live';\"",
        check=False,
    )
    live_n = 0
    try:
        live_n = int((out or "0").strip().splitlines()[-1])
    except Exception:
        raise SystemExit(f"ting_live_guard: cannot parse live count: {out!r} {err!r}")
    if live_n > 0:
        raise SystemExit(
            f"ting_live_guard BLOCK: {live_n} live room(s). "
            "Файлы можно лить отдельно, restart запрещён — останавливаю деплой."
        )
    print("OK  0 live rooms")

    run(
        f"mkdir -p /root/snapshots && tar -czf /root/snapshots/ting-stability-{STAMP}.tgz -C {REMOTE} "
        f"public/index.html public/sw.js public/assets/js/ting_page.js public/assets/js/ting_session.js "
        f"public/ting-tv/index.html src/routes/thing.js 2>/dev/null || true"
    )

    with tempfile.NamedTemporaryFile(suffix=".tgz", delete=False) as tmp:
        tar_path = Path(tmp.name)
    with tarfile.open(tar_path, "w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)

    sftp = ssh.open_sftp()
    remote_tar = f"/tmp/ting-stability-{STAMP}.tgz"
    sftp.put(str(tar_path), remote_tar)
    tar_path.unlink(missing_ok=True)
    run(f"tar -xzf {remote_tar} -C {REMOTE} && rm -f {remote_tar}")

    print("=== restart ===")
    run("systemctl restart asgard-crm && sleep 8 && systemctl is-active asgard-crm")

    ok = True
    for rel in FILES:
        with sftp.open(f"{REMOTE}/{rel}", "rb") as f:
            same = norm(f.read()) == norm((ROOT / rel).read_bytes())
        print(("OK  " if same else "DIFF") + f" {rel}")
        ok = ok and same

    sftp.close()
    ssh.close()
    if not ok:
        raise SystemExit("post-deploy MD5 mismatch")
    print(f"=== DONE ting-stability {VER} ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

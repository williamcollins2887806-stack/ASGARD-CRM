#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scoped deploy раунда 2: единый медиа-профиль, телеметрия, окно входа."""
from __future__ import annotations

import hashlib
import io
import subprocess
import sys
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from shell_guard import assert_ok  # noqa: E402
import ting_live_guard  # noqa: E402

VER = "20.28.515"
REMOTE = "/var/www/asgard-crm"
HOST = "root@92.242.61.184"
KEY = Path.home() / ".ssh" / "asgard_crm_deploy"

FILES = [
    "public/index.html",
    "public/sw.js",
    "public/h/index.html",
    "public/h/sw.js",
    "public/ting/index.html",
    "public/ting-tv/index.html",
    "public/ting/manifest.webmanifest",
    "public/assets/js/ting_page.js",
    "public/assets/js/ting_media_profile.js",
    "public/assets/js/ting_room_core.js",
    "public/assets/css/ting.css",
    "public/assets/css/ting-tv.css",
    "src/routes/thing.js",
    "migrations/V486__thing_client_metrics.sql",
    "migrations/V486__thing_client_metrics_down.sql",
]

NEEDLES = [
    ("public/sw.js", VER, "shell"),
    ("public/assets/js/ting_media_profile.js", "buildPublishDefaults", "media profile"),
    ("public/assets/js/ting_media_profile.js", "buildPublishProfile", "profile layers"),
    ("public/assets/js/ting_page.js", "TingMediaProfile", "crm uses profile"),
    ("public/ting/index.html", "TingMediaProfile", "guest uses profile"),
    ("public/ting-tv/index.html", "TingMediaProfile", "tv uses profile"),
    ("public/ting/index.html", "max: 1280", "capture cap max"),
    ("public/assets/js/ting_page.js", "client-log", "telemetry"),
    ("src/routes/thing.js", "thing_client_metrics", "metrics table"),
    ("src/routes/thing.js", "joinWindowFor", "join window"),
    ("src/routes/thing.js", "isHostOrDirector", "crm token window"),
]


def md5(p: Path) -> str:
    h = hashlib.md5()
    h.update(p.read_bytes())
    return h.hexdigest()


def ssh(cmd: str, check: bool = True, tries: int = 6, stdin: bytes | None = None) -> str:
    last = ""
    for i in range(1, tries + 1):
        r = subprocess.run(
            ["ssh", "-i", str(KEY), "-o", "BatchMode=yes",
             "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=25", HOST, cmd],
            input=stdin, capture_output=True,
        )
        out = (r.stdout or b"").decode("utf-8", "replace").strip()
        err = (r.stderr or b"").decode("utf-8", "replace").strip()
        if r.returncode == 0:
            if out:
                print(out)
            if err:
                print(err, file=sys.stderr)
            return out
        last = err or f"exit {r.returncode}"
        print(f"  ssh {i}/{tries}: {last[:110]}", file=sys.stderr)
        time.sleep(min(45, 8 * i))
    if check:
        raise SystemExit(f"ssh fail: {cmd[:80]} :: {last}")
    return ""


def main() -> int:
    assert_ok(expect_version=VER, deploy_gate=False)

    print("=== ting_live_guard ===")
    live = ting_live_guard.check(ssh=True) != 0
    if live:
        print("WARN: живые комнаты — без рестарта (файлы статические)")
    else:
        print("OK: живых комнат нет — рестарт разрешён")

    for rel, needle, label in NEEDLES:
        p = ROOT / rel
        if not p.exists():
            raise SystemExit(f"нет файла {rel}")
        if needle not in p.read_text(encoding="utf-8", errors="replace"):
            raise SystemExit(f"NEEDLE FAIL {rel} :: {label}")

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for rel in FILES:
            tar.add(ROOT / rel, arcname=rel)
    payload = buf.getvalue()
    print(f"tar {len(payload)} bytes")

    stamp = time.strftime("%Y%m%d-%H%M%S")
    snap = f"/root/snapshots/asgard-crm-pre-ting-r2-{stamp}"
    ssh(f"mkdir -p {snap} && cd {REMOTE} && tar -czf {snap}/pre.tgz {' '.join(FILES)} 2>/dev/null || true")
    print(f"SNAPSHOT {snap}")

    restart = "" if live else "systemctl restart asgard-crm; sleep 2; systemctl is-active asgard-crm; "
    ssh(f"set -e; tar -xzf - -C {REMOTE}; {restart}echo DEPLOYED", stdin=payload)

    checks = ",".join(f"({rel!r},{n!r})" for rel, n, _l in NEEDLES)
    ssh(
        "python3 - <<'PY'\n"
        f"checks=[{checks}]\nbase={REMOTE!r}\n"
        "import sys\nbad=0\n"
        "for rel,n in checks:\n"
        "  t=open(base+'/'+rel,encoding='utf-8',errors='replace').read()\n"
        "  ok=n in t\n"
        "  print(('OK' if ok else 'FAIL'), rel, n[:40])\n"
        "  bad+=(0 if ok else 1)\n"
        "sys.exit(bad)\nPY"
    )
    print("PROOF ok")

    # Миграция: применяем точечно, чтобы не гонять полный migrate.
    print("=== migration V486 ===")
    ssh(
        f"cd {REMOTE} && PGPASSWORD=123456789 psql -U asgard -d asgard_crm -v ON_ERROR_STOP=1 "
        f"-f migrations/V486__thing_client_metrics.sql && "
        f"PGPASSWORD=123456789 psql -U asgard -d asgard_crm -At -c "
        f"\"SELECT to_regclass('public.thing_client_metrics')\""
    )

    md5_out = ssh("md5sum " + " ".join(f"{REMOTE}/{rel}" for rel in FILES), tries=8)
    remote = {}
    for line in md5_out.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            remote[parts[1]] = parts[0]
    for rel in FILES:
        h = md5(ROOT / rel)
        rh = remote.get(f"{REMOTE}/{rel}", "")
        print(f"MD5 {'OK' if rh == h else 'FAIL'} {rel}")
        if rh != h:
            raise SystemExit(f"MD5 mismatch {rel}: local={h} remote={rh}")

    print(f"=== DONE ting-round2 shell={VER} ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

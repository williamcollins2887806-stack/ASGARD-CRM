#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: field timesheet today highlight + custom period (shell 20.27.65)."""
import hashlib
import io
import os
import sys
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

KEY = Path.home() / ".ssh" / "asgard_crm_deploy"
HOST = "92.242.61.184"
PROJECT = "/var/www/asgard-crm"
ROOT = Path(__file__).resolve().parents[1]
VER = "20.27.65"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-field-ts-today-{TAG}"

FILES = [
    "public/assets/js/field-tab.js",
    "public/index.html",
    "public/sw.js",
]

MARKERS = {
    "public/assets/js/field-tab.js": [
        "data-ymd=",
        "daysSpan > 186",
        "Сегодня",
        "Этот месяц",
    ],
    "public/sw.js": [f"SHELL_VERSION = '{VER}'"],
    "public/index.html": [
        f"ASGARD_SHELL_VERSION = '{VER}'",
        f"field-tab.js?v={VER}",
    ],
}


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(c, cmd, timeout=180):
    print("====", cmd[:220].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-8000:] if len(out) > 8000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:140]}")
    return out


def pack_v2() -> Path:
    v2 = ROOT / "public" / "v2"
    if not (v2 / "index.html").exists():
        raise SystemExit("public/v2 missing — build first")
    found = False
    needles = ("ft-ts-th-day--today", "ft-ts-cell--today", "Этот месяц")
    for p in (v2 / "assets").glob("*.*"):
        try:
            txt = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if any(n in txt for n in needles):
            found = True
            print(f"v2 marker in {p.name}")
            break
    if not found:
        raise SystemExit("v2 build missing today-highlight markers — rebuild")
    tmp = Path(tempfile.gettempdir()) / f"asgard-v2-field-today-{TAG}.tar.gz"
    with tarfile.open(tmp, "w:gz") as tar:
        tar.add(v2, arcname="v2")
    print(f"packed v2 -> {tmp} ({tmp.stat().st_size} bytes)")
    return tmp


def main():
    for rel in FILES:
        local = ROOT / rel
        if not local.exists():
            raise SystemExit(f"missing {rel}")
        text = local.read_text(encoding="utf-8")
        for m in MARKERS.get(rel, []):
            if m not in text:
                raise SystemExit(f"marker missing in {rel}: {m}")

    v2_tar = pack_v2()

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
    c.get_transport().set_keepalive(15)
    sftp = c.open_sftp()

    print("=== SNAPSHOT ===")
    run(
        c,
        "mkdir -p /root/snapshots && tar -C {p} -czf {s}.tgz {files} && ls -lh {s}.tgz".format(
            p=PROJECT,
            s=SNAP,
            files=" ".join(FILES + ["public/v2"]),
        ),
    )

    print("=== UPLOAD FILES ===")
    for rel in FILES:
        local = ROOT / rel
        remote = f"{PROJECT}/{rel}"
        digest = md5_file(local)
        sftp.put(str(local), remote)
        with sftp.file(remote, "rb") as rf:
            remote_md5 = hashlib.md5(rf.read()).hexdigest()
        print(f"  {'OK' if remote_md5 == digest else 'FAIL'} {rel} {digest}")
        if remote_md5 != digest:
            raise SystemExit("md5 fail")

    print("=== UPLOAD V2 ===")
    remote_tar = f"/tmp/asgard-v2-field-today-{TAG}.tar.gz"
    sftp.put(str(v2_tar), remote_tar)
    run(
        c,
        f"rm -rf {PROJECT}/public/v2.new && mkdir -p {PROJECT}/public/v2.new && "
        f"tar xzf {remote_tar} -C {PROJECT}/public/v2.new && "
        f"rm -rf {PROJECT}/public/v2.bak && "
        f"mv {PROJECT}/public/v2 {PROJECT}/public/v2.bak && "
        f"mv {PROJECT}/public/v2.new/v2 {PROJECT}/public/v2 && "
        f"rm -rf {PROJECT}/public/v2.new && rm -f {remote_tar} && "
        f"test -f {PROJECT}/public/v2/index.html",
    )

    print("=== VERIFY ===")
    run(c, f"grep -o \"SHELL_VERSION = '[^']*'\" {PROJECT}/public/sw.js")
    run(c, f"grep -n 'data-ymd\\|daysSpan > 186\\|Сегодня' {PROJECT}/public/assets/js/field-tab.js | head -15")
    run(c, "curl -sS http://127.0.0.1:3000/api/version")

    sftp.close()
    c.close()
    try:
        os.unlink(v2_tar)
    except OSError:
        pass
    print("DONE", VER)


if __name__ == "__main__":
    main()

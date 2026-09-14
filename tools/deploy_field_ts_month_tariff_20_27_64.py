#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deploy: field timesheet month nav + FIO/# + departed tariff (shell 20.27.64)."""
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
VER = "20.27.64"
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-field-ts-{TAG}"

FILES = [
    "src/routes/field-manage.js",
    "public/assets/js/field-tab.js",
    "public/index.html",
    "public/sw.js",
]

MARKERS = {
    "src/routes/field-manage.js": ["keep_inactive"],
    "public/assets/js/field-tab.js": [
        "Этот месяц",
        "openDepartedTariffModal",
        "keep_inactive",
        "width:36px\">#",
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
        print(out[-10000:] if len(out) > 10000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:140]}")
    return out


def pack_v2() -> Path:
    v2 = ROOT / "public" / "v2"
    if not (v2 / "index.html").exists():
        raise SystemExit("public/v2 missing — build first (cd public/desktop-v2-src && npm run build)")
    found = False
    needles = ("Этот месяц", "keep_inactive", "ft-ts-num", "keepInactive")
    for p in (v2 / "assets").glob("*.js"):
        try:
            txt = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if any(n in txt for n in needles):
            found = True
            print(f"v2 marker in {p.name}")
            break
    if not found:
        raise SystemExit("v2 build missing field timesheet/tariff markers — rebuild")
    tmp = Path(tempfile.gettempdir()) / f"asgard-v2-field-ts-{TAG}.tar.gz"
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
    remote_tar = f"/tmp/asgard-v2-field-ts-{TAG}.tar.gz"
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

    print("=== RESTART ===")
    run(c, "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm")

    print("=== VERIFY Ахкямов 11.07 ===")
    run(
        c,
        "PGPASSWORD=123456789 psql -U asgard -d asgard_crm -c \""
        "SELECT c.id, c.date::date, c.day_rate, c.amount_earned, c.status, "
        "e.fio FROM field_checkins c JOIN employees e ON e.id=c.employee_id "
        "WHERE c.employee_id=18 AND c.work_id=354 AND c.date::date='2026-07-11' "
        "ORDER BY c.id;\""
    )

    print("=== VERIFY VERSION ===")
    run(c, f"grep -o \"SHELL_VERSION = '[^']*'\" {PROJECT}/public/sw.js")
    run(c, f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {PROJECT}/public/index.html")
    run(c, f"grep -n 'Этот месяц\\|openDepartedTariffModal\\|keep_inactive' {PROJECT}/public/assets/js/field-tab.js | head -15")
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

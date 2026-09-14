#!/usr/bin/env python3
"""Deploy crew autosave + FIO search/sort (shell 20.27.54)."""
import hashlib
import io
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
TAG = datetime.now().strftime("%Y%m%d-%H%M%S")
SNAP = f"/root/snapshots/asgard-crm-pre-deploy-crew-autosave-{TAG}"

FILES = [
    "public/assets/js/field-tab.js",
    "public/index.html",
    "public/sw.js",
]

MARKERS = [
    "Автосохранение каждые 30 сек",
    "fieldCrewSearch",
    "sortCrewRowsByFio",
    "А→Я по ФИО",
]


def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def run(c, cmd, timeout=180):
    print("====", cmd[:200].replace("\n", " "))
    _, o, e = c.exec_command(cmd, timeout=timeout)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    code = o.channel.recv_exit_status()
    if out:
        print(out[-8000:] if len(out) > 8000 else out)
    if err.strip():
        print("STDERR:", err[:2000])
    if code != 0:
        raise SystemExit(f"FAILED ({code}): {cmd[:120]}")
    return out


def pack_v2() -> Path:
    v2 = ROOT / "public" / "v2"
    if not v2.is_dir():
        raise SystemExit("public/v2 missing — build first")
    tmp = Path(tempfile.gettempdir()) / f"asgard-v2-crew-{TAG}.tar.gz"
    with tarfile.open(tmp, "w:gz") as tar:
        tar.add(v2, arcname="v2")
    print(f"packed v2 -> {tmp} ({tmp.stat().st_size} bytes)")
    return tmp


def main():
    for rel in FILES:
        if not (ROOT / rel).exists():
            raise SystemExit(f"missing {rel}")
    ft = (ROOT / "public/assets/js/field-tab.js").read_text(encoding="utf-8")
    for m in MARKERS:
        if m not in ft:
            raise SystemExit(f"marker missing in field-tab.js: {m}")

    v2_tar = pack_v2()

    key = paramiko.Ed25519Key.from_private_key_file(str(KEY))
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", pkey=key, timeout=30)
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

    print("=== UPLOAD V2 TAR ===")
    remote_tar = f"/tmp/asgard-v2-crew-{TAG}.tar.gz"
    sftp.put(str(v2_tar), remote_tar)
    run(
        c,
        f"mkdir -p {PROJECT}/public && tar -xzf {remote_tar} -C {PROJECT}/public && "
        f"rm -f {remote_tar} && ls -lh {PROJECT}/public/v2/assets | head -8",
    )
    sftp.close()

    print("=== VERIFY ===")
    run(
        c,
        f"grep -n 'Автосохранение каждые 30 сек\\|fieldCrewSearch\\|sortCrewRowsByFio' "
        f"{PROJECT}/public/assets/js/field-tab.js | head -10",
    )
    run(c, f"grep -o \"SHELL_VERSION = '[^']*'\" {PROJECT}/public/sw.js")
    run(c, f"grep -o \"ASGARD_SHELL_VERSION = '[^']*'\" {PROJECT}/public/index.html")
    run(c, f"grep -o 'field-tab.js?v=[^\"]*' {PROJECT}/public/index.html")
    # frontend-only: restart so /api/version picks new sw if cached
    run(c, "systemctl restart asgard-crm && sleep 2 && systemctl is-active asgard-crm")
    run(c, "curl -sS http://127.0.0.1:3000/api/version")
    c.close()
    try:
        v2_tar.unlink()
    except OSError:
        pass
    print("DONE 20.27.54")


if __name__ == "__main__":
    main()
